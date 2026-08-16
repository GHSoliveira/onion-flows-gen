import { useState, useSyncExternalStore } from 'react';
import { LogIn, LogOut, Music2 } from 'lucide-react';
import {
  disconnectSpotify,
  getSpotifyAuthSnapshot,
  startSpotifyAuthorization,
  subscribeSpotifyAuth,
} from '../services/spotifyAuth';

const SpotifyAccountSettings = ({ compact = false }) => {
  const auth = useSyncExternalStore(subscribeSpotifyAuth, getSpotifyAuthSnapshot, getSpotifyAuthSnapshot);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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
          </span>
          <button type="button" onClick={disconnectSpotify} className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30" title="Desconectar Spotify" aria-label="Desconectar Spotify"><LogOut size={14} /></button>
        </div>
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
    </section>
  );
};

export default SpotifyAccountSettings;
