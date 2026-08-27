process.env.NODE_ENV = 'test';
process.env.FORCE_BUNDLED_INDEX = 'true';
process.env.ENABLE_RAG = 'true';
process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';
delete process.env.OPENAI_API_KEY;

const { querySemanticRag } = require('../src/engine/semanticRagEngine');
const { buildSemanticSmokeTrace } = require('../src/utils/semanticSmokeTrace');
const fs = require('fs');
const path = require('path');

function stableSemanticResult(result) {
  return {
    source: result && result.source,
    answer: result && result.answer,
    confidenceScore: result && result.confidenceScore,
    confidenceTier: result && result.confidenceTier,
    contexts: Array.isArray(result && result.contexts)
      ? result.contexts.map((ctx) => ({
          source: ctx.source || ctx.filename || ctx.file || ctx.sourceFile || null,
          text: String(ctx.text || ctx.chunk || '').slice(0, 240)
        }))
      : [],
    verifier: result && result.debug ? result.debug.contractVerification || null : null,
    semanticContract: result && result.debug ? result.debug.semanticContract || result.debug.canonicalContract || null : null
  };
}

describe('semantic smoke trace observability', () => {
  jest.setTimeout(180000);

  test('internal semantic smoke endpoint remains protected diagnostic-only trace exposure', () => {
    const indexSource = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');

    expect(indexSource).toMatch(/app\.post\('\/internal\/semantic-smoke'/);
    expect(indexSource).toMatch(/SEMANTIC_SMOKE_TOKEN/);
    expect(indexSource).toMatch(/return res\.status\(404\)\.send\(\{ error: 'not_found' \}\)/);
    expect(indexSource).toMatch(/diagnosticOnly:\s*true/);
    expect(indexSource).toMatch(/outboundProviderBypassed:\s*true/);
    expect(indexSource).toMatch(/trace:\s*buildSemanticSmokeTrace\(\{ query, result \}\)/);
  });

  test('diagnostic trace adds metadata without changing semantic result', async () => {
    const cases = [
      'saya ingin bertanya tentang pmb',
      'jurusan Arsitektur di STIKOM biayanya berapa?',
      'apakah ada program double degree internasional?',
      'Kalau S1 yang cocok untuk bekerja di bidang pemasaran yang mana ya?'
    ];

    for (const query of cases) {
      const diagnosticOff = await querySemanticRag(query, { topK: 8, mode: 'diagnostic_off_parity' });
      const before = stableSemanticResult(diagnosticOff);
      const trace = buildSemanticSmokeTrace({ query, result: diagnosticOff });
      const after = stableSemanticResult(diagnosticOff);

      expect(after).toEqual(before);
      expect(trace).toEqual(expect.objectContaining({
        input: expect.objectContaining({ raw: query }),
        canonicalContract: expect.any(Object),
        effectiveContext: expect.any(Object),
        routeDecision: expect.objectContaining({ source: diagnosticOff.source }),
        retrieval: expect.any(Object),
        selectedEvidence: expect.any(Array),
        composer: expect.objectContaining({ draftSource: diagnosticOff.source }),
        verifierResult: expect.any(Object),
        finalAnswer: expect.any(String)
      }));
      expect(trace.finalAnswer).toBe(String(diagnosticOff.answer || '').replace(/\s+/g, ' ').trim().slice(0, 4000));
      expect(trace.routeDecision.canonicalDomain).toBe(trace.canonicalContract.domain);
      expect(trace.routeDecision.canonicalIntent).toBe(trace.canonicalContract.intent);
    }
  });

  test('trace is redacted and does not expose embeddings, secrets, or full private documents', async () => {
    const result = await querySemanticRag('apa itu Sistem Informasi?', { topK: 8, mode: 'diagnostic_redaction_check' });
    const trace = buildSemanticSmokeTrace({ query: 'apa itu Sistem Informasi?', result });
    const serialized = JSON.stringify(trace);

    expect(serialized).not.toMatch(/OPENAI_API_KEY|WHATSAPP_API_KEY|DATABASE_URL|PROVIDER_WEBHOOK_TOKEN|SEMANTIC_SMOKE_TOKEN/i);
    expect(serialized).not.toMatch(/sk-proj-|postgresql:\/\/|Bearer\s+/i);
    expect(serialized).not.toMatch(/"values"\s*:\s*\[/i);
    expect(serialized.length).toBeLessThan(15000);

    for (const evidence of trace.selectedEvidence) {
      expect(String(evidence.snippet || '').length).toBeLessThanOrEqual(240);
    }
  });

  test('unsupported entity trace preserves canonical candidate and no-substitution route', async () => {
    const query = 'akreditasi jurusan Psikologi di STIKOM apa?';
    const result = await querySemanticRag(query, { topK: 8, mode: 'diagnostic_unsupported_entity' });
    const trace = buildSemanticSmokeTrace({ query, result });

    expect(trace.canonicalContract.constraints.unsupportedEntityCandidate).toEqual(expect.objectContaining({
      canonical: 'Psikologi',
      role: 'unsupported_entity_candidate'
    }));
    expect(trace.routeDecision.source).toBe('semantic-rag-out-of-domain');
    expect(trace.finalAnswer).toMatch(/Psikologi/i);
    expect(trace.finalAnswer).not.toMatch(/Sistem Informasi.*akreditasi|Teknologi Informasi.*akreditasi|Bisnis Digital.*akreditasi/i);
    expect(trace.verifierResult).toEqual(expect.objectContaining({ ok: true }));
  });
});

