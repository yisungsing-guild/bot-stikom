/* eslint-disable no-console */

/**
 * Audit RAG ingest coverage for TrainingData vs active rag_index.json.
 *
 * Usage:
 *   node scripts/auditRagIngestCoverage.js
 *   node scripts/auditRagIngestCoverage.js --includeInactive --json
 *   node scripts/auditRagIngestCoverage.js --onlyDivision pmb --out reports/rag_ingest_audit.json
 *   node scripts/auditRagIngestCoverage.js --failOnMissing
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = { flags: new Set(), values: {} };
  const booleanFlags = new Set(['prod', 'includeInactive', 'json', 'failOnMissing', 'allowDbDown']);
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    if (booleanFlags.has(key)) {
      out.flags.add(key);
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out.flags.add(key);
    else {
      out.values[key] = next;
      i += 1;
    }
  }
  return out;
}

function resolveFromProjectRoot(projectRoot, value) {
  const raw = String(value || '').trim();
  if (!raw) return raw;
  return path.isAbsolute(raw) ? raw : path.resolve(projectRoot, raw);
}

function pickEnvPath(projectRoot, forceProd) {
  if (process.env.DOTENV_CONFIG_PATH) return resolveFromProjectRoot(projectRoot, process.env.DOTENV_CONFIG_PATH);
  const isProd = forceProd || String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  if (!isProd) return resolveFromProjectRoot(projectRoot, '.env');
  if (fs.existsSync(resolveFromProjectRoot(projectRoot, '.env.production.local'))) return resolveFromProjectRoot(projectRoot, '.env.production.local');
  return resolveFromProjectRoot(projectRoot, '.env.production');
}

function countBy(list, getKey) {
  const out = {};
  for (const item of list) {
    const key = String(getKey(item) || 'unknown');
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function buildIndexStats(index) {
  const byTrainingId = new Map();
  const byFilename = new Map();
  const categories = {};
  for (const chunk of Array.isArray(index) ? index : []) {
    if (!chunk || typeof chunk !== 'object') continue;
    const tid = chunk.trainingId ? String(chunk.trainingId) : '';
    const filename = String(chunk.filename || chunk.sourceFile || (chunk.metadata && chunk.metadata.filename) || '').trim();
    if (tid) byTrainingId.set(tid, (byTrainingId.get(tid) || 0) + 1);
    if (filename) byFilename.set(filename, (byFilename.get(filename) || 0) + 1);
    const cat = String(chunk.docCategory || chunk.category || (chunk.metadata && chunk.metadata.docCategory) || 'UNKNOWN');
    categories[cat] = (categories[cat] || 0) + 1;
  }
  return { byTrainingId, byFilename, categories };
}

function compactRow(row, chunksInIndex) {
  return {
    id: row.id,
    filename: row.filename,
    storedFilename: row.storedFilename || null,
    divisionKey: row.divisionKey || null,
    active: row.active,
    source: row.source,
    ragIngestStatus: row.ragIngestStatus || 'unknown',
    ragChunkCount: row.ragChunkCount,
    chunksInIndex,
    hasContent: Boolean(row.content && String(row.content).trim()),
    contentLength: row.content ? String(row.content).length : 0,
    ragIngestError: row.ragIngestError ? String(row.ragIngestError).slice(0, 300) : null,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    ragIngestedAt: row.ragIngestedAt ? new Date(row.ragIngestedAt).toISOString() : null
  };
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const args = parseArgs(process.argv);
  const envPath = pickEnvPath(projectRoot, args.flags.has('prod'));
  require('dotenv').config({ path: envPath, quiet: true, override: true });

  const includeInactive = args.flags.has('includeInactive');
  const jsonMode = args.flags.has('json');
  const failOnMissing = args.flags.has('failOnMissing');
  const allowDbDown = args.flags.has('allowDbDown');
  const onlyDivision = String(args.values.onlyDivision || '').trim() || null;
  const outPath = args.values.out ? resolveFromProjectRoot(projectRoot, args.values.out) : null;

  const prisma = require('../src/db');
  const rag = require('../src/engine/ragEngine');
  const indexPath = rag.getIndexPath();
  const index = rag.loadIndex() || [];
  const indexStats = buildIndexStats(index);
  const indexFile = (() => {
    try {
      const st = fs.statSync(indexPath);
      return { path: indexPath, bytes: st.size, modifiedAt: st.mtime.toISOString() };
    } catch (e) {
      return { path: indexPath, bytes: null, modifiedAt: null, error: e && e.message ? e.message : String(e) };
    }
  })();

  let rows;
  try {
    const where = { ...(includeInactive ? {} : { active: true }) };
    if (onlyDivision) where.divisionKey = onlyDivision;
    rows = await prisma.trainingData.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        filename: true,
        storedFilename: true,
        divisionKey: true,
        active: true,
        source: true,
        content: true,
        ragIngestStatus: true,
        ragIngestError: true,
        ragIngestedAt: true,
        ragChunkCount: true,
        createdAt: true,
        updatedAt: true
      }
    });
  } catch (err) {
    const report = {
      ok: false,
      envPath,
      indexFile,
      index: {
        chunks: index.length,
        uniqueTrainingIds: indexStats.byTrainingId.size,
        uniqueFilenames: indexStats.byFilename.size,
        categories: indexStats.categories
      },
      dbError: err && err.message ? err.message : String(err)
    };
    console.log(JSON.stringify(report, null, 2));
    try { await prisma.$disconnect(); } catch (_) {}
    if (!allowDbDown) process.exitCode = 1;
    return;
  }

  const activeRows = rows.filter((row) => row.active);
  const missing = [];
  const failed = [];
  const rejected = [];
  const emptyContent = [];
  const statusMismatch = [];
  const indexed = [];

  for (const row of rows) {
    const chunksInIndex = indexStats.byTrainingId.get(String(row.id)) || 0;
    const compact = compactRow(row, chunksInIndex);
    if (chunksInIndex > 0) indexed.push(compact);
    if (row.active && chunksInIndex === 0) missing.push(compact);
    if (String(row.ragIngestStatus || '').toLowerCase() === 'failed') failed.push(compact);
    if (String(row.ragIngestStatus || '').toLowerCase() === 'rejected') rejected.push(compact);
    if (!row.content || !String(row.content).trim()) emptyContent.push(compact);
    if (String(row.ragIngestStatus || '').toLowerCase() === 'success' && chunksInIndex === 0) statusMismatch.push(compact);
    if (chunksInIndex > 0 && row.ragChunkCount && Number(row.ragChunkCount) !== chunksInIndex) statusMismatch.push({ ...compact, expectedChunkCount: row.ragChunkCount, actualChunkCount: chunksInIndex });
  }

  const knownTrainingIds = new Set(rows.map((row) => String(row.id)));
  const orphanTrainingIds = [];
  for (const [trainingId, count] of indexStats.byTrainingId.entries()) {
    if (!knownTrainingIds.has(trainingId)) orphanTrainingIds.push({ trainingId, chunksInIndex: count });
  }

  const report = {
    ok: missing.length === 0 && failed.length === 0 && statusMismatch.length === 0,
    generatedAt: new Date().toISOString(),
    envPath,
    filters: { includeInactive, onlyDivision },
    indexFile,
    index: {
      chunks: index.length,
      uniqueTrainingIds: indexStats.byTrainingId.size,
      uniqueFilenames: indexStats.byFilename.size,
      categories: indexStats.categories
    },
    trainingData: {
      scannedRows: rows.length,
      activeRows: activeRows.length,
      indexedRows: indexed.length,
      missingActiveRows: missing.length,
      failedRows: failed.length,
      rejectedRows: rejected.length,
      emptyContentRows: emptyContent.length,
      statusMismatchRows: statusMismatch.length,
      orphanIndexTrainingIds: orphanTrainingIds.length,
      statusCounts: countBy(rows, (row) => row.ragIngestStatus || 'unknown'),
      sourceCounts: countBy(rows, (row) => row.source || 'unknown'),
      divisionCounts: countBy(rows, (row) => row.divisionKey || 'global')
    },
    missingActiveRows: missing,
    failedRows: failed,
    rejectedRows: rejected,
    emptyContentRows: emptyContent,
    statusMismatchRows: statusMismatch,
    orphanIndexTrainingIds: orphanTrainingIds
  };

  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  }

  if (jsonMode || outPath) console.log(JSON.stringify(report, null, 2));
  else {
    console.log('RAG INGEST AUDIT');
    console.log(`Index: ${indexFile.path}`);
    console.log(`Chunks: ${report.index.chunks}, indexed training IDs: ${report.index.uniqueTrainingIds}, filenames: ${report.index.uniqueFilenames}`);
    console.log(`TrainingData scanned: ${report.trainingData.scannedRows}, active: ${report.trainingData.activeRows}, indexed: ${report.trainingData.indexedRows}`);
    console.log(`Missing active: ${report.trainingData.missingActiveRows}, failed: ${report.trainingData.failedRows}, rejected: ${report.trainingData.rejectedRows}, empty content: ${report.trainingData.emptyContentRows}, status mismatch: ${report.trainingData.statusMismatchRows}`);
    if (missing.length) console.log('\nMissing active rows:\n' + missing.map((r) => `- ${r.id} | ${r.filename} | status=${r.ragIngestStatus} | content=${r.contentLength}`).join('\n'));
    if (failed.length) console.log('\nFailed rows:\n' + failed.map((r) => `- ${r.id} | ${r.filename} | ${r.ragIngestError || 'no error'}`).join('\n'));
    if (outPath) console.log(`\nReport written to ${outPath}`);
  }

  try { await prisma.$disconnect(); } catch (_) {}
  if (failOnMissing && (missing.length || failed.length || statusMismatch.length)) process.exitCode = 1;
}

main().catch((err) => {
  console.error('AUDIT_RAG_INGEST_COVERAGE_ERROR', err && err.message ? err.message : String(err));
  process.exitCode = 1;
});