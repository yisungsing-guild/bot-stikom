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
  if (fs.existsSync(prodLocal)) dotenv.config({ path: prodLocal, override: true });
  else if (fs.existsSync(prod)) dotenv.config({ path: prod, override: true });
  else if (fs.existsSync(dev)) dotenv.config({ path: dev, override: true });
})();

const { FileParser } = require('../../src/engine/fileParser');
const { ingestTrainingData } = require('../../src/engine/ragEngine');

function parseArgs(argv) {
  const out = { dir: process.cwd(), pattern: 'prodi|penjelasan|hobi', dryRun: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dir' && argv[i + 1]) { out.dir = path.resolve(argv[i + 1]); i += 1; }
    else if (a === '--pattern' && argv[i + 1]) { out.pattern = argv[i + 1]; i += 1; }
    else if (a === '--dry') { out.dryRun = true; }
  }
  return out;
}

function findFiles(dir, exts = ['.xlsx', '.xls', '.pdf', '.csv', '.txt', '.docx']) {
  const out = [];
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of list) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'reports') continue;
      out.push(...findFiles(full, exts));
      continue;
    }
    const ext = path.extname(ent.name).toLowerCase();
    if (exts.includes(ext)) out.push(full);
  }
  return out;
}

async function parseFileByExt(file) {
  const ext = path.extname(file).toLowerCase();
  try {
    if (ext === '.xlsx' || ext === '.xls') return await FileParser.parseExcel(file);
    if (ext === '.pdf') return await FileParser.parsePdf(file);
    if (ext === '.csv') return await FileParser.parseCsv(file);
    if (ext === '.txt') return await FileParser.parseTxt(file);
    if (ext === '.docx') return await FileParser.parseDocx(file);
  } catch (err) {
    return null;
  }
  return null;
}

function simpleHash(s) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 12);
}

async function main() {
  const args = parseArgs(process.argv);
  const files = findFiles(args.dir);
  const pattern = new RegExp(args.pattern, 'i');
  const candidates = files.filter(f => pattern.test(path.basename(f)) || pattern.test(f));

  console.log(JSON.stringify({ ok: true, root: args.dir, found: files.length, candidates: candidates.length }, null, 2));

  for (const f of candidates) {
    console.log('PROCESSING', f);
    const content = await parseFileByExt(f);
    if (!content || !content.trim()) {
      console.warn('PARSE_EMPTY', f);
      continue;
    }

    const trainingId = `file-${simpleHash(f)}`;
    const filename = path.basename(f);
    const rel = path.relative(process.cwd(), f).replace(/\\/g, '/');

    if (args.dryRun) {
      console.log('DRY_RUN: would ingest', { trainingId, filename, rel, chars: content.length });
      continue;
    }

    try {
      const res = await ingestTrainingData(trainingId, content, 'upload', { filename, sourceFile: rel, trainingVersion: 'fs-import' });
      console.log('INGEST_RESULT', filename, JSON.stringify(res));
    } catch (e) {
      console.error('INGEST_ERROR', filename, e && e.message ? e.message : String(e));
    }
  }

  console.log('DONE');
}

if (require.main === module) {
  main().catch(e => { console.error('ERROR', e && e.message ? e.message : e); process.exitCode = 2; });
}

module.exports = { findFiles, parseFileByExt };
