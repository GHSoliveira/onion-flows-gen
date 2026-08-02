# Genesys ⇄ OnionFlows — contrato da extensão coletora (v1)

**Escopo:** agent-side · socket.io · eventos delta (B) · sem canais/multi-tenant · sem PII em disco
**Status:** contrato fechado

Como a extensão do Genesys alimenta a tela do agente no app local: autenticação por
agente, eventos delta e o ciclo de vida do atendimento — incluindo o encerramento por
inatividade do próprio Genesys.

```
Genesys ──▶ Extensão (coletor) ──▶ App local
(conversa,     (resolve IXC,          (atendimento na
 mensagens,     traduz eventos,        tela do agente
 encerramento)  autentica agente)      certo)
```

---

## 01 · Transporte & autenticação

- **Extensão = cliente socket.io** — roda no background, conecta no servidor local do app.
- **Login 1x pela extensão** — o agente digita usuário/senha do app no popup; a extensão
  guarda o JWT (renovável) e reusa. Sem senha embutida no código.
- **O JWT identifica o agente** — o app roteia cada atendimento pra tela do agente dono do
  token. Uma conta por agente.

```
// 1. login uma vez (popup da extensão)
POST /api/auth/login  { user, pass }   → { token }

// 2. conecta o socket já autenticado
socket = io("ws://127.0.0.1:PORTA", {
  auth: { token }
})   // app valida o JWT no handshake
```

---

## 02 · Eventos delta · extensão → app

Chave de tudo: **`convId`** (o conversationId do Genesys). Prefixo `ext:atendimento:*`.

**`ext:atendimento:upsert`** — cria OU atualiza (idempotente por convId)
```json
{
  "convId": "…",                // 🔑 chave — 1 atendimento por conversa
  "canal": "genesys",
  "status": "open",
  "cliente": { "nome": "…", "cpf": "…", "endereco": "…", "telefone": "…", "ativo": true, "filial": "104" },
  "abertoEm": 0                 // ts (epoch ms) — cliente pode vir parcial e completar depois
}
```

**`ext:atendimento:backfill`** — histórico, 1x na criação
```json
{ "convId": "…", "mensagens": [ { "id": "…", "sender": "user", "text": "…", "ts": 0 } ] }
```

**`ext:atendimento:mensagem`** — 1 mensagem nova (delta, tempo real)
```json
{
  "convId": "…",
  "mensagem": { "id": "…", "sender": "user | agent | bot", "text": "…", "ts": 0 }
}
// id = messageId do Genesys → dedup
```

**`ext:atendimento:cliente`** — CPF/dados resolveram depois do atendimento já existir
```json
{ "convId": "…", "cliente": { "cpf": "…", "nome": "…" } }
```

**`ext:atendimento:encerrar`**
```json
{ "convId": "…", "motivo": "genesys_inatividade | genesys_agente | manual" }
```

---

## 03 · Sinal do Genesys → evento emitido

A extensão escuta o **Notifications WS do Genesys** e traduz cada sinal:

| Sinal no Genesys | Extensão emite |
|---|---|
| Conversa nova / cliente resolvido | `upsert` + `backfill` |
| Mensagem nova (inbound / outbound) | `mensagem` |
| CPF resolveu depois (via IXC) | `cliente` |
| Conversa **desconecta/termina** — inclui a **auto-inatividade do próprio Genesys** | `encerrar` |

> **Encerramento por inatividade:** quando o próprio Genesys encerra por inatividade, isso
> chega como o **mesmo** sinal de "conversa desconectou" → a extensão detecta e emite
> `encerrar`. O app entende porque recebe o evento — não fica com atendimento fantasma aberto.

> **Encerrar pelo app — fica pra Fase 4:** encerrar **no Genesys** já funciona no v1 (extensão
> detecta → `encerrar`). Encerrar **clicando no app** exige o caminho de volta (app → extensão),
> que entra junto com "enviar mensagem" na fase bidirecional.

---

## 04 · Idempotência, dedup & reconexão

- **1 atendimento por `convId`** — re-enviar o mesmo `upsert` atualiza, não duplica.
- **Mensagem deduplicada por `id`** — o messageId do Genesys evita repetição.
- **Reconnect do socket** — a extensão re-emite `upsert` + `backfill` de todas as conversas
  ativas; o dedup cobre a repetição. Nada se perde.

