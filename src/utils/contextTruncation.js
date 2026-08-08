// Deterministic, boundary-aware truncation utilities for evidence context
// Do NOT integrate into runtime automatically — standalone for audit/A-B tests.

function isCurrencyToken(token) {
  if (!token) return false;
  return /^(Rp\.?\s*\d[\d.,]*)$/i.test(token.trim()) || /^\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?$/.test(token.trim());
}

function containsTableLikeRows(text) {
  if (!text) return false;
  // pipe table or tab-separated or aligned columns (multiple spaces)
  if (/^\s*\|.*\|/m.test(text)) return true;
  if (/\t/.test(text)) return true;
  // detect lines with multiple spaced columns like 'DPP    Rp14.000.000'
  if (/^\s*\S+(?:\s{2,}\S+)+/m.test(text)) return true;
  return false;
}

function isNumericRow(line) {
  if (!line) return false;
  // has currency token or number with thousand separators
  if (/\bRp\.?\s*\d[\d.,]*\b/i.test(line)) return true;
  if (/\b\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?\b/.test(line)) return true;
  return false;
}

function findSafeBoundaryByNewline(text, maxChars) {
  const lines = String(text || '').split(/\r?\n/);
  let out = '';
  for (const line of lines) {
    const candidate = out ? out + '\n' + line : line;
    if (candidate.length > maxChars) break;
    out = candidate;
  }
  return out;
}

function findSafeBoundaryBySentence(text, maxChars) {
  const sentRe = /[^.!?]+[.!?]?/g;
  const matches = String(text || '').match(sentRe) || [];
  let out = '';
  for (const s of matches) {
    const candidate = out ? (out + ' ' + s.trim()) : s.trim();
    if (candidate.length > maxChars) break;
    out = candidate;
  }
  return out;
}

function truncateEvidenceSafely(text, maxChars, options = {}) {
  const orig = String(text || '');
  const res = { truncatedText: '', wasTruncated: false, reason: 'empty' };
  if (!Number.isFinite(Number(maxChars)) || maxChars <= 0) return res;
  if (orig.length <= maxChars) return { truncatedText: orig, wasTruncated: false, reason: 'fits' };

  const opts = Object.assign({ minKeep: Math.min(120, Math.floor(maxChars / 6)) }, options || {});

  // helper: detect if truncation ends inside numeric/currency token
  function endsWithPartialNumeric(text, cutLen) {
    const left = String(text || '');
    const after = left.slice(cutLen, cutLen + 6);
    const before = left.slice(Math.max(0, cutLen - 12), cutLen);
    // if after starts with digit or dot/comma then likely we cut inside number
    if (/^[\d.,]/.test(after)) return true;
    // if before ends with 'Rp' followed by optional punctuation and digits partial
    if (/Rp\.?\s*\d+[.,]?$/.test(before)) return true;
    // if before ends with digits + '.' or ',' and after starts with digits, cut inside thousand separator
    if (/\d[.,]$/.test(before) && /^[\d]/.test(after)) return true;
    return false;
  }

  // 1) Newline boundary prefer
  try {
    const nl = findSafeBoundaryByNewline(orig, maxChars);
    if (nl && nl.length >= opts.minKeep && !endsWithPartialNumeric(orig, nl.length)) return { truncatedText: nl.trim(), wasTruncated: true, reason: 'newline' };
  } catch (e) { /* ignore */ }

  // 2) Sentence boundary
  try {
    const sent = findSafeBoundaryBySentence(orig, maxChars);
    if (sent && sent.length >= opts.minKeep && !endsWithPartialNumeric(orig, sent.length)) return { truncatedText: sent.trim(), wasTruncated: true, reason: 'sentence' };
  } catch (e) { /* ignore */ }

  // 3) Table/row-aware
  if (containsTableLikeRows(orig)) {
    const rows = String(orig || '').split(/\r?\n/);
    let out = '';
    for (const r of rows) {
      const candidate = out ? (out + '\n' + r) : r;
      if (candidate.length > maxChars) break;
      out = candidate;
    }
    if (out && out.length >= opts.minKeep) return { truncatedText: out.trim(), wasTruncated: true, reason: 'table-row' };
    // if nothing fits, prefer dropping rows rather than partial row
    return { truncatedText: '', wasTruncated: true, reason: 'table-row' };
  }

  // 4) Word boundary accumulate
  const words = orig.split(/\s+/);
  let out = '';
  for (const w of words) {
    const candidate = out ? (out + ' ' + w) : w;
    if (candidate.length > maxChars) break;
    out = candidate;
  }
  if (out && out.length >= opts.minKeep) {
    // avoid slicing inside numeric token at the end
    const tail = orig.slice(out.length, out.length + 16);
    if (!/^(?:[.,]?\d|\s)*$/.test(tail) && /Rp\.?\s*\d/.test(out.slice(-12))) {
      // if risk of cutting Rp token, drop last word
      out = out.replace(/\S+$/,'').trim();
    }
    // additional guard: ensure not cutting inside numeric separators
    if (/\d[.,]$/.test(out) && /^\d/.test(orig.slice(out.length))) {
      out = out.replace(/\S+$/,'').trim();
    }
    if (out && out.length >= opts.minKeep) return { truncatedText: out.trim(), wasTruncated: true, reason: 'word' };
  }

  // 5) Hard slice last resort but avoid partial numeric token
  let hard = orig.slice(0, maxChars);
  // avoid ending with partial 'Rp' token or partial number fragments
  if (/Rp\.?\s*\d[\d.,]*$/i.test(hard)) {
    hard = hard.replace(/\S+$/,'').trim();
  } else {
    // remove trailing partial numeric characters
    hard = hard.replace(/\d[.,]*$/,'').trim();
  }
  if (!hard) hard = orig.slice(0, maxChars);
  return { truncatedText: hard, wasTruncated: true, reason: 'hard-slice' };
}

function buildSelectedEvidenceContextSafe(selectedEvidence, maxChars = 9000, options = {}) {
  const list = Array.isArray(selectedEvidence) ? selectedEvidence.slice(0) : [];
  let remaining = Number.isFinite(Number(maxChars)) ? Number(maxChars) : 9000;
  const blocks = [];
  let evidenceCounter = 0;
  for (const item of list) {
    evidenceCounter += 1;
    const source = [item && item.source, item && item.sourceId].filter(Boolean).join(' | ') || `evidence-${evidenceCounter}`;
    const header = `[E${evidenceCounter}] Sumber: ${source}\nEvidence: `;
    const available = remaining - header.length;
    if (available <= 80) break; // leave margin
    const body = String(item && (item.text || item.chunk || item.content) || '');
    const { truncatedText, wasTruncated } = truncateEvidenceSafely(body, available, options);
    if (!truncatedText) {
      // skip if nothing safe fits
      continue;
    }
    const block = header + truncatedText;
    if (block.length > remaining) continue;
    blocks.push(block);
    remaining -= block.length + 2; // account for later joining with \n\n
  }
  return blocks.join('\n\n');
}

module.exports = {
  truncateEvidenceSafely,
  isCurrencyToken,
  containsTableLikeRows,
  isNumericRow,
  buildSelectedEvidenceContextSafe
};
