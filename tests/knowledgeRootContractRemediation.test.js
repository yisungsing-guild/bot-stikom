const { querySemanticRag } = require('../src/engine/semanticRagEngine');
const { buildCanonicalQueryUnderstanding } = require('../src/engine/queryUnderstanding');

process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';
delete process.env.OPENAI_API_KEY;

describe('Knowledge root-contract remediation', () => {
  test('disambiguates short program aliases from legal/document code context', () => {
    const legal = buildCanonicalQueryUnderstanding('berapa nomor SK Mendiknas izin operasional pendirian ITB STIKOM Bali?');
    expect(legal.domain.primary).toBe('institution_profile');
    expect(legal.intent.primary).toBe('ask_institution_history');
    expect(legal.entities.programs).toEqual([]);
    expect(legal.requestedFields).toEqual(expect.arrayContaining(['legalDocumentNumber', 'legalEstablishmentDocument']));

    const program = buildCanonicalQueryUnderstanding('prodi SK itu apa?');
    expect(program.domain.primary).toBe('program');
    expect(program.intent.primary).toBe('ask_program_definition');
    expect(program.entities.programs.map((entity) => entity.canonical)).toContain('Sistem Komputer');
    expect(program.requestedFields).not.toContain('bibliographyStandard');
  });

  test('routes institution legal-establishment document requests before program or schedule fallbacks', async () => {
    const result = await querySemanticRag('surat keputusan pendirian kampus nomor berapa?', { topK: 8 });
    expect(result.source).toMatch(/semantic-rag-institution-(history|profile)/);
    expect(result.answer).toMatch(/SK Mendiknas|157\/D\/O\/2002/i);
    expect(result.answer).not.toMatch(/Gelombang|Sistem Komputer adalah/i);
  }, 30000);

  test('routes academic requested fields through source-compatible academic retrieval', async () => {
    const result = await querySemanticRag('apa standar daftar pustaka yang digunakan dalam penulisan Tugas Akhir?', { topK: 8 });
    expect(result.source).toBe('semantic-rag-academic-source');
    expect(result.answer).toMatch(/IEEE|daftar pustaka|sitasi/i);
    expect(result.answer).not.toMatch(/semantic-rag-disabled|Untuk Tugas Akhir prodi apa/i);
  }, 30000);
  test('contains unsupported academic levels before expensive generic retrieval', async () => {
    const unsupported = await querySemanticRag('apakah ada program Doktoral S3 Robotika di kampus?', { topK: 5 });
    expect(unsupported.source).toBe('semantic-rag-unsupported-program');
    expect(unsupported.answer).toMatch(/belum menemukan data|konfirmasi/i);
    expect(unsupported.answer).not.toMatch(/tersedia program S3 Robotika/i);

    const supported = await querySemanticRag('apakah ada program S2 Sistem Informasi di kampus?', { topK: 5 });
    expect(supported.answer).toMatch(/Magister Sistem Informasi|S2/i);
    expect(supported.source).not.toBe('semantic-rag-unsupported-program');
  }, 30000);

  test('contains unsupported local dormitory facilities without blocking DNUI dormitory evidence', async () => {
    const localDorm = await querySemanticRag('apakah disediakan asrama khusus putra di dalam kampus Renon?', { topK: 5 });
    expect(localDorm.source).toBe('semantic-rag-unsupported-facility-safe-fallback');
    expect(localDorm.answer).toMatch(/belum menemukan data|konfirmasi/i);
    expect(localDorm.answer).not.toMatch(/disediakan asrama khusus putra/i);

    const dnuiDorm = await querySemanticRag('apakah Double Degree DNUI menyediakan dormitory saat tahun ke-4?', { topK: 5 });
    expect(dnuiDorm.source).not.toBe('semantic-rag-unsupported-facility-safe-fallback');
    expect(dnuiDorm.answer).toMatch(/DNUI|dormitory|China|tahun 4/i);
  }, 30000);
  test('contains unsupported external relations and academic integrity policy claims before source-grounded retrieval', async () => {
    const unsupportedPartner = await querySemanticRag('apakah Career Center bekerja sama dengan NASA untuk program magang luar negeri?', { topK: 8 });
    expect(unsupportedPartner.source).toBe('semantic-rag-explicit-external-insufficient-data');
    expect(unsupportedPartner.answer).toMatch(/belum menemukan data|tidak akan menebak/i);
    expect(unsupportedPartner.answer).not.toMatch(/mempersiapkan karier melalui berbagai program/i);

    const unsupportedPolicy = await querySemanticRag('apakah boleh memakai joki sertifikat TOEFL untuk syarat sidang skripsi?', { topK: 8 });
    expect(unsupportedPolicy.source).toBe('semantic-rag-unsupported-policy-safe-fallback');
    expect(unsupportedPolicy.answer).toMatch(/belum menemukan data|tidak dapat dianggap sebagai persetujuan|konfirmasi/i);
    expect(unsupportedPolicy.answer).not.toMatch(/Persyaratan Yudisium|Telah memenuhi syarat pendaftaran Sidang/i);

    const supportedAcademic = await querySemanticRag('apa saja syarat yudisium tugas akhir?', { topK: 8 });
    expect(supportedAcademic.source).toMatch(/semantic-rag-academic-(source|schedule)/);
    expect(supportedAcademic.answer).toMatch(/Yudisium|Tugas Akhir|Skripsi/i);
  }, 30000);
  test('preserves D3 MI fee identity and unsupported double-degree partner validation', async () => {
    const miFee = await querySemanticRag('D3 MI uang kuliahnya berapa?', { topK: 8 });
    expect(miFee.source).toBe('semantic-rag-fee-detail');
    expect(miFee.answer).toMatch(/Manajemen Informatika/i);
    expect(miFee.answer).toMatch(/Rp\.\s*10\.000\.000|10\.000\.000/i);
    expect(miFee.answer).not.toMatch(/Prodi Teknologi Informasi/i);

    const unsupportedPartner = await querySemanticRag('ada kerja sama double degree dengan Oxford?', { topK: 8 });
    expect(unsupportedPartner.source).toBe('semantic-rag-unsupported-double-degree-partner');
    expect(unsupportedPartner.answer).toMatch(/belum menemukan data kerja sama Double Degree/i);
    expect(unsupportedPartner.answer).not.toMatch(/Bachelor of Information Technology|Bachelor of Management/i);

    const supportedPartner = await querySemanticRag('ada kerja sama double degree dengan HELP University?', { topK: 8 });
    expect(supportedPartner.source).not.toBe('semantic-rag-unsupported-double-degree-partner');
    expect(supportedPartner.answer).toMatch(/HELP University|Bachelor of Information Technology/i);
  }, 30000);
  test('generic source-grounded comparison composes per-target evidence without wrong-domain substitution', async () => {
    const canonical = buildCanonicalQueryUnderstanding('Double Degree DNUI itu Student Exchange bukan?');
    expect(canonical.intent.primary).toBe('ask_international_program_comparison');
    expect(canonical.domain.primary).toBe('international_program');
    expect(canonical.questionType).toBe('comparison');
    expect(canonical.constraints.relationType).toBe('international_program_contrast');

    const result = await querySemanticRag('Double Degree DNUI itu Student Exchange bukan?', { topK: 8 });
    expect(result.source).toMatch(/semantic-rag-(source-grounded-comparison|grounded-composer)/);
    expect(result.answer).toMatch(/Student Exchange/i);
    expect(result.answer).toMatch(/Double Degree DNUI|DNUI|Dalian/i);
    expect(result.answer).toMatch(/pertukaran mahasiswa|belajar di kampus luar negeri/i);
    expect(result.answer).toMatch(/Tahun 3|Tahun 4|China|DNUI/i);
    expect(result.answer).not.toMatch(/HELP University.*Double Degree DNUI/i);
    expect(result.answer).not.toMatch(/sama persis/i);
    expect(result.answer).not.toMatch(/Ringkasan dokumen|Program studi terlihat|MENIMBANG|SURAT KEPUTUSAN/i);
  }, 30000);

  test('generic source-grounded comparison supports paraphrases and partial/unsupported controls safely', async () => {
    const paraphrase = await querySemanticRag('apa bedanya Student Exchange dan Double Degree DNUI?', { topK: 8 });
    expect(paraphrase.source).toMatch(/semantic-rag-(source-grounded-comparison|grounded-composer)/);
    expect(paraphrase.answer).toMatch(/Student Exchange/i);
    expect(paraphrase.answer).toMatch(/DNUI|Dalian/i);
    expect(paraphrase.answer).not.toMatch(/HELP University.*DNUI/i);

    const supportedOther = await querySemanticRag('Student Exchange sama dengan Double Degree HELP nggak?', { topK: 8 });
    expect(supportedOther.source).toMatch(/semantic-rag-(source-grounded-comparison|grounded-composer)/);
    expect(supportedOther.answer).toMatch(/Student Exchange/i);
    expect(supportedOther.answer).toMatch(/HELP University|Double Degree HELP/i);
    expect(supportedOther.answer).not.toMatch(/DNUI.*HELP University Malaysia/i);
    expect(supportedOther.answer).not.toMatch(/Ringkasan dokumen|Program studi terlihat|MENIMBANG|SURAT KEPUTUSAN/i);

    const unsupported = await querySemanticRag('apakah Student Exchange sama dengan program magang NASA?', { topK: 8 });
    expect(unsupported.answer).toMatch(/belum menemukan|belum dapat|tidak menemukan|konfirmasi/i);
    expect(unsupported.answer).not.toMatch(/NASA.*(?:mitra resmi|tersedia sebagai|bekerja sama|program magang resmi)/i);
  }, 30000);
  test('organization count uses UKM/Ormawa-compatible evidence and rejects domain collisions', async () => {
    const count = await querySemanticRag('berapa jumlah ormawa di stikom bali?', { topK: 8 });
    expect(count.source).toBe('semantic-rag-ukm-count');
    expect(count.answer).toMatch(/32|UKM|Ormawa|tercatat/i);
    expect(count.answer).not.toMatch(/Hi-Think|Student Exchange|Double Degree|DNUI/i);

    const ukmCount = await querySemanticRag('ada berapa UKM kampus?', { topK: 8 });
    expect(ukmCount.source).toBe('semantic-rag-ukm-count');
    expect(ukmCount.answer).toMatch(/32|UKM|Ormawa/i);

    const facilityCount = await querySemanticRag('ada berapa lokasi kampus?', { topK: 8 });
    expect(facilityCount.source).not.toBe('semantic-rag-ukm-count');
    expect(facilityCount.answer).not.toMatch(/32 UKM|32 Ormawa/i);
  }, 30000);

  test('organization profile uses exact entity evidence and cleans raw profile fragments', async () => {
    const tari = await querySemanticRag('profil UKM tari gimana?', { topK: 8 });
    expect(tari.source).toMatch(/semantic-rag-ukm/);
    expect(tari.answer).toMatch(/Tari|PRAGINA|UKM|Ormawa/i);
    expect(tari.answer).not.toMatch(/PROFILE ORMAWA|PROFILE UKM|Ringkasan dokumen|SURAT KEPUTUSAN|Menimbang|Mengingat/i);
    expect(tari.answer).not.toMatch(/diprakarsai oleh Prof\.?\s*(?:$|\n|\.)/i);

    const athena = await querySemanticRag('profil Athena Esports gimana?', { topK: 8 });
    expect(athena.source).toMatch(/semantic-rag-ukm/);
    expect(athena.answer).toMatch(/Athena|Esports|UKM/i);
    expect(athena.answer).not.toMatch(/PROFILE ORMAWA|Ringkasan dokumen|SURAT KEPUTUSAN/i);

    const unknown = await querySemanticRag('profil UKM Astronot gimana?', { topK: 8 });
    expect(unknown.source).toBe('semantic-rag-ukm-unknown-insufficient-data');
    expect(unknown.answer).toMatch(/belum menemukan organisasi mahasiswa bernama Astronot/i);
    expect(unknown.answer).not.toMatch(/Athena|PRAGINA|Hi-Think/i);
  }, 30000);

  test('organization subset count distinguishes HIMAPRODI from broader HIMA collections', async () => {
    const himaprodi = await querySemanticRag('total himpunan mahasiswa prodi yang tercatat ada berapa?', { topK: 8 });
    expect(himaprodi.source).toBe('semantic-rag-ukm-count');
    expect(himaprodi.answer).toMatch(/4|empat/i);
    expect(himaprodi.answer).toMatch(/HIMAPRODI/i);
    expect(himaprodi.answer).not.toMatch(/Himas Jimbaran|Student Exchange|Hi-Think/i);

    const broaderHima = await querySemanticRag('jumlah hima di kampus ada berapa?', { topK: 8 });
    expect(broaderHima.source).toBe('semantic-rag-ukm-count');
    expect(broaderHima.answer).toMatch(/Himas Jimbaran|HIMAPRODI/i);
    expect(broaderHima.answer).not.toMatch(/Student Exchange|Double Degree/i);
  }, 30000);

  test('institution history date outranks negated PMB schedule wording', async () => {
    const result = await querySemanticRag('tanggal resmi berdirinya kampus, bukan jadwal daftar PMB, kapan?', { topK: 8 });
    expect(result.source).toMatch(/semantic-rag-(source-grounded-requested-field|institution-history|institution-profile)/);
    expect(result.answer).toMatch(/20\s+Mei\s+2001/i);
    expect(result.answer).toMatch(/berdiri|didirikan|resmi|institusi/i);
    expect(result.answer).not.toMatch(/Gelombang|Sisipan|pendaftaran PMB sedang aktif/i);
  }, 30000);

  test('institution document purpose extracts clean propositions from noisy form evidence', async () => {
    const purpose = await querySemanticRag('dokumen IKU PTS itu dipakai buat laporan apa?', { topK: 8 });
    expect(purpose.source).toMatch(/semantic-rag-(source-grounded-requested-field|grounded-composer)/);
    expect(purpose.answer).toMatch(/indikator\s+kinerja/i);
    expect(purpose.answer).toMatch(/perguruan\s+tinggi|PTS/i);
    expect(purpose.answer).toMatch(/laporan|pelaporan|fungsi|berfungsi/i);
    expect(purpose.answer).not.toMatch(/Nama Perguruan Tinggi\s*:|SOURCE_CHUNKS|Sheet:|chunkId|metadata|filename|sourceFile|FAQ|QNA/i);

    const rawComplaint = await querySemanticRag('[Sheet: Sheet1] FORM IKU Perguruan Tinggi | Program Studi | Persentase PTS | Jumlah Total | Ya / Tidak | Keterangan data internal. Kenapa kok jadi bocor seperti ini?', { topK: 8 });
    expect(rawComplaint.source).toBe('semantic-rag-raw-document-leak-feedback');
    expect(rawComplaint.answer).not.toMatch(/Nama Perguruan Tinggi\s*:|Jumlah Total|Sheet: Sheet1/i);
  }, 30000);
  test('administrative document summaries preserve clean facts without raw artifact leakage', async () => {
    const result = await querySemanticRag('ngurus SKTT mahasiswa asing butuh dokumen apa?', { topK: 8 });
    expect(result.source).toMatch(/semantic-rag-(source-grounded-requested-field|institution-history|grounded-composer)/);
    expect(result.answer).toMatch(/paspor|passport/i);
    expect(result.answer).toMatch(/ITAS|KITAS/i);
    expect(result.answer).toMatch(/F1-01|formulir/i);
    expect(result.answer).not.toMatch(/SOURCE_CHUNKS|Sheet:|chunkId|metadata|filename|sourceFile|FAQ|QNA|sbbs*:/i);
  }, 30000);
});
