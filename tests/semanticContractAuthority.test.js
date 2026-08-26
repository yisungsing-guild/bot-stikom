const express = require('express');
const request = require('supertest');
const { buildCanonicalQueryUnderstanding } = require('../src/engine/queryUnderstanding');
const { querySemanticRag } = require('../src/engine/semanticRagEngine');
const { selectEvidenceFromContexts, evaluateEvidenceAnswerability } = require('../src/engine/evidenceSelector');

process.env.NODE_ENV = 'test';
process.env.FORCE_BUNDLED_INDEX = 'true';
process.env.ENABLE_RAG = 'true';
process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';
delete process.env.OPENAI_API_KEY;

function contractOf(q) {
  return buildCanonicalQueryUnderstanding(q).contract;
}

describe('end-to-end semantic contract authority', () => {
  jest.setTimeout(180000);

  test('PMB opening paraphrases stay topic_opening, not procedure/channel/fee/schedule', () => {
    const cases = [
      'mau tanya pmb',
      'boleh nanya soal penerimaan mahasiswa baru?',
      'info pmb dong',
      'saya mau bertanya mengenai pendaftaran mahasiswa baru'
    ];
    for (const q of cases) {
      const c = contractOf(q);
      expect(c.domain).toBe('registration');
      expect(c.intent).toBe('ask_general');
      expect(c.requestType).toBe('topic_opening');
      expect(c.answerShape).toBe('acknowledge_topic_only');
      expect(c.requestedFields).not.toContain('procedureSteps');
    }

    expect(contractOf('bagaimana cara mendaftar?').requestType).toBe('procedure');
    expect(contractOf('link pendaftarannya?').requestType).toBe('registration_channel');
    expect(contractOf('berapa biaya pendaftaran?').requestType).toBe('fee');
    expect(contractOf('kapan pendaftaran dibuka?').requestType).toBe('schedule');
  });

  test('Double Degree availability constraints are not replaced by neighboring subtypes', async () => {
    const nationalContract = contractOf('apakah ada double degree nasional?');
    expect(nationalContract.domain).toBe('double_degree');
    expect(nationalContract.intent).toBe('ask_availability');
    expect(nationalContract.requestType).toBe('availability');

    const national = await querySemanticRag('apakah ada double degree nasional?', { topK: 5 });
    expect(national.source).toBe('semantic-rag-contract-verifier-blocked');
    expect(national.debug.semanticContract.requestType).toBe('availability');
    expect(national.debug.contractVerification.reason).toBe('missing_national_constraint');
    expect(national.answer).toMatch(/belum menemukan data|konfirmasi/i);
    expect(national.answer).not.toMatch(/HELP University|DNUI|Bachelor of/i);

    const international = await querySemanticRag('apakah ada double degree internasional?', { topK: 5 });
    expect(international.source).not.toBe('semantic-rag-contract-verifier-blocked');
    expect(international.debug.semanticContract.requestType).toBe('availability');
    expect(international.answer).toMatch(/HELP University|DNUI|Malaysia|China/i);
  });

  test('evidence selector rejects constraint collision evidence even when the loose domain fact is true', () => {
    const semanticContract = contractOf('apakah ada double degree nasional?');
    const contexts = [
      { id: 'wrong-neighbor', chunk: 'Program Double Degree tersedia dengan HELP University Malaysia dan DNUI China.' },
      { id: 'collision', chunk: 'Inkubator Bisnis mengikuti kompetisi wirausaha tingkat nasional dan mendukung tenant kampus.' }
    ];
    const selected = selectEvidenceFromContexts({
      question: 'apakah ada double degree nasional?',
      contexts,
      intent: 'dual_degree',
      semanticContract
    });
    const answerability = evaluateEvidenceAnswerability({
      question: 'apakah ada double degree nasional?',
      selectedEvidence: selected,
      intent: 'dual_degree',
      semanticContract
    });
    expect(selected).toHaveLength(0);
    expect(answerability.answerable).toBe(false);
  });

  test('provider path preserves unsupported national availability behavior', async () => {
    const providerRouterFactory = require('../src/routes/provider');
    const sent = [];
    const provider = { sendMessage: jest.fn(async (chatId, text) => sent.push(String(text || ''))), sendImage: jest.fn(async () => {}) };
    const app = express();
    app.use(express.json());
    app.use('/provider', providerRouterFactory(provider));

    await request(app)
      .post('/provider/webhook')
      .set('x-webhook-token', process.env.PROVIDER_WEBHOOK_TOKEN)
      .send({ chatId: 'contract-authority-' + Date.now(), text: 'apakah ada double degree nasional?', ts: Date.now() })
      .expect(200);

    const out = sent.join('\n');
    expect(out).toMatch(/belum menemukan data|konfirmasi/i);
    expect(out).not.toMatch(/HELP University|DNUI|Bachelor of/i);
  });
});

