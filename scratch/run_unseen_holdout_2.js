'use strict';

process.env.NODE_ENV = 'test';
process.env.OPENAI_API_KEY = '';
process.env.ENABLE_RAG = 'true';
process.env.FORCE_BUNDLED_INDEX = 'true';
process.env.RAG_TRACE_PERSIST = 'false';
process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
process.env.SEMANTIC_RAG_FIRST = 'true';
process.env.DISABLE_KEYWORD_RULES = 'true';
process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { querySemanticRag } = require('../src/engine/semanticRagEngine');

const STANDALONE_CASES = [
  {
    id: 'U2-01',
    category: 'explicit_entity_one_field',
    domain: 'organization',
    entities: ['UKM RADE'],
    fields: ['kegiatan'],
    query: 'kegiatan utama di ukm radio broadcasting rade itu ngapain aja ya?',
    expectedType: 'SUPPORTED',
    validate: (r) => /rade|radio|broadcasting|penyiaran|siaran/i.test(r.answer)
  },
  {
    id: 'U2-02',
    category: 'explicit_entity_multi_fields',
    domain: 'academic',
    entities: ['Ujian Proposal Skripsi'],
    fields: ['syarat', 'berkas'],
    query: 'syarat pendaftaran ujian proposal skripsi dan dokumen apa saja yang wajib dilampirkan?',
    expectedType: 'SUPPORTED',
    validate: (r) => /proposal|skripsi|syarat|formulir|berkas|pendaftaran/i.test(r.answer)
  },
  {
    id: 'U2-03',
    category: 'multiple_entities',
    domain: 'program',
    entities: ['S1 Bisnis Digital', 'D3 Manajemen Informatika'],
    fields: ['availability'],
    query: 'di stikom ada jurusan s1 bisnis digital sama d3 manajemen informatika ga?',
    expectedType: 'SUPPORTED',
    validate: (r) => /bisnis digital/i.test(r.answer) && /manajemen informatika/i.test(r.answer)
  },
  {
    id: 'U2-04',
    category: 'comparison_between_entities',
    domain: 'program',
    entities: ['S1 Sistem Informasi', 'S1 Sistem Komputer'],
    fields: ['perbedaan'],
    query: 'apa bedanya fokus pembelajaran s1 sistem informasi dengan s1 sistem komputer?',
    expectedType: 'SUPPORTED',
    validate: (r) => /sistem informasi/i.test(r.answer) && /sistem komputer/i.test(r.answer)
  },
  {
    id: 'U2-05',
    category: 'implicit_entity_description',
    domain: 'organization',
    entities: ['UKM BOS'],
    fields: ['profil'],
    query: 'kalo mahasiswa yang pengen belajar bulutangkis ada organisasinya ga?',
    expectedType: 'SUPPORTED',
    validate: (r) => /bos|badminton|bulutangkis/i.test(r.answer)
  },
  {
    id: 'U2-06',
    category: 'open_world_lowercase',
    domain: 'organization',
    entities: ['UKM Reptil'],
    fields: ['availability'],
    query: 'apakah di kampus stikom ada ukm pencinta reptil atau ular?',
    expectedType: 'TRUE_NODATA',
    validate: (r) => /belum menemukan|tidak menemukan|tidak ada|belum tersedia/i.test(r.answer)
  },
  {
    id: 'U2-07',
    category: 'entity_alias',
    domain: 'organization',
    entities: ['UKM SYNTAX'],
    fields: ['kegiatan'],
    query: 'klub english speaking syntax di stikom kegiatannya apa min?',
    expectedType: 'SUPPORTED',
    validate: (r) => /syntax|english|speaking|bahasa inggris/i.test(r.answer)
  },
  {
    id: 'U2-08',
    category: 'typo_slang_recoverable',
    domain: 'pmb',
    entities: ['PMB Reguler'],
    fields: ['syarat'],
    query: 'syrat dftr maba ap aj yg prlu disiapin bwt pmb reguler?',
    expectedType: 'SUPPORTED',
    validate: (r) => /syarat|ijazah|ktp|foto|rapor|dokumen|pendaftaran/i.test(r.answer)
  },
  {
    id: 'U2-09',
    category: 'typo_slang_ambiguous',
    domain: 'fee',
    entities: ['Kelas Malam'],
    fields: ['biaya'],
    query: 'bya smstr awal bwt yg kls mlm brp duit y gan?',
    expectedType: 'AMBIGUOUS',
    validate: (r) => (/jelaskan|topik|belum dapat merangkum|belum menemukan|konfirmasi|agar tidak keliru/i.test(r.answer)) && !/biaya kelas malam sebesar|rp\s*2\d\.\d{3}\.\d{3}/i.test(r.answer)
  },
  {
    id: 'U2-10',
    category: 'multi_question_supported_supported',
    domain: 'multi_domain',
    entities: ['PMB', 'Laboratorium Komputer'],
    fields: ['gelombang', 'fasilitas'],
    query: 'jadwal pendaftaran pmb gelombang sekarang buka sampai kapan, dan apakah ada fasilitas laboratorium komputer di kampus?',
    expectedType: 'SUPPORTED',
    validate: (r) => (/gelombang|pendaftaran|jadwal/i.test(r.answer)) && (/laboratorium|lab|komputer|fasilitas/i.test(r.answer))
  },
  {
    id: 'U2-11',
    category: 'multi_question_supported_unsupported',
    domain: 'multi_domain',
    entities: ['PMB', 'Asrama Kampus'],
    fields: ['biaya_pendaftaran', 'asrama'],
    query: 'biaya pendaftaran mahasiswa baru berapa ya, terus apakah ada asrama khusus mahasiswa di dalam kampus?',
    expectedType: 'PARTIAL',
    validate: (r) => (/500\.000|pendaftaran/i.test(r.answer)) && (/asrama|belum menemukan|tidak tersedia|konfirmasi/i.test(r.answer))
  },
  {
    id: 'U2-12',
    category: 'multi_entity_multi_field',
    domain: 'multi_domain',
    entities: ['S1 Bisnis Digital', 'Kontak Kampus'],
    fields: ['akreditasi', 'kontak'],
    query: 'akreditasi prodi s1 bisnis digital apa ya, terus nomor kontak layanan customer service stikom berapa?',
    expectedType: 'SUPPORTED',
    validate: (r) => (/baik|akreditasi/i.test(r.answer)) && (/0361|08|telepon|kontak|wa/i.test(r.answer))
  },
  {
    id: 'U2-13',
    category: 'partial_evidence',
    domain: 'service',
    entities: ['LLC'],
    fields: ['kursus_n3'],
    query: 'apakah lembaga language learning center llc menyediakan kursus bahasa jepang bersertifikat n3?',
    expectedType: 'PARTIAL',
    validate: (r) => /language|llc|bahasa|jepang|belum menemukan|konfirmasi/i.test(r.answer)
  },
  {
    id: 'U2-14',
    category: 'fee_policy_detail',
    domain: 'fee',
    entities: ['Biaya Pendaftaran PMB'],
    fields: ['kebijakan_refund'],
    query: 'apakah biaya pendaftaran pmb 500 ribu itu hangus jika tidak lolos seleksi?',
    expectedType: 'AMBIGUOUS',
    validate: (r) => /pendaftaran|500|biaya|kemahasiswaan|konfirmasi|kebijakan/i.test(r.answer)
  },
  {
    id: 'U2-15',
    category: 'procedure_requirement',
    domain: 'academic',
    entities: ['Remedial'],
    fields: ['alur'],
    query: 'bagaimana alur pendaftaran remedial ujian bagi mahasiswa yang nilainya belum lulus?',
    expectedType: 'SUPPORTED',
    validate: (r) => /remedial|ujian|pendaftaran|jadwal|akademik/i.test(r.answer)
  },
  {
    id: 'U2-16',
    category: 'media_document_request',
    domain: 'academic',
    entities: ['Pedoman Tugas Akhir'],
    fields: ['dokumen'],
    query: 'bisa minta dokumen lampiran pedoman penulisan tugas akhir skripsi?',
    expectedType: 'SUPPORTED',
    validate: (r) => /pedoman|tugas akhir|skripsi|dokumen|panduan/i.test(r.answer)
  },
  {
    id: 'U2-17',
    category: 'date_schedule',
    domain: 'schedule',
    entities: ['Wisuda'],
    fields: ['jadwal'],
    query: 'kapan periode pelaksanaan gladi bersih dan wisuda sarjana tahun akademik 2025/2026?',
    expectedType: 'SUPPORTED',
    validate: (r) => /wisuda|gladi|yudisium|jadwal|semester/i.test(r.answer)
  },
  {
    id: 'U2-18',
    category: 'service_facility',
    domain: 'facility',
    entities: ['Inkubator Bisnis INBIS'],
    fields: ['layanan'],
    query: 'apa layanan yang diberikan oleh inkubator bisnis inbis stikom bali bagi mahasiswa yang punya startup?',
    expectedType: 'SUPPORTED',
    validate: (r) => /inkubator|inbis|bisnis|startup|usaha|tenant|pendampingan/i.test(r.answer)
  },
  {
    id: 'U2-19',
    category: 'organization_spiritual',
    domain: 'organization',
    entities: ['UKM PMK'],
    fields: ['profil'],
    query: 'wadah organisasi untuk mahasiswa kristen di stikom bali namanya apa ya?',
    expectedType: 'TRUE_NODATA',
    validate: (r) => (/belum menemukan|tidak menemukan|belum tersedia|konfirmasi/i.test(r.answer)) && !/mapala|kompas/i.test(r.answer)
  },
  {
    id: 'U2-20',
    category: 'true_nodata',
    domain: 'out_of_domain',
    entities: ['Laundry Gratis'],
    fields: ['layanan'],
    query: 'apakah kampus menyediakan jasa laundry kiloan gratis untuk mahasiswa tingkat akhir?',
    expectedType: 'TRUE_NODATA',
    validate: (r) => /belum menemukan|tidak menemukan|tidak ada|belum tersedia/i.test(r.answer)
  },
  {
    id: 'U2-21',
    category: 'ambiguous_evidence',
    domain: 'scholarship',
    entities: ['Beasiswa DPP'],
    fields: ['perpanjangan_otomatis'],
    query: 'apakah beasiswa potongan uang gedung otomatis diperpanjang tiap semester tanpa syarat ipk?',
    expectedType: 'AMBIGUOUS',
    validate: (r) => /beasiswa|potongan|dpp|ipk|syarat|ketentuan|konfirmasi/i.test(r.answer)
  },
  {
    id: 'U2-22',
    category: 'program_duration',
    domain: 'program',
    entities: ['D3 Manajemen Informatika'],
    fields: ['masa_studi'],
    query: 'berapa tahun masa studi normal untuk menyelesaikan kuliah jenjang d3 di stikom?',
    expectedType: 'SUPPORTED',
    validate: (r) => /3\s*(?:tahun|thn)|6\s*semester|d3/i.test(r.answer)
  },
  {
    id: 'U2-23',
    category: 'program_transition',
    domain: 'program',
    entities: ['Transfer D3 ke S1'],
    fields: ['lanjut_studi'],
    query: 'setelah lulus d3 apakah bisa lanjut transfer ke s1 sistem informasi?',
    expectedType: 'SUPPORTED',
    validate: (r) => /transfer|lanjut|s1|sistem informasi|d3/i.test(r.answer)
  },
  {
    id: 'U2-24',
    category: 'stale_context_trap',
    domain: 'accreditation',
    entities: ['S1 Sistem Komputer'],
    fields: ['akreditasi'],
    query: 'saya mau tanya tentang biaya kuliah d3 manajemen informatika... eh gajadi min, mau tanya akreditasi sistem komputer aja jadinya.',
    expectedType: 'SUPPORTED',
    validate: (r) => /sistem komputer/i.test(r.answer) && /baik sekali|unggul|akreditasi/i.test(r.answer) && !/biaya kuliah d3/i.test(r.answer)
  }
];

