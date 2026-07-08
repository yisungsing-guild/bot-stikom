(async()=>{
  const { query } = require('../src/engine/ragEngine');
  const prodis = ['Sistem Komputer','Teknik Informatika','Bisnis Digital','Manajemen','Akuntansi','Desain Komunikasi','Multimedia'];
  const results = [];
  for (const p of prodis) {
    const ctx = [
      `Pertanyaan sebelumnya dari user: "pendaftaran jurusan ${p}"`,
      `Balasan terakhir dari bot: "Siap, untuk Prodi ${p}. Kakak mau info yang mana?"`,
      `Balasan user saat ini: "biaya"`
    ].join('\n');
    try {
      const r = await query('biaya', 3, { conversationContext: ctx, answerQuestion: 'biaya' });
      const ans = (r && r.answer) ? String(r.answer).trim() : '';
      const isDup = !!ans.match(/^([\s\S]+)\1$/);
      const pendaftaranCount = (ans.match(/Pendaftaran/gi)||[]).length;
      const hasExplicitTotal = /Total biaya|Biaya pendidikan per semester|UKT|Total biaya awal masuk/gi.test(ans);
      const hasComputedTotal = /Total \(dihitung\)\s*:\s*Rp\s*[0-9.]+/i.test(ans);

      // Fallback: try to compute total by summing all Rp values present in the answer
      const moneyRe = /Rp\s*([0-9]{1,3}(?:\.[0-9]{3})+)/g;
      let m; let sum = 0; const found = [];
      while ((m = moneyRe.exec(ans)) !== null) {
        const digits = m[1].replace(/\./g, '');
        const n = parseInt(digits, 10);
        if (Number.isFinite(n) && n > 0) { sum += n; found.push(n); }
      }

      const computedTotal = sum > 0 ? sum : null;
      const hasTotal = hasExplicitTotal || hasComputedTotal || computedTotal !== null;

      results.push({
        prodi: p,
        source: r && r.source ? r.source : null,
        pendaftaranCount,
        hasExplicitTotal,
        hasComputedTotal,
        computedTotal,
        duplicated: isDup,
        length: ans.length
      });
    } catch (e) {
      results.push({prodi:p, error: String(e)});
    }
  }
  console.log(JSON.stringify({timestamp:new Date().toISOString(), results}, null, 2));
  process.exit(0);
})();
