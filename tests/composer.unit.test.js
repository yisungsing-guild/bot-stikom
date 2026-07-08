const { shouldClarify, shouldReflect } = require('../src/engine/composer');

describe('Composer semantics: clarify & reflect', () => {
  test('shouldReflect: returns true when session has reused context and programHint', () => {
    const res = shouldReflect({ intentConf: 0.5, topRetrievalScore: 0.2, userQuery: 'beasiswa ada?', session: { contextReused: true, programHint: 'Teknologi Informasi' } });
    expect(res).toBe(true);
  });

  test('shouldReflect: returns true when session has topic hint and short follow-up', () => {
    const res = shouldReflect({ intentConf: 0.2, topRetrievalScore: 0.1, userQuery: 'beasiswa ada?', session: { programHint: 'Teknologi Informasi' } });
    expect(res).toBe(true);
  });

  test('shouldReflect: returns false when long question or low reuse', () => {
    const res = shouldReflect({ intentConf: 0.8, topRetrievalScore: 0.9, userQuery: 'Ceritakan detail kurikulum dan mata kuliah selama empat tahun untuk S1 Teknologi Informasi di kampus X', session: {} });
    expect(res).toBe(false);
  });

  test('shouldClarify: no clarification when topic context present and short follow-up', () => {
    const res = shouldClarify({ intentConf: 0.2, ragScore: 0.1, userQuery: 'biaya?', session: { programHint: 'Teknologi Informasi' } });
    expect(res).toBe(false);
  });

  test('shouldClarify: clarification when ambiguous short query with no context', () => {
    const res = shouldClarify({ intentConf: 0.1, ragScore: 0.0, userQuery: 'berapa?', session: {} });
    expect(res).toBe(true);
  });
});
