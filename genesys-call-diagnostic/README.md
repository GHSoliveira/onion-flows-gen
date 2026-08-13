# Onion Call Diagnostic

Extensão independente para capturar o ciclo técnico de uma ligação no Genesys e gerar um relatório local sanitizado.

## Instalação

1. Abra `brave://extensions` ou `chrome://extensions`.
2. Ative o modo do desenvolvedor.
3. Clique em **Carregar sem compactação**.
4. Selecione a pasta `genesys-call-diagnostic`.
5. Atualize a página do Genesys uma vez. Isso é necessário para observar os WebSockets criados no início da página.

Ela pode permanecer instalada junto da extensão principal do Onion. Não usa o servidor local e não faz chamadas adicionais à API.

## Captura

1. Na aba do Genesys, abra a extensão e clique em **Iniciar captura** antes da ligação.
2. Aguarde a ligação entrar, mantenha a chamada pelo tempo necessário e desligue normalmente.
3. Abra novamente a extensão e clique em **Finalizar e baixar relatório**.
4. Envie o arquivo `onion-call-diagnostic-....json` inteiro para análise.

A captura dura no máximo 20 minutos e armazena até 4 MB ou 4.000 eventos. O arquivo informa claramente se algum limite foi atingido.

## Privacidade

O relatório inclui apenas:

- `conversationId`, IDs de participante e de call;
- finalidade do participante;
- estados, direção, `held` e horários da call;
- nomes dos campos presentes nos objetos, sem seus valores desconhecidos;
- entrada, saída e remontagem dos cards no DOM;
- transporte e sequência temporal dos eventos.

O relatório não inclui tokens, cookies, cabeçalhos, mensagens, CPF, nomes, telefones ou endereços. URLs têm UUIDs substituídos quando não representam o `conversationId` técnico já estruturado.
