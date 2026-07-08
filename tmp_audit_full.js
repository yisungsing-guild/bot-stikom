const engine = require('./src/engine/ragEngine');
const { decorateBotAnswerText } = require('./src/engine/conversationalStyle');

const queries = [
  'berapa biaya TI gelombang 1A',
  'berapa biaya TI gelombang 2C',
  'berapa biaya SI gelombang 2C',
  'berapa biaya SK gelombang 1A',
  'berapa biaya MI',
  'berapa biaya S2 SI',
  'berapa biaya DD DNUI'
];

(async () => {
  for (const q of queries) {
    try {
      const res = await engine.query(q);
      const pre = res && res.answer ? res.answer : null;
      const final = decorateBotAnswerText(pre, q);
      const fee = res && res.debug && res.debug.feeStruct ? res.debug.feeStruct : (res && res.contexts && res.contexts[0] ? res.contexts[0] : null);
      console.log('--- QUERY:', q);
      if (!fee) { console.log('NO feeStruct available'); console.log('\n'); continue; }
      console.log('Fields:');
      console.log('- program / programName:', fee.program || fee.programName || '(none)');
      console.log('- registrationFee:', fee.registrationFee || null);
      console.log('- registrationDiscount:', fee.registrationDiscount || null);
      console.log('- dpp:', fee.dpp || null);
      console.log('- dppDiscount:', fee.dppDiscount || null);

      console.log('\nInitial cost items (raw):');
      console.log(JSON.stringify(fee.initialCostItems || [], null, 2));
      console.log('\nClassified initial cost items (if present):');
      console.log(JSON.stringify(fee.classifiedInitialCostItems || {}, null, 2));

      // check specific items
      const items = fee.initialCostItems || [];
      const findLabel = (pat) => items.filter(it => it && it.label && new RegExp(pat,'i').test(it.label)).map(it=>({label:it.label, amount:it.amount, timing:it.timing}));
      console.log('\nDetected jas almamater:', findLabel('jas|almamater'));
      console.log('Detected kaos/ tas / gmt:', findLabel('kaos|tas|gmt|gmti'));

      console.log('\nFINAL FORMAT (decorated):\n');
      console.log(final);
      console.log('\n----------------------------------------\n');
    } catch (e) {
      console.log('ERROR for', q, e && e.stack);
    }
  }
})();
