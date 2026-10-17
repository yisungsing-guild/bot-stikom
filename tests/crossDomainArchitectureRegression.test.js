'use strict';

/**
 * tests/crossDomainArchitectureRegression.test.js
 *
 * CHAT ENGINE V2 — CROSS-DOMAIN ARCHITECTURE REGRESSION SUITE
 *
 * Test-first suite establishing baseline behavioral invariants across the pipeline:
 * semanticFrameResolver (sync & async) -> contextResolver -> phase2Planner ->
 * retrievalPlanner -> evidenceArbiter -> answerabilityGate ->
 * groundedAnswerGenerator -> finalAnswerVerifier -> orchestrator.
 *
 * Invariants Verified:
 * Group A: Modality & Domain Decoupling (SEEK_ADVICE / DISCOVER_LIST must not collapse to prodi)
 * Group B: Aspect Domain Preservation (requirements, procedure, fee must preserve object domain)
 * Group C: Academic Degree Scoping (S1, D3, ALL bounds strictly maintained to generator output)
 * Group D: Context Isolation & Continuity (Prevent cross-domain entity leak while preserving anaphora)
 * Group E: Strict Grounding & Evidence Arbitration (Cross-domain chunk rejection & false topicality)
 * Group F: Multi-Intent & Cross-Lingual Generalization (Indonesian colloquial & English phrasing)
 * Group G: Asynchronous Model Resolution Path with Offline Stubs (Validate model parser override behavior)
 * Group H: Planner Execution Plan Alignment (RECOMMENDATION plan must only trigger for prodi fit)
 * Group I: Grounding Multi-Level Contract & Orchestrator Telemetry (Distinguish safe refusal from factual pass)
 */

const {
  resolveSemanticFrame,
  resolveSemanticFrameAsync
} = require('../src/core/semanticFrameResolver');
const {
  evaluateContextDependency,
  hasExplicitPronounReference,
  isGenuineEllipsis
} = require('../src/core/contextResolver');
const { buildExecutionPlan } = require('../src/reasoning/phase2Planner');
const { buildRetrievalPlan } = require('../src/core/retrievalPlanner');
const { arbitrateEvidence } = require('../src/core/evidenceArbiter');
const {
  evaluateAnswerability,
  ANSWERABILITY_STATUS
} = require('../src/core/answerabilityGate');
const {
  buildGroundedDeterministicSummary,
  synthesizeAnswer
} = require('../src/core/groundedAnswerGenerator');
const { verifyFinalAnswer } = require('../src/core/finalAnswerVerifier');
const { runPhase1DeterministicPipeline } = require('../src/core/orchestrator');
const { CAMPUS_WIDE_DOMAINS, VERIFICATION_OUTCOME, createShadowTelemetry } = require('../src/reasoning/contracts');
const { evaluateShadowTurn } = require('../src/reasoning/shadowEvaluator');

// Offline OpenAI client stub helper for testing resolveSemanticFrameAsync
function createMockModelClient(payload) {
  return {
    chat: {
      completions: {
        create: async () => ({
          choices: [{
            message: {
              content: JSON.stringify(payload)
            }
          }]
        })
      }
    }
  };
}

