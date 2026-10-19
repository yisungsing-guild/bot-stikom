'use strict';

/**
 * src/core/modelSemanticParser.js
 *
 * Generic Model-Driven Semantic Language Understanding Component.
 * Transforms raw user language + concise conversation context into a structured SemanticInterpretation.
 *
 * Non-negotiables:
 * - NO query-specific regexes.
 * - NO typo dictionaries.
 * - NO question-pattern lists.
 * - NO hardcoded program or institutional names.
 * - NO factual answer templates.
 * - Does NOT decide whether entities are SUPPORTED or UNSUPPORTED (belongs to catalog/resolution layer).
 * - Fails closed on timeout/error to UNKNOWN / HIGH_AMBIGUITY.
 */

const { OpenAI } = require('openai');
const logger = require('../logger');
const { sanitizeOpenAiChatPayload } = require('../utils/openAiPayloadHelper');

const ALLOWED_SPEECH_ACTS = Object.freeze([
  'DISCOVER_LIST',
  'INQUIRE_PROPERTY',
  'VERIFY_STATUS',
  'EXPLAIN_PROCEDURE',
  'SEEK_ADVICE',
  'COMPARE',
  'GENERAL_GREETING',
  'UNKNOWN'
]);

const ALLOWED_SEMANTIC_CONCEPTS = Object.freeze([
  'ACADEMIC_OFFERING',
  'QUALITY_ACCREDITATION',
  'FINANCIAL_COST',
  'ADMISSION_ONBOARDING',
  'CAMPUS_LIFE',
  'INTERNATIONAL_STUDY',
  'CAREER_EMPLOYMENT',
  'STUDY_SCHEDULE',
  'TRANSFER_CREDIT'
]);

const ALLOWED_REQUESTED_ASPECTS = Object.freeze([
  'curriculum',
  'fee',
  'accreditation',
  'requirements',
  'procedure',
  'schedule',
  'career',
  'location',
  'study_duration',
  'degree_award',
  'facilities',
  'organization',
  'contact',
  'general'
]);

const ALLOWED_INFERRED_CATEGORIES = Object.freeze([
  'academic_program',
  'campus_service',
  'admission_track',
  'scholarship',
  'institution',
  'external_partner',
  'facility',
  'student_organization',
  'unknown'
]);

const ALLOWED_AMBIGUITY_LEVELS = Object.freeze([
  'LOW',
  'MEDIUM',
  'HIGH'
]);

const ALLOWED_REFERENCE_TYPES = Object.freeze([
  'none',
  'anaphoric',
  'ellipsis',
  'comparative',
  'clarification'
]);

const SEMANTIC_INTERPRETATION_JSON_SCHEMA = {
  name: 'semantic_interpretation',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      speechAct: {
        type: 'string',
        enum: ALLOWED_SPEECH_ACTS
      },
      semanticConcepts: {
        type: 'array',
        items: {
          type: 'string',
          enum: ALLOWED_SEMANTIC_CONCEPTS
        }
      },
      candidateEntities: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            rawMention: { type: 'string' },
            inferredCategory: {
              type: 'string',
              enum: ALLOWED_INFERRED_CATEGORIES
            },
            academicLevel: {
              type: ['string', 'null'],
              enum: ['S1', 'S2', 'D3', 'ALL', null]
            }
          },
          required: ['rawMention', 'inferredCategory', 'academicLevel'],
          additionalProperties: false
        }
      },
      requestedAspects: {
        type: 'array',
        items: {
          type: 'string',
          enum: ALLOWED_REQUESTED_ASPECTS
        }
      },
      scopeConstraints: {
        type: 'object',
        properties: {
          academicLevel: {
            type: ['string', 'null'],
            enum: ['S1', 'S2', 'D3', null]
          },
          studyMode: {
            type: ['string', 'null'],
            enum: ['regular', 'evening_worker', 'international', 'rpl_transfer', null]
          },
          locationConstraint: {
            type: ['string', 'null']
          }
        },
        required: ['academicLevel', 'studyMode', 'locationConstraint'],
        additionalProperties: false
      },
      contextDependency: {
        type: 'object',
        properties: {
          isFollowUp: { type: 'boolean' },
          referenceType: {
            type: 'string',
            enum: ALLOWED_REFERENCE_TYPES
          }
        },
        required: ['isFollowUp', 'referenceType'],
        additionalProperties: false
      },
      confidence: { type: 'number' },
      ambiguityLevel: {
        type: 'string',
        enum: ALLOWED_AMBIGUITY_LEVELS
      }
    },
    required: [
      'speechAct',
      'semanticConcepts',
      'candidateEntities',
      'requestedAspects',
      'scopeConstraints',
      'contextDependency',
      'confidence',
      'ambiguityLevel'
    ],
    additionalProperties: false
  }
};

