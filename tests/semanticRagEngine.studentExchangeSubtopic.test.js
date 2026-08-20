describe('semantic RAG Student Exchange subtopic routing', () => {
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

  function expectStudentExchangeBenefit(result) {
    expect(result.success).toBe(true);
    expect(result.source).toBe('semantic-rag-international-topic-composer');
    expect(result.answer).toMatch(/Student Exchange/i);
    expect(result.answer).toMatch(/pengalaman belajar|internasional|wawasan global|jaringan|karier/i);
    expect(result.answer).not.toMatch(/alur\/cara mengikuti atau mendaftar Student Exchange/i);
  }

  test('answers the proven Student Exchange benefit wording without generic insufficient-data', async () => {
    const result = await ask('Apa manfaat mengikuti Student Exchange?');
    expectStudentExchangeBenefit(result);
  });

  test('generalizes across unseen Student Exchange benefit paraphrases', async () => {
    const variants = [
      'Apa keuntungan ikut Student Exchange?',
      'student exchange manfaatnya apa ya?',
      'kalau ikut pertukaran mahasiswa dapat manfaat apa?',
      'ikut exchange itu benefitnya buat mahasiswa apa?'
    ];

    for (const query of variants) {
      const result = await ask(query);
      expectStudentExchangeBenefit(result);
    }
  });

  test('routes other supported Student Exchange subtopics to international topic composer', async () => {
    const requirement = await ask('apa saja syarat mengikuti Student Exchange?');
    expect(requirement.source).toBe('semantic-rag-international-topic-composer');
    expect(requirement.answer).toMatch(/mahasiswa aktif|IPK|bahasa asing|seleksi/i);

    const country = await ask('Student Exchange tersedia ke negara mana saja?');
    expect(country.source).toBe('semantic-rag-international-topic-composer');
    expect(country.answer).toMatch(/China|Thailand|Malaysia|Filipina|Philippines/i);
  });

  test('preserves negative controls and broad existence behavior', async () => {
    const existence = await ask('ada Student Exchange?');
    expect(existence.source).toMatch(/semantic-rag-(international|campus-support-entity)/i);
    expect(existence.answer).toMatch(/Student Exchange|pertukaran mahasiswa/i);

    const ukmBenefit = await ask('apa manfaat ikut UKM VOS?');
    expect(ukmBenefit.source).not.toBe('semantic-rag-international-topic-composer');
    expect(ukmBenefit.answer).not.toMatch(/Student Exchange/i);

    const unrelatedExchange = await ask('apa manfaat exchange barang bekas?');
    expect(unrelatedExchange.source).not.toBe('semantic-rag-international-topic-composer');
  });
});
