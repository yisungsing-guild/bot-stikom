const { querySemanticRag } = require('../src/engine/semanticRagEngine');
const { buildCanonicalQueryUnderstanding } = require('../src/engine/queryUnderstanding');
const { sanitizeWhatsappText } = require('../src/utils/textSanitizer');

describe('real-user generalization contracts', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
    process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';
  });

  const staleS2Context = {
    history: [
      { direction: 'user', message: 'S2 Sistem Informasi gelarnya apa?' },
      { direction: 'bot', message: 'Lulusan memperoleh gelar Magister Komputer (M.Kom.).' }
    ]
  };

  test.each([
    ['Perbedaan antara program S1 dan D3 apa ya?'],
    ['D3 vs S1 bedanya apa min?'],
    ['Sarjana sama Diploma beda apa?']
  ])('academic-level comparison outranks program-list and fee routes: %s', async (question) => {
    const canonical = buildCanonicalQueryUnderstanding(question);
    expect(canonical.constraints.comparisonTarget).toBe('academic_level');

    const result = await querySemanticRag(question);
    expect(result.source).toBe('semantic-rag-study-level-comparison');
    expect(result.answer).toMatch(/S1|Sarjana/i);
    expect(result.answer).toMatch(/D3|Diploma/i);
    expect(result.answer).not.toMatch(/Rp\.|UKT|DPP|biaya awal/i);
  });

  test('program-level comparison does not hijack program-vs-program comparison', async () => {
    const result = await querySemanticRag('SI sama TI bedanya apa?');
    expect(result.source).toBe('semantic-rag-program-comparison');
    expect(result.answer).toMatch(/Sistem Informasi/i);
    expect(result.answer).toMatch(/Teknologi Informasi/i);
  });

  test.each([
    ['Kalau S1 yang cocok untuk bekerja di bidang pemasaran yang mana ya?'],
    ['Aku minat marketing digital, S1 yang paling nyambung apa?'],
    ['s1 buat arah marketing digital enaknya prodi apa min?']
  ])('career-goal recommendation is grounded and not a generic fallback: %s', async (question) => {
    const result = await querySemanticRag(question);
    expect(result.source).toBe('semantic-rag-program-recommendation');
    expect(result.answer).toMatch(/Bisnis Digital|marketing|pemasaran/i);
    expect(result.answer).not.toMatch(/belum menemukan data yang sesuai/i);
  });

  test('unsupported career-goal recommendation does not substitute nearest supported program as certainty', async () => {
    const cases = [
      'Kalau mau jadi astronot, S1 apa yang paling cocok?',
      'Kalau S1 cocok buat jadi astronot yang mana?'
    ];

    for (const question of cases) {
      const result = await querySemanticRag(question);
      expect(result.source).toMatch(/program-recommendation-insufficient-data|meaning-mismatch|fallback|insufficient/i);
      expect(result.answer).toMatch(/belum|tidak.*cukup|tidak.*menemukan|sumber/i);
      expect(result.answer).not.toMatch(/paling cocok.*(?:Bisnis Digital|Sistem Informasi|Teknik Informatika)/i);
    }
  });

  test.each([
    ['Apakah ITB STIKOM Bali membantu lulusannya mendapatkan pekerjaan?'],
    ['Kampus bantu alumni cari kerja nggak?'],
    ['Ada dukungan karier buat lulusan?']
  ])('career employment-support intent rejects stale degree-outcome context: %s', async (question) => {
    const result = await querySemanticRag(question, { sessionData: staleS2Context });
    expect(result.source).toMatch(/career|campus-support/i);
    expect(result.answer).toMatch(/Career Center|karier|lowongan|magang|pekerjaan|kerja/i);
    expect(result.answer).not.toMatch(/Magister Komputer|M\.Kom/i);
  });

  test('true contextual program follow-up can still inherit compatible entity context', async () => {
    const result = await querySemanticRag('Kalau TI?', {
      sessionData: {
        history: [
          { direction: 'user', message: 'Berapa biaya Sistem Informasi?' },
          { direction: 'bot', message: 'Rincian biaya Sistem Informasi tersedia.' }
        ]
      }
    });
    expect(result.answer).toMatch(/Teknologi Informasi|TI|UKT|DPP|biaya/i);
  });

  test('double-degree composer and WhatsApp sanitizer do not leak mojibake bullets', async () => {
    const result = await querySemanticRag('Double Degree itu gelarnya apa saja?');
    expect(result.answer).not.toMatch(/â€¢|â€|Ã¢/);

    const sanitized = sanitizeWhatsappText('Daftar:\nâ€¢ item');
    expect(sanitized).toContain('- item');
    expect(sanitized).not.toMatch(/â€¢/);
  });
});

