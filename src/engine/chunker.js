// Document chunking helper: keep FAQ/QNA pairs and table/section blocks coherent.

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

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

function stripQaLabel(value) {
  return compactText(value)
    .replace(/^\s*(?:(?:faq|qna)\s*[:.-]\s*)?(?:\(?[QF]\)?|Question|Pertanyaan|Tanya)\s*[:.-]\s*/i, '')
    .replace(/^\s*(?:\(?A\)?|Answer|Jawaban|Jawab)\s*[:.-]\s*/i, '')
    .trim();
}

function normalizeQuestionText(value) {
  const q = stripQaLabel(value).replace(/\s+/g, ' ').trim();
  if (!q) return '';
  return /\?$/.test(q) ? q : `${q}?`;
}

function buildFaqPair(question, answer) {
  const q = normalizeQuestionText(question);
  const a = stripQaLabel(answer);
  if (q.length < 8 || a.length < 8) return null;
  if (/^(?:apa|apakah|bagaimana|gimana|berapa|kapan|di\s*mana|dimana|siapa|mengapa|kenapa|dokumen\s+apa|apa\s+saja)\b/i.test(a)) return null;
  const chunk = `Pertanyaan: ${q}\nJawaban: ${a}`;
  return { question: q, answer: a, chunk };
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

function splitLabeledFaqPairs(source) {
  const pairRegex = /(?:^|\n|\s)\s*(?:(?:FAQ|QNA)\s*[:.-]\s*)?(?:\(?[QF]\)?|Question|Pertanyaan|Tanya)\s*[:.-]\s*([\s\S]*?)(?:\s+(?:\(?A\)?|Answer|Jawaban|Jawab)\s*[:.-]\s*)([\s\S]*?)(?=(?:\n|\s)\s*(?:(?:FAQ|QNA)\s*[:.-]\s*)?(?:\(?[QF]\)?|Question|Pertanyaan|Tanya)\s*[:.-]|$)/gi;
  const pairs = [];
  let match;
  while ((match = pairRegex.exec(source)) !== null) {
    const pair = buildFaqPair(match[1], match[2]);
    if (pair) pairs.push(pair);
  }
  return pairs;
}

function splitFlatQuestionAnswerPairs(source) {
  const flat = compactText(source);
  if (!flat) return [];
  const questionRegex = /((?:apa\s+saja|apa|apakah|bagaimana|gimana|berapa|kapan|di\s*mana|dimana|siapa|mengapa|kenapa|dokumen\s+apa)\b[^?]{4,220}\?)/gi;
  const markers = [];
  let match;
  while ((match = questionRegex.exec(flat)) !== null) {
    markers.push({ question: match[1], start: match.index, end: match.index + match[1].length });
  }
  if (markers.length < 2) return [];

  const pairs = [];
  for (let i = 0; i < markers.length; i += 1) {
    const current = markers[i];
    const nextStart = markers[i + 1] ? markers[i + 1].start : flat.length;
    const answer = flat.slice(current.end, nextStart).trim();
    const pair = buildFaqPair(current.question, answer);
    if (pair) pairs.push(pair);
  }
  return pairs;
}

function dedupeFaqPairs(pairs) {
  const seen = new Set();
  const out = [];
  for (const pair of Array.isArray(pairs) ? pairs : []) {
    const key = compactText(pair.question).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(pair);
  }
  return out;
}

function extractFaqPairsDetailed(text) {
  const source = String(text || '').trim();
  if (!source) return [];
  return dedupeFaqPairs([
    ...splitLabeledFaqPairs(source),
    ...splitFlatQuestionAnswerPairs(source)
  ]);
}

function splitFaqPairs(text) {
  return extractFaqPairsDetailed(text).map((pair) => pair.chunk);
}

function chunkText(text, { minSize = 300, maxSize = 800 } = {}) {
  const s = String(text || '').trim();
  if (!s) return [];

  const faqPairs = splitFaqPairs(s);
  if (faqPairs.length) {
    const chunks = [];
    for (const pair of faqPairs) pushSizedChunk(chunks, pair, Math.min(minSize, 80), maxSize);
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

module.exports = { chunkText, cleanDocumentMarkers, extractFaqPairsDetailed, splitFaqPairs };
