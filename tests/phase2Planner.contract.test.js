'use strict';

/**
 * tests/phase2Planner.contract.test.js
 * 
 * Phase 2 Step 1 Contract & Planner Verification Suite.
 * Validates the 4 locked contracts and Step 1 planner requirements:
 * 1. Time Budget Policy (2500ms total, 1500ms replan deadline)
 * 2. Recommendation Feature & Evidence Grounding Contract
 * 3. Dynamic Clarification Options from Authoritative Registry
 * 4. Read-Only Shadow Mode Telemetry & Immutability Assertion
 * 5. Execution Plan Validation: Rejection of invalid plans & unsupported factual claims
 * 6. Ambiguity Resolution: Context inheritance vs. structured clarification
 * 7. Verified entity and context fields preservation
 */

const {
  TOTAL_TURN_BUDGET_MS,
  REPLAN_START_DEADLINE_MS,
  canStartReplan,
  isBudgetExceeded,
  PLAN_TYPE,
  validateProgramFeature,
  getAuthoritativeProgramOptions,
  createShadowTelemetry,
  assertShadowModeSafety,
  validateClaimProvenance,
  validateExecutionPlan
} = require('../src/reasoning/contracts');

const {
  buildExecutionPlan,
  isAmbiguousEntityInquiry
} = require('../src/reasoning/phase2Planner');

const { CANONICAL_ENTITIES } = require('../src/engine/canonicalEntityRegistry');

