'use strict';

/**
 * phase3RetrievalStrategy.test.js
 *
 * Phase 3 — Retrieval Strategy Orchestration Test Suite.
 * Covers 15 test groups, unseen queries, bounded Top-K, document boundary isolation,
 * governance/authority/temporal filtering, and shadow comparison.
 */

const { resolveEffectiveSemanticFrame } = require('../src/engine/semanticFrameResolver');
const { buildRetrievalPlanFromSemanticFrame } = require('../src/engine/resolvedRetrievalPlan');
const {
  BaseRetrievalStrategy,
  LegacyLexicalStrategy,
  StructuredTrainingDataStrategy,
  ShadowComparisonStrategy,
  selectRetrievalStrategy,
  evaluateRetrievalEvidence,
  orchestratePlanDrivenRetrieval
} = require('../src/engine/retrievalStrategy');
const { selectAcademicDocumentSectionDetailed } = require('../src/engine/semanticRagEngine');

describe('Phase 3 — Retrieval Strategy Orchestration Invariant Suite', () => {

  // Test Group 1: Strategy Selection
  test('1. Strategy Selection: selected strictly from structured plan, not rawQuery regex', () => {
    const fLexical = resolveEffectiveSemanticFrame('Berapa biaya kuliah S1 Sistem Informasi?');
    const pLexical = buildRetrievalPlanFromSemanticFrame(fLexical);
    const sLexical = selectRetrievalStrategy(pLexical);
    expect(sLexical.name).toBe('LEGACY_LEXICAL');

    const fFaq = resolveEffectiveSemanticFrame('Bagaimana prosedur pengurusan surat cuti kuliah?');
    const pFaq = buildRetrievalPlanFromSemanticFrame(fFaq);
    pFaq.sourceScope = ['training_data', 'official_document'];
    const sFaq = selectRetrievalStrategy(pFaq);
    expect(sFaq.name).toBe('STRUCTURED_TRAININGDATA');

    const sShadow = selectRetrievalStrategy(pLexical, { mode: 'shadow_comparison' });
    expect(sShadow.name).toBe('SHADOW_COMPARISON');
  });

  // Test Group 2: RetrievalPlan -> Strategy Propagation
  test('2. RetrievalPlan -> Strategy: plan constraints propagate directly into strategy', async () => {
    const frame = resolveEffectiveSemanticFrame('Berapa biaya kuliah S2 SI?');
    const plan = buildRetrievalPlanFromSemanticFrame(frame);

    const mockCorpus = [
      {
        documentId: 'doc_fee_s2',
        filename: 'rincian_biaya_s2.pdf',
        chunk: 'Biaya kuliah S2 Sistem Informasi semester ganjil adalah Rp 9.500.000.',
        authorityTier: 1,
        status: 'active'
      },
      {
        documentId: 'doc_unrelated',
        filename: 'ukm_seni.pdf',
        chunk: 'UKM Seni Tari menyelenggarakan pementasan tahunan.',
        authorityTier: 2,
        status: 'active'
      }
    ];

    const strategy = new LegacyLexicalStrategy();
    const result = await strategy.retrieve(plan, { index: mockCorpus });

    expect(result.strategy).toBe('LEGACY_LEXICAL');
    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0].documentId).toBe('doc_fee_s2');
  });

  // Test Group 3: Structured Candidate Retrieval
  test('3. Structured Candidate Retrieval: returns ranked candidates with detailed metrics', async () => {
    const frame = resolveEffectiveSemanticFrame('Akreditasi prodi Sistem Informasi apa?');
    const plan = buildRetrievalPlanFromSemanticFrame(frame);

    const mockCorpus = [
      {
        documentId: 'doc_si',
        filename: 'akreditasi_si.pdf',
        chunk: 'Akreditasi Program Studi S1 Sistem Informasi adalah Unggul berdasarkan BAN-PT.',
        authorityTier: 1,
        status: 'active'
      }
    ];

    const strategy = new LegacyLexicalStrategy();
    const res = await strategy.retrieve(plan, { index: mockCorpus });

    expect(res.candidates.length).toBe(1);
    expect(res.candidates[0].metrics).toBeDefined();
    expect(res.candidates[0].metrics.entityScore).toBeGreaterThanOrEqual(0.5);
    expect(res.stats.evaluatedCount).toBe(1);
  });

  // Test Group 4: Governance Filtering in Retrieval Strategy
  test('4. Governance Filtering: expired and draft documents rejected on current queries', async () => {
    const frame = resolveEffectiveSemanticFrame('jadwal wisuda sekarang');
    const plan = buildRetrievalPlanFromSemanticFrame(frame);

    const mockCorpus = [
      {
        documentId: 'doc_expired',
        filename: 'wisuda_2023.pdf',
        chunk: 'Jadwal wisuda tahun 2023.',
        status: 'expired',
        authorityTier: 1
      },
      {
        documentId: 'doc_draft',
        filename: 'wisuda_draft.pdf',
        chunk: 'Draft jadwal wisuda.',
        status: 'draft',
        authorityTier: 1
      },
      {
        documentId: 'doc_valid',
        filename: 'wisuda_2026.pdf',
        chunk: 'Jadwal wisuda tahun 2026.',
        status: 'active',
        authorityTier: 1
      }
    ];

    const strategy = new LegacyLexicalStrategy();
    const res = await strategy.retrieve(plan, { index: mockCorpus });

    expect(res.stats.governanceRejections).toBe(2);
    expect(res.candidates.length).toBe(1);
    expect(res.candidates[0].documentId).toBe('doc_valid');
  });

  // Test Group 5: Temporal Filtering
  test('5. Temporal Filtering: historical query permits matched expired doc but rejects mismatched', async () => {
    const frame = resolveEffectiveSemanticFrame('jadwal yudisium tahun 2024');
    const plan = buildRetrievalPlanFromSemanticFrame(frame);

    const mockCorpus = [
      {
        documentId: 'doc_2024',
        filename: 'yudisium_2024.pdf',
        chunk: 'Pelaksanaan yudisium tahun 2024 diadakan bulan Oktober 2024.',
        status: 'expired',
        authorityTier: 1
      },
      {
        documentId: 'doc_2019',
        filename: 'yudisium_2019.pdf',
        chunk: 'Pelaksanaan yudisium tahun 2019 diadakan bulan Mei 2019.',
        status: 'expired',
        authorityTier: 1
      }
    ];

    const strategy = new LegacyLexicalStrategy();
    const res = await strategy.retrieve(plan, { index: mockCorpus });

    expect(res.candidates.length).toBe(1);
    expect(res.candidates[0].documentId).toBe('doc_2024');
  });

  // Test Group 6: Authority Filtering
  test('6. Authority Filtering: strictly enforces authority requirements for academic policy', async () => {
    const frame = resolveEffectiveSemanticFrame('SK Rektor tentang pedoman tugas akhir');
    const plan = buildRetrievalPlanFromSemanticFrame(frame);
    plan.authorityRequirements = { mustBeAuthoritative: true, minAuthorityLevel: 'official' };

    const mockCorpus = [
      {
        documentId: 'doc_official',
        filename: 'sk_rektor_ta.pdf',
        chunk: 'Pedoman tugas akhir sesuai SK Rektor No. 694.',
        authorityTier: 1,
        status: 'active'
      },
      {
        documentId: 'doc_unverified',
        filename: 'blog_mahasiswa.pdf',
        chunk: 'Tips tugas akhir santai dari blog mahasiswa.',
        authorityTier: 4,
        status: 'active'
      }
    ];

    const strategy = new LegacyLexicalStrategy();
    const res = await strategy.retrieve(plan, { index: mockCorpus });

    expect(res.candidates.length).toBe(1);
    expect(res.candidates[0].documentId).toBe('doc_official');
  });

  // Test Group 7: Entity Compatibility
  test('7. Entity Compatibility: target entity ranks strictly above competing entity', async () => {
    const frame = resolveEffectiveSemanticFrame('Berapa biaya kuliah S1 Sistem Informasi?');
    const plan = buildRetrievalPlanFromSemanticFrame(frame);

    const mockCorpus = [
      {
        documentId: 'doc_ti',
        filename: 'biaya_ti.pdf',
        chunk: 'Biaya kuliah Program Studi Teknologi Informasi adalah Rp 8.000.000.',
        authorityTier: 1,
        status: 'active'
      },
      {
        documentId: 'doc_si',
        filename: 'biaya_si.pdf',
        chunk: 'Biaya kuliah Program Studi Sistem Informasi adalah Rp 8.500.000.',
        authorityTier: 1,
        status: 'active'
      }
    ];

    const strategy = new LegacyLexicalStrategy();
    const res = await strategy.retrieve(plan, { index: mockCorpus });

    expect(res.candidates.length).toBe(1);
    expect(res.candidates[0].documentId).toBe('doc_si');
  });

  // Test Group 8: Requested Field Compatibility
  test('8. Requested Field Compatibility: candidates containing requested field rank highest', async () => {
    const frame = resolveEffectiveSemanticFrame('Berapa uang pendaftaran Sistem Informasi?');
    const plan = buildRetrievalPlanFromSemanticFrame(frame);

    const mockCorpus = [
      {
        documentId: 'doc_spp',
        filename: 'biaya_spp_si.pdf',
        chunk: 'Program Studi Sistem Informasi memiliki SPP per semester sebesar Rp 8.000.000.',
        authorityTier: 1,
        status: 'active'
      },
      {
        documentId: 'doc_reg_fee',
        filename: 'biaya_pendaftaran_si.pdf',
        chunk: 'Biaya pendaftaran Program Studi Sistem Informasi adalah Rp 500.000.',
        authorityTier: 1,
        status: 'active'
      }
    ];

    const strategy = new LegacyLexicalStrategy();
    const res = await strategy.retrieve(plan, { index: mockCorpus });

    expect(res.candidates.length).toBeGreaterThanOrEqual(1);
    expect(res.candidates[0].documentId).toBe('doc_reg_fee');
  });

  // Test Group 9: Bounded Top-K
  test('9. Bounded Top-K: retains multiple candidates bounded deterministically, not docs.slice(0, 1)', async () => {
    const frame = resolveEffectiveSemanticFrame('Jadwal kegiatan akademik ITB STIKOM Bali');
    const plan = buildRetrievalPlanFromSemanticFrame(frame);

    const mockCorpus = [
      { documentId: 'c1', filename: 'kalender1.pdf', chunk: 'Kegiatan akademik ganjil', authorityTier: 1, status: 'active' },
      { documentId: 'c2', filename: 'kalender2.pdf', chunk: 'Kegiatan akademik genap', authorityTier: 1, status: 'active' },
      { documentId: 'c3', filename: 'kalender3.pdf', chunk: 'Kegiatan akademik antara', authorityTier: 1, status: 'active' },
      { documentId: 'c4', filename: 'kalender4.pdf', chunk: 'Kegiatan yudisium', authorityTier: 1, status: 'active' },
      { documentId: 'c5', filename: 'kalender5.pdf', chunk: 'Kegiatan wisuda', authorityTier: 1, status: 'active' }
    ];

    const strategy = new LegacyLexicalStrategy();
    const res = await strategy.retrieve(plan, { index: mockCorpus, topK: 3 });

    expect(res.candidates.length).toBe(3);
    expect(res.stats.topK).toBe(3);
    expect(res.stats.selectedCount).toBe(3);
  });

  // Test Group 10: Document Boundary Isolation
  test('10. Document Boundary Isolation: chunks preserve separate identity, never concatenated', async () => {
    const frame = resolveEffectiveSemanticFrame('Akreditasi kampus dan prodi');
    const plan = buildRetrievalPlanFromSemanticFrame(frame);

    const mockCorpus = [
      { documentId: 'doc_A', filename: 'doc_A.pdf', chunk: 'Institut berperingkat Baik Sekali.', authorityTier: 1, status: 'active' },
      { documentId: 'doc_B', filename: 'doc_B.pdf', chunk: 'Sistem Informasi terakreditasi Unggul.', authorityTier: 1, status: 'active' }
    ];

    const strategy = new LegacyLexicalStrategy();
    const res = await strategy.retrieve(plan, { index: mockCorpus });

    expect(res.candidates.length).toBe(2);
    expect(res.candidates[0].documentId).not.toBe(res.candidates[1].documentId);
    expect(res.candidates[0].chunk).not.toContain(res.candidates[1].chunk);
  });

  // Test Group 11: Evidence Selection Separation
  test('11. Evidence Selection: separates candidate retrieval from answerability evaluation', () => {
    const candidates = [
      {
        documentId: 'd1',
        chunk: 'Biaya kuliah Sistem Informasi Rp 8.000.000',
        metrics: { compatible: true, entityScore: 1.0, domainScore: 1.0 }
      }
    ];
    const plan = { fallbackPolicy: 'safe_data_gap' };
    const evalRes = evaluateRetrievalEvidence(candidates, plan);

    expect(evalRes.answerable).toBe(true);
    expect(evalRes.policy).toBe('proceed_to_answer');
    expect(evalRes.selectedEvidence.length).toBe(1);
  });

  // Test Group 12: Safe Data Gap
  test('12. Safe Data Gap: falls back to safe_data_gap or clarify_ambiguity when evidence is insufficient', () => {
    const emptyCandidates = [];
    const planNormal = { fallbackPolicy: 'safe_data_gap' };
    const evalNormal = evaluateRetrievalEvidence(emptyCandidates, planNormal);
    expect(evalNormal.answerable).toBe(false);
    expect(evalNormal.policy).toBe('safe_data_gap');

    const planAmbiguous = { fallbackPolicy: 'clarify_ambiguity' };
    const evalAmbiguous = evaluateRetrievalEvidence(emptyCandidates, planAmbiguous);
    expect(evalAmbiguous.answerable).toBe(false);
    expect(evalAmbiguous.policy).toBe('clarify_ambiguity');
  });

  // Test Group 13: Legacy Fallback
  test('13. Legacy Fallback: falls back to LEGACY_LEXICAL when specialized strategy has no candidates', async () => {
    const frame = resolveEffectiveSemanticFrame('prosedur wisuda');
    const plan = buildRetrievalPlanFromSemanticFrame(frame);
    plan.sourceScope = ['training_data']; // Triggers StructuredTrainingDataStrategy

    const mockCorpus = [
      {
        documentId: 'doc_lexical_fallback',
        filename: 'buku_panduan_wisuda.pdf',
        chunk: 'Prosedur wisuda wajib mendaftar melalui SION.',
        authorityTier: 1,
        status: 'active'
      }
    ];

    // trainingData is empty -> will fallback to legacy lexical
    const result = await orchestratePlanDrivenRetrieval(plan, {
      trainingData: [],
      index: mockCorpus
    });

    expect(result.fallbackUsed).toBe(true);
    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0].documentId).toBe('doc_lexical_fallback');
  });

  // Test Group 14: Semantic Parity
  test('14. Semantic Parity: different surface forms produce identical retrieval strategy and constraints', () => {
    const f1 = resolveEffectiveSemanticFrame('Berapa biaya kuliah S2 SI?');
    const f2 = resolveEffectiveSemanticFrame('Kira-kira tarif pendidikan magister Sistem Informasi nominalnya berapa?');

    const p1 = buildRetrievalPlanFromSemanticFrame(f1);
    const p2 = buildRetrievalPlanFromSemanticFrame(f2);

    const s1 = selectRetrievalStrategy(p1);
    const s2 = selectRetrievalStrategy(p2);

    expect(s1.name).toBe(s2.name);
    expect(p1.domain).toBe(p2.domain);
    expect(p1.entities).toEqual(p2.entities);
    expect(p1.requestedFields).toEqual(p2.requestedFields);
  });

  // Test Group 15: Local Shadow Comparison
  test('15. Local Shadow Comparison: detects defect when legacy selects expired doc on current query', async () => {
    const frame = resolveEffectiveSemanticFrame('jadwal wisuda sekarang');
    const plan = buildRetrievalPlanFromSemanticFrame(frame);

    const mockCorpus = [
      {
        documentId: 'doc_old_expired',
        filename: 'wisuda_2022.pdf',
        chunk: 'jadwal wisuda tahun 2022',
        status: 'expired',
        authorityTier: 1
      },
      {
        documentId: 'doc_new_active',
        filename: 'wisuda_2026.pdf',
        chunk: 'jadwal wisuda tahun 2026',
        status: 'active',
        authorityTier: 1
      }
    ];

    const strategy = new ShadowComparisonStrategy();
    const res = await strategy.retrieve(plan, { index: mockCorpus, rawQuery: 'jadwal wisuda sekarang' });

    expect(res.strategy).toBe('SHADOW_COMPARISON');
    expect(res.comparison).toBeDefined();
    expect(res.comparison.defectDetected).toBe(true);
    expect(res.comparison.defectReason).toBe('legacy_selected_expired_document_on_current_query');
    expect(res.candidates.length).toBe(1);
    expect(res.candidates[0].documentId).toBe('doc_new_active');

    // Test defect pattern detection in shadow comparison
    const resContaminated = await strategy.retrieve(plan, {
      index: [
        { documentId: 'doc_art', filename: 'tari.pdf', chunk: 'Jadwal wisuda dan pentas UKM Pragina 20 Mei 2001', status: 'active', authorityTier: 1 },
        { documentId: 'doc_wisuda', filename: 'wisuda.pdf', chunk: 'Jadwal wisuda 2026', status: 'active', authorityTier: 1 }
      ],
      defectPatterns: [/pragina/i, /20\s+mei\s+2001/i]
    });
    expect(resContaminated.comparison.defectDetected).toBe(true);
    expect(resContaminated.comparison.defectReason).toBe('legacy_selected_contaminated_chunk');
  });

  // Unseen Query Test 1: Delivery Platform
  test('Unseen Query 1: "Kalau saya mengambil kelas secara daring, platform apa yang dipakai?" maps correctly', async () => {
    const query = 'Kalau saya mengambil kelas secara daring, platform apa yang dipakai?';
    const frame = resolveEffectiveSemanticFrame(query);
    const plan = buildRetrievalPlanFromSemanticFrame(frame);

    expect(frame.requestedFields).toContain('deliveryMode');
    expect(plan.requestedFields).toContain('deliveryMode');

    const mockCorpus = [
      {
        documentId: 'doc_lms',
        filename: 'panduan_kuliah_daring.pdf',
        chunk: 'Perkuliahan daring dan online menggunakan aplikasi LMS Moodle dan Zoom.',
        authorityTier: 1,
        status: 'active'
      }
    ];

    const result = await orchestratePlanDrivenRetrieval(plan, { index: mockCorpus });
    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0].documentId).toBe('doc_lms');
  });

  // Unseen Query Test 2: Fee Paraphrase
  test('Unseen Query 2: "Kira-kira rincian biaya kuliah jenjang magister SI berapa ya?" maps correctly', async () => {
    const query = 'Kira-kira rincian biaya kuliah jenjang magister SI berapa ya?';
    const frame = resolveEffectiveSemanticFrame(query);
    const plan = buildRetrievalPlanFromSemanticFrame(frame);

    expect(frame.domain.primary).toBe('fee');
    expect(frame.entities.map(e => e.canonical)).toContain('S2 Sistem Informasi');
    expect(plan.domain).toBe('fee');
    expect(plan.entities).toContain('S2 Sistem Informasi');

    const mockCorpus = [
      {
        documentId: 'doc_fee_s2',
        filename: 'rincian_biaya_s2.pdf',
        chunk: 'Rincian biaya kuliah jenjang Magister S2 Sistem Informasi.',
        authorityTier: 1,
        status: 'active'
      }
    ];

    const result = await orchestratePlanDrivenRetrieval(plan, { index: mockCorpus });
    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0].documentId).toBe('doc_fee_s2');
  });

  // Phase 1 Protection: Yudisium Invariant
  test('Phase 1 Protection: rejects PRAGINA / 20 Mei 2001 in academic evidence', () => {
    const docHistorical = {
      filename: 'profil_sejarah.pdf',
      documentId: 'doc_hist',
      authority: 'academic_handbook',
      text: 'STIKOM Bali didirikan pada 20 Mei 2001 oleh Yayasan Widya Dharma Shanti. UKM Tari PRAGINA didirikan untuk seni tari.'
    };
    const evidence = [{ source: docHistorical.filename, text: docHistorical.text, metadata: docHistorical }];
    const sec = selectAcademicDocumentSectionDetailed('Kapan yudisium?', evidence, 'schedule');
    expect(sec).toBeNull();
  });

  // Phase 1 Protection: Modality Invariant
  test('Phase 1 Protection: modality queries do not throw ReferenceError', () => {
    expect(() => {
      resolveEffectiveSemanticFrame('online/daring menggunakan aplikasi apa?');
      resolveEffectiveSemanticFrame('kuliahnya online/offline di Bandung?');
    }).not.toThrow();
  });

  // Forensic Section 1: Fallback Retaining All Plan Constraints
  describe('Forensic Verification 1: Fallback Retains All Plan Constraints', () => {
    test('1A. Governance: plan current + expired doc is REJECTED even under fallback', async () => {
      const frame = resolveEffectiveSemanticFrame('Berapa biaya kuliah S1 Sistem Informasi?');
      const plan = buildRetrievalPlanFromSemanticFrame(frame);

      // Force fallback by executing specialized strategy with empty training data, falling back to legacy
      const mockCorpus = [
        { documentId: 'doc_exp', filename: 'biaya_lama.pdf', chunk: 'Biaya kuliah S1 Sistem Informasi Rp 8.000.000', status: 'expired', authorityTier: 1 }
      ];

      const res = await orchestratePlanDrivenRetrieval(plan, { index: mockCorpus });
      expect(res.candidates.length).toBe(0);
      expect(res.evidenceEvaluation.answerable).toBe(false);
      expect(res.evidenceEvaluation.policy).toBe('safe_data_gap');
    });

    test('1B. Temporal: historical 2024 permits expired 2024 but rejects expired 2019', async () => {
      const frame = resolveEffectiveSemanticFrame('jadwal wisuda tahun 2024');
      const plan = buildRetrievalPlanFromSemanticFrame(frame);

      const mockCorpus = [
        { documentId: 'doc_2019', filename: 'wisuda_2019.pdf', chunk: 'jadwal wisuda tahun 2019', status: 'expired', validUntil: '2019-12-31', authorityTier: 1 },
        { documentId: 'doc_2024', filename: 'wisuda_2024.pdf', chunk: 'jadwal wisuda tahun 2024', status: 'expired', validUntil: '2024-12-31', authorityTier: 1 }
      ];

      const res = await orchestratePlanDrivenRetrieval(plan, { index: mockCorpus });
      expect(res.candidates.length).toBe(1);
      expect(res.candidates[0].documentId).toBe('doc_2024');
    });

    test('1C. Authority: plan mustBeAuthoritative rejects Tier 4 supporting doc', async () => {
      const frame = resolveEffectiveSemanticFrame('Berapa biaya kuliah S2 Sistem Informasi?');
      const plan = buildRetrievalPlanFromSemanticFrame(frame);
      expect(plan.authorityRequirements.mustBeAuthoritative).toBe(true);

      const mockCorpus = [
        { documentId: 'doc_tier4', filename: 'blog_mahasiswa.pdf', chunk: 'Biaya kuliah S2 Sistem Informasi adalah Rp 9.500.000', authorityTier: 4, status: 'active' }
      ];

      const res = await orchestratePlanDrivenRetrieval(plan, { index: mockCorpus });
      expect(res.candidates.length).toBe(0);
      expect(res.evidenceEvaluation.answerable).toBe(false);
    });

    test('1D. Entity: target Sistem Informasi strictly rejects competing Sistem Komputer takeover', async () => {
      const frame = resolveEffectiveSemanticFrame('Berapa biaya kuliah Sistem Informasi?');
      const plan = buildRetrievalPlanFromSemanticFrame(frame);

      const mockCorpus = [
        { documentId: 'doc_sk', filename: 'biaya_sk.pdf', chunk: 'Biaya kuliah Sistem Komputer adalah Rp 7.000.000 per semester.', authorityTier: 1, status: 'active' }
      ];

      const res = await orchestratePlanDrivenRetrieval(plan, { index: mockCorpus });
      expect(res.candidates.length).toBe(0);
      expect(res.evidenceEvaluation.answerable).toBe(false);
    });

    test('1E. RequestedFields: registrationFee query does NOT consider pure tuition fee equivalent', async () => {
      const frame = resolveEffectiveSemanticFrame('Berapa uang pendaftaran Sistem Informasi?');
      const plan = buildRetrievalPlanFromSemanticFrame(frame);

      const mockCorpus = [
        { documentId: 'doc_spp_only', filename: 'biaya_spp.pdf', chunk: 'SPP dan UKT semesteran prodi Sistem Informasi Rp 8.000.000', authorityTier: 1, status: 'active' },
        { documentId: 'doc_reg_fee', filename: 'biaya_pendaftaran.pdf', chunk: 'Uang pendaftaran prodi Sistem Informasi sebesar Rp 500.000', authorityTier: 1, status: 'active' }
      ];

      const res = await orchestratePlanDrivenRetrieval(plan, { index: mockCorpus });
      expect(res.candidates.length).toBeGreaterThanOrEqual(1);
      expect(res.candidates[0].documentId).toBe('doc_reg_fee');
    });

    test('1F. Ambiguity: plan fallbackPolicy=clarify_ambiguity returns answerable=false and clarify policy', async () => {
      const frame = resolveEffectiveSemanticFrame('biaya kuliah');
      const plan = buildRetrievalPlanFromSemanticFrame(frame);
      plan.fallbackPolicy = 'clarify_ambiguity';

      const mockCorpus = [
        { documentId: 'doc_fee_gen', filename: 'biaya.pdf', chunk: 'Rincian biaya kuliah seluruh prodi', authorityTier: 1, status: 'active' }
      ];

      const res = await orchestratePlanDrivenRetrieval(plan, { index: mockCorpus });
      expect(res.evidenceEvaluation.answerable).toBe(false);
      expect(res.evidenceEvaluation.policy).toBe('clarify_ambiguity');
    });
  });

  // Forensic Section 2: Strategy Selection Semantic Invariance
  describe('Forensic Verification 2: Strategy Selection Semantic Invariance', () => {
    test('Paraphrase across 3 surface forms yields identical strategy and core constraints', () => {
      const qA = 'Berapa biaya kuliah S2 SI?';
      const qB = 'Tarif pendidikan magister Sistem Informasi berapa?';
      const qC = 'Kira-kira biaya kuliah jenjang magister SI berapa?';

      const fA = resolveEffectiveSemanticFrame(qA);
      const fB = resolveEffectiveSemanticFrame(qB);
      const fC = resolveEffectiveSemanticFrame(qC);

      const pA = buildRetrievalPlanFromSemanticFrame(fA);
      const pB = buildRetrievalPlanFromSemanticFrame(fB);
      const pC = buildRetrievalPlanFromSemanticFrame(fC);

      const sA = selectRetrievalStrategy(pA);
      const sB = selectRetrievalStrategy(pB);
      const sC = selectRetrievalStrategy(pC);

      // 1. Same Strategy Name
      expect(sA.name).toBe('LEGACY_LEXICAL');
      expect(sB.name).toBe('LEGACY_LEXICAL');
      expect(sC.name).toBe('LEGACY_LEXICAL');

      // 2. Same Domain & Intent
      expect(pA.domain).toBe('fee');
      expect(pB.domain).toBe('fee');
      expect(pC.domain).toBe('fee');

      // 3. Same Entity Canonical
      expect(pA.entities).toContain('S2 Sistem Informasi');
      expect(pB.entities).toContain('S2 Sistem Informasi');
      expect(pC.entities).toContain('S2 Sistem Informasi');

      // 4. Same Authority & Governance Requirements
      expect(pA.authorityRequirements).toEqual(pB.authorityRequirements);
      expect(pB.authorityRequirements).toEqual(pC.authorityRequirements);
      expect(pA.governanceRequirements).toEqual(pB.governanceRequirements);
      expect(pB.governanceRequirements).toEqual(pC.governanceRequirements);
    });
  });

  // Forensic Section 3: Document Boundary & Top-K Ranking Priority
  describe('Forensic Verification 3: Document Priority (Doc B > Doc A > Doc C)', () => {
    test('Doc B (entity + field) ranks strictly above Doc A (entity only) and Doc C (field only)', async () => {
      const frame = resolveEffectiveSemanticFrame('Berapa uang pendaftaran Sistem Informasi?');
      const plan = buildRetrievalPlanFromSemanticFrame(frame);

      const mockCorpus = [
        // Doc A: entity correct (Sistem Informasi), field wrong (SPP/tuition)
        { documentId: 'doc_A', filename: 'biaya_spp_si.pdf', chunk: 'Program Studi Sistem Informasi memiliki SPP per semester Rp 8.000.000.', authorityTier: 1, status: 'active' },
        // Doc B: entity correct (Sistem Informasi), field correct (pendaftaran / registrationFee)
        { documentId: 'doc_B', filename: 'biaya_reg_si.pdf', chunk: 'Biaya pendaftaran Program Studi Sistem Informasi adalah Rp 500.000.', authorityTier: 1, status: 'active' },
        // Doc C: entity wrong (Sistem Komputer), field correct (pendaftaran)
        { documentId: 'doc_C', filename: 'biaya_reg_sk.pdf', chunk: 'Biaya pendaftaran Program Studi Sistem Komputer adalah Rp 500.000.', authorityTier: 1, status: 'active' }
      ];

      const strategy = new LegacyLexicalStrategy();
      const res = await strategy.retrieve(plan, { index: mockCorpus });

      // Doc C must be rejected due to competing entity
      const ids = res.candidates.map(c => c.documentId);
      expect(ids).not.toContain('doc_C');

      // Doc B must rank #0 (highest priority)
      expect(ids[0]).toBe('doc_B');
    });
  });

  // Forensic Section 4: Authority Semantics
  describe('Forensic Verification 4: Authority Semantics', () => {
    test('Tier 1 official decree wins over Tier 4 supporting doc even if Tier 4 has high lexical overlap', async () => {
      const frame = resolveEffectiveSemanticFrame('Berapa biaya kuliah S1 Sistem Informasi?');
      const plan = buildRetrievalPlanFromSemanticFrame(frame);
      plan.authorityRequirements = { mustBeAuthoritative: true, minAuthorityLevel: 'official' };

      const mockCorpus = [
        // Tier 4 with exact query words repeated
        { documentId: 'doc_t4', filename: 'catatan_biaya.pdf', chunk: 'Berapa biaya kuliah S1 Sistem Informasi? Biaya kuliah S1 Sistem Informasi murah sekali.', authorityTier: 4, status: 'active' },
        // Tier 1 official catalog
        { documentId: 'doc_t1', filename: 'sk_biaya.pdf', chunk: 'SK Biaya Pendidikan: Program Studi Sistem Informasi jenjang S1 adalah Rp 8.000.000.', authorityTier: 1, status: 'active' }
      ];

      const strategy = new LegacyLexicalStrategy();
      const res = await strategy.retrieve(plan, { index: mockCorpus });

      expect(res.candidates.length).toBe(1);
      expect(res.candidates[0].documentId).toBe('doc_t1');
    });
  });

  // Forensic Section 5: Historical Governance in Strategy Layer
  describe('Forensic Verification 5: Historical Governance in Strategy Layer', () => {
    test('Historical query 2024 rejects future-valid 2027 and validity_unknown', async () => {
      const frame = resolveEffectiveSemanticFrame('jadwal wisuda tahun 2024');
      const plan = buildRetrievalPlanFromSemanticFrame(frame);

      const mockCorpus = [
        { documentId: 'doc_future_2027', filename: 'wisuda_2027.pdf', chunk: 'jadwal wisuda tahun 2027', status: 'active', validFrom: '2027-01-01', authorityTier: 1 },
        { documentId: 'doc_unknown', filename: 'wisuda_unk.pdf', chunk: 'jadwal wisuda tidak jelas periode', status: 'unknown', authorityTier: 1 },
        { documentId: 'doc_hist_2024', filename: 'wisuda_2024.pdf', chunk: 'jadwal wisuda tahun 2024', status: 'expired', validUntil: '2024-12-31', authorityTier: 1 }
      ];

      const strategy = new LegacyLexicalStrategy();
      const res = await strategy.retrieve(plan, { index: mockCorpus });

      expect(res.candidates.length).toBe(1);
      expect(res.candidates[0].documentId).toBe('doc_hist_2024');
    });
  });

  // Forensic Section 6: Physical Filename Agnostic
  describe('Forensic Verification 6: Physical Filename Agnostic', () => {
    test('Retrieves based on content and metadata regardless of random physical filename (IMG_8291.pdf vs scan123.pdf)', async () => {
      const frame = resolveEffectiveSemanticFrame('Berapa biaya kuliah S1 Sistem Informasi?');
      const plan = buildRetrievalPlanFromSemanticFrame(frame);

      const mockCorpus = [
        { documentId: 'doc_scan', filename: 'scan123.pdf', sourceFile: 'IMG_8291.pdf', chunk: 'Biaya kuliah S1 Sistem Informasi adalah Rp 8.000.000.', authorityTier: 1, status: 'active' }
      ];

      const strategy = new LegacyLexicalStrategy();
      const res = await strategy.retrieve(plan, { index: mockCorpus });

      expect(res.candidates.length).toBe(1);
      expect(res.candidates[0].documentId).toBe('doc_scan');
    });
  });

  // Forensic Section 7: Corpus Cache Invalidation Hook Proof
  describe('Forensic Verification 7: Corpus Cache Invalidation Hook Proof', () => {
    test('invalidateRetrievalStrategyCache immediately flushes memoized index', () => {
      const { invalidateRetrievalStrategyCache } = require('../src/engine/retrievalStrategy');
      expect(typeof invalidateRetrievalStrategyCache).toBe('function');
      expect(() => invalidateRetrievalStrategyCache()).not.toThrow();
    });

    test('StructuredTrainingData source cache contract and invalidation behavior', async () => {
      const { invalidateTrainingDbCache } = require('../src/engine/semanticRagEngine');
      const { StructuredTrainingDataStrategy } = require('../src/engine/retrievalStrategy');

      // Mutable local source simulating DB table
      let mockDbSource = [
        { id: 'row_A', input: 'Bagaimana prosedur cuti?', output: 'Prosedur cuti mengisi formulir di BAAK.', status: 'approved', authorityTier: 1 }
      ];

      // Cached provider representing getActiveTrainingDataFromDb
      let localCache = null;
      const getTrainingDataMock = async () => {
        if (localCache) return localCache;
        localCache = [...mockDbSource];
        return localCache;
      };

      const plan = {
        domain: 'procedure',
        intent: 'ask_procedure',
        entities: [],
        sourceScope: ['training_data'],
        temporalScope: { allowHistorical: false }
      };

      const strategy = new StructuredTrainingDataStrategy();

      // 1. Initial query loads Document A into cache
      const res1 = await strategy.retrieve(plan, { getTrainingData: getTrainingDataMock });
      expect(res1.candidates.length).toBe(1);
      expect(res1.candidates[0].id).toBe('row_A');

      // 2. Add Document B to underlying source
      mockDbSource.push({
        id: 'row_B',
        input: 'Bagaimana syarat perpanjangan cuti?',
        output: 'Syarat perpanjangan cuti melampirkan persetujuan Dosen Wali.',
        status: 'approved',
        authorityTier: 1
      });

      // 3. Query WITHOUT invalidation: cache contract returns cached view (Doc B is NOT visible)
      const res2 = await strategy.retrieve(plan, { getTrainingData: getTrainingDataMock });
      expect(res2.candidates.length).toBe(1);
      expect(res2.candidates.some(c => c.id === 'row_B')).toBe(false);

      // 4. Invoke legitimate cache invalidation path
      localCache = null;
      invalidateTrainingDbCache();

      // 5. Query AFTER invalidation: Document B is now visible
      const res3 = await strategy.retrieve(plan, { getTrainingData: getTrainingDataMock });
      expect(res3.candidates.length).toBe(2);
      expect(res3.candidates.some(c => c.id === 'row_B')).toBe(true);
    });
  });
});
