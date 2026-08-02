import { useState, useEffect } from 'react';
import { apiRequest } from '../services/api';
import { useTenant } from '../context/TenantContext';
import { useDialog } from '../context/DialogContext';
import { Users, UserPlus, Trash2, Shield, Briefcase, Headset, Star, MessageSquareText, X, Edit, Power, PowerOff, Save } from 'lucide-react';
import toast from 'react-hot-toast';

const AgentManager = () => {
  const emptyQueueForm = {
    name: '',
    color: '#3b82f6',
    description: '',
    entryMessage: '',
    waitingMessage: '',
    active: true
  };
  const emptyUserForm = { name: '', username: '', password: '', role: 'AGENT', queues: [] };
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyUserForm);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState(null);
  const [queues, setQueues] = useState([]);
  const [queueForm, setQueueForm] = useState(emptyQueueForm);
  const [queueModalOpen, setQueueModalOpen] = useState(false);
  const [editingQueueId, setEditingQueueId] = useState(null);
  const [queueAgentModal, setQueueAgentModal] = useState(null);
  const [queueAgentIds, setQueueAgentIds] = useState([]);
  const [savingQueueAgents, setSavingQueueAgents] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [agentChats, setAgentChats] = useState([]);
  const [agentStats, setAgentStats] = useState({ total: 0, uniqueCustomers: 0 });
  const [loadingAgentChats, setLoadingAgentChats] = useState(false);
  const { tenant } = useTenant();
  const { confirm } = useDialog();

  useEffect(() => {
    fetchUsers();
    fetchQueues();
  }, []);

  const fetchQueues = async () => {
    const res = await apiRequest('/queues');
    if (res) setQueues(await res.json());
  };

  const openQueueModal = (queue = null) => {
    if (queue) {
      setEditingQueueId(queue.id);
      setQueueForm({
        name: queue.name || '',
        color: queue.color || '#3b82f6',
        description: queue.description || '',
        entryMessage: queue.entryMessage || '',
        waitingMessage: queue.waitingMessage || '',
        active: queue.active !== false
      });
    } else {
      setEditingQueueId(null);
      setQueueForm(emptyQueueForm);
    }
    setQueueModalOpen(true);
  };

  const closeQueueModal = () => {
    setQueueModalOpen(false);
    setEditingQueueId(null);
    setQueueForm(emptyQueueForm);
  };

  const handleSaveQueue = async () => {
    if (!queueForm.name.trim()) return toast.error('Informe o nome da fila');
    const wasEditing = Boolean(editingQueueId);
    const endpoint = editingQueueId ? `/queues/${editingQueueId}` : '/queues';
    const method = editingQueueId ? 'PUT' : 'POST';
    const res = await apiRequest(endpoint, {
      method,
      body: JSON.stringify(queueForm)
    });
    if (res?.ok) {
      closeQueueModal();
      await fetchQueues();
      await fetchUsers();
      toast.success(wasEditing ? 'Fila atualizada!' : 'Fila criada!');
    } else {
      const data = await res?.json().catch(() => null);
      toast.error(data?.error || 'Erro ao salvar fila');
    }
  };

  const handleEditQueue = (queue) => {
    openQueueModal(queue);
  };

  const cancelQueueEdit = () => {
    closeQueueModal();
  };

  const handleToggleQueueActive = async (queue) => {
    const res = await apiRequest(`/queues/${queue.id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...queue, active: queue.active === false })
    });
    if (res?.ok) {
      await fetchQueues();
      toast.success(queue.active === false ? 'Fila ativada' : 'Fila desativada');
    } else {
      toast.error('Erro ao atualizar fila');
    }
  };

  const openQueueAgentsModal = (queue) => {
    setQueueAgentModal(queue);
    setQueueAgentIds(
      users
        .filter((user) => user.role === 'AGENT' && Array.isArray(user.queues) && user.queues.includes(queue.name))
        .map((user) => user.id)
    );
  };

  const toggleQueueAgent = (agentId) => {
    setQueueAgentIds((current) => (
      current.includes(agentId)
        ? current.filter((id) => id !== agentId)
        : [...current, agentId]
    ));
  };

  const selectAllQueueAgents = () => {
    setQueueAgentIds(users.filter((user) => user.role === 'AGENT').map((user) => user.id));
  };

  const clearQueueAgents = () => {
    setQueueAgentIds([]);
  };

  const saveQueueAgents = async () => {
    if (!queueAgentModal?.id) return;
    setSavingQueueAgents(true);
    try {
      const res = await apiRequest(`/queues/${queueAgentModal.id}/agents`, {
        method: 'PUT',
        body: JSON.stringify({ agentIds: queueAgentIds })
      });
      if (!res?.ok) {
        const data = await res?.json().catch(() => null);
        throw new Error(data?.error || 'Erro ao vincular agentes');
      }
      await fetchUsers();
      setQueueAgentModal(null);
      toast.success('Agentes vinculados');
    } catch (error) {
      toast.error(error.message || 'Erro ao vincular agentes');
    } finally {
      setSavingQueueAgents(false);
    }
  };

  const handleDeleteQueue = async (id) => {
    const ok = await confirm({
      title: 'Excluir fila',
      message: 'Tem certeza? Agentes vinculados a esta fila perderão o acesso a ela.',
      confirmText: 'Excluir fila',
      type: 'danger',
    });
    if (!ok) return;

    const previousQueues = queues;
    setQueues(prev => prev.filter(q => q.id !== id));

    try {
      const res = await apiRequest(`/queues/${id}`, { method: 'DELETE' });
      if (!res || !res.ok) {
        setQueues(previousQueues);
        toast.error("Erro ao excluir fila");
      }
    } catch (error) {
      setQueues(previousQueues);
      toast.error("Erro ao excluir fila");
    }
  };

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const res = await apiRequest('/users?limit=200&page=1');
      if (res) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data?.items || []);
        setUsers(list);

      }
    } catch (error) {
      toast.error('Erro ao carregar Usuários');
    } finally {
      setLoading(false);
    }
  };

  const openUserModal = (user = null) => {
    if (user) {
      setEditingUserId(user.id);
      setForm({
        name: user.name || '',
        username: user.username || '',
        password: '',
        role: user.role || 'AGENT',
        queues: Array.isArray(user.queues) ? user.queues : []
      });
    } else {
      setEditingUserId(null);
      setForm(emptyUserForm);
    }
    setUserModalOpen(true);
  };

  const closeUserModal = () => {
    setUserModalOpen(false);
    setEditingUserId(null);
    setForm(emptyUserForm);
  };

  const toggleQueue = (q) => {


    const newQueues = form.queues.includes(q.name)
      ? form.queues.filter(name => name !== q.name)
      : [...form.queues, q.name];

    setForm({ ...form, queues: newQueues });
  };

  const handleSave = async (e) => {
    e?.preventDefault();
    if (!form.name || !form.username || (!editingUserId && !form.password)) return toast.error("Preencha nome, usuario e senha.");
    if (form.password && form.password.length < 6) return toast.error("A senha deve ter pelo menos 6 caracteres.");

    try {
      let effectiveTenantId = tenant?.id && tenant.id !== 'super_admin' ? tenant.id : null;
      if (!effectiveTenantId) {
        try {
          const saved = localStorage.getItem('selectedTenant');
          const parsed = saved ? JSON.parse(saved) : null;
          if (parsed?.id && parsed.id !== 'super_admin') {
            effectiveTenantId = parsed.id;
          }
        } catch (err) { }
      }
      if (!effectiveTenantId) {
        return toast.error("Selecione um tenant antes de criar o agente.");
      }

      const userData = {
        ...form,
        tenantId: effectiveTenantId
      };
      if (editingUserId && !userData.password) {
        delete userData.password;
      }

      const res = await apiRequest(editingUserId ? `/users/${editingUserId}` : '/users', {
        method: editingUserId ? 'PUT' : 'POST',
        body: JSON.stringify(userData)
      });

      if (res?.ok) {
        toast.success(editingUserId ? 'Usuario atualizado!' : 'Usuario criado com sucesso!');
        closeUserModal();
        await fetchUsers();
      } else {
        const data = await res?.json().catch(() => null);
        toast.error(data?.error || 'Erro ao salvar usuario');
      }
    } catch (error) {
      toast.error(error.message || "Erro ao salvar");
    }
  };

  const handleDelete = async (id) => {
    const ok = await confirm({
      title: 'Remover usuário',
      message: 'Tem certeza que deseja remover este usuário?',
      confirmText: 'Remover',
      type: 'danger',
    });
    if (!ok) return;

    const previousUsers = users;
    setUsers(prev => prev.filter(u => u.id !== id));

    try {
      const res = await apiRequest(`/users/${id}`, { method: 'DELETE' });
      if (res && res.ok) {
        toast.success("Usuário removido");
      } else {
        setUsers(previousUsers);
        toast.error("Erro ao excluir Usuário");
      }
    } catch (error) {
      setUsers(previousUsers);
      toast.error("Erro ao excluir");
    }
  };

  const openAgentModal = async (agent) => {
    setSelectedAgent(agent);
    setAgentChats([]);
    setAgentStats({ total: 0, uniqueCustomers: 0 });
    setLoadingAgentChats(true);
    try {
      const res = await apiRequest(`/chats/agent/${agent.id}?limit=100`);
      if (res && res.ok) {
        const data = await res.json();
        setAgentChats(Array.isArray(data.chats) ? data.chats : []);
        setAgentStats({
          total: Number(data.total || 0),
          uniqueCustomers: Number(data.uniqueCustomers || 0)
        });
      }
    } catch (error) {
      toast.error('Erro ao carregar Histórico do Agente');
    } finally {
      setLoadingAgentChats(false);
    }
  };

  const closeAgentModal = () => {
    setSelectedAgent(null);
  };

  const roleBadge = (role) => {
    const styles = {
      ADMIN: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
      MANAGER: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
      AGENT: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
    };
    const Icon = role === 'ADMIN' ? Shield : role === 'MANAGER' ? Briefcase : Headset;

    return (
      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[role] || styles.AGENT}`}>
        <Icon size={12} /> {role}
      </span>
    );
  };

  const renderStars = (avg) => {
    const value = Number(avg || 0);
    return (
      <div className="flex items-center gap-0.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Star
            key={i}
            size={14}
            className={i < Math.round(value) ? 'text-yellow-500' : 'text-gray-300 dark:text-gray-600'}
            fill={i < Math.round(value) ? 'currentColor' : 'none'}
          />
        ))}
      </div>
    );
  };

  return (
    <>
      <div className="p-3 sm:p-4 lg:p-6 max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Gestão de Equipe</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Gerencie acessos e permissões</p>
          </div>
          <button
            onClick={() => openUserModal()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors shadow-sm"
          >
            <UserPlus size={16} />
            Novo usuario
          </button>
        </div>

        <div>
          { }
          <div className="hidden">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-blue-500" /> Novo Usuário
            </h2>

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome</label>
                <input
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder=""
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Usuário</label>
                  <input
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    value={form.username}
                    onChange={e => setForm({ ...form, username: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Senha</label>
                  <input
                    type="password"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    value={form.password}
                    onChange={e => setForm({ ...form, password: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cargo</label>
                <select
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  value={form.role}
                  onChange={e => setForm({ ...form, role: e.target.value })}
                >
                  <option value="AGENT">Atendente</option>
                  <option value="MANAGER">Gestor</option>
                  <option value="ADMIN">Administrador</option>
                </select>
              </div>

              {form.role === 'AGENT' && (
                <div className="bg-gray-50 dark:bg-gray-700/50 p-3 rounded-lg border border-gray-200 dark:border-gray-600">
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Filas de Atendimento</label>
                  <div className="space-y-2 flex flex-col">
                    {queues.map(q => (
                      <label key={q.id} className="">
                        <input
                          type="checkbox"
                          checked={form.queues.includes(q.name)}
                          onChange={() => toggleQueue(q)}
                          className="mr-2"
                        />
                        <span>{q.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <button type="submit" className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors shadow-sm">
                Criar Acesso
              </button>
            </form>
          </div>

          { }
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
            {loading ? (
              <div className="p-8 text-center text-gray-500">Carregando...</div>
            ) : users.length === 0 ? (
              <div className="p-8 text-center text-gray-500">Nenhum Usuário encontrado.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left min-w-[720px]">

                  <thead className="bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-400 uppercase font-medium">
                    <tr>
                      <th className="px-6 py-3">Nome</th>
                      <th className="px-6 py-3">Login</th>
                      <th className="px-6 py-3">Cargo</th>
                      <th className="px-6 py-3">Filas</th>
                      <th className="px-6 py-3">Avaliação</th>
                      <th className="px-6 py-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {users.map(u => (
                      <tr
                        key={u.id}
                        className="h-16 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                      >
                        <td className="px-6 py-4 font-medium text-gray-900 dark:text-white flex items-center gap-3">
                          <div className="w-8 min-w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-xs">
                            {u.name.charAt(0)}
                          </div>
                          {u.name}
                        </td>

                        <td className="px-6 py-4 text-gray-600 dark:text-gray-300 font-mono">
                          {u.username}
                        </td>

                        <td className="px-6 py-4">
                          {roleBadge(u.role)}
                        </td>

                        <td className="px-6 py-4 text-gray-500 dark:text-gray-400">
                          <div
                            title={u.role === 'AGENT' ? u.queues.join(', ') : '-'}
                            className="max-w-xs overflow-hidden whitespace-nowrap truncate"
                          >
                            {u.role === 'AGENT'
                              ? (u.queues.length ? u.queues.join(', ') : 'Nenhuma')
                              : '-'}
                          </div>
                        </td>

                        <td className="px-6 py-4">
                          {u.role === 'AGENT' ? (
                            <div className="flex items-center gap-2">
                              {renderStars(u.ratingAvg)}
                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                {Number(u.ratingAvg || 0).toFixed(1)} ({u.ratingCount || 0})
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">-</span>
                          )}
                        </td>


                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {u.role === 'AGENT' && (
                              <button
                                onClick={() => openAgentModal(u)}
                                className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                title="Ver atendimentos"
                              >
                                <MessageSquareText size={16} />
                              </button>
                            )}
                            <button
                              onClick={() => openUserModal(u)}
                              className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              title="Editar usuario"
                            >
                              <Edit size={16} />
                            </button>
                            <button
                              onClick={() => handleDelete(u.id)}
                              className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="Excluir"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}

                  </tbody>
                </table>

              </div>
            )}

          </div>
        </div>
        <div className="mt-10">
          <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Users size={20} className="text-blue-500" /> Configuracao de Filas
            </h2>
            <button
              onClick={() => openQueueModal()}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors shadow-sm"
            >
              <Users size={16} />
              Nova fila
            </button>
          </div>

          <div>
            <div className="hidden">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                    {editingQueueId ? 'Editar fila' : 'Nova fila'}
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Defina aparencia, status e mensagens operacionais.
                  </p>
                </div>
                {editingQueueId && (
                  <button
                    onClick={cancelQueueEdit}
                    className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700"
                    title="Cancelar edicao"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome da fila</label>
                  <input
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500"
                    placeholder="Ex: VENDAS"
                    value={queueForm.name}
                    onChange={e => setQueueForm({ ...queueForm, name: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-[64px_1fr] gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cor</label>
                    <input
                      type="color"
                      className="h-10 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 p-1"
                      value={queueForm.color}
                      onChange={e => setQueueForm({ ...queueForm, color: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
                    <button
                      type="button"
                      onClick={() => setQueueForm({ ...queueForm, active: !queueForm.active })}
                      className={`h-10 w-full rounded-lg border px-3 text-sm font-medium transition-colors ${
                        queueForm.active
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300'
                          : 'border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {queueForm.active ? 'Ativa' : 'Inativa'}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descricao interna</label>
                  <textarea
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 resize-none"
                    placeholder="Quando essa fila deve ser usada?"
                    value={queueForm.description}
                    onChange={e => setQueueForm({ ...queueForm, description: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mensagem ao entrar na fila</label>
                  <textarea
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 resize-none"
                    placeholder="Ex: Aguarde, um atendente vai te responder."
                    value={queueForm.entryMessage}
                    onChange={e => setQueueForm({ ...queueForm, entryMessage: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mensagem de espera</label>
                  <textarea
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 resize-none"
                    placeholder="Opcional: aviso caso o cliente fique aguardando."
                    value={queueForm.waitingMessage}
                    onChange={e => setQueueForm({ ...queueForm, waitingMessage: e.target.value })}
                  />
                </div>

                <button onClick={handleSaveQueue} className="w-full inline-flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">
                  {editingQueueId ? <Save size={16} /> : <Users size={16} />}
                  {editingQueueId ? 'Salvar fila' : 'Criar fila'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {queues.length === 0 ? (
                <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-gray-500">
                  Nenhuma fila criada ainda.
                </div>
              ) : queues.map(q => {
                const linkedAgents = users.filter((user) => user.role === 'AGENT' && Array.isArray(user.queues) && user.queues.includes(q.name));
                const isActive = q.active !== false;
                return (
                  <div
                    key={q.id}
                    className={`bg-white dark:bg-gray-800 rounded-xl border shadow-sm overflow-hidden transition-all hover:shadow-md ${
                      isActive ? 'border-gray-200 dark:border-gray-700' : 'border-gray-200 dark:border-gray-700 opacity-70'
                    }`}
                  >
                    <div className="h-1.5" style={{ backgroundColor: q.color || '#3b82f6' }} />
                    <div className="p-4 space-y-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: q.color || '#3b82f6' }} />
                            <h3 className="font-bold text-gray-900 dark:text-white truncate">{q.name}</h3>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                              isActive
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
                                : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300'
                            }`}>
                              {isActive ? 'ATIVA' : 'INATIVA'}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                            {q.description || 'Sem descricao interna.'}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => handleEditQueue(q)} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Editar">
                            <Edit size={16} />
                          </button>
                          <button onClick={() => handleToggleQueueActive(q)} className="p-2 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors" title={isActive ? 'Desativar' : 'Ativar'}>
                            {isActive ? <PowerOff size={16} /> : <Power size={16} />}
                          </button>
                          <button onClick={() => handleDeleteQueue(q.id)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Excluir">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2">
                        <div className="min-w-0 flex items-center gap-2 text-xs">
                          <span className="font-semibold text-gray-500 dark:text-gray-400">Agentes:</span>
                          <span className="truncate text-gray-700 dark:text-gray-300">
                            {linkedAgents.length === 0
                              ? 'nenhum'
                              : linkedAgents.slice(0, 3).map((agent) => agent.name || agent.username).join(', ')}
                            {linkedAgents.length > 3 ? ` +${linkedAgents.length - 3}` : ''}
                          </span>
                        </div>
                        <button
                          onClick={() => openQueueAgentsModal(q)}
                          className="shrink-0 h-7 w-8 inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                          title="Alocar agentes"
                          aria-label="Alocar agentes"
                        >
                          ...
                        </button>
                      </div>

                      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                        <p className="text-[10px] uppercase font-bold text-gray-400">Criada em</p>
                        <p className="text-xs font-medium text-gray-600 dark:text-gray-300">
                          {q.createdAt ? new Date(q.createdAt).toLocaleDateString() : '-'}
                        </p>
                      </div>

                      <div className="space-y-2 text-xs">
                        <div className="rounded-lg bg-gray-50 dark:bg-gray-700/50 p-3">
                          <p className="font-semibold text-gray-500 dark:text-gray-300 mb-1">Mensagem de entrada</p>
                          <p className="text-gray-600 dark:text-gray-300 line-clamp-2">{q.entryMessage || 'Nao configurada.'}</p>
                        </div>
                        <div className="rounded-lg bg-gray-50 dark:bg-gray-700/50 p-3">
                          <p className="font-semibold text-gray-500 dark:text-gray-300 mb-1">Mensagem de espera</p>
                          <p className="text-gray-600 dark:text-gray-300 line-clamp-2">{q.waitingMessage || 'Nao configurada.'}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      {userModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-3 sm:p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                  {editingUserId ? 'Editar usuario' : 'Novo usuario'}
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {editingUserId ? 'Atualize acesso, cargo e filas.' : 'Crie um acesso para equipe do tenant.'}
                </p>
              </div>
              <button
                onClick={closeUserModal}
                className="p-2 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSave}>
              <div className="p-4 sm:p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome</label>
                  <input
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Usuario</label>
                    <input
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                      value={form.username}
                      onChange={e => setForm({ ...form, username: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Senha {editingUserId && <span className="text-xs text-gray-400">(deixe vazio para manter)</span>}
                    </label>
                    <input
                      type="password"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                      value={form.password}
                      onChange={e => setForm({ ...form, password: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cargo</label>
                  <select
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    value={form.role}
                    onChange={e => setForm({ ...form, role: e.target.value, queues: e.target.value === 'AGENT' ? form.queues : [] })}
                  >
                    <option value="AGENT">Atendente</option>
                    <option value="MANAGER">Gestor</option>
                    <option value="ADMIN">Administrador</option>
                  </select>
                </div>

                {form.role === 'AGENT' && (
                  <div className="bg-gray-50 dark:bg-gray-800/80 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Filas de atendimento</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {queues.length === 0 ? (
                        <span className="text-sm text-gray-500">Nenhuma fila criada.</span>
                      ) : queues.map(q => (
                        <label key={q.id} className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={form.queues.includes(q.name)}
                            onChange={() => toggleQueue(q)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="truncate">{q.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="px-4 sm:px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeUserModal}
                  className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  Cancelar
                </button>
                <button type="submit" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
                  <Save size={16} />
                  {editingUserId ? 'Salvar usuario' : 'Criar usuario'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {queueModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-3 sm:p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                  {editingQueueId ? 'Editar fila' : 'Nova fila'}
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Defina aparencia, status e mensagens operacionais.
                </p>
              </div>
              <button
                onClick={closeQueueModal}
                className="p-2 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome da fila</label>
                <input
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500"
                  placeholder="Ex: VENDAS"
                  value={queueForm.name}
                  onChange={e => setQueueForm({ ...queueForm, name: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-[72px_1fr] gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cor</label>
                  <input
                    type="color"
                    className="h-10 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 p-1"
                    value={queueForm.color}
                    onChange={e => setQueueForm({ ...queueForm, color: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
                  <button
                    type="button"
                    onClick={() => setQueueForm({ ...queueForm, active: !queueForm.active })}
                    className={`h-10 w-full rounded-lg border px-3 text-sm font-medium transition-colors ${
                      queueForm.active
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300'
                        : 'border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {queueForm.active ? 'Ativa' : 'Inativa'}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descricao interna</label>
                <textarea
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 resize-none"
                  placeholder="Quando essa fila deve ser usada?"
                  value={queueForm.description}
                  onChange={e => setQueueForm({ ...queueForm, description: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mensagem ao entrar na fila</label>
                <textarea
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 resize-none"
                  placeholder="Ex: Aguarde, um atendente vai te responder."
                  value={queueForm.entryMessage}
                  onChange={e => setQueueForm({ ...queueForm, entryMessage: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mensagem de espera</label>
                <textarea
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 resize-none"
                  placeholder="Opcional: aviso caso o cliente fique aguardando."
                  value={queueForm.waitingMessage}
                  onChange={e => setQueueForm({ ...queueForm, waitingMessage: e.target.value })}
                />
              </div>
            </div>

            <div className="px-4 sm:px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
              <button
                onClick={closeQueueModal}
                className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Cancelar
              </button>
              <button onClick={handleSaveQueue} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
                <Save size={16} />
                {editingQueueId ? 'Salvar fila' : 'Criar fila'}
              </button>
            </div>
          </div>
        </div>
      )}

      {queueAgentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-3 sm:p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Alocar agentes</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {queueAgentModal.name} • {queueAgentIds.length} selecionado(s)
                </p>
              </div>
              <button
                onClick={() => setQueueAgentModal(null)}
                className="p-2 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </div>

            <div className="px-4 sm:px-6 py-3 border-b border-gray-200 dark:border-gray-700 flex flex-wrap items-center gap-2">
              <button
                onClick={selectAllQueueAgents}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-300 dark:hover:bg-blue-900/30"
              >
                Selecionar todos
              </button>
              <button
                onClick={clearQueueAgents}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Limpar alocacao
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-3 max-h-[60vh] overflow-y-auto">
              {users.filter((user) => user.role === 'AGENT').length === 0 ? (
                <div className="text-center text-sm text-gray-500 py-6">
                  Nenhum atendente cadastrado.
                </div>
              ) : users.filter((user) => user.role === 'AGENT').map((agent) => (
                <label
                  key={agent.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 dark:border-gray-700 p-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <input
                      type="checkbox"
                      checked={queueAgentIds.includes(agent.id)}
                      onChange={() => toggleQueueAgent(agent.id)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-gray-900 dark:text-white truncate">{agent.name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{agent.username}</p>
                    </div>
                  </div>
                  <span className="text-[10px] uppercase font-bold text-gray-400">
                    {Array.isArray(agent.queues) ? agent.queues.length : 0} filas
                  </span>
                </label>
              ))}
            </div>

            <div className="px-4 sm:px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
              <button
                onClick={() => setQueueAgentModal(null)}
                className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Cancelar
              </button>
              <button
                onClick={saveQueueAgents}
                disabled={savingQueueAgents}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
              >
                {savingQueueAgents ? 'Salvando...' : 'Salvar agentes'}
              </button>
            </div>
          </div>
        </div>
      )}
      {selectedAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-3 sm:p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-4xl border border-gray-200 dark:border-gray-700 overflow-hidden max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Histórico do Agente</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">{selectedAgent.name} • {selectedAgent.username}</p>
              </div>
              <button
                onClick={closeAgentModal}
                className="p-2 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </div>

            <div className="px-4 sm:px-6 py-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                <p className="text-xs text-gray-500 dark:text-gray-400">Chats atribuídos</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{agentStats.total}</p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                <p className="text-xs text-gray-500 dark:text-gray-400">Clientes únicos</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{agentStats.uniqueCustomers}</p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                <p className="text-xs text-gray-500 dark:text-gray-400">Média de avaliação</p>
                <div className="flex items-center gap-2 mt-1">
                  {renderStars(selectedAgent.ratingAvg)}
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {Number(selectedAgent.ratingAvg || 0).toFixed(1)} ({selectedAgent.ratingCount || 0})
                  </span>
                </div>
              </div>
            </div>

            <div className="px-4 sm:px-6 pb-6 flex-1 overflow-hidden">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Últimos atendimentos</h4>
                <span className="text-xs text-gray-500 dark:text-gray-400">Mostrando até 100 registros</span>
              </div>
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden max-h-[420px] overflow-y-auto">
                {loadingAgentChats ? (
                  <div className="p-6 text-center text-gray-500">Carregando histórico...</div>
                ) : agentChats.length === 0 ? (
                  <div className="p-6 text-center text-gray-500">Nenhum atendimento encontrado.</div>
                ) : (
                  <table className="w-full text-sm text-left min-w-[720px]">
                    <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                      <tr>
                        <th className="px-4 py-3">Data</th>
                        <th className="px-4 py-3">Cliente</th>
                        <th className="px-4 py-3">Canal</th>
                        <th className="px-4 py-3">Fila</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Última mensagem</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {agentChats.map((chat) => {
                        const lastMessage = Array.isArray(chat.messages) && chat.messages.length
                          ? chat.messages[chat.messages.length - 1]
                          : null;
                        return (
                          <tr key={chat.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/60">
                            <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                              {chat.updatedAt ? new Date(chat.updatedAt).toLocaleString() : 'N/A'}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-300">
                              {chat.customerCpf || chat.channelUserId || chat.channelChatId || 'N/A'}
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                              {chat.channel || 'web'}
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                              {chat.queue || chat.transferredTo || '-'}
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                              {chat.status || '-'}
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-300 truncate max-w-[220px]">
                              {lastMessage?.text || '-'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

    </>
  );
};

export default AgentManager;





