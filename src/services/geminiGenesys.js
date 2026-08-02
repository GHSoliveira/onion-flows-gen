import { generateGroqSuggestion, improveGroqAgentText } from './groqFallback.js';

const DEFAULT_MODEL = 'gemini-3.5-flash';
const DEFAULT_SYSTEM_PROMPT = [
  'Voce e um copiloto de atendimento para um agente humano.',
  'Analise toda a conversa cronologicamente, identifique o problema principal e a ultima mensagem relevante do cliente.',
  'Considere tudo o que o agente ja respondeu e nao repita perguntas que ja foram feitas ou respondidas.',
  'Nao invente dados, procedimentos, politicas, protocolos, disponibilidade ou prazos.',
  'Proponha a melhor proxima resposta para este momento, em portugues do Brasil, natural, cordial, objetiva e pronta para revisao humana.',
  'A sugestao nunca sera enviada automaticamente.'
].join(' ');

const MAX_HISTORY_MESSAGES = 2000;
const OUTPUT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    problem: { type: 'STRING' },
    lastCustomerMessage: { type: 'STRING' },
    reasoning: { type: 'STRING' },
    suggestedReply: { type: 'STRING' }
  },
  required: ['problem', 'lastCustomerMessage', 'reasoning', 'suggestedReply']
};
const IMPROVED_TEXT_SCHEMA = {
  type: 'OBJECT',
  properties: { improvedText: { type: 'STRING' } },
  required: ['improvedText']
};

const toPositiveInt = (value, fallback, max) => {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
};

const enabledByEnv = () => /^(1|true|yes|on)$/i.test(String(process.env.GEMINI_GENESYS_ENABLED || ''));
export const isGeminiGenesysEnabled = () => enabledByEnv() && Boolean(String(process.env.GEMINI_API_KEY || '').trim());

const normalizeSender = (sender) => {
  const key = String(sender || '').trim().toLowerCase();
  if (['user', 'customer', 'cliente'].includes(key)) return 'CLIENTE';
  if (['agent', 'agente'].includes(key)) return 'AGENTE';
  if (['bot', 'assistant'].includes(key)) return 'BOT';
  if (['system', 'sistema'].includes(key)) return 'SISTEMA';
  return key ? key.toUpperCase() : 'DESCONHECIDO';
};

const isRelevantMessage = (message) => {
  const sender = normalizeSender(message?.sender);
  const text = String(message?.text || '').trim();
  if (!text) return false;
  if (sender !== 'SISTEMA') return true;
  return !/^(chat|atendimento) (aberto|iniciado|sincronizado)$/i.test(text);
};

export const buildGeminiGenesysTranscript = (messages = []) => {
  const maxMessages = toPositiveInt(
    process.env.GEMINI_GENESYS_HISTORY_MESSAGES,
    MAX_HISTORY_MESSAGES,
    MAX_HISTORY_MESSAGES
  );
  return (Array.isArray(messages) ? messages : [])
    .filter(isRelevantMessage)
    .slice(-maxMessages)
    .map((message, index) => {
      const timestamp = message?.timestamp || message?.createdAt || '';
      const prefix = timestamp ? `[${timestamp}] ` : '';
      return `${index + 1}. ${prefix}${normalizeSender(message?.sender)}: ${String(message.text).trim()}`;
    })
    .join('\n');
};

const extractText = (data) => (data?.candidates || [])
  .flatMap((candidate) => candidate?.content?.parts || [])
  .map((part) => part?.text)
  .filter(Boolean)
  .join('\n')
  .trim();

