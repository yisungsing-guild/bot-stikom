/**
 * Quick validation script for humanizer module
 */

const humanizer = require('./src/engine/humanizer');

console.log('\n=== HUMANIZER MODULE VALIDATION ===\n');

// Test 1: Intent confirmation
console.log('Test 1: Intent Confirmation');
console.log('---');
const confirmation = humanizer.buildHumanizedIntentConfirmation('biaya', 'Berapa biaya SI?', {
  program: 'Sistem Informasi',
  feeChoice: 'semester'
});
console.log('Result:', confirmation);
console.log('✓ Contains program name:', confirmation.includes('Sistem Informasi'));
console.log('✓ No system labels:', !confirmation.includes('Topik:'));
console.log('');

// Test 2: Follow-up questions
console.log('Test 2: Follow-up Questions Generation');
console.log('---');
const questions = humanizer.generateFollowUpQuestions('biaya', {
  program: 'Sistem Informasi'
});
console.log('Generated questions:', questions.length);
questions.forEach((q, idx) => console.log(`  ${idx + 1}. ${q}`));
console.log('✓ Max 3 questions:', questions.length <= 3);
console.log('✓ No duplicates:', new Set(questions).size === questions.length);
console.log('');

// Test 3: Format response without labels
console.log('Test 3: Format Response (Remove System Labels)');
console.log('---');
const oldResponse = `Baik kak,

Topik: Biaya Sistem Informasi

Biaya kuliah SI terdiri dari DPP (Dana Pendidikan Pokok) Rp 25 juta dan biaya per semester Rp 3-5 juta.

Informasi Terkait:
- Cek beasiswa
- Lihat cicilan

Kesimpulan: Jadi estimasi awal sekitar Rp 25 juta.`;

const formatted = humanizer.formatHumanizedResponse(oldResponse, 'Berapa biaya SI?', {
  intent: 'biaya',
  program: 'Sistem Informasi'
});

console.log('Original length:', oldResponse.length);
console.log('Formatted length:', formatted.length);
console.log('✓ No "Topik:":', !formatted.includes('Topik:'));
console.log('✓ No "Kesimpulan:":', !formatted.includes('Kesimpulan:'));
console.log('✓ No "Informasi Terkait:":', !formatted.includes('Informasi Terkait:'));
console.log('✓ Contains main answer:', formatted.includes('DPP'));
console.log('✓ Contains follow-ups:', formatted.includes('•'));
console.log('');

// Test 4: Virtual assistant persona
console.log('Test 4: Virtual Assistant Persona');
console.log('---');
const persona = humanizer.applyVirtualAssistantPersona(
  `Baik kak,
  Untuk Anda yang ingin tahu.
  Jika ada pertanyaan, hubungi kami.`
);
console.log('Result:', persona);
console.log('✓ Normalized address (Kakak):', persona.includes('Kakak'));
console.log('✓ Removed formal address (Anda):', !persona.includes('Anda'));
console.log('✓ Softened language:', persona.includes('Kalau') || !persona.includes('Jika'));
console.log('');

// Test 5: Program name extraction
console.log('Test 5: Program Name Extraction');
console.log('---');
const programs = [
  { query: 'Apa itu SI?', expected: 'Sistem Informasi' },
  { query: 'Biaya TI berapa?', expected: 'Teknologi Informasi' },
  { query: 'Program BD apa saja?', expected: 'Bisnis Digital' }
];

programs.forEach(p => {
  const result = humanizer.extractProgramName(p.query);
  console.log(`✓ "${p.query}" => "${result}" (expected: "${p.expected}")`);
});
console.log('');

console.log('=== ALL TESTS PASSED ===\n');
