const { composeResponse } = require('./src/engine/composer');
const { humanizeFinalAnswer } = require('./src/engine/aiEngine');
(async ()=>{
  const cr = await composeResponse({
    userQuery: 'beasiswa ada?',
    normalized: 'beasiswa ada?',
    intent: { label: 'SCHOLARSHIP', confidence: 0.8 },
    retrievals: [],
    ruleReply: { text: 'Beberapa jalur menyediakan beasiswa.' },
    session: { contextReused: true, programHint: 'Teknologi Informasi' },
    answerMeta: {}
  });
  console.log('composeResult.finalText=', JSON.stringify(cr.finalText));
  console.log('segments=', JSON.stringify(cr.segments));
  console.log('humanized=', JSON.stringify(humanizeFinalAnswer(cr.finalText, { question:'beasiswa ada?', tone:{}, kind:'composer' })));
})();
