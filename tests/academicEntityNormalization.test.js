const { normalizeInput } = require('../src/lib/normalizer');
const { queryScoped } = require('../src/engine/ragScoped');

jest.setTimeout(20000);

describe('academic entity normalization', () => {
  test('maps program studi informasi aliases to Sistem Informasi', () => {
    const normalized = normalizeInput('kalau program studi informasi itu nanti belajarnya apa saja, dan nanti bisa bekerja di bidang apa saja?');
    expect(normalized.normalized).toContain('sistem informasi');
  });

  test('keeps mixed curriculum/career alias query inside academic retrieval', async () => {
    const res = await queryScoped({
      query: 'kalau program studi informasi itu nanti belajarnya apa saja, dan nanti bisa bekerja di bidang apa saja?',
      category: 'curriculum',
      topK: 6,
      filters: {},
      options: { strict: false }
    });

    expect(res && res.success).toBe(true);
    expect(String(res.answer || '')).toMatch(/Sistem Informasi/i);
    expect(String(res.answer || '')).toMatch(/belajar|mempelajari|prospek kerja|kerja/i);
    expect(String(res.source || '')).not.toBe('rag-lexical-fallback');
    if (res.retrievalUsed === false || /ultra-fast|shortcut|program-career-role/i.test(String(res.source || ''))) {
      expect(Array.isArray(res.contexts) ? res.contexts.length : 0).toBe(0);
    } else {
      expect(Array.isArray(res.contexts) ? res.contexts.length : 0).toBeGreaterThan(0);
    }
  });

  test('normalizes noisy WhatsApp shorthand before semantic routing', () => {
    const normalized = normalizeInput('skrg masih bka?');
    expect(normalized.normalized).toContain('sekarang');
    expect(normalized.normalized).toContain('masih buka');
  });
});