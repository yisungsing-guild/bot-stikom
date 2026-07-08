/**
 * Extract raw provider logs untuk masing-masing query
 * Menampilkan log mentah TANPA ringkasan
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

// Struktur query untuk tracking
const queries = [
  { name: 'TI', user: 'Berapa biaya TI?' },
  { name: 'SI', user: 'Berapa biaya Sistem Informasi?' },
  { name: 'BD', user: 'Berapa biaya Bisnis Digital?' },
  { name: 'SK def', user: 'Apa itu SK?' },
  { name: 'SK full', user: 'Apa itu Sistem Komputer?' }
];

// Extractor untuk setiap marker
const markers = [
  '[TRACE_FEE_PROGRAM]',
  '[TRACE_RAG_QUERY_ENTITIES]',
  '[TRACE_DEF_QUERY]',
  '[TRACE_DEF_ENTITY]',
  '[Provider] RAG selection debug',
  '[FINAL ANSWER]',
  '[TRACE_DEF_NORMALIZED_PROGRAM]'
];

console.log('='.repeat(100));
console.log('RAW PROVIDER LOGS - MASING-MASING QUERY');
console.log('='.repeat(100));

// Identifikasi section untuk setiap query
let currentQuery = null;
let inQuery = false;
let queryLines = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  // Deteksi awal query
  for (const q of queries) {
    if (line.includes(`TEXT: ${q.user}`) || line.includes(`QUERY: ${q.name}`)) {
      // Simpan query sebelumnya
      if (currentQuery && queryLines.length > 0) {
        printQueryLogs(currentQuery, queryLines);
        queryLines = [];
      }
      currentQuery = q;
      inQuery = true;
      queryLines.push(line);
      break;
    }
  }
  
  if (inQuery && currentQuery) {
    queryLines.push(line);
    
    // Deteksi akhir query (separator atau query baru)
    if (line.includes('####') && queryLines.length > 10) {
      printQueryLogs(currentQuery, queryLines);
      queryLines = [];
      inQuery = false;
      currentQuery = null;
    }
  }
}

// Print sisa query
if (currentQuery && queryLines.length > 0) {
  printQueryLogs(currentQuery, queryLines);
}

function printQueryLogs(query, queryLines) {
  console.log('\n');
  console.log('─'.repeat(100));
  console.log(`QUERY: ${query.name} (${query.user})`);
  console.log('─'.repeat(100));
  
  // Extract marker sections
  for (const marker of markers) {
    const markerLines = queryLines
      .map((l, idx) => ({ line: l, idx }))
      .filter(({ line }) => line.includes(marker));
    
    if (markerLines.length > 0) {
      console.log(`\n>>> ${marker}`);
      
      markerLines.forEach(({ line, idx }) => {
        // Print marker line
        console.log(line);
        
        // Print next few lines jika JSON
        for (let j = idx + 1; j < Math.min(idx + 30, queryLines.length); j++) {
          const nextLine = queryLines[j];
          if (nextLine.trim().startsWith('{') || 
              nextLine.trim().startsWith('[') ||
              nextLine.trim().match(/^[\s\w":.,-]+[})/]/)) {
            console.log(nextLine);
            if (nextLine.includes('msg') && (nextLine.includes('}') || nextLine.includes(']'))) {
              break;
            }
          } else if (!nextLine.trim().startsWith('>') && nextLine.trim()) {
            console.log(nextLine);
          } else if (nextLine.includes('>')) {
            break;
          }
        }
      });
    }
  }
  
  // Extract programHint, program, programLabel dari JSON
  console.log(`\n>>> EXTRACTED VALUES:`);
  
  for (const marker of ['[Provider] RAG selection debug', '[TRACE_RAG_QUERY_ENTITIES]']) {
    const text = queryLines.join('\n');
    const jsonMatch = text.match(/"(programHint|program|programLabel|ragSuccess|sourceFiles)":\s*"?([^",}]+)"?/g);
    
    if (jsonMatch) {
      console.log(`\nFrom ${marker}:`);
      jsonMatch.forEach(m => console.log(`  ${m}`));
    }
  }
}

console.log('\n');
console.log('='.repeat(100));
