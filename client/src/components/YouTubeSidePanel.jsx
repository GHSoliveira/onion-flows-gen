import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ExternalLink, Save, Trash2, X, Youtube } from 'lucide-react';
import {
  getPlaybackSafetySnapshot,
  subscribePlaybackSafety,
} from '../services/playbackSafety';
import { normalizeYouTubeContent } from '../utils/youtubePlayer';

const youtubeStorageKey = (userId) => `onionYoutubeContent:${userId || 'anon'}`;

const readSavedContent = (userId) => {
  try {
    return normalizeYouTubeContent(localStorage.getItem(youtubeStorageKey(userId)) || '');
  } catch {
    return null;
  }
};

const useLocalAudioActivity = () => {
  const [activeAudioCount, setActiveAudioCount] = useState(0);

  useEffect(() => {
    const playing = new Set();
    const sync = () => setActiveAudioCount(playing.size);
    const isAudio = (target) => target instanceof HTMLAudioElement;
    const markPlaying = (event) => {
      if (!isAudio(event.target)) return;
      playing.add(event.target);
      sync();
    };
    const markStopped = (event) => {
      if (!isAudio(event.target)) return;
      playing.delete(event.target);
      sync();
    };

    document.addEventListener('play', markPlaying, true);
    ['pause', 'ended', 'emptied', 'abort', 'error'].forEach((name) => {
      document.addEventListener(name, markStopped, true);
    });

    return () => {
      document.removeEventListener('play', markPlaying, true);
      ['pause', 'ended', 'emptied', 'abort', 'error'].forEach((name) => {
        document.removeEventListener(name, markStopped, true);
      });
      playing.clear();
    };
  }, []);

  return activeAudioCount;
};

