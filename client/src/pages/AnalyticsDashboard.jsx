import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Activity,
  AlarmClock,
  ArrowDownToLine,
  BarChart3,
  Bot,
  CalendarDays,
  CheckCircle2,
  Filter,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  UserCheck,
  Users
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { apiRequest } from '../services/api';
import { socketService } from '../services/socket';

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (days) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
};

const channels = [
  { value: '', label: 'Todos os canais' },
  { value: 'web', label: 'Web' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'whatsapp', label: 'WhatsApp' }
];

const formatNumber = (value) => {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('pt-BR').format(value);
};

const formatMinutes = (value) => {
  if (value === null || value === undefined) return '—';
  if (value < 1) return `${Math.round(value * 60)}s`;
  if (value < 60) return `${value.toFixed(1)} min`;
  const hours = Math.floor(value / 60);
  const minutes = Math.round(value % 60);
  return `${hours}h ${minutes}min`;
};

const formatPercent = (value) => {
  if (value === null || value === undefined) return '—';
  return `${(value * 100).toFixed(1)}%`;
};

const formatBucketLabel = (iso, bucket) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  if (bucket === 'day') {
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  }
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

const KPI_CARDS = [
  { key: 'entradas', label: 'Entradas', icon: ArrowDownToLine, tone: 'text-blue-600 dark:text-blue-300' },
  { key: 'atendidosHumano', label: 'Atendidos por humano', icon: UserCheck, tone: 'text-emerald-600 dark:text-emerald-300' },
  { key: 'resolvidosBot', label: 'Resolvidos pelo bot', icon: Bot, tone: 'text-slate-600 dark:text-slate-300' },
  { key: 'fechadosPorAgente', label: 'Fechados por agente', icon: CheckCircle2, tone: 'text-emerald-600 dark:text-emerald-300' },
  { key: 'fechadosPorInatividade', label: 'Fechados por inatividade', icon: AlarmClock, tone: 'text-rose-600 dark:text-rose-300' },
  { key: 'perdidosNaFila', label: 'Perdidos na fila', icon: TrendingDown, tone: 'text-rose-600 dark:text-rose-300' }
];

const buildParams = (filters) => {
  const params = new URLSearchParams();
  if (filters.from) params.set('from', `${filters.from}T00:00:00.000Z`);
  if (filters.to) params.set('to', `${filters.to}T23:59:59.999Z`);
  if (filters.channel) params.set('channel', filters.channel);
  if (filters.queue) params.set('queue', filters.queue);
  return params;
};

