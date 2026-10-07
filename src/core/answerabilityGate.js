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

    // Default when no evidence proves the question
    return {
      status: ANSWERABILITY_STATUS.UNKNOWN,
      reason: 'no_supported_evidence_found',
      guidance: 'Informasi resmi terkait hal ini belum tercantum secara lengkap dalam panduan yang tersedia.'
    };
  }

  // 2. If subqueries exist and some lack evidence
  if (semanticFrame.subQueries && semanticFrame.subQueries.length > 1) {
    return {
      status: ANSWERABILITY_STATUS.PARTIAL,
      reason: 'multi_subquery_partial_coverage'
    };
  }

  // 3. Fully supported
  return {
    status: ANSWERABILITY_STATUS.ANSWERABLE,
    reason: 'sufficient_supported_evidence'
  };
}

module.exports = {
  ANSWERABILITY_STATUS,
  evaluateAnswerability
};
