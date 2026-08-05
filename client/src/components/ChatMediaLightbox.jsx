import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Maximize2,
  Minimize2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { API_BASE } from '../services/api';

const BACKEND_ORIGIN = String(API_BASE || '').replace(/\/api\/?$/i, '');

export const resolveMediaUrl = (value) => {
  const source = String(value || '').trim();
  if (!source) return '';
  if (/^data:/i.test(source)) return source;
  if (/^https?:\/\//i.test(source)) return source;
  const base = source.startsWith('/uploads/')
    ? (BACKEND_ORIGIN || API_BASE)
    : API_BASE;
  return `${base}${source.startsWith('/') ? source : `/${source}`}`;
};

const inferTypeByMime = (value) => {
  const mime = String(value || '').trim().toLowerCase();
  if (!mime) return null;
  if (mime === 'image' || mime.startsWith('image/')) return 'image';
  if (mime === 'video' || mime.startsWith('video/')) return 'video';
  if (mime === 'audio' || mime.startsWith('audio/') || mime === 'application/ogg') return 'audio';
  if (mime.startsWith('application/') || mime === 'document' || mime === 'file') return 'document';
  return null;
};

const inferTypeByUrl = (value) => {
  const url = String(value || '').trim().toLowerCase();
  if (!url) return null;
  if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/.test(url)) return 'image';
  if (/\.(mp4|webm|mov|m4v)(\?.*)?$/.test(url)) return 'video';
  if (/\.(mp3|ogg|oga|wav|m4a|aac|opus|weba)(\?.*)?$/.test(url)) return 'audio';
  if (/\.(pdf|docx?|xlsx?|zip|rar)(\?.*)?$/.test(url)) return 'document';
  return null;
};

const extractFileNameFromUrl = (value) => {
  const url = String(value || '').trim();
  if (!url) return null;
  let pathname = url;
  try {
    pathname = new URL(url, 'http://localhost').pathname;
  } catch {
    pathname = url.split('?')[0].split('#')[0];
  }
  const lastPart = pathname.split('/').pop() || '';
  if (!lastPart || !/\.[a-z0-9]{2,8}$/i.test(lastPart)) return null;
  try {
    return decodeURIComponent(lastPart);
  } catch {
    return lastPart;
  }
};

/** Normaliza payload de mídia de uma mensagem (espelha ChatMessageContent). */
export const normalizeMediaPayload = (message) => {
  const mediaSource = message?.media ?? message?.attachment ?? null;
  let media = {};
  if (mediaSource && typeof mediaSource === 'object') {
    media = mediaSource;
  } else if (typeof mediaSource === 'string') {
    try {
      const parsed = JSON.parse(mediaSource);
      if (parsed && typeof parsed === 'object') media = parsed;
    } catch {
      const raw = String(mediaSource || '').trim();
      if (/^(https?:\/\/|\/uploads\/)/i.test(raw)) media = { url: raw };
    }
  }

  const url = (
    media.url
    || media.mediaUrl
    || message?.mediaUrl
    || message?.fileUrl
    || message?.meta?.mediaUrl
    || message?.attachmentUrl
    || null
  );
  if (!url) return null;

  const mimeType = media.mimeType || media.mime_type || media.mimetype
    || message?.mimeType || message?.meta?.mimeType || '';
  const fileName = media.fileName || media.filename || media.file_name
    || message?.fileName || message?.meta?.fileName
    || extractFileNameFromUrl(url) || null;
  const rawType = String(
    media.type || media.kind || media.mediaType || message?.mediaType || ''
  ).toLowerCase();

  let type = 'document';
  if (rawType.includes('image') || rawType === 'photo' || rawType === 'sticker') type = 'image';
  else if (rawType.includes('video')) type = 'video';
  else if (rawType.includes('audio') || rawType === 'voice' || rawType === 'ptt') type = 'audio';
  else if (rawType.includes('document') || rawType === 'file') type = 'document';
  else {
    type = inferTypeByMime(mimeType)
      || inferTypeByUrl(fileName)
      || inferTypeByUrl(url)
      || 'document';
  }

  return {
    url: String(url),
    resolvedUrl: resolveMediaUrl(url),
    type,
    caption: media.caption || message?.caption || message?.meta?.caption || '',
    fileName,
    mimeType: mimeType || null,
    messageId: message?.id || message?.messageId || null,
    timestamp: message?.timestamp || message?.createdAt || null,
    sender: message?.sender || null,
  };
};

