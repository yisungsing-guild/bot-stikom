const fs = require('fs');

// Load actual chunk
const index = JSON.parse(fs.readFileSync('src/data/rag_index.json', 'utf8'));
const chunk6631dfc1 = index.find(i => i.id === '6631dfc1-b46c-4933-a340-392dfd2250d6');

const chunkText = String(chunk6631dfc1.chunk || '').toLowerCase();

console.log('='.repeat(120));
console.log('ACADEMIC INTENT MATCHING ANALYSIS');
console.log('='.repeat(120));

// From the actual implementation
function getAllowedAcademicCategories(intent) {
  const map = {
    'DEFINISI_PRODI': new Set(['PROGRAM_STUDI', 'INFO']),
    'FOKUS_PRODI': new Set(['KURIKULUM', 'PROGRAM_STUDI']),
    'MATA_KULIAH': new Set(['KURIKULUM', 'PROGRAM_STUDI']),
    'PROSPEK_KERJA': new Set(['KARIR', 'PROGRAM_STUDI']),
    'CODING': new Set(['KURIKULUM', 'PROGRAM_STUDI']),
    'BIAYA': new Set(['BIAYA', 'PMB', 'PROGRAM_STUDI']),
    'AKREDITASI': new Set(['AKREDITASI', 'PROGRAM_STUDI']),
    'LOKASI': new Set(['LOKASI', 'INFO', 'FASILITAS', 'PROGRAM_STUDI']),
    'BEASISWA': new Set(['BEASISWA', 'BIAYA', 'PROGRAM_STUDI']),
  };
  return map[String(intent || '').toUpperCase()] || new Set(['PROGRAM_STUDI', 'KURIKULUM', 'KARIR']);
}

function getAcademicIntentEvidenceRegex(intent) {
  const map = {
    'DEFINISI_PRODI': /\b(apa\s+itu|apa\s+yang\s+dimaksud|pengertian|definisi|mengenai|penjelasan|istilah|profil\s+lulusan|tujuan|visi|misi|capaian\s+pembelajaran|deskripsi)\b/i,
    'PROSPEK_KERJA': /\b(prospek\s+kerja|peluang\s+kerja|karir|profesi|pekerjaan|lulus|lowongan|job|gaji|pasar\s+kerja)\b/i,
  };
  return map[String(intent || '').toUpperCase()] || /\b(program\s+studi|prodi)\b/i;
}

const academicIntent = 'DEFINISI_PRODI';
const category = 'KURIKULUM'; // From chunk6631dfc1.docCategory

console.log('\n[CONDITION 1] Check if category in allowed categories:');
const allowedCategories = getAllowedAcademicCategories(academicIntent);
console.log('  Academic Intent:', academicIntent);
console.log('  Chunk Category:', category);
console.log('  Allowed Categories:', Array.from(allowedCategories).join(', '));
const categoryMatch = allowedCategories.has(category);
console.log('  Match:', categoryMatch);

if (categoryMatch) {
  console.log('  RESULT: Would accept chunk (condition 1)');
} else {
  console.log('  RESULT: Condition 1 failed, check condition 2');
}

console.log('\n[CONDITION 2] Check if evidence regex matches:');
const evidenceRegex = getAcademicIntentEvidenceRegex(academicIntent);
console.log('  Regex:', evidenceRegex);
const hasEvidence = evidenceRegex.test(chunkText);
console.log('  Match:', hasEvidence);

if (hasEvidence) {
  console.log('  RESULT: Would accept chunk (condition 2)');
  // Find what matched
  const match = chunkText.match(evidenceRegex);
  console.log('  Matched text:', match ? match[0] : 'N/A');
} else {
  console.log('  RESULT: Condition 2 failed');
}

if (!categoryMatch && !hasEvidence) {
  console.log('\n[FINAL] CHUNK WOULD BE REJECTED');
  console.log('Reason: Neither category match nor evidence match found');
}

console.log('\n[DEBUG] Full chunk text:');
console.log(chunkText);

console.log('\n' + '='.repeat(120));
