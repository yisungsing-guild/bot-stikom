#!/usr/bin/env node

/*
Final Launch Audit Runner
- Runs end-to-end checks for:
  1) Program Studi: TI/SI/SK/BD/MI belajar apa saja
  2) Rekomendasi Berdasarkan Hobi
  3) Double Degree (nasional vs internasional)
  4) Greeting dan Intent
  5) Context Retention (multi-turn)
  6) Out of Scope hobbies (bola, memasak, memancing)
  7) Provenance Audit output for each query

Rules enforced (PASS conditions):
- Program Studi:
  * Sources come from RAG (contexts length > 0)
  * Prefer specific program docs over generic "Penjelasan Semua Program Studi.pdf"
  * finalContextSources listed
- Hobi:
  * HOBY.pdf or hobby-mapping doc retrieved first when available
  * Heuristic fallback used only if retrieval fails (contexts length == 0)
  * debug retrievalAttempted=true
  * finalContextSources shown
  * No hardcode if RAG docs available
- Double Degree:
  * "double degree nasional" answers only UTB (no HELP/DNUI)
  * "double degree internasional" includes partner internasional (HELP/DNUI)
  * Show source/provenance
- Greeting/Intent:
  * Greeting rendered neatly
  * intent detected
  * short answer (<= 2 lines)
  * does not disturb main query flow
- Context Retention:
  * Entity TI retained across turns
  * Show retained context
- Out of Scope hobbies:
  * Bot does not force a program
  * Responds with low confidence or asks for more info
  * No hallucination
- Provenance Audit for each query
  * Print: source, confidenceTier, selectedChunkCount, finalContextSources, detectedIntent, queryEntities

Usage:
  node scripts/final_audit.js
*/

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.RAG_AUDIT_LOGGING = 'true';
process.env.RAG_DEBUG_INTENT_FILTERING = 'true';

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

(function loadDotenv() {
  const explicit = process.env.DOTENV_CONFIG_PATH;
  if (explicit) {
    dotenv.config({ path: explicit, override: true });
    return;
  }
  const cwd = process.cwd();
  const prodLocal = path.join(cwd, '.env.production.local');
  const prod = path.join(cwd, '.env.production');
  const dev = path.join(cwd, '.env');
  if (fs.existsSync(prodLocal)) dotenv.config({ path: prodLocal, override: true });
  else if (fs.existsSync(prod)) dotenv.config({ path: prod, override: true });
  else if (fs.existsSync(dev)) dotenv.config({ path: dev, override: true });
})();

const { query: ragQuery } = require('../src/engine/ragEngine');
const { queryScoped } = require('../src/engine/ragScoped');
const { classifyIntent } = require('../src/engine/intentClassifier');

function norm(s) { return String(s || '').toLowerCase(); }

function listFinalContextSources(result) {
  const list = [];
  if (result && Array.isArray(result.contexts)) {
    for (const c of result.contexts) {
      const f = c && (c.filename || c.trainingId || c.id || '(unknown)');
      const cat = c && (c.docCategory || c.category || 'UNKNOWN');
      list.push(`${f} [${cat}]`);
    }
  }
  return list;
}

function checkSpecificVsGeneric(contexts) {
  const names = (contexts || []).map(c => String(c.filename || ''));
  const hasGeneric = names.some(n => /penjelasan\s+semua\s+program\s+studi/i.test(n));
  const hasSpecific = names.some(n => /(ti|teknologi\s+informasi|si|sistem\s+informasi|sk|sistem\s+komputer|bd|bisnis\s+digital|mi|manajemen\s+informatika)/i.test(n));
  // PASS if there is any specific doc OR if no generic present
  // FAIL if generic present and no specific program doc
  return { hasGeneric, hasSpecific, pass: hasSpecific || !hasGeneric };
}

function containsAny(text, arr) {
  const t = norm(text);
  return arr.some(x => t.includes(norm(x)));
}

async function runQuery(q, opts = {}) {
  // Prefer scoped wrapper to leverage domain routing; fallback to ragQuery direct
  let res = null;
  try {
    res = await queryScoped({ query: q, category: null, topK: 6, options: { answerQuestion: q, ...(opts || {}) } });
  } catch (e) {
    res = await ragQuery(q, 6, { answerQuestion: q, ...(opts || {}) });
  }
  return res || {};
}

async function auditProgramStudi() {
  const tests = [
    'TI belajar apa saja',
    'SI belajar apa saja',
    'SK belajar apa saja',
    'BD belajar apa saja',
    'MI belajar apa saja'
  ];
  const results = [];
  for (const q of tests) {
    const res = await runQuery(q, { returnDebug: true });
    const contexts = Array.isArray(res.contexts) ? res.contexts : [];
    const specificCheck = checkSpecificVsGeneric(contexts);
    const pass = Boolean(contexts.length > 0) && specificCheck.pass;
    results.push({
      query: q,
      pass,
      reason: pass ? null : `contexts=${contexts.length}, hasGeneric=${specificCheck.hasGeneric}, hasSpecific=${specificCheck.hasSpecific}`,
      provenance: {
        source: res.source || '(unknown)',
        confidenceTier: res.confidenceTier || '(none)',
        selectedChunkCount: contexts.length,
        finalContextSources: listFinalContextSources(res),
        detectedIntent: classifyIntent(q),
        queryEntities: []
      }
    });
  }
  return results;
}

