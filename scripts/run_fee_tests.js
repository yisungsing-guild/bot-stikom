const fs = require('fs');
// Silence console.log/traces from the module
console._orig = console.log;
console.log = () => {};
(async () => {
  try {
    const rag = require('../src/engine/ragEngine');
    const qs = [
      'Kalau dibandingkan biaya per semester, prodi mana yang lebih murah: Sistem Komputer atau Bisnis Digital?',
      'Saya pilih BD, lalu apakah SI lebih murah per semester?',
      'Apa beda Sistem Komputer dan Bisnis Digital?',
      'Biaya Bisnis Digital per semester?',
      'Biaya Sistem Komputer per semester?'
    ];
    const outs = [];
    for (const q of qs) {
      try {
        const res = await rag.query(q, 8);
        outs.push({ question: q, answer: res && res.answer ? res.answer : null, source: res && res.source ? res.source : null });
      } catch (e) {
        outs.push({ question: q, error: String(e && e.message ? e.message : e) });
      }
    }
    fs.writeFileSync('reports/fee_test_results.json', JSON.stringify(outs, null, 2));
    // restore
    console.log = console._orig;
    console.error('DONE');
  } catch (e) {
    console.log = console._orig;
    console.error('ERR', e);
  }
})();
