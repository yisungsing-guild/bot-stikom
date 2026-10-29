'use strict';

/**
 * src/core/academicCatalog.js
 *
 * Greenfield Institutional Academic Program Catalog & Degree Scope Mechanism.
 * Phase 2B-1 Contract:
 * - Single shared catalog filter mechanism across degree scopes.
 * - Consistent normalization of Indonesian and English scope aliases.
 * - Verified degree metadata grounding (S1 / Bachelor, D3 / Diploma, S2 / Master, ALL).
 * - Enforces degree boundaries strictly:
 *   * S1 strictly produces only S1 bachelor programs.
 *   * D3 strictly produces only D3 diploma programs.
 *   * S2 strictly produces only S2 master programs.
 *   * ALL encompasses all officially offered degrees.
 *   * Unknown / unsupported scopes (e.g. S3, D4) are NEVER silently broadened to ALL.
 */

const { CANONICAL_ENTITIES } = require('../engine/canonicalEntityRegistry');
const { ACADEMIC_SCOPE_STATUS } = require('../reasoning/contracts');

const SUPPORTED_CANONICAL_DEGREES = Object.freeze(['S1', 'D3', 'S2', 'ALL']);

const UNSUPPORTED_DEGREE_PATTERN = /\b(?:s[- ]?3|doktor(?:al)?|doctor(?:al|ate)?|ph\.?d|d[- ]?4|diploma\s*[- ]?4|diploma\s*[- ]?iv|sarjana\s+terapan|d[- ]?1|d[- ]?2|diploma\s*[- ]?1|diploma\s*[- ]?2|smk|sma)\b/i;

/**
 * Resolves an academic degree scope request into an unambiguous structured contract.
 *
 * Distinguishes 3 mutually exclusive states:
 * - UNSPECIFIED: User made no explicit degree request (e.g. general catalog inquiry).
 * - SUPPORTED: User requested an officially offered degree (S1, D3, S2, or explicit ALL).
 * - UNSUPPORTED: User explicitly requested an unoffered degree (S3, D4, SMK, etc.).
 *
 * @param {string|Object} input - Raw scope string, semantic frame, or query text.
 * @returns {{
 *   status: 'UNSPECIFIED' | 'SUPPORTED' | 'UNSUPPORTED',
 *   level: 'S1' | 'D3' | 'S2' | 'ALL' | null,
 *   rawMention: string | null,
 *   isSupported: boolean
 * }}
 */
