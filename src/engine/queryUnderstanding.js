const { normalizeUserQuery } = require('../utils/queryNormalizer');
const { buildSemanticContract } = require('./semanticContract');

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
    canonical: 'Desain Komunikasi Visual',
    code: 'DKV',
    aliases: ['desain komunikasi visual', 'prodi dkv', 'prodi desain komunikasi visual', 'dkv']
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

function detectAcademicLevels(raw) {
  const q = String(raw || '').toLowerCase();
  const levels = [];
  if (/\b(?:d\s*3|diploma(?:\s*(?:3|tiga))?)\b/i.test(q)) levels.push('d3');
  if (/\b(?:s\s*1|sarjana|strata\s*satu)\b/i.test(q)) levels.push('s1');
  if (/\b(?:s\s*2|pascasarjana|pasca\s*sarjana|magister|master)\b/i.test(q)) levels.push('s2');
  return levels;
}

function detectOrganizationCategory(raw) {
  const q = String(raw || '').toLowerCase();
  const categories = [
    { key: 'arts', label: 'seni', re: /\b(?:seni|sni|musik|band|nyanyi|vokal|vocal|tari|menari|tabuh|teater|drama|akting|acting)\b/i },
    { key: 'sports', label: 'olahraga', re: /\b(?:olahraga|sport|sports|atlet|futsal|basket|sepak\s*bola|bola)\b/i },
    { key: 'technology', label: 'teknologi', re: /\b(?:teknologi|komputer|coding|ngoding|programming|software|web|aplikasi|linux|open\s*source|cyber|jaringan|data|ai|artificial\s+intelligence|machine\s+learning)\b/i },
    { key: 'entrepreneurship', label: 'kewirausahaan', re: /\b(?:wirausaha|kewirausahaan|entrepreneur|entrepreneurship|bisnis|startup|usaha)\b/i },
    { key: 'religious', label: 'kerohanian', re: /\b(?:rohani|kerohanian|agama|keagamaan|hindu|kristen|islam|muslim)\b/i },
    { key: 'media', label: 'media kreatif', re: /\b(?:foto|fotografi|video|videografi|multimedia|desain|konten|content|sosmed|media)\b/i },
    { key: 'leadership', label: 'kepemimpinan', re: /\b(?:kepemimpinan|leadership|bem|dpm|hima|himaprodi|panitia|event\s+kampus)\b/i }
  ];
  return categories.find((item) => item.re.test(q)) || null;
}

function detectCurriculumTopic(raw) {
  const q = String(raw || '').toLowerCase();
  const topics = [
    { key: 'artificial_intelligence', label: 'Artificial Intelligence (AI)', re: /\b(?:ai|artificial\s+intelligence|kecerdasan\s+buatan|machine\s+learning)\b/i },
    { key: 'coding', label: 'coding/pemrograman', re: /\b(?:coding|ngoding|pemrograman|programming|programmer)\b/i },
    { key: 'data_analytics', label: 'data analytics', re: /\b(?:data\s+analytics|analitik(?:a)?\s+data|analisis\s+data|data\s+science)\b/i },
    { key: 'digital_marketing', label: 'digital marketing', re: /\b(?:digital\s+marketing|pemasaran\s+digital|marketing\s+digital)\b/i },
    { key: 'e_commerce', label: 'e-commerce', re: /\b(?:e-?commerce|perdagangan\s+elektronik|marketplace)\b/i },
    { key: 'cyber_security', label: 'cyber security', re: /\b(?:cyber\s*security|keamanan\s+siber|keamanan\s+informasi)\b/i },
    { key: 'cloud_computing', label: 'cloud computing', re: /\b(?:cloud\s+computing|komputasi\s+awan|cloud)\b/i }
  ];
  return topics.find((item) => item.re.test(q)) || null;
}

