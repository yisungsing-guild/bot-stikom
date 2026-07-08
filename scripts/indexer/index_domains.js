const fs = require('fs');
const path = require('path');
const fetch = global.fetch || require('node-fetch');

const { computeEmbedding } = require('../../src/engine/ragEngine');

function loadJsonl(fp) {
  if (!fs.existsSync(fp)) throw new Error('File not found: ' + fp);
  return fs.readFileSync(fp, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
}

function inferType(md, text) {
  const explicitType = String(md && md.type ? md.type : '').trim().toLowerCase();
  if (explicitType) return explicitType;

  const topic = String(md && md.topic ? md.topic : '').toLowerCase();
  const category = String(md && md.category ? md.category : '').toLowerCase();
  const hay = `${topic} ${category} ${String(text || '')}`.toLowerCase();

  if (/\b(daftar\s+(?:program\s+studi|prodi|jurusan)|katalog\s+prodi|katalog\s+jurusan|semua\s+jurusan)\b/.test(hay)) return 'program_catalog';
  if (/\b(kurikulum|curriculum|mata\s+kuliah|apa\s+yang\s+dipelajari|skill\s+yang\s+dipelajari|kompetensi)\b/.test(hay)) return 'curriculum';
  if (/\b(prospek\s+kerja|karier|karir|career\s+path|pekerjaan|output\s+lulusan|setelah\s+lulus)\b/.test(hay)) return 'career';
  return 'program_detail';
}

function ensureMetadata(md, sourceFile, text) {
  const out = Object.assign({}, md || {});
  out.category = out.category || 'unknown';
  out.topic = out.topic || out.category || 'general';
  out.type = inferType(out, text);
  out.audience = out.audience || 'prospective_student';
  out.tags = Array.isArray(out.tags) ? out.tags : (out.tags ? [String(out.tags)] : []);
  if (!out.tags.includes(out.type)) out.tags.push(out.type);
  out.source = out.source || sourceFile || 'unknown';
  return out;
}

async function upsertToPinecone(vectors, namespace) {
  const baseUrl = process.env.PINECONE_BASE_URL; // e.g. https://indexname-svc.us-west1.pinecone.io
  const apiKey = process.env.PINECONE_API_KEY;
  if (!baseUrl || !apiKey) throw new Error('PINECONE_BASE_URL and PINECONE_API_KEY must be set');
  const url = `${baseUrl.replace(/\/$/, '')}/vectors/upsert`;
  const body = { vectors, namespace };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Api-Key': apiKey },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Pinecone upsert failed: ${resp.status} ${t}`);
  }
  return resp.json();
}

function writeLocalVectors(outPath, vectors, namespace) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(outPath, { flags: 'w', encoding: 'utf8' });
    stream.on('error', reject);
    stream.on('finish', resolve);
    for (const v of vectors) {
      const rec = Object.assign({}, v, { namespace });
      stream.write(JSON.stringify(rec) + '\n');
    }
    stream.end();
  });
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] || 0) * (b[i] || 0);
    na += (a[i] || 0) ** 2;
    nb += (b[i] || 0) ** 2;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1e-10);
}

async function indexDomains({ inputFile, usePinecone = false, namespace = 'domains_v1', localOut }) {
  const items = loadJsonl(inputFile);
  console.log('Loaded', items.length, 'chunks');

  const vectors = [];
  let i = 0;
  for (const it of items) {
    i++;
    const src = (it.metadata && it.metadata.source) || `chunk-${i}`;
    const text = String(it.text || '').slice(0, 32000);
    const metadata = ensureMetadata(it.metadata, src, text);
    const id = it.id || `chunk-${i}`;
    const emb = await computeEmbedding(text);
    vectors.push({ id, values: emb, metadata, text });
    if (i % 50 === 0) console.log('Indexed', i, 'chunks');
  }

  if (usePinecone) {
    console.log('Uploading', vectors.length, 'vectors to Pinecone namespace', namespace);
    // split into small batches of 50 to be safe
    const batchSize = 50;
    for (let s = 0; s < vectors.length; s += batchSize) {
      const batch = vectors.slice(s, s + batchSize).map(v => ({ id: v.id, values: v.values, metadata: v.metadata }));
      await upsertToPinecone(batch, namespace);
      console.log('Upserted', Math.min(batchSize, vectors.length - s), 'vectors');
    }
    console.log('Pinecone upload complete');
  }

  if (localOut) {
    console.log('Writing local vector file to', localOut);
    await writeLocalVectors(localOut, vectors, namespace);
  }

  return { count: vectors.length };
}

async function semanticRetrieveLocal(localFile, query, topK = 5) {
  // load vectors
  const lines = fs.readFileSync(localFile, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
  const qEmb = await computeEmbedding(String(query || ''));
  // Prefer domain-filtered pool when classifier predicts a domain
  let pool = lines;
  try {
    const { detectKnowledgeDomain } = require('../../src/engine/domainClassifier');
    const predicted = detectKnowledgeDomain(query);
    if (predicted && predicted !== 'unknown') {
      const byCat = lines.filter(l => l && l.metadata && String(l.metadata.category) === predicted);
      if (byCat.length) pool = byCat;
    }
  } catch (e) {
    // ignore classifier errors and use full pool
  }

  const scored = pool.map(l => ({ item: l, score: cosine(qEmb, l.values || []) }));
  scored.sort((a,b) => b.score - a.score);
  return scored.slice(0, topK).map(s => ({ id: s.item.id, score: s.score, category: s.item.metadata.category, topic: s.item.metadata.topic, snippet: String(s.item.text || '').slice(0,240).replace(/\n+/g,' ') }));
}

if (require.main === module) {
  (async () => {
    try {
      const inputFile = path.join(process.cwd(), 'data', 'ingest', 'domains_chunks.jsonl');
      const localOut = path.join(process.cwd(), 'data', 'vec_index', 'domains_vectors.jsonl');
      const usePinecone = Boolean(process.env.PINECONE_API_KEY && process.env.PINECONE_BASE_URL);
      const namespace = process.env.PINECONE_NAMESPACE || 'domains_v1';

      const res = await indexDomains({ inputFile, usePinecone, namespace, localOut });
      console.log('Indexing finished,', res.count, 'vectors processed');

      // Run quick semantic smoke tests locally if localOut exists
      const queries = [
        'ada beasiswa?',
        'jelaskan double degree',
        'program internasional ada?',
        'exchange student bagaimana?',
        'takut matematika tapi suka marketing'
      ];

      for (const q of queries) {
        console.log('\n=== Semantic retrieve for:', q);
        const r = await semanticRetrieveLocal(localOut, q, 5);
        for (const x of r) {
          console.log(`- [${(x.score||0).toFixed(4)}] (${x.category}/${x.topic}) ${x.snippet}`);
        }
      }

    } catch (err) {
      console.error('Indexing failed:', err && err.message ? err.message : String(err));
      process.exitCode = 2;
    }
  })();
}

module.exports = { indexDomains, semanticRetrieveLocal };
