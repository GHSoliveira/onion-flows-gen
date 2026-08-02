import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGeminiGenesysTranscript,
  generateGeminiGenesysReply,
  improveGeminiAgentText,
  isGeminiGenesysEnabled
} from '../src/services/geminiGenesys.js';
import { generateGroqSuggestion } from '../src/services/groqFallback.js';

const withEnv = async (values, fn) => {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try { await fn(); } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

test('fica desabilitado sem opt-in', async () => {
  await withEnv({ GEMINI_GENESYS_ENABLED: 'false', GEMINI_API_KEY: 'secret' }, async () => {
    assert.equal(isGeminiGenesysEnabled(), false);
    assert.equal((await generateGeminiGenesysReply({ messages: [{ sender: 'user', text: 'oi' }] })).reason, 'disabled');
  });
});

test('revisa texto sem pedir uma nova resposta ao cliente', async () => {
  await withEnv({ GEMINI_GENESYS_ENABLED: 'true', GEMINI_API_KEY: 'secret', GEMINI_MODEL: 'gemini-test' }, async () => {
    let requestBody;
    const result = await improveGeminiAgentText('vou verifica seu modem', {
      fetchImpl: async (_url, options) => {
        requestBody = JSON.parse(options.body);
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ improvedText: 'Vou verificar seu modem.' }) }] } }] }) };
      }
    });
    assert.equal(result.improvedText, 'Vou verificar seu modem.');
    assert.match(requestBody.system_instruction.parts[0].text, /Preserve rigorosamente o sentido/);
    assert.match(requestBody.system_instruction.parts[0].text, /Nao acrescente/);
  });
});

test('historico inclui cliente, agente, bot e sistema relevante', () => {
  const transcript = buildGeminiGenesysTranscript([
    { sender: 'user', text: 'Minha internet caiu' },
    { sender: 'agent', text: 'O modem esta ligado?' },
    { sender: 'bot', text: 'Protocolo automatico iniciado' },
    { sender: 'system', text: 'Atendimento transferido para suporte' }
  ]);
  assert.match(transcript, /CLIENTE: Minha internet caiu/);
  assert.match(transcript, /AGENTE: O modem esta ligado\?/);
  assert.match(transcript, /BOT: Protocolo automatico iniciado/);
  assert.match(transcript, /SISTEMA: Atendimento transferido para suporte/);
});

test('solicita JSON estruturado e extrai sugestao', async () => {
  await withEnv({ GEMINI_GENESYS_ENABLED: 'true', GEMINI_API_KEY: 'secret', GEMINI_MODEL: 'gemini-test' }, async () => {
    let request;
    const payload = {
      problem: 'Sem conexao',
      lastCustomerMessage: 'Continua sem funcionar',
      reasoning: 'O agente ja confirmou o modem.',
      suggestedReply: 'Entendi. Vou seguir com a proxima verificacao.'
    };
    const fetchImpl = async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }) };
    };
    const result = await generateGeminiGenesysReply({ messages: [
      { sender: 'user', text: 'Sem internet' },
      { sender: 'agent', text: 'O modem esta ligado?' },
      { sender: 'user', text: 'Continua sem funcionar' }
    ] }, {
      fetchImpl,
      memoryContext: '1. Diagnostico: Confirme o modelo do roteador antes de orientar portas.',
      agentGuidance: 'Ofereca reagendamento sem prometer horario.'
    });
    assert.equal(result.suggestedReply, payload.suggestedReply);
    assert.match(request.url, /gemini-test:generateContent$/);
    assert.equal(request.options.headers['x-goog-api-key'], 'secret');
    assert.equal(request.body.generationConfig.responseMimeType, 'application/json');
    assert.match(request.body.contents[0].parts[0].text, /AGENTE: O modem esta ligado/);
    assert.match(request.body.contents[0].parts[0].text, /MEMORIA OPERACIONAL PERMANENTE/);
    assert.match(request.body.contents[0].parts[0].text, /Confirme o modelo do roteador/);
    assert.match(request.body.contents[0].parts[0].text, /Ofereca reagendamento sem prometer horario/);
  });
});

