import express from 'express';
import jwt from 'jsonwebtoken';
import { authenticate } from '../middleware/auth.js';
import { authorize, requireSuperAdminPermission } from '../middleware/authorization.js';
import { destructiveLimiter } from '../middleware/rateLimits.js';
import adapter from '../../db/DatabaseAdapter.js';
import { JWT_SECRET_VALUE } from '../config/constants.js';
import { createLog, getIo } from '../services/logs.js';
import { applyFlowRuntimeReset } from '../services/flowRunner.js';
import {
  createEntry as createAllowlistEntry,
  listEntries as listAllowlistEntries,
  removeEntry as removeAllowlistEntry,
  updateEntry as updateAllowlistEntry,
  purgeExpired as purgeAllowlistExpired
} from '../services/adminIpAllowlist.js';
import { getClientIp } from '../middleware/superAdminIp.js';
import { listRecentAccessEvents, purgeOldAuditEntries } from '../services/adminAccessAudit.js';

const router = express.Router();
const METRICS_CACHE_TTL_MS = 60000;
const MONITOR_CACHE_TTL_MS = 30000;
const WEB_VITALS_CACHE_TTL_MS = 60000;
const DEFAULT_TENANT_LIMITS = {
  maxUsers: 5,
  maxFlows: 10,
  maxChatsPerDay: 100
};
const EXTERNAL_TOKEN_ROLES = ['ADMIN', 'MANAGER', 'AGENT'];
const EXTERNAL_TOKEN_EXPIRATION_OPTIONS = ['8h', '24h', '7d', '30d', '90d'];
const EXTERNAL_TOKEN_DEFAULT_EXPIRATION = '30d';
let cachedMetrics = null;
let cachedMetricsAt = 0;
let cachedMonitoring = null;
let cachedMonitoringAt = 0;
const cachedWebVitals = new Map();
const isOperationalChat = (chat) => chat?.status !== 'closed';

const toDateKey = (date) => {
  if (!date) return null;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};

