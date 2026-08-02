import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Activity,
  ArrowRightLeft,
  Bot,
  Clock,
  Download,
  Eye,
  Headset,
  History,
  MessageSquare,
  Search,
  Star,
  User,
  X,
  XCircle
} from 'lucide-react';
import toast from 'react-hot-toast';
import { apiRequest } from '../services/api';
import { socketService } from '../services/socket';
import { useAuth } from '../context/AuthContext';
import ChatMessageContent from '../components/ChatMessageContent';
import { SkeletonBox } from '../components/LoadingSkeleton';

const ADMIN_ROLES = ['AGENT', 'MANAGER', 'ADMIN'];

const getChatDisplayName = (chat) => (
  chat?.contactName
  || chat?.variables?.nome_cliente
  || chat?.vars?.nome_cliente
  || chat?.channelUserId
  || 'Visitante'
);

const getCurrentTenantId = (routeTenantId) => {
  if (routeTenantId) return routeTenantId;
  try {
    const saved = localStorage.getItem('selectedTenant');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.id && parsed.id !== 'super_admin') return parsed.id;
    }
    const userRaw = localStorage.getItem('user');
    if (userRaw) {
      const parsedUser = JSON.parse(userRaw);
      if (parsedUser?.tenantId) return parsedUser.tenantId;
    }
  } catch (error) {
    console.error(error);
  }
  return null;
};

const getCurrentUserRole = () => {
  try {
    const userRaw = localStorage.getItem('user');
    if (!userRaw) return null;
    const parsedUser = JSON.parse(userRaw);
    return String(parsedUser?.role || '').toUpperCase() || null;
  } catch (error) {
    console.error(error);
    return null;
  }
};

const buildScopedEndpoint = (routeTenantId, baseEndpoint) => {
  const currentTenantId = getCurrentTenantId(routeTenantId);
  if (baseEndpoint.startsWith('/chats/')) return baseEndpoint;
  if (currentTenantId && !baseEndpoint.includes('/tenants/')) {
    return `/tenants/${currentTenantId}${baseEndpoint}`;
  }
  return baseEndpoint;
};

const toDateInputValue = (date) => {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return '';
  return value.toISOString().slice(0, 10);
};

const defaultReportFrom = () => {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return toDateInputValue(date);
};

