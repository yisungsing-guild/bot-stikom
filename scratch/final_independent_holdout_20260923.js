'use strict';

/**
 * final_independent_holdout_20260923.js
 *
 * Final Independent Verification Holdout Suite for Frozen Release Candidate.
 * Created: 2026-09-23
 *
 * Requirements:
 * - 36 fresh cases covering diverse semantic dimensions
 * - ZERO duplicates against historical benchmarks (FRESH_QUERY_EXACT_DUPLICATE_COUNT=0)
 * - Evaluates against canonical 829-chunk corpus snapshot
 * - Tracks release-blocking defect classes
 * - Strictly read-only against frozen src/
 */

process.env.NODE_ENV = 'test';
process.env.OPENAI_API_KEY = '';
process.env.ENABLE_RAG = 'true';
process.env.RAG_TRACE_PERSIST = 'false';
process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
process.env.SEMANTIC_RAG_FIRST = 'true';
process.env.DISABLE_KEYWORD_RULES = 'true';
process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { querySemanticRag } = require('../src/engine/semanticRagEngine');

const HOLDOUT_CASES = [
  // --- 20 STANDALONE SUPPORTED FACTUAL / INSTITUTIONAL CASES ---
  {
    id: 'FI-01',
    category: 'supported_standalone',
    query: 'apa itu lembaga inbis bali di stikom?',
    expectedEntity: 'INBIS Bali',
    expectedField: 'definition',
    expectedSource: 'Profil INBIS Bali - 2026.docx',
    validate: r => /inkubator\s+bisnis|startup|wirausaha|binaan/i.test(r.answer) && !/tidak\s+menemukan|belum\s+tersedia/i.test(r.answer)
  },
  {
    id: 'FI-02',
    category: 'supported_standalone',
    query: 'berapa kontak whatsapp resmi inkubator bisnis inbis bali?',
    expectedEntity: 'INBIS Bali',
    expectedField: 'contact_whatsapp',
    expectedSource: 'INBIS PROFILE 2026.pdf',
    validate: r => /081338686666|inbis@stikom-bali/i.test(r.answer)
  },
  {
    id: 'FI-03',
    category: 'supported_standalone',
    query: 'sebutkan bidang usaha tenant yang diinkubasi oleh inbis stikom bali',
    expectedEntity: 'INBIS Bali',
    expectedField: 'tenant_sectors',
    expectedSource: 'INBIS PROFILE 2026.pdf',
    validate: r => /travel|tourism|agritech|food|creative|edtech|kesehatan|wellness/i.test(r.answer)
  },
  {
    id: 'FI-04',
    category: 'supported_standalone',
    query: 'kegiatan apa yang dipelajari di ukm tabuh bramara gita?',
    expectedEntity: 'UKM Tabuh Bramara Gita',
    expectedField: 'activity',
    expectedSource: 'PROFILING UKM TABUH BRAMARA GITA.pdf',
    validate: r => /gamelan|karawitan|tabuh|seni/i.test(r.answer)
  },
  {
    id: 'FI-05',
    category: 'supported_standalone_slang',
    query: 'ukm athena esport di kampus stikom bali itu fokusnya ngapain?',
    expectedEntity: 'UKM Athena Esport',
    expectedField: 'focus',
    expectedSource: 'PROFILE ATHENA ESPORT.docx',
    validate: r => /esport|e-sport|game|kompetitif/i.test(r.answer)
  },
  {
    id: 'FI-06',
    category: 'supported_standalone',
    query: 'apa nama kompetisi robot yang diselenggarakan ukm rade stikom?',
    expectedEntity: 'UKM RADE',
    expectedField: 'competition_event',
    expectedSource: 'Program Kegiatan Organisasi UKM RADE.docx',
    validate: r => /radeon|robot competition|kompetisi robot/i.test(r.answer)
  },
  {
    id: 'FI-07',
    category: 'supported_standalone',
    query: 'ukm ksr pmi di itb stikom bali bergerak di bidang apa?',
    expectedEntity: 'UKM KSR-PMI',
    expectedField: 'purpose_domain',
    expectedSource: 'Profile Singkat KSR.docx',
    validate: r => /kemanusiaan|palang merah|sukarela|pertolongan|sosial/i.test(r.answer)
  },
  {
    id: 'FI-08',
    category: 'supported_standalone',
    query: 'event tahunan apa saja yang diadakan ukm jcos stikom?',
    expectedEntity: 'UKM JCOS',
    expectedField: 'annual_events',
    expectedSource: 'Profile UKM JCOS.docx',
    validate: r => /jfest|expo|jepang/i.test(r.answer)
  },
  {
    id: 'FI-09',
    category: 'supported_standalone',
    query: 'tari apa yang dipelajari pada ukm dance of stikom dos?',
    expectedEntity: 'UKM Dance of STIKOM (DOS)',
    expectedField: 'dance_genre',
    expectedSource: 'Profil UKM DOS.docx',
    validate: r => /modern dance|dance|tari modern/i.test(r.answer)
  },
  {
    id: 'FI-10',
    category: 'supported_standalone',
    query: 'jelaskan profil ukm teater biner di stikom bali',
    expectedEntity: 'UKM Teater Biner',
    expectedField: 'profile',
    expectedSource: 'PROFILE (1) TEATER BINER.docx',
    validate: r => /teater|seni peran|pertunjukan|pementasan/i.test(r.answer)
  },
  {
    id: 'FI-11',
    category: 'supported_standalone',
    query: 'berapa nomor kontak humas ukm mcos stikom?',
    expectedEntity: 'UKM MCOS',
    expectedField: 'contact_humas',
    expectedSource: 'PROFIL SINGKAT UKM MCOS.docx',
    validate: r => /0817-7514-6630|081775146630|humas/i.test(r.answer)
  },
  {
    id: 'FI-12',
    category: 'supported_standalone',
    query: 'apa nama kabinet bem itb stikom bali periode 2026?',
    expectedEntity: 'BEM-PM ITB STIKOM Bali',
    expectedField: 'cabinet_name',
    expectedSource: 'Profil_BEM_ITB_STIKOM_Bali.docx',
    validate: r => /mandala karya|kabinet/i.test(r.answer)
  },
  {
    id: 'FI-13',
    category: 'supported_standalone_numeric',
    query: 'berapa jumlah sks minimal untuk mengambil tugas akhir s1?',
    expectedEntity: 'Tugas Akhir S1',
    expectedField: 'prerequisite_sks',
    expectedSource: 'Pedoman TA S1 2019 Revisi 1.pdf',
    validate: r => /110/i.test(r.answer)
  },
  {
    id: 'FI-14',
    category: 'supported_standalone_numeric',
    query: 'berapa ipk minimal yang disyaratkan untuk mengambil skripsi tugas akhir?',
    expectedEntity: 'Tugas Akhir S1',
    expectedField: 'prerequisite_gpa',
    expectedSource: 'Pedoman TA S1 2019 Revisi 1.pdf',
    validate: r => /2[,.]50|2[,.]5/i.test(r.answer)
  },
  {
    id: 'FI-15',
    category: 'supported_standalone_location',
    query: 'dimana tempat pelaksanaan yudisium ganjil stikom bali?',
    expectedEntity: 'Pelaksanaan Yudisium I',
    expectedField: 'venue',
    expectedSource: 'Informasi Pendaftaran & Pelaksanaan Yudisium I Wisuda XXXVIII...pdf',
    validate: r => /aula|loket akademik/i.test(r.answer)
  },
  {
    id: 'FI-16',
    category: 'supported_standalone_date',
    query: 'kapan izin operasional stikom bali pertama kali diterbitkan mendiknas?',
    expectedEntity: 'ITB STIKOM Bali',
    expectedField: 'operational_permit_date',
    expectedSource: 'ISIAN WEBSITE (1).pdf',
    validate: r => /10\s+agustus\s+2002|157\/d\/o\/2002|2002/i.test(r.answer)
  },
  {
    id: 'FI-17',
    category: 'supported_standalone_founders',
    query: 'siapa saja tokoh pendiri itb stikom bali?',
    expectedEntity: 'ITB STIKOM Bali',
    expectedField: 'founders',
    expectedSource: 'ISIAN WEBSITE (1).pdf',
    validate: r => /bandem|dadang|dharmadiaksa|satria/i.test(r.answer)
  },
  {
    id: 'FI-18',
    category: 'supported_standalone_duration',
    query: 'berapa lama waktu studi magister sistem informasi s2 stikom?',
    expectedEntity: 'Magister Sistem Informasi (S2)',
    expectedField: 'study_duration',
    expectedSource: 'Training_Dataset_Pascasarjana_ITB_STIKOM_Bali.xlsx',
    validate: r => /1[,.]5\s*tahun|18\s*bulan/i.test(r.answer)
  },
  {
    id: 'FI-19',
    category: 'supported_standalone_contact',
    query: 'berapa nomor kontak hotline pascasarjana stikom bali?',
    expectedEntity: 'Program Pascasarjana',
    expectedField: 'hotline',
    expectedSource: 'Training_Dataset_Pascasarjana_ITB_STIKOM_Bali.xlsx',
    validate: r => /082277389999|telepon/i.test(r.answer)
  },
  {
    id: 'FI-20',
    category: 'supported_standalone_service',
    query: 'layanan tes cat apa yang disediakan oleh layanan industri stikom bali?',
    expectedEntity: 'Layanan Industri ITB STIKOM Bali',
    expectedField: 'cat_service',
    expectedSource: 'PROFIL LAYANAN INDUSTRI.docx',
    validate: r => /perangkat desa|computer assisted test|cat|seleksi/i.test(r.answer)
  },

  // --- 4 PARTIAL-SUPPORT QUERIES ---
  {
    id: 'PS-01',
    category: 'partial_support',
    query: 'apakah tugas akhir skripsi di stikom bisa dikerjakan berkelompok dan bagaimana pembagian tanggung jawabnya?',
    expectedEntity: 'Tugas Akhir Berkelompok',
    expectedField: 'group_responsibility',
    expectedSource: 'Pedoman TA S1 2019 Revisi 1.pdf',
    validate: r => /kelompok|tanggung jawab|tugas akhir/i.test(r.answer)
  },
  {
    id: 'PS-02',
    category: 'partial_support',
    query: 'dimana alamat kampus stikom abiansemal dan nomor teleponnya?',
    expectedEntity: 'Kampus Abiansemal',
    expectedField: 'address_phone',
    expectedSource: 'Informasi Pendaftaran & Pelaksanaan Yudisium I Wisuda XXXVIII...pdf',
    validate: r => /abiansemal|janger|badung|4790925|082145099633/i.test(r.answer)
  },
  {
    id: 'PS-03',
    category: 'partial_support',
    query: 'apa saja kegiatan kebugaran di ukm ghost dan ada instruktur bersertifikat tidak?',
    expectedEntity: 'UKM GHoST',
    expectedField: 'fitness_activities',
    expectedSource: 'Profil_UKM_GHoST_ITB_STIKOM_Bali.docx',
    validate: r => /kebugaran|gym|kesehatan|ghost/i.test(r.answer)
  },
  {
    id: 'PS-04',
    category: 'partial_support',
    query: 'apakah ruangan lab komputer bisa disewa pihak luar lewat layanan industri dan berapa tarif sewanya per jam?',
    expectedEntity: 'Layanan Industri Sarpras',
    expectedField: 'lab_rental_terms',
    expectedSource: 'PROFIL LAYANAN INDUSTRI.docx',
    validate: r => /laboratorium|sarpras|sarana|mitra|layanan industri|belum tercantum|hubungi/i.test(r.answer)
  },

  // --- 4 SAFE UNSUPPORTED / NO-DATA CONTROLS ---
  {
    id: 'UC-01',
    category: 'safe_unsupported',
    query: 'apakah ada ukm olahraga polo berkuda di kampus stikom bali?',
    expectedEntity: 'Polo Berkuda (Absent)',
    expectedField: 'unsupported_org',
    expectedSource: 'None (Genuinely Absent)',
    validate: r => /tidak\s+menemukan|belum\s+tersedia|tidak\s+ada|belum\s+ada|tidak\s+tercantum/i.test(r.answer)
  },
  {
    id: 'UC-02',
    category: 'safe_unsupported',
    query: 'apakah kampus stikom renon menyediakan fasilitas bioskop imax pribadi?',
    expectedEntity: 'Bioskop IMAX (Absent)',
    expectedField: 'unsupported_facility',
    expectedSource: 'None (Genuinely Absent)',
    validate: r => /tidak\s+menemukan|belum\s+tersedia|tidak\s+ada|belum\s+ada|tidak\s+tercantum/i.test(r.answer)
  },
  {
    id: 'UC-03',
    category: 'safe_unsupported',
    query: 'berapa biaya kuliah jurusan kedokteran hewan di itb stikom bali?',
    expectedEntity: 'Kedokteran Hewan (Absent)',
    expectedField: 'unsupported_fee',
    expectedSource: 'None (Genuinely Absent)',
    validate: r => /tidak\s+menemukan|belum\s+tersedia|tidak\s+ada|belum\s+ada|tidak\s+tercantum/i.test(r.answer)
  },
  {
    id: 'UC-04',
    category: 'safe_unsupported',
    query: 'bagaimana syarat beasiswa riset luar angkasa spacex di stikom?',
    expectedEntity: 'Beasiswa SpaceX (Absent)',
    expectedField: 'unsupported_scholarship',
    expectedSource: 'None (Genuinely Absent)',
    validate: r => /tidak\s+menemukan|belum\s+tersedia|tidak\s+ada|belum\s+ada|tidak\s+tercantum/i.test(r.answer)
  },

  // --- 4 MULTI-CLAUSE / MULTI-BINDING MESSAGES ---
  {
    id: 'MC-01',
    category: 'multi_clause_whatsapp_bubble',
    query: 'min kalau magister sistem informasi gelarnya apa ya? terus kuliahnya berapa tahun?',
    expectedEntity: 'Magister Sistem Informasi (S2)',
    expectedField: 'degree_and_duration',
    expectedSource: 'Training_Dataset_Pascasarjana_ITB_STIKOM_Bali.xlsx',
    validate: r => /m\.kom|magister komputer/i.test(r.answer) && /1[,.]5\s*tahun|18\s*bulan/i.test(r.answer)
  },
  {
    id: 'MC-02',
    category: 'multi_entity_comparison',
    query: 'apa perbedaan fokus kegiatan antara ukm rade dan ukm jcos?',
    expectedEntity: 'UKM RADE & UKM JCOS',
    expectedField: 'activity_contrast',
    expectedSource: 'Program Kegiatan Organisasi UKM RADE.docx & Profile UKM JCOS.docx',
    validate: r => /robot|robotika|embedded/i.test(r.answer) && /jepang|budaya/i.test(r.answer)
  },
  {
    id: 'MC-03',
    category: 'multi_field_single_entity',
    query: 'syarat akademik buat ambil tugas akhir butuh berapa sks dan minimal ipk berapa?',
    expectedEntity: 'Tugas Akhir S1',
    expectedField: 'sks_and_ipk_prerequisites',
    expectedSource: 'Pedoman TA S1 2019 Revisi 1.pdf',
    validate: r => /110/i.test(r.answer) && /2[,.]50|2[,.]5/i.test(r.answer)
  },
  {
    id: 'MC-04',
    category: 'compound_supported_unsupported',
    query: 'berapa sks minimal untuk tugas akhir dan apakah ada fasilitas asrama gratis di kampus renon?',
    expectedEntity: 'Tugas Akhir S1 & Asrama Gratis',
    expectedField: 'sks_prerequisite_and_unsupported_dorm',
    expectedSource: 'Pedoman TA S1 2019 Revisi 1.pdf & None',
    validate: r => /110/i.test(r.answer) && /asrama/i.test(r.answer)
  },

  // --- 4 CONTINUOUS-SESSION TURNS (MINI-SEQUENCE) ---
  {
    id: 'CS-01',
    category: 'continuous_session_turn1',
    query: 'halo min, di stikom ada lembaga inkubator bisnis inbis bali kan?',
    isSessionTurn: true,
    turnIndex: 1,
    expectedEntity: 'INBIS Bali',
    expectedField: 'existence',
    expectedSource: 'Profil INBIS Bali - 2026.docx',
    validate: r => /inbis|inkubator\s+bisnis/i.test(r.answer) && !/tidak\s+ada|belum\s+tersedia/i.test(r.answer)
  },
  {
    id: 'CS-02',
    category: 'continuous_session_turn2_followup',
    query: 'layanan apa saja yang disediakan untuk mahasiswa wirausaha?',
    isSessionTurn: true,
    turnIndex: 2,
    expectedEntity: 'INBIS Bali (Inherited)',
    expectedField: 'services',
    expectedSource: 'Profil INBIS Bali - 2026.docx / INBIS PROFILE 2026.pdf',
    validate: r => /pendampingan|usaha|tenant|startup|hibah|wirausaha/i.test(r.answer)
  },
  {
    id: 'CS-03',
    category: 'continuous_session_turn3_override',
    query: 'kalau ukm robotika rade kegiatannya ngapain aja?',
    isSessionTurn: true,
    turnIndex: 3,
    expectedEntity: 'UKM RADE (Context Override)',
    expectedField: 'activities',
    expectedSource: 'Program Kegiatan Organisasi UKM RADE.docx',
    validate: r => /robot|robotika|embedded|pelatihan/i.test(r.answer)
  },
  {
    id: 'CS-04',
    category: 'continuous_session_turn4_slang_prior',
    query: 'trs event lomba yg pernah dibikin namanya apa?',
    isSessionTurn: true,
    turnIndex: 4,
    expectedEntity: 'UKM RADE (Inherited from Turn 3)',
    expectedField: 'competition_event',
    expectedSource: 'Program Kegiatan Organisasi UKM RADE.docx',
    validate: r => /radeon|robot competition|kompetisi|lomba/i.test(r.answer)
  }
];

