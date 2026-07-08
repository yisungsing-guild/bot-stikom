// Load env vars (DATABASE_URL, etc.) the same way as the server.
const dotenv = require('dotenv');
dotenv.config({
  path:
    process.env.DOTENV_CONFIG_PATH ||
    ((String(process.env.NODE_ENV || '').toLowerCase() === 'production') ? '.env.production' : '.env')
});

const prisma = require('../src/db');
const crypto = require('crypto');

async function main() {
  const dbUrlRaw = process.env.DATABASE_URL ? String(process.env.DATABASE_URL) : '';
  const databaseUrlPresent = !!dbUrlRaw;
  const databaseUrlHash = dbUrlRaw
    ? crypto.createHash('sha256').update(dbUrlRaw).digest('hex').slice(0, 12)
    : null;

  let database = null;
  if (dbUrlRaw) {
    try {
      const u = new URL(dbUrlRaw);
      database = {
        protocol: (u.protocol || '').replace(':', ''),
        host: u.hostname || null,
        port: u.port ? Number(u.port) : null,
        database: u.pathname ? u.pathname.replace(/^\//, '') : null
      };
    } catch {
      database = { protocol: null, host: null, port: null, database: null };
    }
  }

  const tables = await prisma.$queryRawUnsafe(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name"
  );

  const tableNames = tables.map((t) => t.table_name);

  const hasPrismaMigrations = tables.some((t) => t.table_name === '_prisma_migrations');

  let trainingDataColumns = [];
  try {
    const cols = await prisma.$queryRawUnsafe(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='TrainingData' ORDER BY ordinal_position"
    );
    trainingDataColumns = cols.map((c) => c.column_name);
  } catch {
    trainingDataColumns = [];
  }

  console.log(
    JSON.stringify(
      {
        databaseUrlPresent,
        databaseUrlHash,
        database,
        tableCount: tables.length,
        tableNames,
        has_prisma_migrations: hasPrismaMigrations,
        trainingDataColumns,
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error('DB_CHECK_ERROR', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
