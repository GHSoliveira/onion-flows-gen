(() => {
  'use strict';

  const COMMAND = 'onion:spotify:bridge:command';
  const EVENT = 'onion:spotify:bridge:event';
  const host = document.getElementById('spotify-embed');
  const status = document.getElementById('spotify-bridge-status');
  if (status) status.textContent = 'script-loaded';
  let iframeApi = null;
  let controller = null;
  let requestedUrl = '';

  const emit = (event, data = null) => {
    if (status) status.textContent = event;
    window.parent.postMessage({ type: EVENT, event, data }, '*');
  };

  const validSpotifyUrl = (value) => {
    try {
      const parsed = new URL(String(value || ''));
      if (parsed.protocol !== 'https:' || parsed.hostname !== 'open.spotify.com') return '';
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (!['playlist', 'album', 'track', 'show', 'episode'].includes(parts[0])) return '';
      if (!/^[A-Za-z0-9]+$/.test(parts[1] || '')) return '';
      return `https://open.spotify.com/${parts[0]}/${parts[1]}`;
    } catch {
      return '';
    }
  };

  const attachControllerEvents = () => {
    controller.addListener('ready', () => emit('ready'));
    controller.addListener('playback_started', (event) => {
      emit('playback-started', event?.data || null);
    });
    controller.addListener('playback_update', (event) => {
      emit('playback-update', event?.data || null);
    });
  };

  const loadRequestedEntity = () => {
    if (!iframeApi || !requestedUrl) return;
    if (controller) {
      controller.loadEntity(requestedUrl);
      emit('controller-created');
      return;
    }
    iframeApi.createController(host, {
      url: requestedUrl,
      width: '100%',
      height: 152,
    }, (nextController) => {
      controller = nextController;
      attachControllerEvents();
      emit('controller-created');
    });
  };

  window.onSpotifyIframeApiReady = (api) => {
    iframeApi = api;
    loadRequestedEntity();
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || event.data?.type !== COMMAND) return;
    const action = String(event.data.action || '');
    if (action === 'load') {
      const nextUrl = validSpotifyUrl(event.data.value);
      if (!nextUrl) {
        emit('error', { code: 'spotify_url_invalida' });
        return;
      }
      requestedUrl = nextUrl;
      loadRequestedEntity();
      return;
    }
    if (!controller) return;
    if (action === 'pause') controller.pause();
    if (action === 'resume') controller.resume();
    if (action === 'restart') controller.restart();
    if (action === 'seek') controller.seek(Math.max(0, Number(event.data.value) || 0));
    if (action === 'destroy') {
      controller.destroy();
      controller = null;
    }
  });

  window.addEventListener('error', (event) => {
    const source = String(event?.target?.src || '');
    if (source.includes('spotify')) emit('error', { code: 'spotify_script_bloqueado' });
  }, true);

  window.addEventListener('unhandledrejection', () => {
    emit('error', { code: 'spotify_controller_rejeitado' });
  });

  requestedUrl = validSpotifyUrl(new URLSearchParams(window.location.search).get('url'));
})();
