const {
  buildCanonicalQueryUnderstanding,
  resolveProgramEntities,
  buildTemporalUnderstanding
} = require('../src/engine/queryUnderstanding');

describe('canonical query understanding', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV, SEMANTIC_RAG_TODAY_YMD: '2026-08-19' };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  test('centralizes trusted program aliases without substring false positives', () => {
    expect(resolveProgramEntities('TI kuliahnya gimana?')[0].canonical).toBe('Teknologi Informasi');
    expect(resolveProgramEntities('kalau ambil informatika biayanya gimana?')[0].canonical).toBe('Teknologi Informasi');
    expect(resolveProgramEntities('anak BD belajar AI gak?')[0].canonical).toBe('Bisnis Digital');
    expect(resolveProgramEntities('di SI belajar apa?')[0].canonical).toBe('Sistem Informasi');

    expect(resolveProgramEntities('situ dimana?')).toHaveLength(0);
    expect(resolveProgramEntities('berapa SKS untuk lulus?')).toHaveLength(0);
    expect(resolveProgramEntities('skema pembayarannya bagaimana?')).toHaveLength(0);
    expect(resolveProgramEntities('tiada informasi lain')).toHaveLength(0);
  });

  test('separates campus location intent from physical-attribute intent', () => {
    const location = buildCanonicalQueryUnderstanding('alamat kampus Renon apa?');
    expect(location.domain.primary).toBe('campus_location');
    expect(location.intent.primary).toBe('ask_location');
    expect(location.constraints.locationIntent).toBe(true);

    const physical = buildCanonicalQueryUnderstanding('berapa luas kampus Renon?');
    expect(physical.domain.primary).toBe('campus_physical');
    expect(physical.intent.primary).toBe('ask_physical_attribute');
    expect(physical.constraints.locationIntent).toBe(false);
  });

  test('separates fee subtype from program entity', () => {
    const ukt = buildCanonicalQueryUnderstanding('UKT sistem informasi');
    expect(ukt.domain.primary).toBe('fee');
    expect(ukt.intent.primary).toBe('ask_fee');
    expect(ukt.constraints.feeType).toBe('ukt');
    expect(ukt.entities.programs[0].canonical).toBe('Sistem Informasi');

    const registration = buildCanonicalQueryUnderstanding('biaya daftar SI');
    expect(registration.constraints.feeType).toBe('registration_fee');
    expect(registration.entities.programs[0].canonical).toBe('Sistem Informasi');
  });

  test('detects registration, curriculum, facility, and advice meaning classes', () => {
    expect(buildCanonicalQueryUnderstanding('cara daftarnya').intent.primary).toBe('ask_registration_how');

    const curriculum = buildCanonicalQueryUnderstanding('apakah mahasiswa BD belajar AI?');
    expect(curriculum.domain.primary).toBe('program_curriculum');
    expect(curriculum.entities.programs[0].canonical).toBe('Bisnis Digital');
    expect(curriculum.routingQuery).toMatch(/Bisnis Digital/);
    expect(curriculum.routingQuery).toMatch(/kurikulum/);

    const facility = buildCanonicalQueryUnderstanding('fasilitas kampus apa saja?');
    expect(facility.domain.primary).toBe('campus_facility');
    expect(facility.answerExpectation).toBe('list');

    const advice = buildCanonicalQueryUnderstanding('Saya kurang cakap di bidang Teknologi Informasi, apa yang harus saya lakukan?');
    expect(advice.domain.primary).toBe('program_advice');
    expect(advice.entities.programs[0].canonical).toBe('Teknologi Informasi');

    const career = buildCanonicalQueryUnderstanding('ada bantuan persiapan kerja untuk mahasiswa?');
    expect(career.domain.primary).toBe('career');
    expect(career.intent.primary).toBe('ask_career_service');
  });

  test('preserves P0 temporal priority explicit date over current date', () => {
    const temporal = buildTemporalUnderstanding('gelombang 1 masih buka tanggal 7 juli 2026?');
    expect(temporal.currentDate).toBe('2026-08-19');
    expect(temporal.explicitDate).toBe('2026-07-07');
    expect(temporal.referenceDate).toBe('2026-07-07');
    expect(temporal.reason).toBe('explicitDate');
  });

  test('resolves relative month and current-date controls', () => {
    const relative = buildCanonicalQueryUnderstanding('bulan depan masuk gelombang berapa?');
    expect(relative.temporal.referenceDate).toBe('2026-09-01');
    expect(relative.temporal.reason).toBe('relativeDate');
    expect(relative.temporal.requestedMonth).toMatchObject({ year: 2026, month: 9, relative: 'bulan depan' });

    const current = buildCanonicalQueryUnderstanding('PMB masih buka?');
    expect(current.temporal.referenceDate).toBe('2026-08-19');
    expect(current.temporal.reason).toBe('currentDate');
    expect(current.intent.primary).toBe('ask_schedule');
    expect(current.domain.primary).toBe('pmb_schedule');
  });

  test('classifies thesis page-count as an academic topic constraint', () => {
    const academic = buildCanonicalQueryUnderstanding('berapa halaman minimal dibuat untuk tugas akhir di prodi SI atau fakultas infokom');
    expect(academic.domain.primary).toBe('academic');
    expect(academic.intent.primary).toBe('ask_academic_info');
    expect(academic.constraints.academicTopic).toBe('thesis_page_count');
    expect(academic.entities.programs[0].canonical).toBe('Sistem Informasi');
  });
});