test('transforma 429 do Gemini em rate limit', async () => {
  await withEnv({ GEMINI_GENESYS_ENABLED: 'true', GEMINI_API_KEY: 'secret' }, async () => {
    await assert.rejects(generateGeminiGenesysReply({ messages: [{ sender: 'user', text: 'oi' }] }, {
      fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'quota' } }) })
    }), (error) => error.code === 'GEMINI_RATE_LIMIT');
  });
});

test('fallback Groq usa schema estrito e captura cota restante', async () => {
  await withEnv({ GROQ_API_KEY: 'groq-secret', GROQ_MODEL: 'openai/gpt-oss-120b' }, async () => {
    let request;
    const result = await generateGroqSuggestion({
      transcript: '1. CLIENTE: Sem internet',
      fetchImpl: async (url, options) => {
        request = { url, body: JSON.parse(options.body), authorization: options.headers.Authorization };
        return {
          ok: true,
          headers: new Headers({
            'x-ratelimit-limit-requests': '1000',
            'x-ratelimit-remaining-requests': '999',
            'x-ratelimit-reset-requests': '1m'
          }),
          json: async () => ({
            model: 'openai/gpt-oss-120b',
            choices: [{ message: { content: JSON.stringify({
              problem: 'Sem internet',
              lastCustomerMessage: 'Sem internet',
              reasoning: 'Necessario diagnosticar.',
              suggestedReply: 'Vou ajudar com o diagnostico.'
            }) } }],
            usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 }
          })
        };
      }
    });
    assert.equal(result.provider, 'groq');
    assert.equal(result.rateLimits.remainingRequests, '999');
    assert.match(request.url, /api\.groq\.com\/openai\/v1\/chat\/completions/);
    assert.equal(request.authorization, 'Bearer groq-secret');
    assert.equal(request.body.response_format.json_schema.strict, true);
    assert.equal(request.body.response_format.json_schema.schema.additionalProperties, false);
  });
});

test('aciona Groq quando todos os modelos Gemini falham', async () => {
  await withEnv({
    GEMINI_GENESYS_ENABLED: 'true',
    GEMINI_API_KEY: 'gemini-secret',
    GEMINI_MODEL: 'gemini-primary',
    GEMINI_FALLBACK_MODELS: 'gemini-secondary',
    GROQ_API_KEY: 'groq-secret',
    GROQ_MODEL: 'openai/gpt-oss-120b'
  }, async () => {
    const calls = [];
    const result = await generateGeminiGenesysReply({ messages: [{ sender: 'user', text: 'Preciso de ajuda' }] }, {
      fetchImpl: async (url, options) => {
        calls.push(url);
        if (url.includes('generativelanguage.googleapis.com')) {
          return { ok: false, status: 503, json: async () => ({ error: { message: 'unavailable' } }) };
        }
        return {
          ok: true,
          headers: new Headers(),
          json: async () => ({
            model: 'openai/gpt-oss-120b',
            choices: [{ message: { content: JSON.stringify({
              problem: 'Cliente precisa de ajuda',
              lastCustomerMessage: 'Preciso de ajuda',
              reasoning: 'E necessario entender a necessidade.',
              suggestedReply: 'Claro. Pode detalhar como posso ajudar?'
            }) } }]
          })
        };
      }
    });

    assert.equal(result.provider, 'groq');
    assert.equal(calls.filter((url) => url.includes('generativelanguage.googleapis.com')).length, 3);
    assert.match(calls.at(-1), /api\.groq\.com/);
  });
});

test('revisao de texto usa Groq quando Gemini falha', async () => {
  await withEnv({
    GEMINI_GENESYS_ENABLED: 'true',
    GEMINI_API_KEY: 'gemini-secret',
    GEMINI_MODEL: 'gemini-primary',
    GEMINI_FALLBACK_MODELS: '',
    GROQ_API_KEY: 'groq-secret'
  }, async () => {
    const result = await improveGeminiAgentText('vou verifica', {
      fetchImpl: async (url) => url.includes('generativelanguage.googleapis.com')
        ? { ok: false, status: 500, json: async () => ({}) }
        : {
            ok: true,
            headers: new Headers(),
            json: async () => ({
              model: 'openai/gpt-oss-120b',
              choices: [{ message: { content: JSON.stringify({ improvedText: 'Vou verificar.' }) } }]
            })
          }
    });

    assert.equal(result.provider, 'groq');
    assert.equal(result.improvedText, 'Vou verificar.');
  });
});
