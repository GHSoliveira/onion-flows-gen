import { useState, useSyncExternalStore } from 'react';
import { Check, ChevronDown, Copy, ExternalLink, LogIn, LogOut, Music2, RotateCcw, Save, Settings2 } from 'lucide-react';
import {
  configureSpotifyClientId,
  disconnectSpotify,
  getSpotifyAuthSnapshot,
  hasCustomSpotifyClientId,
  isValidSpotifyClientId,
  spotifyAuthConfig,
  startSpotifyAuthorization,
  subscribeSpotifyAuth,
  useDefaultSpotifyClientId,
} from '../services/spotifyAuth';

const CopyValue = ({ label, value, onCopied }) => (
  <div className="rounded-xl border border-slate-200 bg-white/80 p-2 dark:border-slate-700 dark:bg-slate-950/45">
    <span className="block text-[8px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
    <div className="mt-1 flex items-center gap-2">
      <code className="min-w-0 flex-1 select-all break-all text-[9px] font-semibold text-slate-700 dark:text-slate-200">{value}</code>
      <button
        type="button"
        onClick={() => navigator.clipboard.writeText(value).then(() => onCopied(label)).catch(() => {})}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white"
        title={`Copiar ${label}`}
        aria-label={`Copiar ${label}`}
      >
        <Copy size={12} />
      </button>
    </div>
  </div>
);

