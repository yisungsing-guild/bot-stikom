const ragEngine = require('./src/engine/ragEngine');
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('data/rag_index.json', 'utf8'));
const query = 'berapa biaya SI gelombang 1A';
const queryEntities = { intent: 'COST', academicIntent: 'BIAYA', program: 'SI', wave: '1A' };
const result = ragEngine.tryStructuredExactCostAnswer(query, queryEntities, data, 3, null);
console.log('--- QUERY ---');
console.log(query);
console.log('--- QUERY ENTITIES ---');
console.log(JSON.stringify(queryEntities, null, 2));
console.log('--- RESULT SUMMARY ---');
console.log(JSON.stringify({ success: result && result.success, source: result && result.source, confidenceTier: result && result.confidenceTier, confidenceScore: result && result.confidenceScore }, null, 2));
console.log('--- CONTEXT CHUNKS ---');
if (Array.isArray(result && result.contexts)) {
  result.contexts.forEach((ctx, idx) => {
    console.log(`CONTEXT ${idx+1}`);
    console.log(JSON.stringify({ id: ctx.id, filename: ctx.filename, program: ctx.program, wave: ctx.wave, academicYear: ctx.academicYear, partner: ctx.partner, isGlobalDiscount: ragEngine.isGlobalWaveDiscountChunk ? ragEngine.isGlobalWaveDiscountChunk(ctx.chunk) : null }, null, 2));
    console.log('chunk preview:', String(ctx.chunk || '').substring(0, 280).replace(/\n/g, ' '));
  });
}
console.log('--- ANSWER ---');
console.log(result && result.answer);
console.log('--- DEBUG ---');
console.log(JSON.stringify(result && result.debug, null, 2));
