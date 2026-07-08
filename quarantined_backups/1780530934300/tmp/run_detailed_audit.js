const rag = require('../src/engine/ragEngine.js');
const fs = require('fs');
const path = require('path');

const queries = [
  'Apa itu Sistem Informasi',
  'Apa itu Teknologi Informasi',
  'Prospek kerja Sistem Informasi',
  'Prospek kerja Teknologi Informasi',
  'Apakah ada program double degree internasional',
  'Berapa biaya pendaftaran'
];

async function runDetailedAudit() {
  const results = [];

  for (const query of queries) {
    console.log(`\n${'='.repeat(100)}`);
    console.log(`QUERY: "${query}"`);
    console.log('='.repeat(100));

    try {
      // Enable debug and set low minScore to get more candidates through scoring
      process.env.RAG_DEBUG_INTENT_FILTERING = 'true';
      const response = await rag.query(query, 40, { 
        returnDebug: true,
        minScore: 0.0
      });

      const {
        answer = '',
        contexts = [],
        debug = {},
        source = ''
      } = response;

      console.log(`\nAnswer source: ${source}`);
      console.log(`Total contexts returned: ${contexts.length}`);
      
      // Extract chunks from debug.validatedScored or fallback to contexts
      let chunks = [];
      if (debug && debug.validatedScored && Array.isArray(debug.validatedScored)) {
        chunks = debug.validatedScored;
        console.log(`Found ${chunks.length} validated chunks in debug`);
      } else if (Array.isArray(contexts) && contexts.length > 0) {
        chunks = contexts.map(c => ({
          id: c.id || 'N/A',
          filename: c.filename || 'N/A',
          docCategory: c.docCategory || c.category || 'UNKNOWN',
          text: c.chunk || c.text || c || '',
          score: c.score || 0,
          compositeScore: c.compositeScore || 0,
          semanticScore: c.semanticScore || 0,
          attributeScore: c.attributeScore || 0,
          metadataBoost: c.metadataBoost || 0,
          evidenceConfidence: c.evidenceConfidence || 'N/A'
        }));
        console.log(`Using ${chunks.length} contexts as fallback chunks`);
      }

      // Sort by composite or main score and take top 10
      const sorted = chunks.sort((a, b) => {
        const scoreA = a.compositeScore || a.score || 0;
        const scoreB = b.compositeScore || b.score || 0;
        return scoreB - scoreA;
      });
      const top10 = sorted.slice(0, 10);

      console.log(`\nTop 10 Chunks (${top10.length} available):`);
      console.log('-'.repeat(100));

      if (top10.length === 0) {
        console.log('(No chunks available)');
      } else {
        top10.forEach((chunk, idx) => {
          const scoreComponents = chunk.scoreComponents || {};
          console.log(`\n${idx + 1}. RANK #${idx + 1}`);
          console.log(`   ID: ${chunk.id}`);
          console.log(`   File: ${chunk.filename}`);
          console.log(`   Category: ${chunk.docCategory}`);
          console.log(`   Final Score: ${(chunk.compositeScore || chunk.score || 0).toFixed(4)}`);
          console.log(`   Semantic: ${(chunk.semanticScore || 0).toFixed(4)} | Attribute: ${(chunk.attributeScore || 0).toFixed(4)} | Metadata: ${(chunk.metadataBoost || 0).toFixed(4)}`);
          console.log(`   Breakdown: semantic=${(scoreComponents.semantic || 0).toFixed(4)}, keyword=${(scoreComponents.keyword || 0).toFixed(4)}, exactBoost=${(scoreComponents.exactBoost || 0).toFixed(4)}, categorySignal=${(scoreComponents.categorySignal || 0).toFixed(4)}, trustBoost=${(scoreComponents.trustBoost || 0).toFixed(4)}, feePenalty=${(scoreComponents.feeKeywordPenalty || 0).toFixed(4)}, overviewPenalty=${(scoreComponents.programOverviewPenalty || 0).toFixed(4)}, multiProgramPenalty=${(scoreComponents.multiProgramPenalty || 0).toFixed(4)}`);
          console.log(`   Evidence Confidence: ${chunk.evidenceConfidence}`);
          
          const textPreview = (chunk.text || '').substring(0, 120).replace(/\n/g, ' ').trim();
          console.log(`   Preview: "${textPreview}..."`);
        });
      }

      results.push({
        query,
        source,
        contextsCount: contexts.length,
        chunksProcessed: chunks.length,
        top10: top10.map((c, idx) => ({
          rank: idx + 1,
          id: c.id,
          filename: c.filename,
          docCategory: c.docCategory,
          finalScore: parseFloat((c.compositeScore || c.score || 0).toFixed(4)),
          semanticScore: parseFloat((c.semanticScore || 0).toFixed(4)),
          attributeScore: parseFloat((c.attributeScore || 0).toFixed(4)),
          metadataBoost: parseFloat((c.metadataBoost || 0).toFixed(4)),
          scoreComponents: c.scoreComponents || null,
          evidenceConfidence: c.evidenceConfidence,
          textPreview: (c.text || '').substring(0, 200)
        }))
      });

    } catch (err) {
      console.error(`ERROR processing query "${query}":`, err.message);
      results.push({
        query,
        error: err.message
      });
    }
  }

  // Save detailed results to JSON
  const outputPath = path.join(__dirname, 'detailed_audit_results.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\n${'='.repeat(100)}`);
  console.log(`Detailed audit results saved to: ${outputPath}`);
}

runDetailedAudit().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
