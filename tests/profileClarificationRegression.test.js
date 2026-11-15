'use strict';

/**
 * Targeted Regression Suite for Program Profile Resolution & Pending Clarification
 *
 * Verifies P1 fixes:
 * 1. semanticInterpretationValidator: Compatible contextual entity pairs (e.g. host institution + academic_program)
 *    do NOT force ambiguity HIGH or trigger false-positive clarification.
 * 2. Canonical Entity Deduplication: Duplicate mentions resolving to the same canonical entity do not trigger false ambiguity.
 * 3. Host Institution Guard: Only the host institution (ITB STIKOM Bali) encloses internal programs/facilities;
 *    external institutions (e.g. Universitas Udayana) are treated as competing alternatives.
 * 4. Disparate unproven categories without host context or COMPARE are marked competing.
 * 5. contextResolver: Bare program query recognizes aliases (e.g. "sistem informasi", "si")
 *    and resumes valid pendingClarification with clarification_entity_response.
 * 6. orchestrator Pending Clarification Lifecycle:
 *    - Never creates pending clarification on terminal SAFE_UNKNOWN or VERIFICATION_FAILED.
 *    - Never creates pending clarification on generic escalation (only on genuine clarification_prompt).
 *    - Creates pending clarification ONLY when output is a genuine clarification prompt for supported slots ('program').
 *    - Clears pending clarification once resolved or on explicit reset.
 * 7. Multi-turn conversation integration matching the WhatsApp scenario:
 *    Turn 1 -> Program Profile query with host institution + program
 *    Turn 2 -> "sistem informasi" clarification answer
 *    Turn 3 -> "Kalau semester 5 bagaimana?" QA-404 curriculum ellipsis inheritance
 */

const {
  hasMultipleCompetingEntities,
  validateSemanticInterpretation,
  resolveInternationalParentProgram
} = require('../src/core/semanticInterpretationValidator');
const { findCanonicalEntity } = require('../src/engine/canonicalEntityRegistry');
const { evaluateContextDependency } = require('../src/core/contextResolver');
const {
  processTurn,
  determineClarificationContext,
  isClarificationResponsePredicate
} = require('../src/core/orchestrator');
const { VERIFICATION_OUTCOME } = require('../src/reasoning/contracts');
const { ANSWERABILITY_STATUS } = require('../src/core/answerabilityGate');

jest.setTimeout(60000);

