/* eslint-disable no-console */

process.env.DOTENV_CONFIG_PATH = process.env.DOTENV_CONFIG_PATH || '.env.production';

const dotenv = require('dotenv');
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH, override: true });

const prisma = require('../src/db');

async function showOne(sql) {
  const rows = await prisma.$queryRawUnsafe(sql);
  return rows;
}

async function main() {
  const currentUser = await showOne('select current_user, session_user');
  const statementTimeout = await showOne('show statement_timeout');
  const idleTimeout = await showOne('show idle_in_transaction_session_timeout');
  const lockTimeout = await showOne('show lock_timeout');
  const serverEncoding = await showOne('show server_encoding');
  const clientEncoding = await showOne('show client_encoding');
  const dbLocale = await showOne("select datname, datcollate, datctype from pg_database where datname = current_database()");

  console.log(
    JSON.stringify(
      {
        currentUser,
        statement_timeout: statementTimeout,
        idle_in_transaction_session_timeout: idleTimeout,
        lock_timeout: lockTimeout,
        server_encoding: serverEncoding,
        client_encoding: clientEncoding,
        database_locale: dbLocale,
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error('ERROR', String(e?.message || e).slice(0, 800));
    if (e?.code) console.error('CODE', String(e.code));
  })
  .finally(async () => {
    try {
      await prisma.$disconnect();
    } catch {
      // ignore
    }
  });
