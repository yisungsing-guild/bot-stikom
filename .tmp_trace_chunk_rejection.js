const fs = require('fs');
const path = require('path');

// Load actual chunk from index
const index = JSON.parse(fs.readFileSync('src/data/rag_index.json', 'utf8'));
const chunk6631dfc1 = index.find(i => i.id === '6631dfc1-b46c-4933-a340-392dfd2250d6');

if (!chunk6631dfc1) {
  console.log('ERROR: Chunk 6631dfc1 not found');
  process.exit(1);
}

console.log('='.repeat(120));
console.log('DETAILED CHUNK ANALYSIS: 6631dfc1');
console.log('='.repeat(120));

console.log('\n[METADATA]');
console.log('  ID:', chunk6631dfc1.id);
console.log('  Filename:', chunk6631dfc1.filename);
console.log('  Program:', chunk6631dfc1.program);
console.log('  DocCategory:', chunk6631dfc1.docCategory);
console.log('  ChunkType:', chunk6631dfc1.chunkType);
console.log('  Length:', (chunk6631dfc1.chunk || '').length);

console.log('\n[FULL CHUNK TEXT]');
console.log(chunk6631dfc1.chunk || '(empty)');

console.log('\n[PATTERN MATCHING ANALYSIS]');

const chunkText = String(chunk6631dfc1.chunk || '').toLowerCase();

// Patterns from filterRelevantChunks
const costPattern = /\b(biaya|dpp|ukt|pendaftaran|potongan|diskon|spp|uang\s+kuliah|uang\s+pendaftaran)\b/i;
const programPattern = /\b(program\s+studi|program|prodi|internasional|double\s+degree|dual\s+degree|dnui|help\s+university|utb|china|bali|study\s+abroad)\b/i;
const schedulePattern = /\b(jadwal|gelombang|tanggal|deadline|registrasi|test|pengumuman|daftar\s+ulang|penutupan)\b/i;
const metadataPattern = /\b(kop\s+surat|tanda\s+tangan|nomor\s+surat|halaman|tanggal|alamat|telepon|fax|faximile|website|www\.|email:|dokumen)\b/i;
const legalPattern = /\b(force\s+majeure|perjanjian|kontrak|pasal|ayat|klausul|pihak\s+pertama|pihak\s+kedua|hak\s+dan\s+kewajiban|penyelesaian\s+sengketa)\b/i;

console.log('Cost Pattern matches:', costPattern.test(chunkText));
console.log('Program Pattern matches:', programPattern.test(chunkText));
console.log('Schedule Pattern matches:', schedulePattern.test(chunkText));
console.log('Metadata Pattern matches:', metadataPattern.test(chunkText));
console.log('Legal Pattern matches:', legalPattern.test(chunkText));

// Check for header/footer/admin chunks
const isHeaderFooterChunk = /\b(halaman|page|header|footer|^-{5,}|^={5,}|^_{5,}|\d+\s+of\s+\d+)\b/i.test(chunkText);
const isAdminChunk = /\b(admin|internal|confidential|draft|wip|todo|fixme|xxx|hack|kludge)\b/i.test(chunkText);
console.log('Header/Footer Pattern:', isHeaderFooterChunk);
console.log('Admin Internal Pattern:', isAdminChunk);

// Check for academic intent - need to inspect what chunkMatchesAcademicIntent would do
console.log('\n[ACADEMIC INTENT MATCHING]');
console.log('Intent for this query: ACADEMIC_PROGRAM');
console.log('User Intent for query 1: DEFINISI_PRODI');
console.log('Academic Intent pattern: DEFINISI_PRODI');

// DEFINISI_PRODI patterns
const definisiPattern = /\b(definisi|pengertian|apa\s+itu|merupakan|adalah|yang\s+dimaksud|tujuan|visi|misi|fokus|kompetensi)\b/i;
console.log('Chunk matches DEFINISI_PRODI pattern:', definisiPattern.test(chunkText));

// Check for keyword overlap with query
const queryTokens = ['apa', 'itu', 'sistem', 'informasi'];
const chunkLower = chunkText;
const overlaps = queryTokens.filter(tok => chunkLower.includes(tok));
console.log('Query tokens:', queryTokens);
console.log('Overlapping tokens:', overlaps);
console.log('Overlap ratio:', overlaps.length + '/' + queryTokens.length + ' = ' + (overlaps.length / queryTokens.length).toFixed(2));

