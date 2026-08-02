/**
 * Upsert silencioso de identidade de contato a partir de webhook de canal.
 *
 * Chamado pelos handlers de WhatsApp/Telegram/Instagram quando uma mensagem
 * chega. Procura um contato existente naquele tenant que já tenha a identity
 * `(channel, normalizedIdentifier)`. Se achar, atualiza `channelDisplayName`
 * com o nome novo (se diferente) e `lastSeenAt`. Se não achar, cria um
 * contato mínimo com a identity como primária e `channelDisplayName` já
 * preenchido.
 *
 * Política: agentDefinedName nunca é tocado pelo provedor. Mudança de nome
 * no canal só atualiza channelDisplayName + timestamp. Falhas são best-effort
 * (log no console) — nunca propagam para o handler que está processando a
 * mensagem do cliente.
 */
import adapter from '../../db/DatabaseAdapter.js';
import {
  buildIdentity,
  normalizeIdentifier,
  normalizeIdentities,
  identitiesFromLegacyPhones,
  phonesFromIdentities,
  getContactDisplayName
} from '../utils/channelIdentity.js';
import { generateId } from '../utils/helpers.js';

const nowIso = () => new Date().toISOString();

const ensureCollection = async () => {
  if (!adapter.db) await adapter.init();
  return adapter.db.collection('contacts');
};

/**
 * Procura contato pelo identifier canônico. Retorna `null` quando não existe.
 */
export const findContactByIdentity = async ({ tenantId, channel, identifier }) => {
  if (!tenantId || !channel || !identifier) return null;
  const normalized = normalizeIdentifier(channel, identifier);
  if (!normalized) return null;
  const collection = await ensureCollection();
  return collection.findOne(
    {
      tenantId,
      channelIdentities: {
        $elemMatch: { channel: String(channel).toLowerCase(), normalizedIdentifier: normalized }
      }
    },
    { projection: { _id: 0 } }
  );
};

/**
 * Upsert silencioso. Cria contato se não existir, atualiza display name e
 * lastSeenAt se já existir. Retorna `{ contact, created, displayNameChanged }`.
 */
export const upsertContactFromChannel = async ({
  tenantId,
  channel,
  rawIdentifier,
  channelDisplayName = null,
  handle = null,
  channelMeta = {}
}) => {
  if (!tenantId) return null;
  const normalized = normalizeIdentifier(channel, rawIdentifier);
  if (!normalized) return null;

  try {
    const collection = await ensureCollection();
    const existing = await collection.findOne(
      {
        tenantId,
        channelIdentities: {
          $elemMatch: { channel: String(channel).toLowerCase(), normalizedIdentifier: normalized }
        }
      },
      { projection: { _id: 0 } }
    );

    if (existing) {
      const identities = Array.isArray(existing.channelIdentities) && existing.channelIdentities.length
        ? existing.channelIdentities
        : identitiesFromLegacyPhones(existing.phones || []);
      const target = identities.find(
        (entry) => entry.channel === String(channel).toLowerCase()
          && entry.normalizedIdentifier === normalized
      );
      let displayNameChanged = false;
      if (target) {
        target.lastSeenAt = nowIso();
        if (handle && !target.handle) target.handle = handle;
        if (channelMeta) target.channelMeta = { ...(target.channelMeta || {}), ...channelMeta };
        if (channelDisplayName && channelDisplayName !== target.channelDisplayName) {
          target.channelDisplayName = channelDisplayName;
          target.channelDisplayNameAt = nowIso();
          displayNameChanged = true;
        }
      }
      const normalizedList = normalizeIdentities(identities);
      const phones = phonesFromIdentities(normalizedList);
      const update = {
        channelIdentities: normalizedList,
        phones,
        updatedAt: nowIso()
      };
      if (!existing.agentDefinedName && existing.name) {
        update.agentDefinedName = existing.name;
      }
      await collection.updateOne({ id: existing.id }, { $set: update });
      return { contact: { ...existing, ...update }, created: false, displayNameChanged };
    }

    // Cria contato mínimo
    const identity = buildIdentity({
      channel,
      rawIdentifier,
      handle,
      displayName: channelDisplayName,
      channelMeta,
      isPrimary: true
    });
    if (!identity) return null;
    const identities = [identity];
    const phones = phonesFromIdentities(identities);
    const stub = {
      id: generateId('contact'),
      tenantId,
      agentDefinedName: null,
      name: getContactDisplayName({ channelIdentities: identities }),
      company: null,
      email: null,
      notes: null,
      tags: [],
      phones,
      channelIdentities: identities,
      primaryChannel: identity.channel,
      primaryIdentifier: identity.identifier,
      primaryPhone: phones[0]?.number || null,
      normalizedPrimaryPhone: phones[0]?.normalizedNumber || null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      createdBy: 'channel',
      autoCreated: true
    };
    await collection.insertOne(stub);
    return { contact: stub, created: true, displayNameChanged: false };
  } catch (error) {
    console.warn('[CONTACT_IDENTITY] Upsert falhou:', error?.message || error);
    return null;
  }
};
