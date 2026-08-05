import path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const companionMode = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.COMPANION_MODE || '').trim().toLowerCase()
);
const localAppData = String(process.env.LOCALAPPDATA || '').trim();
export const uploadsRoot = companionMode && localAppData
  ? path.resolve(localAppData, 'Onion', 'runtime', 'media')
  : path.resolve(__dirname, '../../uploads');
const DEFAULT_TRANSIENT_MEDIA_TTL_MS = 15 * 60 * 1000;
const TRANSIENT_MEDIA_TTL_MS = Math.max(
  2 * 60 * 1000,
  Number.parseInt(process.env.TRANSIENT_MEDIA_TTL_MS || `${DEFAULT_TRANSIENT_MEDIA_TTL_MS}`, 10)
);
const mediaDeletionTimers = new Map();

export const scheduleTransientMediaDeletion = (filePath, ttlMs = TRANSIENT_MEDIA_TTL_MS) => {
  const resolved = path.resolve(filePath);
  const root = path.resolve(uploadsRoot);
  if (!(resolved === root || resolved.startsWith(`${root}${path.sep}`))) return;
  const previous = mediaDeletionTimers.get(resolved);
  if (previous) clearTimeout(previous);
  const timer = setTimeout(() => {
    mediaDeletionTimers.delete(resolved);
    fs.unlink(resolved).catch(() => {});
  }, Math.max(1_000, Number(ttlMs) || TRANSIENT_MEDIA_TTL_MS));
  timer.unref?.();
  mediaDeletionTimers.set(resolved, timer);
};

const sanitizeFilename = (name) => String(name || 'arquivo')
  .replace(/[^\p{L}\p{N}._-]/gu, '_')
  .slice(0, 120);

const normalizeMimeType = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .split(';')[0]
  .trim();

const getExtension = (filename, mimeType) => {
  const ext = path.extname(filename || '').toLowerCase();
  if (ext) return ext;
  const normalizedMime = normalizeMimeType(mimeType);
  const map = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/aac': '.aac',
    'audio/ogg': '.ogg',
    'audio/opus': '.opus',
    'application/pdf': '.pdf'
  };
  return map[normalizedMime] || '';
};

export const storeTenantMediaBuffer = async ({
  tenantId,
  buffer,
  mimeType = '',
  originalName = 'arquivo',
  prefix = 'media'
}) => {
  if (!tenantId) {
    throw new Error('tenantId obrigatorio para armazenar midia');
  }
  if (!buffer || !buffer.length) {
    throw new Error('buffer obrigatorio para armazenar midia');
  }

  const safeOriginalName = sanitizeFilename(originalName);
  const extension = getExtension(safeOriginalName, mimeType);
  const fileName = `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}${extension}`;
  const tenantDir = path.join(uploadsRoot, tenantId);
  const filePath = path.join(tenantDir, fileName);

  await fs.mkdir(tenantDir, { recursive: true });
  await fs.writeFile(filePath, buffer);
  if (companionMode) scheduleTransientMediaDeletion(filePath);

  return {
    fileName,
    originalName: safeOriginalName,
    mimeType: normalizeMimeType(mimeType) || null,
    size: buffer.length,
    url: `/uploads/${encodeURIComponent(tenantId)}/${encodeURIComponent(fileName)}`
  };
};
