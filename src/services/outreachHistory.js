import adapter from '../../db/DatabaseAdapter.js';
import { generateId } from '../utils/helpers.js';

const COLLECTION = 'contactOutreachHistory';

const ensureDb = async () => {
  if (!adapter.db) {
    await adapter.init();
  }
  return adapter.db;
};

const createId = () => generateId('outreach');

const normalizeStatus = (value) => {
  const status = String(value || '').trim().toLowerCase();
  if (!status) return 'pending';
  if (status === 'accepted') return 'sent';
  if (status === 'warning') return 'sent';
  if (status === 'failed') return 'failed';
  if (status === 'delivered') return 'delivered';
  if (status === 'read') return 'read';
  if (status === 'sent') return 'sent';
  return status;
};

const normalizeTimestamp = (value) => {
  if (!value) return new Date().toISOString();
  if (typeof value === 'number') {
    return new Date(value).toISOString();
  }

  const raw = String(value).trim();
  if (!raw) return new Date().toISOString();

  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    const ms = raw.length <= 10 ? numeric * 1000 : numeric;
    return new Date(ms).toISOString();
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
};

const appendStatusHistory = (record, entry) => {
  const history = Array.isArray(record.statusHistory) ? [...record.statusHistory] : [];
  const last = history[history.length - 1] || null;
  if (!last || last.status !== entry.status || last.at !== entry.at) {
    history.push(entry);
  }
  return history;
};

const updateContactSummary = async ({ tenantId, contactId, patch }) => {
  if (!tenantId || !contactId || !patch || typeof patch !== 'object') return;
  const db = await ensureDb();
  await db.collection('contacts').updateOne(
    { id: contactId, tenantId },
    {
      $set: {
        ...patch,
        updatedAt: new Date().toISOString()
      }
    }
  );
};

export const createOutreachRecord = async ({
  tenantId,
  contactId,
  chatId,
  channel = 'whatsapp',
  templateId = null,
  templateName = null,
  senderPhoneNumberId = null,
  senderLabel = null,
  to = null,
  previewText = null,
  providerMessageId = null,
  createdBy = null
}) => {
  const db = await ensureDb();
  const now = new Date().toISOString();
  const record = {
    id: createId(),
    tenantId,
    contactId,
    chatId,
    channel,
    kind: 'template',
    templateId,
    templateName,
    senderPhoneNumberId,
    senderLabel,
    to,
    previewText,
    providerMessageId,
    status: 'sent',
    statusHistory: [
      {
        status: 'sent',
        at: now,
        source: 'send'
      }
    ],
    lastStatusAt: now,
    lastError: null,
    createdBy,
    createdAt: now,
    updatedAt: now
  };

  await db.collection(COLLECTION).insertOne(record);
  await updateContactSummary({
    tenantId,
    contactId,
    patch: {
      lastOutreachId: record.id,
      lastOutreachStatus: 'sent',
      lastOutreachStatusAt: now,
      lastOutreachAt: now,
      lastTemplateId: templateId,
      lastTemplateName: templateName,
      lastPhoneUsed: to,
      lastContactAt: now,
      lastContactChannel: channel
    }
  });
  return record;
};

export const listOutreachHistory = async ({ tenantId, contactId = null, limit = 50 }) => {
  if (!tenantId) return [];
  const db = await ensureDb();
  const query = { tenantId };
  if (contactId) {
    query.contactId = contactId;
  }
  return db.collection(COLLECTION)
    .find(query)
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(Math.min(Math.max(Number(limit || 50) || 50, 1), 200))
    .toArray();
};

export const updateOutreachStatusByProviderMessageId = async ({
  providerMessageId,
  tenantId = null,
  status,
  timestamp = null,
  errors = null
}) => {
  if (!providerMessageId) return null;

  const db = await ensureDb();
  const query = { providerMessageId };
  if (tenantId) {
    query.tenantId = tenantId;
  }

  const existing = await db.collection(COLLECTION)
    .find(query)
    .sort({ createdAt: -1 })
    .limit(1)
    .toArray();

  const record = existing[0] || null;
  if (!record) return null;

  const normalizedStatus = normalizeStatus(status);
  const at = normalizeTimestamp(timestamp);
  const next = {
    ...record,
    status: normalizedStatus,
    statusHistory: appendStatusHistory(record, {
      status: normalizedStatus,
      at,
      source: 'webhook',
      errors: errors || null
    }),
    lastStatusAt: at,
    lastError: normalizedStatus === 'failed' ? (errors || null) : null,
    updatedAt: new Date().toISOString()
  };

  await db.collection(COLLECTION).updateOne(
    { id: record.id },
    {
      $set: {
        status: next.status,
        statusHistory: next.statusHistory,
        lastStatusAt: next.lastStatusAt,
        lastError: next.lastError,
        updatedAt: next.updatedAt
      }
    }
  );

  await updateContactSummary({
    tenantId: record.tenantId,
    contactId: record.contactId,
    patch: {
      lastOutreachId: record.id,
      lastOutreachStatus: next.status,
      lastOutreachStatusAt: next.lastStatusAt
    }
  });

  return next;
};
