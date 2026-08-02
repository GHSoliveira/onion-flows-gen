import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';
import { Reorder } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { useDialog } from '../context/DialogContext';
import { apiRequest } from '../services/api';
import { socketService } from '../services/socket';
import { uploadMediaAsset } from '../services/media';
import ChatMessageContent from '../components/ChatMessageContent';
import ChatMediaLightbox, {
  collectMediaFromMessages,
  resolveMediaUrl,
} from '../components/ChatMediaLightbox';
import {
  User, MessageCircle, Clock, Play, XCircle, Send, Headset, Star, Check, CheckCheck,
  ArrowLeft, Paperclip, Info, MessageSquareText, Loader2, FileText, Image as ImageIcon, Video, AudioLines,
  PanelRightClose, PanelRightOpen, ArrowRightLeft, CornerUpLeft, X as XIcon, Settings, Pencil, Trash2,
  PhoneCall, Copy, RefreshCw, BrainCircuit, Database, ClipboardList, Router
} from 'lucide-react';
import OnionAiIcon from '../components/OnionAiIcon';
import toast from 'react-hot-toast';
import { CenterSkeleton } from '../components/LoadingSkeleton';

const chatOrderStorageKey = (userId, listKey) => `agentChatOrder:${userId || 'anon'}:${listKey}`;
const GENESYS_INACTIVITY_LIMIT_MS = 10 * 60 * 1000;
const AUTO_GENESYS_HYDRATE_COOLDOWN_MS = 15 * 1000;
const CHAT_DETAILS_CACHE_LIMIT = 16;
const chatConversationId = (chat) => String(
  chat?.genesysConvId || chat?.externalConvId || chat?.conversationId || ''
).trim();
const chatMessageTimestamp = (chat) => {
  const value = chat?.lastMessageAt || chat?.lastMessage?.timestamp || chat?.updatedAt || '';
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};
const DEFAULT_CHAT_APPEARANCE = Object.freeze({
  backgroundMode: 'default',
  backgroundColor: '#0f172a',
  backgroundImage: '',
  backgroundDim: 36,
  customBubbles: false,
  agentBubbleColor: '#0b93f6',
  agentTextColor: '#ffffff',
  customerBubbleColor: '#ffffff',
  customerTextColor: '#1e293b',
  customerNameColor: '#2563eb',
  bubbleBorderEnabled: false,
  bubbleBorderColor: '#2563eb',
  ambientGlowStrength: 100,
  ambientGlowColor: '#2563eb',
  themeAccentColor: '#2563eb',
});
const chatAppearanceStorageKey = (userId) => `agentChatAppearance:${userId || 'anon'}`;
const normalizeAppearanceColor = (value, fallback) => (
  /^#[0-9a-f]{6}$/i.test(String(value || '').trim()) ? String(value).trim() : fallback
);
const normalizeAppearanceRange = (value, fallback, min, max) => {
  const parsed = Number(value);
  return Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : fallback));
};
const normalizeChatAppearance = (value) => ({
  ...DEFAULT_CHAT_APPEARANCE,
  ...(value && typeof value === 'object' ? value : {}),
  customBubbles: value?.customBubbles === true,
  bubbleBorderEnabled: value?.bubbleBorderEnabled === true,
  backgroundDim: normalizeAppearanceRange(value?.backgroundDim, DEFAULT_CHAT_APPEARANCE.backgroundDim, 0, 80),
  ambientGlowStrength: normalizeAppearanceRange(value?.ambientGlowStrength, DEFAULT_CHAT_APPEARANCE.ambientGlowStrength, 0, 200),
  backgroundColor: normalizeAppearanceColor(value?.backgroundColor, DEFAULT_CHAT_APPEARANCE.backgroundColor),
  agentBubbleColor: normalizeAppearanceColor(value?.agentBubbleColor, DEFAULT_CHAT_APPEARANCE.agentBubbleColor),
  agentTextColor: normalizeAppearanceColor(value?.agentTextColor, DEFAULT_CHAT_APPEARANCE.agentTextColor),
  customerBubbleColor: normalizeAppearanceColor(value?.customerBubbleColor, DEFAULT_CHAT_APPEARANCE.customerBubbleColor),
  customerTextColor: normalizeAppearanceColor(value?.customerTextColor, DEFAULT_CHAT_APPEARANCE.customerTextColor),
  customerNameColor: normalizeAppearanceColor(value?.customerNameColor, DEFAULT_CHAT_APPEARANCE.customerNameColor),
  bubbleBorderColor: normalizeAppearanceColor(value?.bubbleBorderColor, DEFAULT_CHAT_APPEARANCE.bubbleBorderColor),
  ambientGlowColor: normalizeAppearanceColor(value?.ambientGlowColor, DEFAULT_CHAT_APPEARANCE.ambientGlowColor),
  themeAccentColor: normalizeAppearanceColor(value?.themeAccentColor, DEFAULT_CHAT_APPEARANCE.themeAccentColor),
});
const readChatAppearance = (userId) => {
  try {
    return normalizeChatAppearance(JSON.parse(localStorage.getItem(chatAppearanceStorageKey(userId)) || 'null'));
  } catch {
    return { ...DEFAULT_CHAT_APPEARANCE };
  }
};
const compressChatBackground = (file) => new Promise((resolve, reject) => {
  if (!file || !String(file.type || '').startsWith('image/')) {
    reject(new Error('Selecione uma imagem válida'));
    return;
  }
  if (Number(file.size || 0) > 8 * 1024 * 1024) {
    reject(new Error('A imagem deve ter no máximo 8 MB'));
    return;
  }
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('Não foi possível ler a imagem'));
  reader.onload = () => {
    const image = new Image();
    image.onerror = () => reject(new Error('Formato de imagem não suportado'));
    image.onload = () => {
      const maxWidth = 1600;
      const maxHeight = 1000;
      const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('Não foi possível processar a imagem'));
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    image.src = String(reader.result || '');
  };
  reader.readAsDataURL(file);
});
const SHARED_CLOCK_INTERVAL_MS = 1000;
let sharedClockNow = Date.now();
let sharedClockTimer = null;
const sharedClockListeners = new Set();
const subscribeSharedClock = (listener) => {
  sharedClockListeners.add(listener);
  if (!sharedClockTimer) {
    sharedClockTimer = window.setInterval(() => {
      sharedClockNow = Date.now();
      sharedClockListeners.forEach((notify) => notify());
    }, SHARED_CLOCK_INTERVAL_MS);
  }
  return () => {
    sharedClockListeners.delete(listener);
    if (!sharedClockListeners.size && sharedClockTimer) {
      window.clearInterval(sharedClockTimer);
      sharedClockTimer = null;
    }
  };
};
const getSharedClockSnapshot = () => sharedClockNow;
const useSharedClock = (enabled = true) => useSyncExternalStore(
  enabled ? subscribeSharedClock : () => () => {},
  getSharedClockSnapshot,
  getSharedClockSnapshot
);
const resolvedCustomerDocument = (chat) => {
  const raw = String(chat?.customerCpf || '');
  if (raw.startsWith('gx_')) return '';
  const digits = raw.replace(/^cpf_/i, '').replace(/\D/g, '');
  return digits.length === 11 || digits.length === 14 ? digits : '';
};
const activeIxcLogins = (details) => (
  Array.isArray(details?.logins)
    ? details.logins.filter((login) => login?.active === true)
    : []
);
const PRE_OS_TASK_CODES = new Set(['4631', '4633', '4635', '4637', '4641']);
const IXC_OS_TASKS = [
  ['4533', 'BC - OUTROS'],
  ['4629', 'REPARO - CÂMERA'],
  ['4631', 'PRÉ - O.S LOS / SINAL ATENUADO'],
  ['4633', 'PRÉ - O.S LENTIDÃO'],
  ['4635', 'PRÉ - O.S SEM ACESSO'],
  ['4637', 'PRÉ - O.S EQUIPAMENTO NÃO LIGA'],
  ['4641', 'PRÉ - O.S SEM SINAL IVR / FORA DO PADRÃO'],
];
const IXC_OS_DIAGNOSES = [
  ['761', 'Sem sinal óptico (LOS)'],
  ['1261', 'Sinal óptico fora do padrão'],
  ['763', 'Conexão com lentidão'],
  ['1269', 'Velocidade incompatível com plano'],
  ['1769', 'Oscilação / quedas'],
  ['767', 'Autenticação PPPoE'],
  ['799', 'Cabo de rede desconectado'],
  ['1529', 'Fibra / Drop caído'],
];
const defaultIxcVisitDate = () => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  if (date.getDay() === 0) date.setDate(date.getDate() + 1);
  date.setHours(8, 0, 0, 0);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};

const normalizeCatalogText = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

const IxcCatalogSearch = ({ label, placeholder, options, query, selectedCode, onChange, onSelect }) => {
  const [open, setOpen] = useState(false);
  const normalizedQuery = normalizeCatalogText(query);
  const matches = options.filter(([code, title]) => {
    if (!normalizedQuery) return true;
    return String(code).startsWith(normalizedQuery)
      || normalizeCatalogText(title).includes(normalizedQuery)
      || normalizeCatalogText(`${code} ${title}`).includes(normalizedQuery);
  }).slice(0, 12);

  return (
    <label className="relative text-[9px] font-bold uppercase tracking-wide text-slate-500 sm:col-span-2">
      {label}
      <input
        value={query}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 140)}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        placeholder={placeholder}
        autoComplete="off"
        className={`mt-1 w-full rounded-md border bg-white px-2.5 py-2 text-[10px] text-slate-800 outline-none dark:bg-slate-800 dark:text-white ${selectedCode ? 'border-emerald-400 dark:border-emerald-700' : 'border-slate-200 focus:border-blue-400 dark:border-slate-700'}`}
      />
      {selectedCode ? <span className="mt-1 block text-[8px] font-semibold normal-case tracking-normal text-emerald-600 dark:text-emerald-400">Selecionado: código {selectedCode}</span> : null}
      {open ? (
        <div className="absolute inset-x-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-800">
          {matches.length ? matches.map(([code, title]) => (
            <button
              key={code}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onSelect(code, `${code} — ${title}`);
                setOpen(false);
              }}
              className={`block w-full border-0 px-2.5 py-2 text-left transition hover:bg-blue-50 dark:hover:bg-slate-700 ${selectedCode === code ? 'bg-emerald-50 dark:bg-emerald-950/30' : ''}`}
            >
              <span className="block text-[10px] font-bold text-slate-800 dark:text-slate-100">{code} — {title}</span>
            </button>
          )) : <div className="px-3 py-4 text-center text-[9px] font-medium normal-case tracking-normal text-slate-400">Nenhuma opção encontrada.</div>}
        </div>
      ) : null}
    </label>
  );
};

const resolveGenesysLastActivityAt = (chat) => {
  const summarized = parseMessageTimeLoose(chat?.lastMessageAt);
  if (summarized) return summarized;
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!['user', 'agent'].includes(String(message?.sender || '').toLowerCase())) continue;
    const timestamp = parseMessageTimeLoose(message?.timestamp || message?.createdAt);
    if (timestamp) return timestamp;
  }
  return 0;
};

