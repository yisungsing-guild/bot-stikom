const re = require('./src/engine/ragEngine.js');

const idx = re.loadIndex();

// Search for any chunk containing "1, 2, 3" or "ranking" patterns
const allChunks = (idx || []).filter(i => i && typeof i.chunk === 'string');

console.log(`Searching through ${allChunks.length} chunks...`);

// Search for patterns that might indicate ranking scholarship table
let found = false;
for (const chunk of allChunks) {
  const text = chunk.chunk.toLowerCase();
  // Look for patterns like "ranking 1, 2, 3" or similar
  if (/\branking\s+1\s*,?\s*2\s*,?\s*3|peringkat\s+1\s*,?\s*2\s*,?\s*3/i.test(chunk.chunk)) {
    console.log('\n=== Found ranking 1,2,3 pattern ===');
    console.log(chunk.chunk.substring(0, 600));
    found = true;
  }
  // Look for "sekolah tertentu" patterns (which are part of ranking scholarship)
  if (/sekolah\s+tertentu/i.test(chunk.chunk)) {
    console.log('\n=== Found "sekolah tertentu" ===');
    console.log(chunk.sectionTitle);
    console.log(chunk.chunk.substring(0, 400));
    found = true;
  }
}

if (!found) {
  console.log('\nNo ranking scholarship data found in any chunk.');
  console.log('\nAll section titles containing "scholarship" or "beasiswa" or "ranking":');
  const titles = new Set();
  allChunks.forEach(c => {
    if (/(beasiswa|ranking|prestasi|potongan|scholarship|lampiran)/i.test(c.sectionTitle || '')) {
      titles.add(c.sectionTitle);
    }
  });
  Array.from(titles).forEach(t => console.log(`- ${t}`));
}
