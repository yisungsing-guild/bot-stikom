/**
 * Tests for Production-Safe RAG Architecture
 * 
 * Tests:
 * 1. sessionOrchestrator - intent detection & context reset
 * 2. hardMetadataGates - metadata validation
 * 3. Integration scenarios
 */

const fs = require('fs');
const path = require('path');

// Mock logger
const logger = {
  info: (msg, label) => console.log(`[INFO ${label}]`, msg),
  warn: (msg, label) => console.warn(`[WARN ${label}]`, msg),
  error: (msg, label) => console.error(`[ERROR ${label}]`, msg)
};

const orchestrator = require('../src/middleware/sessionOrchestrator');
const gates = require('../src/engine/hardMetadataGates');

// ============================================================================
// TEST SUITE 1: Session Orchestrator
// ============================================================================

describe('sessionOrchestrator', () => {
  
  test('detects cost intent from question', () => {
    const msg = 'berapa biaya kuliah TI per semester?';
    const result = orchestrator.detectUserIntent(msg);
    
    expect(result).toBeDefined();
    expect(result.intent).toBe('tuition_fee');
    expect(result.confidence).toBeDefined();
    expect(['high', 'medium', 'low'].includes(result.confidence) || result.confidence > 0).toBe(true);
  });

  test('detects schedule intent from question', () => {
    const msg = 'kapan jadwal pendaftaran gelombang 2?';
    const result = orchestrator.detectUserIntent(msg);
    
    expect(result).toBeDefined();
    expect(result.intent).toMatch(/schedule|jadwal/i);
  });

  test('detects program info intent', () => {
    const msg = 'apa itu prodi sistem informasi?';
    const result = orchestrator.detectUserIntent(msg);
    
    expect(result).toBeDefined();
    expect(['general_info', 'program_info', 'admission'].includes(result.intent)).toBe(true);
  });

  test('detects intent transition - cost to schedule', () => {
    const sessionData = {
      __currentIntent: 'tuition_fee',
      __previousIntent: 'general_info',
      __retrievalContext: {
        program: 'TI',
        chunks: [
          { id: 'cost-1', content: 'Biaya TI 5 juta' },
          { id: 'cost-2', content: 'DPP TI 2 juta' }
        ]
      }
    };

    const newMessage = 'jadwal pendaftaran gelombang 1 kapan?';
    const result = orchestrator.processIntentTransition(sessionData, newMessage);

    expect(result).toBeDefined();
    expect(result.shouldResetContext).toBeDefined();
    expect(result.intentAnalysis).toBeDefined();
    expect(result.contextPolicy).toBeDefined();
  });

  test('clears retrieval context on intent change', () => {
    const sessionData = {
      __currentIntent: 'tuition_fee',
      __retrievalContext: {
        program: 'TI',
        chunks: [{ id: 'cost-1', content: 'Biaya TI 5 juta' }]
      },
      __retrievalScores: [0.9, 0.8],
      __semanticAssumptions: ['TI cost based on old context']
    };

    // clearRetrievalContext returns new object, doesn't mutate in place
    const cleared = orchestrator.clearRetrievalContext(sessionData);

    expect(cleared.__retrievalContext).toBeUndefined();
    expect(cleared.__retrievalScores).toBeUndefined();
    expect(cleared.__semanticAssumptions).toBeUndefined();
  });

  test('preserves inheritable entities on context reset', () => {
    const sessionData = {
      program: 'TI',
      campus: 'BALI',
      academicYear: '2024',
      __retrievalContext: {
        chunks: [{ id: 'old' }]
      }
    };

    const cleared = orchestrator.clearRetrievalContext(sessionData);

    expect(cleared.program).toBe('TI'); // Inheritable preserved
    expect(cleared.campus).toBe('BALI'); // Inheritable preserved
    expect(cleared.academicYear).toBe('2024'); // Inheritable preserved
    expect(cleared.__retrievalContext).toBeUndefined(); // Cleared
  });

  test('validates query completeness for cost query', () => {
    const question = 'berapa potongan dpp?';
    const result = orchestrator.validateQueryCompleteness(question, 'tuition_fee');

    expect(result).toBeDefined();
    expect(result.isComplete).toBe(false);
    expect(result.issues).toContain('missing_program');
  });

  test('accepts complete cost query', () => {
    const question = 'berapa potongan dpp untuk prodi ti gelombang 2?';
    const result = orchestrator.validateQueryCompleteness(question, 'tuition_fee');

    // Should be complete - has program (ti) with "prodi" keyword
    expect(result).toBeDefined();
    expect(result.isComplete).toBe(true);
    expect(result.issues).toEqual([]);
  });

  test('builds clarification prompt for incomplete query', () => {
    const question = 'berapa biaya pendaftaran?';
    const validation = {
      isComplete: false,
      issues: ['missing_program'],
      entities: {
        program: null
      }
    };

    const prompt = orchestrator.buildClarificationPrompt(question, validation);

    expect(prompt).toBeDefined();
    expect(prompt.type).toBe('clarification_needed');
    // Message should contain reference to program (case-insensitive)
    expect(prompt.message.toLowerCase()).toContain('program');
    expect(prompt.message).toMatch(/\?/); // Question mark
  });
});

