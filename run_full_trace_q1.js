(async ()=>{
  const { query } = require('./src/engine/ragEngine');
  try {
    console.log('\n### RUNNING FULL TRACE: berapa biaya TI gelombang 2C? ###\n');
    const res = await query('berapa biaya TI gelombang 2C?', null, {});
    console.log('\n### FINAL RESULT OBJECT ###');
    console.log(JSON.stringify(res, null, 2));
  } catch (e) {
    console.error('Query error', e && e.stack);
  }
})();
