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
const { ACADEMIC_SCOPE_STATUS, resolveAcademicScope } = require('./academicCatalog');
const modelSemanticParser = require('./modelSemanticParser');
const { validateSemanticInterpretation, compareFrames } = require('./semanticInterpretationValidator');
const logger = require('../logger');

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

const INSTITUTIONAL_ANCHOR_REGEX = /\b(?:stikom|kampus|kuliah|perkuliahan|akademik|pmb|mahasiswa|dosen|prodi|jurusan|fakultas|sarjana|diploma|magister|pascasarjana|s1|s2|d3|biaya|spp|dpp|uang\s+kuliah|uang\s+gedung|beasiswa|pendaftaran|daftar|syarat|persyaratan|berkas|dokumen|gelombang|jadwal|kurikulum|matkul|mata\s+kuliah|sks|akreditasi|ban-?pt|lam-?infokom|fasilitas|laboratorium|lab|perpustakaan|asrama|parkir|ukm|ormawa|organisasi|wisuda|yudisium|rpl|magang|lulus|lulusan|kelulusan|karir|karier|alumni|universitas|institut|sekolah\s+tinggi|dual\s+degree|double\s+degree|degree|gelar|ijazah|sebutan|durasi|program\s+studi|studi|masa\s+studi|lama\s+studi|waktu\s+studi|university|college|campus|student|students|lecturer|professor|tuition|fee|fees|scholarship|admission|admissions|register|registration|curriculum|course|courses|credit|credits|accreditation|facility|facilities|laboratory|laboratories|library|dormitory|dorm|graduation|graduate|graduating|thesis|final\s+project|defense|internship|career|careers|degree|duration|study\s+duration|student\s+exchange|parking|undergraduate|bachelor|master|postgraduate|study\s+programs?|academic\s+programs?|degree\s+programs?|majors?|soft\s*skills?|pengembangan\s+(?:soft\s*skills?|karakter|mahasiswa)|pelatihan\s+soft\s*skills?|career\s+center|pusat\s+karier|cdc|kontak|telepon|whatsapp|narahubung)\b/i;

const PROTECTED_CANONICAL_WORDS = new Set([
  'dan', 'atau', 'ke', 'di', 'dari', 'pada', 'untuk', 'dengan', 'ada', 'bisa', 'boleh', 'mau', 'ingin', 'saya', 'kami', 'kita', 'dia', 'ini', 'itu', 'apa', 'siapa', 'mana', 'kapan', 'sudah', 'belum', 'tidak', 'bukan'
]);

