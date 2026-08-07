import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { authenticate } from '../middleware/auth.js';
import { authorize } from '../middleware/authorization.js';
import { getRedisStatus, isBullMqEnabled, isRedisEnabled } from '../services/redisClient.js';
import { getQueuesMetrics } from '../queues/index.js';

const router = express.Router();
const companionMode = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.COMPANION_MODE || '').trim().toLowerCase()
);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const localUpdaterPath = path.join(repositoryRoot, 'ATUALIZAR.bat');
const localUpdateStatusPath = path.join(repositoryRoot, 'sandbox', 'update-status.txt');
const LOCAL_UPDATE_COOLDOWN_MS = 15000;
let lastLocalUpdateAt = 0;

const isLoopbackRequest = (req) => {
  const remote = String(req.socket?.remoteAddress || '');
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote);
};

const requireLocalCompanion = (req, res, next) => {
  if (!companionMode) return res.status(404).json({ error: 'comando_disponivel_somente_no_companion_local' });
  if (!isLoopbackRequest(req)) return res.status(403).json({ error: 'comando_permitido_somente_no_computador_local' });
  return next();
};

const readLocalUpdateStatus = () => {
  try {
    const [state = 'idle', requestId = '', thirdValue = '', fourthValue = ''] = fs
      .readFileSync(localUpdateStatusPath, 'utf8')
      .trim()
      .split('|');
    return {
      state,
      requestId,
      fromVersion: state === 'success' ? thirdValue || null : null,
      toVersion: state === 'success' ? fourthValue || null : null,
      error: state === 'failed' ? thirdValue || 'update_failed' : null,
    };
  } catch {
    return { state: 'idle', requestId: '', fromVersion: null, toVersion: null, error: null };
  }
};

router.get(
  '/local-update/status',
  authenticate,
  authorize(['AGENT', 'ADMIN', 'MANAGER', 'SUPER_ADMIN']),
  requireLocalCompanion,
  (_req, res) => res.json(readLocalUpdateStatus())
);

router.post(
  '/local-update',
  authenticate,
  authorize(['AGENT', 'ADMIN', 'MANAGER', 'SUPER_ADMIN']),
  requireLocalCompanion,
  (req, res) => {
    if (process.platform !== 'win32' || !fs.existsSync(localUpdaterPath)) {
      return res.status(503).json({ error: 'atualizador_local_nao_encontrado' });
    }
    const now = Date.now();
    if (now - lastLocalUpdateAt < LOCAL_UPDATE_COOLDOWN_MS) {
      return res.status(429).json({ error: 'atualizacao_ja_solicitada' });
    }
    lastLocalUpdateAt = now;
    const requestId = crypto.randomUUID();
    fs.mkdirSync(path.dirname(localUpdateStatusPath), { recursive: true });
    fs.writeFileSync(localUpdateStatusPath, `running|${requestId}`, 'utf8');
    res.status(202).json({ ok: true, accepted: true, requestId });

    setTimeout(() => {
      const command = `call "${localUpdaterPath}" --auto ${requestId}`;
      const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', command], {
        cwd: repositoryRoot,
        detached: true,
        windowsHide: true,
        stdio: 'ignore',
      });
      child.once('error', () => {
        try { fs.writeFileSync(localUpdateStatusPath, `failed|${requestId}|spawn_failed`, 'utf8'); } catch {}
      });
      child.unref();
    }, 350);
    return undefined;
  }
);

router.get('/queues', authenticate, authorize(['ADMIN', 'SUPER_ADMIN']), async (_req, res) => {
  try {
    const queues = await getQueuesMetrics();
    res.json({
      redis: getRedisStatus(),
      flags: {
        redisEnabled: isRedisEnabled(),
        bullMqEnabled: isBullMqEnabled()
      },
      queues
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Falha ao consultar filas' });
  }
});

export default router;
