/* eslint-disable no-console */

const { spawnSync } = require('child_process');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return {
    ok: r.status === 0,
    status: r.status,
    error: r.error ? String(r.error.message || r.error) : null,
    stdout: (r.stdout || '').trim().slice(0, 400),
    stderr: (r.stderr || '').trim().slice(0, 400),
  };
}

function tryRequire(name) {
  try {
    require(name);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

const checks = {
  platform: process.platform,
  node: process.version,
  requires: {
    pdf2pic: tryRequire('pdf2pic'),
    tesseract: tryRequire('tesseract.js'),
    sharp: tryRequire('sharp'),
    pdfParse: tryRequire('pdf-parse'),
  },
  commands: {
    convert: run('convert', ['-version']),
    magick: run('magick', ['-version']),
    gm: run('gm', ['-version']),
    gs: run('gs', ['--version']),
    tesseract: run('tesseract', ['--version']),
  },
};

console.log(JSON.stringify(checks, null, 2));
