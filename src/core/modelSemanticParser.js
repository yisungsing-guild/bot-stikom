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
const { globalBudgetLedger } = require('./budgetLedger');

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
  'academic_event',
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

const ALLOWED_TOPIC_CONTINUITY = Object.freeze([
  'NEW_TOPIC',
  'CONTINUATION',
  'CLARIFICATION'
]);

const ALLOWED_EXECUTION_ROUTES = Object.freeze([
  'RAG_RETRIEVAL',
  'CONVERSATIONAL',
  'ACADEMIC_RECOMMENDATION',
  'DIRECT_CATALOG',
  'UNKNOWN'
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
      primaryIntent: {
        type: 'string'
      },
      userInterest: {
        type: ['string', 'null']
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
          },
          topicContinuity: {
            type: 'string',
            enum: ALLOWED_TOPIC_CONTINUITY
          },
          relevantPriorContext: {
            type: ['string', 'null']
          }
        },
        required: ['isFollowUp', 'referenceType', 'topicContinuity', 'relevantPriorContext'],
        additionalProperties: false
      },
      executionRoute: {
        type: 'string',
        enum: ALLOWED_EXECUTION_ROUTES
      },
      confidence: { type: 'number' },
      ambiguityLevel: {
        type: 'string',
        enum: ALLOWED_AMBIGUITY_LEVELS
      }
    },
    required: [
      'speechAct',
      'primaryIntent',
      'userInterest',
      'semanticConcepts',
      'candidateEntities',
      'requestedAspects',
      'scopeConstraints',
      'contextDependency',
      'executionRoute',
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

Execution Routes:
- RAG_RETRIEVAL: Factual query requiring verified retrieval from knowledge base.
- CONVERSATIONAL: Sapaan, small talk, acknowledgement, non-factual pleasantries.
- ACADEMIC_RECOMMENDATION: Asking advice or recommendation for study programs based on personal interest, hobby, or background (e.g. "cocok masuk jurusan apa").
- DIRECT_CATALOG: Exploring what programs exist or faculty mapping without deep search.
- UNKNOWN: Incomprehensible, unsupported, or out-of-domain inquiries.

Topic Continuity:
- NEW_TOPIC: Fresh inquiry or clear domain switch from previous topic (e.g. changing from prodi to admission wave schedule).
- CONTINUATION: Genuine ellipsis or anaphora carrying over the previous entity/topic.
- CLARIFICATION: User clarifying a previous ambiguous statement.

Rules:
1. Understand colloquial Indonesian, abbreviations, typos, and slang by SEMANTIC MEANING, not literal character matching.
2. DO NOT answer questions or invent facts/catalogs.
3. Candidate entities: Extract ONLY specific named entities (programs, institutions, specific clubs/organizations, specific partners). DO NOT extract generic common nouns, verbs, or full prepositional phrases as candidate entities (e.g. "maba", "awal masuk", "calon pendaftar lokal", "upload bukti", "konsultasi", "registrasi online" are NOT candidate entities; they belong to aspects/concepts).
4. For follow-ups (ellipsis/anaphora), set contextDependency.isFollowUp=true with appropriate referenceType, topicContinuity="CONTINUATION", and relevantPriorContext. If the turn introduces a new question or domain, set topicContinuity="NEW_TOPIC" and isFollowUp=false.
5. For multi-entity or inherently ambiguous inquiries, preserve all candidate entities and set ambiguityLevel="HIGH".
6. For recommendation / advice inquiries (speechAct="SEEK_ADVICE" or executionRoute="ACADEMIC_RECOMMENDATION"), populate userInterest with the normalized summary of the user's stated interest, hobby, career goal, or constraint (e.g. "analisis sistem dan manajemen basis data", "desain komunikasi visual dan ilustrasi", "pemasaran digital dan live commerce"), or null if none is stated.
7. Return only the structured JSON adhering strictly to the schema.`;

/**
 * Creates a deterministic, safe UNKNOWN / HIGH_AMBIGUITY interpretation.
 * Invoked on provider failure, timeout, schema violation, or unparsable output.
 * NEVER performs regex-based guessing.
 */
function buildSafeUnknownInterpretation(rawQuery, reason = 'unknown', extraMeta = {}) {
  return {
    speechAct: 'UNKNOWN',
    primaryIntent: 'UNKNOWN',
    userInterest: null,
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
      referenceType: 'none',
      topicContinuity: 'NEW_TOPIC',
      relevantPriorContext: null
    },
    executionRoute: 'UNKNOWN',
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

  if (data.userInterest !== undefined && data.userInterest !== null && typeof data.userInterest !== 'string') {
    return { valid: false, reason: 'invalid_userInterest' };
  }
  if (data.userInterest === undefined) {
    data.userInterest = null;
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

  // Ensure topicContinuity & relevantPriorContext backwards compatibility
  if (data.contextDependency.topicContinuity && !ALLOWED_TOPIC_CONTINUITY.includes(data.contextDependency.topicContinuity)) {
    return { valid: false, reason: `invalid_topicContinuity: ${data.contextDependency.topicContinuity}` };
  }
  if (!data.contextDependency.topicContinuity) {
    data.contextDependency.topicContinuity = data.contextDependency.isFollowUp ? 'CONTINUATION' : 'NEW_TOPIC';
  }
  if (data.contextDependency.relevantPriorContext === undefined) {
    data.contextDependency.relevantPriorContext = null;
  }

  // Ensure primaryIntent & executionRoute backwards compatibility
  if (data.executionRoute && !ALLOWED_EXECUTION_ROUTES.includes(data.executionRoute)) {
    return { valid: false, reason: `invalid_executionRoute: ${data.executionRoute}` };
  }
  if (!data.executionRoute) {
    if (data.speechAct === 'GENERAL_GREETING') data.executionRoute = 'CONVERSATIONAL';
    else if (data.speechAct === 'SEEK_ADVICE') data.executionRoute = 'ACADEMIC_RECOMMENDATION';
    else data.executionRoute = 'RAG_RETRIEVAL';
  }
  if (!data.primaryIntent) {
    data.primaryIntent = data.speechAct === 'GENERAL_GREETING' ? 'CONVERSATIONAL_GREETING' : (data.speechAct === 'SEEK_ADVICE' ? 'PROGRAM_RECOMMENDATION' : 'UNKNOWN');
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
  // Prevent tests from accidentally reading local credentials and initiating paid live API calls
  if (process.env.NODE_ENV === 'test' && process.env.ALLOW_LIVE_OPENAI_TESTS !== 'true' && process.env.MODEL_SEMANTIC_REAL_TEST !== 'true') {
    return null;
  }
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

  const timeoutMs = parseInt(options.timeoutMs || process.env.SEMANTIC_PARSER_TIMEOUT_MS || '15000', 10);
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

    const tokenLimit = options.maxCompletionTokens || 300;
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

    const isTestRuntime = process.env.NODE_ENV === 'test' || Boolean(options.client);
    const ledger = (!isTestRuntime && (options.budgetLedger || (globalBudgetLedger.isAvailable() ? globalBudgetLedger : null)));
    let reservation = null;

    if (ledger) {
      reservation = await ledger.reserveBudget({
        purpose: 'call_1_semantic_parser',
        model,
        maxPromptTokens: 500,
        maxCompletionTokens: tokenLimit,
        maxBudgetUSD: options.maxBudgetUSD,
        operationId: options.operationId,
        now: options.now || new Date()
      });

      if (!reservation.allowed) {
        const elapsedMs = Date.now() - startTime;
        logger.warn({ rawQuery, reason: reservation.reason, model }, '[modelSemanticParser] Budget reservation denied; failing closed to safe UNKNOWN');
        return buildSafeUnknownInterpretation(rawQuery, reservation.reason || 'budget_reservation_denied', {
          requestedModel: model,
          budgetExceeded: reservation.reason === 'DAILY_BUDGET_EXCEEDED',
          reservation,
          totalLatencyMs: elapsedMs,
          elapsedMs
        });
      }
    } else if (process.env.NODE_ENV !== 'test' && !options.client) {
      const elapsedMs = Date.now() - startTime;
      logger.warn({ rawQuery }, '[modelSemanticParser] Persistent budget ledger unavailable in non-test runtime; failing closed');
      return buildSafeUnknownInterpretation(rawQuery, 'PERSISTENT_LEDGER_UNAVAILABLE', {
        requestedModel: model,
        budgetExceeded: false,
        totalLatencyMs: elapsedMs,
        elapsedMs
      });
    }

    let response;
    try {
      response = await Promise.race([
        client.chat.completions.create(
          sanitizedPayload,
          { signal: abortController.signal }
        ),
        timeoutPromise
      ]);
    } catch (apiErr) {
      if (reservation && reservation.reservationId) {
        const isTimeout =
          apiErr?.name === 'TimeoutError' ||
          apiErr?.name === 'AbortError' ||
          /timeout|aborted/i.test(apiErr?.message || '');
        await ledger.reconcileBudget({
          reservationId: reservation.reservationId,
          reservedUSD: reservation.reservedUSD,
          model,
          error: apiErr,
          isPreRequest: false,
          status: isTimeout ? 'AMBIGUOUS_FAILURE' : 'FAILED'
        });
      }
      throw apiErr;
    }

    const providerLatencyMs = Date.now() - providerStart;

    // Reconcile budget on success with verified token usage
    const usage = response?.usage;
    const promptTokens = usage?.prompt_tokens || 0;
    const completionTokens = usage?.completion_tokens || 0;
    if (reservation && reservation.reservationId) {
      await ledger.reconcileBudget({
        reservationId: reservation.reservationId,
        reservedUSD: reservation.reservedUSD,
        actualPromptTokens: promptTokens,
        actualCompletionTokens: completionTokens,
        model,
        status: 'SUCCESS'
      });
    }

    const parseStart = Date.now();
    const choice = response?.choices?.[0];
    const refusal = choice?.message?.refusal;
    if (refusal) {
      const elapsedMs = Date.now() - startTime;
      logger.warn({ rawQuery, refusal, elapsedMs }, '[modelSemanticParser] Model returned explicit refusal');
      return buildSafeUnknownInterpretation(rawQuery, 'model_refusal', {
        requestedModel: model,
        responseModel: response?.model || null,
        providerLatencyMs,
        totalLatencyMs: elapsedMs,
        refusal
      });
    }

    const rawContent = choice?.message?.content;
    if (!rawContent || (typeof rawContent === 'string' && rawContent.trim() === '')) {
      const elapsedMs = Date.now() - startTime;
      const finishReason = choice?.finish_reason;
      logger.warn({ rawQuery, finishReason, elapsedMs }, '[modelSemanticParser] Empty content from model');
      return buildSafeUnknownInterpretation(rawQuery, finishReason === 'length' ? 'token_limit_exceeded' : 'empty_response', {
        requestedModel: model,
        responseModel: response?.model || null,
        providerLatencyMs,
        totalLatencyMs: elapsedMs,
        finishReason
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
  ALLOWED_TOPIC_CONTINUITY,
  ALLOWED_EXECUTION_ROUTES,
  SEMANTIC_INTERPRETATION_JSON_SCHEMA,
  SYSTEM_PARSER_INSTRUCTION,
  _resetSharedClientForTesting
};