const YouTubeSidePanel = ({ userId, open, onClose }) => {
  const safety = useSyncExternalStore(
    subscribePlaybackSafety,
    getPlaybackSafetySnapshot,
    getPlaybackSafetySnapshot,
  );
  const localAudioCount = useLocalAudioActivity();
  const iframeRef = useRef(null);
  const [content, setContent] = useState(() => readSavedContent(userId));
  const [draftUrl, setDraftUrl] = useState(() => readSavedContent(userId)?.canonicalUrl || '');
  const [error, setError] = useState('');
  const [playerKey, setPlayerKey] = useState(0);

  useEffect(() => {
    const saved = readSavedContent(userId);
    setContent(saved);
    setDraftUrl(saved?.canonicalUrl || '');
    setError('');
  }, [userId]);

  const safetyReason = useMemo(() => {
    if (Number(safety.activeCallCount || 0) > 0) return 'ligação em andamento';
    if (localAudioCount > 0) return 'áudio da conversa em reprodução';
    return '';
  }, [localAudioCount, safety.activeCallCount]);

  const sendPlayerCommand = useCallback((func, args = []) => {
    iframeRef.current?.contentWindow?.postMessage(JSON.stringify({
      event: 'command',
      func,
      args,
    }), 'https://www.youtube-nocookie.com');
  }, []);

  const pausePlayer = useCallback(() => sendPlayerCommand('pauseVideo'), [sendPlayerCommand]);

  useEffect(() => {
    if (!open || safetyReason) pausePlayer();
  }, [open, pausePlayer, safetyReason]);

  const embedUrl = useMemo(() => {
    if (!content?.embedUrl) return '';
    const url = new URL(content.embedUrl);
    url.searchParams.set('enablejsapi', '1');
    url.searchParams.set('playsinline', '1');
    url.searchParams.set('rel', '0');
    url.searchParams.set('origin', window.location.origin);
    return url.toString();
  }, [content]);

  const saveContent = (event) => {
    event.preventDefault();
    const normalized = normalizeYouTubeContent(draftUrl);
    if (!normalized) {
      setError('Cole um link válido de vídeo ou playlist do YouTube.');
      return;
    }
    try {
      localStorage.setItem(youtubeStorageKey(userId), normalized.canonicalUrl);
    } catch {
      setError('O navegador não permitiu salvar este player.');
      return;
    }
    setContent(normalized);
    setDraftUrl(normalized.canonicalUrl);
    setPlayerKey((value) => value + 1);
    setError('');
  };

  const clearContent = () => {
    pausePlayer();
    try {
      localStorage.removeItem(youtubeStorageKey(userId));
    } catch {
      // A remoção local é opcional; o estado visual ainda deve ser limpo.
    }
    setContent(null);
    setDraftUrl('');
    setError('');
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-slate-900">
      <div className="flex items-center justify-between gap-3 border-b border-red-100 px-3.5 py-3 dark:border-red-950/60">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600 dark:bg-red-950/35 dark:text-red-300">
            <Youtube size={18} />
          </span>
          <div className="min-w-0">
            <div className="text-xs font-bold text-slate-900 dark:text-white">YouTube</div>
            <div className="truncate text-[9px] text-slate-400">Player local · sem conta Google</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {content?.canonicalUrl ? (
            <a href={content.canonicalUrl} target="_blank" rel="noreferrer" className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white" title="Abrir no YouTube" aria-label="Abrir no YouTube">
              <ExternalLink size={14} />
            </a>
          ) : null}
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white" title="Fechar YouTube" aria-label="Fechar YouTube">
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 custom-scrollbar">
        {safetyReason ? (
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] font-semibold leading-4 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200">
            Player pausado: {safetyReason}. A retomada é manual.
          </div>
        ) : null}

        {embedUrl ? (
          <div className="overflow-hidden rounded-2xl bg-black shadow-sm ring-1 ring-black/10 dark:ring-white/10">
            <iframe
              key={`${embedUrl}:${playerKey}`}
              ref={iframeRef}
              src={embedUrl}
              title="Player do YouTube"
              className="aspect-video w-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
              onLoad={() => { if (safetyReason || !open) window.setTimeout(pausePlayer, 150); }}
            />
          </div>
        ) : (
          <div className="flex aspect-video flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 text-center dark:border-slate-700 dark:bg-slate-800/60">
            <Youtube size={30} className="text-red-500" />
            <div className="mt-2 text-xs font-bold text-slate-700 dark:text-slate-200">Cole um vídeo ou playlist</div>
            <div className="mt-1 text-[9px] leading-4 text-slate-400">O conteúdo fica salvo somente neste navegador.</div>
          </div>
        )}

        <form onSubmit={saveContent} className="mt-3">
          <label htmlFor="onion-youtube-url" className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Link do YouTube</label>
          <div className="mt-1.5 flex items-center gap-1.5">
            <input
              id="onion-youtube-url"
              type="url"
              value={draftUrl}
              onChange={(event) => { setDraftUrl(event.target.value); setError(''); }}
              placeholder="https://youtube.com/watch?v=..."
              className="h-9 min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-[10px] text-slate-800 outline-none transition focus:border-red-300 focus:ring-2 focus:ring-red-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-red-800 dark:focus:ring-red-950/40"
            />
            <button type="submit" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-600 text-white transition hover:bg-red-700" title="Carregar no player" aria-label="Carregar YouTube">
              <Save size={14} />
            </button>
            {content ? (
              <button type="button" onClick={clearContent} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30" title="Remover conteúdo" aria-label="Remover conteúdo do YouTube">
                <Trash2 size={14} />
              </button>
            ) : null}
          </div>
          {error ? <div className="mt-2 text-[10px] font-medium text-red-600 dark:text-red-300">{error}</div> : null}
        </form>

        <p className="mt-3 text-[9px] leading-4 text-slate-400">
          Vídeo, Shorts, transmissão ou playlist. O modo de privacidade aprimorada evita carregar cookies do YouTube antes da reprodução.
        </p>
      </div>
    </div>
  );
};

export default YouTubeSidePanel;
