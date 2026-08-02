import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiRequest } from '../services/api';
import { Bot, MessageSquare, Plus, Save, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTenant } from '../context/TenantContext';

const defaultTelegram = {
  enabled: false,
  botToken: '',
  flowId: '',
  usePolling: true,
  webhookUrl: '',
  webhookSecret: ''
};

const defaultWhatsApp = {
  enabled: false,
  accessToken: '',
  phoneNumberId: '',
  senderNumbers: [],
  wabaId: '',
  flowId: '',
  webhookVerifyToken: '',
  appSecret: ''
};

const createSenderNumberDraft = (overrides = {}) => ({
  id: `wa_sender_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`,
  label: '',
  displayNumber: '',
  phoneNumberId: '',
  isDefault: false,
  enabled: true,
  ...overrides
});

const normalizeSenderNumbers = (items = [], legacyPhoneNumberId = '') => {
  const list = Array.isArray(items) ? items : [];
  const next = list
    .map((item, index) => ({
      id: item.id || `wa_sender_${Date.now()}_${index}`,
      label: item.label || '',
      displayNumber: item.displayNumber || '',
      phoneNumberId: item.phoneNumberId || '',
      flowId: item.flowId || '',
      isDefault: Boolean(item.isDefault),
      enabled: item.enabled !== false
    }))
    .filter((item) => item.phoneNumberId);

  if (legacyPhoneNumberId && !next.some((item) => item.phoneNumberId === legacyPhoneNumberId)) {
    next.unshift(createSenderNumberDraft({
      label: 'Principal',
      phoneNumberId: legacyPhoneNumberId,
      isDefault: true
    }));
  }

  if (next.length > 0 && !next.some((item) => item.isDefault)) {
    next[0].isDefault = true;
  }

  return next.map((item, index, array) => ({
    ...item,
    isDefault: item.isDefault || (index === 0 && !array.some((entry) => entry.isDefault))
  }));
};

