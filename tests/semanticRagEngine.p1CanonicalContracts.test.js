const { querySemanticRag, clearSemanticCaches } = require('../src/engine/semanticRagEngine');
const { buildCanonicalQueryUnderstanding } = require('../src/engine/queryUnderstanding');

describe('semantic RAG P1 canonical query contracts', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    process.env.SEMANTIC_RAG_TODAY_YMD = '2026-08-19';
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
    if (typeof clearSemanticCaches === 'function') clearSemanticCaches();
  });

  test('routes registration-how by canonical intent before generic FAQ', async () => {
    const known = await querySemanticRag('Cara daftarnya bagaimana?', { topK: 5 });
    expect(known.source).toBe('semantic-rag-registration-info');
    expect(known.debug && known.debug.routeStage).toBe('pre-guard-registration-how');
    expect(known.answer).toMatch(/siap\.stikom-bali\.ac\.id|online/i);

    const unseen = await querySemanticRag('mau daftar kuliah online lewat mana ya?', { topK: 5 });
    expect(unseen.source).toBe('semantic-rag-registration-info');
    expect(unseen.answer).toMatch(/online|kampus/i);
  }, 60000);

  test('expands canonical program aliases for generic curriculum questions', async () => {
    const known = await querySemanticRag('kurikulum BD belajar apa?', { topK: 5 });
    expect(known.source).toBe('semantic-rag-program-curriculum');
    expect(known.answer).toMatch(/Bisnis Digital/i);

    const unseen = await querySemanticRag('anak BD belajarnya fokus apa aja?', { topK: 5 });
    expect(unseen.source).toBe('semantic-rag-program-curriculum');
    expect(unseen.answer).toMatch(/Bisnis Digital|data analytics|digital/i);
  }, 60000);

  test('does not degrade specific curriculum topic questions into generic profile', async () => {
    const known = await querySemanticRag('apakah mahasiswa BD belajar AI?', { topK: 5 });
    expect(known.source).toBe('semantic-rag-program-curriculum-topic-no-data');
    expect(known.answer).toMatch(/Bisnis Digital|AI|Artificial Intelligence|belum menunjukkan/i);

    const unseen = await querySemanticRag('anak BD belajar AI gak?', { topK: 5 });
    expect(unseen.source).toBe('semantic-rag-program-curriculum-topic-no-data');
    expect(unseen.answer).toMatch(/belum menunjukkan|belum bisa memastikan|secara eksplisit/i);
  }, 60000);

  test('uses canonical fee subtype for UKT instead of registration-fee framing', async () => {
    const known = await querySemanticRag('UKT sistem informasi', { topK: 5 });
    expect(known.source).toBe('semantic-rag-fee-detail');
    expect(known.answer).toMatch(/UKT|biaya pendidikan per semester/i);
    expect(known.answer).not.toMatch(/khusus biaya pendaftaran/i);

    const unseen = await querySemanticRag('uang kuliah prodi informatika berapa?', { topK: 5 });
    expect(unseen.source).toBe('semantic-rag-fee-detail');
    expect(unseen.answer).toMatch(/Teknologi Informasi|biaya pendidikan per semester/i);
  }, 60000);

  test('answers generic campus facility list from facility route without program hijack', async () => {
    const known = await querySemanticRag('fasilitas kampus apa saja?', { topK: 5 });
    expect(known.source).toBe('semantic-rag-campus-facility');
    expect(known.answer).toMatch(/Career Center|Inkubator Bisnis|Language Learning Center/i);
    expect(known.answer).not.toMatch(/Double Degree Nasional|Double Degree Internasional/i);

    const unseen = await querySemanticRag('sarana prasarana kampus apa aja?', { topK: 5 });
    expect(unseen.source).toBe('semantic-rag-campus-facility');
    expect(unseen.answer).toMatch(/fasilitas|layanan pendukung/i);
  }, 90000);

  test('preserves entity for program advice queries', async () => {
    const known = await querySemanticRag('Saya kurang cakap di bidang Teknologi Informasi, apa yang harus saya lakukan?', { topK: 5 });
    expect(known.source).toBe('semantic-rag-program-advice');
    expect(known.answer).toMatch(/Teknologi Informasi/i);

    const unseen = await querySemanticRag('kalau ambil informatika tapi belum jago komputer gimana?', { topK: 5 });
    expect(unseen.source).toBe('semantic-rag-program-advice');
    expect(unseen.answer).toMatch(/Teknologi Informasi|fondasi|bertahap/i);
  }, 60000);
  test('routes career service questions to campus support instead of generic facility/evidence', async () => {
    const known = await querySemanticRag('layanan karier ada?', { topK: 5 });
    expect(known.source).toBe('semantic-rag-campus-support-entity');
    expect(known.answer).toMatch(/Career Center|karier|magang|lowongan|job fair/i);
    expect(known.answer).not.toMatch(/didedikasikan\s*-\s*Selain/i);

    const unseen = await querySemanticRag('ada bantuan persiapan kerja untuk mahasiswa?', { topK: 5 });
    expect(unseen.source).toBe('semantic-rag-campus-support-entity');
    expect(unseen.answer).toMatch(/karier|persiapan kerja|Career Center/i);
  }, 60000);

});


