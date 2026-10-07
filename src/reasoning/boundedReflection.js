'use strict';

/**
 * src/reasoning/boundedReflection.js
 * 
 * Phase 2 Step 3: Bounded Reflection & Controlled Replan.
 * 
 * Strict Invariants:
 * 1. Bounded: Maksimal 1 replan per user turn.
 * 2. Time-Governed: Replan hanya dimulai jika elapsedMs < 1.500 ms (REPLAN_START_DEADLINE_MS).
 * 3. Total turn budget: 2.500 ms (TOTAL_TURN_BUDGET_MS).
 * 4. Phase 1 Single Source of Truth: Semua query hasil replan wajib kembali ke Phase 1
 *    retrieveCandidates dan arbitrateEvidence. Zero Phase 2 direct corpus access.
 * 5. Entity Lock: Target entity dan sibling exclusion wajib dipertahankan selama replan.
 * 6. Provenance Continuity: Rejected evidence dilarang masuk hasil final. Factual claims
 *    wajib didukung accepted evidence yang terverifikasi.
 */

const {
  REPLAN_START_DEADLINE_MS,
  canStartReplan
} = require('./contracts');
const { retrieveCandidates } = require('../core/retrievalService');
const { arbitrateEvidence } = require('../core/evidenceArbiter');
const { evaluateAnswerability, ANSWERABILITY_STATUS } = require('../core/answerabilityGate');
const logger = require('../logger');

const REPLAN_DECISION = Object.freeze({
  NO_REPLAN_SUFFICIENT: 'NO_REPLAN_SUFFICIENT',
  REPLAN_TRIGGERED: 'REPLAN_TRIGGERED',
  REPLAN_ABORTED_DEADLINE: 'REPLAN_ABORTED_DEADLINE',
  REPLAN_ABORTED_MAX_ATTEMPTS: 'REPLAN_ABORTED_MAX_ATTEMPTS',
  REPLAN_COMPLETED_NEW_EVIDENCE: 'REPLAN_COMPLETED_NEW_EVIDENCE',
  REPLAN_COMPLETED_NO_NEW_EVIDENCE: 'REPLAN_COMPLETED_NO_NEW_EVIDENCE'
});

/**
 * Common vocabulary mismatch mappings: Colloquial user terms -> Authoritative corpus keywords
 */
const VOCABULARY_SYNONYM_MAP = [
  {
    triggers: [/\bspp\b/i, /\bukt\b/i, /\buang\s+semester\b/i],
    replacements: ['biaya kuliah per semester', 'rincian biaya pendidikan']
  },
  {
    triggers: [/\buang\s+masuk\b/i, /\buang\s+pangkal\b/i, /\buang\s+gedung\b/i],
    replacements: ['biaya pendaftaran', 'dana pengembangan pendidikan DPP']
  },
  {
    triggers: [/\bmagang\b/i, /\binternship\b/i, /\bpraktek\s+kerja\b/i],
    replacements: ['praktik kerja lapangan PKL', 'Career Center kerja industri', 'bursa kerja magang']
  },
  {
    triggers: [/\bkuliah\s+sambil\s+kerja\b/i, /\bkerja\s+sambil\s+kuliah\b/i],
    replacements: ['program kuliah magang kerja luar negeri', 'Career Center']
  },
  {
    triggers: [/\bpotongan\b/i, /\bdiskon\b/i, /\bpotongan\s+harga\b/i],
    replacements: ['potongan DPP pendaftaran', 'keringanan biaya gelombang']
  },
  {
    triggers: [/\bprospek\s+kerja\b/i, /\bkerja\s+jadi\s+apa\b/i, /\blulusan\s+kerja\s+apa\b/i],
    replacements: ['profil lulusan peluang karier', 'profesi pekerjaan lulusan']
  },
  {
    triggers: [/\blab\b/i, /\blaboratorium\b/i, /\bruang\s+praktek\b/i],
    replacements: ['fasilitas laboratorium komputer', 'fasilitas sarana praktikum kampus']
  },
  {
    triggers: [/\bekskul\b/i, /\bklub\b/i, /\bkomunitas\s+kampus\b/i],
    replacements: ['Unit Kegiatan Mahasiswa UKM', 'organisasi kemahasiswaan']
  }
];

/**
 * 1. Evaluates evidence sufficiency after initial Phase 1 arbitration.
 */
