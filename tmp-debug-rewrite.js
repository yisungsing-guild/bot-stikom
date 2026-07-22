const { rewriteQuestionWithLlm } = require('./src/engine/semanticRagEngine');

(async () => {
  const client = {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: '{"canonicalQuestion":"x"}' } }]
        })
      }
    }
  };

  try {
    const result = await rewriteQuestionWithLlm(client, 'apa itu si?');
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('CAUGHT', err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();
