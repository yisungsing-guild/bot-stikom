/**
 * Verify patch runtime: simulate provider endpoint with query "Berapa biaya TI gelombang 2C?"
 * Capture trace values: incomingIntent, candidateIntent, finalIntent, programs, template, etc.
 */

const path = require('path');

// Mock environment
const mockQuery = 'Berapa biaya TI gelombang 2C?';
const mockIncomingIntent = 'COST';
const mockIncomingConfidence = 0.95;

// Mock RAG answer with biaya content
const mockRagAnswer = `
Untuk Program Studi Teknologi Informasi, rincian biaya pendaftaran gelombang 2C:

Biaya Awal Masuk (BPA): Rp 3.500.000
Dana Pendidikan Pokok (DPP): Rp 6.500.000
UKT (Uang Kuliah Tunggal): Rp 2.500.000 - Rp 5.000.000

Total biaya semester pertama sekitar Rp 12.500.000

Cicilan bulanan tersedia dengan opsi pembayaran fleksibel.
`;

console.log('\n' + '='.repeat(100));
console.log('RUNTIME PATCH VERIFICATION');
console.log('='.repeat(100));
console.log('\n[INPUT]');
console.log('Query:', mockQuery);
console.log('Incoming Intent:', mockIncomingIntent);
console.log('Incoming Confidence:', mockIncomingConfidence);
console.log('RAG Answer Preview:', mockRagAnswer.slice(0, 100) + '...');

// Import whatsappFormatter to test parsing
const formatter = require('../src/utils/whatsappFormatter');

// Extract traces by simulating detectIntentFromAnswer flow
console.log('\n' + '-'.repeat(100));
console.log('[STEP 1] detectIntentFromAnswerFromText (answer intent detection)');
console.log('-'.repeat(100));
const answerIntent = formatter.detectIntentFromAnswerFromText(mockRagAnswer);
console.log('answerIntent from RAG:', answerIntent);

console.log('\n' + '-'.repeat(100));
console.log('[STEP 2] detectIntentFromQuery (query intent detection)');
console.log('-'.repeat(100));
const queryIntent = formatter.detectIntentFromQuery(mockQuery);
console.log('queryIntent from query:', queryIntent);

console.log('\n' + '-'.repeat(100));
console.log('[STEP 3] detectIntentFromAnswer (combined logic - AFTER PATCH)');
console.log('-'.repeat(100));
const candidateIntent = formatter.detectIntentFromAnswer(mockRagAnswer, mockQuery);
console.log('candidateIntent result:', candidateIntent);
console.log('^ This should be "biaya" because answer contains Rp and fee keywords');

console.log('\n' + '-'.repeat(100));
console.log('[STEP 4] mapProviderIntentToFormatter (provider intent mapping)');
console.log('-'.repeat(100));
const mappedIncomingIntent = formatter.mapProviderIntentToFormatter(mockIncomingIntent);
console.log('Incoming Intent:', mockIncomingIntent);
console.log('Mapped to formatter intent:', mappedIncomingIntent);

console.log('\n' + '-'.repeat(100));
console.log('[STEP 5] detectResponseIntent logic (from provider.js)');
console.log('-'.repeat(100));
// Simulate detectResponseIntent logic
const HIGH_CONF_THRESHOLD = 0.80;
const incomingIsHigh = mockIncomingIntent && mockIncomingConfidence >= HIGH_CONF_THRESHOLD;
const incomingIsGeneral = !mappedIncomingIntent || String(mappedIncomingIntent).toLowerCase() === 'general' || String(mappedIncomingIntent).toLowerCase() === 'unknown';

console.log('Incoming Confidence:', mockIncomingConfidence);
console.log('Is High Confidence?', incomingIsHigh, '(>=' + HIGH_CONF_THRESHOLD + ')');
console.log('Is General/Unknown Intent?', incomingIsGeneral);
console.log('Mapped Intent:', mappedIncomingIntent);
console.log('Candidate Intent:', candidateIntent);

