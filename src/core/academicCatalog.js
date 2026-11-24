'use strict';

let CANONICAL_FACTS_REGISTRY = null;
try {
  CANONICAL_FACTS_REGISTRY = require('../../data/runtime/canonical_academic_facts_registry.json');
} catch (_) {
  CANONICAL_FACTS_REGISTRY = {};
}

const CURRICULUM_FACTS = CANONICAL_FACTS_REGISTRY?.curriculumFacts || {};
const D3_MI_FACTS = CURRICULUM_FACTS['D3 Manajemen Informatika'] || {};
const S2_SI_FACTS = CURRICULUM_FACTS['S2 Sistem Informasi'] || {};

// Dynamically hydrate verified curriculum courses across all academic programs from primary source records
// and index global corpus token document frequencies for discriminative specificity weighting
const CORPUS_TOKEN_DOCUMENT_FREQUENCY = new Map();
(function initCorpusTokenIndex() {
  const fs = require('fs');
  const path = require('path');
  const curriculumDir = path.join(__dirname, '../../knowledge/raw/curriculum_current_2025');

  const programFileMapping = {
    'S1 Sistem Informasi': 'SI_curriculum_verified_2025.json',
    'S1 Sistem Komputer': 'SK_curriculum_verified_2025.json',
    'S1 Teknologi Informasi': 'TI_curriculum_verified_2025.json',
    'S1 Bisnis Digital': 'BD_curriculum_verified_2023.json',
    'D3 Manajemen Informatika': 'MI_curriculum_verified_obe-2023.json'
  };

  for (const [progName, fileName] of Object.entries(programFileMapping)) {
    const filePath = path.join(curriculumDir, fileName);
    if (!fs.existsSync(filePath)) continue;
    try {
      const rawData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const parsedCourses = [];
      if (rawData.semesters) {
        for (const sem of Object.values(rawData.semesters)) {
          if (Array.isArray(sem.courses)) {
            for (const c of sem.courses) {
              parsedCourses.push({
                code: c.code || null,
                name: c.name,
                semester: sem.semester,
                sks: c.sks,
                sourceDocument: rawData.sourceFile || fileName,
                verificationStatus: 'VERIFIED_PRIMARY_SOURCE'
              });
            }
          }
        }
      } else if (Array.isArray(rawData.courses)) {
        for (const c of rawData.courses) {
          parsedCourses.push({
            code: c.code || null,
            name: c.name,
            semester: c.semester,
            sks: c.sks,
            sourceDocument: rawData.sourceFile || fileName,
            verificationStatus: 'VERIFIED_PRIMARY_SOURCE'
          });
        }
      }

      if (CURRICULUM_FACTS[progName]) {
        if (!Array.isArray(CURRICULUM_FACTS[progName].courses) || CURRICULUM_FACTS[progName].courses.length === 0) {
          CURRICULUM_FACTS[progName].courses = parsedCourses;
        }
      }

      const allProgCourses = (CURRICULUM_FACTS[progName]?.courses) || parsedCourses;
      for (const c of allProgCourses) {
        const words = String(c.name || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 1);
        const uniqueWords = new Set(words);
        for (const w of uniqueWords) {
          CORPUS_TOKEN_DOCUMENT_FREQUENCY.set(w, (CORPUS_TOKEN_DOCUMENT_FREQUENCY.get(w) || 0) + 1);
        }
      }
    } catch (_) {}
  }
})();

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
  // Note: High school/vocational applicant background ("lulusan smk", "alumni sma", etc.)
  // is an applicant prerequisite inquiry, NOT an offering of high school programs.
  const textWithoutApplicantBackground = trimmed.replace(
    /\b(?:lulusan|tamatan|alumni|dari|asal(?:\s+sekolah)?|ijazah)\s+(?:smk|sma|ma)\b/gi,
    ''
  ).replace(
    /\b(?:smk|sma|ma)\s+(?:bisa|dapat|boleh)\s+(?:daftar|masuk|kuliah)\b/gi,
    ''
  ).replace(
    /\b(?:untuk|bagi)\s+(?:lulusan\s+)?(?:smk|sma|ma)\b/gi,
    ''
  );

  const unsuppMatch = textWithoutApplicantBackground.match(UNSUPPORTED_DEGREE_PATTERN);
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
 * Institutional Catalog Fact Provenance Categories (Stage 3B.4.3).
 * Distinguishes the grounding authority and validity status of academic catalog claims.
 */
const CATALOG_FACT_PROVENANCE_STATUS = Object.freeze({
  VERIFIED_CURRENT: 'VERIFIED_CURRENT',
  VERIFIED_HISTORICAL: 'VERIFIED_HISTORICAL',
  UNVERIFIED_CURRENT: 'UNVERIFIED_CURRENT',
  ROUTING_REFERENCE: 'ROUTING_REFERENCE'
});

const S1_CATALOG_CLAIM_PROVENANCE = Object.freeze({
  programs: Object.freeze({
    status: CATALOG_FACT_PROVENANCE_STATUS.VERIFIED_CURRENT,
    sourceDocument: 'ISIAN WEBSITE (1).pdf',
    chunkId: '7b6e77d6',
    authorityTier: 1,
    description: 'Daftar 4 program studi Sarjana (S1): Sistem Informasi, Sistem Komputer, Teknologi Informasi, Bisnis Digital.'
  }),
  curriculumSksAndDuration: Object.freeze({
    status: CATALOG_FACT_PROVENANCE_STATUS.VERIFIED_CURRENT,
    sourceDocument: 'canonical_academic_facts_registry.json',
    authorityTier: 1,
    description: 'Beban studi normal 144 SKS dan 8 semester untuk seluruh program S1.'
  }),
  eveningOrWorkerClass: Object.freeze({
    status: CATALOG_FACT_PROVENANCE_STATUS.UNVERIFIED_CURRENT,
    historicalStatus: CATALOG_FACT_PROVENANCE_STATUS.VERIFIED_HISTORICAL,
    sourceDocument: 'FORMULIR APLIKAN / PENDAFTARAN (24 April 2026)',
    authorityTier: 3,
    activeChunkCount: 0,
    description: 'Opsi kelas sore/karyawan tercatat pada arsip formulir pendaftaran historis, belum terkonfirmasi aktif pada dokumen resmi TA 2026/2027.'
  }),
  pmbPortalUrl: Object.freeze({
    status: CATALOG_FACT_PROVENANCE_STATUS.ROUTING_REFERENCE,
    source: 'https://pmb.stikom-bali.ac.id',
    authorityTier: 1,
    description: 'Rujukan navigasi resmi pendaftaran mahasiswa baru.'
  })
});

