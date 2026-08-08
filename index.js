import './src/config/env.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import adapter from './db/DatabaseAdapter.js';
import { setIo } from './src/services/logs.js';
import { markOffline } from './src/services/userStatus.js';
import { authenticate } from './src/middleware/auth.js';
import { superAdminIpWhitelist, superAdminIpCheck } from './src/middleware/superAdminIp.js';
import { repairAllChatStates } from './src/services/chatStateGuard.js';
import { uploadsRoot } from './src/services/mediaStorage.js';
import jwt from 'jsonwebtoken';
import { JWT_SECRET_VALUE } from './src/config/constants.js';
import {
  registerExtensionAtendimentoHandlers,
  isExtensionSocket,
  extensionRoomForAgent
} from './src/services/extensionAtendimento.js';
import { registerLocalDictationHandlers } from './src/services/localDictationSocket.js';
import { warmLocalTranscription } from './src/services/localAudioTranscription.js';

const COMPANION_MODE_EARLY = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.COMPANION_MODE || '').trim().toLowerCase()
);
const COMPANION_USES_LOCAL_JSON_EARLY = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.USE_JSON_DB || '').trim().toLowerCase()
) || String(process.env.DB_ADAPTER || '').trim().toLowerCase() === 'json';

if (COMPANION_MODE_EARLY && !COMPANION_USES_LOCAL_JSON_EARLY) {
  throw new Error('COMPANION_MODE exige DB_ADAPTER=json; banco remoto foi bloqueado');
}

const routeBundle = COMPANION_MODE_EARLY
  ? await (async () => {
      const [
        auth, tenants, users, variables, templates, schedules, queues, tags,
        chats, cannedResponses, aiMemories, logs, metrics, media, contacts,
        loadTest, system
      ] = await Promise.all([
        import('./src/routes/auth.js'),
        import('./src/routes/tenants.js'),
        import('./src/routes/users.js'),
        import('./src/routes/variables.js'),
        import('./src/routes/templates.js'),
        import('./src/routes/schedules.js'),
        import('./src/routes/queues.js'),
        import('./src/routes/tags.js'),
        import('./src/routes/chats.js'),
        import('./src/routes/cannedResponses.js'),
        import('./src/routes/aiMemories.js'),
        import('./src/routes/logs.js'),
        import('./src/routes/metrics.js'),
        import('./src/routes/media.js'),
        import('./src/routes/contacts.js'),
        import('./src/routes/loadTest.js'),
        import('./src/routes/system.js')
      ]);
      return {
        authRouter: auth.default,
        tenantsRouter: tenants.default,
        tenantCurrentHandler: tenants.tenantCurrentHandler,
        usersRouter: users.default,
        variablesRouter: variables.default,
        templatesRouter: templates.default,
        schedulesRouter: schedules.default,
        queuesRouter: queues.default,
        tagsRouter: tags.default,
        chatsRouter: chats.default,
        cannedResponsesRouter: cannedResponses.default,
        aiMemoriesRouter: aiMemories.default,
        logsRouter: logs.default,
        metricsRouter: metrics.default,
        mediaRouter: media.default,
        contactsRouter: contacts.default,
        loadTestRouter: loadTest.default,
        systemRouter: system.default
      };
    })()
  : await import('./src/routes/index.js');

const {
  authRouter, tenantsRouter, usersRouter, flowsRouter, variablesRouter,
  templatesRouter, schedulesRouter, queuesRouter, tagsRouter, webhooksRouter,
  chatsRouter, cannedResponsesRouter, aiMemoriesRouter, logsRouter,
  superAdminRouter, tenantCurrentHandler, telegramRouter, channelsRouter,
  whatsappRouter, metricsRouter, catalogRouter, mediaRouter, contactsRouter,
  reportsRouter, analyticsRouter, loadTestRouter, systemRouter
} = routeBundle;

