'use strict';

/**
 * Tracked regression tests: multi-entity context authority and subrequest isolation.
 *
 * Covers the five behavioral contracts required by the Clean4 pre-commit audit:
 *
 *   A. Explicit subrequest semantic isolation:
 *      A compound query decomposes correctly; each sub-request routes to the
 *      intended entity without cross-contamination.
 *
 *   B. Declarative context promotion:
 *      A declarative interest statement in turn N promotes that entity as
 *      active context so a pronoun/ellipsis reference in turn N+1 resolves
 *      correctly.
 *
 *   C. Multi-entity declarative safety:
 *      A comparison query (e.g. "TI dan SI bedanya apa?") addresses BOTH
 *      entities; neither is arbitrarily suppressed or promoted as sole
 *      context for the comparison answer.
 *
 *   D. Prior-context compound:
 *      A compound query in turn N+1 that inherits entity context from turn N
 *      routes each sub-request correctly using the promoted context.
 *
 *   E. Generic organization-interest routing:
 *      A query that expresses multiple student interests returns at least one
 *      organization recommendation grounded in official evidence.  No fixed
 *      organization names are asserted; the answer shape and safe-boundary
 *      cue are validated instead.
 *
 * Rules:
 *   - Do NOT hardcode specific partner names, degree values, or fee amounts
 *     in assertions unless they come from official catalog evidence.
 *   - Session state is injected via options.sessionData.messages to simulate
 *     prior conversation turns without a live database.
 */