function getCatalogClaimProvenance(claimKey) {
  return S1_CATALOG_CLAIM_PROVENANCE[claimKey] || null;
}

/**
 * Canonical Program Accreditation Registry (Phase 2B / Work Order 1B).
 * Dynamically hydrated from CANONICAL_FACTS_REGISTRY.officialProgramAccreditation (Single Source of Truth).
 * Grounded strictly in official primary accreditation certificates and decrees:
 * - S1 Sistem Informasi: LAM INFOKOM No. 149/SK/LAM-INFOKOM/Ak/S/XII/2023 (Peringkat Baik Sekali, 14 Des 2023 - 14 Des 2028).
 * - S1 Sistem Komputer: LAM INFOKOM No. 068/SK/LAM-INFOKOM/Ak/S/IV/2025 (Peringkat Baik Sekali, 09 Apr 2025 - 09 Apr 2030).
 * - S1 Teknologi Informasi: BAN-PT No. 5908/SK/BAN-PT/Ak/S/IX/2022 (Peringkat Baik, 06 Sep 2022 - 06 Sep 2027).
 * - S1 Bisnis Digital: BAN-PT No. 6794/SK/BAN-PT/Ak/S/X/2022 (Peringkat Baik, 05 Okt 2022 - 05 Okt 2027).
 * - D3 Manajemen Informatika: BAN-PT No. 12450/SK/BAN-PT/Akred-PMT/Dipl-III/XI/2021 (Peringkat Baik, 17 Nov 2021 - 17 Nov 2026).
 *   * Temporal Status: Expired on 17 Nov 2026 relative to runtime (24 Nov 2026).
 *   * Current accreditation requests yield SAFE_UNKNOWN with transparent historical disclosure.
 *   * Historical requests (2021-2026) return verified historical facts.
 * - S2 Sistem Informasi: rank null, agency null (UNVERIFIED_INTERNAL_DATASET -> SAFE_UNKNOWN).
 */
const RAW_OFFICIAL_ACCREDITATION = CANONICAL_FACTS_REGISTRY?.officialProgramAccreditation || {};

function buildProgramAccreditationRegistry() {
  const result = {};
  for (const [progKey, raw] of Object.entries(RAW_OFFICIAL_ACCREDITATION)) {
    result[progKey] = Object.freeze({
      canonical: raw.program,
      degreeLevel: raw.degreeLevel,
      rank: raw.rank,
      agency: raw.agency,
      decreeNumber: raw.decreeNumber,
      validFrom: raw.validFrom,
      validUntil: raw.validUntil,
      isCurrentlyActive: Boolean(raw.isCurrentlyActive),
      temporalStatus: raw.temporalStatus || (raw.isCurrentlyActive ? 'ACTIVE' : 'SAFE_UNKNOWN'),
      certificateDocument: raw.sourceDocument,
      verificationStatus: raw.verificationStatus,
      sourceUrl: raw.sourceUrl || null,
      note: raw.note || null,
      provenance: raw.decreeNumber
        ? (raw.agency === 'LAM INFOKOM'
            ? `Keputusan LAM INFOKOM No. ${raw.decreeNumber}`
            : `Surat Keputusan BAN-PT No. ${raw.decreeNumber}`)
        : (raw.sourceDocument || 'Dokumen resmi institusi')
    });
  }
  return Object.freeze(result);
}

const PROGRAM_ACCREDITATION_REGISTRY = buildProgramAccreditationRegistry();

function formatIndonesianDate(isoDateStr) {
  if (!isoDateStr) return '';
  const parts = isoDateStr.split('-');
  if (parts.length !== 3) return isoDateStr;
  const day = parseInt(parts[2], 10);
  const monthIdx = parseInt(parts[1], 10);
  const year = parts[0];
  const months = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  return `${day} ${months[monthIdx] || ''} ${year}`.trim();
}

function resolveProgramAccreditationEntry(programNameOrQuery) {
  if (!programNameOrQuery) return null;
  const raw = typeof programNameOrQuery === 'object'
    ? (programNameOrQuery.canonical || programNameOrQuery.name || '')
    : String(programNameOrQuery);
  const str = raw.toLowerCase().trim();
  if (str.includes('bisnis digital') || /\bbd\b/i.test(str)) return PROGRAM_ACCREDITATION_REGISTRY['S1 Bisnis Digital'];
  if (str.includes('teknologi informasi') || /\bti\b/i.test(str)) return PROGRAM_ACCREDITATION_REGISTRY['S1 Teknologi Informasi'];
  if (str.includes('sistem komputer') || /\bsk\b/i.test(str)) return PROGRAM_ACCREDITATION_REGISTRY['S1 Sistem Komputer'];
  if (str.includes('manajemen informatika') || /\bmi\b/i.test(str)) return PROGRAM_ACCREDITATION_REGISTRY['D3 Manajemen Informatika'];
  if (str.includes('magister') || str.includes('s2') || str.includes('pascasarjana')) return PROGRAM_ACCREDITATION_REGISTRY['S2 Sistem Informasi'];
  if (str.includes('sistem informasi') || /\bsi\b/i.test(str)) return PROGRAM_ACCREDITATION_REGISTRY['S1 Sistem Informasi'];
  return null;
}

