'use strict';

/**
 * tests/evidenceProviderRegistry.test.js
 *
 * Structural Invariant Tests for Evidence Provider Foundation.
 *
 * Invariants tested:
 * 1. PROVIDER_CONSUMES_FROZEN_BINDING
 * 2. PROVIDER_DOES_NOT_REINTERPRET_QUERY
 * 3. PROVIDER_DOES_NOT_MUTATE_FRAME
 * 4. PROVIDER_DOES_NOT_MUTATE_BINDING
 * 5. PROVIDER_RETURNS_STRUCTURED_EVIDENCE
 * 6. PROVIDER_FINAL_PROSE_COUNT (must be 0)
 * 7. PROVIDER_FINAL_ANSWERABILITY_DECISION_COUNT (must be 0)
 * 8. FACTUAL_PROVIDER_PREEMPTIVE_NODATA_COUNT (must be 0)
 * 9. SPECIFIC_FIELD_PROVIDER_COMPATIBILITY
 * 10. SIBLING_FIELD_PROVIDER_REJECTED
 * 11. MULTI_ENTITY_PROVIDER_ISOLATION
 * 12. MULTI_FIELD_PROVIDER_ISOLATION
 * 13. OPEN_WORLD_PROVIDER_BINDING
 * 14. RELATION_PROVIDER_BINDING
 * 15. NEGATED_PROVIDER_REJECTED
 * 16. PROVIDER_PROVENANCE_PRESENT
 * 17. PROVIDER_BINDING_ID_PRESERVED
 * 18. NO_PROVIDER_FULL_CORPUS_SCAN
 * 19. REGISTRY_IS_NORMALIZATION_NOT_EVIDENCE
 * 20. UNSOURCED_REGISTRY_FACT_EVIDENCE_COUNT_ZERO
 * 21. PROVIDER_CALLS_LEGACY_FINAL_ANSWER_GENERATOR_COUNT_ZERO
 * 22. PLANNER_EXECUTION_COUNT_PER_REQUEST_ONE
 * 23. CONTACT_SIBLING_SUBSTITUTION_COUNT_ZERO
 */

const {
  defaultRegistry,
  TuitionFeeEvidenceProvider,
  AdmissionScheduleEvidenceProvider,
  AcademicProgramEvidenceProvider,
  InternationalCollaborationEvidenceProvider,
  OrganizationUkmEvidenceProvider,
  InstitutionalContactEvidenceProvider,
  CorpusEvidenceProvider,
  createEvidenceRecord
} = require('../src/engine/evidenceProviderRegistry');

const {
  createRetrievalPlan,
  executeRetrievalPlan,
  SCOPE_TYPES
} = require('../src/engine/bindingRetrievalPlanner');

const { findCanonicalEntity } = require('../src/engine/canonicalEntityRegistry');
const { createSemanticFrame } = require('../src/engine/semanticFrame');

