'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function getAllFiles(dir) {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      getAllFiles(full).forEach(f => files.push(f));
    } else {
      files.push(full);
    }
  }
  return files;
}

const srcDir = path.resolve(__dirname, '../src');
const allFiles = getAllFiles(srcDir);

// Sort by normalized relative path (forward slashes)
const sorted = allFiles.map(f => {
  const rel = path.relative(srcDir, f).split(path.sep).join('/');
  return { rel, full: f };
}).sort((a, b) => a.rel.localeCompare(b.rel));

const h = crypto.createHash('sha256');
for (const { rel, full } of sorted) {
  h.update(rel, 'utf8');
  h.update(fs.readFileSync(full));
}

console.log('PROVIDER_FULL_SOURCE_SHA256_BEFORE=' + h.digest('hex'));
console.log('SOURCE_FILE_COUNT_HASHED=' + sorted.length);

// Also count untracked vs git-tracked
const { execSync } = require('child_process');
try {
  const untrackedRaw = execSync('git ls-files --others --exclude-standard src/', {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8'
  });
  const untracked = untrackedRaw.trim().split('\n').filter(Boolean);
  console.log('UNTRACKED_SRC_FILE_COUNT=' + untracked.length);
  if (untracked.length > 0) {
    console.log('Untracked files:');
    untracked.forEach(f => console.log('  ' + f));
  }
} catch (e) {
  console.log('UNTRACKED_SRC_FILE_COUNT=git_unavailable');
}
