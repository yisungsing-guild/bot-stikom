const originalConsoleLog = console.log;
console.log = () => {};
const { query } = require('./src/engine/ragEngine');
query('biaya lengkap prodi si ada apa saja?').then((res) => {
  originalConsoleLog('RESULT_SOURCE', res && res.source);
  originalConsoleLog('RESULT_ANSWER', String(res && res.answer).slice(0, 800));
}).catch((err) => {
  originalConsoleLog('ERROR', err && err.message);
  process.exit(1);
});
