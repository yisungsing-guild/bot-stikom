const {
  evaluateOutboundAnswer,
  normalizeOutboundAnswerText,
  hasLikelyRawDocumentLeak,
  detectIntentConflict,
  isConversationalQuery
} = require('../src/utils/answerPreflightEvaluator');

describe('answerPreflightEvaluator', () => {
  const oldEnv = process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS;

  afterEach(() => {
    if (typeof oldEnv === 'undefined') delete process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS;
    else process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = oldEnv;
  });

  test('removes optional follow-up suggestions by default', () => {
    delete process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS;
    const result = evaluateOutboundAnswer('GCCP adalah program pendukung internasional.\n\nKalau mau lanjut, kakak bisa tanya:\n- Pertanyaan lain?', 'apa itu GCCP?');
    expect(result.answer).toBe('GCCP adalah program pendukung internasional.');
    expect(result.answer).not.toMatch(/Kalau mau lanjut/i);
  });

  test('removes humanizer follow-up suggestions by default', () => {
    delete process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS;
    const result = evaluateOutboundAnswer('GCCP adalah program pendukung internasional.\n\nKalau Kakak ingin tahu lebih lanjut, mungkin pertanyaan berikut juga bisa membantu:\n\n- Apa saja fasilitas pendukung mahasiswa?\n- Bagaimana cara konfirmasi detail program ini?', 'apa itu GCCP?');
    expect(result.answer).toBe('GCCP adalah program pendukung internasional.');
    expect(result.answer).not.toMatch(/pertanyaan berikut/i);
  });
  test('removes short optional continuation offers by default', () => {
    delete process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS;
    const result = evaluateOutboundAnswer('Double Degree tersedia melalui beberapa program mitra.\n\nKalau kakak mau, saya bisa jelaskan detail program UTB, DNUI, atau HELP.', 'double degree apa saja?');
    expect(result.answer).toBe('Double Degree tersedia melalui beberapa program mitra.');
  });
  test('cleans visible dangling ellipsis artifacts', () => {
    expect(normalizeOutboundAnswerText('Bagian ini terpotong per\u2026')).toBe('Bagian ini terpotong per.');
    expect(normalizeOutboundAnswerText('Program GCCP)...')).toBe('Program GCCP).');
  });

  test('blocks technical metadata leaks with fallback', () => {
    const result = evaluateOutboundAnswer('CONFIDENCE: 0.4\nSOURCE_CHUNKS: []', 'apa itu BCCP?');
    expect(result.blocked).toBe(true);
    expect(result.issues).toContain('technical_leak');
    expect(result.answer).toMatch(/belum cukup|belum mempunyai/i);
    expect(result.answer).not.toMatch(/SOURCE_CHUNKS|CONFIDENCE/);
  });


  test('blocks answers that clearly conflict with the requested intent', () => {
    const wrongUkm = evaluateOutboundAnswer(
      'Baik Kak, berikut penjelasan mengenai biaya kuliah di ITB STIKOM Bali. Apakah ada beasiswa atau potongan biaya?',
      'apakah ada ukm esport?'
    );
    expect(wrongUkm.blocked).toBe(true);
    expect(wrongUkm.issues.some((issue) => ['intent_conflict', 'missing_requested_entity'].includes(issue))).toBe(true);
    expect(wrongUkm.answer).toMatch(/belum sesuai dengan pertanyaan/i);
    expect(wrongUkm.answer).not.toMatch(/biaya kuliah|beasiswa/i);

    const wrongLanguage = detectIntentConflict(
      'Program Double Degree HELP University berlangsung selama 4 tahun.',
      'apakah stikom mempunyai fasilitas belajar bahasa?'
    );
    expect(wrongLanguage.conflict).toBe(true);
  });


  test('uses topic-aware generic fallback for blocked answers', () => {
    const ukm = evaluateOutboundAnswer('', 'apakah ada ukm esport?');
    expect(ukm.answer).toMatch(/Untuk UKM atau Ormawa/i);

    const fee = evaluateOutboundAnswer('SOURCE_CHUNKS: []', 'berapa biaya kuliah SI?');
    expect(fee.answer).toMatch(/Untuk rincian biaya kuliah/i);

    const language = evaluateOutboundAnswer('Pasal 1 PIHAK PERTAMA dan PIHAK KEDUA dalam perjanjian kerja sama.', 'jadwal fasilitas belajar bahasa kapan?');
    expect(language.answer).toMatch(/fasilitas belajar bahasa|Language Learning Center/i);

    const customProgram = evaluateOutboundAnswer('', 'program ABCD itu apa ya?');
    expect(customProgram.answer).toMatch(/Untuk program ABCD/i);
  });
  test('allows compatible answers that mention related fee and scholarship context', () => {
    const result = evaluateOutboundAnswer(
      'Beasiswa yang tersedia antara lain KIP dan Prestasi. Pada data PMB juga ada potongan biaya sesuai gelombang.',
      'ada beasiswa apa saja?'
    );
    expect(result.blocked).toBe(false);
    expect(result.issues).not.toContain('intent_conflict');
  });
  test('blocks vague short prompts from receiving unrelated long answers', () => {
    const result = evaluateOutboundAnswer(
      'Berikut penjelasan tentang Mempunyai: dokumen ini dibuat dalam rangkap dua dan mempunyai kekuatan hukum yang sama.',
      'Mempunyai'
    );
    expect(result.blocked).toBe(true);
    expect(result.issues.some((issue) => ['ambiguous_short_query', 'raw_document_leak'].includes(issue))).toBe(true);
    expect(result.answer).toMatch(/belum mempunyai jawaban|belum sesuai|cukup aman/i);
    expect(result.answer).not.toMatch(/kekuatan hukum|rangkap dua/i);
  });

  test('allows concise definitions for short program acronym questions', () => {
    const result = evaluateOutboundAnswer(
      'Teknologi Informasi adalah salah satu program studi di ITB STIKOM Bali yang fokus pada pengembangan sistem dan solusi digital.',
      'apa itu ti?'
    );
    expect(result.blocked).toBe(false);
    expect(result.issues).not.toContain('ambiguous_short_query');
    expect(result.answer).toMatch(/Teknologi Informasi/i);
  });

  test('allows specific UKM KSL profile answers from training content', () => {
    const withAcronym = evaluateOutboundAnswer(
      'Kelompok Studi Linux (KSL) adalah wadah mahasiswa yang memiliki ketertarikan pada Linux dan open-source.',
      'apa itu ukm ksl?'
    );
    expect(withAcronym.blocked).toBe(false);
    expect(withAcronym.issues).not.toContain('missing_requested_entity');

    const withExpandedName = evaluateOutboundAnswer(
      'Kelompok Studi Linux adalah wadah mahasiswa yang memiliki ketertarikan pada Linux dan open-source.',
      'apa itu ukm ksl?'
    );
    expect(withExpandedName.blocked).toBe(false);

    const genericUkmList = evaluateOutboundAnswer(
      'Ada UKM/Ormawa seperti Basket, Futsal, dan Musik.',
      'apa itu ukm ksl?'
    );
    expect(genericUkmList.blocked).toBe(true);
    expect(genericUkmList.issues).toContain('missing_requested_entity');
  });
  test('allows partner-specific DNUI double degree answers', () => {
    const result = evaluateOutboundAnswer(
      'Double Degree DNUI adalah program Double Degree internasional ITB STIKOM Bali dengan Dalian Neusoft University of Information, China. Prodi di ITB STIKOM Bali: Bisnis Digital. Jurusan di DNUI belum tercantum pada data yang tersedia.',
      'apa itu double degree dnui?'
    );
    expect(result.blocked).toBe(false);
    expect(result.issues).not.toContain('missing_requested_entity');
    expect(result.answer).toMatch(/DNUI|Dalian Neusoft/i);
  });
  test('blocks answers that miss the specific entity requested by the user', () => {
    const result = evaluateOutboundAnswer(
      'Career Center membantu mahasiswa melalui informasi lowongan kerja dan konsultasi karier.',
      'Bagaimana cara mendaftar program LinkedIn Career Center?'
    );
    expect(result.blocked).toBe(true);
    expect(result.issues).toContain('missing_requested_entity');
    expect(result.answer).toMatch(/LinkedIn|belum sesuai/i);
    expect(result.answer).not.toMatch(/informasi lowongan kerja dan konsultasi karier/i);
  });

  test('blocks raw legal templates with placeholder markers even when only one legal marker appears', () => {
    const raw = 'Nomor: ............................................... Logo Mitra PERJANJIAN KERJA SAMA TENTANG ...............................................';
    const result = evaluateOutboundAnswer(raw, 'apa itu program internasional?');
    expect(result.blocked).toBe(true);
    expect(result.issues).toContain('raw_document_leak');
    expect(result.answer).not.toMatch(/Nomor:|Logo Mitra|PERJANJIAN KERJA SAMA/i);
  });
  test('blocks single Pasal or SK administrative leak for non-legal questions', () => {
    const pasalLeak = evaluateOutboundAnswer(
      'Akreditasi Program Studi Sistem Informasi ditetapkan berdasarkan ketentuan Pasal 4 Peraturan Menteri Pendidikan dan Kebudayaan Nomor 5 Tahun 2020.',
      'apa akreditasi prodi sistem informasi?'
    );
    expect(pasalLeak.blocked).toBe(true);
    expect(pasalLeak.issues).toContain('raw_document_leak');
    expect(pasalLeak.answer).not.toMatch(/Pasal 4|Peraturan Menteri/i);

    const skLeak = evaluateOutboundAnswer(
      'KEPUTUSAN Nomor: 149/SK/LAM-INFOKOM/Ak/S/XII/2023 Menimbang: bahwa untuk melaksanakan ketentuan Pasal 4.',
      'apa itu si?'
    );
    expect(skLeak.blocked).toBe(true);
    expect(skLeak.issues).toContain('raw_document_leak');
    expect(skLeak.answer).not.toMatch(/KEPUTUSAN|Nomor:|Menimbang|Pasal/i);
  });
  test('detects raw administrative document leaks', () => {
    const raw = 'Pasal 13 ADDENDUM\nPIHAK PERTAMA wajib memberitahukan kepada PIHAK KEDUA dalam perjanjian kerja sama.';
    expect(hasLikelyRawDocumentLeak(raw)).toBe(true);
    const result = evaluateOutboundAnswer(raw, 'apakah ada fasilitas belajar bahasa?');
    expect(result.blocked).toBe(true);
    expect(result.issues).toContain('raw_document_leak');
  });
  test('strips or blocks QNA/FAQ document source leaks before outbound send', () => {
    const cleaned = evaluateOutboundAnswer(
      'Sumber: QNA Bot - Hi-Think.docx\nQ: Apa itu Hi-Think?\nA: Hi-Think adalah program pendampingan karier untuk persiapan kerja di Jepang.',
      'apa itu hi-think?'
    );
    expect(cleaned.answer).not.toMatch(/QNA Bot|\.docx|Sumber:|^Q:|^A:/im);
    expect(cleaned.answer).toMatch(/Hi-Think|pendampingan karier/i);

    const leaked = evaluateOutboundAnswer(
      'Jawaban berdasarkan konteks training dari PROFILE ORGANISASI UKM BOS.docx: UKM BOS adalah organisasi badminton.',
      'apa itu ukm bos?'
    );
    expect(leaked.blocked).toBe(true);
    expect(leaked.issues.some((issue) => ['raw_document_leak', 'missing_requested_entity', 'answer_query_mismatch'].includes(issue))).toBe(true);
    expect(leaked.answer).not.toMatch(/PROFILE ORGANISASI|\.docx|konteks training/i);
  });

  test('recovers safe content from residual multi-marker FAQ/QNA dumps', () => {
    const result = evaluateOutboundAnswer(
      '(F) Fakta internal (Q) Apa biaya SI? (A) Biaya SI mengikuti dokumen PMB. FAQ: Jangan tampilkan format ini.',
      'berapa biaya SI?'
    );
    expect(result.blocked).toBe(false);
    expect(result.issues).toContain('recovered_raw_document_leak');
    expect(result.answer).toMatch(/Biaya SI/i);
    expect(result.answer).not.toMatch(/\(F\)|\(Q\)|\(A\)|FAQ:|Fakta internal|Jangan tampilkan format ini/i);
  });

  test('blocks raw profile and structured document dumps from any uploaded document', () => {
    const rawProfile = [
      'PROFIL LEMBAGA INKUBATOR BISNIS ITB STIKOM BALI',
      'Identitas Lembaga Nama Lembaga Inkubator Bisnis ITB STIKOM Bali',
      'Lembaga Induk Institut Teknologi dan Bisnis STIKOM Bali',
      'Tahun Berdiri 2014',
      'Dasar Hukum Surat Keputusan Pendirian Inkubator Bisnis',
      'Pembina / Penanggung Jawab Direktorat Kerja Sama, Layanan Industri, dan Inkubator Bisnis',
      'Alamat Kampus ITB STIKOM Bali, Jl. Raya Puputan No. 86, Renon',
      'Website ibt.stikom-bali.ac.id/inbis'
    ].join(' ');

    expect(hasLikelyRawDocumentLeak(rawProfile)).toBe(true);
    const profileResult = evaluateOutboundAnswer(rawProfile, 'bagaimana caranya bergabung inkubator bisnis?');
    expect(profileResult.blocked).toBe(true);
    expect(profileResult.issues).toContain('raw_document_leak');
    expect(profileResult.answer).not.toMatch(/PROFIL LEMBAGA|Identitas Lembaga|Tahun Berdiri|Dasar Hukum/i);

    const rawDivisionProfile = [
      'PROFILE DIVISI KERJA SAMA INTERNASIONAL',
      'DAFTAR ISI',
      'BAB I PENDAHULUAN',
      'Latar Belakang',
      'Maksud dan Tujuan',
      'Ruang Lingkup',
      'Struktur Organisasi',
      'Ketua Sekretaris Bendahara Koordinator'
    ].join(' ');

    const divisionResult = evaluateOutboundAnswer(rawDivisionProfile, 'apa itu divisi kerja sama internasional?');
    expect(divisionResult.blocked).toBe(true);
    expect(divisionResult.issues).toContain('raw_document_leak');
    expect(divisionResult.answer).not.toMatch(/DAFTAR ISI|BAB I|Struktur Organisasi/i);
  });

  test('blocks raw SK and cooperation-document structures beyond the known legal templates', () => {
    const rawDecision = [
      'SURAT KEPUTUSAN REKTOR',
      'Nomor SK: 001/STIKOM/SK/2026',
      'Menimbang bahwa perlu menetapkan pengelola program',
      'Mengingat peraturan yang berlaku',
      'Memutuskan menetapkan susunan pengurus',
      'Ditetapkan di Denpasar',
      'Pada tanggal 28 Juli 2026',
      'Tembusan disampaikan kepada pihak terkait'
    ].join(' ');

    expect(hasLikelyRawDocumentLeak(rawDecision)).toBe(true);
    const decisionResult = evaluateOutboundAnswer(rawDecision, 'siapa yang menangani language learning center?');
    expect(decisionResult.blocked).toBe(true);
    expect(decisionResult.issues).toContain('raw_document_leak');
    expect(decisionResult.answer).not.toMatch(/SURAT KEPUTUSAN|Nomor SK|Menimbang|Memutuskan/i);

    const rawMou = [
      'NOTA KESEPAHAMAN ANTARA ITB STIKOM BALI DAN MITRA',
      'Nomor: 123/MOU/VII/2026',
      'PIHAK PERTAMA dan PIHAK KEDUA sepakat',
      'Pasal 1 Ruang Lingkup',
      'Pasal 2 Hak dan Kewajiban',
      'Lampiran dokumen kerja sama'
    ].join(' ');

    const mouResult = evaluateOutboundAnswer(rawMou, 'apakah ada kerja sama internasional?');
    expect(mouResult.blocked).toBe(true);
    expect(mouResult.issues).toContain('raw_document_leak');
    expect(mouResult.answer).not.toMatch(/NOTA KESEPAHAMAN|PIHAK PERTAMA|Pasal 1|Lampiran/i);
  });

  test('allows concise safe summaries even when the topic comes from a profile document', () => {
    const result = evaluateOutboundAnswer(
      'Inkubator Bisnis ITB STIKOM Bali membantu mahasiswa mengembangkan ide usaha melalui pendampingan, validasi ide, mentoring bisnis, dan penguatan kewirausahaan.',
      'apa itu inkubator bisnis?'
    );
    expect(result.blocked).toBe(false);
    expect(result.issues).not.toContain('raw_document_leak');
    expect(result.answer).toMatch(/Inkubator Bisnis|pendampingan|mentoring/i);
  });
  test('recovers the safe answer portion when a valid summary is followed by raw document text', () => {
    const result = evaluateOutboundAnswer(
      [
        'Inkubator Bisnis ITB STIKOM Bali membantu mahasiswa mengembangkan ide usaha melalui pendampingan, validasi ide, mentoring bisnis, dan penguatan kewirausahaan.',
        'PROFIL LEMBAGA INKUBATOR BISNIS ITB STIKOM BALI Identitas Lembaga Nama Lembaga Inkubator Bisnis ITB STIKOM Bali Tahun Berdiri 2014 Dasar Hukum Surat Keputusan Pendirian Inkubator Bisnis Pembina / Penanggung Jawab Direktorat Kerja Sama, Layanan Industri, dan Inkubator Bisnis Alamat Kampus ITB STIKOM Bali Website ibt.stikom-bali.ac.id/inbis'
      ].join(' '),
      'apa itu inkubator bisnis?'
    );

    expect(result.blocked).toBe(false);
    expect(result.issues).toContain('recovered_raw_document_leak');
    expect(result.answer).toMatch(/Inkubator Bisnis|pendampingan|mentoring/i);
    expect(result.answer).not.toMatch(/PROFIL LEMBAGA|Identitas Lembaga|Tahun Berdiri|Dasar Hukum/i);
  });
  test('recovers greetings from generic safety or system fallbacks without blocking', () => {
    const safeFallback = evaluateOutboundAnswer(
      'Mohon maaf, saya belum mempunyai jawaban yang cukup aman dan lengkap untuk pertanyaan itu berdasarkan data yang tersedia.',
      'Halo bro'
    );
    expect(safeFallback.blocked).toBe(false);
    expect(safeFallback.issues).toContain('recovered_conversation_fallback');
    expect(safeFallback.answer).toMatch(/Halo kak|bantu/i);
    expect(safeFallback.answer).not.toMatch(/belum mempunyai jawaban|berdasarkan data/i);

    const systemFallback = evaluateOutboundAnswer(
      'Maaf kak, sistem kami sedang kendala sehingga pesan tadi belum terbaca dengan benar. Boleh kirim ulang pertanyaannya sekali lagi?',
      'Hallo'
    );
    expect(systemFallback.blocked).toBe(false);
    expect(systemFallback.answer).toMatch(/Halo kak|bantu/i);
    expect(systemFallback.answer).not.toMatch(/sistem kami sedang kendala|belum terbaca/i);
  });
  test('recovers broad conversational variants without treating RAG questions as chat only', () => {
    const variants = [
      'halloooo min',
      'selamat pagi kak',
      'pagi admin',
      'hai kak',
      'tes bot',
      'siap kak',
      'boleh tanya?',
      'izin tanya admin',
      'terima kasih ya'
    ];

    for (const query of variants) {
      const result = evaluateOutboundAnswer(
        'Mohon maaf, saya belum mempunyai jawaban yang cukup aman dan lengkap untuk pertanyaan itu berdasarkan data yang tersedia.',
        query
      );
      expect(result.blocked).toBe(false);
      expect(result.answer).not.toMatch(/belum mempunyai jawaban|sistem kami sedang kendala/i);
    }

    expect(isConversationalQuery('halo apa itu SI?')).toBe(false);
    expect(isConversationalQuery('halo rincian biaya SI')).toBe(false);

    const ragQuestion = evaluateOutboundAnswer(
      'Sistem Informasi adalah program studi di ITB STIKOM Bali.',
      'halo apa itu SI?'
    );
    expect(ragQuestion.blocked).toBe(false);
    expect(ragQuestion.answer).toMatch(/Sistem Informasi/i);
  });


  test('keeps real RAG answers for program and fee questions unblocked', () => {
    const si = evaluateOutboundAnswer(
      'Sistem Informasi adalah program studi yang mempelajari perancangan, pengelolaan, dan pemanfaatan sistem informasi untuk kebutuhan organisasi dan bisnis.',
      'Apa itu si?'
    );
    expect(si.blocked).toBe(false);
    expect(si.answer).toMatch(/Sistem Informasi/i);

    const fee = evaluateOutboundAnswer(
      'Rincian biaya Program Studi Teknologi Informasi gelombang 1C: DPP Rp 10.000.000, SPP tetap Rp 3.000.000, dan biaya lainnya mengikuti ketentuan PMB yang berlaku.',
      'Rincian biaya prodi ti gelombang 1C'
    );
    expect(fee.blocked).toBe(false);
    expect(fee.answer).toMatch(/Teknologi Informasi|gelombang 1C|DPP/i);
  });
});
