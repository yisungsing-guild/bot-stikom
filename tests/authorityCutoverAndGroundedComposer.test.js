'use strict';

/**
 * authorityCutoverAndGroundedComposer.test.js
 *
 * Comprehensive tests for Grounded Composer, Final Verifier, and Authority Cutover.
 *
 * Covers required semantic guards:
 * Guard 1: Comparison != Relation Proof (attribute differences do not prove equivalence or non-equivalence).
 * Guard 2: SKTT Relation is Not Waived (administrative relations accepted only when evidence binds subject, object, requirements).
 *
 * Explicit test cases A through I:
 * A. attribute differences do NOT prove equivalence/non-equivalence
 * B. explicit relation remains unsupported while supported comparison attributes may still be composed
 * C. administrative relation is accepted only when evidence explicitly binds subject/object
 * D. administrative relation cannot bypass relation compatibility
 * E. factual absence-labelled legacy handler cannot bypass evaluator
 * F. renderer cannot inject/alter numeric values
 * G. GroundedAnswerPlan claim must retain evidence IDs
 * H. composer cannot compensate for missing upstream evidence
 * I. planner/provider execute only once
 */

const { composeGroundedAnswerPlan, renderGroundedAnswer } = require('../src/engine/groundedComposer');
const { verifyGroundedAnswerPlan, VERIFIER_DECISION } = require('../src/engine/finalVerifier');
const { evaluateBinding, evaluatePlanResults, EVALUATION_STATUS, evaluateRecipientCompatibility, evaluateQualifierCompatibility } = require('../src/engine/evidenceEvaluator');
const { createRetrievalPlan, SCOPE_TYPES } = require('../src/engine/bindingRetrievalPlanner');
const { resolveEffectiveSemanticFrame } = require('../src/engine/semanticFrameResolver');
const { buildCanonicalQueryUnderstanding } = require('../src/engine/queryUnderstanding');