let startTelegramPolling = () => {};
let startDbChangeLogger = async () => {};
let startOutreachCampaignWorker = () => {};
let startChatRuntimeWatcher = () => {};
let startDataRetentionWorker = () => {};
let closeRedis = async () => {};
let getRedisStatus = () => ({ ready: false });
let initRedis = async () => {};
let isBullMqEnabled = () => false;
let closeQueues = async () => {};
let closeBullMqWorkers = async () => {};
let startBullMqWorkers = async () => {};

if (!COMPANION_MODE_EARLY) {
  const [telegramPolling, dbChangeLogger, outreachWorker, runtimeWatcher, retentionWorker, redis, queues, workers] = await Promise.all([
    import('./src/services/telegramPolling.js'),
    import('./src/services/dbChangeLogger.js'),
    import('./src/services/outreachCampaignWorker.js'),
    import('./src/services/chatRuntimeWatcher.js'),
    import('./src/services/dataRetentionWorker.js'),
    import('./src/services/redisClient.js'),
    import('./src/queues/index.js'),
    import('./src/workers/index.js')
  ]);
  startTelegramPolling = telegramPolling.startTelegramPolling;
  startDbChangeLogger = dbChangeLogger.startDbChangeLogger;
  startOutreachCampaignWorker = outreachWorker.startOutreachCampaignWorker;
  startChatRuntimeWatcher = runtimeWatcher.startChatRuntimeWatcher;
  startDataRetentionWorker = retentionWorker.startDataRetentionWorker;
  ({ closeRedis, getRedisStatus, initRedis, isBullMqEnabled } = redis);
  ({ closeQueues } = queues);
  ({ closeBullMqWorkers, startBullMqWorkers } = workers);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3001;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
const NODE_ENV = process.env.NODE_ENV || 'development';
const DEFAULT_MEDIA_MAX_UPLOAD_BYTES = 70 * 1024 * 1024;
const MEDIA_MAX_UPLOAD_BYTES = Number.parseInt(
  process.env.MEDIA_MAX_UPLOAD_BYTES || `${DEFAULT_MEDIA_MAX_UPLOAD_BYTES}`,
  10
);
const MEDIA_JSON_LIMIT_BYTES = Math.ceil(
  (Number.isFinite(MEDIA_MAX_UPLOAD_BYTES) ? MEDIA_MAX_UPLOAD_BYTES : DEFAULT_MEDIA_MAX_UPLOAD_BYTES) * 1.45
  + (1024 * 1024)
);
const MEDIA_JSON_LIMIT = `${Math.max(16, Math.ceil(MEDIA_JSON_LIMIT_BYTES / (1024 * 1024)))}mb`;
const envFlag = (name, defaultValue = false) => {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return defaultValue;
  }
  const normalized = String(rawValue).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
};
const CHAT_STATE_REPAIR_ON_BOOT = envFlag('CHAT_STATE_REPAIR_ON_BOOT', false);
const CHAT_RUNTIME_WATCHER_ENABLED = envFlag('CHAT_RUNTIME_WATCHER_ENABLED', false);
const DB_CHANGE_LOGGER_ENABLED = envFlag('DB_CHANGE_LOGGER_ENABLED', false);
const COMPANION_MODE = COMPANION_MODE_EARLY;
const OUTREACH_CAMPAIGN_WORKER_ENABLED = envFlag('OUTREACH_CAMPAIGN_WORKER_ENABLED', !COMPANION_MODE);
try {
  await adapter.init();
  if (!COMPANION_MODE) await initRedis();
  else console.log('[COMPANION] Redis e filas externas desativados');
  console.log(COMPANION_MODE ? '[COMPANION] Armazenamento JSON local inicializado' : 'Banco de dados inicializado');
  if (CHAT_STATE_REPAIR_ON_BOOT) {
    const chatRepairSummary = await repairAllChatStates({ log: true });
    if (chatRepairSummary?.repaired) {
      console.log(`[CHAT_STATE_GUARD] ${chatRepairSummary.repaired} chats reparados na inicializacao`);
    }
  } else {
    console.log('[CHAT_STATE_GUARD] Reparacao inicial desligada por configuracao');
  }
  if (DB_CHANGE_LOGGER_ENABLED) {
    await startDbChangeLogger();
  } else {
    console.log('[DB_CHANGE_LOGGER] Desligado por configuracao');
  }
  if (!COMPANION_MODE) await startBullMqWorkers();
  const bullMqOperational = isBullMqEnabled() && getRedisStatus().ready;
  if (OUTREACH_CAMPAIGN_WORKER_ENABLED && !bullMqOperational) {
    startOutreachCampaignWorker();
  } else if (OUTREACH_CAMPAIGN_WORKER_ENABLED && bullMqOperational) {
    console.log('[OUTREACH_CAMPAIGN_WORKER] Worker local substituido por BullMQ');
  } else {
    console.log('[OUTREACH_CAMPAIGN_WORKER] Desligado por configuracao');
  }
  if (CHAT_RUNTIME_WATCHER_ENABLED) {
    startChatRuntimeWatcher();
  } else {
    console.log('[CHAT_RUNTIME_WATCHER] Desligado por configuracao');
  }
  if (!COMPANION_MODE) startDataRetentionWorker();
} catch (error) {
  console.error('❌ Falha ao conectar ao MongoDB:', error.message);
  process.exit(1);
}

