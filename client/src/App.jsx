import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { Routes, Route, NavLink, Navigate, useParams, useNavigate, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from './context/AuthContext';
import { TenantProvider, useTenant } from './context/TenantContext';
import { apiRequest } from './services/api';
import { socketService } from './services/socket';
import Login from './pages/Login';
import {
  LayoutDashboard, Workflow, Users, FileText, Database,
  CalendarClock, MessageSquare, Headset, LogOut, Bot,
  Activity, ScrollText, Moon, Sun, Bell, Menu, X, Building2, Box, PhoneCall, CreditCard, BarChart3,
  Shield, BrainCircuit, Youtube
} from 'lucide-react';
import OnionBrandIcon from './components/OnionBrandIcon';
import SpotifyGlobalPlayer from './components/SpotifyGlobalPlayer';
import SpotifyCallback from './pages/SpotifyCallback';


const FlowList = lazy(() => import('./pages/FlowList'));
const FlowEditor = lazy(() => import('./pages/FlowEditor'));
const VariableManager = lazy(() => import('./pages/VariableManager'));
const TemplateManager = lazy(() => import('./pages/TemplateManager'));
const AgentManager = lazy(() => import('./pages/AgentManager'));
const AgentWorkspace = lazy(() => import('./pages/AgentWorkspace'));
const AgentDashboard = lazy(() => import('./pages/AgentDashboard'));
const ActiveContacts = lazy(() => import('./pages/ActiveContacts'));
const ScheduleManager = lazy(() => import('./pages/ScheduleManager'));
const MonitoringDashboard = lazy(() => import('./pages/MonitoringDashboard'));
const SystemLogs = lazy(() => import('./pages/SystemLogs'));
const ChatHistory = lazy(() => import('./pages/ChatHistory'));
const AnalyticsDashboard = lazy(() => import('./pages/AnalyticsDashboard'));
const Catalog = lazy(() => import('./pages/Catalog'));
const AdminPanel = lazy(() => import('./pages/AdminPanel'));
const SuperAdminDashboard = lazy(() => import('./pages/SuperAdminDashboard'));
const BillingManager = lazy(() => import('./pages/BillingManager'));
const Channels = lazy(() => import('./pages/Channels'));
const SecurityCenter = lazy(() => import('./pages/SecurityCenter'));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'));
const ReportsCenter = lazy(() => import('./pages/ReportsCenter'));
const AiMemoryManager = lazy(() => import('./pages/AiMemoryManager'));

const LoadingSpinner = () => (
  <div className="flex items-center justify-center h-full">
    <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
  </div>
);


const TenantIndexRedirect = () => {
  const { tenantId } = useParams();
  return <Navigate to={`/tenant/${tenantId}/monitor`} replace />;
};

const normalizePathname = (pathname) => {
  if (!pathname) return '/';
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1);
  }
  return pathname;
};

const isEditorPath = (pathname) => /\/editor\/[^/]+$/.test(normalizePathname(pathname));

const isAdminGlobalPath = (pathname) => {
  const normalized = normalizePathname(pathname);
  return normalized === '/super-admin' || normalized === '/admin' || normalized === '/system-logs';
};

const getPageLabel = (pathname) => {
  const normalized = normalizePathname(pathname);

  if (normalized === '/login') return 'Login';
  if (normalized === '/super-admin') return 'Dashboard';
  if (normalized === '/admin') return 'Tenants';
  if (normalized === '/system-logs') return 'Logs';
  if (/\/monitor$/.test(normalized)) return 'Monitoramento';
  if (/\/analytics$/.test(normalized)) return 'Analytics';
  if (/\/history$/.test(normalized)) return 'Historico';
  if (/\/catalog$/.test(normalized)) return 'Catalogo';
  if (/\/flows$/.test(normalized)) return 'Fluxos';
  if (/\/users$/.test(normalized)) return 'Equipe';
  if (/\/templates$/.test(normalized)) return 'Templates';
  if (/\/variables$/.test(normalized)) return 'Variaveis';
  if (normalized === '/agent-memory') return 'Minha memoria da IA';
  if (/\/schedules$/.test(normalized)) return 'Expediente';
  if (/\/channels$/.test(normalized)) return 'Canais';
  if (normalized === '/agent') return 'Meu Atendimento';
  if (normalized === '/agent-dashboard') return 'Meu Dashboard';
  if (normalized === '/agent-active') return 'Atendimento Ativo';
  if (isEditorPath(normalized)) return 'Editor de Fluxo';
  return 'Onion Flows';
};

