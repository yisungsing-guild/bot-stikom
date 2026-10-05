'use strict';

/**
 * adminEscalationRouter.js
 *
 * Context-Aware Admin Escalation / Human Handoff Router Layer.
 *
 * Sits strictly downstream of Evidence Evaluation & Confidence Check,
 * and upstream of Grounded Answer / Final Verification / Final Renderer.
 *
 * INVARIANTS:
 * 1. ZERO PHANTOM NUMBERS: Centralized contact configuration only. Never hallucinate or invent numbers.
 * 2. TOPIC CANONICALITY: Topic routing is derived directly from SemanticFrame and canonical
 *    semantic understanding. Never introduces a contradictory secondary classifier.
 * 3. GENERAL FALLBACK: If topic confidence is low (< 0.60) or unclassifiable, falls back to 'general' (Admin STIKOM Bali).
 * 4. FAIL-CLOSED: High-certainty authoritative evidence answers normally WITHOUT admin contact.
 *    Any uncertainty, absence, conflict, partial coverage, or personal request escalates safely.
 * 5. PARTIAL PRESERVATION: Supported subparts are preserved; unsupported gaps trigger targeted escalation.
 */

const { getAdminContact, formatContactCallToAction } = require('../config/adminContacts');

/**
 * Evaluates whether a query represents a personal account / transaction request
 * that inherently cannot be fulfilled by a public knowledge base.
 *
 * @param {string} rawQuery
 * @returns {{ isPersonal: boolean, personalCategory: string|null }}
 */
function detectPersonalAccountRequest(rawQuery) {
  const q = String(rawQuery || '').trim().toLowerCase();
  if (!q) return { isPersonal: false, personalCategory: null };

  // Personal finance (tagihan saya, pembayaran saya, tunggakan saya)
  if (/\b(?:tagihan|tunggakan|sisa\s+biaya|bukti\s+bayar|riwayat\s+bayar|rekening\s+saya)\b.*\b(?:saya|ku|milik\s+saya)\b/i.test(q) ||
      /\b(?:cek|lihat|mengecek|berapa)\s+(?:tagihan|tunggakan|sisa\s+biaya)\s+(?:saya|ku)\b/i.test(q)) {
    return { isPersonal: true, personalCategory: 'finance' };
  }

  // Personal academic records (nilai saya, ipk saya, krs saya, khs saya, transkrip saya)
  if (/\b(?:nilai|ipk|krs|khs|transkrip|ijazah|jadwal\s+kuliah|absen|presensi)\s+(?:saya|ku|milik\s+saya)\b/i.test(q) ||
      /\b(?:cek|lihat|mengecek)\s+(?:nilai|ipk|krs|khs|transkrip|absen)\s+(?:saya|ku)\b/i.test(q)) {
    return { isPersonal: true, personalCategory: 'academic' };
  }

  // Personal authentication / credentials (password portal, akun siakad, reset kata sandi)
  if (/\b(?:lupa|reset|ganti|ubah)\s+(?:password|kata\s+sandi|pin|akun)\b/i.test(q) ||
      /\b(?:password|kata\s+sandi|akun|login)\s+(?:siakad|portal|email|saya|ku)\b/i.test(q)) {
    return { isPersonal: true, personalCategory: 'it' };
  }

  // Personal admission status (status pendaftaran saya, berkas saya lolos atau tidak)
  if (/\b(?:status\s+pendaftaran|hasil\s+tes|kelulusan|berkas\s+pendaftaran)\s+(?:saya|ku)\b/i.test(q) ||
      /\b(?:cek|status)\s+daftar\s+(?:saya|ku)\b/i.test(q)) {
    return { isPersonal: true, personalCategory: 'admission' };
  }

  // Generic personal statement
  if (/\b(?:biodata|data\s+pribadi|nim)\s+(?:saya|ku)\b/i.test(q)) {
    return { isPersonal: true, personalCategory: 'academic' };
  }

  return { isPersonal: false, personalCategory: null };
}

/**
 * Resolves the canonical administrative escalation topic from SemanticFrame
 * and canonical semantic understanding.
 *
 * @param {object} [frame] Authoritative EffectiveSemanticFrame
 * @param {string} [rawQuery] User input text
 * @param {object} [options]
 * @returns {{ topic: string, confidence: number, source: string }}
 */
