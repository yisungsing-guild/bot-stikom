const { tryStructuredProgramRecommendationAnswer, scoreProgramsFromHobbyLines, extractHobbyMappingTextFromIndex, splitHobbyTextIntoProgramBlocks } = require('./src/engine/ragEngine');

(async () => {
  const q = 'hoby saya suka ngoding cocok jurusan apa?';
  const idx = require('./src/engine/ragEngine').getIndexPath ? null : null; // no-op
  const raw = q;
  const idxPath = null;
  // We can't directly pass index object, but tryStructuredProgramRecommendationAnswer uses indexForQuery and inside uses extractHobbyMappingTextFromIndex().
  const result = await tryStructuredProgramRecommendationAnswer(raw, []);
  console.log('result:', JSON.stringify(result, null, 2));
})();
