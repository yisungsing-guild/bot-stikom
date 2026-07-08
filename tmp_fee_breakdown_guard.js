const { extractCurrentUserQuestionText } = require('./src/engine/ragEngine');
const question = 'biaya lengkap prodi si ada apa saja?';
const currentQ = extractCurrentUserQuestionText(question);
const qLower = String(currentQ || '').toLowerCase();
const mentionsCostCore = /(biaya|rincian|detail|komponen|lainnya|potongan|diskon|dpp|ukt|per\s*semester|biaya\s*semester|uang\s+semester|biaya\s+per\s*semester|pembayaran|cicil|cicilan|\brp\b|rupiah)/i.test(qLower);
const mentionsRegistrationFee = /(pendaftaran|registrasi)/i.test(qLower) && (mentionsCostCore || /(berapa|nominal|tarif|uang)/i.test(qLower));
const mentionsRequirements = /(syarat|persyaratan|dokumen|berkas|formulir|lampiran)/i.test(qLower);
const asksCost = mentionsCostCore || mentionsRegistrationFee;
const wantsOtherOnly = /\b(lainnya|selain\s+itu|yang\s+lain)\b/i.test(qLower);
const wantsDiscount = /\b(potongan|diskon)\b/i.test(qLower);
const wantsSemesterOnly = /(?:(\bukt\b|per\s*semester|biaya\s+semester|uang\s+semester|biaya\s+kuliah|uang\s+kuliah|biaya\s+pendidikan|biaya\s+per\s*semester))/i.test(qLower) && !wantsOtherOnly && !/(rincian|detail|komponen|lengkap|biaya\s+lain|selain\s+itu|yang\s+lain|dpp|pendaftaran|registrasi|jas|kaos|pengalaman\s+industri|total|cicil|cicilan|skema\s+pembayaran|pembayaran\s+per\s+komponen)/i.test(qLower);
console.log({ currentQ, qLower, mentionsCostCore, mentionsRegistrationFee, mentionsRequirements, asksCost, wantsOtherOnly, wantsDiscount, wantsSemesterOnly });
const detectProgramKey = (textLower) => {
  if (!textLower) return null;
  if (/sistem\s+komputer|\bprodi\s*sk\b|\bjurusan\s*sk\b/i.test(textLower)) return 'sk';
  if (/manajemen\s+informatika|informat(i)?c\s*diploma|\bprodi\s*mi\b|\bjurusan\s*mi\b/i.test(textLower)) return 'mi';
  if (/sistem\s+informasi|\bprodi\s*si\b|\bjurusan\s*si\b/i.test(textLower)) return 'si';
  if (/teknologi\s+informasi|\bprodi\s*ti\b|\bjurusan\s*ti\b/i.test(textLower)) return 'ti';
  if (/bisnis\s+digital|\bprodi\s*bd\b|\bjurusan\s*bd\b/i.test(textLower)) return 'bd';
  if (/\b(biaya|dpp|pendaftaran|registrasi|semester|per\s*semester|pembayaran)\b/i.test(textLower)) {
    const m = /\b(si|ti|bd|sk|mi)\b/i.exec(textLower);
    if (m && m[1]) return m[1].toLowerCase();
  }
  return null;
};
console.log('programKey', detectProgramKey(qLower));
