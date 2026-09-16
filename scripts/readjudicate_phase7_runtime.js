'use strict';
const fs = require('fs');
const path = require('path');
const { PHASE6_CONVERSATIONS } = require('./verify_phase6_generalization');
const { buildExpectedContract, norm } = require('./phase6aEvaluator');

const [, , baselinePrefix, runtimePrefix] = process.argv;
const valid = value => value && /^[a-z0-9._-]+$/i.test(value);
if (!valid(baselinePrefix) || !valid(runtimePrefix)) {
  throw new Error('Usage: node scripts/readjudicate_phase7_runtime.js <baseline-prefix> <runtime-prefix>');
}
const tmp = path.join(__dirname, '..', 'tmp');
const readGate = prefix => JSON.parse(fs.readFileSync(path.join(tmp, `${prefix}-gate.json`), 'utf8'));
const baseline = readGate(baselinePrefix);
const current = readGate(runtimePrefix);
const currentFailures = new Map(current.failures.map(item => [item.TURN_ID, item]));
const specs = new Map();
for (const conversation of PHASE6_CONVERSATIONS) {
  for (const turn of conversation.turns) {
    specs.set(`${conversation.convId}-T${turn.turnIndex}`, { conversation, turn });
  }
}

const cache = new Map();
function traceFor(turnId) {
  const [, conversationId, index] = /^(.*)-T(\d+)$/.exec(turnId);
  if (!cache.has(conversationId)) {
    const file = path.join(tmp, `${runtimePrefix}-${conversationId}.jsonl`);
    if (!fs.existsSync(file)) return null;
    cache.set(conversationId, fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).map(JSON.parse));
  }
  const found = cache.get(conversationId).find(row => Number(row.turnIndex) === Number(index));
  return found ? found.trace : null;
}

function entityMatch(expected, canonical) {
  if (!expected.entityTokens.length || expected.entity === 'STIKOM') return true;
  const entities = Object.values(canonical.entities || {}).flat();
  const haystack = norm(entities.map(item => item.canonical || item.value || item.raw || item).join(' '));
  return expected.entityTokens.every(token => haystack.includes(norm(token)));
}

function fieldsMatch(expected, canonical) {
  const fields = new Set((canonical.requestedFields || []).map(norm));
  return expected.requestedFieldGroups.every(group => group.some(field => fields.has(norm(field))));
}

function classify(gateFailure, expected, trace) {
  const failures = new Set(gateFailure.failures);
  const canonical = trace.CANONICAL_UNDERSTANDING || {};
  const domain = canonical.domain && canonical.domain.primary;
  const intent = canonical.intent && canonical.intent.primary;
  const domainOk = expected.domains.includes(domain);
  const intentOk = expected.intents.includes(intent);
  const before = trace.SESSION_BEFORE?.data?.conversationState;
  if (/timeout/i.test(trace.FINAL_SOURCE || '')) return ['PERFORMANCE', 'watchdog/timeout'];
  if (failures.has('CORRECT_DOMAIN') || failures.has('CORRECT_INTENT')) {
    if (domain && domain !== 'general' && (!domainOk || !intentOk)) {
      return ['CANONICAL_CLASSIFICATION', 'explicit current classification mismatches expected contract'];
    }
    if (domainOk && !intentOk && before?.activeIntent) {
      return ['INTENT_INHERITANCE', 'compatible prior intent not resolved'];
    }
    return ['CONTEXT_AUTHORITY', 'elliptical or resolved context does not preserve authority'];
  }
  if (failures.has('CORRECT_ENTITY')) {
    return entityMatch(expected, canonical)
      ? ['CONTEXT_AUTHORITY', 'canonical entity lost/replaced in effective contract']
      : ['ENTITY_RESOLUTION', 'expected entity absent from canonical understanding'];
  }
  if (failures.has('CORRECT_RELATION') || failures.has('CORRECT_REQUESTED_FIELDS')) {
    return fieldsMatch(expected, canonical)
      ? ['RELATION_RESOLUTION', 'canonical fields exist but effective relation diverges']
      : ['REQUESTED_FIELD_BINDING', 'relation-specific fields absent from canonical contract'];
  }
  if (failures.has('COMPATIBLE_EVIDENCE')) {
    if (!trace.RETRIEVAL_QUERY || !(trace.CANDIDATE_EVIDENCE || []).length) {
      return ['RETRIEVAL_PLANNING', 'no retrieval plan/candidates for expected evidence family'];
    }
    if (!(trace.SELECTED_EVIDENCE || []).length) return ['EVIDENCE_RECALL', 'candidates exist but none selected'];
    return ['EVIDENCE_ENTITY_COMPATIBILITY', 'selected evidence is contract-incompatible'];
  }
  if (failures.has('FALSE_NO_DATA')) return ['ANSWERABILITY', 'compatible evidence rejected as no-data'];
  if (failures.has('GROUNDED_FINAL_OUTPUT')) {
    return /verifier|preflight|sanitized/i.test(trace.FINAL_SOURCE || '')
      ? ['VERIFIER', 'verifier altered/rejected grounded output']
      : ['COMPOSER', 'required grounded answer content absent'];
  }
  if (failures.has('STATE_CONTRACT_ALIGNED') || failures.has('STATE_PERSISTED')) {
    return ['STATE_PERSISTENCE', 'persisted state differs from final contract'];
  }
  return ['COMPOSER', 'final answer shape/content failure'];
}

