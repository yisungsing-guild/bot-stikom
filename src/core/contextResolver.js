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
  'makinnya', 'makin'
]);

// Genuine ellipsis starts (e.g. "bagaimana dengan...", "kalau yang...", "what about...", "how about...")
const GENUINE_ELLIPSIS_REGEX = /^(kalau|bagaimana\s+dengan|gimana\s+dengan|lalu|kalo|what\s+about|how\s+about|and)\s+(the\s+|yang\s+)?([a-z0-9\s]+)\??$/i;
const PREDICATE_ELLIPSIS_REGEX = /^(?:bagaimana\s+cara\s+bergabung|gimana\s+cara\s+bergabung|cara\s+bergabungnya(?:\s+gimana)?|cara\s+bergabung|masih\s+bisa\s+daftar|bisa\s+daftar\s+sekarang|kapan\s+jadwalnya|kapan\s+batasnya|kapan\s+buka|syaratnya\s+apa|biayanya\s+berapa|cara\s+daftarnya\s+gimana)\??$/i;

function hasExplicitPronounReference(query) {
  if (!query || typeof query !== 'string') return false;
  const q = query.trim().toLowerCase();

  // 1. Explicit standalone pronouns & demonstratives (Indonesian & English)
  if (/\b(?:itu|tersebut|tadi|yang\s+itu|dengannya|nya|the\s+program|the\s+major|the\s+degree|it|that|this)\b/i.test(q)) {
    return true;
  }

  // 2. Bound anaphoric enclitic -nya on nouns (e.g. biayanya, syaratnya, kurikulumnya, studinya, akreditasinya)
  // Must distinguish from non-referential discourse adverbs and modals (e.g. sebenarnya, harusnya, biasanya)
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
 * Returns { shouldInherit: boolean, reason: string }
 */
function evaluateContextDependency(currentQuery, sessionData = {}) {
  if (!currentQuery) {
    return { shouldInherit: false, reason: 'empty_query' };
  }

  const query = currentQuery.trim().toLowerCase();

  // If session has no prior state, cannot inherit
  if (!sessionData || (!sessionData.activeDomain && !sessionData.activeEntity && !sessionData.lastQuery)) {
    return { shouldInherit: false, reason: 'no_session_history' };
  }

  const isAcademicActiveEntity = sessionData.activeEntity && (
    sessionData.activeEntity.family === 'academic_program' ||
    sessionData.activeEntity.family === 'international_program' ||
    sessionData.activeEntity.type === 'program' ||
    sessionData.activeEntity.type === 'international_program' ||
    (typeof sessionData.activeEntity === 'string' &&
     !['Wisuda', 'Yudisium'].includes(sessionData.activeEntity) &&
     !sessionData.activeDomain?.startsWith('ORGANIZATION'))
  );

  // Guard: Campus-wide service domain inquiries must not inherit academic program entities
  // Covers: FACILITIES, ORGANIZATION_UKM, SCHOLARSHIP, CAMPUS_SERVICE, CAREER_CENTER
  const isCampusWideQuery =
    (/\b(?:ukm\b|unit\s+kegiatan\s+mahasiswa|organisasi(?:\s+mahasiswa)?|ormawa|ekskul|ekstrakurikuler|student\s+clubs?|student\s+organizations?)\b/i.test(query) &&
     !/\b(?:hima\b|himaprodi|himpunan)\b/i.test(query)) ||
    /\b(?:fasilitas|laboratorium|lab\b|perpustakaan|asrama|gedung|kantin|parkir|parking|lapangan)\b/i.test(query) ||
    /\b(?:beasiswa|kip\s*kuliah|kip-?k|bantuan\s+dana|keringanan\s+biaya)\b/i.test(query) ||
    /\b(?:inkubator|inbis|career\s+center|cdc\b|layanan\s+kampus|bimbingan\s+karir)\b/i.test(query);

  if (isCampusWideQuery && isAcademicActiveEntity) {
    return {
      shouldInherit: false,
      reason: 'campus_wide_domain_isolation'
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
      reason: 'cross_domain_isolation'
    };
  }

  // Check 1: Genuine Ellipsis
  if (isGenuineEllipsis(query)) {
    return {
      shouldInherit: true,
      reason: 'genuine_ellipsis',
      inheritedDomain: sessionData.activeDomain,
      inheritedEntity: sessionData.activeEntity
    };
  }

  // Check 2: Explicit Pronoun/Reference (includes enclitic -nya like "studinya" and "the program")
  if (hasExplicitPronounReference(query)) {
    return {
      shouldInherit: true,
      reason: 'pronoun_reference',
      inheritedDomain: sessionData.activeDomain,
      inheritedEntity: sessionData.activeEntity
    };
  }

  // Check 3: Attribute or Procedural Continuation without explicit entity
  const isAttributeInquiry = /\b(gelar(?:\s+apa)?|masa\s+studi|durasi\s+studi|lama\s+studi|prospek\s+lulusan|rincian\s+biaya|biaya(?:\s+kuliah)?|spp|dpp|kontak(?:nya)?|nomor(?:\s+telepon|\s+wa|\s+whatsapp|\s+hp)?(?:nya)?|telepon(?:nya)?|whatsapp(?:nya)?|wa(?:nya)?|narahubung(?:nya)?|hubungi|degree(?:s)?(?:\s+awarded|\s+received)?|qualification(?:s)?|study\s+duration|study\s+length|duration(?:\s+of\s+study)?|how\s+long\b|graduate(?:s)?|graduation|contact(?:s)?)\b/i.test(query);
  const isProceduralInquiry = /\b(?:bagaimana\s+cara\s+(?:daftar|mendaftar)|cara\s+(?:daftar|mendaftar|pendaftaran)|alur\s+pendaftaran|prosedur\s+pendaftaran|syarat(?:\s+pendaftaran|\s+masuk|\s+daftar)?|persyaratan(?:\s+pendaftaran|\s+masuk|\s+daftar)?|berkas|dokumen(?:\s+persyaratan)?|kapan\s+pendaftaran|jadwal\s+pendaftaran|tahapan\s+pendaftaran|how\s+to\s+apply|how\s+to\s+register|admission\s+procedure|registration\s+procedure|admission\s+requirements)\b/i.test(query);

  if ((isAttributeInquiry || isProceduralInquiry) && sessionData.activeEntity) {
    const isFee = /\b(rincian\s+biaya|biaya|spp|dpp)\b/i.test(query);
    const isContact = /\b(kontak|nomor|telepon|wa|whatsapp|narahubung|hubungi|contact)\b/i.test(query);
    const isAdmission = isProceduralInquiry || /\b(daftar|pendaftaran|syarat|persyaratan|berkas|dokumen)\b/i.test(query);

    let inheritedDomain = sessionData.activeDomain || 'ACADEMIC_PROGRAM';
    if (isFee) inheritedDomain = 'TUITION_FEE';
    else if (isContact) inheritedDomain = 'CAMPUS_SERVICE';
    else if (isAdmission && inheritedDomain !== 'INTERNATIONAL') inheritedDomain = 'PMB';

    return {
      shouldInherit: true,
      reason: isAttributeInquiry ? 'attribute_continuation' : 'procedural_continuation',
      inheritedDomain,
      inheritedEntity: sessionData.activeEntity
    };
  }

  // DEFAULT: Current turn is independent and authoritative!
  return {
    shouldInherit: false,
    reason: 'independent_current_turn'
  };
}

module.exports = {
  hasExplicitPronounReference,
  isGenuineEllipsis,
  evaluateContextDependency
};
