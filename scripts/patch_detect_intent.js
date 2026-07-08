const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/utils/whatsappFormatter.js');
let content = fs.readFileSync(filePath, 'utf8');

// Replace detectIntentFromAnswer function
const oldFunc = `function detectIntentFromAnswer(mainAnswer, userQuery) {
  const text = String((mainAnswer || '') + ' ' + (userQuery || '')).toLowerCase();
  if (/(belajar|mata kuliah|kurikulum|dipelajari|apa saja)/.test(text)) return 'program_studi';
  if (/\\b(prospek kerja|pekerjaan|karir|lulusan|bekerja sebagai|lowongan)\\b/.test(text)) return 'prospek_kerja';
  if (/\\b(rp\\b|biaya|dpp|ukt|semester|pendaftaran biaya|biaya kuliah)\\b/.test(text)) return 'biaya';
  if (/\\b(beasiswa|scholarship|beasiswa prestasi|beasiswa kurang mampu)\\b/.test(text)) return 'beasiswa';
  // detect schedule-specific pendaftaran (jadwal) separately
  if (/\\b(jadwal|gelombang|deadline|tanggal|dibuka|tutup|januari|mei|september|februari|maret|april|juni|juli|agustus|oktober|november|desember)\\b/.test(text)) return 'jadwal_pendaftaran';
  if (/\\b(pendaftaran|daftar|seleksi|cara daftar|langkah pendaftaran)\\b/.test(text)) return 'pendaftaran';
  if (/\\b(lokasi|alamat|denpasar|kampus|berlokasi)\\b/.test(text)) return 'lokasi';
  if (/\\b(akreditasi|ban-pt|sk akreditasi|terakreditasi)\\b/.test(text)) return 'akreditasi';
  if (/\\b(bedanya|perbedaan|vs\\b|versus|beda antara)\\b/.test(text)) return 'perbandingan_prodi';
  return 'general';
}`;

const newFunc = `function detectIntentFromAnswer(mainAnswer, userQuery) {
  const text = String((mainAnswer || '') + ' ' + (userQuery || '')).toLowerCase();
  const q = String(userQuery || '').toLowerCase();

  // Prioritize specific intents FIRST, then generic ones
  // akreditasi: check first before lokasi (both may contain 'kampus')
  if (/\\b(akreditasi|ban-pt|sk akreditasi|terakreditasi)\\b/.test(text)) return 'akreditasi';

  // jadwal_pendaftaran: check before pendaftaran (overlap on 'pendaftaran')
  if (/\\b(jadwal|gelombang|deadline|tanggal|dibuka|tutup|januari|mei|september|februari|maret|april|juni|juli|agustus|oktober|november|desember)\\b/.test(text)) return 'jadwal_pendaftaran';

  // pendaftaran: check before biaya (both may mention 'biaya pendaftaran')
  if (/\\b(cara daftar|langkah pendaftaran|prosedur pendaftaran|persyaratan pendaftaran|dokumen|formulir|ijazah|ktp)\\b/.test(text) || (/\\b(pendaftaran|daftar|seleksi)\\b/.test(text) && /\\*/.test(mainAnswer))) return 'pendaftaran';

  // Now check generic intents
  if (/(belajar|mata kuliah|kurikulum|dipelajari|apa saja)/.test(text)) return 'program_studi';
  if (/\\b(prospek kerja|pekerjaan|karir|lulusan|bekerja sebagai|lowongan)\\b/.test(text)) return 'prospek_kerja';
  if (/\\b(rp\\b|biaya|dpp|ukt|semester|pendaftaran biaya|biaya kuliah)\\b/.test(text)) return 'biaya';
  if (/\\b(beasiswa|scholarship|beasiswa prestasi|beasiswa kurang mampu)\\b/.test(text)) return 'beasiswa';
  if (/\\b(lokasi|alamat|denpasar|kampus|berlokasi)\\b/.test(text)) return 'lokasi';
  if (/\\b(bedanya|perbedaan|vs\\b|versus|beda antara)\\b/.test(text)) return 'perbandingan_prodi';
  return 'general';
}`;

if (content.includes(oldFunc)) {
  content = content.replace(oldFunc, newFunc);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('✓ detectIntentFromAnswer function replaced successfully');
} else {
  console.log('✗ Could not find old function. Trying to patch manually...');
  // fallback: patch only the body
  const startIdx = content.indexOf('function detectIntentFromAnswer(mainAnswer, userQuery) {');
  const endIdx = content.indexOf('function suggestionsForIntent(intent, program) {');
  if (startIdx >= 0 && endIdx > startIdx) {
    const before = content.substring(0, startIdx);
    const after = content.substring(endIdx);
    const patched = before + newFunc + '\n\n' + after;
    fs.writeFileSync(filePath, patched, 'utf8');
    console.log('✓ Function patched via fallback method');
  }
}
