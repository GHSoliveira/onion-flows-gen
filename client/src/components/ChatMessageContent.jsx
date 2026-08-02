import { useEffect, useRef, useState } from 'react';
import {
  Check, ExternalLink, FileText, List, MousePointerClick, Pause, Play, PlayCircle, Volume2, VolumeX
} from 'lucide-react';
import { API_BASE } from '../services/api';
import { findInteractiveSelection, parseInteractiveMessage } from '../utils/interactiveMessage';

const BACKEND_ORIGIN = String(API_BASE || '').replace(/\/api\/?$/i, '');

const resolveMediaUrl = (value) => {
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
  if (mime === 'document' || mime === 'file' || mime === 'application' || mime.startsWith('application/')) return 'document';
  return null;
};

const inferTypeByUrl = (value) => {
  const url = String(value || '').trim().toLowerCase();
  if (!url) return null;
  if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/.test(url)) return 'image';
  if (/\.(mp4|webm|mov|m4v)(\?.*)?$/.test(url)) return 'video';
  if (/\.(mp3|ogg|oga|wav|m4a|aac|opus|weba)(\?.*)?$/.test(url)) return 'audio';
  return null;
};

const inferTypeByFileName = (value) => {
  const fileName = String(value || '').trim().toLowerCase();
  if (!fileName) return null;
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(fileName)) return 'image';
  if (/\.(mp4|webm|mov|m4v)$/.test(fileName)) return 'video';
  if (/\.(mp3|ogg|wav|m4a|aac|opus|oga|weba)$/.test(fileName)) return 'audio';
  return null;
};

