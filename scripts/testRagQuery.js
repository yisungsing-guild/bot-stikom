const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = { flags: new Set(), values: {} };
  const booleanFlags = new Set(['prod', 'noGlobal']);
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    if (booleanFlags.has(key)) {
      out.flags.add(key);
      continue;
    }

    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out.flags.add(key);
    } else {
      out.values[key] = next;
      i += 1;
    }
  }
  return out;
}

function resolveFromProjectRoot(projectRoot, p) {
  const s = String(p || '').trim();
  if (!s) return s;
  return path.isAbsolute(s) ? s : path.resolve(projectRoot, s);
}

function pickEnvPath(projectRoot, forceProd, explicitEnvPath) {
  if (explicitEnvPath) return resolveFromProjectRoot(projectRoot, explicitEnvPath);
  if (process.env.DOTENV_CONFIG_PATH) return resolveFromProjectRoot(projectRoot, process.env.DOTENV_CONFIG_PATH);

  const isProd = forceProd || (String(process.env.NODE_ENV || '').toLowerCase() === 'production');
  if (!isProd) return resolveFromProjectRoot(projectRoot, '.env');
  if (fs.existsSync(resolveFromProjectRoot(projectRoot, '.env.production.local'))) return resolveFromProjectRoot(projectRoot, '.env.production.local');
  return resolveFromProjectRoot(projectRoot, '.env.production');
}

function pickQuestion(argv) {
  const booleanFlags = new Set(['--prod', '--noGlobal']);
  const valueFlags = new Set(['--env', '--divisionKey', '--division', '--topK']);

  const parts = [];
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      parts.push(a);
      continue;
    }

    if (booleanFlags.has(a)) continue;
    if (valueFlags.has(a)) {
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) i += 1;
      continue;
    }

    // unknown flag: assume it has a value and skip it if present
    if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) i += 1;
  }

  return parts.join(' ').trim();
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const args = parseArgs(process.argv);
  const forceProd = args.flags.has('prod');
  const envPath = pickEnvPath(projectRoot, forceProd, args.values.env);
  require('dotenv').config({ path: envPath, quiet: true, override: true });

  const divisionKey = (args.values.divisionKey || args.values.division) ? String(args.values.divisionKey || args.values.division).trim() : null;
  const includeGlobal = !args.flags.has('noGlobal');
  const topK = args.values.topK ? Math.max(1, Math.min(parseInt(String(args.values.topK), 10) || 6, 50)) : 6;

  const question = pickQuestion(process.argv);
  if (!question) {
    console.log('Usage: node scripts/testRagQuery.js [--prod] [--env <path>] [--divisionKey <key>] [--noGlobal] [--topK <n>] <question>');
    process.exit(2);
  }

  const { query, getIndexPath } = require('../src/engine/ragEngine');
  const indexPath = getIndexPath();

  console.log(JSON.stringify({ ok: true, envPath, indexPath, divisionKey: divisionKey || null, includeGlobal, topK }, null, 2));

  const result = await query(question, topK, { divisionKey: divisionKey || null, includeGlobal });
  console.log('\n=== QUESTION ===');
  console.log(question);
  console.log('\n=== ANSWER ===');
  console.log(result.answer);
  console.log('\n=== SOURCE ===');
  console.log(result.source);
  console.log('\n=== CONTEXTS (top) ===');
  for (const c of result.contexts || []) {
    const preview = String(c.chunk || '').replace(/\s+/g, ' ').slice(0, 200);
    const filename = c.filename ? String(c.filename) : '';
    const div = (c.divisionKey === null || typeof c.divisionKey === 'undefined') ? '' : String(c.divisionKey);
    console.log(`- trainingId=${c.trainingId} score=${(c.score * 100).toFixed(1)}% division=${div || '-'} filename=${filename || '-'} preview=${preview}`);
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
