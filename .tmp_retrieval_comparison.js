#!/usr/bin/env node

/**
 * RETRIEVAL COMPARISON: ORIGINAL vs SIMULATED INDEX
 * 
 * Simulates retrieval with:
 * 1. Original index (category="SK" for chunk 6631dfc1) 
 * 2. Simulated index (category="KURIKULUM" for chunk 6631dfc1)
 * 
 * For 3 SI queries to show:
 * - Ranking before/after
 * - Filter status
 * - Blacklist impact
 * - Double Degree interference
 */

const fs = require('fs');
const path = require('path');

// Load RAG engine functions
const ragEngine = require('./src/engine/ragEngine');
const evidenceValidator = require('./src/engine/evidenceValidator');

// ============================================================================
// LOAD INDEXES
// ============================================================================

const originalIndexPath = path.join(__dirname, 'src', 'data', 'rag_index.json');
const simulatedIndexPath = path.join(__dirname, '.tmp_simulated_index.json');
const queriesPath = path.join(__dirname, '.tmp_simulation_queries.json');

if (!fs.existsSync(simulatedIndexPath)) {
  console.error('ERROR: Simulated index not found. Run .tmp_metadata_fix_simulation.js first');
  process.exit(1);
}

const originalIndex = JSON.parse(fs.readFileSync(originalIndexPath, 'utf8'));
const simulatedIndex = JSON.parse(fs.readFileSync(simulatedIndexPath, 'utf8'));
const queries = JSON.parse(fs.readFileSync(queriesPath, 'utf8'));

const TARGET_CHUNK_ID = '6631dfc1-b46c-4933-a340-392dfd2250d6';

console.log('\n' + '='.repeat(90));
console.log('RETRIEVAL COMPARISON AUDIT: ORIGINAL vs SIMULATED INDEX');
console.log('='.repeat(90));

console.log('\nSetup:');
console.log(`  Original index chunks: ${originalIndex.length}`);
console.log(`  Simulated index chunks: ${simulatedIndex.length}`);
console.log(`  Target chunk: ${TARGET_CHUNK_ID}`);

const origChunk = originalIndex.find(c => c.id === TARGET_CHUNK_ID);
const simChunk = simulatedIndex.find(c => c.id === TARGET_CHUNK_ID);

console.log(`\n  Original chunk metadata:  category="${origChunk.category}" docCategory="${origChunk.docCategory}"`);
console.log(`  Simulated chunk metadata: category="${simChunk.category}" docCategory="${simChunk.docCategory}"`);

// ============================================================================
// HELPER FUNCTIONS FROM RAG ENGINE
// ============================================================================

// Blacklist check (from ragEngine.js line 3292)
function isAcademicProgramBlacklistChunk(chunk, filename) {
  const text = String(chunk || '').toLowerCase();
  const file = String(filename || '').toLowerCase();
  const blacklisted = /\b(?:surat\s+keputusan|sk\s*(?:no|nomor|akreditasi|keputusan|penetapan|rektorat|pembina|pendaftaran|tanggal)|mou|moa|kerja\s+sama|perjanjian|notulen|berita\s+acara|administrasi|arsip|dokumen\s+internal|tembusan|cap|stempel|tanda\s+tangan|rektor|direktur|yayasan|ketua|lampiran|perihal|menimbang|mengingat|memutuskan|ditetapkan\s+di|pada\s+tanggal)\b/i;
  const metadata = /\b(?:ketua|direktur|rektor|yayasan|tembusan|cap|stempel|tanda\s+tangan)\b/i;
  return blacklisted.test(text) || blacklisted.test(file) || metadata.test(text) || metadata.test(file);
}

// Simple cosine similarity (for demonstration)
function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-10);
}

// Simple embedding mock (just use first 10 chars of text as pseudo-embedding)
function getEmbedding(text) {
  const t = String(text || '');
  const arr = new Float32Array(384);
  for (let i = 0; i < Math.min(t.length, 384); i++) {
    arr[i] = (t.charCodeAt(i) - 32) / 128;
  }
  return Array.from(arr);
}

// ============================================================================
// RETRIEVAL SIMULATION
// ============================================================================

function runRetrieval(indexToUse, query) {
  const queryEmbedding = getEmbedding(query);
  
  // Score all chunks
  const scored = indexToUse
    .filter(c => c && c.embedding)
    .map(item => {
      const sim = cosineSimilarity(item.embedding || [], queryEmbedding);
      return {
        item,
        score: sim,
        // Check if blacklisted
        isBlacklisted: isAcademicProgramBlacklistChunk(item.chunk, item.filename)
      };
    })
    .sort((a, b) => b.score - a.score);

  return scored;
}

// ============================================================================
// RUN AUDIT FOR EACH QUERY
// ============================================================================

