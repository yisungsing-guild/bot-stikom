const fs = require('fs');
const path = require('path');
const evidence = require('./src/engine/evidenceValidator');

const AUDIT = path.join(__dirname, '.tmp_retrieval_results.json');
const INDEX = path.join(__dirname, 'src', 'data', 'rag_index.json');
if (!fs.existsSync(AUDIT)) { console.error('Missing audit file'); process.exit(1); }
if (!fs.existsSync(INDEX)) { console.error('Missing index file'); process.exit(1); }
const audit = JSON.parse(fs.readFileSync(AUDIT,'utf8'));
const index = JSON.parse(fs.readFileSync(INDEX,'utf8'));
const q = audit.find(r => r.question && r.question.toLowerCase().includes('apa itu sistem informasi'));
if (!q) { console.error('Query not found in audit'); process.exit(1); }
const chunkId = '6631dfc1-b46c-4933-a340-392dfd2250d6';
const inTop20 = (q.top20 || []).some(t => (t.item && t.item.id) === chunkId);
const inRelevant = (q.relevantIds || []).some(r => r.id === chunkId);
const inAfterRelevant = (q.afterRelevantIds || []).some(r => r.id === chunkId);
const inValidated = (q.validatedIds || []).some(r => r.id === chunkId);
const inFinal = (q.filteredIds || []).some(r => r.id === chunkId);
const trace = q.trace || {};

const item = index.find(i => i.id === chunkId) || ((q.top20||[]).find(t=>t.item && t.item.id===chunkId) || {}).item;
if (!item) { console.error('Chunk not found in index or top20'); process.exit(1); }

// Recreate chunkMatchesAcademicIntent checks
const academicIntent = (q.queryEntities && q.queryEntities.academicIntent) || q.userIntent || 'DEFINISI_PRODI';
const intent = String(academicIntent || '').toUpperCase();
const category = (item.category || item.docCategory) ? String(item.category || item.docCategory).toUpperCase() : null;
const allowedCategories = new Set(['PROGRAM_STUDI','INFO','KURIKULUM']); // patched
const evidenceRegex = /\b(apa\s+itu|apa\s+yang\s+dimaksud|pengertian|definisi|mengenai|penjelasan|istilah|profil\s+lulusan|tujuan|visi|misi|capaian\s+pembelajaran|deskripsi)\b/i;
const text = String(item.chunk || '').toLowerCase();
const hasEvidence = evidenceRegex.test(text);

// fallback checks
const requestedProgram = (q.queryEntities && q.queryEntities.program) ? String(q.queryEntities.program).toUpperCase() : null;
function chunkHasRequestedProgram(item, requestedProgram) {
  if (!requestedProgram) return false;
  const txt = String(item.chunk||'') + ' ' + String(item.filename||'');
  return new RegExp(requestedProgram, 'i').test(txt) || (requestedProgram === 'SI' && /sistem\s+informasi/i.test(txt));
}
const mentionsRequestedProgram = chunkHasRequestedProgram(item, requestedProgram);
const academicPatterns = /\b(prodi|program|studi|kuliah|akademik|kursus|mata\s+kuliah|kurikulum|pembelajaran|pendidikan|semester|sks|fokus|tujuan|lulusan|profil|prospek|karir|kerja|pekerjaan|lowongan|gaji|industri|bidang|minat|konsentrasi|keahlian)\b/i;
const fallbackAcademic = mentionsRequestedProgram && academicPatterns.test(text);

const academicIntentMatch = (category && allowedCategories.has(category)) || hasEvidence || fallbackAcademic;

// evidenceValidator results
const evidenceResult = evidence.validateChunkEvidence(item, 'DEFINISI_PRODI');
const relevanceResult = evidence.validateChunkRelevanceToQuestion(item, q.question, 'DEFINISI_PRODI');

console.log('TRACE_SUMMARY for chunk', chunkId);
console.log('1) in top20?:', inTop20);
console.log('2) passed filterRelevantChunks():', inRelevant || inAfterRelevant);
console.log('3) chunkMatchesAcademicIntent():', !!academicIntentMatch);
console.log('4) validateChunkEvidence():', evidenceResult);
console.log('5) passed applyIntentAwareFilteringAndValidation():', inValidated);
console.log('6) first rejection stage:');
if (!inTop20) console.log('  - Rejected at retrieval (not in top20)');
else if (!inRelevant) console.log('  - Rejected at filterRelevantChunks() (academic intent mismatch)');
else if (!inValidated) console.log('  - Rejected at applyIntentAwareFilteringAndValidation() (evidence/relevance/forbidden)');
else if (!inFinal) console.log('  - Rejected at final score filtering/ranking');
else console.log('  - Passed all stages');

console.log('7) Boolean conditions:');
console.log('  - allowedCategories.has(category):', category, allowedCategories.has(category));
console.log('  - evidenceRegex.test(text):', hasEvidence);
console.log('  - mentionsRequestedProgram:', mentionsRequestedProgram);
console.log('  - fallbackAcademic:', fallbackAcademic);

console.log('8) Values:');
console.log('  - intent:', intent);
console.log('  - docCategory:', category);
console.log('  - allowedCategories:', Array.from(allowedCategories));
console.log('  - evidenceRegex result:', hasEvidence);
console.log('  - academicIntentMatch:', academicIntentMatch);
console.log('  - validationResult (evidence):', evidenceResult);
console.log('  - validationResult (relevance):', relevanceResult);