const CONTINUOUS_TURNS = [
  {
    id: 'U2-T1',
    category: 'continuous_session',
    turnIndex: 1,
    role: 'establish_entity',
    entities: ['UKM MAPALA Kompas'],
    fields: ['profil'],
    query: 'halo min, mau tanya tentang ukm mapala kompas dong',
    expectedType: 'SUPPORTED',
    validate: (r) => /mapala|kompas|alam|pecinta alam/i.test(r.answer)
  },
  {
    id: 'U2-T2',
    category: 'continuous_session',
    turnIndex: 2,
    role: 'followup_field',
    entities: ['UKM MAPALA Kompas'],
    fields: ['kegiatan'],
    query: 'kegiatan outdoor apa saja yang sering mereka adain?',
    expectedType: 'SUPPORTED',
    validate: (r) => /kegiatan|gunung|hutan|alam|lingkungan|latihan/i.test(r.answer)
  },
  {
    id: 'U2-T3',
    category: 'continuous_session',
    turnIndex: 3,
    role: 'switch_field',
    entities: ['UKM MAPALA Kompas'],
    fields: ['pembina'],
    query: 'siapa nama dosen pembina organisasinya?',
    expectedType: 'SUPPORTED',
    validate: (r) => /sastrawangsa|gde sastrawangsa|pembina/i.test(r.answer)
  },
  {
    id: 'U2-T4',
    category: 'continuous_session',
    turnIndex: 4,
    role: 'explicit_correction',
    entities: ['UKM Multimedia'],
    fields: ['pembina'],
    query: 'eh maaf salah ketik, maksud saya pembina ukm multimedia siapa ya min?',
    expectedType: 'SUPPORTED',
    validate: (r) => /harsemadi|gede harsemadi|multimedia/i.test(r.answer)
  },
  {
    id: 'U2-T5',
    category: 'continuous_session',
    turnIndex: 5,
    role: 'new_entity_domain_switch',
    entities: ['S1 Teknologi Informasi'],
    fields: ['fokus_belajar'],
    query: 'oke paham. kalau prodi s1 teknologi informasi belajarnya fokus ke apa?',
    expectedType: 'SUPPORTED',
    validate: (r) => /teknologi informasi|kurikulum|jaringan|rekayasa|komputer/i.test(r.answer) && !/harsemadi|multimedia/i.test(r.answer)
  },
  {
    id: 'U2-T6',
    category: 'continuous_session',
    turnIndex: 6,
    role: 'ambiguous_followup',
    entities: ['S1 Teknologi Informasi'],
    fields: ['masa_studi_biaya'],
    query: 'kalau itu berapa lama dan biayanya gimana?',
    expectedType: 'SUPPORTED',
    validate: (r) => /teknologi informasi|biaya|semester|tahun|spp|dpp/i.test(r.answer)
  }
];

