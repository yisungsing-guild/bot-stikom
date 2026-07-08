const originalConsoleLog = console.log;
console.log = () => {};
const { query } = require('./src/engine/ragEngine');
query('berapa biaya pendaftaran prodi si').then((res) => {
  originalConsoleLog('RESULT_SOURCE', res && res.source);
  originalConsoleLog('RESULT_ANSWER', String(res && res.answer).slice(0, 400));
}).catch((err) => {
  originalConsoleLog('ERROR', err && err.message);
  process.exit(1);
});
