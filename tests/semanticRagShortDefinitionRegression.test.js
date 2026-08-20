describe('semanticRag short definition regression', () => {
  test('answers short program definition questions directly before falling back to insufficient-data', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    const result = await querySemanticRag('apa itu si?', { topK: 3 });

    expect(result.success).toBe(true);
    expect(result.answer).toMatch(/Sistem Informasi/i);
    expect(result.answer).not.toMatch(/^Mohon maaf, saya kemungkinan tidak mempunyai jawaban yang mencukupi/i);
    expect(result.source).not.toBe('semantic-rag-no-context');
    expect(result.source).not.toBe('semantic-rag-evidence-not-answerable');
  });

  test('does not let an earlier fallback response block a later deterministic definition answer for the same question', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    const firstResult = await querySemanticRag('apa itu si?', { topK: 3 });
    const secondResult = await querySemanticRag('apa itu si?', { topK: 3 });

    expect(firstResult.success).toBe(true);
    expect(secondResult.success).toBe(true);
    expect(secondResult.answer).toMatch(/Sistem Informasi/i);
    expect(secondResult.answer).not.toMatch(/^Mohon maaf, saya kemungkinan tidak mempunyai jawaban yang mencukupi/i);
    expect(secondResult.source).not.toBe('semantic-rag-evidence-not-answerable');
  });
  test('generalizes short canonical program definition aliases without matching unrelated terms', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    const variants = [
      { q: 'pengertian TI?', must: /Teknologi Informasi/i },
      { q: 'halo apa itu BD?', must: /Bisnis Digital/i },
      { q: 'jelasin SK itu apa', must: /Sistem Komputer/i }
    ];

    for (const item of variants) {
      const result = await querySemanticRag(item.q, { topK: 3 });
      expect(result.success).toBe(true);
      expect(result.source).toMatch(/program-definition/i);
      expect(result.answer).toMatch(item.must);
    }

    const negative = await querySemanticRag('apa itu SIM card?', { topK: 3 });
    expect(negative.success).toBe(true);
    expect(negative.source).not.toMatch(/program-definition/i);
    expect(String(negative.answer || '')).not.toMatch(/Sistem Informasi/i);
  });
});