const looksLikeFileName = (value) => (
  /^[^\\/:*?"<>|]+\.[a-z0-9]{2,8}$/i.test(String(value || '').trim())
);

const inferTypeByKindLike = (value) => {
  const kind = String(value || '').trim().toLowerCase();
  if (!kind) return null;
  if (kind === 'image' || kind === 'photo' || kind === 'sticker' || kind.includes('image') || kind.includes('photo')) return 'image';
  if (kind === 'video' || kind.includes('video') || kind === 'animation' || kind === 'gif') return 'video';
  if (kind === 'audio' || kind === 'voice' || kind === 'ptt' || kind.includes('audio') || kind.includes('voice')) return 'audio';
  if (kind === 'document' || kind === 'file' || kind.includes('document') || kind.includes('file')) return 'document';
  return inferTypeByMime(kind);
};

const extractFirstUrl = (value) => {
  const source = String(value || '').trim();
  if (!source) return '';
  const match = source.match(/(https?:\/\/[^\s]+|\/uploads\/[^\s]+)/i);
  return match ? match[1] : '';
};

const extractFileNameFromUrl = (value) => {
  const url = String(value || '').trim();
  if (!url) return null;
  const cleanUrl = url.split('?')[0].split('#')[0];
  const parts = cleanUrl.split('/');
  const lastPart = parts[parts.length - 1] || '';
  if (!lastPart || !/\.[a-z0-9]{2,8}$/i.test(lastPart)) return null;
  try {
    return decodeURIComponent(lastPart);
  } catch {
    return lastPart;
  }
};

const inferTypeByToken = (value) => {
  const source = String(value || '').trim().toLowerCase();
  if (!source) return null;
  if (source.startsWith('[image]')) return 'image';
  if (source.startsWith('[video]')) return 'video';
  if (source.startsWith('[audio]') || source.startsWith('[voice]')) return 'audio';
  if (source.startsWith('[document]')) return 'document';
  return null;
};

const normalizeMediaPayload = (message) => {
  const mediaSource = message?.media ?? message?.attachment ?? null;
  let media = {};
  if (mediaSource && typeof mediaSource === 'object') {
    media = mediaSource;
  } else if (typeof mediaSource === 'string') {
    try {
      const parsed = JSON.parse(mediaSource);
      if (parsed && typeof parsed === 'object') {
        media = parsed;
      }
    } catch {
      const rawValue = String(mediaSource || '').trim();
      media = /^(https?:\/\/|\/uploads\/)/i.test(rawValue)
        ? { url: rawValue }
        : {};
    }
  }

  const textValue = String(message?.text || '').trim();
  const mediaUrl = (
    media.url
    || media.mediaUrl
    || (typeof message?.media === 'string' ? String(message.media || '').trim() : '')
    || (typeof message?.attachment === 'string' ? String(message.attachment || '').trim() : '')
    || message?.mediaUrl
    || message?.url
    || message?.fileUrl
    || message?.path
    || message?.filePath
    || message?.storagePath
    || message?.meta?.mediaUrl
    || message?.meta?.url
    || message?.meta?.fileUrl
    || message?.meta?.path
    || message?.meta?.filePath
    || message?.meta?.storagePath
    || message?.attachmentUrl
    || extractFirstUrl(textValue)
  );
  if (!mediaUrl) return null;

  const mimeType = (
    media.mimeType
    || media.mime_type
    || media.mimetype
    || message?.mimeType
    || message?.mime_type
    || message?.meta?.mimeType
    || message?.meta?.mime_type
    || message?.meta?.mimetype
    || ''
  );
  const fileName = (
    media.fileName
    || media.filename
    || media.file_name
    || message?.fileName
    || message?.file_name
    || message?.meta?.fileName
    || message?.meta?.file_name
    || extractFileNameFromUrl(mediaUrl)
    || (looksLikeFileName(textValue) ? textValue : null)
    || null
  );
  const directKind = String(
    media.type
    || media.kind
    || media.mediaType
    || media.media_type
    || message?.attachment?.mediaType
    || message?.attachment?.type
    || message?.mediaType
    || message?.media_type
    || message?.mediaKind
    || message?.media_kind
    || message?.messageType
    || message?.message_type
    || message?.kind
    || message?.type
    || ''
  ).trim().toLowerCase();
  const normalizedKind = inferTypeByKindLike(directKind);
  const tokenType = inferTypeByToken(message?.text);
  const inferredType =
    tokenType
    || inferTypeByMime(mimeType)
    || inferTypeByFileName(fileName)
    || inferTypeByUrl(mediaUrl)
    || inferTypeByKindLike(message?.attachment?.type);

  let type = normalizedKind || inferredType || 'document';
  if (type === 'document' && inferredType && inferredType !== 'document') {
    type = inferredType;
  }

  return {
    url: String(mediaUrl),
    type,
    caption: media.caption || message?.caption || message?.meta?.caption || '',
    fileName,
    mimeType: mimeType || null
  };
};

const formatAudioTime = (value) => {
  const seconds = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

const CompactAudioPlayer = ({ url, mimeType, fileName, onOpen }) => {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.load();
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setFailed(false);
  }, [url, mimeType]);

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio || failed) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    try {
      await audio.play();
    } catch {
      setFailed(true);
    }
  };

  const seek = (event) => {
    const audio = audioRef.current;
    if (!audio) return;
    const nextTime = Number(event.target.value || 0);
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const toggleMute = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setMuted(audio.muted);
  };

  const progress = duration > 0
    ? Math.min(100, Math.max(0, (currentTime / duration) * 100))
    : 0;

  return (
    <div className="compact-audio-player" title={fileName || 'Áudio'}>
      <audio
        ref={audioRef}
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(Number(event.currentTarget.duration || 0))}
        onDurationChange={(event) => setDuration(Number(event.currentTarget.duration || 0))}
        onTimeUpdate={(event) => setCurrentTime(Number(event.currentTarget.currentTime || 0))}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => setFailed(true)}
      >
        {mimeType ? <source src={url} type={mimeType} /> : null}
        <source src={url} />
      </audio>

      <button
        type="button"
        onClick={togglePlayback}
        disabled={failed}
        className="compact-audio-play"
        aria-label={playing ? 'Pausar áudio' : 'Reproduzir áudio'}
        title={failed ? 'Não foi possível reproduzir este áudio' : (playing ? 'Pausar' : 'Reproduzir')}
      >
        {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center justify-between gap-2 text-[9px] font-semibold">
          <span className="truncate opacity-75">{failed ? 'Áudio indisponível' : 'Áudio'}</span>
          <span className="shrink-0 tabular-nums opacity-65">
            {formatAudioTime(currentTime)} / {formatAudioTime(duration)}
          </span>
        </div>
        <input
          type="range"
          min="0"
          max={duration || 0}
          step="0.05"
          value={Math.min(currentTime, duration || 0)}
          onChange={seek}
          disabled={failed || !duration}
          className="compact-audio-range"
          style={{ '--audio-progress': `${progress}%` }}
          aria-label="Posição do áudio"
        />
      </div>

      <button
        type="button"
        onClick={toggleMute}
        className="compact-audio-action"
        aria-label={muted ? 'Ativar som' : 'Silenciar'}
        title={muted ? 'Ativar som' : 'Silenciar'}
      >
        {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
      </button>

      {typeof onOpen === 'function' ? (
        <button
          type="button"
          onClick={onOpen}
          className="compact-audio-action"
          aria-label="Abrir no player"
          title="Abrir no player"
        >
          <ExternalLink size={12} />
        </button>
      ) : null}
    </div>
  );
};

