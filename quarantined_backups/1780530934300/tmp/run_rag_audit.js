const { query: ragQuery } = require('../src/engine/ragEngine');

function looksLikeProgramSpecificQuestion(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  if (t.includes('?')) return true;
  return /\b(berapa|kapan|dimana|di\s+mana|gimana|bagaimana|rincian|detail|lengkap|biaya|dpp|semester|cicil|cicilan|pembayaran|potongan|diskon|gelombang|jadwal|syarat|kontak|alamat|email|website|wa\b|whatsapp|telepon|telp)\b/i.test(t);
}

function canonicalizeProgramLabel(rawName) {
  const s = String(rawName || '').replace(/\s{2,}/g, ' ').trim();
  if (!s) return '';
  const t = s.toLowerCase();
  if (/manajemen\s*informatika/.test(t)) return 'D3 Manajemen Informatika';
  if (/pascasarjana|magister|\bs\s*2\b|\bs2\b/.test(t)) return 'S2 Sistem Informasi (SI)';
  if (/sistem\s*informasi/.test(t)) return 'Sistem Informasi';
  if (/teknologi\s*informasi/.test(t)) return 'Teknologi Informasi';
  if (/bisnis\s*digital/.test(t)) return 'Bisnis Digital';
  if (/sistem\s*komputer/.test(t)) return 'Sistem Komputer';
  return s;
}

function extractProgramHint(text) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return null;
  if (/teknologi\s+informasi/i.test(t)) return 'Teknologi Informasi';
  if (/sistem\s+informasi/i.test(t)) return 'Sistem Informasi';
  if (/bisnis\s+digital/i.test(t)) return 'Bisnis Digital';
  if (/sistem\s+komputer/i.test(t)) return 'Sistem Komputer';
  const abbr = /(program\s+studi|prodi)\s*[:\-]?\s*(ti|si|bd|sk)\b/i.exec(t);
  if (abbr && abbr[2]) {
    const code = abbr[2].toLowerCase();
    if (code === 'ti') return 'Teknologi Informasi';
    if (code === 'si') return 'Sistem Informasi';
    if (code === 'bd') return 'Bisnis Digital';
    if (code === 'sk') return 'Sistem Komputer';
  }
  const hasProgramContext = /\b(biaya|pendaftaran|registrasi|rincian|detail|dpp|semester|gelombang|kuliah|uang\s+kuliah)\b/i.test(t) || /\b(program\s+studi|prodi|jurusan)\b/i.test(t);
  if (hasProgramContext) {
    const loose = /\b(ti|si|bd|sk)\b/i.exec(t);
    if (loose && loose[1]) {
      const code = loose[1].toLowerCase();
      if (code === 'ti') return 'Teknologi Informasi';
      if (code === 'si') return 'Sistem Informasi';
      if (code === 'bd') return 'Bisnis Digital';
      if (code === 'sk') return 'Sistem Komputer';
    }
  }
  if (looksLikeProgramSpecificQuestion(text)) {
    const loose = /\b(ti|si|bd|sk)\b/i.exec(t);
    if (loose && loose[1]) {
      const code = loose[1].toLowerCase();
      if (code === 'ti') return 'Teknologi Informasi';
      if (code === 'si') return 'Sistem Informasi';
      if (code === 'bd') return 'Bisnis Digital';
      if (code === 'sk') return 'Sistem Komputer';
    }
  }
  return null;
}

function detectIntentStub(text) {
  // Simple heuristic similar to ragEngine.detectIntent usage
  const t = String(text || '').toLowerCase();
  if (/\b(biaya|dpp|pendaftaran|ukt|semester|cicil|pembayaran)\b/.test(t)) return 'COST';
  if (/\b(jadwal|gelombang|testing|pengumuman)\b/.test(t)) return 'SCHEDULE';
  if (/\b(apa itu|apa saja|belajar|mata kuliah|lulusan|bekerja|kerja|pekerjaan|prospek)\b/.test(t)) return 'PROGRAM_INFO';
  return 'GENERAL';
}

async function run() {
  const queries = [
    'apa itu SI?',
    'di SI belajar apa?',
    'lulusan TI bekerja dimana?',
    'program studi sistem informasi belajar apa dan bekerja dimana?'
  ];

  for (const q of queries) {
    console.log('---');
    console.log('question:', q);
    const detectedProgram = extractProgramHint(q);
    const canonicalProgram = detectedProgram ? canonicalizeProgramLabel(detectedProgram) : null;
    const detectedIntent = detectIntentStub(q);
    const topK = 10;
    const ragRes = await ragQuery(q, topK, { answerQuestion: q, minScore: 0 });
    const selectedRoute = ragRes && ragRes.source ? ragRes.source : null;
    const retrievalQuery = q; // as passed
    const topChunks = Array.isArray(ragRes && ragRes.contexts) ? ragRes.contexts.slice(0, 10).map((c, i) => ({
      rank: i+1,
      id: c.id || null,
      filename: c.filename || null,
      trainingId: c.trainingId || null,
      divisionKey: c.divisionKey || null,
      score: typeof c.score === 'number' ? c.score : (c.score === undefined ? null : c.score),
      snippet: (c.chunk || '').replace(/\s+/g, ' ').trim().slice(0, 300)
    })) : [];

    console.log(JSON.stringify({ detectedProgram, canonicalProgram, detectedIntent, selectedRoute, retrievalQuery, topChunks }, null, 2));
  }
}

run().catch(e => { console.error(e); process.exit(1); });
