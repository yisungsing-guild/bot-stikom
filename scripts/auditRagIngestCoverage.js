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

function getChunkKnowledgePreparation(chunk) {
  if (!chunk || typeof chunk !== 'object') return null;
  if (chunk.governance && chunk.governance.knowledgePreparation && typeof chunk.governance.knowledgePreparation === 'object') return chunk.governance.knowledgePreparation;
  const metadata = chunk.metadata && typeof chunk.metadata === 'object' ? chunk.metadata : null;
  if (metadata && metadata.governance && metadata.governance.knowledgePreparation && typeof metadata.governance.knowledgePreparation === 'object') return metadata.governance.knowledgePreparation;
  if (metadata && metadata.knowledgePreparation && typeof metadata.knowledgePreparation === 'object') return metadata.knowledgePreparation;
  return null;
}

function buildIndexStats(index) {
  const byTrainingId = new Map();
  const byFilename = new Map();
  const categories = {};
  const knowledgePreparation = { sourceAuthority: {}, qualityBand: {}, approvalStatus: {}, pipelineVersion: {}, missingMetadataChunks: 0 };
  for (const chunk of Array.isArray(index) ? index : []) {
    if (!chunk || typeof chunk !== 'object') continue;
    const tid = chunk.trainingId ? String(chunk.trainingId) : '';
    const filename = String(chunk.filename || chunk.sourceFile || (chunk.metadata && chunk.metadata.filename) || '').trim();
    if (tid) byTrainingId.set(tid, (byTrainingId.get(tid) || 0) + 1);
    if (filename) byFilename.set(filename, (byFilename.get(filename) || 0) + 1);
    const cat = String(chunk.docCategory || chunk.category || (chunk.metadata && chunk.metadata.docCategory) || 'UNKNOWN');
    categories[cat] = (categories[cat] || 0) + 1;
    const prep = getChunkKnowledgePreparation(chunk);
    if (!prep) {
      knowledgePreparation.missingMetadataChunks += 1;
    } else {
      const authority = prep.sourceAuthority && typeof prep.sourceAuthority === 'object' ? String(prep.sourceAuthority.level || 'unknown') : 'unknown';
      const band = prep.quality && typeof prep.quality === 'object' ? String(prep.quality.band || 'unknown') : 'unknown';
      const approval = prep.approval && typeof prep.approval === 'object' ? String(prep.approval.status || 'unknown') : 'unknown';
      const pipelineVersion = prep.indexVersion && prep.indexVersion.pipelineVersion ? String(prep.indexVersion.pipelineVersion) : String(prep.version || 'unknown');
      knowledgePreparation.sourceAuthority[authority] = (knowledgePreparation.sourceAuthority[authority] || 0) + 1;
      knowledgePreparation.qualityBand[band] = (knowledgePreparation.qualityBand[band] || 0) + 1;
      knowledgePreparation.approvalStatus[approval] = (knowledgePreparation.approvalStatus[approval] || 0) + 1;
      knowledgePreparation.pipelineVersion[pipelineVersion] = (knowledgePreparation.pipelineVersion[pipelineVersion] || 0) + 1;
    }
  }
  return { byTrainingId, byFilename, categories, knowledgePreparation };
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

function extractAcademicYear(value) {
  const text = String(value || '');
  const match = text.match(/(?:t\.?a\.?|tahun\s+ajaran|academic\s+year)?\s*(20\d{2})\s*[-\/]\s*(20\d{2})/i);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start, end, key: `${start}-${end}` };
}

