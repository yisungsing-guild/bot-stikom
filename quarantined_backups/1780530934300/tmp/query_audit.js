const fs = require('fs');
const path = require('path');
const { query } = require('../src/engine/ragEngine');

const AUDIT_DIR = path.join(__dirname, '..', 'rag-audit-logs');
const today = new Date().toISOString().split('T')[0];
const queryLogPath = path.join(AUDIT_DIR, `query-retrieval-${today}.jsonl`);
const filteringLogPath = path.join(AUDIT_DIR, `filtering-decisions-${today}.log`);

function clearOldLogs() {
  try {
    if (fs.existsSync(queryLogPath)) fs.unlinkSync(queryLogPath);
  } catch (e) {}
  try {
    if (fs.existsSync(filteringLogPath)) fs.unlinkSync(filteringLogPath);
  } catch (e) {}
}

function parseQueryLogs() {
  if (!fs.existsSync(queryLogPath)) return [];
  return fs.readFileSync(queryLogPath, 'utf8').trim().split('\n').filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch (e) { return null; }
  }).filter(Boolean);
}

function parseFilteringDecisions() {
  if (!fs.existsSync(filteringLogPath)) return [];
  return fs.readFileSync(filteringLogPath, 'utf8').trim().split('\n').filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch (e) { return null; }
  }).filter(Boolean);
}

async function runAudit() {
  process.env.RAG_AUDIT_LOGGING = 'true';
  process.env.RAG_DEBUG_INTENT_FILTERING = 'true';
  process.env.RAG_DEBUG_CHUNK_SCORING = 'true';
  process.env.RAG_MIN_SCORE = '0.3';
  process.env.OPENAI_RAG_MODEL = process.env.OPENAI_RAG_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';

  clearOldLogs();

  const queries = [
    'Apa itu Sistem Informasi',
    'Sistem Informasi belajar apa saja',
    'Mata kuliah Sistem Informasi',
    'Prospek kerja Sistem Informasi',
    'Lulusan Sistem Informasi bisa kerja dimana',
    'Apa itu Teknologi Informasi',
    'Teknologi Informasi belajar apa saja',
    'Prospek kerja Teknologi Informasi'
  ];

  const results = [];
  for (const question of queries) {
    try {
      const res = await query(question, 8, { strict: false });
      results.push({ question, result: res });
    } catch (e) {
      results.push({ question, error: e.message || String(e) });
    }
  }

  const queryLogs = parseQueryLogs();
  const filterLogs = parseFilteringDecisions();

  const reports = queries.map((question) => {
    const log = queryLogs.reverse().find(entry => entry.question && entry.question.toLowerCase().includes(question.toLowerCase()));
    const decisions = filterLogs.filter(entry => entry.question && entry.question.toLowerCase().includes(question.toLowerCase()) || true);
    return {
      question,
      result: results.find(r => r.question === question),
      auditLog: log || null,
      filteringDecisions: decisions
    };
  });

  process.stdout.write(JSON.stringify({ reports, queryLogs, filterLogs }, null, 2));
}

runAudit().catch((e) => {
  console.error('AUDIT ERROR', e);
  process.exit(1);
});
