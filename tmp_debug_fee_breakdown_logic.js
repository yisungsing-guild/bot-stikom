const fs = require('fs');
const path = require('path');
const raw = fs.readFileSync(path.join('src','data','rag_index.json'),'utf8');
const fullIndex = JSON.parse(raw);
function loadIndex() { return fullIndex; }
function escapeRegex(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function normalizeIndonesianQuestionText(raw) {
  let t = String(raw || '').toLowerCase();
  t = t.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s{2,}/g,' ').trim();
  const repl=[[/\byg\b/g,'yang'],[/\bdmn\b/g,'di mana'],[/\bgmn\b/g,'bagaimana'],[/\bbrp\b/g,'berapa'],[/\butk\b/g,'untuk'],[/\bdr\b/g,'dari'],[/\bdpt\b/g,'dapat'],[/\btdk\b/g,'tidak'],[/\bgk\b/g,'tidak'],[/\bga\b/g,'tidak'],[/\bgak\b/g,'tidak'],[/\bnggak\b/g,'tidak'],[/\benggak\b/g,'tidak'],[/\btrs\b/g,'terus'],[/\btrus\b/g,'terus'],[/\budh\b/g,'sudah'],[/\budah\b/g,'sudah'],[/\baja\b/g,'saja'],[/\bbgt\b/g,'banget'],[/\bpls\b/g,'tolong'],[/\bplis\b/g,'tolong'],[/\bpliss\b/g,'tolong'],[/\bmin\b/g,'admin']];
  for (const [re,to] of repl) t = t.replace(re,to);
  t = t.replace(/([a-z])\1{2,}/g,'$1$1');
  return t.replace(/\b(kak|kakak|kaka|dong|deh|nih|yaa|ya|yah|hehe|wkwk|admin)\b/g,' ').replace(/\s{2,}/g,' ').trim();
}
function extractCurrentUserQuestionText(rawQuestion) { return String(rawQuestion||'').trim(); }
function tryStructuredFeeBreakdownAnswer(question, top, opts = null) {
  const currentQ = extractCurrentUserQuestionText(question);
  const qLower = String(currentQ || '').toLowerCase();
  const mentionsCostCore = /(biaya|rincian|detail|komponen|lainnya|potongan|diskon|dpp|ukt|per\s*semester|biaya\s*semester|uang\s*semester|biaya\s*per\s*semester|pembayaran|cicil|cicilan|\brp\b|rupiah)/i.test(qLower);
  const mentionsRegistrationFee = /(pendaftaran|registrasi)/i.test(qLower) && (mentionsCostCore || /(berapa|nominal|tarif|uang)/i.test(qLower));
  const mentionsRequirements = /(syarat|persyaratan|dokumen|berkas|formulir|lampiran)/i.test(qLower);
  if (mentionsRequirements && !mentionsCostCore) return null;
  const asksCost = mentionsCostCore || mentionsRegistrationFee;
  if (!asksCost) return null;
  const wantsOtherOnly = /\b(lainnya|selain\s+itu|yang\s+lain)\b/i.test(qLower);
  const wantsDiscount = /\b(potongan|diskon)\b/i.test(qLower);
  const wantsSemesterOnly = /(\bukt\b|per\s*semester|biaya\s+semester|uang\s+semester|biaya\s+kuliah|uang\s+kuliah|biaya\s+pendidikan|biaya\s+per\s*semester)/i.test(qLower) && !wantsOtherOnly && !/(rincian|detail|komponen|lengkap|biaya\s+lain|selain\s+itu|yang\s+lain|dpp|pendaftaran|registrasi|jas|kaos|pengalaman\s+industri|total|cicil|cicilan|skema\s+pembayaran|pembayaran\s+per\s+komponen)/i.test(qLower);
  const qAllLower = String(question || '').toLowerCase();
  const qProgramLower = String(currentQ || '').toLowerCase();
  const conversationContext = String(opts && typeof opts.conversationContext === 'string' ? opts.conversationContext : '').toLowerCase();
  const topText = Array.isArray(top) ? top.map(item => String(item && item.chunk ? item.chunk : '')).join('\n') : '';
  const topTrainingIds = new Set(Array.isArray(top) ? top.map(item => item && item.trainingId ? String(item.trainingId) : '').filter(Boolean) : []);
  const detectProgramKey = (textLower, opts = null) => {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const allowLooseProgramCode = o.allowLooseProgramCode !== false;
    if (/sistem\s+komputer|\bprodi\s*sk\b|\bjurusan\s*sk\b/i.test(textLower)) return 'sk';
    if (/manajemen\s+informatika|informat(i)?c\s*diploma|\bprodi\s*mi\b|\bjurusan\s*mi\b/i.test(textLower)) return 'mi';
    if (/sistem\s+informasi|\bprodi\s*si\b|\bjurusan\s*si\b/i.test(textLower)) return 'si';
    if (/teknologi\s+informasi|\bprodi\s*ti\b|\bjurusan\s*ti\b/i.test(textLower)) return 'ti';
    if (/bisnis\s+digital|\bprodi\s*bd\b|\bjurusan\s*bd\b/i.test(textLower)) return 'bd';
    if (allowLooseProgramCode) {
      if (/\b(biaya|dpp|pendaftaran|registrasi|semester|per\s*semester|pembayaran)\b/i.test(textLower)) {
        const m = /\b(si|ti|bd|sk|mi)\b/i.exec(textLower);
        if (m && m[1]) return m[1].toLowerCase();
      }
    }
    return null;
  };
  let programKey = detectProgramKey(qProgramLower, { allowLooseProgramCode: true });
  if (!programKey) {
    const currentHasAnyProgramSignal = /(sistem\s+informasi|teknologi\s+informatika|bisnis\s+digital|sistem\s+komputer|manajemen\s+informatika|\b(si|ti|bd|sk|mi)\b)/i.test(qProgramLower);
    const ambiguousCurrent = !currentHasAnyProgramSignal && qProgramLower.length <= 32;
    if (ambiguousCurrent) programKey = detectProgramKey(qAllLower, { allowLooseProgramCode: false });
  }
  if (!programKey && conversationContext) programKey = detectProgramKey(conversationContext, { allowLooseProgramCode: true });
  if (!programKey && topText) programKey = detectProgramKey(topText, { allowLooseProgramCode: true });
  console.log('programKey', programKey, 'wantsSemesterOnly', wantsSemesterOnly);
  const fullIndex = loadIndex();
  let candidates = [];
  if (programKey && !candidates.length) {
    const keyRe = /(PROGRAM\s*STUDI\s*SISTEM\s*INFORMASI|PROGRAMSTUDISISTEMINFORMASI|TEKNOLOGI\s*INFORMASI|TEKNOLOGIINFORMASI|BISNIS\s*DIGITAL|BISNISDIGITAL)/i;
    const feeSignalRe = /(?:RINCIAN\s*BIAYA\s*PENDIDIKAN|RINCIANBIAYAPENDIDIKAN|No\.\s*Jenis\s*Biaya|Waktu\s*Pembayaran|Biaya\s*Pendaftaran|Dana\s*Pendidikan\s*Pokok|\bDPP\b|UKT|Biaya\s*Pendidikan\s*Per\s*Semester|Biaya\s*Semester)/i;
    const idCounts = new Map();
    for (const item of fullIndex) {
      const chunk = item && item.chunk ? String(item.chunk) : '';
      const trainingId = item && item.trainingId ? String(item.trainingId) : '';
      if (!chunk || !trainingId) continue;
      if (!keyRe.test(chunk)) continue;
      if (!feeSignalRe.test(chunk)) continue;
      const prev = idCounts.get(trainingId) || 0;
      const bonus = /\bPendaftaran\b/i.test(chunk) ? 2 : 0;
      idCounts.set(trainingId, prev + 1 + bonus);
    }
    let bestTrainingId = null; let bestScore = -1;
    for (const [tid, score] of idCounts.entries()) { if (score > bestScore) { bestScore = score; bestTrainingId = tid; } }
    console.log('idCounts', Array.from(idCounts.entries()));
    if (bestTrainingId) {
      candidates = fullIndex.filter(item => item && String(item.trainingId || '') === bestTrainingId).map(item => (item && item.chunk ? String(item.chunk) : ''));
    }
  }
  console.log('candidates', candidates.length, candidates[0] && candidates[0].slice(0,500));
  const combined = candidates.join('\n');
  console.log('combined length', combined.length);
  const text = String(combined || '').replace(/\s+/g, ' ');
  const registrationFee = /(?:biaya\s+pendaftaran|pendaftaran|registrasi)\D{0,30}([0-9]{1,3}(?:\.[0-9]{3})+|[0-9]{6,})/i.exec(text);
  const dpp = /(?:dana\s+pendidikan\s+pokok|dpp)\D{0,30}([0-9]{1,3}(?:\.[0-9]{3})+|[0-9]{6,})/i.exec(text);
  const semester = /(?:biaya\s+pendidikan\s+per\s+semester|ukt|uang\s+kuliah\s+tunggal|biaya\s+semester)\D{0,30}([0-9]{1,3}(?:\.[0-9]{3})+|[0-9]{6,})/i.exec(text);
  console.log({ registrationFee: registrationFee && registrationFee[1], dpp: dpp && dpp[1], semester: semester && semester[1], wantsSemesterOnly });
  return null;
}
console.log(tryStructuredFeeBreakdownAnswer('biaya lengkap prodi si ada apa saja?', null, {}));
