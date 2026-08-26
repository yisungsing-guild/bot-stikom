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

  test('Double Degree availability constraints route to the requested scope', async () => {
    const nationalContract = contractOf('apakah ada double degree nasional?');
    expect(nationalContract.domain).toBe('double_degree');
    expect(nationalContract.intent).toBe('ask_availability');
    expect(nationalContract.requestType).toBe('availability');
    expect(nationalContract.constraints.programScope).toBe('national');
    expect(nationalContract.requestedFields).toEqual(expect.arrayContaining(['availability', 'partner', 'programScope']));

    const national = await querySemanticRag('apakah ada double degree nasional?', { topK: 5 });
    expect(national.source).toBe('semantic-rag-dual-degree');
    expect(national.debug.semanticContract.requestType).toBe('availability');
    expect(national.debug.contractVerification.reason).toBe('contract_preserved');
    expect(national.answer).toMatch(/Double Degree nasional|UTB|Universitas Teknologi Bandung|DKV/i);
    expect(national.answer).not.toMatch(/HELP University|DNUI|Bachelor of/i);

    const internationalContract = contractOf('apakah ada double degree internasional?');
    expect(internationalContract.constraints.programScope).toBe('international');

    const international = await querySemanticRag('apakah ada double degree internasional?', { topK: 5 });
    expect(international.source).toBe('semantic-rag-dual-degree');
    expect(international.debug.semanticContract.requestType).toBe('availability');
    expect(international.debug.contractVerification.reason).toBe('contract_preserved');
    expect(international.answer).toMatch(/Double Degree internasional/i);
    expect(international.answer).toMatch(/HELP University|DNUI|Malaysia|China/i);
    expect(international.answer).not.toMatch(/UTB|Universitas Teknologi Bandung|DKV/i);
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

  function buildProviderApp() {
    const providerRouterFactory = require('../src/routes/provider');
    const sent = [];
    const provider = { sendMessage: jest.fn(async (chatId, text) => sent.push(String(text || ''))), sendImage: jest.fn(async () => {}) };
    const app = express();
    app.use(express.json());
    app.use('/provider', providerRouterFactory(provider));
    return { app, sent };
  }

  async function askProvider(ctx, chatId, text) {
    const before = ctx.sent.length;
    await request(ctx.app)
      .post('/provider/webhook')
      .set('x-webhook-token', process.env.PROVIDER_WEBHOOK_TOKEN)
      .send({ chatId, text, ts: Date.now() })
      .expect(200);
    return ctx.sent.slice(before).join('\\n');
  }

  function parseDoubleDegreePartners(answer) {
    return String(answer || '')
      .split(/\n+/)
      .filter(line => /^\s*[-*]\s+/.test(line))
      .map(line => line.replace(/^\s*[-*]\s*/, '').trim())
      .filter(line => /double\s+degree|dual\s+degree|dnui|help\s+university|utb|universitas\s+teknologi\s+bandung/i.test(line))
      .map(line => ({
        line,
        scope: /\b(?:china|malaysia|international|internasional)\b|dnui|help\s+university/i.test(line) ? 'international'
          : (/\b(?:utb|universitas\s+teknologi\s+bandung|national|nasional|indonesia|bandung)\b/i.test(line) ? 'national' : 'unknown')
      }));
  }

  test('Double Degree international completeness follows source-supported scope', async () => {
    const all = await querySemanticRag('apa saja program double degree yang tersedia?', { topK: 8 });
    const sourcePartners = parseDoubleDegreePartners(all.answer);
    const internationalPartners = sourcePartners.filter(p => p.scope === 'international');
    const nationalPartners = sourcePartners.filter(p => p.scope === 'national');
    expect(internationalPartners.length).toBeGreaterThanOrEqual(2);
    expect(nationalPartners.length).toBeGreaterThanOrEqual(1);

    for (const q of [
      'apakah ada program double degree internasional?',
      'program internasional double degree apa aja?',
      'ada dual degree luar negeri kah?'
    ]) {
      const result = await querySemanticRag(q, { topK: 8 });
      expect(result.source).toBe('semantic-rag-dual-degree');
      for (const partner of internationalPartners) {
        const anchor = (partner.line.includes(':') ? partner.line.split(':')[0] : partner.line).split(' - ')[0].trim();
        expect(result.answer).toEqual(expect.stringContaining(anchor));
      }
      for (const partner of nationalPartners) {
        const anchor = (partner.line.includes(':') ? partner.line.split(':')[0] : partner.line).split(' - ')[0].trim();
        expect(result.answer).not.toEqual(expect.stringContaining(anchor));
      }
    }
  });

  test('PMB production family and Double Degree scope survive provider webhook sessions', async () => {
    const ctx = buildProviderApp();
    const chatId = 'contract-authority-' + Date.now();

    const opening = await askProvider(ctx, chatId, 'saya ingin bertanya tentang pmb');
    expect(opening).toMatch(/PMB|Penerimaan Mahasiswa Baru/i);
    expect(opening).not.toMatch(/tidak dapat merangkumnya|belum menemukan data/i);

    const fee = await askProvider(ctx, chatId, 'berapa biaya pendaftaran?');
    expect(fee).toMatch(/Biaya pendaftaran|Rp\.\s*500\.000/i);
    expect(fee).not.toMatch(/belum menemukan data|tidak dapat merangkumnya/i);

    const schedule = await askProvider(ctx, chatId, 'kapan pendaftaran dibuka?');
    expect(schedule).toMatch(/PMB|pendaftaran|gelombang|2026/i);
    expect(schedule).not.toMatch(/belum menemukan data|tidak dapat merangkumnya/i);

    const international = await askProvider(ctx, chatId, 'apakah ada program double degree internasional?');
    expect(international).toMatch(/Double Degree internasional|DNUI|HELP University/i);
    expect(international).not.toMatch(/UTB|Universitas Teknologi Bandung|DKV/i);

    const nationalAfterInternational = await askProvider(ctx, chatId, 'kalau yang nasional ada?');
    expect(nationalAfterInternational).toMatch(/Double Degree nasional|UTB|Universitas Teknologi Bandung|DKV/i);
    expect(nationalAfterInternational).not.toMatch(/HELP University|DNUI|Bachelor of/i);
  });
});