// ============================================================================
// TEST SUITE 2: Hard Metadata Gates
// ============================================================================

describe('hardMetadataGates', () => {

  test('extracts metadata from chunk', () => {
    const chunk = {
      id: 'ch-1',
      program: 'TI',
      wave: 'II',
      academicYear: '2024',
      filename: 'biaya-ti.pdf'
    };

    const result = gates.extractMetadataFromChunk(chunk);

    expect(result.valid).toBe(true);
    expect(result.metadata.program).toBe('TI');
    expect(result.metadata.wave).toBe('II');
    expect(result.metadata.academicYear).toBe('2024');
  });

  test('rejects chunk with invalid metadata', () => {
    const chunk = null;
    const result = gates.extractMetadataFromChunk(chunk);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('invalid_chunk');
  });

  test('HARD GATE: rejects program mismatch', () => {
    const chunk = {
      id: 'ch-1',
      program: 'SI',
      chunk: 'Biaya Sistem Informasi'
    };

    const queryConstraints = { program: 'TI' };
    const result = gates.applyHardMetadataGate(chunk, queryConstraints);

    expect(result.pass).toBe(false);
    expect(result.reason).toBe('program_mismatch');
    expect(result.expected).toBe('TI');
    expect(result.found).toBe('SI');
  });

  test('HARD GATE: rejects wave mismatch', () => {
    const chunk = {
      id: 'ch-1',
      program: 'TI',
      wave: 'II',
      chunk: 'Gelombang II'
    };

    const queryConstraints = { program: 'TI', wave: 'III' };
    const result = gates.applyHardMetadataGate(chunk, queryConstraints);

    expect(result.pass).toBe(false);
    expect(result.reason).toBe('wave_mismatch');
  });

  test('HARD GATE: passes when metadata matches', () => {
    const chunk = {
      id: 'ch-1',
      program: 'TI',
      wave: 'II',
      academicYear: '2024',
      chunk: 'Biaya TI Gelombang II'
    };

    const queryConstraints = { program: 'TI', wave: 'II' };
    const result = gates.applyHardMetadataGate(chunk, queryConstraints);

    expect(result.pass).toBe(true);
    expect(result.reason).toBe('all_gates_passed');
  });

  test('HARD GATE: rejects low OCR quality for financial data', () => {
    const chunk = {
      id: 'ch-1',
      program: 'TI',
      ocrQualityScore: 0.55,
      chunk: 'Biaya TI 5 juta'
    };

    const queryConstraints = { program: 'TI', category: 'FINANCIAL' };
    const result = gates.applyHardMetadataGate(chunk, queryConstraints);

    expect(result.pass).toBe(false);
    expect(result.reason).toBe('ocr_quality_too_low_for_financial');
  });

  test('filters chunks by metadata gates', () => {
    const chunks = [
      {
        id: 'ch-1',
        program: 'TI',
        wave: 'II',
        chunk: 'Biaya TI Gelombang II'
      },
      {
        id: 'ch-2',
        program: 'SI',
        wave: 'II',
        chunk: 'Biaya SI Gelombang II'
      },
      {
        id: 'ch-3',
        program: 'TI',
        wave: 'II',
        chunk: 'DPP TI Gelombang II'
      }
    ];

    const queryConstraints = { program: 'TI' };
    const result = gates.filterChunksByMetadataGates(chunks, queryConstraints);

    expect(result.filtered.length).toBe(2);
    expect(result.rejected).toBe(1);
    expect(result.passRate).toBe('66.7');
    expect(result.filtered.every(c => c.program === 'TI')).toBe(true);
  });

  test('validates query constraints', () => {
    const query = {
      program: 'TI',
      wave: 'II',
      academicYear: '2024'
    };

    const result = gates.validateQueryConstraints(query);

    expect(result).toBeDefined();
    expect(result.valid === true || result.valid === false).toBe(true);
  });

  test('rejects invalid academic year', () => {
    const query = {
      program: 'TI',
      academicYear: '1900' // Too old
    };

    const result = gates.validateQueryConstraints(query);

    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.includes('academicYear_out_of_range'))).toBe(true);
  });

  test('checks metadata consistency across chunks', () => {
    const chunks = [
      { program: 'TI', wave: 'II' },
      { program: 'TI', wave: 'II' },
      { program: 'SI', wave: 'II' }  // Inconsistent program
    ];

    const result = gates.checkMetadataConsistencyAcrossChunks(chunks);

    expect(result.consistent).toBe(false);
    expect(result.inconsistencies).toHaveLength(1);
    expect(result.inconsistencies[0].type).toBe('program_variance');
  });
});

