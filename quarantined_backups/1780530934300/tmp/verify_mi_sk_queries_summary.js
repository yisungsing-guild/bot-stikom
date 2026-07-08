const results = require('../tmp/verify_mi_sk_queries.json');
results.forEach((item, i) => {
  console.log('--- QUERY', i + 1, item.query);
  if (item.error) {
    console.log('ERROR', item.error);
    return;
  }
  console.log('source', item.result.source);
  console.log('success', item.result.success);
  console.log('confidenceScore', item.result.confidenceScore);
  console.log('contexts', item.result.contexts.length);
  console.log('answer', item.result.answer.replace(/\n/g, ' ').slice(0, 200));
  console.log('TOP 10 CONTEXTS:');
  item.result.contexts.slice(0, 10).forEach((ctx, j) => {
    console.log(`${j + 1}. id=${ctx.id} file=${ctx.filename} docCat=${ctx.docCategory || ctx.category || 'N/A'} score=${ctx.score.toFixed(4)} compositeScore=${ctx.compositeScore.toFixed(4)}`);
    console.log('   preview=', String(ctx.chunk || '').replace(/\s+/g, ' ').slice(0, 160));
  });
});