function resolveEscalationTopic(frame, rawQuery, options = {}) {
  const q = String(rawQuery || '').toLowerCase();
  const domain = frame?.domain?.primary || options?.domain || '';
  const domainConfidence = typeof frame?.domain?.confidence === 'number'
    ? frame.domain.confidence
    : (typeof options?.domainConfidence === 'number' ? options.domainConfidence : 0.85);

  const intent = frame?.intent?.primary || options?.intent || '';

  // Rule: Low confidence domain falls back to general
  if (domainConfidence < 0.60) {
    return { topic: 'general', confidence: domainConfidence, source: 'low_confidence_fallback' };
  }

  // 1. Check personal query category first if available
  const personalCheck = detectPersonalAccountRequest(q);
  if (personalCheck.isPersonal && personalCheck.personalCategory) {
    return { topic: personalCheck.personalCategory, confidence: 0.95, source: 'personal_request_detection' };
  }

  // 2. IT / System domain
  const isItDomain = /^(?:it|it_system|system|portal|infrastructure)$/i.test(domain) ||
    /\b(?:siakad|portal|wifi|wi-fi|email\s+kampus|moodle|elearning|e-learning|login|password|kata\s+sandi|reset\s+password|akun|server|jaringan|error\s+sistem)\b/i.test(q);
  if (isItDomain) {
    return { topic: 'it', confidence: 0.90, source: 'it_semantics' };
  }

  // 3. Finance domain
  const isFinanceDomain = /^(?:fee|tuition|financial|payment)$/i.test(domain) ||
    /^ask_fee/i.test(intent) ||
    /\b(?:biaya|spp|dpp|uang\s+kuliah|tarif|angsuran|cicilan|pembayaran|tagihan|rekening\s+pembayaran|bayar\s+kuliah|ukt)\b/i.test(q);
  if (isFinanceDomain) {
    return { topic: 'finance', confidence: 0.90, source: 'finance_semantics' };
  }

  // 4. Student Affairs (Kemahasiswaan) domain
  const isStudentAffairs = /^(?:student_organization|organization|extracurricular|student_affairs|kemahasiswaan)$/i.test(domain) ||
    /^ask_organization/i.test(intent) ||
    /\b(?:ukm|ormawa|bem|dpm|hima|kemahasiswaan|kegiatan\s+mahasiswa|organisasi\s+mahasiswa|prestasi\s+mahasiswa|lomba)\b/i.test(q);
  if (isStudentAffairs) {
    return { topic: 'student_affairs', confidence: 0.90, source: 'student_affairs_semantics' };
  }

  // 5. Admission (PMB) domain
  const isAdmission = /^(?:admission|registration|pmb|pmb_schedule|pmb_requirements|pmb_procedure)$/i.test(domain) ||
    /^ask_(?:admission|registration|pmb|schedule)/i.test(intent) ||
    /\b(?:pmb|pendaftaran|mendaftar|syarat\s+masuk|jalur\s+masuk|gelombang|tes\s+masuk|calon\s+mahasiswa)\b/i.test(q);
  if (isAdmission) {
    return { topic: 'admission', confidence: 0.90, source: 'admission_semantics' };
  }

  // 6. Academic domain
  const isAcademic = /^(?:academic|academic_policy|program|program_curriculum|s2_postgraduate|accreditation|curriculum)$/i.test(domain) ||
    /^ask_(?:academic|curriculum|program|accreditation)/i.test(intent) ||
    /\b(?:cuti\s+akademik|cuti|krs|khs|transkrip|ijazah|wisuda|yudisium|perkuliahan|kuliah|matkul|mata\s+kuliah|sks|kurikulum|dosen|dosen\s+wali|sidang|skripsi)\b/i.test(q);
  if (isAcademic) {
    return { topic: 'academic', confidence: 0.90, source: 'academic_semantics' };
  }

  // Fallback to general
  return { topic: 'general', confidence: 0.50, source: 'unmatched_general_fallback' };
}

/**
 * Evaluates whether an escalation trigger is active.
 *
 * Triggers:
 * 1. evidence tidak ditemukan / insufficient
 * 2. evidence coverage rendah
 * 3. answer confidence di bawah threshold
 * 4. evidence conflict
 * 5. jawaban hanya dapat diberikan sebagian (partial answer)
 * 6. pertanyaan membutuhkan kepastian yang tidak didukung evidence
 * 7. pertanyaan memerlukan data personal/account/transaksi yang tidak tersedia
 * 8. semantic answerability dinilai rendah
 *
 * @param {object} params
 * @returns {{ shouldEscalate: boolean, trigger: string|null, reason: string }}
 */