const app = express();
// behind reverse proxies (cloudflared, etc.)
app.set('trust proxy', 1);
const httpServer = createServer(app);
app.use(compression());

// Helmet - Headers de segurança HTTP.
// styleSrc continua aceitando 'unsafe-inline' porque React + react-flow usam
// `style={{}}` inline em massa (posicionamento de nodes, transforms, handles).
// Refatorar para CSS classes não é viável sem trocar a lib do editor de fluxo.
// scriptSrc continua restrito a 'self' — XSS por <script> injetado bloqueado.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: [
        "'self'",
        ...(NODE_ENV === 'development' ? [
          "http://localhost:3101",
          "ws://localhost:3101",
          "http://127.0.0.1:3101",
          "ws://127.0.0.1:3101",
        ] : []),
        ...(CLIENT_URL ? [CLIENT_URL, CLIENT_URL.replace('https://', 'wss://')] : []),
      ],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS - permitir origens explicitas de desenvolvimento e producao
const isSandboxRuntime = () => {
  const adapter = String(process.env.DB_ADAPTER || '').toLowerCase();
  return adapter === 'json'
    || String(process.env.USE_JSON_DB || '').toLowerCase() === 'true'
    || String(process.env.SANDBOX_SEED_ENDPOINT || '').toLowerCase() === 'true';
};

const clientUrlVariants = (url) => {
  if (!url) return [];
  const parts = String(url).split(',').map((part) => part.trim().replace(/\/$/, '')).filter(Boolean);
  const variants = [];
  for (const raw of parts) {
    variants.push(raw);
    try {
      const parsed = new URL(raw);
      if (parsed.hostname === 'localhost') {
        variants.push(`${parsed.protocol}//127.0.0.1${parsed.port ? `:${parsed.port}` : ''}`);
      } else if (parsed.hostname === '127.0.0.1') {
        variants.push(`${parsed.protocol}//localhost${parsed.port ? `:${parsed.port}` : ''}`);
      }
    } catch {
      // ignore invalid CLIENT_URL entries
    }
  }
  return variants;
};

const developmentOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:30999',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:30999',
  ...clientUrlVariants(CLIENT_URL),
  ...clientUrlVariants(process.env.SOCKET_CORS_ORIGIN)
];

const productionOrigins = [
  'https://onionwebflows.vercel.app',
  'https://flows.onionws.com',
  ...clientUrlVariants(CLIENT_URL)
].filter(Boolean);

const allowedOrigins = [...new Set([
  ...(NODE_ENV === 'development' || isSandboxRuntime() ? developmentOrigins : []),
  ...productionOrigins
])];

