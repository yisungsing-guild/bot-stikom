const fs = require('fs');
const path = require('path');
const { PHASE6_CONVERSATIONS } = require('./verify_phase6_generalization');
const { evaluateTurn } = require('./phase6aEvaluator');
const { EVIDENCE_REGISTRY } = require('../tmp/blind_test_harness');
const prefix = process.argv[2];
if (!prefix) throw new Error('Usage: node scripts/evaluate_phase7_gate.js <trace-prefix>');
const baseline = require('../tmp/phase6b_runtime_report.json');
const byConversation = new Map(PHASE6_CONVERSATIONS.map(item => [item.convId, item]));
const traceCache = new Map();
function recordsFor(convId) {
  if (traceCache.has(convId)) return traceCache.get(convId);
  const file = path.join(__dirname, '..', 'tmp', `${prefix}-${convId}.jsonl`);
  if (!fs.existsSync(file)) return [];
  const records = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  traceCache.set(convId, records);
  return records;
}
function evaluatorTrace(runtime) {
  const before = runtime.SESSION_BEFORE && runtime.SESSION_BEFORE.data && runtime.SESSION_BEFORE.data.conversationState;
  const after = runtime.SESSION_AFTER && runtime.SESSION_AFTER.data && runtime.SESSION_AFTER.data.conversationState;
  return {
    CURRENT_CANONICAL: runtime.CANONICAL_UNDERSTANDING, EFFECTIVE_QUERY: runtime.EFFECTIVE_QUERY,
    ACTIVE_DOMAIN_BEFORE: before && before.activeDomain, ACTIVE_DOMAIN_AFTER: after && after.activeDomain,
    ACTIVE_INTENT_BEFORE: before && before.activeIntent, ACTIVE_INTENT_AFTER: after && after.activeIntent,
    ACTIVE_ENTITY_BEFORE: before && before.activeEntity, ACTIVE_ENTITY_AFTER: after && after.activeEntity,
    ACTIVE_RELATION_BEFORE: before && before.activeRelation, ACTIVE_RELATION_AFTER: after && after.activeRelation,
    REQUESTED_FIELDS_BEFORE: before && before.requestedFields || [], REQUESTED_FIELDS_AFTER: after && after.requestedFields || [],
    SELECTED_EVIDENCE: runtime.SELECTED_EVIDENCE || [],
    FINAL_OWNER: /^(?:semantic-rag-|rag-)/i.test(String(runtime.FINAL_SOURCE || '')) ? 'semantic' : 'unknown',
    FINAL_SOURCE: runtime.FINAL_SOURCE || '', FINAL_OUTPUT: runtime.FINAL_OUTPUT || '',
    FINAL_CONTRACT: runtime.SEMANTIC_CONTRACT || null, STATE_PERSISTED: Boolean(after && after.updatedAt)
  };
}
const summary = { prefix, measurementStatus: 'PROVISIONAL_REQUIRES_TRACE_ADJUDICATION', confirmedTotal: 0, confirmedPass: 0, confirmedFail: 0, trueGapTotal: 0, trueGapPass: 0, trueGapHallucination: 0, missingOrTimeout: 0, failures: [] };
for (const item of baseline.failures.filter(entry => entry.DISPOSITION !== 'HARNESS_ONLY_FAILURE')) {
  const match = item.TURN_ID.match(/^(P6_C\d+)-T(\d+)$/); const convId = match && match[1]; const turnIndex = Number(match && match[2]);
  const record = recordsFor(convId).find(entry => Number(entry.turnIndex) === turnIndex);
  if (!record) {
    summary.missingOrTimeout += 1;
    summary.failures.push({ TURN_ID: item.TURN_ID, DISPOSITION: item.DISPOSITION, FIRST_DIVERGENCE: 'UNADJUDICATED', BASELINE_ROOT_CAUSE: item.ROOT_CAUSE, reason: 'trace_missing_after_watchdog' });
    if (item.DISPOSITION === 'CONFIRMED_PRODUCTION_BUG') { summary.confirmedTotal += 1; summary.confirmedFail += 1; } else summary.trueGapTotal += 1;
    continue;
  }
  const runtime = record.trace;
  if (item.DISPOSITION === 'EXPECTED_NO_DATA') {
    summary.trueGapTotal += 1;
    const safeNoData = /(?:insufficient|no-training|no-data|unknown|unsupported|verifier-blocked|safe-fallback|clarify)/i.test(String(runtime.FINAL_SOURCE || '')) || /(?:belum menemukan|tidak tersedia|tidak akan menebak|konfirmasi ke admin)/i.test(String(runtime.FINAL_OUTPUT || ''));
    if (safeNoData) summary.trueGapPass += 1;
    else { summary.trueGapHallucination += 1; summary.failures.push({ TURN_ID: item.TURN_ID, DISPOSITION: item.DISPOSITION, FIRST_DIVERGENCE: 'NEGATIVE_CONTROL', source: runtime.FINAL_SOURCE, output: String(runtime.FINAL_OUTPUT || '').slice(0, 240) }); }
    continue;
  }
  summary.confirmedTotal += 1;
  const assessment = evaluateTurn({ turn: record.expected, conversation: byConversation.get(convId), trace: evaluatorTrace(runtime), evidenceRegistry: EVIDENCE_REGISTRY });
  if (assessment.pass) summary.confirmedPass += 1;
  else { summary.confirmedFail += 1; summary.failures.push({ TURN_ID: item.TURN_ID, DISPOSITION: item.DISPOSITION, FIRST_DIVERGENCE: 'UNADJUDICATED', BASELINE_ROOT_CAUSE: item.ROOT_CAUSE, failures: assessment.failures, actual: assessment.actual, source: runtime.FINAL_SOURCE, output: String(runtime.FINAL_OUTPUT || '').slice(0, 240) }); }
}
const out = path.join(__dirname, '..', 'tmp', `${prefix}-gate.json`);
fs.writeFileSync(out, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.confirmedFail || summary.trueGapHallucination || summary.missingOrTimeout ? 1 : 0);
