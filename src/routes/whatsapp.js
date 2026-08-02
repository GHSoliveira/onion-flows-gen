import express from 'express';
import { handleWhatsAppWebhook } from '../services/whatsappHandler.js';
import { getAllWhatsAppConfigs, getWhatsAppConfig } from '../services/channelConfig.js';
import { verifyWhatsAppSignature } from '../services/whatsappApi.js';
import adapter from '../../db/DatabaseAdapter.js';
import { isBillingBlocked } from '../services/billingGuard.js';
import { notifyWhatsAppProblem } from '../services/whatsappAlerts.js';
import { enqueueWhatsAppWebhook } from '../queues/webhookQueue.js';
import { isBullMqEnabled } from '../services/redisClient.js';

const router = express.Router();

// Webhook replay protection — track recent payloads by signature hash
const recentWebhooks = new Map();
const WEBHOOK_DEDUP_TTL = 60_000; // 60s window
const WEBHOOK_DEDUP_MAX = 5000;

const isReplay = (signature) => {
  if (!signature) return false;
  const now = Date.now();
  if (recentWebhooks.has(signature)) return true;
  recentWebhooks.set(signature, now);
  // Cleanup old entries periodically
  if (recentWebhooks.size > WEBHOOK_DEDUP_MAX) {
    for (const [key, ts] of recentWebhooks) {
      if (now - ts > WEBHOOK_DEDUP_TTL) recentWebhooks.delete(key);
      if (recentWebhooks.size <= WEBHOOK_DEDUP_MAX / 2) break;
    }
  }
  return false;
};

router.get('/webhook', async (req, res) => {
  try {
    const tenantId = req.query.tenantId || null;
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    console.log('[WHATSAPP] Verification request', {
      tenantId,
      mode: mode || null,
      hasToken: Boolean(token),
      hasChallenge: Boolean(challenge)
    });

    if (!mode || !token || !challenge) {
      return res.status(400).send('Missing verification params');
    }

    const config = tenantId ? await getWhatsAppConfig(tenantId) : null;
    const expected = config?.webhookVerifyToken || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || null;
    if (mode === 'subscribe' && !tenantId && !expected) {
      const configs = await getAllWhatsAppConfigs();
      const match = configs.find((entry) => entry?.whatsapp?.webhookVerifyToken === token);
      if (match) {
        return res.status(200).send(challenge);
      }
    }
    if (mode === 'subscribe' && expected && token === expected) {
      return res.status(200).send(challenge);
    }

    return res.status(403).send('Forbidden');
  } catch (error) {
    return res.status(500).send('Internal error');
  }
});

router.post('/webhook', async (req, res) => {
  try {
    const tenantId = req.query.tenantId || null;
    const rawBody = req.rawBody ? req.rawBody : Buffer.from(JSON.stringify(req.body || {}));

    console.log('[WHATSAPP] Webhook payload received', {
      tenantId,
      bodyType: typeof req.body,
      entryCount: Array.isArray(req.body?.entry) ? req.body.entry.length : 0
    });

    const config = tenantId ? await getWhatsAppConfig(tenantId) : null;
    let appSecret = config?.appSecret || process.env.WHATSAPP_APP_SECRET || null;
    const signature = req.headers['x-hub-signature-256'];
    if (!signature) {
      console.warn('[WHATSAPP] Webhook sem assinatura', { tenantId });
      await notifyWhatsAppProblem({
        operation: 'webhook_missing_signature',
        tenantId,
        data: { error: { message: 'Webhook WhatsApp sem assinatura' } }
      });
      return res.status(401).json({ error: 'Missing signature' });
    }
    let matchedTenantId = tenantId || null;
    let isValid = false;
    if (appSecret) {
      isValid = verifyWhatsAppSignature(rawBody, signature, appSecret);
    }
    if (!isValid && !tenantId) {
      const configs = await getAllWhatsAppConfigs();
      for (const entry of configs) {
        const candidateSecret = entry?.whatsapp?.appSecret || null;
        if (!candidateSecret) continue;
        if (verifyWhatsAppSignature(rawBody, signature, candidateSecret)) {
          isValid = true;
          matchedTenantId = entry.tenantId || null;
          appSecret = candidateSecret;
          break;
        }
      }
    }
    if (!isValid) {
      console.warn('[WHATSAPP] Assinatura invalida no webhook', {
        tenantId,
        matchedTenantId,
        hasSignature: Boolean(signature)
      });
      await notifyWhatsAppProblem({
        operation: 'webhook_signature',
        tenantId: matchedTenantId || tenantId || null,
        data: { error: { message: 'Assinatura invalida no webhook WhatsApp' } }
      });
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Replay protection — reject duplicate webhooks
    if (isReplay(signature)) {
      return res.json({ ok: true, skipped: 'duplicate' });
    }

    // Billing guard — ack 200 to WhatsApp but skip processing
    if (matchedTenantId) {
      const tenants = await adapter.getCollection('tenants');
      const tenant = tenants.find(t => t.id === matchedTenantId);
      if (tenant && isBillingBlocked(tenant)) {
        return res.json({ ok: true, skipped: 'billing_blocked' });
      }
    }

    const payload = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString('utf8')) : req.body;
    if (isBullMqEnabled()) {
      try {
        const job = await enqueueWhatsAppWebhook({
          payload,
          tenantId: matchedTenantId,
          signature
        });
        if (job) {
          return res.json({ ok: true, accepted: true, queued: true });
        }
        console.warn('[WHATSAPP] BullMQ indisponivel no webhook; usando fallback setImmediate', {
          tenantId: matchedTenantId || tenantId || null
        });
      } catch (error) {
        console.warn('[WHATSAPP] Falha ao enfileirar webhook; usando fallback setImmediate', {
          tenantId: matchedTenantId || tenantId || null,
          error: error?.message || 'queue_failed'
        });
      }
    }

    res.json({ ok: true, accepted: true });
    setImmediate(() => {
      handleWhatsAppWebhook({ payload, tenantId: matchedTenantId })
        .catch((error) => {
          console.error('Erro processamento webhook WhatsApp:', error);
        });
    });
    return;
  } catch (error) {
    console.error('Erro webhook WhatsApp:', error);
    return res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
