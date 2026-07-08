#!/usr/bin/env node
// Simple audit runner: posts to provider webhook, snapshots sessions, and collects traces
// Usage: node scripts/audit_runner.js --chatId=6281234567890 [--baseUrl=http://127.0.0.1:4001] [--webhookPath=/fonnte/webhook] [--webhookToken=TOKEN]

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function parseArgs() {
  const args = {};
  for (const a of process.argv.slice(2)) {
    const m = /^--([^=]+)=?(.*)$/.exec(a);
    if (!m) continue;
    args[m[1]] = m[2] || true;
  }
  return args;
}

const args = parseArgs();
const CHAT_ID = args.chatId || args.chat || args.chatIdRaw;
if (!CHAT_ID) {
  console.error('Usage: node scripts/audit_runner.js --chatId=62812... [--baseUrl=http://127.0.0.1:4001] [--webhookPath=/fonnte/webhook] [--webhookToken=TOKEN]');
  process.exit(1);
}

const BASE_URL = args.baseUrl || `http://127.0.0.1:${process.env.PORT || '4001'}`;
const WEBHOOK_PATH = args.webhookPath || '/fonnte/webhook';
const WEBHOOK_TOKEN = args.webhookToken || '';
const DELAY_MS = parseInt(args.delay || '700', 10);
const TIMEOUT_MS = parseInt(args.timeout || '30000', 10);
const LOG_DIR = path.join(__dirname, '..', 'tmp');
const FINAL_LOG = path.join(LOG_DIR, 'final_wa_outputs.log');
const TRACE_LOG = path.join(LOG_DIR, 'provider_traces.log');

async function postToWebhook(text) {
  const url = BASE_URL.replace(/\/$/, '') + WEBHOOK_PATH;
  const body = { sender: CHAT_ID, message: text, messageId: `audit-${Date.now()}` };
  const headers = {};
  if (WEBHOOK_TOKEN) headers['x-webhook-token'] = WEBHOOK_TOKEN;
  return axios.post(url, body, { headers, timeout: 30000 }).catch(e => ({ error: e.message || String(e) }));
}

function readFinalLog() {
  try {
    if (!fs.existsSync(FINAL_LOG)) return '';
    return fs.readFileSync(FINAL_LOG, 'utf8');
  } catch (e) { return ''; }
}

function readTraceLog() {
  try {
    if (!fs.existsSync(TRACE_LOG)) return '';
    return fs.readFileSync(TRACE_LOG, 'utf8');
  } catch (e) { return ''; }
}

function findLatestFinalMessageForChat(chatId, sinceMs = 0) {
  const content = readFinalLog();
  if (!content) return null;
  const regex = /=== FINAL WA MESSAGE ===\s+([^\s]+)\s+([^\r\n]+)\n([\s\S]*?)(?=\n\n|$)/g;
  let m;
  let last = null;
  while ((m = regex.exec(content)) !== null) {
    const tsRaw = m[1];
    const cid = m[2].trim();
    const msg = m[3].trim();
    const tms = isNaN(Date.parse(tsRaw)) ? 0 : Date.parse(tsRaw);
    if (cid === chatId && tms >= sinceMs) {
      if (!last || tms > last.ts) last = { ts: tms, chatId: cid, message: msg };
    }
  }
  return last;
}

function collectTracesSince(sinceMs, chatId) {
  const content = readTraceLog();
  if (!content) return { lines: [] };
  const lines = content.split(/\r?\n/).filter(Boolean);
  const objects = [];
  for (const l of lines) {
    try {
      const obj = JSON.parse(l);
      const t = obj.ts ? Date.parse(obj.ts) : 0;
      if (t >= sinceMs) objects.push(obj);
    } catch (e) {
      // fallback: raw lines
      objects.push({ raw: l });
    }
  }
  return { lines: objects };
}

async function snapshotSession(chatId) {
  try {
    const s = await prisma.session.findUnique({ where: { chatId } });
    return s || null;
  } catch (e) {
    return null;
  }
}

// Define program list for scenarios
const PRODI = [
  'Teknologi Informasi',
  'Sistem Informasi',
  'Sistem Komputer',
  'Bisnis Digital',
  'Manajemen Informatika'
];

// Build scenarios A..H as arrays of turns
const scenarios = [];

// Scenario A - MENU PMB
scenarios.push({ id: 'A', name: 'Menu PMB', turns: ['Halo', 'Saya ingin tahu informasi PMB'] });