const BottleneckCard = ({ title, subtitle, rows, columns, empty }) => {
  const list = Array.isArray(rows) ? rows : [];
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-4 sm:px-5 py-3 border-b border-slate-200 dark:border-slate-700">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
        {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {list.length === 0 ? (
        <div className="px-5 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
          {empty || 'Sem dados.'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400">
              <tr>
                {columns.map((col) => (
                  <th key={col.key} className={`px-3 py-2 font-medium ${col.align === 'right' ? 'text-right' : 'text-left'}`}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {list.map((row, index) => (
                <tr key={row.id || row.agentId || row.queue || row.channel || row.nodeId || index} className="hover:bg-slate-50/60 dark:hover:bg-slate-700/30">
                  {columns.map((col) => {
                    const rawValue = row[col.key];
                    const display = col.format ? col.format(rawValue) : (rawValue ?? '—');
                    const isCritical = typeof col.critical === 'function' && col.critical(rawValue);
                    const baseClass = col.align === 'right' ? 'text-right whitespace-nowrap' : 'text-left';
                    const valueClass = isCritical
                      ? 'text-rose-600 dark:text-rose-300 font-semibold'
                      : 'text-slate-700 dark:text-slate-200';
                    return (
                      <td key={col.key} className={`px-3 py-2 ${baseClass} ${col.className || ''} ${valueClass}`}>
                        {display}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const AnalyticsDashboard = () => {
  const { tenantId } = useParams();
  const [filters, setFilters] = useState({
    from: daysAgo(7),
    to: today(),
    channel: '',
    queue: '',
    bucket: 'day'
  });
  const [overview, setOverview] = useState(null);
  const [timeseries, setTimeseries] = useState(null);
  const [funnel, setFunnel] = useState(null);
  const [bottlenecks, setBottlenecks] = useState(null);
  const [queues, setQueues] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [livePulse, setLivePulse] = useState(false);
  const refreshTimerRef = useRef(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const effectiveTenantId = useMemo(() => {
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
    const loadQueues = async () => {
      try {
        const response = await apiRequest('/queues');
        if (response && response.ok) {
          const data = await response.json();
          const list = Array.isArray(data) ? data : [];
          setQueues(effectiveTenantId ? list.filter((queue) => queue.tenantId === effectiveTenantId) : list);
        }
      } catch (error) {
        console.error('Erro ao carregar filas:', error);
      }
    };
    loadQueues();
  }, [effectiveTenantId]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const activeFilters = filtersRef.current;
      const params = buildParams(activeFilters).toString();
      const bucketParams = buildParams(activeFilters);
      bucketParams.set('bucket', activeFilters.bucket);

      const [overviewRes, timeseriesRes, funnelRes, bottlenecksRes] = await Promise.all([
        apiRequest(`/analytics/overview?${params}`),
        apiRequest(`/analytics/timeseries?${bucketParams.toString()}`),
        apiRequest(`/analytics/funnel?${params}`),
        apiRequest(`/analytics/bottlenecks?${params}`)
      ]);

      const overviewData = overviewRes?.ok ? await overviewRes.json() : null;
      const timeseriesData = timeseriesRes?.ok ? await timeseriesRes.json() : null;
      const funnelData = funnelRes?.ok ? await funnelRes.json() : null;
      const bottlenecksData = bottlenecksRes?.ok ? await bottlenecksRes.json() : null;

      setOverview(overviewData);
      setTimeseries(timeseriesData);
      setFunnel(funnelData);
      setBottlenecks(bottlenecksData);
      setLastUpdate(new Date());
    } catch (error) {
      console.error(error);
      toast.error('Erro ao carregar métricas');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    if (effectiveTenantId) {
      socketService.subscribeTenant(effectiveTenantId);
    }

    const scheduleRefresh = () => {
      setLivePulse(true);
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(() => {
        fetchAll();
        setLivePulse(false);
      }, 800);
    };

    socketService.on('chat_event', scheduleRefresh);
    socketService.on('new_chat', scheduleRefresh);
    socketService.on('chat_closed', scheduleRefresh);
    socketService.on('agent_assigned', scheduleRefresh);
    socketService.on('queue_update', scheduleRefresh);

    return () => {
      window.clearTimeout(refreshTimerRef.current);
      socketService.off('chat_event', scheduleRefresh);
      socketService.off('new_chat', scheduleRefresh);
      socketService.off('chat_closed', scheduleRefresh);
      socketService.off('agent_assigned', scheduleRefresh);
      socketService.off('queue_update', scheduleRefresh);
    };
  }, [effectiveTenantId, fetchAll]);

  const updateFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));

  const chartData = useMemo(() => {
    if (!timeseries?.points) return [];
    return timeseries.points.map((point) => ({
      ts: point.ts,
      label: formatBucketLabel(point.ts, timeseries.bucket),
      Entradas: point.entradas,
      Fechamentos: point.fechamentos,
      Fila: point.fila
    }));
  }, [timeseries]);

  const funnelData = useMemo(() => (funnel?.stages || []).map((stage) => ({
    name: stage.label,
    valor: stage.count
  })), [funnel]);

  return (
    <div className="p-3 sm:p-4 lg:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">
            <BarChart3 size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Analytics</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Entradas, perdas e fluxo dos atendimentos por período.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            livePulse
              ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${livePulse ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
            ao vivo
          </span>
          {lastUpdate && (
            <span>Atualizado às {lastUpdate.toLocaleTimeString()}</span>
          )}
          <button
            type="button"
            onClick={fetchAll}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Atualizar
          </button>
        </div>
      </div>

      <section className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
          <Filter size={16} />
          Filtros
        </div>
        <form
          className="p-4 sm:p-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            fetchAll();
          }}
        >
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
          <div className="flex items-end gap-2">
            <label className="flex-1 space-y-1">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Agrupamento</span>
              <select
                value={filters.bucket}
                onChange={(event) => updateFilter('bucket', event.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="hour">Por hora</option>
                <option value="day">Por dia</option>
              </select>
            </label>
            <button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 text-sm font-medium disabled:opacity-50"
            >
              Aplicar
            </button>
          </div>
        </form>
      </section>

      <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {KPI_CARDS.map(({ key, label, icon: Icon, tone }) => (
          <div key={key} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
              <Icon size={16} className={tone} />
            </div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white">
              {formatNumber(overview?.[key])}
            </div>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs text-slate-500 dark:text-slate-400">Em fila agora</span>
            <Users size={16} className="text-violet-600 dark:text-violet-300" />
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white">{formatNumber(overview?.emFila)}</div>
        </div>
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs text-slate-500 dark:text-slate-400">Em atendimento</span>
            <Activity size={16} className="text-blue-600 dark:text-blue-300" />
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white">{formatNumber(overview?.emAtendimento)}</div>
        </div>
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs text-slate-500 dark:text-slate-400">Tempo médio de espera</span>
            <TrendingUp size={16} className="text-amber-600 dark:text-amber-300" />
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white">{formatMinutes(overview?.tempoMedioEsperaMin)}</div>
        </div>
      </section>

      <section className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Entradas vs Fechamentos</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Volume agrupado {filters.bucket === 'day' ? 'por dia' : 'por hora'}.
          </p>
        </div>
        <div className="p-4 h-72">
          {chartData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-slate-500 dark:text-slate-400">
              Sem dados no período.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="Entradas" stroke="#2563eb" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Fechamentos" stroke="#10b981" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Fila" stroke="#7c3aed" strokeWidth={2} dot={false} strokeDasharray="4 2" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <BottleneckCard
          title="Filas com mais espera"
          subtitle="Top 10 ordenadas por p95 do tempo de espera"
          empty="Nenhum chat passou por fila no período."
          rows={bottlenecks?.filas}
          columns={[
            { key: 'queue', label: 'Fila' },
            { key: 'entradas', label: 'Entradas', align: 'right', format: formatNumber },
            { key: 'esperaP50Min', label: 'p50', align: 'right', format: formatMinutes },
            { key: 'esperaP95Min', label: 'p95', align: 'right', format: formatMinutes, critical: (value) => value !== null && value > 15 },
            { key: 'abandonos', label: 'Abandonos', align: 'right', format: formatNumber },
            { key: 'taxaPerda', label: 'Perda', align: 'right', format: formatPercent, critical: (value) => value !== null && value > 0.2 }
          ]}
        />
        <BottleneckCard
          title="Nós do fluxo com mais timeout"
          subtitle="Onde o cliente para de responder"
          empty="Sem timeouts registrados no período."
          rows={bottlenecks?.nodos}
          columns={[
            { key: 'label', label: 'Nó' },
            { key: 'nodeType', label: 'Tipo', className: 'text-xs text-slate-500' },
            { key: 'entradas', label: 'Entradas', align: 'right', format: formatNumber },
            { key: 'timeouts', label: 'Timeouts', align: 'right', format: formatNumber, critical: (value) => value > 5 },
            { key: 'transferidos', label: 'Foram p/ fila', align: 'right', format: formatNumber },
            { key: 'taxaTimeout', label: 'Taxa', align: 'right', format: formatPercent, critical: (value) => value !== null && value > 0.3 }
          ]}
        />
        <BottleneckCard
          title="Canais e taxa de perda"
          subtitle="Onde os atendimentos somem"
          empty="Sem dados de canal no período."
          rows={bottlenecks?.canais}
          columns={[
            { key: 'channel', label: 'Canal', className: 'uppercase' },
            { key: 'entradas', label: 'Entradas', align: 'right', format: formatNumber },
            { key: 'atendidos', label: 'Atendidos', align: 'right', format: formatNumber },
            { key: 'perdidos', label: 'Perdidos', align: 'right', format: formatNumber },
            { key: 'taxaPerda', label: 'Perda', align: 'right', format: formatPercent, critical: (value) => value !== null && value > 0.2 },
            { key: 'taxaInatividade', label: 'Inativ.', align: 'right', format: formatPercent, critical: (value) => value !== null && value > 0.3 }
          ]}
        />
        <BottleneckCard
          title="Carga dos agentes"
          subtitle="Top 10 com mais chats abertos agora"
          empty="Nenhum agente com atividade no período."
          rows={bottlenecks?.agentes}
          columns={[
            { key: 'name', label: 'Agente' },
            { key: 'emAtendimento', label: 'Em aberto', align: 'right', format: formatNumber, critical: (value) => value >= 5 },
            { key: 'atendidos', label: 'Atendidos', align: 'right', format: formatNumber },
            { key: 'duracaoMediaMin', label: 'Duração média', align: 'right', format: formatMinutes },
            { key: 'duracaoP95Min', label: 'p95 duração', align: 'right', format: formatMinutes }
          ]}
        />
      </section>

      <section className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Funil de atendimento</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Quantos atendimentos chegaram em cada estágio no período.
          </p>
        </div>
        <div className="p-4 h-64">
          {funnelData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-slate-500 dark:text-slate-400">
              Sem dados no período.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnelData} layout="vertical" margin={{ top: 10, right: 20, left: 60, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={140} />
                <Tooltip />
                <Bar dataKey="valor" fill="#2563eb" radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>
    </div>
  );
};

export default AnalyticsDashboard;
