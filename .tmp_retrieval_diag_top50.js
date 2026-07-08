const ragEngine = require('./src/engine/ragEngine');

async function run() {
  try {
    const query = 'TI belajar apa saja';
    const topK = 500;
    const opts = {
      minScore: -1,
      minConfidenceScore: -1,
      strict: false
    };

    const res = await ragEngine.query(query, topK, opts);
    // res.contexts may be null when answer null; but in normal path it contains top contexts
    if (!res || !Array.isArray(res.contexts)) {
      console.error('No contexts returned', JSON.stringify(res, null, 2));
      process.exit(1);
    }

    const contexts = res.contexts.map((c, i) => ({
      rank: i + 1,
      id: c.id || (c.item && c.item.id) || null,
      filename: c.filename || c.trainingId || (c.item && c.item.filename) || null,
      docCategory: (c.metadata && (c.metadata.category || c.metadata.type)) || c.docCategory || (c.item && (c.item.docCategory || c.item.category)) || null,
      similarityScore: (typeof c.semanticScore === 'number') ? c.semanticScore : (c.score || null),
      keywordScore: c.scoreComponents && typeof c.scoreComponents.keywordScore === 'number' ? c.scoreComponents.keywordScore : null,
      metadataBoost: c.scoreComponents && typeof c.scoreComponents.metadataBoost === 'number' ? c.scoreComponents.metadataBoost : null,
      finalScore: (typeof c.finalScore === 'number') ? c.finalScore : (c.scoreComponents && typeof c.scoreComponents.finalScore === 'number' ? c.scoreComponents.finalScore : c.compositeScore || null)
    }));

    // Print top 50
    console.log('TOP 50 candidates (forced minScore=-1, full ordering):');
    console.log(JSON.stringify(contexts.slice(0, 50), null, 2));

    // Check program_studi-28..35
    const targetIds = new Set(['program_studi-28','program_studi-29','program_studi-30','program_studi-31','program_studi-32','program_studi-33','program_studi-34','program_studi-35']);
    const found = [];
    for (const c of contexts) {
      if (c.id && targetIds.has(c.id)) found.push(c);
    }

    if (found.length > 0) {
      console.log('\nFound program_studi-28..35 in results:');
      console.log(JSON.stringify(found, null, 2));
    } else {
      console.log('\nprogram_studi-28..35 not found in returned contexts.');
    }

    // Find top HOBY chunk (first context from HOBY.pdf)
    const hoby = contexts.find(c => (c.filename || '').toLowerCase().includes('hoby') || (c.filename || '').toLowerCase().includes('hobi'));
    const prog28 = contexts.find(c => c.id === 'program_studi-28');
    console.log('\nTop HOBY candidate (first match):', hoby || null);
    console.log('\nprogram_studi-28 candidate:', prog28 || null);

    process.exit(0);
  } catch (e) {
    console.error('ERROR', e && e.stack ? e.stack : e);
    process.exit(2);
  }
}

run();
