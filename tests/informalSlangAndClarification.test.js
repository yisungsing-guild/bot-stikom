'use strict';

const { processTurn } = require('../src/core/orchestrator');
const { resolveSemanticFrame } = require('../src/core/semanticFrameResolver');

describe('Informal Language, Slang Normalization & Controlled Clarification (Tahap 3)', () => {
  jest.setTimeout(30000);

  test('normalizes common Indonesian chat abbreviations locally without distorting meaning', () => {
    const raw = 'byr kuliah s1 si brp ya kak? syrt maba apa aja?';
    const frame = resolveSemanticFrame(raw);
    expect(frame.domain).toBe('TUITION_FEE');
    expect(frame.entities.some(e => e.canonical === 'S1 Sistem Informasi')).toBe(true);
  });

  test('contextualizes ambiguous clarification for evening/shift class inquiries (O05)', async () => {
    const res = await processTurn('test_inf_o05_' + Date.now(), 'Apakah ada kelas malam untuk karyawan yang kerja shift?');
    expect(res.finalAnswer).toBeDefined();
    // Must contain topic context regarding evening/shift/karyawan classes
    expect(res.finalAnswer).toMatch(/(?:kelas|karyawan|sore|malam|jadwal|kuliah)/i);
    // Must present clarification options for study programs
    expect(res.finalAnswer).toMatch(/S1 Sistem Informasi|S1 Teknologi Informasi|S1 Bisnis Digital/i);
  });

  test('recognizes D3 to S1 transfer / RPL admission pathway as answerable (O06)', async () => {
    const res = await processTurn('test_inf_o06_' + Date.now(), 'Kalau saya sudah lulus D3, bisa lanjut transfer S1 di STIKOM Bali tidak?');
    expect(res.finalAnswer).toBeDefined();
    expect(res.finalAnswer).toMatch(/(?:bisa|transfer|lanjut(?:an)?|RPL|S1|D3)/i);
    // Must not be rejected as unanswerable or empty
    expect(res.finalAnswer).not.toMatch(/belum tercantum secara lengkap dalam panduan/i);
  });

  test('handles highly abbreviated campus location inquiry correctly without timing out', async () => {
    const res = await processTurn('test_inf_loc_' + Date.now(), 'dimn kmps stikom bali yg rnon?');
    expect(res.finalAnswer).toBeDefined();
    expect(res.finalAnswer).toMatch(/Puputan|Renon|Denpasar/i);
  });

  test('preserves domain boundary for out-of-domain queries even with conversational slang', async () => {
    const res = await processTurn('test_inf_ood_' + Date.now(), 'min resep nasi goreng kambing pedas gmn ya?');
    expect(res.finalAnswer).toBeDefined();
    expect(res.finalAnswer).toMatch(/luar cakupan|khusus melayani|layanan ini khusus/i);
  });
});
