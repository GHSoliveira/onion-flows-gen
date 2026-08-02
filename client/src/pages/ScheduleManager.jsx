import { useState, useEffect } from 'react';
import { getJSON, postJSON, deleteJSON } from '../services/api';
import { Calendar, Save, Trash2, Clock, Check, Plus, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTenant } from '../context/TenantContext';
import { useDialog } from '../context/DialogContext';
import { SkeletonBox } from '../components/LoadingSkeleton';

const DAYS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

const ScheduleManager = () => {
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const { tenant } = useTenant();
  const { confirm } = useDialog();


  const [name, setName] = useState('');
  const [rules, setRules] = useState(
    DAYS.reduce((acc, day, index) => ({
      ...acc,
      [day]: { active: index < 5, start: '08:00', end: '18:00' }
    }), {})
  );


  const [bulkStart, setBulkStart] = useState('08:00');
  const [bulkEnd, setBulkEnd] = useState('18:00');

  useEffect(() => {
    fetchSchedules();
  }, []);

  const fetchSchedules = async () => {
    try {
      setLoading(true);

      const data = await getJSON('/schedules');
      if (Array.isArray(data)) {
        setSchedules(data);
      }
    } catch (error) {
      toast.error('Erro ao carregar horários');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) return toast.error("Defina um nome para o grupo.");

    try {


      const payload = { name, rules };
      if (tenant && tenant.id && tenant.id !== 'super_admin') {
        payload.tenantId = tenant.id;
      }

      const newSchedule = await postJSON('/schedules', payload);

      if (newSchedule && newSchedule.id) {
        toast.success("Grupo de horário salvo!");
        setSchedules([...schedules, newSchedule]);
        setName('');

        setRules(DAYS.reduce((acc, day, index) => ({
          ...acc, [day]: { active: index < 5, start: '08:00', end: '18:00' }
        }), {}));
      }
    } catch (error) {
      console.error("Erro no save:", error);
      toast.error("Erro ao salvar: " + error.message);
    }
  };

  const handleDelete = async (id) => {
    const ok = await confirm({
      title: 'Excluir horário',
      message: 'Tem certeza? Esta ação pode afetar fluxos que dependem deste horário.',
      confirmText: 'Excluir',
      type: 'danger',
    });
    if (!ok) return;

    const previousSchedules = schedules;
    setSchedules(prev => prev.filter(s => s.id !== id));

    try {
      await deleteJSON(`/schedules/${id}`);
      toast.success("Horário removido.");
    } catch (error) {
      setSchedules(previousSchedules);
      toast.error("Erro ao excluir.");
    }
  };


  const applyBulk = () => {
    const newRules = { ...rules };
    Object.keys(newRules).forEach(day => {
      if (newRules[day].active) {
        newRules[day].start = bulkStart;
        newRules[day].end = bulkEnd;
      }
    });
    setRules(newRules);
    toast.success("Horários aplicados aos dias ativos");
  };

  if (loading) {
    return (
      <div className="p-3 sm:p-4 lg:p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="space-y-2">
            <SkeletonBox className="h-6 w-44" />
            <SkeletonBox className="h-4 w-64" />
          </div>
          <SkeletonBox className="h-10 w-full sm:w-40" />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 space-y-3">
            <SkeletonBox className="h-4 w-32" />
            <SkeletonBox className="h-10 w-full" />
            <div className="grid grid-cols-2 gap-2">
              <SkeletonBox className="h-10" />
              <SkeletonBox className="h-10" />
            </div>
            <SkeletonBox className="h-10 w-full" />
          </div>
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 space-y-3">
            <SkeletonBox className="h-4 w-28" />
            {Array.from({ length: 5 }).map((_, index) => (
              <SkeletonBox key={`schedule_${index}`} className="h-10 w-full" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-4 lg:p-6 max-w-7xl mx-auto space-y-6">

      {}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Calendar className="w-8 h-8 text-blue-600" />
          Horários de Atendimento
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">Configure as janelas de funcionamento para seus fluxos.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">

        {}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 sm:p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <Plus className="w-5 h-5 text-blue-500" /> Novo Grupo
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome do Setor</label>
                <input
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white outline-none transition-all"
                  placeholder="Ex: Comercial"
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
              </div>

              {}
              <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-100 dark:border-blue-800/30">
                <label className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase mb-2 block">Aplicar em massa (Dias ativos)</label>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <input type="time" value={bulkStart} onChange={e => setBulkStart(e.target.value)} className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm" />
                  <span className="text-gray-400">-</span>
                  <input type="time" value={bulkEnd} onChange={e => setBulkEnd(e.target.value)} className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm" />
                  <button onClick={applyBulk} className="ml-auto text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded transition-colors w-full sm:w-auto">Aplicar</button>
                </div>
              </div>

              {}
              <div className="space-y-2 border-t border-gray-100 dark:border-gray-700 pt-4">
                {DAYS.map(day => (
                  <div key={day} className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-2 rounded-lg border transition-colors ${rules[day].active ? 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600' : 'bg-gray-50 dark:bg-gray-800/50 border-transparent opacity-60'}`}>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={rules[day].active}
                        onChange={e => setRules({ ...rules, [day]: { ...rules[day], active: e.target.checked } })}
                        className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                      />
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-200 w-20">{day}</span>
                    </label>

                    {rules[day].active ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="time"
                          value={rules[day].start}
                          onChange={e => setRules({ ...rules, [day]: { ...rules[day], start: e.target.value } })}
                          className="w-20 px-1 py-0.5 text-sm border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-800 dark:text-white"
                        />
                        <span className="text-gray-400 text-xs">às</span>
                        <input
                          type="time"
                          value={rules[day].end}
                          onChange={e => setRules({ ...rules, [day]: { ...rules[day], end: e.target.value } })}
                          className="w-20 px-1 py-0.5 text-sm border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-800 dark:text-white"
                        />
                      </div>
                    ) : (
                      <span className="text-xs font-semibold text-red-500 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded">FECHADO</span>
                    )}
                  </div>
                ))}
              </div>

              <button
                onClick={handleSave}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors shadow-sm mt-4"
              >
                <Save className="w-4 h-4" /> Salvar Configuração
              </button>
            </div>
          </div>
        </div>

        {}
        <div className="lg:col-span-7">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {schedules.length === 0 ? (
              <div className="col-span-full py-12 text-center border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
                <Clock className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 dark:text-gray-400">Nenhum grupo de horário criado.</p>
              </div>
            ) : (
              schedules.map(s => (
                <div key={s.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow group">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        {s.name}
                      </h3>
                      <span className="text-xs text-gray-500 dark:text-gray-400">ID: {s.id}</span>
                    </div>
                    <button
                      onClick={() => handleDelete(s.id)}
                      className="text-gray-400 hover:text-red-500 transition-colors p-1 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="space-y-1">
                    {DAYS.map(day => {
                      const rule = s.rules[day];
                      if (!rule?.active) return null;
                      return (
                        <div key={day} className="flex justify-between text-xs py-1 border-b border-gray-50 dark:border-gray-700 last:border-0">
                          <span className="text-gray-600 dark:text-gray-400 font-medium">{day}</span>
                          <span className="text-blue-600 dark:text-blue-400 font-mono">{rule.start} - {rule.end}</span>
                        </div>
                      );
                    })}
                    {Object.values(s.rules).every(r => !r.active) && (
                      <div className="text-xs text-red-500 italic">Fechado todos os dias</div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

export default ScheduleManager;

