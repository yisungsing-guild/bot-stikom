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
const { decomposeQuery, decomposeQueryAsync, hasMultipleIntents } = require('./multiIntentResolver');
const { buildRetrievalPlan } = require('./retrievalPlanner');
const { retrieveCandidates, verifyCorpusReadiness } = require('./retrievalService');
const { arbitrateEvidence } = require('./evidenceArbiter');
const { evaluateAnswerability, ANSWERABILITY_STATUS } = require('./answerabilityGate');
const groundedAnswerGenerator = require('./groundedAnswerGenerator');
const finalAnswerVerifier = require('./finalAnswerVerifier');
const { synthesizeAnswer, buildGroundedDeterministicSummary } = groundedAnswerGenerator;
const { verifyFinalAnswer } = finalAnswerVerifier;
const outboundDispatcher = require('./outboundDispatcher');
const logger = require('../logger');
const { isPhase2Enabled, executePhase2Bridge } = require('../reasoning/phase2Bridge');
const { isPhase2ShadowModeEnabled, runShadowEvaluationSafely } = require('../reasoning/shadowEvaluator');
const { VERIFICATION_OUTCOME } = require('../reasoning/contracts');
const isUnifiedSemanticPipelineEnabled = () => false;
const processUnifiedTurn = null;

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
      const topEntity = recResult.scoredCandidates[0]?.canonicalName || null;
      const frame = {
        domain: 'ACADEMIC_RECOMMENDATION',
        intent: 'PROGRAM_RECOMMENDATION',
        rawQuery,
        entities: topEntity ? [{ canonical: topEntity }] : []
      };

      let finalAnswer = null;
      let recVerification = null;
      const synthRes = await synthesizeAnswer(frame, {}, null, recResult);

      if (synthRes && synthRes.success && synthRes.answer) {
        const verifRes = verifyFinalAnswer(synthRes.answer, frame, {}, null, recResult);
        if (verifRes && (verifRes.outcome === VERIFICATION_OUTCOME.VERIFIED_FACTUAL || verifRes.pass)) {
          finalAnswer = synthRes.answer;
          recVerification = verifRes;
        } else if (verifRes && verifRes.outcome === VERIFICATION_OUTCOME.SAFE_UNKNOWN) {
          finalAnswer = synthRes.answer;
          recVerification = verifRes;
        } else {
          logger.warn({ reason: verifRes ? verifRes.reason : 'unknown' }, '[Orchestrator] Recommendation answer blocked by verifier');
          finalAnswer = 'Mohon maaf, rekomendasi program studi belum dapat dipastikan secara lengkap saat ini. Silakan berkonsultasi langsung dengan admisi PMB ITB STIKOM Bali.';
          recVerification = {
            pass: false,
            outcome: VERIFICATION_OUTCOME.ESCALATION_GUIDANCE,
            interceptedFrom: VERIFICATION_OUTCOME.VERIFICATION_FAILED,
            isInterception: true,
            status: VERIFICATION_OUTCOME.ESCALATION_GUIDANCE,
            reason: verifRes?.reason || 'recommendation_blocked_escalation',
            isGrounded: false,
            handledSafely: true
          };
        }
      } else {
        finalAnswer = 'Mohon maaf, rekomendasi program studi belum dapat diproses.';
        recVerification = {
          pass: false,
          outcome: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
          interceptedFrom: null,
          isInterception: false,
          status: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
          reason: 'recommendation_synthesis_failed',
          isGrounded: false,
          handledSafely: true
        };
      }

      bridgeResult.finalAnswer = finalAnswer;
      if (bridgeResult.subQueryResults && bridgeResult.subQueryResults[0]) {
        bridgeResult.subQueryResults[0].answer = finalAnswer;
        bridgeResult.subQueryResults[0].verification = recVerification;
      }

      // Atomic session persistence (Step 4 & Step 7 context commit)
      const turnControl = bridgeResult.turnControl;
      const canCommit = turnControl ? turnControl.canCommitSession('phase2') : true;
      const canSend = turnControl ? turnControl.canDispatch('phase2') : true;

      if (!isShadowMode && chatId && canCommit) {
        await updateSession(chatId, {
          dataPatch: {
            activeDomain: 'academic_recommendation',
            activeEntity: topEntity,
            recommendationRelations: recResult.contextRelations,
            lastQuery: rawQuery,
            lastAnswer: finalAnswer
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
      const frame = { domain: 'ACADEMIC_PROGRAM', intent: 'ask_program_comparison', entities: targetEntities };

      let finalAnswer = null;
      let compVerification = null;
      const synthRes = await synthesizeAnswer(frame, {}, bridgeResult.comparisonEnvelope);

      if (synthRes && synthRes.success && synthRes.answer) {
        const verifRes = verifyFinalAnswer(synthRes.answer, frame, {}, bridgeResult.comparisonEnvelope);
        if (verifRes && (verifRes.outcome === VERIFICATION_OUTCOME.VERIFIED_FACTUAL || verifRes.pass)) {
          finalAnswer = synthRes.answer;
          compVerification = verifRes;
        } else if (verifRes && verifRes.outcome === VERIFICATION_OUTCOME.SAFE_UNKNOWN) {
          finalAnswer = synthRes.answer;
          compVerification = verifRes;
        } else {
          logger.warn({ reason: verifRes ? verifRes.reason : 'unknown' }, '[Orchestrator] Comparative answer blocked by verifier');
          finalAnswer = 'Mohon maaf, informasi perbandingan resmi yang terverifikasi belum dapat dipastikan secara lengkap saat ini.';
          compVerification = {
            pass: false,
            outcome: VERIFICATION_OUTCOME.ESCALATION_GUIDANCE,
            interceptedFrom: VERIFICATION_OUTCOME.VERIFICATION_FAILED,
            isInterception: true,
            status: VERIFICATION_OUTCOME.ESCALATION_GUIDANCE,
            reason: verifRes?.reason || 'comparative_blocked_escalation',
            isGrounded: false,
            handledSafely: true
          };
        }
      } else {
        finalAnswer = 'Mohon maaf, informasi perbandingan resmi belum dapat diproses.';
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
        await updateSession(chatId, {
          dataPatch: {
            activeDomain: deltaState.activeDomain,
            activeEntity: deltaState.activeEntity,
            preservedBackgroundEntity: deltaState.preservedBackgroundEntity,
            entityProvenance: deltaState.entityProvenance,
            lastQuery: rawQuery,
            lastAnswer: finalAnswer
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
    const p1Result = await runPhase1DeterministicPipeline(chatId, rawQuery, { executeDispatch, executionMode });
    const p1LatencyMs = Date.now() - p1StartTime;

    // Fire asynchronously - never awaited by Phase 1 critical path
    setImmediate(() => {
      runShadowEvaluationSafely({
        chatId,
        rawQuery,
        p1Result,
        p1LatencyMs,
        phase1PipelineFn: runPhase1DeterministicPipeline
      }).catch(() => {});
    });

    return p1Result;
  }

  return runPhase1DeterministicPipeline(chatId, rawQuery, { executeDispatch, executionMode });
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

  // Check if current turn is responding to a pending clarification (Retrieve Clarification)
  let effectiveQuery = rawQuery;
  const { evaluateContextDependency } = require('./contextResolver');
  const contextDep = evaluateContextDependency(rawQuery, sessionData);

  if (contextDep && contextDep.reason === 'clarification_response' && sessionData.pendingClarification) {
    const origQ = sessionData.pendingClarification.originalQuery || '';
    effectiveQuery = `${origQ} ${rawQuery}`.trim();
  }

  // 1. Decompose Query into SemanticFrames
  let subFrames;
  const isFrameReusable = options.semanticFrame &&
    isSemanticFrameMatchingQuery(options.semanticFrame, effectiveQuery) &&
    typeof hasMultipleIntents === 'function' &&
    !hasMultipleIntents(effectiveQuery);

  if (isFrameReusable) {
    subFrames = [options.semanticFrame];
  } else {
    subFrames = (typeof decomposeQueryAsync === 'function' && !options.syncOnly)
      ? await decomposeQueryAsync(effectiveQuery, sessionData, options)
      : decomposeQuery(effectiveQuery, sessionData);
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
        answer: synthRes.answer,
        verification: verifRes,
        arbitrated: { accepted: [], rejected: [] },
        arbitratedEvidence: { accepted: [], rejected: [] }
      });
      continue;
    }

    // Explicit Out-of-Domain Terminal Hand-off
    if (frame.domain === 'OUT_OF_DOMAIN' || frame.intent === 'OUT_OF_DOMAIN_INQUIRY') {
      const oodReply = frame.language === 'en'
        ? 'I apologize, but I currently specialize in providing information regarding academics, admissions (PMB), study programs, tuition fees, and facilities at ITB STIKOM Bali. Your question is outside our campus information service scope.'
        : 'Mohon maaf, layanan ini khusus melayani informasi seputar akademik, PMB, program studi, biaya kuliah, dan fasilitas ITB STIKOM Bali. Pertanyaan Anda berada di luar cakupan layanan informasi kampus kami.';
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
          outcome: VERIFICATION_OUTCOME.ESCALATION_GUIDANCE,
          interceptedFrom: null,
          isInterception: false,
          status: VERIFICATION_OUTCOME.ESCALATION_GUIDANCE,
          reason: 'out_of_domain_terminal',
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
      if (frame.intent === 'CONVERSATIONAL_GREETING') {
        reply = isEnglish
          ? 'Hello! Welcome to the official information service of ITB STIKOM Bali. How can I assist you with admissions (PMB), study programs, tuition fees, or campus academic details?'
          : 'Halo! Selamat datang di layanan informasi resmi ITB STIKOM Bali. Ada yang bisa kami bantu terkait pendaftaran mahasiswa baru (PMB), program studi, biaya kuliah, atau informasi akademik lainnya?';
      } else if (frame.intent === 'CONVERSATIONAL_SMALL_TALK') {
        reply = isEnglish
          ? 'I am doing great, thank you! I am the official virtual assistant of ITB STIKOM Bali. Is there any campus information you would like to know today?'
          : 'Kabar baik! Terima kasih sudah menyapa. Saya adalah asisten virtual resmi ITB STIKOM Bali. Ada informasi kampus yang ingin Anda tanyakan hari ini?';
      } else if (frame.intent === 'CONVERSATIONAL_ACKNOWLEDGEMENT') {
        reply = isEnglish
          ? "You're very welcome! Glad I could help. Is there anything else you would like to know about ITB STIKOM Bali?"
          : 'Sama-sama! Senang bisa membantu. Ada informasi lain seputar ITB STIKOM Bali yang ingin Anda ketahui?';
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
          outcome: VERIFICATION_OUTCOME.VERIFIED_FACTUAL,
          status: VERIFICATION_OUTCOME.VERIFIED_FACTUAL,
          reason: 'conversational_verified',
          isGrounded: true,
          handledSafely: true
        }
      });
      continue;
    }

    // 2. Build Retrieval Plan
    const plan = buildRetrievalPlan(frame);
    frame.retrievalPlan = plan;

    // 3. Stage A: Wide Candidate Recall (fetch top 16 candidates)
    const isCorpusReady = verifyCorpusReadiness(options.context || {}).isReady;
    let candidates = await retrieveCandidates(plan, { topK: 16 });

    // 4. Stage B: Strict Evidence Arbitration (Hard Entity Lock, Temporal, Aspect)
    let arbitrated = arbitrateEvidence(candidates, plan);

    // ReAct Reflection: If arbitration accepted 0 candidates, evaluate whether to retry with relaxed plan (Missing Evidence? -> Re-retrieve)
    if (arbitrated.accepted.length === 0 && !frame.requiresClarification && isCorpusReady) {
      const relaxedPlan = {
        ...plan,
        requiredAspects: [],
        queryVariants: [
          ...(plan.targetEntities || []),
          rawQuery,
          effectiveQuery
        ].filter(Boolean)
      };
      if (relaxedPlan.retrievalContract) {
        relaxedPlan.retrievalContract = {
          ...relaxedPlan.retrievalContract,
          aspectFilter: null,
          metadataPolicy: {
            ...relaxedPlan.retrievalContract.metadataPolicy,
            hardFilters: ['entity']
          }
        };
      }
      const retryCandidates = await retrieveCandidates(relaxedPlan, { topK: 16 });
      if (retryCandidates && retryCandidates.length > 0) {
        const retryArbitrated = arbitrateEvidence(retryCandidates, relaxedPlan);
        if (retryArbitrated.accepted.length > 0) {
          candidates = retryCandidates;
          arbitrated = retryArbitrated;
        }
      }
    }

    arbitrated.retrievalPlan = plan;
    arbitrated.sessionData = sessionData;
    arbitrated.corpusUnavailable = !isCorpusReady;
    arbitrated.retrievalStatus = isCorpusReady ? 'OK' : 'CORPUS_UNAVAILABLE';
    arbitrated.rawAccepted = [...arbitrated.accepted];
    if (arbitrated.accepted.length > 10) {
      arbitrated.accepted = arbitrated.accepted.slice(0, 10);
    }

    // 5. Evaluate Answerability
    const answerability = evaluateAnswerability(frame, arbitrated);
    arbitrated.missingAspects = answerability.missingAspects || [];

    let answer = null;
    let verification = {
      pass: false,
      outcome: VERIFICATION_OUTCOME.VERIFICATION_FAILED,
      status: VERIFICATION_OUTCOME.VERIFICATION_FAILED,
      reason: 'unprocessed',
      isGrounded: false,
      handledSafely: false
    };

    if (answerability.status === ANSWERABILITY_STATUS.ANSWERABLE || answerability.status === ANSWERABILITY_STATUS.PARTIAL) {
      // 6. Grounded LLM Synthesis
      const synthOpts = { ...arbitrated, sessionData };
      if (options && options.fastFallback) synthOpts.fastFallback = true;
      if (options && options.signal) synthOpts.signal = options.signal;
      const synthFn = groundedAnswerGenerator.synthesizeAnswer || synthesizeAnswer;
      const synthesis = await synthFn(frame, synthOpts);
      if (synthesis.success && synthesis.answer) {
        // 7. Universal Final Verification
        const verifFn = options.finalAnswerVerifier || finalAnswerVerifier.verifyFinalAnswer || verifyFinalAnswer;
        verification = verifFn(synthesis.answer, frame, arbitrated);

        // Deterministic Recovery if synthesis failed verification or yielded unjustified SAFE_UNKNOWN on ANSWERABLE/PARTIAL turn
        const isUnjustifiedSafeUnknown = (verification.outcome === VERIFICATION_OUTCOME.SAFE_UNKNOWN || !verification.pass) &&
          (answerability.status === ANSWERABILITY_STATUS.ANSWERABLE || answerability.status === ANSWERABILITY_STATUS.PARTIAL);

        if (verification.outcome === VERIFICATION_OUTCOME.VERIFICATION_FAILED || isUnjustifiedSafeUnknown) {
          logger.warn({ reason: verification.reason, outcome: verification.outcome }, '[Orchestrator] Synthesized answer flagged by verifier, attempting deterministic recovery');
          const rawRecovery = groundedAnswerGenerator.buildGroundedDeterministicSummary(frame, arbitrated.accepted, arbitrated);
          const recoverySummary = typeof rawRecovery === 'object' && rawRecovery !== null ? (rawRecovery.answer || rawRecovery.text) : rawRecovery;
          if (recoverySummary) {
            const recoveryVerif = verifFn(recoverySummary, frame, arbitrated);
            if (recoveryVerif.outcome === VERIFICATION_OUTCOME.VERIFIED_FACTUAL || recoveryVerif.pass) {
              answer = recoverySummary;
              verification = recoveryVerif;
            }
          }
        }

        if (!answer) {
          if (verification.outcome !== VERIFICATION_OUTCOME.VERIFICATION_FAILED) {
            answer = synthesis.answer;
          } else {
            logger.warn({ reason: verification.reason }, '[Orchestrator] Synthesized answer blocked by Final Verifier');
            answer = 'Mohon maaf, informasi resmi yang terverifikasi belum dapat dipastikan secara lengkap saat ini. Silakan hubungi bagian informasi kampus untuk bantuan langsung.';
            verification = {
              pass: false,
              outcome: VERIFICATION_OUTCOME.ESCALATION_GUIDANCE,
              interceptedFrom: VERIFICATION_OUTCOME.VERIFICATION_FAILED,
              isInterception: true,
              status: VERIFICATION_OUTCOME.ESCALATION_GUIDANCE,
              reason: verification.reason || 'blocked_by_final_verifier',
              isGrounded: false,
              handledSafely: true
            };
          }
        }
      } else {
        const rawRecovery = buildGroundedDeterministicSummary(frame, arbitrated.accepted, arbitrated);
        const recoverySummary = typeof rawRecovery === 'object' && rawRecovery !== null ? (rawRecovery.answer || rawRecovery.text) : rawRecovery;
        if (recoverySummary) {
          const verifFn = options.finalAnswerVerifier || finalAnswerVerifier.verifyFinalAnswer || verifyFinalAnswer;
          const recoveryVerif = verifFn(recoverySummary, frame, arbitrated);
          if (recoveryVerif.outcome === VERIFICATION_OUTCOME.VERIFIED_FACTUAL || recoveryVerif.pass || recoveryVerif.outcome === VERIFICATION_OUTCOME.ESCALATION_GUIDANCE) {
            answer = recoverySummary;
            verification = recoveryVerif;
          }
        }
        if (!answer) {
          const isAdvisingInquiry = frame.domain === 'ACADEMIC_PROCESS' ||
            frame.intent === 'ACADEMIC_ADVISING_INQUIRY' ||
            /\b(?:perwalian|dosen\s*wali|bimbingan\s+perwalian)\b/i.test(frame.rawQuery || '');
          if (isAdvisingInquiry) {
            answer = answerability.guidance || 'Bimbingan perwalian dengan Dosen Wali di ITB STIKOM Bali merupakan proses akademik wajib sebelum perkuliahan semester baru untuk menyetujui Kartu Rencana Studi (KRS). Rincian prosedur resmi penanganan keterlambatan perwalian maupun kontak bantuan teknis belum dapat dipastikan dari dokumen resmi yang terverifikasi saat ini. Mahasiswa disarankan untuk langsung berkonsultasi dengan Dosen Wali masing-masing atau menghubungi Bagian Layanan Akademik (BAAK) ITB STIKOM Bali.';
          } else if (synthesis && (synthesis.budgetExceeded || synthesis.budgetReason)) {
            answer = 'Mohon maaf, layanan asisten cerdas saat ini mencapai batas kuota operasional harian. Silakan hubungi bagian informasi kampus ITB STIKOM Bali untuk bantuan langsung.';
          } else {
            answer = answerability.guidance || 'Informasi resmi mengenai hal tersebut belum tercantum secara lengkap dalam panduan yang tersedia.';
          }
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
    } else if (answerability.status === ANSWERABILITY_STATUS.CLARIFY) {
      answer = answerability.guidance || 'Mohon maaf, bisakah diperjelas informasi spesifik apa yang Kakak butuhkan terkait hal tersebut agar dapat dibantu dengan tepat?';
      verification = {
        pass: true,
        outcome: VERIFICATION_OUTCOME.VERIFIED_FACTUAL,
        status: VERIFICATION_OUTCOME.VERIFIED_FACTUAL,
        reason: 'clarification_requested',
        isGrounded: true,
        handledSafely: true
      };
    } else if (answerability.status === ANSWERABILITY_STATUS.ESCALATE) {
      answer = answerability.guidance || 'Untuk kendala perwalian atau administrasi, silakan menghubungi dosen wali atau bagian akademik kampus.';
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

    const subStatus = answerability.status === ANSWERABILITY_STATUS.CLARIFY
      ? 'needs_clarification'
      : ((answerability.status === ANSWERABILITY_STATUS.UNKNOWN || verification.outcome === VERIFICATION_OUTCOME.SAFE_UNKNOWN)
        ? 'corpus_gap'
        : undefined);

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

  // Combine answers if multiple subqueries
  const finalAnswer = subQueryResults.map(r => r.answer).filter(Boolean).join('\n\n');

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

    if (primaryFrame.entities.length > 0) {
      newActiveEntity = primaryFrame.entities[0].canonical;
      newPreservedEntity = null;
    } else if (primaryFrame.domain === 'INTERNATIONAL') {
      const isDD = /\b(double\s*degree|dual\s*degree)\b/i.test(rawQuery);
      const isExchange = /\b(student\s*exchange|pertukaran\s*(?:pelajar|mahasiswa)|gccp)\b/i.test(rawQuery);
      if (isDD) newActiveEntity = 'Double Degree';
      else if (isExchange) newActiveEntity = 'Student Exchange';
      else newActiveEntity = sessionData.activeEntity || null;
      newPreservedEntity = null;
    } else if (isCampusWide) {
      // Campus-wide query without explicit entity: isolate activeEntity to background
      newActiveEntity = null;
      if (sessionData.activeEntity) {
        newPreservedEntity = sessionData.activeEntity;
      }
    } else if (primaryFrame.domain === sessionData.activeDomain ||
               ['ACADEMIC_CURRICULUM', 'TUITION_FEE', 'ACADEMIC_PROGRAM', 'ACADEMIC_ADMISSION'].includes(primaryFrame.domain)) {
      newActiveEntity = sessionData.activeEntity || null;
    } else {
      newActiveEntity = null;
      if (sessionData.activeEntity) {
        newPreservedEntity = sessionData.activeEntity;
      }
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

    const needsClarify = subQueryResults.some(s => s.status === 'needs_clarification');
    const newPendingClarification = needsClarify
      ? {
          originalQuery: rawQuery,
          frame: primaryFrame,
          clarificationPrompt: finalAnswer,
          options: subQueryResults[0]?.answerabilityDetails?.options || []
        }
      : null;

    const newClarificationTurnCount = needsClarify
      ? ((sessionData.clarificationTurnCount || 0) + 1)
      : 0;

    await updateSession(chatId, {
      dataPatch: {
        activeDomain: primaryFrame.domain,
        activeIntent: primaryFrame.intent,
        activeAspects: primaryFrame.aspects || [],
        requestedAspects: primaryFrame.aspects || [],
        activeEntity: newActiveEntity,
        preservedBackgroundEntity: newPreservedEntity,
        lastActiveWave: currentWave || sessionData.lastActiveWave || null,
        pendingClarification: newPendingClarification,
        clarificationTurnCount: newClarificationTurnCount,
        lastQuery: rawQuery,
        lastAnswer: finalAnswer
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

  let overallVerificationOutcome;
  let overallVerificationReason;
  if (allVerified) {
    overallVerificationOutcome = VERIFICATION_OUTCOME.VERIFIED_FACTUAL;
    overallVerificationReason = 'all_subqueries_verified';
  } else if (hasCorpusGap) {
    overallVerificationOutcome = VERIFICATION_OUTCOME.SAFE_UNKNOWN;
    overallVerificationReason = 'contains_unconfirmed_aspects';
  } else {
    overallVerificationOutcome = subQueryResults[0]?.verification?.outcome || VERIFICATION_OUTCOME.SAFE_UNKNOWN;
    overallVerificationReason = subQueryResults[0]?.verification?.reason || 'unconfirmed';
  }

  const overallVerification = {
    pass: allVerified,
    outcome: overallVerificationOutcome,
    status: overallVerificationOutcome,
    reason: overallVerificationReason,
    isGrounded: allVerified,
    handledSafely: true
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
  runPhase1DeterministicPipeline
};
