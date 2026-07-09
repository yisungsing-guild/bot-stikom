const { chunkText, cleanAnswerLanguage, query, normalizeProgramLabel, normalizeWaveLabel, tryStructuredExactCostAnswer, tryStructuredProgramComparisonAnswer, tryStructuredFeeBreakdownAnswer, tryStructuredProgramRegistrationMenuAnswer, tryStructuredAccreditationAnswer, extractAcademicIntent, extractStructuredEntities, filterRelevantChunks, validateAcademicProgramContexts } = require('../src/engine/ragEngine');
const fs = require('fs');
const path = require('path');
const { getRagIndexPath } = require('../src/utils/ragPaths');

const { tryStructuredProgramRecommendationAnswer } = require('../src/engine/ragEngine');

jest.setTimeout(30000);

describe('ragEngine helpers', () => {
  test('regression: all greeting aliases return identical deterministic greeting', async () => {
    const greetings = ['halo','hai','hi','hello','permisi','selamat pagi','selamat siang','selamat sore','selamat malam'];
    const answers = [];
    for (const text of greetings) {
      const result = await query(text, 5, { includeGlobal: true });
      expect(result.source).toBe('rag-greeting');
      expect(result.answer).toContain('Halo Kak');
      answers.push(result.answer);
    }
    expect(new Set(answers).size).toBe(1);
  });

  test('regression: PMB information is not routed to biaya answer', async () => {
    const result = await query('saya ingin tau tentang pmb', 5, { includeGlobal: true });
    expect(result.source).toBe('rag-pmb-info');
    expect(result.answer).toMatch(/PMB|Penerimaan Mahasiswa Baru/i);
    expect(result.answer).toMatch(/Jalur Pendaftaran/i);
    expect(result.answer).toMatch(/Program Studi/i);
    expect(result.answer).toMatch(/Jadwal/i);
    expect(result.answer).not.toMatch(/^Baik Kak, berikut penjelasan mengenai biaya kuliah/i);
  });

  test('regression: SK in PMB/program context means Sistem Komputer, not SKS', async () => {
    const result = await query('apa itu sk', 5, { includeGlobal: true });
    expect(result.source).toBe('rag-program-profile');
    expect(result.answer).toMatch(/Sistem Komputer/i);
    expect(result.answer).not.toMatch(/Satuan Kredit Semester|SKS/i);
  });

  test('regression: TI and SI program definitions are complete and no resolver internals leak', async () => {
    for (const text of ['apa itu TI', 'apa itu SI']) {
      const result = await query(text, 5, { includeGlobal: true });
      expect(result.source).toBe('rag-program-profile');
      expect(result.answer).toMatch(/Definisi/i);
      expect(result.answer).toMatch(/Kompetensi utama/i);
      expect(result.answer).toMatch(/Lama studi/i);
      expect(result.answer).toMatch(/Gelar/i);
      expect(result.answer).toMatch(/Prospek kerja/i);
      expect(result.answer).toMatch(/Bidang pekerjaan/i);
      expect(result.answer).toMatch(/Akreditasi/i);
      expect(result.answer).not.toMatch(/Ditemukan beberapa data berbeda/i);
    }
  });

  test('regression: detailed fee answer uses normalized requested format without duplicate headings', async () => {
    const result = await query('rincian biaya TI gelombang 1C', 5, { includeGlobal: true });
    expect(result.source).toBe('rag-fee-structured');
    expect(result.answer).toMatch(/Program Studi\s+:\s+Teknologi Informasi/i);
    expect(result.answer).toMatch(/Gelombang\s+:\s+1C/i);
    expect(result.answer).toMatch(/Tahun\s+:\s+2026/i);
    expect(result.answer).toMatch(/Biaya Pendaftaran[\s\S]*[-•]\s*Biaya Pendaftaran: Rp[\s\S]*[-•]\s*Total Pendaftaran: Rp/i);
    expect(result.answer).toMatch(/DPP[\s\S]*[-•]\s*Potongan DPP[\s\S]*[-•]\s*DPP Setelah Potongan[\s\S]*Perlengkapan[\s\S]*Total Awal Masuk: Rp/i);
    expect(result.answer).toMatch(/Potongan Pendaftaran[\s\S]*Rp/i);
    expect(result.answer).not.toMatch(/Formulir|Total Pendaftaran:\s*Rp\s*0/i);
    expect((result.answer.match(/Program Studi/g) || []).length).toBe(1);
    expect(result.answer).not.toMatch(/Sumber:|Ditemukan beberapa data berbeda/i);
  });

  test('regression: cost intent wins over program profile for TI fee queries', async () => {
    const queries = [
      'rincian biaya TI gelombang 1A',
      'rincian biaya Teknologi Informasi gelombang 1A',
      'rincian biaya prodi TI gelombang 1A',
      'informasi biaya TI gelombang 1A'
    ];

    for (const text of queries) {
      const entities = extractStructuredEntities(text);
      expect(entities.intent).toBe('COST');
      expect(entities.program).toBe('TI');
      expect(entities.wave).toBe('1A');

      const result = await query(text, 5, { includeGlobal: true });
      expect(result.source).toBe('rag-fee-structured');
      expect(result.answer).toMatch(/Program Studi\s+:\s+Teknologi Informasi/i);
      expect(result.answer).toMatch(/Gelombang\s+:\s+1A/i);
    }
  }, 30000);

  test('regression: SK course code should not be parsed as semester fee label', () => {
    const question = 'Berapa biaya Sistem Komputer per semester?';
    const top = [
      {
        chunk: 'Program Studi Sistem Komputer SK213225\nBiaya Pendidikan Per Semester 6.000.000\nDana Pendidikan Pokok 12.000.000',
        filename: 'sk_fee.pdf',
        trainingId: 'sk_test'
      }
    ];

    const result = tryStructuredFeeBreakdownAnswer(question, top, {});
    expect(result).toBeTruthy();
    expect(result.answer).toMatch(/Biaya Pendidikan Per Semester/i);
    expect(result.answer).toMatch(/Rp 6\.000\.000/);
    expect(result.answer).not.toMatch(/SK213225/);
  });

  test('regression: extractStructuredEntities recognizes SK semester cost intent', () => {
    const entities = extractStructuredEntities('Berapa biaya Sistem Komputer per semester?');
    expect(entities.intent).toBe('COST');
    expect(entities.program).toBe('SK');
    expect(entities.feeType).toBeNull();
  });

  test('chunkText respects size and overlap', () => {
    const text = 'A'.repeat(3000);
    const chunks = chunkText(text, 1000, 200);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].length).toBeLessThanOrEqual(1000);
  });

  test('cleanAnswerLanguage removes confusing phrases', () => {
    const answer = 'Informasi ini sesuai tabel di dokumen dan di konteks.';
    const cleaned = cleanAnswerLanguage(answer);
    expect(cleaned).not.toMatch(/di tabel/i);
    expect(cleaned).not.toMatch(/di konteks/i);
  });

  test('formatRagAnswer does not insert explicit Follow-up label', () => {
    const { formatRagAnswer } = require('../src/engine/ragEngine');
    const result = formatRagAnswer('Biaya pendaftaran: Rp 500.000.', 'rag-test', 'HIGH', 'Berapa biaya pendaftaran?');
    expect(result).not.toContain('Assistant:');
    expect(result).not.toContain('Follow-up:');
    expect(result).not.toMatch(/CONFIDENCE:\s*(HIGH|LOW)/i);
    expect(result).not.toMatch(/SOURCE_CHUNKS:/i);
    expect(result).toContain('Mau saya jelaskan komponen biaya lain atau opsi potongan yang relevan?');
  });

  test('formatRagAnswer uses context-specific follow-up for scholarship answers', () => {
    const { formatRagAnswer } = require('../src/engine/ragEngine');
    const result = formatRagAnswer('Ada beberapa jenis beasiswa/potongan yang tersedia.', 'rag-test', 'HIGH', 'Apa saja beasiswa yang tersedia?');
    expect(result).not.toContain('Assistant:');
    expect(result).toContain('Perlu saya cek opsi beasiswa atau potongan biaya yang relevan?');
  });

  test('tryStructuredAccreditationAnswer returns a structured answer for SI accreditation questions', () => {
    const index = [
      {
        chunk: 'Program Studi Sistem Informasi\nBadan Akreditasi Nasional Perguruan Tinggi\nAkreditasi Baik Sekali\nNomor SK: 1234/BAN-PT/Ak/S/2024\nMasa berlaku: 05 Okt 2022 - 05 Okt 2027',
        filename: 'si-accreditation.pdf',
        id: 'si-accred-1'
      }
    ];
    const result = tryStructuredAccreditationAnswer('akreditasi si apa?', index);
    expect(result).toBeTruthy();
    expect(result.source).toBe('rag-accreditation');
    expect(result.answer).toMatch(/Sistem Informasi/i);
    expect(result.answer).toMatch(/Baik Sekali/i);
  });

  test('query returns a structured campus location answer for location questions', async () => {
    const result = await query('lokasi stikom dimana ya?', 5, { includeGlobal: true });
    expect(result.source).toBe('rag-campus-location');
    expect(result.answer).toMatch(/ITB STIKOM Bali/i);
    expect(result.answer).toMatch(/Renon|Jimbaran|Abiansemal/i);
  });

  test('tryStructuredProgramComparisonAnswer returns numeric fee comparison for cost questions', () => {
    const index = [
      {
        chunk: 'PROGRAM STUDI SISTEM INFORMASI TA 2025/2026 Gelombang 1A\nPendaftaran Rp 500.000\nDana Pendidikan Pokok (DPP) Rp 10.000.000',
        filename: 'si_fee.pdf',
        id: 'si-test-1'
      },
      {
        chunk: 'PROGRAM STUDI TEKNOLOGI INFORMASI TA 2025/2026 Gelombang 1A\nPendaftaran Rp 600.000\nDana Pendidikan Pokok (DPP) Rp 12.000.000',
        filename: 'ti_fee.pdf',
        id: 'ti-test-1'
      }
    ];

    const result = tryStructuredProgramComparisonAnswer('Bandingkan biaya SI dan TI', index);
    expect(result).toBeTruthy();
    expect(result.source).toBe('rag-program-comparison');
    expect(result.answer).toMatch(/Perbandingan biaya singkat:/i);
    expect(result.answer).toMatch(/Pilihan termurah/i);
    expect(result.answer).toMatch(/Pilihan termahal/i);
    expect(result.answer).toMatch(/Sistem Informasi/i);
    expect(result.answer).toMatch(/Teknologi Informasi/i);
  });

  test('tryStructuredProgramComparisonAnswer includes cheapest and most expensive guidance for broader cost comparison', () => {
    const index = [
      {
        chunk: 'PROGRAM STUDI BISNIS DIGITAL TA 2025/2026 Gelombang 1A\nPendaftaran Rp 500.000\nDana Pendidikan Pokok (DPP) Rp 9.000.000',
        filename: 'bd_fee.pdf',
        id: 'bd-test-1'
      },
      {
        chunk: 'PROGRAM STUDI SISTEM KOMPUTER TA 2025/2026 Gelombang 1A\nPendaftaran Rp 700.000\nDana Pendidikan Pokok (DPP) Rp 13.000.000',
        filename: 'sk_fee.pdf',
        id: 'sk-test-1'
      }
    ];

    const result = tryStructuredProgramComparisonAnswer('Bandingkan biaya semua prodi', index);
    expect(result).toBeTruthy();
    expect(result.answer).toMatch(/Pilihan termurah/i);
    expect(result.answer).toMatch(/Pilihan termahal/i);
    expect(result.answer).toMatch(/Bisnis Digital/i);
    expect(result.answer).toMatch(/Sistem Komputer/i);
  });

  test('tryStructuredProgramComparisonAnswer answers direct cheapest program queries', () => {
    const result = tryStructuredProgramComparisonAnswer('Prodi yang paling murah apa');
    expect(result).toBeTruthy();
    expect(result.answer).toMatch(/Perbandingan biaya singkat:/i);
    expect(result.answer).toMatch(/Catatan:/i);
    expect(result.answer).toMatch(/Pilihan termurah:/i);
    expect(result.answer).toMatch(/Total biaya/i);
    expect(result.answer).toMatch(/Bisnis Digital/i);
    expect(result.answer).toMatch(/Sistem Informasi/i);
  });

  test('tryStructuredProgramComparisonAnswer compares a single mentioned program against other programs for cost questions', () => {
    const result = tryStructuredProgramComparisonAnswer('berapa biaya sistem informasi dibanding prodi lain?');
    expect(result).toBeTruthy();
    expect(result.answer).toMatch(/Perbandingan biaya singkat:/i);
    expect(result.answer).toMatch(/Sistem Informasi/i);
    expect(result.answer).toMatch(/Bisnis Digital/i);
    expect(result.answer).toMatch(/Teknologi Informasi/i);
    expect(result.answer).toMatch(/Sistem Komputer/i);
  });

  test('tryStructuredProgramComparisonAnswer includes MI and D3 in the comparison catalog', () => {
    const result = tryStructuredProgramComparisonAnswer('berapa biaya manajemen informatika dibanding prodi lain?');
    expect(result).toBeTruthy();
    expect(result.answer).toMatch(/Perbandingan biaya singkat:/i);
    expect(result.answer).toMatch(/Manajemen Informatika/i);
    expect(result.answer).toMatch(/D3 Manajemen Informatika/i);
  });

  test('tryStructuredProgramComparisonAnswer answers explicit more expensive queries with a direct clarification', () => {
    const result = tryStructuredProgramComparisonAnswer('Mana yang lebih mahal, S1 Sistem Informasi atau S1 Bisnis Digital?');
    expect(result).toBeTruthy();
    expect(result.answer).toMatch(/Perbandingan biaya singkat:/i);
    expect(result.answer).toMatch(/Catatan:/i);
    expect(result.answer).toMatch(/Pilihan termahal:/i);
    expect(result.answer).toMatch(/Bisnis Digital/i);
    expect(result.answer).toMatch(/Sistem Informasi/i);
  });

  test('validateFinalAnswer rejects medium confidence numeric answers', () => {
    const { validateFinalAnswer } = require('../src/engine/ragEngine');
    const validation = validateFinalAnswer('Biaya pendaftaran Rp 750.000.', {
      source: 'rag-inference-medium',
      confidenceTier: 'MEDIUM',
      contexts: [{ chunk: 'Biaya pendaftaran: Rp 750.000', filename: 'RINCIAN_BIAYA.pdf' }]
    }, 'berapa biaya pendaftaran?');
    expect(validation.valid).toBe(false);
    expect(validation.reason).toBe('medium_with_numeric');
  });

  test('validateNumericGrounding accepts explicit numeric values from official documents', () => {
    const { validateNumericGrounding } = require('../src/engine/ragEngine');
    const validation = validateNumericGrounding('Rp 1.500.000', [
      {
        chunk: 'Biaya pendaftaran: Rp 1.500.000',
        filename: 'RINCIAN_BIAYA.pdf',
        ocrQualityScore: 0.95
      }
    ]);
    expect(validation.valid).toBe(true);
  });

  test('validateNumericGrounding accepts official documents via sourceFile when filename is missing', () => {
    const { validateNumericGrounding } = require('../src/engine/ragEngine');
    const validation = validateNumericGrounding('Rp 1.500.000', [
      {
        chunk: 'Biaya pendaftaran: Rp 1.500.000',
        sourceFile: 'RINCIAN_BIAYA.pdf',
        ocrQualityScore: 0.95
      }
    ]);
    expect(validation.valid).toBe(true);
  });

  test('validateNumericGrounding accepts explicit numeric evidence from a single chunk without OCR quality metadata', () => {
    const { validateNumericGrounding } = require('../src/engine/ragEngine');
    const validation = validateNumericGrounding('Rp 1.500.000', [
      {
        chunk: 'Program Studi Teknologi Informasi TA 2025/2026 Gelombang 2C\nPendaftaran: Rp 1.500.000\nDana Pendidikan Pokok (DPP): Rp 11.000.000',
        filename: 'ti_gelombang_2c.pdf'
      }
    ]);
    expect(validation.valid).toBe(true);
  });

  test('normalizeProgramLabel derives canonical alias from full program name and program abbreviation in context', () => {
    expect(normalizeProgramLabel('Teknologi Rekayasa Perangkat Lunak')).toBe('TRPL');
    expect(normalizeProgramLabel('Program Studi Sistem Informasi')).toBe('SI');
    expect(normalizeProgramLabel('program studi informasi')).toBe('SI');
    expect(normalizeProgramLabel('Program Studi Penyelenggara RPL')).toBe('RPL');
    expect(normalizeProgramLabel('TI belajar apa saja')).toBe('TI');
    expect(normalizeProgramLabel('SI belajar apa saja')).toBe('SI');
    expect(normalizeProgramLabel('MI belajar apa saja')).toBe('MI');
    expect(normalizeProgramLabel('SK belajar apa saja')).toBe('SK');
    expect(normalizeProgramLabel('BD belajar apa saja')).toBe('BD');
    expect(normalizeProgramLabel('apa itu s.kom')).toBe('SK');
    expect(normalizeProgramLabel('apa itu s.k.')).toBe('SK');
    expect(normalizeProgramLabel('Program Studi: Teknologi Informasi dan pengakuan SKS')).toBe('TI');
    expect(normalizeProgramLabel('pengakuan SKS')).toBeNull();
  });

  test('extractStructuredEntities preserves TI when the prompt contains pengakuan SKS', () => {
    const prompt = `Program Studi: Teknologi Informasi\nUser meminta perhitungan total pembayaran untuk mendaftar/biaya awal masuk.\nTugas:\n1) Jika dokumen mencantumkan TOTAL (mis. total biaya awal masuk/total pembayaran), sebutkan totalnya.\n2) Jika tidak ada total, jumlahkan komponen yang tertulis (contoh: biaya pendaftaran + DPP + biaya semester awal/komponen awal masuk) dan tampilkan perhitungannya.\n3) Jika total bergantung skenario (gelombang/potongan, pengakuan SKS, cuti, tesis, atau pilihan pembayaran/cicilan), ajukan maksimal 1 pertanyaan klarifikasi untuk menentukan skenario.\n\nPertanyaan user: Berapa biaya masuk TI?`;
    const entities = extractStructuredEntities(prompt);
    expect(entities.program).toBe('TI');
    expect(entities.programLabel).toBe('TEKNOLOGI_INFORMASI');
  });

  test('extractStructuredEntities recognizes program abbreviations and canonical program labels', () => {
    const entities = extractStructuredEntities('TI belajar apa saja');
    expect(entities.program).toBe('TI');
    expect(entities.programLabel).toBe('TEKNOLOGI_INFORMASI');
  });

  test('extractStructuredEntities recognizes S.Kom program alias for Sistem Komputer', () => {
    let entities = extractStructuredEntities('apa itu s.kom');
    expect(entities.program).toBe('SK');
    expect(entities.programLabel).toBe('SISTEM_KOMPUTER');
    entities = extractStructuredEntities('apa itu s.k.');
    expect(entities.program).toBe('SK');
    expect(entities.programLabel).toBe('SISTEM_KOMPUTER');
  });

  test('extractAcademicIntent recognizes academic program sub-intents', () => {
    expect(extractAcademicIntent('Apa itu Teknologi Informasi?')).toBe('DEFINISI_PRODI');
    expect(extractAcademicIntent('TI belajar apa saja?')).toBe('MATA_KULIAH');
    expect(extractAcademicIntent('Apa yang dipelajari di TI?')).toBe('MATA_KULIAH');
    expect(extractAcademicIntent('Materi perkuliahan BD apa?')).toBe('MATA_KULIAH');
    expect(extractAcademicIntent('Bagaimana prospek kerja TI?')).toBe('PROSPEK_KERJA');
    expect(extractAcademicIntent('Berapa biaya prodi TI?')).toBe('BIAYA');
    expect(extractAcademicIntent('Akreditasi BD bagaimana?')).toBe('AKREDITASI');
  });

  test('regression: career-prospect questions use retrieval context instead of generic lexical fallback', async () => {
    const result = await query('bagaimana prospek kerja teknologi informasi', 5, { includeGlobal: true });
    expect(result.source).not.toBe('rag-lexical-fallback');
    expect(String(result.answer || '')).toMatch(/prospek kerja|karir|lulusan|pekerjaan/i);
  });

  test('regression: career-prospect questions with program abbreviations use the structured career handler', async () => {
    const result = await query('bagaimana prospek kerja si?', 5, { includeGlobal: true });
    expect(result.source).toBe('rag-program-career-role');
    expect(String(result.answer || '')).toMatch(/Sistem Informasi/i);
    expect(String(result.answer || '')).toMatch(/peran|bidang kerja|pekerjaan|prospek kerja/i);
  });

  test.each([
    ['apa kabar?', 'sapaan|baik|bisa bantu|halo'],
    ['apa itu prodi ti?', 'teknologi informasi|program studi|profil'],
    ['gelombang apa saja yang ada?', 'gelombang|pmb'],
    ['sekarang buka gelombang berapa?', 'gelombang|sedang buka|terbuka'],
    ['apa saja program double degree?', 'double degree|utb|dnui|help'],
    ['apakah ada program double degree internasional?', 'internasional|dnui|help'],
    ['apakah ada program double degree nasional?', 'nasional|utb'],
    ['biaya mana yang paling murah?', 'biaya|murah|terjangkau|sebutkan']
  ])('common question %s is answered with relevant content', async (question, expectedPattern) => {
    const result = await query(question, 5, { includeGlobal: true });
    expect(result && result.success).toBe(true);
    expect(String(result.answer || '')).toMatch(new RegExp(expectedPattern, 'i'));
  });

  test('regression: fee intent wins when prodi and gelombang present', () => {
    expect(extractAcademicIntent('Berapa biaya prodi TI gelombang 3A?')).toBe('BIAYA');
    expect(extractAcademicIntent('Berapa biaya prodi Sistem Informasi gelombang 3A?')).toBe('BIAYA');
  });

  test('filterRelevantChunks removes off-topic academic chunks for program definition queries', () => {
    const queryEntities = { intent: 'ACADEMIC_PROGRAM', academicIntent: 'DEFINISI_PRODI', program: 'TI' };
    const scored = [
      {
        item: {
          chunk: 'Program Studi Teknologi Informasi adalah program yang mempelajari sistem informasi dan teknologi jaringan.',
          filename: 'TI_profile.pdf',
          category: 'PROGRAM_STUDI',
          chunkType: 'GENERAL',
          excludeFromSearch: false,
          retrievalWeight: 1
        },
        score: 0.92
      },
      {
        item: {
          chunk: 'Biaya pendaftaran TI Rp 600.000 untuk calon mahasiswa baru.',
          filename: 'TI_biaya.pdf',
          category: 'BIAYA',
          chunkType: 'GENERAL',
          excludeFromSearch: false,
          retrievalWeight: 1
        },
        score: 0.89
      },
      {
        item: {
          chunk: 'MOU kerja sama TI dengan mitra industri dan lembaga.',
          filename: 'TI_mou.pdf',
          category: 'SK',
          chunkType: 'GENERAL',
          excludeFromSearch: false,
          retrievalWeight: 1
        },
        score: 0.85
      }
    ];

    const filtered = filterRelevantChunks('Apa itu TI?', scored, queryEntities);
    expect(filtered.length).toBe(1);
    expect(filtered[0].item.category).toBe('PROGRAM_STUDI');
  });

  test('validateAcademicProgramContexts rejects irrelevant academic contexts', () => {
    const queryEntities = { intent: 'ACADEMIC_PROGRAM', academicIntent: 'DEFINISI_PRODI', program: 'TI' };
    const topScored = [
      {
        item: {
          chunk: 'Biaya pendaftaran TI Rp 600.000 untuk calon mahasiswa baru.',
          filename: 'TI_biaya.pdf',
          category: 'BIAYA'
        }
      }
    ];
    expect(validateAcademicProgramContexts('Apa itu TI?', topScored, queryEntities)).toBe(false);
  });

  test('tokenizeForRelevanceGuard preserves short program aliases like BD and SI', () => {
    const { tokenizeForRelevanceGuard } = require('../src/engine/ragEngine');
    const tokens = tokenizeForRelevanceGuard('apa itu BD');
    expect(tokens).toContain('bd');
    expect(tokens).not.toContain('apa');
    expect(tokens).not.toContain('itu');
  });

  test('loadIndex is exported from ragEngine for debug and index access', () => {
    const rag = require('../src/engine/ragEngine');
    expect(typeof rag.loadIndex).toBe('function');
  });

  test('normalizeWaveLabel normalizes wave variants to compact canonical forms', () => {
    expect(normalizeWaveLabel('gelombang 2c')).toBe('2C');
    expect(normalizeWaveLabel('Gelombang IV A')).toBe('4A');
    expect(normalizeWaveLabel('gelombang khusus')).toBe('KHUSUS');
  });

  test('tryStructuredExactCostAnswer merges global wave 1 discounts into SK 1A cost output', () => {
    const queryEntities = { intent: 'COST', program: 'SK', wave: '1A', waveGroup: '1', academicYear: '2025', campus: 'BALI' };
    const chunks = [
      {
        chunk: 'PROGRAM STUDI SISTEM KOMPUTER TA 2025/2026 Gelombang 1A\nPendaftaran 500.000\nDana Pendidikan Pokok (DPP) 11.000.000',
        filename: 'PMB_2025_SK.pdf',
        updatedAt: new Date().toISOString(),
        source: 'upload',
        embedding: Array(64).fill(0)
      },
      {
        chunk: 'Potongan Biaya Pendaftaran: Rp 200.000, Jika Mendaftar pada Gelombang 1\nPotongan DPP: Rp 1.000.000, Gelombang 1',
        filename: 'PMB_2025_GLOBAL_DISCOUNT.pdf',
        updatedAt: new Date().toISOString(),
        source: 'upload',
        embedding: Array(64).fill(0)
      }
    ];
    const result = tryStructuredExactCostAnswer('berapa biaya prodi sk gelombang 1A?', queryEntities, chunks, 3, Array(64).fill(0));
    expect(result).toBeTruthy();
    expect(result.answer).toMatch(/Program Studi\s*:/);
    expect(result.answer).toMatch(/Gelombang\s*:\s*1A/);
    expect(result.answer).toMatch(/Biaya Pendaftaran[\s\S]*Potongan Pendaftaran[\s\S]*Rp\s*200\.000/i);
    expect(result.answer).toMatch(/Biaya Pendaftaran[\s\S]*Total Pendaftaran:\s*Rp\s*300\.000/i);
    expect(result.answer).not.toMatch(/Formulir|Total Pendaftaran:\s*Rp\s*0/i);
  });

  test('tryStructuredExactCostAnswer preserves explicit registration discount phrasing without potongan', () => {
    const queryEntities = { intent: 'COST', program: 'SI', wave: '1A', waveGroup: '1' };
    const chunks = [
      {
        chunk: 'PROGRAM STUDI SISTEM INFORMASI TA 2026/2027 Gelombang 1A\nDana Pendidikan Pokok (DPP) Rp 7.000.000',
        filename: 'PMB_2026_SI.pdf',
        updatedAt: new Date().toISOString(),
        source: 'upload',
        embedding: Array(64).fill(0)
      },
      {
        chunk: 'Rp. 2.000.000,- Jika Registrasi pada Gelombang I',
        filename: 'PMB_2026_SI_DISCOUNT.pdf',
        updatedAt: new Date().toISOString(),
        source: 'upload',
        embedding: Array(64).fill(0)
      }
    ];
    const result = tryStructuredExactCostAnswer('berapa biaya prodi si gelombang 1A?', queryEntities, chunks, 3, Array(64).fill(0));
    expect(result).toBeTruthy();
    expect(result.answer).toMatch(/Potongan Pendaftaran/i);
    expect(result.answer).toMatch(/Rp\s*2\.000\.000/);
  });

  test('query returns enrollment discount output with requested wave formatting for 1A', async () => {
    const res = await query('biaya prodi si gelombang 1A?');
    expect(res && res.success).toBe(true);
    expect(String(res.answer || '')).toMatch(/Gelombang\s*1A/i);
    expect(String(res.answer || '')).toMatch(/Rp\s*250\.000/i);
  });

  test('tryStructuredExactCostAnswer repairs OCR noise in numeric fee values', () => {
    const queryEntities = { intent: 'COST', program: 'SK', wave: '1A', waveGroup: '1', academicYear: '2025', campus: 'BALI' };
    const chunks = [
      {
        chunk: 'PROGRAM STUDI SISTEM KOMPUTER TA 2025/2026 Gelombang 1A\nPendaftaran Rp. l.OOO.OOO Pada Saat Daftar',
        filename: 'PMB_2025_SK.pdf',
        updatedAt: new Date().toISOString(),
        source: 'upload',
        embedding: Array(64).fill(0)
      }
    ];
    const result = tryStructuredExactCostAnswer('berapa biaya pendaftaran prodi sk gelombang 1A?', queryEntities, chunks, 3, Array(64).fill(0));
    expect(result).toBeTruthy();
    expect(result.answer).toContain('Rp 1.000.000');
  });

  test('tryStructuredExactCostAnswer prioritizes latest academic year when year not specified', () => {
    const queryEntities = { intent: 'COST', program: 'TI', wave: '2C', waveGroup: '2' };
    const chunks = [
      {
        chunk: 'PROGRAM STUDI TEKNOLOGI INFORMASI TA 2024/2025 Gelombang 2C\nPendaftaran 600.000\nDana Pendidikan Pokok (DPP) 10.500.000',
        filename: 'PMB_2024_TI.pdf',
        updatedAt: '2024-10-01T00:00:00.000Z',
        source: 'upload',
        embedding: Array(64).fill(0)
      },
      {
        chunk: 'PROGRAM STUDI TEKNOLOGI INFORMASI TA 2025/2026 Gelombang 2C\nPendaftaran 650.000\nDana Pendidikan Pokok (DPP) 11.000.000',
        filename: 'PMB_2025_TI.pdf',
        updatedAt: '2025-10-01T00:00:00.000Z',
        source: 'upload',
        embedding: Array(64).fill(0)
      }
    ];
    const result = tryStructuredExactCostAnswer('berapa biaya prodi ti gelombang 2C?', queryEntities, chunks, 3, Array(64).fill(0));
    expect(result).toBeTruthy();
    expect(result.answer).toContain('2025');
    expect(result.answer).toContain('Rp 11.000.000');
  });

  test('tryStructuredExactCostAnswer uses full fee formatter when fee data exists in a single chunk without OCR quality metadata', () => {
    const queryEntities = { intent: 'COST', program: 'TI', wave: '2C', waveGroup: '2', academicYear: '2025' };
    const chunks = [
      {
        chunk: 'PROGRAM STUDI TEKNOLOGI INFORMASI TA 2025/2026 Gelombang 2C\nPendaftaran Rp 650.000\nDana Pendidikan Pokok (DPP) Rp 11.000.000\nJas almamater dan topi\nKaos, tas, GMTI',
        filename: 'ti_2c_biaya_detail.pdf',
        updatedAt: new Date().toISOString(),
        source: 'upload',
        embedding: Array(64).fill(0)
      }
    ];
    const result = tryStructuredExactCostAnswer('berapa biaya prodi ti gelombang 2C?', queryEntities, chunks, 3, Array(64).fill(0));
    expect(result).toBeTruthy();
    expect(result.source).toBe('rag-fee-structured');
    expect(result.answer).toContain('Biaya Pendaftaran');
    expect(result.answer).toContain('DPP:');
  });

  test('tryStructuredExactCostAnswer does not duplicate wave label in full fee answer', () => {
    const queryEntities = { intent: 'COST', program: 'TI', wave: '1C', waveGroup: '1', academicYear: '2026' };
    const chunks = [
      {
        chunk: 'PROGRAM STUDI TEKNOLOGI INFORMASI TA 2026/2027 Gelombang 1C\nPendaftaran Rp 500.000\nDana Pendidikan Pokok (DPP) Rp 14.000.000\nJas almamater, Topi, Kaos, Tas, GMTI',
        filename: 'ti_1c_biaya_detail.pdf',
        updatedAt: new Date().toISOString(),
        source: 'upload',
        embedding: Array(64).fill(0)
      }
    ];
    const result = tryStructuredExactCostAnswer('berapa rincian biaya prodi ti gelombang 1C?', queryEntities, chunks, 3, Array(64).fill(0));
    expect(result).toBeTruthy();
    expect(result.answer).toContain('Gelombang: 1C');
    const waveMatches = String(result.answer).match(/Gelombang\b/gi) || [];
    expect(waveMatches.length).toBe(1);
  });

  test('tryStructuredExactCostAnswer rejects inconsistent exact cost queries without reliable fee evidence', () => {
    const queryEntities = { intent: 'COST', program: 'TI', wave: '2C', waveGroup: '2', academicYear: '2025' };
    const chunks = [
      {
        chunk: 'Potongan Biaya Pendaftaran: Rp 300.000, Gelombang 3',
        filename: 'PMB_2025_TI_DISCOUNT_WRONG_WAVE.pdf',
        updatedAt: new Date().toISOString(),
        source: 'upload',
        embedding: Array(64).fill(0)
      }
    ];
    const result = tryStructuredExactCostAnswer('berapa biaya prodi ti gelombang 2C?', queryEntities, chunks, 3, Array(64).fill(0));
    expect(result).toBeTruthy();
    expect(result.answer).toContain('Data biaya tidak dapat dipastikan');
  });

  test('tryStructuredExactCostAnswer rejects explicit exact match cost query when no matching chunk exists', () => {
    const queryEntities = { intent: 'COST', program: 'SI', wave: '2A' };
    const result = tryStructuredExactCostAnswer(
      'berapa biaya pendaftaran prodi si gelombang 2A?',
      queryEntities,
      [
        {
          chunk: 'Biaya pendaftaran Sistem Komputer Gelombang 2A: Rp 500.000',
          program: 'SK',
          wave: '2A',
          embedding: Array(64).fill(0)
        }
      ],
      3,
      Array(64).fill(0)
    );
    expect(result).toBeTruthy();
    expect(result.source).toBe('rag-answer-rejected');
    expect(String(result.answer || '').toLowerCase()).toMatch(/tidak ditemukan/);
  });

  test('tryStructuredExactCostAnswer does not fall back to different wave for explicit suffix wave', () => {
    const queryEntities = { intent: 'COST', program: 'SI', wave: '1C', waveGroup: '1' };
    const chunks = [
      {
        chunk: 'PROGRAM STUDI SISTEM INFORMASI TA 2025/2026 Gelombang Khusus\nPendaftaran 500.000\nDana Pendidikan Pokok (DPP) 14.000.000',
        filename: 'PMB_2025_SI.pdf',
        updatedAt: new Date().toISOString(),
        source: 'upload',
        embedding: Array(64).fill(0)
      }
    ];
    const result = tryStructuredExactCostAnswer('berapa biaya prodi si gelombang 1C?', queryEntities, chunks, 3, Array(64).fill(0));
    expect(result).toBeTruthy();
    expect(result.source).toBe('rag-answer-rejected');
    expect(String(result.answer || '').toLowerCase()).toMatch(/tidak ditemukan|tidak dapat dipastikan/);
  });

  test('validateFinalAnswer rejects high confidence numeric without explicit source evidence', () => {
    const { validateFinalAnswer } = require('../src/engine/ragEngine');
    const validation = validateFinalAnswer('Rp 1.500.000', {
      source: 'ai',
      confidenceTier: 'HIGH',
      contexts: [{ chunk: 'Data biaya tidak tersedia di dokumen ini.', filename: 'README.txt' }]
    }, 'berapa biaya pendaftaran?');
    expect(validation.valid).toBe(false);
    expect(validation.reason).toBe('numeric_not_grounded');
  });

  test('isSafeForInference blocks numeric/temporal inference questions', () => {
    const { isSafeForInference } = require('../src/engine/ragEngine');
    expect(isSafeForInference('berapa biaya pendaftaran?', null, 'MEDIUM')).toBe(false);
    expect(isSafeForInference('kapan deadline pendaftaran?', null, 'MEDIUM')).toBe(false);
  });

  test('program recommendation heuristic does not trigger on curriculum detail questions', async () => {
    const result = await tryStructuredProgramRecommendationAnswer('Program Studi: Sistem Informasi\nDi Sistem Informasi belajar apa saja?', []);
    expect(result).toBeNull();
  });
});

