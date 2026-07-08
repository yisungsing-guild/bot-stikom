const index = require('./src/engine/ragEngine').loadIndex ? require('./src/engine/ragEngine').loadIndex() : null;
if (!index) {
  console.error('loadIndex not exported');
  process.exit(1);
}
const ids = ['1d11c53c-2bdd-4623-aa09-5100316c628e','eaf68cd9-e36b-43fe-8b58-3f958861ab38'];
for (const id of ids) {
  const item = index.find(i => i && i.id === id);
  console.log('---', id, '---');
  if (!item) { console.log('NOT FOUND'); continue; }
  const chunk = String(item.chunk || '');
  const program = item.program || (item.metadata && item.metadata.program) || 'N/A';
  console.log('filename:', item.filename || item.trainingId || 'N/A');
  console.log('program:', program);
  console.log('docCategory:', item.docCategory || item.category || 'UNKNOWN');
  console.log('contains mata kuliah?', /mata kuliah/i.test(chunk));
  console.log('contains prospek kerja?', /prospek kerja|peluang kerja|karir|lulusan/i.test(chunk));
  console.log('contains akreditasi?', /akreditasi/i.test(chunk));
  console.log('contains biaya?', /biaya|dpp|spp|uang kuliah/i.test(chunk));
  console.log('chunk length:', chunk.length);
  console.log('preview:', chunk.slice(0, 800).replace(/\s+/g, ' ').trim());
  console.log('---');
}