function evaluateEvidenceSufficiency(semanticFrame, arbitratedEvidence = {}, answerability = {}) {
  const accepted = Array.isArray(arbitratedEvidence.accepted) ? arbitratedEvidence.accepted : [];
  const status = answerability.status;

  // Fully answerable with accepted evidence -> Sufficient
  if (accepted.length > 0 && status === ANSWERABILITY_STATUS.ANSWERABLE) {
    return {
      sufficient: true,
      decision: REPLAN_DECISION.NO_REPLAN_SUFFICIENT,
      reason: 'sufficient_evidence_available',
      missingAspects: []
    };
  }

  // Escalation intent (e.g. missed administrative deadlines) should not be replanned with RAG
  if (status === ANSWERABILITY_STATUS.ESCALATE) {
    return {
      sufficient: true,
      decision: REPLAN_DECISION.NO_REPLAN_SUFFICIENT,
      reason: 'escalation_guidance_definitive',
      missingAspects: []
    };
  }

  // Conversational or non-retrieval
  if (semanticFrame && (semanticFrame.domain === 'CONVERSATIONAL' || semanticFrame.retrievalRequired === false)) {
    return {
      sufficient: true,
      decision: REPLAN_DECISION.NO_REPLAN_SUFFICIENT,
      reason: 'conversational_non_retrieval',
      missingAspects: []
    };
  }

  // Evidence is lacking or partial
  const missingAspects = Array.isArray(answerability.missingAspects) ? answerability.missingAspects : [];
  return {
    sufficient: false,
    decision: REPLAN_DECISION.REPLAN_TRIGGERED,
    reason: answerability.reason || 'insufficient_evidence',
    missingAspects
  };
}

/**
 * 2. Detects vocabulary mismatch in user query and suggests authoritative reformulations.
 */
function detectVocabularyMismatch(rawQuery, semanticFrame = {}, missingAspects = []) {
  const queryText = String(rawQuery || '').toLowerCase();
  const suggestedTerms = [];

  for (const entry of VOCABULARY_SYNONYM_MAP) {
    for (const trigger of entry.triggers) {
      if (trigger.test(queryText)) {
        for (const repl of entry.replacements) {
          if (!suggestedTerms.includes(repl)) {
            suggestedTerms.push(repl);
          }
        }
        break;
      }
    }
  }

  // If specific missing aspects were identified, append authoritative aspect keywords
  if (missingAspects.includes('fee') || missingAspects.includes('tuition')) {
    if (!suggestedTerms.includes('biaya kuliah per semester')) {
      suggestedTerms.push('biaya kuliah per semester');
    }
  }
  if (missingAspects.includes('curriculum')) {
    if (!suggestedTerms.includes('kurikulum mata kuliah semester')) {
      suggestedTerms.push('kurikulum mata kuliah semester');
    }
  }
  if (missingAspects.includes('careers')) {
    if (!suggestedTerms.includes('profil lulusan peluang karier')) {
      suggestedTerms.push('profil lulusan peluang karier');
    }
  }

  const entityName = (semanticFrame.entities && semanticFrame.entities.length > 0)
    ? (semanticFrame.entities[0].canonical || semanticFrame.entities[0].name || '')
    : '';

  let reformulatedQuery = null;
  if (suggestedTerms.length > 0) {
    reformulatedQuery = entityName
      ? `${entityName} ${suggestedTerms.slice(0, 2).join(' ')}`
      : suggestedTerms.slice(0, 2).join(' ');
  }

  return {
    hasMismatch: suggestedTerms.length > 0,
    suggestedTerms,
    reformulatedQuery
  };
}

/**
 * 3. Builds a replan retrieval plan maintaining strict Entity Lock.
 */
function buildReplanRetrievalPlan(originalPlan, semanticFrame, vocabMismatch) {
  const entityName = (semanticFrame.entities && semanticFrame.entities.length > 0)
    ? (semanticFrame.entities[0].canonical || semanticFrame.entities[0].name || '')
    : '';

  const newVariants = [...(originalPlan.queryVariants || [])];
  if (vocabMismatch.reformulatedQuery && !newVariants.includes(vocabMismatch.reformulatedQuery)) {
    newVariants.unshift(vocabMismatch.reformulatedQuery);
  }
  for (const term of vocabMismatch.suggestedTerms || []) {
    const termQuery = entityName ? `${entityName} ${term}` : term;
    if (!newVariants.includes(termQuery)) {
      newVariants.push(termQuery);
    }
  }

  return {
    ...originalPlan,
    // Strict Invariant: Preserve locked entities and exclusions
    targetEntities: [...(originalPlan.targetEntities || [])],
    excludedConflictingEntities: [...(originalPlan.excludedConflictingEntities || [])],
    requiredAspects: [...(originalPlan.requiredAspects || [])],
    temporalConstraint: originalPlan.temporalConstraint || 'GENERAL',
    queryVariants: newVariants,
    isReplan: true
  };
}

