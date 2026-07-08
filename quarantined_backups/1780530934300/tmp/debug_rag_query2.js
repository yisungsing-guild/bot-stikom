const { query } = require('../src/engine/ragEngine');
const { sanitizeWhatsappText } = require('../src/utils/textSanitizer');
const queries = [
  'apa itu SI?',
  'di SI belajar apa?',
  'lulusan TI bekerja dimana?',
  'berapa uang semester SI?',
  'beasiswa KIP',
  'beasiswa 1K1S',
  'kapan gelombang berikutnya?',
  'masih buka pendaftaran?'
];
const detectIntent = (question) => {
  const q = String(question || '').toLowerCase().trim();
  if (/\b(harga|biaya|mahal|murah|pendaftaran|dpp|ukt|potongan|diskon|kuliah|pendidikan|bayar|total)\b/.test(q)) return 'COST';
  if (/\b(ada\s+ga|ada\s+gak|ada\s+tidak)\b/.test(q) && /\b(internasional|double degree|dual degree|dnui|help|utb|program|kelas\s+internasional|kelas\s+nasional|china|bali|online)\b/.test(q)) return 'PROGRAM';
  if (/\b(internasional|double degree|dual degree|dnui|help|utb|china|bali|online|program|kelas)\b/.test(q)) return 'PROGRAM';
  if (/\b(jadwal|gelombang|daftar|pendaftaran|deadline|tanggal)\b/.test(q)) return 'SCHEDULE';
  if (/\b(akreditasi|peringkat|rank)\b/.test(q)) return 'ACCREDITATION';
  if (/\b(beasiswa|scholarship|potongan|diskon)\b/.test(q)) return 'SCHOLARSHIP';
  if (/\b(ukm|ormawa|organisasi|mahasiswa)\b/.test(q)) return 'UKM';
  return 'GENERAL';
};
(async ()=>{
  for (const q of queries) {
    const rewrite = q;
    const intent = detectIntent(q);
    const result = await query(q, 10, { answerQuestion: q, strict: true });
    const finalText = sanitizeWhatsappText(String(result.answer || ''));
    console.log('=== QUERY ===');
    console.log('query:', q);
    console.log('rewrite:', rewrite);
    console.log('intent:', intent);
    console.log('source:', result.source);
    console.log('success:', result.success);
    console.log('finalText:', finalText.replace(/\n/g,'\\n'));
  }
})();
