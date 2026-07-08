const fs = require('fs');
const VALID_PROGRAMS = new Set(['SI','TI','BD','SK','MI','DKV','TRPL','TK','MM','AN','DG','RPL']);
const index = JSON.parse(fs.readFileSync('src/data/rag_index.json','utf8'));
const counts = {};
const invalidCounts = {};
let totalWithProgram = 0;
let totalNull = 0;
for (const item of index) {
  const p = item && item.program ? String(item.program).trim() : null;
  if (!p) {
    totalNull += 1;
    continue;
  }
  totalWithProgram += 1;
  if (!VALID_PROGRAMS.has(p)) {
    invalidCounts[p] = (invalidCounts[p] || 0) + 1;
  } else {
    counts[p] = (counts[p] || 0) + 1;
  }
}
console.log('validProgramCounts:', JSON.stringify(counts, null, 2));
console.log('invalidProgramCounts:', JSON.stringify(invalidCounts, null, 2));
console.log('totalWithProgram', totalWithProgram);
console.log('totalNull', totalNull);
