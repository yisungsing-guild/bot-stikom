const fs = require('fs');
const path = require('path');
const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'uat-provider-output.json'), 'utf8'));
function findLog(r, prefix) {
  return r.logs.find(l => l.startsWith(prefix)) || null;
}
function extractJson(s) {
  if (!s) return null;
  const m = s.match(/\{[\s\S]*\}$/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch (e) {
    return null;
  }
}
function extractFull(label, logs) {
  const idx = logs.findIndex(l => l.startsWith(label));
  if (idx < 0) return null;
  let text = logs[idx].slice(label.length);
  for (let j = idx + 1; j < logs.length; j++) {
    const line = logs[j];
    if (line.startsWith('=== ') && !line.startsWith(label)) break;
    text += '\n' + line;
  }
  return text.trim();
}

const summary = data.results.map(r => {
  const incoming = findLog(r, '[TRACE_INTENT_1]');
  const detailed = findLog(r, '[TRACE_INTENT_DETAILED]');
  const humanizer = findLog(r, '[TRACE_HUMANIZER_INTENT]');
  const final = findLog(r, '[TRACE_FINAL_WA_INTENT]');
  const rawFull = extractFull('=== FULL_BEFORE_DECORATE ===', r.logs) || '';
  const finalFull = extractFull('=== FULL_FINAL_WA_MESSAGE ===', r.logs) || '';
  const rawRag = rawFull || (findLog(r, '[TRACE_RAW_RAG_ANSWER]') || '');
  const incomingIntent = incoming ? (extractJson(incoming.slice(incoming.indexOf('{')))?.detectedIntent || incoming.split(' ')[2]) : null;
  const routedIntent = detailed ? extractJson(detailed.slice(detailed.indexOf('{')))?.routedIntent : null;
  const humanizerIntent = humanizer ? extractJson(humanizer.slice(humanizer.indexOf('{')))?.intent : null;
  const finalIntent = final ? extractJson(final.slice(final.indexOf('{')))?.finalIntent : null;
  const debugEvents = Array.isArray(r.debugEvents) ? r.debugEvents : [];
  const debugEventCounts = debugEvents.reduce((acc, ev) => {
    const route = String(ev.route || 'unknown');
    const source = String(ev.source || 'unknown');
    acc.byRoute[route] = (acc.byRoute[route] || 0) + 1;
    acc.bySource[source] = (acc.bySource[source] || 0) + 1;
    acc.total += 1;
    return acc;
  }, { total: 0, byRoute: {}, bySource: {} });

  return {
    query: r.query,
    incomingIntent,
    routedIntent,
    humanizerIntent,
    finalIntent,
    ragUsed: r.body.ragUsed === true,
    rawRAG: rawRag.replace(/\r?\n/g, '\\n').slice(0, 350),
    finalMessage: finalFull.replace(/\r?\n/g, '\\n').slice(0, 450),
    status: r.status,
    body: r.body,
    debugEventCount: debugEventCounts.total,
    debugEventRoutes: debugEventCounts.byRoute,
    debugEventSources: debugEventCounts.bySource
  };
});
fs.writeFileSync(path.resolve(__dirname, 'uat-summary.json'), JSON.stringify(summary, null, 2), 'utf8');
console.log('WROTE uat-summary.json');
