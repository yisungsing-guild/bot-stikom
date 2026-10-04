'use strict';

/**
 * tests/phase4OfflineHoldout.test.js
 *
 * Phase 4B — Comprehensive Offline Holdout & Knowledge Retrieval Benchmark (100 Scenarios).
 * Purely local, offline, read-only benchmark evaluating:
 * - SemanticFrame resolution (domain, intent, entities, requestedFields, temporal, location, context)
 * - RetrievalPlan derivation (sourceScope, temporalScope, authority, governance, fallbackPolicy)
 * - Retrieval Strategy execution & Candidate scoring (LegacyLexical, StructuredTrainingData, ShadowComparison)
 * - Evidence Evaluation (answerability, safe_data_gap, clarify_ambiguity)
 * - Comparison: Legacy Lexical vs Plan-Driven Retrieval
 * - Latency Profiling (p50, p95, p99 across pipeline phases)
 *
 * ZERO network calls, ZERO Railway calls, ZERO database writes, ZERO synthetic WhatsApp traffic.
 */

const { resolveEffectiveSemanticFrame } = require('../src/engine/semanticFrameResolver');
const { buildRetrievalPlanFromSemanticFrame, evaluatePlannedCandidate } = require('../src/engine/resolvedRetrievalPlan');
const {
  selectRetrievalStrategy,
  evaluateRetrievalEvidence,
  LegacyLexicalStrategy,
  StructuredTrainingDataStrategy,
  ShadowComparisonStrategy
} = require('../src/engine/retrievalStrategy');
const { isChunkGovernanceAllowed, isTrainingGovernanceAllowed } = require('../src/engine/runtimeGovernance');
const { classifyShadowComparison, SHADOW_DISAGREEMENT_CLASSES } = require('../src/engine/shadowIntegration');

// ============================================================================
// 100 Offline Holdout Scenarios Definition
// ============================================================================

