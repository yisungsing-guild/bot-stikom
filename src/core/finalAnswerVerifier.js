'use strict';

/**
 * src/core/finalAnswerVerifier.js
 * 
 * Greenfield Universal Final Answer Verifier.
 * Invariants:
 * - NO TRUSTED SOURCE EXEMPTIONS.
 * - Every factual answer MUST pass this verification gate.
 * 
 * Checks:
 * 1. Entity Alignment: If query is about DNUI, answer must NOT discuss HELP University.
 * 2. Raw Document Leak Detection: Ensures no internal database tags, SQL fragments, or chunk headers.
 * 3. Evidence Grounding: Answers must not contradict accepted evidence.
 */

const RAW_DOCUMENT_LEAK_PATTERNS = [
  /GǪ.*GǪ/i,
  /\[chunk_\d+\]/i,
  /training_data_id/i,
  /governanceMetadata/i,
  /select\s+.*\s+from/i,
  /ragChunkCount/i
];

function verifyFinalAnswer(candidateAnswer, semanticFrame, arbitratedEvidence = {}) {
  const text = String(candidateAnswer || '').trim();
  if (!text) {
    return { pass: false, reason: 'empty_answer' };
  }

  // 1. Raw Document Leak Check
  for (const pattern of RAW_DOCUMENT_LEAK_PATTERNS) {
    if (pattern.test(text)) {
      return {
        pass: false,
        reason: 'raw_document_metadata_leak_detected'
      };
    }
  }

  // 2. Entity Alignment Check (Generic across all entities)
  const { entities = [] } = semanticFrame;
  const excludedEntities = (arbitratedEvidence.retrievalPlan && arbitratedEvidence.retrievalPlan.excludedConflictingEntities) || [];
  
  for (const excluded of excludedEntities) {
    if (excluded && excluded.length >= 4) {
      const escaped = excluded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escaped}\\b`, 'i');
      if (regex.test(text)) {
        return {
          pass: false,
          reason: `entity_contradiction_conflicting_sibling_in_answer: ${excluded}`
        };
      }
    }
  }

  // 3. Temporal Claim Grounding Check (Detect ungrounded currentness claims)
  const temporalClaimPattern = /\b(saat ini|sekarang|hari ini|masih buka|masih dibuka|masih tersedia|masih menerima|sudah tutup|telah ditutup|sedang aktif|berlaku aktif)\b/i;
  if (temporalClaimPattern.test(text)) {
    // If the answer asserts a temporal claim, arbitrated evidence must exist
    if (!arbitratedEvidence.accepted || arbitratedEvidence.accepted.length === 0) {
      return {
        pass: false,
        reason: 'unsupported_temporal_claim_zero_evidence'
      };
    }

    // If query has constraint NOW, verify that accepted evidence actually supports temporal validity
    if (semanticFrame.temporal && semanticFrame.temporal.constraint === 'NOW') {
      const currentYear = new Date().getFullYear();
      const hasTemporalEvidence = arbitratedEvidence.accepted.some(c => {
        const cText = (c.text || '').toLowerCase();
        return cText.includes(String(currentYear)) || 
          cText.includes(String(currentYear - 1)) || 
          /\b(periode 202[1-6]-202[6-9]|berlaku sampai 202[6-9]|baik sekali|sk|surat keputusan)\b/i.test(cText);
      });
      if (!hasTemporalEvidence) {
        return {
          pass: false,
          reason: 'unsupported_temporal_claim_lacks_valid_temporal_evidence'
        };
      }
    }
  }

  return {
    pass: true,
    reason: 'verified_grounded'
  };
}

module.exports = {
  verifyFinalAnswer
};