// Scenario B - DEFINISI PRODI
scenarios.push({ id: 'B', name: 'Definisi Prodi', turns: PRODI.map(p => `Apa itu ${p}?`) });

// Scenario C - DEFINISI + PROSPEK
scenarios.push({ id: 'C', name: 'Definisi+Prospek', turns: PRODI.map(p => `Apa itu ${p} dan prospek kerjanya?`) });

// Scenario D - BIAYA PRODI (gelombang 1..4)
const waves = [1,2,3,4];
const dTurns = [];
for (const p of PRODI) for (const w of waves) dTurns.push(`Berapa biaya ${p} gelombang ${w}?`);
scenarios.push({ id: 'D', name: 'Biaya Prodi', turns: dTurns });

// Scenario E - RINCIAN BIAYA
const eTurns = [];
for (const p of PRODI) for (const w of waves) eTurns.push(`Berapa rincian biaya ${p} gelombang ${w}?`);
scenarios.push({ id: 'E', name: 'Rincian Biaya', turns: eTurns });

// Scenario F - CONTEXT SWITCHING (structured)
const fTurns = [];
function pushSeq(seq) { for (const t of seq) fTurns.push(t); }
pushSeq(['Apa itu Teknologi Informasi?', 'Berapa biayanya?', 'Rinciannya?', 'Prospek kerjanya?']);
pushSeq(['Bagaimana kalau Sistem Informasi?', 'Berapa biayanya?', 'Rinciannya?', 'Prospek kerjanya?']);
pushSeq(['Bagaimana kalau Bisnis Digital?', 'Berapa biaya gelombang 2?', 'Rinciannya?', 'Prospek kerjanya?']);
pushSeq(['Bagaimana kalau Sistem Komputer?', 'Berapa biayanya?', 'Rinciannya?']);
pushSeq(['Bagaimana kalau Manajemen Informatika?', 'Berapa biayanya?', 'Rinciannya?']);
scenarios.push({ id: 'F', name: 'Context Switching', turns: fTurns });

// Scenario G - RANDOM USER jumpy
const gTurns = [
  'Apa itu TI?', 'Berapa biayanya?', 'Bagaimana kalau SI?', 'Prospek kerjanya?',
  'Kalau gelombang 2 berapa?', 'Rinciannya?', 'Kalau Bisnis Digital?', 'Berapa biaya gelombang 3?', 'Apa prospek kerjanya?', 'Kalau Sistem Komputer?', 'Apa itu?', 'Berapa biayanya?'
];
scenarios.push({ id: 'G', name: 'Random Jumping', turns: gTurns });

// Scenario H - AMBIGUOUS
scenarios.push({ id: 'H', name: 'Ambiguous Questions', turns: ['Berapa biayanya?', 'Rinciannya?', 'Prospek kerjanya?', 'Apa itu?'] });

async function run() {
  const results = [];
  for (const sc of scenarios) {
    console.log('\n=== Running scenario', sc.id, sc.name, 'turns=', sc.turns.length, '===');
    for (const turnText of sc.turns) {
      // Snapshot before
      const before = await snapshotSession(CHAT_ID);
      const sinceMs = Date.now();

      console.log('\n-> Sending inbound:', turnText);
      await postToWebhook(turnText);

      // Wait a bit for server to process
      const final = await (async () => {
        const start = Date.now();
        while (Date.now() - start < TIMEOUT_MS) {
          const f = findLatestFinalMessageForChat(CHAT_ID, sinceMs);
          if (f) return f;
          await new Promise(r => setTimeout(r, 500));
        }
        return null;
      })();

      // Collect traces
      const traces = collectTracesSince(sinceMs, CHAT_ID);

      // Snapshot after
      const after = await snapshotSession(CHAT_ID);

      const row = {
        scenario: sc.id,
        question: turnText,
        sessionBefore: before,
        sessionAfter: after,
        finalMessage: final ? final.message : null,
        traceSegments: traces.lines
      };

      results.push(row);

      console.log('Result:', { question: turnText, final: final ? final.message.slice(0,200) : null, traces: traces.lines.length });

      // Small delay to avoid racing
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  const outPath = path.join(LOG_DIR, `audit_results_${Date.now()}.json`);
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8'); } catch (e) { console.error('Failed to write results:', e.message); }
  console.log('\nAudit complete. Results saved to', outPath);
  await prisma.$disconnect();
}

run().catch(async (err) => { console.error('Audit runner error', err && err.message ? err.message : err); try { await prisma.$disconnect(); } catch (e) {} process.exit(2); });
