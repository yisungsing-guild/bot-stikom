const { queryScoped } = require('../src/engine/ragScoped');
const { selectEvidenceFromContexts } = require('../src/engine/evidenceSelector');

const QUERIES = [
  'biaya teknologi informasi gelombang 1A',
  'biaya sistem informasi gelombang 2',
  'informasi double degree',
  'apa syarat KIP',
  'apa itu sistem informasi',
  'berapa rincian biaya help',
  'syarat pendaftaran si',
  'rincian biaya kuliah',
  'berapa biaya pendaftaran',
  'biaya mahasiswa baru',
  'jadwal pendaftaran gelombang',
  'beasiswa kip',
  'biaya UKT semester 1'
];

(async () => {
  for (const query of QUERIES) {
    console.log('---');
    console.log('QUERY:', query);
    const result = await queryScoped({ query, category: null, topK: 10, options: { returnDebug: true } });
    const contexts = Array.isArray(result.contexts) ? result.contexts : [];
    console.log('retrievalPath:', result.debug && result.debug.retrievalPath);
    console.log('contexts:', contexts.length, 'answer exists:', !!result.answer);
    const selected = selectEvidenceFromContexts({ question: query, contexts, intent: '', maxEvidence: 8 });
    console.log('selectedEvidence:', selected.length);
    selected.forEach((item, idx) => {
      console.log(`  [${idx+1}] source=${item.source} id=${item.sourceId || item.id || item.chunkId} len=${item.text ? item.text.length : 0}`);
      console.log('    preview:', String(item.text || item.chunk || '').slice(0, 180).replace(/\n/g, ' '));
    });
    if (!selected.length) {
      contexts.slice(0, 4).forEach((c, idx) => {
        console.log(` ctx${idx+1} id=${c.id} len=${String(c.chunk||c.text||'').length} preview=${String(c.chunk||c.text||'').slice(0,120).replace(/\n/g,' ')}`);
      });
    }
    console.log('---\n');
  }
})();
