const { classifyIntent } = require('../src/engine/intentClassifier');

describe('intentClassifier regression: BIAYA priority', () => {
  const cases = [
    ['berapa biaya prodi TI gelombang 3A', 'BIAYA_PENDIDIKAN'],
    ['berapa biaya prodi Sistem Informasi gelombang 3A', 'BIAYA_PENDIDIKAN'],
    ['biaya program studi TI', 'BIAYA_PENDIDIKAN'],
    ['biaya jurusan Sistem Informasi', 'BIAYA_PENDIDIKAN'],
    ['biaya kuliah prodi TI', 'BIAYA_PENDIDIKAN']
  ];

  cases.forEach(([text, expected]) => {
    test(`'${text}' -> ${expected}`, () => {
      expect(classifyIntent(text)).toBe(expected);
    });
  });
});