async function runUnseen2() {
  console.log('==================================================');
  console.log('RUNNING GENUINELY NEW UNSEEN HOLDOUT #2');
  console.log('==================================================\n');

  const fullDiffBefore = execSync('git diff', { encoding: 'utf8' });
  const hashBefore = crypto.createHash('sha256').update(fullDiffBefore).digest('hex');

  const results = [];
  let rawPass = 0;
  let rawFail = 0;

  // Counts by category
  let supportedCount = 0;
  let trueNoDataCount = 0;
  let ambiguousCount = 0;
  let partialCount = 0;

  // Sub-category passes
  const subCategoryMetrics = {
    multi_entity: { total: 0, pass: 0 },
    multi_field: { total: 0, pass: 0 },
    multi_question: { total: 0, pass: 0 },
    supported_plus_unsupported: { total: 0, pass: 0 },
    partial_evidence: { total: 0, pass: 0 },
    implicit_entity: { total: 0, pass: 0 },
    open_world_entity: { total: 0, pass: 0 },
    context_followup: { total: 0, pass: 0 },
    correction_override: { total: 0, pass: 0 }
  };

  // Run Standalone Cases
  console.log('--- EXECUTING STANDALONE CASES (24 cases) ---');
  for (const tc of STANDALONE_CASES) {
    if (tc.expectedType === 'SUPPORTED') supportedCount++;
    else if (tc.expectedType === 'TRUE_NODATA') trueNoDataCount++;
    else if (tc.expectedType === 'AMBIGUOUS') ambiguousCount++;
    else if (tc.expectedType === 'PARTIAL') partialCount++;

    const startTime = Date.now();
    let res = null;
    let err = null;
    try {
      res = await querySemanticRag(tc.query, {
        topK: 6,
        chatId: 'test_unseen2_' + tc.id
      });
    } catch (e) {
      err = e;
    }
    const duration = Date.now() - startTime;

    const answer = res?.answer || '';
    const source = res?.source || (err ? 'exception' : 'unknown');
    let pass = false;
    if (!err && res) {
      pass = tc.validate(res);
    }

    if (pass) {
      rawPass++;
      console.log(`[PASS] ${tc.id} (${tc.category}): ${duration}ms | route: ${source}`);
    } else {
      rawFail++;
      console.log(`[FAIL] ${tc.id} (${tc.category}): ${duration}ms | route: ${source}`);
      console.log(`       Answer: ${answer.slice(0, 100).replace(/\n/g, ' ')}...`);
    }

    // Subcategory accounting
    if (tc.category === 'multiple_entities' || tc.category === 'comparison_between_entities') {
      subCategoryMetrics.multi_entity.total++;
      if (pass) subCategoryMetrics.multi_entity.pass++;
    }
    if (tc.category === 'explicit_entity_multi_fields' || tc.category === 'multi_entity_multi_field') {
      subCategoryMetrics.multi_field.total++;
      if (pass) subCategoryMetrics.multi_field.pass++;
    }
    if (tc.category === 'multi_question_supported_supported' || tc.category === 'multi_question_supported_unsupported') {
      subCategoryMetrics.multi_question.total++;
      if (pass) subCategoryMetrics.multi_question.pass++;
    }
    if (tc.category === 'multi_question_supported_unsupported') {
      subCategoryMetrics.supported_plus_unsupported.total++;
      if (pass) subCategoryMetrics.supported_plus_unsupported.pass++;
    }
    if (tc.category === 'partial_evidence') {
      subCategoryMetrics.partial_evidence.total++;
      if (pass) subCategoryMetrics.partial_evidence.pass++;
    }
    if (tc.category === 'implicit_entity_description') {
      subCategoryMetrics.implicit_entity.total++;
      if (pass) subCategoryMetrics.implicit_entity.pass++;
    }
    if (tc.category === 'open_world_lowercase') {
      subCategoryMetrics.open_world_entity.total++;
      if (pass) subCategoryMetrics.open_world_entity.pass++;
    }

    results.push({
      id: tc.id,
      query: tc.query,
      expectedType: tc.expectedType,
      entities: tc.entities,
      fields: tc.fields,
      route: source,
      answer,
      pass,
      error: err ? err.message : null
    });
  }

  // Run Continuous Conversation Session
  console.log('\n--- EXECUTING CONTINUOUS CONVERSATION SESSION (6 turns) ---');
  const continuousChatId = 'test_unseen2_continuous_' + Date.now();
  for (const tc of CONTINUOUS_TURNS) {
    if (tc.expectedType === 'SUPPORTED') supportedCount++;
    else if (tc.expectedType === 'TRUE_NODATA') trueNoDataCount++;
    else if (tc.expectedType === 'AMBIGUOUS') ambiguousCount++;
    else if (tc.expectedType === 'PARTIAL') partialCount++;

    const startTime = Date.now();
    let res = null;
    let err = null;
    try {
      res = await querySemanticRag(tc.query, {
        topK: 6,
        chatId: continuousChatId
      });
    } catch (e) {
      err = e;
    }
    const duration = Date.now() - startTime;

    const answer = res?.answer || '';
    const source = res?.source || (err ? 'exception' : 'unknown');
    let pass = false;
    if (!err && res) {
      pass = tc.validate(res);
    }

    if (pass) {
      rawPass++;
      console.log(`[PASS] ${tc.id} (Turn ${tc.turnIndex} - ${tc.role}): ${duration}ms | route: ${source}`);
    } else {
      rawFail++;
      console.log(`[FAIL] ${tc.id} (Turn ${tc.turnIndex} - ${tc.role}): ${duration}ms | route: ${source}`);
      console.log(`       Answer: ${answer.slice(0, 100).replace(/\n/g, ' ')}...`);
    }

    if (tc.role === 'followup_field' || tc.role === 'ambiguous_followup') {
      subCategoryMetrics.context_followup.total++;
      if (pass) subCategoryMetrics.context_followup.pass++;
    }
    if (tc.role === 'explicit_correction') {
      subCategoryMetrics.correction_override.total++;
      if (pass) subCategoryMetrics.correction_override.pass++;
    }

    results.push({
      id: tc.id,
      query: tc.query,
      expectedType: tc.expectedType,
      entities: tc.entities,
      fields: tc.fields,
      route: source,
      answer,
      pass,
      error: err ? err.message : null
    });
  }

  const fullDiffAfter = execSync('git diff', { encoding: 'utf8' });
  const hashAfter = crypto.createHash('sha256').update(fullDiffAfter).digest('hex');

  // Write detailed json artifact
  fs.writeFileSync(
    path.join(__dirname, 'new_unseen_2_results.json'),
    JSON.stringify({ results, subCategoryMetrics, hashBefore, hashAfter }, null, 2),
    'utf8'
  );

  console.log('\n==================================================');
  console.log('SUMMARY REPORT');
  console.log('==================================================');
  console.log(`NEW_UNSEEN_2_TOTAL=${results.length}`);
  console.log(`NEW_UNSEEN_2_RAW_PASS=${rawPass}`);
  console.log(`NEW_UNSEEN_2_RAW_FAIL=${rawFail}`);
  console.log(`NEW_UNSEEN_2_SUPPORTED=${supportedCount}`);
  console.log(`NEW_UNSEEN_2_TRUE_NODATA=${trueNoDataCount}`);
  console.log(`NEW_UNSEEN_2_AMBIGUOUS=${ambiguousCount}`);
  console.log(`NEW_UNSEEN_2_PARTIAL=${partialCount}`);
  console.log(`SOURCE_CHANGED_DURING_UNSEEN_2=${hashBefore === hashAfter ? 'NO' : 'YES'}`);
}

runUnseen2().catch(console.error);
