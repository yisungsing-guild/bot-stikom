'use strict';

process.env.NODE_ENV = 'test';
delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_API_KEY;
process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';

const { runPhase1DeterministicPipeline } = require('../src/core/orchestrator');

describe('Targeted Six Defects Regression Suite (ce0b3dc + Targeted Fixes)', () => {
  jest.setTimeout(30000);

  test('QA-170: Coding requirement / recommendation inquiry passes VERIFIED_FACTUAL with grounded advice', async () => {
    const q = 'Saya belum bisa coding, jurusan mana yang cocok?';
    const res = await runPhase1DeterministicPipeline('QA-170', q);
    const outcome = res.verification?.outcome || res.subQueryResults?.[0]?.verification?.outcome;
    const answer = res.answer || res.text || '';

    expect(outcome).toBe('VERIFIED_FACTUAL');
    expect(answer).toMatch(/belum bisa coding/i);
    expect(answer).toMatch(/S1 Bisnis Digital/i);
    expect(answer).toMatch(/S1 Sistem Informasi/i);
    expect(answer).toMatch(/pmb\.stikom-bali\.ac\.id/i);
    expect(answer).not.toMatch(/outbound_sanitizer_non_idempotent/i);
  });

  test('QA-193: Full curriculum range for S1 Sistem Komputer returns Semester I through Semester VIII with SKS', async () => {
    const q = 'Sebutkan mata kuliah S1 Sistem Komputer semester 1 sampai 8 beserta SKS';
    const res = await runPhase1DeterministicPipeline('QA-193', q);
    const outcome = res.verification?.outcome || res.subQueryResults?.[0]?.verification?.outcome;
    const answer = res.answer || res.text || '';

    expect(outcome).toBe('VERIFIED_FACTUAL');
    expect(answer).toMatch(/Semester I/i);
    expect(answer).toMatch(/Semester II/i);
    expect(answer).toMatch(/Semester III/i);
    expect(answer).toMatch(/Semester IV/i);
    expect(answer).toMatch(/Semester V/i);
    expect(answer).toMatch(/Semester VI/i);
    expect(answer).toMatch(/Semester VII/i);
    expect(answer).toMatch(/Semester VIII/i);
    expect(answer).toMatch(/144\s*SKS/i);
  });

  test('QA-208: Bisnis Digital AI inquiry does not cross-contaminate with S1 Sistem Informasi and passes VERIFIED_FACTUAL', async () => {
    const q = 'Apakah mahasiswa Bisnis Digital belajar Artificial Intelligence?';
    const res = await runPhase1DeterministicPipeline('QA-208', q);
    const outcome = res.verification?.outcome || res.subQueryResults?.[0]?.verification?.outcome;
    const answer = res.answer || res.text || '';

    expect(outcome).toBe('VERIFIED_FACTUAL');
    expect(answer).toMatch(/Teknik Pembuatan Prompt untuk Model AI/i);
    expect(answer).toMatch(/S1 Bisnis Digital/i);
    expect(answer).not.toMatch(/S1 Sistem Informasi/i);
  });

  test('QA-221: Bisnis Digital AI variant query passes VERIFIED_FACTUAL without sibling contamination', async () => {
    const q = 'Apakah mahasiswa Bisnis Digital belajar Artificial Intelligence (AI)?';
    const res = await runPhase1DeterministicPipeline('QA-221', q);
    const outcome = res.verification?.outcome || res.subQueryResults?.[0]?.verification?.outcome;
    const answer = res.answer || res.text || '';

    expect(outcome).toBe('VERIFIED_FACTUAL');
    expect(answer).toMatch(/Teknik Pembuatan Prompt untuk Model AI/i);
    expect(answer).not.toMatch(/S1 Sistem Informasi/i);
  });

  test('SUPP-08 & QA-390: S2 Sistem Informasi delivery mode (online/offline) returns SAFE_UNKNOWN without deflecting to tuition fee', async () => {
    const q = 'Apakah perkuliahan S2 Sistem Informasi dilaksanakan online atau offline?';
    const res = await runPhase1DeterministicPipeline('QA-390', q);
    const outcome = res.verification?.outcome || res.subQueryResults?.[0]?.verification?.outcome;
    const answer = res.answer || res.text || '';

    expect(outcome).toBe('SAFE_UNKNOWN');
    expect(answer).toMatch(/Reguler/i);
    expect(answer).toMatch(/SOURCE_GAP|belum tercantum/i);
    expect(answer).toMatch(/0822-7738-9999/i);
    expect(answer).not.toMatch(/Rp700\.000/i);
    expect(answer).not.toMatch(/biaya pendaftaran/i);
  });

  test('QA-404: Semester 5 for S1 Sistem Informasi remains PASS with exactly 8 courses and 20 SKS', async () => {
    const sess = {
      activeEntity: 'S1 Sistem Informasi',
      activeDomain: 'ACADEMIC_PROGRAM',
      activeIntent: 'PROGRAM_INFO',
      lastAcademicProgramEntity: 'S1 Sistem Informasi',
      lastTurnTs: Date.now()
    };
    const res = await runPhase1DeterministicPipeline('QA-404', 'Kalau semester 5 bagaimana?', {
      sessionSnapshot: { data: sess }
    });
    const outcome = res.verification?.outcome || res.subQueryResults?.[0]?.verification?.outcome;
    const answer = res.answer || res.text || '';

    expect(outcome).toBe('VERIFIED_FACTUAL');
    expect(answer).toMatch(/Tata Kelola Teknologi Informasi/i);
    expect(answer).toMatch(/Seni Presentasi Berbasis Data/i);
    expect(answer).toMatch(/Pengelolaan Sumber Daya Perusahaan dan Hubungan Pelanggan/i);
    expect(answer).toMatch(/Sistem Informasi Manajemen/i);
    expect(answer).toMatch(/Bahasa Asing Dunia Kerja/i);
    expect(answer).toMatch(/Pengalaman Industri/i);
    expect(answer).toMatch(/Penulisan di Dunia Profesional/i);
    expect(answer).toMatch(/Kesehatan, Keselamatan Kerja, dan Lingkungan Hidup/i);
  });

  test('QA-324: Parking fee inquiry remains SAFE_UNKNOWN', async () => {
    const q = 'Berapa biaya parkir mobil per tahun untuk mahasiswa?';
    const res = await runPhase1DeterministicPipeline('QA-324', q);
    const outcome = res.verification?.outcome || res.subQueryResults?.[0]?.verification?.outcome;
    const answer = res.answer || res.text || '';

    expect(outcome).toBe('SAFE_UNKNOWN');
    expect(answer).toMatch(/tarif parkir|belum tercantum/i);
  });

  test('QA-372: Leave of absence (cuti kuliah) procedure inquiry remains SAFE_UNKNOWN when official SOP unrecorded', async () => {
    const q = 'Bagaimana prosedur cuti kuliah?';
    const res = await runPhase1DeterministicPipeline('QA-372', q);
    const outcome = res.verification?.outcome || res.subQueryResults?.[0]?.verification?.outcome;
    const answer = res.answer || res.text || '';

    expect(outcome).toBe('SAFE_UNKNOWN');
    expect(answer).toMatch(/belum tercantum|panduan yang tersedia/i);
  });
});
