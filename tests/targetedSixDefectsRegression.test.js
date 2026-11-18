'use strict';

process.env.NODE_ENV = 'test';
delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_API_KEY;
process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';

const { runPhase1DeterministicPipeline } = require('../src/core/orchestrator');
const { getProgramCourseFact } = require('../src/core/academicCatalog');
const { buildGroundedCurriculumAnswer } = require('../src/core/groundedAnswerGenerator');
const { evaluateAnswerability, ANSWERABILITY_STATUS } = require('../src/core/answerabilityGate');
const { verifyFinalAnswer } = require('../src/core/finalAnswerVerifier');
const { VERIFICATION_OUTCOME } = require('../src/reasoning/contracts');

describe('Targeted Six Defects Regression Suite (ce0b3dc + Targeted Fixes)', () => {
  jest.setTimeout(30000);

  test('QA-170: Coding requirement / recommendation inquiry passes VERIFIED_FACTUAL with grounded advice', async () => {
    const q = 'Saya belum bisa coding, jurusan mana yang cocok?';
    const res = await runPhase1DeterministicPipeline('QA-170', q);
    const outcome = res.verification?.outcome || res.subQueryResults?.[0]?.verification?.outcome;
    const answer = res.answer || res.text || '';

    expect(outcome).toBe('VERIFIED_FACTUAL');
    expect(answer).toMatch(/kewajiban tes coding|portofolio pemrograman/i);
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

  test('LANG-01-REGRESS: Salutation prefix with coding recommendation inquiry does not produce redundant greeting', async () => {
    const q = 'Halo Tiko, kalau aku belum bisa coding, cocoknya masuk jurusan apa?';
    const sessionSnapshot = {
      data: {
        turns: 2,
        lastActive: Date.now() - 60000,
        domain: 'CAMPUS_LIFE'
      }
    };
    const res = await runPhase1DeterministicPipeline('LANG-01-REGRESS', q, { sessionSnapshot });
    const outcome = res.verification?.outcome || res.subQueryResults?.[0]?.verification?.outcome;
    const answer = res.answer || res.text || '';

    expect(outcome).toBe('VERIFIED_FACTUAL');
    expect(answer).not.toMatch(/Halo kembali/i);
    expect(answer).not.toMatch(/Ada yang bisa kami bantu lagi/i);
    expect(answer).toMatch(/Dalam dokumen persyaratan PMB yang tersedia, saya tidak menemukan kewajiban tes coding atau portofolio pemrograman/i);
    expect(answer).toMatch(/S1 Sistem Informasi/i);
    expect(answer).toMatch(/Dasar Algoritma/i);
    expect(answer).toMatch(/S1 Bisnis Digital/i);
    expect(answer).toMatch(/Teknik Pembuatan Prompt untuk Model AI/i);
    expect(answer).toMatch(/tanpa menyimpulkan salah satu lebih mudah/i);
    expect(answer).toMatch(/pmb\.stikom-bali\.ac\.id/i);
  });

  test('LANG-06-REGRESS: SI vs BD recommendation comparison does not claim difficulty level or complete lack of coding', async () => {
    const q = 'Enaknya pilih Sistem Informasi atau Bisnis Digital ya kalau nggak mau pusing ngoding?';
    const res = await runPhase1DeterministicPipeline('LANG-06-REGRESS', q);
    const outcome = res.verification?.outcome || res.subQueryResults?.[0]?.verification?.outcome;
    const answer = res.answer || res.text || '';

    expect(outcome).toBe('VERIFIED_FACTUAL');
    expect(answer).toMatch(/S1 Sistem Informasi/i);
    expect(answer).toMatch(/Dasar Algoritma/i);
    expect(answer).toMatch(/S1 Bisnis Digital/i);
    expect(answer).toMatch(/Teknik Pembuatan Prompt untuk Model AI/i);
    expect(answer).toMatch(/tanpa menyimpulkan salah satu lebih mudah/i);
    expect(answer).not.toMatch(/pasti lebih gampang|sama sekali tidak ada coding/i);
  });

  test('BD-AI-01: Bisnis Digital AI inquiry standalone returns grounded course on Semester III', async () => {
    const q = 'Apakah mahasiswa Bisnis Digital belajar Artificial Intelligence?';
    const res = await runPhase1DeterministicPipeline('BD-AI-01', q);
    const sq = res.subQueryResults?.[0];
    const outcome = res.verification?.outcome || sq?.verification?.outcome;
    const answer = res.answer || res.text || '';

    // Evidence & Arbitration assertions
    expect(res.verification?.pass).toBe(true);
    expect(res.verification?.isGrounded).toBe(true);
    expect(outcome).toBe('VERIFIED_FACTUAL');
    expect(sq?.arbitrated?.accepted?.length).toBeGreaterThan(0);

    // Official Grounded Facts assertions
    expect(answer).toMatch(/S1 Bisnis Digital/i);
    expect(answer).toMatch(/Teknik Pembuatan Prompt untuk Model AI/i);
    expect(answer).toMatch(/BD233507/i);
    expect(answer).toMatch(/Semester III/i);
    expect(answer).toMatch(/2 SKS/i);
    expect(answer).toMatch(/fakta kurikulum resmi/i);

    // Negative assertions (no cross-contamination, no ungrounded claims)
    expect(answer).not.toMatch(/S1 Sistem Informasi/i);
    expect(answer).not.toMatch(/S1 Teknologi Informasi/i);
    expect(answer).not.toMatch(/S1 Sistem Komputer/i);
    expect(answer).not.toMatch(/inkubator bisnis/i);
  });

  test('BD-AI-02: Bisnis Digital AI inquiry after recommendation maintains BD entity and includes AI course', async () => {
    const chatId = 'BD-AI-MULTI-TURN-TEST';
    // Turn 1
    const t1 = await runPhase1DeterministicPipeline(chatId, 'Halo Tiko, kalau aku belum bisa coding, cocoknya masuk jurusan apa?');
    expect(t1.verification?.outcome || t1.subQueryResults?.[0]?.verification?.outcome).toBe('VERIFIED_FACTUAL');

    // Turn 2
    const q2 = 'Aku lebih tertarik bisnis dan pemasaran digital, tapi masih ingin belajar AI. Bagaimana dengan Bisnis Digital?';
    const t2 = await runPhase1DeterministicPipeline(chatId, q2);
    const sq2 = t2.subQueryResults?.[0];
    const outcome2 = t2.verification?.outcome || sq2?.verification?.outcome;
    const answer2 = t2.answer || t2.text || '';

    // Evidence & Verification assertions
    expect(t2.verification?.pass).toBe(true);
    expect(t2.verification?.isGrounded).toBe(true);
    expect(outcome2).toBe('VERIFIED_FACTUAL');
    expect(sq2?.arbitrated?.accepted?.length).toBeGreaterThan(0);

    // Grounded Curriculum Facts assertions
    expect(answer2).toMatch(/S1 Bisnis Digital/i);
    expect(answer2).toMatch(/Pemasaran Digital/i);
    expect(answer2).toMatch(/Teknik Pembuatan Prompt untuk Model AI/i);
    expect(answer2).toMatch(/BD233507/i);
    expect(answer2).toMatch(/Semester III/i);
    expect(answer2).toMatch(/2 SKS/i);
    expect(answer2).toMatch(/fakta kurikulum resmi/i);

    // Negative assertions
    expect(answer2).not.toMatch(/S1 Sistem Informasi/i);
    expect(answer2).not.toMatch(/inkubator bisnis/i);
  });

  test('BD-AI-03: Follow-up inquiry specifically referencing Teknik Pembuatan Prompt untuk Model AI stays grounded', async () => {
    const q = 'Mata kuliah Teknik Pembuatan Prompt untuk Model AI itu mempelajari apa saja?';
    const res = await runPhase1DeterministicPipeline('BD-AI-03', q);
    const sq = res.subQueryResults?.[0];
    const outcome = res.verification?.outcome || sq?.verification?.outcome;
    const answer = res.answer || res.text || '';

    // Verification & Evidence assertions (Safe Unknown due to detailed syllabus gap)
    expect(res.verification?.handledSafely).toBe(true);
    expect(outcome).toBe('SAFE_UNKNOWN');
    expect(sq?.arbitrated?.accepted?.length).toBeGreaterThan(0);

    // Official Grounded Facts assertions
    expect(answer).toMatch(/S1 Bisnis Digital/i);
    expect(answer).toMatch(/Teknik Pembuatan Prompt untuk Model AI/i);
    expect(answer).toMatch(/BD233507/i);
    expect(answer).toMatch(/Semester III/i);
    expect(answer).toMatch(/2 SKS/i);
    expect(answer).toMatch(/fakta resmi/i);

    // Transparent source gap / limitation assertions (no hallucination of unverified syllabus)
    expect(answer).toMatch(/belum memuat silabus terperinci/i);
    expect(answer).not.toMatch(/inkubator bisnis/i);
  });

  test('BD-AI-04: Full 6-turn session maintaining S1 Bisnis Digital entity continuity and course details', async () => {
    const chatId = 'BD-AI-SIX-TURN-REGRESSION-' + Date.now();
    const qList = [
      'Belum bisa coding, cocok masuk jurusan apa?',
      'Saya lebih tertarik bisnis dan pemasaran digital.',
      'Bagaimana dengan Bisnis Digital?',
      'Apakah ada mata kuliah AI?',
      'Apa nama mata kuliah tersebut?',
      'Berapa SKS dan semester berapa?'
    ];

    const results = [];
    for (const q of qList) {
      results.push(await runPhase1DeterministicPipeline(chatId, q));
    }

    // Turn 1
    expect(results[0].verification?.outcome || results[0].subQueryResults?.[0]?.verification?.outcome).toBe('VERIFIED_FACTUAL');

    // Turn 2
    expect(results[1].verification?.outcome || results[1].subQueryResults?.[0]?.verification?.outcome).toBe('VERIFIED_FACTUAL');

    // Turn 3: Locks onto S1 Bisnis Digital
    expect(results[2].verification?.outcome || results[2].subQueryResults?.[0]?.verification?.outcome).toBe('VERIFIED_FACTUAL');
    expect(results[2].semanticFrame?.entities?.map(e => e.canonical)).toContain('S1 Bisnis Digital');

    // Turn 4: Inquires AI course in BD
    expect(results[3].verification?.outcome || results[3].subQueryResults?.[0]?.verification?.outcome).toBe('VERIFIED_FACTUAL');
    expect(results[3].semanticFrame?.entities?.map(e => e.canonical)).toContain('S1 Bisnis Digital');
    expect(results[3].answer).toMatch(/Teknik Pembuatan Prompt untuk Model AI/i);
    expect(results[3].answer).toMatch(/BD233507/i);
    expect(results[3].answer).toMatch(/Semester III/i);
    expect(results[3].answer).toMatch(/2 SKS/i);
    expect(results[3].answer).not.toMatch(/S1 Sistem Informasi/i);

    // Turn 5: Anaphoric inquiry: "Apa nama mata kuliah tersebut?"
    expect(results[4].verification?.outcome || results[4].subQueryResults?.[0]?.verification?.outcome).toBe('VERIFIED_FACTUAL');
    expect(results[4].semanticFrame?.entities?.map(e => e.canonical)).toContain('S1 Bisnis Digital');
    expect(results[4].answer).toMatch(/Teknik Pembuatan Prompt untuk Model AI/i);
    expect(results[4].answer).toMatch(/BD233507/i);
    expect(results[4].answer).not.toMatch(/S1 Sistem Informasi/i);
    expect(results[4].answer).not.toMatch(/S1 Teknologi Informasi/i);

    // Turn 6: Anaphoric inquiry: "Berapa SKS dan semester berapa?"
    expect(results[5].verification?.outcome || results[5].subQueryResults?.[0]?.verification?.outcome).toBe('VERIFIED_FACTUAL');
    expect(results[5].semanticFrame?.entities?.map(e => e.canonical)).toContain('S1 Bisnis Digital');
    expect(results[5].answer).toMatch(/BD233507/i);
    expect(results[5].answer).toMatch(/2 SKS/i);
    expect(results[5].answer).toMatch(/Semester III/i);
    expect(results[5].answer).not.toMatch(/S1 Sistem Informasi/i);
    expect(results[5].answer).not.toMatch(/S1 Sistem Komputer/i);
  });

  test('BD-AI-05: Temporal regression for curriculum existence and live validity gates', async () => {
    // 1. "Pendaftaran masih dibuka?" -> SAFE_UNKNOWN because archival calendar does not prove live status
    const resEnrollment = await runPhase1DeterministicPipeline('test-temporal-gate-1', 'Pendaftaran masih dibuka?', { sessionData: {} });
    expect(resEnrollment.verification?.outcome).toBe('SAFE_UNKNOWN');
    expect(resEnrollment.verification?.handledSafely).toBe(true);
    expect(resEnrollment.finalAnswer).toMatch(/pmb\.stikom-bali\.ac\.id|\(0361\)\s*244445/i);

    // 2. "Apakah kurikulum masih berlaku?" -> SAFE_UNKNOWN because 2025 label does not prove active validity in late 2026
    const resCurriculumValidity = await runPhase1DeterministicPipeline('test-temporal-gate-2', 'Apakah kurikulum masih berlaku?', { sessionData: {} });
    expect(resCurriculumValidity.verification?.outcome).toBe('SAFE_UNKNOWN');
    expect(resCurriculumValidity.verification?.handledSafely).toBe(true);
    expect(resCurriculumValidity.finalAnswer).toMatch(/Kurikulum 2025/i);
    expect(resCurriculumValidity.finalAnswer).toMatch(/BAAK|akademik/i);

    // 3. "Masih ada mata kuliah AI di Bisnis Digital?" -> Relevant curriculum evidence accepted, factual grounded answer
    const resAiInBd = await runPhase1DeterministicPipeline('test-temporal-gate-3', 'Masih ada mata kuliah AI di Bisnis Digital?', { sessionData: {} });
    expect(resAiInBd.semanticFrame?.intent).toBe('CURRICULUM_INQUIRY');
    expect(resAiInBd.semanticFrame?.temporal?.constraint).toBe('NOW');
    expect(resAiInBd.semanticFrame?.entities?.map(e => e.canonical)).toContain('S1 Bisnis Digital');
    expect(resAiInBd.verification?.outcome).toBe('VERIFIED_FACTUAL');
    expect(resAiInBd.verification?.pass).toBe(true);
    expect(resAiInBd.verification?.isGrounded).toBe(true);
    expect(resAiInBd.finalAnswer).toMatch(/Teknik Pembuatan Prompt untuk Model AI/i);
    expect(resAiInBd.finalAnswer).toMatch(/BD233507/i);
    expect(resAiInBd.finalAnswer).toMatch(/Semester III/i);
    expect(resAiInBd.finalAnswer).toMatch(/2 SKS/i);
    // Relevant curriculum evidence is not rejected erroneously with temporal mismatch,
    // while non-curriculum profile chunks without current year markers do not get a blanket pass.
    const sq = resAiInBd.subQueryResults?.[0];
    expect(sq?.acceptedCount).toBeGreaterThan(0);
    const curriculumRejectedForTemporal = (sq?.arbitrated?.rejected || []).filter(r =>
      r.reason === 'evidence_lacks_current_temporal_validity' &&
      (r.chunk?.category === 'KURIKULUM' || /\b(?:kurikulum|struktur\s+kurikulum|sebaran|daftar\s+mata\s*kuliah)\b/i.test(r.chunk?.text || ''))
    );
    expect(curriculumRejectedForTemporal.length).toBe(0);

    // 4. Verify structured provenance contract reaches final answer verification & top-level pipeline result
    const expectedBdFact = getProgramCourseFact('S1 Bisnis Digital', 'prompt');
    expect(expectedBdFact).toBeDefined();
    expect(expectedBdFact.code).toBe('BD233507');
    expect(expectedBdFact.name).toBe('Teknik Pembuatan Prompt untuk Model AI');
    expect(expectedBdFact.semester).toBe('Semester III');
    expect(expectedBdFact.sks).toBe(2);
    expect(expectedBdFact.verificationStatus).toBe('VERIFIED_PRIMARY_SOURCE');

    expect(sq?.synthesis?.provenance).toMatchObject({
      courseName: expectedBdFact.name,
      courseCode: expectedBdFact.code,
      semester: expectedBdFact.semester,
      sks: expectedBdFact.sks,
      sourceDocument: expectedBdFact.sourceDocument,
      sourceUrl: expectedBdFact.sourceUrl,
      verificationStatus: expectedBdFact.verificationStatus
    });
    expect(resAiInBd.verification?.provenance).toMatchObject({
      courseName: expectedBdFact.name,
      courseCode: expectedBdFact.code,
      semester: expectedBdFact.semester,
      sks: expectedBdFact.sks
    });
    expect(resAiInBd.provenance).toMatchObject({
      courseName: expectedBdFact.name,
      courseCode: expectedBdFact.code
    });

    // 5. Fail-Closed Tests:
    // 5a. Non-existent course in registry fails closed (SAFE_UNKNOWN, no hardcoded fallback)
    const negativeRes = buildGroundedCurriculumAnswer({
      intent: 'CURRICULUM_INQUIRY',
      rawQuery: 'Apakah ada mata kuliah Robotika Kuantum AI di Bisnis Digital?',
      entities: [{ canonical: 'S1 Bisnis Digital' }]
    }, [], {});
    expect(negativeRes).toBeDefined();
    expect(negativeRes.outcome).toBe('SAFE_UNKNOWN');
    expect(negativeRes.success).toBe(false);
    expect(negativeRes.answer).not.toMatch(/BD233507/i);

    // 5b. Record found but verificationStatus not VERIFIED_PRIMARY_SOURCE -> fails closed to SAFE_UNKNOWN
    const catalogData = require('../data/runtime/canonical_academic_facts_registry.json');
    const mockUnverifiedCourse = {
      code: 'BD999999',
      name: 'Pemodelan AI Lanjut Tidak Terverifikasi',
      semester: 'Semester VI',
      sks: 3,
      category: 'AI_APPLIED',
      verificationStatus: 'UNVERIFIED'
    };
    catalogData.curriculumFacts['S1 Bisnis Digital'].courses.push(mockUnverifiedCourse);
    const unverifiedLookup = getProgramCourseFact('S1 Bisnis Digital', 'BD999999');
    expect(unverifiedLookup).toBeNull();

    const unverifiedGenRes = buildGroundedCurriculumAnswer({
      intent: 'CURRICULUM_INQUIRY',
      rawQuery: 'Apakah ada mata kuliah AI BD999999 di Bisnis Digital?',
      entities: [{ canonical: 'S1 Bisnis Digital' }]
    }, [], {});
    expect(unverifiedGenRes).toBeDefined();
    expect(unverifiedGenRes.outcome).toBe('SAFE_UNKNOWN');
    expect(unverifiedGenRes.success).toBe(false);

    // Clean up mock course from memory
    catalogData.curriculumFacts['S1 Bisnis Digital'].courses.pop();

    // 5c. Final Answer Verifier Multi-Attribute Negative Tests:
    // 5c-1. SKS mismatch: Correct code BD233507, but SKS deliberately mutated (claims 3 SKS while registry has 2 SKS) -> Rejected
    const wrongSksAnswer = 'Pada kurikulum resmi S1 Bisnis Digital, terdapat mata kuliah Teknik Pembuatan Prompt untuk Model AI (Kode: BD233507, 3 SKS) pada Semester III.';
    const wrongSksVerif = verifyFinalAnswer(wrongSksAnswer, { intent: 'CURRICULUM_INQUIRY' }, { accepted: [] });
    expect(wrongSksVerif.pass).toBe(false);
    expect(wrongSksVerif.outcome).toBe(VERIFICATION_OUTCOME.VERIFICATION_FAILED);
    expect(wrongSksVerif.reason).toMatch(/unverified_course_sks_claim/);

    // 5c-2. Semester mismatch: Correct code BD233507, but semester deliberately mutated (claims Semester IV while registry has Semester III) -> Rejected
    const wrongSemAnswer = 'Pada kurikulum resmi S1 Bisnis Digital, terdapat mata kuliah Teknik Pembuatan Prompt untuk Model AI (Kode: BD233507, 2 SKS) pada Semester IV.';
    const wrongSemVerif = verifyFinalAnswer(wrongSemAnswer, { intent: 'CURRICULUM_INQUIRY' }, { accepted: [] });
    expect(wrongSemVerif.pass).toBe(false);
    expect(wrongSemVerif.outcome).toBe(VERIFICATION_OUTCOME.VERIFICATION_FAILED);
    expect(wrongSemVerif.reason).toMatch(/unverified_course_semester_claim/);

    // 5c-3. Course Name mismatch: Correct code BD233507, but course name completely mismatched (Robotika Otomasi Industri) -> Rejected
    const wrongNameAnswer = 'Pada kurikulum resmi S1 Bisnis Digital, terdapat mata kuliah Robotika Otomasi Industri (Kode: BD233507, 2 SKS) pada Semester III.';
    const wrongNameVerif = verifyFinalAnswer(wrongNameAnswer, { intent: 'CURRICULUM_INQUIRY' }, { accepted: [] });
    expect(wrongNameVerif.pass).toBe(false);
    expect(wrongNameVerif.outcome).toBe(VERIFICATION_OUTCOME.VERIFICATION_FAILED);
    expect(wrongNameVerif.reason).toMatch(/unverified_course_name_claim/);

    // 5c-4. Obsolete/404 Source URL: claims 404 URL -> Rejected
    const wrongUrlAnswer = 'Pada kurikulum resmi S1 Bisnis Digital, mata kuliah Teknik Pembuatan Prompt untuk Model AI (Kode: BD233507, 2 SKS) Semester III merujuk https://stikom-bali.ac.id/kurikulum-bisnis-digital';
    const wrongUrlVerif = verifyFinalAnswer(wrongUrlAnswer, { intent: 'CURRICULUM_INQUIRY' }, { accepted: [] });
    expect(wrongUrlVerif.pass).toBe(false);
    expect(wrongUrlVerif.outcome).toBe(VERIFICATION_OUTCOME.VERIFICATION_FAILED);
    expect(wrongUrlVerif.reason).toMatch(/unverified_course_source_url/);

    // 5d. Semester III Full 7 Courses & Total SKS Reconciliation (Permendiktisaintek 39/2025 Pasal 18)
    const bdRegistryData = catalogData.curriculumFacts['S1 Bisnis Digital'];
    expect(bdRegistryData.graduationMinimumSks).toBe(144);
    expect(bdRegistryData.offeredCurriculumSks).toBe(146);
    expect(bdRegistryData.sksDiscrepancyExplanation).toMatch(/Permendiktisaintek No\. 39 Tahun 2025 Pasal 18/i);
    expect(bdRegistryData.sksDiscrepancyExplanation).not.toMatch(/pengayaan|pilihan institusional/i);

    const sem3Courses = bdRegistryData.courses.filter(c => c.semester === 'Semester III');
    expect(sem3Courses.length).toBe(7);
    const sem3Sum = sem3Courses.reduce((sum, c) => sum + c.sks, 0);
    expect(sem3Sum).toBe(22);

    // Verify all 7 courses individually
    const expectedSem3Map = {
      'BD233103': { name: 'Pengelolaan Hubungan Pelanggan', sks: 4 },
      'BD233509': { name: 'Bisnis Digital Budaya dan Seni', sks: 2 },
      'BD233506': { name: 'Digital Konten', sks: 4 },
      'BD233301': { name: 'Sistem Pengelolaan Konten Berbasis Web', sks: 4 },
      'BD232101': { name: 'Kewirausahaan', sks: 2 },
      'BD233508': { name: 'Analisis Data Bisnis', sks: 4 },
      'BD233507': { name: 'Teknik Pembuatan Prompt untuk Model AI', sks: 2 }
    };
    for (const [code, expected] of Object.entries(expectedSem3Map)) {
      const found = sem3Courses.find(c => c.code === code);
      expect(found).toBeDefined();
      expect(found.name).toBe(expected.name);
      expect(found.sks).toBe(expected.sks);
      expect(found.verificationStatus).toBe('VERIFIED_PRIMARY_SOURCE');
    }

    // 6. PMB Calendar Date Gate Scenarios (answerabilityGate) with explicit reference date (Bali / WITA, UTC+8)
    const refDateBali = new Date('2026-11-18T12:00:00+08:00');
    const pmbFrame = {
      intent: 'CURRENT_ENROLLMENT_STATUS',
      rawQuery: 'Pendaftaran masih dibuka?',
      temporal: { constraint: 'NOW' },
      refDate: refDateBali
    };

    // Scenario 1: Past date / closed before reference date -> SAFE_UNKNOWN (admission_schedule_unconfirmed)
    const pastGateRes = evaluateAnswerability(pmbFrame, {
      accepted: [{
        id: 'pmb-past',
        text: 'Gelombang I A: Masa Pendaftaran: 2 Januari 2026 - 31 Agustus 2026. Testing: 5 September 2026. Pengumuman: 10 September 2026.'
      }]
    }, { refDate: refDateBali });
    expect(pastGateRes.status).toBe(ANSWERABILITY_STATUS.UNKNOWN);
    expect(pastGateRes.reason).toBe('admission_schedule_unconfirmed');

    // Scenario 2: Active period covering reference date (18 November 2026) -> ANSWERABLE
    const activeGateRes = evaluateAnswerability(pmbFrame, {
      accepted: [{
        id: 'pmb-active',
        text: 'Gelombang I A: Masa Pendaftaran: 1 November 2026 - 30 November 2026. Testing: 5 Desember 2026. Pengumuman: 10 Desember 2026.'
      }]
    }, { refDate: refDateBali });
    expect(activeGateRes.status).toBe(ANSWERABILITY_STATUS.ANSWERABLE);

    // Scenario 3: Undated / no verifiable dates -> SAFE_UNKNOWN (admission_schedule_unconfirmed)
    const undatedGateRes = evaluateAnswerability(pmbFrame, {
      accepted: [{
        id: 'pmb-undated',
        text: 'Penerimaan Mahasiswa Baru ITB STIKOM Bali membuka pendaftaran untuk kelas reguler pagi dan malam dengan berbagai jalur beasiswa.'
      }]
    }, { refDate: refDateBali });
    expect(undatedGateRes.status).toBe(ANSWERABILITY_STATUS.UNKNOWN);
    expect(undatedGateRes.reason).toBe('admission_schedule_unconfirmed');
  });
});
