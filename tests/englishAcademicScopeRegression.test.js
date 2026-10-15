'use strict';

/**
 * tests/englishAcademicScopeRegression.test.js
 *
 * Regression Test Suite:
 * English Academic Scope & Program Listing Classification
 *
 * Verifies:
 * 1. EN: "What are the undergraduate study programs available?" -> ACADEMIC_PROGRAM / AVAILABLE_PROGRAMS_LIST / S1
 * 2. ID: "Apa saja program studi S1 yang tersedia?" -> ACADEMIC_PROGRAM / AVAILABLE_PROGRAMS_LIST / S1
 * 3. EN: Master/Postgraduate queries -> ACADEMIC_PROGRAM / AVAILABLE_PROGRAMS_LIST / S2
 * 4. EN: Diploma/Associate degree queries -> ACADEMIC_PROGRAM / AVAILABLE_PROGRAMS_LIST / D3
 * 5. General academic queries without explicit "STIKOM" mention -> ACADEMIC_PROGRAM / AVAILABLE_PROGRAMS_LIST (not OUT_OF_DOMAIN)
 * 6. Off-topic/Out-of-domain queries -> OUT_OF_DOMAIN / OUT_OF_DOMAIN_INQUIRY
 * 7. Async resolver contract with AI parser integration
 */

const { resolveSemanticFrame, resolveSemanticFrameAsync } = require('../src/core/semanticFrameResolver');

function createMockOpenAIClient(contentOrObj) {
  return {
    chat: {
      completions: {
        create: async () => ({
          choices: [
            {
              message: {
                content: typeof contentOrObj === 'string' ? contentOrObj : JSON.stringify(contentOrObj)
              }
            }
          ]
        })
      }
    }
  };
}

