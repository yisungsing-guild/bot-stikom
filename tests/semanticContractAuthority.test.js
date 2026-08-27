const express = require('express');
const request = require('supertest');
const { buildCanonicalQueryUnderstanding } = require('../src/engine/queryUnderstanding');
const { querySemanticRag, verifyOutboundSemanticRelevance } = require('../src/engine/semanticRagEngine');
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

  test('PMB registration-fee paraphrases preserve contract through verifier', async () => {
    for (const q of ['biaya daftar berapa', 'berapa uang pendaftaran', 'berapa biaya pendaftaran?']) {
      const canonical = contractOf(q);
      expect(['registration', 'fee']).toContain(canonical.domain);
      expect(canonical.requestType).toBe('fee');
      expect(canonical.requestedFields.some((field) => /^(?:fee|amount)$/i.test(String(field)))).toBe(true);

      const result = await querySemanticRag(q, { topK: 8 });
      expect(result.source).toBe('semantic-rag-registration-fee');
      expect(result.debug.semanticContract.requestType).toBe('fee');
      expect(result.debug.contractVerification.reason).toBe('contract_preserved');
      expect(result.answer).toMatch(/Biaya pendaftaran|Rp\.\s*500\.000/i);

      const verifier = await verifyOutboundSemanticRelevance(q, result.answer, result.source, {
        semanticContract: result.debug.semanticContract,
        contexts: result.contexts || []
      });
      expect(verifier.ok).toBe(true);
    }
  });

  test('Double Degree scoped follow-ups inherit parent contract and only switch scope', async () => {
    const parentInternational = contractOf('apakah ada program double degree internasional?');
    const parentNational = contractOf('apakah ada program double degree nasional?');
    const baseSession = (parent) => ({
      lastSemanticSource: 'semantic-rag-dual-degree',
      composerLastSource: 'semantic-rag-dual-degree',
      lastSemanticContract: parent
    });
    const cases = [
      { parent: parentInternational, q: 'yang nasional ada tidak', scope: 'national', must: /UTB|Universitas Teknologi Bandung|DKV/i, mustNot: /HELP University|DNUI|Bachelor of/i },
      { parent: parentInternational, q: 'kalau versi nasional?', scope: 'national', must: /UTB|Universitas Teknologi Bandung|DKV/i, mustNot: /HELP University|DNUI|Bachelor of/i },
      { parent: parentNational, q: 'kalau internasional?', scope: 'international', must: /DNUI|HELP University|Malaysia|China/i, mustNot: /UTB|Universitas Teknologi Bandung|DKV/i },
      { parent: parentNational, q: 'yang luar negeri apa saja', scope: 'international', must: /DNUI|HELP University|Malaysia|China/i, mustNot: /UTB|Universitas Teknologi Bandung|DKV/i }
    ];

    for (const item of cases) {
      const currentCanonical = contractOf(item.q);
      expect(currentCanonical.domain).toBe('general');
      expect(currentCanonical.constraints.programScope).toBe(item.scope);

      const result = await querySemanticRag(item.q, { topK: 8, sessionData: baseSession(item.parent) });
      const inherited = result.debug.semanticContract;
      expect(inherited.domain).toBe('double_degree');
      expect(inherited.contextReference.mode).toBe('inherited_current_scope_override');
      expect(inherited.constraints.programScope).toBe(item.scope);
      expect(result.source).toBe('semantic-rag-dual-degree-followup');
      expect(result.debug.routeStage).toBe('pre-followup-dual-degree-scope');
      expect(result.debug.contractVerification.reason).toBe('contract_preserved');
      expect(result.answer).toMatch(item.must);
      expect(result.answer).not.toMatch(item.mustNot);

      const verifier = await verifyOutboundSemanticRelevance(item.q, result.answer, result.source, {
        semanticContract: inherited,
        contexts: result.contexts || []
      });
      expect(verifier.ok).toBe(true);
    }
  });

  test('provider persistent session preserves Double Degree scope in both directions', async () => {
    const ctx = buildProviderApp();

    const chatA = 'contract-authority-dd-a-' + Date.now();
    const international = await askProvider(ctx, chatA, 'apakah ada program double degree internasional?');
    expect(international).toMatch(/Double Degree internasional|DNUI|HELP University/i);
    expect(international).not.toMatch(/UTB|Universitas Teknologi Bandung|DKV/i);
    const national = await askProvider(ctx, chatA, 'yang nasional ada tidak');
    expect(national).toMatch(/Double Degree nasional|UTB|Universitas Teknologi Bandung|DKV/i);
    expect(national).not.toMatch(/HELP University|DNUI|Bachelor of|belum menemukan data|tidak dapat merangkumnya/i);

    const chatB = 'contract-authority-dd-b-' + Date.now();
    const nationalFirst = await askProvider(ctx, chatB, 'apakah ada program double degree nasional?');
    expect(nationalFirst).toMatch(/Double Degree nasional|UTB|Universitas Teknologi Bandung|DKV/i);
    expect(nationalFirst).not.toMatch(/HELP University|DNUI|Bachelor of/i);
    const internationalAfterNational = await askProvider(ctx, chatB, 'yang luar negeri apa saja');
    expect(internationalAfterNational).toMatch(/Double Degree internasional|DNUI|HELP University/i);
    expect(internationalAfterNational).not.toMatch(/UTB|Universitas Teknologi Bandung|DKV|belum menemukan data|tidak dapat merangkumnya/i);
  });

});

