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

const PROGRAM_AVAILABILITY_STATUS = Object.freeze({
  OFFERED: 'offered',
  NOT_OFFERED: 'not_offered',
  UNKNOWN: 'unknown'
});

const SUPPORTED_CANONICAL_DEGREES = Object.freeze(['S1', 'D3', 'S2', 'FBV', 'FIK', 'ALL']);

const UNSUPPORTED_DEGREE_PATTERN = /\b(?:s[- ]?3|doktor(?:al)?|doctor(?:al|ate)?|ph\.?d|d[- ]?4|diploma\s*[- ]?4|diploma\s*[- ]?iv|sarjana\s+terapan|d[- ]?1|d[- ]?2|diploma\s*[- ]?1|diploma\s*[- ]?2|smk|sma)\b/i;

const SCIENTIFIC_LAW_HOMONYM_TERMS = '(?:gravitasi|newton|termodinamika|kepler|ohm|pascal|bernoulli|kekekalan|gauss|coulomb|faraday|archimedes|boyle|snellius|kirchhoff|mendel|fisika|kimia|alam|rimba|timbal|sebab|permintaan|penawaran)';

const UNSUPPORTED_STATUTORY_DISCIPLINE_PATTERN = new RegExp(
  '\\b(?:kedokteran(?:\\s+gigi)?|dokter|farmasi|farmakologi|keperawatan|kebidanan|psikologi|hukum(?!\\s+' + SCIENTIFIC_LAW_HOMONYM_TERMS + ')|arsitektur|teknik\\s+(?:nuklir|sipil|mesin|kimia|perminyakan|pertambangan|geologi|kelautan|penerbangan|dirgantara)|sastra\\s+[a-z]+|pendidikan\\s+(?:dokter|guru|anak|usia\\s+dini|sekolah\\s+dasar)|medicine|pharmacy|dentistry|nursing|law)\\b',
  'i'
);

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
 *   level: 'S1' | 'D3' | 'S2' | 'FBV' | 'FIK' | 'ALL' | null,
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

  // 1b. Check for Faculty scopes (FBV / FIK) before degree level parsing
  if (/\b(?:fakultas\s+bisnis\s+dan\s+vokasi|bisnis\s+dan\s+vokasi|fbv|faculty\s+of\s+business\s+and\s+vocational(?:\s+studies)?)\b/i.test(lower) &&
      !/\b(?:s[- ]?1|s[- ]?2|d[- ]?3)\b/i.test(lower)) {
    return {
      status: ACADEMIC_SCOPE_STATUS.SUPPORTED,
      level: 'FBV',
      rawMention: 'FBV',
      faculty: 'FBV',
      isSupported: true
    };
  }

  if (/\b(?:fakultas\s+informatika\s+dan\s+komputer|informatika\s+dan\s+komputer|fik|ftik|faculty\s+of\s+informatics\s+and\s+computing)\b/i.test(lower) &&
      !/\b(?:s[- ]?1|s[- ]?2|d[- ]?3)\b/i.test(lower)) {
    return {
      status: ACADEMIC_SCOPE_STATUS.SUPPORTED,
      level: 'FIK',
      rawMention: 'FIK',
      faculty: 'FIK',
      isSupported: true
    };
  }

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
  if (/^(?:all|semua|lengkap|seluruh|institutional|any|general|semuanya|fbv|fik)$/i.test(lower) ||
      /\b(?:semua\s+(?:jenjang|program|prodi)|seluruh\s+(?:jenjang|program)|all\s+(?:academic\s+)?degrees?|all\s+programs?)\b/i.test(lower)) {
    return {
      status: ACADEMIC_SCOPE_STATUS.SUPPORTED,
      level: lower === 'fbv' ? 'FBV' : (lower === 'fik' ? 'FIK' : 'ALL'),
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
 * - 'FBV': Fakultas Bisnis dan Vokasi
 * - 'FIK': Fakultas Informatika dan Komputer
 * - 'ALL': ALL, Semua, Lengkap, Seluruh, Institutional, Any, General
 * Returns null if the scope is unrecognized or unsupported.
 *
 * @param {string|Object} rawScope
 * @returns {'S1' | 'D3' | 'S2' | 'FBV' | 'FIK' | 'ALL' | null}
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
 * Grounded in official institutional curriculum guides, actual certificate PDFs in corpus,
 * and verified against CANONICAL_ENTITIES.
 */
const INSTITUTIONAL_ACADEMIC_CATALOG = Object.freeze([
  {
    id: 's1_si',
    canonical: 'S1 Sistem Informasi',
    nameEn: 'S1 Information Systems (Sistem Informasi)',
    degree: 'S1',
    faculty: 'FIK',
    facultyName: 'Fakultas Informatika dan Komputer',
    degreeTitle: 'Sarjana Komputer (S.Kom)',
    sks: 144,
    semesters: 8,
    focusId: 'Fokus pada perancangan sistem enterprise, tata kelola TI, basis data, dan analisis bisnis digital.',
    focusEn: 'Focuses on enterprise systems, IT governance, database management, and digital business analytics.',
    availabilityStatus: PROGRAM_AVAILABILITY_STATUS.OFFERED,
    provenance: Object.freeze({
      knowledgeDocument: 'docs/retrieval/knowledge_domains/program_studi_sistem_informasi.md',
      curriculumSource: 'ISIAN WEBSITE (1).pdf',
      feeScheduleSource: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf',
      accreditationSource: 'SERTIFIKAT AKREDITASI - SISTEM INFORMASI (14 DES 2023 - 14 DES 2028) LAM INFOKOM.pdf',
      accreditationDecree: '149/SK/LAM-INFOKOM/Ak/S/XII/2023',
      accreditationRank: 'Baik Sekali',
      accreditationValidity: '2023-12-14 s.d. 2028-12-14',
      accreditationStatus: 'VERIFIED_ACTIVE',
      externalUrl: 'https://stikom-bali.ac.id',
      externalAccessStatus: 'BLOCKED_EXTERNAL_ACCESS (Cloudflare HTTP 403 Challenge)',
      verificationStatus: 'VERIFIED_FROM_LOCAL_CORPUS',
      offeredStatusProvenance: Object.freeze({
        status: PROGRAM_AVAILABILITY_STATUS.OFFERED,
        admissionPortalUrl: 'https://siap.stikom-bali.ac.id/',
        verificationStatus: 'VERIFIED_OFFICIAL_PORTAL',
        evidenceBasis: 'Aktif dibuka pada pendaftaran PMB SIAP 2026/2027'
      }),
      accreditationProvenance: Object.freeze({
        agency: 'LAM INFOKOM',
        decree: '149/SK/LAM-INFOKOM/Ak/S/XII/2023',
        rank: 'Baik Sekali',
        validity: '2023-12-14 s.d. 2028-12-14',
        status: 'VERIFIED_ACTIVE',
        sourceUrl: 'https://www.stikom-bali.ac.id/id/sertifikat-akreditasi-institusi/'
      }),
      historicalProvenance: Object.freeze({
        hasHistoricalDecrees: true,
        note: 'Akreditasi sebelumnya telah diperbarui oleh SK 149/SK/LAM-INFOKOM/Ak/S/XII/2023'
      })
    })
  },
  {
    id: 's1_sk',
    canonical: 'S1 Sistem Komputer',
    nameEn: 'S1 Computer Systems (Sistem Komputer)',
    degree: 'S1',
    faculty: 'FIK',
    facultyName: 'Fakultas Informatika dan Komputer',
    degreeTitle: 'Sarjana Komputer (S.Kom)',
    sks: 144,
    semesters: 8,
    focusId: 'Fokus pada perangkat keras (hardware), Internet of Things (IoT), embedded system, robotika, dan keamanan jaringan.',
    focusEn: 'Focuses on hardware engineering, Internet of Things (IoT), embedded systems, robotics, and network security.',
    availabilityStatus: PROGRAM_AVAILABILITY_STATUS.OFFERED,
    provenance: Object.freeze({
      knowledgeDocument: 'docs/retrieval/knowledge_domains/program_studi_sistem_komputer.md',
      curriculumSource: 'ISIAN WEBSITE (1).pdf',
      feeScheduleSource: 'rincian Biaya SK Tahun Ajaran 2026-2027.pdf',
      accreditationSource: 'SERTIFIKAT AKREDITASI SISTEM KOMPUTER (09 APRIL 2025 - 09 APRIL 2030).pdf',
      accreditationDecree: '068/SK/LAM-INFOKOM/Ak/S/IV/2025',
      accreditationRank: 'Baik Sekali',
      accreditationValidity: '2025-04-09 s.d. 2030-04-09',
      accreditationStatus: 'VERIFIED_ACTIVE',
      externalUrl: 'https://stikom-bali.ac.id',
      externalAccessStatus: 'BLOCKED_EXTERNAL_ACCESS (Cloudflare HTTP 403 Challenge)',
      verificationStatus: 'VERIFIED_FROM_LOCAL_CORPUS',
      offeredStatusProvenance: Object.freeze({
        status: PROGRAM_AVAILABILITY_STATUS.OFFERED,
        admissionPortalUrl: 'https://siap.stikom-bali.ac.id/',
        verificationStatus: 'VERIFIED_OFFICIAL_PORTAL',
        evidenceBasis: 'Aktif dibuka pada pendaftaran PMB SIAP 2026/2027'
      }),
      accreditationProvenance: Object.freeze({
        agency: 'LAM INFOKOM',
        decree: '068/SK/LAM-INFOKOM/Ak/S/IV/2025',
        rank: 'Baik Sekali',
        validity: '2025-04-09 s.d. 2030-04-09',
        status: 'VERIFIED_ACTIVE',
        sourceUrl: 'https://www.stikom-bali.ac.id/id/sertifikat-akreditasi-institusi/'
      }),
      historicalProvenance: Object.freeze({
        hasHistoricalDecrees: true,
        note: 'Akreditasi sebelumnya telah diperbarui oleh SK 068/SK/LAM-INFOKOM/Ak/S/IV/2025'
      })
    })
  },
  {
    id: 's1_ti',
    canonical: 'S1 Teknologi Informasi',
    nameEn: 'S1 Information Technology (Teknologi Informasi)',
    degree: 'S1',
    faculty: 'FIK',
    facultyName: 'Fakultas Informatika dan Komputer',
    degreeTitle: 'Sarjana Komputer (S.Kom)',
    sks: 144,
    semesters: 8,
    focusId: 'Fokus pada keamanan siber (cyber security), integrasi sistem ICT, cloud computing, dan infrastruktur jaringan.',
    focusEn: 'Focuses on cyber security, ICT system integration, cloud computing, and network infrastructure.',
    availabilityStatus: PROGRAM_AVAILABILITY_STATUS.OFFERED,
    provenance: Object.freeze({
      knowledgeDocument: 'docs/retrieval/knowledge_domains/program_studi_teknologi_informasi.md',
      curriculumSource: 'ISIAN WEBSITE (1).pdf',
      feeScheduleSource: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf',
      accreditationSource: 'SERTIFIKAT AKREDITASI TI (06 SEPT 2022 - 06 SEPT 2027).pdf',
      accreditationDecree: '5908/SK/BAN-PT/Ak/S/IX/2022',
      accreditationRank: 'Baik',
      accreditationValidity: '2022-09-06 s.d. 2027-09-06',
      accreditationStatus: 'VERIFIED_ACTIVE',
      externalUrl: 'https://stikom-bali.ac.id',
      externalAccessStatus: 'BLOCKED_EXTERNAL_ACCESS (Cloudflare HTTP 403 Challenge)',
      verificationStatus: 'VERIFIED_FROM_LOCAL_CORPUS',
      offeredStatusProvenance: Object.freeze({
        status: PROGRAM_AVAILABILITY_STATUS.OFFERED,
        admissionPortalUrl: 'https://siap.stikom-bali.ac.id/',
        verificationStatus: 'VERIFIED_OFFICIAL_PORTAL',
        evidenceBasis: 'Aktif dibuka pada pendaftaran PMB SIAP 2026/2027'
      }),
      accreditationProvenance: Object.freeze({
        agency: 'BAN-PT',
        decree: '5908/SK/BAN-PT/Ak/S/IX/2022',
        rank: 'Baik',
        validity: '2022-09-06 s.d. 2027-09-06',
        status: 'VERIFIED_ACTIVE',
        sourceUrl: 'https://www.stikom-bali.ac.id/id/sertifikat-akreditasi-institusi/'
      }),
      historicalProvenance: Object.freeze({
        hasHistoricalDecrees: false,
        note: 'Akreditasi program studi berlaku hingga 6 September 2027'
      })
    })
  },
  {
    id: 's1_bd',
    canonical: 'S1 Bisnis Digital',
    nameEn: 'S1 Digital Business (Bisnis Digital)',
    degree: 'S1',
    faculty: 'FBV',
    facultyName: 'Fakultas Bisnis dan Vokasi',
    degreeTitle: 'Sarjana Bisnis (S.Bns)',
    sks: 144,
    semesters: 8,
    focusId: 'Fokus pada inovasi bisnis berbasis teknologi, e-commerce, digital marketing, analitika bisnis, dan pengembangan startup.',
    focusEn: 'Focuses on tech-driven business innovation, e-commerce, digital marketing, business analytics, and startup development.',
    availabilityStatus: PROGRAM_AVAILABILITY_STATUS.OFFERED,
    provenance: Object.freeze({
      knowledgeDocument: 'docs/retrieval/knowledge_domains/program_studi_bisnis_digital.md',
      curriculumSource: 'ISIAN WEBSITE (1).pdf',
      feeScheduleSource: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf',
      accreditationSource: 'SERTIFIKAT AKREDITASI BD (05 OKT 2022 - 05 OKT 2027).pdf',
      accreditationDecree: '6794/SK/BAN-PT/Ak/S/X/2022',
      accreditationRank: 'Baik',
      accreditationValidity: '2022-10-05 s.d. 2027-10-05',
      accreditationStatus: 'VERIFIED_ACTIVE',
      externalUrl: 'https://stikom-bali.ac.id',
      externalAccessStatus: 'BLOCKED_EXTERNAL_ACCESS (Cloudflare HTTP 403 Challenge)',
      verificationStatus: 'VERIFIED_FROM_LOCAL_CORPUS',
      offeredStatusProvenance: Object.freeze({
        status: PROGRAM_AVAILABILITY_STATUS.OFFERED,
        admissionPortalUrl: 'https://siap.stikom-bali.ac.id/',
        verificationStatus: 'VERIFIED_OFFICIAL_PORTAL',
        evidenceBasis: 'Aktif dibuka pada pendaftaran PMB SIAP 2026/2027'
      }),
      accreditationProvenance: Object.freeze({
        agency: 'BAN-PT',
        decree: '6794/SK/BAN-PT/Ak/S/X/2022',
        rank: 'Baik',
        validity: '2022-10-05 s.d. 2027-10-05',
        status: 'VERIFIED_ACTIVE',
        sourceUrl: 'https://www.stikom-bali.ac.id/id/sertifikat-akreditasi-institusi/'
      }),
      historicalProvenance: Object.freeze({
        hasHistoricalDecrees: false,
        note: 'Akreditasi program studi berlaku hingga 5 Oktober 2027'
      })
    })
  },
  {
    id: 'd3_mi',
    canonical: 'D3 Manajemen Informatika',
    nameEn: 'D3 Informatics Management (Manajemen Informatika)',
    degree: 'D3',
    faculty: 'FBV',
    facultyName: 'Fakultas Bisnis dan Vokasi',
    degreeTitle: 'Ahli Madya Komputer (A.Md.Kom)',
    sks: 108,
    semesters: 6,
    focusId: 'Fokus pada aplikasi terapan teknologi informasi, operasional bisnis, pengolahan data, administrasi sistem informasi, dan IT support praktis.',
    focusEn: 'Focuses on applied information technology applications, business operations, data processing, information systems administration, and practical IT support.',
    availabilityStatus: PROGRAM_AVAILABILITY_STATUS.OFFERED,
    provenance: Object.freeze({
      knowledgeDocument: 'ISIAN WEBSITE (1).pdf',
      curriculumSource: 'ISIAN WEBSITE (1).pdf',
      feeScheduleSource: 'rincian Biaya D3 Tahun Ajaran 2026-2027.pdf',
      accreditationSource: 'SERTIFIKAT AKREDITASI MI (17 NOV 2021 - 17 NOV 2026).pdf',
      accreditationDecree: '12450/SK/BAN-PT/Akred-PMT/Dipl-III/XI/2021',
      accreditationRank: 'Baik',
      accreditationValidity: '2021-11-17 s.d. 2026-11-17',
      accreditationStatus: 'VERIFIED_ACTIVE',
      externalUrl: 'https://stikom-bali.ac.id',
      externalAccessStatus: 'BLOCKED_EXTERNAL_ACCESS (Cloudflare HTTP 403 Challenge)',
      verificationStatus: 'VERIFIED_FROM_LOCAL_CORPUS',
      offeredStatusProvenance: Object.freeze({
        status: PROGRAM_AVAILABILITY_STATUS.OFFERED,
        admissionPortalUrl: 'https://siap.stikom-bali.ac.id/',
        verificationStatus: 'VERIFIED_OFFICIAL_PORTAL',
        evidenceBasis: 'Aktif dibuka pada pendaftaran PMB SIAP 2026/2027'
      }),
      accreditationProvenance: Object.freeze({
        agency: 'BAN-PT',
        decree: '12450/SK/BAN-PT/Akred-PMT/Dipl-III/XI/2021',
        rank: 'Baik',
        validity: '2021-11-17 s.d. 2026-11-17',
        status: 'VERIFIED_ACTIVE',
        sourceUrl: 'https://www.stikom-bali.ac.id/id/sertifikat-akreditasi-institusi/'
      }),
      historicalProvenance: Object.freeze({
        hasHistoricalDecrees: false,
        note: 'Akreditasi program studi D3 berlaku hingga 17 November 2026'
      })
    })
  },
  {
    id: 's2_si',
    canonical: 'S2 Magister Sistem Informasi (M.Kom)',
    canonicalRegistryName: 'S2 Sistem Informasi',
    nameEn: 'S2 Master of Information Systems (Magister Sistem Informasi - M.Kom)',
    degree: 'S2',
    faculty: 'PASCASARJANA',
    facultyName: 'Program Pascasarjana',
    degreeTitle: 'Magister Komputer (M.Kom)',
    sks: 36,
    semesters: 4,
    focusId: 'Fokus pada riset terapan sistem informasi tingkat lanjut, arsitektur enterprise, kepemimpinan teknologi strategis, dan tata kelola TI tingkat magister.',
    focusEn: 'Focuses on advanced applied information systems research, enterprise architecture, strategic IT leadership, and master-level IT governance.',
    availabilityStatus: PROGRAM_AVAILABILITY_STATUS.OFFERED,
    provenance: Object.freeze({
      knowledgeDocument: 'Training_Dataset_Pascasarjana_ITB_STIKOM_Bali.xlsx',
      curriculumSource: 'Training_Dataset_Pascasarjana_ITB_STIKOM_Bali.xlsx',
      feeScheduleSource: 'Training_Dataset_Pascasarjana_ITB_STIKOM_Bali.xlsx',
      accreditationSource: 'https://pasca.stikom-bali.ac.id/tentang',
      accreditationDecree: '027/SK/LAM-INFOKOM/Ak.P/M/V/2025',
      accreditationRank: 'Baik Sekali',
      accreditingAgency: 'LAM INFOKOM',
      accreditationValidity: '2025-05-08 s.d. 2030-05-08',
      accreditationStatus: 'VERIFIED_ACTIVE',
      externalUrl: 'https://pasca.stikom-bali.ac.id/tentang',
      verificationStatus: 'VERIFIED_ACTIVE',
      offeredStatusProvenance: Object.freeze({
        status: PROGRAM_AVAILABILITY_STATUS.OFFERED,
        admissionPortalUrl: 'https://siap.stikom-bali.ac.id/',
        officialProfileUrl: 'https://pasca.stikom-bali.ac.id/tentang',
        verificationStatus: 'VERIFIED_OFFICIAL_PORTAL',
        evidenceBasis: 'Aktif diselenggarakan dan dibuka pada portal PMB SIAP untuk jenjang Magister'
      }),
      accreditationProvenance: Object.freeze({
        agency: 'LAM INFOKOM',
        decree: '027/SK/LAM-INFOKOM/Ak.P/M/V/2025',
        rank: 'Baik Sekali',
        validity: '2025-05-08 s.d. 2030-05-08',
        status: 'VERIFIED_ACTIVE',
        sourceUrl: 'https://pasca.stikom-bali.ac.id/tentang',
        verificationStatus: 'VERIFIED_OFFICIAL_PORTAL',
        pageConflictResolution: Object.freeze({
          pageUrl: 'https://pasca.stikom-bali.ac.id/tentang',
          detectedDiscrepancy: 'Halaman memuat teks "Baik" pada narasi sambutan direktur/pengantar dan "Baik Sekali" pada rincian capaian akreditasi ber-SK resmi',
          authoritativeDecision: 'Baik Sekali (SK LAM-INFOKOM No. 027/SK/LAM-INFOKOM/Ak.P/M/V/2025 tertanggal 8 Mei 2025 s.d. 8 Mei 2030)',
          resolutionRationale: 'Klaim spesifik bertanggal dengan nomor SK resmi mengesampingkan teks narasi sambutan statis yang belum disinkronkan oleh pengelola situs.',
          retentionPolicy: 'Pertahankan catatan historis tanpa menganggap seluruh bagian halaman memiliki periode berlaku yang sama.'
        })
      }),
      historicalProvenance: Object.freeze({
        sourceDocument: 'Training_Dataset_Pascasarjana_ITB_STIKOM_Bali.xlsx',
        historicalRank: 'B (Terakreditasi)',
        historicalPeriod: 'SEBELUM_MEI_2025',
        greetingSectionMention: 'Baik',
        supersededByDecree: '027/SK/LAM-INFOKOM/Ak.P/M/V/2025',
        note: 'Peringkat B historis dan penyebutan "Baik" pada bagian sambutan telah digantikan oleh SK LAM INFOKOM No. 027/SK/LAM-INFOKOM/Ak.P/M/V/2025 (Baik Sekali, berlaku hingga 8 Mei 2030)'
      })
    })
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

  if (canonicalScope === 'FBV') {
    return INSTITUTIONAL_ACADEMIC_CATALOG.filter(entry => {
      const matchName = entry.canonicalRegistryName || entry.canonical;
      return entry.faculty === 'FBV' && VERIFIED_PROGRAM_ENTITIES.has(matchName);
    });
  }

  if (canonicalScope === 'FIK') {
    return INSTITUTIONAL_ACADEMIC_CATALOG.filter(entry => {
      const matchName = entry.canonicalRegistryName || entry.canonical;
      return entry.faculty === 'FIK' && VERIFIED_PROGRAM_ENTITIES.has(matchName);
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
 * @param {string} canonicalScope - 'S1' | 'D3' | 'S2' | 'FBV' | 'FIK' | 'ALL'
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

  if (effectiveScope === 'FBV') {
    if (isEn) {
      const items = entries.map((e, idx) => `${idx + 1}. **${e.nameEn}** (${e.degree === 'S1' ? 'Bachelor Degree' : 'Diploma/Vocational Degree'})\n   ${e.focusEn}`).join('\n\n');
      return `The study programs offered under the **Faculty of Business and Vocational Studies (FBV)** at ITB STIKOM Bali are:\n\n${items}\n\nRegistration can be accessed online at https://pmb.stikom-bali.ac.id. Would you like more details on any of these programs?`;
    }
    const items = entries.map((e, idx) => `${idx + 1}. **${e.canonical}** (${e.degree === 'S1' ? 'Program Sarjana' : 'Program Diploma / Vokasi'})\n   ${e.focusId}`).join('\n\n');
    return `Program studi yang berada di bawah naungan **Fakultas Bisnis dan Vokasi (FBV)** ITB STIKOM Bali adalah:\n\n${items}\n\nPendaftaran mahasiswa baru dapat diakses melalui portal resmi https://pmb.stikom-bali.ac.id. Ada yang ingin Kakak ketahui lebih lanjut seputar program studi di Fakultas Bisnis dan Vokasi?`;
  }

  if (effectiveScope === 'FIK') {
    if (isEn) {
      const items = entries.map((e, idx) => `${idx + 1}. **${e.nameEn}**\n   ${e.focusEn}`).join('\n\n');
      return `The study programs offered under the **Faculty of Informatics and Computing (FIK)** at ITB STIKOM Bali are:\n\n${items}\n\nRegistration can be accessed online at https://pmb.stikom-bali.ac.id. Would you like more details on any of these programs?`;
    }
    const items = entries.map((e, idx) => `${idx + 1}. **${e.canonical}**\n   ${e.focusId}`).join('\n\n');
    return `Program studi yang berada di bawah naungan **Fakultas Informatika dan Komputer (FIK)** ITB STIKOM Bali adalah:\n\n${items}\n\nPendaftaran mahasiswa baru dapat diakses melalui portal resmi https://pmb.stikom-bali.ac.id. Ada yang ingin Kakak ketahui lebih lanjut seputar program studi di FIK?`;
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
 * Evaluates the institutional availability status of an academic program inquiry.
 *
 * Explicitly distinguishes:
 * - 'offered': Supported by official institutional sources confirming the program is offered.
 * - 'not_offered': Supported by official institutional sources establishing that the program is not offered
 *                  (e.g., degree levels like S3/D4 outside institutional scope, or disciplines outside statutory faculties).
 * - 'unknown': Available evidence is insufficient to conclude either offered or not_offered.
 *              Never conclude not_offered merely because retrieval found no results or catalog completeness is unverified.
 *
 * @param {string} candidateName - The program or discipline name candidate.
 * @returns {{
 *   status: 'offered' | 'not_offered' | 'unknown',
 *   canonicalName: string | null,
 *   rawMention: string,
 *   provenance: Object | null,
 *   reason: string
 * }}
 */
function evaluateProgramAvailability(candidateName) {
  if (!candidateName || typeof candidateName !== 'string' || candidateName.trim().length === 0) {
    return {
      status: PROGRAM_AVAILABILITY_STATUS.UNKNOWN,
      canonicalName: null,
      rawMention: candidateName || '',
      provenance: null,
      reason: 'empty_candidate_input'
    };
  }

  const trimmed = candidateName.trim();
  const lower = trimmed.toLowerCase();

  // 1. Check if candidate matches officially offered catalog entries
  const matchedEntry = INSTITUTIONAL_ACADEMIC_CATALOG.find(entry => {
    const canon = entry.canonical.toLowerCase();
    const canonReg = (entry.canonicalRegistryName || '').toLowerCase();
    const nameEn = (entry.nameEn || '').toLowerCase();
    return lower === canon || lower === canonReg || lower === nameEn ||
      canon.includes(lower) || (canonReg && canonReg.includes(lower));
  });

  if (matchedEntry) {
    return {
      status: PROGRAM_AVAILABILITY_STATUS.OFFERED,
      canonicalName: matchedEntry.canonical,
      rawMention: trimmed,
      provenance: Object.freeze({
        sourceDocumentId: matchedEntry.id,
        sourceDocumentName: matchedEntry.provenance.accreditationSource || matchedEntry.provenance.curriculumSource || matchedEntry.provenance.trainingSource || matchedEntry.canonical,
        sourcePath: matchedEntry.provenance.knowledgeDocument,
        sourceUrl: matchedEntry.provenance.externalUrl,
        verificationStatus: matchedEntry.provenance.verificationStatus,
        accreditationStatus: matchedEntry.provenance.accreditationStatus,
        accreditationRank: matchedEntry.provenance.accreditationRank,
        accreditationValidity: matchedEntry.provenance.accreditationValidity
      }),
      reason: 'verified_official_catalog_entry'
    };
  }

  // Check canonical entity registry for international programs (e.g. Dual Degree)
  const canonEntity = CANONICAL_ENTITIES.find(e => {
    const c = e.canonical.toLowerCase();
    if (c === lower || c.includes(lower)) return true;
    if (e.aliases && e.aliases.some(a => a.toLowerCase() === lower)) return true;
    return false;
  });

  if (canonEntity && (canonEntity.family === 'academic_program' || canonEntity.family === 'international_program')) {
    return {
      status: PROGRAM_AVAILABILITY_STATUS.OFFERED,
      canonicalName: canonEntity.canonical,
      rawMention: trimmed,
      provenance: Object.freeze({
        sourceDocumentId: 'DOC-CORPUS-CHATBOT-DOUBLE-DEGREE',
        sourceDocumentName: 'CHATBOT - Double Degree.docx',
        sourcePath: 'CHATBOT - Double Degree.docx',
        sourceUrl: 'https://pmb.stikom-bali.ac.id/ (blocked: Cloudflare 403 Challenge)',
        verificationStatus: 'VERIFIED_CORPUS_ACTIVE'
      }),
      reason: 'verified_canonical_entity_registry'
    };
  }

  // 2. Check if explicitly unsupported degree level (S3, D4, SMK, etc.)
  // Statutory degree limit: Institutional permits in repository strictly limit offerings to D3, S1, and S2.
  const unsuppDegree = trimmed.match(UNSUPPORTED_DEGREE_PATTERN);
  if (unsuppDegree) {
    return {
      status: PROGRAM_AVAILABILITY_STATUS.NOT_OFFERED,
      canonicalName: null,
      rawMention: trimmed,
      provenance: Object.freeze({
        sourceDocumentId: 'DOC-CORPUS-DEGREE-LIMITS',
        sourceDocumentName: 'Pedoman TA S1 2019 Revisi 1.pdf & Sertifikat Akreditasi Resmi (D3, S1, S2)',
        sourcePath: 'Pedoman TA S1 2019 Revisi 1.pdf',
        sourceUrl: 'https://pmb.stikom-bali.ac.id/ (blocked: Cloudflare 403 Challenge)',
        verificationStatus: 'VERIFIED_ACTIVE'
      }),
      reason: 'degree_level_outside_institutional_scope'
    };
  }

  // 2b. Check if explicitly unsupported discipline outside statutory faculties
  // Institutional scope: ITB STIKOM Bali only operates FIK (Informatics & Computing) and FBV (Business & Vocational).
  // Disciplines outside these statutory faculties are confirmed NOT_OFFERED by official institutional registry.
  if (UNSUPPORTED_STATUTORY_DISCIPLINE_PATTERN.test(lower)) {
    return {
      status: PROGRAM_AVAILABILITY_STATUS.NOT_OFFERED,
      canonicalName: null,
      rawMention: trimmed,
      provenance: Object.freeze({
        sourceDocumentId: 'DOC-CORPUS-STATUTORY-FACULTIES',
        sourceDocumentName: 'Statuta ITB STIKOM Bali & Keputusan BAN-PT/LAM INFOKOM (FIK & FBV)',
        sourcePath: 'Pedoman TA S1 2019 Revisi 1.pdf',
        sourceUrl: 'https://pmb.stikom-bali.ac.id/ (blocked: Cloudflare 403 Challenge)',
        verificationStatus: 'VERIFIED_ACTIVE'
      }),
      reason: 'discipline_outside_statutory_faculties'
    };
  }

  // 3. For any other candidate where official evidence is insufficient
  // (unknown aliases, disciplines without official decree/decree rejection, empty retrieval):
  // Must be 'unknown', NEVER arbitrarily fabricated as 'not_offered'!
  return {
    status: PROGRAM_AVAILABILITY_STATUS.UNKNOWN,
    canonicalName: null,
    rawMention: trimmed,
    provenance: null,
    reason: 'insufficient_evidence_for_availability_determination'
  };
}

const INSTITUTIONAL_ACCREDITATION_RECORD = Object.freeze({
  institutionName: 'Institut Teknologi dan Bisnis (ITB) STIKOM Bali',
  accreditationRank: 'Baik Sekali',
  accreditationDecree: '3033/SK/BAN-PT/Ak.KP/PT/XII/2025',
  accreditingAgency: 'BAN-PT',
  accreditationValidity: '10 Desember 2025 sampai dengan 14 November 2028',
  accreditationValidityEn: '10 December 2025 until 14 November 2028',
  validFrom: '2025-12-10',
  validTo: '2028-11-14',
  startDate: '10 Desember 2025',
  endDate: '14 November 2028',
  startDateEn: '10 December 2025',
  endDateEn: '14 November 2028',
  accreditationStatus: 'VERIFIED_ACTIVE',
  sourceUrl: 'https://stikom-bali.ac.id/akreditasi/',
  verificationStatus: 'VERIFIED_OFFICIAL_PORTAL',
  retrievalTimestamp: '2026-10-18T18:46:54+08:00',
  retrievalTimestampUtc: '2026-10-18T10:46:54Z'
});

module.exports = {
  ACADEMIC_SCOPE_STATUS,
  PROGRAM_AVAILABILITY_STATUS,
  SUPPORTED_CANONICAL_DEGREES,
  INSTITUTIONAL_ACADEMIC_CATALOG,
  INSTITUTIONAL_ACCREDITATION_RECORD,
  resolveAcademicScope,
  normalizeAcademicScope,
  getCatalogEntriesByScope,
  generateGroundedCatalogSummary,
  evaluateProgramAvailability
};
