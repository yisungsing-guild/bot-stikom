'use strict';

/**
 * src/core/semanticFrameResolver.js
 * 
 * Greenfield Semantic Frame Resolver.
 * Maps user queries into a comprehensive, typed, and structured SemanticFrame.
 * 
 * Target Contract:
 * {
 *   rawQuery,
 *   normalizedQuery,
 *   domain,
 *   intent,
 *   entities: [],
 *   relation,
 *   aspects: [],
 *   temporal: { isCurrent: boolean, constraint: string },
 *   userState: string,
 *   desiredAction: string,
 *   subQueries: [],
 *   contextDependencies: []
 * }
 */

const { matchCanonicalEntities, findCanonicalEntity } = require('../engine/canonicalEntityRegistry');
const { evaluateContextDependency } = require('./contextResolver');
const { detectQueryLanguage } = require('../utils/languageDetector');
const { normalizeUserQuery } = require('../utils/queryNormalizer');
const { ACADEMIC_SCOPE_STATUS, resolveAcademicScope } = require('./academicCatalog');
const modelSemanticParser = require('./modelSemanticParser');
const { validateSemanticInterpretation, compareFrames } = require('./semanticInterpretationValidator');
const logger = require('../logger');
const { filterNegatedSemanticAspects, filterNegatedCanonicalEntities, getNegatedAspectSet, stripNegatedAspectPhrases } = require('../utils/semanticNegation');

// Temporal markers for NOW / current status
const TEMPORAL_NOW_REGEX = /\b(masih|sekarang|hari ini|saat ini|tahun ini|terbaru|gelombang ini|saat sekarang)\b/i;

