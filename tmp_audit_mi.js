const { query, extractStructuredEntities, extractAcademicIntent, getChunkEntities } = require('./src/engine/ragEngine');

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
    const re = new RegExp(`\\b${key.replace(/[-\\/\\^$*+?.()|[\\]{}]/g, '\\$&')}\\b`, 'i');
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

function normalizeIndonesianQuestionText(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  return text.toLowerCase().replace(/[“”«»]/g, '"').replace(/[’‘]/g, "'").replace(/[‒–—―]/g, '-');
}

const queries = [
  'Apa itu Manajemen Informatika?',
  'Mata kuliah Manajemen Informatika?',
  'Prospek kerja Manajemen Informatika?'
];

(async () => {
  for (const queryText of queries) {
    console.log('\n===============================================');
    console.log('QUERY ASLI:', queryText);

    const currentUserQ = queryText;
    const normalizedUserQ = normalizeIndonesianQuestionText(currentUserQ);
    const queryForRetrieval = normalizeQueryForRetrieval(normalizedUserQ);
    const entities = extractStructuredEntities(queryForRetrieval || normalizedUserQ || currentUserQ || queryText);
    console.log('QUERY SETELAH REWRITE:', queryForRetrieval);
    console.log('QUERY ENTITIES:', JSON.stringify(entities, null, 2));

    const result = await query(queryText, 8);
    const contexts = Array.isArray(result.contexts) ? result.contexts : [];
    console.log('RESULT SOURCE:', result.source);
    console.log('RESULT CONTEXTS COUNT:', contexts.length);

    if (contexts.length === 0) {
      console.log('No contexts returned.');
      continue;
    }

    for (let idx = 0; idx < contexts.length; idx += 1) {
      const context = contexts[idx];
      const chunk = String(context.chunk || '').replace(/\s+/g, ' ').trim();
      const entityInfo = getChunkEntities(context);
      const category = context.docCategory || context.category || context.chunkType || 'UNKNOWN';
      console.log('\n--- Context', idx + 1, '---');
      console.log('id:', context.id || 'N/A');
      console.log('filename:', context.filename || context.trainingId || 'N/A');
      console.log('program:', entityInfo.program || 'N/A');
      console.log('category/docCategory:', category);
      if (typeof context.score !== 'number' || typeof context.compositeScore !== 'number') {
        console.log('score: n/a (returned context object may not include scores)');
      } else {
        console.log('score:', context.score, 'compositeScore:', context.compositeScore);
      }
      console.log('chunk-snippet:', chunk.slice(0, 300));

      const checks = [];
      const lower = chunk.toLowerCase();
      if (/manajemen informatika/.test(lower) || /program studi manajemen informatika/.test(lower)) {
        checks.push('Contains program definition/profile terms for Manajemen Informatika');
      }
      if (/mata kuliah/.test(lower) || /kurikulum/.test(lower)) {
        checks.push('Contains Mata Kuliah / Kurikulum references');
      }
      if (/prospek kerja|peluang kerja|karir|lulusan/.test(lower)) {
        checks.push('Contains Prospek Kerja / Lulusan references');
      }
      if (/biaya|pembayaran|uang kuliah|spp|dpp|potongan|pendaftaran|beasiswa|gelombang|akreditasi/.test(lower)) {
        checks.push('Contains cost/accreditation/administrative terms');
      }
      if (checks.length === 0) checks.push('No strong MI-specific academic signals found in chunk preview');
      console.log('WHY SELECTED:', checks.join(' | '));

      const def = /manajemen informatika/.test(lower) || /profil lulusan/.test(lower) || /program pendidikan vokasi/.test(lower);
      const matkul = /mata kuliah/.test(lower) || /kurikulum/.test(lower) || /perkuliahan/.test(lower);
      const prospek = /prospek kerja|peluang kerja|karir|lulusan/.test(lower);
      console.log('VERIFIED CONTENT TOPICS:');
      console.log('- definisi/profil MI:', def ? 'YES' : 'NO');
      console.log('- mata kuliah MI:', matkul ? 'YES' : 'NO');
      console.log('- prospek kerja MI:', prospek ? 'YES' : 'NO');
    }

    console.log('\nFINAL ANSWER:', result.answer ? result.answer.replace(/\s+/g, ' ').trim().slice(0, 300) + '...' : 'N/A');
  }
})();
