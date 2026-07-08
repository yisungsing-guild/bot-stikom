const composer = require('./src/engine/composer');
(async ()=>{
  const frameGenerator = async (ctx) => {
    console.log('FRAMEGEN CTX', ctx);
    return 'Tenang, aku tangkap ini masih nyambung ke konteks yang sama.';
  };

  const input = {
    userQuery: 'kalau semester awal susah?',
    normalized: 'kalau semester awal susah?',
    intent: { label: 'difficulty', confidence: 0.78 },
    retrievals: [
      { excerpt: 'Semester awal biasanya padat dengan dasar pemrograman dan logika.', score: 0.81, source: 'dokumen-kurikulum' }
    ],
    session: {
      programHint: 'Teknologi Informasi',
      messages: [
        { direction: 'user', message: 'Saya mau tanya soal TI' },
        { direction: 'bot', message: 'Silakan, mau tanya apa?' },
        { direction: 'user', message: 'kalau semester awal susah?' }
      ]
    },
    frameGenerator
  };

  const res = await composer.composeResponse(input);
  console.log('COMPOSE RESULT:', JSON.stringify(res, null, 2));
})();