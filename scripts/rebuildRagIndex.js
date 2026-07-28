/* eslint-disable no-console */

/**
 * Rebuild the local RAG index from TrainingData rows in the database.
 *
 * Use this after deploying parser/chunker changes so old dirty chunks are
 * regenerated with the current ingestion logic.
 *
 * Usage:
 *   node scripts/rebuildRagIndex.js --dryRun
 *   node scripts/rebuildRagIndex.js --prod --backup --clear
 *   node scripts/rebuildRagIndex.js --prod --backup --clear --onlyDivision pmb
 *   node scripts/rebuildRagIndex.js --prod --backup --clear --limit 200 --delayMs 100
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = { flags: new Set(), values: {} };
  const booleanFlags = new Set(['prod', 'includeInactive', 'dryRun', 'backup', 'clear']);
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

function normalizeDivisionKey(raw) {
  const k = String(raw || '').toLowerCase().trim();
  if (!k) return null;
  const allowed = new Set(['akademik', 'keuangan', 'pmb', 'prodi', 'beasiswa', 'lainnya']);
  return allowed.has(k) ? k : null;
}

async function sleep(ms) {
  if (!ms || ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function readIndex(indexPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8') || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeIndex(indexPath, index) {
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, JSON.stringify(Array.isArray(index) ? index : [], null, 2));
}

function backupIndex(indexPath) {
  if (!fs.existsSync(indexPath)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${indexPath}.bak_rebuild_${stamp}`;
  fs.copyFileSync(indexPath, backupPath);
  return backupPath;
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const args = parseArgs(process.argv);
  const forceProd = args.flags.has('prod');
  const includeInactive = args.flags.has('includeInactive');
  const dryRun = args.flags.has('dryRun');
  const shouldBackup = args.flags.has('backup');
  const shouldClear = args.flags.has('clear');

  const envPath = pickEnvPath(projectRoot, forceProd);
  require('dotenv').config({ path: envPath, quiet: true, override: false });

  const prisma = require('../src/db');
  const { ingestTrainingData, getIndexPath } = require('../src/engine/ragEngine');

  const onlyDivision = normalizeDivisionKey(args.values.onlyDivision);
  const limitRaw = args.values.limit ? parseInt(args.values.limit, 10) : 5000;
  const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? limitRaw : 5000, 20000));
  const delayMsRaw = args.values.delayMs ? parseInt(args.values.delayMs, 10) : 0;
  const delayMs = Math.max(0, Math.min(Number.isFinite(delayMsRaw) ? delayMsRaw : 0, 5000));
  const indexPath = getIndexPath();
  const beforeIndex = readIndex(indexPath);

  const where = { ...(includeInactive ? {} : { active: true }) };
  if (onlyDivision) where.divisionKey = onlyDivision;

  const rows = await prisma.trainingData.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: {
      id: true,
      filename: true,
      divisionKey: true,
      active: true,
      source: true,
      uploadedById: true,
      createdAt: true,
      content: true
    }
  });

  console.log(JSON.stringify({
    ok: true,
    mode: dryRun ? 'dryRun' : 'apply',
    envPath,
    indexPath,
    beforeChunks: beforeIndex.length,
    rowsToRebuild: rows.length,
    filter: { includeInactive, onlyDivision, limit, delayMs },
    backup: shouldBackup,
    clear: shouldClear
  }, null, 2));

  if (dryRun) {
    for (const row of rows) {
      console.log('WOULD_REINGEST', JSON.stringify({
        id: row.id,
        filename: row.filename,
        divisionKey: row.divisionKey || null,
        active: row.active,
        contentLength: row.content ? String(row.content).length : 0
      }));
    }
    await prisma.$disconnect();
    return;
  }

  const backupPath = shouldBackup ? backupIndex(indexPath) : null;
  if (backupPath) console.log('BACKUP_CREATED', backupPath);

  if (shouldClear) {
    writeIndex(indexPath, []);
    console.log('INDEX_CLEARED', indexPath);
  } else {
    console.warn('INDEX_NOT_CLEARED: existing chunks for inactive/deleted training may remain. Use --clear for a clean rebuild.');
  }

  let ingestedOk = 0;
  let ingestedFail = 0;
  let skippedEmpty = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const content = typeof row.content === 'string' ? row.content : '';
    const label = `${i + 1}/${rows.length} id=${row.id} div=${row.divisionKey || 'global'} file=${row.filename}`;

    if (!content.trim()) {
      skippedEmpty += 1;
      console.warn('SKIP_EMPTY_CONTENT', label);
      continue;
    }

    try {
      const result = await ingestTrainingData(row.id, content, row.source || 'upload', {
        divisionKey: row.divisionKey || null,
        filename: row.filename,
        uploadedById: row.uploadedById || null,
        trainingCreatedAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
        allowDuplicateTrainingAlias: true
      });
      if (result && result.success) {
        ingestedOk += 1;
        console.log('REINGEST_OK', label, JSON.stringify({
          ingested: result.ingested,
          skippedDuplicates: result.skippedDuplicates,
          aliasedDuplicates: result.aliasedDuplicates || 0,
          indexedChunkCount: result.indexedChunkCount || result.ingested || 0
        }));
      } else {
        ingestedFail += 1;
        console.warn('REINGEST_FAIL', label, result && result.error ? result.error : result);
      }
    } catch (err) {
      ingestedFail += 1;
      console.warn('REINGEST_ERROR', label, err && err.message ? err.message : String(err));
    }

    if (delayMs) await sleep(delayMs);
  }

  const afterIndex = readIndex(indexPath);
  console.log(JSON.stringify({
    ok: ingestedFail === 0,
    finished: true,
    beforeChunks: beforeIndex.length,
    afterChunks: afterIndex.length,
    scanned: rows.length,
    ingestedOk,
    ingestedFail,
    skippedEmpty,
    backupPath
  }, null, 2));

  await prisma.$disconnect();
  if (ingestedFail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('REBUILD_RAG_INDEX_ERROR', err && err.message ? err.message : String(err));
  process.exitCode = 1;
});
