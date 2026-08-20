const { querySemanticRag } = require('../src/engine/semanticRagEngine');
const { evaluateOutboundAnswer } = require('../src/utils/answerPreflightEvaluator');

jest.setTimeout(90000);

beforeAll(() => {
  delete process.env.OPENAI_API_KEY;
  process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
  process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';
  process.env.SEMANTIC_RAG_TODAY_YMD = '2026-08-19';
});

describe('P0 temporal reference-date contract', () => {
  test('explicit date is the schedule reference date, not current date', async () => {
    const result = await querySemanticRag('gelombang 1 masih buka tanggal 7 juli 2026?');
    expect(result.source).toBe('semantic-rag-schedule-window');
    expect(result.answer).toMatch(/7 Juli 2026/i);
    expect(result.answer).not.toMatch(/Per 19 Agustus 2026/i);
  });

  test('unseen explicit point-in-time queries keep their own date', async () => {
    const july = await querySemanticRag('kalau tanggal 5 juli gelombang apa yang aktif?');
    expect(july.answer).toMatch(/5 Juli 2026/i);
    expect(july.answer).not.toMatch(/Per 19 Agustus 2026/i);

    const august = await querySemanticRag('per 20 agustus pendaftaran masih buka?');
    expect(august.answer).toMatch(/20 Agustus 2026/i);
    expect(august.answer).not.toMatch(/Per 19 Agustus 2026/i);
  });

  test('current-date controls still use today when no explicit date is given', async () => {
    const result = await querySemanticRag('PMB masih buka?');
    expect(result.source).toBe('semantic-rag-schedule-window');
    expect(result.answer).toMatch(/19 Agustus 2026/i);
  });
});

describe('P0 semantic location routing contract', () => {
  test.each([
    'berapa tinggi gedung kampus?',
    'gedung kampus ada berapa lantai?',
    'berapa luas kampus?',
  ])('physical campus attribute does not route to campus location: %s', async (query) => {
    const result = await querySemanticRag(query);
    expect(result.source).not.toBe('semantic-rag-campus-location');
    expect(result.answer).not.toMatch(/Jl\.\s*Raya|Renon Campus|Kampus Jimbaran|Kampus Abiansemal/i);
  });

  test.each([
    'alamat kampus Renon apa?',
    'kampus Jimbaran letaknya di mana?',
  ])('true location intent still routes to campus location: %s', async (query) => {
    const result = await querySemanticRag(query);
    expect(result.source).toBe('semantic-rag-campus-location');
    expect(result.answer).toMatch(/Renon|Jimbaran|Jl\./i);
  });
});

describe('P0 evidence quality and preflight contract', () => {
  test('uploaded training composer does not leak concatenated raw fragments', async () => {
    const result = await querySemanticRag('layanan karier ada?');
    expect(result.answer).not.toMatch(/didedikasikan\s*-\s*Selain/i);
    expect(result.answer).not.toMatch(/^-\s+Career Center[\s\S]*\s-\s+Selain/i);
  });

  test('preflight compress action changes raw output or falls back safely', () => {
    const raw = '- Career Center ITB STIKOM Bali merupakan pusat layanan karier yang didedikasikan - Selain memperoleh pembelajaran berbasis teknologi dan kewirausahaan, mahasiswa juga mendapatkan akses terhadap pelatihan.';
    const result = evaluateOutboundAnswer(raw, 'layanan karier ada?', {
      source: 'semantic-rag-campus-support-entity',
      confidenceScore: 1,
    });
    expect(result.action === 'compress' || result.action === 'fallback' || result.issues.includes('compressed_output')).toBe(true);
    expect(result.answer).not.toBe(raw);
    expect(result.answer).not.toMatch(/didedikasikan\s*-\s*Selain/i);
  });
});
