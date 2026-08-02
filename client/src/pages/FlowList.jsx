import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest, getJSON, postJSON, putJSON } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useDialog } from '../context/DialogContext';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Download,
  Edit3,
  History,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Upload,
  Workflow,
  X
} from 'lucide-react';
import toast from 'react-hot-toast';
import { SkeletonBox } from '../components/LoadingSkeleton';

const formatDate = (value) => {
  if (!value) return 'Sem data';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sem data';
  return date.toLocaleString('pt-BR');
};

const readErrorMessage = async (response, fallback) => {
  const payload = await response.json().catch(() => ({}));
  if (Array.isArray(payload?.error)) return payload.error[0]?.message || fallback;
  return payload?.error || fallback;
};

const PasswordConfirmModal = ({ state, onClose, onChangePassword, onConfirm }) => {
  if (!state.open) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-black/55 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">{state.title}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{state.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
            {state.message}
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">
              Senha
            </label>
            <input
              type="password"
              value={state.password}
              onChange={(event) => onChangePassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !state.busy && state.password.trim()) {
                  onConfirm();
                }
              }}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Digite sua senha para confirmar"
              autoFocus
            />
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={state.busy || !state.password.trim()}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white inline-flex items-center gap-2"
          >
            {state.busy ? <Loader2 size={16} className="animate-spin" /> : null}
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

