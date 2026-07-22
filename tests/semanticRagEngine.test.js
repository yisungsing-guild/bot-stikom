describe('semanticRagEngine', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.dontMock('../src/engine/ragEngine');
    delete process.env.OPENAI_API_KEY;
    delete process.env.SEMANTIC_RAG_MIN_SCORE;
    delete process.env.SEMANTIC_RAG_TODAY_YMD;
    delete process.env.SEMANTIC_RAG_RESULT_CACHE_MS;
    delete process.env.SEMANTIC_RAG_SANITIZE_INDEX;
    delete process.env.SEMANTIC_RAG_TRAINING_DB_INDEX_CACHE_MS;
  });

  test('returns disabled result when OpenAI API key is missing', async () => {
    jest.doMock('../src/engine/ragEngine', () => ({
      loadIndex: jest.fn(() => []),
      computeEmbedding: jest.fn(async () => []),
      cleanAnswerLanguage: jest.fn((text) => String(text || '').trim())
    }));

    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    const result = await querySemanticRag('TI brp?', { topK: 1 });

    expect(result.success).toBe(true);
    expect(result.answer).toBeNull();
    expect(result.source).toBe('semantic-rag-disabled');
  });

  test('does not answer operational academic policy questions without data', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    const result = await querySemanticRag('Kalau absensinya 5 kali apakah masih bisa ikut remedial ya');

    expect(result.success).toBe(true);
    expect(result.answer).toBeNull();
    expect(result.source).toBe('semantic-rag-operational-academic-policy-no-answer');
  });
  test('allows remedial and exam schedule questions to reach retrieval', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    const result = await querySemanticRag('Jadwal remedial kapan ya?');

    expect(result.success).toBe(true);
    expect(result.source).not.toBe('semantic-rag-operational-academic-policy-no-answer');
  });
  test('answers greeting and wellbeing without calling semantic RAG', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    const greeting = await querySemanticRag('Halo');
    expect(greeting.success).toBe(true);
    expect(greeting.source).toBe('semantic-rag-small-talk');
    expect(greeting.answer).toBe('Halo Kak, saya Tiko, asisten informasi ITB STIKOM Bali. Saya bisa bantu seputar PMB, rincian biaya, program studi, jadwal pendaftaran, beasiswa, dan informasi kampus.');

    const typoGreeting = await querySemanticRag('haalo');
    expect(typoGreeting.success).toBe(true);
    expect(typoGreeting.source).toBe('semantic-rag-small-talk');
    expect(typoGreeting.answer).toBe('Halo Kak, saya Tiko, asisten informasi ITB STIKOM Bali. Saya bisa bantu seputar PMB, rincian biaya, program studi, jadwal pendaftaran, beasiswa, dan informasi kampus.');
    expect(typoGreeting.answer).not.toMatch(/Saya jawab bagian|Kalau mau lanjut|Kesimpulan/i);

    for (const q of ['haaalooo kak', 'halloooo min', 'heellooo', 'hayyy admin']) {
      const fuzzyGreeting = await querySemanticRag(q);
      expect(fuzzyGreeting.success).toBe(true);
      expect(fuzzyGreeting.source).toBe('semantic-rag-small-talk');
      expect(fuzzyGreeting.answer).toMatch(/Halo Kak, saya Tiko/i);
    }

    const greetingWithQuestion = await querySemanticRag('halo rincian biaya SI gelombang 2B?');
    expect(greetingWithQuestion.source).not.toBe('semantic-rag-small-talk');
    expect(greetingWithQuestion.answer).toMatch(/biaya|Sistem Informasi|UKT|DPP/i);

    for (const q of ['halo bro', 'bro', 'mas', 'mbak', 'pak', 'bu', 'bang', 'gan', 'cuk', 'halo mas', 'pagi mbak']) {
      const casualGreeting = await querySemanticRag(q);
      expect(casualGreeting.success).toBe(true);
      expect(casualGreeting.source).toBe('semantic-rag-small-talk');
      expect(casualGreeting.answer).toMatch(/Halo Kak, saya Tiko/i);
    }

    for (const q of ['bro rincian biaya SI gelombang 2B?', 'mas biaya SI berapa?', 'cuk biaya SI berapa?']) {
      const casualWithQuestion = await querySemanticRag(q);
      expect(casualWithQuestion.source).not.toBe('semantic-rag-small-talk');
      if (casualWithQuestion.answer) {
        expect(casualWithQuestion.answer).toMatch(/biaya|Sistem Informasi|UKT|DPP/i);
      }
    }
    const kabar = await querySemanticRag('Apa kabar?');
    expect(kabar.success).toBe(true);
    expect(kabar.source).toBe('semantic-rag-small-talk');
    expect(kabar.answer).toBe('Saya baik-baik saja, terima kasih. Ada yang bisa saya bantu seputar ITB STIKOM Bali?');
    expect(kabar.answer).not.toMatch(/Alhamdulillah/i);
    expect(kabar.answer).not.toMatch(/Saya tangkap|Kesimpulannya|Kakak bisa lanjut tanya/i);

    const khabar = await querySemanticRag('Apa khabar?');
    expect(khabar.success).toBe(true);
    expect(khabar.source).toBe('semantic-rag-small-talk');
    expect(khabar.answer).toBe('Saya baik-baik saja, terima kasih. Ada yang bisa saya bantu seputar ITB STIKOM Bali?');
    expect(khabar.answer).not.toMatch(/Saya tangkap|Kesimpulannya|Kakak bisa lanjut tanya/i);

    const thanks = await querySemanticRag('terima ksih ya');
    expect(thanks.success).toBe(true);
    expect(thanks.source).toBe('semantic-rag-small-talk');
    expect(thanks.answer).toMatch(/Sama-sama/i);

    const ok = await querySemanticRag('okey');
    expect(ok.success).toBe(true);
    expect(ok.source).toBe('semantic-rag-small-talk');
    expect(ok.answer).toMatch(/Silakan lanjutkan/i);
  }, 15000);

  test('keeps casual small-talk from falling into no-data fallback', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    const music = await querySemanticRag('Kamu suka musik gak?');
    expect(music.success).toBe(true);
    expect(music.source).toBe('semantic-rag-small-talk');
    expect(music.answer).toMatch(/tidak punya selera pribadi|ngobrol santai soal musik/i);
    expect(music.answer).not.toMatch(/Mohon maaf, saya kemungkinan tidak mempunyai jawaban/i);

    const serious = await querySemanticRag('Kamu kok serius amat sih?');
    expect(serious.source).toBe('semantic-rag-small-talk');
    expect(serious.answer).toMatch(/terdengar terlalu serius|tetap santai/i);
    expect(serious.answer).not.toMatch(/syarat dan dokumen|PMB|Mohon maaf, saya kemungkinan/i);
  });
  test('answers common religious greetings with matching greeting', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    const cases = [
      ['Assalamualaikum', /Wa'alaikumsalam kak\./],
      ['Om Swastiastu', /Om Swastiastu, kak\./],
      ['Shalom', /Shalom, kak\./],
      ['Namo Buddhaya', /Namo Buddhaya, kak\./],
      ['Salam Kebajikan', /Salam Kebajikan, kak\./],
      ['Rahayu', /Rahayu, kak\./]
    ];

    for (const [input, pattern] of cases) {
      const result = await querySemanticRag(input);
      expect(result.success).toBe(true);
      expect(result.source).toBe('semantic-rag-small-talk');
      expect(result.answer).toMatch(pattern);
      expect(result.answer).toMatch(/Halo Kak, saya Tiko/);
      expect(result.answer).not.toMatch(/Saya tangkap|Kesimpulannya|Kakak bisa lanjut tanya/i);
    }
  });

  test('answers current open wave through semantic-first deterministic rule', async () => {
    jest.doMock('../src/engine/ragEngine', () => ({
      loadIndex: jest.fn(() => []),
      computeEmbedding: jest.fn(async () => []),
      cleanAnswerLanguage: jest.fn((text) => String(text || '').trim()),
      tryStructuredCurrentOpenWavesAnswer: jest.fn(() => ({
        answer: 'Per 07 Juli 2026 (WITA), gelombang yang sedang buka pendaftaran:\n- Gelombang IV A (5 Juli 2026 - 18 Juli 2026)',
        source: 'rag-current-open-waves'
      }))
    }));

    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    const result = await querySemanticRag('sekarang buka gelombang apa?');

    expect(result.success).toBe(true);
    expect(result.source).toBe('semantic-rag-current-open-waves');
    expect(result.answer).toMatch(/gelombang yang sedang buka/i);
    expect(result.answer).toMatch(/Gelombang IV A/i);
    expect(result.answer).not.toMatch(/membutuhkan informasi lebih lanjut|Saya tangkap|Kesimpulannya|Kakak bisa lanjut tanya/i);
  });

  test('answers PMB month and wave schedule without hallucinated fee drift', async () => {
    process.env.SEMANTIC_RAG_TODAY_YMD = '2026-07-07';
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    const nextMonth = await querySemanticRag('Halo, aku mau daftar bulan depan, bulan depan itu gelombang berapa ya?');
    expect(nextMonth.success).toBe(true);
    expect(nextMonth.source).toBe('semantic-rag-schedule-window');
    expect(nextMonth.answer).toMatch(/Agustus 2026/i);
    expect(nextMonth.answer).toMatch(/Gelombang IV B/i);
    expect(nextMonth.answer).not.toMatch(/Gelombang I\b|Rp\.?\s*\d/i);

    const august = await querySemanticRag('jadi di bulan agustus itu ada gelombang berapa?');
    expect(august.source).toBe('semantic-rag-schedule-window');
    expect(august.answer).toMatch(/Gelombang IV C/i);
    expect(august.answer).not.toMatch(/biaya|Rp\.?\s*\d/i);

    const waveTwoFollowup = await querySemanticRag('tadi gelombang 1 itu sampai januari aja, lalu yang gelombang 2 dari kapan sampai kapan?');
    expect(waveTwoFollowup.source).toBe('semantic-rag-schedule-window');
    expect(waveTwoFollowup.answer).toMatch(/Jadwal pendaftaran Gelombang II/i);
    expect(waveTwoFollowup.answer).toMatch(/Gelombang II A/i);
    expect(waveTwoFollowup.answer).toMatch(/Gelombang II C/i);
    expect(waveTwoFollowup.answer).not.toMatch(/Gelombang III|mohon informasi lebih lanjut/i);

    const infoWaveTwo = await querySemanticRag('info pendaftaran gelombang 2');
    expect(infoWaveTwo.source).toBe('semantic-rag-schedule-window');
    expect(infoWaveTwo.answer).toMatch(/Jadwal pendaftaran Gelombang II/i);
    expect(infoWaveTwo.answer).not.toMatch(/Biaya Pendaftaran|Rp\.?\s*\d/i);
  });

  test('answers PMB still-open and registration follow-up directly', async () => {
    process.env.SEMANTIC_RAG_TODAY_YMD = '2026-07-07';
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    const pmbOpen = await querySemanticRag('Selamat malam saya ingin menanyakan terkait penerimaan mahasiswa baru apakah masih dibuka?');
    expect(pmbOpen.success).toBe(true);
    expect(pmbOpen.source).toBe('semantic-rag-schedule-window');
    expect(pmbOpen.answer).toMatch(/PMB ITB STIKOM Bali masih dibuka/i);
    expect(pmbOpen.answer).toMatch(/Gelombang IV A/i);
    expect(pmbOpen.answer).toMatch(/https:\/\/siap.stikom-bali.ac.id/i);
    expect(pmbOpen.answer).not.toMatch(/PMB adalah singkatan|Dalam konteks PMB/i);

    const how = await querySemanticRag('Cara daftarnya bagaimana?');
    expect(how.success).toBe(true);
    expect(how.source).toBe('semantic-rag-registration-info');
    expect(how.answer).toMatch(/https:\/\/siap.stikom-bali.ac.id/i);
    expect(how.answer).toMatch(/Offline|datang langsung ke kampus/i);
    expect(how.answer).not.toMatch(/Gelombang Khusus: 28 Oktober 2025|testing dan menunggu pengumuman/i);
  });

  test('answers conversational registration and date-aware wave availability', async () => {
    process.env.SEMANTIC_RAG_TODAY_YMD = '2026-07-07';
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    const whereRegister = await querySemanticRag('dimana aku bisa daftar untuk kuliah di stikom?');
    expect(whereRegister.success).toBe(true);
    expect(whereRegister.source).toBe('semantic-rag-registration-info');
    expect(whereRegister.answer).toMatch(/https:\/\/siap.stikom-bali.ac.id/i);
    expect(whereRegister.answer).toMatch(/Offline|datang langsung ke kampus/i);
    expect(whereRegister.answer).not.toMatch(/Lokasi kampus|Kampus Denpasar\/Renon/i);

    const onlineRegister = await querySemanticRag('daftarnya online lewat mana kak?');
    expect(onlineRegister.source).toBe('semantic-rag-registration-info');
    expect(onlineRegister.answer).toMatch(/https:\/\/siap\.stikom-bali\.ac\.id/i);

    const waveOne = await querySemanticRag('aku mau daftar gelombang 1 apa masih buka');
    expect(waveOne.source).toBe('semantic-rag-schedule-window');
    expect(waveOne.answer).toMatch(/Gelombang I sudah tidak buka/i);
    expect(waveOne.answer).toMatch(/Gelombang IV A/i);

    const chooseToday = await querySemanticRag('jadi aku bisa pilih yang mana, sekarang kan tgl 7 juli');
    expect(chooseToday.source).toBe('semantic-rag-schedule-window');
    expect(chooseToday.answer).toMatch(/Per 7 Juli 2026/i);
    expect(chooseToday.answer).toMatch(/Gelombang IV A/i);
    expect(chooseToday.answer).not.toMatch(/Gelombang II C|tidak bisa mendaftar/i);

    const expiredWave = await querySemanticRag('oke, sekarang aku mau daftar gelombang 3 C apakah bisa? sedangkan sekarang tanggal 7 juli');
    expect(expiredWave.source).toBe('semantic-rag-schedule-window');
    expect(expiredWave.answer).toMatch(/Gelombang III C sudah tidak buka/i);
    expect(expiredWave.answer).toMatch(/4 Juli 2026/i);
  });

  test('answers special wave dates and UKT questions cleanly', async () => {
    process.env.SEMANTIC_RAG_TODAY_YMD = '2026-07-07';
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    const special = await querySemanticRag('gelombang khusus itu tanggal berapa?');
    expect(special.source).toBe('semantic-rag-schedule-window');
    expect(special.answer).toMatch(/28 Oktober 2025 - 27 Desember 2025/i);
    expect(special.answer).toMatch(/berlangsung sesuai tanggal di atas/i);
    expect(special.answer).not.toMatch(/terbagi menjadi beberapa periode/i);

    const uktSi = await querySemanticRag('UKT sistem informasi');
    expect(uktSi.source).toBe('semantic-rag-fee-detail');
    expect(uktSi.answer).toMatch(/Rp\. 6\.500\.000/i);
    expect(uktSi.answer).not.toMatch(/Rp\. 300\.000|Saya cekkan|Bisa, Kak/i);

    const correction = await querySemanticRag('kok aku bayar 6000000 untuk UKT sistem informasi ya?');
    expect(correction.source).toBe('semantic-rag-fee-detail');
    expect(correction.answer).toMatch(/Rp\. 6\.500\.000/i);
    expect(correction.answer).toMatch(/tagihan yang kakak lihat berbeda/i);
    expect(correction.answer).not.toMatch(/Terima kasih koreksinya/i);

    const feeComponents = await querySemanticRag('ada biaya apa aja kalau mau masuk?');
    expect(feeComponents.source).toBe('semantic-rag-fee-general');
    expect(feeComponents.answer).toMatch(/biaya pendaftaran, biaya awal masuk\/DPP, dan biaya pendidikan per semester/i);

    const registrationFee = await querySemanticRag('Biaya pendaftaran si berapa?', {
      programHint: 'Sistem Informasi, Sistem Komputer, Teknologi Informasi',
      sessionData: {
        messages: [
          { message: 'Untuk program S1 Sistem Informasi, Sistem Komputer, dan Teknologi Informasi. apa bedanya ya?' },
          { message: 'Biaya kuliah untuk ketiga program studi itu seperti apa ya?' }
        ]
      }
    });
    expect(registrationFee.source).toBe('semantic-rag-registration-fee');
    expect(registrationFee.answer).toMatch(/Biaya pendaftaran untuk Prodi Sistem Informasi: Rp\. 500\.000/i);
    expect(registrationFee.answer).toMatch(/Gelombang I: potongan Rp\. 250\.000, total Rp\. 250\.000/i);
    expect(registrationFee.answer).toMatch(/Gelombang IV: potongan Rp\. 100\.000, total Rp\. 400\.000/i);
    expect(registrationFee.answer).not.toMatch(/perbandingan harga|Sistem Komputer|undefined/i);

    const dnuiRegistration = await querySemanticRag('berapa biaya pendaftaran DNUI?');
    expect(dnuiRegistration.source).toBe('semantic-rag-registration-fee');
    expect(dnuiRegistration.answer).toMatch(/Double Degree DNUI: Rp\. 3\.000\.000/i);
    expect(dnuiRegistration.answer).toMatch(/Gelombang I: potongan Rp\. 1\.250\.000, total Rp\. 1\.750\.000/i);
    expect(dnuiRegistration.answer).not.toMatch(/Double Degree DNUI: Rp\. 500\.000/i);

    const helpRegistration = await querySemanticRag('berapa biaya pendaftaran HELP?');
    expect(helpRegistration.source).toBe('semantic-rag-registration-fee');
    expect(helpRegistration.answer).toMatch(/Double Degree HELP University: Rp\. 3\.000\.000/i);
    expect(helpRegistration.answer).toMatch(/Gelombang IV: potongan Rp\. 500\.000, total Rp\. 2\.500\.000/i);

    const dnuiComponent = await querySemanticRag('berapa biaya registrasi DNUI?');
    expect(dnuiComponent.source).toBe('semantic-rag-fee-detail');
    expect(dnuiComponent.answer).toContain('DPP): Rp. 20.000.000');
    expect(dnuiComponent.answer).toContain('Bahasa Mandarin: Rp. 5.000.000');

    const utbUkt = await querySemanticRag('UKT UTB berapa?');
    expect(utbUkt.source).toBe('semantic-rag-fee-detail');
    expect(utbUkt.answer).toMatch(/biaya pendidikan per semester untuk Prodi Double Degree UTB: Rp\. 7\.500\.000/i);
    expect(utbUkt.answer).toContain('Khusus Alumni SMK TI Bali Global dan SMK Pandawa Bali Global: Rp. 6.500.000 per semester');
    expect(utbUkt.answer).not.toContain('Sistem Informasi (S1): Rp. 6.500.000/semester');

    const s2Registration = await querySemanticRag('berapa biaya pendaftaran S2?');
    expect(s2Registration.source).toBe('semantic-rag-registration-fee');
    expect(s2Registration.answer).toContain('S2 Sistem Informasi: Rp. 700.000');
    expect(s2Registration.answer).toContain('Gelombang I: potongan Rp. 200.000, total Rp. 500.000');

    const s2Detail = await querySemanticRag('rincian biaya S2');
    expect(s2Detail.source).toBe('semantic-rag-fee-detail');
    expect(s2Detail.answer).toContain('Biaya pendidikan per semester (UKT): Rp. 10.000.000');
    expect(s2Detail.answer).toContain('Pembayaran lunas selama 2 tahun: Rp. 40.000.000');

    const fullDetailWithUkt = await querySemanticRag('rincian biaya teknologi informasi gelombang 1A, termasuk UKT per semester');
    expect(fullDetailWithUkt.source).toBe('semantic-rag-fee-detail');
    expect(fullDetailWithUkt.answer).toContain('Pendaftaran:');
    expect(fullDetailWithUkt.answer).toContain('Biaya awal masuk untuk Prodi Teknologi Informasi:');
    expect(fullDetailWithUkt.answer).toContain('Biaya pendidikan per semester (UKT): Rp. 6.500.000');
    expect(fullDetailWithUkt.answer).not.toMatch(/UKT.*saja|khusus UKT/i);

    const sisipanDetail = await querySemanticRag('rincian biaya SI gelombang sisipan');
    expect(sisipanDetail.source).toBe('semantic-rag-fee-detail');
    expect(sisipanDetail.answer).toContain('Gelombang Sisipan');
    expect(sisipanDetail.answer).toContain('Total awal masuk setelah potongan (Gelombang Sisipan): Rp. 16.000.000');
  });

  test('answers short program definition before runtime index fallback', async () => {
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    const result = await querySemanticRag('apa itu si?');
    expect(result.source).toBe('semantic-rag-program-definition');
    expect(result.answer).toMatch(/Sistem Informasi/i);
    expect(result.answer).not.toMatch(/belum bisa mengambil jawaban/i);
  });
  test('routes short program-wave detail questions to fee details, not schedule', async () => {
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
    process.env.SEMANTIC_RAG_TRAINING_DB_INDEX_CACHE_MS = '600000';
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    const shortDetail = await querySemanticRag('berapa rincian TI gelombang 3A?');
    expect(shortDetail.source).not.toBe('semantic-rag-schedule-window');
    expect(shortDetail.answer).toMatch(/Teknologi Informasi/i);
    expect(shortDetail.answer).toContain('Total biaya pendaftaran (Gelombang III A): Rp. 350.000');
    expect(shortDetail.answer).toContain('Total awal masuk setelah potongan (Gelombang III A): Rp. 14.850.000');
  }, 15000);
  test('answers informal STIKOM nickname and coding hobby naturally', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    const stikoman = await querySemanticRag('tau stikoman?');
    expect(stikoman.success).toBe(true);
    expect(stikoman.source).toBe('semantic-rag-small-talk');
    expect(stikoman.answer).toMatch(/sebutan informal/i);
    expect(stikoman.answer).not.toMatch(/Mohon berikan informasi lebih lanjut/i);

    const coding = await querySemanticRag('aku hobby ngoding');
    expect(coding.success).toBe(true);
    expect(coding.source).toBe('semantic-rag-program-recommendation');
    expect(coding.answer).toMatch(/Teknologi Informasi \(TI\)/i);
    expect(coding.answer).not.toMatch(/Program Studi Sistem Informasi bisa jadi pilihan yang tepat/i);
  });

  test('rejects medical out-of-domain questions instead of answering generally', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    const doctor = await querySemanticRag('aku mau jadi dokter bisa ga?');
    expect(doctor.success).toBe(true);
    expect(doctor.source).toBe('semantic-rag-out-of-domain');
    expect(doctor.answer).toMatch(/tidak memiliki program studi kedokteran/i);

    const healing = await querySemanticRag('cara menyembuhkan orang lain');
    expect(healing.source).toBe('semantic-rag-out-of-domain');
    expect(healing.answer).toMatch(/di luar konteks informasi kampus ITB STIKOM Bali/i);
  });


  test('answers PMB contact, requirements, KIP, and campus-specific address cleanly', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    const contact = await querySemanticRag('kontak admin PMB bisa kemana?');
    expect(contact.source).toBe('semantic-rag-pmb-contact');
    expect(contact.answer).toMatch(/https:\/\/siap\.stikom-bali\.ac\.id/i);
    expect(contact.answer).toMatch(/Hubungi Admin|datang langsung ke kampus/i);
    expect(contact.answer).not.toMatch(/Gelombang IV A|jadwal gelombang/i);

    const requirements = await querySemanticRag('syarat daftar mahasiswa baru apa saja?');
    expect(requirements.source).toBe('semantic-rag-pmb-requirements');
    expect(requirements.answer).toMatch(/syarat dan dokumen pendaftaran/i);
    expect(requirements.answer).toMatch(/https:\/\/siap\.stikom-bali\.ac\.id/i);
    expect(requirements.answer).not.toMatch(/^\./);

    const kip = await querySemanticRag('KIP tersedia nggak untuk camaba?');
    expect(kip.source).toBe('semantic-rag-scholarship');
    expect(kip.answer).toMatch(/Beasiswa KIP/i);
    expect(kip.answer).not.toMatch(/PMB adalah singkatan/i);
    const kipDefinition = await querySemanticRag('apa itu beasiswa KIP?');
    expect(kipDefinition.source).toBe('semantic-rag-scholarship');
    expect(kipDefinition.answer).toMatch(/Beasiswa KIP/i);
    expect(kipDefinition.answer).toMatch(/belum ada di data training/i);
    expect(kipDefinition.answer).not.toMatch(/Ya, ada beberapa pilihan beasiswa/i);

    const renon = await querySemanticRag('alamat kampus renon apa kak?');
    expect(renon.source).toBe('semantic-rag-campus-location');
    expect(renon.answer).toMatch(/Jl\. Raya Puputan No\. 86 Renon/i);
    expect(renon.answer).not.toMatch(/tidak memiliki informasi/i);
  });

  test('answers campus location and UKM list without blank semantic output', async () => {
    process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'true';
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    const location = await querySemanticRag('lokasi stikom dimana?');
    expect(location.success).toBe(true);
    expect(location.source).toBe('semantic-rag-campus-location');
    expect(location.answer).toMatch(/Denpasar\/Renon|Jimbaran|Abiansemal/i);
    expect(location.answer).not.toMatch(/Saya jawab sesuai data|Kesimpulannya|Kakak bisa lanjut tanya/i);

    const mainCampus = await querySemanticRag('kampus utama stikom dimana?');
    expect(mainCampus.success).toBe(true);
    expect(mainCampus.source).toBe('semantic-rag-campus-location');
    expect(mainCampus.answer).toContain('Kampus utama ITB STIKOM Bali berada di Denpasar/Renon');
    expect(mainCampus.answer).toMatch(/Jl. Raya Puputan No. 86 Renon/i);
    const mainCampusFollowUp = await querySemanticRag('kampus utama dimana?');
    expect(mainCampusFollowUp.success).toBe(true);
    expect(mainCampusFollowUp.source).toBe('semantic-rag-campus-location');
    expect(mainCampusFollowUp.answer).toContain('Kampus utama ITB STIKOM Bali berada di Denpasar/Renon');

    const facilities = await querySemanticRag('fasilitas kampus apa saja?');
    expect(facilities.success).toBe(true);
    expect(facilities.source).toBe('semantic-rag-campus-facility');
    expect(facilities.answer).toMatch(/Career Center|Inkubator Bisnis|Language Learning Center/i);
    expect(String(facilities.answer || '').trim()).not.toBe('');
    const hiThink = await querySemanticRag('apa itu program hi-think?');
    expect(hiThink.success).toBe(true);
    expect(hiThink.source).toBe('semantic-rag-campus-support-entity');
    expect(hiThink.answer).toMatch(/Hi-Think|Persiapan Bekerja di Bidang TI di Jepang/i);
    expect(hiThink.answer).not.toMatch(/Fasilitas dan program pendukung yang tersedia di ITB STIKOM Bali antara lain/i);

    const careerCenter = await querySemanticRag('career center layanan apa?');
    expect(careerCenter.success).toBe(true);
    expect(careerCenter.source).toBe('semantic-rag-campus-facility');
    expect(careerCenter.answer).toMatch(/Informasi lowongan kerja|konsultasi karier|dunia kerja/i);

    const orgStructure = await querySemanticRag('inkubator bisnis ini ada di bawah direktorat apa?');
    expect(orgStructure.success).toBe(true);
    expect(orgStructure.source).toBe('semantic-rag-org-structure-unavailable');
    expect(orgStructure.answer).toMatch(/belum menemukan data|belum tersedia/i);
    expect(orgStructure.answer).toMatch(/direktorat|divisi|bagian/i);
    expect(orgStructure.answer).not.toMatch(/Fasilitas dan program pendukung yang tersedia/i);
    const ukm = await querySemanticRag('ukm apa saja yang ada di stikom?');
    expect(ukm.success).toBe(true);
    expect(ukm.source).toBe('semantic-rag-ukm-list');
    expect(ukm.answer).toMatch(/UKM\/Ormawa/i);
    expect(ukm.answer).toMatch(/Badan Eksekutif Mahasiswa|Futsal|Mapala Kompas/i);
    expect(String(ukm.answer || '').trim()).not.toBe('');
    expect(ukm.answer).toMatch(/Kalau mau lanjut, kakak bisa tanya:\n- /);
    expect(ukm.answer).not.toMatch(/Kalau mau lanjut, kakak bisa tanya:\n\n-/);
  });

  test('recommends UKM based on student interests', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    const cases = [
      { q: 'Saya suka olahraga, UKM apa yang cocok?', must: /Futsal|Basket|Athena Esports/i },
      { q: 'Kalau suka fotografi dan video ada UKM yang cocok?', must: /Himatography|Multimedia/i },
      { q: 'Saya minat organisasi kampus, ikut UKM apa ya?', must: /Badan Eksekutif Mahasiswa|Dewan Perwakilan Mahasiswa|Himaprodi/i },
      { q: 'Kalau hobi musik dan teater UKM apa?', must: /Musik|Teater Biner|Tari|Tabuh/i },
      { q: 'Saya suka ngoding, komunitas atau UKM apa yang cocok?', must: /Syntax|Progress/i }
    ];

    for (const item of cases) {
      const result = await querySemanticRag(item.q);
      expect(result.success).toBe(true);
      expect(result.source).toBe('semantic-rag-ukm-list');
      expect(result.answer).toMatch(/UKM\/Ormawa yang paling relevan/i);
      expect(result.answer).toMatch(item.must);
      expect(result.answer).toMatch(/konfirmasi ke bagian kemahasiswaan|pengurus UKM/i);
    }
  });

  test('answers data-analysis career recommendation as recommendation, not program list', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    const result = await querySemanticRag('Kalau saya ingin nanti bekerja di perusahaan yang bisa mengolah data dan menganalisa data, sebaiknya saya mengambil jurusan yang mana ya?');

    expect(result.success).toBe(true);
    expect(result.source).toBe('semantic-rag-program-recommendation');
    expect(result.answer).toMatch(/memilih jurusan|rekomendasi|Pilihan utama/i);
    expect(result.answer).toMatch(/Pilihan utama.*Sistem Informasi \(SI\)/s);
    expect(result.answer).toMatch(/Teknologi Informasi \(TI\).*teknis/s);
    expect(result.answer).not.toMatch(/daftar jurusan\/program studi/i);
    expect(result.answer).not.toMatch(/Jadi, pilihan programnya mencakup S2, S1, D3, dan Double Degree/i);
  });

  test('answers Bisnis Digital data analyst suitability follow-up specifically', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    for (const q of [
      'Saya menanyakan apakah data analis tidak cocok kalau saya ambil Bisnis Digital?',
      'Kalau sy ingin jadi data analis apakah jurusan binis digital bisa?',
      'Kalau sy pilih bisnis digital, apakah bs menjadi data analis?'
    ]) {
      const result = await querySemanticRag(q);
      expect(result.success).toBe(true);
      expect(result.source).toBe('semantic-rag-program-recommendation');
      expect(result.answer).toMatch(/Bisnis Digital.*bisa cocok/i);
      expect(result.answer).toMatch(/data bisnis|pemasaran digital|e-commerce/i);
      expect(result.answer).toMatch(/Sistem Informasi \(SI\)|SI lebih/i);
      expect(result.answer).not.toMatch(/^Pilihan utama yang paling cocok adalah Sistem Informasi \(SI\)\./i);
    }
  });

  test('answers Bisnis Digital outcome follow-up as career prospects', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    const result = await querySemanticRag('Oh begitu, berarti kalau jurusan bisnis digital cocoknya jadi apa nantinya?');

    expect(result.success).toBe(true);
    expect(result.source).toBe('semantic-rag-program-recommendation');
    expect(result.answer).toMatch(/Prospek kerja lulusan Bisnis Digital/i);
    expect(result.answer).toMatch(/Digital Marketing|E-commerce|Product Manager|Business Analyst|Market Analyst/i);
    expect(result.answer).not.toMatch(/^Pilihan utama yang paling cocok adalah Bisnis Digital/i);
  });

  test('answers varied program-career suitability questions through semantic route', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    const cases = [
      {
        q: 'Kalau saya ambil SI bisa jadi backend developer tidak?',
        must: [/Sistem Informasi.*bisa cocok|Sistem Informasi tetap bisa cocok/i, /Teknologi Informasi \(TI\)/i]
      },
      {
        q: 'Apakah Sistem Komputer cocok untuk digital marketing?',
        must: [/Sistem Komputer kurang cocok sebagai jalur utama/i, /Bisnis Digital \(BD\)/i]
      },
      {
        q: 'BD cocok nggak kalau saya pengen kerja di cyber security?',
        must: [/Bisnis Digital kurang cocok sebagai jalur utama/i, /Teknologi Informasi \(TI\)/i]
      }
    ];

    for (const item of cases) {
      const result = await querySemanticRag(item.q);
      expect(result.success).toBe(true);
      expect(result.source).toBe('semantic-rag-program-recommendation');
      for (const re of item.must) expect(result.answer).toMatch(re);
    }
  });

  test('rejects outside-campus program questions and unsupported D2 without framing', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    const outside = await querySemanticRag('Saya ingin tahu jurusan apa saja yang ada di universitas udayana');
    expect(outside.success).toBe(true);
    expect(outside.source).toBe('semantic-rag-out-of-domain');
    expect(outside.answer).toMatch(/hanya bisa berdiskusi tentang ITB STIKOM Bali/i);
    expect(outside.answer).not.toMatch(/Saya tangkap|Kesimpulannya|Kakak bisa lanjut tanya/i);

    const outsideUi = await querySemanticRag('Apa saja prodi di Universitas Indonesia?');
    expect(outsideUi.success).toBe(true);
    expect(outsideUi.source).toBe('semantic-rag-out-of-domain');
    expect(outsideUi.answer).toMatch(/hanya bisa berdiskusi tentang ITB STIKOM Bali/i);

    const outsidePnb = await querySemanticRag('Biaya kuliah di Politeknik Negeri Bali berapa?');
    expect(outsidePnb.success).toBe(true);
    expect(outsidePnb.source).toBe('semantic-rag-out-of-domain');
    expect(outsidePnb.answer).toMatch(/hanya bisa berdiskusi tentang ITB STIKOM Bali/i);

    const d2 = await querySemanticRag('D2 itu maksudnya program apa ya?');
    expect(d2.success).toBe(true);
    expect(d2.source).toBe('semantic-rag-unsupported-program');
    expect(d2.answer).toMatch(/tidak memiliki program D2/i);
    expect(d2.answer).toMatch(/D3 Manajemen Informatika/i);
  });

  test('answers Double Degree mapped programs and avoids partner-major hallucination', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    const utbSide = await querySemanticRag('Kalau UTB diambil DKV, di stikom bali jurusan yang diambil apa?');
    expect(utbSide.success).toBe(true);
    expect(utbSide.source).toBe('semantic-rag-dual-degree');
    expect(utbSide.answer).toMatch(/Prodi di ITB STIKOM Bali: Bisnis Digital/i);
    expect(utbSide.answer).toMatch(/Jurusan di UTB: DKV \(Desain Komunikasi Visual\)/i);
    expect(utbSide.answer).not.toMatch(/S2 (Pascasarjana)|S1 (Sarjana)/i);

    const allPairs = await querySemanticRag('Kalau double degree yang lain jurusan apa dan jurusan apa ya?');
    expect(allPairs.success).toBe(true);
    expect(allPairs.source).toBe('semantic-rag-dual-degree');
    expect(allPairs.answer).toMatch(/UTB.*Bisnis Digital.*DKV/s);
    expect(allPairs.answer).toMatch(/DNUI.*Bisnis Digital.*belum tercantum/s);
    expect(allPairs.answer).toMatch(/HELP.*Sistem Informasi.*belum tercantum/s);
  });

  test('answers short Double Degree international follow-up from conversation context', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    const result = await querySemanticRag('Internasional', {
      sessionData: {
        messages: [
          { direction: 'user', message: 'Apakah ada program double degree di stikom ?' },
          { direction: 'bot', message: 'Ya, di STIKOM Bali ada program double degree, baik nasional maupun internasional.' }
        ]
      }
    });

    expect(result.success).toBe(true);
    expect(result.source).toBe('semantic-rag-dual-degree-followup');
    expect(result.answer).toMatch(/Double Degree internasional/i);
    expect(result.answer).toMatch(/DNUI/i);
    expect(result.answer).toMatch(/HELP/i);
    expect(result.answer).not.toMatch(/S1 \(Sarjana\)|S2 \(Pascasarjana\)|D3 \(Diploma\)/i);
  });
  test('answers short double degree nationality questions directly', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    const international = await querySemanticRag('Apakah ada program double degree internasional?');
    expect(international.success).toBe(true);
    expect(international.source).toBe('semantic-rag-dual-degree');
    expect(international.answer).toMatch(/Ya, ada program Double Degree internasional/i);
    expect(international.answer).toMatch(/DNUI/i);
    expect(international.answer).toMatch(/HELP/i);
    expect(international.answer).not.toMatch(/Double Degree tambahan|UTB - Universitas Teknologi Bandung/i);

    const national = await querySemanticRag('Apa ada program double degree nasional?');
    expect(national.success).toBe(true);
    expect(national.source).toBe('semantic-rag-dual-degree');
    expect(national.answer).toMatch(/Ya, ada program Double Degree nasional/i);
    expect(national.answer).toMatch(/UTB/i);
    expect(national.answer).not.toMatch(/Double Degree tambahan|DNUI|HELP University/i);
  }, 15000);

  test('answers UTB double degree major specifically', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    const result = await querySemanticRag('Yang saya tanya Double Degree dengan UTB, di UTB nya itu mengambil jurusan apa?');
    expect(result.success).toBe(true);
    expect(result.source).toBe('semantic-rag-dual-degree');
    expect(result.answer).toMatch(/DKV \(Desain Komunikasi Visual\)/i);
    expect(result.answer).not.toMatch(/daftar jurusan\/program studi/i);
  });

  test('answers program difference and contextual fee follow-up without OpenAI', async () => {
    jest.dontMock('../src/engine/ragEngine');
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    const q1 = 'Untuk program S1 Sistem infomrasi, sistem komputer, dan teknologi informasi. apa bedanya ya?';
    const first = await querySemanticRag(q1);

    expect(first.success).toBe(true);
    expect(first.source).toBe('semantic-rag-program-comparison');
    expect(first.answer).toMatch(/Sistem Informasi \(SI\)/);
    expect(first.answer).toMatch(/Sistem Komputer \(SK\)/);
    expect(first.answer).toMatch(/Teknologi Informasi \(TI\)/);

    const second = await querySemanticRag('Biaya kuliah untuk ketiga program studi itu seperti apa ya?', {
      sessionData: {
        messages: [
          { direction: 'user', message: q1 },
          { direction: 'bot', message: first.answer }
        ]
      },
      programHint: 'Sistem Informasi, Sistem Komputer, Teknologi Informasi',
      intentHint: 'Perbandingan biaya tiga prodi S1 yang baru disebut user'
    });

    expect(second.success).toBe(true);
    expect(second.source).toBe('semantic-rag-contextual-fee');
    expect(second.answer).toMatch(/Sistem Informasi \(S1\).*Rp\. 16\.000\.000/s);
    expect(second.answer).toMatch(/Sistem Komputer \(S1\).*Rp\. 13\.000\.000/s);
    expect(second.answer).toMatch(/Teknologi Informasi \(S1\).*Rp\. 16\.000\.000/s);
  });

  test('answers explicit price comparison and short price follow-up as fees, not program content', async () => {
    jest.dontMock('../src/engine/ragEngine');
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    const priceQuestion = 'Kalau perbandingan harga antara S1 Sistem Informasi, Sistem Komputer, dan Teknologi Informasi itu seperti apa ya?';
    const first = await querySemanticRag(priceQuestion);

    expect(first.success).toBe(true);
    expect(first.source).toBe('semantic-rag-contextual-fee');
    expect(first.answer).toMatch(/Sistem Informasi \(S1\).*Rp\. 16\.000\.000/s);
    expect(first.answer).toMatch(/Sistem Komputer \(S1\).*Rp\. 13\.000\.000/s);
    expect(first.answer).toMatch(/Teknologi Informasi \(S1\).*Rp\. 16\.000\.000/s);
    expect(first.answer).not.toMatch(/fokus belajar|Arah karier/i);

    const followUp = await querySemanticRag('Baik saya tunggu perbandingan harganya ya', {
      sessionData: {
        messages: [
          { direction: 'user', message: priceQuestion },
          { direction: 'bot', message: first.answer },
          { direction: 'user', message: 'Saya menanyakan perbedaan harga, bukan perbedaan isi program' }
        ]
      }
    });

    expect(followUp.success).toBe(true);
    expect(followUp.source).toBe('semantic-rag-contextual-fee');
    expect(followUp.answer).toMatch(/Sistem Informasi \(S1\).*Rp\. 16\.000\.000/s);
    expect(followUp.answer).toMatch(/Sistem Komputer \(S1\).*Rp\. 13\.000\.000/s);
    expect(followUp.answer).toMatch(/Teknologi Informasi \(S1\).*Rp\. 16\.000\.000/s);
    expect(followUp.answer).not.toMatch(/butuh (?:rincian|informasi) lebih lanjut|fokus belajar|Arah karier/i);
  });

  test('answers broad PMB question with definition and available PMB topics', async () => {
    jest.dontMock('../src/engine/ragEngine');
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    const result = await querySemanticRag('saya ingin bertanya tentang pmb');

    expect(result.success).toBe(true);
    expect(result.source).toBe('semantic-rag-pmb-info');
    expect(result.answer).toMatch(/PMB adalah singkatan dari Penerimaan Mahasiswa Baru/i);
    expect(result.answer).toMatch(/Pendaftaran/i);
    expect(result.answer).toMatch(/Jadwal pendaftaran/i);
    expect(result.answer).toMatch(/Rincian biaya/i);
    expect(result.answer).toMatch(/Beasiswa/i);
    expect(result.answer).not.toMatch(/Saya tangkap|Kesimpulannya|Kakak bisa lanjut tanya/i);
  });

  test('falls back to deterministic PMB answer when AI intent is unknown', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    jest.dontMock('../src/engine/ragEngine');

    const createMock = jest.fn().mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              canonicalQuestion: 'Apa itu PMB?',
              searchQueries: ['apa itu pmb'],
              intent: 'unknown',
              entities: {},
              confidence: 0.1,
              needsClarification: false,
              clarificationQuestion: ''
            })
          }
        }
      ]
    });

    jest.doMock('openai', () => ({
      OpenAI: jest.fn().mockImplementation(() => ({
        chat: { completions: { create: createMock } }
      }))
    }));

    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    const result = await querySemanticRag('Apa itu pmb?');

    expect(result.success).toBe(true);
    expect(result.source).toBe('semantic-rag-pmb-info');
    expect(result.answer).toMatch(/PMB adalah singkatan dari Penerimaan Mahasiswa Baru/i);
    expect(createMock).toHaveBeenCalledTimes(2);
  });
  test('does not hijack specific PMB schedule question with broad PMB overview', async () => {
    jest.dontMock('../src/engine/ragEngine');
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    const result = await querySemanticRag('jadwal PMB gelombang 2C?');

    expect(result.source).not.toBe('semantic-rag-pmb-info');
  }, 15000);

  test('filters FAQ/QNA chunk to the matching answer only for training-specific questions', async () => {
    jest.doMock('../src/engine/ragEngine', () => ({
      loadIndex: jest.fn(() => [
        {
          id: 'faq-student-exchange',
          chunk: 'FAQ International Office\nApa itu Student Exchange di ITB STIKOM Bali? Student Exchange adalah program pertukaran mahasiswa yang memberikan kesempatan kepada mahasiswa ITB STIKOM Bali untuk belajar di kampus luar negeri dalam periode tertentu, sekaligus mendapatkan pengalaman akademik dan budaya internasional. Apa tujuan dari program Student Exchange? Program ini bertujuan untuk memberikan pengalaman belajar di lingkungan internasional, meningkatkan kemampuan bahasa asing, dan membangun jaringan internasional. Apa saja syarat untuk mengikuti Student Exchange? Persyaratan umum meliputi mahasiswa aktif ITB STIKOM Bali, IPK sesuai ketentuan, kemampuan bahasa asing, serta lolos seleksi administrasi dan wawancara.',
          filename: 'faq-student-exchange.pdf',
          source: 'upload',
          trainingId: 'training-student-exchange',
          embedding: [1, 0, 0]
        }
      ]),
      computeEmbedding: jest.fn(async () => [1, 0, 0]),
      cleanAnswerLanguage: jest.fn((text) => String(text || '').trim())
    }));

    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    const result = await querySemanticRag('Apa itu Student Exchange di ITB STIKOM Bali?', { topK: 5 });

    expect(result.success).toBe(true);
    expect(result.source).toBe('semantic-rag-campus-support-entity');
    expect(result.answer).toMatch(/Student Exchange adalah program pertukaran mahasiswa/i);
    expect(result.answer).not.toMatch(/Apa tujuan dari program Student Exchange/i);
    expect(result.answer).not.toMatch(/Apa saja syarat untuk mengikuti Student Exchange/i);
  });
  test('rewrites informal user question and answers from retrieved training context', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.SEMANTIC_RAG_MIN_SCORE = '0.01';

    jest.doMock('../src/engine/ragEngine', () => ({
      loadIndex: jest.fn(() => [
        {
          id: 'fee-ti',
          chunk: 'Program Studi Teknologi Informasi memiliki biaya pendaftaran Rp 500.000.',
          filename: 'biaya-ti.pdf',
          trainingId: 'training-1',
          embedding: [1, 0, 0]
        }
      ]),
      computeEmbedding: jest.fn(async () => [1, 0, 0]),
      cleanAnswerLanguage: jest.fn((text) => String(text || '').trim())
    }));

    const createMock = jest.fn()
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                canonicalQuestion: 'Berapa biaya pendaftaran Teknologi Informasi?',
                searchQueries: ['biaya pendaftaran Teknologi Informasi', 'biaya TI'],
                needsClarification: false,
                clarificationQuestion: ''
              })
            }
          }
        ]
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: 'Biaya pendaftaran Teknologi Informasi adalah Rp 500.000.'
            }
          }
        ]
      });

    jest.doMock('openai', () => ({
      OpenAI: jest.fn().mockImplementation(() => ({
        chat: {
          completions: {
            create: createMock
          }
        }
      }))
    }));

    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    const result = await querySemanticRag('min TI brp daftar?', { topK: 1 });

    expect(result.success).toBe(true);
    expect(result.source).toBe('semantic-rag');
    expect(result.answer).toContain('Rp 500.000');
    expect(result.contexts).toHaveLength(1);
    expect(createMock).toHaveBeenCalledTimes(2);
  });
  test('answers Double Degree FAQ from retrieved training answer only', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.SEMANTIC_RAG_MIN_SCORE = '0.01';
    process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';

    jest.doMock('../src/engine/ragEngine', () => ({
      loadIndex: jest.fn(() => [
        {
          id: 'faq-double-degree-utb',
          chunk: 'FAQ Double Degree\nTanya: Kalau UTB mengambil DKV, padanan jurusan di STIKOM Bali apa?\nJawab: Untuk Double Degree Nasional UTB, mahasiswa mengambil Bisnis Digital di ITB STIKOM Bali dan DKV atau Desain Komunikasi Visual di Universitas Teknologi Bandung.',
          filename: 'faq-double-degree.pdf',
          trainingId: 'training-faq-dd',
          embedding: [1, 0, 0]
        }
      ]),
      computeEmbedding: jest.fn(async () => [1, 0, 0]),
      cleanAnswerLanguage: jest.fn((text) => String(text || '').trim())
    }));

    const createMock = jest.fn()
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                canonicalQuestion: 'Padanan jurusan Double Degree UTB di STIKOM Bali',
                searchQueries: ['FAQ Double Degree UTB padanan jurusan STIKOM Bali DKV'],
                intent: 'dual_degree',
                entities: { partner: 'UTB', programs: ['Bisnis Digital'] },
                confidence: 0.96,
                needsClarification: false,
                clarificationQuestion: ''
              })
            }
          }
        ]
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: 'Untuk Double Degree Nasional UTB, padanan jurusan di ITB STIKOM Bali adalah Bisnis Digital. Sementara itu, di Universitas Teknologi Bandung mahasiswa mengambil DKV atau Desain Komunikasi Visual.'
            }
          }
        ]
      });

    jest.doMock('openai', () => ({
      OpenAI: jest.fn().mockImplementation(() => ({
        chat: {
          completions: {
            create: createMock
          }
        }
      }))
    }));

    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    const result = await querySemanticRag('Kalau UTB itu DKV, di STIKOM Bali jurusan padanannya apa?', { topK: 1 });

    expect(result.success).toBe(true);
    expect(result.source).toBe('semantic-rag');
    expect(result.answer).toMatch(/Bisnis Digital/i);
    expect(result.answer).toMatch(/DKV|Desain Komunikasi Visual/i);
    expect(result.answer).not.toMatch(/FAQ Double Degree|^Tanya:|Pertanyaan FAQ/im);
    expect(createMock).toHaveBeenCalledTimes(2);
    const answerPrompt = createMock.mock.calls[1][0].messages.map((m) => m.content).join('\n');
    expect(answerPrompt).toMatch(/berbentuk FAQ atau tanya-jawab/i);
  });
  test('routes AI-understood fee synonyms to precise deterministic fee handlers', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    jest.dontMock('../src/engine/ragEngine');

    const createMock = jest.fn()
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                canonicalQuestion: 'Berapa biaya pendaftaran Sistem Informasi?',
                searchQueries: ['biaya pendaftaran Sistem Informasi', 'pendaftaran SI'],
                intent: 'registration_fee',
                entities: { programs: ['Sistem Informasi'], fee_scope: 'pendaftaran' },
                confidence: 0.96,
                needsClarification: false,
                clarificationQuestion: ''
              })
            }
          }
        ]
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                canonicalQuestion: 'Perbandingan biaya Sistem Informasi dan Bisnis Digital',
                searchQueries: ['perbandingan biaya Sistem Informasi Bisnis Digital'],
                intent: 'fee_comparison',
                entities: { programs: ['Sistem Informasi', 'Bisnis Digital'], fee_scope: 'biaya kuliah' },
                confidence: 0.95,
                needsClarification: false,
                clarificationQuestion: ''
              })
            }
          }
        ]
      });

    jest.doMock('openai', () => ({
      OpenAI: jest.fn().mockImplementation(() => ({
        chat: {
          completions: {
            create: createMock
          }
        }
      }))
    }));

    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    const registration = await querySemanticRag('ongkos daftar SI kena berapa?');
    expect(registration.success).toBe(true);
    expect(registration.source).toBe('semantic-rag-registration-fee');
    expect(registration.answer).toMatch(/Biaya pendaftaran untuk Prodi Sistem Informasi: Rp\. 500\.000/i);
    expect(registration.answer).not.toMatch(/perbandingan harga|Sistem Komputer|Bisnis Digital/i);

    const comparison = await querySemanticRag('boleh bandingin tarif SI sama BD?');
    expect(comparison.success).toBe(true);
    expect(comparison.source).toBe('semantic-rag-contextual-fee');
    expect(comparison.answer).toMatch(/Sistem Informasi \(S1\).*Rp\. 16\.000\.000/s);
    expect(comparison.answer).toMatch(/Bisnis Digital \(S1\).*Rp\. 16\.000\.000/s);
    expect(comparison.answer).not.toMatch(/fokus belajar|Arah karier/i);
    expect(createMock).toHaveBeenCalledTimes(2);
  });
  test('does not let AI fee intent hijack ambiguous program comparison without cost words', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    jest.dontMock('../src/engine/ragEngine');

    const createMock = jest.fn().mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              canonicalQuestion: 'Perbandingan biaya Sistem Informasi Sistem Komputer Teknologi Informasi',
              searchQueries: ['perbandingan biaya SI SK TI'],
              intent: 'fee_comparison',
              entities: { programs: ['Sistem Informasi', 'Sistem Komputer', 'Teknologi Informasi'] },
              confidence: 0.95,
              needsClarification: false,
              clarificationQuestion: ''
            })
          }
        }
      ]
    });

    jest.doMock('openai', () => ({
      OpenAI: jest.fn().mockImplementation(() => ({
        chat: {
          completions: {
            create: createMock
          }
        }
      }))
    }));

    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    const result = await querySemanticRag('Kalau perbandingan antara S1 Sistem Informasi, Sistem Komputer, dan Teknologi Informasi itu seperti apa ya?');

    expect(result.success).toBe(true);
    expect(result.source).toBe('semantic-rag-program-comparison');
    expect(result.answer).toMatch(/Sistem Informasi \(SI\)/);
    expect(result.answer).toMatch(/Sistem Komputer \(SK\)/);
    expect(result.answer).toMatch(/Teknologi Informasi \(TI\)/);
    expect(result.answer).not.toMatch(/biaya awal masuk|Rp\. 16\.000\.000|Rp\. 13\.000\.000/i);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  test('answers student activity and arts UKM questions before training-specific routing', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    const activities = await querySemanticRag('Oke, sy mau nanya tentang kegiatan mahasiswa di stikom. Di stikom ada kegiatan mahasiswa jenis apa saja?');
    expect(activities.success).toBe(true);
    expect(activities.source).toBe('semantic-rag-ukm-list');
    expect(activities.answer).toMatch(/UKM\/Ormawa/i);
    expect(activities.answer).toMatch(/Badan Eksekutif Mahasiswa|Athena Esports|Musik/i);
    expect(activities.answer).not.toMatch(/GCCP|Student Exchange|China Thailand Malaysia Philippines/i);

    const arts = await querySemanticRag('Untuk kegiatan di bidang seni, ada apa saja?', {
      sessionData: {
        messages: [
          { direction: 'user', message: 'Di STIKOM ada kegiatan mahasiswa jenis apa saja?' },
          { direction: 'bot', message: 'Ada 32 UKM/Ormawa yang tercatat di ITB STIKOM Bali.' }
        ]
      }
    });
    expect(arts.source).toBe('semantic-rag-ukm-list');
    expect(arts.answer).toMatch(/Untuk minat seni/i);
    expect(arts.answer).toMatch(/Musik/i);
    expect(arts.answer).toMatch(/Tari/i);
    expect(arts.answer).toMatch(/Tabuh/i);
    expect(arts.answer).toMatch(/Teater Biner/i);
    expect(arts.answer).toMatch(/Vos/i);
    expect(arts.answer).not.toMatch(/Badan Eksekutif Mahasiswa|Himaprodi/i);
  });
  test('answers specific UKM detail requests with insufficient-data message instead of generic UKM list', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    const result = await querySemanticRag('Apa saja program kerja dari UKM Vos?');
    const reversed = await querySemanticRag('Vos itu apa ya?');

    expect(result.success).toBe(true);
    expect(result.answer).toMatch(/belum punya informasi detail tentang kegiatan atau program kerja UKM Vos/i);
    expect(result.answer).not.toMatch(/Ada 32 UKM|Badan Eksekutif Mahasiswa|Dewan Perwakilan Mahasiswa/i);
    expect(result.answer).not.toMatch(/Kalau yang kakak cari kegiatan mahasiswa, daftar UKM/i);
    expect(reversed.answer).toMatch(/belum punya informasi detail tentang kegiatan atau program kerja UKM Vos/i);
    expect(reversed.answer).not.toMatch(/Sistem Komputer|Ada 32 UKM/i);
  });

  test('does not reroute LinkedIn Career Center registration to PMB registration', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';

    jest.doMock('../src/engine/ragEngine', () => ({
      loadIndex: jest.fn(() => []),
      computeEmbedding: jest.fn(async () => []),
      cleanAnswerLanguage: jest.fn((text) => String(text || '').trim())
    }));

    const createMock = jest.fn().mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              canonicalQuestion: 'Cara mendaftar program LinkedIn di Career Center',
              searchQueries: ['program LinkedIn Career Center pendaftaran'],
              intent: 'registration_how',
              entities: { program: 'LinkedIn Career Center' },
              confidence: 0.94,
              needsClarification: false,
              clarificationQuestion: ''
            })
          }
        }
      ]
    });

    jest.doMock('openai', () => ({
      OpenAI: jest.fn().mockImplementation(() => ({
        chat: { completions: { create: createMock } }
      }))
    }));

    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    const result = await querySemanticRag('Apa yang harus saya lakukan untuk mendaftar program LinkedIn di Career Center?');

    expect(result.success).toBe(true);
    expect(result.source).toBe('semantic-rag-campus-support-entity');
    expect(result.answer).toMatch(/belum.*detail|belum.*memastikan|data yang tersedia/i);
    expect(result.answer).not.toMatch(/fasilitas kampus|layanan karier|Kalau mau lanjut/i);
    expect(result.answer).not.toMatch(/siap\.stikom-bali\.ac\.id|daftar kuliah|datang langsung ke kampus/i);
    expect(createMock).not.toHaveBeenCalled();
  });

  test('does not answer unavailable international-program variants with the generic program list', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';

    jest.doMock('../src/engine/ragEngine', () => ({
      loadIndex: jest.fn(() => []),
      computeEmbedding: jest.fn(async () => []),
      cleanAnswerLanguage: jest.fn((text) => String(text || '').trim())
    }));

    const createMock = jest.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              canonicalQuestion: 'Apakah ada program short course atau student exchange?',
              searchQueries: ['short course student exchange international program'],
              intent: 'program_list',
              entities: {},
              confidence: 0.9,
              needsClarification: false,
              clarificationQuestion: ''
            })
          }
        }
      ]
    });

    jest.doMock('openai', () => ({
      OpenAI: jest.fn().mockImplementation(() => ({
        chat: { completions: { create: createMock } }
      }))
    }));

    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    const result = await querySemanticRag('Short course ada? Students exchange? Program BCCP ada?');

    expect(result.success).toBe(true);
    expect(result.source).toBe('semantic-rag-campus-support-entity');
    expect(result.answer).toMatch(/belum.*detail|belum.*memastikan|data yang tersedia/i);
    expect(result.answer).not.toMatch(/S1 \(Sarjana\)|S2 \(Pascasarjana\)|D3 \(Diploma\)/i);
  });

  test('keeps campus support program follow-ups on the same entity instead of PMB or program-list', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';

    const linkedinQuestion = 'Boleh tahu tentang program LinkedIn di Career Center ya?';
    const first = await querySemanticRag(linkedinQuestion);
    expect(first.success).toBe(true);
    expect(first.source).toBe('semantic-rag-campus-support-entity');
    expect(first.answer).toMatch(/Mohon maaf, saya kemungkinan tidak mempunyai jawaban yang mencukupi/i);
    expect(first.answer).not.toMatch(/siap\.stikom-bali\.ac\.id|daftar kuliah|S1 \(Sarjana\)|D3 \(Diploma\)/i);

    const followUp = await querySemanticRag('kamu punya informasi lebih detailnya untuk saya bisa mendaftar?', {
      sessionData: {
        messages: [
          { direction: 'user', message: linkedinQuestion },
          { direction: 'bot', message: first.answer }
        ]
      }
    });
    expect(followUp.success).toBe(true);
    expect(followUp.source).toBe('semantic-rag-campus-support-entity');
    expect(followUp.answer).toMatch(/Mohon maaf, saya kemungkinan tidak mempunyai jawaban yang mencukupi/i);
    expect(followUp.answer).not.toMatch(/siap\.stikom-bali\.ac\.id|daftar kuliah|S1 \(Sarjana\)|D3 \(Diploma\)/i);
  });

  test('does not answer campus support program variants with generic academic program list', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';

    for (const question of ['Apakah ada program BCCP?', 'Short course ada?', 'Students exchange?']) {
      const result = await querySemanticRag(question);
      expect(result.success).toBe(true);
      expect(result.source).toBe('semantic-rag-campus-support-entity');
      expect(result.answer).toMatch(/belum.*detail|belum.*memastikan|data yang tersedia/i);
      expect(result.answer).not.toMatch(/S1 \(Sarjana\)|S2 \(Pascasarjana\)|D3 \(Diploma\)|daftar jurusan\/program studi/i);
    }
  });

  test('keeps explicit new topics from being hijacked by previous campus-support context', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';

    const arts = await querySemanticRag('untuk kegiatan di bidang seni, ada apa saja?', {
      sessionData: {
        messages: [
          { direction: 'user', message: 'oke, saya mau nanya tentang kegiatan mahasiswa stkom. Di stikom ada kegiatan mahasiswa jenis apa saja?' },
          { direction: 'bot', message: 'Dalam GCCP, mahasiswa akan berinteraksi dengan mahasiswa internasional. Ke negara mana saja program Student Exchange tersedia?' }
        ]
      }
    });
    expect(arts.success).toBe(true);
    expect(arts.source).toBe('semantic-rag-ukm-list');
    expect(arts.answer).toMatch(/Musik|Tari|Tabuh|Teater Biner|Vos/i);
    expect(arts.answer).not.toMatch(/Mohon maaf, saya kemungkinan tidak mempunyai jawaban yang mencukupi|GCCP|Student Exchange/i);

    const vos = await querySemanticRag('vos itu apa ya?', {
      sessionData: {
        messages: [
          { direction: 'user', message: 'untuk kegiatan di bidang seni, ada apa saja?' },
          { direction: 'bot', message: arts.answer }
        ]
      }
    });
    expect(vos.success).toBe(true);
    expect(vos.source).toBe('semantic-rag-ukm-list');
    expect(vos.answer).toMatch(/UKM Vos/i);
    expect(vos.answer).not.toMatch(/Mohon maaf, saya kemungkinan tidak mempunyai jawaban yang mencukupi|Sistem Komputer/i);

    const doubleDegree = await querySemanticRag('apakah ada program double degree di stikom?', {
      sessionData: {
        messages: [
          { direction: 'user', message: 'boleh tau tentang program LinkedIn di Career center?' },
          { direction: 'bot', message: 'Mohon maaf, saya kemungkinan tidak mempunyai jawaban yang mencukupi.' }
        ]
      }
    });
    expect(doubleDegree.success).toBe(true);
    expect(doubleDegree.source).toBe('semantic-rag-dual-degree');
    expect(doubleDegree.answer).toMatch(/Double Degree/i);
    expect(doubleDegree.answer).not.toMatch(/Mohon maaf, saya kemungkinan tidak mempunyai jawaban yang mencukupi/i);

    const doubleDegreeAfterUkm = await querySemanticRag('apakah ada program double degree di stikom?', {
      sessionData: {
        messages: [
          { direction: 'user', message: 'vos itu apa ya?' },
          { direction: 'bot', message: 'Maaf, saya belum punya informasi detail tentang kegiatan atau program kerja UKM Vos.' }
        ]
      }
    });
    expect(doubleDegreeAfterUkm.success).toBe(true);
    expect(doubleDegreeAfterUkm.source).toBe('semantic-rag-dual-degree');
    expect(doubleDegreeAfterUkm.answer).toMatch(/Double Degree/i);
    expect(doubleDegreeAfterUkm.answer).not.toMatch(/UKM\/Ormawa|Ada 32 UKM/i);
  });

  test('merges Hi-Think answers from QNA and richer narrative chunks', async () => {
    jest.doMock('../src/engine/ragEngine', () => ({
      loadIndex: jest.fn(() => [
        {
          id: 'hi-think-qna',
          chunk: 'Apa itu Hi-Think? Hi-Think adalah Program Persiapan Bekerja di Bidang TI di Jepang.',
          filename: 'QNA Hi-Think.docx',
          source: 'upload',
          embedding: [1, 0, 0]
        },
        {
          id: 'hi-think-narasi',
          chunk: 'Narasi QNA Hi-Think. Hi-Think merupakan program pendampingan karier untuk mempersiapkan mahasiswa bekerja di bidang teknologi informasi di Jepang. Program ini membantu mahasiswa memahami budaya kerja Jepang, kesiapan bahasa, wawancara kerja, dan gambaran kompetensi industri TI yang dibutuhkan.',
          filename: 'Narasi QNA Hi-Think.docx',
          source: 'upload',
          embedding: [1, 0, 0]
        }
      ]),
      computeEmbedding: jest.fn(async () => [1, 0, 0]),
      cleanAnswerLanguage: jest.fn((text) => String(text || '').trim())
    }));

    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    const result = await querySemanticRag('apa itu hi-think?');

    expect(result.success).toBe(true);
    expect(result.source).toBe('semantic-rag-campus-support-entity');
    expect(result.answer).toMatch(/Program Persiapan Bekerja di Bidang TI di Jepang/i);
    expect(result.answer).toMatch(/budaya kerja Jepang|kesiapan bahasa|wawancara kerja|kompetensi industri TI/i);
    expect(result.answer).not.toMatch(/Mohon maaf, saya kemungkinan tidak mempunyai jawaban/i);
  });

  test('cleans raw Q/A markers from Hi-Think narrative answers', async () => {
    jest.doMock('../src/engine/ragEngine', () => ({
      loadIndex: jest.fn(() => [
        {
          id: 'hi-think-raw-qna',
          chunk: 'Q: Apa itu Program Hi-Think? A: Program Hi-Think adalah program kolaborasi antara ITB STIKOM Bali dengan perusahaan teknologi Hi-Think Jepang, yang menggabungkan perkuliahan dengan kurikulum industri teknologi Jepang serta peluang kerja setelah lulus. Q: Apakah program ini sulit? A: Program ini menantang karena berbasis industri, namun juga memberikan pengalaman dan peluang karier yang sangat besar.',
          filename: 'QNA Bot - Hi-Think.docx',
          source: 'upload',
          embedding: [1, 0, 0]
        },
        {
          id: 'hi-think-raw-narasi',
          chunk: 'Program studi terlihat: Program Hi-Think merupakan program kolaborasi antara ITB STIKOM Bali dengan perusahaan teknologi internasional Hi-Think Jepang yang dirancang untuk mengintegrasikan pembelajaran akademik dengan kebutuhan industri global. Program ini mengusung konsep project-based dan industry-oriented learning. A. PENDAHULUAN Q: Kapan saya bisa mengikuti program ini? A: Program ini dapat diikuti mulai Semester 5.',
          filename: 'Narasi QNA Bot - Hi-Think.docx',
          source: 'upload',
          embedding: [1, 0, 0]
        }
      ]),
      computeEmbedding: jest.fn(async () => [1, 0, 0]),
      cleanAnswerLanguage: jest.fn((text) => String(text || '').trim())
    }));

    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    const result = await querySemanticRag('Halo saya mau tahu program stikom yang nanya Hi-Think, itu program apa ya?');

    expect(result.success).toBe(true);
    expect(result.source).toBe('semantic-rag-campus-support-entity');
    expect(result.answer).toMatch(/Program Hi-Think adalah program kolaborasi/i);
    expect(result.answer).toMatch(/project-based dan industry-oriented learning/i);
    expect(result.answer).not.toMatch(/\bQ\s*:|\bA\s*:|Program studi terlihat|Apakah program ini sulit|Kapan saya bisa mengikuti/i);
  });
  test('does not let Student Exchange training chunks hijack broad student-activity questions', async () => {
    jest.doMock('../src/engine/ragEngine', () => ({
      loadIndex: jest.fn(() => [
        {
          id: 'student-exchange-prod-like',
          chunk: 'Apa itu Student Exchange di ITB STIKOM Bali? Student Exchange adalah program pertukaran mahasiswa. Dalam GCCP, mahasiswa akan berinteraksi dengan mahasiswa internasional dan mengikuti kegiatan akademik dan budaya.',
          filename: 'Apa itu Student Exchange di ITB STIKOM Bali.docx',
          source: 'upload',
          embedding: [1, 0, 0]
        }
      ]),
      computeEmbedding: jest.fn(async () => [1, 0, 0]),
      cleanAnswerLanguage: jest.fn((text) => String(text || '').trim())
    }));

    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    const result = await querySemanticRag('oke, saya mau nanya tentang kegiatan mahasiswa stkom. Di stikom ada kegiatan mahasiswa jenis apa saja?');

    expect(result.success).toBe(true);
    expect(result.source).toBe('semantic-rag-ukm-list');
    expect(result.answer).toMatch(/UKM\/Ormawa|Ada 32 UKM/i);
    expect(result.answer).not.toMatch(/Student Exchange|GCCP|berinteraksi dengan mahasiswa internasional/i);
  });

  test('answers typo Student Exchange from mixed international-program chunk without switching to GCCP', async () => {
    jest.doMock('../src/engine/ragEngine', () => ({
      loadIndex: jest.fn(() => [
        {
          id: 'mixed-student-exchange-gccp',
          chunk: 'Apa itu Student Exchange di ITB STIKOM Bali? Student Exchange adalah program pertukaran mahasiswa yang memberikan kesempatan kepada mahasiswa ITB STIKOM Bali untuk belajar di kampus luar negeri dalam periode tertentu, sekaligus mendapatkan pengalaman akademik dan budaya internasional. Apa tujuan dari program Student Exchange? Program ini bertujuan untuk memberikan pengalaman belajar di lingkungan internasional. Apa itu GCCP? Global Cross Cultural Program (GCCP) adalah program unggulan berbasis pertukaran budaya dan interaksi global.',
          filename: 'Apa itu Student Exchange di ITB STIKOM Bali.docx',
          source: 'upload',
          embedding: [1, 0, 0]
        }
      ]),
      computeEmbedding: jest.fn(async () => [1, 0, 0]),
      cleanAnswerLanguage: jest.fn((text) => String(text || '').trim())
    }));

    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    const result = await querySemanticRag('Apa itu studens exchange?');

    expect(result.success).toBe(true);
    expect(result.source).toBe('semantic-rag-campus-support-entity');
    expect(result.answer).toMatch(/Student Exchange adalah program pertukaran mahasiswa/i);
    expect(result.answer).not.toMatch(/^GCCP adalah|GCCP adalah salah satu program\/fasilitas/i);
    expect(result.answer).not.toMatch(/Global Cross Cultural Program \(GCCP\) adalah/i);
  });

  test('does not let prior UKM context hijack unrelated campus questions', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    const sessionData = {
      messages: [
        { message: 'ukm apa saja yang ada di stikom?' },
        { message: 'Loh kok terus jawab UKM ya?' }
      ]
    };

    const indicator = await querySemanticRag('Indikator apa saja yang dipertanggung jawabkan stikom bali sebagai institusi pendidikan ya?', { sessionData });
    expect(indicator.success).toBe(true);
    expect(indicator.source).not.toBe('semantic-rag-ukm-list');
    expect(indicator.answer || '').not.toMatch(/Ada 32 UKM|UKM\/Ormawa lainnya|Badan Eksekutif Mahasiswa/i);

    const industry = await querySemanticRag('Untuk inkubator bisnis stikom bali, apa saja yang menjadi layanannya?', { sessionData });
    expect(industry.success).toBe(true);
    expect(industry.source).not.toBe('semantic-rag-ukm-list');
    expect(industry.answer || '').not.toMatch(/Ada 32 UKM|UKM\/Ormawa lainnya|Badan Eksekutif Mahasiswa/i);
  });



  test('does not let prior double-degree context hijack explicit location questions', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    const sessionData = {
      messages: [
        { message: 'What double degree programs are available?' },
        { message: 'Double Degree HELP University and other partners are available.' }
      ]
    };

    const result = await querySemanticRag('Where is the campus location?', { sessionData });
    expect(result.success).toBe(true);
    expect(result.source).toBe('semantic-rag-campus-location');
    expect(result.answer).toMatch(/ITB STIKOM Bali campus locations|Denpasar\/Renon Campus/i);
    expect(result.answer).not.toMatch(/Double Degree HELP|DNUI|UTB - Universitas Teknologi Bandung/i);
  });  test('keeps English conversation language across short admission follow-ups', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    const sessionData = {
      messages: [
        { message: 'I am an international student, how do I apply for studying at stikom bali?' },
        { message: 'You can apply to ITB STIKOM Bali through the online or offline admission process.' }
      ]
    };

    const requirements = await querySemanticRag('And the requirements?', { sessionData });
    expect(requirements.success).toBe(true);
    expect(requirements.source).toBe('semantic-rag-pmb-requirements');
    expect(requirements.answer).toMatch(/I do not have a complete and final list of admission documents/i);
    expect(requirements.answer).not.toMatch(/Untuk syarat|Kakak/i);

    const fees = await querySemanticRag('And the HELP double degree fees?', { sessionData });
    expect(fees.success).toBe(true);
    expect(fees.source).toBe('semantic-rag-fee-detail');
    expect(fees.answer).toMatch(/Fee breakdown for Double Degree HELP University/i);
    expect(fees.answer).toMatch(/Application fee|Education & Exam Fee\/Subject/i);
    expect(fees.answer).not.toMatch(/^Baik|Untuk Double Degree, saya fokus|Kakak/i);
  });  test('answers English application question as registration info, not UKM', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    const result = await querySemanticRag('I am an international student, how do I apply for studying at stikom bali?', {
      sessionData: { messages: [{ message: 'ukm apa saja yang ada di stikom?' }] }
    });

    expect(result.success).toBe(true);
    expect(result.source).toBe('semantic-rag-registration-info');
    expect(result.answer).toMatch(/You can apply to ITB STIKOM Bali|Online application|international student/i);
    expect(result.answer).toMatch(/siap\.stikom-bali\.ac\.id/i);
    expect(result.answer).not.toMatch(/Ada 32 UKM|UKM\/Ormawa|Untuk daftar kuliah|Kakak/i);
  });
  test('does not answer layanan industri from GoesToSchool chunks even when metadata matches', async () => {
    jest.doMock('../src/engine/ragEngine', () => ({
      loadIndex: jest.fn(() => [
        {
          id: 'wrong-industry-meta',
          chunk: 'STIKOM Bali # GoesToSchool - Unlock Your Digital Potential. Program ini mendatangi sekolah dan membekali siswa SMA/SMK tentang teknologi informasi, bisnis digital, dan desain visual multimedia.',
          filename: 'Layanan Industri.docx',
          source: 'upload',
          trainingId: 'training-layanan-industri',
          embedding: [1, 0, 0]
        }
      ]),
      computeEmbedding: jest.fn(async () => [1, 0, 0]),
      cleanAnswerLanguage: jest.fn((value) => String(value || '').trim())
    }));

    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    const result = await querySemanticRag('Kami dari industri, di stikom itu ada layanan industri apa saja ya?', { topK: 5 });

    expect(result.success).toBe(true);
    expect(result.source).toMatch(/insufficient-data|campus-support-entity/i);
    expect(result.answer || '').not.toMatch(/GoesToSchool|Unlock Your Digital Potential|siswa SMA\/SMK/i);
  });

  test('answers student exchange program-list questions with program options, not only definition', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    const result = await querySemanticRag('Saya ingin ikut student exchange dengan stikom bali, di stikom bali ada program apa saja ya?');

    expect(result.success).toBe(true);
    expect(result.source).toBe('semantic-rag-campus-support-entity');
    expect(result.answer).toMatch(/Student Exchange/i);
    expect(result.answer).toMatch(/GCCP/i);
    expect(result.answer).toMatch(/BCCP/i);
    expect(result.answer).not.toMatch(/Student Exchange adalah program pertukaran mahasiswa/i);
  });
  test('answers Double Degree HELP fee directly without asking for prodi again', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    const result = await querySemanticRag('Berapa ya biaya kuliah untuk double degree stikom dengan help uni malaysia?');

    expect(result.success).toBe(true);
    expect(result.source).toBe('semantic-rag-fee-detail');
    expect(result.answer).toMatch(/Rincian biaya program Double Degree HELP University/i);
    expect(result.answer).toMatch(/Biaya pendaftaran: Rp\. 3\.000\.000/i);
    expect(result.answer).toMatch(/Biaya Pendidikan & Ujian\/Subject: Rp\. 3\.000\.000/i);
    expect(result.answer).not.toMatch(/perlu tahu prodi|sebutkan prodi/i);
  });
  test('regression: real chats stay on topic for UKM, language facility, BCCP, and mixed intent', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    const esport = await querySemanticRag('kalo esport apa ada ukmnya?');
    expect(esport.success).toBe(true);
    expect(esport.answer).toMatch(/Athena Esports/i);
    expect(esport.answer).toMatch(/UKM|Ormawa/i);
    expect(esport.answer).not.toMatch(/biaya kuliah|cicilan biaya|skema pembayaran|beasiswa atau potongan biaya/i);

    const mixedMusic = await querySemanticRag('aku suka musik nih, kamu suka ga? apa di stikom ada ukm musik?');
    expect(mixedMusic.success).toBe(true);
    expect(mixedMusic.source).toBe('semantic-rag-mixed-intent');
    expect(mixedMusic.answer).toMatch(/tidak punya selera pribadi|asisten/i);
    expect(mixedMusic.answer).toMatch(/Musik/i);
    expect(mixedMusic.answer).toMatch(/UKM|Ormawa/i);
    expect(mixedMusic.answer).not.toMatch(/biaya kuliah|Double Degree HELP|Student Exchange adalah/i);

    const language = await querySemanticRag('Baik, kalau mahasiswa ingin meningkatkan kemampuan bahasanya, apakah stikom mempunyai fasilitas untuk itu ya?');
    expect(language.success).toBe(true);
    expect(language.answer).toMatch(/Language Learning Center/i);
    expect(language.answer).not.toMatch(/PIHAK PERTAMA|Pasal 13|ADDENDUM|Double Degree HELP/i);

    const softskillCareer = await querySemanticRag('Oh belum punya informasinya ya. Kalau dalam pengembangan softskill, apa saja yang dilakukan oleh Career Center?');
    expect(softskillCareer.success).toBe(true);
    expect(softskillCareer.answer).toMatch(/softskill|Career Center/i);
    expect(softskillCareer.answer).toMatch(/belum.*rincian|belum.*lengkap|perlu dikonfirmasi/i);
    expect(softskillCareer.answer).not.toMatch(/^Mohon maaf, saya kemungkinan tidak mempunyai jawaban yang mencukupi/i);


    const gccp = await querySemanticRag('Oke baik, kalau program GCCP itu apa ya?');
    expect(gccp.success).toBe(true);
    expect(gccp.answer).toMatch(/GCCP/i);
    expect(gccp.answer).not.toMatch(/Apa itu Student Exchange|Student Exchange adalah program pertukaran mahasiswa/i);

    const bccpFollowUp = await querySemanticRag('apakah karena itu hanya untuk orang asing?', {
      sessionData: {
        messages: [
          { direction: 'user', message: 'Kalau program BCCP itu apa ya?' },
          { direction: 'assistant', message: 'Untuk BCCP, saya belum menemukan informasi di data yang tersedia.' }
        ]
      }
    });
    expect(bccpFollowUp.success).toBe(true);
    expect(bccpFollowUp.answer).toMatch(/Untuk BCCP|belum bisa memastikan/i);
    expect(bccpFollowUp.answer).toMatch(/mahasiswa asing|orang asing/i);
    const bccp = await querySemanticRag('Baik BCCP tidak ada informasinya, apakah karena itu hanya untuk orang asing?');
    expect(bccp.success).toBe(true);
    expect(bccp.answer).toMatch(/Untuk BCCP|belum menemukan informasi|belum bisa memastikan/i);
    expect(bccp.answer).toMatch(/mahasiswa asing|orang asing/i);
    expect(bccp.answer).not.toMatch(/Student Exchange adalah|Double Degree HELP|biaya kuliah/i);

    const siAfterBccp = await querySemanticRag('apa itu si?', {
      sessionData: {
        messages: [
          { direction: 'user', message: 'Kalau program BCCP itu apa ya?' },
          { direction: 'assistant', message: 'Untuk BCCP, saya belum menemukan informasi di data yang tersedia.' }
        ]
      }
    });
    expect(siAfterBccp.success).toBe(true);
    expect(siAfterBccp.answer).toMatch(/Sistem Informasi/i);
    expect(siAfterBccp.answer).not.toMatch(/Untuk BCCP|mahasiswa asing/i);
  });


  test('regression: generic fallback names the requested topic beyond hardcoded entities', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    const parking = await querySemanticRag('apakah parkiran motor buka malam?');
    expect(parking.success).toBe(true);
    expect(parking.answer).toMatch(/Untuk fasilitas kampus/i);
    expect(parking.answer).not.toMatch(/^Mohon maaf, saya kemungkinan tidak mempunyai jawaban yang mencukupi/i);

    const ukmDetail = await querySemanticRag('jadwal latihan UKM Musik kapan?');
    expect(ukmDetail.success).toBe(true);
    expect(ukmDetail.answer).toMatch(/UKM Musik|UKM atau Ormawa|belum punya informasi detail/i);
  });
  test('regression: compound and mixed multi-intent answers are combined without topic drift', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    const compound = await querySemanticRag('ada double degree apa saja dan fasilitas apa saja yang ada di kampus?');
    expect(compound.success).toBe(true);
    expect(compound.answer).toMatch(/Double Degree/i);
    expect(compound.answer).toMatch(/Fasilitas kampus/i);
    expect(compound.answer).toMatch(/Career Center|Language Learning Center/i);
    expect(compound.answer).not.toMatch(/biaya kuliah di ITB STIKOM Bali|Apakah ada beasiswa atau potongan biaya/i);

    const mixed = await querySemanticRag('halo, apa itu double degree dan fasilitas apa saja di kampus?');
    expect(mixed.success).toBe(true);
    expect(mixed.source).toBe('semantic-rag-mixed-intent');
    expect(mixed.answer).toMatch(/^Halo, Kak\./i);
    expect(mixed.answer).toMatch(/Double Degree/i);
    expect(mixed.answer).toMatch(/Fasilitas kampus/i);
    expect(mixed.answer).not.toMatch(/Double Degree tambahan/i);
  });

  test('answers a specific UKM profile from indexed training chunks before list fallback', async () => {
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
    process.env.SEMANTIC_RAG_SANITIZE_INDEX = 'false';
    jest.doMock('../src/engine/ragEngine', () => ({
      loadIndex: jest.fn(() => [
        {
          id: 'ukm-ksl-profile',
          chunk: 'Profil UKM KSL\nUKM KSL adalah unit kegiatan mahasiswa di ITB STIKOM Bali yang menjadi wadah kegiatan rohani dan pengembangan karakter mahasiswa. Kegiatan KSL meliputi pertemuan rutin, pembinaan, diskusi, dan kegiatan kebersamaan anggota. Profil ini menjelaskan tujuan dan aktivitas UKM KSL untuk mahasiswa.',
          filename: 'Profil UKM KSL.docx',
          source: 'upload',
          trainingId: 'training-ksl'
        }
      ]),
      computeEmbedding: jest.fn(async () => []),
      cleanAnswerLanguage: jest.fn((text) => String(text || '').trim())
    }));

    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    const result = await querySemanticRag('apa itu ukm ksl?');

    expect(result.success).toBe(true);
    expect(result.source).toBe('semantic-rag-ukm-list');
    expect(result.debug.source).toBe('semantic-rag-ukm-specific-profile');
    expect(result.answer).toMatch(/UKM KSL adalah unit kegiatan mahasiswa/i);
    expect(result.answer).not.toMatch(/belum punya informasi detail/i);
  });

  test('answers uploaded training content from DB when file index is empty', async () => {
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
    process.env.SEMANTIC_RAG_TRAINING_DB_INDEX_CACHE_MS = '1';
    jest.doMock('../src/engine/ragEngine', () => ({
      loadIndex: jest.fn(() => []),
      chunkText: jest.fn((text) => [String(text || '')]),
      computeEmbedding: jest.fn(async () => []),
      cleanAnswerLanguage: jest.fn((text) => String(text || '').trim())
    }));
    jest.doMock('../src/db', () => ({
      trainingData: {
        findMany: jest.fn(async () => [
          {
            id: 'training-db-ksl',
            filename: 'Profil UKM KSL.docx',
            content: 'Profil UKM KSL\nUKM KSL adalah unit kegiatan mahasiswa di ITB STIKOM Bali yang menjadi wadah kegiatan rohani dan pengembangan karakter mahasiswa. Kegiatan KSL meliputi pertemuan rutin, pembinaan, diskusi, dan kegiatan kebersamaan anggota.',
            source: 'upload',
            divisionKey: null,
            ragIngestStatus: 'success',
            ragChunkCount: 1,
            createdAt: new Date('2026-07-21T00:00:00.000Z'),
            updatedAt: new Date('2026-07-21T00:00:00.000Z'),
            uploadedById: null
          }
        ])
      }
    }));

    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    const result = await querySemanticRag('apa itu ukm ksl?');

    expect(result.success).toBe(true);
    expect(result.source).toBe('semantic-rag-ukm-list');
    expect(result.debug.source).toBe('semantic-rag-ukm-specific-profile');
    expect(result.answer).toMatch(/UKM KSL adalah unit kegiatan mahasiswa/i);
    expect(result.answer).not.toMatch(/belum punya informasi detail/i);
  });
  test('answers a new uploaded document topic through generic training fallback', async () => {
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
    process.env.SEMANTIC_RAG_TRAINING_DB_INDEX_CACHE_MS = '1';
    jest.doMock('../src/engine/ragEngine', () => ({
      loadIndex: jest.fn(() => []),
      chunkText: jest.fn((text) => [String(text || '')]),
      computeEmbedding: jest.fn(async () => []),
      cleanAnswerLanguage: jest.fn((text) => String(text || '').trim())
    }));
    jest.doMock('../src/db', () => ({
      trainingData: {
        findMany: jest.fn(async () => [
          {
            id: 'training-db-mentoring-alumni',
            filename: 'Program Mentoring Alumni.docx',
            content: 'Program Mentoring Alumni ITB STIKOM Bali adalah kegiatan pendampingan mahasiswa oleh alumni untuk berbagi pengalaman industri, persiapan karier, penguatan portofolio, diskusi dunia kerja, dan perluasan jejaring profesional.',
            source: 'upload',
            divisionKey: null,
            ragIngestStatus: 'success',
            ragChunkCount: 1,
            createdAt: new Date('2026-07-21T00:00:00.000Z'),
            updatedAt: new Date('2026-07-21T00:00:00.000Z'),
            uploadedById: null
          }
        ])
      }
    }));

    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    const result = await querySemanticRag('apa itu mentoring alumni?');

    expect(result.success).toBe(true);
    expect(result.source).toBe('semantic-rag-uploaded-training-generic');
    expect(result.answer).toMatch(/Program Mentoring Alumni/i);
    expect(result.answer).toMatch(/pendampingan mahasiswa|alumni|pengalaman industri|portofolio|jejaring profesional/i);
    expect(result.answer).not.toMatch(/belum menemukan informasi|belum bisa memastikan|tidak mempunyai jawaban/i);
  });
  test('answers uploaded Athena and Ghost UKM profiles from DB using short UKM names', async () => {
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
    process.env.SEMANTIC_RAG_TRAINING_DB_INDEX_CACHE_MS = '1';
    jest.doMock('../src/engine/ragEngine', () => ({
      loadIndex: jest.fn(() => []),
      chunkText: jest.fn((text) => [String(text || '')]),
      computeEmbedding: jest.fn(async () => []),
      cleanAnswerLanguage: jest.fn((text) => String(text || '').trim())
    }));
    jest.doMock('../src/db', () => ({
      trainingData: {
        findMany: jest.fn(async () => [
          {
            id: 'training-db-athena',
            filename: 'PROFILE ATHENA ESPORT.docx',
            content: 'Profil UKM ATHENA ESPORT\nAthena Esport adalah unit kegiatan mahasiswa ITB STIKOM Bali yang menjadi wadah mahasiswa untuk mengembangkan minat dan prestasi di bidang esports, kompetisi game, latihan tim, dan kegiatan komunitas gaming.',
            source: 'upload',
            divisionKey: null,
            ragIngestStatus: 'success',
            ragChunkCount: 1,
            createdAt: new Date('2026-07-21T00:00:00.000Z'),
            updatedAt: new Date('2026-07-21T00:00:00.000Z'),
            uploadedById: null
          },
          {
            id: 'training-db-ghost',
            filename: 'Profil_UKM_GHoST_ITB_STIKOM_Bali.docx',
            content: 'Profil UKM GHoST\nGHoST adalah unit kegiatan mahasiswa di ITB STIKOM Bali yang berfokus pada kegiatan komunitas mahasiswa, pengembangan kreativitas, kolaborasi anggota, dan aktivitas organisasi sesuai profil UKM yang tersedia.',
            source: 'upload',
            divisionKey: null,
            ragIngestStatus: 'success',
            ragChunkCount: 1,
            createdAt: new Date('2026-07-21T00:00:00.000Z'),
            updatedAt: new Date('2026-07-21T00:00:00.000Z'),
            uploadedById: null
          }
        ])
      }
    }));

    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    const athena = await querySemanticRag('apa itu ukm athena?');
    expect(athena.success).toBe(true);
    expect(athena.source).toBe('semantic-rag-ukm-list');
    expect(athena.debug.source).toBe('semantic-rag-ukm-specific-profile');
    expect(athena.answer).toMatch(/Athena Esport|Athena Esports/i);
    expect(athena.answer).toMatch(/esports|kompetisi game|gaming/i);
    expect(athena.answer).not.toMatch(/belum punya informasi detail|belum sesuai/i);

    const ghost = await querySemanticRag('apa itu ukm ghost?');
    expect(ghost.success).toBe(true);
    expect(ghost.source).toBe('semantic-rag-ukm-list');
    expect(ghost.debug.source).toBe('semantic-rag-ukm-specific-profile');
    expect(ghost.answer).toMatch(/GHoST|Ghost/i);
    expect(ghost.answer).toMatch(/unit kegiatan mahasiswa|komunitas mahasiswa|organisasi/i);
    expect(ghost.answer).not.toMatch(/belum punya informasi detail|belum sesuai/i);
  });
  test('answers uploaded Career Center and Inkubator Bisnis training content from DB when file index is empty', async () => {
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
    process.env.SEMANTIC_RAG_TRAINING_DB_INDEX_CACHE_MS = '1';
    jest.doMock('../src/engine/ragEngine', () => ({
      loadIndex: jest.fn(() => []),
      chunkText: jest.fn((text) => [String(text || '')]),
      computeEmbedding: jest.fn(async () => []),
      cleanAnswerLanguage: jest.fn((text) => String(text || '').trim())
    }));
    jest.doMock('../src/db', () => ({
      trainingData: {
        findMany: jest.fn(async () => [
          {
            id: 'training-db-career-center',
            filename: 'Career Center.docx',
            content: 'Career Center ITB STIKOM Bali membantu mahasiswa dalam pengembangan karier dan softskill melalui pelatihan kesiapan kerja, konsultasi karier, informasi lowongan, pembekalan CV, dan persiapan wawancara kerja.',
            source: 'upload',
            divisionKey: null,
            ragIngestStatus: 'success',
            ragChunkCount: 1,
            createdAt: new Date('2026-07-21T00:00:00.000Z'),
            updatedAt: new Date('2026-07-21T00:00:00.000Z'),
            uploadedById: null
          },
          {
            id: 'training-db-inkubator',
            filename: 'Inkubator Bisnis.docx',
            content: 'Inkubator Bisnis ITB STIKOM Bali adalah fasilitas pendukung untuk membantu mahasiswa mengembangkan ide usaha digital melalui pendampingan bisnis, validasi ide, mentoring, dan penguatan kewirausahaan.',
            source: 'upload',
            divisionKey: null,
            ragIngestStatus: 'success',
            ragChunkCount: 1,
            createdAt: new Date('2026-07-21T00:00:00.000Z'),
            updatedAt: new Date('2026-07-21T00:00:00.000Z'),
            uploadedById: null
          }
        ])
      }
    }));

    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    const career = await querySemanticRag('career center di stikom itu ngapain?');
    expect(career.success).toBe(true);
    expect(career.source).toBe('semantic-rag-campus-support-entity');
    expect(career.answer).toMatch(/Career Center/i);
    expect(career.answer).toMatch(/softskill|pelatihan kesiapan kerja|konsultasi karier|lowongan|CV|wawancara/i);
    expect(career.answer).not.toMatch(/Saya siap bantu|belum.*rincian|belum.*lengkap|perlu dikonfirmasi/i);

    const inkubator = await querySemanticRag('inkubator bisnis itu apa?');
    expect(inkubator.success).toBe(true);
    expect(inkubator.source).toBe('semantic-rag-campus-support-entity');
    expect(inkubator.answer).toMatch(/Inkubator Bisnis/i);
    expect(inkubator.answer).toMatch(/ide usaha digital|pendampingan bisnis|mentoring|kewirausahaan/i);
    expect(inkubator.answer).not.toMatch(/belum menemukan informasi yang cukup lengkap|belum bisa memastikan/i);
  });
  test('filters OCR status lines and broken fragments from uploaded UKM profile answers', async () => {
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
    process.env.SEMANTIC_RAG_TRAINING_DB_INDEX_CACHE_MS = '1';
    jest.doMock('../src/engine/ragEngine', () => ({
      loadIndex: jest.fn(() => []),
      chunkText: jest.fn((text) => [String(text || '')]),
      computeEmbedding: jest.fn(async () => []),
      cleanAnswerLanguage: jest.fn((text) => String(text || '').trim())
    }));
    jest.doMock('../src/db', () => ({
      trainingData: {
        findMany: jest.fn(async () => [
          {
            id: 'training-db-kmhd',
            filename: 'Profil UKM KMHD.docx',
            content: 'OCR berhasil mengekstrak teks dari gambar.\nProfil UKM KMHD\nKMHD adalah unit kegiatan mahasiswa kerohanian Hindu di ITB STIKOM Bali yang menjadi wadah mahasiswa untuk mengembangkan kegiatan keagamaan, kebersamaan, pelayanan, dan pembinaan karakter.',
            source: 'upload',
            divisionKey: null,
            ragIngestStatus: 'success',
            ragChunkCount: 1,
            createdAt: new Date('2026-07-21T00:00:00.000Z'),
            updatedAt: new Date('2026-07-21T00:00:00.000Z'),
            uploadedById: null
          },
          {
            id: 'training-db-tabuh',
            filename: 'Profil UKM Tabuh Bramara Gita.docx',
            content: 'Profil UKM Tabuh\nSalah satu UKM yang menonjol adalah UKM Tabuh Bramara Gita, organisasi seni.\nUKM ini resmi berdiri pada\nSejak berdiri, UKM ini aktif tampil di acara kampus seperti\nUKM Tabuh Bramara Gita adalah unit kegiatan mahasiswa seni tabuh yang menjadi wadah mahasiswa untuk mengembangkan minat dalam seni musik tradisional Bali, latihan tabuh, dan tampil pada kegiatan kampus.',
            source: 'upload',
            divisionKey: null,
            ragIngestStatus: 'success',
            ragChunkCount: 1,
            createdAt: new Date('2026-07-21T00:00:00.000Z'),
            updatedAt: new Date('2026-07-21T00:00:00.000Z'),
            uploadedById: null
          }
        ])
      }
    }));

    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    const kmhd = await querySemanticRag('apa itu ukm kmhd?');
    expect(kmhd.success).toBe(true);
    expect(kmhd.source).toBe('semantic-rag-ukm-list');
    expect(kmhd.answer).toMatch(/KMHD adalah unit kegiatan mahasiswa/i);
    expect(kmhd.answer).not.toMatch(/OCR berhasil mengekstrak teks/i);

    const tabuh = await querySemanticRag('apa itu ukm tabuh?');
    expect(tabuh.success).toBe(true);
    expect(tabuh.source).toBe('semantic-rag-ukm-list');
    expect(tabuh.answer).toMatch(/UKM Tabuh Bramara Gita adalah unit kegiatan mahasiswa seni tabuh/i);
    expect(tabuh.answer).not.toMatch(/resmi berdiri pada\s*(?:\n|$)/i);
    expect(tabuh.answer).not.toMatch(/acara kampus seperti\s*(?:\n|$)/i);
  });

  test('accepts uploaded Athena Esport profile for Athena Esport wording', async () => {
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
    process.env.SEMANTIC_RAG_TRAINING_DB_INDEX_CACHE_MS = '1';
    jest.doMock('../src/engine/ragEngine', () => ({
      loadIndex: jest.fn(() => []),
      chunkText: jest.fn((text) => [String(text || '')]),
      computeEmbedding: jest.fn(async () => []),
      cleanAnswerLanguage: jest.fn((text) => String(text || '').trim())
    }));
    jest.doMock('../src/db', () => ({
      trainingData: {
        findMany: jest.fn(async () => [
          {
            id: 'training-db-athena-esport',
            filename: 'PROFILE ATHENA ESPORT.docx',
            content: 'Profil UKM ATHENA ESPORT\nAthena Esport adalah unit kegiatan mahasiswa ITB STIKOM Bali yang menjadi wadah mahasiswa untuk mengembangkan minat dan prestasi di bidang esports, kompetisi game, latihan tim, dan kegiatan komunitas gaming.',
            source: 'upload',
            divisionKey: null,
            ragIngestStatus: 'success',
            ragChunkCount: 1,
            createdAt: new Date('2026-07-21T00:00:00.000Z'),
            updatedAt: new Date('2026-07-21T00:00:00.000Z'),
            uploadedById: null
          }
        ])
      }
    }));

    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    const result = await querySemanticRag('apa itu ukm athena esport?');
    expect(result.success).toBe(true);
    expect(result.source).toBe('semantic-rag-ukm-list');
    expect(result.answer).toMatch(/Athena Esport|Athena Esports/i);
    expect(result.answer).toMatch(/kompetisi game|gaming|esports/i);
    expect(result.answer).not.toMatch(/belum sesuai|ditahan/i);
  });
});

