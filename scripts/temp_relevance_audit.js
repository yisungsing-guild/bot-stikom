const fs = require('fs');
const ev = require('../src/engine/evidenceValidator');
const data = JSON.parse(fs.readFileSync('tmp_chunks.json','utf8'));
const ids = ['1ea21dbf-def4-4600-87ab-9f0d22a0c2e5','81881ff1-d3cc-48dd-a812-e530565be8c5'];
const queries = [
  {q: 'Apa itu SI', intent: 'DEFINISI_PRODI'},
  {q: 'Apa itu TI', intent: 'DEFINISI_PRODI'},
  {q: 'Prospek kerja TI', intent: 'PROSPEK_KERJA'}
];
const ABBR_MAP = {si: 'sistem informasi', ti: 'teknologi informasi', sk: 'sistem komputer', bd: 'bisnis digital', mi: 'manajemen informatika'};

function analyze(chunk, question){
  const original = String(question || '').toLowerCase();
  let expanded = original;
  for (const [abbr, full] of Object.entries(ABBR_MAP)){
    const re = new RegExp('\\b' + abbr + '\\b', 'gi');
    expanded = expanded.replace(re, function(m){ return m + ' ' + full; });
  }
  const questionTokens = expanded.split(/\s+/).filter(w => (w && (w.length > 2 || Object.keys(ABBR_MAP).includes(w.toLowerCase()))));
  const chunkTokens = String(chunk.chunk).toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const overlapTokens = [];
  let overlap = 0;
  for (const kw of questionTokens){
    if (chunkTokens.some(ck => ck.includes(kw) || kw.includes(ck))){
      overlap++; overlapTokens.push(kw);
    }
  }
  const overlapRatio = questionTokens.length > 0 ? overlap / questionTokens.length : 0;
  return { original, expanded, questionTokens, chunkTokensSample: chunkTokens.slice(0,60), overlapTokens, overlapRatio };
}

const out = {};
for (const id of ids){
  const chunk = data.find(c => c.id === id);
  out[id] = { id: chunk.id, filename: chunk.filename || chunk.trainingId, docCategory: chunk.docCategory || chunk.category, analyses: {} };
  for (const q of queries){
    out[id].analyses[q.q] = Object.assign({ relevance: ev.validateChunkRelevanceToQuestion(chunk, q.q, q.intent) }, analyze(chunk, q.q));
  }
}
console.log(JSON.stringify(out, null, 2));
