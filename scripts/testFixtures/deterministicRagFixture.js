const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const fixture = require('./canonicalRagFixture');

const FIXED_TIMESTAMP = '2026-01-01T00:00:00.000Z';

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeText(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
}

function deterministicEmbedding(text) {
  const hash = crypto.createHash('sha256').update(String(text || '')).digest();
  const vec = [];
  for (let i = 0; i < 64; i += 1) vec.push(hash[i % hash.length] / 255);
  return vec;
}

function inferProgram(text) {
  const s = String(text || '').toLowerCase();
  if (/sistem informasi|\bsi\b/.test(s)) return 'SI';
  if (/teknologi informasi|\bti\b/.test(s)) return 'TI';
  if (/sistem komputer|\bsk\b|s\.kom/.test(s)) return 'SK';
  if (/bisnis digital|\bbd\b/.test(s)) return 'BD';
  if (/manajemen informatika|\bmi\b/.test(s)) return 'MI';
  return null;
}

function inferWave(text) {
  const m = String(text || '').match(/\b(?:gelombang\s*)?([1-4][ABC]|khusus)\b/i);
  return m ? String(m[1]).toUpperCase() : null;
}

function buildDeterministicRagIndex(sourceFixture = fixture) {
  const docs = [...sourceFixture.documents].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const index = [];

  for (const doc of docs) {
    const chunks = Array.isArray(doc.chunks) ? doc.chunks : [];
    chunks.forEach((rawChunk, chunkIndex) => {
      const chunk = normalizeText(rawChunk);
      const chunkHash = sha256(chunk.toLowerCase().replace(/\s+/g, ' '));
      const id = `fixture-${sha256(`${doc.id}:${chunkIndex}:${chunkHash}`).slice(0, 24)}`;
      index.push({
        id,
        trainingId: `fixture-${doc.id}`,
        chunk,
        chunkHash,
        sectionTitle: null,
        chunkType: 'GENERAL',
        lowConfidence: false,
        ocrQualityScore: 1,
        embedding: deterministicEmbedding(chunk),
        source: doc.source || 'fixture',
        createdAt: FIXED_TIMESTAMP,
        updatedAt: FIXED_TIMESTAMP,
        divisionKey: doc.divisionKey || null,
        filename: doc.filename,
        sourceFile: doc.filename,
        fileHash: sha256(canonicalJson(doc)),
        trainingVersion: sourceFixture.fixtureVersion,
        uploadedById: 'fixture',
        governance: null,
        program: inferProgram(chunk),
        programName: null,
        programAliases: [],
        wave: inferWave(chunk),
        academicYear: /2026\/2027|2026-2027/.test(chunk) ? '2026' : null,
        partner: /HELP/i.test(chunk) ? 'HELP' : (/DNUI/i.test(chunk) ? 'DNUI' : (/UTB|Universitas Teknologi Bandung/i.test(chunk) ? 'UTB' : null)),
        campus: /kampus|denpasar|bali/i.test(chunk) ? 'BALI' : null,
        jalur: /jalur/i.test(chunk) ? 'REGULER' : null,
        feeType: /biaya|DPP|pendaftaran|semester/i.test(chunk) ? 'TUITION' : null,
        category: doc.docCategory || null,
        docCategory: doc.docCategory || null,
        fixture: {
          schemaVersion: sourceFixture.schemaVersion,
          fixtureVersion: sourceFixture.fixtureVersion,
          generatedBy: sourceFixture.generatedBy
        }
      });
    });
  }

  return index.sort((a, b) => a.id.localeCompare(b.id));
}

function writeDeterministicRagFixture(options = {}) {
  const rootDir = options.rootDir || fs.mkdtempSync(path.join(os.tmpdir(), 'system-wa-rag-fixture-'));
  fs.mkdirSync(rootDir, { recursive: true });
  const indexPath = options.indexPath || path.join(rootDir, 'rag_index.fixture.json');
  const metaPath = options.metaPath || path.join(rootDir, 'rag_index.fixture.meta.json');
  const index = buildDeterministicRagIndex(fixture);
  const sourceHash = sha256(canonicalJson(fixture));
  const indexBody = `${JSON.stringify(index, null, 2)}\n`;
  fs.writeFileSync(indexPath, indexBody, 'utf8');
  const meta = {
    schemaVersion: fixture.schemaVersion,
    fixtureVersion: fixture.fixtureVersion,
    sourceHash,
    generatedBy: fixture.generatedBy,
    generatedAt: FIXED_TIMESTAMP,
    embeddingStrategy: 'sha256-mock-64',
    stableIdStrategy: 'sha256(documentId:chunkIndex:chunkHash)',
    timestampStrategy: FIXED_TIMESTAMP,
    recordCount: index.length,
    indexHash: sha256(indexBody)
  };
  fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  return { rootDir, indexPath, metaPath, index, meta, indexHash: meta.indexHash };
}

function fileSnapshot(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false };
  const body = fs.readFileSync(filePath);
  return { exists: true, bytes: body.length, sha256: sha256(body) };
}

if (require.main === module) {
  const outArg = process.argv.find((arg) => arg.startsWith('--out='));
  const metaArg = process.argv.find((arg) => arg.startsWith('--meta='));
  const dirArg = process.argv.find((arg) => arg.startsWith('--dir='));
  const result = writeDeterministicRagFixture({
    rootDir: dirArg ? path.resolve(dirArg.slice('--dir='.length)) : undefined,
    indexPath: outArg ? path.resolve(outArg.slice('--out='.length)) : undefined,
    metaPath: metaArg ? path.resolve(metaArg.slice('--meta='.length)) : undefined
  });
  console.log(JSON.stringify({
    ok: true,
    indexPath: result.indexPath,
    metaPath: result.metaPath,
    recordCount: result.meta.recordCount,
    sourceHash: result.meta.sourceHash,
    indexHash: result.indexHash
  }, null, 2));
}

module.exports = {
  FIXED_TIMESTAMP,
  buildDeterministicRagIndex,
  writeDeterministicRagFixture,
  fileSnapshot,
  canonicalJson,
  sha256
};
