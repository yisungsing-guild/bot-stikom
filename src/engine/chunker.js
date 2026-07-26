// Simple chunking helper: split text into 300-800 char chunks on sentence boundaries

// Generic document-format marker cleaning
function cleanDocumentMarkers(text) {
  if (!text) return '';
  
  // Order matters: longer patterns first to avoid partial matches
  const patterns = [
    /\bRingkasan\s+dokumen:\s*/gi,
    /\bFAQ:\s*/gi,
    /\bQuestion:\s*/gi,
    /\bAnswer:\s*/gi,
    /\bPertanyaan:\s*/gi,
    /\bJawaban:\s*/gi,
    /\(F\)\s*/gi,
    /\(Q\)\s*/gi,
    /\(A\)\s*/gi,
    /\bF:\s*/gi,
    /\bQ:\s*/gi,
    /\bA:\s*/gi
  ];
  
  let cleaned = text;
  for (const pattern of patterns) {
    cleaned = cleaned.replace(pattern, '');
  }
  
  return cleaned.trim();
}

function chunkText(text, { minSize = 300, maxSize = 800 } = {}) {
  const s = String(text || '').trim();
  if (!s) return [];

  // Clean document markers before chunking
  const cleaned = cleanDocumentMarkers(s);

  // Quick sentence split (naive): split on punctuation followed by space/newline
  const sentences = cleaned.split(/(?<=[\.\!\?])\s+/);
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

module.exports = { chunkText, cleanDocumentMarkers };
