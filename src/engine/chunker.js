// Simple chunking helper: split text into 300-800 char chunks on sentence boundaries

function chunkText(text, { minSize = 300, maxSize = 800 } = {}) {
  const s = String(text || '').trim();
  if (!s) return [];

  // Quick sentence split (naive): split on punctuation followed by space/newline
  const sentences = s.split(/(?<=[\.\!\?])\s+/);
  const chunks = [];
  let current = '';

  for (const sent of sentences) {
    if ((current + ' ' + sent).trim().length <= maxSize) {
      current = (current + ' ' + sent).trim();
    } else {
      if (current.trim().length >= minSize) {
        chunks.push(current.trim());
        current = sent.trim();
      } else {
        // Current is too small; append sentence and push anyway if exceeds max
        current = (current + ' ' + sent).trim();
        if (current.length >= minSize) {
          chunks.push(current.trim());
          current = '';
        }
      }
    }
  }

  if (current && current.trim().length) chunks.push(current.trim());

  return chunks;
}

module.exports = { chunkText };
