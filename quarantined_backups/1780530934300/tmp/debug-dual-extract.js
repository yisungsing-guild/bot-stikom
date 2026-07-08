const fs = require('fs');

function parseCompactRupiahNumber(raw, opts = null) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const digits = s.replace(/[^0-9.]/g, '').replace(/\./g, '');
  if (!digits) return null;
  const n = parseInt(digits, 10);
  if (!Number.isFinite(n)) return null;
  const o = (opts && typeof opts === 'object') ? opts : {};
  const min = Number.isFinite(o.min) ? o.min : 50_000;
  const max = Number.isFinite(o.max) ? o.max : 50_000_000;
  if (n < min || n > max) return null;
  return n;
}

function extractDualDegreeIntlFeeBasicsFromSection(sectionText, opts = null) {
  const section = String(sectionText || '').replace(/\\n/g, '\n').replace(/\s{2,}/g, ' ').trim();
  if (!section) return null;

  const o = (opts && typeof opts === 'object') ? opts : {};
  const language = String(o.language || '').toLowerCase();
  const languageLabel = language === 'mandarin' ? 'Bahasa Mandarin' : 'Bahasa Inggris';

  const grab = (res, parseOpts = null) => {
    for (const re of res) {
      const baseFlags = (re.flags || '');
      const flags = baseFlags.includes('g') ? baseFlags : baseFlags + 'g';
      const r2 = new RegExp(re.source, flags);
      for (const m of section.matchAll(r2)) {
        if (m && m[1]) {
          const n = parseCompactRupiahNumber(m[1], parseOpts);
          if (n) return n;
        }
      }
    }
    return null;
  };

  const pendaftaran = grab([
    /\b1\s*\.\s*Pendaftaran\s*([0-9][0-9.]{0,20})/i,
    /\bPendaftaran\s*([0-9][0-9.]{0,20})/i
  ], { min: 100_000, max: 50_000_000 });

  const dpp = grab([
    /\b2\s*[\.\)]\s*(?:Dana[\s\S]*?Pendidikan[\s\S]*?Pokok|DanaPendidikanPokok)\s*(?:\(\s*DPP\s*\))?[^0-9]{0,200}([0-9][0-9.\s]{0,60})/i,
    /(?:Dana[\s\S]*?Pendidikan[\s\S]*?Pokok|DanaPendidikanPokok)[^0-9]{0,200}([0-9][0-9.\s]{0,60})/i,
    /Dana\s*Pendidikan[^0-9]{0,200}([0-9][0-9.\s]{0,60})/i
  ], { min: 100_000, max: 250_000_000 });

  const bahasa = grab([
    new RegExp(`\\bBahasa\\s+${language === 'mandarin' ? 'Mandarin' : 'Inggris'}\\s*([0-9][0-9.]{0,20})`, 'i'),
    /\bBahasa\s+(?:Inggris|Mandarin)\s*([0-9][0-9.]{0,20})/i
  ], { min: 100_000, max: 100_000_000 });

  const biayaPendidikan = grab([
    /\b4\s*\.\s*Biaya\s*Pendidikan\s*Per\s*Semester\s*([0-9][0-9.]{0,20})/i,
    /(?:^|\n)\s*Biaya\s*Pendidikan\s*Per\s*Semester\s*([0-9][0-9.]{0,20})/im,
    /Biaya\s*Pendidikan\s*&\s*Ujian\/Subject[^0-9]{0,40}([0-9][0-9.]{0,20})/i,
    /Biaya\s*Pendidikan[^0-9]{0,40}([0-9][0-9.]{0,20})/i
  ], { min: 100_000, max: 250_000_000 });

  const biayaPendidikanLabel = 'Biaya Pendidikan per semester';

  if (!pendaftaran && !dpp && !biayaPendidikan && !bahasa) return null;
  return {
    pendaftaran,
    dpp,
    bahasa,
    bahasaLabel: languageLabel,
    biayaPendidikan,
    biayaPendidikanLabel,
  };
}

function takeAround(norm, markerRe, window = 250000) {
  const m = markerRe.exec(norm);
  if (!m) return null;
  const start = Math.max(0, m.index);
  const end = Math.min(norm.length, start + window);
  return norm.slice(start, end);
}

const raw = fs.readFileSync('src/data/rag_index.json', 'utf8');
const parsed = JSON.parse(raw);
const corpus = parsed
  .map((x) => (x && typeof x.chunk === 'string') ? x.chunk : '')
  .filter(Boolean)
  .join('\n\n');

const dnuiMarker = /DUAL\s*DEGREE[\s\S]{0,1200}(?:DALIAN\s+NEUSOFT[\s\S]{0,1200}\bDNUI\b|\bDNUI\b)/i;
const helpMarker = /DUAL\s*DEGREE[\s\S]{0,1200}HELP\s+UNIVERSITY/i;

const dnuiSection = takeAround(corpus, dnuiMarker, 250000);
const helpSection = takeAround(corpus, helpMarker, 250000);

const dnui = extractDualDegreeIntlFeeBasicsFromSection(dnuiSection, { language: 'mandarin' });
const help = extractDualDegreeIntlFeeBasicsFromSection(helpSection, { language: 'inggris' });

console.log('DNUI parsed:', dnui);
console.log('HELP parsed:', help);