describe('structural semantic UAT remediation contracts', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    process.env.SEMANTIC_RAG_TODAY_YMD = '2026-08-19';
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
    if (typeof clearSemanticCaches === 'function') clearSemanticCaches();
  });

  test('UKM category/minat uses category-filter semantics, not open-world entity patching', async () => {
    for (const q of ['apakah ada ukm seni?', 'organisasi buat yang suka seni apa?', 'kalau suka kegiatan seni ikut UKM apa?', 'ada ukm sni ga kak?']) {
      const canonical = buildCanonicalQueryUnderstanding(q);
      expect(canonical.constraints.organizationCategory).toEqual(expect.objectContaining({ key: 'arts' }));
      const result = await querySemanticRag(q);
      expect(result.source).toBe('semantic-rag-ukm-category');
      expect(result.answer).toMatch(/seni|Musik|Tari|Tabuh|Teater|Vos/i);
      expect(result.answer).not.toMatch(/bernama Seni|biaya kuliah|Double Degree/i);
    }
  }, 90000);

  test('registration requirements preserve program and avoid fee substitution', async () => {
    for (const q of ['apa saja syarat untuk mendaftar di program studi d3 manajemen informatika?', 'persyaratan daftar D3 MI apa aja kak?', 'untuk prodi Manajemen Informatika, dokumen pendaftaran apa saja?']) {
      const canonical = buildCanonicalQueryUnderstanding(q);
      expect(canonical.intent.primary).toBe('ask_registration_requirements');
      expect(canonical.requestedFields).toEqual(expect.arrayContaining(['requirements', 'registration']));
      expect(canonical.entities.programs[0]).toEqual(expect.objectContaining({ canonical: 'Manajemen Informatika' }));
      const result = await querySemanticRag(q);
      expect(result.source).toBe('semantic-rag-pmb-requirements');
      expect(result.answer).toMatch(/Manajemen Informatika|syarat|dokumen|pendaftaran/i);
      expect(result.answer).not.toMatch(/Biaya awal masuk|UKT|DPP|Rp\./i);
    }
  }, 90000);

  test('campus count requires campus-compatible evidence and rejects neighboring counts', async () => {
    for (const q of ['Ada berapa jumlah kampus ITB STIKOM Bali?', 'STIKOM punya berapa kampus?', 'berapa lokasi kampus STIKOM Bali?', 'kampusnya ada berapa?']) {
      const canonical = buildCanonicalQueryUnderstanding(q);
      expect(canonical.intent.primary).toBe('ask_campus_count');
      expect(canonical.constraints.entityFamily).toBe('campus');
      const result = await querySemanticRag(q, { sessionData: { messages: [{ message: 'berapa biaya kuliah SI?' }] } });
      expect(result.source).toBe('semantic-rag-campus-count');
      expect(result.answer).toMatch(/3 lokasi kampus|Denpasar|Jimbaran|Abiansemal/i);
      expect(result.answer).not.toMatch(/wirausaha muda|biaya pendidikan|UKT|DPP|beasiswa/i);
    }

    for (const q of ['berapa biaya kuliah?', 'berapa UKM yang ada?', 'berapa SKS S2 Sistem Informasi?', 'gedung kampus ada berapa lantai?']) {
      const canonical = buildCanonicalQueryUnderstanding(q);
      expect(canonical.intent.primary).not.toBe('ask_campus_count');
      const result = await querySemanticRag(q);
      expect(result.source).not.toBe('semantic-rag-campus-count');
    }
  }, 120000);

  test('specific curriculum topic presence does not degrade into generic profile', async () => {
    for (const q of ['Apakah mahasiswa Bisnis Digital belajar Artificial Intelligence (AI)?', 'di BD ada mata kuliah kecerdasan buatan?', 'Bisnis Digital belajar machine learning ga kak?']) {
      const canonical = buildCanonicalQueryUnderstanding(q);
      expect(canonical.constraints.curriculumTopic).toEqual(expect.objectContaining({ key: 'artificial_intelligence' }));
      expect(canonical.requestedFields).toContain('curriculumTopicPresence');
      const result = await querySemanticRag(q);
      expect(result.source).toBe('semantic-rag-program-curriculum-topic-no-data');
      expect(result.answer).toMatch(/belum menunjukkan|belum bisa memastikan|secara eksplisit/i);
      expect(result.answer).not.toMatch(/^Di Program Studi Bisnis Digital, mahasiswa belajar bisnis berbasis teknologi/i);
    }

    const supported = await querySemanticRag('Apakah Bisnis Digital belajar data analytics?');
    expect(supported.source).toBe('semantic-rag-program-curriculum-topic-presence');
    expect(supported.answer).toMatch(/data analytics/i);
  }, 90000);

  test('scholarship overview keeps catalogue while procedure remains procedure', async () => {
    for (const q of ['program beasiswanya gimana kak?', 'beasiswanya apa aja min?', 'ada pilihan beasiswa apa?']) {
      const result = await querySemanticRag(q);
      expect(result.source).toBe('semantic-rag-scholarship');
      expect(result.answer).toMatch(/Beasiswa KIP|1K1S|Prestasi|Yayasan/i);
      expect(result.answer).not.toMatch(/^Untuk mendapatkan beasiswa, kakak perlu memilih jalur/i);
    }

    const procedure = await querySemanticRag('cara mengajukan beasiswa gimana?');
    expect(procedure.answer).toMatch(/Untuk mendapatkan beasiswa|Ajukan berkas|verifikasi/i);
  }, 90000);

  test('generic student organization/minat returns catalogue and resists contaminated context', async () => {
    const result = await querySemanticRag('Apakah tersedia organisasi mahasiswa yang bisa mendukung minat mahasiswa di luar dari pembelajaran formal?', {
      sessionData: { messages: [{ message: 'berapa biaya Bisnis Digital?' }, { message: 'rincian UKT dan DPP' }] }
    });
    expect(result.source).toBe('semantic-rag-ukm-list');
    expect(result.answer).toMatch(/Badan Eksekutif Mahasiswa|Athena Esports|Musik|Syntax|Vos/i);
    expect(result.answer).not.toMatch(/Biaya awal masuk|UKT|DPP|Double Degree HELP/i);
  }, 90000);
});

