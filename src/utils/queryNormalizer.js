const { normalizeWhitespace, normalizeUnicode } = require('../lib/normalizer');

const SLANG_REPLACEMENTS = {
  brp: 'berapa',
  gmn: 'gimana',
  bgmn: 'bagaimana',
  klo: 'kalau',
  kalo: 'kalau',
  kl: 'kalau',
  mw: 'mau',
  tny: 'tanya',
  donk: 'dong',
  biayany: 'biaya',
  biayanya: 'biaya',
  trs: 'terus',
  trus: 'terus',
  msh: 'masih',
  udh: 'sudah',
  blm: 'belum',
  yg: 'yang',
  krn: 'karena',
  dmn: 'dimana',
  dmna: 'dimana',
  kpn: 'kapan',
  utk: 'untuk',
  aj: 'saja',
  aja: 'saja',
  mhs: 'mahasiswa',
  maba: 'mahasiswa baru',
  milih: 'memilih',
  dftr: 'daftar',
  dta: 'data',
  jrsn: 'jurusan',
  akrediasi: 'akreditasi',
  akreditai: 'akreditasi',
  akredtasi: 'akreditasi',
  akreditasinya: 'akreditasi',
  akrediasinya: 'akreditasi',
  karir: 'karier',
  karirnya: 'karier',
  kariernya: 'karier',
  loker: 'lowongan',
  rekruitmen: 'rekrutmen',
  rekrutmenya: 'rekrutmen',
  kerjasama: 'kerja sama',
  kerjasamanya: 'kerja sama',
  magangny: 'magang',
  alumninya: 'alumni',
  lulusanny: 'lulusan',
  gel: 'gelombang',
  gelombangnya: 'gelombang',
  apaan: 'apa',
  prodi2: 'program studi',
  jurusannya: 'jurusan',
  prodinya: 'program studi',
  pasca: 'pascasarjana',
  pascasarjananya: 'pascasarjana',
  magisternya: 'magister',
  s2nya: 's2',
  inbis: 'inkubator bisnis',
  hithink: 'hi think',
  dd: 'double degree',
  doube: 'double',
  duble: 'double',
  dobel: 'double',
  dabel: 'double',
  degre: 'degree',
  degreee: 'degree',
  inernasional: 'internasional',
  internasioal: 'internasional',
  internationalnya: 'international',
  internasionalnya: 'internasional'
};

const FILLER_TOKENS = new Set(['min', 'kak', 'bro', 'dong', 'nih', 'dah']);

const FUZZY_PROTECTED_VALID_TOKENS = new Set([
  'data',
  'mata'
]);

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
  'dual',
  'degree',
  'internasional',
  'international',
  'daftar',
  'data',
  'jurusan',
  'akreditasi',
  'pascasarjana',
  'magister',
  'sarjana',
  'diploma',
  'lulusan',
  'lulus',
  'alumni',
  'pekerjaan',
  'layanan',
  'ormawa',
  'organisasi',
  'himpunan',
  'pusat',
  'karier',
  'lowongan',
  'rekrutmen',
  'inkubator',
  'think',
  'sarana',
  'prasarana',
  'yayasan',
  'potongan',
  'diskon',
  'rincian',
  'cicilan',
  'angsuran',
  'tagihan',
  'nominal',
  'biaya',
  'spp',
  'ukt',
  'dpp'
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
  normalized = normalized
    .replace(/\bpasca\s+sarjana\b/g, 'pascasarjana')
    .replace(/\bhi[-\s]*think\b/g, 'hi think')
    .replace(/\bjob\s+fair\b/g, 'job fair')
    .replace(/\bcampus\s+hiring\b/g, 'campus hiring')
    .replace(/\bcareer\s+center\b/g, 'career center');

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
  if (FUZZY_PROTECTED_VALID_TOKENS.has(token)) return token;

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
