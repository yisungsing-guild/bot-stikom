'use strict';

const { processTurn } = require('../src/core/orchestrator');

describe('Homonym Collision: Hukum Physics vs Statutory Law Degree', () => {
  test('treats "hukum gravitasi Newton" as OUT_OF_DOMAIN, not as Law degree program', async () => {
    const res = await processTurn('test_hukum_newton_' + Date.now(), 'Jelaskan hukum gravitasi Newton dan rumus perhitungannya!');
    expect(res.finalAnswer).toBeDefined();
    expect(res.subQueryResults?.[0]?.answerability).toBe('OUT_OF_DOMAIN');
    expect(res.finalAnswer).toMatch(/(?:luar cakupan|khusus melayani|layanan resmi)/i);
    expect(res.finalAnswer).not.toMatch(/program studi \*\*Hukum\*\* tidak ditemukan/i);
  });

  test('treats "hukum termodinamika" as OUT_OF_DOMAIN', async () => {
    const res = await processTurn('test_hukum_termo_' + Date.now(), 'Bagaimana bunyi hukum termodinamika 1 dan 2?');
    expect(res.finalAnswer).toBeDefined();
    expect(res.subQueryResults?.[0]?.answerability).toBe('OUT_OF_DOMAIN');
    expect(res.finalAnswer).toMatch(/(?:luar cakupan|khusus melayani|layanan resmi)/i);
    expect(res.finalAnswer).not.toMatch(/program studi \*\*Hukum\*\* tidak ditemukan/i);
  });

  test('correctly detects genuine inquiry about "jurusan Hukum" as unoffered program', async () => {
    const res = await processTurn('test_jurusan_hukum_' + Date.now(), 'Apakah ada jurusan Hukum di ITB STIKOM Bali?');
    expect(res.finalAnswer).toBeDefined();
    expect(res.finalAnswer).toMatch(/program studi \*\*Hukum\*\* tidak ditemukan|tidak tersedia/i);
    expect(res.finalAnswer).toMatch(/S1 Sistem Informasi/i);
  });

  test('correctly detects inquiry about "fakultas Hukum / S1 Hukum"', async () => {
    const res = await processTurn('test_s1_hukum_' + Date.now(), 'Apakah kampus ini membuka S1 Hukum?');
    expect(res.finalAnswer).toBeDefined();
    expect(res.finalAnswer).toMatch(/Hukum/i);
    expect(res.finalAnswer).toMatch(/tidak ditemukan|tidak tersedia/i);
  });
});