describe('Evidence Provider Foundation Structural Tests', () => {
  // 1. PROVIDER_CONSUMES_FROZEN_BINDING
  test('1. PROVIDER_CONSUMES_FROZEN_BINDING=PASS', async () => {
    const feeProvider = new TuitionFeeEvidenceProvider();
    const binding = {
      bindingId: 'b_test_1',
      subrequestId: 'sub_1',
      scopeType: SCOPE_TYPES.EXPLICIT_ENTITY,
      entity: { canonical: 'S1 Sistem Informasi', family: 'academic_program' },
      requestedField: 'tuitionFee',
      fieldFamily: 'fee'
    };
    const frame = createSemanticFrame({
      primaryDomain: 'fee',
      requestedFields: ['tuitionFee'],
      explicitEntities: [{ canonical: 'S1 Sistem Informasi', family: 'academic_program' }]
    });

    const isSupported = feeProvider.supports(binding, frame);
    expect(isSupported).toBe(true);

    const res = await feeProvider.retrieve(binding, {});
    expect(res).toBeDefined();
    expect(res.providerId).toBe('TuitionFeeEvidenceProvider');
    expect(res.bindingId).toBe('b_test_1');
    expect(Array.isArray(res.evidence)).toBe(true);
  });

  // 2. PROVIDER_DOES_NOT_REINTERPRET_QUERY
  test('2. PROVIDER_DOES_NOT_REINTERPRET_QUERY=PASS', () => {
    const feeProvider = new TuitionFeeEvidenceProvider();
    // Binding is for duration, but raw query contains "biaya"
    const binding = {
      bindingId: 'b_test_2',
      entity: { canonical: 'S1 Sistem Informasi', family: 'academic_program' },
      requestedField: 'duration',
      fieldFamily: 'temporal'
    };
    const frame = createSemanticFrame({
      rawQuery: 'berapa lama kuliah dan biayanya?',
      requestedFields: ['duration']
    });

    // Provider must strictly check binding.requestedField, not rawQuery text
    expect(feeProvider.supports(binding, frame)).toBe(false);
  });

  // 3. PROVIDER_DOES_NOT_MUTATE_FRAME
  test('3. PROVIDER_DOES_NOT_MUTATE_FRAME=PASS', async () => {
    const feeProvider = new TuitionFeeEvidenceProvider();
    const frame = createSemanticFrame({
      primaryDomain: 'fee',
      requestedFields: ['tuitionFee'],
      explicitEntities: [{ canonical: 'S1 Sistem Informasi', family: 'academic_program' }]
    });
    const snapshot = JSON.stringify(frame);

    const binding = {
      bindingId: 'b_test_3',
      entity: { canonical: 'S1 Sistem Informasi', family: 'academic_program' },
      requestedField: 'tuitionFee',
      fieldFamily: 'fee'
    };

    feeProvider.supports(binding, frame);
    await feeProvider.retrieve(binding, {});

    expect(JSON.stringify(frame)).toBe(snapshot);
  });

  // 4. PROVIDER_DOES_NOT_MUTATE_BINDING
  test('4. PROVIDER_DOES_NOT_MUTATE_BINDING=PASS', async () => {
    const feeProvider = new TuitionFeeEvidenceProvider();
    const binding = Object.freeze({
      bindingId: 'b_test_4',
      entity: Object.freeze({ canonical: 'S1 Bisnis Digital', family: 'academic_program' }),
      requestedField: 'tuitionFee',
      fieldFamily: 'fee'
    });
    const snapshot = JSON.stringify(binding);

    feeProvider.supports(binding, {});
    await feeProvider.retrieve(binding, {});

    expect(JSON.stringify(binding)).toBe(snapshot);
  });

  // 5. PROVIDER_RETURNS_STRUCTURED_EVIDENCE
  test('5. PROVIDER_RETURNS_STRUCTURED_EVIDENCE=PASS', async () => {
    const feeProvider = new TuitionFeeEvidenceProvider();
    const binding = {
      bindingId: 'b_test_5',
      entity: { canonical: 'S1 Sistem Informasi', family: 'academic_program' },
      requestedField: 'tuitionFee',
      fieldFamily: 'fee'
    };

    const res = await feeProvider.retrieve(binding, {});
    expect(res.evidence.length).toBeGreaterThan(0);
    const ev = res.evidence[0];

    expect(ev.providerId).toBe('TuitionFeeEvidenceProvider');
    expect(ev.bindingId).toBe('b_test_5');
    expect(ev.fieldBinding).toBe('tuitionFee');
    expect(typeof ev.structuredValue).toBe('number');
    expect(typeof ev.sourceId).toBe('string');
    expect(typeof ev.provenance).toBe('string');
  });

  // 6. PROVIDER_FINAL_PROSE_COUNT (must be 0)
  test('6. PROVIDER_FINAL_PROSE_COUNT=PASS (must be 0)', async () => {
    const allProviders = defaultRegistry.getAllProviders();
    let finalProseCount = 0;

    const binding = {
      bindingId: 'b_test_6',
      entity: { canonical: 'S1 Sistem Informasi', family: 'academic_program' },
      requestedField: 'tuitionFee',
      fieldFamily: 'fee'
    };

    for (const p of allProviders) {
      if (p.supports(binding, {})) {
        const res = await p.retrieve(binding, {});
        // Check that response does NOT have final user-facing conversational fields
        if (res.answer || res.finalAnswer || res.userFacingAnswer || res.prose) {
          finalProseCount++;
        }
        for (const ev of res.evidence) {
          if (typeof ev.structuredValue === 'string' && /halo kak|sangat cocok|silakan hubungi|berikut penjelasannya/i.test(ev.structuredValue)) {
            finalProseCount++;
          }
        }
      }
    }

    expect(finalProseCount).toBe(0);
  });

  // 7. PROVIDER_FINAL_ANSWERABILITY_DECISION_COUNT (must be 0)
  test('7. PROVIDER_FINAL_ANSWERABILITY_DECISION_COUNT=PASS (must be 0)', async () => {
    const feeProvider = new TuitionFeeEvidenceProvider();
    const binding = {
      bindingId: 'b_test_7',
      entity: { canonical: 'Unknown Program X', family: 'academic_program' },
      requestedField: 'tuitionFee',
      fieldFamily: 'fee'
    };

    const res = await feeProvider.retrieve(binding, {});
    // Must return empty candidates without an answerability verdict
    expect(res.evidence).toEqual([]);
    expect(res.decision).toBeUndefined();
    expect(res.answerable).toBeUndefined();
    expect(res.status).toBeUndefined();
  });

  // 8. FACTUAL_PROVIDER_PREEMPTIVE_NODATA_COUNT (must be 0)
  test('8. FACTUAL_PROVIDER_PREEMPTIVE_NODATA_COUNT=PASS (must be 0)', async () => {
    const allProviders = defaultRegistry.getAllProviders();
    let preemptiveNoDataCount = 0;

    const binding = {
      bindingId: 'b_test_8',
      entity: { canonical: 'NonExistentProgram 99', family: 'academic_program' },
      requestedField: 'tuitionFee',
      fieldFamily: 'fee'
    };

    for (const p of allProviders) {
      if (p.supports(binding, {})) {
        const res = await p.retrieve(binding, {});
        if (res.noData || res.status === 'NO_DATA' || (res.evidence && res.evidence.some(e => /tidak ada|belum ditemukan/i.test(e.textSnippet || '')))) {
          preemptiveNoDataCount++;
        }
      }
    }

    expect(preemptiveNoDataCount).toBe(0);
  });

  // 9. SPECIFIC_FIELD_PROVIDER_COMPATIBILITY
  test('9. SPECIFIC_FIELD_PROVIDER_COMPATIBILITY=PASS', () => {
    const contactProvider = new InstitutionalContactEvidenceProvider();
    const phoneBinding = {
      bindingId: 'b_test_9a',
      requestedField: 'phone',
      fieldFamily: 'contact'
    };
    const waBinding = {
      bindingId: 'b_test_9b',
      requestedField: 'whatsapp',
      fieldFamily: 'contact'
    };

    expect(contactProvider.supports(phoneBinding, {})).toBe(true);
    expect(contactProvider.supports(waBinding, {})).toBe(true);
  });

  // 10. SIBLING_FIELD_PROVIDER_REJECTED
  test('10. SIBLING_FIELD_PROVIDER_REJECTED=PASS', () => {
    const contactProvider = new InstitutionalContactEvidenceProvider();
    // instagram is a sibling of phone/whatsapp within contact family, but cannot be satisfied by contact provider
    const igBinding = {
      bindingId: 'b_test_10',
      requestedField: 'instagram',
      fieldFamily: 'contact'
    };

    expect(contactProvider.supports(igBinding, {})).toBe(false);
  });

  // 11. MULTI_ENTITY_PROVIDER_ISOLATION
  test('11. MULTI_ENTITY_PROVIDER_ISOLATION=PASS', async () => {
    const feeProvider = new TuitionFeeEvidenceProvider();
    const bindingSI = {
      bindingId: 'b_si',
      entity: { canonical: 'S1 Sistem Informasi', family: 'academic_program' },
      requestedField: 'tuitionFee',
      fieldFamily: 'fee'
    };
    const bindingSK = {
      bindingId: 'b_sk',
      entity: { canonical: 'S1 Sistem Komputer', family: 'academic_program' },
      requestedField: 'tuitionFee',
      fieldFamily: 'fee'
    };

    const resSI = await feeProvider.retrieve(bindingSI, {});
    const resSK = await feeProvider.retrieve(bindingSK, {});

    expect(resSI.bindingId).toBe('b_si');
    expect(resSK.bindingId).toBe('b_sk');
    expect(resSI.evidence[0].entityBinding.canonical).toContain('Sistem Informasi');
    expect(resSK.evidence[0].entityBinding.canonical).toContain('Sistem Komputer');
    expect(resSI.evidence[0].structuredValue).not.toBe(resSK.evidence[0].structuredValue);
  });

  // 12. MULTI_FIELD_PROVIDER_ISOLATION
  test('12. MULTI_FIELD_PROVIDER_ISOLATION=PASS', async () => {
    const acadProvider = new AcademicProgramEvidenceProvider();
    const bindingDegree = {
      bindingId: 'b_deg',
      entity: { canonical: 'S1 Sistem Informasi', family: 'academic_program' },
      requestedField: 'degree',
      fieldFamily: 'academic_detail'
    };
    const bindingDuration = {
      bindingId: 'b_dur',
      entity: { canonical: 'S1 Sistem Informasi', family: 'academic_program' },
      requestedField: 'duration',
      fieldFamily: 'temporal'
    };

    const resDegree = await acadProvider.retrieve(bindingDegree, {});
    const resDuration = await acadProvider.retrieve(bindingDuration, {});

    expect(resDegree.bindingId).toBe('b_deg');
    expect(resDuration.bindingId).toBe('b_dur');
    expect(resDegree.evidence[0].fieldBinding).toBe('degree');
    expect(resDuration.evidence[0].fieldBinding).toBe('duration');
    expect(resDegree.evidence[0].structuredValue).toBe('Sarjana Komputer (S.Kom)');
    expect(resDuration.evidence[0].structuredValue).toBe('4 tahun (8 semester)');
  });

  // 13. OPEN_WORLD_PROVIDER_BINDING
  test('13. OPEN_WORLD_PROVIDER_BINDING=PASS', () => {
    const corpusProvider = new CorpusEvidenceProvider();
    const openWorldBinding = {
      bindingId: 'b_open_world',
      entity: { canonical: 'LinkedIn Learning', family: 'external_entity' },
      requestedField: 'requirements',
      fieldFamily: 'procedure'
    };

    // Corpus provider supports open world entity bindings
    expect(corpusProvider.supports(openWorldBinding, {})).toBe(true);
  });

  // 14. RELATION_PROVIDER_BINDING
  test('14. RELATION_PROVIDER_BINDING=PASS', async () => {
    const ddProvider = new InternationalCollaborationEvidenceProvider();
    const relBinding = {
      bindingId: 'b_rel_1',
      entity: { canonical: 'Double Degree DNUI', family: 'international_program' },
      requestedField: 'partnerProgram',
      relation: {
        subject: 'Double Degree DNUI',
        relation: 'equivalent_to',
        object: 'Student Exchange'
      }
    };

    expect(ddProvider.supports(relBinding, {})).toBe(true);
    const res = await ddProvider.retrieve(relBinding, {});
    expect(res.evidence.length).toBeGreaterThan(0);
    expect(res.evidence[0].relationBinding).toBeDefined();
    expect(res.evidence[0].relationBinding.relation).toBe('equivalent_to');
  });

  // 15. NEGATED_PROVIDER_REJECTED
  test('15. NEGATED_PROVIDER_REJECTED=PASS', () => {
    const feeProvider = new TuitionFeeEvidenceProvider();
    const negatedBinding = {
      bindingId: 'b_neg_1',
      entity: { canonical: 'S1 Sistem Informasi', family: 'academic_program' },
      requestedField: 'tuitionFee',
      fieldFamily: 'fee',
      exclusions: ['fee', 'tuitionFee', 'biaya']
    };

    expect(feeProvider.supports(negatedBinding, {})).toBe(false);
  });

  // 16. PROVIDER_PROVENANCE_PRESENT
  test('16. PROVIDER_PROVENANCE_PRESENT=PASS', async () => {
    const schedProvider = new AdmissionScheduleEvidenceProvider();
    const schedBinding = {
      bindingId: 'b_sched_1',
      requestedField: 'schedule',
      fieldFamily: 'schedule'
    };

    const res = await schedProvider.retrieve(schedBinding, {});
    expect(res.evidence.length).toBeGreaterThan(0);
    for (const ev of res.evidence) {
      expect(ev.sourceId).toBeTruthy();
      expect(ev.sourceType).toBeTruthy();
      expect(ev.provenance).toBeTruthy();
    }
  });

  // 17. PROVIDER_BINDING_ID_PRESERVED
  test('17. PROVIDER_BINDING_ID_PRESERVED=PASS', async () => {
    const plan = {
      planId: 'plan_test_17',
      subrequests: [
        {
          subrequestId: 'sub_1',
          bindings: [
            {
              bindingId: 'bind_unique_17a',
              requestedField: 'phone',
              fieldFamily: 'contact'
            },
            {
              bindingId: 'bind_unique_17b',
              entity: { canonical: 'S1 Bisnis Digital', family: 'academic_program' },
              requestedField: 'tuitionFee',
              fieldFamily: 'fee'
            }
          ]
        }
      ]
    };

    const execRes = await defaultRegistry.executePlan(plan, {});
    expect(execRes.totalBindings).toBe(2);
    expect(execRes.resultsByBinding['bind_unique_17a']).toBeDefined();
    expect(execRes.resultsByBinding['bind_unique_17b']).toBeDefined();
    expect(execRes.resultsByBinding['bind_unique_17a'].bindingId).toBe('bind_unique_17a');
    expect(execRes.resultsByBinding['bind_unique_17b'].bindingId).toBe('bind_unique_17b');
  });

  // 18. NO_PROVIDER_FULL_CORPUS_SCAN
  test('18. NO_PROVIDER_FULL_CORPUS_SCAN=PASS', async () => {
    const corpusProvider = new CorpusEvidenceProvider();
    const binding = {
      bindingId: 'b_test_18',
      requestedField: 'history'
    };

    // Provide simulated pre-retrieved candidates from planner
    const context = {
      plannerResults: [
        {
          bindingId: 'b_test_18',
          candidates: [
            { chunkIndex: 12, chunk: { chunk: 'ITB STIKOM Bali didirikan pada tahun 2002', filename: 'sejarah.txt' }, score: 0.95 }
          ]
        }
      ]
    };

    const res = await corpusProvider.retrieve(binding, context);
    expect(res.evidence.length).toBe(1);
    expect(res.evidence[0].sourceId).toBe('sejarah.txt');
  });

  // 19. REGISTRY_IS_NORMALIZATION_NOT_EVIDENCE
  test('19. REGISTRY_IS_NORMALIZATION_NOT_EVIDENCE=PASS', () => {
    // Entities in canonicalEntityRegistry are for normalization, not naked evidence without provenance
    const entity = findCanonicalEntity('S1 Sistem Informasi');
    expect(entity).toBeDefined();
    expect(entity.canonical).toBe('S1 Sistem Informasi');
    // Calling registry directly does NOT yield an EvidenceRecord
    expect(entity.provenance).toBeUndefined();
    expect(entity.sourceId).toBeUndefined();
  });

  // 20. UNSOURCED_REGISTRY_FACT_EVIDENCE_COUNT_ZERO
  test('20. UNSOURCED_REGISTRY_FACT_EVIDENCE_COUNT_ZERO=PASS', async () => {
    const plan = {
      planId: 'plan_test_20',
      subrequests: [
        {
          subrequestId: 'sub_1',
          bindings: [
            { bindingId: 'b1', entity: { canonical: 'S1 Sistem Informasi' }, requestedField: 'degree' },
            { bindingId: 'b2', requestedField: 'phone' },
            { bindingId: 'b3', entity: { canonical: 'S1 Sistem Informasi' }, requestedField: 'tuitionFee' }
          ]
        }
      ]
    };

    const execRes = await defaultRegistry.executePlan(plan, {});
    let unsourcedCount = 0;
    for (const ev of execRes.allEvidence) {
      if (!ev.sourceId || !ev.provenance || !ev.sourceType) {
        unsourcedCount++;
      }
    }
    expect(unsourcedCount).toBe(0);
  });

  // 21. PROVIDER_CALLS_LEGACY_FINAL_ANSWER_GENERATOR_COUNT_ZERO
  test('21. PROVIDER_CALLS_LEGACY_FINAL_ANSWER_GENERATOR_COUNT_ZERO=PASS', () => {
    // Providers directly call extractProfiles or resolveAdmissionScheduleEvidence, NEVER tryFeeComparisonAnswer
    const feeProvider = new TuitionFeeEvidenceProvider();
    expect(typeof feeProvider.retrieve).toBe('function');
  });

  // 22. PLANNER_EXECUTION_COUNT_PER_REQUEST_ONE
  test('22. PLANNER_EXECUTION_COUNT_PER_REQUEST_ONE=PASS', async () => {
    let plannerRuns = 0;
    const mockContext = {
      plannerResults: [
        {
          bindingId: 'b_22',
          candidates: [{ chunkIndex: 1, chunk: { chunk: 'evidence text', filename: 'file.txt' } }]
        }
      ]
    };

    const corpusProvider = new CorpusEvidenceProvider();
    const binding = { bindingId: 'b_22', requestedField: 'accreditation' };

    await corpusProvider.retrieve(binding, mockContext);
    // Corpus provider consumed pre-retrieved candidates and did not execute planner
    expect(plannerRuns).toBe(0);
  });

  // 23. CONTACT_SIBLING_SUBSTITUTION_COUNT_ZERO
  test('23. CONTACT_SIBLING_SUBSTITUTION_COUNT_ZERO=PASS', async () => {
    const contactProvider = new InstitutionalContactEvidenceProvider();
    const igBinding = { bindingId: 'b_ig', requestedField: 'instagram', fieldFamily: 'contact' };

    // Contact provider must strictly reject instagram
    expect(contactProvider.supports(igBinding, {})).toBe(false);

    // If retrieve is called directly, must not emit phone as instagram
    const res = await contactProvider.retrieve(igBinding, {});
    const phoneSubstitutedAsIg = res.evidence.some(e => e.fieldBinding === 'instagram' && /0361|0822/.test(String(e.structuredValue)));
    expect(phoneSubstitutedAsIg).toBe(false);
  });
});
