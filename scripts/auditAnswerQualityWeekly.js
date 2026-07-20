const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = { days: 7, file: path.resolve(__dirname, '..', 'tmp', 'answer-quality.jsonl'), limit: 30 };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--days=')) out.days = Math.max(1, Number(arg.slice('--days='.length)) || 7);
    else if (arg.startsWith('--file=')) out.file = path.resolve(arg.slice('--file='.length));
    else if (arg.startsWith('--limit=')) out.limit = Math.max(1, Number(arg.slice('--limit='.length)) || 30);
  }
  return out;
}

function normalizeQuestion(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function detectGapHint(question) {
  const q = String(question || '').toLowerCase();
  if (/\bbccp\b/i.test(q)) return 'Tambahkan dokumen resmi BCCP: definisi, peserta, apakah untuk mahasiswa asing, syarat, jadwal, alur.';
  if (/\blinked\s*in|linkedin\b/i.test(q)) return 'Tambahkan dokumen program LinkedIn/Career Center: bentuk kegiatan, jadwal, pendaftaran, PIC.';
  if (/\bsoftskill|career\s*center|karier|karir\b/i.test(q)) return 'Lengkapi dokumen Career Center/softskill: daftar kegiatan, target peserta, jadwal, cara ikut.';
  if (/\bbahasa|language\s+learning|llc\b/i.test(q)) return 'Lengkapi dokumen Language Learning Center: bahasa yang tersedia, jadwal, biaya jika ada, cara mendaftar.';
  if (/\bgccp\b/i.test(q)) return 'Lengkapi dokumen GCCP: definisi ringkas, aktivitas, negara/mitra, syarat, jadwal, pendaftaran.';
  if (/\bremedial|absensi|presensi|ujian\s+susulan\b/i.test(q)) return 'Tambahkan dokumen kebijakan akademik resmi: remedial, absensi, ujian susulan, dispensasi.';
  if (/\bukm|ormawa|esport|musik|vos|futsal|basket\b/i.test(q)) return 'Lengkapi dokumen UKM: deskripsi tiap UKM, kegiatan rutin, kontak, jadwal pendaftaran.';
  return 'Perlu review manual: belum terlihat istilah dokumen yang jelas dari pertanyaan.';
}

function main() {
  const args = parseArgs(process.argv);
  const sinceMs = Date.now() - args.days * 24 * 60 * 60 * 1000;
  if (!fs.existsSync(args.file)) {
    console.log('ANSWER QUALITY WEEKLY AUDIT');
    console.log('No log file found:', args.file);
    process.exit(0);
  }

  const rows = fs.readFileSync(args.file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch (_) { return null; } })
    .filter(Boolean)
    .filter((row) => {
      const ts = Date.parse(row.ts || '');
      return Number.isFinite(ts) && ts >= sinceMs;
    });

  const weak = rows.filter((row) => {
    const tier = String(row.confidenceTier || '').toUpperCase();
    const action = String(row.action || '').toLowerCase();
    return action === 'fallback' || action === 'clarify' || tier === 'LOW' || tier === 'VERY_LOW';
  });

  const byQuestion = new Map();
  const byCategory = new Map();
  const byHint = new Map();
  for (const row of weak) {
    const q = normalizeQuestion(row.question);
    if (!q) continue;
    const hintInput = q + ' ' + String(row.answerPreview || '');
    const rowHint = detectGapHint(hintInput);
    const item = byQuestion.get(q) || { question: q, count: 0, categories: new Set(), sources: new Set(), tiers: new Set(), hint: rowHint };
    if (/review manual/i.test(item.hint) && !/review manual/i.test(rowHint)) item.hint = rowHint;
    item.count += 1;
    if (row.category) item.categories.add(row.category);
    if (row.source) item.sources.add(row.source);
    if (row.confidenceTier) item.tiers.add(row.confidenceTier);
    byQuestion.set(q, item);

    const cat = row.category || 'unknown';
    byCategory.set(cat, (byCategory.get(cat) || 0) + 1);
    const hint = item.hint;
    byHint.set(hint, (byHint.get(hint) || 0) + 1);
  }

  const topQuestions = Array.from(byQuestion.values()).sort((a, b) => b.count - a.count || a.question.localeCompare(b.question)).slice(0, args.limit);
  const topCategories = Array.from(byCategory.entries()).sort((a, b) => b[1] - a[1]);
  const topHints = Array.from(byHint.entries()).sort((a, b) => b[1] - a[1]);

  console.log('ANSWER QUALITY WEEKLY AUDIT');
  console.log('File:', args.file);
  console.log('Window days:', args.days);
  console.log('Rows scanned:', rows.length);
  console.log('Fallback/low-confidence rows:', weak.length);

  console.log('\nBy category:');
  if (!topCategories.length) console.log('- none');
  for (const [category, count] of topCategories) console.log('- ' + category + ': ' + count);

  console.log('\nRecommended document gaps:');
  if (!topHints.length) console.log('- none');
  for (const [hint, count] of topHints) console.log('- (' + count + 'x) ' + hint);

  console.log('\nTop failed/low-confidence questions:');
  if (!topQuestions.length) console.log('- none');
  for (const item of topQuestions) {
    console.log('- (' + item.count + 'x) ' + item.question);
    console.log('  categories=' + (Array.from(item.categories).join(',') || '-') + ' sources=' + (Array.from(item.sources).join(',') || '-') + ' tiers=' + (Array.from(item.tiers).join(',') || '-'));
    console.log('  gap=' + item.hint);
  }
}

main();
