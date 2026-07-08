function normalizeInput(input) {
  const s = String(input || '');
  // Basic normalization: trim, collapse whitespace
  const collapsed = s.replace(/[\s\u00A0]+/g, ' ').trim();
  // Lowercase for routing use-cases
  const lower = collapsed.toLowerCase();
  return { normalized: lower, original: s };
}

module.exports = { normalizeInput };
