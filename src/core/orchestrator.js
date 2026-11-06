'use strict';

/**
 * src/core/orchestrator.js
 *
 * Greenfield Single Decision Maker Orchestrator.
 * Connects the entire end-to-end pipeline:
 *
 * Inbound Query
 * -> SemanticFrameResolver
 * -> MultiIntentResolver
 * -> RetrievalPlanner
 * -> RetrievalService
 * -> EvidenceArbiter
 * -> AnswerabilityGate
 * -> GroundedAnswerGenerator
 * -> FinalAnswerVerifier
 * -> OutboundRenderer & Dispatcher
 */

const { getSession, updateSession } = require('./conversationState');
const { decomposeQuery, decomposeQueryAsync, hasMultipleIntents, hasAnaphoricReference } = require('./multiIntentResolver');
const { buildRetrievalPlan } = require('./retrievalPlanner');
const { retrieveCandidates } = require('./retrievalService');
const { arbitrateEvidence } = require('./evidenceArbiter');
const { evaluateAnswerability, ANSWERABILITY_STATUS } = require('./answerabilityGate');
const groundedAnswerGenerator = require('./groundedAnswerGenerator');
const finalAnswerVerifier = require('./finalAnswerVerifier');
const { synthesizeAnswer, buildGenericExtractiveFallback } = groundedAnswerGenerator;
const { verifyFinalAnswer } = finalAnswerVerifier;
const outboundDispatcher = require('./outboundDispatcher');
const logger = require('../logger');
const { isPhase2Enabled, executePhase2Bridge } = require('../reasoning/phase2Bridge');
const { isPhase2ShadowModeEnabled, runShadowEvaluationSafely } = require('../reasoning/shadowEvaluator');
const { VERIFICATION_OUTCOME } = require('../reasoning/contracts');
const { isVerifiedAnswer, buildSafeUnknownResponse, buildClarificationResponse } = require('./answerabilityResponse');
const isUnifiedSemanticPipelineEnabled = () => false;
const processUnifiedTurn = null;

function appendConciseTurnHistory(existingHistory = [], userQuery = '', assistantAnswer = '') {
  const prev = Array.isArray(existingHistory) ? existingHistory.slice(-3) : [];
  const next = [...prev];
  if (userQuery && String(userQuery).trim()) {
    next.push({ role: 'user', content: String(userQuery).trim().slice(0, 150) });
  }
  if (assistantAnswer && String(assistantAnswer).trim()) {
    next.push({ role: 'assistant', content: String(assistantAnswer).trim().slice(0, 150) });
  }
  return next.slice(-4);
}

/**
 * Selects up to maxCount chunks from accepted evidence while preserving
 * balanced representation across all targetEntities.
 */
function selectBalancedEvidenceByEntity(accepted = [], targetEntities = [], maxCount = 10, requestedAttributes = []) {
  if (!Array.isArray(accepted) || accepted.length <= maxCount) {
    return Array.isArray(accepted) ? [...accepted] : [];
  }
  if (!Array.isArray(targetEntities) || targetEntities.length <= 1) {
    const docBuckets = new Map();
    for (const chunk of accepted) {
      const docKey = chunk.sourceFile || chunk.filename || (chunk.program ? `prog_${chunk.program}` : "default");
      if (!docBuckets.has(docKey)) docBuckets.set(docKey, []);
      docBuckets.get(docKey).push(chunk);
    }

    if (docBuckets.size > 1) {
      const selected = [];
      const seen = new Set();
      if (Array.isArray(requestedAttributes) && requestedAttributes.length >= 2) {
        for (let round = 0; round < 2 && selected.length < maxCount; round++) {
          for (const attr of requestedAttributes) {
            const match = accepted.find(c => {
              const key = c.id || c.chunkId || c.text || c;
              if (seen.has(key)) return false;
              const supp = Array.isArray(c.supportedAttributes) ? c.supportedAttributes : [];
              return supp.includes(attr);
            });
            if (match && selected.length < maxCount) {
              const key = match.id || match.chunkId || match.text || match;
              seen.add(key);
              selected.push(match);
            }
          }
        }
      }
      let addedInRound = true;

      while (selected.length < maxCount && addedInRound) {
        addedInRound = false;
        for (const [, list] of docBuckets.entries()) {
          const next = list.find(c => !seen.has(c.id || c.chunkId || c.text || c));
          if (next && selected.length < maxCount) {
            seen.add(next.id || next.chunkId || next.text || next);
            selected.push(next);
            addedInRound = true;
          }
        }
      }

      for (const chunk of accepted) {
        if (selected.length >= maxCount) break;
        const key = chunk.id || chunk.chunkId || chunk.text || chunk;
        if (!seen.has(key)) {
          seen.add(key);
          selected.push(chunk);
        }
      }

      return selected;
    }

    return accepted.slice(0, maxCount);
  }

  const buckets = new Map();
  for (const ent of targetEntities) {
    buckets.set(ent, []);
  }
  const generalBucket = [];

  for (const chunk of accepted) {
    const supported = Array.isArray(chunk.supportedEntities) ? chunk.supportedEntities : [];
    let matchedAny = false;
    for (const ent of targetEntities) {
      if (supported.some(s => String(s).toLowerCase() === String(ent).toLowerCase())) {
        buckets.get(ent).push(chunk);
        matchedAny = true;
      }
    }
    if (!matchedAny) {
      generalBucket.push(chunk);
    }
  }

  const selected = [];
  const seen = new Set();
  let addedInRound = true;

  while (selected.length < maxCount && addedInRound) {
    addedInRound = false;
    for (const ent of targetEntities) {
      const list = buckets.get(ent) || [];
      while (list.length > 0) {
        const candidate = list.shift();
        const key = candidate.id || candidate.chunkId || candidate.text || candidate;
        if (!seen.has(key)) {
          seen.add(key);
          selected.push(candidate);
          addedInRound = true;
          break;
        }
      }
      if (selected.length >= maxCount) break;
    }
  }

  for (const chunk of [...generalBucket, ...accepted]) {
    if (selected.length >= maxCount) break;
    const key = chunk.id || chunk.chunkId || chunk.text || chunk;
    if (!seen.has(key)) {
      seen.add(key);
      selected.push(chunk);
    }
  }

  return selected;
}

/**
 * Processes a single turn inquiry through the orchestrator.
 * If Unified Semantic Pipeline is enabled, routes to processUnifiedTurn (AI-driven understanding & synthesis).
 * If Phase 2 is enabled, executes via Phase 2 Bridge with single fallback to Phase 1.
 * If Phase 2 is disabled, runs Phase 1 deterministic pipeline directly.
 * If Phase 2 is disabled and Phase 2 Shadow Mode is enabled, fires shadow evaluation asynchronously.
 */
