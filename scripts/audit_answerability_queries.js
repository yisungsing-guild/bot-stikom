const fs = require('fs');
const path = require('path');
const ragEngine = require('../src/engine/ragEngine');
const evidenceSelector = require('../src/engine/evidenceSelector');
const semantic = require('../src/engine/semanticRagEngine');
const preflight = require('../src/utils/answerPreflightEvaluator');

function loadIndexSafe() {
  try {
    return ragEngine.loadIndex();
  } catch (e) {
    console.error('Failed to load index:', e && e.message ? e.message : e);
    return [];
  }
}

async function run() {
  const queries = [
    'biaya teknologi informasi gelombang 1A',
    'biaya sistem informasi gelombang 2',
    'apa syarat KIP',
    'informasi double degree',
    'apa itu sistem informasi'
  ];

  const index = loadIndexSafe();
  console.log('Loaded index size:', Array.isArray(index) ? index.length : 0);

  for (const q of queries) {
    try {
      const contexts = Array.isArray(index) ? index.slice(0, 300) : [];
      const selected = evidenceSelector.selectEvidenceFromContexts({ question: q, contexts, intent: '', maxEvidence: 6 });
      const detectedIntent = evidenceSelector.detectEvidenceIntent(q, '');
      const genericIntent = semantic.detectGenericIntent ? semantic.detectGenericIntent(q) : detectedIntent;

      const evalLegacy = evidenceSelector.evaluateEvidenceAnswerability({ question: q, selectedEvidence: selected, intent: '' });
      const evalGeneric = semantic.evaluateGenericAnswerability ? semantic.evaluateGenericAnswerability(q, selected, { intent: '' }) : null;

      // Determine required evidence per generic evaluator heuristics
      const required = [];
      if (genericIntent === 'fee') required.push('fee_amount');
      if (genericIntent === 'schedule') required.push('date_or_period');
      if (genericIntent === 'requirement') required.push('concrete_requirements');

      const selectedIds = (Array.isArray(selected) ? selected : []).map((it) => (it && (it.sourceId || it.chunkId || it.id)) || null).slice(0, 10);

      const pre = preflight.evaluateOutboundAnswer ? preflight.evaluateOutboundAnswer('', q, { source: 'audit' }) : null;

      console.log('---');
      console.log('Query:', q);
      console.log('Detected intent (evidenceSelector.detectEvidenceIntent):', detectedIntent);
      console.log('Detected generic intent (semantic):', genericIntent);
      console.log('Selected evidence count:', Array.isArray(selected) ? selected.length : 0);
      console.log('Selected evidence IDs (sample):', selectedIds);
      console.log('Required evidence (heuristic):', required);
      console.log('Legacy evaluateEvidenceAnswerability:', evalLegacy);
      console.log('Generic evaluateGenericAnswerability:', evalGeneric);
      console.log('Preflight sample decision for empty answer:', pre && pre.action ? pre.action : null);
    } catch (e) {
      console.error('Error processing query', q, e && e.message ? e.message : e);
    }
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