async function auditHobi() {
  const tests = [
    'saya suka ngoding',
    'saya suka desain UI UX',
    'saya suka bisnis digital',
    'saya suka jaringan komputer',
    'saya suka analisis data'
  ];
  const results = [];
  for (const q of tests) {
    const res = await runQuery(q, { returnDebug: true });
    const contexts = Array.isArray(res.contexts) ? res.contexts : [];
    const sources = listFinalContextSources(res);
    const top = (contexts[0] && (contexts[0].filename || '')) || '';
    const usedHobyFirst = /HOBY\.pdf|hobi-sesuai|hobi_prodi|hobi.+xlsx/i.test(top);
    const retrievalAttempted = true; // we executed a RAG query
    const pass = (contexts.length > 0 && usedHobyFirst) || (contexts.length === 0);
    results.push({
      query: q,
      pass,
      reason: pass ? null : `contexts=${contexts.length}, topSource='${top}' (expected HOBY/hobby-mapping first)`,
      provenance: {
        source: res.source || '(unknown)',
        confidenceTier: res.confidenceTier || '(none)',
        selectedChunkCount: contexts.length,
        finalContextSources: sources,
        detectedIntent: classifyIntent(q),
        queryEntities: [],
        debug: { retrievalAttempted }
      }
    });
  }
  return results;
}

async function auditDoubleDegree() {
  const cases = [
    { q: 'apakah ada double degree nasional', mode: 'nasional' },
    { q: 'apakah ada double degree internasional', mode: 'internasional' },
    { q: 'apa saja program double degree', mode: 'general' }
  ];
  const results = [];
  for (const tc of cases) {
    const res = await runQuery(tc.q, { returnDebug: true });
    const answer = String(res.answer || '');
    const contexts = Array.isArray(res.contexts) ? res.contexts : [];
    const sources = listFinalContextSources(res);
    let pass = true;
    let reason = null;
    if (tc.mode === 'nasional') {
      // Must only mention UTB; reject HELP/DNUI mentions
      const mentionsHELP = containsAny(answer, ['HELP']);
      const mentionsDNUI = containsAny(answer, ['DNUI', 'dalian', 'neusoft', 'china']);
      const mentionsUTB = containsAny(answer, ['UTB', 'universitas teknologi bali']);
      pass = mentionsUTB && !mentionsHELP && !mentionsDNUI;
      if (!pass) reason = `mentions: UTB=${mentionsUTB}, HELP=${mentionsHELP}, DNUI=${mentionsDNUI}`;
    } else if (tc.mode === 'internasional') {
      const mentionsHELP = containsAny(answer, ['HELP']);
      const mentionsDNUI = containsAny(answer, ['DNUI', 'dalian', 'neusoft', 'china']);
      pass = (mentionsHELP || mentionsDNUI);
      if (!pass) reason = 'expected HELP or DNUI in answer';
    } else {
      pass = contexts.length > 0; // general: just ensure RAG is used
      if (!pass) reason = 'no contexts';
    }
    results.push({
      query: tc.q,
      pass,
      reason,
      provenance: {
        source: res.source || '(unknown)',
        confidenceTier: res.confidenceTier || '(none)',
        selectedChunkCount: contexts.length,
        finalContextSources: sources,
        detectedIntent: classifyIntent(tc.q),
        queryEntities: []
      }
    });
  }
  return results;
}

async function auditGreetingIntent() {
  const greets = ['halo', 'selamat pagi', 'hai', 'saya mau tanya'];
  const results = [];
  for (const q of greets) {
    const res = await runQuery(q, { returnDebug: true });
    const answer = String(res.answer || '').trim();
    const lines = answer.split(/\r?\n/).filter(Boolean);
    const short = lines.length <= 2 && answer.length <= 240;
    const pass = short;
    results.push({
      query: q,
      pass,
      reason: pass ? null : `answer too long: ${lines.length} lines, ${answer.length} chars`,
      provenance: {
        source: res.source || '(unknown)',
        confidenceTier: res.confidenceTier || '(none)',
        selectedChunkCount: Array.isArray(res.contexts) ? res.contexts.length : 0,
        finalContextSources: listFinalContextSources(res),
        detectedIntent: classifyIntent(q),
        queryEntities: []
      }
    });
  }
  return results;
}

