#!/usr/bin/env node
/**
 * Simulador de ligação Genesys — NÃO TOCA NO GENESYS.
 *
 * Fala só com o Onion local (127.0.0.1), fingindo ser a extensão coletora:
 * autentica como agente, entra na room da extensão e emite
 * `ext:atendimento:ligacao`. Serve para ver o card de voz e o cronômetro
 * funcionando antes de a extensão de verdade saber emitir voz.
 *
 * Não usa socket.io-client (não instalado): fala o protocolo Engine.IO/Socket.IO
 * direto pelo WebSocket nativo do Node 20+. Zero dependência nova.
 *
 * Uso:
 *   node scripts/simular-ligacao-genesys.js
 *   node scripts/simular-ligacao-genesys.js --nome="Maria Silva" --ani=5511987654321
 *   node scripts/simular-ligacao-genesys.js --abandonar   (testa o card "sem sinal")
 *
 * Ctrl+C encerra a ligação no Onion (estado `disconnected`) e sai.
 * Com --abandonar, sai sem avisar: o watcher deve marcar o card como stale.
 */

const args = new Map(
  process.argv.slice(2)
    .filter((arg) => arg.startsWith('--'))
    .map((arg) => {
      const [key, ...rest] = arg.slice(2).split('=');
      return [key, rest.length ? rest.join('=') : 'true'];
    })
);

const BASE_URL = args.get('url') || 'http://127.0.0.1:3101';
const USERNAME = args.get('user') || 'agent';
const PASSWORD = args.get('pass') || 'sandbox123';
const NOME = args.get('nome') || 'Cliente Simulado';
const ANI = args.get('ani') || '5511999998888';
const ABANDONAR = args.get('abandonar') === 'true';
// --encerrar=<convId> fecha um card deixado para trás por uma simulação anterior.
const ENCERRAR = args.get('encerrar');
const CONV_ID = ENCERRAR && ENCERRAR !== 'true' ? ENCERRAR : (args.get('convId') || crypto.randomUUID());
const SYNC_GENERATION = crypto.randomUUID();
// Renova antes do TTL de 45s do servidor, senão o card vira stale sozinho.
const KEEPALIVE_MS = 20000;
const TTL_MS = 45000;

const log = (...parts) => console.log('[SIM]', ...parts);

const login = async () => {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD })
  });
  if (!response.ok) {
    throw new Error(`login falhou (${response.status}) — confira --user/--pass`);
  }
  const body = await response.json();
  if (!body?.token) throw new Error('login sem token na resposta');
  return body.token;
};

/** Cliente Socket.IO mínimo: só o necessário para emitir com ack. */
const connect = (token) => new Promise((resolve, reject) => {
  const wsUrl = `${BASE_URL.replace(/^http/, 'ws')}/socket.io/?EIO=4&transport=websocket`;
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let ackId = 0;
  let pingTimer = null;

  const send = (frame) => ws.send(frame);

  const emit = (event, payload) => new Promise((resolveAck) => {
    const id = ackId += 1;
    pending.set(id, resolveAck);
    send(`42${id}${JSON.stringify([event, payload])}`);
    // Ack perdido não pode travar o simulador.
    setTimeout(() => {
      if (pending.delete(id)) resolveAck({ ok: false, error: 'ack_timeout' });
    }, 15000);
  });

  ws.addEventListener('error', (event) => reject(new Error(event?.message || 'erro no websocket')));
  ws.addEventListener('close', () => {
    if (pingTimer) clearInterval(pingTimer);
  });

  // Fechar o socket e chamar process.exit() no mesmo tick dispara assertion do
  // libuv no Windows: o handle ainda está fechando. Sai no tick seguinte.
  const closeAndExit = (code = 0) => {
    if (pingTimer) clearInterval(pingTimer);
    try { ws.close(); } catch (_) { /* já fechado */ }
    setTimeout(() => process.exit(code), 200);
  };

  ws.addEventListener('message', (event) => {
    const data = String(event.data || '');
    // 0 = open (handshake), 2 = ping, 40 = connected, 43 = ack, 42 = evento
    if (data.startsWith('0')) {
      const handshake = JSON.parse(data.slice(1));
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = setInterval(() => send('2'), Number(handshake.pingInterval) || 25000);
      // Auth do Socket.IO v4 viaja no pacote CONNECT.
      send(`40${JSON.stringify({ token, client: 'genesys-extension' })}`);
      return;
    }
    if (data === '2') { send('3'); return; }
    if (data.startsWith('40')) {
      log('socket conectado como extensão');
      resolve({ emit, closeAndExit });
      return;
    }
    if (data.startsWith('44')) {
      reject(new Error(`recusado no handshake: ${data.slice(2)}`));
      return;
    }
    if (data.startsWith('43')) {
      const match = data.match(/^43(\d+)(.*)$/);
      if (!match) return;
      const resolveAck = pending.get(Number(match[1]));
      if (!resolveAck) return;
      pending.delete(Number(match[1]));
      try {
        resolveAck(JSON.parse(match[2])[0]);
      } catch (_) {
        resolveAck({ ok: false, error: 'ack_ilegivel' });
      }
    }
  });
});

