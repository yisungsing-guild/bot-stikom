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
const { decomposeQuery } = require('./multiIntentResolver');
const { buildRetrievalPlan } = require('./retrievalPlanner');
const { retrieveCandidates } = require('./retrievalService');
const { arbitrateEvidence } = require('./evidenceArbiter');
const { evaluateAnswerability, ANSWERABILITY_STATUS } = require('./answerabilityGate');
const { synthesizeAnswer } = require('./groundedAnswerGenerator');
const { verifyFinalAnswer } = require('./finalAnswerVerifier');
const { sendOutboundMessage } = require('./outboundDispatcher');
const logger = require('../logger');

/**
 * Processes a single turn inquiry through the pure greenfield pipeline.
 * Returns structured result for shadow logging or outbound delivery.
 */
async function processTurn(chatId, rawQuery, { executeDispatch = false } = {}) {
  const session = await getSession(chatId);
  const sessionData = session.data || {};

  // 1. Decompose Query into SemanticFrames
  const subFrames = decomposeQuery(rawQuery, sessionData);

  const subQueryResults = [];

  for (const frame of subFrames) {
    // Check if conversational non-retrieval intent
    if (frame.domain === 'CONVERSATIONAL' || frame.retrievalRequired === false) {
      let reply = '';
      if (frame.intent === 'CONVERSATIONAL_GREETING') {
        reply = 'Halo! Selamat datang di layanan informasi resmi ITB STIKOM Bali. Ada yang bisa kami bantu terkait pendaftaran mahasiswa baru (PMB), program studi, biaya kuliah, atau informasi akademik lainnya?';
      } else if (frame.intent === 'CONVERSATIONAL_SMALL_TALK') {
        reply = 'Kabar baik! Terima kasih sudah menyapa. Saya adalah asisten virtual resmi ITB STIKOM Bali. Ada informasi kampus yang ingin Anda tanyakan hari ini?';
      } else if (frame.intent === 'ADVERSARIAL_INJECTION_DEFENSE') {
        reply = 'Mohon maaf, saya adalah asisten informasi resmi ITB STIKOM Bali dan hanya melayani pertanyaan seputar informasi kampus, PMB, program studi, biaya kuliah, dan kegiatan akademik.';
      } else {
        reply = 'Halo! Saya asisten resmi ITB STIKOM Bali. Silakan beri tahu informasi apa yang ingin Anda ketahui seputar kampus kami.';
      }

      subQueryResults.push({
        frame,
        plan: null,
        candidatesCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        answerability: ANSWERABILITY_STATUS.ANSWERABLE,
        answer: reply,
        verification: { pass: true, reason: 'conversational_verified' }
      });
      continue;
    }

    // 2. Build Retrieval Plan
    const plan = buildRetrievalPlan(frame);
    frame.retrievalPlan = plan;

    // 3. Stage A: Wide Candidate Recall (fetch top 16 candidates)
    const candidates = await retrieveCandidates(plan, { topK: 16 });

    // 4. Stage B: Strict Evidence Arbitration (Hard Entity Lock, Temporal, Aspect)
    const arbitrated = arbitrateEvidence(candidates, plan);
    arbitrated.retrievalPlan = plan;
    if (arbitrated.accepted.length > 10) {
      arbitrated.accepted = arbitrated.accepted.slice(0, 10);
    }

    // 5. Evaluate Answerability
    const answerability = evaluateAnswerability(frame, arbitrated);
    arbitrated.missingAspects = answerability.missingAspects || [];

    let answer = null;
    let verification = { pass: false, reason: 'unprocessed' };

    if (answerability.status === ANSWERABILITY_STATUS.ANSWERABLE || answerability.status === ANSWERABILITY_STATUS.PARTIAL) {
      // 6. Grounded LLM Synthesis
      const synthesis = await synthesizeAnswer(frame, arbitrated);
      if (synthesis.success && synthesis.answer) {
        // 7. Universal Final Verification
        verification = verifyFinalAnswer(synthesis.answer, frame, arbitrated);
        if (verification.pass) {
          answer = synthesis.answer;
        } else {
          logger.warn({ reason: verification.reason }, '[Orchestrator] Synthesized answer blocked by Final Verifier');
          answer = 'Mohon maaf, informasi resmi yang terverifikasi belum dapat dipastikan secara lengkap saat ini. Silakan hubungi bagian informasi kampus untuk bantuan langsung.';
        }
      }
    } else if (answerability.status === ANSWERABILITY_STATUS.ESCALATE) {
      answer = answerability.guidance || 'Untuk kendala perwalian atau administrasi, silakan menghubungi dosen wali atau bagian akademik kampus.';
      verification = { pass: true, reason: 'escalation_guidance' };
    } else {
      answer = answerability.guidance || 'Informasi mengenai hal tersebut belum tercantum dalam panduan resmi yang tersedia.';
      verification = { pass: true, reason: 'safe_unknown' };
    }

    subQueryResults.push({
      frame,
      plan,
      candidatesCount: candidates.length,
      acceptedCount: arbitrated.accepted.length,
      rejectedCount: arbitrated.rejected.length,
      answerability: answerability.status,
      answer,
      verification
    });
  }

  // Combine answers if multiple subqueries
  const finalAnswer = subQueryResults.map(r => r.answer).filter(Boolean).join('\n\n');

  // Update session state with authoritative current turn domain & entity
  if (subFrames.length > 0) {
    const primaryFrame = subFrames[0];
    await updateSession(chatId, {
      dataPatch: {
        activeDomain: primaryFrame.domain,
        activeEntity: primaryFrame.entities.length > 0 
          ? primaryFrame.entities[0].canonical 
          : (sessionData.activeEntity || null),
        lastQuery: rawQuery,
        lastAnswer: finalAnswer
      }
    });
  }

  // Dispatch if requested
  if (executeDispatch && chatId) {
    await sendOutboundMessage(chatId, finalAnswer);
  }

  return {
    chatId,
    rawQuery,
    subQueryResults,
    finalAnswer
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
  handleInboundMessage
};