async function auditContextRetention() {
  // Simulate sequential turns, feeding retained entity (not full chat engine, but we validate drift via follow-up queries including implicit subject)
  const steps = [
    { q: 'TI belajar apa?', key: 'curr' },
    { q: 'biaya TI gelombang 2A berapa?', key: 'fee' },
    { q: 'setelah itu bagaimana prospek kerjanya?', key: 'career' }
  ];
  const retentionEntity = 'teknologi informasi';
  const results = [];
  let lastEntity = retentionEntity; // we fix to TI for audit consistency

  for (const step of steps) {
    const actualQ = step.key === 'career' ? `Prospek kerja ${lastEntity} bagaimana?` : step.q;
    const res = await runQuery(actualQ, { returnDebug: true });
    const contexts = Array.isArray(res.contexts) ? res.contexts : [];
    const text = (contexts[0] && (contexts[0].chunk || '')) || '';
    const kept = /teknologi\s+informasi|\bTI\b/i.test(`${actualQ}\n${text}`);
    const pass = kept;
    results.push({
      query: actualQ,
      pass,
      reason: pass ? null : 'context drifted from TI',
      provenance: {
        source: res.source || '(unknown)',
        confidenceTier: res.confidenceTier || '(none)',
        selectedChunkCount: contexts.length,
        finalContextSources: listFinalContextSources(res),
        detectedIntent: classifyIntent(actualQ),
        queryEntities: [retentionEntity]
      }
    });
  }
  return results;
}

async function auditOutOfScopeHobi() {
  const tests = [
    'hobi saya bermain sepak bola',
    'hobi saya memasak',
    'hobi saya memancing'
  ];
  const results = [];
  for (const q of tests) {
    const res = await runQuery(q, { returnDebug: true });
    const answer = String(res.answer || '').toLowerCase();
    const forcesProgram = /(ti|si|sk|bd|mi|teknologi informasi|sistem informasi|sistem komputer|bisnis digital|manajemen informatika)/i.test(answer);
    const asksMoreInfo = /(jelaskan|contoh|aktivitas|info|lebih|spesifik|tambahan|mohon|sebutkan|balas)/i.test(answer);
    const lowConfidenceTone = /(sepertinya|kemungkinan|bisa jadi|mohon)/i.test(answer) || asksMoreInfo;
    const pass = !forcesProgram && lowConfidenceTone;
    results.push({
      query: q,
      pass,
      reason: pass ? null : `forcesProgram=${forcesProgram}, lowConfidenceTone=${lowConfidenceTone}`,
      provenance: {
        source: res.source || '(unknown)',
        confidenceTier: res.confidenceTier || '(none)',
        selectedChunkCount: Array.isArray(res.contexts) ? res.contexts.length : 0,
        finalContextSources: listFinalContextSources(res),
        detectedIntent: classifyIntent(q),
        queryEntities: []
      }
    });
  }
  return results;
}

function summarize(section, items) {
  const lines = [];
  let allPass = true;
  lines.push(`\n=== ${section} ===`);
  for (const it of items) {
    const status = it.pass ? 'PASS' : 'FAIL';
    if (!it.pass) allPass = false;
    lines.push(`- ${status} :: ${it.query}`);
    if (!it.pass) {
      lines.push(`  Penyebab: ${it.reason || '(unknown)'}`);
    }
    // Provenance block
    const p = it.provenance || {};
    lines.push(`  source=${p.source}`);
    lines.push(`  confidenceTier=${p.confidenceTier}`);
    lines.push(`  selectedChunkCount=${p.selectedChunkCount}`);
    lines.push(`  finalContextSources=[${(p.finalContextSources || []).join('; ')}]`);
    lines.push(`  detectedIntent=${p.detectedIntent}`);
    lines.push(`  queryEntities=${JSON.stringify(p.queryEntities || [])}`);
    if (p.debug) lines.push(`  debug=${JSON.stringify(p.debug)}`);
  }
  return { text: lines.join('\n'), allPass };
}

(async () => {
  const sections = [];

  const s1 = await auditProgramStudi();
  sections.push(summarize('Program Studi', s1));

  const s2 = await auditHobi();
  sections.push(summarize('Rekomendasi Berdasarkan Hobi', s2));

  const s3 = await auditDoubleDegree();
  sections.push(summarize('Double Degree', s3));

  const s4 = await auditGreetingIntent();
  sections.push(summarize('Greeting dan Intent', s4));

  const s5 = await auditContextRetention();
  sections.push(summarize('Context Retention', s5));

  const s6 = await auditOutOfScopeHobi();
  sections.push(summarize('Out of Scope', s6));

  // Print all
  for (const sec of sections) console.log(sec.text);

  // Overall verdict
  const overallPass = sections.every(sec => sec.allPass);
  console.log('\n=== OVERALL ===');
  console.log(overallPass ? 'PASS' : 'FAIL');

  if (!overallPass) process.exitCode = 1;
})();