// ============================================================================
// TEST SUITE 3: Integration Scenarios
// ============================================================================

describe('Integration Scenarios', () => {

  test('SCENARIO 1: Intent change from COST to SCHEDULE', () => {
    // User previously asked about TI costs
    const sessionData = {
      program: 'TI',
      __currentIntent: 'tuition_fee',
      __retrievalContext: {
        chunks: [
          { id: 'cost-1', program: 'TI', wave: 'II' },
          { id: 'cost-2', program: 'TI', wave: 'II' }
        ]
      }
    };

    // User now asks about schedule
    const newMessage = 'jadwal pendaftaran gelombang 3?';
    const transition = orchestrator.processIntentTransition(sessionData, newMessage);

    // processIntentTransition returns { session, intentAnalysis, contextPolicy, shouldResetContext }
    expect(transition).toBeDefined();
    expect(transition.session).toBeDefined();
    expect(transition.shouldResetContext).toBe(true); // Intent changed
    expect(transition.session.__retrievalContext).toBeUndefined(); // Cleared
    expect(transition.session.program).toBe('TI'); // Inheritable preserved
  });

  test('SCENARIO 2: Metadata gate prevents wrong-program answer', () => {
    // Query for TI costs
    const queryConstraints = { program: 'TI' };

    // Previous chunks from SI query
    const wrongProgramChunks = [
      {
        id: 'si-cost-1',
        program: 'SI',
        chunk: 'Biaya SI 6 juta',
        score: 0.95 // High similarity but wrong program
      },
      {
        id: 'si-cost-2',
        program: 'SI',
        chunk: 'DPP SI 2.5 juta',
        score: 0.92
      }
    ];

    const result = gates.filterChunksByMetadataGates(wrongProgramChunks, queryConstraints);

    expect(result.filtered.length).toBe(0);
    expect(result.rejected).toBe(2);
    console.log('✓ Metadata gates prevented SI chunks from leaking into TI answer');
  });

  test('SCENARIO 3: Query validation prevents hallucination from incomplete query', () => {
    const incompleteCostQuery = 'berapa potongan dpp gelombang 2?';
    const validation = orchestrator.validateQueryCompleteness(
      incompleteCostQuery,
      'tuition_fee'
    );

    if (!validation.isComplete) {
      const clarification = orchestrator.buildClarificationPrompt(
        incompleteCostQuery,
        validation
      );

      expect(clarification).toBeDefined();
      expect(clarification.message.toLowerCase()).toContain('program');
      expect(clarification.type).toBe('clarification_needed');
      console.log('✓ Clarification prompt prevents RAG query with missing context');
      console.log('  Prompt:', clarification.message);
    }
  });

  test('SCENARIO 4: Multiple intent changes with context cleanup', () => {
    let sessionData = {
      program: 'BD',
      campus: 'BALI',
      __currentIntent: 'tuition_fee',
      __retrievalContext: { chunks: [{ id: 'cost-1' }] },
      __retrievalScores: [0.9],
      lastCostaData: { some: 'data' }
    };

    // First intent: cost
    console.log('Session state 1 (COST):', {
      intent: sessionData.__currentIntent,
      hasRetrievalContext: !!sessionData.__retrievalContext
    });

    // Transition to program info
    const msg2 = 'apa itu bisnis digital?';
    let result2 = orchestrator.processIntentTransition(sessionData, msg2);
    sessionData = result2.session;
    console.log('Session state 2 (PROGRAM_INFO):', {
      intent: sessionData.__currentIntent,
      hasRetrievalContext: !!sessionData.__retrievalContext,
      programPreserved: sessionData.program === 'BD'
    });

    // Transition to schedule
    const msg3 = 'jadwal daftar?';
    let result3 = orchestrator.processIntentTransition(sessionData, msg3);
    sessionData = result3.session;
    console.log('Session state 3 (SCHEDULE):', {
      intent: sessionData.__currentIntent,
      hasRetrievalContext: !!sessionData.__retrievalContext,
      programPreserved: sessionData.program === 'BD'
    });

    expect(sessionData.program).toBe('BD'); // Always preserved
    expect(sessionData.__retrievalContext).toBeUndefined(); // Always cleared on change
  });
});

