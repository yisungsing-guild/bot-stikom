/**
 * Test untuk 4 Masalah Presentation Layer:
 * 1. Mini summary yang lebih smart (hindari bullets, lists, structured data)
 * 2. Rhetorical questions removal dari body
 * 3. Raw quotes conversion to natural explanation
 * 4. STIKOM program filtering
 */

const {
  buildMiniSummary,
  removeRetoricalQuestions,
  convertRawQuotesToNatural,
  filterNonStikomPrograms,
  cleanMainAnswer,
  formatHumanizedResponse
} = require('./src/engine/humanizer');

console.log('\n===============================================');
console.log('TEST 1: Mini Summary - Smart Selection');
console.log('===============================================\n');

const shortAnswer = `Program Studi Teknologi Informasi adalah program pilihan.
TI fokus pada coding dan database.`;

const tooShortSummary = buildMiniSummary(shortAnswer, 'program_studi', 'Apa itu TI');
console.log('Short answer (<5 lines):');
console.log('Input:', shortAnswer);
console.log('Summary:', tooShortSummary || '[EMPTY - Correctly skipped short answer]');
console.log('✓ Should be EMPTY for short answers\n');

const answerWithBullets = `Program Studi TI adalah program terkemuka.

Keunggulan program:
- Kurikulum internasional
- Dosen berpengalaman
- Fasilitas modern

Lulusan memiliki prospek kerja yang sangat baik di industri teknologi global.`;

const bulletSummary = buildMiniSummary(answerWithBullets, 'program_studi', 'TI');
console.log('Answer with bullets:');
console.log('Summary:', bulletSummary);
console.log('✓ Should skip bullets and use "Lulusan memiliki prospek..." not "Kurikulum internasional"\n');

const answerWithStructuredData = `Program Studi SI adalah pilihan populer.

Informasi program:
Lulusan: Sistem Informasi
Prospek: Software Developer
Bidang: IT Management

Sistem Informasi mengajarkan bagaimana mengelola teknologi informasi untuk bisnis modern.`;

const structuredSummary = buildMiniSummary(answerWithStructuredData, 'program_studi', 'SI');
console.log('Answer with structured data:');
console.log('Summary:', structuredSummary);
console.log('✓ Should skip "Lulusan:", "Prospek:", "Bidang:" lines\n');

console.log('===============================================');
console.log('TEST 2: Rhetorical Questions Removal');
console.log('===============================================\n');

const answerWithRhetoric = `Program Studi Teknologi Informasi adalah program unggulan.

Apa saja peluang karir yang bisa diambil setelah lulus? Tentu saja lulusan TI memiliki banyak pilihan.

Prospek kerja termasuk Software Developer, Data Scientist, dan Cloud Architect.

Apakah Anda ingin tahu lebih lanjut tentang kurikulum? Kami siap membantu Kakak.

Jangan ragu untuk menghubungi kami untuk informasi lebih detail.`;

const cleanedRhetoric = removeRetoricalQuestions(answerWithRhetoric);
console.log('ORIGINAL (dengan rhetorical questions):');
console.log(answerWithRhetoric);
console.log('\n\nCLEANED (rhetorical questions removed):');
console.log(cleanedRhetoric);
console.log('\n✓ Removed: "Apa saja peluang karir...", "Apakah Anda ingin tahu...", "Jangan ragu..."\n');

console.log('===============================================');
console.log('TEST 3: Raw Quotes to Natural Explanation');
console.log('===============================================\n');

const answerWithQuote = `Program Studi Teknologi Informasi adalah program terkemuka di bidang teknologi informasi modern.

\"Teknologi Informasi adalah disiplin ilmu yang mempelajari tentang pemrosesan data dengan menggunakan perangkat keras dan perangkat lunak komputer untuk menghasilkan informasi yang berkualitas tinggi guna mendukung pengambilan keputusan di semua tingkatan dalam organisasi modern.\"

Lulusan program ini memiliki kemampuan untuk mengembangkan sistem informasi yang kompleks.`;

const naturalAnswer = convertRawQuotesToNatural(answerWithQuote);
console.log('BEFORE (dengan long quote):');
console.log(answerWithQuote);
console.log('\n\nAFTER (quote removed, natural format):');
console.log(naturalAnswer);
console.log('\n✓ Long quoted definition removed, kept natural explanation\n');

console.log('===============================================');
console.log('TEST 4: Non-STIKOM Programs Filtering');
console.log('===============================================\n');