const SpotifyAccountSettings = ({ compact = false }) => {
  const auth = useSyncExternalStore(subscribeSpotifyAuth, getSpotifyAuthSnapshot, getSpotifyAuthSnapshot);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [setupOpen, setSetupOpen] = useState(false);
  const [clientId, setClientId] = useState(() => spotifyAuthConfig.clientId);
  const [copied, setCopied] = useState('');

  const markCopied = (label) => {
    setCopied(label);
    window.setTimeout(() => setCopied(''), 1600);
  };

  const saveAndConnect = async () => {
    setError('');
    if (!isValidSpotifyClientId(clientId)) {
      setError('O Client ID deve ter exatamente 32 letras ou números. Não cole o Client Secret.');
      return;
    }
    setBusy(true);
    try {
      configureSpotifyClientId(clientId);
      await startSpotifyAuthorization('/agent');
    } catch (connectError) {
      setBusy(false);
      setError(connectError?.message === 'spotify_exige_127_0_0_1_3101'
        ? 'Abra o Onion em http://127.0.0.1:3101 para conectar.'
        : 'Não foi possível iniciar o login. Confira o Client ID e a Redirect URI.');
    }
  };

  const restoreDefault = () => {
    const nextClientId = useDefaultSpotifyClientId();
    setClientId(nextClientId);
    setError('');
  };

  const connect = async () => {
    setBusy(true);
    setError('');
    try {
      await startSpotifyAuthorization('/agent');
    } catch (connectError) {
      setBusy(false);
      setError(connectError?.message === 'spotify_exige_127_0_0_1_3101'
        ? 'Abra o Onion em http://127.0.0.1:3101 para conectar.'
        : 'Não foi possível iniciar o login do Spotify.');
    }
  };

  const setup = (
    <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white/70 dark:border-slate-700 dark:bg-slate-950/30" data-spotify-setup-assistant>
      <button
        type="button"
        onClick={() => setSetupOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[9px] font-bold text-slate-600 transition hover:bg-slate-100/80 dark:text-slate-300 dark:hover:bg-slate-800/60"
        aria-expanded={setupOpen}
      >
        <Settings2 size={12} className="text-[#1DB954]" />
        <span className="flex-1">Configurar aplicativo próprio</span>
        {hasCustomSpotifyClientId() ? <span className="rounded-full bg-[#1DB954]/12 px-1.5 py-0.5 text-[7px] uppercase tracking-wide text-[#159447]">próprio</span> : null}
        <ChevronDown size={12} className={`transition-transform ${setupOpen ? 'rotate-180' : ''}`} />
      </button>
      {setupOpen ? (
        <div className="space-y-2 border-t border-slate-200 p-3 dark:border-slate-700">
          <div className="flex items-start gap-2 rounded-xl bg-[#1DB954]/7 p-2.5 text-[9px] leading-4 text-slate-600 dark:text-slate-300">
            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#1DB954] text-white"><Check size={10} /></span>
            <span>Crie um app gratuito no Spotify. Marque <strong>Web API</strong> e <strong>Web Playback SDK</strong>. O Onion nunca pede o Client Secret.</span>
          </div>

          <a
            href={spotifyAuthConfig.dashboardUrl}
            target="_blank"
            rel="noreferrer"
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-xl bg-slate-900 text-[9px] font-bold text-white transition hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
          >
            <ExternalLink size={12} /> Abrir Dashboard e criar app
          </a>

          <div className="grid gap-2 sm:grid-cols-2">
            <CopyValue label="Website" value={spotifyAuthConfig.websiteUrl} onCopied={markCopied} />
            <CopyValue label="Redirect URI" value={spotifyAuthConfig.redirectUri} onCopied={markCopied} />
          </div>
          {copied ? <p className="text-center text-[8px] font-semibold text-[#159447]">{copied} copiado.</p> : null}

          <label className="block">
            <span className="mb-1 block text-[8px] font-bold uppercase tracking-wider text-slate-400">Client ID do aplicativo</span>
            <input
              type="text"
              inputMode="text"
              autoComplete="off"
              spellCheck="false"
              maxLength={32}
              value={clientId}
              onChange={(event) => setClientId(event.target.value.replace(/\s+/g, ''))}
              placeholder="Cole os 32 caracteres do Client ID"
              className={`h-9 w-full rounded-xl border bg-white px-3 font-mono text-[10px] outline-none transition dark:bg-slate-900 ${clientId && !isValidSpotifyClientId(clientId) ? 'border-red-400 focus:border-red-500' : 'border-slate-200 focus:border-[#1DB954] dark:border-slate-700'}`}
            />
          </label>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={saveAndConnect}
              disabled={busy || !isValidSpotifyClientId(clientId)}
              className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#1DB954] px-3 text-[9px] font-bold text-white transition hover:bg-[#18a64a] disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Save size={12} /> {busy ? 'Abrindo Spotify...' : 'Salvar e conectar'}
            </button>
            {hasCustomSpotifyClientId() ? (
              <button type="button" onClick={restoreDefault} disabled={busy} className="flex h-8 items-center justify-center gap-1.5 rounded-xl px-2.5 text-[8px] font-bold text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white" title="Voltar ao aplicativo padrão">
                <RotateCcw size={11} /> Padrão
              </button>
            ) : null}
          </div>
          <p className="text-[8px] leading-3 text-slate-400">O Client ID fica salvo somente neste navegador. Trocar de aplicativo desconecta a sessão Spotify anterior.</p>
        </div>
      ) : null}
    </div>
  );

  if (auth.connected) {
    return (
      <section className={`${compact ? 'p-2.5' : 'p-3'} rounded-2xl border border-[#1DB954]/25 bg-[#1DB954]/5`} data-spotify-account-settings>
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#1DB954] text-white">
            {auth.profile?.image ? <img src={auth.profile.image} alt="" className="h-full w-full object-cover" /> : <Music2 size={17} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-bold text-slate-800 dark:text-slate-100">Spotify conectado</span>
            <span className="block truncate text-[9px] text-slate-500 dark:text-slate-400">{auth.profile?.name || 'Conta Spotify'}{auth.profile?.product ? ` · ${auth.profile.product}` : ''}</span>
            {auth.profile?.accessWarning ? <span className="mt-0.5 block text-[8px] leading-3 text-amber-600 dark:text-amber-300">Perfil limitado; validando diretamente pelo player.</span> : null}
          </span>
          <button type="button" onClick={disconnectSpotify} className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30" title="Desconectar Spotify" aria-label="Desconectar Spotify"><LogOut size={14} /></button>
        </div>
        {setup}
      </section>
    );
  }

  return (
    <section className={`${compact ? 'p-2.5' : 'p-3'} rounded-2xl border border-slate-200 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-800/45`} data-spotify-account-settings>
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#1DB954]/15 text-[#1DB954]"><Music2 size={17} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-bold text-slate-800 dark:text-slate-100">Spotify Premium</span>
          <span className="block text-[9px] leading-4 text-slate-400">Conecte para ouvir músicas completas e controlar o volume.</span>
        </span>
        <button type="button" onClick={connect} disabled={busy} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl bg-[#1DB954] px-3 text-[9px] font-bold text-white hover:bg-[#18a64a] disabled:opacity-60"><LogIn size={13} />{busy ? 'Abrindo...' : 'Conectar'}</button>
      </div>
      {error ? <p className="mt-2 text-[9px] font-medium text-red-500">{error}</p> : null}
      {setup}
    </section>
  );
};

export default SpotifyAccountSettings;
