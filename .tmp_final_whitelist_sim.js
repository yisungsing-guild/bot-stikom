const fs = require('fs');
const path = require('path');

function getAllowedAcademicCategoriesOriginal(intent) {
  const allowedCategoriesByIntent = {
    'DEFINISI_PRODI': ['PROGRAM_STUDI', 'INFO'],
    'FOKUS_PRODI': ['KURIKULUM', 'PROGRAM_STUDI'],
    'MATA_KULIAH': ['KURIKULUM', 'PROGRAM_STUDI'],
    'PROSPEK_KERJA': ['KARIR', 'PROGRAM_STUDI'],
    'KURIKULUM_PEMBELAJARAN': ['KURIKULUM', 'PROGRAM_STUDI'],
    'GENERAL': ['PROGRAM_STUDI', 'INFO', 'KARIR', 'KURIKULUM'],
  };
  return new Set(allowedCategoriesByIntent[intent] || []);
}
function getAllowedAcademicCategoriesPatched(intent) {
  const allowedCategoriesByIntent = {
    'DEFINISI_PRODI': ['PROGRAM_STUDI', 'INFO', 'KURIKULUM'],
    'FOKUS_PRODI': ['KURIKULUM', 'PROGRAM_STUDI'],
    'MATA_KULIAH': ['KURIKULUM', 'PROGRAM_STUDI'],
    'PROSPEK_KERJA': ['KARIR', 'PROGRAM_STUDI'],
    'KURIKULUM_PEMBELAJARAN': ['KURIKULUM', 'PROGRAM_STUDI'],
    'GENERAL': ['PROGRAM_STUDI', 'INFO', 'KARIR', 'KURIKULUM'],
  };
  return new Set(allowedCategoriesByIntent[intent] || []);
}
function getAcademicIntentEvidenceRegex(intent) {
  const regexByIntent = {
    'DEFINISI_PRODI': /\b(apa\s+itu|apa\s+yang\s+dimaksud|pengertian|definisi|mengenai|penjelasan|istilah|profil\s+lulusan|tujuan|visi|misi|capaian\s+pembelajaran|deskripsi)\b/i,
    'FOKUS_PRODI': /\b(fokus|keahlian|spesialisasi|konsentrasi|bidang\s+studi|track|minat|peminatan)\b/i,
    'MATA_KULIAH': /\b(mata\s+kuliah|matakuliah|course|kursus|matkul|pembelajaran|kurikulum)\b/i,
    'PROSPEK_KERJA': /\b(prospek\s+kerja|peluang\s+kerja|karir|profesi|pekerjaan|lulusan|lowongan|gaji|pasar\s+kerja)\b/i,
    'KURIKULUM_PEMBELAJARAN': /\b(mata\s+kuliah|matakuliah|kurikulum|pembelajaran|rencana\s+studi)\b/i,
  };
  return regexByIntent[intent] || null;
}

function chunkMatchesAcademicIntentSimulated(chunk, item, academicIntent, usePatched = false) {
  const category = (item.docCategory || item.category || 'UNKNOWN');
  const text = String(chunk || '');
  const allowed = usePatched ? getAllowedAcademicCategoriesPatched(academicIntent) : getAllowedAcademicCategoriesOriginal(academicIntent);

  if (allowed.has(category)) {
    return { passed: true, reason: `category_whitelist:${category}` };
  }
  const regex = getAcademicIntentEvidenceRegex(academicIntent);
  if (regex && regex.test(text)) {
    return { passed: true, reason: 'evidence_regex_match' };
  }
  // fallback: program mention + academic patterns
  const hasProgramMention = /\b(program studi|prodi|program|sistem informasi|sistem\s+informasi|si\b)\b/i.test(text);
  const hasAcademicToken = /\b(mahasiswa|lulusan|pembelajaran|pendidikan|kompetensi|capaian|tujuan)\b/i.test(text);
  if (hasProgramMention && hasAcademicToken) return { passed: true, reason: 'fallback_program_and_academic' };
  return { passed: false, reason: 'no_evidence_for_intent' };
}

