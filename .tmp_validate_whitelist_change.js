#!/usr/bin/env node

/**
 * VALIDATION SCRIPT: Simulate adding KURIKULUM to DEFINISI_PRODI whitelist
 * 
 * Purpose: Before applying patch, validate impact on:
 * 1. SI chunk retrieval improvement
 * 2. Double Degree ranking change
 * 3. Side effects on other queries
 * 4. Potential precision regression
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// HELPER: Get allowed categories (SIMULATED with and without KURIKULUM)
// ============================================================================

function getAllowedAcademicCategoriesOriginal(intent) {
  const allowedCategoriesByIntent = {
    'DEFINISI_PRODI': ['PROGRAM_STUDI', 'INFO'],
    'FOKUS_PRODI': ['KURIKULUM', 'PROGRAM_STUDI'],
    'MATA_KULIAH': ['KURIKULUM', 'PROGRAM_STUDI'],
    'PROSPEK_KERJA': ['KARIR', 'PROGRAM_STUDI'],
    'KURIKULUM_PEMBELAJARAN': ['KURIKULUM', 'PROGRAM_STUDI'],
    'GENERAL': ['PROGRAM_STUDI', 'INFO', 'KARIR', 'KURIKULUM'],
  };
  return new Set(allowedCategoriesByIntent[intent] || []);
}

function getAllowedAcademicCategoriesPatched(intent) {
  const allowedCategoriesByIntent = {
    'DEFINISI_PRODI': ['PROGRAM_STUDI', 'INFO', 'KURIKULUM'],  // ← ADDED KURIKULUM
    'FOKUS_PRODI': ['KURIKULUM', 'PROGRAM_STUDI'],
    'MATA_KULIAH': ['KURIKULUM', 'PROGRAM_STUDI'],
    'PROSPEK_KERJA': ['KARIR', 'PROGRAM_STUDI'],
    'KURIKULUM_PEMBELAJARAN': ['KURIKULUM', 'PROGRAM_STUDI'],
    'GENERAL': ['PROGRAM_STUDI', 'INFO', 'KARIR', 'KURIKULUM'],
  };
  return new Set(allowedCategoriesByIntent[intent] || []);
}

function getAcademicIntentEvidenceRegex(intent) {
  const regexByIntent = {
    'DEFINISI_PRODI': /\b(apa\s+itu|apa\s+yang\s+dimaksud|pengertian|definisi|mengenai|penjelasan|istilah|profil\s+lulusan|tujuan|visi|misi|capaian\s+pembelajaran|deskripsi)\b/i,
    'FOKUS_PRODI': /\b(fokus|keahlian|spesialisasi|konsentrasi|bidang\s+studi|track|minat|peminatan|kedalaman|specializat)\b/i,
    'MATA_KULIAH': /\b(mata\s+kuliah|matakuliah|course|kursus|matkul|mk\s|dikaji|dibahas|materi|topik|pembelajaran|kurikulum)\b/i,
    'PROSPEK_KERJA': /\b(prospek\s+kerja|peluang\s+kerja|karir|profesi|pekerjaan|lulusan|lowongan|job|gaji|pasar\s+kerja)\b/i,
    'KURIKULUM_PEMBELAJARAN': /\b(mata\s+kuliah|matakuliah|kurikulum|course|pembelajaran|struktur\s+kurikulum|rencana\s+studi|didapat|diajari|yang\s+dipelajari)\b/i,
  };
  return regexByIntent[intent] || null;
}

// ============================================================================
// HELPER: Simulate chunkMatchesAcademicIntent with different whitelist
// ============================================================================

function chunkMatchesAcademicIntentSimulated(chunk, item, academicIntent, usePatched = false) {
  const category = item.docCategory || 'UNKNOWN';
  const text = (chunk || '').toLowerCase();
  
  const getAllowed = usePatched ? getAllowedAcademicCategoriesPatched : getAllowedAcademicCategoriesOriginal;
  const allowedCategories = getAllowed(academicIntent);
  
  // Condition 1: Category check
  if (allowedCategories.has(category)) {
    return { passed: true, reason: `Category '${category}' in allowed set for ${academicIntent}` };
  }
  
  // Condition 2: Evidence regex check
  const regex = getAcademicIntentEvidenceRegex(academicIntent);
  if (regex && regex.test(text)) {
    return { passed: true, reason: `Evidence regex matched for ${academicIntent}` };
  }
  
  // Condition 3: Fallback (program mention + academic patterns)
  const program = item.program || '';
  const hasProgram = /\b(program\s+studi|prodi|sistem\s+informasi|si\b|teknologi\s+informasi|ti\b|bisnis\s+digital|bd\b|sistem\s+komputer|sk\b)\b/i.test(text);
  const hasAcademicPatterns = /\b(mahasiswa|lulusan|pembelajaran|pendidikan|kompetensi|skill|kemampuan|capaian|tujuan)\b/i.test(text);
  if (program && hasProgram && hasAcademicPatterns) {
    return { passed: true, reason: 'Fallback: program mentioned + academic content' };
  }
  
  return { passed: false, reason: `All conditions failed for ${academicIntent}` };
}

// ============================================================================
// SIMULATION LOGIC
// ============================================================================

async function simulateWhitelistChange() {
  try {
    console.log('========================================================================================================================');
    console.log('VALIDATION AUDIT: DEFINISI_PRODI Whitelist Change Simulation');
    console.log('========================================================================================================================\n');
    
    // Load audit results from previous run
    const auditPath = path.join(__dirname, '.tmp_retrieval_results.json');
    if (!fs.existsSync(auditPath)) {
      console.error('ERROR: .tmp_retrieval_results.json not found. Run .tmp_retrieval_audit_2026.js first.\n');
      process.exit(1);
    }
    
    const auditData = JSON.parse(fs.readFileSync(auditPath, 'utf-8'));
    const indexPath = path.join(__dirname, 'src', 'data', 'rag_index.json');
    const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    const indexMap = new Map(indexData.map(item => [item.id, item]));
    
    // ====================================================================
    // PHASE 1: Analyze current state (ORIGINAL whitelist)
    // ====================================================================
    console.log('[PHASE 1] Current State Analysis (ORIGINAL whitelist)\n');
    
    const queryIntentMap = {
      'Apa itu Sistem Informasi?': 'DEFINISI_PRODI',
      'Apa prospek kerja Sistem Informasi?': 'PROSPEK_KERJA',
      'Apa yang dipelajari di Sistem Informasi?': 'KURIKULUM_PEMBELAJARAN',
      'Apa keunggulan Sistem Informasi?': 'GENERAL'
    };
    
    const results = {
      queries: [],
      summary: {
        totalSIChunksBecomingEligible: 0,
        totalNonSIKurikulumChunksAtRisk: 0,
        intentsAffected: new Set(),
        doubleDegreeImpact: {}
      }
    };
    
    // Process Query 1 (DEFINISI_PRODI) - This is the one affected by the patch
    const auditQ1 = auditData[0];
    const queryText = auditQ1.question;
    const intent = queryIntentMap[queryText];
    
    console.log(`QUERY 1: "${queryText}"`);
    console.log(`Intent: ${intent}\n`);
    
    const queryResult = {
      queryIndex: 1,
      question: queryText,
      intent: intent,
      top20Detailed: [],
      statusChanges: [],
      currentWinner: null,
      newWinner: null
    };
    
    // Get top 20 from audit - top20 is array of {item, score, compositeScore, etc}
    const top20 = (auditQ1.top20 || []).slice(0, 20);
    
    console.log(`Top 20 chunks (BEFORE any filter):`);
    console.log(`  Total in top 20: ${top20.length}\n`);
    
    // Get the currently passing chunks
    const currentlyPassing = auditQ1.relevantIds || [];
    console.log(`Currently passing filterRelevantChunks(): ${currentlyPassing.length}`);
    currentlyPassing.slice(0, 3).forEach(r => {
      console.log(`  - ${r.filename || r.id} (composite: ${r.compositeScore})`);
    });
    console.log('');
    
    // Analyze each chunk in top 20
    let siChunksBecomingEligible = 0;
    let nonSIKurikulumAtRisk = [];
    
    for (let rank = 0; rank < top20.length; rank++) {
      const scoredItem = top20[rank];
      const item = scoredItem.item || {};
      const chunkId = item.id;
      const chunk = item.chunk || '';
      
      if (!indexMap.has(chunkId)) {
        console.warn(`WARNING: Chunk ${chunkId} not found in index`);
        continue;
      }
      
      const isCurrentlyPassing = currentlyPassing.some(r => r.id === chunkId);
      const isDD = item.program && /double\s+degree/i.test(item.filename || '');
      const isSI = item.program === 'SI';
      const isKurikulum = item.docCategory === 'KURIKULUM';
      
      // Simulate with ORIGINAL whitelist
      const resultBefore = chunkMatchesAcademicIntentSimulated(chunk, item, intent, false);
      
      // Simulate with PATCHED whitelist
      const resultAfter = chunkMatchesAcademicIntentSimulated(chunk, item, intent, true);
      
      const statusBefore = resultBefore.passed ? 'PASS' : 'REJECT';
      const statusAfter = resultAfter.passed ? 'PASS' : 'REJECT';
      const statusChanged = statusBefore !== statusAfter;
      
      // Track metrics
      if (isSI && statusBefore === 'REJECT' && statusAfter === 'PASS') {
        siChunksBecomingEligible++;
      }
      if (!isSI && isKurikulum && statusAfter === 'PASS' && statusBefore === 'REJECT') {
        nonSIKurikulumAtRisk.push({
          rank: rank + 1,
          id: chunkId,
          program: item.program,
          category: item.docCategory,
          filename: item.filename,
          reason: resultAfter.reason
        });
      }
      
      // Record detailed info
      if (rank <= 2 || statusChanged) {
        queryResult.top20Detailed.push({
          rank: rank + 1,
          id: chunkId,
          category: item.docCategory,
          program: item.program,
          isDD,
          isSI,
          currentlyPassing: isCurrentlyPassing,
          statusBefore,
          statusAfter,
          reasonBefore: resultBefore.reason,
          reasonAfter: resultAfter.reason,
          changed: statusChanged
        });
      }
      
      if (statusChanged) {
        queryResult.statusChanges.push({
          rank: rank + 1,
          id: chunkId,
          program: item.program,
          from: statusBefore,
          to: statusAfter,
          reason: resultAfter.reason
        });
      }
      
      // Track current and new winner
      if (isCurrentlyPassing && !queryResult.currentWinner) {
        queryResult.currentWinner = { rank: rank + 1, id: chunkId, program: item.program, filename: item.filename };
      }
      if (statusAfter === 'PASS' && statusBefore === 'REJECT' && !queryResult.newWinner) {
        queryResult.newWinner = { rank: rank + 1, id: chunkId, program: item.program, filename: item.filename };
      }
    }
    
    console.log(`[SIMULATION RESULTS]\n`);
    console.log(`SI chunks that become eligible: ${siChunksBecomingEligible}`);
    console.log(`Non-SI KURIKULUM chunks at risk: ${nonSIKurikulumAtRisk.length}\n`);
    
    results.summary.totalSIChunksBecomingEligible += siChunksBecomingEligible;
    results.summary.totalNonSIKurikulumChunksAtRisk += nonSIKurikulumAtRisk.length;
    results.summary.intentsAffected.add(intent);
    
    // ====================================================================
    // RANKING ANALYSIS
    // ====================================================================
    console.log(`[RANKING ANALYSIS]\n`);
    
    console.log(`Current winner (ORIGINAL whitelist):`);
    if (queryResult.currentWinner) {
      console.log(`  Rank: #${queryResult.currentWinner.rank}`);
      console.log(`  Program: ${queryResult.currentWinner.program}`);
      console.log(`  File: ${queryResult.currentWinner.filename}`);
    } else {
      console.log(`  (none passed filter)`);
    }
    
    console.log(`\nFirst SI chunk that becomes eligible (PATCHED whitelist):`);
    if (queryResult.newWinner) {
      console.log(`  Rank: #${queryResult.newWinner.rank}`);
      console.log(`  Program: ${queryResult.newWinner.program}`);
      console.log(`  File: ${queryResult.newWinner.filename}`);
      console.log(`  Status change: REJECTED → PASSED ✓`);
    } else {
      console.log(`  (none would become eligible)`);
    }
    
    // Show top 3 status before and after
    console.log(`\n[TOP 3 CHUNK ANALYSIS]\n`);
    for (let i = 0; i < Math.min(3, top20.length); i++) {
      const item = top20[i].item || {};
      const idx = queryResult.top20Detailed.findIndex(x => x.rank === i + 1);
      const det = idx >= 0 ? queryResult.top20Detailed[idx] : null;
      
      console.log(`Rank #${i + 1}:`);
      console.log(`  ID: ${item.id}`);
      console.log(`  Program: ${item.program}, Category: ${item.docCategory}`);
      if (det) {
        console.log(`  Status BEFORE: ${det.statusBefore}`);
        console.log(`  Status AFTER:  ${det.statusAfter}`);
        if (det.changed) console.log(`  ⚠ STATUS CHANGED!`);
      }
      console.log('');
    }
    
    // ====================================================================
    // SIDE EFFECTS ANALYSIS
    // ====================================================================
    console.log(`[SIDE EFFECTS ANALYSIS]\n`);
    
    if (nonSIKurikulumAtRisk.length > 0) {
      console.log(`⚠ Non-SI KURIKULUM chunks that would become eligible:\n`);
      nonSIKurikulumAtRisk.forEach(r => {
        console.log(`  Rank #${r.rank}: Program ${r.program}`);
        console.log(`    File: ${r.filename}`);
        console.log(`    Reason: ${r.reason}`);
        console.log('');
      });
    } else {
      console.log(`✓ No non-SI KURIKULUM chunks at risk\n`);
    }
    
    // ====================================================================
    // RECOMMENDATIONS
    // ====================================================================
    console.log(`${'='.repeat(100)}`);
    console.log('RECOMMENDATIONS');
    console.log(`${'='.repeat(100)}\n`);
    
    if (siChunksBecomingEligible > 0 && nonSIKurikulumAtRisk.length === 0) {
      console.log(`🟢 VERDICT: SAFE TO PATCH`);
      console.log(`\nReason:`);
      console.log(`  ✓ ${siChunksBecomingEligible} SI chunk(s) will become eligible`);
      console.log(`  ✓ 0 false positives detected`);
      console.log(`\nAction: Apply the patch to add KURIKULUM to DEFINISI_PRODI allowed categories\n`);
    } else if (siChunksBecomingEligible > 0 && nonSIKurikulumAtRisk.length > 0) {
      console.log(`🟡 VERDICT: PATCH WITH MONITORING`);
      console.log(`\nReason:`);
      console.log(`  ✓ ${siChunksBecomingEligible} SI chunk(s) will become eligible`);
      console.log(`  ⚠ ${nonSIKurikulumAtRisk.length} false positive risk(s) detected`);
      console.log(`\nAction: Apply patch but monitor for precision degradation\n`);
    } else {
      console.log(`🔴 VERDICT: DO NOT PATCH`);
      console.log(`\nReason: No improvement detected\n`);
    }
    
    console.log(`Other Options:`);
    console.log(`  Option B: Improve evidence regex - add program definition keywords`);
    console.log(`  Option C: Add metadata-aware fallback - accept if program=SI + contains "program studi"\n`);
    
    results.queries.push(queryResult);
    
    // ====================================================================
    // Save detailed results
    // ====================================================================
    const outputPath = path.join(__dirname, '.tmp_validation_results.json');
    fs.writeFileSync(outputPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      summary: {
        totalSIChunksBecomingEligible: results.summary.totalSIChunksBecomingEligible,
        nonSIKurikulumChunksAtRisk: results.summary.totalNonSIKurikulumChunksAtRisk,
        verdict: siChunksBecomingEligible > 0 && nonSIKurikulumAtRisk.length === 0 ? 'SAFE' 
               : siChunksBecomingEligible > 0 ? 'CAUTION' 
               : 'DONT_PATCH'
      },
      queryAnalysis: {
        query1: {
          siChunksBecomingEligible,
          nonSIKurikulumAtRisk,
          currentWinner: queryResult.currentWinner,
          newWinner: queryResult.newWinner,
          statusChanges: queryResult.statusChanges
        }
      }
    }, null, 2), 'utf-8');
    
    console.log(`\n[OUTPUT] Detailed results saved to: .tmp_validation_results.json`);
    
  } catch (error) {
    console.error('ERROR:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// ============================================================================
// RUN
// ============================================================================
simulateWhitelistChange().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
