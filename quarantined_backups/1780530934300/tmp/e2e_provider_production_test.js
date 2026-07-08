const fs = require('fs');
const express = require('express');
const providerRouteFactory = require('../src/routes/provider');
const { query: ragQuery, extractStructuredEntities } = require('../src/engine/ragEngine');

process.env.FORCE_BUNDLED_INDEX = 'true';
process.env.ENABLE_RAG = 'true';
process.env.ENABLE_AI = 'true';
process.env.NODE_ENV = 'test';
process.env.PROVIDER_WEBHOOK_TOKEN = 'test-provider-token-12345';
process.env.BOT_REPLY_TIMEOUT_MS = '20000';
process.env.OPENAI_TIMEOUT_MS = '20000';
process.env.RAG_MIN_SCORE = '0.0';
process.env.RAG_STRICT_MODE = 'false';
process.env.OUTBOUND_DEBUG = 'false';
process.env.COMPOSER_DEBUG = 'false';
process.env.RAG_DEBUG_LOGS = 'false';
process.env.RAG_DEBUG_CHUNK_SCORING = 'false';
process.env.RAG_DEBUG_INTENT_FILTERING = 'false';

const app = express();
app.use(express.json());

const sentMessages = {};
const fakeProvider = {
  sendMessage(chatId, text) {
    if (!sentMessages[chatId]) sentMessages[chatId] = [];
    sentMessages[chatId].push({ type: 'text', text: String(text || '').trim(), ts: new Date().toISOString() });
    return Promise.resolve();
  },
  sendImage(chatId, url, caption) {
    if (!sentMessages[chatId]) sentMessages[chatId] = [];
    sentMessages[chatId].push({ type: 'image', text: String(caption || '').trim(), url, ts: new Date().toISOString() });
    return Promise.resolve();
  }
};

app.use('/provider', providerRouteFactory(fakeProvider));

const server = app.listen(0);
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;

function normalizeValue(value) {
  if (value === undefined) return null;
  if (value === null) return null;
  return value;
}

function computeMatchedAttributes(itemEntities, queryEntities) {
  if (!itemEntities || !queryEntities) return [];
  const keys = [
    'program',
    'wave',
    'partner',
    'campus',
    'programMode',
    'feeType',
    'academicYear',
    'jalur'
  ];
  const matched = [];
  for (const key of keys) {
    if (!itemEntities[key] || !queryEntities[key]) continue;
    if (String(itemEntities[key]).toLowerCase() === String(queryEntities[key]).toLowerCase()) {
      matched.push(key);
    }
  }
  return matched;
}

async function sendProviderRequest(chatId, text) {
  const payload = {
    chatId,
    text,
    ts: Date.now()
  };
  const response = await fetch(`${baseUrl}/provider/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test-provider-token-12345',
      'x-webhook-token': 'test-provider-token-12345'
    },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => null);
  const sent = (sentMessages[chatId] || []).slice();
  const lastText = sent.length ? sent[sent.length - 1].text : null;
  return { status: response.status, body, sent, lastText };
}

async function getRagDetails(question) {
  const ragResult = await ragQuery(question, 8, { strict: false });
  const queryEntities = extractStructuredEntities(question);
  const topChunks = Array.isArray(ragResult.contexts) ? ragResult.contexts.slice(0, 5).map(context => {
    const itemEntities = context.scoreComponents?.itemEntities || context.itemEntities || null;
    const rawScore = context.scoreComponents?.rawScore ?? context.compositeScore ?? null;
    const finalScore = context.scoreComponents?.finalScore ?? null;
    return {
      id: normalizeValue(context.id),
      filename: normalizeValue(context.filename || context.trainingId),
      rawScore: normalizeValue(rawScore),
      finalScore: normalizeValue(finalScore),
      matchedAttributes: computeMatchedAttributes(itemEntities, queryEntities),
      chunkEntities: itemEntities || null,
      excerpt: String(context.chunk || '').slice(0, 220).replace(/\s+/g, ' ').trim()
    };
  }) : [];

  return {
    source: ragResult && ragResult.source ? ragResult.source : null,
    confidenceScore: normalizeValue(ragResult && ragResult.confidenceScore != null ? ragResult.confidenceScore : (ragResult && ragResult.score != null ? ragResult.score : null)),
    contexts: topChunks,
    rawAnswerPreview: ragResult && ragResult.answer ? String(ragResult.answer).slice(0, 280) : null,
    ragResult
  };
}

const queryResults = [];

async function runQueries() {
  const queries = [
    'Apa itu Teknologi Informasi?',
    'Apa itu Sistem Informasi?',
    'Prospek kerja Teknologi Informasi',
    'Prospek kerja Sistem Informasi',
    'Biaya kuliah Sistem Informasi',
    'Biaya pendaftaran Sistem Informasi',
    'Double Degree Internasional',
    'Double Degree Nasional'
  ];

  for (let i = 0; i < queries.length; i += 1) {
    const chatId = `e2e-query-${i + 1}-${Date.now()}`;
    const question = queries[i];
    const ragDetails = await getRagDetails(question);
    const result = await sendProviderRequest(chatId, question);
    const finalText = result.sent.map(m => m.text).join('\n\n').trim();

    queryResults.push({
      question,
      status: result.status,
      responseBody: result.body,
      source: ragDetails.source || null,
      confidenceScore: ragDetails.confidenceScore,
      topChunks: ragDetails.contexts,
      finalText: result.lastText || null
    });
  }
}

const scenarioResults = [];

async function runScenarios() {
  const scenarios = [
    {
      name: 'Skenario 1',
      chatId: `e2e-s1-${Date.now()}`,
      messages: ['Apa itu Teknologi Informasi?', 'Bagaimana prospek kerjanya?']
    },
    {
      name: 'Skenario 2',
      chatId: `e2e-s2-${Date.now()}`,
      messages: ['Biaya kuliah Sistem Informasi', 'Apakah ada cicilan?']
    },
    {
      name: 'Skenario 3',
      chatId: `e2e-s3-${Date.now()}`,
      messages: ['Double Degree Nasional', 'Kampus partnernya apa saja?']
    }
  ];

  for (const scenario of scenarios) {
    const scenarioRecord = { name: scenario.name, messages: [] };
    let previousContext = null;
    for (let idx = 0; idx < scenario.messages.length; idx += 1) {
      const question = scenario.messages[idx];
      const ragDetails = await getRagDetails(question);
      const result = await sendProviderRequest(scenario.chatId, question);
      const finalText = result.sent.map(m => m.text).join('\n\n').trim();

      scenarioRecord.messages.push({
        question,
        previousContext: previousContext || null,
        responseBody: result.body,
        source: ragDetails.source || null,
        confidenceScore: ragDetails.confidenceScore,
        topChunks: ragDetails.contexts,
        finalText: result.lastText || null
      });

      previousContext = { chatId: scenario.chatId, lastQuestion: question };
    }
    scenarioResults.push(scenarioRecord);
  }
}

(async () => {
  try {
    console.log('Starting E2E provider production-like test...');
    await runQueries();
    await runScenarios();
    const output = { queries: queryResults, scenarios: scenarioResults };
    fs.writeFileSync('tmp/e2e_provider_structured_results.json', JSON.stringify(output, null, 2), 'utf8');
    console.log('RESULTS_WRITTEN tmp/e2e_provider_structured_results.json');
  } catch (err) {
    console.error('ERROR', err);
  } finally {
    await new Promise(resolve => server.close(() => resolve()));
  }
})();