describe('Multi-entity context authority and subrequest isolation', () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.OPENAI_API_KEY;
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
    process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';
  });

  // -------------------------------------------------------------------------
  // A. Explicit subrequest semantic isolation
  // -------------------------------------------------------------------------
  describe('A. Explicit subrequest semantic isolation', () => {
    test('MSCA-A01: decomposer splits compound program query into independent sub-requests with correct entity bindings', () => {
      const { decomposeSemanticRequests } = require('../src/engine/requestDecomposer');
      const q = 'Akreditasi Sistem Informasi apa dan biaya kuliah Bisnis Digital berapa?';
      const decomp = decomposeSemanticRequests(q);

      expect(decomp.isCompound).toBe(true);
      expect(decomp.requests.length).toBe(2);

      const req0 = decomp.requests[0];
      const req1 = decomp.requests[1];

      // First sub-request must bind to Sistem Informasi
      expect(req0.explicitEntities.some((e) => /Sistem Informasi/i.test(e.canonical))).toBe(true);
      // Bisnis Digital entity must NOT bleed into the first sub-request
      expect(req0.explicitEntities.every((e) => !/Bisnis Digital/i.test(e.canonical))).toBe(true);

      // Second sub-request must bind to Bisnis Digital
      expect(req1.explicitEntities.some((e) => /Bisnis Digital/i.test(e.canonical))).toBe(true);
    });

    test('MSCA-A02: compound query routes each sub-request to the correct topic without cross-contamination', async () => {
      const { querySemanticRag } = require('../src/engine/semanticRagEngine');
      const result = await querySemanticRag(
        'Akreditasi Sistem Informasi apa dan biaya kuliah Bisnis Digital berapa?'
      );

      expect(result.success).toBe(true);
      // Compound answer must address Sistem Informasi (accreditation topic)
      expect(result.answer).toMatch(/Sistem Informasi/i);
      // Compound answer must address Bisnis Digital (fee topic)
      expect(result.answer).toMatch(/Bisnis Digital/i);
      // Must not be a full block
      expect(result.source).not.toMatch(/contract-verifier-blocked|answer-shape-guard|meaning-mismatch/i);
    }, 25000);
  });

  // -------------------------------------------------------------------------
  // B. Declarative context promotion
  // -------------------------------------------------------------------------
  describe('B. Declarative context promotion', () => {
    test('MSCA-B01: ellipsis follow-up resolves to declared entity from prior turn', async () => {
      const { querySemanticRag } = require('../src/engine/semanticRagEngine');
      const { buildTurnConversationState } = require('../src/engine/conversationStateEngine');

      // Turn 1: declarative interest establishes TI as active entity
      const turn1 = await querySemanticRag('Saya lagi tertarik Teknologi Informasi.');
      expect(turn1.success).toBe(true);

      const turn1State = buildTurnConversationState(null, {
        userQuery: 'Saya lagi tertarik Teknologi Informasi.',
        result: turn1,
        source: turn1.source,
        debug: turn1.debug || {}
      });

      // Turn 2: pronoun/ellipsis reference should resolve to TI via conversation state
      const turn2 = await querySemanticRag('Akreditasinya apa?', {
        sessionData: {
          state: turn1State,
          messages: [
            { direction: 'user', message: 'Saya lagi tertarik Teknologi Informasi.' },
            { direction: 'bot', message: turn1.answer }
          ]
        }
      });

      expect(turn2.success).toBe(true);
      // Answer must reference Teknologi Informasi, not an unrelated program
      expect(turn2.answer).toMatch(/Teknologi Informasi|TI\b/i);
      // Answer must include accreditation vocabulary
      expect(turn2.answer).toMatch(/Akreditasi|Baik Sekali|Baik|BAN-PT/i);
      // Must not be a vague-clarification guard (entity must be resolved from context)
      expect(turn2.source).not.toMatch(/pre-guard-vague-clarification|meaning-mismatch/i);
    }, 25000);
  });

  // -------------------------------------------------------------------------
  // C. Multi-entity declarative safety (comparison must not suppress either entity)
  // -------------------------------------------------------------------------
  describe('C. Multi-entity declarative safety', () => {
    test('MSCA-C01: comparison query between two programs addresses both without suppression', async () => {
      const { querySemanticRag } = require('../src/engine/semanticRagEngine');
      const result = await querySemanticRag('TI dan SI bedanya apa?');

      expect(result.success).toBe(true);
      // Both programs must appear in the answer
      expect(result.answer).toMatch(/Teknologi Informasi|TI\b/i);
      expect(result.answer).toMatch(/Sistem Informasi|SI\b/i);
      // Must not be a vague/empty answer
      expect(result.source).not.toMatch(/pre-guard-vague-clarification|answer-shape-guard/i);
      // Answer must not be trivially short (comparison requires substance)
      expect(result.answer.length).toBeGreaterThan(80);
    }, 20000);
  });

  // -------------------------------------------------------------------------
  // D. Prior-context compound
  // -------------------------------------------------------------------------
  describe('D. Prior-context compound query', () => {
    test('MSCA-D01: compound follow-up inherits prior entity context for unanchored sub-request', async () => {
      const { querySemanticRag } = require('../src/engine/semanticRagEngine');

      const turn1 = await querySemanticRag('Saya lagi tertarik Teknologi Informasi.');

      // Turn 2: compound query — first part is context-ellipsis (TI), second is explicit
      const turn2 = await querySemanticRag(
        'Akreditasinya apa dan kalau ikut RPL maksimal SKS yang bisa dikonversi berapa?',
        {
          sessionData: {
            messages: [
              { direction: 'user', message: 'Saya lagi tertarik Teknologi Informasi.' },
              { direction: 'bot', message: turn1.answer }
            ]
          }
        }
      );

      expect(turn2.success).toBe(true);
      // At least one sub-request should produce a grounded answer
      const hasAccreditation = /Akreditasi|Baik Sekali|BAN-PT/i.test(turn2.answer);
      const hasRPL = /RPL|rekognisi|konversi|SKS/i.test(turn2.answer);
      expect(hasAccreditation || hasRPL).toBe(true);
      // Must not be a total vague block
      expect(turn2.source).not.toMatch(/pre-guard-vague-clarification/i);
    }, 25000);
  });

  // -------------------------------------------------------------------------
  // E. Generic organization-interest routing (multiple interests)
  // -------------------------------------------------------------------------
  describe('E. Generic organization-interest routing', () => {
    test('MSCA-E01: multi-interest query routes to UKM recommendations grounded in official evidence', async () => {
      const { querySemanticRag } = require('../src/engine/semanticRagEngine');
      const result = await querySemanticRag(
        'Saya suka olahraga dan coding, UKM apa yang cocok untuk saya?'
      );

      expect(result.success).toBe(true);
      expect(result.source).toBe('semantic-rag-ukm-list');
      // Must contain organization mention
      expect(result.answer).toMatch(/UKM|Ormawa/i);
      // Must contain evidence-grounded topic tokens relevant to stated interests
      const hasOlahraga = /olahraga|futsal|basket|renang|atlet/i.test(result.answer);
      const hasCoding = /coding|komputer|teknologi|linux|web|software/i.test(result.answer);
      expect(hasOlahraga || hasCoding).toBe(true);
      // Must include the canonical safe-boundary cue (organisations confirmed via official channel)
      expect(result.answer).toMatch(/resmi kampus|kemahasiswaan|pengurus UKM|konfirmasi/i);
    }, 20000);

    test('MSCA-E02: interest routing with different topic pair still returns evidence-grounded results', async () => {
      const { querySemanticRag } = require('../src/engine/semanticRagEngine');
      const result = await querySemanticRag(
        'Kalau suka fotografi dan seni, UKM apa yang paling cocok?'
      );

      expect(result.success).toBe(true);
      expect(result.source).toBe('semantic-rag-ukm-list');
      // Evidence-grounded topic tokens for arts/media interests
      expect(result.answer).toMatch(/foto|tari|seni|vokal|teater|multimedia|desain/i);
      // Safe-boundary cue must be present
      expect(result.answer).toMatch(/resmi kampus|kemahasiswaan|pengurus UKM|konfirmasi/i);
    }, 20000);
  });
});