async function processTurn(chatId, rawQuery, { executeDispatch = false, executionMode, ...restOptions } = {}) {
  const isShadowMode = executionMode === 'SHADOW';

  if (isUnifiedSemanticPipelineEnabled() || restOptions.useUnifiedAI) {
    return await processUnifiedTurn(chatId, rawQuery, { executeDispatch, executionMode, ...restOptions });
  }

  if (isPhase2Enabled()) {
    const bridgeResult = await executePhase2Bridge(chatId, rawQuery, { executeDispatch, executionMode, ...restOptions }, (cId, q, opt) => {
      return runPhase1DeterministicPipeline(cId, q, opt);
    });

    if (bridgeResult && bridgeResult.structuredRecommendation) {
      // Orchestrator owns synthesis, verification, fallback, context commit, and outbound dispatch for recommendations
      const recResult = bridgeResult.structuredRecommendation;
      const candidateEntities = (recResult.scoredCandidates || []).map(c => ({
        canonical: c.canonicalName,
        name: c.label || c.canonicalName,
        programKey: c.programKey || c.program?.key,
        type: 'program'
      }));
      const topEntity = null;
      const baseSemanticFrame = recResult.semanticFrame || restOptions.semanticFrame || {};
      const frame = {
        ...baseSemanticFrame,
        domain: 'ACADEMIC_RECOMMENDATION',
        intent: 'PROGRAM_RECOMMENDATION',
        rawQuery,
        entities: candidateEntities
      };

      const arbitratedForRec = bridgeResult.arbitratedEvidence ||
        bridgeResult.subQueryResults?.[0]?.arbitrated ||
        { accepted: [] };
      const synthOpts = { ...arbitratedForRec };
      if (restOptions && restOptions.aiEngine) synthOpts.aiEngine = restOptions.aiEngine;
      if (restOptions && restOptions.budgetLedger) synthOpts.budgetLedger = restOptions.budgetLedger;
      if (restOptions && restOptions.fastFallback) synthOpts.fastFallback = true;
      if (restOptions && restOptions.signal) synthOpts.signal = restOptions.signal;

      const recAnswerability = evaluateAnswerability(frame, arbitratedForRec);
      let finalAnswer = null;
      let recVerification = null;

      if (
        recAnswerability.status === ANSWERABILITY_STATUS.ANSWERABLE ||
        recAnswerability.status === ANSWERABILITY_STATUS.PARTIAL ||
        recAnswerability.status === ANSWERABILITY_STATUS.CLARIFY
      ) {
        const synthRes = await synthesizeAnswer(frame, synthOpts, null, recResult);

        if (synthRes && synthRes.success && synthRes.answer) {
          const verifRes = verifyFinalAnswer(synthRes.answer, frame, arbitratedForRec, null, recResult);
          const verifiedRecommendation = verifRes?.pass === true &&
            verifRes.outcome === VERIFICATION_OUTCOME.VERIFIED_FACTUAL &&
            isVerifiedAnswer(synthRes.answer, verifRes);
          if (verifiedRecommendation) {
            finalAnswer = synthRes.answer;
            recVerification = verifRes;
          } else {
            logger.warn({ reason: verifRes ? verifRes.reason : 'unknown' }, '[Orchestrator] Recommendation answer blocked by verifier');
            finalAnswer = recAnswerability.status === ANSWERABILITY_STATUS.CLARIFY
              ? buildClarificationResponse(frame)
              : buildSafeUnknownResponse(frame, recAnswerability);
            const blockedOutcome = verifRes?.outcome === VERIFICATION_OUTCOME.SAFE_UNKNOWN
              ? VERIFICATION_OUTCOME.SAFE_UNKNOWN
              : VERIFICATION_OUTCOME.ESCALATION_GUIDANCE;
            recVerification = {
              ...(verifRes || {}),
              pass: false,
              outcome: blockedOutcome,
              interceptedFrom: VERIFICATION_OUTCOME.VERIFICATION_FAILED,
              isInterception: true,
              status: blockedOutcome,
              reason: verifRes?.reason || 'recommendation_blocked_escalation',
              isGrounded: false,
              handledSafely: true
            };
          }
        } else {
          finalAnswer = recAnswerability.status === ANSWERABILITY_STATUS.CLARIFY
            ? buildClarificationResponse(frame)
            : buildSafeUnknownResponse(frame, recAnswerability);
          recVerification = {
            pass: false,
            outcome: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
            interceptedFrom: null,
            isInterception: false,
            status: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
            reason: synthRes?.reason || 'recommendation_synthesis_failed',
            isGrounded: false,
            handledSafely: true
          };
        }
      } else {
        finalAnswer = recAnswerability.guidance || 'Mohon maaf Kak, informasi kurikulum resmi untuk minat tersebut belum dapat diverifikasi dari dokumen yang tersedia saat ini. Silakan berkonsultasi langsung dengan bagian admisi PMB ITB STIKOM Bali ya.';
        recVerification = {
          pass: false,
          outcome: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
          interceptedFrom: null,
          isInterception: false,
          status: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
          reason: recAnswerability.reason || 'insufficient_recommendation_evidence',
          isGrounded: false,
          handledSafely: true
        };
      }

      bridgeResult.finalAnswer = finalAnswer;
      bridgeResult.text = finalAnswer;
      bridgeResult.domain = frame.domain;
      bridgeResult.intent = frame.intent;
      bridgeResult.semanticFrame = frame;
      if (bridgeResult.subQueryResults && bridgeResult.subQueryResults[0]) {
        bridgeResult.subQueryResults[0].answer = finalAnswer;
        bridgeResult.subQueryResults[0].verification = recVerification;
      }

      // Atomic session persistence (Step 4 & Step 7 context commit)
      const turnControl = bridgeResult.turnControl;
      const canCommit = turnControl ? turnControl.canCommitSession('phase2') : true;
      const canSend = turnControl ? turnControl.canDispatch('phase2') : true;

      if (!isShadowMode && chatId && canCommit) {
        const existingSession = await getSession(chatId);
        const prevHist = existingSession?.data?.conversationHistory || [];
        await updateSession(chatId, {
          dataPatch: {
            activeDomain: 'academic_recommendation',
            activeEntity: topEntity,
            recommendationRelations: recResult.contextRelations,
            lastQuery: rawQuery,
            lastAnswer: finalAnswer,
            conversationHistory: appendConciseTurnHistory(prevHist, rawQuery, finalAnswer)
          }
        });
      }

      if (!isShadowMode && executeDispatch && chatId && finalAnswer && canSend) {
        await outboundDispatcher.sendOutboundMessage(chatId, finalAnswer);
      }

      return bridgeResult;
    }

    if (bridgeResult && bridgeResult.comparisonEnvelope) {
      // Orchestrator owns synthesis, verification, fallback, and outbound dispatch for comparative evaluations
      const targetEntities = bridgeResult.targetEntities || [];
      const frame = { domain: 'ACADEMIC_PROGRAM', intent: 'ask_program_comparison', entities: targetEntities, rawQuery };

      let finalAnswer = null;
      let compVerification = null;
      const synthRes = await synthesizeAnswer(frame, {}, bridgeResult.comparisonEnvelope);

      if (synthRes && synthRes.success && synthRes.answer) {
        const verifRes = verifyFinalAnswer(synthRes.answer, frame, {}, bridgeResult.comparisonEnvelope);
        const verifiedComparison = verifRes?.pass === true &&
          verifRes.outcome === VERIFICATION_OUTCOME.VERIFIED_FACTUAL &&
          isVerifiedAnswer(synthRes.answer, verifRes);
        if (verifiedComparison) {
          finalAnswer = synthRes.answer;
          compVerification = verifRes;
        } else {
          logger.warn({ reason: verifRes ? verifRes.reason : 'unknown' }, '[Orchestrator] Comparative answer blocked by verifier');
          finalAnswer = buildSafeUnknownResponse(frame, {});
          const blockedOutcome = verifRes?.outcome === VERIFICATION_OUTCOME.SAFE_UNKNOWN
            ? VERIFICATION_OUTCOME.SAFE_UNKNOWN
            : VERIFICATION_OUTCOME.ESCALATION_GUIDANCE;
          compVerification = {
            ...(verifRes || {}),
            pass: false,
            outcome: blockedOutcome,
            interceptedFrom: VERIFICATION_OUTCOME.VERIFICATION_FAILED,
            isInterception: true,
            status: blockedOutcome,
            reason: verifRes?.reason || 'comparative_blocked_escalation',
            isGrounded: false,
            handledSafely: true
          };
        }
      } else {
        finalAnswer = buildSafeUnknownResponse(frame, {});
        compVerification = {
          pass: false,
          outcome: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
          interceptedFrom: null,
          isInterception: false,
          status: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
          reason: 'comparative_synthesis_failed',
          isGrounded: false,
          handledSafely: true
        };
      }

      bridgeResult.finalAnswer = finalAnswer;
      bridgeResult.text = finalAnswer;
      bridgeResult.domain = frame.domain;
      bridgeResult.intent = frame.intent;
      bridgeResult.semanticFrame = frame;
      if (bridgeResult.subQueryResults && bridgeResult.subQueryResults[0]) {
        bridgeResult.subQueryResults[0].answer = finalAnswer;
        bridgeResult.subQueryResults[0].verification = compVerification;
      }

      // Atomic session persistence
      const turnControl = bridgeResult.turnControl;
      const canCommit = turnControl ? turnControl.canCommitSession('phase2') : true;
      const canSend = turnControl ? turnControl.canDispatch('phase2') : true;

      if (!isShadowMode && chatId && bridgeResult.plan && bridgeResult.plan.contextDelta && bridgeResult.plan.contextDelta.resolvedState && canCommit) {
        const deltaState = bridgeResult.plan.contextDelta.resolvedState;
        const existingSession = await getSession(chatId);
        const prevHist = existingSession?.data?.conversationHistory || [];
        await updateSession(chatId, {
          dataPatch: {
            activeDomain: deltaState.activeDomain,
            activeEntity: deltaState.activeEntity,
            preservedBackgroundEntity: deltaState.preservedBackgroundEntity,
            entityProvenance: deltaState.entityProvenance,
            lastQuery: rawQuery,
            lastAnswer: finalAnswer,
            conversationHistory: appendConciseTurnHistory(prevHist, rawQuery, finalAnswer)
          }
        });
      }

      if (!isShadowMode && executeDispatch && chatId && finalAnswer && canSend) {
        await outboundDispatcher.sendOutboundMessage(chatId, finalAnswer);
      }

      return bridgeResult;
    }

    return bridgeResult;
  }

  // Phase 2 is disabled. Check if Shadow Mode is enabled.
  if (isPhase2ShadowModeEnabled() && !isShadowMode) {
    const p1StartTime = Date.now();
    const p1Result = await runPhase1DeterministicPipeline(chatId, rawQuery, { executeDispatch, executionMode, ...restOptions });
    const p1LatencyMs = Date.now() - p1StartTime;

    // Fire asynchronously - never awaited by Phase 1 critical path
    setImmediate(() => {
      runShadowEvaluationSafely({
        chatId,
        rawQuery,
        p1Result,
        p1LatencyMs,
        phase1PipelineFn: runPhase1DeterministicPipeline
      }).catch(() => { });
    });

    return p1Result;
  }

  return runPhase1DeterministicPipeline(chatId, rawQuery, { executeDispatch, executionMode, ...restOptions });
}

/**
 * Validates that a precomputed semanticFrame strictly matches the rawQuery being processed.
 * Prevents stale or cross-turn frame reuse from corrupting pipeline execution.
 */
function isSemanticFrameMatchingQuery(frame, rawQuery) {
  if (!frame || typeof frame !== 'object') return false;
  if (typeof rawQuery !== 'string') return false;

  const targetRaw = rawQuery.trim();
  const targetNorm = targetRaw.toLowerCase().replace(/\s+/g, ' ');

  const frameRaw = typeof frame.rawQuery === 'string'
    ? frame.rawQuery.trim()
    : (typeof frame.raw === 'string' ? frame.raw.trim() : (typeof frame.query === 'string' ? frame.query.trim() : null));

  if (frameRaw !== null) {
    if (frameRaw === targetRaw || frameRaw.toLowerCase() === targetRaw.toLowerCase()) {
      return true;
    }
  }

  if (typeof frame.normalizedQuery === 'string') {
    const frameNorm = frame.normalizedQuery.trim().toLowerCase().replace(/\s+/g, ' ');
    if (frameNorm === targetNorm) {
      return true;
    }
  }

  return false;
}

/**
 * Pure deterministic Phase 1 pipeline execution.
 * Returns structured result for shadow logging or outbound delivery.
 */
