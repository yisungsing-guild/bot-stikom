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
