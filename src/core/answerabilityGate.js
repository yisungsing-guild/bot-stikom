'use strict';

/**
 * src/core/answerabilityGate.js
 * 
 * Greenfield Answerability Gate.
 * Evaluates whether retrieved & arbitrated evidence is sufficient to answer the SemanticFrame.
 * 
 * Invariants:
 * - contexts.length > 0 DOES NOT imply ANSWERABLE.
 * - If accepted evidence is empty -> UNKNOWN or ESCALATE.
 * - Does not invent facts.
 */

const ANSWERABILITY_STATUS = Object.freeze({
  ANSWERABLE: 'ANSWERABLE',
  PARTIAL: 'PARTIAL',
  UNKNOWN: 'UNKNOWN',
  CLARIFY: 'CLARIFY',
  ESCALATE: 'ESCALATE'
});

function evaluateAnswerability(semanticFrame, arbitratedEvidence = {}) {
  const { accepted = [], rejected = [] } = arbitratedEvidence;

  // 1. If no accepted evidence exists
  if (!accepted || accepted.length === 0) {
    // If user query represents a missed academic process or complaint -> ESCALATE to admin/academic staff
    if (semanticFrame.intent === 'MISSED_ACADEMIC_PROCESS' || semanticFrame.userState === 'LATE') {
      return {
        status: ANSWERABILITY_STATUS.ESCALATE,
        reason: 'missed_process_requires_staff_assistance',
        guidance: 'Mohon hubungi bagian Bagian Akademik (BAAK) atau dosen wali untuk penanganan keterlambatan perwalian.'
      };
    }

    if (semanticFrame.domain === 'TUITION_FEE' || (semanticFrame.aspects && semanticFrame.aspects.some(a => ['fee', 'tuition', 'dpp'].includes(a)))) {
      return {
        status: ANSWERABILITY_STATUS.UNKNOWN,
        reason: 'insufficient_fee_evidence',
        guidance: 'Informasi resmi mengenai rincian biaya kuliah untuk program studi tersebut belum tercantum secara lengkap dalam panduan yang tersedia.'
      };
    }

    // Default when no evidence proves the question
    return {
      status: ANSWERABILITY_STATUS.UNKNOWN,
      reason: 'no_supported_evidence_found',
      guidance: 'Informasi resmi terkait hal ini belum tercantum secara lengkap dalam panduan yang tersedia.'
    };
  }

  // 2. Aspect Coverage Verification:
  // Accepted evidence must cover at least one required aspect if specific aspects are requested
  const requiredAspects = (semanticFrame.aspects || []).filter(a => a !== 'general');
  if (requiredAspects.length > 0) {
    const allProvidedAspects = new Set();
    for (const chunk of accepted) {
      if (Array.isArray(chunk.providedAspects)) {
        chunk.providedAspects.forEach(a => allProvidedAspects.add(a));
      }
    }

    const hasAspectCoverage = requiredAspects.some(req => allProvidedAspects.has(req));
    if (!hasAspectCoverage) {
      if (semanticFrame.domain === 'TUITION_FEE' || requiredAspects.some(a => ['fee', 'tuition', 'dpp'].includes(a))) {
        return {
          status: ANSWERABILITY_STATUS.UNKNOWN,
          reason: 'insufficient_fee_aspect_coverage',
          guidance: 'Informasi resmi mengenai rincian biaya kuliah untuk program studi tersebut belum tercantum secara lengkap dalam panduan yang tersedia.'
        };
      }
      return {
        status: ANSWERABILITY_STATUS.UNKNOWN,
        reason: 'insufficient_aspect_evidence',
        guidance: 'Informasi resmi terkait aspek tersebut belum tercantum secara lengkap dalam panduan yang tersedia.'
      };
    }
  }

  // 3. If subqueries exist and some lack evidence
  if (semanticFrame.subQueries && semanticFrame.subQueries.length > 1) {
    return {
      status: ANSWERABILITY_STATUS.PARTIAL,
      reason: 'multi_subquery_partial_coverage'
    };
  }

  // 4. Fully supported
  return {
    status: ANSWERABILITY_STATUS.ANSWERABLE,
    reason: 'sufficient_supported_evidence'
  };
}

module.exports = {
  ANSWERABILITY_STATUS,
  evaluateAnswerability
};
