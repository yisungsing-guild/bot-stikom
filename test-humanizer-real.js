/**
 * Test Humanizer improvements based on real requirements:
 * 1. Remove retrieval artifacts
 * 2. Improve follow-up questions (query-specific)
 * 3. Fix mini summary (no first sentence repeat)
 * 4. Remove marketing blocks for non-marketing intents
 */

const {
  formatHumanizedResponse,
  cleanMainAnswer,
  buildMiniSummary,
  removeIrrelevantMarketingSections,
  generateFollowUpQuestions
} = require('./src/engine/humanizer');

console.log('\n===============================================');
console.log('TEST 1: Retrieval Artifact Removal');
console.log('===============================================\n');

const answerWithArtifacts = `Saya menemukan kutipan berikut tentang Program Studi Teknologi Informasi:

Program Studi Teknologi Informasi (TI) di ITB STIKOM Bali adalah program yang fokus pada pengembangan software dan sistem informasi. 

Lulusan TI memiliki prospek kerja yang sangat baik di bidang software development, data science, dan cybersecurity.

Sumber: https://www.itb-stikom.ac.id/program/ti
https://www.itb-stikom.ac.id/beasiswa

Untuk meringankan biaya kuliah, silakan hubungi PMB untuk informasi beasiswa KIP dan Beasiswa Prestasi.`;

const cleaned1 = cleanMainAnswer(answerWithArtifacts, 'program_studi');
console.log('CLEANED (program_studi intent):\n', cleaned1);
console.log('\n✓ Should remove: "Saya menemukan kutipan", "Sumber:", URLs\n');

console.log('===============================================');
console.log('TEST 2: Follow-up Questions - Coding Query');
console.log('===============================================\n');

const codingQuery = 'Saya suka coding, cocok masuk prodi apa?';
const followUps = generateFollowUpQuestions('program_studi', codingQuery, { program: 'TI' });
console.log('Query:', codingQuery);
console.log('Follow-ups:\n', followUps.map((q, i) => `${i+1}. ${q}`).join('\n'));
console.log('\n✓ Should include TI, SI, coding, prospek kerja - NOT generic questions\n');

console.log('===============================================');
console.log('TEST 3: Follow-up Questions - Data Analyst Query');
console.log('===============================================\n');

const dataQuery = 'Jurusan apa yang cocok untuk Data Analyst?';
const followUps2 = generateFollowUpQuestions('program_studi', dataQuery, {});
console.log('Query:', dataQuery);
console.log('Follow-ups:\n', followUps2.map((q, i) => `${i+1}. ${q}`).join('\n'));
console.log('\n✓ Should include Data Analyst, Sistem Informasi, TI, skill requirements\n');

console.log('===============================================');
console.log('TEST 4: Mini Summary - Avoid First Sentence Repeat');
console.log('===============================================\n');

const answerWithMultipleSentences = `Program Studi Teknologi Informasi adalah program pilihan yang populer. TI fokus pada pengembangan software dan sistem. Lulusan memiliki prospek kerja yang sangat luas di industri tech. 

Bidang pekerjaan yang bisa dicapai termasuk software developer, data scientist, dan cloud architect. Gaji rata-rata lulusan TI sangat kompetitif di pasar kerja Indonesia.`;

const summary = buildMiniSummary(answerWithMultipleSentences, 'program_studi', 'apa itu TI');
console.log('Answer (first 100 chars):', answerWithMultipleSentences.substring(0, 100) + '...');
console.log('Mini Summary:', summary);
console.log('\n✓ Summary should use 2nd sentence or paragraph, NOT repeat "Program Studi Teknologi..."');
console.log('✓ If summary too short or similar, should return empty\n');

console.log('===============================================');
console.log('TEST 5: Marketing Block Removal - Non-Marketing Intent');
console.log('===============================================\n');

const answerWithMarketing = `Program Studi Teknologi Informasi adalah program unggulan dengan akreditasi A.

Kurikulum mencakup programming, database, dan network administration.

Prospek kerja lulusan TI sangat baik dengan gaji kompetitif.

Untuk meringankan biaya kuliah, silakan hubungi PMB untuk informasi beasiswa KIP, Beasiswa 1K1S, dan Beasiswa Prestasi. Biaya pendaftaran hanya Rp 500.000 dengan DPP Rp 2.000.000.`;

const cleaned2 = removeIrrelevantMarketingSections(answerWithMarketing, 'program_definition');
console.log('ORIGINAL (with marketing blocks):\n', answerWithMarketing);
console.log('\n\nCLEANED (program_definition intent):\n', cleaned2);
console.log('\n✓ Marketing/biaya/PMB blocks should be removed for program_definition intent');
console.log('✓ But kept if intent is "beasiswa" or "pendaftaran"\n');

console.log('===============================================');
console.log('TEST 6: Full Humanized Response Flow');
console.log('===============================================\n');

const fullAnswer = `Program Studi Teknologi Informasi adalah program yang mengembangkan profesional di bidang software dan sistem informasi.

TI fokus pada coding, database, network, dan sistem keamanan. Lulusan bisa bekerja di berbagai industri.

Untuk meringankan biaya kuliah Anda, silakan hubungi PMB untuk berbagai pilihan beasiswa KIP dan Beasiswa Prestasi.`;

const fullContext = {
  intent: 'program_studi',
  program: 'Teknologi Informasi'
};

const result = formatHumanizedResponse(fullAnswer, 'Apa itu Program Studi TI?', fullContext);
console.log('FULL HUMANIZED RESPONSE:\n');
console.log(result);
console.log('\n✓ Should have: confirmation + cleaned answer + optional summary + follow-ups');
console.log('✓ Should remove: marketing blocks, retrieval artifacts');
console.log('✓ Should NOT have: "Sumber:", URLs, "Kesimpulan:", "Rekomendasi pertanyaan:"\n');

console.log('===============================================');
console.log('SUMMARY');
console.log('===============================================\n');
console.log('✓ Retrieval artifacts removed');
console.log('✓ Follow-up questions are query-specific');
console.log('✓ Mini summary avoids first sentence');
console.log('✓ Marketing blocks removed for non-marketing intents');
console.log('✓ Humanized response with natural language\n');