const MonitoringDashboard = () => {
  const { tenantId } = useParams();
  const { user } = useAuth();
  const isReadOnly = user?.role === 'MANAGER';
  const [data, setData] = useState({ chats: [], agents: [] });
  const [loading, setLoading] = useState(true);
  const [viewChat, setViewChatState] = useState(null);
  const [viewChatLoading, setViewChatLoading] = useState(false);
  const [transferChat, setTransferChat] = useState(null);
  const [historyChat, setHistoryChat] = useState(null);
  const [clientHistory, setClientHistory] = useState([]);
  const [targetQueue, setTargetQueue] = useState('');
  const [targetAgent, setTargetAgent] = useState('');
  const [forceCloseChat, setForceCloseChat] = useState(null);
  const [forceCloseSilent, setForceCloseSilent] = useState(false);
  const [filterQueue, setFilterQueue] = useState('ALL');
  const [filterAgent, setFilterAgent] = useState('ALL');
  const [searchClient, setSearchClient] = useState('');
  const [reportFrom, setReportFrom] = useState(defaultReportFrom);
  const [reportTo, setReportTo] = useState(() => toDateInputValue(new Date()));
  const [exportingReport, setExportingReport] = useState(false);
  const [queues, setQueues] = useState([]);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const viewChatRef = useRef(null);
  const chatEndRef = useRef(null);
  const realtimeRefreshTimeoutRef = useRef(null);
  const currentUserRole = getCurrentUserRole();
  const canUseSilentClose = ['ADMIN', 'SUPER_ADMIN'].includes(currentUserRole || '');

  const setViewChat = (chat) => {
    viewChatRef.current = chat;
    setViewChatState(chat);
  };

  const closeViewChat = () => {
    viewChatRef.current = null;
    setViewChatLoading(false);
    setViewChatState(null);
  };

  const loadChatDetails = async (chatId, withLoader = false) => {
    if (!chatId) return null;
    if (withLoader) setViewChatLoading(true);
    try {
      const res = await apiRequest(`/chats/${chatId}`);
      if (!res || !res.ok) return null;
      const fullChat = await res.json();
      if (viewChatRef.current?.id === chatId) {
        viewChatRef.current = fullChat;
        setViewChatState(fullChat);
      }
      return fullChat;
    } catch (error) {
      console.error(error);
      return null;
    } finally {
      if (withLoader) setViewChatLoading(false);
    }
  };

  const openViewChat = async (chatSummary) => {
    const initialChat = {
      ...chatSummary,
      messages: Array.isArray(chatSummary?.messages) ? chatSummary.messages : []
    };
    setViewChat(initialChat);
    await loadChatDetails(chatSummary?.id, true);
  };

  const fetchData = useCallback(async (withLoader = false) => {
    const currentTenantId = getCurrentTenantId(tenantId);
    if (withLoader) setLoading(true);

    try {
      if (currentTenantId) {
        const [chatsRes, usersRes, queuesRes] = await Promise.allSettled([
          apiRequest(`/tenants/${currentTenantId}/chats?summary=1`),
          apiRequest(`/tenants/${currentTenantId}/users`),
          apiRequest('/queues')
        ]);

        const chats = chatsRes.status === 'fulfilled' && chatsRes.value?.ok
          ? await chatsRes.value.json()
          : [];
        const users = usersRes.status === 'fulfilled' && usersRes.value?.ok
          ? await usersRes.value.json()
          : [];
        const queueData = queuesRes.status === 'fulfilled' && queuesRes.value?.ok
          ? await queuesRes.value.json()
          : [];

        setData({
          chats: Array.isArray(chats) ? chats : [],
          agents: (Array.isArray(users) ? users : []).filter((user) => ADMIN_ROLES.includes(user.role))
        });
        setQueues((Array.isArray(queueData) ? queueData : []).map((queue) => queue.name));

        if (viewChatRef.current?.id) {
          void loadChatDetails(viewChatRef.current.id, false);
        }
        return;
      }

      const [overviewRes, queuesRes] = await Promise.allSettled([
        apiRequest('/monitoring/overview'),
        apiRequest('/queues')
      ]);
      if (overviewRes.status === 'fulfilled' && overviewRes.value?.ok) {
        const json = await overviewRes.value.json();
        setData(json);
        const queueData = queuesRes.status === 'fulfilled' && queuesRes.value?.ok
          ? await queuesRes.value.json()
          : [];
        setQueues((Array.isArray(queueData) ? queueData : []).map((queue) => queue.name));

        if (viewChatRef.current?.id) {
          const updated = (Array.isArray(json?.chats) ? json.chats : []).find((chat) => chat.id === viewChatRef.current.id);
          if (updated) setViewChat(updated);
        }
      }
    } catch (error) {
      console.error(error);
    } finally {
      if (withLoader) setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchData(true);
    const interval = setInterval(() => {
      void fetchData(false);
    }, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return undefined;

    socketService.connect(token);
    const currentTenantId = getCurrentTenantId(tenantId);
    if (currentTenantId) {
      socketService.subscribeTenant(currentTenantId);
    }

    const scheduleRealtimeRefresh = () => {
      clearTimeout(realtimeRefreshTimeoutRef.current);
      realtimeRefreshTimeoutRef.current = setTimeout(() => {
        void fetchData(false);
      }, 750);
    };

    socketService.on('message', scheduleRealtimeRefresh);
    socketService.on('new_chat', scheduleRealtimeRefresh);
    socketService.on('queue_update', scheduleRealtimeRefresh);
    socketService.on('agent_assigned', scheduleRealtimeRefresh);
    socketService.on('chat_closed', scheduleRealtimeRefresh);

    return () => {
      clearTimeout(realtimeRefreshTimeoutRef.current);
      socketService.off('message', scheduleRealtimeRefresh);
      socketService.off('new_chat', scheduleRealtimeRefresh);
      socketService.off('queue_update', scheduleRealtimeRefresh);
      socketService.off('agent_assigned', scheduleRealtimeRefresh);
      socketService.off('chat_closed', scheduleRealtimeRefresh);
    };
  }, [fetchData]);

  useEffect(() => {
    if (viewChat) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [viewChat]);

  const loadHistory = async (cpf) => {
    if (!cpf || cpf === 'anonimo') {
      toast.error('Cliente sem CPF identificado.');
      return;
    }
    const res = await apiRequest(buildScopedEndpoint(tenantId, `/chats/history/${cpf}`));
    if (res?.ok) {
      setClientHistory(await res.json());
      setHistoryChat(cpf);
    }
  };

  const openForceCloseModal = (chat) => {
    setForceCloseChat(chat);
    setForceCloseSilent(false);
  };

  const handleForceClose = async () => {
    if (!forceCloseChat?.id) return;
    const payload = canUseSilentClose && forceCloseSilent ? { silent: true } : {};
    await apiRequest(buildScopedEndpoint(tenantId, `/chats/${forceCloseChat.id}/close`), {
      method: 'PUT',
      ...(Object.keys(payload).length ? { body: JSON.stringify(payload) } : {})
    });
    toast.success(forceCloseSilent ? 'Atendimento encerrado em modo silencioso' : 'Atendimento encerrado');
    setForceCloseChat(null);
    setForceCloseSilent(false);
  };

  const handleTransfer = async () => {
    if (!transferChat) return;
    await apiRequest(buildScopedEndpoint(tenantId, '/chats/transfer'), {
      method: 'POST',
      body: JSON.stringify({
        chatId: transferChat.id,
        queue: targetQueue || transferChat.queue,
        agentId: targetAgent || null,
        agentName: targetAgent ? data.agents.find((agent) => agent.id === targetAgent)?.name : null
      })
    });
    toast.success('Transferido');
    setTransferChat(null);
    setTargetQueue('');
    setTargetAgent('');
  };

  const handleExportReport = async () => {
    if (exportingReport) return;
    setExportingReport(true);
    try {
      const params = new URLSearchParams();
      const currentTenantId = getCurrentTenantId(tenantId);
      if (currentTenantId) params.set('tenantId', currentTenantId);
      if (reportFrom) params.set('from', reportFrom);
      if (reportTo) params.set('to', reportTo);
      if (filterQueue !== 'ALL') params.set('queue', filterQueue);
      if (filterAgent !== 'ALL') {
        const agent = (data.agents || []).find((item) => item.name === filterAgent || item.username === filterAgent);
        if (agent?.id) params.set('agentId', agent.id);
      }

      const res = await apiRequest(`/reports/export.zip?${params.toString()}`);
      if (!res?.ok) {
        const error = await res?.json().catch(() => null);
        throw new Error(error?.error || 'Falha ao exportar relatório');
      }

      const blob = await res.blob();
      const disposition = res.headers.get('content-disposition') || '';
      const filenameMatch = disposition.match(/filename="([^"]+)"/i);
      const filename = filenameMatch?.[1] || `relatorio_onion_${reportFrom || 'inicio'}_${reportTo || 'hoje'}.zip`;
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Relatorio exportado');
    } catch (error) {
      console.error(error);
      toast.error(error.message || 'Falha ao exportar relatorio');
    } finally {
      setExportingReport(false);
    }
  };

  const filteredChats = (Array.isArray(data.chats) ? data.chats : []).filter((chat) => {
    const queueMatch = filterQueue === 'ALL' || chat.queue === filterQueue;
    const agentMatch = filterAgent === 'ALL' || chat.agentName === filterAgent;
    const name = String(getChatDisplayName(chat) || '').toLowerCase();
    const cpf = String(chat.customerCpf || '');
    const search = searchClient.trim().toLowerCase();
    const searchMatch = !search || name.includes(search) || cpf.includes(search);
    return queueMatch && agentMatch && searchMatch;
  });

  const kpis = {
    total: (data.chats || []).length,
    inBot: (data.chats || []).filter((chat) => chat.status === 'bot').length,
    inQueue: (data.chats || []).filter((chat) => chat.status === 'waiting').length,
    inService: (data.chats || []).filter((chat) => chat.status === 'open' && chat.agentId).length
  };

  if (loading) {
    return (
      <main className="p-3 sm:p-4 lg:p-6 space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-2">
            <SkeletonBox className="h-6 w-48" />
            <SkeletonBox className="h-4 w-72" />
          </div>
          <SkeletonBox className="h-10 w-full lg:w-52" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={`metric_${index}`} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 space-y-3">
              <SkeletonBox className="h-4 w-24" />
              <SkeletonBox className="h-7 w-20" />
              <SkeletonBox className="h-3 w-28" />
            </div>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 space-y-3">
            <SkeletonBox className="h-4 w-32" />
            {Array.from({ length: 6 }).map((_, index) => (
              <SkeletonBox key={`chat_${index}`} className="h-10 w-full" />
            ))}
          </div>
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 space-y-3">
            <SkeletonBox className="h-4 w-28" />
            {Array.from({ length: 5 }).map((_, index) => (
              <SkeletonBox key={`agent_${index}`} className="h-10 w-full" />
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="p-3 sm:p-4 lg:p-6 max-w-400 mx-auto space-y-6 h-[calc(100vh-60px)] flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg text-blue-600 dark:text-blue-400">
            <Activity size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white leading-tight">Monitoramento Operacional</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">Visao em tempo real da operacao.</p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <input
            type="date"
            value={reportFrom}
            onChange={(event) => setReportFrom(event.target.value)}
            className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-xs text-gray-700 shadow-sm outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
            aria-label="Inicio do relatorio"
          />
          <input
            type="date"
            value={reportTo}
            onChange={(event) => setReportTo(event.target.value)}
            className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-xs text-gray-700 shadow-sm outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
            aria-label="Fim do relatorio"
          />
          <button
            type="button"
            onClick={handleExportReport}
            disabled={exportingReport}
            className="h-9 inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
          >
            <Download size={14} />
            {exportingReport ? 'Exportando...' : 'Exportar ZIP'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Ativos" value={kpis.total} icon={MessageSquare} color="text-gray-500" />
        <KPICard title="No Bot" value={kpis.inBot} icon={Bot} color="text-blue-500" />
        <KPICard title="Fila" value={kpis.inQueue} icon={Clock} color="text-orange-500" />
        <KPICard title="Humanos" value={kpis.inService} icon={Headset} color="text-green-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 flex-1 min-h-0">
        <div className="lg:col-span-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl flex flex-col overflow-hidden shadow-sm">
          <div className="p-4 border-b border-gray-200 dark:border-gray-700 font-semibold text-sm text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-800/50">
            EQUIPES & AGENTES
          </div>

          <div className="p-4 border-b border-gray-100 dark:border-gray-700 space-y-3">
            <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">Filas em Tempo Real</div>
            {queues.map((queueName) => {
              const count = (data.chats || []).filter((chat) => chat.queue === queueName).length;
              const waiting = (data.chats || []).filter((chat) => chat.queue === queueName && chat.status === 'waiting').length;
              return (
                <div key={queueName} className="flex justify-between items-center text-sm">
                  <span className="text-gray-600 dark:text-gray-300 truncate pr-2">{queueName}</span>
                  <div className="flex items-center gap-2">
                    <span className={`font-mono font-bold ${count > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400'}`}>{count}</span>
                    {waiting > 0 && (
                      <span className="text-xs text-orange-500 bg-orange-50 dark:bg-orange-900/20 px-1.5 rounded-full">
                        +{waiting}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="text-xs font-bold text-gray-400 uppercase tracking-wider sticky top-0 bg-white dark:bg-gray-800 pb-2">
              Agentes Online ({(data.agents || []).filter((agent) => agent.isOnline).length})
            </div>
            {(data.agents || []).map((agent) => (
              <button
                key={agent.id}
                className="flex justify-between items-center w-full text-left rounded-lg px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors cursor-pointer"
                onClick={() => setSelectedAgent(agent)}
              >
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-white">{agent.name}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {agent.role}
                    {agent.activeChats > 0 && (
                      <span className="ml-1.5 text-blue-500">&middot; {agent.activeChats} chat{agent.activeChats !== 1 ? 's' : ''}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {agent.activeChats > 0 && (
                    <span className="flex items-center gap-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400" title={`${agent.activeChats} cliente${agent.activeChats !== 1 ? 's' : ''}`}>
                      <User size={12} />
                      {agent.activeChats}
                    </span>
                  )}
                  <div
                    className={`w-2.5 h-2.5 rounded-full ring-2 ring-white dark:ring-gray-800 ${agent.isOnline ? 'bg-green-500' : 'bg-gray-300'}`}
                    title={agent.isOnline ? 'Online' : 'Offline'}
                  />
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-9 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl flex flex-col overflow-hidden shadow-sm">
          <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-gray-50 dark:bg-gray-800/50">
            <h3 className="font-semibold text-sm text-gray-700 dark:text-gray-200">PAINEL DE ATENDIMENTOS</h3>
            <div className="flex flex-wrap gap-2">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-gray-400" />
                <input
                  className="pl-9 pr-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none w-full sm:w-48"
                  placeholder="Buscar..."
                  value={searchClient}
                  onChange={(event) => setSearchClient(event.target.value)}
                />
              </div>
              <select
                className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 px-2 py-1.5 outline-none w-full sm:w-auto"
                value={filterQueue}
                onChange={(event) => setFilterQueue(event.target.value)}
              >
                <option value="ALL">Todas Filas</option>
                {queues.map((queueName) => (
                  <option key={queueName} value={queueName}>{queueName}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex-1 overflow-auto">
            <table className="w-full text-sm text-left min-w-[700px]">
              <thead className="text-xs text-gray-500 uppercase bg-gray-50 dark:bg-gray-700 sticky top-0">
                <tr>
                  <th className="px-6 py-3">Cliente</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Agente/Fila</th>
                  <th className="px-6 py-3 text-right">Acoes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {filteredChats.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="text-center py-12 text-gray-400">Nenhum atendimento encontrado.</td>
                  </tr>
                ) : (
                  filteredChats.map((chat) => (
                    <tr key={chat.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-medium text-gray-900 dark:text-white">{getChatDisplayName(chat)}</div>
                        <div className="text-xs text-gray-500 font-mono mt-0.5">
                          {chat.customerCpf !== 'anonimo' ? chat.customerCpf : 'Nao identificado'}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={chat.status} hasAgent={!!chat.agentId} />
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-gray-900 dark:text-white font-medium">{chat.queue || '-'}</div>
                        <div className="text-xs text-gray-500">{chat.agentName || 'Aguardando...'}</div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-1">
                          <ActionButton icon={Eye} onClick={() => openViewChat(chat)} title="Espionar" />
                          <ActionButton icon={History} onClick={() => loadHistory(chat.customerCpf)} title="Historico" />
                          {!isReadOnly && (
                            <>
                              <ActionButton icon={ArrowRightLeft} onClick={() => setTransferChat(chat)} title="Transferir" />
                              <ActionButton icon={XCircle} onClick={() => openForceCloseModal(chat)} title="Forcar fim" variant="danger" />
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {viewChat && (
        <Modal onClose={closeViewChat} title={`Monitorando: ${getChatDisplayName(viewChat)}`}>
          <div className="bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 flex-1 overflow-y-auto p-4 space-y-3 h-100">
            {viewChatLoading && (!Array.isArray(viewChat.messages) || viewChat.messages.length === 0) ? (
              <div className="h-full flex items-center justify-center text-sm text-gray-500 dark:text-gray-400">
                Carregando mensagens...
              </div>
            ) : (
              (Array.isArray(viewChat.messages) ? viewChat.messages : []).map((message, index) => (
                <div key={index} className={`flex ${message.sender === 'agent' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm shadow-sm ${message.sender === 'agent'
                      ? 'bg-blue-600 text-white rounded-br-sm'
                      : message.sender === 'system'
                        ? 'bg-gray-200 text-gray-600 text-xs mx-auto rounded-full px-3 py-1 shadow-none'
                        : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700 rounded-bl-sm'
                      }`}
                  >
                    {message.sender !== 'system' && (
                      <div className="text-[10px] font-bold opacity-70 mb-1 uppercase tracking-wide">
                        {message.sender === 'bot' ? 'Bot' : message.sender}
                      </div>
                    )}
                    <ChatMessageContent message={message} />
                  </div>
                </div>
              ))
            )}
            <div ref={chatEndRef} />
          </div>
          <div className="mt-4 text-center text-xs text-gray-400">
            <Eye size={12} className="inline mr-1" /> Modo espectador ativo
          </div>
        </Modal>
      )}

      {transferChat && (
        <Modal onClose={() => setTransferChat(null)} title="Transferir Atendimento">
          <div className="space-y-4">
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-sm text-blue-800 dark:text-blue-200 mb-4">
              Transferindo <strong>{getChatDisplayName(transferChat)}</strong> da fila <strong>{transferChat.queue || 'Bot'}</strong>.
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nova Fila</label>
              <select
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                onChange={(event) => {
                  setTargetQueue(event.target.value);
                  setTargetAgent('');
                }}
              >
                <option value="">Selecione...</option>
                {queues.map((queueName) => (
                  <option key={queueName} value={queueName}>{queueName}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Atribuir a Agente (Opcional)</label>
              <select
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                onChange={(event) => {
                  setTargetAgent(event.target.value);
                  setTargetQueue('');
                }}
              >
                <option value="">Nenhum</option>
                {(data.agents || []).map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name} ({agent.isOnline ? 'ON' : 'OFF'})</option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setTransferChat(null)} className="px-4 py-2 border rounded-lg text-gray-600 hover:bg-gray-50">Cancelar</button>
              <button onClick={handleTransfer} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Confirmar</button>
            </div>
          </div>
        </Modal>
      )}

      {forceCloseChat && (
        <Modal onClose={() => setForceCloseChat(null)} title="Encerrar Atendimento">
          <div className="space-y-4">
            <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-sm text-red-800 dark:text-red-200 mb-2">
              Encerrar atendimento de <strong>{getChatDisplayName(forceCloseChat)}</strong>?
            </div>

            {canUseSilentClose ? (
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={forceCloseSilent}
                  onChange={(event) => setForceCloseSilent(event.target.checked)}
                  className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                />
                Encerramento silencioso (sem enviar mensagem ao cliente)
              </label>
            ) : null}

            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setForceCloseChat(null)} className="px-4 py-2 border rounded-lg text-gray-600 hover:bg-gray-50">Cancelar</button>
              <button onClick={handleForceClose} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">Confirmar</button>
            </div>
          </div>
        </Modal>
      )}

      {historyChat && (
        <Modal onClose={() => setHistoryChat(null)} title={`Historico: ${historyChat}`}>
          <div className="space-y-4 max-h-100 overflow-y-auto">
            {clientHistory.length === 0 ? (
              <div className="text-center py-8 text-gray-400">Nenhum historico anterior.</div>
            ) : (
              clientHistory.map((history) => (
                <div key={history.id} className="relative pl-6 pb-6 border-l-2 border-gray-200 dark:border-gray-700 last:pb-0 last:border-0">
                  <div className="absolute -left-2.25 top-0 w-4 h-4 rounded-full bg-gray-200 dark:bg-gray-600 border-2 border-white dark:border-gray-800" />
                  <div className="text-sm font-medium text-gray-900 dark:text-white">
                    {new Date(parseInt(history.id.split('_')[1], 10)).toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-500 mb-2">
                    Atendido por: {history.agentName || 'Bot'} em {history.queue || 'Fluxo'}
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded text-xs text-gray-600 dark:text-gray-300 border border-gray-100 dark:border-gray-700">
                    {Array.isArray(history.messages) ? history.messages.length : 0} mensagens trocadas.
                  </div>
                </div>
              ))
            )}
          </div>
        </Modal>
      )}

      {selectedAgent && (
        <AgentDetailModal
          agent={selectedAgent}
          chats={data.chats || []}
          onClose={() => setSelectedAgent(null)}
        />
      )}
    </div>
  );
};

const KPICard = ({ title, value, icon: Icon, color }) => (
  <div className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm flex items-center justify-between">
    <div>
      <div className="text-2xl font-bold text-gray-900 dark:text-white mb-1">{value}</div>
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{title}</div>
    </div>
    <div className={`p-3 rounded-lg bg-gray-50 dark:bg-gray-700 ${color}`}>
      <Icon size={24} />
    </div>
  </div>
);

const StatusBadge = ({ status }) => {
  if (status === 'bot') {
    return <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-200 dark:border-blue-800">Bot</span>;
  }
  if (status === 'waiting') {
    return <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 border border-orange-200 dark:border-orange-800">Fila</span>;
  }
  return <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border border-green-200 dark:border-green-800">Humano</span>;
};

const ActionButton = ({ icon: Icon, onClick, title, variant = 'default' }) => (
  <button
    onClick={onClick}
    title={title}
    className={`p-1.5 rounded-md transition-colors ${variant === 'danger'
      ? 'text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20'
      : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20'
      }`}
  >
    <Icon size={16} />
  </button>
);

const formatTimeSince = (isoDate) => {
  if (!isoDate) return 'Indisponivel';
  const diff = Date.now() - new Date(isoDate).getTime();
  if (diff < 0 || !Number.isFinite(diff)) return 'Indisponivel';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Agora';
  if (mins < 60) return `${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}min`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
};

const AgentDetailModal = ({ agent, chats, onClose }) => {
  const agentChats = (Array.isArray(chats) ? chats : []).filter((c) => c.agentId === agent.id && c.status !== 'closed');
  const rating = agent.ratingAvg || 0;
  const ratingCount = agent.ratingCount || 0;
  const lastSeenLabel = agent.isOnline ? 'Agora (online)' : formatTimeSince(agent.lastSeen);
  const agentQueues = Array.isArray(agent.queues) ? agent.queues : [];

  return (
    <Modal onClose={onClose} title="Detalhes do Agente">
      <div className="space-y-5">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white text-xl font-bold shadow-lg">
            {(agent.name || '?')[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-lg font-bold text-gray-900 dark:text-white truncate">{agent.name}</div>
            <div className="text-sm text-gray-500 dark:text-gray-400">@{agent.username}</div>
            <div className="flex items-center gap-2 mt-1">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                agent.isOnline
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${agent.isOnline ? 'bg-green-500' : 'bg-gray-400'}`} />
                {agent.isOnline ? 'Online' : 'Offline'}
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                {agent.role}
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 text-center">
            <MessageSquare size={16} className="mx-auto mb-1 text-blue-500" />
            <div className="text-lg font-bold text-gray-900 dark:text-white">{agentChats.length}</div>
            <div className="text-[10px] text-gray-500 uppercase font-semibold">Chats Ativos</div>
          </div>
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 text-center">
            <Star size={16} className="mx-auto mb-1 text-amber-500" />
            <div className="text-lg font-bold text-gray-900 dark:text-white">{rating > 0 ? rating.toFixed(1) : '-'}</div>
            <div className="text-[10px] text-gray-500 uppercase font-semibold">{ratingCount > 0 ? `${ratingCount} avaliac.` : 'Sem nota'}</div>
          </div>
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 text-center">
            <Clock size={16} className="mx-auto mb-1 text-green-500" />
            <div className="text-sm font-bold text-gray-900 dark:text-white mt-0.5">{lastSeenLabel}</div>
            <div className="text-[10px] text-gray-500 uppercase font-semibold">Ultima Atividade</div>
          </div>
        </div>

        {agentQueues.length > 0 && (
          <div>
            <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Filas Atribuidas</div>
            <div className="flex flex-wrap gap-1.5">
              {agentQueues.map((q) => (
                <span key={q} className="px-2.5 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs rounded-full font-medium">
                  {q}
                </span>
              ))}
            </div>
          </div>
        )}

        {agentChats.length > 0 && (
          <div>
            <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Clientes em Atendimento</div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {agentChats.map((chat) => (
                <div key={chat.id} className="flex items-center justify-between bg-gray-50 dark:bg-gray-700/50 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <User size={14} className="text-gray-400 shrink-0" />
                    <span className="text-sm text-gray-900 dark:text-white truncate">{getChatDisplayName(chat)}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-gray-500">{chat.queue || '-'}</span>
                    <StatusBadge status={chat.status} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

const Modal = ({ children, onClose, title }) => (
  <div className="ui-overlay-fade fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
    <div className="ui-modal-surface bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={(event) => event.stopPropagation()}>
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-800/50">
        <h3 className="font-semibold text-gray-900 dark:text-white">{title}</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
          <X size={20} />
        </button>
      </div>
      <div className="p-6">
        {children}
      </div>
    </div>
  </div>
);

export default MonitoringDashboard;
