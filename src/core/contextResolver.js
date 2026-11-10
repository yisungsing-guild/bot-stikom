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

const { matchCanonicalEntities, findCanonicalEntity, CANONICAL_ENTITIES } = require('../engine/canonicalEntityRegistry');

/**
 * Extracts ordered canonical entities from sessionData (activeEntities, candidateEntities, or lastQuery/lastAnswer)
 * to support ordinal references ("yang pertama", "yang kedua", "yang terakhir", "keduanya").
 */
function extractOrderedSessionEntities(sessionData = {}) {
  if (!sessionData || typeof sessionData !== 'object') return [];
  const seen = new Set();
  const ordered = [];

  const addEntity = (ent) => {
    if (!ent) return;
    const rawName = typeof ent === 'object' ? (ent.canonical || ent.name || '') : String(ent);
    const found = findCanonicalEntity(rawName);
    const canon = found ? found.canonical : rawName.trim();
    if (!canon) return;
    const key = canon.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      ordered.push(canon);
    }
  };

  if (Array.isArray(sessionData.activeEntities)) {
    sessionData.activeEntities.forEach(addEntity);
  }
  if (Array.isArray(sessionData.candidateEntities)) {
    sessionData.candidateEntities.forEach(addEntity);
  }
  if (ordered.length >= 2) return ordered;

  const sources = [];
  if (sessionData.lastQuery) sources.push(String(sessionData.lastQuery));
  if (sessionData.lastAnswer) sources.push(String(sessionData.lastAnswer));
  if (Array.isArray(sessionData.conversationHistory)) {
    const recent = sessionData.conversationHistory.slice(-2);
    for (const turn of recent) {
      if (turn?.user) sources.push(String(turn.user));
      if (turn?.bot) sources.push(String(turn.bot));
      if (turn?.content) sources.push(String(turn.content));
    }
  }

  for (const text of sources) {
    const lower = text.toLowerCase();
    const matchesWithPos = [];
    const matched = matchCanonicalEntities(text) || [];
    for (const m of matched) {
      if (!m || !m.canonical) continue;
      if (!['academic_program', 'international_program', 'campus_location', 'student_organization', 'campus_service'].includes(m.family)) {
        continue;
      }
      const alias = (m.matchedAlias || m.canonical).toLowerCase();
      const idx = lower.indexOf(alias);
      matchesWithPos.push({ canonical: m.canonical, pos: idx >= 0 ? idx : 999999 });
    }
    matchesWithPos.sort((a, b) => a.pos - b.pos);
    for (const item of matchesWithPos) {
      addEntity(item.canonical);
    }
  }

  if (ordered.length === 0 && sessionData.activeEntity) {
    addEntity(sessionData.activeEntity);
  }
  return ordered;
}

/**
 * Resolves ordinal references ("yang pertama", "yang kedua", "yang ketiga", "yang terakhir", "keduanya")
 * against the ordered entities active in the session.
 */
function hasOrdinalReferenceMarker(rawQuery) {
  if (!rawQuery || typeof rawQuery !== 'string') return false;
  const q = rawQuery.trim().toLowerCase();
  return /\b(?:keduanya|dua-?duanya|kedua\s+(?:prodi|jurusan|program)(?:\s+itu|\s+tersebut)?|semuanya)\b/i.test(q) ||
    /\b(?:yang\s+(?:pertama|ke-?1|kesatu|awal)|(?:prodi|jurusan|program|pilihan|opsi)\s+(?:yang\s+)?(?:pertama|ke-?1|kesatu))\b/i.test(q) ||
    /\b(?:yang\s+(?:kedua|ke-?2)|(?:prodi|jurusan|program|pilihan|opsi)\s+(?:yang\s+)?(?:kedua|ke-?2))\b/i.test(q) ||
    /\b(?:yang\s+(?:ketiga|ke-?3)|(?:prodi|jurusan|program|pilihan|opsi)\s+(?:yang\s+)?(?:ketiga|ke-?3))\b/i.test(q) ||
    /\b(?:yang\s+(?:terakhir|paling\s+akhir)|(?:prodi|jurusan|program|pilihan|opsi)\s+(?:yang\s+)?terakhir)\b/i.test(q) ||
    (/\b(?:(?:program|prodi|jurusan|pilihan|opsi)\s+)?(?:satu(?:nya)?(?:\s+lagi)?|yang\s+satu(?:nya)?(?:\s+lagi)?|lain(?:nya)?)\b/i.test(q) &&
      /\b(?:kalau|kalo|bagaimana|gimana|sedangkan|untuk|lalu|terus|dan)\b/i.test(q));
}

function resolveOrdinalReference(rawQuery, sessionData = {}) {
  if (!rawQuery || typeof rawQuery !== 'string') return null;
  const q = rawQuery.trim().toLowerCase();

  const isBoth = /\b(?:keduanya|dua-?duanya|kedua\s+(?:prodi|jurusan|program)(?:\s+itu|\s+tersebut)?|semuanya)\b/i.test(q);
  const isFirst = /\b(?:yang\s+(?:pertama|ke-?1|kesatu|awal)|(?:prodi|jurusan|program|pilihan|opsi)\s+(?:yang\s+)?(?:pertama|ke-?1|kesatu))\b/i.test(q);
  const isSecond = /\b(?:yang\s+(?:kedua|ke-?2)|(?:prodi|jurusan|program|pilihan|opsi)\s+(?:yang\s+)?(?:kedua|ke-?2))\b/i.test(q);
  const isThird = /\b(?:yang\s+(?:ketiga|ke-?3)|(?:prodi|jurusan|program|pilihan|opsi)\s+(?:yang\s+)?(?:ketiga|ke-?3))\b/i.test(q);
  const isLast = /\b(?:yang\s+(?:terakhir|paling\s+akhir)|(?:prodi|jurusan|program|pilihan|opsi)\s+(?:yang\s+)?terakhir)\b/i.test(q);
  const isOther = /\b(?:(?:program|prodi|jurusan|pilihan|opsi)\s+)?(?:satu(?:nya)?(?:\s+lagi)?|yang\s+satu(?:nya)?(?:\s+lagi)?|lain(?:nya)?)\b/i.test(q) &&
    /\b(?:kalau|kalo|bagaimana|gimana|sedangkan|untuk|lalu|terus|dan)\b/i.test(q);

  if (!isBoth && !isFirst && !isSecond && !isThird && !isLast && !isOther) return null;

  const ordered = extractOrderedSessionEntities(sessionData);
  if (ordered.length === 0) return null;

  if (isBoth) {
    return {
      ordinalType: 'BOTH',
      resolvedEntities: ordered.slice(0, 2),
      primaryEntity: ordered[0]
    };
  }
  if (isFirst) {
    return {
      ordinalType: 'FIRST',
      resolvedEntities: [ordered[0]],
      primaryEntity: ordered[0]
    };
  }
  if (isSecond && ordered.length >= 2) {
    return {
      ordinalType: 'SECOND',
      resolvedEntities: [ordered[1]],
      primaryEntity: ordered[1]
    };
  }
  if (isThird && ordered.length >= 3) {
    return {
      ordinalType: 'THIRD',
      resolvedEntities: [ordered[2]],
      primaryEntity: ordered[2]
    };
  }
  if (isLast) {
    const lastEnt = ordered[ordered.length - 1];
    return {
      ordinalType: 'LAST',
      resolvedEntities: [lastEnt],
      primaryEntity: lastEnt
    };
  }
  if (isOther && ordered.length >= 2) {
    const activeCanon = sessionData.activeEntity ? (findCanonicalEntity(sessionData.activeEntity)?.canonical || String(sessionData.activeEntity)) : null;
    const targetEntity = (activeCanon && activeCanon.toLowerCase() === ordered[0].toLowerCase())
      ? ordered[1]
      : (activeCanon && activeCanon.toLowerCase() === ordered[1].toLowerCase() ? ordered[0] : ordered[1]);
    return {
      ordinalType: 'OTHER',
      resolvedEntities: [targetEntity],
      primaryEntity: targetEntity
    };
  }
  return null;
}

