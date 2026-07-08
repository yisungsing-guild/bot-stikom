/*
Backfill TrainingData.uploadedById for rows where it's missing.

Why:
- If the server was running with an older Prisma client/schema, uploads may have been created without uploadedById.
- If login used env fallback (adminId=null), uploader can't be recorded.

Usage:
  node scripts/backfillTrainingUploader.js --username marketing_admin
  node scripts/backfillTrainingUploader.js --username marketing_admin --since 2026-03-20T00:00:00Z
  node scripts/backfillTrainingUploader.js --username marketing_admin --since 2026-03-20T00:00:00Z --apply

Notes:
- Default is DRY RUN (no changes). Use --apply to execute updates.
- This assigns ALL matching rows to the specified user. Only run if you are sure.
*/

// Load env vars (DATABASE_URL, etc.) the same way as the server.
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

function usageAndExit(code = 1) {
  console.log('Missing required args.');
  console.log('Required: --username');
  console.log('Optional: --since <ISO date>, --apply');
  console.log('Example (dry-run): node scripts/backfillTrainingUploader.js --username marketing_admin --since 2026-03-20T00:00:00Z');
  console.log('Example (apply):   node scripts/backfillTrainingUploader.js --username marketing_admin --since 2026-03-20T00:00:00Z --apply');
  process.exit(code);
}

function parseSince(value) {
  if (!value) return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid --since value (must be ISO date): ${value}`);
  }
  return d;
}

async function main() {
  const args = parseArgs(process.argv);
  const username = args.username ? String(args.username).trim() : '';
  const apply = !!args.apply;
  if (!username) usageAndExit(1);

  const since = parseSince(args.since);

  const admin = await prisma.adminUser.findUnique({
    where: { username },
    select: { id: true, username: true, displayName: true, role: true }
  });

  if (!admin) {
    throw new Error(`AdminUser not found: ${username}`);
  }

  const where = {
    uploadedById: null,
    source: 'upload',
  };

  if (since) {
    where.createdAt = { gte: since };
  }

  const sample = await prisma.trainingData.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { id: true, filename: true, createdAt: true, source: true, uploadedById: true }
  });

  const total = await prisma.trainingData.count({ where });

  if (!apply) {
    console.log(JSON.stringify({
      ok: true,
      mode: 'dry-run',
      assignTo: admin,
      filter: { since: since ? since.toISOString() : null, source: 'upload', uploadedById: null },
      totalMatching: total,
      sample
    }, null, 2));
    return;
  }

  const updated = await prisma.trainingData.updateMany({
    where,
    data: { uploadedById: admin.id }
  });

  console.log(JSON.stringify({
    ok: true,
    mode: 'applied',
    assignTo: admin,
    filter: { since: since ? since.toISOString() : null, source: 'upload', uploadedById: null },
    totalMatching: total,
    updated
  }, null, 2));
}

main()
  .catch((e) => {
    console.error('BACKFILL_TRAINING_UPLOADER_ERROR', e.message || e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