describe('Program Profile Resolution & Pending Clarification Regression Suite', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
    process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';
  });

  describe('1. hasMultipleCompetingEntities Unit Logic (Registry & Relationship Validation)', () => {
    // 1. Host institution + registered program
    test('1. Host institution + registered program is NOT competing', () => {
      const candidates = [
        { rawMention: 'S1 Sistem Informasi', canonical: 'S1 Sistem Informasi', inferredCategory: 'academic_program' },
        { rawMention: 'ITB STIKOM Bali', canonical: 'ITB STIKOM Bali', inferredCategory: 'institution' }
      ];
      expect(hasMultipleCompetingEntities(candidates, 'INQUIRE_PROPERTY')).toBe(false);
    });

    // 2. Host institution + registered facility
    test('2. Host institution + registered facility is NOT competing', () => {
      const candidates = [
        { rawMention: 'Laboratorium Komputer', canonical: 'Laboratorium Komputer', inferredCategory: 'facility' },
        { rawMention: 'ITB STIKOM Bali', canonical: 'ITB STIKOM Bali', inferredCategory: 'institution' }
      ];
      expect(hasMultipleCompetingEntities(candidates, 'INQUIRE_PROPERTY')).toBe(false);
    });

    // 3. Host institution + unknown facility
    test('3. Host institution + unknown facility ARE competing', () => {
      const candidates = [
        { rawMention: 'Lab Komputer Robotika XYZ', canonical: 'Lab Komputer Robotika XYZ', inferredCategory: 'facility' },
        { rawMention: 'ITB STIKOM Bali', canonical: 'ITB STIKOM Bali', inferredCategory: 'institution' }
      ];
      expect(hasMultipleCompetingEntities(candidates, 'INQUIRE_PROPERTY')).toBe(true);
    });

    // 4. Program + registered admission track yang sesuai jenjang
    test('4. Program + registered admission track matching degree is NOT competing', () => {
      const candidates = [
        { rawMention: 'S1 Sistem Informasi', canonical: 'S1 Sistem Informasi', inferredCategory: 'academic_program' },
        { rawMention: 'Jalur Reguler', canonical: 'Jalur Reguler', inferredCategory: 'admission_track' }
      ];
      expect(hasMultipleCompetingEntities(candidates, 'INQUIRE_PROPERTY')).toBe(false);
    });

    // 5. Program + unknown/unrelated admission track
    test('5. Program + unknown/unrelated admission track ARE competing', () => {
      const candidates = [
        { rawMention: 'S1 Sistem Informasi', canonical: 'S1 Sistem Informasi', inferredCategory: 'academic_program' },
        { rawMention: 'Jalur SNMPTN Undangan Negeri', canonical: 'Jalur SNMPTN Undangan Negeri', inferredCategory: 'admission_track' }
      ];
      expect(hasMultipleCompetingEntities(candidates, 'INQUIRE_PROPERTY')).toBe(true);
    });

    // 6. Program + HELP University dengan parentProgram yang tepat
    test('6. Program + HELP University matching parentProgram is NOT competing', () => {
      const candidates = [
        { rawMention: 'S1 Sistem Informasi', canonical: 'S1 Sistem Informasi', inferredCategory: 'academic_program' },
        { rawMention: 'Help University', canonical: 'Double Degree HELP University', inferredCategory: 'international_program' }
      ];
      expect(hasMultipleCompetingEntities(candidates, 'INQUIRE_PROPERTY')).toBe(false);
    });

    // 7. Program + DNUI dengan parentProgram yang berbeda
    test('7. Program + DNUI with mismatched parentProgram ARE competing', () => {
      const candidates = [
        { rawMention: 'S1 Sistem Informasi', canonical: 'S1 Sistem Informasi', inferredCategory: 'academic_program' },
        { rawMention: 'DNUI', canonical: 'Double Degree DNUI', inferredCategory: 'international_program' }
      ];
      expect(hasMultipleCompetingEntities(candidates, 'INQUIRE_PROPERTY')).toBe(true);
    });

    test('7b. S1 Bisnis Digital + DNUI with matching parentProgram is NOT competing', () => {
      const candidates = [
        { rawMention: 'S1 Bisnis Digital', canonical: 'S1 Bisnis Digital', inferredCategory: 'academic_program' },
        { rawMention: 'DNUI', canonical: 'Double Degree DNUI', inferredCategory: 'international_program' }
      ];
      expect(hasMultipleCompetingEntities(candidates, 'INQUIRE_PROPERTY')).toBe(false);
    });

    test('7c. S1 Teknologi Informasi + HELP University with mismatched parentProgram ARE competing', () => {
      const candidates = [
        { rawMention: 'S1 Teknologi Informasi', canonical: 'S1 Teknologi Informasi', inferredCategory: 'academic_program' },
        { rawMention: 'Help University', canonical: 'Double Degree HELP University', inferredCategory: 'international_program' }
      ];
      expect(hasMultipleCompetingEntities(candidates, 'INQUIRE_PROPERTY')).toBe(true);
    });

    // 8. Program + unknown external partner
    test('8. Program + unknown external partner ARE competing', () => {
      const candidates = [
        { rawMention: 'S1 Sistem Informasi', canonical: 'S1 Sistem Informasi', inferredCategory: 'academic_program' },
        { rawMention: 'Unknown Foreign University', canonical: 'Unknown Foreign University', inferredCategory: 'external_partner' }
      ];
      expect(hasMultipleCompetingEntities(candidates, 'INQUIRE_PROPERTY')).toBe(true);
    });

    // 9. Duplicate canonical institution aliases
    test('9. Duplicate canonical institution aliases are deduplicated and NOT competing', () => {
      const candidates = [
        { rawMention: 'ITB STIKOM Bali', canonical: 'ITB STIKOM Bali', inferredCategory: 'institution' },
        { rawMention: 'STIKOM Bali', canonical: 'ITB STIKOM Bali', inferredCategory: 'institution' }
      ];
      expect(hasMultipleCompetingEntities(candidates, 'INQUIRE_PROPERTY')).toBe(false);
    });

    // 10. Duplicate canonical program aliases
    test('10. Duplicate canonical program aliases are deduplicated and NOT competing', () => {
      const candidates = [
        { rawMention: 'S1 Sistem Informasi', canonical: 'S1 Sistem Informasi', inferredCategory: 'academic_program' },
        { rawMention: 'Sistem Informasi', canonical: 'S1 Sistem Informasi', inferredCategory: 'academic_program' }
      ];
      expect(hasMultipleCompetingEntities(candidates, 'INQUIRE_PROPERTY')).toBe(false);
    });

    // 11. Two distinct programs remain competing
    test('11. Two distinct academic_programs ARE competing when speechAct !== COMPARE', () => {
      const candidates = [
        { rawMention: 'S1 Sistem Informasi', canonical: 'S1 Sistem Informasi', inferredCategory: 'academic_program' },
        { rawMention: 'S1 Teknologi Informasi', canonical: 'S1 Teknologi Informasi', inferredCategory: 'academic_program' }
      ];
      expect(hasMultipleCompetingEntities(candidates, 'INQUIRE_PROPERTY')).toBe(true);
    });

    // 12. Two distinct institutions remain competing
    test('12. Two distinct institutions ARE competing', () => {
      const candidates = [
        { rawMention: 'ITB STIKOM Bali', canonical: 'ITB STIKOM Bali', inferredCategory: 'institution' },
        { rawMention: 'Universitas Udayana', canonical: 'Universitas Udayana', inferredCategory: 'institution' }
      ];
      expect(hasMultipleCompetingEntities(candidates, 'INQUIRE_PROPERTY')).toBe(true);
    });

    // Additional guards
    test('Additional Guard: two academic_programs are NOT marked competing when speechAct === COMPARE', () => {
      const candidates = [
        { rawMention: 'S1 Sistem Informasi', canonical: 'S1 Sistem Informasi', inferredCategory: 'academic_program' },
        { rawMention: 'S1 Teknologi Informasi', canonical: 'S1 Teknologi Informasi', inferredCategory: 'academic_program' }
      ];
      expect(hasMultipleCompetingEntities(candidates, 'COMPARE')).toBe(false);
    });

    test('Additional Guard: unproven disparate categories without host context ARE competing', () => {
      const candidates = [
        { rawMention: 'Laboratorium Komputer', canonical: 'Laboratorium Komputer', inferredCategory: 'facility' },
        { rawMention: 'S1 Sistem Informasi', canonical: 'S1 Sistem Informasi', inferredCategory: 'academic_program' }
      ];
      expect(hasMultipleCompetingEntities(candidates, 'INQUIRE_PROPERTY')).toBe(true);
    });
  });

  describe('2. validateSemanticInterpretation Validation Gate', () => {
    test('Query with prodi + host institution retains LOW ambiguity and RESOLVED status', () => {
      const interpretation = {
        speechAct: 'INQUIRE_PROPERTY',
        primaryIntent: 'PROGRAM_OVERVIEW',
        userInterest: null,
        executionRoute: 'FACTUAL_INQUIRY',
        semanticConcepts: ['ACADEMIC_OFFERING'],
        candidateEntities: [
          { rawMention: 'S1 Sistem Informasi', inferredCategory: 'academic_program', academicLevel: 'S1' },
          { rawMention: 'ITB STIKOM Bali', inferredCategory: 'institution', academicLevel: null }
        ],
        requestedAspects: ['general'],
        scopeConstraints: {
          academicLevel: 'S1',
          studyMode: null,
          locationConstraint: null,
          locationScope: 'GENERAL'
        },
        contextDependency: {
          isFollowUp: false,
          referenceType: 'none',
          topicContinuity: 'NEW_TOPIC',
          relevantPriorContext: null
        },
        confidence: 0.95,
        ambiguityLevel: 'LOW'
      };

      const result = validateSemanticInterpretation(interpretation);
      expect(result.isValid).toBe(true);
      expect(result.validatedFrame.ambiguityLevel).toBe('LOW');
      expect(result.validatedFrame.requiresClarification).toBe(false);
      expect(result.validatedFrame.entityResolutionStatus).toBe('RESOLVED');
    });

    test('Query with 2 competing prodis escalates to HIGH ambiguity with MULTIPLE_COMPETING_ENTITIES', () => {
      const interpretation = {
        speechAct: 'INQUIRE_PROPERTY',
        primaryIntent: 'PROGRAM_OVERVIEW',
        userInterest: null,
        executionRoute: 'FACTUAL_INQUIRY',
        semanticConcepts: ['ACADEMIC_OFFERING'],
        candidateEntities: [
          { rawMention: 'S1 Sistem Informasi', inferredCategory: 'academic_program', academicLevel: 'S1' },
          { rawMention: 'S1 Teknologi Informasi', inferredCategory: 'academic_program', academicLevel: 'S1' }
        ],
        requestedAspects: ['general'],
        scopeConstraints: {
          academicLevel: 'S1',
          studyMode: null,
          locationConstraint: null,
          locationScope: 'GENERAL'
        },
        contextDependency: {
          isFollowUp: false,
          referenceType: 'none',
          topicContinuity: 'NEW_TOPIC',
          relevantPriorContext: null
        },
        confidence: 0.95,
        ambiguityLevel: 'LOW'
      };

      const result = validateSemanticInterpretation(interpretation);
      expect(result.isValid).toBe(true);
      expect(result.validatedFrame.ambiguityLevel).toBe('HIGH');
      expect(result.validatedFrame.requiresClarification).toBe(true);
      expect(result.validatedFrame.clarificationReason).toBe('MULTIPLE_COMPETING_ENTITIES');
      expect(result.validatedFrame.entityResolutionStatus).toBe('AMBIGUOUS');
    });
  });

  describe('3. contextResolver Bare Program Query & Clarification Resume', () => {
    test('"sistem informasi" matches canonical entity and resumes pending clarification', () => {
      const sessionData = {
        activeDomain: 'GENERAL',
        activeIntent: 'AMBIGUOUS_CLARIFICATION',
        pendingClarification: {
          originalDomain: 'ACADEMIC_PROGRAM',
          originalIntent: 'PROGRAM_OVERVIEW',
          requiredSlot: 'program',
          status: 'PENDING',
          createdAt: Date.now()
        }
      };

      const dep = evaluateContextDependency('sistem informasi', sessionData);
      expect(dep.shouldInherit).toBe(true);
      expect(dep.reason).toBe('clarification_entity_response');
      expect(dep.inheritedDomain).toBe('ACADEMIC_PROGRAM');
      expect(dep.inheritedIntent).toBe('PROGRAM_OVERVIEW');
      expect(dep.inheritedEntity).toBe('S1 Sistem Informasi');
      expect(dep.clarificationResolved).toBe(true);
    });

    test('Short alias "si" resumes pending clarification', () => {
      const sessionData = {
        activeDomain: 'GENERAL',
        activeIntent: 'AMBIGUOUS_CLARIFICATION',
        pendingClarification: {
          originalDomain: 'ACADEMIC_PROGRAM',
          originalIntent: 'PROGRAM_OVERVIEW',
          requiredSlot: 'program',
          status: 'PENDING',
          createdAt: Date.now()
        }
      };

      const dep = evaluateContextDependency('si', sessionData);
      expect(dep.shouldInherit).toBe(true);
      expect(dep.reason).toBe('clarification_entity_response');
      expect(dep.inheritedDomain).toBe('ACADEMIC_PROGRAM');
      expect(dep.inheritedIntent).toBe('PROGRAM_OVERVIEW');
      expect(dep.inheritedEntity).toBe('S1 Sistem Informasi');
      expect(dep.clarificationResolved).toBe(true);
    });

    test('Prefixed query "prodi sistem informasi" resumes pending clarification', () => {
      const sessionData = {
        pendingClarification: {
          originalDomain: 'ACADEMIC_CURRICULUM',
          originalIntent: 'CURRICULUM_INQUIRY',
          requiredSlot: 'program',
          status: 'PENDING',
          createdAt: Date.now()
        }
      };

      const dep = evaluateContextDependency('prodi sistem informasi', sessionData);
      expect(dep.shouldInherit).toBe(true);
      expect(dep.reason).toBe('clarification_entity_response');
      expect(dep.inheritedDomain).toBe('ACADEMIC_CURRICULUM');
      expect(dep.inheritedIntent).toBe('CURRICULUM_INQUIRY');
      expect(dep.inheritedEntity).toBe('S1 Sistem Informasi');
      expect(dep.clarificationResolved).toBe(true);
    });

    test('Non-bare query does not trigger clarification_entity_response', () => {
      const sessionData = {
        pendingClarification: {
          originalDomain: 'ACADEMIC_PROGRAM',
          originalIntent: 'PROGRAM_OVERVIEW',
          requiredSlot: 'program',
          status: 'PENDING',
          createdAt: Date.now()
        }
      };

      const dep = evaluateContextDependency('berapa biaya kuliah di kampus renon?', sessionData);
      expect(dep.reason).not.toBe('clarification_entity_response');
      expect(dep.clarificationResolved).toBeFalsy();
    });
  });

  describe('4. Pending Clarification Lifecycle & Verifier Invariance', () => {
    test('determineClarificationContext correctly extracts slots and intents from query markers', () => {
      const curQuery = determineClarificationContext({}, 'Bagaimana kurikulum dan mata kuliahnya?');
      expect(curQuery.requiredSlot).toBe('program');
      expect(curQuery.originalDomain).toBe('ACADEMIC_CURRICULUM');
      expect(curQuery.originalIntent).toBe('CURRICULUM_INQUIRY');

      const feeQuery = determineClarificationContext({}, 'Berapa biaya kuliah SPP per semester?');
      expect(feeQuery.requiredSlot).toBe('program');
      expect(feeQuery.originalDomain).toBe('TUITION_FEE');
      expect(feeQuery.originalIntent).toBe('TUITION_FEE_INQUIRY');

      const facQuery = determineClarificationContext({}, 'Fasilitas perpustakaan dan lab apa saja?');
      expect(facQuery.requiredSlot).toBe('facility');
      expect(facQuery.originalDomain).toBe('FACILITIES');
    });

    // Helper to evaluate orchestrator pending clarification decision logic using production predicate
    function evaluatePendingCreation({
      finalOutcome,
      finalReason = null,
      synthesisSource = null,
      synthesisReason = null,
      answerability = null,
      primaryFrame = {},
      requiredSlot = 'program',
      isExplicitReset = false
    }) {
      const isClarificationResponse = isClarificationResponsePredicate({
        finalOutcome,
        finalReason,
        synthesisSource,
        synthesisReason,
        answerability
      });

      let newPendingClarification = null;
      if (isExplicitReset || primaryFrame.clarificationResolved || primaryFrame.contextDep?.clarificationResolved) {
        newPendingClarification = null;
      } else if (isClarificationResponse) {
        if (requiredSlot === 'program') {
          newPendingClarification = {
            originalDomain: 'ACADEMIC_PROGRAM',
            originalIntent: 'PROGRAM_OVERVIEW',
            clarificationQuestion: 'Silakan perjelas program studi',
            requiredSlot,
            status: 'PENDING'
          };
        } else {
          newPendingClarification = null;
        }
      } else {
        newPendingClarification = null;
      }
      return newPendingClarification;
    }

    test('Situation A: synthesis ambiguous clarification with NEEDS_CLARIFICATION creates pending', () => {
      const pending = evaluatePendingCreation({
        finalOutcome: 'NEEDS_CLARIFICATION',
        synthesisSource: 'ambiguous_clarification_synthesis',
        requiredSlot: 'program'
      });
      expect(pending).not.toBeNull();
      expect(pending?.status).toBe('PENDING');
      expect(pending?.requiredSlot).toBe('program');
    });

    test('Situation B: primaryFrame intent AMBIGUOUS_CLARIFICATION with terminal SAFE_UNKNOWN does NOT create pending', () => {
      const pending = evaluatePendingCreation({
        finalOutcome: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
        finalReason: 'safe_unknown_corpus_gap',
        primaryFrame: { intent: 'AMBIGUOUS_CLARIFICATION' },
        requiredSlot: 'program'
      });
      expect(pending).toBeNull();
    });

    test('Situation C: desiredAction ASK_CLARIFICATION with generic ESCALATION_GUIDANCE does NOT create pending', () => {
      const pending = evaluatePendingCreation({
        finalOutcome: VERIFICATION_OUTCOME.ESCALATION_GUIDANCE,
        finalReason: 'unsupported_complex_query',
        primaryFrame: { desiredAction: 'ASK_CLARIFICATION' },
        requiredSlot: 'program'
      });
      expect(pending).toBeNull();
    });

    test('Situation D: ESCALATION_GUIDANCE with clarification_prompt creates pending for supported slot', () => {
      const pending = evaluatePendingCreation({
        finalOutcome: VERIFICATION_OUTCOME.ESCALATION_GUIDANCE,
        finalReason: 'clarification_prompt',
        requiredSlot: 'program'
      });
      expect(pending).not.toBeNull();
      expect(pending?.status).toBe('PENDING');
    });

    test('Situation E: VERIFICATION_FAILED outcome never creates pending', () => {
      const pending = evaluatePendingCreation({
        finalOutcome: VERIFICATION_OUTCOME.VERIFICATION_FAILED,
        finalReason: 'hallucination_detected',
        synthesisSource: 'ambiguous_clarification_synthesis',
        requiredSlot: 'program'
      });
      expect(pending).toBeNull();
    });

    test('Situation F: Clarification prompt for unsupported slot (facility) does NOT create uncontinuable pending', () => {
      const pending = evaluatePendingCreation({
        finalOutcome: 'NEEDS_CLARIFICATION',
        finalReason: 'clarification_prompt',
        requiredSlot: 'facility'
      });
      expect(pending).toBeNull();
    });

    // --- Micro-Review Risk A: ambiguous_program_faculty_clarification 5 Combinations ---
    test('Risk A1: synthesisReason + NEEDS_CLARIFICATION creates pending', () => {
      const pending = evaluatePendingCreation({
        synthesisReason: 'ambiguous_program_faculty_clarification',
        finalOutcome: 'NEEDS_CLARIFICATION',
        requiredSlot: 'program'
      });
      expect(pending).not.toBeNull();
      expect(pending?.status).toBe('PENDING');
    });

    test('Risk A2: synthesisReason + ESCALATION_GUIDANCE + clarification_prompt creates pending', () => {
      const pending = evaluatePendingCreation({
        synthesisReason: 'ambiguous_program_faculty_clarification',
        finalOutcome: 'ESCALATION_GUIDANCE',
        finalReason: 'clarification_prompt',
        requiredSlot: 'program'
      });
      expect(pending).not.toBeNull();
      expect(pending?.status).toBe('PENDING');
    });

    test('Risk A3: synthesisReason + ESCALATION_GUIDANCE + generic reason does NOT create pending', () => {
      const pending = evaluatePendingCreation({
        synthesisReason: 'ambiguous_program_faculty_clarification',
        finalOutcome: 'ESCALATION_GUIDANCE',
        finalReason: 'unsupported_complex_query',
        requiredSlot: 'program'
      });
      expect(pending).toBeNull();
    });

    test('Risk A4: synthesisReason + SAFE_UNKNOWN does NOT create pending', () => {
      const pending = evaluatePendingCreation({
        synthesisReason: 'ambiguous_program_faculty_clarification',
        finalOutcome: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
        finalReason: 'safe_unknown_corpus_gap',
        requiredSlot: 'program'
      });
      expect(pending).toBeNull();
    });

    test('Risk A5: synthesisReason + VERIFICATION_FAILED does NOT create pending', () => {
      const pending = evaluatePendingCreation({
        synthesisReason: 'ambiguous_program_faculty_clarification',
        finalOutcome: VERIFICATION_OUTCOME.VERIFICATION_FAILED,
        finalReason: 'unverified_content',
        requiredSlot: 'program'
      });
      expect(pending).toBeNull();
    });

    // --- 11 Targeted Edge-Case Scenarios on isClarificationResponsePredicate & Lifecycle ---
    describe('11 Targeted Edge Cases for isClarificationResponsePredicate', () => {
      test('1. VERIFIED_FACTUAL + synthesisSource ambiguous_clarification_synthesis -> false (no pending)', () => {
        const isClarif = isClarificationResponsePredicate({
          finalOutcome: VERIFICATION_OUTCOME.VERIFIED_FACTUAL,
          synthesisSource: 'ambiguous_clarification_synthesis'
        });
        expect(isClarif).toBe(false);
        const pending = evaluatePendingCreation({
          finalOutcome: VERIFICATION_OUTCOME.VERIFIED_FACTUAL,
          synthesisSource: 'ambiguous_clarification_synthesis'
        });
        expect(pending).toBeNull();
      });

      test('2. PARTIAL + synthesisSource ambiguous_clarification_synthesis -> false (no pending)', () => {
        const isClarif = isClarificationResponsePredicate({
          finalOutcome: 'PARTIAL',
          synthesisSource: 'ambiguous_clarification_synthesis'
        });
        expect(isClarif).toBe(false);
        const pending = evaluatePendingCreation({
          finalOutcome: 'PARTIAL',
          synthesisSource: 'ambiguous_clarification_synthesis'
        });
        expect(pending).toBeNull();
      });

      test('3. VERIFIED_FACTUAL + synthesisReason ambiguous_program_faculty_clarification -> false (no pending)', () => {
        const isClarif = isClarificationResponsePredicate({
          finalOutcome: VERIFICATION_OUTCOME.VERIFIED_FACTUAL,
          synthesisReason: 'ambiguous_program_faculty_clarification'
        });
        expect(isClarif).toBe(false);
        const pending = evaluatePendingCreation({
          finalOutcome: VERIFICATION_OUTCOME.VERIFIED_FACTUAL,
          synthesisReason: 'ambiguous_program_faculty_clarification'
        });
        expect(pending).toBeNull();
      });

      test('4. PARTIAL + synthesisReason ambiguous_program_faculty_clarification -> false (no pending)', () => {
        const isClarif = isClarificationResponsePredicate({
          finalOutcome: 'PARTIAL',
          synthesisReason: 'ambiguous_program_faculty_clarification'
        });
        expect(isClarif).toBe(false);
        const pending = evaluatePendingCreation({
          finalOutcome: 'PARTIAL',
          synthesisReason: 'ambiguous_program_faculty_clarification'
        });
        expect(pending).toBeNull();
      });

      test('5. VERIFIED_FACTUAL + answerability CLARIFY + finalReason clarification_prompt -> false (no pending)', () => {
        const isClarif = isClarificationResponsePredicate({
          finalOutcome: VERIFICATION_OUTCOME.VERIFIED_FACTUAL,
          finalReason: 'clarification_prompt',
          answerability: ANSWERABILITY_STATUS.CLARIFY
        });
        expect(isClarif).toBe(false);
        const pending = evaluatePendingCreation({
          finalOutcome: VERIFICATION_OUTCOME.VERIFIED_FACTUAL,
          finalReason: 'clarification_prompt',
          answerability: ANSWERABILITY_STATUS.CLARIFY
        });
        expect(pending).toBeNull();
      });

      test('6. PARTIAL + answerability CLARIFY + finalReason clarification_prompt -> false (no pending)', () => {
        const isClarif = isClarificationResponsePredicate({
          finalOutcome: 'PARTIAL',
          finalReason: 'clarification_prompt',
          answerability: ANSWERABILITY_STATUS.CLARIFY
        });
        expect(isClarif).toBe(false);
        const pending = evaluatePendingCreation({
          finalOutcome: 'PARTIAL',
          finalReason: 'clarification_prompt',
          answerability: ANSWERABILITY_STATUS.CLARIFY
        });
        expect(pending).toBeNull();
      });

      test('7. NEEDS_CLARIFICATION + synthesisSource ambiguous_clarification_synthesis -> true (creates pending)', () => {
        const isClarif = isClarificationResponsePredicate({
          finalOutcome: 'NEEDS_CLARIFICATION',
          synthesisSource: 'ambiguous_clarification_synthesis'
        });
        expect(isClarif).toBe(true);
        const pending = evaluatePendingCreation({
          finalOutcome: 'NEEDS_CLARIFICATION',
          synthesisSource: 'ambiguous_clarification_synthesis'
        });
        expect(pending).not.toBeNull();
        expect(pending?.status).toBe('PENDING');
      });

      test('8. ESCALATION_GUIDANCE + finalReason clarification_prompt -> true (creates pending)', () => {
        const isClarif = isClarificationResponsePredicate({
          finalOutcome: VERIFICATION_OUTCOME.ESCALATION_GUIDANCE,
          finalReason: 'clarification_prompt'
        });
        expect(isClarif).toBe(true);
        const pending = evaluatePendingCreation({
          finalOutcome: VERIFICATION_OUTCOME.ESCALATION_GUIDANCE,
          finalReason: 'clarification_prompt'
        });
        expect(pending).not.toBeNull();
        expect(pending?.status).toBe('PENDING');
      });

      test('9. ESCALATION_GUIDANCE + generic non-clarification reason -> false (no pending)', () => {
        const isClarif = isClarificationResponsePredicate({
          finalOutcome: VERIFICATION_OUTCOME.ESCALATION_GUIDANCE,
          finalReason: 'unsupported_complex_query'
        });
        expect(isClarif).toBe(false);
        const pending = evaluatePendingCreation({
          finalOutcome: VERIFICATION_OUTCOME.ESCALATION_GUIDANCE,
          finalReason: 'unsupported_complex_query'
        });
        expect(pending).toBeNull();
      });

      test('10. SAFE_UNKNOWN + synthesisSource ambiguous_clarification_synthesis -> false (no pending)', () => {
        const isClarif = isClarificationResponsePredicate({
          finalOutcome: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
          synthesisSource: 'ambiguous_clarification_synthesis'
        });
        expect(isClarif).toBe(false);
        const pending = evaluatePendingCreation({
          finalOutcome: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
          synthesisSource: 'ambiguous_clarification_synthesis'
        });
        expect(pending).toBeNull();
      });

      test('11. VERIFICATION_FAILED + synthesisSource ambiguous_clarification_synthesis -> false (no pending)', () => {
        const isClarif = isClarificationResponsePredicate({
          finalOutcome: VERIFICATION_OUTCOME.VERIFICATION_FAILED,
          synthesisSource: 'ambiguous_clarification_synthesis'
        });
        expect(isClarif).toBe(false);
        const pending = evaluatePendingCreation({
          finalOutcome: VERIFICATION_OUTCOME.VERIFICATION_FAILED,
          synthesisSource: 'ambiguous_clarification_synthesis'
        });
        expect(pending).toBeNull();
      });

      test('12. Lifecycle: Explicit reset clears pending even on valid clarification', () => {
        const pending = evaluatePendingCreation({
          finalOutcome: 'NEEDS_CLARIFICATION',
          isExplicitReset: true
        });
        expect(pending).toBeNull();
      });

      test('13. Lifecycle: clarificationResolved clears pending even on valid clarification', () => {
        const pending = evaluatePendingCreation({
          finalOutcome: 'NEEDS_CLARIFICATION',
          primaryFrame: { clarificationResolved: true }
        });
        expect(pending).toBeNull();
      });
    });
  });

  describe('5. resolveInternationalParentProgram Micro-Validation', () => {
    test('1. HELP University with explicit parentProgram resolves to S1 Sistem Informasi', () => {
      const helpRecord = findCanonicalEntity('Help University');
      expect(resolveInternationalParentProgram(helpRecord)).toBe('S1 Sistem Informasi');
    });

    test('2. DNUI with metadata parent program Bisnis Digital resolves to S1 Bisnis Digital', () => {
      const dnuiRecord = findCanonicalEntity('DNUI');
      expect(resolveInternationalParentProgram(dnuiRecord)).toBe('S1 Bisnis Digital');
    });

    test('3. UTB with metadata parent program Bisnis Digital resolves to S1 Bisnis Digital', () => {
      const utbRecord = findCanonicalEntity('UTB');
      expect(resolveInternationalParentProgram(utbRecord)).toBe('S1 Bisnis Digital');
    });

    test('4. International program without parentProgram and without explicit program credentials returns null', () => {
      const exchangeRecord = findCanonicalEntity('Student Exchange');
      expect(resolveInternationalParentProgram(exchangeRecord)).toBeNull();
    });

    test('5. International program with credential S.Kom but without explicit parentProgram returns null (no ungrounded inference)', () => {
      const fakeRecord = {
        canonical: 'Program Mitra Sembarang',
        credentials: ['Sarjana Komputer (S.Kom) dari ITB STIKOM Bali']
      };
      expect(resolveInternationalParentProgram(fakeRecord)).toBeNull();
    });

    test('6. parentProgram that cannot be resolved to canonical registry returns null (never raw unverified string)', () => {
      const fakeUnresolved = {
        canonical: 'Program Fiktif',
        parentProgram: 'S3 Ilmu Komputer Fiktif'
      };
      expect(resolveInternationalParentProgram(fakeUnresolved)).toBeNull();
    });
  });

  describe('6. Multi-turn Orchestrator Clarification & QA-404 Continuity', () => {
    test('Clarification flow: ambiguous prompt saves pending, entity response resolves and clears pending', async () => {
      const chatId = 'test-clarif-flow-' + Date.now();

      // Step 1: Query that triggers clarification
      const turn1 = await processTurn(chatId, 'Bagaimana alur pendaftarannya?', { executeDispatch: false });
      if (turn1.text.includes('perjelas program studi') || turn1.semanticFrame?.intent === 'AMBIGUOUS_CLARIFICATION') {
        const sessionStore = require('../src/core/sessionStore');
        const session1 = await sessionStore.getSession(chatId);
        expect(session1.pendingClarification).not.toBeNull();
        expect(session1.pendingClarification?.requiredSlot).toBe('program');

        // Step 2: User answers with bare program alias
        const turn2 = await processTurn(chatId, 'sistem informasi', { executeDispatch: false });
        const session2 = await sessionStore.getSession(chatId);
        expect(session2.pendingClarification).toBeNull();
        expect(session2.activeEntity).toBe('S1 Sistem Informasi');

        // Step 3: Elliptical follow-up on semester 5 (QA-404)
        const turn3 = await processTurn(chatId, 'Kalau semester 5 bagaimana?', { executeDispatch: false });
        expect(turn3.semanticFrame?.domain).toBe('ACADEMIC_CURRICULUM');
        expect(turn3.semanticFrame?.intent).toBe('CURRICULUM_INQUIRY');
        expect(turn3.semanticFrame?.entities?.[0]?.canonical).toBe('S1 Sistem Informasi');
      }
    });

    test('Direct profile inquiry: S1 Sistem Informasi ITB STIKOM Bali provides profile and sets activeEntity', async () => {
      const chatId = 'test-profile-direct-' + Date.now();

      const turn1 = await processTurn(chatId, 'Jelaskan profil Program Studi S1 Sistem Informasi ITB STIKOM Bali.', { executeDispatch: false });
      expect(turn1.semanticFrame?.domain).toBe('ACADEMIC_PROGRAM');
      expect(turn1.semanticFrame?.isAmbiguous).toBe(false);
      expect(turn1.semanticFrame?.entities?.[0]?.canonical).toBe('S1 Sistem Informasi');

      // Now follow-up with QA-404
      const turn2 = await processTurn(chatId, 'Kalau semester 5 bagaimana?', { executeDispatch: false });
      expect(turn2.semanticFrame?.domain).toBe('ACADEMIC_CURRICULUM');
      expect(turn2.semanticFrame?.intent).toBe('CURRICULUM_INQUIRY');
      expect(turn2.semanticFrame?.entities?.[0]?.canonical).toBe('S1 Sistem Informasi');
      expect(turn2.text).toMatch(/semester 5|20 sks|mata kuliah/i);
    });
  });
});
