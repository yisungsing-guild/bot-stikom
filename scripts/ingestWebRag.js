const path = require('path');
const dotenv = require('dotenv');

const rootDir = path.join(__dirname, '..');
dotenv.config({ path: path.join(rootDir, '.env.local') });
dotenv.config({ path: path.join(rootDir, '.env') });
dotenv.config();

const prisma = require('../src/db');
const { ingestWebSeedsToRag } = require('../src/engine/webRagIngest');

function readArg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => String(arg || '').startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : '';
}

async function main() {
  const seedArg = readArg('seed');
  const divisionKey = readArg('division') || process.env.WEB_RAG_DIVISION_KEY || '';
  const mode = readArg('mode') || process.env.WEB_RAG_MODE || '';
  const maxPages = readArg('max-pages') || process.env.WEB_RAG_MAX_PAGES || '';

  const result = await ingestWebSeedsToRag({
    seedUrls: seedArg ? [seedArg] : null,
    divisionKey,
    mode,
    maxPages
  });

  console.log(JSON.stringify({
    ok: result.ok,
    seedCount: result.seedCount,
    requestedCount: result.requestedCount,
    okCount: result.okCount,
    failedCount: result.failedCount,
    results: result.results.map((item) => ({
      ok: !!item.ok,
      action: item.action || null,
      url: item.url || item.seedUrl || null,
      trainingDataId: item.trainingDataId || null,
      divisionKey: item.divisionKey || null,
      error: item.error || null
    }))
  }, null, 2));

  if (!result.ok) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('[WEB_RAG_INGEST_FAILED]', err && err.stack ? err.stack : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (prisma && typeof prisma.$disconnect === 'function') {
      await prisma.$disconnect().catch(() => {});
    }
  });
