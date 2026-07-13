const {
  detectProgramFitSignals,
  getProgramFitCandidates,
  buildProgramFitAnswer
} = require('../src/engine/programFitReasoning');

describe('programFitReasoning', () => {
  test('maps visual design interest to Double Degree UTB with DKV grounding', () => {
    const result = buildProgramFitAnswer('Saya suka menggambar dan desain poster, cocok jurusan apa?');

    expect(result).toBeTruthy();
    expect(result.answer).toMatch(/Double Degree UTB/i);
    expect(result.answer).toMatch(/DKV \(Desain Komunikasi Visual\)/i);
    expect(result.answer).toMatch(/Bisnis Digital di ITB STIKOM Bali/i);
    expect(result.answer).not.toMatch(/DNUI.*DKV|HELP.*DKV/i);
  });

  test('treats DKV wording as a known visual design signal', () => {
    const signals = detectProgramFitSignals('Kalau saya mau DKV di STIKOM, ambil apa?');
    const candidates = getProgramFitCandidates('Kalau saya mau DKV di STIKOM, ambil apa?');

    expect(signals.map((item) => item.key)).toContain('visual_design');
    expect(candidates[0].program.key).toBe('utb');
  });

  test('uses personality reasoning beyond hobby keywords', () => {
    const introvert = buildProgramFitAnswer('Saya introvert dan lebih suka kerja sendiri, cocoknya ambil apa?');
    const extrovert = buildProgramFitAnswer('Saya suka komunikasi dan jualan, cocok jurusan apa?');

    expect(introvert.answer).toMatch(/Teknologi Informasi|Sistem Informasi|Sistem Komputer/i);
    expect(extrovert.answer).toMatch(/Bisnis Digital/i);
  });

  test('handles worries as reasoning signals without inventing official facts', () => {
    const math = buildProgramFitAnswer('Saya takut matematika tapi ingin kuliah bidang digital');
    const coding = buildProgramFitAnswer('Saya takut coding tapi suka desain dan branding');

    expect(math.answer).toMatch(/Bisnis Digital|Sistem Informasi/i);
    expect(coding.answer).toMatch(/Bisnis Digital|Double Degree UTB/i);
    expect(math.answer).toMatch(/tidak menebak/i);
    expect(coding.answer).toMatch(/tidak menebak/i);
  });

  test('keeps DNUI and HELP partner majors explicitly unknown when mentioned as grounding', () => {
    const result = buildProgramFitAnswer('Saya ingin pengalaman internasional dan bisnis digital');

    expect(result.answer).not.toMatch(/DNUI.*DKV/i);
    expect(result.answer).not.toMatch(/HELP.*DKV/i);
  });
});
