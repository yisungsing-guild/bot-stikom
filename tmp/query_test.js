const path = require('path');
const fs = require('fs');
const rag = require(path.resolve(__dirname, '..', 'src', 'engine', 'ragEngine'));
const question = 'berapa biaya prodi si gelombang 1A?';
const queryEntities = rag.extractStructuredEntities(question);
console.log('queryEntities:', JSON.stringify(queryEntities, null, 2));
(async () => {
  try {
    const res = await rag.query(question, 8, { returnDebug: true });
    console.log('querySuccess:', !!(res && res.success));
    console.log('answer:', JSON.stringify(res && res.answer, null, 2));
    if (res && res.source) console.log('source:', res.source);
    if (res && res.debug) {
      console.log('debug keys:', Object.keys(res.debug));
      if (res.debug.queryEntities) console.log('debug.queryEntities:', JSON.stringify(res.debug.queryEntities, null, 2));
      if (res.debug.validatedScored) console.log('validatedScored length:', res.debug.validatedScored.length);
      if (res.debug.trace) console.log('trace length:', Array.isArray(res.debug.trace) ? res.debug.trace.length : 'n/a');
    }
  } catch (e) {
    console.error('error', e.stack || e.toString());
  }
})();
