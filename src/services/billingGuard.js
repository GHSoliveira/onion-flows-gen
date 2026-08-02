import adapter from '../../db/DatabaseAdapter.js';

const GRACE_DAYS = 10;

export const isBillingBlocked = (tenant) => {
  const billing = tenant?.billing;
  if (!billing) return false;

  // Trust unblock overrides everything
  if (billing.trustUnblockUntil) {
    const expiry = new Date(billing.trustUnblockUntil);
    if (!isNaN(expiry.getTime()) && Date.now() <= expiry.getTime()) return false;
  }

  if (billing.blocked === true) return true;

  if (billing.paymentStatus === 'overdue' && billing.overdueAt) {
    const daysOverdue = Math.floor(
      (Date.now() - new Date(billing.overdueAt).getTime()) / 86_400_000
    );
    if (daysOverdue >= GRACE_DAYS) return true;
  }

  return false;
};

export const applyBillingBlock = async (tenantId, blocked, reason = 'manual') => {
  if (!adapter.db) await adapter.init();
  const collection = adapter.db.collection('tenants');
  const tenant = await collection.findOne({ id: tenantId });
  if (!tenant) return null;

  const now = new Date().toISOString();
  const billing = {
    ...(tenant.billing || {}),
    blocked,
    blockedAt: blocked ? now : null,
    blockReason: blocked ? reason : null,
  };

  await collection.updateOne({ id: tenantId }, { $set: { billing, updatedAt: now } });
  return { ...tenant, billing };
};

export const runAutoBlockScan = async () => {
  if (!adapter.db) await adapter.init();
  const collection = adapter.db.collection('tenants');
  const tenants = await collection.find({}).toArray();
  const blocked = [];
  const now = new Date().toISOString();

  for (const tenant of tenants) {
    const billing = tenant.billing;
    if (!billing || billing.blocked) continue;
    if (billing.paymentStatus !== 'overdue' || !billing.overdueAt) continue;

    // Skip if trust unblock is still active
    if (billing.trustUnblockUntil) {
      const expiry = new Date(billing.trustUnblockUntil);
      if (!isNaN(expiry.getTime()) && Date.now() <= expiry.getTime()) continue;
    }

    const daysOverdue = Math.floor(
      (Date.now() - new Date(billing.overdueAt).getTime()) / 86_400_000
    );
    if (daysOverdue >= GRACE_DAYS) {
      await collection.updateOne(
        { id: tenant.id },
        { $set: { billing: { ...billing, blocked: true, blockedAt: now, blockReason: 'auto_overdue' }, updatedAt: now } }
      );
      blocked.push(tenant.id);
    }
  }

  return blocked;
};