function getProgramAccreditationFact(programNameOrQuery, options = {}) {
  const entry = resolveProgramAccreditationEntry(programNameOrQuery);
  if (!entry) return null;

  const rawQuery = String(options.rawQuery || options.query || (typeof programNameOrQuery === 'string' ? programNameOrQuery : '')).toLowerCase();
  const isEn = options.language === 'en' || (/\b(?:what|accreditation|rank|is\s+accredited|degree)\b/i.test(rawQuery) && !/\b(?:apa|bagaimana|status|akreditasi|peringkat|prodi|jurusan|kuliah|stikom)\b/i.test(rawQuery));

  const isHistoricalQuery = /\b(?:periode\s+(?:2021|2022|2023|2024|2025|2026|sebelumnya)|sebelumnya|dulu|pernah|sk\s+(?:2021|2022|lama)|tahun\s+(?:2021|2022|2023|2024|2025)|historis|riwayat)\b/i.test(rawQuery);

  // Check unverified programs without primary source (S2 Sistem Informasi)
  if (entry.temporalStatus === 'SAFE_UNKNOWN' || entry.rank === null || entry.verificationStatus === 'UNVERIFIED_INTERNAL_DATASET') {
    const ans = isEn
      ? `Regarding the official accreditation status of the **${entry.canonical}** program at ITB STIKOM Bali, the primary accreditation decree (SK) or certificate from BAN-PT / LAM INFOKOM is currently not yet recorded in our verified official database (SAFE_UNKNOWN).\n\nFor official accreditation documentation and updates, please refer directly to the Directorate of Postgraduate Programs at https://pasca.stikom-bali.ac.id.`
      : `Mengenai status akreditasi resmi Program Studi **${entry.canonical}** ITB STIKOM Bali, saat ini dokumen Surat Keputusan (SK) atau sertifikat akreditasi resmi dari BAN-PT maupun LAM INFOKOM belum tersedia dalam basis data resmi kami (SAFE_UNKNOWN).\n\nUntuk konfirmasi status akreditasi terkini dan dokumen penetapan resmi, silakan merujuk langsung ke laman resmi Direktorat Pascasarjana di **https://pasca.stikom-bali.ac.id** atau menghubungi sekretariat pascasarjana.`;
    return {
      success: true,
      status: 'SAFE_UNKNOWN',
      program: entry.canonical,
      rank: null,
      agency: null,
      decreeNumber: null,
      validFrom: null,
      validUntil: null,
      isCurrentlyActive: false,
      temporalStatus: 'SAFE_UNKNOWN',
      verificationStatus: entry.verificationStatus,
      answer: ans,
      handledSafely: true,
      source: 'canonical_accreditation_registry'
    };
  }

  // Check temporal validity for D3 MI
  if (entry.canonical === 'D3 Manajemen Informatika' && !entry.isCurrentlyActive) {
    if (isHistoricalQuery) {
      const fromStr = formatIndonesianDate(entry.validFrom);
      const toStr = formatIndonesianDate(entry.validUntil);
      const ans = isEn
        ? `Based on official decree SK BAN-PT No. **${entry.decreeNumber}**, the **D3 Informatics Management (Manajemen Informatika)** program at ITB STIKOM Bali held an accreditation rank of **${entry.rank}** by **BAN-PT** valid from **${fromStr} to ${toStr}**.\n\n_Note: The validity period of this decree expired on ${toStr}._`
        : `Berdasarkan dokumen resmi SK BAN-PT No. **${entry.decreeNumber}**, Program Studi **D3 Manajemen Informatika** ITB STIKOM Bali memiliki peringkat akreditasi **${entry.rank}** oleh **BAN-PT** untuk masa berlaku **${fromStr} sampai dengan ${toStr}**.\n\n_Catatan: Masa berlaku SK tersebut berakhir pada ${toStr}._`;
      return {
        success: true,
        status: 'HISTORICAL_FACT',
        program: entry.canonical,
        rank: entry.rank,
        agency: entry.agency,
        decreeNumber: entry.decreeNumber,
        validFrom: entry.validFrom,
        validUntil: entry.validUntil,
        isCurrentlyActive: false,
        answer: ans,
        handledSafely: true,
        source: 'canonical_accreditation_registry'
      };
    } else {
      // Current active accreditation query without historical qualification: must SAFE_UNKNOWN
      const toStr = formatIndonesianDate(entry.validUntil);
      const ans = isEn
        ? `Based on available official records (SK BAN-PT No. **${entry.decreeNumber}**), the **D3 Informatics Management (Manajemen Informatika)** study program at ITB STIKOM Bali previously held an accreditation rank of **${entry.rank}** with validity through **${toStr}**.\n\nHowever, official documentation regarding accreditation renewal or the latest accreditation certificate is not yet recorded in our official database (SAFE_UNKNOWN). To confirm the current active accreditation status, please contact the D3 Manajemen Informatika Study Program directly or verify via the official BAN-PT portal.`
        : `Berdasarkan dokumen resmi yang tersedia (SK BAN-PT No. **${entry.decreeNumber}**), Program Studi **D3 Manajemen Informatika** ITB STIKOM Bali sebelumnya memiliki peringkat akreditasi **${entry.rank}** dengan masa berlaku hingga **${toStr}**.\n\nNamun, dokumen penetapan perpanjangan atau sertifikat akreditasi terbaru saat ini belum tersedia dalam basis data resmi kami (SAFE_UNKNOWN). Untuk memastikan status akreditasi terkini yang sedang berjalan, silakan mengonfirmasi langsung ke Program Studi D3 Manajemen Informatika atau memeriksa portal resmi BAN-PT.`;
      return {
        success: true,
        status: 'SAFE_UNKNOWN',
        program: entry.canonical,
        rank: null,
        historicalRank: entry.rank,
        agency: entry.agency,
        decreeNumber: entry.decreeNumber,
        validUntil: entry.validUntil,
        isCurrentlyActive: false,
        answer: ans,
        handledSafely: true,
        source: 'canonical_accreditation_registry'
      };
    }
  }

  // Active programs: S1 TI, S1 BD, S1 SK, S1 SI, S2 SI
  let validityText = '';
  if (entry.validFrom && entry.validUntil) {
    const fromStr = formatIndonesianDate(entry.validFrom);
    const toStr = formatIndonesianDate(entry.validUntil);
    validityText = isEn
      ? ` (valid from ${fromStr} to ${toStr})`
      : ` (berlaku sejak ${fromStr} sampai dengan ${toStr})`;
  }

  let decreeText = '';
  if (entry.decreeNumber) {
    if (entry.agency === 'LAM INFOKOM') {
      decreeText = isEn
        ? ` under LAM INFOKOM Decree No. **${entry.decreeNumber}**`
        : ` berdasarkan Keputusan LAM INFOKOM No. **${entry.decreeNumber}**`;
    } else {
      decreeText = isEn
        ? ` under Decree No. **${entry.decreeNumber}**`
        : ` berdasarkan Surat Keputusan No. **${entry.decreeNumber}**`;
    }
  }

  const ans = isEn
    ? `The **${entry.canonical}** study program at ITB STIKOM Bali is accredited **${entry.rank}** by **${entry.agency}**${decreeText}${validityText}.\n\nThis accreditation assures official educational standards, curriculum quality, certified faculty, and learning facilities. Is there anything else about ${entry.canonical} you would like to know?`
    : `Program Studi **${entry.canonical}** di ITB STIKOM Bali terakreditasi **${entry.rank}** oleh **${entry.agency}**${decreeText}${validityText}.\n\nAkreditasi ini menjadi jaminan standar mutu kurikulum, tenaga pengajar, dan fasilitas pembelajaran yang diselenggarakan. Ada info lain tentang prodi ${entry.canonical} yang ingin Kakak tanyakan?`;

  return {
    success: true,
    status: 'VERIFIED_ACTIVE',
    program: entry.canonical,
    rank: entry.rank,
    agency: entry.agency,
    decreeNumber: entry.decreeNumber,
    validFrom: entry.validFrom,
    validUntil: entry.validUntil,
    isCurrentlyActive: true,
    answer: ans,
    handledSafely: true,
    source: 'canonical_accreditation_registry'
  };
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
    sks: CURRICULUM_FACTS['S1 Sistem Informasi']?.totalSks || 144,
    semesters: CURRICULUM_FACTS['S1 Sistem Informasi']?.normalDurationSemesters || 8,
    verificationStatus: CURRICULUM_FACTS['S1 Sistem Informasi']?.verificationStatus || 'VERIFIED_PRIMARY_SOURCE',
    accreditation: PROGRAM_ACCREDITATION_REGISTRY['S1 Sistem Informasi'],
    focusId: 'Fokus pada perancangan sistem enterprise, tata kelola TI, basis data, dan analisis bisnis digital.',
    focusEn: 'Focuses on enterprise systems, IT governance, database management, and digital business analytics.',
    provenance: CURRICULUM_FACTS['S1 Sistem Informasi']?.sourceDocument || 'ISIAN WEBSITE (1).pdf & Pedoman Akademik Program Sarjana ITB STIKOM Bali'
  },
  {
    id: 's1_sk',
    canonical: 'S1 Sistem Komputer',
    nameEn: 'S1 Computer Systems (Sistem Komputer)',
    degree: 'S1',
    degreeTitle: 'Sarjana Komputer (S.Kom)',
    sks: CURRICULUM_FACTS['S1 Sistem Komputer']?.totalSks || 144,
    semesters: CURRICULUM_FACTS['S1 Sistem Komputer']?.normalDurationSemesters || 8,
    verificationStatus: CURRICULUM_FACTS['S1 Sistem Komputer']?.verificationStatus || 'VERIFIED_PRIMARY_SOURCE',
    accreditation: PROGRAM_ACCREDITATION_REGISTRY['S1 Sistem Komputer'],
    focusId: 'Fokus pada perangkat keras (hardware), Internet of Things (IoT), embedded system, robotika, dan keamanan jaringan.',
    focusEn: 'Focuses on hardware engineering, Internet of Things (IoT), embedded systems, robotics, and network security.',
    provenance: CURRICULUM_FACTS['S1 Sistem Komputer']?.sourceDocument || 'ISIAN WEBSITE (1).pdf & Pedoman Akademik Program Sarjana ITB STIKOM Bali'
  },
  {
    id: 's1_ti',
    canonical: 'S1 Teknologi Informasi',
    nameEn: 'S1 Information Technology (Teknologi Informasi)',
    degree: 'S1',
    degreeTitle: 'Sarjana Komputer (S.Kom)',
    sks: CURRICULUM_FACTS['S1 Teknologi Informasi']?.totalSks || 144,
    semesters: CURRICULUM_FACTS['S1 Teknologi Informasi']?.normalDurationSemesters || 8,
    verificationStatus: CURRICULUM_FACTS['S1 Teknologi Informasi']?.verificationStatus || 'VERIFIED_PRIMARY_SOURCE',
    accreditation: PROGRAM_ACCREDITATION_REGISTRY['S1 Teknologi Informasi'],
    focusId: 'Fokus pada keamanan siber (cyber security), integrasi sistem ICT, cloud computing, dan infrastruktur jaringan.',
    focusEn: 'Focuses on cyber security, ICT system integration, cloud computing, and network infrastructure.',
    provenance: CURRICULUM_FACTS['S1 Teknologi Informasi']?.sourceDocument || 'ISIAN WEBSITE (1).pdf & Pedoman Akademik Program Sarjana ITB STIKOM Bali'
  },
  {
    id: 's1_bd',
    canonical: 'S1 Bisnis Digital',
    nameEn: 'S1 Digital Business (Bisnis Digital)',
    degree: 'S1',
    degreeTitle: 'Sarjana Bisnis (S.Bns)',
    sks: CURRICULUM_FACTS['S1 Bisnis Digital']?.totalSks || 144,
    semesters: CURRICULUM_FACTS['S1 Bisnis Digital']?.normalDurationSemesters || 8,
    verificationStatus: CURRICULUM_FACTS['S1 Bisnis Digital']?.verificationStatus || 'VERIFIED_PRIMARY_SOURCE',
    accreditation: PROGRAM_ACCREDITATION_REGISTRY['S1 Bisnis Digital'],
    focusId: 'Fokus pada inovasi bisnis berbasis teknologi, e-commerce, digital marketing, analitika bisnis, dan pengembangan startup.',
    focusEn: 'Focuses on tech-driven business innovation, e-commerce, digital marketing, business analytics, and startup development.',
    provenance: CURRICULUM_FACTS['S1 Bisnis Digital']?.sourceDocument || 'ISIAN WEBSITE (1).pdf & Pedoman Akademik Program Sarjana ITB STIKOM Bali'
  },
  {
    id: 'd3_mi',
    canonical: 'D3 Manajemen Informatika',
    nameEn: 'D3 Informatics Management (Manajemen Informatika)',
    degree: 'D3',
    degreeTitle: 'Ahli Madya Komputer (A.Md.Kom)',
    sks: D3_MI_FACTS.totalSks || 110,
    indexedTotalSks: D3_MI_FACTS.indexedTotalSks || 110,
    listedCoursesSumSks: D3_MI_FACTS.listedCoursesSumSks || 75,
    graduationMinimumSks: D3_MI_FACTS.graduationMinimumSks ?? null,
    semesters: D3_MI_FACTS.normalDurationSemesters || 6,
    distribution: D3_MI_FACTS.distribution || { 'Tingkat I': 38, 'Tingkat II': 40, 'Tingkat III': 32 },
    verificationStatus: D3_MI_FACTS.verificationStatus || 'PARTIAL_OR_NEEDS_VALIDATION',
    verificationNote: D3_MI_FACTS.verificationNote || null,
    accreditation: PROGRAM_ACCREDITATION_REGISTRY['D3 Manajemen Informatika'],
    focusId: 'Fokus pada aplikasi terapan teknologi informasi, operasional bisnis, pengolahan data, administrasi sistem informasi, dan IT support praktis.',
    focusEn: 'Focuses on applied information technology applications, business operations, data processing, information systems administration, and practical IT support.',
    provenance: D3_MI_FACTS.sourceDocument || 'MI_curriculum_verified_obe-2023.json (Indeks Kurikulum OBE Program Studi D3 Manajemen Informatika)'
  },
  {
    id: 's2_si',
    canonical: 'S2 Magister Sistem Informasi (M.Kom)',
    canonicalRegistryName: 'S2 Sistem Informasi',
    nameEn: 'S2 Master of Information Systems (Magister Sistem Informasi - M.Kom)',
    degree: 'S2',
    degreeTitle: 'Magister Komputer (M.Kom)',
    sks: S2_SI_FACTS.totalSks || 56,
    totalCurriculumSks: S2_SI_FACTS.totalCurriculumSks || 56,
    mandatorySks: S2_SI_FACTS.mandatorySks || 47,
    mandatoryCoursesCount: S2_SI_FACTS.mandatoryCoursesCount || 13,
    electiveOfferedSks: S2_SI_FACTS.electiveOfferedSks || 9,
    electiveOfferedCoursesCount: S2_SI_FACTS.electiveOfferedCoursesCount || 3,
    graduationMinimumSks: S2_SI_FACTS.graduationMinimumSks ?? null,
    semesters: S2_SI_FACTS.normalDurationSemesters || 4,
    verificationStatus: S2_SI_FACTS.verificationStatus || 'PARTIAL_OR_NEEDS_VALIDATION',
    curriculumStructureStatus: S2_SI_FACTS.curriculumStructureStatus || 'VERIFIED_PRIMARY_SOURCE',
    graduationMinSksStatus: S2_SI_FACTS.graduationMinSksStatus || 'PARTIAL_OR_NEEDS_VALIDATION',
    verificationNote: S2_SI_FACTS.verificationNote || null,
    accreditation: PROGRAM_ACCREDITATION_REGISTRY['S2 Sistem Informasi'],
    focusId: 'Fokus pada riset terapan sistem informasi tingkat lanjut, arsitektur enterprise, kepemimpinan teknologi strategis, dan tata kelola TI tingkat magister.',
    focusEn: 'Focuses on advanced applied information systems research, enterprise architecture, strategic IT leadership, and master-level IT governance.',
    provenance: S2_SI_FACTS.sourceDocument || 'ISIAN WEBSITE (1).pdf & Training_Dataset_Pascasarjana_ITB_STIKOM_Bali.xlsx'
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
      return `At ITB STIKOM Bali, there are 4 **Undergraduate (Bachelor/S1)** study programs available:\n\n${items}\n\nAll undergraduate (S1) programs consist of 144 credits (8 semesters). Registration can be completed online at https://pmb.stikom-bali.ac.id. (Note: For evening/worker class availability in the current academic year, please confirm directly with PMB admissions). Are you interested in any of these programs?`;
    }
    const items = entries.map((e, idx) => `${idx + 1}. **${e.canonical}**\n   ${e.focusId}`).join('\n');
    return `Di ITB STIKOM Bali, ada 4 pilihan **Program Sarjana (S1)** yang bisa Kakak pilih:\n\n${items}\n\nSemua program S1 berbeban studi 144 SKS (8 semester). Pendaftaran dapat diakses di https://pmb.stikom-bali.ac.id. (Catatan: Mengenai ketersediaan kelas sore/karyawan pada tahun akademik berjalan, silakan konfirmasi langsung ke layanan PMB). Tertarik dengan salah satu prodi di atas?`;
  }

  if (effectiveScope === 'D3') {
    const d3Entry = entries[0] || {};
    const d3Sks = d3Entry.sks || 110;
    const d3Sem = d3Entry.semesters || 6;
    if (isEn) {
      const items = entries.map((e, idx) => `${idx + 1}. **${e.nameEn}**\n   ${e.focusEn}`).join('\n');
      return `At ITB STIKOM Bali, the available **Diploma (D3)** study program is:\n\n${items}\n\nThe Diploma (D3) program is designed for ${d3Sem} semesters (indexed OBE curriculum structure records ${d3Sks} credits / SKS across 3 levels, with final graduation credit requirements subject to official study program curriculum verification) with an applied, hands-on curriculum. Registration can be completed online at https://pmb.stikom-bali.ac.id. Would you like to know more about this D3 program?`;
    }
    const items = entries.map((e, idx) => `${idx + 1}. **${e.canonical}**\n   ${e.focusId}`).join('\n');
    return `Di ITB STIKOM Bali, tersedia pilihan **Program Diploma (D3)**:\n\n${items}\n\nProgram Diploma (D3) dirancang untuk masa studi normal ${d3Sem} semester (indeks struktur kurikulum OBE mencatat beban studi ${d3Sks} SKS pada 3 tingkat, dengan konfirmasi beban SKS wajib kelulusan final mengacu pada dokumen kurikulum primer resmi prodi) dengan kurikulum terapan yang siap kerja. Pendaftaran dapat diakses di https://pmb.stikom-bali.ac.id. Ada yang ingin Kakak tanyakan seputar prodi D3 ini?`;
  }

  if (effectiveScope === 'S2') {
    const s2Entry = entries[0] || {};
    const s2Total = s2Entry.sks || 56;
    const s2Mandatory = s2Entry.mandatorySks || 47;
    const s2Elective = s2Entry.electiveOfferedSks || 9;
    const s2Sem = s2Entry.semesters || 4;
    if (isEn) {
      const items = entries.map((e, idx) => `${idx + 1}. **${e.nameEn}**\n   ${e.focusEn}`).join('\n');
      return `At ITB STIKOM Bali, the available **Postgraduate (Master/S2)** study program is:\n\n${items}\n\nThe Master (S2) program is designed for ${s2Sem} semesters (curriculum structure comprises ${s2Total} offered credits / SKS: ${s2Mandatory} mandatory credits and ${s2Elective} offered elective credits; minimum graduation credit requirements are subject to official postgraduate academic guidelines). Registration can be completed online at https://pmb.stikom-bali.ac.id. Would you like more information about the Master's program?`;
    }
    const items = entries.map((e, idx) => `${idx + 1}. **${e.canonical}**\n   ${e.focusId}`).join('\n');
    return `Di ITB STIKOM Bali, tersedia pilihan **Program Pascasarjana (S2)**:\n\n${items}\n\nProgram Magister (S2) dirancang untuk masa studi normal ${s2Sem} semester (struktur kurikulum mencakup total ${s2Total} SKS yang ditawarkan, terdiri atas ${s2Mandatory} SKS mata kuliah wajib dan ${s2Elective} SKS mata kuliah pilihan yang ditawarkan; ketentuan batas minimal SKS wajib kelulusan mengacu pada pedoman akademik pascasarjana resmi). Pendaftaran dapat diakses di https://pmb.stikom-bali.ac.id. Tertarik untuk melanjutkan studi S2 di ITB STIKOM Bali?`;
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

/**
 * Structured Official Campus Locations with Provenance.
 */
const INSTITUTIONAL_CAMPUS_LOCATIONS = Object.freeze([
  {
    name: 'Kampus Renon (Kampus Pusat)',
    canonical: 'Kampus Denpasar (Renon)',
    address: 'Jl. Raya Puputan No. 86 Renon, Denpasar, Bali',
    provenance: 'ISIAN WEBSITE (1).pdf (Section 6: Kontak & Lokasi Kampus)'
  },
  {
    name: 'Kampus Jimbaran',
    canonical: 'Kampus Jimbaran',
    address: 'Jl. Raya Kampus Udayana, Jimbaran, Kuta Selatan, Badung, Bali',
    provenance: 'ISIAN WEBSITE (1).pdf (Section 6: Kontak & Lokasi Kampus)'
  },
  {
    name: 'Kampus Abiansemal',
    canonical: 'Kampus Abiansemal',
    address: 'Jl. Janger, Dauh Yeh Cani, Kec. Abiansemal, Kabupaten Badung, Bali',
    provenance: 'ISIAN WEBSITE (1).pdf (Section 6: Kontak & Lokasi Kampus)'
  }
]);

function generateGroundedCampusLocationSummary(userLang = 'id') {
  const isEn = userLang === 'en';
  if (isEn) {
    return 'ITB STIKOM Bali campus locations:\n\n' +
      INSTITUTIONAL_CAMPUS_LOCATIONS.map((loc, idx) =>
        `${idx + 1}. **${loc.name}**:\n   ${loc.address}.`
      ).join('\n\n');
  }
  return 'Lokasi kampus ITB STIKOM Bali:\n\n' +
    INSTITUTIONAL_CAMPUS_LOCATIONS.map((loc, idx) =>
      `${idx + 1}. **${loc.name}**:\n   ${loc.address}.`
    ).join('\n\n');
}

/**
 * Structured Official Contact Channels with Provenance.
 */
const INSTITUTIONAL_CONTACTS = Object.freeze({
  telephone: '(0361) 244445',
  email: 'info@stikom-bali.ac.id',
  pmbPortal: 'https://pmb.stikom-bali.ac.id',
  mainCampusAddress: 'Jl. Raya Puputan No. 86, Renon, Denpasar, Bali',
  provenance: 'Pedoman & Informasi Resmi Kampus ITB STIKOM Bali'
});

function generateGroundedContactSummary(userLang = 'id') {
  const isEn = userLang === 'en';
  if (isEn) {
    return 'You can reach official ITB STIKOM Bali campus services through the following verified channels:\n\n' +
      `• **PMB Portal**: ${INSTITUTIONAL_CONTACTS.pmbPortal}\n` +
      `• **Campus Telephone (Main Campus)**: ${INSTITUTIONAL_CONTACTS.telephone}\n` +
      `• **Email**: ${INSTITUTIONAL_CONTACTS.email}\n` +
      `• **Main Campus Location**: ${INSTITUTIONAL_CONTACTS.mainCampusAddress}\n\n` +
      'Our campus admissions team is ready to assist with information regarding enrollment, entrance requirements, and academic programs.';
  }
  return 'Kakak dapat menghubungi layanan resmi Kampus ITB STIKOM Bali melalui kanal yang terverifikasi berikut:\n\n' +
    `• **Website PMB**: ${INSTITUTIONAL_CONTACTS.pmbPortal}\n` +
    `• **Telepon Kampus (Pusat)**: ${INSTITUTIONAL_CONTACTS.telephone}\n` +
    `• **Email**: ${INSTITUTIONAL_CONTACTS.email}\n` +
    `• **Lokasi Kampus Pusat**: ${INSTITUTIONAL_CONTACTS.mainCampusAddress}\n\n` +
    'Layanan kampus siap membantu pertanyaan seputar pendaftaran, persyaratan masuk, dan informasi program perkuliahan.';
}

/**
 * Retrieve unified canonical curriculum and program facts by program name or level.
 * Returns normalized metadata including provenance (sourceDocument) and verificationStatus.
 */
function getCanonicalProgramFacts(programQuery) {
  if (!programQuery) return null;
  const q = String(programQuery).toLowerCase().trim();
  if (/\b(?:s2|magister|pascasarjana)\b/i.test(q)) {
    return CURRICULUM_FACTS['S2 Sistem Informasi'] || null;
  }
  if (/\b(?:d3|diploma|manajemen\s+informatika|\bmi\b)\b/i.test(q)) {
    return CURRICULUM_FACTS['D3 Manajemen Informatika'] || null;
  }
  if (/\b(?:bisnis\s+digital|\bbd\b)\b/i.test(q)) {
    return CURRICULUM_FACTS['S1 Bisnis Digital'] || null;
  }
  if (/\b(?:sistem\s+komputer|\bsk\b)\b/i.test(q)) {
    return CURRICULUM_FACTS['S1 Sistem Komputer'] || null;
  }
  if (/\b(?:teknologi\s+informasi|\bti\b)\b/i.test(q)) {
    return CURRICULUM_FACTS['S1 Teknologi Informasi'] || null;
  }
  if (/\b(?:sistem\s+informasi|\bsi\b)\b/i.test(q)) {
    return CURRICULUM_FACTS['S1 Sistem Informasi'] || null;
  }
  return null;
}

const ACADEMIC_TERM_SYNONYMS = {
  'engineering': 'teknik',
  'management': 'manajemen',
  'business': 'bisnis',
  'system': 'sistem',
  'content': 'konten',
  'customer': 'pelanggan',
  'relationship': 'hubungan',
  'analysis': 'analisis',
  'data': 'data',
  'marketing': 'pemasaran'
};

const COURSE_QUERY_STOPWORDS = new Set([
  'apakah', 'ada', 'adakah', 'mata', 'kuliah', 'matkul', 'course', 'tentang', 'terkait', 'di', 'pada',
  'semester', 'berapa', 'sks', 'nama', 'apa', 'siapa', 'mana', 'program', 'studi', 'prodi', 'jurusan',
  's1', 's2', 'd3', 'stikom', 'bali', 'itb', 'kampus', 'universitas', 'belajar', 'diajarkan', 'pelajari',
  'mempelajari', 'materi', 'silabus', 'kurikulum', 'struktur', 'yang', 'dan', 'atau', 'untuk', 'dengan',
  'dalam', 'mohon', 'info', 'tahu', 'tolong', 'bisa', 'kak', 'kakak', 'min', 'admin', 'mahasiswa',
  'aku', 'saya', 'kami', 'kita', 'kamu', 'anda', 'lebih', 'paling', 'sangat', 'tertarik', 'minat',
  'ingin', 'mau', 'pengen', 'tapi', 'tetapi', 'namun', 'masih', 'bagaimana', 'gimana',
  'kalau', 'jika', 'bila', 'seperti', 'contoh', 'misal', 'misalnya', 'itu', 'ini', 'tersebut', 'nya',
  'soal', 'mengenai', 'seputar'
]);

function normalizeAcademicQuery(text) {
  return String(text || '').toLowerCase()
    .replace(/\b(?:artificial\s+intelligence|kecerdasan\s+buatan|kecerdasan\s+artifisial)\b/gi, 'ai')
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim();
}

function getProgramStopwords(progFacts, programQuery) {
  const set = new Set();
  const raw = [
    programQuery,
    progFacts?.name,
    progFacts?.canonical,
    progFacts?.code,
    progFacts?.focusId,
    progFacts?.focusEn
  ].filter(Boolean).join(' ');
  const tokens = String(raw).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/);
  for (const t of tokens) {
    if (t.length > 1) set.add(t);
  }
  if (set.has('bisnis') && set.has('digital')) { set.add('bd'); set.add('pemasaran'); set.add('marketing'); }
  if (set.has('sistem') && set.has('informasi')) { set.add('si'); }
  if (set.has('sistem') && set.has('komputer')) { set.add('sk'); }
  if (set.has('teknologi') && set.has('informasi')) { set.add('ti'); }
  if (set.has('manajemen') && set.has('informatika')) { set.add('mi'); }
  return set;
}

