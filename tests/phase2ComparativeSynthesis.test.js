'use strict';

/**
 * tests/phase2ComparativeSynthesis.test.js
 *
 * Phase 2 Step 6 Test Suite: Comparative Synthesis Engine & Transport
 *
 * Tests:
 * 1. Sanitizer Idempotency & Fixed Point Invariant:
 *    sanitizeWhatsAppMarkdown(renderTextFromPlan(plan)) === renderTextFromPlan(plan)
 * 2. Deterministic Unicode sorting & string equality
 * 3. Scope and Entity validation
 * 4. ComparisonMatrix generation across comparative modalities (Numeric, Sequence, Set, Scalar)
 * 5. Numeric ranking claim bounds (emitted only on 3 PRESENT valid numeric operands)
 * 6. Set aggregate exclusivity & pairwise claims
 * 7. Aspect Notice precedence: CONFLICT > NOT_APPLICABLE > UNAVAILABLE
 * 8. RenderPlan compilation and deterministic claim sorting
 * 9. Exact candidate verification (no trimming, no rewriting)
 * 10. Transport envelope validation & deep AST equivalence
 * 11. End-to-end integration: render -> verify -> outboundRenderer
 * 12. Backward-compatible non-comparative legacy paths
 */

const {
  COMPARISON_GLOBAL_STATE,
  ASPECT_ALIGNMENT_STATUS,
  COMPARISON_DELTA_TYPE,
  COMPARISON_DIAGNOSTIC_CODE,
  COMPARISON_TEMPLATE_ID,
  GLOBAL_STATUS_HEADER_CODE,
  PRESENTATION_NOTICE_CODE,
  COMPARATIVE_TRANSPORT_VALIDATION_CODE,
  COMPUTATION_STATE,
  ASPECT_COMPARATOR_REGISTRY
} = require('../src/reasoning/contracts');

const {
  compareCodePoints,
  areStructuredValuesEqual,
  formatIdr,
  canonicalSortStrings,
  uniqueCanonicalStrings,
  canonicalJson,
  computeComparisonId,
  validateScopeAndEntities,
  buildComparisonMatrix,
  compileRenderPlan,
  renderTextFromPlan,
  validateComparisonEnvelope
} = require('../src/reasoning/comparativeSynthesis');

const { sanitizeWhatsAppMarkdown } = require('../src/core/outboundRenderer');
const { synthesizeAnswer } = require('../src/core/groundedAnswerGenerator');
const { verifyFinalAnswer } = require('../src/core/finalAnswerVerifier');