async function runPhase1DeterministicPipeline(chatId, rawQuery, options = {}) {
  const { executeDispatch = false, executionMode, sessionSnapshot, turnControl, fastFallback, signal } = options;
  const isShadowMode = executionMode === 'SHADOW';
  const session = sessionSnapshot
    ? JSON.parse(JSON.stringify(sessionSnapshot))
    : await getSession(chatId);
  const sessionData = session ? (session.data || {}) : {};

  // 1. Decompose Query into SemanticFrames
  let subFrames;
  const isFrameReusable = options.semanticFrame &&
    isSemanticFrameMatchingQuery(options.semanticFrame, rawQuery) &&
    typeof hasMultipleIntents === 'function' &&
    !hasMultipleIntents(rawQuery);

  if (isFrameReusable) {
    subFrames = [options.semanticFrame];
  } else {
    subFrames = (typeof decomposeQueryAsync === 'function' && !options.syncOnly)
      ? await decomposeQueryAsync(rawQuery, sessionData, options)
      : decomposeQuery(rawQuery, sessionData);
  }

  const subQueryResults = [];

  for (const frame of subFrames) {
    // Check if planner passed unsupported entity flag
    if (options.unsupportedEntity || options.plannerExecutionPlan?.unsupportedEntity) {
      frame.unsupportedEntity = true;
      frame.unsupportedEntityName = options.unsupportedEntityName || options.plannerExecutionPlan?.unsupportedEntityName;
      frame.entityResolutionStatus = 'UNSUPPORTED';
      frame.isUnsupportedEntity = true;
      frame.unsupportedProgramName = frame.unsupportedEntityName;
      frame.domain = 'UNSUPPORTED_PROGRAM';
      frame.intent = 'UNSUPPORTED_PROGRAM_INQUIRY';
      frame.retrievalRequired = false;
    }

    // Explicit Unsupported / Unconfirmed Entity Fail-Closed Hand-off
    if (frame.unsupportedEntity || frame.isUnsupportedEntity || frame.domain === 'UNSUPPORTED_PROGRAM' || frame.unconfirmedProgram) {
      const progName = frame.unconfirmedProgram || frame.unsupportedEntityName || frame.unsupportedProgramName;
      const synthRes = await synthesizeAnswer(frame, {
        unsupportedEntity: true,
        unsupportedEntityName: progName,
        unconfirmedProgram: frame.unconfirmedProgram,
        retrievalPlan: {
          unsupportedEntity: true,
          unsupportedEntityName: progName,
          unconfirmedProgram: frame.unconfirmedProgram
        }
      });
      const verifRes = verifyFinalAnswer(synthRes.answer, frame, {
        unsupportedEntity: true,
        unsupportedEntityName: progName,
        unconfirmedProgram: frame.unconfirmedProgram,
        retrievalPlan: {
          unsupportedEntity: true,
          unsupportedEntityName: progName,
          unconfirmedProgram: frame.unconfirmedProgram
        }
      });
      const unsupportedAnswerVerified = synthRes?.success === true &&
        ((verifRes?.pass === true && verifRes.outcome === VERIFICATION_OUTCOME.VERIFIED_FACTUAL && isVerifiedAnswer(synthRes.answer, verifRes)) ||
          (verifRes?.handledSafely === true && verifRes?.outcome === VERIFICATION_OUTCOME.SAFE_UNKNOWN));
      const unsupportedSafeAnswer = unsupportedAnswerVerified
        ? synthRes.answer
        : buildSafeUnknownResponse(frame, {});
      const unsupportedVerification = unsupportedAnswerVerified
        ? verifRes
        : {
          ...(verifRes || {}),
          pass: false,
          outcome: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
          status: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
          reason: verifRes?.reason || 'unsupported_entity_not_factually_verified',
          isGrounded: false,
          handledSafely: true
        };
      subQueryResults.push({
        frame,
        semanticFrame: frame,
        plan: null,
        candidates: [],
        allCandidates: [],
        preArbitrationTop12: [],
        candidatesCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        answerability: ANSWERABILITY_STATUS.UNKNOWN,
        status: frame.unconfirmedProgram ? 'unconfirmed_program' : 'unsupported_program',
        answer: unsupportedSafeAnswer,
        verification: unsupportedVerification,
        arbitrated: { accepted: [], rejected: [] },
        arbitratedEvidence: { accepted: [], rejected: [] }
      });
      continue;
    }

    // Explicit Out-of-Domain Terminal Hand-off
    if (frame.domain === 'OUT_OF_DOMAIN' || frame.intent === 'OUT_OF_DOMAIN_INQUIRY') {
      const isGambling = frame.intent === 'OUT_OF_DOMAIN_GAMBLING';
      const oodReply = isGambling
        ? (frame.language === 'en'
          ? 'I apologize, but as the virtual assistant of ITB STIKOM Bali, I do not provide lottery predictions or gambling-related content. I only provide official campus information regarding admissions, study programs, and academics.'
          : 'Mohon maaf, saya adalah asisten virtual resmi ITB STIKOM Bali dan tidak melayani ramalan, prediksi angka togel, atau perjudian. Layanan ini khusus menyediakan informasi akademik, pendaftaran mahasiswa baru (PMB), program studi, biaya kuliah, dan fasilitas kampus ITB STIKOM Bali.')
        : (frame.language === 'en'
          ? 'I apologize, but I currently specialize in providing information regarding academics, admissions (PMB), study programs, tuition fees, and facilities at ITB STIKOM Bali. Your question is outside our campus information service scope.'
          : 'Mohon maaf, layanan ini khusus melayani informasi seputar akademik, PMB, program studi, biaya kuliah, dan fasilitas ITB STIKOM Bali. Pertanyaan Anda berada di luar cakupan layanan informasi kampus kami.');
      subQueryResults.push({
        frame,
        semanticFrame: frame,
        plan: null,
        candidates: [],
        allCandidates: [],
        preArbitrationTop12: [],
        candidatesCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        answerability: 'OUT_OF_DOMAIN',
        status: 'out_of_domain',
        answer: oodReply,
        verification: {
          pass: false,
          outcome: isGambling ? 'OUT_OF_DOMAIN' : VERIFICATION_OUTCOME.ESCALATION_GUIDANCE,
          interceptedFrom: null,
          isInterception: false,
          status: isGambling ? 'OUT_OF_DOMAIN' : VERIFICATION_OUTCOME.ESCALATION_GUIDANCE,
          reason: isGambling ? 'gambling_prohibited' : 'out_of_domain_terminal',
          isGrounded: false,
          handledSafely: true
        },
        arbitrated: { accepted: [], rejected: [] },
        arbitratedEvidence: { accepted: [], rejected: [] }
      });
      continue;
    }

    // Check if conversational non-retrieval intent
    if (frame.domain === 'CONVERSATIONAL' || frame.retrievalRequired === false) {
      let reply = '';
      const isEnglish = frame.language === 'en' || frame.detectedLanguage === 'en';
      if (frame.intent === 'PRIVACY_DATA_REFUSAL') {
        reply = isEnglish
          ? 'I apologize, but to protect student privacy and confidentiality in accordance with institutional policy, I cannot display or disclose personal data (such as phone numbers, addresses, or profiles) of other students. Official data requests must follow authorized university procedures.'
          : 'Mohon maaf, demi menjaga kerahasiaan dan privasi data pribadi mahasiswa sesuai kebijakan institusi dan ketentuan perlindungan data, saya tidak dapat menampilkan atau memberikan data pribadi (seperti nomor telepon, alamat, data akademik, atau profil) mahasiswa lain. Permohonan data resmi hanya dapat diproses oleh unit administrasi kampus yang berwenang melalui prosedur dan otorisasi yang sah.';
      } else if (frame.intent === 'TRANSFER_ADMISSION_INQUIRY') {
        reply = isEnglish
          ? 'Regarding transfer admissions from other universities/colleges (alih bentuk or transfer students), the official detailed requirements, admission procedures, and course credit conversion guidelines are currently not detailed in the available PMB publication documents.\n\nProspective transfer students are advised to contact the Admissions Office (Panitia PMB) directly via hotline (0361) 244445, visit the PMB Service Room at Renon Campus, or check https://pmb.stikom-bali.ac.id for personalized credit evaluation and formal transfer procedures.'
          : 'Mengenai penerimaan mahasiswa pindahan (alih bentuk atau transfer kuliah dari perguruan tinggi lain), ketentuan resmi, syarat administrasi, dan prosedur konversi/transfer kredit mata kuliah saat ini belum tercantum secara rinci pada dokumen informasi PMB yang tersedia.\n\nCalon mahasiswa pindahan disarankan untuk langsung berkonsultasi dengan Panitia PMB / Ruang Layanan PMB ITB STIKOM Bali (Kampus Renon) atau menghubungi kontak admisi di **(0361) 244445** serta mengunjungi portal **https://pmb.stikom-bali.ac.id** untuk verifikasi transkrip nilai dan prosedur perpindahan program studi secara resmi.';
      } else if (frame.intent === 'OUT_OF_DOMAIN_GAMBLING') {
        reply = isEnglish
          ? 'I apologize, but as the virtual assistant of ITB STIKOM Bali, I do not provide lottery predictions or gambling-related content. I only provide official campus information regarding admissions, study programs, and academics.'
          : 'Mohon maaf, saya adalah asisten virtual resmi ITB STIKOM Bali dan tidak melayani ramalan, prediksi angka togel, atau perjudian. Layanan ini khusus menyediakan informasi akademik, pendaftaran mahasiswa baru (PMB), program studi, biaya kuliah, dan fasilitas kampus ITB STIKOM Bali.';
      } else if (frame.intent === 'PAYMENT_STATUS_ISSUE') {
        reply = isEnglish
          ? 'Regarding payment status verification issues where transfer succeeded but system status has not updated:\n\n1. Keep Official Transfer Receipt: Ensure your payment receipt (ATM receipt, mobile banking transfer proof, or reference number) is kept safely.\n2. Processing Window: Banking reconciliation may take up to 1x24 hours to update automatically on the PMB portal (https://pmb.stikom-bali.ac.id) or SION.\n3. Manual Verification: If the status remains pending after 1x24 hours, please contact Admissions / Finance Office directly at (0361) 244445 with your payment proof for manual verification.'
          : 'Mengenai kendala status pembayaran pendaftaran atau biaya kuliah yang belum berubah setelah transfer berhasil:\n\n1. **Simpan Bukti Pembayaran**: Pastikan bukti transfer resmi (struk ATM, mutasi mobile banking, atau nomor referensi transaksi) disimpan dengan baik.\n2. **Waktu Rekonsiliasi**: Terkadang proses sinkronisasi perbankan membutuhkan waktu verifikasi berkala pada portal PMB (**https://pmb.stikom-bali.ac.id**) atau portal akademik SION.\n3. **Konfirmasi Manual ke Bagian Keuangan / Admisi**: Jika status belum terverifikasi otomatis dalam 1x24 jam, calon mahasiswa disarankan langsung mengonfirmasikan bukti transfer kepada Panitia PMB atau Bagian Keuangan ITB STIKOM Bali melalui hotline **(0361) 244445** atau datang ke Ruang Layanan PMB Kampus Renon agar dapat diverifikasi dan diperbarui secara manual oleh petugas.';
      } else if (frame.intent === 'CONVERSATIONAL_REQUEST_TO_ASK') {
        reply = isEnglish
          ? 'Hello! Of course, please feel free to ask your question regarding ITB STIKOM Bali, such as admissions (PMB), study programs, tuition fees, scholarships, or campus facilities. I am ready to assist you!'
          : 'Halo! Tentu, silakan sampaikan apa yang ingin Anda tanyakan seputar kampus ITB STIKOM Bali, seperti pendaftaran mahasiswa baru (PMB), program studi, biaya kuliah, atau fasilitas. Saya siap membantu!';
      } else if (frame.intent === 'CONVERSATIONAL_GRATITUDE') {
        reply = isEnglish
          ? "You're very welcome! Glad I could help. If there is anything else you would like to know about ITB STIKOM Bali, feel free to ask anytime!"
          : 'Sama-sama! Senang bisa membantu. Jika ada hal lain seputar ITB STIKOM Bali yang ingin Anda ketahui lebih lanjut, jangan ragu untuk bertanya ya!';
      } else if (frame.intent === 'CONVERSATIONAL_DELIBERATION') {
        const isContactLater = frame.aspects?.includes('will_contact_later');
        if (isContactLater) {
          reply = isEnglish
            ? 'Sure, thank you for reaching out! Feel free to contact us again anytime whenever you need further information. Wishing you great success!'
            : 'Baik, terima kasih sudah menghubungi kami. Silakan hubungi kembali kapan saja jika membutuhkan informasi lebih lanjut seputar ITB STIKOM Bali. Sukses selalu!';
        } else {
          reply = isEnglish
            ? 'Certainly, please take your time to consider it. Whenever you are ready or have more questions about ITB STIKOM Bali, feel free to reach out again. Have a wonderful day!'
            : 'Baik, silakan dipertimbangkan terlebih dahulu. Jika nanti ada hal yang ingin dipastikan atau ditanyakan kembali seputar ITB STIKOM Bali, jangan ragu untuk menghubungi kami lagi ya. Semoga harimu menyenangkan!';
        }
      } else if (frame.intent === 'ANSWER_REFINEMENT') {
        reply = isEnglish
          ? 'Sure! Please let me know which part of the previous information you would like me to summarize or refine to be more concise and informative.'
          : 'Tentu! Silakan beri tahu bagian mana dari informasi sebelumnya yang ingin disesuaikan atau diringkas agar lebih singkat dan informatif, saya siap membantu menyempurnakannya.';
      } else if (frame.intent === 'CONVERSATIONAL_GREETING') {
        if (frame.aspects?.includes('ping')) {
          reply = isEnglish
            ? 'Hello! Connection is active and stable. I am Tiko, the official virtual assistant of ITB STIKOM Bali. How can I assist you today?'
            : 'Halo! Koneksi aktif dan lancar. Saya Tiko, asisten virtual resmi ITB STIKOM Bali. Ada yang bisa kami bantu terkait pendaftaran mahasiswa baru (PMB), program studi, biaya kuliah, atau informasi akademik lainnya?';
        } else if (frame.aspects?.includes('punctuation_only')) {
          reply = isEnglish
            ? 'Hello! I am Tiko, the official assistant of ITB STIKOM Bali. Please feel free to ask any question regarding our campus admissions, study programs, or tuition fees.'
            : 'Halo! Saya Tiko, asisten virtual resmi ITB STIKOM Bali. Silakan ketikkan pertanyaan yang ingin Anda ketahui seputar pendaftaran mahasiswa baru (PMB), program studi, biaya kuliah, atau kegiatan kampus ya.';
        } else {
          const hasPriorTurns = (Array.isArray(sessionData?.conversationHistory) && sessionData.conversationHistory.length > 0) || Boolean(sessionData?.lastQuery);
          if (hasPriorTurns) {
            reply = isEnglish
              ? 'Hello again! How can I assist you further with campus information or admissions at ITB STIKOM Bali?'
              : 'Halo kembali! Ada yang bisa kami bantu lagi terkait informasi kampus atau PMB ITB STIKOM Bali?';
          } else {
            reply = isEnglish
              ? 'Hello! Welcome to the official information service of ITB STIKOM Bali. How can I assist you with admissions (PMB), study programs, tuition fees, or campus academic details?'
              : 'Halo! Selamat datang di layanan informasi resmi ITB STIKOM Bali. Ada yang bisa kami bantu terkait pendaftaran mahasiswa baru (PMB), program studi, biaya kuliah, atau informasi akademik lainnya?';
          }
        }
      } else if (frame.intent === 'AMBIGUOUS_CLARIFICATION' || frame.intent === 'ALTERNATIVE_OPTIONS_INQUIRY') {
        reply = isEnglish
          ? 'Your question requires more context. Could you please clarify which study program, admission track, or campus topic you are inquiring about?'
          : 'Pertanyaan Anda memerlukan konteks lebih lanjut. Boleh diperjelas program studi, jalur pendaftaran, atau topik informasi kampus apa yang Anda maksud?';
      } else if (frame.intent === 'BROAD_CAMPUS_OVERVIEW') {
        reply = isEnglish
          ? 'Here is an overview of ITB STIKOM Bali:\n\n1. Admissions (PMB): Multiple intake waves via https://pmb.stikom-bali.ac.id\n2. Study Programs: S1 Information Systems, S1 Computer Systems, S1 Information Technology, S1 Digital Business, D3 Informatics Management, S2 Information Systems, and International Dual Degrees.\n3. Tuition & Scholarships: Flexible monthly DPP installments, early bird discounts, and foundation scholarships.\n4. Facilities & Career: Renon, Jimbaran, and Abiansemal campuses, INBIS startup incubator, and Career Center (CDC).\n\nWhich topic would you like to explore further?'
          : 'Berikut ringkasan informasi utama seputar ITB STIKOM Bali:\n\n' +
          '1. **Penerimaan Mahasiswa Baru (PMB)**:\n' +
          '   - Pendaftaran dibuka secara bertahap melalui beberapa gelombang untuk TA 2026/2027 melalui portal resmi: https://pmb.stikom-bali.ac.id\n\n' +
          '2. **Program Studi yang Tersedia**:\n' +
          '   - **Sarjana (S1)**: Sistem Informasi, Sistem Komputer, Teknologi Informasi, Bisnis Digital\n' +
          '   - **Diploma (D3)**: Manajemen Informatika\n' +
          '   - **Magister (S2)**: Magister Sistem Informasi (M.Kom)\n' +
          '   - **Program Internasional**: Dual Degree UTB Bandung, Double Degree HELP University (Malaysia), DNUI (China)\n\n' +
          '3. **Biaya Pendidikan & Beasiswa**:\n' +
          '   - Biaya SPP per semester berkisar Rp 4.500.000 (D3) hingga Rp 6.500.000 (S1), dengan Dana Pendidikan Pokok (DPP) yang dapat diangsur setiap bulan hingga UTS-1.\n' +
          '   - Tersedia potongan beasiswa gelombang awal, diskon pelunasan tunai 10%, serta beasiswa yayasan dan KIP Kuliah.\n\n' +
          '4. **Fasilitas & Karir**:\n' +
          '   - Kampus Renon, Kampus Jimbaran, dan Kampus Abiansemal.\n' +
          '   - Inkubator Bisnis (INBIS) dan Career Development Center (CDC) untuk magang dan penyaluran kerja.\n\n' +
          'Apakah ada bagian tertentu yang ingin Kakak ketahui lebih rinci?';
      } else if (frame.intent === 'BOT_IDENTITY') {
        const isAskingCreator = frame.aspects?.includes('bot_creator') ||
          /\b(?:siapa\s+(?:yang\s+)?(?:membuat|menciptakan|mengembangkan|merancang|bikin)|(?:kamu|anda|bot|tiko)\s+(?:di|yang\s+)?(?:buat|ciptakan|kembangkan|rancang|bikin)\s+(?:oleh\s+)?siapa|pembuat|pengembang)\b/i.test(frame.rawQuery || '');
        const isAskingCapabilities = frame.aspects?.includes('bot_capabilities') ||
          /\b(?:bantu\s+apa|fungsi|tugas|kegunaan|kemampuan|layani)\b/i.test(frame.rawQuery || '');
        const isAskingFallback = frame.aspects?.includes('bot_fallback_policy') ||
          /\b(?:tidak\s+tahu\s+jawabannya|belum\s+tahu)\b/i.test(frame.rawQuery || '');
        const isAskingAuthenticity = frame.aspects?.includes('bot_authenticity') ||
          /\b(?:resmi|terbaru|akurat|valid)\b/i.test(frame.rawQuery || '');

        if (isAskingCreator) {
          reply = isEnglish
            ? 'I am Tiko, the official virtual assistant of ITB STIKOM Bali, developed to help provide information about academics, admissions, study programs, tuition fees, facilities, and campus services at ITB STIKOM Bali.'
            : 'Saya adalah Tiko, asisten virtual resmi ITB STIKOM Bali yang dikembangkan untuk membantu memberikan informasi seputar akademik, pendaftaran mahasiswa baru (PMB), program studi, biaya kuliah, fasilitas, dan layanan kampus ITB STIKOM Bali.';
        } else if (isAskingCapabilities) {
          reply = isEnglish
            ? 'I can assist you with official information regarding new student admissions (PMB), study programs & curriculum, tuition fees & scholarships, campus facilities, and academic services at ITB STIKOM Bali.'
            : 'Saya dapat membantu Anda memberikan informasi resmi seputar pendaftaran mahasiswa baru (PMB), program studi dan kurikulum, rincian biaya kuliah dan beasiswa, fasilitas kampus, serta layanan akademik di ITB STIKOM Bali.';
        } else if (isAskingFallback) {
          reply = isEnglish
            ? 'If verified official information is not yet available in our documents, I will transparently inform you and guide you directly to the relevant campus admissions or administrative office.'
            : 'Jika informasi yang Anda tanyakan belum tercantum dalam dokumen resmi kami atau memerlukan konfirmasi khusus, saya akan menyampaikannya secara terbuka dan mengarahkan Anda langsung ke bagian admisi PMB atau unit layanan kampus resmi terkait.';
        } else if (isAskingAuthenticity) {
          reply = isEnglish
            ? 'My answers are grounded in the verified official documents, academic guidelines, and regulations of ITB STIKOM Bali available in our database. However, this system has boundaries regarding real-time dynamic updates (such as live quota changes or spontaneous announcements). For the most current operational updates, please always verify via the official PMB portal at https://pmb.stikom-bali.ac.id or contact the admissions office directly.'
            : 'Jawaban saya bersumber dari dokumen resmi, pedoman akademik, dan ketetapan ITB STIKOM Bali yang telah diindeks dalam sistem basis data kami. Namun, sistem kami memiliki batasan pembaruan real-time (seperti perubahan kuota pendaftaran atau pengumuman insidental sewaktu-waktu). Untuk memastikan informasi operasional terkini dan paling mutakhir, disarankan selalu memverifikasi langsung melalui portal pmb.stikom-bali.ac.id atau menghubungi Panitia PMB/layanan admisi kampus.';
        } else {
          reply = isEnglish
            ? 'Hello! I am Tiko, the official virtual assistant of ITB STIKOM Bali. I am here to help you with information regarding admissions, study programs, tuition fees, facilities, and campus details. How can I assist you today?'
            : 'Halo! Saya Tiko, asisten virtual resmi ITB STIKOM Bali. Saya siap membantu Anda memberikan informasi seputar pendaftaran mahasiswa baru (PMB), program studi, biaya kuliah, fasilitas, dan kegiatan kampus ITB STIKOM Bali. Ada yang bisa saya bantu?';
        }
      } else if (frame.intent === 'CONVERSATIONAL_SMALL_TALK') {
        const queryText = (frame.rawQuery || frame.normalizedQuery || '').toLowerCase();
        const isEmotionalVenting = frame.userState === 'VENTING' || frame.relation === 'EMPATHY' ||
          /\b(?:sedih|kecewa|galau|stres|stress|depresi|terpuruk|patah\s*hati|putus\s*asa|capek|lelah|butuh\s*teman|boleh\s*cerita|curhat|curcol|cerita|lagi\s*down|sad|depressed|heartbroken|unhappy|feeling\s+down)\b/i.test(queryText);
        if (isEmotionalVenting) {
          reply = isEnglish
            ? 'I empathize with you and am truly sorry to hear that you are feeling down. While I am a virtual campus assistant focused on university information at ITB STIKOM Bali and not a professional psychologist or counselor, I am here and willing to listen if you would like to share or talk about what is on your mind. I hope you feel better and find comfort soon.'
            : 'Saya ikut berempati dan memahami jika Kakak sedang merasa sedih. Meskipun saya adalah asisten virtual yang berfokus pada informasi perkuliahan di ITB STIKOM Bali dan bukan seorang psikolog atau konselor profesional, saya tetap siap mendengarkan jika ada hal yang ingin Kakak ceritakan atau keluh kesah yang ingin dibagikan. Semoga perasaan Kakak lekas membaik dan merasa lebih tenang ya.';
        } else if (frame.aspects?.includes('busy_check') || /\blagi\s+sibuk\b/i.test(queryText)) {
          reply = isEnglish
            ? 'Not busy! I am ready to assist you with inquiries regarding academics, study programs, tuition fees, or admissions at ITB STIKOM Bali. What would you like to ask?'
            : 'Tidak, saya siap membantu menjawab pertanyaan Anda seputar informasi akademik, program studi, biaya kuliah, atau pendaftaran mahasiswa baru (PMB) ITB STIKOM Bali. Ada yang ingin Anda tanyakan?';
        } else if (frame.aspects?.includes('activity_check') || /\b(?:kamu\s+sedang\s+apa|lagi\s+ngapain)\b/i.test(queryText)) {
          reply = isEnglish
            ? 'I am active and on duty to assist you with inquiries about ITB STIKOM Bali. Is there any campus information you would like to ask?'
            : 'Saya sedang aktif bertugas dan siap menjawab pertanyaan Anda seputar kampus ITB STIKOM Bali. Ada informasi perkuliahan atau pendaftaran yang ingin Anda tanyakan?';
        } else if (frame.aspects?.includes('crowd_comment') || /\bhari\s+ini\s+ramai\b/i.test(queryText)) {
          reply = isEnglish
            ? 'As a virtual assistant, I assist with inquiries regarding admissions and academics at ITB STIKOM Bali. How can I help you with campus information today?'
            : 'Sebagai asisten virtual, saya bertugas melayani pertanyaan seputar perkuliahan dan penerimaan mahasiswa baru di ITB STIKOM Bali. Ada yang bisa saya bantu terkait informasi kampus hari ini?';
        } else if (frame.aspects?.includes('chat_companion') || /\b(?:temani\s+ngobrol|teman\s+ngobrol)\b/i.test(queryText)) {
          reply = isEnglish
            ? 'Certainly! I am Tiko, the official virtual assistant of ITB STIKOM Bali. While I am an information bot, I would be glad to converse and discuss our study programs, admissions, or student activities. What would you like to explore?'
            : 'Tentu! Saya Tiko, asisten virtual resmi ITB STIKOM Bali. Sebagai asisten informasi kampus, saya siap menemani dan mendiskusikan informasi seputar jurusan, perkuliahan, beasiswa, maupun pendaftaran di ITB STIKOM Bali. Ada topik yang ingin Kakak bahas?';
        } else {
          reply = isEnglish
            ? 'I am doing great, thank you! How can I assist you with information about ITB STIKOM Bali today?'
            : 'Kabar baik, terima kasih! Ada yang bisa saya bantu terkait informasi kampus ITB STIKOM Bali?';
        }
      } else if (frame.intent === 'CONVERSATIONAL_FAREWELL') {
        reply = isEnglish
          ? 'Goodbye! If you ever need further information regarding ITB STIKOM Bali, feel free to reach out anytime. Have a wonderful day!'
          : 'Sampai jumpa kembali! Jika ada hal lain seputar ITB STIKOM Bali yang ingin Anda tanyakan di kemudian hari, jangan ragu untuk menghubungi saya lagi ya. Semoga sukses dan sehat selalu!';
      } else if (frame.intent === 'CONVERSATIONAL_ACKNOWLEDGEMENT') {
        const isUnderstood = frame.aspects?.includes('understood') || /\b(?:paham|mengerti|noted|siap|sip)\b/i.test(frame.rawQuery || '');
        if (isUnderstood) {
          reply = isEnglish
            ? 'Great to hear that! If you ever need further details or have more questions about ITB STIKOM Bali, I am always ready to help.'
            : 'Baik, senang mendengarnya! Jika nanti ada pertanyaan lain atau memerlukan informasi lebih lanjut mengenai ITB STIKOM Bali, saya selalu siap membantu.';
        } else {
          reply = isEnglish
            ? "You're very welcome! Glad I could help. Is there anything else you would like to know about ITB STIKOM Bali?"
            : 'Sama-sama! Senang bisa membantu. Ada informasi lain seputar ITB STIKOM Bali yang ingin Anda ketahui?';
        }
      } else if (frame.intent === 'ADVERSARIAL_INJECTION_DEFENSE') {
        reply = isEnglish
          ? 'I apologize, but as the official information assistant of ITB STIKOM Bali, I only assist with inquiries regarding campus information, admissions, academic programs, tuition fees, and university activities.'
          : 'Mohon maaf, saya adalah asisten informasi resmi ITB STIKOM Bali dan hanya melayani pertanyaan seputar informasi kampus, PMB, program studi, biaya kuliah, dan kegiatan akademik.';
      } else {
        reply = isEnglish
          ? 'Hello! I am the official assistant of ITB STIKOM Bali. Please let me know what information you need regarding our campus.'
          : 'Halo! Saya asisten resmi ITB STIKOM Bali. Silakan beri tahu informasi apa yang ingin Anda ketahui seputar kampus kami.';
      }

      subQueryResults.push({
        frame,
        plan: null,
        candidatesCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        answerability: ANSWERABILITY_STATUS.ANSWERABLE,
        answer: reply,
        verification: {
          pass: true,
          outcome: frame.intent === 'PRIVACY_DATA_REFUSAL' ? 'PRIVACY_REFUSAL' : (frame.intent === 'TRANSFER_ADMISSION_INQUIRY' ? 'SAFE_UNKNOWN' : (frame.intent === 'OUT_OF_DOMAIN_GAMBLING' ? 'OUT_OF_DOMAIN' : (frame.intent === 'ALTERNATIVE_OPTIONS_INQUIRY' ? 'NEEDS_CONTEXT' : (frame.intent === 'AMBIGUOUS_CLARIFICATION' ? 'NEEDS_CLARIFICATION' : VERIFICATION_OUTCOME.VERIFIED_FACTUAL)))),
          status: frame.intent === 'PRIVACY_DATA_REFUSAL' ? 'PRIVACY_REFUSAL' : (frame.intent === 'TRANSFER_ADMISSION_INQUIRY' ? 'SAFE_UNKNOWN' : (frame.intent === 'OUT_OF_DOMAIN_GAMBLING' ? 'OUT_OF_DOMAIN' : (frame.intent === 'ALTERNATIVE_OPTIONS_INQUIRY' ? 'NEEDS_CONTEXT' : (frame.intent === 'AMBIGUOUS_CLARIFICATION' ? 'NEEDS_CLARIFICATION' : VERIFICATION_OUTCOME.VERIFIED_FACTUAL)))),
          reason: frame.intent === 'PRIVACY_DATA_REFUSAL' ? 'privacy_refusal_enforced' : (frame.intent === 'TRANSFER_ADMISSION_INQUIRY' ? 'transfer_admission_corpus_gap_handled_safely' : (frame.intent === 'OUT_OF_DOMAIN_GAMBLING' ? 'gambling_prohibited' : (frame.intent === 'ALTERNATIVE_OPTIONS_INQUIRY' ? 'follow_up_without_context' : (frame.intent === 'AMBIGUOUS_CLARIFICATION' ? 'clarification_required' : 'conversational_verified')))),
          isGrounded: true,
          handledSafely: true
        }
      });
      continue;
    }

    // 2. Build Retrieval Plan
    const plan = buildRetrievalPlan(frame);
    frame.retrievalPlan = plan;

    // 3. Stage A: Wide Candidate Recall (scale topK for multi-entity queries)
    const isBroadScholarshipOrFeeInquiry = (frame.domain === 'SCHOLARSHIP' || (Array.isArray(frame.aspects) && frame.aspects.includes('scholarship')) || /\b(?:beasiswa|potongan\s+dpp|potongan\s+biaya|biaya.*gelombang)\b/i.test(frame.rawQuery || '')) &&
      (!plan.targetEntities || plan.targetEntities.length <= 1);
    const candidateTopK = Array.isArray(plan.targetEntities) && plan.targetEntities.length > 1
      ? Math.max(16, plan.targetEntities.length * 10)
      : (isBroadScholarshipOrFeeInquiry ? 25 : (Array.isArray(plan.requestedAttributes) && plan.requestedAttributes.length >= 2 ? Math.max(18, plan.requestedAttributes.length * 6) : 16));
    const candidates = await retrieveCandidates(plan, { topK: candidateTopK });

    // 4. Stage B: Strict Evidence Arbitration (Hard Entity Lock, Temporal, Aspect)
    const arbitrated = arbitrateEvidence(candidates, plan);
    arbitrated.retrievalPlan = plan;
    arbitrated.sessionData = sessionData;
    arbitrated.rawAccepted = [...arbitrated.accepted];
    const maxAcceptedCount = isBroadScholarshipOrFeeInquiry ? 12 : (Array.isArray(plan.requestedAttributes) && plan.requestedAttributes.length >= 2 ? Math.max(12, plan.requestedAttributes.length * 4) : 10);
    if (arbitrated.accepted.length > maxAcceptedCount) {
      arbitrated.accepted = selectBalancedEvidenceByEntity(arbitrated.accepted, plan.targetEntities, maxAcceptedCount, plan.requestedAttributes);
    }

    // 5. Evaluate Answerability
    const answerability = evaluateAnswerability(frame, arbitrated);
    arbitrated.missingAspects = answerability.missingAspects || [];
    arbitrated.coveredAspects = answerability.coveredAspects || arbitrated.coveredAspects || [];
    arbitrated.attributeEvaluation = answerability.attributeEvaluation || arbitrated.attributeEvaluation || {};
    arbitrated.answerabilityStatus = answerability.status;

    let answer = null;
    let verification = {
      pass: false,
      outcome: VERIFICATION_OUTCOME.VERIFICATION_FAILED,
      status: VERIFICATION_OUTCOME.VERIFICATION_FAILED,
      reason: 'unprocessed',
      isGrounded: false,
      handledSafely: false
    };

    let recResult = null;
    if (frame.domain === 'ACADEMIC_RECOMMENDATION' || frame.intent === 'PROGRAM_RECOMMENDATION') {
      const { evaluateRecommendation } = require('../reasoning/recommendationEngine');
      recResult = evaluateRecommendation(frame.rawQuery, options, frame, arbitrated.accepted);
    }

    if (
      answerability.status === ANSWERABILITY_STATUS.ANSWERABLE ||
      answerability.status === ANSWERABILITY_STATUS.PARTIAL ||
      answerability.status === ANSWERABILITY_STATUS.CLARIFY
    ) {
      // 6. Grounded LLM Synthesis
      const synthOpts = { ...arbitrated, sessionData, recommendationResult: recResult };
      if (options && options.aiEngine) synthOpts.aiEngine = options.aiEngine;
      if (options && options.budgetLedger) synthOpts.budgetLedger = options.budgetLedger;
      if (options && options.fastFallback) synthOpts.fastFallback = true;
      if (options && options.signal) synthOpts.signal = options.signal;
      const synthFn = groundedAnswerGenerator.synthesizeAnswer || synthesizeAnswer;
      const synthesis = await synthFn(frame, synthOpts, null, recResult);
      if (synthesis && synthesis.success && synthesis.answer) {
        // 7. Universal Final Verification
        const verifFn = options.finalAnswerVerifier || finalAnswerVerifier.verifyFinalAnswer || verifyFinalAnswer;
        verification = verifFn(synthesis.answer, frame, arbitrated, null, recResult);
        answer = synthesis.answer;

        // A factual synthesis is releasable only after an affirmative factual verification.
        // SAFE_UNKNOWN / ESCALATION_GUIDANCE are safe outcomes, not permission to publish
        // unverified factual prose that happened to be generated alongside them.
        const hasVerifiedFactualOutcome = verification.pass === true &&
          verification.outcome === VERIFICATION_OUTCOME.VERIFIED_FACTUAL &&
          isVerifiedAnswer(synthesis.answer, verification);
        const isSafeAbstention = (synthesis.outcome === VERIFICATION_OUTCOME.SAFE_UNKNOWN || synthesis.handledSafely) &&
          verification.outcome === VERIFICATION_OUTCOME.SAFE_UNKNOWN &&
          verification.handledSafely;
        const isPartialGroundedOutcome = verification.pass === true &&
          verification.outcome === 'PARTIAL' &&
          verification.handledSafely === true;
        const isSafeClarificationPrompt = verification.outcome === VERIFICATION_OUTCOME.ESCALATION_GUIDANCE &&
          verification.handledSafely === true &&
          (verification.reason === 'clarification_prompt' || synthesis.reason === 'ambiguous_program_faculty_clarification');
        const synthesisMustBeBlocked = !hasVerifiedFactualOutcome && !isSafeAbstention && !isPartialGroundedOutcome && !isSafeClarificationPrompt;

        if (synthesisMustBeBlocked) {
          logger.warn({ reason: verification.reason, outcome: verification.outcome }, '[Orchestrator] Synthesized answer flagged by verifier, attempting generic extractive recovery');
          let recovered = false;
          const extractiveRecovery = (groundedAnswerGenerator.buildGenericExtractiveFallback || buildGenericExtractiveFallback)(frame, arbitrated.accepted, synthOpts);
          if (extractiveRecovery && extractiveRecovery.success && extractiveRecovery.answer) {
            const recoveryVerif = verifFn(extractiveRecovery.answer, frame, arbitrated, null, recResult);
            if (recoveryVerif.pass === true && (recoveryVerif.outcome === VERIFICATION_OUTCOME.VERIFIED_FACTUAL || recoveryVerif.outcome === 'PARTIAL')) {
              answer = extractiveRecovery.answer;
              verification = {
                ...recoveryVerif,
                source: 'generic_extractive_fallback',
                isGrounded: true,
                handledSafely: true
              };
              recovered = true;
            }
          }
          if (!recovered) {
            // Never expose the original synthesis after a failed/unsafe verification.
            answer = null;
          }
        }

        if (!answer) {
          if (hasVerifiedFactualOutcome || isPartialGroundedOutcome) {
            answer = synthesis.answer;
          } else {
            logger.warn({ reason: verification.reason, outcome: verification.outcome }, '[Orchestrator] Synthesized answer blocked by Final Verifier');
            answer = answerability.status === ANSWERABILITY_STATUS.CLARIFY
              ? buildClarificationResponse(frame)
              : (verification.outcome !== VERIFICATION_OUTCOME.SAFE_UNKNOWN ? 'Mohon maaf, informasi resmi yang terverifikasi belum dapat dipastikan dari sumber resmi yang tersedia saat ini. Silakan menghubungi bagian kampus terkait untuk konfirmasi.' : buildSafeUnknownResponse(frame, answerability));
            const blockedOutcome = verification.outcome === VERIFICATION_OUTCOME.SAFE_UNKNOWN
              ? VERIFICATION_OUTCOME.SAFE_UNKNOWN
              : VERIFICATION_OUTCOME.ESCALATION_GUIDANCE;
            verification = {
              ...verification,
              pass: false,
              outcome: blockedOutcome,
              interceptedFrom: VERIFICATION_OUTCOME.VERIFICATION_FAILED,
              isInterception: true,
              status: blockedOutcome,
              reason: verification.reason || 'blocked_by_final_verifier',
              isGrounded: false,
              handledSafely: true
            };
          }
        }
      } else {
        const extractiveFallback = (groundedAnswerGenerator.buildGenericExtractiveFallback || buildGenericExtractiveFallback)(frame, arbitrated.accepted, arbitrated);
        if (extractiveFallback && extractiveFallback.answer) {
          const verifFn = options.finalAnswerVerifier || finalAnswerVerifier.verifyFinalAnswer || verifyFinalAnswer;
          const recoveryVerif = verifFn(extractiveFallback.answer, frame, arbitrated);
          const isFallbackVerified = extractiveFallback.success && recoveryVerif.pass === true &&
            (recoveryVerif.outcome === VERIFICATION_OUTCOME.VERIFIED_FACTUAL || recoveryVerif.outcome === 'PARTIAL') &&
            (recoveryVerif.outcome === 'PARTIAL' || isVerifiedAnswer(extractiveFallback.answer, recoveryVerif));
          if (isFallbackVerified) {
            answer = extractiveFallback.answer;
            verification = {
              ...recoveryVerif,
              source: 'generic_extractive_fallback',
              isGrounded: true,
              handledSafely: true
            };
          } else {
            // The extracted text is only a candidate. If it fails verification, discard it.
            answer = null;
            verification = {
              pass: false,
              outcome: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
              status: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
              reason: 'generic_extractive_unverified',
              isGrounded: false,
              handledSafely: true
            };
          }
        }
        if (!answer) {
          const isEn = frame.language === 'en' || frame.detectedLanguage === 'en';
          answer = answerability.guidance || (isEn
            ? 'I apologize, but verified official information regarding this matter is currently not available in our records. Please contact campus admissions or the relevant department directly.'
            : 'Mohon maaf Kak, informasi resmi mengenai hal tersebut saat ini belum dapat diverifikasi dari dokumen yang tersedia. Silakan hubungi bagian admisi atau layanan informasi kampus ITB STIKOM Bali untuk konfirmasi langsung ya.');
          verification = {
            pass: false,
            outcome: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
            interceptedFrom: null,
            isInterception: false,
            status: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
            reason: synthesis?.reason || 'safe_unknown',
            isGrounded: false,
            handledSafely: true
          };
        }
      }
    } else if (answerability.status === ANSWERABILITY_STATUS.ESCALATE) {
      const isEn = frame.language === 'en' || frame.detectedLanguage === 'en';
      answer = answerability.guidance || (isEn
        ? 'For further assistance regarding this matter, please contact campus services or the relevant academic department directly.'
        : 'Untuk bantuan lebih lanjut mengenai hal tersebut, silakan hubungi bagian layanan informasi atau akademik kampus langsung ya.');
      verification = {
        pass: false,
        outcome: VERIFICATION_OUTCOME.ESCALATION_GUIDANCE,
        interceptedFrom: null,
        isInterception: false,
        status: VERIFICATION_OUTCOME.ESCALATION_GUIDANCE,
        reason: answerability.reason || 'escalation_guidance',
        isGrounded: false,
        handledSafely: true
      };
    } else {
      answer = answerability.guidance || 'Informasi mengenai hal tersebut belum tercantum dalam panduan resmi yang tersedia.';
      verification = {
        pass: false,
        outcome: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
        status: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
        reason: answerability.reason || 'safe_unknown',
        isGrounded: false,
        handledSafely: true
      };
    }

    const subStatus = (answerability.status === ANSWERABILITY_STATUS.UNKNOWN || verification.outcome === VERIFICATION_OUTCOME.SAFE_UNKNOWN)
      ? 'corpus_gap'
      : undefined;

    subQueryResults.push({
      frame,
      semanticFrame: frame,
      plan,
      candidates,
      allCandidates: candidates,
      preArbitrationTop12: candidates.slice(0, 12),
      candidatesCount: candidates.length,
      acceptedCount: arbitrated.accepted.length,
      rejectedCount: arbitrated.rejected.length,
      answerability: answerability.status,
      answerabilityDetails: {
        status: answerability.status,
        missingAspects: answerability.missingAspects || [],
        reason: answerability.reason || null
      },
      status: subStatus,
      answer,
      verification,
      arbitrated,
      arbitratedEvidence: arbitrated
    });
  }

  // Combine answers if multiple subqueries with deduplication
  const hasSuccessfulCampusAnswer = subQueryResults.some(r =>
    r.answer && (r.answerability === ANSWERABILITY_STATUS.ANSWERABLE || r.verification?.pass || r.verification?.isGrounded) &&
    r.frame && r.frame.domain !== 'OUT_OF_DOMAIN'
  );

  const seenAnswerNorms = new Set();
  const uniqueAnswers = [];
  for (const r of subQueryResults) {
    const ans = (r.answer || '').trim();
    if (!ans) continue;

    // Suppress contradictory out-of-domain refusal if another campus subquery in the same turn was successfully answered
    // and this subquery is a short dependent/anaphoric clause (e.g. "apa layanannya")
    if (r.frame && (r.frame.domain === 'OUT_OF_DOMAIN' || r.status === 'out_of_domain') && hasSuccessfulCampusAnswer) {
      const q = String(r.frame.rawQuery || '').trim();
      const isAnaphoricServiceOrDetail = hasAnaphoricReference(q) || /\b(?:layanan(?:nya)?|fasilitas(?:nya)?|program(?:nya)?|manfaat(?:nya)?|syarat(?:nya)?)\b/i.test(q);
      if (isAnaphoricServiceOrDetail) {
        continue;
      }
      // If there is a successful campus answer and this is a distinct non-campus clause (e.g. "bagaimana resep nasi goreng"),
      // output a targeted note explicitly citing the non-campus clause instead of a generic blanket refusal.
      const isEn = r.frame.language === 'en';
      const targetedOodNote = isEn
        ? `_Note: Regarding your non-campus inquiry ("${q}"), I apologize that I cannot answer as this service specifically provides official information about ITB STIKOM Bali._`
        : `_Catatan: Mengenai pertanyaan di luar informasi kampus ("${q}"), mohon maaf kami tidak dapat menjawab karena layanan ini khusus menyediakan informasi resmi seputar ITB STIKOM Bali._`;
      uniqueAnswers.push(targetedOodNote);
      continue;
    }

    const norm = ans.toLowerCase().replace(/\s+/g, ' ');
    if (!seenAnswerNorms.has(norm)) {
      seenAnswerNorms.add(norm);
      uniqueAnswers.push(ans);
    }
  }
  const finalAnswer = uniqueAnswers.join('\n\n');

  // Update session state with authoritative current turn domain & entity
  const owner = (turnControl && turnControl.isFallbackAccepted()) ? 'fallback' : 'phase1';
  const canCommit = turnControl ? turnControl.canCommitSession(owner) : true;
  const canSend = turnControl ? turnControl.canDispatch(owner) : true;

  if (!isShadowMode && chatId && subFrames.length > 0 && canCommit) {
    const primaryFrame = subFrames[0];
    const { CAMPUS_WIDE_DOMAINS } = require('../reasoning/contracts');
    const isCampusWide = primaryFrame.domain && CAMPUS_WIDE_DOMAINS.includes(primaryFrame.domain.toUpperCase());

    let newActiveEntity = null;
    let newPreservedEntity = sessionData.preservedBackgroundEntity || null;
    let newLastAcademicProgram = sessionData.lastAcademicProgramEntity || null;

    const isExplicitReset = Boolean(
      primaryFrame.explicitReset ||
      /\b(?:lupakan(?:\s+pertanyaan)?(?:\s+yang)?\s+(?:tadi|sebelumnya)|abaikan(?:\s+pertanyaan)?(?:\s+yang)?\s+(?:tadi|sebelumnya)|ganti\s+topik|mulai\s+dari\s+awal)\b/i.test(rawQuery)
    );
    const isGeneralPmbOrCatalog = ['CURRENT_ENROLLMENT_STATUS', 'ADMISSION_SCHEDULE', 'GENERAL_PMB_INQUIRY', 'AVAILABLE_PROGRAMS_LIST'].includes(primaryFrame.intent) || primaryFrame.topicContinuity === 'NEW_TOPIC' || isExplicitReset;

    if (isExplicitReset) {
      newActiveEntity = null;
      newPreservedEntity = null;
      if (Array.isArray(primaryFrame.entities) && primaryFrame.entities.length > 0) {
        newActiveEntity = primaryFrame.entities[0].canonical;
      }
    } else if (Array.isArray(primaryFrame.entities) && primaryFrame.entities.length > 0) {
      newActiveEntity = primaryFrame.entities[0].canonical;
      newPreservedEntity = null;
    } else if (isGeneralPmbOrCatalog) {
      newActiveEntity = null;
      if (sessionData.activeEntity && !/Dual Degree|Double Degree|Student Exchange/i.test(sessionData.activeEntity)) {
        newPreservedEntity = sessionData.activeEntity;
      }
    } else if (primaryFrame.domain === 'INTERNATIONAL') {
      const isDD = /\b(double\s*degree|dual\s*degree)\b/i.test(rawQuery);
      const isExchange = /\b(student\s*exchange|pertukaran\s*(?:pelajar|mahasiswa)|gccp)\b/i.test(rawQuery);
      const isUtbOrNasional = /\b(nasional|utb|bandung|dkv|desain\s+komunikasi\s+visual)\b/i.test(rawQuery);
      if (isDD && isUtbOrNasional) newActiveEntity = 'Dual Degree UTB';
      else if (isDD) newActiveEntity = 'International Dual Degree';
      else if (isExchange) newActiveEntity = 'Student Exchange';
      else newActiveEntity = sessionData.activeEntity || null;
      if (sessionData.activeEntity && /^(?:S1|S2|D3)\s+/i.test(sessionData.activeEntity)) {
        newPreservedEntity = sessionData.activeEntity;
      } else {
        newPreservedEntity = sessionData.preservedBackgroundEntity || null;
      }
    } else if ((isCampusWide || primaryFrame.intent === 'CONTACT_INQUIRY' || primaryFrame.intent === 'PMB_CONTACT_INQUIRY') && (!/Dual Degree|Double Degree|UTB|DNUI|HELP|Student Exchange/i.test(String(sessionData.activeEntity || '')) || /\b(?:kampus|stikom)\b/i.test(rawQuery) || !['CONTACT_INQUIRY', 'PMB_CONTACT_INQUIRY'].includes(primaryFrame.intent))) {
      // Campus-wide query without explicit entity: isolate activeEntity to background
      newActiveEntity = null;
      if (sessionData.activeEntity) {
        newPreservedEntity = sessionData.activeEntity;
      }
    } else if (primaryFrame.domain === sessionData.activeDomain ||
      ['ACADEMIC_CURRICULUM', 'TUITION_FEE', 'ACADEMIC_PROGRAM', 'ACADEMIC_ADMISSION', 'PMB', 'INTERNATIONAL'].includes(primaryFrame.domain) ||
      ['ADMISSION_PROCEDURE', 'ADMISSION_REQUIREMENTS', 'CONTACT_INQUIRY', 'PMB_CONTACT_INQUIRY'].includes(primaryFrame.intent)) {
      newActiveEntity = sessionData.activeEntity || null;
    } else {
      newActiveEntity = null;
      if (sessionData.activeEntity) {
        newPreservedEntity = sessionData.activeEntity;
      }
    }

    if (newActiveEntity && /^(?:S1|S2|D3)\s+/i.test(newActiveEntity)) {
      newLastAcademicProgram = newActiveEntity;
    } else if (sessionData.activeEntity && /^(?:S1|S2|D3)\s+/i.test(sessionData.activeEntity)) {
      newLastAcademicProgram = sessionData.activeEntity;
    }

    let currentWave = null;
    if (primaryFrame.feeScope?.registrationWave) {
      currentWave = primaryFrame.feeScope.registrationWave;
    } else {
      const { extractAllMentionedWaves } = require('./feeCalculationEngine');
      const detected = extractAllMentionedWaves(rawQuery);
      if (detected && detected.length > 0) {
        currentWave = detected[0];
      }
    }

    let currentAcademicYear = primaryFrame.academicYear || primaryFrame.temporal?.academicYear || null;
    if (!currentAcademicYear && primaryFrame.domain === 'PMB') {
      if (sessionData.academicYear) {
        currentAcademicYear = sessionData.academicYear;
      } else {
        const yearMatch = finalAnswer.match(/\b(?:tahun\s+(?:akademik|ajaran)|t\.?a\.?)\s*:?\s*(20\d{2}\s*\/\s*20\d{2})\b/i) ||
          finalAnswer.match(/\b(2026\s*\/\s*2027)\b/);
        currentAcademicYear = yearMatch ? yearMatch[1].replace(/\s+/g, '') : (sessionData.academicYear || null);
      }
    }

    // Isolate active academicYear per turn: only retained when query is in PMB domain or carries explicit year
    const activeAcademicYear = (primaryFrame.domain === 'PMB' || primaryFrame.academicYear)
      ? currentAcademicYear
      : null;
    const historicalAcademicYear = currentAcademicYear || sessionData.academicYear || sessionData.historicalAcademicYear || null;

    await updateSession(chatId, {
      dataPatch: {
        activeDomain: primaryFrame.domain,
        activeIntent: primaryFrame.intent,
        activeAspects: primaryFrame.aspects || [],
        requestedAspects: primaryFrame.aspects || [],
        requestedAttributes: primaryFrame.requestedAttributes || primaryFrame.aspects || [],
        activeEntity: newActiveEntity,
        activeEntities: subFrames.flatMap(sf => (sf.entities || []).map(e => e?.canonical || e?.name || (typeof e === 'string' ? e : null)).filter(Boolean)),
        preservedBackgroundEntity: newPreservedEntity,
        lastAcademicProgramEntity: newLastAcademicProgram,
        isProximityComparison: Boolean(primaryFrame.isProximityComparison || primaryFrame.aspects?.includes('proximity_comparison')),
        userOrigin: primaryFrame.userOrigin || sessionData.userOrigin || null,
        lastActiveWave: currentWave || sessionData.lastActiveWave || null,
        academicYear: activeAcademicYear,
        historicalAcademicYear: historicalAcademicYear,
        lastQuery: rawQuery,
        lastAnswer: finalAnswer,
        conversationHistory: appendConciseTurnHistory(sessionData.conversationHistory || [], rawQuery, finalAnswer)
      }
    });
  }

  // Dispatch if requested
  if (!isShadowMode && executeDispatch && chatId && canSend) {
    await outboundDispatcher.sendOutboundMessage(chatId, finalAnswer);
  }

  const primaryStatus = subQueryResults[0]?.status ||
    (subQueryResults[0]?.frame?.domain === 'UNSUPPORTED_PROGRAM' ? 'unsupported_program' :
      (subQueryResults[0]?.frame?.domain === 'OUT_OF_DOMAIN' ? 'out_of_domain' : undefined));

  const hasCorpusGap = subQueryResults.some(s =>
    s.status === 'corpus_gap' ||
    s.verification?.outcome === VERIFICATION_OUTCOME.SAFE_UNKNOWN ||
    s.answerability === ANSWERABILITY_STATUS.UNKNOWN ||
    s.answerability === ANSWERABILITY_STATUS.PARTIAL
  );

  const allVerified = subQueryResults.length > 0 && subQueryResults.every(s =>
    s.verification?.outcome === VERIFICATION_OUTCOME.VERIFIED_FACTUAL
  );

  let overallStatus = primaryStatus;
  if (hasCorpusGap && !['out_of_domain', 'unsupported_program'].includes(primaryStatus)) {
    overallStatus = 'corpus_gap';
  }

  const hasPartialGrounded = subQueryResults.some(s =>
    s.verification?.outcome === 'PARTIAL' || s.verification?.status === 'PARTIAL' || s.verification?.sourceGap
  );

  let overallVerificationOutcome;
  let overallVerificationReason;
  if (allVerified) {
    overallVerificationOutcome = VERIFICATION_OUTCOME.VERIFIED_FACTUAL;
    overallVerificationReason = 'all_subqueries_verified';
  } else if (hasPartialGrounded) {
    overallVerificationOutcome = 'PARTIAL';
    const partialSub = subQueryResults.find(s => s.verification?.outcome === 'PARTIAL' || s.verification?.status === 'PARTIAL');
    overallVerificationReason = partialSub?.verification?.reason || 'verified_branch_contact_with_facility_source_gap';
  } else if (hasCorpusGap) {
    overallVerificationOutcome = VERIFICATION_OUTCOME.SAFE_UNKNOWN;
    overallVerificationReason = 'contains_unconfirmed_aspects';
  } else {
    overallVerificationOutcome = subQueryResults[0]?.verification?.outcome || VERIFICATION_OUTCOME.SAFE_UNKNOWN;
    overallVerificationReason = subQueryResults[0]?.verification?.reason || 'unconfirmed';
  }

  const overallVerification = {
    pass: allVerified || hasPartialGrounded,
    outcome: overallVerificationOutcome,
    status: overallVerificationOutcome,
    reason: overallVerificationReason,
    isGrounded: allVerified || hasPartialGrounded,
    handledSafely: true,
    sourceGap: Boolean(hasPartialGrounded)
  };

  const verifiedFacts = [];
  const unconfirmedAspects = [];
  for (const s of subQueryResults) {
    if (s.verification?.outcome === VERIFICATION_OUTCOME.VERIFIED_FACTUAL) {
      verifiedFacts.push({
        intent: s.intent || s.frame?.intent,
        domain: s.frame?.domain,
        query: s.query || s.frame?.rawQuery
      });
    } else {
      unconfirmedAspects.push({
        intent: s.intent || s.frame?.intent,
        domain: s.frame?.domain,
        reason: s.verification?.reason || s.answerabilityDetails?.reason || 'unconfirmed',
        missingAspects: s.answerabilityDetails?.missingAspects || []
      });
    }
  }

  return {
    chatId,
    rawQuery,
    intent: subQueryResults.length === 1 ? subQueryResults[0]?.frame?.intent : 'MULTI_INTENT',
    status: overallStatus,
    verification: overallVerification,
    verifiedFacts,
    unconfirmedAspects,
    hasUnconfirmedAspects: hasCorpusGap,
    semanticFrame: subQueryResults[0]?.frame,
    subQueryResults,
    finalAnswer,
    answer: finalAnswer,
    text: finalAnswer,
    reply: finalAnswer
  };
}

