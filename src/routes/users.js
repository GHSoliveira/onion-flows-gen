import express from 'express';
import bcrypt from 'bcrypt';
import { authenticate } from '../middleware/auth.js';
import { authorize } from '../middleware/authorization.js';
import { requireTenant } from '../middleware/tenant.js';
import adapter from '../../db/DatabaseAdapter.js';
import { userSchema } from '../schemas/index.js';
import { createLog } from '../services/logs.js';
import { ensureTenantLimit } from '../services/tenantLimits.js';
import { generateId } from '../utils/helpers.js';

const router = express.Router();
const USER_READ_ROLES = ['ADMIN', 'MANAGER', 'SUPER_ADMIN'];
const USER_WRITE_ROLES = ['ADMIN', 'SUPER_ADMIN'];

router.get('/', authenticate, authorize(USER_READ_ROLES), requireTenant, async (req, res) => {
  try {
    const users = await adapter.getCollection('users', req.tenantId);
    const usersWithoutPasswords = users.map(({ password, ...user }) => user);
    const page = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
    const limitRaw = parseInt(req.query.limit || '0', 10) || 0;
    const limit = limitRaw > 0 ? Math.min(Math.max(limitRaw, 1), 500) : 0;

    if (!limit) {
      return res.json(usersWithoutPasswords);
    }

    const total = usersWithoutPasswords.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (page - 1) * limit;
    const items = usersWithoutPasswords.slice(start, start + limit);
    res.json({ items, total, page, totalPages, limit });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', authenticate, authorize(USER_WRITE_ROLES), requireTenant, async (req, res) => {
  try {
    const { name, username, password, role, queues, tenantId: bodyTenantId, permissions } = userSchema.parse(req.body);
    const tenantId = req.user.role === 'SUPER_ADMIN'
      ? (bodyTenantId || req.tenantId || req.user.tenantId)
      : req.tenantId;

    if (!tenantId && req.user.role !== 'SUPER_ADMIN') {
      return res.status(400).json({ error: 'Administrador deve pertencer a um tenant' });
    }

    await ensureTenantLimit(tenantId, 'users');

    if (!adapter.db) await adapter.init();
    const collection = adapter.db.collection('users');

    const existing = await collection.findOne({ username, tenantId });
    if (existing) {
      return res.status(400).json({ error: 'Username ja esta em uso' });
    }

    const user = {
      id: generateId('u'),
      name,
      username,
      password: await bcrypt.hash(password, 10),
      role: req.user.role === 'SUPER_ADMIN' && role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : (role || 'AGENT'),
      queues: queues || [],
      permissions: req.user.role === 'SUPER_ADMIN' ? (permissions || []) : [],
      tenantId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: req.user.id
    };

    await collection.insertOne(user);

    await createLog('USER_CREATE', { id: user.id, name: user.name, tenantId: user.tenantId, role: user.role }, req.user.id);
    const { password: _, ...userWithoutPassword } = user;
    res.status(201).json(userWithoutPassword);
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: error.errors });
    }
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', authenticate, authorize(USER_WRITE_ROLES), async (req, res) => {
  try {
    const { name, username, password, role, queues } = req.body || {};
    const nextName = String(name || '').trim();
    const nextUsername = String(username || '').trim();
    const allowedRoles = ['ADMIN', 'MANAGER', 'AGENT', 'SUPER_ADMIN'];
    const nextRole = allowedRoles.includes(role) ? role : 'AGENT';

    if (!nextName) return res.status(400).json({ error: 'Nome e obrigatorio' });
    if (nextUsername.length < 3) return res.status(400).json({ error: 'Username deve ter pelo menos 3 caracteres' });
    if (password && String(password).length < 6) return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres' });

    if (!adapter.db) await adapter.init();
    const collection = adapter.db.collection('users');

    const query = { id: req.params.id };
    if (req.user.role !== 'SUPER_ADMIN') {
      query.tenantId = req.user.tenantId;
    }

    const user = await collection.findOne(query);
    if (!user) return res.status(404).json({ error: 'Usuario nao encontrado' });

    const duplicate = await collection.findOne({
      id: { $ne: user.id },
      tenantId: user.tenantId,
      username: nextUsername
    });
    if (duplicate) {
      return res.status(400).json({ error: 'Username ja esta em uso' });
    }

    const safeRole = req.user.role === 'SUPER_ADMIN' && nextRole === 'SUPER_ADMIN'
      ? 'SUPER_ADMIN'
      : (nextRole === 'SUPER_ADMIN' ? user.role : nextRole);

    const update = {
      name: nextName,
      username: nextUsername,
      role: safeRole,
      queues: safeRole === 'AGENT' && Array.isArray(queues) ? queues : [],
      updatedAt: new Date().toISOString()
    };

    if (password) {
      update.password = await bcrypt.hash(String(password), 10);
    }

    await collection.updateOne({ id: user.id }, { $set: update });
    const updated = await collection.findOne({ id: user.id });

    await createLog('USER_UPDATE', { id: updated.id, name: updated.name, tenantId: updated.tenantId, role: updated.role }, req.user.id);
    const { password: _, ...userWithoutPassword } = updated;
    res.json(userWithoutPassword);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', authenticate, authorize(USER_WRITE_ROLES), async (req, res) => {
  try {
    if (!adapter.db) await adapter.init();
    const collection = adapter.db.collection('users');

    const query = { id: req.params.id };
    if (req.user.role !== 'SUPER_ADMIN') {
      query.tenantId = req.user.tenantId;
    }

    const user = await collection.findOne(query);
    if (!user) return res.status(404).json({ error: 'Usuario nao encontrado' });

    await collection.deleteOne(query);

    await createLog('USER_DELETE', { id: user.id, name: user.name, tenantId: user.tenantId, role: user.role }, req.user.id);
    const { password: _, ...userWithoutPassword } = user;
    res.json({ message: 'Usuario removido', deleted: userWithoutPassword });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id/permissions', authenticate, authorize(['SUPER_ADMIN']), async (req, res) => {
  try {
    const { permissions } = req.body || {};
    if (!Array.isArray(permissions)) {
      return res.status(400).json({ error: 'permissions deve ser um array' });
    }

    if (!adapter.db) await adapter.init();
    const collection = adapter.db.collection('users');

    const result = await collection.updateOne(
      { id: req.params.id, role: 'SUPER_ADMIN' },
      { $set: { permissions, updatedAt: new Date().toISOString() } }
    );

    if (!result.matchedCount) {
      return res.status(404).json({ error: 'Usuario SUPER_ADMIN nao encontrado' });
    }

    const updated = await collection.findOne({ id: req.params.id }, { projection: { id: 1, permissions: 1 } });
    res.json({ id: updated.id, permissions: updated.permissions || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
