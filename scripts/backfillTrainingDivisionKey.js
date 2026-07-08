/*
Backfill TrainingData.divisionKey based on uploader role.

Why:
- We now support division-separated RAG retrieval.
- Older TrainingData rows may not have divisionKey populated.

Usage:
  node scripts/backfillTrainingDivisionKey.js
  node scripts/backfillTrainingDivisionKey.js --since 2026-03-20T00:00:00Z
  node scripts/backfillTrainingDivisionKey.js --apply

Notes:
- Default is DRY RUN (no changes). Use --apply to execute updates.
*/

const dotenv = require('dotenv');
dotenv.config({
  path:
    process.env.DOTENV_CONFIG_PATH ||
    ((String(process.env.NODE_ENV || '').toLowerCase() === 'production') ? '.env.production' : '.env')
});

const prisma = require('../src/db');

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

function isAdminRole(role) {
  const r = String(role || '').toLowerCase().trim();
  return r === 'admin' || r === 'superadmin';
}

function roleToDivisionKey(role) {
  const r = String(role || '').toLowerCase().trim();
  if (!r || isAdminRole(r)) return null;
  const allowed = new Set(['akademik', 'keuangan', 'pmb', 'prodi', 'beasiswa', 'lainnya']);
  return allowed.has(r) ? r : null;
}

async function main() {
  const args = parseArgs(process.argv);
  const apply = !!args.apply;
  const since = parseSince(args.since);

  const where = {
    divisionKey: null,
    uploadedById: { not: null }
  };
  if (since) where.createdAt = { gte: since };

  const rows = await prisma.trainingData.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      filename: true,
      createdAt: true,
      uploadedById: true,
      uploadedBy: { select: { id: true, username: true, role: true } }
    }
  });

  const byDivision = new Map();
  const skipped = [];
  for (const r of rows) {
    const div = roleToDivisionKey(r.uploadedBy && r.uploadedBy.role);
    if (!div) {
      skipped.push({ id: r.id, uploaderRole: r.uploadedBy ? r.uploadedBy.role : null });
      continue;
    }
    if (!byDivision.has(div)) byDivision.set(div, []);
    byDivision.get(div).push(r.id);
  }

  const summary = {};
  for (const [k, ids] of byDivision.entries()) summary[k] = ids.length;

  if (!apply) {
    console.log(JSON.stringify({
      ok: true,
      mode: 'dry-run',
      filter: { since: since ? since.toISOString() : null, divisionKey: null, uploadedByIdNotNull: true },
      totalMatching: rows.length,
      willUpdateByDivision: summary,
      skippedCount: skipped.length,
      skippedSample: skipped.slice(0, 10)
    }, null, 2));
    return;
  }

  const results = [];
  for (const [div, ids] of byDivision.entries()) {
    if (!ids.length) continue;
    const updated = await prisma.trainingData.updateMany({
      where: { id: { in: ids } },
      data: { divisionKey: div }
    });
    results.push({ divisionKey: div, ids: ids.length, updated });
  }

  console.log(JSON.stringify({
    ok: true,
    mode: 'applied',
    filter: { since: since ? since.toISOString() : null },
    totalMatching: rows.length,
    updatedByDivision: results,
    skippedCount: skipped.length
  }, null, 2));
}

main()
  .catch((e) => {
    console.error('BACKFILL_TRAINING_DIVISIONKEY_ERROR', e.message || e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
