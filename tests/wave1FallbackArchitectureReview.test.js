'use strict';

/**
 * tests/wave1FallbackArchitectureReview.test.js
 *
 * Comprehensive Verification of Wave 1 Fallback Tightening:
 * 1. Model success -> Generic AI synthesis and normal verification.
 * 2. Model timeout/error -> Generic extractive fallback (no domain template).
 * 3. Circuit open/quota exhausted -> Generic extractive fallback (no domain template).
 * 4. Verifier rejection -> Handled via generic extractive or honest escalation without domain template recovery.
 * 5. Empty synthesis result -> Handled safely without calling domain template.
 * 6. Zero or irrelevant evidence -> SAFE_UNKNOWN without unsupported claims.
 * 7. Partial evidence -> Only available facts presented, missing aspects acknowledged.
 * 8. Numerical calculations -> Dedicated fee calculation engine functions accurately.
 * 9. Deduplication -> No duplicate contact or repeated paragraphs in extractive output.
 *
 * INVARIANT: buildGroundedDeterministicSummary() MUST NOT be called in failure/fallback paths for general domain queries!
 */

const groundedAnswerGenerator = require('../src/core/groundedAnswerGenerator');
const { synthesizeAnswer, buildGenericExtractiveFallback } = groundedAnswerGenerator;
const { runPhase1DeterministicPipeline } = require('../src/core/orchestrator');
const { VERIFICATION_OUTCOME } = require('../src/reasoning/contracts');