const formatInactivityRemaining = (remainingMs) => {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

const GenesysInactivityLiquid = ({ chat }) => {
  const lastActivityAt = resolveGenesysLastActivityAt(chat);
  const now = useSharedClock(Boolean(lastActivityAt));

  if (!lastActivityAt) return null;
  const elapsedMs = Math.max(0, now - lastActivityAt);
  const progress = Math.min(1, elapsedMs / GENESYS_INACTIVITY_LIMIT_MS);
  const remainingMs = Math.max(0, GENESYS_INACTIVITY_LIMIT_MS - elapsedMs);
  const hue = Math.round(142 * (1 - progress));
  const critical = progress >= 0.8;
  const expired = progress >= 1;
  const label = expired ? '0:00' : formatInactivityRemaining(remainingMs);
  const title = expired
    ? 'Limite de 10 minutos atingido'
    : `Encerramento automático em ${label}`;

  return (
    <>
      <div className="genesys-inactivity-liquid pointer-events-none z-0" aria-hidden="true">
        <div
          className={`genesys-inactivity-liquid-fill ${expired ? 'is-expired' : ''}`}
          style={{
            width: `${Math.max(2, progress * 100)}%`,
            '--genesys-liquid-hue': hue,
          }}
        />
      </div>
      <span
        className={`pointer-events-none absolute bottom-1 right-1 z-20 rounded-full border px-1.5 py-0.5 text-[8px] font-bold tabular-nums shadow-sm backdrop-blur-sm ${
          critical
            ? 'border-red-300/80 bg-red-50/90 text-red-700 dark:border-red-700/70 dark:bg-red-950/80 dark:text-red-200'
            : 'border-slate-200/80 bg-white/85 text-slate-500 dark:border-slate-600/70 dark:bg-slate-900/80 dark:text-slate-300'
        }`}
        title={title}
        aria-label={title}
      >
        {label}
      </span>
    </>
  );
};

const WaitingElapsed = ({ since }) => {
  const now = useSharedClock(Boolean(since));
  if (!since) return <>0s</>;
  const parsed = new Date(since).getTime();
  const diff = Math.max(0, now - (Number.isFinite(parsed) ? parsed : now));
  const mins = Math.floor(diff / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  return <>{mins > 0 ? `${mins}m ${secs}s` : `${secs}s`}</>;
};

/** Genesys: chat normal sempre tem msgs; vazio = card de ligação (não listar no inbox). */
const isGenesysChatClient = (chat) => {
  if (!chat) return false;
  const channel = String(chat.channel || '').toLowerCase();
  const source = String(chat.externalSource || '').toLowerCase();
  return channel === 'genesys'
    || source === 'genesys'
    || Boolean(chat.genesysConvId)
    || (Boolean(chat.externalConvId) && source === 'genesys');
};

const isGenesysEmptyShell = (chat) => {
  if (!isGenesysChatClient(chat)) return false;
  const kind = String(chat.genesysMediaType || chat.conversationType || chat.mediaType || chat.interactionType || chat.kind || '').trim().toLowerCase();
  if (['message', 'messaging', 'chat', 'webmessaging'].includes(kind)) return false;
  const count = Number(chat.messageCount || 0);
  const arrLen = Array.isArray(chat.messages) ? chat.messages.length : 0;
  const last = chat.lastMessage;
  return count <= 0 && arrLen <= 0
    && !(last && (String(last.text || '').trim() || last.type || last.mediaType));
};

const isGenesysCallShell = (chat) => {
  if (!isGenesysEmptyShell(chat)) return false;
  const kind = String(chat.genesysMediaType || chat.conversationType || chat.mediaType || chat.interactionType || chat.kind || '').trim().toLowerCase();
  return ['voice', 'call', 'phone', 'callback'].includes(kind);
};

const onlyMessagingChats = (list) => (Array.isArray(list) ? list : []).filter(
  (c) => !isGenesysCallShell(c) && !isGenesysEmptyShell(c)
);
const onlyCallShells = (list) => (Array.isArray(list) ? list : []).filter((c) => isGenesysCallShell(c));

const loadChatOrder = (userId, listKey) => {
  try {
    const raw = localStorage.getItem(chatOrderStorageKey(userId, listKey));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
};

const saveChatOrder = (userId, listKey, chats) => {
  try {
    const ids = (Array.isArray(chats) ? chats : []).map((chat) => String(chat?.id || '')).filter(Boolean);
    localStorage.setItem(chatOrderStorageKey(userId, listKey), JSON.stringify(ids));
  } catch {
    // ignore quota / private mode
  }
};

const parseMessageTimeLoose = (value) => {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

/** Duplicata visual comum: msg do app (msg_xxx) + eco Genesys (UUID) com mesmo texto. */
const messagesLookSame = (a, b) => {
  if (!a || !b) return false;
  const aProvider = a.providerMessageId || a.meta?.providerMessageId || a.meta?.genesysMessageId || null;
  const bProvider = b.providerMessageId || b.meta?.providerMessageId || b.meta?.genesysMessageId || null;
  if (aProvider && bProvider && String(aProvider) === String(bProvider)) return true;

  const aId = a.id || a.messageId || null;
  const bId = b.id || b.messageId || null;
  if (aId && bId && String(aId) === String(bId)) return true;
  // id Genesys cru vs prefixado convId:uuid
  if (aId && bId) {
    const as = String(aId);
    const bs = String(bId);
    if (as.endsWith(bs) || bs.endsWith(as)) return true;
  }

  const sameContent = String(a.sender || '') === String(b.sender || '')
    && String(a.text || '').trim() === String(b.text || '').trim()
    && String(a.text || '').trim() !== '';
  if (!sameContent) return false;

  const aTime = parseMessageTimeLoose(a.timestamp);
  const bTime = parseMessageTimeLoose(b.timestamp);
  if (!aTime || !bTime) return true; // mesmo texto+sender sem ts confiável
  return Math.abs(aTime - bTime) <= 3 * 60 * 1000;
};

const dedupeMessageList = (list) => {
  if (!Array.isArray(list) || list.length <= 1) return Array.isArray(list) ? list : [];
  const out = [];
  for (const message of list) {
    if (!message) continue;
    const idx = out.findIndex((item) => messagesLookSame(item, message));
    if (idx === -1) {
      out.push(message);
    } else {
      const previous = out[idx];
      out[idx] = {
        ...previous,
        ...message,
        id: previous.id || message.id,
        messageId: previous.messageId || message.messageId || previous.id,
        providerMessageId: message.providerMessageId
          || previous.providerMessageId
          || message.meta?.providerMessageId
          || previous.meta?.providerMessageId
          || null,
        meta: previous?.meta || message?.meta
          ? { ...(previous?.meta || {}), ...(message?.meta || {}) }
          : null
      };
    }
  }
  return out.sort((a, b) => parseMessageTimeLoose(a?.timestamp) - parseMessageTimeLoose(b?.timestamp));
};

/** Mantém a ordem atual (ou salva); so adiciona chats novos no fim. Nao reordena por mensagem. */
const mergeChatsPreserveOrder = (prevList, nextList, storedOrder = []) => {
  const nextById = new Map();
  (Array.isArray(nextList) ? nextList : []).forEach((chat) => {
    if (chat?.id) nextById.set(String(chat.id), chat);
  });

  const prevIds = (Array.isArray(prevList) ? prevList : [])
    .map((chat) => String(chat?.id || ''))
    .filter(Boolean);
  const baseOrder = prevIds.length > 0 ? prevIds : (Array.isArray(storedOrder) ? storedOrder : []);
  const used = new Set();
  const result = [];

  baseOrder.forEach((id) => {
    if (!nextById.has(id) || used.has(id)) return;
    result.push(nextById.get(id));
    used.add(id);
  });

  nextById.forEach((chat, id) => {
    if (used.has(id)) return;
    result.push(chat);
    used.add(id);
  });

  return result;
};

const AgentWorkspace = () => {
  const { user, updateUser } = useAuth();
  const { confirm } = useDialog();
  const location = useLocation();
  const [waitingChats, setWaitingChats] = useState([]);
  const [myChats, setMyChats] = useState([]);
  /** Genesys voice: cards sem mensagens (não listados no inbox de chat) */
  const [activeCalls, setActiveCalls] = useState([]);
  const [draggingChatId, setDraggingChatId] = useState(null);
  const chatDragMovedRef = useRef(false);
  const chatDragStartIdRef = useRef(null);
  const [selectedChat, setSelectedChat] = useState(null);
  const [pendingFocusChatId, setPendingFocusChatId] = useState(() => localStorage.getItem('pendingActiveChatId') || null);
  const [agentInput, setAgentInput] = useState('');
  const [aiImprovingText, setAiImprovingText] = useState(false);
  const [aiImprovementUndo, setAiImprovementUndo] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState(null);
  const highlightTimerRef = useRef(null);
  const [visibleVars, setVisibleVars] = useState([]);
  const [rootVars, setRootVars] = useState([]);
  const [quickReplies, setQuickReplies] = useState([]);
  const [appTemplates, setAppTemplates] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [showQuickModal, setShowQuickModal] = useState(false);
  const [quickDraft, setQuickDraft] = useState('');
  const [quickEditor, setQuickEditor] = useState({ open: false, id: null, name: '', text: '', saving: false });
  const [nameEditor, setNameEditor] = useState({ open: false, value: '', saving: false });
  const [chatAppearance, setChatAppearance] = useState(() => readChatAppearance(user?.id));
  const [appearanceDraft, setAppearanceDraft] = useState(() => readChatAppearance(user?.id));
  const [bulkPickupModal, setBulkPickupModal] = useState({
    open: false,
    message: '',
    loading: false
  });
  const [isMobileView, setIsMobileView] = useState(() => window.innerWidth < 1024);
  const [showMobileChat, setShowMobileChat] = useState(false);
  const [mobileListTab, setMobileListTab] = useState('active');
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [mobilePanelTab, setMobilePanelTab] = useState('info');
  const [isSidePanelCollapsed, setIsSidePanelCollapsed] = useState(true);
  const [isAiPanelOpen, setIsAiPanelOpen] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [aiSuggestedReply, setAiSuggestedReply] = useState('');
  const [aiAgentGuidance, setAiAgentGuidance] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [ixcSearching, setIxcSearching] = useState(false);
  const [conversationReloading, setConversationReloading] = useState(false);
  const [genesysFlushLoading, setGenesysFlushLoading] = useState(false);
  const [ixcOrdersRefreshing, setIxcOrdersRefreshing] = useState(false);
  const [ixcLoginsRefreshing, setIxcLoginsRefreshing] = useState(false);
  const [ixcRequestedChatId, setIxcRequestedChatId] = useState('');
  const [customerAccessPopoverOpen, setCustomerAccessPopoverOpen] = useState(false);
  const [ixcDetailsModal, setIxcDetailsModal] = useState({ open: false, chatId: '', closing: false });
  const [ixcOsOperation, setIxcOsOperation] = useState({
    open: false, order: null, diagnosisId: '', diagnosisQuery: '',
    nextTaskCode: '', nextTaskQuery: '', sectorCode: '', visitDate: defaultIxcVisitDate(),
    visitPeriod: 'MANHA', periodNote: '', description: '', reference: '',
    address: '', phone: '', selectedMedia: {}, submitting: false,
  });
  const [routerProbe, setRouterProbe] = useState({ chatId: '', ip: '', status: 'idle', url: '', openPorts: [], pickerOpen: false });
  const [wrapupPanel, setWrapupPanel] = useState({
    open: false, loading: false, codes: [], query: '', selected: null, submitting: false, error: ''
  });
  const [unreadByChatId, setUnreadByChatId] = useState({});
  const [mediaModal, setMediaModal] = useState({
    open: false,
    file: null,
    previewUrl: '',
    previewKind: 'document',
    caption: '',
    uploading: false
  });
  // Player embutido: mídias da conversa aberta (zoom / fullscreen / setas)
  const [mediaViewer, setMediaViewer] = useState({ open: false, index: 0 });

  const chatMediaItems = useMemo(
    () => collectMediaFromMessages(selectedChat?.messages),
    [selectedChat?.messages]
  );

  const openChatMedia = useCallback((message) => {
    const items = collectMediaFromMessages(selectedChat?.messages);
    if (!items.length) return;
    const mid = message?.id || message?.messageId || null;
    const msgMedia = message?.media || message?.attachment || null;
    const msgUrl = msgMedia?.url || msgMedia?.mediaUrl || null;
    let idx = 0;
    if (mid) {
      const byId = items.findIndex((it) => String(it.messageId || '') === String(mid));
      if (byId >= 0) idx = byId;
    } else if (msgUrl) {
      const resolved = resolveMediaUrl(msgUrl);
      const byUrl = items.findIndex(
        (it) => it.resolvedUrl === resolved || it.url === msgUrl
      );
      if (byUrl >= 0) idx = byUrl;
    }
    setMediaViewer({ open: true, index: idx });
  }, [selectedChat?.messages]);
  const [transferModal, setTransferModal] = useState({
    open: false,
    loading: false,
    submitting: false,
    mode: 'queue',
    queue: '',
    agentId: '',
    reason: '',
    queues: [],
    agents: []
  });
  const chatEndRef = useRef(null);
  const agentInputRef = useRef(null);
  const selectedChatRef = useRef(null);
  const customerAccessPopoverRef = useRef(null);
  const mediaInputRef = useRef(null);
  const unreadByChatIdRef = useRef({});
  const knownChatIdsRef = useRef(new Set());
  const unreadBootstrappedRef = useRef(false);
  const lastReadCustomerAtRef = useRef({});
  const aiRequestRef = useRef(0);
  // HistÃ³ricos ficam isolados pelo par chatId + conversationId.
  // O Map vive apenas nesta sessÃ£o do painel e Ã© limpo no encerramento do chat.
  const chatDetailsCacheRef = useRef(new Map());
  const chatDetailsInFlightRef = useRef(new Map());
  const automaticHydrateAtRef = useRef(new Map());

  useEffect(() => {
    aiRequestRef.current += 1;
    setCustomerAccessPopoverOpen(false);
    setIsAiPanelOpen(false);
    setAiSuggestion(null);
    setAiSuggestedReply('');
    setAiAgentGuidance('');
    setAiLoading(false);
    setAiError('');
    setAiImprovementUndo(null);
  }, [selectedChat?.id]);

  useEffect(() => {
    if (!customerAccessPopoverOpen) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!customerAccessPopoverRef.current?.contains(event.target)) {
        setCustomerAccessPopoverOpen(false);
      }
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setCustomerAccessPopoverOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [customerAccessPopoverOpen]);

  useEffect(() => {
    const input = agentInputRef.current;
    if (!input) return;
    input.style.height = '0px';
    input.style.height = `${Math.min(input.scrollHeight, 112)}px`;
  }, [agentInput]);

  const mergeChatMessages = useCallback((previousMessages, nextMessages) => {
    if (!Array.isArray(nextMessages)) return Array.isArray(previousMessages) ? previousMessages : [];
    if (!Array.isArray(previousMessages) || previousMessages.length === 0) {
      return dedupeMessageList(nextMessages);
    }
    if (nextMessages.length === 0) return dedupeMessageList(previousMessages);

    // União com dedup: evita eco Genesys (id diferente, mesmo texto do agente)
    let merged = [...previousMessages];
    for (const message of nextMessages) {
      if (!message) continue;
      const idx = merged.findIndex((item) => messagesLookSame(item, message));
      if (idx === -1) {
        merged.push(message);
      } else {
        const previous = merged[idx];
        merged[idx] = {
          ...previous,
          ...message,
          id: previous.id || message.id,
          messageId: previous.messageId || message.messageId || previous.id,
          providerMessageId: message.providerMessageId
            || previous.providerMessageId
            || message.meta?.providerMessageId
            || previous.meta?.providerMessageId
            || null,
          media: message?.media ?? previous?.media ?? null,
          attachment: message?.attachment ?? previous?.attachment ?? null,
          meta: previous?.meta || message?.meta
            ? { ...(previous?.meta || {}), ...(message?.meta || {}) }
            : null
        };
      }
    }
    return dedupeMessageList(merged);
  }, []);

  const mergeChatPayload = useCallback((previousChat, nextChat, options = {}) => {
    if (!previousChat) return nextChat;
    if (!nextChat) return previousChat;

    const sameChat = String(previousChat.id || '') === String(nextChat.id || '');
    const nextMessages = Array.isArray(nextChat.messages) ? nextChat.messages : null;
    const previousMessages = Array.isArray(previousChat.messages) ? previousChat.messages : [];
    // replaceMessages: GET /chats/:id → fonte da verdade do thread (não unir com lixo anterior)
    const replaceMessages = options.replaceMessages === true;

    // CRÍTICO: trocar de card NUNCA reaproveita mensagens do chat anterior.
    // Antes: next vazio (resumo da lista) + previousMessages.length > 0
    // mantinha o thread da Renata ao abrir Fabricia/Alex → “mesma conversa” em todos.
    // Também NÃO unir mensagens de A+B (union) — cada card é estático/isolado.
    let messages;
    if (!sameChat) {
      messages = nextMessages && nextMessages.length
        ? dedupeMessageList(nextMessages)
        : [];
    } else if (replaceMessages && nextMessages) {
      // Detalhe completo do servidor: substitui o thread (mesmo se array vazio)
      messages = dedupeMessageList(nextMessages);
    } else {
      // Resumo da lista NÃO tem messages → nunca zera nem mistura com outro card
      const nextIsLightSummary = !nextMessages || nextMessages.length === 0;
      if (nextIsLightSummary) {
        messages = previousMessages;
      } else {
        messages = mergeChatMessages(previousMessages, nextMessages);
      }
    }

    // Identidade: só “congela” nome/gx no MESMO chat
    const frozen = sameChat && (
      previousChat.identityFrozen === true
      || nextChat.identityFrozen === true
      || previousChat.historySeeded === true
    );
    const mergedVars = sameChat
      ? { ...(previousChat.vars || {}), ...(nextChat.vars || {}) }
      : { ...(nextChat.vars || {}) };
    const mergedVariables = sameChat
      ? { ...(previousChat.variables || {}), ...(nextChat.variables || {}) }
      : { ...(nextChat.variables || {}) };
    const ixcName = String(mergedVars.nome_cliente || mergedVariables.nome_cliente || '').trim();
    let customerName = Object.prototype.hasOwnProperty.call(nextChat, 'customerName')
      ? nextChat.customerName
      : (sameChat ? previousChat.customerName : nextChat.customerName);
    if (sameChat && frozen && previousChat.customerName && (!customerName || (ixcName && customerName === ixcName))) {
      customerName = previousChat.customerName;
    }
    if (ixcName && customerName && String(customerName).trim() === ixcName) {
      customerName = sameChat && previousChat.customerName && String(previousChat.customerName).trim() !== ixcName
        ? previousChat.customerName
        : (String(nextChat.customerName || '').trim() !== ixcName ? nextChat.customerName : null);
    }

    return {
      ...(sameChat ? previousChat : {}),
      ...nextChat,
      id: nextChat.id,
      genesysConvId: sameChat
        ? (previousChat.genesysConvId || nextChat.genesysConvId)
        : (nextChat.genesysConvId || nextChat.externalConvId || null),
      externalConvId: sameChat
        ? (previousChat.externalConvId || nextChat.externalConvId)
        : (nextChat.externalConvId || nextChat.genesysConvId || null),
      customerName,
      identityFrozen: sameChat ? (frozen || nextChat.identityFrozen) : nextChat.identityFrozen,
      historySeeded: sameChat
        ? (previousChat.historySeeded || nextChat.historySeeded)
        : nextChat.historySeeded,
      vars: mergedVars,
      variables: mergedVariables,
      messages
    };
  }, [mergeChatMessages]);

  const readCachedChat = useCallback((chat) => {
    const chatId = String(chat?.id || '');
    if (!chatId) return null;
    const entry = chatDetailsCacheRef.current.get(chatId);
    if (!entry?.complete || !entry.chat) return null;

    const requestedConversationId = chatConversationId(chat);
    if (
      requestedConversationId
      && (!entry.conversationId || entry.conversationId !== requestedConversationId)
    ) {
      // Mesmo chatId apontando para outra conversa nunca pode reutilizar mensagens.
      chatDetailsCacheRef.current.delete(chatId);
      return null;
    }

    // Atualiza a ordem do Map para descarte LRU.
    chatDetailsCacheRef.current.delete(chatId);
    chatDetailsCacheRef.current.set(chatId, entry);
    return entry.chat;
  }, []);

  const storeCachedChat = useCallback((chat, { complete = true } = {}) => {
    const chatId = String(chat?.id || '');
    if (!chatId) return null;
    const nextConversationId = chatConversationId(chat);
    const previous = chatDetailsCacheRef.current.get(chatId);

    if (
      previous?.conversationId
      && nextConversationId
      && previous.conversationId !== nextConversationId
    ) {
      chatDetailsCacheRef.current.delete(chatId);
    }

    const compatiblePrevious = chatDetailsCacheRef.current.get(chatId);
    const normalized = {
      ...(compatiblePrevious?.chat || {}),
      ...chat,
      messages: Array.isArray(chat.messages)
        ? dedupeMessageList(chat.messages)
        : (compatiblePrevious?.chat?.messages || []),
    };
    const entry = {
      chat: normalized,
      conversationId: nextConversationId || compatiblePrevious?.conversationId || '',
      complete: complete === true || compatiblePrevious?.complete === true,
      updatedAt: Date.now(),
    };

    chatDetailsCacheRef.current.delete(chatId);
    chatDetailsCacheRef.current.set(chatId, entry);
    while (chatDetailsCacheRef.current.size > CHAT_DETAILS_CACHE_LIMIT) {
      const oldestChatId = chatDetailsCacheRef.current.keys().next().value;
      if (!oldestChatId) break;
      chatDetailsCacheRef.current.delete(oldestChatId);
    }
    return normalized;
  }, []);

  const patchCachedChat = useCallback((chatId, updater) => {
    const key = String(chatId || '');
    const entry = chatDetailsCacheRef.current.get(key);
    if (!key || !entry?.chat || typeof updater !== 'function') return null;
    const nextChat = updater(entry.chat);
    if (!nextChat) return entry.chat;
    const nextConversationId = chatConversationId(nextChat);
    if (
      entry.conversationId
      && nextConversationId
      && entry.conversationId !== nextConversationId
    ) {
      chatDetailsCacheRef.current.delete(key);
      return null;
    }
    return storeCachedChat(nextChat, { complete: entry.complete });
  }, [storeCachedChat]);

  const invalidateCachedChat = useCallback((chatId) => {
    const key = String(chatId || '');
    if (!key) return;
    chatDetailsCacheRef.current.delete(key);
    chatDetailsInFlightRef.current.delete(key);
    automaticHydrateAtRef.current.delete(key);
  }, []);

  const cachedChatNeedsRefresh = useCallback((summary, cached) => {
    if (!cached) return true;
    const summaryConversationId = chatConversationId(summary);
    const cachedConversationId = chatConversationId(cached);
    if (summaryConversationId && summaryConversationId !== cachedConversationId) return true;
    if (cached.historySeeded !== true) return true;
    const cachedCount = Number(cached.messageCount || 0)
      || (Array.isArray(cached.messages) ? cached.messages.length : 0);
    const summaryCount = Number(summary?.messageCount || 0);
    if (summaryCount > cachedCount) return true;
    return chatMessageTimestamp(summary) > chatMessageTimestamp(cached) + 500;
  }, []);

  const chatNeedsGenesysHydrate = useCallback((summary, detailed) => {
    const chat = detailed || summary;
    if (!chat) return false;
    if (chat.historySeeded !== true) return true;
    const actualCount = Array.isArray(chat.messages) ? chat.messages.length : 0;
    const detailedCount = Number(chat.messageCount || 0) || actualCount;
    const summaryCount = Number(summary?.messageCount || 0);
    if (summaryCount > detailedCount) return true;
    if (detailedCount > 0 && actualCount === 0) return true;
    return chatMessageTimestamp(summary) > chatMessageTimestamp(chat) + 500;
  }, []);

  const isCustomerMessage = useCallback((message) => {
    const sender = String(message?.sender || '').toLowerCase();
    return ['user', 'customer', 'cliente', 'visitor'].includes(sender);
  }, []);

  const parseMessageTime = useCallback((value) => {
    if (!value) return 0;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }, []);

  const getMessageKey = useCallback((message, index = '') => (
    message?.providerMessageId
    || message?.meta?.providerMessageId
    || message?.id
    || message?.messageId
    || `${message?.sender || 'msg'}_${message?.timestamp || ''}_${message?.text || ''}_${index}`
  ), []);

  const isSameMessage = useCallback((a, b, index = '') => {
    if (!a || !b) return false;
    // reutiliza helper (eco Genesys + app)
    if (messagesLookSame(a, b)) return true;
    const sameContent = String(a.sender || '') === String(b.sender || '')
      && String(a.text || '') === String(b.text || '')
      && JSON.stringify(a.media || null) === JSON.stringify(b.media || null);
    if (!sameContent) return false;
    const aTime = parseMessageTime(a.timestamp);
    const bTime = parseMessageTime(b.timestamp);
    if (!aTime || !bTime) return getMessageKey(a, index) === getMessageKey(b, index);
    return Math.abs(aTime - bTime) <= 3 * 60 * 1000;
  }, [getMessageKey, parseMessageTime]);

  const appendRealtimeMessage = useCallback((messages, message) => {
    if (!message || typeof message !== 'object') return Array.isArray(messages) ? messages : [];
    const current = Array.isArray(messages) ? messages : [];
    const existingIndex = current.findIndex((item, index) => isSameMessage(item, message, index));
    if (existingIndex !== -1) {
      return current.map((item, index) => {
        if (index !== existingIndex) return item;
        return {
          ...item,
          ...message,
          media: message?.media ?? item?.media ?? null,
          attachment: message?.attachment ?? item?.attachment ?? null,
          meta: item?.meta || message?.meta
            ? {
              ...(item?.meta || {}),
              ...(message?.meta || {})
            }
            : null
        };
      });
    }
    return [...current, message].sort((a, b) => parseMessageTime(a?.timestamp) - parseMessageTime(b?.timestamp));
  }, [isSameMessage, parseMessageTime]);

  const getLatestCustomerMessageAt = useCallback((chat) => {
    const messages = Array.isArray(chat?.messages) && chat.messages.length
      ? chat.messages
      : (chat?.lastMessage ? [chat.lastMessage] : []);
    let latest = 0;
    messages.forEach((message) => {
      if (!isCustomerMessage(message)) return;
      const at = parseMessageTime(message?.timestamp);
      if (at > latest) latest = at;
    });
    return latest;
  }, [isCustomerMessage, parseMessageTime]);

  const getUnreadCustomerCount = useCallback((chat, lastReadAt = 0) => {
    const messages = Array.isArray(chat?.messages) && chat.messages.length
      ? chat.messages
      : (chat?.lastMessage ? [chat.lastMessage] : []);
    return messages.reduce((acc, message) => {
      if (!isCustomerMessage(message)) return acc;
      const at = parseMessageTime(message?.timestamp);
      return at > Number(lastReadAt || 0) ? acc + 1 : acc;
    }, 0);
  }, [isCustomerMessage, parseMessageTime]);

  const applyStableChatOrder = useCallback((prevList, nextList, listKey) => {
    const stored = loadChatOrder(user?.id, listKey);
    const merged = mergeChatsPreserveOrder(prevList, nextList, stored);
    saveChatOrder(user?.id, listKey, merged);
    return merged;
  }, [user?.id]);

  const handleChatListReorderByIds = useCallback((listKey, nextIds, currentList) => {
    const byId = new Map(
      (Array.isArray(currentList) ? currentList : [])
        .filter((chat) => chat?.id)
        .map((chat) => [String(chat.id), chat])
    );
    const ordered = (Array.isArray(nextIds) ? nextIds : [])
      .map((id) => byId.get(String(id)))
      .filter(Boolean);
    // preserva itens que por algum motivo nao vieram em nextIds
    (Array.isArray(currentList) ? currentList : []).forEach((chat) => {
      if (chat?.id && !ordered.some((item) => String(item.id) === String(chat.id))) {
        ordered.push(chat);
      }
    });
    if (listKey === 'active') setMyChats(ordered);
    if (listKey === 'waiting') setWaitingChats(ordered);
    saveChatOrder(user?.id, listKey, ordered);
  }, [user?.id]);

  const handleChatCardDragStart = useCallback((chatId) => {
    // Nao bloqueia click ainda: so marca drag real apos passar o limiar de movimento
    chatDragMovedRef.current = false;
    chatDragStartIdRef.current = String(chatId || '');
  }, []);

  const handleChatCardDrag = useCallback((_event, info) => {
    const offsetX = Number(info?.offset?.x || 0);
    const offsetY = Number(info?.offset?.y || 0);
    const distance = Math.hypot(offsetX, offsetY);
    // Clique normal quase sempre gera offset minúsculo; so considera drag apos ~8px
    if (distance < 8) return;
    if (!chatDragMovedRef.current) {
      chatDragMovedRef.current = true;
      if (chatDragStartIdRef.current) {
        setDraggingChatId(chatDragStartIdRef.current);
      }
    }
  }, []);

  const handleChatCardDragEnd = useCallback(() => {
    setDraggingChatId(null);
    chatDragStartIdRef.current = null;
    // evita click acidental de "abrir chat" logo apos um drag real
    window.setTimeout(() => {
      chatDragMovedRef.current = false;
    }, 60);
  }, []);

  const renderStars = (avg) => {
    const value = Number(avg || 0);
    return (
      <div className="flex items-center gap-0.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Star
            key={i}
            size={12}
            className={i < Math.round(value) ? 'text-yellow-500' : 'text-gray-300 dark:text-gray-600'}
            fill={i < Math.round(value) ? 'currentColor' : 'none'}
          />
        ))}
      </div>
    );
  };

  const renderChannelBadge = (channel, compact = false) => {
    const key = (channel || 'web').toLowerCase();
    const label = key === 'telegram'
      ? 'TG'
      : key === 'whatsapp'
        ? 'WA'
        : key === 'genesys'
          ? 'GX'
          : (channel || 'Web').slice(0, 3);
    const fullLabel = key === 'telegram'
      ? 'Telegram'
      : key === 'whatsapp'
        ? 'WhatsApp'
        : key === 'genesys'
          ? 'Genesys'
          : (channel || 'Web');
    const tone = key === 'genesys'
      ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
      : 'bg-gray-100 text-gray-600 dark:bg-gray-700/50 dark:text-gray-300';
    if (compact) {
      return (
        <span
          title={fullLabel}
          className={`inline-flex items-center rounded px-1 py-px text-[8px] font-bold uppercase tracking-wide ${tone}`}
        >
          {label}
        </span>
      );
    }
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${tone}`}>
        <MessageCircle size={10} /> {fullLabel}
      </span>
    );
  };

  const normalizeDigits = (value) => String(value || '').replace(/\D/g, '');

  const getMessageDeliveryStatus = (message) => {
    const status = String(
      message?.deliveryStatus
      || message?.meta?.deliveryStatus
      || ''
    ).trim().toLowerCase();
    return ['pending', 'sent', 'delivered', 'read', 'failed'].includes(status) ? status : null;
  };

  const renderMessageDeliveryStatus = (message) => {
    const status = getMessageDeliveryStatus(message);
    if (!status || (message?.sender !== 'agent' && message?.sender !== 'bot')) return null;

    const commonClass = 'absolute bottom-2 right-3 flex items-center gap-1 text-[10px]';
    const neutralClass = message?.sender === 'agent'
      ? 'text-white/80 dark:text-gray-300'
      : 'text-gray-400 dark:text-gray-500';
    const readClass = message?.sender === 'agent'
      ? 'text-sky-300 dark:text-sky-400'
      : 'text-sky-500 dark:text-sky-400';
    const failedClass = message?.sender === 'agent'
      ? 'text-red-200 dark:text-red-300'
      : 'text-red-500 dark:text-red-400';

    if (status === 'read') {
      return (
        <span className={`${commonClass} ${readClass}`} title="Lida">
          <CheckCheck size={14} strokeWidth={2.4} />
        </span>
      );
    }

    if (status === 'delivered') {
      return (
        <span className={`${commonClass} ${neutralClass}`} title="Entregue">
          <CheckCheck size={14} strokeWidth={2.4} />
        </span>
      );
    }

    if (status === 'failed') {
      return (
        <span className={`${commonClass} ${failedClass}`} title="Falhou">
          <XCircle size={13} strokeWidth={2.2} />
        </span>
      );
    }

    if (status === 'pending') {
      return (
        <span className={`${commonClass} ${neutralClass}`} title="Enviando">
          <Loader2 size={12} className="animate-spin" strokeWidth={2.2} />
        </span>
      );
    }

    return (
      <span className={`${commonClass} ${neutralClass}`} title="Enviada">
        <Check size={13} strokeWidth={2.4} />
      </span>
    );
  };

  const loadChatDetails = useCallback(async (chatId, expectedConversationId = '') => {
    const key = String(chatId || '');
    if (!key) return null;
    const existingRequest = chatDetailsInFlightRef.current.get(key);
    if (existingRequest) return existingRequest;

    const request = (async () => {
      try {
        const res = await apiRequest(`/chats/${key}`);
        if (!res || !res.ok) return null;
        const fullChat = await res.json();
        const returnedConversationId = chatConversationId(fullChat);
        if (
          expectedConversationId
          && returnedConversationId
          && String(expectedConversationId) !== returnedConversationId
        ) {
          invalidateCachedChat(key);
          return null;
        }

        const cachedFullChat = storeCachedChat(fullChat, { complete: true });
        setSelectedChat((prev) => {
          // Race: o usuário já abriu outro card. Cacheia, mas não troca a tela.
          if (!prev || String(prev.id) !== key) return prev;
          const visibleConversationId = chatConversationId(prev);
          if (
            visibleConversationId
            && returnedConversationId
            && visibleConversationId !== returnedConversationId
          ) return prev;
          return mergeChatPayload(prev, cachedFullChat, { replaceMessages: true });
        });
        return cachedFullChat;
      } catch (error) {
        console.error('Erro ao carregar detalhes do chat:', error);
        return null;
      }
    })();

    chatDetailsInFlightRef.current.set(key, request);
    try {
      return await request;
    } finally {
      if (chatDetailsInFlightRef.current.get(key) === request) {
        chatDetailsInFlightRef.current.delete(key);
      }
    }
  }, [invalidateCachedChat, mergeChatPayload, storeCachedChat]);

  const markChatAsRead = useCallback((chat) => {
    const chatId = chat?.id;
    if (!chatId) return;
    const latestCustomerAt = getLatestCustomerMessageAt(chat);
    const previousReadAt = Number(lastReadCustomerAtRef.current[chatId] || 0);
    lastReadCustomerAtRef.current[chatId] = Math.max(previousReadAt, latestCustomerAt);

    setUnreadByChatId((prev) => {
      if (!prev || !prev[chatId]) return prev;
      const next = { ...prev, [chatId]: 0 };
      unreadByChatIdRef.current = next;
      return next;
    });
  }, [getLatestCustomerMessageAt]);

  const requestGenesysHydrate = useCallback(async (chat) => {
    if (!chat?.id) return;
    const isGenesys = String(chat.channel || '').toLowerCase() === 'genesys'
      || Boolean(chat.genesysConvId)
      || chat.externalSource === 'genesys'
      || Boolean(chat.externalConvId);
    if (!isGenesys) return;

    const cacheKey = String(chat.id);
    const now = Date.now();
    const previousRequestAt = Number(automaticHydrateAtRef.current.get(cacheKey) || 0);
    if (now - previousRequestAt < AUTO_GENESYS_HYDRATE_COOLDOWN_MS) return;
    automaticHydrateAtRef.current.set(cacheKey, now);

    const msgCount = Number(chat.messageCount || 0)
      || (Array.isArray(chat.messages) ? chat.messages.length : 0);
    const needsFull = chat.historySeeded !== true && msgCount === 0;

    try {
      const res = await apiRequest(`/chats/${chat.id}/hydrate-genesys`, {
        method: 'POST',
        body: JSON.stringify({ force: false }),
      });
      if (!res) return;
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        automaticHydrateAtRef.current.delete(cacheKey);
        // extensão offline: não spam — só se for hydrate completo
        if (needsFull && data?.error) {
          console.warn('[hydrate-genesys]', data.error);
        }
        return;
      }
      // dá tempo da extensão fazer bulk e emitir chat_updated
      const expectedConversationId = chatConversationId(chat);
      setTimeout(() => { void loadChatDetails(chat.id, expectedConversationId); }, 1200);
      setTimeout(() => { void loadChatDetails(chat.id, expectedConversationId); }, 3500);
    } catch (e) {
      automaticHydrateAtRef.current.delete(cacheKey);
      console.warn('[hydrate-genesys]', e?.message || e);
    }
  }, [loadChatDetails]);

  const openChat = useCallback((chat) => {
    if (!chat?.id) return;
    // Ligação Genesys (sem msgs) não abre como chat
    if (isGenesysCallShell(chat)) return;
    markChatAsRead(chat);
    const expectedConversationId = chatConversationId(chat);
    const cachedChat = readCachedChat(chat);
    const needsServerRefresh = cachedChatNeedsRefresh(chat, cachedChat);
    // Isolamento absoluto na troca de card:
    // - NUNCA herda messages do card anterior
    // - cache só é aceito se chatId + conversationId forem compatíveis
    // - resumo da lista nunca sobrescreve as mensagens cacheadas
    setSelectedChat((prev) => {
      if (prev && String(prev.id) === String(chat.id)) {
        // Re-clique no mesmo card: preserva thread já carregado; lista não sobrescreve msgs
        return mergeChatPayload(prev, { ...chat, messages: [] });
      }
      if (cachedChat) {
        return mergeChatPayload(cachedChat, { ...chat, messages: [] });
      }
      return {
        ...chat,
        messages: [],
        messageCount: Number(chat.messageCount || 0),
      };
    });
    setAgentInput('');
    setAiImprovementUndo(null);
    setReplyingTo(null);
    setMediaViewer({ open: false, index: 0 });
    setMobilePanelOpen(false);
    if (window.innerWidth < 1024) {
      setShowMobileChat(true);
    }
    if (needsServerRefresh) {
      void loadChatDetails(chat.id, expectedConversationId).then((detailedChat) => {
        const hydrationCandidate = detailedChat || chat;
        if (chatNeedsGenesysHydrate(chat, hydrationCandidate)) {
          void requestGenesysHydrate({ ...chat, ...hydrationCandidate });
        }
      });
    }
  }, [
    cachedChatNeedsRefresh,
    chatNeedsGenesysHydrate,
    loadChatDetails,
    markChatAsRead,
    mergeChatPayload,
    readCachedChat,
    requestGenesysHydrate,
  ]);

  const handleChatCardClick = useCallback((chat) => {
    // so ignora click se houve drag real (movimento acima do limiar)
    if (chatDragMovedRef.current) return;
    openChat(chat);
  }, [openChat]);

  useEffect(() => {
    selectedChatRef.current = selectedChat;
  }, [selectedChat]);

  useEffect(() => {
    const chatId = String(selectedChat?.id || '');
    const entry = chatDetailsCacheRef.current.get(chatId);
    if (!chatId || !entry) return;
    storeCachedChat(selectedChat, { complete: entry.complete });
  }, [selectedChat, storeCachedChat]);

  useEffect(() => {
    unreadByChatIdRef.current = unreadByChatId;
  }, [unreadByChatId]);

  useEffect(() => {
    const savedAppearance = readChatAppearance(user?.id);
    setChatAppearance(savedAppearance);
    setAppearanceDraft(savedAppearance);
  }, [user?.id]);

  useEffect(() => {
    document.documentElement.style.setProperty('--theme-accent-color', chatAppearance.themeAccentColor);
  }, [chatAppearance.themeAccentColor]);

  useEffect(() => {
    knownChatIdsRef.current = new Set(
      [...myChats, ...waitingChats, ...activeCalls]
        .map((chat) => String(chat?.id || ''))
        .filter(Boolean)
    );
  }, [myChats, waitingChats, activeCalls]);

  useEffect(() => {
    const handleResize = () => setIsMobileView(window.innerWidth < 1024);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!selectedChat) {
      setShowMobileChat(false);
    }
  }, [selectedChat]);

  useEffect(() => {
    const focusChatId = location.state?.focusChatId;
    if (!focusChatId) return;
    localStorage.setItem('pendingActiveChatId', focusChatId);
    setPendingFocusChatId(focusChatId);
  }, [location.state]);

  const fetchAll = useCallback(async () => {
    if (!user) return;
    try {
      const res = await apiRequest('/chats/my-queues');
      if (res && res.ok) {
        const data = await res.json();
        // Server já separa, mas reforça no client (socket/patches antigos)
        const activeCallsRaw = Array.isArray(data.activeCalls)
          ? onlyCallShells(data.activeCalls)
          : onlyCallShells(Array.isArray(data.active) ? data.active : []);
        const waitingRaw = onlyMessagingChats(Array.isArray(data.waiting) ? data.waiting : []);
        const activeRaw = onlyMessagingChats(Array.isArray(data.active) ? data.active : []);
        const all = [...activeRaw, ...waitingRaw];
        const current = selectedChatRef.current;
        const currentSelectedId = current?.id || null;
        let unreadSnapshot = unreadByChatIdRef.current;

        setActiveCalls(activeCallsRaw);

        if (!unreadBootstrappedRef.current) {
          const initialUnread = {};
          all.forEach((chat) => {
            if (!chat?.id) return;
            const latestCustomerAt = getLatestCustomerMessageAt(chat);
            lastReadCustomerAtRef.current[chat.id] = latestCustomerAt;
            initialUnread[chat.id] = 0;
          });
          unreadBootstrappedRef.current = true;
          unreadSnapshot = initialUnread;
          unreadByChatIdRef.current = initialUnread;
          setUnreadByChatId(initialUnread);
        } else {
          const nextUnread = {};
          const notifications = [];
          all.forEach((chat) => {
            if (!chat?.id) return;
            const latestCustomerAt = getLatestCustomerMessageAt(chat);
            const previousReadAt = Number(lastReadCustomerAtRef.current[chat.id] || 0);

            if (currentSelectedId && chat.id === currentSelectedId) {
              lastReadCustomerAtRef.current[chat.id] = Math.max(previousReadAt, latestCustomerAt);
              nextUnread[chat.id] = 0;
              return;
            }

            const unreadCount = getUnreadCustomerCount(chat, previousReadAt);
            nextUnread[chat.id] = unreadCount;
            const previousUnread = Number(unreadByChatIdRef.current[chat.id] || 0);
            if (unreadCount > previousUnread) {
              notifications.push({ chat, total: unreadCount });
            }
          });

          unreadSnapshot = nextUnread;
          unreadByChatIdRef.current = nextUnread;
          setUnreadByChatId(nextUnread);

          notifications.slice(0, 3).forEach(({ chat, total }) => {
            // Toast: nome de canal/WA — NÃO o nome legal IXC (vars.nome_cliente)
            const ixcName = String(chat?.vars?.nome_cliente || chat?.variables?.nome_cliente || '').trim();
            const channelName = String(chat?.customerName || '').trim();
            const displayName = (
              (channelName && channelName !== ixcName ? channelName : '')
              || chat?.channelUserId
              || 'Cliente'
            );
            const label = total > 1 ? `${total} novas mensagens` : 'Nova mensagem';
            toast.success(`${label} de ${displayName}`);
          });
        }

        setWaitingChats((prev) => {
          const waiting = applyStableChatOrder(prev, waitingRaw, 'waiting');
          return JSON.stringify(prev) !== JSON.stringify(waiting) ? waiting : prev;
        });
        setMyChats((prev) => {
          const active = applyStableChatOrder(prev, activeRaw, 'active');
          return JSON.stringify(prev) !== JSON.stringify(active) ? active : prev;
        });

        // se o painel aberto era só shell de ligação, fecha
        if (current && isGenesysCallShell(current)) {
          setSelectedChat(null);
        }

        if (pendingFocusChatId) {
          const focusChat = all.find((chat) => chat.id === pendingFocusChatId);
          if (focusChat) {
            openChat(focusChat);
            localStorage.removeItem('pendingActiveChatId');
            setPendingFocusChatId(null);
          }
        }

        if (current) {
          const updated = all.find(c => c.id === current.id);
          // Lista my-queues é resumo: NUNCA carrega/mescla messages no painel aberto.
          // (antes: messages:[] ou patches da lista uniam thread de outro card)
          if (updated) {
            const varsChanged = JSON.stringify(updated?.vars || {}) !== JSON.stringify(current.vars || {});
            const variablesChanged = JSON.stringify(updated?.variables || {}) !== JSON.stringify(current.variables || {});
            const metaChanged = (
              updated.customerName !== current.customerName
              || updated.lastMessageAt !== current.lastMessageAt
              || updated.messageCount !== current.messageCount
              || updated.historySeeded !== current.historySeeded
              || JSON.stringify(updated.ixcData || null) !== JSON.stringify(current.ixcData || null)
            );
            if (varsChanged || variablesChanged || metaChanged) {
              setSelectedChat((prev) => {
                if (!prev || String(prev.id) !== String(updated.id)) return prev;
                return mergeChatPayload(prev, { ...updated, messages: [] });
              });
            }
          }
        }
      }
    } catch (e) {
      console.error(e);
    }
  }, [
    applyStableChatOrder,
    getLatestCustomerMessageAt,
    getUnreadCustomerCount,
    mergeChatPayload,
    openChat,
    pendingFocusChatId,
    user
  ]);

  useEffect(() => {
    let isMounted = true;
    let timeoutId;

    if (!user) return;

    const poll = async () => {
      await fetchAll();
      if (isMounted) {
        timeoutId = setTimeout(poll, 60000);
      }
    };

    poll();

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
    };
  }, [user, fetchAll]);

  useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem('token');
    if (!token) return;

    socketService.connect(token);

    let refreshTimeout = null;
    let lastSocketRefreshAt = 0;
    const assignmentMembershipByChat = new Map();
    const refresh = (minimumDelayMs = 150) => {
      clearTimeout(refreshTimeout);
      const cooldownMs = Math.max(0, 1500 - (Date.now() - lastSocketRefreshAt));
      refreshTimeout = setTimeout(() => {
        lastSocketRefreshAt = Date.now();
        fetchAll();
      }, Math.max(minimumDelayMs, cooldownMs));
    };

    const handleRealtimeMessage = (event) => {
      const chatId = event?.chatId;
      const message = event?.message;
      if (!chatId || !message) {
        refresh(250);
        return;
      }
      const wasKnown = knownChatIdsRef.current.has(String(chatId));

      const messageAt = parseMessageTime(message.timestamp);
      const applyMessageToChat = (chat) => ({
        ...chat,
        messages: appendRealtimeMessage(chat?.messages, message),
        lastMessage: message,
        lastMessageAt: message.timestamp || chat?.lastMessageAt,
        messageCount: Math.max(
          Number(chat?.messageCount || 0),
          (Array.isArray(chat?.messages) ? chat.messages.length : 0) + 1,
        ),
        updatedAt: message.timestamp || new Date().toISOString(),
      });
      patchCachedChat(chatId, applyMessageToChat);
      setSelectedChat((prev) => {
        if (!prev || prev.id !== chatId) return prev;
        if (isCustomerMessage(message)) {
          const previousReadAt = Number(lastReadCustomerAtRef.current[chatId] || 0);
          lastReadCustomerAtRef.current[chatId] = Math.max(previousReadAt, messageAt);
        }
        return applyMessageToChat(prev);
      });

      // Lista = só metadados do card. NÃO acumula array messages (evita lixo ao reabrir).
      // 1ª msg tira o chat do “shell de ligação” e o refresh recoloca no inbox de messaging.
      const patchChatList = (list) => (Array.isArray(list) ? list : []).map((chat) => {
        if (chat?.id !== chatId) return chat;
        return {
          ...chat,
          lastMessage: message,
          lastMessageAt: message.timestamp || chat.lastMessageAt,
          messageCount: Math.max(Number(chat.messageCount || 0) + 1, 1),
          updatedAt: message.timestamp || new Date().toISOString()
        };
      });

      setMyChats((list) => onlyMessagingChats(patchChatList(list)));
      setWaitingChats((list) => onlyMessagingChats(patchChatList(list)));
      setActiveCalls((list) => onlyCallShells(patchChatList(list)));
      // O socket já contém tudo que a interface precisa para uma mensagem.
      // Só consulta a lista completa quando o chat ainda é desconhecido.
      if (!wasKnown) refresh(250);
    };

    const sanitizeCardName = (incomingName, ixcName, prevName) => {
      const ixc = String(ixcName || '').trim();
      const next = incomingName === undefined ? prevName : incomingName;
      const n = next == null ? '' : String(next).trim();
      // Nunca deixar o card com o nome legal IXC
      if (n && ixc && n === ixc) {
        const prev = prevName == null ? '' : String(prevName).trim();
        if (prev && prev !== ixc) return prev;
        return null;
      }
      return next === undefined ? prevName : next;
    };

    const mergeChatIdentity = (prev, chat, { replaceMessages = false } = {}) => {
      if (!prev || !chat || prev.id !== chat.id) return prev;
      const mergedVars = { ...(prev.vars || {}), ...(chat.vars || {}) };
      const mergedVariables = { ...(prev.variables || {}), ...(chat.variables || {}) };
      const ixcName = mergedVars.nome_cliente || mergedVariables.nome_cliente || '';
      // Update leve de IXC (messages: []) NÃO pode trocar o histórico do chat aberto
      let messages = prev.messages;
      if (replaceMessages && Array.isArray(chat.messages) && chat.messages.length > 0) {
        messages = mergeChatMessages(prev.messages, chat.messages);
      } else if (Array.isArray(prev.messages)) {
        messages = dedupeMessageList(prev.messages);
      }

      return {
        ...prev,
        ...chat,
        messages,
        vars: mergedVars,
        variables: mergedVariables,
        customerName: sanitizeCardName(
          Object.prototype.hasOwnProperty.call(chat, 'customerName') ? chat.customerName : undefined,
          ixcName,
          prev.customerName
        ),
      };
    };

    const handleMessageDelivery = (event) => {
      const chatId = event?.chatId;
      const messageId = event?.messageId;
      const providerMessageId = event?.providerMessageId || null;
      if (!chatId || !messageId) return;
      const patch = (msgs) => (Array.isArray(msgs) ? msgs : []).map((m) => {
        if (m?.id === messageId || m?.messageId === messageId) {
          return {
            ...m,
            ...(providerMessageId ? { providerMessageId } : {}),
            deliveryStatus: event.deliveryStatus || m.deliveryStatus || 'sent',
            meta: {
              ...(m.meta || {}),
              ...(providerMessageId ? { providerMessageId } : {}),
              deliveryStatus: event.deliveryStatus || 'sent'
            }
          };
        }
        return m;
      });
      patchCachedChat(chatId, (cached) => ({
        ...cached,
        messages: dedupeMessageList(patch(cached.messages)),
      }));
      setSelectedChat((prev) => {
        if (!prev || prev.id !== chatId) return prev;
        return { ...prev, messages: dedupeMessageList(patch(prev.messages)) };
      });
    };

    const handleAgentAssigned = (event) => {
      const chat = event?.chat;
      if (chat?.id) {
        const membershipSignature = [
          String(chat.agentId || ''),
          String(chat.status || ''),
          String(chat.queue || '')
        ].join('|');
        const previousMembership = assignmentMembershipByChat.get(String(chat.id));
        assignmentMembershipByChat.set(String(chat.id), membershipSignature);
        // Só atualiza o painel se ESTE card estiver aberto (nunca vaza p/ outro)
        const light = !Array.isArray(chat.messages) || chat.messages.length === 0;
        const cachedAssignment = patchCachedChat(chat.id, (cached) => (
          mergeChatPayload(cached, chat, { replaceMessages: !light })
        ));
        if (!light && !cachedAssignment) {
          storeCachedChat(chat, { complete: true });
        }
        setSelectedChat((prev) => {
          if (!prev || String(prev.id) !== String(chat.id)) return prev;
          return mergeChatIdentity(prev, chat, { replaceMessages: !light });
        });
        // Lista: metadados apenas — sem embutir array de messages
        const patchList = (list) => (Array.isArray(list) ? list : []).map((c) => {
          if (!c || c.id !== chat.id) return c;
          const mergedVars = { ...(c.vars || {}), ...(chat.vars || {}) };
          const mergedVariables = { ...(c.variables || {}), ...(chat.variables || {}) };
          const ixcName = mergedVars.nome_cliente || '';
          return {
            ...c,
            id: c.id,
            genesysConvId: c.genesysConvId || chat.genesysConvId,
            externalConvId: c.externalConvId || chat.externalConvId,
            historySeeded: chat.historySeeded ?? c.historySeeded,
            messageCount: chat.messageCount ?? c.messageCount,
            lastMessage: chat.lastMessage || c.lastMessage,
            lastMessageAt: chat.lastMessageAt || c.lastMessageAt,
            vars: mergedVars,
            variables: mergedVariables,
            customerName: sanitizeCardName(
              Object.prototype.hasOwnProperty.call(chat, 'customerName') ? chat.customerName : undefined,
              ixcName,
              c.customerName
            ),
          };
        });
        setMyChats(patchList);
        setWaitingChats(patchList);
        if (
          !knownChatIdsRef.current.has(String(chat.id))
          || previousMembership !== membershipSignature
        ) {
          refresh(350);
        }
      }
    };

    const handleChatUpdated = (event) => {
      // ext:atendimento:cliente (IXC) — só vars, NUNCA trocar mensagens entre cards
      const chat = event?.chat;
      if (!chat?.id) return;
      patchCachedChat(chat.id, (cached) => mergeChatPayload(
        cached,
        { ...chat, messages: [] },
        { replaceMessages: false },
      ));
      setSelectedChat((prev) => mergeChatIdentity(prev, { ...chat, messages: [] }, { replaceMessages: false }));
      const patchList = (list) => (Array.isArray(list) ? list : []).map((c) => {
        if (!c || c.id !== chat.id) return c;
        const mergedVars = { ...(c.vars || {}), ...(chat.vars || {}) };
        const mergedVariables = { ...(c.variables || {}), ...(chat.variables || {}) };
        const ixcName = mergedVars.nome_cliente || '';
        return {
          ...c,
          vars: mergedVars,
          variables: mergedVariables,
          customerPhone: c.customerPhone || chat.customerPhone,
          customerCpf: chat.customerCpf || c.customerCpf,
          ixcData: chat.ixcData || c.ixcData,
          customerName: sanitizeCardName(
            Object.prototype.hasOwnProperty.call(chat, 'customerName') ? chat.customerName : undefined,
            ixcName,
            c.customerName
          ),
          updatedAt: chat.updatedAt || c.updatedAt,
        };
      });
      setMyChats(patchList);
      setWaitingChats(patchList);
    };

    const handleChatClosed = (event) => {
      const closedId = event?.chatId;
      const closedConvId = String(event?.convId || '');
      const isClosedChat = (chat) => Boolean(
        chat
        && (
          (closedId && chat.id === closedId)
          || (
            closedConvId
            && [chat.genesysConvId, chat.externalConvId, chat.conversationId]
              .some((value) => String(value || '') === closedConvId)
          )
        )
      );
      if (closedId) invalidateCachedChat(closedId);
      if (!closedId && closedConvId) {
        [...chatDetailsCacheRef.current.entries()].forEach(([cachedId, entry]) => {
          if (entry?.conversationId === closedConvId) invalidateCachedChat(cachedId);
        });
      }
      setSelectedChat((prev) => (isClosedChat(prev) ? null : prev));
      setMyChats((list) => (Array.isArray(list) ? list.filter((chat) => !isClosedChat(chat)) : list));
      setWaitingChats((list) => (Array.isArray(list) ? list.filter((chat) => !isClosedChat(chat)) : list));
      setActiveCalls((list) => (Array.isArray(list) ? list.filter((chat) => !isClosedChat(chat)) : list));
    };

    const handleGenesysCommandResult = (event) => {
      if (event?.cmd !== 'ixc_os') return;
      if (event.ok) {
        const attachmentSummary = Number(event.attachmentFailedCount || 0) > 0
          ? ` · ${event.attachedCount || 0} anexo(s) enviado(s), ${event.attachmentFailedCount} falhou(aram)`
          : Number(event.attachedCount || 0) > 0
            ? ` · ${event.attachedCount} anexo(s) enviado(s)`
            : '';
        const resultMessage = event.finalizedOnly
          ? `Pré-OS #${event.os2Id || 'gerada'} pronta${attachmentSummary}`
          : `OS #${event.os2Id || ''} encaminhada e agendada${attachmentSummary}`;
        if (Number(event.attachmentFailedCount || 0) > 0) toast.error(resultMessage, { duration: 7000 });
        else toast.success(resultMessage);
        refresh();
      } else {
        const messages = {
          os_2_nao_encontrada_fluxo_interrompido: 'A OS nova não apareceu. Nada foi encaminhado.',
          mais_de_uma_os_nova_encontrada_fluxo_interrompido: 'Mais de uma OS nova apareceu. O fluxo parou por segurança.',
          colaborador_ixc_nao_configurado: 'Colaborador do IXC não configurado. Abra o popup da extensão.',
        };
        toast.error(messages[event.error] || event.error || 'Falha no fluxo de OS');
      }
    };

    const handleGenesysCommandFailed = (event) => {
      if (!['enviar_mensagem', 'enviar_midia'].includes(event?.cmd)) return;
      const messages = {
        communicationId_nao_disponivel_para_esta_conversa:
          'Não foi possível identificar o canal ativo desta conversa. A mensagem não foi enviada.',
        conversa_nao_encontrada_na_lista_ativa:
          'Esta conversa não aparece mais como ativa no Genesys. A mensagem não foi enviada.',
        mais_de_um_communicationId_ativo_para_esta_conversa:
          'O Genesys retornou mais de um canal ativo para esta conversa. O envio foi bloqueado por segurança.',
        communicationId_do_onion_diverge_da_conversa_ativa:
          'O canal da conversa mudou no Genesys. Aguarde a sincronização e envie novamente.',
        communicationId_local_atualizado_tente_novamente:
          'O canal da conversa foi atualizado. Envie a mensagem novamente.',
        conversa_nao_confirmada_ativa:
          'A extensão ainda não confirmou esta conversa como ativa. Aguarde e tente novamente.',
        geracao_da_conversa_divergente:
          'O card está desatualizado. Aguarde a sincronização antes de enviar novamente.',
        anexo_maior_que_25mb:
          'O anexo ultrapassa o limite de 25 MB do Genesys.',
        tipo_de_anexo_nao_permitido:
          'Este tipo de arquivo não pode ser enviado pelo Genesys.',
        origem_de_anexo_onion_invalida:
          'O arquivo não pertence ao armazenamento local seguro do Onion.',
        upload_genesys_expirou:
          'O upload do Genesys expirou. Selecione o arquivo e tente novamente.',
        outro_anexo_em_envio_nesta_conversa:
          'Já existe um anexo sendo enviado para este cliente. Aguarde a conclusão.',
        limite_de_uploads_simultaneos:
          'Há outros anexos em envio. Aguarde alguns segundos e tente novamente.',
        limite_de_anexos_atingido:
          'O limite seguro de anexos por minuto foi atingido. Aguarde e tente novamente.',
        conversa_mudou_durante_upload:
          'A conversa mudou durante o upload. O anexo foi descartado por segurança.',
        communicationId_mudou_durante_upload:
          'O canal da conversa mudou durante o upload. O anexo não foi publicado.',
        tamanho_do_anexo_diverge_do_onion:
          'O arquivo local mudou durante o envio. Selecione-o novamente.',
        mime_do_anexo_diverge_do_onion:
          'O conteúdo do arquivo não corresponde ao tipo informado.',
      };
      toast.error(
        messages[event?.error]
          || event?.error
          || 'Não foi possível enviar a mensagem pelo Genesys.',
        { duration: 8000 }
      );
    };

    const handleNewChat = () => refresh(100);
    const handleQueueUpdate = () => refresh(300);
    socketService.on('message', handleRealtimeMessage);
    socketService.on('new_chat', handleNewChat);
    socketService.on('queue_update', handleQueueUpdate);
    socketService.on('agent_assigned', handleAgentAssigned);
    socketService.on('chat_updated', handleChatUpdated);
    socketService.on('chat_closed', handleChatClosed);
    socketService.on('message_delivery', handleMessageDelivery);
    socketService.on('genesys_cmd_result', handleGenesysCommandResult);
    socketService.on('genesys_cmd_failed', handleGenesysCommandFailed);

    return () => {
      socketService.off('message', handleRealtimeMessage);
      socketService.off('new_chat', handleNewChat);
      socketService.off('queue_update', handleQueueUpdate);
      socketService.off('agent_assigned', handleAgentAssigned);
      socketService.off('chat_updated', handleChatUpdated);
      socketService.off('chat_closed', handleChatClosed);
      socketService.off('message_delivery', handleMessageDelivery);
      socketService.off('genesys_cmd_result', handleGenesysCommandResult);
      socketService.off('genesys_cmd_failed', handleGenesysCommandFailed);
      clearTimeout(refreshTimeout);
    };
  }, [
    appendRealtimeMessage,
    fetchAll,
    invalidateCachedChat,
    isCustomerMessage,
    mergeChatMessages,
    mergeChatPayload,
    parseMessageTime,
    patchCachedChat,
    storeCachedChat,
    user,
  ]);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        if (!user?.tenantId) return;
        const res = await apiRequest(`/tenants/${user.tenantId}/settings`);
        if (res && res.ok) {
          const settings = await res.json();
          setVisibleVars(settings.agentViewVars || []);
        }
      } catch (error) {
        console.error('Erro ao carregar settings:', error);
      }
    };
    loadSettings();
  }, [user?.tenantId]);

  useEffect(() => {
    const loadRootVars = async () => {
      try {
        const res = await apiRequest('/variables');
        if (res && res.ok) {
          const data = await res.json();
          const list = Array.isArray(data) ? data : [];
          setRootVars(list.filter(v => v.isRoot === true && v.enabled !== false));
        }
      } catch (error) {
        console.error('Erro ao carregar variáveis root:', error);
      }
    };
    loadRootVars();
  }, []);

  useEffect(() => {
    reloadQuickReplies();
  }, []);

  useEffect(() => {
    const loadContacts = async () => {
      try {
        const res = await apiRequest('/contacts?limit=500');
        if (res && res.ok) {
          const data = await res.json();
          setContacts(Array.isArray(data) ? data : []);
        }
      } catch (error) {
        console.error('Erro ao carregar contatos:', error);
      }
    };
    loadContacts();
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [selectedChat?.messages]);

  // Limpa o "respondendo a" ao trocar de atendimento.
  useEffect(() => { setReplyingTo(null); }, [selectedChat?.id]);

  // Limpa o timer de highlight ao desmontar.
  useEffect(() => () => { if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current); }, []);

  const handlePickup = async (chat) => {
    try {
      const res = await apiRequest('/chats/pickup', {
        method: 'POST',
        body: JSON.stringify({ chatId: chat.id })
      });
      if (res && res.ok) {
        const updatedChat = await res.json();
        openChat(updatedChat);
        toast.success("Atendimento iniciado!");
      } else {
        toast.error("Não foi possível puxar este atendimento.");
      }
    } catch (e) {
      console.error(e);
      toast.error("Erro ao puxar atendimento");
    }
  };

  const openBulkPickupModal = () => {
    if (waitingChats.length === 0) return toast.error('Nao ha atendimentos em espera.');
    setBulkPickupModal({ open: true, message: '', loading: false });
  };

  const closeBulkPickupModal = () => {
    setBulkPickupModal((prev) => (
      prev.loading
        ? prev
        : { open: false, message: '', loading: false }
    ));
  };

  const handleBulkPickup = async () => {
    if (bulkPickupModal.loading) return;
    try {
      setBulkPickupModal((prev) => ({ ...prev, loading: true }));
      const res = await apiRequest('/chats/pickup-all', {
        method: 'POST',
        body: JSON.stringify({ message: bulkPickupModal.message })
      });
      const data = res ? await res.json().catch(() => ({})) : {};
      if (!res || !res.ok) {
        throw new Error(data?.error || 'Falha ao puxar atendimentos.');
      }

      const pickedCount = Number(data?.pickedCount || 0);
      const failedCount = Number(data?.failedCount || 0);
      const chats = Array.isArray(data?.chats) ? data.chats : [];
      if (pickedCount > 0) {
        setMyChats((prev) => applyStableChatOrder(prev, [...chats, ...prev], 'active'));
        setWaitingChats((prev) => {
          const next = prev.filter((chat) => !chats.some((picked) => picked.id === chat.id));
          saveChatOrder(user?.id, 'waiting', next);
          return next;
        });
        openChat(chats[0]);
      }
      toast.success(`${pickedCount} atendimento(s) puxado(s)${failedCount ? `, ${failedCount} falharam` : ''}.`);
      setBulkPickupModal({ open: false, message: '', loading: false });
      fetchAll();
    } catch (error) {
      toast.error(error?.message || 'Falha ao puxar atendimentos.');
      setBulkPickupModal((prev) => ({ ...prev, loading: false }));
    }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!agentInput.trim() || !selectedChat) return;
    if (selectedChat.status === 'waiting') return toast.error("Puxe o atendimento antes de responder.");
    if (selectedChat.outreachPendingReply === true) return toast.error("Aguarde a primeira resposta do cliente antes de enviar mensagens.");

    // Congela o alvo no clique (evita race se trocar de card no meio do send)
    const targetChat = selectedChat;
    const targetChatId = targetChat.id;
    const targetName = targetChat.customerName || 'cliente';
    const targetGx = targetChat.genesysConvId || targetChat.externalConvId || null;
    const textToSend = agentInput;
    const replyToMessageId = replyingTo?.id || null;
    setAgentInput('');
    setReplyingTo(null);

    try {
      const res = await apiRequest(`/chats/${targetChatId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          sender: 'agent',
          agentName: user.name,
          text: textToSend,
          ...(targetGx ? { genesysConvId: targetGx } : {}),
          ...(replyToMessageId ? { replyToMessageId } : {})
        })
      });

      const data = res ? await res.json().catch(() => ({})) : null;
      if (res && res.ok) {
        const savedMsg = data;
        setSelectedChat((prev) => {
          // só injeta na UI se ainda estamos no mesmo card
          if (!prev || prev.id !== targetChatId) return prev;
          return {
            ...prev,
            messages: appendRealtimeMessage(prev?.messages, savedMsg),
            lastMessage: savedMsg,
            lastMessageAt: savedMsg?.timestamp || prev?.lastMessageAt,
            updatedAt: savedMsg?.timestamp || new Date().toISOString()
          };
        });
        const who = data?.customerName || targetName;
        if (data?.genesys) {
          if (data.genesys.relayed === true) {
            toast.success(`Enviado → ${who}`);
          } else if (data.genesys.relayed === false && !data.genesys.skipped) {
            const why = data.genesys.reason || 'desconhecido';
            toast.error(
              why === 'extension_offline'
                ? `Salvo p/ ${who}, mas extensão offline`
                : why === 'missing_convId'
                  ? 'Chat sem genesysConvId — reabra a conversa no Genesys'
                  : why === 'not_genesys'
                    ? 'Chat não é Genesys'
                    : `Salvo p/ ${who}, falha Genesys: ${why}`
            );
          } else {
            toast.success(`Mensagem em ${who}`);
          }
        } else {
          toast.success(`Mensagem em ${who}`);
        }
      } else {
        toast.error(data?.error || 'Falha no envio');
      }
    } catch (error) {
      console.error('Erro ao enviar:', error);
      toast.error('Falha no envio');
    }
  };

  const handleAgentInputKeyDown = (event) => {
    if (event.key !== 'Enter') return;
    if (event.shiftKey) return;
    event.preventDefault();
    handleSend(event);
  };

  const handleImproveAgentText = async () => {
    const originalText = String(agentInput || '').trim();
    if (!originalText || aiImprovingText || selectedChatReplyLocked) return;
    setAiImprovingText(true);
    try {
      const res = await apiRequest('/chats/ai-improve-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: originalText })
      });
      const data = await res?.json().catch(() => ({}));
      if (!res?.ok) throw new Error(data?.error || 'Nao foi possivel melhorar o texto.');
      setAgentInput(String(data?.improvedText || originalText));
      setAiImprovementUndo({ originalText, improvedText: String(data?.improvedText || originalText) });
      requestAnimationFrame(() => agentInputRef.current?.focus());
      const providerLabel = data?.provider === 'groq' ? 'Groq fallback' : 'Gemini';
      const remaining = data?.rateLimits?.remainingRequests;
      toast.success(`Texto revisado com ${providerLabel}.${remaining ? ` ${remaining} chamadas Groq restantes.` : ''} Confira antes de enviar.`);
    } catch (error) {
      toast.error(error?.message || 'A IA esta indisponivel agora. Seu texto foi preservado.');
    } finally {
      setAiImprovingText(false);
    }
  };

  const undoAiImprovement = () => {
    if (!aiImprovementUndo?.originalText) return;
    setAgentInput(aiImprovementUndo.originalText);
    setAiImprovementUndo(null);
    requestAnimationFrame(() => agentInputRef.current?.focus());
    toast.success('Rascunho original restaurado.');
  };

  // Ao clicar no preview de um reply, rola até a mensagem original e destaca
  // por ~1.5s. Usa id no DOM (agentmsg-<id>) em vez de refs por causa do
  // volume dinâmico de mensagens.
  const scrollToMessage = (messageId) => {
    if (!messageId) return;
    const el = document.getElementById(`agentmsg-${messageId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedMessageId(messageId);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightedMessageId(null), 1600);
  };

  const handleClose = async () => {
    if (isGenesysChatClient(selectedChat)) {
      setWrapupPanel({
        open: true, loading: true, codes: [], query: '', selected: null, submitting: false, error: ''
      });
      try {
        const response = await apiRequest(`/chats/${encodeURIComponent(selectedChat.id)}/genesys-wrapupcodes`);
        const data = await response?.json().catch(() => ({}));
        if (!response?.ok) throw new Error(data?.error || 'Falha ao carregar tabulações');
        setWrapupPanel((previous) => ({
          ...previous,
          loading: false,
          codes: Array.isArray(data.codes) ? data.codes : [],
          error: ''
        }));
      } catch (error) {
        setWrapupPanel((previous) => ({ ...previous, loading: false, error: error?.message || 'Falha ao carregar tabulações' }));
      }
      return;
    }
    const ok = await confirm({
      title: 'Encerrar atendimento',
      message: 'Tem certeza que deseja encerrar esta conversa?',
      confirmText: 'Encerrar',
      type: 'danger',
    });
    if (!ok) return;

    const continueFlow = selectedChat?.continueFlowAfterQueue ?? false;

    try {
      const res = await apiRequest(`/chats/${selectedChat.id}/close`, {
        method: 'PUT',
        body: JSON.stringify({ continueFlow })
      });
      const data = res ? await res.json().catch(() => ({})) : {};
      if (!res || !res.ok) {
        throw new Error(data?.error || 'Erro ao encerrar');
      }
      setSelectedChat(null);
      toast.success("Atendimento encerrado");
      if (data?.genesys && data.genesys.relayed === false && !data.genesys.skipped) {
        toast.error(
          data.genesys.reason === 'extension_offline'
            ? 'Encerrado no app, mas a extensão Genesys está offline'
            : 'Encerrado no app, mas não foi possível avisar o Genesys'
        );
      }
    } catch (error) {
      toast.error(error?.message || "Erro ao encerrar");
    }
  };

  const confirmGenesysWrapup = async () => {
    if (!selectedChat?.id || !wrapupPanel.selected || wrapupPanel.submitting) return;
    setWrapupPanel((previous) => ({ ...previous, submitting: true, error: '' }));
    try {
      const response = await apiRequest(`/chats/${encodeURIComponent(selectedChat.id)}/close-genesys`, {
        method: 'POST',
        body: JSON.stringify({
          wrapupCode: wrapupPanel.selected.id,
          wrapupName: wrapupPanel.selected.name,
          notes: ''
        })
      });
      const data = await response?.json().catch(() => ({}));
      if (!response?.ok || data?.confirmed !== true) {
        throw new Error(data?.error || 'O Genesys não confirmou a tabulação');
      }
      setWrapupPanel({ open: false, loading: false, codes: [], query: '', selected: null, submitting: false, error: '' });
      setSelectedChat(null);
      toast.success('Atendimento finalizado e tabulado no Genesys');
    } catch (error) {
      setWrapupPanel((previous) => ({
        ...previous, submitting: false, error: error?.message || 'Erro ao finalizar atendimento'
      }));
    }
  };

  const closeTransferModal = () => {
    setTransferModal((prev) => (
      prev.submitting
        ? prev
        : {
          open: false,
          loading: false,
          submitting: false,
          mode: 'queue',
          queue: '',
          agentId: '',
          reason: '',
          queues: [],
          agents: []
        }
    ));
  };

  const openTransferModal = async () => {
    if (!selectedChat || selectedChat.status === 'waiting') return;
    setTransferModal((prev) => ({
      ...prev,
      open: true,
      loading: true,
      submitting: false,
      mode: 'queue',
      queue: selectedChat.queue || '',
      agentId: '',
      reason: ''
    }));
    try {
      const res = await apiRequest('/chats/transfer-options');
      const data = res ? await res.json().catch(() => ({})) : {};
      if (!res || !res.ok) throw new Error(data?.error || 'Falha ao carregar opcoes de transferencia.');
      const queues = Array.isArray(data.queues) ? data.queues : [];
      const agents = Array.isArray(data.agents) ? data.agents : [];
      setTransferModal((prev) => ({
        ...prev,
        loading: false,
        queues,
        agents,
        queue: prev.queue || queues[0]?.name || '',
        agentId: agents[0]?.id || ''
      }));
    } catch (error) {
      toast.error(error?.message || 'Falha ao carregar transferencia.');
      closeTransferModal();
    }
  };

  const handleTransferChat = async () => {
    if (!selectedChat || transferModal.submitting) return;
    const toQueue = transferModal.mode === 'queue';
    const queue = toQueue ? transferModal.queue : '';
    const agentId = toQueue ? '' : transferModal.agentId;
    if (toQueue && !queue) return toast.error('Selecione uma fila.');
    if (!toQueue && !agentId) return toast.error('Selecione um agente.');

    try {
      setTransferModal((prev) => ({ ...prev, submitting: true }));
      const targetAgent = transferModal.agents.find((agent) => agent.id === agentId);
      const res = await apiRequest('/chats/transfer', {
        method: 'POST',
        body: JSON.stringify({
          chatId: selectedChat.id,
          queue,
          agentId: agentId || null,
          agentName: targetAgent?.name || null,
          reason: transferModal.reason || 'Transferencia pelo agente',
          continueFlow: selectedChat.continueFlowAfterQueue ?? false
        })
      });
      const data = res ? await res.json().catch(() => ({})) : {};
      if (!res || !res.ok) throw new Error(data?.error || 'Falha ao transferir atendimento.');

      toast.success(data?.message || 'Atendimento transferido.');
      setSelectedChat(null);
      setTransferModal({
        open: false,
        loading: false,
        submitting: false,
        mode: 'queue',
        queue: '',
        agentId: '',
        reason: '',
        queues: [],
        agents: []
      });
      await fetchAll();
    } catch (error) {
      toast.error(error?.message || 'Falha ao transferir atendimento.');
      setTransferModal((prev) => ({ ...prev, submitting: false }));
    }
  };

  if (!user) return <CenterSkeleton />;

  const chatVars = { ...(selectedChat?.variables || {}), ...(selectedChat?.vars || {}) };
  const selectedChatReplyLocked = selectedChat?.status === 'waiting' || selectedChat?.outreachPendingReply === true;

  const getQueueLabel = (chat) => {
    if (chat?.activeOutreach) return 'ATIVO';
    return chat?.queue || 'Sem fila';
  };

  const normalizeKey = (value) => String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');

  const resolveVarValue = (name) => {
    if (!name) return undefined;
    if (Object.prototype.hasOwnProperty.call(chatVars, name)) return chatVars[name];
    const target = normalizeKey(name);
    const entry = Object.entries(chatVars).find(([key]) => normalizeKey(key) === target);
    return entry ? entry[1] : undefined;
  };

  const resolveVarValueFromChat = useCallback((chat, name) => {
    if (!chat || !name) return undefined;
    const vars = { ...(chat?.variables || {}), ...(chat?.vars || {}) };
    if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name];
    const target = normalizeKey(name);
    const entry = Object.entries(vars).find(([key]) => normalizeKey(key) === target);
    return entry ? entry[1] : undefined;
  }, []);

  const getChatWaId = useCallback((chat) => {
    if (!chat) return null;
    const direct = chat?.channelUserId || chat?.channelChatId || chat?.customerCpf;
    const fromVars = (
      resolveVarValueFromChat(chat, 'WA_ID')
      ?? resolveVarValueFromChat(chat, 'wa_id')
      ?? resolveVarValueFromChat(chat, 'whatsapp_id')
      ?? resolveVarValueFromChat(chat, 'contato_telefone')
      ?? resolveVarValueFromChat(chat, 'telefone')
      ?? resolveVarValueFromChat(chat, 'numero_telefone')
    );
    return String(fromVars || direct || '').trim() || null;
  }, [resolveVarValueFromChat]);

  const contactNameByPhone = (() => {
    const map = new Map();
    (Array.isArray(contacts) ? contacts : []).forEach((contact) => {
      const contactName = String(contact?.name || '').trim();
      if (!contactName) return;

      const phones = Array.isArray(contact?.phones) ? contact.phones : [];
      phones.forEach((phone) => {
        const candidates = [
          phone?.waId,
          phone?.number,
          phone?.normalizedNumber
        ];
        candidates.forEach((candidate) => {
          const raw = String(candidate || '').trim();
          const digits = normalizeDigits(raw);
          if (raw) map.set(raw, contactName);
          if (digits) map.set(digits, contactName);
        });
      });

      const primaryRaw = String(contact?.primaryPhone || '').trim();
      const primaryDigits = normalizeDigits(primaryRaw);
      if (primaryRaw) map.set(primaryRaw, contactName);
      if (primaryDigits) map.set(primaryDigits, contactName);
    });
    return map;
  })();

  const resolveContactNameForChat = (chat) => {
    if (!chat) return null;
    const waId = getChatWaId(chat);
    if (!waId) return null;
    const raw = String(waId).trim();
    const digits = normalizeDigits(raw);
    return contactNameByPhone.get(raw) || contactNameByPhone.get(digits) || null;
  };

  const customerWhatsAppValue = selectedChat?.channel === 'whatsapp'
    ? (
      selectedChat?.activeOutreach
        ? (
          resolveVarValue('contato_telefone')
          ?? resolveVarValue('telefone')
          ?? resolveVarValue('numero_telefone')
          ?? selectedChat?.channelUserId
        )
        : (
          resolveVarValue('WA_ID')
          ?? resolveVarValue('wa_id')
          ?? resolveVarValue('whatsapp_id')
          ?? selectedChat?.channelUserId
        )
    )
    : null;

  const customerWhatsAppLabel = selectedChat?.activeOutreach ? 'Numero' : 'WA ID';

  const getSaudacao = () => {
    const h = new Date().getHours();
    if (h >= 5 && h < 12) return 'Bom dia';
    if (h >= 12 && h < 19) return 'Boa tarde';
    return 'Boa noite';
  };

  const renderTemplateText = (text) => {
    if (!text) return '';
    const clienteNome = chatVars?.nome_cliente
      || selectedChat?.customerName
      || resolveContactNameForChat(selectedChat)
      || '';
    const builtIns = {
      'agente.nome': user?.name || '',
      'agente.name': user?.name || '',
      nome_agente: user?.name || '',
      saudacao: getSaudacao(),
      'saudacao.periodo': getSaudacao(),
      'cliente.nome': clienteNome,
      nome_cliente: clienteNome,
      cpf: chatVars?.cpf || '',
      telefone: chatVars?.telefone || selectedChat?.customerPhone || '',
      'cliente.telefone': chatVars?.telefone || selectedChat?.customerPhone || '',
      'cliente.cpf': chatVars?.cpf || '',
      filial: chatVars?.filial || '',
    };
    return text.replace(/\{([\w.-]+)\}/g, (match, key) => {
      if (builtIns[key] !== undefined && String(builtIns[key]).trim() !== '') {
        return String(builtIns[key]);
      }
      const value = chatVars?.[key];
      return value !== undefined && value !== null && String(value).trim() !== ''
        ? String(value)
        : match;
    });
  };

  const reloadQuickReplies = async () => {
    try {
      const res = await apiRequest('/templates');
      if (res && res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : [];
        setAppTemplates(list);
        setQuickReplies(list.filter((t) => t.scope === 'root'));
      }
    } catch (error) {
      console.error('Erro ao carregar templates:', error);
    }
  };

  const openAppearanceSettings = () => {
    setAppearanceDraft({ ...chatAppearance });
    setNameEditor({ open: true, value: user?.name || '', saving: false });
  };

  const handleChatBackgroundFile = async (event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = '';
    if (!file) return;
    try {
      const backgroundImage = await compressChatBackground(file);
      setAppearanceDraft((previous) => ({
        ...previous,
        backgroundMode: 'image',
        backgroundImage,
      }));
    } catch (error) {
      toast.error(error?.message || 'Não foi possível usar esta imagem');
    }
  };

  const handleSaveAgentName = async () => {
    const name = String(nameEditor.value || '').trim();
    if (name.length < 2) return toast.error('Nome muito curto');
    setNameEditor((p) => ({ ...p, saving: true }));
    try {
      if (name !== String(user?.name || '').trim()) {
        const res = await apiRequest('/auth/me', {
          method: 'PATCH',
          body: JSON.stringify({ name })
        });
        const data = res ? await res.json().catch(() => ({})) : null;
        if (!res || !res.ok) {
          throw new Error(data?.error || 'Falha ao salvar nome');
        }
        if (data?.user && updateUser) updateUser(data.user);
        else if (updateUser) updateUser({ name });
      }
      const normalizedAppearance = normalizeChatAppearance(appearanceDraft);
      localStorage.setItem(
        chatAppearanceStorageKey(user?.id),
        JSON.stringify(normalizedAppearance)
      );
      setChatAppearance(normalizedAppearance);
      setAppearanceDraft(normalizedAppearance);
      toast.success('Aparência atualizada');
      setNameEditor({ open: false, value: '', saving: false });
    } catch (error) {
      toast.error(error?.message || 'Falha ao salvar preferências');
      setNameEditor((p) => ({ ...p, saving: false }));
    }
  };

  const handleSaveQuickReply = async () => {
    const name = String(quickEditor.name || '').trim();
    const text = String(quickEditor.text || '').trim();
    if (!name || !text) return toast.error('Preencha nome e texto');
    setQuickEditor((p) => ({ ...p, saving: true }));
    try {
      const isEdit = Boolean(quickEditor.id);
      const res = await apiRequest(
        isEdit ? `/templates/agent-quick/${quickEditor.id}` : '/templates/agent-quick',
        {
          method: isEdit ? 'PUT' : 'POST',
          body: JSON.stringify({ name, text })
        }
      );
      const data = res ? await res.json().catch(() => ({})) : null;
      if (!res || !res.ok) {
        toast.error(data?.error || 'Falha ao salvar mensagem rápida');
        setQuickEditor((p) => ({ ...p, saving: false }));
        return;
      }
      toast.success(isEdit ? 'Mensagem atualizada' : 'Mensagem criada');
      setQuickEditor({ open: false, id: null, name: '', text: '', saving: false });
      await reloadQuickReplies();
    } catch {
      toast.error('Falha ao salvar mensagem rápida');
      setQuickEditor((p) => ({ ...p, saving: false }));
    }
  };

  const handleDeleteQuickReply = async (tpl) => {
    if (!tpl?.id) return;
    if (tpl.createdBy && tpl.createdBy !== user?.id && !['ADMIN', 'SUPER_ADMIN'].includes(user?.role)) {
      return toast.error('Só pode apagar mensagens criadas por você');
    }
    const ok = await confirm({
      title: 'Apagar mensagem rápida?',
      message: `Remover "${tpl.name}"?`,
      confirmText: 'Apagar'
    }).catch(() => false);
    if (!ok) return;
    try {
      const res = await apiRequest(`/templates/agent-quick/${tpl.id}`, { method: 'DELETE' });
      if (!res || !res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error || 'Falha ao apagar');
        return;
      }
      toast.success('Removida');
      await reloadQuickReplies();
    } catch {
      toast.error('Falha ao apagar');
    }
  };

  const handleQuickSelect = (template) => {
    const filled = renderTemplateText(template.text || '');
    setQuickDraft(filled);
    setMobilePanelOpen(false);
    setShowQuickModal(true);
  };

  const handleQuickSend = async () => {
    if (!quickDraft.trim() || !selectedChat) return;
    if (selectedChat.status === 'waiting') return toast.error("Puxe o atendimento antes de responder.");
    if (selectedChat.outreachPendingReply === true) return toast.error("Aguarde a primeira resposta do cliente antes de enviar mensagens.");
    // Mesmo congelamento de alvo do handleSend (evita quick reply no card errado)
    const targetChat = selectedChat;
    const targetChatId = targetChat.id;
    const targetName = targetChat.customerName || 'cliente';
    const targetGx = targetChat.genesysConvId || targetChat.externalConvId || null;
    const textToSend = quickDraft;
    try {
      const replyToMessageId = replyingTo?.id || null;
      const res = await apiRequest(`/chats/${targetChatId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          sender: 'agent',
          agentName: user.name,
          text: textToSend,
          ...(targetGx ? { genesysConvId: targetGx } : {}),
          ...(replyToMessageId ? { replyToMessageId } : {})
        })
      });
      const data = res ? await res.json().catch(() => ({})) : null;
      if (res && res.ok) {
        const savedMsg = data;
        setReplyingTo(null);
        setSelectedChat((prev) => {
          if (!prev || prev.id !== targetChatId) return prev;
          return {
            ...prev,
            messages: appendRealtimeMessage(prev?.messages, savedMsg)
          };
        });
        setShowQuickModal(false);
        setQuickDraft('');
        toast.success(`Enviado → ${data?.customerName || targetName}`);
      } else {
        toast.error(data?.error || 'Falha no envio');
      }
    } catch (error) {
      toast.error('Falha no envio');
    }
  };

  const filterVars = (vars) => {
    if (!vars) return [];
    const entries = Object.entries(vars);
    if (!visibleVars || visibleVars.length === 0) return entries;
    return entries.filter(([key]) => visibleVars.includes(key));
  };

  const formatTime = (value) => {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  const belongsToSameMessageGroup = (previousMessage, currentMessage) => {
    if (!previousMessage || !currentMessage) return false;
    if (previousMessage.sender === 'system' || currentMessage.sender === 'system') return false;
    if (previousMessage.sender !== currentMessage.sender) return false;

    const previousTimestamp = new Date(previousMessage.timestamp).getTime();
    const currentTimestamp = new Date(currentMessage.timestamp).getTime();
    if (!Number.isFinite(previousTimestamp) || !Number.isFinite(currentTimestamp)) return true;

    const elapsedMs = currentTimestamp - previousTimestamp;
    return elapsedMs >= 0 && elapsedMs <= 5 * 60 * 1000;
  };

  const getLastMessagePreview = (chat) => {
    const messages = Array.isArray(chat?.messages) ? chat.messages : [];
    const lastMessage = messages[messages.length - 1] || chat?.lastMessage || null;
    if (!lastMessage) {
      return chat?.status === 'waiting' ? 'Aguardando atendimento' : 'Sem mensagens ainda';
    }
    const media = lastMessage?.media || lastMessage?.attachment || null;
    if (media && (media.url || media.type || media.fileName || media.filename)) {
      const kind = String(media.type || media.mediaType || '').toLowerCase();
      const label = kind === 'image' ? '📷 Imagem'
        : kind === 'video' ? '🎬 Vídeo'
        : kind === 'audio' ? '🎵 Áudio'
        : kind === 'document' ? '📄 Documento'
        : '📎 Anexo';
      const name = media.fileName || media.filename || '';
      const caption = String(lastMessage?.text || media.caption || '').trim();
      if (name) return `${label}: ${name}`;
      if (caption && !/^\[(image|video|audio|document|mídia)\]$/i.test(caption)) {
        return `${label}: ${caption}`;
      }
      return label;
    }
    if (lastMessage?.media?.fileName) return lastMessage.media.fileName;
    if (lastMessage?.media?.type) return `[${lastMessage.media.type}]`;
    return String(lastMessage?.text || '').trim() || 'Sem mensagens';
  };

  const formatFileSize = (bytes) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const closeMediaModal = useCallback(() => {
    setMediaModal((prev) => {
      if (prev.previewUrl) {
        URL.revokeObjectURL(prev.previewUrl);
      }
      return {
        open: false,
        file: null,
        previewUrl: '',
        previewKind: 'document',
        caption: '',
        uploading: false
      };
    });
  }, []);

  const handleMediaFileSelected = useCallback((event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const type = String(file.type || '').toLowerCase();
    const previewKind = type.startsWith('image/')
      ? 'image'
      : type.startsWith('video/')
        ? 'video'
        : type.startsWith('audio/')
          ? 'audio'
          : 'document';
    const previewUrl = URL.createObjectURL(file);

    setMediaModal((prev) => {
      if (prev.previewUrl) {
        URL.revokeObjectURL(prev.previewUrl);
      }
      return {
        open: true,
        file,
        previewUrl,
        previewKind,
        caption: '',
        uploading: false
      };
    });
  }, []);

  const openMediaPicker = () => {
    if (!selectedChat) return;
    if (selectedChatReplyLocked) return toast.error('Aguarde a primeira resposta do cliente antes de enviar mensagens.');
    mediaInputRef.current?.click();
  };

  const handleSendMedia = async () => {
    if (!selectedChat || !mediaModal.file) return;
    if (selectedChat.status === 'waiting') return toast.error('Puxe o atendimento antes de enviar mensagens.');
    if (selectedChat.outreachPendingReply === true) return toast.error('Aguarde a primeira resposta do cliente antes de enviar mensagens.');

    try {
      setMediaModal((prev) => ({ ...prev, uploading: true }));
      const asset = await uploadMediaAsset(mediaModal.file);
      const mimeType = String(asset?.mimeType || mediaModal.file.type || '').toLowerCase();
      const mediaType = mimeType.startsWith('image/')
        ? 'image'
        : mimeType.startsWith('video/')
          ? 'video'
          : mimeType.startsWith('audio/')
            ? 'audio'
            : 'document';

      const replyToMessageId = replyingTo?.id || null;
      const res = await apiRequest(`/chats/${selectedChat.id}/media`, {
        method: 'POST',
        body: JSON.stringify({
          sender: 'agent',
          agentName: user.name,
          mediaType,
          mediaUrl: asset.url,
          fileName: asset.originalName || mediaModal.file.name,
          mimeType: asset.mimeType || mediaModal.file.type || '',
          contentLengthBytes: Number(asset.size || mediaModal.file.size || 0),
          caption: mediaModal.caption || '',
          ...(isGenesysChatClient(selectedChat)
            ? { genesysConvId: chatConversationId(selectedChat) }
            : {}),
          ...(replyToMessageId ? { replyToMessageId } : {})
        })
      });

      const data = res ? await res.json().catch(() => ({})) : null;
      if (res && res.ok) {
        setReplyingTo(null);
        setSelectedChat((prev) => ({
          ...prev,
          messages: appendRealtimeMessage(prev?.messages, data),
          lastMessage: data,
          lastMessageAt: data?.timestamp || prev?.lastMessageAt,
          updatedAt: data?.timestamp || new Date().toISOString()
        }));
        if (data?.genesys?.relayed === false) {
          toast.error(data.genesys.reason || 'A extensão do Genesys não recebeu o anexo.');
        }
        closeMediaModal();
      } else {
        toast.error(data?.error || 'Falha ao enviar midia');
        setMediaModal((prev) => ({ ...prev, uploading: false }));
      }
    } catch (error) {
      toast.error(error?.message || 'Falha ao enviar midia');
      setMediaModal((prev) => ({ ...prev, uploading: false }));
    }
  };

  useEffect(() => () => {
    if (mediaModal.previewUrl) {
      URL.revokeObjectURL(mediaModal.previewUrl);
    }
  }, [mediaModal.previewUrl]);

  const renderChatListItem = (chat, tone = 'active') => {
    const chatId = String(chat?.id || '');
    const selected = Boolean(selectedChat?.id) && String(selectedChat.id) === chatId;
    const waitingTone = tone === 'waiting';
    const isDragging = draggingChatId === chatId;
    const resolvedContactName = resolveContactNameForChat(chat);
    const resolvedWaId = getChatWaId(chat);
    // Card: nome da conversa/WhatsApp (customerName), NUNCA o nome legal IXC
    const ixcName = String(chat?.vars?.nome_cliente || chat?.variables?.nome_cliente || '').trim();
    const channelName = String(chat?.customerName || '').trim();
    const safeChannelName = channelName && channelName !== ixcName ? channelName : '';
    const safeContactName = resolvedContactName && String(resolvedContactName).trim() !== ixcName
      ? resolvedContactName
      : '';
    const name = safeChannelName
      || safeContactName
      || resolvedWaId
      || (waitingTone ? 'Anonimo' : 'Cliente');
    const preview = getLastMessagePreview(chat);
    const lastMessage = Array.isArray(chat?.messages) ? chat.messages[chat.messages.length - 1] : null;
    const unreadCount = Number(unreadByChatId[chat.id] || 0);
    const showGenesysInactivity = isGenesysChatClient(chat) && Boolean(resolveGenesysLastActivityAt(chat));
    // Borda de selecao fica no shell INTERNO (fora do transform residual do motion)
    const shellClass = waitingTone
      ? (selected
        ? 'border-orange-400 bg-orange-50 dark:border-orange-400 dark:bg-orange-900/20'
        : 'border-orange-200/80 bg-orange-50/80 dark:border-orange-900/40 dark:bg-orange-900/10')
      : (selected
        ? 'border-blue-500 bg-white dark:border-blue-400 dark:bg-slate-800'
        : 'border-blue-200/80 bg-white dark:border-slate-700 dark:bg-slate-800/90');
    const selectedOutlineClass = selected
      ? (waitingTone
        ? 'shadow-[0_0_0_2px_rgba(251,146,60,0.55)]'
        : 'shadow-[0_0_0_2px_rgba(59,130,246,0.55)]')
      : 'shadow-sm';

    return (
      <Reorder.Item
        key={chatId}
        value={chatId}
        as="div"
        dragListener
        dragElastic={0.12}
        onDragStart={() => handleChatCardDragStart(chatId)}
        onDrag={handleChatCardDrag}
        onDragEnd={handleChatCardDragEnd}
        whileDrag={{
          scale: 1.02,
          zIndex: 50,
          cursor: 'grabbing'
        }}
        transition={{ type: 'spring', stiffness: 480, damping: 36, mass: 0.65 }}
        className={`agent-chat-card mx-1.5 my-1 w-[calc(100%-0.75rem)] ${isDragging ? 'agent-chat-card-dragging' : ''}`}
        style={{ position: 'relative', touchAction: 'none', zIndex: isDragging ? 50 : 'auto', cursor: isDragging ? 'grabbing' : 'pointer' }}
      >
        <div
          className={`ui-card-hover relative overflow-hidden rounded-lg border px-1.5 py-1 text-left transition-[border-color,box-shadow,background-color] duration-150 ${shellClass} ${selectedOutlineClass}`}
          data-selected={selected ? 'true' : 'false'}
          data-chat-id={chatId}
        >
          {showGenesysInactivity ? <GenesysInactivityLiquid chat={chat} /> : null}
          <button
            type="button"
            onClick={() => handleChatCardClick(chat)}
            className={`relative z-10 flex w-full min-w-0 items-center gap-1.5 text-left ${isDragging ? 'cursor-grabbing' : 'cursor-pointer'}`}
            title="Arraste o card para reordenar"
          >
            <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${waitingTone ? 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-300' : 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300'}`}>
              <User size={12} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-1">
                <div className="flex min-w-0 items-center gap-1">
                  <div className="truncate text-[11px] font-semibold leading-tight text-gray-900 dark:text-white">{name}</div>
                  {renderChannelBadge(chat.channel, true)}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {unreadCount > 0 ? (
                    <span className="inline-flex min-w-[16px] justify-center rounded-full bg-red-500 px-1 py-px text-[8px] font-bold text-white">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  ) : null}
                  <span className="text-[9px] font-medium tabular-nums text-gray-400">
                    {formatTime(lastMessage?.timestamp || chat.updatedAt || chat.createdAt)}
                  </span>
                </div>
              </div>
              <div className={`mt-px truncate text-[10px] leading-tight text-gray-500 dark:text-gray-400 ${showGenesysInactivity ? 'pr-10' : ''}`}>{preview}</div>
              {waitingTone ? (
                <div className="text-[9px] font-semibold text-orange-600 dark:text-orange-300">
                  Esperando ha <WaitingElapsed since={chat.waitingSince || chat.transferredAt || chat.createdAt} />
                </div>
              ) : null}
            </div>
          </button>
        </div>
      </Reorder.Item>
    );
  };

  const copyClientInfo = async (label, raw) => {
    const value = String(raw ?? '').trim();
    if (!value || value === '-') return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      toast.success(`${label} copiado`);
    } catch {
      toast.error('Não foi possível copiar');
    }
  };

  const InfoCopyValue = ({ label, value, className = '', align = 'left' }) => {
    const display = value !== undefined && value !== null && String(value).trim() !== ''
      ? String(value)
      : '—';
    const canCopy = display !== '—';
    const alignClass = align === 'right' ? 'text-right' : 'text-left';
    return (
      <button
        type="button"
        title={canCopy ? `Clique para copiar ${label}` : undefined}
        disabled={!canCopy}
        onClick={() => copyClientInfo(label, display)}
        className={`w-full break-words text-[13px] font-medium leading-snug transition-colors ${alignClass} ${
          canCopy
            ? 'cursor-copy text-slate-800 hover:text-blue-600 dark:text-slate-100 dark:hover:text-blue-400'
            : 'cursor-default text-slate-400 dark:text-slate-500'
        } ${className}`}
      >
        {display}
      </button>
    );
  };

  const InfoField = ({ label, value, mono = false }) => (
    <div className="py-2.5 first:pt-0">
      <div className="text-[11px] font-medium tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </div>
      <div className={`mt-0.5 ${mono ? 'font-mono text-[12.5px] tracking-tight' : ''}`}>
        <InfoCopyValue label={label} value={value} />
      </div>
    </div>
  );

  const handleBuscarIxc = async () => {
    if (!selectedChat?.id) return;
    const currentIxcData = selectedChat?.ixcData || chatVars?.ixc_dados;
    if (currentIxcData && typeof currentIxcData === 'object') {
      setIxcDetailsModal({ open: true, chatId: selectedChat.id, closing: false });
      return;
    }
    if (ixcRequestedChatId === selectedChat.id) {
      toast('A consulta IXC ainda está sendo processada pela extensão');
      return;
    }
    const isGenesys = String(selectedChat.channel || '').toLowerCase() === 'genesys'
      || selectedChat.genesysConvId
      || selectedChat.externalSource === 'genesys';
    if (!isGenesys) {
      toast.error('Busca IXC só em atendimentos Genesys');
      return;
    }
    setIxcSearching(true);
    try {
      const res = await apiRequest(`/chats/${selectedChat.id}/buscar-ixc`, {
        method: 'POST',
        body: JSON.stringify({
          cpf: chatVars?.cpf
            || selectedChat?.vars?.cpf
            || resolvedCustomerDocument(selectedChat),
        }),
      });
      if (!res) {
        toast.error('Sessão expirada ou API indisponível');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Falha ao pedir busca IXC');
        return;
      }
      setIxcRequestedChatId(selectedChat.id);
      toast.success('Busca IXC enviada — clique novamente quando os dados carregarem');
      // poll leve: a extensão grava vars e emite chat_updated
      setTimeout(() => fetchAll?.(), 2500);
      setTimeout(() => fetchAll?.(), 6000);
    } catch (e) {
      toast.error(e?.message || 'Erro ao buscar IXC');
    } finally {
      setIxcSearching(false);
    }
  };

  const handleReloadGenesysConversation = async () => {
    if (!selectedChat?.id || conversationReloading) return;
    setConversationReloading(true);
    try {
      const response = await apiRequest(`/chats/${encodeURIComponent(selectedChat.id)}/hydrate-genesys`, {
        method: 'POST',
        body: JSON.stringify({ force: true }),
      });
      const data = await response?.json().catch(() => ({}));
      if (!response?.ok) {
        toast.error(data?.error || 'Não foi possível recarregar a conversa');
        return;
      }
      toast.success('Recarregamento enviado para a extensão');
      setTimeout(() => { void loadChatDetails(selectedChat.id); }, 1200);
      setTimeout(() => { void loadChatDetails(selectedChat.id); }, 3500);
    } catch (error) {
      toast.error(error?.message || 'Erro ao recarregar a conversa');
    } finally {
      setConversationReloading(false);
    }
  };

  const handleFlushGenesysLocal = async () => {
    if (genesysFlushLoading) return;
    const visibleGenesysChats = [...myChats, ...waitingChats]
      .filter(isGenesysChatClient)
      .filter((chat, index, list) => list.findIndex((item) => item?.id === chat?.id) === index);
    if (!visibleGenesysChats.length) {
      toast('Não há clientes Genesys para limpar no Onion');
      return;
    }
    const approved = await confirm({
      title: 'Limpar clientes Genesys do Onion',
      message: `Remover ${visibleGenesysChats.length} cliente(s) apenas do Onion? Isso não encerra as conversas no Genesys. Se a extensão reconectar e elas continuarem ativas, poderão aparecer novamente.`,
      confirmText: 'Limpar Onion',
      type: 'danger',
    });
    if (!approved) return;

    setGenesysFlushLoading(true);
    try {
      const response = await apiRequest('/chats/actions/flush-genesys-local', {
        method: 'POST',
        body: JSON.stringify({})
      });
      const data = await response?.json().catch(() => ({}));
      if (!response?.ok) throw new Error(data?.error || 'Não foi possível limpar os clientes');
      [...chatDetailsCacheRef.current.entries()].forEach(([cachedId, entry]) => {
        if (isGenesysChatClient(entry?.chat)) invalidateCachedChat(cachedId);
      });
      setSelectedChat((previous) => (isGenesysChatClient(previous) ? null : previous));
      setMyChats((list) => (Array.isArray(list) ? list.filter((chat) => !isGenesysChatClient(chat)) : list));
      setWaitingChats((list) => (Array.isArray(list) ? list.filter((chat) => !isGenesysChatClient(chat)) : list));
      toast.success(`Limpeza concluída: ${visibleGenesysChats.length} card(s) removido(s) do Onion`);
      setTimeout(() => { void fetchAll?.(); }, 500);
    } catch (error) {
      toast.error(error?.message || 'Erro ao limpar clientes Genesys');
    } finally {
      setGenesysFlushLoading(false);
    }
  };

  const refreshIxcLogins = async () => {
    if (!selectedChat?.id || ixcLoginsRefreshing) return;
    const currentIxcData = selectedChat?.ixcData || chatVars?.ixc_dados;
    if (!currentIxcData?.clientId) {
      toast.error('Busque os dados do IXC antes de atualizar o IP');
      return;
    }
    setIxcLoginsRefreshing(true);
    try {
      const response = await apiRequest(`/chats/${encodeURIComponent(selectedChat.id)}/refresh-ixc-logins`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const data = await response?.json().catch(() => ({}));
      if (!response?.ok) {
        toast.error(data?.error || 'Não foi possível atualizar o IP');
        return;
      }
      toast.success('Atualização de IP enviada');
      setTimeout(() => { void loadChatDetails(selectedChat.id); }, 900);
      setTimeout(() => { void loadChatDetails(selectedChat.id); }, 2400);
    } catch (error) {
      toast.error(error?.message || 'Erro ao atualizar o IP');
    } finally {
      window.setTimeout(() => setIxcLoginsRefreshing(false), 2500);
    }
  };

  const refreshIxcOrders = async () => {
    if (!selectedChat?.id || ixcOrdersRefreshing) return;
    setIxcOrdersRefreshing(true);
    try {
      const response = await apiRequest(`/chats/${encodeURIComponent(selectedChat.id)}/buscar-ixc`, {
        method: 'POST',
        body: JSON.stringify({
          cpf: chatVars?.cpf
            || selectedChat?.ixcData?.cpf
            || selectedChat?.vars?.cpf
          || resolvedCustomerDocument(selectedChat),
        }),
      });
      const data = await response?.json().catch(() => ({}));
      if (!response?.ok) throw new Error(data?.error || 'Falha ao atualizar as OS');
      toast.success('Atualização das OS solicitada');
      window.setTimeout(() => fetchAll?.(), 1800);
      window.setTimeout(() => fetchAll?.(), 4000);
    } catch (error) {
      toast.error(error?.message || 'Falha ao atualizar as OS');
    } finally {
      window.setTimeout(() => setIxcOrdersRefreshing(false), 4500);
    }
  };

  const getRouterTargets = () => {
    const details = selectedChat?.ixcData || chatVars?.ixc_dados;
    const seen = new Set();
    return activeIxcLogins(details).flatMap((login) => {
      if (login?.online !== true) return [];
      const ip = String(login?.ipv4 || '').trim();
      if (!/^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2}$/.test(ip) || seen.has(ip)) return [];
      seen.add(ip);
      const address = [login.street, login.houseNumber, login.neighborhood].filter(Boolean).join(', ');
      return [{ ip, address: address || login.pppoeUser || `Login ${login.loginId || ''}`.trim(), login }];
    });
  };

  const testRouterTarget = async (target) => {
    if (!selectedChat?.id || !target?.ip) return;
    setRouterProbe({ chatId: selectedChat.id, ip: target.ip, status: 'testing', url: '', openPorts: [], pickerOpen: false });
    try {
      const response = await apiRequest(`/chats/${encodeURIComponent(selectedChat.id)}/testar-roteador`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: target.ip }),
      });
      const data = await response?.json().catch(() => ({}));
      if (!response?.ok) throw new Error(data?.error || 'Falha ao testar o roteador');
      const accessible = data?.accessible === true && Boolean(data?.url);
      setRouterProbe({
        chatId: selectedChat.id,
        ip: target.ip,
        status: accessible ? 'online' : 'offline',
        url: accessible ? String(data.url) : '',
        openPorts: Array.isArray(data?.openPorts) ? data.openPorts : [],
        pickerOpen: false,
      });
      toast(accessible ? `Roteador acessível em ${data.url}` : `Nenhuma porta respondeu em ${target.ip}`, {
        icon: accessible ? '●' : '○',
      });
    } catch (error) {
      setRouterProbe({ chatId: selectedChat.id, ip: target.ip, status: 'offline', url: '', openPorts: [], pickerOpen: false });
      toast.error(error?.message || 'Falha ao testar o roteador');
    }
  };

  const handleRouterButton = () => {
    if (!selectedChat?.id) return;
    const details = selectedChat?.ixcData || chatVars?.ixc_dados;
    if (!details || !Array.isArray(details?.logins)) {
      toast.error('Busque os dados do IXC desta conversa antes de testar o roteador');
      return;
    }
    if (!activeIxcLogins(details).some((login) => login?.online === true)) {
      toast.error('Todos os logins retornados pelo IXC estão offline');
      return;
    }
    if (routerProbe.chatId === selectedChat.id && routerProbe.status === 'online' && routerProbe.url) {
      window.open(routerProbe.url, '_blank', 'noopener,noreferrer');
      return;
    }
    const targets = getRouterTargets();
    if (!targets.length) {
      toast.error('Nenhum IP CGNAT disponível nos logins IXC');
      return;
    }
    if (targets.length === 1) {
      testRouterTarget(targets[0]);
      return;
    }
    setRouterProbe((previous) => ({
      ...previous,
      chatId: selectedChat.id,
      pickerOpen: !previous.pickerOpen || previous.chatId !== selectedChat.id,
    }));
  };

  const requestAiSuggestion = async () => {
    const targetChatId = String(selectedChat?.id || '');
    if (!targetChatId || !isGenesysChatClient(selectedChat) || aiLoading) return;
    const requestId = aiRequestRef.current + 1;
    aiRequestRef.current = requestId;
    setAiLoading(true);
    setAiError('');
    try {
      const res = await apiRequest(`/chats/${encodeURIComponent(targetChatId)}/genesys-ai-suggestion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentGuidance: aiAgentGuidance.trim() })
      });
      const data = await res.json().catch(() => ({}));
      if (requestId !== aiRequestRef.current || String(selectedChatRef.current?.id || '') !== targetChatId) return;
      if (!res.ok) throw new Error(data?.error || 'Nao foi possivel analisar a conversa agora.');
      setAiSuggestion(data);
      setAiSuggestedReply(String(data?.suggestedReply || ''));
    } catch (error) {
      if (requestId !== aiRequestRef.current || String(selectedChatRef.current?.id || '') !== targetChatId) return;
      setAiError(error?.message || 'Nao foi possivel analisar a conversa agora.');
    } finally {
      if (requestId === aiRequestRef.current && String(selectedChatRef.current?.id || '') === targetChatId) {
        setAiLoading(false);
      }
    }
  };

  const copyAiSuggestion = async () => {
    const value = String(aiSuggestedReply || '').trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success('Resposta copiada');
    } catch {
      toast.error('Nao foi possivel copiar a resposta');
    }
  };

  const insertAiSuggestion = () => {
    const value = String(aiSuggestedReply || '');
    if (!value) return;
    setAgentInput(value);
    if (isMobileView) setIsAiPanelOpen(false);
    requestAnimationFrame(() => agentInputRef.current?.focus());
    toast.success('Resposta inserida no campo para revisao');
  };

  const renderAiPanel = () => (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-violet-100 pb-3 dark:border-violet-900/30">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
            <OnionAiIcon size={18} /> Assistente IA
          </div>
          <div className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{selectedChatName}</div>
        </div>
        <button type="button" onClick={() => setIsAiPanelOpen(false)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200" title="Fechar assistente"><XIcon size={16} /></button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-4 custom-scrollbar">
        <section className="mb-4">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="ai-agent-guidance" className="text-[10px] font-bold uppercase tracking-wider text-violet-500">Contexto ou sugestao do agente</label>
            <span className="text-[9px] text-slate-400">{aiAgentGuidance.length}/2000</span>
          </div>
          <textarea
            id="ai-agent-guidance"
            rows={4}
            maxLength={2000}
            value={aiAgentGuidance}
            onChange={(event) => setAiAgentGuidance(event.target.value)}
            disabled={aiLoading}
            placeholder="Ex: Considere que ha disponibilidade amanha, ofereca reagendamento sem prometer horario."
            className="mt-1 min-h-[86px] w-full resize-y rounded-2xl border border-violet-200 bg-violet-50/40 px-3 py-2 text-xs leading-relaxed text-slate-800 outline-none placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100 disabled:opacity-60 dark:border-violet-900/50 dark:bg-violet-950/20 dark:text-slate-100 dark:focus:ring-violet-900/30"
          />
          <p className="mt-1 text-[10px] leading-relaxed text-slate-400">Opcional. A IA considera esta orientacao junto com todo o historico. O texto nao e salvo na conversa.</p>
        </section>
        {!aiSuggestion && !aiLoading ? (
          <div className="rounded-2xl border border-violet-100 bg-violet-50/70 p-4 text-center dark:border-violet-900/40 dark:bg-violet-950/20">
            <OnionAiIcon size={28} className="mx-auto" />
            <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">Analise o historico completo e receba uma resposta para revisar. Nada sera enviado automaticamente.</p>
          </div>
        ) : null}
        {aiLoading ? <div className="flex flex-col items-center justify-center py-12 text-center"><Loader2 size={26} className="animate-spin text-violet-500" /><div className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-200">Analisando conversa...</div><div className="mt-1 text-xs text-slate-400">Isso pode levar alguns segundos.</div></div> : null}
        {aiError && !aiLoading ? <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">{aiError}</div> : null}
        {aiSuggestion && !aiLoading ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-semibold text-violet-500"><span className="inline-flex items-center gap-1.5"><BrainCircuit size={13} />{Number(aiSuggestion.memoryCount || 0)} {Number(aiSuggestion.memoryCount || 0) === 1 ? 'memoria pessoal usada' : 'memorias pessoais usadas'}</span><span className="text-slate-400">• {aiSuggestion.provider === 'groq' ? 'Groq fallback' : 'Gemini'}{aiSuggestion.rateLimits?.remainingRequests ? ` • ${aiSuggestion.rateLimits.remainingRequests} chamadas restantes` : ''}</span></div>
            <section><div className="text-[10px] font-bold uppercase tracking-wider text-violet-500">Problema identificado</div><p className="mt-1 text-xs leading-relaxed text-slate-700 dark:text-slate-200">{aiSuggestion.problem}</p></section>
            <section><div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Ultima mensagem do cliente</div><blockquote className="mt-1 rounded-xl border-l-4 border-blue-400 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600 dark:bg-slate-800 dark:text-slate-300">{aiSuggestion.lastCustomerMessage}</blockquote></section>
            <section><div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Por que esta sugestao</div><p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{aiSuggestion.reasoning}</p></section>
            <section><label className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Resposta sugerida - editavel</label><textarea rows={8} value={aiSuggestedReply} onChange={(event) => setAiSuggestedReply(event.target.value)} className="mt-1 min-h-[150px] w-full resize-y rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-slate-800 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-violet-900/30" /></section>
          </div>
        ) : null}
      </div>

      <div className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
        <button type="button" onClick={requestAiSuggestion} disabled={aiLoading} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-3 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60">{aiLoading ? <Loader2 size={15} className="animate-spin" /> : aiSuggestion ? <RefreshCw size={15} /> : <OnionAiIcon size={16} />}{aiLoading ? 'Analisando...' : aiSuggestion ? 'Gerar novamente' : 'Analisar conversa'}</button>
        {aiSuggestion ? <div className="grid grid-cols-2 gap-2"><button type="button" onClick={copyAiSuggestion} disabled={!aiSuggestedReply.trim()} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-2 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"><Copy size={14} />Copiar resposta</button><button type="button" onClick={insertAiSuggestion} disabled={!aiSuggestedReply.trim()} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-2 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-300"><MessageSquareText size={14} />Inserir no campo</button></div> : null}
      </div>
    </div>
  );

  const closeIxcDetailsScreen = () => {
    setIxcDetailsModal((previous) => ({ ...previous, closing: true }));
    window.setTimeout(() => {
      setIxcDetailsModal((previous) => (
        previous.closing ? { open: false, chatId: '', closing: false } : previous
      ));
    }, 520);
  };

  const openIxcOsOperation = (order) => {
    const details = selectedChat?.ixcData || chatVars?.ixc_dados;
    const fallbackAddress = [
      details?.street, details?.houseNumber, details?.neighborhood, details?.city, details?.state,
    ].filter(Boolean).join(', ');
    setIxcOsOperation((previous) => ({
      ...previous,
      open: true,
      order,
      diagnosisId: '',
      diagnosisQuery: '',
      nextTaskCode: '',
      nextTaskQuery: '',
      sectorCode: '',
      visitDate: defaultIxcVisitDate(),
      visitPeriod: 'MANHA',
      periodNote: '',
      description: '',
      reference: order?.reference || '',
      address: order?.address || fallbackAddress,
      phone: order?.phone || details?.phone || '',
      selectedMedia: {},
      submitting: false,
    }));
  };

  const setIxcVisitPeriod = (visitPeriod) => {
    setIxcOsOperation((previous) => {
      const date = new Date(previous.visitDate || defaultIxcVisitDate());
      date.setHours(visitPeriod === 'TARDE' ? 12 : 8, visitPeriod === 'TARDE' ? 1 : 0, 0, 0);
      const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
      return { ...previous, visitPeriod, visitDate: local.toISOString().slice(0, 16) };
    });
  };

  const submitIxcOsOperation = async () => {
    const details = selectedChat?.ixcData || chatVars?.ixc_dados;
    const operation = ixcOsOperation;
    const finalizeOnly = PRE_OS_TASK_CODES.has(operation.nextTaskCode);
    if (!selectedChat?.id || !operation.order?.osId) return;
    if (!details?.ixcOperator?.configured) {
      toast.error('Colaborador do IXC não configurado. Abra o popup da extensão e identifique seu usuário.');
      return;
    }
    if (!operation.diagnosisId || !operation.nextTaskCode || operation.description.trim().length < 10) {
      toast.error('Preencha diagnóstico, tarefa e descrição com ao menos 10 caracteres');
      return;
    }
    if (!finalizeOnly && (!operation.sectorCode.trim() || !operation.visitDate)) {
      toast.error('Informe setor técnico e data da visita');
      return;
    }
    const approved = await confirm({
      title: finalizeOnly ? `Gerar Pré-OS pela OS #${operation.order.osId}?` : `Finalizar e encaminhar a OS #${operation.order.osId}?`,
      message: finalizeOnly
        ? 'A OS selecionada será finalizada e a nova Pré-OS ficará disponível para anexos.'
        : 'A OS selecionada será finalizada. A extensão só encaminhará se identificar exatamente uma nova OS.',
      confirmText: finalizeOnly ? 'Gerar Pré-OS' : 'Finalizar e encaminhar',
      type: 'warning',
    });
    if (!approved) return;
    const period = operation.visitPeriod === 'TARDE'
      ? 'TARDE (12:01 ÀS 18:00)'
      : 'MANHÃ (08:00 ÀS 12:00)';
    const mensagem = [
      `ENDEREÇO: ${operation.address.trim()}`,
      `LOCALIZAÇÃO OU REFERÊNCIA: ${operation.reference.trim()}`,
      `TELEFONE: ${operation.phone.trim()}`,
      `NOME DO SOLICITANTE: ${String(details?.fullName || selectedChatName || '').toUpperCase()}`,
      `PERÍODO DA VISITA: ${period}${operation.periodNote.trim() ? ` ${operation.periodNote.trim()}` : ''}`,
      `DESCREVA O PROBLEMA: ${operation.description.trim().toUpperCase()}`,
    ].join('\n');
    setIxcOsOperation((previous) => ({ ...previous, submitting: true }));
    try {
      const response = await apiRequest(`/chats/${encodeURIComponent(selectedChat.id)}/ixc-os`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedOsId: operation.order.osId,
          diagnosisId: operation.diagnosisId,
          nextTaskCode: operation.nextTaskCode,
          sectorCode: operation.sectorCode,
          visitDate: operation.visitDate,
          mensagem,
          attachments: Object.values(operation.selectedMedia || {}).map((media) => ({
            messageId: media.messageId,
            description: String(media.description || media.fileName || '').trim(),
          })),
        }),
      });
      const data = await response?.json().catch(() => ({}));
      if (!response?.ok) throw new Error(data?.error || 'Falha ao iniciar o fluxo');
      toast.success('Operação enviada à extensão. Aguardando confirmação do IXC.');
      setIxcOsOperation((previous) => ({ ...previous, open: false, order: null, submitting: false }));
    } catch (error) {
      toast.error(error?.message || 'Falha ao iniciar o fluxo de OS');
      setIxcOsOperation((previous) => ({ ...previous, submitting: false }));
    }
  };

  const renderIxcDetailsModal = () => {
    const details = selectedChat?.ixcData || chatVars?.ixc_dados;
    if (!ixcDetailsModal.open || ixcDetailsModal.chatId !== selectedChat?.id || !details || typeof details !== 'object') return null;
    const allOrders = Array.isArray(details.osList) ? details.osList : [];
    const orders = allOrders.slice(0, 10);
    const logins = activeIxcLogins(details);
    const address = [
      details.street,
      details.houseNumber,
      details.neighborhood,
      details.city,
      details.state,
      details.zipCode,
      details.complement,
    ].filter(Boolean).join(', ');
    const fields = [
      ['Nome', details.fullName],
      ['CPF / CNPJ', details.cpf || chatVars?.cpf],
      ['Código do cliente', details.clientId],
      ['Situação', details.active === true ? 'Ativo' : details.active === false ? 'Inativo' : 'Não informado'],
      ['Tipo', details.clientType],
      ['Telefone', details.phone],
      ['Telefone alternativo', details.phoneAlt],
      ['E-mail', details.email],
      ['Endereço', address],
    ].filter(([, value]) => value !== undefined && value !== null && String(value).trim());

    return (
      <div
        className={`ixc-liquid-screen ${ixcDetailsModal.closing ? 'is-closing' : ''} absolute inset-x-0 bottom-0 top-[49px] z-30 flex min-h-0 flex-col overflow-hidden bg-white dark:bg-slate-900`}
        onAnimationEnd={(event) => {
          if (event.target !== event.currentTarget || !ixcDetailsModal.closing) return;
          setIxcDetailsModal({ open: false, chatId: '', closing: false });
        }}
      >
        <div className="relative z-10 flex min-h-0 w-full flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-white"><Database size={15} className="text-cyan-600" />Dados IXC</div>
              <div className="truncate text-[10px] text-slate-500 dark:text-slate-400">{details.fullName || selectedChatName} · últimas {orders.length} OS</div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button type="button" disabled={ixcOrdersRefreshing || ixcDetailsModal.closing} onClick={refreshIxcOrders} className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-cyan-200 bg-cyan-50 px-2 text-[9px] font-bold text-cyan-700 hover:bg-cyan-100 disabled:opacity-60 dark:border-cyan-900/50 dark:bg-cyan-950/30 dark:text-cyan-300"><RefreshCw size={12} className={ixcOrdersRefreshing ? 'animate-spin' : ''} />{ixcOrdersRefreshing ? 'Atualizando' : 'Atualizar OS'}</button>
              <button type="button" disabled={ixcDetailsModal.closing} onClick={closeIxcDetailsScreen} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:pointer-events-none dark:text-slate-300 dark:hover:bg-slate-800"><XIcon size={14} /></button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3 custom-scrollbar lg:p-4">
            <section className="grid overflow-hidden rounded-lg border border-slate-200 bg-white sm:grid-cols-2 lg:grid-cols-3 dark:border-slate-700 dark:bg-slate-900">
              {fields.map(([label, value]) => (
                <div key={label} className="border-b border-r border-slate-100 px-3 py-2 last:border-b-0 dark:border-slate-800">
                  <div className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
                  <div className="mt-0.5 break-words text-xs font-medium text-slate-700 dark:text-slate-200">{String(value)}</div>
                </div>
              ))}
            </section>
            {logins.length ? (
              <section className="mt-4">
                <div className="mb-2 text-xs font-bold text-slate-800 dark:text-slate-100">Contratos e acessos</div>
                <div className="grid gap-2 lg:grid-cols-2">
                  {logins.map((login, index) => (
                    <div key={`${login.loginId || 'login'}-${index}`} className={`rounded-lg border border-l-4 px-3 py-2.5 ${login.online ? 'border-emerald-200 border-l-emerald-500 bg-emerald-50/55 dark:border-emerald-900/50 dark:border-l-emerald-400 dark:bg-emerald-950/20' : 'border-slate-200 border-l-slate-400 bg-slate-50 dark:border-slate-700 dark:border-l-slate-500 dark:bg-slate-800/45'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate text-xs font-bold text-slate-900 dark:text-white">{login.pppoeUser || `Login ${login.loginId || '—'}`}</div>
                        <span className={`inline-flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase ${login.online ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-300'}`}><span className={`h-2 w-2 rounded-full ${login.online ? 'bg-emerald-500' : 'bg-slate-400'}`} />{login.online ? 'Online' : 'Offline'}</span>
                      </div>
                      <div className="mt-2 grid gap-x-3 gap-y-1 text-[10px] leading-4 text-slate-500 sm:grid-cols-2">
                        {login.plan ? <span><b>Plano:</b> {login.plan}</span> : null}
                        {login.contractId ? <span><b>Contrato:</b> {login.contractId}</span> : null}
                        {login.ipv4 ? <span><b>IPv4:</b> {login.ipv4}</span> : null}
                        {login.transmitter ? <span><b>Transmissor:</b> {login.transmitter}</span> : null}
                        {login.oltName ? <span><b>OLT:</b> {login.oltName} {login.oltBoard || login.oltPort ? `· ${login.oltBoard || '—'}/${login.oltPort || '—'}` : ''}</span> : null}
                        {login.onuSerial ? <span><b>ONU:</b> {login.onuSerial}</span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
            <section className="mt-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-100"><ClipboardList size={14} className="text-blue-600" />Ordens de serviço</div>
                <span className="text-[10px] font-bold text-blue-600 dark:text-blue-300">{orders.length}{allOrders.length > orders.length ? ` de ${allOrders.length}` : ''}</span>
              </div>
              {orders.length ? (
                <div className="space-y-2">
                  {orders.map((order, index) => (
                    <article key={`${order.osId || 'os'}-${index}`} className="rounded-lg border border-slate-200 px-3 py-2.5 dark:border-slate-700">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div><div className="text-xs font-bold text-slate-900 dark:text-white">OS #{order.osId || '—'} · {order.subject || 'Sem assunto'}</div><div className="mt-0.5 text-[10px] text-slate-500">{order.sector || 'Setor não informado'} · {order.openedAt || 'abertura não informada'}</div></div>
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[9px] font-bold uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300">{order.status || 'Sem status'}</span>
                      </div>
                      {order.message ? <p className="mt-2 whitespace-pre-wrap text-[11px] leading-4 text-slate-600 dark:text-slate-300">{order.message}</p> : null}
                      <div className="mt-2 grid gap-x-3 gap-y-1 text-[10px] text-slate-500 sm:grid-cols-2 lg:grid-cols-4">
                        {order.protocol ? <span><b>Protocolo:</b> {order.protocol}</span> : null}
                        {order.scheduledAt ? <span><b>Agendamento:</b> {order.scheduledAt}</span> : null}
                        {order.phone ? <span><b>Telefone:</b> {order.phone}</span> : null}
                        {order.city ? <span><b>Cidade:</b> {order.city}</span> : null}
                      </div>
                      {order.diagnosis ? <div className="mt-2 border-l-2 border-amber-400 bg-amber-50/70 px-2 py-1.5 text-[10px] text-amber-800 dark:bg-amber-950/25 dark:text-amber-200"><b>Diagnóstico:</b> {order.diagnosis}</div> : null}
                      <button type="button" onClick={() => openIxcOsOperation(order)} className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[10px] font-bold text-blue-700 transition hover:bg-blue-100 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-300"><ClipboardList size={12} />Usar esta OS</button>
                      {ixcOsOperation.open && String(ixcOsOperation.order?.osId) === String(order.osId) ? (
                        <div className="mt-3 overflow-hidden rounded-lg border border-blue-200 bg-blue-50/35 dark:border-blue-900/50 dark:bg-blue-950/15">
                          <div className="flex items-start justify-between gap-3 border-b border-blue-100 px-3 py-2.5 dark:border-blue-900/40">
                            <div><div className="text-xs font-bold text-slate-900 dark:text-white">Preparar encaminhamento da OS #{order.osId}</div><div className="mt-0.5 text-[9px] text-slate-500">Confira os dados capturados antes de continuar.</div></div>
                            <button type="button" disabled={ixcOsOperation.submitting} onClick={() => setIxcOsOperation((previous) => ({ ...previous, open: false }))} className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 hover:bg-white dark:hover:bg-slate-800"><XIcon size={13} /></button>
                          </div>
                          <div className="p-3">
                            <div className="mb-3 rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900">
                              <div className="mb-2 text-[9px] font-bold uppercase tracking-wider text-slate-400">Informações já obtidas</div>
                              <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2">
                                <div><div className="text-[8px] uppercase text-slate-400">Solicitante</div><div className="text-[10px] font-semibold text-slate-700 dark:text-slate-200">{details.fullName || selectedChatName || 'Não informado'}</div></div>
                                <div><div className="text-[8px] uppercase text-slate-400">CPF / CNPJ</div><div className="text-[10px] font-semibold text-slate-700 dark:text-slate-200">{details.cpf || chatVars?.cpf || 'Não informado'}</div></div>
                                <label className="sm:col-span-2"><span className="text-[8px] uppercase text-slate-400">Endereço</span><input value={ixcOsOperation.address} onChange={(event) => setIxcOsOperation((previous) => ({ ...previous, address: event.target.value }))} className="mt-0.5 w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[10px] text-slate-700 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200" /></label>
                                <label><span className="text-[8px] uppercase text-slate-400">Telefone</span><input value={ixcOsOperation.phone} onChange={(event) => setIxcOsOperation((previous) => ({ ...previous, phone: event.target.value }))} className="mt-0.5 w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[10px] text-slate-700 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200" /></label>
                                <label><span className="text-[8px] uppercase text-slate-400">Localização / referência</span><input value={ixcOsOperation.reference} onChange={(event) => setIxcOsOperation((previous) => ({ ...previous, reference: event.target.value }))} className="mt-0.5 w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[10px] text-slate-700 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200" /></label>
                              </div>
                            </div>
                            {details.ixcOperator?.configured ? (
                              <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-[10px] text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/25 dark:text-emerald-200"><span><b>Colaborador IXC:</b> {details.ixcOperator.techName || 'Identificado'}</span><b>#{details.ixcOperator.techId}</b></div>
                            ) : (
                              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[10px] leading-4 text-red-700 dark:border-red-900/50 dark:bg-red-950/25 dark:text-red-200"><b>Colaborador IXC não configurado.</b><br />Abra o IXC para identificação automática ou use a busca manual no popup da extensão. Depois atualize a consulta IXC deste cliente.</div>
                            )}
                            <div className="grid gap-3 sm:grid-cols-2">
                              <IxcCatalogSearch label="Diagnóstico" placeholder="Digite código ou diagnóstico..." options={IXC_OS_DIAGNOSES} query={ixcOsOperation.diagnosisQuery} selectedCode={ixcOsOperation.diagnosisId} onChange={(value) => setIxcOsOperation((previous) => ({ ...previous, diagnosisQuery: value, diagnosisId: '' }))} onSelect={(code, display) => setIxcOsOperation((previous) => ({ ...previous, diagnosisId: code, diagnosisQuery: display }))} />
                              <IxcCatalogSearch label="Próxima tarefa" placeholder="Digite código ou nome da tarefa..." options={IXC_OS_TASKS} query={ixcOsOperation.nextTaskQuery} selectedCode={ixcOsOperation.nextTaskCode} onChange={(value) => setIxcOsOperation((previous) => ({ ...previous, nextTaskQuery: value, nextTaskCode: '' }))} onSelect={(code, display) => setIxcOsOperation((previous) => ({ ...previous, nextTaskCode: code, nextTaskQuery: display }))} />
                              {!PRE_OS_TASK_CODES.has(ixcOsOperation.nextTaskCode) ? <label className="text-[9px] font-bold uppercase tracking-wide text-slate-500">Código do setor técnico<input value={ixcOsOperation.sectorCode} onChange={(event) => setIxcOsOperation((previous) => ({ ...previous, sectorCode: event.target.value.replace(/\D/g, '') }))} inputMode="numeric" placeholder="Ex: 63" className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-2 text-[10px] text-slate-800 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white" /></label> : null}
                              <div className={`text-[9px] font-bold uppercase tracking-wide text-slate-500 ${PRE_OS_TASK_CODES.has(ixcOsOperation.nextTaskCode) ? 'sm:col-span-2' : ''}`}>
                                Período
                                <div className="mt-1 flex min-h-8 items-center gap-3 rounded-md border border-slate-200 bg-white px-2.5 dark:border-slate-700 dark:bg-slate-800">
                                  <label className="flex items-center gap-1.5 text-[10px] font-semibold normal-case text-slate-700 dark:text-slate-200"><input type="radio" checked={ixcOsOperation.visitPeriod === 'MANHA'} onChange={() => setIxcVisitPeriod('MANHA')} />Manhã</label>
                                  <label className="flex items-center gap-1.5 text-[10px] font-semibold normal-case text-slate-700 dark:text-slate-200"><input type="radio" checked={ixcOsOperation.visitPeriod === 'TARDE'} onChange={() => setIxcVisitPeriod('TARDE')} />Tarde</label>
                                </div>
                              </div>
                              {!PRE_OS_TASK_CODES.has(ixcOsOperation.nextTaskCode) ? <label className="text-[9px] font-bold uppercase tracking-wide text-slate-500">Data da visita<input type="datetime-local" value={ixcOsOperation.visitDate} onChange={(event) => setIxcOsOperation((previous) => ({ ...previous, visitDate: event.target.value }))} className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-2 text-[10px] text-slate-800 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white" /></label> : null}
                              <label className={`text-[9px] font-bold uppercase tracking-wide text-slate-500 ${PRE_OS_TASK_CODES.has(ixcOsOperation.nextTaskCode) ? 'sm:col-span-2' : ''}`}>Observação de horário<input value={ixcOsOperation.periodNote} onChange={(event) => setIxcOsOperation((previous) => ({ ...previous, periodNote: event.target.value }))} placeholder="Ex: a partir das 09h" className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-2 text-[10px] text-slate-800 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white" /></label>
                              <label className="text-[9px] font-bold uppercase tracking-wide text-slate-500 sm:col-span-2">Descrição do problema<textarea rows={3} value={ixcOsOperation.description} onChange={(event) => setIxcOsOperation((previous) => ({ ...previous, description: event.target.value }))} className="mt-1 w-full resize-none rounded-md border border-slate-200 bg-white px-2.5 py-2 text-[10px] text-slate-800 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white" /></label>
                            </div>
                            <div className="mt-3">
                              <div className="mb-1.5 flex items-center justify-between"><span className="text-[9px] font-bold uppercase tracking-wide text-slate-500">Anexos da conversa</span><span className="text-[9px] font-bold text-blue-600">{Object.keys(ixcOsOperation.selectedMedia || {}).length} selecionado(s)</span></div>
                              {chatMediaItems.some((media) => media.messageId) ? (
                                <div className="grid gap-2 sm:grid-cols-2">
                                  {chatMediaItems.filter((media) => media.messageId).map((media) => {
                                    const selectedMedia = ixcOsOperation.selectedMedia?.[media.messageId];
                                    return (
                                      <div key={media.messageId} className={`rounded-lg border p-2 ${selectedMedia ? 'border-blue-400 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/30' : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'}`}>
                                        <label className="flex cursor-pointer grid-cols-none items-center gap-2">
                                          <input type="checkbox" className="h-3.5 w-3.5 shrink-0" checked={Boolean(selectedMedia)} onChange={(event) => setIxcOsOperation((previous) => {
                                            const selected = { ...(previous.selectedMedia || {}) };
                                            if (event.target.checked) selected[media.messageId] = { messageId: media.messageId, fileName: media.fileName || 'Anexo', description: media.fileName || '' };
                                            else delete selected[media.messageId];
                                            return { ...previous, selectedMedia: selected };
                                          })} />
                                          {media.type === 'image' ? <img src={media.resolvedUrl || resolveMediaUrl(media.url)} alt="" className="h-9 w-9 shrink-0 rounded object-cover" /> : <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-slate-100 text-slate-500 dark:bg-slate-800">{media.type === 'audio' ? <AudioLines size={16} /> : media.type === 'video' ? <Video size={16} /> : <FileText size={16} />}</span>}
                                          <span className="min-w-0"><span className="block truncate text-[10px] font-semibold text-slate-700 dark:text-slate-200">{media.fileName || (media.type === 'audio' ? 'Áudio' : media.type === 'image' ? 'Imagem' : 'Anexo')}</span><span className="block text-[8px] uppercase text-slate-400">{media.type || 'arquivo'}</span></span>
                                        </label>
                                        {selectedMedia ? <input value={selectedMedia.description} onChange={(event) => setIxcOsOperation((previous) => ({ ...previous, selectedMedia: { ...previous.selectedMedia, [media.messageId]: { ...previous.selectedMedia[media.messageId], description: event.target.value } } }))} placeholder="Descrição do anexo" className="mt-2 w-full rounded-md border border-blue-200 bg-white px-2 py-1.5 text-[9px] text-slate-700 outline-none dark:border-blue-900/60 dark:bg-slate-800 dark:text-slate-200" /> : null}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : <div className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-[9px] text-slate-400 dark:border-slate-700">Nenhuma mídia disponível nesta conversa.</div>}
                            </div>
                            <div className="mt-3 flex gap-2"><button type="button" disabled={ixcOsOperation.submitting} onClick={() => setIxcOsOperation((previous) => ({ ...previous, open: false }))} className="flex-1 rounded-md border border-slate-200 px-3 py-2 text-[10px] font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300">Cancelar</button><button type="button" disabled={ixcOsOperation.submitting} onClick={submitIxcOsOperation} className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-60">{ixcOsOperation.submitting ? <Loader2 size={13} className="animate-spin" /> : <ClipboardList size={13} />}{PRE_OS_TASK_CODES.has(ixcOsOperation.nextTaskCode) ? 'Gerar Pré-OS' : 'Finalizar e encaminhar'}</button></div>
                          </div>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : <div className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-xs text-slate-400 dark:border-slate-700">Nenhuma ordem de serviço retornada para este cliente.</div>}
            </section>
          </div>
        </div>
      </div>
    );
  };

  const renderInfoPanel = () => {
    // Infos: nome/CPF/endereço resolvidos no IXC (vars) — não o nome do card
    const nomeIxc = chatVars?.nome_cliente
      || selectedChat?.variables?.nome_cliente
      || selectedChat?.vars?.nome_cliente
      || '';
    const cpfInfo = chatVars?.cpf
      || selectedChat?.variables?.cpf
      || selectedChat?.vars?.cpf
      || resolvedCustomerDocument(selectedChat)
      || '';
    const enderecoInfo = chatVars?.endereco
      || selectedChat?.variables?.endereco
      || selectedChat?.vars?.endereco
      || '';
    const telefone = chatVars?.telefone || selectedChat?.customerPhone || customerWhatsAppValue || '';
    const filial = chatVars?.filial || selectedChat?.vars?.filial || selectedChat?.variables?.filial || '';
    const ativo = chatVars?.ativo || selectedChat?.vars?.ativo || selectedChat?.variables?.ativo || '';
    const canal = selectedChat?.channel || 'web';
    const isGenesysChatSelected = String(selectedChat?.channel || '').toLowerCase() === 'genesys'
      || Boolean(selectedChat?.genesysConvId)
      || selectedChat?.externalSource === 'genesys';
    const hasIxcData = Boolean(nomeIxc || cpfInfo || enderecoInfo);

    return (
      <div className="space-y-5">
        {/* Cabeçalho limpo */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">
              Cliente
            </div>
            <div className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
              Dados do cadastro · clique para copiar
            </div>
          </div>
          {isGenesysChatSelected ? (
            <button
              type="button"
              disabled={ixcSearching}
              onClick={handleBuscarIxc}
              className="shrink-0 text-[12px] font-medium text-blue-600 transition-colors hover:text-blue-700 disabled:opacity-50 dark:text-blue-400 dark:hover:text-blue-300"
              title="Consulta IXC/ZAAZ sob demanda"
            >
              {ixcSearching ? 'Buscando…' : (hasIxcData ? 'Atualizar IXC' : 'Buscar IXC')}
            </button>
          ) : null}
        </div>

        {!hasIxcData && isGenesysChatSelected ? (
          <p className="text-[12px] leading-relaxed text-slate-400 dark:text-slate-500">
            Ainda sem dados do IXC. Use <span className="font-medium text-slate-500 dark:text-slate-400">Buscar IXC</span>
            {' '}com a extensão online.
          </p>
        ) : null}

        {/* Identidade */}
        <section>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400 dark:text-slate-500">
            Identidade
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            <InfoField label="Nome" value={nomeIxc || undefined} />
            <InfoField label="CPF / CNPJ" value={cpfInfo || undefined} mono />
            {ativo ? <InfoField label="Situação" value={ativo} /> : null}
          </div>
        </section>

        {/* Contato */}
        <section>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400 dark:text-slate-500">
            Contato
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            <InfoField label="Telefone" value={telefone || undefined} mono />
            {customerWhatsAppValue && customerWhatsAppValue !== telefone ? (
              <InfoField label={customerWhatsAppLabel || 'WhatsApp'} value={customerWhatsAppValue} mono />
            ) : null}
            <InfoField label="Endereço" value={enderecoInfo || undefined} />
          </div>
        </section>

        {/* Atendimento */}
        <section>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400 dark:text-slate-500">
            Atendimento
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            <InfoField label="Canal" value={canal} />
            {filial ? <InfoField label="Filial" value={filial} /> : null}
          </div>
        </section>
      </div>
    );
  };

  const renderQuickRepliesPanel = () => (
    <div className="border-t border-slate-100 pt-5 dark:border-slate-800">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">
            Mensagens rápidas
          </div>
          <div className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
            Clique para enviar
          </div>
        </div>
        <button
          type="button"
          onClick={() => setQuickEditor({ open: true, id: null, name: '', text: '', saving: false })}
          className="text-[12px] font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
        >
          Nova
        </button>
      </div>
      {quickReplies.length === 0 ? (
        <p className="text-[12px] text-slate-400 dark:text-slate-500">
          Nenhuma mensagem salva.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800/80">
          {quickReplies.map((tpl) => {
            const canEdit = tpl.createdBy === user?.id || ['ADMIN', 'SUPER_ADMIN'].includes(user?.role);
            return (
              <li key={tpl.id} className="group flex items-start gap-1 py-2.5 first:pt-0">
                <button
                  type="button"
                  onClick={() => handleQuickSelect(tpl)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="truncate text-[13px] font-medium text-slate-800 group-hover:text-blue-600 dark:text-slate-100 dark:group-hover:text-blue-400">
                    {tpl.name}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                    {tpl.text}
                  </div>
                </button>
                {canEdit ? (
                  <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      title="Editar"
                      onClick={() => setQuickEditor({
                        open: true,
                        id: tpl.id,
                        name: tpl.name || '',
                        text: tpl.text || '',
                        saving: false
                      })}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      title="Apagar"
                      onClick={() => handleDeleteQuickReply(tpl)}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  // Header do chat = nome WhatsApp/conversa (igual ao card) — nunca IXC
  const selectedIxcName = String(chatVars?.nome_cliente || '').trim();
  const selectedChannelName = String(selectedChat?.customerName || '').trim();
  const selectedChatName = (
    (selectedChannelName && selectedChannelName !== selectedIxcName ? selectedChannelName : '')
    || (() => {
      const contact = resolveContactNameForChat(selectedChat);
      return contact && String(contact).trim() !== selectedIxcName ? contact : '';
    })()
    || getChatWaId(selectedChat)
    || 'Visitante'
  );
  const selectedChatCpf = (visibleVars.length === 0 || visibleVars.includes('cpf'))
    ? (
      selectedChat?.variables?.cpf
      || selectedChat?.vars?.cpf
      || resolvedCustomerDocument(selectedChat)
      || null
    )
    : null;
  const selectedHeaderIxc = selectedChat?.ixcData || chatVars?.ixc_dados || null;
  const selectedHeaderLogins = activeIxcLogins(selectedHeaderIxc);
  const routerIxcReady = Boolean(selectedHeaderIxc && Array.isArray(selectedHeaderIxc?.logins));
  const routerHasOnlineLogin = selectedHeaderLogins.some((login) => login?.online === true);
  const routerBlockedTitle = !routerIxcReady
    ? 'Busque os dados do IXC antes de testar o roteador'
    : !routerHasOnlineLogin
      ? 'Todos os logins do IXC estão offline'
      : '';
  const selectedHeaderLogin = selectedHeaderLogins.find((login) => login?.online)
    || selectedHeaderLogins.find((login) => login?.active)
    || selectedHeaderLogins[0]
    || null;
  const selectedHeaderOnline = selectedHeaderLogin?.online === true;
  const selectedHeaderAccessTone = !selectedHeaderIxc
    ? 'unknown'
    : selectedHeaderOnline
      ? 'online'
      : 'offline';
  const selectedHeaderAddress = [
    selectedHeaderIxc?.street,
    selectedHeaderIxc?.houseNumber,
    selectedHeaderIxc?.neighborhood,
  ].filter(Boolean).join(', ');
  const selectedHeaderCity = [selectedHeaderIxc?.city, selectedHeaderIxc?.state].filter(Boolean).join(' / ');
  const selectedHeaderPppoe = String(
    selectedHeaderLogin?.pppoeUser
    || selectedHeaderLogin?.login
    || selectedHeaderLogin?.username
    || ''
  ).trim();
  const selectedHeaderIp = String(
    selectedHeaderLogin?.ipv4
    || selectedHeaderLogin?.ip
    || selectedHeaderLogin?.ipAddress
    || ''
  ).trim();
  const genesysSyncConfirmed = Boolean(
    selectedChat?.genesysSync?.lastSnapshotId
    && selectedChat?.genesysSync?.acknowledgedAt
  );
  const copyHeaderValue = async (label, value) => {
    const text = String(value || '').trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copiado`);
    } catch {
      toast.error(`Não foi possível copiar ${label.toLowerCase()}`);
    }
  };
  const rootOnlyVarMap = Object.fromEntries(
    rootVars
      .map((variable) => [
        variable.name,
        resolveVarValue(variable.name) ?? variable.defaultValue ?? ''
      ])
      .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
  );
  const visibleChatVars = selectedChat?.status === 'open' ? filterVars(rootOnlyVarMap) : [];
  const showListPanel = !isMobileView || !showMobileChat;
  const showChatPanel = !isMobileView || showMobileChat;
  const chatHasBackgroundImage = (
    chatAppearance.backgroundMode === 'image'
    && Boolean(chatAppearance.backgroundImage)
  );

  return (
    <div
      className="agent-workspace relative flex h-full w-full min-h-0 overflow-hidden bg-slate-100 dark:bg-slate-950"
      data-chat-background-mode={chatAppearance.backgroundMode}
      data-chat-bubble-theme={chatAppearance.customBubbles ? 'custom' : 'default'}
      data-chat-bubble-border={chatAppearance.bubbleBorderEnabled ? 'enabled' : 'disabled'}
      style={{
        '--chat-background-color': chatAppearance.backgroundColor,
        '--chat-background-image': chatHasBackgroundImage ? `url("${chatAppearance.backgroundImage}")` : 'none',
        '--chat-background-dim': Number(chatAppearance.backgroundDim || 0) / 100,
        '--agent-bubble-color': chatAppearance.agentBubbleColor,
        '--agent-text-color': chatAppearance.agentTextColor,
        '--customer-bubble-color': chatAppearance.customerBubbleColor,
        '--customer-text-color': chatAppearance.customerTextColor,
        '--customer-name-color': chatAppearance.customerNameColor,
        '--bubble-border-color': chatAppearance.bubbleBorderColor,
        '--chat-ambient-glow-strength': Number(chatAppearance.ambientGlowStrength || 0),
        '--chat-ambient-glow-top': `${Math.min(40, Number(chatAppearance.ambientGlowStrength || 0) * 0.14)}%`,
        '--chat-ambient-glow-bottom': `${Math.min(32, Number(chatAppearance.ambientGlowStrength || 0) * 0.1)}%`,
        '--chat-ambient-glow-color': chatAppearance.ambientGlowColor,
        '--theme-accent-color': chatAppearance.themeAccentColor,
      }}
    >
      <input
        ref={mediaInputRef}
        type="file"
        className="hidden"
        accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar"
        onChange={handleMediaFileSelected}
      />

      {showListPanel ? (
      <aside className={`w-full lg:w-[300px] lg:min-w-[300px] bg-slate-50 dark:bg-slate-900 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 flex flex-col z-10 lg:max-h-none ${isMobileView ? 'ui-mobile-list-enter' : ''}`}>
        <div className="border-b border-slate-200 bg-white/90 px-2.5 py-1.5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-slate-900 dark:text-white">{user.name}</div>
              <div className="text-[9px] font-medium text-slate-400">
                {myChats.length} ativo{myChats.length === 1 ? '' : 's'}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                title="Limpar clientes Genesys somente do Onion"
                aria-label="Limpar clientes Genesys do Onion"
                onClick={handleFlushGenesysLocal}
                disabled={genesysFlushLoading || ![...myChats, ...waitingChats].some(isGenesysChatClient)}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-500 shadow-sm transition-colors hover:bg-red-100 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-35 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/60"
              >
                {genesysFlushLoading ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              </button>
              <button
                type="button"
                title="Nome e aparência"
                onClick={openAppearanceSettings}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                <Settings size={12} />
              </button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
          {activeCalls.length > 0 ? (
            <div
              className="mx-1.5 mt-1.5 mb-1 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-900/25 dark:text-emerald-200"
              title="Card de ligação no Genesys sem mensagens de chat — não entra na lista de conversas"
            >
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              <PhoneCall size={14} className="shrink-0 opacity-90" />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-bold leading-tight">
                  Ligação ativa no momento
                  {activeCalls.length > 1 ? ` (${activeCalls.length})` : ''}
                </div>
                <div className="truncate text-[9px] font-medium opacity-80">
                  Não listada no chat · só enquanto o card existir no Genesys
                </div>
              </div>
            </div>
          ) : null}
          <section>
              {!isMobileView ? <div className="sticky top-0 z-10 border-b border-blue-100 bg-blue-50/95 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide text-blue-700 backdrop-blur dark:border-blue-900/30 dark:bg-blue-900/20 dark:text-blue-300">Em atendimento</div> : null}
              {myChats.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-slate-400">
                  {activeCalls.length > 0 ? 'Só ligação ativa — sem chats de mensagem.' : 'Nenhum atendimento ativo agora.'}
                </div>
              ) : (
                <Reorder.Group
                  as="div"
                  axis="y"
                  layoutScroll
                  values={myChats.map((chat) => String(chat.id))}
                  onReorder={(nextIds) => handleChatListReorderByIds('active', nextIds, myChats)}
                  className="agent-chat-reorder-group flex flex-col"
                >
                  {myChats.map((chat) => renderChatListItem(chat, 'active'))}
                </Reorder.Group>
              )}
            </section>

          {false ? (
            <section>
              {!isMobileView ? (
                <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-y border-orange-100 bg-orange-50/95 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-orange-700 backdrop-blur dark:border-orange-900/30 dark:bg-orange-900/20 dark:text-orange-300">
                  <span>Fila de espera</span>
                  {waitingChats.length > 0 ? (
                    <button
                      type="button"
                      onClick={openBulkPickupModal}
                      className="inline-flex items-center gap-1 rounded-full bg-orange-500 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white shadow-sm transition-colors hover:bg-orange-600"
                    >
                      <Play size={10} fill="currentColor" />
                      Puxar todos
                    </button>
                  ) : null}
                </div>
              ) : waitingChats.length > 0 ? (
                <div className="px-2 pt-2">
                  <button
                    type="button"
                    onClick={openBulkPickupModal}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-orange-500 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-white shadow-sm transition-colors hover:bg-orange-600"
                  >
                    <Play size={12} fill="currentColor" />
                    Puxar todos em espera
                  </button>
                </div>
              ) : null}
              {waitingChats.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-slate-400">Fila vazia.</div>
              ) : (
                <Reorder.Group
                  as="div"
                  axis="y"
                  layoutScroll
                  values={waitingChats.map((chat) => String(chat.id))}
                  onReorder={(nextIds) => handleChatListReorderByIds('waiting', nextIds, waitingChats)}
                  className="agent-chat-reorder-group flex flex-col"
                >
                  {waitingChats.map((chat) => renderChatListItem(chat, 'waiting'))}
                </Reorder.Group>
              )}
            </section>
          ) : null}
        </div>
      </aside>
      ) : null}

      {showChatPanel ? (
      <main className={`flex-1 flex flex-col bg-slate-100 dark:bg-slate-950 relative min-w-0 ${isMobileView ? 'ui-mobile-chat-enter' : ''}`}>
        {selectedChat ? (
          <>
            <header className="z-10 border-b border-slate-200 bg-white/90 px-2.5 py-2 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 lg:px-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  {isMobileView ? <button type="button" onClick={() => setShowMobileChat(false)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"><ArrowLeft size={16} /></button> : null}
                  <div ref={customerAccessPopoverRef} className="relative shrink-0">
                    <button
                      type="button"
                      onClick={() => setCustomerAccessPopoverOpen((open) => !open)}
                      className={`relative flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
                        customerAccessPopoverOpen
                          ? 'border-blue-300 bg-blue-100 text-blue-700 ring-2 ring-blue-100 dark:border-blue-700 dark:bg-blue-900/40 dark:text-blue-200 dark:ring-blue-950'
                          : 'border-transparent bg-blue-100 text-blue-600 hover:border-blue-200 hover:bg-blue-50 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:border-blue-800 dark:hover:bg-blue-950/50'
                      }`}
                      title="Ver acesso e dados técnicos do cliente"
                      aria-label="Ver acesso e dados técnicos do cliente"
                      aria-expanded={customerAccessPopoverOpen}
                    >
                      <User size={16} />
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white dark:border-slate-900 ${
                          selectedHeaderAccessTone === 'online'
                            ? 'bg-emerald-500'
                            : selectedHeaderAccessTone === 'offline'
                              ? 'bg-red-500'
                              : ixcSearching
                                ? 'animate-pulse bg-amber-400'
                                : 'bg-slate-400'
                        }`}
                      />
                    </button>

                    {customerAccessPopoverOpen ? (
                      <div className="absolute left-0 top-10 z-[90] w-[min(300px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-slate-200 bg-white/98 shadow-[0_18px_50px_rgba(15,23,42,0.22)] backdrop-blur-xl dark:border-slate-700 dark:bg-slate-900/98">
                        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2.5 dark:border-slate-800">
                          <div className="min-w-0">
                            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Acesso do cliente</div>
                            <div className="mt-0.5 truncate text-xs font-semibold text-slate-800 dark:text-slate-100">{selectedChatName}</div>
                          </div>
                          <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[9px] font-bold uppercase ${
                            selectedHeaderAccessTone === 'online'
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                              : selectedHeaderAccessTone === 'offline'
                                ? 'bg-red-50 text-red-600 dark:bg-red-950/35 dark:text-red-300'
                                : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300'
                          }`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${
                              selectedHeaderAccessTone === 'online'
                                ? 'bg-emerald-500'
                                : selectedHeaderAccessTone === 'offline'
                                  ? 'bg-red-500'
                                  : 'bg-slate-400'
                            }`} />
                            {selectedHeaderAccessTone === 'online' ? 'Online' : selectedHeaderAccessTone === 'offline' ? 'Offline' : 'Não consultado'}
                          </span>
                        </div>

                        {selectedHeaderIxc ? (
                          <>
                            <div className="max-h-48 space-y-1.5 overflow-y-auto p-2 custom-scrollbar">
                              {selectedHeaderLogins.length ? selectedHeaderLogins.map((login, index) => {
                                const loginName = String(login?.pppoeUser || login?.login || login?.username || `Login ${index + 1}`).trim();
                                const loginIp = String(login?.ipv4 || login?.ip || login?.ipAddress || '').trim();
                                const loginOlt = String(login?.oltName || '').trim();
                                const loginPon = String(login?.ponId || [login?.oltBoard, login?.oltPort].filter(Boolean).join('/') || '').trim();
                                const loginStreet = [login?.street, login?.houseNumber].filter(Boolean).join(', ');
                                const loginAddress = [
                                  loginStreet,
                                  login?.neighborhood,
                                  login?.city,
                                  login?.state,
                                  login?.zipCode,
                                  login?.complement,
                                ].filter((value) => String(value || '').trim()).join(' · ');
                                const loginOnline = login?.online === true;
                                return (
                                  <div key={`${login?.loginId || loginName}-${index}`} className="rounded-xl border border-slate-100 bg-slate-50/80 px-2.5 py-2 dark:border-slate-800 dark:bg-slate-800/55">
                                    <div className="flex items-center gap-2">
                                      <span className={`h-2 w-2 shrink-0 rounded-full ${loginOnline ? 'bg-emerald-500' : 'bg-red-400'}`} />
                                      <button type="button" onClick={() => copyHeaderValue('Login PPPoE', loginName)} className="min-w-0 flex-1 truncate text-left font-mono text-[11px] font-bold text-slate-800 hover:text-blue-600 dark:text-slate-100 dark:hover:text-blue-300" title="Clique para copiar o login">{loginName}</button>
                                      <span className={`shrink-0 text-[8px] font-bold uppercase ${loginOnline ? 'text-emerald-600 dark:text-emerald-300' : 'text-red-500 dark:text-red-300'}`}>{loginOnline ? 'Online' : 'Offline'}</span>
                                    </div>
                                    <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                                      <button type="button" disabled={!loginIp} onClick={() => copyHeaderValue('IP', loginIp)} className="truncate rounded-lg bg-white px-2 py-1 text-left font-mono text-[9px] text-slate-600 shadow-sm disabled:text-slate-300 dark:bg-slate-900 dark:text-slate-300 dark:disabled:text-slate-600" title={loginIp ? 'Clique para copiar o IP' : 'IP não informado'}><span className="font-sans font-bold text-slate-400">IP </span>{loginIp || '—'}</button>
                                      <button type="button" disabled={!loginOlt && !loginPon} onClick={() => copyHeaderValue('OLT/PON', [loginOlt, loginPon].filter(Boolean).join(' · '))} className="truncate rounded-lg bg-white px-2 py-1 text-left font-mono text-[9px] text-slate-600 shadow-sm disabled:text-slate-300 dark:bg-slate-900 dark:text-slate-300 dark:disabled:text-slate-600" title="Clique para copiar OLT e PON"><span className="font-sans font-bold text-slate-400">OLT </span>{loginOlt || '—'}{loginPon ? ` · ${loginPon}` : ''}</button>
                                    </div>
                                    <button type="button" disabled={!loginAddress} onClick={() => copyHeaderValue('Endereço do login', loginAddress)} className="mt-1.5 block w-full rounded-lg bg-white px-2 py-1.5 text-left text-[9px] leading-4 text-slate-600 shadow-sm transition-colors hover:text-blue-600 disabled:cursor-default disabled:text-slate-300 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-blue-300 dark:disabled:text-slate-600" title={loginAddress ? 'Clique para copiar o endereço deste login' : 'Endereço não informado neste login'}>
                                      <span className="font-bold text-slate-400">Endereço </span>{loginAddress || 'Não informado'}
                                    </button>
                                  </div>
                                );
                              }) : (
                                <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-[10px] text-slate-400 dark:border-slate-700">Nenhum login retornado pelo IXC.</div>
                              )}
                            </div>

                            {(selectedHeaderAddress || selectedHeaderCity) ? (
                              <button
                                type="button"
                                onClick={() => copyHeaderValue('Endereço', [selectedHeaderAddress, selectedHeaderCity].filter(Boolean).join(' · '))}
                                className="mx-2 mb-2 block w-[calc(100%-16px)] rounded-xl border border-slate-100 px-2.5 py-2 text-left text-[9px] leading-4 text-slate-500 hover:border-blue-100 hover:bg-blue-50/50 hover:text-blue-700 dark:border-slate-800 dark:text-slate-400 dark:hover:border-blue-900 dark:hover:bg-blue-950/20 dark:hover:text-blue-300"
                                title="Clique para copiar o endereço"
                              >
                                <span className="font-bold text-slate-700 dark:text-slate-200">Endereço do cadastro </span>
                                {[selectedHeaderAddress, selectedHeaderCity].filter(Boolean).join(' · ')}
                              </button>
                            ) : null}

                            <div className="flex items-center gap-1.5 border-t border-slate-100 p-2 dark:border-slate-800">
                              <button type="button" onClick={() => { setCustomerAccessPopoverOpen(false); handleBuscarIxc(); }} className="flex-1 rounded-lg bg-slate-900 px-2.5 py-2 text-[9px] font-bold text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200">Ver dados IXC</button>
                              {selectedHeaderIxc?.clientId ? (
                                <button type="button" onClick={refreshIxcLogins} disabled={ixcLoginsRefreshing} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800" title="Atualizar IP e estado dos logins" aria-label="Atualizar IP e estado dos logins">
                                  {ixcLoginsRefreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                                </button>
                              ) : null}
                            </div>
                          </>
                        ) : (
                          <div className="p-3">
                            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center dark:border-slate-700 dark:bg-slate-800/50">
                              <Database size={18} className="mx-auto text-slate-400" />
                              <div className="mt-2 text-[11px] font-semibold text-slate-700 dark:text-slate-200">Dados IXC ainda não consultados</div>
                              <div className="mt-1 text-[9px] leading-4 text-slate-400">A consulta será feita uma vez e ficará em cache até o cliente sair.</div>
                              <button type="button" onClick={() => { setCustomerAccessPopoverOpen(false); handleBuscarIxc(); }} disabled={ixcSearching} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-[9px] font-bold text-white hover:bg-blue-700 disabled:opacity-60">
                                {ixcSearching ? <Loader2 size={11} className="animate-spin" /> : <Database size={11} />}
                                Buscar agora
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <button type="button" onClick={() => copyHeaderValue('Nome', selectedChatName)} title="Clique para copiar o nome" className="block max-w-full truncate text-left text-xs font-semibold text-slate-900 hover:text-blue-600 dark:text-white dark:hover:text-blue-300">{selectedChatName}</button>
                      {isGenesysChatClient(selectedChat) ? (
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${genesysSyncConfirmed ? 'bg-emerald-500' : 'animate-pulse bg-amber-400'}`}
                          title={genesysSyncConfirmed ? 'Conversa confirmada pelo contrato de sincronização' : 'Conversa ainda convergindo com o Genesys'}
                        />
                      ) : null}
                    </div>
                    {selectedHeaderIxc ? (
                      <button
                        type="button"
                        onClick={() => setCustomerAccessPopoverOpen(true)}
                        className="mt-0.5 flex max-w-full items-center gap-1.5 truncate text-left text-[9px] text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-300"
                        title="Clique para ver todos os dados de acesso"
                      >
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${selectedHeaderOnline ? 'bg-emerald-500' : 'bg-red-500'}`} />
                        <span className={`shrink-0 font-bold ${selectedHeaderOnline ? 'text-emerald-600 dark:text-emerald-300' : 'text-red-500 dark:text-red-300'}`}>{selectedHeaderOnline ? 'Online' : 'Offline'}</span>
                        {selectedHeaderPppoe ? <span className="truncate font-mono">{selectedHeaderPppoe}</span> : null}
                        {selectedHeaderIp ? <><span className="shrink-0 text-slate-300 dark:text-slate-600">·</span><span className="shrink-0 font-mono">{selectedHeaderIp}</span></> : null}
                        {selectedHeaderLogins.length > 1 ? <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-px text-[8px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-300">+{selectedHeaderLogins.length - 1}</span> : null}
                      </button>
                    ) : (
                      <button type="button" onClick={() => setCustomerAccessPopoverOpen(true)} className="mt-0.5 text-[9px] text-slate-400 hover:text-blue-600 dark:hover:text-blue-300">IXC não consultado · clique no cliente</button>
                    )}
                  </div>
                </div>
                <div className="relative flex shrink-0 items-center gap-1.5">
                  {selectedChat.status === 'waiting' ? (
                    <button
                      type="button"
                      onClick={() => handlePickup(selectedChat)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm transition-colors hover:bg-orange-600"
                    >
                      <Play size={12} fill="currentColor" />
                      {isMobileView ? 'Puxar' : 'Puxar atendimento'}
                    </button>
                  ) : (
                    <>
                      {isMobileView ? (
                        <button
                          type="button"
                          onClick={() => { setMobilePanelTab('quick'); setMobilePanelOpen(true); }}
                          className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                        >
                          <MessageSquareText size={15} />
                        </button>
                      ) : null}
                      {isMobileView ? (
                        <button
                          type="button"
                          onClick={() => { setMobilePanelTab('info'); setMobilePanelOpen(true); }}
                          className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                        >
                          <Info size={15} />
                        </button>
                      ) : null}
                      {isGenesysChatClient(selectedChat) ? (
                        <button
                          type="button"
                          onClick={handleReloadGenesysConversation}
                          disabled={conversationReloading}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-600 transition-colors hover:bg-blue-100 disabled:cursor-wait disabled:opacity-60 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-300"
                          title="Recarregar toda a conversa do Genesys"
                          aria-label="Recarregar toda a conversa do Genesys"
                        >
                          <RefreshCw size={14} className={conversationReloading ? 'animate-spin' : ''} />
                        </button>
                      ) : null}
                      {isGenesysChatClient(selectedChat) ? (
                        <button
                          type="button"
                          onClick={handleRouterButton}
                          disabled={!routerIxcReady || !routerHasOnlineLogin || (routerProbe.chatId === selectedChat.id && routerProbe.status === 'testing')}
                          className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                            routerProbe.chatId === selectedChat.id && routerProbe.status === 'online'
                              ? 'border-emerald-300 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                              : routerProbe.chatId === selectedChat.id && routerProbe.status === 'offline'
                                ? 'border-red-300 bg-red-50 text-red-600 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300'
                                : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                          }`}
                          title={routerBlockedTitle || (routerProbe.chatId === selectedChat.id && routerProbe.status === 'online' ? `Abrir ${routerProbe.url}` : 'Testar acesso ao roteador')}
                          aria-label="Testar ou abrir roteador"
                        >
                          {routerProbe.chatId === selectedChat.id && routerProbe.status === 'testing' ? <Loader2 size={14} className="animate-spin" /> : <Router size={14} />}
                        </button>
                      ) : null}
                      {isGenesysChatClient(selectedChat) ? (
                        <button
                          type="button"
                          onClick={handleBuscarIxc}
                          disabled={ixcSearching}
                          className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors disabled:cursor-wait disabled:opacity-60 ${
                            (selectedChat?.ixcData || chatVars?.ixc_dados)
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300'
                              : 'border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-100 dark:border-cyan-900/50 dark:bg-cyan-950/30 dark:text-cyan-300'
                          }`}
                          title={(selectedChat?.ixcData || chatVars?.ixc_dados) ? 'Abrir dados e ordens de serviço do IXC' : 'Buscar cliente no IXC'}
                          aria-label={(selectedChat?.ixcData || chatVars?.ixc_dados) ? 'Abrir dados do IXC' : 'Buscar cliente no IXC'}
                        >
                          {ixcSearching ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
                        </button>
                      ) : null}
                      {routerProbe.pickerOpen && routerProbe.chatId === selectedChat.id ? (
                        <div className="absolute right-0 top-10 z-50 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
                          <div className="border-b border-slate-100 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:border-slate-800">Escolha o acesso</div>
                          <div className="max-h-56 overflow-y-auto p-1.5 custom-scrollbar">
                            {getRouterTargets().map((target) => (
                              <button key={target.ip} type="button" onClick={() => testRouterTarget(target)} className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800">
                                <Router size={14} className="mt-0.5 shrink-0 text-slate-400" />
                                <span className="min-w-0">
                                  <span className="block font-mono text-xs font-bold text-slate-800 dark:text-slate-100">{target.ip}</span>
                                  <span className="mt-0.5 block truncate text-[10px] text-slate-500">{target.address}</span>
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {isGenesysChatClient(selectedChat) ? (
                        <button
                          type="button"
                          onClick={() => setIsAiPanelOpen(true)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-violet-200 bg-violet-50 text-violet-700 transition-colors hover:bg-violet-100 dark:border-violet-900/50 dark:bg-violet-950/30 dark:text-violet-300"
                          title="Abrir assistente IA"
                          aria-label="Abrir assistente IA"
                        >
                          <OnionAiIcon size={16} />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={openTransferModal}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-600 transition-colors hover:bg-blue-100 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-300"
                        title="Transferir atendimento"
                        aria-label="Transferir atendimento"
                      >
                        <ArrowRightLeft size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={handleClose}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-600 transition-colors hover:bg-red-100 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300"
                        title="Encerrar atendimento"
                        aria-label="Encerrar atendimento"
                      >
                        <XCircle size={14} />
                      </button>
                    </>
                  )}
                  {wrapupPanel.open ? (
                    <div className="absolute right-0 top-10 z-[70] w-[min(420px,calc(100vw-24px))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 dark:border-slate-800">
                        <div>
                          <div className="text-xs font-bold text-slate-800 dark:text-slate-100">Tabular e encerrar</div>
                          <div className="text-[9px] text-slate-400">O card só será fechado após confirmação do Genesys</div>
                        </div>
                        <button type="button" disabled={wrapupPanel.submitting} onClick={() => setWrapupPanel((previous) => ({ ...previous, open: false }))} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><XIcon size={14} /></button>
                      </div>
                      <div className="p-2.5">
                        <input
                          autoFocus
                          value={wrapupPanel.query}
                          onChange={(event) => setWrapupPanel((previous) => ({ ...previous, query: event.target.value }))}
                          placeholder="Pesquisar o que ocorreu..."
                          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        />
                        <div className="mt-2 max-h-64 overflow-y-auto custom-scrollbar">
                          {wrapupPanel.loading ? (
                            <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-400"><Loader2 size={15} className="animate-spin" /> Carregando tabulações do Genesys...</div>
                          ) : wrapupPanel.error ? (
                            <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">{wrapupPanel.error}</div>
                          ) : wrapupPanel.codes
                            .filter((code) => `${code.name} ${code.description || ''}`.toLowerCase().includes(wrapupPanel.query.trim().toLowerCase()))
                            .map((code) => (
                              <button
                                key={code.id}
                                type="button"
                                onClick={() => setWrapupPanel((previous) => ({ ...previous, selected: code }))}
                                className={`mb-1 w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                                  wrapupPanel.selected?.id === code.id
                                    ? 'border-blue-400 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/30'
                                    : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800'
                                }`}
                              >
                                <span className="block text-[11px] font-semibold leading-4 text-slate-800 dark:text-slate-100">{code.name}</span>
                                {code.description ? <span className="mt-0.5 block text-[9px] leading-3 text-slate-500 dark:text-slate-400">{code.description}</span> : null}
                              </button>
                            ))}
                        </div>
                        <div className="mt-2 flex items-center justify-end gap-2 border-t border-slate-100 pt-2 dark:border-slate-800">
                          <button type="button" disabled={wrapupPanel.submitting} onClick={() => setWrapupPanel((previous) => ({ ...previous, open: false }))} className="rounded-lg px-3 py-2 text-[10px] font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">Cancelar</button>
                          <button
                            type="button"
                            disabled={!wrapupPanel.selected || wrapupPanel.loading || wrapupPanel.submitting}
                            onClick={confirmGenesysWrapup}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-[10px] font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {wrapupPanel.submitting ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />}
                            {wrapupPanel.submitting ? 'Confirmando no Genesys...' : 'Confirmar encerramento'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {!isMobileView ? (
                    <button
                      type="button"
                      onClick={() => setIsSidePanelCollapsed((prev) => !prev)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                      title={isSidePanelCollapsed ? 'Mostrar painel' : 'Ocultar painel'}
                      aria-label={isSidePanelCollapsed ? 'Mostrar painel' : 'Ocultar painel'}
                    >
                      <span className={`transition-transform duration-300 ${isSidePanelCollapsed ? 'rotate-0' : 'rotate-180'}`}>
                        {isSidePanelCollapsed ? <PanelRightOpen size={14} /> : <PanelRightClose size={14} />}
                      </span>
                    </button>
                  ) : null}
                </div>
              </div>
            </header>
            {visibleChatVars.length > 0 ? <div className="border-b border-slate-200 bg-white/80 px-2.5 py-1.5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/70 lg:px-3"><div className="flex gap-1.5 overflow-x-auto scrollbar-hide">{visibleChatVars.map(([key, value]) => <div key={key} className="min-w-[90px] rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-800/70"><div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{key.replace('_', ' ')}</div><div className="truncate text-[11px] font-semibold text-slate-700 dark:text-slate-200" title={String(value)}>{String(value)}</div></div>)}</div></div> : null}
            {selectedChat.outreachPendingReply === true ? <div className="border-b border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/30 dark:bg-amber-900/20 dark:text-amber-200 lg:px-3">Atendimento ativo iniciado. Aguarde a primeira resposta do cliente para liberar o envio manual de mensagens.</div> : null}
            <div className="relative flex min-h-0 flex-1 flex-col lg:flex-row"><div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.08),transparent_35%),radial-gradient(circle_at_bottom,rgba(14,165,233,0.08),transparent_30%)] dark:bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.12),transparent_35%),radial-gradient(circle_at_bottom,rgba(14,165,233,0.10),transparent_30%)]" /><div className="relative flex min-h-0 flex-1 flex-col lg:flex-row"><div className="flex-1 overflow-y-auto px-2.5 py-2.5 custom-scrollbar sm:px-3 lg:px-4"><div className="mx-auto flex max-w-2xl flex-col gap-2">{(Array.isArray(selectedChat.messages) ? selectedChat.messages : []).map((m, i) => { const previousMessage = i > 0 ? selectedChat.messages[i - 1] : null; const groupedWithPrevious = belongsToSameMessageGroup(previousMessage, m); const hasStatus = Boolean(getMessageDeliveryStatus(m) && (m.sender === 'agent' || m.sender === 'bot')); const timeClass = m.sender === 'agent' ? 'text-white/75' : 'text-slate-400 dark:text-slate-500'; const bubbleSpacingClass = m.sender === 'system' ? '' : hasStatus ? 'pb-5 pr-10' : 'pb-5'; const groupedCornerClass = groupedWithPrevious ? (m.sender === 'agent' ? 'rounded-tr-md' : 'rounded-tl-md') : ''; return <div key={m.id || `${m.sender}_${i}`} id={`agentmsg-${m.id}`} className={`ui-message-enter -mx-2 px-2 py-0.5 flex transition-colors duration-500 ${groupedWithPrevious ? '-mt-1.5' : ''} ${m.sender === 'agent' ? 'justify-end' : 'justify-start'} ${highlightedMessageId === m.id ? 'bg-blue-400/20' : ''}`}><div className={`group relative max-w-[88%] rounded-2xl px-3 py-2 text-xs shadow-sm sm:max-w-[78%] ${m.sender === 'system' ? 'w-full rounded-xl bg-slate-200/80 py-1.5 text-center text-[11px] italic text-slate-500 shadow-none dark:bg-slate-800 dark:text-slate-400' : m.sender === 'agent' ? `rounded-br-md bg-[#0b93f6] text-white ${bubbleSpacingClass} ${groupedCornerClass}` : `rounded-bl-md border border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 ${bubbleSpacingClass} ${groupedCornerClass}`} ${m.sender !== 'system' ? 'border border-black/5' : ''}`}>{m.sender !== 'system' && !groupedWithPrevious ? <div className={`chat-message-sender-name mb-1 max-w-[200px] truncate text-[10px] font-bold uppercase tracking-wide ${m.sender === 'agent' ? 'text-blue-100/90' : 'text-blue-600 dark:text-blue-400'}`}>{m.sender === 'agent' ? 'Voce' : m.sender === 'user' ? selectedChatName : m.sender.toUpperCase()}</div> : null}{m.replyTo ? <button type="button" onClick={() => scrollToMessage(m.replyTo.messageId)} className={`mb-1.5 block w-full max-w-full rounded-lg border-l-2 px-2 py-1 text-left text-[11px] transition-opacity hover:opacity-80 ${m.sender === 'agent' ? 'border-white/60 bg-white/15 text-white/90' : 'border-blue-400 bg-blue-50 text-slate-600 dark:bg-slate-700/50 dark:text-slate-300'}`}><div className="truncate font-semibold opacity-80">{m.replyTo.sender === 'agent' ? 'Você' : m.replyTo.sender === 'user' ? selectedChatName : (m.replyTo.sender || 'Mensagem')}</div><div className="truncate opacity-90">{m.replyTo.hasMedia && !m.replyTo.preview ? '[mídia]' : (m.replyTo.preview || '[mensagem]')}</div></button> : null}<ChatMessageContent message={m} messages={selectedChat.messages} messageIndex={i} onOpenMedia={openChatMedia} />{m.sender !== 'system' ? <button type="button" onClick={() => setReplyingTo({ id: m.id, sender: m.sender, preview: (m.text || (m.media ? `[${m.media.type || 'mídia'}]` : '') || '').slice(0, 120) })} title="Responder" className={`absolute -top-2 ${m.sender === 'agent' ? 'left-1' : 'right-1'} opacity-0 group-hover:opacity-100 flex h-6 w-6 items-center justify-center rounded-full bg-white text-slate-500 shadow ring-1 ring-black/5 transition-opacity hover:text-blue-600 dark:bg-slate-700 dark:text-slate-300`}><CornerUpLeft size={12} /></button> : null}{m.sender !== 'system' ? <span className={`absolute bottom-2 ${hasStatus ? 'right-8' : 'right-3'} text-[10px] ${timeClass}`}>{formatTime(m.timestamp)}</span> : null}{renderMessageDeliveryStatus(m)}</div></div>; })}<div ref={chatEndRef} /></div></div>{!isMobileView ? <div className={`hidden lg:block overflow-hidden transition-[width,opacity] duration-300 ease-out ${isSidePanelCollapsed ? 'w-0 opacity-0' : 'w-[280px] opacity-100'}`}><aside className="h-full w-[280px] overflow-y-auto border-l border-slate-200 bg-white/95 px-4 py-4 custom-scrollbar backdrop-blur dark:border-slate-800 dark:bg-slate-900/95"><div className={`transition-opacity duration-200 ${isSidePanelCollapsed ? 'pointer-events-none opacity-0' : 'opacity-100 delay-75'}`}>{renderInfoPanel()}{renderQuickRepliesPanel()}</div></aside></div> : null}{!isMobileView && isGenesysChatClient(selectedChat) ? <div className={`hidden lg:block overflow-hidden transition-[width,opacity] duration-300 ease-out ${isAiPanelOpen ? 'w-[330px] opacity-100' : 'w-0 opacity-0'}`}><aside className="h-full w-[330px] border-l border-violet-100 bg-white/98 px-4 py-4 dark:border-violet-900/30 dark:bg-slate-900/98">{renderAiPanel()}</aside></div> : null}</div></div>
            <form onSubmit={handleSend} className="border-t border-slate-200 bg-white/90 px-2.5 py-2 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 sm:px-3 lg:px-4">{replyingTo ? <div className="mx-auto mb-1.5 flex max-w-2xl items-center gap-2 rounded-xl border-l-4 border-blue-500 bg-slate-50 px-2.5 py-1.5 dark:bg-slate-800"><CornerUpLeft size={14} className="shrink-0 text-blue-500" /><div className="min-w-0 flex-1"><div className="truncate text-[11px] font-semibold text-blue-600 dark:text-blue-400">Respondendo a {replyingTo.sender === 'agent' ? 'você' : replyingTo.sender === 'user' ? selectedChatName : (replyingTo.sender || 'mensagem')}</div><div className="truncate text-xs text-slate-500 dark:text-slate-400">{replyingTo.preview || '[mensagem]'}</div></div><button type="button" onClick={() => setReplyingTo(null)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700"><XIcon size={14} /></button></div> : null}<div className="mx-auto flex max-w-2xl items-end gap-1.5"><button type="button" onClick={handleImproveAgentText} disabled={selectedChatReplyLocked || aiImprovingText || !agentInput.trim()} title="Corrigir ortografia e melhorar clareza com IA" aria-label="Melhorar texto com IA" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-violet-200 bg-violet-50 text-violet-700 transition-colors hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-violet-900/50 dark:bg-violet-950/30 dark:text-violet-300 dark:hover:bg-violet-950/50">{aiImprovingText ? <Loader2 size={15} className="animate-spin" /> : <OnionAiIcon size={17} />}</button><button type="button" onClick={openMediaPicker} disabled={selectedChatReplyLocked} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"><Paperclip size={15} /></button><div className="flex flex-1 items-end rounded-2xl border border-slate-200 bg-slate-50 px-1 shadow-sm dark:border-slate-700 dark:bg-slate-800"><textarea ref={agentInputRef} rows={1} className="max-h-28 min-h-[36px] w-full resize-none bg-transparent px-3 py-2 text-xs leading-4 text-slate-900 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed disabled:opacity-50 dark:text-white dark:placeholder:text-slate-500 custom-scrollbar" value={agentInput} onChange={(e) => setAgentInput(e.target.value)} onKeyDown={handleAgentInputKeyDown} placeholder={selectedChat.outreachPendingReply === true ? 'Aguardando a primeira resposta do cliente...' : selectedChat.status === 'waiting' ? 'Puxe o atendimento para responder...' : 'Digite sua mensagem...'} disabled={selectedChatReplyLocked} /></div><button type="submit" disabled={selectedChatReplyLocked} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"><Send size={15} /></button></div><div className="mx-auto mt-1 flex max-w-3xl items-center justify-between gap-2 pl-[92px] text-[10px] font-medium text-slate-400 dark:text-slate-500"><span>Enter envia • Shift + Enter quebra linha</span>{aiImprovementUndo ? <button type="button" onClick={undoAiImprovement} className="shrink-0 font-semibold text-violet-600 hover:text-violet-700 dark:text-violet-300 dark:hover:text-violet-200">Desfazer melhoria</button> : null}</div></form>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center text-slate-400 dark:text-slate-500"><Headset size={40} className="mb-3 opacity-20" /><h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Area de atendimento</h3><p className="mt-1.5 max-w-sm text-xs">Selecione um cliente para abrir a conversa.</p></div>
        )}
        {isMobileView && isAiPanelOpen && selectedChat && isGenesysChatClient(selectedChat) ? <div className="ui-overlay-fade fixed inset-0 z-50 bg-slate-950/55 lg:hidden" onClick={() => setIsAiPanelOpen(false)}><div className="ui-sheet-surface absolute inset-x-0 bottom-0 flex max-h-[88vh] min-h-[58vh] flex-col rounded-t-[28px] bg-white p-4 shadow-2xl dark:bg-slate-900" onClick={(event) => event.stopPropagation()}><div className="mx-auto mb-3 h-1.5 w-14 shrink-0 rounded-full bg-slate-200 dark:bg-slate-700" /><div className="min-h-0 flex-1">{renderAiPanel()}</div></div></div> : null}
        {isMobileView && mobilePanelOpen && selectedChat ? <div className="ui-overlay-fade fixed inset-0 z-40 bg-slate-950/50 lg:hidden" onClick={() => setMobilePanelOpen(false)}><div className="ui-sheet-surface absolute inset-x-0 bottom-0 max-h-[78vh] rounded-t-[28px] bg-white p-4 shadow-2xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}><div className="mx-auto mb-4 h-1.5 w-14 rounded-full bg-slate-200 dark:bg-slate-700" /><div className="flex items-center justify-between gap-3"><div><div className="text-sm font-semibold text-slate-900 dark:text-white">{mobilePanelTab === 'info' ? 'Info do cliente' : 'Mensagens rapidas'}</div><div className="text-xs text-slate-500 dark:text-slate-400">{selectedChatName}</div></div><button type="button" onClick={() => setMobilePanelOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200"><XCircle size={18} /></button></div><div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1 dark:bg-slate-800"><button type="button" onClick={() => setMobilePanelTab('info')} className={`rounded-2xl px-3 py-2 text-sm font-semibold transition-colors ${mobilePanelTab === 'info' ? 'bg-white text-blue-600 shadow-sm dark:bg-slate-700 dark:text-blue-300' : 'text-slate-500 dark:text-slate-300'}`}>Info</button><button type="button" onClick={() => setMobilePanelTab('quick')} className={`rounded-2xl px-3 py-2 text-sm font-semibold transition-colors ${mobilePanelTab === 'quick' ? 'bg-white text-blue-600 shadow-sm dark:bg-slate-700 dark:text-blue-300' : 'text-slate-500 dark:text-slate-300'}`}>Rapidas</button></div><div className="mt-4 max-h-[56vh] overflow-y-auto custom-scrollbar pr-1">{mobilePanelTab === 'info' ? renderInfoPanel() : renderQuickRepliesPanel()}</div></div></div> : null}
        {transferModal.open ? <div className="ui-overlay-fade fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 p-4 backdrop-blur-sm lg:items-center" onClick={closeTransferModal}><div className="ui-responsive-modal w-full max-w-xl rounded-[28px] bg-white p-5 shadow-2xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}><div className="flex items-start justify-between gap-4"><div><h3 className="text-lg font-bold text-slate-900 dark:text-white">Transferir atendimento</h3><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Encaminhe {selectedChatName} para uma fila ou diretamente para outro agente.</p></div><button type="button" onClick={closeTransferModal} disabled={transferModal.submitting} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-200"><XCircle size={18} /></button></div>{transferModal.loading ? <div className="mt-5 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"><Loader2 size={18} className="animate-spin text-blue-500" />Carregando destinos...</div> : <div className="mt-5 space-y-4"><div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1 dark:bg-slate-800"><button type="button" onClick={() => setTransferModal((prev) => ({ ...prev, mode: 'queue' }))} className={`rounded-2xl px-3 py-2 text-sm font-semibold transition-colors ${transferModal.mode === 'queue' ? 'bg-white text-blue-600 shadow-sm dark:bg-slate-700 dark:text-blue-300' : 'text-slate-500 dark:text-slate-300'}`}>Fila</button><button type="button" onClick={() => setTransferModal((prev) => ({ ...prev, mode: 'agent' }))} className={`rounded-2xl px-3 py-2 text-sm font-semibold transition-colors ${transferModal.mode === 'agent' ? 'bg-white text-blue-600 shadow-sm dark:bg-slate-700 dark:text-blue-300' : 'text-slate-500 dark:text-slate-300'}`}>Agente</button></div>{transferModal.mode === 'queue' ? <div><label className="mb-2 block text-sm font-semibold text-slate-800 dark:text-slate-100">Fila de destino</label><select value={transferModal.queue} onChange={(e) => setTransferModal((prev) => ({ ...prev, queue: e.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white">{transferModal.queues.length === 0 ? <option value="">Nenhuma fila disponivel</option> : transferModal.queues.map((queue) => <option key={queue.id || queue.name} value={queue.name}>{queue.name}</option>)}</select></div> : <div><label className="mb-2 block text-sm font-semibold text-slate-800 dark:text-slate-100">Agente de destino</label><select value={transferModal.agentId} onChange={(e) => setTransferModal((prev) => ({ ...prev, agentId: e.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white">{transferModal.agents.length === 0 ? <option value="">Nenhum agente disponivel</option> : transferModal.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name || agent.username}{agent.queues?.length ? ` - ${agent.queues.join(', ')}` : ''}</option>)}</select></div>}<div><label className="mb-2 block text-sm font-semibold text-slate-800 dark:text-slate-100">Motivo opcional</label><textarea rows={3} value={transferModal.reason} onChange={(e) => setTransferModal((prev) => ({ ...prev, reason: e.target.value }))} placeholder="Ex: encaminhando para especialista..." className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white" /></div><div className="flex flex-col gap-3 sm:flex-row"><button type="button" onClick={closeTransferModal} disabled={transferModal.submitting} className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">Cancelar</button><button type="button" onClick={handleTransferChat} disabled={transferModal.submitting || (transferModal.mode === 'queue' ? !transferModal.queue : !transferModal.agentId)} className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{transferModal.submitting ? <Loader2 size={16} className="animate-spin" /> : <ArrowRightLeft size={16} />}{transferModal.submitting ? 'Transferindo...' : 'Transferir'}</button></div></div>}</div></div> : null}
        {showQuickModal ? <div className="ui-overlay-fade fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowQuickModal(false)}><div className="ui-modal-surface w-full max-w-lg rounded-3xl bg-white p-5 shadow-2xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}><h3 className="mb-3 text-lg font-bold text-slate-900 dark:text-white">Mensagem rapida</h3><textarea className="min-h-[160px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white" value={quickDraft} onChange={(e) => setQuickDraft(e.target.value)} /><div className="mt-4 flex gap-3"><button type="button" onClick={() => setShowQuickModal(false)} className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">Cancelar</button><button type="button" onClick={handleQuickSend} disabled={selectedChatReplyLocked} className="flex-1 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">Enviar</button></div></div></div> : null}
        {nameEditor.open ? (
          <div className="ui-overlay-fade fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-3 backdrop-blur-sm sm:items-center" onClick={() => !nameEditor.saving && setNameEditor({ open: false, value: '', saving: false })}>
            <div className="ui-modal-surface max-h-[92vh] w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">Seu espaço no Onion</h3>
                  <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">A aparência fica somente neste navegador e neste usuário.</p>
                </div>
                <button type="button" disabled={nameEditor.saving} onClick={() => setNameEditor({ open: false, value: '', saving: false })} className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"><XIcon size={16} /></button>
              </div>

              <div className="max-h-[calc(92vh-132px)] overflow-y-auto p-4 custom-scrollbar sm:p-5">
                <div className="grid gap-5 md:grid-cols-[1fr_0.9fr]">
                  <div className="space-y-4">
                    <label className="block">
                      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-slate-500">Nome de exibição</span>
                      <input
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        value={nameEditor.value}
                        onChange={(e) => setNameEditor((p) => ({ ...p, value: e.target.value }))}
                        maxLength={80}
                        autoFocus
                      />
                      <span className="mt-1 block text-[9px] text-slate-400">Usado também em {'{agente.nome}'} nas mensagens rápidas.</span>
                    </label>

                    <div>
                      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">Fundo da conversa</div>
                      <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
                        {[['default', 'Padrão'], ['solid', 'Cor'], ['image', 'Foto']].map(([mode, label]) => (
                          <button key={mode} type="button" onClick={() => setAppearanceDraft((previous) => ({ ...previous, backgroundMode: mode }))} className={`rounded-lg px-2 py-2 text-[10px] font-bold transition ${appearanceDraft.backgroundMode === mode ? 'bg-white text-blue-600 shadow-sm dark:bg-slate-700 dark:text-blue-300' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}>{label}</button>
                        ))}
                      </div>
                    </div>

                    {appearanceDraft.backgroundMode === 'solid' ? (
                      <label className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 dark:border-slate-700">
                        <span><span className="block text-[10px] font-bold text-slate-700 dark:text-slate-200">Cor sólida</span><span className="font-mono text-[9px] text-slate-400">{appearanceDraft.backgroundColor}</span></span>
                        <input type="color" value={appearanceDraft.backgroundColor} onChange={(event) => setAppearanceDraft((previous) => ({ ...previous, backgroundColor: event.target.value }))} className="h-8 w-10 cursor-pointer rounded-lg border-0 bg-transparent p-0" />
                      </label>
                    ) : null}

                    {appearanceDraft.backgroundMode === 'image' ? (
                      <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                        <div className="flex items-center gap-2">
                          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-[10px] font-bold text-white hover:bg-blue-700">
                            <ImageIcon size={13} />
                            {appearanceDraft.backgroundImage ? 'Trocar foto' : 'Escolher foto'}
                            <input type="file" accept="image/*" className="hidden" onChange={handleChatBackgroundFile} />
                          </label>
                          {appearanceDraft.backgroundImage ? <button type="button" onClick={() => setAppearanceDraft((previous) => ({ ...previous, backgroundImage: '' }))} className="rounded-lg px-2.5 py-2 text-[10px] font-bold text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30">Remover</button> : null}
                        </div>
                        <label className="mt-3 block">
                          <span className="mb-1 flex items-center justify-between text-[9px] font-semibold text-slate-500"><span>Escurecer imagem</span><span>{appearanceDraft.backgroundDim}%</span></span>
                          <input type="range" min="0" max="80" step="1" value={appearanceDraft.backgroundDim} onChange={(event) => setAppearanceDraft((previous) => ({ ...previous, backgroundDim: Number(event.target.value) }))} className="w-full accent-blue-600" />
                        </label>
                        <div className="mt-2 text-[9px] leading-4 text-slate-400">A foto é reduzida e salva localmente. Máximo de 8 MB.</div>
                      </div>
                    ) : null}

                    <div>
                      <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">Tema e profundidade</div>
                      <div className="space-y-2">
                        <label className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 dark:border-slate-700">
                          <span><span className="block text-[10px] font-bold text-slate-700 dark:text-slate-200">Cor de destaque</span><span className="font-mono text-[9px] text-slate-400">{appearanceDraft.themeAccentColor}</span></span>
                          <input type="color" value={appearanceDraft.themeAccentColor} onChange={(event) => setAppearanceDraft((previous) => ({ ...previous, themeAccentColor: event.target.value }))} className="h-8 w-10 cursor-pointer rounded-lg border-0 bg-transparent p-0" />
                        </label>
                        <label className="block rounded-xl border border-slate-200 px-3 py-2.5 dark:border-slate-700">
                          <span className="mb-1.5 flex items-center justify-between gap-3 text-[9px] font-semibold text-slate-500">
                            <span><span className="block text-[10px] font-bold text-slate-700 dark:text-slate-200">Sombra/brilho da conversa</span><span>{appearanceDraft.ambientGlowStrength === 0 ? 'Desativada' : `${appearanceDraft.ambientGlowStrength}%`}</span></span>
                            <span className="flex items-center gap-2"><span className="font-mono text-[9px] text-slate-400">{appearanceDraft.ambientGlowColor}</span><input type="color" value={appearanceDraft.ambientGlowColor} onChange={(event) => setAppearanceDraft((previous) => ({ ...previous, ambientGlowColor: event.target.value }))} className="h-7 w-8 cursor-pointer rounded-md border-0 bg-transparent p-0" aria-label="Cor da sombra da conversa" /></span>
                          </span>
                          <input type="range" min="0" max="200" step="5" value={appearanceDraft.ambientGlowStrength} onChange={(event) => setAppearanceDraft((previous) => ({ ...previous, ambientGlowStrength: Number(event.target.value) }))} className="w-full" style={{ accentColor: appearanceDraft.ambientGlowColor }} />
                        </label>
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">Balões e texto</div>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          ['agentBubbleColor', 'Seu balão'],
                          ['agentTextColor', 'Seu texto'],
                          ['customerBubbleColor', 'Balão do cliente'],
                          ['customerTextColor', 'Texto do cliente'],
                          ['customerNameColor', 'Nome do cliente'],
                        ].map(([field, label]) => (
                          <label key={field} className="flex items-center justify-between rounded-xl border border-slate-200 px-2.5 py-2 dark:border-slate-700">
                            <span className="text-[9px] font-semibold text-slate-600 dark:text-slate-300">{label}</span>
                            <input type="color" value={appearanceDraft[field]} onChange={(event) => setAppearanceDraft((previous) => ({ ...previous, ...(field === 'customerNameColor' ? {} : { customBubbles: true }), [field]: event.target.value }))} className="h-7 w-8 cursor-pointer rounded-md border-0 bg-transparent p-0" />
                          </label>
                        ))}
                      </div>
                      <div className="mt-2 rounded-xl border border-slate-200 p-2.5 dark:border-slate-700">
                        <label className="flex items-center justify-between gap-3">
                          <span><span className="block text-[10px] font-bold text-slate-700 dark:text-slate-200">Borda dos balões</span><span className="text-[9px] text-slate-400">Desativada por padrão</span></span>
                          <input type="checkbox" checked={appearanceDraft.bubbleBorderEnabled} onChange={(event) => setAppearanceDraft((previous) => ({ ...previous, bubbleBorderEnabled: event.target.checked }))} className="h-4 w-4" style={{ accentColor: appearanceDraft.themeAccentColor }} />
                        </label>
                        {appearanceDraft.bubbleBorderEnabled ? (
                          <label className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 dark:border-slate-800">
                            <span className="text-[9px] font-semibold text-slate-500">Cor da borda</span>
                            <input type="color" value={appearanceDraft.bubbleBorderColor} onChange={(event) => setAppearanceDraft((previous) => ({ ...previous, bubbleBorderColor: event.target.value }))} className="h-7 w-8 cursor-pointer rounded-md border-0 bg-transparent p-0" />
                          </label>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">Preview</div>
                    <div
                      className="relative min-h-[280px] overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 bg-cover bg-center shadow-inner dark:border-slate-700"
                      style={{
                        backgroundColor: appearanceDraft.backgroundMode === 'solid' ? appearanceDraft.backgroundColor : undefined,
                        backgroundImage: appearanceDraft.backgroundMode === 'image' && appearanceDraft.backgroundImage ? `url("${appearanceDraft.backgroundImage}")` : undefined,
                      }}
                    >
                      {appearanceDraft.backgroundMode === 'image' && appearanceDraft.backgroundImage ? <div className="absolute inset-0" style={{ backgroundColor: `rgb(2 6 23 / ${Number(appearanceDraft.backgroundDim || 0) / 100})` }} /> : null}
                      {appearanceDraft.backgroundMode === 'default' ? <div className="absolute inset-0" style={{ background: `radial-gradient(circle at top, color-mix(in srgb, ${appearanceDraft.ambientGlowColor} ${Math.min(40, Number(appearanceDraft.ambientGlowStrength || 0) * 0.14)}%, transparent), transparent 45%), radial-gradient(circle at bottom, color-mix(in srgb, ${appearanceDraft.ambientGlowColor} ${Math.min(32, Number(appearanceDraft.ambientGlowStrength || 0) * 0.1)}%, transparent), transparent 40%)` }} /> : null}
                      <div className="absolute right-3 top-3 rounded-full px-2 py-1 text-[8px] font-bold text-white shadow-sm" style={{ backgroundColor: appearanceDraft.themeAccentColor }}>Destaque</div>
                      <div className="relative flex min-h-[280px] flex-col justify-end gap-2 p-3">
                        <div className="max-w-[84%] rounded-2xl rounded-bl-md px-3 py-2 text-[10px] shadow-sm" style={{ backgroundColor: appearanceDraft.customerBubbleColor, color: appearanceDraft.customerTextColor, border: appearanceDraft.bubbleBorderEnabled ? `1px solid ${appearanceDraft.bubbleBorderColor}` : '1px solid transparent' }}>
                          <div className="mb-1 text-[8px] font-bold uppercase" style={{ color: appearanceDraft.customerNameColor }}>Cliente</div>
                          Gostaria de verificar minha conexão.
                        </div>
                        <div className="ml-auto max-w-[84%] rounded-2xl rounded-br-md px-3 py-2 text-[10px] shadow-sm" style={{ backgroundColor: appearanceDraft.agentBubbleColor, color: appearanceDraft.agentTextColor, border: appearanceDraft.bubbleBorderEnabled ? `1px solid ${appearanceDraft.bubbleBorderColor}` : '1px solid transparent' }}>
                          <div className="mb-1 text-[8px] font-bold uppercase opacity-70">{nameEditor.value || 'Você'}</div>
                          Claro! Vou analisar para você.
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-3 dark:border-slate-800 sm:px-5">
                <button type="button" disabled={nameEditor.saving} onClick={() => setAppearanceDraft({ ...DEFAULT_CHAT_APPEARANCE })} className="mr-auto inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[10px] font-bold text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"><RefreshCw size={12} />Restaurar padrão</button>
                <button type="button" disabled={nameEditor.saving} onClick={() => setNameEditor({ open: false, value: '', saving: false })} className="rounded-xl border border-slate-200 px-3 py-2 text-[10px] font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300">Cancelar</button>
                <button type="button" disabled={nameEditor.saving} onClick={handleSaveAgentName} className="inline-flex min-w-24 items-center justify-center rounded-xl bg-blue-600 px-4 py-2 text-[10px] font-bold text-white hover:bg-blue-700 disabled:opacity-50">{nameEditor.saving ? <Loader2 size={13} className="animate-spin" /> : 'Salvar'}</button>
              </div>
            </div>
          </div>
        ) : null}
        {quickEditor.open ? (
          <div className="ui-overlay-fade fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !quickEditor.saving && setQuickEditor({ open: false, id: null, name: '', text: '', saving: false })}>
            <div className="ui-modal-surface w-full max-w-lg rounded-3xl bg-white p-5 shadow-2xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
              <h3 className="mb-1 text-lg font-bold text-slate-900 dark:text-white">{quickEditor.id ? 'Editar mensagem rápida' : 'Nova mensagem rápida'}</h3>
              <p className="mb-3 text-[11px] text-slate-500">
                Ex.: {'{saudacao}'}, {'{agente.nome}'}! Em que posso ajudar, {'{cliente.nome}'}?
              </p>
              <input
                className="mb-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                placeholder="Nome (ex: Saudação)"
                value={quickEditor.name}
                onChange={(e) => setQuickEditor((p) => ({ ...p, name: e.target.value }))}
              />
              <textarea
                className="min-h-[140px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                placeholder="Texto com variáveis opcionais…"
                value={quickEditor.text}
                onChange={(e) => setQuickEditor((p) => ({ ...p, text: e.target.value }))}
              />
              <div className="mt-4 flex gap-3">
                <button type="button" disabled={quickEditor.saving} onClick={() => setQuickEditor({ open: false, id: null, name: '', text: '', saving: false })} className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold dark:border-slate-700">Cancelar</button>
                <button type="button" disabled={quickEditor.saving} onClick={handleSaveQuickReply} className="flex-1 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{quickEditor.saving ? 'Salvando…' : 'Salvar'}</button>
              </div>
            </div>
          </div>
        ) : null}
        {renderIxcDetailsModal()}
        {bulkPickupModal.open ? <div className="ui-overlay-fade fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 p-4 backdrop-blur-sm lg:items-center" onClick={closeBulkPickupModal}><div className="ui-responsive-modal w-full max-w-2xl rounded-[28px] bg-white p-5 shadow-2xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}><div className="flex items-start justify-between gap-4"><div><h3 className="text-lg font-bold text-slate-900 dark:text-white">Puxar todos em espera</h3><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Assume {waitingChats.length} atendimento(s) das suas filas. Escreva a primeira mensagem para todos ou deixe vazio para nao enviar nada.</p></div><button type="button" onClick={closeBulkPickupModal} disabled={bulkPickupModal.loading} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-200"><XCircle size={18} /></button></div>{appTemplates.length > 0 ? <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60"><div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Templates da aplicacao</div><div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">{appTemplates.map((tpl) => <button key={`bulk_tpl_${tpl.id}`} type="button" onClick={() => setBulkPickupModal((prev) => ({ ...prev, message: renderTemplateText(tpl.text || '') }))} className="min-w-[180px] rounded-2xl border border-slate-200 bg-white px-3 py-2 text-left transition-colors hover:border-orange-300 hover:bg-orange-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-orange-700 dark:hover:bg-orange-900/20"><div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{tpl.name}</div><div className="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{tpl.text}</div></button>)}</div></div> : <div className="mt-4 rounded-2xl border border-dashed border-slate-200 px-4 py-3 text-sm text-slate-400 dark:border-slate-700">Nenhum template proprio da aplicacao encontrado.</div>}<div className="mt-4"><label className="mb-2 block text-sm font-semibold text-slate-800 dark:text-slate-100">Mensagem inicial opcional</label><textarea rows={7} value={bulkPickupModal.message} onChange={(e) => setBulkPickupModal((prev) => ({ ...prev, message: e.target.value }))} placeholder="Ex: Oi, tudo bem? Vou assumir seu atendimento por aqui. Deixe vazio para puxar sem enviar mensagem." className="min-h-[180px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-orange-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white" /></div><div className="mt-4 flex flex-col gap-3 sm:flex-row"><button type="button" onClick={closeBulkPickupModal} disabled={bulkPickupModal.loading} className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">Cancelar</button><button type="button" onClick={handleBulkPickup} disabled={bulkPickupModal.loading || waitingChats.length === 0} className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50">{bulkPickupModal.loading ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} fill="currentColor" />}{bulkPickupModal.loading ? 'Puxando...' : 'Puxar todos'}</button></div></div></div> : null}
        {mediaViewer.open ? (
          <ChatMediaLightbox
            open={mediaViewer.open}
            items={chatMediaItems}
            index={mediaViewer.index}
            onClose={() => setMediaViewer({ open: false, index: 0 })}
            onIndexChange={(next) => setMediaViewer((prev) => ({ ...prev, index: next }))}
          />
        ) : null}
        {mediaModal.open ? <div className="ui-overlay-fade fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 p-4 backdrop-blur-sm lg:items-center" onClick={() => !mediaModal.uploading && closeMediaModal()}><div className="ui-responsive-modal w-full max-w-xl overflow-hidden rounded-[28px] bg-white shadow-2xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}><div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800"><div className="flex items-center justify-between gap-3"><div><div className="text-lg font-semibold text-slate-900 dark:text-white">Enviar anexo</div><div className="text-sm text-slate-500 dark:text-slate-400">Confira o preview antes de enviar.</div></div><button type="button" onClick={closeMediaModal} disabled={mediaModal.uploading} className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-200"><XCircle size={18} /></button></div></div><div className="space-y-4 p-5"><div className="overflow-hidden rounded-[24px] border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">{mediaModal.previewKind === 'image' ? <img src={mediaModal.previewUrl} alt={mediaModal.file?.name || 'Preview'} className="max-h-[360px] w-full object-contain bg-black/5" /> : mediaModal.previewKind === 'video' ? <video controls className="max-h-[360px] w-full bg-black" src={mediaModal.previewUrl} /> : mediaModal.previewKind === 'audio' ? <div className="space-y-4 p-5"><div className="flex items-center gap-3 text-slate-700 dark:text-slate-200"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300"><AudioLines size={22} /></div><div><div className="font-semibold">Audio</div><div className="text-sm text-slate-500 dark:text-slate-400">{mediaModal.file?.name}</div></div></div><audio controls className="w-full" src={mediaModal.previewUrl} /></div> : <div className="flex items-center gap-4 p-5"><div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-200">{mediaModal.previewKind === 'image' ? <ImageIcon size={24} /> : mediaModal.previewKind === 'video' ? <Video size={24} /> : <FileText size={24} />}</div><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-slate-900 dark:text-white">{mediaModal.file?.name || 'Arquivo'}</div><div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{formatFileSize(mediaModal.file?.size || 0)}</div></div></div>}</div><div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-800"><div className="font-semibold text-slate-800 dark:text-slate-100">{mediaModal.file?.name || 'Arquivo'}</div><div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{mediaModal.file?.type || 'application/octet-stream'} • {formatFileSize(mediaModal.file?.size || 0)}</div></div><div><label className="mb-2 block text-sm font-semibold text-slate-800 dark:text-slate-100">Legenda opcional</label><textarea rows={3} value={mediaModal.caption} onChange={(e) => setMediaModal((prev) => ({ ...prev, caption: e.target.value }))} placeholder="Escreva uma legenda, se quiser..." className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white" /></div><div className="flex gap-3"><button type="button" onClick={closeMediaModal} disabled={mediaModal.uploading} className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">Cancelar</button><button type="button" onClick={handleSendMedia} disabled={mediaModal.uploading} className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{mediaModal.uploading ? <Loader2 size={16} className="animate-spin" /> : <Send size={14} />}{mediaModal.uploading ? 'Enviando...' : 'Enviar arquivo'}</button></div></div></div></div> : null}
      </main>
      ) : null}
    </div>
  );
};

export default AgentWorkspace;