const recovered = [];
const failures = [];
for (const oldFailure of baseline.failures) {
  const gateFailure = currentFailures.get(oldFailure.TURN_ID);
  if (!gateFailure) {
    recovered.push(oldFailure.TURN_ID);
    continue;
  }
  const trace = traceFor(oldFailure.TURN_ID);
  if (!trace) {
    failures.push({
      TURN_ID: oldFailure.TURN_ID,
      RAW_QUERY: null,
      FIRST_DIVERGENCE_CURRENT: 'PERFORMANCE',
      REASON: 'watchdog/timeout (trace missing)',
      FAILURES: ['TIMEOUT'],
      EXPECTED: null,
      PIPELINE: null
    });
    continue;
  }
  const spec = specs.get(oldFailure.TURN_ID);
  const expected = buildExpectedContract(spec.turn, spec.conversation);
  const [cluster, reason] = classify(gateFailure, expected, trace);
  failures.push({
    TURN_ID: oldFailure.TURN_ID,
    RAW_QUERY: trace.TURN_INPUT,
    FIRST_DIVERGENCE_CURRENT: cluster,
    REASON: reason,
    FAILURES: gateFailure.failures,
    EXPECTED: expected,
    PIPELINE: {
      CANONICAL_UNDERSTANDING: trace.CANONICAL_UNDERSTANDING,
      CONTEXT_AUTHORITY: trace.SEMANTIC_CONTRACT?.contextReference || null,
      EFFECTIVE_QUERY: trace.EFFECTIVE_QUERY,
      EFFECTIVE_CONTRACT: trace.SEMANTIC_CONTRACT,
      ENTITY: trace.ACTIVE_ENTITY,
      RELATION: trace.ACTIVE_RELATION,
      REQUESTED_FIELDS: trace.REQUESTED_FIELDS,
      RETRIEVAL_PLAN: trace.RETRIEVAL_QUERY,
      EVIDENCE_CANDIDATES: trace.CANDIDATE_EVIDENCE,
      SELECTED_EVIDENCE: trace.SELECTED_EVIDENCE,
      FIELD_COVERAGE: gateFailure.actual?.requestedFields || [],
      ANSWERABILITY: trace.ANSWERABILITY_DECISION,
      COMPOSER: { source: trace.FINAL_SOURCE, output: trace.FINAL_OUTPUT },
      VERIFIER: trace.DEBUG?.verifier || null,
      FINAL_OUTPUT: trace.FINAL_OUTPUT,
      PERSISTED_STATE: trace.SESSION_AFTER?.data?.conversationState || null
    }
  });
}

const counts = {};
for (const item of failures) {
  counts[item.FIRST_DIVERGENCE_CURRENT] = (counts[item.FIRST_DIVERGENCE_CURRENT] || 0) + 1;
}
const clusters = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
const report = {
  baselinePrefix,
  runtimePrefix,
  baselineRemainingFailures: baseline.failures.length,
  currentRemainingFailures: failures.length,
  recoveredCount: recovered.length,
  recovered,
  currentFirstDivergenceClusters: Object.fromEntries(clusters),
  largestCluster: clusters[0] ? { name: clusters[0][0], count: clusters[0][1] } : null,
  failures
};
const outputPath = path.join(tmp, `${runtimePrefix}-readjudication.json`);
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  outputPath,
  baselinePrefix,
  runtimePrefix,
  baselineRemainingFailures: report.baselineRemainingFailures,
  currentRemainingFailures: report.currentRemainingFailures,
  recoveredCount: report.recoveredCount,
  recovered,
  currentFirstDivergenceClusters: report.currentFirstDivergenceClusters,
  largestCluster: report.largestCluster
}, null, 2));