console.log('\n[FILTERING LOGIC SIMULATION]');
console.log('Query: "Apa itu Sistem Informasi?"');
console.log('Intent: ACADEMIC_PROGRAM');
console.log('UserIntent: DEFINISI_PRODI');
console.log('ChunkType:', chunk6631dfc1.chunkType);
console.log('DocCategory:', chunk6631dfc1.docCategory);

// Simulate filterRelevantChunks logic
let rejected = false;
let rejectionReason = null;

// Check 1: empty chunk
if (!chunkText.trim()) {
  rejected = true;
  rejectionReason = 'empty_chunk';
} else {
  console.log('✓ Chunk not empty');
}

// Check 2: excludeFromSearch
if (!rejected && chunk6631dfc1.excludeFromSearch === true) {
  rejected = true;
  rejectionReason = 'excluded_from_search';
} else if (!rejected) {
  console.log('✓ Not excluded from search');
}

// Check 3: metadata/header/footer
if (!rejected && metadataPattern.test(chunkText)) {
  rejected = true;
  rejectionReason = 'metadata_pattern';
} else if (!rejected) {
  console.log('✓ Not a metadata pattern');
}

// Check 4: admin internal check
if (!rejected && isAdminChunk && 'ACADEMIC_PROGRAM' !== 'COST' && !costPattern.test(chunkText) && !'PROGRAM' && !schedulePattern.test(chunkText)) {
  rejected = true;
  rejectionReason = 'admin_internal_not_cost_program_schedule';
} else if (!rejected) {
  console.log('✓ Not blocked by admin check');
}

// Check 5: cost pattern (for non-cost intents)
if (!rejected && 'ACADEMIC_PROGRAM' !== 'COST' && costPattern.test(chunkText)) {
  rejected = true;
  rejectionReason = 'cost_pattern_but_not_cost_intent';
} else if (!rejected) {
  console.log('✓ No cost pattern conflict');
}

// Check 6: legal pattern
if (!rejected && legalPattern.test(chunkText) && 'ACADEMIC_PROGRAM' !== 'GENERAL') {
  if (!costPattern.test(chunkText) && !programPattern.test(chunkText) && !schedulePattern.test(chunkText)) {
    rejected = true;
    rejectionReason = 'legal_pattern_no_cost_program_schedule';
  }
} else if (!rejected) {
  console.log('✓ No legal pattern conflict');
}

// Check 7: intent-specific required patterns
if (!rejected && ('ACADEMIC_PROGRAM' === 'ACADEMIC_PROGRAM' || 'ACADEMIC_PROGRAM' === 'PROGRAM') && chunk6631dfc1.chunkType !== 'GENERAL') {
  if (!programPattern.test(chunkText)) {
    rejected = true;
    rejectionReason = 'academic_program_requires_program_pattern_but_not_found';
    console.log('✗ ACADEMIC_PROGRAM intent requires program pattern but chunk has none');
  } else {
    console.log('✓ Has required program pattern for ACADEMIC_PROGRAM');
  }
} else if (!rejected) {
  console.log('✓ Pattern check passed for intent');
}

// Check 8: academic intent matching
if (!rejected && 'DEFINISI_PRODI' && !definisiPattern.test(chunkText)) {
  rejected = true;
  rejectionReason = 'no_definisi_prodi_pattern_match';
  console.log('✗ DEFINISI_PRODI intent but no pattern matches');
} else if (!rejected && 'DEFINISI_PRODI') {
  console.log('✓ Matches DEFINISI_PRODI intent');
}

// Check 9: token overlap
if (!rejected && queryTokens.length >= 3 && overlaps.length === 0 && 'ACADEMIC_PROGRAM' !== 'GENERAL') {
  rejected = true;
  rejectionReason = 'zero_token_overlap_with_general_intent';
} else if (!rejected && queryTokens.length >= 3) {
  console.log('✓ Has sufficient token overlap (or is GENERAL intent)');
}

console.log('\n[FINAL VERDICT]');
if (rejected) {
  console.log('REJECTED: YES');
  console.log('Reason:', rejectionReason);
} else {
  console.log('REJECTED: NO - Should have passed filterRelevantChunks');
}

console.log('\n' + '='.repeat(120));
