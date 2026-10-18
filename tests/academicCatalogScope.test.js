'use strict';

/**
 * tests/academicCatalogScope.test.js
 *
 * CHAT ENGINE V2 — PHASE 2B-1 REGRESSION & PROPERTY-BASED TEST SUITE
 * General Academic Catalog Scope and Evidence-Grounded Generation
 *
 * Property Invariants Verified:
 * 1. S1 scope strictly contains only S1 bachelor programs.
 * 2. D3 scope strictly contains only D3 diploma programs.
 * 3. S2 scope strictly contains only S2 master programs.
 * 4. ALL catalog encompasses only officially verified available degrees supported by sources.
 * 5. English queries preserve identical degree boundaries as Indonesian queries.
 * 6. Explicit degree scope is strictly preserved when semantic frame passes through async resolution.
 * 7. Empty evidence does not produce ungrounded factual answers; unsupported/unknown scopes refuse ungrounded generation without broadening.
 * 8. Non-catalog queries (e.g. UKM, specific prodi profile, facilities, scholarship) never erroneously enter static catalog summary.
 */

const {
  resolveSemanticFrame,
  resolveSemanticFrameAsync,
  detectUnsupportedProgram
} = require('../src/core/semanticFrameResolver');

const {
  buildGroundedDeterministicSummary,
  synthesizeAnswer,
  normalizeAcademicScope,
  getCatalogEntriesByScope,
  generateGroundedCatalogSummary,
  INSTITUTIONAL_ACADEMIC_CATALOG
} = require('../src/core/groundedAnswerGenerator');

const { CANONICAL_ENTITIES } = require('../src/engine/canonicalEntityRegistry');
const { buildExecutionPlan } = require('../src/reasoning/phase2Planner');
const { buildRetrievalPlan } = require('../src/core/retrievalPlanner');
const {
  ACADEMIC_SCOPE_STATUS,
  PROGRAM_AVAILABILITY_STATUS,
  SUPPORTED_CANONICAL_DEGREES,
  resolveAcademicScope,
  evaluateProgramAvailability
} = require('../src/core/academicCatalog');