function normalizeTopicFilename(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/(?:t\.?a\.?|tahun\s+ajaran)?\s*20\d{2}\s*[-\/]\s*20\d{2}/gi, ' ')
    .replace(/\b(?:copy|salinan|final|revisi|rev|baru|old|lama|latest|terbaru)\b/gi, ' ')
    .replace(/[-_()\[\]{}]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildVersionConflictReport(rows, indexStats) {
  const groups = new Map();
  for (const row of rows) {
    if (!row || !row.active) continue;
    const chunksInIndex = indexStats.byTrainingId.get(String(row.id)) || 0;
    if (chunksInIndex <= 0) continue;
    const filename = row.filename || row.storedFilename || '';
    const topicKey = normalizeTopicFilename(filename);
    if (!topicKey || topicKey.length < 5) continue;
    const year = extractAcademicYear(`${filename} ${row.content || ''}`);
    const compact = { ...compactRow(row, chunksInIndex), topicKey, academicYear: year ? year.key : null, academicYearEnd: year ? year.end : null };
    if (!groups.has(topicKey)) groups.set(topicKey, []);
    groups.get(topicKey).push(compact);
  }

  const conflicts = [];
  for (const [topicKey, items] of groups.entries()) {
    if (items.length < 2) continue;
    const years = [...new Set(items.map((item) => item.academicYear).filter(Boolean))];
    const hasMixedYears = years.length > 1;
    const latestEnd = Math.max(...items.map((item) => Number(item.academicYearEnd) || 0));
    const stale = latestEnd > 0 ? items.filter((item) => Number(item.academicYearEnd) > 0 && Number(item.academicYearEnd) < latestEnd) : [];
    if (!hasMixedYears && stale.length === 0) continue;
    conflicts.push({
      topicKey,
      activeIndexedDocuments: items.length,
      academicYears: years.sort(),
      latestAcademicYearEnd: latestEnd || null,
      staleCandidates: stale.map((item) => ({ id: item.id, filename: item.filename, academicYear: item.academicYear, chunksInIndex: item.chunksInIndex })),
      documents: items.map((item) => ({ id: item.id, filename: item.filename, academicYear: item.academicYear, chunksInIndex: item.chunksInIndex, createdAt: item.createdAt }))
    });
  }
  conflicts.sort((a, b) => b.activeIndexedDocuments - a.activeIndexedDocuments || a.topicKey.localeCompare(b.topicKey));
  return conflicts;
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
        categories: indexStats.categories,
        knowledgePreparation: indexStats.knowledgePreparation
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
  const heldForReview = [];
  const emptyContent = [];
  const successMissingIndex = [];
  const chunkCountMismatch = [];
  const indexed = [];

  const versionConflicts = buildVersionConflictReport(rows, indexStats);

  for (const row of rows) {
    const chunksInIndex = indexStats.byTrainingId.get(String(row.id)) || 0;
    const compact = compactRow(row, chunksInIndex);
    if (chunksInIndex > 0) indexed.push(compact);
    const ingestStatus = String(row.ragIngestStatus || '').toLowerCase();
    if (row.active && chunksInIndex === 0 && !['rejected', 'held_for_review'].includes(ingestStatus)) missing.push(compact);
    if (ingestStatus === 'failed') failed.push(compact);
    if (ingestStatus === 'rejected') rejected.push(compact);
    if (ingestStatus === 'held_for_review') heldForReview.push(compact);
    if (!row.content || !String(row.content).trim()) emptyContent.push(compact);
    if (String(row.ragIngestStatus || '').toLowerCase() === 'success' && chunksInIndex === 0) successMissingIndex.push(compact);
    if (chunksInIndex > 0 && row.ragChunkCount && Number(row.ragChunkCount) !== chunksInIndex) chunkCountMismatch.push({ ...compact, expectedChunkCount: row.ragChunkCount, actualChunkCount: chunksInIndex });
  }

  const knownTrainingIds = new Set(rows.map((row) => String(row.id)));
  const orphanTrainingIds = [];
  for (const [trainingId, count] of indexStats.byTrainingId.entries()) {
    if (!knownTrainingIds.has(trainingId)) orphanTrainingIds.push({ trainingId, chunksInIndex: count });
  }

  const report = {
    ok: missing.length === 0 && failed.length === 0 && successMissingIndex.length === 0,
    generatedAt: new Date().toISOString(),
    envPath,
    filters: { includeInactive, onlyDivision },
    indexFile,
    index: {
      chunks: index.length,
      uniqueTrainingIds: indexStats.byTrainingId.size,
      uniqueFilenames: indexStats.byFilename.size,
      categories: indexStats.categories,
      knowledgePreparation: indexStats.knowledgePreparation
    },
    trainingData: {
      scannedRows: rows.length,
      activeRows: activeRows.length,
      indexedRows: indexed.length,
      missingActiveRows: missing.length,
      failedRows: failed.length,
      rejectedRows: rejected.length,
      heldForReviewRows: heldForReview.length,
      emptyContentRows: emptyContent.length,
      successMissingIndexRows: successMissingIndex.length,
      chunkCountMismatchRows: chunkCountMismatch.length,
      orphanIndexTrainingIds: orphanTrainingIds.length,
      versionConflictGroups: versionConflicts.length,
      staleVersionCandidates: versionConflicts.reduce((sum, group) => sum + group.staleCandidates.length, 0),
      statusCounts: countBy(rows, (row) => row.ragIngestStatus || 'unknown'),
      sourceCounts: countBy(rows, (row) => row.source || 'unknown'),
      divisionCounts: countBy(rows, (row) => row.divisionKey || 'global')
    },
    missingActiveRows: missing,
    failedRows: failed,
    rejectedRows: rejected,
    heldForReviewRows: heldForReview,
    emptyContentRows: emptyContent,
    successMissingIndexRows: successMissingIndex,
    chunkCountMismatchRows: chunkCountMismatch,
    orphanIndexTrainingIds: orphanTrainingIds,
    versionConflicts
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
    console.log(`KnowledgePrep metadata missing chunks: ${report.index.knowledgePreparation.missingMetadataChunks}`);
    console.log(`TrainingData scanned: ${report.trainingData.scannedRows}, active: ${report.trainingData.activeRows}, indexed: ${report.trainingData.indexedRows}`);
    console.log(`Missing active: ${report.trainingData.missingActiveRows}, failed: ${report.trainingData.failedRows}, rejected: ${report.trainingData.rejectedRows}, held review: ${report.trainingData.heldForReviewRows}, empty content: ${report.trainingData.emptyContentRows}`);
    console.log(`Success missing from index: ${report.trainingData.successMissingIndexRows}, chunk count mismatch: ${report.trainingData.chunkCountMismatchRows}`);
    console.log(`Version conflict groups: ${report.trainingData.versionConflictGroups}, stale version candidates: ${report.trainingData.staleVersionCandidates}`);
    if (versionConflicts.length) console.log('\nVersion conflicts / stale candidates:\n' + versionConflicts.slice(0, 12).map((g) => `- ${g.topicKey} | years=${g.academicYears.join(', ')} | stale=${g.staleCandidates.length}`).join('\n'));
    if (missing.length) console.log('\nMissing active rows:\n' + missing.map((r) => `- ${r.id} | ${r.filename} | status=${r.ragIngestStatus} | content=${r.contentLength}`).join('\n'));
    if (failed.length) console.log('\nFailed rows:\n' + failed.map((r) => `- ${r.id} | ${r.filename} | ${r.ragIngestError || 'no error'}`).join('\n'));
    if (outPath) console.log(`\nReport written to ${outPath}`);
  }

  try { await prisma.$disconnect(); } catch (_) {}
  if (failOnMissing && (missing.length || failed.length || successMissingIndex.length)) process.exitCode = 1;
}

main().catch((err) => {
  console.error('AUDIT_RAG_INGEST_COVERAGE_ERROR', err && err.message ? err.message : String(err));
  process.exitCode = 1;
});