describe('ragEngine schedule overview guard', () => {
  const prevEnv = { ...process.env };

  beforeAll(() => {
    // Keep tests deterministic and avoid depending on embedding similarity thresholds.
    process.env.RAG_MIN_SCORE = '0';
    delete process.env.OPENAI_API_KEY;
  });

  afterAll(() => {
    process.env = prevEnv;
  });

  test('accreditation question for BD is answered from index text (deterministic)', async () => {
    const indexPath = getRagIndexPath();
    const before = fs.readFileSync(indexPath, 'utf-8');

    try {
      const list = JSON.parse(before || '[]');
      list.push({
        id: 'test-accred-1',
        trainingId: 'test-training-accred',
        chunk: 'SERTIFIKAT AKREDITASI PROGRAM STUDI BISNIS DIGITAL (BD) — TERAKREDITASI BAIK SEKALI. SK No: 0123/BAN-PT/AK/S/2024. Masa berlaku 05 Okt 2022 s/d 05 Okt 2027.',
        embedding: Array(64).fill(0),
        source: 'upload',
        createdAt: new Date().toISOString(),
      });
      fs.writeFileSync(indexPath, JSON.stringify(list, null, 2));

      const contextual = [
        'Pertanyaan sebelumnya dari user: "berapa biaya pendaftaran?"',
        'Balasan terakhir dari bot: "Biaya pendaftaran Rp 500.000"',
        'Balasan user saat ini: "akred bd apaa kak??"',
        'Tolong jawab lanjutan secara spesifik berdasarkan konteks di atas.'
      ].join('\n');

      const res = await query(contextual);
      expect(res && res.success).toBe(true);
      expect(res.source).toBe('rag-accreditation');
      const ans = String(res.answer || '');
      expect(ans).toMatch(/Bisnis\s+Digital/i);
      expect(ans).toMatch(/Baik\s+Sekali/i);
      expect(ans).toMatch(/Nomor\s+SK/i);
      expect(ans).toMatch(/Masa\s+berlaku/i);
    } finally {
      fs.writeFileSync(indexPath, before);
    }
  });

  test('schedule-only question without wave triggers schedule overview prompt', async () => {
    const res = await query('jadwal PMB');
    expect(res && res.success).toBe(true);
    expect(res.source).toBe('rag-schedule-overview');
    expect(String(res.answer || '')).toMatch(/gelombang/i);
  });

  test('program overview includes MI in the S1 program list', async () => {
    const res = await query('ada program studi apa saja?');
    expect(res && res.success).toBe(true);
    expect(res.source).toBe('rag-prodi-overview');
    expect(String(res.answer || '')).toMatch(/Manajemen\s+Informatika/i);
  });

  test('hobby business signals: "tawar-menawar" maps to Bisnis Digital (handles "cocokan" typo)', async () => {
    const res = await query('kalo anak saya suka tawar menawar cocokan masuk apa?');
    expect(res && res.success).toBe(true);
    expect(String(res.source || '')).toMatch(/^rag-major-recommendation/);
    expect(String(res.answer || '')).toMatch(/Bisnis\s+Digital/i);
    expect(String(res.answer || '')).not.toMatch(/Sistem\s+Komputer/i);
  });

  test('coding hobby routes to Teknologi Informasi (TI)', async () => {
    const res = await query('hoby saya suka ngoding cocok jurusan apa?');
    expect(res && res.success).toBe(true);
    expect(res.source).toBe('rag-major-recommendation-hoby-doc-lines');
    expect(String(res.answer || '')).toMatch(/Teknologi\s+Informasi|TI/i);
  });

  test('process-work and case-study language routes to Sistem Informasi (SI)', async () => {
    const res = await query('saya suka menganalisis proses kerja dan studi kasus di perusahaan, jurusan apa yang cocok?');
    expect(res && res.success).toBe(true);
    expect(String(res.source || '')).toMatch(/^rag-major-recommendation/);
    expect(String(res.answer || '')).toMatch(/Sistem\s+Informasi|SI/i);
    expect(String(res.answer || '')).not.toMatch(/Biar aku bisa cocokin jurusan/i);
  });

  test('career-role question for Bisnis Digital uses career-oriented answer instead of hobby recommendation', async () => {
    const res = await query('kalau jurusan bisni digital itu bisa bekerja sebagai apa ya?');
    expect(res && res.success).toBe(true);
    expect(String(res.source || '')).not.toMatch(/^rag-major-recommendation/);
    expect(String(res.answer || '')).toMatch(/Bisnis\s+Digital/i);
    expect(String(res.answer || '')).toMatch(/digital|marketing|e-commerce|content|analisis|bisnis/i);
  });

  test('S1 cheapest-program question compares S1 programs and excludes D3 from the recommendation', async () => {
    const res = await query('untuk biaya, jurusan s1 mana yang paling murah?');
    expect(res && res.success).toBe(true);
    expect(String(res.answer || '')).toMatch(/paling\s+murah|paling\s+mahal|Sistem\s+Informasi|Bisnis\s+Digital/i);
    expect(String(res.answer || '')).not.toMatch(/D3\s+Manajemen\s+Informatika/i);
  });

  test('dual-degree benefit question explains advantages instead of listing programs', async () => {
    const res = await query('jurusan double degree itu apa keuntungannya?');
    expect(res && res.success).toBe(true);
    expect(String(res.answer || '')).toMatch(/keuntungan|benefit|gelar|internasional|mitra|pengalaman|lebih\s+unggul/i);
    expect(String(res.answer || '')).not.toMatch(/Kakak\s+mau\s+info\s+Dual\s+Degree/i);
  });

  test('coding hobby without hobby-doc fallback still routes to Teknologi Informasi (TI)', async () => {
    const res = await tryStructuredProgramRecommendationAnswer('saya suka ngoding cocok jurusan apa?', []);
    expect(res).toBeTruthy();
    expect(String(res.answer || '')).toMatch(/Teknologi\s+Informasi|TI/i);
    expect(String(res.source || '')).toMatch(/^rag-major-recommendation/);
  });

  test('casual coding hobby without explicit question still routes to Teknologi Informasi (TI)', async () => {
    const res = await tryStructuredProgramRecommendationAnswer('aku hobby ngoding', []);
    expect(res).toBeTruthy();
    expect(String(res.answer || '')).toMatch(/Teknologi\s+Informasi|TI/i);
    expect(String(res.answer || '')).not.toMatch(/Sistem\s+Informasi bisa jadi pilihan yang tepat/i);
  });

  test('unknown hobby does not default to SK (asks for concrete activity examples)', async () => {
    const res = await query('anak saya suka memasak cocok jurusan apa?');
    expect(res && res.success).toBe(true);
    const ans = String(res.answer || '');
    // Should not drift into a specific major like SK.
    expect(ans).not.toMatch(/Sistem\s+Komputer/i);
  });

  test('wave list question returns available waves (no wave guessing)', async () => {
    const res = await query('Ada gelombang berapa aja emangnya kak?');
    expect(res && res.success).toBe(true);
    expect(res.source).toBe('rag-wave-list');
    expect(String(res.answer || '')).toMatch(/gelombang\s+pmb/i);
    expect(String(res.answer || '')).not.toMatch(/Anda ingin informasi apa untuk gelombang/i);
  });

  test('confidence threshold: below 0.65 is treated as no answer', async () => {
    const prev = process.env.RAG_MIN_CONFIDENCE_SCORE;
    process.env.RAG_MIN_CONFIDENCE_SCORE = '0.65';

    const res = await query('Apa persyaratan untuk melakukan pendaftaran kuliah di STIKOM Bali?');
    expect(res && res.success).toBe(true);
    expect(res.source).toBe('rag-low-confidence');
    expect(res.answer).toBeNull();
    expect(typeof res.confidenceScore).toBe('number');
    expect(res.confidenceScore).toBeLessThan(0.65);

    if (prev === undefined) delete process.env.RAG_MIN_CONFIDENCE_SCORE;
    else process.env.RAG_MIN_CONFIDENCE_SCORE = prev;
  });

  test('program registration menu detects MI from program hint', () => {
    const res = tryStructuredProgramRegistrationMenuAnswer('pendaftaran prodi mi', { conversationContext: '' });
    expect(res).toBeTruthy();
    expect(String(res.answer || '')).toMatch(/Manajemen\s+Informatika/i);
  });

  test('program registration fee question returns short answer (SI)', async () => {
    const res = await query('berapa biaya pendaftaran prodi si');
    expect(res && res.success).toBe(true);
    expect(res.source).toBe('rag-program-fee-registration');
    expect(String(res.answer || '')).toMatch(/Sistem\s+Informasi/i);
    expect(String(res.answer || '')).toMatch(/Rp\s*500\.000/i);
    // Keep it short (avoid sending multi-page table to WhatsApp).
    expect(String(res.answer || '').length).toBeLessThan(240);
  });

  test('fee breakdown follow-up for SI returns structured breakdown (not program list)', async () => {
    const res = await query('biaya lengkap prodi si ada apa saja?');
    expect(res && res.success).toBe(true);
    expect(res.source).toBe('rag-fee-breakdown');

    const answer = String(res.answer || '');
    expect(answer).toMatch(/Sistem\s+Informasi/i);
    expect(answer).toMatch(/Pendaftaran/i);
    expect(answer).toMatch(/Dana\s+Pendidikan\s+Pokok/i);
    expect(answer).toMatch(/Biaya\s+Pendidikan\s+Per\s+Semester/i);

    // Should answer fee components, not switch to listing all programs.
    expect(answer).not.toMatch(/Program\s+studi\s+yang\s+tersedia/i);
    expect(answer).not.toMatch(/Program\s+studi\s+yang\s+tersedia\s+di/i);

    // Should not leak document contact headers (OCR noise).
    expect(answer).not.toMatch(/\bhotline\b/i);
    expect(answer).not.toMatch(/\bemail\b/i);
    expect(answer).not.toMatch(/\bwebsite\b/i);
    expect(answer).not.toMatch(/\bfax\b/i);
  });

  test('UKT/per-semester question for SI returns semester-only fee (no full breakdown)', async () => {
    const res = await query('berapa biaya ukt prodi si?');
    expect(res && res.success).toBe(true);
    expect(res.source).toBe('rag-fee-semester-only');

    const answer = String(res.answer || '');
    expect(answer).toMatch(/Sistem\s+Informasi/i);
    expect(answer).toMatch(/biaya\s+pendidikan\s+per\s+semester|UKT/i);
    expect(answer).toMatch(/Rp\s*[0-9]/i);

    // Should not include other components.
    expect(answer).not.toMatch(/Dana\s+Pendidikan\s+Pokok/i);
    expect(answer).not.toMatch(/\bPendaftaran\b/i);
    expect(answer).not.toMatch(/Jas|Kaos|Pengalaman\s+Industri/i);
  });

  test('avoid misparsing SK course codes as semester fee amounts', async () => {
    const res = await query('Biaya Sistem Komputer per semester?');
    expect(res && res.success).toBe(true);
    expect(res.source).not.toBe('rag-fee-semester-only');
    expect(String(res.answer || '')).not.toMatch(/213225/);
  });

  test('fee breakdown: prior dual-degree mention does not override current SI shorthand', async () => {
    // Simulate provider anchoring: prior context + Follow-up marker.
    const anchored = 'Saya mau tanya HELP University dual degree.\nFollow-up: biaya lengkap si ada apa saja?';
    const res = await query(anchored);
    expect(res && res.success).toBe(true);
    expect(res.source).toBe('rag-fee-breakdown');

    const answer = String(res.answer || '');
    expect(answer).toMatch(/Sistem\s+Informasi/i);
    expect(answer).not.toMatch(/HELP\b/i);
    expect(answer).not.toMatch(/Malaysia/i);
  });

  test('general dual degree question lists UTB, DNUI, and HELP', async () => {
    const res = await query('apakah ada program dual degree di stikom?');
    expect(res && res.success).toBe(true);
    expect(res.source).toBe('rag-dual-degree-list');
    const answer = String(res.answer || '');
    expect(answer).toMatch(/UTB/i);
    expect(answer).toMatch(/DNUI/i);
    expect(answer).toMatch(/HELP/i);
  });

  test('double degree international question lists only international partners', async () => {
    const res = await query('apakah ada di stikom program double degree internasional?');
    expect(res && res.success).toBe(true);
    expect(res.source).toBe('rag-dual-degree-list');

    const answer = String(res.answer || '');
    expect(answer).toMatch(/DNUI/i);
    expect(answer).toMatch(/HELP/i);
    expect(answer).not.toMatch(/UTB\b/i);
  });

  test('double degree national question lists only UTB', async () => {
    const res = await query('apakah ada di stikom program double degree nasional?');
    expect(res && res.success).toBe(true);
    expect(res.source).toBe('rag-dual-degree-list');

    const answer = String(res.answer || '');
    expect(answer).toMatch(/UTB/i);
    expect(answer).not.toMatch(/DNUI\b/i);
    expect(answer).not.toMatch(/HELP\b/i);
  });

  test('dual/double degree discount question returns only DPP discount list (no UTB/DNUI/HELP)', async () => {
    const res = await query('kalau biaya untuk double degree apakah ada potongan biaya?');
    expect(res && res.success).toBe(true);
    expect(res.source).toBe('rag-dual-degree-dpp-discount');

    const answer = String(res.answer || '');
    expect(answer).toMatch(/Potongan\s+DPP/i);
    expect(answer).toMatch(/Double\s*\/\s*Dual\s*Degree/i);
    expect(answer).toMatch(/Gelombang\s+Khusus/i);
    expect(answer).toMatch(/Gelombang\s+I\b/i);
    expect(answer).toMatch(/Gelombang\s+II\b/i);
    expect(answer).toMatch(/Gelombang\s+III\b/i);
    expect(answer).toMatch(/Gelombang\s+IV\b/i);
    expect(answer).toMatch(/Rp\.?\s*3\.000\.000/i);
    expect(answer).toMatch(/Rp\.?\s*2\.000\.000/i);
    expect(answer).toMatch(/Rp\.?\s*1\.500\.000/i);
    expect(answer).toMatch(/Rp\.?\s*1\.000\.000/i);
    expect(answer).toMatch(/Rp\.?\s*500\.000/i);

    // Must not mention specific partner universities in this UX.
    expect(answer).not.toMatch(/UTB\b/i);
    expect(answer).not.toMatch(/DNUI\b/i);
    expect(answer).not.toMatch(/HELP\b/i);
  });

  test('current wave question returns currently open waves (realtime by date)', async () => {
    // 2026-04-01 in WITA (UTC+8) => 2026-04-01T04:00:00Z
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-01T04:00:00.000Z'));

    const res = await query('sekarang gelombang berapa yang lagi buka?');
    expect(res && res.success).toBe(true);
    expect(res.source).toBe('rag-current-open-waves');
    expect(String(res.answer || '')).toMatch(/sedang\s+buka/i);
    expect(String(res.answer || '')).toMatch(/Gelombang\s+II\s+B/i);
    expect(String(res.answer || '')).toMatch(/29\s+Maret\s+2026\s*[–-]\s*18\s+April\s+2026/i);

    jest.useRealTimers();
  });

  test('current wave question before first window returns upcoming wave', async () => {
    // 2025-10-10 in WITA => 2025-10-10T04:00:00Z
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-10-10T04:00:00.000Z'));

    const res = await query('gelombang apa yang sekarang terbuka?');
    expect(res && res.success).toBe(true);
    expect(res.source).toBe('rag-current-open-waves');
    expect(String(res.answer || '')).toMatch(/belum\s+ada\s+gelombang\s+yang\s+sedang\s+buka/i);
    expect(String(res.answer || '')).toMatch(/Gelombang\s+Khusus/i);
    expect(String(res.answer || '')).toMatch(/28\s+Oktober\s+2025\s*[–-]\s*27\s+Desember\s+2025/i);

    jest.useRealTimers();
  });

  test('wave list phrasing variants still return wave list', async () => {
    const qs = [
      'gelombang apa aja?',
      'gelombang berapa?',
      'berapa gelombang?',
      'ada gelombang apa saja?'
    ];

    for (const q of qs) {
      const res = await query(q);
      expect(res && res.success).toBe(true);
      expect(res.source).toBe('rag-wave-list');
    }
  });

  test('anchored follow-up still parses wave list from current question only', async () => {
    const q = 'jadwal PMB\nFollow-up: ada gelombang berapa aja?';
    const res = await query(q);
    expect(res && res.success).toBe(true);
    expect(res.source).toBe('rag-wave-list');
  });

  test('mentions specific wave without intent triggers clarify-wave (not wave list)', async () => {
    const res = await query('gelombang 3 a');
    expect(res && res.success).toBe(true);
    expect(res.source).toBe('rag-clarify-wave');
    expect(String(res.answer || '')).toMatch(/Anda ingin informasi apa/i);
  });

  test('must-pay phrasing counts as intent (does not trigger clarify-wave menu)', async () => {
    const res = await query('gelombang 2 b jadi berapa saya harus bayar?');
    expect(res && res.success).toBe(true);
    expect(res.source).not.toBe('rag-clarify-wave');
  });

  test('schedule for roman-only wave is grouped and deduped (no repeated IV A/B/C blocks)', async () => {
    const res = await query('jadwal gelombang 4');
    expect(res && res.success).toBe(true);
    expect(res.source).toBe('rag-schedule-rule-grouped');

    const answer = String(res.answer || '');
    const count = (re) => (answer.match(re) || []).length;

    expect(count(/\n-\s*IV\s+A\b/g)).toBe(1);
    expect(count(/\n-\s*IV\s+B\b/g)).toBe(1);
    expect(count(/\n-\s*IV\s+C\b/g)).toBe(1);

    // Ensure the choices line isn't duplicated like "IV A, IV A".
    expect(answer).not.toMatch(/IV\s+A\s*,\s*IV\s+A/i);
    expect(answer).not.toMatch(/IV\s+B\s*,\s*IV\s+B/i);
    expect(answer).not.toMatch(/IV\s+C\s*,\s*IV\s+C/i);
  });

  test('PMB overview multi-aspect question should not be hijacked by schedule overview prompt', async () => {
    const q = 'Jelaskan informasi Penerimaan Mahasiswa Baru (PMB) ITB STIKOM Bali berdasarkan dokumen: alur pendaftaran, syarat/dokumen, jadwal (jika ada), dan kontak/kanal pendaftaran (jika ada).';
    const res = await query(q);
    expect(res && res.success).toBe(true);
    expect(res.source).not.toBe('rag-schedule-overview');
    expect(res.source).not.toBe('rag-schedule-rule');
    // Without OPENAI_API_KEY the engine should fall back to this response.
    expect(res.source).toBe('rag-no-ai');
  });

  test('ranking scholarship question is not misrouted to enrollment discount', async () => {
    const res = await query('Saya ingin tanya apakah ada potongan/beasiswa kalau saya ranking di kelas?');
    expect(res && res.success).toBe(true);
    expect(res.source).toBe('rag-scholarship-ranking-rule');
    // When ranking scholarship data is not in the index, the handler asks for school and ranking info
    expect(String(res.answer || '')).toMatch(/ranking/i);
    expect(String(res.answer || '')).toMatch(/sekolah|asal/i);
    expect(String(res.answer || '')).not.toMatch(/Potongan biaya pendaftaran yang tersedia/i);
  });

  test('ranking follow-up mentioning semesters is not misrouted to fee breakdown', async () => {
    const res = await query('Saya di semester 1 ranking 1 dan semester 2 ranking 5');
    expect(res && res.success).toBe(true);
    expect(res.source).toBe('rag-scholarship-ranking-rule');
    const answer = String(res.answer || '');
    expect(answer).toMatch(/ranking/i);
    expect(answer).not.toMatch(/rangkuman\s+rincian\s+biaya/i);
  });

  test('follow-up question about "sekolah tertentu" is answered (no web fallback)', async () => {
    const res = await query('apa yang dimaksud sekolah tertentu?');
    expect(res && res.success).toBe(true);
    expect(res.source).toBe('rag-scholarship-ranking-rule');
    expect(String(res.answer || '')).toMatch(/Maksud\s+"sekolah tertentu"/i);
  });

  test('asking which schools are in the lampiran does not return a misleading short list', async () => {
    const res = await query('sekolah apa saja yang ada di daftar?');
    expect(res && res.success).toBe(true);
    expect(res.source).toBe('rag-scholarship-ranking-rule');
    expect(String(res.answer || '')).toMatch(/daftar\s+sekolah/i);
    expect(String(res.answer || '')).toMatch(/cukup\s+panjang/i);
  });

  test('general scholarship question returns types overview first', async () => {
    const res = await query('saya mau tau tentang beasiswa yang ada di stikom');
    expect(res && res.success).toBe(true);
    expect(res.source).toBe('rag-scholarship-overview');
    const answer = String(res.answer || '').toLowerCase();
    expect(answer).toMatch(/beberapa\s+jenis/);
    expect(answer).toMatch(/ranking/);
    expect(answer).toMatch(/prestasi/);
    expect(answer).toMatch(/lokal\s*\/\s*nasional\s*\/\s*internasional/);
    expect(answer).not.toMatch(/potongan\s+biaya\s+pendaftaran/);
  });

  test('short reply "ranking" returns ranking scholarship explanation (not generic fallback)', async () => {
    const res = await query('ranking');
    expect(res && res.success).toBe(true);
    expect(res.source).toBe('rag-scholarship-ranking-rule');
    expect(String(res.answer || '')).toMatch(/ranking\s+di\s+kelas/i);
    // When ranking scholarship data is not in the index, the handler asks for school and ranking info
    expect(String(res.answer || '')).toMatch(/sekolah|asal|kategori/i);
  });

  test('DNUI follow-up "rangkum biaya lainnya" returns main fee components (no semester-5 drift)', async () => {
    const q = 'berapa biaya pendaftaran dual degree DNUI\nFollow-up: tolong rangkum biaya lainnya';
    const res = await query(q);
    expect(res && res.success).toBe(true);
    expect(res.source).toBe('rag-fee-breakdown');

    const answer = String(res.answer || '');
    expect(answer).toMatch(/Dana\s+Pendidikan\s+Pokok/i);
    expect(answer).toMatch(/Rp\s*20\.000\.000/i);
    expect(answer).toMatch(/Bahasa\s+Mandarin/i);
    expect(answer).toMatch(/Rp\s*5\.000\.000/i);
    expect(answer).toMatch(/(Biaya\s+)?Pendidikan\s+Per\s+Semester/i);
    expect(answer).toMatch(/Rp\s*16\.000\.000/i);

    // The follow-up asked for other fee components; don't jump to thesis/semester-5 penalties.
    expect(answer).not.toMatch(/semester\s*5/i);
    expect(answer).not.toMatch(/tesis/i);
  });

  test('UTB fee breakdown works even for short query', async () => {
    const res = await query('rincian biaya utb');
    expect(res && res.success).toBe(true);
    expect(res.source).toBe('rag-fee-breakdown');
    const answer = String(res.answer || '');
    expect(answer).toMatch(/UTB/i);
    expect(answer).toMatch(/Dana\s+Pendidikan\s+Pokok/i);
  });

  test('follow-up asking HELP after DNUI returns HELP breakdown (not DNUI)', async () => {
    const q = 'kalo biaya pendaftaran dnui berapa?\nFollow-up: kalo biaya pendaftaran help?';
    const res = await query(q);
    expect(res && res.success).toBe(true);
    expect(res.source).toBe('rag-fee-breakdown');
    const answer = String(res.answer || '');
    expect(answer).toMatch(/HELP/i);
    expect(answer).toMatch(/Malaysia/i);
    // Should not keep answering DNUI in this follow-up.
    expect(answer).not.toMatch(/DNUI/i);

    // Ensure the main fee table rows are present (not just repeated registration fee).
    expect(answer).toMatch(/Dana\s+Pendidikan\s+Pokok/i);
    expect(answer).toMatch(/Rp\s*20\.000\.000/i);
    expect(answer).toMatch(/Bahasa\s+Inggris/i);
    expect(answer).toMatch(/Rp\s*5\.000\.000/i);
    expect(answer).toMatch(/Biaya\s+Pendidikan\s+per\s+semester/i);
    expect(answer).not.toMatch(/Ujian\/Subject/i);

    // Avoid duplicated "Pendaftaran" bullets.
    const pCount = (answer.match(/-\s*Pendaftaran\s*:/gi) || []).length;
    expect(pCount).toBe(1);
  });
});
