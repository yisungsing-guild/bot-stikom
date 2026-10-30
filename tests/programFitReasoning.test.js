const {
  PROGRAMS,
  detectProgramFitSignals,
  getProgramFitCandidates,
  buildProgramFitAnswer
} = require('../src/engine/programFitReasoning');

describe('programFitReasoning (Wave 2 Neutral Curriculum Profile Authority)', () => {
  test('gathers official curriculum profiles neutrally without lexical winner selection', () => {
    const signals = detectProgramFitSignals('Saya ingin kuliah di STIKOM Bali');
    const candidates = getProgramFitCandidates('Saya ingin kuliah di STIKOM Bali');

    expect(signals.length).toBe(1);
    expect(signals[0].key).toBe('official_curriculum_profiles');
    expect(signals[0].weights).toEqual({});
    expect(candidates.length).toBe(Object.keys(PROGRAMS).length);
    for (const c of candidates) {
      expect(c.confidence).toBe('NEUTRAL');
      expect(c.levels).toEqual(['candidate']);
    }
  });

  test('includes Double Degree UTB with official DKV grounding in neutral curriculum overview', () => {
    const result = buildProgramFitAnswer('Saya suka menggambar dan desain poster, cocok jurusan apa?');

    expect(result).toBeTruthy();
    expect(result.answer).toMatch(/Double Degree UTB/i);
    expect(result.answer).toMatch(/DKV/i);
    expect(result.answer).toMatch(/Bisnis Digital di ITB STIKOM Bali/i);
    expect(result.answer).not.toMatch(/DNUI.*DKV|HELP.*DKV/i);
  });

  test('presents relevant study programs neutrally with clarifying question instead of heuristic personality scoring', () => {
    const res1 = buildProgramFitAnswer('Saya introvert dan lebih suka kerja sendiri, cocoknya ambil apa?');
    const res2 = buildProgramFitAnswer('Saya suka komunikasi dan jualan, cocok jurusan apa?');

    expect(res1.answer).toMatch(/Teknologi Informasi/i);
    expect(res1.answer).toMatch(/Sistem Informasi/i);
    expect(res1.answer).toMatch(/Sistem Komputer/i);
    expect(res2.answer).toMatch(/Bisnis Digital/i);
    expect(res1.answer).toMatch(/tidak menebak/i);
  });

  test('filters curriculum profiles by explicit scope constraint (e.g. D3 or S1) without heuristic scores', () => {
    const d3Candidates = getProgramFitCandidates('Saya cari program vokasi', {
      scopeConstraints: { academicLevel: 'D3' }
    });
    expect(d3Candidates.some(c => c.program.key === 'mi')).toBe(true);
    expect(d3Candidates.some(c => c.program.key === 'utb')).toBe(false);
  });

  test('keeps DNUI and HELP partner majors explicitly unknown when mentioned as grounding', () => {
    const result = buildProgramFitAnswer('Saya ingin pengalaman internasional dan bisnis digital');

    expect(result.answer).toMatch(/Double Degree DNUI/i);
    expect(result.answer).toMatch(/Double Degree HELP University/i);
    expect(result.answer).not.toMatch(/DNUI.*DKV/i);
    expect(result.answer).not.toMatch(/HELP.*DKV/i);
  });
});
