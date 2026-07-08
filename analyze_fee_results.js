const fs = require('fs');
const path = 'run_queries_results.json';
const outPath = 'run_queries_report.json';
const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
const numericFields = ['registrationFee','registrationDiscount','dpp','dppDiscount','ukt','scholarship'];

function digitsOnly(s){ if(!s) return ''; return String(s).replace(/\D/g,''); }

const report = raw.map((item) => {
  const q = item.query;
  const res = item.result;
  if (!res || res.error) return { query: q, error: res && res.error ? res.error : 'no-result' };
  const top = res.result || res; // handle shape
  const source = top.source || null;
  const confidenceTier = top.confidenceTier || top.result && top.result.confidenceTier || null;
  const trustScore = top.trustScore || top.result && top.result.trustScore || null;
  const feeStruct = (top.debug && top.debug.feeStruct) || top.feeStruct || null;
  const topChunks = (top.topChunks) || (top.contexts && top.contexts.map(c=>({id:c.id,filename:c.filename})) ) || [];
  // Determine primary chunk
  let chunkObj = null;
  if (feeStruct && feeStruct.sourceChunk) chunkObj = feeStruct.sourceChunk;
  else if (top.contexts && top.contexts.length) chunkObj = top.contexts[0];
  const chunkId = chunkObj && chunkObj.id ? chunkObj.id : (topChunks[0] && topChunks[0].id) || null;
  const filename = (feeStruct && feeStruct.sourceFile) || (chunkObj && (chunkObj.filename || chunkObj.sourceFile)) || (topChunks[0] && topChunks[0].filename) || null;
  const chunkText = chunkObj && chunkObj.chunk ? String(chunkObj.chunk) : '';

  const comparisons = {};
  for (const f of numericFields) {
    const val = feeStruct ? feeStruct[f] : null;
    const norm = digitsOnly(val);
    let match = false;
    if (norm && chunkText) {
      // search for the same digits sequence or formatted with dots/commas
      const regex = new RegExp(norm.replace(/(\d)(?=(\d{3})+$)/g, '$1'), '');
      // simple containment check: look for sequences of digits that match
      match = new RegExp(norm).test(chunkText.replace(/\D/g,'')) || new RegExp(norm).test(chunkText.replace(/[\s.,]/g,''));
      // fallback: check if any formatted variant appears in chunkText
      if (!match) {
        const variants = [];
        // with dots as thousands
        for (let i = norm.length; i>0; i-=3){ }
        // simple: check common formats
        const withDots = norm.replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1.');
        const withComma = norm.replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,');
        if (withDots && chunkText.indexOf(withDots) !== -1) match = true;
        if (withComma && chunkText.indexOf(withComma) !== -1) match = true;
        if (chunkText.indexOf(norm) !== -1) match = true;
      }
    } else if (!norm) {
      match = null; // no value to compare
    }
    comparisons[f] = { value: val || null, normalized: norm || null, match: match === true ? 'MATCH' : (match === false ? 'MISMATCH' : 'NO_VALUE') };
  }

  return {
    query: q,
    source,
    confidenceTier,
    trustScore,
    feeStruct: feeStruct || null,
    chunkId,
    filename,
    comparisons
  };
});
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
console.log('WROTE', outPath);