const SYSTEM_PARSER_INSTRUCTION = `You are a linguistic semantic interpretation engine for an Indonesian higher-education conversational assistant.
Analyze user query and output a valid SemanticInterpretation JSON adhering strictly to the schema.

Concepts:
- FINANCIAL_COST: Tuition, registration fees, payment methods, installments, discounts.
- ACADEMIC_OFFERING: Available programs, majors, disciplines, curriculum overview.
- QUALITY_ACCREDITATION: Accreditation status, ratings, certified institutional/program quality.
- ADMISSION_ONBOARDING: Registration steps, admission pathways, deadlines, requirements.
- STUDY_SCHEDULE: Class timings, evening/working-student programs, schedule flexibility.
- TRANSFER_CREDIT: Recognition of Prior Learning (RPL), credit transfer, alih jenjang.
- INTERNATIONAL_STUDY: Dual degree, global programs, overseas exchange/internships.
- CAREER_EMPLOYMENT: Career prospects, alumni professions, career center.
- CAMPUS_LIFE: Facilities, labs, student organizations, sports, UKM.

Speech Acts:
- DISCOVER_LIST: Exploring choices, available offerings, what exists.
- INQUIRE_PROPERTY: Asking for specific attributes (fee amount, accreditation, requirements).
- COMPARE: Comparing differences, pros/cons across options.
- VERIFY_STATUS: Inquiring whether something is allowed, possible, or active.
- EXPLAIN_PROCEDURE: Asking for steps, procedures, how-to.
- SEEK_ADVICE: Asking for recommendation based on personal background.
- GENERAL_GREETING: Sapaan atau salam pembuka.

Aspects:
- schedule: Dates, waves, opening/closing periods, calendars, timeline (e.g. kapan dibuka/ditutup, jadwal, gelombang).
- procedure: Steps, workflows, registration steps, payment confirmation procedure (e.g. alur, cara daftar, konfirmasi pembayaran).
- contact: Phone numbers, WhatsApp, hotline, email, official service contacts (e.g. kontak, nomor telepon, wa, call center).
- requirements: Admission requirements, document checklist, qualifications (e.g. syarat, berkas, dokumen pendaftaran).
- fee: Tuition, registration fee, payment amounts, fee components (e.g. biaya kuliah, dpp, spp, nominal).
- curriculum: Courses, syllabus, competencies, learning focus (e.g. mata kuliah, kurikulum, yang dipelajari, bidang pembelajaran).
- career: Job prospects, career paths, future professions.
- accreditation: Accreditation rank, institutional status, ban-pt certificates.
- facilities: Campus facilities, labs, dormitories, library.
- organization: Student clubs, UKM, student government, ormawa.

Rules:
1. Understand colloquial Indonesian, abbreviations, typos, and slang by SEMANTIC MEANING, not literal character matching.
2. DO NOT answer questions or invent facts/catalogs.
3. Candidate entities: Extract ONLY specific named entities (programs, institutions, specific clubs/organizations, specific partners). DO NOT extract generic common nouns, verbs, degree levels, broad domain categories, or phrases with conjunctions/prepositions (e.g. "maba", "teknik atau komputer", "tambahan dan potongan", "pengalaman kerja ke SKS", "yang dibuka di pascasarjana", "pendidikan vokasi", "semua prodi", "konsultasi", "registrasi online" are NOT candidate entities; they belong to aspects/concepts/scopeConstraints).
4. For follow-ups (ellipsis/anaphora), set contextDependency.isFollowUp=true with appropriate referenceType. DO NOT invent unmentioned entities.
5. For multi-entity or inherently ambiguous inquiries, preserve all candidate entities and set ambiguityLevel="HIGH".
6. Return only the structured JSON.`;

