const ragScoped = require('./src/engine/ragScoped');

async function run() {
  try {
    const res = await ragScoped.queryScoped({ query: 'Teknologi Informasi belajar apa saja?', category: 'program_studi', topK: 6, options: { explicitDomain: true } });
    console.log(JSON.stringify(res, null, 2));
  } catch (e) {
    console.error('ERROR', e && e.stack ? e.stack : e);
    process.exit(2);
  }
}

run();
