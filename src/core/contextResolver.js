'use strict';

/**
 * src/core/contextResolver.js
 * 
 * Greenfield Context Policy Layer.
 * Invariant: CURRENT TURN IS AUTHORITATIVE.
 * 
 * Rules:
 * History is ONLY consulted if:
 * 1. An explicit pronoun/demonstrative reference is present:
 *    - "itu", "tersebut", "tadi", "yang itu", "bagaimana dengannya"
 * 2. A genuine ellipsis is detected:
 *    - "Bagaimana dengan DNUI?"
 *    - "Kalau yang S1?"
 *    - "Yang internasional bagaimana?"
 * 
 * FORBIDDEN:
 * - Word count <= N
 * - The presence of common academic tokens like "kuliah", "daftar", "biaya", "jadwal"
 *   These MUST NEVER trigger context inheritance on their own.
 */

const { CONTEXT_DECISION } = require('../reasoning/contracts');

// Non-referential discourse adverbs and modals ending in -nya that do NOT reference a prior entity
const NON_REFERENTIAL_NYA_WORDS = new Set([
  'sebenarnya', 'sebenar',
  'harusnya', 'harus',
  'biasanya', 'biasa',
  'umumnya', 'umum',
  'khususnya', 'khusus',
  'sebaiknya', 'sebaik',
  'tampaknya', 'tampak',
  'rupanya', 'rupa',
  'agaknya', 'agak',
  'makanya',
  'pokoknya', 'pokok',
  'nyatanya', 'nyata',
  'artinya', 'arti',
  'misalnya', 'misal',
  'contohnya', 'contoh',
  'akhirnya', 'akhir',
  'awalnya', 'awal',
  'seterusnya', 'seterus',
  'selanjutnya', 'selanjut',
  'sebelumnya', 'sebelum',
  'sesudahnya', 'sesudah',
  'pastinya', 'pasti',
  'tentunya', 'tentu',
  'cocoknya', 'cocok',
  'pasnya', 'pas',
  'kurangnya', 'kurang',
  'makinnya', 'makin',
  'olahraganya', 'olahraga'
]);

// Genuine ellipsis starts (e.g. "bagaimana dengan...", "kalau yang...", "what about...", "how about...")
const GENUINE_ELLIPSIS_REGEX = /^(kalau|bagaimana\s+dengan|gimana\s+dengan|lalu|kalo|what\s+about|how\s+about|and)\s+(the\s+|yang\s+)?([a-z0-9\s]+)\??$/i;
const PREDICATE_ELLIPSIS_REGEX = /^(?:bagaimana\s+cara\s+bergabung|gimana\s+cara\s+bergabung|cara\s+bergabungnya(?:\s+gimana)?|cara\s+bergabung|masih\s+bisa\s+daftar|bisa\s+daftar\s+sekarang|kapan\s+jadwalnya|kapan\s+batasnya|kapan\s+buka|syaratnya\s+apa|biayanya\s+berapa|cara\s+daftarnya\s+gimana)\??$/i;
const EXISTENCE_ELLIPSIS_REGEX = /^(?:apakah\s+)?(?:tidak\s+ada|ada)\s+(?:yang\s+)?([a-z0-9\s]+)\??$/i;

function hasExplicitPronounReference(query) {
  if (!query || typeof query !== 'string') return false;
  const q = query.trim().toLowerCase();

  // 1. Explicit standalone pronouns & demonstratives (Indonesian & English)
  if (/\b(?:itu|tersebut|tadi|yang\s+itu|dengannya|nya|the\s+program|the\s+major|the\s+degree|it|that|this)\b/i.test(q)) {
    return true;
  }

  // 2. Bound anaphoric enclitic -nya on nouns (e.g. biayanya, syaratnya, kurikulumnya, studinya, akreditasinya)
  // Must distinguish from non-referential discourse adverbs and modals (e.g. sebenarnya, harusnya, biasanya, olahraganya)
  const matches = q.match(/\b([a-z]{3,})nya\b/gi);
  if (matches) {
    for (const match of matches) {
      const lower = match.toLowerCase();
      if (!NON_REFERENTIAL_NYA_WORDS.has(lower)) {
        return true;
      }
    }
  }

  return false;
}

function isGenuineEllipsis(query) {
  if (!query) return false;
  const trimmed = query.trim().toLowerCase();
  if (PREDICATE_ELLIPSIS_REGEX.test(trimmed)) return true;
  const existMatch = trimmed.match(EXISTENCE_ELLIPSIS_REGEX);
  if (existMatch) {
    const remnant = (existMatch[1] || '').trim();
    const words = remnant.split(/\s+/).filter(Boolean);
    if (words.length <= 4 && !/\b(?:kuliah|kampus|stikom|beasiswa|jurusan|prodi|daftar)\b/i.test(remnant)) {
      return true;
    }
  }
  const match = trimmed.match(GENUINE_ELLIPSIS_REGEX);
  if (match) {
    const remnant = (match[3] || '').trim();
    // A genuine ellipsis is a short noun phrase (<= 4 words) without full clausal verbs/subjects
    const words = remnant.split(/\s+/).filter(Boolean);
    if (words.length > 4) return false;
    if (/\b(?:saya|aku|kami|kita|suka|minat|cocok(?:nya)?|masuk|daftar)\b/i.test(remnant)) {
      return false;
    }
    return true;
  }
  return false;
}

