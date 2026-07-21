const { classifyIntent } = require('../src/engine/intentClassifier');
const { query } = require('../src/engine/ragEngine');
const providerRoute = require('../src/routes/provider');

describe('Intent and formatter patch coverage', () => {
  test('prefers KURIKULUM_PEMBELAJARAN for curriculum-related questions', () => {
    const intent = classifyIntent('Apa yang dipelajari di program studi sistem informasi?');
    expect(intent).toBe('KURIKULUM_PEMBELAJARAN');
  });

  test('does not misclassify curriculum questions as DEFINISI_PRODI', () => {
    const intent = classifyIntent('Apa yang dipelajari di jurusan TI pada semester 1?');
    expect(intent).toBe('KURIKULUM_PEMBELAJARAN');
  });

  test('strips duplicate "Kamu ingin tahu" header from formatted outbound text', () => {
    const input = 'Kamu ingin tahu tentang program studi Sistem Informasi.\n\nSistem Informasi adalah jurusan yang mempelajari ...';
    expect(providerRoute.stripKamuInginTahuHeader(input)).toBe('Sistem Informasi adalah jurusan yang mempelajari ...');
  });

  test('fee registration questions are classified and answered behaviorally', async () => {
    expect(classifyIntent('berapa biaya pendaftaran prodi si?')).toBe('BIAYA_PENDIDIKAN');

    const result = await query('berapa biaya pendaftaran prodi si');
    expect(result && result.success).toBe(true);
    expect(String(result.answer || '')).toMatch(/Sistem\s+Informasi/i);
    expect(String(result.answer || '')).toMatch(/Rp\s*500\.000/i);
    expect(String(result.answer || '')).not.toMatch(/SOURCE_CHUNKS|Pasal|PIHAK\s+KESATU|Force\s+Majeure/i);
  });
});
