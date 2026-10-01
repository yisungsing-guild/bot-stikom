const { normalizeUserQuery } = require('../utils/queryNormalizer');
const { buildSemanticContract } = require('./semanticContract');
const {
  matchCanonicalEntities,
  resolveCanonicalInterestProfiles,
  resolveUniqueCanonicalEntityByQualifiers
} = require('./canonicalEntityRegistry');
const {
  normalizeConversationState,
  isConversationStateFresh,
  filterCompatibleFields
} = require('./conversationStateEngine');
const { normalizeEntityFamily } = require('./semanticFrame');

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
    { key: 'arts', label: 'seni', re: /\b(?:seni|sni|musik|band|nyanyi|vokal|vocal|tari|menari|tabuh|teater|drama|akting|acting|paduan\s+suara|choir)\b/i },
    { key: 'nature', label: 'pecinta alam', re: /\b(?:alam|outdoor|gunung|petualangan|lingkungan|pecinta\s+alam|mapala)\b/i },
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
    { key: 'cloud_computing', label: 'cloud computing', re: /\b(?:cloud\s+computing|komputasi\s+awan|cloud)\b/i },
    { key: 'hardware', label: 'hardware/perangkat keras', re: /\b(?:hardware|perangkat\s+keras)\b/i },
    { key: 'software', label: 'software/perangkat lunak', re: /\b(?:software|perangkat\s+lunak)\b/i },
    { key: 'network', label: 'jaringan/network', re: /\b(?:jaringan|networking?)\b/i },
    { key: 'embedded_iot', label: 'embedded system / IoT', re: /\b(?:embedded(?:\s+system)?|iot|internet\s+of\s+things)\b/i },
    { key: 'seo', label: 'SEO / Search Engine Optimization', re: /\b(?:seo|search\s+engine\s+optim(?:ization|isation)|sem|search\s+engine\s+marketing)\b/i }
  ];
  return topics.find((item) => item.re.test(q)) || null;
}

function detectScholarshipRequestSubtype(raw) {
  const q = String(raw || '').toLowerCase();
  if (/\b(?:syarat(?:nya)?|persyaratan(?:nya)?|ketentuan(?:nya)?|kriteria(?:nya)?|dokumen|berkas|eligibility|eligible)\b/i.test(q)) return 'requirements';
  if (/\b(?:nominal(?:nya)?|berapa|besaran(?:nya)?|jumlah(?:nya)?)\b/i.test(q)) return 'amount';
  if (/\b(?:cara|prosedur|alur|mengajukan|mendaftar|daftarnya|pendaftarannya|registrasinya|mendapatkan)\b/i.test(q)
    || /\b(?:bagaimana|gimana)\b.*\b(?:daftar|registrasi|pendaftaran|ajukan|mengajukan|dapat(?:kan)?)\b/i.test(q)) return 'procedure';
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
  const boundary = new RegExp(`(^|[^a-z0-9])${escapeRegex(a)}(?:nya)?([^a-z0-9]|$)`, 'i');
  return boundary.test(text);
}

function hasExplicitProgramSemantics(text) {
  const s = String(text || '').toLowerCase();
  return /\b(?:program|program\s+studi|prodi|jurusan|progdi|bidang\s+studi|konsentrasi|peminatan|fakultas|kuliah|perkuliahan|mata\s+kuliah|matkul|kurikulum|belajar|dipelajari|pelajaran|lulusan|alumni|prospek|karier|karir|pekerjaan|profesi|job|biaya|dpp|spp|bayar|tarif|uang\s+gedung|sks|gelar|semester|s1|d3|sarjana|diploma|akreditasi)\b/i.test(s)
    || /\b(?:beda|bedanya|perbedaan|banding|bandingkan|versus|vs)\b/i.test(s);
}

function hasPriorProgramContext(priorState, canonicalName, code) {
  if (!priorState || typeof priorState !== 'object') return false;
  const unwrap = priorState.sessionState || priorState.conversationState || priorState.sessionData || priorState.data || priorState.session || priorState;
  const active = unwrap.activeEntity || (unwrap.conversationState && unwrap.conversationState.activeEntity) || null;
  const targetCanonical = String(canonicalName || '').toLowerCase().trim();
  const targetCode = String(code || '').toLowerCase().trim();
  if (active && active.canonical) {
    const activeCanonical = String(active.canonical).toLowerCase().trim();
    if (activeCanonical === targetCanonical || activeCanonical.includes(targetCanonical) || targetCanonical.includes(activeCanonical)) {
      return true;
    }
  }
  const lastProgram = unwrap.lastProgramHint || unwrap.lastEntity || unwrap.activeProgram || unwrap.program || (unwrap.conversationState && (unwrap.conversationState.lastEntity || unwrap.conversationState.activeProgram)) || null;
  if (lastProgram) {
    const lp = String(lastProgram).toLowerCase().trim();
    if (lp === targetCanonical || lp === targetCode) return true;
  }
  const priorDomain = unwrap.activeDomain || unwrap.domain || (unwrap.conversationState && unwrap.conversationState.activeDomain) || null;
  const priorEntityFam = active?.family || active?.type;
  if (priorEntityFam === 'program' && ['program', 'fee', 'career', 'program_curriculum', 'accreditation'].includes(priorDomain)) {
    return true;
  }
  return false;
}

function isPmbPriorContext(priorState) {
  if (!priorState || typeof priorState !== 'object') return false;
  const unwrap = priorState.sessionState || priorState.conversationState || priorState.priorSessionOrState || priorState.sessionData || priorState.data || priorState.session || priorState;
  const lastDomain = unwrap.lastDomain || unwrap.activeDomain || (unwrap.conversationState && (unwrap.conversationState.lastDomain || unwrap.conversationState.activeDomain));
  const lastEntity = unwrap.lastEntity || unwrap.activeEntity?.canonical || (unwrap.conversationState && (unwrap.conversationState.lastEntity || unwrap.conversationState.activeEntity?.canonical));
  return lastDomain === 'pmb' || String(lastEntity).toLowerCase() === 'pmb';
}

function resolveProgramEntities(rawText, options = {}) {
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
      if (matchedAlias.toLowerCase() === 'si' && program.canonical === 'Sistem Informasi') {
        const priorState = options.sessionState || options.conversationState || options.priorSessionOrState || options.sessionData || options.session || options;
        const isUppercase = /\bSI\b/.test(rawText);
        const hasSemantics = hasExplicitProgramSemantics(normalized);
        const hasPrior = hasPriorProgramContext(priorState, program.canonical, program.code);
        if (!isUppercase && !hasSemantics && !hasPrior) {
          continue;
        }
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
  const hasSpecificOtherDiscipline = /\b(?:magister|s\s*2|master)\s+(?:teknik\s+[a-z]+|(?!apa|yang|ini|itu|berapa|bagaimana|gimana|kapan|dimana|siapa|ada|adakah|apakah|materi|jadwal|biaya|kuliah|daftar|pendaftaran|kurikulum|syarat\b)[a-z]+(?:\s+[a-z]+)?)\b/i.test(normalized)
    && !/\b(?:sistem\s+informasi|si\b)/i.test(normalized);
  const isGenericS2CatalogueQuestion = (
    /\b(?:apa\s+saja|apa\s+aja|daftar|list|pilihan)\b/i.test(normalized)
    || /\b(?:program\s+studi|prodi|jurusan|program\s+magister|program\s+pascasarjana|program\s+s\s*2|prodi\s+s\s*2)\b[^?]*\b(?:apa|tersedia|ada)\b/i.test(normalized)
  ) && !/\b(?:sistem\s+informasi|si\b)/i.test(normalized);
  const hasExplicitSiInS2 = hasS2Level && (matches.some(entity => entity.canonical === 'Sistem Informasi') || /\b(?:sistem\s+informasi|si\b)/i.test(normalized));
  const hasProgramStudyContext = /\b(?:program|program\s+studi|prodi|jurusan|kuliah|perkuliahan|mata\s+kuliah|matkul|kurikulum|belajar|dipelajari|kelas|course|sks|gelar|masa\s+studi|semester|fokus\s+penelitian|riset)\b/i.test(normalized);
  if ((hasExplicitSiInS2 || (hasS2Level && hasProgramStudyContext && !isGenericS2CatalogueQuestion)) && !hasSpecificOtherDiscipline && !matches.some(entity => entity.canonical === 'S2 Sistem Informasi')) {
    matches.push({
      type: 'program',
      canonical: 'S2 Sistem Informasi',
      code: 'S2 SI',
      surface: 's2',
      confidence: hasExplicitSiInS2 ? 0.94 : 0.82,
      source: 'canonical-program-level-context'
    });
  }
  const seen = new Set();
  const effectiveMatches = (hasS2Level && matches.some(entity => entity.canonical === 'S2 Sistem Informasi'))
    ? matches.filter(entity => entity.canonical !== 'Sistem Informasi')
    : matches;
  return effectiveMatches.filter(entity => {
    if (seen.has(entity.canonical)) return false;
    seen.add(entity.canonical);
    return true;
  });
}

function resolveSourceDomainEntities(rawText) {
  const normalized = normalizeUserQuery(rawText || '').normalizedText || String(rawText || '').toLowerCase();
  const organizations = [];
  const facilities = [];
  const campuses = [];
  const documents = [];
  const internationalPrograms = [];
  const services = [];
  const scholarships = [];
  const admissionTracks = [];
  const participantScopes = [];
  const academicScopes = [];
  const interestProfiles = resolveCanonicalInterestProfiles(normalized).map(profile => ({
    canonical: profile.label,
    key: profile.key,
    label: profile.label,
    type: 'interest_profile',
    role: 'descriptive_interest',
    confidence: 0.9,
    matchedTerms: profile.matchedTerms,
    source: 'canonical-interest-registry'
  }));
  const addUnique = (list, entity) => {
    if (!entity || !entity.canonical) return;
    if (list.some(item => item.canonical === entity.canonical && item.type === entity.type)) return;
    list.push(entity);
  };

  for (const match of matchCanonicalEntities(normalized)) {
    const entity = {
      canonical: match.canonical,
      type: match.type,
      role: match.family,
      confidence: Math.max(0.88, Number(match.matchQuality || 0)),
      source: 'canonical-entity-registry',
      country: match.country || null,
      scope: match.scope || null
    };
    if (match.family === 'student_organization') addUnique(organizations, entity);
    else if (match.family === 'campus_facility') addUnique(facilities, entity);
    else if (match.family === 'campus_location') addUnique(campuses, entity);
    else if (match.family === 'international_program') addUnique(internationalPrograms, entity);
    else if (match.family === 'campus_service') addUnique(services, entity);
    else if (match.family === 'scholarship') addUnique(scholarships, entity);
    else if (match.family === 'admission_track') addUnique(admissionTracks, entity);
    else if (match.family === 'participant_scope') addUnique(participantScopes, entity);
    else if (match.family === 'academic_scope') addUnique(academicScopes, entity);
  }

  const countryQualifier = /\b(?:jepang|japan)\b/i.test(normalized) ? 'Japan'
    : (/\bmalaysia\b/i.test(normalized) ? 'Malaysia'
      : (/\b(?:china|tiongkok)\b/i.test(normalized) ? 'China' : null));
  const hasInternationalEntityContext = /\b(?:double\s*degree|dual\s*degree|gelar\s+ganda|program\s+ganda|magang|internship|program\s+internasional|kuliah\s+luar\s+negeri)\b/i.test(normalized);
  if (countryQualifier && hasInternationalEntityContext) {
    const qualified = resolveUniqueCanonicalEntityByQualifiers({ family: 'international_program', country: countryQualifier });
    if (qualified) addUnique(internationalPrograms, {
      canonical: qualified.canonical,
      type: qualified.type,
      role: qualified.family,
      confidence: 0.91,
      source: 'canonical-registry-unique-qualifier',
      country: qualified.country || null,
      scope: qualified.scope || null
    });
  }
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
    { re: /\b(?:ukm\s+)?pmk\b|\bpersekutuan\s+mahasiswa\s+kristen\b/i, canonical: 'UKM PMK', type: 'ukm', role: 'organization_profile' },
    { re: /\b(?:ukm\s+)?u2m\b/i, canonical: 'UKM U2M', type: 'ukm', role: 'organization_profile' },
    { re: /\b(?:ukm\s+)?paskamras\b/i, canonical: 'UKM Paskamras', type: 'ukm', role: 'organization_profile' },
    { re: /\b(?:ukm\s+)?basket\b/i, canonical: 'UKM Basket', type: 'ukm', role: 'organization_profile' },
    { re: /\b(?:ukm\s+)?futsal\b/i, canonical: 'UKM Futsal', type: 'ukm', role: 'organization_profile' },
    { re: /\b(?:ukm\s+)?musik\b/i, canonical: 'UKM Musik', type: 'ukm', role: 'organization_profile' },
    { re: /\b(?:ukm\s+multimedia|unit\s+kegiatan\s+mahasiswa\s+multimedia)\b/i, canonical: 'UKM Multimedia', type: 'ukm', role: 'organization_profile' },
    { re: /\b(?:ukm\s+tari(?:\s+pragina)?|tari\s+pragina|pragina)\b/i, canonical: 'UKM Tari PRAGINA', type: 'ukm', role: 'organization_profile' },
    { re: /\b(?:ukm\s+)?tabuh\b/i, canonical: 'UKM Tabuh Bramara Gita', type: 'ukm', role: 'organization_profile' },
    { re: /\b(?:ukm\s+)?rade\b/i, canonical: 'UKM RADE', type: 'ukm', role: 'organization_profile' },
    { re: /\b(?:ukm\s+)?teater\s+biner\b/i, canonical: 'UKM Teater Biner', type: 'ukm', role: 'organization_profile' },
    { re: /\b(?:bem(?:-pm)?|badan\s+eksekutif\s+mahasiswa)\b/i, canonical: 'BEM-PM ITB STIKOM Bali', type: 'organization', role: 'organization_profile' },
    { re: /\b(?:vos|voice\s+of\s+stikom)\b/i, canonical: 'Voice of STIKOM (VOS)', type: 'ukm', role: 'organization_profile' },
    { re: /\b(?:mapala\s+kompas|mapala)\b/i, canonical: 'Mapala Kompas', type: 'ukm', role: 'organization_profile' },
    { re: /\bathena(?:\s+esports?)?\b/i, canonical: 'Athena Esports', type: 'ukm', role: 'organization_profile' },
    { re: /\b(?:esports?|e-sports?)\b/i, canonical: 'Athena Esports', type: 'ukm', role: 'organization_profile' }
  ];
  if (!organizations.length) {
    for (const spec of orgSpecs) {
      if (spec.re.test(normalized)) addUnique(organizations, { ...spec, confidence: 0.9, source: 'canonical-source-entity' });
    }
  }

  const isGenericOpenWorldOrgName = (value) => {
    const candidate = String(value || '').trim().toLowerCase();
    if (!candidate) return true;
    if (/\b(?:tersebut|tadi|dimaksud|yang\s+tadi|itu|ini)\b/i.test(candidate)) return true;
    if (/^(?:kampus|stikom|itb|bali|ada|apa|saja|aja|di|itu|ini|yang|tersebut|tadi|buat|untuk|dan|atau|daftar|cara|bagaimana|gimana|berapa|brp|brapa|jumlah|total|totalnya|banyak|semua|seluruh)(?:\s|$)/i.test(candidate)) return true;
    if (/\b(?:ada|apa|saja|aja|kampus|stikom|itb|bali|berapa|brp|brapa|jumlah|total|totalnya|banyak|semua|seluruh|tersebut|tadi|seni|sni|musik|tari|tabuh|teater|olahraga|teknologi|kewirausahaan|wirausaha|kerohanian|rohani|minat|kategori|jenis|bidang|it\b|coding|pemrograman|komputer|sektor|divisi|alam|outdoor|pecinta\s+alam|gunung|petualangan|lingkungan|paduan\s+suara|choir|vokal|suara)\b/i.test(candidate)) return true;
    if (/\b(?:ga|gak|nggak|kah|ta|kan|ya|bukan)\b/i.test(candidate)) return true;
    return false;
  };
  // Open-world entity regex matching for generic UKMs/Himaprodi
  // Extend to 1-4 words (allows "UKM Teater Biner", "UKM Ghost", "HIMAPRODI Bisnis Digital", etc.)
  const genericUkmWithCategory = normalized.match(/\bukm\s+(?:olahraga|seni|musik|bela\s*diri|teknologi)\s+([a-z0-9][a-z0-9 _-]{0,35}?)(?=\s+(?:itu|ini|tersebut|tadi|apa|ada|kampus|stikom|itb|yang|di|di\s|bagaimana|gimana|ya|kak|min|admin|bisa|dong|nih|ga|gak|nggak|kah|ta|kan|fokus|kegiatan|profil|tujuan|visi|misi|organisasi|himpunan)|[?.!,]|$)/i);
  if (genericUkmWithCategory && !organizations.length) {
    const ukmName = genericUkmWithCategory[1].trim().replace(/\s+(?:ga|gak|nggak|kah|ya|dong|nih|tersebut|tadi)$/i, '').replace(/\s+/g, ' ');
    if (!isGenericOpenWorldOrgName(ukmName)) {
      addUnique(organizations, { canonical: `UKM ${ukmName.replace(/\b\w/g, c => c.toUpperCase())}`, type: 'ukm', role: 'organization_profile', confidence: 0.85, source: 'open-world-ukm' });
    }
  }
  const genericUkm = normalized.match(/\bukm\s+([a-z0-9][a-z0-9 _-]{0,35}?)(?=\s+(?:itu|ini|tersebut|tadi|apa|ada|kampus|stikom|itb|yang|di|di\s|bagaimana|gimana|ya|kak|min|admin|bisa|dong|nih|ga|gak|nggak|kah|ta|kan|fokus|kegiatan|profil|tujuan|visi|misi|organisasi|himpunan)|[?.!,]|$)/i);
  if (genericUkm && !organizations.length && !interestProfiles.length) {
    const ukmName = genericUkm[1].trim().replace(/\s+(?:ga|gak|nggak|kah|ya|dong|nih|tersebut|tadi)$/i, '').replace(/\s+/g, ' ');
    if (!isGenericOpenWorldOrgName(ukmName)) addUnique(organizations, { canonical: `UKM ${ukmName.replace(/\b\w/g, c => c.toUpperCase())}`, type: 'ukm', role: 'organization_profile', confidence: 0.85, source: 'open-world-ukm' });
  }
  const genericHima = normalized.match(/\bhimaprodi\s+([a-z0-9][a-z0-9 _-]{0,35}?)(?=\s+(?:itu|ini|tersebut|tadi|apa|yang|bagaimana|gimana|ya|kak|min)|[?.!,]|$)/i);
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
  if (/\b(?:perpustakaan(?:nya)?|library|ruang\s+baca|koleksi\s+(?:buku|perpustakaan)|buku\s+digital|jurnal(?:\s+internasional)?|ieee|acm|perpustakaan\s+digital|e-?book)\b/i.test(normalized)) {
    addUnique(facilities, { canonical: 'Perpustakaan', type: 'facility', role: 'campus_facility_profile', confidence: 0.92, source: 'canonical-source-entity' });
  }
  if (/\b(?:studio(?:\s+podcast)?|podcast|rekaman|ruang\s+multimedia|ruang\s+produksi\s+audio|audio\s+production|studio\s+rekaman)\b/i.test(normalized)) {
    addUnique(facilities, { canonical: 'Studio Podcast', type: 'facility', role: 'campus_facility_profile', confidence: 0.92, source: 'canonical-source-entity' });
  }
  if (/\b(?:coworking(?:\s+space)?|co-working(?:\s+space)?|ruang\s+kerja\s+bersama|ruang\s+kerja\s+kolaboratif|kolaboratif)\b/i.test(normalized)) {
    addUnique(facilities, { canonical: 'Coworking Space', type: 'facility', role: 'campus_facility_profile', confidence: 0.92, source: 'canonical-source-entity' });
  }
  if (/\b(?:lab(?:oratorium)?\s+komputer(?:nya)?|lab\s+praktikum|komputer\s+praktik|fasilitas\s+komputer)\b/i.test(normalized)) {
    addUnique(facilities, { canonical: 'Laboratorium Komputer', type: 'facility', role: 'campus_facility_profile', confidence: 0.92, source: 'canonical-source-entity' });
  }
  if (/\b(?:bus\s+kampus|shuttle(?:\s+bus)?|antar\s+jemput|transport(?:asi)?\s+antar\s+kampus|shuttle\s+antar\s+lokasi)\b/i.test(normalized)) {
    addUnique(facilities, { canonical: 'Transportasi Kampus', type: 'facility', role: 'campus_facility_profile', confidence: 0.92, source: 'canonical-source-entity' });
  }
  if (/\b(?:parkir(?:an)?|tempat\s+parkir|lahan\s+parkir|area\s+parkir)\b/i.test(normalized)) {
    addUnique(facilities, { canonical: 'Fasilitas Parkir', type: 'facility', role: 'campus_facility_profile', confidence: 0.92, source: 'canonical-source-entity' });
  }
  const STOPWORD_ENTITY_REGEX = /^(?:kampus|stikom|itb|bali|ada|apa|saja|aja|yang|di|ini|itu|dan|atau|\s)+$/i;
  const genericUnitMatch = normalized.match(/\b(?:direktorat|biro|lembaga|unit|pusat|bagian)\s+([a-z0-9][a-z0-9 _-]{1,50}?)(?=\s+(?:gratis|berbayar|untuk|mahasiswa|kampus|stikom|itb|di|ada|tersedia|bisa|ini|itu)|[?.!,]|$)/i);
  if (genericUnitMatch && !services.length) {
    const rawUnitName = genericUnitMatch[1].replace(/\b(?:apa\s+yang|apa\s+itu|itu\s+apa|apaan|apakah|apa|mana|bagaimana|gimana|berapa)\b.*$/i, '').trim().replace(/\s+/g, ' ');
    if (!STOPWORD_ENTITY_REGEX.test(rawUnitName)) {
      addUnique(services, { canonical: rawUnitName.replace(/\b\w/g, c => c.toUpperCase()), type: 'campus_unit', role: 'campus_unit_profile', confidence: 0.85, source: 'open-world-unit' });
    }
  }
  const genericService = normalized.match(/\b(?:jasa|layanan|fasilitas)\s+([a-z0-9][a-z0-9 _-]{1,35}?)(?=\s+(?:gratis|berbayar|untuk|mahasiswa|kampus|stikom|itb|di|ada|tersedia|bisa)|[?.!,]|$)/i);
  if (genericService && !facilities.length) {
    const sName = genericService[1].replace(/\b(?:apa\s+yang|apa\s+itu|itu\s+apa|apaan|apakah|apa|mana|bagaimana|gimana|berapa)\b.*$/i, '').trim().replace(/\s+/g, ' ');
    if (!STOPWORD_ENTITY_REGEX.test(sName)) {
      addUnique(facilities, { canonical: sName.replace(/\b\w/g, c => c.toUpperCase()), type: 'facility', role: 'campus_facility_profile', confidence: 0.85, source: 'open-world-facility' });
    }
  }
  if (/\b(?:renon|kampus\s+renon|denpasar|kampus\s+pusat|puputan)\b/i.test(normalized)) {
    addUnique(campuses, { canonical: 'Kampus Denpasar (Renon)', type: 'campus', role: 'campus_location', confidence: 0.92, source: 'canonical-source-entity' });
  }
  if (/\b(?:jimbaran|kampus\s+jimbaran)\b/i.test(normalized)) {
    addUnique(campuses, { canonical: 'Kampus Jimbaran', type: 'campus', role: 'campus_location', confidence: 0.92, source: 'canonical-source-entity' });
  }
  if (/\b(?:abiansemal|kampus\s+abiansemal)\b/i.test(normalized)) {
    addUnique(campuses, { canonical: 'Kampus Abiansemal', type: 'campus', role: 'campus_location', confidence: 0.92, source: 'canonical-source-entity' });
  }
  if (/\b(?:gccp|gcpp|gcp|global\s+cross\s+cultural|global\s+cultural\s+exchange)\b/i.test(normalized)) {
    addUnique(internationalPrograms, { canonical: 'GCCP', type: 'international_program', role: 'student_exchange_subprogram', confidence: 0.94, source: 'canonical-source-entity' });
  }
  if (/\b(?:bccp|bali\s+cross\s+cultur(?:e|al)(?:\s+program)?)\b/i.test(normalized)) {
    addUnique(internationalPrograms, { canonical: 'BCCP', type: 'international_program', role: 'student_exchange_subprogram', confidence: 0.94, source: 'canonical-source-entity' });
  }
  if (/\b(?:short\s*course|shortcourse|kursus\s+singkat)\b/i.test(normalized)) {
    addUnique(internationalPrograms, { canonical: 'short course', type: 'international_program', role: 'student_exchange_subprogram', confidence: 0.92, source: 'canonical-source-entity' });
  }
  if (/\b(?:student\s+exchange|pertukaran\s+mahasiswa)\b/i.test(normalized)
    || (/\bexchange\b/i.test(normalized) && /\b(?:mahasiswa|student|program|manfaat|benefit|syarat)\b/i.test(normalized))) {
    addUnique(internationalPrograms, { canonical: 'Student Exchange', type: 'international_program', role: 'student_exchange', confidence: 0.93, source: 'canonical-source-entity' });
  }
  const hasGenericPartnerRelation = (
    /\b(?:partner(?:nya)?|mitra(?:nya)?|kampus\s+partner(?:nya)?|partner\s+kampus(?:nya)?|universitas\s+(?:mitra|partner)|mitra\s+kampus(?:nya)?)\b/i.test(normalized)
    && /\b(?:siapa|apa|mana|yang\s+mana|dimana|di\s*mana|list|daftar|ada\s+apa|apa\s+saja)\b/i.test(normalized)
  ) || /\b(?:(?:bekerja\s*sama|kerja\s*sama|kerjasama)?\s*dengan\s+universitas\s+mana)\b/i.test(normalized);
  if (/\b(?:double\s*degree|dual\s*degree|program\s+ganda|gelar\s+ganda|dua\s+gelar)\b/i.test(normalized) || hasGenericPartnerRelation) {
    let partner = 'Double Degree';
    let programScope = /\b(?:nasional|national)\b/i.test(normalized) ? 'national'
      : (/\b(?:internasional|international|luar\s+negeri)\b/i.test(normalized) ? 'international' : null);
    let country = null;
    if (/\b(?:help|malaysia)\b/i.test(normalized)) partner = 'Double Degree HELP University';
    else if (/\b(?:dnui|dalian|china|cina|tiongkok)\b/i.test(normalized)) partner = 'Double Degree DNUI';
    else if (/\b(?:utb|bandung)\b/i.test(normalized)) partner = 'Dual Degree UTB';
    if (/help/i.test(partner)) { programScope = 'international'; country = 'Malaysia'; }
    if (/dnui/i.test(partner)) { programScope = 'international'; country = 'China'; }
    if (/utb/i.test(partner)) { programScope = 'national'; country = 'Indonesia'; }
    addUnique(internationalPrograms, { canonical: partner, type: 'international_program', role: 'double_degree', scope: programScope, country, confidence: 0.93, source: 'canonical-source-entity' });
  }
  if (!internationalPrograms.some((entity) => String(entity.role || '') === 'double_degree')) {
    if (/\b(?:dnui|dalian\s+neusoft|china|cina|tiongkok)\b/i.test(normalized)) {
      addUnique(internationalPrograms, { canonical: 'Double Degree DNUI', type: 'international_program', role: 'double_degree', scope: 'international', country: 'China', confidence: 0.91, source: 'canonical-source-entity' });
    }
    if (/\b(?:help\s+university|help\b.*malaysia|help|malaysia)\b/i.test(normalized)) {
      addUnique(internationalPrograms, { canonical: 'Double Degree HELP University', type: 'international_program', role: 'double_degree', scope: 'international', country: 'Malaysia', confidence: 0.91, source: 'canonical-source-entity' });
    }
    if (/\b(?:utb|universitas\s+teknologi\s+bandung|bandung)\b/i.test(normalized)) {
      addUnique(internationalPrograms, { canonical: 'Dual Degree UTB', type: 'international_program', role: 'double_degree', scope: 'national', country: 'Indonesia', confidence: 0.91, source: 'canonical-source-entity' });
    }
  }
  if (/\b(?:form\s+iku|iku\s+pts|indikator\s+kinerja)\b/i.test(normalized)) {
    addUnique(documents, { canonical: 'FORM IKU PTS 2024 LLDIKTI', type: 'academic_document', role: 'institution_performance_document', confidence: 0.9, source: 'canonical-source-entity' });
  }
  if (/\b(?:isian\s+website|didirikan|berdiri|sejarah|awalnya|awal(?:nya)?\s+stikom|yayasan)\b/i.test(normalized)
    && /\b(?:stikom|itb\s*stikom|kampus|institut)\b/i.test(normalized)
    && !organizations.length && !/\b(?:ukm|ormawa|hima(?:prodi)?)\b/i.test(normalized)) {
    addUnique(documents, { canonical: 'Sejarah ITB STIKOM Bali', type: 'institution', role: 'institution_history', confidence: 0.88, source: 'canonical-source-entity' });
  }

  const hasSpecificInternationalEntity = internationalPrograms.some(entity => String(entity.canonical || '') !== 'Double Degree');
  const resolvedInternationalPrograms = hasSpecificInternationalEntity
    ? internationalPrograms.filter(entity => String(entity.canonical || '') !== 'Double Degree')
    : internationalPrograms;
  return { organizations, facilities, campuses, documents, internationalPrograms: resolvedInternationalPrograms, services, scholarships, admissionTracks, participantScopes, academicScopes, interestProfiles };
}