describe('Phase 2B-1: Academic Catalog Scope & Grounding Verification', () => {
  jest.setTimeout(60000);

  // =========================================================================
  // Property 1: S1 strictly contains only S1 programs
  // =========================================================================
  describe('Property 1: S1 Scope Restriction', () => {
    test('1. S1 scope strictly contains only S1 programs and excludes D3, S2, and International', () => {
      const s1Frame = {
        domain: 'ACADEMIC_PROGRAM',
        intent: 'AVAILABLE_PROGRAMS_LIST',
        scopeLevel: 'S1',
        rawQuery: 'program s1 apa saja yang ada?'
      };

      const entries = getCatalogEntriesByScope('S1');
      expect(entries.length).toBe(4);
      for (const entry of entries) {
        expect(entry.degree).toBe('S1');
        const regMatch = CANONICAL_ENTITIES.find(e => e.canonical === entry.canonical);
        expect(regMatch).toBeDefined();
        expect(regMatch.degree).toBe('S1');
      }

      const summary = buildGroundedDeterministicSummary(s1Frame, []);
      expect(summary).toBeTruthy();

      // S1 positive programs
      expect(summary).toMatch(/S1 Sistem Informasi/i);
      expect(summary).toMatch(/S1 Sistem Komputer/i);
      expect(summary).toMatch(/S1 Teknologi Informasi/i);
      expect(summary).toMatch(/S1 Bisnis Digital/i);

      // Strict degree boundaries: D3, S2, International MUST NOT appear
      expect(summary).not.toMatch(/D3 Manajemen Informatika/i);
      expect(summary).not.toMatch(/Program Diploma/i);
      expect(summary).not.toMatch(/S2 Magister/i);
      expect(summary).not.toMatch(/Program Pascasarjana/i);
      expect(summary).not.toMatch(/International Dual Degree/i);
    });
  });

  // =========================================================================
  // Property 2: D3 strictly contains only D3 programs
  // =========================================================================
  describe('Property 2: D3 Scope Restriction', () => {
    test('2. D3 scope strictly contains only D3 programs and excludes S1, S2, and International', () => {
      const d3Frame = {
        domain: 'ACADEMIC_PROGRAM',
        intent: 'AVAILABLE_PROGRAMS_LIST',
        scopeLevel: 'D3',
        rawQuery: 'program diploma d3 ada apa saja?'
      };

      const entries = getCatalogEntriesByScope('D3');
      expect(entries.length).toBe(1);
      expect(entries[0].canonical).toBe('D3 Manajemen Informatika');
      expect(entries[0].degree).toBe('D3');

      const summary = buildGroundedDeterministicSummary(d3Frame, []);
      expect(summary).toBeTruthy();

      // D3 positive program
      expect(summary).toMatch(/D3 Manajemen Informatika/i);

      // Strict degree boundaries: S1, S2, International MUST NOT appear
      expect(summary).not.toMatch(/S1 Sistem Informasi/i);
      expect(summary).not.toMatch(/S1 Bisnis Digital/i);
      expect(summary).not.toMatch(/S1 Sistem Komputer/i);
      expect(summary).not.toMatch(/S1 Teknologi Informasi/i);
      expect(summary).not.toMatch(/S2 Magister/i);
      expect(summary).not.toMatch(/International Dual Degree/i);
    });
  });

  // =========================================================================
  // Property 3: S2 strictly contains only S2 programs
  // =========================================================================
  describe('Property 3: S2 Scope Restriction', () => {
    test('3. S2 scope strictly contains only S2 programs supported by catalog sources', () => {
      const s2Frame = {
        domain: 'ACADEMIC_PROGRAM',
        intent: 'AVAILABLE_PROGRAMS_LIST',
        scopeLevel: 'S2',
        rawQuery: 'apakah ada program magister s2?'
      };

      const entries = getCatalogEntriesByScope('S2');
      expect(entries.length).toBe(1);
      expect(entries[0].degree).toBe('S2');

      const summary = buildGroundedDeterministicSummary(s2Frame, []);
      expect(summary).toBeTruthy();

      // S2 positive program
      expect(summary).toMatch(/S2 Magister Sistem Informasi/i);

      // Strict degree boundaries: S1 and D3 MUST NOT appear
      expect(summary).not.toMatch(/S1 Sistem Informasi/i);
      expect(summary).not.toMatch(/S1 Bisnis Digital/i);
      expect(summary).not.toMatch(/D3 Manajemen Informatika/i);
      expect(summary).not.toMatch(/Program Diploma/i);
    });
  });

  // =========================================================================
  // Property 4: Complete catalog (ALL) encompasses all officially available degrees
  // =========================================================================
  describe('Property 4: Complete Catalog (ALL) Scope', () => {
    test('4. ALL catalog encompasses S1, D3, S2, and International programs without inventing unsupported degrees', () => {
      const allFrame = {
        domain: 'ACADEMIC_PROGRAM',
        intent: 'AVAILABLE_PROGRAMS_LIST',
        scopeLevel: 'ALL',
        rawQuery: 'daftar jurusan apa saja yang ada di kampus?'
      };

      const allEntries = getCatalogEntriesByScope('ALL');
      expect(allEntries.length).toBe(6);

      const summary = buildGroundedDeterministicSummary(allFrame, []);
      expect(summary).toBeTruthy();

      expect(summary).toMatch(/Program Sarjana \(S1\)/i);
      expect(summary).toMatch(/S1 Sistem Informasi/i);
      expect(summary).toMatch(/S1 Bisnis Digital/i);

      expect(summary).toMatch(/Program Diploma \(D3\)/i);
      expect(summary).toMatch(/D3 Manajemen Informatika/i);

      expect(summary).toMatch(/Program Pascasarjana \(S2\)/i);
      expect(summary).toMatch(/S2 Magister Sistem Informasi/i);

      expect(summary).toMatch(/Program Kelas Internasional/i);
      expect(summary).toMatch(/International Dual Degree/i);

      // Must NOT invent unoffered degrees (e.g. S3 Doktor, D4 Sarjana Terapan)
      expect(summary).not.toMatch(/S3\b|Doktor/i);
      expect(summary).not.toMatch(/D4\b|Sarjana Terapan/i);
    });
  });

  // =========================================================================
  // Property 5: English queries preserve identical degree boundaries
  // =========================================================================
  describe('Property 5: Cross-Lingual English Boundary Preservation', () => {
    test('5a. English Bachelor inquiry produces only S1 programs', () => {
      const frameEnS1 = {
        domain: 'ACADEMIC_PROGRAM',
        intent: 'AVAILABLE_PROGRAMS_LIST',
        scopeLevel: 'S1',
        language: 'en',
        rawQuery: 'What undergraduate bachelor study programs are offered?'
      };

      const summary = buildGroundedDeterministicSummary(frameEnS1, []);
      expect(summary).toBeTruthy();
      expect(summary).toMatch(/Undergraduate \(Bachelor\/S1\)/i);
      expect(summary).toMatch(/S1 Information Systems/i);
      expect(summary).toMatch(/S1 Computer Systems/i);
      expect(summary).toMatch(/S1 Information Technology/i);
      expect(summary).toMatch(/S1 Digital Business/i);

      expect(summary).not.toMatch(/D3/i);
      expect(summary).not.toMatch(/Informatics Management/i);
      expect(summary).not.toMatch(/Master/i);
    });

    test('5b. English Diploma inquiry produces only D3 programs', () => {
      const frameEnD3 = {
        domain: 'ACADEMIC_PROGRAM',
        intent: 'AVAILABLE_PROGRAMS_LIST',
        scopeLevel: 'D3',
        language: 'en',
        rawQuery: 'What diploma associate study programs are available?'
      };

      const summary = buildGroundedDeterministicSummary(frameEnD3, []);
      expect(summary).toBeTruthy();
      expect(summary).toMatch(/Diploma \(D3\)/i);
      expect(summary).toMatch(/D3 Informatics Management/i);

      expect(summary).not.toMatch(/S1 Information Systems/i);
      expect(summary).not.toMatch(/Digital Business/i);
      expect(summary).not.toMatch(/Master/i);
    });

    test('5c. English Master inquiry produces only S2 programs', () => {
      const frameEnS2 = {
        domain: 'ACADEMIC_PROGRAM',
        intent: 'AVAILABLE_PROGRAMS_LIST',
        scopeLevel: 'S2',
        language: 'en',
        rawQuery: 'What graduate master degree programs do you have?'
      };

      const summary = buildGroundedDeterministicSummary(frameEnS2, []);
      expect(summary).toBeTruthy();
      expect(summary).toMatch(/Postgraduate \(Master\/S2\)/i);
      expect(summary).toMatch(/S2 Master of Information Systems/i);

      expect(summary).not.toMatch(/Bachelor/i);
      expect(summary).not.toMatch(/Diploma/i);
    });
  });

  // =========================================================================
  // Property 6: Explicit degree scope is preserved across async resolution
  // =========================================================================
  describe('Property 6: Scope Preservation across Async Path', () => {
    test('6a. Async resolution preserves explicit S1 scope', async () => {
      const query = 'prodi s1 apa saja yang ada?';
      const frame = await resolveSemanticFrameAsync(query);

      expect(frame.domain).toBe('ACADEMIC_PROGRAM');
      expect(frame.intent).toBe('AVAILABLE_PROGRAMS_LIST');
      expect(frame.scopeLevel).toBe('S1');

      const summary = buildGroundedDeterministicSummary(frame, []);
      expect(summary).toMatch(/S1 Sistem Informasi/i);
      expect(summary).not.toMatch(/D3 Manajemen Informatika/i);
    });

    test('6b. Async resolution preserves explicit D3 scope', async () => {
      const query = 'pilihan program diploma d3 apa saja?';
      const frame = await resolveSemanticFrameAsync(query);

      expect(frame.domain).toBe('ACADEMIC_PROGRAM');
      expect(frame.intent).toBe('AVAILABLE_PROGRAMS_LIST');
      expect(frame.scopeLevel).toBe('D3');

      const summary = buildGroundedDeterministicSummary(frame, []);
      expect(summary).toMatch(/D3 Manajemen Informatika/i);
      expect(summary).not.toMatch(/S1 Bisnis Digital/i);
    });

    test('6c. Async resolution preserves explicit S2 scope', async () => {
      const query = 'program studi s2 apa saja yang tersedia?';
      const frame = await resolveSemanticFrameAsync(query);

      expect(frame.domain).toBe('ACADEMIC_PROGRAM');
      expect(frame.intent).toBe('AVAILABLE_PROGRAMS_LIST');
      expect(frame.scopeLevel).toBe('S2');

      const summary = buildGroundedDeterministicSummary(frame, []);
      expect(summary).toMatch(/S2 Magister Sistem Informasi/i);
      expect(summary).not.toMatch(/D3 Manajemen Informatika/i);
      expect(summary).not.toMatch(/S1 Bisnis Digital/i);
    });

    test('6d. Async resolution preserves unscoped ALL scope', async () => {
      const query = 'program studi apa saja yang tersedia di ITB STIKOM Bali?';
      const frame = await resolveSemanticFrameAsync(query);

      expect(frame.domain).toBe('ACADEMIC_PROGRAM');
      expect(frame.intent).toBe('AVAILABLE_PROGRAMS_LIST');
      expect(frame.scopeLevel).toBe('ALL');

      const summary = buildGroundedDeterministicSummary(frame, []);
      expect(summary).toMatch(/Program Sarjana \(S1\)/i);
      expect(summary).toMatch(/Program Diploma \(D3\)/i);
      expect(summary).toMatch(/Program Pascasarjana \(S2\)/i);
    });
  });

  // =========================================================================
  // Property 7: Evidence grounding & unknown scope refusal
  // =========================================================================
  describe('Property 7: Evidence Grounding & Refusal of Unsupported Scopes', () => {
    test('7a. Unknown or unsupported degree scope (e.g. S3, D4) does not broaden to ALL and refuses ungrounded generation', async () => {
      const s3Frame = {
        domain: 'ACADEMIC_PROGRAM',
        intent: 'AVAILABLE_PROGRAMS_LIST',
        scopeLevel: 'S3',
        rawQuery: 'daftar prodi s3 doktor apa saja?'
      };

      const entries = getCatalogEntriesByScope('S3');
      expect(entries).toEqual([]);

      const summary = buildGroundedDeterministicSummary(s3Frame, []);
      expect(summary).toBeNull();

      const result = await synthesizeAnswer(s3Frame, { acceptedEvidence: [] });
      expect(result.success).toBe(false);
      expect(result.answer).toBeNull();
    });

    test('7b. D4 scope is recognized as unoffered and refuses ungrounded generation without broadening', async () => {
      const d4Frame = {
        domain: 'ACADEMIC_PROGRAM',
        intent: 'AVAILABLE_PROGRAMS_LIST',
        scopeLevel: 'D4',
        rawQuery: 'apakah ada program d4 sarjana terapan?'
      };

      const entries = getCatalogEntriesByScope('D4');
      expect(entries).toEqual([]);

      const summary = buildGroundedDeterministicSummary(d4Frame, []);
      expect(summary).toBeNull();

      const result = await synthesizeAnswer(d4Frame, { acceptedEvidence: [] });
      expect(result.success).toBe(false);
      expect(result.answer).toBeNull();
    });

    test('7c. Non-catalog inquiry with empty accepted evidence produces null answer (refusal)', async () => {
      const feeFrame = {
        domain: 'TUITION_FEE',
        intent: 'TUITION_FEE_INQUIRY',
        aspects: ['fee'],
        entities: []
      };

      const result = await synthesizeAnswer(feeFrame, { acceptedEvidence: [] });
      expect(result.success).toBe(false);
      expect(result.answer).toBeNull();
    });
  });

  // =========================================================================
  // Property 8: Non-catalog queries do not route to static catalog summary
  // =========================================================================
  describe('Property 8: Non-Catalog Domain Isolation', () => {
    test('8a. UKM inquiry does not enter academic catalog summary even if accepted is empty', () => {
      const ukmFrame = {
        domain: 'ORGANIZATION_UKM',
        intent: 'ORGANIZATION_INQUIRY',
        scopeLevel: null,
        rawQuery: 'saya suka tari cocok masuk ukm apa?'
      };

      const summary = buildGroundedDeterministicSummary(ukmFrame, []);
      expect(summary).toBeNull();
    });

    test('8b. Facility inquiry does not enter academic catalog summary', () => {
      const facilityFrame = {
        domain: 'FACILITIES',
        intent: 'FACILITY_INQUIRY',
        aspects: ['facilities'],
        scopeLevel: null,
        rawQuery: 'kampus punya lab apa saja?'
      };

      const summary = buildGroundedDeterministicSummary(facilityFrame, []);
      expect(summary).toBeNull();
    });

    test('8c. Specific academic program inquiry does not dump generic catalog summary', () => {
      const specificProdiFrame = {
        domain: 'ACADEMIC_PROGRAM',
        intent: 'PROGRAM_OVERVIEW',
        entities: [{ canonical: 'S1 Bisnis Digital', type: 'program', family: 'academic_program' }],
        scopeLevel: 'S1',
        rawQuery: 'apa itu jurusan S1 Bisnis Digital?'
      };

      const summary = buildGroundedDeterministicSummary(specificProdiFrame, []);
      expect(summary).toBeNull();
    });

    test('8d. Scholarship inquiry does not enter academic catalog summary', () => {
      const scholarshipFrame = {
        domain: 'SCHOLARSHIP',
        intent: 'SCHOLARSHIP_INQUIRY',
        aspects: ['scholarship'],
        rawQuery: 'ada beasiswa apa saja di stikom?'
      };

      const summary = buildGroundedDeterministicSummary(scholarshipFrame, []);
      expect(summary).toBeNull();
    });
  });

  // =========================================================================
  // Property 9: Formal Academic Scope Contract Resolver (resolveAcademicScope)
  // =========================================================================
  describe('Property 9: Formal Academic Scope Contract Resolver', () => {
    test('9a. Resolves SUPPORTED scope for Indonesian & English S1, D3, S2, and ALL', () => {
      // S1
      const s1Id = resolveAcademicScope('program sarjana s1');
      expect(s1Id.status).toBe(ACADEMIC_SCOPE_STATUS.SUPPORTED);
      expect(s1Id.level).toBe('S1');
      expect(s1Id.isSupported).toBe(true);

      const s1En = resolveAcademicScope('what bachelor degree courses are offered?');
      expect(s1En.status).toBe(ACADEMIC_SCOPE_STATUS.SUPPORTED);
      expect(s1En.level).toBe('S1');
      expect(s1En.isSupported).toBe(true);

      // D3
      const d3Id = resolveAcademicScope('program diploma d3');
      expect(d3Id.status).toBe(ACADEMIC_SCOPE_STATUS.SUPPORTED);
      expect(d3Id.level).toBe('D3');
      expect(d3Id.isSupported).toBe(true);

      const d3En = resolveAcademicScope('are there associate diploma 3 programs?');
      expect(d3En.status).toBe(ACADEMIC_SCOPE_STATUS.SUPPORTED);
      expect(d3En.level).toBe('D3');
      expect(d3En.isSupported).toBe(true);

      // S2
      const s2Id = resolveAcademicScope('program pascasarjana magister s2');
      expect(s2Id.status).toBe(ACADEMIC_SCOPE_STATUS.SUPPORTED);
      expect(s2Id.level).toBe('S2');
      expect(s2Id.isSupported).toBe(true);

      const s2En = resolveAcademicScope('what master graduate programs are available?');
      expect(s2En.status).toBe(ACADEMIC_SCOPE_STATUS.SUPPORTED);
      expect(s2En.level).toBe('S2');
      expect(s2En.isSupported).toBe(true);

      // ALL
      const allId = resolveAcademicScope('semua program studi semua jenjang');
      expect(allId.status).toBe(ACADEMIC_SCOPE_STATUS.SUPPORTED);
      expect(allId.level).toBe('ALL');
      expect(allId.isSupported).toBe(true);

      const allEn = resolveAcademicScope('all academic degree programs catalog');
      expect(allEn.status).toBe(ACADEMIC_SCOPE_STATUS.SUPPORTED);
      expect(allEn.level).toBe('ALL');
      expect(allEn.isSupported).toBe(true);
    });

    test('9b. Resolves UNSUPPORTED scope for explicit unoffered degrees (S3, D4, PhD, Doktor) without fallback to ALL', () => {
      const s3Id = resolveAcademicScope('apakah ada program s3 doktor?');
      expect(s3Id.status).toBe(ACADEMIC_SCOPE_STATUS.UNSUPPORTED);
      expect(s3Id.level).toBeNull();
      expect(s3Id.isSupported).toBe(false);
      expect(s3Id.rawMention).toBeDefined();

      const phdEn = resolveAcademicScope('what phd or doctorate degrees do you have?');
      expect(phdEn.status).toBe(ACADEMIC_SCOPE_STATUS.UNSUPPORTED);
      expect(phdEn.level).toBeNull();
      expect(phdEn.isSupported).toBe(false);

      const d4Id = resolveAcademicScope('apakah ada jenjang d4 atau sarjana terapan?');
      expect(d4Id.status).toBe(ACADEMIC_SCOPE_STATUS.UNSUPPORTED);
      expect(d4Id.level).toBeNull();
      expect(d4Id.isSupported).toBe(false);

      const d4En = resolveAcademicScope('are there any diploma 4 or d-4 majors?');
      expect(d4En.status).toBe(ACADEMIC_SCOPE_STATUS.UNSUPPORTED);
      expect(d4En.level).toBeNull();
      expect(d4En.isSupported).toBe(false);
    });

    test('9c. Resolves UNSPECIFIED status when user does not specify a degree level (NOT rejected as unsupported)', () => {
      const unspecId = resolveAcademicScope('program studi apa saja yang ada di ITB STIKOM Bali?');
      expect(unspecId.status).toBe(ACADEMIC_SCOPE_STATUS.UNSPECIFIED);
      expect(unspecId.level).toBeNull();
      expect(unspecId.isSupported).toBe(false);

      const unspecEn = resolveAcademicScope('what study programs are offered?');
      expect(unspecEn.status).toBe(ACADEMIC_SCOPE_STATUS.UNSPECIFIED);
      expect(unspecEn.level).toBeNull();
      expect(unspecEn.isSupported).toBe(false);
    });
  });

  // =========================================================================
  // Property 10: Scope Contract Preserved Across Sync & Async Parser Pipelines
  // =========================================================================
  describe('Property 10: Scope Contract Preserved Across Sync & Async Parser Pipelines', () => {
    test('10a. Sync pipeline sets academicScope correctly for S1, D3, S2, UNSPECIFIED, and UNSUPPORTED', () => {
      // S1
      const s1Sync = resolveSemanticFrame('jurusan s1 apa saja yang ada?');
      expect(s1Sync.academicScope.status).toBe(ACADEMIC_SCOPE_STATUS.SUPPORTED);
      expect(s1Sync.academicScope.level).toBe('S1');
      expect(s1Sync.scopeLevel).toBe('S1');

      // D3
      const d3Sync = resolveSemanticFrame('program diploma d3 apa saja yang dibuka?');
      expect(d3Sync.academicScope.status).toBe(ACADEMIC_SCOPE_STATUS.SUPPORTED);
      expect(d3Sync.academicScope.level).toBe('D3');
      expect(d3Sync.scopeLevel).toBe('D3');

      // S2
      const s2Sync = resolveSemanticFrame('daftar prodi pascasarjana s2 apa saja?');
      expect(s2Sync.academicScope.status).toBe(ACADEMIC_SCOPE_STATUS.SUPPORTED);
      expect(s2Sync.academicScope.level).toBe('S2');
      expect(s2Sync.scopeLevel).toBe('S2');

      // Unspecified (valid general query)
      const unspecSync = resolveSemanticFrame('jurusan apa saja yang tersedia?');
      expect(unspecSync.academicScope.status).toBe(ACADEMIC_SCOPE_STATUS.UNSPECIFIED);
      expect(unspecSync.scopeLevel).toBe('ALL'); // Broadens to ALL for catalog listing without rejection

      // Unsupported S3
      const s3Sync = resolveSemanticFrame('program s3 apa saja yang ada?');
      expect(s3Sync.academicScope.status).toBe(ACADEMIC_SCOPE_STATUS.UNSUPPORTED);
      expect(s3Sync.scopeLevel).toBe('UNSUPPORTED');

      // Unsupported D4
      const d4Sync = resolveSemanticFrame('apakah ada program d4 yang tersedia?');
      expect(d4Sync.academicScope.status).toBe(ACADEMIC_SCOPE_STATUS.UNSUPPORTED);
      expect(d4Sync.scopeLevel).toBe('UNSUPPORTED');
    });

    test('10b. Async pipeline preserves identical academicScope and scopeLevel', async () => {
      // S1 async
      const s1Async = await resolveSemanticFrameAsync('what undergraduate bachelor programs are available?');
      expect(s1Async.academicScope.status).toBe(ACADEMIC_SCOPE_STATUS.SUPPORTED);
      expect(s1Async.academicScope.level).toBe('S1');
      expect(s1Async.scopeLevel).toBe('S1');

      // D3 async
      const d3Async = await resolveSemanticFrameAsync('what diploma 3 programs do you have?');
      expect(d3Async.academicScope.status).toBe(ACADEMIC_SCOPE_STATUS.SUPPORTED);
      expect(d3Async.academicScope.level).toBe('D3');
      expect(d3Async.scopeLevel).toBe('D3');

      // S2 async
      const s2Async = await resolveSemanticFrameAsync('what master degree programs are offered?');
      expect(s2Async.academicScope.status).toBe(ACADEMIC_SCOPE_STATUS.SUPPORTED);
      expect(s2Async.academicScope.level).toBe('S2');
      expect(s2Async.scopeLevel).toBe('S2');

      // Unspecified async
      const unspecAsync = await resolveSemanticFrameAsync('what academic programs are offered at ITB STIKOM Bali?');
      expect(unspecAsync.academicScope.status).toBe(ACADEMIC_SCOPE_STATUS.UNSPECIFIED);
      expect(unspecAsync.scopeLevel).toBe('ALL');

      // Unsupported S3 async
      const s3Async = await resolveSemanticFrameAsync('what doctoral phd programs are offered?');
      expect(s3Async.academicScope.status).toBe(ACADEMIC_SCOPE_STATUS.UNSUPPORTED);
      expect(s3Async.scopeLevel).toBe('UNSUPPORTED');

      // Unsupported D4 async
      const d4Async = await resolveSemanticFrameAsync('are there any d4 programs available?');
      expect(d4Async.academicScope.status).toBe(ACADEMIC_SCOPE_STATUS.UNSUPPORTED);
      expect(d4Async.scopeLevel).toBe('UNSUPPORTED');
    });
  });

  // =========================================================================
  // Property 11: Retrieval Planner Scope Contract Adherence
  // =========================================================================
  describe('Property 11: Retrieval Planner Scope Contract Adherence', () => {
    test('11a. UNSPECIFIED scope generates general catalog variants without error', () => {
      const frame = resolveSemanticFrame('program studi apa saja yang ada?');
      const plan = buildRetrievalPlan(frame);

      expect(plan.academicScope.status).toBe(ACADEMIC_SCOPE_STATUS.UNSPECIFIED);
      expect(plan.scopeLevel).toBe('ALL');
      const allText = plan.queryVariants.join(' ');
      expect(allText).toMatch(/sarjana|diploma|magister/i);
    });

    test('11b. SUPPORTED degree scopes generate targeted variants for requested degree only', () => {
      // S1
      const s1Frame = resolveSemanticFrame('program s1 apa saja yang ada?');
      const s1Plan = buildRetrievalPlan(s1Frame);
      expect(s1Plan.academicScope.level).toBe('S1');
      expect(s1Plan.queryVariants.some(v => /sarjana S1/i.test(v))).toBe(true);

      // D3
      const d3Frame = resolveSemanticFrame('program diploma d3 apa saja yang ada?');
      const d3Plan = buildRetrievalPlan(d3Frame);
      expect(d3Plan.academicScope.level).toBe('D3');
      expect(d3Plan.queryVariants.some(v => /diploma D3/i.test(v))).toBe(true);

      // S2
      const s2Frame = resolveSemanticFrame('program magister s2 apa saja yang ada?');
      const s2Plan = buildRetrievalPlan(s2Frame);
      expect(s2Plan.academicScope.level).toBe('S2');
      expect(s2Plan.queryVariants.some(v => /pascasarjana S2/i.test(v))).toBe(true);
    });

    test('11c. UNSUPPORTED degree scope does NOT broaden into ALL or generate general degree lists', () => {
      const s3Frame = resolveSemanticFrame('program s3 apa saja yang ada?');
      const s3Plan = buildRetrievalPlan(s3Frame);

      expect(s3Plan.academicScope.status).toBe(ACADEMIC_SCOPE_STATUS.UNSUPPORTED);
      expect(s3Plan.scopeLevel).toBe('UNSUPPORTED');
      // Must NOT include the broad S1/D3/S2 combined variants
      for (const variant of s3Plan.queryVariants) {
        expect(variant).not.toMatch(/program sarjana S1 Sistem Informasi/i);
        expect(variant).not.toMatch(/pilihan jurusan program studi S1 D3 S2/i);
      }
    });
  });

  // =========================================================================
  // Property 12: End-to-End Grounded Generation with Structured Answerability
  // =========================================================================
  describe('Property 12: End-to-End Grounded Generation with Structured Answerability', () => {
    test('12a. UNSUPPORTED degree scope fails safely with reason: unsupported_degree_scope', async () => {
      const s3Frame = resolveSemanticFrame('program s3 doktor apa saja yang ada?');
      const result = await synthesizeAnswer(s3Frame, { accepted: [] });

      expect(result.success).toBe(false);
      expect(result.answer).toBeNull();
      expect(result.reason).toBe('unsupported_degree_scope');
    });

    test('12b. UNSPECIFIED valid query successfully generates complete grounded catalog', async () => {
      const unspecFrame = resolveSemanticFrame('jurusan apa saja yang tersedia di ITB STIKOM Bali?');
      const result = await synthesizeAnswer(unspecFrame, { accepted: [] });

      expect(result.success).toBe(true);
      expect(result.answer).toBeTruthy();
      expect(result.source).toBe('grounded_deterministic_summary');
      expect(result.answer).toMatch(/Program Sarjana \(S1\)/i);
      expect(result.answer).toMatch(/Program Diploma \(D3\)/i);
      expect(result.answer).toMatch(/Program Pascasarjana \(S2\)/i);
    });

    test('12c. Non-catalog queries (e.g. tuition, accreditation) are isolated and not routed to catalog summary', async () => {
      const tuitionFrame = resolveSemanticFrame('berapa biaya kuliah per semester untuk s1?');
      expect(tuitionFrame.intent).not.toBe('AVAILABLE_PROGRAMS_LIST');
      const tuitionSummary = buildGroundedDeterministicSummary(tuitionFrame, []);
      expect(tuitionSummary).toBeNull();

      const akreditasiFrame = resolveSemanticFrame('bagaimana akreditasi s1 sistem informasi?');
      expect(akreditasiFrame.intent).not.toBe('AVAILABLE_PROGRAMS_LIST');
      const akreditasiSummary = buildGroundedDeterministicSummary(akreditasiFrame, []);
      expect(akreditasiSummary).toBeNull();
    });
  });

  // =========================================================================
  // Property 13: Program Availability Status & Provenance Tri-State Evaluation
  // =========================================================================
  describe('Property 13: Program Availability Status & Provenance Tri-State Evaluation', () => {
    test('13a. "offered" requires official evidence supporting program existence', () => {
      const offeredCandidates = [
        'S1 Sistem Informasi',
        'Sistem Komputer',
        'Teknologi Informasi',
        'Bisnis Digital',
        'D3 Manajemen Informatika',
        'Magister Sistem Informasi',
        'Double Degree'
      ];

      for (const name of offeredCandidates) {
        const result = evaluateProgramAvailability(name);
        expect(result.status).toBe(PROGRAM_AVAILABILITY_STATUS.OFFERED);
        expect(result.canonicalName).toBeTruthy();
        expect(result.provenance).not.toBeNull();
        expect(result.provenance.sourceDocumentName).toBeTruthy();
        expect([
          'VERIFIED_ACTIVE',
          'HISTORICAL_UNVERIFIED_PERIOD',
          'VERIFIED_CORPUS_ACTIVE',
          'VERIFIED_FROM_LOCAL_CORPUS',
          'PARTIALLY_VERIFIED_FROM_CORPUS_DATASET'
        ]).toContain(result.provenance.verificationStatus);
      }
    });

    test('13b. "not_offered" requires sufficient source supporting exclusion within scope and period', () => {
      const unofferedCandidates = [
        'S3 Doktor Ilmu Komputer',
        'Program Doktor Sistem Informasi',
        'D4 Rekayasa Perangkat Lunak',
        'Diploma 4',
        'SMK TI'
      ];

      for (const name of unofferedCandidates) {
        const result = evaluateProgramAvailability(name);
        expect(result.status).toBe(PROGRAM_AVAILABILITY_STATUS.NOT_OFFERED);
        expect(result.canonicalName).toBeNull();
        expect(result.provenance).not.toBeNull();
        expect(result.provenance.sourceDocumentId).toBe('DOC-CORPUS-DEGREE-LIMITS');
        expect(result.provenance.verificationStatus).toBe('VERIFIED_ACTIVE');
        expect(result.reason).toBe('degree_level_outside_institutional_scope');
      }
    });

    test('13c. "unknown" is strictly used when evidence is insufficient (no unverified negative assumptions)', () => {
      // Programs/disciplines not in catalog, unknown aliases, or arbitrary queries
      // must NOT be assumed as "not_offered" without explicit official decrees
      const unknownCandidates = [
        'Kedokteran',
        'Teknik Mesin',
        'Psikologi',
        'Akuntansi',
        'Hukum Internasional',
        'Teknik Nuklir',
        'Sastra Belanda',
        'Program Studi Siluman 123',
        'XYZ Major Alias'
      ];

      for (const name of unknownCandidates) {
        const result = evaluateProgramAvailability(name);
        expect(result.status).toBe(PROGRAM_AVAILABILITY_STATUS.UNKNOWN);
        expect(result.canonicalName).toBeNull();
        expect(result.provenance).toBeNull();
        expect(result.reason).toBe('insufficient_evidence_for_availability_determination');
      }
    });

    test('13d. "unknown" is safely preserved on empty candidate, null, or whitespace-only inputs', () => {
      expect(evaluateProgramAvailability(null).status).toBe(PROGRAM_AVAILABILITY_STATUS.UNKNOWN);
      expect(evaluateProgramAvailability('').status).toBe(PROGRAM_AVAILABILITY_STATUS.UNKNOWN);
      expect(evaluateProgramAvailability('   ').status).toBe(PROGRAM_AVAILABILITY_STATUS.UNKNOWN);
      expect(evaluateProgramAvailability(undefined).status).toBe(PROGRAM_AVAILABILITY_STATUS.UNKNOWN);
    });

    test('13e. detectUnsupportedProgram in semanticFrameResolver does not treat "unknown" programs as unsupported', () => {
      // Direct detection: unknown candidates return null (not unsupported)
      expect(detectUnsupportedProgram('apakah ada jurusan teknik mesin di stikom?')).toBeNull();
      expect(detectUnsupportedProgram('apakah ada jurusan kedokteran di stikom?')).toBeNull();

      // Resolved frame does not route to UNSUPPORTED_PROGRAM domain
      const frameMesin = resolveSemanticFrame('apakah ada jurusan teknik mesin di stikom?');
      expect(frameMesin.domain).not.toBe('UNSUPPORTED_PROGRAM');
      expect(frameMesin.unsupportedProgramName).toBeFalsy();

      const frameKedokteran = resolveSemanticFrame('apakah ada jurusan kedokteran di stikom?');
      expect(frameKedokteran.domain).not.toBe('UNSUPPORTED_PROGRAM');
      expect(frameKedokteran.unsupportedProgramName).toBeFalsy();

      // But explicitly unsupported degree levels with statutory limits MUST be detected
      const frameS3 = resolveSemanticFrame('apakah ada program s3 doktor di stikom?');
      expect(frameS3.academicScope.status).toBe(ACADEMIC_SCOPE_STATUS.UNSUPPORTED);
      expect(frameS3.scopeLevel).toBe('UNSUPPORTED');
    });
  });
});