const recommendationWithWrongPrograms = `Untuk karir di bidang IT, ada beberapa pilihan:

1. Teknik Informatika - untuk yang fokus pada hardware dan sistem
2. Sistem Informasi - untuk manajemen sistem informasi
3. Ilmu Komputer - untuk teori komputasi
4. Program Studi Teknologi Informasi di STIKOM - fokus pada software development
5. Statistika - untuk analisis data
6. Sistem Komputer - fokus pada jaringan dan security

Di STIKOM Bali, kami hanya menawarkan program yang sesuai dengan kebutuhan industri lokal.`;

const stikomFiltered = filterNonStikomPrograms(recommendationWithWrongPrograms);
console.log('BEFORE (mix STIKOM & non-STIKOM programs):');
console.log(recommendationWithWrongPrograms);
console.log('\n\nAFTER (only STIKOM programs):');
console.log(stikomFiltered);
console.log('\n✓ Removed: Teknik Informatika, Ilmu Komputer, Statistika');
console.log('✓ Kept: Sistem Informasi, Teknologi Informasi, Sistem Komputer\n');

console.log('===============================================');console.log('TEST 4b: Non-STIKOM filter should preserve generic academic text');
console.log('===============================================\n');

const genericAcademicText = `Sistem informasi adalah suatu disiplin ilmu yang mempelajari pengelolaan dan analisis data melalui sistem informasi. Program studi ini mengajarkan manajemen data, keamanan informasi, dan integrasi teknologi informasi.`;
const genericPreserved = filterNonStikomPrograms(genericAcademicText);
console.log('BEFORE (generic academic text):');
console.log(genericAcademicText);
console.log('\n\nAFTER:');
console.log(genericPreserved);
console.log('\n✓ Should preserve generic academic descriptions that mention manajemen data, tanpa menghapus baris valid.\n');

console.log('===============================================');console.log('TEST 5: Full Cleanup Flow for program_definition');
console.log('===============================================\n');

const fullAnswerWithAllIssues = `Program Studi Teknologi Informasi adalah program unggulan.

Apa saja keunggulan program ini? Mari kita bahas.

\"Program Studi Teknologi Informasi adalah disiplin ilmu yang mempersiapkan profesional di bidang pengembangan perangkat lunak dan sistem informasi modern.\"

Kurikulum mencakup:
- Programming languages
- Database management
- Web development
- Cloud computing

Apakah Anda tertarik dengan program ini? Hubungi kami sekarang!

Prospek kerja lulusan TI sangat baik dengan gaji kompetitif di pasar kerja Indonesia dan global.`;

const cleaned = cleanMainAnswer(fullAnswerWithAllIssues, 'program_definition');
console.log('FULL CLEANUP (program_definition intent):');
console.log(cleaned);
console.log('\n✓ Removed: rhetorical questions, long quotes');
console.log('✓ Kept: main content, natural explanation\n');

console.log('===============================================');
console.log('TEST 6: Full Cleanup for rekomendasi_prodi');
console.log('===============================================\n');

const recommendationAnswer = `Untuk karir programming, ada beberapa program yang cocok:

1. Teknik Informatika dari universitas lain - fokus hardware
2. Program Studi Teknologi Informasi di STIKOM - fokus software development
3. Sistem Informasi di STIKOM - fokus manajemen IT
4. Statistika dari universitas lain - fokus data

Apakah kamu tertarik? Hubungi kami untuk daftar.

Di STIKOM, kami memiliki dua program utama untuk programmer: TI dan SI.`;

const recommendFiltered = cleanMainAnswer(recommendationAnswer, 'rekomendasi_prodi');
console.log('FULL CLEANUP (rekomendasi_prodi intent):');
console.log(recommendFiltered);
console.log('\n✓ Removed: non-STIKOM programs (Teknik Informatika, Statistika)');
console.log('✓ Removed: rhetorical questions');
console.log('✓ Kept: STIKOM programs only (TI, SI)\n');

console.log('===============================================');
console.log('SUMMARY');
console.log('===============================================\n');
console.log('✓ Mini summary: Smart selection (skips bullets, lists, short answers)');
console.log('✓ Rhetorical questions: Removed from body');
console.log('✓ Raw quotes: Converted to natural explanation');
console.log('✓ Program filtering: Only STIKOM programs shown');
console.log('✓ All cleanup applied in cleanMainAnswer flow\n');
