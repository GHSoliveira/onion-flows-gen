import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { authorize } from '../middleware/authorization.js';
import { requireTenant } from '../middleware/tenant.js';
import adapter from '../../db/DatabaseAdapter.js';
import { templateSchema, whatsappInteractiveTemplateSchema } from '../schemas/index.js';
import { createLog } from '../services/logs.js';
import { getWhatsAppConfig, resolveWhatsAppSender } from '../services/channelConfig.js';
import { invalidateRuntimeTemplatesCache } from '../services/flowRuntimeCache.js';
import { listWhatsAppTemplateCatalog, syncWhatsAppTemplateCatalog } from '../services/whatsappTemplateCatalog.js';
import { generateId } from '../utils/helpers.js';

const router = express.Router();

router.get('/', authenticate, requireTenant, async (req, res) => {
  try {
    const templates = await adapter.getCollection('messageTemplates', req.tenantId);
    res.json(templates);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/whatsapp', authenticate, requireTenant, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || null;
    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId obrigatorio' });
    }

    const items = await listWhatsAppTemplateCatalog(tenantId);
    const config = await getWhatsAppConfig(tenantId);
    const defaultSender = resolveWhatsAppSender(config);
    const lastSyncedAt = items.reduce((latest, item) => {
      const value = item?.lastSyncedAt || item?.updatedAt || null;
      if (!value) return latest;
      if (!latest) return value;
      return new Date(value).getTime() > new Date(latest).getTime() ? value : latest;
    }, null);

    res.json({
      items,
      lastSyncedAt,
      channelConfig: {
        enabled: Boolean(config?.enabled),
        phoneNumberId: defaultSender?.phoneNumberId || config?.phoneNumberId || null,
        senderNumbers: Array.isArray(config?.senderNumbers) ? config.senderNumbers : [],
        wabaId: config?.wabaId || null,
        ready: Boolean(config?.accessToken && config?.wabaId && (defaultSender?.phoneNumberId || config?.phoneNumberId))
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/whatsapp/interactive', authenticate, requireTenant, async (req, res) => {
  try {
    if (!adapter.db) await adapter.init();
    const collection = adapter.db.collection('whatsappInteractiveTemplates');
    const tenantId = req.tenantId || req.user?.tenantId || null;
    const items = await collection.find({ tenantId }).sort({ updatedAt: -1, name: 1 }).toArray();
    res.json({ items });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/whatsapp/interactive', authenticate, authorize(['ADMIN', 'SUPER_ADMIN']), requireTenant, async (req, res) => {
  try {
    const payload = whatsappInteractiveTemplateSchema.parse(req.body || {});
    if (!adapter.db) await adapter.init();
    const collection = adapter.db.collection('whatsappInteractiveTemplates');
    const tenantId = req.tenantId || req.user?.tenantId || null;
    const now = new Date().toISOString();
    const item = {
      id: generateId('wa_int'),
      tenantId,
      channel: 'whatsapp',
      type: 'interactive',
      ...payload,
      createdAt: now,
      updatedAt: now
    };
    await collection.insertOne(item);
    await createLog('WHATSAPP_INTERACTIVE_TEMPLATE_CREATE', {
      tenantId,
      id: item.id,
      name: item.name,
      kind: item.kind
    }, req.user.id);
    res.status(201).json(item);
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: error.errors });
    }
    res.status(500).json({ error: error.message });
  }
});

router.put('/whatsapp/interactive/:id', authenticate, authorize(['ADMIN', 'SUPER_ADMIN']), requireTenant, async (req, res) => {
  try {
    const payload = whatsappInteractiveTemplateSchema.parse(req.body || {});
    if (!adapter.db) await adapter.init();
    const collection = adapter.db.collection('whatsappInteractiveTemplates');
    const tenantId = req.tenantId || req.user?.tenantId || null;
    const existing = await collection.findOne({ id: req.params.id, tenantId });
    if (!existing) {
      return res.status(404).json({ error: 'Template interativo nao encontrado' });
    }

    const nextItem = {
      ...existing,
      ...payload,
      updatedAt: new Date().toISOString()
    };

    await collection.updateOne(
      { id: existing.id, tenantId },
      { $set: nextItem }
    );

    await createLog('WHATSAPP_INTERACTIVE_TEMPLATE_UPDATE', {
      tenantId,
      id: existing.id,
      name: nextItem.name,
      kind: nextItem.kind
    }, req.user.id);

    res.json(nextItem);
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: error.errors });
    }
    res.status(500).json({ error: error.message });
  }
});