describe('English Academic Scope & Program Listing Regression Suite', () => {

  describe('1. Undergraduate Listing Queries (EN & ID)', () => {
    test('EN: "What are the undergraduate study programs available?" is recognized as ACADEMIC_PROGRAM and S1 scope', () => {
      const frame = resolveSemanticFrame('What are the undergraduate study programs available?');
      expect(frame.domain).toBe('ACADEMIC_PROGRAM');
      expect(frame.intent).toBe('AVAILABLE_PROGRAMS_LIST');
      expect(frame.academicLevel).toBe('S1');
      expect(frame.entities.some(e => e.canonical === 'Program Sarjana (S1)')).toBe(true);
      expect(frame.relation).toBe('AVAILABLE_PROGRAMS_S1');
      expect(frame.retrievalRequired).toBe(true);
      expect(frame.domain).not.toBe('OUT_OF_DOMAIN');
      expect(frame.language).toBe('en');
    });

    test('EN: variations of undergraduate program inquiries', () => {
      const variations = [
        'What undergraduate programs are available?',
        'Which undergraduate study programs are offered?',
        'What are the undergraduate majors available?'
      ];

      for (const query of variations) {
        const frame = resolveSemanticFrame(query);
        expect(frame.domain).toBe('ACADEMIC_PROGRAM');
        expect(frame.intent).toBe('AVAILABLE_PROGRAMS_LIST');
        expect(frame.academicLevel).toBe('S1');
        expect(frame.entities.some(e => e.canonical === 'Program Sarjana (S1)')).toBe(true);
      }
    });

    test('ID: "Apa saja program studi S1 yang tersedia?" is recognized as ACADEMIC_PROGRAM and S1 scope', () => {
      const frame = resolveSemanticFrame('Apa saja program studi S1 yang tersedia?');
      expect(frame.domain).toBe('ACADEMIC_PROGRAM');
      expect(frame.intent).toBe('AVAILABLE_PROGRAMS_LIST');
      expect(frame.academicLevel).toBe('S1');
      expect(frame.entities.some(e => e.canonical === 'Program Sarjana (S1)')).toBe(true);
      expect(frame.relation).toBe('AVAILABLE_PROGRAMS_S1');
      expect(frame.retrievalRequired).toBe(true);
      expect(frame.language).toBe('id');
    });
  });

  describe('2. Postgraduate / Master Degree Queries (EN)', () => {
    test('EN: "What master degree programs are offered?" is recognized as ACADEMIC_PROGRAM and S2 scope', () => {
      const frame = resolveSemanticFrame('What master degree programs are offered?');
      expect(frame.domain).toBe('ACADEMIC_PROGRAM');
      expect(frame.intent).toBe('AVAILABLE_PROGRAMS_LIST');
      expect(frame.academicLevel).toBe('S2');
      expect(frame.entities.some(e => e.canonical === 'Program Pascasarjana (S2)')).toBe(true);
      expect(frame.relation).toBe('AVAILABLE_PROGRAMS_S2');
      expect(frame.retrievalRequired).toBe(true);
    });

    test('EN: "What are the postgraduate study programs available?" is recognized as ACADEMIC_PROGRAM and S2 scope', () => {
      const frame = resolveSemanticFrame('What are the postgraduate study programs available?');
      expect(frame.domain).toBe('ACADEMIC_PROGRAM');
      expect(frame.intent).toBe('AVAILABLE_PROGRAMS_LIST');
      expect(frame.academicLevel).toBe('S2');
      expect(frame.entities.some(e => e.canonical === 'Program Pascasarjana (S2)')).toBe(true);
    });
  });

  describe('3. Diploma / Associate Degree Queries (EN)', () => {
    test('EN: "What diploma study programs are available?" is recognized as ACADEMIC_PROGRAM and D3 scope', () => {
      const frame = resolveSemanticFrame('What diploma study programs are available?');
      expect(frame.domain).toBe('ACADEMIC_PROGRAM');
      expect(frame.intent).toBe('AVAILABLE_PROGRAMS_LIST');
      expect(frame.academicLevel).toBe('D3');
      expect(frame.entities.some(e => e.canonical === 'Program Diploma (D3)')).toBe(true);
      expect(frame.relation).toBe('AVAILABLE_PROGRAMS_D3');
      expect(frame.retrievalRequired).toBe(true);
    });

    test('EN: "What associate degree programs are offered?" is recognized as ACADEMIC_PROGRAM and D3 scope', () => {
      const frame = resolveSemanticFrame('What associate degree programs are offered?');
      expect(frame.domain).toBe('ACADEMIC_PROGRAM');
      expect(frame.intent).toBe('AVAILABLE_PROGRAMS_LIST');
      expect(frame.academicLevel).toBe('D3');
      expect(frame.entities.some(e => e.canonical === 'Program Diploma (D3)')).toBe(true);
    });
  });

  describe('4. Generic Academic Queries without explicit "STIKOM" mention', () => {
    test('EN: "What study programs are available?" is recognized as ACADEMIC_PROGRAM / AVAILABLE_PROGRAMS_LIST', () => {
      const frame = resolveSemanticFrame('What study programs are available?');
      expect(frame.domain).toBe('ACADEMIC_PROGRAM');
      expect(frame.intent).toBe('AVAILABLE_PROGRAMS_LIST');
      expect(frame.relation).toBe('AVAILABLE_PROGRAMS_ALL');
      expect(frame.retrievalRequired).toBe(true);
      expect(frame.domain).not.toBe('OUT_OF_DOMAIN');
    });

    test('EN: "Which majors are offered?" is recognized as ACADEMIC_PROGRAM / AVAILABLE_PROGRAMS_LIST', () => {
      const frame = resolveSemanticFrame('Which majors are offered?');
      expect(frame.domain).toBe('ACADEMIC_PROGRAM');
      expect(frame.intent).toBe('AVAILABLE_PROGRAMS_LIST');
      expect(frame.retrievalRequired).toBe(true);
      expect(frame.domain).not.toBe('OUT_OF_DOMAIN');
    });
  });

  describe('5. Out-of-Domain Guard Protection', () => {
    const oodQueries = [
      'How to cook fried rice?',
      'Siapa presiden Amerika Serikat?',
      'What is the weather forecast today?',
      'Can you write python code to reverse a string?',
      'Berapa harga tiket bioskop XXI?'
    ];

    test.each(oodQueries)('Query "%s" must be classified as OUT_OF_DOMAIN', (query) => {
      const frame = resolveSemanticFrame(query);
      expect(frame.domain).toBe('OUT_OF_DOMAIN');
      expect(frame.intent).toBe('OUT_OF_DOMAIN_INQUIRY');
      expect(frame.retrievalRequired).toBe(false);
    });
  });

  describe('6. Async Semantic Frame Resolution & AI Grounding Protection', () => {
    test('Valid academic model concept prevents false negative override', async () => {
      const mockClient = createMockOpenAIClient({
        speechAct: 'DISCOVER_LIST',
        semanticConcepts: ['ACADEMIC_OFFERING'],
        requestedAspects: ['general_info'],
        candidateEntities: ['Program Sarjana (S1)'],
        scopeConstraints: { academicLevel: 'S1' },
        contextDependency: { isFollowUp: false },
        confidence: 0.95
      });

      const frame = await resolveSemanticFrameAsync(
        'What are the undergraduate study programs available?',
        {},
        { openaiClient: mockClient }
      );

      expect(frame.domain).toBe('ACADEMIC_PROGRAM');
      expect(frame.intent).toBe('AVAILABLE_PROGRAMS_LIST');
      expect(frame.domain).not.toBe('OUT_OF_DOMAIN');
    }, 15000);

    test('Genuine out-of-domain query is correctly flagged by async resolver', async () => {
      const mockClient = createMockOpenAIClient({
        speechAct: 'OFF_TOPIC',
        semanticConcepts: [],
        requestedAspects: [],
        candidateEntities: [],
        scopeConstraints: {},
        contextDependency: { isFollowUp: false },
        confidence: 0.99
      });

      const frame = await resolveSemanticFrameAsync(
        'How to cook fried rice?',
        {},
        { openaiClient: mockClient }
      );

      expect(frame.domain).toBe('OUT_OF_DOMAIN');
      expect(frame.intent).toBe('OUT_OF_DOMAIN_INQUIRY');
    }, 15000);
  });
});
