describe('semantic RAG final pre-deployment generalization contracts', () => {
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


  test('keeps explicit date as the reference for wave membership questions', async () => {
    const result = await ask('tanggal 10 februari 2026 itu masih masuk gelombang 1 kan?');
    expect(result.source).toBe('semantic-rag-schedule-window');
    expect(result.answer).toMatch(/10 Februari 2026/i);
    expect(result.answer).toMatch(/Gelombang I|Gelombang 1/i);
    expect(result.answer).not.toMatch(/Per 20 Agustus|Per 19 Agustus/i);
  });
  test('routes registration-fee subtype before detailed fee breakdown', async () => {
    const known = await ask('biaya daftar untuk BD kena berapa?');
    expect(known.source).toBe('semantic-rag-registration-fee');
    expect(known.answer).toMatch(/biaya pendaftaran/i);
    expect(known.answer).toMatch(/Bisnis Digital/i);
    expect(known.answer).not.toMatch(/biaya pendidikan per semester|Rp\\.?\\s*6\\.500\\.000|Berikut gambaran biaya/i);

    const unseen = await ask('uang daftar prodi TI berapa ya?');
    expect(unseen.source).toBe('semantic-rag-registration-fee');
    expect(unseen.answer).toMatch(/biaya pendaftaran|uang daftar/i);
    expect(unseen.answer).toMatch(/Teknologi Informasi/i);
  });

  test('answers shorthand program-list phrasing without cross-domain leakage', async () => {
    const result = await ask('prodinya ada apa aj?');
    expect(result.source).toBe('semantic-rag-program-list');
    expect(result.answer).toMatch(/program studi|prodi/i);
    expect(result.answer).toMatch(/Sistem Informasi/i);
    expect(result.answer).toMatch(/Teknologi Informasi/i);
    expect(result.answer).toMatch(/Bisnis Digital/i);
    expect(result.answer).not.toMatch(/DNUI|HELP University|UTB|China|Malaysia/i);
  });

  test('routes informal program comparison to structured comparison handler', async () => {
    const variants = [
      'kalau TI dibanding SI bedanya paling kerasa dimana?',
      'bedain si sama ti dong'
    ];
    for (const query of variants) {
      const result = await ask(query);
      expect(result.source).toBe('semantic-rag-program-comparison');
      expect(result.answer).toMatch(/Sistem Informasi/i);
      expect(result.answer).toMatch(/Teknologi Informasi/i);
      expect(result.answer).toMatch(/beda|perbedaan|dibanding|fokus/i);
    }
  });

  test('preserves safe fallback for physical attributes, unknown programs, and unsupported partners', async () => {
    const color = await ask('gedung kampus renon warnanya apa?');
    expect(color.source).toBe('semantic-rag-campus-physical-attribute-insufficient-data');
    expect(color.answer).not.toMatch(/Jl\. Raya Puputan|alamat kampus/i);

    const medical = await ask('jurusan kedokteran di STIKOM biayanya berapa?');
    expect(medical.source).toBe('semantic-rag-out-of-domain');
    expect(medical.answer).toMatch(/tidak memiliki program studi kedokteran/i);
    expect(medical.answer).not.toMatch(/UKT|DPP|Rp\.\s*6\.500\.000/i);

    const unsupportedPartner = await ask('double degree Harvard itu ambil jurusan apa?');
    expect(unsupportedPartner.source).toBe('semantic-rag-unsupported-double-degree-partner');
    expect(unsupportedPartner.answer).toMatch(/belum menemukan data kerja sama Double Degree/i);
    expect(unsupportedPartner.answer).toMatch(/UTB|DNUI|HELP/i);
  });

  test('keeps cross-domain exchange negative control away from Student Exchange', async () => {
    const result = await ask('apa manfaat exchange barang bekas?');
    expect(result.source).not.toBe('semantic-rag-international-topic-composer');
    expect(result.answer).not.toMatch(/Student Exchange|pertukaran mahasiswa/i);
  });
});