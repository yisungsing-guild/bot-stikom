/* eslint-disable no-console */

process.env.DOTENV_CONFIG_PATH = process.env.DOTENV_CONFIG_PATH || '.env.production';
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const dotenv = require('dotenv');
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH, override: true });

const prisma = require('../src/db');

async function main() {
  const rls = await prisma.$queryRaw`
    SELECT c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'TrainingData'
  `;

  const cols = await prisma.$queryRaw`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'TrainingData'
    ORDER BY ordinal_position
  `;

  const cons = await prisma.$queryRaw`
    SELECT conname, contype
    FROM pg_constraint
    WHERE conrelid = 'public."TrainingData"'::regclass
    ORDER BY conname
  `;

  const trig = await prisma.$queryRaw`
    SELECT tgname
    FROM pg_trigger
    WHERE tgrelid = 'public."TrainingData"'::regclass
      AND NOT tgisinternal
    ORDER BY tgname
  `;

  console.log(JSON.stringify({ rls, columns: cols, constraints: cons, triggers: trig }, null, 2));
}

main()
  .catch((e) => {
    const msg = e && e.message ? String(e.message) : String(e);
    console.error('ERROR', msg.slice(0, 800));
    if (e && e.code) console.error('CODE', String(e.code));
  })
  .finally(async () => {
    try {
      await prisma.$disconnect();
    } catch {
      // ignore
    }
  });