const main = async () => {
  log(`Onion: ${BASE_URL}`);
  log(`convId: ${CONV_ID}`);

  const token = await login();
  log(`autenticado como ${USERNAME}`);

  const socket = await connect(token);
  await socket.emit('ext:register', { client: 'genesys-extension' });

  let seq = 0;
  const conectadoEm = Date.now();

  // Limpeza de card órfão: sem syncGeneration o servidor não trata como
  // sessão antiga, e o seq alto vence a sequência já gravada.
  if (ENCERRAR) {
    const ack = await socket.emit('ext:atendimento:ligacao', {
      convId: CONV_ID,
      seq: 9999,
      estado: 'disconnected',
      desde: Date.now(),
      motivo: 'simulacao_encerrada'
    });
    log('encerrar →', JSON.stringify(ack));
    socket.closeAndExit(ack?.ok === false ? 1 : 0);
    return;
  }

  const enviarEstado = async (estado, extra = {}) => {
    seq += 1;
    const ack = await socket.emit('ext:atendimento:ligacao', {
      convId: CONV_ID,
      syncGeneration: SYNC_GENERATION,
      seq,
      estado,
      desde: Date.now(),
      conectadoEm,
      expiraEm: Date.now() + TTL_MS,
      direcao: 'inbound',
      ani: ANI,
      cliente: { nome: NOME, nomeWhatsapp: NOME, telefone: ANI },
      ...extra
    });
    log(`${estado} (seq ${seq}) →`, JSON.stringify(ack));
    return ack;
  };

  // O cliente cai já conectado: não existe fase de "chamando".
  const primeiro = await enviarEstado('connected');
  if (primeiro?.ok === false) {
    log('o servidor recusou o evento — nada foi criado.');
    socket.closeAndExit(1);
  }

  log('');
  log('Card deve estar visível no workspace do agente, em âmbar, com som.');
  log('Clique no botão verde: o som para e o card fica verde, sem sair.');
  log(ABANDONAR
    ? 'Modo --abandonar: encerrando SEM avisar. O watcher deve marcar "sem sinal".'
    : 'Ctrl+C encerra a ligação no Onion.');
  log('');

  if (ABANDONAR) {
    socket.closeAndExit(0);
  }

  const keepalive = setInterval(() => {
    enviarEstado('connected').catch((error) => log('keepalive falhou:', error.message));
  }, KEEPALIVE_MS);

  let encerrando = false;
  process.on('SIGINT', async () => {
    if (encerrando) return;
    encerrando = true;
    clearInterval(keepalive);
    log('encerrando ligação...');
    await enviarEstado('disconnected').catch(() => {});
    socket.closeAndExit(0);
  });
};

main().catch((error) => {
  console.error('[SIM] falhou:', error.message);
  process.exit(1);
});
