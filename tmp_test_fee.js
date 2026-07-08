const { tryStructuredFeeBreakdownAnswer } = require('./src/engine/ragEngine');
const fs = require('fs');
const path = require('path');
const data = JSON.parse(fs.readFileSync(path.join('src','data','rag_index.json'), 'utf8'));
const tid = '2580a44c-dffa-4ccc-88b3-6dcf4c7b42ae';
const chunks = data.filter(item => item.trainingId === tid).map(item => item.chunk).filter(Boolean);
const q = 'Biaya Sistem Komputer per semester?';
const res = tryStructuredFeeBreakdownAnswer(q, chunks, { conversationContext: q, lastProgramHint: 'sk' });
console.log('RES', res);
