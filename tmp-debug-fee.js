const r = require('./src/engine/ragEngine');
const q = 'biaya lengkap prodi si ada apa saja?';
const res = r.tryStructuredFeeBreakdownAnswer(q, []);
console.log('res', !!res, res && res.source);
const currentQ = r.extractCurrentUserQuestionText(q);
const qLower = String(currentQ || '').toLowerCase();
const mentionsCostCore = /(biaya|rincian|detail|komponen|lainnya|potongan|diskon|dpp|ukt|per\s*semester|biaya\s*semester|uang\s+semester|biaya\s+per\s*semester|pembayaran|cicil|cicilan|\brp\b|rupiah)/i.test(qLower);
const mentionsRegistrationFee = /(pendaftaran|registrasi)/i.test(qLower) && (mentionsCostCore || /(berapa|nominal|tarif|uang)/i.test(qLower));
const mentionsRequirements = /(syarat|persyaratan|dokumen|berkas|formulir|lampiran)/i.test(qLower);
console.log({currentQ, qLower, mentionsCostCore, mentionsRegistrationFee, mentionsRequirements});
const detectProgramKey = (textLower, opts = null) => {
  if (!textLower) return null;
  const o = (opts && typeof opts === 'object') ? opts : {};
  const allowDualDegree = o.allowDualDegree !== false;
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
  if (allowDualDegree) {
    if (/\bhelp\b|help\s+university|malaysia/i.test(textLower)) return 'help';
    if (/\bdnui\b|dalian\s+neusoft|university\s+of\s+information/i.test(textLower)) return 'dnui';
    if (/\butb\b|universitas\s+teknologi\s+bandung/i.test(textLower)) return 'utb';
  }
  return null;
};
console.log('programKey', detectProgramKey(qLower, { allowDualDegree: true, allowLooseProgramCode: true }));
console.log('programKeyNoLoose', detectProgramKey(qLower, { allowDualDegree: true, allowLooseProgramCode: false }));
const fullIndex = r.loadIndex();
console.log('index length', Array.isArray(fullIndex) ? fullIndex.length : typeof fullIndex);
const keyRe = /(PROGRAM\s*STUDI\s*SISTEM\s*INFORMASI|PROGRAMSTUDISISTEMINFORMASI|TEKNOLOGI\s*INFORMASI|TEKNOLOGIINFORMASI|BISNIS\s*DIGITAL|BISNISDIGITAL)/i;
const matching = fullIndex.filter(item => item && item.chunk && keyRe.test(item.chunk));
console.log('matching chunks', matching.length);
if (matching.length) {
  console.log('first chunk snippet:', matching[0].chunk.substring(0, 240));
}
