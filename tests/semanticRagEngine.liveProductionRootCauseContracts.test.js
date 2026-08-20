describe('live production root-cause semantic contracts', () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.OPENAI_API_KEY;
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
    process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';
  });

  async function ask(query) {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    return querySemanticRag(query, { topK: 8 });
  }

  function expectS2Curriculum(result) {
    expect(result.success).toBe(true);
    expect(result.source).toMatch(/semantic-rag-(postgraduate-profile|program-curriculum)/i);
    expect(result.answer).toMatch(/S2|Pascasarjana|Magister/i);
    expect(result.answer).toMatch(/Sistem Informasi|Intelligent|Secure System|Cyber Security|Data Science|56\s*SKS/i);
    expect(result.answer).not.toMatch(/Hi-Think|Jepang|Student Exchange/i);
  }

  test('routes S2 course/curriculum wording before Hi-Think or generic international evidence', async () => {
    expectS2Curriculum(await ask('Perkuliahan yang ada di S2 apa saja?'));

    const variants = [
      'mata kuliah pascasarjana apa saja?',
      'S2 SI kuliahnya membahas apa?',
      'kurikulum magister sistem informasi fokusnya apa?'
    ];
    for (const query of variants) expectS2Curriculum(await ask(query));

    const hiThink = await ask('apa itu Hi-Think?');
    expect(hiThink.answer).toMatch(/Hi-Think|Jepang/i);
  });

  function expectOrganizationCount(result) {
    expect(result.success).toBe(true);
    expect(result.source).toBe('semantic-rag-ukm-count');
    expect(result.answer).toMatch(/32\s+UKM\/Ormawa|32\s+(?:UKM|Ormawa|organisasi)/i);
    expect(result.answer).not.toMatch(/biaya|UKT|DPP|Gelombang/i);
  }

  test('answers organization count requests as count, not generic evidence or fee', async () => {
    expectOrganizationCount(await ask('Berapa ada ormawa di ITB STIKOM Bali'));

    const variants = [
      'jumlah UKM di STIKOM ada berapa?',
      'total organisasi mahasiswa berapa?',
      'ada berapa unit kegiatan mahasiswa di kampus?'
    ];
    for (const query of variants) expectOrganizationCount(await ask(query));

    const list = await ask('UKM apa saja?');
    expect(list.source).toBe('semantic-rag-ukm-list');
    expect(list.answer).toMatch(/Athena Esports|Tari|Syntax/i);
  });

  function expectCleanTariProfile(result) {
    expect(result.success).toBe(true);
    expect(result.source).toBe('semantic-rag-ukm-list');
    expect(result.answer).toMatch(/Tari|PRAGINA|Seni Tradisional/i);
    expect(result.answer).not.toMatch(/PROFILE\s+(?:ORMAWA|UKM|ORGANISASI)|Teks hasil OCR|Ringkasan Dokumen/i);
    expect(result.answer).not.toMatch(/diprakarsai oleh Prof\.|Beserta Istrinya|^.*-\s*Dari awal/im);
  }

  test('cleans UKM profile evidence fragments across profile phrasing', async () => {
    expectCleanTariProfile(await ask('Profil ukm tari'));

    const variants = [
      'ukm tari pragina itu apa?',
      'jelasin profil ormawa tari',
      'tari tradisional pragina kegiatannya apa?'
    ];
    for (const query of variants) expectCleanTariProfile(await ask(query));

    const unknown = await ask('profil ukm robot terbang');
    expect(unknown.source).toMatch(/ukm-unknown|insufficient|meaning-mismatch|preflight/i);
    expect(unknown.answer).not.toMatch(/PRAGINA|Tari Tradisional/i);
  });
});