function isDoubleDegree(item) {
  const fn = String(item.filename || '').toLowerCase();
  return fn.includes('double') && fn.includes('degree');
}

// Load audit and index
const auditPath = path.join(__dirname, '.tmp_retrieval_results.json');
const indexPath = path.join(__dirname, 'src', 'data', 'rag_index.json');
if (!fs.existsSync(auditPath)) { console.error('Missing .tmp_retrieval_results.json'); process.exit(1); }
if (!fs.existsSync(indexPath)) { console.error('Missing rag_index.json'); process.exit(1); }
const audit = JSON.parse(fs.readFileSync(auditPath, 'utf-8'));
const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
const indexMap = new Map(index.map(i => [i.id, i]));

const results = [];

for (const q of audit) {
  const question = q.question;
  const academicIntent = (q.queryEntities && q.queryEntities.academicIntent) || q.userIntent || q.intent || 'DEFINISI_PRODI';
  const top20 = (q.top20 || []).slice(0, 20);
  const beforePassed = (q.relevantIds || []).map(x => (x.id || x));

  const beforeTopFinal = beforePassed.map(id => {
    const it = indexMap.get(id) || {};
    const r = (q.relevantIds || []).find(x => (x.id || x) === id) || {};
    return { id, filename: it.filename || r.filename || null, program: it.program || r.program, category: it.docCategory || it.category || r.docCategory, composite: r.compositeScore || r.composite || null };
  }).slice(0, 10);

  const afterPassList = [];
  const changed = [];
  for (let i = 0; i < top20.length; i++) {
    const entry = top20[i];
    const item = entry.item || entry;
    const chunkText = item.chunk || '';
    const id = item.id;
    const before = (beforePassed.indexOf(id) >= 0) ? 'PASS' : 'REJECT';
    const simBefore = chunkMatchesAcademicIntentSimulated(chunkText, item, academicIntent, false);
    const simAfter = chunkMatchesAcademicIntentSimulated(chunkText, item, academicIntent, true);
    const after = simAfter.passed ? 'PASS' : 'REJECT';
    if (after === 'PASS') afterPassList.push({ rank: i+1, id, program: item.program, filename: item.filename, category: item.docCategory, composite: entry.compositeScore || entry.composite || null, reason: simAfter.reason });
    if (before === 'REJECT' && after === 'PASS') changed.push({ id, rank: i+1, program: item.program, filename: item.filename, category: item.docCategory, reasonBefore: simBefore.reason, reasonAfter: simAfter.reason });
  }

  const afterTopFinal = afterPassList.sort((a,b) => a.rank - b.rank).slice(0, 10);

  // Non-SI that passed newly
  const nonSInew = changed.filter(c => String(c.program || '').toUpperCase() !== 'SI');
  const doubleDegreeBefore = beforeTopFinal.some(x => (x.filename || '').toLowerCase().includes('double') && (x.filename || '').toLowerCase().includes('degree'));
  const doubleDegreeAfter = afterTopFinal.some(x => (x.filename || '').toLowerCase().includes('double') && (x.filename || '').toLowerCase().includes('degree'));

  results.push({
    question,
    academicIntent,
    before: { passedCount: beforePassed.length, topFinal: beforeTopFinal },
    after: { passedCount: afterPassList.length, topFinal: afterTopFinal },
    changed, // previously rejected then passed
    nonSInew,
    doubleDegreeBefore: !!doubleDegreeBefore,
    doubleDegreeAfter: !!doubleDegreeAfter
  });
}

const outPath = path.join(__dirname, '.tmp_final_sim_results.json');
fs.writeFileSync(outPath, JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2), 'utf-8');
console.log('Simulation complete. Results saved to .tmp_final_sim_results.json');