function detectFeeType(q) {
  if (/\b(?:ukt|uang\s+kuliah|biaya\s+pendidikan|per\s+semester|semesteran)\b/i.test(q)) return 'ukt';
  if (/\b(?:dpp|dana\s+pendidikan\s+pokok)\b/i.test(q)) return 'dpp';
  if (/\b(?:biaya\s+awal|awal\s+masuk|uang\s+masuk|biaya\s+masuk)\b/i.test(q)) return 'initial_fee';
  const asksNonFeeQuantity = /\b(?:tanggal|tgl|jam|hari|bulan|tahun|lembar|halaman|berkas|dokumen|syarat|lama|tahap|kali|orang|skor|score|toefl|ielts|nilai|sks|semester)\b/i.test(q);
  if (/\b(?:biaya\s+pendaftaran|uang\s+pendaftaran|harga\s+pendaftaran|bayar\s+pendaftaran|biaya\s+daftar|daftar\s+berapa|(?:biaya|uang|harga)\s+formulir(?:nya)?)\b/i.test(q)
    || (!asksNonFeeQuantity && /\b(?:daftar(?:nya)?|pendaftaran(?:nya)?|registrasi(?:nya)?)\b/i.test(q) && /\b(?:berapa|brapa|brp|nominal|biaya|harga|bayar|uang|rp|rupiah)\b/i.test(q) && !/\bberapa\s+(?:lembar|halaman|berkas|dokumen|syarat|hari|lama|tahap|kali|orang|skor|score|toefl|ielts|nilai|sks|semester)\b/i.test(q))) return 'registration_fee';
  if (/\b(?:potongan(?:nya)?|diskon(?:nya)?|discount)\b/i.test(q) && !/\bbeasiswa(?:nya)?\b/i.test(q)) return 'discount';
  if (/\b(?:total|semua|keseluruhan)\b/i.test(q) && /\b(?:biaya|bayar|uang|harga)\b/i.test(q)) return 'total_estimate';
  if (/\b(?:cicil(?:an(?:nya)?)?|dicicil|di\s*cicil|nyicil|angsur(?:an(?:nya)?)?|diangsur|di\s*angsur|tahap\s+pembayaran|pembayaran\s+bertahap|bertahap)\b/i.test(q)) return 'installment';
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
  if (/^(?:jenjang\s+|tingkat\s+|program\s+)?(?:sarjana|diploma(?:\s*(?:3|tiga))?|magister|pascasarjana|master|strata(?:\s*(?:satu|dua|tiga))?)?\s*(?:s\s*[1-4]|d\s*[3-4])?(?:\s*(?:dan|atau|vs|versus|sama|dengan|\/|-)\s*(?:jenjang\s+|tingkat\s+|program\s+)?(?:sarjana|diploma(?:\s*(?:3|tiga))?|magister|pascasarjana|master|strata(?:\s*(?:satu|dua|tiga))?)?\s*(?:s\s*[1-4]|d\s*[3-4])?)*$/i.test(norm)) {
    return true;
  }
  if (/^(?:s\s*1|s\s*2|s\s*3|d\s*3|d\s*4|sarjana(?:\s*s\s*1)?|diploma(?:\s*d\s*3)?|magister(?:\s*s\s*2)?|pascasarjana)$/i.test(norm)) {
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
  if (/^(?:masih|sudah|sedang|akan|pernah|belum|setelah|sebelum|bisa|dapat|boleh|ganti|ubah|diubah|diganti|pilihan|awal|waktu|pertama|kali|didirikan|berdiri|saat|mana|yang|cocok|sebaiknya|rekomendasi|saran)\b/i.test(candidate)) return '';
  if (/\b(?:apa\s+saja|apa\s+aja|daftar|list|semua|pilihan|mana\s+yang|yang\s+mana|yang\s+cocok|mana\s+yang\s+cocok|sebaiknya|rekomendasi|saran)\b/i.test(candidate)) return '';
  if (/\b(?:apakah|harus|perlu|masuk|ambil|pilih|saya|aku|kita|kamu|anda|kira[\s-]*kira|dan\s+disana|disana|rekomendasi|cocok|sebaiknya)\b/i.test(candidate)) return '';
  if (isKnownNonProgramOntologyCandidate(candidate)) return '';
  return titleCaseCandidate(candidate);
}

function resolveUnsupportedProgramEntities(text, knownPrograms = []) {
  const source = String(text || '');
  const normalized = normalizeUserQuery(source).normalizedText || source.toLowerCase();
  if (/\b(?:surat\s+keputusan|menimbang\s+bahwa|mengingat\s+undang|memutuskan\s+pasal|lampiran\s+keputusan|\[sheet:|form\s+iku|q:\s*apa\s+itu|a:\s*program|profil\s+organisasi|nama\s+organisasi|nama\s+dokumen|kode\s+dokumen|dokumen\s+mentah|bocor\s+seperti\s+ini)\b/i.test(source)) return [];
  if (/\b(?:tertarik|minat|hobi|bakat|passion|rekomendasi|saran|pilih\s+mana|ambil\s+mana|masuk\s+(?:mana|kemana|ke\s+mana|prodi\s+apa)|cocok|sebaiknya)\b/i.test(normalized)) return [];
  if (/\b(?:himpunan\s+mahasiswa\s+prodi|himaprodi|hima\b|ukm\b|ormawa|organisasi\s+mahasiswa|unit\s+kegiatan\s+mahasiswa)\b/i.test(normalized)) return [];
  if (/\b(?:ksl|mcos|paskamras|pragina|mapala|vos|syntax|jcos|ksr|kmhd|athena|ghost|dos|tabuh|pmk|progress|u2m|rade)\b/i.test(normalized)) return [];
  if (/\b(?:dnui|dalian\s+neusoft|help\s+university|help\b.*malaysia|utb|universitas\s+teknologi\s+bandung)\b/i.test(normalized)) return [];
  if (/\b(?:double\s*degree|dual\s*degree|dd\b|gelar\s+ganda|dua\s+gelar|program\s+ganda|student\s+exchange|pertukaran\s+mahasiswa|gccp|bccp|credit\s+transfer|sit\s+in)\b/i.test(normalized)) return [];
  if (/\b(?:mahasiswa\s+asing|foreign\s+student|international\s+student|keimigrasian|imigrasi|izin\s+(?:belajar|tinggal)|visa|vitas|itas|kitas|sktt)\b/i.test(normalized)) return [];
  if (/\b(?:beasiswa|scholarship|kip|1k1s|skss)\b/i.test(normalized)) return [];
  if (/\b(?:inkubator(?:\s+bisnis)?|inbis|career\s*center|language\s+learning|llc|hi[\s-]?think|hithink|linkedin|linked\s*in)\b/i.test(normalized)) return [];
  if (/\bfakultas\s+(?:infokom|informatika(?:\s+(?:dan|&)\s+komputer)?|bisnis(?:\s+(?:dan|&)\s+vokasi)?|vokasi)\b/i.test(normalized)) return [];
  if (!/\b(?:jurusan|prodi|program\s+studi|program\b|kuliah\s+di|ambil\s+jurusan|pilih\s+jurusan|fakultas)\b/i.test(normalized)) return [];
  const supportedLabels = new Set((Array.isArray(knownPrograms) ? knownPrograms : []).map((program) => (normalizeUserQuery(program && program.canonical || '').normalizedText || String(program && program.canonical || '').toLowerCase()).trim()).filter(Boolean));
  if (supportedLabels.size > 0) return [];
  const patterns = [
    /\b(?:jurusan|prodi|program\s+studi|fakultas)\s+([a-z0-9\p{L}][a-z0-9\p{L}\s._-]{1,60}?)(?:\s+(?:di|ke|untuk|biaya(?:nya)?|harga(?:nya)?|bayar(?:nya)?|ukt|dpp|spp|uang(?:nya)?|pendaftaran(?:nya)?|daftar(?:nya)?|akreditasi(?:nya)?|profil(?:nya)?|profile|lama|studi|semester(?:an|nya)?|berapa|gimana|bagaimana|apa(?:an)?|itu|ya|kak|min|admin|ada|tersedia|buka|dibuka)\b|[?.!,]|$)/iu,
    /\bprogram\s+([a-z0-9\p{L}][a-z0-9\p{L}\s._-]{1,60}?)(?:\s+(?:di|ke|untuk|biaya(?:nya)?|harga(?:nya)?|bayar(?:nya)?|ukt|dpp|spp|uang(?:nya)?|pendaftaran(?:nya)?|daftar(?:nya)?|akreditasi(?:nya)?|profil(?:nya)?|profile|lama|studi|semester(?:an|nya)?|berapa|gimana|bagaimana|apa(?:an)?|itu|ya|kak|min|admin|ada|tersedia|buka|dibuka)\b|[?.!,]|$)/iu,
    /\b(?:kuliah\s+di|ambil\s+jurusan|pilih\s+jurusan)\s+([a-z0-9\p{L}][a-z0-9\p{L}\s._-]{1,60}?)(?:\s+(?:di|ke|untuk|biaya(?:nya)?|harga(?:nya)?|bayar(?:nya)?|ukt|dpp|spp|uang(?:nya)?|pendaftaran(?:nya)?|daftar(?:nya)?|akreditasi(?:nya)?|profil(?:nya)?|profile|lama|studi|semester(?:an|nya)?|berapa|gimana|bagaimana|apa(?:an)?|itu|ya|kak|min|admin|ada|tersedia|buka|dibuka)\b|[?.!,]|$)/iu
  ];
  const hasExplicitAcademicSignals = /\b(?:prodi|program\s+studi|jurusan|jenjang|s1|d3|s2|magister|diploma|sarjana|kuliah\s+di|ambil\s+jurusan|pilih\s+jurusan|fakultas)\b/i.test(normalized);
  for (let pIdx = 0; pIdx < patterns.length; pIdx++) {
    const pattern = patterns[pIdx];
    const match = normalized.match(pattern);
    const candidate = match && normalizeUnsupportedProgramCandidate(match[1]);
    if (!candidate) continue;
    const candidateKey = (normalizeUserQuery(candidate).normalizedText || String(candidate || '').toLowerCase()).trim();
    if (supportedLabels.has(candidateKey)) return [];
    const isAcademic = pIdx !== 1 || hasExplicitAcademicSignals;
    return [{
      canonical: candidate,
      surface: match[1],
      type: isAcademic ? 'program' : 'open_world_program',
      role: 'unsupported_entity_candidate',
      confidence: 0.78,
      source: isAcademic ? 'canonical-open-world-unsupported-program' : 'canonical-open-world-generic-program'
    }];
  }
  return [];
}

function resolveUnsupportedFacilityEntities(text, sourceEntities = {}, knownPrograms = []) {
  const source = String(text || '').trim();
  if (!source) return [];
  if ((sourceEntities.facilities && sourceEntities.facilities.length > 0)
    || (sourceEntities.programs && sourceEntities.programs.length > 0)
    || (knownPrograms && knownPrograms.length > 0)
    || (sourceEntities.organizations && sourceEntities.organizations.length > 0)
    || (sourceEntities.scholarships && sourceEntities.scholarships.length > 0)
    || (sourceEntities.admissionTracks && sourceEntities.admissionTracks.length > 0)
    || (sourceEntities.internationalPrograms && sourceEntities.internationalPrograms.length > 0)
    || (sourceEntities.documents && sourceEntities.documents.length > 0)) {
    return [];
  }
  if (/\b(?:biaya|harga|ukt|dpp|spp|uang|angsuran|cicilan|diskon|potongan|gelombang|pmb|pendaftaran|maba|camaba|jurnal|akreditasi|kurikulum|matakuliah|dosen|hima|himaprodi|ukm|ormawa|organisasi|komunitas)\b/i.test(source)) {
    return [];
  }
  const match = source.match(/^(?:(?:halo|hai|permisi|mau\s+tanya|min|kak)\s*[,.]?\s*)?(?:apakah\s+)?(?:di\s+kampus|kampus)\s+(?:ada|tersedia|punya)\s+([a-z0-9\p{L}\s._-]{2,50}?)\??$/iu);
  if (!match) return [];
  const candidate = match[1].trim().replace(/[?!.,]+$/g, '').trim();
  if (!candidate || candidate.length < 3) return [];
  if (/\b(?:akses|diskon|potongan|beasiswa|jurusan|prodi|berapa|apa|siapa|gimana|bagaimana|mana|kapan|kenapa|mengapa)\b/i.test(candidate)) return [];
  const canonical = candidate.replace(/(?:^|\s)\S/g, c => c.toUpperCase());
  return [{
    canonical,
    surface: candidate,
    type: 'facility',
    role: 'unsupported_facility_candidate',
    confidence: 0.8,
    source: 'canonical-open-world-unsupported-facility'
  }];
}

function extractNegativeSemantics(rawText) {
  const q = String(rawText || '').trim();
  const result = {
    negatedSpans: [],
    excludedDomains: [],
    excludedFields: [],
    excludedEntities: [],
    excludedRelations: [],
    isProtestOrCorrection: false
  };

  if (!q) return result;

  const positiveBoundary = '(?:,|;|\\b(?:saya\\s+(?:menanyakan|tanya|nanya|minta|cari|mau\\s+tanya|ingin\\s+tanya)|yang\\s+saya\\s+(?:tanyakan|tanya|maksud)|melainkan|tetapi|tapi|maksud\\s+saya|padahal)\\b|[?.!]|$)';
  const negationRegex = new RegExp(`\\b(?:bukan(?:nya)?|bukanlah|tidak\\s+(?:menanyakan(?:\\s+tentang)?|tanya(?:\\s+tentang)?|nanya(?:\\s+tentang)?|minta|cari|bahas)|jangan\\s+bahas|bukan\\s+soal|bukan\\s+tentang)\\s+(.+?)(?=\\s*${positiveBoundary})`, 'gi');
  const protestRegex = new RegExp(`\\bkok\\s+(?:malah\\s+|jadi\\s+)?(?:bahas\\s+|jawab\\s+|kasih\\s+|muncul\\s+)?(.+?)(?=\\s*${positiveBoundary})`, 'gi');

  const negationMatches = [
    ...q.matchAll(negationRegex),
    ...q.matchAll(protestRegex)
  ];

  const seenSpans = new Set();
  for (const m of negationMatches) {
    const span = String(m[1] || '').trim().replace(/[?,.;!]+$/g, '').trim();
    if (!span || span.length < 2 || seenSpans.has(span.toLowerCase())) continue;
    seenSpans.add(span.toLowerCase());
    result.negatedSpans.push(span);
    result.isProtestOrCorrection = true;

    const spanLower = span.toLowerCase();

    if (/\b(?:pmb|pendaftaran|gelombang|camaba|mahasiswa\s+baru)\b/i.test(spanLower)) {
      result.excludedDomains.push('pmb_schedule', 'registration');
    }
    if (/\b(?:biaya|harga|tarif|ukt|dpp|spp)\b/i.test(spanLower)) {
      result.excludedDomains.push('fee', 'tuition_fee');
    }
    if (/\bbeasiswa\b/i.test(spanLower)) {
      result.excludedDomains.push('scholarship');
    }
    if (/\b(?:akademik|krs|sidang|wisuda|yudisium)\b/i.test(spanLower)) {
      result.excludedDomains.push('academic_policy', 'academic_schedule');
    }

    if (/\b(?:jadwal|kapan|tanggal|tgl|periode)\b/i.test(spanLower)) {
      result.excludedFields.push('schedule', 'date', 'pmbSchedule');
    }
    if (/\b(?:biaya|nominal|harga)\b/i.test(spanLower)) {
      result.excludedFields.push('fee', 'cost');
    }
    if (/\b(?:syarat|persyaratan|dokumen|berkas)\b/i.test(spanLower)) {
      result.excludedFields.push('requirements');
    }
    if (/\b(?:nomor|kontak|telepon|telp|wa|whatsapp|hotline)\b/i.test(spanLower)) {
      result.excludedFields.push('contactNumber', 'phone', 'contact');
    }
  }

  result.excludedDomains = [...new Set(result.excludedDomains)];
  result.excludedFields = [...new Set(result.excludedFields)];
  result.hasNegation = result.negatedSpans.length > 0;
  result.hasProtestOrCorrection = Boolean(result.isProtestOrCorrection);
  result.strippedText = stripNegatedSpansFromQuery(q, result);
  return result;
}

function stripNegatedSpansFromQuery(queryText, negativeSemantics) {
  let out = String(queryText || '');
  if (!out || !negativeSemantics || !Array.isArray(negativeSemantics.negatedSpans) || !negativeSemantics.negatedSpans.length) {
    return out;
  }
  for (const span of negativeSemantics.negatedSpans) {
    const cleanSpan = String(span || '').trim();
    if (!cleanSpan) continue;
    const escaped = escapeRegex(cleanSpan);
    out = out.replace(new RegExp(`\\b(?:kok\\s+(?:malah\\s+|jadi\\s+)?(?:bahas\\s+|jawab\\s+|kasih\\s+)?|bukan(?:nya|lah)?\\s+(?:soal\\s+|tentang\\s+)?|tidak\\s+(?:menanyakan|tanya|nanya|minta|cari|bahas)(?:\\s+tentang)?\\s+)?${escaped}`, 'gi'), ' ');
  }
  const cleaned = out.replace(/^[,\s;:]+|[,\s;:]+$/g, '').replace(/\s{2,}/g, ' ').trim();
  return cleaned || out;
}

function detectRequestedSlot(rawQuery, normalizedQuery, negativeSemantics = null) {
  const base = String(normalizedQuery || rawQuery || '').toLowerCase();
  const q = stripNegatedSpansFromQuery(base, negativeSemantics);
  const asksTime = /\b(?:jam\s+berapa|pukul\s+berapa|jam(?:nya)?(?:\s+berapa)?|pukul(?:nya)?(?:\s+berapa)?|waktunya\s+jam\s+berapa)\b/i.test(q);
  const asksPlace = /\b(?:tempat(?:nya)?(?:\s+di\s*mana|\s+dimana)?|lokasi(?:nya)?(?:\s+di\s*mana|\s+dimana)?|di\s*mana|dimana|ruang(?:an)?\s+apa|gedung\s+apa)\b/i.test(q);
  const asksDate = /\b(?:tanggal\s+berapa|tgl\s+berapa|tanggal(?:nya)?|tgl(?:nya)?|hari\s+apa|kapan|sampai\s+kapan)\b/i.test(q);

  if (asksTime && !asksDate && !asksPlace) return 'time';
  if (asksPlace && !asksDate && !asksTime) return 'place';
  if (asksDate && !asksTime && !asksPlace) return 'date';
  if (asksDate && asksPlace && !asksTime && /\b(?:tanggal|tgl|kapan|sampai\s+kapan)\b/i.test(q)) return 'date';
  return null;
}

const BARE_SLOT_SURFACE_RE = /^(?:(?:kalau|kalo|untuk|terus|lalu|nah|jadi|berarti|itu)\s+)?(?:tanggal(?:\s+berapa|nya(?:\s+berapa|\s+kapan)?)?|tgl(?:\s+berapa|nya)?|hari\s+apa|jam(?:\s+berapa|nya(?:\s+berapa)?)?|pukul(?:\s+berapa|nya)?|waktunya(?:\s+kapan|\s+jam\s+berapa)?|kapan(?:\s+itu|\s+ya|\s+sih|\s+dilaksanakan|\s+diadakan)?|sampai\s+(?:tanggal\s+berapa|tgl\s+berapa|kapan)(?:\s+itu|\s+ya)?|batas(?:nya)?\s+kapan|terakhir\s+kapan|(?:tempat(?:nya)?|lokasi(?:nya)?|acara(?:nya)?|pelaksanaan(?:nya)?)\s+(?:di\s*mana|dimana|kapan|jam\s+berapa|tanggal\s+berapa)|di\s*mana(?:\s+itu|\s+ya|\s+tempatnya|\s+lokasinya)?|dimana(?:\s+itu|\s+ya|\s+tempatnya|\s+lokasinya)?)\s*[?.!]*$/i;

function isBareSlotFollowupQuery(rawQuery, normalizedQuery, entities, temporal) {
  const q = String(normalizedQuery || rawQuery || '').trim().toLowerCase();
  if (!q) return false;
  const words = q.replace(/[?.!,;:]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 5) return false;
  if (!BARE_SLOT_SURFACE_RE.test(q)) return false;
  if (temporal && (temporal.requestedWave || temporal.requestedMonth || temporal.explicitDate)) return false;
  if (/\b(?:pmb|pendaftaran|penerimaan|mahasiswa\s+baru|camaba|maba|gelombang|gbg|wisuda|yudisium|sidang|skripsi|tugas\s+akhir|tesis|krs|khs|remedial|remidi|uts|uas|kuliah|semester|akademik|kampus|stikom|itb|prodi|jurusan|beasiswa|biaya|ukt|dpp)\b/i.test(q)) {
    return false;
  }
  if (entities && (
    (Array.isArray(entities.programs) && entities.programs.length > 0)
    || (Array.isArray(entities.campuses) && entities.campuses.length > 0)
    || (Array.isArray(entities.facilities) && entities.facilities.length > 0)
    || (Array.isArray(entities.organizations) && entities.organizations.length > 0)
    || (Array.isArray(entities.internationalPrograms) && entities.internationalPrograms.length > 0)
    || (Array.isArray(entities.scholarships) && entities.scholarships.length > 0)
    || (Array.isArray(entities.academicScopes) && entities.academicScopes.length > 0)
  )) {
    return false;
  }
  return true;
}

function isMetaClosingOrAcknowledgementQuery(rawQuery, normalizedQuery) {
  const q = String(normalizedQuery || rawQuery || '').trim().toLowerCase();
  if (!q) return false;
  return /^(?:oke|ok|baik|siap|sip|oh|oalah|ya|yap|yoi|mantap|noted)?\s*(?:terima\s+kasih|makasih|makasi|thanks|thank\s+you|thx|matur\s+suksma)(?:\s+(?:banyak|ya|kak|min|admin|infonya|informasinya))*\s*[?.!]*$/i.test(q)
    || /^(?:oh\s+begitu(?:\s+ya)?|oalah\s+begitu(?:\s+ya)?|begitu\s+ya|oh\s+gitu(?:\s+ya)?|gitu\s+ya|oke\s+baik(?:\s+kak)?|siap\s+kak|baik\s+terima\s+kasih)\s*[?.!]*$/i.test(q)
    || /^(?:kok|kenapa)\s+(?:ga|gak|nggak|tidak|kurang)\s+(?:jelas|nyambung|sesuai|bener|benar)(?:\s+gitu|\s+ya|\s+sih|\s+kak|\s+min)?\s*[?.!]*$/i.test(q)
    || /^(?:oke|ok|baik|sip|oh|oalah|begitu|gitu|jika|kalau\s+begitu|berarti)?\s*(?:berarti\s+)?(?:jika\s+)?(?:data(?:nya)?|informasi(?:nya)?|jadwal(?:nya)?)\s+(?:memang\s+)?(?:belum|tidak|kurang|gak|nggak)\s+(?:lengkap|ada|tersedia)(?:\s+ya|\s+kak|\s+min)?\s*[?.!]*$/i.test(q)
    || /^jika\s+data\s+belum\s+lengkap(?:\s+ya)?\s*[?.!]*$/i.test(q);
}

function extractStructuredRelation(q, entities) {
  const allEntities = [
    ...(entities && Array.isArray(entities.internationalPrograms) ? entities.internationalPrograms : []),
    ...(entities && Array.isArray(entities.programs) ? entities.programs : []),
    ...(entities && Array.isArray(entities.organizations) ? entities.organizations : []),
    ...(entities && Array.isArray(entities.facilities) ? entities.facilities : [])
  ];

  if (allEntities.length >= 2) {
    const entA = allEntities[0].canonical || allEntities[0].name || allEntities[0];
    const entB = allEntities[1].canonical || allEntities[1].name || allEntities[1];

    if (/\b(?:itu|merupakan|adalah)\b.*?\b(?:bukan|bukanlah)\b/i.test(q) || /\b(?:apakah\s+(?:itu|adalah|merupakan))\b/i.test(q)) {
      return {
        subject: entA,
        relationType: 'is_a',
        object: entB
      };
    }
    if (/\b(?:sama(?:\s+dengan)?|setara(?:\s+dengan)?|apakah\s+sama|sama\s+aja|sama\s+saja)\b/i.test(q)) {
      return {
        subject: entA,
        relationType: 'equivalent_to',
        object: entB
      };
    }
    if (/\b(?:beda|perbedaan|berbeda|vs|versus)\b/i.test(q)) {
      return {
        subject: entA,
        relationType: 'different_from',
        object: entB
      };
    }
    if (/\b(?:bukan|atau)\b/i.test(q)) {
      return {
        subject: entA,
        relationType: 'comparison',
        object: entB
      };
    }
  }
  return null;
}

function classifyIntentDomain(rawQuery, normalizedQuery, entities, temporal, options = {}) {
  const qRaw = String(normalizedQuery || rawQuery || '').toLowerCase();
  const qFull = normalizeSlangTokens(qRaw);
  const negativeSemantics = extractNegativeSemantics(rawQuery || normalizedQuery);
  const q = stripNegatedSpansFromQuery(qFull, negativeSemantics);
  const isBareSlotFollowup = isBareSlotFollowupQuery(rawQuery, normalizedQuery, entities, temporal);
  const isMetaAcknowledgement = isMetaClosingOrAcknowledgementQuery(rawQuery, normalizedQuery);
  const requestedSlot = detectRequestedSlot(rawQuery, normalizedQuery, negativeSemantics);
  const structuredRelation = extractStructuredRelation(q, entities);
  const hasLocationIntent = !isBareSlotFollowup
    && (/\b(?:alamat|lokasi|dimana|di\s*mana|where|letak|maps?|google\s+maps|rute|arah|patokan|pin\s+lokasi|share\s*loc|shareloc|dekat\s+(?:dengan|sama)|sebelah)\b/i.test(q) || /\bkampus(?:nya)?\s+(?:yang\s+)?mana\b/i.test(q))
    && !/\b(?:alamat\s+(?:email|surel|web|website|url|link|portal|situs)|surel)\b/i.test(q);
  const hasPhysicalAttribute = /\b(?:tinggi|luas|jumlah\s+lantai|berapa\s+lantai|lantai\s+berapa|kapasitas|ukuran|warna(?:nya)?|panjang|lebar|besar(?:nya)?|daya\s+tampung)\b/i.test(q);
  const feeType = detectFeeType(q);
  const hasFee = !negativeSemantics.excludedDomains.includes('fee')
    && (Boolean(feeType) || /\b(?:biaya(?:nya)?|harga(?:nya)?|bayar(?:nya|an)?|pembayaran|uang|nominal|tarif|fee|cost|nyicil|cicil(?:an(?:nya)?)?|dicicil|di\s*cicil|angsur(?:an(?:nya)?)?|diangsur|di\s*angsur|potongan(?:nya)?|diskon(?:nya)?|tagihan(?:nya)?|denda(?:nya)?)\b/i.test(q));
  const hasScholarship = /\b(?:beasiswa(?:nya)?|kip|1k1s|skss|bantuan\s+biaya|jalur\s+prestasi)\b/i.test(q);
  const hasInternationalAdmin = /\b(?:mahasiswa\s+(?:asing|internasional|luar\s+negeri)|foreign\s+student|international\s+student|keimigrasian|imigrasi|izin\s+(?:belajar(?:nya)?|tinggal(?:nya)?)|perpanjang(?:an)?\s+izin|visa|vitas|itas|kitas|sktt)\b/i.test(q);
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
  const hasContactRequest = (/\b(?:kontak|hubungi|menghubungi|nomor|no\.?\s*(?:wa|telp|telepon)?|wa\b|whatsapp|telepon|telp|phone|cs|customer\s*service|helpdesk|email|surel|instagram|ig|medsos)\b/i.test(q)
    && /\b(?:kampus|stikom|itb|admin|pmb|kontak|nomor|telepon|telp|wa|whatsapp|hubungi|helpdesk|email|surel|instagram|ig|medsos)\b/i.test(q)
    && !hasRegistrationDataCorrection
    && !/\b(?:nomor\s+sk|no\.?\s*sk|sk\s+mendiknas|izin\s+operasional)\b/i.test(q))
    || /\b(?:alamat\s+email|email\s+resmi|akun\s+instagram|instagram\s+resmi)\b/i.test(q);
  const hasRegistrationTopicOpening = /\b(?:mau|ingin|pengen|pengin|boleh|izin|permisi|info(?:rmasi)?)\b/i.test(q)
    && /\b(?:tanya|bertanya|nanya|menanyakan|soal|tentang|mengenai|info(?:rmasi)?)\b/i.test(q)
    && /\b(?:pmb|penerimaan\s+mahasiswa\s+baru|pendaftaran\s+mahasiswa\s+baru|mahasiswa\s+baru|camaba|maba)\b/i.test(q)
    && !hasFee
    && !hasScholarship
    && !hasAvailabilityStatus;
  const hasPmbDefinition = /\b(?:apa\s+itu|apakah\s+itu|itu\s+apa|pengertian|definisi|maksud(?:nya)?|jelaskan)\b/i.test(q)
    && /\b(?:pmb|penerimaan\s+mahasiswa\s+baru)\b/i.test(q);
  const hasAcademicTaskOrLeave = /\b(?:tugas(?:\s+akhir)?|skripsi|tesis|\bta\b|cuti(?:\s+kuliah)?|organisasi|ormawa|ukm)\b/i.test(q);
  const asksRegistrationHow = (
    (/\b(?:cara|gimana|bagaimana|alur|prosedur|langkah|lewat|online|how|where|apply|application|admission)\b/i.test(q)
      && /\b(?:daftar(?:nya)?|mendaftar|pendaftaran(?:nya)?|registrasi(?:nya)?|kuliah|pmb|mahasiswa\s+baru|camaba|maba|study|studying|student|international\s+student)\b/i.test(q))
    || /\b(?:formulir\s+online|konfirmasi\s+formulir|konfirmasi(?:nya)?\s+kemana|setelah\s+isi\s+formulir)\b/i.test(q)
    || (/\b(?:beli|membeli|ambil|mengambil|dapatkan|mendapatkan)\b/i.test(q)
      && /\bformulir(?:\s+pendaftaran)?\b/i.test(q)
      && /\b(?:langsung|kampus|offline|loket|pmb)\b/i.test(q))
  )
    && !hasFee
    && !hasScholarship
    && !hasAvailabilityStatus
    && !hasRegistrationDataCorrection
    && !hasAcademicTaskOrLeave;
  const asksRegistrationChannel = /\b(?:link|tautan|url|website|situs|channel|kanal|kontak|nomor|whatsapp|wa|lewat\s+mana|dimana|di\s+mana)\b/i.test(q)
    && /\b(?:daftar(?:nya)?|pendaftaran|pendaftarannya|registrasi|pmb|mahasiswa\s+baru|camaba|maba)\b/i.test(q)
    && !hasFee
    && !hasScholarship
    && !hasAcademicTaskOrLeave;
  const hasExplicitUploadSignal = /\b(?:upload|diupload|unggah|diunggah)\b/i.test(q);
  const hasOnlineSubmission = hasExplicitUploadSignal && /\b(?:online|web|portal|link|siap|sistem)\b/i.test(q);
  const hasRegistrationContext = /\b(?:daftar(?:nya)?|mendaftar|pendaftaran(?:nya)?|registrasi(?:nya)?|pmb|mahasiswa\s+baru|camaba|maba)\b/i.test(q);
  const asksRegistrationRequirements = (
    (/\b(?:syarat(?:nya)?|persyaratan(?:nya)?|dokumen(?:nya)?|berkas(?:nya)?|ketentuan(?:nya)?|perlu\s+apa|butuh\s+apa|(?:apa\s+yang\s+)?(?:diperlukan|dibutuhkan)|required|requirements?|documents?)\b/i.test(q)
      && (
        /\b(?:daftar(?:nya)?|mendaftar|pendaftaran(?:nya)?|registrasi(?:nya)?|pmb|mahasiswa\s+baru|camaba|maba|kuliah|program|prodi|program\s+studi|jurusan|sarjana|diploma|s\s*[1-4]|d\s*[3-4]|pascasarjana|pasca\s+sarjana|magister|master|apply|application|admission|study|studying|student|international\s+student)\b/i.test(q)
        || (!hasAcademicTaskOrLeave && hasRegistrationContext && hasExplicitUploadSignal)
        || (!hasAcademicTaskOrLeave && hasExplicitUploadSignal)
      ))
    || (!hasAcademicTaskOrLeave && hasRegistrationContext && hasOnlineSubmission)
    || /\b(?:ijazah\s+legalisir|legalisir\s+ijazah|pas\s+foto|akta\s+kelahiran|kartu\s+keluarga)\b/i.test(q)
    || (/\b(?:ijazah|rapor|raport|transkrip(?:\s+nilai)?)\b/i.test(q) && /\b(?:legalisir|lembar|fotocopy|foto\s*copy|salinan|kampus\s+asal|sekolah\s+asal)\b/i.test(q))
    || /\b(?:tes\s+masuk(?:nya)?|ujian\s+masuk(?:nya)?|seleksi\s+masuk(?:nya)?|seleksi\s+penerimaan|diuji\s+apa|materi\s+(?:ujian|tes)|tes\s+admission|admission\s+test|tes\s+pmb|ujian\s+pmb|ada\s+tes(?:\s+masuk)?|ada\s+ujian(?:\s+masuk)?)\b/i.test(q)
  )
    && !hasFee
    && !hasScholarship
    && !hasAcademicTaskOrLeave;
  const hasSchedule = (/\b(?:jadwal|gelombang|gbg|bulan\s+depan|bulan\s+ini|bulan\s+lalu|deadline|tanggal|tgl|kapan|ditutup|tutup|buka|dibuka|mulai|dimulai|aktif)\b/i.test(q)
    || Boolean(temporal.explicitDate || temporal.requestedMonth || temporal.requestedWave))
    && !/\b(?:berlaku|masa\s+berlaku|valid(?:itas)?|kedaluwarsa|expired)\b/i.test(q);
  const hasFacility = (entities.facilities.length > 0)
    || /\b(?:fasilitas|fasilias|fasiltas|layanan|sarana|prasarana|laboratorium|lab|perpustakaan|library|ruang|kantin|parkir|wifi|inkubator|inbis|language\s+learning|llc|hi\s*think|hithink|studio|podcast|coworking|co-working|antar\s+jemput|bus\s+kampus|shuttle|jurnal(?:\s+internasional)?|ieee|acm|kantor\s+urusan\s+internasional|kui|international\s+office)\b/i.test(q);
  const hasCareerOutcome = !/\b(?:magang|internship)\b/i.test(q) && /\b(?:prospek\s*(?:kerja|karier|karir)?|peluang\s+kerja|pekerjaan\s+setelah\s+(?:lulus|tamat)|kerja\s+(?:apa|sebagai|jadi|menjadi|ngapain)|bekerja\s+(?:sebagai|jadi|menjadi|apa)|bisa\s+(?:kerja|bekerja)(?:\s+(?:sebagai|jadi|menjadi|apa))?|profesi\s*(?:lulusan)?|lulusan\s+(?:bisa\s+)?(?:kerja|bekerja|jadi|menjadi)|tamat(?:nya)?\s+(?:bisa\s+)?(?:kerja|bekerja|jadi|menjadi|sebagai|apa)|setelah\s+(?:tamat|lulus)\s+(?:bisa\s+)?(?:kerja|bekerja|jadi|menjadi|sebagai|apa)|dunia\s+kerja\s+lulusan|pekerjaan\s+(?:apa|lulusan)|pekerjaan\s+menjadi\s+apa)\b/i.test(q);
  const hasCareerServiceExplicit = /\b(?:career\s*center|pusat\s+karier|pusat\s+karir|cdc|job\s*fair|campus\s*hiring|tracer\s*study|bursa\s+kerja)\b/i.test(q);
  const hasWorkWhileStudying = /\b(?:kuliah\s+sambil\s+(?:bekerja|kerja)|(?:bekerja|kerja)\s+sambil\s+kuliah)\b/i.test(q)
    && !/\bluar\s+negeri\b/i.test(q)
    && !hasScholarship
    && !hasFee;
  const asksContactPersonOrPic = /\b(?:contact\s*person|narahubung|pic\b|penanggung\s*jawab|kontak(?:nya)?|nomor\s*(?:telepon|telp|wa|whatsapp|hp|kontak)?|no\.?\s*(?:telp|telepon|wa|hp)|telepon|telp|whatsapp|wa\b|hubungi|email|surel)\b/i.test(q);
  const hasCareer = (hasCareerOutcome || hasCareerServiceExplicit || hasWorkWhileStudying || /\b(?:career\s*center|pusat\s+karier|pusat\s+karir|cdc|karier|karir|prospek(?:nya)?|prospek\s+kerja|peluang\s+kerja|lowongan|magang|job\s*fair|campus\s*hiring|tracer\s*study|persiapan\s+kerja|siap\s+kerja|dunia\s+kerja|pembekalan|melamar\s+pekerjaan|mendapat(?:kan)?\s+pekerjaan|dapat\s+kerja|mencari\s+kerja|mencari\s+pekerjaan|bantuan\s+(?:persiapan|kerja|pekerjaan|karier|karir)|lulusan.*(?:pekerjaan|kerja|karier|karir)|alumni.*(?:pekerjaan|kerja|karier|karir)|sertifikasi|pelatihan|kerja(?:nya)?\s+ngapain|kerjanya\b|kerja\s+jadi|bekerja\s+sebagai|bekerja\s+jadi|bekerja\s+menjadi|bisa\s+(?:kerja|bekerja)|network\s+engineer|iot\s+engineer|software\s+engineer|data\s+scientist|web\s+developer)\b/i.test(q))
    && !((entities.internationalPrograms.length > 0 || /\b(?:double\s*degree|dual\s*degree|ke\s+jepang|program\s+internasional)\b/i.test(q)) && /\b(?:atau|vs|bukan|beda)\b/i.test(q));
  const careerTopic = !hasCareer ? null
    : hasWorkWhileStudying ? 'work_while_studying'
    : asksContactPersonOrPic ? 'contact'
    : hasCareerOutcome && !hasCareerServiceExplicit ? 'outcome'
    : /\b(?:apa\s+itu|itu\s+apa|pengertian|definisi|maksud(?:nya)?|jelaskan|tentang)\b/i.test(q)
      && /\b(?:career\s*center|karier\s*center|karir\s*center|pusat\s+karier|pusat\s+karir|cdc)\b/i.test(q) ? 'definition'
      : /\b(?:keuntungan|manfaat|benefit|nilai\s+tambah|sisi\s+karier)\b/i.test(q) ? 'benefit'
        : /\b(?:membantu.*(?:pekerjaan|kerja)|mendapat(?:kan)?\s+(?:pekerjaan|kerja)|dapat\s+kerja|mencari\s+(?:pekerjaan|kerja)|bantuan\s+(?:mencari|mendapat|persiapan|kerja|pekerjaan)|lulusan.*(?:kerja|pekerjaan)|alumni.*(?:kerja|pekerjaan))\b/i.test(q) ? 'employment_support'
          : /\b(?:lowongan|loker|magang|job\s*fair|campus\s*hiring|rekrutmen|tracer\s*study)\b/i.test(q) ? 'opportunity'
            : /\b(?:layanan|fungsi|tugas|ngapain|untuk\s+apa|apa\s+saja|apa\s+aja|memberikan|bantu|membantu|kerja(?:nya)?)\b/i.test(q) ? 'service'
              : 'service';
  const externalRelation = extractExternalRelationConstraint(rawQuery || normalizedQuery);
  const asksLearning = /\b(?:belajar|di\s*pelajari(?:n)?|mempelajari|pelajaran(?:nya)?|perkuliahan|kuliah(?:nya)?(?:\s+(?:apa|apa\s+saja|apa\s+aja|yang\s+ada|membahas))?|mata\s+kuliah(?:nya)?|matkul|materi|course|kelas|kurikulum(?:nya)?|skill|kompetensi|coding|ngoding|ai|artificial\s+intelligence|kecerdasan\s+buatan|seo|search\s+engine\s+optim(?:ization|isation)|sem|search\s+engine\s+marketing)\b/i.test(q)
    && !/\b(?:izin\s+belajar|study\s+permit)\b/i.test(q);
  const asksAdvice = /\b(?:kurang|tidak|ga|gak|nggak|belum)\s+(?:cakap|jago|mahir|bisa|paham)|\b(?:apa\s+yang\s+harus|harus\s+bagaimana|saran|cocok|minat)\b/i.test(q);
  const asksList = /\b(?:apa\s+saja|apa\s+aja|daftar|list|pilihan|macam|sebutkan)\b/i.test(q);
  const asksCount = /\b(?:berapa\s+(?:banyak|jumlah(?:nya)?|total(?:nya)?|ada|kampus|lokasi|cabang)|ada\s+berapa|jumlah(?:nya)?|total(?:nya)?|berapa\s+unit|berapa\s+organisasi|berapa\s+kampus|berapa\s+lokasi|berapa\s+cabang)\b/i.test(q);
  const organizationCategory = detectOrganizationCategory(String(rawQuery || '') + ' ' + qRaw + ' ' + q);
  const curriculumTopic = detectCurriculumTopic(String(rawQuery || '') + ' ' + qRaw + ' ' + q);
  const scholarshipRequestSubtype = detectScholarshipRequestSubtype(q);
  const interestProfiles = typeof resolveCanonicalInterestProfiles === 'function' ? resolveCanonicalInterestProfiles(q) : [];
  const hasCampusCount = asksCount && /\b(?:kampus(?:nya)?|lokasi(?:nya)?|cabang)\b/i.test(q) && !hasPhysicalAttribute && !/\b(?:ukm|ormawa|organisasi|unit\s+kegiatan\s+mahasiswa|kegiatan\s+mahasiswa|himaprodi|hima|himpunan\s+mahasiswa|biaya|ukt|dpp|sks|semester|beasiswa|prodi|program\s+studi|jurusan)\b/i.test(q);
  const hasOnlineLearningPlatformTerm = /\b(?:online|daring|jarak\s+jauh|e-?learning)\b/i.test(q)
    && /\b(?:aplikasi|platform|media|pakai\s+apa|menggunakan\s+apa|lewat\s+apa|via\s+apa|tools?|software)\b/i.test(q);
  const hasStudyModalityTerm = /\b(?:online|offline|hybrid|daring|luring|tatap\s+muka)\b/i.test(q)
    && (
      /\b(?:kuliah|perkuliahan|kelas|pembelajaran|sistem\s+kuliah|metode\s+kuliah|opsi\s+kuliah|sistem|metode|opsi)\b/i.test(q)
      || /\b(?:kalau|jika|bagaimana|gimana|apakah|bisa|ada|nggak|bisa\s+nggak)\b/i.test(q)
      || Boolean(options && (options.sessionState || options.conversationState || options.priorSessionOrState))
    )
    && !hasOnlineLearningPlatformTerm
    && !hasFee;
  const hasExplicitOrgToken = /\b(?:ormawa|ukm|unit\s+kegiatan|organisasi\s+mahasiswa|organisasi\s+kampus|kegiatan\s+mahasiswa|himaprodi|hima|himpunan\s+mahasiswa|kelompok\s+mahasiswa|komunitas\s+mahasiswa|ekskul|klub)\b/i.test(q);
  const isProgramCurriculumQuery = (entities.programs.length > 0 || /\b(?:prodi|jurusan|program\s+studi)\b/i.test(q))
    && (asksLearning || curriculumTopic)
    && !hasFee
    && !hasStudyModalityTerm;
  const hasOrganization = (!isProgramCurriculumQuery || hasExplicitOrgToken) && (
    hasExplicitOrgToken
    || (/\borganisasi(?:nya)?\b/i.test(q) && /\b(?:ikut|ikutan|mengikuti|gabung|bergabung|join|masuk|daftar|mendaftar|tersedia|ada\s+apa|ada\s+ngga(?:k)?|ada\s+tidak|ada|apa\s+saja|apa\s+aja)\b/i.test(q))
    || (organizationCategory && /\b(?:organisasi(?:nya)?|komunitas|unit\s+kegiatan|kegiatan|kelompok|ekskul|klub|wadah|tempat|sarana)\b/i.test(q) && /\b(?:minat|suka|hobi|hobby|tertarik|ikut|mengikuti|buat|untuk|ada|tersedia|latihan)\b/i.test(q))
    || (interestProfiles.length > 0 && /\b(?:ikut|ikutan|mengikuti|gabung|bergabung|daftar|mendaftar|klub|ekskul|komunitas|organisasi(?:nya)?|ukm(?:nya)?|wadah)\b/i.test(q))
    || (/\b(?:unit|siapa)\s+(?:apa\s+)?(?:yang\s+)?(?:bertugas|menangani|mengurus|menjaga|bertanggung\s*jawab)\b/i.test(q) && !/\b(?:baak|biro|rektorat|pmb)\b/i.test(q))
  );
  const hasStudentSupport = !/\bbeasiswa\b/i.test(q)
    && /\b(?:lomba|kompetisi|prestasi|kegiatan\s+mahasiswa|organisasi\s+mahasiswa|kemahasiswaan|minat\s+dan\s+bakat|minat|ormawa|ukm)\b/i.test(q)
    && /\b(?:dukung|mendukung|dukungan|bantu|membantu|fasilitasi|fasilitas|ikut|mengikuti|ada|tersedia|program)\b/i.test(q);
  const OPERATIONAL_ACADEMIC_POLICY_OBJECT = /\b(?:cuti(?:\s+(?:akademik|kuliah|semester))?|berhenti\s+sementara|istirahat\s+kuliah|aktif\s+kembali|nonaktif|mengundurkan\s+diri|undur\s+diri|pindah\s+(?:program|prodi|jurusan|kampus)|krs|khs|nilai|koreksi\s+nilai|remedial|remidi|ujian(?:\s+(?:ulang|susulan|perbaikan))?|semester\s+pendek|\bsp\b|paket\s+sks|sks\s+paket|jumlah\s+kredit(?:nya)?|konversi\s+sks|sks\s+(?:yang\s+)?(?:dapat\s+|bisa\s+)?dikonversi|transfer\s+sks|skripsi|tugas\s+akhir|yudisium|wisuda|status\s+akademik|registrasi\s+ulang\s+akademik|batas\s+(?:masa\s+)?studi|dispensasi\s+akademik)\b/i;
  const OPERATIONAL_ACADEMIC_POLICY_RELATION = /\b(?:kebijakan|aturan|ketentuan|cara|bagaimana|gimana|alur|prosedur|syarat|persyaratan|dokumen|berkas|mengajukan|ajukan|pengajuan|mengurus|urus|proses|boleh|dapat|bisa|seperti\s+apa|apakah|sistem|mekanisme|ketentuan|berapa|maksimal|minimal|lama|ditentukan|ditetapkan|paket|tersedia|ada)\b/i;
  const hasOperationalAcademicPolicyObject = OPERATIONAL_ACADEMIC_POLICY_OBJECT.test(q)
    || (/\b(?:sks|kredit)\b/i.test(q) && /\b(?:paket|ditentukan|ditetapkan|konversi|kebijakan|aturan|semester\s+awal)\b/i.test(q));
  const hasOperationalAcademicPolicy = hasOperationalAcademicPolicyObject
    && OPERATIONAL_ACADEMIC_POLICY_RELATION.test(q)
    && !/\b(?:halaman|lembar|jumlah\s+halaman|kata|karakter|huruf|abstrak|daftar\s+pustaka|referensi|sitasi|format\s+penulisan|gaya\s+penulisan)\b/i.test(q)
    && !hasFee
    && !/\b(?:pmb|penerimaan\s+mahasiswa\s+baru|mahasiswa\s+baru|camaba|gelombang|beasiswa|ukm|ormawa|organisasi\s+mahasiswa|double\s*degree|dual\s*degree|student\s+exchange|hi[-\s]?think|hithink|kampus\s+asal|sekolah\s+asal|pindahan|transfer\s+mahasiswa|tes\s+masuk(?:nya)?|ujian\s+masuk(?:nya)?|seleksi\s+masuk(?:nya)?|seleksi\s+penerimaan|admission)\b/i.test(q);
  const hasAcademicAdvisingTerm = /\b(?:perwalian|dosen\s+wali|wali\s+akademik|pembimbing\s+akademik)\b/i.test(q);
  const hasAcademic = /\b(?:sks|skripsi|tugas\s+akhir|tesis|\bta\b|krs|wisuda|yudisium|kalender\s+akademik|baak|remedial|remidi|fokus\s+penelitian|riset|nilai|transkrip|perwalian|dosen\s+wali|wali\s+akademik|pembimbing\s+akademik)\b/i.test(q)
    || hasOperationalAcademicPolicyObject
    || hasOnlineLearningPlatformTerm;
  const hasAcademicEventEntity = /\b(?:wisuda|yudisium)\b/i.test(q)
    || (entities && Array.isArray(entities.academicScopes) && entities.academicScopes.some(e => /^(?:wisuda|yudisium)$/i.test(String(e && e.canonical || ''))));
  const hasAcademicScheduleCue = /\b(?:kapan|jadwal|tanggal|tgl|deadline|terakhir|batas(?:\s+akhir|\s+waktu|nya)?|paling\s+lambat|sampai\s+kapan|periode|waktu|jam|pukul|hari|tempat(?:nya)?|lokasi(?:nya)?|di\s*mana|dimana|yang\s+akan\s+datang|mendatang|berikutnya|terdekat)\b/i.test(q);
  const hasExplicitProcedureQuestion = /\b(?:cara|bagaimana|gimana|alur|prosedur|syarat|persyaratan|dokumen|berkas|mengurus|urus|lapor|minta)\b/i.test(q);
  const hasOnlineLectureSchedule = /\b(?:kuliah|perkuliahan)\s+(?:online|daring)\b/i.test(q) && hasAcademicScheduleCue && !hasFee && !hasOnlineLearningPlatformTerm;
  const hasThesisGuidelineTerm = /\b(?:pedoman|panduan|buku\s+(?:pedoman|panduan))\b/i.test(q) && /\b(?:skripsi|tugas\s+akhir|tesis|\bta\b)\b/i.test(q);
  const hasAcademicSchedule = !hasThesisGuidelineTerm && ((((hasAcademic || /\bakademik\b/i.test(q)) && !hasOnlineLearningPlatformTerm)
    && (
      /\b(?:jadwal|kalender|kapan|tanggal|tgl|periode|pendaftaran|pelaksanaan|semester|ganjil|genap|deadline|terakhir|batas(?:\s+akhir|\s+waktu|nya)?|paling\s+lambat|sampai\s+kapan|waktu|jam|pukul|hari|tempat(?:nya)?|lokasi(?:nya)?|di\s*mana|dimana|yang\s+akan\s+datang|mendatang)\b/i.test(q)
      || hasAcademicScheduleCue
    ))
    || hasOnlineLectureSchedule
    || (hasAcademicEventEntity && !hasExplicitProcedureQuestion && !hasOperationalAcademicPolicy && !hasFee));
  const hasAcademicRegistrationSignal = /\b(?:pendaftaran|daftar|registrasi|deadline|terakhir|batas(?:\s+akhir|\s+waktu|nya)?|paling\s+lambat|sampai\s+kapan|ditutup|tutup)\b/i.test(q);
  const hasAcademicExecutionSignal = /\b(?:pelaksanaan|dilaksanakan|berlangsung|acara|diadakan)\b/i.test(q);
  const isExecutionOfRegistration = /\bpelaksanaan\s+(?:pendaftaran|registrasi|daftar)\b/i.test(q);
  const hasExplicitDeadlineCue = /\b(?:deadline|terakhir|batas(?:\s+akhir|\s+waktu|nya)?|paling\s+lambat|sampai\s+kapan|ditutup|tutup)\b/i.test(q);
  const negatedRegistration = Boolean(negativeSemantics && negativeSemantics.isProtestOrCorrection && /\b(?:pendaftaran|daftar|registrasi)\b/i.test((negativeSemantics.negatedSpans || []).join(' ')));
  const academicScheduleType = (hasAcademicRegistrationSignal && (!hasAcademicExecutionSignal || isExecutionOfRegistration || hasExplicitDeadlineCue))
    ? 'registration_deadline'
    : ((hasAcademicExecutionSignal || negatedRegistration || (hasAcademicEventEntity && !hasAcademicRegistrationSignal && !/\bjadwal\b/i.test(q)) || (/\b(?:kapan|jam|pukul|waktu|hari|tanggal|tgl|dimana|di\s*mana|lokasi|tempat|yang\s+akan\s+datang|mendatang)\b/i.test(q) && !hasAcademicRegistrationSignal)) ? 'event_execution' : 'general_schedule');
  const hasExplicitUnknownProgramScheduleOwner = hasSchedule
    && !hasFee
    && /\bprogram\s+(?!studi\b|pmb\b|pendaftaran\b|penerimaan\b|beasiswa\b|bantuan\b|rpl\b|double\b|dual\b|ganda\b|internasional\b|international\b|student\b|exchange\b)([a-z0-9\p{L}][a-z0-9\p{L}\s._-]{1,40}?)(?:\s+(?:kapan|dibuka|buka|mulai|dimulai|jadwal|periode|pendaftaran|deadline|tanggal|tgl)\b|[?.!,]|$)/iu.test(q)
    && !entities.programs.length
    && !entities.internationalPrograms.length;
  const hasExplicitInternationalScheduleOwner = hasSchedule
    && !hasFee
    && (entities.internationalPrograms.length > 0 || /\b(?:double\s*degree|dual\s*degree|program\s+ganda|kuliah\s+ganda|student\s*exchange|pertukaran\s+mahasiswa|hi[-\s]?think|hithink|program\s+internasional)\b/i.test(q));
  const hasPmbSchedule = hasSchedule
    && !isBareSlotFollowup
    && !hasFee
    && !hasAcademicSchedule
    && !hasInternationalAdmin
    && !hasExplicitUnknownProgramScheduleOwner
    && !hasExplicitInternationalScheduleOwner
    && (
      Boolean(temporal.requestedWave || temporal.requestedMonth)
      || /\b(?:pmb|pendaftaran|penerimaan\s+mahasiswa\s+baru|mahasiswa\s+baru|camaba|maba|gelombang|gbg)\b/i.test(q)
    );
  const hasAcademicProcedure = (
    hasExplicitProcedureQuestion
    || (/\b(?:daftar|pendaftaran|registrasi)\b/i.test(q) && !hasAcademicScheduleCue)
  )
    && /\b(?:yudisium|wisuda|remedial|remidi|sidang|tugas\s+akhir|skripsi|tesis|krs|baak|akademik|nilai|transkrip)\b/i.test(q)
    && !/\b(?:kampus\s+asal|sekolah\s+asal|pindahan|transfer\s+mahasiswa)\b/i.test(q)
    && (!hasAcademicScheduleCue || hasExplicitProcedureQuestion);
  // Academic numeric: any quantitative question about an academic object (SKS, semester, year/duration, word count, page limit, etc.)
  const hasBareSksNumeric = /\b(?:berapa|jumlah|batas|limit|maksimal|minimal|minimum|total)\b/i.test(q)
    && /\b(?:sks|satuan\s+kredit\s+semester)\b/i.test(q)
    && !hasFee;
  const hasAcademicNumericGeneral = (/\b(?:berapa|jumlah|batas|limit|maksimal|minimal|minimum|total)\b/i.test(q)
    && /\b(?:sks|semester|tahun|masa\s+studi|durasi|kata|halaman|lembar|kredit|abstrak|bab|paragraf|huruf|spasi|karakter)\b/i.test(q)
    && (/\b(?:skripsi|tugas\s+akhir|tesis|\bta\b|laporan|proposal|karya\s+ilmiah|abstrak|akademik|lulus|kelulusan|wisuda|konversi|transfer|kuliah|studi)\b/i.test(q)
      || /\b(?:s\s*1|sarjana|d\s*3|diploma|s\s*2|magister)\b/i.test(q)))
    || hasBareSksNumeric;
  const hasAcademicNumeric = (
    /\b(?:sks|semester|masa\s+studi|berapa\s+sks|berapa\s+semester|berapa\s+tahun|durasi\s+studi|lama\s+studi|lama\s+kuliah)\b/i.test(q)
    && (/\b(?:s2|s\s*2|pascasarjana|pasca\s*sarjana|magister|master|s1|s\s*1|sarjana|d3|d\s*3|diploma|lulus|kelulusan)\b/i.test(q)
      || entities.programs.some((program) => /\b(?:S2|Magister|Pascasarjana|S1|Sarjana|D3|Diploma)\b/i.test(String(program.canonical || ''))))
  ) || hasAcademicNumericGeneral;
  const hasPostgraduateLearning = asksLearning
    && !hasFee
    && (
      /\b(?:s2|s\s*2|pascasarjana|pasca\s*sarjana|magister|master)\b/i.test(q)
      || entities.programs.some((program) => /\b(?:S2|Magister|Pascasarjana)\b/i.test(String(program.canonical || '')))
    );
  const hasAccreditation = /\b(?:akreditasi|akrediasi|ban\s*-?pt|lam\s*infokom|peringkat\s+akreditasi|sertifikat\s+akreditasi)\b/i.test(q);
  const hasDoubleDegreeSequence = (
    /\b(?:dnui|dalian\s+neusoft|double\s*degree|dual\s*degree)\b/i.test(q)
    || (/\b(?:malaysia|china|dalian|bandung)\b/i.test(q) && /\b(?:bali|stikom|skema|tahun)\b/i.test(q))
    || (entities.internationalPrograms.length > 0 && /\b(?:skema|tahapan|tahun)\b/i.test(q))
  ) && /\b(?:skema|tahapan|tahun\s+(?:ke-?\s*)?(?:1|2|3|4|pertama|kedua|ketiga|keempat|3|4)|berapa\s+tahun|bertahap|harus\s+ke|wajib\s+ke|pergi\s+ke|kuliah\s+di|onsite|online|offline)\b/i.test(q);
  // Institution-history semantic class — requires institution entity context before resolving subtype
  const hasInstitutionEntity = /\b(?:stikom|itb\s*stikom|kampus\s+(?:ini|stikom|itb)|institut\s+teknologi|itb)\b/i.test(q)
    || (entities.programs.length === 0 && entities.organizations.length === 0 && /\b(?:kampus|universitas|perguruan\s+tinggi|institusi|lembaga\s+pendidikan)\b/i.test(q));
  // Non-institution entity scope: any reference to sub-unit, org, or named non-institution entity
  const hasNonInstitutionEntityScope = entities.organizations.length > 0
    || /\b(?:ukm|ormawa|himaprodi|hima|bem|dpm|student\s+exchange|pertukaran\s+mahasiswa|double\s*degree|dual\s*degree|inbis|career\s+center|organisasi\s+mahasiswa|unit\s+kegiatan)\b/i.test(q);
  // Named non-institution entity: UKM/ORMAWA/org/program/facility WITHOUT institution institution anchor
  // This covers 'pendiri UKM Tari', 'penggagas Student Exchange', etc.
  const hasNonInstitutionNamedEntity = entities.organizations.length > 0
    || /\b(?:ukm|ormawa|hima(?:prodi)?|student\s+exchange|pertukaran\s+mahasiswa|inbis|inkubator\s+bisnis|career\s+center|pusat\s+karier|double\s*degree|dual\s*degree|program\s+internasional)\b/i.test(q);
  const hasGenuineHistorySemantics = /\b(?:didirikan|berdiri(?:nya)?|sejarah|awalnya|awal\s+mula|awal\s+berdiri|sejarah\s+awal|asal\s+mula|pendiri|tokoh\s+pendiri|siapa\s+yang\s+mendirikan|didirikan\s+oleh|penggagas|perintis|menginisiasi\s+berdirinya|inisiasi\s+berdirinya|tanggal\s+resmi\s+berdiri(?:nya)?|pendirian|izin\s+operasional|sk\s+mendiknas|surat\s+keputusan\s+mendiknas)\b/i.test(q);
  const hasInstitutionHistorySignal = hasGenuineHistorySemantics
    || (/\byayasan\b/i.test(q) && /\b(?:didirikan|berdiri|sejarah|pendiri|tokoh|sk|izin)\b/i.test(q));
  const hasScholarshipContext = hasScholarship || (Array.isArray(entities.scholarships) && entities.scholarships.length > 0);
  const hasInstitutionHistory = hasInstitutionHistorySignal
    && !hasAcademic
    && !hasScholarshipContext
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
      : (/\b(?:sk\s+mendiknas|surat\s+keputusan|izin\s+operasional|nomor\s+sk|no\.?\s*sk)\b/i.test(q) && /\b(?:kapan|tanggal|berapa|tahun|hari)\b/i.test(q)) ? 'LEGAL_DECREE_DATE'
        : /\b(?:sk\s+mendiknas|surat\s+keputusan|izin\s+operasional|nomor\s+sk|no\.?\s*sk)\b/i.test(q) ? 'LEGAL_ESTABLISHMENT_DOCUMENT'
          : /\b(?:kapan|tanggal|berapa|tahun|hari|tanggal\s+berapa|tanggal\s+resmi)\b/i.test(q) ? 'FOUNDING_DATE'
            : /\b(?:sejarah\s+awal|asal\s+mula|awal\s+mula|awal\s+berdiri|awalnya)\b/i.test(q) ? 'ORIGIN_HISTORY'
              : /\b(?:sejarah)\b/i.test(q) ? 'HISTORICAL_MILESTONE'
                : 'FOUNDING_EVENT';
  const hasIkuDocument = /\b(?:form\s+iku|iku\s+pts|indikator\s+kinerja|lldikti)\b/i.test(q);
  const hasStudentExchangeTopic = /\b(?:student\s+exchange|pertukaran\s+mahasiswa)\b/i.test(q);
  const hasOrganizationProfile = (entities.organizations.length > 0
    || /\b(?:ukm|ormawa|himaprodi|hima|himpunan|bem|dpm|pragina|tari|athena|vos|mapala|esports?|teater)\b/i.test(q))
    && /\b(?:profil|profile|organisasi\s+apa|apa\s+itu|itu\s+apa|visi|misi|tentang|seperti\s+apa|program\s+kerja|proker|peran|fungsi|tujuan|kegiatan(?:nya)?|singkatan(?:nya)?|kepanjangan(?:nya)?|akronim(?:nya)?|artinya|apa\s+namanya|nama\b.*?\bapa|ada\s+gak|tersedia|apakah\s+ada)\b/i.test(q);
  const hasFacilityProfile = (entities.facilities.length > 0
    || (Array.isArray(entities.services) && entities.services.length > 0)
    || /\b(?:inbis|inkubator\s+bisnis|language\s+learning|llc|hi\s*think|perpustakaan|library|studio|podcast|coworking|co-working|antar\s+jemput|bus\s+kampus|shuttle|kantor\s+urusan\s+internasional|kui|international\s+office|parkir)\b/i.test(q)
    || /\b(?:bebas\s+pake|bebas\s+pakai|harus\s+izin|izin\s+dulu|cara\s+pinjam|peminjaman)\b/i.test(q))
    && !/\b(?:kurikulum(?:nya)?|mata\s+kuliah(?:nya)?|matkul(?:nya)?|silabus(?:nya)?|sks)\b/i.test(q)
    && /\b(?:unit\s+apa|apa\s+itu|itu\s+apa|profil|profile|visi|misi|tahapan|tahap|program|tentang|peran|fungsi|bantu|membantu|dukungan|layanan|business\s+matching|networking|jejaring|level\s+bahasa|bahasa\s+jepang|buku(?:\s+digital)?|jurnal|ieee|acm|lengkap|akses|pinjam|peminjaman|izin|aturan|bebas|ngerjain|tugas|antar\s+jemput|rute|jadwal|fasilitas|pake|pakai|lantai|lantai\s+berapa|di\s+mana|dimana|lokasi|luas|kapasitas(?:nya)?|daya\s+tampung|info|informasi|detail)\b/i.test(q);
  const hasThesisTerm = /\b(?:skripsi|tugas\s+akhir|tesis|ta)\b/i.test(q);
  const hasThesisPrerequisite = hasThesisTerm
    && /\b(?:sks|ipk|gpa|nilai|kredit|prasyarat|syarat(?:nya)?|persyaratan(?:nya)?|ketentuan(?:nya)?|syarat\s+(?:ambil|mengambil)|kelompok|tanggung\s*jawab)\b/i.test(q);
  const hasThesisPageTerm = hasThesisTerm
    && /\b(?:halaman|lembar|panjang\s+naskah|tebal)\b/i.test(q)
    && !hasThesisPrerequisite;
  const hasThesisAbstractTerm = /\b(?:abstrak|abstract)\b/i.test(q) && /\b(?:berapa|jumlah|batas|maksimal|minimal|kata|karakter|huruf)\b/i.test(q);
  const hasThesisAdvisorChange = /\b(?:ganti|pergantian|ubah|perubahan)\b/i.test(q) && /\b(?:dosen\s+pembimbing|pembimbing\s+skripsi|supervisor|pembimbing\s+tesis|dosen\s+pendamping)\b/i.test(q);
  const hasThesisCertificateEquivalency = /\b(?:konversi|pengganti|tukar|menggantikan|mengganti|sebagai\s+pengganti|setara)\b/i.test(q) && /\b(?:sertifikat|certificate|ijazah\s+kursus|piagam)\b/i.test(q) && hasThesisTerm;
  const hasThesisSubmissionProcedure = hasThesisTerm
    && !hasThesisPrerequisite
    && /\b(?:ajukan|mengajukan|pengajuan|daftar|mendaftar|cara|caranya|alur|prosedur|langkah)\b/i.test(q);
  // Additional academic subtopics: bibliography standard, intro page limit, remedial policy
  const hasThesisBibliographyStandard = hasThesisTerm
    && /\b(?:daftar\s+pustaka|referensi|bibliography|sitasi|sumber|format\s+penulisan)\b/i.test(q)
    && /\b(?:IEEE|APA|Harvard|gaya\s+penulisan|standar|format|aturan)\b/i.test(q);
  const hasThesisIntroPageLimit = hasThesisTerm
    && /\b(?:kata\s+pengantar|pengantar|prakata)\b/i.test(q)
    && /\b(?:halaman|lembar|berapa|batas|maksimal|minimal)\b/i.test(q);
  const hasThesisRemedialPolicy = /\b(?:remedial|perbaikan\s+nilai|nilai\s+remedial|ulang\s+nilai|pengulangan\s+mata\s+kuliah)\b/i.test(q)
    && /\b(?:syarat|ketentuan|aturan|semester|berlaku|batas|maksimal|minimum|dapat|boleh|apakah\s+bisa)\b/i.test(q);
  const hasAcademicAdvising = hasAcademicAdvisingTerm && !hasAcademicScheduleCue && !hasFee;
  const hasOnlineLearningPlatform = hasOnlineLearningPlatformTerm && !hasAcademicScheduleCue && !hasFee;
  const hasFacultyProgramListRequest = /\bfakultas\s+(?:infokom|informatika(?:\s+dan\s+komputer)?|bisnis(?:\s+dan\s+vokasi)?|vokasi)\b/i.test(q)
    && /\b(?:prodi(?:nya)?|program\s+studi|jurusan(?:nya)?)\b/i.test(q)
    && (asksList || /\b(?:yang\s+ada|di\s+bawah|apa\s+saja|apa\s+aja|daftar|list|apa\b)\b/i.test(q))
    && !hasFee;
  const academicTopic = hasFacultyProgramListRequest ? 'faculty_program_mapping'
    : (hasAcademicAdvising ? 'academic_advising'
      : (hasOnlineLearningPlatform ? 'online_learning_platform'
        : (hasThesisAbstractTerm ? 'thesis_abstract_limit'
          : (hasThesisAdvisorChange ? 'thesis_advisor_change'
            : (hasThesisCertificateEquivalency ? 'thesis_certificate_equivalency'
              : (hasThesisSubmissionProcedure ? 'thesis_submission_procedure'
                : (hasThesisBibliographyStandard ? 'thesis_bibliography_standard'
                  : (hasThesisIntroPageLimit ? 'thesis_intro_page_limit'
                    : (hasThesisRemedialPolicy ? 'thesis_remedial_policy'
                      : (hasThesisTerm && hasThesisPageTerm ? 'thesis_page_count'
                        : (hasThesisPrerequisite ? 'thesis_prerequisite'
                          : (hasThesisTerm && !hasAcademicScheduleCue ? 'thesis_general' : null))))))))))));
  const hasAllProgramsScope = /\b(?:semua|seluruh|masing\s*-?\s*masing|setiap|tiap|antar)\s+(?:prodi|program\s+studi|jurusan)\b/i.test(q)
    || /\b(?:prodi|program\s+studi|jurusan)\s+(?:yang\s+ada(?:\s+di\s+(?:itb\s+)?stikom(?:\s+bali)?)?|di\s+(?:itb\s+)?stikom(?:\s+bali)?)\b/i.test(q);
  const hasFeeComparisonSignal = /\b(?:banding(?:kan)?|perbandingan|dibanding(?:kan)?|komparasi|beda(?:nya)?|perbedaan(?:nya)?|vs|versus|antara|paling\s+murah|termurah|paling\s+mahal|termahal|lebih\s+murah|lebih\s+mahal)\b/i.test(q);
  const hasFeeComparison = hasFee && !hasScholarship && !hasInternationalAdmin && (
    (hasAllProgramsScope && (hasFeeComparisonSignal || /\b(?:daftar|list|rincian|berapa(?:\s+saja|\s+aja)?)\b/i.test(q)))
    || (entities.programs.length >= 2 && (hasFeeComparisonSignal || /\b(?:dan|sama|atau)\b/i.test(q)))
    || /\b(?:paling\s+murah|termurah|paling\s+mahal|termahal)\b/i.test(q)
  );
  const strongProgramComparisonContext = /\b(?:beda|bedanya|bedain|perbedaan|banding|bandingkan|dibanding(?:kan)?|perbandingan|vs|versus|milih(?:\s+antara)?|pilih(?:\s+antara)?|antara\b[^?]{1,50}\batau|bagusan\s+mana|lebih\s+bagus(?:\s+mana)?|sama\s+.*\b(?:ti|sk|si|bd|mi)\b|\b(?:ti|sk|si|bd|mi)\b\s+sama\s+\b(?:ti|sk|si|bd|mi)\b)\b/i.test(q);
  if (strongProgramComparisonContext && /\bsk\b/i.test(q) && !entities.programs.some((entity) => entity.canonical === 'Sistem Komputer') && !/\b(?:surat\s+keputusan|nomor\s+sk|no\.?\s*sk|sk\s+mendiknas|izin\s+operasional|legal|dokumen)\b/i.test(q)) {
    entities.programs.push({ type: 'program', canonical: 'Sistem Komputer', code: 'SK', surface: 'sk', confidence: 0.84, source: 'canonical-program-alias-comparison-context' });
  }
  const isComparativeFollowupEllipsis = /\b(?:beda(?:nya)?|perbedaan(?:nya)?|banding(?:kan)?|dibanding(?:kan)?|perbandingan)\s+(?:dengan|sama)\b/i.test(q)
    || /^\s*(?:kalau|kalo|lalu|terus|nah|jadi)?\s*(?:apa\s+)?(?:beda(?:nya)?|perbedaan(?:nya)?|banding(?:kan)?)\s+(?:dengan|sama)\b/i.test(q);
  const hasProgramComparison = strongProgramComparisonContext && (entities.programs.length >= 2 || (isComparativeFollowupEllipsis && entities.programs.length >= 1)) && !hasFee;
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
  const hasProgramFitReasoning = (entities.programs.length > 0 || (Array.isArray(academicLevels) && academicLevels.length > 0))
    && /\b(?:kenapa|mengapa|alasan|kenapa\s+jadi|mengapa\s+jadi|kenapa\s+bisa)\b/i.test(q)
    && /\b(?:alternatif|pilihan|rekomendasi|cocok|dipilih|diambil|keunggulan|unggul)\b/i.test(q)
    && !hasFee;
  const hasSchoolOriginBackground = /\b(?:berasal\s+dari|lulusan|dari|asal(?:\s+sekolah)?|anak|jurusan\s+sekolah)\s+(?:smk|sma|ma|stm|paket\s*c)\b/i.test(q)
    || /\b(?:smk|sma|ma)\s+(?:bidang|jurusan)?\s*(?:komputer|tkj|rpl|rekayasa\s+perangkat\s+lunak|multimedia|dkv|ipa|ips|bahasa|akuntansi|perkantoran|bisnis|teknik|informatika|jaringan)\b/i.test(q);
  const hasSpecificInterestPreference = /\b(?:suka|minat|hobi|hobby|tertarik|fokus|ingin\s+(?:jadi|menjadi|bekerja|kerja|belajar|fokus|mendalami)|mau\s+(?:jadi|menjadi|bekerja|kerja|belajar|fokus|mendalami)|pengen\s+(?:jadi|menjadi|bekerja|kerja|belajar|fokus)|cita\s*-?\s*cita|target\s+kerja|arah\s+karier|arah\s+karir)\b/i.test(q)
    || (!hasSchoolOriginBackground && /\b(?:ai\b|artificial\s+intelligence|kecerdasan\s+buatan|pemasaran|marketing|digital\s+marketing|bisnis|jualan|usaha|data|analis|analyst|programmer|developer|software|coding|ngoding|desain|multimedia|jaringan|network|cyber|keamanan|hardware|iot|robotik|akuntansi)\b/i.test(q));
  const hasCareerGoalTopic = /\b(?:bekerja|kerja|karier|karir|bidang|minat|ai\b|artificial\s+intelligence|kecerdasan\s+buatan|pemasaran|marketing|digital\s+marketing|bisnis|jualan|usaha|data|analis|analyst|programmer|developer|software|coding|desain|multimedia|jaringan|network|cyber|keamanan|akuntansi|manajemen)\b/i.test(q)
    || hasSchoolOriginBackground;
  const hasCareerGoalAspiration = /\b(?:mau|ingin|pengen|pengin)\s+(?:jadi|menjadi|bekerja|kerja|masuk|ambil)\s+\w+/i.test(q);
  const hasCareerGoalExpression = hasCareerGoalTopic || hasCareerGoalAspiration;
  const asksProgramSuitabilityOrGuidance = /\b(?:prodi|program\s+studi|jurusan)\s+(?:apa\s+)?(?:yang\s+)?(?:paling\s+)?(?:cocok|sesuai|tepat|rekomendasi|disarankan|bagus)\b/i.test(q)
    || /\b(?:cocok(?:nya)?|sesuai|tepat|rekomendasi|saran|bingung\s+(?:pilih|milih)|pilih|ambil)\s+(?:prodi|program\s+studi|jurusan)\b/i.test(q)
    || /\b(?:di\s+)?(?:prodi|program\s+studi|jurusan)\s+(?:apakah\s+)?(?:saya\s+)?(?:harus|perlu|sebaiknya|bisa)\s+(?:masuk|daftar|kuliah|pilih|ambil)\b/i.test(q);
  const hasRecommendationSignal = /\b(?:cocok|cocoknya|rekomendasi|saran|pilih|ambil|yang\s+mana|mana\s+yang)\b/i.test(q)
    || (/\b(?:jurusan\s+apa|prodi\s+apa|program\s+apa)\b/i.test(q) && hasCareerGoalExpression)
    || asksProgramSuitabilityOrGuidance;
  const hasExplicitCatalogueListRequest = asksList
    && !/\b(?:jurusan|prodi|program)\s+(?:apa|yang\s+mana|mana\s+yang)\b/i.test(q)
    && !/\b(?:cocok|rekomendasi|saran|sebaiknya|pilih|ambil|ingin\s+(?:jadi|bekerja|kerja)|mau\s+(?:jadi|bekerja|kerja)|target\s+kerja|minat|suka)\b/i.test(q);
  const hasCareerGoalRecommendation = hasRecommendationSignal
    && (hasCareerGoalExpression || asksProgramSuitabilityOrGuidance)
    && !hasExplicitCatalogueListRequest
    && !hasFee;
  const isProfileInsufficientForRecommendation = Boolean(
    hasCareerGoalRecommendation
    && !hasSpecificInterestPreference
    && entities.programs.length === 0
  );
  const hasFeeComponentComparison = /\bdpp\b/i.test(q) && /\bukt\b/i.test(q)
    && (COMPARISON_SIGNAL.test(q) || /\b(?:beda|bedanya|berbeda|bukan|sama|perbedaan|komponen)\b/i.test(q));
  const hasAcademicCreditComparison = /\b(?:s1|sarjana)\b/i.test(q)
    && /\b(?:s2|s\s*2|pascasarjana|pasca\s+sarjana|magister|master)\b/i.test(q)
    && /\b(?:sks|beban\s+studi|jumlah\s+sks|kredit|semester)\b/i.test(q)
    && /\b(?:sama|beda|berbeda|lebih|kurang|sedikit|perbandingan|bandingkan|dibanding)\b/i.test(q);
  const COMPARISON_SEMANTICS_SIGNAL = /\b(?:beda|bedanya|perbedaan|banding|bandingkan|dibanding(?:kan)?|versus|vs|mana\s+yang|apakah\s+sama|sama\s+dengan)\b/i;
  const hasExplicitEntityTypeComparisonSignal = COMPARISON_SEMANTICS_SIGNAL.test(q)
    && !/\b(?:fungsi|peran|tujuan|profil|profile|kegiatan|program\s+kerja|proker|visi|misi)\b/i.test(q);
  const hasEntityTypeComparison = entities.organizations.length > 0
    && entities.programs.length > 0
    && hasExplicitEntityTypeComparisonSignal;
  const INTERNATIONAL_CONTRAST_SIGNAL = /\b(?:sama(?:kah)?(?:\s+dengan)?|apakah\s+sama|tidak\s+sama|nggak\s+sama|gak\s+sama|bukan|beda(?:kah)?(?:\s+dengan)?|berbeda|perbedaan|bedanya|apa\s+bedanya|apa\s+perbedaan|vs|versus|atau)\b/i;
  const hasInternationalProgramComparison = INTERNATIONAL_CONTRAST_SIGNAL.test(q)
    && entities.internationalPrograms.length >= 2
    && /\b(?:student\s+exchange|pertukaran\s+mahasiswa|double\s*degree|dual\s*degree|dnui|dalian|help|utb|hi[-\s]?think|hithink|program\s+internasional)\b/i.test(q);
  const isDoubleDegree = entities.internationalPrograms.some((entity) => String(entity.role || '') === 'double_degree')
    || /\b(?:double\s*degree|dual\s*degree|program\s+ganda|kuliah\s+ganda)\b/i.test(q);
  const isInternational = entities.internationalPrograms.length > 0 || isDoubleDegree;
  const hasInternationalProgramSchedule = isInternational && hasSchedule && !hasFee;
  const asksInternationalProcedureSignal = /\b(?:syarat|persyaratan|seleksi(?:nya)?|perlu\s+apa|butuh\s+apa|dokumen|cara|alur|prosedur|langkah|tahapan|lewat\s+mana|kanal|channel|pengumuman|online|offline|mekanisme)\b/i.test(q)
    || (/\b(?:ikut|mengikuti|daftar|pendaftaran)\b/i.test(q) && !hasSchedule);
  const hasInternationalProgramProcedure = entities.internationalPrograms.length > 0
    && asksInternationalProcedureSignal
    && !hasInternationalProgramSchedule
    && !hasFee;
  const hasProgramLevelList = (
    /\b(?:jenjang|level\s+kuliah|strata|diploma|sarjana|pascasarjana|magister|d3|s1|s\s*1|s2|s\s*2)\b/i.test(q)
    && /\b(?:apa\s+saja|apa\s+aja|ada|tersedia|pilihan|daftar|list|program|prodi|jurusan)\b/i.test(q)
    && (
      asksList
      || /\b(?:program\s+studi|prodi|jurusan)\s+(?:yang\s+)?(?:tersedia|ada)\b/i.test(q)
      || /\b(?:program\s+magister|program\s+pascasarjana|program\s+s\s*2|prodi\s+s\s*2|prodi\s+pascasarjana|prodi\s+magister)\b[\s\S]*\b(?:apa|tersedia|ada)\b/i.test(q)
      || /\b(?:jenjang|strata)\b[\s\S]*\b(?:apa\s+saja|apa\s+aja|ada|tersedia)\b/i.test(q)
    )
  )
    && !asksLearning
    && !hasFee
    && !hasAcademic
    && !hasAccreditation
    && !hasFacultyProgramListRequest;
  const hasProgramList = !hasFacultyProgramListRequest && ((/\b(?:jurusan(?:nya)?|prodi(?:nya)?|program\s+studi)\b/i.test(q) && asksList && !hasFee) || hasProgramLevelList);
  const asksProgramDefinition = !hasProgramList && !hasFacultyProgramListRequest && /\b(?:apa\s+itu|apakah\s+itu|itu\s+apa|apaan|pengertian|jelaskan|maksud(?:nya)?|tentang|jurusan\s+apa|prodi\s+apa|program\s+studi\s+apa|seperti\s+apa)\b/i.test(q) && entities.programs.length > 0;
  const asksProgramCode = /\b(?:kode(?:\s+prodi|\s+program\s+studi|\s+jurusan|\s+mk|\s+mata\s+kuliah)?|program\s+code|course\s+code)\b/i.test(q)
    && !/\b(?:kode\s+pos|kode\s+etik|kode\s+bayar|kode\s+pembayaran|kode\s+referral|kode\s+voucher|kode\s+promo|kode\s+warna|kode\s+baju|dress\s*code)\b/i.test(q)
    && (entities.programs.length > 0 || /\b(?:prodi|program\s+studi|jurusan|mata\s+kuliah|matkul)\b/i.test(q));
  const asksExplicitCurriculum = /\b(?:kurikulum(?:nya)?|mata\s+kuliah(?:nya)?|matkul(?:nya)?|silabus(?:nya)?)\b/i.test(q)
    && !/\b(?:izin\s+belajar|study\s+permit)\b/i.test(q);
  const CURRICULUM_SUBJECT_CUE = /\b(?:hardware|perangkat\s+keras|software|perangkat\s+lunak|jaringan|networking?|embedded(?:\s+systems?)?|iot|internet\s+of\s+things|coding|ngoding|pemrograman|programming|data\s+(?:analytics|science)|analitik(?:a)?\s+data|analisis\s+data|cyber\s*security|keamanan\s+siber|keamanan\s+informasi|kecerdasan\s+buatan|artificial\s+intelligence|\bai\b|machine\s+learning|cloud(?:\s+computing)?|komputasi\s+awan|multimedia|basis\s+data|database|robotik|robotika|algoritma)\b/i;
  const CURRICULUM_FOCUS_CUE = /\b(?:fokus(?:nya)?|arah\s+belajar|belajarnya|dipelajari|mempelajari|materi|kurikulum|kompetensi|spesialisasi|konsentrasi)\b/i;
  const asksProgramFocusProfile = entities.programs.length > 0
    && (
      /\b(?:fokus(?:nya)?|arah\s+belajar|belajarnya|dipelajari|mempelajari|materi|kurikulum|kompetensi|spesialisasi|konsentrasi)\b/i.test(q)
      || ((CURRICULUM_SUBJECT_CUE.test(q) || Boolean(curriculumTopic)) && (CURRICULUM_FOCUS_CUE.test(q) || /\b(?:apakah|ada|tersedia|ya|kan|kah)\b/i.test(q)))
    )
    && !hasFee
    && !hasProgramComparison
    && !hasProgramDegreeOutcome
    && !hasCareer;
  const hasInstitutionProfile = /\b(?:visi|misi|tujuan|profil|profile|identitas|rektor|pimpinan|pejabat|ketua)\b/i.test(q)
    && /\b(?:kampus|institusi|lembaga|itb\s*stikom|stikom\s+bali|institut|stikom)\b/i.test(q)
    && !/\b(?:ukm|ormawa|organisasi\s+mahasiswa|himaprodi|himpunan|bem|inbis|inkubator|career\s+center|pusat\s+karier|student\s+exchange|double\s*degree|dual\s*degree|prodi|program\s+studi|jurusan)\b/i.test(q);
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
    && !/\b(?:student\s+exchange|pertukaran\s+mahasiswa|double\s*degree|dual\s*degree|hi[-\s]?think|hithink|mahasiswa\s+(?:luar\s+negeri|asing)|foreign\s+student|izin\s+belajar)\b/i.test(q);
  const asksOrganizationList = hasOrganization && (
    /\b(?:apa\s+saja|apa\s+aja|daftar|list|sebutkan|pilihan|jenis|macam|ada\s+apa|ada\s+gak|punya\s+apa|tersedia\s+apa|ada\s+(?:kelompok|komunitas|organisasi|ukm|ormawa))\b/i.test(q)
    || (!entities.organizations.length && /\b(?:ada|tersedia|punya|memiliki)\b/i.test(q) && /\b(?:ukm|ormawa|organisasi\s+mahasiswa|unit\s+kegiatan\s+mahasiswa|kegiatan\s+mahasiswa|kelompok\s+mahasiswa|komunitas\s+mahasiswa)\b/i.test(q))
    || (asksList && !/\b(?:cara|alur|proses|langkah|syarat|dokumen|biaya)\b/i.test(q))
  );
  let primaryIntent = 'ask_general';
  let primaryDomain = 'general';
  let answerExpectation = 'safe_answer_or_fallback';
  let explicitRelationType = null;

  if (hasUnsupportedExchangeBarterRelation) {
    primaryIntent = 'ask_unsupported_relation';
    primaryDomain = 'unknown';
    answerExpectation = 'safe_fallback';
  } else if (hasOperationalAcademicPolicy) {
    primaryIntent = 'ask_academic_policy';
    primaryDomain = 'academic_policy';
    answerExpectation = 'policy_or_safe_no_data';
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
  } else if (hasPmbSchedule && !negativeSemantics.excludedDomains.includes('pmb_schedule')) {
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
  } else if (hasOrganization && /\brobotik(?:a)?\b/i.test(q)) {
    primaryIntent = 'ask_organization_profile';
    primaryDomain = 'student_organization';
    answerExpectation = 'availability_or_category';
  } else if (hasOrganization && !/\b(?:nomor|kontak|telepon|telp|hp|wa|whatsapp|humas)\b/i.test(q) && (asksCount || /\b(?:berapa|jumlah|total)\b/i.test(q))) {
    primaryIntent = 'ask_organization_count';
    primaryDomain = 'student_organization';
    answerExpectation = 'count';
  } else if (hasOrganization && (organizationCategory || (interestProfiles.length > 0) || /\b(?:suka|hobi|minat|tertarik|ikut|ikutan|gabung|wadah)\b/i.test(q))) {
    if (asksOrganizationList) {
      primaryIntent = 'ask_organization_list';
      primaryDomain = 'student_organization';
      answerExpectation = 'list';
    } else {
      primaryIntent = 'ask_organization_profile';
      primaryDomain = 'student_organization';
      answerExpectation = 'availability_or_category';
    }
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
  } else if (hasOrganization) {
    primaryIntent = 'ask_organization_profile';
    primaryDomain = 'student_organization';
    answerExpectation = 'profile';
  } else if (hasStudentSupport) {
    primaryIntent = 'ask_student_support';
    primaryDomain = 'student_support';
    answerExpectation = 'support_availability';
  } else if (!/\b(?:atau|vs|bukan|beda|bedanya|perbedaan)\b/i.test(q) && /\b(?:kerja|bekerja|karier|karir|berkarier|berkarir|peluang\s+kerja|pekerjaan)\b/i.test(q) && (/\b(?:jepang|japan)\b/i.test(q) || entities.internationalPrograms.some(e => /hi-think|jepang/i.test(e.canonical)))) {
    primaryIntent = 'ask_career_service';
    primaryDomain = 'international_program';
    answerExpectation = 'service_or_career_info';
    explicitRelationType = 'career_in_japan';
    if (!entities.internationalPrograms.some(e => /hi-think/i.test(e.canonical))) {
      entities.internationalPrograms.push({
        canonical: 'Program Hi-Think (Magang Jepang)',
        type: 'special_program',
        role: 'international_program',
        confidence: 0.9,
        source: 'canonical-entity-registry'
      });
    }
  } else if (hasProgramFitReasoning) {
    primaryIntent = 'ask_program_fit_reasoning';
    primaryDomain = 'program';
    answerExpectation = 'recommendation_or_fit';
  } else if (hasCareerOutcome || (entities.programs.length > 0 && (hasCareer || /\b(?:prospek(?:nya)?|prospek\s+kerja|peluang\s+kerja|lulusan|kerja|karier|karir|pekerjaan)\b/i.test(q)) && !hasCareerServiceExplicit && !hasProgramDegreeOutcome && !/\b(?:magang|internship)\b/i.test(q))) {
    primaryIntent = 'ask_career_prospect';
    primaryDomain = 'career';
    answerExpectation = 'career_outcome';
  } else if (hasCareer) {
    primaryIntent = careerTopic === 'contact'
      ? 'ask_contact'
      : (hasWorkWhileStudying
        ? 'ask_work_while_studying'
        : ((hasCareerOutcome && !hasCareerServiceExplicit) ? 'ask_career_prospect' : 'ask_career_service'));
    primaryDomain = 'career';
    answerExpectation = (hasCareerOutcome && !hasCareerServiceExplicit)
      ? 'career_outcome'
      : (careerTopic === 'contact' ? 'contact' : 'service_or_career_info');
  } else if (/\b(?:antar\s+jemput|bus\s+kampus|shuttle)\b/i.test(q) && /\b(?:renon|jimbaran|denpasar|abiansemal|antara\s+kampus|antar\s+kampus)\b/i.test(q)) {
    primaryIntent = 'ask_location';
    primaryDomain = 'campus_location';
    answerExpectation = 'address_or_route';
  } else if (hasFacilityProfile || (entities && entities.unsupported && entities.unsupported.some(e => e.type === 'facility'))) {
    primaryIntent = /\b(?:visi|misi)\b/i.test(q) ? 'ask_facility_vision_mission' : 'ask_facility_profile';
    primaryDomain = 'campus_facility';
    answerExpectation = /\b(?:visi|misi)\b/i.test(q) ? 'vision_mission' : 'profile';
  } else if (hasInstitutionProfile) {
    primaryIntent = /\b(?:visi|misi)\b/i.test(q) ? 'ask_institution_vision_mission' : 'ask_institution_profile';
    primaryDomain = 'institution_profile';
    answerExpectation = /\b(?:visi|misi)\b/i.test(q) ? 'institution_vision_mission' : 'institution_profile_or_fallback';
  } else if (hasInternationalProgramComparison || (structuredRelation && (entities.internationalPrograms.length >= 2 || isInternational))) {
    primaryIntent = 'ask_international_program_comparison';
    primaryDomain = 'international_program';
    answerExpectation = 'comparison';
  } else if ((/\b(?:atau|vs|bukan|beda)\b/i.test(q) && /\b(?:magang|internship|exchange|student\s*exchange)\b/i.test(q) && /\b(?:double\s*degree|dual\s*degree|gelar\s*ganda|magang|internship|exchange|student\s*exchange)\b/i.test(q) && /\b(?:ke\s+jepang|jepang|ke\s+luar\s+negeri|luar\s+negeri|program\s+internasional|internasional)\b/i.test(q)) || (/\b(?:atau|vs|bukan|beda)\b/i.test(q) && /\b(?:magang|internship|exchange|student\s*exchange)\b/i.test(q) && /\b(?:double\s*degree|dual\s*degree|gelar\s*ganda)\b/i.test(q))) {
    primaryIntent = 'ask_international_program_comparison';
    primaryDomain = 'international_program';
    answerExpectation = 'comparison';
  } else if (isDoubleDegree && hasLocationIntent && !hasFee && !hasPhysicalAttribute) {
    primaryIntent = 'ask_location';
    primaryDomain = 'double_degree';
    answerExpectation = 'location';
  } else if (isDoubleDegree && /\b(?:kampus\s+(?:mitra|partner)|partner(?:nya)?|mitra(?:nya)?|partner\s+kampus(?:nya)?|mitra\s+kampus(?:nya)?|universitas\s+(?:mitra|partner)|negara(?:nya)?|tujuan|dengan\s+universitas)\b/i.test(q) && !hasFee) {
    primaryIntent = 'ask_availability';
    primaryDomain = 'double_degree';
    answerExpectation = 'list';
  } else if (((Array.isArray(academicLevels) && academicLevels.includes('S2')) || /\b(?:s2|s\s*2|magister|pascasarjana)\b/i.test(q) || (Array.isArray(entities.programs) && entities.programs.some(p => /s2|magister/i.test(p.canonical || p.name || '')))) && /\b(?:kelas\s*(?:malam|sabtu|karyawan|sore|weekend)|jadwal\s+(?:per)?kuliah|waktu\s+(?:per)?kuliah|(?:per)?kuliah(?:an)?\s+(?:kapan|malam|sabtu)|bisa\s+kelas)\b/i.test(q)) {
    primaryIntent = 'ask_availability';
    primaryDomain = 's2_postgraduate';
    answerExpectation = 'date_or_period';
    explicitRelationType = 'study_schedule';
  } else if (hasInternationalProgramSchedule) {
    primaryIntent = 'ask_schedule';
    primaryDomain = isDoubleDegree ? 'double_degree' : 'international_program';
    answerExpectation = 'date_or_period';
  } else if (hasInternationalProgramProcedure) {
    primaryIntent = (asksRegistrationRequirements || /\b(?:syarat|persyaratan|toefl|ielts|skor|score|dokumen|berkas)\b/i.test(q)) ? 'ask_registration_requirements' : 'ask_international_program_procedure';
    primaryDomain = isDoubleDegree ? 'double_degree' : 'international_program';
    answerExpectation = (asksRegistrationRequirements || /\b(?:syarat|persyaratan|toefl|ielts|skor|score|dokumen|berkas)\b/i.test(q)) ? 'requirements' : 'procedure';
  } else if (hasDoubleDegreeSequence) {
    primaryIntent = /\b(?:berapa\s+tahun|skema\s+kuliah|timeline|jadwal|durasi)\b/i.test(q) ? 'ask_schedule' : 'ask_international_program_sequence';
    primaryDomain = 'double_degree';
    answerExpectation = 'sequence';
    explicitRelationType = 'study_timeline';
  } else if (hasInternationalProgramDegreeOutcome) {
    primaryIntent = 'ask_international_degree_outcome';
    primaryDomain = 'double_degree';
    answerExpectation = 'degree_or_credential';
  } else if (hasDualDegreeRelation) {
    primaryIntent = 'ask_relation_pairing';
    primaryDomain = 'double_degree';
    answerExpectation = 'relation_pairing';
  } else if (hasProgramComparison && entities.programs.length >= 2) {
    primaryIntent = 'ask_program_comparison';
    primaryDomain = 'program_comparison';
    answerExpectation = 'comparison';
  } else if (hasAcademicCreditComparison) {
    primaryIntent = 'ask_academic_comparison';
    primaryDomain = 'academic';
    answerExpectation = 'comparison';
  } else if (hasCampusCount) {
    primaryIntent = 'ask_campus_count';
    primaryDomain = 'campus_location';
    answerExpectation = 'count';
  } else if ((entities.campuses.length >= 2 || (entities.campuses.length > 0 && /\b(?:mana|lengkap|lebih\s+lengkap|beda|fasilitas|banding|dibanding|pilih)\b/i.test(q))) && !hasFee) {
    primaryIntent = 'ask_campus_comparison';
    primaryDomain = 'campus_location';
    answerExpectation = 'comparison';
  } else if (hasLocationIntent && !hasPhysicalAttribute && !hasAcademicSchedule && !hasAcademicProcedure) {
    primaryIntent = 'ask_location';
    primaryDomain = 'campus_location';
    answerExpectation = 'address_or_route';
  } else if ((hasFeeComponentComparison || hasCrossDomainComparison || hasComparisonQuery) && !hasFeeComparison) {
    primaryIntent = 'ask_cross_domain_comparison';
    primaryDomain = 'general';
    answerExpectation = 'comparison';
  } else if (hasFacultyProgramListRequest) {
    primaryIntent = 'ask_faculty_program_list';
    primaryDomain = 'academic';
    answerExpectation = 'specific_fact_or_fallback';
  } else if (hasStudyModalityTerm) {
    primaryIntent = 'ask_delivery_mode';
    primaryDomain = 'academic';
    answerExpectation = 'specific_fact_or_fallback';
  } else if (hasOnlineLearningPlatform) {
    primaryIntent = 'ask_learning_platform';
    primaryDomain = 'academic';
    answerExpectation = 'specific_fact_or_fallback';
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
    answerExpectation = requestedSlot === 'place' ? 'location' : 'date_or_period';
  } else if (hasPhysicalAttribute) {
    primaryIntent = 'ask_physical_attribute';
    primaryDomain = 'campus_physical';
    answerExpectation = 'specific_fact_or_fallback';
  } else if (hasRpl) {
    if (hasFee) {
      primaryIntent = 'ask_fee';
      primaryDomain = 'fee';
      answerExpectation = 'amount_or_breakdown';
    } else {
      primaryIntent = 'ask_rpl';
      primaryDomain = 'academic_policy';
      answerExpectation = 'definition';
    }
  } else if (hasScholarship) {
    const asksScholarshipDiscountOrTuitionFee = !/\bbiaya\s+hidup\b/i.test(q) && (hasFee || /\b(?:potongan|diskon|dpp|ukt|persen)\b/i.test(q));
    primaryIntent = asksScholarshipDiscountOrTuitionFee ? 'ask_fee' : 'ask_scholarship';
    primaryDomain = 'scholarship';
    answerExpectation = asksScholarshipDiscountOrTuitionFee ? 'amount_or_breakdown' : (asksList ? 'list' : 'specific_fact_or_fallback');
  } else if (hasContactRequest) {
    primaryIntent = 'ask_contact';
    primaryDomain = 'campus_contact';
    answerExpectation = 'contact';
  } else if (asksRegistrationRequirements && !hasInternationalAdmin) {
    primaryIntent = 'ask_registration_requirements';
    primaryDomain = isDoubleDegree ? 'double_degree' : (entities.internationalPrograms.length > 0 ? 'international_program' : 'registration');
    answerExpectation = 'requirements_or_procedure';
  } else if (asksRegistrationHow && !hasInternationalAdmin) {
    primaryIntent = 'ask_registration_how';
    primaryDomain = isDoubleDegree ? 'double_degree' : (entities.internationalPrograms.length > 0 ? 'international_program' : 'registration');
    answerExpectation = 'procedure';
  } else if (hasInternationalAdminFee) {
    primaryIntent = 'ask_international_admin_fee';
    primaryDomain = 'international_admin';
    answerExpectation = 'amount_or_breakdown';
  } else if (hasInternationalAdmin) {
    primaryIntent = /\b(?:berapa\s+lama|durasi|lama|waktu|jadwal|kapan)\b/i.test(q) ? 'ask_schedule' : 'ask_international_admin_procedure';
    primaryDomain = 'international_admin';
    answerExpectation = /\b(?:berapa\s+lama|durasi|lama|waktu)\b/i.test(q) ? 'numeric_fact' : (/\b(?:dokumen|syarat|berkas|urus|ngurus|perpanjang|prosedur|cara|bagaimana|gimana)\b/i.test(q) ? 'procedure' : 'specific_fact_or_fallback');
    if (/\b(?:izin\s+belajar|study\s+permit)\b/i.test(q) && /\b(?:berapa\s+lama|durasi|lama|waktu|proses|pengajuan)\b/i.test(q)) {
      explicitRelationType = 'permit_timeline';
    } else if (/\b(?:dokumen|syarat|berkas|upload|diupload|unggah|diunggah)\b/i.test(q)) {
      explicitRelationType = 'foreign_documents';
    }
  } else if (hasFeeComparison && !hasFeeComponentComparison) {
    primaryIntent = 'ask_fee_comparison';
    primaryDomain = 'fee';
    answerExpectation = 'comparison';
  } else if (hasFee) {
    const isInstallmentPolicy = /\b(?:bisa\s+(?:di)?cicil|boleh\s+(?:di)?cicil|sistem\s+cicil|skema\s+cicil)\b/i.test(q)
      && !/\b(?:berapa\s+(?:kali|bulan|angsuran)|berapa\s+nominal|berapa\s+jumlah)\b/i.test(q);
    const isFeeDefinition = !isInstallmentPolicy && /\b(?:apa\s+itu|itu\s+apa|pengertian|maksud(?:nya)?|istilah(?:nya)?|itu\s+dpp\s+ya|apakah\s+(?:itu\s+)?dpp|sama\s+(?:kah\s+)?(?:dengan|sama))\b/i.test(q)
      && !/\b(?:berapa|nominal|jumlah|total|tarif|harga|besaran)\b/i.test(q);
    primaryIntent = 'ask_fee';
    primaryDomain = 'fee';
    answerExpectation = isInstallmentPolicy ? 'policy_or_safe_no_data' : (isFeeDefinition ? 'definition' : 'amount_or_breakdown');
  } else if (hasPmbDefinition) {
    primaryIntent = 'ask_definition';
    primaryDomain = 'registration';
    answerExpectation = 'definition';
  } else if (hasRegistrationTopicOpening) {
    primaryIntent = 'ask_general';
    primaryDomain = 'registration';
    answerExpectation = 'topic_opening';
  } else if (asksLearning && (entities.programs.length > 0 || curriculumTopic) && !(hasCareerGoalRecommendation && entities.programs.length === 0)) {
    primaryIntent = 'ask_program_curriculum';
    primaryDomain = 'program_curriculum';
    answerExpectation = 'curriculum_or_topic_presence';
  } else if (entities.internationalPrograms.length > 0) {
    if (asksRegistrationRequirements || /\b(?:syarat|persyaratan|dokumen|berkas)\b/i.test(q)) {
      primaryIntent = 'ask_registration_requirements';
      answerExpectation = 'requirements';
    } else if (asksRegistrationHow) {
      primaryIntent = 'ask_registration_how';
      answerExpectation = 'procedure';
    } else {
      primaryIntent = 'ask_availability';
      answerExpectation = 'availability_or_safe_fallback';
    }
    primaryDomain = (
      entities.internationalPrograms.some((entity) => String(entity.role || '') === 'double_degree' || /double\s*degree|dual\s*degree/i.test(entity.canonical || ''))
      || /\b(?:double\s*degree|dual\s*degree)\b/i.test(q)
    ) ? 'double_degree' : 'international_program';
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
  } else if (hasSchedule && !isBareSlotFollowup && !negativeSemantics.excludedDomains.includes('pmb_schedule')) {
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
  } else if (asksProgramCode) {
    primaryIntent = 'ask_program_detail';
    primaryDomain = /\b(?:mata\s+kuliah|matkul|\bmk\b)\b/i.test(q) ? 'academic' : 'program';
    answerExpectation = 'specific_fact_or_fallback';
  } else if (asksProgramFocusProfile) {
    primaryIntent = 'ask_program_curriculum';
    primaryDomain = 'program_curriculum';
    answerExpectation = 'curriculum_or_topic_presence';
  } else if (asksProgramDefinition) {
    primaryIntent = 'ask_program_definition';
    primaryDomain = 'program';
    answerExpectation = 'definition';
  } else if (asksLearning && (entities.programs.length > 0 || curriculumTopic || asksExplicitCurriculum)) {
    primaryIntent = 'ask_program_curriculum';
    primaryDomain = 'program_curriculum';
    answerExpectation = 'curriculum_or_topic_presence';
  } else if (asksAdvice && entities.programs.length) {
    primaryIntent = 'ask_program_advice';
    primaryDomain = 'program_advice';
    answerExpectation = 'advice_with_entity';
  } else if (hasCareer) {
    primaryIntent = careerTopic === 'contact'
      ? 'ask_contact'
      : (hasWorkWhileStudying
        ? 'ask_work_while_studying'
        : ((hasCareerOutcome && !hasCareerServiceExplicit) ? 'ask_career_prospect' : 'ask_career_service'));
    primaryDomain = 'career';
    answerExpectation = (hasCareerOutcome && !hasCareerServiceExplicit)
      ? 'career_outcome'
      : (careerTopic === 'contact' ? 'contact' : 'service_or_career_info');
  } else if (hasFacility) {
    primaryIntent = 'ask_facility_list';
    primaryDomain = 'campus_facility';
    answerExpectation = asksList ? 'list' : 'specific_fact_or_fallback';
  }

  const explicitPointInTime = temporal.explicitDate && !/\b(?:bulan|sebulan|selama\s+bulan|ringkasan\s+bulan|overview\s+bulan|bulan\s+apa\s+saja)\b/i.test(q);
  let questionType = 'informational';
  if (asksCount) questionType = 'count';
  else if (hasFeeComparison || hasProgramComparison || hasAcademicLevelComparison || hasFeeComponentComparison || hasAcademicCreditComparison || hasEntityTypeComparison || hasLegalDocumentVsPmbComparison) questionType = 'comparison';
  else if (hasOperationalAcademicPolicy) questionType = 'yes_no_or_explain';
  else if (/\b(?:berapa\s+(?:lama|tahun|semester)|durasi|lama\s+kuliah|lama\s+studi|masa\s+studi|waktu\s+pengurusan|lama\s+proses|prosesnya\s+berapa\s+lama)\b/i.test(q)) questionType = 'duration';
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
  const comparisonScope = hasAllProgramsScope
    ? 'all_programs'
    : ((hasFeeComparison || hasProgramComparison) && entities.programs.length > 0 ? 'explicit_entities' : null);
  return {
    intent: { primary: primaryIntent, secondary: [], confidence: primaryIntent === 'ask_general' ? 0.45 : 0.82 },
    domain: { primary: primaryDomain, confidence: primaryDomain === 'general' ? 0.45 : 0.82 },
    constraints: {
      feeType,
      requestedField: feeType === 'ukt' && /\b(?:per\s+semester|semesteran|tiap\s+semester|setiap\s+semester|ukt)\b/i.test(q)
        ? 'semester_fee'
        : (feeType
          || (hasStudyModalityTerm ? 'deliveryMode' : null)
          || (primaryIntent === 'ask_program_curriculum' || /\b(?:kurikulum|mata\s+kuliah|matkul)\b/i.test(q) ? 'curriculum' : null)
          || (careerTopic === 'contact' || hasContactRequest || /\b(?:contact\s*person|narahubung|\bpic\b|nomor\s+(?:kontak|wa|whatsapp|telepon|hp))\b/i.test(q) ? 'contact' : null)
          || (careerTopic === 'work_while_studying' || primaryIntent === 'ask_work_while_studying' ? 'work_while_studying' : null)
          || (asksProgramCode ? 'code' : null)
          || (hasFacultyProgramListRequest || academicTopic === 'faculty_program_mapping' ? 'faculty_program_mapping' : null)
          || (academicTopic === 'academic_advising' ? 'academic_advising' : null)
          || (hasOnlineLearningPlatform || academicTopic === 'online_learning_platform' ? 'platform' : null)),
      studyModality: Boolean(hasStudyModalityTerm),
      comparisonScope,
      isComparativeFollowupEllipsis: Boolean(isComparativeFollowupEllipsis),
      profileInsufficient: isProfileInsufficientForRecommendation,
      schoolBackground: hasSchoolOriginBackground ? (/\bsmk\b/i.test(q) ? 'smk_computer' : 'general_school') : null,
      registrationWave: temporal.requestedWave || null,
      academicLevel: academicLevels.length === 1 ? academicLevels[0] : null,
      academicLevels,
      programScope: doubleDegreeScope,
      geographicScope: doubleDegreeScope,
      locationIntent: hasLocationIntent,
      physicalAttribute: hasPhysicalAttribute,
      comparisonTarget: hasAcademicLevelComparison ? 'academic_level' : (hasLegalDocumentVsPmbComparison ? 'institution_legal_document_vs_pmb_schedule' : (hasInternationalProgramComparison ? 'international_program' : (hasFeeComponentComparison ? 'fee_component' : (hasAcademicCreditComparison ? 'academic_credit' : (hasEntityTypeComparison ? 'entity_type' : ((hasFeeComparison || /\b(?:beda|bedanya|bedain|perbedaan|banding|bandingkan|dibanding(?:kan)?|perbandingan|vs|versus)\b/i.test(q)) ? 'program' : null)))))),
      academicTopic: academicTopic
        || (hasAcademicNumeric ? 'academic_numeric'
          : (hasAcademicProcedure ? 'academic_procedure'
            : (hasAcademicSchedule ? 'academic_schedule' : null))),
      academicScheduleType: hasAcademicSchedule ? academicScheduleType : null,
      requestedSlot: requestedSlot || null,
      isBareSlotFollowup: Boolean(isBareSlotFollowup),
      isMetaAcknowledgement: Boolean(isMetaAcknowledgement),
      isProtestOrCorrection: Boolean(negativeSemantics.isProtestOrCorrection),
      relationType: explicitRelationType || (
        hasUnsupportedExchangeBarterRelation ? 'unsupported_exchange_barter'
        : (hasUnsupportedAcademicPolicy ? 'unsupported_academic_policy'
          : (hasLegalDocumentVsPmbComparison ? 'institution_legal_document_vs_pmb_schedule'
            : (externalRelation ? externalRelation.relationType
              : (hasInternationalProgramComparison ? 'international_program_contrast'
                : (hasFeeComponentComparison ? 'fee_component_contrast'
                  : (hasAcademicCreditComparison ? 'academic_credit_comparison'
                    : (hasEntityTypeComparison ? 'entity_type_distinction'
                      : (hasDualDegreeRelation ? 'double_degree_partner_program_pairing'
                        : (hasDoubleDegreeSequence ? 'double_degree_sequence'
                          : (hasDoubleDegreeOutcome || hasInternationalProgramDegreeOutcome ? 'double_degree_outcome'
                            : ((structuredRelation && structuredRelation.relationType) || null)))))))))))
      ),
      structuredRelation: structuredRelation || null,
      excludedDomains: negativeSemantics.excludedDomains || [],
      excludedFields: negativeSemantics.excludedFields || [],
      negatedSpans: negativeSemantics.negatedSpans || [],
      externalRelation,
      institutionHistorySubtype: institutionHistorySubtype || null,
      institutionTopic: hasInstitutionProfile ? (/\b(?:visi|misi)\b/i.test(q) ? 'vision_mission' : (/\btujuan\b/i.test(q) ? 'purpose' : 'profile')) : null,
      careerTopic,
      organizationCategory: (primaryDomain === 'student_organization' || primaryDomain === 'student_support') ? organizationCategory : null,
      curriculumTopic,
      scholarshipType: hasScholarship && entities.scholarships && entities.scholarships[0]
        ? (() => {
            const rawName = String(entities.scholarships[0].canonical || '');
            if (/1k1s|skss|satu\s+keluarga/i.test(rawName)) return '1K1S';
            if (/\bkip\b/i.test(rawName)) return 'KIP';
            if (/prestasi/i.test(rawName)) return 'Prestasi';
            if (/yayasan/i.test(rawName)) return 'Yayasan';
            if (/ranking|peringkat/i.test(rawName)) return 'Ranking';
            return rawName.replace(/^Beasiswa\s+/i, '');
          })()
        : null,
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
  let qEffective = q;
  if (classification && classification.constraints && Array.isArray(classification.constraints.negatedSpans)) {
    for (const span of classification.constraints.negatedSpans) {
      qEffective = qEffective.replace(String(span).toLowerCase(), '');
    }
  }
  const fields = new Set();
  const asksProfileRelation = /\b(?:profil(?:nya)?|profile|tentang(?:nya)?|apa\s+itu|itu\s+apa|jelaskan|detail(?:nya)?|gambaran)\b/i.test(q);
  const asksExplicitProcedureRelation = /\b(?:cara(?:nya)?|bagaimana\s+cara|gimana\s+cara|alur(?:nya)?|prosedur(?:nya)?|langkah|tahapan|syarat|persyaratan|dokumen\s+apa|berkas|pendaftaran|mendaftar|daftar(?:nya)?|registrasi(?:nya)?|how\s+to|how\s+do\s+i|steps|procedure|requirements?)\b/i.test(qEffective);

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

  const requestedSlot = (classification && classification.constraints && classification.constraints.requestedSlot)
    || detectRequestedSlot(rawQuery, normalizedQuery);
  if (requestedSlot === 'time') {
    fields.add('time');
  } else if (requestedSlot === 'place') {
    fields.add('place');
    fields.add('location');
  } else if (requestedSlot === 'date') {
    fields.add('date');
  } else if (/\b(?:kapan|tanggal|tgl|hari|waktu|jadwal|periode|bulan|tahun)\b/i.test(qEffective)) {
    if (/\b(?:berlaku|masa\s+berlaku|valid(?:ity)?)\b/i.test(qEffective)) {
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
    } else if (classification
      && classification.intent
      && classification.intent.primary === 'ask_institution_history'
      && classification.domain
      && classification.domain.primary === 'institution_profile'
      && classification.constraints
      && classification.constraints.institutionHistorySubtype === 'LEGAL_DECREE_DATE') {
      fields.add('legalDecreeDate');
      fields.add('date');
    } else {
      fields.add('date');
    }
  }
  if (classification && classification.constraints && classification.constraints.academicScheduleType === 'registration_deadline') {
    fields.add('registrationDeadline');
    if (!requestedSlot) {
      fields.add('date');
      fields.add('time');
      fields.add('location');
    }
  } else if (classification && classification.constraints && classification.constraints.academicScheduleType === 'event_execution') {
    fields.add('eventExecution');
    if (!requestedSlot) {
      fields.add('date');
      fields.add('time');
      fields.add('location');
    }
  } else if (classification && classification.domain && classification.domain.primary === 'academic' && classification.constraints && classification.constraints.academicTopic === 'academic_schedule' && !requestedSlot) {
    fields.add('schedule');
    fields.add('date');
    fields.add('time');
    fields.add('location');
  }
  if (/\b(?:berlaku(?:nya)?\s+sampai|masa\s+berlaku(?:nya)?|valid(?:ity)?|sampai\s+tahun\s+berapa)\b/i.test(qEffective)
    || (/\bsampai\s+kapan\b/i.test(qEffective) && !(classification && classification.domain && classification.domain.primary === 'academic'))) {
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

  // Media fields (image, photo, calendar image, etc.)
  if (/\b(?:gambar|foto|image|png|jpg|media|poster|brosur)\b/i.test(q)) {
    fields.add('calendarImage');
    fields.add('mediaUrl');
    fields.add('documentUrl');
    fields.add('mediaAsset');
  }

  // Certification fields
  if (/\b(?:sertifikasi|sertifikat)\b/i.test(q)) {
    fields.add('certification');
    if (/\b(?:vendor|internasional|resmi|profesi|luar\s+negeri|mikrotik|cisco|oracle|ec-council)\b/i.test(q)) {
      fields.add('vendorCertifications');
      fields.add('internationalCertification');
    }
  }

  // Specific contact details (email, social media, phone, etc.)
  if (/\b(?:email|surel|surat\s+elektronik)\b/i.test(q)) {
    fields.add('email');
    fields.add('contact');
  }
  if (/\b(?:instagram|ig|medsos|sosial\s+media|sosmed)\b/i.test(q)) {
    fields.add('instagram');
    fields.add('socialMedia');
    fields.add('contact');
  }
  if (/\b(?:nomor|no\b|telepon|telp|wa|whatsapp|hotline|kontak|hubungi|contact\s*person|narahubung|pic\b|penanggung\s*jawab)\b/i.test(q)) {
    fields.add('contactNumber');
    fields.add('phone');
    fields.add('contact');
    if (/\b(?:contact\s*person|narahubung|pic\b|penanggung\s*jawab)\b/i.test(q)) {
      fields.add('contactPerson');
      fields.add('pic');
    }
  }

  // Installment / cicilan
  if (/\b(?:cicil(?:an)?|angsur(?:an)?|tahap(?:an)?|skema\s+cicil|bisa\s+dicicil)\b/i.test(q)) {
    fields.add('installment');
  }

  // Delivery mode / Study modality
  if ((classification && classification.constraints && classification.constraints.studyModality) || /\b(?:online|offline|hybrid|daring|luring|tatap\s+muka)\b/i.test(q)) {
    fields.add('deliveryMode');
    fields.add('studyModality');
  }

  // Comparison
  if (/\b(?:beda|perbedaan|dibandingkan|bandingkan|versus|\bvs\b|komparasi)\b/i.test(q)) {
    fields.add('comparison');
  }

  const intent = String(classification && classification.intent && classification.intent.primary || '');
  const domain = String(classification && classification.domain && classification.domain.primary || '');
  const relationType = String(classification && classification.constraints && classification.constraints.relationType || '');
  const careerTopic = String(classification && classification.constraints && classification.constraints.careerTopic || '');
  const feeType = String(classification && classification.constraints && classification.constraints.feeType || '');
  if (/\b(?:kode(?:\s+prodi|\s+program\s+studi|\s+jurusan|\s+mk|\s+mata\s+kuliah)?|program\s+code|course\s+code)\b/i.test(q)
    && !/\b(?:kode\s+pos|kode\s+etik|kode\s+bayar|kode\s+pembayaran|kode\s+referral|kode\s+voucher|kode\s+promo|kode\s+warna|kode\s+baju|dress\s*code)\b/i.test(q)
    && (domain === 'program' || domain === 'academic' || intent === 'ask_program_detail')) {
    fields.add('code');
  }
  if (domain === 'student_organization' || intent === 'ask_organization_profile' || intent === 'ask_organization_count' || intent === 'ask_organization_vision_mission' || intent === 'ask_program_curriculum') {
    if (domain === 'student_organization' || /\b(?:ukm|ormawa|organisasi)\b/i.test(q)) {
      fields.add('organization');
      fields.add('availability');
      if (classification && classification.constraints && classification.constraints.organizationCategory) {
        fields.add('organizationCategory');
      }
      if (classification && (classification.questionType === 'count' || intent === 'ask_organization_count')) {
        fields.add('organizationCount');
      }
      if (intent === 'ask_organization_list' || (classification && classification.questionType === 'list')) {
        fields.add('organizationList');
      }
      if (/\b(?:nama\b.*?\bapa|apa\s+nama(?:nya)?)\b/i.test(q)) {
        fields.add('name');
      }
    }
  }
  if (/\b(?:nama\b.*?\bapa|apa\s+nama(?:nya)?)\b/i.test(q) && (domain === 'student_organization' || intent === 'ask_organization_profile' || (classification && classification.entities && classification.entities.organizations && classification.entities.organizations.length > 0) || /\b(?:organisasi|ormawa|ukm|himpunan|himaprodi|komunitas)\b/i.test(q))) {
    fields.add('organization');
    fields.add('name');
  }
  if (/\brobotik(?:a)?\b/i.test(q)) {
    fields.add('organization');
    fields.add('availability');
    fields.add('focus');
    fields.add('curriculumFocus');
    fields.add('curriculumTopicPresence');
    fields.add('specificTopic');
  }
  const isUangGedung = /\b(?:uang|biaya)\s+gedung\b/i.test(q);
  if (!isUangGedung && domain !== 'program_curriculum' && (domain === 'campus_facility' || intent.startsWith('ask_facility') || (classification && classification.entities && classification.entities.facilities && classification.entities.facilities.length > 0) || /\b(?:fasilitas|lab(?:oratorium)?|perpustakaan|perpus|studio|coworking|ruang(?:\s+kelas)?|gedung)\b/i.test(q))) {
    fields.add('facility');
    if (asksProfileRelation || intent === 'ask_facility_profile' || /\b(?:lengkap|fitur|alat|buku|komputer|podcast|multimedia|izin|bebas\s+pake|bebas\s+pakai|luas|lantai)\b/i.test(q)) {
      fields.add('profile');
      fields.add('definition');
    }
    if (/\b(?:ada|tersedia|punya|memiliki|apakah|bisa\s+pake|bebas\s+pake|ga\s+ada|lengkap|luas|disediakan|menyediakan|sedia)\b/i.test(q)) {
      fields.add('availability');
    }
    if (!isUangGedung && /\b(?:lantai|ruang|gedung|lokasi|di\s+mana|dimana|alamat|posisi|letak)\b/i.test(q)) {
      fields.add('location');
      fields.add('campusLocation');
    }
  }
  if (/\b(?:potongan|diskon|persen)\b/i.test(q)) {
    fields.add('discount');
  }
  if (/\b(?:apakah\s+(?:stikom\s+bali\s+)?(?:menerima|ada|buka|tersedia|memiliki|punya)|tersedia|tersediakah|adakah|disediakan|menyediakan)\b/i.test(q)) {
    fields.add('availability');
  }
  if (intent === 'ask_career_service' || intent === 'ask_career_prospect' || intent === 'ask_work_while_studying' || domain === 'career') {
    if (intent === 'ask_career_prospect' || careerTopic === 'outcome') {
      fields.add('careerOutcome');
      fields.add('jobRole');
      fields.add('graduateProfile');
      fields.add('profession');
      fields.add('prospect');
    } else if (careerTopic === 'contact') {
      fields.add('contact');
      fields.add('career:contact');
      if (/\b(?:email|surel)\b/i.test(q)) {
        fields.add('email');
      }
      if (!/\b(?:email|surel)\b/i.test(q) || /\b(?:contact\s*person|narahubung|pic\b|penanggung\s*jawab|nomor|no\b|telepon|telp|wa|whatsapp|hp|hubungi)\b/i.test(q)) {
        fields.add('contactPerson');
        fields.add('pic');
      }
    } else if (careerTopic === 'work_while_studying' || intent === 'ask_work_while_studying') {
      fields.add('workWhileStudying');
      fields.add('careerSupport');
      fields.add('career:work_while_studying');
    } else {
      fields.add('careerSupport');
      fields.add('service');
      if (careerTopic) fields.add(`career:${careerTopic}`);
      if (careerTopic === 'definition') fields.add('definition');
      if (careerTopic === 'benefit') fields.add('benefit');
      if (careerTopic === 'employment_support') fields.add('employmentSupport');
      if (careerTopic === 'opportunity') fields.add('opportunity');
    }
  }
  if (intent === 'ask_registration_data_correction') {
    fields.add('dataCorrection');
    fields.add('procedureSteps');
  }
  if (intent === 'ask_registration_requirements') {
    fields.add('requirements');
    fields.add('registration');
    if (/\b(?:upload|diupload|unggah|diunggah|online)\b/i.test(q)) {
      fields.add('documentUpload');
      fields.add('submissionChannel');
      fields.add('procedureSteps');
    }
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
  if (intent === 'ask_faculty_program_list' || (classification && classification.constraints && classification.constraints.academicTopic === 'faculty_program_mapping')) {
    fields.add('facultyProgramMapping');
    fields.add('programList');
  }
  if (intent === 'ask_learning_platform' || (classification && classification.constraints && classification.constraints.academicTopic === 'online_learning_platform')) {
    fields.add('platform');
    fields.add('application');
  }
  if (classification && classification.constraints && classification.constraints.academicTopic === 'academic_advising') {
    fields.add('definition');
    fields.add('academicAdvising');
  }
  if (intent === 'ask_program_curriculum' || /\b(?:fokus(?:nya)?|arah\s+belajar|belajarnya|dipelajari|kompetensi|spesialisasi|konsentrasi|kurikulum(?:nya)?)\b/i.test(q)) {
    fields.add('focus');
    fields.add('curriculumFocus');
    if (/\b(?:kurikulum(?:nya)?|mata\s+kuliah(?:nya)?|matkul(?:nya)?|silabus(?:nya)?)\b/i.test(q)) {
      fields.add('curriculum');
    }
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
    if (intent === 'ask_location' || (classification && classification.constraints && classification.constraints.locationIntent)) {
      fields.add('location');
      fields.add('campusLocation');
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
  if (/\b(?:berapa\s+(?:lama|tahun)|durasi|lama\s+kuliah|lama\s+studi|masa\s+studi|waktu\s+pengurusan|proses)\b/i.test(q)
    || (domain === 'double_degree' && /\b(?:skema|berapa\s+tahun|tahun\s+di)\b/i.test(q))) {
    fields.add('duration');
    fields.add('sequence');
  }
  if (/\b(?:kelas\s*(?:malam|sabtu|karyawan|sore|weekend)|waktu\s+(?:per)?kuliah|jadwal\s+(?:per)?kuliah)\b/i.test(q) || (domain === 's2_postgraduate' && /\b(?:kelas|sabtu|malam|kuliah)\b/i.test(q))) {
    fields.add('schedule');
    fields.add('date');
    fields.add('deadline');
    fields.add('validityPeriod');
  }
  if (domain === 'double_degree' && /\b(?:skema|tahapan|berapa\s+tahun|bali|malaysia|china|dalian|bandung)\b/i.test(q)) {
    fields.add('schedule');
    fields.add('date');
    fields.add('deadline');
    fields.add('validityPeriod');
    fields.add('duration');
    fields.add('semesterCount');
    fields.add('sequence');
    fields.add('studyLocation');
  }
  if (/\b(?:kerja|karier|karir|peluang\s+kerja)\b/i.test(q) && (/\b(?:jepang|japan)\b/i.test(q) || domain === 'international_program')) {
    fields.add('careerSupport');
    fields.add('opportunity');
    fields.add('service');
  }
  if (/\b(?:berapa\s+semester|semester\s+(?:[1-8]|satu|dua|tiga|empat)|(?:maksimal|minimal|batas)\s+(?:cuti\s+)?(?:berapa\s+)?semester|cuti)\b/i.test(q)
    || (/\b(?:berapa\s+semester|semester)\b/i.test(q) && (/\b(?:s2|magister|d3|s1|studi|masa\s+studi)\b/i.test(q) || (classification && classification.constraints && classification.constraints.academicLevel)))) {
    fields.add('semesterCount');
    fields.add('duration');
  }
  if (/\b(?:berapa\s+sks|sks|total\s+sks|beban\s+sks)\b/i.test(q)) {
    fields.add('creditCount');
    fields.add('sksWeight');
  }
  if (asksProfileRelation) {
    fields.add('profile');
    fields.add('definition');
  }
  const isInstallmentPolicyQ = /\b(?:bisa\s+(?:di)?cicil|boleh\s+(?:di)?cicil|sistem\s+cicil|skema\s+cicil)\b/i.test(q)
    && !/\b(?:berapa\s+(?:kali|bulan|angsuran)|berapa\s+nominal|berapa\s+jumlah)\b/i.test(q);
  const isFeeDefOrEquiv = !isInstallmentPolicyQ && (intent === 'ask_fee_definition' || (/\b(?:apa\s+itu|itu\s+apa|pengertian|maksud(?:nya)?|istilah(?:nya)?|itu\s+dpp\s+ya|apakah\s+(?:itu\s+)?dpp|sama\s+(?:kah\s+)?(?:dengan|sama))\b/i.test(q)
    && !/\b(?:berapa|nominal|jumlah|total|tarif|harga|besaran)\b/i.test(q)));
  if (feeType) {
    if (isInstallmentPolicyQ) {
      fields.add('policy');
      fields.add('installment');
    } else if (isFeeDefOrEquiv) {
      fields.add('definition');
      fields.add('equivalence');
      fields.add('feeComponent');
    } else {
      fields.add('amount');
    }
    if (feeType === 'registration_fee') fields.add('registrationFee');
    else if (feeType === 'ukt') {
      fields.add('tuitionFee');
      if (/\b(?:per\s+semester|semesteran|tiap\s+semester|setiap\s+semester|ukt)\b/i.test(q)) {
        fields.add('semester_fee');
      }
    } else if (feeType === 'dpp') fields.add('developmentFee');
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
  if (/\b(?:tahun\s+(?:[1-4]|pertama|kedua|ketiga|keempat)|semester\s+(?:[1-8]|satu|dua|tiga|empat|lima|enam|tujuh|delapan|ganjil|genap|pertama|kedua)|gelombang\s+(?:[1-9]|pertama|kedua|ketiga|keempat)|skema|alur\s+kuliah|urutan|sequence|wave)\b/i.test(q)) {
    fields.add('sequence');
  }
  if (domain === 'accreditation' || intent === 'ask_accreditation' || /\b(?:akreditasi(?:\s+apa)?|peringkat|grade|terakreditasi|status\s+akreditasi|status)\b/i.test(q)) {
    fields.add('grade');
    fields.add('status');
  }
  if (!isFeeDefOrEquiv && !isInstallmentPolicyQ && /\b(?:biaya|harga|uang|nominal|tarif|(?:pem)?bayar(?:an)?|ukt|dpp|spp|fee|cost|tuition|price|payment|\d+\s*(?:ribu|rb|jt|juta))\b/i.test(q)) {
    fields.add('amount');
  }
  if (/\b(?:pendaftaran|daftar|formulir|registrasi)\b/i.test(q) && (domain === 'fee' || intent === 'ask_fee' || /\b(?:biaya|uang|tarif|(?:pem)?bayar(?:an)?|\d+\s*(?:ribu|rb|jt|juta)|va|virtual\s+account)\b/i.test(q))) {
    fields.add('registrationFee');
    fields.add('feeComponent');
    fields.add('amount');
  }
  const isGeographicDestination = /\b(?:negara\b.*?\b(?:tujuan|mitra|partner|destinasi)|(?:tujuan|mitra|partner|destinasi)\b.*?\bnegara|ke\s+negara\s+mana|negara\s+mana)\b/i.test(q);
  const isExplicitDocumentPurpose = /\b(?:tujuan\s+(?:dokumen|surat|form(?:ulir)?|pedoman|laporan|sk)|fungsi\s+(?:dokumen|surat|form(?:ulir)?|pedoman|laporan)|dokumen\s+ini\s+untuk\s+apa|maksud\s+formulir|kegunaan\s+(?:surat|form|pedoman))\b/i.test(q);
  if (isGeographicDestination) {
    fields.add('studyLocation');
    fields.add('country');
    fields.add('destinationCountry');
  }
  if (/\b(?:dokumen\s+apa|formulir\s+apa|surat\s+apa|buat\s+apa|buat\s+laporan|dipakai|digunakan|laporan\s+apa|untuk\s+apa|fungsi(?:nya)?|tujuan(?:nya)?|definisi|pengertian)\b/i.test(q)) {
    if (!isGeographicDestination || isExplicitDocumentPurpose) {
      fields.add('documentPurpose');
      fields.add('purpose');
    }
  }
  if (isGeographicDestination && !isExplicitDocumentPurpose) {
    fields.delete('documentPurpose');
    fields.delete('purpose');
  }
  if (/\b(?:daftar\s+pustaka|referensi|ieee|apa\s+style|harvard|sitasi|format\s+penulisan|gaya\s+penulisan)\b/i.test(q)) {
    fields.add('bibliographyStandard');
  }
  if (/\b(?:sk\s+mendiknas|surat\s+keputusan|izin\s+operasional|nomor\s+sk|no\.?\s*sk)\b/i.test(q)) {
    fields.add('legalDocumentNumber');
    fields.add('legalEstablishmentDocument');
  }
  if (/\b(?:mahasiswa\s+(?:asing|internasional)|foreign\s+student|international\s+student|keimigrasian|imigrasi|itas|kitas|sktt|izin\s+(?:belajar|tinggal)|perpanjang(?:an)?\s+izin|visa)\b/i.test(q)) {
    fields.add('foreignStudentImmigration');
    if (/\b(?:sktt|domisili|tempat\s+tinggal|dokumen\s+domisili|surat\s+domisili)\b/i.test(q)) {
      fields.add('sktt');
      fields.add('document');
      fields.add('domicileDocument');
    }
  }
  if (domain === 'foreign_student_admin' || domain === 'international_admin') {
    fields.add('foreignStudentImmigration');
    if (relationType === 'permit_timeline' || /\b(?:berapa\s+lama|durasi|lama|waktu|proses|pengajuan)\b/i.test(q)) {
      fields.add('duration');
      fields.add('sequence');
    }
    if (relationType === 'foreign_documents' || /\b(?:dokumen|syarat|berkas|upload|diupload|unggah|diunggah)\b/i.test(q)) {
      fields.add('requirements');
      fields.add('procedureSteps');
      fields.add('documentUpload');
      fields.add('submission');
    }
    fields.delete('focus');
    fields.delete('curriculumFocus');
    fields.delete('documentPurpose');
    fields.delete('purpose');
  }
  if (/\bdpp\b/i.test(q) && /\bukt\b/i.test(q)) {
    fields.add('feeComponent');
    fields.add('componentDifference');
  }
  if (/\b(?:s1|sarjana)\b/i.test(q) && /\b(?:s2|s\s*2|pascasarjana|magister)\b/i.test(q) && /\b(?:sks|beban\s+studi|semester)\b/i.test(q)) {
    fields.add('creditComparison');
    fields.add('creditCount');
  }
  const COMPARISON_SEMANTICS_SIGNAL = /\b(?:beda|bedanya|perbedaan|banding|bandingkan|dibanding(?:kan)?|versus|vs|mana\s+yang|apakah\s+sama|sama\s+dengan)\b/i;
  if (COMPARISON_SEMANTICS_SIGNAL.test(q) && /\b(?:jurusan|prodi|program\s+studi)\b/i.test(q) && /\b(?:organisasi|himpunan|himaprodi)\b/i.test(q)) {
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
  if (classification.intent.primary === 'ask_fee_comparison') additions.push('perbandingan rincian biaya kuliah UKT semester semua prodi program studi');
  if (classification.intent.primary === 'ask_program_curriculum') additions.push('kurikulum');
  if (classification.intent.primary === 'ask_program_definition') additions.push('definisi program studi');
  if (classification.intent.primary === 'ask_organization_count') additions.push('jumlah UKM Ormawa organisasi mahasiswa');
  if (classification.intent.primary === 'ask_organization_list') additions.push('daftar UKM Ormawa organisasi mahasiswa');
  if (classification.constraints && classification.constraints.organizationCategory) additions.push('kategori minat organisasi UKM ' + classification.constraints.organizationCategory.label);
  if (classification.intent.primary === 'ask_campus_count') additions.push('jumlah lokasi kampus ITB STIKOM Bali Denpasar Jimbaran Abiansemal');
  if (classification.constraints && classification.constraints.curriculumTopic) additions.push('topik kurikulum ' + classification.constraints.curriculumTopic.label);
  if (classification.intent.primary === 'ask_relation_pairing') additions.push('Double Degree UTB DKV Bisnis Digital pasangan prodi');
  if (classification.domain.primary === 'institution_profile' || classification.intent.primary === 'ask_institution_history') {
    additions.push('profil institusi ITB STIKOM Bali');
    if (classification.intent.primary === 'ask_institution_history' || /\b(?:sejarah|berdiri|didirikan|awal|latar\s*belakang)\b/i.test(normalizedQuery)) {
      additions.push('sejarah pendirian kampus yayasan pendiri');
    }
    if (/\b(?:visi|misi)\b/i.test(normalizedQuery)) {
      additions.push('visi misi');
    }
    if (/\b(?:rektor|pimpinan|pejabat|ketua)\b/i.test(normalizedQuery)) {
      additions.push('rektor pimpinan pejabat');
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
  if (classification.intent.primary === 'ask_facility_profile' || classification.intent.primary === 'ask_facility_vision_mission') additions.push('profil fasilitas sarana prasarana kampus');
  if (classification.intent.primary === 'ask_registration_how' || classification.intent.primary === 'ask_registration_requirements') additions.push('pendaftaran syarat persyaratan dokumen PMB mahasiswa baru');
  if (classification.intent.primary === 'ask_facility_list') additions.push('fasilitas');
  if (classification.constraints.academicTopic) additions.push(classification.constraints.academicTopic.replace(/_/g, ' '));
  if (classification.intent.primary && classification.intent.primary !== 'ask_general') additions.push(classification.intent.primary);
  return [normalizedQuery, ...additions].filter(Boolean).join(' ').replace(/\s{2,}/g, ' ').trim();
}

function canonicalIdentityKey(value) {
  return String(value || '').toLowerCase().replace(/^s[123]\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function applyExplicitEntityCorrection(rawQuery, entities, options = {}) {
  const normalized = normalizeUserQuery(rawQuery || '').normalizedText || String(rawQuery || '').toLowerCase();
  let targetText = '';
  const correctionFirst = normalized.match(/\b(?:maksud\s+saya|maksudnya|yang\s+benar)\s+(.+?)(?:\s*,?\s*bukan\s+.+)?$/i);
  const rejectionFirst = normalized.match(/\bbukan\s+.+?[,;]?\s*(?:maksud\s+saya|maksudnya|tapi|melainkan)\s+(.+)$/i);
  const notAskingFirst = normalized.match(/\b(?:tidak\s+(?:menanyakan|tanya|nanya|minta|cari|bahas)|bukan(?:\s+menanyakan|\s+tanya|\s+nanya|\s+soal|\s+tentang)?)\s+.+?[,;\s]+(?:saya\s+(?:menanyakan|tanya|nanya|minta|cari)|yang\s+saya\s+(?:tanyakan|tanya|maksud)|melainkan|tetapi|tapi|maksud\s+saya)\s+(.+)$/i);
  const protestFirst = normalized.match(/\bkok\s+(?:malah\s+|jadi\s+)?[^,?.!]+[?,.;\s]+(?:padahal\s+)?(?:saya\s+(?:menanyakan|tanya|nanya|minta|cari)|yang\s+saya\s+(?:tanyakan|tanya|maksud)|maksud\s+saya)\s+(.+)$/i);
  const askingFirstNotSecond = normalized.match(/\b(?:yang\s+saya\s+(?:tanyakan|tanya|nanya|maksud|cari|minta)|saya\s+(?:menanyakan|tanya|nanya|maksud|cari|minta))\s+(.+?)\s*,?\s*bukan(?:\s+menanyakan|\s+tanya|\s+nanya|\s+soal|\s+tentang)?\s+(.+)$/i);
  if (rejectionFirst && rejectionFirst[1]) targetText = rejectionFirst[1];
  else if (notAskingFirst && notAskingFirst[1]) targetText = notAskingFirst[1];
  else if (protestFirst && protestFirst[1]) targetText = protestFirst[1];
  else if (askingFirstNotSecond && askingFirstNotSecond[1]) targetText = askingFirstNotSecond[1];
  else if (correctionFirst && correctionFirst[1]) targetText = correctionFirst[1];
  if (!targetText) return;

  const targetMatches = matchCanonicalEntities(targetText);
  const targetPrograms = resolveProgramEntities(targetText, options);
  const desired = new Set([
    ...targetMatches.map(item => canonicalIdentityKey(item.canonical)),
    ...targetPrograms.map(item => canonicalIdentityKey(item.canonical))
  ]);
  const familyGroups = ['programs', 'campuses', 'facilities', 'organizations', 'internationalPrograms', 'services', 'scholarships', 'admissionTracks', 'participantScopes', 'academicScopes'];
  if (!desired.size) {
    if (notAskingFirst || protestFirst || rejectionFirst || askingFirstNotSecond) {
      for (const group of familyGroups) {
        if (Array.isArray(entities[group]) && entities[group].length) {
          entities[group].splice(0, entities[group].length);
        }
      }
    }
    return;
  }

  for (const group of familyGroups) {
    if (!Array.isArray(entities[group]) || !entities[group].length) continue;
    const selected = entities[group].filter(item => desired.has(canonicalIdentityKey(item.canonical)));
    if (selected.length) {
      entities[group].splice(0, entities[group].length, ...selected.map(item => ({ ...item, source: 'explicit-correction' })));
    } else if (notAskingFirst || protestFirst || rejectionFirst || askingFirstNotSecond) {
      entities[group].splice(0, entities[group].length);
    }
  }
}

function extractPriorContextForSlotFollowup(options = {}, priorState = null) {
  const rawSource = (options && (options.priorSession || options.priorSessionOrState || options.session || options.sessionState || options.sessionData || options.conversationState || options.priorContext)) || options || {};
  const stable = rawSource.stableSemanticContext || (rawSource.sessionData && rawSource.sessionData.stableSemanticContext) || null;
  const lastContract = rawSource.lastSemanticContract || (rawSource.sessionData && rawSource.sessionData.lastSemanticContract) || null;
  const convState = priorState || (rawSource.conversationState ? normalizeConversationState(rawSource) : null);

  let domain = String(
    (convState && convState.activeDomain && convState.activeDomain !== 'general' ? convState.activeDomain : '')
    || (stable && stable.domain)
    || (lastContract && lastContract.domain)
    || rawSource.activeDomain
    || rawSource.domain
    || rawSource.primaryDomain
    || ''
  ).trim();

  let entityObj = (convState && convState.activeEntity)
    || (stable && stable.entity)
    || (lastContract && Array.isArray(lastContract.entities) && lastContract.entities[0])
    || rawSource.activeEntity
    || rawSource.entity
    || null;
  if (typeof entityObj === 'string' && entityObj.trim()) {
    const eStr = entityObj.trim();
    if (/^wisuda$/i.test(eStr)) {
      entityObj = { canonical: 'Wisuda', type: 'academic_event', role: 'academic_scope', group: 'academicScopes', confidence: 0.9, source: 'inherited-academic-slot' };
    } else if (/^yudisium$/i.test(eStr)) {
      entityObj = { canonical: 'Yudisium', type: 'academic_event', role: 'academic_scope', group: 'academicScopes', confidence: 0.9, source: 'inherited-academic-slot' };
    } else {
      entityObj = { canonical: eStr, type: 'academic_scope', role: 'academic_scope', group: 'academicScopes', confidence: 0.85, source: 'inherited-slot' };
    }
  }
  if (!domain && entityObj && /^(?:wisuda|yudisium)$/i.test(String(entityObj.canonical || ''))) {
    domain = 'academic';
  }

  const academicScheduleType = String(
    (stable && stable.academicScheduleType)
    || (lastContract && lastContract.constraints && lastContract.constraints.academicScheduleType)
    || (convState && convState.constraints && convState.constraints.academicScheduleType)
    || rawSource.academicScheduleType
    || (rawSource.constraints && rawSource.constraints.academicScheduleType)
    || ''
  ).trim() || null;

  const academicTopic = String(
    (stable && stable.academicTopic)
    || (lastContract && lastContract.constraints && lastContract.constraints.academicTopic)
    || rawSource.academicTopic
    || (rawSource.topic === 'schedule' && domain === 'academic' ? 'academic_schedule' : '')
    || ''
  ).trim() || null;

  const sourceDocument = (stable && stable.sourceDocument)
    || (lastContract && lastContract.constraints && lastContract.constraints.sourceDocument)
    || rawSource.sourceDocument
    || null;

  const academicPeriod = (stable && stable.academicPeriod)
    || (lastContract && lastContract.constraints && lastContract.constraints.academicPeriod)
    || rawSource.academicPeriod
    || null;

  return {
    domain: domain || null,
    intent: (convState && convState.activeIntent) || (lastContract && lastContract.intent) || rawSource.activeIntent || rawSource.intent || null,
    entity: entityObj,
    academicScheduleType,
    academicTopic,
    sourceDocument,
    academicPeriod
  };
}

function hasAllProgramsScope(text = '') {
  const q = normalizeSlangTokens(String(text || '').toLowerCase());
  return /\b(?:semua|seluruh|masing\s*-?\s*masing|setiap|tiap|antar)\s+(?:prodi|program\s+studi|jurusan)\b/i.test(q)
    || /\b(?:prodi|program\s+studi|jurusan)\s+(?:yang\s+ada(?:\s+di\s+(?:itb\s+)?stikom(?:\s+bali)?)?|di\s+(?:itb\s+)?stikom(?:\s+bali)?)\b/i.test(q);
}

function isComparativeFollowupEllipsis(text = '') {
  const q = normalizeSlangTokens(String(text || '').toLowerCase());
  return /\b(?:beda(?:nya)?|perbedaan(?:nya)?|banding(?:kan)?|dibanding(?:kan)?|perbandingan)\s+(?:dengan|sama)\b/i.test(q)
    || /^\s*(?:kalau|kalo|lalu|terus|nah|jadi)?\s*(?:apa\s+)?(?:beda(?:nya)?|perbedaan(?:nya)?|banding(?:kan)?)\s+(?:dengan|sama)\b/i.test(q);
}

function isProfileInsufficientForRecommendation(text = '') {
  const q = normalizeSlangTokens(String(text || '').toLowerCase());
  const hasSchoolOriginBackground = /\b(?:berasal\s+dari|lulusan|dari|asal(?:\s+sekolah)?|anak|jurusan\s+sekolah)\s+(?:smk|sma|ma|stm|paket\s*c)\b/i.test(q)
    || /\b(?:smk|sma|ma)\s+(?:bidang|jurusan)?\s*(?:komputer|tkj|rpl|rekayasa\s+perangkat\s+lunak|multimedia|dkv|ipa|ips|bahasa|akuntansi|perkantoran|bisnis|teknik|informatika|jaringan)\b/i.test(q);
  const hasSpecificInterestPreference = /\b(?:suka|minat|hobi|hobby|tertarik|fokus|ingin\s+(?:jadi|menjadi|bekerja|kerja|belajar|fokus|mendalami)|mau\s+(?:jadi|menjadi|bekerja|kerja|belajar|fokus|mendalami)|pengen\s+(?:jadi|menjadi|bekerja|kerja|belajar|fokus)|cita\s*-?\s*cita|target\s+kerja|arah\s+karier|arah\s+karir)\b/i.test(q)
    || (!hasSchoolOriginBackground && /\b(?:pemasaran|marketing|digital\s+marketing|bisnis|jualan|usaha|data|analis|analyst|programmer|developer|software|coding|ngoding|desain|multimedia|jaringan|network|cyber|keamanan|hardware|iot|robotik|akuntansi)\b/i.test(q));
  const asksProgramSuitabilityOrGuidance = /\b(?:prodi|program\s+studi|jurusan)\s+(?:apa\s+)?(?:yang\s+)?(?:paling\s+)?(?:cocok|sesuai|tepat|rekomendasi|disarankan|bagus)\b/i.test(q)
    || /\b(?:cocok(?:nya)?|sesuai|tepat|rekomendasi|saran|bingung\s+(?:pilih|milih)|pilih|ambil)\s+(?:prodi|program\s+studi|jurusan)\b/i.test(q);
  return Boolean(hasSchoolOriginBackground && asksProgramSuitabilityOrGuidance && !hasSpecificInterestPreference);
}

function resolvePriorProgramAnchorForComparison(options = {}, priorState = null, priorSlotCtx = null) {
  const rawSource = (options && (options.priorSession || options.priorSessionOrState || options.session || options.sessionState || options.sessionData || options.conversationState || options.priorContext)) || options || {};
  if (priorState && (priorState.isVerified === false || priorState.promotable === false || priorState.legacyUnverified)) return null;
  if (priorState && priorState.updatedAt) {
    const updatedAt = Date.parse(priorState.updatedAt);
    if (Number.isFinite(updatedAt) && Date.now() - updatedAt > 30 * 60 * 1000) return null;
  }
  const candidateStrings = [];
  const pushCandidate = (val) => {
    if (!val) return;
    if (typeof val === 'string' && val.trim()) candidateStrings.push(val.trim());
    else if (typeof val === 'object' && val.canonical) candidateStrings.push(String(val.canonical).trim());
  };
  if (priorState && priorState.activeEntity) pushCandidate(priorState.activeEntity);
  if (priorSlotCtx && priorSlotCtx.entity) pushCandidate(priorSlotCtx.entity);
  if (rawSource.activeEntity) pushCandidate(rawSource.activeEntity);
  if (rawSource.lastProgramHint) pushCandidate(rawSource.lastProgramHint);
  if (rawSource.sessionData && rawSource.sessionData.lastProgramHint) pushCandidate(rawSource.sessionData.lastProgramHint);
  if (Array.isArray(rawSource.programs)) rawSource.programs.forEach(pushCandidate);
  if (rawSource.sessionData && Array.isArray(rawSource.sessionData.programs)) rawSource.sessionData.programs.forEach(pushCandidate);
  if (rawSource.lastSemanticContract && Array.isArray(rawSource.lastSemanticContract.entities)) {
    rawSource.lastSemanticContract.entities.filter(e => e && (e.type === 'program' || e.group === 'programs')).forEach(pushCandidate);
  }
  if (rawSource.sessionData && rawSource.sessionData.lastSemanticContract && Array.isArray(rawSource.sessionData.lastSemanticContract.entities)) {
    rawSource.sessionData.lastSemanticContract.entities.filter(e => e && (e.type === 'program' || e.group === 'programs')).forEach(pushCandidate);
  }

  for (const cand of candidateStrings) {
    const resolved = resolveProgramEntities(cand, { hasExplicitProgramSemantics: true });
    if (resolved && resolved.length === 1) {
      return { ...resolved[0], source: 'inherited-comparison-anchor', confidence: 0.86 };
    }
  }
  return null;
}

function inheritCompatibleEntityIntoCanonical(entities, classification, priorState) {
  const priorEntity = priorState && priorState.activeEntity;
  if (!priorEntity || !priorEntity.canonical || priorState.isVerified === false || priorState.promotable === false) return;
  if (classification && classification.constraints && classification.constraints.isMetaAcknowledgement) return;
  const updatedAt = Date.parse(priorState.updatedAt || '');
  if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > 30 * 60 * 1000) return;
  const groups = ['programs', 'campuses', 'facilities', 'organizations', 'internationalPrograms', 'services', 'scholarships', 'admissionTracks', 'participantScopes', 'academicScopes'];
  const hasExplicitNamedEntity = groups.some(group => Array.isArray(entities[group]) && entities[group].some(item => !/^(?:canonical-domain-scope|canonical-interest-registry)$/.test(String(item && item.source || ''))));
  if (hasExplicitNamedEntity) return;

  const domain = String(classification && classification.domain && classification.domain.primary || 'general');
  const academicTopic = String(classification && classification.constraints && classification.constraints.academicTopic || '');
  const type = String(priorEntity.type || '').toLowerCase();
  const priorGroup = String(priorEntity.group || '');
  const family = normalizeEntityFamily(priorEntity.family || type);
  const isAcademicEventOrSchedule = domain === 'academic' && (
    academicTopic === 'academic_schedule'
    || academicTopic === 'academic_procedure'
    || academicTopic === 'academic_advising'
    || academicTopic === 'online_learning_platform'
    || academicTopic === 'faculty_program_mapping'
    || Boolean(classification && classification.constraints && classification.constraints.isProtestOrCorrection)
  );
  const compatible = (family === 'admission_track' && /^(?:registration|pmb_requirements|academic_policy|fee)$/.test(domain))
    || (family === 'program' && !isAcademicEventOrSchedule && /^(?:program|program_curriculum|career|fee|academic|academic_policy|accreditation|s2_postgraduate)$/.test(domain))
    || (family === 'organization' && domain === 'student_organization')
    || (family === 'facility' && /^(?:campus_facility|campus_service)$/.test(domain))
    || (family === 'campus_service' && /^(?:campus_service|campus_facility|career)$/.test(domain))
    || (family === 'international_program' && /^(?:international_program|double_degree)$/.test(domain))
    || (family === 'scholarship' && domain === 'scholarship')
    || (family === 'participant_scope' && /^(?:foreign_student_admin|international_admin|pmb_requirements|registration|academic_policy)$/.test(domain))
    || (family === 'academic_scope' && /^(?:academic_policy|academic|program_curriculum|program|fee)$/.test(domain));
  if (!compatible) return;

  const group = groups.includes(priorGroup) ? priorGroup
    : (family === 'admission_track' ? 'admissionTracks'
      : (family === 'program' ? 'programs'
        : (family === 'organization' ? 'organizations'
          : (family === 'facility' ? 'facilities'
            : (family === 'campus_service' ? 'services'
              : (family === 'international_program' ? 'internationalPrograms'
                : (family === 'scholarship' ? 'scholarships'
                  : (family === 'academic_scope' ? 'academicScopes' : 'participantScopes'))))))));
  if (!Array.isArray(entities[group])) entities[group] = [];
  entities[group].push({ ...priorEntity, group, confidence: Math.min(0.8, Number(priorEntity.confidence || 0.8)), source: 'compatible-inherited-entity' });
}

function buildCanonicalQueryUnderstanding(rawQuery, options = {}) {
  const raw = String(rawQuery || '');
  const normalizedInfo = options.normalizedQuery
    ? { normalizedText: String(options.normalizedQuery), changed: String(options.normalizedQuery) !== raw }
    : normalizeUserQuery(raw);
  const normalizedQuery = normalizedInfo && normalizedInfo.normalizedText ? normalizedInfo.normalizedText : raw.toLowerCase();
  const negativeSemantics = extractNegativeSemantics(raw);
  const positiveRaw = stripNegatedSpansFromQuery(raw, negativeSemantics);
  const positiveNormalized = stripNegatedSpansFromQuery(normalizedQuery, negativeSemantics);
  const temporal = buildTemporalUnderstanding(positiveRaw);
  const programEntities = resolveProgramEntities(`${positiveRaw} ${positiveNormalized}`, options);
  const sourceEntities = resolveSourceDomainEntities(positiveRaw);
  const unsupportedProgramEntities = (sourceEntities.admissionTracks && sourceEntities.admissionTracks.length)
    || (sourceEntities.internationalPrograms && sourceEntities.internationalPrograms.length)
    ? []
    : resolveUnsupportedProgramEntities(positiveRaw, programEntities);
  const unsupportedFacilityEntities = resolveUnsupportedFacilityEntities(positiveRaw, sourceEntities, programEntities);
  const allUnsupportedEntities = [...unsupportedProgramEntities, ...unsupportedFacilityEntities];
  const entities = {
    programs: programEntities,
    campuses: sourceEntities.campuses || [],
    facilities: sourceEntities.facilities,
    organizations: sourceEntities.organizations,
    people: [],
    documents: sourceEntities.documents,
    internationalPrograms: sourceEntities.internationalPrograms,
    services: sourceEntities.services || [],
    scholarships: sourceEntities.scholarships || [],
    admissionTracks: sourceEntities.admissionTracks || [],
    participantScopes: sourceEntities.participantScopes || [],
    academicScopes: sourceEntities.academicScopes || [],
    interestProfiles: sourceEntities.interestProfiles || [],
    unsupported: allUnsupportedEntities,
    unknown: []
  };
  applyExplicitEntityCorrection(raw, entities, options);
  const classification = classifyIntentDomain(raw, normalizedQuery, entities, temporal, options);
  if (!(classification.domain && classification.domain.primary === 'student_organization')) entities.interestProfiles = [];
  if (classification.constraints) {
    classification.constraints.interestProfiles = (entities.interestProfiles || []).map(profile => ({ key: profile.key, label: profile.label, matchedTerms: profile.matchedTerms || [] }));
  }
  if (classification.domain && classification.domain.primary === 'academic_policy' && !(entities.admissionTracks || []).length && !(entities.academicScopes || []).length) {
    entities.academicScopes.push({ canonical: 'Kebijakan Akademik (Academic Policy)', type: 'academic_scope', role: 'academic_policy', confidence: 0.82, source: 'canonical-domain-scope' });
  }
  if (allUnsupportedEntities[0]) {
    classification.constraints.unsupportedEntityCandidate = {
      type: allUnsupportedEntities[0].type,
      canonical: allUnsupportedEntities[0].canonical,
      surface: allUnsupportedEntities[0].surface,
      role: allUnsupportedEntities[0].role,
      source: allUnsupportedEntities[0].source
    };
  }
  const priorSession = options.priorSession || options.priorSessionOrState || options.session || options.sessionState || options.sessionData || null;
  const priorState = priorSession ? normalizeConversationState(priorSession) : (options && (options.activeDomain || options.domain || options.conversationState || options.stableSemanticContext || options.lastSemanticContract) ? normalizeConversationState(options) : null);
  const priorSlotCtx = extractPriorContextForSlotFollowup(options, priorState);
  const hasFreshPriorAuthority = Boolean(
    priorState
    && isConversationStateFresh(priorState)
    && priorState.isVerified !== false
    && priorState.promotable !== false
    && !priorState.legacyUnverified
  );

  // Comparative follow-up anchor inheritance (e.g., "apa bedanya dengan sistem informasi dan sistem komputer?" after TI context)
  if (classification.constraints && classification.constraints.isComparativeFollowupEllipsis && Array.isArray(entities.programs) && entities.programs.length >= 1 && entities.programs.length <= 2) {
    const inheritedProgramAnchor = resolvePriorProgramAnchorForComparison(options, hasFreshPriorAuthority ? priorState : null, priorSlotCtx);
    if (inheritedProgramAnchor && inheritedProgramAnchor.canonical) {
      const alreadyIncluded = entities.programs.some(p => canonicalIdentityKey(p.canonical) === canonicalIdentityKey(inheritedProgramAnchor.canonical));
      if (!alreadyIncluded) {
        entities.programs.unshift(inheritedProgramAnchor);
        classification.constraints.inheritedComparisonAnchor = inheritedProgramAnchor.canonical;
      }
      if (entities.programs.length >= 2 && classification.domain.primary !== 'fee') {
        classification.intent = { primary: 'ask_program_comparison', secondary: [], confidence: 0.9 };
        classification.domain = { primary: 'program_comparison', confidence: 0.9 };
        classification.questionType = 'comparison';
        classification.answerExpectation = 'comparison';
        classification.constraints.comparisonTarget = 'program';
        classification.constraints.comparisonScope = 'explicit_entities';
      }
    }
  }

  const isAcademicScheduleSubtypeSwitch = (priorSlotCtx.domain === 'academic' || priorSlotCtx.domain === 'academic_policy')
    && !entities.programs.length
    && !entities.academicScopes.length
    && /\b(?:pelaksanaan(?:nya)?|dilaksanakan|acara(?:nya)?|batas\s+pendaftaran|pendaftaran(?:nya)?)\b/i.test(positiveNormalized);

  if (((classification.constraints && classification.constraints.isBareSlotFollowup) || isAcademicScheduleSubtypeSwitch) && priorSlotCtx.domain) {
    if (priorSlotCtx.domain === 'academic' || priorSlotCtx.domain === 'academic_policy') {
      const explicitExec = /\b(?:pelaksanaan(?:nya)?|dilaksanakan|acara(?:nya)?)\b/i.test(positiveNormalized)
        && !/\b(?:pendaftaran|daftar|registrasi|batas|terakhir|paling\s+lambat|sampai\s+kapan)\b/i.test(positiveNormalized);
      const explicitReg = /\b(?:pendaftaran|daftar|registrasi|batas|terakhir|paling\s+lambat|sampai\s+kapan)\b/i.test(positiveNormalized)
        && !explicitExec;
      classification.domain = { primary: 'academic', confidence: 0.88 };
      classification.intent = { primary: 'ask_academic_schedule', secondary: [], confidence: 0.88 };
      classification.questionType = 'schedule';
      classification.answerExpectation = classification.constraints.requestedSlot === 'place' ? 'location' : 'date_or_period';
      classification.constraints.academicTopic = priorSlotCtx.academicTopic || 'academic_schedule';
      classification.constraints.academicScheduleType = explicitExec
        ? 'event_execution'
        : (explicitReg ? 'registration_deadline' : (priorSlotCtx.academicScheduleType || 'event_execution'));
      if (priorSlotCtx.sourceDocument) classification.constraints.sourceDocument = priorSlotCtx.sourceDocument;
      if (priorSlotCtx.academicPeriod) classification.constraints.academicPeriod = priorSlotCtx.academicPeriod;
      if (priorSlotCtx.entity && priorSlotCtx.entity.canonical && !/program|double_degree|international/i.test(String(priorSlotCtx.entity.type || priorSlotCtx.entity.family || ''))) {
        const canonicalName = priorSlotCtx.entity.canonical;
        if (!entities.academicScopes.some(e => String(e.canonical || '').toLowerCase() === String(canonicalName).toLowerCase())) {
          entities.academicScopes.push({
            canonical: canonicalName,
            type: priorSlotCtx.entity.type || 'academic_event',
            role: priorSlotCtx.entity.role || 'academic_scope',
            group: 'academicScopes',
            confidence: 0.88,
            source: 'inherited-academic-slot'
          });
        }
      }
    } else if (priorSlotCtx.domain === 'pmb_schedule') {
      classification.domain = { primary: 'pmb_schedule', confidence: 0.86 };
      classification.intent = { primary: 'ask_schedule', secondary: [], confidence: 0.86 };
      classification.questionType = 'schedule';
      classification.answerExpectation = 'date_or_period';
    }
  }
  const isSecurityOrSystemProbe = /\b(?:debug\s+mode|system\s+instructions?|system\s+prompt|hidden\s+instructions?|internal\s+instructions?|environment\s+variables?|env\s+vars?|process\.env|state\s+your\s+name|your\s+name\s+and\s+version|ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions?|developer\s+mode|jailbreak)\b/i.test(raw);
  if (isSecurityOrSystemProbe) {
    classification.domain = { primary: 'general', confidence: 0.95 };
    classification.intent = { primary: 'ask_general', secondary: [], confidence: 0.95 };
    classification.constraints.isSecurityProbe = true;
  } else if (hasFreshPriorAuthority && priorState.activeDomain && priorState.activeDomain !== 'general' && !(classification.constraints && classification.constraints.isMetaAcknowledgement)) {
    if (classification.domain && classification.domain.primary === 'general') {
      const hasCampusSignal = (entities.campuses && entities.campuses.length > 0)
        || /\b(?:kampus|cabang|lokasi|alamat|renon|jimbaran|abiansemal|fasilitas)\b/i.test(normalizedQuery);
      const isRequirementsOrProcedure = /\b(?:syarat|persyaratan|dokumen|berkas|cara|alur|prosedur|biaya|kapan|jadwal|kelas|sabtu|malam|kerja|kuliah|berapa\s+tahun|skema)\b/i.test(normalizedQuery);
      const isEllipticalFollowUp = !hasCampusSignal && (isRequirementsOrProcedure || /^(?:kalau|kalo|bagaimana|gimana|lalu|terus|dan|apakah|bisa|boleh)?\s*(?:[a-z0-9.-]+(?:\s+[a-z0-9.-]+){0,10})\??$/i.test(normalizedQuery.trim()));
      if (isEllipticalFollowUp) {
        classification.domain = { primary: priorState.activeDomain, confidence: 0.82 };
        if (priorState.activeDomain === 's2_postgraduate' && /\b(?:kelas|sabtu|malam|jadwal|waktu)\b/i.test(normalizedQuery)) {
          classification.intent = { primary: 'ask_availability', secondary: [], confidence: 0.82 };
          classification.constraints.relationType = 'study_schedule';
        } else if (priorState.activeDomain === 'international_program' && /\b(?:kerja|karier|karir|peluang\s+kerja)\b/i.test(normalizedQuery)) {
          classification.intent = { primary: 'ask_career_service', secondary: [], confidence: 0.82 };
          classification.constraints.relationType = 'career_in_japan';
        } else if (priorState.activeDomain === 'double_degree' && /\b(?:skema|tahun|berapa\s+tahun|bali|malaysia|china|dnui|help)\b/i.test(normalizedQuery)) {
          classification.intent = { primary: 'ask_schedule', secondary: [], confidence: 0.82 };
          classification.constraints.relationType = 'study_timeline';
        } else if (isRequirementsOrProcedure) {
          if (/\b(?:syarat|persyaratan|dokumen|berkas)\b/i.test(normalizedQuery)) {
            classification.intent = { primary: 'ask_registration_requirements', secondary: [], confidence: 0.82 };
          } else if (/\b(?:cara|alur|prosedur)\b/i.test(normalizedQuery)) {
            classification.intent = { primary: 'ask_registration_how', secondary: [], confidence: 0.82 };
          }
        } else if (priorState.activeIntent && priorState.activeIntent !== 'ask_general') {
          classification.intent = { primary: priorState.activeIntent, secondary: [], confidence: 0.82 };
        }
      }
    } else if (classification.domain && classification.domain.primary === 'registration' && (priorState.activeDomain === 'international_program' || priorState.activeDomain === 'double_degree')) {
      if (!/\b(?:pmb|camaba|mahasiswa\s+baru)\b/i.test(normalizedQuery)) {
        classification.domain = { primary: priorState.activeDomain, confidence: 0.82 };
      }
    }
  }
  if (!isSecurityOrSystemProbe) {
    inheritCompatibleEntityIntoCanonical(entities, classification, hasFreshPriorAuthority ? priorState : null);
  }
  let requestedFields = extractRequestedFields(raw, normalizedQuery, classification);
  const activeRequestedSlot = classification.constraints && classification.constraints.requestedSlot;
  const activeCareerTopic = classification.constraints && classification.constraints.careerTopic;
  const hasExplicitCareerSubtopicChange = activeCareerTopic === 'contact' || activeCareerTopic === 'work_while_studying';
  if (hasFreshPriorAuthority && Array.isArray(priorState.requestedFields) && priorState.requestedFields.length > 0 && !activeRequestedSlot && !hasExplicitCareerSubtopicChange) {
    if (classification.domain && classification.domain.primary === priorState.activeDomain) {
      const compatiblePriorFields = filterCompatibleFields(
        priorState.requestedFields,
        classification.domain.primary,
        null
      );
      for (const f of compatiblePriorFields) {
        if (!requestedFields.includes(f)) requestedFields.push(f);
      }
    }
  }
  if (classification.intent && classification.intent.primary === 'ask_general' && classification.answerExpectation === 'topic_opening') {
    requestedFields = requestedFields.filter(field => field !== 'procedureSteps');
  }
  if (classification.intent && (classification.intent.primary === 'ask_program_comparison' || classification.intent.primary === 'ask_fee_comparison')) {
    if (!requestedFields.includes('comparison')) requestedFields.push('comparison');
    const compEntities = classification.constraints.comparisonScope === 'all_programs'
      ? PROGRAMS.map(p => p.canonical)
      : (entities.programs || []).map(p => p.canonical).filter(Boolean);
    classification.constraints.comparisonEntities = compEntities;
    classification.constraints.comparisonFields = classification.intent.primary === 'ask_fee_comparison'
      ? (classification.constraints.requestedField
        ? [classification.constraints.requestedField]
        : requestedFields.filter(f => ['semester_fee', 'tuitionFee', 'developmentFee', 'registrationFee', 'totalFee', 'amount', 'feeComponent'].includes(f)))
      : ['studyFocus', 'skill', 'careerOutcome'];
  }
  entities.primary = (entities.academicScopes && entities.academicScopes.find(e => e && e.type === 'academic_event'))
    || (entities.programs && entities.programs[0])
    || (entities.internationalPrograms && entities.internationalPrograms[0])
    || (entities.admissionTracks && entities.admissionTracks[0])
    || (entities.scholarships && entities.scholarships[0])
    || (entities.organizations && entities.organizations[0])
    || (entities.services && entities.services[0])
    || (entities.facilities && entities.facilities[0])
    || (entities.campuses && entities.campuses[0])
    || (entities.academicScopes && entities.academicScopes[0])
    || null;
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
    requestedSlot: activeRequestedSlot || null,
    requestedFields,
    ambiguity: classification.ambiguity,
    routingQuery: buildRoutingQuery(normalizedQuery, entities, classification),
    confidence: Math.min(classification.intent.confidence, classification.domain.confidence)
  };
  understanding.contract = buildSemanticContract(understanding);
  return understanding;
}

const KNOWLEDGE_AVAILABILITY = Object.freeze({
  FOUND: 'FOUND',
  NOT_FOUND: 'NOT_FOUND',
  GOVERNANCE_BLOCKED: 'GOVERNANCE_BLOCKED',
  RETRIEVAL_DEFECT: 'RETRIEVAL_DEFECT'
});

function classifyKnowledgeAvailability({ isAnswerable, evidenceFound, governanceBlocked, hasDefect, evidenceChunks, retrievalDefect } = {}) {
  if (governanceBlocked) return KNOWLEDGE_AVAILABILITY.GOVERNANCE_BLOCKED;
  if (hasDefect || retrievalDefect) return KNOWLEDGE_AVAILABILITY.RETRIEVAL_DEFECT;
  const hasEvidence = Boolean(evidenceFound || (Array.isArray(evidenceChunks) && evidenceChunks.length > 0));
  const answerable = isAnswerable !== undefined ? isAnswerable : hasEvidence;
  if (answerable && hasEvidence) return KNOWLEDGE_AVAILABILITY.FOUND;
  return KNOWLEDGE_AVAILABILITY.NOT_FOUND;
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
  detectScholarshipRequestSubtype,
  normalizeSlangTokens,
  hasExplicitProgramSemantics,
  hasPriorProgramContext,
  extractNegativeSemantics,
  detectRequestedSlot,
  isBareSlotFollowupQuery,
  isMetaClosingOrAcknowledgementQuery,
  hasAllProgramsScope,
  isComparativeFollowupEllipsis,
  resolvePriorProgramAnchorForComparison,
  isProfileInsufficientForRecommendation,
  KNOWLEDGE_AVAILABILITY,
  classifyKnowledgeAvailability
};

















