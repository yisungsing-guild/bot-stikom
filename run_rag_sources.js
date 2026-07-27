const { rewriteQuestionWithLlm, retrieveSemanticContexts, getClient } = require('./src/engine/semanticRagEngine');

const questions = [
  'Apa itu Career Center ITB STIKOM Bali?',
  'Apa keuntungan menjadi mahasiswa ITB STIKOM Bali dari sisi karier?',
  'Apakah ITB STIKOM Bali membantu lulusannya mendapatkan pekerjaan?',
  'Apakah ada program magang?',
  'Apakah perusahaan sering datang ke kampus untuk rekrutmen?',
  'Apakah ada Job Fair di ITB STIKOM Bali?',
  'Kapan mahasiswa bisa mulai mengikuti program Career Center?',
  'Apakah mahasiswa mendapat pelatihan sebelum melamar kerja?',
  'Bagaimana peluang kerja lulusan ITB STIKOM Bali?',
  'Apakah kampus memiliki kerja sama dengan perusahaan?'
];

async function run() {
  for (const q of questions) {
    try {
      // Call rewrite with null client so rewrite falls back to using the original question
      const rewrite = await rewriteQuestionWithLlm(null, q, {});
      const queries = rewrite && rewrite.searchQueries ? rewrite.searchQueries : [q];
      const retrieved = await retrieveSemanticContexts(queries, { topK: 8, question: q, intent: rewrite.intent });
      console.log('QUESTION:', q);
      console.log('Rewrite searchQueries:', JSON.stringify(queries));
      console.log(`Top score: ${retrieved.topScore}, indexSize: ${retrieved.indexSize}`);
      if (Array.isArray(retrieved.contexts) && retrieved.contexts.length) {
        console.log('Retrieved contexts:');
        retrieved.contexts.slice(0, 8).forEach((ctx, i) => {
          console.log(`${i + 1}. filename/sourceFile: ${ctx.filename || ctx.sourceFile || ctx.source || 'unknown'} | trainingId/id: ${ctx.trainingId || ctx.id || 'unknown'} | score: ${ctx.score}`);
          const preview = (ctx.chunk || '').replace(/\s+/g, ' ').slice(0, 200);
          console.log('   preview:', preview);
        });
      } else {
        console.log('No retrieved contexts');
      }
      console.log('---');
    } catch (err) {
      console.error('ERROR for', q, err && err.message || err);
    }
  }
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
