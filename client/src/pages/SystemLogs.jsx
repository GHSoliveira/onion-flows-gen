import { useState, useEffect, useRef } from 'react';
import { apiRequest } from '../services/api';
import { socketService } from '../services/socket';
import { ScrollText, Activity, ShieldCheck, Save, LogIn, ArrowRightLeft, MessageSquare, AlertCircle, Database } from 'lucide-react';
import toast from 'react-hot-toast';
import { TableSkeleton } from '../components/LoadingSkeleton';

const SystemLogs = () => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const PAGE_LIMIT = 200;
  const pageRef = useRef(1);
  const [collapsed, setCollapsed] = useState({
    Mensagens: true,
    'Banco de dados': true
  });

  const fetchLogs = async (targetPage = 1) => {
    try {
      setLoading(true);
      const res = await apiRequest(`/logs?page=${targetPage}&limit=${PAGE_LIMIT}`);
      if (res && res.ok) {
        const data = await res.json();
        const logArray = data.logs || (Array.isArray(data) ? data : []);
        const normalized = Array.isArray(logArray) ? logArray : [];
        normalized.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
        setLogs(normalized);
        setTotalPages(data.totalPages || 1);
        setPage(data.page || targetPage);
        pageRef.current = data.page || targetPage;
      } else {
        console.warn("Falha ao buscar logs:", res?.status);
      }
    } catch (err) {
      console.error("Erro logs:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs(1);

    const handleNewLog = (newLog) => {
      if (pageRef.current !== 1) return;
      setLogs(prev => [newLog, ...prev].slice(0, PAGE_LIMIT));
    };

    socketService.on('new_log', handleNewLog);

    return () => {
      socketService.off('new_log', handleNewLog);
    };
  }, []);

  const getLogConfig = (type) => {
    if (type && type.startsWith('DB_')) {
      return { color: 'text-cyan-300 bg-cyan-400/10 border-cyan-400/20', icon: Database, label: type };
    }
    switch (type) {
      case 'PUBLISH': return { color: 'text-green-400 bg-green-400/10 border-green-400/20', icon: ShieldCheck, label: 'PUBLICAÇÃO' };
      case 'SAVE': return { color: 'text-blue-400 bg-blue-400/10 border-blue-400/20', icon: Save, label: 'SALVAMENTO' };
      case 'LOGIN': return { color: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20', icon: LogIn, label: 'ACESSO' };
      case 'TRANSFER': return { color: 'text-purple-400 bg-purple-400/10 border-purple-400/20', icon: ArrowRightLeft, label: 'TRANSFERÊNCIA' };
      case 'CHAT_START': return { color: 'text-pink-400 bg-pink-400/10 border-pink-400/20', icon: MessageSquare, label: 'NOVO CHAT' };
      case 'ERROR': return { color: 'text-red-400 bg-red-400/10 border-red-400/20', icon: AlertCircle, label: 'ERRO' };
      default: return { color: 'text-gray-400 bg-gray-400/10 border-gray-400/20', icon: Activity, label: type || 'SISTEMA' };
    }
  };

  const groupLabel = (type) => {
    if (type.startsWith('FLOW')) return 'Fluxos';
    if (type.startsWith('CHAT_MESSAGE')) return 'Mensagens';
    if (type.startsWith('CHAT')) return 'Chats';
    if (type.startsWith('VARIABLE')) return 'Variáveis';
    if (type.startsWith('TEMPLATE')) return 'Templates';
    if (type.startsWith('QUEUE')) return 'Filas';
    if (type.startsWith('USER')) return 'Usuários';
    if (type.startsWith('DB_')) return 'Banco de dados';
    return 'Sistema';
  };

  const renderMessage = (message) => {
    const text = typeof message === 'object' ? JSON.stringify(message) : String(message || '');
    const isLong = text.length > 220;
    if (!isLong) return text;
    return (
      <details className="text-xs text-slate-400">
        <summary className="cursor-pointer text-slate-300">Ver payload completo</summary>
        <pre className="mt-2 whitespace-pre-wrap break-all text-[11px] text-slate-400">{text}</pre>
      </details>
    );
  };

  const grouped = logs.reduce((acc, log) => {
    const key = groupLabel(log.type || '');
    if (!acc[key]) acc[key] = [];
    acc[key].push(log);
    return acc;
  }, {});

  return (
    <main className="content min-h-screen bg-gray-50 dark:bg-gray-900 p-3 sm:p-4 lg:p-6 flex flex-col overflow-hidden">

      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-slate-200 dark:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300">
          <ScrollText size={24} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white leading-tight">Logs de Auditoria</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">Registro imutável de ações administrativas e operacionais.</p>
        </div>
      </div>

      <div className="flex-1 bg-[#0f172a] rounded-xl border border-slate-700 overflow-hidden flex flex-col shadow-lg">

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 sm:px-6 py-3 bg-[#1e293b] border-b border-slate-700">
          <div className="flex items-center gap-2">
            <Activity size={14} className="text-emerald-400 animate-pulse" />
            <span className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider">Live Stream</span>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono text-slate-500">
            <button
              onClick={() => fetchLogs(Math.max(1, page - 1))}
              disabled={page <= 1}
              className="px-2 py-1 rounded bg-slate-800/60 text-slate-400 disabled:opacity-40"
            >
              Prev
            </button>
            <span>Página {page} de {totalPages}</span>
            <button
              onClick={() => fetchLogs(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
              className="px-2 py-1 rounded bg-slate-800/60 text-slate-400 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {loading ? (
            <TableSkeleton rows={6} cols={3} />
          ) : logs.length === 0 ? (
            <div className="px-6 py-12 text-center text-slate-500 font-mono text-sm">Nenhum log encontrado.</div>
          ) : (
            Object.entries(grouped).map(([group, items]) => (
              <div key={group} className="border-b border-slate-800/50">
                <button
                  onClick={() => setCollapsed(prev => ({ ...prev, [group]: !prev[group] }))}
                  className="w-full flex items-center justify-between px-4 sm:px-6 py-3 text-xs font-mono text-slate-400 uppercase tracking-wider bg-[#0f172a] hover:bg-slate-800/30"
                >
                  <span>{group}</span>
                  <span>{collapsed[group] ? '+' : '-'}</span>
                </button>
                {!collapsed[group] && (
                  <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[720px]">
                    <thead className="bg-[#0f172a] sticky top-0 z-10 shadow-sm">
                      <tr>
                        <th className="px-6 py-3 text-xs font-mono font-semibold text-slate-500 w-48">TIMESTAMP</th>
                        <th className="px-6 py-3 text-xs font-mono font-semibold text-slate-500 w-48">TIPO</th>
                        <th className="px-6 py-3 text-xs font-mono font-semibold text-slate-500">MENSAGEM</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                      {items.map((log, index) => {
                        const config = getLogConfig(log.type);
                        const Icon = config.icon;
                        const rowKey = log.id || log._id || `${group}-${index}`;
                        return (
                          <tr key={rowKey} className="hover:bg-slate-800/30 transition-colors group">
                            <td className="px-6 py-3 text-xs font-mono text-slate-400 whitespace-nowrap group-hover:text-slate-300">
                              {log.timestamp ? new Date(log.timestamp).toLocaleString() : 'N/A'}
                            </td>
                            <td className="px-6 py-3">
                              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold font-mono border ${config.color}`}>
                                <Icon size={10} strokeWidth={3} />
                                {config.label}
                              </span>
                            </td>
                            <td className="px-6 py-3 text-sm font-mono text-slate-300 break-all">
                              {renderMessage(log.message)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  );
};

export default SystemLogs;

