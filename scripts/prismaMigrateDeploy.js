/* eslint-disable no-console */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = new Set(process.argv.slice(2));
const forceProd = args.has('--prod');

const projectRoot = path.resolve(__dirname, '..');

function resolveFromProjectRoot(p) {
  const s = String(p || '').trim();
  if (!s) return s;
  return path.isAbsolute(s) ? s : path.resolve(projectRoot, s);
}

function pickEnvPath() {
  if (process.env.DOTENV_CONFIG_PATH) return resolveFromProjectRoot(process.env.DOTENV_CONFIG_PATH);
  const isProd = forceProd || (String(process.env.NODE_ENV || '').toLowerCase() === 'production');
  if (!isProd) return resolveFromProjectRoot('.env');
  if (fs.existsSync(resolveFromProjectRoot('.env.production.local'))) return resolveFromProjectRoot('.env.production.local');
  return resolveFromProjectRoot('.env.production');
}

const envPath = pickEnvPath();

require('dotenv').config({ path: envPath, quiet: true });

function safeParseDbUrl(databaseUrl) {
  if (!databaseUrl) return { host: null, database: null };
  try {
    const parsed = new URL(databaseUrl);
    const database = (parsed.pathname || '').replace(/^\//, '') || null;
    return { host: parsed.host || null, database };
  } catch {
    return { host: null, database: null };
  }
}

async function main() {
  const databaseUrl = String(process.env.DATABASE_URL || '').trim();
  if (!/^postgres(ql)?:\/\//i.test(databaseUrl)) {
    console.error('MIGRATE_ERR', `DATABASE_URL is missing or invalid in ${envPath}`);
    process.exitCode = 1;
    return;
  }

  const { host, database } = safeParseDbUrl(databaseUrl);
  console.log('MIGRATE_START', { envPath, target: { host, database } });

  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';

  const child = spawn(command, ['prisma', 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
    },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  child.on('exit', (code) => {
    process.exitCode = code || 0;
  });

  child.on('error', (err) => {
    console.error('MIGRATE_ERR', err && err.message ? err.message : err);
    process.exitCode = 1;
  });
}

main();