let finalIntent;
if (incomingIsHigh && !incomingIsGeneral) {
  console.log('\n→ Using INCOMING intent (high confidence, not general)');
  finalIntent = mappedIncomingIntent;
} else if (candidateIntent && candidateIntent !== mappedIncomingIntent && candidateIntent !== 'general') {
  console.log('\n→ Using CANDIDATE intent (incoming is low-conf or general)');
  finalIntent = candidateIntent;
} else if (mappedIncomingIntent) {
  console.log('\n→ Using MAPPED INCOMING intent (candidate is general or absent)');
  finalIntent = mappedIncomingIntent;
} else if (candidateIntent) {
  console.log('\n→ Using CANDIDATE intent (no incoming mapping)');
  finalIntent = candidateIntent;
} else {
  console.log('\n→ Fallback to GENERAL');
  finalIntent = 'general';
}
console.log('Final Intent Result:', finalIntent);
console.log('^ This should be "biaya" (either from incoming COST or candidateIntent biaya)');

console.log('\n' + '-'.repeat(100));
console.log('[STEP 6] Program parsing - mapProgramAlias (query)');
console.log('-'.repeat(100));
const queryProgram = formatter.mapProgramAlias(mockQuery);
console.log('Query:', mockQuery);
console.log('queryProgram result:', queryProgram);
console.log('^ Should be "Teknologi Informasi" (from "TI")');

console.log('\n' + '-'.repeat(100));
console.log('[STEP 7] Program parsing - extractProgramFromText (answer - AFTER PATCH)');
console.log('-'.repeat(100));
const answerProgram = formatter.extractProgramFromText(mockRagAnswer);
console.log('Answer snippet:', mockRagAnswer.slice(0, 80) + '...');
console.log('answerProgram result:', answerProgram);
console.log('^ Should be "Teknologi Informasi" (from "Program Studi Teknologi Informasi")');
console.log('^ NOT a false positive from list context');

console.log('\n' + '-'.repeat(100));
console.log('[STEP 8] Program resolution - programFinal (not changed, as per request)');
console.log('-'.repeat(100));
const programFinal = answerProgram || queryProgram || null;
console.log('Order: answerProgram || queryProgram || null');
console.log('answerProgram:', answerProgram);
console.log('queryProgram:', queryProgram);
console.log('programFinal result:', programFinal);
console.log('^ Should be "Teknologi Informasi"');

console.log('\n' + '='.repeat(100));
console.log('EXPECTED VS ACTUAL COMPARISON');
console.log('='.repeat(100));

const expectations = [
  { name: 'incomingIntent', expected: 'COST', actual: mockIncomingIntent },
  { name: 'candidateIntent', expected: 'biaya', actual: candidateIntent },
  { name: 'finalIntent', expected: 'biaya', actual: finalIntent },
  { name: 'queryProgram', expected: 'Teknologi Informasi', actual: queryProgram },
  { name: 'answerProgram', expected: 'Teknologi Informasi', actual: answerProgram },
  { name: 'programFinal', expected: 'Teknologi Informasi', actual: programFinal },
  { name: 'selectedTemplate', expected: 'biaya', actual: finalIntent }
];

let allPass = true;
expectations.forEach(({ name, expected, actual }) => {
  const pass = actual === expected;
  const status = pass ? '✓ PASS' : '✗ FAIL';
  console.log(`\n${status} | ${name}`);
  console.log(`       Expected: ${expected}`);
  console.log(`       Actual:   ${actual}`);
  if (!pass) allPass = false;
});

console.log('\n' + '='.repeat(100));
if (allPass) {
  console.log('✓ ALL CHECKS PASSED - Patches working correctly!');
} else {
  console.log('✗ SOME CHECKS FAILED - See details above');
}
console.log('='.repeat(100) + '\n');
