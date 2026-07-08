/*
Re-ingest all (active) TrainingData into the local RAG index with metadata.

Usage:
  node scripts/reingestAllTraining.js
  node scripts/reingestAllTraining.js --onlyDivision pmb
  node scripts/reingestAllTraining.js --since 2026-03-20T00:00:00Z
  node scripts/reingestAllTraining.js --limit 50 --delayMs 100
*/

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

(function loadDotenv() {
  const explicit = process.env.DOTENV_CONFIG_PATH;
  if (explicit) {
    dotenv.config({ path: explicit, override: true });
    return;
  }
  const cwd = process.cwd();
  const prodLocal = path.join(cwd, '.env.production.local');
  const prod = path.join(cwd, '.env.production');
  const dev = path.join(cwd, '.env');
  if (fs.existsSync(prodLocal)) {
    dotenv.config({ path: prodLocal, override: true });
  } else if (fs.existsSync(prod)) {
    dotenv.config({ path: prod, override: true });
  } else if (fs.existsSync(dev)) {
    dotenv.config({ path: dev, override: true });
  } else if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    dotenv.config({ path: '.env.production', override: true });
  }
})();

const prisma = require('../src/db');
const { ingestTrainingData } = require('../src/engine/ragEngine');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[name] = true;
    } else {
      args[name] = next;
      i += 1;
    }
  }
  return args;
}

function parseSince(value) {
  if (!value) return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid --since value (must be ISO date): ${value}`);
  }
  return d;
}

function normalizeDivisionKey(raw) {
  const k = String(raw || '').toLowerCase().trim();
  if (!k) return null;
  const allowed = new Set(['akademik', 'keuangan', 'pmb', 'prodi', 'beasiswa', 'lainnya']);
  return allowed.has(k) ? k : null;
}

async function sleep(ms) {
  if (!ms || ms <= 0) return;
  await new Promise(r => setTimeout(r, ms));
}

async function main() {
  const args = parseArgs(process.argv);
  const since = parseSince(args.since);
  const onlyDivision = normalizeDivisionKey(args.onlyDivision);
  const limit = args.limit ? Math.max(1, Math.min(parseInt(args.limit, 10) || 0, 5000)) : null;
  const delayMs = args.delayMs ? Math.max(0, Math.min(parseInt(args.delayMs, 10) || 0, 2000)) : 0;

  const where = { active: true };
  if (since) where.createdAt = { gte: since };
  if (onlyDivision) where.divisionKey = onlyDivision;

  const rows = await prisma.trainingData.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    ...(limit ? { take: limit } : {}),
    select: {
      id: true,
      filename: true,
      content: true,
      source: true,
      divisionKey: true,
      uploadedById: true,
      createdAt: true
    }
  });

  console.log(JSON.stringify({ ok: true, count: rows.length, filter: { since: since ? since.toISOString() : null, onlyDivision, limit, delayMs } }, null, 2));

  let ok = 0;
  let fail = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const t = rows[i];
    const label = `${i + 1}/${rows.length} ${t.id} (${t.source}) div=${t.divisionKey || 'global'} file=${t.filename}`;
    try {
      const result = await ingestTrainingData(t.id, t.content, t.source, {
        divisionKey: t.divisionKey || null,
        filename: t.filename,
        uploadedById: t.uploadedById || null,
        trainingCreatedAt: t.createdAt ? t.createdAt.toISOString() : null
      });
      if (result && result.success) {
        ok += 1;
        console.log('OK', label, JSON.stringify({ ingested: result.ingested, skippedDuplicates: result.skippedDuplicates }, null, 0));
      } else {
        fail += 1;
        console.warn('FAIL', label, result && result.error ? result.error : result);
      }
    } catch (e) {
      fail += 1;
      console.warn('ERROR', label, e.message || e);
    }

    if (delayMs) await sleep(delayMs);
  }

  console.log(JSON.stringify({ ok: true, finished: true, total: rows.length, success: ok, failed: fail }, null, 2));
}

main()
  .catch((e) => {
    console.error('REINGEST_ALL_TRAINING_ERROR', e.message || e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
