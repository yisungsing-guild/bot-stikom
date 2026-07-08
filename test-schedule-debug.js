const fs = require('fs');
const path = require('path');

// Test 1: Check HAS_BUNDLED_RAG_INDEX
const p = path.join(__dirname, 'src', 'data', 'rag_index.json');
let HAS_BUNDLED_RAG_INDEX = false;
try {
  const st = fs.statSync(p);
  HAS_BUNDLED_RAG_INDEX = st && st.isFile() && st.size > 1024;
  console.log('✓ HAS_BUNDLED_RAG_INDEX:', HAS_BUNDLED_RAG_INDEX);
  console.log('  File size:', st.size, 'bytes');
} catch (e) {
  console.log('✗ HAS_BUNDLED_RAG_INDEX check failed:', e.message);
}

// Test 2: Try to load and parse rag_index.json
try {
  const raw = fs.readFileSync(p, 'utf-8');
  console.log('✓ rag_index.json loaded:', raw.length, 'bytes');
  
  const norm = raw.replace(/\\n/g, '\n').replace(/\\r/g, '\n');
  const hasCalendar = /KALENDER\s+PENDAFTARAN\s+MAHASISWA\s+BARU/i.test(norm);
  const hasColumns = /GELOMBANG\s*\|\s*MASA\s+PENDAFTARAN\s*\|\s*TESTING\s*\|\s*PENGUMUMAN/i.test(norm);
  
  console.log('  Has calendar header:', hasCalendar);
  console.log('  Has column header:', hasColumns);
} catch (e) {
  console.log('✗ Failed to load rag_index:', e.message);
}

// Test 3: Check parseScheduleWaveKey logic
function toRomanUpTo12(n) {
  const map = {
    1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI',
    7: 'VII', 8: 'VIII', 9: 'IX', 10: 'X', 11: 'XI', 12: 'XII'
  };
  return map[n] || null;
}

function parseScheduleWaveKey(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const lowered = raw.toLowerCase();
  if (/\bkhusus\b/.test(lowered)) return 'KHUSUS';

  const sisipan = /(gelombang\s*)?sisipan\s*([0-9]{1,2})\b/i.exec(raw);
  if (sisipan && sisipan[2]) return `SISIPAN ${String(sisipan[2]).trim()}`;

  // Embedded compact
  const embeddedCompact = /\b([0-9]{1,2}|[ivx]{1,6})([a-c])\b/i.exec(raw);
  if (embeddedCompact) {
    const base = String(embeddedCompact[1] || '').trim();
    const letter = String(embeddedCompact[2] || '').toUpperCase();
    let roman = null;
    if (/^[0-9]+$/.test(base)) roman = toRomanUpTo12(parseInt(base, 10));
    else roman = base.toUpperCase();
    if (roman) return `${roman} ${letter}`;
  }

  // Normalize and allow compact forms like "2b" / "iib" / "IIB".
  let s = raw
    .replace(/\u200B/g, '')
    .replace(/([0-9])\uFE0F?\u20E3/g, '$1')
    .replace(/\b(gelombang|gel\.?|gbg)\b/gi, ' ')
    .replace(/[\(\)\[\]\{\}]/g, ' ')
    .replace(/[\-_/\\,;:]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const compact = /^([0-9]{1,2}|[ivx]{1,6})\s*([a-c])?$/i.exec(s.replace(/\s+/g, ''));
  if (compact) {
    const base = String(compact[1] || '').trim();
    const letter = (compact[2] || '').toUpperCase();
    let roman = null;
    if (/^[0-9]+$/.test(base)) roman = toRomanUpTo12(parseInt(base, 10));
    else roman = base.toUpperCase();
    if (!roman) return null;
    return letter ? `${roman} ${letter}` : roman;
  }

  const spaced = /^\s*([0-9]{1,2}|[ivx]{1,6})\s+([a-c])\s*$/i.exec(s);
  if (spaced) {
    const base = String(spaced[1] || '').trim();
    const letter = String(spaced[2] || '').toUpperCase();
    let roman = null;
    if (/^[0-9]+$/.test(base)) roman = toRomanUpTo12(parseInt(base, 10));
    else roman = base.toUpperCase();
    if (!roman) return null;
    return `${roman} ${letter}`;
  }

  const baseOnly = /^\s*([0-9]{1,2}|[ivx]{1,6})\s*$/i.exec(s);
  if (baseOnly) {
    const base = String(baseOnly[1] || '').trim();
    if (/^[0-9]+$/.test(base)) return toRomanUpTo12(parseInt(base, 10));
    return base.toUpperCase();
  }

  return null;
}

function isAdmissionScheduleQuestion(rawText) {
  const t = String(rawText || '').trim().toLowerCase();
  if (!t) return false;

  const hasScheduleWord = /(jadwal|kalender|masa\s+pendaftaran|testing|test\b|pengumuman|registrasi\s+ulang|daftar\s+ulang|deadline|batas\s+waktu|penutupan|sampai\s+kapan)/i.test(t);
  const mentionsWave = /\b(gelombang|gel\.?|gbg|khusus|sisipan)\b/i.test(t);
  const mentionsAdmission = /(pmb|pendaftaran|penerimaan\s+mahasiswa\s+baru|mahasiswa\s+baru|registrasi)/i.test(t);

  if (hasScheduleWord) {
    try {
      const waveKey = parseScheduleWaveKey(rawText);
      const norm = waveKey ? String(waveKey).trim().toUpperCase().replace(/\s{2,}/g, ' ') : '';
      const isSpecial = norm === 'KHUSUS' || /^SISIPAN\s+[0-9]{1,2}$/.test(norm);
      const hasLetter = /\b[A-C]\b/.test(norm);
      if (norm && (isSpecial || hasLetter)) return true;
    } catch (e) {
      // ignore
    }
  }

  if (hasScheduleWord && (mentionsAdmission || mentionsWave)) return true;
  if (mentionsWave && /(pendaftaran|registrasi|testing|test\b|pengumuman|daftar\s+ulang)/i.test(t)) return true;

  return false;
}

// Test examples
const testCases = [
  'jadwal gelombang 2C?',
  'jadwal 2C',
  'gelombang 2 C',
  'jadwal pendaftaran II B',
  'testing khusus',
  'PMB jadwal'
];

console.log('\n--- Test parseScheduleWaveKey ---');
for (const tc of testCases) {
  const result = parseScheduleWaveKey(tc);
  console.log(`"${tc}" => "${result}"`);
}

console.log('\n--- Test isAdmissionScheduleQuestion ---');
for (const tc of testCases) {
  const result = isAdmissionScheduleQuestion(tc);
  console.log(`"${tc}" => ${result}`);
}
