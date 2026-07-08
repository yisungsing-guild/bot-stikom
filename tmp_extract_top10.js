const fs = require('fs');
const p = 'tmp_trace_ti_2c_output.json';
let j = null;
try{ j = JSON.parse(fs.readFileSync(p,'utf8')); } catch(e){ console.error('ERR', e.message); process.exit(2);} 
// find retrieval array entries with 'id' and 'score' or trustScore
let retrieval = [];
for(const k of Object.keys(j)){
  const val = j[k];
  if(Array.isArray(val)){
    for(const item of val){
      if(item && (item.id || item.chunkId) && (typeof item.score === 'number' || typeof item.trustScore === 'number')) retrieval.push(item);
    }
  }
}
// find TRACE_COST_SELECT_4_TOP_CHUNKS topChunks
let topChunks = [];
if(j['[TRACE_COST_SELECT_4_TOP_CHUNKS]'] && Array.isArray(j['[TRACE_COST_SELECT_4_TOP_CHUNKS]'])){
  try{
    // structure is nested arrays
    const arr = j['[TRACE_COST_SELECT_4_TOP_CHUNKS]'];
    for(const a of arr){
      if(Array.isArray(a)){
        for(const b of a){
          if(b && b.topChunks) topChunks = b.topChunks;
        }
      }
    }
  }catch(e){}
}
const byId = {};
for(const t of topChunks) byId[t.id || t.chunkId] = t;
const out = retrieval.slice(0,50).map(r => ({ id: r.id || r.chunkId, filename: r.filename || (r.metadata && r.metadata.filename) || null, score: (typeof r.score === 'number' ? r.score : (typeof r.trustScore === 'number' ? r.trustScore : null)), detectedProgram: (byId[r.id] && byId[r.id].programName) || (byId[r.chunkId] && byId[r.chunkId].programName) || null }));
console.log(JSON.stringify(out.slice(0,10), null, 2));