function resolveAcademicScope(input) {
  if (!input) {
    return {
      status: ACADEMIC_SCOPE_STATUS.UNSPECIFIED,
      level: null,
      rawMention: null,
      isSupported: false
    };
  }

  // If already resolved contract object
  if (typeof input === 'object' && input.status && Object.values(ACADEMIC_SCOPE_STATUS).includes(input.status)) {
    return input;
  }

  let text = '';
  if (typeof input === 'object') {
    if (input.academicScope && typeof input.academicScope === 'object' && input.academicScope.status) {
      return input.academicScope;
    }
    const explicit = input.scopeLevel || input.academicLevel;
    if (explicit && typeof explicit === 'string') {
      text = explicit;
    } else {
      text = input.rawQuery || input.normalizedQuery || '';
    }
  } else if (typeof input === 'string') {
    text = input;
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return {
      status: ACADEMIC_SCOPE_STATUS.UNSPECIFIED,
      level: null,
      rawMention: null,
      isSupported: false
    };
  }

  // 1. Check for explicit unsupported/unoffered degree mention
  const unsuppMatch = trimmed.match(UNSUPPORTED_DEGREE_PATTERN);
  if (unsuppMatch) {
    return {
      status: ACADEMIC_SCOPE_STATUS.UNSUPPORTED,
      level: null,
      rawMention: unsuppMatch[0],
      isSupported: false
    };
  }

  const lower = trimmed.toLowerCase();

  // 2. Check for explicit supported degrees
  // S1 / Sarjana / Bachelor / Undergraduate
  if (/\b(?:s[- ]?1|sarjana|bachelor(?:'s)?|undergraduate|strata\s*[- ]?1)\b/i.test(lower) &&
      !/\b(?:s[- ]?2|d[- ]?3|master|graduate|postgraduate|diploma|associate)\b/i.test(lower)) {
    return {
      status: ACADEMIC_SCOPE_STATUS.SUPPORTED,
      level: 'S1',
      rawMention: 'S1',
      isSupported: true
    };
  }

  // D3 / Diploma / Associate
  if (/\b(?:d[- ]?3|diploma(?:\s*[- ]?3)?|associate(?:'s)?|vokasi|ahli\s*[- ]?madya)\b/i.test(lower)) {
    return {
      status: ACADEMIC_SCOPE_STATUS.SUPPORTED,
      level: 'D3',
      rawMention: 'D3',
      isSupported: true
    };
  }

  // S2 / Master / Postgraduate
  if (/\b(?:s[- ]?2|magister|master(?:'s)?|graduate|postgraduate|post-graduate|pascasarjana|strata\s*[- ]?2)\b/i.test(lower)) {
    return {
      status: ACADEMIC_SCOPE_STATUS.SUPPORTED,
      level: 'S2',
      rawMention: 'S2',
      isSupported: true
    };
  }

  // ALL / Institutional / Complete Catalog
  if (/^(?:all|semua|lengkap|seluruh|institutional|any|general|semuanya)$/i.test(lower) ||
      /\b(?:semua\s+(?:jenjang|program|prodi)|seluruh\s+(?:jenjang|program)|all\s+(?:academic\s+)?degrees?|all\s+programs?)\b/i.test(lower)) {
    return {
      status: ACADEMIC_SCOPE_STATUS.SUPPORTED,
      level: 'ALL',
      rawMention: 'ALL',
      isSupported: true
    };
  }

  return {
    status: ACADEMIC_SCOPE_STATUS.UNSPECIFIED,
    level: null,
    rawMention: null,
    isSupported: false
  };
}

/**
 * Normalizes user/system scope level representations into canonical academic degree scopes.
 * Consistently handles Indonesian and English terms:
 * - 'S1': S1, Sarjana, Bachelor, Undergraduate, Strata 1
 * - 'D3': D3, Diploma, Diploma 3, Associate, Vokasi, Ahli Madya
 * - 'S2': S2, Magister, Master, Graduate, Postgraduate, Pascasarjana, Strata 2
 * - 'ALL': ALL, Semua, Lengkap, Seluruh, Institutional, Any, General
 * Returns null if the scope is unrecognized or unsupported.
 *
 * @param {string|Object} rawScope
 * @returns {'S1' | 'D3' | 'S2' | 'ALL' | null}
 */
function normalizeAcademicScope(rawScope) {
  const resolved = resolveAcademicScope(rawScope);
  if (resolved.status === ACADEMIC_SCOPE_STATUS.SUPPORTED) {
    return resolved.level;
  }
  return null;
}

/**
 * Verified institutional catalog representation with degree metadata.
 * Grounded in official institutional curriculum guides and verified against CANONICAL_ENTITIES.
 */
const INSTITUTIONAL_ACADEMIC_CATALOG = Object.freeze([
  {
    id: 's1_si',
    canonical: 'S1 Sistem Informasi',
    nameEn: 'S1 Information Systems (Sistem Informasi)',
    degree: 'S1',
    degreeTitle: 'Sarjana Komputer (S.Kom)',
    sks: 144,
    semesters: 8,
    focusId: 'Fokus pada perancangan sistem enterprise, tata kelola TI, basis data, dan analisis bisnis digital.',
    focusEn: 'Focuses on enterprise systems, IT governance, database management, and digital business analytics.',
    provenance: 'Pedoman Akademik & Kurikulum S1 Sistem Informasi ITB STIKOM Bali'
  },
  {
    id: 's1_sk',
    canonical: 'S1 Sistem Komputer',
    nameEn: 'S1 Computer Systems (Sistem Komputer)',
    degree: 'S1',
    degreeTitle: 'Sarjana Komputer (S.Kom)',
    sks: 144,
    semesters: 8,
    focusId: 'Fokus pada perangkat keras (hardware), Internet of Things (IoT), embedded system, robotika, dan keamanan jaringan.',
    focusEn: 'Focuses on hardware engineering, Internet of Things (IoT), embedded systems, robotics, and network security.',
    provenance: 'Pedoman Akademik & Kurikulum S1 Sistem Komputer ITB STIKOM Bali'
  },
  {
    id: 's1_ti',
    canonical: 'S1 Teknologi Informasi',
    nameEn: 'S1 Information Technology (Teknologi Informasi)',
    degree: 'S1',
    degreeTitle: 'Sarjana Komputer (S.Kom)',
    sks: 144,
    semesters: 8,
    focusId: 'Fokus pada keamanan siber (cyber security), integrasi sistem ICT, cloud computing, dan infrastruktur jaringan.',
    focusEn: 'Focuses on cyber security, ICT system integration, cloud computing, and network infrastructure.',
    provenance: 'Pedoman Akademik & Kurikulum S1 Teknologi Informasi ITB STIKOM Bali'
  },
  {
    id: 's1_bd',
    canonical: 'S1 Bisnis Digital',
    nameEn: 'S1 Digital Business (Bisnis Digital)',
    degree: 'S1',
    degreeTitle: 'Sarjana Bisnis (S.Bns)',
    sks: 144,
    semesters: 8,
    focusId: 'Fokus pada inovasi bisnis berbasis teknologi, e-commerce, digital marketing, analitika bisnis, dan pengembangan startup.',
    focusEn: 'Focuses on tech-driven business innovation, e-commerce, digital marketing, business analytics, and startup development.',
    provenance: 'Pedoman Akademik & Kurikulum S1 Bisnis Digital ITB STIKOM Bali'
  },
  {
    id: 'd3_mi',
    canonical: 'D3 Manajemen Informatika',
    nameEn: 'D3 Informatics Management (Manajemen Informatika)',
    degree: 'D3',
    degreeTitle: 'Ahli Madya Komputer (A.Md.Kom)',
    sks: 108,
    semesters: 6,
    focusId: 'Fokus pada aplikasi terapan teknologi informasi, operasional bisnis, pengolahan data, administrasi sistem informasi, dan IT support praktis.',
    focusEn: 'Focuses on applied information technology applications, business operations, data processing, information systems administration, and practical IT support.',
    provenance: 'Pedoman Akademik & Kurikulum D3 Manajemen Informatika ITB STIKOM Bali'
  },
  {
    id: 's2_si',
    canonical: 'S2 Magister Sistem Informasi (M.Kom)',
    canonicalRegistryName: 'S2 Sistem Informasi',
    nameEn: 'S2 Master of Information Systems (Magister Sistem Informasi - M.Kom)',
    degree: 'S2',
    degreeTitle: 'Magister Komputer (M.Kom)',
    sks: 36,
    semesters: 4,
    focusId: 'Fokus pada riset terapan sistem informasi tingkat lanjut, arsitektur enterprise, kepemimpinan teknologi strategis, dan tata kelola TI tingkat magister.',
    focusEn: 'Focuses on advanced applied information systems research, enterprise architecture, strategic IT leadership, and master-level IT governance.',
    provenance: 'Pedoman Akademik Program Magister (S2) Sistem Informasi ITB STIKOM Bali'
  }
]);

// Cross-reference runtime verification against CANONICAL_ENTITIES to guarantee integrity
const VERIFIED_PROGRAM_ENTITIES = new Set(
  CANONICAL_ENTITIES
    .filter(e => e.family === 'academic_program' && (e.canonical.startsWith('S') || e.canonical.startsWith('D')))
    .map(e => e.canonical)
);

/**
 * Shared filter mechanism applying verified degree scope to institutional catalog entries.
 *
 * @param {string} rawScope - The requested scope ('S1', 'D3', 'S2', 'ALL', or alias)
 * @returns {Array<Object>} List of matching catalog entries. Empty if scope is unknown/unsupported.
 */
function getCatalogEntriesByScope(rawScope) {
  const canonicalScope = normalizeAcademicScope(rawScope);
  if (!canonicalScope) {
    // Contract: Unrecognized or unsupported scope must NEVER broaden to ALL or invent ungrounded programs
    return [];
  }

  if (canonicalScope === 'ALL') {
    return INSTITUTIONAL_ACADEMIC_CATALOG.filter(entry => {
      const matchName = entry.canonicalRegistryName || entry.canonical;
      return VERIFIED_PROGRAM_ENTITIES.has(matchName);
    });
  }

  return INSTITUTIONAL_ACADEMIC_CATALOG.filter(entry => {
    const matchName = entry.canonicalRegistryName || entry.canonical;
    return entry.degree === canonicalScope && VERIFIED_PROGRAM_ENTITIES.has(matchName);
  });
}

/**
 * Generates an evidence-grounded summary text for the requested catalog scope.
 *
 * @param {string} canonicalScope - 'S1' | 'D3' | 'S2' | 'ALL'
 * @param {string} userLang - 'id' | 'en'
 * @returns {string|null} Grounded summary text, or null if scope is unsupported or empty.
 */
function generateGroundedCatalogSummary(canonicalScope, userLang = 'id') {
  const isEn = userLang === 'en';
  const resolved = resolveAcademicScope(canonicalScope);
  const effectiveScope = resolved.status === ACADEMIC_SCOPE_STATUS.SUPPORTED ? resolved.level : normalizeAcademicScope(canonicalScope);
  const entries = getCatalogEntriesByScope(effectiveScope);

  if (!entries || entries.length === 0) {
    // Contract: Do NOT produce ungrounded factual lists without supported catalog sources
    return null;
  }

  if (effectiveScope === 'S1') {
    if (isEn) {
      const items = entries.map((e, idx) => `${idx + 1}. **${e.nameEn}**\n   ${e.focusEn}`).join('\n');
      return `At ITB STIKOM Bali, there are 4 **Undergraduate (Bachelor/S1)** study programs available:\n\n${items}\n\nAll undergraduate (S1) programs consist of 144 credits (8 semesters). Both regular and evening/worker classes are available. Registration can be completed online at https://pmb.stikom-bali.ac.id. Are you interested in any of these programs?`;
    }
    const items = entries.map((e, idx) => `${idx + 1}. **${e.canonical}**\n   ${e.focusId}`).join('\n');
    return `Di ITB STIKOM Bali, ada 4 pilihan **Program Sarjana (S1)** yang bisa Kakak pilih:\n\n${items}\n\nSemua program S1 berbeban studi 144 SKS (8 semester). Tersedia kelas reguler maupun kelas sore/karyawan bagi yang kuliah sambil bekerja. Pendaftaran dapat diakses di https://pmb.stikom-bali.ac.id. Tertarik dengan salah satu prodi di atas?`;
  }

  if (effectiveScope === 'D3') {
    if (isEn) {
      const items = entries.map((e, idx) => `${idx + 1}. **${e.nameEn}**\n   ${e.focusEn}`).join('\n');
      return `At ITB STIKOM Bali, the available **Diploma (D3)** study program is:\n\n${items}\n\nThe Diploma (D3) program consists of 108 credits (6 semesters) with an applied, hands-on curriculum. Registration can be completed online at https://pmb.stikom-bali.ac.id. Would you like to know more about this D3 program?`;
    }
    const items = entries.map((e, idx) => `${idx + 1}. **${e.canonical}**\n   ${e.focusId}`).join('\n');
    return `Di ITB STIKOM Bali, tersedia pilihan **Program Diploma (D3)**:\n\n${items}\n\nProgram Diploma (D3) berbeban studi 108 SKS (6 semester) dengan kurikulum terapan yang siap kerja. Pendaftaran dapat diakses di https://pmb.stikom-bali.ac.id. Ada yang ingin Kakak tanyakan seputar prodi D3 ini?`;
  }

  if (effectiveScope === 'S2') {
    if (isEn) {
      const items = entries.map((e, idx) => `${idx + 1}. **${e.nameEn}**\n   ${e.focusEn}`).join('\n');
      return `At ITB STIKOM Bali, the available **Postgraduate (Master/S2)** study program is:\n\n${items}\n\nThe Master (S2) program consists of 36 credits (4 semesters). Registration can be completed online at https://pmb.stikom-bali.ac.id. Would you like more information about the Master's program?`;
    }
    const items = entries.map((e, idx) => `${idx + 1}. **${e.canonical}**\n   ${e.focusId}`).join('\n');
    return `Di ITB STIKOM Bali, tersedia pilihan **Program Pascasarjana (S2)**:\n\n${items}\n\nProgram Magister (S2) berbeban studi 36 SKS (4 semester). Pendaftaran dapat diakses di https://pmb.stikom-bali.ac.id. Tertarik untuk melanjutkan studi S2 di ITB STIKOM Bali?`;
  }

  if (effectiveScope === 'ALL') {
    const s1List = entries.filter(e => e.degree === 'S1').map((e, idx) => `  ${idx + 1}. ${e.canonical}`).join('\n');
    const d3List = entries.filter(e => e.degree === 'D3').map((e, idx) => `  ${idx + 1}. ${e.canonical}`).join('\n');
    const s2List = entries.filter(e => e.degree === 'S2').map((e, idx) => `  ${idx + 1}. ${e.canonical}`).join('\n');

    if (isEn) {
      const s1ListEn = entries.filter(e => e.degree === 'S1').map((e, idx) => `  ${idx + 1}. S1 ${e.canonical.replace(/^S1\s+/, '')}`).join('\n');
      const d3ListEn = entries.filter(e => e.degree === 'D3').map((e, idx) => `  ${idx + 1}. D3 ${e.canonical.replace(/^D3\s+/, '')}`).join('\n');
      const s2ListEn = entries.filter(e => e.degree === 'S2').map((e, idx) => `  ${idx + 1}. S2 ${e.canonical.replace(/^S2\s+/, '')}`).join('\n');
      return `ITB STIKOM Bali offers study programs across the following degree levels:\n\n• **Program Sarjana (S1)**:\n${s1ListEn}\n\n• **Program Diploma (D3)**:\n${d3ListEn}\n\n• **Program Pascasarjana (S2)**:\n${s2ListEn}\n\n• **Program Kelas Internasional**:\n  1. International Dual Degree (in collaboration with overseas partner universities)\n\nRegistration can be accessed via the official portal https://pmb.stikom-bali.ac.id. If you would like to know tuition fees or curriculum details for a specific program, feel free to ask!`;
    }

    return `ITB STIKOM Bali menyelenggarakan program studi di berbagai jenjang berikut:\n\n• **Program Sarjana (S1)**:\n${s1List}\n\n• **Program Diploma (D3)**:\n${d3List}\n\n• **Program Pascasarjana (S2)**:\n${s2List}\n\n• **Program Kelas Internasional**:\n  1. International Dual Degree (bekerja sama dengan mitra luar negeri)\n\nPendaftaran dapat diakses melalui portal resmi https://pmb.stikom-bali.ac.id. Jika Kakak ingin mengetahui rincian biaya atau kurikulum prodi tertentu, silakan tanyakan ya!`;
  }

  return null;
}

/**
 * Authoritative Institutional Faculty definitions grounded in official institutional documents.
 */
const INSTITUTIONAL_FACULTIES = Object.freeze([
  {
    id: 'fik',
    canonical: 'Fakultas Informatika dan Komputer',
    shortName: 'FIK',
    aliases: ['fik', 'fakultas informatika dan komputer', 'fakultas informatika', 'fakultas komputer', 'infokom', 'fakultas teknologi informasi', 'fakultas ti'],
    programs: [
      'S1 Sistem Informasi',
      'S1 Sistem Komputer',
      'S1 Teknologi Informasi',
      'S2 Magister Sistem Informasi (M.Kom)'
    ]
  },
  {
    id: 'fbv',
    canonical: 'Fakultas Bisnis dan Vokasi',
    shortName: 'FBV',
    aliases: ['fbv', 'fakultas bisnis dan vokasi', 'fakultas bisnis', 'fakultas vokasi', 'bisvo', 'bisnis dan vokasi'],
    programs: [
      'S1 Bisnis Digital',
      'D3 Manajemen Informatika'
    ]
  }
]);

function resolveFaculty(input) {
  if (!input) return null;
  const str = (typeof input === 'string' ? input : (input.rawQuery || input.normalizedQuery || '')).toLowerCase();
  for (const fac of INSTITUTIONAL_FACULTIES) {
    if (str.includes(fac.canonical.toLowerCase()) || str.includes(fac.shortName.toLowerCase())) {
      return fac;
    }
    if (fac.aliases.some(a => new RegExp(`\\b${a.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i').test(str))) {
      return fac;
    }
  }
  return null;
}

function getFacultyForProgram(programName) {
  if (!programName) return null;
  const pLower = String(programName).toLowerCase().trim();

  // Guard against ambiguous solitary 'teknologi' query being misidentified as S1 Teknologi Informasi
  if (/\bteknologi\b/i.test(pLower) && !/\b(?:teknologi\s+informasi|ti)\b/i.test(pLower)) {
    return null;
  }

  for (const fac of INSTITUTIONAL_FACULTIES) {
    for (const prog of fac.programs) {
      const progClean = prog.toLowerCase().replace(/^(s1|d3|s2)\s+/i, '');
      if (pLower.includes(prog.toLowerCase()) || pLower.includes(progClean)) {
        return fac;
      }
    }
  }
  return null;
}

function getProgramsForFaculty(facultyNameOrId) {
  const fac = resolveFaculty(facultyNameOrId);
  return fac ? fac.programs : [];
}

function generateGroundedFacultySummary(query, userLang = 'id') {
  const isEn = userLang === 'en';
  const qLower = String(query || '').toLowerCase();

  // 1. Guard against ambiguous "Teknologi" inquiries without "Informasi" - ask for clarification
  const isAmbiguousTeknologi = /\bteknologi\b/i.test(qLower) &&
    !/\b(?:teknologi\s+informasi|ti)\b/i.test(qLower) &&
    /\b(?:masuk|fakultas|jurusan|prodi|bagian|bernaung|di\s+bawah)\b/i.test(qLower);

  if (isAmbiguousTeknologi) {
    if (isEn) {
      return `Could you please clarify which study program you are referring to? At ITB STIKOM Bali, are you asking about **S1 Information Technology (Teknologi Informasi)** (under the **Faculty of Informatics and Computer / FIK**), or another program? Please specify the study program name so I can provide the accurate faculty details.`;
    }
    return `Mohon klarifikasi program studi yang Kakak maksud. Di ITB STIKOM Bali, apakah yang Kakak maksud adalah program studi **S1 Teknologi Informasi** (bernaung di bawah **Fakultas Informatika dan Komputer / FIK**), atau program studi lainnya? Mohon sebutkan nama program studi secara spesifik agar Tiko dapat memberikan informasi fakultas yang tepat.`;
  }

  // 2. Check if query asks for both faculties (FIK and FBV) or overall faculty-program division
  const mentionsFIK = /\b(?:fik|fakultas\s+informatika|informatika\s+dan\s+komputer|infokom)\b/i.test(qLower);
  const mentionsFBV = /\b(?:fbv|fakultas\s+bisnis|bisnis\s+dan\s+vokasi|bisvo)\b/i.test(qLower);
  const asksBothFaculties = (mentionsFIK && mentionsFBV) ||
    (/\b(?:program\s+studi|prodi|jurusan)\b/i.test(qLower) && /\b(?:di\s+fik|di\s+fbv)\b/i.test(qLower) && /\b(?:dan|serta|maupun)\b/i.test(qLower));

  if (asksBothFaculties) {
    if (isEn) {
      return `At ITB STIKOM Bali, the study programs under **FIK** and **FBV** are as follows:\n\n` +
        `1. **Fakultas Informatika dan Komputer (FIK / INFOKOM)**:\n` +
        `   • S1 Sistem Informasi\n` +
        `   • S1 Sistem Komputer\n` +
        `   • S1 Teknologi Informasi\n` +
        `   • S2 Magister Sistem Informasi (M.Kom)\n\n` +
        `2. **Fakultas Bisnis dan Vokasi (FBV / BISVO)**:\n` +
        `   • S1 Bisnis Digital\n` +
        `   • D3 Manajemen Informatika\n\n` +
        `Registration can be completed online at https://pmb.stikom-bali.ac.id. Would you like more details about a specific study program?`;
    }
    return `Di ITB STIKOM Bali, pembagian program studi di bawah **FIK** dan **FBV** adalah sebagai berikut:\n\n` +
      `1. **Fakultas Informatika dan Komputer (FIK / INFOKOM)**:\n` +
      `   • S1 Sistem Informasi\n` +
      `   • S1 Sistem Komputer\n` +
      `   • S1 Teknologi Informasi\n` +
      `   • S2 Magister Sistem Informasi (M.Kom)\n\n` +
      `2. **Fakultas Bisnis dan Vokasi (FBV / BISVO)**:\n` +
      `   • S1 Bisnis Digital\n` +
      `   • D3 Manajemen Informatika\n\n` +
      `Pendaftaran mahasiswa baru dapat diakses secara online di https://pmb.stikom-bali.ac.id. Ada program studi tertentu yang ingin Kakak ketahui lebih lanjut?`;
  }

  // 3. If asking which faculty a specific program belongs to
  const targetedFaculty = getFacultyForProgram(query);
  if (targetedFaculty) {
    let matchedProg = targetedFaculty.programs.find(p => {
      const clean = p.toLowerCase().replace(/^(s1|d3|s2)\s+/i, '');
      return qLower.includes(p.toLowerCase()) || qLower.includes(clean);
    }) || targetedFaculty.programs[0];

    const asksCareer = /\b(?:prospek|peluang\s+kerja|karir|karier|profesi|kerja\s+(?:sebagai|menjadi)?|bekerja\s+(?:sebagai|menjadi)?)\b/i.test(qLower);
    let careerSection = '';
    if (asksCareer) {
      if (/bisnis\s+digital/i.test(matchedProg)) {
        careerSection = isEn
          ? `\n\n• **Graduate Career Prospects**: Graduates of S1 Digital Business can pursue careers as Digital Business Specialists, Technopreneurs / Startup Founders, Digital Marketing Strategists, E-Commerce Specialists, and Business Development Analysts.`
          : `\n\n• **Prospek Karier Lulusan**: Lulusan S1 Bisnis Digital memiliki peluang karier luas sebagai Digital Business Specialist, Technopreneur / Startup Founder, Digital Marketing Strategist, E-Commerce Specialist, Business Development Analyst, hingga Konsultan Bisnis Digital.`;
      } else if (/sistem\s+informasi/i.test(matchedProg)) {
        careerSection = isEn
          ? `\n\n• **Graduate Career Prospects**: Systems Analysts, IT Consultants, Business Process Analysts, Database Administrators, and IT Project Managers.`
          : `\n\n• **Prospek Karier Lulusan**: Systems Analyst, Konsultan TI, Business Process Analyst, Administrator Basis Data, ERP Specialist, dan IT Project Manager.`;
      }
    }

    if (isEn) {
      return `At ITB STIKOM Bali, the study program **${matchedProg}** is under the **${targetedFaculty.canonical} (${targetedFaculty.shortName})**.\n\nOther study programs under this faculty include:\n` +
        targetedFaculty.programs.map((p, idx) => `${idx + 1}. ${p}`).join('\n') +
        careerSection +
        `\n\nWould you like more details about admission or curriculum for this program?`;
    }
    return `Di ITB STIKOM Bali, program studi **${matchedProg}** bernaung di bawah **${targetedFaculty.canonical} (${targetedFaculty.shortName})**.\n\nProgram studi yang berada di bawah fakultas ini meliputi:\n` +
      targetedFaculty.programs.map((p, idx) => `${idx + 1}. ${p}`).join('\n') +
      careerSection +
      `\n\nAda yang ingin Kakak tanyakan lebih lanjut mengenai kurikulum atau pendaftaran prodi ini?`;
  }

  // 4. If asking what programs are under a single specific faculty (e.g. FBV or FIK)
  const resolvedFac = resolveFaculty(query);
  if (resolvedFac) {
    if (isEn) {
      return `At ITB STIKOM Bali, the **${resolvedFac.canonical} (${resolvedFac.shortName})** oversees the following study programs:\n\n` +
        resolvedFac.programs.map((p, idx) => `${idx + 1}. **${p}**`).join('\n') +
        `\n\nRegistration is open at https://pmb.stikom-bali.ac.id. Are you interested in any of these programs?`;
    }

    return `Di ITB STIKOM Bali, **${resolvedFac.canonical} (${resolvedFac.shortName})** menaungi program studi berikut:\n\n` +
      resolvedFac.programs.map((p, idx) => `${idx + 1}. **${p}**`).join('\n') +
      `\n\nPendaftaran dapat diakses secara online di https://pmb.stikom-bali.ac.id. Tertarik dengan salah satu prodi di atas?`;
  }

  // 5. Overall faculty overview at ITB STIKOM Bali
  if (isEn) {
    return `ITB STIKOM Bali has 2 official faculties overseeing its academic study programs:\n\n` +
      `1. **Fakultas Informatika dan Komputer (FIK / INFOKOM)**:\n` +
      `   • S1 Sistem Informasi\n` +
      `   • S1 Sistem Komputer\n` +
      `   • S1 Teknologi Informasi\n` +
      `   • S2 Magister Sistem Informasi (M.Kom)\n\n` +
      `2. **Fakultas Bisnis dan Vokasi (FBV / BISVO)**:\n` +
      `   • S1 Bisnis Digital\n` +
      `   • D3 Manajemen Informatika\n\n` +
      `Would you like to know more about a specific faculty or study program?`;
  }
  return `ITB STIKOM Bali memiliki 2 fakultas resmi yang menaungi program-program studinya:\n\n` +
    `1. **Fakultas Informatika dan Komputer (FIK / INFOKOM)**:\n` +
    `   • S1 Sistem Informasi\n` +
    `   • S1 Sistem Komputer\n` +
    `   • S1 Teknologi Informasi\n` +
    `   • S2 Magister Sistem Informasi (M.Kom)\n\n` +
    `2. **Fakultas Bisnis dan Vokasi (FBV / BISVO)**:\n` +
    `   • S1 Bisnis Digital\n` +
    `   • D3 Manajemen Informatika\n\n` +
    `Apakah ada fakultas atau program studi tertentu yang ingin Kakak ketahui lebih lanjut?`;
}

module.exports = {
  ACADEMIC_SCOPE_STATUS,
  SUPPORTED_CANONICAL_DEGREES,
  INSTITUTIONAL_ACADEMIC_CATALOG,
  INSTITUTIONAL_FACULTIES,
  resolveAcademicScope,
  normalizeAcademicScope,
  getCatalogEntriesByScope,
  generateGroundedCatalogSummary,
  resolveFaculty,
  getFacultyForProgram,
  getProgramsForFaculty,
  generateGroundedFacultySummary
};