router.delete('/whatsapp/interactive/:id', authenticate, authorize(['ADMIN', 'SUPER_ADMIN']), requireTenant, async (req, res) => {
  try {
    if (!adapter.db) await adapter.init();
    const collection = adapter.db.collection('whatsappInteractiveTemplates');
    const tenantId = req.tenantId || req.user?.tenantId || null;
    const existing = await collection.findOne({ id: req.params.id, tenantId });
    if (!existing) {
      return res.status(404).json({ error: 'Template interativo nao encontrado' });
    }

    await collection.deleteOne({ id: req.params.id, tenantId });
    await createLog('WHATSAPP_INTERACTIVE_TEMPLATE_DELETE', {
      tenantId,
      id: existing.id,
      name: existing.name,
      kind: existing.kind
    }, req.user.id);

    res.json({ ok: true, deleted: existing });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/whatsapp/sync', authenticate, authorize(['ADMIN', 'SUPER_ADMIN']), requireTenant, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || null;
    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId obrigatorio' });
    }

    const config = await getWhatsAppConfig(tenantId);
    if (!config?.accessToken || !config?.wabaId) {
      return res.status(400).json({ error: 'Configure access token e WABA ID no canal WhatsApp antes de sincronizar.' });
    }

    const result = await syncWhatsAppTemplateCatalog({
      tenantId,
      accessToken: config.accessToken,
      wabaId: config.wabaId,
      phoneNumberId: resolveWhatsAppSender(config)?.phoneNumberId || config.phoneNumberId || null
    });

    await createLog('WHATSAPP_TEMPLATE_SYNC', {
      tenantId,
      total: result.total,
      wabaId: config.wabaId
    }, req.user.id);

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Mensagens rápidas do próprio agente (scope root, agentOwned).
 * Qualquer role autenticada no tenant pode criar/editar/apagar as suas.
 */
router.post('/agent-quick', authenticate, requireTenant, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const text = String(req.body?.text || '').trim();
    if (!name || !text) {
      return res.status(400).json({ error: 'name e text são obrigatórios' });
    }
    if (name.length > 80 || text.length > 4000) {
      return res.status(400).json({ error: 'name/text longos demais' });
    }

    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'tenantId obrigatório' });

    const now = new Date().toISOString();
    const template = {
      id: generateId('tpl'),
      name,
      text,
      scope: 'root',
      agentOwned: true,
      createdBy: req.user.id,
      tenantId,
      createdAt: now,
      updatedAt: now
    };

    if (!adapter.db) await adapter.init();
    await adapter.db.collection('messageTemplates').insertOne(template);
    invalidateRuntimeTemplatesCache(tenantId);
    res.status(201).json(template);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/agent-quick/:id', authenticate, requireTenant, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const text = String(req.body?.text || '').trim();
    if (!name || !text) {
      return res.status(400).json({ error: 'name e text são obrigatórios' });
    }

    if (!adapter.db) await adapter.init();
    const collection = adapter.db.collection('messageTemplates');
    const query = { id: req.params.id, tenantId: req.tenantId };
    const existing = await collection.findOne(query);
    if (!existing) return res.status(404).json({ error: 'Template não encontrado' });

    const isOwner = existing.createdBy === req.user.id;
    const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(req.user.role);
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Só pode editar mensagens rápidas suas' });
    }

    const updates = { name, text, updatedAt: new Date().toISOString() };
    await collection.updateOne({ id: existing.id }, { $set: updates });
    invalidateRuntimeTemplatesCache(existing.tenantId);
    res.json({ ...existing, ...updates });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/agent-quick/:id', authenticate, requireTenant, async (req, res) => {
  try {
    if (!adapter.db) await adapter.init();
    const collection = adapter.db.collection('messageTemplates');
    const query = { id: req.params.id, tenantId: req.tenantId };
    const existing = await collection.findOne(query);
    if (!existing) return res.status(404).json({ error: 'Template não encontrado' });

    const isOwner = existing.createdBy === req.user.id;
    const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(req.user.role);
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Só pode apagar mensagens rápidas suas' });
    }

    await collection.deleteOne({ id: existing.id });
    invalidateRuntimeTemplatesCache(existing.tenantId);
    res.json({ ok: true, deleted: existing.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', authenticate, authorize(['ADMIN', 'SUPER_ADMIN']), requireTenant, async (req, res) => {
  try {
    const data = templateSchema.parse(req.body);

    const template = {
      id: generateId('tpl'),
      ...data,
      tenantId: req.user.role === 'SUPER_ADMIN' ? req.body.tenantId : req.tenantId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (!adapter.db) await adapter.init();
    const collection = adapter.db.collection('messageTemplates');
    await collection.insertOne(template);
    invalidateRuntimeTemplatesCache(template.tenantId);

    await createLog('TEMPLATE_CREATE', { id: template.id, name: template.name, tenantId: template.tenantId }, req.user.id);
    res.status(201).json(template);
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: error.errors });
    }
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', authenticate, authorize(['ADMIN', 'SUPER_ADMIN']), requireTenant, async (req, res) => {
  try {
    if (!adapter.db) await adapter.init();
    const collection = adapter.db.collection('messageTemplates');

    const query = { id: req.params.id };
    if (req.user.role !== 'SUPER_ADMIN') {
      query.tenantId = req.tenantId;
    } else if (req.tenantId) {
      query.tenantId = req.tenantId;
    }

    const template = await collection.findOne(query);
    if (!template) return res.status(404).json({ error: 'Template nao encontrado' });

    await collection.deleteOne(query);
    invalidateRuntimeTemplatesCache(template.tenantId);

    await createLog('TEMPLATE_DELETE', { id: template.id, name: template.name, tenantId: template.tenantId }, req.user.id);
    res.json({ message: 'Template removido', deleted: template });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