---

## 05 · Estado da extensão & privacidade

```
convId → { chatCriado, msgIdsEnviados: Set, clienteEnviado, status }   // em memória
```

- **Tudo em memória** — cria 1x, faz append das novas, completa o cliente quando o IXC
  resolve, fecha no fim.
- **Zero PII em disco** — o coletor só repassa; o app é in-memory. Casa com a política de
  retenção enxuta.

---

## 06 · O que o app implementa

Lado do app — reusa o que já existe (`appendChatMessage`, emit de socket, jsonwebtoken).

- **Login + validação do JWT** no handshake do socket.
- **Upsert por `convId`** em `activeChats` — gravar o convId no doc e achar por ele.
- **Append idempotente** por `mensagem.id`.
- **Handlers** dos 5 eventos `ext:atendimento:*`.
- ✅ **Fase 4** comandos de volta: `cmd:enviar_mensagem`, `cmd:encerrar` (+ `cmd:resultado`).

---

## 07 · Fases

1. **Auth + upsert + backfill** — atendimento aparece pro agente certo, sem duplicar.
2. **Mensagens em tempo real** — `mensagem` (delta) + `cliente` (completar CPF depois).
3. **Encerramento & reconexão** — auto-inatividade + manual no Genesys, re-hidratação no reconnect.
4. **Bidirecional** — enviar mensagem pelo app e encerrar pelo app (comandos app → extensão).

---

## 08 · Fase 4 · bidirecional (app → extensão)

A extensão conecta o socket com o **mesmo JWT do agente** e se identifica:

```js
socket = io("ws://127.0.0.1:PORTA", {
  auth: {
    token,
    client: "genesys-extension"   // ou source: "extension"
  }
})
// opcional
socket.emit("ext:register", { client: "genesys-extension" })
```

O servidor coloca a extensão na room `agent:{userId}:extension` (não mistura com o browser).

### App → extensão

**`cmd:enviar_mensagem`** — agente enviou texto no painel (chat canal genesys)
```json
{
  "convId": "…",
  "chatId": "…",
  "messageId": "msg_…",
  "text": "…",
  "ts": 0,
  "agentId": "…",
  "agentName": "…",
  "replyTo": null
}
```

**`cmd:encerrar`** — agente encerrou no painel
```json
{
  "convId": "…",
  "chatId": "…",
  "motivo": "app_agente",
  "silent": false,
  "agentId": "…",
  "ts": 0
}
```

Disparo automático no backend ao:
- `POST /api/chats/:id/messages` (sender=agent, chat genesys)
- `PUT /api/chats/:id/close` (chat genesys)

Se a extensão estiver offline, a mensagem/fechamento **ainda grava no app**; a API devolve
`genesys: { relayed: false, reason: "extension_offline" }`.

### Extensão → app (ack)

**`cmd:resultado`** (alias `ext:cmd:resultado`)
```json
{
  "cmd": "enviar_mensagem",
  "ok": true,
  "convId": "…",
  "chatId": "…",
  "messageId": "msg_…",
  "genesysMessageId": "…"
}
```

Em sucesso de envio, o app marca delivery `sent` e propaga `message_delivery`.
Em falha, emite `genesys_cmd_failed` para o painel do agente.

---

## Decisões travadas

- ✅ **Auth:** login 1x pela extensão → JWT por agente.
- ✅ **Estilo:** eventos delta (B) — sem re-enviar histórico a cada mensagem.
- ✅ **Transporte:** socket.io desde o v1.
- ✅ **Agentes:** conta por agente, endpoints e auth separados.
- ✅ **Encerramento:** extensão entende os eventos do Genesys (inclui inatividade) + manual no Genesys.
- ✅ **Nomes:** prefixo `ext:atendimento:*`. **Reconexão:** re-hidrata todas as conversas ativas.
- ✅ **Fase 4:** `cmd:enviar_mensagem` / `cmd:encerrar` na room `agent:{id}:extension`.

---

*Genesys ⇄ OnionFlows · contrato v1 · agent-side · sem canais/multi-tenant*
