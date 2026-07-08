const fs = require('fs');
const data = JSON.parse(fs.readFileSync('src/data/rag_index.json', 'utf8'));

// Cari chunks untuk berbagai program
const programs = ['SI', 'MI', 'TI', 'SK', 'BD'];
const results = {};

for (const prog of programs) {
  const chunks = data.filter(d => {
    const text = String(d.chunk || '').toLowerCase();
    const keywords = {
      SI: 'sistem informasi',
      MI: 'manajemen informatika',
      TI: 'teknologi informasi',
      SK: 'sistem komputer',
      BD: 'bisnis digital'
    };
    return text.includes(keywords[prog]);
  });
  results[prog] = chunks.length;
}

console.log('Chunks mentioning each program:');
Object.entries(results).forEach(([prog, count]) => {
  console.log(`  ${prog}: ${count}`);
});

// Check if there are chunks dengan 'Program Studi Sistem Informasi'
const siProgram = data.filter(d => d.chunk && d.chunk.toLowerCase().includes('program studi sistem informasi'));
console.log('\nChunks dengan exact "Program Studi Sistem Informasi":', siProgram.length);

// Check chunks matching SI pattern from updated code
const siPattern = /(?:program\s+studi\s+)?sistem\s+informasi(?:\s+[|,\n]|$|(?=\s+\|)|(?=\s*,)|(?=\s*\n))/i;
const siMatched = data.filter(d => siPattern.test(d.chunk));
console.log('Chunks matching SI pattern:', siMatched.length);

if (siMatched.length > 0) {
  console.log('\nFirst SI pattern-matched chunk:');
  console.log(siMatched[0].chunk.substring(0, 400));
}