function levenshteinDistance(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

function getConsonantSkeleton(w) {
  return w.replace(/[aeiou]/g, '');
}

const CANONICAL_DOMAIN_LEXICON = [
  'jurusan', 'prodi', 'program', 'fakultas', 'sarjana', 'diploma', 'magister',
  'biaya', 'bayar', 'cicilan', 'angsuran', 'beasiswa',
  'daftar', 'pendaftaran', 'syarat', 'persyaratan', 'dokumen', 'berkas', 'gelombang', 'jadwal',
  'kurikulum', 'kuliah', 'kelulusan', 'skripsi', 'akreditasi',
  'fasilitas', 'laboratorium', 'perpustakaan', 'organisasi',
  'kontak', 'telepon', 'whatsapp', 'alamat', 'narahubung', 'softskill', 'soft'
];

const INSTITUTIONAL_ANCHOR_REGEX = /\b(?:stikom|kampus|kuliah|perkuliahan|akademik|pmb|mahasiswa|dosen|prodi|jurusan|fakultas|sarjana|diploma|magister|pascasarjana|s1|s2|d3|biaya|spp|dpp|uang\s+kuliah|uang\s+gedung|beasiswa|pendaftaran|daftar|syarat|persyaratan|berkas|dokumen|gelombang|jadwal|kurikulum|matkul|mata\s+kuliah|sks|akreditasi|ban-?pt|lam-?infokom|fasilitas|laboratorium|lab|perpustakaan|asrama|parkir|ukm|ormawa|organisasi|wisuda|yudisium|rpl|magang|lulus|lulusan|kelulusan|karir|karier|alumni|universitas|institut|sekolah\s+tinggi|dual\s+degree|double\s+degree|degree|gelar|ijazah|sebutan|durasi|program\s+studi|studi|masa\s+studi|lama\s+studi|waktu\s+studi|university|college|campus|student|students|lecturer|professor|tuition|fee|fees|scholarship|admission|admissions|register|registration|curriculum|course|courses|credit|credits|accreditation|facility|facilities|laboratory|laboratories|library|dormitory|dorm|graduation|graduate|graduating|thesis|final\s+project|defense|internship|career|careers|degree|duration|study\s+duration|student\s+exchange|parking|undergraduate|bachelor|master|postgraduate|study\s+programs?|academic\s+programs?|degree\s+programs?|majors?|soft\s*skills?|pengembangan\s+(?:soft\s*skills?|karakter|mahasiswa)|pelatihan\s+soft\s*skills?|career\s+center|pusat\s+karier|cdc|kontak|telepon|whatsapp|narahubung|ktp|kk|kartu\s+keluarga|akta|formulir|registrasi|konfirmasi|verifikasi|kode\s+verifikasi|otp|tes\s+masuk|seleksi|ujian\s+seleksi|kartu\s+peserta|bukti\s+bayar|bukti\s+transfer|bukti\s+pembayaran|panitia|panitia\s+pmb|sion|portal\s+akademik|kemahasiswaan|bagian\s+kemahasiswaan|layanan\s+kemahasiswaan|coding|pemrograman|programming|bahasa\s+inggris|english|vokasi|pendidikan\s+vokasi|program\s+vokasi|fokus\s+riset|topik\s+riset|data\s+science|cyber\s+security|enterprise\s+system|medical\s+informatics|pengalaman\s+industri|sertifikasi(?:\s+industri)?|digital\s+marketing|seo|baak|ipk|dosen\s+wali|perwalian|cuti(?:\s+kuliah)?|online|daring|aplikasi\s+(?:kuliah|perkuliahan|belajar)|murah|mahal|tarif|harga|terjangkau|teknologi|komputer|hardware|software)\b/i;

const PROTECTED_CANONICAL_WORDS = new Set([
  'dan', 'atau', 'ke', 'di', 'dari', 'pada', 'untuk', 'dengan', 'ada', 'bisa', 'boleh', 'mau', 'ingin', 'saya', 'kami', 'kita', 'dia', 'ini', 'itu', 'apa', 'siapa', 'mana', 'kapan', 'sudah', 'belum', 'tidak', 'bukan'
]);

function extractUserOriginLocation(text, sessionData = {}) {
  if (!text || typeof text !== 'string') return sessionData?.userOrigin || null;
  const cleaned = text.trim();
  const m = cleaned.match(/\b(?:tinggal\s+di|(?<!lebih\s+|kurang\s+)dari|asal\s+dari|berasal\s+dari|rumah\s+(?:saya\s+)?di|domisili(?:\s+di)?|posisi(?:\s+di)?|lokasi\s+(?:saya\s+)?di)\s+([a-zA-Z0-9\s,]+?)(?:\s+(?:jadi|maka|saya|lebih|kampus|enaknya|bagusnya|bagaimana|gimana|gmn|apa|apakah|kira-kira|kira2)|[?,.]|$)/i);
  if (m && m[1]) {
    const rawOrigin = m[1]
      .replace(/\b(?:saya|kalau|kalo|aku|kami|ya|nih|sih)\b/gi, '')
      .replace(/\b(?:bagaimana|gimana|gmn|apa|apakah)\b/gi, '')
      .trim();

    // Generic spatial or relative terms that do NOT represent a geographical city/district
    const isNonGeographic = /^(?:rumah(?:\s+saya)?|tempat(?:\s+tinggal)?(?:\s+saya)?|posisi(?:\s+saya)?|lokasi(?:\s+saya)?|ko?st?(?:\s+saya)?|kantor(?:\s+saya)?|sekolah(?:\s+saya)?|kampus|sini|sana|situ|mana|luar|dalam|daerah(?:\s+saya)?|wilayah(?:\s+saya)?)$/i.test(rawOrigin);
    const isAcademicOrTemporalTerm = /\b(?:semester|prodi|program\s+studi|jurusan|fakultas|jenjang|angkatan|gelombang|tahap|jalur|sks|biaya|mata\s*kuliah|matkul|satu|dua|tiga)\b/i.test(rawOrigin);

    if (rawOrigin.length >= 2 && rawOrigin.length <= 40 && !isNonGeographic && !isAcademicOrTemporalTerm) {
      // Explicit new origin location: strictly use the newly specified location without merging
      return rawOrigin;
    }
    // Ambiguous, non-geographic, or invalid location extraction attempt
    return null;
  }
  // Follow-up message without a new location: retain active session origin if relevant
  return sessionData?.userOrigin || null;
}

function stripProximityModifiers(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/\b(?:di\s+)?(?:dekat|sekitar|seputaran|area|sebelah|depan|belakang|sekeliling)\s+(?:kampus(?:\s+stikom)?|stikom(?:\s+bali)?|itb\s+stikom)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function approximateDomainToken(token) {
  if (PROTECTED_CANONICAL_WORDS.has(token) || token.length < 3) return token;
  const tSkel = getConsonantSkeleton(token);

  let bestMatch = null;
  let bestScore = Infinity;

  for (const target of CANONICAL_DOMAIN_LEXICON) {
    if (token === target) return target;
    const targSkel = getConsonantSkeleton(target);

    // Rule 1: Consonant skeleton match (missing vowels shorthand)
    if (tSkel.length >= 2 && tSkel === targSkel && token[0] === target[0]) {
      return target;
    }

    // Rule 2: Levenshtein distance
    const dist = levenshteinDistance(token, target);
    const maxLen = Math.max(token.length, target.length);
    const maxAllowedDist = maxLen <= 4 ? 1 : (maxLen <= 7 ? 1 : 2);

    if (dist <= maxAllowedDist && dist < bestScore) {
      if (token[0] === target[0]) {
        bestScore = dist;
        bestMatch = target;
      }
    }
  }

  return bestMatch || token;
}

function hasGenuineProgramFitSignal(q) {
  const text = String(q || '').toLowerCase();
  if (!text) return false;
  // Exclude queries with explicit factual attribute locks (catalog listing, faculty, fee, accreditation, SKS, schedule, location, contact)
  if (/\b(?:fakultas|faculty|faculties|dekan|biaya|spp|dpp|uang\s+kuliah|tarif|akreditasi|terakreditasi|total\s+sks|jumlah\s+sks|berapa\s+sks|jadwal\s+pendaftaran|lokasi\s+kampus|alamat\s+kampus|kontak|whatsapp|nomor\s+telepon)\b/i.test(text)) {
    return false;
  }
  if (/\b(?:apa\s+saja|ada\s+apa(?:\s+saja)?|daftar\s+(?:prodi|jurusan|program\s+studi)|list\s+(?:prodi|jurusan|program\s+studi)|pilihan\s+(?:prodi|jurusan|program\s+studi)|what\s+(?:.*?\s+)?(?:programs?|majors?|degrees?)|which\s+(?:programs?|majors?))\b/i.test(text) &&
      !/\b(?:rekomendasi|cocok|saran|bingung|suka|minat|hobi|bakat|passion|tertarik|cita-?cita)\b/i.test(text)) {
    return false;
  }
  const hasExplicitPersonalFitCue = /\b(?:rekomendasi|rekomendasikan|cocok(?:nya)?|saran|bingung(?:\s+pilih|\s+mau|\s+ambil)?|pas(?:nya)?\s+(?:masuk|ambil|pilih|prodi|jurusan)|jurusan\s+apa\s+yang\s+pas|prodi\s+apa\s+yang\s+pas|sebaiknya\s+(?:ambil|pilih|masuk)|suka|minat|hobi|bakat|passion|tertarik|senang|cita-?cita|ingin\s+menjadi|mau\s+berkarir|mau\s+jadi|ingin\s+jadi)\b/i.test(text);
  const hasSkillOrTopicInterest = /\b(?:coding|koding|ngoding|pemrograman|programming|software|aplikasi|game|jaringan|network|iot|robotik|hardware|cyber|desain|design|multimedia|bisnis|usaha|wirausaha|marketing|pemasaran|data\s+analyst|data\s+science|ai\b|hitung-?hitungan|matematika)\b/i.test(text);
  if (hasExplicitPersonalFitCue) return true;
  if (hasSkillOrTopicInterest && /\b(?:masuk\s+(?:prodi|jurusan)\s+apa|ambil\s+(?:prodi|jurusan)\s+apa|(?:prodi|jurusan)\s+apa\s+yang\s+relevan)\b/i.test(text)) {
    return true;
  }
  return false;
}

function detectUnsupportedProgram(rawQuery, entities = []) {
  const hasKnownEntity = entities.some(
    e => ['academic_program', 'international_program', 'student_organization', 'facility', 'scholarship', 'campus_service'].includes(e.family || e.type)
  );
  if (hasKnownEntity) return null;

  const q = String(rawQuery || '').toLowerCase().trim();

  // Whitelist vocational programs (D3 is official vocational education)
  if (/\b(?:vokasi|pendidikan\s+vokasi|program\s+vokasi|d3|diploma)\b/i.test(q)) {
    return null;
  }

  // Graduate research concentrations (S2 Sistem Informasi) are NOT unsupported programs
  const isGraduateResearchQuery = /\b(?:s2|magister|pascasarjana|fokus\s+riset|topik\s+riset|riset|konsentrasi|peminatan)\b/i.test(q);
  if (isGraduateResearchQuery && /\b(?:data\s+science|cyber\s+security|enterprise\s+system|medical\s+informatics|business\s+intelligence)\b/i.test(q)) {
    return null;
  }

  // Explicit check for well-known non-offered academic disciplines (e.g. "kedokteran", "farmasi", "kebidanan", "keperawatan", "hukum", "psikologi", "akuntansi", "arsitektur", "teknik nuklir")
  // Run before non-academic domain filters so queries like "Berapa biaya jurusan teknik nuklir" are recognized as unsupported programs
  const commonDisciplines = /\b(kedokteran(?:\s+gigi|\s+hewan)?|farmasi|kebidanan|keperawatan|hukum|psikologi|akuntansi|arsitektur|pertanian|peternakan|teknik\s+nuklir)\b/i;
  const directMatch = q.match(commonDisciplines);
  if (directMatch && directMatch[1]) {
    const candidate = directMatch[1].trim();
    const known = findCanonicalEntity(candidate);
    if (!known) {
      return candidate;
    }
  }

  // If query belongs to non-academic domains (student organizations, facilities, tuition, scholarship, career, etc.)
  const NON_ACADEMIC_DOMAIN_INDICATORS = /\b(?:ukm\b|unit\s+kegiatan\s+mahasiswa|organisasi|ormawa|hima\b|himaprodi|senat|balma|ekskul|ekstrakurikuler|fasilitas|laboratorium|lab\b|perpustakaan|asrama|dormitory|ruang\s+kelas|gedung\s+kampus|aula|parkir|biaya|spp|dpp|tarif|bayar|cicilan|angsuran|beasiswa|kip\s*kuliah|kip-?k|keringanan\s+biaya|karir|karier|loker|lowongan|magang|internship|cdc)\b/i;
  if (NON_ACADEMIC_DOMAIN_INDICATORS.test(q)) {
    return null;
  }

  // If query is a general available programs or education levels listing inquiry without specific discipline mention
  if (/\b(?:apa\s+saja|ada\s+apa|daftar\s+prodi|list\s+jurusan|bisa\s+ambil\s+apa|what\s+(?:.*?\s+)?(?:programs?|majors?|degrees?)\s+(?:are\s+)?(?:available|offered)|which\s+programs?)\b/i.test(q) &&
    !/\b(?:apakah\s+(?:ada|tersedia)|ada\s+nggak|punya|is\s+there)\b/i.test(q)) {
    return null;
  }

  // If query is asking for program recommendation / fit based on hobbies, interests, or topic skills
  const hasSignals = hasGenuineProgramFitSignal(q);

  if ((/\b(?:cocok(?:nya)?|rekomendasi|saran|pas|bingung)\b/i.test(q) &&
    /\b(?:jurusan|prodi|program\s*studi|kuliah)\b/i.test(q)) ||
    (hasSignals && /\b(?:tertarik|suka|minat|hobi|passion|senang|bakat)\b/i.test(q))) {
    return null;
  }

  const STOP_TOKENS = new Set([
    'di', 'ke', 'dari', 'pada', 'untuk', 'dengan', 'yang', 'ini', 'itu', 'tersebut',
    'apa', 'bagaimana', 'gimana', 'kenapa', 'mengapa', 'siapa', 'berapa', 'ada', 'bisa', 'boleh', 'mau', 'ingin', 'pilihan', 'saja', 'aja', 'kak',
    'ya', 'nih', 'dong', 'kah', 'sore', 'malam', 'karyawan', 'reguler', 'eksekutif',
    'lebih', 'baik', 'ambil', 'pilih', 'mana', 'bagus', 'cocok', 'rekomendasi', 'saran',
    'prodi', 'jurusan',
    'kontak', 'kontaknya', 'nomor', 'nomornya', 'telepon', 'telp', 'wa', 'whatsapp',
    'alamat', 'alamatnya', 'lokasi', 'lokasinya', 'biaya', 'biayanya', 'syarat', 'syaratnya',
    'info', 'informasi', 'brosur',
    'masih', 'dibuka', 'buka', 'tutup', 'ditutup', 'kapan', 'jadwal', 'gelombang', 'pendaftaran', 'daftar', 'periode', 'status', 'sekarang', 'tahun', 'hari',
    // English generic catalog tokens
    'program', 'programs', 'study', 'studies', 'course', 'courses', 'major', 'majors',
    'degree', 'degrees', 'available', 'offered', 'what', 'which', 'any', 'are', 'there',
    'is', 'in', 'at'
  ]);

  // Pattern 1: Program marker + optional degree level + candidate noun (e.g. "jurusan farmasi", "prodi s1 hubungan internasional")
  const markerMatch = q.match(/\b(?:jurusan|prodi|program\s+studi|fakultas|bidang\s+studi)\s+(?:(?:s1|s2|d3)\s+)?([a-z\s]+?)(?:\s+(?:di\s+stikom|di\s+itb|di\s+bali|berapa|apa|syarat|biaya|ada|atau|jika)|$)/i);
  if (markerMatch && markerMatch[1]) {
    const candidate = markerMatch[1].trim();
    const candidateTokens = candidate.split(/\s+/);
    const hasStopWord = candidateTokens.some(tok => STOP_TOKENS.has(tok));
    if (candidate.length >= 3 && !hasStopWord) {
      const known = findCanonicalEntity(candidate);
      if (!known) {
        return candidate;
      }
    }
  }

  // Pattern 2: Generic higher-education discipline prefixes (e.g. "teknik [X]", "ilmu [X]", "sastra [X]", "desain [X]")
  const disciplineMatch = q.match(/\b((?:teknik|ilmu|sastra|desain|kedokteran|pendidikan)\s+[a-z]+)\b/i);
  if (disciplineMatch && disciplineMatch[1]) {
    const candidate = disciplineMatch[1].trim();
    const tokens = candidate.split(/\s+/);
    if (!tokens.some(tok => STOP_TOKENS.has(tok))) {
      const known = findCanonicalEntity(candidate);
      if (!known) {
        return candidate;
      }
    }
  }

  // Pattern 3: Explicit degree level + candidate discipline (e.g. "s1 akuntansi", "d3 kebidanan")
  const degreeMatch = q.match(/\b(?:s1|s2|d3|sarjana|diploma|magister)\s+([a-z\s]+?)(?:\s+(?:di\s+stikom|di\s+itb|di\s+bali|berapa|apa|syarat|biaya|ada|atau|jika)|$)/i);
  if (degreeMatch && degreeMatch[1]) {
    const candidate = degreeMatch[1].trim();
    const tokens = candidate.split(/\s+/);
    if (candidate.length >= 3 && !tokens.some(tok => STOP_TOKENS.has(tok))) {
      const known = findCanonicalEntity(candidate);
      if (!known) {
        return candidate;
      }
    }
  }

  return null;
}

function normalizeQueryText(text) {
  if (!text || typeof text !== 'string') return '';

  // If query is English, preserve English phrasing without Indonesian enclitic or lexicon mutation
  if (detectQueryLanguage(text) === 'en') {
    return text.toLowerCase().replace(/[?!,.]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Apply comprehensive slang & conversational abbreviation normalization
  const expandedRes = typeof normalizeUserQuery === 'function' ? normalizeUserQuery(text) : null;
  const expanded = (expandedRes && typeof expandedRes === 'object' && expandedRes.normalizedText) ? expandedRes.normalizedText : (typeof expandedRes === 'string' ? expandedRes : text);
  let norm = expanded
    .toLowerCase()
    .replace(/[?!,.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Morphological & conversational normalization
  norm = norm
    .replace(/\bkalo\b/g, 'kalau')
    .replace(/\bklu\b/g, 'kalau')
    .replace(/\bgimana\b/g, 'bagaimana')
    .replace(/\b(?:gak|ga|nggak|nda)\b/g, 'tidak')
    .replace(/\byg\b/g, 'yang')
    .replace(/\bdftr\b/g, 'daftar')
    .replace(/\b(?:aja|sj)\b/g, 'saja')
    .replace(/\bad\b/g, 'ada')
    .replace(/\bmhs\b/g, 'mahasiswa')
    .replace(/\bkpan\b/g, 'kapan')
    .replace(/\bblm\b/g, 'belum')
    .replace(/\bsdh\b/g, 'sudah')
    .replace(/\butk\b/g, 'untuk')
    .replace(/\bdgn\b/g, 'dengan');

  // Indonesian enclitic normalization on common nouns and verbs
  norm = norm.replace(/\b([a-z]{3,})nya\b/g, (match, stem) => {
    if (/^(?:tanya|punya|hanya|nyonya|mulanya|rupanya|makanya|sebenarnya|biasanya|tampaknya|agaknya|kiranya|hendaknya)$/i.test(match)) {
      return match;
    }
    return stem;
  });
  norm = norm.replace(/\b(bisa|boleh|ada|sudah)kah\b/g, '$1');
  norm = norm.replace(/\b(tolong|coba|jelaskan)lah\b/g, '$1');

  // Generic approximate normalization based on edit distance and consonant skeleton
  norm = norm.split(' ').map(tok => approximateDomainToken(tok)).join(' ');

  return norm.replace(/\s+/g, ' ').trim();
}

/**
 * Extracts domain and primary intent based on semantic patterns
 */
/**
 * Privacy & Sensitive Personal Data Guardrail Helper (No. 442)
 * Robustly intercepts unauthorized requests to access, display, extract, or list personal,
 * contact, or academic data of other students / individuals before retrieval.
 */
function isPrivacyViolationQuery(rawQuery) {
  if (!rawQuery || typeof rawQuery !== 'string') return false;
  const q = rawQuery.trim().toLowerCase();

  // Exclude institutional policy inquiry that doesn't request individual records
  // e.g. "Apa kebijakan privasi kampus?", "Bagaimana kebijakan privasi data kampus?"
  if (/\bkebijakan\s+privasi\b/i.test(q) && !/\b(?:tampilkan|minta|berikan|daftar|list|nomor|telepon|alamat|data\s+akademik)\b/i.test(q)) {
    return false;
  }

  // Exclude legitimate administrative / application procedure without third-party target
  // e.g. "Bagaimana prosedur pengisian formulir aplikasi RPL?", "prosedur pendaftaran mahasiswa baru"
  if (/\b(?:rpl|rekognisi|formulir\s+aplikasi|pendaftaran\s+mahasiswa\s+baru|pmb)\b/i.test(q) &&
    !/\b(?:mahasiswa\s+lain|orang\s+lain|teman|dosen|staff|staf)\b/i.test(q) &&
    !/\b(?:daftar|list)\s+(?:nomor|telepon|hp|alamat|identitas|data\s+pribadi)\b/i.test(q)) {
    return false;
  }

  // 1. Explicit Third-Party Target: asking for personal/academic data or contact of "mahasiswa lain" or "orang lain"
  const hasThirdPartyTarget = /\b(?:mahasiswa\s+lain|orang\s+lain|teman|dosen|staff|staf)\b/i.test(q);
  const hasSensitiveData = /\b(?:data\s+pribadi|nomor\s+(?:hp|wa|telepon|ponsel|telp)|alamat|identitas|data\s+akademik|profil|kontak\s+pribadi)\b/i.test(q);

  if (hasThirdPartyTarget && hasSensitiveData) {
    return true;
  }

  // 2. Action to fetch/display/request sensitive data of others / students
  const hasExtractionAction = /\b(?:tampilkan|minta|berikan|lihat|melihat|bocorkan|cari|mencari|share|bagi|bagikan|kirimkan|daftar|list|akses|mengakses|peroleh|memperoleh|dapatkan|mendapatkan|unduh|mengunduh|download|ambil|mengambil)\b/i.test(q) ||
    /\b(?:cara|prosedur|mekanisme|alur|tata\s+cara)\s+(?:mendapatkan|memperoleh|mengakses|melihat|mengunduh|mengambil|mengetahui)\b/i.test(q);

  if (hasExtractionAction) {
    // 2a. Action + sensitive data of "mahasiswa" or "terdaftar"
    if (/\b(?:nomor\s+(?:hp|wa|telepon|ponsel|telp)|alamat|identitas|data\s+akademik|profil)\b/i.test(q) &&
      /\b(?:mahasiswa|orang|terdaftar)\b/i.test(q) &&
      !/\b(?:kantor|layanan|admin|admisi|kampus|pusat)\b/i.test(q)) {
      return true;
    }
    // 2b. Action + "data pribadi"
    if (/\bdata\s+pribadi\b/i.test(q) &&
      !/\b(?:saya|sendiri|pribadi\s+saya)\b/i.test(q) &&
      !/\b(?:formulir\s+aplikasi\s+rpl|pengisian\s+formulir)\b/i.test(q)) {
      return true;
    }
  }

  // 3. Direct unauthorized extraction attempts on registered student identities
  if (/\b(?:data\s+identitas|identitas)\s+mahasiswa\s+(?:yang\s+)?terdaftar\b/i.test(q)) {
    return true;
  }

  return false;
}

function inferDomainAndIntent(normalized, entities = [], sessionData = {}, unstemmed = '', raw = '') {
  // 0.001 Punctuation / Symbol Only Check
  if (/^[\s?.!,;:~`"'-]+$/.test(raw)) {
    return {
      domain: 'CONVERSATIONAL',
      intent: 'CONVERSATIONAL_GREETING',
      retrievalRequired: false,
      userState: 'GREETING',
      desiredAction: 'GREET_USER',
      aspects: ['greeting', 'punctuation_only'],
      relation: 'GREETING'
    };
  }

  // 0.002 WhatsApp Ping / Connection Check (e.g. "P", "Tes, satu dua", "Tes 1 2", "Ping")
  if (/^(?:p|ping|tes|test|halo\s*tes|tes(?:ting)?(?:\s+(?:1|satu)(?:\s*(?:2|dua))?)?)[.!?]*$/i.test(normalized)) {
    return {
      domain: 'CONVERSATIONAL',
      intent: 'CONVERSATIONAL_GREETING',
      retrievalRequired: false,
      userState: 'GREETING',
      desiredAction: 'GREET_USER',
      aspects: ['greeting', 'ping'],
      relation: 'GREETING'
    };
  }

  // 0.0021 Availability Check / Conversation Opener (e.g. "Helo, ada orang?", "Halo ada orang di sini?", "Ada admin?", "Apakah ada orang?")
  if (
    /^(?:(?:h[ae]llo+|h[ae]lo+|hai+|hi+|hei+|pagi|siang|sore|malam|permisi|selamat\s+(?:pagi|siang|sore|malam))[\s,]*)?(?:apakah\s+)?ada\s+(?:orang|admin|petugas|operator|manusia|siapa(?:-siapa)?)(?:\s+(?:di\s+sini|kah|ya|disini))?[.!?]*$/i.test(normalized) ||
    /^(?:hi+|hello+|hey+)[\s,]*(?:is\s+anyone\s+(?:there|available)|are\s+you\s+there)[.!?]*$/i.test(normalized)
  ) {
    return {
      domain: 'CONVERSATIONAL',
      intent: 'CONVERSATIONAL_GREETING',
      retrievalRequired: false,
      userState: 'GREETING',
      desiredAction: 'GREET_USER',
      aspects: ['greeting', 'availability_check'],
      relation: 'GREETING'
    };
  }

  // 0.003 Privacy & Sensitive Personal Data Guardrail (No. 442)
  // Intercepts unauthorized requests to access, display, extract, or list personal/identifying data of others prior to retrieval.
  const isPrivacyViolationAttempt = isPrivacyViolationQuery(normalized) || isPrivacyViolationQuery(raw);
  if (isPrivacyViolationAttempt) {
    return {
      domain: 'CONVERSATIONAL',
      intent: 'PRIVACY_DATA_REFUSAL',
      retrievalRequired: false,
      userState: 'REFUSAL',
      desiredAction: 'REFUSE_PRIVACY_REQUEST',
      aspects: ['privacy_guardrail', 'sensitive_data_protection'],
      relation: 'PRIVACY_REFUSAL'
    };
  }

  // 0.0031 Institutional Quality Policy Inquiry
  if (/\bkebijakan\s+mutu\b/i.test(normalized)) {
    return {
      domain: 'CAMPUS_POLICY',
      intent: 'QUALITY_POLICY_INQUIRY',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_QUALITY_POLICY_INFO',
      aspects: ['quality_policy', 'institutional_quality'],
      relation: 'CAMPUS_POLICY'
    };
  }

  // 0.0032 Institutional Privacy Policy & Personal Data Protection Inquiries
  if (
    /\b(?:kebijakan\s+privasi|privacy\s+policy)\b/i.test(normalized) ||
    (/\b(?:data\s+pribadi|data\s+mahasiswa)\b/i.test(normalized) && /\b(?:melindungi|perlindungan|keamanan|aman|dijamin|rahasia|kerahasiaan|bagaimana\s+kampus)\b/i.test(normalized)) ||
    (/\b(?:data\s+mahasiswa|data\s+pribadi)\b/i.test(normalized) && /\b(?:dibagikan|berbagi|share|pihak\s+ketiga|pihak\s+lain|dijual|bocor)\b/i.test(normalized))
  ) {
    const isSharing = /\b(?:dibagikan|berbagi|share|pihak\s+ketiga|pihak\s+lain|dijual)\b/i.test(normalized);
    const aspects = isSharing
      ? ['privacy_policy', 'data_protection', 'data_sharing', 'third_party_data_sharing']
      : ['privacy_policy', 'data_protection', 'personal_data_confidentiality'];

    return {
      domain: 'CAMPUS_POLICY',
      intent: 'PRIVACY_POLICY_INQUIRY',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_POLICY_INFO',
      aspects,
      relation: 'CAMPUS_POLICY'
    };
  }

  // 0.02 Bot Identity / Creator Inquiry (active & passive voice)
  if (/\b(?:siapa\s+(?:yang\s+)?(?:membuat|menciptakan|mengembangkan|merancang|bikin)\s+(?:kamu|anda|bot|tiko)|(?:kamu|anda|bot|tiko)\s+(?:di|yang\s+)?(?:buat|ciptakan|kembangkan|rancang|bikin)\s+(?:oleh\s+)?siapa|siapa\s+pembuat(?:mu)?|siapa\s+pengembang(?:mu)?)\b/i.test(normalized)) {
    return {
      domain: 'CONVERSATIONAL',
      intent: 'BOT_IDENTITY',
      retrievalRequired: false,
      userState: 'SMALL_TALK',
      desiredAction: 'STATE_BOT_CREATOR',
      aspects: ['bot_identity', 'bot_creator'],
      relation: 'BOT_CREATOR'
    };
  }

  // 0.021 Bot Capabilities & Scope Inquiry (e.g. "Apakah kamu tahu semua info tentang kampus?", "Kamu tahu apa saja?", "Bisa bantu apa saja?")
  if (
    /\b(?:(?:kamu|anda|bot|tiko)\s+(?:bisa|dapat)\s+(?:bantu|melayani|jawab|memberikan|lakukan)\s+(?:apa(?:\s+saja)?|informasi\s+apa)|bisa\s+bantu\s+apa(?:\s+saja)?|apa\s+(?:fungsi|tugas|kegunaan|kemampuan)(?:mu)?)\b/i.test(normalized) ||
    /\b(?:apa\s+saja\s+yang\s+(?:bisa|dapat)\s+(?:kamu|anda|bot|tiko)?\s*(?:jawab|bantu|jelaskan)|apa\s+yang\s+bisa\s+(?:kamu|anda|bot|tiko)\s*(?:jawab|bantu|jelaskan))\b/i.test(normalized) ||
    (/\b(?:kamu|anda|bot|tiko)\s+(?:tahu|mengetahui|paham|mengerti)\s+(?:semua|seluruh|apa\s+saja|tentang\s+apa)\b/i.test(normalized) &&
     !/\b(biaya|tarif|spp|dpp|daftar|pendaftaran|jurusan|prodi|beasiswa|potongan|akreditasi|kurikulum|matkul|lokasi|alamat|kontak)\b/i.test(normalized)) ||
    /\b(?:apakah\s+)?(?:kamu|anda|bot|tiko)\s+(?:bisa|dapat|mampu)\s+menjawab\s+(?:semua|seluruh)\s+(?:pertanyaan|informasi)\b/i.test(normalized) ||
    /\b(?:what\s+can\s+you\s+do|what\s+do\s+you\s+know|how\s+can\s+you\s+help)\b/i.test(normalized)
  ) {
    return {
      domain: 'CONVERSATIONAL',
      intent: 'BOT_IDENTITY',
      retrievalRequired: false,
      userState: 'SMALL_TALK',
      desiredAction: 'STATE_BOT_CAPABILITIES',
      aspects: ['bot_identity', 'bot_capabilities'],
      relation: 'BOT_CAPABILITIES'
    };
  }

  // 0.0215 Academic Recommendation Inquiries
  if (
    /\b(?:bingung|bimbang|ragu|belum tahu|galau)\s+(?:pilih|memilih|menentukan)?\s*(?:kampus|kuliah|jurusan|prodi|bidang)\b/i.test(normalized) ||
    (/\b(?:suka|minat|tertarik|hobi|bakat|passion)\b/i.test(normalized) && /\b(?:teknologi|komputer|coding|pemrograman|it|bisnis|desain)\b/i.test(normalized)) ||
    /\b(?:kurang|tidak|belum|bukan)\s+(?:bisa|cakap|mahir|mengerti|paham|mampu|ahli|bakat)?\s*(?:di\s+bidang\s+)?(?:ti|teknologi\s+informasi|it|coding|pemrograman)\b/i.test(normalized)
  ) {
    return {
      domain: 'ACADEMIC_RECOMMENDATION',
      intent: 'PROGRAM_RECOMMENDATION',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'RECOMMEND_PROGRAM',
      aspects: ['recommendation', 'overview'],
      relation: 'RECOMMENDATION'
    };
  }

  // 0.0216 Course Topic / Curriculum Inquiry (SEO, etc.)
  if (/\b(?:seo|search\s+engine\s+optimization|sem|search\s+engine\s+marketing)\b/i.test(normalized)) {
    return {
      domain: 'ACADEMIC_CURRICULUM',
      intent: 'CURRICULUM_INQUIRY',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_CURRICULUM_INFO',
      aspects: ['curriculum', 'course_topic', 'digital_marketing', 'seo'],
      relation: 'CURRICULUM'
    };
  }

  // 0.022 Fallback Policy Inquiry
  if (/\b(?:kalau|jika)\s+(?:kamu|tiko|bot)?\s*(?:tidak|belum)\s+tahu\s+jawaban(?:nya)?\b/i.test(normalized)) {
    return {
      domain: 'CONVERSATIONAL',
      intent: 'BOT_IDENTITY',
      retrievalRequired: false,
      userState: 'SMALL_TALK',
      desiredAction: 'STATE_BOT_FALLBACK_POLICY',
      aspects: ['bot_identity', 'bot_fallback_policy'],
      relation: 'BOT_FALLBACK_POLICY'
    };
  }

  // 0.023 Official Authenticity Assurance Inquiry
  if (/\bjawaban(?:mu)?\s+(?:selalu\s+)?(?:resmi|terbaru|akurat|valid|benar)\b/i.test(normalized)) {
    return {
      domain: 'CONVERSATIONAL',
      intent: 'BOT_IDENTITY',
      retrievalRequired: false,
      userState: 'SMALL_TALK',
      desiredAction: 'STATE_BOT_AUTHENTICITY',
      aspects: ['bot_identity', 'bot_authenticity'],
      relation: 'BOT_AUTHENTICITY'
    };
  }

  // 0.024 Human Admin vs Bot Inquiry
  if (/\b(?:apakah\s+)?(?:saya|aku)\s+(?:sedang\s+)?(?:bicara|ngobrol|berbicara|chatting|chat)\s+(?:dengan|sama)\s+(?:admin|manusia|orang|bot|ai|robot|asisten)\b/i.test(normalized)) {
    return {
      domain: 'CONVERSATIONAL',
      intent: 'BOT_IDENTITY',
      retrievalRequired: false,
      userState: 'SMALL_TALK',
      desiredAction: 'STATE_BOT_IDENTITY',
      aspects: ['bot_identity'],
      relation: 'BOT_IDENTITY'
    };
  }

  // 0.025 Broad Campus Overview
  if (/\btolong\s+jelaskan\s+semua\s+informasi\s+kampus\s+secara\s+lengkap\b/i.test(normalized) ||
    (/\b(?:semua|seluruh)\s+informasi\s+kampus\b/i.test(normalized) && /\b(?:pendaftaran|biaya|jurusan|prospek)\b/i.test(normalized))) {
    return {
      domain: 'GENERAL',
      intent: 'BROAD_CAMPUS_OVERVIEW',
      retrievalRequired: false,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_CAMPUS_OVERVIEW',
      aspects: ['general_overview', 'programs', 'admission', 'tuition'],
      relation: 'BROAD_OVERVIEW'
    };
  }



  // 0.02 Bot Identity / Creator Inquiry (Evaluated BEFORE general greeting to capture queries like "Halo, kamu siapa?")
  if (/\b(?:siapa\s+(?:yang\s+)?(?:membuat|menciptakan|mengembangkan|merancang|bikin)\s+(?:kamu|anda|bot|tiko)|siapa\s+pembuat(?:mu)?|siapa\s+pengembang(?:mu)?)\b/i.test(normalized)) {
    return {
      domain: 'CONVERSATIONAL',
      intent: 'BOT_IDENTITY',
      retrievalRequired: false,
      userState: 'SMALL_TALK',
      desiredAction: 'STATE_BOT_CREATOR',
      aspects: ['bot_identity', 'bot_creator'],
      relation: 'BOT_CREATOR'
    };
  }

  if (/\b(?:siapa\s+(?:kamu|anda|dirimu|namamu)|nama\s+kamu|kamu\s+siapa|kamu\s+ini\s+siapa|apakah\s+kamu\s+(?:ai|robot|bot|manusia)|kamu\s+(?:ai|robot|bot)|tentang\s+kamu|profilmu)\b/i.test(normalized)) {
    return {
      domain: 'CONVERSATIONAL',
      intent: 'BOT_IDENTITY',
      retrievalRequired: false,
      userState: 'SMALL_TALK',
      desiredAction: 'STATE_BOT_IDENTITY',
      aspects: ['bot_identity'],
      relation: 'BOT_IDENTITY'
    };
  }

  // 0. Conversational Greeting & Small Talk (Non-Retrieval)
  if (/^(hallo+|halo+|hai+|hi+|hei+|pagi|siang|sore|malam|assalamu'?alaikum|selamat\s+(pagi|siang|sore|malam)|sampurasun|om\s+swastiastu|permisi)\b/i.test(normalized) &&
    !/\b(biaya|daftar|jurusan|prodi|beasiswa|kuliah|akreditasi|perwalian|krs|mata\s*kuliah|sks|lokasi|alamat|fasilitas|kontak|telepon|inbis|career|cdc|jadwal|syarat|alur|tanya|mau\s+tanya|ingin\s+tahu|di\s*mana|dimana|gedung)\b/i.test(normalized)) {
    return {
      domain: 'CONVERSATIONAL',
      intent: 'CONVERSATIONAL_GREETING',
      retrievalRequired: false,
      userState: 'GREETING',
      desiredAction: 'GREET_USER',
      aspects: ['greeting'],
      relation: 'GREETING'
    };
  }

  // 0.005 Conversational Request to Ask / Meta-Inquiry Opener
  // Matches polite openers like "Selamat pagi, boleh tanya tentang kampus?", "Permisi, saya ingin cari informasi kuliah",
  // "Halo, saya mau tanya", "Boleh minta info seputar kampus?" that do NOT contain substantive attributes or specific entities.
  const isSubstantiveInquiry = /\b(biaya|tarif|spp|dpp|daftar|pendaftaran|pmb|syarat|persyaratan|alur|jadwal|gelombang|jurusan|prodi|program\s+studi|beasiswa|potongan|akreditasi|kurikulum|mata\s*kuliah|sks|magang|karier|karir|pekerjaan|fasilitas|lab|laboratorium|perpustakaan|asrama|lokasi|alamat|kontak|nomor|telepon|wa|whatsapp|inbis|cdc|wisuda|yudisium|krs|perwalian|rpl|double\s+degree|dual\s+degree|internasional|exchange|sion)\b/i.test(normalized);

  const isMetaInquiryOpener = (
    /^(?:(?:halo+|hai+|pagi|siang|sore|malam|permisi|assalamu'?alaikum|selamat\s+(?:pagi|siang|sore|malam))[\s,]*)?(?:saya\s+)?(?:mau|ingin|boleh|bisa|butuh|minta)\s+(?:tanya(?:[- ]tanya)?|bertanya|nanya|cari(?:\s+(?:info|informasi))?|tahu|mengetahui|informasi|info)(?:\s+(?:sesuatu|dong|ya|terkait|tentang|seputar|mengenai))?(?:\s+(?:kampus|kuliah(?:\s+di\s+sini)?|stikom(?:\s+bali)?|itb\s+stikom(?:\s+bali)?|informasi|info))?(?:\s+(?:boleh|bisa|ya|kah))?[.!?]*$/i.test(normalized) ||
    /^(?:(?:halo+|hai+|pagi|siang|sore|malam|permisi|selamat\s+(?:pagi|siang|sore|malam))[\s,]*)?(?:boleh|bisa)(?:\s+saya)?\s+(?:tanya(?:[- ]tanya)?|bertanya|minta\s+(?:info|informasi))(?:\s+(?:tentang|seputar|mengenai)\s+(?:kampus|kuliah(?:\s+di\s+sini)?|stikom(?:\s+bali)?|itb\s+stikom(?:\s+bali)?))?[.!?]*$/i.test(normalized)
  );

  if (isMetaInquiryOpener && !isSubstantiveInquiry && entities.length === 0) {
    return {
      domain: 'CONVERSATIONAL',
      intent: 'CONVERSATIONAL_REQUEST_TO_ASK',
      retrievalRequired: false,
      userState: 'INQUIRING',
      desiredAction: 'INVITE_QUESTION',
      aspects: ['request_to_ask', 'meta_inquiry'],
      relation: 'CONVERSATIONAL'
    };
  }

  // 0.03 How are you / Small Talk
  if (/\b(apa\s+kh?abar|bagaimana\s+kh?abar(?:mu)?|gimana\s+kh?abar(?:mu)?|kh?abar(?:nya)?\s+gimana|sehat|bagaimana\s+keadaanmu|lagi\s+sibuk|kamu\s+sedang\s+apa|lagi\s+ngapain|hari\s+ini\s+ramai|temani\s+ngobrol|teman\s+ngobrol)\b/i.test(normalized)) {
    return {
      domain: 'CONVERSATIONAL',
      intent: 'CONVERSATIONAL_SMALL_TALK',
      retrievalRequired: false,
      userState: 'SMALL_TALK',
      desiredAction: 'RESPOND_SMALL_TALK',
      aspects: ['small_talk'],
      relation: 'SMALL_TALK'
    };
  }

  // 0.035 Emotional Venting / Personal Distress
  if (/\b(?:sedih|kecewa|galau|stres|stress|depresi|terpuruk|patah\s*hati|putus\s*asa|capek\s*banget|lelah\s*mental|butuh\s*teman|boleh\s*cerita|curhat|curahan\s*hati|curcol|bercerita|lagi\s*down)\b/i.test(normalized)) {
    return {
      domain: 'CONVERSATIONAL',
      intent: 'CONVERSATIONAL_SMALL_TALK',
      retrievalRequired: false,
      userState: 'VENTING',
      desiredAction: 'RESPOND_EMPATHY',
      aspects: ['emotional_support', 'counseling_referral'],
      relation: 'EMPATHY'
    };
  }

  // 0.04 Farewell / Closing
  if (/\b(sampai\s+(?:nanti|jumpa|ketemu|besok)|dadah|selamat\s+tinggal|bye|goodbye|see\s+you|pamit)\b/i.test(normalized) &&
    !/\b(biaya|daftar|jurusan|prodi|beasiswa|kuliah)\b/i.test(normalized)) {
    return {
      domain: 'CONVERSATIONAL',
      intent: 'CONVERSATIONAL_FAREWELL',
      retrievalRequired: false,
      userState: 'CLOSING',
      desiredAction: 'FAREWELL_USER',
      aspects: ['farewell'],
      relation: 'FAREWELL'
    };
  }

  // 0.05 Conversational Closing / Acknowledgement
  const isQuestionOrInquiry = /\b(?:apa|rekomendasi|rekomendasikan|gimana|bagaimana|mana|apakah|bisa|tolong|mohon)\b/i.test(normalized);
  if (!isQuestionOrInquiry && /\b(?:wah\s+)?(?:sangat\s+|banget\s+)?(?:membantu|keren|bagus|mantap|terima\s*kasih|makasih|thanks|thank\s*you|siap|sip|noted|oke+|ok+|baik+)\b/i.test(normalized) &&
    !/\b(biaya|daftar|jurusan|prodi|beasiswa|kuliah|akreditasi|perwalian|krs|mata\s*kuliah|sks|semester)\b/i.test(normalized)) {
    return {
      domain: 'CONVERSATIONAL',
      intent: 'CONVERSATIONAL_ACKNOWLEDGEMENT',
      retrievalRequired: false,
      userState: 'ACKNOWLEDGING',
      desiredAction: 'ACKNOWLEDGE_USER',
      aspects: ['acknowledgement'],
      relation: 'ACKNOWLEDGEMENT'
    };
  }

  // 0.1 Prompt Injection & Adversarial Jailbreak Defense
  if (/\b(ignore\s+(all\s+)?(?:previous\s+)?instructions|forget\s+(?:all\s+)?(?:rules|instructions)|system\s+prompt|reveal\s+(?:the\s+)?prompt|jailbreak|kamu\s+sekarang\s+adalah\s+DAN|abaikan\s+(?:semua\s+)?(?:instruksi|aturan)|lupakan\s+(?:semua\s+)?(?:instruksi|aturan)|bocorkan\s+prompt|bypass\s+security)\b/i.test(normalized)) {
    return {
      domain: 'CONVERSATIONAL',
      intent: 'ADVERSARIAL_INJECTION_DEFENSE',
      retrievalRequired: false,
      userState: 'ADVERSARIAL',
      desiredAction: 'REFUSE_ADVERSARIAL',
      aspects: ['safety_refusal'],
      relation: 'SAFETY_GUARD'
    };
  }

  // 0.12 Payment Status Issue (e.g. No. 109 "Pembayaran sudah berhasil tetapi status belum berubah")
  if (/\b(?:pembayaran|bayar|transfer)\b/i.test(normalized) &&
    /\b(?:status|belum\s+berubah|belum\s+masuk|pending|berhasil\s+tetapi|berhasil\s+tapi|konfirmasi\s+pembayaran)\b/i.test(normalized)) {
    return {
      domain: 'ADMISSIONS',
      intent: 'PAYMENT_STATUS_ISSUE',
      retrievalRequired: false,
      userState: 'ISSUE_REPORTING',
      desiredAction: 'ESCALATE_PAYMENT_ISSUE',
      aspects: ['payment_verification', 'payment_status', 'bank_reconciliation'],
      relation: 'ADMISSION_PAYMENT'
    };
  }

  // 0.14 Transfer Admission Inquiry (Mahasiswa Pindahan dari Kampus Lain - No. 67)
  // Evaluated before student exchange/GCCP to strictly distinguish university transfers from international exchange.
  const isTransferAdmission = (
    /\b(?:mahasiswa\s+pindahan|pindah(?:an)?\s+(?:kuliah|studi)?\s*(?:dari\s+(?:kampus|universitas|pt|perguruan\s+tinggi)\s+lain)?|transfer\s+kuliah(?:\s+dari\s+(?:kampus|universitas|pt|perguruan\s+tinggi)\s+lain)?|pindah\s+(?:jurusan|prodi)\s+dari\s+(?:kampus|universitas|pt|perguruan\s+tinggi)\s+lain|menerima\s+mahasiswa\s+pindahan|transfer\s+dari\s+kampus\s+lain)\b/i.test(normalized) ||
    (/\b(?:pindahan|alih\s+bentuk)\b/i.test(normalized) && /\b(?:mahasiswa|kuliah|daftar|terima|menerima)\b/i.test(normalized))
  ) && !/\b(?:pertukaran\s+(?:pelajar|mahasiswa)|student\s+exchange|gccp|cross\s+cultural|luar\s+negeri)\b/i.test(normalized);

  if (isTransferAdmission) {
    return {
      domain: 'ADMISSIONS',
      intent: 'TRANSFER_ADMISSION_INQUIRY',
      retrievalRequired: false,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_TRANSFER_ADMISSION_INFO',
      aspects: ['transfer_admission', 'credit_transfer_external'],
      relation: 'TRANSFER_ADMISSION'
    };
  }

  // 0.15 Explicit Unsupported Program Detection (Generic structural fail-closed)
  const unsupportedProg = detectUnsupportedProgram(normalized, entities);
  if (unsupportedProg) {
    return {
      domain: 'UNSUPPORTED_PROGRAM',
      intent: 'UNSUPPORTED_PROGRAM_INQUIRY',
      retrievalRequired: false,
      userState: 'INQUIRING',
      desiredAction: 'REFUSE_UNSUPPORTED_PROGRAM',
      aspects: ['unsupported_program'],
      relation: 'UNSUPPORTED_DISCIPLINE',
      unsupportedProgramName: unsupportedProg,
      unsupportedEntity: true,
      unsupportedEntityName: unsupportedProg,
      entityResolutionStatus: 'UNSUPPORTED'
    };
  }

  // 0.17 Explicit Gambling / Lottery Guard (No. 431 "Tolong prediksi nomor togel")
  if (/\b(?:togel|judi|slot(?:\s+gacor)?|kasino|roulette|prediksi\s+(?:nomor\s+)?togel|angka\s+togel)\b/i.test(normalized)) {
    return {
      domain: 'OUT_OF_DOMAIN',
      intent: 'OUT_OF_DOMAIN_GAMBLING',
      retrievalRequired: false,
      userState: 'INQUIRING',
      desiredAction: 'REFUSE_OUT_OF_DOMAIN',
      aspects: ['gambling'],
      relation: 'OUT_OF_DOMAIN'
    };
  }

  // 0.18 Explicit Non-Campus / Out-of-Domain Guard
  // Blocks general non-campus questions (automotive, agriculture, home repair, personal accounts/ISP, general coding/algorithms, etc.)
  // from falsely triggering campus admission, tuition fee, or PMB handlers.
  const NON_CAMPUS_DOMAIN_INDICATORS = /\b(?:ganti\s+oli|oli(?:\s+motor|\s+mobil|\s+matic)?|servis\s+motor|servis\s+mobil|bengkel(?:\s+motor|\s+mobil)?|tambal\s+ban|cuci\s+motor|cuci\s+mobil|renovasi\s+atap|atap\s+bocor|semen|genteng|bibit\s+lele|ternak\s+lele|pakan\s+lele|pertanian|bumn|bumn\s+batch|bumn\s+2025|google\s+forms|paspor|bikin\s+paspor|kantor\s+imigrasi|indihome|paket\s+indihome|wifi\s+indihome|kuota\s+telkomsel|kuota\s+xl|kuota\s+tri|kuota\s+axis|kuota\s+hp|kuota\s+internet\s+(?:hp|android|kartu)|akun\s+instagram|akun\s+ig|mobile\s+legends|diamond\s+ml|game\s+ml|reset\s+wifi\s+router|router\s+wifi|email\s+yahoo|yahoo\s+mail|pembuatan\s+sim|perpanjang\s+sim|sim\s+[abc]|binary\s+search|bubble\s+sort|left\s+join\s+sql|blue\s*screen|error\s+(?:coding|python|laptop)|laptop\s+error|coding\s+python|belajar\s+python|tutorial\s+python|cara\s+install\s+windows|resep\s+masak|chord\s+gitar|prediksi\s+cuaca|harga\s+emas|kurs\s+dollar|warung\s+(?:makan|babi|nasi|kopi)|rumah\s+makan|babi\s+guling|kuliner|tempat\s+makan|restoran|resto|cafe|kafe|warkop|menu\s+makan|toko\s+(?:baju|helm|kelontong|sembako|elektronik)|supermarket|minimarket|laundry|salon|barbershop|potong\s+rambut|atm\s+(?:bca|bni|bri|mandiri)|hotel|penginapan|villa|homestay)\b/i;

  const strippedNormalized = stripProximityModifiers(normalized);
  if (NON_CAMPUS_DOMAIN_INDICATORS.test(strippedNormalized) &&
    !/\b(?:stikom|bali|kampus|kuliah|dosen|mahasiswa|krs|sion|pmb|prodi|jurusan|rektor|dekan)\b/i.test(strippedNormalized)) {
    return {
      domain: 'OUT_OF_DOMAIN',
      intent: 'OUT_OF_DOMAIN_INQUIRY',
      retrievalRequired: false,
      userState: 'INQUIRING',
      desiredAction: 'REFUSE_OUT_OF_DOMAIN',
      aspects: ['out_of_domain'],
      relation: 'OUT_OF_DOMAIN_QUERY'
    };
  }

  // 0.2 Answer Refinement / Revision
  if (/\b(?:bisa\s+(?:dibuat\s+)?(?:lebih\s+)?(?:singkat|ringkas|pendek)|ringkas(?:kan)?(?:\s+lagi)?|terlalu\s+panjang|perlu\s+koreksi\s+.*(?:singkat|ringkas)|persingkat(?:kan)?)\b/i.test(normalized)) {
    return {
      domain: (sessionData && sessionData.activeDomain) || 'GENERAL',
      intent: 'ANSWER_REFINEMENT',
      retrievalRequired: false,
      userState: 'INQUIRING',
      desiredAction: 'REFINE_PREVIOUS_ANSWER',
      aspects: ['refinement', 'conciseness'],
      relation: 'ANSWER_REVISION'
    };
  }

  // 0.8 Specialized Handlers: SION Portal, Kemahasiswaan, PMB Registration, Vokasi, S2 Research Focus
  if (/\b(?:sion|portal\s+akademik|portal\s+sion)\b/i.test(normalized)) {
    const isSionIssueOrContact = /\b(?:kendala|masalah|error|gagal|lupa|tidak\s+bisa|bentrok|login|masuk|urus|mengurus|hubungi|menghubungi|siapa|kontak|bagian)\b/i.test(normalized);
    return {
      domain: 'CAMPUS_SERVICE',
      intent: 'CAMPUS_SERVICE_INQUIRY',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_SERVICE_INFO',
      aspects: isSionIssueOrContact
        ? ['services', 'academic_system', 'sion_troubleshooting']
        : ['services', 'academic_system'],
      relation: 'CAMPUS_SERVICE'
    };
  }

  if (/\b(?:kemahasiswaan|layanan\s+kemahasiswaan|bagian\s+kemahasiswaan)\b/i.test(normalized)) {
    return {
      domain: 'CAMPUS_SERVICE',
      intent: 'CONTACT_INQUIRY',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_CONTACT_INFO',
      aspects: ['contact', 'student_affairs'],
      relation: 'CAMPUS_SERVICE'
    };
  }

  if (/\b(?:fokus\s+riset|topik\s+riset|riset|konsentrasi|pilar\s+riset|bidang\s+kajian)\b/i.test(normalized) &&
    /\b(?:data\s+science|cyber\s+security|enterprise\s+system|medical\s+informatics?|s2|magister|pascasarjana)\b/i.test(normalized)) {
    const s2Entity = findCanonicalEntity('S2 Sistem Informasi');
    return {
      domain: 'ACADEMIC_CURRICULUM',
      intent: 'CURRICULUM_INQUIRY',
      entities: s2Entity ? [s2Entity] : [],
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_CURRICULUM_INFO',
      aspects: ['curriculum', 'research_focus'],
      academicLevel: 'S2',
      scopeLevel: 'S2',
      relation: 'CURRICULUM_SPECIFICATION'
    };
  }

  if (/\b(?:vokasi|pendidikan\s+vokasi|program\s+vokasi|prodi\s+vokasi)\b/i.test(normalized)) {
    const d3Entity = findCanonicalEntity('D3 Manajemen Informatika');
    return {
      domain: 'ACADEMIC_PROGRAM',
      intent: 'AVAILABLE_PROGRAMS_LIST',
      entities: d3Entity ? [d3Entity] : [],
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_PROGRAMS_LIST',
      aspects: ['program_list', 'degrees', 'vocational'],
      academicLevel: 'D3',
      scopeLevel: 'D3',
      relation: 'ACADEMIC_CATALOG'
    };
  }

  if (/\b(?:komunitas\s+(?:teknologi|programming|koding|coding)|ukm\s+teknologi|programming|coding|robotik|linux)\b/i.test(normalized) &&
    /\b(?:ukm|komunitas|organisasi|klub|gabung|pilihan|ada)\b/i.test(normalized)) {
    return {
      domain: 'ORGANIZATION_UKM',
      intent: 'ORGANIZATION_INQUIRY',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_ORGANIZATION_INFO',
      aspects: ['organization', 'activities', 'ukm', 'reasoning_tech'],
      relation: 'STUDENT_ORGANIZATION'
    };
  }

  const isScheduleOrDateInquiry = /\b(?:jadwal|kapan|tanggal|waktu)\b/i.test(normalized);
  if (!isScheduleOrDateInquiry && !/\b(?:rpl|rekognisi)\b/i.test(normalized) && (/\b(?:ktp|kk|kartu\s+keluarga|formulir|kode\s+verifikasi|otp|tes\s+masuk|seleksi|ujian\s+seleksi|bukti\s+bayar|bukti\s+transfer|bukti\s+pembayaran|kartu\s+peserta)\b/i.test(normalized) ||
    /\b(?:setelah\s+isi\s+formulir|salah\s+mengisi\s+data|ubah\s+pilihan|lupa\s+nomor\s+handphone|verifikasi\s+dokumen|belum\s+mendapat\s+konfirmasi|error\s+saat\s+dikirim)\b/i.test(normalized))) {
    const isSpecificPmbTechOrReq = /\b(?:ktp|kk|kartu\s+keluarga|kode\s+verifikasi|otp|tes\s+masuk|seleksi\s+tambahan|ujian\s+seleksi|setelah\s+isi\s+formulir|salah\s+mengisi\s+data|ubah\s+pilihan|lupa\s+nomor\s+handphone|belum\s+mendapat\s+konfirmasi|error\s+saat\s+dikirim|formulir.*error|kartu\s+peserta)\b/i.test(normalized);
    return {
      domain: 'PMB',
      intent: 'ADMISSION_PROCEDURE',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_ADMISSION_PROCEDURE',
      aspects: isSpecificPmbTechOrReq
        ? ['procedure', 'requirements', 'pmb_technical_or_specific_req']
        : ['procedure', 'requirements', 'admission_overview'],
      relation: 'ADMISSION_ONBOARDING'
    };
  }

  if (/\b(?:harus\s+bisa\s+(?:coding|bahasa\s+inggris)|belum\s+pernah\s+belajar\s+coding|bisa\s+coding\s+sebelum\s+masuk|bisa\s+bahasa\s+inggris)\b/i.test(normalized)) {
    return {
      domain: 'PMB',
      intent: 'ADMISSION_REQUIREMENTS',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_ADMISSION_REQUIREMENTS',
      aspects: ['requirements', 'curriculum', 'overview'],
      relation: 'ADMISSION_ONBOARDING'
    };
  }

  // Applicant School Background / Eligibility Follow-up (e.g., "Kalau untuk lulusan SMK bagaimana?")
  if (/\b(?:lulusan|alumni|tamatan|asal(?:\s+sekolah)?|dari)\s+(?:sma|smk|ma|paket\s+c|sekolah\s+menengah)\b/i.test(normalized) &&
    !/\b(?:diskon|potongan|beasiswa|keringanan|biaya)\b/i.test(normalized) &&
    !/\b(?:bingung\s+pilih\s+jurusan|rekomendasi\s+jurusan|cocok\s+ambil\s+jurusan\s+apa|jurusan\s+apa\s+yang\s+cocok)\b/i.test(normalized)) {
    return {
      domain: 'PMB',
      intent: 'ADMISSION_REQUIREMENTS',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_ADMISSION_REQUIREMENTS',
      aspects: ['requirements', 'admission_requirements', 'eligibility'],
      relation: 'ADMISSION_ELIGIBILITY'
    };
  }

  // Multi-program selection policy in PMB (e.g. "Apakah satu orang boleh memilih lebih dari satu prodi?")
  if (/\b(?:pilih|memilih|ambil|daftar)\s+(?:lebih\s+dari\s+satu|dua|banyak|beberapa)\s+(?:prodi|program\s+studi|jurusan)\b/i.test(normalized) ||
    /\b(?:satu\s+orang\s+boleh\s+(?:memilih|pilih)|boleh(?:kah)?\s+(?:memilih|pilih)\s+(?:lebih\s+dari\s+satu|dua|beberapa)\s+(?:prodi|jurusan))\b/i.test(normalized)) {
    return {
      domain: 'PMB',
      intent: 'ADMISSION_REQUIREMENTS',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_ADMISSION_REQUIREMENTS',
      aspects: ['program_selection_policy', 'requirements', 'admission_requirements'],
      relation: 'ADMISSION_POLICY'
    };
  }

  // 1. Specialized Campus Service / Career Center (Takes precedence over generic vocabulary like "fasilitas", "biaya", "cara")
  const campusServiceEntity = entities.find(e => e.family === 'campus_service');
  const hasProgramEntityInScope = entities.some(e => e.family === 'academic_program' || e.type === 'program');
  const isInternationalInternship = /\b(?:magang\s+(?:di\s+|ke\s+)?(?:luar\s+negeri|jepang)|bekerja\s+(?:di\s+|ke\s+)?luar\s+negeri|hi-?think)\b/i.test(normalized);
  const isJobGuarantee = /\b(?:jaminan|menjamin|dijamin|pasti)\s+(?:kerja|pekerjaan|dapat\s+kerja|bekerja)\b/i.test(normalized) ||
    /\b(?:langsung\s+(?:dapat\s+)?kerja)\b/i.test(normalized);
  const isInbisService = /\b(?:inbis|inkubator\s+bisnis|p2mw|tenant|startup|kewirausahaan|wirausaha\s+(?:pemula|mahasiswa)|inkubasi)\b/i.test(normalized) ||
    (campusServiceEntity && /inbis|inkubator/i.test(campusServiceEntity.canonical));
  const isCareerService = /\b(?:career\s+center|cdc\b|pusat\s+karier|inbis|inkubator\s+bisnis|p2mw|tenant|startup|kewirausahaan|wirausaha|inkubasi|magang|internship|campus\s+hiring|rekrutmen|kerja\s+sama|mitra\s+industri|penyaluran\s+kerja|perusahaan\s+kami|bursa\s+kerja|job\s+fair|konsultasi\s+karier|bimbingan\s+karier|tracer\s+study|lulusan.*(?:kerja|bekerja)|(?:kerja|bekerja)\s+(?:di\s*mana|sebagai\s+apa)|tempat\s+kerja|peluang\s+kerja|prospek\s+kerja)\b/i.test(normalized);

  if (!isInternationalInternship && !hasProgramEntityInScope && (campusServiceEntity || isCareerService || isJobGuarantee || isInbisService)) {
    if (isInbisService) {
      let inbisAspects = ['inbis_overview', 'incubation_programs', 'inbis_services', 'entrepreneurship'];
      if (/\b(?:p2mw|gowjus|sehabit|dikerajinin|program\s+pembinaan\s+wirausaha)\b/i.test(normalized)) {
        inbisAspects = ['p2mw', 'entrepreneurship', 'incubation_programs', 'inbis_overview'];
      } else if (/\b(?:tenant|tahapan?|pra-?inkubasi|pasca-?inkubasi|start-?learn-?growth)\b/i.test(normalized)) {
        inbisAspects = ['tenant_programs', 'incubation_programs', 'inbis_overview'];
      } else if (/\b(?:layanan|fasilitas|mentor|coworking|bimbingan|ruang|pendampingan)\b/i.test(normalized)) {
        inbisAspects = ['inbis_services', 'incubation_programs', 'inbis_overview'];
      }
      return {
        domain: 'CAMPUS_SERVICE',
        intent: 'CAMPUS_SERVICE_INQUIRY',
        retrievalRequired: true,
        userState: 'INQUIRING',
        desiredAction: 'PROVIDE_CAMPUS_SERVICE_INFO',
        aspects: inbisAspects,
        relation: 'INBIS_SERVICE'
      };
    }

    const isInternship = /\b(?:magang|internship|pkl|praktek|praktik)\b/i.test(normalized);
    const isWorkplaceInquiry = /\b(?:lulusan.*(?:kerja|bekerja)|(?:kerja|bekerja)\s+(?:di\s*mana|sebagai\s+apa)|tempat\s+kerja|perusahaan\s+(?:tempat\s+)?kerja|peluang\s+kerja|prospek\s+kerja)\b/i.test(normalized);
    const isCareer = (campusServiceEntity && (campusServiceEntity.canonical.includes('CDC') || campusServiceEntity.canonical.includes('Career') || campusServiceEntity.canonical.includes('LinkedIn'))) ||
      isJobGuarantee || isWorkplaceInquiry || isInternship ||
      /\b(?:career|cdc\b|pusat\s+karier|campus\s+hiring|rekrutmen|penyaluran\s+kerja|bursa\s+kerja|job\s+fair|konsultasi\s+karier|bimbingan\s+karier|tracer\s+study)\b/i.test(normalized);
    const isLLC = (campusServiceEntity && /language\s+learning\s+center|llc/i.test(campusServiceEntity.canonical)) ||
      /\b(?:llc|language\s+learning\s+center)\b/i.test(normalized);
    return {
      domain: isCareer ? 'CAREER_CENTER' : 'CAMPUS_SERVICE',
      intent: isCareer ? (isWorkplaceInquiry ? 'CAREER_PROSPECTS_INQUIRY' : 'CAREER_CENTER_INQUIRY') : 'CAMPUS_SERVICE_INQUIRY',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: isCareer ? 'PROVIDE_CAREER_CENTER_INFO' : 'PROVIDE_CAMPUS_SERVICE_INFO',
      aspects: isCareer
        ? (isJobGuarantee
          ? ['job_guarantee', 'career_services', 'employment_policy']
          : (isInternship
            ? ['internship', 'career_services', 'cooperation']
            : (isWorkplaceInquiry
              ? ['career_prospects', 'career_services']
              : ['internship', 'career_services', 'cooperation'])))
        : (isLLC ? ['facilities', 'campus_service', 'service_info'] : ['service_info', 'support', 'facilities']),
      relation: isCareer ? 'CAREER_SERVICES' : 'CAMPUS_SERVICE'
    };
  }

  // 2. Admission Tracks / Transfer / RPL (Rekognisi Pembelajaran Lampau)
  const isStudyMode = /\b(?:kuliah\s+sore|kelas\s+sore|kelas\s+karyawan|kuliah\s+malam|kelas\s+malam|sambil\s+kerja|kuliah\s+sambil\s+kerja|untuk\s+yang\s+(?:sudah\s+)?bekerja)\b/i.test(normalized);
  const isFeeQuery = /\b(biaya(?:nya)?|biaya kuliah|spp(?:nya)?|dpp(?:nya)?|uang\s+kuliah(?:nya)?|uang\s+pangkal|bayar\s+kuliah|bayar\s+berapa|angsuran|potongan\s+biaya|cicilan|(?:di)?cicil(?:an)?|angsur(?:an)?)\b/i.test(normalized);
  const admissionTrackEntity = entities.find(e => e.family === 'admission_track');
  if (!isStudyMode && !isFeeQuery && (admissionTrackEntity || /\b(?:rpl|rekognisi\s+pembelajaran\s+lampau|transfer\s+sks|alih\s+jenjang|lanjut\s+s1|pindahan)\b/i.test(normalized))) {
    const isRPL = (admissionTrackEntity && admissionTrackEntity.canonical.includes('RPL')) ||
      /\b(?:rpl|rekognisi|transfer\s+sks|alih\s+jenjang)\b/i.test(normalized);
    if (isRPL) {
      const isFormFilling = /\b(?:formulir|form|f01|f-01|isian|isi\s+formulir|mengisi\s+formulir|pengisian\s+formulir|aplikasi\s+rpl)\b/i.test(normalized);
      const isStages = !isFormFilling && /\b(?:tahap(?:an)?|alur|alur\s+pendaftaran|tahapan\s+daftar|proses\s+daftar|alur\s+daftar|cara\s+daftar|mendaftar|pendaftaran)\b/i.test(normalized);
      const isRequirementsDocs = !isFormFilling && !isStages && /\b(?:syarat|persyaratan|dokumen|berkas|portofolio|bukti)\b/i.test(normalized);
      const isAssessmentConversion = !isFormFilling && !isStages && !isRequirementsDocs && /\b(?:penilaian|asesmen|pengalaman\s+kerja|v-?a-?t-?m|evaluasi\s+diri|konversi|pengakuan|perolehan\s+sks|transfer\s+sks)\b/i.test(normalized);

      let rplIntent = 'RPL_INQUIRY';
      let rplAspects = ['rpl', 'credit_transfer', 'procedure', 'requirements'];

      if (isFormFilling) {
        rplIntent = 'RPL_FORM_PROCEDURE';
        rplAspects = ['rpl', 'rpl_form', 'form_procedure', 'form_filling'];
      } else if (isStages) {
        rplIntent = 'RPL_ADMISSION_STAGES';
        rplAspects = ['rpl', 'admission_stages', 'procedure', 'registration'];
      } else if (isRequirementsDocs) {
        rplIntent = 'RPL_REQUIREMENTS';
        rplAspects = ['rpl', 'requirements', 'documents', 'portfolio'];
      } else if (isAssessmentConversion) {
        rplIntent = 'RPL_ASSESSMENT_CONVERSION';
        rplAspects = ['rpl', 'credit_transfer', 'assessment', 'work_experience'];
      }

      return {
        domain: 'ADMISSION_TRACK',
        intent: rplIntent,
        retrievalRequired: true,
        userState: 'INQUIRING',
        desiredAction: 'PROVIDE_RPL_INFO',
        aspects: rplAspects,
        relation: 'RPL_ADMISSION'
      };
    }

    const isProcedure = /\b(?:alur|cara|prosedur|syarat|persyaratan|berkas|dokumen|daftar)\b/i.test(normalized);
    return {
      domain: 'ADMISSION_TRACK',
      intent: 'ADMISSION_TRACK_INQUIRY',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_ADMISSION_TRACK_INFO',
      aspects: ['admission_track', 'requirements'],
      relation: 'ADMISSION_TRACK'
    };
  }

  // 3. International Programs & Collaborations (Double Degree, Magang Luar Negeri, GCCP, Student Exchange)
  if (entities.some(e => e.family === 'international_program') || /\b(double degree|dual degree|international program|pertukaran\s+(?:pelajar|mahasiswa)|student exchange|gccp|bccp|magang\s+(?:ke\s+)?jepang|magang\s+(?:di\s+|ke\s+)?luar\s+negeri|bekerja\s+(?:di\s+|ke\s+)?luar\s+negeri|hi-?think|international\s+student\s+exchange|exchange\s+options?|study\s+abroad)\b/i.test(normalized)) {
    let intent = 'INTERNATIONAL_PROGRAM_INFO';
    const aspects = [];
    let relation = 'PROGRAM_DETAILS';

    const isGeneralAvailabilityInquiry = /\b(?:apakah\s+(?:ada|tersedia)|ada\s+(?:program|jurusan|pilihan|kelas)?|bisa\s+ambil|daftar\s+program)\b/i.test(normalized);
    const hasLocationSignal = !isGeneralAvailabilityInquiry && (/\b(?:full\s+di\s+stikom|di\s*mana|dimana|lokasi|tempat\s+kuliah|tempat\s+studi|kuliah\s+di\s+luar|onsite|offline|where(?:\s+is)?|study\s+location)\b/i.test(normalized) ||
      /\b(?:full\s+di\s+stikom|di\s*mana|dimana|lokasi|tempat\s+kuliah|tempat\s+studi|kuliah\s+di\s+luar|ke\s+luar\s+negeri|onsite|offline|where(?:\s+is)?|study\s+location)\b/i.test(unstemmed) ||
      /\b(?:kuliah|studi|perkuliahan|pergi|berangkat|harus|wajib)\s+(?:ke|di)\s+(?:china|cina|malaysia|dalian)\b/i.test(normalized) ||
      /\b(?:kuliah|studi|perkuliahan|pergi|berangkat|harus|wajib)\s+(?:ke|di)\s+(?:china|cina|malaysia|dalian)\b/i.test(unstemmed));

    const hasFeeSignal = /\b(?:biaya(?:nya)?|uang|tarif|spp|dpp|bayar|cost|fee|fees)\b/i.test(normalized) ||
      /\b(?:biaya|uang|tarif|spp|dpp|bayar|cost|fee|fees)\b/i.test(unstemmed);

    if (hasFeeSignal) {
      intent = 'TUITION_FEE_INQUIRY';
      aspects.push('fee', 'tuition', 'dpp');
      relation = 'TUITION_FEE';
    } else if (hasLocationSignal) {
      intent = 'STUDY_LOCATION';
      aspects.push('study_location', 'location');
      relation = 'LOCATION_MODE';
    } else if (/\b(keuntungan(?:nya)?|manfaat(?:nya)?|benefit(?:nya)?|kelebihan(?:nya)?|gelar(?:nya)?)\b/i.test(normalized) ||
      /\b(keuntungan|manfaat|benefit|kelebihan|gelar)\b/i.test(unstemmed)) {
      intent = 'PROGRAM_BENEFIT';
      aspects.push('benefits');
      if (/\bgelar(?:nya)?\b/i.test(normalized + ' ' + unstemmed)) {
        aspects.push('degree_award');
      }
      relation = 'BENEFITS_AWARD';
    } else if (/\b(prosedur|cara|alur|syarat|persyaratan)\b/i.test(normalized) ||
      /\b(prosedur|cara|alur|syarat|persyaratan)\b/i.test(unstemmed)) {
      intent = 'PROGRAM_PROCEDURE';
      aspects.push('procedure', 'requirements');
      relation = 'PROGRAM_PROCEDURE';
    } else if (/\b(apa itu|pengertian|definisi)\b/i.test(normalized) ||
      /\b(apa itu|pengertian|definisi)\b/i.test(unstemmed)) {
      intent = 'DEFINITION';
      aspects.push('overview', 'definition');
      relation = 'DEFINITION';
    }

    return {
      domain: 'INTERNATIONAL',
      intent,
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_INTERNATIONAL_PROGRAM_INFO',
      aspects,
      relation
    };
  }

  // 4. Academic Missed Process / State
  if (/\b(terlambat|telat|ketinggalan|terlewat|lupa)\s+(perwalian|krs|daftar ulang|bayar|ujian|sidang|yudisium)\b/i.test(normalized)) {
    const processMatch = normalized.match(/\b(perwalian|krs|daftar ulang|bayar|ujian|sidang|yudisium)\b/i);
    const process = processMatch ? processMatch[1].toUpperCase() : 'ACADEMIC_PROCESS';
    return {
      domain: 'ACADEMIC',
      intent: 'MISSED_ACADEMIC_PROCESS',
      retrievalRequired: false,
      userState: 'LATE',
      desiredAction: 'NEXT_STEP_PROCEDURE',
      aspects: ['procedure', 'deadline', 'late_policy'],
      relation: `LATE_FOR_${process}`
    };
  }

  // 4b. Thesis / Final Project / Skripsi Requirements & Academic Guidelines (e.g. Q056)
  const isPmbContext = /\b(?:pmb|mahasiswa\s+baru|calon\s+mahasiswa|camaba|maba)\b/i.test(normalized);
  const isThesisExplicit = /\b(?:tugas\s+akhir|skripsi|pedoman\s+ta|menulis\s+ta|syarat\s+ta|sidang\s+ta|ujian\s+ta|bimbingan\s+ta|daftar\s+ta|pendaftaran\s+ta|proposal\s+ta|final\s+project|thesis|thesis\s+defense|final\s+project\s+defense)\b/i.test(normalized);
  const isStandaloneTa = /\bta\b/i.test(normalized) && !/\b(?:ta\s*202\d|ta\s*\d{4}|tahun\s*(?:akademik|ajaran))\b/i.test(normalized);

  if (!isPmbContext && (isThesisExplicit || isStandaloneTa)) {
    return {
      domain: 'ACADEMIC_CURRICULUM',
      intent: 'THESIS_REQUIREMENTS',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_THESIS_REQUIREMENTS',
      aspects: ['thesis_requirements', 'academic_requirements', 'guidelines'],
      relation: 'THESIS_GUIDELINES'
    };
  }

  // 5. Program Curriculum Inquiry (Priority over general program info)
  const hasSpecificProgramEntity = entities.some(e => (e.family === 'academic_program' || e.type === 'program') && !e.type?.includes('scope'));
  const hasAcademicProgramInContext = hasSpecificProgramEntity || (sessionData && sessionData.activeEntity && (
    (typeof sessionData.activeEntity === 'object' && (sessionData.activeEntity.family === 'academic_program' || sessionData.activeEntity.type === 'program')) ||
    (typeof sessionData.activeEntity === 'string' && !['Wisuda', 'Yudisium', 'Kampus ITB STIKOM Bali'].includes(sessionData.activeEntity))
  ));

  const hasExplicitFeeWord = /\b(?:biaya|spp|dpp|uang|dana\s+(?:kuliah|pendidikan|didik)|ukt|bayar|tarif|cicil(?:an)?|angsur(?:an)?)\b/i.test(normalized + ' ' + raw);
  const isCurriculumQuery = !hasExplicitFeeWord && (
    /\b(kurikulum(?:nya)?|mata\s*kuliah(?:nya)?|matkul(?:nya)?|sebaran\s*mata\s*kuliah|silabus|daftar\s*matkul|belajar\s+mata\s*kuliah|semester\s*(?:[1-8]|[ivx]+)|(?:apa\s+yang\s+)?dipelajari|pembelajaran|materi\s+kuliah|pelajaran|fokus\s+keilmuan|fokus\s+pembelajaran|bidang\s+keilmuan)\b/i.test(normalized) ||
    (hasAcademicProgramInContext && !/\b(?:biaya|uang|bayar|daftar|pendaftaran|jadwal|gelombang|lokasi|alamat|ukm)\b/i.test(normalized) && (
      /\b(?:belajar|mempelajari|diajarkan|diajarin|materi)\s+(?:tentang\s+)?(?:coding|koding|ngoding|pemrograman|programming|digital\s+marketing|marketing|pemasaran|ai\b|artificial\s+intelligence|kecerdasan\s+buatan|machine\s+learning|data\s+science|cyber|jaringan|web|mobile|android|game|multimedia|desain|iot|robotik|cloud|blockchain|akuntansi|bisnis|manajemen|komputer|software|hardware)\b/i.test(normalized) ||
      /\b(?:harus|perlu|wajib|kudu|bisa|jago|mahir|pintar|paham|menguasai)\s+(?:bisa\s+)?(?:coding|koding|ngoding|pemrograman|programming|it\b|komputer|hitung-?hitungan|matematika|desain|design|marketing)\b/i.test(normalized) ||
      /\b(?:ada\s+coding(?:nya)?|coding(?:an)?\s+nggak|banyak\s+koding(?:nya)?|harus\s+bisa\s+coding)\b/i.test(normalized)
    ))
  );

  if (isCurriculumQuery) {
    return {
      domain: 'ACADEMIC_CURRICULUM',
      intent: 'CURRICULUM_INQUIRY',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_CURRICULUM_INFO',
      aspects: ['curriculum', 'courses'],
      relation: 'PROGRAM_CURRICULUM'
    };
  }

  // 6a. Online Learning Platform Inquiry (e.g. "kuliah online pakai aplikasi apa")
  if (/\b(?:kuliah|perkuliahan)\s+.*(?:online|daring)\b/i.test(normalized) &&
    /\b(?:aplikasi|platform|software|media|pake|pakai|menggunakan)\b/i.test(normalized)) {
    return {
      domain: 'CAMPUS_LIFE',
      intent: 'ONLINE_LEARNING_PLATFORM',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_CAMPUS_INFO',
      aspects: ['learning_platform', 'facilities'],
      relation: 'ONLINE_LEARNING_PLATFORM'
    };
  }

  // 5c. Faculty & Institutional Structure Inquiries (Systemic Handling)
  const isFacultyKeyword = /\b(?:fakultas|faculty|faculties|dekan|fik|fbv|infokom|bisvo)\b/i.test(normalized) || /\b(?:fakultas|faculty|faculties|dekan|fik|fbv|infokom|bisvo)\b/i.test(raw);
  if (isFacultyKeyword) {
    const isProdiFacultyMapping = entities.some(e => e.family === 'academic_program' || e.type === 'program') ||
      /\b(?:masuk\s+fakultas|bagian\s+dari\s+fakultas|di\s+bawah\s+fakultas|fakultas\s+apa|which\s+faculty)\b/i.test(normalized) ||
      /\b(?:masuk\s+fakultas|bagian\s+dari\s+fakultas|di\s+bawah\s+fakultas|fakultas\s+apa|which\s+faculty)\b/i.test(raw);

    return {
      domain: 'ACADEMIC_PROGRAM',
      intent: 'FACULTY_INQUIRY',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_FACULTY_INFO',
      aspects: ['faculty', 'academic_structure'],
      relation: isProdiFacultyMapping ? 'PRODI_FACULTY_MAPPING' : 'FACULTY_OVERVIEW'
    };
  }

  // 6. Available Programs Listing (Generic Scope vs Specific Entity)
  const hasStudentOrgEntity = entities.some(e => e.family === 'student_organization');
  // 6b. Program Recommendation Inquiry (e.g. "cocoknya masuk prodi apa", "rekomendasi jurusan", "suka coding software dan bikin aplikasi", "jurusan apa yang pas")
  const isNonAcademicInquiry = entities.some(e => ['scholarship', 'campus_service', 'student_organization', 'facility', 'campus_facility'].includes(e.family)) ||
    /\b(?:beasiswa|kip\s*kuliah|kip-?k|inkubator|inbis|career\s+center|cdc\b|ukm\b|unit\s+kegiatan\s+mahasiswa|organisasi\s+mahasiswa|ormawa|hima\b|himaprodi|student\s+clubs?|student\s+organizations?|asrama|laboratorium|fasilitas)\b/i.test(normalized);

  const hasFitSignals = hasGenuineProgramFitSignal(normalized);

  const isProcedureInquiry = /\b(?:cara\s+(?:daftar|mendaftar)|caranya\s+gimana|alur\s+pendaftaran|prosedur|tahapan|langkah\s+awal|(?:mau|mw|pengen|ingin|bisa)\s+daftar(?:\s+kuliah)?|daftar\s+(?:kuliah|pmb))\b/i.test(normalized) &&
    !/\b(?:rekomendasi|cocok(?:nya)?|saran|bingung\s+pilih)\b/i.test(normalized);

  const isRecommendationInquiry = !hasSpecificProgramEntity && !isNonAcademicInquiry && !isProcedureInquiry && (
    (/\b(?:rekomendasi|rekomendasikan|cocok(?:nya)?|saran|bingung\s+pilih|pas)\b/i.test(normalized) &&
      (/\b(?:prodi|jurusan|program\s*studi|kuliah)\b/i.test(normalized) || /\b(?:suka|minat|hobi|bakat|passion)\b/i.test(normalized))) ||
    (/\b(?:suka|minat|hobi|bakat|passion|tertarik|senang|cita-?cita|ingin\s+menjadi|mau\s+berkarir|mau\s+jadi|ingin\s+jadi)\b/i.test(normalized) &&
      /\b(?:data\s+analyst|digital\s+marketing?|analyst|marketer|programmer|bisnis|teknologi|prodi|jurusan)\b/i.test(normalized)) ||
    (/\b(?:prodi|jurusan)\s+(?:apa\s+yang\s+)?relevan\b/i.test(normalized)) ||
    (hasFitSignals && /\b(?:prodi|jurusan|program\s*studi|kuliah|masuk\s+mana)\b/i.test(normalized))
  );

  if (isRecommendationInquiry) {
    return {
      domain: 'ACADEMIC_RECOMMENDATION',
      intent: 'PROGRAM_RECOMMENDATION',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_PROGRAM_RECOMMENDATION',
      aspects: ['recommendation', 'program_fit'],
      relation: 'PROGRAM_RECOMMENDATION'
    };
  }

  // 6a. Available Academic Programs List (Generic query across all programs)
  const hasProgramConcept = /\b(?:program\s*(?:studi|sarjana|diploma|magister|doktor)?|jurusan|prodi|fakultas|jenjang|pilihan\s+kuliah|kuliah|study\s+programs?|majors?|departments?|facult(?:y|ies)|(?:undergraduate|bachelor|master|postgraduate|doctoral|doctorate|phd|diploma|degree|academic|study)\s+programs?|s1|s2|s3|d3|d4)(?:nya)?\b/i.test(normalized);
  const hasListingConcept = /\b(?:apa\s+saja|ada\s+apa|pilihan|daftar|list|opsi|tersedia|bisa\s+ambil\s+apa|punya|mau\s+lihat|pilihannya|apa|what(?:\s+are|\s+is)?|which|available|offered|offer|options?)\b/i.test(normalized);
  const hasScopeConcept = /\b(?:pascasarjana|magister|sarjana|diploma|undergraduate|postgraduate|master|bachelor)\b/i.test(normalized);

  const isAvailableProgramsInquiry = !isRecommendationInquiry && !hasSpecificProgramEntity && !hasStudentOrgEntity && hasProgramConcept && (hasListingConcept || hasScopeConcept) &&
    !/\b(?:biaya|bayar|daftar\s+ulang|syarat|akreditasi|kurikulum|matkul|beasiswa|lokasi|jadwal|bingung|rekomendasi|rekomendasikan|cocok|saran|minat|relevan|data\s+analyst|digital\s+marketer|ingin\s+menjadi|cara\s+daftar|caranya\s+gimana|alur|prosedur|(?:mau|mw|pengen|ingin|bisa)\s+daftar|himpunan|himaprodi|hima|ukm|ormawa|fee|fees|cost|tuition|scholarship|requirements?)\b/i.test(normalized);

  if (isAvailableProgramsInquiry) {
    const scopeResolution = resolveAcademicScope(normalized + ' ' + raw);
    let scopeLevel = 'ALL';
    if (scopeResolution.status === ACADEMIC_SCOPE_STATUS.SUPPORTED) {
      scopeLevel = scopeResolution.level;
    } else if (scopeResolution.status === ACADEMIC_SCOPE_STATUS.UNSUPPORTED) {
      scopeLevel = 'UNSUPPORTED';
    }

    return {
      domain: 'ACADEMIC_PROGRAM',
      intent: 'AVAILABLE_PROGRAMS_LIST',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_PROGRAMS_LIST',
      aspects: ['program_list', 'degrees'],
      relation: `AVAILABLE_PROGRAMS_${scopeLevel}`,
      scopeLevel,
      academicScope: scopeResolution
    };
  }

  // 7. Program Overview / Definition / Profile / Career / Degree (Generic across academic programs)
  const hasAcademicProgram = entities.some(e => e.family === 'academic_program' || e.type === 'program');
  // Program leadership is a property of the already-resolved academic entity,
  // not a second entity and not a generic helpdesk contact request.
  const asksProgramLeadership = /\b(?:siapa\s+(?:yang\s+)?(?:menjadi\s+)?(?:ketua|kepala|koordinator|pimpinan)|(?:ketua|kepala|koordinator|pimpinan)\s+(?:prodi|program\s+studi|jurusan)|diampu\s+(?:oleh\s+)?siapa|who\s+(?:is|leads?)\s+(?:the\s+)?(?:head|chair|leader)|who\s+heads?)\b/i.test(normalized);
  if (hasAcademicProgram && asksProgramLeadership) {
    return {
      domain: 'ACADEMIC_PROGRAM',
      intent: 'PROGRAM_OVERVIEW',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_PROGRAM_OVERVIEW',
      aspects: ['overview', 'leadership', 'contact'],
      relation: 'PROGRAM_LEADERSHIP'
    };
  }
  const hasStudentOrg = entities.some(e => e.family === 'student_organization') || /\b(himpunan\s+mahasiswa|himaprodi|hima\b|ukm\b|ormawa)\b/i.test(normalized);
  const isFeeInquiry = /\b(?:biaya|bayar|uang|dana\s+(?:kuliah|pendidikan|didik)|ukt|spp|dpp|tarif|cicilan|harga|cost|fee)\b/i.test(normalized + ' ' + raw);
  const isStudyModeInquiry = /\b(kuliah\s+sore|kelas\s+sore|kelas\s+karyawan|kuliah\s+malam|untuk\s+yang\s+bekerja|sambil\s+kerja|kelas\s+malam|kuliah\s+sambil\s+kerja)\b/i.test(normalized + ' ' + raw);
  const isScheduleOrAdmissionInquiry = isStudyModeInquiry || /\b(?:jadwal|gelombang|syarat|persyaratan|cara\s+daftar|pendaftaran|kurikulum|mata\s+kuliah|matkul|semester|beasiswa|akreditasi)\b/i.test(normalized);
  if (!isFeeInquiry && !isScheduleOrAdmissionInquiry && !hasStudentOrg && ((/\b(apa\s+itu|pengertian|definisi|profil|tentang|penjelasan|jelas(?:kan)?|deskripsi|gambaran|belajar\s+apa|mempelajari\s+apa|fokus(?:nya)?(?:\s+apa|\s+jurusan)?|kuliah\s+tentang\s+apa|prospek(?:nya)?|peluang\s+kerja|lulusan(?:nya)?\s+(?:bisa\s+)?jadi\s+apa|lulusan|kerja\s+(?:sebagai\s+|menjadi\s+)?apa|bekerja\s+(?:sebagai\s+|menjadi\s+)?apa|jadi\s+apa|profesi|karir|karier|gelar(?:nya)?|(?:ingin|mau)\s+tahu\s+(?:tentang\s+)?(?:prodi|program\s*studi|jurusan)?|(?:info|informasi)\s+(?:tentang|lengkap|seputar)\s+(?:prodi|program\s*studi|jurusan)?|(?:apakah\s+)?(?:ada|tersedia)\s+(?:program|prodi|jurusan)?|kalau|kalo|bagaimana|gimana)\b/i.test(normalized) && hasAcademicProgram) ||
    (/\b(apa\s+itu\s+program\s+studi|profil\s+prodi|profil\s+program\s+studi|gambaran\s+program\s+studi|gambaran\s+prodi)\b/i.test(normalized)))) {
    const isDegreeInquiry = /\b(gelar(?:nya)?)\b/i.test(normalized);
    const isCareerInquiry = /\b(prospek(?:nya)?|peluang\s+kerja|karir|karier|profesi|lulusan.*(?:kerja|bekerja)|(?:kerja|bekerja)\s+di\s*mana)\b/i.test(normalized);
    return {
      domain: 'ACADEMIC_PROGRAM',
      intent: isDegreeInquiry ? 'DEGREE_AWARD' : (isCareerInquiry ? 'CAREER_PROSPECTS_INQUIRY' : 'PROGRAM_OVERVIEW'),
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: isDegreeInquiry ? 'PROVIDE_DEGREE_INFO' : (isCareerInquiry ? 'PROVIDE_CAREER_PROSPECTS' : 'PROVIDE_PROGRAM_OVERVIEW'),
      aspects: isDegreeInquiry ? ['degree_award', 'overview'] : (isCareerInquiry ? ['career_prospects'] : ['overview', 'definition']),
      relation: isDegreeInquiry ? 'DEGREE_AWARD' : (isCareerInquiry ? 'CAREER_PROSPECTS' : 'PROGRAM_OVERVIEW')
    };
  }

  // Live Enrollment / Intake Status for current year (No. 58: Kampus ini menerima mahasiswa baru tahun ini?)
  if (/\b(?:menerima\s+mahasiswa\s+baru\s+tahun\s+ini|buka\s+pmb\s+tahun\s+ini|menerima\s+maba\s+tahun\s+ini)\b/i.test(normalized)) {
    return {
      domain: 'PMB',
      intent: 'CURRENT_ENROLLMENT_STATUS',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_CURRENT_ENROLLMENT_STATUS',
      aspects: ['current_wave_status', 'schedule'],
      relation: 'CURRENT_ENROLLMENT_STATUS'
    };
  }

  // 8. Dynamic Quota / Live Enrollment Availability (Priority over static study mode)
  if (/\b(kuota|sisa kuota|daya tampung|masih menerima pendaftar|masih menerima|masih ada kuota)\b/i.test(normalized)) {
    return {
      domain: 'ADMISSION_QUOTA',
      intent: 'LIVE_QUOTA_INQUIRY',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_LIVE_STATUS',
      aspects: ['quota', 'dynamic_availability', 'live_status'],
      relation: 'LIVE_ENROLLMENT_AVAILABILITY'
    };
  }

  // 8b. Student Count / Campus Population Inquiry
  if (/\b(?:jumlah|total|banyaknya)\s+mahasiswa(?:\s+(?:aktif|yang\s+sedang\s+kuliah|kuliah))?\b/i.test(normalized) ||
    /\b(?:berapa\s+(?:banyak\s+)?mahasiswa(?:\s+yang\s+(?:sedang\s+)?kuliah)?)\b/i.test(normalized) ||
    /\bmahasiswa\b.*?\b(?:ada\s+berapa|berapa\s+banyak|jumlahnya\s+berapa)\b/i.test(normalized)) {
    return {
      domain: 'CAMPUS_INFO',
      intent: 'STUDENT_COUNT_INQUIRY',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_STUDENT_COUNT_INFO',
      aspects: ['student_count', 'campus_statistics'],
      relation: 'CAMPUS_STATISTICS'
    };
  }

  // 9. Study Mode / Class Schedule / Working Students
  if (/\b(kuliah sore|kelas sore|kelas karyawan|kuliah malam|untuk yang bekerja|sambil kerja|kelas malam|kuliah sambil kerja)\b/i.test(normalized)) {
    return {
      domain: 'ACADEMIC_PROGRAM',
      intent: 'STUDY_MODE',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_STUDY_MODE_INFO',
      aspects: ['class_schedule', 'working_students', 'evening_class'],
      relation: 'PROGRAM_STUDY_MODE'
    };
  }

  // 10. Scholarship Inquiry
  const isNegatedScholarshipOrDpp = /\b(?:tidak\s+(?:perlu|usah)|bukan|tanpa|jangan)\b.*?\b(?:potongan\s+dpp|dpp|beasiswa)\b/i.test(normalized);
  const isScholarshipKeyword = !isNegatedScholarshipOrDpp && (entities.some(e => e.family === 'scholarship') ||
    /\b(beasiswa(?:nya)?|kip\s*kuliah|kip-?k|potongan\s+dpp|keringanan\s+biaya|bantuan\s+dana\s+pendidikan)\b/i.test(normalized)) ||
    (/\b(?:potongan|diskon|tambahan)\b/i.test(normalized) && /\b(?:tambahan\s+\d+%|\d+%\s*dpp|digabung|akumulasi|kombinasi|tumpuk)\b/i.test(normalized)) ||
    (/\b(?:digabung|akumulasi|kombinasi)\b/i.test(normalized) && /\b(?:potongan|gelombang|tambahan|60%)\b/i.test(normalized));

  if (isScholarshipKeyword) {
    return {
      domain: 'SCHOLARSHIP',
      intent: 'SCHOLARSHIP_INQUIRY',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_SCHOLARSHIP_INFO',
      aspects: ['scholarship', 'requirements', 'discount'],
      relation: 'SCHOLARSHIP_INFO'
    };
  }

  // 11. Organization & UKM Inquiry
  const isStudentOrgKeyword = /\b(ukm\b|unit\s+kegiatan\s+mahasiswa|organisasi\s+mahasiswa|ormawa|hima\b|himaprodi|senat\s+mahasiswa|balma|ekstrakurikuler|student\s+clubs?|student\s+organizations?|campus\s+clubs?)\b/i.test(normalized);
  const isActivityInterest = /\b(gaming|game|gamer|esport|esports|e-sports|olahraga|olah\s*raga|sports?|futsal|basket|badminton|bulutangkis|paduan\s+suara|teater|tari|musik|music|band|robotik|ksl)\b/i.test(normalized);
  const isJoinVerb = /\b(?:bergabung|gabung|join)\b/i.test(normalized);
  const candidateDomain = sessionData?.activeDomain || sessionData?.lastDomain || sessionData?.data?.activeDomain || sessionData?.data?.lastDomain || null;

  if (entities.some(e => e.family === 'student_organization') ||
    isStudentOrgKeyword ||
    (isActivityInterest && (isStudentOrgKeyword || /\b(?:suka|minat|hobi|bakat|passion)\b/i.test(normalized) || !/\b(?:prodi|jurusan|kuliah|s1|d3|s2)\b/i.test(normalized))) ||
    (isJoinVerb && (candidateDomain === 'ORGANIZATION_UKM' || isStudentOrgKeyword))) {
    const isEsports = /\b(gaming|game|gamer|esport|esports|e-sports)\b/i.test(normalized);
    const isSport = /\b(olahraga|olah\s*raga|sports?|futsal|basket|bulutangkis|badminton|fitness|gym)\b/i.test(normalized);
    const isArts = /\b(seni|budaya|tari|musik|music|band|teater|paduan\s+suara|fotografi)\b/i.test(normalized);
    const isTech = /\b(penalaran|robotika|linux|coding|pemrograman|syntax)\b/i.test(normalized);

    const aspects = ['student_organization', 'activities', 'ukm'];
    let relation = 'STUDENT_ORGANIZATION';
    if (isEsports) {
      aspects.push('esports_gaming');
      relation = 'UKM_ESPORTS_GAMING';
    } else if (isSport) {
      aspects.push('sports');
      relation = 'UKM_SPORTS';
    } else if (isArts) {
      aspects.push('arts_culture');
      relation = 'UKM_ARTS_CULTURE';
    } else if (isTech) {
      aspects.push('reasoning_tech');
      relation = 'UKM_REASONING_TECH';
    }

    if (!entities.some(e => e.family === 'student_organization')) {
      const namedUkmMatch = normalized.match(/\b(?:ukm|unit\s+kegiatan\s+mahasiswa)\s+(?:olahraga\s+|seni\s+|kebudayaan\s+|bidang\s+)?([a-z]+(?:\s+[a-z]+)?)(?:\s+(?:di\s+stikom|di\s+itb|di\s+bali|di\s+kampus|berapa|apa|syarat|ada|atau|jika)|$)/i);
      if (namedUkmMatch && namedUkmMatch[1]) {
        const candUkm = namedUkmMatch[1].trim();
        const STOP_ORG = new Set([
          'apa', 'saja', 'aja', 'ada', 'tidak', 'gak', 'nggak', 'bukan', 'itu', 'ini',
          'yang', 'dan', 'atau', 'olahraga', 'seni', 'budaya', 'teknologi', 'kerohanian',
          'buka', 'punya', 'tersedia', 'sih', 'kah', 'ya', 'kan', 'dong', 'mana'
        ]);
        const tokens = candUkm.split(/\s+/);
        const hasSubstantiveToken = tokens.every(t => !STOP_ORG.has(t) && t.length >= 3);
        if (hasSubstantiveToken) {
          const known = findCanonicalEntity(candUkm) || findCanonicalEntity('UKM ' + candUkm);
          if (!known) {
            entities.push({
              canonical: 'UKM ' + candUkm,
              rawMention: candUkm,
              type: 'student_activity_unit',
              family: 'student_organization',
              isUnverified: true
            });
          }
        }
      }
    }

    const isMembershipCheck = /\b(?:apakah\s+.*?\s+termasuk|termasuk\s+(?:ukm|kategori|bidang)|is\s+.*?\s+(?:a|part\s+of)\b)/i.test(normalized) ||
      /\b(?:apakah\s+.*?\s+termasuk|termasuk\s+(?:ukm|kategori|bidang)|is\s+.*?\s+(?:a|part\s+of)\b)/i.test(raw);

    const orgTerm = '(?:unit\\s+kegiatan\\s+mahasiswa|ormawa|ukm|organisasi)';
    const orgListRe = new RegExp('(?:apa\\s+(?:saja\\s+)?' + orgTerm + '|' + orgTerm + '\\s+(?:ada\\s+)?apa\\s+saja|daftar\\s+(?:seluruh\\s+)?' + orgTerm + '|ada\\s+' + orgTerm + '\\s+apa)', 'i');
    const isOrgList = orgListRe.test(normalized) || orgListRe.test(raw);

    let orgIntent = 'ORGANIZATION_INQUIRY';
    if (isMembershipCheck) {
      orgIntent = 'ORGANIZATION_MEMBERSHIP_CHECK';
      aspects.push('membership', 'category');
      relation = 'UKM_MEMBERSHIP_CHECK';
    } else if (isOrgList) {
      orgIntent = 'ORGANIZATION_LIST';
      aspects.push('ukm_list');
      relation = 'ORGANIZATION_LIST';
    }

    return {
      domain: 'ORGANIZATION_UKM',
      intent: orgIntent,
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_ORGANIZATION_INFO',
      aspects,
      relation
    };
  }

  // 12. Facilities Inquiry (Infrastructure, lab, library, dormitory, hall/aula, parking)
  if (/\b(fasilitas(?:nya)?|laboratorium(?:nya)?|lab(?:nya)?|perpustakaan|asrama|dormitory|ruang\s+kelas|gedung\s+kampus|aula|gedung\s+aula|gedung\s+serbaguna|auditorium|hall|sewa\s+gedung|facilit(?:y|ies)|laborator(?:y|ies)|computer\s+lab(?:s|oratories)?|practical\s+(?:it\s+)?classes|campus\s+facilities|classrooms?|parkir(?:an)?|parking)\b/i.test(normalized)) {
    const targetBranch = /\brenon\b/i.test(normalized) ? 'renon' : (/\bjimbaran\b/i.test(normalized) ? 'jimbaran' : (/\babiansemal\b/i.test(normalized) ? 'abiansemal' : null));
    const facilityAspects = ['facilities', 'lab', 'campus_infrastructure'];
    if (targetBranch) {
      facilityAspects.push(`branch_${targetBranch}`);
    }
    if (/\b(tarif|biaya|sewa|harga|bayar|fee|fees|rent|rental|cost|price)\b/i.test(normalized)) {
      facilityAspects.push('fee', 'sewa_gedung');
    }
    return {
      domain: 'FACILITIES',
      intent: 'FACILITY_INQUIRY',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_FACILITY_INFO',
      aspects: facilityAspects,
      targetBranch,
      relation: 'CAMPUS_FACILITIES'
    };
  }

  // 13. Tuition Fee / Biaya Kuliah (Prioritized before PMB schedule when cost/fee is asked)
  const hasScheduleOrCalendarFocus = /\b(?:kapan|tanggal|jadwal|periode|kalender|buka|dibuka|ditutup|tutup|batas\s+(?:waktu|pendaftaran)|apa\s+saja|daftar\s+gelombang|pembagian\s+gelombang)\b/i.test(normalized);
  const hasFeeFocus = /\b(?:biaya|potongan|diskon|total|dpp|spp|bayar|uang\s+kuliah|dana\s+(?:kuliah|pendidikan|didik)|ukt|uang\s+gedung|angsuran|cicilan|pengeluaran)\b/i.test(normalized + ' ' + raw);
  const isAdmissionScheduleOrStatus = !isFeeInquiry && !hasFeeFocus && (
    /\b(?:sekarang\s+buka|buka\s+gelombang|buka\s+pendaftaran|kapan\s+(?:buka|dibuka|ditutup|tutup)|jadwal\s+(?:gelombang|pendaftaran|pmb)|periode\s+(?:gelombang|pendaftaran)|kalender\s+pmb|gelombang\s+berapa)\b/i.test(normalized) ||
    (/\bgelombang\b/i.test(normalized) && (hasScheduleOrCalendarFocus || /\bpmb\b/i.test(normalized)))
  );

  const isWaveFeeFollowup = !isAdmissionScheduleOrStatus && !hasScheduleOrCalendarFocus && (
    (/\b(?:kalau\s+|kalo\s+)?gelombang\s*(?:[1-4]|i{1,4}|[0-9]+[a-z]?|khusus|awal|sisipan)\s*(?:berapa|biaya(?:nya)?|potongan(?:nya)?|diskon(?:nya)?|dpp(?:nya)?|total(?:nya)?)\b/i.test(normalized)) ||
    (/\bgelombang\s*(?:[1-4]|i{1,4}|[0-9]+[a-z]?|khusus|awal|sisipan)\b/i.test(normalized) && hasFeeFocus) ||
    ((sessionData?.activeDomain === 'TUITION_FEE' || Boolean(sessionData?.activeEntity)) &&
      /\b(?:kalau\s+|kalo\s+)gelombang\s*(?:[1-4]|i{1,4}|[0-9]+[a-z]?|khusus|awal|sisipan)\s*(?:berapa|gimana|bagaimana)?$/i.test(normalized))
  );

  const isProgramComparison = /\b(bandingkan|perbandingan|komparasi|versus|vs)\b/i.test(normalized);
  if (!isProgramComparison && (isWaveFeeFollowup || /\b(biaya(?:nya)?|biaya\s+kuliah|spp(?:nya)?|dpp(?:nya)?|uang\s+kuliah(?:nya)?|dana\s+(?:kuliah|pendidikan|didik)(?:nya)?|ukt\b|uang\s+pangkal|uang\s+gedung|biaya\s+gedung|bayar\s+kuliah|bayar\s+berapa|angsuran|potongan\s+biaya|diskon(?:nya)?|potongan(?:nya)?|keringanan(?:nya)?|cicilan|(?:di)?cicil(?:an)?|angsur(?:an)?|pengeluaran(?:nya)?|tarif|harga|murah(?:an)?|mahal(?:an)?|terjangkau|tuition(?:\s+fee)?|tuition\s+cost|cost\s+of\s+study|fees?|fee\s+per\s+semester|semester\s+fee|pay\s+each\s+semester|installment)\b/i.test(normalized + ' ' + raw))) {
    const isInstallmentProcedure =
      /\b(?:syarat|persyaratan|prosedur|tata\s*cara|cara(?:\s+mengajukan)?|bagaimana\s+mengajukan|pengajuan|dokumen|berkas|formulir)\b/i.test(normalized) &&
      /\b(?:di)?(?:cicil(?:an)?|angsur(?:an)?|mengangsur)\b/i.test(normalized);

    if (isInstallmentProcedure) {
      return {
        domain: 'TUITION_FEE',
        intent: 'INSTALLMENT_PROCEDURE_INQUIRY',
        retrievalRequired: true,
        userState: 'INQUIRING',
        desiredAction: 'PROVIDE_INSTALLMENT_PROCEDURE_INFO',
        aspects: ['installment_procedure', 'installment_requirements', 'requirements', 'procedure'],
        relation: 'INSTALLMENT_PROCEDURE'
      };
    }

    const feeAspects = ['fee', 'dpp', 'tuition'];
    if (isWaveFeeFollowup) {
      feeAspects.push('wave_discount');
    }
    if (/\b(komponen|rincian|unsur|apa\s+saja|components?|details?|breakdown)\b/i.test(normalized)) {
      feeAspects.push('components');
    }
    if (/\b(?:di)?(?:cicil(?:an)?|angsur(?:an)?|installment)\b/i.test(normalized)) {
      feeAspects.push('installment');
    }
    return {
      domain: 'TUITION_FEE',
      intent: 'TUITION_FEE_INQUIRY',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_TUITION_FEE_INFO',
      aspects: feeAspects,
      relation: 'TUITION_FEE'
    };
  }

  const isPmbSelectionContext = /\b(?:pmb|pendaftaran|seleksi)\b/i.test(normalized);
  if (!isPmbSelectionContext && /\b(?:sks|jumlah\s+sks|sks\s+lulus|beban\s+sks|beban\s+studi|kelulusan|tugas\s+akhir|skripsi|credits?|total\s+credits?|graduation|graduating|graduate|final\s+project|thesis|defense|final\s+project\s+defense|thesis\s+defense|academic\s+requirements?|graduation\s+requirements?)\b/i.test(normalized) &&
    !/\b(?:biaya|bayar|daftar\s+ulang|tuition|fees?)\b/i.test(normalized)) {
    const isGuidanceProcedure = /\b(?:tahapan|tahap|pelaksanaan|bimbingan|pembimbing|dosen\s+pembimbing|pedoman|buku\s+pedoman|alur|prosedur|proposal|sidang|procedure|stages?|guidance|advisor|advisors?|supervision|supervisor|defen[sd]e?|prerequisites?|complete|finish)\b/i.test(normalized) &&
      !/\b(?:berapa|jumlah\s+sks|total\s+sks|minimal\s+sks|sks\s+minimal|batas\s+sks|how\s+many\s+credits)\b/i.test(normalized);

    if (isGuidanceProcedure) {
      return {
        domain: 'ACADEMIC_CURRICULUM',
        intent: 'THESIS_GUIDANCE_PROCEDURE',
        retrievalRequired: true,
        userState: 'INQUIRING',
        desiredAction: 'PROVIDE_THESIS_GUIDANCE_INFO',
        aspects: ['guidance_procedure', 'thesis_stages', 'curriculum'],
        relation: 'THESIS_GUIDANCE'
      };
    }

    return {
      domain: 'ACADEMIC_CURRICULUM',
      intent: 'GRADUATION_REQUIREMENTS',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_CURRICULUM_REQUIREMENTS',
      aspects: ['sks_count', 'graduation_rule', 'curriculum'],
      relation: 'DEGREE_REQUIREMENT'
    };
  }

  // 14b. Academic Events & Ceremonies (Yudisium, Wisuda, Academic Calendar)
  const isDegreeInquiry = /\b(?:gelar(?:\s+apa|nya)?|title)\b/i.test(normalized);
  const isWisudaOrYudisium = !isDegreeInquiry && (entities.some(e => e.canonical === 'Yudisium' || e.canonical === 'Wisuda') ||
    /\b(?:yudisium|wisuda)\b/i.test(normalized));
  if (isWisudaOrYudisium) {
    return {
      domain: 'ACADEMIC_EVENT',
      intent: 'GRADUATION_INQUIRY',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_GRADUATION_INFO',
      aspects: ['procedure', 'requirements'],
      relation: 'ACADEMIC_GRADUATION'
    };
  }

  const hasAcademicEvent = !isDegreeInquiry && (entities.some(e => e.type === 'academic_event') ||
    /\b(?:uas|uts|ujian\s+akhir\s+semester|ujian\s+tengah\s+semester|kalender\s+akademik|jadwal\s+(?:pengisian\s+)?krs|kapan\s+(?:pengisian\s+)?krs|pengisian\s+krs)\b/i.test(normalized));
  if (hasAcademicEvent) {
    return {
      domain: 'ACADEMIC_SCHEDULE',
      intent: 'ACADEMIC_EVENT_SCHEDULE',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_SCHEDULE_INFO',
      aspects: ['schedule'],
      relation: 'ACADEMIC_EVENT_SCHEDULE'
    };
  }

  // 14c. Class / Lecture Schedule (Jadwal Kuliah / Waktu Kuliah)
  if (/\b(?:jadwal\s+kuliah|jam\s+kuliah|waktu\s+kuliah|jadwal\s+belajar)\b/i.test(normalized)) {
    return {
      domain: 'ACADEMIC_SCHEDULE',
      intent: 'CLASS_SCHEDULE_INQUIRY',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_SCHEDULE_INFO',
      aspects: ['schedule', 'class_schedule'],
      relation: 'CLASS_SCHEDULE'
    };
  }

  // 15. Admission / PMB Schedule & General Topic Opener
  const isScholarshipOrFeeDiscounts = /\b(?:potongan\s+gelombang|tambahan\s+\d+%|digabung|kombinasi|akumulasi|beasiswa|potongan\s+dpp)\b/i.test(normalized);
  const isDirectContactInquiry = /\b(?:kontak(?:nya)?|nomor(?:nya)?|telepon|telp|whatsapp|wa|narahubung|contact|call\s*center|hotline)\b/i.test(normalized);
  if (!isScholarshipOrFeeDiscounts && !isDirectContactInquiry && (/\b(?:pmb|pendaftaran|mendaftar|tes\s+seleksi|ujian\s+seleksi|testing\s+seleksi|pengumuman\s+(?:hasil\s+)?seleksi|daftar\s+(?:kuliah|online|ulang|pmb|mahasiswa|stikom)|syarat|persyaratan|dokumen|berkas|gelombang|masih dibuka|kapan buka|jalur pendaftaran|mulai dari mana|proses masuk|cara masuk)\b/i.test(normalized) ||
    (/\b(?:daftar|mendaftar)\b/i.test(normalized) && !/\b(?:daftar\s+harga|daftar\s+menu|daftar\s+matkul|daftar\s+mata\s+kuliah|daftar\s+prodi|daftar\s+jurusan|daftar\s+program)\b/i.test(normalized)) ||
    isPmbContext)) {
    const isWhenQuestion = /\b(?:kapan|sampai\s+kapan)\b/i.test(normalized);
    const isNow = TEMPORAL_NOW_REGEX.test(normalized) || /\b(?:status\s+pendaftaran|status\s+pmb|sudah\s+dibuka|masih\s+dibuka|masih\s+bisa\s+daftar|daftar\s+hari\s+ini)\b/i.test(normalized);
    if (isNow && !isWhenQuestion && /\b(?:gelombang|buka|dibuka|ditutup|tutup|jadwal|periode|status|daftar)\b/i.test(normalized)) {
      return {
        domain: 'PMB',
        intent: 'CURRENT_ENROLLMENT_STATUS',
        retrievalRequired: true,
        userState: 'INQUIRING',
        desiredAction: 'PROVIDE_PMB_STATUS',
        aspects: ['schedule', 'status', 'wave_info'],
        relation: 'ADMISSION_WINDOW'
      };
    }

    const isTestingOrAnnouncementOrDeadline = /\b(?:tes|testing|ujian|pengumuman|batas\s+akhir|penutupan)\b/i.test(normalized);
    const isProcedureOrRequirements = !isTestingOrAnnouncementOrDeadline && !isWhenQuestion && (
      /\b(?:cara\s+(?:daftar|mendaftar)|bagaimana\s+(?:cara\s+)?(?:daftar|mendaftar)|boleh\s+(?:daftar|mendaftar)|bisa\s+(?:daftar|mendaftar|masuk|kuliah)|apakah\s+(?:boleh|bisa)\s+mendaftar|syarat|persyaratan|dokumen|berkas|alur|prosedur|mulai\s+dari\s+mana|proses\s+masuk|cara\s+masuk)\b/i.test(normalized) ||
      /\b(?:(?:saya\s+)?(?:mau|mw|pengen|ingin|bisa)\s+daftar|daftar\s+(?:pmb|kuliah|stikom))\b/i.test(normalized)
    );
    const isAdmissionStages = /\b(?:tahap(?:an)?|jadwal|kalender|gelombang|periode|kapan)\b/i.test(normalized);
    const isTopicOpener = isProcedureOrRequirements ||
      /\b(saya\s+ingin\s+bertanya\s+tentang\s+pmb|mau\s+tanya\s+pmb|info\s+pmb|tentang\s+pmb|informasi\s+pmb|bagaimana\s+pmb|pendaftaran\s+stikom|daftar\s+stikom)\b/i.test(normalized) ||
      (!isAdmissionStages && /\b(pmb|pendaftaran)\b/i.test(normalized) && !/\b(biaya|bayar|kurikulum|beasiswa|kontak|nomor|telepon|telp|whatsapp|wa|hotline)\b/i.test(normalized));

    if (isTopicOpener) {
      const baseAspects = isProcedureOrRequirements ? ['procedure', 'requirements', 'documents'] : ['admission_overview', 'procedure', 'admission_pathways'];
      if (isAdmissionStages && !baseAspects.includes('schedule')) {
        baseAspects.push('schedule', 'wave_info');
      }
      return {
        domain: 'PMB',
        intent: isProcedureOrRequirements ? 'ADMISSION_PROCEDURE' : 'GENERAL_PMB_INQUIRY',
        retrievalRequired: true,
        userState: 'INQUIRING',
        desiredAction: isProcedureOrRequirements ? 'PROVIDE_ADMISSION_PROCEDURE' : 'PROVIDE_GENERAL_PMB_OVERVIEW',
        aspects: baseAspects,
        relation: 'PMB_OVERVIEW'
      };
    }

    return {
      domain: 'PMB',
      intent: 'ADMISSION_SCHEDULE',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_PMB_STATUS',
      aspects: ['schedule', 'status', 'wave_info', 'stages'],
      relation: 'ADMISSION_WINDOW'
    };
  }

  // 14. Program Comparison (Perbedaan Prodi)
  const hasProgramEntity = entities.some(e => e.family === 'academic_program' || e.type === 'program');
  if (/\b(perbedaan|beda|bedanya|banding(?:kan)?|dibandingkan|komparasi|difference|differ|compare|comparison|versus|vs|mana\s+yang\s+lebih|lebih\s+[\w\s]{1,30}?\s*(?:yang\s+)?mana|pilih\s+mana)\b/i.test(normalized) &&
    (/\b(prodi|jurusan|program\s+studi|program|programs|majors?|courses?)\b/i.test(normalized) || hasProgramEntity || entities.length >= 2)) {
    const compAspects = ['curriculum_difference', 'career_prospects'];
    if (/\b(?:biaya|tarif|spp|dpp|harga|murah|mahal)\b/i.test(normalized)) {
      compAspects.push('fee');
    }
    return {
      domain: 'ACADEMIC_PROGRAM',
      intent: 'PROGRAM_COMPARISON',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_PROGRAM_DIFFERENTIATION',
      aspects: compAspects,
      relation: 'PROGRAM_COMPARISON'
    };
  }

  // 15. Accreditation
  if (/\b(akreditasi|terakreditasi|ban-?pt|lam-?infokom|accreditation|accredited)\b/i.test(normalized)) {
    const isProdi = entities.some(e => e.family === 'academic_program' || e.type === 'program') || /\b(prodi|jurusan|program studi|s1|d3|s2|bachelor|master|diploma)\b/i.test(normalized);
    return {
      domain: isProdi ? 'ACADEMIC_PROGRAM' : 'INSTITUTIONAL',
      intent: isProdi ? 'PROGRAM_ACCREDITATION' : 'INSTITUTIONAL_ACCREDITATION',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_ACCREDITATION_STATUS',
      aspects: ['akreditasi', 'peringkat', 'sk_akreditasi'],
      relation: isProdi ? 'PROGRAM_ACCREDITATION' : 'INSTITUTIONAL_ACCREDITATION'
    };
  }

  // 16. Facilities & Laboratory Inquiries
  if (/\b(?:fasilitas|laboratorium|lab|sarana|prasarana|perpustakaan|asrama|facilit(?:y|ies)|laborator(?:y|ies)|library|dormitory|practical\s+(?:it\s+)?classes|parkir(?:an)?|parking)\b/i.test(normalized) ||
    /\b(?:fasilitas|laboratorium|lab|sarana|prasarana|perpustakaan|asrama|facilit(?:y|ies)|laborator(?:y|ies)|library|dormitory|practical\s+(?:it\s+)?classes|parkir(?:an)?|parking)\b/i.test(unstemmed)) {
    return {
      domain: 'FACILITIES',
      intent: 'FACILITY_INQUIRY',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_FACILITIES_INFO',
      aspects: ['facilities', 'lab', 'campus_infrastructure'],
      relation: 'CAMPUS_FACILITIES'
    };
  }

  // 17. Student Development & Soft Skills Inquiries
  if (/\b(?:soft\s*skills?|pengembangan\s+(?:soft\s*skills?|karakter|mahasiswa)|pelatihan\s+soft\s*skills?|program\s+pengembangan\s+mahasiswa|career\s+center|pusat\s+karier|cdc)\b/i.test(normalized) ||
    /\b(?:soft\s*skills?|pengembangan\s+(?:soft\s*skills?|karakter|mahasiswa)|pelatihan\s+soft\s*skills?|program\s+pengembangan\s+mahasiswa|career\s+center|pusat\s+karier|cdc)\b/i.test(unstemmed)) {
    return {
      domain: 'CAMPUS_SERVICE',
      intent: 'STUDENT_DEVELOPMENT_INQUIRY',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_STUDENT_DEVELOPMENT_INFO',
      aspects: ['facilities', 'activities', 'campus_service'],
      relation: 'CAMPUS_SERVICE'
    };
  }

  // 17b. Language Learning Center (LLC) Inquiries
  if (entities.some(e => /language\s+learning\s+center|llc/i.test(e.canonical || e.name || '')) ||
    /\b(?:llc|language\s+learning\s+center)\b/i.test(normalized)) {
    return {
      domain: 'CAMPUS_SERVICE',
      intent: 'CAMPUS_SERVICE_INQUIRY',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_SERVICE_INFO',
      aspects: ['facilities', 'campus_service'],
      relation: 'CAMPUS_SERVICE'
    };
  }

  // 18. Contact & Helpdesk Inquiries
  if (/\b(?:kontak(?:nya)?|nomor(?:nya)?|telepon|telp|whatsapp|wa|narahubung|contact|call\s*center|hotline)\b/i.test(normalized) ||
    /\b(?:kontak(?:nya)?|nomor(?:nya)?|telepon|telp|whatsapp|wa|narahubung|contact|call\s*center|hotline)\b/i.test(unstemmed)) {
    return {
      domain: 'CAMPUS_SERVICE',
      intent: 'CONTACT_INQUIRY',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_CONTACT_INFO',
      aspects: ['contact', 'phone', 'whatsapp'],
      relation: 'CAMPUS_SERVICE'
    };
  }

  // Target campus branch check
  const targetBranch = /\brenon\b/i.test(normalized) ? 'renon' : (/\bjimbaran\b/i.test(normalized) ? 'jimbaran' : (/\babiansemal\b/i.test(normalized) ? 'abiansemal' : null));

  // Proximity & Nearest Campus Comparison Inquiry
  // If an explicit target branch is specified (e.g., "Kampus Jimbaran di mana?"), this is a SINGLE branch inquiry, not a proximity comparison across campuses.
  const isAskingProximity = !targetBranch && (
    /\b(?:lebih\s+dekat\s+kampus\s+mana|kampus\s+mana\s+(?:yang\s+)?(?:lebih\s+)?dekat|jarak\s+terdekat|lebih\s+dekat\s+(?:ke\s+)?mana)\b/i.test(normalized) ||
    (/\b(?:lebih\s+dekat|paling\s+dekat|terdekat)\b/i.test(normalized) && /\b(?:kampus|cabang|stikom)\b/i.test(normalized)) ||
    Boolean(
      (sessionData.isProximityComparison || sessionData.activeAspects?.includes('proximity_comparison')) &&
      (/\b(?:kalau|kalo|bagaimana|gimana|gmn|dari)\b/i.test(normalized)) &&
      !/\b(?:prodi|jurusan|program\s+studi|biaya|beasiswa|wisuda|jadwal)\b/i.test(normalized)
    )
  );

  // 19. Campus Location / Address / Count Inquiry
  const queryWithoutProximity = stripProximityModifiers(normalized);
  const rawWithoutProximity = stripProximityModifiers(raw);

  const isAskingCampusLocation = isAskingProximity ||
    /\b(?:lokasi\s+kampus|alamat\s+kampus|kampus(?:nya)?\s+di\s*mana|dimana\s+kampus|letak\s+kampus|gedung\s+kampus\s+di\s*mana|kampus\s+renon|kampus\s+jimbaran|kampus\s+abiansemal)\b/i.test(normalized) ||
    ((/\b(?:lokasi|alamat|di\s*mana|dimana)\b/i.test(normalized)) &&
      (/\b(?:kampus|stikom|itb\s+stikom)\b/i.test(queryWithoutProximity) || /\b(?:kampus|stikom|itb\s+stikom)\b/i.test(rawWithoutProximity))) ||
    (/\b(?:berapa\s+(?:ada\s+)?kampus|ada\s+berapa\s+kampus|berapa\s+jumlah\s+kampus|jumlah\s+kampus|berapa\s+banyak\s+kampus|berapa\s+(?:ada\s+)?cabang|ada\s+berapa\s+cabang)\b/i.test(normalized)) ||
    (/\b(?:berapa\s+ada|ada\s+berapa|berapa\s+jumlah|berapa\s+banyak)\b/i.test(normalized) && /\b(?:kampus|cabang)\b/i.test(normalized)) ||
    (/\b(?:lokasi(?:nya)?\s+di\s*mana(?:\s+saja)?|di\s*mana(?:\s+saja)?\s+lokasi(?:nya)?|dimana(?:\s+saja)?\s+lokasi(?:nya)?|lokasi(?:nya)?\s+mana\s+saja)\b/i.test(raw + ' ' + normalized) &&
      (/\b(?:kampus|stikom|itb\s+stikom)\b/i.test(queryWithoutProximity) || /\b(?:kampus|stikom|itb\s+stikom)\b/i.test(rawWithoutProximity))) ||
    ((sessionData.activeDomain === 'FACILITIES' || sessionData.activeIntent === 'CAMPUS_LOCATION' || (sessionData.activeEntity && (sessionData.activeEntity.family === 'campus_location' || sessionData.activeEntity.type === 'campus' || String(sessionData.activeEntity).toLowerCase().includes('kampus')))) &&
      /\b(?:lokasi|alamat|di\s*mana|dimana|cabang|ada\s+berapa|berapa\s+ada)\b/i.test(normalized));

  if (isAskingCampusLocation) {
    const userOrigin = extractUserOriginLocation(raw + ' ' + normalized, sessionData);
    const isAllLocations = isAskingProximity || (!targetBranch && /\b(?:semua|seluruh|lengkap|daftar|berapa|ada\s+berapa|berapa\s+ada|mana\s+saja|di\s*mana(?:\s+saja)?)\b/i.test(raw + ' ' + normalized));
    const aspects = ['location', 'campus_location', 'address'];
    if (isAllLocations) aspects.push('all_locations');
    if (isAskingProximity) aspects.push('proximity_comparison');
    return {
      domain: 'FACILITIES',
      intent: 'CAMPUS_LOCATION',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_LOCATION_INFO',
      aspects,
      locationScope: isAllLocations ? 'ALL' : (targetBranch ? 'SINGLE' : 'GENERAL'),
      targetBranch,
      isProximityComparison: isAskingProximity,
      userOrigin,
      relation: 'CAMPUS_LOCATION'
    };
  }

  // Check institutional grounding for general inquiries
  const strippedForGrounding = stripProximityModifiers(normalized);
  const hasInstitutionalGrounding = entities.length > 0 ||
    INSTITUTIONAL_ANCHOR_REGEX.test(strippedForGrounding) ||
    INSTITUTIONAL_ANCHOR_REGEX.test(stripProximityModifiers(raw));

  if (!hasInstitutionalGrounding) {
    // Check if query is an alternative options follow-up (No. 406 "Ada pilihan lainnya?")
    if (/^(?:(?:ada\s+)?pilihan\s+(?:lain(?:nya)?|alternatif)|(?:ada\s+)?opsi\s+lain(?:nya)?|kalau\s+pilihan\s+lain(?:nya)?)\??$/i.test(normalized)) {
      return {
        domain: 'GENERAL',
        intent: 'ALTERNATIVE_OPTIONS_INQUIRY',
        retrievalRequired: false,
        userState: 'INQUIRING',
        desiredAction: 'ASK_CLARIFICATION',
        aspects: ['alternative_options'],
        relation: 'FOLLOW_UP_ALTERNATIVE'
      };
    }

    // Check if query is an ambiguous comparative without options, procedural without context, or anaphoric program reference
    const isAmbiguousComparison = /^(?:(?:pilih|mending|bagusan?|bagus|unggul|cocok|tepat|baik|enak|recomended|direkomendasikan)\s+(?:yang\s+)?mana|(?:yang\s+mana|mana\s+yang)\s+(?:lebih\s+)?(?:bagus|baik|cocok|tepat|unggul|recomended|direkomendasikan|bagusan|oke|pas|enak)|lebih\s+(?:bagus|baik|cocok|unggul|oke)\s+mana|apa\s+(?:per)?bedaan(?:nya)?|(?:per)?bedaa?n(?:nya)?\s+apa)\??$/i.test(normalized) ||
      (/\b(?:yang\s+mana|mana\s+yang)\s+(?:lebih\s+)?(?:bagus|baik|cocok|tepat|unggul|bagusan)\b/i.test(normalized));

    const isAmbiguousProcedure = /^(?:(?:bagaimana|gimana)\s+(?:cara|proses|alur|langkah|tahapan)(?:nya)?|(?:cara|proses|alur|langkah|tahapan)(?:nya)?\s+(?:bagaimana|gimana)|bagaimana\s+caranya|gimana\s+caranya)\??$/i.test(normalized);

    const isAmbiguousEllipsis = /^(?:(?:kalau|kalo|bagaimana(?:\s+dengan)?|gimana(?:\s+dengan)?)\s+(?:program\s+)?(?:satu(?:nya)?|lain(?:nya)?)|program\s+satu(?:nya)?)\??$/i.test(normalized);

    if (isAmbiguousComparison || isAmbiguousProcedure || isAmbiguousEllipsis ||
      /^(?:itu\s+berapa|kapan\s+mulainya|kalau\s+begitu\s+bagaimana|ai|apa\s+maksudnya)\??$/i.test(normalized) ||
      (normalized.split(' ').length <= 3 && /\b(?:itu|begitu|kapan|berapa|ai)\b/i.test(normalized))) {
      return {
        domain: 'GENERAL',
        intent: 'AMBIGUOUS_CLARIFICATION',
        retrievalRequired: false,
        userState: 'INQUIRING',
        desiredAction: 'ASK_CLARIFICATION',
        aspects: ['ambiguous_clarification'],
        relation: isAmbiguousComparison ? 'AMBIGUOUS_COMPARISON' : 'AMBIGUOUS'
      };
    }

    return {
      domain: 'OUT_OF_DOMAIN',
      intent: 'OUT_OF_DOMAIN_INQUIRY',
      retrievalRequired: false,
      userState: 'INQUIRING',
      desiredAction: 'REFUSE_OUT_OF_DOMAIN',
      aspects: ['general'],
      relation: 'OUT_OF_DOMAIN'
    };
  }

  // Default General Ingestion
  return {
    domain: 'GENERAL',
    intent: 'GENERAL_INQUIRY',
    retrievalRequired: true,
    userState: 'INQUIRING',
    desiredAction: 'PROVIDE_INFORMATION',
    aspects: ['general'],
    relation: 'GENERAL'
  };
}

/**
 * Resolves a raw user query into a clean, complete SemanticFrame.
 */
function resolveSemanticFrame(rawQuery, sessionData = {}, options = {}) {
  const raw = String(rawQuery || '').trim();
  const normalized = normalizeQueryText(raw);
  const positiveRawQuery = stripNegatedAspectPhrases(raw);
  const positiveNormalizedQuery = normalizeQueryText(positiveRawQuery);
  const positiveUnstemmedQuery = positiveRawQuery
    .toLowerCase()
    .replace(/[?!,.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const unstemmedQuery = raw
    .toLowerCase()
    .replace(/[?!,.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 1. Check Context Dependency (Pronoun or Genuine Ellipsis)
  const contextDep = evaluateContextDependency(raw, sessionData);

  // 2. Extract Canonical Entities & Deduplicate by Canonical
  let canonicalMatches = filterNegatedCanonicalEntities(raw, matchCanonicalEntities(normalized)) || [];

  // Sort canonical matches strictly by their occurrence position in the user's query text (normalized, fallback raw)
  // to preserve natural ordinal sequence ("yang pertama", "yang kedua", etc.)
  if (canonicalMatches.length > 1) {
    const normLower = normalized.toLowerCase();
    const rawLower = raw.toLowerCase();
    canonicalMatches.sort((a, b) => {
      const aTarget = (a.matchedAlias || a.canonical || '').toLowerCase();
      const bTarget = (b.matchedAlias || b.canonical || '').toLowerCase();
      let aPos = normLower.indexOf(aTarget);
      if (aPos < 0) aPos = rawLower.indexOf(aTarget);
      if (aPos < 0) aPos = 999999;
      let bPos = normLower.indexOf(bTarget);
      if (bPos < 0) bPos = rawLower.indexOf(bTarget);
      if (bPos < 0) bPos = 999999;
      return aPos - bPos;
    });
  }

  const seenEntities = new Map();
  for (const m of canonicalMatches || []) {
    const key = m.canonical.toLowerCase().trim();
    if (!seenEntities.has(key)) {
      seenEntities.set(key, {
        canonical: m.canonical,
        type: m.type,
        family: m.family
      });
    } else {
      const existing = seenEntities.get(key);
      if (!existing.family && m.family) existing.family = m.family;
      if (!existing.type && m.type) existing.type = m.type;
    }
  }
  let entities = Array.from(seenEntities.values());

  // Prune generic institutional campus entity when a specific branch campus is identified
  const hasSpecificBranch = entities.some(e =>
    (e.family === 'campus_location' || e.type === 'campus') &&
    e.canonical !== 'Kampus ITB STIKOM Bali'
  );
  if (hasSpecificBranch) {
    entities = entities.filter(e => e.canonical !== 'Kampus ITB STIKOM Bali');
  }

  // 2b. Separate primary targets from modifier entities (admission_track, participant_scope, academic_scope)
  const MODIFIER_FAMILIES = new Set(['admission_track', 'participant_scope', 'academic_scope']);
  const PRIMARY_FAMILIES = new Set(['academic_program', 'international_program', 'campus_service', 'student_organization', 'facility', 'campus_facility']);

  const primaryEntities = entities.filter(e => PRIMARY_FAMILIES.has(e.family) || (!MODIFIER_FAMILIES.has(e.family) && e.type !== 'academic_scope'));
  const modifierEntities = entities.filter(e => MODIFIER_FAMILIES.has(e.family));

  let effectiveTargetEntities = entities;
  let modifiers = [];

  if (primaryEntities.length > 0 && modifierEntities.length > 0) {
    // If a primary entity exists (e.g. S1 Sistem Informasi), modifier entities (e.g. Jalur Reguler)
    // act as structured constraints rather than competing entities causing false ambiguity.
    effectiveTargetEntities = primaryEntities;
    modifiers = modifierEntities;
  }

  // 2c. Context Inheritance before Domain Inference & OOD check
  // Invariant: Campus-wide facilities/UKM or Conversational MUST NOT inherit academic program entities
  const isCampusWideQuery = /\b(?:fasilitas|laboratorium|lab|perpustakaan|asrama|parkir|ukm|ormawa|organisasi|inbis|career\s+center|cdc)\b/i.test(positiveNormalizedQuery);
  const isContactQuery = /\b(?:kontak(?:nya)?|nomor(?:\s+telepon|\s+wa|\s+whatsapp|\s+hp|\s+kontak)?(?:nya)?|telepon(?:nya)?|telp(?:nya)?|whatsapp(?:nya)?|wa(?:nya)?|call\s*center|hotline|narahubung(?:nya)?)\b/i.test(positiveRawQuery);
  const isConversationalQuery = /^(?:halo|hai|pagi|siang|sore|malam|terima\s+kasih|makasih|oke|siap)\b/i.test(normalized);

  if (contextDep.isEntityCorrection && contextDep.inheritedEntity) {
    const correctedCanon = findCanonicalEntity(contextDep.inheritedEntity);
    if (correctedCanon) {
      effectiveTargetEntities = [{
        canonical: correctedCanon.canonical,
        type: correctedCanon.type,
        family: correctedCanon.family,
        corrected: true
      }];
    }
  } else if (effectiveTargetEntities.length === 0 && contextDep.shouldInherit && !isCampusWideQuery && !isContactQuery && !isConversationalQuery) {
    if (Array.isArray(contextDep.inheritedEntities) && contextDep.inheritedEntities.length > 0) {
      for (const ie of contextDep.inheritedEntities) {
        const inheritedCanon = findCanonicalEntity(ie);
        if (inheritedCanon && !effectiveTargetEntities.some(e => e.canonical === inheritedCanon.canonical)) {
          effectiveTargetEntities.push({
            canonical: inheritedCanon.canonical,
            type: inheritedCanon.type,
            family: inheritedCanon.family,
            inherited: true
          });
        }
      }
    } else if (contextDep.inheritedEntity) {
      const inheritedCanon = findCanonicalEntity(contextDep.inheritedEntity);
      if (inheritedCanon && (inheritedCanon.family === 'academic_program' || inheritedCanon.family === 'international_program' || inheritedCanon.family === 'campus_location' || inheritedCanon.type === 'campus')) {
        effectiveTargetEntities.push({
          canonical: inheritedCanon.canonical,
          type: inheritedCanon.type,
          family: inheritedCanon.family,
          inherited: true
        });
      }
    }
  }

  // Check for partial entity ambiguity when no canonical entity could be resolved
  const { resolvePartialEntityInContext } = require('./contextResolver');
  const partialEntityRes = effectiveTargetEntities.length === 0
    ? resolvePartialEntityInContext(positiveRawQuery, sessionData)
    : null;
  if (effectiveTargetEntities.length === 0 && partialEntityRes && partialEntityRes.resolved && partialEntityRes.entity) {
    const resolvedCanon = findCanonicalEntity(partialEntityRes.entity);
    if (resolvedCanon) {
      effectiveTargetEntities.push({
        canonical: resolvedCanon.canonical,
        type: resolvedCanon.type,
        family: resolvedCanon.family,
        inherited: true
      });
    }
  }

  if (effectiveTargetEntities.length === 0 && (contextDep.inheritedIntent === 'CAMPUS_LOCATION' || contextDep.inheritedEntity === 'Kampus ITB STIKOM Bali' || (contextDep.shouldInherit && contextDep.inheritedDomain === 'FACILITIES'))) {
    // Only inherit campus entity if query does not already have specific academic/international program entities
    const hasExplicitProgramEntity = entities.some(e => e.family === 'academic_program' || e.family === 'international_program');
    if (!hasExplicitProgramEntity) {
      effectiveTargetEntities.push({
        canonical: 'Kampus ITB STIKOM Bali',
        type: 'campus',
        family: 'campus_location',
        inherited: true
      });
    }
  }

  // 3. Temporal Resolution
  const isCurrent = TEMPORAL_NOW_REGEX.test(positiveNormalizedQuery);
  const academicYearMatch = positiveRawQuery.match(/\b(?:tahun\s+(?:akademik|ajaran)|t\.?a\.?)\s*:?\s*(\d{4}\s*\/\s*\d{4})\b/i) ||
    positiveRawQuery.match(/\b(20\d{2}\s*\/\s*20\d{2})\b/);
  const detectedAcademicYear = academicYearMatch ? academicYearMatch[1].replace(/\s+/g, '') : null;

  // Separate historical academicYear from effective turn academicYear:
  // Only inherit if context dependency explicitly permits inheritance for the current turn
  const inheritedAcademicYear = contextDep.shouldInherit
    ? (contextDep.inheritedAcademicYear || sessionData.academicYear || null)
    : null;
  const effectiveAcademicYear = detectedAcademicYear || inheritedAcademicYear;

  const temporal = {
    isCurrentConstraint: isCurrent,
    constraint: isCurrent ? 'NOW' : 'GENERAL',
    academicYear: effectiveAcademicYear
  };

  // 4. Infer Domain & Intent
  const inferred = inferDomainAndIntent(positiveNormalizedQuery, effectiveTargetEntities, sessionData, positiveUnstemmedQuery, positiveRawQuery);

  let domain = inferred.domain;
  let intent = inferred.intent;

  if (contextDep.isAmbiguous && effectiveTargetEntities.length === 0) {
    domain = 'GENERAL';
    intent = 'AMBIGUOUS_CLARIFICATION';
    inferred.desiredAction = 'ASK_CLARIFICATION';
    inferred.retrievalRequired = false;
  }

  // Entity-Switch Ellipsis Inheritance:
  // When the user switches the target entity via ellipsis (e.g. "Kalau yang S1 Bisnis Digital?", "Bagaimana dengan D3 MI?")
  // without specifying a new attribute, inferDomainAndIntent defaults to PROGRAM_OVERVIEW / GENERAL_INQUIRY / INTERNATIONAL_PROGRAM_INFO.
  // We must inherit the active domain, intent, and aspects from the prior turn!
  const isDefaultEntityOverviewIntent = intent === 'PROGRAM_OVERVIEW' || intent === 'GENERAL_INQUIRY' || intent === 'INTERNATIONAL_PROGRAM_INFO';
  const isEntitySwitchEllipsis = Boolean(
    contextDep.shouldInherit &&
    (contextDep.reason === 'genuine_ellipsis' || contextDep.isEntityCorrection || contextDep.reason === 'ordinal_entity_reference') &&
    effectiveTargetEntities.length > 0 &&
    isDefaultEntityOverviewIntent
  );

  if (contextDep.shouldInherit && contextDep.inheritedDomain) {
    if (contextDep.inheritedDomain === 'FACILITIES' && (domain === 'GENERAL' || domain === 'OUT_OF_DOMAIN')) {
      domain = 'FACILITIES';
      intent = contextDep.inheritedIntent || sessionData.activeIntent || 'CAMPUS_LOCATION';
    } else if (contextDep.inheritedDomain === 'ACADEMIC_EVENT' && !/\b(?:pmb|mahasiswa\s+baru|calon\s+mahasiswa|kuliah\s+di|masuk\s+stikom)\b/i.test(normalized)) {
      domain = 'ACADEMIC_EVENT';
      intent = 'GRADUATION_INQUIRY';
    } else if (contextDep.inheritedDomain === 'PMB') {
      if (domain === 'GENERAL' || domain === 'OUT_OF_DOMAIN' || isEntitySwitchEllipsis) {
        domain = 'PMB';
        intent = contextDep.inheritedIntent || sessionData.activeIntent || 'GENERAL_PMB_INQUIRY';
      } else if (intent === 'ADMISSION_SCHEDULE') {
        domain = 'PMB';
      }
    } else if (contextDep.inheritedDomain === 'SCHOLARSHIP') {
      domain = 'SCHOLARSHIP';
      intent = 'SCHOLARSHIP_INQUIRY';
    } else if (contextDep.inheritedDomain === 'ACADEMIC_CURRICULUM' && (domain === 'GENERAL' || domain === 'OUT_OF_DOMAIN' || isEntitySwitchEllipsis || contextDep.reason === 'curriculum_continuation')) {
      domain = 'ACADEMIC_CURRICULUM';
      intent = contextDep.inheritedIntent || 'CURRICULUM_INQUIRY';
      inferred.desiredAction = 'PROVIDE_CURRICULUM_INFO';
      inferred.relation = 'PROGRAM_CURRICULUM';
    } else if (domain === 'GENERAL' || domain === 'OUT_OF_DOMAIN' || isEntitySwitchEllipsis) {
      domain = contextDep.inheritedDomain;
      const priorIntent = contextDep.inheritedIntent || sessionData.activeIntent;
      if (priorIntent) {
        intent = priorIntent;
      } else if (domain === 'TUITION_FEE' || /\b(?:biaya|spp|dpp|tarif|uang\s+kuliah)\b/i.test(sessionData.lastQuery || '')) {
        domain = 'TUITION_FEE';
        intent = 'TUITION_FEE_INQUIRY';
      } else if (/\b(?:fakultas|faculty|dekan)\b/i.test(sessionData.lastQuery || '')) {
        domain = 'ACADEMIC_PROGRAM';
        intent = 'FACULTY_INQUIRY';
      } else if (/\b(?:akreditasi|terakreditasi|ban-?pt|lam-?infokom)\b/i.test(sessionData.lastQuery || '')) {
        domain = 'ACADEMIC_PROGRAM';
        intent = 'PROGRAM_ACCREDITATION';
      } else if (/\b(?:total\s+sks|jumlah\s+sks|berapa\s+sks|beban\s+studi)\b/i.test(sessionData.lastQuery || '')) {
        domain = 'ACADEMIC_PROGRAM';
        intent = 'GRADUATION_REQUIREMENTS';
      }
    }
  }

  // If the query is not a facilities/campus location query, "Kampus ITB STIKOM Bali" or "ITB STIKOM Bali"
  // represents the parent institution, NOT a physical branch restriction that filters out institutional fee/scholarship/PMB chunks.
  if (domain !== 'FACILITIES' && intent !== 'CAMPUS_LOCATION') {
    effectiveTargetEntities = effectiveTargetEntities.map(e => {
      if (e.canonical === 'Kampus ITB STIKOM Bali') {
        return { ...e, family: 'institution', type: 'institution' };
      }
      return e;
    });
  }

  // If PMB domain and academicYear still null, keep null unless stated in evidence
  if (domain === 'PMB' && !temporal.academicYear) {
    temporal.academicYear = null;
  }

  // Ensure campus entity is present for genuine CAMPUS_LOCATION inquiries without overriding academic entities
  if (intent === 'CAMPUS_LOCATION' || domain === 'FACILITIES') {
    const hasAcademicEntity = effectiveTargetEntities.some(e => e.family === 'academic_program' || e.family === 'international_program');
    if (!hasAcademicEntity && !effectiveTargetEntities.some(e => e.family === 'campus_location' || e.type === 'campus')) {
      if (inferred.targetBranch === 'jimbaran') {
        effectiveTargetEntities.push({ canonical: 'Kampus Jimbaran', type: 'campus', family: 'campus_location' });
      } else if (inferred.targetBranch === 'abiansemal') {
        effectiveTargetEntities.push({ canonical: 'Kampus Abiansemal', type: 'campus', family: 'campus_location' });
      } else if (inferred.targetBranch === 'renon') {
        effectiveTargetEntities.push({ canonical: 'Kampus Denpasar (Renon)', type: 'campus', family: 'campus_location' });
      } else {
        effectiveTargetEntities.push({
          canonical: 'Kampus ITB STIKOM Bali',
          type: 'campus',
          family: 'campus_location',
          inherited: true
        });
      }
    }
  }

  // Extract Academic Level through the shared academic-scope normalizer so natural
  // Indonesian forms (e.g. 'strata dua') and English/number aliases use one contract.
  const explicitAcademicScope = resolveAcademicScope(positiveNormalizedQuery);
  let academicLevel = explicitAcademicScope.status === ACADEMIC_SCOPE_STATUS.SUPPORTED
    ? explicitAcademicScope.level
    : null;
  if (!academicLevel) {
    if (effectiveTargetEntities.some(e => /^(?:S2)\b|magister/i.test(e.canonical || ''))) {
      academicLevel = 'S2';
    } else if (effectiveTargetEntities.some(e => /^S1\b/i.test(e.canonical || ''))) {
      academicLevel = 'S1';
    } else if (effectiveTargetEntities.some(e => /^D3\b/i.test(e.canonical || ''))) {
      academicLevel = 'D3';
    } else if (/\b(?:s[- ]?3|strata\s*(?:[- ]?3|tiga)|doktor(?:al)?|doctor(?:ate)?|ph\.?d|d[- ]?4|diploma\s*[- ]?4|diploma\s*[- ]?iv|sarjana\s+terapan)\b/i.test(positiveNormalizedQuery)) {
      academicLevel = 'UNSUPPORTED';
    }
  }

  // Re-align S1 Sistem Informasi to S2 Sistem Informasi if academic level is S2
  if (academicLevel === 'S2') {
    effectiveTargetEntities = effectiveTargetEntities.map(e => {
      if (e.canonical === 'S1 Sistem Informasi') {
        const s2Entry = findCanonicalEntity('S2 Sistem Informasi');
        return s2Entry ? { canonical: s2Entry.canonical, type: s2Entry.type, family: s2Entry.family, degree: 'S2' } : e;
      }
      return e;
    });
  }

  // Inject degree scope entity for available programs list if no entity present
  if (inferred.intent === 'AVAILABLE_PROGRAMS_LIST' && effectiveTargetEntities.length === 0) {
    if (inferred.scopeLevel === 'S1') {
      effectiveTargetEntities.push({ canonical: 'Program Sarjana (S1)', type: 'academic_scope', family: 'academic_scope', degree: 'S1' });
    } else if (inferred.scopeLevel === 'S2') {
      effectiveTargetEntities.push({ canonical: 'Program Pascasarjana (S2)', type: 'academic_scope', family: 'academic_scope', degree: 'S2' });
    } else if (inferred.scopeLevel === 'D3') {
      effectiveTargetEntities.push({ canonical: 'Program Diploma (D3)', type: 'academic_scope', family: 'academic_scope', degree: 'D3' });
    }
  }

  // Handle faculty entities for FACULTY_INQUIRY
  if (intent === 'FACULTY_INQUIRY') {
    effectiveTargetEntities = effectiveTargetEntities.filter(e => e.type !== 'academic_scope' && e.family !== 'academic_scope');
    const { resolveFaculty } = require('./academicCatalog');
    const fac = resolveFaculty(positiveRawQuery);
    if (fac && !effectiveTargetEntities.some(e => e.canonical === fac.canonical)) {
      effectiveTargetEntities.push({
        canonical: fac.canonical,
        type: 'faculty',
        family: 'academic_faculty',
        shortName: fac.shortName
      });
    }
  }

  // Detect additional requested aspects
  const combinedAspects = new Set(inferred.aspects || []);
  if (isEntitySwitchEllipsis && Array.isArray(contextDep.inheritedAspects)) {
    for (const asp of contextDep.inheritedAspects) {
      combinedAspects.add(asp);
    }
  }
  if (isEntitySwitchEllipsis && intent === 'TUITION_FEE_INQUIRY') {
    combinedAspects.add('fee');
    combinedAspects.add('tuition');
    combinedAspects.add('dpp');
  } else if (isEntitySwitchEllipsis && intent === 'FACULTY_INQUIRY') {
    combinedAspects.add('faculty');
    combinedAspects.add('academic_structure');
  } else if (isEntitySwitchEllipsis && intent === 'PROGRAM_ACCREDITATION') {
    combinedAspects.add('akreditasi');
    combinedAspects.add('accreditation');
  }
  const isDocumentOrCalendarAccess = /\b(?:kalender\s+akademik|jadwal\s+kuliah|krs|silabus|kurikulum)\b/i.test(normalized);

  const fullQueryContext = `${normalized} ${unstemmedQuery}`;
  const isApplicantSchoolBackground = /\b(?:lulusan|tamatan|alumni|dari)\s+(?:sma|smk|ma|paket\s+[abc]|sekolah)\b/i.test(fullQueryContext);
  const isCareerOrWorkContext = !isApplicantSchoolBackground && /\b(?:kerja|bekerja|pekerjaan|karir|karier|profesi|prospek(?:nya)?|peluang\s+kerja|lulusan.*(?:kerja|bekerja|jadi\s+apa|profesi)|(?:kerja|bekerja)\s+di\s*mana)\b/i.test(fullQueryContext);
  const isInternshipContext = /\b(?:magang(?:nya)?|praktek|praktik|pkl|internship)\b/i.test(fullQueryContext);
  const isAdmissionTestContext = /\b(?:tes(?:\s+pmb|\s+masuk|\s+seleksi)?|ujian(?:\s+pmb|\s+masuk|\s+seleksi)?|seleksi(?:\s+pmb|\s+masuk)?)\b/i.test(fullQueryContext) ||
    (/\b(?:tes|ujian|seleksi)\b/i.test(fullQueryContext) && /\b(?:pmb|masuk|daftar|pendaftaran)\b/i.test(fullQueryContext));
  const isExplicitCampusLocationQuery = /\b(?:kampus(?:nya)?|cabang|alamat(?:nya)?|gedung|renon|jimbaran|abiansemal|tempat\s+kuliah|tempat\s+studi|lokasi\s+kampus)\b/i.test(fullQueryContext);

  const hasLocationKeyword = /\b(di\s*mana|dimana|lokasi(?:nya)?|tempat\s+kuliah|tempat\s+studi|alamat(?:nya)?|berada\s+di\s*mana)\b/i.test(normalized) ||
    /\b(di\s*mana|dimana|lokasi|tempat\s+kuliah|tempat\s+studi|alamat|berada\s+di\s*mana)\b/i.test(unstemmedQuery);

  if (!isDocumentOrCalendarAccess && hasLocationKeyword) {
    if (isCareerOrWorkContext && !isExplicitCampusLocationQuery) {
      combinedAspects.add('career_prospects');
    } else if (isInternshipContext && !isExplicitCampusLocationQuery) {
      combinedAspects.add('internship');
    } else if (isAdmissionTestContext && !isExplicitCampusLocationQuery) {
      combinedAspects.add('admission_test_location');
      combinedAspects.add('admission_procedure');
    } else {
      combinedAspects.add('location');
      combinedAspects.add('campus_location');
    }
  }

  if (isCareerOrWorkContext) {
    combinedAspects.add('career_prospects');
  }
  if (isInternshipContext) {
    combinedAspects.add('internship');
  }
  if (/\b(fakultas|faculty)\b/i.test(normalized) || /\b(fakultas|faculty)\b/i.test(unstemmedQuery)) {
    combinedAspects.add('faculty');
    combinedAspects.add('academic_structure');
  }
  if (/\b(prospek(?:nya)?|peluang\s+kerja|karir|karier|profesi\s+lulusan)\b/i.test(normalized) ||
    /\b(prospek|peluang\s+kerja|karir|karier|profesi\s+lulusan)\b/i.test(unstemmedQuery)) {
    combinedAspects.add('career_prospects');
  }
  const isFeeContext = domain === 'TUITION_FEE' || domain === 'FINANCIAL_ADMISSION' || intent === 'TUITION_FEE_INQUIRY' || combinedAspects.has('fee') || combinedAspects.has('dpp') || /\b(?:biaya|spp|dpp|tarif|uang\s+(?:kuliah|pangkal|gedung))\b/i.test(unstemmedQuery);
  const hasExplicitCurriculumTerm = /\b(kurikulum(?:nya)?|mata\s*kuliah|matkul|(?:apa\s+yang\s+)?dipelajari|pembelajaran|materi\s+kuliah|pelajaran|fokus\s+keilmuan|fokus\s+pembelajaran|bidang\s+keilmuan)\b/i.test(normalized + ' ' + unstemmedQuery);

  if (domain === 'ACADEMIC_CURRICULUM' || intent === 'CURRICULUM_INQUIRY' || hasExplicitCurriculumTerm || (!isFeeContext && /\bsks\b/i.test(normalized + ' ' + unstemmedQuery))) {
    combinedAspects.add('curriculum');
    combinedAspects.add('courses');
  }
  if (/\b(biaya(?:nya)?|spp|dpp|uang\s+pangkal|uang\s+gedung|biaya\s+gedung|bayar)\b/i.test(normalized) ||
    /\b(biaya|spp|dpp|uang\s+pangkal|uang\s+gedung|biaya\s+gedung|bayar)\b/i.test(unstemmedQuery) ||
    contextDep.reason === 'fee_continuation' ||
    (contextDep.isEntityCorrection && contextDep.inheritedDomain === 'TUITION_FEE')) {
    combinedAspects.add('fee');
    combinedAspects.add('dpp');
    combinedAspects.add('tuition');
  }
  if (contextDep.isEntityCorrection && Array.isArray(contextDep.inheritedAspects)) {
    contextDep.inheritedAspects.forEach(a => combinedAspects.add(a));
  }
  const isNegatingScholarshipOrDpp = /\b(?:tidak\s+(?:perlu|usah)|bukan|tanpa|jangan)\b.*?\b(?:potongan\s+dpp|dpp|beasiswa)\b/i.test(normalized);
  if (!isNegatingScholarshipOrDpp && (/\b(beasiswa(?:nya)?|potongan\s+dpp|keringanan)\b/i.test(normalized) ||
    /\b(beasiswa|potongan\s+dpp|keringanan)\b/i.test(unstemmedQuery))) {
    combinedAspects.add('scholarship');
  }
  if (/\b(fasilitas(?:nya)?|lab\b|laboratorium)\b/i.test(normalized) ||
    /\b(fasilitas|lab\b|laboratorium)\b/i.test(unstemmedQuery)) {
    combinedAspects.add('facilities');
  }
  if (/\b(akreditasi(?:nya)?|terakreditasi|ban-?pt|lam-?infokom)\b/i.test(normalized) ||
    /\b(akreditasi|terakreditasi|ban-?pt|lam-?infokom)\b/i.test(unstemmedQuery)) {
    combinedAspects.add('akreditasi');
    combinedAspects.add('accreditation');
  }
  const finalAspects = filterNegatedSemanticAspects(raw, Array.from(combinedAspects));

  const isAcademicDomain = ['ACADEMIC_PROGRAM', 'ACADEMIC_CURRICULUM', 'UNSUPPORTED_PROGRAM', 'GENERAL'].includes(domain);
  const unsupp = isAcademicDomain ? (inferred.unsupportedEntityName || inferred.unsupportedProgramName || detectUnsupportedProgram(positiveNormalizedQuery, effectiveTargetEntities)) : null;
  const isUnsupported = Boolean((inferred.unsupportedEntity || inferred.isUnsupportedEntity || unsupp || domain === 'UNSUPPORTED_PROGRAM') && isAcademicDomain);
  const unsupportedName = isUnsupported ? (unsupp || inferred.unsupportedProgramName || 'tersebut') : null;

  const isMultiTarget = effectiveTargetEntities.length > 1 && (
    /\b(?:dan|serta|maupun|dan\s+juga|keduanya|dua-?duanya|masing-?masing)\b/i.test(normalized) ||
    contextDep.reason === 'ordinal_entity_reference'
  );

  const academicScope = inferred.academicScope || resolveAcademicScope(raw);
  const effectiveScopeLevel = academicScope.status === ACADEMIC_SCOPE_STATUS.UNSUPPORTED
    ? 'UNSUPPORTED'
    : (academicScope.status === ACADEMIC_SCOPE_STATUS.SUPPORTED
      ? academicScope.level
      : (inferred.scopeLevel || (intent === 'AVAILABLE_PROGRAMS_LIST' ? (academicLevel || 'ALL') : null)));

  const hasPartialAmbiguity = Boolean(partialEntityRes && partialEntityRes.isAmbiguous && effectiveTargetEntities.length === 0);
  const frameAmbiguityLevel = hasPartialAmbiguity ? 'HIGH' : 'LOW';
  const frameConfidence = hasPartialAmbiguity ? 0.45 : 1.0;

  const oldFrame = composeSemanticElements({
    rawQuery: raw,
    normalizedQuery: normalized,
    academicLevel,
    academicScope,
    scopeLevel: effectiveScopeLevel,
    domain,
    intent,
    userInterest: null,
    semanticConcepts: [],
    isAmbiguous: hasPartialAmbiguity,
    ambiguityLevel: frameAmbiguityLevel,
    confidence: frameConfidence,
    candidateEntities: hasPartialAmbiguity ? (partialEntityRes.candidateEntities || []) : [],
    retrievalRequired: inferred.retrievalRequired !== false,
    entities: effectiveTargetEntities,
    modifiers,
    constraints: {
      admissionTrack: modifiers.find(m => m.family === 'admission_track')?.canonical || null,
      participantScope: modifiers.find(m => m.family === 'participant_scope')?.canonical || null
    },
    isMultiTarget,
    relation: inferred.relation,
    locationScope: inferred.locationScope || (inferred.targetBranch ? 'SINGLE' : (finalAspects.includes('all_locations') ? 'ALL' : 'GENERAL')),
    targetBranch: inferred.targetBranch || null,
    isProximityComparison: Boolean(inferred.isProximityComparison || (!inferred.targetBranch && sessionData.isProximityComparison && contextDep.shouldInherit)),
    userOrigin: inferred.userOrigin || extractUserOriginLocation(raw, sessionData) || null,
    academicYear: temporal.academicYear || null,
    aspects: finalAspects,
    temporal,
    userState: inferred.userState,
    desiredAction: inferred.desiredAction,
    language: detectQueryLanguage(raw),
    subQueries: [],
    contextDependencies: contextDep.shouldInherit ? [contextDep] : [],
    activeEntity: contextDep.shouldInherit ? (contextDep.inheritedEntity || sessionData.activeEntity || null) : null,
    explicitReset: Boolean(contextDep.explicitReset),
    topicContinuity: contextDep.explicitReset ? 'NEW_TOPIC' : (contextDep.shouldInherit ? 'CONTINUATION' : 'INDEPENDENT'),
    unsupportedEntity: isUnsupported,
    unsupportedEntityName: unsupportedName,
    entityResolutionStatus: isUnsupported ? 'UNSUPPORTED' : (hasPartialAmbiguity ? 'AMBIGUOUS' : (effectiveTargetEntities.length > 0 ? 'RESOLVED' : 'UNRESOLVED')),
    isUnsupportedEntity: isUnsupported,
    unsupportedProgramName: unsupportedName
  }, raw, normalized, contextDep, partialEntityRes);

  // Synchronous shadow record if precomputed interpretation provided
  if (options && options.shadowInterpretation) {
    try {
      const validationResult = validateSemanticInterpretation(options.shadowInterpretation, sessionData, options);
      const comparison = compareFrames(raw, oldFrame, options.shadowInterpretation, validationResult);
      recordShadowAudit({
        rawQuery: raw,
        oldFrame,
        newInterpretation: options.shadowInterpretation,
        validatedFrame: validationResult.validatedFrame,
        compatibilityResult: validationResult.compatibilityResult,
        ambiguityResult: validationResult.ambiguityResult,
        firstDifference: comparison.firstDifference,
        failureClassification: comparison.failureClassification,
        differences: comparison.differences
      });
    } catch (e) {
      // Shadow comparison failure must never interrupt active resolver
    }
  }

  // Active production resolver ALWAYS returns the frame with compositional semantic fields
  return oldFrame;
}

/**
 * Builds the compositional semantic structure separating:
 * - speechAct
 * - targetEntities
 * - requestedAttributes
 * - entityRelationships
 * - constraints
 * - informationNeeds
 * - excludedEntities
 * - ambiguity & confidence
 */
function composeSemanticElements(frame, rawQuery = '', normalizedQuery = '', contextDep = {}, partialEntityRes = null) {
  const q = String(rawQuery || frame.rawQuery || '').trim();
  const norm = String(normalizedQuery || frame.normalizedQuery || '').trim();

  // 1. Speech Act
  let speechAct = frame.speechAct || null;
  if (!speechAct) {
    if (frame.domain === 'CONVERSATIONAL') {
      speechAct = 'CONVERSATIONAL';
    } else if (frame.intent === 'PROGRAM_RECOMMENDATION') {
      speechAct = 'REQUEST_RECOMMENDATION';
    } else if (frame.intent === 'PROGRAM_COMPARISON' || frame.isComparison || /\b(?:perbedaan|beda(?:nya)?|banding(?:kan)?|mana\s+yang\s+lebih)\b/i.test(norm)) {
      speechAct = 'REQUEST_COMPARISON';
    } else if (frame.intent === 'ADMISSION_PROCEDURE' || /\b(?:bagaimana\s+cara|cara\s+(?:daftar|mendaftar)|alur|prosedur|langkah|tahapan)\b/i.test(norm)) {
      speechAct = 'REQUEST_PROCEDURE';
    } else if (/^(?:apakah|apa\s+benar|benarkah|bisa(?:\s+nggak|\s+tidak)?|boleh(?:kah)?|ada(?:\s+nggak|\s+tidak)?)\b/i.test(norm)) {
      speechAct = 'QUESTION_YES_NO';
    } else if (!/[?]/.test(q) && /\b(?:saya|aku)\s+(?:suka|minat|hobi|tertarik|lulusan|dari|mau|ingin)\b/i.test(norm) && !/\b(?:apa|berapa|kapan|dimana|di\s*mana|bagaimana|gimana|siapa|mana)\b/i.test(norm)) {
      speechAct = 'STATEMENT_CONTEXT';
    } else {
      speechAct = 'QUESTION_WH';
    }
  }

  // 2. Target Entities
  const targetEntities = Array.isArray(frame.entities) ? frame.entities : [];

  // 3. Requested Attributes (Compositional attribute extraction independent of sentence template)
  const attrSet = new Set(Array.isArray(frame.aspects) ? frame.aspects : []);
  if (frame.intent === 'TUITION_FEE_INQUIRY' || frame.domain === 'TUITION_FEE') {
    attrSet.add('fee');
    attrSet.add('dpp');
    attrSet.add('tuition');
  }
  if (frame.intent === 'FACULTY_INQUIRY') attrSet.add('faculty');
  if (frame.intent === 'PROGRAM_ACCREDITATION' || frame.intent === 'INSTITUTIONAL_ACCREDITATION') attrSet.add('accreditation');
  if (frame.intent === 'CURRICULUM_INQUIRY' || frame.domain === 'ACADEMIC_CURRICULUM') {
    attrSet.add('curriculum');
    attrSet.add('courses');
  }
  if (frame.intent === 'GRADUATION_REQUIREMENTS' || /\b(?:total\s+sks|jumlah\s+sks|berapa\s+sks|beban\s+studi)\b/i.test(norm)) attrSet.add('sks');
  if (frame.intent === 'DEGREE_AWARD') attrSet.add('degree_award');
  if (frame.intent === 'STUDY_MODE') attrSet.add('study_mode');
  if (frame.intent === 'AVAILABLE_PROGRAMS_LIST') attrSet.add('catalog_list');
  if (frame.intent === 'CONTACT_INQUIRY') attrSet.add('contact');
  if (frame.intent === 'CAMPUS_LOCATION') attrSet.add('location');
  if (frame.intent === 'ADMISSION_REQUIREMENTS') attrSet.add('admission_requirements');
  if (frame.intent === 'ADMISSION_SCHEDULE') attrSet.add('admission_schedule');
  if (frame.intent === 'ADMISSION_PROCEDURE') attrSet.add('admission_procedure');
  // Compositional multi-attribute detection from positive query text (for multi-attribute single-entity queries)
  if (frame.domain !== 'CONVERSATIONAL' && frame.domain !== 'OUT_OF_DOMAIN') {
    if (/\b(?:biaya\s+kuliah|rincian\s+biaya|uang\s+kuliah|dana\s+(?:kuliah|pendidikan|didik)|spp\b|dpp\b|tarif\s+kuliah|ukt\b|uang\s+gedung|biaya\s+gedung)\b/i.test(norm + ' ' + q) && !(frame.negatedAspects && frame.negatedAspects.has('fee'))) {
      attrSet.add('fee');
      attrSet.add('dpp');
      attrSet.add('tuition');
    }
    if (/\b(?:akreditasi|terakreditasi|peringkat\s+akreditasi|status\s+akreditasi)\b/i.test(norm) && !(frame.negatedAspects && frame.negatedAspects.has('accreditation'))) {
      attrSet.add('accreditation');
    }
    if (/\b(?:masuk\s+fakultas|fakultas\s+apa|di\s+bawah\s+fakultas|berada\s+di\s+fakultas)\b/i.test(norm)) {
      attrSet.add('faculty');
    }
    if (/\b(?:gelar\s+lulusan|gelar\s+akademik|dapat\s+gelar\s+apa|gelarnya\s+apa)\b/i.test(norm)) {
      attrSet.add('degree_award');
    }
    if (/\b(?:prospek\s+kar(?:i)?er|peluang\s+kar(?:i)?er|peluang\s+kerja|prospek\s+kerja|profesi\s+lulusan|lulusan.*(?:kerja|bekerja)|(?:kerja|bekerja)\s+di\s*mana)\b/i.test(norm)) {
      attrSet.add('career_prospects');
    }
    if (/\b(?:kurikulum(?:nya)?|mata\s+kuliah|matkul|apa\s+saja\s+yang\s+dipelajari|yang\s+dipelajari|belajar\s+apa(?:\s+saja)?)\b/i.test(norm + ' ' + q) && !(frame.negatedAspects && frame.negatedAspects.has('curriculum'))) {
      attrSet.add('curriculum');
      attrSet.add('courses');
    }
    if (/\b(?:kuliah\s+sore|kelas\s+sore|kelas\s+karyawan|kuliah\s+malam|sambil\s+kerja|kelas\s+malam|kuliah\s+sambil\s+kerja)\b/i.test(norm + ' ' + q)) {
      attrSet.add('study_mode');
    }
  }
  if (attrSet.size === 0 && targetEntities.length > 0 && frame.domain === 'ACADEMIC_PROGRAM') {
    attrSet.add('overview');
  }
  const ATTRIBUTE_ORDER_PATTERNS = {
    fee: /\b(?:biaya(?:\s+kuliah)?|rincian\s+biaya|uang\s+kuliah|dana\s+(?:kuliah|pendidikan|didik)|spp\b|dpp\b|tarif\s+kuliah|ukt\b|uang\s+gedung|biaya\s+gedung)\b/i,
    dpp: /\b(?:dpp\b|uang\s+gedung|biaya\s+gedung|dana\s+pengembangan)\b/i,
    accreditation: /\b(?:akreditasi(?:nya)?|terakreditasi|peringkat\s+akreditasi|status\s+akreditasi)\b/i,
    curriculum: /\b(?:kurikulum(?:nya)?|mata\s+kuliah|matkul|apa\s+saja\s+yang\s+dipelajari|yang\s+dipelajari|belajar\s+apa)\b/i,
    sks: /\b(?:total\s+sks|jumlah\s+sks|berapa\s+sks|beban\s+studi|sks\b)\b/i,
    career_prospects: /\b(?:prospek\s+kar(?:i)?er|peluang\s+kar(?:i)?er|peluang\s+kerja|prospek\s+kerja|profesi\s+lulusan|lulusan.*kerja|kerja\s+apa)\b/i,
    faculty: /\b(?:masuk\s+fakultas|fakultas\s+apa|di\s+bawah\s+fakultas|berada\s+di\s+fakultas|fakultas(?:nya)?)\b/i,
    degree_award: /\b(?:gelar(?:\s+lulusan|\s+akademik|\s+apa|nya)?|dapat\s+gelar)\b/i,
    study_mode: /\b(?:kuliah\s+sore|kelas\s+sore|kelas\s+karyawan|kuliah\s+malam|sambil\s+kerja|kelas\s+malam|kuliah\s+sambil\s+kerja|mode\s+kuliah|jadwal\s+kuliah)\b/i,
    scholarship: /\b(?:beasiswa|potongan\s+(?:biaya|dpp)|kip(?:-|\s*)?kuliah)\b/i,
    admission_requirements: /\b(?:syarat\s+(?:pendaftaran|masuk|daftar)|persyaratan)\b/i,
    admission_schedule: /\b(?:jadwal\s+(?:pendaftaran|pmb|gelombang)|gelombang\s+pendaftaran)\b/i,
    admission_procedure: /\b(?:cara\s+(?:daftar|mendaftar)|alur\s+pendaftaran|prosedur\s+pendaftaran)\b/i,
    location: /\b(?:lokasi|alamat|letak\s+kampus)\b/i,
    contact: /\b(?:kontak|nomor\s+(?:wa|whatsapp|telepon)|hubungi)\b/i
  };
  const rawArr = Array.from(attrSet);
  const queryLower = String(q || norm || '').toLowerCase();
  const requestedAttributes = rawArr
    .map((attr, idx) => {
      const rx = ATTRIBUTE_ORDER_PATTERNS[attr];
      const m = rx ? rx.exec(queryLower) : null;
      return { attr, pos: m ? m.index : 10000 + idx, idx };
    })
    .sort((a, b) => (a.pos !== b.pos ? a.pos - b.pos : a.idx - b.idx))
    .map(item => item.attr);

  // 4. Excluded Entities (Negated entities in query)
  const allMatched = matchCanonicalEntities(norm) || [];
  const keptSet = new Set((filterNegatedCanonicalEntities(q, allMatched) || []).map(m => m.canonical));
  const excludedEntities = Array.from(new Set(allMatched.filter(m => m.canonical && !keptSet.has(m.canonical)).map(m => m.canonical)));

  // 5. Entity Relationships
  const entityRelationships = {
    relationType: frame.relation || frame.intent || 'GENERAL',
    scopeLevel: frame.scopeLevel || frame.academicLevel || null,
    isMultiTarget: Boolean(frame.isMultiTarget || targetEntities.length > 1),
    isComparison: Boolean(frame.intent === 'PROGRAM_COMPARISON' || frame.isComparison)
  };

  // 6. Enriched Constraints
  const studyModeConstraint = /\b(?:kelas\s+(?:sore|malam|karyawan)|sambil\s+kerja|kerja\s+sambil\s+kuliah)\b/i.test(norm)
    ? 'KELAS_KARYAWAN_SORE'
    : (/\b(?:kelas\s+reguler|reguler\s+pagi)\b/i.test(norm) ? 'REGULER' : null);

  const enrichedConstraints = {
    ...(frame.constraints || {}),
    academicLevel: frame.academicLevel || null,
    scopeLevel: frame.scopeLevel || null,
    academicYear: frame.academicYear || frame.temporal?.academicYear || null,
    temporalConstraint: frame.temporal?.constraint || 'GENERAL',
    targetBranch: frame.targetBranch || null,
    studyMode: studyModeConstraint
  };

  // 7. Information Needs (Both canonical string keys and structured need descriptors)
  const ATTRIBUTE_DOMAIN_MAP = {
    fee: 'TUITION_FEE',
    tuition: 'TUITION_FEE',
    dpp: 'TUITION_FEE',
    spp: 'TUITION_FEE',
    accreditation: 'ACCREDITATION',
    akreditasi: 'ACCREDITATION',
    curriculum: 'ACADEMIC_CURRICULUM',
    courses: 'ACADEMIC_CURRICULUM',
    sks: 'ACADEMIC_CURRICULUM',
    faculty: 'ACADEMIC_PROGRAM',
    degree_award: 'ACADEMIC_PROGRAM',
    career_prospects: 'ACADEMIC_PROGRAM',
    overview: 'ACADEMIC_PROGRAM',
    catalog_list: 'ACADEMIC_PROGRAM',
    scholarship: 'SCHOLARSHIP',
    admission_requirements: 'PMB',
    admission_schedule: 'PMB',
    admission_procedure: 'PMB',
    location: 'FACILITIES',
    facilities: 'FACILITIES',
    contact: 'CAMPUS_SERVICE',
    student_organization: 'ORGANIZATION_UKM',
    ukm: 'ORGANIZATION_UKM'
  };

  const informationNeeds = [];
  if (requestedAttributes.length > 0) {
    for (const attr of requestedAttributes) {
      const primaryKey = `${frame.domain}:${attr}`;
      if (!informationNeeds.includes(primaryKey)) informationNeeds.push(primaryKey);
      const attrDomain = ATTRIBUTE_DOMAIN_MAP[attr];
      if (attrDomain && attrDomain !== frame.domain) {
        const domainKey = `${attrDomain}:${attr}`;
        if (!informationNeeds.includes(domainKey)) informationNeeds.push(domainKey);
      }
    }
  } else {
    informationNeeds.push(`${frame.domain}:${frame.intent}`);
  }

  const primaryEntitiesForNeeds = targetEntities.length > 0
    ? targetEntities.map(e => (typeof e === 'object' && e ? (e.canonical || e.name || String(e)) : String(e)))
    : [null];
  const attrsForNeeds = requestedAttributes.length > 0 ? requestedAttributes : ['general'];
  const structuredInformationNeeds = [];
  for (const entName of primaryEntitiesForNeeds) {
    for (const attr of attrsForNeeds) {
      structuredInformationNeeds.push({
        id: `${entName || 'INSTITUTION'}::${attr}`,
        entity: entName,
        attribute: attr,
        domain: ATTRIBUTE_DOMAIN_MAP[attr] || frame.domain || 'GENERAL',
        academicLevel: enrichedConstraints.academicLevel,
        scope: entityRelationships.relationType
      });
    }
  }

  // 8. Ambiguity & Confidence
  const isAmbiguous = Boolean(frame.isAmbiguous || frame.ambiguityLevel === 'HIGH' || (partialEntityRes && partialEntityRes.isAmbiguous));
  const ambiguity = {
    isAmbiguous,
    level: frame.ambiguityLevel || (isAmbiguous ? 'HIGH' : 'LOW'),
    reason: partialEntityRes?.isAmbiguous ? partialEntityRes.reason : (isAmbiguous ? 'ambiguous_query' : null),
    candidateEntities: partialEntityRes?.candidateEntities || frame.candidateEntities || []
  };

  return {
    ...frame,
    speechAct,
    targetEntities,
    requestedAttributes,
    entityRelationships,
    constraints: enrichedConstraints,
    informationNeeds,
    structuredInformationNeeds,
    excludedEntities,
    ambiguity
  };
}

const shadowAuditHistory = [];

function recordShadowAudit(record) {
  shadowAuditHistory.push({
    timestamp: new Date().toISOString(),
    ...record
  });
  if (shadowAuditHistory.length > 500) {
    shadowAuditHistory.shift();
  }
}

function getShadowAuditHistory() {
  return [...shadowAuditHistory];
}

function clearShadowAuditHistory() {
  shadowAuditHistory.length = 0;
}

function buildConciseConversationHistory(sessionData = {}) {
  if (!sessionData || typeof sessionData !== 'object') return [];
  const rawHistory = Array.isArray(sessionData.conversationHistory)
    ? sessionData.conversationHistory
    : (Array.isArray(sessionData.history) ? sessionData.history : []);
  if (rawHistory.length > 0) {
    const normalizedTurns = [];
    for (const turn of rawHistory) {
      if (!turn || typeof turn !== 'object') continue;
      if (turn.user || turn.bot) {
        if (turn.user) {
          normalizedTurns.push({ role: 'user', content: String(turn.user).trim().slice(0, 150) });
        }
        if (turn.bot) {
          normalizedTurns.push({ role: 'assistant', content: String(turn.bot).trim().slice(0, 150) });
        }
      } else {
        const c = String(turn.content || turn.userText || turn.assistantText || turn.message || '').trim().slice(0, 150);
        if (c.length > 0) {
          normalizedTurns.push({
            role: turn.role === 'assistant' ? 'assistant' : 'user',
            content: c
          });
        }
      }
    }
    if (normalizedTurns.length > 0) {
      return normalizedTurns.slice(-2);
    }
  }

  const synthesized = [];
  const entityName = typeof sessionData.activeEntity === 'object'
    ? (sessionData.activeEntity?.canonical || sessionData.activeEntity?.name || '')
    : String(sessionData.activeEntity || '');
  if (sessionData.lastQuery) {
    synthesized.push({
      role: 'user',
      content: String(sessionData.lastQuery).trim().slice(0, 150)
    });
  }
  if (sessionData.lastAnswer || entityName || sessionData.activeDomain) {
    const ctxPrefix = (entityName || sessionData.activeDomain)
      ? `[Topik aktif: ${entityName || '-'}${sessionData.activeDomain ? ` (${sessionData.activeDomain})` : ''}] `
      : '';
    const ansPreview = String(sessionData.lastAnswer || '').trim().slice(0, 100);
    const combined = `${ctxPrefix}${ansPreview}`.trim().slice(0, 150);
    if (combined) {
      synthesized.push({
        role: 'assistant',
        content: combined
      });
    }
  }
  return synthesized.slice(-2);
}

/**
 * Asynchronously executes complete shadow comparison pipeline:
 * 1. Active legacy resolver (oldFrame)
 * 2. Model semantic parser (newInterpretation)
 * 3. Semantic interpretation validator (validatedFrame)
 * 4. Deterministic comparison & first-failure trace
 *
 * Active production output remains untouched.
 *
 * @param {string} rawQuery
 * @param {Object} [sessionData]
 * @param {Object} [shadowOptions]
 * @returns {Promise<Object>}
 */
async function resolveSemanticFrameWithShadow(rawQuery, sessionData = {}, shadowOptions = {}) {
  const compStart = Date.now();

  // 1. Run active legacy resolver
  const oldFrame = resolveSemanticFrame(rawQuery, sessionData);

  // 2. Run new model semantic parser
  const parserStart = Date.now();
  const newInterpretation = await parseSemanticInterpretation(
    { rawQuery, conversationHistory: buildConciseConversationHistory(sessionData) },
    shadowOptions
  );
  const parserMs = Date.now() - parserStart;

  // 3. Run semantic interpretation validator
  const valStart = Date.now();
  const validationResult = validateSemanticInterpretation(newInterpretation, sessionData, shadowOptions);
  const validatorMs = Date.now() - valStart;

  // 4. Run comparison & first-failure trace
  const diffStart = Date.now();
  const comparison = compareFrames(rawQuery, oldFrame, newInterpretation, validationResult);
  const comparisonMs = Date.now() - diffStart;

  const totalShadowMs = Date.now() - compStart;

  const record = {
    rawQuery,
    oldFrame,
    newInterpretation,
    validatedFrame: validationResult.validatedFrame,
    compatibilityResult: validationResult.compatibilityResult,
    ambiguityResult: validationResult.ambiguityResult,
    firstDifference: comparison.firstDifference,
    failureClassification: comparison.failureClassification,
    differences: comparison.differences,
    latencyBreakdown: {
      parserMs,
      validatorMs,
      comparisonMs,
      totalShadowMs
    }
  };

  recordShadowAudit(record);

  return {
    activeFrame: oldFrame, // Production frame is NEVER overridden!
    ...record
  };
}

/**
 * Authoritative AI-driven Semantic Frame Resolver.
 * Uses modelSemanticParser for structured AI language understanding,
 * validated by semanticInterpretationValidator and mapped to canonical entities.
 * Fails closed safely to deterministic fallback on AI timeout or error.
 */
// Specific international intents already resolved upstream must not be collapsed back
// into the generic INTERNATIONAL_PROGRAM_INFO bucket by later speech-act fallbacks.
const SPECIFIC_INTERNATIONAL_INTENTS = new Set(['PROGRAM_PROCEDURE', 'STUDY_LOCATION', 'PROGRAM_BENEFIT', 'DEFINITION']);
function resolveSpecificInternationalIntent(currentIntent, syncFrame = {}) {
  if (SPECIFIC_INTERNATIONAL_INTENTS.has(currentIntent)) return currentIntent;
  if (syncFrame.domain === 'INTERNATIONAL' && SPECIFIC_INTERNATIONAL_INTENTS.has(syncFrame.intent)) return syncFrame.intent;
  return 'INTERNATIONAL_PROGRAM_INFO';
}

async function resolveSemanticFrameAsync(rawQuery, sessionData = {}, options = {}) {
  const syncFrame = resolveSemanticFrame(rawQuery, sessionData, options);

  // Safety & Privacy Guardrail: Never call external or model parser on privacy refusal
  if (syncFrame && syncFrame.intent === 'PRIVACY_DATA_REFUSAL') {
    return syncFrame;
  }

  // If syncOnly or skipModelParser requested, or sync mode without custom client / mocked parser, return verified syncFrame
  const isMockedParser = typeof modelSemanticParser.parseSemanticInterpretation === 'function' &&
    Boolean(modelSemanticParser.parseSemanticInterpretation._isMockFunction || modelSemanticParser.parseSemanticInterpretation.mock);
  if (options.syncOnly || options.skipModelParser || (process.env.SEMANTIC_RESOLVER_MODE === 'sync' && !options.client && !isMockedParser)) {
    return syncFrame;
  }

  const startTime = Date.now();
  try {
    const conciseHistory = buildConciseConversationHistory(sessionData);
    const interpretation = await modelSemanticParser.parseSemanticInterpretation(
      { rawQuery, conversationHistory: conciseHistory },
      { timeoutMs: options.timeoutMs || 12000, ...options }
    );

    if (!interpretation || interpretation.speechAct === 'UNKNOWN' || interpretation.metadata?.fallbackInvoked) {
      return {
        ...syncFrame,
        traceMeta: {
          resolverEngine: 'deterministic_fallback',
          reason: interpretation?.metadata?.reason || 'parser_unknown',
          elapsedMs: Date.now() - startTime
        }
      };
    }

    const validationResult = validateSemanticInterpretation(interpretation, sessionData, options);
    const validated = validationResult.validatedFrame || interpretation;

    // Determine model intent, aspects, and topic continuity BEFORE inheriting prior session entities
    const modelPrimaryIntent = validated.primaryIntent && validated.primaryIntent !== 'UNKNOWN' ? validated.primaryIntent : null;
    const modelContinuity = validated.contextDependency?.topicContinuity || (validated.contextDependency?.isFollowUp ? 'CONTINUATION' : 'NEW_TOPIC');
    const modelSaysTopicSwitch = modelContinuity === 'NEW_TOPIC' || (!validated.contextDependency?.isFollowUp && validated.contextDependency?.referenceType === 'none');
    // Context binding contract: when the structural context resolver detected an explicit
    // reference to the prior entity (enclitic/pronoun/ellipsis) and the model extracted no new
    // entity, the model's NEW_TOPIC label alone must not discard the inherited entity.
    const syncBoundPriorEntity = Array.isArray(syncFrame.contextDependencies) &&
      syncFrame.contextDependencies.some(d => d && d.shouldInherit && d.inheritedEntity);
    const modelFoundNoNewEntity = !Array.isArray(validated.candidateEntities) || validated.candidateEntities.length === 0;
    const isTopicSwitch = modelSaysTopicSwitch && !(syncBoundPriorEntity && modelFoundNoNewEntity);

    const speechAct = validated.speechAct;
    const primaryConcept = interpretation.semanticConcepts?.[0] || null;
    const aspects = filterNegatedSemanticAspects(
      rawQuery,
      Array.isArray(validated.requestedAspects) ? validated.requestedAspects : []
    );
    if (aspects.includes('career') && !aspects.includes('career_prospects')) {
      aspects.push('career_prospects');
    }

    const curriculumIsExcluded = getNegatedAspectSet(rawQuery).has('curriculum');
    const curriculumDep = !curriculumIsExcluded && Array.isArray(syncFrame.contextDependencies) &&
      syncFrame.contextDependencies.find(d => d && d.shouldInherit && (d.reason === 'curriculum_continuation' || d.inheritedDomain === 'ACADEMIC_CURRICULUM'));
    const isCurriculumAspect = aspects.includes('curriculum') || aspects.includes('courses') || aspects.includes('learning') || aspects.includes('competency');
    const isLearningSpeechAct = speechAct === 'INQUIRE_PROPERTY' || speechAct === 'EXPLAIN_PROCEDURE' || speechAct === 'VERIFY_STATUS' || speechAct === 'DISCOVER_LIST';
    const isCurriculumInquiry = Boolean(curriculumDep) || (syncBoundPriorEntity && (isCurriculumAspect || (isLearningSpeechAct && (syncFrame.domain === 'ACADEMIC_CURRICULUM' || syncFrame.intent === 'CURRICULUM_INQUIRY'))));

    const INSTITUTIONAL_CAMPUS_WIDE_INTENTS = new Set([
      'CAMPUS_LOCATION',
      'ADMISSION_SCHEDULE',
      'CURRENT_ENROLLMENT_STATUS',
      'AVAILABLE_PROGRAMS_LIST',
      'FACULTY_INQUIRY',
      'ORGANIZATION_INQUIRY',
      'SCHOLARSHIP_INQUIRY',
      'CAMPUS_SERVICE_INQUIRY',
      'PMB_CONTACT_INQUIRY',
      'CONTACT_INQUIRY'
    ]);
    const isInstitutionalTopicSwitch = !isCurriculumInquiry && (
      INSTITUTIONAL_CAMPUS_WIDE_INTENTS.has(modelPrimaryIntent) ||
      INSTITUTIONAL_CAMPUS_WIDE_INTENTS.has(syncFrame.intent) ||
      (aspects.includes('contact') && !aspects.includes('fee'))
    );

    // Resolve entities to canonical registry objects
    const resolvedEntities = [];
    let detectedUnsupportedMention = null;
    const rawCandidateMentions = Array.isArray(validated.candidateEntities) ? validated.candidateEntities : [];
    const candidateMentions = filterNegatedCanonicalEntities(
      rawQuery,
      rawCandidateMentions.map(candidate => {
        const mention = typeof candidate === 'string'
          ? candidate
          : (candidate?.canonical || candidate?.rawMention || candidate?.mention || '');
        return { canonical: mention, matchedAlias: mention, candidate };
      })
    ).map(candidate => candidate.candidate);
    // Resolve level before mapping candidate mentions; unrecognized S2 research terms
    // need this context to be classified as S2 concentrations rather than unsupported programs.
    const effectiveLevel = validated.scopeConstraints?.academicLevel || syncFrame.academicLevel || null;
    for (const cand of candidateMentions) {
      const mentionStr = typeof cand === 'string' ? cand : (cand.canonical || cand.rawMention || cand.mention || '');
      const category = typeof cand === 'object' ? cand.inferredCategory : null;
      if (!mentionStr) continue;
      const canonicalMatch = findCanonicalEntity(mentionStr);
      if (canonicalMatch) {
        resolvedEntities.push(canonicalMatch);
      } else {
        const matches = matchCanonicalEntities(mentionStr);
        if (matches && matches.length > 0) {
          resolvedEntities.push(matches[0]);
        } else if (category === 'academic_program' && mentionStr.length >= 4 && !/^(double\s+degree|dual\s+degree|program|jurusan|studi)$/i.test(mentionStr)) {
          const isS2Context = effectiveLevel === 'S2' || /\b(?:s2|magister|pascasarjana|riset|fokus\s+riset|konsentrasi|peminatan)\b/i.test(stripNegatedAspectPhrases(rawQuery));
          const isS2Concentration = isS2Context && /\b(?:data\s+science|cyber\s+security|enterprise\s+system|medical\s+informatics|business\s+intelligence)\b/i.test(mentionStr);
          const isVokasi = /\b(?:vokasi|pendidikan\s+vokasi|program\s+vokasi)\b/i.test(mentionStr);

          if (isS2Concentration) {
            const s2Entity = findCanonicalEntity('S2 Sistem Informasi');
            if (s2Entity && !resolvedEntities.some(e => e.canonical === s2Entity.canonical)) {
              resolvedEntities.push(s2Entity);
            }
            if (!aspects.includes('curriculum')) aspects.push('curriculum');
            if (!aspects.includes('research_focus')) aspects.push('research_focus');
          } else if (isVokasi) {
            const d3Entity = findCanonicalEntity('D3 Manajemen Informatika');
            if (d3Entity && !resolvedEntities.some(e => e.canonical === d3Entity.canonical)) {
              resolvedEntities.push(d3Entity);
            }
          } else {
            detectedUnsupportedMention = mentionStr;
          }
        }
      }
    }

    // If model extracted no candidate entities, evaluate topic switch before inheriting prior entities
    if (resolvedEntities.length === 0 && Array.isArray(syncFrame.entities) && syncFrame.entities.length > 0) {
      for (const e of syncFrame.entities) {
        if (!e.inherited) {
          resolvedEntities.push(e);
        } else if (!isTopicSwitch || isCurriculumInquiry) {
          const isAcademicEntity = e.family === 'academic_program' || e.type === 'program';
          if (isAcademicEntity && isInstitutionalTopicSwitch) {
            continue;
          }
          resolvedEntities.push(e);
        }
      }
    }

    if (isCurriculumInquiry && resolvedEntities.length === 0) {
      const inheritedTarget = (curriculumDep && curriculumDep.inheritedEntity) ||
        syncFrame.contextDependencies?.find(d => d && d.inheritedEntity)?.inheritedEntity ||
        sessionData.activeEntity;
      const inheritedCanon = findCanonicalEntity(inheritedTarget);
      if (inheritedCanon) {
        resolvedEntities.push({
          canonical: inheritedCanon.canonical,
          type: inheritedCanon.type,
          family: inheritedCanon.family,
          inherited: true
        });
      }
    }

    // Model output may still echo a named entity inside an explicitly rejected clause.
    // Apply the same current-turn exclusion policy after canonical resolution.
    const filteredResolvedEntities = filterNegatedCanonicalEntities(rawQuery, resolvedEntities);
    resolvedEntities.splice(0, resolvedEntities.length, ...filteredResolvedEntities);

    // If we have resolved any genuine program or international program, suppress spurious unoffered program mention
    const hasResolvedValidProgram = resolvedEntities.some(
      e => e.family === 'academic_program' || e.family === 'international_program' || e.type === 'program'
    );
    if (hasResolvedValidProgram) {
      detectedUnsupportedMention = null;
    }

    // If query is about outgoing student exchange for STIKOM students and not foreign student intake/visa, filter out foreign student persona
    const isStudentExchange = /\b(pertukaran\s+(?:pelajar|mahasiswa)|student\s+exchange)\b/i.test(rawQuery);
    const hasExplicitForeignKeywords = /\b(mahasiswa\s+asing|visa|itas|kitas|izin\s+belajar|e-visa)\b/i.test(rawQuery);
    if (isStudentExchange && !hasExplicitForeignKeywords) {
      const foreignIdx = resolvedEntities.findIndex(e => e.canonical?.includes('Foreign Student') || /foreign\s+student/i.test(e.name || ''));
      if (foreignIdx !== -1) {
        resolvedEntities.splice(foreignIdx, 1);
      }
    }

    // Re-align S1 Sistem Informasi to S2 Sistem Informasi if effective academic level is S2
    if (effectiveLevel === 'S2') {
      for (let i = 0; i < resolvedEntities.length; i++) {
        if (resolvedEntities[i].canonical === 'S1 Sistem Informasi') {
          const s2Entry = findCanonicalEntity('S2 Sistem Informasi');
          if (s2Entry) {
            resolvedEntities[i] = { canonical: s2Entry.canonical, type: s2Entry.type, family: s2Entry.family, degree: 'S2' };
          }
        }
      }
    }

    const hasInternationalProgramEntity = resolvedEntities.some(
      e => e.family === 'international_program' || e.type === 'international_program' ||
        /\b(?:double\s+degree|dual\s+degree|utb|dnui|help\s+university|student\s+exchange|gccp|hi-?think)\b/i.test(e.canonical || e.name || '')
    );

    let domain = null;
    let intent = null;

    // Safety checks first: adversarial injection must ALWAYS be refused
    if (syncFrame.intent === 'ADVERSARIAL_INJECTION_DEFENSE') {
      domain = 'CONVERSATIONAL';
      intent = 'ADVERSARIAL_INJECTION_DEFENSE';
    } else if (syncFrame.intent === 'BOT_IDENTITY' || modelPrimaryIntent === 'BOT_IDENTITY') {
      domain = 'CONVERSATIONAL';
      intent = 'BOT_IDENTITY';
    } else if (modelPrimaryIntent === 'CONVERSATIONAL_GREETING' || (!modelPrimaryIntent && (speechAct === 'GENERAL_GREETING' || syncFrame.intent === 'CONVERSATIONAL_GREETING'))) {
      domain = 'CONVERSATIONAL';
      intent = 'CONVERSATIONAL_GREETING';
    } else if (modelPrimaryIntent === 'CONVERSATIONAL_SMALL_TALK' || (!modelPrimaryIntent && (speechAct === 'SOCIAL_INQUIRY' || syncFrame.intent === 'CONVERSATIONAL_SMALL_TALK'))) {
      domain = 'CONVERSATIONAL';
      intent = 'CONVERSATIONAL_SMALL_TALK';
    } else if (modelPrimaryIntent === 'CONVERSATIONAL_ACKNOWLEDGEMENT' || (!modelPrimaryIntent && syncFrame.intent === 'CONVERSATIONAL_ACKNOWLEDGEMENT')) {
      domain = 'CONVERSATIONAL';
      intent = 'CONVERSATIONAL_ACKNOWLEDGEMENT';
    } else if (syncFrame.intent === 'CONVERSATIONAL_FAREWELL' || modelPrimaryIntent === 'CONVERSATIONAL_FAREWELL') {
      domain = 'CONVERSATIONAL';
      intent = 'CONVERSATIONAL_FAREWELL';
    } else if (syncFrame.intent === 'BROAD_CAMPUS_OVERVIEW') {
      domain = 'GENERAL';
      intent = 'BROAD_CAMPUS_OVERVIEW';
    } else if (syncFrame.intent === 'AMBIGUOUS_CLARIFICATION') {
      domain = 'GENERAL';
      intent = 'AMBIGUOUS_CLARIFICATION';
    } else if ((modelPrimaryIntent === 'PROGRAM_RECOMMENDATION' || syncFrame.intent === 'PROGRAM_RECOMMENDATION' || (!modelPrimaryIntent && speechAct === 'SEEK_ADVICE')) &&
      !['SCHOLARSHIP', 'ORGANIZATION_UKM', 'CAMPUS_SERVICE'].includes(syncFrame.domain)) {
      domain = 'ACADEMIC_RECOMMENDATION';
      intent = 'PROGRAM_RECOMMENDATION';
    } else if (modelPrimaryIntent === 'CURRENT_ENROLLMENT_STATUS') {
      domain = 'PMB';
      intent = 'CURRENT_ENROLLMENT_STATUS';
    } else if (modelPrimaryIntent === 'ADMISSION_SCHEDULE') {
      domain = 'PMB';
      intent = 'ADMISSION_SCHEDULE';
    } else if (modelPrimaryIntent === 'ADMISSION_PROCEDURE') {
      if (hasInternationalProgramEntity && !aspects.includes('fee')) {
        domain = 'INTERNATIONAL';
        intent = 'PROGRAM_PROCEDURE';
        if (!aspects.includes('procedure')) aspects.push('procedure');
        if (!aspects.includes('requirements')) aspects.push('requirements');
      } else {
        domain = 'PMB';
        intent = 'ADMISSION_PROCEDURE';
      }
    } else if (modelPrimaryIntent === 'ADMISSION_REQUIREMENTS') {
      if (hasInternationalProgramEntity && !aspects.includes('fee')) {
        domain = 'INTERNATIONAL';
        intent = 'PROGRAM_PROCEDURE';
        if (!aspects.includes('requirements')) aspects.push('requirements');
        if (!aspects.includes('procedure')) aspects.push('procedure');
      } else {
        domain = 'PMB';
        intent = 'ADMISSION_REQUIREMENTS';
      }
    } else if (modelPrimaryIntent === 'GENERAL_PMB_INQUIRY') {
      if (hasInternationalProgramEntity && !aspects.includes('fee')) {
        domain = 'INTERNATIONAL';
        intent = syncFrame.intent === 'PROGRAM_PROCEDURE' ? 'PROGRAM_PROCEDURE' : 'INTERNATIONAL_PROGRAM_INFO';
      } else {
        domain = 'PMB';
        intent = 'GENERAL_PMB_INQUIRY';
      }
    } else if (modelPrimaryIntent === 'AVAILABLE_PROGRAMS_LIST') {
      domain = 'ACADEMIC_PROGRAM';
      intent = 'AVAILABLE_PROGRAMS_LIST';
    } else if (modelPrimaryIntent === 'PROGRAM_OVERVIEW') {
      domain = 'ACADEMIC_PROGRAM';
      intent = 'PROGRAM_OVERVIEW';
    } else if (modelPrimaryIntent === 'PROGRAM_COMPARISON' || speechAct === 'COMPARE') {
      domain = 'ACADEMIC_PROGRAM';
      intent = 'PROGRAM_COMPARISON';
    } else if (modelPrimaryIntent === 'TUITION_FEE_INQUIRY') {
      const isStackingQuery = /\b(?:digabung|gabung(?:kan)?|akumulasi|kombinasi|penggabungan)\b/i.test(rawQuery) &&
        /\b(?:potongan|diskon|tambahan|60%|\d+%|gelombang|dpp)\b/i.test(rawQuery);
      if (isStackingQuery || syncFrame.domain === 'SCHOLARSHIP') {
        domain = 'SCHOLARSHIP';
        intent = 'SCHOLARSHIP_INQUIRY';
        if (!aspects.includes('scholarship')) aspects.push('scholarship');
      } else {
        domain = 'TUITION_FEE';
        intent = 'TUITION_FEE_INQUIRY';
      }
    } else if (modelPrimaryIntent === 'CAMPUS_LOCATION') {
      domain = 'FACILITIES';
      intent = 'CAMPUS_LOCATION';
    } else if (modelPrimaryIntent === 'FACULTY_INQUIRY') {
      domain = 'ACADEMIC_PROGRAM';
      intent = 'FACULTY_INQUIRY';
    } else if (modelPrimaryIntent === 'INTERNATIONAL_PROGRAM_INFO') {
      domain = 'INTERNATIONAL';
      intent = 'INTERNATIONAL_PROGRAM_INFO';
    } else if (modelPrimaryIntent === 'ACCREDITATION_INQUIRY') {
      domain = 'ACCREDITATION';
      intent = 'ACCREDITATION_INQUIRY';
    } else if (modelPrimaryIntent === 'SCHOLARSHIP_INQUIRY') {
      domain = 'SCHOLARSHIP';
      intent = 'SCHOLARSHIP_INQUIRY';
    } else if (modelPrimaryIntent === 'ORGANIZATION_INQUIRY') {
      domain = 'ORGANIZATION_UKM';
      intent = 'ORGANIZATION_INQUIRY';
    } else if (modelPrimaryIntent === 'CAMPUS_SERVICE_INQUIRY') {
      domain = 'CAMPUS_SERVICE';
      intent = 'CAMPUS_SERVICE_INQUIRY';
    } else if (modelPrimaryIntent === 'CAREER_PROSPECTS_INQUIRY') {
      domain = 'ACADEMIC_PROGRAM';
      intent = 'CAREER_PROSPECTS_INQUIRY';
    } else if (modelPrimaryIntent === 'GRADUATION_INQUIRY') {
      domain = 'ACADEMIC_EVENT';
      intent = 'GRADUATION_INQUIRY';
    } else if (modelPrimaryIntent === 'OUT_OF_DOMAIN_INQUIRY') {
      domain = 'OUT_OF_DOMAIN';
      intent = 'OUT_OF_DOMAIN_INQUIRY';
    }

    // If intent was not directly determined by primaryIntent above, derive from concept + speechAct
    if (!domain) {
      if (primaryConcept === 'FINANCIAL_COST' || aspects.includes('fee')) {
        const isStackingQuery = /\b(?:digabung|gabung(?:kan)?|akumulasi|kombinasi|penggabungan)\b/i.test(rawQuery) &&
          /\b(?:potongan|diskon|tambahan|60%|\d+%|gelombang|dpp)\b/i.test(rawQuery);
        const isScholarship = syncFrame.domain === 'SCHOLARSHIP' || isStackingQuery || /\b(?:beasiswa|kip\s*kuliah|kip-?k|potongan\s+gelombang|tambahan\s+\d+%)\b/i.test(rawQuery);
        domain = isScholarship ? 'SCHOLARSHIP' : 'TUITION_FEE';
      } else if (primaryConcept === 'ADMISSION_ONBOARDING') {
        domain = 'PMB';
      } else if (primaryConcept === 'ACADEMIC_OFFERING') {
        domain = 'ACADEMIC_PROGRAM';
      } else if (primaryConcept === 'QUALITY_ACCREDITATION') {
        domain = 'ACCREDITATION';
      } else if (primaryConcept === 'CAMPUS_LIFE') {
        const isOrg = /\b(?:himpunan|hima|himaprodi|ormawa|ukm|organisasi)\b/i.test(rawQuery) || syncFrame.domain === 'ORGANIZATION_UKM';
        const isService = /\b(?:inbis|inkubator|career|cdc)\b/i.test(rawQuery) || syncFrame.domain === 'CAMPUS_SERVICE' || syncFrame.domain === 'CAREER_CENTER';
        if (isOrg) domain = 'ORGANIZATION_UKM';
        else if (isService) domain = syncFrame.domain === 'CAREER_CENTER' ? 'CAREER_CENTER' : 'CAMPUS_SERVICE';
        else domain = 'FACILITIES';
      } else if (primaryConcept === 'INTERNATIONAL_STUDY') {
        domain = 'INTERNATIONAL';
      } else if (primaryConcept === 'CAREER_EMPLOYMENT') {
        const hasAcademicProgram = (resolvedEntities || []).some(e => e.family === 'academic_program' || e.type === 'program');
        domain = hasAcademicProgram ? 'ACADEMIC_PROGRAM' : 'CAREER_CENTER';
      } else {
        domain = validated.domain || syncFrame.domain;
      }
    }

    if (!intent) {
      if (domain === 'CONVERSATIONAL') {
        intent = syncFrame.intent || 'CONVERSATIONAL_GREETING';
      } else if (speechAct === 'GENERAL_GREETING') {
        domain = 'CONVERSATIONAL';
        intent = 'CONVERSATIONAL_GREETING';
      } else if (speechAct === 'SOCIAL_INQUIRY') {
        domain = 'CONVERSATIONAL';
        intent = 'CONVERSATIONAL_SMALL_TALK';
      } else if (speechAct === 'SEEK_ADVICE') {
        if (domain === 'SCHOLARSHIP' || syncFrame.domain === 'SCHOLARSHIP' || /\b(?:beasiswa|kip\s*kuliah|kip-?k)\b/i.test(rawQuery)) {
          domain = 'SCHOLARSHIP';
          intent = 'SCHOLARSHIP_INQUIRY';
        } else if (domain === 'ORGANIZATION_UKM' || syncFrame.domain === 'ORGANIZATION_UKM' || /\b(?:ukm\b|unit\s+kegiatan\s+mahasiswa|organisasi|ormawa)\b/i.test(rawQuery)) {
          domain = 'ORGANIZATION_UKM';
          intent = 'ORGANIZATION_INQUIRY';
        } else if (domain === 'CAMPUS_SERVICE' || syncFrame.domain === 'CAMPUS_SERVICE' || /\b(?:inkubator|inbis)\b/i.test(rawQuery)) {
          domain = 'CAMPUS_SERVICE';
          intent = 'CAMPUS_SERVICE_INQUIRY';
        } else {
          domain = 'ACADEMIC_RECOMMENDATION';
          intent = 'PROGRAM_RECOMMENDATION';
        }
      } else if (speechAct === 'COMPARE') {
        domain = 'ACADEMIC_PROGRAM';
        intent = 'PROGRAM_COMPARISON';
      } else if (aspects.includes('schedule') && domain === 'PMB') {
        intent = 'CURRENT_ENROLLMENT_STATUS';
      } else if (aspects.includes('location') && (domain === 'FACILITIES' || primaryConcept === 'CAMPUS_LIFE')) {
        domain = 'FACILITIES';
        intent = 'CAMPUS_LOCATION';
      } else if (aspects.includes('fee') || domain === 'TUITION_FEE') {
        domain = 'TUITION_FEE';
        intent = 'TUITION_FEE_INQUIRY';
      } else if (domain === 'ACADEMIC_PROGRAM') {
        intent = resolvedEntities.length > 0 ? 'PROGRAM_OVERVIEW' : 'AVAILABLE_PROGRAMS_LIST';
      } else {
        intent = syncFrame.intent;
      }
    } else if (speechAct === 'COMPARE') {
      intent = 'PROGRAM_COMPARISON';
      domain = 'ACADEMIC_PROGRAM';
    } else if (speechAct === 'DISCOVER_LIST') {
      if (domain === 'SCHOLARSHIP' || syncFrame.domain === 'SCHOLARSHIP' || /\b(?:beasiswa|kip\s*kuliah|kip-?k)\b/i.test(rawQuery)) {
        domain = 'SCHOLARSHIP';
        intent = 'SCHOLARSHIP_INQUIRY';
      } else if (domain === 'CAMPUS_SERVICE' || syncFrame.domain === 'CAMPUS_SERVICE' || /\b(?:inkubator|inbis)\b/i.test(rawQuery) || (validated.candidateEntities || []).some(e => e.inferredCategory === 'campus_service')) {
        domain = 'CAMPUS_SERVICE';
        intent = 'CAMPUS_SERVICE_INQUIRY';
      } else if (domain === 'ORGANIZATION_UKM' || syncFrame.domain === 'ORGANIZATION_UKM' || /\b(?:ukm\b|unit\s+kegiatan\s+mahasiswa|organisasi|ormawa|hima\b|himaprodi|ekskul|ekstrakurikuler|student\s+clubs?|student\s+organizations?)\b/i.test(rawQuery) || (validated.candidateEntities || []).some(e => e.inferredCategory === 'student_organization')) {
        domain = 'ORGANIZATION_UKM';
        intent = 'ORGANIZATION_INQUIRY';
      } else if (domain === 'CAREER_CENTER' || syncFrame.domain === 'CAREER_CENTER' || /\b(?:career\s+center|cdc\b|pusat\s+karier|magang|internship|job\s+fair|campus\s+hiring|bursa\s+kerja|(?:jaminan|menjamin|dijamin|pasti)\s+(?:kerja|pekerjaan|dapat\s+kerja|bekerja)|langsung\s+(?:dapat\s+)?kerja)\b/i.test(rawQuery)) {
        domain = 'CAREER_CENTER';
        intent = 'CAREER_CENTER_INQUIRY';
        if (/\b(?:jaminan|menjamin|dijamin|pasti)\s+(?:kerja|pekerjaan|dapat\s+kerja|bekerja)\b/i.test(rawQuery) || /\b(?:langsung\s+(?:dapat\s+)?kerja)\b/i.test(rawQuery)) {
          if (!aspects.includes('job_guarantee')) aspects.push('job_guarantee');
        }
      } else if (aspects.includes('fee') || primaryConcept === 'FINANCIAL_COST' || domain === 'TUITION_FEE') {
        intent = 'TUITION_FEE_INQUIRY';
        domain = 'TUITION_FEE';
        if (!aspects.includes('components')) aspects.push('components');
      } else if (domain === 'FACILITIES' || aspects.includes('facilities') || aspects.includes('lab') || aspects.includes('campus_infrastructure') || (primaryConcept === 'CAMPUS_LIFE' && !syncFrame.domain?.includes('SERVICE') && !(validated.candidateEntities || []).some(e => e.inferredCategory === 'campus_service'))) {
        intent = 'FACILITY_INQUIRY';
        domain = 'FACILITIES';
      } else if (/\b(?:tugas\s+akhir|skripsi|pedoman\s+ta)\b/i.test(rawQuery) && !/\b(?:pmb|mahasiswa\s+baru|calon\s+mahasiswa|camaba|maba)\b/i.test(rawQuery)) {
        intent = 'THESIS_REQUIREMENTS';
        domain = 'ACADEMIC_CURRICULUM';
      } else if (aspects.includes('requirements') || primaryConcept === 'ADMISSION_ONBOARDING') {
        intent = 'ADMISSION_REQUIREMENTS';
        domain = 'PMB';
      } else if (aspects.includes('career') || aspects.includes('career_prospects') || aspects.includes('prospek_karir') || primaryConcept === 'CAREER_PROSPECT') {
        intent = 'CAREER_PROSPECTS_INQUIRY';
        domain = 'ACADEMIC_PROGRAM';
      } else if (aspects.includes('curriculum') || aspects.includes('courses')) {
        intent = 'PROGRAM_OVERVIEW';
        domain = 'ACADEMIC_PROGRAM';
      } else if (domain === 'INTERNATIONAL' || primaryConcept === 'INTERNATIONAL_STUDY' || resolvedEntities.some(e => e.family === 'international_program')) {
        intent = resolveSpecificInternationalIntent(intent, syncFrame);
        domain = 'INTERNATIONAL';
      } else if (resolvedEntities.length > 0 && !resolvedEntities.every(e => e.type === 'academic_scope' || e.family === 'academic_scope' || e.type === 'academic_level')) {
        intent = 'PROGRAM_OVERVIEW';
        domain = 'ACADEMIC_PROGRAM';
      } else {
        intent = 'AVAILABLE_PROGRAMS_LIST';
        domain = 'ACADEMIC_PROGRAM';
      }
    } else if (speechAct === 'EXPLAIN_PROCEDURE' || speechAct === 'INQUIRE_PROPERTY' || speechAct === 'VERIFY_STATUS') {
      if (domain === 'SCHOLARSHIP' || syncFrame.domain === 'SCHOLARSHIP' || /\b(?:beasiswa|kip\s*kuliah|kip-?k)\b/i.test(rawQuery)) {
        domain = 'SCHOLARSHIP';
        intent = 'SCHOLARSHIP_INQUIRY';
      } else if (domain === 'CAMPUS_SERVICE' || syncFrame.domain === 'CAMPUS_SERVICE' || /\b(?:inkubator|inbis)\b/i.test(rawQuery) || (validated.candidateEntities || []).some(e => e.inferredCategory === 'campus_service')) {
        domain = 'CAMPUS_SERVICE';
        intent = 'CAMPUS_SERVICE_INQUIRY';
      } else if (domain === 'ORGANIZATION_UKM' || syncFrame.domain === 'ORGANIZATION_UKM' ||
        /\b(?:ukm\b|unit\s+kegiatan\s+mahasiswa|organisasi|ormawa|hima\b|himaprodi|student\s+clubs?|student\s+organizations?)\b/i.test(rawQuery) ||
        (/\b(?:bergabung|gabung|join)\b/i.test(rawQuery) && (sessionData.activeDomain === 'ORGANIZATION_UKM' || sessionData.lastDomain === 'ORGANIZATION_UKM'))) {
        domain = 'ORGANIZATION_UKM';
        intent = 'ORGANIZATION_INQUIRY';
      } else if (domain === 'CAREER_CENTER' || syncFrame.domain === 'CAREER_CENTER' || /\b(?:career\s+center|cdc\b|pusat\s+karier|magang|internship|job\s+fair|campus\s+hiring|bursa\s+kerja|(?:jaminan|menjamin|dijamin|pasti)\s+(?:kerja|pekerjaan|dapat\s+kerja|bekerja)|langsung\s+(?:dapat\s+)?kerja)\b/i.test(rawQuery)) {
        domain = 'CAREER_CENTER';
        intent = 'CAREER_CENTER_INQUIRY';
        if (/\b(?:jaminan|menjamin|dijamin|pasti)\s+(?:kerja|pekerjaan|dapat\s+kerja|bekerja)\b/i.test(rawQuery) || /\b(?:langsung\s+(?:dapat\s+)?kerja)\b/i.test(rawQuery)) {
          if (!aspects.includes('job_guarantee')) aspects.push('job_guarantee');
        }
      } else if (/\b(?:tugas\s+akhir|skripsi|pedoman\s+ta)\b/i.test(rawQuery) && !/\b(?:pmb|mahasiswa\s+baru|calon\s+mahasiswa|camaba|maba)\b/i.test(rawQuery)) {
        intent = 'THESIS_REQUIREMENTS';
        domain = 'ACADEMIC_CURRICULUM';
      } else if (domain === 'INTERNATIONAL' || syncFrame.domain === 'INTERNATIONAL' || primaryConcept === 'INTERNATIONAL_STUDY' || resolvedEntities.some(e => e.family === 'international_program') || /\b(pertukaran\s+(?:pelajar|mahasiswa)|student\s+exchange)\b/i.test(rawQuery)) {
        intent = resolveSpecificInternationalIntent(intent, syncFrame);
        domain = 'INTERNATIONAL';
      } else if (domain === 'ACADEMIC_EVENT' || syncFrame.domain === 'ACADEMIC_EVENT' || syncFrame.intent === 'GRADUATION_INQUIRY' || /\b(?:wisuda|yudisium)\b/i.test(rawQuery)) {
        domain = 'ACADEMIC_EVENT';
        intent = 'GRADUATION_INQUIRY';
      } else if (modelPrimaryIntent === 'CURRENT_ENROLLMENT_STATUS') {
        domain = 'PMB';
        intent = 'CURRENT_ENROLLMENT_STATUS';
      } else if (domain === 'TUITION_FEE' || syncFrame.domain === 'TUITION_FEE' || primaryConcept === 'FINANCIAL_COST' || aspects.includes('fee')) {
        intent = (syncFrame.domain === 'TUITION_FEE' && syncFrame.intent) ? syncFrame.intent : 'TUITION_FEE_INQUIRY';
        domain = 'TUITION_FEE';
      } else if (aspects.includes('procedure')) {
        if (aspects.includes('fee') || domain === 'TUITION_FEE' || primaryConcept === 'FINANCIAL_COST') {
          intent = 'PAYMENT_CONFIRMATION_PROCEDURE';
          domain = 'TUITION_FEE';
        } else {
          intent = 'ADMISSION_PROCEDURE';
          domain = 'PMB';
        }
      } else if (aspects.includes('contact')) {
        intent = 'PMB_CONTACT_INQUIRY';
        domain = 'PMB';
      } else if (aspects.includes('schedule')) {
        intent = 'ADMISSION_SCHEDULE';
        domain = 'PMB';
      } else if (aspects.includes('requirements')) {
        if (/\b(?:tugas\s+akhir|skripsi|pedoman\s+ta)\b/i.test(rawQuery) && !/\b(?:pmb|mahasiswa\s+baru|calon\s+mahasiswa|camaba|maba)\b/i.test(rawQuery)) {
          intent = 'THESIS_REQUIREMENTS';
          domain = 'ACADEMIC_CURRICULUM';
        } else {
          intent = 'ADMISSION_REQUIREMENTS';
          domain = 'PMB';
        }
      } else if (aspects.includes('curriculum')) {
        intent = 'CURRICULUM_INQUIRY';
        domain = 'ACADEMIC_CURRICULUM';
      } else if (aspects.includes('accreditation')) {
        intent = 'ACCREDITATION_INQUIRY';
        domain = 'ACCREDITATION';
      } else if (aspects.includes('career') || aspects.includes('career_prospects') || aspects.includes('prospek_karir') || primaryConcept === 'CAREER_PROSPECT') {
        const hasAcademicProgram = (resolvedEntities || []).some(e => e.family === 'academic_program' || e.type === 'program');
        intent = 'CAREER_PROSPECTS_INQUIRY';
        domain = hasAcademicProgram ? 'ACADEMIC_PROGRAM' : 'CAREER_CENTER';
      }
    }

    if (isCurriculumInquiry && resolvedEntities.some(e => e.family === 'academic_program' || e.type === 'program')) {
      domain = 'ACADEMIC_CURRICULUM';
      intent = 'CURRICULUM_INQUIRY';
      if (!aspects.includes('curriculum')) aspects.push('curriculum');
      if (!aspects.includes('courses')) aspects.push('courses');
    }

    // Detect foreign participant scope
    const isForeign = /\b(mahasiswa\s+asing|visa|itas|kitas|izin\s+belajar|e-visa)\b/i.test(rawQuery);
    const participantScope = isForeign ? 'foreign' : 'domestic';

    // Unsupported entity check: only genuine unoffered majors (e.g. Kedokteran, Teknik Nuklir, Farmasi)
    const isAcademicDomain = ['ACADEMIC_PROGRAM', 'ACADEMIC_CURRICULUM', 'UNSUPPORTED_PROGRAM', 'GENERAL'].includes(domain);
    const rawDetected = isAcademicDomain ? (detectedUnsupportedMention || (syncFrame.domain === 'UNSUPPORTED_PROGRAM' ? syncFrame.unsupportedProgramName : null)) : null;
    const isUnsupported = Boolean(rawDetected || domain === 'UNSUPPORTED_PROGRAM') && isAcademicDomain;
    const unsupportedName = isUnsupported ? (rawDetected || detectedUnsupportedMention || syncFrame.unsupportedProgramName || 'tersebut') : null;
    const isOOD = domain === 'OUT_OF_DOMAIN';

    const academicScope = syncFrame.academicScope || resolveAcademicScope(rawQuery);
    const effectiveScopeLevel = academicScope.status === ACADEMIC_SCOPE_STATUS.UNSUPPORTED
      ? 'UNSUPPORTED'
      : (academicScope.status === ACADEMIC_SCOPE_STATUS.SUPPORTED
        ? academicScope.level
        : (syncFrame.scopeLevel ||
          (effectiveLevel === 'S1' ? 'S1' : (effectiveLevel === 'S2' ? 'S2' : (effectiveLevel === 'D3' ? 'D3' : (intent === 'AVAILABLE_PROGRAMS_LIST' ? 'ALL' : null))))));

    // Semantic location resolution: AI model interpretation takes precedence over deterministic regex
    const isModelParsed = !interpretation.metadata?.fallbackInvoked && validationResult.isValid;
    let resolvedLocationScope;
    let resolvedTargetBranch;

    if (isModelParsed && validated.scopeConstraints?.locationScope) {
      resolvedLocationScope = validated.scopeConstraints.locationScope;
      const rawConstraint = validated.scopeConstraints.locationConstraint;
      if (rawConstraint && rawConstraint.toLowerCase() !== 'all') {
        const canonicalEntity = findCanonicalEntity(rawConstraint.trim());
        if (canonicalEntity && (canonicalEntity.family === 'campus_location' || canonicalEntity.type === 'campus')) {
          const canon = canonicalEntity.canonical;
          if (/renon/i.test(canon)) {
            resolvedTargetBranch = 'renon';
          } else if (/jimbaran/i.test(canon)) {
            resolvedTargetBranch = 'jimbaran';
          } else if (/abiansemal/i.test(canon)) {
            resolvedTargetBranch = 'abiansemal';
          } else {
            resolvedTargetBranch = null;
          }
        } else {
          resolvedTargetBranch = null;
        }
      } else {
        resolvedTargetBranch = null;
      }

      if (resolvedLocationScope === 'ALL') {
        if (!aspects.includes('all_locations')) aspects.push('all_locations');
      } else {
        // Enforce: AI SINGLE or GENERAL must NOT have all_locations aspect (prevents sync regex override)
        const allLocIdx = aspects.indexOf('all_locations');
        if (allLocIdx !== -1) aspects.splice(allLocIdx, 1);
      }
    } else {
      // Deterministic fallback when AI model interpretation is unavailable or invalid
      resolvedLocationScope = syncFrame.locationScope || (syncFrame.targetBranch ? 'SINGLE' : (aspects.includes('all_locations') ? 'ALL' : 'GENERAL'));
      resolvedTargetBranch = syncFrame.targetBranch || null;
    }

    if (resolvedLocationScope === 'ALL' || resolvedLocationScope === 'SINGLE' || aspects.includes('location')) {
      if (!domain || domain === 'FACILITIES' || primaryConcept === 'CAMPUS_LIFE' || syncFrame.domain === 'FACILITIES') {
        domain = 'FACILITIES';
        intent = 'CAMPUS_LOCATION';
        ['location', 'campus_location', 'address'].forEach(a => { if (!aspects.includes(a)) aspects.push(a); });
      }
    }

    const finalAspects = filterNegatedSemanticAspects(rawQuery, aspects);

    return composeSemanticElements({
      rawQuery,
      speechAct,
      userInterest: validated.userInterest || syncFrame.userInterest || null,
      semanticConcepts: Array.isArray(validated.semanticConcepts) ? validated.semanticConcepts : (syncFrame.semanticConcepts || []),
      isAmbiguous: Boolean(validated.ambiguityLevel === 'HIGH' || syncFrame.isAmbiguous),
      ambiguityLevel: validated.ambiguityLevel || syncFrame.ambiguityLevel || 'LOW',
      confidence: typeof validated.confidence === 'number' ? validated.confidence : (syncFrame.confidence || 1.0),
      preferences: validated.preferences || syncFrame.preferences || null,
      rawQuery,
      normalizedQuery: syncFrame.normalizedQuery,
      academicLevel: effectiveLevel,
      academicScope,
      scopeLevel: effectiveScopeLevel,
      domain: isUnsupported ? 'UNSUPPORTED_PROGRAM' : domain,
      intent: isUnsupported ? 'UNSUPPORTED_PROGRAM_INQUIRY' : intent,
      retrievalRequired: speechAct !== 'GENERAL_GREETING' && speechAct !== 'SOCIAL_INQUIRY' && domain !== 'CONVERSATIONAL' && !isUnsupported && !isOOD,
      entities: resolvedEntities,
      candidateEntities: validated.candidateEntities || syncFrame.candidateEntities || [],
      modifiers: syncFrame.modifiers || [],
      constraints: {
        admissionTrack: null,
        participantScope
      },
      participantScope,
      isMultiTarget: resolvedEntities.length > 1,
      relation: syncFrame.relation,
      locationScope: resolvedLocationScope,
      targetBranch: resolvedTargetBranch,
      isProximityComparison: syncFrame.isProximityComparison || aspects.includes('proximity_comparison') || false,
      userOrigin: syncFrame.userOrigin || extractUserOriginLocation(rawQuery, sessionData) || null,
      aspects: finalAspects,
      temporal: syncFrame.temporal,
      userState: syncFrame.userState,
      desiredAction: isUnsupported ? 'REFUSE_UNSUPPORTED_PROGRAM' : (isOOD ? 'REFUSE_OUT_OF_DOMAIN' : (intent === 'CURRICULUM_INQUIRY' ? 'PROVIDE_CURRICULUM_INFO' : syncFrame.desiredAction)),
      language: detectQueryLanguage(rawQuery),
      subQueries: [],
      contextDependencies: validated.contextDependency?.isFollowUp
        ? [validated.contextDependency]
        : (Array.isArray(syncFrame.contextDependencies) ? syncFrame.contextDependencies : []),
      unsupportedEntity: isUnsupported,
      unsupportedEntityName: unsupportedName,
      entityResolutionStatus: isUnsupported ? 'UNSUPPORTED' : (resolvedEntities.length > 0 ? 'RESOLVED' : 'UNRESOLVED'),
      isUnsupportedEntity: isUnsupported,
      unsupportedProgramName: unsupportedName,
      traceMeta: {
        resolverEngine: 'ai_model_semantic_parser',
        model: interpretation.metadata?.model || 'gpt-6-luna',
        speechAct,
        concepts: interpretation.semanticConcepts,
        elapsedMs: Date.now() - startTime
      }
    }, rawQuery, syncFrame.normalizedQuery);
  } catch (err) {
    logger.warn({ err: err.message }, '[semanticFrameResolver] AI frame resolution failed; falling back to deterministic');
    return {
      ...syncFrame,
      traceMeta: {
        resolverEngine: 'deterministic_fallback_on_error',
        error: err.message,
        elapsedMs: Date.now() - startTime
      }
    };
  }
}

module.exports = {
  isPrivacyViolationQuery,
  normalizeQueryText,
  inferDomainAndIntent,
  resolveSemanticFrame,
  resolveSemanticFrameAsync,
  resolveSemanticFrameWithShadow,
  buildConciseConversationHistory,
  getShadowAuditHistory,
  clearShadowAuditHistory,
  detectQueryLanguage,
  extractUserOriginLocation,
  detectUnsupportedProgram,
  composeSemanticElements,
  hasGenuineProgramFitSignal
};
