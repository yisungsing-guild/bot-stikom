'use strict';

/**
 * bindingRetrievalPlanner.test.js
 *
 * Comprehensive Structural and Invariant Tests for Controlled Binding Retrieval Planner.
 */

const {
  createRetrievalPlan,
  executeRetrievalPlan,
  SCOPE_TYPES
} = require('../src/engine/bindingRetrievalPlanner');
const { createSemanticFrame } = require('../src/engine/semanticFrame');

describe('Controlled Binding Retrieval Planner Structural Tests', () => {

  test('SINGLE_ENTITY_SINGLE_FIELD=PASS', () => {
    const frame = createSemanticFrame({
      rawQuery: 'berapa biaya kuliah sistem informasi?',
      entities: [{ canonical: 'S1 Sistem Informasi', family: 'program', type: 'academic_program' }],
      requestedFields: ['tuitionFee']
    });

    const plan = createRetrievalPlan(frame);
    expect(plan.subrequests.length).toBe(1);
    expect(plan.subrequests[0].bindings.length).toBe(1);

    const b = plan.subrequests[0].bindings[0];
    expect(b.entity.canonical).toBe('S1 Sistem Informasi');
    expect(b.requestedField).toBe('tuitionFee');
    expect(b.scopeType).toBe(SCOPE_TYPES.EXPLICIT_ENTITY);
    expect(b.budget.maxCandidates).toBeGreaterThanOrEqual(20);
  });

  test('SINGLE_ENTITY_MULTI_FIELD=PASS', () => {
    const frame = createSemanticFrame({
      rawQuery: 'gelar dan masa studi sistem informasi apa saja?',
      entities: [{ canonical: 'S1 Sistem Informasi', family: 'program', type: 'academic_program' }],
      requestedFields: ['degree', 'duration']
    });

    const plan = createRetrievalPlan(frame);
    expect(plan.subrequests.length).toBe(1);
    expect(plan.subrequests[0].bindings.length).toBe(2);

    const fields = plan.subrequests[0].bindings.map(b => b.requestedField);
    expect(fields).toContain('degree');
    expect(fields).toContain('duration');
    expect(plan.subrequests[0].bindings[0].entity.canonical).toBe('S1 Sistem Informasi');
    expect(plan.subrequests[0].bindings[1].entity.canonical).toBe('S1 Sistem Informasi');
  });

  test('MULTI_ENTITY_SINGLE_FIELD=PASS', () => {
    const frame = createSemanticFrame({
      rawQuery: 'akreditasi prodi SI dan TI apa saja?',
      entities: [
        { canonical: 'S1 Sistem Informasi', family: 'program', type: 'academic_program' },
        { canonical: 'S1 Teknologi Informasi', family: 'program', type: 'academic_program' }
      ],
      requestedFields: ['accreditation']
    });

    const plan = createRetrievalPlan(frame);
    expect(plan.subrequests.length).toBe(1);
    expect(plan.subrequests[0].bindings.length).toBe(2);

    const ents = plan.subrequests[0].bindings.map(b => b.entity.canonical);
    expect(ents).toContain('S1 Sistem Informasi');
    expect(ents).toContain('S1 Teknologi Informasi');
    expect(plan.subrequests[0].bindings[0].requestedField).toBe('accreditation');
    expect(plan.subrequests[0].bindings[1].requestedField).toBe('accreditation');
  });

  test('MULTI_ENTITY_MULTI_FIELD=PASS', () => {
    const frame = createSemanticFrame({
      rawQuery: 'akreditasi dan biaya kuliah SI dan TI apa saja?',
      entities: [
        { canonical: 'S1 Sistem Informasi', family: 'program', type: 'academic_program' },
        { canonical: 'S1 Teknologi Informasi', family: 'program', type: 'academic_program' }
      ],
      requestedFields: ['accreditation', 'tuitionFee']
    });

    const plan = createRetrievalPlan(frame);
    expect(plan.subrequests.length).toBe(1);
    expect(plan.subrequests[0].bindings.length).toBe(4);

    const bindingSignatures = plan.subrequests[0].bindings.map(b => `${b.entity.canonical}:${b.requestedField}`);
    expect(bindingSignatures).toContain('S1 Sistem Informasi:accreditation');
    expect(bindingSignatures).toContain('S1 Sistem Informasi:tuitionFee');
    expect(bindingSignatures).toContain('S1 Teknologi Informasi:accreditation');
    expect(bindingSignatures).toContain('S1 Teknologi Informasi:tuitionFee');
  });

  test('SECONDARY_ENTITY_NOT_STARVED=PASS & THIRD_ENTITY_NOT_STARVED=PASS', async () => {
    const frame = createSemanticFrame({
      rawQuery: 'akreditasi SI, TI, dan BD apa saja?',
      entities: [
        { canonical: 'S1 Sistem Informasi', family: 'program' },
        { canonical: 'S1 Teknologi Informasi', family: 'program' },
        { canonical: 'S1 Bisnis Digital', family: 'program' }
      ],
      requestedFields: ['accreditation']
    });

    const plan = createRetrievalPlan(frame);
    expect(plan.subrequests[0].bindings.length).toBe(3);

    // Mock retrieval index with distinct hits
    const mockFullCorpus = [
      { id: 0, text: 'Akreditasi S1 Sistem Informasi adalah Unggul' },
      { id: 1, text: 'Akreditasi S1 Teknologi Informasi adalah Baik Sekali' },
      { id: 2, text: 'Akreditasi S1 Bisnis Digital adalah Baik Sekali' }
    ];

    const mockLookup = (hints, invIndex, budget) => {
      const q = hints.join(' ').toLowerCase();
      const hits = [];
      if (q.includes('sistem informasi')) hits.push(0);
      if (q.includes('teknologi informasi')) hits.push(1);
      if (q.includes('bisnis digital')) hits.push(2);
      return hits.slice(0, budget);
    };

    const execResult = await executeRetrievalPlan(plan, {
      getCachedSemanticIndex: () => mockFullCorpus,
      getCachedInvertedIndex: () => ({ mock: true }),
      lookupCandidateChunkIndices: mockLookup
    });

    // Verify per-binding results
    expect(execResult.bindingResults.length).toBe(3);
    const b0 = execResult.bindingResults.find(b => b.entity === 'S1 Sistem Informasi');
    const b1 = execResult.bindingResults.find(b => b.entity === 'S1 Teknologi Informasi');
    const b2 = execResult.bindingResults.find(b => b.entity === 'S1 Bisnis Digital');

    expect(b0.candidateCount).toBeGreaterThan(0);
    expect(b1.candidateCount).toBeGreaterThan(0); // SECONDARY_ENTITY_NOT_STARVED
    expect(b2.candidateCount).toBeGreaterThan(0); // THIRD_ENTITY_NOT_STARVED
  });

  test('OPEN_WORLD_ENTITY_GETS_RETRIEVAL_BINDING=PASS & PLANNER_INVENTED_ENTITY_COUNT=0', () => {
    // Upstream semantics identified an open-world entity from evidence
    const frame = createSemanticFrame({
      rawQuery: 'apakah ada sertifikasi LinkedIn Learning di stikom?',
      entities: [{
        canonical: 'LinkedIn Learning',
        family: 'academic_qualification',
        type: 'certification',
        source: 'evidence',
        isOpenWorld: true
      }],
      requestedFields: ['certification']
    });

    const plan = createRetrievalPlan(frame);
    expect(plan.subrequests[0].bindings.length).toBe(1);
    const b = plan.subrequests[0].bindings[0];
    expect(b.entity.canonical).toBe('LinkedIn Learning');
    expect(b.entity.isOpenWorld).toBe(true);
    expect(b.retrievalHints).toContain('LinkedIn Learning');

    // Test that planner does NOT invent entities when none exist
    const emptyFrame = createSemanticFrame({
      rawQuery: 'apakah kampus ini bagus dan modern?',
      entities: [],
      requestedFields: ['profile']
    });
    const emptyPlan = createRetrievalPlan(emptyFrame);
    expect(emptyPlan.subrequests[0].bindings[0].entity).toBeNull();
    expect(emptyPlan.subrequests[0].bindings[0].scopeType).toBe(SCOPE_TYPES.INSTITUTION_ROOT);
  });

  test('SPECIFIC_FIELD_PRESERVED_IN_PLAN=PASS', () => {
    const frame = createSemanticFrame({
      rawQuery: 'apa akun instagram resmi stikom bali?',
      entities: [],
      requestedFields: ['instagram']
    });

    const plan = createRetrievalPlan(frame);
    const b = plan.subrequests[0].bindings[0];
    expect(b.requestedField).toBe('instagram');
    expect(b.fieldFamily).toBe('social_media');
    // Primary hints must preserve specific field 'instagram'
    expect(b.primaryFieldHints).toContain('instagram');
    // Secondary family hints provide broader recall
    expect(b.secondaryFamilyHints).toContain('sosmed');
    // Specific field is ordered first in retrieval hints
    expect(b.retrievalHints[0]).toBe('instagram');
  });

  test('RELATION_BOTH_SIDES_PRESERVED=PASS & RELATION_SUBJECT_RETRIEVED=PASS & RELATION_OBJECT_RETRIEVED=PASS', async () => {
    const frame = createSemanticFrame({
      rawQuery: 'apakah double degree DNUI setara dengan student exchange?',
      entities: [
        { canonical: 'Double Degree DNUI', family: 'international_program' },
        { canonical: 'Student Exchange', family: 'international_program' }
      ],
      relations: [{
        type: 'equivalent_to',
        subject: { canonical: 'Double Degree DNUI', family: 'international_program' },
        object: { canonical: 'Student Exchange', family: 'international_program' },
        field: 'academicPolicy'
      }],
      requestedFields: ['academicPolicy']
    });

    const plan = createRetrievalPlan(frame);
    expect(plan.subrequests[0].bindings.length).toBe(2);

    const subjectBinding = plan.subrequests[0].bindings.find(b => b.role === 'subject');
    const objectBinding = plan.subrequests[0].bindings.find(b => b.role === 'object');

    expect(subjectBinding).toBeDefined();
    expect(objectBinding).toBeDefined();
    expect(subjectBinding.entity.canonical).toBe('Double Degree DNUI');
    expect(objectBinding.entity.canonical).toBe('Student Exchange');
    expect(subjectBinding.scopeType).toBe(SCOPE_TYPES.RELATION_SIDE);
    expect(objectBinding.scopeType).toBe(SCOPE_TYPES.RELATION_SIDE);
  });

  test('NEGATED_FIELD_NOT_RETRIEVED=PASS', () => {
    const frame = createSemanticFrame({
      rawQuery: 'jadwal pendaftaran pmb bukan biaya kuliah?',
      entities: [],
      requestedFields: ['schedule'],
      constraints: {
        exclude: ['fee', 'biaya']
      },
      explicitSemantics: {
        isNegatedFee: true
      }
    });

    const plan = createRetrievalPlan(frame);
    const b = plan.subrequests[0].bindings[0];
    expect(b.requestedField).toBe('schedule');

    // Fee tokens must NOT appear in retrieval hints
    for (const hint of b.retrievalHints) {
      expect(hint.toLowerCase()).not.toContain('biaya');
      expect(hint.toLowerCase()).not.toContain('spp');
      expect(hint.toLowerCase()).not.toContain('dpp');
      expect(hint.toLowerCase()).not.toContain('ukt');
    }
  });

  test('CONTEXT_BINDING_PRESERVED=PASS', () => {
    const frame = createSemanticFrame({
      rawQuery: 'berapa biayanya?',
      entities: [{
        canonical: 'S1 Sistem Informasi',
        family: 'program',
        provenance: 'PRIOR_CONTEXT_INHERITED'
      }],
      requestedFields: ['tuitionFee']
    });

    const plan = createRetrievalPlan(frame);
    const b = plan.subrequests[0].bindings[0];
    expect(b.entity.canonical).toBe('S1 Sistem Informasi');
    expect(b.provenance).toBe('PRIOR_CONTEXT_INHERITED');
  });

  test('MULTI_SUBREQUEST_BINDINGS_ISOLATED=PASS & PLANNER_DOES_NOT_REINTERPRET_SUBREQUEST=PASS', () => {
    // Input is a ResolvedRequestBundle with 2 explicit subrequests
    const bundle = {
      subrequests: [
        {
          subrequestId: 'subreq_0',
          ownedEntities: [{ canonical: 'S1 Sistem Informasi', family: 'program' }],
          ownedFields: ['tuitionFee'],
          constraints: {}
        },
        {
          subrequestId: 'subreq_1',
          ownedEntities: [{ canonical: 'UKM RADE', family: 'organization' }],
          ownedFields: ['organizationProfile'],
          constraints: {}
        }
      ]
    };

    const plan = createRetrievalPlan(bundle);
    expect(plan.subrequests.length).toBe(2);

    expect(plan.subrequests[0].subrequestId).toBe('subreq_0');
    expect(plan.subrequests[0].bindings.length).toBe(1);
    expect(plan.subrequests[0].bindings[0].entity.canonical).toBe('S1 Sistem Informasi');
    expect(plan.subrequests[0].bindings[0].requestedField).toBe('tuitionFee');

    expect(plan.subrequests[1].subrequestId).toBe('subreq_1');
    expect(plan.subrequests[1].bindings.length).toBe(1);
    expect(plan.subrequests[1].bindings[0].entity.canonical).toBe('UKM RADE');
    expect(plan.subrequests[1].bindings[0].requestedField).toBe('organizationProfile');

    // Complete isolation: Subreq 0 has no RADE, Subreq 1 has no Sistem Informasi
    expect(plan.subrequests[0].bindings.some(b => b.entity?.canonical === 'UKM RADE')).toBe(false);
    expect(plan.subrequests[1].bindings.some(b => b.entity?.canonical === 'S1 Sistem Informasi')).toBe(false);
  });

  test('PARTIAL_EVIDENCE_BINDINGS_REMAIN_SEPARATE=PASS', async () => {
    const frame = createSemanticFrame({
      rawQuery: 'biaya kuliah SI dan program magang jepang berapa?',
      entities: [
        { canonical: 'S1 Sistem Informasi', family: 'program' },
        { canonical: 'Magang Jepang', family: 'international_program' }
      ],
      requestedFields: ['tuitionFee']
    });

    const plan = createRetrievalPlan(frame);
    expect(plan.subrequests[0].bindings.length).toBe(2);

    const mockCorpus = [
      { id: 0, text: 'Biaya SPP S1 Sistem Informasi adalah 8.000.000' }
      // Magang Jepang has NO fee evidence in mock corpus
    ];

    const mockLookup = (hints, inv, budget) => {
      const q = hints.join(' ').toLowerCase();
      if (q.includes('sistem informasi')) return [0];
      return []; // Zero candidates for Magang Jepang
    };

    const execResult = await executeRetrievalPlan(plan, {
      getCachedSemanticIndex: () => mockCorpus,
      getCachedInvertedIndex: () => ({ mock: true }),
      lookupCandidateChunkIndices: mockLookup
    });

    const bSI = execResult.bindingResults.find(b => b.entity === 'S1 Sistem Informasi');
    const bMJ = execResult.bindingResults.find(b => b.entity === 'Magang Jepang');

    expect(bSI.candidateCount).toBe(1);
    expect(bMJ.candidateCount).toBe(0); // Remains cleanly separate! Not collapsed!
  });

  test('SHARED_CHUNK_MULTI_BINDING_PROVENANCE=PASS', async () => {
    // Both entities match the exact same overview table chunk
    const frame = createSemanticFrame({
      rawQuery: 'biaya kuliah SI dan TI berapa?',
      entities: [
        { canonical: 'S1 Sistem Informasi', family: 'program' },
        { canonical: 'S1 Teknologi Informasi', family: 'program' }
      ],
      requestedFields: ['tuitionFee']
    });

    const plan = createRetrievalPlan(frame);

    const mockCorpus = [
      { id: 42, text: 'Tabel Biaya Kuliah FTI: S1 Sistem Informasi dan S1 Teknologi Informasi' }
    ];

    const mockLookup = () => [0]; // Both bindings retrieve chunk 0

    const execResult = await executeRetrievalPlan(plan, {
      getCachedSemanticIndex: () => mockCorpus,
      getCachedInvertedIndex: () => ({ mock: true }),
      lookupCandidateChunkIndices: mockLookup
    });

    expect(execResult.candidates.length).toBe(1);
    const sharedChunk = execResult.candidates[0];
    expect(sharedChunk.chunkIndex).toBe(0);
    expect(sharedChunk.supportedBindingIds.length).toBe(2);
    expect(sharedChunk.supportedEntities).toContain('S1 Sistem Informasi');
    expect(sharedChunk.supportedEntities).toContain('S1 Teknologi Informasi');
  });

  test('ENTITYLESS_INSTITUTION_FIELD_BINDING=PASS & ENTITYLESS_BUT_WELL_SCOPED_QUERY_STILL_GETS_RETRIEVAL_BINDING=PASS', () => {
    const frame = createSemanticFrame({
      rawQuery: 'apa nomor telepon narahubung stikom bali?',
      entities: [],
      requestedFields: ['phone']
    });

    const plan = createRetrievalPlan(frame);
    expect(plan.subrequests[0].bindings.length).toBe(1);
    const b = plan.subrequests[0].bindings[0];
    expect(b.entity).toBeNull();
    expect(b.scopeType).toBe(SCOPE_TYPES.INSTITUTION_ROOT);
    expect(b.requestedField).toBe('phone');
    expect(b.retrievalHints).toContain('telepon');
  });

  test('ENTITY_PROFILE_REQUEST_GETS_VALID_BINDING=PASS', () => {
    const frame = createSemanticFrame({
      rawQuery: 'apa itu ukm mcos?',
      entities: [{ canonical: 'UKM MCOS', family: 'organization', type: 'student_activity_unit' }],
      requestedFields: [] // zero factual fields
    });

    const plan = createRetrievalPlan(frame);
    expect(plan.subrequests[0].bindings.length).toBe(1);
    const b = plan.subrequests[0].bindings[0];
    expect(b.entity.canonical).toBe('UKM MCOS');
    expect(b.requestedField).toBe('profile');
    expect(b.retrievalHints).toContain('profil');
  });

  test('DETERMINISTIC_PLAN_OUTPUT=PASS', () => {
    const frame = createSemanticFrame({
      rawQuery: 'akreditasi dan biaya sistem informasi',
      entities: [{ canonical: 'S1 Sistem Informasi', family: 'program' }],
      requestedFields: ['accreditation', 'tuitionFee']
    });

    const plan1 = createRetrievalPlan(frame);
    const plan2 = createRetrievalPlan(frame);

    expect(JSON.stringify(plan1)).toBe(JSON.stringify(plan2));
  });

  test('SEMANTIC_FRAME_NOT_MUTATED=PASS', () => {
    const frame = createSemanticFrame({
      rawQuery: 'biaya kuliah sistem informasi',
      entities: [{ canonical: 'S1 Sistem Informasi', family: 'program' }],
      requestedFields: ['tuitionFee']
    });

    expect(Object.isFrozen(frame)).toBe(true);
    expect(() => {
      createRetrievalPlan(frame);
    }).not.toThrow();

    // Verify properties remain unmodified
    expect(frame.entities[0].canonical).toBe('S1 Sistem Informasi');
    expect(frame.requestedFields[0]).toBe('tuitionFee');
  });

  test('NO_RUNTIME_FULL_CORPUS_SCAN=PASS & TRAINING_DATA_FULL_SCAN_PER_BINDING=NO', async () => {
    const frame = createSemanticFrame({
      rawQuery: 'biaya sistem informasi',
      entities: [{ canonical: 'S1 Sistem Informasi', family: 'program' }],
      requestedFields: ['tuitionFee']
    });

    const plan = createRetrievalPlan(frame);
    const execResult = await executeRetrievalPlan(plan, {
      getCachedSemanticIndex: () => Array(838).fill({ text: 'chunk' }),
      getCachedInvertedIndex: () => ({ tokenMap: new Map() }),
      lookupCandidateChunkIndices: () => [1, 2, 3]
    });

    expect(execResult.telemetry.fullScanUsed).toBe(false);
    expect(execResult.telemetry.trainingDataFullScanPerBinding).toBe(false);
  });

  test('FOUNDING_DATE_BINDING_GETS_CANDIDATES=PASS & MATERIAL_FIELD_QUALIFIER_PRESERVED_IN_RETRIEVAL=PASS', async () => {
    const frame = createSemanticFrame({
      rawQuery: 'kapan tahun berdirinya stikom bali?',
      entities: [],
      requestedFields: ['foundingDate']
    });

    const plan = createRetrievalPlan(frame);
    expect(plan.subrequests.length).toBe(1);
    expect(plan.subrequests[0].bindings.length).toBe(1);

    const b = plan.subrequests[0].bindings[0];
    expect(b.requestedField).toBe('foundingDate');
    expect(b.primaryFieldHints).toContain('berdiri');
    expect(b.primaryFieldHints).toContain('sejarah');
    expect(b.secondaryFamilyHints).toContain('sejarah');

    const mockFullCorpus = [
      { id: 0, text: 'Profil Umum & Sejarah Institusi. Didirikan pada tanggal 20 Mei 2001 oleh Yayasan Widya Dharma Shanti... SK Mendiknas No. 157/D/O/2002 tertanggal 10 Agustus 2002' }
    ];
    const mockLookup = (hints) => {
      const q = hints.join(' ').toLowerCase();
      if (q.includes('berdiri') || q.includes('sejarah') || q.includes('20 mei 2001')) return [0];
      return [];
    };

    const execResult = await executeRetrievalPlan(plan, {
      getCachedSemanticIndex: () => mockFullCorpus,
      getCachedInvertedIndex: () => ({ mock: true }),
      lookupCandidateChunkIndices: mockLookup
    });
    expect(execResult.candidates.length).toBeGreaterThan(0);
    expect(execResult.bindingResults[0].candidateCount).toBeGreaterThan(0);

    const hasFoundingSupport = execResult.candidates.some(c =>
      c.chunk?.text && (c.chunk.text.includes('20 Mei 2001') || c.chunk.text.includes('Didirikan') || c.chunk.text.includes('berdiri'))
    );
    expect(hasFoundingSupport).toBe(true);
  });

  test('FOUNDING_DATE_WITH_NEGATION=PASS', async () => {
    const frame = createSemanticFrame({
      rawQuery: 'tanggal resmi berdirinya kampus, bukan jadwal daftar PMB, kapan?',
      entities: [],
      requestedFields: ['foundingDate'],
      constraints: {
        exclude: ['jadwal daftar pmb', 'jadwal']
      }
    });

    const plan = createRetrievalPlan(frame);
    expect(plan.subrequests[0].bindings.length).toBe(1);
    const b = plan.subrequests[0].bindings[0];
    expect(b.requestedField).toBe('foundingDate');

    const mockFullCorpus = [
      { id: 0, text: 'Profil Umum & Sejarah Institusi. Didirikan pada tanggal 20 Mei 2001 oleh Yayasan Widya Dharma Shanti... SK Mendiknas No. 157/D/O/2002 tertanggal 10 Agustus 2002' }
    ];
    const mockLookup = (hints) => {
      const q = hints.join(' ').toLowerCase();
      if (q.includes('berdiri') || q.includes('sejarah') || q.includes('20 mei 2001')) return [0];
      return [];
    };

    const execResult = await executeRetrievalPlan(plan, {
      getCachedSemanticIndex: () => mockFullCorpus,
      getCachedInvertedIndex: () => ({ mock: true }),
      lookupCandidateChunkIndices: mockLookup
    });
    expect(execResult.candidates.length).toBeGreaterThan(0);
    const hasFoundingSupport = execResult.candidates.some(c =>
      c.chunk?.text && (c.chunk.text.includes('20 Mei 2001') || c.chunk.text.includes('Didirikan') || c.chunk.text.includes('berdiri'))
    );
    expect(hasFoundingSupport).toBe(true);
  });

  test('NEGATED_FIELD_BINDING_COUNT=0 & NEGATED_FIELD_RETRIEVAL_COUNT=0', () => {
    const frame = createSemanticFrame({
      rawQuery: 'jadwal pendaftaran pmb bukan biaya kuliah?',
      entities: [],
      requestedFields: ['schedule', 'feeComponent', 'amount'],
      constraints: {
        exclude: ['biaya kuliah', 'biaya']
      }
    });

    const plan = createRetrievalPlan(frame);
    // feeComponent and amount are excluded, so only schedule should remain
    expect(plan.subrequests[0].bindings.length).toBe(1);
    expect(plan.subrequests[0].bindings[0].requestedField).toBe('schedule');

    const feeBindings = plan.subrequests[0].bindings.filter(b =>
      b.requestedField === 'tuitionFee' || b.requestedField === 'feeComponent' || b.requestedField === 'amount'
    );
    expect(feeBindings.length).toBe(0);
  });

  test('REDUNDANT_DERIVED_BINDING_SUPPRESSED=PASS & GENUINE_MULTI_FIELD_BINDINGS_PRESERVED=PASS', () => {
    // Redundant slots suppressed when authoritative field exists
    const frameRedundant = createSemanticFrame({
      rawQuery: 'berapa biaya pendaftaran pmb?',
      entities: [],
      requestedFields: ['registrationFee', 'feeComponent', 'amount', 'date']
    });
    const planRedundant = createRetrievalPlan(frameRedundant);
    expect(planRedundant.subrequests[0].bindings.length).toBe(1);
    expect(planRedundant.subrequests[0].bindings[0].requestedField).toBe('registrationFee');

    // Genuine multi-field preserved
    const frameMulti = createSemanticFrame({
      rawQuery: 'akreditasi dan biaya kuliah sistem informasi berapa?',
      entities: [{ canonical: 'S1 Sistem Informasi', family: 'program' }],
      requestedFields: ['accreditation', 'tuitionFee']
    });
    const planMulti = createRetrievalPlan(frameMulti);
    expect(planMulti.subrequests[0].bindings.length).toBe(2);
    const fields = planMulti.subrequests[0].bindings.map(b => b.requestedField);
    expect(fields).toContain('accreditation');
    expect(fields).toContain('tuitionFee');
  });

  test('SPECIFIC_FIELD_CASES: instagram, competencyCertification, registrationFee', () => {
    // 1. Instagram
    const frameIg = createSemanticFrame({
      rawQuery: 'apa instagram resmi stikom?',
      entities: [],
      requestedFields: ['instagram']
    });
    const planIg = createRetrievalPlan(frameIg);
    expect(planIg.subrequests[0].bindings[0].requestedField).toBe('instagram');
    expect(planIg.subrequests[0].bindings[0].fieldFamily).toBe('social_media');

    // 2. CompetencyCertification
    const frameCert = createSemanticFrame({
      rawQuery: 'sertifikasi kompetensi apa yang didapat lulusan?',
      entities: [],
      requestedFields: ['competencyCertification']
    });
    const planCert = createRetrievalPlan(frameCert);
    expect(planCert.subrequests[0].bindings[0].requestedField).toBe('competencyCertification');
    expect(planCert.subrequests[0].bindings[0].fieldFamily).toBe('certification');

    // 3. RegistrationFee
    const frameReg = createSemanticFrame({
      rawQuery: 'biaya pendaftaran pmb berapa?',
      entities: [],
      requestedFields: ['registrationFee']
    });
    const planReg = createRetrievalPlan(frameReg);
    expect(planReg.subrequests[0].bindings[0].requestedField).toBe('registrationFee');
    expect(planReg.subrequests[0].bindings[0].fieldFamily).toBe('fee');
  });
});

