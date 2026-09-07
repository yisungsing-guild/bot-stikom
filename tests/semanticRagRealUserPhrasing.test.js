describe('semanticRag real user phrasing regression', () => {
  let querySemanticRag;
  let clearSemanticCaches;
  const badAnswerPattern = /\[NO ANSWER\]|Gunakan nama file|jawaban yang terbentuk belum sesuai|belum mempunyai jawaban yang cukup aman|belum bisa mengambil jawaban/i;

  beforeAll(() => {
    delete process.env.OPENAI_API_KEY;
    process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '300000';
    process.env.SEMANTIC_RAG_TODAY_YMD = '2026-07-22';
    process.env.SEMANTIC_RAG_DB_CONTENT_FALLBACK = 'false';
    process.env.SEMANTIC_RAG_INDEX_CACHE_MS = '300000';
    process.env.SEMANTIC_RAG_TRAINING_DB_CACHE_MS = '300000';
    process.env.RAG_TRACE_PERSIST = 'false';
    ({ querySemanticRag, clearSemanticCaches } = require('../src/engine/semanticRagEngine'));
    clearSemanticCaches();
  });

  afterAll(() => {
    delete process.env.SEMANTIC_RAG_TODAY_YMD;
    delete process.env.SEMANTIC_RAG_DB_CONTENT_FALLBACK;
    delete process.env.SEMANTIC_RAG_RESULT_CACHE_MS;
    delete process.env.SEMANTIC_RAG_INDEX_CACHE_MS;
    delete process.env.SEMANTIC_RAG_TRAINING_DB_CACHE_MS;
    delete process.env.RAG_TRACE_PERSIST;
    delete process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS;
  });

  async function ask(question, options = {}) {
    const result = await querySemanticRag(question, { topK: 5, ...options });
    const answer = String(result.answer || '[NO ANSWER]').replace(/\s+/g, ' ').trim();
    expect(result.success).toBe(true);
    expect(answer).not.toMatch(badAnswerPattern);
    return { ...result, answer };
  }

  test('understands casual PMB and registration variants', async () => {
    const cases = [
      { q: 'gmn daftar min?', must: /siap\.stikom-bali\.ac\.id|online|kampus/i },
      { q: 'daftarnya online lewat mana kak?', must: /siap\.stikom-bali\.ac\.id/i },
      { q: 'pmb masih buka ga?', must: /Gelombang IV B|sedang buka/i },
      { q: 'aku salah isi data pendaftaran gimana?', must: /Admin PMB|koreksi|data yang benar/i },
      { q: 'boleh ganti jurusan setelah daftar?', must: /Admin PMB|pilihan prodi|diubah/i }
    ];

    for (const item of cases) {
      const result = await ask(item.q);
      expect(result.answer).toMatch(item.must);
    }
  });

  test('understands casual program and fee variants', async () => {
    const cases = [
      { q: 'jurusan apa aja sih?', must: /Sistem Informasi|Teknologi Informasi|Bisnis Digital/i },
      { q: 'teknik informatika itu apa?', must: /Teknologi Informasi|perangkat lunak|cloud|coding/i },
      { q: 'beda ti sama si apa ya?', must: /Sistem Informasi|Teknologi Informasi/i },
      { q: 'biaya teknik informatika brp?', must: /Teknologi Informasi|Biaya awal masuk|UKT|semester/i },
      { q: 'uang pangkalnya berapa?', must: /DPP|biaya awal masuk|gelombang/i },
      { q: 'bisa nyicil ga?', must: /cicilan|pembayaran|Admin PMB|keuangan/i }
    ];

    for (const item of cases) {
      const result = await ask(item.q);
      expect(result.answer).toMatch(item.must);
    }
  });

  test('understands casual academic and finance variants', async () => {
    const cases = [
      { q: 'jadwal kuliah liat dimana?', must: /portal akademik|SION|akademik/i },
      { q: 'telat krs gimana?', must: /KRS|dosen pembimbing|akademik/i },
      { q: 'nilai ku salah harus lapor siapa?', must: /dosen pengampu|revisi nilai|akademik/i },
      { q: 'mau ajukan skripsi caranya?', must: /skripsi|prodi|akademik/i },
      { q: 'ukt bayar lewat apa?', must: /pembayaran UKT|bagian keuangan|admin/i },
      { q: 'dendanya berapa kalau telat bayar?', must: /denda|keuangan|nominal/i },
      { q: 'tagihan berubah kenapa ya?', must: /tagihan|bagian keuangan|komponen/i }
    ];

    for (const item of cases) {
      const result = await ask(item.q);
      expect(result.answer).toMatch(item.must);
    }
  });

  test('understands casual student affairs, international, admin, and career variants', async () => {
    const cases = [
      { q: 'gabung bem gimana?', must: /BEM|rekrutmen|kemahasiswaan/i },
      { q: 'ada sertifikasi buat mahasiswa?', must: /sertifikasi|pelatihan|kemahasiswaan|Career Center/i },
      { q: 'negara partner double degree mana aja?', must: /China|Malaysia|DNUI|HELP/i },
      { q: 'kelas internasional ada ga?', must: /Double Degree Internasional|Language Learning Center|Admin PMB/i },
      { q: 'hubungi dosen lewat mana?', must: /kanal resmi|prodi|akademik/i },
      { q: 'minta transkrip nilai gimana?', must: /transkrip|administrasi|akademik/i },
      { q: 'ada loker ga dari kampus?', must: /Career Center|lowongan|karier|kerja/i },
      { q: 'nomor admin kampus berapa?', must: /0361|siap\.stikom-bali\.ac\.id|kampus/i }
    ];

    for (const item of cases) {
      const result = await ask(item.q);
      expect(result.answer).toMatch(item.must);
    }
  });

  test('does not route operational questions to unrelated generic answers', async () => {
    const checks = [
      { q: 'pendaftaran wisuda gimana?', forbidden: /pendaftaran online atau datang langsung ke kampus/i, must: /wisuda|akademik|BAAK/i },
      { q: 'kampus dukung lomba nasional ga?', forbidden: /Lokasi kampus/i, must: /lomba nasional|kemahasiswaan|prodi/i },
      { q: 'alur pendaftaran online gimana?', forbidden: /pembayaran UKT/i, must: /siap\.stikom-bali\.ac\.id|online/i }
    ];

    for (const item of checks) {
      const result = await ask(item.q);
      expect(result.answer).not.toMatch(item.forbidden);
      expect(result.answer).toMatch(item.must);
    }
  });
  test('keeps registration-fee suffix and S2 learning-content production reproducers grounded', async () => {
    const fee = await ask('Ti berapa daftarnya min?');
    expect(fee.source).toBe('semantic-rag-registration-fee');
    expect(fee.answer).toMatch(/Teknologi Informasi/i);
    expect(fee.answer).toMatch(/biaya pendaftaran/i);
    expect(fee.answer).toMatch(/500\.000/);

    const feeControl = await ask('Ti brp daftar min?');
    expect(feeControl.source).toBe('semantic-rag-registration-fee');
    expect(feeControl.answer).toMatch(/Teknologi Informasi/i);
    expect(feeControl.answer).toMatch(/biaya pendaftaran/i);

    const contaminatedFee = await querySemanticRag('Ti berapa daftarnya min?', {
      sessionData: {
        messages: [
          { role: 'user', content: 'Saya mau tahu S2 Sistem Informasi' },
          { role: 'assistant', content: 'Baik, S2 Sistem Informasi tersedia.' }
        ]
      }
    });
    expect(contaminatedFee.source).toBe('semantic-rag-registration-fee');
    expect(String(contaminatedFee.answer)).toMatch(/Teknologi Informasi/i);
    expect(String(contaminatedFee.answer)).not.toMatch(/Prodi Sistem Informasi:/i);

    const s2 = await querySemanticRag('Apa saja yang di pelajari di s2?', {
      sessionData: {
        messages: [
          { role: 'user', content: 'Saya mau tahu S2 Sistem Informasi' },
          { role: 'assistant', content: 'Baik, S2 Sistem Informasi tersedia.' }
        ]
      }
    });
    expect(s2.source).toBe('semantic-rag-postgraduate-profile');
    expect(String(s2.answer)).toMatch(/S2 Sistem Informasi|Pascasarjana/i);
    expect(String(s2.answer)).toMatch(/kurikulum|perkuliahan|Data Science|Cyber Security/i);
  });
  test('generic fee contracts have a terminal owner or safe boundary', async () => {
    for (const q of ['berapa biayanya TI?', 'biaya TI berapa?', 'berapa biaya TI?', 'total biaya TI?', 'biaya masuk TI?']) {
      const result = await ask(q);
      expect(result.source).toMatch(/semantic-rag-fee-detail|semantic-rag-fee-general|semantic-rag-registration-fee/i);
      expect(result.answer).toMatch(/Teknologi Informasi|Prodi/i);
    }

    for (const q of ['potongannya berapa?', 'diskonnya berapa?', 'ada potongan?', 'potongan gelombang 2 berapa?']) {
      const result = await ask(q);
      expect(result.source).toBe('semantic-rag-fee-general');
      expect(result.answer).toMatch(/potongan|gelombang|prodi/i);
    }

    for (const q of ['cicilannya bagaimana?', 'bisa dicicil?', 'angsurannya bagaimana?', 'pembayaran bisa bertahap?']) {
      const result = await ask(q);
      expect(result.source).toMatch(/semantic-rag-fee-general|semantic-rag-finance-fallback/i);
      expect(result.answer).toMatch(/cicilan|pembayaran|bertahap|keuangan/i);
    }
  });

  test('non-campus fee-like objects do not enter campus fee answers', async () => {
    for (const q of ['berapa biaya hidup di Bali?', 'diskon laptop ada?', 'cicilan motor bagaimana?']) {
      const result = await ask(q);
      expect(result.source).toBe('semantic-rag-out-of-domain');
      expect(result.answer).toMatch(/di luar|non-kampus|barang pribadi|kendaraan|biaya hidup/i);
    }
  });
});

