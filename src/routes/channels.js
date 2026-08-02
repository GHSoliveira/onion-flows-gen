import express from 'express';
import adapter from '../../db/DatabaseAdapter.js';
import { authenticate } from '../middleware/auth.js';
import { authorize } from '../middleware/authorization.js';
import { requireTenant } from '../middleware/tenant.js';
import { getChannelConfig, saveTelegramConfig, saveWhatsAppConfig, updateChannelFlowRoute } from '../services/channelConfig.js';
import { telegramFetch } from '../services/telegramApi.js';
import { createLog } from '../services/logs.js';

const router = express.Router();

const maskToken = (value) => (value ? '***' : null);

const maskChannelConfig = (config) => {
  if (!config) return { tenantId: config?.tenantId || null, telegram: null, whatsapp: null };
  const telegram = config.telegram ? {
    ...config.telegram,
    botToken: maskToken(config.telegram.botToken),
    webhookSecret: maskToken(config.telegram.webhookSecret)
  } : null;
  const whatsapp = config.whatsapp ? {
    ...config.whatsapp,
    accessToken: maskToken(config.whatsapp.accessToken),
    appSecret: maskToken(config.whatsapp.appSecret),
    webhookVerifyToken: maskToken(config.whatsapp.webhookVerifyToken)
  } : null;
  return { ...config, telegram, whatsapp };
};

const normalize = (value) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
};

const assertFlowBelongsToTenant = async (tenantId, flowId) => {
  const normalizedFlowId = normalize(flowId);
  if (!normalizedFlowId) return;

  const flows = await adapter.getCollection('flows', tenantId);
  const exists = Array.isArray(flows) && flows.some((flow) => flow?.id === normalizedFlowId);
  if (!exists) {
    const error = new Error('Fluxo nao encontrado neste tenant');
    error.status = 404;
    throw error;
  }
};

router.get('/', authenticate, authorize(['ADMIN', 'SUPER_ADMIN']), requireTenant, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || null;
    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId obrigatorio' });
    }
    const config = await getChannelConfig(tenantId);
    res.json(maskChannelConfig(config || { tenantId, telegram: null, whatsapp: null }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/telegram', authenticate, authorize(['ADMIN', 'SUPER_ADMIN']), requireTenant, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || null;
    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId obrigatorio' });
    }
    const saved = await saveTelegramConfig(tenantId, req.body || {});
    res.json({ tenantId, telegram: maskChannelConfig({ tenantId, telegram: saved, whatsapp: null }).telegram });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/whatsapp', authenticate, authorize(['ADMIN', 'SUPER_ADMIN']), requireTenant, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || null;
    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId obrigatorio' });
    }
    const saved = await saveWhatsAppConfig(tenantId, req.body || {});
    res.json({ tenantId, whatsapp: maskChannelConfig({ tenantId, telegram: null, whatsapp: saved }).whatsapp });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/flow-routing', authenticate, authorize(['ADMIN', 'SUPER_ADMIN']), requireTenant, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || null;
    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId obrigatorio' });
    }

    await assertFlowBelongsToTenant(tenantId, req.body?.flowId);
    const saved = await updateChannelFlowRoute(tenantId, req.body || {});
    await createLog('CHANNEL_FLOW_ROUTE_UPDATE', {
      tenantId,
      channel: req.body?.channel || null,
      flowId: req.body?.flowId || null,
      senderId: req.body?.senderId || null,
      senderPhoneNumberId: req.body?.senderPhoneNumberId || req.body?.phoneNumberId || null
    }, req.user?.id || 'system');

    res.json(maskChannelConfig(saved));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.post('/telegram/webhook', authenticate, authorize(['ADMIN', 'SUPER_ADMIN']), requireTenant, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || null;
    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId obrigatorio' });
    }
    const config = await getChannelConfig(tenantId);
    const telegram = config?.telegram || null;
    if (!telegram?.botToken || !telegram?.webhookUrl) {
      return res.status(400).json({ error: 'Bot token e webhook URL sao obrigatorios' });
    }

    const payload = {
      url: telegram.webhookUrl,
      secret_token: telegram.webhookSecret || undefined
    };
    const result = await telegramFetch('setWebhook', payload, telegram.botToken);
    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