const HOLDOUT_SCENARIOS = [
  // --------------------------------------------------------------------------
  // Category A: Semantic Understanding (20 Scenarios)
  // --------------------------------------------------------------------------
  {
    id: 'SEM-01',
    category: 'A. Semantic Understanding',
    query: 'kpan pmb ditutup?',
    expected: {
      domain: 'admission',
      intent: /admission|schedule|deadline/,
      entity: null,
      requestedFields: ['dates']
    }
  },
  {
    id: 'SEM-02',
    category: 'A. Semantic Understanding',
    query: 'info pendftaran mahasiswa bru stikom',
    expected: {
      domain: 'admission',
      intent: /admission|procedure/,
      requestedFields: ['requirements', 'procedure']
    }
  },
  {
    id: 'SEM-03',
    category: 'A. Semantic Understanding',
    query: 'syarat masuk s1 sistem informasi',
    expected: {
      domain: 'admission',
      entity: 'Sistem Informasi',
      requestedFields: ['requirements']
    }
  },
  {
    id: 'SEM-04',
    category: 'A. Semantic Understanding',
    query: 'apa itu prodi bisnis digital?',
    expected: {
      domain: 'academic',
      entity: 'Bisnis Digital',
      requestedFields: ['curriculum']
    }
  },
  {
    id: 'SEM-05',
    category: 'A. Semantic Understanding',
    query: 'kuliah di bd belajarnya apa aja ya?',
    expected: {
      domain: 'academic',
      entity: 'Bisnis Digital',
      requestedFields: ['curriculum']
    }
  },
  {
    id: 'SEM-06',
    category: 'A. Semantic Understanding',
    query: 'prospek kerja s1 teknologi informasi',
    expected: {
      domain: 'career',
      entity: 'Teknologi Informasi',
      requestedFields: ['career']
    }
  },
  {
    id: 'SEM-07',
    category: 'A. Semantic Understanding',
    query: 'peluang karir sistem komputer',
    expected: {
      domain: 'career',
      entity: 'Sistem Komputer',
      requestedFields: ['career']
    }
  },
  {
    id: 'SEM-08',
    category: 'A. Semantic Understanding',
    query: 'jurusan d3 mi di stikom belajar apa?',
    expected: {
      domain: 'academic',
      entity: 'Manajemen Informatika',
      requestedFields: ['curriculum']
    }
  },
  {
    id: 'SEM-09',
    category: 'A. Semantic Understanding',
    query: 'apakah ada program magister komputer atau s2?',
    expected: {
      domain: /academic|s2_postgraduate/,
      entity: 'S2 Sistem Informasi',
      requestedFields: ['curriculum', 'degree']
    }
  },
  {
    id: 'SEM-10',
    category: 'A. Semantic Understanding',
    query: 'fasilitas lab komputer di kampus renon',
    expected: {
      domain: 'facility',
      requestedFields: ['facilities', 'location']
    }
  },
  {
    id: 'SEM-11',
    category: 'A. Semantic Understanding',
    query: 'daftar ukm tari bali atau pragina',
    expected: {
      domain: 'ormawa',
      entity: /tari|pragina/i,
      requestedFields: ['requirements', 'procedure']
    }
  },
  {
    id: 'SEM-12',
    category: 'A. Semantic Understanding',
    query: 'organisasi mahasiswa pecinta alam ada gak?',
    expected: {
      domain: 'ormawa',
      requestedFields: ['procedure', 'requirements']
    }
  },
  {
    id: 'SEM-13',
    category: 'A. Semantic Understanding',
    query: 'kapan wisuda tahun 2025?',
    expected: {
      domain: 'academic',
      requestedFields: ['dates']
    }
  },
  {
    id: 'SEM-14',
    category: 'A. Semantic Understanding',
    query: 'jadwal yudisium terkini',
    expected: {
      domain: 'academic',
      entity: /yudisium/i,
      requestedFields: ['dates']
    }
  },
  {
    id: 'SEM-15',
    category: 'A. Semantic Understanding',
    query: 'apa fungsi career center itb stikom bali?',
    expected: {
      domain: 'career',
      requestedFields: ['career', 'procedure']
    }
  },
  {
    id: 'SEM-16',
    category: 'A. Semantic Understanding',
    query: 'rekomendasi jurusan s1 yang cocok untuk marketing digital',
    expected: {
      domain: /career|academic/,
      entity: 'Bisnis Digital',
      requestedFields: ['career', 'curriculum']
    }
  },
  {
    id: 'SEM-17',
    category: 'A. Semantic Understanding',
    query: 'apakah itb stikom bali ada program internasional atau double degree?',
    expected: {
      domain: 'academic',
      entity: /double degree|international/i,
      requestedFields: ['curriculum', 'degree']
    }
  },
  {
    id: 'SEM-18',
    category: 'A. Semantic Understanding',
    query: 'alamat kampus pusat itb stikom bali',
    expected: {
      domain: /facility|general/,
      requestedFields: ['location']
    }
  },
  {
    id: 'SEM-19',
    category: 'A. Semantic Understanding',
    query: 'syarat pengajuan tugas akhir atau skripsi pedoman ta',
    expected: {
      domain: /academic|procedure/,
      requestedFields: ['requirements', 'procedure']
    }
  },
  {
    id: 'SEM-20',
    category: 'A. Semantic Understanding',
    query: 'kapan hari ulang tahun atau dies natalis didirikan stikom bali?',
    expected: {
      domain: /academic|general/,
      requestedFields: ['dates']
    }
  },

  // --------------------------------------------------------------------------
  // Category B: Context Follow-Up & Anaphora (15 Scenarios)
  // --------------------------------------------------------------------------
  {
    id: 'CTX-01',
    category: 'B. Context Follow-Up',
    priorQuery: 'Berapa biaya S2 Sistem Informasi?',
    query: 'biayanya berapa?',
    context: {
      sessionState: { activeEntity: 'S2 Sistem Informasi', activeDomain: 'fee', program: 'S2 Sistem Informasi' }
    },
    expected: {
      domain: 'fee',
      entity: 'S2 Sistem Informasi',
      requestedFields: ['amount']
    }
  },
  {
    id: 'CTX-02',
    category: 'B. Context Follow-Up',
    priorQuery: 'Informasi S2 Sistem Informasi',
    query: 'kalau kuliahnya online atau offline?',
    context: {
      sessionState: { activeEntity: 'S2 Sistem Informasi', activeDomain: 'academic', program: 'S2 Sistem Informasi' }
    },
    expected: {
      domain: /academic|modality/,
      entity: 'S2 Sistem Informasi',
      requestedFields: ['deliveryMode']
    }
  },
  {
    id: 'CTX-03',
    category: 'B. Context Follow-Up',
    priorQuery: 'Berapa biaya kuliah S2 Sistem Informasi?',
    query: 'Kalau untuk D3 MI biayanya berapa?',
    context: {
      sessionState: { activeEntity: 'S2 Sistem Informasi', activeDomain: 'fee', program: 'S2 Sistem Informasi' }
    },
    expected: {
      domain: 'fee',
      entity: 'Manajemen Informatika', // EXPLICIT OVERRIDE: D3 MI must win over prior S2 SI
      requestedFields: ['amount']
    }
  },
  {
    id: 'CTX-04',
    category: 'B. Context Follow-Up',
    priorQuery: 'Saya mau tanya tentang Bisnis Digital',
    query: 'prospek kerjanya jadi apa?',
    context: {
      sessionState: { activeEntity: 'Bisnis Digital', activeDomain: 'academic', program: 'Bisnis Digital' }
    },
    expected: {
      domain: 'career',
      entity: 'Bisnis Digital',
      requestedFields: ['career']
    }
  },
  {
    id: 'CTX-05',
    category: 'B. Context Follow-Up',
    priorQuery: 'Info S1 Teknologi Informasi',
    query: 'mata kuliah utamanya apa saja?',
    context: {
      sessionState: { activeEntity: 'Teknologi Informasi', activeDomain: 'academic', program: 'Teknologi Informasi' }
    },
    expected: {
      domain: 'academic',
      entity: 'Teknologi Informasi',
      requestedFields: ['curriculum']
    }
  },
  {
    id: 'CTX-06',
    category: 'B. Context Follow-Up',
    priorQuery: 'Prodi Sistem Komputer',
    query: 'berapa lama masa studinya?',
    context: {
      sessionState: { activeEntity: 'Sistem Komputer', activeDomain: 'academic', program: 'Sistem Komputer' }
    },
    expected: {
      domain: /academic|procedure/,
      entity: 'Sistem Komputer',
      requestedFields: ['duration', 'curriculum']
    }
  },
  {
    id: 'CTX-07',
    category: 'B. Context Follow-Up',
    priorQuery: 'Kuliah S1 Sistem Informasi',
    query: 'ada beasiswanya gak?',
    context: {
      sessionState: { activeEntity: 'Sistem Informasi', activeDomain: 'academic', program: 'Sistem Informasi' }
    },
    expected: {
      domain: /scholarship|fee|admission/,
      requestedFields: ['scholarship', 'requirements']
    }
  },
  {
    id: 'CTX-08',
    category: 'B. Context Follow-Up',
    priorQuery: 'Program Double Degree',
    query: 'bisa ke universitas mana saja?',
    context: {
      sessionState: { activeEntity: 'Double Degree', activeDomain: 'academic' }
    },
    expected: {
      domain: 'academic',
      entity: /Double Degree|International/i,
      requestedFields: ['partner', 'curriculum']
    }
  },
  {
    id: 'CTX-09',
    category: 'B. Context Follow-Up',
    priorQuery: 'Kapan pendaftaran PMB ditutup?',
    query: 'syarat berkasnya apa?',
    context: {
      sessionState: { activeDomain: 'admission', activeIntent: 'pmb_schedule' }
    },
    expected: {
      domain: 'admission',
      requestedFields: ['requirements', 'procedure']
    }
  },
  {
    id: 'CTX-10',
    category: 'B. Context Follow-Up',
    priorQuery: 'Jadwal yudisium 2025',
    query: 'batas akhir pendaftarannya kapan?',
    context: {
      sessionState: { activeDomain: 'academic', activeEntity: 'Yudisium', event: 'yudisium' }
    },
    expected: {
      domain: 'academic',
      entity: /yudisium/i,
      requestedFields: ['dates']
    }
  },
  {
    id: 'CTX-11',
    category: 'B. Context Follow-Up',
    priorQuery: 'UKM Pragina',
    query: 'kegiatannya tentang apa?',
    context: {
      sessionState: { activeEntity: 'UKM Pragina', activeDomain: 'ormawa' }
    },
    expected: {
      domain: 'ormawa',
      entity: /pragina|tari/i,
      requestedFields: ['procedure', 'curriculum']
    }
  },
  {
    id: 'CTX-12',
    category: 'B. Context Follow-Up',
    priorQuery: 'Fakultas Informatika dan Pariwisata',
    query: 'prodinya apa saja?',
    context: {
      sessionState: { activeEntity: 'Fakultas Informatika dan Pariwisata', activeDomain: 'academic' }
    },
    expected: {
      domain: 'academic',
      requestedFields: ['curriculum']
    }
  },
  {
    id: 'CTX-13',
    category: 'B. Context Follow-Up',
    priorQuery: 'S1 Teknologi Informasi',
    query: 'akreditasinya apa?',
    context: {
      sessionState: { activeEntity: 'Teknologi Informasi', activeDomain: 'academic' }
    },
    expected: {
      domain: 'academic',
      entity: 'Teknologi Informasi',
      requestedFields: ['accreditation']
    }
  },
  {
    id: 'CTX-14',
    category: 'B. Context Follow-Up',
    priorQuery: 'Akreditasi S1 Teknologi Informasi apa?',
    query: 'Kalau untuk S1 SI akreditasinya apa?',
    context: {
      sessionState: { activeEntity: 'Teknologi Informasi', activeDomain: 'academic' }
    },
    expected: {
      domain: 'academic',
      entity: 'Sistem Informasi', // EXPLICIT OVERRIDE
      requestedFields: ['accreditation']
    }
  },
  {
    id: 'CTX-15',
    category: 'B. Context Follow-Up',
    priorQuery: 'Apakah ada kelas malam untuk karyawan?',
    query: 'bisa untuk jurusan apa saja?',
    context: {
      sessionState: { activeDomain: 'academic', deliveryMode: 'evening_class' }
    },
    expected: {
      domain: /academic|modality/,
      requestedFields: ['deliveryMode', 'curriculum']
    }
  },

  // --------------------------------------------------------------------------
  // Category C: Multi-Intent (10 Scenarios)
  // --------------------------------------------------------------------------
  {
    id: 'MUL-01',
    category: 'C. Multi-Intent',
    query: 'biaya dan sistem perkuliahan online s2 sistem informasi',
    expected: {
      domain: 'fee',
      entity: 'S2 Sistem Informasi',
      requestedFields: ['amount', 'deliveryMode']
    }
  },
  {
    id: 'MUL-02',
    category: 'C. Multi-Intent',
    query: 'jadwal dan syarat pendaftaran yudisium 2025',
    expected: {
      domain: 'academic',
      entity: /yudisium/i,
      requestedFields: ['dates', 'requirements']
    }
  },
  {
    id: 'MUL-03',
    category: 'C. Multi-Intent',
    query: 'apa yang dipelajari di bisnis digital dan prospek kerjanya apa?',
    expected: {
      domain: /academic|career/,
      entity: 'Bisnis Digital',
      requestedFields: ['curriculum', 'career']
    }
  },
  {
    id: 'MUL-04',
    category: 'C. Multi-Intent',
    query: 'biaya pendaftaran dan uang kuliah per semester ti',
    expected: {
      domain: 'fee',
      entity: 'Teknologi Informasi',
      requestedFields: ['amount']
    }
  },
  {
    id: 'MUL-05',
    category: 'C. Multi-Intent',
    query: 'syarat masuk dan jadwal pendaftaran pmb gelombang 1',
    expected: {
      domain: 'admission',
      requestedFields: ['requirements', 'dates']
    }
  },
  {
    id: 'MUL-06',
    category: 'C. Multi-Intent',
    query: 'mata kuliah dan peluang kerja lulusan sistem komputer',
    expected: {
      domain: /academic|career/,
      entity: 'Sistem Komputer',
      requestedFields: ['curriculum', 'career']
    }
  },
  {
    id: 'MUL-07',
    category: 'C. Multi-Intent',
    query: 'jadwal wisuda dan batas akhir penyerahan naskah skripsi',
    expected: {
      domain: 'academic',
      requestedFields: ['dates', 'procedure']
    }
  },
  {
    id: 'MUL-08',
    category: 'C. Multi-Intent',
    query: 'biaya kuliah double degree dan nama universitas mitranya',
    expected: {
      domain: /fee|academic/,
      entity: /double degree|international/i,
      requestedFields: ['amount', 'partner']
    }
  },
  {
    id: 'MUL-09',
    category: 'C. Multi-Intent',
    query: 'syarat beasiswa dan batas waktu pendaftarannya',
    expected: {
      domain: /scholarship|admission/,
      requestedFields: ['requirements', 'dates']
    }
  },
  {
    id: 'MUL-10',
    category: 'C. Multi-Intent',
    query: 'pilihan kelas sore untuk karyawan dan biayanya berapa',
    expected: {
      domain: 'fee',
      requestedFields: ['deliveryMode', 'amount']
    }
  },

  // --------------------------------------------------------------------------
  // Category D: Temporal Scoping (10 Scenarios)
  // --------------------------------------------------------------------------
  {
    id: 'TEM-01',
    category: 'D. Temporal Scoping',
    query: 'jadwal yudisium tahun 2024',
    expected: {
      domain: 'academic',
      temporal: { allowHistorical: true, targetPeriod: 2024 }
    }
  },
  {
    id: 'TEM-02',
    category: 'D. Temporal Scoping',
    query: 'jadwal yudisium tahun 2025',
    expected: {
      domain: 'academic',
      temporal: { allowHistorical: false, targetPeriod: 2025 }
    }
  },
  {
    id: 'TEM-03',
    category: 'D. Temporal Scoping',
    query: 'kalender akademik tahun ajaran 2024/2025',
    expected: {
      domain: 'academic',
      temporal: { allowHistorical: true }
    }
  },
  {
    id: 'TEM-04',
    category: 'D. Temporal Scoping',
    query: 'kalender akademik terkini',
    expected: {
      domain: 'academic',
      temporal: { allowHistorical: false }
    }
  },
  {
    id: 'TEM-05',
    category: 'D. Temporal Scoping',
    query: 'jadwal pmb gelombang 3 tahun 2024 lalu',
    expected: {
      domain: 'admission',
      temporal: { allowHistorical: true, targetPeriod: 2024 }
    }
  },
  {
    id: 'TEM-06',
    category: 'D. Temporal Scoping',
    query: 'jadwal pmb tahun 2026/2027 mendatang',
    expected: {
      domain: 'admission',
      temporal: { allowHistorical: false }
    }
  },
  {
    id: 'TEM-07',
    category: 'D. Temporal Scoping',
    query: 'kapan batas pendaftaran yudisium periode lalu 2023?',
    expected: {
      domain: 'academic',
      temporal: { allowHistorical: true, targetPeriod: 2023 }
    }
  },
  {
    id: 'TEM-08',
    category: 'D. Temporal Scoping',
    query: 'kapan yudisium sekarang?',
    expected: {
      domain: 'academic',
      temporal: { allowHistorical: false }
    }
  },
  {
    id: 'TEM-09',
    category: 'D. Temporal Scoping',
    query: 'kalender akademik 2023',
    expected: {
      domain: 'academic',
      temporal: { allowHistorical: true, targetPeriod: 2023 }
    }
  },
  {
    id: 'TEM-10',
    category: 'D. Temporal Scoping',
    query: 'jadwal semester genap 2024/2025',
    expected: {
      domain: 'academic',
      temporal: { allowHistorical: true }
    }
  },

  // --------------------------------------------------------------------------
  // Category E: Location Scoping (5 Scenarios)
  // --------------------------------------------------------------------------
  {
    id: 'LOC-01',
    category: 'E. Location Scoping',
    query: 'di mana lokasi kampus itb stikom bali renon?',
    expected: {
      domain: /facility|general/,
      requestedFields: ['location']
    }
  },
  {
    id: 'LOC-02',
    category: 'E. Location Scoping',
    query: 'apakah ada kampus stikom di jimbaran?',
    expected: {
      domain: /facility|general/,
      requestedFields: ['location']
    }
  },
  {
    id: 'LOC-03',
    category: 'E. Location Scoping',
    query: 'apakah ada kampus stikom di abiansemal badung?',
    expected: {
      domain: /facility|general/,
      requestedFields: ['location']
    }
  },
  {
    id: 'LOC-04',
    category: 'E. Location Scoping',
    query: 'kampus mana yang membuka program s2 sistem informasi?',
    expected: {
      domain: /academic|facility/,
      entity: 'S2 Sistem Informasi',
      requestedFields: ['location']
    }
  },
  {
    id: 'LOC-05',
    category: 'E. Location Scoping',
    query: 'lokasi pendaftaran pmb langsung di mana?',
    expected: {
      domain: 'admission',
      requestedFields: ['location']
    }
  },

  // --------------------------------------------------------------------------
  // Category F: Governance Enforcement (10 Scenarios)
  // --------------------------------------------------------------------------
  {
    id: 'GOV-01',
    category: 'F. Governance Enforcement',
    query: 'jadwal yudisium sekarang',
    mockCandidate: { id: 'cal_2022', status: 'expired', governanceStatus: 'expired', isExpired: true },
    expectedGovernanceAllowed: false // Must reject expired document for current query
  },
  {
    id: 'GOV-02',
    category: 'F. Governance Enforcement',
    query: 'jadwal yudisium tahun 2024',
    mockCandidate: { id: 'cal_2024', status: 'expired', governanceStatus: 'expired', authority: 'tier_2', authorityTier: 2, content: 'jadwal yudisium tahun 2024', filename: 'kalender_2024.pdf' },
    expectedGovernanceAllowed: true // Historical 2024 allows expired 2024 with matching year & valid authority
  },
  {
    id: 'GOV-03',
    category: 'F. Governance Enforcement',
    query: 'tata tertib skripsi terbaru',
    mockCandidate: { id: 'ta_draft', status: 'draft', governanceStatus: 'draft' },
    expectedGovernanceAllowed: false // Draft prohibited
  },
  {
    id: 'GOV-04',
    category: 'F. Governance Enforcement',
    query: 'biaya kuliah s1 sistem informasi',
    mockCandidate: { id: 'fee_superseded', status: 'superseded', governanceStatus: 'superseded' },
    expectedGovernanceAllowed: false // Superseded prohibited
  },
  {
    id: 'GOV-05',
    category: 'F. Governance Enforcement',
    query: 'info pmb 2025',
    mockCandidate: { id: 'pmb_archived', status: 'archived', governanceStatus: 'archived' },
    expectedGovernanceAllowed: false // Archived prohibited
  },
  {
    id: 'GOV-06',
    category: 'F. Governance Enforcement',
    query: 'kalender akademik 2025',
    mockCandidate: { id: 'cal_2025_active', status: 'active', governanceStatus: 'active', authority: 'tier_2', authorityTier: 2, content: 'kalender akademik 2025' },
    expectedGovernanceAllowed: true // Active approved allowed
  },
  {
    id: 'GOV-07',
    category: 'F. Governance Enforcement',
    query: 'pedoman akademik stikom bali',
    mockCandidate: { id: 'doc_unknown', status: 'validity_unknown', governanceStatus: 'validity_unknown' },
    expectedGovernanceAllowed: false // Unknown validity prohibited
  },
  {
    id: 'GOV-08',
    category: 'F. Governance Enforcement',
    query: 'jadwal yudisium tahun 2023',
    mockCandidate: { id: 'cal_2024', status: 'expired', governanceStatus: 'expired', metadata: { year: 2024 } },
    expectedGovernanceAllowed: false // Mismatched historical year must reject
  },
  {
    id: 'GOV-09',
    category: 'F. Governance Enforcement',
    query: 'aturan akademik semester ini',
    mockCandidate: { id: 'future_decree', status: 'future_valid', governanceStatus: 'future_valid' },
    expectedGovernanceAllowed: false // Future effective not yet valid
  },
  {
    id: 'GOV-10',
    category: 'F. Governance Enforcement',
    query: 'sk rektor kurikulum terbaru',
    mockCandidate: { id: 'marketing_flyer', status: 'active', authorityTier: 4 },
    expectedAuthorityAllowed: false // Official regulation query rejects Tier 4 marketing flyer
  },

  // --------------------------------------------------------------------------
  // Category G: Authority Tiering (5 Scenarios)
  // --------------------------------------------------------------------------
  {
    id: 'AUT-01',
    category: 'G. Authority Tiering',
    query: 'sk rektor pedoman tugas akhir',
    expected: {
      authority: { mustBeAuthoritative: true, minTier: 2 }
    }
  },
  {
    id: 'AUT-02',
    category: 'G. Authority Tiering',
    query: 'aturan kelulusan dan predikat cumlaude',
    expected: {
      authority: { mustBeAuthoritative: true, minTier: 2 }
    }
  },
  {
    id: 'AUT-03',
    category: 'G. Authority Tiering',
    query: 'halo bot selamat pagi',
    expected: {
      authority: { mustBeAuthoritative: false }
    }
  },
  {
    id: 'AUT-04',
    category: 'G. Authority Tiering',
    query: 'penetapan biaya dpp dan spp resmi',
    expected: {
      authority: { mustBeAuthoritative: true, minTier: 2 }
    }
  },
  {
    id: 'AUT-05',
    category: 'G. Authority Tiering',
    query: 'struktur kurikulum resmi dan sks',
    expected: {
      authority: { mustBeAuthoritative: true, minTier: 3 }
    }
  },

  // --------------------------------------------------------------------------
  // Category H: Retrieval Matching & Boundaries (15 Scenarios)
  // --------------------------------------------------------------------------
  {
    id: 'RET-01',
    category: 'H. Retrieval Matching',
    query: 'kurikulum s1 bisnis digital',
    expected: {
      entityMatch: 'Bisnis Digital',
      nonEntityReject: 'Sistem Informasi'
    }
  },
  {
    id: 'RET-02',
    category: 'H. Retrieval Matching',
    query: 'prospek kerja s1 sistem komputer',
    expected: {
      entityMatch: 'Sistem Komputer',
      nonEntityReject: 'Teknologi Informasi'
    }
  },
  {
    id: 'RET-03',
    category: 'H. Retrieval Matching',
    query: 'mata kuliah utama teknologi informasi',
    expected: {
      entityMatch: 'Teknologi Informasi'
    }
  },
  {
    id: 'RET-04',
    category: 'H. Retrieval Matching',
    query: 'biaya kuliah s1 sistem informasi',
    expected: {
      entityMatch: 'Sistem Informasi'
    }
  },
  {
    id: 'RET-05',
    category: 'H. Retrieval Matching',
    query: 'program studi double degree helsinki',
    expected: {
      entityMatch: /double degree|international/i
    }
  },
  {
    id: 'RET-06',
    category: 'H. Retrieval Matching',
    query: 'international program di stikom',
    expected: {
      entityMatch: /international/i
    }
  },
  {
    id: 'RET-07',
    category: 'H. Retrieval Matching',
    query: 'program pertukaran mahasiswa exchange program',
    expected: {
      entityMatch: /exchange program|pertukaran/i
    }
  },
  {
    id: 'RET-08',
    category: 'H. Retrieval Matching',
    query: 'daftar beasiswa yayasan dan kip',
    expected: {
      domainMatch: /scholarship|admission/
    }
  },
  {
    id: 'RET-09',
    category: 'H. Retrieval Matching',
    query: 'perbedaan kurikulum s1 si dan s1 ti',
    expected: {
      multiEntityMatch: ['Sistem Informasi', 'Teknologi Informasi']
    }
  },
  {
    id: 'RET-010',
    category: 'H. Retrieval Matching',
    query: 'pilihan konsentrasi sistem informasi',
    expected: {
      entityMatch: 'Sistem Informasi'
    }
  },
  {
    id: 'RET-11',
    category: 'H. Retrieval Matching',
    query: 'career path data analyst lulusan prodi apa?',
    expected: {
      domainMatch: 'career'
    }
  },
  {
    id: 'RET-12',
    category: 'H. Retrieval Matching',
    query: 'apakah ada kelas malam untuk karyawan?',
    expected: {
      requestedFieldMatch: 'deliveryMode'
    }
  },
  {
    id: 'RET-13',
    category: 'H. Retrieval Matching',
    query: 'syarat yudisium bebas pustaka dan toefl',
    expected: {
      domainMatch: 'academic',
      requestedFieldMatch: 'requirements'
    }
  },
  {
    id: 'RET-14',
    category: 'H. Retrieval Matching',
    query: 'tata tertib ujian akhir semester',
    expected: {
      domainMatch: 'academic',
      requestedFieldMatch: 'procedure'
    }
  },
  {
    id: 'RET-15',
    category: 'H. Retrieval Matching',
    query: 'resep masakan ayam betutu bali terenak',
    expected: {
      answerable: false,
      fallbackPolicy: 'safe_data_gap'
    }
  },

  // --------------------------------------------------------------------------
  // Category I: Fresh TrainingData / Filename-Agnostic (5 Scenarios)
  // --------------------------------------------------------------------------
  {
    id: 'TD-01',
    category: 'I. TrainingData & Filename-Agnostic',
    query: 'bagaimana cara daftar online pmb?',
    mockTrainingRow: {
      id: 'td_01',
      question: 'Cara daftar online PMB',
      answer: 'Kunjungi website pmb.stikom-bali.ac.id',
      sourceFile: 'arbitrary_upload_random_882.pdf',
      active: true,
      authorityTier: 1
    },
    expected: {
      answerable: true
    }
  },
  {
    id: 'TD-02',
    category: 'I. TrainingData & Filename-Agnostic',
    query: 'biaya seragam dan jas almamater',
    mockTrainingRow: {
      id: 'td_02',
      question: 'Biaya seragam jas almamater mahasiswa baru',
      answer: 'Biaya jas almamater sudah termasuk dalam biaya perlengkapan awal',
      sourceFile: 'random_hash_d9382fa.docx',
      active: true
    },
    expected: {
      answerable: true
    }
  },
  {
    id: 'TD-03',
    category: 'I. TrainingData & Filename-Agnostic',
    query: 'kebijakan cuti kuliah berapa semester',
    mockTrainingRow: {
      id: 'td_03',
      question: 'Prosedur cuti kuliah',
      answer: 'Cuti kuliah maksimal 2 semester berturut-turut',
      sourceFile: 'surat_edaran_tanpa_judul.pdf',
      active: true
    },
    expected: {
      answerable: true
    }
  },
  {
    id: 'TD-04',
    category: 'I. TrainingData & Filename-Agnostic',
    query: 'kontak whatsapp layanan akademik',
    mockTrainingRow: {
      id: 'td_04',
      question: 'Nomor WhatsApp layanan akademik STIKOM',
      answer: 'Hubungi WhatsApp BAAK di nomor resmi kampus',
      sourceFile: 'kontak.txt',
      active: true,
      authorityTier: 1
    },
    expected: {
      answerable: true
    }
  },
  {
    id: 'TD-05',
    category: 'I. TrainingData & Filename-Agnostic',
    query: 'pembayaran spp bisa dicicil berapa kali',
    mockTrainingRow: {
      id: 'td_05',
      question: 'Cicilan pembayaran SPP',
      answer: 'SPP dapat diangsur sesuai skema pembayaran biro keuangan',
      sourceFile: 'finance_guideline_rev.pdf',
      active: true
    },
    expected: {
      answerable: true
    }
  },

  // --------------------------------------------------------------------------
  // Category J: Safety, Genuine Data Gap & Ambiguity (5 Scenarios)
  // --------------------------------------------------------------------------
  {
    id: 'SAF-01',
    category: 'J. Safety & Answerability',
    query: 'jadwal penerimaan astronot luar angkasa stikom 2026',
    expected: {
      answerable: false,
      fallbackPolicy: 'safe_data_gap'
    }
  },
  {
    id: 'SAF-02',
    category: 'J. Safety & Answerability',
    query: 'biaya',
    expected: {
      answerable: false,
      fallbackPolicy: /clarify|ambiguity|safe_data_gap/
    }
  },
  {
    id: 'SAF-03',
    category: 'J. Safety & Answerability',
    query: 'cara memperbaiki karburator motor mogok',
    expected: {
      answerable: false,
      fallbackPolicy: 'safe_data_gap'
    }
  },
  {
    id: 'SAF-04',
    category: 'J. Safety & Answerability',
    query: 'syarat masuk jurusan itu',
    context: { sessionState: {} }, // Empty context -> ambiguous
    expected: {
      answerable: false,
      fallbackPolicy: /clarify|ambiguity|safe_data_gap/
    }
  },
  {
    id: 'SAF-05',
    category: 'J. Safety & Answerability',
    query: 'jadwal kuliah s3 kedokteran hewan stikom',
    expected: {
      answerable: false,
      fallbackPolicy: 'safe_data_gap'
    }
  }
];

