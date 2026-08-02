import { useEffect, useState } from 'react';
import { BrainCircuit, Check, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { deleteJSON, getJSON, postJSON, putJSON } from '../services/api';
import { useDialog } from '../context/DialogContext';
import { SkeletonBox } from '../components/LoadingSkeleton';

const EMPTY_FORM = { title: '', content: '', enabled: true, order: 0 };

const AiMemoryManager = () => {
  const { confirm } = useDialog();
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  useEffect(() => {
    getJSON('/ai-memories')
      .then((data) => setMemories(data || []))
      .catch((error) => toast.error(error.message || 'Nao foi possivel carregar as memorias.'))
      .finally(() => setLoading(false));
  }, []);

  const resetForm = () => { setEditingId(null); setForm(EMPTY_FORM); };

  const submit = async (event) => {
    event.preventDefault();
    if (!form.title.trim() || !form.content.trim()) return;
    setSaving(true);
    try {
      const saved = editingId ? await putJSON(`/ai-memories/${editingId}`, form) : await postJSON('/ai-memories', form);
      setMemories((current) => {
        const next = editingId ? current.map((item) => item.id === editingId ? saved : item) : [...current, saved];
        return next.sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
      });
      toast.success(editingId ? 'Memoria atualizada.' : 'Memoria adicionada.');
      resetForm();
    } catch (error) {
      toast.error(error.message || 'Nao foi possivel salvar a memoria.');
    } finally { setSaving(false); }
  };

  const edit = (memory) => {
    setEditingId(memory.id);
    setForm({ title: memory.title || '', content: memory.content || '', enabled: memory.enabled !== false, order: Number(memory.order || 0) });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggle = async (memory) => {
    try {
      const updated = await putJSON(`/ai-memories/${memory.id}`, { enabled: memory.enabled === false });
      setMemories((current) => current.map((item) => item.id === memory.id ? updated : item));
    } catch (error) { toast.error(error.message || 'Nao foi possivel alterar o estado.'); }
  };

  const remove = async (memory) => {
    const accepted = await confirm({ title: 'Excluir memoria', message: `A instrucao “${memory.title}” deixara de ser considerada pelo assistente.`, confirmText: 'Excluir', type: 'danger' });
    if (!accepted) return;
    try {
      await deleteJSON(`/ai-memories/${memory.id}`);
      setMemories((current) => current.filter((item) => item.id !== memory.id));
      if (editingId === memory.id) resetForm();
      toast.success('Memoria removida.');
    } catch (error) { toast.error(error.message || 'Nao foi possivel excluir a memoria.'); }
  };

  if (loading) return <div className="space-y-4 p-4 lg:p-6"><SkeletonBox className="h-8 w-64" /><SkeletonBox className="h-44 w-full" /><SkeletonBox className="h-64 w-full" /></div>;
  const activeCount = memories.filter((item) => item.enabled !== false).length;

  return <div className="mx-auto max-w-5xl space-y-8 p-4 lg:p-6">
    <header className="flex items-start gap-4 border-b border-slate-200 pb-6 dark:border-slate-700">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"><BrainCircuit size={22} /></div>
      <div><h1 className="text-2xl font-bold text-slate-900 dark:text-white">Minha memoria do assistente</h1><p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">Suas instrucoes ativas sao lidas antes de cada sugestao do copiloto Genesys nos atendimentos atribuidos a voce. Nenhum outro agente ve ou utiliza esta lista.</p><div className="mt-2 text-xs font-semibold text-violet-600 dark:text-violet-300">{activeCount} ativa{activeCount === 1 ? '' : 's'} de {memories.length}</div></div>
    </header>
    <form onSubmit={submit} className="grid gap-4 border-b border-slate-200 pb-8 dark:border-slate-700 lg:grid-cols-[220px_1fr]">
      <div><h2 className="text-sm font-bold text-slate-900 dark:text-white">{editingId ? 'Editar instrucao' : 'Nova instrucao'}</h2><p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">Exemplo: “Confirme o modelo do roteador antes de orientar a abertura de portas.”</p></div>
      <div className="space-y-3">
        <input required maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Titulo curto" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
        <textarea required maxLength={4000} rows={5} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="O que o assistente deve lembrar em todas as respostas?" className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-relaxed outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><label className="inline-flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="h-4 w-4 accent-violet-600" />Ativa imediatamente</label><div className="flex gap-2">{editingId ? <button type="button" onClick={resetForm} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300"><X size={15} />Cancelar</button> : null}<button disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60">{editingId ? <Save size={15} /> : <Plus size={15} />}{saving ? 'Salvando...' : editingId ? 'Salvar alteracoes' : 'Adicionar memoria'}</button></div></div>
      </div>
    </form>
    <section><h2 className="text-sm font-bold text-slate-900 dark:text-white">Instrucoes cadastradas</h2>{memories.length === 0 ? <div className="mt-4 rounded-2xl border border-dashed border-slate-300 px-5 py-10 text-center text-sm text-slate-500 dark:border-slate-700">Nenhuma memoria cadastrada. Adicione a primeira regra acima.</div> : <div className="mt-3 divide-y divide-slate-200 border-y border-slate-200 dark:divide-slate-700 dark:border-slate-700">{memories.map((memory) => <article key={memory.id} className={`flex flex-col gap-3 py-4 transition-opacity sm:flex-row sm:items-start ${memory.enabled === false ? 'opacity-55' : ''}`}><button type="button" onClick={() => toggle(memory)} title={memory.enabled === false ? 'Ativar memoria' : 'Desativar memoria'} className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${memory.enabled === false ? 'border-slate-300 text-transparent dark:border-slate-600' : 'border-violet-500 bg-violet-500 text-white'}`}><Check size={14} /></button><div className="min-w-0 flex-1"><div className="text-sm font-semibold text-slate-900 dark:text-white">{memory.title}</div><p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-600 dark:text-slate-300">{memory.content}</p></div><div className="flex shrink-0 gap-1"><button type="button" onClick={() => edit(memory)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-violet-600 dark:hover:bg-slate-800" title="Editar"><Pencil size={16} /></button><button type="button" onClick={() => remove(memory)} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Excluir"><Trash2 size={16} /></button></div></article>)}</div>}</section>
  </div>;
};

export default AiMemoryManager;
