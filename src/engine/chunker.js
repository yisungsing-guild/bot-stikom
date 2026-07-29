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

function splitSentencesForChunking(value) {
  return String(value || '')
    .split(/(?<=[\.\!\?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function pushSizedChunk(chunks, value, minSize, maxSize) {
  const cleaned = cleanDocumentMarkers(value);
  if (!cleaned) return;
  if (cleaned.length <= maxSize) {
    chunks.push(cleaned);
    return;
  }

  const sentences = splitSentencesForChunking(cleaned);
  let current = '';
  for (const sent of sentences) {
    if ((current + ' ' + sent).trim().length <= maxSize) {
      current = (current + ' ' + sent).trim();
    } else {
      if (current.trim().length >= minSize) chunks.push(current.trim());
      current = sent.trim();
    }
  }
  if (current && current.trim().length) chunks.push(current.trim());
}

function splitFaqPairs(text) {
  const source = String(text || '').trim();
  if (!source) return [];
  const pairRegex = /(?:^|\n|\s)\s*(?:(?:FAQ|QNA)\s*[:.-]\s*)?(?:\(?[QF]\)?|Question|Pertanyaan|Tanya)\s*[:.-]\s*([\s\S]*?)(?:\s+(?:\(?A\)?|Answer|Jawaban|Jawab)\s*[:.-]\s*)([\s\S]*?)(?=(?:\n|\s)\s*(?:(?:FAQ|QNA)\s*[:.-]\s*)?(?:\(?[QF]\)?|Question|Pertanyaan|Tanya)\s*[:.-]|$)/gi;
  const pairs = [];
  let match;
  while ((match = pairRegex.exec(source)) !== null) {
    const pair = [match[1], match[2]].filter(Boolean).join(' ');
    const cleaned = cleanDocumentMarkers(pair);
    if (cleaned.length >= 18) pairs.push(cleaned);
  }
  return pairs;
}

function chunkText(text, { minSize = 300, maxSize = 800 } = {}) {
  const s = String(text || '').trim();
  if (!s) return [];

  const faqPairs = splitFaqPairs(s);
  if (faqPairs.length) {
    const chunks = [];
    for (const pair of faqPairs) pushSizedChunk(chunks, pair, minSize, maxSize);
    if (chunks.length) return chunks;
  }

  const cleaned = cleanDocumentMarkers(s);
  const sentences = splitSentencesForChunking(cleaned);
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
