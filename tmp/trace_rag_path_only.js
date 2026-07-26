const { retrieveSemanticContexts, selectEvidenceByCompatibility, evaluateGenericAnswerability, detectGenericIntent } = require('../src/engine/semanticRagEngine');

const criticalQuestion = "kalau mahasiswa ingin meningkatkan kemampuan bahasanya, apakah stikom mempunyai fasilitas untuk itu ya?";

async function traceRagPathOnly() {
  console.log('='.repeat(80));
  console.log('TRACING RAG PATH ONLY (BYPASSING DETERMINISTIC HANDLERS)');
  console.log('='.repeat(80));
  console.log('Question:', criticalQuestion);
  console.log('');
  
  try {
    // Simulate the search queries that would be generated
    const searchQueries = [
      'fasilitas bahasa mahasiswa',
      'language learning center',
      'program bahasa asing',
      'kemampuan bahasa fasilitas'
    ];
    
    console.log('Search Queries:', searchQueries);
    console.log('');
    
    const questionIntent = detectGenericIntent(criticalQuestion);
    console.log('Detected Intent:', questionIntent);
    console.log('');
    
    // Retrieve contexts from RAG
    const retrieved = await retrieveSemanticContexts(searchQueries, { 
      topK: 8, 
      question: criticalQuestion, 
      intent: questionIntent 
    });
    
    console.log('RETRIEVED CONTEXTS:');
    console.log('-'.repeat(80));
    console.log(`Total contexts: ${retrieved.contexts.length}`);
    console.log(`Top score: ${retrieved.topScore}`);
    console.log(`Index size: ${retrieved.indexSize}`);
    console.log('');
    
    if (retrieved.contexts.length > 0) {
      retrieved.contexts.forEach((ctx, idx) => {
        console.log(`\nContext #${idx + 1}:`);
        console.log('Score:', ctx.score);
        console.log('Source:', ctx.filename || ctx.sourceFile);
        console.log('Content preview:', ctx.chunk.substring(0, 400));
        
        // Check for legal markers
        const hasPasal = /\bPasal\b/i.test(ctx.chunk);
        const hasPihak = /\bPIHAK\s+(?:KESATU|KEDUA)\b/i.test(ctx.chunk);
        const hasForceMajeure = /\bFORCE\s+MAJEURE\b/i.test(ctx.chunk);
        const hasAddendum = /\bADDENDUM\b/i.test(ctx.chunk);
        const hasParaPihak = /\bPARA\s+PIHAK\b/i.test(ctx.chunk);
        
        if (hasPasal || hasPihak || hasForceMajeure || hasAddendum || hasParaPihak) {
          console.log('⚠️  LEGAL MARKERS DETECTED:');
          if (hasPasal) console.log('   - Pasal');
          if (hasPihak) console.log('   - PIHAK KESATU/KEDUA');
          if (hasForceMajeure) console.log('   - Force Majeure');
          if (hasAddendum) console.log('   - Addendum');
          if (hasParaPihak) console.log('   - PARA PIHAK');
        }
      });
    }
    
    // Apply evidence selection
    console.log('\n' + '='.repeat(80));
    console.log('EVIDENCE SELECTION');
    console.log('='.repeat(80));
    
    const selectedEvidence = selectEvidenceByCompatibility(criticalQuestion, retrieved.contexts, { 
      intent: questionIntent, 
      maxEvidence: 5 
    });
    
    console.log(`Selected evidence units: ${selectedEvidence.length}`);
    console.log('');
    
    selectedEvidence.forEach((ev, idx) => {
      console.log(`Evidence #${idx + 1}:`);
      console.log('Score:', ev.score);
      console.log('Source:', ev.source);
      console.log('Reason:', ev.reason);
      console.log('Content preview:', ev.text.substring(0, 300));
      
      // Check for legal markers
      const hasPasal = /\bPasal\b/i.test(ev.text);
      const hasPihak = /\bPIHAK\s+(?:KESATU|KEDUA)\b/i.test(ev.text);
      const hasForceMajeure = /\bFORCE\s+MAJEURE\b/i.test(ev.text);
      const hasAddendum = /\bADDENDUM\b/i.test(ev.text);
      
      if (hasPasal || hasPihak || hasForceMajeure || hasAddendum) {
        console.log('⚠️  LEGAL MARKERS DETECTED IN EVIDENCE');
      }
    });
    
    // Evaluate answerability
    console.log('\n' + '='.repeat(80));
    console.log('ANSWERABILITY EVALUATION');
    console.log('='.repeat(80));
    
    const answerabilityResult = evaluateGenericAnswerability(criticalQuestion, selectedEvidence, { 
      intent: questionIntent 
    });
    
    console.log('Answerable:', answerabilityResult.answerable);
    console.log('Missing evidence:', answerabilityResult.missingEvidence);
    console.log('Reason:', answerabilityResult.reason);
    
  } catch (error) {
    console.error('ERROR:', error);
    console.error(error.stack);
  }
}

traceRagPathOnly().then(() => {
  console.log('\n' + '='.repeat(80));
  console.log('TRACE COMPLETE');
  console.log('='.repeat(80));
  process.exit(0);
}).catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
