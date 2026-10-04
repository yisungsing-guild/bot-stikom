const { validateClarificationOutput } = require('../src/utils/answerOutputContract');
const { hasConcreteNumberOrAmount } = require('../src/utils/answerAmount');
const contract = { domain: 'fee', requestType: 'fee', entities: [], constraints: {} };
const output = { outputType: 'CLARIFICATION', clarification: { domain: 'fee', missingSlots: ['program', 'wave'] }, answer: 'Sebutkan prodi dan gelombang yang dimaksud.' };

test('explicit missing-slot clarification is relevant without an amount', () => {
  expect(validateClarificationOutput(output, contract).ok).toBe(true);
});
test.each([
  { ...output, answer: 'Biayanya Rp 750000. Sebutkan prodi dan gelombang.' },
  { ...output, answer: 'Silakan kirim alamat email.' },
  { ...output, clarification: { domain: 'scholarship', missingSlots: ['program'] } },
  { ...output, clarification: { domain: 'fee', missingSlots: [] } }
])('invalid clarification metadata cannot bypass validation', result => {
  expect(validateClarificationOutput(result, contract).ok).toBe(false);
});
test('wording alone does not establish output type', () => {
  expect(validateClarificationOutput({ ...output, outputType: 'ANSWER' }, contract)).toBeNull();
});
test.each(['Gelombang II', 'kelas 3', 'tahun 2026', 'ranking 1'])('noncurrency answer still fails: %s', text => {
  expect(hasConcreteNumberOrAmount(text, { financial: true })).toBe(false);
});

describe('real semantic clarification and amount outputs', () => {
  jest.setTimeout(120000);
  let querySemanticRag;
  beforeAll(() => {
    process.env.OPENAI_API_KEY = '';
    process.env.RAG_TRACE_PERSIST = 'false';
    process.env.SEMANTIC_RAG_DB_CONTENT_FALLBACK = 'false';
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
    ({ querySemanticRag } = require('../src/engine/semanticRagEngine'));
  });
  test.each(['uang pangkalnya berapa?', 'potongannya berapa?', 'totalnya berapa?', 'cicilannya bagaimana?', 'biaya semesterannya berapa?'])('missing slots: %s', async query => {
    const r = await querySemanticRag(query);
    console.log(JSON.stringify({ query, source: r.source, outputType: r.outputType, clarification: r.clarification, answer: r.answer, shape: r.debug?.answerShapeCheck }));
    expect(r.outputType).toBe('CLARIFICATION');
    expect(r.source).not.toMatch(/mismatch|blocked/);
    expect(r.answer).toMatch(/prodi|program|gelombang/);
  });
  test.each(['uang pangkal TI gelombang 2 berapa?', 'potongan TI gelombang 2 berapa?', 'biaya semester TI berapa?'])('complete amount request: %s', async query => {
    const r = await querySemanticRag(query);
    console.log(JSON.stringify({ query, source: r.source, outputType: r.outputType, answer: r.answer }));
    expect(r.outputType).toBe('ANSWER');
    expect(r.source).not.toMatch(/mismatch|blocked/);
    expect(hasConcreteNumberOrAmount(r.answer, { financial: true })).toBe(true);
  });
});
