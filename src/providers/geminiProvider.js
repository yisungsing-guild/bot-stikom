const { GoogleGenAI } = require('@google/genai');
const logger = require('../logger');

const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const FALLBACK_GEMINI_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'];
const DEFAULT_GEMINI_EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2';
const DEFAULT_EMBEDDING_DIMENSIONS = 1536;
const DEFAULT_TIMEOUT_MS = parseInt(process.env.GEMINI_TIMEOUT_MS || '30000', 10);
const DEFAULT_THINKING_BUDGET = parseInt(process.env.GEMINI_THINKING_BUDGET || '0', 10);
const MAX_429_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 1500;

function envFlag(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (!v) return defaultValue;
  return v === 'true' || v === '1' || v === 'yes' || v === 'y' || v === 'on';
}

function hasUsableGeminiApiKey() {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return false;
  if (/^replace_with|your[-_ ]?gemini[-_ ]?key/i.test(apiKey)) return false;
  return apiKey.length >= 10;
}

function isGeminiProviderActive() {
  const provider = String(process.env.LLM_PROVIDER || process.env.AI_PROVIDER || '').trim().toLowerCase();
  return provider === 'gemini';
}

function getGeminiModel() {
  return String(process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim() || 'gemini-3.6-flash';
}

function getGeminiEmbeddingModel() {
  return String(process.env.GEMINI_EMBEDDING_MODEL || DEFAULT_GEMINI_EMBEDDING_MODEL).trim() || 'gemini-embedding-2';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(err) {
  if (!err) return false;
  const msg = String(err.message || '').toLowerCase();
  const status = err.status || err.statusCode || (err.error && err.error.code);
  return (
    status === 429 ||
    status === 'RESOURCE_EXHAUSTED' ||
    msg.includes('429') ||
    msg.includes('resource_exhausted') ||
    msg.includes('rate limit') ||
    msg.includes('quota exceeded')
  );
}

function isRetryableServerError(err) {
  if (!err) return false;
  const msg = String(err.message || '').toLowerCase();
  const status = err.status || err.statusCode || (err.error && err.error.code);
  return (
    status === 503 ||
    status === 500 ||
    status === 'UNAVAILABLE' ||
    msg.includes('high demand') ||
    msg.includes('unavailable') ||
    msg.includes('temporarily')
  );
}

class GeminiAdapter {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.GEMINI_API_KEY;
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.model = options.model || getGeminiModel();
    this.embeddingModel = options.embeddingModel || getGeminiEmbeddingModel();
    this.embeddingDimensions = options.embeddingDimensions || DEFAULT_EMBEDDING_DIMENSIONS;
    this.thinkingBudget = options.thinkingBudget !== undefined ? options.thinkingBudget : DEFAULT_THINKING_BUDGET;

    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is not configured');
    }

    this.ai = new GoogleGenAI({
      apiKey: this.apiKey,
      httpOptions: { timeout: this.timeoutMs }
    });
  }

  async _withRetry(operationName, fn, maxRetries = MAX_429_RETRIES) {
    let attempt = 0;
    while (attempt <= maxRetries) {
      try {
        return await fn();
      } catch (err) {
        attempt++;
        if ((isRateLimitError(err) || isRetryableServerError(err)) && attempt <= maxRetries) {
          const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 500;
          logger.warn({ attempt, delay, err: err.message }, `[Gemini] Transient error (${err.status || 'transient'}) during ${operationName}. Retrying in ${Math.round(delay)}ms...`);
          await sleep(delay);
          continue;
        }
        throw err;
      }
    }
  }

  async generateDetailed({ prompt, systemInstruction, temperature = 0.2, maxOutputTokens = 800, topP = 0.8, model, thinkingBudget }) {
    const primaryModel = model || this.model;
    const modelCandidates = Array.from(new Set([primaryModel, ...FALLBACK_GEMINI_MODELS]));
    const effectiveBudget = thinkingBudget !== undefined ? thinkingBudget : this.thinkingBudget;

    const config = {
      temperature: Number(temperature),
      maxOutputTokens: parseInt(maxOutputTokens, 10),
      topP: Number(topP)
    };

    if (effectiveBudget !== undefined && effectiveBudget !== null && effectiveBudget >= 0) {
      config.thinkingConfig = { thinkingBudget: effectiveBudget };
    }

    if (systemInstruction) {
      config.systemInstruction = String(systemInstruction);
    }

    let lastError = null;
    const t0 = Date.now();
    for (const targetModel of modelCandidates) {
      try {
        return await this._withRetry(`generateContent(${targetModel})`, async () => {
          const response = await this.ai.models.generateContent({
            model: targetModel,
            contents: prompt,
            config
          });
          const actualModel = response.modelVersion || targetModel;
          const latencyMs = Date.now() - t0;
          logger.info({ requestedModel: primaryModel, actualModel, latencyMs, responseId: response.responseId }, '[Gemini] Generation executed successfully');
          return {
            text: String(response.text || '').trim(),
            requestedModel: primaryModel,
            actualModel,
            latencyMs,
            responseId: response.responseId,
            usage: response.usageMetadata || null,
            fallbackUsed: targetModel !== primaryModel
          };
        });
      } catch (err) {
        lastError = err;
        const msg = String(err.message || '');
        if (msg.includes('404') || isRetryableServerError(err)) {
          logger.warn({ model: targetModel, err: msg }, '[Gemini] Model unavailable or high demand. Trying next candidate model...');
          continue;
        }
        throw err;
      }
    }

    throw lastError || new Error('All candidate Gemini models failed');
  }

  async generateText(options) {
    const res = await this.generateDetailed(options);
    return res.text;
  }

  async embedText(text, { dimensions = DEFAULT_EMBEDDING_DIMENSIONS, model } = {}) {
    const targetModel = model || this.embeddingModel;
    const cleanText = String(text || '').trim();
    if (!cleanText) {
      throw new Error('Cannot embed empty text');
    }

    return await this._withRetry('embedContent', async () => {
      const response = await this.ai.models.embedContent({
        model: targetModel,
        contents: cleanText,
        config: {
          outputDimensionality: dimensions
        }
      });

      if (!response || !response.embeddings || !response.embeddings[0] || !Array.isArray(response.embeddings[0].values)) {
        throw new Error('Invalid embedding response from Gemini API');
      }

      return response.embeddings[0].values;
    });
  }

  // OpenAI-compatible wrapper to drop into semanticRagEngine, aiEngine, and shadow integration
  get chat() {
    const self = this;
    return {
      completions: {
        create: async (params = {}) => {
          const messages = Array.isArray(params.messages) ? params.messages : [];
          let systemInstruction = '';
          const userContents = [];

          for (const m of messages) {
            if (m.role === 'system') {
              systemInstruction = systemInstruction ? `${systemInstruction}\n${m.content}` : m.content;
            } else if (m.role === 'user' || m.role === 'assistant') {
              userContents.push(m.content);
            }
          }

          const prompt = userContents.join('\n\n') || 'Halo';
          const maxOutputTokens = params.max_completion_tokens || params.max_tokens || 800;
          const temperature = params.temperature !== undefined ? params.temperature : 0.2;
          const topP = params.top_p !== undefined ? params.top_p : 0.8;
          const targetModel = params.model && !params.model.startsWith('gpt-') ? params.model : self.model;

          const res = await self.generateDetailed({
            prompt,
            systemInstruction,
            temperature,
            maxOutputTokens,
            topP,
            model: targetModel
          });

          return {
            choices: [
              {
                message: {
                  content: res.text,
                  role: 'assistant'
                },
                finish_reason: 'stop',
                index: 0
              }
            ],
            model: res.actualModel,
            usage: {
              prompt_tokens: res.usage?.promptTokenCount || 0,
              completion_tokens: res.usage?.candidatesTokenCount || 0,
              total_tokens: res.usage?.totalTokenCount || 0
            }
          };
        }
      }
    };
  }

  get embeddings() {
    const self = this;
    return {
      create: async (params = {}) => {
        const input = params.input;
        const dimensions = params.dimensions || self.embeddingDimensions;
        const targetModel = params.model && !params.model.startsWith('text-embedding-') ? params.model : self.embeddingModel;

        if (Array.isArray(input)) {
          const results = [];
          for (let i = 0; i < input.length; i++) {
            const vec = await self.embedText(input[i], { dimensions, model: targetModel });
            results.push({ embedding: vec, index: i });
          }
          return { data: results, model: targetModel };
        }

        const vec = await self.embedText(input, { dimensions, model: targetModel });
        return {
          data: [{ embedding: vec, index: 0 }],
          model: targetModel
        };
      }
    };
  }
}

let cachedGeminiAdapter = null;

function getGeminiAdapter(options = {}) {
  if (cachedGeminiAdapter && !options.forceNew) {
    return cachedGeminiAdapter;
  }
  cachedGeminiAdapter = new GeminiAdapter(options);
  return cachedGeminiAdapter;
}

module.exports = {
  GeminiAdapter,
  getGeminiAdapter,
  hasUsableGeminiApiKey,
  isGeminiProviderActive,
  getGeminiModel,
  getGeminiEmbeddingModel,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_EMBEDDING_MODEL,
  DEFAULT_EMBEDDING_DIMENSIONS
};
