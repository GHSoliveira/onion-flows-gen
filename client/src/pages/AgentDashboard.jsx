import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CalendarDays,
  Clock3,
  Headset,
  Loader2,
  MessageCircle,
  Star,
  TrendingUp
} from 'lucide-react';
import toast from 'react-hot-toast';
import { apiRequest } from '../services/api';

const fmtNumber = (value) => Number(value || 0).toLocaleString('pt-BR');

const fmtMinutes = (value) => {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return '-';
  if (minutes < 1) return '< 1 min';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h${m ? ` ${m}min` : ''}`;
};

const fmtDate = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const fmtRating = (value) => {
  const rating = Number(value || 0);
  return rating > 0 ? rating.toFixed(1) : '-';
};

const StatCard = ({ icon: Icon, label, value, helper, tone = 'blue' }) => {
  const tones = {
    blue: 'from-blue-500/14 to-sky-500/8 text-blue-600 dark:text-blue-300',
    emerald: 'from-emerald-500/14 to-teal-500/8 text-emerald-600 dark:text-emerald-300',
    amber: 'from-amber-500/16 to-orange-500/8 text-amber-600 dark:text-amber-300',
    rose: 'from-rose-500/14 to-red-500/8 text-rose-600 dark:text-rose-300'
  };

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">{label}</div>
          <div className="mt-3 text-3xl font-black tracking-tight text-slate-950 dark:text-white">{value}</div>
          {helper ? <div className="mt-2 text-xs font-medium text-slate-500 dark:text-slate-400">{helper}</div> : null}
        </div>
        <div className={`rounded-2xl bg-gradient-to-br p-3 ${tones[tone] || tones.blue}`}>
          <Icon size={22} />
        </div>
      </div>
    </div>
  );
};

const Stars = ({ value }) => {
  const rating = Number(value || 0);
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: 5 }).map((_, index) => (
        <Star
          key={index}
          size={16}
          className={index < Math.round(rating) ? 'text-amber-400' : 'text-slate-300 dark:text-slate-700'}
          fill={index < Math.round(rating) ? 'currentColor' : 'none'}
        />
      ))}
    </div>
  );
};

const AgentDashboard = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        setLoading(true);
        const res = await apiRequest('/chats/agent-dashboard/me');
        if (!res || !res.ok) {
          throw new Error('Falha ao carregar dashboard');
        }
        const payload = await res.json();
        if (alive) setData(payload);
      } catch (error) {
        toast.error(error.message || 'Erro ao carregar dashboard');
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    return () => {
      alive = false;
    };
  }, []);

  const history = useMemo(() => Array.isArray(data?.history) ? data.history : [], [data]);

  if (loading) {
    return (
      <div className="flex h-full min-h-[420px] items-center justify-center">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm font-semibold text-slate-500 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          <Loader2 className="animate-spin text-blue-500" size={18} />
          Carregando seu dashboard...
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="relative p-6 sm:p-8">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.18),transparent_38%),radial-gradient(circle_at_bottom_left,rgba(14,165,233,0.12),transparent_34%)]" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300">
                <Headset size={14} />
                Painel do agente
              </div>
              <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-950 dark:text-white sm:text-4xl">
                {data?.agent?.name || 'Meu desempenho'}
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
                Acompanhe atendimentos realizados, tempo medio de espera na fila, nota e historico recente.
              </p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white/70 p-4 backdrop-blur dark:border-slate-800 dark:bg-slate-950/40">
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Media geral</div>
              <div className="mt-2 flex items-center gap-3">
                <div className="text-3xl font-black text-slate-950 dark:text-white">{fmtRating(data?.agent?.ratingAvg)}</div>
                <div>
                  <Stars value={data?.agent?.ratingAvg} />
                  <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {fmtNumber(data?.agent?.ratingCount)} avaliacoes
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={CalendarDays} label="Atendimentos no mes" value={fmtNumber(data?.month?.atendimentos)} helper="Chats encerrados por voce neste mes" tone="blue" />
        <StatCard icon={Clock3} label="TME do mes" value={fmtMinutes(data?.month?.tmeMinutes)} helper="Tempo medio em espera antes de puxar" tone="amber" />
        <StatCard icon={Activity} label="Atendimentos hoje" value={fmtNumber(data?.today?.atendimentos)} helper="Encerrados hoje" tone="emerald" />
        <StatCard icon={TrendingUp} label="TME de hoje" value={fmtMinutes(data?.today?.tmeMinutes)} helper="Espera media dos atendimentos puxados" tone="rose" />
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Ultima nota</div>
          <div className="mt-3 flex items-center gap-3">
            <div className="text-4xl font-black text-slate-950 dark:text-white">{fmtRating(data?.agent?.latestRating)}</div>
            <Stars value={data?.agent?.latestRating} />
          </div>
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Nota mais recente encontrada nos atendimentos avaliados.</p>
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Media de notas do mes</div>
          <div className="mt-3 flex items-center gap-3">
            <div className="text-4xl font-black text-slate-950 dark:text-white">{fmtRating(data?.month?.ratingAvg)}</div>
            <Stars value={data?.month?.ratingAvg} />
          </div>
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Baseada nas notas registradas em atendimentos do mes.</p>
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Agora</div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/70">
              <div className="text-2xl font-black text-slate-950 dark:text-white">{fmtNumber(data?.active?.open)}</div>
              <div className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">Ativos</div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/70">
              <div className="text-2xl font-black text-slate-950 dark:text-white">{fmtNumber(data?.active?.waitingOwned)}</div>
              <div className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">Em fila</div>
            </div>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-bold text-slate-950 dark:text-white">Historico de atendimentos</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">Ultimos atendimentos vinculados ao seu usuario.</p>
          </div>
          <MessageCircle className="text-blue-500" size={22} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-400 dark:bg-slate-950/40">
              <tr>
                <th className="px-5 py-3">Cliente</th>
                <th className="px-5 py-3">Canal</th>
                <th className="px-5 py-3">Fila</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">TME</th>
                <th className="px-5 py-3">Nota</th>
                <th className="px-5 py-3">Atualizado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {history.length === 0 ? (
                <tr>
                  <td className="px-5 py-10 text-center text-slate-400" colSpan={7}>Nenhum atendimento encontrado.</td>
                </tr>
              ) : history.map((chat) => (
                <tr key={chat.id} className="transition-colors hover:bg-blue-50/40 dark:hover:bg-blue-950/20">
                  <td className="px-5 py-4">
                    <div className="font-semibold text-slate-900 dark:text-white">{chat.customerName || chat.id}</div>
                    <div className="text-xs text-slate-400">{chat.id}</div>
                  </td>
                  <td className="px-5 py-4 capitalize text-slate-600 dark:text-slate-300">{chat.channel || '-'}</td>
                  <td className="px-5 py-4 text-slate-600 dark:text-slate-300">{chat.queue || '-'}</td>
                  <td className="px-5 py-4">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {chat.status || '-'}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-slate-600 dark:text-slate-300">{fmtMinutes(chat.queueWaitMinutes)}</td>
                  <td className="px-5 py-4 text-slate-600 dark:text-slate-300">{fmtRating(chat.rating)}</td>
                  <td className="px-5 py-4 text-slate-500 dark:text-slate-400">{fmtDate(chat.closedAt || chat.updatedAt || chat.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default AgentDashboard;