/**
 * Creates a deterministic, safe UNKNOWN / HIGH_AMBIGUITY interpretation.
 * Invoked on provider failure, timeout, schema violation, or unparsable output.
 * NEVER performs regex-based guessing.
 */
function buildSafeUnknownInterpretation(rawQuery, reason = 'unknown', extraMeta = {}) {
  return {
    speechAct: 'UNKNOWN',
    semanticConcepts: [],
    candidateEntities: [],
    requestedAspects: [],
    scopeConstraints: {
      academicLevel: null,
      studyMode: null,
      locationConstraint: null
    },
    contextDependency: {
      isFollowUp: false,
      referenceType: 'none'
    },
    confidence: 0.0,
    ambiguityLevel: 'HIGH',
    metadata: {
      fallbackInvoked: true,
      reason: String(reason || 'unknown'),
      ...extraMeta
    }
  };
}

/**
 * Validates the raw JSON object returned by the model against the SemanticInterpretation contract.
 */
function validateInterpretationSchema(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, reason: 'not_an_object' };
  }

  if (!ALLOWED_SPEECH_ACTS.includes(data.speechAct)) {
    return { valid: false, reason: `invalid_speechAct: ${data.speechAct}` };
  }

  if (!Array.isArray(data.semanticConcepts) || !data.semanticConcepts.every(c => ALLOWED_SEMANTIC_CONCEPTS.includes(c))) {
    return { valid: false, reason: 'invalid_semanticConcepts' };
  }

  if (!Array.isArray(data.candidateEntities)) {
    return { valid: false, reason: 'candidateEntities_not_array' };
  }

  for (const ent of data.candidateEntities) {
    if (!ent || typeof ent !== 'object' || typeof ent.rawMention !== 'string') {
      return { valid: false, reason: 'invalid_candidateEntity_item' };
    }
    if (!ALLOWED_INFERRED_CATEGORIES.includes(ent.inferredCategory)) {
      return { valid: false, reason: `invalid_inferredCategory: ${ent.inferredCategory}` };
    }
    if (ent.academicLevel !== null && !['S1', 'S2', 'D3', 'ALL'].includes(ent.academicLevel)) {
      return { valid: false, reason: `invalid_entity_academicLevel: ${ent.academicLevel}` };
    }
  }

  if (!Array.isArray(data.requestedAspects) || !data.requestedAspects.every(a => ALLOWED_REQUESTED_ASPECTS.includes(a))) {
    return { valid: false, reason: 'invalid_requestedAspects' };
  }

  if (!data.scopeConstraints || typeof data.scopeConstraints !== 'object') {
    return { valid: false, reason: 'invalid_scopeConstraints' };
  }

  if (!data.contextDependency || typeof data.contextDependency !== 'object' || typeof data.contextDependency.isFollowUp !== 'boolean') {
    return { valid: false, reason: 'invalid_contextDependency' };
  }
  if (!ALLOWED_REFERENCE_TYPES.includes(data.contextDependency.referenceType)) {
    return { valid: false, reason: `invalid_referenceType: ${data.contextDependency.referenceType}` };
  }

  if (typeof data.confidence !== 'number' || Number.isNaN(data.confidence)) {
    return { valid: false, reason: 'invalid_confidence' };
  }

  if (!ALLOWED_AMBIGUITY_LEVELS.includes(data.ambiguityLevel)) {
    return { valid: false, reason: `invalid_ambiguityLevel: ${data.ambiguityLevel}` };
  }

  return { valid: true };
}

let sharedClientInstance = null;

/**
 * Builds or reuses persistent OpenAI client instance to avoid cold TCP/TLS negotiation overhead.
 */
function resolveClient(customClient, timeoutMs) {
  if (customClient) return customClient;
  if (!sharedClientInstance) {
    const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
    if (!apiKey) return null;
    sharedClientInstance = new OpenAI({
      apiKey,
      timeout: timeoutMs || 15000,
      maxRetries: 0
    });
  }
  return sharedClientInstance;
}

function _resetSharedClientForTesting() {
  sharedClientInstance = null;
}

