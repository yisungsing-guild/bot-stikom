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

let canonicalFeeRegistry = null;
try {
  canonicalFeeRegistry = require('../../data/runtime/canonical_fee_registry.json');
} catch (e) {
  canonicalFeeRegistry = null;
}

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
  /Ketua Program Studi S1-/i,
  /Gunakan nama file, caption, atau input manual/i,
  /input manual tambahan untuk memberi konteks/i,
  /\|\s*visi\s*Akademik\s*\|/i,
  /\|\s*kelas\s+Karir\s*\|/i
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
    const hasContactDetails = /\b(whatsapp|wa|telepon|telp|nomor|call|phone|contact|email|humas|pmb|hotline|08[\d\-.\s]{8,}|0361|\.ac\.id)\b/i.test(text);
    const isExplicitAbstain = /tidak\s+ditemukan|belum\s+(?:tersedia|tercantum|disebutkan|terdapat)|tidak\s+dapat\s+diverifikasi|not\s+(?:listed|found|available|recorded)|unrecorded/i.test(text);
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

    // Ungrounded numeric accreditation score check (e.g. hallucinating "nilai 303" from SK number 3033)
    const scoreMatch = text.match(/\b(?:nilai|skor)\s+(\d{2,4})\b/i);
    if (scoreMatch) {
      const claimedScore = scoreMatch[1];
      const acceptedTexts = (arbitratedEvidence.accepted || []).map(c => (c.text || c.chunk || '').toLowerCase()).join(' ');
      const hasVerifiedScore = new RegExp(`\\b(?:nilai|skor)\\s+${claimedScore}\\b`, 'i').test(acceptedTexts);
      if (!hasVerifiedScore) {
        return failVerification(`unsupported_accreditation_score_claim: nilai ${claimedScore}`);
      }
    }
  }

  // 7a2. Curriculum table dump negative control: Must not dump full 8 semesters for specific non-curriculum inquiries
  const hasFullCurriculumDump = /\bSemester\s+I\s*\([^)]*\):.*Semester\s+VIII\s*\([^)]*\):/is.test(text) ||
    (/\bSemester\s+I\b/i.test(text) && /\bSemester\s+VIII\b/i.test(text) && /\b144\s*SKS\b/i.test(text));
  if (hasFullCurriculumDump) {
    const isExplicitCurriculumQuery = /\b(?:kurikulum|mata\s*kuliah|matkul|sebaran\s*matkul|silabus|daftar\s*matkul|ambil\s*apa\s*saja)\b/i.test(rawQuery);
    const isSpecificPrerequisiteOrThesis = /\b(?:coding|komputer|jago|halaman|lembar|tebal|tugas\s+akhir|skripsi|sion)\b/i.test(rawQuery);
    if (!isExplicitCurriculumQuery || isSpecificPrerequisiteOrThesis) {
      return failVerification('aspect_mismatch_curriculum_dump_for_non_curriculum_query');
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

  // 7e. Tuition Fee Grounding & Calculation Invariants
  if (isFeeInquiry) {
    const feeQueryText = String(semanticFrame.rawQuery || semanticFrame.normalizedQuery || '').trim();

    // 1. General invariant: Prevent claiming ungrounded discounts or equating unverified waves without proof
    // Pattern captures sub-waves (e.g. 1A, 1B, 2C, 3B, II-C) or out-of-range custom waves
    const subWaveOrUnverifiedPattern = /\bgelombang\s*(?:[1-4]\s*[-_]?\s*[a-z]\b|(?:iv|iii|ii|i)\s*[-_]?\s*[a-hj-uw-z]\b|[5-9]\b)/i;
    const mentionsUnverifiedWave = subWaveOrUnverifiedPattern.test(feeQueryText) || subWaveOrUnverifiedPattern.test(text);

    if (mentionsUnverifiedWave) {
      const claimsUnverifiedDiscount = /\b(?:potongan|diskon|beasiswa)\b/i.test(text) &&
        subWaveOrUnverifiedPattern.test(text) &&
        !/\b(?:tidak\s+tercantum|belum\s+(?:terverifikasi|tersedia|dapat\s+dipastikan)|catatan|source_gap)\b/i.test(text);
      if (claimsUnverifiedDiscount) {
        const is2C = /2[cC]|ii[-_ ]*[cC]/i.test(text) || /2[cC]|ii[-_ ]*[cC]/i.test(feeQueryText);
        return failVerification(is2C ? 'ungrounded_fee_wave_claim_gelombang_2c_without_proof' : 'ungrounded_fee_wave_claim_unverified_without_proof');
      }

      const equatesWithoutProof = /\b(?:adalah|sama\s*(?:persis\s+)?(?:dengan)?|merupakan\s+bagian\s+dari)\s+gelombang\s+(?:khusus|i{1,4}|[1-4]|sisipan)\b/i.test(text) &&
        !/\b(?:tidak\s+dapat\s+disamakan|belum\s+terverifikasi|tidak\s+tercantum)\b/i.test(text);
      if (equatesWithoutProof) {
        const is2C = /2[cC]|ii[-_ ]*[cC]/i.test(text) || /2[cC]|ii[-_ ]*[cC]/i.test(feeQueryText);
        return failVerification(is2C ? 'ungrounded_fee_wave_claim_gelombang_2c_equated_without_proof' : 'ungrounded_fee_wave_claim_equated_without_proof');
      }
    }

    // 2. Prevent double counting DPP and DPP installments in the same calculation
    if (/\b(?:total|subtotal)\b/i.test(text)) {
      const hasDppAndInstallmentDoubleCount = /\bdpp\s+.*cicilan\s+dpp\s+.*total/i.test(text);
      if (hasDppAndInstallmentDoubleCount) {
        return failVerification('fee_arithmetic_double_counted_dpp_and_installment');
      }
    }

    // 3. S2 vs S1 fee isolation: S2 inquiry must not output S1 DPP (Rp 14.000.000 or Rp 11.000.000)
    const isS2Fee = (semanticFrame.entities || []).some(e => /s2|magister|pascasarjana/i.test(e.canonical || e.name || String(e))) ||
      /\b(?:s2|magister|pascasarjana)\b/i.test(rawQuery);
    if (isS2Fee) {
      if (/\b(?:14\.000\.000|11\.000\.000|6\.500\.000|5\.500\.000)\b/.test(text)) {
        return failVerification('degree_fee_pollution_s1_fees_in_s2_answer');
      }
    }

    // 4. Double-counting & component conflation protection: Prevent conflating semester fee into initial obligation
    if (/\b(?:total\s+(?:kewajiban\s+)?awal|total\s+biaya\s+awal)\b/i.test(text)) {
      if (/\b(?:22\.500\.000|19\.200\.000)\b/.test(text)) {
        return failVerification('fee_arithmetic_conflated_semester_fee_into_initial_total');
      }
    }

    // 5. D3 fee classification invariant: D3's Biaya Registrasi must NEVER be classified or labeled as DPP
    if (/D3\s+Manajemen\s+Informatika/i.test(text)) {
      if (/\b(?:DPP|Dana\s+Pendidikan\s+Pokok)(?:\s+dasar)?\s*:\s*(?:Rp\s*)?10\.000\.000/i.test(text) ||
          /\bD3\s+Manajemen\s+Informatika[^\n]*\bDPP\s*:\s*Rp/i.test(text) ||
          /\bDPP\s+D3\s+Manajemen/i.test(text)) {
        return failVerification('d3_fee_misclassified_as_dpp');
      }
    }

    // 6. 10% Cash DPP Discount claim verification:
    // Primary sources (Lampiran 1-3, 6): Valid only for S1 SI, TI, BD, SK, D3 MI, and S1 UTB.
    // S2 Pascasarjana and Double Degree HELP/DNUI do not have cash DPP 10% discount.
    const claims10PctDppDiscount = /\b(?:10%|10\s*persen|sepuluh\s+persen)/i.test(text) &&
      /\b(?:tunai|lunas|pelunasan|cash)\b/i.test(text) &&
      /\b(?:dpp|dana\s+pendidikan\s+pokok|potongan\s+ditambah|diskon\s+tambahan|potongan|diskon)\b/i.test(text);

    if (claims10PctDppDiscount) {
      const topEntity = (semanticFrame.entities && semanticFrame.entities[0])
        ? (semanticFrame.entities[0].canonical || semanticFrame.entities[0].name || String(semanticFrame.entities[0]))
        : '';
      const queryStr = String(semanticFrame.rawQuery || semanticFrame.normalizedQuery || '');
      const isS2Target = /s2|magister|pascasarjana/i.test(topEntity) || /\b(?:s2|magister|pascasarjana)\b/i.test(queryStr);
      if (isS2Target) {
        return failVerification('unsupported_10pct_cash_discount_claim_for_s2');
      }

      const isDoubleDegreeTarget = /double\s+degree|dual\s+degree|help|dnui/i.test(topEntity) || /\b(?:double\s+degree|dual\s+degree|help|dnui)\b/i.test(queryStr);
      if (isDoubleDegreeTarget) {
        return failVerification('unsupported_10pct_cash_discount_claim_for_double_degree');
      }

      const isD3Target = /d3|manajemen\s+informatika/i.test(topEntity) || /\b(?:d3|manajemen\s+informatika)\b/i.test(queryStr);
      if (isD3Target && /biaya\s+registrasi/i.test(text) && /\b(?:10%|10\s*persen|sepuluh\s+persen)/i.test(text)) {
        return failVerification('unsupported_10pct_cash_discount_claim_for_d3_registration');
      }

      const canonicalFeeRegistry = require('../../data/runtime/canonical_fee_registry.json');
      const canonicalProfile = (canonicalFeeRegistry && canonicalFeeRegistry.programs && topEntity)
        ? (canonicalFeeRegistry.programs[topEntity] || null)
        : null;

      const acceptedTexts = (arbitratedEvidence.accepted || []).map(c => (c.text || c.chunk || '').toLowerCase()).join(' ');
      const has10PctEvidence = /\b(?:10%|10\s*persen|sepuluh\s+persen)/i.test(acceptedTexts) && /\b(?:tunai|dpp|potongan)\b/i.test(acceptedTexts);
      const has10PctInRegistry = canonicalProfile && (
        canonicalProfile.components?.dpp?.cashDiscountPercent === 10 ||
        canonicalProfile.cashDiscountPercentage === 10 ||
        canonicalProfile.cashDppDiscountRate === 0.1 ||
        canonicalProfile.notes?.cashDppDiscount
      );

      if (!has10PctEvidence && !has10PctInRegistry) {
        return failVerification('unsupported_10pct_cash_discount_claim_without_evidence');
      }
    }

    // 7. Fee nominal provenance check against accepted evidence and canonical registry
    const rpGlobalRegex = /Rp\s*([\d\.]+)/gi;
    let rpMatch;
    const feeClaims = [];
    while ((rpMatch = rpGlobalRegex.exec(text)) !== null) {
      const idx = rpMatch.index;
      const numClean = rpMatch[1].replace(/\./g, '').trim();
      const numVal = parseInt(numClean, 10);
      if (!isNaN(numVal) && numVal > 0) {
        const lineStart = text.lastIndexOf('\n', idx);
        const currentLine = text.substring(lineStart === -1 ? 0 : lineStart, idx).toLowerCase();
        let clauseStart = lineStart;
        for (let i = idx - 1; i > lineStart; i--) {
          if (text[i] === ';' || text[i] === '+' || text[i] === '(' || text[i] === ')' || text[i] === ',' || (text[i] === '.' && /\s/.test(text[i + 1] || ''))) {
            clauseStart = i + 1;
            break;
          }
        }
        const currentClause = text.substring(clauseStart === -1 ? 0 : clauseStart, idx).toLowerCase().replace(/^\*+|\*+$/g, '').trim();
        const precedingContext = text.substring(lineStart === -1 ? 0 : lineStart, idx).toLowerCase();
        const immPreceding = text.substring(Math.max(lineStart === -1 ? 0 : lineStart, idx - 85), idx).toLowerCase();

        let afterIdx = idx + rpMatch[0].length;
        let lineEnd = text.indexOf('\n', afterIdx);
        if (lineEnd === -1) lineEnd = text.length;
        let clauseEnd = lineEnd;
        for (let i = afterIdx; i < lineEnd; i++) {
          if (text[i] === ';' || text[i] === '+' || text[i] === '(' || text[i] === ')' || text[i] === ',' || (text[i] === '.' && /\s/.test(text[i + 1] || ''))) {
            clauseEnd = i;
            break;
          }
        }
        const followingClause = text.substring(afterIdx, clauseEnd).toLowerCase().replace(/^\*+|\*+$/g, '').trim();
        const immFollowing = text.substring(afterIdx, Math.min(text.length, afterIdx + 85)).toLowerCase();
        feeClaims.push({ numVal, numClean, currentLine, currentClause, followingClause, precedingContext, immPreceding, immFollowing, matchText: rpMatch[0] });
      }
    }

    if (feeClaims.length > 0) {
      const entityName = (semanticFrame.entities && semanticFrame.entities[0])
        ? (semanticFrame.entities[0].canonical || semanticFrame.entities[0].name || String(semanticFrame.entities[0]))
        : '';

      const hasNominalInEvidence = (numVal, numClean) => {
        if (!arbitratedEvidence.accepted || arbitratedEvidence.accepted.length === 0) return false;
        const formatted = numVal.toLocaleString('id-ID');

        return arbitratedEvidence.accepted.some(c => {
          const txt = (c.text || c.chunk || c.content || '').toLowerCase();
          if (!txt.includes(numClean) && !txt.includes(formatted)) return false;

          if (entityName) {
            const entNorm = entityName.toLowerCase();
            const isPasca = entNorm.includes('s2') || entNorm.includes('magister') || entNorm.includes('pascasarjana');
            const matchesPasca = isPasca && (txt.includes('pascasarjana') || txt.includes('magister') || txt.includes('s2'));
            const progWords = entNorm.replace(/\b(s1|d3|s2|program|studi|magister)\b/g, '').trim().split(/\s+/).filter(w => w.length > 2);
            const matchesEntity = matchesPasca || txt.includes(entNorm) || (progWords.length > 0 && progWords.every(w => txt.includes(w)));
            if (!matchesEntity) {
              return false; // Nominal found in evidence for a different program!
            }
          }
          return true;
        });
      };

      let canonicalProfile = null;
      if (canonicalFeeRegistry && canonicalFeeRegistry.programs && entityName) {
        canonicalProfile = canonicalFeeRegistry.programs[entityName] || null;
      }

      const reqWave = semanticFrame.registrationWave ||
        (rawQuery.match(/\b(?:gelombang\s*(?:ii\b|2\b)|gel\s*(?:ii\b|2\b))/i) ? 'Gelombang II' :
         rawQuery.match(/\b(?:gelombang\s*(?:i\b|1\b)|gel\s*(?:i\b|1\b))/i) ? 'Gelombang I' :
         rawQuery.match(/\b(?:gelombang\s*khusus|gel\s*khusus)/i) ? 'Gelombang Khusus' :
         rawQuery.match(/\b(?:gelombang\s*(?:iii\b|3\b)|gel\s*(?:iii\b|3\b))/i) ? 'Gelombang III' :
         rawQuery.match(/\b(?:gelombang\s*(?:iv\b|4\b)|gel\s*(?:iv\b|4\b))/i) ? 'Gelombang IV' :
         rawQuery.match(/\b(?:gelombang\s*sisipan|gel\s*sisipan)/i) ? 'Gelombang Sisipan' : null);

      const isWaveComparisonQuery = /\b(?:beda|perbedaan|bandingkan|versus|vs)\b/i.test(rawQuery) && /\bgelombang\b/i.test(rawQuery);

      const PACKAGE_LUMP_SUM_REGEX = /(?:total\s+)?paket(?:\s+\d+\s+semester)?|pembayaran\s+(?:secara\s+)?lunas|opsi\s+lunas|lunas\s+\d+\s+tahun|lunas\s+selama|total\s+(?:biaya\s+)?studi(?:\s+sampai\s+lulus)?|total\s+keseluruhan\s+studi|selama\s+(?:2\s+tahun|4\s+semester|\d+\s+semester)|sampai\s+lulus/i;

      for (const claim of feeClaims) {
        const { numVal, numClean, currentLine, currentClause, followingClause, precedingContext, immPreceding, immFollowing } = claim;

        let compType = 'unknown';
        // 1. Check immediate following clause if it specifies the component (e.g. "Rp 10.000.000 per semester")
        if (/\bspp\b|biaya\s+pendidikan\s+per\s+semester|per\s+semester|tiap\s+semester/i.test(followingClause)) {
          compType = 'semester';
        } else if (PACKAGE_LUMP_SUM_REGEX.test(followingClause)) {
          compType = 'package_lump_sum';
        } else if (/\bdpp\b|dana\s+pendidikan\s+pokok/i.test(followingClause)) {
          compType = 'dpp';
        } else if (/pendaftaran|uang\s+daftar/i.test(followingClause)) {
          compType = 'pendaftaran';
        }

        // 2. Check current preceding clause
        if (compType === 'unknown') {
          if (PACKAGE_LUMP_SUM_REGEX.test(currentClause)) {
            compType = 'package_lump_sum';
          } else if (/bahasa|mandarin|inggris/i.test(currentClause)) {
            compType = 'bahasa';
          } else if (/\bdpp\b|dana\s+pendidikan\s+pokok|biaya\s+registrasi/i.test(currentClause)) {
            compType = 'dpp';
          } else if (/(?:total\s+)?kewajiban\s+biaya\s+awal|total\s+(?:kewajiban|biaya\s+awal)/i.test(currentClause)) {
            compType = 'total_initial';
          } else if (/pendaftaran\s*\+\s*perlengkapan|registrasi\s+awal|pembayaran\s+(?:tunai\s+)?langsung|wajib\s+di\s+awal/i.test(currentClause)) {
            compType = 'upfront_cash';
          } else if (/pendaftaran|uang\s+daftar/i.test(currentClause)) {
            compType = 'pendaftaran';
          } else if (/\bspp\b|biaya\s+pendidikan\s+per\s+semester/i.test(currentClause)) {
            compType = 'semester';
          } else if (/perlengkapan|jas|topi|kaos|tas|gmti/i.test(currentClause) && !/biaya\s+registrasi/i.test(currentClause)) {
            compType = 'perlengkapan';
          } else if (/industri|internasional|nasional|lokal/i.test(currentClause)) {
            compType = 'industri';
          } else if (PACKAGE_LUMP_SUM_REGEX.test(immFollowing || '')) {
            compType = 'package_lump_sum';
          }
        }

        if (compType === 'unknown') {
          const lastPackageIdx = Math.max(
            immPreceding.lastIndexOf('lunas'),
            immPreceding.lastIndexOf('paket'),
            immPreceding.lastIndexOf('sampai lulus')
          );
          const lastSemesterIdx = Math.max(
            immPreceding.lastIndexOf('per semester'),
            immPreceding.lastIndexOf('spp')
          );
          if (lastPackageIdx > -1 && lastPackageIdx > lastSemesterIdx) {
            compType = 'package_lump_sum';
          } else if (/(?:total\s+)?kewajiban\s+biaya\s+awal|total\s+(?:kewajiban|biaya\s+awal)/i.test(immPreceding)) {
            compType = 'total_initial';
          } else if (/pendaftaran\s*\+\s*perlengkapan|registrasi\s+awal|pembayaran\s+(?:tunai\s+)?langsung|wajib\s+di\s+awal/i.test(immPreceding)) {
            compType = 'upfront_cash';
          } else if (/bahasa|mandarin|inggris/i.test(immPreceding)) {
            compType = 'bahasa';
          } else if (/biaya\s+pendidikan\s+per\s+semester|per\s+semester|\bspp\b/i.test(immPreceding) && !/mulai\s+semester/i.test(immPreceding)) {
            compType = 'semester';
          } else if (/\bdpp\b|dana\s+pendidikan\s+pokok|biaya\s+registrasi/i.test(immPreceding)) {
            compType = 'dpp';
          } else if (/pendaftaran|uang\s+daftar/i.test(immPreceding)) {
            compType = 'pendaftaran';
          } else if (/perlengkapan|jas|topi|kaos|tas|gmti/i.test(immPreceding) && !/biaya\s+registrasi/i.test(currentLine)) {
            compType = 'perlengkapan';
          } else if (/industri|internasional|nasional|lokal/i.test(immPreceding)) {
            compType = 'industri';
          }
        }

        if (compType === 'unknown') {
          if (PACKAGE_LUMP_SUM_REGEX.test(currentLine) && !/per\s+semester/i.test(currentClause)) {
            compType = 'package_lump_sum';
          } else if (/total\s+(?:kewajiban|biaya\s+awal)/i.test(currentLine) && !/tunai|langsung|kewajiban\s+dpp|registrasi\s*\(jas/i.test(currentClause)) {
            compType = 'total_initial';
          } else if (/pendaftaran\s*\+\s*perlengkapan|registrasi\s+awal|pembayaran\s+(?:tunai\s+)?langsung|wajib\s+di\s+awal/i.test(currentLine)) {
            compType = 'upfront_cash';
          } else if (/industri|internasional|nasional|lokal/i.test(currentLine)) {
            compType = 'industri';
          } else if (/bahasa|mandarin|inggris/i.test(currentLine)) {
            compType = 'bahasa';
          } else if (/\bdpp\b|dana\s+pendidikan\s+pokok|biaya\s+registrasi/i.test(currentLine)) {
            compType = 'dpp';
          } else if (/perlengkapan|jas|topi|kaos|tas|gmti/i.test(currentLine) && !/biaya\s+registrasi/i.test(currentLine)) {
            compType = 'perlengkapan';
          } else if (/\bspp\b|biaya\s+pendidikan\s+per\s+semester/i.test(currentLine)) {
            compType = 'semester';
          } else if (/pendaftaran|uang\s+daftar/i.test(currentLine)) {
            compType = 'pendaftaran';
          }
        }

        if (!canonicalProfile) {
          let supportedByAnyProfile = false;
          if (canonicalFeeRegistry && canonicalFeeRegistry.programs) {
            for (const prog of Object.values(canonicalFeeRegistry.programs)) {
              const baseReg = prog.components?.pendaftaran?.amount || 0;
              const basePerl = (prog.components?.jasTopi?.amount || 0) +
                (prog.components?.kaosTasGmti?.amount || 0) +
                (prog.components?.jasAlmamater?.amount || 0) +
                (prog.components?.topi?.amount || 0) +
                (prog.components?.kaosTas?.amount || 0) +
                (prog.components?.gmti?.amount || 0);
              const baseDpp = prog.components?.dpp?.amount || 0;
              const baseSem = prog.components?.biayaSemester?.amount || 0;
              const baseBahasa = (prog.components?.bahasaMandarin?.amount || 0) + (prog.components?.bahasaInggris?.amount || 0);
              const allowedInProg = [
                baseReg, basePerl, baseDpp, baseSem, baseBahasa,
                baseReg + basePerl + baseDpp + baseBahasa,
                baseReg + basePerl,
                baseReg + baseDpp
              ];
              if (prog.components?.jasTopi?.amount) allowedInProg.push(prog.components.jasTopi.amount);
              if (prog.components?.kaosTasGmti?.amount) allowedInProg.push(prog.components.kaosTasGmti.amount);
              if (prog.components?.bahasaMandarin?.amount) allowedInProg.push(prog.components.bahasaMandarin.amount);
              if (prog.components?.pengalamanIndustri?.options) {
                Object.values(prog.components.pengalamanIndustri.options).forEach(opt => {
                  if (opt.amount) allowedInProg.push(opt.amount);
                });
              }
              if (prog.components?.pembayaranLunas2Tahun?.amount) allowedInProg.push(prog.components.pembayaranLunas2Tahun.amount);
              if (prog.components?.pembayaranLunas2Tahun?.amount && baseReg > 0) allowedInProg.push(prog.components.pembayaranLunas2Tahun.amount + baseReg);
              if (baseSem > 0 && prog.normalDurationSemesters) allowedInProg.push(baseSem * prog.normalDurationSemesters);
              if (prog.specialPolicies?.semester5Tesis) allowedInProg.push(prog.specialPolicies.semester5Tesis);
              if (prog.waveDiscounts) {
                Object.values(prog.waveDiscounts).forEach(wd => {
                  const netR = baseReg - (wd.pendaftaranDiscount || 0);
                  const netD = baseDpp - (wd.dppDiscount || 0);
                  if (wd.pendaftaranDiscount) allowedInProg.push(wd.pendaftaranDiscount);
                  if (wd.dppDiscount) allowedInProg.push(wd.dppDiscount);
                  allowedInProg.push(netR);
                  allowedInProg.push(netD);
                  allowedInProg.push(netR + basePerl);
                  allowedInProg.push(netR + basePerl + netD + baseBahasa);
                  allowedInProg.push(netR + netD); // e.g. D3 MI: 300k + 9.250k = 9.550.000
                });
              }
              if (allowedInProg.includes(numVal)) {
                supportedByAnyProfile = true;
                break;
              }
            }
          }
          if (!supportedByAnyProfile && !hasNominalInEvidence(numVal, numClean)) {
            return failVerification(`unsupported_factual_claim_fee_nominal_divergence: fee nominal Rp ${numVal.toLocaleString('id-ID')} has no supporting source evidence or canonical profile`);
          }
        } else {
          const baseReg = canonicalProfile.components?.pendaftaran?.amount || 0;
          const basePerlengkapan = (canonicalProfile.components?.jasTopi?.amount || 0) +
            (canonicalProfile.components?.kaosTasGmti?.amount || 0) +
            (canonicalProfile.components?.jasAlmamater?.amount || 0) +
            (canonicalProfile.components?.topi?.amount || 0) +
            (canonicalProfile.components?.kaosTas?.amount || 0) +
            (canonicalProfile.components?.gmti?.amount || 0);
          const baseDpp = canonicalProfile.components?.dpp?.amount || 0;
          const baseSemester = canonicalProfile.components?.biayaSemester?.amount || 0;
          const baseBahasa = (canonicalProfile.components?.bahasaMandarin?.amount || 0) + (canonicalProfile.components?.bahasaInggris?.amount || 0);

          const allowedSubPerlengkapan = [];
          if (canonicalProfile.components?.jasTopi?.amount) allowedSubPerlengkapan.push(canonicalProfile.components.jasTopi.amount);
          if (canonicalProfile.components?.kaosTasGmti?.amount) allowedSubPerlengkapan.push(canonicalProfile.components.kaosTasGmti.amount);
          if (canonicalProfile.components?.jasAlmamater?.amount) allowedSubPerlengkapan.push(canonicalProfile.components.jasAlmamater.amount);
          if (canonicalProfile.components?.topi?.amount) allowedSubPerlengkapan.push(canonicalProfile.components.topi.amount);
          if (canonicalProfile.components?.kaosTas?.amount) allowedSubPerlengkapan.push(canonicalProfile.components.kaosTas.amount);
          if (canonicalProfile.components?.gmti?.amount) allowedSubPerlengkapan.push(canonicalProfile.components.gmti.amount);

          const allowedSubBahasa = [];
          if (canonicalProfile.components?.bahasaMandarin?.amount) allowedSubBahasa.push(canonicalProfile.components.bahasaMandarin.amount);
          if (canonicalProfile.components?.bahasaInggris?.amount) allowedSubBahasa.push(canonicalProfile.components.bahasaInggris.amount);

          const allowedRegs = [baseReg];
          if (canonicalProfile.waveDiscounts) {
            Object.values(canonicalProfile.waveDiscounts).forEach(wd => {
              allowedRegs.push(baseReg - (wd.pendaftaranDiscount || 0));
              if (wd.pendaftaranDiscount) allowedRegs.push(wd.pendaftaranDiscount);
            });
          }

          const allowedDpps = [baseDpp];
          if (canonicalProfile.waveDiscounts) {
            Object.values(canonicalProfile.waveDiscounts).forEach(wd => {
              allowedDpps.push(baseDpp - (wd.dppDiscount || 0));
              if (wd.dppDiscount) allowedDpps.push(wd.dppDiscount);
            });
          }

          if (compType === 'total_initial') {
            const allowedTotals = [baseReg + basePerlengkapan + baseDpp + baseBahasa];
            if (canonicalProfile.waveDiscounts) {
              Object.values(canonicalProfile.waveDiscounts).forEach(wd => {
                const netR = baseReg - (wd.pendaftaranDiscount || 0);
                const netD = baseDpp - (wd.dppDiscount || 0);
                allowedTotals.push(netR + basePerlengkapan + netD + baseBahasa);
              });
            }
            if (!allowedTotals.includes(numVal) && !hasNominalInEvidence(numVal, numClean)) {
              return failVerification(`unsupported_factual_claim_fee_nominal_divergence: total initial fee Rp ${numVal.toLocaleString('id-ID')} does not match source or canonical evidence`);
            }
          } else if (compType === 'upfront_cash') {
            const allowedUpfront = allowedRegs.map(r => r + basePerlengkapan);
            if (!allowedUpfront.includes(numVal) && !hasNominalInEvidence(numVal, numClean)) {
              return failVerification(`unsupported_factual_claim_fee_nominal_divergence: upfront payment Rp ${numVal.toLocaleString('id-ID')} does not match source or canonical evidence`);
            }
          } else if (compType === 'industri') {
            const allowedIndustri = [5000000, 2500000, 1500000];
            if (canonicalProfile.components?.pengalamanIndustri?.options) {
              Object.values(canonicalProfile.components.pengalamanIndustri.options).forEach(opt => {
                if (opt.amount) allowedIndustri.push(opt.amount);
              });
            }
            if (!allowedIndustri.includes(numVal) && !hasNominalInEvidence(numVal, numClean)) {
              return failVerification(`unsupported_factual_claim_fee_nominal_divergence: industry fee Rp ${numVal.toLocaleString('id-ID')} does not match source or canonical evidence`);
            }
          } else if (compType === 'perlengkapan') {
            const allowedPerlengkapan = [basePerlengkapan, ...allowedSubPerlengkapan];
            if (!allowedPerlengkapan.includes(numVal) && !hasNominalInEvidence(numVal, numClean)) {
              return failVerification(`unsupported_factual_claim_fee_nominal_divergence: perlengkapan fee Rp ${numVal.toLocaleString('id-ID')} does not match source or canonical evidence`);
            }
          } else if (compType === 'bahasa') {
            const allowedBahasa = [baseBahasa, ...allowedSubBahasa];
            if (!allowedBahasa.includes(numVal) && !hasNominalInEvidence(numVal, numClean)) {
              return failVerification(`unsupported_factual_claim_fee_nominal_divergence: language fee Rp ${numVal.toLocaleString('id-ID')} does not match source or canonical evidence`);
            }
          } else if (compType === 'pendaftaran') {
            if (!allowedRegs.includes(numVal) && !hasNominalInEvidence(numVal, numClean)) {
              return failVerification(`unsupported_factual_claim_fee_nominal_divergence: registration fee Rp ${numVal.toLocaleString('id-ID')} does not match source or canonical evidence`);
            }
            // Cross-wave nominal check: if a specific wave was asked, ensure the claimed wave net does not belong to another wave
            if (reqWave && canonicalProfile.waveDiscounts && canonicalProfile.waveDiscounts[reqWave] && !isWaveComparisonQuery) {
              const targetNetReg = baseReg - canonicalProfile.waveDiscounts[reqWave].pendaftaranDiscount;
              const targetRegDiscount = canonicalProfile.waveDiscounts[reqWave].pendaftaranDiscount;
              if (numVal !== baseReg && numVal !== targetNetReg && numVal !== targetRegDiscount) {
                for (const [otherWave, otherDisc] of Object.entries(canonicalProfile.waveDiscounts)) {
                  if (otherWave !== reqWave && otherDisc.pendaftaranDiscount > 0) {
                    const otherNetReg = baseReg - otherDisc.pendaftaranDiscount;
                    if (numVal === otherNetReg) {
                      return failVerification(`cross_wave_fee_nominal_pollution: registration fee Rp ${numVal.toLocaleString('id-ID')} belongs to ${otherWave}, not ${reqWave}`);
                    }
                  }
                }
              }
            }
          } else if (compType === 'dpp') {
            if (!allowedDpps.includes(numVal) && !hasNominalInEvidence(numVal, numClean)) {
              return failVerification(`unsupported_factual_claim_fee_nominal_divergence: DPP fee Rp ${numVal.toLocaleString('id-ID')} does not match source or canonical evidence`);
            }
            // Cross-wave nominal check: if a specific wave was asked, ensure the claimed wave net does not belong to another wave
            if (reqWave && canonicalProfile.waveDiscounts && canonicalProfile.waveDiscounts[reqWave] && !isWaveComparisonQuery) {
              const targetNetDpp = baseDpp - canonicalProfile.waveDiscounts[reqWave].dppDiscount;
              const targetDppDiscount = canonicalProfile.waveDiscounts[reqWave].dppDiscount;
              if (numVal !== baseDpp && numVal !== targetNetDpp && numVal !== targetDppDiscount) {
                for (const [otherWave, otherDisc] of Object.entries(canonicalProfile.waveDiscounts)) {
                  if (otherWave !== reqWave && otherDisc.dppDiscount > 0) {
                    const otherNetDpp = baseDpp - otherDisc.dppDiscount;
                    if (numVal === otherNetDpp) {
                      return failVerification(`cross_wave_fee_nominal_pollution: DPP fee Rp ${numVal.toLocaleString('id-ID')} belongs to ${otherWave}, not ${reqWave}`);
                    }
                  }
                }
              }
            }
          } else if (compType === 'package_lump_sum') {
            const allowedPackage = [];
            if (canonicalProfile.components?.pembayaranLunas2Tahun?.amount) {
              allowedPackage.push(canonicalProfile.components.pembayaranLunas2Tahun.amount);
            }
            const duration = canonicalProfile.normalDurationSemesters || (canonicalProfile.degree === 'S2' ? 4 : 8);
            if (baseSemester > 0) {
              allowedPackage.push(baseSemester * duration);
            }
            if (canonicalProfile.components?.pembayaranLunas2Tahun?.amount && baseReg > 0) {
              allowedPackage.push(canonicalProfile.components.pembayaranLunas2Tahun.amount + baseReg);
            }
            const isKnownNonPackageComponent =
              numVal === baseSemester ||
              numVal === baseReg ||
              numVal === basePerlengkapan;
            if (!allowedPackage.includes(numVal) && (isKnownNonPackageComponent || !hasNominalInEvidence(numVal, numClean))) {
              return failVerification(`unsupported_factual_claim_fee_nominal_divergence: package/lump sum fee Rp ${numVal.toLocaleString('id-ID')} does not match source or canonical evidence`);
            }
          } else if (compType === 'semester') {
            const allowedSemester = [baseSemester];
            if (canonicalProfile.components?.biayaSemester?.alumniSmkAmount) {
              allowedSemester.push(canonicalProfile.components.biayaSemester.alumniSmkAmount);
            }
            const isKnownNonSemesterComponent =
              numVal === canonicalProfile.components?.pembayaranLunas2Tahun?.amount ||
              numVal === canonicalProfile.components?.dpp?.amount ||
              numVal === baseReg ||
              numVal === basePerlengkapan;
            if (!allowedSemester.includes(numVal) && (isKnownNonSemesterComponent || !hasNominalInEvidence(numVal, numClean))) {
              return failVerification(`unsupported_factual_claim_fee_nominal_divergence: semester fee Rp ${numVal.toLocaleString('id-ID')} does not match source or canonical evidence`);
            }
          } else {
            // General check: if number is completely unknown to profile and not in evidence
            const allAllowed = [
              ...allowedRegs,
              ...allowedDpps,
              basePerlengkapan,
              ...allowedSubPerlengkapan,
              baseSemester,
              baseBahasa,
              ...allowedSubBahasa,
              1800000, 2000000,
              14300000, 16000000,
              9250000, 9550000,
              21000000
            ];
            if (canonicalProfile.components?.pengalamanIndustri?.options) {
              Object.values(canonicalProfile.components.pengalamanIndustri.options).forEach(opt => {
                if (opt.amount) allAllowed.push(opt.amount);
              });
            }
            if (canonicalProfile.components?.pembayaranLunas2Tahun?.amount) {
              allAllowed.push(canonicalProfile.components.pembayaranLunas2Tahun.amount);
              if (baseReg > 0) allAllowed.push(canonicalProfile.components.pembayaranLunas2Tahun.amount + baseReg);
            }
            if (baseSemester > 0) {
              const dur = canonicalProfile.normalDurationSemesters || (canonicalProfile.degree === 'S2' ? 4 : 8);
              allAllowed.push(baseSemester * dur);
            }
            if (canonicalProfile.specialPolicies?.semester5Tesis) {
              allAllowed.push(canonicalProfile.specialPolicies.semester5Tesis);
            }
            if (canonicalProfile.specialPolicies?.alumniBeasiswaSemesterDimuka) {
              allAllowed.push(canonicalProfile.specialPolicies.alumniBeasiswaSemesterDimuka);
            }
            if (!allAllowed.includes(numVal) && !hasNominalInEvidence(numVal, numClean)) {
              return failVerification(`unsupported_factual_claim_fee_nominal_divergence: fee nominal Rp ${numVal.toLocaleString('id-ID')} does not match source or canonical evidence`);
            }
          }
        }
      }
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
    const isDateOrScheduleQuery = (
      /\b(?:kapan|tanggal|registrasi\s+ulang|kapan\s+dibuka|kapan\s+ditutup|kapan\s+buka|jadwal|periode|jadwal\s+registrasi)\b/i.test(semanticFrame?.rawQuery || '') ||
      semanticFrame?.intent === 'ADMISSION_SCHEDULE' ||
      (semanticFrame?.aspects && semanticFrame.aspects.includes('schedule'))
    ) && semanticFrame?.intent !== 'TUITION_FEE_INQUIRY';
    const isDateUnavailableInText = /\b(?:tanggal|jadwal|waktu|registrasi\s+ulang)\s+.*(?:belum\s+(?:tercantum|tersedia|dapat\s+dipastikan)|tidak\s+(?:ditemukan|tercantum|tersedia))\b/i.test(text) ||
      /\b(?:belum\s+(?:tercantum|tersedia|dapat\s+dipastikan)|tidak\s+(?:ditemukan|tercantum|tersedia))\b/i.test(text);

    if (isDateOrScheduleQuery && isDateUnavailableInText) {
      return {
        pass: false,
        outcome: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
        status: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
        reason: 'requested_date_unconfirmed',
        isGrounded: false,
        handledSafely: true
      };
    }

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
    const isDateOrScheduleQuery = /\b(?:kapan|tanggal|registrasi\s+ulang|kapan\s+dibuka|kapan\s+ditutup|kapan\s+buka|jadwal\s+registrasi|kapan\s+pembayaran)\b/i.test(semanticFrame?.rawQuery || '');
    const isDateUnavailableInText = /\b(?:tanggal|jadwal|waktu|registrasi\s+ulang)\s+.*(?:belum\s+(?:tercantum|tersedia|dapat\s+dipastikan)|tidak\s+(?:ditemukan|tercantum|tersedia))\b/i.test(text) ||
      /\b(?:belum\s+(?:tercantum|tersedia|dapat\s+dipastikan)|tidak\s+(?:ditemukan|tercantum|tersedia))\b/i.test(text);
    if (isDateOrScheduleQuery && isDateUnavailableInText) {
      return {
        pass: false,
        outcome: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
        status: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
        reason: 'requested_date_unconfirmed',
        isGrounded: false,
        handledSafely: true
      };
    }

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
