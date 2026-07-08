const { query } = require('./src/engine/ragEngine');

async function test() {
  const q = 'kalo biaya pendaftaran dnui berapa?\nFollow-up: kalo biaya pendaftaran help?';
  console.log('[TEST] Input:', q);
  console.log('');
  
  try {
    const res = await query(q);
    console.log('[RESULT] Success:', res && res.success);
    console.log('[RESULT] Source:', res && res.source);
    
    const answer = String(res && res.answer ? res.answer : '');
    console.log('[ANSWER LENGTH]', answer.length);
    console.log('');
    
    // Check for programSpecific content
    const hasDNUI = /DNUI/i.test(answer);
    const hasHELP = /HELP/i.test(answer);
    const hasMalaysia = /Malaysia/i.test(answer);
    const hasDanaPendidikan = /Dana\s+Pendidikan\s+Pokok/i.test(answer);
    const hasRp20M = /Rp\s*20\.000\.000/i.test(answer);
    
    console.log('[CHECKS]');
    console.log('  hasDNUI:', hasDNUI);
    console.log('  hasHELP:', hasHELP);
    console.log('  hasMalaysia:', hasMalaysia);
    console.log('  hasDanaPendidikan:', hasDanaPendidikan);
    console.log('  hasRp20M:', hasRp20M);
    console.log('');
    
    if (answer.length > 0) {
      console.log('[ANSWER PREVIEW]');
      console.log(answer.substring(0, 500));
      console.log('...');
    }
  } catch (e) {
    console.error('[ERROR]', e.message);
    console.error(e.stack);
  }
}

test();
