import { useEffect, useState } from 'react';
import { Loader2, Music2 } from 'lucide-react';
import { completeSpotifyAuthorization } from '../services/spotifyAuth';

const describeCallbackError = (error) => {
  const message = String(error?.message || 'spotify_callback_falhou');
  if (message.startsWith('spotify_profile_403_allowlist')) {
    return 'O Spotify emitiu o token, mas bloqueou esta conta no perfil. Confirme se o e-mail desta conta está em User Management no app de Client ID c9f477…cceab e conecte novamente com essa mesma conta.';
  }
  if (message.startsWith('spotify_profile_401')) {
    return 'O Spotify recusou o token ao consultar o perfil. Volte ao Onion e conecte a conta novamente.';
  }
  return message;
};

const SpotifyCallback = () => {
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    completeSpotifyAuthorization()
      .then((returnTo) => {
        if (active) window.location.replace(`${returnTo}?spotify=connected`);
      })
      .catch((callbackError) => {
        if (active) setError(describeCallbackError(callbackError));
      });
    return () => { active = false; };
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
      <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-slate-900 p-6 text-center shadow-2xl">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#1DB954]/15 text-[#1DB954]"><Music2 size={24} /></span>
        <h1 className="mt-4 text-lg font-bold">Conectando Spotify</h1>
        {error ? (
          <>
            <p className="mt-2 text-xs leading-5 text-red-300">Não foi possível concluir: {error}</p>
            <a href="/agent" className="mt-5 inline-flex rounded-xl bg-white px-4 py-2 text-xs font-bold text-slate-900">Voltar ao Onion</a>
          </>
        ) : (
          <div className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-400"><Loader2 size={15} className="animate-spin" />Validando sua conta...</div>
        )}
      </div>
    </div>
  );
};

export default SpotifyCallback;
