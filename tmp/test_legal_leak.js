const { retrieveSemanticContexts, selectEvidenceByCompatibility, evaluateGenericAnswerability, detectGenericIntent } = require('../src/engine/semanticRagEngine');

// Test questions that might bypass deterministic handlers but ask about similar topics
const testQuestions = [
  "apakah ada program untuk belajar bahasa inggris?",
  "tempat latihan bahasa asing di kampus",
  "layanan bahasa untuk mahasiswa",
  "fasilitas penunjang kemampuan bahasa"
];

async function testLegalLeak() {
  console.log('='.repeat(80));
  console.log('TESTING FOR LEGAL DOCUMENT LEAK IN RAG PATH');
  console.log('='.repeat(80));
  
  for (const question of testQuestions) {
    console.log('\n' + '='.repeat(80));
    console.log(`Question: "${question}"`);
    console.log('='.repeat(80));
    
    try {
      const questionIntent = detectGenericIntent(question);
      console.log('Intent:', questionIntent);
      
      // Generate search queries based on the question
      const searchQueries = [
        question,
        question.replace(/\b(apakah|ada|untuk|yang)\b/gi, '').trim(),
        'program bahasa',
        'fasilitas bahasa'
      ];
      
      const retrieved = await retrieveSemanticContexts(searchQueries, { 
        topK: 8, 
        question, 
        intent: questionIntent 
      });
      
      console.log(`Retrieved ${retrieved.contexts.length} contexts`);
      
      // Check for legal markers in retrieved contexts
      let hasLegalMarkers = false;
      retrieved.contexts.forEach((ctx, idx) => {
        const hasPasal = /\bPasal\b/i.test(ctx.chunk);
        const hasPihak = /\bPIHAK\s+(?:KESATU|KEDUA)\b/i.test(ctx.chunk);
        const hasForceMajeure = /\bFORCE\s+MAJEURE\b/i.test(ctx.chunk);
        const hasAddendum = /\bADDENDUM\b/i.test(ctx.chunk);
        const hasParaPihak = /\bPARA\s+PIHAK\b/i.test(ctx.chunk);
        const hasPerjanjian = /\bPERJANJIAN\s+KERJA\s*SAMA\b/i.test(ctx.chunk);
        
        if (hasPasal || hasPihak || hasForceMajeure || hasAddendum || hasParaPihak || hasPerjanjian) {
          hasLegalMarkers = true;
          console.log(`⚠️  Context #${idx + 1} has LEGAL MARKERS: ${ctx.filename}`);
          console.log(`   Score: ${ctx.score}`);
          console.log(`   Preview: ${ctx.chunk.substring(0, 200)}`);
        }
      });
      
      if (hasLegalMarkers) {
        console.log('⚠️  LEGAL DOCUMENT LEAK DETECTED');
      } else {
        console.log('✓ No legal markers in retrieved contexts');
      }
      
    } catch (error) {
      console.error('ERROR:', error.message);
    }
  }
}

testLegalLeak().then(() => {
  console.log('\n' + '='.repeat(80));
  console.log('TEST COMPLETE');
  console.log('='.repeat(80));
  process.exit(0);
}).catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
