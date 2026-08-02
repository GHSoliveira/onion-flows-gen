import { useState, useEffect } from 'react';
import { apiRequest } from '../services/api';
import { Plus, Building2, Trash2, Edit, X, ArrowRight, Check, Smartphone } from 'lucide-react';
import toast from 'react-hot-toast';
import { SkeletonBox } from '../components/LoadingSkeleton';
import { useTenant } from '../context/TenantContext';
import { useDialog } from '../context/DialogContext';
import { useNavigate } from 'react-router-dom';

const PLAN_LABELS = {
  basic: 'Basic',
  pro: 'PRO',
  premium: 'Premium',
};

const PLAN_COLORS = {
  basic: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
  pro: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  premium: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
};

const PAYMENT_LABELS = { paid: 'Pago', open: 'Em aberto', overdue: 'Vencido' };
const PAYMENT_COLORS = {
  paid: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  open: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  overdue: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

const STATUS_LABELS = {
  active: 'Ativo',
  suspended: 'Suspenso',
  trial: 'Trial'
};

export default function AdminPanel() {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingTenant, setEditingTenant] = useState(null);
  const [accessingTenantId, setAccessingTenantId] = useState(null);
  const { switchTenant } = useTenant();
  const { confirm, prompt } = useDialog();
  const navigate = useNavigate();
  const emptyBilling = { cpfCnpj: '', phone: '', email: '', representative: '', dueDay: 10, paymentStatus: 'open' };
  const [form, setForm] = useState({
    name: '',
    slug: '',
    plan: 'basic',
    status: 'active',
    settings: { maxUsers: 5, maxFlows: 10, maxChatsPerDay: 100 },
    billing: emptyBilling,
  });

  useEffect(() => {
    fetchTenants();
  }, []);

  const fetchTenants = async () => {
    try {
      const res = await apiRequest('/tenants');
      if (res && res.ok) {
        const data = await res.json();
        setTenants(data);
      }
    } catch (error) {
      toast.error('Erro ao carregar tenants');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const method = editingTenant ? 'PUT' : 'POST';
      const url = editingTenant ? `/tenants/${editingTenant.id}` : '/tenants';

      const res = await apiRequest(url, {
        method,
        body: JSON.stringify(form)
      });

      if (res && res.ok) {
        toast.success(editingTenant ? 'Tenant atualizado!' : 'Tenant criado!');
        fetchTenants();
        closeModal();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Erro ao salvar');
      }
    } catch (error) {
      toast.error('Erro ao salvar tenant');
    }
  };

  const handleDelete = async (id) => {
    const tenant = tenants.find(t => t.id === id);
    const ok = await confirm({
      title: 'Excluir tenant',
      message: `Isso excluirá TODOS os dados do tenant "${tenant?.name || id}". Esta ação não pode ser desfeita.`,
      confirmText: 'Excluir tudo',
      type: 'danger',
    });
    if (!ok) return;
    const reason = await prompt({
      title: 'Motivo da remoção',
      message: `Informe o motivo da remoção do tenant "${tenant?.name || id}" (mín. 3 caracteres).`,
      placeholder: 'Ex.: Cancelamento solicitado pelo cliente',
      confirmText: 'Confirmar remoção',
      type: 'danger',
    });
    if (!reason || reason.trim().length < 3) {
      toast.error('Motivo obrigatório para remover tenant.');
      return;
    }

    const previousTenants = tenants;
    setTenants(prev => prev.filter(t => t.id !== id));

    try {
      const res = await apiRequest(`/tenants/${id}`, {
        method: 'DELETE',
        body: JSON.stringify({ confirm: true, reason: reason.trim() })
      });
      if (res && res.ok) {
        toast.success('Tenant removido!');
      } else {
        setTenants(previousTenants);
        toast.error('Erro ao remover');
      }
    } catch (error) {
      setTenants(previousTenants);
      toast.error('Erro ao remover tenant');
    }
  };

  const openModal = (tenant = null) => {
    if (tenant) {
      setEditingTenant(tenant);
      setForm({
        name: tenant.name,
        slug: tenant.slug,
        plan: tenant.plan || 'basic',
        status: tenant.status,
        settings: tenant.settings || { maxUsers: 5, maxFlows: 10, maxChatsPerDay: 100 },
        billing: tenant.billing || emptyBilling,
      });
    } else {
      setEditingTenant(null);
      setForm({
        name: '',
        slug: '',
        plan: 'basic',
        status: 'active',
        settings: { maxUsers: 5, maxFlows: 10, maxChatsPerDay: 100 },
        billing: emptyBilling,
      });
    }
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingTenant(null);
  };

  const handleAccessTenant = async (tenant) => {
    if (!tenant?.id) return;
    try {
      setAccessingTenantId(tenant.id);
      await switchTenant(tenant.id);
      navigate(`/tenant/${tenant.id}/monitor`);
    } catch (error) {
      toast.error('Erro ao acessar tenant');
    } finally {
      setAccessingTenantId(null);
    }
  };

  if (loading) {
    return (
      <div className="p-3 sm:p-4 lg:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div className="space-y-2">
            <SkeletonBox className="h-6 w-52" />
            <SkeletonBox className="h-4 w-64" />
          </div>
          <SkeletonBox className="h-10 w-full sm:w-40" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={`tenant_skel_${index}`}
              className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <SkeletonBox className="h-10 w-10 rounded-lg" />
                  <div className="space-y-2">
                    <SkeletonBox className="h-4 w-32" />
                    <SkeletonBox className="h-3 w-24" />
                  </div>
                </div>
                <SkeletonBox className="h-6 w-12" />
              </div>
              <div className="mt-4 flex gap-2">
                <SkeletonBox className="h-5 w-16 rounded-full" />
                <SkeletonBox className="h-5 w-20 rounded-full" />
              </div>
              <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700 grid grid-cols-3 gap-2">
                <SkeletonBox className="h-6" />
                <SkeletonBox className="h-6" />
                <SkeletonBox className="h-6" />
              </div>
              <div className="mt-3">
                <SkeletonBox className="h-3 w-32" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-4 lg:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white">
            Gerenciamento de Tenants
          </h1>
          <p className="text-slate-500 dark:text-slate-400">
            Configure tenants e planos
          </p>
        </div>
        <button
          onClick={() => openModal()}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors w-full sm:w-auto"
        >
          <Plus size={18} />
          Novo Tenant
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tenants.map((tenant) => (
          <div
            key={tenant.id}
            className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 hover:shadow-lg transition-shadow"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                  <Building2 className="text-blue-500" size={20} />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-800 dark:text-white">
                    {tenant.name}
                  </h3>
                  <p className="text-sm text-slate-500 truncate max-w-[200px]">{tenant.slug}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => openModal(tenant)}
                  className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded"
                >
                  <Edit size={16} className="text-slate-400" />
                </button>
                <button
                  onClick={() => handleDelete(tenant.id)}
                  className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded"
                >
                  <Trash2 size={16} className="text-red-400" />
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                tenant.status === 'active'
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  : tenant.status === 'trial'
                  ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                  : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
              }`}>
                {STATUS_LABELS[tenant.status]}
              </span>
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${PLAN_COLORS[tenant.plan] || PLAN_COLORS.basic}`}>
                {PLAN_LABELS[tenant.plan] || tenant.plan || 'Basic'}
              </span>
              {tenant.billing?.paymentStatus && (
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${PAYMENT_COLORS[tenant.billing.paymentStatus] || PAYMENT_COLORS.open}`}>
                  {PAYMENT_LABELS[tenant.billing.paymentStatus] || tenant.billing.paymentStatus}
                </span>
              )}
            </div>

            <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-lg font-semibold text-slate-800 dark:text-white">
                    {tenant.settings?.maxUsers || '-'}
                  </p>
                  <p className="text-xs text-slate-500">Usuários</p>
                </div>
                <div>
                  <p className="text-lg font-semibold text-slate-800 dark:text-white">
                    {tenant.settings?.maxFlows || '-'}
                  </p>
                  <p className="text-xs text-slate-500">Fluxos</p>
                </div>
                <div>
                  <p className="text-lg font-semibold text-slate-800 dark:text-white">
                    {tenant.settings?.maxChatsPerDay || '-'}
                  </p>
                  <p className="text-xs text-slate-500">Chats/dia</p>
                </div>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
              <span>Criado em {new Date(tenant.createdAt).toLocaleDateString('pt-BR')}</span>
              {tenant.billing?.dueDay && (
                <span>Vence dia {tenant.billing.dueDay}</span>
              )}
            </div>
            {tenant.billing?.representative && (
              <div className="mt-1 text-xs text-slate-400 truncate">Rep.: {tenant.billing.representative}</div>
            )}

            <div className="mt-4">
              <button
                type="button"
                onClick={() => handleAccessTenant(tenant)}
                disabled={accessingTenantId === tenant.id}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60 transition-colors text-sm font-semibold"
              >
                <ArrowRight size={16} />
                {accessingTenantId === tenant.id ? 'Acessando...' : 'Acessar tenant'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {tenants.length === 0 && (
        <div className="text-center py-10">
          <Building2 className="mx-auto h-12 w-12 text-slate-300" />
          <h3 className="mt-2 text-sm font-medium text-slate-900 dark:text-white">
            Nenhum tenant
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Comece criando um novo tenant
          </p>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl w-full max-w-md p-5 sm:p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-slate-800 dark:text-white">
                {editingTenant ? 'Editar Tenant' : 'Novo Tenant'}
              </h2>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Nome
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-700"
                  placeholder="Minha Empresa"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Slug
                </label>
                <input
                  type="text"
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-700"
                  placeholder="minha-empresa"
                  pattern="[a-z0-9-]+"
                  required
                />
                <p className="text-xs text-slate-400 mt-1">
                  Identificador único (letras minúsculas, números e hífens)
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Plano
                  </label>
                  <select
                    value={form.plan}
                    onChange={(e) => setForm({ ...form, plan: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-700"
                  >
                    <option value="basic">Basic</option>
                    <option value="pro">PRO</option>
                    <option value="premium">Premium</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Status
                  </label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-700"
                  >
                    <option value="active">Ativo</option>
                    <option value="suspended">Suspenso</option>
                    <option value="trial">Trial</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Max Users
                  </label>
                  <input
                    type="number"
                    value={form.settings.maxUsers}
                    onChange={(e) => setForm({ ...form, settings: { ...form.settings, maxUsers: parseInt(e.target.value) } })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-700"
                    min="1"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Max Flows
                  </label>
                  <input
                    type="number"
                    value={form.settings.maxFlows}
                    onChange={(e) => setForm({ ...form, settings: { ...form.settings, maxFlows: parseInt(e.target.value) } })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-700"
                    min="1"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Max Chats/dia
                  </label>
                  <input
                    type="number"
                    value={form.settings.maxChatsPerDay}
                    onChange={(e) => setForm({ ...form, settings: { ...form.settings, maxChatsPerDay: parseInt(e.target.value) } })}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-700"
                    min="1"
                  />
                </div>
              </div>

              {/* Recurso pago: atendimento ativo (outreach via template) */}
              <label className="flex items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.settings.activeOutreachEnabled === true}
                  onChange={(e) => setForm({ ...form, settings: { ...form.settings, activeOutreachEnabled: e.target.checked } })}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600"
                />
                <span className="text-sm text-slate-700 dark:text-slate-300">
                  <span className="font-medium">Atendimento ativo</span> — permite disparar templates de WhatsApp para clientes (recurso pago)
                </span>
              </label>

              {/* Billing section */}
              <div className="border-t border-slate-200 dark:border-slate-600 pt-4 space-y-3">
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Dados de Cobrança</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Representante</label>
                    <input
                      type="text"
                      value={form.billing.representative}
                      onChange={(e) => setForm({ ...form, billing: { ...form.billing, representative: e.target.value } })}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-700 text-sm"
                      placeholder="Nome completo"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">CPF / CNPJ</label>
                    <input
                      type="text"
                      value={form.billing.cpfCnpj}
                      onChange={(e) => setForm({ ...form, billing: { ...form.billing, cpfCnpj: e.target.value } })}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-700 text-sm"
                      placeholder="000.000.000-00"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Telefone de contato</label>
                    <input
                      type="text"
                      value={form.billing.phone}
                      onChange={(e) => setForm({ ...form, billing: { ...form.billing, phone: e.target.value } })}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-700 text-sm"
                      placeholder="(11) 99999-0000"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">E-mail de contato</label>
                    <input
                      type="email"
                      value={form.billing.email}
                      onChange={(e) => setForm({ ...form, billing: { ...form.billing, email: e.target.value } })}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-700 text-sm"
                      placeholder="financeiro@empresa.com"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Dia de vencimento</label>
                    <input
                      type="number"
                      min="1"
                      max="28"
                      value={form.billing.dueDay}
                      onChange={(e) => setForm({ ...form, billing: { ...form.billing, dueDay: parseInt(e.target.value) || 10 } })}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-700 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Status do pagamento</label>
                    <select
                      value={form.billing.paymentStatus}
                      onChange={(e) => setForm({ ...form, billing: { ...form.billing, paymentStatus: e.target.value } })}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg dark:bg-slate-700 text-sm"
                    >
                      <option value="paid">Pago</option>
                      <option value="open">Em aberto</option>
                      <option value="overdue">Vencido</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-4">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center justify-center gap-2"
                >
                  <Check size={18} />
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

