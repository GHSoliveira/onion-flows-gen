const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-oss-120b';

const getHeader = (response, name) => {
  try { return response?.headers?.get?.(name) || null; } catch { return null; }
};

const rateLimitsFromResponse = (response) => ({
  limitRequests: getHeader(response, 'x-ratelimit-limit-requests'),
  remainingRequests: getHeader(response, 'x-ratelimit-remaining-requests'),
  resetRequests: getHeader(response, 'x-ratelimit-reset-requests'),
  limitTokens: getHeader(response, 'x-ratelimit-limit-tokens'),
  remainingTokens: getHeader(response, 'x-ratelimit-remaining-tokens'),
  resetTokens: getHeader(response, 'x-ratelimit-reset-tokens')
});

const callGroq = async ({ system, user, schemaName, schema, maxTokens = 1000, fetchImpl = globalThis.fetch }) => {
  const apiKey = String(process.env.GROQ_API_KEY || '').trim();
  if (!apiKey) return { ok: false, skipped: true, reason: 'missing_groq_api_key' };
  if (typeof fetchImpl !== 'function') throw new Error('Fetch indisponivel para chamar a Groq');
  const model = String(process.env.GROQ_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const timeoutMs = Math.min(Math.max(Number.parseInt(process.env.GROQ_TIMEOUT_MS || '30000', 10) || 30000, 1000), 60000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        max_completion_tokens: maxTokens,
        temperature: 0.2,
        response_format: {
          type: 'json_schema',
          json_schema: { name: schemaName, strict: true, schema }
        }
      }),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.error?.message || `Groq HTTP ${response.status}`);
      error.code = response.status === 429 ? 'GROQ_RATE_LIMIT' : 'GROQ_API_ERROR';
      error.status = response.status;
      error.rateLimits = rateLimitsFromResponse(response);
      throw error;
    }
    const content = String(data?.choices?.[0]?.message?.content || '').trim();
    let parsed;
    try { parsed = JSON.parse(content); } catch {
      const error = new Error('Groq retornou JSON invalido');
      error.code = 'GROQ_INVALID_RESPONSE';
      throw error;
    }
    return {
      ok: true,
      parsed,
      provider: 'groq',
      model: data?.model || model,
      usage: data?.usage || null,
      rateLimits: rateLimitsFromResponse(response)
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(`Groq excedeu o timeout de ${timeoutMs}ms`);
      timeoutError.code = 'GROQ_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

export const generateGroqSuggestion = async ({ transcript, memoryContext = '', agentGuidance = '', fetchImpl } = {}) => {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      problem: { type: 'string' },
      lastCustomerMessage: { type: 'string' },
      reasoning: { type: 'string' },
      suggestedReply: { type: 'string' }
    },
    required: ['problem', 'lastCustomerMessage', 'reasoning', 'suggestedReply']
  };
  const result = await callGroq({
    system: 'Voce e um copiloto de atendimento para um agente humano. Nao invente dados, procedimentos, politicas, protocolos, disponibilidade ou prazos. Sugira uma resposta natural, cordial e objetiva em portugues do Brasil. A resposta nunca sera enviada automaticamente.',
    user: `Analise a conversa e gere o JSON solicitado.${memoryContext ? `\n\nMEMORIA PESSOAL DO AGENTE:\n${memoryContext}` : ''}${agentGuidance ? `\n\nORIENTACAO DO AGENTE:\n${agentGuidance}` : ''}\n\nCONVERSA:\n${transcript}`,
    schemaName: 'agent_suggestion', schema, maxTokens: 1000, fetchImpl
  });
  if (!result?.ok) return result;
  const suggestion = {
    problem: String(result.parsed?.problem || '').trim(),
    lastCustomerMessage: String(result.parsed?.lastCustomerMessage || '').trim(),
    reasoning: String(result.parsed?.reasoning || '').trim(),
    suggestedReply: String(result.parsed?.suggestedReply || '').trim()
  };
  if (Object.values(suggestion).some((value) => !value)) {
    const error = new Error('Groq retornou uma sugestao incompleta');
    error.code = 'GROQ_INVALID_RESPONSE';
    throw error;
  }
  return { ...result, ...suggestion, parsed: undefined };
};

export const improveGroqAgentText = async (text, { fetchImpl } = {}) => {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: { improvedText: { type: 'string' } },
    required: ['improvedText']
  };
  const result = await callGroq({
    system: 'Revise rascunhos em portugues do Brasil. Corrija somente ortografia, pontuacao, gramatica, clareza e fluidez. Preserve rigorosamente sentido, fatos, nomes, numeros, links, protocolos, datas, horarios e formalidade. Nao acrescente nem remova informacoes.',
    user: `Revise sem mudar o sentido:\n\n${String(text || '').trim()}`,
    schemaName: 'improved_agent_text', schema, maxTokens: 1000, fetchImpl
  });
  if (!result?.ok) return result;
  const improvedText = String(result.parsed?.improvedText || '').trim();
  if (!improvedText) {
    const error = new Error('Groq retornou um texto vazio');
    error.code = 'GROQ_INVALID_RESPONSE';
    throw error;
  }
  return { ...result, improvedText, parsed: undefined };
};
