import { useState, useEffect, useCallback } from 'react';
import { apiRequest } from '../services/api';
import toast from 'react-hot-toast';
import {
  CreditCard, Lock, Unlock, RefreshCw, Calendar, CheckCircle,
  AlertTriangle, XCircle, Clock, Building2, ShieldCheck
} from 'lucide-react';

const PLAN_LABEL = { basic: 'Basic', pro: 'PRO', premium: 'Premium' };
const PLAN_COLOR = {
  basic:   'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
  pro:     'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  premium: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
};

const PAYMENT_META = {
  paid:    { label: 'Pago',      color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',    Icon: CheckCircle },
  open:    { label: 'Em aberto', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400', Icon: Clock },
  overdue: { label: 'Vencido',   color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',            Icon: AlertTriangle },
};

const STATUS_META = {
  active:    { label: 'Ativo',    color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  trial:     { label: 'Trial',    color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
  suspended: { label: 'Suspenso', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
};

const GRACE_DAYS = 10;

const fmtDate   = (iso) => iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
const todayISO  = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => new Date().toISOString().slice(0, 7);

const calcDaysOverdue = (overdueAt) => {
  if (!overdueAt) return null;
  return Math.floor((Date.now() - new Date(overdueAt).getTime()) / 86_400_000);
};

const calcNextDueDate = (dueDay) => {
  if (!dueDay) return null;
  const now = new Date();
  const candidate = new Date(now.getFullYear(), now.getMonth(), dueDay);
  return candidate < now
    ? new Date(now.getFullYear(), now.getMonth() + 1, dueDay)
    : candidate;
};

const isTrustActive = (billing) => {
  if (!billing?.trustUnblockUntil) return false;
  return Date.now() <= new Date(billing.trustUnblockUntil).getTime();
};

export default function BillingManager() {
  const [tenants, setTenants]         = useState([]);
  const [loading, setLoading]         = useState(true);
  const [scanning, setScanning]       = useState(false);
  const [busy, setBusy]               = useState({});
  // trust-unblock picker: { tenantId, untilDate }
  const [trustPicker, setTrustPicker] = useState(null);

  const fetchTenants = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest('/tenants');
      if (res?.ok) setTenants(await res.json());
      else toast.error('Erro ao carregar tenants');
    } catch { toast.error('Erro ao carregar tenants'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchTenants(); }, [fetchTenants]);

  const setBusyFor = (id, val) => setBusy(prev => ({ ...prev, [id]: val }));

  const handleBlock = async (tenantId) => {
    setBusyFor(tenantId, 'block');
    try {
      const res = await apiRequest(`/tenants/${tenantId}/billing/block`, { method: 'POST' });
      if (res?.ok) { toast.success('Serviço bloqueado'); fetchTenants(); }
      else { const d = await res.json().catch(() => ({})); toast.error(d.error || 'Erro ao bloquear'); }
    } catch { toast.error('Erro ao bloquear'); }
    finally { setBusyFor(tenantId, null); }
  };

  const handleUnblock = async (tenantId) => {
    setBusyFor(tenantId, 'unblock');
    try {
      const res = await apiRequest(`/tenants/${tenantId}/billing/unblock`, { method: 'POST' });
      if (res?.ok) { toast.success('Serviço desbloqueado'); fetchTenants(); }
      else { const d = await res.json().catch(() => ({})); toast.error(d.error || 'Erro ao desbloquear'); }
    } catch { toast.error('Erro ao desbloquear'); }
    finally { setBusyFor(tenantId, null); }
  };

  const handlePaymentStatus = async (tenantId, tenant, nextStatus) => {
    setBusyFor(tenantId, 'payment');
    try {
      const billing = { ...(tenant.billing || {}), paymentStatus: nextStatus };
      const res = await apiRequest(`/tenants/${tenantId}`, {
        method: 'PUT',
        body: JSON.stringify({ billing }),
      });
      if (res?.ok) { toast.success('Status atualizado'); fetchTenants(); }
      else { const d = await res.json().catch(() => ({})); toast.error(d.error || 'Erro ao atualizar'); }
    } catch { toast.error('Erro ao atualizar status'); }
    finally { setBusyFor(tenantId, null); }
  };

  const handleTrustUnblock = async () => {
    if (!trustPicker) return;
    const { tenantId, untilDate } = trustPicker;
    if (!untilDate) { toast.error('Selecione uma data'); return; }
    if (untilDate <= todayISO()) { toast.error('A data deve ser posterior a hoje'); return; }

    setBusyFor(tenantId, 'trust');
    setTrustPicker(null);
    try {
      const res = await apiRequest(`/tenants/${tenantId}/billing/trust-unblock`, {
        method: 'POST',
        body: JSON.stringify({ untilDate }),
      });
      if (res?.ok) {
        toast.success('Desbloqueio de confiança aplicado');
        fetchTenants();
      } else {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || 'Erro ao aplicar desbloqueio de confiança');
      }
    } catch { toast.error('Erro ao aplicar desbloqueio de confiança'); }
    finally { setBusyFor(tenantId, null); }
  };

  const handleAutoScan = async () => {
    setScanning(true);
    try {
      const res = await apiRequest('/tenants/billing/auto-block-scan', { method: 'POST' });
      if (res?.ok) {
        const data = await res.json();
        const count = data.newlyBlocked?.length || 0;
        toast.success(count > 0 ? `${count} tenant(s) bloqueados automaticamente` : 'Nenhum novo bloqueio');
        fetchTenants();
      } else { const d = await res.json().catch(() => ({})); toast.error(d.error || 'Erro no scan'); }
    } catch { toast.error('Erro no scan'); }
    finally { setScanning(false); }
  };

  const blockedCount = tenants.filter(t => t.billing?.blocked || isTrustActive(t.billing) === false && t.billing?.blocked).length;
  const overdueCount = tenants.filter(t => t.billing?.paymentStatus === 'overdue').length;
  const paidCount    = tenants.filter(t => t.billing?.paymentStatus === 'paid').length;
  const trustedCount = tenants.filter(t => isTrustActive(t.billing)).length;

  return (
    <div className="p-3 sm:p-4 lg:p-6 max-w-7xl mx-auto space-y-6">
      {/* Trust unblock picker modal */}
      {trustPicker && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl w-full max-w-sm p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2">
              <ShieldCheck size={20} className="text-blue-500" />
              <h3 className="font-bold text-slate-800 dark:text-white">Desbloqueio de Confiança</h3>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              O serviço ficará desbloqueado até a data escolhida. Esta operação só pode ser usada <strong>uma vez por mês</strong>.
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Desbloquear até
              </label>
              <input
                type="date"
                min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}
                value={trustPicker.untilDate}
                onChange={e => setTrustPicker(prev => ({ ...prev, untilDate: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-700 dark:text-white text-sm"
              />
            </div>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setTrustPicker(null)}
                className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleTrustUnblock}
                disabled={!trustPicker.untilDate}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <CreditCard size={24} /> Billing Avançado
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
            Ciclos de cobrança, status de pagamento e bloqueio de serviços
          </p>
        </div>
        <button
          onClick={handleAutoScan}
          disabled={scanning}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 dark:bg-slate-700 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={16} className={scanning ? 'animate-spin' : ''} />
          {scanning ? 'Verificando...' : 'Scan Auto-bloqueio'}
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <SummaryCard label="Total de tenants" value={tenants.length}  color="slate"  />
        <SummaryCard label="Pagamentos em dia" value={paidCount}       color="green"  />
        <SummaryCard label="Vencidos"           value={overdueCount}   color="red"    />
        <SummaryCard label="Confiança ativa"    value={trustedCount}   color="blue"   />
      </div>

      {/* Tenant list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-36 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : tenants.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <Building2 size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Nenhum tenant cadastrado</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tenants.map(tenant => {
            const b             = tenant.billing || {};
            const isBlocked     = b.blocked === true;
            const trustActive   = isTrustActive(b);
            const canUseTrust   = b.trustUnblockUsedMonth !== thisMonth();
            const payMeta       = PAYMENT_META[b.paymentStatus] || PAYMENT_META.open;
            const PayIcon       = payMeta.Icon;
            const daysOverdue   = calcDaysOverdue(b.overdueAt);
            const nextDue       = calcNextDueDate(b.dueDay);
            const autoBlockIn   = (b.paymentStatus === 'overdue' && daysOverdue !== null && !trustActive)
              ? Math.max(0, GRACE_DAYS - daysOverdue)
              : null;
            const isBusy        = !!busy[tenant.id];

            return (
              <div
                key={tenant.id}
                className={`rounded-xl border p-4 transition-colors ${
                  trustActive
                    ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/10'
                    : isBlocked
                    ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/10'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
                }`}
              >
                {/* Row 1: name + badges */}
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <span className="font-semibold text-slate-800 dark:text-white">{tenant.name}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PLAN_COLOR[tenant.plan] || PLAN_COLOR.basic}`}>
                    {PLAN_LABEL[tenant.plan] || tenant.plan || 'Basic'}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_META[tenant.status]?.color || STATUS_META.active.color}`}>
                    {STATUS_META[tenant.status]?.label || tenant.status}
                  </span>
                  <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${payMeta.color}`}>
                    <PayIcon size={11} /> {payMeta.label}
                  </span>
                  {trustActive && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-blue-600 text-white">
                      <ShieldCheck size={10} /> CONFIANÇA até {fmtDate(b.trustUnblockUntil)}
                    </span>
                  )}
                  {isBlocked && !trustActive && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-red-600 text-white">
                      <Lock size={10} /> BLOQUEADO {b.blockReason === 'auto_overdue' ? '(auto)' : '(manual)'}
                    </span>
                  )}
                </div>

                {/* Row 2: info grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-slate-500 dark:text-slate-400 mb-4">
                  <div>
                    <p className="font-semibold text-slate-700 dark:text-slate-300 mb-0.5">Representante</p>
                    <p>{b.representative || '—'}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-700 dark:text-slate-300 mb-0.5">Ativação</p>
                    <p>{fmtDate(b.activatedAt || tenant.createdAt)}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-700 dark:text-slate-300 mb-0.5 flex items-center gap-1">
                      <Calendar size={11} /> Próximo vencimento
                    </p>
                    <p>{nextDue ? nextDue.toLocaleDateString('pt-BR') : b.dueDay ? `Dia ${b.dueDay}` : '—'}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-700 dark:text-slate-300 mb-0.5">Contato</p>
                    <p>{b.phone || b.email || '—'}</p>
                  </div>
                </div>

                {/* Trust unblock info */}
                {!canUseTrust && !trustActive && (
                  <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-lg px-3 py-2 mb-3">
                    <ShieldCheck size={13} />
                    Desbloqueio de confiança já utilizado este mês. Disponível em {new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toLocaleDateString('pt-BR')}.
                  </div>
                )}

                {/* Auto-block warning */}
                {autoBlockIn !== null && !isBlocked && (
                  <div className={`flex items-center gap-2 text-xs rounded-lg px-3 py-2 mb-3 ${autoBlockIn === 0 ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'}`}>
                    <AlertTriangle size={13} />
                    {autoBlockIn === 0
                      ? 'Bloqueio automático pendente — execute o scan para aplicar'
                      : `Bloqueio automático em ${autoBlockIn} dia(s) (${daysOverdue}/${GRACE_DAYS} dias de carência)`}
                  </div>
                )}

                {/* Blocked date */}
                {isBlocked && !trustActive && b.blockedAt && (
                  <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400 mb-3">
                    <XCircle size={13} /> Bloqueado em {fmtDate(b.blockedAt)}
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap gap-2">
                  {b.paymentStatus !== 'paid' && (
                    <button onClick={() => handlePaymentStatus(tenant.id, tenant, 'paid')} disabled={isBusy}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50 disabled:opacity-50 transition-colors">
                      <CheckCircle size={12} /> Marcar pago
                    </button>
                  )}
                  {b.paymentStatus !== 'overdue' && (
                    <button onClick={() => handlePaymentStatus(tenant.id, tenant, 'overdue')} disabled={isBusy}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50 disabled:opacity-50 transition-colors">
                      <AlertTriangle size={12} /> Marcar vencido
                    </button>
                  )}
                  {b.paymentStatus !== 'open' && (
                    <button onClick={() => handlePaymentStatus(tenant.id, tenant, 'open')} disabled={isBusy}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-yellow-100 text-yellow-700 hover:bg-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:hover:bg-yellow-900/50 disabled:opacity-50 transition-colors">
                      <Clock size={12} /> Em aberto
                    </button>
                  )}

                  <div className="ml-auto flex gap-2">
                    {/* Trust unblock (only when blocked or overdue, and quota available) */}
                    {(isBlocked || b.paymentStatus === 'overdue') && canUseTrust && !trustActive && (
                      <button
                        onClick={() => setTrustPicker({ tenantId: tenant.id, untilDate: '' })}
                        disabled={isBusy}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50 disabled:opacity-50 transition-colors"
                      >
                        <ShieldCheck size={12} /> Confiança até dia...
                      </button>
                    )}

                    {isBlocked && !trustActive ? (
                      <button onClick={() => handleUnblock(tenant.id)} disabled={isBusy}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
                        <Unlock size={12} /> {busy[tenant.id] === 'unblock' ? 'Desbloqueando...' : 'Desbloquear'}
                      </button>
                    ) : (
                      <button onClick={() => handleBlock(tenant.id)} disabled={isBusy}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors">
                        <Lock size={12} /> {busy[tenant.id] === 'block' ? 'Bloqueando...' : 'Bloquear'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, color }) {
  const colors = {
    slate: 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300',
    green: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400',
    red:   'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400',
    blue:  'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400',
  };
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs mt-1">{label}</p>
    </div>
  );
}
