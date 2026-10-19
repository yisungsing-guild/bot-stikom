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

  const isDDInquiry = entities.some(e => /double\s*degree|dual\s*degree/i.test(e.canonical || e.name || String(e))) ||
    /\b(?:double|dual)\s*degree|dua\s*gelar\b/i.test(semanticFrame.rawQuery || '') ||
    (semanticFrame.aspects && semanticFrame.aspects.includes('double_degree'));

  const DD_COLLABORATING_PROGRAMS = new Set([
    's1 bisnis digital', 'bisnis digital', 's1 bd', 'bd',
    's1 sistem informasi', 'sistem informasi', 's1 si', 'si',
    's1 teknologi informasi', 'teknologi informasi', 's1 ti', 'ti',
    'sarjana bisnis digital', 'sarjana sistem informasi', 'prodi bd', 'prodi si'
  ]);
  
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
      if (isDDInquiry && DD_COLLABORATING_PROGRAMS.has(excluded.toLowerCase().trim())) continue;
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
    arbitratedEvidence?.unconfirmedProgram ||
    arbitratedEvidence?.retrievalPlan?.unconfirmedProgram ||
    semanticFrame?.unconfirmedProgram ||
    semanticFrame?.isUnsupportedEntity ||
    semanticFrame?.unsupportedEntity ||
    semanticFrame?.domain === 'UNSUPPORTED_PROGRAM' ||
    /tidak diselenggarakan di ITB STIKOM Bali|is currently not offered at ITB STIKOM Bali|tidak ditemukan dalam daftar program yang tersedia saat ini|belum dapat dikonfirmasi dari daftar resmi/i.test(text)
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

  let isAdvisingInquiry = semanticFrame.domain === 'ACADEMIC_PROCESS' ||
    semanticFrame.intent === 'ACADEMIC_ADVISING_INQUIRY' ||
    (semanticFrame.aspects && semanticFrame.aspects.some(a => ['academic_advising', 'dosen_wali', 'perwalian'].includes(a)));

  const isCurriculumInquiry = !isAdvisingInquiry && (semanticFrame.domain === 'ACADEMIC_CURRICULUM' ||
    (semanticFrame.aspects && semanticFrame.aspects.some(a => ['curriculum', 'courses', 'competencies'].includes(a))));

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

  // 7. Negative Controls & Domain-Aspect Integrity Checks
  const rawQuery = String(semanticFrame.rawQuery || '').toLowerCase();

  // 7a. Accreditation negative control: Must not be answered with Double Degree
  const isAccreditationQuery = semanticFrame.domain === 'ACCREDITATION' ||
    (semanticFrame.aspects && semanticFrame.aspects.includes('accreditation')) ||
    /\b(?:akreditasi|peringkat\s+akreditasi|ban-?pt|lam\s+infokom)\b/i.test(rawQuery);
  if (isAccreditationQuery && !/\b(?:dual|double)\s*degree\b/i.test(rawQuery)) {
    if (/\b(?:dual|double)\s*degree|national\s*class|utb\b/i.test(text) && !/\bakreditasi\b/i.test(text)) {
      return failVerification('domain_aspect_mismatch_accreditation_answered_with_double_degree');
    }
  }

  // 7b. Facilities negative control: Must not use facility list as substantive Double Degree claim
  const isFacilityInquiry = semanticFrame.domain === 'FACILITIES' ||
    (semanticFrame.aspects && semanticFrame.aspects.some(a => ['facilities', 'lab', 'campus_infrastructure'].includes(a)));
  if (isFacilityInquiry && !/\b(?:double|dual)\s*degree\b/i.test(rawQuery)) {
    if (/\b(?:dual|double)\s*degree\s+(?:national|nasional)\b/i.test(text) && !/\b(?:lab|laboratorium|ruang\s+kuliah|perpustakaan|wi-?fi|gedung)\b/i.test(text)) {
      return failVerification('domain_aspect_mismatch_facilities_answered_with_double_degree');
    }
  }

  // 7c. National Double Degree Integrity Checks
  const isNationalDDQuery = /\bnasional\b/i.test(rawQuery) &&
    (semanticFrame.aspects?.includes('double_degree') ||
     semanticFrame.relation === 'NATIONAL_DOUBLE_DEGREE' ||
     /\b(?:dual|double)\s*degree|dua\s*gelar\b/i.test(rawQuery) ||
     semanticFrame.contextDependencies?.some(cd => /double\s*degree/i.test(cd.inheritedEntity || '')));

  if (isNationalDDQuery) {
    // Cannot claim partner is Universitas Teknologi Bali (must be Bandung / UTB)
    if (/universitas\s+teknologi\s+bali/i.test(text)) {
      return failVerification('partner_name_contradiction_bali_instead_of_bandung');
    }

    // Cannot use facility framing ("daftar program/fasilitas kampus") as substitute for program
    if (/daftar\s+(?:program\s*\/\s*)?fasilitas\s+kampus/i.test(text)) {
      return failVerification('forbidden_facility_framing_for_national_double_degree');
    }

    // Unjustified refusal check when UTB evidence is present in accepted evidence
    const hasUtbAccepted = arbitratedEvidence?.accepted?.some(c => {
      const cText = c.text || c.chunk || '';
      return /\b(?:UTB|UNIVERSITAS\s+TEKNOLOGI\s+BANDUNG)\b/i.test(cText);
    });

    if (hasUtbAccepted) {
      const isRefusingPartner = /\b(?:mitra.*belum\s+tercantum|rincian\s+mengenai\s+mitra.*belum|belum\s+tercantum\s+dalam\s+panduan)\b/i.test(text);
      if (isRefusingPartner && !/\b(?:Bandung|UTB)\b/i.test(text)) {
        return failVerification('unjustified_refusal_national_partner_available');
      }
    }
  }

  // 7d. Academic Process & Advising Grounding Guards (Fidelity against hallucinations)
  isAdvisingInquiry = isAdvisingInquiry || semanticFrame.domain === 'ACADEMIC_PROCESS' ||
    semanticFrame.intent === 'ACADEMIC_ADVISING_INQUIRY' ||
    (semanticFrame.aspects && (semanticFrame.aspects.includes('academic_advising') || semanticFrame.aspects.includes('dosen_wali') || semanticFrame.aspects.includes('krs')));

  if (isAdvisingInquiry) {
    const acceptedTexts = (arbitratedEvidence.accepted || []).map(c => (c.text || c.chunk || '').toLowerCase()).join(' ');

    // 1. Location hallucination check (e.g. Laboratorium Database, Lantai 3, Kampus Renon)
    const mentionsLabDb = /\b(?:lab(?:oratorium)?\s+database|lantai\s+3)\b/i.test(text);
    if (mentionsLabDb && !/\b(?:lab(?:oratorium)?\s+database|lantai\s+3)\b/i.test(acceptedTexts)) {
      return failVerification('unsupported_factual_claim_location: Lab Database Lantai 3 not in accepted evidence');
    }

    // 2. Document & payment obligation hallucination for late advising
    const mentionsMandatoryPaymentProof = /\b(?:membawa\s+(?:bukti\s+pembayaran|krs\s+manual)|wajib\s+membawa\s+bukti)\b/i.test(text);
    if (mentionsMandatoryPaymentProof && !/\b(?:membawa\s+(?:bukti\s+pembayaran|krs\s+manual)|wajib\s+membawa\s+bukti)\b/i.test(acceptedTexts)) {
      return failVerification('unsupported_factual_claim_document_obligation: proof of payment / manual KRS not in accepted evidence');
    }

    // 3. Polling and payment translation into dosen wali approval
    const conflatesPollingWithApproval = /\b(?:polling[^\n.]*persetujuan\s+dosen\s+wali|persetujuan\s+dosen\s+wali[^\n.]*polling)\b/i.test(text);
    if (conflatesPollingWithApproval && !/\bpersetujuan\s+dosen\s+wali\b/i.test(acceptedTexts)) {
      return failVerification('unsupported_factual_claim_polling_approval: polling conflated with dosen wali approval');
    }

    // 4. Metric distortion: credit limit must not claim IPS when evidence specifies IPK or general IP
    const mentionsIPS = /\bIPS\s+(?:semester|sebelumnya)\b/i.test(text);
    if (mentionsIPS && !/\bIPS\b/i.test(acceptedTexts)) {
      return failVerification('unsupported_factual_claim_credit_limit_metric: IPS claimed without evidence');
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
  const isAnswerable = arbitratedEvidence?.answerability === 'ANSWERABLE' ||
    arbitratedEvidence?.answerabilityStatus === 'ANSWERABLE';

  const hasSubstantiveContent = text.length > 80 && (
    /\b(antara\s+lain|meliputi|bekerja\s+sama|mitra|lulusan\s+memperoleh|potongan|persyaratan|berikut|kurikulum|discounts?|requirements?|available|guidelines?|recorded|includes?|tuition|admissions?|scholarships?)\b/i.test(text)
  );

  if (isExplicitAbstain) {
    if (!hasSubstantiveContent) {
      // Total refusal: If answerability is ANSWERABLE and evidence exists, this refusal is unjustified!
      if (isAnswerable && arbitratedEvidence?.accepted?.length > 0) {
        return failVerification('unjustified_refusal_evidence_available');
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
    // Substantive content accompanied by missing aspect disclosure (grounded partial answer)
    if (arbitratedEvidence?.accepted && arbitratedEvidence.accepted.length > 0) {
      return {
        pass: true,
        outcome: VERIFICATION_OUTCOME.VERIFIED_FACTUAL,
        status: VERIFICATION_OUTCOME.VERIFIED_FACTUAL,
        reason: 'verified_grounded_partial_disclosure',
        isGrounded: true,
        handledSafely: true
      };
    }
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
