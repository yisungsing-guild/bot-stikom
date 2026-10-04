const { buildCanonicalQueryUnderstanding } = require('../src/engine/queryUnderstanding');
const { querySemanticRag } = require('../src/engine/semanticRagEngine');
const { hasConcreteNumberOrAmount } = require('../src/utils/answerAmount');
process.env.OPENAI_API_KEY = '';
process.env.RAG_TRACE_PERSIST = 'false';
process.env.SEMANTIC_RAG_DB_CONTENT_FALLBACK = 'false';
process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
jest.setTimeout(120000);

test.each(['totalnya berapa?', 'total berapa?', 'jadi totalnya?', 'hitung totalnya?'])('unanchored total asks for clarification: %s', async query => {
  const r = await querySemanticRag(query);
  expect(r.outputType).toBe('CLARIFICATION');
  expect(r.source).not.toMatch(/blocked|mismatch/);
});

test.each(['biaya semesterannya berapa?', 'biaya per semesternya?', 'semesterannya berapa?', 'UKT per semester berapa?', 'biaya kuliah per semester?', 'kalau semesterannya?'])('semester field survives morphology: %s', async query => {
  const c = buildCanonicalQueryUnderstanding(query);
  expect(c.constraints.feeType).toBe('ukt');
  expect(c.requestedFields).toContain('tuitionFee');
  const r = await querySemanticRag(query);
  expect(r.outputType).toBe('CLARIFICATION');
  expect(r.clarification.missingSlots).toEqual(['program']);
  expect(r.source).not.toMatch(/comparison|blocked|mismatch/);
});

test.each(['biaya semester TI berapa?', 'semesterannya SI berapa?', 'biaya per semester S2 berapa?'])('explicit program receives amount: %s', async query => {
  const r = await querySemanticRag(query);
  expect(r.outputType).toBe('ANSWER');
  expect(hasConcreteNumberOrAmount(r.answer, { financial: true })).toBe(true);
  expect(r.source).not.toMatch(/blocked|mismatch/);
});
test.each(['semester 2 kapan?', 'jadwal semester genap?', 'mata kuliah semester 1?'])('academic semester is not fee: %s', query => {
  expect(buildCanonicalQueryUnderstanding(query).domain.primary).not.toBe('fee');
});

const contexts = [
  ['fresh', {}],
  ['active fee', { stableSemanticContext: { domain: 'fee', establishedAt: new Date().toISOString(), sourceTurn: 'biaya kuliah' } }],
  ['TI', { stableSemanticContext: { domain: 'fee', program: 'Teknologi Informasi', establishedAt: new Date().toISOString(), sourceTurn: 'biaya TI' } }],
  ['S2', { stableSemanticContext: { domain: 'fee', program: 'S2 Sistem Informasi', establishedAt: new Date().toISOString(), sourceTurn: 'biaya S2' } }],
  ['stale', { stableSemanticContext: { domain: 'fee', program: 'Teknologi Informasi', establishedAt: '2020-01-01T00:00:00.000Z', sourceTurn: 'biaya TI' } }]
];
describe.each(contexts)('installment in %s context', (_name, sessionData) => {
  test.each(['bisa nyicil ga?', 'bisa dicicil?', 'cicilannya bagaimana?', 'boleh bayar bertahap?', 'ada angsuran?', 'pembayaran bisa dicicil?'])('%s remains owned', async query => {
    const r = await querySemanticRag(query, { sessionData });
    if (/blocked|mismatch|disabled/.test(r.source)) console.log(JSON.stringify({ query, sessionData, source: r.source, contract: r.debug?.semanticContract, shape: r.debug?.answerShapeCheck, answer: r.answer }));
    expect(r.source).not.toMatch(/blocked|mismatch|disabled/);
    expect(r.answer).toMatch(/cicilan|pembayaran|keuangan|angsuran/);
  });
});
