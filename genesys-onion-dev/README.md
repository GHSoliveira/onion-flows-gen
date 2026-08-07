# Onion Companion

Extensão Chrome local que integra a sessão autenticada do usuário no Genesys ao Onion Flows, mantendo o Genesys como motor principal do atendimento.

## Instalação

1. Abra `chrome://extensions`.
2. Ative **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação**.
4. Selecione a pasta `genesys-onion-dev`.
5. Abra o popup, use `http://127.0.0.1:3101`, faça login e ative.

## Segurança e isolamento

- configuração e autenticação Onion isoladas em `onionDevAuth` e `onionDevSettings`;
- servidor restrito a `127.0.0.1` ou `localhost`;
- tokens e credenciais Genesys nunca são enviados ao Onion;
- filas de sincronização temporárias em `chrome.storage.session`;
- comandos idempotentes e vinculados à conversa e geração ativas;
- governador de chamadas com limites conservadores e backoff para `429`;
- validação de `conversationId`, `communicationId` e geração antes do envio;
- nenhuma dependência da extensão Genesys APR de produção.

## Eventos enviados

- `ext:register`
- `ext:atendimento:upsert`
- `ext:atendimento:backfill`
- `ext:atendimento:mensagem`
- `ext:atendimento:encerrar`

## Comandos recebidos

- `cmd:enviar_mensagem`
- `cmd:enviar_midia`
- `cmd:buscar_filas_transferencia`
- `cmd:transferir_com_tabulacao`
- `cmd:listar_tabulacoes`
- `cmd:finalizar_com_tabulacao`
- `cmd:hydrate_conversa`

Os comandos usam somente a sessão normal do usuário no navegador. A extensão não recebe client secret nem permissão administrativa adicional.
