const fs = require('fs');
const path = require('path');
const {
  query,
  extractStructuredEntities,
  computeEmbedding,
  getChunkScoreBreakdown,
  filterRelevantChunks,
  applyIntentAwareFilteringAndValidation
} = require('./src/engine/ragEngine');
const { classifyIntent, detectIntent } = require('./src/engine/intentClassifier');

function normalizeIndonesianQuestionText(raw) {
  let t = String(raw || '').toLowerCase();
  if (!t.trim()) return '';
  t = t
    .replace(/[\u200B-\u200D\uFEFF]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const repl = [
    [/\byg\b/g, 'yang'],
    [/\bdmn\b/g, 'di mana'],
    [/\bgmn\b/g, 'bagaimana'],
    [/\bbrp\b/g, 'berapa'],
    [/\butk\b/g, 'untuk'],
    [/\bdr\b/g, 'dari'],
    [/\bdpt\b/g, 'dapat'],
    [/\btdk\b/g, 'tidak'],
    [/\bgk\b/g, 'tidak'],
    [/\bga\b/g, 'tidak'],
    [/\bgak\b/g, 'tidak'],
    [/\bnggak\b/g, 'tidak'],
    [/\benggak\b/g, 'tidak'],
    [/\btrs\b/g, 'terus'],
    [/\btrus\b/g, 'terus'],
    [/\budh\b/g, 'sudah'],
    [/\budah\b/g, 'sudah'],
    [/\baja\b/g, 'saja'],
    [/\bbgt\b/g, 'banget'],
    [/\bpls\b/g, 'tolong'],
    [/\bplis\b/g, 'tolong'],
    [/\bpliss\b/g, 'tolong'],
    [/\bmin\b/g, 'admin'],
    [/\bngoding\b/g, 'coding'],
    [/\bngod\b/g, 'coding']
  ];
  for (const [re, to] of repl) t = t.replace(re, to);
  t = t.replace(/([a-z])\1{2,}/g, '$1$1');
  t = t.replace(/\b(kak|kakak|kaka|dong|deh|nih|yaa|ya|yah|hehe|wkwk|admin)\b/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return t;
}

function normalizeQueryForRetrieval(rawQuery) {
  let q = String(rawQuery || '').toLowerCase().trim();
  const abbrevMap = {
    brp: 'berapa',
    glw: 'gelombang',
    glmb: 'gelombang',
    ti: 'teknologi informasi',
    si: 'sistem informasi',
    bd: 'bisnis digital',
    mi: 'manajemen informatika',
    sk: 'sistem komputer',
    dpp: 'dana pendidikan pokok',
    ukt: 'uang kuliah tunggal',
    spp: 'sumbangan pembinaan pendidikan',
    pmb: 'penerimaan mahasiswa baru',
    tgl: 'tanggal',
    dl: 'deadline'
  };
  for (const [short, long] of Object.entries(abbrevMap)) {
    q = q.replace(new RegExp(`\\b${short}\\b`, 'g'), long);
  }
  const expansions = {
    ti: ['teknologi informasi', 'program studi teknologi informasi', 'profil teknologi informasi'],
    'teknologi informasi': ['program studi teknologi informasi', 'profil teknologi informasi'],
    si: ['sistem informasi', 'program studi sistem informasi', 'profil sistem informasi'],
    'sistem informasi': ['program studi sistem informasi', 'profil sistem informasi'],
    bd: ['bisnis digital', 'program studi bisnis digital', 'profil bisnis digital'],
    'bisnis digital': ['program studi bisnis digital', 'profil bisnis digital'],
    mi: ['manajemen informatika', 'program studi manajemen informatika', 'profil manajemen informatika'],
    sk: ['sistem komputer', 'program studi sistem komputer', 'profil sistem komputer']
  };
  const rawLower = String(rawQuery || '').toLowerCase();
  const added = [];
  for (const [key, list] of Object.entries(expansions)) {
    const re = new RegExp(`\\b${key.replace(/[\\-\\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
    if (re.test(rawLower) && !re.test(q)) {
      added.push(...list);
    } else if (re.test(q)) {
      added.push(...list);
    }
  }
  if (added.length > 0) {
    const uniq = Array.from(new Set(added.map(s => String(s).trim()))).join(' ');
    q = `${q} ${uniq}`.replace(/\s{2,}/g, ' ').trim();
  }
  return q.replace(/\s{2,}/g, ' ').trim();
}

async function main() {
  const question = 'TI belajar apa saja';
  const currentUserQ = question;
  const normalizedUserQ = normalizeIndonesianQuestionText(currentUserQ);
  const queryForRetrieval = normalizeQueryForRetrieval(normalizedUserQ);
  const queryEntities = extractStructuredEntities(queryForRetrieval || normalizedUserQ || currentUserQ || question);
  const indexPath = process.env.RAG_INDEX_PATH ? path.resolve(process.env.RAG_INDEX_PATH) : path.join(__dirname, 'src', 'data', 'rag_index.json');
  if (!fs.existsSync(indexPath)) {
    console.error('Index not found at', indexPath);
    process.exit(1);
  }
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const programIds = [
    'program_studi-28', 'program_studi-29', 'program_studi-30', 'program_studi-31', 'program_studi-32', 'program_studi-33', 'program_studi-34', 'program_studi-35'
  ];
  const programItems = index.filter(item => item && programIds.includes(item.id));

  console.log('STEP 1: Candidate pool awal (sebelum filtering)');
  console.log('- total index items:', index.length);
  console.log('- program_studi-28..35 present in index:', programItems.length > 0 ? 'FOUND' : 'DROPPED');
  console.log('- present ids:', programItems.map(i => i.id).sort().join(', ') || 'none');
  console.log('');

  const qEmb = await computeEmbedding(queryForRetrieval || normalizedUserQ || currentUserQ || question);
  const intent = detectIntent(queryForRetrieval || normalizedUserQ);

  let scored = index.map(item => {
    const semanticScore = Array.isArray(qEmb) && Array.isArray(item.embedding) ? cosineSimilarity(qEmb, item.embedding) : 0;
    const breakdown = getChunkScoreBreakdown(item, question, intent, semanticScore, queryEntities);
    return {
      item,
      score: semanticScore,
      semanticScore,
      finalScore: breakdown.finalScore,
      compositeScore: breakdown.compositeScore,
      attributeScore: breakdown.attributeScore,
      metadataBoost: breakdown.metadataBoost,
      scoreComponents: breakdown
    };
  });

  const presence = (arr) => programIds.filter(id => arr.some(x => x.item && x.item.id === id));

  // sort by compositeScore, then apply forced injection (same as query)
  scored.sort((a,b) => b.compositeScore - a.compositeScore);

  const qLow = String(queryForRetrieval || normalizedUserQ || currentUserQ || question || '').toLowerCase();
  const progTokens = new Set();
  if (queryEntities && queryEntities.program) progTokens.add(String(queryEntities.program).toLowerCase());
  if (qLow.includes(' ti ') || qLow.endsWith(' ti') || qLow.startsWith('ti ')) progTokens.add('teknologi informasi');
  if (qLow.includes(' si ') || qLow.endsWith(' si') || qLow.startsWith('si ')) progTokens.add('sistem informasi');
  if (qLow.includes(' sk ') || qLow.endsWith(' sk') || qLow.startsWith('sk ')) progTokens.add('sistem komputer');
  if (qLow.includes(' bd ') || qLow.endsWith(' bd') || qLow.startsWith('bd ')) progTokens.add('bisnis digital');
  if (qLow.includes(' mi ') || qLow.endsWith(' mi') || qLow.startsWith('mi ')) progTokens.add('manajemen informasi');

  const existingIds = new Set(scored.map(s => s.item && s.item.id));
  const forced = [];
  for (const it of index) {
    try {
      const docCat = String(it.docCategory || it.category || '').toUpperCase();
      const fname = String(it.filename || it.trainingId || '').toLowerCase();
      const filenameMatch = /(?:program studi|penjelasan\s+semua|penjelasan\s+prodi|penjelasan prodi|penjelasan prodi dan karier|prodi|kurikulum|mata kuliah|mata_kuliah|mata-kuliah|karier|career|prospek|peluang\s+kerja|profil)/i.test(fname);
      const chunkLow = String(it.chunk || '').toLowerCase();
      let programMention = false;
      for (const t of progTokens) {
        if (!t) continue;
        if (chunkLow.includes(t) || fname.includes(t)) { programMention = true; break; }
      }
      if (!new Set(['PRODI_PROFILE', 'KURIKULUM', 'PROSPEK_KERJA']).has(docCat) && !filenameMatch && !programMention) continue;
      if (existingIds.has(it.id)) continue;
      const sem = qEmb && Array.isArray(it.embedding) ? cosineSimilarity(qEmb, it.embedding) : 0;
      const comp = getChunkScoreBreakdown(it, question, intent, sem, queryEntities).compositeScore;
      const forcedFinal = Number.isFinite(comp) ? Math.max(-1, Math.min(1, comp)) : -1;
      if (comp > -0.5) forced.push({ item: it, score: sem, compositeScore: comp, finalScore: forcedFinal });
    } catch (e) {
      // ignore
    }
  }
  forced.sort((a,b) => b.compositeScore - a.compositeScore);
  const takeN = Math.max(4, Math.min(12, Math.floor(Math.max(4, scored.length * 0.15))));
  scored.push(...forced.slice(0, takeN));
  scored.sort((a,b) => b.compositeScore - a.compositeScore);

  const initialProgramPresence = presence(scored);
  console.log('STEP 2: Setelah scoring + reranking injection (candidate pool sebelum relevance filtering)');
  console.log('- total scored candidates:', scored.length);
  console.log('- program_studi-28..35 present:', initialProgramPresence.length > 0 ? 'FOUND' : 'DROPPED');
  console.log('- present ids:', initialProgramPresence.join(', ') || 'none');
  console.log('');

  const relevantScored = filterRelevantChunks(question, scored, queryEntities);
  console.log('STEP 3: Setelah filtering (filterRelevantChunks)');
  console.log('- total relevantScored:', relevantScored.length);
  const relevantPresence = presence(relevantScored);
  console.log('- program_studi-28..35 present:', relevantPresence.length > 0 ? 'FOUND' : 'DROPPED');
  console.log('- present ids:', relevantPresence.join(', ') || 'none');
  console.log('');

  const userIntent = classifyIntent(question);
  const validatedScored = applyIntentAwareFilteringAndValidation(question, scored, userIntent, null);
  console.log('STEP 4: Setelah intent-aware validation');
  console.log('- total validatedScored:', validatedScored.length);
  const validatedPresence = presence(validatedScored);
  console.log('- program_studi-28..35 present:', validatedPresence.length > 0 ? 'FOUND' : 'DROPPED');
  console.log('- present ids:', validatedPresence.join(', ') || 'none');
  console.log('');

  const minScore = parseFloat(process.env.RAG_MIN_SCORE || '0.6');
  const filtered = validatedScored.filter(s => s.score >= minScore || (typeof s.finalScore === 'number' && s.finalScore >= minScore));
  console.log('STEP 5: Setelah threshold filtering (score/minScore)');
  console.log('- minScore used:', minScore);
  console.log('- filtered count:', filtered.length);
  const filteredPresence = presence(filtered);
  console.log('- program_studi-28..35 present:', filteredPresence.length > 0 ? 'FOUND' : 'DROPPED');
  console.log('- present ids:', filteredPresence.join(', ') || 'none');
  console.log('');

  const topK = filtered.slice(0, 8);
  console.log('FINAL CONTEXT (top 8 after threshold)');
  topK.forEach((s, idx) => {
    console.log(`${idx + 1}. id=${s.item.id} file=${s.item.filename || s.item.trainingId} score=${s.score.toFixed(4)} composite=${s.compositeScore.toFixed(4)} final=${s.finalScore.toFixed(4)} metadataBoost=${s.metadataBoost.toFixed(4)} category=${String(s.item.docCategory || s.item.category || 'NONE')}`);
  });
  console.log('');
  const topProgram = topK.filter(s => programIds.includes(s.item.id)).map(s => `${s.item.id} rank=${topK.indexOf(s)+1} score=${s.score.toFixed(4)} composite=${s.compositeScore.toFixed(4)} final=${s.finalScore.toFixed(4)}`);
  console.log('program_studi-28..35 in final top:', topProgram.length > 0 ? 'FOUND' : 'DROPPED');
  if (topProgram.length > 0) console.log(topProgram.join('\n'));
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const va = Number(a[i]) || 0;
    const vb = Number(b[i]) || 0;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