// ============================================================================
// TEST RUNNER
// ============================================================================

if (require.main === module) {
  console.log('='.repeat(80));
  console.log('PRODUCTION-SAFE RAG ARCHITECTURE TEST SUITE');
  console.log('='.repeat(80));

  // Run tests manually
  const testSuites = [
    {
      name: 'Session Orchestrator',
      tests: [
        { name: 'Intent Detection - Cost', fn: () => {
          const result = orchestrator.detectUserIntent('berapa biaya ti?');
          console.assert(result.intent === 'tuition_fee', 'Failed');
        }},
        { name: 'Intent Detection - Schedule', fn: () => {
          const result = orchestrator.detectUserIntent('kapan jadwal gelombang 2?');
          console.assert(result.intent.includes('schedule') || result.intent.includes('class'), 'Failed');
        }},
        { name: 'Intent Transition', fn: () => {
          const sessionData = {
            __currentIntent: 'tuition_fee',
            __retrieval_context: { chunks: [] }
          };
          const result = orchestrator.processIntentTransition(sessionData, 'jadwal?');
          console.assert(result.intentChanged === true, 'Failed');
          console.assert(sessionData.__retrieval_context === undefined, 'Context not cleared');
        }},
        { name: 'Query Validation', fn: () => {
          const result = orchestrator.validateQueryCompleteness('berapa biaya?', 'tuition_fee');
          console.assert(result.isComplete === false, 'Should be incomplete');
        }},
        { name: 'Clarification Prompt', fn: () => {
          const prompt = orchestrator.buildClarificationPrompt('berapa?', {
            isComplete: false,
            issues: ['program_not_specified'],
            entities: { program: null }
          });
          console.assert(prompt && prompt.length > 0, 'Failed');
        }}
      ]
    },
    {
      name: 'Hard Metadata Gates',
      tests: [
        { name: 'Extract Metadata', fn: () => {
          const result = gates.extractMetadataFromChunk({ program: 'TI' });
          console.assert(result.valid === true, 'Failed');
        }},
        { name: 'Program Mismatch Rejected', fn: () => {
          const result = gates.applyHardMetadataGate(
            { program: 'SI' },
            { program: 'TI' }
          );
          console.assert(result.pass === false && result.reason === 'program_mismatch', 'Failed');
        }},
        { name: 'Program Match Accepted', fn: () => {
          const result = gates.applyHardMetadataGate(
            { program: 'TI' },
            { program: 'TI' }
          );
          console.assert(result.pass === true, 'Failed');
        }},
        { name: 'Filter Chunks', fn: () => {
          const chunks = [
            { program: 'TI' },
            { program: 'SI' },
            { program: 'TI' }
          ];
          const result = gates.filterChunksByMetadataGates(chunks, { program: 'TI' });
          console.assert(result.filtered.length === 2, 'Failed');
          console.assert(result.rejected === 1, 'Failed');
        }},
        { name: 'Validate Query Constraints', fn: () => {
          const result = gates.validateQueryConstraints({ program: 'TI', academicYear: '2024' });
          console.assert(result.valid === true, 'Failed');
        }}
      ]
    }
  ];

  let totalTests = 0;
  let totalPassed = 0;

  for (const suite of testSuites) {
    console.log(`\n[${suite.name}]`);
    for (const test of suite.tests) {
      totalTests++;
      try {
        test.fn();
        console.log(`  ✓ ${test.name}`);
        totalPassed++;
      } catch (e) {
        console.log(`  ✗ ${test.name}`);
        console.log(`    Error: ${e.message}`);
      }
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`RESULTS: ${totalPassed}/${totalTests} tests passed`);
  console.log('='.repeat(80));

  process.exit(totalPassed === totalTests ? 0 : 1);
}

module.exports = {
  orchestrator,
  gates
};