function tokenizeAcademicTerms(text, excludeSet = null) {
  const norm = normalizeAcademicQuery(text);
  return norm.split(/\s+/).filter(t => t.length > 1 && !COURSE_QUERY_STOPWORDS.has(t) && (!excludeSet || !excludeSet.has(t)));
}

/**
 * Retrieve specific verified course record from the canonical curriculum registry.
 * Uses a single generic course resolver across all academic programs based on:
 * 1. Explicit official course code matching (e.g. BD233507, TI231401, SK231501).
 * 2. Exact full course name matching against the canonical registry.
 * 3. Generic token-based relevance scoring with program-context isolation, confidence threshold, and fail-closed ambiguity rejection.
 */
function getProgramCourseFact(programQuery, courseQuery = '') {
  const progFacts = getCanonicalProgramFacts(programQuery);
  if (!progFacts || !Array.isArray(progFacts.courses) || progFacts.courses.length === 0) {
    return null;
  }
  if (!courseQuery) return progFacts.courses;

  const cq = String(courseQuery).toLowerCase().trim();

  // 1. Explicit official course code matching (e.g. BD233507, TI231401, SK231501)
  const explicitCodeMatch = cq.match(/\b([a-z]{2}\d{6})\b/i);
  if (explicitCodeMatch) {
    const codeTarget = explicitCodeMatch[1].toUpperCase();
    const found = progFacts.courses.find(c => c.code && c.code.toUpperCase() === codeTarget);
    if (!found || found.verificationStatus !== 'VERIFIED_PRIMARY_SOURCE') {
      return null;
    }
    return found;
  }

  // 2. Exact full course name match with multi-course ambiguity detection
  const exactNameMatches = [];
  for (const c of progFacts.courses) {
    const cName = (c.name || '').toLowerCase().trim();
    if (cName) {
      const escaped = cName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      if (new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(cq)) {
        exactNameMatches.push(c);
      }
    }
  }

  // If query mentions two or more distinct course names (e.g. "Kewirausahaan dan Analisis Data Bisnis"),
  // treat as ambiguous and fail closed
  if (exactNameMatches.length > 1) {
    return null;
  }
  if (exactNameMatches.length === 1) {
    const single = exactNameMatches[0];
    if (single.verificationStatus === 'VERIFIED_PRIMARY_SOURCE') {
      return single;
    }
    return null;
  }

  // 3. Generic token-based relevance scoring with program-context isolation & discriminative weighting
  const progStops = getProgramStopwords(progFacts, programQuery);
  const qTokens = tokenizeAcademicTerms(cq, progStops);
  if (qTokens.length === 0) return null;

  // Single-token query check: A single generic word with low discriminative power (high corpus frequency)
  // must not match a multi-word course where precision is low
  if (qTokens.length === 1) {
    const singleToken = qTokens[0];
    const syn = ACADEMIC_TERM_SYNONYMS[singleToken] || singleToken;
    const docFreq = Math.max(CORPUS_TOKEN_DOCUMENT_FREQUENCY.get(singleToken) || 0, CORPUS_TOKEN_DOCUMENT_FREQUENCY.get(syn) || 0);
    // If token appears in 5 or more courses across the institution, it has low discriminative power
    if (docFreq >= 5) {
      // It can only match if a course is practically a 1-to-1 match for that word (course precision >= 0.6)
      const directMatch = progFacts.courses.find(c => {
        const cTokens = tokenizeAcademicTerms(c.name);
        return cTokens.length === 1 && (cTokens[0] === singleToken || cTokens[0] === syn);
      });
      if (directMatch && directMatch.verificationStatus === 'VERIFIED_PRIMARY_SOURCE') {
        return directMatch;
      }
      return null; // Reject generic single word like "sistem", "data", "teknologi"
    }
  }

  const candidates = [];
  for (const c of progFacts.courses) {
    const cTokens = tokenizeAcademicTerms(c.name);
    let matchedCount = 0;
    const unmatched = [];

    for (const qt of qTokens) {
      const syn = ACADEMIC_TERM_SYNONYMS[qt] || qt;
      const isMatch = cTokens.some(ct => {
        if (ct === qt || ct === syn) return true;
        if (qt.length >= 4 && ct.length >= 4 && (ct.startsWith(qt) || qt.startsWith(ct))) return true;
        return false;
      });
      if (isMatch) {
        matchedCount++;
      } else {
        unmatched.push(qt);
      }
    }

    const queryRecall = qTokens.length > 0 ? matchedCount / qTokens.length : 0;
    const coursePrecision = cTokens.length > 0 ? matchedCount / cTokens.length : 0;

    // Disqualify if query contains substantive terms that are completely unmatched in this course
    if (unmatched.length > 0 && queryRecall < 0.6) {
      continue;
    }

    candidates.push({
      course: c,
      matchedCount,
      unmatchedCount: unmatched.length,
      queryRecall,
      coursePrecision,
      score: queryRecall * 0.7 + coursePrecision * 0.3
    });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);

  const best = candidates[0];
  // Require at least 60% substantive query term coverage and minimum confidence threshold
  if (best.queryRecall >= 0.6 && best.score >= 0.45) {
    // Check ambiguity: if top two candidates have near-identical score, fail-closed
    if (candidates.length > 1 && Math.abs(candidates[1].score - best.score) < 0.05) {
      return null;
    }
    if (best.course.verificationStatus === 'VERIFIED_PRIMARY_SOURCE') {
      return best.course;
    }
  }
  return null;
}

module.exports = {
  CANONICAL_FACTS_REGISTRY,
  ACADEMIC_SCOPE_STATUS,
  SUPPORTED_CANONICAL_DEGREES,
  INSTITUTIONAL_ACADEMIC_CATALOG,
  INSTITUTIONAL_FACULTIES,
  INSTITUTIONAL_CAMPUS_LOCATIONS,
  INSTITUTIONAL_CONTACTS,
  resolveAcademicScope,
  normalizeAcademicScope,
  getCatalogEntriesByScope,
  generateGroundedCatalogSummary,
  resolveFaculty,
  getFacultyForProgram,
  getProgramsForFaculty,
  generateGroundedFacultySummary,
  generateGroundedCampusLocationSummary,
  generateGroundedContactSummary,
  getCanonicalProgramFacts,
  getProgramCourseFact,
  PROGRAM_ACCREDITATION_REGISTRY,
  resolveProgramAccreditationEntry,
  getProgramAccreditationFact,
  CATALOG_FACT_PROVENANCE_STATUS,
  S1_CATALOG_CLAIM_PROVENANCE,
  getCatalogClaimProvenance
};
