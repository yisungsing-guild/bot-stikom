'use strict';

const { processTurn } = require('../src/core/orchestrator');

describe('Grounded Degree Award Handler & Cross-Entity Isolation', () => {
  jest.setTimeout(30000);

  test('correctly resolves known degree for S1 Bisnis Digital (S.Bns)', async () => {
    const res = await processTurn('test_deg_bd_' + Date.now(), 'Apa gelar sarjana untuk lulusan S1 Bisnis Digital?');
    expect(res.finalAnswer).toBeDefined();
    expect(res.finalAnswer).toMatch(/S\.Bns|Sarjana Bisnis/i);
    // Entity isolation: must not award S.Kom or M.Kom to Bisnis Digital
    expect(res.finalAnswer).not.toMatch(/Sarjana Komputer|S\.Kom|Magister Komputer|M\.Kom/i);
  });

  test('correctly resolves known degree for S1 Sistem Informasi (S.Kom)', async () => {
    const res = await processTurn('test_deg_si_' + Date.now(), 'Lulusan S1 Sistem Informasi gelarnya apa?');
    expect(res.finalAnswer).toBeDefined();
    expect(res.finalAnswer).toMatch(/S\.Kom|Sarjana Komputer/i);
    // Entity isolation: must not award S.Bns to Sistem Informasi
    expect(res.finalAnswer).not.toMatch(/Sarjana Bisnis|S\.Bns/i);
  });

  test('correctly resolves known degree for S2 Magister Sistem Informasi (M.Kom)', async () => {
    const res = await processTurn('test_deg_s2_' + Date.now(), 'Lulusan S2 Magister Sistem Informasi bergelar apa?');
    expect(res.finalAnswer).toBeDefined();
    expect(res.finalAnswer).toMatch(/M\.Kom|Magister Komputer/i);
  });

  test('correctly corrects false degree premise without repeating false title as fact (K07)', async () => {
    const res = await processTurn('test_deg_k07_' + Date.now(), 'Apakah lulusan S1 Sistem Informasi gelarnya Sarjana Hukum (S.H.)?');
    expect(res.finalAnswer).toBeDefined();
    expect(res.finalAnswer).toMatch(/S\.Kom|Sarjana Komputer/i);
    expect(res.finalAnswer).not.toMatch(/Sarjana Hukum/i);
  });

  test('unoffered program without evidence does not invent or guess degree', async () => {
    const res = await processTurn('test_deg_unoffered_' + Date.now(), 'Apa gelar untuk lulusan jurusan Arsitektur di kampus ini?');
    expect(res.finalAnswer).toBeDefined();
    expect(res.finalAnswer).toMatch(/tidak ditemukan|tidak tersedia|luar cakupan|belum tercantum/i);
    expect(res.finalAnswer).not.toMatch(/Sarjana Arsitektur/i);
  });
});
