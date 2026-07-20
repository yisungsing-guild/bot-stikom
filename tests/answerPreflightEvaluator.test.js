const {
  evaluateOutboundAnswer,
  normalizeOutboundAnswerText,
  hasLikelyRawDocumentLeak
} = require('../src/utils/answerPreflightEvaluator');

describe('answerPreflightEvaluator', () => {
  const oldEnv = process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS;

  afterEach(() => {
    if (typeof oldEnv === 'undefined') delete process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS;
    else process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = oldEnv;
  });

  test('removes optional follow-up suggestions by default', () => {
    delete process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS;
    const result = evaluateOutboundAnswer('Jawaban utama.\n\nKalau mau lanjut, kakak bisa tanya:\n- Pertanyaan lain?', 'apa itu GCCP?');
    expect(result.answer).toBe('Jawaban utama.');
    expect(result.answer).not.toMatch(/Kalau mau lanjut/i);
  });

  test('cleans visible dangling ellipsis artifacts', () => {
    expect(normalizeOutboundAnswerText('Bagian ini terpotong per…')).toBe('Bagian ini terpotong per.');
    expect(normalizeOutboundAnswerText('Program GCCP)...')).toBe('Program GCCP).');
  });

  test('blocks technical metadata leaks with fallback', () => {
    const result = evaluateOutboundAnswer('CONFIDENCE: 0.4\nSOURCE_CHUNKS: []', 'apa itu BCCP?');
    expect(result.blocked).toBe(true);
    expect(result.issues).toContain('technical_leak');
    expect(result.answer).toMatch(/belum cukup|belum mempunyai/i);
    expect(result.answer).not.toMatch(/SOURCE_CHUNKS|CONFIDENCE/);
  });

  test('detects raw administrative document leaks', () => {
    const raw = 'Pasal 13 ADDENDUM\nPIHAK PERTAMA wajib memberitahukan kepada PIHAK KEDUA dalam perjanjian kerja sama.';
    expect(hasLikelyRawDocumentLeak(raw)).toBe(true);
    const result = evaluateOutboundAnswer(raw, 'apakah ada fasilitas belajar bahasa?');
    expect(result.blocked).toBe(true);
    expect(result.issues).toContain('raw_document_leak');
  });
});