/**
 * Resolves partial program mentions (e.g. "Teknologi masuk fakultas apa?", "Kalau Sistem bagaimana?")
 * against the active entity or candidate entities in session.
 */
function resolvePartialEntityInContext(rawQuery, sessionData = {}) {
  if (!rawQuery || typeof rawQuery !== 'string') return null;
  const q = rawQuery.trim().toLowerCase();

  // Only trigger if no full canonical academic/international program entity was matched directly
  const directMatches = (matchCanonicalEntities(q) || []).filter(m =>
    m.family === 'academic_program' || m.family === 'international_program'
  );
  if (directMatches.length > 0) return null;

  const hasPartialTeknologi = /\bteknologi\b/i.test(q) && !/\b(?:teknologi\s+informasi|universitas\s+teknologi\s+bandung|institut\s+teknologi)\b/i.test(q);
  const hasPartialSistem = /\bsistem\b/i.test(q) && !/\b(?:sistem\s+informasi|sistem\s+komputer|sistem\s+informasi\s+online)\b/i.test(q);

  if (!hasPartialTeknologi && !hasPartialSistem) return null;

  const ordered = extractOrderedSessionEntities(sessionData);
  const activeStr = typeof sessionData.activeEntity === 'object'
    ? (sessionData.activeEntity?.canonical || '')
    : String(sessionData.activeEntity || '');

  if (hasPartialTeknologi) {
    const matchingOrdered = ordered.filter(e => /\bteknologi\b/i.test(e) || /utb/i.test(e));
    if (matchingOrdered.length > 1) {
      return { isAmbiguous: true, candidateEntities: matchingOrdered, partialToken: 'teknologi' };
    }
    if (/\bteknologi\s+informasi\b/i.test(activeStr)) {
      return { isAmbiguous: false, resolvedEntity: 'S1 Teknologi Informasi', partialToken: 'teknologi' };
    }
    if (matchingOrdered.length === 1) {
      return { isAmbiguous: false, resolvedEntity: matchingOrdered[0], partialToken: 'teknologi' };
    }
    return {
      isAmbiguous: true,
      candidateEntities: ['S1 Teknologi Informasi', 'Dual Degree UTB'],
      partialToken: 'teknologi'
    };
  }

  if (hasPartialSistem) {
    const matchingOrdered = ordered.filter(e => /\bsistem\b/i.test(e));
    if (matchingOrdered.length > 1) {
      return { isAmbiguous: true, candidateEntities: matchingOrdered, partialToken: 'sistem' };
    }
    if (/\bsistem\s+(?:informasi|komputer)\b/i.test(activeStr)) {
      return { isAmbiguous: false, resolvedEntity: activeStr, partialToken: 'sistem' };
    }
    if (matchingOrdered.length === 1) {
      return { isAmbiguous: false, resolvedEntity: matchingOrdered[0], partialToken: 'sistem' };
    }
    return {
      isAmbiguous: true,
      candidateEntities: ['S1 Sistem Informasi', 'S1 Sistem Komputer', 'S2 Sistem Informasi'],
      partialToken: 'sistem'
    };
  }

  return null;
}

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
const GENUINE_ELLIPSIS_REGEX = /^(kalau|kalo|bagaimana\s+(?:dengan|kalau|kalo)|gimana\s+(?:dengan|kalau|kalo)|terus(?:\s+kalau|\s+kalo)?|lalu(?:\s+kalau|\s+kalo)?|sedangkan(?:\s+untuk|\s+kalau)?|untuk|what\s+about|how\s+about|and(?:\s+for)?)\s+(the\s+|yang\s+|untuk\s+|prodi\s+|jurusan\s+|program\s+|kampus\s+)?([a-z0-9\s().-]+)\??$/i;
const PREDICATE_ELLIPSIS_REGEX = /^(?:bagaimana\s+cara\s+bergabung|gimana\s+cara\s+bergabung|cara\s+bergabungnya(?:\s+gimana)?|cara\s+bergabung|masih\s+bisa\s+daftar|bisa\s+daftar\s+sekarang|kapan\s+jadwalnya|kapan\s+batasnya|kapan\s+buka|syaratnya\s+apa|biayanya\s+berapa|cara\s+daftarnya\s+gimana|tanggal\s+berapa(?:\s+ya)?|kapan\s+tanggalnya(?:\s+ya)?|untuk\s+biaya\s+berapa(?:\s+ya)?|biaya\s+berapa(?:\s+ya)?|masuk\s+fakultas\s+apa(?:\s+ya)?|fakultasnya\s+apa(?:\s+ya)?|akreditasinya\s+apa(?:\s+ya)?|berapa\s+sks(?:-?nya)?(?:\s+ya)?)\??$/i;

function hasExplicitPronounReference(query) {
  if (!query || typeof query !== 'string') return false;
  const q = query.trim().toLowerCase();

  // If "itu" is used as a topicalizer after an explicit noun/program phrase (e.g., "kalau double degree dengan utb itu...", "kalau prodi x itu..."),
  // it is not an anaphoric pronoun referring to a prior turn entity.
  const hasTopicalizedSubjectBeforeItu = /\b(?:kalau|kalo|tentang|mengenai)\s+([a-z0-9\s]{3,})\s+itu\b/i.test(q);
  if (hasTopicalizedSubjectBeforeItu) {
    return false;
  }

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
    const remnant = (match[3] || '').replace(/\b(?:bagaimana|gimana|gmn|berapa|apa|ya|kak|dong|nih|sih)\b/gi, '').trim();
    // A genuine ellipsis is a short noun phrase (<= 5 words) without full clausal verbs/subjects
    const words = remnant.split(/\s+/).filter(Boolean);
    if (words.length === 0 || words.length > 5) return false;
    if (/\b(?:saya|aku|kami|kita|suka|minat|cocok(?:nya)?|masuk|daftar)\b/i.test(remnant)) {
      return false;
    }
    // If the remnant is asking whether a new program/major exists (e.g. "teknik nuklir ada gak", "hukum ada tidak"),
    // it is a topic switch / new inquiry, not an ellipsis continuing the prior entity.
    if (/\b(?:ada|tersedia|buka)\s*(?:gak|ga|nggak|tidak|kah)?\b/i.test(remnant) || /\b(?:ada\s+nggak|ada\s+tidak)\b/i.test(remnant)) {
      return false;
    }
    return true;
  }
  return false;
}

