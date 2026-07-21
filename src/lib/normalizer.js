function normalizeInput(input) {
  const s = String(input || '');
  // Basic normalization: trim, collapse whitespace
  const collapsed = s.replace(/[\s\u00A0]+/g, ' ').trim();
  // Lowercase for routing use-cases
  let lower = collapsed.toLowerCase();
  lower = lower
    .replace(/\bskrg\b/g, 'sekarang')
    .replace(/\bbka\b/g, 'buka')
    .replace(/\bprogram\s+studi\s+informasi\b/g, 'program studi sistem informasi')
    .replace(/\bprodi\s+informasi\b/g, 'prodi sistem informasi')
    .replace(/\bjurusan\s+informasi\b/g, 'jurusan sistem informasi')
    .replace(/\s+/g, ' ')
    .trim();
  return { normalized: lower, original: s };
}

module.exports = { normalizeInput };