const AppContent = () => {
  const { user, logout } = useAuth();
  const { tenant } = useTenant();
  const navigate = useNavigate();
  const location = useLocation();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  /**
   * Desktop: colapsar no !hover só no espaço do agente (role AGENT).
   * Super admin / admin / manager: barra sempre expandida com labels.
   */
  const isAgentRole = user?.role === 'AGENT';
  const [sidebarExpanded, setSidebarExpanded] = useState(() => !isAgentRole);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('theme') === 'dark');
  const preferencesHydratedUserRef = useRef('');
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [youtubePanelOpen, setYoutubePanelOpen] = useState(false);
  const notifRef = useRef(null);
  const lastQueueCountRef = useRef(0);
  const sidebarLeaveTimer = useRef(null);
  const isAgentWorkspace = normalizePathname(location.pathname) === '/agent';

  useEffect(() => {
    if (!isAgentWorkspace) setYoutubePanelOpen(false);
  }, [isAgentWorkspace]);

  // Garante: fora do agente a sidebar nunca fica colapsada
  useEffect(() => {
    if (!isAgentRole) {
      if (sidebarLeaveTimer.current) {
        clearTimeout(sidebarLeaveTimer.current);
        sidebarLeaveTimer.current = null;
      }
      setSidebarExpanded(true);
    } else {
      setSidebarExpanded(false);
    }
  }, [isAgentRole]);

  useEffect(() => {
    const pathname = normalizePathname(location.pathname);
    if (!user) {
      document.title = pathname === '/login' ? 'Login - Onion Flows' : 'Onion Flows';
      return;
    }

    if (isEditorPath(pathname)) return;

    const pageLabel = getPageLabel(pathname);
    const tenantName = tenant?.name ? String(tenant.name).trim() : '';

    if (isAdminGlobalPath(pathname)) {
      document.title = `${pageLabel} - adm`;
      return;
    }

    if (tenantName) {
      document.title = `${tenantName} - ${pageLabel}`;
      return;
    }

    if (user.role === 'SUPER_ADMIN') {
      document.title = `${pageLabel} - adm`;
      return;
    }

    document.title = `${pageLabel} - Onion Flows`;
  }, [location.pathname, tenant?.name, user]);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [darkMode]);

  useEffect(() => {
    if (!user?.id || preferencesHydratedUserRef.current === user.id) return;
    preferencesHydratedUserRef.current = user.id;
    apiRequest('/auth/me/preferences').then(async (response) => {
      if (!response?.ok) return;
      const data = await response.json().catch(() => ({}));
      if (data?.preferences?.theme) setDarkMode(data.preferences.theme === 'dark');
    }).catch(() => {});
  }, [user?.id]);

  const togglePersistedTheme = () => {
    const nextDarkMode = !darkMode;
    setDarkMode(nextDarkMode);
    apiRequest('/auth/me/preferences', {
      method: 'PUT',
      body: JSON.stringify({ theme: nextDarkMode ? 'dark' : 'light' })
    }).catch(() => toast.error('Tema aplicado, mas não foi salvo no arquivo local'));
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (notifRef.current && !notifRef.current.contains(event.target)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const addNotification = (data) => {
    const entry = {
      id: `n_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      title: data.title,
      message: data.message,
      type: data.type,
      action: data.action || null,
      createdAt: new Date().toISOString(),
      read: false
    };
    setNotifications(prev => [entry, ...prev].slice(0, 50));
  };

  const markAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem('token');
    if (token) socketService.connect(token);

    const onQueueUpdate = (payload) => {
      if (user.role !== 'AGENT') return;
      const chat = payload?.chat || payload;
      const queueName = chat?.queue || chat?.transferredTo || 'Fila';
      addNotification({
        type: 'queue',
        title: 'Novo cliente na fila',
        message: `Chegou um cliente na fila ${queueName}.`,
        action: '/agent'
      });
    };

    const onNewLog = (payload) => {
      if (user.role === 'AGENT') return;
      const log = payload?.log || payload;
      const type = String(log?.type || '');
      if (type !== 'ERROR') return;
      addNotification({
        type: 'error',
        title: 'Erro crítico detectado',
        message: log?.message ? String(log.message).slice(0, 140) : 'Verifique os logs do sistema.',
        action: '/system-logs'
      });
    };

    const onWhatsAppError = (alert) => {
      if (!['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(user.role)) return;
      const title = alert?.title || 'Erro WhatsApp';
      const message = alert?.message || 'O WhatsApp retornou um erro.';
      addNotification({
        type: 'whatsapp_error',
        title,
        message,
        action: '/system-logs'
      });
      toast.error(`${title}: ${message}`, { duration: 7000 });
    };

    const onExtensionError = (alert) => {
      if (user.role !== 'AGENT') return;
      const title = alert?.title || 'Falha na extensão Onion';
      const summary = alert?.message || 'A extensão registrou uma falha.';
      const detail = alert?.detail ? ` — ${alert.detail}` : '';
      const message = `${summary}${detail}`.slice(0, 260);
      addNotification({
        type: 'extension_error',
        title,
        message,
        action: '/agent'
      });
      toast.error(`${title}: ${message}`, { duration: 7000 });
    };

    socketService.on('queue_update', onQueueUpdate);
    socketService.on('new_log', onNewLog);
    socketService.on('whatsapp_error', onWhatsAppError);
    socketService.on('extension_error', onExtensionError);

    return () => {
      socketService.off('queue_update', onQueueUpdate);
      socketService.off('new_log', onNewLog);
      socketService.off('whatsapp_error', onWhatsAppError);
      socketService.off('extension_error', onExtensionError);
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    if (isEditorPath(location.pathname)) return;
    if (window.innerWidth <= 768 || window.navigator?.connection?.saveData) return;
    const prefetches = [];

    if (user.role === 'SUPER_ADMIN') {
      return;
    } else if (user.role === 'ADMIN' || user.role === 'MANAGER') {
      prefetches.push(
        () => import('./pages/MonitoringDashboard'),
        () => import('./pages/ChatHistory'),
        () => import('./pages/Catalog'),
        () => import('./pages/FlowList'),
        () => import('./pages/TemplateManager'),
        () => import('./pages/VariableManager'),
        () => import('./pages/Channels'),
        () => import('./pages/AgentManager'),
        () => import('./pages/ScheduleManager')
      );
    } else if (user.role === 'AGENT') {
      prefetches.push(
        () => import('./pages/AgentWorkspace'),
        () => import('./pages/ActiveContacts')
      );
    }

    const run = () => {
      prefetches.forEach((fn) => {
        try {
          fn();
        } catch (e) {
          // ignore prefetch errors
        }
      });
    };

    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(run, { timeout: 2000 });
      return () => window.cancelIdleCallback(id);
    }

    const timer = setTimeout(run, 1500);
    return () => clearTimeout(timer);
  }, [location.pathname, user]);

  useEffect(() => {
    if (!user) return;
    if (user.role === 'SUPER_ADMIN') return;

    let active = true;
    const checkQueues = async () => {
      try {
        if (user.role === 'AGENT') {
          // Modo Genesys: sem fila de espera / notificações de queue
          return;
        }

        const res = await apiRequest('/chats?limit=200&page=1&summary=1');
        if (res && res.ok && active) {
          const chatPayload = await res.json();
          const chatList = Array.isArray(chatPayload) ? chatPayload : (chatPayload?.items || []);
          const waiting = Array.isArray(chatList) ? chatList.filter(c => c.status === 'waiting').length : 0;
          if (waiting > lastQueueCountRef.current) {
            addNotification({
              type: 'queue',
              title: 'Fila com pendências',
              message: `${waiting} atendimento(s) aguardando agente.`,
              action: '/monitor'
            });
          }
          lastQueueCountRef.current = waiting;
        }
      } catch (e) {}
    };

    checkQueues();
    const interval = setInterval(checkQueues, 20000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [user, tenant]);

  if (normalizePathname(location.pathname) === '/spotify/callback') {
    return <SpotifyCallback />;
  }

  if (!user) {
    return (
      <Suspense fallback={<LoadingSpinner />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/privacidade" element={<PrivacyPolicy />} />
          <Route path="*" element={<Navigate to="/login" />} />
        </Routes>
      </Suspense>
    );
  }

  const NavItem = ({ to, icon: Icon, label, onClick }) => (
    <NavLink
      to={to}
      title={label}
      onClick={() => {
        setSidebarOpen(false);
        if (typeof onClick === 'function') onClick();
      }}
      className={({ isActive }) => `
        flex items-center rounded-md text-xs font-medium transition-all duration-200
        ${sidebarExpanded ? 'gap-2 px-2 py-1.5' : 'justify-center px-0 py-2'}
        ${isActive
          ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
          : 'text-slate-400 hover:bg-slate-800 hover:text-white'}
      `}
    >
      <Icon size={15} className="shrink-0" />
      <span
        className={`truncate transition-all duration-200 ${
          sidebarExpanded ? 'max-w-[140px] opacity-100' : 'max-w-0 overflow-hidden opacity-0'
        }`}
      >
        {label}
      </span>
    </NavLink>
  );

  const NavSection = ({ children }) => (
    <div
      className={`px-2 mt-3 mb-1 text-[9px] font-bold text-slate-500 uppercase tracking-wider transition-all duration-200 ${
        sidebarExpanded ? 'opacity-100 max-h-8' : 'opacity-0 max-h-0 overflow-hidden mt-0 mb-0'
      }`}
    >
      {children}
    </div>
  );

  const handleSidebarEnter = () => {
    if (!isAgentRole) return; // super admin / admin: sempre expandida
    if (sidebarLeaveTimer.current) {
      clearTimeout(sidebarLeaveTimer.current);
      sidebarLeaveTimer.current = null;
    }
    setSidebarExpanded(true);
  };

  const handleSidebarLeave = () => {
    if (!isAgentRole) return; // não colapsa fora do espaço do agente
    if (sidebarLeaveTimer.current) clearTimeout(sidebarLeaveTimer.current);
    // pequeno atraso evita flicker ao cruzar o limite
    sidebarLeaveTimer.current = setTimeout(() => {
      setSidebarExpanded(false);
      sidebarLeaveTimer.current = null;
    }, 180);
  };

  return (
    <div className={`onion-app-shell flex h-screen w-full bg-gray-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 transition-colors duration-300`}>

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`
  fixed lg:static inset-y-0 left-0 z-50
  bg-white dark:bg-slate-900
  border-r border-gray-200 dark:border-slate-800
  flex flex-col transition-all duration-300 ease-in-out
  ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
  ${sidebarExpanded || sidebarOpen ? 'w-52' : 'w-[3.75rem]'}
`}
      >
        <div className={`h-12 flex items-center border-b border-slate-800 gap-2 ${sidebarExpanded || sidebarOpen ? 'px-3' : 'justify-center px-0'}`}>
          <button
            type="button"
            onClick={() => { if (isAgentRole) setSidebarExpanded((expanded) => !expanded); }}
            title={isAgentRole ? (sidebarExpanded ? 'Recolher menu' : 'Expandir menu') : 'Onion Flows'}
            className={`flex h-9 w-9 shrink-0 items-center justify-center bg-transparent p-0 ${isAgentRole ? 'cursor-pointer transition-transform hover:scale-105' : 'cursor-default'}`}
          >
            <OnionBrandIcon size={30} />
          </button>
          <div className={`min-w-0 flex-1 transition-all duration-200 ${sidebarExpanded || sidebarOpen ? 'opacity-100' : 'max-w-0 opacity-0 overflow-hidden'}`}>
            <h1 className="text-xs font-bold text-slate-900 dark:text-white truncate">Onion Flows</h1>
            <p className="text-[9px] text-slate-500 font-medium tracking-wide truncate">Atendimento inteligente</p>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="ml-auto lg:hidden text-slate-400 shrink-0">
            <X size={16} />
          </button>
        </div>

        <div className={`border-b border-slate-800/50 ${sidebarExpanded || sidebarOpen ? 'p-2' : 'p-1.5'}`}>
          <div className={`flex items-center rounded-lg border border-gray-200 bg-gray-50 dark:border-slate-700/50 dark:bg-slate-800/50 min-w-0 ${sidebarExpanded || sidebarOpen ? 'gap-2 p-2' : 'justify-center p-1.5'}`}>
            <div
              className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-[11px] shadow-sm shrink-0"
              title={user.name || 'Nome não configurado'}
            >
              {(user.name || '?').charAt(0).toUpperCase()}
            </div>
            <div className={`min-w-0 flex-1 transition-all duration-200 ${sidebarExpanded || sidebarOpen ? 'opacity-100' : 'max-w-0 opacity-0 overflow-hidden'}`}>
              <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">{user.name || 'Sem nome'}</div>
              <div className="text-[9px] font-medium text-slate-400 uppercase tracking-wider truncate">{user.role}</div>
            </div>
          </div>
        </div>

        <nav className={`sidebar-scrollbar flex-1 overflow-y-auto py-2 space-y-0.5 ${sidebarExpanded || sidebarOpen ? 'px-1.5' : 'px-1'}`}>
          {user.role === 'AGENT' && (
            <>
              <NavItem to="/agent" icon={Headset} label="Meu Atendimento" />
              <NavItem to="/agent-dashboard" icon={BarChart3} label="Meu Dashboard" />
              <NavItem to="/agent-memory" icon={BrainCircuit} label="Minha memória da IA" />
              {/* Atendimento Ativo oculto no modo Genesys (só inbox) */}
            </>
          )}

          {user.role === 'SUPER_ADMIN' && (
            <>
              <NavSection>Administração</NavSection>
              <NavItem to="/billing" icon={CreditCard} label="Billing" />
              <NavItem to="/security" icon={Shield} label="Segurança" />
              <NavItem to="/super-admin" icon={LayoutDashboard} label="Dashboard Geral" onClick={() => {
                const raw = localStorage.getItem("selectedTenant");

                if (!raw) return;

                const tenant = JSON.parse(raw);

                if (tenant?.id !== "super_admin") {
                  localStorage.removeItem("selectedTenant");
                }
              }} />
              <NavItem to="/admin" icon={Building2} label="Tenants" />
              <NavItem to="/system-logs" icon={ScrollText} label="Logs Globais" />

              { }
              {tenant && tenant.id !== 'super_admin' && (
                <>
                  <div className="px-2 mt-3 mb-1 text-[9px] font-bold text-blue-500 uppercase tracking-wider truncate">
                    {tenant.name}
                  </div>
                  <NavItem to={`/tenant/${tenant.id}/monitor`} icon={Activity} label="Monitoramento" />
                  <NavItem to={`/tenant/${tenant.id}/analytics`} icon={BarChart3} label="Analytics" />
                  <NavItem to={`/tenant/${tenant.id}/history`} icon={MessageSquare} label="Histórico" />
                  <NavItem to={`/tenant/${tenant.id}/catalog`} icon={Box} label="Catálogo" />
                  <NavItem to={`/tenant/${tenant.id}/flows`} icon={Workflow} label="Fluxos" />
                  <NavItem to={`/tenant/${tenant.id}/users`} icon={Users} label="Equipe" />
                  <NavItem to={`/tenant/${tenant.id}/templates`} icon={FileText} label="Templates" />
                  <NavItem to={`/tenant/${tenant.id}/schedules`} icon={CalendarClock} label="Expediente" />
                  <NavItem to={`/tenant/${tenant.id}/variables`} icon={Database} label="Variáveis" />
                  <NavItem to={`/tenant/${tenant.id}/channels`} icon={Bot} label="Canais" />
                </>
              )}
            </>
          )}

          {user.role === 'MANAGER' && (
            <>
              <NavSection>Gestão</NavSection>
              <NavItem to="/analytics" icon={BarChart3} label="Indicadores" />
              <NavItem to="/monitor" icon={Activity} label="Operação ao vivo" />
              <NavItem to="/history" icon={MessageSquare} label="Histórico" />
              <NavItem to="/reports" icon={ScrollText} label="Relatórios" />
            </>
          )}

          {user.role === 'ADMIN' && (
            <>
              <NavSection>Operação</NavSection>
              <NavItem to="/monitor" icon={Activity} label="Monitoramento" />
              <NavItem to="/analytics" icon={BarChart3} label="Analytics" />
              <NavItem to="/history" icon={MessageSquare} label="Histórico" />
              <NavItem to="/catalog" icon={Box} label="Catálogo" />
              <NavItem to="/channels" icon={Bot} label="Canais" />

              <NavSection>Fluxos</NavSection>
              <NavItem to="/flows" icon={Workflow} label="Fluxos de Conversa" />
              <NavItem to="/templates" icon={FileText} label="Templates" />
              <NavItem to="/variables" icon={Database} label="Variáveis" />
            </>
          )}

          {user.role === 'ADMIN' && (
            <>
              <NavSection>Sistema</NavSection>
              <NavItem to="/users" icon={Users} label="Gestão de Equipe" />
              <NavItem to="/schedules" icon={CalendarClock} label="Expediente" />
              <NavItem to="/security" icon={Shield} label="Segurança" />
            </>
          )}
        </nav>

        <div className={`border-t border-slate-800 ${sidebarExpanded || sidebarOpen ? 'p-2' : 'p-1.5'}`}>
          <button
            onClick={logout}
            title="Sair"
            className={`flex items-center w-full rounded-md text-xs font-medium text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors ${
              sidebarExpanded || sidebarOpen ? 'justify-center gap-1.5 py-1.5' : 'justify-center py-2'
            }`}
          >
            <LogOut size={14} className="shrink-0" />
            <span className={`transition-all duration-200 ${sidebarExpanded || sidebarOpen ? 'opacity-100' : 'max-w-0 overflow-hidden opacity-0'}`}>
              Sair
            </span>
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className={`${isAgentWorkspace ? 'h-12 px-3 lg:px-4' : 'h-16 px-4 lg:px-8'} bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between shadow-sm z-20`}>
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 text-slate-500 hover:bg-slate-100 rounded-lg">
            <Menu size={isAgentWorkspace ? 20 : 24} />
          </button>

          <div className="flex items-center gap-2 ml-auto">
            {isAgentWorkspace ? <SpotifyGlobalPlayer userId={user?.id} /> : null}
            {isAgentWorkspace ? (
              <button
                type="button"
                onClick={() => setYoutubePanelOpen((open) => !open)}
                className={`${isAgentWorkspace ? 'p-1.5' : 'p-2.5'} rounded-full transition-colors ${youtubePanelOpen ? 'bg-red-50 text-red-600 dark:bg-red-950/35 dark:text-red-300' : 'text-slate-500 hover:bg-gray-100 hover:text-red-600 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-red-300'}`}
                title={youtubePanelOpen ? 'Fechar player do YouTube' : 'Abrir player do YouTube'}
                aria-label={youtubePanelOpen ? 'Fechar player do YouTube' : 'Abrir player do YouTube'}
                aria-expanded={youtubePanelOpen}
              >
                <Youtube size={16} />
              </button>
            ) : null}
            {user.role === 'SUPER_ADMIN' && tenant?.id && tenant.id !== 'super_admin' && (
              <span className="px-2.5 py-1 rounded-full text-xs font-semibold border border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800/50 dark:bg-blue-900/30 dark:text-blue-300">
                Tenant: {tenant.id}
              </span>
            )}
            <button
              onClick={togglePersistedTheme}
              className={`${isAgentWorkspace ? 'p-1.5' : 'p-2.5'} rounded-full text-slate-500 hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-slate-700 transition-colors`}
            >
              {darkMode ? <Sun size={isAgentWorkspace ? 16 : 20} /> : <Moon size={isAgentWorkspace ? 16 : 20} />}
            </button>
            <div className="relative" ref={notifRef}>
              <button
                onClick={() => {
                  const next = !showNotifications;
                  setShowNotifications(next);
                  if (next) markAllRead();
                }}
                className={`${isAgentWorkspace ? 'p-1.5' : 'p-2.5'} rounded-full text-slate-500 hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-slate-700 transition-colors relative`}
              >
                <Bell size={isAgentWorkspace ? 16 : 20} />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
              {showNotifications && (
                <div className="absolute right-0 top-12 w-80 max-w-[90vw] bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-xl z-50 p-3 text-sm text-gray-600 dark:text-gray-300">
                  {notifications.length === 0 ? (
                    <div className="py-6 text-center text-xs text-gray-500">Nenhuma notificação nova.</div>
                  ) : (
                    <div className="space-y-2 max-h-[360px] overflow-y-auto">
                      {notifications.map((n) => (
                        <button
                          key={n.id}
                          onClick={() => {
                            if (n.action) navigate(n.action);
                            setShowNotifications(false);
                          }}
                          className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                            n.read ? 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700' : 'bg-blue-50/60 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800/40'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs font-semibold text-gray-800 dark:text-gray-100">{n.title}</div>
                            <div className="text-[10px] text-gray-400 whitespace-nowrap">
                              {new Date(n.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{n.message}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>

        <div
          className={`flex-1 overflow-auto bg-gray-50 dark:bg-slate-900 relative scroll-smooth ${
            isAgentWorkspace ? 'p-0 overflow-hidden' : 'p-3 sm:p-4 lg:p-8'
          }`}
        >
          <Suspense fallback={<LoadingSpinner />}>
            <Routes>
              <Route path="/" element={user.role === 'AGENT' ? <Navigate to="/agent" /> : user.role === 'SUPER_ADMIN' ? <Navigate to="/super-admin" /> : user.role === 'MANAGER' ? <Navigate to="/analytics" /> : <Navigate to="/monitor" />} />
              <Route path="/super-admin" element={<SuperAdminDashboard />} />
              <Route path="/admin" element={<AdminPanel />} />
              <Route path="/billing" element={<BillingManager />} />
              <Route path="/monitor" element={<MonitoringDashboard />} />
              <Route path="/analytics" element={<AnalyticsDashboard />} />
              <Route path="/history" element={<ChatHistory />} />
              <Route path="/catalog" element={<Catalog />} />
              <Route path="/system-logs" element={<SystemLogs />} />
              <Route path="/flows" element={<FlowList />} />
              <Route path="/editor/:id" element={<FlowEditor />} />
              <Route path="/agent" element={<AgentWorkspace youtubePanelOpen={youtubePanelOpen} onYoutubePanelOpenChange={setYoutubePanelOpen} />} />
              <Route path="/agent-dashboard" element={<AgentDashboard />} />
              <Route path="/agent-active" element={<Navigate to="/agent" replace />} />
              <Route path="/users" element={<AgentManager />} />
              <Route path="/templates" element={<TemplateManager />} />
              <Route path="/variables" element={<VariableManager />} />
              <Route path="/agent-memory" element={<AiMemoryManager />} />
              <Route path="/schedules" element={<ScheduleManager />} />
              <Route path="/channels" element={<Channels />} />
              <Route path="/security" element={<SecurityCenter />} />
              <Route path="/privacidade" element={<PrivacyPolicy />} />
              <Route path="/reports" element={<ReportsCenter />} />

              { }
              <Route path="/tenant/:tenantId">
                <Route index element={<TenantIndexRedirect />} />
                <Route path="monitor" element={<MonitoringDashboard />} />
                <Route path="analytics" element={<AnalyticsDashboard />} />
                <Route path="history" element={<ChatHistory />} />
                <Route path="catalog" element={<Catalog />} />
                <Route path="flows" element={<FlowList />} />
                <Route path="editor/:id" element={<FlowEditor />} />
                <Route path="users" element={<AgentManager />} />
                <Route path="templates" element={<TemplateManager />} />
                <Route path="variables" element={<VariableManager />} />
                <Route path="schedules" element={<ScheduleManager />} />
                <Route path="channels" element={<Channels />} />
              </Route>

              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </Suspense>
        </div>
      </main>
    </div>
  );
};

const App = () => {
  return (
    <TenantProvider>
      <AppContent />
    </TenantProvider>
  );
};

export default App;

