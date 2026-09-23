'use strict';

/**
 * final_independent_holdout_3_20260923.js
 *
 * FRESH INDEPENDENT HOLDOUT #3 — FINAL VALIDATION GATE
 * Execution suite strictly frozen and immutable once written.
 * Evaluates strictly against canonical 829-chunk corpus snapshot.
 */

const path = require('path');
const fs = require('fs');

process.env.RAG_INDEX_PATH = path.resolve(
  __dirname,
  '..',
  'data',
  'runtime',
  'index_snapshots',
  '2026-08-11T04-14-17-889Z_before-final-knowledgeprep-deploy',
  'rag_index.json'
);
process.env.NODE_ENV = 'test';
process.env.OPENAI_API_KEY = '';
process.env.ENABLE_RAG = 'true';
process.env.RAG_TRACE_PERSIST = 'false';
process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
process.env.SEMANTIC_RAG_FIRST = 'true';
process.env.DISABLE_KEYWORD_RULES = 'true';
process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';
process.env.FORCE_BUNDLED_INDEX = 'true';

const { querySemanticRag } = require('../src/engine/semanticRagEngine');

const HOLDOUT_3_CASES = [
  // ==========================================
  // 18 STANDALONE SUPPORTED CASES
  // ==========================================
  {
    id: 'H3-01',
    category: 'supported_standalone',
    query: 'apakah tugas akhir jenjang s1 boleh dikerjakan secara berkelompok di itb stikom bali?',
    expectedScope: 'academic_policy',
    expectedField: 'thesis_group_work_rule',
    expectedSource: 'Pedoman TA S1 2019 Revisi 1.pdf',
    expectedAnchors: ['berkelompok', '2 orang', 'maksimal'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /berkelompok/i.test(a) && /2\s+orang|maksimal/i.test(a) && !/tidak\s+menemukan|belum\s+tersedia/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan|belum\s+tersedia/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H3-02',
    category: 'supported_standalone',
    query: 'apa gelar kelulusan yang diperoleh dari s2 magister sistem informasi stikom bali?',
    expectedScope: 'postgraduate_profile',
    expectedField: 'academic_degree',
    expectedSource: 'ISIAN WEBSITE (1).pdf',
    expectedAnchors: ['Magister Komputer', 'M.Kom'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /magister\s+komputer|m\.kom/i.test(a) && !/tidak\s+menemukan|belum\s+tersedia/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan|belum\s+tersedia/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H3-03',
    category: 'supported_standalone',
    query: 'dimana alamat lokasi kampus itb stikom bali yang ada di jimbaran?',
    expectedScope: 'campus_location',
    expectedField: 'jimbaran_campus_address',
    expectedSource: 'ISIAN WEBSITE (1).pdf',
    expectedAnchors: ['Jimbaran', 'Kampus Udayana'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /jimbaran/i.test(a) && !/tidak\s+menemukan|belum\s+tersedia/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan|belum\s+tersedia/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H3-04',
    category: 'supported_standalone',
    query: 'apa fasilitas inkubator bisnis yang dimiliki oleh itb stikom bali?',
    expectedScope: 'campus_facility',
    expectedField: 'incubator_overview',
    expectedSource: 'Profil INBIS Bali - 2026.docx',
    expectedAnchors: ['Inkubator Bisnis', 'startup / wirausaha'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /inkubator\s+bisnis/i.test(a) && !/tidak\s+menemukan|belum\s+tersedia/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan|belum\s+tersedia/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H3-05',
    category: 'supported_standalone',
    query: 'apa profil dan peran organisasi himaprodi teknologi informasi di itb stikom bali?',
    expectedScope: 'ukm_profile',
    expectedField: 'organization_role',
    expectedSource: 'BUKU ORMAWA HIMAPRODI TI.docx',
    expectedAnchors: ['Himaprodi Teknologi Informasi', 'wadah / peran aktif'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /himaprodi\s+teknologi\s+informasi/i.test(a) && !/tidak\s+menemukan|belum\s+tersedia/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan|belum\s+tersedia/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H3-06',
    category: 'supported_standalone',
    query: 'berapa biaya formulir pendaftaran mahasiswa baru program dual degree help university?',
    expectedScope: 'registration_fee',
    expectedField: 'application_fee',
    expectedSource: 'rincian Biaya HELP Tahun Ajaran 2026-2027.pdf',
    expectedAnchors: ['3.000.000'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /3\.000\.000/i.test(a) && !/tidak\s+menemukan|belum\s+tersedia/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan|belum\s+tersedia/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      if (/rp\s*[1-9]/i.test(a)) return 'NUMERIC_MISMATCH';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H3-07',
    category: 'supported_standalone',
    query: 'berapa potongan biaya pendaftaran gelombang khusus untuk program dual degree utb?',
    expectedScope: 'registration_discount',
    expectedField: 'special_wave_discount',
    expectedSource: 'rincian Biaya UTB Tahun Ajaran 2026-2027.pdf',
    expectedAnchors: ['300.000'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /300\.000/i.test(a) && !/tidak\s+menemukan|belum\s+tersedia/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan|belum\s+tersedia/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      if (/rp\s*[1-9]/i.test(a)) return 'NUMERIC_MISMATCH';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H3-08',
    category: 'supported_standalone',
    query: 'apa nama tabuh iringan yang mendampingi pementasan ukm tari tradisional pragina?',
    expectedScope: 'ukm_relation',
    expectedField: 'companion_orchestra',
    expectedSource: 'PROFILE ORMAWA TARI (PRAGINA).docx',
    expectedAnchors: ['UKM Tabuh Bramara Gita'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /bramara\s+gita/i.test(a) && !/tidak\s+menemukan|belum\s+tersedia/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan|belum\s+tersedia/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      return 'WRONG_ENTITY';
    }
  },
  {
    id: 'H3-09',
    category: 'supported_standalone',
    query: 'siapa target peserta kegiatan stikom bali goes to school 2025?',
    expectedScope: 'outreach_program',
    expectedField: 'target_audience',
    expectedSource: 'STIKOM Bali GoseToSchool 2025.docx',
    expectedAnchors: ['SMA', 'SMK'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /sma|smk/i.test(a) && !/tidak\s+menemukan|belum\s+tersedia/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan|belum\s+tersedia/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H3-10',
    category: 'supported_standalone',
    query: 'metode tes apa yang digunakan unit layanan industri stikom untuk ujian perangkat desa?',
    expectedScope: 'industry_service',
    expectedField: 'testing_method',
    expectedSource: 'PROFIL LAYANAN INDUSTRI.docx',
    expectedAnchors: ['CAT', 'Computer Assisted Test'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /cat|computer\s+assisted\s+test/i.test(a) && !/tidak\s+menemukan|belum\s+tersedia/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan|belum\s+tersedia/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H3-11',
    category: 'supported_standalone',
    query: 'layanan apa saja yang disediakan career center cdc stikom bagi mahasiswa yang ingin mencari lowongan kerja?',
    expectedScope: 'career_services',
    expectedField: 'job_placement_services',
    expectedSource: 'FAQ CC.docx',
    expectedAnchors: ['lowongan kerja', 'magang'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /lowongan\s+kerja|magang/i.test(a) && !/tidak\s+menemukan|belum\s+tersedia/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan|belum\s+tersedia/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H3-12',
    category: 'supported_standalone',
    query: 'apa peringkat akreditasi yang diperoleh program studi sarjana sistem komputer itb stikom bali?',
    expectedScope: 'accreditation',
    expectedField: 'accreditation_rating',
    expectedSource: 'SSK-92951-9f1f75a748373a419b97cb544bd6b423_sign.pdf',
    expectedAnchors: ['Baik Sekali'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /baik\s+sekali/i.test(a) && !/tidak\s+menemukan|belum\s+tersedia/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan|belum\s+tersedia/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H3-13',
    category: 'supported_standalone',
    query: 'dimana lokasi tempat pelaksanaan yudisium 1 wisuda 38 stikom bali?',
    expectedScope: 'academic_event',
    expectedField: 'event_location',
    expectedSource: 'Informasi Pendaftaran & Pelaksanaan Yudisium I Wisuda XXXVIII (Semester Ganjil 2026-2027) (1).pdf',
    expectedAnchors: ['Aula STIKOM Bali'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /aula\s+stikom/i.test(a) && !/tidak\s+menemukan|belum\s+tersedia/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan|belum\s+tersedia/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H3-14',
    category: 'supported_standalone',
    query: 'apa fokus bidang kegiatan dari kelompok studi linux ksl di stikom bali?',
    expectedScope: 'ukm_focus',
    expectedField: 'technical_domain',
    expectedSource: 'Profil UKM KSL.docx',
    expectedAnchors: ['Linux', 'Open Source / Jaringan'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /linux|open[\\s-]source|sistem\s+operasi|jaringan/i.test(a) && !/tidak\s+menemukan|belum\s+tersedia/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan|belum\s+tersedia/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H3-15',
    category: 'supported_standalone',
    query: 'apa fokus kegiatan yang dijalankan oleh unit kegiatan mahasiswa ghost stikom bali?',
    expectedScope: 'ukm_focus',
    expectedField: 'fitness_domain',
    expectedSource: 'Profil_UKM_GHoST_ITB_STIKOM_Bali.docx',
    expectedAnchors: ['Gym', 'Fitness / Kebugaran'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /gym|fitness|kebugaran|kesehatan/i.test(a) && !/tidak\s+menemukan|belum\s+tersedia/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan|belum\s+tersedia/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H3-16',
    category: 'supported_standalone',
    query: 'apa nama izin resmi pemerintah yang wajib diurus oleh mahasiswa asing untuk menempuh studi di stikom bali?',
    expectedScope: 'international_regulations',
    expectedField: 'required_permit',
    expectedSource: 'FAQ PENGURUSAN MAHASISWA ASING.docx',
    expectedAnchors: ['Izin Belajar', 'Study Permit'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /izin\s+belajar|study\s+permit/i.test(a) && !/tidak\s+menemukan|belum\s+tersedia/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan|belum\s+tersedia/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H3-17',
    category: 'supported_standalone',
    query: 'berapa batas maksimal waktu yang diberikan untuk ujian proposal tugas akhir s1?',
    expectedScope: 'defense_rules',
    expectedField: 'proposal_duration',
    expectedSource: 'Pedoman TA S1 2019 Revisi 1.pdf',
    expectedAnchors: ['30 menit'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /30\s+menit/i.test(a) && !/tidak\s+menemukan|belum\s+tersedia/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan|belum\s+tersedia/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      if (/\d+\s+menit/i.test(a)) return 'NUMERIC_MISMATCH';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H3-18',
    category: 'supported_standalone',
    query: 'organisasi apa yang mewadahi paduan suara mahasiswa di kampus itb stikom bali?',
    expectedScope: 'ukm_identity',
    expectedField: 'choir_club_name',
    expectedSource: 'Profile Ormawa VOS.docx',
    expectedAnchors: ['Voice of STIKOM', 'VOS'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /voice\s+of\s+stikom|\bvos\b/i.test(a) && !/tidak\s+menemukan|belum\s+tersedia/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan|belum\s+tersedia/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      return 'WRONG_ENTITY';
    }
  },

  // ==========================================
  // 4 PARTIAL SUPPORT CASES
  // ==========================================
  {
    id: 'H3-19',
    category: 'partial_support',
    query: 'apakah tugas akhir s1 boleh dikerjakan berkelompok dan berapa honor yang wajib dibayar mahasiswa ke dosen pembimbing kedua?',
    expectedScope: 'academic_partial',
    expectedField: 'group_rule_and_honorarium_absence',
    expectedSource: 'Pedoman TA S1 2019 Revisi 1.pdf',
    expectedAnchors: ['berkelompok / 2 orang', 'safe absence of advisor fee'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      const hasGroup = /berkelompok|2\s+orang/i.test(a);
      const noHallucinatedFee = !/honor\s+(?:sebesar\s+)?rp\s*[1-9]\d{5,7}|biaya\s+pembimbing\s+(?:sebesar\s+)?rp/i.test(a);
      return hasGroup && noHallucinatedFee;
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/rp\s*[1-9]\d{5,7}/i.test(a)) return 'HALLUCINATION';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H3-20',
    category: 'partial_support',
    query: 'apa peringkat akreditasi s1 sistem komputer dan berapa nomor whatsapp pribadi asesor ban pt yang menguji?',
    expectedScope: 'accreditation_partial',
    expectedField: 'rating_and_assessor_phone_absence',
    expectedSource: 'SSK-92951-9f1f75a748373a419b97cb544bd6b423_sign.pdf',
    expectedAnchors: ['Baik Sekali', 'safe absence of personal phone'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      const hasRating = /baik\s+sekali/i.test(a);
      const noHallucinatedPhone = !/08\d{8,11}/i.test(a);
      return hasRating && noHallucinatedPhone;
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/08\d{8,11}/i.test(a)) return 'HALLUCINATION';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H3-21',
    category: 'partial_support',
    query: 'dimana alamat kampus itb stikom bali jimbaran dan berapa nomor plat mobil operasional rektor?',
    expectedScope: 'location_partial',
    expectedField: 'address_and_license_plate_absence',
    expectedSource: 'ISIAN WEBSITE (1).pdf',
    expectedAnchors: ['Jimbaran', 'safe absence of rector car plate'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      const hasAddress = /jimbaran/i.test(a);
      const noHallucinatedPlate = !/\bdk\s*\d{1,4}\s*[a-z]{1,3}\b/i.test(a);
      return hasAddress && noHallucinatedPlate;
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/\bdk\s*\d{1,4}\s*[a-z]{1,3}\b/i.test(a)) return 'HALLUCINATION';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H3-22',
    category: 'partial_support',
    query: 'apa metode tes yang digunakan unit layanan industri untuk perangkat desa dan berapa kunci jawaban soal ujiannya?',
    expectedScope: 'service_partial',
    expectedField: 'method_and_answer_key_absence',
    expectedSource: 'PROFIL LAYANAN INDUSTRI.docx',
    expectedAnchors: ['CAT / Computer Assisted Test', 'safe absence of answer key'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      const hasMethod = /cat|computer\s+assisted\s+test/i.test(a);
      const noHallucinatedAnswers = !/kunci\s+jawaban\s+(?:adalah|nomor\s+1)/i.test(a);
      return hasMethod && noHallucinatedAnswers;
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/kunci\s+jawaban\s+(?:adalah|nomor\s+1)/i.test(a)) return 'HALLUCINATION';
      return 'EVIDENCE_MISS';
    }
  },

  // ==========================================
  // 4 UNSUPPORTED CONTROLS (Safe Refusals)
  // ==========================================
  {
    id: 'H3-23',
    category: 'unsupported_control',
    query: 'apakah di itb stikom bali tersedia program sarjana teknik kedirgantaraan atau teknik nuklir?',
    expectedScope: 'unsupported_program',
    expectedField: 'safe_rejection',
    expectedSource: 'none',
    expectedAnchors: ['tidak memiliki program studi / tidak tersedia'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /tidak\s+(?:memiliki|menemukan|tersedia|ada)|belum\s+(?:menemukan|tersedia|ada)/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tersedia\s+program\s+sarjana\s+teknik\s+kedirgantaraan/i.test(a)) return 'HALLUCINATION';
      return 'UNSUPPORTED_FACT';
    }
  },
  {
    id: 'H3-24',
    category: 'unsupported_control',
    query: 'berapa biaya sewa landasan peluncuran roket luar angkasa di atap gedung kampus stikom renon?',
    expectedScope: 'unsupported_facility',
    expectedField: 'safe_rejection',
    expectedSource: 'none',
    expectedAnchors: ['tidak menemukan / belum menemukan data'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /tidak\s+(?:menemukan|tersedia|ada)|belum\s+(?:menemukan|tersedia|ada)/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/rp\s*[1-9]/i.test(a)) return 'HALLUCINATION';
      return 'UNSUPPORTED_FACT';
    }
  },
  {
    id: 'H3-25',
    category: 'unsupported_control',
    query: 'apakah ada program studi s1 kedokteran hewan atau farmasi di itb stikom bali?',
    expectedScope: 'unsupported_program',
    expectedField: 'safe_rejection',
    expectedSource: 'none',
    expectedAnchors: ['tidak memiliki program studi / tidak tersedia'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /tidak\s+(?:memiliki|menemukan|tersedia|ada)|belum\s+(?:menemukan|tersedia|ada)/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tersedia\s+program\s+studi\s+s1\s+kedokteran/i.test(a)) return 'HALLUCINATION';
      return 'UNSUPPORTED_FACT';
    }
  },
  {
    id: 'H3-26',
    category: 'unsupported_control',
    query: 'berapa denda keterlambatan pengembalian tank tempur amfibi di laboratorium stikom jimbaran?',
    expectedScope: 'unsupported_equipment',
    expectedField: 'safe_rejection',
    expectedSource: 'none',
    expectedAnchors: ['tidak menemukan / belum menemukan data'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /tidak\s+(?:menemukan|tersedia|ada)|belum\s+(?:menemukan|tersedia|ada)/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/rp\s*[1-9]|denda/i.test(a)) return 'HALLUCINATION';
      return 'UNSUPPORTED_FACT';
    }
  },

  // ==========================================
  // 4 COMPOUND / MULTI-BINDING CASES
  // ==========================================
  {
    id: 'H3-27',
    category: 'compound_multibinding',
    query: 'apa fokus kegiatan kelompok studi linux ksl dan apa fokus kegiatan ukm ghost di stikom bali?',
    expectedScope: 'compound_ukm',
    expectedField: 'dual_organization_focus',
    expectedSource: 'Profil UKM KSL.docx + Profil_UKM_GHoST_ITB_STIKOM_Bali.docx',
    expectedAnchors: ['Linux / Open Source', 'Gym / Fitness / Kebugaran'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      const hasKsl = /linux|open[\\s-]source|sistem\s+operasi|jaringan/i.test(a);
      const hasGhost = /gym|fitness|kebugaran|kesehatan/i.test(a);
      return hasKsl && hasGhost && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      const hasKsl = /linux|open[\\s-]source/i.test(a);
      const hasGhost = /gym|fitness|kebugaran/i.test(a);
      if (!hasKsl || !hasGhost) return 'DROPPED_BINDING';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H3-28',
    category: 'compound_multibinding',
    query: 'berapa biaya pendaftaran dual degree help university dan berapa potongan pendaftaran gelombang khusus dual degree utb?',
    expectedScope: 'compound_fees',
    expectedField: 'dual_international_fees',
    expectedSource: 'rincian Biaya HELP + rincian Biaya UTB',
    expectedAnchors: ['3.000.000', '300.000'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      const hasHelp = /3\.000\.000/i.test(a);
      const hasUtb = /300\.000/i.test(a);
      return hasHelp && hasUtb && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      const hasHelp = /3\.000\.000/i.test(a);
      const hasUtb = /300\.000/i.test(a);
      if (!hasHelp || !hasUtb) return 'DROPPED_BINDING';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H3-29',
    category: 'compound_multibinding',
    query: 'apakah tugas akhir s1 boleh berkelompok dan berapa batas maksimal durasi ujian proposalnya?',
    expectedScope: 'compound_academic',
    expectedField: 'group_allowed_and_proposal_time',
    expectedSource: 'Pedoman TA S1 2019 Revisi 1.pdf',
    expectedAnchors: ['berkelompok / 2 orang', '30 menit'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      const hasGroup = /berkelompok|2\s+orang/i.test(a);
      const hasTime = /30\s+menit/i.test(a);
      return hasGroup && hasTime && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      const hasGroup = /berkelompok|2\s+orang/i.test(a);
      const hasTime = /30\s+menit/i.test(a);
      if (!hasGroup || !hasTime) return 'DROPPED_BINDING';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H3-30',
    category: 'compound_multibinding',
    query: 'apa nama ukm tari tradisional dan apa nama ukm tabuh yang biasa mendampingi pementasannya?',
    expectedScope: 'compound_arts',
    expectedField: 'dance_and_companion_tabuh',
    expectedSource: 'PROFILE ORMAWA TARI (PRAGINA).docx',
    expectedAnchors: ['Pragina', 'Bramara Gita'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      const hasDance = /pragina/i.test(a);
      const hasTabuh = /bramara\s+gita/i.test(a);
      return hasDance && hasTabuh && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      const hasDance = /pragina/i.test(a);
      const hasTabuh = /bramara\s+gita/i.test(a);
      if (!hasDance || !hasTabuh) return 'DROPPED_BINDING';
      return 'EVIDENCE_MISS';
    }
  },

  // ==========================================
  // 6 CONTINUOUS MULTI-TURN SESSIONS
  // ==========================================
  // Session 1: Gelar Magister & Kampus Jimbaran (H3-31 .. H3-33)
  {
    id: 'H3-31',
    sessionId: 'session_h3_academic_01',
    category: 'continuous_session',
    turnIndex: 1,
    query: 'apa gelar kelulusan yang didapatkan oleh lulusan program s2 sistem informasi stikom bali?',
    expectedScope: 'academic_session_turn1',
    expectedField: 'degree_title',
    expectedSource: 'ISIAN WEBSITE (1).pdf',
    expectedAnchors: ['Magister Komputer', 'M.Kom'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /magister\s+komputer|m\.kom/i.test(a) && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H3-32',
    sessionId: 'session_h3_academic_01',
    category: 'continuous_session',
    turnIndex: 2,
    query: 'dimana alamat lokasi kampus itb stikom bali yang ada di daerah jimbaran?',
    expectedScope: 'academic_session_turn2',
    expectedField: 'jimbaran_address_in_context',
    expectedSource: 'ISIAN WEBSITE (1).pdf',
    expectedAnchors: ['Jimbaran', 'Kampus Udayana'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /jimbaran/i.test(a) && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan/i.test(a)) return 'LOST_CONTEXT';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H3-33',
    sessionId: 'session_h3_academic_01',
    category: 'continuous_session',
    turnIndex: 3,
    query: 'apakah kampus jimbaran tersebut memiliki laboratorium komputer?',
    expectedScope: 'academic_session_turn3',
    expectedField: 'jimbaran_facility_in_context',
    expectedSource: 'ISIAN WEBSITE (1).pdf',
    expectedAnchors: ['Laboratorium Komputer', 'fasilitas'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /laboratorium\s+komputer|fasilitas/i.test(a) && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan/i.test(a)) return 'LOST_CONTEXT';
      return 'EVIDENCE_MISS';
    }
  },

  // Session 2: Layanan Fasilitas Kampus (H3-34 .. H3-36)
  {
    id: 'H3-34',
    sessionId: 'session_h3_services_02',
    category: 'continuous_session',
    turnIndex: 1,
    query: 'apa fasilitas inkubator bisnis yang dimiliki oleh itb stikom bali?',
    expectedScope: 'facility_session_turn1',
    expectedField: 'incubator_overview',
    expectedSource: 'Profil INBIS Bali - 2026.docx',
    expectedAnchors: ['Inkubator Bisnis'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /inkubator\s+bisnis/i.test(a) && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H3-35',
    sessionId: 'session_h3_services_02',
    category: 'continuous_session',
    turnIndex: 2,
    query: 'layanan apa saja yang disediakan career center cdc stikom bagi mahasiswa yang ingin mencari lowongan kerja?',
    expectedScope: 'facility_session_turn2',
    expectedField: 'career_services_in_context',
    expectedSource: 'FAQ CC.docx',
    expectedAnchors: ['lowongan kerja', 'magang'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /lowongan\s+kerja|magang/i.test(a) && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan/i.test(a)) return 'LOST_CONTEXT';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H3-36',
    sessionId: 'session_h3_services_02',
    category: 'continuous_session',
    turnIndex: 3,
    query: 'apa metode tes yang digunakan unit layanan industri untuk ujian seleksi perangkat desa?',
    expectedScope: 'facility_session_turn3',
    expectedField: 'industry_test_method_in_context',
    expectedSource: 'PROFIL LAYANAN INDUSTRI.docx',
    expectedAnchors: ['CAT', 'Computer Assisted Test'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /cat|computer\s+assisted\s+test/i.test(a) && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan/i.test(a)) return 'LOST_CONTEXT';
      return 'EVIDENCE_MISS';
    }
  }
];

async function runHoldout3() {
  console.log('=== EXECUTING FRESH INDEPENDENT HOLDOUT #3 ===');
  console.log('Total cases:', HOLDOUT_3_CASES.length);

  // Warmup
  await querySemanticRag('halo');

  const results = [];
  const sessionStates = {};

  for (let i = 0; i < HOLDOUT_3_CASES.length; i++) {
    const c = HOLDOUT_3_CASES[i];
    let res;
    let failureClass = 'NONE';
    let isPass = false;

    try {
      const options = { topK: 8 };
      if (c.sessionId) {
        options.conversationState = sessionStates[c.sessionId] || null;
      }

      res = await querySemanticRag(c.query, options);

      if (c.sessionId && res?.conversationState) {
        sessionStates[c.sessionId] = res.conversationState;
      }

      isPass = Boolean(c.validate(res));
      if (!isPass) {
        failureClass = c.classifyFailure ? c.classifyFailure(res) : 'EVIDENCE_MISS';
      }
    } catch (err) {
      isPass = false;
      failureClass = 'RUNTIME_ERROR';
      res = { answer: err.message, source: 'error' };
    }

    const reportItem = {
      id: c.id,
      query: c.query,
      category: c.category,
      route: res?.source || 'unknown',
      pass: isPass,
      evidenceSource: c.expectedSource,
      failureClass,
      answer: res?.answer || ''
    };

    results.push(reportItem);

    console.log(`CASE_ID=${reportItem.id}`);
    console.log(`QUERY=${reportItem.query}`);
    console.log(`CATEGORY=${reportItem.category}`);
    console.log(`ROUTE=${reportItem.route}`);
    console.log(`PASS/FAIL=${reportItem.pass ? 'PASS' : 'FAIL'}`);
    console.log(`EVIDENCE_SOURCE=${reportItem.evidenceSource}`);
    console.log(`FAILURE_CLASS=${reportItem.failureClass}`);
    console.log('---');
  }

  const total = results.length;
  const passCount = results.filter(r => r.pass).length;
  const failCount = total - passCount;

  const countClass = cls => results.filter(r => r.failureClass === cls).length;

  console.log('\n==================================================');
  console.log('HOLDOUT #3 EXECUTION SUMMARY');
  console.log('==================================================');
  console.log(`HOLDOUT3_TOTAL=${total}`);
  console.log(`HOLDOUT3_PASS=${passCount}`);
  console.log(`HOLDOUT3_FAIL=${failCount}`);
  console.log('');
  console.log(`HALLUCINATION_COUNT=${countClass('HALLUCINATION')}`);
  console.log(`UNSUPPORTED_FACT_COUNT=${countClass('UNSUPPORTED_FACT')}`);
  console.log(`WRONG_ENTITY_COUNT=${countClass('WRONG_ENTITY')}`);
  console.log(`WRONG_FIELD_COUNT=${countClass('WRONG_FIELD')}`);
  console.log(`WRONG_DOMAIN_COUNT=${countClass('WRONG_DOMAIN')}`);
  console.log(`LOST_CONTEXT_COUNT=${countClass('LOST_CONTEXT')}`);
  console.log(`STALE_CONTEXT_COUNT=${countClass('STALE_CONTEXT')}`);
  console.log(`DROPPED_BINDING_COUNT=${countClass('DROPPED_BINDING')}`);
  console.log(`NUMERIC_MISMATCH_COUNT=${countClass('NUMERIC_MISMATCH')}`);
  console.log(`SUPPORTED_EVIDENCE_MISS_COUNT=${countClass('SAFE_NODATA_WHEN_SUPPORTED') + countClass('EVIDENCE_MISS')}`);
  console.log(`RUNTIME_ERROR_COUNT=${countClass('RUNTIME_ERROR')}`);

  fs.writeFileSync(
    path.resolve(__dirname, 'final_holdout_3_results.json'),
    JSON.stringify({ total, passCount, failCount, results }, null, 2)
  );

  return { total, passCount, failCount, results };
}

module.exports = { runHoldout3, HOLDOUT_3_CASES };

if (require.main === module) {
  runHoldout3().catch(e => {
    console.error('FATAL ERROR IN HOLDOUT #3 RUNNER:', e);
    process.exit(1);
  });
}
