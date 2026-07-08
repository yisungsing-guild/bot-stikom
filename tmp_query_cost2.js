require('dotenv').config({ path: '.env.local', override: true });
const fs = require('fs');
const path = require('path');
const { query } = require('./src/engine/ragEngine');

(async () => {
  try {
    const indexPath = path.join(__dirname, 'src', 'data', 'rag_index.json');
    const raw = fs.readFileSync(indexPath, 'utf8');
    const data = JSON.parse(raw);

    console.log('indexChunkCount', Array.isArray(data) ? data.length : null);
    console.log('indexSizeBytes', Buffer.byteLength(raw, 'utf8'));

    const question = 'berapa biaya pendaftaran gelombang 2?';
    const result = await query(question, 8, {});
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error('ERROR', e.message || e);
    process.exit(1);
  }
})();