/**
 * Parses user natural language query into a typed SemanticInterpretation.
 *
 * @param {Object} input
 * @param {string} input.rawQuery
 * @param {Array<Object>} [input.conversationHistory]
 * @param {Object} [options]
 * @param {OpenAI} [options.client] - Injected client for testing
 * @param {number} [options.timeoutMs] - Execution timeout budget (default: 800 ms)
 * @param {string} [options.model] - Model name (default: gpt-4o-mini)
 * @returns {Promise<Object>} SemanticInterpretation
 */
async function parseSemanticInterpretation(input, options = {}) {
  const rawQuery = typeof input === 'string' ? input.trim() : String(input?.rawQuery || '').trim();
  if (!rawQuery) {
    return buildSafeUnknownInterpretation('', 'empty_query');
  }

  const timeoutMs = parseInt(options.timeoutMs || process.env.SEMANTIC_PARSER_TIMEOUT_MS || '4500', 10);
  const model = String(
    options.model ||
    process.env.SEMANTIC_PARSER_MODEL ||
    process.env.OPENAI_MODEL ||
    process.env.OPENAI_SEMANTIC_RAG_MODEL ||
    process.env.OPENAI_RAG_MODEL ||
    'gpt-6-luna'
  ).trim();

  const client = resolveClient(options.client, timeoutMs);
  if (!client) {
    logger.warn({ rawQuery }, '[modelSemanticParser] OpenAI client not configured; failing closed to safe UNKNOWN');
    return buildSafeUnknownInterpretation(rawQuery, 'no_client_available');
  }

  // Keep history concise (last 2 turns, max 150 chars each) to prevent token footprint explosion
  const history = Array.isArray(input.conversationHistory)
    ? input.conversationHistory.slice(-2).map(turn => ({
        role: turn.role === 'assistant' ? 'assistant' : 'user',
        content: String(turn.content || turn.userText || turn.assistantText || '').trim().slice(0, 150)
      }))
    : [];

  const messages = [
    { role: 'system', content: SYSTEM_PARSER_INSTRUCTION },
    ...history,
    { role: 'user', content: rawQuery }
  ];

  const startTime = Date.now();
  const abortController = new AbortController();
  let timerId = null;

  try {
    const timeoutPromise = new Promise((_, reject) => {
      timerId = setTimeout(() => {
        try {
          abortController.abort();
        } catch (_) {}
        const timeoutErr = new Error(`modelSemanticParser execution exceeded timeout budget of ${timeoutMs}ms`);
        timeoutErr.name = 'TimeoutError';
        reject(timeoutErr);
      }, timeoutMs);
      if (typeof timerId.unref === 'function') timerId.unref();
    });

    const providerStart = Date.now();
    const isNewerGptModel = /^gpt-(?:[4-9]|4o)/i.test(model) || /^o\d/i.test(model);
    const isGpt6OrReasoning = /gpt-6|luna|o1|o3/i.test(model);
    const tokenLimit = parseInt(process.env.SEMANTIC_PARSER_MAX_TOKENS || (options && options.tokenLimit) || '800', 10);
    const requestPayload = {
      model,
      messages,
      response_format: {
        type: 'json_schema',
        json_schema: SEMANTIC_INTERPRETATION_JSON_SCHEMA
      }
    };

    if (!isGpt6OrReasoning) {
      requestPayload.temperature = 0.0;
    }

    if (isNewerGptModel) {
      requestPayload.max_completion_tokens = tokenLimit;
    } else {
      requestPayload.max_tokens = tokenLimit;
    }

    const sanitizedPayload = sanitizeOpenAiChatPayload(requestPayload);

    // Controlled adaptive API execution with empirical parameter retry
    const callApi = async () => {
      try {
        return await client.chat.completions.create(sanitizedPayload, { signal: abortController.signal });
      } catch (apiErr) {
        const msg = String(apiErr?.message || '');
        // 1. Empirical proof: Model rejects non-default temperature
        if (/temperature/i.test(msg) && sanitizedPayload.temperature !== undefined) {
          logger.warn({ status: apiErr.status, reason: 'temperature_rejected' }, '[modelSemanticParser] API rejected temperature parameter; retrying without temperature');
          const retryPayload = { ...sanitizedPayload };
          delete retryPayload.temperature;
          delete retryPayload.top_p;
          return await client.chat.completions.create(retryPayload, { signal: abortController.signal });
        }
        // 2. Empirical proof: Model rejects max_tokens in favor of max_completion_tokens
        if (/max_tokens/i.test(msg) && sanitizedPayload.max_tokens !== undefined) {
          logger.warn({ status: apiErr.status, reason: 'max_tokens_rejected' }, '[modelSemanticParser] API rejected max_tokens; retrying with max_completion_tokens');
          const retryPayload = { ...sanitizedPayload };
          retryPayload.max_completion_tokens = retryPayload.max_tokens;
          delete retryPayload.max_tokens;
          return await client.chat.completions.create(retryPayload, { signal: abortController.signal });
        }
        throw apiErr;
      }
    };

    const response = await Promise.race([
      callApi(),
      timeoutPromise
    ]);
    const providerLatencyMs = Date.now() - providerStart;

    const parseStart = Date.now();
    const rawContent = response?.choices?.[0]?.message?.content;


    if (!rawContent) {
      const elapsedMs = Date.now() - startTime;
      logger.warn({ rawQuery, elapsedMs }, '[modelSemanticParser] Empty content from model');
      return buildSafeUnknownInterpretation(rawQuery, 'empty_response', {
        requestedModel: model,
        responseModel: response?.model || null,
        providerLatencyMs,
        totalLatencyMs: elapsedMs
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(rawContent);
    } catch (parseErr) {
      const elapsedMs = Date.now() - startTime;
      logger.warn({ rawQuery, err: parseErr.message, elapsedMs }, '[modelSemanticParser] Malformed JSON from model');
      return buildSafeUnknownInterpretation(rawQuery, 'json_parse_error', {
        requestedModel: model,
        responseModel: response?.model || null,
        providerLatencyMs,
        totalLatencyMs: elapsedMs
      });
    }

    const validation = validateInterpretationSchema(parsed);
    const parserProcessingMs = Date.now() - parseStart;
    const totalLatencyMs = Date.now() - startTime;

    if (!validation.valid) {
      logger.warn({ rawQuery, reason: validation.reason, totalLatencyMs }, '[modelSemanticParser] Schema validation failed on model output');
      return buildSafeUnknownInterpretation(rawQuery, `schema_violation_${validation.reason}`, {
        requestedModel: model,
        responseModel: response?.model || null,
        providerLatencyMs,
        parserProcessingMs,
        totalLatencyMs
      });
    }

    // Attach metadata about parse execution
    return {
      ...parsed,
      metadata: {
        fallbackInvoked: false,
        model,
        responseModel: response?.model || model,
        requestId: response?.id || null,
        providerLatencyMs,
        parserProcessingMs,
        totalLatencyMs,
        elapsedMs: totalLatencyMs
      }
    };
  } catch (err) {
    const elapsedMs = Date.now() - startTime;
    const isTimeout =
      err?.name === 'TimeoutError' ||
      err?.name === 'AbortError' ||
      /timeout|aborted/i.test(err?.message || '') ||
      elapsedMs >= timeoutMs;
    logger.warn({ rawQuery, err: err?.message, isTimeout, elapsedMs }, '[modelSemanticParser] Execution failed; failing closed');
    return buildSafeUnknownInterpretation(rawQuery, isTimeout ? 'timeout' : 'provider_error', {
      totalLatencyMs: elapsedMs,
      elapsedMs
    });
  } finally {
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
  }
}

module.exports = {
  parseSemanticInterpretation,
  buildSafeUnknownInterpretation,
  validateInterpretationSchema,
  ALLOWED_SPEECH_ACTS,
  ALLOWED_SEMANTIC_CONCEPTS,
  ALLOWED_REQUESTED_ASPECTS,
  ALLOWED_INFERRED_CATEGORIES,
  ALLOWED_AMBIGUITY_LEVELS,
  ALLOWED_REFERENCE_TYPES,
  SEMANTIC_INTERPRETATION_JSON_SCHEMA,
  SYSTEM_PARSER_INSTRUCTION,
  _resetSharedClientForTesting
};
