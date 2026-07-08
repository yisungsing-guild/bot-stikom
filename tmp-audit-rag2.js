const rag = require('./src/engine/ragEngine');
const queries = [
  { label: 'Program Studi TI (program-specific)', text: 'Apa fokus dan mata kuliah utama program studi TI di kampus?' },
  { label: 'Program Studi SI (program-specific)', text: 'Jelaskan program studi SI, termasuk fokus dan mata kuliah.' },
  { label: 'Hobi Coding Recommendation', text: 'Hobi saya suka ngoding cocok jurusan apa?' },
  { label: 'Dual Degree Internasional', text: 'Apakah ada program dual degree internasional?' },
  { label: 'Dual Degree Nasional', text: 'Apakah ada program dual degree nasional?' },
  { label: 'Beasiswa', text: 'Info beasiswa ada?' },
  { label: 'Biaya Kuliah TI', text: 'Berapa biaya kuliah TI?' }
];
const opts = { returnDebug: true };
(async () => {
  for (const q of queries) {
    try {
      console.log('---');
      console.log('QUERY:', q.label);
      console.log('TEXT:', q.text);
      const queryEntities = rag.extractStructuredEntities(q.text);
      console.log('QUERY_ENTITIES:', JSON.stringify(queryEntities));
      const detectedIntent = rag.detectIntent ? rag.detectIntent(q.text) : null;
      console.log('DETECTED_INTENT:', detectedIntent);
      const res = await rag.query(q.text, 8, opts);
      console.log('SOURCE:', res.source);
      console.log('SUCCESS:', res.success);
      console.log('CONFIDENCE_TIER:', res.confidenceTier || (res.debug && res.debug.confidenceTier) || null);
      console.log('RAG_SCORE:', res.score || res.confidenceScore || null);
      console.log('ANSWER:', String(res.answer || '').slice(0, 250).replace(/\n/g, ' '));
      console.log('SELECTED_CHUNK_COUNT:', Array.isArray(res.contexts) ? res.contexts.length : 0);
      if (Array.isArray(res.contexts)) {
        console.log('CHUNKS:');
        res.contexts.slice(0, 4).forEach((c, idx) => {
          console.log(`  ${idx + 1}. id=${c.id} file=${c.filename || c.trainingId || 'unknown'} category=${c.category || c.docCategory || 'unknown'} score=${c.score}`);
        });
      }
      const finalSourceFiles = Array.isArray(res.contexts) ? Array.from(new Set(res.contexts.map(c => c.filename || c.trainingId || c.id).filter(Boolean))) : [];
      console.log('FINAL_CONTEXT_SOURCES:', finalSourceFiles);
      console.log('DEBUG_KEYS:', Object.keys(res.debug || {}));
      const debugStr = res.debug ? JSON.stringify(res.debug, null, 2).slice(0, 500) : 'none';
      console.log('DEBUG_SAMPLE:', debugStr);
    } catch (e) {
      console.error('ERROR for query', q.text, e && e.message ? e.message : e);
    }
  }
})();
