const fs = require('fs');
const path = require('path');
const ragEngine = require('../src/engine/ragEngine');

const outPath = path.resolve(__dirname, '..', 'data', 'runtime', 'dynamic_alias_dictionary.json');

function normalizeAlias(value) {
  return String(value || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function titleCase(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().split(' ')
    .map((word) => /^(s[123]|d[34]|si|ti|bd|sk|mi)$/i.test(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function canonicalizeProgramName(value) {
  const text = String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (/\b(?:s2\s+sistem\s+informasi|magister\s+sistem\s+informasi)\b/i.test(text)) return 'S2 Sistem Informasi';
  if (/\bsistem\s+informasi\b/i.test(text)) return 'Sistem Informasi';
  if (/\bteknologi\s+informasi\b/i.test(text)) return 'Teknologi Informasi';
  if (/\bbisnis\s+digital\b/i.test(text)) return 'Bisnis Digital';
  if (/\bsistem\s+komputer\b/i.test(text)) return 'Sistem Komputer';
  if (/\bmanajemen\s+informatika\b/i.test(text)) return 'Manajemen Informatika';
  if (/\bdesain\s+komunikasi\s+visual\b/i.test(text)) return 'Desain Komunikasi Visual';
  if (/\bteknologi\s+rekayasa\s+perangkat\s+lunak\b/i.test(text)) return 'Teknologi Rekayasa Perangkat Lunak';
  if (/\bteknologi\s+komputer\b/i.test(text)) return 'Teknologi Komputer';
  if (/\bdesain\s+grafis\b/i.test(text)) return 'Desain Grafis';
  if (/\bmultimedia\b/i.test(text)) return 'Multimedia';
  if (/\banimasi\b/i.test(text)) return 'Animasi';
  return '';
}

function isUsefulProgramName(value) {
  const text = String(value || '').toLowerCase();
  return /\b(?:s2\s+sistem\s+informasi|magister\s+sistem\s+informasi|sistem\s+informasi|teknologi\s+informasi|bisnis\s+digital|sistem\s+komputer|manajemen\s+informatika|desain\s+komunikasi\s+visual|teknologi\s+rekayasa\s+perangkat\s+lunak|teknologi\s+komputer|multimedia|animasi|desain\s+grafis)\b/i.test(text);
}

function addAlias(out, seen, alias, canonical, type, source) {
  const aliasText = normalizeAlias(alias);
  const canonicalText = titleCase(canonical);
  if (!aliasText || !canonicalText || aliasText.length < 2 || canonicalText.length < 3) return;
  if (aliasText === normalizeAlias(canonicalText)) return;
  const key = aliasText + '->' + normalizeAlias(canonicalText);
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ alias: aliasText, canonical: canonicalText, type: type || 'document_alias', source: source || null });
}

function build(index) {
  const list = Array.isArray(index) ? index : [];
  const signature = list.slice(0, 2500).map((item) => [item && item.id, item && item.trainingId, item && item.filename, item && item.sourceFile, String(item && item.chunk || '').length].join(':')).join('|');
  const out = [];
  const seen = new Set();

  for (const item of list.slice(0, 2500)) {
    const source = item && (item.filename || item.sourceFile || item.trainingId || item.id) || null;
    const text = String((item && (item.filename || item.sourceFile || '')) + '\n' + (item && item.chunk || '')).replace(/\s+/g, ' ').trim();
    if (!text) continue;

    const programMatches = Array.from(text.matchAll(/(?:program\s+studi|prodi|jurusan)\s+((?:S[123]|D[34])?\s*[A-Za-z][A-Za-z0-9\s/&.-]{2,70}?)(?=\s+(?:terakreditasi|akreditasi|semester|gelombang|tahun|biaya|adalah|:|-)|[.;,()\n]|$)/gi));
    for (const match of programMatches) {
      const canonical = String(match[1] || '').replace(/\b(?:di|pada|dengan|untuk|yang|adalah)\b.*$/i, '').trim();
      const canonicalProgram = canonicalizeProgramName(canonical);
      if (!canonical || canonical.length > 80 || !canonicalProgram) continue;
      const acronym = canonicalProgram.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').toLowerCase();
      if (acronym.length >= 2 && acronym.length <= 5) addAlias(out, seen, acronym, canonicalProgram, 'program', source);
    }

    if (/\b(S2\s+Sistem\s+Informasi|Magister\s+Sistem\s+Informasi)\b/i.test(text) || (/\b(?:pascasarjana|pasca\s*sarjana|magister)\b/i.test(text) && /\bsistem\s+informasi\b/i.test(text))) {
      for (const alias of ['s2', 's 2', 'pasca', 'pascasarjana', 'pasca sarjana', 'magister', 'master', 'program pascasarjana']) {
        addAlias(out, seen, alias, 'S2 Sistem Informasi', 'degree_program', source);
      }
    }

    if (out.length >= 400) break;
  }

  return { version: 1, signature, generatedAt: new Date().toISOString(), aliasCount: out.length, aliases: out };
}

const index = ragEngine.loadIndex();
const payload = build(index);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
console.log(JSON.stringify({ ok: true, path: outPath, indexCount: Array.isArray(index) ? index.length : 0, aliasCount: payload.aliasCount, sample: payload.aliases.slice(0, 12) }, null, 2));
