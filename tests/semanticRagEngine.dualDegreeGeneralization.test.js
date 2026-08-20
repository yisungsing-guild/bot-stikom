describe('semantic RAG dual-degree relation generalization', () => {
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

  function expectUtbPair(result) {
    expect(result.success).toBe(true);
    expect(result.source).toBe('semantic-rag-dual-degree');
    expect(result.answer).toMatch(/Prodi di (ITB )?STIKOM Bali\s*(adalah|:)\s*Bisnis Digital/i);
    expect(result.answer).toMatch(/jurusan di UTB\s*(adalah|:)\s*DKV \(Desain Komunikasi Visual\)/i);
    expect(result.answer).not.toMatch(/jurusan di DNUI:.*DKV|jurusan di HELP.*DKV/i);
  }

  test('answers the proven reverse UTB/DKV wording without falling to meaning mismatch', async () => {
    const result = await ask('Kalau UTB diambil DKV, di stikom bali jurusan yang diambil apa?');
    expectUtbPair(result);
  });

  test('keeps the previously successful explicit dual-degree paraphrase working', async () => {
    const result = await ask('di dual degree UTB prodi STIKOM-nya apa?');
    expectUtbPair(result);
  });

  test('generalizes across unseen UTB/DKV/STIKOM relation phrasings', async () => {
    const variants = [
      'kalau mitranya UTB jurusan DKV, di STIKOM prodi apa?',
      'UTB DKV itu padanannya di STIKOM apa ya?',
      'kalo DD UTB ambil DKV, di stikom bali ambil prodi apa?',
      'program studi STIKOM untuk jalur UTB DKV apa?',
      'di STIKOM Bali pasangannya apa kalau sisi UTB DKV?'
    ];

    for (const query of variants) {
      const result = await ask(query);
      expectUtbPair(result);
    }
  });

  test('does not hijack unrelated or unsupported UTB/DKV/STIKOM questions', async () => {
    const dkvDefinition = await ask('Apa itu DKV?');
    expect(dkvDefinition.source).not.toBe('semantic-rag-dual-degree');
    expect(dkvDefinition.answer).toMatch(/DKV|Desain Komunikasi Visual/i);

    const utbLocation = await ask('alamat UTB dimana?');
    expect(utbLocation.source).not.toBe('semantic-rag-dual-degree');

    const regularDkv = await ask('apakah STIKOM punya jurusan DKV reguler?');
    expect(regularDkv.source).not.toBe('semantic-rag-dual-degree');
    const regularProgramSection = String(regularDkv.answer || '').split(/D3 \(Diploma\):/i)[0];
    expect(regularProgramSection).not.toMatch(/\bDKV\b|Desain Komunikasi Visual/i);

    const unsupportedPartner = await ask('double degree dengan Harvard University jurusannya apa?');
    expect(unsupportedPartner.source).toBe('semantic-rag-unsupported-double-degree-partner');
    expect(unsupportedPartner.answer).toMatch(/belum menemukan data kerja sama Double Degree/i);
    expect(unsupportedPartner.answer).not.toMatch(/Harvard University[\s\S]*Bisnis Digital|Harvard University[\s\S]*DKV/i);
  });
});