test('separates career-goal program recommendation from catalogue/list intent', () => {
  const positive = [
    'Saya ingin kerja mengolah data, jurusan mana yang cocok?',
    'Kalau mau jadi data analyst sebaiknya ambil prodi apa?',
    'Saya suka analisis bisnis dan teknologi, jurusan yang cocok apa?',
    'Kalau target kerja di digital marketing, pilih jurusan apa?'
  ];

  for (const query of positive) {
    const canonical = buildCanonicalQueryUnderstanding(query);
    expect(canonical.intent.primary).toBe('ask_program_recommendation');
    expect(canonical.domain.primary).toBe('program_recommendation');
    expect(canonical.requestedFields).toEqual(expect.arrayContaining(['programRecommendation', 'careerGoal']));
    expect(canonical.requestedFields).not.toContain('programList');
    expect(canonical.constraints.unsupportedEntityCandidate).toBeFalsy();
  }

  const catalogue = [
    'Daftar jurusan apa saja?',
    'Ada prodi apa saja?',
    'Sebutkan semua program S1.'
  ];

  for (const query of catalogue) {
    const canonical = buildCanonicalQueryUnderstanding(query);
    expect(canonical.intent.primary).toBe('ask_program_list');
    expect(canonical.domain.primary).toBe('program');
    expect(canonical.requestedFields).toContain('programList');
  }

  const neighboring = [
    'Apa itu data?',
    'Daftar ulang kapan?',
    'Mata kuliah pengolahan data ada?',
    'Program mana yang paling murah?'
  ];

  for (const query of neighboring) {
    const canonical = buildCanonicalQueryUnderstanding(query);
    expect(canonical.intent.primary).not.toBe('ask_program_recommendation');
    expect(canonical.domain.primary).not.toBe('program_recommendation');
  }
});

describe('Indonesian morphology and requested-field object precedence', () => {
  function contractFor(query) {
    const contract = buildCanonicalQueryUnderstanding(query);
    return {
      intent: contract.intent && contract.intent.primary,
      domain: contract.domain && contract.domain.primary,
      programs: (contract.entities && contract.entities.programs || []).map((program) => program.canonical),
      fields: contract.requestedFields || [],
      feeType: contract.constraints && contract.constraints.feeType,
      scholarshipSubtype: contract.constraints && contract.constraints.scholarshipRequestSubtype
    };
  }

  test('registration fee morphology keeps equivalent contracts across suffixes, slang, and reordered wording', () => {
    [
      'TI berapa biaya pendaftaran?',
      'TI brp biaya daftar?',
      'TI berapa daftarnya?',
      'biaya daftarnya TI berapa?',
      'pendaftarannya TI berapa?'
    ].forEach((query) => {
      const c = contractFor(query);
      expect(c.intent).toBe('ask_fee');
      expect(c.domain).toBe('fee');
      expect(c.programs).toContain('Teknologi Informasi');
      expect(c.fields).toEqual(expect.arrayContaining(['amount', 'registrationFee']));
      expect(c.feeType).toBe('registration_fee');
    });
  });

  test('learning-content object outranks generic apa saja catalogue detection', () => {
    [
      ['apa saja mata kuliahnya TI?', 'Teknologi Informasi'],
      ['belajar apa di Sistem Informasi?', 'Sistem Informasi'],
      ['kurikulumnya bagaimana di Bisnis Digital?', 'Bisnis Digital'],
      ['materi apa yang dipelajari S2?', 'S2 Sistem Informasi'],
      ['nanti belajar apa saja di TI?', 'Teknologi Informasi'],
      ['pelajarannya apa di Sistem Komputer?', 'Sistem Komputer']
    ].forEach(([query, expectedProgram]) => {
      const c = contractFor(query);
      expect(c.intent).toBe('ask_program_curriculum');
      expect(c.domain).toBe('program_curriculum');
      expect(c.programs).toContain(expectedProgram);
      expect(c.fields).toEqual(expect.arrayContaining(['focus', 'curriculumFocus']));
      expect(c.fields).not.toContain('programList');
    });

    const s2 = contractFor('Apa saja yang di pelajari di s2?');
    expect(s2.intent).toBe('ask_program_curriculum');
    expect(s2.domain).toBe('program_curriculum');
    expect(s2.fields).toEqual(expect.arrayContaining(['focus', 'curriculumFocus']));
    expect(s2.fields).not.toContain('programList');
  });

  test('catalogue and neighboring requested objects remain distinct', () => {
    ['apa saja prodinya?', 'Ada prodi apa saja?', 'Sebutkan semua program S1.'].forEach((query) => {
      const c = contractFor(query);
      expect(c.intent).toBe('ask_program_list');
      expect(c.domain).toBe('program');
      expect(c.fields).toContain('programList');
    });

    const requirements = contractFor('apa saja syaratnya daftar?');
    expect(requirements.intent).toBe('ask_registration_requirements');
    expect(requirements.domain).toBe('registration');
    expect(requirements.fields).toContain('requirements');

    const scholarship = contractFor('apa saja beasiswanya?');
    expect(scholarship.intent).toBe('ask_scholarship');
    expect(scholarship.domain).toBe('scholarship');
    expect(scholarship.fields).toContain('scholarshipList');
    expect(scholarship.scholarshipSubtype).toBe('list_overview');
  });

  test('negative controls prevent over-normalization and wrong career/list routing', () => {
    const procedure = contractFor('cara daftar bagaimana?');
    expect(procedure.intent).toBe('ask_registration_how');
    expect(procedure.domain).toBe('registration');
    expect(procedure.feeType).toBeNull();

    const ulang = contractFor('daftar ulang kapan?');
    expect(ulang.domain).toBe('pmb_schedule');
    expect(ulang.feeType).toBeNull();

    expect(contractFor('apa itu data?').intent).not.toBe('ask_program_recommendation');
    expect(contractFor('Program mana yang paling murah?').intent).not.toBe('ask_program_recommendation');
  });
});
