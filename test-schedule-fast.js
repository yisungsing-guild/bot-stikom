const fs = require('fs');
const path = require('path');

function toRomanUpTo12(num) {
  if (typeof num !== 'number' || num < 1 || num > 12) return null;
  const roman = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];
  return roman[num-1] || null;
}

function parseScheduleWaveKey(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const lowered = raw.toLowerCase();
  if (/\bkhusus\b/.test(lowered)) return 'KHUSUS';
  const sisipan = /(gelombang\s*)?sisipan\s*([0-9]{1,2})\b/i.exec(raw);
  if (sisipan && sisipan[2]) return `SISIPAN ${String(sisipan[2]).trim()}`;
  const embeddedCompact = /\b([0-9]{1,2}|[ivx]{1,6})([a-c])\b/i.exec(raw);
  if (embeddedCompact) {
    const base = String(embeddedCompact[1] || '').trim();
    const letter = String(embeddedCompact[2] || '').toUpperCase();
    let roman = null;
    if (/^[0-9]+$/.test(base)) roman = toRomanUpTo12(parseInt(base,10)); else roman = base.toUpperCase();
    if (roman) return `${roman} ${letter}`;
  }
  const embeddedSpaced = /\b([0-9]{1,2}|[ivx]{1,6})\s+([a-c])\b/i.exec(raw);
  if (embeddedSpaced) {
    const base = String(embeddedSpaced[1] || '').trim();
    const letter = String(embeddedSpaced[2] || '').toUpperCase();
    let roman = null;
    if (/^[0-9]+$/.test(base)) roman = toRomanUpTo12(parseInt(base,10)); else roman = base.toUpperCase();
    if (roman) return `${roman} ${letter}`;
  }
  let s = raw.replace(/\u200B/g, '')
    .replace(/([0-9])\uFE0F?\u20E3/g, '$1')
    .replace(/\b(gelombang|gel\.?|gbg)\b/gi, ' ')
    .replace(/[\(\)\[\]\{\}]/g, ' ')
    .replace(/[\-_/\\,;:]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const compact = /^([0-9]{1,2}|[ivx]{1,6})\s*([a-c])?$/i.exec(s.replace(/\s+/g,''));
  if (compact) {
    const base = String(compact[1] || '').trim();
    const letter = (compact[2] || '').toUpperCase();
    let roman = null;
    if (/^[0-9]+$/.test(base)) roman = toRomanUpTo12(parseInt(base,10)); else roman = base.toUpperCase();
    if (!roman) return null;
    return letter ? `${roman} ${letter}` : roman;
  }
  const spaced = /^\s*([0-9]{1,2}|[ivx]{1,6})\s+([a-c])\s*$/i.exec(s);
  if (spaced) {
    const base = String(spaced[1] || '').trim();
    const letter = String(spaced[2] || '').toUpperCase();
    let roman = null;
    if (/^[0-9]+$/.test(base)) roman = toRomanUpTo12(parseInt(base,10)); else roman = base.toUpperCase();
    if (!roman) return null;
    return `${roman} ${letter}`;
  }
  const baseOnly = /^\s*([0-9]{1,2}|[ivx]{1,6})\s*$/i.exec(s);
  if (baseOnly) {
    const base = String(baseOnly[1] || '').trim();
    if (/^[0-9]+$/.test(base)) return toRomanUpTo12(parseInt(base,10));
    return base.toUpperCase();
  }
  return null;
}

// Extract rows like provider.js
const p = path.join(__dirname, 'src', 'data', 'rag_index.json');
const raw = fs.readFileSync(p, 'utf8');
const norm = raw.replace(/\\n/g, '\n').replace(/\\r/g, '\n');

const canonicalizeWaveKey = (rawKey) => {
  const s = String(rawKey || '').toUpperCase().replace(/\s{2,}/g, ' ').trim();
  if (!s) return '';
  if (s === 'KHUSUS') return 'KHUSUS';
  const compact = s.replace(/\s+/g, '');
  const sis = /^SISIPAN([0-9]{1,2})$/.exec(compact);
  if (sis && sis[1]) return `SISIPAN ${sis[1]}`;
  const romanLetter = /^([IVX]{1,6})([A-C])$/.exec(compact);
  if (romanLetter) return `${romanLetter[1]} ${romanLetter[2]}`;
  const spacedRomanLetter = /^([IVX]{1,6})\s+([A-C])$/.exec(s);
  if (spacedRomanLetter) return `${spacedRomanLetter[1]} ${spacedRomanLetter[2]}`;
  return s;
};

const normalizeRange = (s) => String(s || '').replace(/\n+/g,' ').replace(/\s{2,}/g,' ').trim();

const rowRegex = /(?:^|\n)\s*(KHUSUS|SISIPAN\s*[0-9]{1,2}|[IVX]{1,6}\s*[A-C])\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^\n]*?s\s*\/\s*d[^\n]*)/gi;
const bestByKey = new Map();
let m; let rowMatches=0;
while ((m = rowRegex.exec(norm)) !== null) {
  rowMatches++;
  const key = canonicalizeWaveKey(m[1]);
  if (!key) continue;
  const row = {
    key,
    masaPendaftaran: normalizeRange(m[2]),
    testing: normalizeRange(m[3]),
    pengumuman: normalizeRange(m[4]),
    registrasi: normalizeRange(m[5])
  };
  if (!row.masaPendaftaran || !row.testing || !row.pengumuman || !row.registrasi) continue;
  const prev = bestByKey.get(key);
  if (!prev) bestByKey.set(key, row);
}
const rows = Array.from(bestByKey.values());
const byKey = {};
for (const r of rows) byKey[r.key] = r;

const tests = ['jadwal gelombang 2C', 'jadwal gelombang 3C', 'jadwal 2C', '2C', 'jadwal gelombang II C'];
for (const t of tests) {
  const wave = parseScheduleWaveKey(t);
  const normKey = wave ? String(wave).trim().toUpperCase().replace(/\s{2,}/g,' ') : null;
  const found = normKey && byKey[normKey] ? true : false;
  console.log(`${t} -> waveKey=${wave} norm=${normKey} found=${found}`);
  if (found) console.log(byKey[normKey]);
}
