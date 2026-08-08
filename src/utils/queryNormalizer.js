const { normalizeWhitespace, normalizeUnicode } = require('../lib/normalizer');

const SLANG_REPLACEMENTS = {
  brp: 'berapa',
  gmn: 'gimana',
  bgmn: 'bagaimana',
  klo: 'kalau',
  kalo: 'kalau',
  kl: 'kalau',
  trs: 'terus',
  trus: 'terus',
  msh: 'masih',
  udh: 'sudah',
  blm: 'belum',
  yg: 'yang',
  krn: 'karena',
  ga: 'tidak',
  gak: 'tidak',
  nggak: 'tidak',
  engga: 'tidak',
  dmn: 'dimana',
  dmna: 'dimana',
  kpn: 'kapan',
  dftr: 'daftar',
  jrsn: 'jurusan',
  gel: 'gelombang',
  apaan: 'apa',
  dd: 'double degree'
};

const FILLER_TOKENS = new Set(['min', 'kak', 'bro', 'dong', 'nih', 'dah']);

const DOMAIN_FUZZY_VOCAB = [
  'teknologi',
  'informasi',
  'sistem',
  'komputer',
  'bisnis',
  'digital',
  'manajemen',
  'informatika',
  'gelombang',
  'pendaftaran',
  'beasiswa',
  'fasilitas',
  'laboratorium',
  'double',
  'degree',
  'daftar',
  'jurusan'
];

function toString(raw) {
  return raw === undefined || raw === null ? '' : String(raw);
}

function normalizeUserQuery(text) {
  const rawText = toString(text);
  let normalized = normalizeUnicode(rawText);
  normalized = normalized.replace(/\r\n|\r|\t+/g, ' ');
  normalized = normalized.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  normalized = normalizeWhitespace(normalized.toLowerCase());

  const tokens = normalized.split(' ').filter(Boolean);
  const replacements = [];
  const normalizedTokens = tokens.map((token) => {
    const original = token;
    let replacement = token;

    if (FILLER_TOKENS.has(token)) {
      replacement = '';
    } else if (Object.prototype.hasOwnProperty.call(SLANG_REPLACEMENTS, token)) {
      replacement = SLANG_REPLACEMENTS[token];
    } else {
      const fuzzy = fuzzyNormalizeDomainToken(token);
      if (fuzzy && fuzzy !== token) {
        replacement = fuzzy;
      }
    }

    if (replacement !== original) {
      replacements.push({ from: original, to: replacement });
    }
    return replacement;
  }).filter(Boolean);

  const finalText = normalizeWhitespace(normalizedTokens.join(' '));
  return {
    rawText,
    normalizedText: finalText,
    replacements,
    changed: finalText !== normalizeWhitespace(rawText.toLowerCase())
  };
}

function fuzzyNormalizeDomainToken(token) {
  if (!token || token.length < 4) return token;

  let bestMatch = token;
  let bestDistance = Infinity;

  for (const candidate of DOMAIN_FUZZY_VOCAB) {
    if (candidate === token) return token;
    const distance = levenshteinDistance(token, candidate);
    const threshold = candidate.length <= 5 ? 1 : 2;
    if (distance <= threshold && distance < bestDistance) {
      bestDistance = distance;
      bestMatch = candidate;
    }
  }

  return bestMatch;
}

function levenshteinDistance(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, () => []);
  for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

module.exports = {
  normalizeUserQuery,
  fuzzyNormalizeDomainToken,
  SLANG_REPLACEMENTS,
  FILLER_TOKENS
};