function evaluateEscalationTriggers(params = {}) {
  const {
    rawQuery = '',
    frame = null,
    evaluation = null,
    answerPlan = null,
    verification = null,
    answer = '',
    contexts = [],
    confidenceScore = null,
    confidenceTier = null,
    source = ''
  } = params;

  const textAnswer = String(answer || '');
  const normConfidenceTier = String(confidenceTier || '').toUpperCase();
  const numScore = typeof confidenceScore === 'number' ? confidenceScore : null;

  // Trigger 7: Personal account / transaction request
  const personal = detectPersonalAccountRequest(rawQuery);
  if (personal.isPersonal) {
    return {
      shouldEscalate: true,
      trigger: 'personal_account_request',
      reason: 'Pertanyaan memerlukan data akun atau transaksi personal yang tidak tersedia di public RAG'
    };
  }

  // Trigger 4: Evidence conflict
  const hasConflict = (evaluation && evaluation.hasConflict) ||
    (answerPlan && (answerPlan.overallStatus === 'CONFLICTING' || answerPlan.telemetry?.conflictingBindings > 0)) ||
    /perbedaan\s+informasi\s+pada\s+dokumen\s+resmi/i.test(textAnswer);
  if (hasConflict) {
    return {
      shouldEscalate: true,
      trigger: 'evidence_conflict',
      reason: 'Terdapat pertentangan/konflik fakta antar dokumen sumber resmi'
    };
  }

  // Trigger 1 & 8: Evidence tidak ditemukan / insufficient / low answerability
  const isEvaluatorUnsupported = evaluation && evaluation.overallStatus === 'UNSUPPORTED';
  const isPlanUnsupported = answerPlan && answerPlan.overallStatus === 'UNSUPPORTED';
  const isVerifierBlocked = verification && verification.decision === 'BLOCK';
  const hasInsufficientEvidenceMarker = /insufficient_evidence|rag-no-evidence|rag-ai-error|meaning-mismatch-fallback|contract-verifier-blocked/i.test(source) ||
    /data yang Anda minta tidak tersedia|belum menemukan data yang sesuai|tidak menemukan informasi|informasi yang cukup lengkap/i.test(textAnswer);

  const hasNoContexts = (!contexts || contexts.length === 0) &&
    !/greeting|smalltalk|general_knowledge/i.test(source);

  if (isEvaluatorUnsupported || isPlanUnsupported || isVerifierBlocked || (hasNoContexts && hasInsufficientEvidenceMarker) || hasInsufficientEvidenceMarker) {
    return {
      shouldEscalate: true,
      trigger: 'insufficient_evidence',
      reason: 'Evidence tidak ditemukan atau tidak mencukupi untuk mendukung jawaban'
    };
  }

  // Trigger 5 & 2: Jawaban hanya sebagian (partial answer) / low evidence coverage
  const isPartialSupported = (evaluation && evaluation.overallStatus === 'PARTIALLY_SUPPORTED') ||
    (answerPlan && answerPlan.overallStatus === 'PARTIALLY_SUPPORTED') ||
    (answerPlan && answerPlan.telemetry?.unsupportedBindings > 0 && answerPlan.telemetry?.supportedBindings > 0) ||
    /Catatan:.*belum ditemukan|belum tercantum secara lengkap|Namun saya belum menemukan/i.test(textAnswer);

  if (isPartialSupported) {
    return {
      shouldEscalate: true,
      trigger: 'partial_answer',
      reason: 'Jawaban hanya dapat diberikan sebagian karena sebagian dimensi pertanyaan tidak didukung evidence'
    };
  }

  // Trigger 3: Answer confidence di bawah threshold
  const isLowConfidence = normConfidenceTier === 'LOW' ||
    normConfidenceTier === 'VERY_LOW' ||
    (numScore !== null && numScore < 0.60);

  if (isLowConfidence && !/greeting|smalltalk/i.test(source)) {
    return {
      shouldEscalate: true,
      trigger: 'low_confidence',
      reason: 'Skor atau tingkat keyakinan (confidence tier) di bawah batas aman penerbitan'
    };
  }

  // No triggers: authoritative evidence is sufficient
  return {
    shouldEscalate: false,
    trigger: null,
    reason: 'Jawaban didukung evidence otoritatif dengan tingkat keyakinan yang mencukupi'
  };
}

/**
 * Composes an escalated answer string according to the defined response templates.
 *
 * @param {object} params
 * @returns {string} Clean formatted prose
 */
