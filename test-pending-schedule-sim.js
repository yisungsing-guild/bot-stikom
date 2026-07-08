// Simulate pendingScheduleWave handling to verify fee-vs-schedule routing
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

function looksLikeScheduleWaveSelectionReply(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  if (t.length > 80) return false;
  if (/\b(khusus|sisipan)\b/i.test(t)) return true;
  if (/\b(gelombang|gel\.?|gbg)\b/i.test(t)) return true;
  if (/^\s*([0-9]{1,2}|[ivx]{1,6})\s*([a-c])\s*$/i.test(t)) return true;
  if (/^\s*([0-9]{1,2}|[ivx]{1,6})([a-c])\s*$/i.test(t.replace(/\s+/g, ''))) return true;
  if (/\b([0-9]{1,2}|[ivx]{1,6})\s*[a-c]\b/i.test(t) && (t.length <= 40 || /\b(cek|yang|gelombang)\b/i.test(t))) {
    return true;
  }
  return false;
}

function extractSpecificProgramHint(txt) {
  const t = String(txt || '').toLowerCase();
  const map = { si: 'SI', ti: 'TI', bd: 'BD', sk: 'SK', d3: 'D3', s2: 'S2' };
  for (const k of Object.keys(map)) {
    if (new RegExp('\\b' + k + '\\b', 'i').test(t)) return map[k];
  }
  if (/sistem informasi/i.test(t)) return 'SI';
  if (/teknologi informasi/i.test(t)) return 'TI';
  return null;
}

function simulate(input) {
  const trimmed = String(input || '').trim();
  const waveKey = parseScheduleWaveKey(trimmed);
  const looksLikeWaveReply = looksLikeScheduleWaveSelectionReply(trimmed);
  const wantsCost = /(biaya|dpp|tanpa\s+potongan|pembayaran|cicil|cicilan)/i.test(trimmed);
  const wantsDiscount = /(potongan|diskon)/i.test(trimmed);
  const programFromText = extractSpecificProgramHint(trimmed) || null;

  const isExplicitWaveWord = /\b(gelombang|gel\.?|gbg)\b/i.test(trimmed);
  const isSpecialWave = waveKey === 'KHUSUS' || /^SISIPAN\s+/i.test(String(waveKey || ''));
  const hasLetter = waveKey && /\b[A-C]\b/.test(String(waveKey || ''));
  const looksLikeWave = (isSpecialWave || hasLetter) && (looksLikeWaveReply || isExplicitWaveWord);

  let transformed = trimmed;
  if (looksLikeWave && waveKey) {
    if (wantsCost || wantsDiscount || programFromText) {
      const base = waveKey === 'KHUSUS' ? 'khusus' : waveKey;
      if (/tanpa\s+potongan/i.test(trimmed)) transformed = `biaya pendaftaran gelombang ${base} tanpa potongan`;
      else if (wantsDiscount) transformed = `potongan biaya pendaftaran gelombang ${base}`;
      else transformed = `biaya pendaftaran gelombang ${base}`;
    } else {
      if (waveKey === 'KHUSUS') transformed = 'jadwal gelombang khusus';
      else transformed = `jadwal gelombang ${waveKey}`;
    }
  }

  return { input, waveKey, wantsCost, wantsDiscount, programFromText, transformed };
}

const tests = [
  'biaya prodi ti gelombang 2a',
  'biaya ti gelombang 2B',
  'jadwal gelombang 2C',
  '2C',
  'gelombang 3C',
  'biaya gelombang 2a tanpa potongan',
  'potongan gelombang 2a',
  'prodi SI gelombang II B biaya'
];

for (const t of tests) {
  console.log('---');
  console.log('input:', t);
  console.log(simulate(t));
}
