describe('semanticRag real user phrasing regression', () => {
  const badAnswerPattern = /\[NO ANSWER\]|Gunakan nama file|jawaban yang terbentuk belum sesuai|belum mempunyai jawaban yang cukup aman|belum bisa mengambil jawaban/i;

  beforeEach(() => {
    jest.resetModules();
    delete process.env.OPENAI_API_KEY;
    process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
    process.env.SEMANTIC_RAG_TODAY_YMD = '2026-07-22';
    process.env.SEMANTIC_RAG_DB_CONTENT_FALLBACK = 'false';
  });

  afterEach(() => {
    delete process.env.SEMANTIC_RAG_TODAY_YMD;
    delete process.env.SEMANTIC_RAG_DB_CONTENT_FALLBACK;
    delete process.env.SEMANTIC_RAG_RESULT_CACHE_MS;
    delete process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS;
  });

  async function ask(question, options = {}) {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
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
      { q: 'jadwal kuliah liat dimana?', must: /portal akademik|SIAKAD|akademik/i },
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
});