function composeEscalatedAnswer(params = {}) {
  const {
    trigger,
    topic,
    contactOverrides = {},
    originalAnswer = '',
    rawQuery = '',
    unsupportedDetail = ''
  } = params;

  const contact = getAdminContact(topic, contactOverrides);
  const contactCta = formatContactCallToAction(contact);

  switch (trigger) {
    case 'personal_account_request': {
      return [
        'Pertanyaan Anda berkaitan dengan data akun atau transaksi personal yang memerlukan verifikasi identitas resmi.',
        `Untuk bantuan lebih lanjut, ${contactCta}`
      ].join('\n');
    }

    case 'partial_answer': {
      let base = originalAnswer.trim();
      // Remove any trailing generic "[ Hubungi Admin ]" or similar boilerplate
      base = base.replace(/\n*\[\s*Hubungi Admin\s*\]\s*$/i, '').trim();

      const missingPart = unsupportedDetail || 'detail batas waktu atau ketentuan khusus terkait hal tersebut';
      return [
        base,
        '',
        `Namun saya belum menemukan informasi resmi yang lengkap mengenai ${missingPart}.`,
        `Untuk memastikan detail tersebut, ${contactCta}`
      ].join('\n');
    }

    case 'evidence_conflict': {
      let base = originalAnswer.trim().replace(/\n*\[\s*Hubungi Admin\s*\]\s*$/i, '').trim();
      return [
        base,
        '',
        `Agar tidak keliru dan mendapatkan kepastian informasi yang sah, ${contactCta}`
      ].join('\n');
    }

    case 'insufficient_evidence':
    case 'low_confidence':
    default: {
      if (topic === 'general') {
        return [
          'Saya belum dapat memastikan informasi tersebut berdasarkan knowledge base yang tersedia.',
          `${formatContactCallToAction(contact, { prefix: 'Silakan hubungi' })}`
        ].join('\n');
      }
      return [
        'Saya belum menemukan informasi yang cukup lengkap untuk memastikan hal tersebut.',
        `Untuk informasi lebih lanjut, ${contactCta}`
      ].join('\n');
    }
  }
}

/**
 * Main Entrypoint: Admin Escalation Router Layer.
 *
 * Executes between Evidence Evaluation / Confidence Check and Final Renderer.
 *
 * @param {object} params Input turn evaluation and composition data
 * @param {object} [params.frame] EffectiveSemanticFrame
 * @param {string} [params.rawQuery] User input question
 * @param {object} [params.evaluation] Central Evidence Evaluation report
 * @param {object} [params.answerPlan] GroundedAnswerPlan
 * @param {object} [params.verification] FinalVerifier report
 * @param {string} [params.answer] Candidate answer text
 * @param {Array} [params.contexts] Retrieved chunk contexts
 * @param {number} [params.confidenceScore] Numeric score
 * @param {string} [params.confidenceTier] Confidence tier (HIGH, MEDIUM, LOW, VERY_LOW)
 * @param {string} [params.source] RAG engine route source
 * @param {object} [params.contactOverrides] Operator contact overrides for testing
 * @returns {{ escalated: boolean, answer: string, topic: string, contact: object, trigger: string|null, reason: string }}
 */
function routeAdminEscalation(params = {}) {
  const {
    rawQuery = '',
    frame = null,
    answer = '',
    contactOverrides = {}
  } = params;

  // 1. Evaluate whether escalation is triggered
  const evalResult = evaluateEscalationTriggers(params);

  // 2. Resolve topic regardless (for metadata telemetry)
  const topicResolution = resolveEscalationTopic(frame, rawQuery, params);
  const contact = getAdminContact(topicResolution.topic, contactOverrides);

  // If no escalation triggered: return original answer cleanly
  if (!evalResult.shouldEscalate) {
    return {
      escalated: false,
      answer: String(answer || ''),
      topic: topicResolution.topic,
      contact: null,
      trigger: null,
      reason: evalResult.reason
    };
  }

  // 3. Compose escalated prose
  const escalatedProse = composeEscalatedAnswer({
    trigger: evalResult.trigger,
    topic: topicResolution.topic,
    contactOverrides,
    originalAnswer: answer,
    rawQuery,
    unsupportedDetail: params.unsupportedDetail
  });

  return {
    escalated: true,
    answer: escalatedProse,
    topic: topicResolution.topic,
    contact,
    trigger: evalResult.trigger,
    reason: evalResult.reason
  };
}

module.exports = {
  detectPersonalAccountRequest,
  resolveEscalationTopic,
  evaluateEscalationTriggers,
  composeEscalatedAnswer,
  routeAdminEscalation
};
