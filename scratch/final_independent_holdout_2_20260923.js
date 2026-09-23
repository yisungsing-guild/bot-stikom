'use strict';

/**
 * final_independent_holdout_2_20260923.js
 *
 * FRESH INDEPENDENT HOLDOUT #2 — FINAL RELEASE GATE
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

const { querySemanticRag } = require('../src/engine/semanticRagEngine');

const HOLDOUT_2_CASES = [
  // ==========================================
  // 18 STANDALONE SUPPORTED CASES
  // ==========================================
  {
    id: 'H2-01',
    category: 'supported_standalone',
    query: 'kapan tanggal berdirinya ukm badminton of stikom bali bos?',
    expectedScope: 'ukm_profile',
    expectedField: 'established_date',
    expectedSource: 'PROFILE ORGANISASI UKM BOS.docx',
    expectedAnchors: ['12 Desember 2012', '12-12-2012'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /12\s+desember\s+2012|12-12-2012/i.test(a) && !/tidak\s+menemukan|belum\s+tersedia/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan|belum\s+tersedia|maaf/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      if (/201[0-9]|202[0-9]/.test(a) && !/2012/.test(a)) return 'NUMERIC_MISMATCH';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H2-02',
    category: 'supported_standalone',
    query: 'apa nama agenda festival tahunan yang diselenggarakan ukm syntax?',
    expectedScope: 'ukm_program',
    expectedField: 'annual_event',
    expectedSource: 'SYNAMON (Program Kerja) SYNTAX (2).pdf',
    expectedAnchors: ['SYNOFEST', 'SYNTAX Online Offline Festival'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /synofest|syntax\s+online\s+offline\s+festival/i.test(a) && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan|belum\s+tersedia/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H2-03',
    category: 'supported_standalone',
    query: 'kepanjangan dari ukm ghost stikom bali itu apa?',
    expectedScope: 'ukm_identity',
    expectedField: 'acronym_expansion',
    expectedSource: 'Profil_UKM_GHoST_ITB_STIKOM_Bali.docx',
    expectedAnchors: ['Gymnastic and Health of STIKOM Bali'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /gymnastic\s+and\s+health/i.test(a) && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan|belum\s+tersedia/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H2-04',
    category: 'supported_standalone',
    query: 'berapa kode warna background biru dongker untuk pasfoto wisuda di stikom bali?',
    expectedScope: 'graduation_requirements',
    expectedField: 'photo_background_color_code',
    expectedSource: 'Informasi Pendaftaran & Pelaksanaan Yudisium I Wisuda XXXVIII (Semester Ganjil 2026-2027) (1).pdf',
    expectedAnchors: ['#002157', 'R.0.G. 33, B 87', 'biru dongker'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /#002157|002157|r\.?0\.?g\.?\s*33/i.test(a) && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan|belum\s+tersedia/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      if (/#[0-9a-f]{6}/i.test(a)) return 'NUMERIC_MISMATCH';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H2-05',
    category: 'supported_standalone',
    query: 'apa alamat website resmi untuk login pendaftaran yudisium stikom bali?',
    expectedScope: 'graduation_portal',
    expectedField: 'portal_url',
    expectedSource: 'Informasi Pendaftaran & Pelaksanaan Yudisium I Wisuda XXXVIII (Semester Ganjil 2026-2027) (1).pdf',
    expectedAnchors: ['yudisium.stikom-bali.ac.id'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /yudisium\.stikom-bali\.ac\.id/i.test(a) && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan|belum\s+tersedia/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H2-06',
    category: 'supported_standalone',
    query: 'apa peringkat akreditasi program studi d3 manajemen informatika berdasarkan sk ban pt?',
    expectedScope: 'program_accreditation',
    expectedField: 'accreditation_grade',
    expectedSource: 'SERTIFIKAT AKREDITASI MI (17 NOV 2021 - 17 NOV 2026).pdf',
    expectedAnchors: ['Baik'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /\bbaik\b/i.test(a) && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan|belum\s+tersedia/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      if (/unggul|a\b/i.test(a)) return 'RELATION_OVERCLAIM';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H2-07',
    category: 'supported_standalone',
    query: 'apa nama izin resmi dari pemerintah indonesia yang wajib dimiliki mahasiswa asing untuk kuliah di stikom bali?',
    expectedScope: 'international_office',
    expectedField: 'permit_name',
    expectedSource: 'FAQ PENGURUSAN MAHASISWA ASING.docx',
    expectedAnchors: ['Izin Belajar', 'Study Permit'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /izin\s+belajar|study\s+permit/i.test(a) && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan|belum\s+tersedia/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H2-08',
    category: 'supported_standalone',
    query: 'sebutkan negara mana saja mitra internasional yang menjadi tujuan kegiatan student exchange stikom bali?',
    expectedScope: 'international_exchange',
    expectedField: 'partner_countries',
    expectedSource: 'Apa itu Student Exchange di ITB STIKOM Bali.docx',
    expectedAnchors: ['China', 'Thailand', 'Malaysia', 'Philippines'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      const count = ['china', 'thailand', 'malaysia', 'filipina', 'philippines'].filter(c => a.includes(c)).length;
      return count >= 2 && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan|belum\s+tersedia/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H2-09',
    category: 'supported_standalone',
    query: 'apa gelar sarjana luar negeri yang didapatkan dari program double degree help university malaysia?',
    expectedScope: 'international_degree',
    expectedField: 'degree_title',
    expectedSource: 'CHATBOT - Double Degree.docx',
    expectedAnchors: ['Bachelor of Information Technology', 'BIT'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /bachelor\s+of\s+information\s+technology|\bbit\b/i.test(a) && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan|belum\s+tersedia/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      if (/bachelor/i.test(a)) return 'WRONG_FIELD';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H2-10',
    category: 'supported_standalone',
    query: 'berapa biaya persiapan bahasa mandarin untuk program double degree dalian neusoft dnui china?',
    expectedScope: 'international_fees',
    expectedField: 'language_preparation_fee',
    expectedSource: 'rincian Biaya DNUI Tahun Ajaran 2026-2027.pdf',
    expectedAnchors: ['5.000.000', '5 juta'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /5\.000\.000|5\s*juta/i.test(a) && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan|belum\s+tersedia/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      if (/rp|\d{1,3}\.\d{3}\.\d{3}/i.test(a)) return 'NUMERIC_MISMATCH';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H2-11',
    category: 'supported_standalone',
    query: 'siapa tokoh yang memprakarsai berdirinya ukm tari tradisional pragina stikom bali?',
    expectedScope: 'ukm_founder',
    expectedField: 'founder_name',
    expectedSource: 'PROFILE ORMAWA TARI (PRAGINA).docx',
    expectedAnchors: ['Prof. Dr. I Made Bandem'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /made\s+bandem/i.test(a) && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan|belum\s+tersedia/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      return 'WRONG_ENTITY';
    }
  },
  {
    id: 'H2-12',
    category: 'supported_standalone',
    query: 'apa alamat email resmi career development center cdc itb stikom bali?',
    expectedScope: 'career_center_contact',
    expectedField: 'email',
    expectedSource: 'ok-Company-Profile-CDC (1).pdf',
    expectedAnchors: ['ts_dirkka@stikom-bali.ac.id'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /ts_dirkka@stikom-bali\.ac\.id/i.test(a) && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan|belum\s+tersedia/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      if (/@/.test(a)) return 'WRONG_FIELD';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H2-13',
    category: 'supported_standalone',
    query: 'apa saja prospek karier bagi lulusan s2 magister sistem informasi stikom bali?',
    expectedScope: 'postgraduate_career',
    expectedField: 'career_prospects',
    expectedSource: 'Training_Dataset_Pascasarjana_ITB_STIKOM_Bali.xlsx',
    expectedAnchors: ['System Analyst', 'Enterprise Architect', 'Data Scientist'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      const hits = ['system analyst', 'enterprise architect', 'data scientist'].filter(h => a.includes(h)).length;
      return hits >= 1 && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan|belum\s+tersedia/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H2-14',
    category: 'supported_standalone',
    query: 'apa kepanjangan resmi dari nama ukm paskamras stikom bali?',
    expectedScope: 'ukm_identity',
    expectedField: 'organization_full_name',
    expectedSource: 'PROFILE ORGANISASI PASKAMRAS.pdf',
    expectedAnchors: ['Pasukan Keamanan Acara Stikom Bali'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /pasukan\s+keamanan\s+acara/i.test(a) && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan|belum\s+tersedia/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H2-15',
    category: 'supported_standalone',
    query: 'apa makna lambang 5 bintang pada logo ukm paskamras?',
    expectedScope: 'ukm_symbolism',
    expectedField: 'symbol_meaning',
    expectedSource: 'PROFILE ORGANISASI PASKAMRAS.pdf',
    expectedAnchors: ['5 orang pendiri', 'lima orang pendiri'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /(?:5|lima)\s+orang\s+pendiri|(?:5|lima)\s+pendiri/i.test(a) && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan|belum\s+tersedia/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H2-16',
    category: 'supported_standalone',
    query: 'berapa batas maksimal durasi pelaksanaan ujian proposal tugas akhir s1?',
    expectedScope: 'academic_defense_rules',
    expectedField: 'max_duration',
    expectedSource: 'Pedoman TA S1 2019 Revisi 1.pdf',
    expectedAnchors: ['30 menit'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /30\s+menit/i.test(a) && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan|belum\s+tersedia/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      if (/\d+\s+menit/i.test(a)) return 'NUMERIC_MISMATCH';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H2-17',
    category: 'supported_standalone',
    query: 'paduan suara mahasiswa stikom bali diwadahi dalam organisasi kemahasiswaan apa?',
    expectedScope: 'ukm_field',
    expectedField: 'organization_name',
    expectedSource: 'Profile Ormawa VOS.docx',
    expectedAnchors: ['Voice of STIKOM', 'VOS'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /voice\s+of\s+stikom|\bvos\b/i.test(a) && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan|belum\s+tersedia/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      return 'WRONG_ENTITY';
    }
  },
  {
    id: 'H2-18',
    category: 'supported_standalone',
    query: 'kapan organisasi himpunan mahasiswa himas kampus jimbaran didirikan?',
    expectedScope: 'student_association',
    expectedField: 'established_date',
    expectedSource: 'PROFILE ORGANISASI HIMPUNAN MAHASISWA JIMBARAN.docx',
    expectedAnchors: ['17 Januari 2017', '17-01-2017'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /17\s+januari\s+2017|17-01-2017/i.test(a) && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan|belum\s+tersedia/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      if (/201[0-9]/.test(a)) return 'NUMERIC_MISMATCH';
      return 'EVIDENCE_MISS';
    }
  },

  // ==========================================
  // 4 PARTIAL SUPPORT CASES
  // ==========================================
  {
    id: 'H2-19',
    category: 'partial_support',
    query: 'bagaimana syarat pengajuan izin belajar mahasiswa asing dan berapa biaya resmi penerbitan visa kitas di kantor imigrasi denpasar?',
    expectedScope: 'international_partial',
    expectedField: 'study_permit_req_and_immigration_absence',
    expectedSource: 'FAQ PENGURUSAN MAHASISWA ASING.docx',
    expectedAnchors: ['passport/foto/surat/izin belajar', 'safe boundary no-data on external immigration fees'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      const hasPermitInfo = /izin\s+belajar|passport|paspor|foto|surat/i.test(a);
      const noHallucinatedFee = !/rp\s*[1-9]\d{5,7}|biaya\s+kitas\s+(?:sebesar\s+)?rp/i.test(a);
      return hasPermitInfo && noHallucinatedFee;
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/rp\s*[1-9]\d{5,7}/i.test(a)) return 'HALLUCINATION';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H2-20',
    category: 'partial_support',
    query: 'berapa lama kuliah double degree help university dan berapa biaya sewa apartemen bulanan di kuala lumpur?',
    expectedScope: 'international_partial',
    expectedField: 'duration_and_living_cost_absence',
    expectedSource: 'CHATBOT - Double Degree.docx',
    expectedAnchors: ['4 tahun', 'safe refusal on KL apartments'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      const hasDuration = /4\s+tahun/i.test(a);
      const noHallucinatedRent = !/(?:sewa|apartemen|kuala lumpur)\s+(?:sebesar|adalah|sekitar)\s+rp|\brm\s*\d+/i.test(a);
      return hasDuration && noHallucinatedRent;
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/\brm\s*\d+|sewa\s+apartemen\s+sebesar/i.test(a)) return 'HALLUCINATION';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H2-21',
    category: 'partial_support',
    query: 'kapan ukm badminton didirikan dan siapa nama ketua umum ukm bos tahun 2026?',
    expectedScope: 'ukm_partial',
    expectedField: 'founding_date_and_leader_absence',
    expectedSource: 'PROFILE ORGANISASI UKM BOS.docx',
    expectedAnchors: ['12 Desember 2012', 'safe absence on 2026 chairman'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      const hasDate = /12\s+desember\s+2012|2012/i.test(a);
      return hasDate;
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/ketua\s+umum\s+ukm\s+bos\s+tahun\s+2026\s+adalah\s+[a-z]+/i.test(a)) return 'HALLUCINATION';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H2-22',
    category: 'partial_support',
    query: 'dimana lokasi pelaksanaan yudisium I wisuda xxxviii dan nama katering konsumsi yang disediakan?',
    expectedScope: 'graduation_partial',
    expectedField: 'location_and_catering_absence',
    expectedSource: 'Informasi Pendaftaran & Pelaksanaan Yudisium I Wisuda XXXVIII (Semester Ganjil 2026-2027) (1).pdf',
    expectedAnchors: ['Aula STIKOM Bali', 'safe absence on catering vendor'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      const hasLocation = /aula\s+stikom/i.test(a);
      const noHallucinatedVendor = !/katering\s+(?:cv|pt|[a-z]+)/i.test(a);
      return hasLocation && noHallucinatedVendor;
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/katering\s+[a-z]+/i.test(a)) return 'HALLUCINATION';
      return 'EVIDENCE_MISS';
    }
  },

  // ==========================================
  // 4 UNSUPPORTED CONTROLS (Safe Refusals)
  // ==========================================
  {
    id: 'H2-23',
    category: 'unsupported_control',
    query: 'apakah ada program magister teknik nuklir atau teknik perkapalan di itb stikom bali?',
    expectedScope: 'unsupported',
    expectedField: 'safe_refusal',
    expectedSource: 'none',
    expectedAnchors: ['tidak tersedia', 'belum tersedia', 'tidak ada'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /tidak\s+(?:menemukan|tersedia|ada)|belum\s+(?:menemukan|tersedia|ada)|saat\s+ini\s+hanya/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tersedia\s+program\s+magister\s+teknik\s+nuklir/i.test(a)) return 'HALLUCINATION';
      return 'UNSUPPORTED_FACT';
    }
  },
  {
    id: 'H2-24',
    category: 'unsupported_control',
    query: 'bagaimana jadwal latihan mingguan ukm renang indah dan klub polo air stikom bali?',
    expectedScope: 'unsupported',
    expectedField: 'safe_refusal',
    expectedSource: 'none',
    expectedAnchors: ['tidak tersedia', 'belum tersedia'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /tidak\s+(?:menemukan|tersedia|ada)|belum\s+(?:menemukan|tersedia|ada)/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/latihan\s+setiap\s+hari/i.test(a)) return 'HALLUCINATION';
      return 'UNSUPPORTED_FACT';
    }
  },
  {
    id: 'H2-25',
    category: 'unsupported_control',
    query: 'berapa tarif sewa lapangan helipad dan landasan helikopter di atap gedung renon stikom?',
    expectedScope: 'unsupported',
    expectedField: 'safe_refusal',
    expectedSource: 'none',
    expectedAnchors: ['tidak tersedia', 'belum tersedia'],
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
    id: 'H2-26',
    category: 'unsupported_control',
    query: 'berapa denda keterlambatan pengembalian kapal selam riset di laboratorium kelautan stikom?',
    expectedScope: 'unsupported',
    expectedField: 'safe_refusal',
    expectedSource: 'none',
    expectedAnchors: ['tidak tersedia', 'belum tersedia'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /tidak\s+(?:menemukan|tersedia|ada)|belum\s+(?:menemukan|tersedia|ada)/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/denda|rp\s*[1-9]/i.test(a)) return 'HALLUCINATION';
      return 'UNSUPPORTED_FACT';
    }
  },

  // ==========================================
  // 4 COMPOUND / MULTI-BINDING CASES
  // ==========================================
  {
    id: 'H2-27',
    category: 'compound_multibinding',
    query: 'apa fokus kegiatan kelompok studi linux ksl dan bergerak di bidang apa ukm ghost stikom?',
    expectedScope: 'compound_ukm',
    expectedField: 'dual_ukm_focus',
    expectedSource: 'Profil UKM KSL.docx + Profil_UKM_GHoST_ITB_STIKOM_Bali.docx',
    expectedAnchors: ['linux/open-source', 'gym/fitness/kebugaran'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      const hasKsl = /linux|open[\s-]source|jaringan|cybersecurity/i.test(a);
      const hasGhost = /gym|fitness|kebugaran|bodybuilding/i.test(a);
      return hasKsl && hasGhost && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      const hasKsl = /linux|open[\s-]source/i.test(a);
      const hasGhost = /gym|fitness|kebugaran/i.test(a);
      if (!hasKsl || !hasGhost) return 'DROPPED_BINDING';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H2-28',
    category: 'compound_multibinding',
    query: 'berapa tahun durasi studi double degree help university malaysia dan apa singkatan gelar yang diperoleh?',
    expectedScope: 'compound_academic',
    expectedField: 'duration_and_degree',
    expectedSource: 'CHATBOT - Double Degree.docx',
    expectedAnchors: ['4 tahun', 'BIT / Bachelor of Information Technology'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      const hasDur = /4\s+tahun/i.test(a);
      const hasDeg = /\bbit\b|bachelor\s+of\s+information\s+technology/i.test(a);
      return hasDur && hasDeg && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      const hasDur = /4\s+tahun/i.test(a);
      const hasDeg = /\bbit\b|bachelor/i.test(a);
      if (!hasDur || !hasDeg) return 'DROPPED_BINDING';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H2-29',
    category: 'compound_multibinding',
    query: 'apa fungsi utama career center cdc stikom dan apa alamat email resminya?',
    expectedScope: 'compound_facility',
    expectedField: 'purpose_and_email',
    expectedSource: 'ok-Company-Profile-CDC (1).pdf',
    expectedAnchors: ['karier/lowongan/tracer study', 'ts_dirkka@stikom-bali.ac.id'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      const hasPurpose = /karier|karier|tracer\s+study|lowongan|magang|kerja/i.test(a);
      const hasEmail = /ts_dirkka@stikom-bali\.ac\.id/i.test(a);
      return hasPurpose && hasEmail && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      const hasEmail = /ts_dirkka@stikom-bali\.ac\.id/i.test(a);
      if (!hasEmail) return 'DROPPED_BINDING';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H2-30',
    category: 'compound_multibinding',
    query: 'berapa ipk minimal untuk mendaftar yudisium wisuda xxxviii dan pukul berapa yudisium dilaksanakan?',
    expectedScope: 'compound_graduation',
    expectedField: 'gpa_and_time',
    expectedSource: 'Informasi Pendaftaran & Pelaksanaan Yudisium I Wisuda XXXVIII (Semester Ganjil 2026-2027) (1).pdf',
    expectedAnchors: ['2,50', '14.00 WITA'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      const hasIpk = /2[,.]50/i.test(a);
      const hasTime = /14\.?00|14:00/i.test(a);
      return hasIpk && hasTime && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      const hasIpk = /2[,.]50/i.test(a);
      const hasTime = /14/i.test(a);
      if (!hasIpk || !hasTime) return 'DROPPED_BINDING';
      return 'EVIDENCE_MISS';
    }
  },

  // ==========================================
  // 6 CONTINUOUS MULTI-TURN TURNS
  // ==========================================
  // Session 1: International Student Procedures (H2-31 .. H2-33)
  {
    id: 'H2-31',
    sessionId: 'session_h2_intl_01',
    category: 'continuous_session',
    turnIndex: 1,
    query: 'saya mahasiswa luar negeri, apa dokumen izin yang harus saya urus untuk kuliah di itb stikom bali?',
    expectedScope: 'international_session_turn1',
    expectedField: 'permit_name',
    expectedSource: 'FAQ PENGURUSAN MAHASISWA ASING.docx',
    expectedAnchors: ['Izin Belajar', 'Study Permit'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /izin\s+belajar|study\s+permit/i.test(a) && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H2-32',
    sessionId: 'session_h2_intl_01',
    category: 'continuous_session',
    turnIndex: 2,
    query: 'apa saja syarat berkas yang harus saya siapkan untuk pengajuan dokumen tersebut?',
    expectedScope: 'international_session_turn2',
    expectedField: 'permit_requirements_in_context',
    expectedSource: 'FAQ PENGURUSAN MAHASISWA ASING.docx',
    expectedAnchors: ['passport', 'foto', 'statement letter / medical / loa'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      const hits = ['paspor', 'passport', 'photo', 'foto', 'statement', 'medical', 'surat', 'loa'].filter(k => a.includes(k)).length;
      return hits >= 2 && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan/i.test(a)) return 'LOST_CONTEXT';
      return 'EVIDENCE_MISS';
    }
  },
  {
    id: 'H2-33',
    sessionId: 'session_h2_intl_01',
    category: 'continuous_session',
    turnIndex: 3,
    query: 'kemana saya harus mengirimkan konfirmasi dokumennya lewat email?',
    expectedScope: 'international_session_turn3',
    expectedField: 'international_office_email_in_context',
    expectedSource: 'FAQ PENGURUSAN MAHASISWA ASING (2).docx',
    expectedAnchors: ['international_office@stikom-bali.ac.id'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /international_office@stikom-bali\.ac\.id/i.test(a) && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan/i.test(a)) return 'LOST_CONTEXT';
      if (/@/.test(a)) return 'WRONG_FIELD';
      return 'EVIDENCE_MISS';
    }
  },

  // Session 2: Traditional Dance & Arts UKM (H2-34 .. H2-36)
  {
    id: 'H2-34',
    sessionId: 'session_h2_arts_02',
    category: 'continuous_session',
    turnIndex: 1,
    query: 'apa nama ukm tari tradisional yang ada di kampus stikom bali?',
    expectedScope: 'arts_session_turn1',
    expectedField: 'dance_ukm_name',
    expectedSource: 'PROFILE ORMAWA TARI (PRAGINA).docx',
    expectedAnchors: ['Pragina'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /pragina/i.test(a) && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan/i.test(a)) return 'SAFE_NODATA_WHEN_SUPPORTED';
      return 'WRONG_ENTITY';
    }
  },
  {
    id: 'H2-35',
    sessionId: 'session_h2_arts_02',
    category: 'continuous_session',
    turnIndex: 2,
    query: 'siapa tokoh budayawan yang memprakarsai berdirinya ukm tersebut?',
    expectedScope: 'arts_session_turn2',
    expectedField: 'founder_in_context',
    expectedSource: 'PROFILE ORMAWA TARI (PRAGINA).docx',
    expectedAnchors: ['Prof. Dr. I Made Bandem'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /made\s+bandem/i.test(a) && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan/i.test(a)) return 'LOST_CONTEXT';
      return 'WRONG_ENTITY';
    }
  },
  {
    id: 'H2-36',
    sessionId: 'session_h2_arts_02',
    category: 'continuous_session',
    turnIndex: 3,
    query: 'dalam setiap pementasannya ukm ini biasanya didampingi oleh ukm tabuh apa?',
    expectedScope: 'arts_session_turn3',
    expectedField: 'companion_tabuh_in_context',
    expectedSource: 'PROFILE ORMAWA TARI (PRAGINA).docx',
    expectedAnchors: ['Bramara Gita'],
    validate: r => {
      const a = (r?.answer || '').toLowerCase();
      return /bramara\s+gita/i.test(a) && !/tidak\s+menemukan/i.test(a);
    },
    classifyFailure: r => {
      const a = (r?.answer || '').toLowerCase();
      if (/tidak\s+menemukan/i.test(a)) return 'LOST_CONTEXT';
      return 'WRONG_ENTITY';
    }
  }
];

async function runHoldout2() {
  console.log('=== EXECUTING FRESH INDEPENDENT HOLDOUT #2 ===');
  console.log('Total cases:', HOLDOUT_2_CASES.length);

  // Warmup
  await querySemanticRag('halo');

  const results = [];
  const sessionStates = {};

  for (let i = 0; i < HOLDOUT_2_CASES.length; i++) {
    const c = HOLDOUT_2_CASES[i];
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
  console.log('HOLDOUT #2 EXECUTION SUMMARY');
  console.log('==================================================');
  console.log(`FRESH2_TOTAL=${total}`);
  console.log(`FRESH2_PASS=${passCount}`);
  console.log(`FRESH2_FAIL=${failCount}`);
  console.log('');
  console.log(`FRESH2_HALLUCINATION_COUNT=${countClass('HALLUCINATION')}`);
  console.log(`FRESH2_UNSUPPORTED_FACT_COUNT=${countClass('UNSUPPORTED_FACT')}`);
  console.log(`FRESH2_WRONG_ENTITY_COUNT=${countClass('WRONG_ENTITY')}`);
  console.log(`FRESH2_WRONG_FIELD_COUNT=${countClass('WRONG_FIELD')}`);
  console.log(`FRESH2_WRONG_DOMAIN_COUNT=${countClass('WRONG_DOMAIN')}`);
  console.log(`FRESH2_LOST_CONTEXT_COUNT=${countClass('LOST_CONTEXT')}`);
  console.log(`FRESH2_STALE_CONTEXT_COUNT=${countClass('STALE_CONTEXT')}`);
  console.log(`FRESH2_DROPPED_BINDING_COUNT=${countClass('DROPPED_BINDING')}`);
  console.log(`FRESH2_NUMERIC_MISMATCH_COUNT=${countClass('NUMERIC_MISMATCH')}`);
  console.log(`FRESH2_SUPPORTED_EVIDENCE_MISS_COUNT=${countClass('SAFE_NODATA_WHEN_SUPPORTED') + countClass('EVIDENCE_MISS')}`);
  console.log(`FRESH2_RUNTIME_ERROR_COUNT=${countClass('RUNTIME_ERROR')}`);

  fs.writeFileSync(
    path.resolve(__dirname, 'final_holdout_2_results.json'),
    JSON.stringify({ total, passCount, failCount, results }, null, 2)
  );

  return { total, passCount, failCount, results };
}

module.exports = { runHoldout2, HOLDOUT_2_CASES };

if (require.main === module) {
  runHoldout2().catch(e => {
    console.error('FATAL ERROR IN HOLDOUT #2 RUNNER:', e);
    process.exit(1);
  });
}