test('career recommendation route ownership separates goal selection from catalogue/list intent', async () => {
  const positives = [
    'Saya ingin kerja mengolah data, jurusan mana yang cocok?',
    'Kalau mau jadi data analyst sebaiknya ambil prodi apa?',
    'Saya suka analisis bisnis dan teknologi, jurusan yang cocok apa?',
    'Kalau target kerja di digital marketing, pilih jurusan apa?'
  ];

  for (const query of positives) {
    const canonical = buildCanonicalQueryUnderstanding(query);
    expect(canonical.intent.primary).toBe('ask_program_recommendation');
    expect(canonical.requestedFields).toEqual(expect.arrayContaining(['programRecommendation', 'careerGoal']));

    const result = await querySemanticRag(query, { topK: 8, sessionData: {} });
    expect(result.success).toBe(true);
    expect(result.source).toBe('semantic-rag-program-recommendation');
    expect(result.debug && result.debug.routeStage).toBe('pre-guard-canonical-program-recommendation');
    expect(result.answer).toMatch(/Sistem Informasi|Teknologi Informasi|Bisnis Digital|Manajemen Informatika|Double Degree UTB/i);
    expect(result.answer).toMatch(/minat|karier|pekerjaan|target/i);
    expect(result.answer).not.toMatch(/daftar jurusan\/program studi|pilihan programnya mencakup S2, S1, D3/i);
  }

  for (const query of ['Daftar jurusan apa saja?', 'Ada prodi apa saja?', 'Sebutkan semua program S1.']) {
    const canonical = buildCanonicalQueryUnderstanding(query);
    expect(canonical.intent.primary).toBe('ask_program_list');
    expect(canonical.requestedFields).toContain('programList');

    const result = await querySemanticRag(query, { topK: 8, sessionData: {} });
    expect(result.success).toBe(true);
    expect(result.source).toBe('semantic-rag-program-list');
    expect(result.answer).toMatch(/program studi|prodi|Sistem Informasi|Teknologi Informasi/i);
  }

  for (const query of ['Apa itu data?', 'Daftar ulang kapan?', 'Mata kuliah pengolahan data ada?', 'Program mana yang paling murah?']) {
    const canonical = buildCanonicalQueryUnderstanding(query);
    expect(canonical.intent.primary).not.toBe('ask_program_recommendation');

    const result = await querySemanticRag(query, { topK: 8, sessionData: {} });
    expect(result.source).not.toBe('semantic-rag-program-recommendation');
    expect(result.debug && result.debug.routeStage).not.toBe('pre-guard-canonical-program-recommendation');
  }

  const explicitGoalAfterProgramContext = await querySemanticRag('Kalau mau jadi data analyst sebaiknya ambil prodi apa?', {
    topK: 8,
    sessionData: {
      programHint: 'Teknologi Informasi',
      lastProgramHint: 'Teknologi Informasi',
      lastIntent: 'program_definition',
      messages: [
        { role: 'user', message: 'jelaskan prodi TI' },
        { role: 'assistant', message: 'Teknologi Informasi berfokus pada teknologi dan sistem.' }
      ]
    }
  });
  expect(explicitGoalAfterProgramContext.source).toBe('semantic-rag-program-recommendation');
  expect(explicitGoalAfterProgramContext.answer).toMatch(/data|analisis|analyst/i);

  const explicitCatalogueAfterCareerContext = await querySemanticRag('Daftar jurusan apa saja?', {
    topK: 8,
    sessionData: {
      lastIntent: 'program_recommendation',
      messages: [
        { role: 'user', message: 'Saya suka digital marketing, pilih jurusan apa?' },
        { role: 'assistant', message: 'Bisnis Digital bisa dipertimbangkan.' }
      ]
    }
  });
  expect(explicitCatalogueAfterCareerContext.source).toBe('semantic-rag-program-list');
}, 120000);
