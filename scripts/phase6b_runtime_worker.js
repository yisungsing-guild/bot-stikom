'use strict';

require('dotenv').config({ quiet: true });
process.env.PROVIDER_WEBHOOK_TOKEN = '';
process.env.PROVIDER_TOKEN = '';
process.env.FORCE_BUNDLED_INDEX = 'true';
process.env.RAG_TRACE_PERSIST = 'false';
process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
process.env.PERSISTENT_INBOUND_DEDUPE = 'false';
process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';
process.env.PROVIDER_DB_LOOKUP_TIMEOUT_MS = '15000';
process.env.AUTH_DB_LOOKUP_TIMEOUT_MS = '15000';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { monitorEventLoopDelay, performance } = require('perf_hooks');
const prisma = require('../src/db');
const providerRouterFactory = require('../src/routes/provider');
const { buildCanonicalQueryUnderstanding } = require('../src/engine/queryUnderstanding');
const { PHASE6_CONVERSATIONS } = require('./verify_phase6_generalization');

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const id = process.argv[2];
const conversation = PHASE6_CONVERSATIONS.find(item => item.convId === id);
if (!conversation) throw new Error('Unknown conversation: ' + id);

function request(port, payload) {
  return new Promise(resolve => {
    const body = JSON.stringify(payload);
    const req = http.request({ hostname: '127.0.0.1', port, path: '/provider/webhook', method: 'POST', headers: {
      'content-type': 'application/json', 'content-length': Buffer.byteLength(body)
    } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try { resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : {} }); }
        catch (_) { resolve({ status: res.statusCode, body: { raw } }); }
      });
    });
    req.on('error', error => resolve({ status: 500, body: { source: 'network_error', error: error.message } }));
    req.end(body);
  });
}

function pickResult(entries) {
  const results = entries.map(item => item && (item.result || item)).filter(Boolean);
  return results.find(item => item.answer) || results.at(-1) || null;
}

function extractTrace(turn, before, after, outbound, canonical, ragEntries, retrievalEntries, timing) {
  const meta = outbound && outbound.meta || {};
  const result = meta.result || pickResult(ragEntries) || {};
  const debug = result.debug || {};
  const contract = meta.semanticContract || result.semanticContract || debug.semanticContract || null;
  const afterState = after && after.data && after.data.conversationState || null;
  const technique = debug.techniquePipeline || {};
  const queryUnderstanding = technique.queryUnderstanding || debug.queryUnderstanding || {};
  const retrievalQuery = retrievalEntries.at(-1) && retrievalEntries.at(-1).retrievalQuery
    || debug.retrievalPlan && debug.retrievalPlan.query
    || technique.retrievalPlan && technique.retrievalPlan.query
    || (queryUnderstanding.searchQueries || []).join(' | ') || null;
  const contexts = Array.isArray(result.contexts) ? result.contexts : [];
  return {
    TURN_INPUT: turn.query,
    SESSION_BEFORE: clone(before),
    CANONICAL_UNDERSTANDING: clone(canonical),
    ACTIVE_DOMAIN: afterState && afterState.activeDomain || contract && contract.domain || null,
    ACTIVE_INTENT: afterState && afterState.activeIntent || contract && contract.intent || null,
    ACTIVE_ENTITY: clone(afterState && afterState.activeEntity || null),
    ACTIVE_RELATION: clone(afterState && afterState.activeRelation || null),
    REQUESTED_FIELDS: clone(afterState && afterState.requestedFields || contract && contract.requestedFields || []),
    EFFECTIVE_QUERY: debug.entitySubstitution && debug.entitySubstitution.effectiveQuery
      || debug.relationalFollowup && debug.relationalFollowup.effectiveQuery
      || debug.contextRepair && debug.contextRepair.effectiveQuery
      || contract && contract.raw || turn.query,
    RETRIEVAL_QUERY: retrievalQuery,
    CANDIDATE_EVIDENCE: clone(technique.retrieval || retrievalEntries || []),
    SELECTED_EVIDENCE: clone(contexts),
    ANSWERABILITY_DECISION: clone(debug.answerabilityResult || technique.evidenceProcessing && technique.evidenceProcessing.answerability || null),
    FINAL_OWNER: meta.sourceType || (/^semantic-rag-/i.test(String(meta.source || result.source || '')) ? 'rag' : 'unknown'),
    FINAL_SOURCE: meta.source || result.source || null,
    FINAL_OUTPUT: outbound && outbound.text || result.answer || null,
    SESSION_AFTER: clone(after),
    SEMANTIC_CONTRACT: clone(contract),
    DEBUG: clone(debug),
    TIMING: timing
  };
}

