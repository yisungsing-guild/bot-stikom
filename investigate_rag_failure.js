/**
 * Extract detailed RAG failure traces untuk TI query
 * Focus: TRACE_COST_TOP_CANDIDATES, TRACE_COST_RAG_MATCH, filtering metadata
 */

const fs = require('fs');
const path = require('path');

const debugFile = 'tmp_provider_runtime_debug.out';

if (!fs.existsSync(debugFile)) {
  console.error(`File ${debugFile} tidak ditemukan`);
  process.exit(1);
}

let data = fs.readFileSync(debugFile);
let text = data.toString('utf8');

// Cek encoding
if (text.includes('\u0000') || text.length < data.length / 2) {
  text = data.toString('utf16le');
}

const lines = text.split(/\r?\n/);

console.log('='.repeat(120));
console.log('DETAILED TI QUERY RAG FAILURE INVESTIGATION');
console.log('='.repeat(120));
console.log('\n');

// Extract TI query section
let tiSectionStart = -1;
let tiSectionEnd = -1;

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('TEXT: Berapa biaya TI?') || lines[i].includes('QUERY: TI cost')) {
    tiSectionStart = i;
  }
  
  if (tiSectionStart >= 0 && tiSectionEnd < 0) {
    if (lines[i].includes('####') && i > tiSectionStart + 50) {
      tiSectionEnd = i;
      break;
    }
  }
}

if (tiSectionStart < 0) {
  console.log('ERROR: TI query section not found');
  process.exit(1);
}

if (tiSectionEnd < 0) {
  tiSectionEnd = lines.length;
}

const tiLines = lines.slice(tiSectionStart, tiSectionEnd);

console.log(`FOUND TI SECTION: lines ${tiSectionStart} to ${tiSectionEnd} (${tiLines.length} lines)\n`);

// Extract all TRACE_COST_* markers
const costMarkers = [
  'TRACE_COST_CHECK_INPUT',
  'TRACE_COST_QUERY_PROGRAM',
  'TRACE_COST_QUERY_ENTITIES',
  'TRACE_COST_TOP_CANDIDATES',
  'TRACE_COST_RAG_MATCH',
  'TRACE_COST_SELECTED_CHUNK',
  'TRACE_COST_SELECTED_PROGRAM',
  'TRACE_COST_EXPECTED_PROGRAM',
  'TRACE_RAG_INTENT',
  'TRACE_RAG_SCHOLARSHIP',
  'TRACE_INTENT_RAG',
  'TRACE_FEE_RAG_RESULT'
];

for (const marker of costMarkers) {
  console.log('\n' + '─'.repeat(120));
  console.log(`>>> [${marker}]`);
  console.log('─'.repeat(120));
  
  const markerLines = tiLines
    .map((line, idx) => ({ line, idx: tiSectionStart + idx }))
    .filter(({ line }) => line.includes(`[${marker}]`));
  
  if (markerLines.length === 0) {
    console.log(`NOT FOUND in TI section`);
  } else {
    markerLines.forEach(({ line, idx }, markerIdx) => {
      if (markerIdx > 0) console.log('\n---\n');
      
      console.log(`[Line ${idx}] ${line}`);
      
      // Print next lines until end of object/array
      let depth = 0;
      let jsonStarted = false;
      let prevLine = '';
      
      for (let j = idx + 1; j < Math.min(idx + 80, lines.length); j++) {
        const nextLine = lines[j];
        
        // Detect JSON start
        if (!jsonStarted && (nextLine.includes('{') || nextLine.includes('['))) {
          jsonStarted = true;
        }
        
        // Print JSON lines
        if (jsonStarted) {
          console.log(nextLine);
          
          // Count braces
          const open = (nextLine.match(/{/g) || []).length + (nextLine.match(/\[/g) || []).length;
          const close = (nextLine.match(/}/g) || []).length + (nextLine.match(/\]/g) || []).length;
          depth += open - close;
          
          // Stop when JSON closes
          if (depth <= 0 && jsonStarted && (nextLine.includes('}') || nextLine.includes(']'))) {
            break;
          }
        } else if (nextLine.trim().startsWith('[')) {
          console.log(nextLine);
          break;
        } else if (!nextLine.trim().startsWith('>') && nextLine.trim() && !nextLine.includes('QUERY:')) {
          console.log(nextLine);
        } else if (nextLine.includes('QUERY:') || nextLine.includes('[') && !jsonStarted) {
          break;
        }
      }
    });
  }
}

console.log('\n\n' + '='.repeat(120));
console.log('CATEGORY = BEASISWA INVESTIGATION');
console.log('='.repeat(120));

const categoryLines = tiLines.filter(l => l.includes('category') || l.includes('BEASISWA'));
console.log(`\nFound ${categoryLines.length} lines mentioning category/BEASISWA:\n`);
categoryLines.slice(0, 20).forEach(l => console.log(l));

console.log('\n\n' + '='.repeat(120));
console.log('TI RAG CHUNK RETRIEVAL FLOW');
console.log('='.repeat(120));

// Extract chunk related logs
const chunkLines = tiLines.filter(l => 
  l.includes('chunk') || l.includes('score') || l.includes('relevance') || 
  l.includes('ragSource') || l.includes('selectedChunk')
);

console.log(`\nFound ${chunkLines.length} lines related to chunks:\n`);
chunkLines.slice(0, 30).forEach(l => {
  if (l.length > 200) {
    console.log(l.substring(0, 200) + '...');
  } else {
    console.log(l);
  }
});

console.log('\n\n' + '='.repeat(120));
console.log('COMPARISON: SI QUERY (SUCCESS) vs TI QUERY (FAILURE)');
console.log('='.repeat(120));

// Find SI section
let siSectionStart = -1;
let siSectionEnd = -1;

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('TEXT: Berapa biaya Sistem Informasi?') || lines[i].includes('QUERY: SI cost')) {
    siSectionStart = i;
  }
  
  if (siSectionStart >= 0 && siSectionEnd < 0) {
    if (lines[i].includes('####') && i > siSectionStart + 50) {
      siSectionEnd = i;
      break;
    }
  }
}

if (siSectionStart >= 0) {
  if (siSectionEnd < 0) siSectionEnd = lines.length;
  const siLines = lines.slice(siSectionStart, siSectionEnd);
  
  console.log('\n[SI SUCCESS] TRACE_COST_TOP_CANDIDATES:');
  const siCandidates = siLines.filter(l => l.includes('TRACE_COST_TOP_CANDIDATES'));
  siCandidates.slice(0, 5).forEach(l => console.log(l.substring(0, 300)));
  
  console.log('\n[SI SUCCESS] selectedChunkCount:');
  const siChunks = siLines.filter(l => l.includes('selectedChunkCount'));
  siChunks.slice(0, 5).forEach(l => console.log(l));
  
  console.log('\n[SI SUCCESS] ragSuccess:');
  const siRag = siLines.filter(l => l.includes('ragSuccess'));
  siRag.slice(0, 5).forEach(l => console.log(l));
}

console.log('\n\n[TI FAILURE] selectedChunkCount:');
const tiChunks = tiLines.filter(l => l.includes('selectedChunkCount'));
tiChunks.slice(0, 5).forEach(l => console.log(l));

console.log('\n[TI FAILURE] ragSuccess:');
const tiRag = tiLines.filter(l => l.includes('ragSuccess'));
tiRag.slice(0, 5).forEach(l => console.log(l));

console.log('\n' + '='.repeat(120));