router.get('/dashboard', authenticate, authorize(['SUPER_ADMIN']), requireSuperAdminPermission(['superadmin:read']), async (req, res) => {
  try {
    if (cachedMetrics && Date.now() - cachedMetricsAt < METRICS_CACHE_TTL_MS) {
      res.set('Cache-Control', 'private, max-age=10');
      return res.json(cachedMetrics);
    }

    const [tenants, users, flows, storedChats] = await Promise.all([
      adapter.findMany('tenants', {
        projection: { _id: 0, id: 1, name: 1, plan: 1, status: 1, settings: 1 }
      }),
      adapter.findMany('users', {
        projection: { _id: 0, tenantId: 1 }
      }),
      adapter.findMany('flows', {
        projection: { _id: 0, tenantId: 1 }
      }),
      adapter.findMany('activeChats', {
        projection: { _id: 0, tenantId: 1, status: 1, createdAt: 1 }
      })
    ]);
    const activeChats = (Array.isArray(storedChats) ? storedChats : []).filter(isOperationalChat);

    const todayKey = toDateKey(new Date());
    const usageByTenant = new Map();

    (users || []).forEach((user) => {
      const tenantId = user?.tenantId;
      if (!tenantId) return;
      const current = usageByTenant.get(tenantId) || { users: 0, flows: 0, chatsToday: 0 };
      current.users += 1;
      usageByTenant.set(tenantId, current);
    });

    (flows || []).forEach((flow) => {
      const tenantId = flow?.tenantId;
      if (!tenantId) return;
      const current = usageByTenant.get(tenantId) || { users: 0, flows: 0, chatsToday: 0 };
      current.flows += 1;
      usageByTenant.set(tenantId, current);
    });

    (Array.isArray(storedChats) ? storedChats : []).forEach((chat) => {
      const tenantId = chat?.tenantId;
      if (!tenantId) return;
      const current = usageByTenant.get(tenantId) || { users: 0, flows: 0, chatsToday: 0 };
      if (toDateKey(chat?.createdAt) === todayKey) {
        current.chatsToday += 1;
      }
      usageByTenant.set(tenantId, current);
    });

    const billing = (tenants || []).map((tenant) => ({
      tenantId: tenant.id,
      name: tenant.name,
      plan: tenant.plan || 'free',
      status: tenant.status || 'active',
      usage: usageByTenant.get(tenant.id) || { users: 0, flows: 0, chatsToday: 0 },
      limits: {
        ...DEFAULT_TENANT_LIMITS,
        ...(tenant?.settings || {})
      }
    }));

    const metrics = {
      tenants: {
        total: tenants.length,
        ativos: tenants.filter(t => t.status === 'active').length,
        trial: tenants.filter(t => t.status === 'trial').length,
        suspensos: tenants.filter(t => t.status === 'suspended').length
      },
      usuarios: {
        total: users.length,
        porTenant: users.reduce((acc, user) => {
          const existing = acc.find(a => a.tenantId === user.tenantId);
          if (existing) {
            existing.count++;
          } else {
            acc.push({ tenantId: user.tenantId || 'super_admin', count: 1 });
          }
          return acc;
        }, [])
      },
      flows: {
        total: flows.length,
        porTenant: flows.reduce((acc, flow) => {
          const existing = acc.find(a => a.tenantId === flow.tenantId);
          if (existing) {
            existing.count++;
          } else {
            acc.push({ tenantId: flow.tenantId || 'super_admin', count: 1 });
          }
          return acc;
        }, [])
      },
      chats: {
        total: activeChats.length,
        porTenant: activeChats.reduce((acc, chat) => {
          const existing = acc.find(a => a.tenantId === chat.tenantId);
          if (existing) {
            existing.count++;
          } else {
            acc.push({ tenantId: chat.tenantId || 'super_admin', count: 1 });
          }
          return acc;
        }, [])
      },
      billing
    };

    cachedMetrics = metrics;
    cachedMetricsAt = Date.now();
    res.set('Cache-Control', 'private, max-age=10');
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const buildTelegramStatus = (telegram) => {
  const enabled = Boolean(telegram?.enabled);
  if (!enabled) {
    return { status: 'disabled', enabled };
  }

  const missing = [];
  if (!telegram?.botToken) missing.push('botToken');
  if (!telegram?.flowId) missing.push('flowId');
  if (!telegram?.usePolling && !telegram?.webhookUrl) missing.push('webhookUrl');

  return {
    status: missing.length ? 'misconfigured' : 'ok',
    enabled,
    missing,
    updatedAt: telegram?.updatedAt || null
  };
};

const buildWhatsAppStatus = (whatsapp) => {
  const enabled = Boolean(whatsapp?.enabled);
  if (!enabled) {
    return { status: 'disabled', enabled };
  }

  const missing = [];
  if (!whatsapp?.accessToken) missing.push('accessToken');
  if (!whatsapp?.phoneNumberId && !(Array.isArray(whatsapp?.senderNumbers) && whatsapp.senderNumbers.length > 0)) {
    missing.push('phoneNumberId');
  }
  if (!whatsapp?.flowId) missing.push('flowId');
  if (!whatsapp?.webhookVerifyToken) missing.push('webhookVerifyToken');

  return {
    status: missing.length ? 'misconfigured' : 'ok',
    enabled,
    missing,
    updatedAt: whatsapp?.updatedAt || null
  };
};

router.get('/monitoring', authenticate, authorize(['SUPER_ADMIN']), requireSuperAdminPermission(['superadmin:monitor']), async (req, res) => {
  try {
    if (cachedMonitoring && Date.now() - cachedMonitoringAt < MONITOR_CACHE_TTL_MS) {
      res.set('Cache-Control', 'private, max-age=5');
      return res.json(cachedMonitoring);
    }

    const [tenants, channelConfigs, queues, storedChats] = await Promise.all([
      adapter.findMany('tenants', {
        projection: { _id: 0, id: 1, name: 1 }
      }),
      adapter.findMany('channelConfigs', {
        projection: { _id: 0, tenantId: 1, telegram: 1, whatsapp: 1 }
      }),
      adapter.findMany('queues', {
        projection: { _id: 0, id: 1 }
      }),
      adapter.findMany('activeChats', {
        projection: { _id: 0, status: 1, channel: 1 }
      })
    ]);

    let dbStatus = { ok: false, error: null };
    try {
      if (!adapter.db) await adapter.init();
      await adapter.db.collection('tenants').findOne({}, { projection: { _id: 1 } });
      dbStatus = { ok: true, error: null };
    } catch (err) {
      dbStatus = { ok: false, error: err?.message || 'db_error' };
    }

    const chatList = (Array.isArray(storedChats) ? storedChats : []).filter(isOperationalChat);
    const waitingChats = chatList.filter(c => c.status === 'waiting').length;
    const chatsByChannel = chatList.reduce((acc, chat) => {
      const key = chat.channel || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const configByTenant = new Map(
      (channelConfigs || []).map(cfg => [cfg.tenantId, cfg])
    );

    const channelTenants = (tenants || []).map((tenant) => {
      const config = configByTenant.get(tenant.id) || {};
      const telegram = buildTelegramStatus(config.telegram);
      const whatsapp = buildWhatsAppStatus(config.whatsapp);
      const alerts = [];

      if (telegram.status === 'misconfigured') {
        alerts.push(`Telegram faltando: ${telegram.missing.join(', ')}`);
      }
      if (whatsapp.status === 'misconfigured') {
        alerts.push(`WhatsApp faltando: ${whatsapp.missing.join(', ')}`);
      }

      return {
        tenantId: tenant.id,
        name: tenant.name,
        telegram,
        whatsapp,
        alerts
      };
    });

    const payload = {
      timestamp: new Date().toISOString(),
      server: {
        uptimeSec: Math.round(process.uptime()),
        memory: {
          rss: process.memoryUsage().rss,
          heapUsed: process.memoryUsage().heapUsed,
          heapTotal: process.memoryUsage().heapTotal
        }
      },
      database: dbStatus,
      queues: {
        totalQueues: Array.isArray(queues) ? queues.length : 0,
        waitingChats,
        activeChats: chatList.length,
        chatsByChannel
      },
      channels: {
        tenants: channelTenants
      }
    };

    cachedMonitoring = payload;
    cachedMonitoringAt = Date.now();
    res.set('Cache-Control', 'private, max-age=5');
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const buildMetricsSummary = (metrics) => {
  const values = (metrics || []).map((m) => Number(m.value)).filter((v) => Number.isFinite(v));
  if (!values.length) {
    return { count: 0, avg: null, p75: null, p95: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((acc, v) => acc + v, 0);
  const p75 = sorted[Math.floor((sorted.length - 1) * 0.75)];
  const p95 = sorted[Math.floor((sorted.length - 1) * 0.95)];
  return {
    count: values.length,
    avg: Number((sum / values.length).toFixed(2)),
    p75: Number(p75.toFixed(2)),
    p95: Number(p95.toFixed(2))
  };
};

router.get('/web-vitals', authenticate, authorize(['SUPER_ADMIN']), requireSuperAdminPermission(['superadmin:monitor']), async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days || '7', 10) || 7, 1), 30);
    const cacheKey = String(days);
    const cachedEntry = cachedWebVitals.get(cacheKey);
    if (cachedEntry && Date.now() - cachedEntry.at < WEB_VITALS_CACHE_TTL_MS) {
      res.set('Cache-Control', 'private, max-age=30');
      return res.json(cachedEntry.payload);
    }
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const sinceIso = new Date(since).toISOString();

    const filtered = await adapter.findMany('webVitals', {
      query: { timestamp: { $gte: sinceIso } },
      projection: {
        _id: 0,
        timestamp: 1,
        name: 1,
        value: 1,
        rating: 1,
        delta: 1,
        navigationType: 1,
        page: 1,
        userId: 1,
        tenantId: 1
      }
    });

    const byMetric = filtered.reduce((acc, m) => {
      const key = m.name || 'unknown';
      if (!acc[key]) acc[key] = [];
      acc[key].push(m);
      return acc;
    }, {});

    const summary = Object.entries(byMetric).reduce((acc, [name, list]) => {
      acc[name] = buildMetricsSummary(list);
      return acc;
    }, {});

    const byPage = filtered.reduce((acc, m) => {
      const page = m.page || '/';
      if (!acc[page]) acc[page] = [];
      acc[page].push(m);
      return acc;
    }, {});

    const pageSummary = Object.entries(byPage)
      .map(([page, list]) => {
        const group = list.reduce((acc, m) => {
          if (!acc[m.name]) acc[m.name] = [];
          acc[m.name].push(m);
          return acc;
        }, {});
        return {
          page,
          metrics: Object.entries(group).reduce((acc, [name, items]) => {
            acc[name] = buildMetricsSummary(items);
            return acc;
          }, {})
        };
      })
      .sort((a, b) => a.page.localeCompare(b.page));

    const payload = {
      days,
      totalSamples: filtered.length,
      summary,
      pages: pageSummary
    };

    cachedWebVitals.set(cacheKey, {
      at: Date.now(),
      payload
    });

    res.set('Cache-Control', 'private, max-age=30');
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/web-vitals/export', authenticate, authorize(['SUPER_ADMIN']), requireSuperAdminPermission(['superadmin:monitor']), async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days || '7', 10) || 7, 1), 30);
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const sinceIso = new Date(since).toISOString();

    const filtered = await adapter.findMany('webVitals', {
      query: { timestamp: { $gte: sinceIso } },
      projection: {
        _id: 0,
        timestamp: 1,
        name: 1,
        value: 1,
        rating: 1,
        delta: 1,
        navigationType: 1,
        page: 1,
        userId: 1,
        tenantId: 1
      }
    });

    const header = [
      'timestamp',
      'name',
      'value',
      'rating',
      'delta',
      'navigationType',
      'page',
      'userId',
      'tenantId'
    ];

    const rows = filtered.map((m) => [
      m.timestamp || '',
      m.name || '',
      m.value ?? '',
      m.rating || '',
      m.delta ?? '',
      m.navigationType || '',
      m.page || '',
      m.userId || '',
      m.tenantId || ''
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map((cell) => {
        const text = String(cell ?? '');
        if (text.includes(',') || text.includes('"') || text.includes('\n')) {
          return `"${text.replace(/"/g, '""')}"`;
        }
        return text;
      }).join(','))
      .join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=\"web-vitals-${days}d.csv\"`);
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/chats/close-all', destructiveLimiter, authenticate, authorize(['SUPER_ADMIN']), requireSuperAdminPermission(['superadmin:manage']), async (req, res) => {
  try {
    const tenantId = String(req.body?.tenantId || req.query?.tenantId || '').trim() || null;
    const query = {
      status: { $ne: 'closed' },
      ...(tenantId ? { tenantId } : {})
    };

    const chats = await adapter.findMany('activeChats', {
      query,
      projection: {
        _id: 0,
        id: 1,
        tenantId: 1,
        status: 1
      },
      limit: 20000
    });

    const operationalChats = (Array.isArray(chats) ? chats : []).filter(isOperationalChat);
    if (!operationalChats.length) {
      return res.json({
        success: true,
        silent: true,
        tenantId,
        matched: 0,
        closed: 0
      });
    }

    const nowIso = new Date().toISOString();
    const io = getIo();
    let closed = 0;
    const closedChatIds = [];
    const touchedTenantIds = new Set();

    for (const chatRef of operationalChats) {
      const current = await adapter.getDocument('activeChats', { id: chatRef.id });
      if (!current || !isOperationalChat(current)) continue;

      applyFlowRuntimeReset(current);
      current.status = 'closed';
      current.closedAt = nowIso;
      current.outreachPendingReply = false;
      current.resumePending = false;
      current.continueFlowAfterQueue = false;
      current.catalogContext = null;
      current.updatedAt = nowIso;

      await adapter.saveDocument('activeChats', current);
      closed += 1;
      closedChatIds.push(current.id);
      if (current.tenantId) {
        touchedTenantIds.add(current.tenantId);
        if (io) {
          io.to(`tenant:${current.tenantId}`).emit('chat_closed', { chatId: current.id });
        }
      }
    }

    cachedMonitoring = null;
    cachedMonitoringAt = 0;
    cachedMetrics = null;
    cachedMetricsAt = 0;

    await createLog(
      'SUPERADMIN_CHAT_BULK_CLOSE_SILENT',
      {
        tenantId: tenantId || null,
        matched: operationalChats.length,
        closed,
        touchedTenants: [...touchedTenantIds],
        chatIds: closedChatIds
      },
      req.user.id
    );

    return res.json({
      success: true,
      silent: true,
      tenantId,
      matched: operationalChats.length,
      closed,
      touchedTenants: [...touchedTenantIds]
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/external-token', destructiveLimiter, authenticate, authorize(['SUPER_ADMIN']), requireSuperAdminPermission(['superadmin:manage']), async (req, res) => {
  try {
    const tenantId = String(req.body?.tenantId || '').trim();
    const role = String(req.body?.role || '').trim().toUpperCase();
    const targetUserId = String(req.body?.targetUserId || req.body?.userId || '').trim();
    const requestedExpiration = String(req.body?.expiresIn || '').trim();
    const expiresIn = EXTERNAL_TOKEN_EXPIRATION_OPTIONS.includes(requestedExpiration)
      ? requestedExpiration
      : EXTERNAL_TOKEN_DEFAULT_EXPIRATION;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId obrigatorio' });
    }

    if (!targetUserId && !EXTERNAL_TOKEN_ROLES.includes(role)) {
      return res.status(400).json({ error: `role invalida. Use: ${EXTERNAL_TOKEN_ROLES.join(', ')}` });
    }

    if (!adapter.db) await adapter.init();
    const tenantsCollection = adapter.db.collection('tenants');
    const usersCollection = adapter.db.collection('users');

    const tenant = await tenantsCollection.findOne(
      { id: tenantId },
      { projection: { _id: 0, id: 1, name: 1 } }
    );
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant nao encontrado' });
    }

    let user = null;
    if (targetUserId) {
      user = await usersCollection.findOne(
        { id: targetUserId, tenantId },
        {
          projection: {
            _id: 0,
            id: 1,
            name: 1,
            username: 1,
            role: 1,
            tenantId: 1
          }
        }
      );
      if (!user) {
        return res.status(404).json({ error: 'Usuario informado nao encontrado nesse tenant' });
      }
      if (!EXTERNAL_TOKEN_ROLES.includes(String(user.role || '').toUpperCase())) {
        return res.status(400).json({ error: 'Somente ADMIN, MANAGER e AGENT podem receber token externo' });
      }
      if (role && role !== String(user.role || '').toUpperCase()) {
        return res.status(400).json({ error: `Usuario informado possui role ${user.role}, diferente da role solicitada ${role}` });
      }
    } else {
      user = await usersCollection.findOne(
        { tenantId, role },
        {
          projection: {
            _id: 0,
            id: 1,
            name: 1,
            username: 1,
            role: 1,
            tenantId: 1
          }
        }
      );
    }

    if (!user) {
      return res.status(404).json({
        error: `Nenhum usuario ${role} encontrado nesse tenant`,
        hint: 'Crie ao menos um usuario com esse role para gerar token'
      });
    }

    const generatedAt = new Date().toISOString();
    const token = jwt.sign(
      {
        userId: user.id,
        tenantId: user.tenantId,
        role: user.role,
        scope: 'external',
        generatedBy: req.user.id
      },
      JWT_SECRET_VALUE,
      { expiresIn }
    );

    await createLog(
      'SUPERADMIN_EXTERNAL_TOKEN_GENERATED',
      {
        tenantId: user.tenantId,
        tenantName: tenant.name || tenant.id,
        role: user.role,
        targetUserId: user.id,
        generatedBy: req.user.id,
        expiresIn
      },
      req.user.id
    );

    res.json({
      token,
      expiresIn,
      generatedAt,
      tenant,
      user
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/external-token/users', authenticate, authorize(['SUPER_ADMIN']), requireSuperAdminPermission(['superadmin:manage']), async (req, res) => {
  try {
    const tenantId = String(req.query?.tenantId || '').trim();
    const role = String(req.query?.role || '').trim().toUpperCase();

    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId obrigatorio' });
    }
    if (role && !EXTERNAL_TOKEN_ROLES.includes(role)) {
      return res.status(400).json({ error: `role invalida. Use: ${EXTERNAL_TOKEN_ROLES.join(', ')}` });
    }

    if (!adapter.db) await adapter.init();
    const usersCollection = adapter.db.collection('users');

    const query = {
      tenantId,
      role: role || { $in: EXTERNAL_TOKEN_ROLES }
    };
    const users = await usersCollection
      .find(query, {
        projection: {
          _id: 0,
          id: 1,
          name: 1,
          username: 1,
          role: 1,
          tenantId: 1,
          status: 1
        }
      })
      .sort({ name: 1, username: 1 })
      .limit(500)
      .toArray();

    return res.json({ items: users });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// --- IP allowlist management ---

const ALLOWLIST_PERMS = ['superadmin:manage'];
const MAX_TEMPORARY_HOURS = 168; // 7 days

router.get('/ip-allowlist', authenticate, authorize(['SUPER_ADMIN']), requireSuperAdminPermission(ALLOWLIST_PERMS), async (req, res) => {
  try {
    await purgeAllowlistExpired();
    const items = await listAllowlistEntries();
    res.json({
      items,
      requestIp: getClientIp(req)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/ip-allowlist', authenticate, authorize(['SUPER_ADMIN']), requireSuperAdminPermission(ALLOWLIST_PERMS), async (req, res) => {
  try {
    const ip = String(req.body?.ip || '').trim();
    const label = String(req.body?.label || '').trim();
    const expiresAt = req.body?.expiresAt || null;
    if (!ip) return res.status(400).json({ error: 'ip obrigatorio' });

    const entry = await createAllowlistEntry({
      ip,
      label,
      expiresAt,
      createdBy: req.user.id,
      source: 'manual'
    });
    await createLog('SUPERADMIN_IP_ALLOWLIST_CREATE', {
      entryId: entry.id,
      ip: entry.ip,
      expiresAt: entry.expiresAt
    }, req.user.id);
    res.status(201).json(entry);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.patch('/ip-allowlist/:id', authenticate, authorize(['SUPER_ADMIN']), requireSuperAdminPermission(ALLOWLIST_PERMS), async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (id.startsWith('bootstrap:')) {
      return res.status(400).json({ error: 'Entradas de bootstrap (env) não podem ser editadas pela API' });
    }
    const updated = await updateAllowlistEntry(id, {
      label: req.body?.label,
      expiresAt: req.body?.expiresAt
    });
    await createLog('SUPERADMIN_IP_ALLOWLIST_UPDATE', {
      entryId: id,
      changes: {
        label: req.body?.label ?? null,
        expiresAt: req.body?.expiresAt ?? null
      }
    }, req.user.id);
    res.json(updated);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.delete('/ip-allowlist/:id', authenticate, authorize(['SUPER_ADMIN']), requireSuperAdminPermission(ALLOWLIST_PERMS), async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (id.startsWith('bootstrap:')) {
      return res.status(400).json({ error: 'Entradas de bootstrap (env) não podem ser removidas pela API' });
    }
    const removed = await removeAllowlistEntry(id);
    if (!removed) return res.status(404).json({ error: 'Entrada não encontrada' });
    await createLog('SUPERADMIN_IP_ALLOWLIST_DELETE', { entryId: id }, req.user.id);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Auditoria de acessos guardados pelo middleware de IP.
router.get('/ip-allowlist/audit', authenticate, authorize(['SUPER_ADMIN']), requireSuperAdminPermission(ALLOWLIST_PERMS), async (req, res) => {
  try {
    await purgeOldAuditEntries().catch(() => {});
    const limit = Math.min(Math.max(parseInt(req.query.limit || '100', 10) || 100, 1), 500);
    const outcome = String(req.query.outcome || '').trim() || null;
    const userId = String(req.query.userId || '').trim() || null;
    const items = await listRecentAccessEvents({ limit, outcome, userId });
    res.json({ items, limit });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Janela temporária: libera um IP por N horas (padrão: o IP da request atual).
router.post('/ip-allowlist/temporary', authenticate, authorize(['SUPER_ADMIN']), requireSuperAdminPermission(ALLOWLIST_PERMS), async (req, res) => {
  try {
    const ip = String(req.body?.ip || getClientIp(req) || '').trim();
    if (!ip) return res.status(400).json({ error: 'Não foi possível determinar o IP' });
    const hoursRaw = Number(req.body?.hours);
    const hours = Number.isFinite(hoursRaw) && hoursRaw > 0
      ? Math.min(hoursRaw, MAX_TEMPORARY_HOURS)
      : 4;
    const expiresAt = new Date(Date.now() + hours * 3600_000).toISOString();
    const label = String(req.body?.label || `janela temporaria (${hours}h)`).slice(0, 200);

    const entry = await createAllowlistEntry({
      ip,
      label,
      expiresAt,
      createdBy: req.user.id,
      source: 'temporary'
    });
    await createLog('SUPERADMIN_IP_ALLOWLIST_TEMPORARY', {
      entryId: entry.id,
      ip: entry.ip,
      hours,
      expiresAt
    }, req.user.id);
    res.status(201).json(entry);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

export default router;
