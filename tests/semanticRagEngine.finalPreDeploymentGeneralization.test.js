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
    expect(medical.debug.semanticContract.constraints.unsupportedEntityCandidate.canonical).toBe('Kedokteran');
    expect(medical.debug.semanticContract.entities).toEqual(expect.arrayContaining([expect.objectContaining({ canonical: 'Kedokteran', role: 'unsupported_entity_candidate', group: 'unsupported' })]));
    expect(medical.debug.routeStage).toBe('pre-guard-canonical-unsupported-entity');
    expect(medical.debug.contractVerification.reason).toBe('unsupported_entity_no_data_preserved');
    expect(medical.answer).toMatch(/tidak memiliki program studi Kedokteran/i);
    expect(medical.answer).not.toMatch(/UKT|DPP|Rp\.\s*6\.500\.000/i);

    const unsupportedPartner = await ask('double degree Harvard itu ambil jurusan apa?');
    expect(unsupportedPartner.source).toBe('semantic-rag-unsupported-double-degree-partner');
    expect(unsupportedPartner.answer).toMatch(/belum menemukan data kerja sama Double Degree/i);
    expect(unsupportedPartner.answer).toMatch(/UTB|DNUI|HELP/i);
  });

  test('preserves explicit unsupported program candidates across requested fields without substitution', async () => {
    const { buildCanonicalQueryUnderstanding } = require('../src/engine/queryUnderstanding');
    const unsupportedEntities = ['Kedokteran', 'Teknik Sipil', 'Hukum', 'Psikologi', 'Farmasi', 'Arsitektur'];
    const fieldTemplates = [
      { label: 'biaya', build: (entity) => `jurusan ${entity} di STIKOM biayanya berapa?`, requestType: 'fee' },
      { label: 'akreditasi', build: (entity) => `akreditasi prodi ${entity} di STIKOM apa?` },
      { label: 'cara daftar', build: (entity) => `cara daftar program studi ${entity} di STIKOM gimana?` },
      { label: 'profil', build: (entity) => `profil jurusan ${entity} di STIKOM seperti apa?` },
      { label: 'lama studi', build: (entity) => `lama studi prodi ${entity} berapa semester?` }
    ];

    for (const entity of unsupportedEntities) {
      for (const field of fieldTemplates) {
        const q = field.build(entity);
        const canonical = buildCanonicalQueryUnderstanding(q).contract;
        expect(canonical.entities).toEqual(expect.arrayContaining([expect.objectContaining({ canonical: entity, type: 'program', role: 'unsupported_entity_candidate', group: 'unsupported' })]));
        expect(canonical.constraints.unsupportedEntityCandidate).toEqual(expect.objectContaining({ canonical: entity, type: 'program' }));
        if (field.requestType) expect(canonical.requestType).toBe(field.requestType);

        const result = await ask(q);
        expect(result.source).toBe('semantic-rag-out-of-domain');
        expect(result.debug.routeStage).toBe('pre-guard-canonical-unsupported-entity');
        expect(result.debug.semanticContract.constraints.unsupportedEntityCandidate).toEqual(expect.objectContaining({ canonical: entity, type: 'program' }));
        expect(result.debug.contractVerification.reason).toBe('unsupported_entity_no_data_preserved');
        expect(result.answer).toEqual(expect.stringContaining(entity));
        expect(result.answer).toMatch(/tidak memiliki program studi|tidak akan mengganti jawaban dengan prodi lain/i);
        expect(result.answer).not.toMatch(/Rp\.?\s*(?:6\.500\.000|14\.000\.000)|UKT|DPP|Sistem Informasi|Teknologi Informasi|Bisnis Digital|Manajemen Informatika/i);
      }
    }
  });

  test('supported program aliases remain on normal routes and are not unsupported candidates', async () => {
    const { buildCanonicalQueryUnderstanding } = require('../src/engine/queryUnderstanding');
    const controls = [
      { q: 'biaya SI berapa?', entity: 'Sistem Informasi', notSource: 'semantic-rag-out-of-domain' },
      { q: 'akreditasi TI apa?', entity: 'Teknologi Informasi', notSource: 'semantic-rag-out-of-domain' },
      { q: 'cara daftar BD gimana?', entity: 'Bisnis Digital', notSource: 'semantic-rag-out-of-domain' },
      { q: 'profil MI itu apa?', entity: 'Manajemen Informatika', notSource: 'semantic-rag-out-of-domain' },
      { q: 'lama studi S2 Sistem Informasi berapa semester?', entity: 'S2 Sistem Informasi', notSource: 'semantic-rag-out-of-domain' }
    ];

    for (const item of controls) {
      const canonical = buildCanonicalQueryUnderstanding(item.q).contract;
      expect(canonical.constraints.unsupportedEntityCandidate).toBeUndefined();
      expect(canonical.entities).toEqual(expect.arrayContaining([expect.objectContaining({ canonical: item.entity, group: 'programs' })]));
      const result = await ask(item.q);
      expect(result.source).not.toBe(item.notSource);
      expect(result.debug.semanticContract.constraints.unsupportedEntityCandidate).toBeUndefined();
    }
  });

  test('keeps cross-domain exchange negative control away from Student Exchange', async () => {
    const result = await ask('apa manfaat exchange barang bekas?');
    expect(result.source).not.toBe('semantic-rag-international-topic-composer');
    expect(result.answer).not.toMatch(/Student Exchange|pertukaran mahasiswa/i);
  });
});