for (const query of queries) {
  console.log('\n\n' + '='.repeat(90));
  console.log(`QUERY ${query.id}: "${query.text}"`);
  console.log('='.repeat(90));

  const origResults = runRetrieval(originalIndex, query.text);
  const simResults = runRetrieval(simulatedIndex, query.text);

  // Find target chunk in results
  const origTarget = origResults.findIndex(r => r.item.id === TARGET_CHUNK_ID);
  const simTarget = simResults.findIndex(r => r.item.id === TARGET_CHUNK_ID);

  console.log(`\nTARGET CHUNK 6631dfc1 STATUS:`);
  console.log(`  Original index:  rank #${origTarget >= 0 ? origTarget + 1 : 'NOT FOUND'}`);
  if (origTarget >= 0) {
    const origItem = origResults[origTarget];
    console.log(`    - Score: ${origItem.score.toFixed(6)}`);
    console.log(`    - Category: "${origItem.item.category}"`);
    console.log(`    - Blacklisted: ${origItem.isBlacklisted ? 'YES ❌' : 'NO ✓'}`);
  }

  console.log(`  Simulated index: rank #${simTarget >= 0 ? simTarget + 1 : 'NOT FOUND'}`);
  if (simTarget >= 0) {
    const simItem = simResults[simTarget];
    console.log(`    - Score: ${simItem.score.toFixed(6)}`);
    console.log(`    - Category: "${simItem.item.category}"`);
    console.log(`    - Blacklisted: ${simItem.isBlacklisted ? 'YES ❌' : 'NO ✓'}`);
  }

  if (origTarget >= 0 && simTarget >= 0) {
    const rankChange = origTarget - simTarget;
    console.log(`  Rank change: ${rankChange > 0 ? '↑ IMPROVED by ' + rankChange : rankChange < 0 ? '↓ WORSE by ' + (-rankChange) : 'SAME'}`);
  }

  // Show top 10 from ORIGINAL
  console.log(`\n📊 TOP 10 (ORIGINAL INDEX):`);
  console.log('  Rank  Program  Category  Blacklist  Filename');
  console.log('  ' + '-'.repeat(80));
  for (let i = 0; i < Math.min(10, origResults.length); i++) {
    const r = origResults[i];
    const marker = r.item.id === TARGET_CHUNK_ID ? ' ◄◄ TARGET' : '';
    const blStatus = r.isBlacklisted ? '⚠️  YES' : '   -';
    const prog = r.item.program || '?';
    const cat = r.item.category || '?';
    const fname = (r.item.filename || '').substring(0, 40);
    console.log(
      `  #${String(i + 1).padEnd(3)} ${String(prog).padEnd(9)} ${String(cat).padEnd(10)} ${blStatus}  ${fname}${marker}`
    );
  }

  // Show top 10 from SIMULATED
  console.log(`\n📊 TOP 10 (SIMULATED INDEX):`);
  console.log('  Rank  Program  Category  Blacklist  Filename');
  console.log('  ' + '-'.repeat(80));
  for (let i = 0; i < Math.min(10, simResults.length); i++) {
    const r = simResults[i];
    const marker = r.item.id === TARGET_CHUNK_ID ? ' ◄◄ TARGET' : '';
    const blStatus = r.isBlacklisted ? '⚠️  YES' : '   -';
    const prog = r.item.program || '?';
    const cat = r.item.category || '?';
    const fname = (r.item.filename || '').substring(0, 40);
    console.log(
      `  #${String(i + 1).padEnd(3)} ${String(prog).padEnd(9)} ${String(cat).padEnd(10)} ${blStatus}  ${fname}${marker}`
    );
  }

  // Double Degree analysis
  console.log(`\n🔍 DOUBLE DEGREE PRESENCE IN TOP 10:`);
  const origDD = origResults
    .slice(0, 10)
    .filter(r => /double\s+degree|dnui|help|utb|international/i.test(String(r.item.chunk)));
  const simDD = simResults
    .slice(0, 10)
    .filter(r => /double\s+degree|dnui|help|utb|international/i.test(String(r.item.chunk)));
  
  console.log(`  Original: ${origDD.length} chunks (${origDD.length > 0 ? 'PRESENT' : 'absent'})`);
  console.log(`  Simulated: ${simDD.length} chunks (${simDD.length > 0 ? 'PRESENT' : 'absent'})`);

  if (origDD.length > simDD.length) {
    console.log(`  → ✓ IMPROVEMENT: Double Degree interference reduced (${origDD.length} → ${simDD.length})`);
  } else if (simDD.length > origDD.length) {
    console.log(`  → ❌ REGRESSION: Double Degree increased (${origDD.length} → ${simDD.length})`);
  }

  // Blacklist filtering impact
  console.log(`\n🚫 BLACKLIST IMPACT IN TOP 10:`);
  const origBlacklisted = origResults.slice(0, 10).filter(r => r.isBlacklisted);
  const simBlacklisted = simResults.slice(0, 10).filter(r => r.isBlacklisted);
  
  console.log(`  Original: ${origBlacklisted.length} blacklisted chunks`);
  console.log(`  Simulated: ${simBlacklisted.length} blacklisted chunks`);
  
  if (origBlacklisted.length > simBlacklisted.length) {
    console.log(`  → Fewer blacklisted chunks in simulated (improvement)`);
  }
}

// ============================================================================
// SUMMARY
// ============================================================================

console.log('\n\n' + '='.repeat(90));
console.log('SIMULATION COMPLETE - SUMMARY');
console.log('='.repeat(90));

console.log(`
Changes made:
  - Chunk 6631dfc1: category "SK" → "KURIKULUM"
  - All other chunks: unchanged

For each query, results show:
  ✓ Target chunk ranking improvement/degradation
  ✓ Whether chunk is still blacklisted
  ✓ Double Degree interference before/after
  ✓ Top 10 comparison

⚠️  NOTE: This is a SIMULATION using simplified scoring.
    Real retrieval would use actual embeddings from production index.

NEXT ACTION:
  If chunk 6631dfc1 ranking IMPROVES after metadata fix → Continue with fix
  If chunk STILL blacklisted after fix → Must fix blacklist rules (not metadata)
`);

console.log('\n');
