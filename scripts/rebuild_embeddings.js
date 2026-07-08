const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { OpenAI } = require('openai');

const INDEX_PATH = path.join(__dirname, '..', 'src', 'data', 'rag_index.json');
const BAK_PATH = `${INDEX_PATH}.bak_embedding_${Date.now()}`;

function mockEmbedding(text) {
  const hash = crypto.createHash('sha256').update(String(text || '')).digest();
  const vec = [];
  for (let i = 0; i < 64; i++) vec.push(hash[i % hash.length] / 255);
  return vec;
}

async function computeEmbedding(text) {
  if (process.env.OPENAI_API_KEY) {
    try {
      const timeoutMs = parseInt(process.env.OPENAI_EMBEDDING_TIMEOUT_MS || '20000', 10);
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: timeoutMs });
      const model = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
      const resp = await client.embeddings.create({ model, input: text });
      const emb = resp.data && resp.data[0] && resp.data[0].embedding;
      if (Array.isArray(emb) && emb.length > 0) return emb;
      console.warn('[rebuild_embeddings] OpenAI returned empty embedding, falling back to mock');
    } catch (err) {
      console.warn('[rebuild_embeddings] OpenAI embedding failed:', err.message);
    }
  }
  return mockEmbedding(text);
}

async function main() {
  console.log('[rebuild_embeddings] Reading', INDEX_PATH);
  if (!fs.existsSync(INDEX_PATH)) {
    console.error('[rebuild_embeddings] Index file not found:', INDEX_PATH);
    process.exit(2);
  }

  const raw = fs.readFileSync(INDEX_PATH, 'utf8');
  let index = [];
  try { index = JSON.parse(raw); } catch (err) { console.error('[rebuild_embeddings] JSON parse error', err.message); process.exit(3); }

  // Backup
  fs.writeFileSync(BAK_PATH, raw);
  console.log('[rebuild_embeddings] Backup written to', BAK_PATH);

  let updated = 0;
  for (let i = 0; i < index.length; i++) {
    const item = index[i];
    if (!item || typeof item !== 'object') continue;
    const chunk = String(item.chunk || '');
    // Recompute if embedding missing or short
    const needs = !Array.isArray(item.embedding) || item.embedding.length < 16;
    if (needs) {
      // Small delay throttle to avoid burst
      try {
        const emb = await computeEmbedding(chunk.slice(0, 2000));
        item.embedding = emb;
        updated++;
      } catch (err) {
        console.warn('[rebuild_embeddings] failed to compute embedding for item', i, err.message);
      }
    }
    if (i % 200 === 0) process.stdout.write('.');
  }
  console.log('\n[rebuild_embeddings] Embeddings updated for', updated, 'items');

  // Write new index atomically
  const tmp = `${INDEX_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(index, null, 2));
  fs.renameSync(tmp, INDEX_PATH);
  console.log('[rebuild_embeddings] Index written to', INDEX_PATH);
}

main().catch(err => { console.error('FATAL', err); process.exit(1); });