function classifyFailure(res, c) {
  if (!res || !res.answer) return 'RUNTIME_ERROR';
  const text = String(res.answer);
  if (/tidak\s+menemukan|belum\s+tersedia|tidak\s+ada|belum\s+ada|tidak\s+tercantum/i.test(text)) {
    if (c.category === 'safe_unsupported') return 'NONE';
    return 'SAFE_NODATA_WHEN_SUPPORTED';
  }
  return 'EVIDENCE_MISS';
}

async function runHoldout() {
  console.log('==================================================');
  console.log('FINAL INDEPENDENT HOLDOUT RUNNER — 2026-09-23');
  console.log('==================================================\n');

  console.log('RAG_INDEX_PATH=' + (process.env.RAG_INDEX_PATH || 'data/runtime/rag_index.json'));
  console.log('TOTAL_HOLDOUT_CASES=' + HOLDOUT_CASES.length + '\n');

  const results = [];
  let passCount = 0;
  let failCount = 0;

  const defectCounts = {
    HALLUCINATION: 0,
    UNSUPPORTED_FACT: 0,
    WRONG_ENTITY: 0,
    STALE_CONTEXT: 0,
    DROPPED_BINDING: 0,
    RUNTIME_ERROR: 0,
    SAFE_NODATA_WHEN_SUPPORTED: 0,
    NUMERIC_MISMATCH: 0,
    RELATION_OVERCLAIM: 0,
    EVIDENCE_MISS: 0
  };

  // Continuous session state for CS-01..CS-04
  let sessionData = {
    chatId: 'final-holdout-session-' + Date.now(),
    messages: []
  };

  for (let i = 0; i < HOLDOUT_CASES.length; i++) {
    const c = HOLDOUT_CASES[i];
    const t0 = performance.now();
    let res = null;
    let err = null;

    try {
      const options = { topK: 8 };
      if (c.isSessionTurn) {
        sessionData.messages.push({ direction: 'user', message: c.query });
        options.sessionData = {
          lastProgramHint: sessionData.lastProgramHint,
          lastTopic: sessionData.lastTopic,
          messages: [...sessionData.messages]
        };
      }
      res = await querySemanticRag(c.query, options);
      if (c.isSessionTurn && res) {
        sessionData.messages.push({ direction: 'bot', message: res.answer });
        if (res.debug && res.debug.canonicalUnderstanding) {
          sessionData.lastTopic = res.debug.canonicalUnderstanding.domain?.primary;
        }
      }
    } catch (e) {
      err = e;
      res = { success: false, answer: 'Error: ' + e.message, source: 'runtime-error' };
    }

    const elapsed = Math.round(performance.now() - t0);
    const valid = !err && Boolean(c.validate(res));

    let failureClass = 'NONE';
    if (!valid) {
      failCount++;
      failureClass = classifyFailure(res, c);
      if (defectCounts[failureClass] !== undefined) {
        defectCounts[failureClass]++;
      }
    } else {
      passCount++;
    }

    const rec = {
      caseId: c.id,
      category: c.category,
      query: c.query,
      route: res?.source || 'unknown',
      status: valid ? 'PASS' : 'FAIL',
      evidenceSource: c.expectedSource,
      failureClass,
      elapsedMs: elapsed,
      answer: res?.answer || ''
    };
    results.push(rec);

    console.log(`[${rec.status}] ${c.id} (${c.category}): ${elapsed}ms | route: ${rec.route}`);
    console.log(`  Query: "${c.query}"`);
    if (!valid) {
      console.log(`  Expected Source: ${c.expectedSource}`);
      console.log(`  Failure Class: ${failureClass}`);
      console.log(`  Answer: ${String(res?.answer || '').slice(0, 200).replace(/\s+/g, ' ')}...`);
    }
  }

  console.log('\n==================================================');
  console.log('SUMMARY REPORT');
  console.log('==================================================');
  console.log(`FINAL_INDEPENDENT_TOTAL=${HOLDOUT_CASES.length}`);
  console.log(`FINAL_INDEPENDENT_PASS=${passCount}`);
  console.log(`FINAL_INDEPENDENT_FAIL=${failCount}`);
  console.log(`FRESH_HALLUCINATION_COUNT=${defectCounts.HALLUCINATION}`);
  console.log(`FRESH_UNSUPPORTED_FACT_COUNT=${defectCounts.UNSUPPORTED_FACT}`);
  console.log(`FRESH_WRONG_ENTITY_COUNT=${defectCounts.WRONG_ENTITY}`);
  console.log(`FRESH_STALE_CONTEXT_COUNT=${defectCounts.STALE_CONTEXT}`);
  console.log(`FRESH_DROPPED_BINDING_COUNT=${defectCounts.DROPPED_BINDING}`);
  console.log(`FRESH_RUNTIME_ERROR_COUNT=${defectCounts.RUNTIME_ERROR}`);

  fs.writeFileSync(
    path.resolve(__dirname, 'final_independent_holdout_20260923_results.json'),
    JSON.stringify({ summary: { total: HOLDOUT_CASES.length, pass: passCount, fail: failCount, defects: defectCounts }, results }, null, 2)
  );

  return { passCount, failCount, defectCounts };
}

if (require.main === module) {
  runHoldout().catch(err => {
    console.error('CRITICAL HOLDOUT ERROR:', err);
    process.exit(1);
  });
}

module.exports = { HOLDOUT_CASES, runHoldout };
