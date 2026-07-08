const chunk = 'Program Studi Teknologi Informasi adalah program yang mempelajari sistem informasi dan teknologi jaringan.';
const item = { category: 'PROGRAM_STUDI' };
const academicIntent = 'DEFINISI_PRODI';
const queryEntities = { program: 'TI' };
function getAllowedAcademicCategories(intent) {
  switch (String(intent || '').toUpperCase()) {
    case 'DEFINISI_PRODI':
      return new Set([ 'PROGRAM_STUDI', 'INFO', 'KURIKULUM' ]);
    default: return new Set(['PROGRAM_STUDI']);
  }
}
function chunkHasRequestedProgram(item, requestedProgram) {
  const text = String(item && item.chunk || item && item.filename || '').toLowerCase();
  const prog = String(requestedProgram || '').toLowerCase();
  if (!prog) return false;
  if (prog === 'ti' && /\b(?:ti|teknologi informasi)\b/i.test(text)) return true;
  return false;
}
function chunkMatchesAcademicIntent(chunk, item, academicIntent, queryEntities) {
  if (!academicIntent) return true;
  const text = String(chunk || '').toLowerCase();
  const category = item && (item.category || item.docCategory) ? String(item.category || item.docCategory).toUpperCase() : null;
  const allowedCategories = getAllowedAcademicCategories(academicIntent);
  const evidenceRegex = /\b(apa\s+itu|apa\s+yang\s+dimaksud|pengertian|definisi|mengenai|penjelasan|istilah|profil\s+lulusan|tujuan|visi|misi|capaian\s+pembelajaran|deskripsi)\b/i;
  const hasEvidence = evidenceRegex.test(text);
  const requestedProgram = queryEntities && queryEntities.program ? String(queryEntities.program).toUpperCase() : null;
  const mentionsRequestedProgram = requestedProgram ? chunkHasRequestedProgram(item, requestedProgram) : false;
  if (allowedCategories.has(category)) {
    return true;
  }
  if (hasEvidence) {
    return true;
  }
  if (mentionsRequestedProgram && academicIntent && academicIntent !== 'ACADEMIC_PROGRAM') {
    const academicPatterns = /\b(prodi|program|studi|kuliah|akademik|kursus|mata kuliah|kurikulum|pembelajaran|pendidikan|semester|sks|fokus|tujuan|lulusan|prospek|karir|kerja|pekerjaan|lowongan|gaji|industri|bidang|minat|konsentrasi|keahlian)\b/i;
    if (academicPatterns.test(text)) {
      return true;
    }
  }
  return false;
}
console.log('category', item.category);
console.log('allowedCategories', Array.from(getAllowedAcademicCategories(academicIntent)).join(','));
console.log('matches', chunkMatchesAcademicIntent(chunk, item, academicIntent, queryEntities));
console.log('hasEvidence', /\b(apa\s+itu|apa\s+yang\s+dimaksud|pengertian|definisi|mengenai|penjelasan|istilah|profil\s+lulusan|tujuan|visi|misi|capaian\s+pembelajaran|deskripsi)\b/i.test(chunk));
console.log('mentionsRequestedProgram', chunkHasRequestedProgram(item, queryEntities.program));