describe('Phase 2 Step 1: Architectural Contracts & Governance', () => {

  describe('Contract 1: Time Budget Governance', () => {
    test('Total turn budget is locked at 2500ms and replan deadline at 1500ms', () => {
      expect(TOTAL_TURN_BUDGET_MS).toBe(2500);
      expect(REPLAN_START_DEADLINE_MS).toBe(1500);
    });

    test('canStartReplan permits replan strictly before 1500ms and denies at or after 1500ms', () => {
      expect(canStartReplan(0)).toBe(true);
      expect(canStartReplan(1499)).toBe(true);
      expect(canStartReplan(1500)).toBe(false);
      expect(canStartReplan(1800)).toBe(false);
      expect(canStartReplan(2500)).toBe(false);
      expect(canStartReplan(null)).toBe(false);
      expect(canStartReplan(undefined)).toBe(false);
    });

    test('isBudgetExceeded flags timeout strictly at or after 2500ms', () => {
      expect(isBudgetExceeded(1200)).toBe(false);
      expect(isBudgetExceeded(2499)).toBe(false);
      expect(isBudgetExceeded(2500)).toBe(true);
      expect(isBudgetExceeded(2600)).toBe(true);
      expect(isBudgetExceeded('invalid')).toBe(true);
    });
  });

  describe('Contract 2: Recommendation Scoring & Evidence Grounding', () => {
    test('validateProgramFeature rejects feature missing evidence source or snippet', () => {
      const invalidNoSource = {
        featureKey: 'web_design',
        weights: { 'S1 Sistem Informasi': 0.8 },
        evidenceSnippet: 'Mata kuliah UI/UX Desain'
      };
      expect(validateProgramFeature(invalidNoSource).valid).toBe(false);

      const invalidNoSnippet = {
        featureKey: 'web_design',
        weights: { 'S1 Sistem Informasi': 0.8 },
        evidenceSource: 'Kurikulum 2025'
      };
      expect(validateProgramFeature(invalidNoSnippet).valid).toBe(false);
    });

    test('validateProgramFeature accepts grounded feature with valid evidence metadata', () => {
      const validFeature = {
        featureKey: 'digital_marketing',
        label: 'Pemasaran Digital & Konten Media',
        evidenceSource: 'SK Kurikulum S1 Bisnis Digital 2025',
        evidenceSnippet: 'Profil Lulusan mencakup Digital Marketing Specialist dan E-Commerce Content Specialist',
        weights: {
          'S1 Bisnis Digital': 0.9,
          'S1 Sistem Informasi': 0.5
        }
      };
      expect(validateProgramFeature(validFeature).valid).toBe(true);
    });

    test('validateClaimProvenance enforces evidenceId, source, entity, aspect, and temporal scope', () => {
      const validProvenance = {
        claimText: 'Biaya per semester S1 TI adalah Rp6.500.000',
        evidenceId: 'chunk_sk_629_lamp1_biaya_ti',
        sourceDocument: 'SK No. 629/ITBSTIKOM/WDS/X/25',
        targetEntity: 'S1 Teknologi Informasi',
        targetAspect: 'TUITION_FEE_SEMESTER',
        temporalScope: 'T.A. 2026/2027',
        verificationStatus: 'VERIFIED'
      };
      expect(validateClaimProvenance(validProvenance).valid).toBe(true);

      const invalidProvenance = {
        claimText: 'Biaya per semester S1 TI adalah Rp6.500.000',
        targetEntity: 'S1 Teknologi Informasi'
      };
      expect(validateClaimProvenance(invalidProvenance).valid).toBe(false);
    });
  });

  describe('Contract 3: Dynamic Clarification Options from Authoritative Registry', () => {
    test('getAuthoritativeProgramOptions retrieves active S1 programs from canonicalEntityRegistry', () => {
      const options = getAuthoritativeProgramOptions({ degree: 'S1' });
      expect(Array.isArray(options)).toBe(true);
      expect(options.length).toBeGreaterThanOrEqual(4);

      const canonNames = options.map(o => o.canonical);
      expect(canonNames).toContain('S1 Sistem Informasi');
      expect(canonNames).toContain('S1 Teknologi Informasi');
      expect(canonNames).toContain('S1 Sistem Komputer');
      expect(canonNames).toContain('S1 Bisnis Digital');

      // Must NOT contain hardcoded non-existent programs
      expect(canonNames).not.toContain('S1 Kedokteran');
      expect(canonNames).not.toContain('S1 Teknik Sipil');
    });
  });

  describe('Contract 4: Shadow Mode Read-Only Safety', () => {
    test('createShadowTelemetry constructs compliant evaluation record without mutating inputs', () => {
      const telemetry = createShadowTelemetry({
        rawQuery: 'Berapa biaya kuliah TI?',
        p1Answer: 'Biaya S1 TI adalah Rp6.500.000 per semester.',
        p2Answer: 'Biaya kuliah S1 Teknologi Informasi adalah Rp6.500.000 per semester.',
        p1LatencyMs: 420,
        p2LatencyMs: 510,
        entityMatch: true,
        intentMatch: true,
        evidenceOverlapRatio: 1.0,
        p2VerificationPass: true,
        regressionDetected: false
      });

      expect(telemetry.readOnlyVerified).toBe(true);
      expect(telemetry.regressionDetected).toBe(false);
      expect(telemetry.entityMatch).toBe(true);
    });

    test('assertShadowModeSafety passes when session state remains unmodified', () => {
      const beforeState = { activeDomain: 'PMB', activeEntity: 'S1 Sistem Informasi', lastTurnId: 10 };
      const afterState = { activeDomain: 'PMB', activeEntity: 'S1 Sistem Informasi', lastTurnId: 10 };
      expect(assertShadowModeSafety(beforeState, afterState)).toBe(true);
    });

    test('assertShadowModeSafety throws error if shadow execution mutated session state', () => {
      const beforeState = { activeDomain: 'PMB', activeEntity: 'S1 Sistem Informasi' };
      const afterState = { activeDomain: 'PMB', activeEntity: 'S1 Teknologi Informasi' }; // mutated!
      expect(() => assertShadowModeSafety(beforeState, afterState)).toThrow('[ShadowModeViolation]');
    });
  });

  describe('Execution Plan Invariant & Factual Claim Injection Defense', () => {
    test('validateExecutionPlan rejects plan with unsupported factual claims in task queries', () => {
      const dirtyPlan = {
        rawQuery: 'Berapa biaya kuliah?',
        planType: PLAN_TYPE.DIRECT,
        tasks: [
          {
            id: 'task_0',
            stepIndex: 0,
            type: 'RETRIEVAL_TASK',
            query: 'Cari biaya Rp 6.500.000 untuk S1 TI', // Injected fabricated amount!
            targetEntities: ['S1 Teknologi Informasi'],
            requiredAspects: ['fee']
          }
        ]
      };
      const validation = validateExecutionPlan(dirtyPlan);
      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain('unsupported_factual_claim');
    });

    test('validateExecutionPlan rejects plan missing tasks or with invalid planType', () => {
      expect(validateExecutionPlan({ rawQuery: 'test', planType: 'UNKNOWN_TYPE', tasks: [] }).valid).toBe(false);
      expect(validateExecutionPlan({ rawQuery: 'test', planType: PLAN_TYPE.DIRECT, tasks: [] }).valid).toBe(false);
    });
  });
});

