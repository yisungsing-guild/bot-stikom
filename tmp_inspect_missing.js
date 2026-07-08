const engine = require('./src/engine/ragEngine');
const fs = require('fs');

function simpleExtractRows(raw) {
  if (!raw) return [];
  const lines = String(raw).replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);
  const rows = [];
  const amtRe = /(?:Rp\s*\.?\s*)?([0-9][0-9\.,]{0,}|[0-9]{1,3}(?:\.[0-9]{3})+)/;
  for (const l of lines) {
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

const queries = ['berapa biaya MI','berapa biaya DD DNUI','berapa biaya HELP','berapa biaya UTB'];

(async ()=>{
  for(const q of queries){
    try{
      const res = await engine.query(q);
      const contexts = (res && res.contexts) ? res.contexts : (res && res.debug && res.debug.topChunks ? res.debug.topChunks : []);
      const firstChunk = contexts && contexts[0] && contexts[0].chunk ? contexts[0].chunk : (res && res.debug && res.debug.feeStruct && res.debug.feeStruct.rawChunk ? res.debug.feeStruct.rawChunk : null);
      const parsedRows = simpleExtractRows(firstChunk);
      const out = { query: q, feeStruct: res && res.debug && res.debug.feeStruct ? res.debug.feeStruct : null, contextsCount: contexts.length, firstChunk, parsedRows };
      fs.appendFileSync('./tmp_inspect_missing_outputs.jsonl', JSON.stringify(out)+"\n");
      console.log('Inspected', q);
    }catch(e){ console.error('ERR',q,e && e.message); }
  }
})();
