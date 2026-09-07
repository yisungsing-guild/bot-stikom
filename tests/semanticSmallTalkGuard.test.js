const { querySemanticRag } = require('../src/engine/semanticRagEngine');
const prisma = require('../src/db');

describe('semantic small-talk guard', () => {
  const oldApiKey = process.env.OPENAI_API_KEY;
  const oldCache = process.env.SEMANTIC_RAG_RESULT_CACHE_MS;

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
  });

  afterEach(() => {
    if (typeof oldApiKey === 'undefined') delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldApiKey;
    if (typeof oldCache === 'undefined') delete process.env.SEMANTIC_RAG_RESULT_CACHE_MS;
    else process.env.SEMANTIC_RAG_RESULT_CACHE_MS = oldCache;
  });

  test('answers permission-to-ask prompts without blank semantic output', async () => {
    for (const query of ['boleh tanya?', 'mau tanya kak', 'izin tanya admin']) {
      const result = await querySemanticRag(query);
      expect(result.success).toBe(true);
      expect(result.source).toBe('semantic-rag-small-talk');
      expect(result.answer).toMatch(/Silakan tulis pertanyaannya/i);
    }
  });

  test('answers clear conversational small-talk before expensive knowledge paths', async () => {
    const originalTrainingData = prisma.trainingData;
    let trainingCalls = 0;
    prisma.trainingData = {
      count: jest.fn(async () => { trainingCalls += 1; return 0; }),
      findFirst: jest.fn(async () => { trainingCalls += 1; return null; }),
      findMany: jest.fn(async () => { trainingCalls += 1; return []; })
    };

    try {
      const cases = [
        'apa kabar?',
        'kabar kamu gimana?',
        'gimana kabarnya?',
        'kamu gimana?',
        'kamu baik?',
        'sehat?',
        'halo, apa kabar?',
        'pagi min',
        'selamat malam',
        'makasih ya',
        'terima kasih infonya',
        'oke makasih',
        'sip',
        'mantap',
        'saya mau tanya',
        'mau tanya sesuatu',
        'gmn kabarnya?',
        'km gimana?',
        'kabar min?',
        'mksh min',
        'thx min'
      ];

      for (const query of cases) {
        trainingCalls = 0;
        const start = Date.now();
        const result = await querySemanticRag(query);
        expect(result.success).toBe(true);
        expect(result.source).toMatch(/semantic-rag-(small-talk|clarify)/);
        expect(result.answer).toBeTruthy();
        expect(trainingCalls).toBe(0);
        expect(Date.now() - start).toBeLessThan(5000);
      }
    } finally {
      prisma.trainingData = originalTrainingData;
    }
  });

  test('does not let small-talk words hijack RAG information questions', async () => {
    const fee = await querySemanticRag('boleh tanya biaya SI?');
    expect(fee.success).toBe(true);
    expect(fee.source).toMatch(/fee/i);
    expect(fee.answer).toMatch(/Sistem Informasi|biaya/i);

    const career = await querySemanticRag('career center di stikom itu ngapain?');
    expect(career.success).toBe(true);
    expect(career.source).toMatch(/campus|support|facility/i);
    expect(career.answer).toMatch(/Career Center/i);
    expect(career.answer).not.toMatch(/^Saya siap bantu/i);

    const program = await querySemanticRag('halo apa itu SI?');
    expect(program.success).toBe(true);
    expect(program.source).toMatch(/program-definition/i);
    expect(program.answer).toMatch(/Sistem Informasi/i);
  });
});