const path = require('path');
const { semanticRetrieveLocal } = require('../scripts/indexer/index_domains');

const localOut = path.join(process.cwd(), 'data', 'vec_index', 'domains_vectors.jsonl');

describe('Domain-scoped retrieval regression tests', () => {
  test('jelaskan double degree -> returns double_degree top', async () => {
    const res = await semanticRetrieveLocal(localOut, 'jelaskan double degree', 3);
    expect(res && res.length > 0).toBe(true);
    expect(res[0].category).toBe('double_degree');
  });

  test('ada beasiswa? -> returns scholarship top', async () => {
    const res = await semanticRetrieveLocal(localOut, 'ada beasiswa?', 3);
    expect(res && res.length > 0).toBe(true);
    expect(res[0].category).toBe('scholarship');
  });

  test('kelas internasional ada? -> returns international_program top', async () => {
    const res = await semanticRetrieveLocal(localOut, 'kelas internasional ada?', 3);
    expect(res && res.length > 0).toBe(true);
    expect(res[0].category).toBe('international_program');
  });
});
