const rag = require('./src/engine/ragEngine');
(async () => {
  const q = 'hoby saya suka ngoding cocok jurusan apa?';
  const qLower = rag.normalizeIndonesianQuestionText(q);
  const hobbyData = rag.extractHobbyMappingTextFromIndex([]);
  console.log('hobbyData text length', hobbyData && hobbyData.text && hobbyData.text.length);
  const lines = hobbyData.text.split('\n').map(l => l.trim()).filter(Boolean);
  console.log('lines count', lines.length);
  for (let i = 0; i < Math.min(lines.length, 80); i++) {
    console.log(i+1, JSON.stringify(lines[i]));
  }
  const scored = rag.scoreProgramsFromHobbyLines(hobbyData.text, qLower);
  console.log('scored', scored);
  const blocks = rag.splitHobbyTextIntoProgramBlocks(hobbyData.text);
  console.log('blocks count', blocks.length);
  for (const b of blocks) {
    console.log('block', b.key, b.label, b.text.slice(0,200).replace(/\n/g,' | '));
  }
})();
