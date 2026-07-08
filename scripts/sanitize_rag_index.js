const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'src', 'data', 'rag_index.json');
const BACKUP = FILE + '.bak';

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
}

function applyReplacements(s) {
  if (typeof s !== 'string') return s;
  let out = s;

  // Normalize common mojibake artifacts by removing them
  out = out.replace(/ΓÇ[oª£¥ÿÖ—–]/g, '');
  out = out.replace(/ΓÇ[\u0000-\u00FF]+/g, '');

  // Replace explicit phrases
  out = out.replace(/SMK\s*TI\s*Bali\s*Global/gi, 'sekolah yang relevan (hubungi PMB untuk detail)');
  out = out.replace(/SMK\s*Pandawa\s*Bali\s*Global/gi, 'sekolah yang relevan (hubungi PMB untuk detail)');
  out = out.replace(/SMK\s*TI/gi, 'sekolah yang relevan (hubungi PMB untuk detail)');
  out = out.replace(/SMK\s*Pandawa/gi, 'sekolah yang relevan (hubungi PMB untuk detail)');

  // Replace the placeholder phrase "sekolah tertentu" (and joined variants)
  out = out.replace(/sekolah\s*tertentu/gi, 'silakan hubungi PMB untuk informasi sekolah yang mendapatkan potongan atau beasiswa khusus');
  out = out.replace(/sekolah\s*tertentu\s*dan\s*sekolah\s*tertentu/gi, 'silakan hubungi PMB untuk informasi sekolah yang mendapatkan potongan atau beasiswa khusus');
  out = out.replace(/alumni\s+sekolah\s*tertentu/gi, 'alumni tertentu (silakan hubungi PMB untuk detail)');

  // Collapse multiple spaces produced by replacements
  out = out.replace(/\s{2,}/g, ' ');

  return out;
}

function walk(obj) {
  if (Array.isArray(obj)) {
    return obj.map(walk);
  }
  if (obj && typeof obj === 'object') {
    const res = {};
    for (const k of Object.keys(obj)) res[k] = walk(obj[k]);
    return res;
  }
  if (typeof obj === 'string') return applyReplacements(obj);
  return obj;
}

function main() {
  if (!fs.existsSync(FILE)) {
    console.error('File not found:', FILE);
    process.exit(1);
  }

  console.log('Creating backup:', BACKUP);
  fs.copyFileSync(FILE, BACKUP);

  console.log('Reading and sanitizing', FILE);
  const data = readJson(FILE);
  const cleaned = walk(data);

  console.log('Writing sanitized file (overwriting original)');
  writeJson(FILE, cleaned);
  console.log('Done. Backup at', BACKUP);
}

main();
