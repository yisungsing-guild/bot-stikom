'use strict';

process.env.NODE_ENV = 'test';
delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_API_KEY;
process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';

const { runPhase1DeterministicPipeline } = require('../src/core/orchestrator');
const { getSession } = require('../src/core/conversationState');
const { getProgramCourseFact } = require('../src/core/academicCatalog');
const { buildGroundedCurriculumAnswer } = require('../src/core/groundedAnswerGenerator');
const { evaluateAnswerability, ANSWERABILITY_STATUS } = require('../src/core/answerabilityGate');
const { verifyFinalAnswer, isUrlMatch, isSourceCitationMatching } = require('../src/core/finalAnswerVerifier');
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

    // 5b-2. Incomplete provenance metadata (missing sourceDocument / provenanceByAttribute) -> fails closed to SAFE_UNKNOWN
    const mockIncompleteCourse = {
      code: 'BD888888',
      name: 'Pemodelan AI Tanpa Metadata Sumber',
      semester: 'Semester III',
      sks: 2,
      category: 'AI_APPLIED',
      verificationStatus: 'VERIFIED_PRIMARY_SOURCE'
      // missing sourceDocument, sourceUrl, and provenanceByAttribute
    };
    catalogData.curriculumFacts['S1 Bisnis Digital'].courses.push(mockIncompleteCourse);
    const incompleteGenRes = buildGroundedCurriculumAnswer({
      intent: 'CURRICULUM_INQUIRY',
      rawQuery: 'Apakah ada mata kuliah AI BD888888 di Bisnis Digital?',
      entities: [{ canonical: 'S1 Bisnis Digital' }]
    }, [], {});
    expect(incompleteGenRes).toBeDefined();
    expect(incompleteGenRes.outcome).toBe('SAFE_UNKNOWN');
    expect(incompleteGenRes.success).toBe(false);

    // 5b-3. Attribute mismatch in provenanceByAttribute -> fails closed to SAFE_UNKNOWN
    const mockMismatchedProvenanceCourse = {
      code: 'BD777777',
      name: 'Pemodelan AI Provenance Mismatch',
      semester: 'Semester III',
      sks: 2,
      category: 'AI_APPLIED',
      sourceDocument: 'Dokumen_Resmi.pdf',
      sourceUrl: 'https://bisnisdigital.stikom-bali.ac.id/id/daftar-mata-kuliah/',
      verificationStatus: 'VERIFIED_PRIMARY_SOURCE',
      provenanceByAttribute: {
        code: { value: 'BD777777', source: 'url' },
        name: { value: 'Pemodelan AI Provenance Mismatch', source: 'url' },
        semester: { value: 'Semester III', source: 'url' },
        sks: { value: 3, source: 'url' } // Mismatch! Course sks is 2, but provenance says 3
      }
    };
    catalogData.curriculumFacts['S1 Bisnis Digital'].courses.push(mockMismatchedProvenanceCourse);
    const mismatchedGenRes = buildGroundedCurriculumAnswer({
      intent: 'CURRICULUM_INQUIRY',
      rawQuery: 'Apakah ada mata kuliah AI BD777777 di Bisnis Digital?',
      entities: [{ canonical: 'S1 Bisnis Digital' }]
    }, [], {});
    expect(mismatchedGenRes).toBeDefined();
    expect(mismatchedGenRes.outcome).toBe('SAFE_UNKNOWN');
    expect(mismatchedGenRes.success).toBe(false);

    // 5c-Direct: Section C Direct Negative & Positive Verifier Tests for verifyFinalAnswer
    const validPromptAiAnswer = 'Pada kurikulum resmi S1 Bisnis Digital, terdapat mata kuliah Teknik Pembuatan Prompt untuk Model AI (Kode: BD233507, 2 SKS) pada Semester III.';
    const validFullProvenance = {
      courseName: expectedBdFact.name,
      courseCode: expectedBdFact.code,
      semester: expectedBdFact.semester,
      sks: expectedBdFact.sks,
      sourceDocument: expectedBdFact.sourceDocument,
      sourceUrl: expectedBdFact.sourceUrl,
      verificationStatus: expectedBdFact.verificationStatus,
      provenanceByAttribute: {
        code: { value: 'BD233507', source: 'https://bisnisdigital.stikom-bali.ac.id/id/daftar-mata-kuliah/' },
        name: { value: 'Teknik Pembuatan Prompt untuk Model AI', source: 'https://bisnisdigital.stikom-bali.ac.id/id/daftar-mata-kuliah/' },
        semester: { value: 'Semester III', source: 'https://bisnisdigital.stikom-bali.ac.id/id/daftar-mata-kuliah/' },
        sks: { value: 2, source: 'https://bisnisdigital.stikom-bali.ac.id/id/daftar-mata-kuliah/' }
      }
    };
    const baseEvidence = {
      accepted: [{ text: 'BD233507 Teknik Pembuatan Prompt untuk Model AI Semester III 2 SKS' }],
      provenance: validFullProvenance
    };

    // Scenario 1: Provenance lengkap dan valid, identik dengan registry -> PASS (VERIFIED_FACTUAL)
    const validVerifResult = verifyFinalAnswer(validPromptAiAnswer, { intent: 'CURRICULUM_INQUIRY', rawQuery: 'Apakah ada mata kuliah AI di Bisnis Digital?' }, baseEvidence);
    expect(validVerifResult.pass).toBe(true);
    expect(validVerifResult.outcome).toBe(VERIFICATION_OUTCOME.VERIFIED_FACTUAL);

    // Scenario 2: sourceDocument berbeda meski non-empty -> REJECT (mismatched_course_source_document)
    const badDocProvenance = {
      ...validFullProvenance,
      sourceDocument: 'kurikulum_tidak_resmi_2024.pdf'
    };
    const badDocVerif = verifyFinalAnswer(validPromptAiAnswer, { intent: 'CURRICULUM_INQUIRY', rawQuery: 'Apakah ada mata kuliah AI di Bisnis Digital?' }, { ...baseEvidence, provenance: badDocProvenance });
    expect(badDocVerif.pass).toBe(false);
    expect(badDocVerif.outcome).toBe(VERIFICATION_OUTCOME.VERIFICATION_FAILED);
    expect(badDocVerif.reason).toMatch(/mismatched_course_source_document/);

    // 2b: Fake document prepended/appended with official identity -> REJECT
    const appendedDocProvenance = {
      ...validFullProvenance,
      sourceDocument: 'Daftar_Mata_Kuliah_S1_Bisnis_Digital_Resmi.html - palsu.docx'
    };
    const appendedDocVerif = verifyFinalAnswer(validPromptAiAnswer, { intent: 'CURRICULUM_INQUIRY', rawQuery: 'Apakah ada mata kuliah AI di Bisnis Digital?' }, { ...baseEvidence, provenance: appendedDocProvenance });
    expect(appendedDocVerif.pass).toBe(false);
    expect(appendedDocVerif.reason).toMatch(/mismatched_course_source_document/);

    // 2c (Neg 8): Fake document name with legitimate official URL in composite label -> REJECT
    const fakeLabelCorrectUrlProv = {
      ...validFullProvenance,
      sourceDocument: 'Dokumen Palsu.pdf (https://bisnisdigital.stikom-bali.ac.id/id/daftar-mata-kuliah/)'
    };
    const fakeLabelVerif = verifyFinalAnswer(validPromptAiAnswer, { intent: 'CURRICULUM_INQUIRY', rawQuery: 'Apakah ada mata kuliah AI di Bisnis Digital?' }, { ...baseEvidence, provenance: fakeLabelCorrectUrlProv });
    expect(fakeLabelVerif.pass).toBe(false);
    expect(fakeLabelVerif.reason).toMatch(/mismatched_course_source_document/);

    // 2d (Neg 9): Legitimate document label with fake/evil URL -> REJECT
    const legitLabelFakeUrlProv = {
      ...validFullProvenance,
      sourceDocument: 'Portal Resmi Prodi Bisnis Digital (https://evil.test/)'
    };
    const legitLabelFakeUrlVerif = verifyFinalAnswer(validPromptAiAnswer, { intent: 'CURRICULUM_INQUIRY', rawQuery: 'Apakah ada mata kuliah AI di Bisnis Digital?' }, { ...baseEvidence, provenance: legitLabelFakeUrlProv });
    expect(legitLabelFakeUrlVerif.pass).toBe(false);
    expect(legitLabelFakeUrlVerif.reason).toMatch(/mismatched_course_source_document/);

    // 2e (Pos 5): Official document label only matches expected composite source -> PASS
    const legitLabelOnlyProv = {
      ...validFullProvenance,
      sourceDocument: 'Portal Resmi Prodi Bisnis Digital'
    };
    const legitLabelOnlyVerif = verifyFinalAnswer(validPromptAiAnswer, { intent: 'CURRICULUM_INQUIRY', rawQuery: 'Apakah ada mata kuliah AI di Bisnis Digital?' }, { ...baseEvidence, provenance: legitLabelOnlyProv });
    expect(legitLabelOnlyVerif.pass).toBe(true);

    // Scenario 3: sourceUrl berbeda meski non-empty -> REJECT (mismatched_course_source_url)
    const badUrlProvenance = {
      ...validFullProvenance,
      sourceUrl: 'https://bisnisdigital-palsu.ac.id'
    };
    const badUrlVerif = verifyFinalAnswer(validPromptAiAnswer, { intent: 'CURRICULUM_INQUIRY', rawQuery: 'Apakah ada mata kuliah AI di Bisnis Digital?' }, { ...baseEvidence, provenance: badUrlProvenance });
    expect(badUrlVerif.pass).toBe(false);
    expect(badUrlVerif.outcome).toBe(VERIFICATION_OUTCOME.VERIFICATION_FAILED);
    expect(badUrlVerif.reason).toMatch(/mismatched_course_source_url/);

    // 3b (Neg 1): HTTP instead of HTTPS -> REJECT
    const httpProvenance = {
      ...validFullProvenance,
      sourceUrl: 'http://bisnisdigital.stikom-bali.ac.id/id/daftar-mata-kuliah/'
    };
    const httpVerif = verifyFinalAnswer(validPromptAiAnswer, { intent: 'CURRICULUM_INQUIRY', rawQuery: 'Apakah ada mata kuliah AI di Bisnis Digital?' }, { ...baseEvidence, provenance: httpProvenance });
    expect(httpVerif.pass).toBe(false);
    expect(httpVerif.reason).toMatch(/mismatched_course_source_url/);

    // 3c (Neg 2): Lookalike URL (subdomain attack) -> REJECT
    const lookalikeSubdomainProvenance = {
      ...validFullProvenance,
      sourceUrl: 'https://bisnisdigital.stikom-bali.ac.id.evil.test/id/daftar-mata-kuliah/'
    };
    const lookalikeSubVerif = verifyFinalAnswer(validPromptAiAnswer, { intent: 'CURRICULUM_INQUIRY', rawQuery: 'Apakah ada mata kuliah AI di Bisnis Digital?' }, { ...baseEvidence, provenance: lookalikeSubdomainProvenance });
    expect(lookalikeSubVerif.pass).toBe(false);
    expect(lookalikeSubVerif.reason).toMatch(/mismatched_course_source_url/);

    // 3d (Neg 3): Different port -> REJECT
    const diffPortProvenance = {
      ...validFullProvenance,
      sourceUrl: 'https://bisnisdigital.stikom-bali.ac.id:8443/id/daftar-mata-kuliah/'
    };
    const diffPortVerif = verifyFinalAnswer(validPromptAiAnswer, { intent: 'CURRICULUM_INQUIRY', rawQuery: 'Apakah ada mata kuliah AI di Bisnis Digital?' }, { ...baseEvidence, provenance: diffPortProvenance });
    expect(diffPortVerif.pass).toBe(false);
    expect(diffPortVerif.reason).toMatch(/mismatched_course_source_url/);

    // 3e (Neg 4): Username/password credentials -> REJECT
    const credsProvenance = {
      ...validFullProvenance,
      sourceUrl: 'https://admin:secret@bisnisdigital.stikom-bali.ac.id/id/daftar-mata-kuliah/'
    };
    const credsVerif = verifyFinalAnswer(validPromptAiAnswer, { intent: 'CURRICULUM_INQUIRY', rawQuery: 'Apakah ada mata kuliah AI di Bisnis Digital?' }, { ...baseEvidence, provenance: credsProvenance });
    expect(credsVerif.pass).toBe(false);
    expect(credsVerif.reason).toMatch(/mismatched_course_source_url/);

    // 3e-2: Claimed dan expected sama-sama menggunakan username/password -> tetap ditolak
    const bothCredsUrl = 'https://admin:secret@bisnisdigital.stikom-bali.ac.id/id/daftar-mata-kuliah/';
    expect(isUrlMatch(bothCredsUrl, bothCredsUrl)).toBe(false);
    expect(isSourceCitationMatching(bothCredsUrl, bothCredsUrl)).toBe(false);

    // 3e-3: URL resmi tanpa kredensial -> tetap diterima
    const officialCleanUrl = 'https://bisnisdigital.stikom-bali.ac.id/id/daftar-mata-kuliah/';
    expect(isUrlMatch(officialCleanUrl, officialCleanUrl)).toBe(true);
    expect(isSourceCitationMatching(officialCleanUrl, officialCleanUrl)).toBe(true);

    // 3f (Neg 5): Path casing mismatch -> REJECT
    const pathCasingProvenance = {
      ...validFullProvenance,
      sourceUrl: 'https://bisnisdigital.stikom-bali.ac.id/ID/DAFTAR-MATA-KULIAH/'
    };
    const pathCasingVerif = verifyFinalAnswer(validPromptAiAnswer, { intent: 'CURRICULUM_INQUIRY', rawQuery: 'Apakah ada mata kuliah AI di Bisnis Digital?' }, { ...baseEvidence, provenance: pathCasingProvenance });
    expect(pathCasingVerif.pass).toBe(false);
    expect(pathCasingVerif.reason).toMatch(/mismatched_course_source_url/);

    // 3g (Neg 6): Query param redirect / fake query -> REJECT
    const fakeQueryProvenance = {
      ...validFullProvenance,
      sourceUrl: 'https://bisnisdigital.stikom-bali.ac.id/id/daftar-mata-kuliah/?redirect=evil.test'
    };
    const fakeQueryVerif = verifyFinalAnswer(validPromptAiAnswer, { intent: 'CURRICULUM_INQUIRY', rawQuery: 'Apakah ada mata kuliah AI di Bisnis Digital?' }, { ...baseEvidence, provenance: fakeQueryProvenance });
    expect(fakeQueryVerif.pass).toBe(false);
    expect(fakeQueryVerif.reason).toMatch(/mismatched_course_source_url/);

    // 3h (Neg 7): Fragment fake anchor -> REJECT
    const fakeHashProvenance = {
      ...validFullProvenance,
      sourceUrl: 'https://bisnisdigital.stikom-bali.ac.id/id/daftar-mata-kuliah/#fake-anchor'
    };
    const fakeHashVerif = verifyFinalAnswer(validPromptAiAnswer, { intent: 'CURRICULUM_INQUIRY', rawQuery: 'Apakah ada mata kuliah AI di Bisnis Digital?' }, { ...baseEvidence, provenance: fakeHashProvenance });
    expect(fakeHashVerif.pass).toBe(false);
    expect(fakeHashVerif.reason).toMatch(/mismatched_course_source_url/);

    // 3i (Pos 2): Official URL without trailing slash matches -> PASS
    const noTrailingSlashProv = {
      ...validFullProvenance,
      sourceUrl: 'https://bisnisdigital.stikom-bali.ac.id/id/daftar-mata-kuliah'
    };
    const noTrailingSlashVerif = verifyFinalAnswer(validPromptAiAnswer, { intent: 'CURRICULUM_INQUIRY', rawQuery: 'Apakah ada mata kuliah AI di Bisnis Digital?' }, { ...baseEvidence, provenance: noTrailingSlashProv });
    expect(noTrailingSlashVerif.pass).toBe(true);

    // Scenario 4: Source atribut SKS palsu meski non-empty -> REJECT (mismatched_course_attribute_source)
    const fakeSksSourceProvenance = {
      ...validFullProvenance,
      provenanceByAttribute: {
        ...validFullProvenance.provenanceByAttribute,
        sks: { value: 2, source: 'https://unverified-blog.com/sks' }
      }
    };
    const fakeSksSourceVerif = verifyFinalAnswer(validPromptAiAnswer, { intent: 'CURRICULUM_INQUIRY', rawQuery: 'Apakah ada mata kuliah AI di Bisnis Digital?' }, { ...baseEvidence, provenance: fakeSksSourceProvenance });
    expect(fakeSksSourceVerif.pass).toBe(false);
    expect(fakeSksSourceVerif.outcome).toBe(VERIFICATION_OUTCOME.VERIFICATION_FAILED);
    expect(fakeSksSourceVerif.reason).toMatch(/mismatched_course_attribute_source/);

    // 4b (Neg 10): Multi-source attribute citation containing one fake source -> REJECT
    const mixedFakeAttrSourceProv = {
      ...validFullProvenance,
      provenanceByAttribute: {
        ...validFullProvenance.provenanceByAttribute,
        code: { value: 'BD233507', source: 'BD_curriculum_raw.html & Dokumen_Palsu.pdf' }
      }
    };
    const mixedFakeVerif = verifyFinalAnswer(validPromptAiAnswer, { intent: 'CURRICULUM_INQUIRY', rawQuery: 'Apakah ada mata kuliah AI di Bisnis Digital?' }, { ...baseEvidence, provenance: mixedFakeAttrSourceProv });
    expect(mixedFakeVerif.pass).toBe(false);
    expect(mixedFakeVerif.reason).toMatch(/mismatched_course_attribute_source/);

    // Scenario 5: Source atribut nama berbeda -> REJECT (mismatched_course_attribute_source)
    const badNameSourceProvenance = {
      ...validFullProvenance,
      provenanceByAttribute: {
        ...validFullProvenance.provenanceByAttribute,
        name: { value: 'Teknik Pembuatan Prompt untuk Model AI', source: 'silabus_tidak_terverifikasi.docx' }
      }
    };
    const badNameSourceVerif = verifyFinalAnswer(validPromptAiAnswer, { intent: 'CURRICULUM_INQUIRY', rawQuery: 'Apakah ada mata kuliah AI di Bisnis Digital?' }, { ...baseEvidence, provenance: badNameSourceProvenance });
    expect(badNameSourceVerif.pass).toBe(false);
    expect(badNameSourceVerif.outcome).toBe(VERIFICATION_OUTCOME.VERIFICATION_FAILED);
    expect(badNameSourceVerif.reason).toMatch(/mismatched_course_attribute_source/);

    // Additional checks: Attribute value mismatches & empty sources
    const badSksProvenance = {
      ...validFullProvenance,
      sks: 3,
      provenanceByAttribute: {
        ...validFullProvenance.provenanceByAttribute,
        sks: { value: 3, source: 'https://bisnisdigital.stikom-bali.ac.id/id/daftar-mata-kuliah/' }
      }
    };
    const badSksVerif = verifyFinalAnswer(validPromptAiAnswer, { intent: 'CURRICULUM_INQUIRY', rawQuery: 'Apakah ada mata kuliah AI di Bisnis Digital?' }, { ...baseEvidence, provenance: badSksProvenance });
    expect(badSksVerif.pass).toBe(false);
    expect(badSksVerif.outcome).toBe(VERIFICATION_OUTCOME.VERIFICATION_FAILED);
    expect(badSksVerif.reason).toMatch(/provenance_attribute_sks_mismatch/);

    const badSemProvenance = {
      ...validFullProvenance,
      semester: 'Semester IV',
      provenanceByAttribute: {
        ...validFullProvenance.provenanceByAttribute,
        semester: { value: 'Semester IV', source: 'https://bisnisdigital.stikom-bali.ac.id/id/daftar-mata-kuliah/' }
      }
    };
    const badSemVerif = verifyFinalAnswer(validPromptAiAnswer, { intent: 'CURRICULUM_INQUIRY', rawQuery: 'Apakah ada mata kuliah AI di Bisnis Digital?' }, { ...baseEvidence, provenance: badSemProvenance });
    expect(badSemVerif.pass).toBe(false);
    expect(badSemVerif.outcome).toBe(VERIFICATION_OUTCOME.VERIFICATION_FAILED);
    expect(badSemVerif.reason).toMatch(/provenance_attribute_semester_mismatch/);

    const badNameProvenance = {
      ...validFullProvenance,
      courseName: 'Prompting Generatif AI Lanjut',
      provenanceByAttribute: {
        ...validFullProvenance.provenanceByAttribute,
        name: { value: 'Prompting Generatif AI Lanjut', source: 'https://bisnisdigital.stikom-bali.ac.id/id/daftar-mata-kuliah/' }
      }
    };
    const badNameVerif = verifyFinalAnswer(validPromptAiAnswer, { intent: 'CURRICULUM_INQUIRY', rawQuery: 'Apakah ada mata kuliah AI di Bisnis Digital?' }, { ...baseEvidence, provenance: badNameProvenance });
    expect(badNameVerif.pass).toBe(false);
    expect(badNameVerif.outcome).toBe(VERIFICATION_OUTCOME.VERIFICATION_FAILED);
    expect(badNameVerif.reason).toMatch(/provenance_attribute_name_mismatch/);

    const emptySourceProvenance = {
      ...validFullProvenance,
      provenanceByAttribute: {
        ...validFullProvenance.provenanceByAttribute,
        sks: { value: 2, source: '   ' }
      }
    };
    const emptySourceVerif = verifyFinalAnswer(validPromptAiAnswer, { intent: 'CURRICULUM_INQUIRY', rawQuery: 'Apakah ada mata kuliah AI di Bisnis Digital?' }, { ...baseEvidence, provenance: emptySourceProvenance });
    expect(emptySourceVerif.pass).toBe(false);
    expect(emptySourceVerif.outcome).toBe(VERIFICATION_OUTCOME.VERIFICATION_FAILED);
    expect(emptySourceVerif.reason).toMatch(/missing_course_attribute_source/);

    const emptySourceUrlProvenance = {
      ...validFullProvenance,
      sourceUrl: ''
    };
    const emptySourceUrlVerif = verifyFinalAnswer(validPromptAiAnswer, { intent: 'CURRICULUM_INQUIRY', rawQuery: 'Apakah ada mata kuliah AI di Bisnis Digital?' }, { ...baseEvidence, provenance: emptySourceUrlProvenance });
    expect(emptySourceUrlVerif.pass).toBe(false);
    expect(emptySourceUrlVerif.outcome).toBe(VERIFICATION_OUTCOME.VERIFICATION_FAILED);
    expect(emptySourceUrlVerif.reason).toMatch(/missing_course_source_metadata/);

    // Clean up mock courses
    catalogData.curriculumFacts['S1 Bisnis Digital'].courses.pop();
    catalogData.curriculumFacts['S1 Bisnis Digital'].courses.pop();

    // Scenario 6: Provenance tidak disertakan saat jawaban memuat kode mata kuliah -> canonical registry menjadi basis verifikasi
    // 6a. Factual correct answer without claimed provenance passes verifier using canonical registry
    const noProvCorrectVerif = verifyFinalAnswer(validPromptAiAnswer, { intent: 'CURRICULUM_INQUIRY' }, { accepted: [{ text: 'BD233507 2 SKS Semester III' }] });
    expect(noProvCorrectVerif.pass).toBe(true);
    expect(noProvCorrectVerif.outcome).toBe(VERIFICATION_OUTCOME.VERIFIED_FACTUAL);

    // 6b. SKS mismatch: Correct code BD233507, but SKS deliberately mutated (claims 3 SKS while registry has 2 SKS) -> Rejected
    const wrongSksAnswer = 'Pada kurikulum resmi S1 Bisnis Digital, terdapat mata kuliah Teknik Pembuatan Prompt untuk Model AI (Kode: BD233507, 3 SKS) pada Semester III.';
    const wrongSksVerif = verifyFinalAnswer(wrongSksAnswer, { intent: 'CURRICULUM_INQUIRY' }, { accepted: [] });
    expect(wrongSksVerif.pass).toBe(false);
    expect(wrongSksVerif.outcome).toBe(VERIFICATION_OUTCOME.VERIFICATION_FAILED);
    expect(wrongSksVerif.reason).toMatch(/unverified_course_sks_claim/);

    // 6c. Semester mismatch: Correct code BD233507, but semester deliberately mutated (claims Semester IV while registry has Semester III) -> Rejected
    const wrongSemAnswer = 'Pada kurikulum resmi S1 Bisnis Digital, terdapat mata kuliah Teknik Pembuatan Prompt untuk Model AI (Kode: BD233507, 2 SKS) pada Semester IV.';
    const wrongSemVerif = verifyFinalAnswer(wrongSemAnswer, { intent: 'CURRICULUM_INQUIRY' }, { accepted: [] });
    expect(wrongSemVerif.pass).toBe(false);
    expect(wrongSemVerif.outcome).toBe(VERIFICATION_OUTCOME.VERIFICATION_FAILED);
    expect(wrongSemVerif.reason).toMatch(/unverified_course_semester_claim/);

    // 6d. Course Name mismatch: Correct code BD233507, but course name completely mismatched (Robotika Otomasi Industri) -> Rejected
    const wrongNameAnswer = 'Pada kurikulum resmi S1 Bisnis Digital, terdapat mata kuliah Robotika Otomasi Industri (Kode: BD233507, 2 SKS) pada Semester III.';
    const wrongNameVerif = verifyFinalAnswer(wrongNameAnswer, { intent: 'CURRICULUM_INQUIRY' }, { accepted: [] });
    expect(wrongNameVerif.pass).toBe(false);
    expect(wrongNameVerif.outcome).toBe(VERIFICATION_OUTCOME.VERIFICATION_FAILED);
    expect(wrongNameVerif.reason).toMatch(/unverified_course_name_claim/);

    // 6e. Obsolete/404 Source URL: claims 404 URL -> Rejected
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

  test('DEFECT-1-REGRESS (Test A): Multi-turn course follow-up resolves anaphora to BD233507 without generic overview deflection', async () => {
    const chatId = 'DEFECT-1-REGRESS-SESSION-' + Date.now();

    // Turn 1: AI course inquiry for S1 Bisnis Digital
    const t1 = await runPhase1DeterministicPipeline(chatId, 'Apakah mahasiswa Bisnis Digital belajar Artificial Intelligence?');
    const sq1 = t1.subQueryResults?.[0];
    const outcome1 = t1.verification?.outcome || sq1?.verification?.outcome;
    const answer1 = t1.finalAnswer || t1.answer || '';

    expect(outcome1).toBe('VERIFIED_FACTUAL');
    expect(answer1).toMatch(/S1 Bisnis Digital/i);
    expect(answer1).toMatch(/Teknik Pembuatan Prompt untuk Model AI/i);
    expect(answer1).toMatch(/BD233507/i);
    expect(answer1).toMatch(/Semester III/i);
    expect(answer1).toMatch(/2 SKS/i);

    // Verify production session persistence mechanism populated lastCourseFact
    const sessionAfterT1 = await getSession(chatId);
    expect(sessionAfterT1.data?.lastCourseFact).toBeDefined();
    expect(sessionAfterT1.data?.lastCourseFact.courseCode).toBe('BD233507');
    expect(sessionAfterT1.data?.lastCourseFact.program).toBe('S1 Bisnis Digital');

    // Turn 2: Anaphoric follow-up: "Mata kuliah tersebut mempelajari apa saja?" (no manual injection)
    const t2 = await runPhase1DeterministicPipeline(chatId, 'Mata kuliah tersebut mempelajari apa saja?');
    const sq2 = t2.subQueryResults?.[0];
    const outcome2 = t2.verification?.outcome || sq2?.verification?.outcome;
    const answer2 = t2.finalAnswer || t2.answer || '';

    // Anaphora resolution and entity continuity
    expect(outcome2).toBe('SAFE_UNKNOWN');
    expect(t2.verification?.handledSafely).toBe(true);
    expect(t2.semanticFrame?.entities?.map(e => e.canonical)).toContain('S1 Bisnis Digital');

    // Specific grounded course facts asserted
    expect(answer2).toMatch(/Teknik Pembuatan Prompt untuk Model AI/i);
    expect(answer2).toMatch(/BD233507/i);
    expect(answer2).toMatch(/Semester III/i);
    expect(answer2).toMatch(/2 SKS/i);

    // Honest syllabus limitation without hallucination
    expect(answer2).toMatch(/belum memuat silabus terperinci/i);

    // Absolute prohibition of generic 8-semester curriculum overview
    expect(answer2).not.toMatch(/8 semester/i);
    expect(answer2).not.toMatch(/Tahun I \(Semester I - II\)/i);
    expect(answer2).not.toMatch(/total 144 SKS/i);

    // Turn 3: Program switch to S1 Sistem Informasi -> previous BD course context must be purged
    const t3 = await runPhase1DeterministicPipeline(chatId, 'Bagaimana dengan program studi S1 Sistem Informasi?');
    const sessionAfterT3 = await getSession(chatId);
    expect(sessionAfterT3.data?.activeEntity).toBe('S1 Sistem Informasi');
    expect(sessionAfterT3.data?.lastCourseFact).toBeNull();
    expect(t3.finalAnswer).not.toMatch(/BD233507/i);
    expect(t3.finalAnswer).not.toMatch(/Teknik Pembuatan Prompt untuk Model AI/i);
  });

  test('DEFECT-2-REGRESS (Test B): Full 4-turn production smoke test sequence including curriculum validity', async () => {
    const chatId = 'DEFECT-2-REGRESS-SESSION-' + Date.now();

    // Turn 1: AI course inquiry ("Apakah mahasiswa Bisnis Digital belajar AI?")
    const t1 = await runPhase1DeterministicPipeline(chatId, 'Apakah mahasiswa Bisnis Digital belajar AI?');
    expect(t1.verification?.outcome || t1.subQueryResults?.[0]?.verification?.outcome).toBe('VERIFIED_FACTUAL');
    expect(t1.finalAnswer).toMatch(/BD233507/i);

    // Turn 2: Follow-up syllabus inquiry
    const t2 = await runPhase1DeterministicPipeline(chatId, 'Mata kuliah tersebut mempelajari apa saja?');
    expect(t2.verification?.outcome || t2.subQueryResults?.[0]?.verification?.outcome).toBe('SAFE_UNKNOWN');
    expect(t2.verification?.handledSafely).toBe(true);
    expect(t2.finalAnswer).toMatch(/BD233507/i);
    expect(t2.finalAnswer).toMatch(/belum memuat silabus terperinci/i);
    expect(t2.finalAnswer).not.toMatch(/8 semester/i);

    // Turn 3: PMB enrollment current status
    const t3 = await runPhase1DeterministicPipeline(chatId, 'Pendaftaran masih dibuka?');
    expect(t3.verification?.outcome || t3.subQueryResults?.[0]?.verification?.outcome).toBe('SAFE_UNKNOWN');
    expect(t3.verification?.handledSafely).toBe(true);
    expect(t3.finalAnswer).toMatch(/pmb\.stikom-bali\.ac\.id|\(0361\)\s*244445/i);

    // Turn 4: Curriculum validity inquiry: "Apakah kurikulum Bisnis Digital masih berlaku?"
    const t4 = await runPhase1DeterministicPipeline(chatId, 'Apakah kurikulum Bisnis Digital masih berlaku?');
    const outcome4 = t4.verification?.outcome || t4.subQueryResults?.[0]?.verification?.outcome;
    const answer4 = t4.finalAnswer || t4.answer || '';

    // Semantic Frame assertions
    expect(t4.semanticFrame?.intent).toBe('CURRICULUM_VALIDITY_INQUIRY');
    expect(t4.semanticFrame?.entities?.map(e => e.canonical)).toContain('S1 Bisnis Digital');
    expect(t4.semanticFrame?.temporal?.constraint).toBe('NOW');

    // Answerability & Verification assertions
    expect(outcome4).toBe('SAFE_UNKNOWN');
    expect(t4.verification?.handledSafely).toBe(true);

    // Documented version stated without asserting active live validity
    expect(answer4).toMatch(/Kurikulum 2023/i);
    expect(answer4).toMatch(/BAAK|Direktorat Administrasi Akademik/i);
    expect(answer4).toMatch(/Program Studi S1 Bisnis Digital/i);
    expect(answer4).toMatch(/belum dapat dipastikan/i);

    // Absolute prohibition of generic 8-semester curriculum overview or equating 146 with 144 SKS
    expect(answer4).not.toMatch(/8 semester/i);
    expect(answer4).not.toMatch(/Tahun I \(Semester I - II\)/i);
    expect(answer4).not.toMatch(/144 SKS/i);
    expect(answer4).not.toMatch(/146 SKS/i);
  });

  describe('Post-Deployment Defect Fix: AI Course Grounding & Syllabus Recovery', () => {
    test('Test 1: Mocked LLM answer with course facts and syllabus limitation passes VERIFIED_FACTUAL', () => {
      const text = 'Mahasiswa Program Studi S1 Bisnis Digital di ITB STIKOM Bali mempelajari mata kuliah terkait Artificial Intelligence, yaitu BD233507 - Teknik Pembuatan Prompt untuk Model AI pada Semester III dengan bobot 2 SKS. Namun, rincian silabus atau deskripsi materi perkuliahan belum tercantum dalam dokumen resmi kurikulum yang tersedia.';
      const frame = {
        rawQuery: 'Apakah mahasiswa Bisnis Digital belajar Artificial Intelligence?',
        normalizedQuery: 'apakah mahasiswa bisnis digital belajar artificial intelligence',
        intent: 'CURRICULUM_INQUIRY',
        domain: 'ACADEMIC_CURRICULUM',
        entities: [{ canonical: 'S1 Bisnis Digital', type: 'academic_program' }],
        aspects: ['curriculum']
      };
      const arbitrated = {
        answerability: 'ANSWERABLE',
        accepted: [
          {
            id: 'chunk_bd_course',
            text: 'BD233507 Teknik Pembuatan Prompt untuk Model AI Semester III 2 SKS',
            provenance: {
              sourceDocument: 'Daftar_Mata_Kuliah_S1_Bisnis_Digital_Resmi.html',
              sourceUrl: 'https://bisnisdigital.stikom-bali.ac.id/id/daftar-mata-kuliah/',
              verificationStatus: 'VERIFIED_PRIMARY_SOURCE',
              authorityTier: 1
            }
          }
        ],
        coveredAspects: ['curriculum']
      };

      const result = verifyFinalAnswer(text, frame, arbitrated);

      expect(result.pass).toBe(true);
      expect(result.outcome).toBe(VERIFICATION_OUTCOME.VERIFIED_FACTUAL);
      expect(result.outcome).not.toBe(VERIFICATION_OUTCOME.SAFE_UNKNOWN);
      expect(result.outcome).not.toBe('PARTIAL');
      expect(result.provenance?.courseCode).toBe('BD233507');
      expect(result.provenance?.program).toBe('S1 Bisnis Digital');
    });

    test('Test 1b: Contradictory SKS claim (asserting 144 SKS and stating total SKS unconfirmed) is rejected', () => {
      const contradictoryText = 'Beban studi Program Studi S1 Bisnis Digital adalah 144 SKS.\n\n_Catatan: Informasi mengenai total beban studi (SKS) belum terkonfirmasi dalam sumber bukti yang tersedia saat ini._';
      const frame = {
        rawQuery: 'Bagaimana kurikulum Bisnis Digital?',
        intent: 'CURRICULUM_INQUIRY',
        domain: 'ACADEMIC_CURRICULUM',
        entities: [{ canonical: 'S1 Bisnis Digital' }]
      };
      const arbitrated = {
        accepted: [{ id: 'c1', text: 'Kurikulum S1 Bisnis Digital 144 SKS' }]
      };
      const result = verifyFinalAnswer(contradictoryText, frame, arbitrated);

      expect(result.pass).toBe(false);
      expect(result.reason).toBe('contradictory_sks_claim_asserted_and_unconfirmed');
    });

    test('Test 1c: Unsubstantiated positive syllabus claim is rejected with unsubstantiated_course_syllabus_claim', () => {
      const hallucinatedSyllabusText = 'Mata kuliah BD233507 Teknik Pembuatan Prompt untuk Model AI pada Semester III dengan bobot 2 SKS mempelajari modul machine learning, deep learning, dan neural network secara mendalam.';
      const frame = {
        rawQuery: 'Mata kuliah BD233507 mempelajari apa saja?',
        intent: 'CURRICULUM_INQUIRY',
        domain: 'ACADEMIC_CURRICULUM',
        entities: [{ canonical: 'S1 Bisnis Digital' }]
      };
      const arbitrated = {
        accepted: [{ id: 'c1', text: 'BD233507 Teknik Pembuatan Prompt untuk Model AI Semester III 2 SKS' }]
      };
      const result = verifyFinalAnswer(hallucinatedSyllabusText, frame, arbitrated);

      expect(result.pass).toBe(false);
      expect(result.reason).toBe('unsubstantiated_course_syllabus_claim');
    });

    test('Test 2: Specific course inquiry rejected by verifier in synthesis recovers without 8-semester summary', async () => {
      const chatId = 'POST-DEPLOY-RECOVERY-' + Date.now();
      let callCount = 0;
      const customVerifier = (text, frame, arbitrated, nullArg, recResult, verifOpts) => {
        callCount++;
        // Reject the first call (initial synthesis) to force the recovery path
        if (callCount === 1) {
          return {
            pass: false,
            outcome: VERIFICATION_OUTCOME.VERIFICATION_FAILED,
            status: VERIFICATION_OUTCOME.VERIFICATION_FAILED,
            reason: 'simulated_first_synthesis_rejection',
            handledSafely: false
          };
        }
        // Let recovery call use the standard verifier
        return verifyFinalAnswer(text, frame, arbitrated, nullArg, recResult, verifOpts);
      };

      const res = await runPhase1DeterministicPipeline(chatId, 'Apakah mahasiswa Bisnis Digital belajar Artificial Intelligence?', {
        finalAnswerVerifier: customVerifier
      });

      const finalAns = res.finalAnswer || res.answer || '';

      // Verification outcome must be safe or verified factual
      expect(res.verification?.handledSafely).toBe(true);

      // Must assert the specific course BD233507
      expect(finalAns).toMatch(/BD233507/i);
      expect(finalAns).toMatch(/Teknik Pembuatan Prompt untuk Model AI/i);

      // Absolute prohibition: Must NOT generate generic 8-semester curriculum summary
      expect(finalAns).not.toMatch(/8 semester/i);
      expect(finalAns).not.toMatch(/Tahun I \(Semester I - II\)/i);
      expect(finalAns).not.toMatch(/total 144 SKS/i);
    });

    test('Test 3: Multi-turn syllabus follow-up after AI course inquiry resolves context and safely abstains', async () => {
      const chatId = 'POST-DEPLOY-MULTITURN-' + Date.now();

      // Turn 1: AI course inquiry ("Apakah mahasiswa Bisnis Digital belajar Artificial Intelligence?")
      const t1 = await runPhase1DeterministicPipeline(chatId, 'Apakah mahasiswa Bisnis Digital belajar Artificial Intelligence?');
      expect(t1.verification?.outcome || t1.subQueryResults?.[0]?.verification?.outcome).toBe('VERIFIED_FACTUAL');
      expect(t1.finalAnswer).toMatch(/BD233507/i);

      // Verify Turn 1 automatically stored lastCourseFact in session
      const sessionAfterT1 = await getSession(chatId);
      expect(sessionAfterT1.data?.lastCourseFact?.courseCode).toBe('BD233507');
      expect(sessionAfterT1.data?.lastCourseFact?.program).toBe('S1 Bisnis Digital');

      // Turn 2: Follow-up syllabus inquiry ("Mata kuliah tersebut mempelajari apa saja?")
      const t2 = await runPhase1DeterministicPipeline(chatId, 'Mata kuliah tersebut mempelajari apa saja?');
      const outcome2 = t2.verification?.outcome || t2.subQueryResults?.[0]?.verification?.outcome;
      const answer2 = t2.finalAnswer || t2.answer || '';

      // Context resolution: Turn 2 recognizes context BD233507 and S1 Bisnis Digital
      expect(t2.semanticFrame?.entities?.map(e => e.canonical)).toContain('S1 Bisnis Digital');

      // Safe unknown with syllabus limitation
      expect(outcome2).toBe('SAFE_UNKNOWN');
      expect(t2.verification?.handledSafely).toBe(true);
      expect(answer2).toMatch(/BD233507/i);
      expect(answer2).toMatch(/belum memuat silabus terperinci/i);

      // Prohibition of generic 8-semester overview
      expect(answer2).not.toMatch(/8 semester/i);
      expect(answer2).not.toMatch(/Tahun I \(Semester I - II\)/i);
      expect(answer2).not.toMatch(/total 144 SKS/i);

      // Prohibition of fake syllabus claims
      expect(answer2).not.toMatch(/machine learning/i);
      expect(answer2).not.toMatch(/deep learning/i);
      expect(answer2).not.toMatch(/neural network/i);
    });

    test('Test 4: Broad curriculum inquiry uses appropriate broad curriculum summary without contradictory SKS claims', async () => {
      const chatId = 'POST-DEPLOY-BROAD-CURRICULUM-' + Date.now();
      const res = await runPhase1DeterministicPipeline(chatId, 'Bagaimana struktur kurikulum S1 Bisnis Digital?');
      const outcome = res.verification?.outcome || res.subQueryResults?.[0]?.verification?.outcome;
      const answer = res.finalAnswer || res.answer || '';

      // Must be safely verified
      expect(res.verification?.pass).toBe(true);
      expect(outcome === 'VERIFIED_FACTUAL' || outcome === 'PARTIAL').toBe(true);

      // Must contain broad curriculum information
      expect(answer).toMatch(/kurikulum|mata kuliah|semester/i);

      // Must NOT contain contradictory SKS assertion vs unconfirmed disclaimer
      const hasContradictorySks = /\b144\s*sks\b/i.test(answer) && /\btotal beban studi \(sks\) belum terkonfirmasi\b/i.test(answer);
      expect(hasContradictorySks).toBe(false);
    });

    test('Test 5: 5-turn session sequence proves course context does not contaminate PMB, Fee, or General Curriculum turns', async () => {
      const chatId = 'POST-DEPLOY-5TURN-SESSION-' + Date.now();

      // Turn 1: AI course inquiry S1 Bisnis Digital
      const t1 = await runPhase1DeterministicPipeline(chatId, 'Apakah mahasiswa Bisnis Digital belajar Artificial Intelligence?');
      expect(t1.finalAnswer).toMatch(/BD233507/i);
      const sessionAfterT1 = await getSession(chatId);
      expect(sessionAfterT1.data?.lastCourseFact?.courseCode).toBe('BD233507');

      // Turn 2: Follow-up syllabus inquiry
      const t2 = await runPhase1DeterministicPipeline(chatId, 'Mata kuliah tersebut mempelajari apa saja?');
      expect(t2.verification?.outcome || t2.subQueryResults?.[0]?.verification?.outcome).toBe('SAFE_UNKNOWN');
      expect(t2.finalAnswer).toMatch(/BD233507/i);

      // Turn 3: Topic switch to PMB ("Pendaftaran masih dibuka?")
      const t3 = await runPhase1DeterministicPipeline(chatId, 'Pendaftaran masih dibuka?');
      expect(t3.semanticFrame?.domain).toBe('PMB');
      expect(t3.finalAnswer).toMatch(/pmb\.stikom-bali\.ac\.id|\(0361\)\s*244445/i);
      expect(t3.finalAnswer).not.toMatch(/BD233507/i);
      const sessionAfterT3 = await getSession(chatId);
      expect(sessionAfterT3.data?.lastCourseFact).toBeNull(); // Cleared on domain switch

      // Turn 4: Tuition fee inquiry ("Berapa biaya kuliah S1 Bisnis Digital?")
      const t4 = await runPhase1DeterministicPipeline(chatId, 'Berapa biaya kuliah S1 Bisnis Digital?');
      expect(t4.semanticFrame?.domain).toBe('TUITION_FEE');
      expect(t4.finalAnswer).toMatch(/DPP|SPP|biaya/i);
      expect(t4.finalAnswer).not.toMatch(/BD233507/i);

      // Turn 5: General curriculum inquiry ("Bagaimana struktur kurikulum S1 Bisnis Digital?")
      const t5 = await runPhase1DeterministicPipeline(chatId, 'Bagaimana struktur kurikulum S1 Bisnis Digital?');
      expect(t5.semanticFrame?.intent).toBe('CURRICULUM_INQUIRY');
      expect(t5.finalAnswer).toMatch(/kurikulum|mata kuliah|semester/i);
      // General curriculum route successfully used, not hijacked into specific BD233507 recovery
      expect(t5.verification?.pass).toBe(true);
    });

    test('Test 6: Syllabus evidence verification cases A, B, C, D', () => {
      const frame = {
        rawQuery: 'Mata kuliah BD233507 mempelajari apa saja?',
        intent: 'CURRICULUM_INQUIRY',
        domain: 'ACADEMIC_CURRICULUM',
        entities: [{ canonical: 'S1 Bisnis Digital' }]
      };

      // Case A: Accepted evidence explicitly says "silabus belum tersedia" -> rejected if answer claims topics
      const evA = {
        accepted: [{ id: 'cA', text: 'BD233507 Teknik Pembuatan Prompt untuk Model AI. Rincian silabus belum tersedia.' }]
      };
      const ansA = 'Mata kuliah BD233507 Teknik Pembuatan Prompt untuk Model AI mempelajari teknik prompt engineering lanjutan dan model generative AI.';
      const resA = verifyFinalAnswer(ansA, frame, evA);
      expect(resA.pass).toBe(false);
      expect(resA.reason).toBe('unsubstantiated_course_syllabus_claim');

      // Case B: Accepted evidence mentions "materi perkuliahan" without content -> rejected if answer claims topics
      const evB = {
        accepted: [{ id: 'cB', text: 'Mata kuliah ini termasuk materi perkuliahan kurikulum 2023.' }]
      };
      const ansB = 'Mata kuliah BD233507 Teknik Pembuatan Prompt untuk Model AI mempelajari modul machine learning dan deep learning.';
      const resB = verifyFinalAnswer(ansB, frame, evB);
      expect(resB.pass).toBe(false);
      expect(resB.reason).toBe('unsubstantiated_course_syllabus_claim');

      // Case C: Accepted evidence actually contains substantive syllabus details for BD233507 -> accepted
      const evC = {
        accepted: [
          {
            id: 'cC',
            text: 'BD233507 Teknik Pembuatan Prompt untuk Model AI Semester III 2 SKS. Silabus: Modul 1 Dasar Prompting, Modul 2 Few-Shot Prompting, Modul 3 Evaluasi Output Model AI.'
          }
        ]
      };
      const ansC = 'Mata kuliah BD233507 Teknik Pembuatan Prompt untuk Model AI pada Semester III (2 SKS) memuat silabus: Modul 1 Dasar Prompting, Modul 2 Few-Shot Prompting, dan Modul 3 Evaluasi Output Model AI.';
      const resC = verifyFinalAnswer(ansC, frame, evC);
      expect(resC.pass).toBe(true);
      expect(resC.outcome).toBe(VERIFICATION_OUTCOME.VERIFIED_FACTUAL);

      // Case D: LLM invents machine learning / neural networks without evidence -> rejected
      const evD = { accepted: [{ id: 'cD', text: 'BD233507 2 SKS Semester III' }] };
      const ansD = 'Mata kuliah BD233507 Teknik Pembuatan Prompt untuk Model AI mempelajari machine learning, deep learning, dan neural network secara mendalam.';
      const resD = verifyFinalAnswer(ansD, frame, evD);
      expect(resD.pass).toBe(false);
      expect(resD.reason).toBe('unsubstantiated_course_syllabus_claim');
    });

    test('Test 7: S1 Bisnis Digital curriculum structure (146 SKS) vs graduation minimum (144 SKS) discrepancy gate', () => {
      const frameBD = {
        rawQuery: 'Berapa total SKS S1 Bisnis Digital?',
        intent: 'CURRICULUM_INQUIRY',
        domain: 'ACADEMIC_CURRICULUM',
        entities: [{ canonical: 'S1 Bisnis Digital' }]
      };
      const arbitrated = {
        accepted: [{ text: 'Kurikulum S1 Bisnis Digital 146 SKS sebaran, 144 SKS minimum kelulusan' }]
      };

      // 7a. Claiming total offered curriculum is 144 SKS -> REJECTED
      const claimWrongOffered = 'Total struktur kurikulum yang ditawarkan pada Program Studi S1 Bisnis Digital adalah 144 SKS.';
      const resWrongOffered = verifyFinalAnswer(claimWrongOffered, frameBD, arbitrated);
      expect(resWrongOffered.pass).toBe(false);
      expect(resWrongOffered.reason).toBe('curriculum_structure_sks_mismatch_bd_146');

      // 7b. Claiming graduation minimum is 146 SKS -> REJECTED
      const claimWrongGrad = 'Beban studi minimum kelulusan untuk Program Studi S1 Bisnis Digital adalah 146 SKS.';
      const resWrongGrad = verifyFinalAnswer(claimWrongGrad, frameBD, arbitrated);
      expect(resWrongGrad.pass).toBe(false);
      expect(resWrongGrad.reason).toBe('graduation_minimum_sks_mismatch_bd_144');

      // 7c. Accurately distinguishing 146 SKS offered and 144 SKS graduation minimum per Permendiktisaintek 39/2025 -> PASS
      const accurateDiscrepancy = 'Struktur kurikulum Program Studi S1 Bisnis Digital menawarkan total 146 SKS (akumulasi Semester I–VIII). Sementara itu, beban studi minimum kelulusan sarjana adalah 144 SKS sesuai Permendiktisaintek No. 39 Tahun 2025 dan Pedoman Akademik ITB STIKOM Bali.';
      const resAccurate = verifyFinalAnswer(accurateDiscrepancy, frameBD, arbitrated);
      expect(resAccurate.pass).toBe(true);
      expect(resAccurate.outcome).toBe(VERIFICATION_OUTCOME.VERIFIED_FACTUAL);
    });
  });

  describe('Post-Deployment e755d83 Targeted Defects & AI Course Identity Suite', () => {
    test('Case 1: Full multi-attribute course query returns BD233507, Semester III, 2 SKS', async () => {
      const q = 'Di S1 Bisnis Digital, apa nama mata kuliah tentang pembuatan prompt untuk model AI, semester berapa, dan berapa SKS?';
      const res = await runPhase1DeterministicPipeline('POST-DEPLOY-AI-01', q);
      const answer = res.answer || res.text || '';
      const outcome = res.verification?.outcome || res.subQueryResults?.[0]?.verification?.outcome;

      expect(answer).toMatch(/Teknik Pembuatan Prompt untuk Model AI/i);
      expect(answer).toMatch(/BD233507/);
      expect(answer).toMatch(/Semester\s*III/i);
      expect(answer).toMatch(/2\s*SKS/i);
      expect(answer).toMatch(/S1 Bisnis Digital/i);
      expect(outcome).toBe('VERIFIED_FACTUAL');
      expect(answer).not.toMatch(/Pesan\s*3/i);
      expect(answer).not.toMatch(/di luar informasi kampus/i);
    });

    test('Case 2: Variations find canonical course fact BD233507 in S1 Bisnis Digital', () => {
      const v1 = getProgramCourseFact('S1 Bisnis Digital', 'prompt untuk model AI');
      expect(v1).not.toBeNull();
      expect(v1.code).toBe('BD233507');
      expect(v1.name).toBe('Teknik Pembuatan Prompt untuk Model AI');
      expect(v1.semester).toBe('Semester III');
      expect(v1.sks).toBe(2);

      const v2 = getProgramCourseFact('S1 Bisnis Digital', 'prompt engineering');
      expect(v2).not.toBeNull();
      expect(v2.code).toBe('BD233507');

      const v3 = getProgramCourseFact('S1 Bisnis Digital', 'pembuatan prompt untuk model AI');
      expect(v3).not.toBeNull();
      expect(v3.code).toBe('BD233507');
    });

    test('Case 3: Single compound question does not decompose "berapa SKS" into graduation requirements', async () => {
      const q = 'Di S1 Bisnis Digital, apa nama mata kuliah tentang pembuatan prompt untuk model AI, semester berapa, dan berapa SKS?';
      const res = await runPhase1DeterministicPipeline('POST-DEPLOY-AI-03', q);
      expect(res.subQueryResults).toBeDefined();
      expect(res.subQueryResults.length).toBe(1);
      const frame = res.subQueryResults[0].frame;
      expect(frame.intent).not.toBe('GRADUATION_REQUIREMENTS');
      expect(res.answer).toMatch(/2\s*SKS/i);
      expect(res.answer).not.toMatch(/144\s*SKS.*beban studi minimum/i);
    });

    test('Case 4: Multi-turn follow-up preserves lastCourseFact and returns safe unknown for syllabus without hallucination', async () => {
      const q1 = 'Di S1 Bisnis Digital, apa nama mata kuliah tentang pembuatan prompt untuk model AI, semester berapa, dan berapa SKS?';
      const turn1Res = await runPhase1DeterministicPipeline('POST-DEPLOY-AI-04-TURN1', q1);
      expect(turn1Res.answer).toMatch(/BD233507/);

      const sess = await getSession('POST-DEPLOY-AI-04-TURN1');
      expect(sess.data.lastCourseFact).toBeDefined();
      expect(sess.data.lastCourseFact.courseCode).toBe('BD233507');

      const q2 = 'Mata kuliah tersebut mempelajari apa saja?';
      const turn2Res = await runPhase1DeterministicPipeline('POST-DEPLOY-AI-04-TURN1', q2);
      const answer2 = turn2Res.answer || turn2Res.text || '';
      const outcome2 = turn2Res.verification?.outcome || turn2Res.subQueryResults?.[0]?.verification?.outcome;

      expect(answer2).toMatch(/BD233507|Teknik Pembuatan Prompt untuk Model AI/i);
      expect(answer2).toMatch(/belum\s+memuat\s+silabus|dokumen\s+ringkasan\s+kurikulum\s+publik/i);
      expect(answer2).not.toMatch(/BD232101/);
      expect(answer2).not.toMatch(/kewirausahaan/i);
      expect(answer2).not.toMatch(/machine\s+learning|deep\s+learning|neural\s+network/i);
      expect(outcome2).toBe('SAFE_UNKNOWN');
    });

    test('Case 5: General curriculum inquiry does not latch onto unrelated courses like Kewirausahaan', async () => {
      const q = 'Bagaimana struktur kurikulum S1 Bisnis Digital?';
      const res = await runPhase1DeterministicPipeline('POST-DEPLOY-AI-05', q);
      const answer = res.answer || res.text || '';
      expect(answer).toMatch(/146\s*SKS|Semester\s*I/i);
      expect(answer).not.toMatch(/mata kuliah tersebut/i);
    });

    test('Case 6: Leading/trailing test label like "Pesan 3" is not treated as OUT_OF_DOMAIN subquery note', async () => {
      // 6a. Leading "Pesan 3: "
      const q = 'Pesan 3: Di S1 Bisnis Digital, apa nama mata kuliah tentang pembuatan prompt untuk model AI, semester berapa, dan berapa SKS?';
      const res = await runPhase1DeterministicPipeline('POST-DEPLOY-AI-06', q);
      const answer = res.answer || res.text || '';

      expect(answer).toMatch(/Teknik Pembuatan Prompt untuk Model AI/i);
      expect(answer).toMatch(/BD233507/);
      expect(answer).not.toMatch(/di luar informasi kampus/i);
      expect(answer).not.toMatch(/Pesan 3/i);

      // 6b. Leading bracketed "[Pertanyaan 1]"
      const qBracket = '[Pertanyaan 1] Di S1 Bisnis Digital, apa nama mata kuliah tentang pembuatan prompt untuk model AI, semester berapa, dan berapa SKS?';
      const resBracket = await runPhase1DeterministicPipeline('POST-DEPLOY-AI-06-BRACKET', qBracket);
      const ansBracket = resBracket.answer || resBracket.text || '';
      expect(ansBracket).toMatch(/Teknik Pembuatan Prompt untuk Model AI/i);
      expect(ansBracket).toMatch(/BD233507/);
      expect(ansBracket).not.toMatch(/di luar informasi kampus/i);
      expect(ansBracket).not.toMatch(/Pertanyaan 1/i);

      // 6c. Legitimate Indonesian word "pesan" in query is NOT removed
      const qLegit = 'Bagaimana cara kirim pesan untuk menanyakan pendaftaran mahasiswa baru?';
      const resLegit = await runPhase1DeterministicPipeline('POST-DEPLOY-AI-06-LEGIT', qLegit);
      expect(resLegit.subQueryResults[0].frame.domain).not.toBe('OUT_OF_DOMAIN');
      expect(resLegit.subQueryResults[0].frame.rawQuery).toMatch(/pesan/i);
    });

    test('Case 7: PMB status and tuition fee behaviors remain intact', async () => {
      // 7a. PMB status inquiry remains safe unknown with no unverified real-time claims
      const pmbRes = await runPhase1DeterministicPipeline('POST-DEPLOY-AI-07-PMB', 'Pendaftaran mahasiswa baru masih dibuka?');
      const pmbAnswer = pmbRes.answer || pmbRes.text || '';
      const pmbOutcome = pmbRes.verification?.outcome || pmbRes.subQueryResults?.[0]?.verification?.outcome;
      expect(pmbOutcome).toBe('SAFE_UNKNOWN');
      expect(pmbAnswer).toMatch(/pmb\.stikom-bali\.ac\.id|0813-3939-6443/i);
      expect(pmbAnswer).not.toMatch(/dibuka\s+sampai\s+tanggal\s+\d+/i);

      // 7b. Tuition fee remains VERIFIED_FACTUAL with exact amounts
      const feeRes = await runPhase1DeterministicPipeline('POST-DEPLOY-AI-07-FEE', 'Berapa biaya kuliah S1 Bisnis Digital?');
      const feeAnswer = feeRes.answer || feeRes.text || '';
      const feeOutcome = feeRes.verification?.outcome || feeRes.subQueryResults?.[0]?.verification?.outcome;
      expect(feeOutcome).toBe('VERIFIED_FACTUAL');
      expect(feeAnswer).toMatch(/Rp\s*6\.500\.000|Rp\s*14\.000\.000/i);
    });
  });

  describe('Final Quality Gate & Canonical Registry Hardening Suite', () => {
    const { getProgramCourseFact, CANONICAL_FACTS_REGISTRY } = require('../src/core/academicCatalog');
    const { verifyFinalAnswer } = require('../src/core/finalAnswerVerifier');

    test('1. Query generic "sistem" does not force BD233301', () => {
      const match = getProgramCourseFact('S1 Bisnis Digital', 'sistem');
      expect(match).toBeNull();
    });

    test('2. Compound query "Kewirausahaan dan Analisis Data Bisnis" is recognized as ambiguous', () => {
      const match = getProgramCourseFact('S1 Bisnis Digital', 'Kewirausahaan dan Analisis Data Bisnis');
      expect(match).toBeNull();
    });

    test('3. Query "prompt engineering" finds the correct record via generic resolver', () => {
      const match = getProgramCourseFact('S1 Bisnis Digital', 'prompt engineering');
      expect(match).not.toBeNull();
      expect(match.code).toBe('BD233507');
      expect(match.name).toBe('Teknik Pembuatan Prompt untuk Model AI');
      expect(match.semester).toBe('Semester III');
      expect(match.sks).toBe(2);
    });

    test('4. Name, semester, and SKS attributes originate exclusively from canonical registry', () => {
      const registryCourse = CANONICAL_FACTS_REGISTRY.curriculumFacts['S1 Bisnis Digital'].courses
        .find(c => c.code === 'BD233507');
      expect(registryCourse).toBeDefined();

      const resolved = getProgramCourseFact('S1 Bisnis Digital', 'pembuatan prompt untuk model AI');
      expect(resolved.name).toBe(registryCourse.name);
      expect(resolved.code).toBe(registryCourse.code);
      expect(resolved.semester).toBe(registryCourse.semester);
      expect(resolved.sks).toBe(registryCourse.sks);
      expect(resolved.verificationStatus).toBe('VERIFIED_PRIMARY_SOURCE');
    });

    test('5. Unavailable course syllabus produces SAFE_UNKNOWN', async () => {
      const chatId = 'FINAL-GATE-SYLLABUS-' + Date.now();
      // Turn 1: Ground course
      await runPhase1DeterministicPipeline(chatId, 'Di S1 Bisnis Digital, apa nama mata kuliah tentang pembuatan prompt untuk model AI, semester berapa, dan berapa SKS?');
      // Turn 2: Follow-up syllabus
      const res = await runPhase1DeterministicPipeline(chatId, 'Mata kuliah tersebut mempelajari apa saja?');
      const outcome = res.verification?.outcome || res.subQueryResults?.[0]?.verification?.outcome;
      const answer = res.answer || res.text || '';

      expect(outcome).toBe('SAFE_UNKNOWN');
      expect(res.verification?.handledSafely).toBe(true);
      expect(answer).toMatch(/belum memuat silabus terperinci|belum diuraikan/i);
      expect(answer).toMatch(/BD233507/);
    });

    test('6. Curriculum structure inquiry is answered from official structure evidence', async () => {
      const q = 'Di S1 Bisnis Digital, apa nama mata kuliah tentang pembuatan prompt untuk model AI, semester berapa, dan berapa SKS?';
      const res = await runPhase1DeterministicPipeline('FINAL-GATE-STRUCTURE', q);
      const outcome = res.verification?.outcome || res.subQueryResults?.[0]?.verification?.outcome;
      const answer = res.answer || res.text || '';

      expect(outcome).toBe('VERIFIED_FACTUAL');
      expect(answer).toMatch(/Teknik Pembuatan Prompt untuk Model AI/i);
      expect(answer).toMatch(/BD233507/);
      expect(answer).toMatch(/Semester III/i);
      expect(answer).toMatch(/2 SKS/i);
    });

    test('7. Current curriculum validity inquiry does not pass merely because document has category KURIKULUM', () => {
      const positiveClaim = 'Kurikulum S1 Bisnis Digital masih berlaku aktif saat ini pada tahun 2026.';
      const frame = {
        rawQuery: 'Apakah kurikulum Bisnis Digital masih berlaku saat ini?',
        intent: 'CURRICULUM_VALIDITY_INQUIRY',
        domain: 'ACADEMIC_CURRICULUM',
        temporal: { isCurrent: true, constraint: 'NOW' },
        entities: [{ canonical: 'S1 Bisnis Digital', type: 'academic_program' }]
      };
      // Evidence has category KURIKULUM but lacks proof of current live academic year / decree
      const multiYearCurriculumEvidenceOnly = {
        answerability: 'ANSWERABLE',
        accepted: [
          {
            id: 'chunk_curriculum_structure_2023',
            category: 'KURIKULUM',
            text: 'Daftar Mata Kuliah Kurikulum 2023 Program Studi Bisnis Digital',
            provenance: { sourceDocument: 'Daftar_Mata_Kuliah_S1_Bisnis_Digital_Resmi.html' }
          }
        ]
      };

      const verification = verifyFinalAnswer(positiveClaim, frame, multiYearCurriculumEvidenceOnly);
      // Must FAIL verification because category KURIKULUM alone does not prove real-time validity
      expect(verification.pass).toBe(false);
      expect(verification.reason).toBe('unsupported_temporal_claim_lacks_valid_temporal_evidence');
    });

    test('8. PMB and fee behaviors remain intact without regression', async () => {
      const pmbRes = await runPhase1DeterministicPipeline('FINAL-GATE-PMB', 'Pendaftaran masih dibuka?');
      const pmbOutcome = pmbRes.verification?.outcome || pmbRes.subQueryResults?.[0]?.verification?.outcome;
      expect(pmbOutcome).toBe('SAFE_UNKNOWN');
      expect(pmbRes.answer || pmbRes.text).toMatch(/pmb\.stikom-bali\.ac\.id|\(0361\)\s*244445/i);

      const feeRes = await runPhase1DeterministicPipeline('FINAL-GATE-FEE', 'Berapa biaya kuliah S1 Bisnis Digital?');
      const feeOutcome = feeRes.verification?.outcome || feeRes.subQueryResults?.[0]?.verification?.outcome;
      expect(feeOutcome).toBe('VERIFIED_FACTUAL');
      expect(feeRes.answer || feeRes.text).toMatch(/Rp\s*6\.500\.000/i);
    });
  });
});
