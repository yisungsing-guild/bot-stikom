const {
  tryFeeComparisonAnswer,
  tryDetailedFeeAnswer,
  tryRegistrationFeeAnswer,
  tryDualDegreeAnswer,
  tryProgramListAnswer,
  tryProgramRecommendationAnswer,
  tryProgramComparisonAnswer,
  tryProgramDefinitionAnswer,
  tryScholarshipAnswer,
  tryCareerAnswer,
  tryContextualMultiProgramFeeAnswer
} = require('../src/engine/feeComparisonEngine');

describe('feeComparisonEngine', () => {
  test('answers cheapest S1 with program names and initial-cost ranges', () => {
    const result = tryFeeComparisonAnswer('biaya s1 termurah apa?');
    expect(result).toBeTruthy();
    expect(result.answer).toMatch(/Yang paling murah.*Sistem Komputer \(S1\).*Rp\. 13\.000\.000/s);
    expect(result.answer).toMatch(/Sistem Informasi/);
    expect(result.answer).toMatch(/Teknologi Informasi/);
    expect(result.answer).toMatch(/Bisnis Digital/);
    expect(result.answer).toMatch(/biaya awal masuk Rp\./i);
  });

  test('compares Bisnis Digital against other S1 programs', () => {
    const result = tryFeeComparisonAnswer('s1 bisnis digital apakah lebih murah dari prodi yang lain?');
    expect(result).toBeTruthy();
    expect(result.answer).toMatch(/Bisnis Digital \(S1\) biaya awal masuknya Rp\. 16\.000\.000/);
    expect(result.answer).toMatch(/Lebih mahal dari: Sistem Komputer/);
    expect(result.answer).toMatch(/Setara dengan: Sistem Informasi/);
  });

  test('compares only explicitly mentioned programs when user asks between two majors', () => {
    const result = tryFeeComparisonAnswer('BOleh saya dapat perbandingan biaya antara S1 sistem informasi dan S1 bisnis digital?');
    expect(result).toBeTruthy();
    expect(result.answer).toMatch(/Perbandingan biaya Sistem Informasi \(S1\) dan Bisnis Digital \(S1\)/);
    expect(result.answer).toMatch(/Sistem Informasi \(S1\): biaya awal masuk Rp\. 16\.000\.000; biaya semester Rp\. 6\.500\.000\/semester/);
    expect(result.answer).toMatch(/Bisnis Digital \(S1\): biaya awal masuk Rp\. 16\.000\.000; biaya semester Rp\. 6\.500\.000\/semester/);
    expect(result.answer).toMatch(/setara/i);
    expect(result.answer).not.toMatch(/Sistem Komputer/);
    expect(result.answer).not.toMatch(/Teknologi Informasi/);
  });

  test('price comparison wording between SI SK TI routes to fee comparison, not program content comparison', () => {
    const result = tryContextualMultiProgramFeeAnswer('Kalau perbandingan harga antara S1 Sistem Informasi, Sistem Komputer, dan Teknologi Informasi itu seperti apa ya?');
    expect(result).toBeTruthy();
    expect(result.answer).toMatch(/Sistem Informasi \(S1\).*Rp\. 16\.000\.000/s);
    expect(result.answer).toMatch(/Sistem Komputer \(S1\).*Rp\. 13\.000\.000/s);
    expect(result.answer).toMatch(/Teknologi Informasi \(S1\).*Rp\. 16\.000\.000/s);
    expect(result.answer).not.toMatch(/fokus belajar|Arah karier/i);
  });

  test('recommends Bisnis Digital for digital marketer goal without semantic API', () => {
    const result = tryProgramRecommendationAnswer('Kalau saya ingin menjadi digital marketer sebaiknya saya mengambil jurusan apa ya?');
    expect(result).toBeTruthy();
    expect(result.answer).toMatch(/Bisnis Digital \(BD\)/);
    expect(result.answer).toMatch(/digital marketing|pemasaran digital/i);
  });

  test('recommends Teknologi Informasi for casual coding hobby even without explicit major question', () => {
    const result = tryProgramRecommendationAnswer('aku hobby ngoding');
    expect(result).toBeTruthy();
    expect(result.answer).toMatch(/Teknologi Informasi \(TI\)/i);
    expect(result.answer).not.toMatch(/Pilihan utama.*Sistem Informasi/i);
  });

  test('answers registration fee for one program without routing to comparison', () => {
    const result = tryRegistrationFeeAnswer('Biaya pendaftaran si berapa?');
    expect(result).toBeTruthy();
    expect(result.answer).toMatch(/Biaya pendaftaran untuk Prodi Sistem Informasi: Rp\. 500\.000/i);
    expect(result.answer).toMatch(/Gelombang I.*total Rp\. 250\.000/i);
    expect(result.answer).toMatch(/Gelombang IV.*potongan Rp\. 100\.000, total Rp\. 400\.000/i);
    expect(result.answer).not.toMatch(/perbandingan harga|Sistem Komputer|Bisnis Digital/i);

    const wave = tryRegistrationFeeAnswer('biaya pendaftaran SI gelombang 1B berapa?');
    expect(wave).toBeTruthy();
    expect(wave.answer).toContain('* Biaya pendaftaran: Rp. 500.000');
    expect(wave.answer).toContain('* Potongan biaya pendaftaran (Gelombang I B): Rp. 250.000');
    expect(wave.answer).toContain('Total biaya pendaftaran (Gelombang I B): Rp. 250.000');
    expect(wave.answer).not.toMatch(/DPP: Rp\./);

    const waveFour = tryRegistrationFeeAnswer('biaya pendaftaran SI gelombang 4A berapa?');
    expect(waveFour.answer).toContain('* Potongan biaya pendaftaran (Gelombang IV A): Rp. 100.000');
    expect(waveFour.answer).toContain('Total biaya pendaftaran (Gelombang IV A): Rp. 400.000');
  });


  test('answers international double degree registration fee from its own fee document', () => {
    const dnui = tryRegistrationFeeAnswer('berapa biaya pendaftaran DNUI?');
    expect(dnui).toBeTruthy();
    expect(dnui.answer).toMatch(/Biaya pendaftaran untuk Prodi Double Degree DNUI: Rp\. 3\.000\.000/i);
    expect(dnui.answer).toMatch(/Gelombang I: potongan Rp\. 1\.250\.000, total Rp\. 1\.750\.000/i);
    expect(dnui.answer).toMatch(/Gelombang IV: potongan Rp\. 500\.000, total Rp\. 2\.500\.000/i);
    expect(dnui.answer).not.toMatch(/Biaya pendaftaran untuk Prodi Double Degree DNUI: Rp\. 500\.000/i);

    const helpWave = tryRegistrationFeeAnswer('biaya pendaftaran HELP gelombang 4A berapa?');
    expect(helpWave).toBeTruthy();
    expect(helpWave.answer).toContain('Biaya pendaftaran untuk Prodi Double Degree HELP University Gelombang IV A:');
    expect(helpWave.answer).toContain('* Biaya pendaftaran: Rp. 3.000.000');
    expect(helpWave.answer).toContain('* Potongan biaya pendaftaran (Gelombang IV A): Rp. 500.000');
    expect(helpWave.answer).toContain('Total biaya pendaftaran (Gelombang IV A): Rp. 2.500.000');
  });
  test('answers S2 and double degree fee components accurately', () => {
    const s2Reg = tryRegistrationFeeAnswer('berapa biaya pendaftaran S2?');
    expect(s2Reg).toBeTruthy();
    expect(s2Reg.answer).toContain('S2 Sistem Informasi: Rp. 700.000');
    expect(s2Reg.answer).toContain('Gelombang I: potongan Rp. 200.000, total Rp. 500.000');
    expect(s2Reg.answer).toContain('Gelombang II: potongan Rp. 100.000, total Rp. 600.000');

    const s2Detail = tryDetailedFeeAnswer('rincian biaya S2');
    expect(s2Detail).toBeTruthy();
    expect(s2Detail.answer).toContain('Biaya pendidikan per semester (UKT): Rp. 10.000.000');
    expect(s2Detail.answer).toContain('Pembayaran lunas selama 2 tahun: Rp. 40.000.000');
    expect(s2Detail.answer).toMatch(/semester 5.*tesis: Rp\. 6\.000\.000/i);

    const dnuiReg = tryDetailedFeeAnswer('berapa biaya registrasi DNUI?');
    expect(dnuiReg).toBeTruthy();
    expect(dnuiReg.answer).toContain('DPP): Rp. 20.000.000');
    expect(dnuiReg.answer).toContain('Bahasa Mandarin: Rp. 5.000.000');
    expect(dnuiReg.answer).toMatch(/pendaftaran terpisah.*Rp. 3.000.000/i);

    const helpDetail = tryDetailedFeeAnswer('rincian biaya HELP gelombang 4A');
    expect(helpDetail).toBeTruthy();
    expect(helpDetail.answer).toContain('DPP / Dana Pendidikan Pokok: Rp. 20.000.000');
    expect(helpDetail.answer).toContain('Bahasa Inggris: Rp. 5.000.000');
    expect(helpDetail.answer).toContain('Biaya pendidikan per semester (UKT): Rp. 3.000.000');

    const helpGeneral = tryDetailedFeeAnswer('Berapa rincian biaya program double degree help?');
    expect(helpGeneral).toBeTruthy();
    expect(helpGeneral.answer).toContain('Rincian biaya program Double Degree HELP University');
    expect(helpGeneral.answer).toContain('Biaya pendaftaran: Rp. 3.000.000');
    expect(helpGeneral.answer).toContain('DPP / Dana Pendidikan Pokok: Rp. 20.000.000');
    expect(helpGeneral.answer).toContain('Bahasa Inggris: Rp. 5.000.000');
    expect(helpGeneral.answer).toContain('Biaya pendidikan per semester (UKT): Rp. 3.000.000');

    const utbUkt = tryDetailedFeeAnswer('UKT UTB berapa?');
    expect(utbUkt).toBeTruthy();
    expect(utbUkt.answer).toMatch(/UTB belum tercantum/i);
    expect(utbUkt.answer).not.toContain('Sistem Informasi (S1): Rp. 6.500.000/semester');
  });

  test('formats detailed fee answer by program and wave', () => {
    const result = tryDetailedFeeAnswer('rincian biaya si gelombang 2B?');
    expect(result).toBeTruthy();
    expect(result.answer).toContain('Pendaftaran:');
    expect(result.answer).toContain('* Biaya pendaftaran: Rp. 500.000');
    expect(result.answer).toContain('* Potongan biaya pendaftaran (Gelombang II B): Rp. 200.000');
    expect(result.answer).toContain('Total biaya pendaftaran (Gelombang II B): Rp. 300.000');
    expect(result.answer).toContain('Biaya awal masuk untuk Prodi Sistem Informasi:');
    expect(result.answer).toContain('* DPP: Rp. 14.000.000');
    expect(result.answer).toContain('* Potongan biaya DPP (Gelombang II B): Rp. 1.500.000');
    expect(result.answer).toContain('Total awal masuk setelah potongan (Gelombang II B): Rp. 14.300.000');
    expect(result.answer).toContain('Biaya pendidikan per semester (UKT): Rp. 6.500.000');
  });

  test('answers UKT per semester without requiring wave', () => {
    const si = tryDetailedFeeAnswer('UKT sistem informasi');
    expect(si).toBeTruthy();
    expect(si.answer).toMatch(/Prodi Sistem Informasi: Rp\. 6\.500\.000/i);
    expect(si.answer).toMatch(/tidak bergantung pada gelombang pendaftaran/i);
    expect(si.answer).not.toMatch(/Rp\. 300\.000/i);

    const all = tryDetailedFeeAnswer('UKT di stikom berapa?');
    expect(all).toBeTruthy();
    expect(all.answer).toMatch(/Sistem Informasi \(S1\): Rp\. 6\.500\.000\/semester/i);
    expect(all.answer).toMatch(/Sistem Komputer \(S1\): Rp\. 6\.000\.000\/semester/i);

    const correction = tryDetailedFeeAnswer('kok aku bayar 6000000 untuk UKT sistem informasi ya?');
    expect(correction).toBeTruthy();
    expect(correction.answer).toMatch(/Rp\. 6\.500\.000/i);
    expect(correction.answer).toMatch(/tagihan yang kakak lihat berbeda/i);
  });

  test('formats Gelombang I A DPP discount without adding percentage scholarship', () => {
    const result = tryDetailedFeeAnswer('rincian biaya ti gelombang 1A?');

    expect(result).toBeTruthy();
    expect(result.answer).toContain('* Potongan biaya pendaftaran (Gelombang I A): Rp. 250.000');
    expect(result.answer).toContain('Total biaya pendaftaran (Gelombang I A): Rp. 250.000');
    expect(result.answer).toContain('* DPP: Rp. 14.000.000');
    expect(result.answer).toContain('* Potongan biaya DPP (Gelombang I A): Rp. 2.000.000');
    expect(result.answer).toContain('Total awal masuk setelah potongan (Gelombang I A): Rp. 13.750.000');
    expect(result.answer).not.toMatch(/50% DPP|Rp\. 9\.000\.000/);
  });

  test('keeps full fee breakdown for detailed wave questions that mention UKT and Sisipan', () => {
    const withUkt = tryDetailedFeeAnswer('rincian biaya teknologi informasi gelombang 1A, termasuk UKT per semester');
    expect(withUkt).toBeTruthy();
    expect(withUkt.answer).toContain('Pendaftaran:');
    expect(withUkt.answer).toContain('Biaya awal masuk untuk Prodi Teknologi Informasi:');
    expect(withUkt.answer).toContain('Biaya pendidikan per semester (UKT): Rp. 6.500.000');
    expect(withUkt.answer.trim()).not.toMatch(/^Biaya pendidikan per semester/);

    const sisipan = tryDetailedFeeAnswer('rincian biaya si gelombang sisipan');
    expect(sisipan).toBeTruthy();
    expect(sisipan.answer).toContain('* Potongan biaya pendaftaran (Gelombang Sisipan): Rp. 0');
    expect(sisipan.answer).toContain('Total biaya pendaftaran (Gelombang Sisipan): Rp. 500.000');
    expect(sisipan.answer).toContain('* Potongan biaya DPP (Gelombang Sisipan): Rp. 0');
    expect(sisipan.answer).toContain('Total awal masuk setelah potongan (Gelombang Sisipan): Rp. 16.000.000');
  });

  test('answers generic dual degree question with all partners', () => {
    const result = tryDualDegreeAnswer('apakah ada program double degree di stikom?');
    expect(result).toBeTruthy();
    expect(result.answer).toMatch(/UTB/);
    expect(result.answer).toMatch(/DNUI/);
    expect(result.answer).toMatch(/HELP/);
  });

  test('answers available majors/program list in requested structure', () => {
    for (const q of ['jurusan apa saja di stikom?', 'prodi apa aja yang ada di stikom?', 'program studi yang tersedia apa saja?']) {
      const result = tryProgramListAnswer(q);
      expect(result).toBeTruthy();
      expect(result.answer).toContain('S2 (Pascasarjana):');
      expect(result.answer).toContain('- S2 Sistem Informasi (SI)');
      expect(result.answer).toContain('S1 (Sarjana):');
      expect(result.answer).toContain('- Sistem Informasi');
      expect(result.answer).toContain('- Teknologi Informasi');
      expect(result.answer).toContain('- Bisnis Digital');
      expect(result.answer).toContain('- Sistem Komputer');
      expect(result.answer).toContain('D3 (Diploma):');
      expect(result.answer).toContain('- D3 Manajemen Informatika');
      expect(result.answer).toContain('Double Degree:');
      expect(result.answer).toMatch(/Universitas Teknologi Bandung \(UTB\).*Bisnis Digital.*DKV \(Desain Komunikasi Visual\)/);
      expect(result.answer).toMatch(/Dalian Neusoft University of Information \(DNUI\), China.*Bisnis Digital.*belum tercantum/);
      expect(result.answer).toMatch(/HELP University, Malaysia.*Sistem Informasi.*belum tercantum/);
    }
  });

  test('answers UTB double degree major as DKV', () => {
    const result = tryDualDegreeAnswer('Yang saya tanya Double Degree dengan UTB, di UTB nya itu mengambil jurusan apa?');
    expect(result).toBeTruthy();
    expect(result.answer).toMatch(/DKV \(Desain Komunikasi Visual\)/);
    expect(result.answer).not.toMatch(/Program UTB terkait Prodi Bisnis Digital/);
  });

  test('answers conversational Double Degreenya UTB wording', () => {
    const result = tryDualDegreeAnswer('Double Degreenya selain Prodi Bisnis Digital di Stikom Bali, dari UTB dapat prodi apa?');
    expect(result).toBeTruthy();
    expect(result.answer).toMatch(/Bisnis Digital/i);
    expect(result.answer).toMatch(/DKV \(Desain Komunikasi Visual\)/);
  });

  test('answers Double Degree side-by-side program mapping without hallucinating missing partner majors', () => {
    const utbPair = tryDualDegreeAnswer('Sy pengin tahu untuk double degree UTB, jurusan padanan di stikom yang harus diambil, jurusan apa?');
    expect(utbPair).toBeTruthy();
    expect(utbPair.answer).toMatch(/Prodi di ITB STIKOM Bali: Bisnis Digital/i);
    expect(utbPair.answer).toMatch(/Jurusan di UTB: DKV \(Desain Komunikasi Visual\)/i);

    const allPairs = tryDualDegreeAnswer('Kalau double degree yang lain jurusan apa dan jurusan apa ya?');
    expect(allPairs).toBeTruthy();
    expect(allPairs.answer).toMatch(/UTB.*Bisnis Digital.*DKV/s);
    expect(allPairs.answer).toMatch(/DNUI.*Bisnis Digital.*belum tercantum/s);
    expect(allPairs.answer).toMatch(/HELP.*Sistem Informasi.*belum tercantum/s);
    expect(allPairs.answer).toMatch(/tidak menebak di luar data/i);
  });

  test('answers UTB national double degree specifics', () => {
    const result = tryDualDegreeAnswer('Untuk Double Degree Nasional dengan UTB itu seperti apa ya, apa yang spesifik tentang program tersebut dibanding program yang lain');
    expect(result).toBeTruthy();
    expect(result.answer).toMatch(/National Class|nasional/i);
    expect(result.answer).toMatch(/DKV \(Desain Komunikasi Visual\)/);
    expect(result.answer).toMatch(/DNUI dan HELP.*internasional/i);
  });

  test('answers S1 SI SK TI difference even with typo', () => {
    const result = tryProgramComparisonAnswer('Untuk program S1 Sistem infomrasi, sistem komputer, dan teknologi informasi. apa bedanya ya?');
    expect(result).toBeTruthy();
    expect(result.answer).toMatch(/Sistem Informasi \(SI\)/);
    expect(result.answer).toMatch(/Sistem Komputer \(SK\)/);
    expect(result.answer).toMatch(/Teknologi Informasi \(TI\)/);
    expect(result.answer).toMatch(/SI adalah prodi/i);
    expect(result.answer).toMatch(/SK adalah prodi/i);
    expect(result.answer).toMatch(/TI adalah prodi/i);
    expect(result.answer).toMatch(/perbedaan utamanya/i);
  });

  test('answers contextual fee for three previously mentioned programs', () => {
    const result = tryContextualMultiProgramFeeAnswer('Biaya kuliah untuk ketiga program studi itu seperti apa ya?', undefined, {
      programHint: 'Sistem Informasi, Sistem Komputer, Teknologi Informasi'
    });
    expect(result).toBeTruthy();
    expect(result.answer).toMatch(/Sistem Informasi \(S1\).*Rp\. 16\.000\.000.*Rp\. 6\.500\.000\/semester/s);
    expect(result.answer).toMatch(/Sistem Komputer \(S1\).*Rp\. 13\.000\.000.*Rp\. 6\.000\.000\/semester/s);
    expect(result.answer).toMatch(/Teknologi Informasi \(S1\).*Rp\. 16\.000\.000.*Rp\. 6\.500\.000\/semester/s);
    expect(result.answer).toMatch(/Gelombang II B|IV A|potongan/i);
  });

  test('does not treat career recommendation as generic program list', () => {
    const q = 'Kalau saya ingin nanti bekerja di perusahaan yang bisa mengolah data dan menganalisa data, sebaiknya saya mengambil jurusan yang mana ya?';
    expect(tryProgramListAnswer(q)).toBeNull();

    const result = tryProgramRecommendationAnswer(q);
    expect(result).toBeTruthy();
    expect(result.answer).toMatch(/Pilihan utama.*Sistem Informasi \(SI\)/i);
    expect(result.answer).toMatch(/Data Analyst|Business Analyst|dashboard|basis data/i);
    expect(result.answer).toMatch(/Teknologi Informasi \(TI\).*teknis/i);
    expect(result.answer).toMatch(/Sistem Komputer \(SK\).*hardware|Sistem Komputer \(SK\).*IoT/i);
  });

  test('answers Bisnis Digital suitability follow-up for data analyst specifically', () => {
    for (const q of [
      'Apakah Bisnis Digital tidak cocok untuk data analis ya?',
      'Saya menanyakan apakah data analis tidak cocok kalau saya ambil Bisnis Digital?',
      'Kalau sy ingin jadi data analis apakah jurusan binis digital bisa?',
      'Kalau sy pilih bisnis digital, apakah bs menjadi data analis?'
    ]) {
      const result = tryProgramRecommendationAnswer(q);
      expect(result).toBeTruthy();
      expect(result.answer).toMatch(/Bisnis Digital.*bisa cocok/i);
      expect(result.answer).toMatch(/marketing|e-commerce|data bisnis|pemasaran digital/i);
      expect(result.answer).toMatch(/pilihan utamanya biasanya Sistem Informasi \(SI\)|Sistem Informasi \(SI\).*paling cocok/i);
      expect(result.answer).not.toMatch(/^Pilihan utama yang paling cocok adalah Sistem Informasi \(SI\)\./i);
    }
  });

  test('answers Bisnis Digital outcome as career prospects, not another major recommendation', () => {
    const result = tryProgramRecommendationAnswer('Oh begitu, berarti kalau jurusan bisnis digital cocoknya jadi apa nantinya?');
    expect(result).toBeTruthy();
    expect(result.answer).toMatch(/Prospek kerja lulusan Bisnis Digital/i);
    expect(result.answer).toMatch(/Digital Marketing|E-commerce|Product Manager|Business Analyst|Market Analyst/i);
    expect(result.answer).not.toMatch(/^Pilihan utama yang paling cocok adalah Bisnis Digital/i);
  });

  test('answers general program-career suitability matrix beyond data analyst', () => {
    const cases = [
      {
        q: 'Kalau saya ambil SI bisa jadi backend developer tidak?',
        must: [/Sistem Informasi.*bisa cocok|Sistem Informasi tetap bisa cocok/i, /Teknologi Informasi \(TI\).*paling langsung|pilihan utamanya biasanya Teknologi Informasi \(TI\)/i]
      },
      {
        q: 'Apakah Sistem Komputer cocok untuk digital marketing?',
        must: [/Sistem Komputer kurang cocok sebagai jalur utama/i, /Bisnis Digital \(BD\).*paling langsung|pilihan utamanya biasanya Bisnis Digital \(BD\)/i]
      },
      {
        q: 'BD cocok nggak kalau saya pengen kerja di cyber security?',
        must: [/Bisnis Digital kurang cocok sebagai jalur utama/i, /Teknologi Informasi \(TI\).*paling langsung|pilihan utamanya biasanya Teknologi Informasi \(TI\)/i]
      },
      {
        q: 'Saya suka IoT, kalau ambil TI bisa tidak?',
        must: [/Teknologi Informasi bisa cocok/i, /Sistem Komputer \(SK\).*paling langsung|pilihan utamanya biasanya Sistem Komputer \(SK\)/i]
      },
      {
        q: 'Kalau mau UI UX ambil BD cocok?',
        must: [/Bisnis Digital bisa cocok/i, /UI\/UX|produk digital/i]
      }
    ];

    for (const item of cases) {
      const result = tryProgramRecommendationAnswer(item.q);
      expect(result).toBeTruthy();
      for (const re of item.must) expect(result.answer).toMatch(re);
    }
  });

  test('answers program definition shortcuts without semantic generation', () => {
    for (const q of ['apa itu si', 'apa itu ti', 'apa itu sk', 'apa itu bd', 'apa itu mi']) {
      const result = tryProgramDefinitionAnswer(q);
      expect(result).toBeTruthy();
      expect(result.answer).toMatch(/program studi|program D3/i);
      expect(result.answer).not.toMatch(/Maaf, data/);
    }
  });

  test('answers detailed fee from bundled tuition knowledge when RAG index is empty', () => {
    const result = tryDetailedFeeAnswer('Rincian biaya prodi ti gelombang 1A berapa?', []);

    expect(result).toBeTruthy();
    expect(result.answer).toContain('Biaya awal masuk untuk Prodi Teknologi Informasi');
    expect(result.answer).toContain('Total biaya pendaftaran (Gelombang I A): Rp. 250.000');
    expect(result.answer).toContain('Potongan biaya DPP (Gelombang I A): Rp. 2.000.000');
    expect(result.answer).toContain('Total awal masuk setelah potongan (Gelombang I A): Rp. 13.750.000');
    expect(result.answer).toContain('Biaya pendidikan per semester (UKT): Rp. 6.500.000');
  });

  test('extracts detailed S1 fee from RAG content even when uploaded filename is generic', () => {
    const genericRailwayIndex = [
      {
        filename: 'upload-9f3a2.pdf',
        chunk: [
          'RINCIAN BIAYA TAHUN AJARAN 2026/2027',
          'Program Studi: Sistem Informasi, Teknologi Informasi, Bisnis Digital',
          'Pendaftaran 500.000',
          'Jas Alamater, Topi 750.000',
          'Kaos, Tas, GMTI 750.000',
          'Dana Pendidikan Pokok 14.000.000',
          'Biaya Pendidikan Per Semester 6.500.000'
        ].join('\n')
      }
    ];

    const result = tryDetailedFeeAnswer('Rincian biaya prodi ti gelombang 3A berapa?', genericRailwayIndex);

    expect(result).toBeTruthy();
    expect(result.answer).toContain('Biaya awal masuk untuk Prodi Teknologi Informasi');
    expect(result.answer).toContain('Total biaya pendaftaran (Gelombang III A): Rp. 350.000');
    expect(result.answer).toContain('Total awal masuk setelah potongan (Gelombang III A): Rp. 14.850.000');
    expect(result.answer).toContain('Biaya pendidikan per semester (UKT): Rp. 6.500.000');
  });

  test('answers scholarship question from local fee knowledge', () => {
    const result = tryScholarshipAnswer('apakah ada beasiswa?');
    expect(result).toBeTruthy();
    expect(result.answer).toMatch(/beasiswa|potongan/i);
    expect(result.answer).toMatch(/Beasiswa KIP/);
    expect(result.answer).toMatch(/Beasiswa 1K1S/);
    expect(result.answer).toMatch(/Kuliah Sambil Kerja di Luar Negeri/);
    expect(result.answer).toMatch(/Gelombang II: 40%/);
  });

  test('answers career questions without drifting to another program', () => {
    const result = tryCareerAnswer('prospek kerja ti?');
    expect(result).toBeTruthy();
    expect(result.answer).toMatch(/software engineer|Software Developer|Programmer/i);
    expect(result.answer).toMatch(/network engineer/i);
    expect(result.answer).toMatch(/cybersecurity/i);
    expect(result.answer).not.toMatch(/ERP Specialist/);
    expect(result.answer).not.toMatch(/Robotics Engineer/);

    for (const q of ['prospek kerja si?', 'prospek kerja sk?', 'prospek kerja mi?', 'prospek kerja bd?']) {
      const career = tryCareerAnswer(q);
      expect(career).toBeTruthy();
      expect(career.answer).not.toMatch(/Maaf, data/);
    }
  });
});
