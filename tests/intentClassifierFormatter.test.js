const fs = require('fs');
const path = require('path');
const { classifyIntent } = require('../src/engine/intentClassifier');
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
    const input = '🎓 Kamu ingin tahu tentang program studi Sistem Informasi.\n\nSistem Informasi adalah jurusan yang mempelajari ...';
    expect(providerRoute.stripKamuInginTahuHeader(input)).toBe('Sistem Informasi adalah jurusan yang mempelajari ...');
  });

  test('aiEngine prompt style no longer contains the exact phrase "Kamu ingin tahu"', () => {
    const fileContent = fs.readFileSync(path.resolve(__dirname, '../src/engine/aiEngine.js'), 'utf8');
    expect(fileContent).not.toMatch(/Kamu ingin tahu/);
    expect(fileContent).toMatch(/Ini informasi biaya pendaftaran/);
  });
});
