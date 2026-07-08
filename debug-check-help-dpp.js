const fs = require('fs');
const path = require('path');

function getBundledIndexCorpus() {
  const p = path.join(__dirname, 'src', 'data', 'rag_index.json');
  const raw = fs.readFileSync(p, 'utf-8');
  let corpus = null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      corpus = parsed
        .map((x) => (x && typeof x.chunk === 'string') ? x.chunk : '')
        .filter(Boolean)
        .join('\n\n');
    }
  } catch (e) {
    corpus = null;
  }
  return corpus || raw.replace(/\\n/g, '\n').replace(/\\r/g, '\n');
}

function parseCompactRupiahNumber(str, opts) {
  const cleaned = String(str || '').replace(/\D/g, '');
  const num = parseInt(cleaned, 10);
  const minVal = (opts && opts.min) || 100000;
  const maxVal = (opts && opts.max) || 250000000;
  if (!Number.isFinite(num) || num < minVal || num > maxVal) return null;
  return num;
}

function extractDualDegreeIntlFeeBasicsFromSection(sectionText, opts = {}) {
  const section = String(sectionText || '').replace(/\\n/g, '\n').replace(/\s{2,}/g, ' ').trim();
  if (!section) return null;
  const language = String((opts && opts.language) || '').toLowerCase();

  const grab = (res, parseOpts = null) => {
    for (const re of res) {
      try {
        const baseFlags = (re.flags || '');
        const flags = baseFlags.includes('g') ? baseFlags : baseFlags + 'g';
        const r2 = new RegExp(re.source, flags);
        for (const m of section.matchAll(r2)) {
          if (m && m[1]) {
            const n = parseCompactRupiahNumber(m[1], parseOpts);
            if (n) return n;
          }
        }
      } catch (e) {
        const m = re.exec(section);
        if (m && m[1]) {
          const n = parseCompactRupiahNumber(m[1], parseOpts);
          if (n) return n;
        }
      }
    }
    return null;
  };

  const pendaftaran = grab([
    /\b1\s*[\.\)]\s*Pendaftaran\s*([0-9][0-9.]{0,20})/i,
    /\bPendaftaran\s*([0-9][0-9.]{0,20})/i
  ], { min: 100000, max: 50000000 });

  const dpp = grab([
    /\b2\s*[\.\)]\s*(?:Dana[\s\S]*?Pendidikan[\s\S]*?Pokok|DanaPendidikanPokok)\s*(?:\(\s*DPP\s*\))?[^0-9]{0,40}([0-9][0-9.]{0,20})/i,
    /(?:Dana[\s\S]*?Pendidikan[\s\S]*?Pokok|DanaPendidikanPokok)[^0-9]{0,40}([0-9][0-9.]{0,20})/i,
    /Dana\s*Pendidikan[^0-9]{0,40}([0-9][0-9.]{0,20})/i
  ], { min: 100000, max: 250000000 });

  const bahasa = grab([
    new RegExp(`\\bBahasa\\s+${language === 'mandarin' ? 'Mandarin' : 'Inggris'}\\s*([0-9][0-9.]{0,20})`, 'i'),
    /\bBahasa\s+(?:Inggris|Mandarin)\s*([0-9][0-9.]{0,20})/i
  ], { min: 100000, max: 100000000 });

  const biayaPendidikan = grab([
    /Biaya\s*Pendidikan\s*&\s*Ujian\/Subject[^0-9]{0,40}([0-9][0-9.]{0,20})/i,
    /\b4\s*[\.\)]\s*Biaya\s*Pendidikan\s*Per\s*Semester\s*([0-9][0-9.]{0,20})/i,
    /(?:^|\n)\s*Biaya\s*Pendidikan\s*Per\s*Semester\s*([0-9][0-9.]{0,20})/im,
    /Biaya\s*Pendidikan[^0-9]{0,40}([0-9][0-9.]{0,20})/i
  ], { min: 100000, max: 250000000 });

  const biayaPendidikanLabel = /Ujian\/Subject/i.test(section) ? 'Biaya Pendidikan & Ujian/Subject' : 'Biaya Pendidikan Per Semester';

  return { pendaftaran, dpp, bahasa, biayaPendidikan, biayaPendidikanLabel };
}

(function main() {
  const norm = getBundledIndexCorpus();
  const helpMarker = /DUAL\s*DEGREE[\s\S]{0,1200}HELP\s+UNIVERSITY/i;
  const takeAround = (markerRe, window = 200000, stopAfterRe = /DUAL\s*DEGREE/i) => {
    const m = markerRe.exec(norm);
    if (!m) return null;
    const start = Math.max(0, m.index);
    let end = Math.min(norm.length, start + window);
    if (stopAfterRe) {
      const tail = norm.slice(start + m[0].length);
      const stopM = stopAfterRe.exec(tail);
      if (stopM && stopM.index >= 0) {
        end = Math.min(end, start + m[0].length + stopM.index);
      }
    }
    return norm.slice(start, end);
  };

  const helpSection = takeAround(helpMarker, 200000, /DUAL\s*DEGREE/i);
  if (!helpSection) {
    console.error('HELP section NOT found');
    process.exit(2);
  }

  const res = extractDualDegreeIntlFeeBasicsFromSection(helpSection, { language: 'inggris' });
  console.log('=== HELP extraction result ===');
  console.log(JSON.stringify(res, null, 2));

  // Print a small context around where DPP-like strings appear
  const idxDPP = helpSection.search(/Dana\s*Pendidikan|DPP|DanaPendidikanPokok/i);
  if (idxDPP >= 0) {
    console.log('\n--- Context around Dana Pendidikan ---');
    console.log(helpSection.slice(Math.max(0, idxDPP - 120), Math.min(helpSection.length, idxDPP + 260)));
  } else {
    console.log('\nNo Dana Pendidikan phrase found in HELP section.');
  }
})();
