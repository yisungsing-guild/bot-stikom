const crypto = require('crypto');

function normalizeEvidenceText(text) {
  if (text === null || text === undefined) return '';
  let s = String(text || '');
  // remove common FAQ/QNA markers and small formatting
  s = s.replace(/\b(?:FAQ|QNA)\s*[:.-]?\s*/gi, ' ');
  s = s.replace(/\b(?:Question|Pertanyaan|Tanya|Q)\s*[:.-]?\s*/gi, ' ');
  s = s.replace(/\b(?:Answer|Jawaban|Jawab|A)\s*[:.-]?\s*/gi, ' ');
  // normalize whitespace and punctuation lightly, keep numbers
  s = s.replace(/[\u00a0\t\r\n]+/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.toLowerCase();
  return s;
}

function createEvidenceDedupKey(evidence, options = {}) {
  const keyMode = String(options.keyMode || 'source-and-text');
  const prefixLength = Number.isFinite(Number(options.prefixLength)) ? Number(options.prefixLength) : 240;
  const textField = options.textField || 'text';
  const sourceIdField = options.sourceIdField || 'sourceId';

  if (!evidence) return '';
  const sourceId = evidence[sourceIdField] ? String(evidence[sourceIdField]) : '';
  const rawText = evidence[textField] || evidence.text || '';
  const normalized = normalizeEvidenceText(rawText);

  // Use hash of full normalized text to avoid too-short prefix collisions
  const fullHash = crypto.createHash('sha1').update(normalized).digest('hex');
  const prefix = normalized.slice(0, prefixLength);

  if (keyMode === 'text-only') {
    return `hash:${fullHash}|p:${prefix}`;
  }

  // source-and-text
  return `${sourceId ? `src:${sourceId}|` : ''}hash:${fullHash}|p:${prefix}`;
}

function deduplicateEvidence(items = [], options = {}) {
  const keep = options.keep || 'highest-score'; // 'first' or 'highest-score'
  const textField = options.textField || 'text';
  const scoreField = options.scoreField || 'totalScore';

  // Build grouping map
  const groups = new Map();
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i] || {};
    const key = createEvidenceDedupKey(it, options);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ item: it, index: i });
  }

  // Choose representative per group
  const chosen = new Map();
  for (const [key, arr] of groups.entries()) {
    if (arr.length === 1) {
      chosen.set(key, arr[0]);
      continue;
    }
    if (keep === 'first') {
      chosen.set(key, arr[0]);
      continue;
    }
    // highest-score
    let best = arr[0];
    for (const cand of arr) {
      const a = Number(best.item && best.item[scoreField]) || 0;
      const b = Number(cand.item && cand.item[scoreField]) || 0;
      if (b > a) best = cand;
    }
    chosen.set(key, best);
  }

  // Preserve original ordering: include item if it's the chosen representative for its key and not included yet
  const included = new Set();
  const output = [];
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i] || {};
    const key = createEvidenceDedupKey(it, options);
    const rep = chosen.get(key);
    if (!rep) continue;
    // compare by reference or by matching index
    if (rep.index === i && !included.has(key)) {
      output.push(it);
      included.add(key);
    }
  }

  // For debug/trace
  const removedCount = items.length - output.length;
  const keptIds = output.map((o) => o.id || (o.sourceId || '') + '::' + String((o[textField] || '').slice(0, 24)));
  const removedIds = items.filter(it => !output.includes(it)).map((o) => o.id || (o.sourceId || '') + '::' + String((o[textField] || '').slice(0, 24)));

  return {
    items: output,
    meta: {
      inputCount: items.length,
      outputCount: output.length,
      duplicateCount: removedCount,
      removedEvidenceIds: removedIds,
      keptEvidenceIds: keptIds
    }
  };
}

module.exports = {
  normalizeEvidenceText,
  createEvidenceDedupKey,
  deduplicateEvidence
};
