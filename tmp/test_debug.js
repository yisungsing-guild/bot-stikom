const fs = require('fs');
const code = fs.readFileSync('src/engine/ragEngine.js', 'utf8');
const start = code.indexOf('function normalizeProgramLabel');
const end = code.indexOf('function getCanonicalProgramName', start);
console.log(code.slice(start,end).split('\n').slice(0,80).join('\n'));
