const { normalizeUserQuery } = require('../utils/queryNormalizer');

const ID_MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

const ID_MONTH_MAP = {
  januari: 1, jan: 1,
  februari: 2, feb: 2, pebruari: 2,
  maret: 3, mar: 3,
  april: 4, apr: 4,
  mei: 5,
  juni: 6, jun: 6,
  juli: 7, jul: 7,
  agustus: 8, agu: 8, ags: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  oktober: 10, okt: 10,
  november: 11, nov: 11,
  desember: 12, des: 12
};

const PROGRAMS = [
  {
    canonical: 'Sistem Informasi',
    code: 'SI',
    aliases: ['sistem informasi', 'prodi sistem informasi', 'program studi sistem informasi', 'jurusan sistem informasi', 'si']
  },
  {
    canonical: 'Teknologi Informasi',
    code: 'TI',
    aliases: ['teknologi informasi', 'prodi teknologi informasi', 'program studi teknologi informasi', 'jurusan teknologi informasi', 'teknik informatika', 'informatika', 'prodi informatika', 'jurusan informatika', 'ti']
  },
  {
    canonical: 'Bisnis Digital',
    code: 'BD',
    aliases: ['bisnis digital', 'prodi bisnis digital', 'program studi bisnis digital', 'jurusan bisnis digital', 'bd']
  },
  {
    canonical: 'Sistem Komputer',
    code: 'SK',
    aliases: ['sistem komputer', 'prodi sistem komputer', 'program studi sistem komputer', 'jurusan sistem komputer', 'sk']
  },
  {
    canonical: 'Manajemen Informatika',
    code: 'MI',
    aliases: ['manajemen informatika', 'd3 manajemen informatika', 'prodi manajemen informatika', 'program studi manajemen informatika', 'jurusan manajemen informatika', 'mi']
  },
  {
    canonical: 'S2 Sistem Informasi',
    code: 'S2 SI',
    aliases: ['s2 sistem informasi', 'magister sistem informasi', 'pascasarjana sistem informasi', 's2 si']
  }
];

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getCurrentDateYmd() {
  const forced = String(process.env.SEMANTIC_RAG_TODAY_YMD || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(forced)) return forced;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: process.env.BOT_TIMEZONE || 'Asia/Makassar',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    if (values.year && values.month && values.day) return `${values.year}-${values.month}-${values.day}`;
  } catch (e) {
    // use local clock below
  }
  return new Date().toISOString().slice(0, 10);
}

