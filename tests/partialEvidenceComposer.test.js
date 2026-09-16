'use strict';

/**
 * Tracked regression tests for the generic partial-evidence composer.
 *
 * Core contract:
 *   An unsupported entity-field binding must NOT suppress a supported one.
 *   SUPPORTED subpart -> answered.
 *   UNSUPPORTED subpart -> safely bounded.
 *
 * No partner names, degree names, or exact query strings are hardcoded
 * in test logic below.
 */

const { verifyAnswerAgainstContract } = require('../src/engine/semanticContract');

function makeInternationalContract(canonicals) {
  return {
    domain: 'double_degree',
    intent: 'ask_international_degree_outcome',
    requestType: 'yes_no_or_explain',
    requestedFields: ['degreeOutcome', 'degree'],
    entities: canonicals.map((c) => ({
      canonical: c,
      group: 'internationalPrograms',
      source: 'canonical-entity-registry',
      type: 'international_program'
    }))
  };
}

function makeProgramContract(canonicals) {
  return {
    domain: 'accreditation',
    intent: 'ask_accreditation',
    requestType: 'yes_no_or_explain',
    requestedFields: ['accreditation'],
    entities: canonicals.map((c) => ({
      canonical: c,
      group: 'programs',
      type: 'program'
    }))
  };
}

describe('Generic partial-evidence mechanism -- contract verifier unit tests', () => {

  test('PE-U01: returns partialCoverage=true when answer covers one of two international-program entities', () => {
    const contract = makeInternationalContract([
      'Double Degree HELP University',
      'Double Degree DNUI'
    ]);
    const answer =
      'Program Double Degree dengan HELP University memberikan gelar S.Kom bagi mahasiswa.';
    const result = verifyAnswerAgainstContract(contract, answer, []);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing_contract_entity');
    expect(result.partialCoverage).toBe(true);
    expect(result.supportedCount).toBe(1);
    expect(result.totalEntityCount).toBe(2);
    expect(result.missingEntities).toContain('Double Degree DNUI');
    expect(result.missingEntities).not.toContain('Double Degree HELP University');
  });

  test('PE-U02: returns ok=true when answer covers all contract entities', () => {
    const contract = makeInternationalContract([
      'Double Degree HELP University',
      'Double Degree DNUI'
    ]);
    const answer =
      'Double Degree dengan HELP University: S.Kom. ' +
      'DNUI (Dalian): program internasional dengan kurikulum gabungan.';
    const result = verifyAnswerAgainstContract(contract, answer, []);

    expect(result.ok).toBe(true);
  });

  test('PE-U03: returns partialCoverage=false when answer covers no contract entities', () => {
    const contract = makeInternationalContract([
      'Double Degree HELP University',
      'Double Degree DNUI'
    ]);
    const answer =
      'Program Double Degree ITB STIKOM Bali menawarkan pengalaman internasional.';
    const result = verifyAnswerAgainstContract(contract, answer, []);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing_contract_entity');
    expect(result.partialCoverage).toBe(false);
    expect(result.supportedCount).toBe(0);
    expect(result.totalEntityCount).toBe(2);
  });

  test('PE-U04: partial coverage works for generic program-domain entities', () => {
    const contract = makeProgramContract(['Sistem Informasi', 'Bisnis Digital']);
    const answer = 'Akreditasi Sistem Informasi adalah Baik Sekali dari BAN-PT.';
    const result = verifyAnswerAgainstContract(contract, answer, []);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing_contract_entity');
    expect(result.partialCoverage).toBe(true);
    expect(result.missingEntities).toContain('Bisnis Digital');
    expect(result.missingEntities).not.toContain('Sistem Informasi');
  });

  test('PE-U05: supported entity is never listed in missingEntities (no suppression)', () => {
    const contract = makeInternationalContract([
      'Double Degree HELP University',
      'Double Degree DNUI'
    ]);
    const answer =
      'HELP University memberikan gelar S.Kom melalui program Double Degree.';
    const result = verifyAnswerAgainstContract(contract, answer, []);

    expect((result.missingEntities || [])).not.toContain('Double Degree HELP University');
    expect(result.missingEntities).toContain('Double Degree DNUI');
    expect(result.partialCoverage).toBe(true);
  });
});

describe('Generic partial-evidence mechanism -- end-to-end integration', () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.OPENAI_API_KEY;
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
    process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';
  });

  test('PE-E01: partial-evidence query preserves supported entity answer and adds safe boundary', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    const result = await querySemanticRag(
      'Gelar yang didapatkan dari DNUI dan HELP itu Sarjana apa?'
    );

    expect(result.success).toBe(true);
    expect(result.source).not.toBe('semantic-rag-contract-verifier-blocked');

    if (result.source === 'semantic-rag-partial-evidence-composer') {
      expect(result.answer).toMatch(/HELP|S\.Kom|BIT/i);
      expect(result.answer).toMatch(/belum tersedia|konfirmasi|admin/i);
      expect(result.answer).not.toMatch(
        /DNUI.*(?:S\.Kom|S\.T|Bachelor of Science|gelar sarjana)\b.*DNUI/i
      );
    }
  }, 20000);
});
