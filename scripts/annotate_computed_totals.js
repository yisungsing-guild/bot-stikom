(async()=>{
  const { query, getIndexPath } = require('../src/engine/ragEngine');
  const fs = require('fs');
  const path = require('path');

  const prodis = ['Sistem Komputer','Teknik Informatika','Bisnis Digital','Manajemen','Akuntansi','Desain Komunikasi','Multimedia'];

  const indexPath = getIndexPath();
  if (!fs.existsSync(indexPath)) {
    console.error('Index not found at', indexPath);
    process.exit(2);
  }

  const raw = fs.readFileSync(indexPath, 'utf-8');
  let index = [];
  try { index = JSON.parse(raw || '[]'); } catch (e) { console.error('Failed parse index:', e); process.exit(3); }

  const moneyRe = /Rp\s*([0-9]{1,3}(?:\.[0-9]{3})+)/g;

  const computeFromAnswer = (ans) => {
    if (!ans) return null;
    let m; let sum = 0; let found = 0;
    while ((m = moneyRe.exec(ans)) !== null) {
      const digits = m[1].replace(/\./g, '');
      const n = parseInt(digits, 10);
      if (Number.isFinite(n) && n > 0) { sum += n; found++; }
    }
    return found ? sum : null;
  };

  const matchChunkForProdi = (chunk, prodi) => {
    if (!chunk) return false;
    const c = String(chunk).toLowerCase();
    const p = prodi.toLowerCase();
    if (c.includes(p)) return true;
    // common variants
    const variants = {
      'teknik informatika': ['teknologi informasi','teknologiinformatika','prodi ti','jurusan ti'],
      'sistem informasi': ['sistem informasi','prodi si','jurusan si'],
      'sistem komputer': ['sistem komputer','prodi sk','jurusan sk'],
      'bisnis digital': ['bisnis digital','prodi bd','jurusan bd'],
      'manajemen': ['manajemen','prodi manajemen','manajemen informatika'],
      'akuntansi': ['akuntansi'],
      'desain komunikasi': ['desain komunikasi','d3 desain komunikasi','desainkomunikasi'],
      'multimedia': ['multimedia']
    };
    const arr = variants[prodi.toLowerCase()] || [];
    for (const v of arr) if (c.includes(v)) return true;
    return false;
  };

  const results = [];
  for (const p of prodis) {
    try {
      const r = await query('biaya', 3, { conversationContext: `Pertanyaan sebelumnya dari user: \"pendaftaran jurusan ${p}\"\nBalasan terakhir dari bot: \"Siap, untuk Prodi ${p}. Kakak mau info yang mana?\"\nBalasan user saat ini: \"biaya\"`, answerQuestion: 'biaya' });
      const ans = (r && r.answer) ? String(r.answer) : '';
      const computed = computeFromAnswer(ans);
      // find matching trainingIds
      const matchedTids = new Set();
      for (const item of index) {
        if (!item || !item.chunk) continue;
        if (matchChunkForProdi(item.chunk, p)) {
          if (item.trainingId) matchedTids.add(String(item.trainingId));
        }
      }
      if (matchedTids.size === 0) {
        results.push({ prodi: p, matched: 0, computed });
        continue;
      }

      const now = new Date().toISOString();
      for (const tid of Array.from(matchedTids)) {
        for (const item of index) {
          if (!item || String(item.trainingId) !== String(tid)) continue;
          if (!item.meta) item.meta = {};
          item.meta.computedTotal = computed;
          item.meta.computedTotalNote = computed ? `Computed from automated fee parsing on ${now}` : `No computed total found on ${now}`;
          item.meta.computedTotalUpdatedAt = now;
        }
      }

      results.push({ prodi: p, matched: matchedTids.size, computed });
    } catch (e) {
      results.push({ prodi: p, error: String(e) });
    }
  }

  // safe write: write tmp, make bak
  const bak = indexPath + '.bak';
  const tmp = indexPath + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(index));
    if (fs.existsSync(bak)) try { fs.unlinkSync(bak); } catch {};
    if (fs.existsSync(indexPath)) fs.renameSync(indexPath, bak);
    fs.renameSync(tmp, indexPath);
  } catch (e) {
    console.error('Failed to write index:', e);
    process.exit(4);
  }

  console.log(JSON.stringify({ ts: new Date().toISOString(), results }, null, 2));
  process.exit(0);
})();
