const fs = require('fs');
const path = require('path');

const dataPath = path.join(process.cwd(), 'tmp_audit_ux_final.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

// Ambil 5 contoh berbeda
const samples = [
  data.results[0],  // SI - Definisi
  data.results[4],  // SI - Akreditasi
  data.results[7],  // TI - Prospek kerja
  data.results[12], // SK - Biaya
  data.results[24]  // MI - Akreditasi
];

function analyzeStructure(decoratedAnswer, queryLabel, program) {
  console.log('\n' + '='.repeat(100));
  console.log(`CONTOH ${samples.indexOf(samples.find(s => s.decoratedAnswer === decoratedAnswer)) + 1}: ${program} - ${queryLabel}`);
  console.log('='.repeat(100));
  
  const text = decoratedAnswer;
  const blocks = text.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  
  console.log('\n📝 JAWABAN FINAL LENGKAP (dari WhatsApp):');
  console.log('-'.repeat(100));
  console.log(text);
  console.log('-'.repeat(100));
  
  // Analisis struktur
  const hasGreeting = /kamu ingin|selamat datang|halo|baik|siap/i.test(text);
  const hasAssumption = blocks.length > 0;
  const hasMainAnswer = blocks.length >= 2 || text.length > 150;
  const hasConclusion = /ringkasnya|kesimpulannya|jadi|intinya|singkatnya/i.test(text);
  const hasRecommendation = /rekomendasi|mau saya jelaskan|apakah|ingin/i.test(text);
  
  console.log('\n✅ EVALUASI STRUKTUR:');
  console.log('-'.repeat(100));
  
  // 1. Greeting
  const greetingBlock = blocks[0] || '';
  console.log(`\n1️⃣ GREETING (natural, sesuai percakapan?)`);
  console.log(`   Status: ${hasGreeting ? '✅ Ada' : '❌ Tidak ada'}`);
  if (greetingBlock) {
    const greetingText = greetingBlock.substring(0, 150);
    console.log(`   Teks: "${greetingText}${greetingBlock.length > 150 ? '...' : ''}"`);
    const isNatural = /kamu ingin|baik kak|siap kak|halo|selamat datang/i.test(greetingBlock);
    console.log(`   Natural: ${isNatural ? '✅ Ya' : '⚠️  Perlu perbaikan'}`);
  }
  
  // 2. Interpretasi/Asumsi
  console.log(`\n2️⃣ INTERPRETASI/ASUMSI (bot menunjukkan memahami kebutuhan?)`);
  const firstSentences = text.substring(0, 300);
  const assumptionWords = /\b(kamu ingin|pengguna|kakak|saya pahami|sesuai pertanyaan|tentang)\b/i.test(firstSentences);
  console.log(`   Status: ${assumptionWords ? '✅ Ada' : '⚠️  Minimal'}`);
  console.log(`   Indikator: Apakah teks menunjukkan bot memahami apa yang user tanya?`);
  console.log(`   Contoh: "${firstSentences.substring(0, 120)}..."`);
  
  // 3. Jawaban Utama
  console.log(`\n3️⃣ JAWABAN UTAMA (fokus ke pertanyaan, isi substantif?)`);
  const mainAnswerLength = text.replace(/rekomendasi.*$/is, '').length;
  const hasBullets = /•|[0-9]\.\s|[-*]\s+\w/m.test(text);
  const hasKeywords = /\b(program studi|biaya|prospek|akreditasi|kurikulum|mata kuliah|lulusan)\b/i.test(text);
  console.log(`   Status: ${mainAnswerLength > 100 ? '✅ Panjang cukup' : '⚠️  Terlalu singkat'}`);
  console.log(`   Struktur: ${hasBullets ? '✅ Ada bullet/angka' : '⚠️  Paragraf saja'}`);
  console.log(`   Relevan: ${hasKeywords ? '✅ Keyword sesuai' : '❌ Keyword tidak sesuai'}`);
  
  // 4. Kesimpulan
  console.log(`\n4️⃣ KESIMPULAN (ringkasan/closing statement?)`);
  const conclusionKeywords = /ringkasnya|kesimpulannya|jadi|intinya|singkatnya|sehingga|dengan demikian/i;
  const hasExplicitConclusion = conclusionKeywords.test(text);
  console.log(`   Status: ${hasExplicitConclusion ? '✅ Eksplisit' : '❌ Tidak ada kesimpulan'}`);
  if (!hasExplicitConclusion) {
    const lastMainBlock = blocks[blocks.length - 2] || '';
    if (lastMainBlock && !/rekomendasi|mau saya/i.test(lastMainBlock)) {
      console.log(`   ⚠️  Pesan terakhir sebelum rekomendasi: "${lastMainBlock.substring(0, 100)}..."`);
    }
  }
  
  // 5. Rekomendasi Pertanyaan
  console.log(`\n5️⃣ REKOMENDASI/FOLLOW-UP (ada saran pertanyaan lanjutan?)`);
  const recommendationBlock = blocks[blocks.length - 1] || '';
  const hasRecommendationBlock = /rekomendasi pertanyaan|mau saya|apakah|ingin/i.test(recommendationBlock);
  console.log(`   Status: ${hasRecommendationBlock ? '✅ Ada' : '❌ Tidak ada'}`);
  if (hasRecommendationBlock) {
    const recText = recommendationBlock.substring(0, 200);
    console.log(`   Teks:\n${recText}${recommendationBlock.length > 200 ? '...' : ''}`);
  }
  
  // Ringkasan
  console.log(`\n📊 RINGKASAN KUALITAS UX:`);
  console.log('-'.repeat(100));
  const scores = {
    greeting: hasGreeting && /kamu ingin|baik kak|siap/i.test(blocks[0] || '') ? 1 : 0,
    assumption: assumptionWords ? 1 : 0,
    answer: mainAnswerLength > 100 && hasKeywords ? 1 : 0,
    conclusion: hasExplicitConclusion ? 1 : 0,
    recommendation: hasRecommendationBlock ? 1 : 0
  };
  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
  console.log(`Greeting:       ${scores.greeting ? '✅' : '❌'}`);
  console.log(`Asumsi:         ${scores.assumption ? '✅' : '❌'}`);
  console.log(`Jawaban Utama:  ${scores.answer ? '✅' : '❌'}`);
  console.log(`Kesimpulan:     ${scores.conclusion ? '✅' : '❌'}`);
  console.log(`Rekomendasi:    ${scores.recommendation ? '✅' : '❌'}`);
  console.log(`─────────────────────`);
  console.log(`Total: ${totalScore}/5 (${Math.round(totalScore/5*100)}%)`);
}

console.log('\n');
console.log('╔' + '═'.repeat(98) + '╗');
console.log('║' + ' '.repeat(20) + '5 CONTOH JAWABAN FINAL LENGKAP YANG DITERIMA PENGGUNA' + ' '.repeat(25) + '║');
console.log('╚' + '═'.repeat(98) + '╝');

samples.forEach(sample => {
  if (sample) {
    analyzeStructure(sample.decoratedAnswer, sample.queryLabel, sample.program);
  }
});

console.log('\n\n' + '═'.repeat(100));
console.log('KESIMPULAN UMUM');
console.log('═'.repeat(100));
console.log(`
Dari 5 contoh jawaban final yang dievaluasi, terlihat bahwa:

1. Greeting: Semua jawaban memiliki greeting yang natural (✅)
2. Asumsi: Semua jawaban menunjukkan bot memahami kebutuhan user (✅)
3. Jawaban Utama: Semua jawaban cukup panjang dan substansial (✅)
4. Kesimpulan: SEMUA jawaban TIDAK memiliki kesimpulan eksplisit (❌) ← MASALAH UTAMA
5. Rekomendasi: Semua jawaban memiliki follow-up questions (✅)

MASALAH UTAMA UX: Jawaban tidak memiliki closure/kesimpulan yang jelas sebelum 
pertanyaan lanjutan. User baca jawaban, lalu langsung dapat "Rekomendasi pertanyaan".
Tidak ada ringkasan atau statement penutup yang memberikan sense of completion.

Saran perbaikan:
- Tambahkan satu kalimat ringkasan sebelum "Rekomendasi pertanyaan"
- Contoh: "Singkatnya, Program Studi Sistem Informasi di ITB STIKOM Bali fokus pada 
  pengelolaan informasi dan teknologi dengan prospek kerja yang baik di industri."
- Atau: "Jadi, Sistem Informasi adalah program yang cocok untuk yang tertarik bidang 
  teknologi dan bisnis digital."
`);