/**
 * Determines whether the current query should inherit context from prior session turns.
 * Returns { shouldInherit: boolean, reason: string, decision: string, inheritedDomain, inheritedEntity, scopeModifier }
 */
function evaluateContextDependency(currentQuery, sessionData = {}) {
  if (!currentQuery) {
    return { shouldInherit: false, reason: 'empty_query', decision: CONTEXT_DECISION.TOPIC_SHIFT };
  }

  const query = currentQuery.trim().toLowerCase();

  // If session has no prior state, cannot inherit
  if (!sessionData || (!sessionData.activeDomain && !sessionData.activeEntity && !sessionData.lastQuery)) {
    return { shouldInherit: false, reason: 'no_session_history', decision: CONTEXT_DECISION.TOPIC_SHIFT };
  }

  // Guard 0.1: Underspecified single-word question without predicate (e.g. "Berapa?", "Kapan?")
  const isSingleWordAmbiguous = /^(?:berapa|kapan|apakah|ada|dimana|bagaimana)\??$/i.test(query);
  if (isSingleWordAmbiguous) {
    return {
      shouldInherit: false,
      reason: 'ambiguous_query',
      decision: CONTEXT_DECISION.AMBIGUOUS_FOLLOW_UP
    };
  }

  // Guard 0.2: Independent PMB / Enrollment wave status inquiry (e.g. "sekarang buka gelombang berapa")
  // without an explicit program pronoun reference is an independent institutional PMB inquiry (TOPIC_SHIFT).
  const isIndependentPmbWaveQuery = /\b(?:gelombang|buka\s+gelombang|gelombang\s+berapa|jadwal\s+pmb|periode\s+pmb|masih\s+dibuka|kapan\s+buka|kapan\s+tutup)\b/i.test(query) &&
    !/\b(?:nya|program\s+ini|jurusan\s+ini)\b/i.test(query);
  if (isIndependentPmbWaveQuery) {
    return {
      shouldInherit: false,
      reason: 'independent_pmb_inquiry',
      decision: CONTEXT_DECISION.TOPIC_SHIFT
    };
  }

  // Guard 0.3: Specific disambiguation for generic schedule follow-up ("Jadwalnya kapan?")
  const isGenericScheduleQuery = /^(?:kapan\s+jadwalnya|jadwalnya\s+kapan|kapan\s+jadwal|jadwalnya)\??$/i.test(query);
  if (isGenericScheduleQuery) {
    if (sessionData.activeDomain === 'PMB' || sessionData.activeIntent === 'ADMISSION_SCHEDULE') {
      return {
        shouldInherit: true,
        reason: 'admission_schedule_continuation',
        decision: CONTEXT_DECISION.BOUND_CONTINUATION,
        inheritedDomain: 'PMB',
        inheritedIntent: 'ADMISSION_SCHEDULE',
        inheritedEntity: sessionData.activeEntity || null
      };
    }
    if (sessionData.activeDomain === 'TUITION_FEE') {
      // In tuition fee context, "jadwalnya kapan?" is ambiguous between payment schedule, lecture schedule, or pmb schedule
      return {
        shouldInherit: false,
        reason: 'ambiguous_schedule_followup',
        decision: CONTEXT_DECISION.AMBIGUOUS_FOLLOW_UP
      };
    }
  }

  const isAcademicActiveEntity = sessionData.activeEntity && (
    sessionData.activeEntity.family === 'academic_program' ||
    sessionData.activeEntity.type === 'program' ||
    (typeof sessionData.activeEntity === 'string' &&
     !['Wisuda', 'Yudisium'].includes(sessionData.activeEntity) &&
     !sessionData.activeDomain?.startsWith('ORGANIZATION'))
  );

  // Guard 1: Campus-wide service domain inquiries must not inherit academic program entities
  // Covers: FACILITIES, ORGANIZATION_UKM, SCHOLARSHIP, CAMPUS_SERVICE, CAREER_CENTER
  const isCampusWideQuery =
    (/\b(?:ukm\b|unit\s+kegiatan\s+mahasiswa|organisasi(?:\s+mahasiswa)?|ormawa|ekskul|ekstrakurikuler|student\s+clubs?|student\s+organizations?)\b/i.test(query) &&
     !/\b(?:hima\b|himaprodi|himpunan)\b/i.test(query)) ||
    /\b(?:fasilitas|laboratorium|lab\b|perpustakaan|asrama|gedung|kantin|parkir|parking|lapangan)\b/i.test(query) ||
    /\b(?:beasiswa|kip\s*kuliah|kip-?k|bantuan\s+dana|keringanan\s+biaya)\b/i.test(query) ||
    /\b(?:inkubator|inbis|career\s+center|cdc\b|layanan\s+kampus|bimbingan\s+karir|perwalian|dosen\s+wali|konsultasi\s+akademik|bimbingan\s+akademik)\b/i.test(query);

  if (isCampusWideQuery && isAcademicActiveEntity) {
    return {
      shouldInherit: false,
      reason: 'campus_wide_domain_isolation',
      decision: CONTEXT_DECISION.TOPIC_SHIFT
    };
  }

  // Cross-domain isolation from non-academic session (UKM / facility / scholarship) to academic fee / program inquiry
  const isAcademicProgramOrFeeQuery = /\b(?:biaya(?:\s+kuliah)?|spp|sks|kurikulum|matkul|prodi|jurusan|pmb|pendaftaran\s+mahasiswa)\b/i.test(query) &&
    !/\b(?:biaya\s+parkir|sewa\s+gedung)\b/i.test(query);
  const isNonAcademicSession = sessionData.activeDomain && (
    sessionData.activeDomain.startsWith('ORGANIZATION') ||
    sessionData.activeDomain === 'FACILITIES' ||
    sessionData.activeDomain === 'CAMPUS_SERVICE' ||
    sessionData.activeEntity?.family === 'student_organization' ||
    sessionData.activeEntity?.family === 'campus_service' ||
    sessionData.activeEntity?.family === 'facility'
  );

  if (isAcademicProgramOrFeeQuery && isNonAcademicSession && !query.includes('tari') && !query.includes('ukm')) {
    return {
      shouldInherit: false,
      reason: 'cross_domain_isolation',
      decision: CONTEXT_DECISION.TOPIC_SHIFT
    };
  }

  // Check 1: Genuine Ellipsis with Scope Modification (e.g. Double Degree -> "Ada yang nasional?")
  const isNationalScopeEllipsis = /\b(?:nasional|dalam\s+negeri|lokal|domestik)\b/i.test(query);
  const isPriorDoubleDegree = sessionData.activeEntity === 'Double Degree' ||
    (typeof sessionData.lastQuery === 'string' && /\b(?:double|dual)\s*degree\b/i.test(sessionData.lastQuery)) ||
    sessionData.activeDomain === 'INTERNATIONAL';

  if (isGenuineEllipsis(query)) {
    if (isNationalScopeEllipsis && isPriorDoubleDegree) {
      return {
        shouldInherit: true,
        reason: 'scope_modification_national',
        decision: CONTEXT_DECISION.ENTITY_SCOPE_MODIFICATION,
        inheritedDomain: 'ACADEMIC_PROGRAM',
        inheritedEntity: 'Double Degree',
        scopeModifier: 'national'
      };
    }
    return {
      shouldInherit: true,
      reason: 'genuine_ellipsis',
      decision: CONTEXT_DECISION.BOUND_CONTINUATION,
      inheritedDomain: sessionData.activeDomain,
      inheritedEntity: sessionData.activeEntity
    };
  }

  // Check 2: Explicit Pronoun/Reference (includes enclitic -nya like "studinya" and "the program")
  if (hasExplicitPronounReference(query)) {
    return {
      shouldInherit: true,
      reason: 'pronoun_reference',
      decision: CONTEXT_DECISION.BOUND_CONTINUATION,
      inheritedDomain: sessionData.activeDomain,
      inheritedEntity: sessionData.activeEntity
    };
  }

  // Check 3: Attribute Continuation without explicit entity
  const isAttributeInquiry = /\b(gelar(?:\s+apa)?|masa\s+studi|durasi\s+studi|lama\s+studi|prospek\s+lulusan|degree(?:s)?(?:\s+awarded|\s+received)?|qualification(?:s)?|study\s+duration|study\s+length|duration(?:\s+of\s+study)?|how\s+long\b|graduate(?:s)?|graduation)\b/i.test(query);
  if (isAttributeInquiry && sessionData.activeEntity) {
    return {
      shouldInherit: true,
      reason: 'attribute_continuation',
      decision: CONTEXT_DECISION.BOUND_CONTINUATION,
      inheritedDomain: sessionData.activeDomain || 'ACADEMIC_PROGRAM',
      inheritedEntity: sessionData.activeEntity
    };
  }

  // DEFAULT: Current turn is independent and authoritative!
  return {
    shouldInherit: false,
    reason: 'independent_current_turn',
    decision: CONTEXT_DECISION.TOPIC_SHIFT
  };
}

module.exports = {
  hasExplicitPronounReference,
  isGenuineEllipsis,
  evaluateContextDependency,
  CONTEXT_DECISION
};
