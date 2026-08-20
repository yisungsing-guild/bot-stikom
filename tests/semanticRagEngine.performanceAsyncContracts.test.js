const { querySemanticRag, clearSemanticCaches } = require('../src/engine/semanticRagEngine');

jest.setTimeout(90000);

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  process.env.SEMANTIC_RAG_TODAY_YMD = '2026-08-19';
  process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
  process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';
  if (typeof clearSemanticCaches === 'function') clearSemanticCaches();
});

describe('performance and async root-cause contracts', () => {
  test.each([
    'Selamat malam saya ingin menanyakan terkait penerimaan mahasiswa baru apakah masih dibuka?',
    'apakah penerimaan mahasiswa baru masih dibuka?',
    'status pendaftaran mahasiswa baru sekarang masih buka?',
    'PMB sekarang aktif gelombang apa?',
  ])('PMB availability/schedule uses canonical deterministic preguard within budget: %s', async (query) => {
    const started = Date.now();
    const result = await querySemanticRag(query, {
      topK: 8,
      mode: 'performance-async-contract',
      chatId: `performance-async:${query}`,
      sessionData: {},
    });
    const durationMs = Date.now() - started;

    expect(result.source).toBe('semantic-rag-schedule-window');
    expect(result.debug && result.debug.routeStage).toBe('pre-guard-canonical-pmb-schedule');
    expect(result.answer).toMatch(/PMB|pendaftaran|Gelombang|19 Agustus 2026/i);
    expect(durationMs).toBeLessThan(15000);
  });

  test('academic schedule questions are not hijacked by canonical PMB schedule fast lane', async () => {
    const result = await querySemanticRag('jadwal remedial kapan ya?', { topK: 5 });

    expect(result.source).toBe('semantic-rag-academic-schedule');
    expect(result.debug && result.debug.routeStage).toBe('pre-guard-academic-schedule');
    expect(result.answer).toMatch(/jadwal resmi remedial|akademik|BAAK/i);
  });

  test('registration procedure keeps its registration route instead of PMB schedule fast lane', async () => {
    const result = await querySemanticRag('cara daftar PMB bagaimana?', { topK: 5 });

    expect(result.source).toBe('semantic-rag-registration-info');
    expect(result.debug && result.debug.routeStage).toBe('pre-guard-registration-how');
    expect(result.answer).toMatch(/online|kampus|siap\.stikom-bali\.ac\.id/i);
  });
});