const isLocalDevOrigin = (origin) => {
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
};

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  // Local sandbox/dev: any localhost/127.0.0.1 port (Vite, preview, etc.)
  if ((NODE_ENV === 'development' || isSandboxRuntime()) && isLocalDevOrigin(origin)) return true;
  // Cloudflare quick tunnels (free local testing without VPS)
  if ((NODE_ENV === 'development' || isSandboxRuntime()) && /\.trycloudflare\.com$/i.test(origin)) return true;
  return false;
};

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }
    // Nao lanca Error: evita 500 unhandled; so recusa a origem
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Socket.IO com CORS
const io = new SocketIOServer(httpServer, {
  maxHttpBufferSize: 25 * 1024 * 1024,
  cors: {
    origin: function(origin, callback) {
      if (isAllowedOrigin(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST']
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// Rate limiting para Socket.IO - controlar conexões por IP
// Conta só sockets que ENTRARAM em io.on('connection') (auth ok).
// Antes: incrementava no middleware de handshake → falha JWT / SW da extensão
// reiniciando deixava contador "fantasma" e estourava "Too many connections from this IP".
const socketConnections = new Map();
// Browser do agente + extensão Genesys + abas extras no mesmo 127.0.0.1
const SOCKET_MAX_CONNECTIONS_PER_IP = 24;
const SOCKET_RATE_LIMIT_WINDOW = 60000;
const socketMessageLimits = new Map();

const resolveSocketClientIp = (socket) => {
  const xf = socket?.handshake?.headers?.['x-forwarded-for'];
  if (xf) {
    const first = String(xf).split(',')[0].trim();
    if (first) return first;
  }
  return socket?.handshake?.address || socket?.conn?.remoteAddress || 'unknown';
};

io.use((socket, next) => {
  // Soft-check: só bloqueia se já houver sockets VIVOS demais.
  // NÃO incrementa aqui (evita leak em auth fail / handshake abortado).
  const clientIp = resolveSocketClientIp(socket);
  const currentConnections = socketConnections.get(clientIp) || 0;
  if (currentConnections >= SOCKET_MAX_CONNECTIONS_PER_IP) {
    return next(new Error('Too many connections from this IP'));
  }
  socket.clientIp = clientIp;
  next();
});

// Reject socket connections without valid JWT
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));
  try {
    const decoded = jwt.verify(token, JWT_SECRET_VALUE);
    if (!decoded?.userId || !adapter.db) return next(new Error('Invalid token'));
    const user = await adapter.db.collection('users')
      .findOne({ id: decoded.userId }, { projection: { tenantId: 1, role: 1, name: 1, username: 1 } });
    if (!user) return next(new Error('User not found'));
    socket.userId = decoded.userId;
    socket.tenantId = user.tenantId || null;
    socket.userRole = user.role || null;
    socket.userName = user.name || user.username || 'Agente';
    // Extensao Genesys: auth.client / auth.source = 'genesys-extension' | 'extension' | ...
    const clientKind = String(
      socket.handshake?.auth?.client
      || socket.handshake?.auth?.source
      || socket.handshake?.query?.client
      || 'app'
    ).trim().toLowerCase();
    socket.clientKind = clientKind;
    socket.isGenesysExtension = isExtensionSocket(socket);
    next();
  } catch (_) {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  const clientIp = socket.clientIp || resolveSocketClientIp(socket);
  socket.clientIp = clientIp;
  // Conta conexão autenticada de verdade
  socketConnections.set(clientIp, (socketConnections.get(clientIp) || 0) + 1);
  socket.on('disconnect', () => {
    const count = socketConnections.get(clientIp) || 1;
    if (count <= 1) socketConnections.delete(clientIp);
    else socketConnections.set(clientIp, count - 1);
  });

  // Join tenant room (user already authenticated by io.use middleware above)
  if (socket.tenantId) {
    socket.join(`tenant:${socket.tenantId}`);
  }
  if (socket.userId) {
    socket.join(`agent:${socket.userId}`);
    socket.join(`user:${socket.userId}`);
    // Room dedicada da extensao (fase 4: cmds app → extensao)
    if (socket.isGenesysExtension) {
      socket.join(extensionRoomForAgent(socket.userId));
      console.log(`[EXT] Extensao Genesys conectada agent=${socket.userId}`);
    }
  }
  if (socket.userRole === 'SUPER_ADMIN') {
    socket.join('role:SUPER_ADMIN');
  }

  socket.on('subscribe_tenant', (tenantId) => {
    const requestedTenantId = String(tenantId || '').trim();
    if (!requestedTenantId) return;

    if (socket.userRole === 'SUPER_ADMIN' || String(socket.tenantId || '') === requestedTenantId) {
      socket.join(`tenant:${requestedTenantId}`);
    }
  });

  // Genesys: ext:atendimento:* (in) + cmd:* (out) + cmd:resultado (ack)
  registerExtensionAtendimentoHandlers(socket);
  registerLocalDictationHandlers(socket);

  // Rate limiting por socket (extensao + app podem gerar mais eventos)
  socket.use((event, next) => {
    const now = Date.now();
    const key = `${clientIp}:${socket.id}`;
    const userMessages = socketMessageLimits.get(key) || { count: 0, resetTime: now + SOCKET_RATE_LIMIT_WINDOW };
    
    if (now > userMessages.resetTime) {
      userMessages.count = 0;
      userMessages.resetTime = now + SOCKET_RATE_LIMIT_WINDOW;
    }
    
    if (userMessages.count >= 300) {
      return next(new Error('Rate limit exceeded'));
    }
    
    userMessages.count++;
    socketMessageLimits.set(key, userMessages);
    next();
  });
  
  socket.on('error', (err) => {
    if (err.message !== 'Rate limit exceeded') {
      console.error('Socket error:', err.message);
    }
  });

  socket.on('disconnect', () => {
    if (socket.userId) {
      // Nao marca offline se ainda houver outra sessao (browser + extensao)
      const stillOnline = [...io.sockets.sockets.values()].some(
        (s) => s.id !== socket.id && s.userId === socket.userId
      );
      if (!stillOnline) {
        markOffline(socket.userId);
        adapter.updateOne(
          'users',
          { id: socket.userId },
          { $set: { status: 'offline', lastSeen: new Date().toISOString() } }
        ).catch(() => {});
        const statusTarget = socket.tenantId ? io.to(`tenant:${socket.tenantId}`) : io;
        statusTarget.emit('user_status', { userId: socket.userId, status: 'offline' });
      }
    }
    const rateKey = `${clientIp}:${socket.id}`;
    socketMessageLimits.delete(rateKey);
  });
});

setIo(io);

// Upload de midia em base64 precisa de payload maior que o tamanho real do arquivo.
app.use('/api/media/assets', express.json({ limit: MEDIA_JSON_LIMIT }));
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb', charset: 'utf-8' }));

app.use((req, res, next) => {
  const origJson = res.json.bind(res);
  res.json = (body) => {
    if (!res.getHeader('Content-Type')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    return origJson(body);
  };
  next();
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: NODE_ENV === 'development' ? 1000 : 200,
  skip: (req) => req.path === '/whatsapp/webhook' || req.path.startsWith('/load-test'),
  message: { error: "Limite de requisições excedido" }
});


app.use('/api/whatsapp/webhook', (req, res, next) => {
  try {
    console.log('[WHATSAPP] Webhook hit', {
      method: req.method,
      path: req.originalUrl || req.url,
      tenantId: req.query?.tenantId || null,
      hasSignature: Boolean(req.headers['x-hub-signature-256']),
      userAgent: req.headers['user-agent'] || null
    });
  } catch (error) {
    console.warn('[WHATSAPP] Falha ao registrar hit do webhook', error?.message || error);
  }
  next();
});

app.use('/api', apiLimiter);

app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  next();
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/tenant/current', authenticate, tenantCurrentHandler);

app.use('/api/auth', authRouter);
// superAdminIpCheck only restricts SUPER_ADMIN sessions; ADMIN/MANAGER/AGENT bypass it.
// Apply on routes that expose tenant-wide or cross-tenant admin actions.
app.use('/api/tenants', superAdminIpCheck, tenantsRouter);
app.use('/api/users', superAdminIpCheck, usersRouter);
if (flowsRouter) app.use('/api/flows', superAdminIpCheck, flowsRouter);
app.use('/api/variables', variablesRouter);
app.use('/api/templates', superAdminIpCheck, templatesRouter);
app.use('/api/schedules', schedulesRouter);
app.use('/api/queues', superAdminIpCheck, queuesRouter);
app.use('/api/tags', tagsRouter);
if (webhooksRouter) app.use('/api/webhooks', superAdminIpCheck, webhooksRouter);
app.use('/api/chats', chatsRouter);
app.use('/api/cannedResponses', cannedResponsesRouter);
app.use('/api/ai-memories', aiMemoriesRouter);
app.use('/api/logs', superAdminIpWhitelist, logsRouter);
if (superAdminRouter) app.use('/api/super-admin', superAdminIpWhitelist, superAdminRouter);
if (telegramRouter) app.use('/api/telegram', telegramRouter);
if (channelsRouter) app.use('/api/channels', superAdminIpCheck, channelsRouter);
if (whatsappRouter) app.use('/api/whatsapp', whatsappRouter);
app.use('/api/metrics', metricsRouter);
if (catalogRouter) app.use('/api/catalog', catalogRouter);
app.use('/api/media', mediaRouter);
app.use('/api/contacts', contactsRouter);
if (reportsRouter) app.use('/api/reports', reportsRouter);
if (analyticsRouter) app.use('/api/analytics', analyticsRouter);
app.use('/api/load-test', loadTestRouter);
app.use('/api/system', superAdminIpCheck, systemRouter);
app.use('/uploads', (req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  // Defense in depth: mesmo com a validação por magic bytes no upload, evita
  // que o navegador interprete um arquivo como tipo diferente do declarado e
  // bloqueia execução cross-origin de scripts ou plugins.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Não tipos inline (PDF/áudio/vídeo) — viraram download. Imagens continuam
  // exibíveis. Express.static define Content-Type por extensão; abaixo só
  // adicionamos Content-Disposition quando não for um tipo "inline-safe".
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; media-src 'self'; sandbox");
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  next();
}, express.static(uploadsRoot));

const clientDistPath = path.join(__dirname, 'client', 'dist');
app.use(express.static(clientDistPath));

// SPA local: rotas do React retornam o mesmo bundle, sem servidor Vite/HMR.
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) {
    return next();
  }
  const indexPath = path.join(clientDistPath, 'index.html');
  if (!fs.existsSync(indexPath)) return next();
  return res.sendFile(indexPath);
});

// Global error handler — hide internal details in production
app.use((err, req, res, _next) => {
  console.error('[UNHANDLED]', err);
  const status = err.status || err.statusCode || 500;
  if (NODE_ENV === 'production' && status >= 500) {
    return res.status(status).json({ error: 'Erro interno do servidor' });
  }
  res.status(status).json({ error: err.message || 'Erro interno do servidor' });
});

httpServer.listen(PORT, '127.0.0.1', () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
  const shouldWarmDictation = !['0', 'false', 'no', 'off'].includes(
    String(process.env.TRANSCRIPTION_WARMUP_ON_START || 'true').trim().toLowerCase()
  );
  if (COMPANION_MODE && shouldWarmDictation) {
    warmLocalTranscription()
      .then((result) => console.log(`[TRANSCRICAO] Ditado local preparado (${result.model}).`))
      .catch((error) => console.warn(`[TRANSCRICAO] Aquecimento adiado: ${error?.message || error}`));
  }
  if (!COMPANION_MODE && process.env.TELEGRAM_USE_POLLING === 'true') {
    console.log('✅ Telegram polling ativo');
    startTelegramPolling();
  }
});

const shutdown = async (signal) => {
  console.log(`[SHUTDOWN] Recebido ${signal}, encerrando Redis/BullMQ`);
  await closeBullMqWorkers();
  await closeQueues();
  await closeRedis();
  process.exit(0);
};

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

export default app;