const PublishHistoryModal = ({ state, canRollback, onClose, onRestore }) => {
  if (!state.open) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-4xl rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-2xl overflow-hidden max-h-[88vh] flex flex-col">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
              Histórico de publicações
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {state.flow?.name || 'Fluxo'} · {state.items.length} publicação(ões)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto custom-scrollbar flex-1">
          {state.loading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={`pub_skel_${index}`} className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                  <SkeletonBox className="h-4 w-48" />
                  <SkeletonBox className="h-4 w-full mt-3" />
                </div>
              ))}
            </div>
          ) : state.items.length === 0 ? (
            <div className="h-full min-h-[220px] flex flex-col items-center justify-center text-gray-400 gap-3">
              <History size={46} />
              <p>Nenhuma publicação encontrada para este fluxo.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {!canRollback && (
                <div className="rounded-xl border border-blue-200 bg-blue-50 dark:border-blue-900/40 dark:bg-blue-900/10 px-4 py-3 text-sm text-blue-700 dark:text-blue-300">
                  Somente Admin e Super Admin podem restaurar publicações antigas.
                </div>
              )}

              {state.items.map((item) => {
                const isCurrent = state.currentPublishedVersion && item.version === state.currentPublishedVersion;
                return (
                  <div key={item.id} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/20 p-4">
                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                      <div className="space-y-2 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1 rounded-full bg-gray-900 text-white dark:bg-white dark:text-gray-900 px-2.5 py-1 text-xs font-semibold">
                            v{item.version}
                          </span>
                          {isCurrent && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 px-2.5 py-1 text-xs font-semibold">
                              <CheckCircle2 size={12} />
                              Atual
                            </span>
                          )}
                          {item.restoredFromVersion ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 px-2.5 py-1 text-xs font-semibold">
                              Restaurado da v{item.restoredFromVersion}
                            </span>
                          ) : null}
                        </div>

                        <div className="text-sm font-semibold text-gray-900 dark:text-white break-words">
                          {item.name || state.flow?.name || 'Fluxo sem nome'}
                        </div>

                        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                          <span className="inline-flex items-center gap-1">
                            <Calendar size={12} />
                            {formatDate(item.publishedAt)}
                          </span>
                          <span>Publicado por: {item.publishedBy || 'sistema'}</span>
                        </div>

                        {item.description ? (
                          <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap break-words">
                            {item.description}
                          </p>
                        ) : null}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onRestore(item)}
                          disabled={!canRollback}
                          className="px-3 py-2 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white inline-flex items-center gap-2"
                        >
                          <RotateCcw size={15} />
                          Restaurar
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const FlowList = () => {
  const { prompt } = useDialog();
  const [flows, setFlows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [renamingFlowId, setRenamingFlowId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [historyModal, setHistoryModal] = useState({
    open: false,
    flow: null,
    items: [],
    loading: false,
    currentPublishedVersion: null
  });
  const [passwordModal, setPasswordModal] = useState({
    open: false,
    mode: null,
    flow: null,
    historyItem: null,
    password: '',
    busy: false,
    title: '',
    subtitle: '',
    message: '',
    confirmLabel: ''
  });
  const fileInputRef = useRef(null);
  const navigate = useNavigate();
  const { user } = useAuth();
  const canRollback = ['ADMIN', 'SUPER_ADMIN'].includes(user?.role);

  const fetchFlows = async () => {
    try {
      setLoading(true);
      const data = await getJSON('/flows?limit=200&page=1');
      const list = Array.isArray(data) ? data : (data?.items || []);
      setFlows(list);
    } catch (error) {
      console.error('Erro ao buscar fluxos:', error);
      toast.error('Erro ao carregar fluxos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFlows();
  }, []);

  const filteredFlows = useMemo(() => (
    flows.filter((flow) => {
      const flowName = String(flow?.name || '').toLowerCase();
      const flowId = String(flow?.id || '');
      const query = searchTerm.toLowerCase();
      return flowName.includes(query) || flowId.includes(query);
    })
  ), [flows, searchTerm]);

  const closePasswordModal = (force = false) => {
    if (!force && passwordModal.busy) return;
    setPasswordModal({
      open: false,
      mode: null,
      flow: null,
      historyItem: null,
      password: '',
      busy: false,
      title: '',
      subtitle: '',
      message: '',
      confirmLabel: ''
    });
  };

  const openDeleteModal = (flow) => {
    setPasswordModal({
      open: true,
      mode: 'delete',
      flow,
      historyItem: null,
      password: '',
      busy: false,
      title: 'Excluir fluxo',
      subtitle: flow?.name || 'Fluxo sem nome',
      message: `Digite sua senha para excluir permanentemente o fluxo "${flow?.name || flow?.id}".`,
      confirmLabel: 'Excluir fluxo'
    });
  };

  const openRollbackModal = (flow, historyItem) => {
    setPasswordModal({
      open: true,
      mode: 'rollback',
      flow,
      historyItem,
      password: '',
      busy: false,
      title: 'Restaurar publicação',
      subtitle: `${flow?.name || 'Fluxo'} · v${historyItem?.version || '?'}`,
      message: `Digite sua senha para restaurar a publicação v${historyItem?.version || '?'} deste fluxo.`,
      confirmLabel: 'Restaurar versão'
    });
  };

  const handleCreateFlow = async () => {
    const name = await prompt({
      title: 'Novo fluxo',
      message: 'Informe um nome para o novo fluxo.',
      placeholder: 'Ex: Atendimento Inicial',
      confirmText: 'Criar fluxo',
      type: 'info',
    });
    if (!name || name.trim() === '') return;

    try {
      const newFlow = await postJSON('/flows', { name: name.trim() });
      if (newFlow?.id) {
        toast.success('Fluxo criado!');
        navigate(`/editor/${newFlow.id}`);
      }
    } catch (error) {
      toast.error('Erro ao criar fluxo.');
    }
  };

  const startRename = (flow) => {
    setRenamingFlowId(flow.id);
    setRenameValue(flow.name || '');
  };

  const cancelRename = () => {
    if (renameSaving) return;
    setRenamingFlowId(null);
    setRenameValue('');
  };

  const submitRename = async (flow) => {
    const trimmedName = renameValue.trim();
    if (!trimmedName) {
      toast.error('Informe um nome valido para o fluxo.');
      return;
    }

    if (trimmedName === flow.name) {
      cancelRename();
      return;
    }

    try {
      setRenameSaving(true);
      const response = await apiRequest(`/flows/${flow.id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: trimmedName })
      });
      if (!response?.ok) {
        throw new Error(await readErrorMessage(response, 'Erro ao atualizar nome do fluxo'));
      }
      const updated = await response.json();
      setFlows((current) => current.map((item) => (
        item.id === flow.id
          ? { ...item, ...updated, name: updated?.name || trimmedName }
          : item
      )));
      toast.success('Nome do fluxo atualizado');
      setRenamingFlowId(null);
      setRenameValue('');
    } catch (error) {
      toast.error(error.message || 'Erro ao atualizar nome do fluxo');
    } finally {
      setRenameSaving(false);
    }
  };

  const handleExportFlow = async (flow) => {
    try {
      const full = await getJSON(`/flows/${flow.id}?export=1`);
      const payload = {
        name: full.name,
        description: full.description || '',
        draft: full.draft || null,
        published: full.published || null
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${flow.name || flow.id}.onionflow.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success('Fluxo exportado');
    } catch (error) {
      toast.error('Erro ao exportar fluxo');
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFlow = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const raw = await file.text();
      const data = JSON.parse(raw);
      const baseName = String(data?.name || 'Fluxo Importado').trim() || 'Fluxo Importado';
      const name = `${baseName} (importado)`;
      const snapshot = data?.draft || data?.published || null;
      const nodes = snapshot?.nodes || data?.nodes || [];
      const edges = snapshot?.edges || data?.edges || [];

      if (!Array.isArray(nodes) || !Array.isArray(edges)) {
        throw new Error('Arquivo invalido');
      }

      const newFlow = await postJSON('/flows', { name, description: data?.description || '' });
      if (!newFlow?.id) throw new Error('Falha ao criar fluxo');

      await putJSON(`/flows/${newFlow.id}`, {
        name,
        description: data?.description || '',
        nodes,
        edges,
        status: 'draft',
        published: null
      });

      toast.success('Fluxo importado');
      navigate(`/editor/${newFlow.id}`);
    } catch (error) {
      toast.error(error.message || 'Erro ao importar fluxo');
    } finally {
      event.target.value = '';
    }
  };

  const openPublishHistory = async (flow) => {
    setHistoryModal({
      open: true,
      flow,
      items: [],
      loading: true,
      currentPublishedVersion: flow?.published?.version || null
    });

    try {
      const response = await apiRequest(`/flows/${flow.id}/publish-history`);
      if (!response?.ok) {
        throw new Error(await readErrorMessage(response, 'Erro ao carregar histórico de publicações'));
      }
      const data = await response.json();
      setHistoryModal({
        open: true,
        flow,
        items: Array.isArray(data?.items) ? data.items : [],
        loading: false,
        currentPublishedVersion: data?.currentPublishedVersion || null
      });
    } catch (error) {
      setHistoryModal({
        open: true,
        flow,
        items: [],
        loading: false,
        currentPublishedVersion: flow?.published?.version || null
      });
      toast.error('Erro ao carregar histórico de publicações');
    }
  };

  const handlePasswordConfirm = async () => {
    if (!passwordModal.password.trim() || passwordModal.busy) return;

    try {
      setPasswordModal((current) => ({ ...current, busy: true }));

      if (passwordModal.mode === 'delete') {
        const response = await apiRequest(`/flows/${passwordModal.flow.id}`, {
          method: 'DELETE',
          body: JSON.stringify({ password: passwordModal.password })
        });
        if (!response?.ok) {
          throw new Error(await readErrorMessage(response, 'Nao foi possivel excluir o fluxo'));
        }
        setFlows((current) => current.filter((item) => item.id !== passwordModal.flow.id));
        toast.success('Fluxo excluido');
        closePasswordModal(true);
        return;
      }

      if (passwordModal.mode === 'rollback') {
        const response = await apiRequest(`/flows/${passwordModal.flow.id}/rollback`, {
          method: 'POST',
          body: JSON.stringify({
            historyId: passwordModal.historyItem.id,
            password: passwordModal.password
          })
        });
        if (!response?.ok) {
          throw new Error(await readErrorMessage(response, 'Nao foi possivel restaurar a publicação'));
        }
        toast.success(`Fluxo restaurado para a versão v${passwordModal.historyItem.version}`);
        closePasswordModal(true);
        setHistoryModal((current) => ({ ...current, open: false }));
        await fetchFlows();
      }
    } catch (error) {
      toast.error(error.message || 'Nao foi possivel concluir a acao');
      setPasswordModal((current) => ({ ...current, busy: false }));
    }
  };

  if (loading) {
    return (
      <main className="p-3 sm:p-4 lg:p-6 max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-2">
            <SkeletonBox className="h-6 w-56" />
            <SkeletonBox className="h-4 w-72" />
          </div>
          <SkeletonBox className="h-10 w-full sm:w-40" />
        </div>

        <SkeletonBox className="h-12 w-full" />

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
          <div className="p-4 space-y-3">
            <SkeletonBox className="h-4 w-64" />
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={`flow_row_${index}`} className="grid grid-cols-4 gap-4">
                <SkeletonBox className="h-4 col-span-2" />
                <SkeletonBox className="h-4" />
                <SkeletonBox className="h-4" />
              </div>
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <>
      <main className="p-3 sm:p-4 lg:p-6 max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Workflow className="w-8 h-8 text-blue-600" /> Fluxos de Conversa
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Gerencie os roteiros automatizados do chatbot.</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <button
              onClick={handleImportClick}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-medium rounded-lg transition-colors shadow-sm w-full sm:w-auto"
            >
              <Upload size={18} /> Importar
            </button>
            <button
              onClick={handleCreateFlow}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors shadow-sm w-full sm:w-auto"
            >
              <Plus size={18} /> Novo Fluxo
            </button>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar fluxo por nome ou ID..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
          />
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left min-w-[760px]">
              <thead className="bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-400 uppercase font-medium">
                <tr>
                  <th className="px-6 py-3">Nome</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">ID</th>
                  <th className="px-6 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {filteredFlows.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                      Nenhum fluxo encontrado.
                    </td>
                  </tr>
                ) : (
                  filteredFlows.map((flow) => {
                    const isRenaming = renamingFlowId === flow.id;
                    return (
                      <tr key={flow.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                        <td className="px-6 py-4 font-medium text-gray-900 dark:text-white">
                          {isRenaming ? (
                            <div className="flex items-center gap-2 max-w-md">
                              <input
                                type="text"
                                value={renameValue}
                                onChange={(event) => setRenameValue(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    submitRename(flow);
                                  }
                                  if (event.key === 'Escape') {
                                    cancelRename();
                                  }
                                }}
                                className="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                                autoFocus
                              />
                              <button
                                type="button"
                                onClick={() => submitRename(flow)}
                                disabled={renameSaving}
                                className="p-2 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                                title="Salvar nome"
                              >
                                {renameSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                              </button>
                              <button
                                type="button"
                                onClick={cancelRename}
                                disabled={renameSaving}
                                className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700"
                                title="Cancelar"
                              >
                                <X size={16} />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="break-words">{flow.name}</span>
                              <button
                                type="button"
                                onClick={() => startRename(flow)}
                                className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                                title="Renomear fluxo"
                              >
                                <Pencil size={14} />
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {flow.published ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                              <CheckCircle2 size={12} /> Publicado
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                              <AlertCircle size={12} /> Rascunho
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 font-mono text-xs text-gray-500 dark:text-gray-400">
                          {flow.id}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => handleExportFlow(flow)}
                              className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors"
                              title="Exportar"
                            >
                              <Download size={16} />
                            </button>
                            <button
                              onClick={() => openPublishHistory(flow)}
                              className="p-2 text-gray-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg transition-colors"
                              title="Histórico de publicações"
                            >
                              <History size={16} />
                            </button>
                            <button
                              onClick={() => navigate(`/editor/${flow.id}`)}
                              className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                              title="Abrir editor"
                            >
                              <Edit3 size={16} />
                            </button>
                            <button
                              onClick={() => openDeleteModal(flow)}
                              className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                              title="Excluir"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={handleImportFlow}
        />
      </main>

      <PublishHistoryModal
        state={historyModal}
        canRollback={canRollback}
        onClose={() => setHistoryModal((current) => ({ ...current, open: false }))}
        onRestore={(historyItem) => {
          if (!canRollback) {
            toast.error('Somente Admin e Super Admin podem restaurar publicações.');
            return;
          }
          openRollbackModal(historyModal.flow, historyItem);
        }}
      />

      <PasswordConfirmModal
        state={passwordModal}
        onClose={closePasswordModal}
        onChangePassword={(password) => setPasswordModal((current) => ({ ...current, password }))}
        onConfirm={handlePasswordConfirm}
      />
    </>
  );
};

export default FlowList;