/** Lista mídias da conversa (ordem cronológica). */
export const collectMediaFromMessages = (messages = []) => {
  const list = Array.isArray(messages) ? messages : [];
  const out = [];
  for (const message of list) {
    const media = normalizeMediaPayload(message);
    if (!media?.resolvedUrl) continue;
    out.push(media);
  }
  return out;
};

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.25;

/**
 * Player embutido: zoom (imagem), fullscreen, setas entre mídias da conversa.
 */
const ChatMediaLightbox = ({
  open,
  items = [],
  index = 0,
  onClose,
  onIndexChange,
}) => {
  const rootRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);
  const [isFs, setIsFs] = useState(false);

  const safeItems = useMemo(
    () => (Array.isArray(items) ? items.filter((i) => i?.resolvedUrl || i?.url) : []),
    [items]
  );
  const safeIndex = Math.min(Math.max(0, Number(index) || 0), Math.max(0, safeItems.length - 1));
  const current = safeItems[safeIndex] || null;
  const type = String(current?.type || 'document').toLowerCase();
  const url = current?.resolvedUrl || resolveMediaUrl(current?.url);

  const resetView = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    resetView();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, safeIndex, resetView]);

  useEffect(() => {
    if (!open) return undefined;
    const onFs = () => setIsFs(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, [open]);

  const go = useCallback((delta) => {
    if (!safeItems.length || typeof onIndexChange !== 'function') return;
    const next = (safeIndex + delta + safeItems.length) % safeItems.length;
    onIndexChange(next);
  }, [onIndexChange, safeIndex, safeItems.length]);

  const zoomBy = useCallback((delta) => {
    setZoom((z) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number((z + delta).toFixed(2))));
      if (next <= 1) setOffset({ x: 0, y: 0 });
      return next;
    });
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await (rootRef.current || document.documentElement).requestFullscreen?.();
      } else {
        await document.exitFullscreen?.();
      }
    } catch (_) {
      // ignore — browser pode bloquear
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (document.fullscreenElement) {
          document.exitFullscreen?.().catch(() => {});
        } else {
          onClose?.();
        }
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        go(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        go(1);
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoomBy(ZOOM_STEP);
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoomBy(-ZOOM_STEP);
      } else if (e.key === '0') {
        e.preventDefault();
        resetView();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, go, onClose, zoomBy, resetView, toggleFullscreen]);

  const onWheel = (e) => {
    if (type !== 'image') return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
  };

  const onPointerDown = (e) => {
    if (type !== 'image' || zoom <= 1) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      ox: offset.x,
      oy: offset.y,
    };
  };

  const onPointerMove = (e) => {
    if (!dragRef.current) return;
    const d = dragRef.current;
    setOffset({
      x: d.ox + (e.clientX - d.x),
      y: d.oy + (e.clientY - d.y),
    });
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  if (!open || !current || !url) return null;

  const title = current.fileName
    || current.caption
    || (type === 'image' ? 'Imagem' : type === 'video' ? 'Vídeo' : type === 'audio' ? 'Áudio' : 'Arquivo');

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[80] flex flex-col bg-slate-950/95 text-white backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Visualizador de mídia"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2 sm:px-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{title}</div>
          <div className="text-[11px] text-white/50">
            {safeItems.length > 1 ? `${safeIndex + 1} / ${safeItems.length}` : '1 mídia'}
            {' · '}
            Esc fecha · ← → navega · +/- zoom · F tela cheia
          </div>
        </div>

        {type === 'image' ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => zoomBy(-ZOOM_STEP)}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 hover:bg-white/20"
              title="Diminuir zoom (-)"
            >
              <ZoomOut size={18} />
            </button>
            <button
              type="button"
              onClick={resetView}
              className="min-w-[3.25rem] rounded-xl bg-white/10 px-2 py-2 text-xs font-semibold hover:bg-white/20"
              title="Resetar zoom (0)"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={() => zoomBy(ZOOM_STEP)}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 hover:bg-white/20"
              title="Aumentar zoom (+)"
            >
              <ZoomIn size={18} />
            </button>
          </div>
        ) : null}

        <a
          href={url}
          download={current.fileName || true}
          target="_blank"
          rel="noreferrer"
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 hover:bg-white/20"
          title="Baixar / abrir original"
          onClick={(e) => e.stopPropagation()}
        >
          <Download size={18} />
        </a>
        <button
          type="button"
          onClick={toggleFullscreen}
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 hover:bg-white/20"
          title="Tela cheia (F)"
        >
          {isFs ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 hover:bg-white/20"
          title="Fechar (Esc)"
        >
          <X size={18} />
        </button>
      </div>

      {/* Stage */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {safeItems.length > 1 ? (
          <>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); go(-1); }}
              className="absolute left-2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white shadow-lg ring-1 ring-white/20 hover:bg-black/70 sm:left-4"
              title="Anterior (←)"
            >
              <ChevronLeft size={26} />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); go(1); }}
              className="absolute right-2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white shadow-lg ring-1 ring-white/20 hover:bg-black/70 sm:right-4"
              title="Próxima (→)"
            >
              <ChevronRight size={26} />
            </button>
          </>
        ) : null}

        <div
          className="flex h-full w-full items-center justify-center overflow-hidden p-4 sm:p-8"
          onWheel={onWheel}
          onClick={(e) => e.stopPropagation()}
        >
          {type === 'image' ? (
            <img
              src={url}
              alt={title}
              draggable={false}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              className="max-h-full max-w-full select-none object-contain transition-transform duration-75 will-change-transform"
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                cursor: zoom > 1 ? 'grab' : 'default',
              }}
            />
          ) : type === 'video' ? (
            <video
              key={url}
              src={url}
              controls
              autoPlay
              className="max-h-full max-w-full rounded-xl bg-black shadow-2xl"
            />
          ) : type === 'audio' ? (
            <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-white/5 p-6">
              <div className="mb-3 text-sm font-semibold text-white/80">{title}</div>
              <audio key={url} src={url} controls autoPlay className="w-full" />
            </div>
          ) : (
            <div className="flex max-w-md flex-col items-center gap-4 rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
              <FileText size={40} className="text-white/60" />
              <div>
                <div className="font-semibold">{title}</div>
                <div className="mt-1 text-xs text-white/50">{current.mimeType || 'Documento'}</div>
              </div>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500"
              >
                Abrir arquivo
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Filmstrip thumbs (só imagens + contagem) */}
      {safeItems.length > 1 ? (
        <div className="flex shrink-0 gap-2 overflow-x-auto border-t border-white/10 px-3 py-2 scrollbar-hide">
          {safeItems.map((item, i) => {
            const thumbUrl = item.resolvedUrl || resolveMediaUrl(item.url);
            const t = String(item.type || '').toLowerCase();
            const active = i === safeIndex;
            return (
              <button
                key={`${item.messageId || i}-${thumbUrl}`}
                type="button"
                onClick={() => onIndexChange?.(i)}
                className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-lg ring-2 transition ${
                  active ? 'ring-blue-400' : 'ring-transparent opacity-70 hover:opacity-100'
                }`}
                title={item.fileName || `#${i + 1}`}
              >
                {t === 'image' ? (
                  <img src={thumbUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-white/10 text-[10px] font-bold uppercase">
                    {t === 'video' ? 'VID' : t === 'audio' ? 'AUD' : 'DOC'}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

export default ChatMediaLightbox;
