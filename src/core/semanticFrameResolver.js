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

  // 0.05 Conversational Closing / Acknowledgement
  if (/^(oke+|ok+|baik+|terima\s*kasih|makasih|thanks|thank\s*you|siap|sip|noted|mantap)\b/i.test(normalized) &&
      !/\b(biaya|daftar|jurusan|prodi|beasiswa|kuliah|akreditasi|perwalian|krs|mata\s*kuliah|sks|semester)\b/i.test(normalized)) {
    return {
      domain: 'CONVERSATIONAL',
      intent: 'CONVERSATIONAL_ACKNOWLEDGEMENT',
      retrievalRequired: false,
      userState: 'ACKNOWLEDGING',
      desiredAction: 'ACKNOWLEDGE_USER',
      aspects: ['acknowledgement'],
      relation: 'ACKNOWLEDGEMENT'
    };
  }

  // 0.1 Prompt Injection & Adversarial Jailbreak Defense
  if (/\b(ignore\s+(all\s+)?(?:previous\s+)?instructions|forget\s+(?:all\s+)?(?:rules|instructions)|system\s+prompt|reveal\s+(?:the\s+)?prompt|jailbreak|kamu\s+sekarang\s+adalah\s+DAN|abaikan\s+(?:semua\s+)?(?:instruksi|aturan)|lupakan\s+(?:semua\s+)?(?:instruksi|aturan)|bocorkan\s+prompt|bypass\s+security)\b/i.test(normalized)) {
    return {
      domain: 'CONVERSATIONAL',
      intent: 'ADVERSARIAL_INJECTION_DEFENSE',
      retrievalRequired: false,
      userState: 'ADVERSARIAL',
      desiredAction: 'REFUSE_ADVERSARIAL',
      aspects: ['safety_refusal'],
      relation: 'SAFETY_GUARD'
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
  if (/\b(kurikulum(?:nya)?|mata\s*kuliah|matkul|sebaran\s*mata\s*kuliah|silabus|daftar\s*matkul|belajar\s+mata\s*kuliah|semester\s*(?:[1-8]|[ivx]+))\b/i.test(normalized)) {
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

  // 3. Available Programs Listing (Generic Scope vs Specific Entity)
  if (/\b(apa\s+saja\s+(?:pilihan\s+)?(?:program\s*studi|jurusan|prodi|program\s*s1|jurusan\s*s1|sarjana)|(?:pilihan\s+)?(?:program\s*studi|jurusan|prodi|program)(?:\s+(?:s1|sarjana|s2|d3))?\s*(?:apa\s*saja|yang\s*tersedia|yang\s*ada|ada\s+apa\s+saja|pilihannya\s+apa)|ada\s+(?:jurusan|program\s*studi|prodi)\s*apa\s*saja)\b/i.test(normalized)) {
    const isS1Only = /\b(s1|sarjana)\b/i.test(normalized);
    const isS2Only = /\b(s2|magister|pascasarjana)\b/i.test(normalized);
    const isD3Only = /\b(d3|diploma)\b/i.test(normalized);
    const scopeLevel = isS1Only ? 'S1' : (isS2Only ? 'S2' : (isD3Only ? 'D3' : 'ALL'));

    return {
      domain: 'ACADEMIC_PROGRAM',
      intent: 'AVAILABLE_PROGRAMS_LIST',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_PROGRAMS_LIST',
      aspects: ['program_list', 'degrees'],
      relation: `AVAILABLE_PROGRAMS_${scopeLevel}`,
      scopeLevel
    };
  }

  // 4. Program Overview / Definition / Profile / Career / Degree (Generic across academic programs)
  const hasAcademicProgram = entities.some(e => e.family === 'academic_program' || e.type === 'program');
  if ((/\b(apa\s+itu|pengertian|definisi|profil|tentang|penjelasan|deskripsi|belajar\s+apa|mempelajari\s+apa|fokus(?:nya)?(?:\s+apa|\s+jurusan)?|kuliah\s+tentang\s+apa|prospek(?:nya)?|peluang\s+kerja|lulusan(?:nya)?\s+(?:bisa\s+)?jadi\s+apa|lulusan|kerja\s+(?:sebagai\s+)?apa|jadi\s+apa|profesi|karir|karier|gelar(?:nya)?)\b/i.test(normalized) && hasAcademicProgram) ||
      (/\b(apa\s+itu\s+program\s+studi|profil\s+prodi|profil\s+program\s+studi)\b/i.test(normalized))) {
    const isDegreeInquiry = /\b(gelar(?:nya)?)\b/i.test(normalized);
    return {
      domain: 'ACADEMIC_PROGRAM',
      intent: isDegreeInquiry ? 'DEGREE_AWARD' : 'PROGRAM_OVERVIEW',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: isDegreeInquiry ? 'PROVIDE_DEGREE_INFO' : 'PROVIDE_PROGRAM_OVERVIEW',
      aspects: isDegreeInquiry ? ['degree_award', 'overview'] : ['overview', 'definition'],
      relation: isDegreeInquiry ? 'DEGREE_AWARD' : 'PROGRAM_OVERVIEW'
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

  // 7. Scholarship Inquiry
  if (/\b(beasiswa(?:nya)?|kip\s*kuliah|kip-?k|potongan\s+dpp|keringanan\s+biaya|bantuan\s+dana\s+pendidikan)\b/i.test(normalized)) {
    return {
      domain: 'SCHOLARSHIP',
      intent: 'SCHOLARSHIP_INQUIRY',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_SCHOLARSHIP_INFO',
      aspects: ['scholarship', 'requirements', 'discount'],
      relation: 'SCHOLARSHIP_INFO'
    };
  }

  // 8. Facilities Inquiry
  if (/\b(fasilitas(?:nya)?|laboratorium(?:nya)?|lab(?:nya)?|perpustakaan|asrama|dormitory|ruang\s+kelas|gedung\s+kampus)\b/i.test(normalized)) {
    return {
      domain: 'FACILITIES',
      intent: 'FACILITY_INQUIRY',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_FACILITY_INFO',
      aspects: ['facilities', 'lab', 'campus_infrastructure'],
      relation: 'CAMPUS_FACILITIES'
    };
  }

  // 9. Organization & UKM Inquiry
  if (/\b(ukm\b|unit\s+kegiatan\s+mahasiswa|organisasi\s+mahasiswa|ormawa|hima\b|himaprodi|senat\s+mahasiswa|balma|ekstrakurikuler)\b/i.test(normalized) ||
      /\b(gaming|game|gamer|esport|esports|e-sports|futsal|basket|badminton|bulutangkis|paduan\s+suara|teater|tari|robotik|ksl)\b/i.test(normalized)) {
    const isEsports = /\b(gaming|game|gamer|esport|esports|e-sports)\b/i.test(normalized);
    const isSport = /\b(olahraga|futsal|basket|bulutangkis|badminton|fitness|gym)\b/i.test(normalized);
    const isArts = /\b(seni|budaya|tari|musik|band|teater|paduan\s+suara|fotografi)\b/i.test(normalized);
    const isTech = /\b(penalaran|robotika|linux|coding|pemrograman|syntax)\b/i.test(normalized);

    const aspects = ['student_organization', 'activities', 'ukm'];
    let relation = 'STUDENT_ORGANIZATION';
    if (isEsports) {
      aspects.push('esports_gaming');
      relation = 'UKM_ESPORTS_GAMING';
    } else if (isSport) {
      aspects.push('sports');
      relation = 'UKM_SPORTS';
    } else if (isArts) {
      aspects.push('arts_culture');
      relation = 'UKM_ARTS_CULTURE';
    } else if (isTech) {
      aspects.push('reasoning_tech');
      relation = 'UKM_REASONING_TECH';
    }

    return {
      domain: 'ORGANIZATION_UKM',
      intent: 'ORGANIZATION_INQUIRY',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_ORGANIZATION_INFO',
      aspects,
      relation
    };
  }

  // 10. Career Center & Internship & Industry Cooperation
  if (/\b(career\s+center|cdc\b|inbis|inkubator\s+bisnis|magang|internship|campus\s+hiring|kerja\s+sama\s+industri|penyaluran\s+kerja|sertifikasi|training)\b/i.test(normalized)) {
    return {
      domain: 'CAREER_CENTER',
      intent: 'CAREER_CENTER_INQUIRY',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_CAREER_CENTER_INFO',
      aspects: ['internship', 'career_services', 'cooperation'],
      relation: 'CAREER_SERVICES'
    };
  }

  // 11. Tuition Fee / Biaya Kuliah (Prioritized before PMB schedule when cost/fee is asked)
  if (/\b(biaya(?:nya)?|biaya kuliah|spp(?:nya)?|dpp(?:nya)?|uang\s+kuliah(?:nya)?|uang\s+pangkal|bayar\s+kuliah|bayar\s+berapa|angsuran|potongan\s+biaya|cicilan)\b/i.test(normalized)) {
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

  // 12. Admission / PMB Schedule & General Topic Opener
  if (/\b(pmb|pendaftaran|daftar|gelombang|buka|masih dibuka|kapan buka|jalur pendaftaran|mulai dari mana|proses masuk|cara masuk)\b/i.test(normalized)) {
    const isNow = TEMPORAL_NOW_REGEX.test(normalized);
    if (isNow) {
      return {
        domain: 'PMB',
        intent: 'CURRENT_ENROLLMENT_STATUS',
        retrievalRequired: true,
        userState: 'INQUIRING',
        desiredAction: 'PROVIDE_PMB_STATUS',
        aspects: ['schedule', 'status', 'wave_info'],
        relation: 'ADMISSION_WINDOW'
      };
    }

    const isProcedureOrRequirements = /\b(cara\s+daftar|bagaimana\s+(?:cara\s+)?daftar|syarat\s+pendaftaran|prosedur\s+pendaftaran|alur\s+pendaftaran|syarat\s+daftar|persyaratan\s+daftar|dokumen\s+pendaftaran|berkas\s+pendaftaran|mulai\s+dari\s+mana|proses\s+masuk|cara\s+masuk)\b/i.test(normalized);
    const isTopicOpener = isProcedureOrRequirements ||
      /\b(saya\s+ingin\s+bertanya\s+tentang\s+pmb|mau\s+tanya\s+pmb|info\s+pmb|tentang\s+pmb|informasi\s+pmb|bagaimana\s+pmb|pendaftaran\s+stikom|daftar\s+stikom)\b/i.test(normalized) ||
      (!/\b(gelombang|kapan|jadwal|tanggal|buka sampai|periode)\b/i.test(normalized) && /\b(pmb|pendaftaran)\b/i.test(normalized) && !/\b(biaya|bayar|kurikulum|beasiswa)\b/i.test(normalized));

    if (isTopicOpener) {
      return {
        domain: 'PMB',
        intent: isProcedureOrRequirements ? 'ADMISSION_PROCEDURE' : 'GENERAL_PMB_INQUIRY',
        retrievalRequired: true,
        userState: 'INQUIRING',
        desiredAction: isProcedureOrRequirements ? 'PROVIDE_ADMISSION_PROCEDURE' : 'PROVIDE_GENERAL_PMB_OVERVIEW',
        aspects: isProcedureOrRequirements ? ['procedure', 'requirements', 'documents'] : ['admission_overview', 'procedure', 'admission_pathways'],
        relation: 'PMB_OVERVIEW'
      };
    }

    return {
      domain: 'PMB',
      intent: 'ADMISSION_SCHEDULE',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_PMB_STATUS',
      aspects: ['schedule', 'status', 'wave_info'],
      relation: 'ADMISSION_WINDOW'
    };
  }

  // 13. Academic Graduation Requirement (SKS lulus)
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

  // 14. Program Comparison (Perbedaan Prodi)
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

  // 15. Accreditation
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

  let domain = inferred.domain;
  let intent = inferred.intent;

  // Invariant: Campus-wide facilities/UKM or Conversational MUST NOT inherit academic program entities
  const isProgramSpecificDomain = ['ACADEMIC_CURRICULUM', 'TUITION_FEE', 'ACADEMIC_PROGRAM'].includes(domain);
  const isCampusWideDomain = ['FACILITIES', 'ORGANIZATION_UKM', 'CAREER_CENTER', 'CONVERSATIONAL'].includes(domain);

  if (entities.length === 0 && contextDep.shouldInherit && contextDep.inheritedEntity && !isCampusWideDomain) {
    const inheritedCanon = findCanonicalEntity(contextDep.inheritedEntity);
    if (inheritedCanon && inheritedCanon.family === 'academic_program' && isProgramSpecificDomain) {
      entities.push({
        canonical: inheritedCanon.canonical,
        type: inheritedCanon.type,
        family: inheritedCanon.family,
        inherited: true
      });
    }
  }

  if (contextDep.shouldInherit && contextDep.inheritedDomain && domain === 'GENERAL') {
    domain = contextDep.inheritedDomain;
  }

  // Inject degree scope entity for available programs list if no entity present
  if (inferred.intent === 'AVAILABLE_PROGRAMS_LIST' && entities.length === 0) {
    if (inferred.scopeLevel === 'S1') {
      entities.push({ canonical: 'Program Sarjana (S1)', type: 'academic_scope', family: 'academic_scope', degree: 'S1' });
    } else if (inferred.scopeLevel === 'S2') {
      entities.push({ canonical: 'Program Pascasarjana (S2)', type: 'academic_scope', family: 'academic_scope', degree: 'S2' });
    } else if (inferred.scopeLevel === 'D3') {
      entities.push({ canonical: 'Program Diploma (D3)', type: 'academic_scope', family: 'academic_scope', degree: 'D3' });
    }
  }

  // Detect additional requested aspects
  const combinedAspects = new Set(inferred.aspects || []);
  if (/\b(prospek(?:nya)?|peluang\s+kerja|karir|karier|profesi\s+lulusan)\b/i.test(normalized)) {
    combinedAspects.add('career_prospects');
  }
  if (/\b(kurikulum(?:nya)?|mata\s*kuliah|matkul|sks)\b/i.test(normalized)) {
    combinedAspects.add('curriculum');
  }
  if (/\b(biaya(?:nya)?|spp|dpp|uang\s+pangkal)\b/i.test(normalized)) {
    combinedAspects.add('fee');
  }
  if (/\b(beasiswa(?:nya)?|potongan\s+dpp|keringanan)\b/i.test(normalized)) {
    combinedAspects.add('scholarship');
  }
  if (/\b(fasilitas(?:nya)?|lab\b|laboratorium)\b/i.test(normalized)) {
    combinedAspects.add('facilities');
  }
  if (/\b(akreditasi(?:nya)?)\b/i.test(normalized)) {
    combinedAspects.add('akreditasi');
  }
  const finalAspects = Array.from(combinedAspects);

  return {
    rawQuery: raw,
    normalizedQuery: normalized,
    domain,
    intent,
    retrievalRequired: inferred.retrievalRequired !== false,
    entities,
    relation: inferred.relation,
    aspects: finalAspects,
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
