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
  internasionalnya: 'internasional',
  jln: 'jalan',
  jl: 'jalan',
  alamt: 'alamat',
  almt: 'alamat',
  ny: 'nya',
  ntar: 'nanti',
  dpt: 'dapat',
  bsa: 'bisa',
  bcicil: 'dicicil',
  dcicil: 'dicicil',
  nyicil: 'mencicil',
  angsuranny: 'angsuran',
  cicilanny: 'cicilan',
  ad: 'ada',
  jg: 'juga',
  bkn: 'bukan',
  sm: 'sama',
  dg: 'dengan',
  dgn: 'dengan',
  sy: 'saya',
  byr: 'bayar',
  byar: 'bayar',
  brapa: 'berapa',
  prtama: 'pertama',
  pertm: 'pertama',
  mwnny: 'mau tanya',
  biya: 'biaya',
  pndaftaran: 'pendaftaran',
  sistm: 'sistem'
};

const FILLER_TOKENS = new Set(['min', 'kak', 'bro', 'dong', 'nih', 'dah']);

const FUZZY_PROTECTED_VALID_TOKENS = new Set([
  'data',
  'mata',
  'alasan',
  'alasannya',
  'antar',
  'jemput',
  'bus',
  'dekat',
  'sekitar',
  'jarak',
  'lapangan',
  'puputan',
  'paduan',
  'alam',
  'alamnya',
  'tari',
  'tarinya',
  'dominan',
  'urusan',
  'urusannya'
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
  'semester',
  'semesteran',
  'spp',
  'ukt',
  'dpp',
  'alamat',
  'jalan',
  'kampus'
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
    } else if (token.length > 3 && token.endsWith('ny')) {
      const stem = token.slice(0, -2);
      if (Object.prototype.hasOwnProperty.call(SLANG_REPLACEMENTS, stem)) {
        replacement = SLANG_REPLACEMENTS[stem];
      } else {
        const fuzzy = fuzzyNormalizeDomainToken(stem);
        replacement = fuzzy || stem;
      }
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

const FUZZY_TOKEN_CACHE_MAX = 2048;
const fuzzyTokenCache = new Map();

function fuzzyNormalizeDomainToken(token) {
  if (!token || token.length < 4) return token;
  if (FUZZY_PROTECTED_VALID_TOKENS.has(token)) return token;
  if (fuzzyTokenCache.has(token)) return fuzzyTokenCache.get(token);

  let bestMatch = token;
  let bestDistance = Infinity;
  for (const candidate of DOMAIN_FUZZY_VOCAB) {
    if (candidate === token) return token;
    const threshold = token.length <= 4 ? 1 : (candidate.length <= 6 ? 1 : 2);
    if (Math.abs(token.length - candidate.length) > threshold) continue;
    const distance = levenshteinDistance(token, candidate, threshold);
    if (distance <= threshold && distance < bestDistance) {
      bestDistance = distance;
      bestMatch = candidate;
    }
  }
  if (fuzzyTokenCache.size >= FUZZY_TOKEN_CACHE_MAX) fuzzyTokenCache.delete(fuzzyTokenCache.keys().next().value);
  fuzzyTokenCache.set(token, bestMatch);
  return bestMatch;
}

function levenshteinDistance(a, b, maxDistance = Infinity) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;
  if (a.length > b.length) [a, b] = [b, a];
  let previous = Array.from({ length: a.length + 1 }, (_, index) => index);
  for (let row = 1; row <= b.length; row += 1) {
    const current = [row];
    let rowMinimum = row;
    const from = Number.isFinite(maxDistance) ? Math.max(1, row - maxDistance) : 1;
    const to = Number.isFinite(maxDistance) ? Math.min(a.length, row + maxDistance) : a.length;
    for (let column = 1; column < from; column += 1) current[column] = maxDistance + 1;
    for (let column = from; column <= to; column += 1) {
      const cost = a[column - 1] === b[row - 1] ? 0 : 1;
      current[column] = Math.min(current[column - 1] + 1, previous[column] + 1, previous[column - 1] + cost);
      rowMinimum = Math.min(rowMinimum, current[column]);
    }
    for (let column = to + 1; column <= a.length; column += 1) current[column] = maxDistance + 1;
    if (rowMinimum > maxDistance) return maxDistance + 1;
    previous = current;
  }
  return previous[a.length];
}
module.exports = {
  normalizeUserQuery,
  fuzzyNormalizeDomainToken,
  SLANG_REPLACEMENTS,
  FILLER_TOKENS
};
