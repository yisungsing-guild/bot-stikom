describe('semanticRagEngine', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.dontMock('../src/engine/ragEngine');
    delete process.env.OPENAI_API_KEY;
    delete process.env.SEMANTIC_RAG_MIN_SCORE;
    delete process.env.SEMANTIC_RAG_TODAY_YMD;
    delete process.env.SEMANTIC_RAG_RESULT_CACHE_MS;
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
    expect(utbUkt.answer).toMatch(/Double Degree UTB belum tercantum/i);
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
    expect(hiThink.source).toBe('semantic-rag-campus-facility');
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

  test('answers short double degree nationality questions directly', async () => {
    const { querySemanticRag } = require('../src/engine/semanticRagEngine');

    const international = await querySemanticRag('Apakah ada program double degree internasional?');
    expect(international.success).toBe(true);
    expect(international.source).toBe('semantic-rag-dual-degree');
    expect(international.answer).toMatch(/Ya, ada program Double Degree internasional/i);
    expect(international.answer).toMatch(/DNUI/i);
    expect(international.answer).toMatch(/HELP/i);

    const national = await querySemanticRag('Apa ada program double degree nasional?');
    expect(national.success).toBe(true);
    expect(national.source).toBe('semantic-rag-dual-degree');
    expect(national.answer).toMatch(/Ya, ada program Double Degree nasional/i);
    expect(national.answer).toMatch(/UTB/i);
  });

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
});