describe('Chat Engine V2 — Cross-Domain Architecture Regression Suite', () => {
  jest.setTimeout(60000);

  // =========================================================================
  // GROUP A: MODALITY & DOMAIN DECOUPLING (DETERMINISTIC)
  // Invariant: Advice-seeking (SEEK_ADVICE) and catalog discovery (DISCOVER_LIST)
  // must NOT automatically collapse the target domain into ACADEMIC_RECOMMENDATION
  // or ACADEMIC_PROGRAM catalog.
  // =========================================================================
  describe('Group A: Modality & Domain Decoupling', () => {

    test('A.1: UKM advice inquiry resolves to ORGANIZATION_UKM and non-prodi plan', () => {
      const query = 'Saya suka fotografi dan musik, ada UKM apa?';
      const frame = resolveSemanticFrame(query, {});

      // Invariant: Domain is student organization, not academic recommendation
      expect(frame.domain).toBe('ORGANIZATION_UKM');
      expect(frame.domain).not.toBe('ACADEMIC_RECOMMENDATION');

      const planResult = buildExecutionPlan(query, { activeDomain: frame.domain });
      expect(planResult.success).toBe(true);

      // Invariant: Planner does not force academic degree recommendation task
      if (planResult.plan.planType === 'RECOMMENDATION') {
        const requiredAspects = planResult.plan.tasks?.[0]?.requiredAspects || [];
        expect(requiredAspects).not.toContain('curriculum_fit');
      }
    });

    test('A.2: Scholarship advice inquiry preserves SCHOLARSHIP domain', () => {
      const query = 'Ada saran beasiswa untuk anak berprestasi?';
      const frame = resolveSemanticFrame(query, {});

      // Invariant: Domain must be SCHOLARSHIP, not ACADEMIC_RECOMMENDATION
      expect(frame.domain).toBe('SCHOLARSHIP');
      expect(frame.domain).not.toBe('ACADEMIC_RECOMMENDATION');
      expect(frame.intent).not.toBe('PROGRAM_RECOMMENDATION');

      const planResult = buildExecutionPlan(query, { activeDomain: frame.domain });
      expect(planResult.success).toBe(true);
      expect(planResult.plan.planType).not.toBe('RECOMMENDATION');
    });

    test('A.3: Business incubator discovery inquiry preserves CAMPUS_SERVICE domain', () => {
      const query = 'Layanan apa saja di inkubator bisnis STIKOM?';
      const frame = resolveSemanticFrame(query, {});

      // Invariant: Domain must identify campus service / incubator, NOT academic degree listing
      expect(frame.domain).toMatch(/CAMPUS_SERVICE|CAMPUS_LIFE|BUSINESS_INCUBATOR/i);
      expect(frame.intent).not.toBe('AVAILABLE_PROGRAMS_LIST');
    });

    test('A.4: Academic program discovery legitimately routes to AVAILABLE_PROGRAMS_LIST', () => {
      const query = 'Program studi apa saja yang tersedia?';
      const frame = resolveSemanticFrame(query, {});

      expect(frame.domain).toBe('ACADEMIC_PROGRAM');
      expect(frame.intent).toBe('AVAILABLE_PROGRAMS_LIST');

      const summary = buildGroundedDeterministicSummary(frame, [], {});
      expect(summary).toMatch(/Sistem Informasi/i);
      expect(summary).toMatch(/Teknologi Informasi/i);
      expect(summary).toMatch(/Sistem Komputer/i);
      expect(summary).toMatch(/Bisnis Digital/i);
    });
  });

  // =========================================================================
  // GROUP B: ASPECT DOMAIN PRESERVATION
  // Invariant: Generic aspects (requirements, procedure, fee) must maintain
  // the object domain instead of blindly redirecting to PMB or TUITION_FEE.
  // =========================================================================
  describe('Group B: Aspect Domain Preservation', () => {

    test('B.1: Scholarship requirements inquiry preserves SCHOLARSHIP domain', () => {
      const query = 'Apa syarat beasiswa KIP Kuliah?';
      const frame = resolveSemanticFrame(query, {});

      // Invariant: Domain must remain SCHOLARSHIP
      expect(frame.domain).toBe('SCHOLARSHIP');
      expect(frame.domain).not.toBe('PMB');
      expect(frame.intent).not.toBe('ADMISSION_REQUIREMENTS');
      expect(frame.aspects).toContain('requirements');
    });

    test('B.2: Incubator startup procedure preserves CAMPUS_SERVICE domain', () => {
      const query = 'Bagaimana prosedur inkubator bisnis untuk startup mahasiswa?';
      const frame = resolveSemanticFrame(query, {});

      // Invariant: Domain must remain campus service / incubator, not PMB
      expect(frame.domain).toMatch(/CAMPUS_SERVICE|BUSINESS_INCUBATOR/i);
      expect(frame.domain).not.toBe('PMB');
      expect(frame.intent).not.toBe('ADMISSION_PROCEDURE');
      expect(frame.aspects).not.toContain('admission_requirements');
    });

    test('B.3: Specific service fee does not collapse to general academic TUITION_FEE', () => {
      const query = 'Berapa biaya pendaftaran inkubator bisnis?';
      const frame = resolveSemanticFrame(query, {});

      // Invariant: Domain should NOT default to semester tuition (TUITION_FEE prodi)
      expect(frame.domain).not.toBe('TUITION_FEE');
      expect(frame.intent).not.toBe('TUITION_FEE_INQUIRY');
    });

    test('B.4: Genuine PMB requirements inquiry legitimately routes to PMB admission', () => {
      const query = 'Syarat pendaftaran mahasiswa baru reguler apa saja?';
      const frame = resolveSemanticFrame(query, {});

      expect(frame.domain).toMatch(/PMB|ADMISSION_TRACK/);
      expect(frame.intent).toMatch(/ADMISSION_REQUIREMENTS|ADMISSION_TRACK_INQUIRY/);
      expect(frame.aspects).toContain('requirements');
    });
  });

  // =========================================================================
  // GROUP C: ACADEMIC DEGREE SCOPING
  // Invariant: Explicit degree scope (S1, D3, ALL) must be strictly enforced
  // from semantic frame resolution through grounded answer output.
  // =========================================================================
  describe('Group C: Academic Degree Scoping', () => {

    test('C.1: S1 inquiry strictly produces only Bachelor (S1) programs', () => {
      const query = 'Program sarjana S1 yang tersedia apa saja?';
      const frame = resolveSemanticFrame(query, {});

      expect(frame.domain).toBe('ACADEMIC_PROGRAM');
      expect(frame.scopeLevel || frame.academicLevel).toBe('S1');

      const summary = buildGroundedDeterministicSummary(frame, [], {});
      expect(summary).toBeDefined();

      // Positive assertions: S1 programs must appear
      expect(summary).toMatch(/S1 Sistem Informasi/i);
      expect(summary).toMatch(/S1 Sistem Komputer/i);
      expect(summary).toMatch(/S1 Teknologi Informasi/i);
      expect(summary).toMatch(/S1 Bisnis Digital/i);

      // Strict negative assertions: Non-S1 programs MUST NOT appear
      expect(summary).not.toMatch(/D3\s+Manajemen\s+Informatika/i);
      expect(summary).not.toMatch(/S2\s+Magister/i);
      expect(summary).not.toMatch(/International\s+Dual\s+Degree/i);
    });

    test('C.2: D3 inquiry strictly produces only Diploma (D3) programs', () => {
      const query = 'Pilihan program diploma D3 apa saja?';
      const frame = resolveSemanticFrame(query, {});

      expect(frame.domain).toBe('ACADEMIC_PROGRAM');
      const effectiveScope = frame.scopeLevel || (frame.academicLevel === 'D3' ? 'D3' : 'ALL');
      expect(effectiveScope).toBe('D3');

      const summary = buildGroundedDeterministicSummary(frame, [], {});
      expect(summary).toBeDefined();

      // Positive assertions: D3 programs must appear
      expect(summary).toMatch(/D3 Manajemen Informatika/i);

      // Strict negative assertions: Non-D3 programs MUST NOT appear
      expect(summary).not.toMatch(/S1\s+Sistem\s+Informasi/i);
      expect(summary).not.toMatch(/S1\s+Sistem\s+Komputer/i);
      expect(summary).not.toMatch(/S1\s+Teknologi\s+Informasi/i);
      expect(summary).not.toMatch(/S1\s+Bisnis\s+Digital/i);
      expect(summary).not.toMatch(/S2\s+Magister/i);
      expect(summary).not.toMatch(/International\s+Dual\s+Degree/i);
    });

    test('C.3: Broad unscoped inquiry includes comprehensive institutional catalog', () => {
      const query = 'Program studi apa saja yang tersedia di STIKOM?';
      const frame = resolveSemanticFrame(query, {});

      expect(frame.domain).toBe('ACADEMIC_PROGRAM');
      const effectiveScope = frame.scopeLevel || 'ALL';
      expect(effectiveScope).toBe('ALL');

      const summary = buildGroundedDeterministicSummary(frame, [], {});
      // Broad catalog must list supported degrees: S1, D3, S2
      expect(summary).toMatch(/Program Sarjana \(S1\)/i);
      expect(summary).toMatch(/Program Diploma \(D3\)/i);
      expect(summary).toMatch(/Program Pascasarjana \(S2\)/i);
      expect(summary).toMatch(/S1 Sistem Informasi/i);
      expect(summary).toMatch(/D3 Manajemen Informatika/i);
      expect(summary).toMatch(/S2 Magister Sistem Informasi/i);
    });

    test('C.4: S2 inquiry strictly produces only Master (S2) programs', () => {
      const query = 'Pilihan program pascasarjana S2 apa saja?';
      const frame = resolveSemanticFrame(query, {});

      expect(frame.domain).toBe('ACADEMIC_PROGRAM');
      expect(frame.scopeLevel || frame.academicLevel).toBe('S2');

      const summary = buildGroundedDeterministicSummary(frame, [], {});
      expect(summary).toBeDefined();

      // Positive assertions: S2 program must appear
      expect(summary).toMatch(/S2 Magister Sistem Informasi/i);

      // Strict negative assertions: Non-S2 programs MUST NOT appear
      expect(summary).not.toMatch(/S1\s+Sistem\s+Informasi/i);
      expect(summary).not.toMatch(/S1\s+Sistem\s+Komputer/i);
      expect(summary).not.toMatch(/S1\s+Teknologi\s+Informasi/i);
      expect(summary).not.toMatch(/S1\s+Bisnis\s+Digital/i);
      expect(summary).not.toMatch(/D3\s+Manajemen\s+Informatika/i);
    });

    test('C.5: English queries maintain identical degree bounds', () => {
      // English S1 inquiry
      const frameS1En = resolveSemanticFrame('What undergraduate bachelor programs are available?', {});
      const summaryS1En = buildGroundedDeterministicSummary(frameS1En, [], {});
      expect(summaryS1En).toMatch(/Undergraduate \(Bachelor\/S1\)/i);
      expect(summaryS1En).toMatch(/S1 Information Systems/i);
      expect(summaryS1En).not.toMatch(/Diploma/i);
      expect(summaryS1En).not.toMatch(/Master/i);

      // English D3 inquiry
      const frameD3En = resolveSemanticFrame('What diploma study programs are available?', {});
      const summaryD3En = buildGroundedDeterministicSummary(frameD3En, [], {});
      expect(summaryD3En).toMatch(/Diploma \(D3\)/i);
      expect(summaryD3En).toMatch(/D3 Informatics Management/i);
      expect(summaryD3En).not.toMatch(/Information Systems \(Sistem Informasi\)/i);
      expect(summaryD3En).not.toMatch(/Master/i);

      // English S2 inquiry
      const frameS2En = resolveSemanticFrame('What master postgraduate programs are offered?', {});
      const summaryS2En = buildGroundedDeterministicSummary(frameS2En, [], {});
      expect(summaryS2En).toMatch(/Postgraduate \(Master\/S2\)/i);
      expect(summaryS2En).toMatch(/S2 Master of Information Systems/i);
      expect(summaryS2En).not.toMatch(/Bachelor/i);
      expect(summaryS2En).not.toMatch(/Diploma/i);
    });

    test('C.6: Explicit scope is preserved across asynchronous resolution path', async () => {
      // Async D3 inquiry
      const frameD3 = await resolveSemanticFrameAsync('daftar prodi diploma D3 yang ada');
      expect(frameD3.scopeLevel).toBe('D3');
      const summaryD3 = buildGroundedDeterministicSummary(frameD3, [], {});
      expect(summaryD3).toMatch(/D3 Manajemen Informatika/i);
      expect(summaryD3).not.toMatch(/S1 Bisnis Digital/i);

      // Async S2 inquiry
      const frameS2 = await resolveSemanticFrameAsync('program studi pascasarjana S2');
      expect(frameS2.scopeLevel).toBe('S2');
      const summaryS2 = buildGroundedDeterministicSummary(frameS2, [], {});
      expect(summaryS2).toMatch(/S2 Magister Sistem Informasi/i);
      expect(summaryS2).not.toMatch(/S1 Sistem Komputer/i);
    });

    test('C.7: Unsupported degree scope (S3 / D4) does not broaden to ALL and returns safe refusal', async () => {
      // S3 inquiry
      const frameS3 = resolveSemanticFrame('Program doktor S3 apa saja yang tersedia?', {});
      const summaryS3 = buildGroundedDeterministicSummary(frameS3, [], {});
      // Invariant: Unrecognized / unoffered degree MUST NOT silently expand to ALL
      expect(summaryS3).toBeNull();

      const synthS3 = await synthesizeAnswer(frameS3, { accepted: [] });
      expect(synthS3.success).toBe(false);
      expect(synthS3.answer).toBeNull();
      expect(synthS3.reason).toBe('unsupported_degree_scope');

      // Direct unoffered scope frame
      const frameD4 = { intent: 'AVAILABLE_PROGRAMS_LIST', domain: 'ACADEMIC_PROGRAM', scopeLevel: 'D4' };
      const summaryD4 = buildGroundedDeterministicSummary(frameD4, [], {});
      expect(summaryD4).toBeNull();

      const synthD4 = await synthesizeAnswer(frameD4, { accepted: [] });
      expect(synthD4.success).toBe(false);
      expect(synthD4.answer).toBeNull();
    });

    test('C.8: Non-catalog queries do not enter static catalog summary path', () => {
      // UKM query
      const ukmFrame = { domain: 'ORGANIZATION_UKM', intent: 'ORGANIZATION_INQUIRY', aspects: ['student_organization'] };
      const ukmSummary = buildGroundedDeterministicSummary(ukmFrame, [], {});
      expect(ukmSummary).toBeNull();

      // Facility query
      const facFrame = { domain: 'FACILITIES', intent: 'FACILITY_INQUIRY', aspects: ['facilities'] };
      const facSummary = buildGroundedDeterministicSummary(facFrame, [], {});
      expect(facSummary).toBeNull();

      // Scholarship query
      const schFrame = { domain: 'SCHOLARSHIP', intent: 'SCHOLARSHIP_INQUIRY', aspects: ['scholarship'] };
      const schSummary = buildGroundedDeterministicSummary(schFrame, [], {});
      expect(schSummary).toBeNull();
    });
  });

  // =========================================================================
  // GROUP D: CONTEXT ISOLATION & CONTINUITY
  // Invariant: Context dependency evaluation must isolate cross-domain inquiries
  // while preserving legitimate anaphoric and elliptical follow-ups.
  // =========================================================================
  describe('Group D: Context Isolation & Continuity', () => {

    const activeAcademicSession = {
      activeDomain: 'ACADEMIC_PROGRAM',
      activeEntity: { code: 'SI', canonical: 'S1 Sistem Informasi', family: 'academic_program' },
      lastQuery: 'Berapa biaya kuliah S1 Sistem Informasi?'
    };

    test('D.1: Cross-domain facility inquiry does NOT inherit academic program entity', () => {
      const query = 'Sebenarnya di kampus ada fasilitas apa saja?';
      const dependency = evaluateContextDependency(query, activeAcademicSession);

      // Invariant: Turn is independent; modal adverb "sebenarnya" must NOT trigger pronoun inheritance
      expect(dependency.shouldInherit).toBe(false);
      expect(dependency.reason).not.toBe('pronoun_reference');
    });

    test('D.2: Cross-domain UKM inquiry isolates from prior academic entity', () => {
      const query = 'Kalau ukm olahraga ada apa saja?';
      const dependency = evaluateContextDependency(query, activeAcademicSession);

      // Invariant: Organization query must not inherit active academic program entity
      expect(dependency.shouldInherit).toBe(false);
      expect(dependency.reason).toBe('campus_wide_domain_isolation');
    });

    test('D.3: Campus-wide domain registry covers all non-prodi service domains', () => {
      // Invariant: CAMPUS_WIDE_DOMAINS must decouple prodi entities for all wide services
      expect(CAMPUS_WIDE_DOMAINS).toContain('ORGANIZATION_UKM');
      expect(CAMPUS_WIDE_DOMAINS).toContain('SCHOLARSHIP');
      expect(CAMPUS_WIDE_DOMAINS).toContain('FACILITIES');
      expect(CAMPUS_WIDE_DOMAINS).toContain('CAMPUS_SERVICE');
    });

    test('D.4: Legitimate attribute follow-up preserves active program entity', () => {
      const query = 'Berapa lama masa studinya?';
      const dependency = evaluateContextDependency(query, activeAcademicSession);

      // Invariant: Legitimate follow-up inherits active entity
      expect(dependency.shouldInherit).toBe(true);
      expect(dependency.inheritedEntity?.canonical).toBe('S1 Sistem Informasi');
    });

    test('D.5: Genuine ellipsis correctly inherits active domain and entity', () => {
      const query = 'Kalau yang S1 Bisnis Digital?';
      expect(isGenuineEllipsis(query)).toBe(true);

      const feeSession = {
        activeDomain: 'TUITION_FEE',
        activeEntity: { code: 'SI', canonical: 'S1 Sistem Informasi', family: 'academic_program' },
        lastQuery: 'Berapa biaya S1 Sistem Informasi?'
      };

      const dependency = evaluateContextDependency(query, feeSession);
      expect(dependency.shouldInherit).toBe(true);
      expect(dependency.reason).toBe('genuine_ellipsis');
      expect(dependency.inheritedDomain).toBe('TUITION_FEE');
    });

    test('D.6: Modal adverbs with -nya do not produce false positive pronoun reference', () => {
      // Modal adverbs should NOT trigger pronoun reference
      expect(hasExplicitPronounReference('Sebenarnya ada beasiswa apa?')).toBe(false);
      expect(hasExplicitPronounReference('Harusnya saya bayar ke mana?')).toBe(false);
      expect(hasExplicitPronounReference('Biasanya pendaftaran buka kapan?')).toBe(false);

      // True nouns with enclitic -nya SHOULD trigger pronoun reference
      expect(hasExplicitPronounReference('biayanya berapa?')).toBe(true);
      expect(hasExplicitPronounReference('syaratnya apa saja?')).toBe(true);
      expect(hasExplicitPronounReference('akreditasinya apa?')).toBe(true);
    });

    test('D.7: Domain transition: prodi -> fasilitas decouples active prodi entity', () => {
      const query = 'Kalau fasilitas laboratorium ada apa saja?';
      const dependency = evaluateContextDependency(query, activeAcademicSession);
      expect(dependency.shouldInherit).toBe(false);
      expect(dependency.reason).toBe('campus_wide_domain_isolation');
    });

    test('D.8: Domain transition: prodi -> UKM decouples active prodi entity', () => {
      const query = 'Bagaimana dengan student clubs atau UKM?';
      const dependency = evaluateContextDependency(query, activeAcademicSession);
      expect(dependency.shouldInherit).toBe(false);
      expect(dependency.reason).toBe('campus_wide_domain_isolation');
    });

    test('D.9: Domain transition: prodi -> beasiswa decouples active prodi entity', () => {
      const query = 'Kalau beasiswa yang tersedia apa saja?';
      const dependency = evaluateContextDependency(query, activeAcademicSession);
      expect(dependency.shouldInherit).toBe(false);
      expect(dependency.reason).toBe('campus_wide_domain_isolation');
    });

    test('D.10: Domain transition: UKM -> biaya kuliah decouples student organization entity', () => {
      const ukmSession = {
        activeDomain: 'ORGANIZATION_UKM',
        activeEntity: { code: 'UKM_TARI', canonical: 'UKM Tari', family: 'student_organization' },
        lastQuery: 'Bagaimana cara bergabung dengan UKM Tari?'
      };
      const query = 'Berapa biaya kuliah per semester?';
      const dependency = evaluateContextDependency(query, ukmSession);
      expect(dependency.shouldInherit).toBe(false);
      expect(dependency.reason).toBe('cross_domain_isolation');
    });

    test('D.11: Domain transition: layanan kampus -> bagaimana cara bergabung preserves service context', () => {
      const incubatorSession = {
        activeDomain: 'CAMPUS_SERVICE',
        activeEntity: { code: 'INBIS', canonical: 'Inkubator Bisnis', family: 'campus_service' },
        lastQuery: 'Ada program inkubator bisnis di kampus?'
      };
      const query = 'Bagaimana cara bergabung?';
      const dependency = evaluateContextDependency(query, incubatorSession);
      expect(dependency.shouldInherit).toBe(true);
      expect(dependency.reason).toBe('genuine_ellipsis');
      expect(dependency.inheritedEntity?.canonical).toBe('Inkubator Bisnis');
    });

    test('D.12: Genuine attribute follow-up correctly inherits active domain and entity', () => {
      const query = 'Bagaimana kurikulum dan prospek karirnya?';
      const dependency = evaluateContextDependency(query, activeAcademicSession);
      expect(dependency.shouldInherit).toBe(true);
      expect(dependency.reason).toBe('pronoun_reference');
      expect(dependency.inheritedEntity?.canonical).toBe('S1 Sistem Informasi');
    });
  });

  // =========================================================================
  // GROUP E: GROUNDING & EVIDENCE ARBITRATION
  // Invariant: Answers must be grounded in accepted evidence. Zero evidence
  // must produce SAFE_UNKNOWN without false positive verification passes.
  // =========================================================================
  describe('Group E: Grounding & Evidence Arbitration', () => {

    test('E.1: Evidence arbiter rejects irrelevant cross-domain chunks', () => {
      const scholarshipFrame = {
        normalizedQuery: 'syarat beasiswa kip kuliah',
        domain: 'SCHOLARSHIP',
        intent: 'SCHOLARSHIP_INQUIRY',
        aspects: ['scholarship', 'requirements'],
        entities: []
      };

      const plan = buildRetrievalPlan(scholarshipFrame);

      const irrelevantCurriculumChunk = {
        id: 'chunk_curriculum_01',
        text: 'Kurikulum Program Studi S1 Teknologi Informasi terdiri atas 144 SKS matakuliah wajib dan pilihan.',
        domain: 'ACADEMIC_CURRICULUM',
        similarity: 0.88
      };

      // Function signature: arbitrateEvidence(candidates, retrievalPlan)
      const arbitrated = arbitrateEvidence([irrelevantCurriculumChunk], plan);
      // Invariant: Off-domain chunk must not be accepted as valid evidence for scholarship
      expect(arbitrated.accepted.length).toBe(0);
    });

    test('E.2: Empty evidence produces null synthesis (safe fallback)', async () => {
      const frame = {
        rawQuery: 'berapa nomor telepon ketua ukm tahun 2017?',
        domain: 'ORGANIZATION_UKM',
        intent: 'ORGANIZATION_INQUIRY',
        aspects: ['contact'],
        entities: []
      };

      const synthesis = await synthesizeAnswer(frame, {
        acceptedEvidence: []
      });

      // Invariant: Generator must refuse ungrounded answer without accepted evidence
      expect(synthesis.answer).toBeNull();
      expect(synthesis.success).toBe(false);
    });

    test('E.3: Coincidental keyword match is not sufficient evidence', () => {
      const ukmArtFrame = {
        normalizedQuery: 'ukm tari dan seni',
        domain: 'ORGANIZATION_UKM',
        intent: 'ORGANIZATION_INQUIRY',
        aspects: ['student_organization', 'arts_culture'],
        entities: []
      };

      const plan = buildRetrievalPlan(ukmArtFrame);

      // Chunk coincidentally mentions "seni" in a building description
      const buildingFacilityChunk = {
        id: 'chunk_fac_01',
        text: 'Gedung Kesenian dan Teater Terbuka terletak di sisi timur kampus untuk pertunjukan.',
        domain: 'FACILITIES',
        similarity: 0.72
      };

      const arbitrated = arbitrateEvidence([buildingFacilityChunk], plan);
      // Facilities building is not a student organization profile
      expect(arbitrated.accepted.length).toBe(0);
    });
  });

  // =========================================================================
  // GROUP F: MULTI-INTENT & CROSS-LINGUAL GENERALIZATION
  // Invariant: Semantic interpretation and scoping must generalize across
  // English, colloquial Indonesian, and compound inquiries.
  // =========================================================================
  describe('Group F: Multi-Intent & Cross-Lingual Generalization', () => {

    test('F.1: English Bachelor degree inquiry enforces S1 scope constraint', () => {
      const query = 'What bachelor degree programs are available at STIKOM?';
      const frame = resolveSemanticFrame(query, {});

      expect(frame.domain).toBe('ACADEMIC_PROGRAM');
      expect(frame.scopeLevel || frame.academicLevel).toBe('S1');
      expect(frame.language).toBe('en');

      const summary = buildGroundedDeterministicSummary(frame, [], {});
      expect(summary).toMatch(/Undergraduate \(Bachelor\/S1\)/i);
      expect(summary).not.toMatch(/Diploma/i);
    });

    test('F.2: English club advice inquiry preserves organization domain', () => {
      // Testing English student club recommendation
      const query = 'I like sports and music, what student club should I explore?';
      const frame = resolveSemanticFrame(query, {});

      // Invariant: English advice must route to organization, not prodi recommendation
      expect(frame.domain).toBe('ORGANIZATION_UKM');
      expect(frame.domain).not.toBe('ACADEMIC_RECOMMENDATION');
    });

    test('F.3: Indonesian colloquial inquiry resolves to SCHOLARSHIP domain', () => {
      const query = 'sy pgn tau beasiswa buat mhs kurang mampu ada apa aja ya';
      const frame = resolveSemanticFrame(query, {});

      expect(frame.domain).toBe('SCHOLARSHIP');
      expect(frame.domain).not.toBe('ACADEMIC_RECOMMENDATION');
    });

    test('F.4: Multi-aspect inquiry captures both fee and accreditation aspects', () => {
      const query = 'Berapa biaya kuliah dan bagaimana akreditasi S1 Sistem Informasi?';
      const frame = resolveSemanticFrame(query, {});

      expect(frame.domain).toMatch(/ACADEMIC_PROGRAM|TUITION_FEE|ACCREDITATION/);
      expect(frame.aspects).toContain('fee');
      expect(frame.aspects).toContain('accreditation');
    });

    test('F.5: Fatal crash probe on query containing "join" or "bergabung" (unsteeredDomain bug)', () => {
      // Documents the unhandled ReferenceError in src/core/semanticFrameResolver.js:523
      let frameError = null;
      try {
        resolveSemanticFrame('how can I join student clubs in campus?', {});
      } catch (err) {
        frameError = err;
      }
      // Invariant: Query parsing must NEVER crash with ReferenceError
      expect(frameError).toBeNull();
    });
  });

  // =========================================================================
  // GROUP G: ASYNCHRONOUS MODEL RESOLUTION PATH (OFFLINE STUBS)
  // Invariant: When the AI model returns valid semantic interpretations,
  // resolveSemanticFrameAsync must NOT overwrite or erase domains/scopes.
  // =========================================================================
  describe('Group G: Asynchronous Model Resolution Path (Offline Stubs)', () => {

    test('G.1: Async resolution preserves ORGANIZATION_UKM on SEEK_ADVICE', async () => {
      const client = createMockModelClient({
        speechAct: 'SEEK_ADVICE',
        semanticConcepts: ['CAMPUS_LIFE'],
        candidateEntities: [{ mention: 'UKM Musik', inferredCategory: 'student_organization' }],
        requestedAspects: ['organization'],
        scopeConstraints: { academicLevel: null, studyMode: null, locationConstraint: null },
        contextDependency: { isFollowUp: false, referenceType: 'none' },
        confidence: 0.95,
        ambiguityLevel: 'LOW'
      });

      const frame = await resolveSemanticFrameAsync(
        'saya suka musik bagusnya masuk ukm apa ya?',
        {},
        { client }
      );

      // Invariant: Domain must remain ORGANIZATION_UKM, not ACADEMIC_RECOMMENDATION
      expect(frame.domain).toBe('ORGANIZATION_UKM');
      expect(frame.intent).toBe('ORGANIZATION_INQUIRY');
    });

    test('G.2: Async resolution preserves SCHOLARSHIP domain on SEEK_ADVICE (does not hijack to prodi)', async () => {
      const client = createMockModelClient({
        speechAct: 'SEEK_ADVICE',
        semanticConcepts: ['FINANCIAL_COST'],
        candidateEntities: [],
        requestedAspects: ['fee'],
        scopeConstraints: { academicLevel: null, studyMode: null, locationConstraint: null },
        contextDependency: { isFollowUp: false, referenceType: 'none' },
        confidence: 0.95,
        ambiguityLevel: 'LOW'
      });

      const frame = await resolveSemanticFrameAsync(
        'ada saran beasiswa prestasi untuk maba?',
        {},
        { client }
      );

      // Invariant: Domain must remain SCHOLARSHIP, NOT ACADEMIC_RECOMMENDATION
      expect(frame.domain).toBe('SCHOLARSHIP');
      expect(frame.domain).not.toBe('ACADEMIC_RECOMMENDATION');
      expect(frame.intent).not.toBe('PROGRAM_RECOMMENDATION');
    });

    test('G.3: Async resolution preserves SCHOLARSHIP requirements (does not erase to PMB)', async () => {
      const client = createMockModelClient({
        speechAct: 'INQUIRE_PROPERTY',
        semanticConcepts: ['FINANCIAL_COST'],
        candidateEntities: [],
        requestedAspects: ['requirements'],
        scopeConstraints: { academicLevel: null, studyMode: null, locationConstraint: null },
        contextDependency: { isFollowUp: false, referenceType: 'none' },
        confidence: 0.95,
        ambiguityLevel: 'LOW'
      });

      const frame = await resolveSemanticFrameAsync(
        'apa syarat beasiswa KIP Kuliah?',
        {},
        { client }
      );

      // Invariant: Requirements aspect on scholarship must NOT become PMB admission requirements
      expect(frame.domain).toBe('SCHOLARSHIP');
      expect(frame.domain).not.toBe('PMB');
      expect(frame.intent).not.toBe('ADMISSION_REQUIREMENTS');
    });

    test('G.4: Async resolution preserves CAMPUS_SERVICE on DISCOVER_LIST (does not fall through to prodi catalog)', async () => {
      const client = createMockModelClient({
        speechAct: 'DISCOVER_LIST',
        semanticConcepts: ['CAMPUS_LIFE'],
        candidateEntities: [{ mention: 'Inkubator Bisnis', inferredCategory: 'campus_service' }],
        requestedAspects: ['general'],
        scopeConstraints: { academicLevel: null, studyMode: null, locationConstraint: null },
        contextDependency: { isFollowUp: false, referenceType: 'none' },
        confidence: 0.95,
        ambiguityLevel: 'LOW'
      });

      const frame = await resolveSemanticFrameAsync(
        'layanan apa saja di inkubator bisnis STIKOM?',
        {},
        { client }
      );

      // Invariant: Incubator discovery must NOT collapse into prodi catalog list
      expect(frame.domain).toMatch(/CAMPUS_SERVICE|BUSINESS_INCUBATOR/i);
      expect(frame.intent).not.toBe('AVAILABLE_PROGRAMS_LIST');
    });

    test('G.5: Async resolution preserves explicit S1 scope constraint', async () => {
      const client = createMockModelClient({
        speechAct: 'DISCOVER_LIST',
        semanticConcepts: ['ACADEMIC_OFFERING'],
        candidateEntities: [],
        requestedAspects: ['curriculum'],
        scopeConstraints: { academicLevel: 'S1', studyMode: null, locationConstraint: null },
        contextDependency: { isFollowUp: false, referenceType: 'none' },
        confidence: 0.95,
        ambiguityLevel: 'LOW'
      });

      const frame = await resolveSemanticFrameAsync(
        'program sarjana S1 yang tersedia apa saja?',
        {},
        { client }
      );

      // Invariant: Explicit S1 constraint must be preserved
      expect(frame.scopeLevel || frame.academicLevel).toBe('S1');
    });

    test('G.6: Async resolution preserves ALL scope on general query without explicit level', async () => {
      const client = createMockModelClient({
        speechAct: 'DISCOVER_LIST',
        semanticConcepts: ['ACADEMIC_OFFERING'],
        candidateEntities: [],
        requestedAspects: ['general'],
        scopeConstraints: { academicLevel: null, studyMode: null, locationConstraint: null },
        contextDependency: { isFollowUp: false, referenceType: 'none' },
        confidence: 0.95,
        ambiguityLevel: 'LOW'
      });

      const frame = await resolveSemanticFrameAsync(
        'program studi apa saja yang tersedia?',
        {},
        { client }
      );

      // Invariant: Default scope is ALL
      expect(frame.scopeLevel || 'ALL').toBe('ALL');
    });
  });

  // =========================================================================
  // GROUP H: PLANNER EXECUTION PLAN ALIGNMENT
  // Invariant: PLAN_TYPE.RECOMMENDATION must ONLY be chosen when the query
  // genuinely targets academic study program recommendation.
  // =========================================================================
  describe('Group H: Planner Execution Plan Alignment', () => {

    test('H.1: Genuine prodi advice inquiry legitimately triggers RECOMMENDATION plan', () => {
      const query = 'saya suka pemrograman dan coding, cocoknya masuk jurusan apa?';
      const frame = resolveSemanticFrame(query, {});
      const planResult = buildExecutionPlan(query, {}, { semanticFrame: frame });

      expect(planResult.success).toBe(true);
      expect(planResult.plan.planType).toBe('RECOMMENDATION');
      expect(planResult.plan.tasks[0].type).toBe('RECOMMENDATION_TASK');
    });

    test('H.2: UKM advice with "cocok" does NOT trigger prodi RECOMMENDATION plan', () => {
      const query = 'saya suka fotografi cocoknya masuk ukm apa?';
      const frame = resolveSemanticFrame(query, {});
      const planResult = buildExecutionPlan(query, { activeDomain: 'ORGANIZATION_UKM' }, { semanticFrame: frame });

      expect(planResult.success).toBe(true);
      // Invariant: Must not produce academic degree recommendation task
      if (planResult.plan.planType === 'RECOMMENDATION') {
        const aspects = planResult.plan.tasks[0].requiredAspects || [];
        expect(aspects).not.toContain('curriculum_fit');
      }
    });

    test('H.3: Scholarship advice with "saran" does NOT trigger prodi RECOMMENDATION plan', () => {
      const query = 'ada saran beasiswa untuk keluarga kurang mampu?';
      const frame = { domain: 'SCHOLARSHIP', intent: 'SCHOLARSHIP_INQUIRY', aspects: ['scholarship'], entities: [] };
      const planResult = buildExecutionPlan(query, { activeDomain: 'SCHOLARSHIP' }, { semanticFrame: frame });

      expect(planResult.success).toBe(true);
      // Invariant: Scholarship advice is factual search, not prodi recommendation
      expect(planResult.plan.planType).not.toBe('RECOMMENDATION');
    });

    test('H.4: Business incubator advice with "saran" does NOT trigger prodi RECOMMENDATION plan', () => {
      const query = 'ada saran inkubator bisnis untuk mahasiswa?';
      const frame = { domain: 'CAMPUS_SERVICE', intent: 'CAMPUS_SERVICE_INQUIRY', aspects: ['service_info'], entities: [] };
      const planResult = buildExecutionPlan(query, { activeDomain: 'CAMPUS_SERVICE' }, { semanticFrame: frame });

      expect(planResult.success).toBe(true);
      // Invariant: Incubator advice is campus service, NOT academic degree recommendation
      expect(planResult.plan.planType).not.toBe('RECOMMENDATION');
    });
  });

  // =========================================================================
  // GROUP I: GROUNDING MULTI-LEVEL CONTRACT & ORCHESTRATOR TELEMETRY
  // Invariant: Clear distinction between generator units, arbiter evaluation,
  // end-to-end integration, and orchestrator safe fallback verification.
  // =========================================================================
  describe('Group I: Grounding Multi-Level Contract & Orchestrator Telemetry', () => {

    test('I.1: Level 1 (Generator Unit) — deterministic catalog enforces S1 vs D3 boundaries', () => {
      const s1Frame = { intent: 'AVAILABLE_PROGRAMS_LIST', domain: 'ACADEMIC_PROGRAM', scopeLevel: 'S1' };
      const s1Answer = buildGroundedDeterministicSummary(s1Frame, [], {});
      expect(s1Answer).toMatch(/S1 Sistem Informasi/i);
      expect(s1Answer).not.toMatch(/D3 Manajemen Informatika/i);

      const d3Frame = { intent: 'AVAILABLE_PROGRAMS_LIST', domain: 'ACADEMIC_PROGRAM', scopeLevel: 'D3' };
      const d3Answer = buildGroundedDeterministicSummary(d3Frame, [], {});
      expect(d3Answer).toMatch(/D3 Manajemen Informatika/i);
      expect(d3Answer).not.toMatch(/S1 Bisnis Digital/i);
    });

    test('I.2: Level 1 (Generator Unit) — refuses ungrounded factual answer without accepted evidence', async () => {
      const frame = { domain: 'ACCREDITATION', intent: 'ACCREDITATION_INQUIRY', aspects: ['accreditation'], entities: [] };
      const result = await synthesizeAnswer(frame, { acceptedEvidence: [] });
      expect(result.success).toBe(false);
      expect(result.answer).toBeNull();
    });

    test('I.3: Level 2 (Arbiter) — evaluates answerability as UNKNOWN when accepted evidence is empty', () => {
      const frame = { domain: 'SCHOLARSHIP', intent: 'SCHOLARSHIP_INQUIRY', aspects: ['scholarship'] };
      const answerability = evaluateAnswerability(frame, { accepted: [], rejected: [] });

      // Invariant: Zero evidence must produce UNKNOWN
      expect(answerability.status).toBe(ANSWERABILITY_STATUS.UNKNOWN);
    });

    test('I.4: Level 3 (Integration) — valid evidence produces grounded answer verified by final verifier', async () => {
      const frame = {
        normalizedQuery: 'akreditasi s1 sistem informasi',
        domain: 'ACADEMIC_PROGRAM',
        intent: 'ACCREDITATION_INQUIRY',
        aspects: ['accreditation'],
        entities: [{ canonical: 'S1 Sistem Informasi' }]
      };

      const validChunk = {
        id: 'chunk_si_acc_01',
        text: 'Program Studi S1 Sistem Informasi ITB STIKOM Bali telah terakreditasi Baik Sekali oleh LAM INFOKOM.',
        domain: 'ACADEMIC_PROGRAM',
        metadata: { entities: ['S1 Sistem Informasi'], aspects: ['accreditation'] }
      };

      const synthesis = await synthesizeAnswer(frame, {
        accepted: [validChunk]
      });

      expect(synthesis.success).toBe(true);
      expect(synthesis.answer).toBeDefined();

      const verification = verifyFinalAnswer(synthesis.answer, frame, {
        accepted: [validChunk],
        rejected: []
      });

      expect(verification.pass).toBe(true);
    });

    test('I.5: Level 4 (Orchestrator Contract) — safe fallback status is NOT conflated as verified factual pass', async () => {
      // Execute pipeline on unrecorded data that triggers safe fallback
      const query = 'berapa nomor kontak ketua ukm tahun 2015?';
      const result = await runPhase1DeterministicPipeline('offline_user_' + Date.now(), query, {
        sessionSnapshot: { data: {} },
        executionMode: 'SHADOW'
      });

      const subResult = result.subQueryResults[0];
      // Invariant: Safe unknown / corpus gap refusal MUST NOT be marked as an evidence-grounded pass
      // It must be clearly distinguished in the verification telemetry
      const isConflatedFactualPass = subResult.verification.pass === true && subResult.verification.reason !== 'safe_unknown';
      expect(isConflatedFactualPass).toBe(false);

      // Architectural Invariant: Verification pass:true must indicate verified grounded claims, not safe unknown
      expect(subResult.verification.status || subResult.verification.reason).not.toBe('verified_grounded');
    });

    test('I.6: Level 4 (Outcome Contract) — factual evidence-grounded answer produces status VERIFIED_FACTUAL with pass: true and isGrounded: true', async () => {
      const frame = {
        normalizedQuery: 'akreditasi s1 sistem informasi',
        domain: 'ACADEMIC_PROGRAM',
        intent: 'ACCREDITATION_INQUIRY',
        aspects: ['accreditation'],
        entities: [{ canonical: 'S1 Sistem Informasi' }]
      };
      const validChunk = {
        id: 'chunk_si_acc_01',
        text: 'Program Studi S1 Sistem Informasi ITB STIKOM Bali telah terakreditasi Baik Sekali oleh LAM INFOKOM.',
        domain: 'ACADEMIC_PROGRAM',
        metadata: { entities: ['S1 Sistem Informasi'], aspects: ['accreditation'] }
      };
      const synthesis = await synthesizeAnswer(frame, { accepted: [validChunk] });
      const verification = verifyFinalAnswer(synthesis.answer, frame, { accepted: [validChunk], rejected: [] });
      expect(verification.pass).toBe(true);
      expect(verification.outcome).toBe(VERIFICATION_OUTCOME.VERIFIED_FACTUAL);
      expect(verification.status).toBe(VERIFICATION_OUTCOME.VERIFIED_FACTUAL);
      expect(verification.isGrounded).toBe(true);
      expect(verification.handledSafely).toBe(true);
    });

    test('I.7: Level 4 (Outcome Contract) — escalation guidance produces status ESCALATION_GUIDANCE with pass: false and handledSafely: true', async () => {
      const oodQuery = 'Bagaimana resep nasi goreng khas Bali?';
      const result = await runPhase1DeterministicPipeline('test_ood_user', oodQuery, {
        sessionSnapshot: { data: {} },
        executionMode: 'SHADOW'
      });
      const subResult = result.subQueryResults[0];
      expect(subResult.verification.pass).toBe(false);
      expect(subResult.verification.outcome).toBe(VERIFICATION_OUTCOME.ESCALATION_GUIDANCE);
      expect(subResult.verification.status).toBe(VERIFICATION_OUTCOME.ESCALATION_GUIDANCE);
      expect(subResult.verification.isGrounded).toBe(false);
      expect(subResult.verification.handledSafely).toBe(true);
    });

    test('I.8: Level 4 (Outcome Contract) — unsupported program / entity produces status SAFE_UNKNOWN with pass: false and handledSafely: true', async () => {
      const unsupportedQuery = 'Apakah ada jurusan S1 Kedokteran di STIKOM?';
      const result = await runPhase1DeterministicPipeline('test_unsupported_user', unsupportedQuery, {
        sessionSnapshot: { data: {} },
        executionMode: 'SHADOW'
      });
      const subResult = result.subQueryResults[0];
      expect(subResult.verification.pass).toBe(false);
      expect(subResult.verification.outcome).toBe(VERIFICATION_OUTCOME.SAFE_UNKNOWN);
      expect(subResult.verification.status).toBe(VERIFICATION_OUTCOME.SAFE_UNKNOWN);
      expect(subResult.verification.isGrounded).toBe(false);
      expect(subResult.verification.handledSafely).toBe(true);
    });

    test('I.9: Level 4 (Interception Contract) — verifier failure replaced by escalation retains interceptedFrom and original reason', async () => {
      const mockVerifier = jest.fn(() => ({
        pass: false,
        outcome: VERIFICATION_OUTCOME.VERIFICATION_FAILED,
        status: VERIFICATION_OUTCOME.VERIFICATION_FAILED,
        reason: 'raw_document_metadata_leak_detected',
        isGrounded: false,
        handledSafely: false
      }));

      const query = 'Berapa biaya kuliah S1 Sistem Informasi?';
      const result = await runPhase1DeterministicPipeline('test_intercept_user', query, {
        sessionSnapshot: { data: {} },
        executionMode: 'SHADOW',
        finalAnswerVerifier: mockVerifier
      });

      const sub = result.subQueryResults[0];
      // 1. Defective answer must NEVER be delivered
      expect(sub.answer).not.toContain('ragChunkCount');
      expect(sub.answer).toContain('Mohon maaf, informasi resmi yang terverifikasi belum dapat dipastikan');

        // 2. Final response is classified as ESCALATION_GUIDANCE
        expect(sub.verification.outcome).toBe(VERIFICATION_OUTCOME.ESCALATION_GUIDANCE);
        expect(sub.verification.pass).toBe(false);
        expect(sub.verification.isGrounded).toBe(false);
        expect(sub.verification.handledSafely).toBe(true);

      expect(sub.verification.interceptedFrom).toBe(VERIFICATION_OUTCOME.VERIFICATION_FAILED);
      expect(sub.verification.isInterception).toBe(true);
      expect(sub.verification.reason).toBe('raw_document_metadata_leak_detected');
    });

    test('I.10: Level 4 (Metric Independence) — factual verification and operational safety diverge on safe refusal', async () => {
      const query = 'Apakah ada jurusan S1 Teknik Nuklir di STIKOM?';
      const result = await runPhase1DeterministicPipeline('test_divergence_user', query, {
        sessionSnapshot: { data: {} },
        executionMode: 'SHADOW'
      });
      const sub = result.subQueryResults[0];

      // Safe unknown refusal:
      // Factual verification is FALSE (no facts were verified)
      expect(sub.verification.pass).toBe(false);
      expect(sub.verification.outcome).toBe(VERIFICATION_OUTCOME.SAFE_UNKNOWN);

      // Operational safety is TRUE (refusal safely prevented hallucination)
      expect(sub.verification.handledSafely).toBe(true);

      // Confirm they are distinct and not conflated
      expect(sub.verification.pass).not.toBe(sub.verification.handledSafely);
    });

    test('I.11: Level 4 (Shadow Telemetry Accounting) — aggregates factual vs safety metrics and counts accurately', async () => {
      const mockBridge = jest.fn(async () => ({
        finalAnswer: 'Combined answer',
        subQueryResults: [
          {
            answer: 'Verified answer',
            verification: {
              pass: true,
              outcome: VERIFICATION_OUTCOME.VERIFIED_FACTUAL,
              handledSafely: true
            }
          },
          {
            answer: 'Safe unknown answer',
            verification: {
              pass: false,
              outcome: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
              handledSafely: true
            }
          },
          {
            answer: 'Safe escalation after leak interception',
            verification: {
              pass: false,
              outcome: VERIFICATION_OUTCOME.ESCALATION_GUIDANCE,
              interceptedFrom: VERIFICATION_OUTCOME.VERIFICATION_FAILED,
              isInterception: true,
              handledSafely: true
            }
          }
        ]
      }));

      const telemetry = await evaluateShadowTurn({
        chatId: 'test_accounting_' + Date.now(),
        rawQuery: 'Multi-part test query',
        p1Result: { finalAnswer: 'P1 answer', subQueryResults: [] },
        phase2BridgeFn: mockBridge
      });

      // 1. Factual verification pass is false because not all subqueries are factual
      expect(telemetry.p2FactualVerificationPass).toBe(false);

      // 2. Operational safety pass is true because all 3 were handled safely
      expect(telemetry.p2OperationalSafetyPass).toBe(true);
      expect(telemetry.p2HandledSafely).toBe(true);

      // 3. Category counts are tracked accurately
      expect(telemetry.safeUnknownCount).toBe(1);
      expect(telemetry.interceptedFailureCount).toBe(1);
      expect(telemetry.integrityFailureCount).toBe(1); // intercepted failure counts toward integrity failures
      expect(telemetry.normalEscalationCount).toBe(0); // normal escalation is 0 because the escalation was intercepted
    });

    test('I.12: Level 4 (Escalation Attribution) — normal escalation has interceptedFrom: null vs intercepted verifier failure', async () => {
      // 1. Normal out-of-domain escalation
      const oodQuery = 'Bagaimana tips investasi kripto bitcoin?';
      const oodRes = await runPhase1DeterministicPipeline('test_ood_attribution', oodQuery, {
        sessionSnapshot: { data: {} },
        executionMode: 'SHADOW'
      });
      const oodSub = oodRes.subQueryResults[0];
      expect(oodSub.verification.outcome).toBe(VERIFICATION_OUTCOME.ESCALATION_GUIDANCE);
      expect(oodSub.verification.interceptedFrom).toBeNull();
      expect(oodSub.verification.isInterception).toBe(false);
      expect(oodSub.verification.handledSafely).toBe(true);
    });

    test('I.13: Scenario 1 (Justified Safe Refusal) — P1 ungrounded answer vs P2 valid SAFE_UNKNOWN does NOT trigger factual regression', async () => {
      // P1 answered with an unproven hallucination (no accepted chunks, ungrounded)
      const p1Result = {
        finalAnswer: 'Biaya asrama adalah Rp 500.000 per bulan',
        subQueryResults: [
          {
            answer: 'Biaya asrama adalah Rp 500.000 per bulan',
            arbitrated: { accepted: [] },
            acceptedCount: 0,
            verification: { pass: true, isGrounded: false, outcome: VERIFICATION_OUTCOME.VERIFIED_FACTUAL }
          }
        ]
      };

      // P2 properly refused because of genuine corpus gap
      const mockP2Bridge = jest.fn(async () => ({
        finalAnswer: 'Informasi mengenai hal tersebut belum tercantum dalam panduan resmi.',
        subQueryResults: [
          {
            answer: 'Informasi mengenai hal tersebut belum tercantum dalam panduan resmi.',
            arbitrated: { accepted: [] },
            acceptedCount: 0,
            status: 'corpus_gap',
            answerability: 'UNKNOWN',
            verification: {
              pass: false,
              outcome: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
              handledSafely: true,
              isGrounded: false
            }
          }
        ]
      }));

      const telemetry = await evaluateShadowTurn({
        chatId: 'test_justified_refusal_' + Date.now(),
        rawQuery: 'Berapa biaya sewa kamar asrama?',
        p1Result,
        phase2BridgeFn: mockP2Bridge
      });

      // Validated contract:
      // 1. Safe refusal is NOT counted as factual pass
      expect(telemetry.p2FactualVerificationPass).toBe(false);
      // 2. Safe refusal IS counted as operational safety pass
      expect(telemetry.p2OperationalSafetyPass).toBe(true);
      expect(telemetry.safeUnknownCount).toBe(1);
      // 3. Justified refusal difference is flagged
      expect(telemetry.groundedRefusalDifference).toBe(true);
      // 4. Critical: NOT flagged as factual regression!
      expect(telemetry.factualRegressionDetected).toBe(false);
      expect(telemetry.diffs).toContain('grounded_refusal_difference');
      expect(telemetry.diffs).not.toContain('factual_regression');
    });

    test('I.14: Scenario 2 (True Answerability Regression) — P1 grounded answer available but P2 erroneously abstains', async () => {
      // P1 answered with genuine, verified accepted evidence chunks
      const p1Result = {
        finalAnswer: 'Biaya kuliah S1 Sistem Informasi adalah Rp 5.500.000 per semester.',
        subQueryResults: [
          {
            answer: 'Biaya kuliah S1 Sistem Informasi adalah Rp 5.500.000 per semester.',
            arbitrated: { accepted: [{ id: 'fee_si_chunk_1', title: 'Biaya S1 SI' }] },
            acceptedCount: 1,
            answerability: 'ANSWERABLE',
            verification: { pass: true, isGrounded: true, outcome: VERIFICATION_OUTCOME.VERIFIED_FACTUAL }
          }
        ]
      };

      // P2 erroneously failed retrieval or aborted without evidence
      const mockP2Bridge = jest.fn(async () => ({
        finalAnswer: 'Informasi belum tercantum.',
        subQueryResults: [
          {
            answer: 'Informasi belum tercantum.',
            arbitrated: { accepted: [] },
            acceptedCount: 0,
            answerability: 'UNKNOWN',
            verification: {
              pass: false,
              outcome: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
              handledSafely: true,
              isGrounded: false
            }
          }
        ]
      }));

      const telemetry = await evaluateShadowTurn({
        chatId: 'test_true_regression_' + Date.now(),
        rawQuery: 'Berapa biaya kuliah S1 SI?',
        p1Result,
        phase2BridgeFn: mockP2Bridge
      });

      // Grounded evidence was available from P1, so P2 safe unknown is an actual regression!
      expect(telemetry.p2FactualVerificationPass).toBe(false);
      expect(telemetry.groundedRefusalDifference).toBe(false);
      expect(telemetry.factualRegressionDetected).toBe(true);
      expect(telemetry.answerabilityRegressionDetected).toBe(true);
      expect(telemetry.diffs).toContain('factual_regression');
    });

    test('I.15: Scenario 3 (Grounded Factual Success) — P2 genuinely verified factual answer', async () => {
      const p1Result = { finalAnswer: 'P1 answer', subQueryResults: [] };
      const mockP2Bridge = jest.fn(async () => ({
        finalAnswer: 'P2 verified answer',
        subQueryResults: [
          {
            answer: 'P2 verified answer',
            arbitrated: { accepted: [{ id: 'valid_chunk_1' }] },
            verification: {
              pass: true,
              outcome: VERIFICATION_OUTCOME.VERIFIED_FACTUAL,
              handledSafely: true,
              isGrounded: true
            }
          }
        ]
      }));

      const telemetry = await evaluateShadowTurn({
        chatId: 'test_factual_pass_' + Date.now(),
        rawQuery: 'Query factual',
        p1Result,
        phase2BridgeFn: mockP2Bridge
      });

      expect(telemetry.p2FactualVerificationPass).toBe(true);
      expect(telemetry.p2OperationalSafetyPass).toBe(true);
      expect(telemetry.p2VerificationPass).toBe(true);
      expect(telemetry.factualRegressionDetected).toBe(false);
    });

    test('I.16: Scenario 4 (Normal Escalation) — P2 produces legitimate escalation guidance', async () => {
      const p1Result = { finalAnswer: 'P1 answer', subQueryResults: [] };
      const mockP2Bridge = jest.fn(async () => ({
        finalAnswer: 'Silakan hubungi dosen wali.',
        subQueryResults: [
          {
            answer: 'Silakan hubungi dosen wali.',
            verification: {
              pass: false,
              outcome: VERIFICATION_OUTCOME.ESCALATION_GUIDANCE,
              handledSafely: true,
              isGrounded: false,
              interceptedFrom: null,
              isInterception: false
            }
          }
        ]
      }));

      const telemetry = await evaluateShadowTurn({
        chatId: 'test_normal_esc_' + Date.now(),
        rawQuery: 'Kendala KRS',
        p1Result,
        phase2BridgeFn: mockP2Bridge
      });

      expect(telemetry.p2FactualVerificationPass).toBe(false);
      expect(telemetry.p2OperationalSafetyPass).toBe(true);
      expect(telemetry.normalEscalationCount).toBe(1);
      expect(telemetry.interceptedFailureCount).toBe(0);
      expect(telemetry.integrityFailureCount).toBe(0);
    });

    test('I.17: Scenario 5 (Intercepted Integrity Failure) — P2 blocks verifier failure and retains audit trail', async () => {
      const p1Result = { finalAnswer: 'P1 answer', subQueryResults: [] };
      const mockP2Bridge = jest.fn(async () => ({
        finalAnswer: 'Safe escalation message',
        subQueryResults: [
          {
            answer: 'Safe escalation message',
            verification: {
              pass: false,
              outcome: VERIFICATION_OUTCOME.ESCALATION_GUIDANCE,
              handledSafely: true,
              isGrounded: false,
              interceptedFrom: VERIFICATION_OUTCOME.VERIFICATION_FAILED,
              isInterception: true
            }
          }
        ]
      }));

      const telemetry = await evaluateShadowTurn({
        chatId: 'test_interception_' + Date.now(),
        rawQuery: 'Query injection',
        p1Result,
        phase2BridgeFn: mockP2Bridge
      });

      expect(telemetry.p2FactualVerificationPass).toBe(false);
      expect(telemetry.p2OperationalSafetyPass).toBe(true);
      expect(telemetry.p2VerificationPass).toBe(true); // backward compatibility alias for operational safety
      expect(telemetry.interceptedFailureCount).toBe(1);
      expect(telemetry.integrityFailureCount).toBe(1);
      expect(telemetry.normalEscalationCount).toBe(0);
    });
  });

});