const Channels = () => {
  const { tenant, loading: tenantLoading } = useTenant();
  const { tenantId: routeTenantId } = useParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [telegram, setTelegram] = useState(defaultTelegram);
  const [whatsapp, setWhatsapp] = useState(defaultWhatsApp);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [agentVars, setAgentVars] = useState([]);
  const [newVar, setNewVar] = useState('');
  const [webhookResult, setWebhookResult] = useState(null);
  const [flows, setFlows] = useState([]);
  const [savingRoute, setSavingRoute] = useState(null);

  const tenantId = routeTenantId || (tenant && tenant.id !== 'super_admin' ? tenant.id : null);
  const baseEndpoint = tenantId ? `/channels?tenantId=${tenantId}` : '/channels';
  const saveEndpoint = tenantId ? `/channels/telegram?tenantId=${tenantId}` : '/channels/telegram';
  const saveWhatsAppEndpoint = tenantId ? `/channels/whatsapp?tenantId=${tenantId}` : '/channels/whatsapp';
  const flowRoutingEndpoint = tenantId ? `/channels/flow-routing?tenantId=${tenantId}` : '/channels/flow-routing';
  const settingsEndpoint = tenantId ? `/tenants/${tenantId}/settings` : null;
  const webhookEndpoint = tenantId ? `/channels/telegram/webhook?tenantId=${tenantId}` : '/channels/telegram/webhook';

  const applyChannelConfig = (data = {}) => {
    setTelegram({
      ...defaultTelegram,
      ...(data.telegram || {})
    });
    setWhatsapp({
      ...defaultWhatsApp,
      ...(data.whatsapp || {}),
      senderNumbers: normalizeSenderNumbers(data?.whatsapp?.senderNumbers, data?.whatsapp?.phoneNumberId || '')
    });
    const telegramUpdated = data?.telegram?.updatedAt ? new Date(data.telegram.updatedAt) : null;
    const whatsappUpdated = data?.whatsapp?.updatedAt ? new Date(data.whatsapp.updatedAt) : null;
    const latest = telegramUpdated && whatsappUpdated
      ? new Date(Math.max(telegramUpdated.getTime(), whatsappUpdated.getTime()))
      : (telegramUpdated || whatsappUpdated);
    setLastSavedAt(latest ? latest.toISOString() : null);
  };

  const loadConfig = async () => {
    try {
      setLoading(true);
      const res = await apiRequest(baseEndpoint);
      if (res && res.ok) {
        const data = await res.json();
        applyChannelConfig(data);
      }
      const flowsEndpoint = tenantId ? `/flows?limit=200&page=1&tenantId=${tenantId}` : '/flows?limit=200&page=1';
      const flowsRes = await apiRequest(flowsEndpoint);
      if (flowsRes && flowsRes.ok) {
        const flowsData = await flowsRes.json();
        setFlows(Array.isArray(flowsData) ? flowsData : (flowsData?.items || []));
      }
      if (settingsEndpoint) {
        const settingsRes = await apiRequest(settingsEndpoint);
        if (settingsRes && settingsRes.ok) {
          const settings = await settingsRes.json();
          setAgentVars(settings.agentViewVars || []);
        }
      }
    } catch (error) {
      console.error('Erro ao carregar canais:', error);
      toast.error('Falha ao carregar canais');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveFlowRoute = async ({ channel, flowId, sender = null }) => {
    if (!tenantId) {
      toast.error('Selecione um tenant antes de salvar.');
      return;
    }
    const routeKey = sender?.id ? `${channel}:${sender.id}` : channel;
    try {
      setSavingRoute(routeKey);
      const payload = {
        channel,
        flowId: flowId || ''
      };
      if (sender) {
        payload.senderId = sender.id;
        payload.senderPhoneNumberId = sender.phoneNumberId;
      }
      const res = await apiRequest(flowRoutingEndpoint, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      if (res && res.ok) {
        const data = await res.json();
        applyChannelConfig(data);
        toast.success('Roteamento atualizado');
      } else {
        const data = res ? await res.json().catch(() => ({})) : {};
        toast.error(data?.error || 'Falha ao salvar roteamento');
      }
    } catch (error) {
      console.error('Erro ao salvar roteamento:', error);
      toast.error('Falha ao salvar roteamento');
    } finally {
      setSavingRoute(null);
    }
  };

  useEffect(() => {
    if (tenantLoading && !routeTenantId) return;
    if (!tenantId) return;
    loadConfig();
  }, [tenantId, tenantLoading, routeTenantId]);

  const handleSave = async () => {
    try {
      setSaving(true);
      if (!tenantId) {
        toast.error('Selecione um tenant antes de salvar.');
        return;
      }
      const res = await apiRequest(saveEndpoint, {
        method: 'PUT',
        body: JSON.stringify(telegram)
      });
      if (res && res.ok) {
        const data = await res.json();
        setTelegram({
          ...defaultTelegram,
          ...(data.telegram || {})
        });
        setLastSavedAt(data?.telegram?.updatedAt || null);
        toast.success('Canal Telegram atualizado');
      } else {
        toast.error('Falha ao salvar');
      }
    } catch (error) {
      console.error('Erro ao salvar canais:', error);
      toast.error('Falha ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveWhatsApp = async () => {
    try {
      setSaving(true);
      if (!tenantId) {
        toast.error('Selecione um tenant antes de salvar.');
        return;
      }
      const res = await apiRequest(saveWhatsAppEndpoint, {
        method: 'PUT',
        body: JSON.stringify({
          ...whatsapp,
          senderNumbers: normalizeSenderNumbers(whatsapp.senderNumbers, whatsapp.phoneNumberId)
        })
      });
      if (res && res.ok) {
        const data = await res.json();
        setWhatsapp({
          ...defaultWhatsApp,
          ...(data.whatsapp || {}),
          senderNumbers: normalizeSenderNumbers(data?.whatsapp?.senderNumbers, data?.whatsapp?.phoneNumberId || '')
        });
        setLastSavedAt(data?.whatsapp?.updatedAt || null);
        toast.success('Canal WhatsApp atualizado');
      } else {
        toast.error('Falha ao salvar');
      }
    } catch (error) {
      console.error('Erro ao salvar WhatsApp:', error);
      toast.error('Falha ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const handleAddSenderNumber = () => {
    setWhatsapp((prev) => ({
      ...prev,
      senderNumbers: [...normalizeSenderNumbers(prev.senderNumbers, prev.phoneNumberId), createSenderNumberDraft({
        label: `Remetente ${normalizeSenderNumbers(prev.senderNumbers, prev.phoneNumberId).length + 1}`
      })]
    }));
  };

  const handleUpdateSenderNumber = (id, key, value) => {
    setWhatsapp((prev) => ({
      ...prev,
      phoneNumberId: (() => {
        const current = (Array.isArray(prev.senderNumbers) ? prev.senderNumbers : []).find((item) => item.id === id) || null;
        if (key === 'isDefault' && value) {
          return current?.phoneNumberId || prev.phoneNumberId;
        }
        if (key === 'phoneNumberId' && current?.isDefault) {
          return value;
        }
        return prev.phoneNumberId;
      })(),
      senderNumbers: (Array.isArray(prev.senderNumbers) ? prev.senderNumbers : []).map((item) => {
        if (item.id !== id) return item;
        if (key === 'isDefault' && value) {
          return { ...item, [key]: true };
        }
        return { ...item, [key]: value };
      }).map((item) => (
        key === 'isDefault' && value ? { ...item, isDefault: item.id === id } : item
      ))
    }));
  };

  const handleRemoveSenderNumber = (id) => {
    setWhatsapp((prev) => {
      const current = (Array.isArray(prev.senderNumbers) ? prev.senderNumbers : []);
      const removed = current.find((item) => item.id === id) || null;
      const next = current.filter((item) => item.id !== id);
      const fallbackPhoneNumberId = removed?.phoneNumberId === prev.phoneNumberId
        ? (next.find((item) => item.isDefault)?.phoneNumberId || next[0]?.phoneNumberId || '')
        : prev.phoneNumberId;
      return {
        ...prev,
        phoneNumberId: fallbackPhoneNumberId,
        senderNumbers: normalizeSenderNumbers(next, fallbackPhoneNumberId)
      };
    });
  };

  const handleAddVar = () => {
    const value = newVar.trim();
    if (!value) return;
    if (agentVars.includes(value)) {
      setNewVar('');
      return;
    }
    setAgentVars([...agentVars, value]);
    setNewVar('');
  };

  const handleRemoveVar = (value) => {
    setAgentVars(agentVars.filter((v) => v !== value));
  };

  const handleSaveSettings = async () => {
    if (!settingsEndpoint) {
      toast.error('Selecione um tenant antes de salvar.');
      return;
    }
    try {
      setSavingSettings(true);
      const res = await apiRequest(settingsEndpoint, {
        method: 'PUT',
        body: JSON.stringify({ agentViewVars: agentVars })
      });
      if (res && res.ok) {
        const settings = await res.json();
        setAgentVars(settings.agentViewVars || []);
        toast.success('Configuração salva');
      } else {
        toast.error('Falha ao salvar');
      }
    } catch (error) {
      console.error('Erro ao salvar configurações:', error);
      toast.error('Falha ao salvar');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleWebhook = async () => {
    if (!telegram.webhookUrl) {
      toast.error('Informe a Webhook URL.');
      return;
    }
    try {
      setSaving(true);
      const res = await apiRequest(webhookEndpoint, { method: 'POST' });
      if (res && res.ok) {
        const data = await res.json();
        setWebhookResult(data);
        toast.success('Webhook configurado');
      } else {
        toast.error('Falha ao configurar webhook');
      }
    } catch (error) {
      console.error(error);
      toast.error('Falha ao configurar webhook');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="content min-h-screen bg-gray-50 dark:bg-gray-900 p-3 sm:p-4 lg:p-6 flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg text-indigo-600 dark:text-indigo-400">
          <MessageSquare size={24} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white leading-tight">Canais de Atendimento</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">Configure bots e integrações por tenant.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 flex-1 min-h-0">
        <div className="lg:col-span-7 flex flex-col gap-6 overflow-y-auto lg:pr-2">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 sm:p-6 shadow-sm">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 pb-4 border-b border-gray-100 dark:border-gray-700">
                <div className="p-2 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg text-indigo-600 dark:text-indigo-400">
                  <MessageSquare size={18} />
                </div>
                <div className="flex-1">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Roteamento de fluxos</h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Troque o fluxo do canal sem reenviar tokens, secrets ou chaves da Meta.
                  </p>
                </div>
              </div>

              {loading ? (
                <div className="text-sm text-gray-400">Carregando...</div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 p-3">
                    <div className="md:col-span-4">
                      <div className="text-sm font-semibold text-gray-900 dark:text-white">Telegram</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">Fluxo usado pelo bot Telegram.</div>
                    </div>
                    <div className="md:col-span-6">
                      <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Fluxo</label>
                      <select
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm outline-none dark:text-white"
                        value={telegram.flowId || ''}
                        onChange={(event) => setTelegram({ ...telegram, flowId: event.target.value })}
                      >
                        <option value="">Padrao publicado</option>
                        {flows.map((flow) => (
                          <option key={flow.id} value={flow.id}>{flow.name || flow.id}</option>
                        ))}
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <button
                        type="button"
                        onClick={() => handleSaveFlowRoute({ channel: 'telegram', flowId: telegram.flowId })}
                        disabled={savingRoute === 'telegram'}
                        className="w-full px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                      >
                        {savingRoute === 'telegram' ? 'Salvando...' : 'Salvar'}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 p-3">
                    <div className="md:col-span-4">
                      <div className="text-sm font-semibold text-gray-900 dark:text-white">WhatsApp padrao</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">Fallback para numeros sem fluxo proprio.</div>
                    </div>
                    <div className="md:col-span-6">
                      <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Fluxo</label>
                      <select
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm outline-none dark:text-white"
                        value={whatsapp.flowId || ''}
                        onChange={(event) => setWhatsapp({ ...whatsapp, flowId: event.target.value })}
                      >
                        <option value="">Padrao publicado</option>
                        {flows.map((flow) => (
                          <option key={flow.id} value={flow.id}>{flow.name || flow.id}</option>
                        ))}
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <button
                        type="button"
                        onClick={() => handleSaveFlowRoute({ channel: 'whatsapp', flowId: whatsapp.flowId })}
                        disabled={savingRoute === 'whatsapp'}
                        className="w-full px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                      >
                        {savingRoute === 'whatsapp' ? 'Salvando...' : 'Salvar'}
                      </button>
                    </div>
                  </div>

                  {(Array.isArray(whatsapp.senderNumbers) ? whatsapp.senderNumbers : []).map((sender) => (
                    <div key={`route_${sender.id}`} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
                      <div className="md:col-span-4">
                        <div className="text-sm font-semibold text-gray-900 dark:text-white">{sender.label || 'Remetente WhatsApp'}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{sender.phoneNumberId || sender.displayNumber || 'Sem Phone Number ID'}</div>
                      </div>
                      <div className="md:col-span-6">
                        <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Fluxo deste numero</label>
                        <select
                          className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm outline-none dark:text-white"
                          value={sender.flowId || ''}
                          onChange={(event) => handleUpdateSenderNumber(sender.id, 'flowId', event.target.value)}
                        >
                          <option value="">Usar WhatsApp padrao</option>
                          {flows.map((flow) => (
                            <option key={flow.id} value={flow.id}>{flow.name || flow.id}</option>
                          ))}
                        </select>
                      </div>
                      <div className="md:col-span-2">
                        <button
                          type="button"
                          onClick={() => handleSaveFlowRoute({ channel: 'whatsapp', flowId: sender.flowId, sender })}
                          disabled={savingRoute === `whatsapp:${sender.id}`}
                          className="w-full px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                        >
                          {savingRoute === `whatsapp:${sender.id}` ? 'Salvando...' : 'Salvar'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 sm:p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6 pb-4 border-b border-gray-100 dark:border-gray-700">
              <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg text-blue-600 dark:text-blue-400">
                <Bot size={18} />
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Telegram</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">Token do BotFather e fluxo publicado.</p>
              </div>
              <label className="flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-300">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-blue-600"
                  checked={telegram.enabled}
                  onChange={(e) => setTelegram({ ...telegram, enabled: e.target.checked })}
                />
                Ativo
              </label>
            </div>

            {loading ? (
              <div className="text-sm text-gray-400">Carregando...</div>
            ) : (
              <div className="space-y-5">
                <div>
                  <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">Bot Token</label>
                  <input
                    type="password"
                    className="mt-2 w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    value={telegram.botToken || ''}
                    onChange={(e) => setTelegram({ ...telegram, botToken: e.target.value })}
                    placeholder="123456:ABC..."
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">Flow ID</label>
                    <input
                      className="mt-2 w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      value={telegram.flowId || ''}
                      onChange={(e) => setTelegram({ ...telegram, flowId: e.target.value })}
                      placeholder="flow_123..."
                    />
                  </div>
                  <div className="flex items-center gap-3 mt-6 md:mt-0">
                    <label className="flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-300">
                      <input
                        type="checkbox"
                        className="w-4 h-4 accent-blue-600"
                        checked={telegram.usePolling}
                        onChange={(e) => setTelegram({ ...telegram, usePolling: e.target.checked })}
                      />
                      Usar Polling
                    </label>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                      Webhook URL (opcional)
                    </label>
                    <input
                      className="mt-2 w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      value={telegram.webhookUrl || ''}
                      onChange={(e) => setTelegram({ ...telegram, webhookUrl: e.target.value })}
                      placeholder="https://..."
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                      Webhook Secret
                    </label>
                    <input
                      className="mt-2 w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      value={telegram.webhookSecret || ''}
                      onChange={(e) => setTelegram({ ...telegram, webhookSecret: e.target.value })}
                      placeholder="segredo opcional"
                    />
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <span className="text-[10px] text-gray-400">Webhook aplica no bot configurado acima.</span>
                  <button
                    type="button"
                    onClick={handleWebhook}
                    className="px-3 py-1.5 text-xs font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors"
                  >
                    Ativar Webhook
                  </button>
                </div>
                {webhookResult && (
                  <div className="text-[11px] text-gray-500">
                    {webhookResult.ok ? 'Webhook configurado.' : 'Falha ao configurar webhook.'}
                  </div>
                )}
              </div>
            )}

            <div className="mt-6 flex justify-end">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 w-full sm:w-auto justify-center"
              >
                <Save size={16} />
                {saving ? 'Salvando...' : 'Salvar Telegram'}
              </button>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 sm:p-6 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6 pb-4 border-b border-gray-100 dark:border-gray-700">
              <div className="p-2 bg-emerald-50 dark:bg-emerald-900/30 rounded-lg text-emerald-600 dark:text-emerald-400">
                <MessageSquare size={18} />
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">WhatsApp</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">Cloud API (mensagens inbound).</p>
              </div>
              <label className="flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-300">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-emerald-600"
                  checked={whatsapp.enabled}
                  onChange={(e) => setWhatsapp({ ...whatsapp, enabled: e.target.checked })}
                />
                Ativo
              </label>
            </div>

            {loading ? (
              <div className="text-sm text-gray-400">Carregando...</div>
            ) : (
              <div className="space-y-5">
                <div>
                  <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">Access Token</label>
                  <input
                    type="password"
                    className="mt-2 w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                    value={whatsapp.accessToken || ''}
                    onChange={(e) => setWhatsapp({ ...whatsapp, accessToken: e.target.value })}
                    placeholder="EAAG..."
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">Phone Number ID padrao</label>
                    <input
                      className="mt-2 w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                      value={whatsapp.phoneNumberId || ''}
                      onChange={(e) => setWhatsapp((prev) => {
                        const nextValue = e.target.value;
                        const senderNumbers = (Array.isArray(prev.senderNumbers) ? prev.senderNumbers : []).map((item) => (
                          item.isDefault ? { ...item, phoneNumberId: nextValue } : item
                        ));
                        return {
                          ...prev,
                          phoneNumberId: nextValue,
                          senderNumbers
                        };
                      })}
                      placeholder="1234567890"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">WABA ID (opcional)</label>
                    <input
                      className="mt-2 w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                      value={whatsapp.wabaId || ''}
                      onChange={(e) => setWhatsapp({ ...whatsapp, wabaId: e.target.value })}
                      placeholder="9876543210"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">Flow ID</label>
                  <input
                    className="mt-2 w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                    value={whatsapp.flowId || ''}
                    onChange={(e) => setWhatsapp({ ...whatsapp, flowId: e.target.value })}
                    placeholder="flow_123..."
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">Webhook Verify Token</label>
                    <input
                      className="mt-2 w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                      value={whatsapp.webhookVerifyToken || ''}
                      onChange={(e) => setWhatsapp({ ...whatsapp, webhookVerifyToken: e.target.value })}
                      placeholder="defina_no_meta"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">App Secret (opcional)</label>
                    <input
                      type="password"
                      className="mt-2 w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                      value={whatsapp.appSecret || ''}
                      onChange={(e) => setWhatsapp({ ...whatsapp, appSecret: e.target.value })}
                      placeholder="app_secret"
                    />
                  </div>
                </div>

                <div className="text-[11px] text-gray-500">
                  Configure o webhook no painel da Meta apontando para `/api/whatsapp/webhook?tenantId=...`.
                </div>

                <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 p-4 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Numeros remetentes</h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Cadastre varios Phone Number IDs para o atendimento ativo escolher o remetente.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleAddSenderNumber}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800 transition-colors"
                    >
                      <Plus size={14} /> Adicionar
                    </button>
                  </div>

                  <div className="space-y-3">
                    {(Array.isArray(whatsapp.senderNumbers) ? whatsapp.senderNumbers : []).length === 0 ? (
                      <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 px-4 py-4 text-xs text-gray-400">
                        Nenhum remetente adicional configurado. O numero padrao acima ainda sera usado.
                      </div>
                    ) : (
                      (Array.isArray(whatsapp.senderNumbers) ? whatsapp.senderNumbers : []).map((sender) => (
                        <div key={sender.id} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-3">
                          <div className="md:col-span-3">
                            <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Rotulo</label>
                            <input
                              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm outline-none dark:text-white"
                              value={sender.label || ''}
                              onChange={(event) => handleUpdateSenderNumber(sender.id, 'label', event.target.value)}
                              placeholder="Principal"
                            />
                          </div>
                          <div className="md:col-span-3">
                            <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Numero exibido</label>
                            <input
                              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm outline-none dark:text-white"
                              value={sender.displayNumber || ''}
                              onChange={(event) => handleUpdateSenderNumber(sender.id, 'displayNumber', event.target.value)}
                              placeholder="+55 11 99999-9999"
                            />
                          </div>
                          <div className="md:col-span-3">
                            <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Phone Number ID</label>
                            <input
                              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm outline-none dark:text-white"
                              value={sender.phoneNumberId || ''}
                              onChange={(event) => handleUpdateSenderNumber(sender.id, 'phoneNumberId', event.target.value)}
                              placeholder="1234567890"
                            />
                          </div>
                          <div className="md:col-span-3">
                            <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">Acoes</label>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => handleUpdateSenderNumber(sender.id, 'isDefault', true)}
                                className={`flex-1 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors ${
                                  sender.isDefault
                                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300'
                                    : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-900'
                                }`}
                              >
                                {sender.isDefault ? 'Padrao' : 'Tornar padrao'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemoveSenderNumber(sender.id)}
                                className="px-3 py-2 rounded-lg border border-red-200 dark:border-red-900/40 text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="mt-6 flex justify-end">
              <button
                onClick={handleSaveWhatsApp}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 w-full sm:w-auto justify-center"
              >
                <Save size={16} />
                {saving ? 'Salvando...' : 'Salvar WhatsApp'}
              </button>
            </div>
          </div>
        </div>

        <div className="lg:col-span-5 flex flex-col gap-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 sm:p-6 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Canais configurados</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-white">Telegram</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {telegram.enabled ? 'Ativo' : 'Inativo'} | {telegram.botToken ? 'Token definido' : 'Sem token'}
                  </div>
                </div>
                <span className={`text-xs font-semibold px-2 py-1 rounded-full ${telegram.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {telegram.enabled ? 'ON' : 'OFF'}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-white">WhatsApp</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {whatsapp.enabled ? 'Ativo' : 'Inativo'} | {whatsapp.phoneNumberId ? 'Número definido' : 'Sem número'}
                  </div>
                </div>
                <span className={`text-xs font-semibold px-2 py-1 rounded-full ${whatsapp.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {whatsapp.enabled ? 'ON' : 'OFF'}
                </span>
              </div>
              <div className="text-xs text-gray-400">
                Última atualização: {lastSavedAt ? new Date(lastSavedAt).toLocaleString('pt-BR') : '-'}
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 sm:p-6 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Variáveis no atendimento</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              Defina quais variáveis do fluxo serão exibidas para o agente.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:bg-gray-700 dark:text-white"
                value={newVar}
                onChange={(e) => setNewVar(e.target.value)}
                placeholder="Ex: cpf, nome_cliente, plano"
              />
              <button
                type="button"
                onClick={handleAddVar}
                className="px-3 py-2 rounded-lg bg-gray-900 text-white text-xs font-semibold w-full sm:w-auto"
              >
                Adicionar
              </button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {agentVars.length === 0 ? (
                <span className="text-xs text-gray-400">Sem variáveis configuradas.</span>
              ) : (
                agentVars.map((value) => (
                  <span key={value} className="inline-flex items-center gap-2 px-2 py-1 rounded-full bg-blue-50 text-blue-700 text-xs">
                    {value}
                    <button
                      type="button"
                      onClick={() => handleRemoveVar(value)}
                      className="text-blue-700 hover:text-blue-900"
                    >
                      ×
                    </button>
                  </span>
                ))
              )}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={handleSaveSettings}
                disabled={savingSettings}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 w-full sm:w-auto justify-center"
              >
                <Save size={16} />
                {savingSettings ? 'Salvando...' : 'Salvar Variáveis'}
              </button>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 sm:p-6 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Outros canais</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Estrutura pronta para adicionar Instagram e outros canais.
            </p>
            <div className="mt-4 text-xs text-gray-400">
              Em breve.
            </div>
          </div>
        </div>
      </div>
    </main>
  );
};

export default Channels;
