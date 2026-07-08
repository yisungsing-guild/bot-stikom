#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const INDEX_PATH = path.join(__dirname, 'src/data/rag_index.json');
const LOG_DIR = path.join(__dirname, 'rag-audit-logs');

function loadIndex(){
  if (!fs.existsSync(INDEX_PATH)) { console.error('Index not found'); process.exit(1); }
  const idx = JSON.parse(fs.readFileSync(INDEX_PATH,'utf8'));
  return idx;
}

function listUnknownChunks(index, limit=20){
  const unknown = index.filter(c => !c.docCategory || c.docCategory === 'UNKNOWN' || c.docCategory === 'NONE');
  console.log(`\n=== Showing ${Math.min(limit, unknown.length)} of ${unknown.length} UNKNOWN chunks ===\n`);
  for (let i=0;i<Math.min(limit, unknown.length);i++){
    const c = unknown[i];
    console.log(`#${i+1} id:${c.id} file:${c.filename||'N/A'} docCategory:${c.docCategory||'MISSING'}`);
    console.log(`   preview: ${(c.chunk||'').replace(/\n/g,' ').substring(0,300)}\n`);
  }
}

function findQueryLogEntry(question){
  if (!fs.existsSync(LOG_DIR)) return null;
  const files = fs.readdirSync(LOG_DIR).filter(f=>f.startsWith('query-retrieval') && f.endsWith('.jsonl'));
  if (files.length===0) return null;
  // check latest file
  const latest = files.sort().pop();
  const content = fs.readFileSync(path.join(LOG_DIR, latest),'utf8');
  const lines = content.trim().split('\n').map(l=>l.trim()).filter(Boolean);
  // find most recent entry that includes question
  for (let i=lines.length-1;i>=0;i--){
    try{
      const log = JSON.parse(lines[i]);
      if ((log.question||'').toLowerCase().includes(question.toLowerCase())) return log;
    } catch(e){}
  }
  return null;
}

function printRetrievalLog(log){
  if (!log) { console.log('Log entry not found'); return; }
  console.log('\n=== Query Retrieval Log ===\n');
  console.log('Question:', log.question);
  console.log('Detected Intent:', log.detectedIntent);
  console.log('\nTop 10 Before Filtering:');
  (log.beforeFiltering.chunks||[]).slice(0,10).forEach(c=>{
    console.log(` - rank:${c.rank} id:${c.chunkId||c.id||c.item?.id||''} file:${c.filename||c.file||'N/A'} docCategory:${c.docCategory||'UNKNOWN'} score:${c.score}`);
    console.log(`   preview: ${c.preview}\n`);
  });
  console.log('\nTop 10 After Filtering:');
  (log.afterFiltering.chunks||[]).slice(0,10).forEach(c=>{
    console.log(` - rank:${c.rank} id:${c.chunkId||c.id||''} file:${c.filename||'N/A'} docCategory:${c.docCategory||'UNKNOWN'} score:${c.score}`);
    console.log(`   preview: ${c.preview}\n`);
  });
  console.log('\nFiltering Stats:', log.filterStats||{});
}

// Main
const index = loadIndex();
listUnknownChunks(index,20);

const queries = [
  'Apa itu TI',
  'Apa itu SI',
  'TI belajar apa saja',
  'SI belajar apa saja',
  'Prospek kerja TI'
];

for (const q of queries){
  console.log('\n===========================================');
  console.log('Query:', q);
  const log = findQueryLogEntry(q);
  if (!log) {
    console.log('No audit log entry found for this query. Run the query to generate logs.');
  } else {
    printRetrievalLog(log);
  }
}

// Also search INDEX for any PRODI_PROFILE/KURIKULUM/MATA_KULIAH/PROSPEK_KERJA entries misclassified as UNKNOWN
console.log('\n===========================================');
console.log('Checking for misclassified program/profile/curriculum chunks in UNKNOWN...');
const profileKeys = ['profil','pengertian','definisi','deskripsi','visi','misi','tujuan','kurikulum','mata kuliah','mata-kuliah','mata kuliah','prospek kerja','prospek','career','program studi','program studi'];
const unknownChunks = index.filter(c=> !c.docCategory || c.docCategory==='UNKNOWN' || c.docCategory==='NONE');
let misclassified = [];
for (const c of unknownChunks){
  const txt = (c.chunk||'').toLowerCase();
  for (const k of profileKeys){
    if (txt.includes(k)) { misclassified.push({id:c.id,filename:c.filename,preview:txt.substring(0,200)}); break; }
  }
}
console.log(`Found ${misclassified.length} UNKNOWN chunks that contain profile/curriculum keywords`);
if (misclassified.length>0){
  console.log('Sample:');
  misclassified.slice(0,10).forEach((m,i)=>{
    console.log(`#${i+1}`,m.id,m.filename);
    console.log(`  preview: ${m.preview}\n`);
  })
}

if (misclassified.length>0){
  console.log('\nACTION: Some profile/curriculum chunks are classified as UNKNOWN. Need to improve classifier patterns or filename heuristics.');
} else {
  console.log('\nNo profile/curriculum chunks found in UNKNOWN. Data likely missing.');
}
