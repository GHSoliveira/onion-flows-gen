/**
 * Aviso sonoro de ligação tocando.
 *
 * A ligação acontece inteiramente no Genesys, em segundo plano — o Onion é só a
 * superfície que avisa. Por isso o som não pode ser a única pista: o Chrome
 * bloqueia áudio até a página receber um gesto do usuário, então uma aba
 * recém-aberta tocaria mudo justamente no primeiro toque.
 *
 * Duas defesas:
 *  - destrava o AudioContext no primeiro gesto do agente (qualquer clique/tecla);
 *  - `isBlocked()` deixa a interface mostrar aviso visual quando o som não pôde sair.
 *
 * Usa oscilador do Web Audio em vez de arquivo: não precisa de asset, funciona
 * offline e não depende de decodificação.
 */

const RING_ON_MS = 1000;
const RING_GAP_MS = 3000;
const RING_FREQ_HZ = 620;
const RING_VOLUME = 0.12;

let audioContext = null;
let ringTimer = null;
let ringing = false;
let blocked = false;
let unlockBound = false;
const listeners = new Set();

const notify = () => {
  for (const listener of listeners) {
    try { listener({ ringing, blocked }); } catch (_) { /* listener não derruba o ringer */ }
  }
};

const ensureContext = () => {
  if (audioContext) return audioContext;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  try {
    audioContext = new Ctor();
  } catch (_) {
    audioContext = null;
  }
  return audioContext;
};

/** Um bipe curto. Silencioso (não lança) se o contexto estiver suspenso. */
const playBeep = () => {
  const context = ensureContext();
  if (!context) {
    blocked = true;
    notify();
    return;
  }
  if (context.state === 'suspended') {
    // Autoplay ainda bloqueado: tenta retomar, mas avisa a interface.
    context.resume().catch(() => {});
    if (context.state === 'suspended') {
      if (!blocked) { blocked = true; notify(); }
      return;
    }
  }
  if (blocked) { blocked = false; notify(); }
  try {
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(RING_FREQ_HZ, now);
    // Envelope evita o clique seco do corte abrupto.
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(RING_VOLUME, now + 0.05);
    gain.gain.linearRampToValueAtTime(0, now + RING_ON_MS / 1000);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + RING_ON_MS / 1000 + 0.05);
  } catch (_) {
    // Falha de um bipe não interrompe o ciclo: o próximo tenta de novo.
  }
};

const scheduleNextRing = () => {
  ringTimer = setTimeout(() => {
    if (!ringing) return;
    playBeep();
    scheduleNextRing();
  }, RING_ON_MS + RING_GAP_MS);
};

/**
 * Destrava o áudio no primeiro gesto do agente. Chame uma vez na montagem:
 * sem isso, o primeiro toque de ligação pode sair mudo.
 */
export const bindRingerUnlock = () => {
  if (unlockBound || typeof window === 'undefined') return;
  unlockBound = true;
  const unlock = () => {
    const context = ensureContext();
    if (context?.state === 'suspended') context.resume().catch(() => {});
    if (context && context.state !== 'suspended' && blocked) {
      blocked = false;
      notify();
    }
  };
  for (const event of ['pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(event, unlock, { passive: true });
  }
};

export const startRinging = () => {
  if (ringing) return;
  ringing = true;
  notify();
  playBeep();
  scheduleNextRing();
};

export const stopRinging = () => {
  if (ringTimer) { clearTimeout(ringTimer); ringTimer = null; }
  if (!ringing) return;
  ringing = false;
  notify();
};

export const isRingerBlocked = () => blocked;

export const subscribeRinger = (listener) => {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  listener({ ringing, blocked });
  return () => listeners.delete(listener);
};
