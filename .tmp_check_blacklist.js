const fs = require('fs');
const orig = JSON.parse(fs.readFileSync('src/data/rag_index.json', 'utf8'));
const target = '6631dfc1-b46c-4933-a340-392dfd2250d6';
const chunk = orig.find(c => c.id === target);

const text = String(chunk.chunk).toLowerCase();
const file = String(chunk.filename).toLowerCase();

// EXACT regex from ragEngine.js line 3296-3297
const blacklisted = /\b(?:surat\s+keputusan|sk\s*(?:no|nomor|akreditasi|keputusan|penetapan|rektorat|pembina|pendaftaran|tanggal)|mou|moa|kerja\s+sama|perjanjian|notulen|berita\s+acara|administrasi|arsip|dokumen\s+internal|tembusan|cap|stempel|tanda\s+tangan|rektor|direktur|yayasan|ketua|lampiran|perihal|menimbang|mengingat|memutuskan|ditetapkan\s+di|pada\s+tanggal)\b/i;
const metadata = /\b(?:ketua|direktur|rektor|yayasan|tembusan|cap|stempel|tanda\s+tangan)\b/i;

console.log('=== CHUNK 6631dfc1 BLACKLIST STATUS ===\n');
console.log('Filename:', file);
console.log('Chunk text length:', text.length);
console.log('');

console.log('REGEX TESTS:');
console.log('  Blacklist regex matches chunk text:', blacklisted.test(text));
console.log('  Blacklist regex matches filename:', blacklisted.test(file));
console.log('  Metadata regex matches chunk text:', metadata.test(text));
console.log('  Metadata regex matches filename:', metadata.test(file));
console.log('');

if (blacklisted.test(text)) {
  const m = text.match(blacklisted);
  console.log('  → Matched in text: "' + m[0] + '"');
}
if (metadata.test(text)) {
  const m = text.match(metadata);
  console.log('  → Metadata match in text: "' + m[0] + '"');
}

const isBlacklisted = blacklisted.test(text) || blacklisted.test(file) || metadata.test(text) || metadata.test(file);
console.log('');
console.log('FINAL RESULT: isAcademicProgramBlacklistChunk() =', isBlacklisted ? 'TRUE (BLACKLISTED)' : 'FALSE (NOT blacklisted)');

// Show first 400 chars of chunk
console.log('\n=== CHUNK PREVIEW ===');
console.log(chunk.chunk.substring(0, 400));
