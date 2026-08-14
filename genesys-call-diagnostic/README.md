# Onion Sync Diagnostic

Extensão independente para capturar a linha do tempo técnica de chats e ligações no Genesys e gerar um relatório local sanitizado.

## Instalação

1. Abra `brave://extensions` ou `chrome://extensions`.
2. Ative o modo do desenvolvedor.
3. Clique em **Carregar sem compactação**.
4. Selecione a pasta `genesys-call-diagnostic`.
5. Atualize a página do Genesys uma vez. Isso é necessário para observar os WebSockets criados no início da página.

Ela pode permanecer instalada junto da extensão principal do Onion. Não usa o servidor local e não faz chamadas adicionais à API.

## Captura

1. Na aba do Genesys, abra a extensão e clique em **Iniciar captura** antes de um chat ou ligação entrar.
2. Reproduza o problema: cliente ausente, mensagem atrasada, card oscilando ou ligação que desaparece.
3. Aguarde alguns segundos depois do último evento relevante.
4. Abra novamente a extensão e clique em **Finalizar e baixar relatório**.
5. Envie o arquivo `onion-sync-diagnostic-....json` inteiro para análise.

A captura dura no máximo 20 minutos e armazena até 4 MB ou 4.000 eventos. Eventos idênticos em sequência são compactados, mantendo um heartbeat periódico. O arquivo informa claramente se algum limite foi atingido.

## O que o relatório compara

- cards que aparecem, mudam ou somem do DOM;
- roster e detalhes já retornados pelo Genesys via fetch/XHR;
- eventos de conversa já recebidos pelos WebSockets da página;
- abertura, fechamento e reconexão dos WebSockets;
- participantes de voz e mensagem, estados e horários;
- `conversationId`, `participantId`, `communicationId` e IDs técnicos de mensagens;
- lotes de mensagens solicitados e retornados, sem o conteúdo;
- saída sanitizada produzida pelo observador da extensão principal do Onion;
- atraso entre a primeira visão bruta, a interpretação da extensão e o DOM.

## Privacidade

O relatório não inclui tokens, cookies, cabeçalhos, texto de mensagens, CPF, nomes, telefones ou endereços. Para mídia, registra apenas quantidade e tipo técnico. URLs têm UUIDs substituídos quando o ID já não está em um campo técnico estruturado.