/**
 * 4. Executes controlled single replan against Phase 1 retrieval and arbitration.
 * 
 * @param {object} params
 * @param {object} params.semanticFrame
 * @param {object} params.initialPlan
 * @param {object} params.initialArbitrated
 * @param {object} params.initialAnswerability
 * @param {number} params.startTime
 * @param {number} params.replanAttempts
 */
async function executeBoundedReplan({
  semanticFrame,
  initialPlan,
  initialArbitrated,
  initialAnswerability,
  startTime,
  replanAttempts = 0
}) {
  const currentTime = Date.now();

  // 1. Check max replan attempts (Maksimal 1 replan per turn)
  if (replanAttempts >= 1) {
    return {
      replanExecuted: false,
      decision: REPLAN_DECISION.REPLAN_ABORTED_MAX_ATTEMPTS,
      reason: 'max_replan_limit_reached',
      arbitrated: initialArbitrated,
      answerability: initialAnswerability
    };
  }

  // 2. Check time budget deadline (< 1.500 ms)
  if (!canStartReplan(startTime, currentTime)) {
    logger.warn({
      elapsedMs: currentTime - startTime,
      deadlineMs: REPLAN_START_DEADLINE_MS
    }, '[BoundedReflection] Replan aborted: elapsed time exceeded 1500ms deadline');

    return {
      replanExecuted: false,
      decision: REPLAN_DECISION.REPLAN_ABORTED_DEADLINE,
      reason: 'replan_start_deadline_exceeded',
      arbitrated: initialArbitrated,
      answerability: initialAnswerability
    };
  }

  // 3. Detect vocabulary mismatch & construct replan query
  const vocabMismatch = detectVocabularyMismatch(
    semanticFrame.rawQuery || semanticFrame.normalizedQuery,
    semanticFrame,
    initialAnswerability.missingAspects || []
  );

  const replanPlan = buildReplanRetrievalPlan(initialPlan, semanticFrame, vocabMismatch);

  // 4. Return to Phase 1: Wide candidate retrieval (topK = 16)
  const newCandidates = await retrieveCandidates(replanPlan, { topK: 16 });

  // 5. Return to Phase 1: Strict evidence arbitration (Locks, aspects, temporal)
  const replanArbitrated = arbitrateEvidence(newCandidates, replanPlan);
  replanArbitrated.retrievalPlan = replanPlan;

  // 6. Evaluate if new accepted evidence was found
  const initialAcceptedIds = new Set((initialArbitrated.accepted || []).map(c => c.id || c.source || c.title));
  const newlyDiscoveredChunks = (replanArbitrated.accepted || []).filter(c => !initialAcceptedIds.has(c.id || c.source || c.title));

  if (newlyDiscoveredChunks.length > 0) {
    // Merge new accepted evidence while enforcing dedup and max limit
    const mergedAccepted = [...(initialArbitrated.accepted || []), ...newlyDiscoveredChunks].slice(0, 10);
    const updatedArbitrated = {
      ...replanArbitrated,
      accepted: mergedAccepted
    };

    // Re-evaluate answerability via Phase 1 gate
    const updatedAnswerability = evaluateAnswerability(semanticFrame, updatedArbitrated);

    logger.info({
      newChunksCount: newlyDiscoveredChunks.length,
      newStatus: updatedAnswerability.status
    }, '[BoundedReflection] Replan successful: acquired new verified evidence');

    return {
      replanExecuted: true,
      newEvidenceFound: true,
      decision: REPLAN_DECISION.REPLAN_COMPLETED_NEW_EVIDENCE,
      arbitrated: updatedArbitrated,
      answerability: updatedAnswerability,
      replanPlan
    };
  }

  // 7. No new evidence discovered -> Terminate cleanly
  logger.info('[BoundedReflection] Replan completed: zero new evidence discovered, terminating replan sequence');
  return {
    replanExecuted: true,
    newEvidenceFound: false,
    decision: REPLAN_DECISION.REPLAN_COMPLETED_NO_NEW_EVIDENCE,
    arbitrated: initialArbitrated,
    answerability: initialAnswerability,
    replanPlan
  };
}

module.exports = {
  REPLAN_DECISION,
  evaluateEvidenceSufficiency,
  detectVocabularyMismatch,
  buildReplanRetrievalPlan,
  executeBoundedReplan
};
