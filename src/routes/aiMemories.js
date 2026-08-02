import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenant.js';
import adapter from '../../db/DatabaseAdapter.js';
import { generateId } from '../utils/helpers.js';
import { createLog } from '../services/logs.js';

const router = express.Router();
const requireAgent = (req, res, next) => {
  if (req.user?.role !== 'AGENT') return res.status(403).json({ error: 'Memorias pessoais estao disponiveis apenas para agentes.' });
  next();
};

const cleanPayload = (body = {}, { partial = false } = {}) => {
  const result = {};
  if (!partial || body.title !== undefined) {
    result.title = String(body.title || '').trim().slice(0, 120);
    if (!result.title) throw new Error('Informe um titulo para a memoria.');
  }
  if (!partial || body.content !== undefined) {
    result.content = String(body.content || '').trim().slice(0, 4000);
    if (!result.content) throw new Error('Informe a instrucao que a IA deve lembrar.');
  }
  if (!partial || body.enabled !== undefined) result.enabled = body.enabled !== false;
  if (!partial || body.order !== undefined) {
    const order = Number.parseInt(String(body.order ?? 0), 10);
    result.order = Number.isFinite(order) ? Math.max(0, Math.min(order, 9999)) : 0;
  }
  return result;
};

const tenantQuery = (req, id = null) => ({
  ...(id ? { id } : {}),
  tenantId: req.tenantId,
  agentId: req.user.id
});

router.get('/', authenticate, requireAgent, requireTenant, async (req, res) => {
  try {
    const memories = await adapter.findDocuments('aiMemories', tenantQuery(req));
    memories.sort((a, b) => Number(a.order || 0) - Number(b.order || 0)
      || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    res.json(memories);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', authenticate, requireAgent, requireTenant, async (req, res) => {
  try {
    const data = cleanPayload(req.body);
    const now = new Date().toISOString();
    const memory = {
      id: generateId('aimem'),
      ...data,
      tenantId: req.tenantId,
      agentId: req.user.id,
      createdAt: now,
      updatedAt: now,
      createdBy: req.user.id
    };
    await adapter.insertOne('aiMemories', memory);
    await createLog('AI_MEMORY_CREATE', { id: memory.id, title: memory.title, tenantId: memory.tenantId, agentId: memory.agentId }, req.user.id);
    res.status(201).json(memory);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.put('/:id', authenticate, requireAgent, requireTenant, async (req, res) => {
  try {
    const query = tenantQuery(req, req.params.id);
    const current = await adapter.findOne('aiMemories', query);
    if (!current) return res.status(404).json({ error: 'Memoria nao encontrada.' });
    const updates = { ...cleanPayload(req.body, { partial: true }), updatedAt: new Date().toISOString() };
    await adapter.updateOne('aiMemories', query, { $set: updates });
    const updated = { ...current, ...updates };
    await createLog('AI_MEMORY_UPDATE', { id: updated.id, title: updated.title, tenantId: updated.tenantId, agentId: updated.agentId }, req.user.id);
    res.json(updated);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/:id', authenticate, requireAgent, requireTenant, async (req, res) => {
  try {
    const query = tenantQuery(req, req.params.id);
    const current = await adapter.findOne('aiMemories', query);
    if (!current) return res.status(404).json({ error: 'Memoria nao encontrada.' });
    if (!adapter.db) await adapter.init();
    await adapter.db.collection('aiMemories').deleteOne(query);
    await createLog('AI_MEMORY_DELETE', { id: current.id, title: current.title, tenantId: current.tenantId, agentId: current.agentId }, req.user.id);
    res.json({ message: 'Memoria removida.', deleted: current });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