function detectScholarshipRequestSubtype(raw) {
  const q = String(raw || '').toLowerCase();
  if (/\b(?:syarat|persyaratan|ketentuan|kriteria|dokumen|berkas)\b/i.test(q)) return 'requirements';
  if (/\b(?:cara|bagaimana|gimana|prosedur|alur|mengajukan|mendaftar|daftar|mendapatkan|dapat)\b/i.test(q)) return 'procedure';
  if (/\b(?:ada|tersedia|punya|apakah)\b/i.test(q)) return 'availability';
  if (/\b(?:apa\s+saja|apa\s+aja|daftar|list|jenis|pilihan|macam|gimana|bagaimana|overview|info(?:rmasi)?)\b/i.test(q)) return 'list_overview';
  return 'overview';
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
  const numericYmd = /\b(20\d{2})[-\/](\d{1,2})[-\/](\d{1,2})\b/.exec(q);
  if (numericYmd) {
    const year = Number(numericYmd[1]);
    const month = Number(numericYmd[2]);
    const day = Number(numericYmd[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return formatYmd(year, month, day);
  }
  const numericDmy = /\b(?:tgl|tanggal|per|pada(?:\s+tanggal)?|di\s+tanggal)?\s*(\d{1,2})[-\/](\d{1,2})[-\/](20\d{2})\b/.exec(q);
  if (numericDmy) {
    const day = Number(numericDmy[1]);
    const month = Number(numericDmy[2]);
    const year = Number(numericDmy[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return formatYmd(year, month, day);
  }
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
  if (s === '1' || s === 'I' || s === 'SATU') return 'I';
  if (s === '2' || s === 'II' || s === 'DUA') return 'II';
  if (s === '3' || s === 'III' || s === 'TIGA') return 'III';
  if (s === '4' || s === 'IV' || s === 'EMPAT') return 'IV';
  if (s === 'KHUSUS') return 'KHUSUS';
  return '';
}

function parseRequestedWave(raw) {
  const matches = Array.from(String(raw || '').matchAll(/\b(?:gel(?:ombang)?|gbg)\s*(khusus|[1-4]|i{1,3}|iv|satu|dua|tiga|empat)\s*([a-c])?\b/gi));
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
  const boundary = new RegExp(`(^|[^a-z0-9])${escapeRegex(a)}([^a-z0-9]|$)`, 'i');
  return boundary.test(text);
}

function resolveProgramEntities(rawText) {
  const normalized = normalizeUserQuery(rawText || '').normalizedText || String(rawText || '').toLowerCase();
  const hasDocumentCodeContext = /\b(?:surat\s+keputusan|mendiknas|keputusan|izin\s+operasional|nomor\s+sk|no\.?\s*sk|legal|dokumen)\b/i.test(normalized);
  const matches = [];
  for (const program of PROGRAMS) {
    const matchedAlias = program.aliases.find(alias => aliasMatchesText(normalized, alias));
    if (matchedAlias) {
      if (/^(?:sk)$/i.test(matchedAlias) && hasDocumentCodeContext && !/\b(?:sistem\s+komputer|prodi\s+sk|jurusan\s+sk|program\s+studi\s+sk)\b/i.test(normalized)) {
        continue;
      }
      if (/^informatika$/i.test(matchedAlias) && /\b(?:manajemen\s+informatika|d\s*3\s+manajemen|d3\s+manajemen|diploma\s+(?:3|tiga)\s+manajemen)\b/i.test(normalized)) {
        continue;
      }
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
  const hasS2Level = /\b(?:s\s*2|pascasarjana|pasca\s+sarjana|magister|master)\b/i.test(normalized);
  const hasProgramStudyContext = /\b(?:program|program\s+studi|prodi|jurusan|kuliah|perkuliahan|mata\s+kuliah|matkul|kurikulum|belajar|dipelajari|kelas|course|sks|gelar|masa\s+studi|semester|fokus\s+penelitian|riset)\b/i.test(normalized);
  if (hasS2Level && hasProgramStudyContext && !matches.some(entity => entity.canonical === 'S2 Sistem Informasi')) {
    matches.push({
      type: 'program',
      canonical: 'S2 Sistem Informasi',
      code: 'S2 SI',
      surface: 's2',
      confidence: 0.82,
      source: 'canonical-program-level-context'
    });
  }
  const seen = new Set();
  return matches.filter(entity => {
    if (seen.has(entity.canonical)) return false;
    seen.add(entity.canonical);
    return true;
  });
}

function resolveSourceDomainEntities(rawText) {
  const normalized = normalizeUserQuery(rawText || '').normalizedText || String(rawText || '').toLowerCase();
  const organizations = [];
  const facilities = [];
  const documents = [];
  const internationalPrograms = [];
  const addUnique = (list, entity) => {
    if (!entity || !entity.canonical) return;
    if (list.some(item => item.canonical === entity.canonical && item.type === entity.type)) return;
    list.push(entity);
  };

  const orgSpecs = [
    { re: /\b(?:himaprodi|hima(?:punan)?\s+mahasiswa\s+program\s+studi)\s+(?:sistem\s+informasi|\bsi\b)\b/i, canonical: 'HIMAPRODI Sistem Informasi', type: 'student_association', role: 'organization_profile' },
    { re: /\b(?:himaprodi|hima(?:punan)?\s+mahasiswa\s+program\s+studi)\s+(?:sistem\s+komputer|\bsk\b)\b/i, canonical: 'HIMAPRODI Sistem Komputer', type: 'student_association', role: 'organization_profile' },
    { re: /\b(?:himaprodi|hima(?:punan)?\s+mahasiswa\s+program\s+studi)\s+(?:bisnis\s+digital|\bbd\b)\b/i, canonical: 'HIMAPRODI Bisnis Digital', type: 'student_association', role: 'organization_profile' },
    { re: /\b(?:himaprodi|hima(?:punan)?\s+mahasiswa\s+program\s+studi)\s+(?:teknologi\s+informasi|\bti\b)\b/i, canonical: 'HIMAPRODI Teknologi Informasi', type: 'student_association', role: 'organization_profile' },
    { re: /\b(?:ukm\s+)?mcos\b/i, canonical: 'UKM MCOS', type: 'ukm', role: 'organization_profile' },
    { re: /\b(?:ukm\s+)?ksl\b/i, canonical: 'UKM KSL', type: 'ukm', role: 'organization_profile' },
    { re: /\b(?:ukm\s+)?ksr\b/i, canonical: 'UKM KSR', type: 'ukm', role: 'organization_profile' },
    { re: /\b(?:ukm\s+)?kmhd\b/i, canonical: 'UKM KMHD', type: 'ukm', role: 'organization_profile' },
    { re: /\b(?:ukm\s+)?jcos\b/i, canonical: 'UKM JCOS', type: 'ukm', role: 'organization_profile' },
    { re: /\b(?:ukm\s+)?syntax\b/i, canonical: 'UKM Syntax', type: 'ukm', role: 'organization_profile' },
    { re: /\b(?:ukm\s+)?progress\b/i, canonical: 'UKM Progress', type: 'ukm', role: 'organization_profile' },
    { re: /\b(?:ukm\s+)?ghost\b/i, canonical: 'UKM Ghost', type: 'ukm', role: 'organization_profile' },
    { re: /\b(?:ukm\s+)?(?:d\.?\s*o\.?\s*s|dos)\b/i, canonical: 'UKM DOS', type: 'ukm', role: 'organization_profile' },
    { re: /\b(?:ukm\s+)?pmk\b/i, canonical: 'UKM PMK', type: 'ukm', role: 'organization_profile' },
    { re: /\b(?:ukm\s+)?u2m\b/i, canonical: 'UKM U2M', type: 'ukm', role: 'organization_profile' },
    { re: /\b(?:ukm\s+)?paskamras\b/i, canonical: 'UKM Paskamras', type: 'ukm', role: 'organization_profile' },
    { re: /\b(?:ukm\s+)?basket\b/i, canonical: 'UKM Basket', type: 'ukm', role: 'organization_profile' },
    { re: /\b(?:ukm\s+)?futsal\b/i, canonical: 'UKM Futsal', type: 'ukm', role: 'organization_profile' },
    { re: /\b(?:ukm\s+)?musik\b/i, canonical: 'UKM Musik', type: 'ukm', role: 'organization_profile' },
    { re: /\b(?:ukm\s+)?multimedia\b/i, canonical: 'UKM Multimedia', type: 'ukm', role: 'organization_profile' },
    { re: /\b(?:ukm\s+)?(?:tari|pragina)\b/i, canonical: 'UKM Tari PRAGINA', type: 'ukm', role: 'organization_profile' },
    { re: /\b(?:ukm\s+)?tabuh\b/i, canonical: 'UKM Tabuh Bramara Gita', type: 'ukm', role: 'organization_profile' },
    { re: /\b(?:ukm\s+)?rade\b/i, canonical: 'UKM RADE', type: 'ukm', role: 'organization_profile' },
    { re: /\b(?:ukm\s+)?teater\s+biner\b/i, canonical: 'UKM Teater Biner', type: 'ukm', role: 'organization_profile' },
    { re: /\b(?:bem(?:-pm)?|badan\s+eksekutif\s+mahasiswa)\b/i, canonical: 'BEM-PM ITB STIKOM Bali', type: 'organization', role: 'organization_profile' },
    { re: /\b(?:vos|voice\s+of\s+stikom)\b/i, canonical: 'VOS', type: 'ukm', role: 'organization_profile' },
    { re: /\b(?:mapala\s+kompas|mapala)\b/i, canonical: 'Mapala Kompas', type: 'ukm', role: 'organization_profile' },
    { re: /\bathena(?:\s+esports?)?\b/i, canonical: 'Athena Esports', type: 'ukm', role: 'organization_profile' },
    { re: /\b(?:esports?|e-sports?)\b/i, canonical: 'Athena Esports', type: 'ukm', role: 'organization_profile' }
  ];
  for (const spec of orgSpecs) {
    if (spec.re.test(normalized)) addUnique(organizations, { ...spec, confidence: 0.9, source: 'canonical-source-entity' });
  }

  const isGenericOpenWorldOrgName = (value) => {
    const candidate = String(value || '').trim().toLowerCase();
    if (!candidate) return true;
    if (/^(?:kampus|stikom|itb|bali|ada|apa|saja|aja|di|itu|ini|yang|dan|atau|daftar|cara|bagaimana|gimana|berapa|brp|brapa|jumlah|total|totalnya|banyak|semua|seluruh)(?:\s|$)/i.test(candidate)) return true;
    if (/\b(?:ada|apa|saja|aja|kampus|stikom|itb|bali|berapa|brp|brapa|jumlah|total|totalnya|banyak|semua|seluruh|seni|sni|musik|tari|tabuh|teater|olahraga|teknologi|kewirausahaan|wirausaha|kerohanian|rohani|minat|kategori|jenis)\b/i.test(candidate)) return true;
    return false;
  };
  // Open-world entity regex matching for generic UKMs/Himaprodi
  // Extend to 1-4 words (allows "UKM Teater Biner", "UKM Ghost", "HIMAPRODI Bisnis Digital", etc.)
  const genericUkm = normalized.match(/\bukm\s+([a-z0-9][a-z0-9 _-]{0,35}?)(?=\s+(?:itu|ini|apa|ada|kampus|stikom|itb|yang|di|di\s|bagaimana|gimana|ya|kak|min|admin|bisa|dong|nih|fokus|kegiatan|profil|tujuan|visi|misi|organisasi|himpunan)|[?.!,]|$)/i);
  if (genericUkm && !organizations.length) {
    const ukmName = genericUkm[1].trim().replace(/\s+/g, ' ');
    if (!isGenericOpenWorldOrgName(ukmName)) addUnique(organizations, { canonical: `UKM ${ukmName.replace(/\b\w/g, c => c.toUpperCase())}`, type: 'ukm', role: 'organization_profile', confidence: 0.85, source: 'open-world-ukm' });
  }
  const genericHima = normalized.match(/\bhimaprodi\s+([a-z0-9][a-z0-9 _-]{0,35}?)(?=\s+(?:itu|ini|apa|yang|bagaimana|gimana|ya|kak|min)|[?.!,]|$)/i);
  if (genericHima && !organizations.length) {
    const himaName = genericHima[1].trim().replace(/\s+/g, ' ');
    if (!isGenericOpenWorldOrgName(himaName)) addUnique(organizations, { canonical: `HIMAPRODI ${himaName.toUpperCase()}`, type: 'student_association', role: 'organization_profile', confidence: 0.85, source: 'open-world-himaprodi' });
  }

  if (/\b(?:hi\s*-?\s*think|hithink)\b/i.test(normalized)) {
    addUnique(facilities, { canonical: 'Hi-Think', type: 'facility_program', role: 'campus_support_profile', confidence: 0.92, source: 'canonical-source-entity' });
  }
  if (/\b(?:inbis|inkubator\s+bisnis|incubator)\b/i.test(normalized)) {
    addUnique(facilities, { canonical: 'Inkubator Bisnis INBIS', type: 'facility', role: 'campus_support_profile', confidence: 0.92, source: 'canonical-source-entity' });
  }
  if (/\b(?:language\s+learning\s+center|llc|learning\s+center)\b/i.test(normalized)) {
    addUnique(facilities, { canonical: 'Language Learning Center (LLC)', type: 'facility', role: 'campus_support_profile', confidence: 0.92, source: 'canonical-source-entity' });
  }
  if (/\b(?:gccp|gcpp|gcp|global\s+cross\s+cultural|global\s+cultural\s+exchange)\b/i.test(normalized)) {
    addUnique(internationalPrograms, { canonical: 'GCCP', type: 'international_program', role: 'student_exchange_subprogram', confidence: 0.94, source: 'canonical-source-entity' });
  }
  if (/\bbccp\b/i.test(normalized)) {
    addUnique(internationalPrograms, { canonical: 'BCCP', type: 'international_program', role: 'student_exchange_subprogram', confidence: 0.94, source: 'canonical-source-entity' });
  }
  if (/\b(?:short\s*course|shortcourse|kursus\s+singkat)\b/i.test(normalized)) {
    addUnique(internationalPrograms, { canonical: 'short course', type: 'international_program', role: 'student_exchange_subprogram', confidence: 0.92, source: 'canonical-source-entity' });
  }
  if (/\b(?:student\s+exchange|pertukaran\s+mahasiswa)\b/i.test(normalized)
    || (/\bexchange\b/i.test(normalized) && /\b(?:mahasiswa|student|program|manfaat|benefit|syarat)\b/i.test(normalized))) {
    addUnique(internationalPrograms, { canonical: 'Student Exchange', type: 'international_program', role: 'student_exchange', confidence: 0.93, source: 'canonical-source-entity' });
  }
  if (/\b(?:double\s*degree|dual\s*degree|program\s+ganda)\b/i.test(normalized)) {
    let partner = 'Double Degree';
    let programScope = /\b(?:nasional|national)\b/i.test(normalized) ? 'national'
      : (/\b(?:internasional|international|luar\s+negeri)\b/i.test(normalized) ? 'international' : null);
    let country = null;
    if (/\bhelp\b/i.test(normalized)) partner = 'Double Degree HELP University';
    else if (/\bdnui|dalian\b/i.test(normalized)) partner = 'Double Degree DNUI';
    else if (/\butb\b/i.test(normalized)) partner = 'Dual Degree UTB';
    if (/help/i.test(partner)) { programScope = 'international'; country = 'Malaysia'; }
    if (/dnui/i.test(partner)) { programScope = 'international'; country = 'China'; }
    if (/utb/i.test(partner)) { programScope = 'national'; country = 'Indonesia'; }
    addUnique(internationalPrograms, { canonical: partner, type: 'international_program', role: 'double_degree', scope: programScope, country, confidence: 0.93, source: 'canonical-source-entity' });
  }
  if (/\b(?:form\s+iku|iku\s+pts|indikator\s+kinerja)\b/i.test(normalized)) {
    addUnique(documents, { canonical: 'FORM IKU PTS 2024 LLDIKTI', type: 'academic_document', role: 'institution_performance_document', confidence: 0.9, source: 'canonical-source-entity' });
  }
  if (/\b(?:isian\s+website|didirikan|berdiri|sejarah|awalnya|awal(?:nya)?\s+stikom|yayasan)\b/i.test(normalized)
    && /\b(?:stikom|itb\s*stikom|kampus|institut)\b/i.test(normalized)) {
    addUnique(documents, { canonical: 'Sejarah ITB STIKOM Bali', type: 'institution', role: 'institution_history', confidence: 0.88, source: 'canonical-source-entity' });
  }

  return { organizations, facilities, documents, internationalPrograms };
}

function detectFeeType(q) {
  if (/\b(?:ukt|uang\s+kuliah|biaya\s+pendidikan|per\s+semester|semesteran)\b/i.test(q)) return 'ukt';
  if (/\b(?:dpp|dana\s+pendidikan\s+pokok)\b/i.test(q)) return 'dpp';
  if (/\b(?:biaya\s+awal|awal\s+masuk|uang\s+masuk|biaya\s+masuk)\b/i.test(q)) return 'initial_fee';
  if (/\b(?:biaya\s+pendaftaran|uang\s+pendaftaran|harga\s+pendaftaran|bayar\s+pendaftaran|biaya\s+daftar|daftar\s+berapa)\b/i.test(q) || (/\b(?:daftar(?:nya)?|pendaftaran(?:nya)?|registrasi(?:nya)?)\b/i.test(q) && /\b(?:berapa|brapa|brp|nominal|biaya|harga|bayar|uang|rp|rupiah)\b/i.test(q))) return 'registration_fee';
  if (/\b(?:potongan|diskon|discount)\b/i.test(q) && !/\bbeasiswa\b/i.test(q)) return 'discount';
  if (/\b(?:total|semua|keseluruhan)\b/i.test(q) && /\b(?:biaya|bayar|uang|harga)\b/i.test(q)) return 'total_estimate';
  if (/\b(?:cicil(?:an)?|nyicil|angsur(?:an)?|tahap\s+pembayaran)\b/i.test(q)) return 'installment';
  return null;
}

function normalizeSlangTokens(input) {
  // Map common informal/slang tokens to standard Indonesian before intent detection.
  // Class-level normalization — do NOT add query-specific mappings here.
  return String(input || '')
    .replace(/\bdpt\b/gi, 'dapat')
    .replace(/\bbrp\b/gi, 'berapa')
    .replace(/\bjrsn\b/gi, 'jurusan')
    .replace(/\bprodinya\b/gi, 'prodi')
    .replace(/\bjurusannya\b/gi, 'jurusan')
    .replace(/\bakreditasinya\b/gi, 'akreditasi')
    .replace(/\bakrediasinya\b/gi, 'akreditasi')
    .replace(/\bakred\b/gi, 'akreditasi')
    .replace(/\bgelnya\b/gi, 'gelombang')
    .replace(/\bgelnya2\b/gi, 'gelombang')
    .replace(/\bgelombangnya\b/gi, 'gelombang')
    .replace(/\blulusanny\b/gi, 'lulusan')
    .replace(/\blulusan\b/gi, 'lulusan')
    .replace(/\blulus(?:an)?\b/gi, (m) => m)  // preserve
    .replace(/\bgelarnya\b/gi, 'gelar')
    .replace(/\bapaan\b/gi, 'apa')
    .replace(/\bapain\b/gi, 'apa')
    .replace(/\bjelasin\b/gi, 'jelaskan')
    .replace(/\bjelasinnya\b/gi, 'jelaskan')
    .replace(/\bgimana\b/gi, 'bagaimana')
    .replace(/\bdapet\b/gi, 'dapat')
    .replace(/\bklo\b/gi, 'kalau')
    .replace(/\bkalo\b/gi, 'kalau')
    .replace(/\bntar\b/gi, 'nanti')
    .replace(/\bbs\b/gi, 'bisa')
    .replace(/\byg\b/gi, 'yang')
    .replace(/\bdgn\b/gi, 'dengan')
    .replace(/\bkrn\b/gi, 'karena')
    .replace(/\bjd\b/gi, 'jadi')
    .replace(/\bspt\b/gi, 'seperti')
    .replace(/\bgmna?\b/gi, 'bagaimana')
    .replace(/\bkelar\b/gi, 'selesai')
    .replace(/\btitel\b/gi, 'gelar')
    .replace(/\bjmbarn\b/gi, 'jimbaran')
    .replace(/\bdr\b/gi, 'dari')
    .replace(/\bbgt\b/gi, 'banget');
}

function extractExternalRelationConstraint(rawText) {
  const raw = String(rawText || '');
  const normalized = normalizeSlangTokens(raw.toLowerCase());
  const hasRelation = /\b(?:kerja\s*sama|kerjasama|mitra|partner|rekrutmen|campus\s*hiring|kolaborasi|bekerja\s*sama)\b/i.test(normalized);
  if (!hasRelation) return null;
  const relationType = /\b(?:rekrutmen|campus\s*hiring)\b/i.test(normalized) ? 'recruitment_partner' : 'external_partnership';
  const genericObject = /\b(?:perusahaan|industri|dunia\s+usaha|dunia\s+industri|mitra\s+industri|partner\s+industri|alumni|mahasiswa|kampus|unit|pihak\s+industri)\b/i;
  const match = raw.match(/\b(?:dengan|bersama|sama\s+dengan|bareng)\s+([A-Z][A-Za-z0-9&.\-]*(?:\s+[A-Z][A-Za-z0-9&.\-]*){0,4})\b/);
  if (!match) return null;
  const object = String(match[1] || '').replace(/[?.,!]+$/g, '').trim();
  if (!object || object.length < 3) return null;
  if (genericObject.test(object.toLowerCase())) return null;
  return {
    relationType,
    object,
    objectType: 'external_entity',
    supportRequired: true,
    source: 'canonical-external-relation-pattern'
  };
}


function titleCaseCandidate(value) {
  return String(value || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.length <= 3 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function isKnownNonProgramOntologyCandidate(str) {
  const raw = String(str || '').toLowerCase().trim();
  const norm = (normalizeUserQuery(raw).normalizedText || raw).trim();
  if (!norm || norm.length < 2) return true;

  // 1. Academic levels alone or conjunction / comparison of academic levels
  if (/^(?:jenjang\s+|tingkat\s+|program\s+)?(?:s\s*1|s\s*2|s\s*3|d\s*3|d\s*4|sarjana|diploma(?:\s*(?:3|tiga))?|magister|pascasarjana|master|strata(?:\s*(?:satu|dua|tiga))?)(?:\s*(?:dan|atau|vs|versus|sama|dengan|\/|-)\s*(?:jenjang\s+|tingkat\s+|program\s+)?(?:s\s*1|s\s*2|s\s*3|d\s*3|d\s*4|sarjana|diploma(?:\s*(?:3|tiga))?|magister|pascasarjana|master|strata(?:\s*(?:satu|dua|tiga))?))*$/i.test(norm)) {
    return true;
  }
  if (/^(?:s\s*1|s\s*2|s\s*3|d\s*3|d\s*4|sarjana|diploma|magister|pascasarjana)$/i.test(norm)) {
    return true;
  }

  // 2. Scholarship morphology
  if (/^(?:beasiswa|beasiswanya|beasiswa\s+prestasi|kip|kip\s+kuliah|1k1s|skss|bantuan\s+biaya|potongan\s+biaya|potongan|diskon|keringanan)(?:nya)?$/i.test(norm)) {
    return true;
  }

  // 3. Known domain & non-program institutional routes
  if (/^(?:double\s*degree|dual\s*degree|program\s+ganda|kuliah\s+ganda|student\s*exchange|pertukaran\s+mahasiswa|rpl|rekognisi\s+pembelajaran\s+lampau|pmb|penerimaan\s+mahasiswa\s+baru|mahasiswa\s+baru|camaba|maba|hi[-\s]?think|hithink|internasional|international|career\s*center|pusat\s+karier|inkubator\s+bisnis|inbis|organisasi|ukm|ormawa|himaprodi|hima|himpunan|bantuan|fasilitas|kampus|lokasi|jadwal|biaya|ukt|dpp|spp|yudisium|wisuda|skripsi|tesis|tugas\s+akhir|akademik|orientasi|orientasi\s+digital|pelatihan|sertifikasi)(?:nya)?$/i.test(norm)) {
    return true;
  }

  // 4. Comparison tokens / generic relational wrappers
  if (/^(?:perbedaan|perbedaannya|beda|bedanya|perbandingan|vs|versus|daftar|list|pilihan|jenis|macam|informasi|info|penjelasan|rincian|detail|syarat|persyaratan|alur|cara|prosedur)(?:nya)?$/i.test(norm)) {
    return true;
  }

  return false;
}

function normalizeUnsupportedProgramCandidate(value) {
  let candidate = (normalizeUserQuery(value || '').normalizedText || String(value || '').toLowerCase())
    .replace(/\b(?:di|ke|dari|untuk|stikom|itb|bali|kampus|prodi|program\s+studi|jurusan|program|kuliah)\b/g, ' ')
    .replace(/\b(?:biaya(?:nya)?|harga(?:nya)?|bayar(?:nya)?|ukt|dpp|spp|uang(?:nya)?|pendaftaran(?:nya)?|daftar(?:nya)?|akreditasi(?:nya)?|profil(?:nya)?|profile|lama|studi|semester(?:an|nya)?|berapa|gimana|bagaimana|apa(?:an)?|itu|ya|kak|min|admin|ada|tersedia|buka|dibuka)\b.*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!candidate || candidate.length < 3) return '';
  if (/^(?:ada|punya|tersedia|apa|apa\s+saja|apa\s+aja|aja|saja|daftar|list|semua|pilihan|jenis|macam|setelah|sebelum|bisa|dapat|boleh|ganti|ubah|diubah|diganti|mana|yang|cocok|sebaiknya|rekomendasi|saran|nya|ku|mu)$/i.test(candidate)) return '';
  if (/^(?:setelah|sebelum|bisa|dapat|boleh|ganti|ubah|diubah|diganti|pilihan|awal|waktu|pertama|kali|didirikan|berdiri|saat|mana|yang|cocok|sebaiknya|rekomendasi|saran)\b/i.test(candidate)) return '';
  if (/\b(?:apa\s+saja|apa\s+aja|daftar|list|semua|pilihan|mana\s+yang|yang\s+mana|yang\s+cocok|mana\s+yang\s+cocok|sebaiknya|rekomendasi|saran)\b/i.test(candidate)) return '';
  if (isKnownNonProgramOntologyCandidate(candidate)) return '';
  return titleCaseCandidate(candidate);
}

function resolveUnsupportedProgramEntities(text, knownPrograms = []) {
  const source = String(text || '');
  const normalized = normalizeUserQuery(source).normalizedText || source.toLowerCase();
  if (/\b(?:surat\s+keputusan|menimbang\s+bahwa|mengingat\s+undang|memutuskan\s+pasal|lampiran\s+keputusan|\[sheet:|form\s+iku|q:\s*apa\s+itu|a:\s*program|profil\s+organisasi|nama\s+organisasi|nama\s+dokumen|kode\s+dokumen|dokumen\s+mentah|bocor\s+seperti\s+ini)\b/i.test(source)) return [];
  if (/\b(?:himpunan\s+mahasiswa\s+prodi|himaprodi|hima\b|ukm\b|ormawa|organisasi\s+mahasiswa|unit\s+kegiatan\s+mahasiswa)\b/i.test(normalized)) return [];
  if (!/\b(?:jurusan|prodi|program\s+studi|program\b|kuliah\s+di|ambil\s+jurusan|pilih\s+jurusan)\b/i.test(normalized)) return [];
  const supportedLabels = new Set((Array.isArray(knownPrograms) ? knownPrograms : []).map((program) => (normalizeUserQuery(program && program.canonical || '').normalizedText || String(program && program.canonical || '').toLowerCase()).trim()).filter(Boolean));
  if (supportedLabels.size > 0) return [];
  const patterns = [
    /\b(?:jurusan|prodi|program\s+studi)\s+([a-z0-9\p{L}][a-z0-9\p{L}\s._-]{1,60}?)(?:\s+(?:di|ke|untuk|biaya(?:nya)?|harga(?:nya)?|bayar(?:nya)?|ukt|dpp|spp|uang(?:nya)?|pendaftaran(?:nya)?|daftar(?:nya)?|akreditasi(?:nya)?|profil(?:nya)?|profile|lama|studi|semester(?:an|nya)?|berapa|gimana|bagaimana|apa(?:an)?|itu|ya|kak|min|admin|ada|tersedia|buka|dibuka)\b|[?.!,]|$)/iu,
    /\bprogram\s+([a-z0-9\p{L}][a-z0-9\p{L}\s._-]{1,60}?)(?:\s+(?:di|ke|untuk|biaya(?:nya)?|harga(?:nya)?|bayar(?:nya)?|ukt|dpp|spp|uang(?:nya)?|pendaftaran(?:nya)?|daftar(?:nya)?|akreditasi(?:nya)?|profil(?:nya)?|profile|lama|studi|semester(?:an|nya)?|berapa|gimana|bagaimana|apa(?:an)?|itu|ya|kak|min|admin|ada|tersedia|buka|dibuka)\b|[?.!,]|$)/iu,
    /\b(?:kuliah\s+di|ambil\s+jurusan|pilih\s+jurusan)\s+([a-z0-9\p{L}][a-z0-9\p{L}\s._-]{1,60}?)(?:\s+(?:di|ke|untuk|biaya(?:nya)?|harga(?:nya)?|bayar(?:nya)?|ukt|dpp|spp|uang(?:nya)?|pendaftaran(?:nya)?|daftar(?:nya)?|akreditasi(?:nya)?|profil(?:nya)?|profile|lama|studi|semester(?:an|nya)?|berapa|gimana|bagaimana|apa(?:an)?|itu|ya|kak|min|admin|ada|tersedia|buka|dibuka)\b|[?.!,]|$)/iu
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const candidate = match && normalizeUnsupportedProgramCandidate(match[1]);
    if (!candidate) continue;
    const candidateKey = (normalizeUserQuery(candidate).normalizedText || String(candidate || '').toLowerCase()).trim();
    if (supportedLabels.has(candidateKey)) return [];
    return [{
      canonical: candidate,
      surface: match[1],
      type: 'program',
      role: 'unsupported_entity_candidate',
      confidence: 0.78,
      source: 'canonical-open-world-unsupported-program'
    }];
  }
  return [];
}
function classifyIntentDomain(rawQuery, normalizedQuery, entities, temporal) {
  const qRaw = String(normalizedQuery || rawQuery || '').toLowerCase();
  const q = normalizeSlangTokens(qRaw);
  const hasLocationIntent = /\b(?:alamat|lokasi|dimana|di\s*mana|where|letak|maps?|google\s+maps|rute|arah|patokan|pin\s+lokasi|share\s*loc|shareloc)\b/i.test(q);
  const hasPhysicalAttribute = /\b(?:tinggi|luas|jumlah\s+lantai|berapa\s+lantai|lantai\s+berapa|kapasitas|ukuran|warna(?:nya)?|panjang|lebar|besar(?:nya)?|daya\s+tampung)\b/i.test(q);
  const feeType = detectFeeType(q);
  const hasFee = (Boolean(feeType) || /\b(?:biaya(?:nya)?|harga(?:nya)?|bayar(?:nya|an)?|pembayaran|uang|nominal|tarif|fee|cost|nyicil|cicil(?:an)?|angsur(?:an)?|tagihan(?:nya)?|denda(?:nya)?)\b/i.test(q));
  const hasScholarship = /\b(?:beasiswa|kip|1k1s|skss|bantuan\s+biaya|potongan)\b/i.test(q);
  const hasInternationalAdmin = /\b(?:mahasiswa\s+asing|foreign\s+student|international\s+student|keimigrasian|imigrasi|izin\s+(?:belajar|tinggal)|perpanjang(?:an)?\s+izin|visa|vitas|itas|kitas|sktt)\b/i.test(q);
  const hasInternationalAdminFee = hasFee && hasInternationalAdmin;
  const hasUnsupportedExchangeBarterRelation = /\b(?:exchange|tukar|barter|ditukar|menukar)\b/i.test(q)
    && /\b(?:voucher|kupon|kantin|uang|ukt|dpp|biaya|tagihan|saldo|barang)\b/i.test(q)
    && !/\b(?:student\s+exchange|pertukaran\s+mahasiswa|program\s+exchange|exchange\s+reguler|credit\s+transfer|gccp|bccp)\b/i.test(q);
  const hasRpl = /\b(?:rpl|rekognisi\s+pembelajaran\s+lampau)\b/i.test(q);
  const hasAvailabilityStatus = /\b(?:masih\s+buka|masih\s+dibuka|masih\s+menerima|menerima\s+pendaftaran|terima\s+pendaftaran|buka|dibuka|aktif|berjalan|status)\b/i.test(q);
  const hasRegistrationDataCorrection = /\b(?:salah|keliru|typo|salah\s+ketik|salah\s+isi|salah\s+input|ubah|edit|koreksi|perbaiki|revisi)\b/i.test(q)
    && /\b(?:data|form|formulir|biodata|nama|nik|nomor|email|kontak|pendaftaran|daftar|registrasi|pmb|camaba|mahasiswa\s+baru)\b/i.test(q)
    && /\b(?:daftar|pendaftaran|registrasi|pmb|camaba|mahasiswa\s+baru|form|formulir)\b/i.test(q)
    && !hasFee;
  const hasContactRequest = /\b(?:kontak|hubungi|menghubungi|nomor|no\.?\s*(?:wa|telp|telepon)?|wa\b|whatsapp|telepon|telp|phone|cs|customer\s*service|helpdesk)\b/i.test(q)
    && /\b(?:kampus|stikom|itb|admin|pmb|kontak|nomor|telepon|telp|wa|whatsapp|hubungi|helpdesk)\b/i.test(q)
    && !hasRegistrationDataCorrection;
  const hasRegistrationTopicOpening = /\b(?:mau|ingin|pengen|pengin|boleh|izin|permisi|info(?:rmasi)?)\b/i.test(q)
    && /\b(?:tanya|bertanya|nanya|menanyakan|soal|tentang|mengenai|info(?:rmasi)?)\b/i.test(q)
    && /\b(?:pmb|penerimaan\s+mahasiswa\s+baru|pendaftaran\s+mahasiswa\s+baru|mahasiswa\s+baru|camaba|maba)\b/i.test(q)
    && !hasFee
    && !hasScholarship
    && !hasAvailabilityStatus;
  const hasPmbDefinition = /\b(?:apa\s+itu|apakah\s+itu|itu\s+apa|pengertian|definisi|maksud(?:nya)?|jelaskan)\b/i.test(q)
    && /\b(?:pmb|penerimaan\s+mahasiswa\s+baru)\b/i.test(q);
  const asksRegistrationHow = /\b(?:cara|gimana|bagaimana|alur|prosedur|langkah|lewat|online|how|where|apply|application|admission)\b/i.test(q)
    && /\b(?:daftar(?:nya)?|mendaftar|pendaftaran|registrasi|kuliah|pmb|mahasiswa\s+baru|camaba|maba|study|studying|student|international\s+student)\b/i.test(q)
    && !hasFee
    && !hasScholarship
    && !hasAvailabilityStatus
    && !hasRegistrationDataCorrection;
  const asksRegistrationChannel = /\b(?:link|tautan|url|website|situs|channel|kanal|kontak|nomor|whatsapp|wa|lewat\s+mana|dimana|di\s+mana)\b/i.test(q)
    && /\b(?:daftar(?:nya)?|pendaftaran|pendaftarannya|registrasi|pmb|mahasiswa\s+baru|camaba|maba)\b/i.test(q)
    && !hasFee
    && !hasScholarship;
  const asksRegistrationRequirements = /\b(?:syarat|persyaratan|dokumen|berkas|ketentuan|perlu\s+apa|butuh\s+apa|required|requirements?|documents?)\b/i.test(q)
    && /\b(?:daftar(?:nya)?|mendaftar|pendaftaran|registrasi|pmb|mahasiswa\s+baru|camaba|maba|kuliah|prodi|program\s+studi|jurusan|apply|application|admission|study|studying|student|international\s+student)\b/i.test(q)
    && !hasFee
    && !hasScholarship;
  const hasSchedule = (/\b(?:jadwal|gelombang|gbg|bulan\s+depan|bulan\s+ini|bulan\s+lalu|deadline|tanggal|tgl|kapan|ditutup|tutup|buka|dibuka|mulai|dimulai|aktif)\b/i.test(q)
    || Boolean(temporal.explicitDate || temporal.requestedMonth || temporal.requestedWave))
    && !/\b(?:berlaku|masa\s+berlaku|valid(?:itas)?|kedaluwarsa|expired)\b/i.test(q);
  const hasFacility = /\b(?:fasilitas|fasilias|fasiltas|layanan|sarana|prasarana|laboratorium|lab|perpustakaan|ruang|kantin|parkir|wifi|inkubator|inbis|language\s+learning|llc|hi\s*think|hithink)\b/i.test(q);
  const hasCareer = /\b(?:career\s*center|pusat\s+karier|pusat\s+karir|cdc|karier|karir|prospek\s+kerja|peluang\s+kerja|lowongan|magang|job\s*fair|campus\s*hiring|tracer\s*study|persiapan\s+kerja|siap\s+kerja|dunia\s+kerja|pembekalan|melamar\s+pekerjaan|mendapat(?:kan)?\s+pekerjaan|dapat\s+kerja|mencari\s+kerja|mencari\s+pekerjaan|bantuan\s+(?:persiapan|kerja|pekerjaan|karier|karir)|lulusan.*(?:pekerjaan|kerja|karier|karir)|alumni.*(?:pekerjaan|kerja|karier|karir)|sertifikasi|pelatihan)\b/i.test(q);
  const careerTopic = !hasCareer ? null
    : /\b(?:apa\s+itu|itu\s+apa|pengertian|definisi|maksud(?:nya)?|jelaskan|tentang)\b/i.test(q)
      && /\b(?:career\s*center|karier\s*center|karir\s*center|pusat\s+karier|pusat\s+karir|cdc)\b/i.test(q) ? 'definition'
      : /\b(?:keuntungan|manfaat|benefit|nilai\s+tambah|sisi\s+karier)\b/i.test(q) ? 'benefit'
        : /\b(?:membantu.*(?:pekerjaan|kerja)|mendapat(?:kan)?\s+(?:pekerjaan|kerja)|dapat\s+kerja|mencari\s+(?:pekerjaan|kerja)|bantuan\s+(?:mencari|mendapat|persiapan|kerja|pekerjaan)|lulusan.*(?:kerja|pekerjaan)|alumni.*(?:kerja|pekerjaan))\b/i.test(q) ? 'employment_support'
          : /\b(?:lowongan|loker|magang|job\s*fair|campus\s*hiring|rekrutmen|tracer\s*study)\b/i.test(q) ? 'opportunity'
            : /\b(?:layanan|fungsi|tugas|ngapain|untuk\s+apa|apa\s+saja|apa\s+aja|memberikan|bantu|membantu)\b/i.test(q) ? 'service'
              : 'service';
  const externalRelation = extractExternalRelationConstraint(rawQuery || normalizedQuery);
  const asksLearning = /\b(?:belajar|dipelajari|perkuliahan|kuliah(?:nya)?(?:\s+(?:apa|apa\s+saja|apa\s+aja|yang\s+ada|membahas))?|mata\s+kuliah|matkul|materi|course|kelas|kurikulum|skill|kompetensi|coding|ngoding|ai|artificial\s+intelligence|kecerdasan\s+buatan)\b/i.test(q);
  const asksAdvice = /\b(?:kurang|tidak|ga|gak|nggak|belum)\s+(?:cakap|jago|mahir|bisa|paham)|\b(?:apa\s+yang\s+harus|harus\s+bagaimana|saran|cocok|minat)\b/i.test(q);
  const asksList = /\b(?:apa\s+saja|apa\s+aja|daftar|list|pilihan|macam|sebutkan)\b/i.test(q);
  const asksCount = /\b(?:berapa\s+(?:banyak|jumlah(?:nya)?|total(?:nya)?|ada|kampus|lokasi|cabang)|ada\s+berapa|jumlah(?:nya)?|total(?:nya)?|berapa\s+unit|berapa\s+organisasi|berapa\s+kampus|berapa\s+lokasi|berapa\s+cabang)\b/i.test(q);
  const organizationCategory = detectOrganizationCategory(String(rawQuery || '') + ' ' + qRaw + ' ' + q);
  const curriculumTopic = detectCurriculumTopic(String(rawQuery || '') + ' ' + qRaw + ' ' + q);
  const scholarshipRequestSubtype = detectScholarshipRequestSubtype(q);
  const hasCampusCount = asksCount && /\b(?:kampus(?:nya)?|lokasi(?:nya)?|cabang)\b/i.test(q) && !hasPhysicalAttribute && !/\b(?:ukm|ormawa|organisasi|biaya|ukt|dpp|sks|semester|beasiswa|prodi|program\s+studi|jurusan)\b/i.test(q);
  const hasOrganization = /\b(?:ormawa|ukm|unit\s+kegiatan\s+mahasiswa|organisasi\s+mahasiswa|organisasi\s+kampus|kegiatan\s+mahasiswa|himaprodi|hima|himpunan\s+mahasiswa)\b/i.test(q)
    || (organizationCategory && /\b(?:organisasi|komunitas|unit\s+kegiatan|kegiatan)\b/i.test(q) && /\b(?:minat|suka|hobi|hobby|tertarik|ikut|mengikuti|buat|untuk)\b/i.test(q));
  const hasStudentSupport = /\b(?:lomba|kompetisi|prestasi|kegiatan\s+mahasiswa|organisasi\s+mahasiswa|kemahasiswaan|minat\s+dan\s+bakat|minat|ormawa|ukm)\b/i.test(q)
    && /\b(?:dukung|mendukung|dukungan|bantu|membantu|fasilitasi|fasilitas|ikut|mengikuti|ada|tersedia|program)\b/i.test(q);
  const hasAcademic = /\b(?:sks|skripsi|tugas\s+akhir|tesis|\bta\b|krs|wisuda|yudisium|kalender\s+akademik|baak|remedial|remidi|fokus\s+penelitian|riset|nilai|transkrip)\b/i.test(q);
  const hasAcademicSchedule = (hasAcademic || /\bakademik\b/i.test(q))
    && /\b(?:jadwal|kalender|kapan|tanggal|tgl|periode|pendaftaran|pelaksanaan|semester|ganjil|genap)\b/i.test(q);
  const hasExplicitUnknownProgramScheduleOwner = hasSchedule
    && !hasFee
    && /\bprogram\s+(?!studi\b|pmb\b|pendaftaran\b|penerimaan\b|beasiswa\b|bantuan\b|rpl\b|double\b|dual\b|ganda\b|internasional\b|international\b|student\b|exchange\b)([a-z0-9\p{L}][a-z0-9\p{L}\s._-]{1,40}?)(?:\s+(?:kapan|dibuka|buka|mulai|dimulai|jadwal|periode|pendaftaran|deadline|tanggal|tgl)\b|[?.!,]|$)/iu.test(q)
    && !entities.programs.length
    && !entities.internationalPrograms.length;
  const hasExplicitInternationalScheduleOwner = hasSchedule
    && !hasFee
    && (entities.internationalPrograms.length > 0 || /\b(?:double\s*degree|dual\s*degree|program\s+ganda|kuliah\s+ganda|student\s*exchange|pertukaran\s+mahasiswa|hi[-\s]?think|hithink|program\s+internasional)\b/i.test(q));
  const hasPmbSchedule = hasSchedule
    && !hasFee
    && !hasAcademicSchedule
    && !hasInternationalAdmin
    && !hasExplicitUnknownProgramScheduleOwner
    && !hasExplicitInternationalScheduleOwner
    && (
      Boolean(temporal.requestedWave || temporal.requestedMonth)
      || /\b(?:pmb|pendaftaran|penerimaan\s+mahasiswa\s+baru|mahasiswa\s+baru|camaba|maba|gelombang|gbg)\b/i.test(q)
    );
  const hasAcademicProcedure = /\b(?:cara|bagaimana|gimana|alur|prosedur|syarat|persyaratan|daftar|pendaftaran|registrasi|mengurus|urus|lapor|minta)\b/i.test(q)
    && /\b(?:yudisium|wisuda|remedial|remidi|sidang|tugas\s+akhir|skripsi|tesis|krs|baak|akademik|nilai|transkrip)\b/i.test(q);
  // Academic numeric: any quantitative question about an academic object (SKS, semester, word count, page limit, etc.)
  const hasAcademicNumericGeneral = /\b(?:berapa|jumlah|batas|limit|maksimal|minimal|total)\b/i.test(q)
    && /\b(?:sks|semester|kata|halaman|lembar|kredit|abstrak|abstrak|bab|paragraf|huruf|spasi|karakter)\b/i.test(q)
    && /\b(?:skripsi|tugas\s+akhir|tesis|\bta\b|laporan|proposal|karya\s+ilmiah|abstrak|akademik)\b/i.test(q);
  const hasAcademicNumeric = (
    /\b(?:sks|semester|masa\s+studi|berapa\s+sks|berapa\s+semester)\b/i.test(q)
    && (/\b(?:s2|s\s*2|pascasarjana|pasca\s*sarjana|magister|master)\b/i.test(q)
      || entities.programs.some((program) => /\b(?:S2|Magister|Pascasarjana)\b/i.test(String(program.canonical || ''))))
  ) || hasAcademicNumericGeneral;
  const hasPostgraduateLearning = asksLearning
    && !hasFee
    && (
      /\b(?:s2|s\s*2|pascasarjana|pasca\s*sarjana|magister|master)\b/i.test(q)
      || entities.programs.some((program) => /\b(?:S2|Magister|Pascasarjana)\b/i.test(String(program.canonical || '')))
    );
  const hasAccreditation = /\b(?:akreditasi|akrediasi|ban\s*-?pt|lam\s*infokom|peringkat\s+akreditasi|sertifikat\s+akreditasi)\b/i.test(q);
  const hasDoubleDegreeSequence = /\b(?:dnui|dalian\s+neusoft|double\s*degree|dual\s*degree)\b/i.test(q)
    && /\b(?:skema|tahapan|tahun\s+(?:ke-?\s*)?(?:1|2|3|4|pertama|kedua|ketiga|keempat|3|4)|bertahap|harus\s+ke|wajib\s+ke|pergi\s+ke|kuliah\s+di|onsite|online|offline)\b/i.test(q);
  // Institution-history semantic class — requires institution entity context before resolving subtype
  const hasInstitutionEntity = /\b(?:stikom|itb\s*stikom|kampus\s+(?:ini|stikom|itb)|institut\s+teknologi|itb)\b/i.test(q)
    || (entities.programs.length === 0 && entities.organizations.length === 0 && /\b(?:kampus|universitas|perguruan\s+tinggi|institusi|lembaga\s+pendidikan)\b/i.test(q));
  // Non-institution entity scope: any reference to sub-unit, org, or named non-institution entity
  const hasNonInstitutionEntityScope = entities.organizations.length > 0
    || /\b(?:ukm|ormawa|himaprodi|hima|bem|dpm|student\s+exchange|pertukaran\s+mahasiswa|double\s*degree|dual\s*degree|inbis|career\s+center|organisasi\s+mahasiswa|unit\s+kegiatan)\b/i.test(q);
  // Named non-institution entity: UKM/ORMAWA/org/program/facility WITHOUT institution institution anchor
  // This covers 'pendiri UKM Tari', 'penggagas Student Exchange', etc.
  const hasNonInstitutionNamedEntity = (
    /\b(?:ukm|ormawa|hima(?:prodi)?|student\s+exchange|pertukaran\s+mahasiswa|inbis|inkubator\s+bisnis|career\s+center|pusat\s+karier|double\s*degree|dual\s*degree|program\s+internasional)\b/i.test(q)
  ) && !/\b(?:itb\s*stikom|stikom\s+bali|kampus\s+itb|institutnya|kampus\s+keseluruhan)\b/i.test(q);
  const hasInstitutionHistorySignal = /\b(?:didirikan|berdiri|sejarah|awalnya|awal\s+mula|yayasan|tanggal\s+berapa|pendiri|tokoh\s+pendiri|siapa\s+yang\s+mendirikan|didirikan\s+oleh|penggagas|perintis|menginisiasi\s+berdirinya|awal\s+berdiri|sejarah\s+awal|asal\s+mula|inisiasi\s+berdirinya|tanggal\s+resmi\s+berdiri(?:nya)?|pendirian|izin\s+operasional|sk\s+mendiknas|surat\s+keputusan\s+mendiknas)\b/i.test(q);
  const hasInstitutionHistory = hasInstitutionHistorySignal
    && !hasAcademic
    && !hasNonInstitutionNamedEntity
    && (hasInstitutionEntity || !hasNonInstitutionEntityScope);
  // International program + degree outcome: international/partner program entity + degree outcome token
  // Must be checked BEFORE generic hasProgramDegreeOutcome to avoid intent displacement
  const asksExplicitCredentialOutcome = /\b(?:gelar(?:nya)?|ijazah(?:nya)?|titel(?:nya)?|credential|bachelor|lulusan\s+(?:dapat|dapet|dpt|mendapat)|(?:dapat|dapet|dpt|diperoleh|memperoleh|mendapat(?:kan)?)\s+(?:gelar|ijazah|titel|credential|bachelor))\b/i.test(q);
  const hasInternationalProgramDegreeOutcome = !hasFee
    && (entities.internationalPrograms.length > 0 || /\b(?:double\s*degree|dual\s*degree|utb|help|dnui)\b/i.test(q))
    && asksExplicitCredentialOutcome;
  // Program degree outcome signal: [prodi/program/jurusan] + [gelar/degree/lulus] + question
  const hasProgramDegreeOutcome = (entities.programs.length > 0 || /\b(?:prodi|jurusan|program\s+studi|fakultas|kuliah\s+di)\b/i.test(q))
    && asksExplicitCredentialOutcome;
  // Determine institution-history subtype for requestedFields
  const institutionHistorySubtype = (!hasInstitutionHistory || hasAccreditation) ? null
    : /\b(?:pendiri|tokoh\s+pendiri|siapa\s+yang\s+mendirikan|didirikan\s+oleh|penggagas|perintis|menginisiasi|inisiasi)\b/i.test(q) ? 'FOUNDING_PEOPLE'
      : /\b(?:kapan|tanggal|berapa|tahun|hari|tanggal\s+berapa|tanggal\s+resmi)\b/i.test(q) ? 'FOUNDING_DATE'
        : /\b(?:sk\s+mendiknas|surat\s+keputusan|izin\s+operasional|nomor\s+sk|no\.?\s*sk)\b/i.test(q) ? 'LEGAL_ESTABLISHMENT_DOCUMENT'
          : /\b(?:sejarah\s+awal|asal\s+mula|awal\s+mula|awal\s+berdiri|awalnya)\b/i.test(q) ? 'ORIGIN_HISTORY'
            : /\b(?:sejarah)\b/i.test(q) ? 'HISTORICAL_MILESTONE'
              : 'FOUNDING_EVENT';
  const hasIkuDocument = /\b(?:form\s+iku|iku\s+pts|indikator\s+kinerja|lldikti)\b/i.test(q);
  const hasStudentExchangeTopic = /\b(?:student\s+exchange|pertukaran\s+mahasiswa)\b/i.test(q);
  const hasOrganizationProfile = (entities.organizations.length > 0
    || /\b(?:ukm|ormawa|himaprodi|hima|himpunan|bem|dpm|pragina|tari|athena|vos|mapala|esports?|teater)\b/i.test(q))
    && /\b(?:profil|profile|organisasi\s+apa|apa\s+itu|itu\s+apa|visi|misi|tentang|seperti\s+apa|program\s+kerja|proker|peran|fungsi|tujuan|kegiatan|apa\s+namanya|ada\s+gak|tersedia|apakah\s+ada)\b/i.test(q);
  const hasFacilityProfile = (entities.facilities.length > 0
    || /\b(?:inbis|inkubator\s+bisnis|language\s+learning|llc|hi\s*think)\b/i.test(q))
    && /\b(?:unit\s+apa|apa\s+itu|itu\s+apa|profil|profile|visi|misi|tahapan|tahap|program|tentang|peran|fungsi|bantu|membantu|dukungan|layanan|business\s+matching|networking|jejaring|level\s+bahasa|bahasa\s+jepang)\b/i.test(q);
  const hasThesisTerm = /\b(?:skripsi|tugas\s+akhir|tesis|ta)\b/i.test(q);
  const hasThesisPageTerm = /\b(?:halaman|lembar|jumlah\s+halaman|minimal|maksimal|panjang\s+naskah)\b/i.test(q);
  const hasThesisAbstractTerm = /\b(?:abstrak|abstract)\b/i.test(q) && /\b(?:berapa|jumlah|batas|maksimal|minimal|kata|karakter|huruf)\b/i.test(q);
  const hasThesisAdvisorChange = /\b(?:ganti|pergantian|ubah|perubahan)\b/i.test(q) && /\b(?:dosen\s+pembimbing|pembimbing\s+skripsi|supervisor|pembimbing\s+tesis|dosen\s+pendamping)\b/i.test(q);
  const hasThesisCertificateEquivalency = /\b(?:konversi|pengganti|tukar|menggantikan|mengganti|sebagai\s+pengganti|setara)\b/i.test(q) && /\b(?:sertifikat|certificate|ijazah\s+kursus|piagam)\b/i.test(q) && hasThesisTerm;
  const hasThesisSubmissionProcedure = hasThesisTerm
    && /\b(?:ajukan|mengajukan|pengajuan|daftar|mendaftar|cara|caranya|alur|prosedur|langkah|syarat)\b/i.test(q);
  // Additional academic subtopics: bibliography standard, intro page limit, remedial policy
  const hasThesisBibliographyStandard = hasThesisTerm
    && /\b(?:daftar\s+pustaka|referensi|bibliography|sitasi|sumber|format\s+penulisan)\b/i.test(q)
    && /\b(?:IEEE|APA|Harvard|gaya\s+penulisan|standar|format|aturan)\b/i.test(q);
  const hasThesisIntroPageLimit = hasThesisTerm
    && /\b(?:kata\s+pengantar|pengantar|prakata)\b/i.test(q)
    && /\b(?:halaman|lembar|berapa|batas|maksimal|minimal)\b/i.test(q);
  const hasThesisRemedialPolicy = /\b(?:remedial|perbaikan\s+nilai|nilai\s+remedial|ulang\s+nilai|pengulangan\s+mata\s+kuliah)\b/i.test(q)
    && /\b(?:syarat|ketentuan|aturan|semester|berlaku|batas|maksimal|minimum|dapat|boleh|apakah\s+bisa)\b/i.test(q);
  const academicTopic = hasThesisAbstractTerm ? 'thesis_abstract_limit'
    : (hasThesisAdvisorChange ? 'thesis_advisor_change'
      : (hasThesisCertificateEquivalency ? 'thesis_certificate_equivalency'
        : (hasThesisSubmissionProcedure ? 'thesis_submission_procedure'
          : (hasThesisBibliographyStandard ? 'thesis_bibliography_standard'
            : (hasThesisIntroPageLimit ? 'thesis_intro_page_limit'
              : (hasThesisRemedialPolicy ? 'thesis_remedial_policy'
                : (hasThesisTerm && hasThesisPageTerm ? 'thesis_page_count'
                  : (hasThesisTerm ? 'thesis_general' : null))))))));
  const strongProgramComparisonContext = /\b(?:beda|bedanya|bedain|perbedaan|banding|bandingkan|dibanding(?:kan)?|perbandingan|vs|versus|sama\s+.*\b(?:ti|sk|si|bd|mi)\b|\b(?:ti|sk|si|bd|mi)\b\s+sama\s+\b(?:ti|sk|si|bd|mi)\b)\b/i.test(q);
  if (strongProgramComparisonContext && /\bsk\b/i.test(q) && !entities.programs.some((entity) => entity.canonical === 'Sistem Komputer') && !/\b(?:surat\s+keputusan|nomor\s+sk|no\.?\s*sk|sk\s+mendiknas|izin\s+operasional|legal|dokumen)\b/i.test(q)) {
    entities.programs.push({ type: 'program', canonical: 'Sistem Komputer', code: 'SK', surface: 'sk', confidence: 0.84, source: 'canonical-program-alias-comparison-context' });
  }
  const hasProgramComparison = strongProgramComparisonContext && entities.programs.length >= 2 && !hasFee;
  // Generalized cross-domain comparison: comparison token + 2 domain-context tokens from different sets
  const COMPARISON_SIGNAL = /\b(?:sama(?:kah)?(?:\s+dengan)?|apakah\s+sama|beda(?:kah)?(?:\s+dengan)?|dibandingkan|apakah\s+berbeda|apa\s+bedanya|apa\s+perbedaan|perbedaan|vs|versus|perbeda(?:an)?nya?|membandingkan)\b/i;
  const ACADEMIC_DOMAIN_TOKEN = /\b(?:wisuda|yudisium|sidang|kuliah|perkuliahan|kalender\s+akademik|remedial|remidi|krs|semester|ujian|baak)\b/i;
  const PMB_DOMAIN_TOKEN = /\b(?:pmb|pendaftaran|gelombang|daftar\s+ulang|registrasi\s+ulang|mahasiswa\s+baru|camaba)\b/i;
  const DEGREE_LEVEL_TOKEN = /\b(?:s1|sarjana)\b/i;
  const DIPLOMA_TOKEN = /\b(?:d3|diploma)\b/i;
  const academicLevels = detectAcademicLevels(q);
  const FEE_DOMAIN_TOKEN = /\b(?:ukt|dpp|biaya\s+pendidikan|biaya\s+semesteran|biaya\s+pangkal)\b/i;
  const hasCrossDomainComparison = COMPARISON_SIGNAL.test(q)
    && (
      (ACADEMIC_DOMAIN_TOKEN.test(q) && PMB_DOMAIN_TOKEN.test(q))
      || (DEGREE_LEVEL_TOKEN.test(q) && DIPLOMA_TOKEN.test(q))
      || (FEE_DOMAIN_TOKEN.test(q) && (ACADEMIC_DOMAIN_TOKEN.test(q) || PMB_DOMAIN_TOKEN.test(q)))
      || (/\bdpp\b/i.test(q) && /\bukt\b/i.test(q))
    );
  const hasAcademicLevelComparison = COMPARISON_SIGNAL.test(q)
    && academicLevels.length >= 2
    && /\b(?:program|prodi|jurusan|jenjang|level\s+kuliah|strata|diploma|sarjana|pascasarjana|magister|s\s*1|s\s*2|d\s*3)\b/i.test(q)
    && !hasFee;
  const hasCareerGoalTopic = /\b(?:bekerja|kerja|karier|karir|bidang|minat|pemasaran|marketing|digital\s+marketing|bisnis|jualan|usaha|data|analis|analyst|programmer|developer|software|coding|desain|multimedia|jaringan|network|cyber|keamanan|akuntansi|manajemen)\b/i.test(q);
  const hasCareerGoalAspiration = /\b(?:mau|ingin|pengen|pengin)\s+(?:jadi|menjadi|bekerja|kerja|masuk|ambil)\s+\w+/i.test(q);
  const hasCareerGoalExpression = hasCareerGoalTopic || hasCareerGoalAspiration;
  const hasRecommendationSignal = /\b(?:cocok|cocoknya|rekomendasi|saran|pilih|ambil|yang\s+mana|mana\s+yang)\b/i.test(q)
    || (/\b(?:jurusan\s+apa|prodi\s+apa|program\s+apa)\b/i.test(q) && hasCareerGoalExpression);
  const hasExplicitCatalogueListRequest = asksList
    && !/\b(?:jurusan|prodi|program)\s+(?:apa|yang\s+mana|mana\s+yang)\b/i.test(q)
    && !/\b(?:cocok|rekomendasi|saran|sebaiknya|pilih|ambil|ingin\s+(?:jadi|bekerja|kerja)|mau\s+(?:jadi|bekerja|kerja)|target\s+kerja|minat|suka)\b/i.test(q);
  const hasCareerGoalRecommendation = hasRecommendationSignal
    && hasCareerGoalExpression
    && !hasExplicitCatalogueListRequest
    && !hasFee;
  const hasFeeComponentComparison = /\bdpp\b/i.test(q) && /\bukt\b/i.test(q)
    && (COMPARISON_SIGNAL.test(q) || /\b(?:beda|bedanya|berbeda|bukan|sama|perbedaan|komponen)\b/i.test(q));
  const hasAcademicCreditComparison = /\b(?:s1|sarjana)\b/i.test(q)
    && /\b(?:s2|s\s*2|pascasarjana|pasca\s*sarjana|magister|master)\b/i.test(q)
    && /\b(?:sks|beban\s+studi|jumlah\s+sks|kredit|semester)\b/i.test(q)
    && /\b(?:sama|beda|berbeda|lebih|kurang|sedikit|perbandingan|bandingkan|dibanding)\b/i.test(q);
  const hasExplicitEntityTypeComparisonSignal = /\b(?:jurusan|prodi|program\s+studi|organisasi|himpunan|himaprodi|atau|bukan|beda|berbeda|sama)\b/i.test(q)
    && !/\b(?:fungsi|peran|tujuan|profil|profile|kegiatan|program\s+kerja|proker|visi|misi)\b/i.test(q);
  const hasEntityTypeComparison = entities.organizations.length > 0
    && entities.programs.length > 0
    && hasExplicitEntityTypeComparisonSignal;
  const INTERNATIONAL_CONTRAST_SIGNAL = /\b(?:sama(?:kah)?(?:\s+dengan)?|apakah\s+sama|tidak\s+sama|nggak\s+sama|gak\s+sama|bukan|beda(?:kah)?(?:\s+dengan)?|berbeda|perbedaan|bedanya|apa\s+bedanya|apa\s+perbedaan|vs|versus|atau)\b/i;
  const hasInternationalProgramComparison = INTERNATIONAL_CONTRAST_SIGNAL.test(q)
    && entities.internationalPrograms.length >= 2
    && /\b(?:student\s*exchange|pertukaran\s+mahasiswa|double\s*degree|dual\s*degree|dnui|dalian|help|utb|hi[-\s]?think|hithink|program\s+internasional)\b/i.test(q);
  const isDoubleDegree = entities.internationalPrograms.some((entity) => String(entity.role || '') === 'double_degree')
    || /\b(?:double\s*degree|dual\s*degree|program\s+ganda|kuliah\s+ganda)\b/i.test(q);
  const isInternational = entities.internationalPrograms.length > 0 || isDoubleDegree;
  const hasInternationalProgramSchedule = isInternational && hasSchedule && !hasFee;
  const asksInternationalProcedureSignal = /\b(?:syarat|persyaratan|seleksi(?:nya)?|perlu\s+apa|butuh\s+apa|dokumen|cara|alur|prosedur|langkah|tahapan|lewat\s+mana|kanal|channel|pengumuman)\b/i.test(q)
    || (/\b(?:ikut|mengikuti|daftar|pendaftaran)\b/i.test(q) && !hasSchedule);
  const hasInternationalProgramProcedure = entities.internationalPrograms.length > 0
    && asksInternationalProcedureSignal
    && !hasInternationalProgramSchedule
    && !hasFee;
  const hasProgramLevelList = /\b(?:jenjang|level\s+kuliah|strata|diploma|sarjana|pascasarjana|magister|d3|s1|s\s*1|s2|s\s*2)\b/i.test(q)
    && /\b(?:apa\s+saja|apa\s+aja|ada|tersedia|pilihan|daftar|list|program|prodi|jurusan)\b/i.test(q)
    && !hasFee
    && !hasAcademic;
  const hasProgramList = (/\b(?:jurusan(?:nya)?|prodi(?:nya)?|program\s+studi)\b/i.test(q) && asksList) || hasProgramLevelList;
  const asksProgramDefinition = /\b(?:apa\s+itu|apakah\s+itu|itu\s+apa|apaan|pengertian|jelaskan|maksud(?:nya)?|tentang|jurusan\s+apa|prodi\s+apa|program\s+studi\s+apa|seperti\s+apa)\b/i.test(q) && entities.programs.length > 0;
  const asksProgramFocusProfile = entities.programs.length > 0
    && /\b(?:fokus(?:nya)?|arah\s+belajar|belajarnya|dipelajari|mempelajari|materi|kurikulum|kompetensi|spesialisasi|konsentrasi)\b/i.test(q)
    && !hasFee
    && !hasProgramComparison
    && !hasProgramDegreeOutcome;
  const hasInstitutionProfile = /\b(?:visi|misi|tujuan|profil|profile|identitas)\b/i.test(q)
    && /\b(?:kampus|institusi|lembaga|itb\s*stikom|stikom\s+bali|institut)\b/i.test(q)
    && !/\b(?:ukm|ormawa|organisasi\s+mahasiswa|himaprodi|himpunan|bem|inbis|inkubator|career\s*center|pusat\s+karier|student\s+exchange|double\s*degree|dual\s*degree|prodi|program\s+studi|jurusan)\b/i.test(q);
  const hasDualDegreeRelation = /\b(?:utb|universitas\s+teknologi\s+bandung)\b/i.test(q)
    && /\b(?:dkv|desain\s+komunikasi\s+visual)\b/i.test(q)
    && /\b(?:stikom|stikom\s+bali|itb\s*stikom|sisi\s+stikom|di\s+stikom|prodi\s+stikom|jurusan\s+stikom)\b/i.test(q)
    && /\b(?:jurusan|prodi|program\s+studi|pasangan|padanan|sisi|diambil|ambil|yang\s+diambil|apa)\b/i.test(q);
  // Double degree outcome: partner program + degree/credential outcome — no hardcoded partner names
  const hasDoubleDegreeOutcome = /\b(?:double\s*degree|dual\s*degree|program\s+ganda|kuliah\s+ganda)\b/i.test(q)
    && asksExplicitCredentialOutcome
    && !hasDoubleDegreeSequence;
  const doubleDegreeScope = /\b(?:nasional|national)\b/i.test(q) ? 'national'
    : (/\b(?:internasional|international|luar\s+negeri)\b/i.test(q) ? 'international'
      : (/\b(?:help|dnui|dalian|china|malaysia)\b/i.test(q) ? 'international'
        : (/\b(?:utb|universitas\s+teknologi\s+bandung|bandung)\b/i.test(q) ? 'national' : null)));
  // Cross-domain comparison query
  const hasComparisonQuery = /\b(?:sama(?:kah)?\s+dengan|apakah\s+sama|beda(?:kah)?\s+dengan|dibandingkan|vs|versus|sama\s+atau\s+berbeda|apa\s+bedanya)\b/i.test(q)
    && /\b(?:jadwal|tanggal|gelombang|wisuda|yudisium|pmb|pendaftaran|akademik|dpp|ukt)\b/i.test(q);
  const hasLegalDocumentVsPmbComparison = COMPARISON_SIGNAL.test(q)
    && /\b(?:sk|surat\s+keputusan|izin\s+operasional|legal|dokumen\s+pendirian|pendirian)\b/i.test(q)
    && /\b(?:pmb|gelombang|jadwal\s+pmb|pendaftaran\s+mahasiswa\s+baru)\b/i.test(q);
  const hasUnsupportedAcademicPolicy = /\b(?:boleh|diizinkan|diperbolehkan|izin|tanpa\s+izin|apakah\s+bisa|bisa\s+tidak|boleh\s+tidak)\b/i.test(q)
    && /\b(?:ujian|kuliah|kelas|sidang|remedial|yudisium|wisuda|akademik)\b/i.test(q)
    && /\b(?:online|remote|jarak\s+jauh|luar\s+negeri|tanpa\s+izin|tanpa\s+persetujuan|tanpa\s+konfirmasi)\b/i.test(q)
    && !/\b(?:student\s+exchange|pertukaran\s+mahasiswa|double\s*degree|dual\s*degree|hi[-\s]?think|hithink)\b/i.test(q);
  const asksOrganizationList = hasOrganization && (
    /\b(?:apa\s+saja|apa\s+aja|daftar|list|sebutkan|pilihan|jenis|macam|ada\s+apa|ada\s+gak|punya\s+apa|tersedia\s+apa)\b/i.test(q)
    || (asksList && !/\b(?:cara|alur|proses|langkah|syarat|dokumen|biaya)\b/i.test(q))
  );
  let primaryIntent = 'ask_general';
  let primaryDomain = 'general';
  let answerExpectation = 'safe_answer_or_fallback';

  if (hasUnsupportedExchangeBarterRelation) {
    primaryIntent = 'ask_unsupported_relation';
    primaryDomain = 'unknown';
    answerExpectation = 'safe_fallback';
  } else if (hasUnsupportedAcademicPolicy) {
    primaryIntent = 'ask_unsupported_policy';
    primaryDomain = 'academic_policy';
    answerExpectation = 'safe_fallback';
  } else if (hasLegalDocumentVsPmbComparison) {
    primaryIntent = 'ask_cross_domain_comparison';
    primaryDomain = 'general';
    answerExpectation = 'comparison';
  } else if (hasAccreditation) {
    primaryIntent = 'ask_accreditation';
    primaryDomain = 'accreditation';
    answerExpectation = /\b(?:berlaku\s+sampai|masa\s+berlaku|valid|sampai\s+kapan|tanggal)\b/i.test(q) ? 'validity' : 'specific_fact_or_fallback';
  } else if (hasExplicitUnknownProgramScheduleOwner) {
    primaryIntent = 'ask_schedule';
    primaryDomain = 'unknown';
    answerExpectation = 'safe_fallback';
  } else if (hasPmbSchedule) {
    primaryIntent = 'ask_schedule';
    primaryDomain = 'pmb_schedule';
    answerExpectation = 'date_or_period';
  } else if (hasInstitutionHistory) {
    primaryIntent = 'ask_institution_history';
    primaryDomain = 'institution_profile';
    answerExpectation = 'historical_fact';
  } else if (hasIkuDocument) {
    primaryIntent = 'ask_document_definition';
    primaryDomain = 'institution_document';
    answerExpectation = 'document_definition';
  } else if (hasEntityTypeComparison) {
    primaryIntent = 'ask_entity_type_comparison';
    primaryDomain = 'general';
    answerExpectation = 'comparison';
  } else if (hasOrganization && (asksCount || /\b(?:berapa|jumlah|total)\b/i.test(q))) {
    primaryIntent = 'ask_organization_count';
    primaryDomain = 'student_organization';
    answerExpectation = 'count';
  } else if (hasOrganization && organizationCategory) {
    primaryIntent = 'ask_organization_profile';
    primaryDomain = 'student_organization';
    answerExpectation = 'availability_or_category';
  } else if (asksOrganizationList) {
    primaryIntent = 'ask_organization_list';
    primaryDomain = 'student_organization';
    answerExpectation = 'list';
  } else if (hasOrganizationProfile) {
    primaryIntent = /\b(?:visi|misi)\b/i.test(q) ? 'ask_organization_vision_mission' : 'ask_organization_profile';
    primaryDomain = 'student_organization';
    answerExpectation = /\b(?:visi|misi)\b/i.test(q) ? 'vision_mission' : 'profile';
  } else if (hasStudentSupport && hasOrganization) {
    primaryIntent = 'ask_organization_list';
    primaryDomain = 'student_organization';
    answerExpectation = 'list';
  } else if (hasStudentSupport) {
    primaryIntent = 'ask_student_support';
    primaryDomain = 'student_support';
    answerExpectation = 'support_availability';
  } else if (entities.programs.length > 0 && /\b(?:prospek\s+kerja|peluang\s+kerja|lulusan|kerja|karier|karir|pekerjaan)\b/i.test(q) && !/\b(?:career\s*center|pusat\s+karier|pusat\s+karir|cdc|job\s*fair|campus\s*hiring|tracer\s*study)\b/i.test(q)) {
    primaryIntent = 'ask_program_curriculum';
    primaryDomain = 'program_curriculum';
    answerExpectation = 'curriculum_or_topic_presence';
  } else if (hasCareer) {
    primaryIntent = 'ask_career_service';
    primaryDomain = 'career';
    answerExpectation = 'service_or_career_info';
  } else if (hasFacilityProfile) {
    primaryIntent = /\b(?:visi|misi)\b/i.test(q) ? 'ask_facility_vision_mission' : 'ask_facility_profile';
    primaryDomain = 'campus_facility';
    answerExpectation = /\b(?:visi|misi)\b/i.test(q) ? 'vision_mission' : 'profile';
  } else if (hasInstitutionProfile) {
    primaryIntent = /\b(?:visi|misi)\b/i.test(q) ? 'ask_institution_vision_mission' : 'ask_institution_profile';
    primaryDomain = 'institution_profile';
    answerExpectation = /\b(?:visi|misi)\b/i.test(q) ? 'institution_vision_mission' : 'institution_profile_or_fallback';
  } else if (hasInternationalProgramComparison) {
    primaryIntent = 'ask_international_program_comparison';
    primaryDomain = 'international_program';
    answerExpectation = 'comparison';
  } else if (isDoubleDegree && /\b(?:kampus\s+(?:mitra|partner)|partner|mitra|universitas\s+(?:mitra|partner)|negara(?:nya)?|tujuan)\b/i.test(q) && !hasFee) {
    primaryIntent = 'ask_availability';
    primaryDomain = 'double_degree';
    answerExpectation = 'list';
  } else if (hasInternationalProgramSchedule) {
    primaryIntent = 'ask_schedule';
    primaryDomain = isDoubleDegree ? 'double_degree' : 'international_program';
    answerExpectation = 'date_or_period';
  } else if (hasInternationalProgramProcedure) {
    primaryIntent = 'ask_international_program_procedure';
    primaryDomain = 'international_program';
    answerExpectation = 'procedure';
  } else if (hasDoubleDegreeSequence) {
    primaryIntent = 'ask_international_program_sequence';
    primaryDomain = 'double_degree';
    answerExpectation = 'sequence';
  } else if (hasInternationalProgramDegreeOutcome) {
    primaryIntent = 'ask_international_degree_outcome';
    primaryDomain = 'double_degree';
    answerExpectation = 'degree_or_credential';
  } else if (hasDualDegreeRelation) {
    primaryIntent = 'ask_relation_pairing';
    primaryDomain = 'double_degree';
    answerExpectation = 'relation_pairing';
  } else if (hasProgramComparison) {
    primaryIntent = 'ask_program_comparison';
    primaryDomain = 'program';
    answerExpectation = 'comparison';
  } else if (hasAcademicCreditComparison) {
    primaryIntent = 'ask_academic_comparison';
    primaryDomain = 'academic';
    answerExpectation = 'comparison';
  } else if (hasCampusCount) {
    primaryIntent = 'ask_campus_count';
    primaryDomain = 'campus_location';
    answerExpectation = 'count';
  } else if (hasLocationIntent && !hasPhysicalAttribute) {
    primaryIntent = 'ask_location';
    primaryDomain = 'campus_location';
    answerExpectation = 'address_or_route';
  } else if (hasFeeComponentComparison || hasCrossDomainComparison || hasComparisonQuery) {
    primaryIntent = 'ask_cross_domain_comparison';
    primaryDomain = 'general';
    answerExpectation = 'comparison';
  } else if (academicTopic) {
    primaryIntent = 'ask_academic_info';
    primaryDomain = 'academic';
    answerExpectation = 'specific_fact_or_fallback';
  } else if (hasAcademicNumeric) {
    primaryIntent = 'ask_academic_numeric';
    primaryDomain = 'academic';
    answerExpectation = 'numeric_fact';
  } else if (hasAcademicProcedure) {
    primaryIntent = 'ask_academic_procedure';
    primaryDomain = 'academic';
    answerExpectation = 'procedure';
  } else if (hasAcademicSchedule) {
    primaryIntent = 'ask_academic_schedule';
    primaryDomain = 'academic';
    answerExpectation = 'date_or_period';
  } else if (hasPhysicalAttribute) {
    primaryIntent = 'ask_physical_attribute';
    primaryDomain = 'campus_physical';
    answerExpectation = 'specific_fact_or_fallback';
  } else if (hasRpl) {
    primaryIntent = 'ask_rpl';
    primaryDomain = 'rpl';
    answerExpectation = 'definition';
  } else if (hasScholarship) {
    primaryIntent = 'ask_scholarship';
    primaryDomain = 'scholarship';
    answerExpectation = asksList ? 'list' : 'specific_fact_or_fallback';
  } else if (hasContactRequest) {
    primaryIntent = 'ask_contact';
    primaryDomain = 'campus_contact';
    answerExpectation = 'contact';
  } else if (asksRegistrationHow) {
    primaryIntent = 'ask_registration_how';
    primaryDomain = 'registration';
    answerExpectation = 'procedure';
  } else if (asksRegistrationRequirements) {
    primaryIntent = 'ask_registration_requirements';
    primaryDomain = 'registration';
    answerExpectation = 'requirements_or_procedure';
  } else if (hasInternationalAdminFee) {
    primaryIntent = 'ask_international_admin_fee';
    primaryDomain = 'international_admin';
    answerExpectation = 'amount_or_breakdown';
  } else if (hasInternationalAdmin) {
    primaryIntent = 'ask_international_admin_procedure';
    primaryDomain = 'international_admin';
    answerExpectation = /\\b(?:dokumen|syarat|berkas|urus|ngurus|perpanjang|prosedur|cara|bagaimana|gimana)\\b/i.test(q) ? 'procedure' : 'specific_fact_or_fallback';
  } else if (hasFee) {
    primaryIntent = 'ask_fee';
    primaryDomain = 'fee';
    answerExpectation = 'amount_or_breakdown';
  } else if (hasPmbDefinition) {
    primaryIntent = 'ask_definition';
    primaryDomain = 'registration';
    answerExpectation = 'definition';
  } else if (hasRegistrationTopicOpening) {
    primaryIntent = 'ask_general';
    primaryDomain = 'registration';
    answerExpectation = 'topic_opening';
  } else if (asksLearning && entities.programs.length) {
    primaryIntent = 'ask_program_curriculum';
    primaryDomain = 'program_curriculum';
    answerExpectation = 'curriculum_or_topic_presence';
  } else if (entities.internationalPrograms.length > 0) {
    primaryIntent = 'ask_availability';
    primaryDomain = entities.internationalPrograms.some((entity) => String(entity.role || '') === 'double_degree') ? 'double_degree' : 'international_program';
    answerExpectation = 'availability_or_safe_fallback';
  } else if (hasRegistrationDataCorrection) {
    primaryIntent = 'ask_registration_data_correction';
    primaryDomain = 'registration';
    answerExpectation = 'procedure';
  } else if (asksRegistrationRequirements) {
    primaryIntent = 'ask_registration_requirements';
    primaryDomain = 'registration';
    answerExpectation = 'requirements';
  } else if (asksRegistrationChannel || asksRegistrationHow) {
    primaryIntent = 'ask_registration_how';
    primaryDomain = 'registration';
    answerExpectation = 'procedure';
  } else if (hasSchedule) {
    primaryIntent = 'ask_schedule';
    primaryDomain = 'pmb_schedule';
    answerExpectation = 'date_or_period';
  } else if (hasDoubleDegreeOutcome) {
    primaryIntent = 'ask_international_degree_outcome';
    primaryDomain = 'double_degree';
    answerExpectation = 'degree_or_credential';
  } else if (hasProgramDegreeOutcome) {
    primaryIntent = 'ask_program_degree_outcome';
    primaryDomain = 'program';
    answerExpectation = 'degree_or_credential';
  } else if (asksAdvice && entities.programs.length) {
    primaryIntent = 'ask_program_advice';
    primaryDomain = 'program_advice';
    answerExpectation = 'advice_with_entity';
  } else if (hasCareerGoalRecommendation) {
    primaryIntent = 'ask_program_recommendation';
    primaryDomain = 'program_recommendation';
    answerExpectation = 'recommendation_or_safe_fallback';
  } else if (hasPostgraduateLearning) {
    primaryIntent = 'ask_program_curriculum';
    primaryDomain = 'program_curriculum';
    answerExpectation = 'curriculum_or_topic_presence';
  } else if (hasProgramList) {
    primaryIntent = 'ask_program_list';
    primaryDomain = 'program';
    answerExpectation = 'list';
  } else if (asksProgramFocusProfile) {
    primaryIntent = 'ask_program_curriculum';
    primaryDomain = 'program_curriculum';
    answerExpectation = 'curriculum_or_topic_presence';
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
  }

  const explicitPointInTime = temporal.explicitDate && !/\b(?:bulan|sebulan|selama\s+bulan|ringkasan\s+bulan|overview\s+bulan|bulan\s+apa\s+saja)\b/i.test(q);
  let questionType = 'informational';
  if (asksCount) questionType = 'count';
  else if (hasAcademicLevelComparison || hasFeeComponentComparison || hasAcademicCreditComparison || hasEntityTypeComparison || hasLegalDocumentVsPmbComparison) questionType = 'comparison';
  else if (hasAcademicNumeric) questionType = 'numeric';
  else if (hasInternationalProgramSchedule || hasAcademicSchedule) questionType = 'schedule';
  else if (hasAcademicProcedure || hasThesisSubmissionProcedure || hasInternationalProgramProcedure || hasRegistrationDataCorrection) questionType = 'procedure';
  else if (hasInternationalProgramComparison) questionType = 'comparison';
  else if (hasDualDegreeRelation) questionType = 'relation_pairing';
  else if (hasDoubleDegreeOutcome || hasProgramDegreeOutcome) questionType = 'degree_outcome';
  else if (hasCareerGoalRecommendation) questionType = 'recommendation';
  else if (/\b(?:berlaku(?:nya)?\s+sampai|masa\s+berlaku(?:nya)?|valid(?:ity)?|sampai\s+kapan|sampai\s+tahun\s+berapa)\b/i.test(q)) questionType = 'validity';
  else if (hasContactRequest) questionType = 'contact';
  else if (hasInstitutionHistory) questionType = institutionHistorySubtype ? institutionHistorySubtype.toLowerCase() : 'historical_state';
  else if (hasIkuDocument) questionType = 'definition';
  else if (careerTopic === 'definition' || asksProgramDefinition) questionType = 'definition';
  else if (hasDoubleDegreeSequence) questionType = 'sequence';
  else if (hasOrganizationProfile || hasFacilityProfile || hasInstitutionProfile || careerTopic === 'benefit') questionType = 'profile';
  else if (explicitPointInTime) questionType = 'temporal_point_in_time';
  else if (asksList || hasProgramLevelList) questionType = 'list';
  else if (/\b(?:tahun\s+1|tahun\s+2|tahun\s+3|tahun\s+4|tahun\s+pertama|tahun\s+kedua|tahun\s+ketiga|tahun\s+keempat|skema|tahapan|bertahap)\b/i.test(q)) questionType = 'sequence';
  else if (/\b(?:apakah|apa|ada|punya|tersedia)\b/i.test(q)) questionType = 'yes_no_or_explain';
  return {
    intent: { primary: primaryIntent, secondary: [], confidence: primaryIntent === 'ask_general' ? 0.45 : 0.82 },
    domain: { primary: primaryDomain, confidence: primaryDomain === 'general' ? 0.45 : 0.82 },
    constraints: {
      feeType,
      registrationWave: temporal.requestedWave || null,
      academicLevel: academicLevels.length === 1 ? academicLevels[0] : null,
      academicLevels,
      programScope: doubleDegreeScope,
      geographicScope: doubleDegreeScope,
      locationIntent: hasLocationIntent,
      physicalAttribute: hasPhysicalAttribute,
      comparisonTarget: hasAcademicLevelComparison ? 'academic_level' : (hasLegalDocumentVsPmbComparison ? 'institution_legal_document_vs_pmb_schedule' : (hasInternationalProgramComparison ? 'international_program' : (hasFeeComponentComparison ? 'fee_component' : (hasAcademicCreditComparison ? 'academic_credit' : (hasEntityTypeComparison ? 'entity_type' : (/\b(?:beda|bedanya|bedain|perbedaan|banding|bandingkan|dibanding(?:kan)?|perbandingan|vs|versus)\b/i.test(q) ? 'program' : null)))))),
      academicTopic: academicTopic
        || (hasAcademicNumeric ? 'academic_numeric'
          : (hasAcademicProcedure ? 'academic_procedure'
            : (hasAcademicSchedule ? 'academic_schedule' : null))),
      relationType: hasUnsupportedExchangeBarterRelation ? 'unsupported_exchange_barter'
        : (hasUnsupportedAcademicPolicy ? 'unsupported_academic_policy'
          : (hasLegalDocumentVsPmbComparison ? 'institution_legal_document_vs_pmb_schedule'
            : (externalRelation ? externalRelation.relationType : (hasInternationalProgramComparison ? 'international_program_contrast' : (hasFeeComponentComparison ? 'fee_component_contrast' : (hasAcademicCreditComparison ? 'academic_credit_comparison' : (hasEntityTypeComparison ? 'entity_type_distinction' : (hasDualDegreeRelation ? 'double_degree_partner_program_pairing' : (hasDoubleDegreeSequence ? 'double_degree_sequence' : (hasDoubleDegreeOutcome || hasInternationalProgramDegreeOutcome ? 'double_degree_outcome' : null)))))))))),
      externalRelation,
      institutionHistorySubtype: institutionHistorySubtype || null,
      institutionTopic: hasInstitutionProfile ? (/\b(?:visi|misi)\b/i.test(q) ? 'vision_mission' : (/\btujuan\b/i.test(q) ? 'purpose' : 'profile')) : null,
      careerTopic,
      organizationCategory: (primaryDomain === 'student_organization' || primaryDomain === 'student_support') ? organizationCategory : null,
      curriculumTopic,
      scholarshipRequestSubtype: hasScholarship ? scholarshipRequestSubtype : null,
      entityFamily: hasCampusCount ? 'campus' : (hasOrganization ? 'student_organization' : null),
      temporalMode: temporal.explicitDate && !/\b(?:bulan|sebulan|selama\s+bulan|ringkasan\s+bulan|overview\s+bulan|bulan\s+apa\s+saja)\b/i.test(q) ? 'point_in_time' : (temporal.requestedMonth ? 'month_overview' : null)
    },
    questionType,
    answerExpectation,
    ambiguity: []
  };
}

function extractRequestedFields(rawQuery, normalizedQuery, classification) {
  const q = String(normalizedQuery || rawQuery || '').toLowerCase();
  const fields = new Set();
  const asksProfileRelation = /\b(?:profil(?:nya)?|profile|tentang(?:nya)?|apa\s+itu|itu\s+apa|jelaskan|detail(?:nya)?|gambaran)\b/i.test(q);
  const asksExplicitProcedureRelation = /\b(?:cara(?:nya)?|bagaimana\s+cara|gimana\s+cara|alur(?:nya)?|prosedur(?:nya)?|langkah|tahapan|syarat|persyaratan|dokumen\s+apa|berkas|pendaftaran|mendaftar|daftar(?:nya)?|registrasi(?:nya)?|how\s+to|how\s+do\s+i|steps|procedure|requirements?)\b/i.test(q);

  if (classification && classification.intent && classification.intent.primary === 'ask_academic_level_comparison') {
    fields.add('academicLevel');
    fields.add('comparison');
    fields.add('duration');
    fields.add('studyFocus');
    fields.add('programList');
  }

  if (classification && classification.intent && classification.intent.primary === 'ask_program_recommendation') {
    fields.add('programRecommendation');
    fields.add('careerGoal');
    fields.add('academicLevel');
  }

  if (/\b(?:kapan|tanggal|tgl|hari|waktu|jadwal|periode|bulan|tahun)\b/i.test(q)) {
    if (/\b(?:berlaku|masa\s+berlaku|valid(?:ity)?)\b/i.test(q)) {
      fields.add('validityPeriod');
    } else if (classification
      && classification.intent
      && classification.intent.primary === 'ask_institution_history'
      && classification.domain
      && classification.domain.primary === 'institution_profile'
      && classification.constraints
      && classification.constraints.institutionHistorySubtype === 'FOUNDING_DATE') {
      fields.add('foundingDate');
      fields.add('date');
    } else {
      fields.add('date');
    }
  }
  if (/\b(?:berlaku(?:nya)?\s+sampai|masa\s+berlaku(?:nya)?|valid(?:ity)?|sampai\s+kapan|sampai\s+tahun\s+berapa)\b/i.test(q)) {
    fields.add('validityPeriod');
  }
  // Academic object numeric (word count, page count, abstract limit)
  if (/\b(?:berapa|jumlah|batas|maksimal|minimal|limit)\b/i.test(q) && /\b(?:kata|karakter|huruf|halaman|lembar)\b/i.test(q)) {
    fields.add('numericLimit');
    fields.add('pageLimit');
  }
  // Institution history founding people
  if (/\b(?:pendiri|siapa\s+yang\s+mendirikan|tokoh\s+pendiri|penggagas|perintis|menginisiasi|inisiasi)\b/i.test(q)) {
    fields.add('founderNames');
  }
  // Double degree / program degree credential outcome. Require credential context;
  // plain "dapat" can mean receive an admin document (e.g. KITAS), and the phrase
  // "Double Degree" itself is a program label, not necessarily a request for degree outcome.
  const asksCredentialOutcome = /\b(?:gelar(?:nya)?|ijazah(?:nya)?|titel(?:nya)?|title(?:nya)?|credential|bachelor|lulusan\s+(?:dapat|dapet|dpt|mendapat)|(?:dapat|dapet|dpt|diperoleh)\s+(?:gelar|ijazah|degree|titel|title|credential|bachelor))\b/i.test(q)
    || (/\bdegree\b/i.test(q) && !/\b(?:double|dual)\s+degree\b/i.test(q));
  if (asksCredentialOutcome) {
    fields.add('degreeOutcome');
    fields.add('degree');
  }

  const intent = String(classification && classification.intent && classification.intent.primary || '');
  const domain = String(classification && classification.domain && classification.domain.primary || '');
  const relationType = String(classification && classification.constraints && classification.constraints.relationType || '');
  const careerTopic = String(classification && classification.constraints && classification.constraints.careerTopic || '');
  const feeType = String(classification && classification.constraints && classification.constraints.feeType || '');
  if (domain === 'student_organization' || intent === 'ask_organization_profile' || intent === 'ask_organization_count' || intent === 'ask_organization_vision_mission') {
    fields.add('organization');
    if (classification && classification.constraints && classification.constraints.organizationCategory) {
      fields.add('organizationCategory');
      fields.add('availability');
    }
    if (classification && (classification.questionType === 'count' || intent === 'ask_organization_count')) {
      fields.add('organizationCount');
    }
    if (intent === 'ask_organization_list' || (classification && classification.questionType === 'list')) {
      fields.add('organizationList');
      fields.add('availability');
    }
  }
  if (intent === 'ask_career_service' || domain === 'career') {
    fields.add('careerSupport');
    if (careerTopic) fields.add(`career:${careerTopic}`);
    if (careerTopic === 'definition') fields.add('definition');
    if (careerTopic === 'benefit') fields.add('benefit');
    if (careerTopic === 'employment_support') fields.add('employmentSupport');
    if (careerTopic === 'service') fields.add('service');
    if (careerTopic === 'opportunity') fields.add('opportunity');
  }
  if (intent === 'ask_registration_data_correction') {
    fields.add('dataCorrection');
    fields.add('procedureSteps');
  }
  if (intent === 'ask_registration_requirements') {
    fields.add('requirements');
    fields.add('registration');
  }
  if (intent === 'ask_contact' || domain === 'campus_contact') {
    fields.add('contact');
    fields.add('phone');
    fields.add('channel');
  }
  if (intent === 'ask_program_list') {
    fields.add('programList');
    if (/\b(?:jenjang|d3|s1|s\s*1|s2|s\s*2|diploma|sarjana|pascasarjana|magister)\b/i.test(q)) fields.add('academicLevel');
  }
  if (intent === 'ask_program_curriculum' || /\b(?:fokus(?:nya)?|arah\s+belajar|belajarnya|dipelajari|kompetensi|spesialisasi|konsentrasi)\b/i.test(q)) {
    fields.add('focus');
    fields.add('curriculumFocus');
    if ((classification && classification.constraints && classification.constraints.curriculumTopic) || detectCurriculumTopic(String(rawQuery || '') + ' ' + String(normalizedQuery || ''))) {
      fields.add('curriculumTopicPresence');
      fields.add('specificTopic');
    }
  }
  if (intent === 'ask_international_program_comparison' || relationType === 'international_program_contrast') {
    fields.add('contrast');
    fields.add('programType');
  }
  if (domain === 'double_degree' || (domain !== 'program_curriculum' && /\b(?:double\s*degree|dual\s*degree|program\s+ganda)\b/i.test(q))) {
    fields.add('availability');
    fields.add('partner');
    fields.add('program');
    if (intent === 'ask_schedule' || (classification && classification.questionType === 'schedule')) {
      fields.add('schedule');
      fields.add('date');
    }
    if (classification && classification.constraints && classification.constraints.programScope) fields.add('programScope');
    if (classification && classification.constraints && classification.constraints.geographicScope) fields.add('geographicScope');
  }
  if (relationType === 'institution_legal_document_vs_pmb_schedule') {
    fields.add('documentDate');
    fields.add('scheduleDistinction');
    fields.add('contrast');
  }
  if (intent === 'ask_unsupported_policy' || domain === 'academic_policy') {
    fields.add('policy');
    fields.add('allowed');
    fields.add('permission');
  }
  if (/\b(?:berapa\s+lama|durasi|lama\s+kuliah|lama\s+studi|waktu\s+pengurusan|proses)\b/i.test(q)) {
    fields.add('duration');
  }
  if (/\b(?:berapa\s+semester|semester)\b/i.test(q) && (/\b(?:s2|magister|d3|s1|studi|masa\s+studi)\b/i.test(q) || (classification && classification.constraints && classification.constraints.academicLevel))) {
    fields.add('semesterCount');
  }
  if (/\b(?:berapa\s+sks|sks|total\s+sks|beban\s+sks)\b/i.test(q)) {
    fields.add('creditCount');
    fields.add('sksWeight');
  }
  if (asksProfileRelation) {
    fields.add('profile');
    fields.add('definition');
  }
  if (feeType) {
    fields.add('amount');
    if (feeType === 'registration_fee') fields.add('registrationFee');
    else if (feeType === 'ukt') fields.add('tuitionFee');
    else if (feeType === 'dpp') fields.add('developmentFee');
    else if (feeType === 'discount') fields.add('discount');
    else if (feeType === 'total_estimate') fields.add('totalFee');
    else fields.add('feeComponent');
  }
  if (intent !== 'ask_program_curriculum' && asksExplicitProcedureRelation && !(feeType && domain === 'fee') && !(asksProfileRelation && !/\b(?:cara|bagaimana\s+cara|gimana\s+cara|alur|prosedur|langkah|tahapan|syarat|persyaratan|dokumen\s+apa|berkas|pendaftaran|mendaftar|daftar(?:nya)?|registrasi(?:nya)?|how\s+to|how\s+do\s+i|steps|procedure|requirements?)\b/i.test(q))) {
    fields.add('procedureSteps');
  }
  if (/\b(?:unit\s+mana|cek\s+ke\s+unit|info(?:rmasi)?\s+pendaftaran|media\s+sosial|pengumuman|direktorat|channel|kanal|lewat\s+mana)\b/i.test(q)) {
    fields.add('informationChannel');
  }
  if (/\b(?:dormitory|asrama|tempat\s+tinggal|shared\s+room|fasilitas\s+tinggal|tinggal\s+apa)\b/i.test(q)) {
    fields.add('accommodation');
    fields.add('facility');
  }
  if (/\b(?:level\s+bahasa|bahasa\s+jepang|n2|jlpt|kerja\s+jepang)\b/i.test(q)) {
    fields.add('languageLevel');
  }
  if (/\b(?:alumni|lulusan)\b/i.test(q) && /\b(?:lowongan|loker|karier|career|job|info)\b/i.test(q)) {
    fields.add('alumniJobInfo');
  }
  if (/\b(?:business\s+matching|networking|jejaring|kemitraan|pasca\s+inkubasi|pasca-inkubasi)\b/i.test(q)) {
    fields.add('businessMatching');
    fields.add('networking');
  }
  if (/\b(?:exchange|tukar|barter|ditukar|menukar)\b/i.test(q) && /\b(?:voucher|kupon|kantin|ukt|dpp|biaya|saldo|barang)\b/i.test(q)) {
    fields.add('unsupportedRelation');
  }
  if (/\b(?:tahun\s+(?:1|2|3|4|pertama|kedua|ketiga|keempat)|skema|alur\s+kuliah|urutan|sequence)\b/i.test(q)) {
    fields.add('sequence');
  }
  if (/\b(?:akreditasi(?:\s+apa)?|peringkat|grade|terakreditasi|status\s+akreditasi|status)\b/i.test(q)) {
    fields.add('grade');
    fields.add('status');
  }
  if (/\b(?:biaya|harga|uang|nominal|tarif|bayar|ukt|dpp|spp|fee|cost|tuition|price|payment)\b/i.test(q)) {
    fields.add('amount');
  }
  if (/\b(?:dokumen\s+apa|formulir\s+apa|surat\s+apa|buat\s+apa|buat\s+laporan|dipakai|digunakan|laporan\s+apa|untuk\s+apa|fungsi(?:nya)?|tujuan(?:nya)?|definisi|pengertian)\b/i.test(q)) {
    fields.add('documentPurpose');
    fields.add('purpose');
  }
  if (/\b(?:daftar\s+pustaka|referensi|ieee|apa\s+style|harvard|sitasi|format\s+penulisan|gaya\s+penulisan)\b/i.test(q)) {
    fields.add('bibliographyStandard');
  }
  if (/\b(?:sk\s+mendiknas|surat\s+keputusan|izin\s+operasional|nomor\s+sk|no\.?\s*sk)\b/i.test(q)) {
    fields.add('legalDocumentNumber');
    fields.add('legalEstablishmentDocument');
  }
  if (/\b(?:mahasiswa\s+asing|foreign\s+student|keimigrasian|imigrasi|itas|kitas|sktt|izin\s+(?:belajar|tinggal)|perpanjang(?:an)?\s+izin|visa)\b/i.test(q)) {
    fields.add('foreignStudentImmigration');
    if (/\b(?:sktt|domisili|tempat\s+tinggal|dokumen\s+domisili|surat\s+domisili)\b/i.test(q)) {
      fields.add('sktt');
      fields.add('document');
      fields.add('domicileDocument');
    }
  }
  if (/\bdpp\b/i.test(q) && /\bukt\b/i.test(q)) {
    fields.add('feeComponent');
    fields.add('componentDifference');
  }
  if (/\b(?:s1|sarjana)\b/i.test(q) && /\b(?:s2|s\s*2|pascasarjana|magister)\b/i.test(q) && /\b(?:sks|beban\s+studi|semester)\b/i.test(q)) {
    fields.add('creditComparison');
    fields.add('creditCount');
  }
  if (/\b(?:jurusan|prodi|program\s+studi)\b/i.test(q) && /\b(?:organisasi|himpunan|himaprodi)\b/i.test(q)) {
    fields.add('entityType');
    fields.add('distinction');
  }
  if (/\b(?:syarat|persyaratan|seleksi(?:nya)?|perlu\s+apa|butuh\s+apa|dokumen|requirements?|documents?|criteria|eligibility)\b/i.test(q)) {
    fields.add('requirements');
  }
  if (domain === 'scholarship' || intent === 'ask_scholarship') {
    fields.add('scholarship');
    const subtype = classification && classification.constraints && classification.constraints.scholarshipRequestSubtype;
    if (subtype === 'requirements') fields.add('scholarshipRequirements');
    else if (subtype === 'procedure') fields.add('scholarshipProcedure');
    else if (subtype === 'availability') fields.add('scholarshipAvailability');
    else fields.add('scholarshipList');
  }
  if (domain === 'campus_location' && intent === 'ask_campus_count') {
    fields.add('campusCount');
    fields.add('locationCount');
  }
  return Array.from(fields);
}

function buildRoutingQuery(normalizedQuery, entities, classification) {
  const additions = [];
  for (const program of entities.programs) additions.push(program.canonical);
  if (classification.constraints.feeType) additions.push(classification.constraints.feeType);
  if (classification.intent.primary === 'ask_location' || classification.domain.primary === 'campus_location') additions.push('lokasi alamat kampus ITB STIKOM Bali Denpasar Jimbaran Abiansemal');
  if (classification.intent.primary === 'ask_program_comparison') additions.push('perbedaan program studi');
  if (classification.intent.primary === 'ask_program_curriculum') additions.push('kurikulum');
  if (classification.intent.primary === 'ask_program_definition') additions.push('definisi program studi');
  if (classification.intent.primary === 'ask_organization_count') additions.push('jumlah UKM Ormawa organisasi mahasiswa');
  if (classification.intent.primary === 'ask_organization_list') additions.push('daftar UKM Ormawa organisasi mahasiswa');
  if (classification.constraints && classification.constraints.organizationCategory) additions.push('kategori minat organisasi UKM ' + classification.constraints.organizationCategory.label);
  if (classification.intent.primary === 'ask_campus_count') additions.push('jumlah lokasi kampus ITB STIKOM Bali Denpasar Jimbaran Abiansemal');
  if (classification.constraints && classification.constraints.curriculumTopic) additions.push('topik kurikulum ' + classification.constraints.curriculumTopic.label);
  if (classification.intent.primary === 'ask_relation_pairing') additions.push('Double Degree UTB DKV Bisnis Digital pasangan prodi');
  if (classification.domain.primary === 'institution_profile' || classification.intent.primary === 'ask_institution_history') {
    additions.push('sejarah berdirinya didirikan tanggal 20 Mei 2001 Yayasan Widya Dharma Shanti visi misi profil institusi ITB STIKOM Bali');
    if (classification.constraints && classification.constraints.institutionHistorySubtype === 'FOUNDING_PEOPLE') {
      additions.push('pendiri tokoh penggagas perintis inisiasi Prof Made Bandem Dadang Hermawan');
    }
  }
  for (const unsupported of (entities.unsupported || [])) additions.push(unsupported.canonical);
  if (classification.intent.primary === 'ask_international_degree_outcome') additions.push('Double Degree gelar lulusan degree Bachelor S.Kom BIT program mitra');
  if (classification.intent.primary === 'ask_cross_domain_comparison') additions.push('perbandingan jadwal wisuda yudisium PMB pendaftaran gelombang akademik');
  if (classification.constraints && classification.constraints.academicTopic === 'thesis_abstract_limit') additions.push('abstrak tugas akhir skripsi jumlah kata batas maksimal minimal');
  if (classification.constraints && classification.constraints.academicTopic === 'thesis_advisor_change') additions.push('pergantian dosen pembimbing skripsi prosedur surat permohonan Kaprodi');
  if (classification.constraints && classification.constraints.academicTopic === 'thesis_certificate_equivalency') additions.push('sertifikat pengganti skripsi konversi tugas akhir');
  if (classification.constraints && classification.constraints.academicTopic === 'thesis_bibliography_standard') additions.push('daftar pustaka referensi format penulisan IEEE APA Harvard standar tugas akhir skripsi');
  if (classification.constraints && classification.constraints.academicTopic === 'thesis_intro_page_limit') additions.push('kata pengantar halaman batas maksimal minimal tugas akhir skripsi');
  if (classification.constraints && classification.constraints.academicTopic === 'thesis_remedial_policy') additions.push('remedial perbaikan nilai semester ketentuan aturan akademik');
  if (classification.domain.primary === 'institution_document' || classification.intent.primary === 'ask_document_definition') additions.push('FORM IKU PTS 2024 LLDIKTI formulir data indikator kinerja perguruan tinggi triwulan');
  if (classification.domain.primary === 'accreditation') additions.push('akreditasi sertifikat masa berlaku valid sampai program studi');
  if (classification.domain.primary === 'academic') additions.push('informasi akademik kalender akademik yudisium wisuda remedial SKS semester BAAK');
  if (classification.intent.primary === 'ask_international_program_sequence') additions.push('skema tahapan tahun perkuliahan Double Degree DNUI');
  if (classification.domain.primary === 'international_program') additions.push('Student Exchange pertukaran mahasiswa program internasional');
  if (classification.intent.primary === 'ask_organization_profile' || classification.intent.primary === 'ask_organization_vision_mission') additions.push('profil UKM Ormawa HIMAPRODI organisasi mahasiswa');
  if (classification.intent.primary === 'ask_facility_profile' || classification.intent.primary === 'ask_facility_vision_mission') additions.push('profil fasilitas Inkubator Bisnis INBIS unit kewirausahaan');
  if (classification.intent.primary === 'ask_registration_how' || classification.intent.primary === 'ask_registration_requirements') additions.push('pendaftaran syarat persyaratan dokumen PMB mahasiswa baru');
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
  const sourceEntities = resolveSourceDomainEntities(`${raw} ${normalizedQuery}`);
  const unsupportedProgramEntities = resolveUnsupportedProgramEntities(raw, programEntities);
  const entities = {
    programs: programEntities,
    campuses: [],
    facilities: sourceEntities.facilities,
    organizations: sourceEntities.organizations,
    people: [],
    documents: sourceEntities.documents,
    internationalPrograms: sourceEntities.internationalPrograms,
    unsupported: unsupportedProgramEntities,
    unknown: []
  };
  const classification = classifyIntentDomain(raw, normalizedQuery, entities, temporal);
  if (unsupportedProgramEntities[0]) {
    classification.constraints.unsupportedEntityCandidate = {
      type: unsupportedProgramEntities[0].type,
      canonical: unsupportedProgramEntities[0].canonical,
      surface: unsupportedProgramEntities[0].surface,
      role: unsupportedProgramEntities[0].role,
      source: unsupportedProgramEntities[0].source
    };
  }
  let requestedFields = extractRequestedFields(raw, normalizedQuery, classification);
  if (classification.intent && classification.intent.primary === 'ask_general' && classification.answerExpectation === 'topic_opening') {
    requestedFields = requestedFields.filter(field => field !== 'procedureSteps');
  }
  const understanding = {
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
    requestedFields,
    ambiguity: classification.ambiguity,
    routingQuery: buildRoutingQuery(normalizedQuery, entities, classification),
    confidence: Math.min(classification.intent.confidence, classification.domain.confidence)
  };
  understanding.contract = buildSemanticContract(understanding);
  return understanding;
}

module.exports = {
  PROGRAMS,
  ID_MONTH_NAMES,
  ID_MONTH_MAP,
  buildCanonicalQueryUnderstanding,
  buildTemporalUnderstanding,
  resolveProgramEntities,
  classifyIntentDomain,
  resolveSourceDomainEntities,
  detectFeeType,
  detectOrganizationCategory,
  detectCurriculumTopic,
  detectScholarshipRequestSubtype
};

