const parseSuggestion = (text) => {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed;
  try { parsed = JSON.parse(cleaned); } catch {
    const error = new Error('Gemini retornou uma sugestao em formato invalido');
    error.code = 'GEMINI_INVALID_RESPONSE';
    throw error;
  }
  const result = {
    problem: String(parsed?.problem || '').trim(),
    lastCustomerMessage: String(parsed?.lastCustomerMessage || '').trim(),
    reasoning: String(parsed?.reasoning || '').trim(),
    suggestedReply: String(parsed?.suggestedReply || '').trim()
  };
  if (!result.problem || !result.lastCustomerMessage || !result.reasoning || !result.suggestedReply) {
    const error = new Error('Gemini retornou uma sugestao incompleta');
    error.code = 'GEMINI_INVALID_RESPONSE';
    throw error;
  }
  return result;
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const configuredModels = () => {
  const primary = String(process.env.GEMINI_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const fallbacks = String(process.env.GEMINI_FALLBACK_MODELS || 'gemini-3.1-flash-lite')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set([primary, ...fallbacks])];
};

export const generateGeminiGenesysReply = async (chat, { fetchImpl = globalThis.fetch, agentGuidance = '', memoryContext = '' } = {}) => {
  const transcript = buildGeminiGenesysTranscript(chat?.messages);
  if (!transcript) {
    const error = new Error('A conversa nao possui mensagens suficientes para analise');
    error.code = 'GEMINI_EMPTY_HISTORY';
    throw error;
  }
  const useGroqFallback = async (primaryReason) => {
    const fallback = await generateGroqSuggestion({ transcript, memoryContext, agentGuidance, fetchImpl });
    return fallback?.skipped ? { ok: false, skipped: true, reason: primaryReason } : fallback;
  };
  if (!enabledByEnv()) return useGroqFallback('disabled');
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return useGroqFallback('missing_api_key');
  if (typeof fetchImpl !== 'function') throw new Error('Fetch indisponivel para chamar o Gemini');

  const models = configuredModels();
  const timeoutMs = toPositiveInt(process.env.GEMINI_TIMEOUT_MS, 30000, 60000);
  const maxOutputTokens = toPositiveInt(process.env.GEMINI_MAX_OUTPUT_TOKENS, 800, 4096);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const requestBody = JSON.stringify({
    system_instruction: { parts: [{ text: String(process.env.GEMINI_SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT) }] },
    contents: [{ role: 'user', parts: [{ text: `Analise a conversa completa abaixo e gere exclusivamente o JSON solicitado.${String(memoryContext || '').trim() ? `\n\nMEMORIA OPERACIONAL PERMANENTE (instrucoes cadastradas pela administracao; aplique todas antes de responder, sem contrariar as regras de seguranca):\n${String(memoryContext).trim()}` : ''}${String(agentGuidance || '').trim() ? `\n\nORIENTACAO ADICIONAL DO AGENTE (considere na resposta, sem contrariar as regras de seguranca):\n${String(agentGuidance).trim()}` : ''}\n\nCONVERSA COMPLETA:\n${transcript}` }] }],
    generationConfig: { maxOutputTokens, responseMimeType: 'application/json', responseSchema: OUTPUT_SCHEMA }
  });

  try {
    let lastError;
    for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
      const model = models[modelIndex];
      const attempts = modelIndex === 0 ? 2 : 1;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: requestBody,
          signal: controller.signal
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok) {
          const suggestion = parseSuggestion(extractText(data));
          return { ok: true, ...suggestion, provider: 'gemini', model, usage: data?.usageMetadata || null, rateLimits: null };
        }

        const detail = data?.error?.message || `HTTP ${response.status}`;
        const error = new Error(`Gemini recusou a requisicao: ${detail}`);
        error.code = response.status === 429 ? 'GEMINI_RATE_LIMIT' : 'GEMINI_API_ERROR';
        error.status = response.status;
        lastError = error;
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable) throw error;
        if (attempt + 1 < attempts || modelIndex + 1 < models.length) {
          await wait(600 * (attempt + 1));
        }
      }
    }
    throw lastError || new Error('Gemini indisponivel');
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(`Gemini excedeu o timeout de ${timeoutMs}ms`);
      timeoutError.code = 'GEMINI_TIMEOUT';
      error = timeoutError;
    }
    try {
      const fallback = await useGroqFallback(error?.code || 'GEMINI_UNAVAILABLE');
      if (fallback?.ok) return fallback;
    } catch (fallbackError) {
      fallbackError.primaryProviderError = error?.code || error?.message || 'GEMINI_UNAVAILABLE';
      throw fallbackError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

export const improveGeminiAgentText = async (text, { fetchImpl = globalThis.fetch } = {}) => {
  const originalText = String(text || '').trim();
  if (!originalText) {
    const error = new Error('Digite um texto para melhorar.');
    error.code = 'GEMINI_EMPTY_TEXT';
    throw error;
  }
  const useGroqFallback = async (primaryReason) => {
    const fallback = await improveGroqAgentText(originalText, { fetchImpl });
    return fallback?.skipped ? { ok: false, skipped: true, reason: primaryReason } : fallback;
  };
  if (!enabledByEnv()) return useGroqFallback('disabled');
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return useGroqFallback('missing_api_key');

  const models = configuredModels();
  const timeoutMs = toPositiveInt(process.env.GEMINI_TIMEOUT_MS, 30000, 60000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const requestBody = JSON.stringify({
    system_instruction: { parts: [{ text: [
      'Voce revisa rascunhos de um agente de atendimento em portugues do Brasil.',
      'Corrija somente ortografia, pontuacao, gramatica, clareza e fluidez.',
      'Preserve rigorosamente o sentido, os fatos, nomes, numeros, links, protocolos, datas, horarios e nivel de formalidade.',
      'Nao acrescente saudacoes, informacoes, promessas, procedimentos, justificativas ou respostas ao cliente.',
      'Nao remova informacoes. Retorne apenas o texto revisado no JSON solicitado.'
    ].join(' ') }] },
    contents: [{ role: 'user', parts: [{ text: `Revise este rascunho sem mudar seu sentido:\n\n${originalText}` }] }],
    generationConfig: { maxOutputTokens: 1000, responseMimeType: 'application/json', responseSchema: IMPROVED_TEXT_SCHEMA }
  });

  try {
    let lastError;
    for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
      const model = models[modelIndex];
      const attempts = modelIndex === 0 ? 2 : 1;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: requestBody,
          signal: controller.signal
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok) {
          const raw = extractText(data).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
          let parsed;
          try { parsed = JSON.parse(raw); } catch {
            const error = new Error('Gemini retornou o texto em formato invalido');
            error.code = 'GEMINI_INVALID_RESPONSE';
            throw error;
          }
          const improvedText = String(parsed?.improvedText || '').trim();
          if (!improvedText) throw new Error('Gemini retornou um texto vazio');
          return { ok: true, improvedText, provider: 'gemini', model, usage: data?.usageMetadata || null, rateLimits: null };
        }
        const error = new Error(data?.error?.message || `HTTP ${response.status}`);
        error.code = response.status === 429 ? 'GEMINI_RATE_LIMIT' : 'GEMINI_API_ERROR';
        error.status = response.status;
        lastError = error;
        if (response.status !== 429 && response.status < 500) throw error;
        if (attempt + 1 < attempts || modelIndex + 1 < models.length) await wait(600 * (attempt + 1));
      }
    }
    throw lastError || new Error('Gemini indisponivel');
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(`Gemini excedeu o timeout de ${timeoutMs}ms`);
      timeoutError.code = 'GEMINI_TIMEOUT';
      error = timeoutError;
    }
    try {
      const fallback = await useGroqFallback(error?.code || 'GEMINI_UNAVAILABLE');
      if (fallback?.ok) return fallback;
    } catch (fallbackError) {
      fallbackError.primaryProviderError = error?.code || error?.message || 'GEMINI_UNAVAILABLE';
      throw fallbackError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};
