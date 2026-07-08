const { query, extractStructuredEntities, detectIntent, extractAcademicIntent, normalizeProgramLabel } = require('./src/engine/ragEngine');

const qs = [
  'Apa yang dipelajari di TI?',
  'Apa yang dipelajari di SI?',
  'Apa yang dipelajari di SK?',
  'Apa itu SK?',
  'Mata kuliah SK?'
];

(async () => {
  for (const q of qs) {
    const queryEntities = extractStructuredEntities(q);
    console.log('---');
    console.log('Q:', q);
    console.log('intent:', queryEntities.intent);
    console.log('extractAcademicIntent:', extractAcademicIntent(q));
    console.log('normalizeProgramLabel:', normalizeProgramLabel(q));
    console.log('queryEntities:', JSON.stringify(queryEntities));
    try {
      const res = await query(q, 8, { returnDebug: true });
      console.log('query result source:', res.source);
      console.log('query answer preview:', String(res.answer || '').slice(0, 200).replace(/\n/g, ' '));
      if (res.debug) console.log('debug keys:', Object.keys(res.debug));
      if (res.debug && res.debug.validatedScored) {
        console.log('validatedScored length:', res.debug.validatedScored.length);
        console.log('validatedScored top ids:', JSON.stringify(res.debug.validatedScored.slice(0, 5).map(x => ({ id: x.id, file: x.filename, docCategory: x.docCategory, final: x.finalScore })), null, 2));
      }
    } catch (e) {
      console.error('QUERY FAILED', e && e.message);
    }
  }
})();
