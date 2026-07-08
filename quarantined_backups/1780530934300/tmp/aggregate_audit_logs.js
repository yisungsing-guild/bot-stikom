const fs = require('fs');
const path = require('path');
const { auditLogger } = require('../src/engine/ragAuditLogger');

const queries = [
  'Apa itu Sistem Informasi',
  'Apa yang dipelajari di Sistem Informasi',
  'Prospek kerja Sistem Informasi',
  'Apa itu Teknologi Informasi',
  'Apa yang dipelajari di Teknologi Informasi',
  'Prospek kerja Teknologi Informasi'
];

const logsDir = auditLogger.logsDir;
const decisionsFile = fs.existsSync(logsDir) ? fs.readdirSync(logsDir).filter(f => f.startsWith('filtering-decisions-')).sort().pop() : null;
const decisionsPath = decisionsFile ? path.join(logsDir, decisionsFile) : null;
let decisions = [];
if (decisionsPath && fs.existsSync(decisionsPath)) {
  const raw = fs.readFileSync(decisionsPath, 'utf8').trim();
  if (raw) {
    const lines = raw.split('\n');
    for (const l of lines) {
      try { decisions.push(JSON.parse(l)); } catch(e) { }
    }
  }
}

const out = [];
for (const q of queries) {
  const report = { query: q };
  const log = auditLogger.getQueryReport(q);
  if (!log) {
    report.auditLog = null;
    out.push(report);
    continue;
  }
  report.auditLog = {
    timestamp: log.timestamp,
    beforeCount: log.beforeFiltering.count,
    afterCount: log.afterFiltering.count,
    filtered: log.filteringStats.filtered
  };
  // build set of before chunk ids
  const beforeIds = new Set((log.beforeFiltering.chunks || []).map(c => c.chunkId));
  const reasonCounts = {};
  // filter decisions by time window around the query timestamp to avoid counting past runs
  const queryTime = new Date(log.timestamp).getTime();
  const windowMs = 30 * 1000; // 30 seconds window
  for (const d of decisions) {
    if (!d || !d.chunkId || !d.timestamp) continue;
    const dt = Date.parse(d.timestamp);
    if (Number.isNaN(dt)) continue;
    if (dt < queryTime - windowMs || dt > queryTime + windowMs) continue;
    if (beforeIds.has(d.chunkId)) {
      reasonCounts[d.reason] = (reasonCounts[d.reason] || 0) + 1;
    }
  }
  report.rejectReasonCountsFromLogs = reasonCounts;
  out.push(report);
}

fs.writeFileSync('tmp/audit_log_aggregate.json', JSON.stringify(out, null, 2), 'utf8');
console.log('Wrote tmp/audit_log_aggregate.json');
