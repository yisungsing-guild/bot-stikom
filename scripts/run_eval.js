const fs = require('fs');
const path = require('path');
const { query } = require('../src/engine/ragEngine');

(async function(){
  const prompts = [
    'halo',
    'saya mau daftar, gimana caranya? (PMB)',
    'rincian biaya TI gelombang 1A',
    'untuk biaya, jurusan s1 mana yang paling murah?',
    'kalau jurusan bisni digital itu bisa bekerja sebagai apa ya?',
    'jurusan double degree itu apa keuntungannya?',
    'apakah ada program double degree internasional?',
    'kalau biaya untuk double degree apakah ada potongan biaya?',
    'Apa prospek kerja Sistem Informasi?',
    'aku suka buat konten di instagram cocok jurusan apa?',
    'saya suka merakit perangkat, jurusan apa cocok?',
    'apakah prodi SI terakreditasi?',
    'gelombang apa saja yang ada?',
    'berapa biaya pendaftaran untuk Dual Degree UTB gelombang 1?',
    'jelaskan program Bisnis Digital secara singkat',
    'perbandingan SI vs TI dari sisi biaya dan prospek',
    'apa itu RPL dan bagaimana caranya?',
    'berapa lama durasi S1 Sistem Informasi?',
    'bagaimana proses perkuliahan double degree HELP?',
    'saya mau tahu beasiswa yang tersedia'
  ];
 

  // optional start/end args (exclusive end). Usage: node scripts/run_eval.js <start> <end>
  const start = Number(process.argv[2] || 0);
  const end = Number(process.argv[3] || prompts.length);
  const slice = prompts.slice(start, end);

  const out = [];
  for(const p of slice){
    try{
      const res = await query(p);
      out.push({
        prompt: p,
        source: res && res.source,
        answer: String(res && res.answer || '').slice(0,2000).replace(/\n/g,' | '),
        contexts: Array.isArray(res && res.contexts) ? res.contexts.map(c => ({filename: c.filename, trainingId: c.trainingId, preview: (c.chunk||'').slice(0,200)})).slice(0,5) : []
      });
    }catch(e){
      out.push({prompt: p, error: String(e && e.message)});
    }
  }

  const fname = `evaluation_partial_${start}_${end}.json`;
  const outPath = path.resolve(__dirname, '..', fname);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log('WROTE', outPath);
})();
