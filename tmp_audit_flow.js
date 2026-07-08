const engine = require('./src/engine/ragEngine');
const { decorateBotAnswerText } = require('./src/engine/conversationalStyle');
const fs = require('fs');

function simpleExtractRows(raw) {
  if (!raw) return [];
  const lines = String(raw).replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);
  const rows = [];
  const amtRe = /(?:Rp\s*\.?\s*)?([0-9][0-9\.,]{0,}|[0-9]{1,3}(?:\.[0-9]{3})+)/;
  for (const l of lines) {
    // try patterns like '3. Jas ... 750.000 ...'
    const mNumLeading = /^\d+\.?\s*(.*)$/i.exec(l);
    const text = mNumLeading ? mNumLeading[1] : l;
    const m = text.match(amtRe);
    if (m) {
      const idx = m.index;
      const label = text.substring(0, idx).replace(/[:\-]$/,'').trim();
      const amt = m[1] ? ('Rp ' + m[1].replace(/\s+/g,'')) : null;
      const timing = text.substring(idx + m[0].length).trim();
      rows.push({ label: label || null, amount: amt || null, timing: timing || null, raw: l });
    }
  }
  return rows;
}

async function runOne(query) {
  const res = await engine.query(query);
  const rawAnswer = res && res.answer ? res.answer : null;
  const preDecorate = rawAnswer;
  const final = decorateBotAnswerText(preDecorate, query);
  // attempt to get feeStruct from debug in run result - engine.query returns object; if not present, try calling tryStructuredExactCostAnswer
  let feeStruct = null;
  if (res && res.debug && res.debug.feeStruct) feeStruct = res.debug.feeStruct;
  // contexts: top chunks
  const contexts = (res && res.contexts) ? res.contexts : (res && res.debug && res.debug.topChunks ? res.debug.topChunks : []);
  // reconstruct rows from first context.rawChunk or feeStruct.rawChunk
  const rawChunk = (feeStruct && feeStruct.rawChunk) ? feeStruct.rawChunk : (contexts && contexts[0] && contexts[0].chunk ? contexts[0].chunk : null);
  const parsedRows = simpleExtractRows(rawChunk);

  // Build formatter input object approximation
  const formatterInput = {
    feeStruct,
    queryEntities: res && res.debug && res.debug.entity ? res.debug.entity : null,
    contexts
  };

  const out = {
    query,
    parsedRows,
    feeStruct,
    formatterInput,
    preDecorate,
    final
  };
  // append to file
  const outPath = './tmp_audit_flow_outputs.jsonl';
  fs.appendFileSync(outPath, JSON.stringify(out) + '\n');
}

(async () => {
  const queries = [
    'berapa biaya TI gelombang 1A',
    'berapa biaya TI gelombang 2C',
    'berapa biaya SI gelombang 2C'
  ];
  for (const q of queries) {
    try {
      await runOne(q);
    } catch (e) {
      console.error('ERROR running query', q, e && e.stack);
    }
  }
})();
