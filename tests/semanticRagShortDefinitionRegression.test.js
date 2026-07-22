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
});