describe('Phase 2 Step 6: Comparative Synthesis Engine & Transport Suite', () => {

  describe('Category 1: Unicode Code-Point Ordering & Deep Value Equivalence', () => {
    test('1. compareCodePoints handles surrogate pairs and NFC normalization', () => {
      expect(compareCodePoints('abc', 'abc')).toBe(0);
      expect(compareCodePoints('abc', 'abd')).toBe(-1);
      expect(compareCodePoints('abd', 'abc')).toBe(1);
      expect(compareCodePoints('e\u0301', '\u00e9')).toBe(0); // e + acute vs é
    });

    test('2. areStructuredValuesEqual evaluates primitive and deep objects deterministically', () => {
      expect(areStructuredValuesEqual(10, 10)).toBe(true);
      expect(areStructuredValuesEqual(10, '10')).toBe(false);
      expect(areStructuredValuesEqual(null, null)).toBe(true);
      expect(areStructuredValuesEqual(null, undefined)).toBe(false);

      const objA = { b: 2, a: 1 };
      const objB = { a: 1, b: 2 };
      expect(areStructuredValuesEqual(objA, objB)).toBe(true);

      const arrA = [1, 2, 3];
      const arrB = [1, 2, 3];
      const arrC = [3, 2, 1];
      expect(areStructuredValuesEqual(arrA, arrB)).toBe(true);
      expect(areStructuredValuesEqual(arrA, arrC)).toBe(false);
    });

    test('3. formatIdr formats non-negative integers and throws on malformed', () => {
      expect(formatIdr(5000000)).toBe('Rp 5.000.000');
      expect(formatIdr(0)).toBe('Rp 0');
      expect(() => formatIdr(-100)).toThrow('MALFORMED_IDR_VALUE');
      expect(() => formatIdr(NaN)).toThrow('MALFORMED_IDR_VALUE');
      expect(() => formatIdr(1.5)).toThrow('MALFORMED_IDR_VALUE');
    });
  });

  describe('Category 2: Scope and Entity Validation', () => {
    test('4. validateScopeAndEntities enforces 2..3 entities and 1..5 aspects', () => {
      expect(validateScopeAndEntities(['A'], ['tuition_fee']).valid).toBe(false);
      expect(validateScopeAndEntities(['A', 'B', 'C', 'D'], ['tuition_fee']).valid).toBe(false);
      expect(validateScopeAndEntities(['A', 'B'], []).valid).toBe(false);
      expect(validateScopeAndEntities(['A', 'B'], ['1', '2', '3', '4', '5', '6']).valid).toBe(false);

      const valid2 = validateScopeAndEntities(['S1 Sistem Informasi', 'S1 Sistem Komputer'], ['tuition_fee']);
      expect(valid2.valid).toBe(true);
      expect(valid2.comparedEntities).toEqual(['S1 Sistem Informasi', 'S1 Sistem Komputer']);
    });

    test('5. Duplicate entities or aspects are rejected', () => {
      const dupEnt = validateScopeAndEntities(['S1 Sistem Informasi', 'S1 Sistem Informasi'], ['tuition_fee']);
      expect(dupEnt.valid).toBe(false);

      const dupAsp = validateScopeAndEntities(['S1 Sistem Informasi', 'S1 Sistem Komputer'], ['tuition_fee', 'tuition_fee']);
      expect(dupAsp.valid).toBe(false);
    });

    test('6. Entity family mismatch rejected when registeredEntities provided', () => {
      const registered = [
        { canonical: 'S1 Sistem Informasi', family: 'undergraduate' },
        { canonical: 'S2 Magister Komputer', family: 'postgraduate' }
      ];
      const res = validateScopeAndEntities(['S1 Sistem Informasi', 'S2 Magister Komputer'], ['tuition_fee'], registered);
      expect(res.valid).toBe(false);
      expect(res.diagnosticCode).toBe(COMPARISON_DIAGNOSTIC_CODE.ENTITY_FAMILY_MISMATCH);
    });
  });

  describe('Category 3: Matrix Generation & Aggregates across Modalities', () => {
    test('7. Numeric pairwise comparison computes differences and higher/lower correctly', () => {
      const matrix = buildComparisonMatrix({
        comparedEntities: ['S1 Sistem Informasi', 'S1 Sistem Komputer'],
        requestedAspects: ['tuition_fee'],
        factsByEntity: {
          'S1 Sistem Informasi': [{ aspect: 'tuition_fee', value: 5000000 }],
          'S1 Sistem Komputer': [{ aspect: 'tuition_fee', value: 4500000 }]
        }
      });

      expect(matrix.globalState).toBe(COMPARISON_GLOBAL_STATE.COMPLETE_COMPARISON);
      const aData = matrix.aspectResults['tuition_fee'];
      expect(aData.alignmentStatus).toBe(ASPECT_ALIGNMENT_STATUS.ALIGNED);
      expect(aData.pairwise['0:1'].deltaType).toBe(COMPARISON_DELTA_TYPE.GREATER_THAN);
      expect(aData.pairwise['0:1'].absoluteDifference).toBe(500000);
      expect(aData.pairwise['0:1'].higherEntity).toBe('S1 Sistem Informasi');
    });

    test('8. Numeric ranking summary: emitted when all 3 entities are PRESENT', () => {
      const matrix = buildComparisonMatrix({
        comparedEntities: ['S1 Sistem Informasi', 'S1 Sistem Komputer', 'S1 Teknologi Informasi'],
        requestedAspects: ['tuition_fee'],
        factsByEntity: {
          'S1 Sistem Informasi': [{ aspect: 'tuition_fee', value: 5000000 }],
          'S1 Sistem Komputer': [{ aspect: 'tuition_fee', value: 4500000 }],
          'S1 Teknologi Informasi': [{ aspect: 'tuition_fee', value: 5500000 }]
        }
      });

      const plan = compileRenderPlan(matrix);
      expect(plan.numericRankingClaims.length).toBe(1);
      const rank = plan.numericRankingClaims[0];
      expect(rank.templateParams.highestEntity).toBe('S1 Teknologi Informasi');
      expect(rank.templateParams.highestValue).toBe(5500000);
      expect(rank.templateParams.lowestEntity).toBe('S1 Sistem Komputer');
      expect(rank.templateParams.lowestValue).toBe(4500000);
      expect(rank.templateParams.allIdentical).toBe(false);
    });

    test('9. Numeric ranking summary suppressed when 1 entity is missing in N=3', () => {
      const matrix = buildComparisonMatrix({
        comparedEntities: ['S1 Sistem Informasi', 'S1 Sistem Komputer', 'S1 Teknologi Informasi'],
        requestedAspects: ['tuition_fee'],
        factsByEntity: {
          'S1 Sistem Informasi': [{ aspect: 'tuition_fee', value: 5000000 }],
          'S1 Sistem Komputer': [{ aspect: 'tuition_fee', value: 4500000 }]
        }
      });

      const plan = compileRenderPlan(matrix);
      expect(plan.numericRankingClaims.length).toBe(0);
      expect(plan.aspectNotices.length).toBe(1);
      expect(plan.aspectNotices[0].templateParams.noticeCode).toBe(PRESENTATION_NOTICE_CODE.NOTICE_DATA_UNAVAILABLE);
    });

    test('10. Ordered sequence divergence detection', () => {
      const matrix = buildComparisonMatrix({
        comparedEntities: ['S1 Sistem Informasi', 'S1 Sistem Komputer'],
        requestedAspects: ['double_degree_sequence'],
        factsByEntity: {
          'S1 Sistem Informasi': [{ aspect: 'double_degree_sequence', value: ['Bali', 'Australia'] }],
          'S1 Sistem Komputer': [{ aspect: 'double_degree_sequence', value: ['Bali', 'China'] }]
        }
      });

      const p = matrix.aspectResults['double_degree_sequence'].pairwise['0:1'];
      expect(p.deltaType).toBe(COMPARISON_DELTA_TYPE.DIVERGENT);
      expect(p.divergenceIndex).toBe(1);
      expect(p.commonPrefix).toEqual(['Bali']);
    });

    test('11. Unordered set aggregates: sharedAcrossAll and exclusive pairwise', () => {
      const matrix = buildComparisonMatrix({
        comparedEntities: ['A', 'B', 'C'],
        requestedAspects: ['career_opportunities'],
        factsByEntity: {
          'A': [{ aspect: 'career_opportunities', value: ['Analyst', 'Dev', 'Admin'] }],
          'B': [{ aspect: 'career_opportunities', value: ['Dev', 'Admin', 'Designer'] }],
          'C': [{ aspect: 'career_opportunities', value: ['Dev', 'Admin', 'Manager'] }]
        }
      });

      const plan = compileRenderPlan(matrix);
      expect(plan.multiEntitySetClaims.length).toBe(1);
      const setClaim = plan.multiEntitySetClaims[0];
      expect(setClaim.templateParams.sharedAcrossAll).toEqual(['Admin', 'Dev']);
      expect(setClaim.templateParams.uniquePerEntity).toEqual([
        { entity: 'A', uniqueItems: ['Analyst'] },
        { entity: 'B', uniqueItems: ['Designer'] },
        { entity: 'C', uniqueItems: ['Manager'] }
      ]);
    });

    test('12. Scalar equality comparison handles IDENTICAL and DIFFERENT', () => {
      const matrix = buildComparisonMatrix({
        comparedEntities: ['S1 Sistem Informasi', 'S1 Sistem Komputer'],
        requestedAspects: ['accreditation'],
        factsByEntity: {
          'S1 Sistem Informasi': [{ aspect: 'accreditation', value: 'Unggul' }],
          'S1 Sistem Komputer': [{ aspect: 'accreditation', value: 'Unggul' }]
        }
      });

      const plan = compileRenderPlan(matrix);
      expect(plan.pairwiseClaims[0].deltaType).toBe(COMPARISON_DELTA_TYPE.IDENTICAL);
      const rendered = renderTextFromPlan(plan);
      expect(rendered).toContain('Keduanya Unggul');
    });
  });

  describe('Category 4: Aspect Notice Hierarchy & Conflict Precedence', () => {
    test('13. Notice precedence: CONFLICT > NOT_APPLICABLE > UNAVAILABLE', () => {
      const matrix = buildComparisonMatrix({
        comparedEntities: ['S1 Sistem Informasi', 'S1 Sistem Komputer'],
        requestedAspects: ['tuition_fee'],
        factsByEntity: {
          'S1 Sistem Informasi': [{ aspect: 'tuition_fee', value: 5000000 }]
        },
        scopedConflicts: [
          { aspect: 'tuition_fee', affectedEntities: ['S1 Sistem Informasi'] }
        ]
      });

      const plan = compileRenderPlan(matrix);
      expect(plan.aspectNotices.length).toBe(1);
      expect(plan.aspectNotices[0].templateParams.noticeCode).toBe(PRESENTATION_NOTICE_CODE.NOTICE_DATA_CONFLICT);
    });

    test('14. Global status header matches conflicted globalState', () => {
      const matrix = buildComparisonMatrix({
        comparedEntities: ['S1 Sistem Informasi', 'S1 Sistem Komputer'],
        requestedAspects: ['tuition_fee'],
        factsByEntity: {
          'S1 Sistem Informasi': [{ aspect: 'tuition_fee', value: 5000000 }],
          'S1 Sistem Komputer': [{ aspect: 'tuition_fee', value: 4500000 }]
        },
        scopedConflicts: [
          { aspect: 'tuition_fee', affectedEntities: ['S1 Sistem Informasi'] }
        ]
      });

      expect(matrix.globalState).toBe(COMPARISON_GLOBAL_STATE.CONFLICTED_COMPARISON);
      const plan = compileRenderPlan(matrix);
      expect(plan.globalStatusHeader.headerCode).toBe(GLOBAL_STATUS_HEADER_CODE.HEADER_CONFLICTED);
    });
  });

  describe('Category 5: WhatsApp-Safe Sanitizer Fixed Point Invariant', () => {
    test('15. MANDATORY INVARIANT: sanitizeWhatsAppMarkdown(renderTextFromPlan(plan)) === renderTextFromPlan(plan)', () => {
      const variations = [
        // Case 1: Complete 2-entity numeric
        {
          entities: ['S1 Sistem Informasi', 'S1 Sistem Komputer'],
          aspects: ['tuition_fee'],
          facts: {
            'S1 Sistem Informasi': [{ aspect: 'tuition_fee', value: 5000000 }],
            'S1 Sistem Komputer': [{ aspect: 'tuition_fee', value: 4500000 }]
          }
        },
        // Case 2: Complete 3-entity numeric with ranking
        {
          entities: ['S1 Sistem Informasi', 'S1 Sistem Komputer', 'S1 Teknologi Informasi'],
          aspects: ['tuition_fee'],
          facts: {
            'S1 Sistem Informasi': [{ aspect: 'tuition_fee', value: 5000000 }],
            'S1 Sistem Komputer': [{ aspect: 'tuition_fee', value: 4500000 }],
            'S1 Teknologi Informasi': [{ aspect: 'tuition_fee', value: 5500000 }]
          }
        },
        // Case 3: Set aggregates across 3 entities
        {
          entities: ['S1 Sistem Informasi', 'S1 Sistem Komputer', 'S1 Teknologi Informasi'],
          aspects: ['career_opportunities'],
          facts: {
            'S1 Sistem Informasi': [{ aspect: 'career_opportunities', value: ['Analyst', 'Dev'] }],
            'S1 Sistem Komputer': [{ aspect: 'career_opportunities', value: ['Dev', 'Engineer'] }],
            'S1 Teknologi Informasi': [{ aspect: 'career_opportunities', value: ['Dev', 'Admin'] }]
          }
        },
        // Case 4: Ordered sequence with divergence
        {
          entities: ['S1 Sistem Informasi', 'S1 Sistem Komputer'],
          aspects: ['double_degree_sequence'],
          facts: {
            'S1 Sistem Informasi': [{ aspect: 'double_degree_sequence', value: ['Bali', 'Australia'] }],
            'S1 Sistem Komputer': [{ aspect: 'double_degree_sequence', value: ['Bali', 'China'] }]
          }
        },
        // Case 5: Partial comparison with missing entity
        {
          entities: ['S1 Sistem Informasi', 'S1 Sistem Komputer'],
          aspects: ['tuition_fee'],
          facts: {
            'S1 Sistem Informasi': [{ aspect: 'tuition_fee', value: 5000000 }]
          }
        },
        // Case 6: Conflicted comparison
        {
          entities: ['S1 Sistem Informasi', 'S1 Sistem Komputer'],
          aspects: ['tuition_fee'],
          facts: {
            'S1 Sistem Informasi': [{ aspect: 'tuition_fee', value: 5000000 }],
            'S1 Sistem Komputer': [{ aspect: 'tuition_fee', value: 4500000 }]
          },
          conflicts: [{ aspect: 'tuition_fee', affectedEntities: ['S1 Sistem Informasi'] }]
        }
      ];

      for (const v of variations) {
        const matrix = buildComparisonMatrix({
          comparedEntities: v.entities,
          requestedAspects: v.aspects,
          factsByEntity: v.facts,
          scopedConflicts: v.conflicts || []
        });

        const plan = compileRenderPlan(matrix);
        const rendered = renderTextFromPlan(plan);

        // Assert no markdown headings starting with #
        expect(rendered).not.toMatch(/^#{1,6}\s/m);
        // Assert no double asterisks **text**
        expect(rendered).not.toMatch(/\*\*[^*]+\*\*/);
        // Assert no leading or trailing whitespace
        expect(rendered).toBe(rendered.trim());
        // Assert no non-breaking spaces
        expect(rendered).not.toContain('\u00A0');
        // Assert no double newlines \n\n (which regex \s{2,} would collapse)
        expect(rendered).not.toMatch(/\n{2,}/);

        // Core Fixed Point Invariant
        const sanitized = sanitizeWhatsAppMarkdown(rendered);
        expect(sanitized).toBe(rendered);
      }
    });
  });

  describe('Category 6: Verification & Transport Validation', () => {
    test('16. validateComparisonEnvelope validates structurally compliant envelopes', () => {
      const matrix = buildComparisonMatrix({
        comparedEntities: ['S1 Sistem Informasi', 'S1 Sistem Komputer'],
        requestedAspects: ['tuition_fee'],
        factsByEntity: {
          'S1 Sistem Informasi': [{ aspect: 'tuition_fee', value: 5000000 }],
          'S1 Sistem Komputer': [{ aspect: 'tuition_fee', value: 4500000 }]
        }
      });
      const renderPlan = compileRenderPlan(matrix);

      const envelope = {
        mode: 'COMPARATIVE',
        matrix,
        renderPlan
      };

      const val = validateComparisonEnvelope(envelope);
      expect(val.valid).toBe(true);
    });

    test('17. validateComparisonEnvelope rejects mismatched or mutated renderPlan', () => {
      const matrix = buildComparisonMatrix({
        comparedEntities: ['S1 Sistem Informasi', 'S1 Sistem Komputer'],
        requestedAspects: ['tuition_fee'],
        factsByEntity: {
          'S1 Sistem Informasi': [{ aspect: 'tuition_fee', value: 5000000 }],
          'S1 Sistem Komputer': [{ aspect: 'tuition_fee', value: 4500000 }]
        }
      });
      const renderPlan = compileRenderPlan(matrix);

      // Mutate plan
      const mutatedPlan = {
        ...renderPlan,
        pairwiseClaims: []
      };

      const envelope = {
        mode: 'COMPARATIVE',
        matrix,
        renderPlan: mutatedPlan
      };

      const val = validateComparisonEnvelope(envelope);
      expect(val.valid).toBe(false);
      expect(val.code).toBe(COMPARATIVE_TRANSPORT_VALIDATION_CODE.RENDER_PLAN_STRUCTURAL_MISMATCH);
    });

    test('18. verifyFinalAnswer enforces exact candidateAnswer equality without normalization', () => {
      const matrix = buildComparisonMatrix({
        comparedEntities: ['S1 Sistem Informasi', 'S1 Sistem Komputer'],
        requestedAspects: ['tuition_fee'],
        factsByEntity: {
          'S1 Sistem Informasi': [{ aspect: 'tuition_fee', value: 5000000 }],
          'S1 Sistem Komputer': [{ aspect: 'tuition_fee', value: 4500000 }]
        }
      });
      const renderPlan = compileRenderPlan(matrix);
      const envelope = { mode: 'COMPARATIVE', matrix, renderPlan };
      const expectedText = renderTextFromPlan(renderPlan);

      // 1. Exact match passes
      const vPass = verifyFinalAnswer(expectedText, {}, {}, envelope);
      expect(vPass.pass).toBe(true);

      // 2. Paraphrased or trailing whitespace candidate rejected
      const vFail = verifyFinalAnswer(expectedText + ' ', {}, {}, envelope);
      expect(vFail.pass).toBe(false);
      expect(vFail.reason).toBe('comparative_text_divergence');
    });

    test('19. verifyFinalAnswer preserves legacy non-comparative paths', () => {
      const normalAnswer = 'Program Studi S1 Sistem Informasi di ITB STIKOM Bali memiliki akreditasi Unggul.';
      const frame = { domain: 'ACADEMIC_PROGRAM', intent: 'ask_accreditation', entities: [{ canonical: 'S1 Sistem Informasi' }] };
      const arbitrated = { accepted: [{ id: 'doc_1' }] };

      const v = verifyFinalAnswer(normalAnswer, frame, arbitrated, null);
      expect(v.pass).toBe(true);
    });
  });

  describe('Category 7: End-to-End Orchestrator Pipeline Survivability', () => {
    test('20. synthesizeAnswer in comparative mode produces exact verified answer', async () => {
      const matrix = buildComparisonMatrix({
        comparedEntities: ['S1 Sistem Informasi', 'S1 Sistem Komputer'],
        requestedAspects: ['tuition_fee'],
        factsByEntity: {
          'S1 Sistem Informasi': [{ aspect: 'tuition_fee', value: 5000000 }],
          'S1 Sistem Komputer': [{ aspect: 'tuition_fee', value: 4500000 }]
        }
      });
      const renderPlan = compileRenderPlan(matrix);
      const envelope = { mode: 'COMPARATIVE', matrix, renderPlan };

      const synth = await synthesizeAnswer({}, {}, envelope);
      expect(synth.success).toBe(true);
      expect(synth.source).toBe('comparative_deterministic_synthesis');

      const verif = verifyFinalAnswer(synth.answer, {}, {}, envelope);
      expect(verif.pass).toBe(true);

      const outbound = sanitizeWhatsAppMarkdown(synth.answer);
      expect(outbound).toBe(synth.answer);
    });
  });

});