function parseYmdParts(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function addMonths(year, month, delta) {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

function formatYmd(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseExplicitDate(raw, currentDate) {
  const q = String(raw || '').toLowerCase();
  const today = parseYmdParts(currentDate) || { year: new Date().getFullYear(), month: new Date().getMonth() + 1, day: new Date().getDate() };
  const m = /\b(?:tgl|tanggal|per|pada(?:\s+tanggal)?|di\s+tanggal)\s*(\d{1,2})\s+([a-z]+)(?:\s+(20\d{2}))?\b/i.exec(q);
  if (!m) return null;
  const day = Number(m[1]);
  const month = ID_MONTH_MAP[String(m[2] || '').toLowerCase()];
  const year = m[3] ? Number(m[3]) : today.year;
  if (!month || day < 1 || day > 31) return null;
  return formatYmd(year, month, day);
}

function parseRelativeDate(raw, currentDate) {
  const q = String(raw || '').toLowerCase();
  const today = parseYmdParts(currentDate) || { year: new Date().getFullYear(), month: new Date().getMonth() + 1, day: new Date().getDate() };
  if (/\b(?:sekarang|hari\s+ini|saat\s+ini)\b/i.test(q)) return currentDate;
  if (/\bbulan\s+depan\b/i.test(q)) {
    const next = addMonths(today.year, today.month, 1);
    return formatYmd(next.year, next.month, 1);
  }
  if (/\bbulan\s+ini\b/i.test(q)) return formatYmd(today.year, today.month, 1);
  if (/\bbulan\s+lalu\b/i.test(q)) {
    const prev = addMonths(today.year, today.month, -1);
    return formatYmd(prev.year, prev.month, 1);
  }
  return null;
}

function parseRequestedMonth(raw, currentDate) {
  const q = String(raw || '').toLowerCase();
  const today = parseYmdParts(currentDate) || { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
  if (/\bbulan\s+depan\b/i.test(q)) return { ...addMonths(today.year, today.month, 1), relative: 'bulan depan' };
  if (/\bbulan\s+ini\b/i.test(q)) return { year: today.year, month: today.month, relative: 'bulan ini' };
  if (/\bbulan\s+lalu\b/i.test(q)) return { ...addMonths(today.year, today.month, -1), relative: 'bulan lalu' };
  for (const [name, month] of Object.entries(ID_MONTH_MAP)) {
    if (new RegExp(`\\b${escapeRegex(name)}\\b`, 'i').test(q)) {
      const yearMatch = /\b(20\d{2})\b/.exec(q);
      return { year: yearMatch ? Number(yearMatch[1]) : today.year, month, relative: null };
    }
  }
  return null;
}

function romanToWaveGroup(raw) {
  const s = String(raw || '').trim().toUpperCase();
  if (s === '1' || s === 'I') return 'I';
  if (s === '2' || s === 'II') return 'II';
  if (s === '3' || s === 'III') return 'III';
  if (s === '4' || s === 'IV') return 'IV';
  if (s === 'KHUSUS') return 'KHUSUS';
  return '';
}

function parseRequestedWave(raw) {
  const matches = Array.from(String(raw || '').matchAll(/\b(?:gel(?:ombang)?|gbg)\s*(khusus|[1-4]|i{1,3}|iv)\s*([a-c])?\b/gi));
  const m = matches.length ? matches[matches.length - 1] : null;
  if (!m) return null;
  const group = romanToWaveGroup(m[1]);
  const suffix = String(m[2] || '').trim().toUpperCase();
  if (!group) return null;
  return { group, key: group === 'KHUSUS' ? 'KHUSUS' : `${group}${suffix}`, hasSuffix: Boolean(suffix) };
}

function buildTemporalUnderstanding(rawQuery) {
  const currentDate = getCurrentDateYmd();
  const explicitDate = parseExplicitDate(rawQuery, currentDate);
  const relativeDate = explicitDate ? null : parseRelativeDate(rawQuery, currentDate);
  const requestedMonth = parseRequestedMonth(rawQuery, currentDate);
  const requestedWave = parseRequestedWave(rawQuery);
  const referenceDate = explicitDate || relativeDate || currentDate;
  return {
    currentDate,
    explicitDate,
    relativeDate,
    requestedMonth,
    requestedYear: requestedMonth ? requestedMonth.year : null,
    requestedWave,
    referenceDate,
    reason: explicitDate ? 'explicitDate' : (relativeDate ? 'relativeDate' : 'currentDate')
  };
}

function aliasMatchesText(text, alias) {
  const a = String(alias || '').toLowerCase();
  if (!a) return false;
  if (a.length <= 2) {
    if (a === 'ti' && /\b(?:tiada|setiap|hati|nanti|arti|seperti)\b/i.test(text)) return false;
    if (a === 'si' && /\b(?:situ|sini|siswa|visi|misi|isi)\b/i.test(text)) return false;
    if (a === 'sk' && /\b(?:sks|skema|sktt|surat\s+keputusan)\b/i.test(text)) return false;
    if (a === 'mi' && /\b(?:minta|minat|kami|semi)\b/i.test(text)) return false;
    return new RegExp(`(^|\\s)${escapeRegex(a)}(\\s|$)`, 'i').test(text);
  }
  return new RegExp(`(^|\\s)${escapeRegex(a)}(\\s|$)`, 'i').test(text);
}

function resolveProgramEntities(rawText) {
  const normalized = normalizeUserQuery(rawText || '').normalizedText || String(rawText || '').toLowerCase();
  const matches = [];
  for (const program of PROGRAMS) {
    const matchedAlias = program.aliases.find(alias => aliasMatchesText(normalized, alias));
    if (matchedAlias) {
      matches.push({
        type: 'program',
        canonical: program.canonical,
        code: program.code,
        surface: matchedAlias,
        confidence: matchedAlias.length <= 2 ? 0.86 : 0.96,
        source: 'canonical-program-alias'
      });
    }
  }
  const seen = new Set();
  return matches.filter(entity => {
    if (seen.has(entity.canonical)) return false;
    seen.add(entity.canonical);
    return true;
  });
}

function detectFeeType(q) {
  if (/\b(?:ukt|uang\s+kuliah|biaya\s+pendidikan|per\s+semester|semesteran)\b/i.test(q)) return 'ukt';
  if (/\b(?:dpp|dana\s+pendidikan\s+pokok)\b/i.test(q)) return 'dpp';
  if (/\b(?:biaya\s+awal|awal\s+masuk|uang\s+masuk|biaya\s+masuk)\b/i.test(q)) return 'initial_fee';
  if (/\b(?:biaya\s+pendaftaran|uang\s+pendaftaran|harga\s+pendaftaran|bayar\s+pendaftaran|biaya\s+daftar|daftar\s+berapa)\b/i.test(q)) return 'registration_fee';
  if (/\b(?:potongan|diskon|discount|beasiswa)\b/i.test(q)) return 'discount';
  if (/\b(?:total|semua|keseluruhan)\b/i.test(q) && /\b(?:biaya|bayar|uang|harga)\b/i.test(q)) return 'total_estimate';
  return null;
}

function classifyIntentDomain(rawQuery, normalizedQuery, entities, temporal) {
  const q = String(normalizedQuery || rawQuery || '').toLowerCase();
  const hasLocationIntent = /\b(?:alamat|lokasi|dimana|di\s*mana|where|letak|maps?|google\s+maps|rute|arah|patokan|pin\s+lokasi|share\s*loc|shareloc)\b/i.test(q);
  const hasPhysicalAttribute = /\b(?:tinggi|luas|jumlah\s+lantai|berapa\s+lantai|lantai\s+berapa|kapasitas|ukuran|warna(?:nya)?|panjang|lebar|besar(?:nya)?|daya\s+tampung)\b/i.test(q);
  const feeType = detectFeeType(q);
  const hasFee = Boolean(feeType) || /\b(?:biaya(?:nya)?|harga(?:nya)?|bayar(?:nya|an)?|pembayaran|uang|nominal|tarif|fee|cost)\b/i.test(q);
  const hasAvailabilityStatus = /\b(?:masih\s+buka|masih\s+dibuka|masih\s+menerima|menerima\s+pendaftaran|terima\s+pendaftaran|buka|dibuka|aktif|berjalan|status)\b/i.test(q);
  const asksRegistrationHow = /\b(?:cara|gimana|bagaimana|lewat|link|online|mau|ingin|pengen|pengin|bisa|how|where|apply|application|admission)\b/i.test(q)
    && /\b(?:daftar(?:nya)?|mendaftar|pendaftaran|registrasi|kuliah|pmb|mahasiswa\s+baru|camaba|maba)\b/i.test(q)
    && !hasFee
    && !hasAvailabilityStatus;
  const hasSchedule = /\b(?:jadwal|gelombang|gbg|bulan\s+depan|bulan\s+ini|bulan\s+lalu|deadline|tanggal|tgl|kapan|ditutup|tutup|buka|dibuka|aktif)\b/i.test(q)
    || Boolean(temporal.explicitDate || temporal.requestedMonth || temporal.requestedWave);
  const hasFacility = /\b(?:fasilitas|fasilias|fasiltas|layanan|sarana|prasarana|laboratorium|lab|perpustakaan|ruang|kantin|parkir|wifi|inkubator|inbis|language\s+learning|llc|hi\s*think|hithink|career\s*center|pusat\s+karier|pusat\s+karir)\b/i.test(q);
  const hasCareer = /\b(?:career\s*center|pusat\s+karier|pusat\s+karir|karier|karir|prospek\s+kerja|peluang\s+kerja|lowongan|magang|job\s*fair|campus\s*hiring|tracer\s*study|persiapan\s+kerja|siap\s+kerja|dunia\s+kerja|pembekalan|melamar\s+pekerjaan|bantuan\s+persiapan)\b/i.test(q);
  const asksLearning = /\b(?:belajar|dipelajari|mata\s+kuliah|matkul|kurikulum|skill|kompetensi|coding|ngoding|ai|artificial\s+intelligence|kecerdasan\s+buatan)\b/i.test(q);
  const asksAdvice = /\b(?:kurang|tidak|ga|gak|nggak|belum)\s+(?:cakap|jago|mahir|bisa|paham)|\b(?:apa\s+yang\s+harus|harus\s+bagaimana|saran|cocok|minat)\b/i.test(q);
  const asksList = /\b(?:apa\s+saja|apa\s+aja|daftar|list|pilihan|macam|sebutkan)\b/i.test(q);
  const hasScholarship = /\b(?:beasiswa|kip|1k1s|skss|bantuan\s+biaya|potongan)\b/i.test(q) && !hasFee;
  const hasAcademic = /\b(?:sks|skripsi|tugas\s+akhir|tesis|\bta\b|krs|wisuda|yudisium|kalender\s+akademik|baak)\b/i.test(q);
  const hasThesisTerm = /\b(?:skripsi|tugas\s+akhir|tesis|ta)\b/i.test(q);
  const hasThesisPageTerm = /\b(?:halaman|lembar|jumlah\s+halaman|minimal|maksimal|panjang\s+naskah)\b/i.test(q);
  const academicTopic = hasThesisTerm && hasThesisPageTerm
    ? 'thesis_page_count'
    : (hasThesisTerm ? 'thesis_general' : null);
  const hasProgramComparison = /\b(?:beda|bedanya|bedain|perbedaan|banding|bandingkan|dibanding(?:kan)?|perbandingan|vs|versus)\b/i.test(q) && entities.programs.length >= 2 && !hasFee;
  const hasProgramList = /\b(?:jurusan(?:nya)?|prodi(?:nya)?|program\s+studi)\b/i.test(q) && asksList;
  const asksProgramDefinition = /\b(?:apa\s+itu|apakah\s+itu|itu\s+apa|apaan|pengertian|jelaskan|maksud(?:nya)?|tentang)\b/i.test(q) && entities.programs.length > 0;

  let primaryIntent = 'ask_general';
  let primaryDomain = 'general';
  let answerExpectation = 'safe_answer_or_fallback';

  if (hasProgramComparison) {
    primaryIntent = 'ask_program_comparison';
    primaryDomain = 'program';
    answerExpectation = 'comparison';
  } else if (hasLocationIntent && !hasPhysicalAttribute) {
    primaryIntent = 'ask_location';
    primaryDomain = 'campus_location';
    answerExpectation = 'address_or_route';
  } else if (academicTopic) {
    primaryIntent = 'ask_academic_info';
    primaryDomain = 'academic';
    answerExpectation = 'specific_fact_or_fallback';
  } else if (hasPhysicalAttribute) {
    primaryIntent = 'ask_physical_attribute';
    primaryDomain = 'campus_physical';
    answerExpectation = 'specific_fact_or_fallback';
  } else if (hasFee) {
    primaryIntent = 'ask_fee';
    primaryDomain = 'fee';
    answerExpectation = 'amount_or_breakdown';
  } else if (asksRegistrationHow) {
    primaryIntent = 'ask_registration_how';
    primaryDomain = 'registration';
    answerExpectation = 'procedure';
  } else if (hasSchedule) {
    primaryIntent = 'ask_schedule';
    primaryDomain = 'pmb_schedule';
    answerExpectation = 'date_or_period';
  } else if (hasScholarship) {
    primaryIntent = 'ask_scholarship';
    primaryDomain = 'scholarship';
    answerExpectation = asksList ? 'list' : 'specific_fact_or_fallback';
  } else if (hasProgramList) {
    primaryIntent = 'ask_program_list';
    primaryDomain = 'program';
    answerExpectation = 'list';
  } else if (asksProgramDefinition) {
    primaryIntent = 'ask_program_definition';
    primaryDomain = 'program';
    answerExpectation = 'definition';
  } else if (asksLearning && entities.programs.length) {
    primaryIntent = 'ask_program_curriculum';
    primaryDomain = 'program_curriculum';
    answerExpectation = 'curriculum_or_topic_presence';
  } else if (asksAdvice && entities.programs.length) {
    primaryIntent = 'ask_program_advice';
    primaryDomain = 'program_advice';
    answerExpectation = 'advice_with_entity';
  } else if (hasCareer) {
    primaryIntent = 'ask_career_service';
    primaryDomain = 'career';
    answerExpectation = 'service_or_career_info';
  } else if (hasFacility) {
    primaryIntent = 'ask_facility_list';
    primaryDomain = 'campus_facility';
    answerExpectation = asksList ? 'list' : 'specific_fact_or_fallback';
  } else if (hasAcademic) {
    primaryIntent = 'ask_academic_info';
    primaryDomain = 'academic';
    answerExpectation = 'specific_fact_or_fallback';
  }

  return {
    intent: { primary: primaryIntent, secondary: [], confidence: primaryIntent === 'ask_general' ? 0.45 : 0.82 },
    domain: { primary: primaryDomain, confidence: primaryDomain === 'general' ? 0.45 : 0.82 },
    constraints: {
      feeType,
      registrationWave: temporal.requestedWave || null,
      academicLevel: /\bs2|pascasarjana|magister\b/i.test(q) ? 's2' : (/\bd3|diploma\b/i.test(q) ? 'd3' : (/\bs1|sarjana\b/i.test(q) ? 's1' : null)),
      locationIntent: hasLocationIntent,
      physicalAttribute: hasPhysicalAttribute,
      comparisonTarget: /\b(?:beda|bedanya|bedain|perbedaan|banding|bandingkan|dibanding(?:kan)?|perbandingan|vs|versus)\b/i.test(q) ? 'program' : null,
      academicTopic
    },
    questionType: asksList ? 'list' : (/\b(?:apakah|apa|ada|punya|tersedia)\b/i.test(q) ? 'yes_no_or_explain' : 'informational'),
    answerExpectation,
    ambiguity: []
  };
}

function buildRoutingQuery(normalizedQuery, entities, classification) {
  const additions = [];
  for (const program of entities.programs) additions.push(program.canonical);
  if (classification.constraints.feeType) additions.push(classification.constraints.feeType);
  if (classification.intent.primary === 'ask_program_comparison') additions.push('perbedaan program studi');
  if (classification.intent.primary === 'ask_program_curriculum') additions.push('kurikulum');
  if (classification.intent.primary === 'ask_registration_how') additions.push('pendaftaran');
  if (classification.intent.primary === 'ask_facility_list') additions.push('fasilitas');
  if (classification.constraints.academicTopic) additions.push(classification.constraints.academicTopic.replace(/_/g, ' '));
  if (classification.intent.primary && classification.intent.primary !== 'ask_general') additions.push(classification.intent.primary);
  return [normalizedQuery, ...additions].filter(Boolean).join(' ').replace(/\s{2,}/g, ' ').trim();
}

function buildCanonicalQueryUnderstanding(rawQuery, options = {}) {
  const raw = String(rawQuery || '');
  const normalizedInfo = options.normalizedQuery
    ? { normalizedText: String(options.normalizedQuery), changed: String(options.normalizedQuery) !== raw }
    : normalizeUserQuery(raw);
  const normalizedQuery = normalizedInfo && normalizedInfo.normalizedText ? normalizedInfo.normalizedText : raw.toLowerCase();
  const temporal = buildTemporalUnderstanding(raw);
  const programEntities = resolveProgramEntities(`${raw} ${normalizedQuery}`);
  const entities = {
    programs: programEntities,
    campuses: [],
    facilities: [],
    organizations: [],
    people: [],
    unknown: []
  };
  const classification = classifyIntentDomain(raw, normalizedQuery, entities, temporal);
  return {
    rawQuery: raw,
    normalizedQuery,
    intent: classification.intent,
    domain: classification.domain,
    entities,
    aliases: programEntities.map(e => ({ surface: e.surface, canonical: e.canonical, type: e.type, confidence: e.confidence, source: e.source })),
    temporal,
    constraints: classification.constraints,
    questionType: classification.questionType,
    answerExpectation: classification.answerExpectation,
    ambiguity: classification.ambiguity,
    routingQuery: buildRoutingQuery(normalizedQuery, entities, classification),
    confidence: Math.min(classification.intent.confidence, classification.domain.confidence)
  };
}

module.exports = {
  PROGRAMS,
  ID_MONTH_NAMES,
  ID_MONTH_MAP,
  buildCanonicalQueryUnderstanding,
  buildTemporalUnderstanding,
  resolveProgramEntities,
  classifyIntentDomain,
  detectFeeType
};
