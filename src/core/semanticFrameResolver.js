'use strict';

/**
 * src/core/semanticFrameResolver.js
 * 
 * Greenfield Semantic Frame Resolver.
 * Maps user queries into a comprehensive, typed, and structured SemanticFrame.
 * 
 * Target Contract:
 * {
 *   rawQuery,
 *   normalizedQuery,
 *   domain,
 *   intent,
 *   entities: [],
 *   relation,
 *   aspects: [],
 *   temporal: { isCurrent: boolean, constraint: string },
 *   userState: string,
 *   desiredAction: string,
 *   subQueries: [],
 *   contextDependencies: []
 * }
 */

const { matchCanonicalEntities, findCanonicalEntity } = require('../engine/canonicalEntityRegistry');
const { evaluateContextDependency } = require('./contextResolver');

// Temporal markers for NOW / current status
const TEMPORAL_NOW_REGEX = /\b(masih|sekarang|hari ini|saat ini|tahun ini|terbaru|gelombang ini|saat sekarang)\b/i;

function normalizeQueryText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .replace(/[?!,.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts domain and primary intent based on semantic patterns
 */
function inferDomainAndIntent(normalized, entities = []) {
  // 0. Conversational Greeting & Small Talk (Non-Retrieval)
  if (/^(hallo+|halo+|hai+|hi+|hei+|pagi|siang|sore|malam|assalamu'?alaikum|selamat\s+(pagi|siang|sore|malam)|sampurasun|om\s+swastiastu)\b/i.test(normalized) &&
      !/\b(biaya|daftar|jurusan|prodi|beasiswa|kuliah|akreditasi|perwalian|krs|mata\s*kuliah|sks)\b/i.test(normalized)) {
    return {
      domain: 'CONVERSATIONAL',
      intent: 'CONVERSATIONAL_GREETING',
      retrievalRequired: false,
      userState: 'GREETING',
      desiredAction: 'GREET_USER',
      aspects: ['greeting'],
      relation: 'GREETING'
    };
  }

  if (/\b(apa\s+kha?bar|bagaimana\s+kha?bar(?:mu)?|gimana\s+kha?bar(?:mu)?|kha?bar(?:nya)?\s+gimana|kamu\s+siapa|siapa\s+kamu|kamu\s+robot)\b/i.test(normalized)) {
    return {
      domain: 'CONVERSATIONAL',
      intent: 'CONVERSATIONAL_SMALL_TALK',
      retrievalRequired: false,
      userState: 'SMALL_TALK',
      desiredAction: 'RESPOND_SMALL_TALK',
      aspects: ['small_talk'],
      relation: 'SMALL_TALK'
    };
  }

  // 1. Academic Missed Process / State
  if (/\b(terlambat|telat|ketinggalan|terlewat|lupa)\s+(perwalian|krs|daftar ulang|bayar|ujian|sidang|yudisium)\b/i.test(normalized)) {
    const processMatch = normalized.match(/\b(perwalian|krs|daftar ulang|bayar|ujian|sidang|yudisium)\b/i);
    const process = processMatch ? processMatch[1].toUpperCase() : 'ACADEMIC_PROCESS';
    return {
      domain: 'ACADEMIC',
      intent: 'MISSED_ACADEMIC_PROCESS',
      retrievalRequired: false,
      userState: 'LATE',
      desiredAction: 'NEXT_STEP_PROCEDURE',
      aspects: ['procedure', 'deadline', 'late_policy'],
      relation: `LATE_FOR_${process}`
    };
  }

  // 2. Program Curriculum Inquiry (Priority over general program info)
  if (/\b(kurikulum|mata\s*kuliah|matkul|sebaran\s*mata\s*kuliah|silabus|daftar\s*matkul)\b/i.test(normalized)) {
    return {
      domain: 'ACADEMIC_CURRICULUM',
      intent: 'CURRICULUM_INQUIRY',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_CURRICULUM_INFO',
      aspects: ['curriculum', 'courses'],
      relation: 'PROGRAM_CURRICULUM'
    };
  }

  // 3. Program Overview / Definition / Profile (Generic across academic programs)
  const hasAcademicProgram = entities.some(e => e.family === 'academic_program' || e.type === 'program');
  if ((/\b(apa\s+itu|pengertian|definisi|profil|tentang|penjelasan|deskripsi)\b/i.test(normalized) && hasAcademicProgram) ||
      (/\b(apa\s+itu\s+program\s+studi|profil\s+prodi|profil\s+program\s+studi)\b/i.test(normalized))) {
    return {
      domain: 'ACADEMIC_PROGRAM',
      intent: 'PROGRAM_OVERVIEW',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_PROGRAM_OVERVIEW',
      aspects: ['overview', 'definition'],
      relation: 'PROGRAM_OVERVIEW'
    };
  }

  // 4. Dynamic Quota / Live Enrollment Availability (Priority over static study mode)
  if (/\b(kuota|sisa kuota|daya tampung|masih menerima pendaftar|masih menerima|masih ada kuota)\b/i.test(normalized)) {
    return {
      domain: 'ADMISSION_QUOTA',
      intent: 'LIVE_QUOTA_INQUIRY',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_LIVE_STATUS',
      aspects: ['quota', 'dynamic_availability', 'live_status'],
      relation: 'LIVE_ENROLLMENT_AVAILABILITY'
    };
  }

  // 5. Study Mode / Class Schedule / Working Students
  if (/\b(kuliah sore|kelas karyawan|kuliah malam|untuk yang bekerja|sambil kerja|kelas malam|kuliah sambil kerja)\b/i.test(normalized)) {
    return {
      domain: 'ACADEMIC_PROGRAM',
      intent: 'STUDY_MODE',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_STUDY_MODE_INFO',
      aspects: ['class_schedule', 'working_students', 'evening_class'],
      relation: 'PROGRAM_STUDY_MODE'
    };
  }

  // 6. International Programs
  if (entities.some(e => e.family === 'international_program') || /\b(double degree|dual degree|international program|pertukaran mahasiswa|student exchange)\b/i.test(normalized)) {
    let intent = 'INTERNATIONAL_PROGRAM_INFO';
    const aspects = [];
    let relation = 'PROGRAM_DETAILS';

    if (/\b(full di stikom|di mana kuliahnya|lokasi|tempat kuliah|kuliah di luar|ke luar negeri|onsite|offline)\b/i.test(normalized)) {
      intent = 'STUDY_LOCATION';
      aspects.push('study_location', 'delivery_mode');
      relation = 'LOCATION_MODE';
    } else if (/\b(keuntungan(?:nya)?|manfaat(?:nya)?|benefit(?:nya)?|kelebihan(?:nya)?|gelar(?:nya)?)\b/i.test(normalized)) {
      intent = 'PROGRAM_BENEFIT';
      aspects.push('benefits', 'degree_award');
      relation = 'BENEFITS_AWARD';
    } else if (/\b(apa itu|pengertian|definisi)\b/i.test(normalized)) {
      intent = 'DEFINITION';
      aspects.push('overview', 'definition');
      relation = 'DEFINITION';
    }

    return {
      domain: 'INTERNATIONAL',
      intent,
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_INTERNATIONAL_PROGRAM_INFO',
      aspects,
      relation
    };
  }

  // 7. Admission / PMB Schedule & Current Status
  if (/\b(pmb|pendaftaran|daftar|gelombang|buka|masih dibuka|kapan buka|jalur pendaftaran)\b/i.test(normalized)) {
    const isNow = TEMPORAL_NOW_REGEX.test(normalized);
    return {
      domain: 'PMB',
      intent: isNow ? 'CURRENT_ENROLLMENT_STATUS' : 'ADMISSION_SCHEDULE',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_PMB_STATUS',
      aspects: ['schedule', 'status', 'wave_info'],
      relation: 'ADMISSION_WINDOW'
    };
  }

  // 8. Academic Graduation Requirement (SKS lulus)
  if (/\b(sks|jumlah sks|sks lulus|beban sks)\b/i.test(normalized)) {
    return {
      domain: 'ACADEMIC_CURRICULUM',
      intent: 'GRADUATION_REQUIREMENTS',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_CURRICULUM_REQUIREMENTS',
      aspects: ['sks_count', 'graduation_rule'],
      relation: 'DEGREE_REQUIREMENT'
    };
  }

  // 9. Program Comparison (Perbedaan Prodi)
  const hasProgramEntity = entities.some(e => e.family === 'academic_program' || e.type === 'program');
  if (/\b(perbedaan|beda|bedanya|banding|dibandingkan)\b/i.test(normalized) && 
      (/\b(prodi|jurusan|program studi)\b/i.test(normalized) || hasProgramEntity || entities.length >= 2)) {
    return {
      domain: 'ACADEMIC_PROGRAM',
      intent: 'PROGRAM_COMPARISON',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_PROGRAM_DIFFERENTIATION',
      aspects: ['curriculum_difference', 'career_prospects'],
      relation: 'PROGRAM_COMPARISON'
    };
  }

  // 10. Accreditation
  if (/\b(akreditasi|terakreditasi|ban-?pt|lam-?infokom)\b/i.test(normalized)) {
    const isProdi = entities.some(e => e.family === 'academic_program' || e.type === 'program') || /\b(prodi|jurusan|program studi|s1|d3|s2)\b/i.test(normalized);
    return {
      domain: isProdi ? 'ACADEMIC_PROGRAM' : 'INSTITUTIONAL',
      intent: isProdi ? 'PROGRAM_ACCREDITATION' : 'INSTITUTIONAL_ACCREDITATION',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_ACCREDITATION_STATUS',
      aspects: ['akreditasi', 'peringkat', 'sk_akreditasi'],
      relation: isProdi ? 'PROGRAM_ACCREDITATION' : 'INSTITUTIONAL_ACCREDITATION'
    };
  }

  // 11. Tuition Fee / Biaya Kuliah
  if (/\b(biaya|biaya kuliah|spp|dpp|uang pangkal|bayar kuliah|angsuran|potongan biaya|cicilan)\b/i.test(normalized)) {
    return {
      domain: 'TUITION_FEE',
      intent: 'TUITION_FEE_INQUIRY',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_TUITION_FEE_INFO',
      aspects: ['fee', 'dpp', 'tuition'],
      relation: 'TUITION_FEE'
    };
  }

  // 10. General Academic / Facility / Unit
  if (/\b(inbis|inkubator|karir|magang|internship|campus hiring|sertifikasi|training|custom software|mou|pks|riset)\b/i.test(normalized)) {
    return {
      domain: 'CAMPUS_SERVICE',
      intent: 'SERVICE_INQUIRY',
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_CAMPUS_SERVICE_INFO',
      aspects: ['facility', 'cooperation', 'service_procedure'],
      relation: 'CAMPUS_SERVICE'
    };
  }

  // Default General Ingestion
  return {
    domain: 'GENERAL',
    intent: 'GENERAL_INQUIRY',
    userState: 'INQUIRING',
    desiredAction: 'PROVIDE_INFORMATION',
    aspects: ['general'],
    relation: 'GENERAL'
  };
}

/**
 * Resolves a raw user query into a clean, complete SemanticFrame.
 */
function resolveSemanticFrame(rawQuery, sessionData = {}) {
  const raw = String(rawQuery || '').trim();
  const normalized = normalizeQueryText(raw);

  // 1. Check Context Dependency (Pronoun or Genuine Ellipsis)
  const contextDep = evaluateContextDependency(raw, sessionData);

  // 2. Extract Canonical Entities
  const canonicalMatches = matchCanonicalEntities(normalized);
  const entities = (canonicalMatches || []).map(m => ({
    canonical: m.canonical,
    type: m.type,
    family: m.family
  }));

  // 3. Temporal Resolution
  const isCurrent = TEMPORAL_NOW_REGEX.test(normalized);
  const temporal = {
    isCurrentConstraint: isCurrent,
    constraint: isCurrent ? 'NOW' : 'GENERAL'
  };

  // 4. Infer Domain & Intent
  const inferred = inferDomainAndIntent(normalized, entities);

  // Apply context inheritance only if explicitly evaluated as dependent
  let domain = inferred.domain;
  let intent = inferred.intent;
  if (contextDep.shouldInherit && contextDep.inheritedDomain && domain === 'GENERAL') {
    domain = contextDep.inheritedDomain;
  }

  return {
    rawQuery: raw,
    normalizedQuery: normalized,
    domain,
    intent,
    retrievalRequired: inferred.retrievalRequired !== false,
    entities,
    relation: inferred.relation,
    aspects: inferred.aspects,
    temporal,
    userState: inferred.userState,
    desiredAction: inferred.desiredAction,
    subQueries: [],
    contextDependencies: contextDep.shouldInherit ? [contextDep] : []
  };
}

module.exports = {
  normalizeQueryText,
  inferDomainAndIntent,
  resolveSemanticFrame
};
