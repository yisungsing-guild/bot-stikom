const { getRagIndexPath } = require('../src/utils/ragPaths');
const fs = require('fs');
const path = require('path');

const INDEX_PATH = getRagIndexPath();
if (!fs.existsSync(INDEX_PATH)) {
  console.error('Index not found at', INDEX_PATH);
  process.exit(2);
}

const raw = fs.readFileSync(INDEX_PATH, 'utf8');
const idx = JSON.parse(raw || '[]');

const trainingId = 'a76df111-bc3f-4122-9066-3aa29d3cf22b';
let related = idx.filter(it => it && String(it.trainingId || '').trim() === trainingId);
if (!related || related.length === 0) {
  related = idx.filter(it => it && String(it.filename || '').toLowerCase().includes('sk pembina ormawa'));
}

if (!related || related.length === 0) {
  console.error('No related SK chunks found');
  process.exit(2);
}

const combined = related.map(r => String(r.chunk || '')).join('\n');

function tidyOrgName(raw) {
  if (!raw) return '';
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (s === s.toUpperCase()) {
    return s.toLowerCase().split(' ').map(w => {
      if (w.length <= 2) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  }
  return s;
}

function cleanFromTrailingNames(part) {
  if (!part) return '';
  part = part.split(/,|\(| - |—/)[0].trim();
  const tokens = part.split(/\s+/).filter(Boolean);
  const nameStopWords = new Set(['i','ni','made','putu','kadek','komang','gede','nyoman','agus','wayan','ketut','ida','ayu','siti','muhammad','putra','putri','adi','indra','raden','dedy','pande','budi','rama']);
  const out = [];
  for (const t of tokens) {
    const tl = t.replace(/\./g, '').toLowerCase();
    if (!tl) break;
    if (nameStopWords.has(tl)) break;
    if (/^(s|m|dr|drs|ir|mst|st|mt|msi|phd|prof)$/.test(tl)) break;
    if (/\d/.test(tl)) break;
    out.push(t);
    if (out.length >= 4) break;
  }
  return tidyOrgName(out.join(' '));
}

const lines = combined.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
const results = new Set();
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  // numbered pattern like '1 BEM' or '15 UKM FUTSAL PANDE ...'
  let m = l.match(/^\s*(\d{1,3})\s+(.*)$/);
  if (m) {
    let rest = m[2].trim();
    // if rest is just a short uppercase word, it may be org name; else if it is 'UKM X' capture X
    const m2 = rest.match(/^(?:UKM\s+)?(.+)$/i);
    let candidate = m2 ? m2[1].trim() : rest;
    // If next line looks like continuation (no comma and mostly uppercase words), append
    if (i + 1 < lines.length) {
      const next = lines[i + 1];
      if (!/,/.test(next) && /^[A-Z0-9\s.'-]+$/.test(next) && next.split(/\s+/).length <= 6) {
        candidate = (candidate + ' ' + next).trim();
        i++;
      }
    }
    const cleaned = cleanFromTrailingNames(candidate);
    if (cleaned) results.add(cleaned);
    continue;
  }
  // Fallback: inline 'UKM NAME' occurrences
  const reInline = /\bUKM\b[:\-\s]*([^,\n]+)/gi;
  let mm;
  while ((mm = reInline.exec(l)) !== null) {
    const c = cleanFromTrailingNames(mm[1] || '');
    if (c) results.add(c);
  }
}

const arr = Array.from(results).filter(Boolean).sort((a,b)=>a.localeCompare(b));
// Build canonical groups to merge variants (e.g., 'GHoST' and 'Ghost', or 'Mcos' and 'Mcos Edwar')
const nameStopWords = new Set(['i','ni','made','putu','kadek','komang','gede','nyoman','agus','wayan','ketut','ida','ayu','siti','muhammad','putra','putri','adi','indra','raden','dedy','pande','budi','rama']);
function canonicalize(n) {
  let s = String(n || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s{2,}/g, ' ').trim();
  const toks = s.split(/\s+/).filter(Boolean).filter(t => !nameStopWords.has(t));
  return toks.slice(0, 3).join(' ');
}

const groups = new Map();
for (const name of arr) {
  const key = canonicalize(name) || name.toLowerCase();
  if (!groups.has(key)) groups.set(key, new Set());
  groups.get(key).add(name);
}

const canonicalList = Array.from(groups.keys()).sort((a,b)=>a.localeCompare(b));
console.log(`Found ${canonicalList.length} UKM/Ormawa (canonical groups):`);
const finalNames = [];
canonicalList.forEach((k) => {
  const variants = Array.from(groups.get(k));
  // prefer the shortest variant (fewest tokens), then shortest length
  variants.sort((a,b) => (a.split(/\s+/).length - b.split(/\s+/).length) || (a.length - b.length));
  const pick = variants[0];
  finalNames.push(tidyOrgName(pick));
});

console.log('\nCleaned UKM/Ormawa list:');
finalNames.sort((a,b)=>a.localeCompare(b)).forEach((n,i) => console.log(`${i+1}. ${n}`));

// Also report raw count of 'UKM' occurrences in the combined text
const rawMatches = (combined.match(/\bUKM\b/gi) || []).length;
console.log('\nRaw UKM keyword occurrences in SK chunks:', rawMatches);

// Save to file for inspection
const outPath = path.join(__dirname, '..', 'tmp', 'ukm_list_clean.txt');
try {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, arr.map((v,i)=>`${i+1}. ${v}`).join('\n'));
  console.log('Saved cleaned list to', outPath);
} catch(e) {
  // ignore
}

// Also produce the list derived strictly from numbered 'UKM' lines in the SK
const reNumAll = /(?:^|\n)\s*\d{1,3}\s*(?:\.|\))?\s*UKM\s+([^,\n]+)/gi;
const strict = new Set();
let mm;
while ((mm = reNumAll.exec(combined)) !== null) {
  const c = cleanFromTrailingNames(mm[1] || '');
  if (c) strict.add(c);
}
const strictArr = Array.from(strict).filter(Boolean).sort((a,b)=>a.localeCompare(b));
console.log('\nStrict UKM list (from numbered UKM entries):', strictArr.length);
strictArr.forEach((n,i) => console.log(`${i+1}. ${n}`));

const strictPath = path.join(__dirname, '..', 'tmp', 'ukm_list_strict.txt');
try { fs.writeFileSync(strictPath, strictArr.map((v,i)=>`${i+1}. ${v}`).join('\n')); console.log('Saved strict list to', strictPath); } catch(e) {}
