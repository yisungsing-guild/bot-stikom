const express = require('express');
const request = require('supertest');

jest.mock('../src/db', () => ({
  chat: {
    findUnique: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue({ chatId: 'user1', status: 'BOT' }),
    update: jest.fn().mockResolvedValue({})
  },
  setting: {
    findUnique: jest.fn().mockImplementation(async ({ where } = {}) => {
      if (where && where.key === 'welcome_message') return { key: 'welcome_message', value: 'WELCOME_MENU' };
      return null;
    })
  },
  trainingData: {
    count: jest.fn().mockResolvedValue(1)
  },
  session: {
    findUnique: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
    create: jest.fn().mockResolvedValue({})
  },
  menuItem: {
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null)
  }
}));

jest.mock('../src/engine/chatLog', () => ({
  appendChatMessage: jest.fn().mockResolvedValue(undefined),
  getChatMessages: jest.fn().mockResolvedValue([])
}));

jest.mock('../src/engine/ragEngine', () => {
  const actual = jest.requireActual('../src/engine/ragEngine');
  return {
    ...actual,
    query: jest.fn().mockResolvedValue({ success: true, answer: 'RAG_SHOULD_NOT_BE_USED_FOR_SCHEDULE', source: 'rag', contexts: [] })
  };
});

jest.mock('../src/engine/webSearchFallback', () => ({
  webSearchFallbackAnswer: jest.fn().mockResolvedValue({ ok: false, reason: 'mock_default' })
}));

const { querySemanticRag } = require('../src/engine/semanticRagEngine');
const { normalizeInput } = require('../src/lib/normalizer');
const { selectEvidenceFromContexts, evaluateEvidenceAnswerability } = require('../src/engine/evidenceSelector');
const rag = require('../src/engine/ragEngine');
const providerRouterFactory = require('../src/routes/provider');

const REQUIRED_SCHEDULE_QUERIES = [
  'jadwal pmb',
  'jadwal pendaftaran',
  'jadwal gelombang 2b',
  'pendaftaran sekarang masih buka?',
  'gelombang berapa yang sedang berjalan?'
];

function hasScheduleAnswer(text) {
  return /jadwal|kalender|gelombang|pendaftaran|masa pendaftaran/i.test(String(text || '')) &&
    /\b(20\d{2}|januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\b/i.test(String(text || ''));
}

describe('PMB schedule deployment readiness', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.OPENAI_API_KEY;
    process.env.ENABLE_RAG = 'true';
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
    process.env.SEMANTIC_RAG_TODAY_YMD = '2026-07-21';
    process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';
  });

  test.each(REQUIRED_SCHEDULE_QUERIES)('semantic schedule answer is not empty fallback: %s', async (question) => {
    const normalized = normalizeInput(question).normalized;
    const result = await querySemanticRag(question, { topK: 8 });

    expect(normalized).toBeTruthy();
    expect(result.success).toBe(true);
    expect(result.source).toMatch(/schedule-window|current-open-waves/);
    expect(result.answer).toBeTruthy();
    expect(result.answer).not.toMatch(/belum sesuai|tidak cukup|mempunyai jawaban yang mencukupi|semantic-rag-disabled/i);
    expect(hasScheduleAnswer(result.answer)).toBe(true);
  }, 20000);

  test.each(REQUIRED_SCHEDULE_QUERIES)('provider final response keeps valid schedule answer: %s', async (question) => {
    const app = express();
    const provider = { sendMessage: jest.fn().mockResolvedValue(undefined) };
    app.use(express.json());
    app.use('/provider', providerRouterFactory(provider));

    const res = await request(app).post('/provider/webhook').send({ chatId: 'schedule-user', text: question });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const sentTexts = provider.sendMessage.mock.calls.map((call) => String(call[1] || ''));
    expect(sentTexts.length).toBeGreaterThanOrEqual(1);
    expect(sentTexts.join('\n')).not.toMatch(/jawaban yang terbentuk belum sesuai|belum mempunyai jawaban yang cukup aman/i);
    expect(sentTexts.some((text) => hasScheduleAnswer(text))).toBe(true);
    expect(rag.query).not.toHaveBeenCalledWith(question);
  }, 30000);

  test('schedule evidence requires concrete date or period', () => {
    const question = 'Kapan Gelombang 2B dibuka?';
    const selected = [{
      text: 'Kampus membuka penerimaan mahasiswa baru untuk calon mahasiswa.',
      source: 'test',
      sourceId: 'test-general-pmb',
      relevanceScore: 0.8,
      entityScore: 0.5,
      intentScore: 1,
      reason: 'forced selected evidence to isolate answerability shape',
      isSelectedEvidence: true
    }];
    const answerability = evaluateEvidenceAnswerability({ question, selectedEvidence: selected, intent: 'schedule' });

    expect(answerability.answerable).toBe(false);
    expect(answerability.missingEvidence).toContain('date_or_period');
  });

  test('schedule evidence with wave and dates is answerable', () => {
    const question = 'Kapan Gelombang 2B dibuka?';
    const selected = selectEvidenceFromContexts({
      question,
      intent: 'schedule',
      contexts: [{ chunk: 'Pendaftaran Gelombang 2B dibuka mulai 1 Juli 2026 sampai 31 Juli 2026.' }]
    });
    const answerability = evaluateEvidenceAnswerability({ question, selectedEvidence: selected, intent: 'schedule' });

    expect(selected.length).toBeGreaterThan(0);
    expect(answerability.answerable).toBe(true);
  });
});