describe('Wave 1: Fallback Tightening Architecture (All 9 Invariants)', () => {
  let mockCreate;
  let mockAiEngine;
  let deterministicSummarySpy;

  beforeEach(() => {
    mockCreate = jest.fn();
    mockAiEngine = {
      apiKey: 'mock-key',
      model: 'gpt-4o-mini',
      client: {
        chat: {
          completions: {
            create: mockCreate
          }
        }
      }
    };
    deterministicSummarySpy = jest.spyOn(groundedAnswerGenerator, 'buildGroundedDeterministicSummary');
  });

  afterEach(() => {
    deterministicSummarySpy.mockRestore();
  });

  // Test 1: Model Success -> Generic AI Synthesis
  it('1. Model success: Normal path reaches generic AI synthesis and verifies clean', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'S1 Sistem Informasi berfokus pada integrasi proses bisnis dan teknologi informasi.' } }],
      usage: { prompt_tokens: 120, completion_tokens: 35 }
    });

    const frame = {
      rawQuery: 'Apa itu program studi S1 Sistem Informasi?',
      domain: 'ACADEMIC_PROGRAM',
      intent: 'DEFINITION',
      entities: [{ canonical: 'S1 Sistem Informasi', type: 'program' }]
    };
    const evidence = [
      { text: 'S1 Sistem Informasi membekali mahasiswa dengan kemampuan analisis proses bisnis dan sistem informasi enterprise.', source: 'kurikulum_si.pdf' }
    ];

    const result = await synthesizeAnswer(frame, {
      accepted: evidence,
      aiEngine: mockAiEngine
    });

    expect(result.success).toBe(true);
    expect(result.source).toBe('llm_grounded_synthesis');
    expect(result.answer).toContain('S1 Sistem Informasi');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(deterministicSummarySpy).not.toHaveBeenCalled();
  });

  // Test 2: Model Timeout / Network Error -> Generic Extractive Fallback
  it('2. Model timeout / network error: Uses generic extractive fallback without domain templates', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Network timeout (ETIMEDOUT) connecting to OpenAI'));

    const frame = {
      rawQuery: 'Apa saja fasilitas laboratorium komputer di kampus?',
      domain: 'FACILITIES',
      intent: 'FACILITY_INQUIRY',
      entities: []
    };
    const evidence = [
      { text: 'Laboratorium komputer kampus dilengkapi dengan perangkat modern untuk praktikum software engineering dan jaringan.', source: 'fasilitas.pdf' }
    ];

    const result = await synthesizeAnswer(frame, {
      accepted: evidence,
      aiEngine: mockAiEngine
    });

    expect(result.success).toBe(true);
    expect(result.source).toBe('generic_extractive_fallback');
    expect(result.isExtractive).toBe(true);
    expect(result.answer).toContain('Laboratorium komputer kampus');
    expect(result.llmError).toContain('ETIMEDOUT');
    expect(deterministicSummarySpy).not.toHaveBeenCalled();
  });

  // Test 3: Circuit Open / Quota Exhaustion -> Does NOT fall back to domain templates
  it('3. Circuit open / quota exhausted: Uses generic extractive fallback, not domain templates', async () => {
    const quotaError = new Error('You exceeded your current quota');
    quotaError.status = 429;
    mockCreate.mockRejectedValueOnce(quotaError);

    const frame = {
      rawQuery: 'Bagaimana ketentuan beasiswa prestasi?',
      domain: 'SCHOLARSHIP',
      intent: 'SCHOLARSHIP_INQUIRY',
      entities: []
    };
    const evidence = [
      { text: 'Beasiswa prestasi akademik diberikan kepada calon mahasiswa yang memiliki nilai rapor unggul atau sertifikat kejuaraan.', source: 'beasiswa.pdf' }
    ];

    const result = await synthesizeAnswer(frame, {
      accepted: evidence,
      aiEngine: mockAiEngine
    });

    expect(result.success).toBe(true);
    expect(result.source).toBe('generic_extractive_fallback');
    expect(result.isExtractive).toBe(true);
    expect(result.answer).toContain('Beasiswa prestasi akademik');
    expect(deterministicSummarySpy).not.toHaveBeenCalled();
  });

  // Test 4: Verifier Rejection -> Does NOT execute deterministic recovery via domain template
  it('4. Verifier rejection: Handled via generic extractive or honest escalation without template recovery', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Biaya kuliah gratis 100% untuk semua pendaftar baru hari ini!' } }]
    });

    const mockFailingVerifier = jest.fn().mockReturnValue({
      pass: false,
      outcome: VERIFICATION_OUTCOME.VERIFICATION_FAILED,
      reason: 'unsupported_hallucinated_claim'
    });

    const result = await runPhase1DeterministicPipeline('test_chat_verif', 'Apakah kuliah gratis?', {
      aiEngine: mockAiEngine,
      finalAnswerVerifier: mockFailingVerifier,
      sessionSnapshot: { data: {} }
    });

    expect(result).toBeDefined();
    expect(deterministicSummarySpy).not.toHaveBeenCalled();
    expect(result.verification?.handledSafely).toBe(true);
    expect(result.answer).not.toContain('gratis 100%');
  });

  // Test 5: Empty Synthesis Result -> Handled safely without calling domain template
  it('5. Empty synthesis result: Handled safely without calling domain template', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '   ' } }] // empty response
    });

    const frame = {
      rawQuery: 'Apa visi misi kampus?',
      domain: 'CAMPUS_SERVICE',
      intent: 'GENERAL_INFO',
      entities: []
    };
    const evidence = [
      { text: 'Visi ITB STIKOM Bali adalah menjadi perguruan tinggi bertaraf internasional di bidang teknologi informasi.', source: 'visi_misi.pdf' }
    ];

    const result = await synthesizeAnswer(frame, {
      accepted: evidence,
      aiEngine: mockAiEngine
    });

    expect(result.success).toBe(true);
    expect(result.answer).toContain('perguruan tinggi bertaraf internasional');
    expect(deterministicSummarySpy).not.toHaveBeenCalled();
  });

  // Test 6: Zero Evidence -> Produces SAFE_UNKNOWN without unsupported claims
  it('6. Zero evidence: Produces SAFE_UNKNOWN / guidance without unsupported claims', async () => {
    const frame = {
      rawQuery: 'Apakah ada jurusan Kedokteran Hewan?',
      domain: 'ACADEMIC_PROGRAM',
      intent: 'DEFINITION',
      entities: []
    };

    const result = await synthesizeAnswer(frame, {
      accepted: [],
      isUnanswerable: true,
      guidance: 'Mohon maaf Kak, informasi mengenai Kedokteran Hewan saat ini belum tercantum dalam panduan resmi ITB STIKOM Bali.'
    });

    expect(result.success).toBe(true);
    expect(result.source).toBe('unanswerable_natural_guidance');
    expect(result.answer).toContain('belum tercantum dalam panduan resmi');
    expect(deterministicSummarySpy).not.toHaveBeenCalled();
  });

  // Test 7: Partial Evidence -> Only available facts presented, missing aspects acknowledged
  it('7. Partial evidence: Presents verified facts and explicitly notes unverified aspects', () => {
    const frame = {
      rawQuery: 'Berapa biaya S1 TI dan apa prospek kerjanya?',
      domain: 'ACADEMIC_PROGRAM',
      intent: 'CURRICULUM_AND_FEE',
      entities: [{ canonical: 'S1 Teknologi Informasi', type: 'program' }]
    };
    const evidence = [
      { text: 'Lulusan S1 Teknologi Informasi memiliki prospek karir sebagai Software Engineer, Cloud Architect, dan Cybersecurity Analyst.', source: 'karir_ti.pdf' }
    ];

    const fallbackRes = buildGenericExtractiveFallback(frame, evidence, {
      missingAspects: ['fee']
    });

    expect(fallbackRes.success).toBe(true);
    expect(fallbackRes.source).toBe('generic_extractive_fallback');
    expect(fallbackRes.answer).toContain('Software Engineer');
    expect(fallbackRes.answer).toContain('rincian biaya');
    expect(fallbackRes.answer).toContain('belum tercantum dalam kutipan panduan resmi');
  });

  // Test 8: Technical Numerical Operation -> feeCalculationEngine runs cleanly
  it('8. Technical numerical operation: feeCalculationEngine computes numbers accurately', async () => {
    const frame = {
      rawQuery: 'Berapa rincian biaya kuliah S1 Bisnis Digital?',
      domain: 'TUITION_FEE',
      intent: 'TUITION_FEE_INQUIRY',
      aspects: ['fee', 'tuition'],
      entities: [{ canonical: 'S1 Bisnis Digital', type: 'program' }]
    };
    const evidence = [
      { text: 'Rincian biaya S1 Bisnis Digital: SPP Rp 1.650.000 per bulan, DPP Rp 26.000.000.', source: 'biaya_resmi.pdf' }
    ];

    const result = await synthesizeAnswer(frame, {
      accepted: evidence,
      sessionData: {}
    });

    expect(result.success).toBe(true);
    expect(result.source).toBe('fee_calculation_engine');
    expect(typeof result.answer).toBe('string');
    expect(result.answer).toContain('6.500.000');
    expect(deterministicSummarySpy).not.toHaveBeenCalled();
  });

  // Test 9: Deduplication -> No identical contact or sentences repeated in extractive output
  it('9. Deduplication: Extractive output cleans identical repeated sentences', () => {
    const frame = {
      rawQuery: 'Kontak resmi admisi?',
      language: 'id'
    };
    const duplicatedEvidence = [
      { text: 'Hubungi layanan resmi ITB STIKOM Bali di nomor (0361) 244445.', source: 'doc1.pdf' },
      { text: 'Hubungi layanan resmi ITB STIKOM Bali di nomor (0361) 244445.', source: 'doc2.pdf' },
      { text: 'Alamat kampus pusat Renon: Jl. Raya Puputan No. 86 Renon Denpasar.', source: 'doc3.pdf' }
    ];

    const res = buildGenericExtractiveFallback(frame, duplicatedEvidence);
    expect(res.success).toBe(true);
    const countPhone = (res.answer.match(/\(0361\) 244445/g) || []).length;
    expect(countPhone).toBe(1);
    expect(res.answer).toContain('Jl. Raya Puputan No. 86');
  });

  // Test 10: Academic Advising Failure -> Generic Safe Unknown without hardcoded advising paragraph
  it('10. Academic advising failure: Double synthesis & extraction failure returns generic safe unknown without hardcoded advising paragraph', async () => {
    const mockFailingSynth = jest.spyOn(groundedAnswerGenerator, 'synthesizeAnswer').mockResolvedValue({
      success: false,
      answer: null
    });
    const mockEmptyExtractive = jest.spyOn(groundedAnswerGenerator, 'buildGenericExtractiveFallback').mockReturnValue({
      success: false,
      answer: null
    });

    const query = 'Bagaimana prosedur bimbingan perwalian dengan dosen wali?';
    const advisingFrame = {
      rawQuery: query,
      normalizedQuery: query.toLowerCase(),
      domain: 'ACADEMIC_PROCESS',
      intent: 'ACADEMIC_ADVISING_INQUIRY',
      entities: []
    };

    const result = await runPhase1DeterministicPipeline('test_advising_fail', query, {
      semanticFrame: advisingFrame,
      sessionSnapshot: { data: {} }
    });

    mockFailingSynth.mockRestore();
    mockEmptyExtractive.mockRestore();

    expect(result).toBeDefined();
    // Invariant: Must NOT contain the hardcoded perwalian/Dosen Wali/KRS/BAAK template paragraph
    expect(result.answer).not.toMatch(/Bimbingan perwalian dengan Dosen Wali di ITB STIKOM Bali merupakan proses akademik wajib/i);
    expect(result.answer).not.toMatch(/penanganan keterlambatan perwalian maupun kontak bantuan teknis belum dapat dipastikan/i);
    // Invariant: Must return generic safe unknown
    expect(result.answer).toMatch(/belum dapat diverifikasi|belum tercantum/i);
    expect(result.verification?.outcome).toBe(VERIFICATION_OUTCOME.SAFE_UNKNOWN);
    expect(result.verification?.pass).toBe(false);
  });
});