function extractUserOriginLocation(text, sessionData = {}) {
  if (!text || typeof text !== 'string') return sessionData?.userOrigin || null;
  const cleaned = text.trim();
  const m = cleaned.match(/\b(?:tinggal\s+di|dari|rumah\s+(?:saya\s+)?di|domisili(?:\s+di)?|posisi(?:\s+di)?|lokasi\s+(?:saya\s+)?di)\s+([a-zA-Z0-9\s,]+?)(?:\s+(?:jadi|maka|saya|lebih|kampus|enaknya|bagusnya|bagaimana|gimana|gmn|apa|apakah|kira-kira|kira2)|[?,.]|$)/i);
  if (m && m[1]) {
    const rawOrigin = m[1]
      .replace(/\b(?:saya|kalau|kalo|aku|kami|ya|nih|sih)\b/gi, '')
      .replace(/\b(?:bagaimana|gimana|gmn|apa|apakah)\b/gi, '')
      .trim();

    // Generic spatial or relative terms that do NOT represent a geographical city/district
    const isNonGeographic = /^(?:rumah(?:\s+saya)?|tempat(?:\s+tinggal)?(?:\s+saya)?|posisi(?:\s+saya)?|lokasi(?:\s+saya)?|ko?st?(?:\s+saya)?|kantor(?:\s+saya)?|sekolah(?:\s+saya)?|kampus|sini|sana|situ|mana|luar|dalam|daerah(?:\s+saya)?|wilayah(?:\s+saya)?)$/i.test(rawOrigin);

    if (rawOrigin.length >= 2 && rawOrigin.length <= 40 && !isNonGeographic) {
      // Explicit new origin location: strictly use the newly specified location without merging
      return rawOrigin;
    }
    // Ambiguous, non-geographic, or invalid location extraction attempt
    return null;
  }
  // Follow-up message without a new location: retain active session origin if relevant
  return sessionData?.userOrigin || null;
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

function detectUnsupportedProgram(rawQuery, entities = []) {
  const hasKnownEntity = entities.some(
    e => ['academic_program', 'international_program', 'student_organization', 'facility', 'scholarship', 'campus_service'].includes(e.family || e.type)
  );
  if (hasKnownEntity) return null;

  const q = String(rawQuery || '').toLowerCase().trim();

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
  let hasSignals = false;
  try {
    const { detectProgramFitSignals } = require('../engine/programFitReasoning');
    if (typeof detectProgramFitSignals === 'function') {
      hasSignals = detectProgramFitSignals(q).length > 0;
    }
  } catch (_) { }

  if ((/\b(?:cocok(?:nya)?|rekomendasi|saran|pas|bingung)\b/i.test(q) &&
    /\b(?:jurusan|prodi|program\s*studi|kuliah)\b/i.test(q)) ||
    (hasSignals && /\b(?:tertarik|suka|minat|hobi|passion|senang|bakat)\b/i.test(q))) {
    return null;
  }

  const STOP_TOKENS = new Set([
    'di', 'ke', 'dari', 'pada', 'untuk', 'dengan', 'yang', 'ini', 'itu', 'tersebut',
    'apa', 'ada', 'bisa', 'boleh', 'mau', 'ingin', 'pilihan', 'saja', 'aja', 'kak',
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

  // Pattern 4: Direct inquiry of well-known non-offered academic disciplines (e.g. "kedokteran", "farmasi", "kebidanan", "keperawatan", "hukum", "psikologi", "akuntansi", "arsitektur")
  const commonDisciplines = /\b(kedokteran(?:\s+gigi|\s+hewan)?|farmasi|kebidanan|keperawatan|hukum|psikologi|akuntansi|arsitektur|pertanian|peternakan|teknik\s+nuklir)\b/i;
  const directMatch = q.match(commonDisciplines);
  if (directMatch && directMatch[1]) {
    const candidate = directMatch[1].trim();
    const known = findCanonicalEntity(candidate);
    if (!known) {
      return candidate;
    }
  }

  return null;
}

function normalizeQueryText(text) {
  if (!text || typeof text !== 'string') return '';
  let norm = text
    .toLowerCase()
    .replace(/[?!,.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // If query is English, preserve English phrasing without Indonesian enclitic or lexicon mutation
  if (detectQueryLanguage(text) === 'en') {
    return norm;
  }

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
function inferDomainAndIntent(normalized, entities = [], sessionData = {}, unstemmed = '', raw = '') {
  // 0. Conversational Greeting & Small Talk (Non-Retrieval)
  if (/^(hallo+|halo+|hai+|hi+|hei+|pagi|siang|sore|malam|assalamu'?alaikum|selamat\s+(pagi|siang|sore|malam)|sampurasun|om\s+swastiastu)\b/i.test(normalized) &&
    !/\b(biaya|daftar|jurusan|prodi|beasiswa|kuliah|akreditasi|perwalian|krs|mata\s*kuliah|sks)\b/i.test(normalized)) {
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

  if (/\b(apa\s+kh?abar|bagaimana\s+kh?abar(?:mu)?|gimana\s+kh?abar(?:mu)?|kh?abar(?:nya)?\s+gimana|kamu\s+siapa|siapa\s+kamu|kamu\s+robot)\b/i.test(normalized)) {
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

  // 0.05 Conversational Closing / Acknowledgement
  if (/^(oke+|ok+|baik+|terima\s*kasih|makasih|thanks|thank\s*you|siap|sip|noted|mantap)\b/i.test(normalized) &&
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

  // 1. Specialized Campus Service / Career Center (Takes precedence over generic vocabulary like "fasilitas", "biaya", "cara")
  const campusServiceEntity = entities.find(e => e.family === 'campus_service');
  const isInternationalInternship = /\b(?:magang\s+(?:di\s+|ke\s+)?(?:luar\s+negeri|jepang)|bekerja\s+(?:di\s+|ke\s+)?luar\s+negeri|hi-?think)\b/i.test(normalized);
  if (!isInternationalInternship && (campusServiceEntity || /\b(?:career\s+center|cdc\b|inbis|inkubator\s+bisnis|magang|internship|campus\s+hiring|rekrutmen|kerja\s+sama|mitra\s+industri|penyaluran\s+kerja|perusahaan\s+kami)\b/i.test(normalized))) {
    const isCareer = (campusServiceEntity && (campusServiceEntity.canonical.includes('CDC') || campusServiceEntity.canonical.includes('Career') || campusServiceEntity.canonical.includes('LinkedIn'))) ||
      /\b(?:career|cdc\b|magang|internship|campus\s+hiring|rekrutmen|penyaluran\s+kerja)\b/i.test(normalized);
    const isLLC = (campusServiceEntity && /language\s+learning\s+center|llc/i.test(campusServiceEntity.canonical)) ||
      /\b(?:llc|language\s+learning\s+center)\b/i.test(normalized);
    return {
      domain: isCareer ? 'CAREER_CENTER' : 'CAMPUS_SERVICE',
      intent: isCareer ? 'CAREER_CENTER_INQUIRY' : 'CAMPUS_SERVICE_INQUIRY',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: isCareer ? 'PROVIDE_CAREER_CENTER_INFO' : 'PROVIDE_CAMPUS_SERVICE_INFO',
      aspects: isCareer ? ['internship', 'career_services', 'cooperation', 'facilities'] : (isLLC ? ['facilities', 'campus_service', 'service_info'] : ['service_info', 'support', 'facilities']),
      relation: isCareer ? 'CAREER_SERVICES' : 'CAMPUS_SERVICE'
    };
  }

  // 2. Admission Tracks / Transfer / RPL (Rekognisi Pembelajaran Lampau)
  const isFeeQuery = /\b(biaya(?:nya)?|biaya kuliah|spp(?:nya)?|dpp(?:nya)?|uang\s+kuliah(?:nya)?|uang\s+pangkal|bayar\s+kuliah|bayar\s+berapa|angsuran|potongan\s+biaya|cicilan)\b/i.test(normalized);
  const admissionTrackEntity = entities.find(e => e.family === 'admission_track');
  if (!isFeeQuery && (admissionTrackEntity || /\b(?:rpl|rekognisi\s+pembelajaran\s+lampau|transfer\s+sks|alih\s+jenjang|lanjut\s+s1|pindahan)\b/i.test(normalized))) {
    const isRPL = (admissionTrackEntity && admissionTrackEntity.canonical.includes('RPL')) ||
      /\b(?:rpl|rekognisi|transfer\s+sks|alih\s+jenjang)\b/i.test(normalized);
    const isProcedure = /\b(?:alur|cara|prosedur|syarat|persyaratan|berkas|dokumen|daftar)\b/i.test(normalized);
    return {
      domain: 'ADMISSION_TRACK',
      intent: isRPL ? (isProcedure ? 'RPL_PROCEDURE' : 'RPL_INQUIRY') : 'ADMISSION_TRACK_INQUIRY',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: isRPL ? 'PROVIDE_RPL_INFO' : 'PROVIDE_ADMISSION_TRACK_INFO',
      aspects: isRPL ? ['rpl', 'credit_transfer', 'procedure', 'requirements'] : ['admission_track', 'requirements'],
      relation: isRPL ? 'RPL_ADMISSION' : 'ADMISSION_TRACK'
    };
  }

  // 3. International Programs & Collaborations (Double Degree, Magang Luar Negeri, GCCP, Student Exchange)
  if (entities.some(e => e.family === 'international_program') || /\b(double degree|dual degree|international program|pertukaran\s+(?:pelajar|mahasiswa)|student exchange|gccp|bccp|magang\s+(?:ke\s+)?jepang|magang\s+(?:di\s+|ke\s+)?luar\s+negeri|bekerja\s+(?:di\s+|ke\s+)?luar\s+negeri|hi-?think|international\s+student\s+exchange|exchange\s+options?|study\s+abroad)\b/i.test(normalized)) {
    let intent = 'INTERNATIONAL_PROGRAM_INFO';
    const aspects = [];
    let relation = 'PROGRAM_DETAILS';

    const hasLocationSignal = /\b(?:full\s+di\s+stikom|di\s*mana|dimana|lokasi|tempat\s+kuliah|tempat\s+studi|kuliah\s+di\s+luar|ke\s+luar\s+negeri|onsite|offline|where(?:\s+is)?|study\s+location)\b/i.test(normalized) ||
      /\b(?:full\s+di\s+stikom|di\s*mana|dimana|lokasi|tempat\s+kuliah|tempat\s+studi|kuliah\s+di\s+luar|ke\s+luar\s+negeri|onsite|offline|where(?:\s+is)?|study\s+location)\b/i.test(unstemmed) ||
      /\b(?:kuliah|studi|perkuliahan|pergi|berangkat|harus|wajib)\s+(?:ke|di)\s+(?:china|cina|malaysia|dalian)\b/i.test(normalized) ||
      /\b(?:kuliah|studi|perkuliahan|pergi|berangkat|harus|wajib)\s+(?:ke|di)\s+(?:china|cina|malaysia|dalian)\b/i.test(unstemmed);

    if (hasLocationSignal) {
      intent = 'STUDY_LOCATION';
      aspects.push('study_location', 'location');
      relation = 'LOCATION_MODE';
    } else if (/\b(keuntungan(?:nya)?|manfaat(?:nya)?|benefit(?:nya)?|kelebihan(?:nya)?|gelar(?:nya)?)\b/i.test(normalized) ||
      /\b(keuntungan|manfaat|benefit|kelebihan|gelar)\b/i.test(unstemmed)) {
      intent = 'PROGRAM_BENEFIT';
      aspects.push('benefits', 'degree_award');
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
  if (/\b(?:tugas\s+akhir|skripsi|pedoman\s+ta|menulis\s+ta|syarat\s+ta|\bta\b|final\s+project|thesis|thesis\s+defense|final\s+project\s+defense)\b/i.test(normalized)) {
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
  if (/\b(kurikulum(?:nya)?|mata\s*kuliah|matkul|sebaran\s*mata\s*kuliah|silabus|daftar\s*matkul|belajar\s+mata\s*kuliah|semester\s*(?:[1-8]|[ivx]+)|(?:apa\s+yang\s+)?dipelajari|pembelajaran|materi\s+kuliah|pelajaran)\b/i.test(normalized)) {
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

  // 6. Available Programs Listing (Generic Scope vs Specific Entity)
  const hasSpecificProgramEntity = entities.some(e => e.family === 'academic_program' && e.type === 'program');
  const hasStudentOrgEntity = entities.some(e => e.family === 'student_organization');
  // 6b. Program Recommendation Inquiry (e.g. "cocoknya masuk prodi apa", "rekomendasi jurusan", "suka coding software dan bikin aplikasi", "jurusan apa yang pas")
  const isNonAcademicInquiry = entities.some(e => ['scholarship', 'campus_service', 'student_organization', 'facility', 'campus_facility'].includes(e.family)) ||
    /\b(?:beasiswa|kip\s*kuliah|kip-?k|inkubator|inbis|career\s+center|cdc\b|ukm\b|unit\s+kegiatan\s+mahasiswa|organisasi\s+mahasiswa|ormawa|hima\b|himaprodi|student\s+clubs?|student\s+organizations?|asrama|laboratorium|fasilitas)\b/i.test(normalized);

  let hasFitSignals = false;
  try {
    const { detectProgramFitSignals } = require('../engine/programFitReasoning');
    if (typeof detectProgramFitSignals === 'function') {
      hasFitSignals = detectProgramFitSignals(normalized).length > 0;
    }
  } catch (_) { }

  const isRecommendationInquiry = !hasSpecificProgramEntity && !isNonAcademicInquiry && (
    (/\b(?:rekomendasi|rekomendasikan|cocok(?:nya)?|saran|bingung\s+pilih|pas)\b/i.test(normalized) &&
      (/\b(?:prodi|jurusan|program\s*studi|kuliah)\b/i.test(normalized) || /\b(?:suka|minat|hobi|bakat|passion)\b/i.test(normalized))) ||
    (/\b(?:suka|minat|hobi|bakat|passion|tertarik|senang|cita-?cita)\b/i.test(normalized) &&
      /\b(?:prodi|jurusan|program\s*studi|kuliah|pilih(?:an)?|ambil|masuk)\b/i.test(normalized))
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

  // 6a. Available Academic Programs List (Generic query across all programs)
  const hasProgramConcept = /\b(?:program\s*(?:studi|sarjana|diploma|magister|doktor)?|jurusan|prodi|fakultas|jenjang|pilihan\s+kuliah|kuliah|study\s+programs?|majors?|departments?|facult(?:y|ies)|(?:undergraduate|bachelor|master|postgraduate|doctoral|doctorate|phd|diploma|degree|academic|study)\s+programs?|s1|s2|s3|d3|d4)(?:nya)?\b/i.test(normalized);
  const hasListingConcept = /\b(?:apa\s+saja|ada\s+apa|pilihan|daftar|list|opsi|tersedia|bisa\s+ambil\s+apa|punya|mau\s+lihat|pilihannya|apa|what(?:\s+are|\s+is)?|which|available|offered|offer|options?)\b/i.test(normalized);
  const hasScopeConcept = /\b(?:pascasarjana|magister|sarjana|diploma|undergraduate|postgraduate|master|bachelor)\b/i.test(normalized);

  const isAvailableProgramsInquiry = !hasSpecificProgramEntity && !hasStudentOrgEntity && hasProgramConcept && (hasListingConcept || hasScopeConcept) &&
    !/\b(?:biaya|bayar|daftar\s+ulang|syarat|akreditasi|kurikulum|matkul|beasiswa|lokasi|jadwal|bingung|rekomendasi|rekomendasikan|cocok|saran|minat|himpunan|himaprodi|hima|ukm|ormawa|fee|fees|cost|tuition|scholarship|requirements?)\b/i.test(normalized);

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
  const hasStudentOrg = entities.some(e => e.family === 'student_organization') || /\b(himpunan\s+mahasiswa|himaprodi|hima\b|ukm\b|ormawa)\b/i.test(normalized);
  const isFeeInquiry = /\b(?:biaya|bayar|uang|spp|dpp|tarif|cicilan|harga|cost|fee)\b/i.test(normalized);
  if (!isFeeInquiry && !hasStudentOrg && ((/\b(apa\s+itu|pengertian|definisi|profil|tentang|penjelasan|deskripsi|gambaran|belajar\s+apa|mempelajari\s+apa|fokus(?:nya)?(?:\s+apa|\s+jurusan)?|kuliah\s+tentang\s+apa|prospek(?:nya)?|peluang\s+kerja|lulusan(?:nya)?\s+(?:bisa\s+)?jadi\s+apa|lulusan|kerja\s+(?:sebagai\s+|menjadi\s+)?apa|bekerja\s+(?:sebagai\s+|menjadi\s+)?apa|jadi\s+apa|profesi|karir|karier|gelar(?:nya)?|(?:ingin|mau)\s+tahu\s+(?:tentang\s+)?(?:prodi|program\s*studi|jurusan)?|(?:info|informasi)\s+(?:tentang|lengkap|seputar)\s+(?:prodi|program\s*studi|jurusan)?)\b/i.test(normalized) && hasAcademicProgram) ||
    (/\b(apa\s+itu\s+program\s+studi|profil\s+prodi|profil\s+program\s+studi|gambaran\s+program\s+studi|gambaran\s+prodi)\b/i.test(normalized)))) {
    const isDegreeInquiry = /\b(gelar(?:nya)?)\b/i.test(normalized);
    return {
      domain: 'ACADEMIC_PROGRAM',
      intent: isDegreeInquiry ? 'DEGREE_AWARD' : 'PROGRAM_OVERVIEW',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: isDegreeInquiry ? 'PROVIDE_DEGREE_INFO' : 'PROVIDE_PROGRAM_OVERVIEW',
      aspects: isDegreeInquiry ? ['degree_award', 'overview'] : ['overview', 'definition'],
      relation: isDegreeInquiry ? 'DEGREE_AWARD' : 'PROGRAM_OVERVIEW'
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
  if (/\b(kuliah sore|kelas karyawan|kuliah malam|untuk yang bekerja|sambil kerja|kelas malam|kuliah sambil kerja)\b/i.test(normalized)) {
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
  if (entities.some(e => e.family === 'scholarship') || /\b(beasiswa(?:nya)?|kip\s*kuliah|kip-?k|potongan\s+dpp|keringanan\s+biaya|bantuan\s+dana\s+pendidikan)\b/i.test(normalized)) {
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
    const facilityAspects = ['facilities', 'lab', 'campus_infrastructure'];
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
      relation: 'CAMPUS_FACILITIES'
    };
  }

  // 13. Tuition Fee / Biaya Kuliah (Prioritized before PMB schedule when cost/fee is asked)
  const hasScheduleOrCalendarFocus = /\b(?:kapan|tanggal|jadwal|periode|kalender|buka|dibuka|ditutup|tutup|batas\s+(?:waktu|pendaftaran)|apa\s+saja|daftar\s+gelombang|pembagian\s+gelombang)\b/i.test(normalized);
  const hasFeeFocus = /\b(?:biaya|potongan|diskon|total|dpp|spp|bayar|uang\s+kuliah|uang\s+gedung|angsuran|cicilan)\b/i.test(normalized);
  const isAdmissionScheduleOrStatus = !hasFeeFocus && (
    /\b(?:sekarang\s+buka|buka\s+gelombang|buka\s+pendaftaran|kapan\s+(?:buka|dibuka|ditutup|tutup)|jadwal\s+(?:gelombang|pendaftaran|pmb)|periode\s+(?:gelombang|pendaftaran)|kalender\s+pmb|gelombang\s+berapa)\b/i.test(normalized) ||
    (/\bgelombang\b/i.test(normalized) && (hasScheduleOrCalendarFocus || /\bpmb\b/i.test(normalized)))
  );

  const isWaveFeeFollowup = !isAdmissionScheduleOrStatus && !hasScheduleOrCalendarFocus && (
    (/\b(?:kalau\s+|kalo\s+)?gelombang\s*(?:[1-4]|i{1,4}|[0-9]+[a-z]?|khusus|awal|sisipan)\s*(?:berapa|biaya(?:nya)?|potongan(?:nya)?|diskon(?:nya)?|dpp(?:nya)?|total(?:nya)?)\b/i.test(normalized)) ||
    (/\bgelombang\s*(?:[1-4]|i{1,4}|[0-9]+[a-z]?|khusus|awal|sisipan)\b/i.test(normalized) && hasFeeFocus) ||
    ((sessionData?.activeDomain === 'TUITION_FEE' || Boolean(sessionData?.activeEntity)) &&
      /\b(?:kalau\s+|kalo\s+)gelombang\s*(?:[1-4]|i{1,4}|[0-9]+[a-z]?|khusus|awal|sisipan)\s*(?:berapa|gimana|bagaimana)?$/i.test(normalized))
  );

  if (isWaveFeeFollowup || /\b(biaya(?:nya)?|biaya\s+kuliah|spp(?:nya)?|dpp(?:nya)?|uang\s+kuliah(?:nya)?|uang\s+pangkal|uang\s+gedung|biaya\s+gedung|bayar\s+kuliah|bayar\s+berapa|angsuran|potongan\s+biaya|cicilan|tuition(?:\s+fee)?|tuition\s+cost|cost\s+of\s+study|fees?|fee\s+per\s+semester|semester\s+fee|pay\s+each\s+semester|installment)\b/i.test(normalized)) {
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

  // 14. Academic Graduation Requirement (SKS lulus / Tugas Akhir / Kelulusan) vs Thesis Guidance Procedure
  if (/\b(?:sks|jumlah\s+sks|sks\s+lulus|beban\s+sks|beban\s+studi|kelulusan|tugas\s+akhir|skripsi|credits?|total\s+credits?|graduation|graduating|graduate|final\s+project|thesis|defense|final\s+project\s+defense|thesis\s+defense|academic\s+requirements?|graduation\s+requirements?)\b/i.test(normalized) &&
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
    /\b(?:uas|uts|ujian\s+akhir\s+semester|ujian\s+tengah\s+semester|kalender\s+akademik)\b/i.test(normalized));
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
  if (/\b(?:pmb|pendaftaran|mendaftar|daftar\s+(?:kuliah|online|ulang|pmb|mahasiswa|stikom)|syarat|persyaratan|dokumen|berkas|gelombang|masih dibuka|kapan buka|jalur pendaftaran|mulai dari mana|proses masuk|cara masuk)\b/i.test(normalized) ||
    (/\b(?:daftar|mendaftar)\b/i.test(normalized) && !/\b(?:daftar\s+harga|daftar\s+menu|daftar\s+matkul|daftar\s+mata\s+kuliah|daftar\s+prodi|daftar\s+jurusan|daftar\s+program)\b/i.test(normalized))) {
    const isWhenQuestion = /\b(?:kapan|sampai\s+kapan)\b/i.test(normalized);
    const isNow = TEMPORAL_NOW_REGEX.test(normalized) || /\b(?:status\s+pendaftaran|status\s+pmb)\b/i.test(normalized);
    if (isNow && !isWhenQuestion && /\b(?:gelombang|buka|dibuka|ditutup|tutup|jadwal|periode|status)\b/i.test(normalized)) {
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

    const isProcedureOrRequirements = /\b(?:cara\s+(?:daftar|mendaftar)|bagaimana\s+(?:cara\s+)?(?:daftar|mendaftar)|syarat|persyaratan|dokumen|berkas|alur|prosedur|mulai\s+dari\s+mana|proses\s+masuk|cara\s+masuk)\b/i.test(normalized);
    const isTopicOpener = isProcedureOrRequirements ||
      /\b(saya\s+ingin\s+bertanya\s+tentang\s+pmb|mau\s+tanya\s+pmb|info\s+pmb|tentang\s+pmb|informasi\s+pmb|bagaimana\s+pmb|pendaftaran\s+stikom|daftar\s+stikom)\b/i.test(normalized) ||
      (!/\b(gelombang|kapan|jadwal|tanggal|buka sampai|periode)\b/i.test(normalized) && /\b(pmb|pendaftaran)\b/i.test(normalized) && !/\b(biaya|bayar|kurikulum|beasiswa)\b/i.test(normalized));

    if (isTopicOpener) {
      return {
        domain: 'PMB',
        intent: isProcedureOrRequirements ? 'ADMISSION_PROCEDURE' : 'GENERAL_PMB_INQUIRY',
        retrievalRequired: true,
        userState: 'INQUIRING',
        desiredAction: isProcedureOrRequirements ? 'PROVIDE_ADMISSION_PROCEDURE' : 'PROVIDE_GENERAL_PMB_OVERVIEW',
        aspects: isProcedureOrRequirements ? ['procedure', 'requirements', 'documents'] : ['admission_overview', 'procedure', 'admission_pathways'],
        relation: 'PMB_OVERVIEW'
      };
    }

    return {
      domain: 'PMB',
      intent: 'ADMISSION_SCHEDULE',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_PMB_STATUS',
      aspects: ['schedule', 'status', 'wave_info'],
      relation: 'ADMISSION_WINDOW'
    };
  }

  // 14. Program Comparison (Perbedaan Prodi)
  const hasProgramEntity = entities.some(e => e.family === 'academic_program' || e.type === 'program');
  if (/\b(perbedaan|beda|bedanya|banding|dibandingkan|difference|differ|compare|comparison|versus|vs)\b/i.test(normalized) &&
    (/\b(prodi|jurusan|program\s+studi|program|programs|majors?|courses?)\b/i.test(normalized) || hasProgramEntity || entities.length >= 2)) {
    return {
      domain: 'ACADEMIC_PROGRAM',
      intent: 'PROGRAM_COMPARISON',
      retrievalRequired: true,
      userState: 'INQUIRING',
      desiredAction: 'PROVIDE_PROGRAM_DIFFERENTIATION',
      aspects: ['curriculum_difference', 'career_prospects'],
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
  const isAskingCampusLocation = isAskingProximity ||
    /\b(?:lokasi\s+kampus|alamat\s+kampus|kampus(?:nya)?\s+di\s*mana|dimana\s+kampus|letak\s+kampus|gedung\s+kampus\s+di\s*mana|kampus\s+renon|kampus\s+jimbaran|kampus\s+abiansemal)\b/i.test(normalized) ||
    (/\b(?:lokasi|alamat|di\s*mana|dimana)\b/i.test(normalized) && /\b(?:kampus|stikom|itb\s+stikom)\b/i.test(normalized)) ||
    (/\b(?:berapa\s+(?:ada\s+)?kampus|ada\s+berapa\s+kampus|berapa\s+jumlah\s+kampus|jumlah\s+kampus|berapa\s+banyak\s+kampus|berapa\s+(?:ada\s+)?cabang|ada\s+berapa\s+cabang)\b/i.test(normalized)) ||
    (/\b(?:berapa\s+ada|ada\s+berapa|berapa\s+jumlah|berapa\s+banyak)\b/i.test(normalized) && /\b(?:kampus|cabang)\b/i.test(normalized)) ||
    (/\b(?:lokasi(?:nya)?\s+di\s*mana(?:\s+saja)?|di\s*mana(?:\s+saja)?\s+lokasi(?:nya)?|dimana(?:\s+saja)?\s+lokasi(?:nya)?|lokasi(?:nya)?\s+mana\s+saja)\b/i.test(raw + ' ' + normalized)) ||
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
  const hasInstitutionalGrounding = entities.length > 0 ||
    INSTITUTIONAL_ANCHOR_REGEX.test(normalized) ||
    INSTITUTIONAL_ANCHOR_REGEX.test(raw);

  if (!hasInstitutionalGrounding) {
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

  const unstemmedQuery = raw
    .toLowerCase()
    .replace(/[?!,.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 1. Check Context Dependency (Pronoun or Genuine Ellipsis)
  const contextDep = evaluateContextDependency(raw, sessionData);

  // 2. Extract Canonical Entities & Deduplicate by Canonical
  const canonicalMatches = matchCanonicalEntities(normalized);
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
  const isCampusWideQuery = /\b(?:fasilitas|laboratorium|lab|perpustakaan|asrama|parkir|ukm|ormawa|organisasi|inbis|career\s+center|cdc)\b/i.test(normalized);
  const isConversationalQuery = /^(?:halo|hai|pagi|siang|sore|malam|terima\s+kasih|makasih|oke|siap)\b/i.test(normalized);

  if (effectiveTargetEntities.length === 0 && contextDep.shouldInherit && contextDep.inheritedEntity && !isCampusWideQuery && !isConversationalQuery) {
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
  const isCurrent = TEMPORAL_NOW_REGEX.test(normalized);
  const temporal = {
    isCurrentConstraint: isCurrent,
    constraint: isCurrent ? 'NOW' : 'GENERAL'
  };

  // 4. Infer Domain & Intent
  const inferred = inferDomainAndIntent(normalized, effectiveTargetEntities, sessionData, unstemmedQuery, raw);

  let domain = inferred.domain;
  let intent = inferred.intent;

  if (contextDep.shouldInherit && contextDep.inheritedDomain) {
    if (contextDep.inheritedDomain === 'FACILITIES' && (domain === 'GENERAL' || domain === 'OUT_OF_DOMAIN')) {
      domain = 'FACILITIES';
      intent = contextDep.inheritedIntent || sessionData.activeIntent || 'CAMPUS_LOCATION';
    } else if (contextDep.inheritedDomain === 'ACADEMIC_EVENT' && !/\b(?:pmb|mahasiswa\s+baru|calon\s+mahasiswa|kuliah\s+di|masuk\s+stikom)\b/i.test(normalized)) {
      domain = 'ACADEMIC_EVENT';
      intent = 'GRADUATION_INQUIRY';
    } else if (domain === 'GENERAL' || domain === 'OUT_OF_DOMAIN') {
      domain = contextDep.inheritedDomain;
      if (contextDep.inheritedIntent || sessionData.activeIntent) {
        intent = contextDep.inheritedIntent || sessionData.activeIntent;
      }
    }
  }

  // Ensure campus entity is present for genuine CAMPUS_LOCATION inquiries without overriding academic entities
  if (intent === 'CAMPUS_LOCATION' || domain === 'FACILITIES') {
    const hasAcademicEntity = effectiveTargetEntities.some(e => e.family === 'academic_program' || e.family === 'international_program');
    if (!hasAcademicEntity && !effectiveTargetEntities.some(e => e.family === 'campus_location' || e.type === 'campus')) {
      effectiveTargetEntities.push({
        canonical: 'Kampus ITB STIKOM Bali',
        type: 'campus',
        family: 'campus_location',
        inherited: true
      });
    }
  }

  // Extract Academic Level
  let academicLevel = null;
  if (/\b(?:s2|magister|pascasarjana|master|postgraduate)\b/i.test(normalized) || /\b(?:s2|magister|pascasarjana|master|postgraduate)\b/i.test(raw) || effectiveTargetEntities.some(e => /s2|magister/i.test(e.canonical || ''))) {
    academicLevel = 'S2';
  } else if (/\b(?:s1|sarjana|bachelor|undergraduate)\b/i.test(normalized) || /\b(?:s1|sarjana|bachelor|undergraduate)\b/i.test(raw) || effectiveTargetEntities.some(e => /^S1\b/i.test(e.canonical || ''))) {
    academicLevel = 'S1';
  } else if (/\b(?:d3|diploma|ahli madya|associate)\b/i.test(normalized) || /\b(?:d3|diploma|ahli madya|associate)\b/i.test(raw) || effectiveTargetEntities.some(e => /^D3\b/i.test(e.canonical || ''))) {
    academicLevel = 'D3';
  } else if (/\b(?:s[- ]?3|doktor(?:al)?|doctor(?:ate)?|ph\.?d|d[- ]?4|diploma\s*[- ]?4|diploma\s*[- ]?iv|sarjana\s+terapan)\b/i.test(normalized) || /\b(?:s[- ]?3|doktor(?:al)?|doctor(?:ate)?|ph\.?d|d[- ]?4|diploma\s*[- ]?4|diploma\s*[- ]?iv|sarjana\s+terapan)\b/i.test(raw)) {
    academicLevel = 'UNSUPPORTED';
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
  if (inferred.intent === 'FACULTY_INQUIRY') {
    effectiveTargetEntities = effectiveTargetEntities.filter(e => e.type !== 'academic_scope' && e.family !== 'academic_scope');
    const { resolveFaculty } = require('./academicCatalog');
    const fac = resolveFaculty(raw);
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
  if (/\b(di\s*mana|dimana|lokasi(?:nya)?|tempat\s+kuliah|tempat\s+studi|alamat(?:nya)?|berada\s+di\s*mana)\b/i.test(normalized) ||
    /\b(di\s*mana|dimana|lokasi|tempat\s+kuliah|tempat\s+studi|alamat|berada\s+di\s*mana)\b/i.test(unstemmedQuery)) {
    combinedAspects.add('location');
    combinedAspects.add('campus_location');
  }
  if (/\b(fakultas|faculty)\b/i.test(normalized) || /\b(fakultas|faculty)\b/i.test(unstemmedQuery)) {
    combinedAspects.add('faculty');
    combinedAspects.add('academic_structure');
  }
  if (/\b(prospek(?:nya)?|peluang\s+kerja|karir|karier|profesi\s+lulusan)\b/i.test(normalized) ||
    /\b(prospek|peluang\s+kerja|karir|karier|profesi\s+lulusan)\b/i.test(unstemmedQuery)) {
    combinedAspects.add('career_prospects');
  }
  if (/\b(kurikulum(?:nya)?|mata\s*kuliah|matkul|sks|(?:apa\s+yang\s+)?dipelajari|pembelajaran|materi\s+kuliah|pelajaran)\b/i.test(normalized) ||
    /\b(kurikulum|mata\s*kuliah|matkul|sks|(?:apa\s+yang\s+)?dipelajari|pembelajaran|materi\s+kuliah|pelajaran)\b/i.test(unstemmedQuery)) {
    combinedAspects.add('curriculum');
  }
  if (/\b(biaya(?:nya)?|spp|dpp|uang\s+pangkal|bayar)\b/i.test(normalized) ||
    /\b(biaya|spp|dpp|uang\s+pangkal|bayar)\b/i.test(unstemmedQuery)) {
    combinedAspects.add('fee');
  }
  if (/\b(beasiswa(?:nya)?|potongan\s+dpp|keringanan)\b/i.test(normalized) ||
    /\b(beasiswa|potongan\s+dpp|keringanan)\b/i.test(unstemmedQuery)) {
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
  const finalAspects = Array.from(combinedAspects);

  const isAcademicDomain = ['ACADEMIC_PROGRAM', 'ACADEMIC_CURRICULUM', 'UNSUPPORTED_PROGRAM', 'GENERAL'].includes(domain);
  const unsupp = isAcademicDomain ? (inferred.unsupportedEntityName || inferred.unsupportedProgramName || detectUnsupportedProgram(normalized, effectiveTargetEntities)) : null;
  const isUnsupported = Boolean((inferred.unsupportedEntity || inferred.isUnsupportedEntity || unsupp || domain === 'UNSUPPORTED_PROGRAM') && isAcademicDomain);
  const unsupportedName = isUnsupported ? (unsupp || inferred.unsupportedProgramName || 'tersebut') : null;

  const isMultiTarget = effectiveTargetEntities.length > 1 &&
    /\b(?:dan|serta|maupun|dan juga)\b/i.test(normalized);

  const academicScope = inferred.academicScope || resolveAcademicScope(raw);
  const effectiveScopeLevel = academicScope.status === ACADEMIC_SCOPE_STATUS.UNSUPPORTED
    ? 'UNSUPPORTED'
    : (academicScope.status === ACADEMIC_SCOPE_STATUS.SUPPORTED
      ? academicScope.level
      : (inferred.scopeLevel || (inferred.intent === 'AVAILABLE_PROGRAMS_LIST' ? (academicLevel || 'ALL') : null)));

  const oldFrame = {
    rawQuery: raw,
    normalizedQuery: normalized,
    academicLevel,
    academicScope,
    scopeLevel: effectiveScopeLevel,
    domain,
    intent,
    userInterest: null,
    semanticConcepts: [],
    ambiguityLevel: 'LOW',
    confidence: 1.0,
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
    isProximityComparison: Boolean(inferred.isProximityComparison || (sessionData.isProximityComparison && contextDep.shouldInherit)),
    userOrigin: inferred.userOrigin || extractUserOriginLocation(raw, sessionData) || null,
    aspects: finalAspects,
    temporal,
    userState: inferred.userState,
    desiredAction: inferred.desiredAction,
    language: detectQueryLanguage(raw),
    subQueries: [],
    contextDependencies: contextDep.shouldInherit ? [contextDep] : [],
    unsupportedEntity: isUnsupported,
    unsupportedEntityName: unsupportedName,
    entityResolutionStatus: isUnsupported ? 'UNSUPPORTED' : (effectiveTargetEntities.length > 0 ? 'RESOLVED' : 'UNRESOLVED'),
    isUnsupportedEntity: isUnsupported,
    unsupportedProgramName: unsupportedName
  };

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

  // Active production resolver ALWAYS returns the legacy frame unmodified
  return oldFrame;
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
    const aspects = Array.isArray(validated.requestedAspects) ? [...validated.requestedAspects] : [];
    if (aspects.includes('career') && !aspects.includes('career_prospects')) {
      aspects.push('career_prospects');
    }
    if (syncFrame.aspects) {
      syncFrame.aspects.forEach(a => { if (!aspects.includes(a)) aspects.push(a); });
    }

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
    const isInstitutionalTopicSwitch = INSTITUTIONAL_CAMPUS_WIDE_INTENTS.has(modelPrimaryIntent) ||
      INSTITUTIONAL_CAMPUS_WIDE_INTENTS.has(syncFrame.intent) ||
      (aspects.includes('contact') && !aspects.includes('fee'));

    // Resolve entities to canonical registry objects
    const resolvedEntities = [];
    let detectedUnsupportedMention = null;
    const candidateMentions = Array.isArray(validated.candidateEntities) ? validated.candidateEntities : [];
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
          detectedUnsupportedMention = mentionStr;
        }
      }
    }

    // If model extracted no candidate entities, evaluate topic switch before inheriting prior entities
    if (resolvedEntities.length === 0 && Array.isArray(syncFrame.entities) && syncFrame.entities.length > 0) {
      for (const e of syncFrame.entities) {
        if (!e.inherited) {
          resolvedEntities.push(e);
        } else if (!isTopicSwitch) {
          const isAcademicEntity = e.family === 'academic_program' || e.type === 'program';
          if (isAcademicEntity && isInstitutionalTopicSwitch) {
            continue;
          }
          resolvedEntities.push(e);
        }
      }
    }

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
    const effectiveLevel = validated.scopeConstraints?.academicLevel || syncFrame.academicLevel || null;
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
    } else if (modelPrimaryIntent === 'CONVERSATIONAL_GREETING' || (!modelPrimaryIntent && speechAct === 'GENERAL_GREETING')) {
      domain = 'CONVERSATIONAL';
      intent = 'CONVERSATIONAL_GREETING';
    } else if (modelPrimaryIntent === 'CONVERSATIONAL_SMALL_TALK' || (!modelPrimaryIntent && speechAct === 'SOCIAL_INQUIRY')) {
      domain = 'CONVERSATIONAL';
      intent = 'CONVERSATIONAL_SMALL_TALK';
    } else if (modelPrimaryIntent === 'CONVERSATIONAL_ACKNOWLEDGEMENT') {
      domain = 'CONVERSATIONAL';
      intent = 'CONVERSATIONAL_ACKNOWLEDGEMENT';
    } else if (modelPrimaryIntent === 'PROGRAM_RECOMMENDATION' || (!modelPrimaryIntent && speechAct === 'SEEK_ADVICE')) {
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
      domain = 'TUITION_FEE';
      intent = 'TUITION_FEE_INQUIRY';
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
        const isScholarship = syncFrame.domain === 'SCHOLARSHIP' || /\b(?:beasiswa|kip\s*kuliah|kip-?k)\b/i.test(rawQuery);
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
        domain = 'ACADEMIC_RECOMMENDATION';
        intent = 'PROGRAM_RECOMMENDATION';
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
      } else if (domain === 'CAREER_CENTER' || syncFrame.domain === 'CAREER_CENTER' || /\b(?:career\s+center|cdc\b|magang|internship)\b/i.test(rawQuery)) {
        domain = 'CAREER_CENTER';
        intent = 'CAREER_CENTER_INQUIRY';
      } else if (aspects.includes('fee') || primaryConcept === 'FINANCIAL_COST' || domain === 'TUITION_FEE') {
        intent = 'TUITION_FEE_INQUIRY';
        domain = 'TUITION_FEE';
        if (!aspects.includes('components')) aspects.push('components');
      } else if (domain === 'FACILITIES' || aspects.includes('facilities') || aspects.includes('lab') || aspects.includes('campus_infrastructure') || (primaryConcept === 'CAMPUS_LIFE' && !syncFrame.domain?.includes('SERVICE') && !(validated.candidateEntities || []).some(e => e.inferredCategory === 'campus_service'))) {
        intent = 'FACILITY_INQUIRY';
        domain = 'FACILITIES';
      } else if (/\b(?:tugas\s+akhir|skripsi|pedoman\s+ta)\b/i.test(rawQuery)) {
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
      } else if (domain === 'CAREER_CENTER' || syncFrame.domain === 'CAREER_CENTER' || /\b(?:career\s+center|cdc\b|magang|internship)\b/i.test(rawQuery)) {
        domain = 'CAREER_CENTER';
        intent = 'CAREER_CENTER_INQUIRY';
      } else if (/\b(?:tugas\s+akhir|skripsi|pedoman\s+ta)\b/i.test(rawQuery)) {
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
        if (/\b(?:tugas\s+akhir|skripsi|pedoman\s+ta)\b/i.test(rawQuery)) {
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

    return {
      rawQuery,
      speechAct,
      userInterest: validated.userInterest || syncFrame.userInterest || null,
      semanticConcepts: Array.isArray(validated.semanticConcepts) ? validated.semanticConcepts : (syncFrame.semanticConcepts || []),
      ambiguityLevel: validated.ambiguityLevel || syncFrame.ambiguityLevel || 'LOW',
      confidence: typeof validated.confidence === 'number' ? validated.confidence : (syncFrame.confidence || 1.0),
      preferences: validated.preferences || syncFrame.preferences || null,
      normalizedQuery: syncFrame.normalizedQuery,
      academicLevel: effectiveLevel,
      academicScope,
      scopeLevel: effectiveScopeLevel,
      domain: isUnsupported ? 'UNSUPPORTED_PROGRAM' : domain,
      intent: isUnsupported ? 'UNSUPPORTED_PROGRAM_INQUIRY' : intent,
      retrievalRequired: speechAct !== 'GENERAL_GREETING' && speechAct !== 'SOCIAL_INQUIRY' && domain !== 'CONVERSATIONAL' && !isUnsupported && !isOOD,
      entities: resolvedEntities,
      candidateEntities: validated.candidateEntities || [],
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
      aspects: aspects.length > 0 ? aspects : syncFrame.aspects,
      temporal: syncFrame.temporal,
      userState: syncFrame.userState,
      desiredAction: isUnsupported ? 'REFUSE_UNSUPPORTED_PROGRAM' : (isOOD ? 'REFUSE_OUT_OF_DOMAIN' : syncFrame.desiredAction),
      language: detectQueryLanguage(rawQuery),
      subQueries: [],
      contextDependencies: validated.contextDependency?.isFollowUp ? [validated.contextDependency] : [],
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
    };
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
  normalizeQueryText,
  inferDomainAndIntent,
  resolveSemanticFrame,
  resolveSemanticFrameAsync,
  resolveSemanticFrameWithShadow,
  buildConciseConversationHistory,
  getShadowAuditHistory,
  clearShadowAuditHistory,
  detectQueryLanguage,
  extractUserOriginLocation
};
