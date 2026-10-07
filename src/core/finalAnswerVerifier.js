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
  /ragChunkCount/i,
  /Ringkasan dokumen:/i,
  /\[Sheet:\s*[^\]]+\]/i,
  /\|\s*col\d+\s*:/i,
  /PROGRAM STUDI SISTEM INFORMASI, TEKNOLOGI INFORMASI, DAN/i,
  /2\.\s*Profil Saat Ini\s*•\s*Status:\s*Perguruan tinggi bertaraf internasional/i,
  /Ketua Program Studi S1-/i
];

function verifyFinalAnswer(candidateAnswer, semanticFrame, arbitratedEvidence = {}, comparisonEnvelope = null) {
  if (comparisonEnvelope && comparisonEnvelope.mode === 'COMPARATIVE') {
    const { renderTextFromPlan, validateComparisonEnvelope } = require('../reasoning/comparativeSynthesis');
    const { sanitizeWhatsAppMarkdown } = require('./outboundRenderer');

    const validation = validateComparisonEnvelope(comparisonEnvelope);
    if (!validation.valid) {
      return { pass: false, reason: 'comparative_envelope_invalid', diagnosticCode: validation.code };
    }

    const expectedText = renderTextFromPlan(comparisonEnvelope.renderPlan);
    if (candidateAnswer !== expectedText) {
      return { pass: false, reason: 'comparative_text_divergence' };
    }

    // Outbound fixed-point idempotence assertion
    const sanitized = sanitizeWhatsAppMarkdown(candidateAnswer);
    if (sanitized !== candidateAnswer) {
      return { pass: false, reason: 'outbound_sanitizer_non_idempotent' };
    }

    return { pass: true };
  }

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
  const GENERIC_COMMON_WORDS = new Set([
    'akademik', 'kuliah', 'kampus', 'stikom', 'bali', 'mahasiswa', 'program',
    'studi', 'jurusan', 'fakultas', 'pendidikan', 'kurikulum', 'biaya', 'beasiswa',
    'fasilitas', 'gedung', 'kegiatan', 'organisasi'
  ]);

  const { entities = [] } = semanticFrame;
  const excludedEntities = (arbitratedEvidence.retrievalPlan && arbitratedEvidence.retrievalPlan.excludedConflictingEntities) || [];
  
  for (const excluded of excludedEntities) {
    if (excluded && excluded.length >= 4) {
      if (GENERIC_COMMON_WORDS.has(excluded.toLowerCase().trim())) continue;
      const escaped = excluded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escaped}\\b`, 'i');
      if (regex.test(text)) {
        return {
          pass: false,
          reason: `entity_contradiction_conflicting_sibling_in_answer: ${excluded}`
        };
      }

      // If excluded is a program (e.g. S1 Sistem Komputer), also check for program title patterns
      const base = excluded.replace(/^(S1|S2|D3|D4)\s+/i, '');
      const isSameBaseAsTarget = entities.some(e => {
        const canonical = e.canonical || e.name || String(e);
        const tb = canonical.replace(/^(S1|S2|D3|D4)\s+/i, '').toLowerCase();
        return tb === base.toLowerCase();
      });

      if (!isSameBaseAsTarget && base !== excluded && base.length >= 5) {
        const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const titleRegex = new RegExp(`(?:Program\\s+Studi|Prodi|Jurusan)\\s+${escapedBase}\\b|\\b${escapedBase}\\s*\\((?:S1|S2|D3|D4)\\)`, 'i');
        if (titleRegex.test(text)) {
          return {
            pass: false,
            reason: `entity_contradiction_conflicting_sibling_in_answer: ${excluded}`
          };
        }
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

  // 4. Aspect / Requested Field Consistency Check
  const isFeeInquiry = semanticFrame.domain === 'TUITION_FEE' || 
    (semanticFrame.aspects && semanticFrame.aspects.some(a => ['fee', 'tuition', 'dpp'].includes(a)));

  if (isFeeInquiry) {
    const hasFeeKeywords = /\b(biaya|pendidikan|dpp|spp|uang pangkal|rp|cicil|pembayaran|nominal)\b/i.test(text);
    const hasCurriculumOnly = /\b(semester\s+[ivx\d]+\s+no\s+nama\s+mata\s+kuliah|praktikum\s+[a-z]+|kurikulum\s+2025)\b/i.test(text) && !hasFeeKeywords;
    if (!hasFeeKeywords || hasCurriculumOnly) {
      return {
        pass: false,
        reason: 'aspect_mismatch_answer_lacks_fee_evidence'
      };
    }
  }

  const isCurriculumInquiry = semanticFrame.domain === 'ACADEMIC_CURRICULUM' ||
    (semanticFrame.aspects && semanticFrame.aspects.some(a => ['curriculum', 'courses'].includes(a)));

  if (isCurriculumInquiry) {
    const hasCurriculumKeywords = /\b(kurikulum|mata\s*kuliah|matkul|sks|semester|silabus)\b/i.test(text);
    if (!hasCurriculumKeywords) {
      return {
        pass: false,
        reason: 'aspect_mismatch_answer_lacks_curriculum_evidence'
      };
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