function isValidPendingClarification(pending, currentTime = Date.now()) {
  if (!pending || typeof pending !== 'object' || Array.isArray(pending)) return false;
  if (pending.status !== 'PENDING') return false;
  if (!pending.originalDomain || typeof pending.originalDomain !== 'string' || !pending.originalDomain.trim()) return false;
  if (!pending.originalIntent || typeof pending.originalIntent !== 'string' || !pending.originalIntent.trim()) return false;
  if (!pending.requiredSlot || typeof pending.requiredSlot !== 'string' || !pending.requiredSlot.trim()) return false;
  const createdAt = Number(pending.createdAt);
  if (!Number.isFinite(createdAt) || createdAt <= 0) return false;
  const now = Number(currentTime) || Date.now();
  if (createdAt > now) return false;
  const ttlMs = 24 * 60 * 60 * 1000;
  if ((now - createdAt) >= ttlMs) return false;
  return true;
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

  // 0. Explicit Topic / Context Reset Marker (e.g., "Lupakan pertanyaan tadi", "Lupakan konteks sebelumnya", "Ganti topik")
  const hasExplicitContextReset = /\b(?:lupakan(?:\s+(?:pertanyaan|konteks|topik))?(?:\s+yang)?\s+(?:tadi|sebelumnya)|abaikan(?:\s+(?:pertanyaan|konteks|topik))?(?:\s+yang)?\s+(?:tadi|sebelumnya)|ganti\s+topik|mulai\s+dari\s+awal|pertanyaan\s+baru)\b/i.test(query);
  if (hasExplicitContextReset) {
    return {
      shouldInherit: false,
      explicitReset: true,
      reason: 'explicit_context_reset'
    };
  }

  // If session has no prior state, cannot inherit
  if (!sessionData || (!sessionData.activeDomain && !sessionData.activeEntity && !sessionData.preservedBackgroundEntity && !sessionData.lastAcademicProgramEntity && !sessionData.lastQuery && !sessionData.pendingClarification)) {
    if (hasOrdinalReferenceMarker(currentQuery)) {
      return {
        shouldInherit: false,
        isAmbiguous: true,
        reason: 'unresolved_ordinal_reference'
      };
    }
    return { shouldInherit: false, reason: 'no_session_history' };
  }

  // Topic switch guard: If current query asks about an unsupported program or explicitly introduces a different subject, do not inherit prior entity
  try {
    const { detectUnsupportedProgram } = require('./semanticFrameResolver');
    const unsupportedProg = detectUnsupportedProgram(query, matchCanonicalEntities(query));
    if (unsupportedProg) {
      return {
        shouldInherit: false,
        reason: 'unsupported_program_topic_switch',
        unsupportedProgram: unsupportedProg
      };
    }
  } catch (_) {}

  // 0b. Ordinal Reference Resolution ("yang pertama", "yang kedua", "yang terakhir", "keduanya", "program satunya")
  const ordinalResolution = resolveOrdinalReference(currentQuery, sessionData);
  if (ordinalResolution && ordinalResolution.resolvedEntities && ordinalResolution.resolvedEntities.length > 0) {
    return {
      shouldInherit: true,
      reason: 'ordinal_entity_reference',
      ordinalResolution,
      inheritedEntity: ordinalResolution.primaryEntity,
      inheritedEntities: ordinalResolution.resolvedEntities,
      inheritedDomain: sessionData.activeDomain || 'ACADEMIC_PROGRAM',
      inheritedIntent: sessionData.activeIntent || null,
      inheritedAspects: sessionData.activeAspects || sessionData.requestedAspects || []
    };
  } else if (hasOrdinalReferenceMarker(currentQuery)) {
    // Ordinal reference marker detected but antecedent entities are unavailable or ambiguous in session
    return {
      shouldInherit: false,
      isAmbiguous: true,
      reason: 'unresolved_ordinal_reference'
    };
  }

  // 0c. Partial Entity Reference Resolution (e.g. "Teknologi masuk fakultas apa?" when S1 Teknologi Informasi is active)
  const partialEntityRes = resolvePartialEntityInContext(currentQuery, sessionData);
  if (partialEntityRes) {
    if (partialEntityRes.isAmbiguous) {
      return {
        shouldInherit: false,
        isAmbiguousContext: true,
        candidateEntities: partialEntityRes.candidateEntities,
        reason: 'ambiguous_partial_entity_in_context'
      };
    }
    if (partialEntityRes.resolvedEntity) {
      return {
        shouldInherit: true,
        reason: 'partial_entity_reference',
        partialEntityResolved: true,
        inheritedEntity: partialEntityRes.resolvedEntity,
        inheritedDomain: sessionData.activeDomain || 'ACADEMIC_PROGRAM',
        inheritedIntent: sessionData.activeIntent || null,
        inheritedAspects: sessionData.activeAspects || sessionData.requestedAspects || []
      };
    }
  }

  // Explicit anaphoric program reference (e.g., "untuk prodi itu", "jurusan tersebut", "prodi tadi", "di prodi itu")
  const hasExplicitProgramPronoun = /\b(?:untuk|di|pada|tentang|mengenai)?\s*(?:prodi|program\s+studi|jurusan)\s+(?:itu|tersebut|tadi|ini)\b/i.test(query);
  const candidateRestoredProgram = sessionData.activeEntity || sessionData.preservedBackgroundEntity || sessionData.lastAcademicProgramEntity || null;
  if (hasExplicitProgramPronoun && candidateRestoredProgram) {
    const isScholarship = /\b(?:beasiswa|kip\s*kuliah|potongan\s+dpp|keringanan\s+biaya)\b/i.test(query);
    const isFee = /\b(?:biaya|spp|dpp|uang\s+kuliah|tarif)\b/i.test(query);
    return {
      shouldInherit: true,
      explicitProgramAnaphora: true,
      reason: 'explicit_program_anaphora_reference',
      inheritedDomain: isScholarship ? 'SCHOLARSHIP' : (isFee ? 'TUITION_FEE' : (sessionData.activeDomain || 'ACADEMIC_PROGRAM')),
      inheritedIntent: isScholarship ? 'SCHOLARSHIP_INQUIRY' : (isFee ? 'TUITION_FEE_INQUIRY' : null),
      inheritedEntity: candidateRestoredProgram
    };
  }

  const activeEntityStr = (sessionData.activeEntity && typeof sessionData.activeEntity === 'object')
    ? (sessionData.activeEntity.canonical || sessionData.activeEntity.name || '')
    : String(sessionData.activeEntity || '');

  const isInternationalActiveEntity = Boolean(
    sessionData.activeDomain === 'INTERNATIONAL' ||
    sessionData.activeEntity?.family === 'international_program' ||
    sessionData.activeEntity?.type === 'international_program' ||
    /\b(?:double\s+degree|dual\s+degree|utb|dnui|help\s+university|student\s+exchange|gccp|hi-?think)\b/i.test(activeEntityStr)
  );

  const isCampusLocationActiveEntity = Boolean(
    sessionData.activeDomain === 'FACILITIES' ||
    sessionData.activeIntent === 'CAMPUS_LOCATION' ||
    sessionData.activeEntity?.family === 'campus_location' ||
    sessionData.activeEntity?.type === 'campus' ||
    /\bkampus\b/i.test(activeEntityStr)
  );

  const isAcademicActiveEntity = Boolean(sessionData.activeEntity) && !isCampusLocationActiveEntity && (
    sessionData.activeEntity.family === 'academic_program' ||
    sessionData.activeEntity.family === 'international_program' ||
    sessionData.activeEntity.type === 'program' ||
    sessionData.activeEntity.type === 'international_program' ||
    (typeof sessionData.activeEntity === 'string' &&
     !['Wisuda', 'Yudisium', 'Kampus ITB STIKOM Bali'].includes(sessionData.activeEntity) &&
     !sessionData.activeDomain?.startsWith('ORGANIZATION') &&
     sessionData.activeDomain !== 'FACILITIES')
  );

  // Wave fee follow-up check (e.g. "Kalau gelombang 2 berapa?", "Kalau gelombang 2C berapa?", "Biaya gelombang 1 berapa?")
  const hasScheduleOrCalendarFocus = /\b(?:kapan|tanggal|jadwal|periode|kalender|buka|dibuka|ditutup|tutup|batas\s+(?:waktu|pendaftaran)|apa\s+saja|daftar\s+gelombang|pembagian\s+gelombang)\b/i.test(query);
  const hasFeeFocus = /\b(?:biaya|potongan|diskon|total|dpp|spp|bayar|uang\s+kuliah|uang\s+gedung|biaya\s+gedung|angsuran|cicilan)\b/i.test(query);
  const isWaveFeeFollowup = Boolean(sessionData.activeEntity) && !hasScheduleOrCalendarFocus && (
    (/\b(?:kalau\s+|kalo\s+)?gelombang\s*(?:[1-4]|i{1,4}|[0-9]+[a-z]?|khusus|awal|sisipan)\s*(?:berapa|biaya(?:nya)?|potongan(?:nya)?|diskon(?:nya)?|dpp(?:nya)?|total(?:nya)?)\b/i.test(query)) ||
    (/\bgelombang\s*(?:[1-4]|i{1,4}|[0-9]+[a-z]?|khusus|awal|sisipan)\b/i.test(query) && hasFeeFocus) ||
    ((sessionData.activeDomain === 'TUITION_FEE' || isAcademicActiveEntity) &&
     /\b(?:kalau\s+|kalo\s+)gelombang\s*(?:[1-4]|i{1,4}|[0-9]+[a-z]?|khusus|awal|sisipan)\s*(?:berapa|gimana|bagaimana)?\??$/i.test(query))
  );

  if (isWaveFeeFollowup) {
    return {
      shouldInherit: true,
      reason: 'wave_fee_continuation',
      inheritedDomain: 'TUITION_FEE',
      inheritedEntity: sessionData.activeEntity
    };
  }

  // Fee component continuation (e.g. "Kalau uang gedung?", "Berapa uang gedungnya?", "Biaya gedung berapa?")
  const isUangGedungFollowup = isAcademicActiveEntity && !hasScheduleOrCalendarFocus && (
    /\b(?:uang\s+gedung|biaya\s+gedung)\b/i.test(query)
  );
  if (isUangGedungFollowup) {
    return {
      shouldInherit: true,
      reason: 'fee_continuation',
      inheritedDomain: 'TUITION_FEE',
      inheritedIntent: 'TUITION_FEE_INQUIRY',
      inheritedEntity: sessionData.activeEntity,
      inheritedAspects: ['fee', 'dpp', 'tuition']
    };
  }

  // Scholarship follow-up / stacking inquiry check (e.g. "Apakah potongan gelombang bisa digabung dengan tambahan 60%?", "Bisa digabung tidak?", "Syaratnya apa?")
  const isScholarshipActive = sessionData.activeDomain === 'SCHOLARSHIP' || sessionData.activeIntent === 'SCHOLARSHIP_INQUIRY';
  const hasScholarshipContinuationFocus = !hasScheduleOrCalendarFocus && (
    (/\b(?:tambahan\s+\d+%|beasiswa|potongan|diskon|keringanan)\b/i.test(query) &&
     /\b(?:digabung|gabung|kombinasi|akumulasi|tumpuk|dobel|syarat|persyaratan|ketentuan)\b/i.test(query)) ||
    (/\b(?:digabung|gabung|kombinasi|akumulasi|tumpuk|dobel)\b/i.test(query) &&
     /\b(?:potongan|diskon|gelombang|tambahan|persen|%)\b/i.test(query))
  );

  if (isScholarshipActive && hasScholarshipContinuationFocus) {
    return {
      shouldInherit: true,
      reason: 'scholarship_continuation',
      inheritedDomain: 'SCHOLARSHIP',
      inheritedIntent: 'SCHOLARSHIP_INQUIRY',
      inheritedEntity: sessionData.activeEntity
    };
  }

  // Explicit admission wave schedule/status inquiry is university-wide and must NOT inherit fee or specific program entities
  const isAdmissionScheduleOrStatus = !isWaveFeeFollowup && !hasFeeFocus && (
    /\b(?:sekarang\s+buka|buka\s+gelombang|buka\s+pendaftaran|kapan\s+(?:buka|dibuka|ditutup|tutup)|jadwal\s+(?:gelombang|pendaftaran|pmb)|periode\s+(?:gelombang|pendaftaran)|kalender\s+pmb|gelombang\s+berapa)\b/i.test(query) ||
    (/\bgelombang\b/i.test(query) && (hasScheduleOrCalendarFocus || /\bpmb\b/i.test(query)))
  );
  if (isAdmissionScheduleOrStatus) {
    if (sessionData.activeDomain === 'PMB' || sessionData.activeIntent === 'GENERAL_PMB_INQUIRY' || sessionData.academicYear) {
      return {
        shouldInherit: true,
        reason: 'pmb_schedule_continuation',
        inheritedDomain: 'PMB',
        inheritedIntent: 'ADMISSION_SCHEDULE',
        inheritedEntity: null,
        inheritedAcademicYear: sessionData.academicYear || null
      };
    }
    return {
      shouldInherit: false,
      reason: 'admission_schedule_isolation'
    };
  }

  // Explicit general admission procedural inquiry (tahapan/alur/syarat pendaftaran mahasiswa baru/PMB/TA)
  // is university-wide and must NOT inherit previous international or program-specific entities unless explicitly requested.
  const hasSpecificProgramAnaphoraOrMention = /\b(?:dnui|help(?:\s+university)?|dual\s+degree|double\s+degree|internasional|international|luar\s+negeri|cina|china|malaysia|(?:program|jurusan|prodi)\s+(?:itu|tersebut|ini|terkait))\b/i.test(query);
  const hasGeneralAdmissionKeywords = /\b(?:mahasiswa\s+baru|pmb|ta\s*\d{4}\/\d{4})\b/i.test(query);
  const isGeneralAdmissionProcedural = !isWaveFeeFollowup && !hasFeeFocus && !hasSpecificProgramAnaphoraOrMention && (
    (hasGeneralAdmissionKeywords && /\b(?:daftar|pendaftaran|masuk|tahap(?:an)?|alur|prosedur|syarat|cara|langkah)\b/i.test(query)) ||
    /\b(?:tahap(?:an)?|alur|prosedur|cara|langkah)\s+pendaftaran\s+(?:mahasiswa\s+baru|pmb|ta\s*\d{4}\/\d{4}|itb\s+stikom\s+bali)\b/i.test(query)
  );
  if (isGeneralAdmissionProcedural) {
    return {
      shouldInherit: true,
      reason: 'general_pmb_procedural_continuation',
      inheritedDomain: 'PMB',
      inheritedIntent: 'GENERAL_PMB_INQUIRY',
      inheritedEntity: null,
      inheritedAcademicYear: sessionData.academicYear || null
    };
  }

  // Explicit academic event check: wisuda/yudisium must NOT inherit previous PMB or program entity
  const hasExplicitAcademicEvent = /\b(?:wisuda|yudisium)\b/i.test(query);
  if (hasExplicitAcademicEvent) {
    return {
      shouldInherit: false,
      reason: 'explicit_academic_event'
    };
  }

  // Guard: Campus-wide service domain inquiries (including institutional contact & campus location) must not inherit academic program entities
  const isContactQuery = /\b(?:kontak(?:nya)?|nomor(?:\s+telepon|\s+wa|\s+whatsapp|\s+hp|\s+kontak)?(?:nya)?|telepon(?:nya)?|telp(?:nya)?|whatsapp(?:nya)?|wa(?:nya)?|call\s*center|hotline|narahubung(?:nya)?)\b/i.test(query);
  const isInstitutionalContactQuery = !isInternationalActiveEntity && isContactQuery;
  const isInstitutionalCampusLocationQuery = !isInternationalActiveEntity && (
    /\b(?:lokasi\s+kampus|alamat\s+kampus|cabang\s+kampus|kampus(?:nya)?\s+di\s*mana|dimana\s+kampus)\b/i.test(query) ||
    (!isCampusLocationActiveEntity && /\b(?:lokasi(?:nya)?|alamat(?:nya)?)\b/i.test(query))
  );

  const isCampusWideQuery =
    isInstitutionalContactQuery ||
    isInstitutionalCampusLocationQuery ||
    (/\b(?:ukm\b|unit\s+kegiatan\s+mahasiswa|organisasi(?:\s+mahasiswa)?|ormawa|ekskul|ekstrakurikuler|student\s+clubs?|student\s+organizations?)\b/i.test(query) &&
     !/\b(?:hima\b|himaprodi|himpunan)\b/i.test(query)) ||
    (/\b(?:fasilitas|laboratorium|lab\b|perpustakaan|asrama|gedung|kantin|parkir|parking|lapangan)\b/i.test(query) &&
     !/\b(?:uang\s+gedung|biaya\s+gedung)\b/i.test(query)) ||
    /\b(?:beasiswa|kip\s*kuliah|kip-?k|bantuan\s+dana|keringanan\s+biaya)\b/i.test(query) ||
    /\b(?:inkubator|inbis|career\s+center|cdc\b|layanan\s+kampus|bimbingan\s+karir)\b/i.test(query);

  if (isCampusWideQuery && isAcademicActiveEntity) {
    return {
      shouldInherit: false,
      reason: 'campus_wide_domain_isolation'
    };
  }

  // Cross-domain isolation: Explicit academic / international program inquiries must NOT inherit non-academic session context (UKM, facilities, etc.)
  const hasExplicitAcademicOrInternationalTopic = /\b(?:double\s+degree|dual\s+degree|gelar\s+ganda|utb|universitas\s+teknologi\s+bandung|dnui|help\s+university|program\s+internasional|kelas\s+internasional|pertukaran\s+mahasiswa|student\s+exchange|prodi|jurusan|program\s+studi|s1|s2|d3|d4|sarjana|diploma|magister|biaya(?:\s+kuliah)?|spp|sks|kurikulum|matkul|pmb|pendaftaran\s+mahasiswa)\b/i.test(query) &&
    !/\b(?:biaya\s+parkir|sewa\s+gedung)\b/i.test(query);

  const isNonAcademicSession = sessionData.activeDomain && (
    sessionData.activeDomain.startsWith('ORGANIZATION') ||
    sessionData.activeDomain === 'FACILITIES' ||
    sessionData.activeDomain === 'CAMPUS_SERVICE' ||
    sessionData.activeEntity?.family === 'student_organization' ||
    sessionData.activeEntity?.family === 'campus_service' ||
    sessionData.activeEntity?.family === 'facility' ||
    sessionData.activeEntity === 'Kampus ITB STIKOM Bali'
  );

  if (hasExplicitAcademicOrInternationalTopic && isNonAcademicSession && !query.includes('tari') && !query.includes('ukm')) {
    return {
      shouldInherit: false,
      reason: 'cross_domain_isolation'
    };
  }

  // Campus count follow-up check (e.g. "Berapa ada kampus?", "Berapa jumlah kampus?")
  const isCampusCountFollowup = (
    /\b(?:berapa\s+(?:ada\s+)?kampus|ada\s+berapa\s+kampus|berapa\s+jumlah\s+kampus|jumlah\s+kampus|berapa\s+banyak\s+kampus|berapa\s+(?:ada\s+)?cabang|ada\s+berapa\s+cabang)\b/i.test(query) ||
    (/\b(?:berapa\s+ada|ada\s+berapa|berapa\s+jumlah|berapa\s+banyak)\b/i.test(query) && /\b(?:kampus|cabang)\b/i.test(query)) ||
    (isCampusLocationActiveEntity &&
     /\b(?:berapa\s+ada|ada\s+berapa|berapa\s+jumlah|berapa\s+banyak|jumlahnya|banyaknya)\b/i.test(query))
  );

  if (isCampusCountFollowup) {
    return {
      shouldInherit: true,
      reason: 'campus_count_followup',
      inheritedDomain: 'FACILITIES',
      inheritedIntent: 'CAMPUS_LOCATION',
      inheritedEntity: isCampusLocationActiveEntity ? (sessionData.activeEntity || 'Kampus ITB STIKOM Bali') : 'Kampus ITB STIKOM Bali'
    };
  }

  // Campus location follow-up check (e.g. "Lokasinya di mana saja?", "Di mana lokasinya?", proximity)
  const isLocationFollowup = (
    /\b(?:lokasi(?:nya)?|alamat(?:nya)?|di\s*mana(?:\s+saja)?|dimana(?:\s+saja)?|mana\s+saja|lebih\s+dekat|terdekat|jarak\s+terdekat)\b/i.test(query) &&
    isCampusLocationActiveEntity
  );

  if (isLocationFollowup) {
    return {
      shouldInherit: true,
      reason: 'campus_location_followup',
      inheritedDomain: 'FACILITIES',
      inheritedIntent: 'CAMPUS_LOCATION',
      inheritedEntity: sessionData.activeEntity || 'Kampus ITB STIKOM Bali'
    };
  }

  // Check: Bare Academic Program Query Continuation Guard
  // When the query consists solely of an academic program name (e.g. "S2 Sistem Informasi.", "S1 Sistem Informasi")
  const bareProgramMatches = (matchCanonicalEntities(query) || []).filter(m =>
    m.family === 'academic_program' || m.family === 'international_program'
  );
  const strippedBare = query
    .replace(/^(?:prodi|jurusan|program(?:\s+studi)?)\s+/i, '')
    .replace(/[.?!,]+/g, '')
    .trim()
    .toLowerCase();
  const isBareProgramQuery = bareProgramMatches.length === 1 &&
    strippedBare === bareProgramMatches[0].canonical.toLowerCase();

  if (isBareProgramQuery) {
    const matchedCanonical = bareProgramMatches[0].canonical;

    // CASE 1: Genuine Clarification Resume
    // Resume only if session has a strictly valid pendingClarification object matching 'program' slot within 24h TTL
    const pending = sessionData.pendingClarification;
    const hasValidProgramClarification = isValidPendingClarification(pending) && pending.requiredSlot === 'program';

    if (hasValidProgramClarification) {
      return {
        shouldInherit: true,
        reason: 'clarification_entity_response',
        inheritedDomain: pending.originalDomain,
        inheritedIntent: pending.originalIntent,
        inheritedEntity: matchedCanonical,
        clarificationResolved: true,
        inheritedAspects: sessionData.requestedAspects || ['procedure', 'requirements']
      };
    }

    // CASE 2: Entity Echo continuation (e.g. after SAFE_UNKNOWN discussing the exact same entity)
    const isSameEntityEcho = sessionData.activeEntity === matchedCanonical && sessionData.activeDomain;
    if (isSameEntityEcho) {
      return {
        shouldInherit: true,
        reason: 'entity_echo_continuation',
        inheritedDomain: sessionData.activeDomain,
        inheritedIntent: sessionData.activeIntent,
        inheritedEntity: matchedCanonical,
        inheritedAspects: sessionData.requestedAspects || sessionData.activeAspects || []
      };
    }
  }

  // Guard 1: Mentions a different academic program explicitly -> current turn switches to new program
  // Exception: If the query is a genuine ellipsis (e.g., "Kalau yang S1 Bisnis Digital?", "Bagaimana dengan D3 MI?"),
  // or an explicit entity correction ("Maaf, maksud saya Sistem Informasi"),
  // it switches the target entity while inheriting the active domain/intent/attribute from the prior turn!
  const explicitProgramMatches = (matchCanonicalEntities(query) || []).filter(m =>
    m.family === 'academic_program' || m.family === 'international_program'
  );
  const activeCanon = findCanonicalEntity(sessionData.activeEntity)?.canonical?.toLowerCase();
  const mentionsDifferentProgram = explicitProgramMatches.some(m =>
    m.canonical?.toLowerCase() !== activeCanon
  );

  // Explicit entity correction check (e.g. "Maaf, maksud saya Sistem Informasi", "Maksud saya Kampus Jimbaran")
  const isCorrection = /^(?:maaf|sorry|bukan|salah|ralat|koreksi|eh|keliru)(?:[\s,]+(?:maaf|sorry|bukan|salah|ralat|koreksi|eh|keliru))*[\s,]+(?:maksud(?:nya|ku|saya)?|tapi|melainkan|yang\s+benar|maksud(?:nya|ku|saya)?\s+(?:adalah|bukan|tapi))?\s+(.+)$/i.test(query) ||
    /^(?:maksud(?:nya|ku|saya)?|yang\s+(?:saya\s+)?maksud|ralat|koreksi)(?:\s+(?:adalah|itu|bukan))?\s+(.+)$/i.test(query);

  if (isCorrection) {
    if (explicitProgramMatches.length > 0) {
      const withoutCorrectionLead = query
        .replace(/^(?:maaf|sorry|bukan|salah|ralat|koreksi|eh|keliru|maksud(?:nya|ku|saya)?|yang\s+(?:saya\s+)?maksud|adalah|tapi|melainkan|prodi|jurusan|program\s+studi)+/gi, '')
        .trim();
      const hasNewSubstantiveTopic = /\b(?:syarat|persyaratan|kurikulum|mata\s*kuliah|matkul|lokasi|alamat|prospek|peluang\s*kerja|akreditasi|fasilitas|pendaftaran|pmb|biaya|spp|dpp|uang\s+kuliah|tarif|cicil|angsur|uang\s+gedung)\b/i.test(withoutCorrectionLead);

      if (!hasNewSubstantiveTopic && (sessionData.activeDomain || sessionData.activeIntent)) {
        return {
          shouldInherit: true,
          isEntityCorrection: true,
          reason: 'explicit_entity_correction',
          inheritedEntity: explicitProgramMatches[0].canonical,
          inheritedDomain: sessionData.activeDomain || 'ACADEMIC_PROGRAM',
          inheritedIntent: sessionData.activeIntent || 'PROGRAM_OVERVIEW',
          inheritedAspects: sessionData.requestedAttributes || sessionData.activeAspects || [],
          replacedEntity: sessionData.activeEntity
        };
      }
    }

    const explicitCampusMatches = (matchCanonicalEntities(query) || []).filter(m =>
      m.family === 'campus_location' || m.type === 'campus'
    );
    if (explicitCampusMatches.length > 0 && isCampusLocationActiveEntity) {
      const withoutCorrectionLead = query
        .replace(/^(?:maaf|sorry|bukan|salah|ralat|koreksi|eh|keliru|maksud(?:nya|ku|saya)?|yang\s+(?:saya\s+)?maksud|adalah|tapi|melainkan|kampus|cabang)+/gi, '')
        .trim();
      const hasNewSubstantiveTopic = /\b(?:syarat|kurikulum|biaya|spp|dpp|pmb|prospek)\b/i.test(withoutCorrectionLead);
      if (!hasNewSubstantiveTopic) {
        return {
          shouldInherit: true,
          isEntityCorrection: true,
          reason: 'explicit_entity_correction',
          inheritedEntity: explicitCampusMatches[0].canonical,
          inheritedDomain: 'FACILITIES',
          inheritedIntent: sessionData.activeIntent || 'CAMPUS_LOCATION',
          inheritedAspects: sessionData.requestedAttributes || sessionData.activeAspects || ['location', 'address'],
          replacedEntity: sessionData.activeEntity
        };
      }
    }
  }

  if (mentionsDifferentProgram && !isGenuineEllipsis(query)) {
    return {
      shouldInherit: false,
      reason: 'explicit_different_program'
    };
  }

  // Guard 2: Explicit institutional catalog inquiry (asking for list of all offered programs)
  const isExplicitCatalogInquiry = /\b(?:apa\s+(?:saja\s+)?(?:jurusan|prodi|program\s+studi)|ada\s+(?:jurusan|prodi|program\s+studi)\s+apa(?:\s+saja)?|daftar\s+(?:jurusan|prodi|program\s+studi)|pilihan\s+(?:jurusan|prodi)|list\s+(?:jurusan|prodi)|jurusan(?:\s+apa)?\s+di\s+stikom\s+ada\s+apa\s+saja)\b/i.test(query);
  if (isExplicitCatalogInquiry) {
    return {
      shouldInherit: false,
      reason: 'explicit_catalog_inquiry'
    };
  }

  // Check 0: Curriculum, learning, competency, or program prerequisites follow-up
  const hasAdmissionScheduleFocus = /\b(?:kapan|tanggal|jadwal\s+(?:pmb|pendaftaran|gelombang)|periode\s+(?:pmb|pendaftaran)|buka|dibuka|ditutup|tutup|batas\s+pendaftaran|gelombang\s+(?:berapa|apa\s+saja))\b/i.test(query);
  const isCurriculumOrCompetencyInquiry = isAcademicActiveEntity && !hasAdmissionScheduleFocus && !hasFeeFocus && !hasExplicitPronounReference(query) && (
    // Direct curriculum terms
    /\b(?:kurikulum(?:nya)?|mata\s*kuliah(?:nya)?|matkul(?:nya)?|silabus(?:nya)?|sebaran\s*mata\s*kuliah|daftar\s*matkul|materi\s+(?:kuliah|pembelajaran)(?:nya)?|modul(?:nya)?)\b/i.test(query) ||
    // Learning inquiry phrases
    /\b(?:apa\s+saja\s+yang\s+dipelajari|apa\s+yang\s+dipelajari|yang\s+dipelajari\s+apa|belajar\s+apa(?:\s+saja|\s+aja)?|mempelajari\s+apa|diajarkan\s+apa|diajarin\s+apa)\b/i.test(query) ||
    // Study/learning verbs combined with topic, competency, or skill
    (/\b(?:belajar|mempelajari|diajarkan|diajarin|ada\s+materi|ada\s+pelajaran)\b/i.test(query) &&
     /\b(?:coding|koding|ngoding|pemrograman|programming|digital\s+marketing|marketing|pemasaran|ai\b|artificial\s+intelligence|kecerdasan\s+buatan|machine\s+learning|data\s+science|data\s+analyst|cyber|keamanan\s+siber|jaringan|networking|web|mobile|android|game|multimedia|desain|iot|robotik|robotika|cloud|blockchain|akuntansi|bisnis|manajemen|komputer|software|hardware|algoritma|basis\s+data|database)\b/i.test(query)) ||
    // Competency, prerequisite, or skill requirements (e.g. "Apakah harus jago coding?", "Harus bisa matematika?")
    (/\b(?:apakah\s+)?(?:harus|perlu|wajib|kudu|bisa|jago|mahir|pintar|paham|menguasai|punya\s+skill|punya\s+keahlian|syarat\s+kemampuan)\b/i.test(query) &&
     /\b(?:coding|koding|ngoding|pemrograman|programming|it\b|komputer|hitung-?hitungan|matematika|desain|design|marketing|bahasa\s+inggris|inggris|gambar|menggambar|logic|logika)\b/i.test(query)) ||
    // Standalone coding / programming inquiry in academic context
    /\b(?:ada\s+coding(?:nya)?|coding(?:an)?\s+nggak|banyak\s+koding(?:nya)?|harus\s+bisa\s+coding)\b/i.test(query)
  );

  if (isCurriculumOrCompetencyInquiry) {
    const isUmbrellaOrInternational = /\b(?:international\s+(?:dual|double)\s+degree|double\s+degree|dual\s+degree|student\s+exchange|exchange)\b/i.test(sessionData.activeEntity || '');
    const isGeneralReadiness = /\b(?:harus|perlu|wajib|kudu|bisa|jago|mahir|punya\s+skill|syarat\s+kemampuan)\b/i.test(query) &&
      /\b(?:coding|koding|ngoding|pemrograman|programming|matematika|hitung-?hitungan|it\b|komputer)\b/i.test(query);

    if (isUmbrellaOrInternational && isGeneralReadiness) {
      const fallbackUndergrad = [
        sessionData.lastAcademicProgramEntity,
        sessionData.preservedBackgroundEntity,
        sessionData.previousUndergradEntity
      ].find(e => e && /^(?:s1|d3)\s+/i.test(e) && !/dual|double/i.test(e));

      if (fallbackUndergrad) {
        return {
          shouldInherit: true,
          reason: 'curriculum_continuation_restored_undergrad',
          inheritedDomain: 'ACADEMIC_CURRICULUM',
          inheritedIntent: 'CURRICULUM_INQUIRY',
          inheritedEntity: fallbackUndergrad
        };
      }

      return {
        shouldInherit: false,
        reason: 'general_prerequisite_readiness'
      };
    }

    return {
      shouldInherit: true,
      reason: 'curriculum_continuation',
      inheritedDomain: 'ACADEMIC_CURRICULUM',
      inheritedIntent: 'CURRICULUM_INQUIRY',
      inheritedEntity: sessionData.activeEntity
    };
  }

  // Check 1: Genuine Ellipsis
  const isApplicantSchoolBackgroundEllipsis = /\b(?:lulusan|alumni|tamatan|asal(?:\s+sekolah)?|dari)\s+(?:sma|smk|ma|paket\s+c|sekolah\s+menengah)\b/i.test(query);
  if (isApplicantSchoolBackgroundEllipsis && isAcademicActiveEntity) {
    return {
      shouldInherit: true,
      reason: 'applicant_school_background_followup',
      inheritedDomain: 'PMB',
      inheritedIntent: 'ADMISSION_REQUIREMENTS',
      inheritedEntity: sessionData.activeEntity
    };
  }

  if (isGenuineEllipsis(query)) {
    return {
      shouldInherit: true,
      reason: 'genuine_ellipsis',
      inheritedDomain: isInternationalActiveEntity && !hasFeeFocus && !mentionsDifferentProgram ? 'INTERNATIONAL' : sessionData.activeDomain,
      inheritedIntent: sessionData.activeIntent || (sessionData.activeDomain === 'FACILITIES' ? 'CAMPUS_LOCATION' : null),
      inheritedEntity: sessionData.activeEntity,
      inheritedAspects: Array.isArray(sessionData.activeAspects) ? sessionData.activeAspects : []
    };
  }

  // Check 2: Explicit Pronoun/Reference (includes enclitic -nya like "studinya" and "the program")
  if (hasExplicitPronounReference(query)) {
    if (isCampusLocationActiveEntity) {
      // Branch campus in active context:
      // General PMB procedure ("Bagaimana cara pendaftarannya?", "Syarat pendaftarannya apa?") is institutional, not branch-specific!
      const isPmbProcedural = /\b(?:cara\s+(?:daftar|mendaftar|pendaftaran)|alur\s+pendaftaran|prosedur\s+pendaftaran|tahap(?:an)?\s+pendaftaran|pendaftarannya|daftarnya|jadwal\s+pmb|info\s+pmb)\b/i.test(query);
      if (isPmbProcedural) {
        return {
          shouldInherit: true,
          reason: 'general_pmb_procedural_continuation',
          inheritedDomain: 'PMB',
          inheritedIntent: 'GENERAL_PMB_INQUIRY',
          inheritedEntity: null,
          inheritedAcademicYear: sessionData.academicYear || null
        };
      }
      // Academic program inquiry when active entity is campus location: do NOT inherit campus location
      const isAcademicTopic = /\b(?:kurikulum|matkul|mata\s*kuliah|prospek|karir|karier|peluang\s*kerja|gelar|sks|biaya|spp|dpp)\b/i.test(query);
      if (isAcademicTopic) {
        return {
          shouldInherit: false,
          reason: 'cross_domain_campus_to_academic_isolation'
        };
      }
    }

    return {
      shouldInherit: true,
      reason: 'pronoun_reference',
      inheritedDomain: isInternationalActiveEntity && !hasFeeFocus ? 'INTERNATIONAL' : sessionData.activeDomain,
      inheritedEntity: sessionData.activeEntity
    };
  }

  // Check 3: Attribute or Procedural Continuation without explicit entity
  const isAttributeInquiry = /\b(gelar(?:\s+apa)?|masa\s+studi|durasi\s+studi|lama\s+studi|prospek(?:\s+lulusan|\s+kerja|\s+karir|\s+karier)?|peluang\s+kerja|karir|karier|fakultas(?:\s+apa)?|masuk\s+fakultas|di\s+bawah\s+fakultas|akreditasi|terakreditasi|total\s+sks|jumlah\s+sks|berapa\s+sks|beban\s+studi|kelas\s+(?:sore|malam|karyawan|reguler)|kuliah\s+sambil\s+kerja|rincian\s+biaya|biaya(?:\s+kuliah)?|spp|dpp|degree(?:s)?(?:\s+awarded|\s+received)?|qualification(?:s)?|study\s+duration|study\s+length|duration(?:\s+of\s+study)?|how\s+long\b|graduate(?:s)?|graduation)\b/i.test(query) ||
    ((!isAcademicActiveEntity || isInternationalActiveEntity) && isContactQuery);
  const isProceduralInquiry = /\b(?:bagaimana\s+cara\s+(?:daftar|mendaftar)|cara\s+(?:daftar|mendaftar|pendaftaran)|alur\s+pendaftaran|prosedur\s+pendaftaran|syarat(?:\s+pendaftaran|\s+masuk|\s+daftar)?|persyaratan(?:\s+pendaftaran|\s+masuk|\s+daftar)?|berkas|dokumen(?:\s+persyaratan)?|kapan\s+pendaftaran|jadwal\s+pendaftaran|tahapan\s+pendaftaran|how\s+to\s+apply|how\s+to\s+register|admission\s+procedure|registration\s+procedure|admission\s+requirements)\b/i.test(query);
  const isDateInquiry = /\b(tanggal(?:\s+berapa)?|kapan|jadwal|waktu|hari\s+apa|pelaksanaan)\b/i.test(query);

  // Academic Event Continuation (Wisuda / Yudisium)
  const isExplicitPMB = /\b(?:pmb|mahasiswa\s+baru|calon\s+mahasiswa|kuliah\s+di|masuk\s+stikom)\b/i.test(query);
  const isAcademicEventSession = (sessionData.activeDomain === 'ACADEMIC_EVENT' || sessionData.activeIntent === 'GRADUATION_INQUIRY' || /\b(?:wisuda|yudisium)\b/i.test(sessionData.lastQuery || ''));

  if (isAcademicEventSession && (isProceduralInquiry || isDateInquiry || isAttributeInquiry)) {
    if (!isExplicitPMB) {
      return {
        shouldInherit: true,
        reason: 'academic_event_continuation',
        inheritedDomain: 'ACADEMIC_EVENT',
        inheritedEntity: null
      };
    }
  }

  // PMB General Continuation (e.g. Turn 1: "Tanya PMB", Turn 2: "Jadwal pendaftaran")
  const isPmbContinuationQuery = /\b(?:jadwal(?:\s+pendaftaran)?|kapan(?:\s+pendaftaran|\s+dibuka|\s+tutup)?|tanggal(?:\s+pendaftaran|\s+penting)?|alur(?:\s+pendaftaran)?|cara\s+daftar|syarat(?:\s+pendaftaran)?|persyaratan|biaya\s+daftar|link\s+pendaftaran|gelombang)\b/i.test(query);
  const isPmbActiveSession = (sessionData.activeDomain === 'PMB' ||
    sessionData.activeIntent === 'GENERAL_PMB_INQUIRY' ||
    sessionData.activeIntent === 'ADMISSION_SCHEDULE' ||
    sessionData.activeIntent === 'ADMISSION_PROCEDURE' ||
    /\bpmb\b/i.test(sessionData.lastQuery || ''));

  if (isPmbActiveSession && (isProceduralInquiry || isDateInquiry || isPmbContinuationQuery || (isAttributeInquiry && !sessionData.activeEntity))) {
    const isExplicitUnrelatedDomain = /\b(?:kampus\s+(?:renon|jimbaran|abiansemal)|wisuda|yudisium|ukm|inbis|organisasi)\b/i.test(query);
    if (!isExplicitUnrelatedDomain) {
      const isScheduleFocus = isDateInquiry || /\b(?:jadwal|kapan|tanggal|gelombang|dibuka|tutup)\b/i.test(query);
      return {
        shouldInherit: true,
        reason: isScheduleFocus ? 'pmb_schedule_continuation' : 'pmb_procedural_continuation',
        inheritedDomain: 'PMB',
        inheritedIntent: isScheduleFocus ? 'ADMISSION_SCHEDULE' : 'GENERAL_PMB_INQUIRY',
        inheritedEntity: null,
        inheritedAcademicYear: sessionData.academicYear || null
      };
    }
  }

  if ((isAttributeInquiry || isProceduralInquiry || isDateInquiry) && sessionData.activeEntity) {
    const isFee = /\b(rincian\s+biaya|biaya|spp|dpp)\b/i.test(query);
    const isContact = isInstitutionalContactQuery;
    const isAdmission = isProceduralInquiry || /\b(daftar|pendaftaran|syarat|persyaratan|berkas|dokumen)\b/i.test(query);

    let inheritedDomain = isInternationalActiveEntity ? 'INTERNATIONAL' : (sessionData.activeDomain || 'ACADEMIC_PROGRAM');
    if (isFee) inheritedDomain = 'TUITION_FEE';
    else if (isContact && !isInternationalActiveEntity) inheritedDomain = 'CAMPUS_SERVICE';
    else if (isAdmission && inheritedDomain !== 'INTERNATIONAL') inheritedDomain = 'PMB';
    else if (isDateInquiry && (sessionData.activeDomain === 'ACADEMIC_EVENT' || sessionData.activeDomain === 'ACADEMIC_SCHEDULE' || /^(?:wisuda|yudisium)$/i.test(activeEntityStr))) {
      inheritedDomain = 'ACADEMIC_EVENT';
    }

    return {
      shouldInherit: true,
      reason: isDateInquiry ? 'date_continuation' : (isAttributeInquiry ? 'attribute_continuation' : 'procedural_continuation'),
      inheritedDomain,
      inheritedEntity: sessionData.activeEntity,
      inheritedAcademicYear: sessionData.academicYear || null
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
  extractOrderedSessionEntities,
  hasOrdinalReferenceMarker,
  resolveOrdinalReference,
  resolvePartialEntityInContext,
  evaluateContextDependency,
  isValidPendingClarification
};
