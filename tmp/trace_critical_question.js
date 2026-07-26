const { querySemanticRag } = require('../src/engine/semanticRagEngine');

const criticalQuestion = "kalau mahasiswa ingin meningkatkan kemampuan bahasanya, apakah stikom mempunyai fasilitas untuk itu ya?";

async function traceCriticalQuestion() {
  console.log('='.repeat(80));
  console.log('TRACING CRITICAL LANGUAGE-FACILITY QUESTION');
  console.log('='.repeat(80));
  console.log('Question:', criticalQuestion);
  console.log('');
  
  try {
    const result = await querySemanticRag(criticalQuestion, {});
    
    console.log('RESULT:');
    console.log('-'.repeat(80));
    console.log('Success:', result.success);
    console.log('Source:', result.source);
    console.log('Answer:', result.answer ? result.answer.substring(0, 500) : 'null');
    console.log('Confidence Score:', result.confidenceScore);
    console.log('Confidence Tier:', result.confidenceTier);
    console.log('');
    
    if (result.contexts && result.contexts.length > 0) {
      console.log('CONTEXTS USED:');
      console.log('-'.repeat(80));
      result.contexts.forEach((ctx, idx) => {
        console.log(`\nContext #${idx + 1}:`);
        console.log('Score:', ctx.score);
        console.log('Source:', ctx.source || ctx.filename);
        console.log('Content preview:', ctx.text ? ctx.text.substring(0, 300) : ctx.chunk.substring(0, 300));
        
        // Check for legal markers
        const content = ctx.text || ctx.chunk;
        const hasPasal = /\bPasal\b/i.test(content);
        const hasPihak = /\bPIHAK\s+(?:KESATU|KEDUA)\b/i.test(content);
        const hasForceMajeure = /\bFORCE\s+MAJEURE\b/i.test(content);
        const hasAddendum = /\bADDENDUM\b/i.test(content);
        
        if (hasPasal || hasPihak || hasForceMajeure || hasAddendum) {
          console.log('⚠️  LEGAL MARKERS DETECTED:');
          if (hasPasal) console.log('   - Pasal');
          if (hasPihak) console.log('   - PIHAK KESATU/KEDUA');
          if (hasForceMajeure) console.log('   - Force Majeure');
          if (hasAddendum) console.log('   - Addendum');
        }
      });
    }
    
    if (result.debug) {
      console.log('\nDEBUG INFO:');
      console.log('-'.repeat(80));
      console.log(JSON.stringify(result.debug, null, 2));
    }
    
    // Check final answer for legal markers
    if (result.answer) {
      console.log('\nFINAL ANSWER LEGAL MARKER CHECK:');
      console.log('-'.repeat(80));
      const hasPasal = /\bPasal\b/i.test(result.answer);
      const hasPihak = /\bPIHAK\s+(?:KESATU|KEDUA)\b/i.test(result.answer);
      const hasForceMajeure = /\bFORCE\s+MAJEURE\b/i.test(result.answer);
      const hasAddendum = /\bADDENDUM\b/i.test(result.answer);
      const hasParaPihak = /\bPARA\s+PIHAK\b/i.test(result.answer);
      
      if (hasPasal || hasPihak || hasForceMajeure || hasAddendum || hasParaPihak) {
        console.log('⚠️  LEGAL MARKERS FOUND IN FINAL ANSWER:');
        if (hasPasal) console.log('   - Pasal');
        if (hasPihak) console.log('   - PIHAK KESATU/KEDUA');
        if (hasForceMajeure) console.log('   - Force Majeure');
        if (hasAddendum) console.log('   - Addendum');
        if (hasParaPihak) console.log('   - PARA PIHAK');
        console.log('\n⚠️  DOCUMENT LEAK CONFIRMED');
      } else {
        console.log('✓ No legal markers in final answer');
      }
    }
    
  } catch (error) {
    console.error('ERROR:', error);
  }
}

traceCriticalQuestion().then(() => {
  console.log('\n' + '='.repeat(80));
  console.log('TRACE COMPLETE');
  console.log('='.repeat(80));
  process.exit(0);
}).catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