const renderMedia = (mediaPayload, { onOpen } = {}) => {
  if (!mediaPayload?.url) return null;
  const url = resolveMediaUrl(mediaPayload.url);
  const type = String(mediaPayload.type || 'document').toLowerCase();
  const open = (e) => {
    if (typeof onOpen === 'function') {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      onOpen(mediaPayload);
    }
  };

  if (type === 'image') {
    return (
      <button
        type="button"
        onClick={open}
        className="group relative block max-w-full cursor-zoom-in text-left"
        title="Abrir no player"
      >
        <img
          src={url}
          alt={mediaPayload.fileName || 'Imagem recebida'}
          className="max-h-72 w-auto rounded-xl border border-black/10 object-cover transition group-hover:brightness-95"
          loading="lazy"
        />
        <span className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white opacity-0 transition group-hover:opacity-100">
          Ampliar
        </span>
      </button>
    );
  }

  if (type === 'video') {
    return (
      <div className="relative max-w-full">
        <video
          controls
          preload="metadata"
          className="max-h-72 w-full rounded-xl border border-black/10 bg-black"
          src={url}
          onClick={(e) => e.stopPropagation()}
        />
        {typeof onOpen === 'function' ? (
          <button
            type="button"
            onClick={open}
            className="mt-1 text-xs font-semibold underline opacity-80 hover:opacity-100"
          >
            Abrir no player
          </button>
        ) : null}
      </div>
    );
  }

  if (type === 'audio') {
    const rawMimeType = String(mediaPayload.mimeType || '').toLowerCase().split(';')[0].trim();
    const safeMimeType = rawMimeType === 'application/ogg'
      ? 'audio/ogg'
      : rawMimeType.startsWith('audio/')
        ? mediaPayload.mimeType
        : String(mediaPayload.fileName || mediaPayload.url || '').toLowerCase().split(/[?#]/)[0].endsWith('.oga')
          ? 'audio/ogg'
          : undefined;
    return (
      <div className="max-w-full">
        <CompactAudioPlayer
          url={url}
          mimeType={safeMimeType}
          fileName={mediaPayload.fileName}
          onOpen={typeof onOpen === 'function' ? open : undefined}
        />
        {typeof onOpen !== 'function' ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex text-[9px] font-semibold opacity-60 hover:opacity-100"
          >
            Abrir áudio
          </a>
        ) : null}
      </div>
    );
  }

  if (typeof onOpen === 'function') {
    return (
      <button
        type="button"
        onClick={open}
        className="flex w-full items-center gap-3 rounded-xl border border-black/10 bg-black/5 px-3 py-3 text-left transition-colors hover:bg-black/10"
      >
        <FileText size={18} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{mediaPayload.fileName || 'Documento'}</div>
          <div className="text-xs opacity-70">{mediaPayload.mimeType || 'Arquivo'}</div>
        </div>
        <PlayCircle size={16} className="shrink-0 opacity-70" />
      </button>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-3 rounded-xl border border-black/10 bg-black/5 px-3 py-3 transition-colors hover:bg-black/10"
    >
      <FileText size={18} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{mediaPayload.fileName || 'Documento'}</div>
        <div className="text-xs opacity-70">{mediaPayload.mimeType || 'Arquivo'}</div>
      </div>
      <PlayCircle size={16} className="shrink-0 opacity-70" />
    </a>
  );
};

const InteractiveMessageCard = ({ interactive, selectedOption }) => {
  const isButtons = interactive.kind === 'BUTTONS';

  return (
    <div className="w-[min(320px,70vw)] max-w-full overflow-hidden rounded-xl border border-slate-200/90 bg-white text-slate-800 shadow-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">
      <div className="border-b border-slate-100 bg-gradient-to-br from-blue-50 to-cyan-50 px-3 py-2.5 dark:border-slate-700 dark:from-blue-950/50 dark:to-cyan-950/30">
        <div className="mb-1.5 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-blue-600 dark:text-blue-300">
          {isButtons ? <MousePointerClick size={12} /> : <List size={12} />}
          {isButtons ? 'Botões interativos' : 'Lista interativa'}
        </div>
        <div className="text-[12px] font-semibold leading-5">{interactive.body || interactive.modal}</div>
      </div>

      <div className="px-2.5 py-2.5">
        <div className="mb-2 flex items-center justify-between gap-2 px-0.5">
          <span className="truncate text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{isButtons ? 'Escolha uma opção' : interactive.modal}</span>
          {selectedOption ? <span className="shrink-0 text-[9px] font-semibold text-emerald-600 dark:text-emerald-300">Respondido</span> : null}
        </div>

        {isButtons ? (
          <div className={`grid gap-1.5 ${interactive.buttons.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {interactive.buttons.map((button) => {
              const selected = selectedOption?.sectionId === 'buttons' && selectedOption?.id === button.id;
              return (
                <div
                  key={button.id}
                  className={`flex min-h-9 items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-center text-[11px] font-bold transition-colors ${selected
                    ? 'border-emerald-400 bg-emerald-500 text-white ring-1 ring-emerald-300/60 dark:border-emerald-400 dark:bg-emerald-600 dark:ring-emerald-600/30'
                    : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300'}`}
                >
                  {selected ? <Check size={13} strokeWidth={3} /> : null}
                  <span className="truncate">{button.title || button.id}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-2.5">
            {interactive.sections.map((section) => (
              <div key={section.id}>
                {section.title ? <div className="mb-1 px-1 text-[9px] font-semibold uppercase tracking-wide text-slate-400">{section.title}</div> : null}
                <div className="space-y-1">
                  {section.rows.map((row, rowIndex) => {
                    const selected = selectedOption?.sectionId === section.id && selectedOption?.id === row.id;
                    return (
                      <div
                        key={`${section.id}_${row.id}`}
                        className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 transition-colors ${selected
                          ? 'border-emerald-400 bg-emerald-50 text-emerald-900 ring-1 ring-emerald-300/60 dark:border-emerald-500/70 dark:bg-emerald-950/40 dark:text-emerald-100 dark:ring-emerald-600/30'
                          : 'border-slate-200 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-800/70'}`}
                      >
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${selected
                          ? 'bg-emerald-500 text-white'
                          : 'bg-white text-slate-400 ring-1 ring-slate-200 dark:bg-slate-700 dark:ring-slate-600'}`}
                        >
                          {selected ? <Check size={12} strokeWidth={3} /> : rowIndex + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[11px] font-semibold leading-4">{row.title || row.id}</span>
                          {row.description ? <span className="mt-0.5 block text-[9px] leading-3 opacity-65">{row.description}</span> : null}
                        </span>
                        {selected ? <span className="shrink-0 text-[8px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-300">Escolhida</span> : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const ChatMessageContent = ({ message, messages, messageIndex, onOpenMedia }) => {
  const media = normalizeMediaPayload(message);
  const caption = String(media?.caption || '').trim();
  const text = String(message?.text || '').trim();
  const interactive = parseInteractiveMessage(text);
  const selectedOption = interactive
    ? findInteractiveSelection(interactive, messages, messageIndex)
    : null;
  const mediaUrlInText = media ? extractFirstUrl(text) : '';
  const textLooksLikeMediaToken = /^\[(image|video|audio|document)\]/i.test(text);
  const textLooksLikeMediaUrl = /^https?:\/\/\S+$/i.test(text) || /^\/uploads\/\S+/i.test(text);
  const textLooksLikeBareFileName = Boolean(media?.fileName) && text.toLowerCase() === String(media.fileName || '').trim().toLowerCase();
  const showText = !media
    || Boolean(caption)
    || (
      !textLooksLikeMediaToken
      && !textLooksLikeMediaUrl
      && !textLooksLikeBareFileName
      && (!mediaUrlInText || !text.includes(mediaUrlInText))
    );

  const handleOpen = typeof onOpenMedia === 'function'
    ? () => onOpenMedia(message, media)
    : undefined;

  if (interactive) {
    return <InteractiveMessageCard interactive={interactive} selectedOption={selectedOption} />;
  }

  return (
    <div className="space-y-2">
      {media && renderMedia(media, { onOpen: handleOpen })}
      {showText && <div className="whitespace-pre-wrap break-words">{text || '-'}</div>}
    </div>
  );
};

export { normalizeMediaPayload, resolveMediaUrl };
export default ChatMessageContent;