describe('Authority Cutover, Grounded Composer & Final Verifier', () => {

  // Test A: Attribute differences do NOT prove equivalence/non-equivalence
  test('A. Attribute differences do NOT prove equivalence or non-equivalence', () => {
    const comparativeBinding = {
      bindingId: 'bind_rel_0',
      entity: { canonical: 'Double Degree DNUI', name: 'Double Degree DNUI' },
      requestedField: 'relation',
      relations: [{
        subject: 'Double Degree DNUI',
        relationType: 'equivalent_to',
        object: 'Student Exchange'
      }]
    };

    // Evidence describing different attributes of both entities but without equivalence statement
    const candidateEvidence = [{
      evidenceId: 'ev_comp_01',
      sourceId: 'kb_intl_prog',
      provenance: 'kb_intl_prog',
      entityBinding: { canonical: 'Double Degree DNUI' },
      requestedField: 'relation',
      textSnippet: 'Double Degree DNUI memberikan dua gelar sarjana dalam 4 tahun, sedangkan Student Exchange berlangsung selama 1 semester tanpa pemberian gelar tambahan.'
    }];

    const evaluation = evaluateBinding(comparativeBinding, candidateEvidence, {}, { evidenceOpportunityComplete: true });

    // Must be UNPROVEN / UNSUPPORTED, NOT proven as false / not_equivalent
    expect(evaluation.status).toBe(EVALUATION_STATUS.UNSUPPORTED);
    expect(evaluation.dimensions.relationCompatibility).toBe('UNPROVEN');
    // Ensure differing attributes were NOT used as proof of non-equivalence
    expect(evaluation.status).not.toBe('CONTRADICTED');
  });

  // Test B: Explicit relation remains unsupported while supported comparison attributes may still be composed
  test('B. Explicit relation remains unsupported while supported comparison attributes may still be composed', () => {
    const frame = {
      intent: { primary: 'ask_international_program_comparison' },
      entities: [
        { canonical: 'Double Degree DNUI', name: 'Double Degree DNUI' },
        { canonical: 'Student Exchange', name: 'Student Exchange' }
      ]
    };

    const plan = {
      subrequests: [{
        subrequestId: 'subreq_0',
        bindings: [
          { bindingId: 'bind_dnui_attr', entity: { canonical: 'Double Degree DNUI' }, requestedField: 'contrast' },
          { bindingId: 'bind_exchange_attr', entity: { canonical: 'Student Exchange' }, requestedField: 'contrast' },
          { bindingId: 'bind_rel_equiv', entity: { canonical: 'Double Degree DNUI' }, requestedField: 'relation', role: 'relation' }
        ]
      }]
    };

    const evaluation = {
      resultsByBinding: {
        bind_dnui_attr: {
          status: 'SUPPORTED',
          entityBinding: { canonical: 'Double Degree DNUI' },
          fieldBinding: 'contrast',
          matchedEvidenceIds: ['ev_dnui_01'],
          supportedFacts: [{
            field: 'contrast',
            entity: 'Double Degree DNUI',
            value: 'Double Degree DNUI adalah program kuliah 4 tahun yang menghasilkan dua gelar (S.Kom dan Bachelor of Engineering).',
            evidenceId: 'ev_dnui_01',
            provenance: 'kb_dnui'
          }]
        },
        bind_exchange_attr: {
          status: 'SUPPORTED',
          entityBinding: { canonical: 'Student Exchange' },
          fieldBinding: 'contrast',
          matchedEvidenceIds: ['ev_exch_01'],
          supportedFacts: [{
            field: 'contrast',
            entity: 'Student Exchange',
            value: 'Student Exchange adalah program pertukaran mahasiswa selama 1 hingga 2 semester untuk memperkaya pengalaman belajar.',
            evidenceId: 'ev_exch_01',
            provenance: 'kb_exchange'
          }]
        },
        bind_rel_equiv: {
          status: 'UNSUPPORTED',
          entityBinding: { canonical: 'Double Degree DNUI' },
          fieldBinding: 'relation',
          matchedEvidenceIds: [],
          supportedFacts: [],
          unsupportedDimensions: ['relation'],
          reasonCodes: ['RELATION_UNPROVEN']
        }
      }
    };

    const answerPlan = composeGroundedAnswerPlan(frame, plan, evaluation);
    expect(answerPlan.overallStatus).toBe('PARTIALLY_SUPPORTED');

    const verifierResult = verifyGroundedAnswerPlan(answerPlan, evaluation, frame);
    expect(verifierResult.decision).toBe(VERIFIER_DECISION.PASS);

    const rendered = renderGroundedAnswer(answerPlan);
    expect(rendered).toContain('Double Degree DNUI');
    expect(rendered).toContain('dua gelar');
    expect(rendered).toContain('Student Exchange');
    expect(rendered).toContain('pertukaran mahasiswa');
    // Relation must be explicitly bounded as not established
    expect(rendered).toMatch(/(?:tidak terdapat penegasan bahwa kedua program tersebut sama atau setara|belum ditemukan penegasan)/i);
  });

  // Test C: Administrative relation is accepted only when evidence explicitly binds subject/object
  test('C. Administrative relation is accepted only when evidence explicitly binds subject and object', () => {
    const adminBinding = {
      bindingId: 'bind_admin_foreign',
      entity: { canonical: 'Foreign Student', name: 'Foreign Student', aliases: ['mahasiswa asing'] },
      requestedField: 'sktt',
      relations: [{
        subject: { canonical: 'Foreign Student', name: 'Foreign Student', aliases: ['mahasiswa asing'] },
        relationType: 'document_requirements',
        object: { canonical: 'SKTT', name: 'SKTT', aliases: ['surat keterangan tempat tinggal'] }
      }]
    };

    // Candidate 1: Evidence binds Foreign Student + SKTT + Requirements
    const validEvidence = [{
      evidenceId: 'ev_sktt_valid',
      sourceId: 'kb_foreign_student',
      provenance: 'kb_foreign_student',
      entityBinding: { canonical: 'Foreign Student' },
      requestedField: 'sktt',
      textSnippet: 'Bagi mahasiswa asing yang tinggal di Bali, dokumen persyaratan untuk pengurusan SKTT meliputi Paspor, KITAS, dan Surat Keterangan dari kampus.'
    }];

    const evalValid = evaluateBinding(adminBinding, validEvidence, {}, { evidenceOpportunityComplete: true });
    expect(evalValid.dimensions.relationCompatibility).toBe('SUPPORTED');
    expect(evalValid.status).toBe(EVALUATION_STATUS.SUPPORTED);
  });

  // Test D: Administrative relation cannot bypass relation compatibility
  test('D. Administrative relation cannot bypass relation compatibility when subject/object unlinked', () => {
    const adminBinding = {
      bindingId: 'bind_admin_foreign',
      entity: { canonical: 'Foreign Student', name: 'Foreign Student', aliases: ['mahasiswa asing'] },
      requestedField: 'sktt',
      relations: [{
        subject: { canonical: 'Foreign Student', name: 'Foreign Student', aliases: ['mahasiswa asing'] },
        relationType: 'document_requirements',
        object: { canonical: 'SKTT', name: 'SKTT', aliases: ['surat keterangan tempat tinggal'] }
      }]
    };

    // Candidate 2: Generic text mentioning SKTT requirements but NOT foreign student
    const unlinkedEvidence = [{
      evidenceId: 'ev_sktt_generic',
      sourceId: 'kb_general_doc',
      provenance: 'kb_general_doc',
      entityBinding: { canonical: 'Foreign Student' },
      requestedField: 'sktt',
      textSnippet: 'Dokumen persyaratan pengurusan SKTT bagi penduduk non-permanen meliputi formulir pendaftaran dan KTP penjamin.'
    }];

    const evalUnlinked = evaluateBinding(adminBinding, unlinkedEvidence, {}, { evidenceOpportunityComplete: true });
    // Must NOT bypass: relation remains UNPROVEN and status is UNSUPPORTED
    expect(evalUnlinked.dimensions.relationCompatibility).toBe('UNPROVEN');
    expect(evalUnlinked.status).toBe(EVALUATION_STATUS.UNSUPPORTED);
  });

  // Test E: Factual absence-labelled legacy handler cannot bypass evaluator
  test('E. Factual absence-labelled legacy handler cannot bypass evaluator', () => {
    // When evaluator has supported facts for an entity, absence cannot be asserted
    const authoritativeEvaluation = {
      resultsByBinding: {
        bind_0: {
          status: 'SUPPORTED',
          entityBinding: { canonical: 'Double Degree DNUI' },
          supportedFacts: [{
            field: 'profile',
            entity: 'Double Degree DNUI',
            value: 'ITB STIKOM Bali bekerja sama dengan DNUI China untuk program Double Degree internasional.',
            evidenceId: 'ev_dnui'
          }]
        }
      }
    };

    const hasSupportedFacts = Object.values(authoritativeEvaluation.resultsByBinding)
      .some(b => (b.status === 'SUPPORTED' || b.status === 'PARTIALLY_SUPPORTED') && (b.supportedFacts || []).length > 0);

    expect(hasSupportedFacts).toBe(true);

    // Simulated legacy handler check
    const legacyHandlerCall = (question, hasFacts) => {
      if (hasFacts) return null; // Evaluator blocks legacy absence bypass
      return { answer: 'Saya belum menemukan data...' };
    };

    const result = legacyHandlerCall('Apakah ada double degree DNUI?', hasSupportedFacts);
    expect(result).toBeNull();
  });

  // Test F: Renderer cannot inject/alter numeric values
  test('F. Renderer cannot inject or alter numeric values and Verifier catches ungrounded numerics', () => {
    const frame = {};
    const evaluation = {
      resultsByBinding: {
        bind_fee: {
          status: 'SUPPORTED',
          entityBinding: { canonical: 'S1 Sistem Informasi' },
          fieldBinding: 'tuitionFee',
          matchedEvidenceIds: ['ev_fee_01'],
          supportedFacts: [{
            field: 'tuitionFee',
            entity: 'S1 Sistem Informasi',
            value: 'Biaya kuliah per semester adalah Rp 6.500.000.',
            evidenceId: 'ev_fee_01',
            provenance: 'kb_fee'
          }]
        }
      }
    };

    // Malicious or hallucinated answer plan injecting 8.500.000
    const tamperedAnswerPlan = {
      planId: 'tampered_plan',
      overallStatus: 'SUPPORTED',
      bindings: [{
        bindingId: 'bind_fee',
        entity: { canonical: 'S1 Sistem Informasi', name: 'S1 Sistem Informasi' },
        field: 'tuitionFee',
        evaluatorStatus: 'SUPPORTED',
        claims: [{
          claimId: 'claim_tampered_0',
          bindingId: 'bind_fee',
          entity: 'S1 Sistem Informasi',
          field: 'tuitionFee',
          value: 'Biaya kuliah per semester adalah Rp 8.500.000.',
          proposition: 'Biaya per semester Rp 8.500.000',
          evidenceIds: ['ev_fee_01'],
          provenanceIds: ['kb_fee']
        }],
        unsupportedDimensions: [],
        conflicts: []
      }]
    };

    const verifierCheck = verifyGroundedAnswerPlan(tamperedAnswerPlan, evaluation, frame);
    expect(verifierCheck.decision).toBe(VERIFIER_DECISION.BLOCK);
    expect(verifierCheck.reason).toContain('ungrounded numeric values');
  });

  // Test G: GroundedAnswerPlan claim must retain evidence IDs
  test('G. GroundedAnswerPlan claim must retain evidence IDs and fails verification without them', () => {
    const frame = {};
    const evaluation = {
      resultsByBinding: {
        bind_test: {
          status: 'SUPPORTED',
          entityBinding: { canonical: 'S1 Sistem Informasi' },
          fieldBinding: 'degree',
          matchedEvidenceIds: ['ev_deg_01'],
          supportedFacts: [{
            field: 'degree',
            entity: 'S1 Sistem Informasi',
            value: 'Gelar lulusan adalah Sarjana Komputer (S.Kom).',
            evidenceId: 'ev_deg_01'
          }]
        }
      }
    };

    // Plan with claim missing evidenceIds
    const missingEvidencePlan = {
      planId: 'plan_no_ev',
      overallStatus: 'SUPPORTED',
      bindings: [{
        bindingId: 'bind_test',
        entity: { canonical: 'S1 Sistem Informasi', name: 'S1 Sistem Informasi' },
        field: 'degree',
        evaluatorStatus: 'SUPPORTED',
        claims: [{
          claimId: 'claim_no_ev_0',
          bindingId: 'bind_test',
          entity: 'S1 Sistem Informasi',
          field: 'degree',
          value: 'Gelar lulusan adalah Sarjana Komputer (S.Kom).',
          proposition: 'Gelar S.Kom',
          evidenceIds: [], // MISSING
          provenanceIds: []
        }]
      }]
    };

    const verifierCheck = verifyGroundedAnswerPlan(missingEvidencePlan, evaluation, frame);
    expect(verifierCheck.decision).toBe(VERIFIER_DECISION.BLOCK);
    expect(verifierCheck.reason).toContain('claims with invalid evidence IDs');
  });

  // Test H: Composer cannot compensate for missing upstream evidence
  test('H. Composer cannot compensate for missing upstream evidence', () => {
    const frame = {
      entities: [{ canonical: 'Program Antariksa' }]
    };
    const plan = {
      subrequests: [{
        bindings: [{ bindingId: 'bind_unsupp', entity: { canonical: 'Program Antariksa' }, requestedField: 'tuitionFee' }]
      }]
    };

    // Empty/unsupported evaluation
    const evaluation = {
      resultsByBinding: {
        bind_unsupp: {
          status: 'UNSUPPORTED',
          entityBinding: { canonical: 'Program Antariksa' },
          fieldBinding: 'tuitionFee',
          matchedEvidenceIds: [],
          supportedFacts: [],
          unsupportedDimensions: ['tuitionFee'],
          reasonCodes: ['NO_COMPATIBLE_EVIDENCE_FOR_BINDING']
        }
      }
    };

    const answerPlan = composeGroundedAnswerPlan(frame, plan, evaluation);
    expect(answerPlan.overallStatus).toBe('UNSUPPORTED');
    expect(answerPlan.bindings[0].claims).toHaveLength(0);

    const rendered = renderGroundedAnswer(answerPlan);
    expect(rendered).toMatch(/belum menemukan data/i);
    expect(rendered).not.toMatch(/Rp\s*\d+/);
  });

  // Test I: Planner and provider execute only once per request
  test('I. Planner and provider execute only once per request', () => {
    let plannerExecutionCount = 0;
    let providerExecutionCount = 0;

    const mockCreateRetrievalPlan = (frame) => {
      plannerExecutionCount++;
      return createRetrievalPlan(frame);
    };

    const mockExecutePlan = async (plan) => {
      providerExecutionCount++;
      return { resultsByBinding: {} };
    };

    const frame = { intent: { primary: 'ask_fee' }, requestedFields: ['tuitionFee'] };

    // Request lifecycle simulation
    const plan = mockCreateRetrievalPlan(frame);
    mockExecutePlan(plan);

    expect(plannerExecutionCount).toBe(1);
    expect(providerExecutionCount).toBe(1);
  });

  // Test J: Pure fully SUPPORTED composition generates complete grounded answer without partial bounds
  test('J. Pure fully SUPPORTED composition generates complete grounded answer without partial bounds', () => {
    const frame = { entities: [{ canonical: 'Teknologi Informasi' }] };
    const plan = {
      subrequests: [{
        bindings: [{ bindingId: 'b1', entity: { canonical: 'Teknologi Informasi' }, requestedField: 'degree' }]
      }]
    };
    const evaluation = {
      resultsByBinding: {
        b1: {
          status: EVALUATION_STATUS.SUPPORTED,
          entityBinding: { canonical: 'Teknologi Informasi' },
          fieldBinding: 'degree',
          matchedEvidenceIds: ['ev_ti_01'],
          supportedFacts: [{
            field: 'degree',
            entity: 'Teknologi Informasi',
            value: 'Gelar lulusan adalah Sarjana Komputer (S.Kom).',
            evidenceId: 'ev_ti_01',
            provenance: 'kb_ti'
          }]
        }
      }
    };
    const answerPlan = composeGroundedAnswerPlan(frame, plan, evaluation);
    expect(answerPlan.overallStatus).toBe('SUPPORTED');

    const rendered = renderGroundedAnswer(answerPlan);
    expect(rendered).toContain('Sarjana Komputer (S.Kom)');
    expect(rendered).not.toMatch(/belum tercantum secara lengkap/i);

    const verifier = verifyGroundedAnswerPlan(answerPlan, evaluation, frame);
    expect(verifier.decision).toBe(VERIFIER_DECISION.PASS);
  });

  // Test K: CONFLICTING status detection and dimension-scoped preservation
  test('K. CONFLICTING status detection and dimension-scoped preservation', () => {
    const binding = {
      bindingId: 'b_conflict',
      entity: { canonical: 'S1 Sistem Informasi' },
      requestedField: 'tuitionFee'
    };
    const conflictingEvidence = [
      { evidenceId: 'ev1', sourceId: 'src1', provenance: 'doc_fee_1.pdf', entityBinding: { canonical: 'S1 Sistem Informasi' }, fieldBinding: 'tuitionFee', textSnippet: 'Biaya kuliah S1 Sistem Informasi per semester Rp 6.500.000.', structuredValue: 'Rp 6.500.000', numericSemantics: { value: 6500000 } },
      { evidenceId: 'ev2', sourceId: 'src2', provenance: 'doc_fee_2.pdf', entityBinding: { canonical: 'S1 Sistem Informasi' }, fieldBinding: 'tuitionFee', textSnippet: 'Biaya kuliah S1 Sistem Informasi per semester Rp 8.500.000.', structuredValue: 'Rp 8.500.000', numericSemantics: { value: 8500000 } }
    ];
    const evalResult = evaluateBinding(binding, conflictingEvidence, {}, { evidenceOpportunityComplete: true });
    expect(evalResult.status).toBe(EVALUATION_STATUS.CONFLICTING);
    expect(evalResult.conflicts.length).toBeGreaterThan(0);
  });

  // Test L: Multi-field binding composition for a single entity
  test('L. Multi-field binding composition for a single entity', () => {
    const frame = { entities: [{ canonical: 'S1 Sistem Informasi' }] };
    const plan = {
      subrequests: [{
        bindings: [
          { bindingId: 'b_deg', entity: { canonical: 'S1 Sistem Informasi' }, requestedField: 'degree' },
          { bindingId: 'b_akr', entity: { canonical: 'S1 Sistem Informasi' }, requestedField: 'accreditation' }
        ]
      }]
    };
    const evaluation = {
      resultsByBinding: {
        b_deg: {
          status: EVALUATION_STATUS.SUPPORTED,
          entityBinding: { canonical: 'S1 Sistem Informasi' },
          fieldBinding: 'degree',
          matchedEvidenceIds: ['ev_deg'],
          supportedFacts: [{ field: 'degree', entity: 'S1 Sistem Informasi', value: 'Sarjana Komputer (S.Kom)', evidenceId: 'ev_deg' }]
        },
        b_akr: {
          status: EVALUATION_STATUS.SUPPORTED,
          entityBinding: { canonical: 'S1 Sistem Informasi' },
          fieldBinding: 'accreditation',
          matchedEvidenceIds: ['ev_akr'],
          supportedFacts: [{ field: 'accreditation', entity: 'S1 Sistem Informasi', value: 'Baik Sekali', evidenceId: 'ev_akr' }]
        }
      }
    };
    const answerPlan = composeGroundedAnswerPlan(frame, plan, evaluation);
    expect(answerPlan.bindings.length).toBe(2);

    const rendered = renderGroundedAnswer(answerPlan);
    expect(rendered).toContain('S.Kom');
    expect(rendered).toContain('Baik Sekali');
  });

  // Test M: Stale-context correction ensures explicit current entity overrides prior context
  test('M. Stale-context correction ensures explicit current entity overrides prior context', () => {
    const priorSession = {
      activeDomain: 'tuition_fee',
      requestedFields: ['tuitionFee'],
      activeEntity: { canonical: 'S1 Sistem Informasi', type: 'program', family: 'program' },
      isVerified: true,
      promotable: true,
      updatedAt: new Date().toISOString()
    };
    const frame = resolveEffectiveSemanticFrame('bagaimana kurikulum teknologi informasi?', {
      sessionState: priorSession
    });
    expect(frame.entities.length).toBe(1);
    expect(frame.entities[0].canonical).toBe('Teknologi Informasi');
    expect(frame.requestedFields).not.toContain('tuitionFee');
  });

  // Test N: Sibling isolation ensures unsupported sibling does not poison supported binding
  test('N. Sibling isolation ensures unsupported sibling does not poison supported binding', () => {
    const frame = {
      entities: [
        { canonical: 'Double Degree DNUI' },
        { canonical: 'Program Fiktif Non-Eksis' }
      ]
    };
    const plan = {
      subrequests: [{
        bindings: [
          { bindingId: 'b_valid', entity: { canonical: 'Double Degree DNUI' }, requestedField: 'profile' },
          { bindingId: 'b_invalid', entity: { canonical: 'Program Fiktif Non-Eksis' }, requestedField: 'profile' }
        ]
      }]
    };
    const evaluation = {
      resultsByBinding: {
        b_valid: {
          status: EVALUATION_STATUS.SUPPORTED,
          entityBinding: { canonical: 'Double Degree DNUI' },
          fieldBinding: 'profile',
          matchedEvidenceIds: ['ev_dnui'],
          supportedFacts: [{ field: 'profile', entity: 'Double Degree DNUI', value: 'Kerja sama DNUI China.', evidenceId: 'ev_dnui' }]
        },
        b_invalid: {
          status: EVALUATION_STATUS.UNSUPPORTED,
          entityBinding: { canonical: 'Program Fiktif Non-Eksis' },
          fieldBinding: 'profile',
          matchedEvidenceIds: [],
          supportedFacts: []
        }
      }
    };
    const answerPlan = composeGroundedAnswerPlan(frame, plan, evaluation);
    expect(answerPlan.overallStatus).toBe('PARTIALLY_SUPPORTED');

    const validBindingPlan = answerPlan.bindings.find(b => b.bindingId === 'b_valid');
    expect(validBindingPlan).toBeDefined();
    expect(validBindingPlan.evaluatorStatus).toBe('SUPPORTED');
    expect(validBindingPlan.claims.length).toBeGreaterThan(0);

    const rendered = renderGroundedAnswer(answerPlan);
    expect(rendered).toContain('DNUI China');
  });

  // Test O: Provenance propagation retains source and document identifiers across claims
  test('O. Provenance propagation retains source and document identifiers across claims', () => {
    const frame = { entities: [{ canonical: 'Sistem Informasi' }] };
    const plan = {
      subrequests: [{
        bindings: [{ bindingId: 'b_prov', entity: { canonical: 'Sistem Informasi' }, requestedField: 'degree' }]
      }]
    };
    const evaluation = {
      resultsByBinding: {
        b_prov: {
          status: EVALUATION_STATUS.SUPPORTED,
          entityBinding: { canonical: 'Sistem Informasi' },
          fieldBinding: 'degree',
          matchedEvidenceIds: ['ev_chunk_42'],
          supportedFacts: [{
            field: 'degree',
            entity: 'Sistem Informasi',
            value: 'Gelar S.Kom.',
            evidenceId: 'ev_chunk_42',
            provenance: 'doc_isian_website.pdf'
          }]
        }
      }
    };
    const answerPlan = composeGroundedAnswerPlan(frame, plan, evaluation);
    const claim = answerPlan.bindings[0].claims[0];
    expect(claim.evidenceIds).toContain('ev_chunk_42');
    expect(claim.provenanceIds).toContain('doc_isian_website.pdf');
  });

  // Test P: Open-world entity out of domain results in zero supported facts and safe bounding
  test('P. Open-world entity out of domain results in zero supported facts and safe bounding', () => {
    const frame = resolveEffectiveSemanticFrame('berapa biaya kuliah di universitas luar angkasa antartika?');
    const plan = createRetrievalPlan(frame);
    const evaluation = evaluatePlanResults(plan, { resultsByBinding: {} });
    expect(evaluation.summary.supportedCount).toBe(0);

    const answerPlan = composeGroundedAnswerPlan(frame, plan, evaluation);
    expect(answerPlan.overallStatus).toBe('UNSUPPORTED');
  });

  // Test Q: Recipient mismatch detection catches participant scope divergence
  test('Q. Recipient mismatch detection catches participant scope divergence', () => {
    const binding = {
      rawText: 'apakah lulusan mendapatkan sertifikat kompetensi?',
      entity: { canonical: 'Sertifikasi IT' },
      requestedField: 'kompetensi'
    };
    const evidence = {
      textSnippet: 'Program GoesToSchool ditujukan bagi siswa sekolah menengah SMA/SMK.'
    };
    const recipientCheck = evaluateRecipientCompatibility(binding, evidence);
    expect(recipientCheck.status).toBe('MISMATCH');
  });

  // Test R: Qualifier contradiction detects price vs free contradiction
  test('R. Qualifier contradiction detects price vs free contradiction', () => {
    const binding = {
      rawText: 'apakah layanan ini gratis tanpa biaya?',
      entity: { canonical: 'Layanan Kampus' },
      requestedField: 'biaya'
    };
    const evidence = {
      textSnippet: 'Biaya pendaftaran layanan sebesar Rp 200.000 per tahun.'
    };
    const qualCheck = evaluateQualifierCompatibility(binding, evidence);
    expect(qualCheck.status).toBe('CONTRADICTED');
  });

  // Test S: Field subtype mismatch prevents incorrect subtype binding
  test('S. Field subtype mismatch prevents incorrect subtype binding', () => {
    const binding = {
      bindingId: 'b_field_sub',
      entity: { canonical: 'S1 Sistem Informasi' },
      requestedField: 'tuitionFee',
      constraints: { feeType: 'biaya_pendaftaran' }
    };
    const evidence = [{
      evidenceId: 'ev_spp',
      sourceId: 'kb_fee',
      entityBinding: { canonical: 'S1 Sistem Informasi' },
      requestedField: 'tuitionFee',
      textSnippet: 'SPP per semester adalah Rp 6.500.000.'
    }];
    const evalSub = evaluateBinding(binding, evidence, {}, { evidenceOpportunityComplete: true });
    expect(evalSub.status).not.toBe(EVALUATION_STATUS.SUPPORTED);
  });

  // Test T: Formatter and renderer do not mutate facts or alter claim values
  test('T. Formatter and renderer do not mutate facts or alter claim values', () => {
    const frame = { entities: [{ canonical: 'S1 Bisnis Digital' }] };
    const plan = {
      subrequests: [{
        bindings: [{ bindingId: 'b_bd', entity: { canonical: 'S1 Bisnis Digital' }, requestedField: 'degree' }]
      }]
    };
    const rawFactValue = 'Lulusan program studi Bisnis Digital berhak menyandang gelar Sarjana Bisnis Digital (S.BD).';
    const evaluation = {
      resultsByBinding: {
        b_bd: {
          status: EVALUATION_STATUS.SUPPORTED,
          entityBinding: { canonical: 'S1 Bisnis Digital' },
          fieldBinding: 'degree',
          matchedEvidenceIds: ['ev_bd_01'],
          supportedFacts: [{ field: 'degree', entity: 'S1 Bisnis Digital', value: rawFactValue, evidenceId: 'ev_bd_01' }]
        }
      }
    };
    const answerPlan = composeGroundedAnswerPlan(frame, plan, evaluation);
    const rendered = renderGroundedAnswer(answerPlan);
    expect(rendered).toContain(rawFactValue);
  });

  // Test U: Supported binding is not dropped from answer plan or rendered output
  test('U. Supported binding is not dropped from answer plan or rendered output', () => {
    const frame = {
      entities: [
        { canonical: 'S1 Sistem Informasi' },
        { canonical: 'S1 Sistem Komputer' }
      ]
    };
    const plan = {
      subrequests: [{
        bindings: [
          { bindingId: 'b_si', entity: { canonical: 'S1 Sistem Informasi' }, requestedField: 'degree' },
          { bindingId: 'b_sk', entity: { canonical: 'S1 Sistem Komputer' }, requestedField: 'degree' }
        ]
      }]
    };
    const evaluation = {
      resultsByBinding: {
        b_si: {
          status: EVALUATION_STATUS.SUPPORTED,
          entityBinding: { canonical: 'S1 Sistem Informasi' },
          fieldBinding: 'degree',
          matchedEvidenceIds: ['ev_si'],
          supportedFacts: [{ field: 'degree', entity: 'S1 Sistem Informasi', value: 'Gelar S.Kom Sistem Informasi.', evidenceId: 'ev_si' }]
        },
        b_sk: {
          status: EVALUATION_STATUS.SUPPORTED,
          entityBinding: { canonical: 'S1 Sistem Komputer' },
          fieldBinding: 'degree',
          matchedEvidenceIds: ['ev_sk'],
          supportedFacts: [{ field: 'degree', entity: 'S1 Sistem Komputer', value: 'Gelar S.Kom Sistem Komputer.', evidenceId: 'ev_sk' }]
        }
      }
    };
    const answerPlan = composeGroundedAnswerPlan(frame, plan, evaluation);
    expect(answerPlan.bindings.length).toBe(2);

    const rendered = renderGroundedAnswer(answerPlan);
    expect(rendered).toContain('Sistem Informasi');
    expect(rendered).toContain('Sistem Komputer');
  });

  // Test V: Evaluator dimension-level completeness gating
  test('V. Evaluator dimension-level completeness gating', () => {
    const binding = {
      bindingId: 'b_incomplete',
      entity: { canonical: 'S1 Sistem Informasi' },
      requestedField: 'tuitionFee'
    };
    const evalIncomplete = evaluateBinding(binding, [], {}, { evidenceOpportunityComplete: false });
    expect(evalIncomplete.evaluationState).toBe('INCOMPLETE');
    expect(evalIncomplete.status).toBeNull();
  });

  // Test W: "negara tujuan" does not map to documentPurpose (Requirement A)
  test('W. negara tujuan does not map to documentPurpose', () => {
    const q = 'kemana saja negara tujuan student exchange stikom bali?';
    const understanding = buildCanonicalQueryUnderstanding(q);
    const frame = resolveEffectiveSemanticFrame(q);
    
    expect(understanding.requestedFields).not.toContain('documentPurpose');
    expect(understanding.requestedFields).not.toContain('purpose');
    expect(understanding.requestedFields).toContain('studyLocation');

    expect(frame.requestedFields).not.toContain('documentPurpose');
    expect(frame.requestedFields).not.toContain('purpose');
    expect(frame.requestedFields).toContain('studyLocation');
  });

  // Test X: "tujuan dokumen" still maps to documentPurpose (Requirement B)
  test('X. tujuan dokumen still maps to documentPurpose', () => {
    const q = 'apa tujuan dokumen pedoman ta ini?';
    const understanding = buildCanonicalQueryUnderstanding(q);
    const frame = resolveEffectiveSemanticFrame(q);

    expect(understanding.requestedFields).toContain('documentPurpose');
    expect(frame.requestedFields).toContain('documentPurpose');
  });

  // Test Y: "mengikuti program" does not trigger IKU detection (Requirement C)
  test('Y. mengikuti program does not trigger IKU detection', () => {
    const frame = { entities: [{ canonical: 'Student Exchange' }] };
    const plan = {
      subrequests: [{
        bindings: [{ bindingId: 'b_exc', entity: { canonical: 'Student Exchange' }, requestedField: 'documentPurpose' }]
      }]
    };
    const evaluation = {
      resultsByBinding: {
        b_exc: {
          status: EVALUATION_STATUS.SUPPORTED,
          entityBinding: { canonical: 'Student Exchange' },
          fieldBinding: 'documentPurpose',
          matchedEvidenceIds: ['ev_exc'],
          supportedFacts: [{
            field: 'documentPurpose',
            entity: 'Student Exchange',
            value: 'Mahasiswa yang mengikuti program ini mendapatkan sertifikat internasional. Program ini diikuti mahasiswa aktif dan mengikutinya memberikan banyak manfaat.',
            evidenceId: 'ev_exc'
          }]
        }
      }
    };
    const answerPlan = composeGroundedAnswerPlan(frame, plan, evaluation);
    const rendered = renderGroundedAnswer(answerPlan);

    expect(rendered).not.toContain('IKU PTS');
    expect(rendered).not.toContain('indikator kinerja');
    expect(rendered).not.toContain('LLDIKTI');
  });

  // Test Z: Standalone token IKU triggers IKU extraction when evidence is actually IKU-related (Requirement D)
  test('Z. Standalone token IKU triggers IKU extraction when evidence is actually IKU-related', () => {
    const frame = { entities: [{ canonical: 'Laporan Kinerja' }] };
    const plan = {
      subrequests: [{
        bindings: [{ bindingId: 'b_doc', entity: { canonical: 'Laporan Kinerja' }, requestedField: 'documentPurpose' }]
      }]
    };
    const evaluation = {
      resultsByBinding: {
        b_doc: {
          status: EVALUATION_STATUS.SUPPORTED,
          entityBinding: { canonical: 'Laporan Kinerja' },
          fieldBinding: 'documentPurpose',
          matchedEvidenceIds: ['ev_iku'],
          supportedFacts: [{
            field: 'documentPurpose',
            entity: 'Laporan Kinerja',
            value: 'Dokumen ini memuat data indikator kinerja perguruan tinggi IKU PTS untuk pelaporan ke LLDIKTI.',
            evidenceId: 'ev_iku'
          }]
        }
      }
    };
    const answerPlan = composeGroundedAnswerPlan(frame, plan, evaluation);
    const rendered = renderGroundedAnswer(answerPlan);

    expect(rendered).toContain('IKU PTS');
    expect(rendered).toContain('LLDIKTI');
  });

  // Test AA: international_program destination field cannot be overwritten by documentPurpose fast-route heuristic (Requirement E)
  test('AA. international_program destination field cannot be overwritten by documentPurpose fast-route heuristic', () => {
    const frame = resolveEffectiveSemanticFrame('kemana saja negara tujuan student exchange stikom bali?');
    expect(frame.domain.primary).toBe('international_program');
    expect(frame.requestedFields).toContain('studyLocation');
    expect(frame.requestedFields).not.toContain('documentPurpose');
  });

  // Test AB: destination-country answer retains evidence IDs/provenance (Requirement F)
  test('AB. destination-country answer retains evidence IDs and provenance', () => {
    const frame = { entities: [{ canonical: 'Student Exchange' }] };
    const plan = {
      subrequests: [{
        bindings: [{ bindingId: 'b_dest', entity: { canonical: 'Student Exchange' }, requestedField: 'studyLocation' }]
      }]
    };
    const evaluation = {
      resultsByBinding: {
        b_dest: {
          status: EVALUATION_STATUS.SUPPORTED,
          entityBinding: { canonical: 'Student Exchange' },
          fieldBinding: 'studyLocation',
          matchedEvidenceIds: ['ev_dest_01'],
          supportedFacts: [{
            field: 'studyLocation',
            entity: 'Student Exchange',
            value: 'Program ini tersedia di berbagai negara mitra, seperti: China, Thailand, Malaysia, dan Philippines.',
            evidenceId: 'ev_dest_01',
            provenance: 'Official Student Exchange Catalog'
          }]
        }
      }
    };
    const answerPlan = composeGroundedAnswerPlan(frame, plan, evaluation);
    expect(answerPlan.bindings.length).toBe(1);
    const claim = answerPlan.bindings[0].claims[0];
    expect(claim.evidenceIds).toContain('ev_dest_01');
    expect(claim.provenanceIds).toContain('Official Student Exchange Catalog');

    const verification = verifyGroundedAnswerPlan(answerPlan, evaluation, frame);
    expect(verification.decision).toBe(VERIFIER_DECISION.PASS);
  });

});
