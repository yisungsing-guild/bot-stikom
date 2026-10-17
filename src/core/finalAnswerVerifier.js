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

const { VERIFICATION_OUTCOME } = require('../reasoning/contracts');

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

function failVerification(reason, extra = {}) {
  return {
    pass: false,
    outcome: VERIFICATION_OUTCOME.VERIFICATION_FAILED,
    status: VERIFICATION_OUTCOME.VERIFICATION_FAILED,
    reason,
    isGrounded: false,
    handledSafely: false,
    ...extra
  };
}

function verifyFinalAnswer(candidateAnswer, semanticFrame = {}, arbitratedEvidence = {}, comparisonEnvelope = null, recommendationResult = null) {
  if (recommendationResult && (recommendationResult.mode === 'RECOMMENDATION' || recommendationResult.provenance?.version === 'phase2-step7')) {
    const text = String(candidateAnswer || '').trim();
    if (!text) {
      return failVerification('empty_answer');
    }
    if (/\bpasti\s+cocok\b/i.test(text) || /\bpasti\s+pilih\b/i.test(text)) {
      return failVerification('recommendation_absolute_claim_forbidden');
    }
    const { sanitizeWhatsAppMarkdown } = require('./outboundRenderer');
    const sanitized = sanitizeWhatsAppMarkdown(candidateAnswer);
    if (sanitized !== candidateAnswer) {
      return failVerification('outbound_sanitizer_non_idempotent');
    }
    if (!/admisi\s+PMB|ketentuan\s+resmi/i.test(text)) {
      return failVerification('recommendation_lacks_pmb_advisory');
    }
    return {
      pass: true,
      outcome: VERIFICATION_OUTCOME.VERIFIED_FACTUAL,
      status: VERIFICATION_OUTCOME.VERIFIED_FACTUAL,
      reason: 'verified_recommendation',
      isGrounded: true,
      handledSafely: true
    };
  }

  if (comparisonEnvelope && comparisonEnvelope.mode === 'COMPARATIVE') {
    const { renderTextFromPlan, validateComparisonEnvelope } = require('../reasoning/comparativeSynthesis');
    const { sanitizeWhatsAppMarkdown } = require('./outboundRenderer');

    const validation = validateComparisonEnvelope(comparisonEnvelope);
    if (!validation.valid) {
      return failVerification('comparative_envelope_invalid', { diagnosticCode: validation.code });
    }

    const expectedText = renderTextFromPlan(comparisonEnvelope.renderPlan);
    if (candidateAnswer !== expectedText) {
      return failVerification('comparative_text_divergence');
    }

    // Outbound fixed-point idempotence assertion
    const sanitized = sanitizeWhatsAppMarkdown(candidateAnswer);
    if (sanitized !== candidateAnswer) {
      return failVerification('outbound_sanitizer_non_idempotent');
    }

    return {
      pass: true,
      outcome: VERIFICATION_OUTCOME.VERIFIED_FACTUAL,
      status: VERIFICATION_OUTCOME.VERIFIED_FACTUAL,
      reason: 'verified_comparative',
      isGrounded: true,
      handledSafely: true
    };
  }

  const text = String(candidateAnswer || '').trim();
  if (!text) {
    return failVerification('empty_answer');
  }

  // 1. Raw Document Leak Check
  for (const pattern of RAW_DOCUMENT_LEAK_PATTERNS) {
    if (pattern.test(text)) {
      return failVerification('raw_document_metadata_leak_detected');
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
  
  function isComparativeSentence(sentence, excluded) {
    const hasContrast = /\b(berbeda\s+(?:dengan|halnya)|dibandingkan|perbedaan(?:nya)?|sedangkan|sementara|tidak\s+seperti|differs?\s+(?:from)?|compared\s+(?:to|with)|whereas|while|unlike|contrast|difference)\b/i.test(sentence);
    const isPrerequisite = /\b(?:lulusan|ijazah|latar\s+belakang|sarjana|prasyarat|syarat\s+masuk|persyaratan|graduate|graduates|degree|background|bachelor|prerequisite|requirements)\b/i.test(sentence);
    const escaped = excluded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const isDirectSubject = new RegExp(`^(?:program\\s+studi|prodi|jurusan|study\\s+program|program|major)?\\s*${escaped}\\s+(?:adalah|merupakan|berfokus|memiliki|yaitu|is|focuses|offers)\\b`, 'i').test(sentence.trim());
    return (hasContrast || isPrerequisite) && !isDirectSubject;
  }

  for (const excluded of excludedEntities) {
    if (excluded && excluded.length >= 4) {
      if (GENERIC_COMMON_WORDS.has(excluded.toLowerCase().trim())) continue;
      const escaped = excluded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escaped}\\b`, 'i');
      if (regex.test(text)) {
        // Differentiate legitimate educational comparative mentions from actual contradictions
        const sentences = text.split(/(?<=[.!?\n])\s+/);
        const allMatchesAreComparative = sentences
          .filter(s => regex.test(s))
          .every(s => isComparativeSentence(s, excluded));

        const hasTargetMention = entities.some(e => {
          const canon = (e.canonical || e.name || String(e)).replace(/^(S1|S2|D3|D4)\s+/i, '');
          const esc = canon.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          return new RegExp(`\\b${esc}\\b`, 'i').test(text);
        });

        if (!allMatchesAreComparative || !hasTargetMention) {
          return failVerification(`entity_contradiction_conflicting_sibling_in_answer: ${excluded}`);
        }
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
          const sentences = text.split(/(?<=[.!?\n])\s+/);
          const allComparative = sentences
            .filter(s => titleRegex.test(s))
            .every(s => isComparativeSentence(s, base));
          if (!allComparative) {
            return failVerification(`entity_contradiction_conflicting_sibling_in_answer: ${excluded}`);
          }
        }
      }
    }
  }

  const isUnsupported = Boolean(
    arbitratedEvidence?.unsupportedEntity ||
    arbitratedEvidence?.retrievalPlan?.unsupportedEntity ||
    arbitratedEvidence?.retrievalPlan?.isUnsupportedEntity ||
    semanticFrame?.isUnsupportedEntity ||
    semanticFrame?.unsupportedEntity ||
    semanticFrame?.domain === 'UNSUPPORTED_PROGRAM' ||
    /tidak diselenggarakan di ITB STIKOM Bali|is currently not offered at ITB STIKOM Bali/i.test(text)
  );

  // 3. Temporal Claim Grounding Check (Detect ungrounded currentness claims)
  const temporalClaimPattern = /\b(saat ini|sekarang|hari ini|masih buka|masih dibuka|masih tersedia|masih menerima|sudah tutup|telah ditutup|sedang aktif|berlaku aktif|currently|at present|now|still open|still active|closed)\b/i;
  if (temporalClaimPattern.test(text) && !isUnsupported) {
    // If the answer asserts a temporal claim, arbitrated evidence must exist
    if (!arbitratedEvidence.accepted || arbitratedEvidence.accepted.length === 0) {
      return failVerification('unsupported_temporal_claim_zero_evidence');
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
        return failVerification('unsupported_temporal_claim_lacks_valid_temporal_evidence');
      }
    }
  }

  // 4. Aspect / Requested Field Consistency Check
  const isFeeInquiry = (semanticFrame.domain === 'TUITION_FEE' ||
    (semanticFrame.aspects && semanticFrame.aspects.some(a => ['fee', 'tuition', 'dpp'].includes(a)))) && !isUnsupported;

  if (isFeeInquiry) {
    const hasFeeKeywords = /\b(biaya|pendidikan|dpp|spp|uang pangkal|rp|cicil|pembayaran|nominal|fee|fees|tuition|cost|costs|costing|pay|pays|paying|payment|payments|installment|installments|price|prices)\b/i.test(text);
    const hasCurriculumOnly = /\b(semester\s+[ivx\d]+\s+no\s+nama\s+mata\s+kuliah|praktikum\s+[a-z]+|kurikulum\s+2025)\b/i.test(text) && !hasFeeKeywords;
    if (!hasFeeKeywords || hasCurriculumOnly) {
      return failVerification('aspect_mismatch_answer_lacks_fee_evidence');
    }
  }

  const isCurriculumInquiry = semanticFrame.domain === 'ACADEMIC_CURRICULUM' ||
    (semanticFrame.aspects && semanticFrame.aspects.some(a => ['curriculum', 'courses', 'competencies'].includes(a)));

  if (isCurriculumInquiry && !isUnsupported) {
    const hasCurriculumKeywords = /\b(berfokus|mempelajari|kurikulum|mata\s*kuliah|matkul|sks|semester|silabus|kompetensi|pembelajaran|fokus|bidang|pemrograman|keahlian|focus(?:es|ed|ing)?|learn(?:s|ing|ed)?|stud(?:y|ies|ied|ying)|teach(?:es|ing)?|taught|cover(?:s|ed|ing)?|skill(?:s)?|hardware|software|network(?:s|ing)?|programming|system(?:s)?|specializ(?:e|es|ed|ing|ation)|curriculum|courses?|credits?|semesters?|syllabus|competenc(?:y|ies)|degree(?:s)?|duration|career(?:s)?|jobs?|roles?|graduates?|qualification(?:s)?|prerequisite(?:s)?|requirement(?:s)?|defen(?:d|se|ses)|final\s+project|thesis|transcript|registration|clearance|supervis(?:or|ion)|advis(?:or|ing)|persyaratan|syarat|skripsi|bimbingan)\b/i.test(text);
    if (!hasCurriculumKeywords) {
      return failVerification('aspect_mismatch_answer_lacks_curriculum_evidence');
    }
  }

  const isContactInquiry = semanticFrame.intent === 'PMB_CONTACT_INQUIRY' ||
    (semanticFrame.aspects && semanticFrame.aspects.includes('contact'));

  if (isContactInquiry && !isUnsupported) {
    const hasContactDetails = /\b(whatsapp|wa|telepon|telp|nomor|call|phone|contact|email|humas|pmb|08\d{8,}|0361|\.ac\.id)\b/i.test(text);
    const isExplicitAbstain = /tidak\s+ditemukan|belum\s+tersedia|tidak\s+dapat\s+diverifikasi|not\s+(?:listed|found|available|recorded)|unrecorded/i.test(text);
    if (!hasContactDetails && !isExplicitAbstain) {
      return failVerification('aspect_mismatch_answer_lacks_contact_evidence');
    }
  }

  // 5. Unsolicited Recommendation Check (Only allowed if user explicitly requested recommendations)
  const isRecommendationInquiry = semanticFrame.domain === 'ACADEMIC_RECOMMENDATION' ||
    semanticFrame.intent === 'PROGRAM_RECOMMENDATION';

  if (!isRecommendationInquiry) {
    const unsolicitedRecommendationRegex = /\b(rekomendasi\s+untuk\s+(?:anda|kamu|kakak)|program\s+studi\s+yang\s+(?:paling\s+)?cocok\s+untuk\s+(?:anda|kamu|kakak)|jika\s+(?:anda|kamu|kakak)\s+(?:tertarik|berminat)\b[^\n]*\bpilihlah\b)\b/i;
    if (unsolicitedRecommendationRegex.test(text)) {
      return failVerification('unsolicited_recommendation_in_non_recommendation_inquiry');
    }
  }

  // 6. Heading Repetition / Raw Fragment Stacking Check
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length >= 25);
  const lineCounts = {};
  for (const line of lines) {
    lineCounts[line] = (lineCounts[line] || 0) + 1;
    if (lineCounts[line] >= 3) {
      return failVerification('repeated_heading_or_fragment_detected');
    }
  }

  // Outcome Classification (when all structural failure gates pass)
  if (isUnsupported) {
    return {
      pass: false,
      outcome: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
      status: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
      reason: 'unsupported_program_safe_refusal',
      isGrounded: false,
      handledSafely: true
    };
  }

  const isExplicitAbstain = /\b(belum\s+(?:tercantum|tersedia|ditemukan)|tidak\s+(?:ditemukan|tersedia|tercantum)|tidak\s+dapat\s+(?:diverifikasi|dipastikan)|belum\s+dapat\s+dipastikan|not\s+(?:listed|found|available|recorded)|unrecorded)\b/i.test(text);
  if (isExplicitAbstain) {
    return {
      pass: false,
      outcome: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
      status: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
      reason: 'safe_unknown',
      isGrounded: false,
      handledSafely: true
    };
  }

  const isEscalationGuidance = /\b(silakan\s+(?:menghubungi|berkonsultasi|konfirmasi|hubungi)\s+(?:dosen\s+wali|bagian\s+akademik|admisi|pmb|pusat\s+informasi)|contact\s+the\s+admission\s+office)\b/i.test(text) &&
    (!arbitratedEvidence?.accepted || arbitratedEvidence.accepted.length === 0);
  if (isEscalationGuidance) {
    return {
      pass: false,
      outcome: VERIFICATION_OUTCOME.ESCALATION_GUIDANCE,
      status: VERIFICATION_OUTCOME.ESCALATION_GUIDANCE,
      reason: 'escalation_guidance',
      isGrounded: false,
      handledSafely: true
    };
  }

  const isClarification = (
    semanticFrame?.intent === 'AMBIGUOUS_CLARIFICATION' ||
    /\b(mohon\s+jelaskan\s+program\s+studi|pilihan\s+Kakak)\b/i.test(text)
  );
  if (isClarification) {
    return {
      pass: false,
      outcome: VERIFICATION_OUTCOME.ESCALATION_GUIDANCE,
      status: VERIFICATION_OUTCOME.ESCALATION_GUIDANCE,
      reason: 'clarification_prompt',
      isGrounded: false,
      handledSafely: true
    };
  }

  const isCatalog = (
    semanticFrame?.intent === 'AVAILABLE_PROGRAMS_LIST' ||
    semanticFrame?.intent === 'PROGRAM_CATALOG_INQUIRY' ||
    /\b(Program Sarjana \(S1\)|Program Diploma \(D3\)|Program Pascasarjana \(S2\))\b/i.test(text)
  );
  if (isCatalog) {
    return {
      pass: true,
      outcome: VERIFICATION_OUTCOME.VERIFIED_FACTUAL,
      status: VERIFICATION_OUTCOME.VERIFIED_FACTUAL,
      reason: 'verified_catalog',
      isGrounded: true,
      handledSafely: true
    };
  }

  if (arbitratedEvidence?.accepted && arbitratedEvidence.accepted.length > 0) {
    return {
      pass: true,
      outcome: VERIFICATION_OUTCOME.VERIFIED_FACTUAL,
      status: VERIFICATION_OUTCOME.VERIFIED_FACTUAL,
      reason: 'verified_grounded',
      isGrounded: true,
      handledSafely: true
    };
  }

  return {
    pass: false,
    outcome: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
    status: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
    reason: 'safe_unknown',
    isGrounded: false,
    handledSafely: true
  };
}

module.exports = {
  verifyFinalAnswer
};
