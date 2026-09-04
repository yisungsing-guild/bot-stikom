function parseCompactRupiahNumber(raw, opts = null) {
  if (!raw && raw !== 0) return null;
  let s = String(raw || '').trim();
  if (!s) return null;

  // Repair common OCR noise in compact rupiah amounts.
  s = s.replace(/[oO]/g, '0').replace(/[lI]/g, '1');
  s = s.replace(/^Rp[\s\.]*/i, '');

  const digitsAndSep = s.replace(/[^0-9\.,]/g, '');
  if (!digitsAndSep) return null;

  const cleaned = digitsAndSep.replace(/[\.,]/g, '');
  if (!/^[0-9]+$/.test(cleaned)) return null;
  const n = parseInt(cleaned, 10);
  return Number.isNaN(n) ? null : n;
}

module.exports = { parseCompactRupiahNumber };