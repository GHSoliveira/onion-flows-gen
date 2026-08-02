import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CalendarDays, Clock, Filter, History, MessageSquare, Search, UserRound, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiRequest } from '../services/api';
import ChatMessageContent from '../components/ChatMessageContent';
import ChatTimeline from '../components/ChatTimeline';
import { TableSkeleton } from '../components/LoadingSkeleton';

const initialFilters = {
  cpf: '',
  q: '',
  agentId: '',
  queue: '',
  channel: '',
  from: '',
  to: ''
};

const channels = [
  { value: '', label: 'Todos os canais' },
  { value: 'web', label: 'Web' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'whatsapp', label: 'WhatsApp' }
];

const normalizeHistoryResponse = async (response) => {
  const data = await response.json();
  if (Array.isArray(data)) {
    return { items: data, total: data.length, totalPages: 1, page: 1 };
  }
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    total: Number(data?.total || 0),
    totalPages: Number(data?.totalPages || 1),
    page: Number(data?.page || 1)
  };
};

const ChatHistory = () => {
  const { tenantId } = useParams();
  const [filters, setFilters] = useState(initialFilters);
  const [agents, setAgents] = useState([]);
  const [queues, setQueues] = useState([]);
  const [results, setResults] = useState([]);
  const [selectedChat, setSelectedChat] = useState(null);
  const [detailTab, setDetailTab] = useState('messages');
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [meta, setMeta] = useState({ total: 0, totalPages: 1, page: 1 });

  const currentTenantId = useMemo(() => {
    if (tenantId) return tenantId;
    try {
      const saved = localStorage.getItem('selectedTenant');
      const parsed = saved ? JSON.parse(saved) : null;
      if (parsed?.id && parsed.id !== 'super_admin') return parsed.id;
    } catch (error) {
      console.error('Erro ao ler tenant selecionado:', error);
    }
    return null;
  }, [tenantId]);

  useEffect(() => {
    const loadFilters = async () => {
      try {
        const [usersRes, queuesRes] = await Promise.all([
          currentTenantId ? apiRequest(`/tenants/${currentTenantId}/users`) : apiRequest('/users?limit=200&page=1'),
          apiRequest('/queues')
        ]);

        if (usersRes && usersRes.ok) {
          const usersData = await usersRes.json();
          const users = Array.isArray(usersData) ? usersData : (usersData?.items || []);
          setAgents(users.filter((user) => ['AGENT', 'MANAGER', 'ADMIN'].includes(user.role)));
        }

        if (queuesRes && queuesRes.ok) {
          const queuesData = await queuesRes.json();
          const queueList = Array.isArray(queuesData) ? queuesData : [];
          setQueues(currentTenantId ? queueList.filter((queue) => queue.tenantId === currentTenantId) : queueList);
        }
      } catch (error) {
        console.error(error);
        toast.error('Erro ao carregar filtros do histórico');
      }
    };

    loadFilters();
  }, [currentTenantId]);

  const updateFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const buildSearchParams = (page = 1) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      const trimmed = String(value || '').trim();
      if (trimmed) {
        params.set(key, trimmed);
      }
    });
    params.set('page', String(page));
    params.set('limit', '50');
    return params;
  };

  const hasAnyCriteria = () => (
    Object.values(filters).some((value) => String(value || '').trim() !== '')
  );

  const executeSearch = async (page = 1) => {
    if (!hasAnyCriteria()) {
      toast.error('Preencha pelo menos um filtro para pesquisar.');
      return;
    }

    setLoading(true);
    setHasSearched(true);
    setSelectedChat(null);

    try {
      const params = buildSearchParams(page);
      const res = await apiRequest(`/chats/history?${params.toString()}`);
      if (!res || !res.ok) {
        throw new Error('Falha ao carregar histórico');
      }

      const data = await normalizeHistoryResponse(res);
      setResults(data.items);
      setMeta({ total: data.total, totalPages: data.totalPages, page: data.page });
    } catch (error) {
      console.error(error);
      toast.error('Erro ao pesquisar histórico');
      setResults([]);
      setMeta({ total: 0, totalPages: 1, page: 1 });
    } finally {
      setLoading(false);
    }
  };

  const resetSearch = () => {
    setFilters(initialFilters);
    setHasSearched(false);
    setResults([]);
    setSelectedChat(null);
    setMeta({ total: 0, totalPages: 1, page: 1 });
  };

  const pageLabel = hasSearched
    ? `${meta.total} resultado(s)${meta.totalPages > 1 ? ` · página ${meta.page} de ${meta.totalPages}` : ''}`
    : 'Nenhum chat é carregado até você pesquisar.';

  return (
    <div className="p-3 sm:p-4 lg:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">
          <History size={22} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Histórico de Chats</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Pesquise atendimentos encerrados por CPF, nome, período, agente, fila ou canal.</p>
        </div>
      </div>

      <section className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
          <Filter size={16} />
          Filtros
        </div>

        <form
          className="p-4 sm:p-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            executeSearch(1);
          }}
        >
          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">CPF</span>
            <input
              value={filters.cpf}
              onChange={(event) => updateFilter('cpf', event.target.value)}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Somente números ou valor salvo"
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Nome ou texto</span>
            <input
              value={filters.q}
              onChange={(event) => updateFilter('q', event.target.value)}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Nome do cliente, mensagem, observação"
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Agente</span>
            <select
              value={filters.agentId}
              onChange={(event) => updateFilter('agentId', event.target.value)}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Todos os agentes</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Fila</span>
            <select
              value={filters.queue}
              onChange={(event) => updateFilter('queue', event.target.value)}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Todas as filas</option>
              {queues.map((queue) => (
                <option key={queue.id} value={queue.name}>{queue.name}</option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Canal</span>
            <select
              value={filters.channel}
              onChange={(event) => updateFilter('channel', event.target.value)}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
            >
              {channels.map((channel) => (
                <option key={channel.value || 'all'} value={channel.value}>{channel.label}</option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">De</span>
            <div className="relative">
              <CalendarDays size={16} className="absolute left-3 top-2.5 text-slate-400" />
              <input
                type="date"
                value={filters.from}
                onChange={(event) => updateFilter('from', event.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 pl-9 pr-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </label>

          <label className="space-y-1">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Até</span>
            <div className="relative">
              <CalendarDays size={16} className="absolute left-3 top-2.5 text-slate-400" />
              <input
                type="date"
                value={filters.to}
                onChange={(event) => updateFilter('to', event.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 pl-9 pr-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </label>

          <div className="md:col-span-2 xl:col-span-1 flex items-end gap-2">
            <button
              type="submit"
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 text-sm font-medium"
            >
              <Search size={16} />
              Pesquisar
            </button>
            <button
              type="button"
              onClick={resetSearch}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 dark:border-slate-600 px-4 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              <X size={16} />
              Limpar
            </button>
          </div>
        </form>
      </section>

      <section className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Resultados</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">{pageLabel}</p>
          </div>
        </div>

        {loading ? (
          <TableSkeleton rows={8} cols={6} />
        ) : !hasSearched ? (
          <div className="px-6 py-16 text-center text-sm text-slate-500 dark:text-slate-400">
            Defina os filtros e clique em pesquisar para carregar o histórico.
          </div>
        ) : results.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-slate-500 dark:text-slate-400">
            Nenhum chat encerrado encontrado com os filtros informados.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-sm text-left">
                <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Encerrado em</th>
                    <th className="px-4 py-3 font-medium">Cliente</th>
                    <th className="px-4 py-3 font-medium">CPF</th>
                    <th className="px-4 py-3 font-medium">Agente</th>
                    <th className="px-4 py-3 font-medium">Fila</th>
                    <th className="px-4 py-3 font-medium">Canal</th>
                    <th className="px-4 py-3 font-medium">Mensagens</th>
                    <th className="px-4 py-3 font-medium text-right">Detalhes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {results.map((chat) => (
                    <tr key={chat.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {new Date(chat.closedAt || chat.updatedAt || chat.createdAt || 0).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-slate-900 dark:text-white">
                        {chat.variables?.nome_cliente || chat.customerName || 'Não identificado'}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500 dark:text-slate-400">
                        {chat.customerCpf || chat.channelUserId || '-'}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {chat.agentName || 'Bot'}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {chat.queue || chat.transferredTo || '-'}
                      </td>
                      <td className="px-4 py-3 uppercase text-xs text-slate-500 dark:text-slate-400">
                        {chat.channel || 'web'}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {Array.isArray(chat.messages) ? chat.messages.length : 0}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => { setSelectedChat(chat); setDetailTab('messages'); }}
                          className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                        >
                          Ver chat
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {meta.totalPages > 1 && (
              <div className="px-4 sm:px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => executeSearch(Math.max(1, meta.page - 1))}
                  disabled={meta.page <= 1}
                  className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-200 disabled:opacity-40"
                >
                  Página anterior
                </button>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Página {meta.page} de {meta.totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => executeSearch(Math.min(meta.totalPages, meta.page + 1))}
                  disabled={meta.page >= meta.totalPages}
                  className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-200 disabled:opacity-40"
                >
                  Próxima página
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {selectedChat && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setSelectedChat(null)}>
          <div
            className="w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl flex flex-col"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                  {selectedChat.variables?.nome_cliente || selectedChat.customerName || 'Chat encerrado'}
                </h3>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1"><UserRound size={12} /> {selectedChat.agentName || 'Bot'}</span>
                  <span>{selectedChat.queue || selectedChat.transferredTo || 'Sem fila'}</span>
                  <span>{selectedChat.channel || 'web'}</span>
                  <span>{selectedChat.customerCpf || selectedChat.channelUserId || '-'}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedChat(null)}
                className="rounded-lg p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between gap-3">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Encerrado em {new Date(selectedChat.closedAt || selectedChat.updatedAt || selectedChat.createdAt || 0).toLocaleString()}
              </div>
              <div className="flex items-center gap-1 rounded-lg bg-slate-200/60 dark:bg-slate-800 p-1">
                <button
                  type="button"
                  onClick={() => setDetailTab('messages')}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    detailTab === 'messages'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  <MessageSquare size={14} />
                  Mensagens
                </button>
                <button
                  type="button"
                  onClick={() => setDetailTab('timeline')}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    detailTab === 'timeline'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  <Clock size={14} />
                  Linha do tempo
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto bg-slate-50/60 dark:bg-slate-950/40">
              {detailTab === 'timeline' ? (
                <ChatTimeline chatId={selectedChat.id} />
              ) : (
                <div className="p-5 space-y-3">
                  {(selectedChat.messages || []).length === 0 ? (
                    <div className="text-sm text-slate-500 dark:text-slate-400">Nenhuma mensagem registrada.</div>
                  ) : (
                    selectedChat.messages.map((message, index) => {
                      const sender = message.sender || 'system';
                      const bubbleClass = sender === 'agent'
                        ? 'bg-blue-600 text-white ml-auto'
                        : sender === 'system'
                          ? 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 mx-auto'
                          : 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white';

                      return (
                        <div key={message.id || `${sender}_${index}`} className={`max-w-[80%] rounded-2xl px-4 py-3 shadow-sm ${bubbleClass}`}>
                          <div className="text-[10px] uppercase tracking-wide opacity-70 mb-1">{sender}</div>
                          <div className="text-sm">
                            <ChatMessageContent message={message} />
                          </div>
                          <div className="mt-2 text-[10px] opacity-60">
                            {message.timestamp ? new Date(message.timestamp).toLocaleString() : ''}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatHistory;
