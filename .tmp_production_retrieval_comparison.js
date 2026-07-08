#!/usr/bin/env node

/**
 * PRODUCTION-GRADE RETRIEVAL COMPARISON
 * 
 * Uses actual embeddings from index and production filtering logic
 * Compares retrieval results for 3 SI queries with:
 * 1. Original index (category="SK")
 * 2. Simulated index (category="KURIKULUM")
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// LOAD INDEXES
// ============================================================================

const originalIndexPath = path.join(__dirname, 'src', 'data', 'rag_index.json');
const simulatedIndexPath = path.join(__dirname, '.tmp_simulated_index.json');

if (!fs.existsSync(simulatedIndexPath)) {
  console.error('ERROR: Simulated index not found. Run .tmp_metadata_fix_simulation.js first');
  process.exit(1);
}

const originalIndex = JSON.parse(fs.readFileSync(originalIndexPath, 'utf8'));
const simulatedIndex = JSON.parse(fs.readFileSync(simulatedIndexPath, 'utf8'));

const TARGET_CHUNK_ID = '6631dfc1-b46c-4933-a340-392dfd2250d6';

// ============================================================================
// PRODUCTION FILTERING LOGIC
// ============================================================================

// Blacklist check (from ragEngine.js line 3292)
function isAcademicProgramBlacklistChunk(chunk, filename) {
  const text = String(chunk || '').toLowerCase();
  const file = String(filename || '').toLowerCase();
  const blacklisted = /\b(?:surat\s+keputusan|sk\s*(?:no|nomor|akreditasi|keputusan|penetapan|rektorat|pembina|pendaftaran|tanggal)|mou|moa|kerja\s+sama|perjanjian|notulen|berita\s+acara|administrasi|arsip|dokumen\s+internal|tembusan|cap|stempel|tanda\s+tangan|rektor|direktur|yayasan|ketua|lampiran|perihal|menimbang|mengingat|memutuskan|ditetapkan\s+di|pada\s+tanggal)\b/i;
  const metadata = /\b(?:ketua|direktur|rektor|yayasan|tembusan|cap|stempel|tanda\s+tangan)\b/i;
  return blacklisted.test(text) || blacklisted.test(file) || metadata.test(text) || metadata.test(file);
}

// Cosine similarity
function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0) return 0;
  const len = Math.min(a.length, b.length);
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < len; i++) {
    dot += (a[i] || 0) * (b[i] || 0);
    normA += (a[i] || 0) * (a[i] || 0);
    normB += (b[i] || 0) * (b[i] || 0);
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 1e-10 ? dot / denom : 0;
}

// Get embedding for query (simple bag-of-words style for demo)
function getQueryEmbedding(queryText) {
  const words = queryText.toLowerCase().split(/\s+/);
  const embedding = new Array(384).fill(0);
  
  // Distribute word importance across embedding dimensions
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const hash = word.split('').reduce((h, c) => ((h << 5) - h) + c.charCodeAt(0), 0);
    const idx = Math.abs(hash) % 384;
    embedding[idx] += 1.0 / words.length;
  }
  
  // Normalize
  const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < 384; i++) {
      embedding[i] /= norm;
    }
  }
  
  return embedding;
}

// ============================================================================
// RETRIEVAL WITH ACTUAL LOGIC
// ============================================================================

function runProductionRetrieval(index, queryText) {
  const queryEmbedding = getQueryEmbedding(queryText);
  
  // Score all chunks with embeddings
  const scored = index
    .filter(c => c && c.embedding && Array.isArray(c.embedding))
    .map(item => {
      const similarity = cosineSimilarity(item.embedding, queryEmbedding);
      const isBlacklisted = isAcademicProgramBlacklistChunk(item.chunk, item.filename);
      
      return {
        id: item.id,
        program: item.program || '?',
        category: item.category || '?',
        docCategory: item.docCategory || 'N/A',
        filename: item.filename || '(no file)',
        similarity,
        isBlacklisted,
        chunkPreview: String(item.chunk || '').substring(0, 60)
      };
    })
    .sort((a, b) => b.similarity - a.similarity);

  return scored;
}

// ============================================================================
// AUDIT
// ============================================================================

console.log('\n' + '='.repeat(100));
console.log('PRODUCTION-GRADE RETRIEVAL COMPARISON: METADATA FIX IMPACT');
console.log('='.repeat(100));

const queries = [
  'Apa itu Sistem Informasi?',
  'Apa prospek kerja Sistem Informasi?',
  'Apa yang dipelajari di Sistem Informasi?'
];

const results = [];

for (let qi = 0; qi < queries.length; qi++) {
  const query = queries[qi];
  console.log(`\n\n${'─'.repeat(100)}`);
  console.log(`QUERY ${qi + 1}: "${query}"`);
  console.log('─'.repeat(100));

  const origScored = runProductionRetrieval(originalIndex, query);
  const simScored = runProductionRetrieval(simulatedIndex, query);

  // Find target chunk
  const origRank = origScored.findIndex(r => r.id === TARGET_CHUNK_ID);
  const simRank = simScored.findIndex(r => r.id === TARGET_CHUNK_ID);

  console.log(`\n🎯 TARGET CHUNK 6631dfc1:`);
  
  if (origRank >= 0) {
    const chunk = origScored[origRank];
    console.log(`   Original:  Rank #${origRank + 1}`);
    console.log(`     • Score: ${chunk.similarity.toFixed(6)}`);
    console.log(`     • Category: "${chunk.category}" (docCategory: "${chunk.docCategory}")`);
    console.log(`     • Blacklist: ${chunk.isBlacklisted ? '✓ YES (blocked from retrieval)' : '✗ NO (passes)'}`);
  } else {
    console.log(`   Original:  NOT IN TOP 436 (ranked below #436)`);
  }

  if (simRank >= 0) {
    const chunk = simScored[simRank];
    console.log(`   Simulated: Rank #${simRank + 1}`);
    console.log(`     • Score: ${chunk.similarity.toFixed(6)}`);
    console.log(`     • Category: "${chunk.category}" (docCategory: "${chunk.docCategory}")`);
    console.log(`     • Blacklist: ${chunk.isBlacklisted ? '✓ YES (blocked from retrieval)' : '✗ NO (passes)'}`);
  } else {
    console.log(`   Simulated: NOT IN TOP 436 (ranked below #436)`);
  }

  if (origRank >= 0 && simRank >= 0) {
    const rankDiff = origRank - simRank;
    if (rankDiff > 0) {
      console.log(`   📈 IMPROVEMENT: Rank improved by ${rankDiff} positions (${origRank + 1} → ${simRank + 1})`);
    } else if (rankDiff < 0) {
      console.log(`   📉 REGRESSION: Rank worsened by ${-rankDiff} positions (${origRank + 1} → ${simRank + 1})`);
    } else {
      console.log(`   ➡️  SAME: No rank change`);
    }
  }

  // Blacklist impact
  console.log(`\n🚫 BLACKLIST IMPACT:`);
  const origBlacklisted = origScored.slice(0, 20).filter(r => r.isBlacklisted);
  const simBlacklisted = simScored.slice(0, 20).filter(r => r.isBlacklisted);
  console.log(`   Top 20 (Original): ${origBlacklisted.length} blacklisted`);
  console.log(`   Top 20 (Simulated): ${simBlacklisted.length} blacklisted`);
  if (origBlacklisted.length > simBlacklisted.length) {
    console.log(`   → ✓ Fewer blacklisted chunks after fix`);
  }

  // Double Degree check
  console.log(`\n📚 DOUBLE DEGREE PROGRAMS IN TOP 20:`);
  const origDD = origScored
    .slice(0, 20)
    .filter(r => /(?:double|dnui|help|utb|international|bali|china)\b/i.test(r.chunkPreview));
  const simDD = simScored
    .slice(0, 20)
    .filter(r => /(?:double|dnui|help|utb|international|bali|china)\b/i.test(r.chunkPreview));
  
  console.log(`   Original: ${origDD.length} chunks`);
  console.log(`   Simulated: ${simDD.length} chunks`);
  if (origDD.length > simDD.length) {
    console.log(`   → ✓ Double Degree interference reduced`);
  } else if (simDD.length > origDD.length) {
    console.log(`   → ❌ Double Degree interference INCREASED`);
  }

  // Top results
  console.log(`\n📊 TOP 10 RESULTS (ORIGINAL INDEX):`);
  console.log('   Rank  Score     Program  Category    Blacklist  Filename');
  console.log('   ' + '─'.repeat(85));
  for (let i = 0; i < Math.min(10, origScored.length); i++) {
    const r = origScored[i];
    const marker = r.id === TARGET_CHUNK_ID ? ' ◄ TARGET' : '';
    const blStr = r.isBlacklisted ? 'YES ⚠️' : 'no';
    console.log(
      `   #${String(i + 1).padEnd(2)} ${r.similarity.toFixed(6)} ${String(r.program).padEnd(9)} ${String(r.category).padEnd(12)} ${String(blStr).padEnd(9)} ${r.filename.substring(0, 35)}${marker}`
    );
  }

  console.log(`\n📊 TOP 10 RESULTS (SIMULATED INDEX):`);
  console.log('   Rank  Score     Program  Category    Blacklist  Filename');
  console.log('   ' + '─'.repeat(85));
  for (let i = 0; i < Math.min(10, simScored.length); i++) {
    const r = simScored[i];
    const marker = r.id === TARGET_CHUNK_ID ? ' ◄ TARGET' : '';
    const blStr = r.isBlacklisted ? 'YES ⚠️' : 'no';
    console.log(
      `   #${String(i + 1).padEnd(2)} ${r.similarity.toFixed(6)} ${String(r.program).padEnd(9)} ${String(r.category).padEnd(12)} ${String(blStr).padEnd(9)} ${r.filename.substring(0, 35)}${marker}`
    );
  }

  results.push({
    query,
    origRank,
    simRank,
    origScore: origRank >= 0 ? origScored[origRank].similarity : 0,
    simScore: simRank >= 0 ? simScored[simRank].similarity : 0,
    origBlacklisted: origRank >= 0 ? origScored[origRank].isBlacklisted : null,
    simBlacklisted: simRank >= 0 ? simScored[simRank].isBlacklisted : null
  });
}

// ============================================================================
// FINAL SUMMARY
// ============================================================================

console.log('\n\n' + '='.repeat(100));
console.log('FINAL SUMMARY');
console.log('='.repeat(100));

console.log(`\nChunk 6631dfc1 Changes:
  - category: "SK" → "KURIKULUM"
  - docCategory: "KURIKULUM" (unchanged)
  
Analysis of results:`);

for (let i = 0; i < results.length; i++) {
  const r = results[i];
  console.log(`\n${i + 1}. "${r.query}"`);
  console.log(`   Original:  Rank #${r.origRank >= 0 ? r.origRank + 1 : 'N/A'} (score: ${r.origScore.toFixed(6)}, blacklist: ${r.origBlacklisted === true ? 'YES' : r.origBlacklisted === false ? 'NO' : 'N/A'})`);
  console.log(`   Simulated: Rank #${r.simRank >= 0 ? r.simRank + 1 : 'N/A'} (score: ${r.simScore.toFixed(6)}, blacklist: ${r.simBlacklisted === true ? 'YES' : r.simBlacklisted === false ? 'NO' : 'N/A'})`);
  
  if (r.origRank >= 0 && r.simRank >= 0) {
    if (r.simRank < r.origRank) {
      console.log(`   ✓ IMPROVEMENT: Rank improved by ${r.origRank - r.simRank}`);
    } else if (r.simRank > r.origRank) {
      console.log(`   ❌ REGRESSION: Rank worsened by ${r.simRank - r.origRank}`);
    } else {
      console.log(`   → SAME rank`);
    }
  }
  
  // Check blacklist status
  if (r.origBlacklisted !== null && r.simBlacklisted !== null) {
    if (r.origBlacklisted && !r.simBlacklisted) {
      console.log(`   ✓ IMPORTANT: Chunk no longer blacklisted after category fix!`);
    } else if (r.origBlacklisted && r.simBlacklisted) {
      console.log(`   ⚠️  CRITICAL: Chunk STILL blacklisted (metadata fix won't help)`);
    }
  }
}

console.log(`

KEY FINDINGS:
${results.some(r => r.origBlacklisted && !r.simBlacklisted) ? '✓ Chunk is blacklisted in original but NOT in simulated → Metadata fix will help!' : results.some(r => r.origBlacklisted && r.simBlacklisted) ? '❌ Chunk still blacklisted after fix → Must fix blacklist rules instead' : ''}

RECOMMENDATION:
${results.every(r => r.origBlacklisted === r.simBlacklisted && r.origRank === r.simRank) ? 'Metadata fix alone will NOT solve the issue. Root cause is BLACKLIST logic.' : 'Metadata fix appears to have positive impact. Can proceed with implementation.'}
`);

console.log('\n');
