const fs = require('fs');
const path = require('path');
function escapeRe(s){return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
const jest = JSON.parse(fs.readFileSync('jest_ragEngine_results.json','utf8'));
const testsFile = fs.readFileSync('tests/ragEngine.test.js','utf8').split('\n');
const tmpRaw = fs.readFileSync('tmp_retrieval_compare_output.json','utf16le');
let tmp;
try{ const cleaned = tmpRaw.replace(/^\uFEFF/, ''); tmp = JSON.parse(cleaned); } catch(e){ console.error('PARSE_TMP_ERROR', e.message); process.exit(1); }
const assertionResults = (jest.testResults && jest.testResults[0] && jest.testResults[0].assertionResults) || [];
const fails = assertionResults.filter(a=>a.status==='failed');
const pickIdx = [6,13,14]; // 1-based per user
const results = [];
for(const idx of pickIdx){
  const i = idx-1;
  if(i<0 || i>=fails.length){ results.push({index:idx,error:'index out of range', totalFailures:fails.length}); continue; }
  const fail = fails[i];
  const title = fail.title;
  // find test line in tests file
  // find test line in tests file (simple contains search)
  // const re = new RegExp("test\\(\'\\" + escapeRe(title) + "\\'\\");
  // simpler: search for the title string
  let lineNum = -1;
  for(let li=0; li<testsFile.length; li++){
    if(testsFile[li].includes(title)) { lineNum = li; break; }
  }
  const snippet = testsFile.slice(Math.max(0,lineNum-3), Math.min(testsFile.length, lineNum+15)).join('\n');
  // try extract query string
  const qMatch = snippet.match(/query\(\s*['`\"]([^'`\"]+)['`\"]\s*\)/);
  const tryMatch = snippet.match(/tryStructuredExactCostAnswer\(\s*['`\"]([^'`\"]+)['`\"]/);
  const constResMatch = snippet.match(/await\s+query\(\s*['`\"]([^'`\"]+)['`\"]\s*\)/);
  const anyStrMatch = snippet.match(/['`\"]([^'`\"]+biaya[^'`\"]+)['`\"]/i) || snippet.match(/['`\"]([^'`\"])['`\"]/);
  const queryStr = (qMatch && qMatch[1]) || (tryMatch && tryMatch[1]) || (constResMatch && constResMatch[1]) || null;
  let retrieval = null;
  if(queryStr){
    const qTrim = queryStr.trim();
    // find in tmp data
    const found = (tmp.before||[]).concat(tmp.after||[]).find(x=>String(x.query||'').trim()===qTrim) || (tmp.find && tmp.find(x=>x.query&&x.query.trim()===qTrim));
    // More robust: search among array entries
    let entry = null;
    const arr = Array.isArray(tmp.before) ? tmp.before : (Array.isArray(tmp) ? tmp : []);
    function findEntry(q){
      for(const e of tmp.before||[]) if((e.query||'').trim()===q) return {phase:'before',entry:e};
      for(const e of tmp.after||[]) if((e.query||'').trim()===q) return {phase:'after',entry:e};
      if(Array.isArray(tmp)) for(const e of tmp) if((e.query||'').trim()===q) return {phase:'unknown',entry:e};
      return null;
    }
    entry = findEntry(qTrim);
    retrieval = {query: qTrim, entry};
  }
  results.push({index: idx, title, line: lineNum+1, snippet, query: queryStr, retrieval});
}
// Numeric grounding: find the earlier test 'validateNumericGrounding accepts explicit numeric values from official documents'
let valTestLine=-1;
for(let i=0;i<testsFile.length;i++){ if(testsFile[i].includes('validateNumericGrounding accepts explicit numeric values')){ valTestLine=i; break; } }
const valSnippet = testsFile.slice(Math.max(0,valTestLine-3), Math.min(testsFile.length, valTestLine+12)).join('\n');
// Prepare numeric input per test
const numericInput = 'Rp 1.500.000';
const chunks = [{ chunk: 'Biaya pendaftaran: Rp 1.500.000', filename: 'RINCIAN_BIAYA.pdf', ocrQualityScore: 0.95 }];
// require ragEngine
let rag;
try{ rag = require('../src/engine/ragEngine'); } catch(e){ console.error('LOAD_RAG_ERR', e.message); process.exit(1); }
const validate = rag.validateNumericGrounding ? rag.validateNumericGrounding(numericInput, chunks) : null;
let parseFn = rag.parseCompactRupiahNumber ? rag.parseCompactRupiahNumber : null;
let parsed = null;
if(parseFn){ try{ parsed = parseFn(numericInput); } catch(e){ parsed = {error: e.message}; } }
async function runRetrievalAudit() {
  const beforeMod = require('../src/engine/temp_ragEngine_before');
  const afterMod = require('../src/engine/ragEngine');
  const beforeIndexPath = beforeMod.getIndexPath();
  const afterIndexPath = afterMod.getIndexPath();
  const indexPath = beforeIndexPath || afterIndexPath || 'src/data/rag_index.json';
  const indexRaw = fs.readFileSync(indexPath,'utf8');
  const index = JSON.parse(indexRaw || '[]');

  const audit = [];
  for (const r of results) {
    const q = r.query || null;
    if (!q) { audit.push({index: r.index, title: r.title, error: 'no query string found in test'}); continue; }
    try {
      const qEmbBefore = await beforeMod.computeEmbedding(q);
      const qEmbAfter = await afterMod.computeEmbedding(q);
      const computeFor = (mod, qEmb) => {
        const scored = index.map(item => {
          const sem = Array.isArray(item.embedding) && qEmb ? (function(){
            // cosine similarity
            const a = qEmb; const b = item.embedding; let dot=0, na=0, nb=0; for(let i=0;i<Math.max(a.length,b.length);i++){ const av=a[i]||0; const bv=b[i]||0; dot+=av*bv; na+=av*av; nb+=bv*bv; } return na===0||nb===0?0:dot/Math.sqrt(na*nb); })() : 0;
          const breakdown = mod.getChunkScoreBreakdown(item, q, null, sem, null);
          return {item, semanticScore: sem, compositeScore: breakdown.compositeScore, breakdown};
        });
        scored.sort((a,b)=>b.compositeScore - a.compositeScore);
        const top = scored.slice(0,10).map((s,idx)=>({rank: idx+1, id: s.item.id, filename: s.item.filename, category: s.item.category||s.item.docCategory, semantic: Number(s.semanticScore.toFixed(6)), semanticBoost: s.breakdown.semanticBoost, evidenceScore: s.breakdown.evidenceScore, composite: Number(s.compositeScore.toFixed(6)), preview: String(s.item.chunk||'').slice(0,160)}));
        // find position of cost/discount evidence
        const costPos = scored.findIndex(s=>String(s.item.chunk||'').toLowerCase().includes('potongan') || /potongan|diskon|dpp|pendaftaran|dana pendidikan/i.test(String(s.item.chunk||'')));
        return {top, costPosition: costPos>=0?costPos+1:null};
      };
      const beforeRes = computeFor(beforeMod, qEmbBefore);
      const afterRes = computeFor(afterMod, qEmbAfter);
      // determine if important evidence demoted: compare costPosition
      const demoted = (beforeRes.costPosition && afterRes.costPosition) ? (afterRes.costPosition > beforeRes.costPosition) : (afterRes.costPosition===null && beforeRes.costPosition!==null);
      audit.push({index: r.index, title: r.title, query: q, before: beforeRes, after: afterRes, evidenceDemoted: Boolean(demoted)});
    } catch (e) {
      audit.push({index: r.index, title: r.title, query: q, error: e.message});
    }
  }

  // numeric grounding run (reuse rag module validate/parse if available)
  const numeric = {testSnippet: valSnippet, input: numericInput, chunks, parsed, validation: validate};
  const final = {retrievalAudit: audit, numericGrounding: numeric};
  console.log(JSON.stringify(final,null,2));
}

runRetrievalAudit().catch(e=>{ console.error('RUN_ERR', e && e.message? e.message : String(e)); process.exit(1); });