async function main() {
  global.__provider_rag_all = [];
  global.__provider_debug_retrievals = [];
  global.__provider_route_debug_events = [];
  const sent = [];
  const provider = {
    sendMessage: async function sendMessage(chatId, text, meta) { sent.push({ chatId: String(chatId), text: String(text || ''), meta: clone(meta || {}) }); },
    sendImage: async function sendImage() {}
  };
  const app = express();
  app.use(express.json());
  app.use('/provider', providerRouterFactory(provider));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const port = server.address().port;
  const chatId = 'phase6b-' + id.toLowerCase() + '-' + process.pid;
  const outputPrefix = String(process.argv[3] || process.env.PHASE_RUNTIME_OUTPUT_PREFIX || 'phase6b');
  const outPath = path.join(__dirname, '..', 'tmp', outputPrefix + '-' + id + '.jsonl');
  fs.writeFileSync(outPath, '');
  await prisma.session.upsert({ where: { chatId }, create: { chatId, state: 'root', data: { welcomeSent: true, introSent: true } }, update: { state: 'root', data: { welcomeSent: true, introSent: true } } });
  try {
    for (const turn of conversation.turns) {
      if (turn.injectStaleMinutes) {
        const existingSession = await prisma.session.findUnique({ where: { chatId } });
        if (existingSession && existingSession.data) {
          const staleTime = new Date(Date.now() - turn.injectStaleMinutes * 60 * 1000).toISOString();
          if (existingSession.data.conversationState) {
            existingSession.data.conversationState.updatedAt = staleTime;
          }
          existingSession.data.updatedAt = staleTime;
          await prisma.session.update({ where: { chatId }, data: { data: existingSession.data } });
        }
      }
      const before = await prisma.session.findUnique({ where: { chatId } });
      const c0 = performance.now();
      const canonical = buildCanonicalQueryUnderstanding(turn.query, { priorSession: before });
      const c1 = performance.now();
      const sentBefore = sent.length;
      const ragBefore = global.__provider_rag_all.length;
      const retrievalBefore = global.__provider_debug_retrievals.length;
      const delay = monitorEventLoopDelay({ resolution: 10 });
      delay.enable();
      const p0 = performance.now();
      const response = await request(port, { chatId, text: turn.query, messageId: chatId + '-' + turn.turnIndex, inboundTs: Date.now() });
      const p1 = performance.now();
      delay.disable();
      const after = await prisma.session.findUnique({ where: { chatId } });
      const outbound = sent.slice(sentBefore).filter(item => item.chatId === chatId).at(-1) || null;
      const ragEntries = global.__provider_rag_all.slice(ragBefore);
      const retrievalEntries = global.__provider_debug_retrievals.slice(retrievalBefore);
      const trace = extractTrace(turn, before, after, outbound, canonical, ragEntries, retrievalEntries, {
        CANONICAL_MS: +(c1 - c0).toFixed(3),
        CONTEXT_RESOLUTION_MS: null,
        RETRIEVAL_MS: null,
        EVIDENCE_SELECTION_MS: null,
        VERIFICATION_MS: null,
        PROVIDER_TOTAL_MS: +(p1 - p0).toFixed(3),
        EVENT_LOOP_DELAY: { meanMs: Number.isFinite(delay.mean) ? +(delay.mean / 1e6).toFixed(3) : null, maxMs: +(delay.max / 1e6).toFixed(3) },
        INTERNAL_STAGE_TIMING_AVAILABLE: false
      });
      const record = { conversationId: id, turnIndex: turn.turnIndex, expected: clone(turn), response, trace };
      fs.appendFileSync(outPath, JSON.stringify(record) + '\n');
      process.stdout.write(JSON.stringify({ turn: turn.turnIndex, source: trace.FINAL_SOURCE, providerMs: trace.TIMING.PROVIDER_TOTAL_MS }) + '\n');
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    await prisma.session.deleteMany({ where: { chatId } });
    await prisma.chat.deleteMany({ where: { chatId } }).catch(() => {});
    await prisma.$disconnect().catch(() => {});
  }
}

main().catch(async error => {
  console.error(error && error.stack || error);
  await prisma.$disconnect().catch(() => {});
  process.exit(2);
});