/**
 * Greenfield End-to-End Inbound Message Handler.
 * Integrates:
 * Inbound Webhook Payload -> parse & dedup -> processTurn -> outboundDispatch
 */
async function handleInboundMessage(body = {}, { executeDispatch = true } = {}) {
  const { parseFonntePayload, isDuplicateOrAcquireLock } = require('./messageIngress');
  const ingress = parseFonntePayload(body);

  if (!ingress.sender || !ingress.text) {
    logger.warn({ sender: ingress.sender }, '[Orchestrator] Rejected empty or invalid inbound payload');
    return {
      success: false,
      reason: 'empty_sender_or_text',
      ingress
    };
  }

  const isDup = await isDuplicateOrAcquireLock(ingress.messageId, ingress.sender);
  if (isDup) {
    logger.info({ messageId: ingress.messageId, sender: ingress.sender }, '[Orchestrator] Duplicate message ignored');
    return {
      success: false,
      reason: 'duplicate_message',
      ingress
    };
  }

  const turnResult = await processTurn(ingress.sender, ingress.text, { executeDispatch });

  return {
    success: true,
    ingress,
    turnResult,
    finalAnswer: turnResult.finalAnswer
  };
}

module.exports = {
  processTurn,
  handleInboundMessage,
  runPhase1DeterministicPipeline,
  selectBalancedEvidenceByEntity
};