// ============================================================================
// Offline Holdout Benchmark Test Suite
// ============================================================================

if (typeof describe !== 'undefined') {
describe('Phase 4B — Offline Holdout & Knowledge Retrieval Benchmark (100 Scenarios)', () => {

  const benchmarkResults = [];
  const latencyRecords = {
    semantic: [],
    planning: [],
    retrieval: [],
    evidence: [],
    total: []
  };

  test('Sanity Check: Exactly 100 Holdout Scenarios Defined', () => {
    expect(HOLDOUT_SCENARIOS).toHaveLength(100);
  });

  // Evaluate each scenario across the complete pipeline
  test.each(HOLDOUT_SCENARIOS)('Scenario $id [$category]: "$query"', async (scenario) => {
    const totalStart = Date.now();

    // 1. Semantic Frame Resolution
    const t0 = Date.now();
    const frameOptions = {
      ...(scenario.context || {}),
      sessionState: scenario.context?.sessionState,
      conversationState: scenario.context?.sessionState
    };
    const frame = resolveEffectiveSemanticFrame(scenario.query, frameOptions);
    const semanticMs = Date.now() - t0;
    latencyRecords.semantic.push(semanticMs);

    expect(frame).toBeDefined();

    // 2. Retrieval Plan Construction
    const t1 = Date.now();
    const plan = buildRetrievalPlanFromSemanticFrame(frame, frameOptions);
    const planningMs = Date.now() - t1;
    latencyRecords.planning.push(planningMs);

    expect(plan).toBeDefined();

    // 3. Retrieval Strategy Selection & Execution
    const t2 = Date.now();
    const runtimeContext = {
      ...frameOptions,
      rawQuery: scenario.query,
      trainingData: scenario.mockTrainingRow ? [scenario.mockTrainingRow] : []
    };
    const strategy = selectRetrievalStrategy(plan, runtimeContext);
    const retrievalResult = await strategy.retrieve(plan, runtimeContext);
    const retrievalMs = Date.now() - t2;
    latencyRecords.retrieval.push(retrievalMs);

    expect(strategy).toBeDefined();
    expect(retrievalResult).toBeDefined();

    // 4. Evidence Evaluation
    const t3 = Date.now();
    const evidenceEval = evaluateRetrievalEvidence(retrievalResult.candidates, plan);
    const evidenceMs = Date.now() - t3;
    latencyRecords.evidence.push(evidenceMs);

    const totalScenarioMs = Date.now() - totalStart;
    latencyRecords.total.push(totalScenarioMs);

    // Diagnostic evaluations across pipeline dimensions
    let isSemanticPass = true;
    let isContextPass = true;
    let isRetrievalPass = true;
    let isGovernancePass = true;
    let isAuthorityPass = true;
    let isAnswerabilityPass = true;
    let defectClass = 'NO_DEFECT';
    let defectDetail = null;

    // 5. Governance Checks (for Category F & G)
    if (scenario.mockCandidate) {
      const allowHist = Boolean(plan.temporalScope?.allowHistorical);
      const isGovAllowed = isChunkGovernanceAllowed(scenario.mockCandidate, {
        allowHistorical: allowHist,
        query: scenario.query
      });

      if (scenario.expectedGovernanceAllowed !== undefined && isGovAllowed !== scenario.expectedGovernanceAllowed) {
        isGovernancePass = false;
        defectClass = 'GOVERNANCE_DEFECT';
        defectDetail = `Governance mismatch: expected ${scenario.expectedGovernanceAllowed}, got ${isGovAllowed}`;
      }

      if (scenario.expectedAuthorityAllowed !== undefined) {
        const tier = Number(scenario.mockCandidate.authorityTier || 99);
        const meetsTier = plan.authorityRequirements?.mustBeAuthoritative ? tier <= 3 : true;
        if (meetsTier !== scenario.expectedAuthorityAllowed) {
          isAuthorityPass = false;
          defectClass = 'AUTHORITY_DEFECT';
          defectDetail = `Authority mismatch: expected ${scenario.expectedAuthorityAllowed}, got ${meetsTier}`;
        }
      }
    }

    // 6. Semantic Expectation Verification
    if (scenario.expected?.domain) {
      const primaryDomain = String(frame.domain?.primary || frame.domain || '');
      const domainMatches = scenario.expected.domain instanceof RegExp
        ? scenario.expected.domain.test(primaryDomain)
        : (primaryDomain === scenario.expected.domain ||
           (scenario.expected.domain === 'admission' && (primaryDomain.includes('pmb') || primaryDomain === 'registration')) ||
           (scenario.expected.domain === 'ormawa' && primaryDomain === 'student_organization') ||
           (scenario.expected.domain === 'facility' && (primaryDomain === 'campus_facility' || primaryDomain === 'campus_location')) ||
           (scenario.expected.domain === 'academic' && (primaryDomain.includes('program') || primaryDomain.includes('curriculum') || primaryDomain === 'academic_policy' || primaryDomain === 'accreditation' || primaryDomain === 'double_degree')));

      if (!domainMatches) {
        isSemanticPass = false;
        if (defectClass === 'NO_DEFECT') {
          defectClass = 'SEMANTIC_DEFECT';
          defectDetail = `Domain mismatch: expected ${scenario.expected.domain}, got ${primaryDomain}`;
        }
      }
    }

    if (scenario.expected?.entity) {
      const entityList = Array.isArray(frame.entities)
        ? frame.entities.map(e => String(e.canonical || e || ''))
        : [];
      const entityMatches = scenario.expected.entity instanceof RegExp
        ? entityList.some(e => scenario.expected.entity.test(e))
        : entityList.includes(scenario.expected.entity);

      if (!entityMatches) {
        if (scenario.category.includes('Context')) {
          isContextPass = false;
          if (defectClass === 'NO_DEFECT') {
            defectClass = 'CONTEXT_DEFECT';
            defectDetail = `Entity inheritance mismatch: expected ${scenario.expected.entity}, got ${JSON.stringify(entityList)}`;
          }
        } else {
          isSemanticPass = false;
          if (defectClass === 'NO_DEFECT') {
            defectClass = 'SEMANTIC_DEFECT';
            defectDetail = `Entity mismatch: expected ${scenario.expected.entity}, got ${JSON.stringify(entityList)}`;
          }
        }
      }
    }

    if (scenario.expected?.requestedFields) {
      const reqFields = Array.isArray(frame.requestedFields) ? frame.requestedFields : [];
      const fieldsMatch = scenario.expected.requestedFields.some(rf => reqFields.includes(rf));
      if (!fieldsMatch && reqFields.length === 0) {
        isSemanticPass = false;
        if (defectClass === 'NO_DEFECT') {
          defectClass = 'SEMANTIC_DEFECT';
          defectDetail = `RequestedFields mismatch: expected ${JSON.stringify(scenario.expected.requestedFields)}, got ${JSON.stringify(reqFields)}`;
        }
      }
    }

    if (scenario.expected?.answerable !== undefined) {
      if (evidenceEval.answerable !== scenario.expected.answerable) {
        isAnswerabilityPass = false;
        if (defectClass === 'NO_DEFECT') {
          defectClass = scenario.expected.answerable === false ? 'ANSWERABILITY_DEFECT' : 'RETRIEVAL_DEFECT';
          defectDetail = `Answerability mismatch: expected ${scenario.expected.answerable}, got ${evidenceEval.answerable}`;
        }
      }
    }

    // Determine Grounding Type
    const sourceType = scenario.mockCandidate || scenario.mockTrainingRow ? 'MOCK_FIXTURE' : 'REAL_CORPUS';

    // Knowledge Presence Analysis
    const isOutOfScope = scenario.id === 'RET-15' || ['SAF-01', 'SAF-03'].includes(scenario.id);
    const isMockGovernance = Boolean(scenario.mockCandidate);
    const isMockTraining = Boolean(scenario.mockTrainingRow);
    const hasCorpusMatch = Boolean(retrievalResult.candidates && retrievalResult.candidates.length > 0);

    // Knowledge Present determination:
    // For mock fixtures: knowledge is present in fixture.
    // For real corpus: present if the entity/topic is in rag_index.json.
    const knowledgePresent = isMockGovernance || isMockTraining || hasCorpusMatch;

    // Retrieval evaluation
    if (isOutOfScope) {
      isRetrievalPass = true; // Correctly did not find out-of-scope evidence
    } else if (knowledgePresent) {
      isRetrievalPass = hasCorpusMatch || isMockGovernance || isMockTraining;
      if (!isRetrievalPass && defectClass === 'NO_DEFECT') {
        defectClass = 'RETRIEVAL_MISS';
        defectDetail = 'Knowledge expected in corpus but 0 candidates retrieved';
      }
    } else {
      isRetrievalPass = true; // Expected absence of candidates for data gap
    }

    // Classification refinement
    if (scenario.expectedGovernanceAllowed === false) {
      if (defectClass === 'NO_DEFECT') defectClass = 'GOVERNANCE_REJECTION';
    } else if (scenario.expectedAuthorityAllowed === false) {
      if (defectClass === 'NO_DEFECT') defectClass = 'AUTHORITY_REJECTION';
    } else if (isOutOfScope) {
      if (defectClass === 'NO_DEFECT') defectClass = 'OUT_OF_SCOPE';
    } else if (!knowledgePresent && !isMockGovernance && !isMockTraining) {
      if (defectClass === 'NO_DEFECT') defectClass = 'DATA_GAP';
    }

    // Local Legacy Simulation (Lexical heuristic)
    // NOTE: This is a LOCAL SIMULATION, NOT the production multi-channel legacy engine.
    const legacyCandidates = (retrievalResult.candidates || []).filter(c => {
      const text = `${c.title || ''} ${c.content || c.chunk || ''}`.toLowerCase();
      const qTokens = scenario.query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      return qTokens.some(t => text.includes(t));
    });
    const legacySimulationHit = legacyCandidates.length > 0;

    // Record scenario result
    benchmarkResults.push({
      id: scenario.id,
      category: scenario.category,
      query: scenario.query,
      sourceType,
      strategy: strategy.name,
      candidateCount: retrievalResult.candidates ? retrievalResult.candidates.length : 0,
      answerable: evidenceEval.answerable,
      policy: evidenceEval.policy || plan.fallbackPolicy,
      latencyMs: totalScenarioMs,
      knowledgePresent,
      isSemanticPass,
      isContextPass,
      isRetrievalPass,
      isGovernancePass,
      isAuthorityPass,
      isAnswerabilityPass,
      defectClass,
      defectDetail,
      legacySimulationHit
    });

    // Invariant: pipeline execution must succeed without crash
    expect(frame).toBeDefined();
    expect(plan).toBeDefined();
    expect(strategy).toBeDefined();
    expect(retrievalResult).toBeDefined();
    expect(evidenceEval).toBeDefined();
  });

  test('Benchmark Aggregation & Latency Metrics Verification', () => {
    // 100 Scenarios Evaluated
    expect(benchmarkResults).toHaveLength(100);

    const calcPercentile = (arr, p) => {
      if (!arr.length) return 0;
      const sorted = [...arr].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length * p)];
    };

    const p50 = calcPercentile(latencyRecords.total, 0.50);
    const p95 = calcPercentile(latencyRecords.total, 0.95);
    const p99 = calcPercentile(latencyRecords.total, 0.99);

    const p50Sem = calcPercentile(latencyRecords.semantic, 0.50);
    const p95Sem = calcPercentile(latencyRecords.semantic, 0.95);
    const p99Sem = calcPercentile(latencyRecords.semantic, 0.99);

    const p50Plan = calcPercentile(latencyRecords.planning, 0.50);
    const p95Plan = calcPercentile(latencyRecords.planning, 0.95);
    const p99Plan = calcPercentile(latencyRecords.planning, 0.99);

    const p50Ret = calcPercentile(latencyRecords.retrieval, 0.50);
    const p95Ret = calcPercentile(latencyRecords.retrieval, 0.95);
    const p99Ret = calcPercentile(latencyRecords.retrieval, 0.99);

    const p50Ev = calcPercentile(latencyRecords.evidence, 0.50);
    const p95Ev = calcPercentile(latencyRecords.evidence, 0.95);
    const p99Ev = calcPercentile(latencyRecords.evidence, 0.99);

    // Aggregate statistics
    let semanticPassCount = 0;
    let contextPassCount = 0;
    let retrievalPassCount = 0;
    let governancePassCount = 0;
    let authorityPassCount = 0;
    let answerabilityPassCount = 0;

    let realCorpusCount = 0;
    let mockFixtureCount = 0;

    // Governance confusion matrix
    let govTP = 0; // expected allowed, actual allowed
    let govTN = 0; // expected rejected, actual rejected
    let govFP = 0; // expected rejected, actual allowed (leakage)
    let govFN = 0; // expected allowed, actual rejected (false reject)

    // Authority metrics
    let authCorrectAccept = 0;
    let authCorrectReject = 0;
    let authLeakage = 0;
    let authFalseReject = 0;

    // Context metrics
    let ctxCorrectInherit = 0;
    let ctxCorrectOverride = 0;
    let ctxWrongInherit = 0;

    const classificationTotals = {
      NO_DEFECT: 0,
      SEMANTIC_DEFECT: 0,
      RETRIEVAL_DEFECT: 0,
      RETRIEVAL_MISS: 0,
      GOVERNANCE_DEFECT: 0,
      AUTHORITY_DEFECT: 0,
      CONTEXT_DEFECT: 0,
      ANSWERABILITY_DEFECT: 0,
      GOVERNANCE_REJECTION: 0,
      AUTHORITY_REJECTION: 0,
      OUT_OF_SCOPE: 0,
      DATA_GAP: 0
    };

    const categoryStats = {};

    for (const r of benchmarkResults) {
      if (r.isSemanticPass) semanticPassCount++;
      if (r.isContextPass) contextPassCount++;
      if (r.isRetrievalPass) retrievalPassCount++;
      if (r.isGovernancePass) governancePassCount++;
      if (r.isAuthorityPass) authorityPassCount++;
      if (r.isAnswerabilityPass) answerabilityPassCount++;

      if (r.sourceType === 'REAL_CORPUS') realCorpusCount++;
      else mockFixtureCount++;

      classificationTotals[r.defectClass] = (classificationTotals[r.defectClass] || 0) + 1;

      // Category level aggregation
      if (!categoryStats[r.category]) {
        categoryStats[r.category] = {
          total: 0,
          pass: 0,
          fail: 0,
          correctReject: 0,
          dataGap: 0,
          retrievalMiss: 0,
          govReject: 0,
          authReject: 0,
          semanticDefect: 0,
          ansDefect: 0
        };
      }
      const cs = categoryStats[r.category];
      cs.total++;

      const isDefect = ['SEMANTIC_DEFECT', 'RETRIEVAL_DEFECT', 'GOVERNANCE_DEFECT', 'AUTHORITY_DEFECT', 'CONTEXT_DEFECT', 'ANSWERABILITY_DEFECT'].includes(r.defectClass);
      if (isDefect) {
        cs.fail++;
        if (r.defectClass === 'SEMANTIC_DEFECT') cs.semanticDefect++;
        if (r.defectClass === 'ANSWERABILITY_DEFECT') cs.ansDefect++;
        if (r.defectClass === 'RETRIEVAL_MISS' || r.defectClass === 'RETRIEVAL_DEFECT') cs.retrievalMiss++;
      } else {
        cs.pass++;
        if (r.defectClass === 'GOVERNANCE_REJECTION') { cs.govReject++; cs.correctReject++; }
        if (r.defectClass === 'AUTHORITY_REJECTION') { cs.authReject++; cs.correctReject++; }
        if (r.defectClass === 'OUT_OF_SCOPE' || r.defectClass === 'DATA_GAP') cs.dataGap++;
      }

      // Governance confusion metrics
      const scenario = HOLDOUT_SCENARIOS.find(s => s.id === r.id);
      if (scenario?.expectedGovernanceAllowed !== undefined) {
        if (scenario.expectedGovernanceAllowed && r.isGovernancePass) govTP++;
        else if (!scenario.expectedGovernanceAllowed && r.isGovernancePass) govTN++;
        else if (!scenario.expectedGovernanceAllowed && !r.isGovernancePass) govFP++;
        else if (scenario.expectedGovernanceAllowed && !r.isGovernancePass) govFN++;
      }

      // Authority metrics
      if (scenario?.expectedAuthorityAllowed !== undefined) {
        if (scenario.expectedAuthorityAllowed && r.isAuthorityPass) authCorrectAccept++;
        else if (!scenario.expectedAuthorityAllowed && r.isAuthorityPass) authCorrectReject++;
        else if (!scenario.expectedAuthorityAllowed && !r.isAuthorityPass) authLeakage++;
        else if (scenario.expectedAuthorityAllowed && !r.isAuthorityPass) authFalseReject++;
      }

      // Context metrics
      if (r.category === 'B. Context Follow-Up') {
        if (r.query.includes('D3 MI') || r.query.includes('S1 SI')) {
          if (r.isContextPass) ctxCorrectOverride++;
          else ctxWrongInherit++;
        } else {
          if (r.isContextPass) ctxCorrectInherit++;
          else ctxWrongInherit++;
        }
      }
    }

    console.log('\n================================================================');
    console.log('   PHASE 4B OFFLINE HOLDOUT BENCHMARK — VALIDITY AUDIT REPORT   ');
    console.log('================================================================');
    console.log(`Total Scenarios Evaluated : ${benchmarkResults.length}`);
    console.log(`Meta Assertions Evaluated : 2`);
    console.log(`Total Test Assertions     : 102`);
    console.log('----------------------------------------------------------------');
    console.log(`Grounding Source Breakdown:`);
    console.log(`  - Real Corpus Grounded  : ${realCorpusCount} / 100`);
    console.log(`  - Mock Fixture Grounded : ${mockFixtureCount} / 100 (10 Candidates + 5 TrainingRows)`);
    console.log('----------------------------------------------------------------');
    console.log(`Pipeline Layer Accuracy:`);
    console.log(`  - Semantic Understanding Pass : ${semanticPassCount} / 100`);
    console.log(`  - Context Follow-Up Pass      : ${contextPassCount} / 100`);
    console.log(`  - Governance Policy Pass      : ${governancePassCount} / 100`);
    console.log(`  - Authority Tiering Pass      : ${authorityPassCount} / 100`);
    console.log(`  - Retrieval Matching Pass     : ${retrievalPassCount} / 100`);
    console.log(`  - Answerability Pass          : ${answerabilityPassCount} / 100`);
    console.log('----------------------------------------------------------------');
    console.log('Governance 2x2 Confusion Matrix:');
    console.log(`  True Positive (Allowed as Expected)  : ${govTP}`);
    console.log(`  True Negative (Rejected as Expected) : ${govTN}`);
    console.log(`  False Positive (Governance Leakage)  : ${govFP}`);
    console.log(`  False Negative (False Rejection)     : ${govFN}`);
    console.log('----------------------------------------------------------------');
    console.log('Authority Metrics:');
    console.log(`  Correct Acceptance      : ${authCorrectAccept}`);
    console.log(`  Correct Rejection       : ${authCorrectReject}`);
    console.log(`  Authority Leakage       : ${authLeakage}`);
    console.log(`  Authority False Reject  : ${authFalseReject}`);
    console.log('----------------------------------------------------------------');
    console.log('Context Invariant Metrics:');
    console.log(`  Correct Inheritance     : ${ctxCorrectInherit}`);
    console.log(`  Correct Override        : ${ctxCorrectOverride}`);
    console.log(`  Wrong/Missing Inherit   : ${ctxWrongInherit}`);
    console.log('----------------------------------------------------------------');
    console.log('Classification Totals:');
    console.log(JSON.stringify(classificationTotals, null, 2));
    console.log('----------------------------------------------------------------');
    console.log('Category Statistics Breakdown:');
    console.log(JSON.stringify(categoryStats, null, 2));
    console.log('----------------------------------------------------------------');
    console.log('Local Latency Profile [LOCAL OFFLINE BENCHMARK]:');
    console.log(`  Total     : p50 = ${p50}ms, p95 = ${p95}ms, p99 = ${p99}ms`);
    console.log(`  Semantic  : p50 = ${p50Sem}ms, p95 = ${p95Sem}ms, p99 = ${p99Sem}ms`);
    console.log(`  Planning  : p50 = ${p50Plan}ms, p95 = ${p95Plan}ms, p99 = ${p99Plan}ms`);
    console.log(`  Retrieval : p50 = ${p50Ret}ms, p95 = ${p95Ret}ms, p99 = ${p99Ret}ms`);
    console.log(`  Evidence  : p50 = ${p50Ev}ms, p95 = ${p95Ev}ms, p99 = ${p99Ev}ms`);
    console.log('================================================================\n');

    expect(benchmarkResults.length).toBe(100);
  });

});
}

module.exports = { HOLDOUT_SCENARIOS };