describe('Phase 2 Step 1: phase2Planner Functionality', () => {

  test('Specific query with explicit entity produces DIRECT plan targeting entity', () => {
    const res = buildExecutionPlan('Berapa biaya kuliah S1 Teknologi Informasi?', {});
    expect(res.success).toBe(true);
    expect(res.plan.planType).toBe(PLAN_TYPE.DIRECT);
    expect(res.plan.isAmbiguous).toBe(false);
    expect(res.plan.tasks.length).toBe(1);
    expect(res.plan.tasks[0].targetEntities).toContain('S1 Teknologi Informasi');
  });

  test('Ambiguous fee query WITHOUT active context produces AMBIGUOUS_CLARIFICATION plan with dynamic options', () => {
    const res = buildExecutionPlan('Berapa biayanya?', {});
    expect(res.success).toBe(true);
    expect(res.plan.planType).toBe(PLAN_TYPE.AMBIGUOUS_CLARIFICATION);
    expect(res.plan.isAmbiguous).toBe(true);
    expect(res.plan.clarificationOptions.length).toBeGreaterThanOrEqual(4);

    const prodiNames = res.plan.clarificationOptions.map(o => o.canonical);
    expect(prodiNames).toContain('S1 Sistem Informasi');
    expect(prodiNames).toContain('S1 Teknologi Informasi');
    expect(prodiNames).toContain('S1 Bisnis Digital');
  });

  test('Ambiguous fee query WITH active context inherits activeEntity without clarification prompt', () => {
    const sessionWithContext = {
      activeDomain: 'TUITION_FEE',
      activeEntity: 'S1 Sistem Informasi',
      lastQuery: 'Apa itu prodi Sistem Informasi?'
    };
    const res = buildExecutionPlan('Berapa biayanya?', sessionWithContext);
    expect(res.success).toBe(true);
    expect(res.plan.planType).toBe(PLAN_TYPE.DIRECT);
    expect(res.plan.isAmbiguous).toBe(false);
    expect(res.plan.contextDelta.inheritedFromSession).toBe(true);
    expect(res.plan.tasks[0].targetEntities).toContain('S1 Sistem Informasi');
  });

  test('Empty query is cleanly rejected with error', () => {
    const res = buildExecutionPlan('', {});
    expect(res.success).toBe(false);
    expect(res.error).toBe('empty_query');
    expect(res.plan).toBeNull();
  });

  test('Preserves verified entity and context fields from session without mutation', () => {
    const session = {
      activeDomain: 'ACADEMIC_PROGRAM',
      activeEntity: 'S1 Bisnis Digital'
    };
    const res = buildExecutionPlan('Mata kuliah apa saja yang dipelajari?', session);
    expect(res.success).toBe(true);
    expect(res.plan.tasks[0].verifiedInputs.inheritedEntity).toBe('S1 Bisnis Digital');
    expect(res.plan.tasks[0].verifiedInputs.sessionActiveDomain).toBe('ACADEMIC_PROGRAM');
  });
});
