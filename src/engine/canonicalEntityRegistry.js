'use strict';

/**
 * Canonical Entity Registry
 * Centralized registry for institutional entities, canonical names, aliases, and relations.
 */

const CANONICAL_ENTITIES = [
  // Academic Programs
  {
    canonical: 'S1 Sistem Informasi',
    type: 'program',
    family: 'academic_program',
    degree: 'S1',
    aliases: ['sistem informasi', 'si', 's1 si', 's1 sistem informasi', 'prodi si', 'jurusan si', 'sarjana sistem informasi']
  },
  {
    canonical: 'S1 Teknologi Informasi',
    type: 'program',
    family: 'academic_program',
    degree: 'S1',
    aliases: ['teknologi informasi', 'ti', 's1 ti', 's1 teknologi informasi', 'prodi ti', 'jurusan ti', 'sarjana teknologi informasi']
  },
  {
    canonical: 'S1 Bisnis Digital',
    type: 'program',
    family: 'academic_program',
    degree: 'S1',
    aliases: ['bisnis digital', 'bd', 's1 bd', 's1 bisnis digital', 'prodi bd', 'jurusan bd', 'sarjana bisnis digital']
  },
  {
    canonical: 'S1 Sistem Komputer',
    type: 'program',
    family: 'academic_program',
    degree: 'S1',
    aliases: ['sistem komputer', 'sk', 's1 sk', 's1 sistem komputer', 'prodi sk', 'jurusan sk', 'sarjana sistem komputer']
  },
  {
    canonical: 'D3 Manajemen Informatika',
    type: 'program',
    family: 'academic_program',
    degree: 'D3',
    aliases: ['manajemen informatika', 'mi', 'd3 mi', 'd3 manajemen informatika', 'diploma manajemen informatika', 'prodi mi']
  },
  {
    canonical: 'S2 Sistem Informasi',
    type: 'program',
    family: 'academic_program',
    degree: 'S2',
    aliases: ['s2 sistem informasi', 's2 si', 'magister sistem informasi', 'pascasarjana sistem informasi', 'magister si']
  },

  // Student Associations (HIMAPRODI / HIMA)
  {
    canonical: 'HIMAPRODI Teknologi Informasi',
    type: 'student_association',
    family: 'student_organization',
    aliases: [
      'himaprodi teknologi informasi', 'himaprodi ti', 'hima ti', 'himpunan mahasiswa teknologi informasi',
      'himpunan mahasiswa ti', 'himpunan ti', 'hima teknologi informasi'
    ]
  },
  {
    canonical: 'HIMAPRODI Sistem Informasi',
    type: 'student_association',
    family: 'student_organization',
    aliases: [
      'himaprodi sistem informasi', 'himaprodi si', 'hima si', 'himpunan mahasiswa sistem informasi',
      'himpunan mahasiswa si', 'himpunan si', 'hima sistem informasi'
    ]
  },
  {
    canonical: 'HIMAPRODI Bisnis Digital',
    type: 'student_association',
    family: 'student_organization',
    aliases: [
      'himaprodi bisnis digital', 'himaprodi bd', 'hima bd', 'himpunan mahasiswa bisnis digital',
      'himpunan mahasiswa bd', 'himpunan bd', 'hima bisnis digital'
    ]
  },
  {
    canonical: 'HIMAPRODI Sistem Komputer',
    type: 'student_association',
    family: 'student_organization',
    aliases: [
      'himaprodi sistem komputer', 'himaprodi sk', 'hima sk', 'himpunan mahasiswa sistem komputer',
      'himpunan mahasiswa sk', 'himpunan sk', 'hima sistem komputer'
    ]
  },
  {
    canonical: 'HIMAS Jimbaran',
    type: 'student_association',
    family: 'student_organization',
    aliases: ['himas jimbaran', 'himas', 'himpunan mahasiswa jimbaran']
  },

  // Student Governance
  {
    canonical: 'BEM ITB STIKOM Bali',
    type: 'student_governance',
    family: 'student_organization',
    aliases: ['bem', 'bem pm', 'badan eksekutif mahasiswa', 'bem itb stikom bali', 'kemahasiswaan']
  },
  {
    canonical: 'DPM ITB STIKOM Bali',
    type: 'student_governance',
    family: 'student_organization',
    aliases: ['dpm', 'dewan perwakilan mahasiswa', 'dpm itb stikom bali']
  },

  // Student Activity Units (UKM)
  {
    canonical: 'Voice of STIKOM (VOS)',
    type: 'student_activity_unit',
    family: 'student_organization',
    aliases: ['ukm vos', 'vos', 'voice of stikom', 'paduan suara vos']
  },
  {
    canonical: 'UKM KSL',
    type: 'student_activity_unit',
    family: 'student_organization',
    aliases: ['ukm ksl', 'ksl', 'kelompok studi linux']
  },
  {
    canonical: 'UKM MCOS',
    type: 'student_activity_unit',
    family: 'student_organization',
    aliases: ['ukm mcos', 'mcos']
  },
  {
    canonical: 'UKM JCOS',
    type: 'student_activity_unit',
    family: 'student_organization',
    aliases: ['ukm jcos', 'jcos']
  },
  {
    canonical: 'UKM RADE',
    type: 'student_activity_unit',
    family: 'student_organization',
    aliases: ['ukm rade', 'rade']
  },
  {
    canonical: 'UKM Athena Esport',
    type: 'student_activity_unit',
    family: 'student_organization',
    aliases: ['ukm athena', 'athena', 'athena esport', 'esport', 'esports']
  },
  {
    canonical: 'UKM Mapala Kompas',
    type: 'student_activity_unit',
    family: 'student_organization',
    aliases: ['ukm mapala', 'mapala', 'mapala kompas', 'ukm mapala kompas']
  },
  {
    canonical: 'UKM Futsal',
    type: 'student_activity_unit',
    family: 'student_organization',
    aliases: ['ukm futsal', 'futsal']
  },
  {
    canonical: 'UKM Basket',
    type: 'student_activity_unit',
    family: 'student_organization',
    aliases: ['ukm basket', 'basket']
  },
  {
    canonical: 'UKM KMHD',
    type: 'student_activity_unit',
    family: 'student_organization',
    aliases: ['ukm kmhd', 'kmhd', 'kesatuan mahasiswa hindu dharma']
  },
  {
    canonical: 'UKM PMK',
    type: 'student_activity_unit',
    family: 'student_organization',
    aliases: ['ukm pmk', 'pmk', 'persekutuan mahasiswa kristen']
  },
  {
    canonical: 'UKM Teater Biner',
    type: 'student_activity_unit',
    family: 'student_organization',
    aliases: ['ukm teater biner', 'teater biner', 'teater']
  },
  {
    canonical: 'UKM Tabuh Bramara Gita',
    type: 'student_activity_unit',
    family: 'student_organization',
    aliases: ['ukm tabuh', 'tabuh', 'bramara gita', 'ukm bramara gita', 'karawitan', 'gamelan']
  },
  {
    canonical: 'UKM Syntax',
    type: 'student_activity_unit',
    family: 'student_organization',
    aliases: ['ukm syntax', 'syntax', 'synamon']
  },
  {
    canonical: 'UKM DOS',
    type: 'student_activity_unit',
    family: 'student_organization',
    aliases: ['ukm dos', 'dos', 'dance of stikom']
  },
  {
    canonical: 'UKM U2M',
    type: 'student_activity_unit',
    family: 'student_organization',
    aliases: ['ukm u2m', 'u2m', 'unit musik mahasiswa', 'musik']
  },
  {
    canonical: 'UKM Paskamras',
    type: 'student_activity_unit',
    family: 'student_organization',
    aliases: ['ukm paskamras', 'paskamras', 'paskibra']
  },
  {
    canonical: 'UKM Ghost',
    type: 'student_activity_unit',
    family: 'student_organization',
    aliases: ['ukm ghost', 'ghost']
  },
  {
    canonical: 'UKM KSR',
    type: 'student_activity_unit',
    family: 'student_organization',
    aliases: ['ukm ksr', 'ksr', 'korps sukarela', 'pmi']
  },
  {
    canonical: 'UKM Himatography',
    type: 'student_activity_unit',
    family: 'student_organization',
    aliases: ['ukm himatography', 'himatography', 'fotografi']
  },
  {
    canonical: 'UKM MM',
    type: 'student_activity_unit',
    family: 'student_organization',
    aliases: ['ukm mm', 'multimedia', 'ukm multimedia']
  },
  {
    canonical: 'UKM Progress',
    type: 'student_activity_unit',
    family: 'student_organization',
    aliases: ['ukm progress', 'progress']
  },
  {
    canonical: 'UKM Tari PRAGINA',
    type: 'student_activity_unit',
    family: 'student_organization',
    aliases: ['ukm tari pragina', 'tari pragina', 'pragina', 'ukm pragina', 'ukm tari', 'tari', 'tari bali']
  },
  {
    canonical: 'UKM Tabuh (Bramara Gita)',
    type: 'student_activity_unit',
    family: 'student_organization',
    aliases: ['ukm tabuh', 'tabuh', 'bramara gita', 'ukm bramara gita', 'gamelan', 'tabuh bali', 'seni tabuh', 'megambel']
  },
  {
    canonical: 'UKM Robotika (Robotics)',
    type: 'student_activity_unit',
    family: 'student_organization',
    aliases: ['ukm robotika', 'robotika', 'robotics', 'ukm robotics', 'klub robotika', 'komunitas robotika']
  },

  // Campus Facilities
  {
    canonical: 'Laboratorium Komputer',
    type: 'facility',
    family: 'campus_facility',
    aliases: ['lab komputer', 'laboratorium komputer', 'lab praktikum', 'komputer praktik', 'fasilitas komputer']
  },
  {
    canonical: 'Perpustakaan Kampus',
    type: 'facility',
    family: 'campus_facility',
    aliases: ['perpustakaan', 'ruang referensi', 'library', 'perpus', 'perpustakaan digital', 'buku digital', 'e-book', 'ruang baca', 'koleksi perpustakaan']
  },
  {
    canonical: 'Studio Podcast',
    type: 'facility',
    family: 'campus_facility',
    aliases: ['studio podcast', 'studio multimedia', 'podcast', 'ruang multimedia', 'ruang produksi audio', 'studio rekaman', 'audio production']
  },
  {
    canonical: 'Coworking Space',
    type: 'facility',
    family: 'campus_facility',
    aliases: ['coworking space', 'coworking', 'ruang kerja bersama', 'ruang kerja kolaboratif']
  },
  {
    canonical: 'Transportasi Kampus',
    type: 'facility',
    family: 'campus_facility',
    aliases: ['transportasi kampus', 'bus kampus', 'shuttle bus', 'shuttle', 'antar jemput', 'transport antar kampus', 'shuttle antar lokasi']
  },
  {
    canonical: 'Fasilitas Parkir',
    type: 'facility',
    family: 'campus_facility',
    aliases: ['fasilitas parkir', 'parkir', 'parkiran', 'tempat parkir', 'lahan parkir', 'area parkir']
  },
  {
    canonical: 'Inkubator Bisnis (INBIS)',
    type: 'facility',
    family: 'campus_facility',
    aliases: ['inkubator bisnis', 'inbis', 'inbis bali', 'inkubator bisnis stikom bali', 'wadah inkubasi bisnis', 'inkubasi bisnis', 'startup', 'rintisan bisnis', 'wadah inkubasi']
  },
  {
    canonical: 'Program Hi-Think (Magang Jepang)',
    type: 'special_program',
    family: 'campus_facility',
    aliases: ['hi-think', 'hi think', 'hithink', 'program hi-think', 'magang jepang', 'program jepang', 'kerja di jepang']
  },

  // Campuses / Locations
  {
    canonical: 'Kampus Denpasar (Renon)',
    type: 'campus',
    family: 'campus_location',
    aliases: ['kampus renon', 'renon', 'kampus denpasar', 'denpasar', 'kampus pusat', 'pusat', 'jl raya puputan', 'puputan renon']
  },
  {
    canonical: 'Kampus Jimbaran',
    type: 'campus',
    family: 'campus_location',
    aliases: ['kampus jimbaran', 'jimbaran', 'kampus selatan']
  },
  {
    canonical: 'Kampus Abiansemal',
    type: 'campus',
    family: 'campus_location',
    aliases: ['kampus abiansemal', 'abiansemal', 'kampus badung']
  },

  // International Programs & Collaborations
  {
    canonical: 'Double Degree DNUI',
    type: 'international_program',
    role: 'double_degree',
    family: 'international_program',
    scope: 'international',
    country: 'China',
    aliases: ['dnui', 'dalian neusoft', 'dalian', 'double degree dnui', 'dual degree dnui']
  },
  {
    canonical: 'Double Degree HELP University',
    type: 'international_program',
    role: 'double_degree',
    family: 'international_program',
    scope: 'international',
    country: 'Malaysia',
    aliases: ['help university', 'help', 'double degree help', 'dual degree help', 'double degree malaysia', 'dual degree malaysia']
  },
  {
    canonical: 'Dual Degree UTB',
    type: 'international_program',
    role: 'double_degree',
    family: 'international_program',
    scope: 'national',
    country: 'Indonesia',
    aliases: ['utb', 'universitas teknologi bandung', 'dual degree utb', 'double degree utb']
  },
  {
    canonical: 'Student Exchange',
    type: 'international_program',
    family: 'international_program',
    aliases: ['student exchange', 'pertukaran mahasiswa', 'study exchange', 'exchange program']
  },
  {
    canonical: 'Program Hi-Think (Magang Jepang)',
    type: 'special_program',
    family: 'international_program',
    country: 'Japan',
    programKind: 'internship',
    aliases: ['hi-think', 'hi think', 'hithink', 'program hi think', 'program hi-think', 'magang jepang', 'program jepang', 'jepang magang']
  },
  {
    canonical: 'GCCP',
    type: 'international_program',
    family: 'international_program',
    aliases: ['gccp', 'global cloud computing program']
  },
  {
    canonical: 'BCCP',
    type: 'international_program',
    family: 'international_program',
    aliases: ['bccp']
  },

  // Campus Services / Units
  {
    canonical: 'Inkubator Bisnis (INBIS)',
    type: 'campus_service',
    family: 'campus_service',
    aliases: ['inbis', 'inkubator bisnis', 'business incubator', 'inbis stikom']
  },
  {
    canonical: 'Career Development Center (CDC)',
    type: 'campus_service',
    family: 'campus_service',
    aliases: ['cdc', 'career development center', 'career center', 'pusat karier', 'pusat karir']
  },
  {
    canonical: 'Language Learning Center (LLC)',
    type: 'campus_service',
    family: 'campus_service',
    aliases: ['llc', 'language learning center', 'pusat bahasa']
  },
  {
    canonical: 'BAAK',
    type: 'campus_service',
    family: 'campus_service',
    aliases: ['baak', 'biro administrasi akademik dan kemahasiswaan']
  },

  // Semantic scopes and admission tracks identify explicit user subjects.
  // They contain no factual answer or eligibility claim.
  {
    canonical: 'Program Sarjana (S1)',
    type: 'academic_level',
    family: 'academic_scope',
    degree: 'S1',
    aliases: ['s1', 'jenjang s1', 'program s1', 'sarjana', 'sarjana s1']
  },
  {
    canonical: 'Program Magister (S2)',
    type: 'academic_level',
    family: 'academic_scope',
    degree: 'S2',
    aliases: ['s2', 'jenjang s2', 'program s2', 'magister', 'magister s2']
  },
  {
    canonical: 'Program Diploma (D3)',
    type: 'academic_level',
    family: 'academic_scope',
    degree: 'D3',
    aliases: ['d3', 'jenjang d3', 'program d3', 'diploma', 'diploma 3', 'ahli madya']
  },
  {
    canonical: 'RPL (Rekognisi Pembelajaran Lampau)',
    type: 'admission_track',
    family: 'admission_track',
    aliases: ['rpl', 'rekognisi pembelajaran lampau', 'jalur rpl', 'program rpl']
  },
  {
    canonical: 'Mahasiswa Pindahan / Transfer',
    type: 'admission_track',
    family: 'admission_track',
    aliases: ['mahasiswa transfer', 'mahasiswa pindahan', 'jalur transfer', 'jalur pindahan', 'kuliah transfer', 'pindahan', 'transfer']
  },
  {
    canonical: 'Mahasiswa Internasional / Asing (Foreign Student)',
    type: 'participant_scope',
    family: 'participant_scope',
    aliases: ['mahasiswa internasional', 'mahasiswa asing', 'foreign student', 'pelajar internasional', 'pelajar asing']
  },
  {
    canonical: 'Kantor Urusan Internasional (International Office)',
    type: 'facility',
    family: 'campus_facility',
    aliases: ['international office', 'kantor internasional', 'kantor urusan internasional', 'bagian urusan internasional', 'kui']
  },
  {
    canonical: 'Kebijakan Akademik (Academic Policy)',
    type: 'academic_scope',
    family: 'academic_scope',
    aliases: ['akademik', 'kebijakan akademik', 'academic policy', 'aturan akademik', 'pedoman akademik']
  },
  {
    canonical: 'UKM Khusus (Special UKM)',
    type: 'organization_category',
    family: 'student_organization',
    aliases: ['special ukm', 'ukm khusus', 'organisasi khusus', 'bidang khusus', 'pecinta alam atau kepalangmerahan', 'kepalangmerahan atau pecinta alam']
  },
  // Scholarships
  {
    canonical: 'Beasiswa KIP Kuliah',
    type: 'scholarship',
    family: 'scholarship',
    aliases: ['beasiswa kip kuliah', 'kip kuliah', 'beasiswa kip', 'kip', 'kartu indonesia pintar']
  },
  {
    canonical: 'Beasiswa 1K1S (Satu Keluarga Satu Sarjana)',
    type: 'scholarship',
    family: 'scholarship',
    aliases: ['beasiswa 1k1s', '1k1s', 'satu keluarga satu sarjana', 'program 1k1s', 'beasiswa satu keluarga satu sarjana']
  },
  {
    canonical: 'Beasiswa Prestasi',
    type: 'scholarship',
    family: 'scholarship',
    aliases: ['beasiswa prestasi', 'jalur prestasi', 'prestasi akademik', 'prestasi non akademik']
  },
  {
    canonical: 'Beasiswa Yayasan Widya Dharma Shanti',
    type: 'scholarship',
    family: 'scholarship',
    aliases: ['beasiswa yayasan', 'beasiswa yayasan widya dharma shanti', 'yayasan widya dharma shanti', 'beasiswa internal yayasan']
  },
  {
    canonical: 'Beasiswa SKSS',
    type: 'scholarship',
    family: 'scholarship',
    aliases: ['beasiswa skss', 'skss']
  }
];

// Canonical interest taxonomy. These entries classify a user's activity/profile;
// they deliberately do not name or imply any organization. Organization matches
// must be established later from official, compatible evidence.
const CANONICAL_INTEREST_PROFILES = [
  { key: 'nature', label: 'alam dan kegiatan luar ruang', terms: ['pecinta alam', 'kegiatan alam', 'alam bebas', 'luar ruang', 'outdoor', 'gunung', 'mendaki', 'hiking', 'camping', 'petualangan', 'konservasi lingkungan'] },
  { key: 'volunteer', label: 'kerelawanan dan kemanusiaan', terms: ['kepalangmerahan', 'palang merah', 'relawan', 'volunteer', 'kemanusiaan', 'sosial', 'kesehatan', 'medis'] },
  { key: 'choir', label: 'paduan suara dan olah vokal', terms: ['paduan suara', 'choir', 'olah vokal', 'vokal'] },
  { key: 'dance', label: 'tari tradisional', terms: ['tari', 'menari', 'dance', 'dancer', 'tari bali', 'seni tari', 'pragina'] },
  { key: 'gamelan', label: 'karawitan dan tabuh', terms: ['gamelan', 'tabuh', 'menabuh', 'karawitan', 'megambel', 'bramara gita'] },
  { key: 'arts', label: 'seni', terms: ['seni', 'sni', 'musik', 'band', 'nyanyi', 'teater', 'drama', 'akting'] },
  { key: 'sports', label: 'olahraga', terms: ['olahraga', 'sport', 'atlet', 'futsal', 'basket', 'sepak bola'] },
  { key: 'technology', label: 'teknologi', terms: ['teknologi', 'komputer', 'coding', 'pemrograman', 'software', 'aplikasi', 'linux', 'open source', 'keamanan siber', 'jaringan', 'data science', 'artificial intelligence'] },
  { key: 'entrepreneurship', label: 'kewirausahaan', terms: ['wirausaha', 'kewirausahaan', 'entrepreneur', 'bisnis', 'startup', 'usaha'] },
  { key: 'religious', label: 'kerohanian', terms: ['rohani', 'kerohanian', 'agama', 'keagamaan', 'hindu', 'kristen', 'islam', 'muslim'] },
  { key: 'media', label: 'media kreatif', terms: ['foto', 'fotografi', 'video', 'videografi', 'multimedia', 'desain', 'konten kreatif', 'media kreatif'] },
  { key: 'leadership', label: 'kepemimpinan', terms: ['kepemimpinan', 'leadership', 'panitia', 'event kampus'] }
];
// Helper: Normalize query text for token matching
function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\u00a0]/g, ' ')
    .replace(/[^a-z0-9\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Morphology-aware token cleaning (strip typical Indonesian suffixes)
function textContainsCanonicalTerm(text, term) {
  const hay = ` ${normalizeText(text)} `;
  const needle = normalizeText(term);
  return Boolean(needle) && hay.includes(` ${needle} `);
}

function resolveCanonicalInterestProfile(text) {
  const matches = CANONICAL_INTEREST_PROFILES
    .map(profile => ({ ...profile, matchedTerms: profile.terms.filter(term => textContainsCanonicalTerm(text, term)) }))
    .filter(profile => profile.matchedTerms.length)
    .sort((a, b) => Math.max(...b.matchedTerms.map(term => normalizeText(term).length)) - Math.max(...a.matchedTerms.map(term => normalizeText(term).length)));
  if (!matches.length) return null;
  const best = matches[0];
  return { key: best.key, label: best.label, terms: best.terms.slice(), matchedTerms: best.matchedTerms.slice() };
}
function stripIndonesianAffixes(token) {
  let t = String(token || '').toLowerCase().trim();
  if (t.length <= 3) return t;
  // Suffixes: -nya, -lah, -kah, -pun, -an
  t = t.replace(/(?:nya|lah|kah|pun)$/i, '');
  if (t.length > 4 && t.endsWith('an') && !/^(?:badan|bagian|halaman|jurusan|angsuran|tagihan)$/i.test(t)) {
    t = t.slice(0, -2);
  }
  return t;
}

/**
 * Match canonical entities against input text.
 * Returns array of matched entities with priority metrics.
 */
function matchCanonicalEntities(text) {
  const norm = normalizeText(text);
  if (!norm) return [];

  const matched = [];
  for (const entry of CANONICAL_ENTITIES) {
    let matchedAlias = null;
    let matchQuality = 0;

    for (const alias of entry.aliases) {
      const aliasNorm = normalizeText(alias);
      if (!aliasNorm) continue;

      if (aliasNorm.length <= 3) {
        const re = new RegExp(`(^|\\s)${aliasNorm}(\\s|$)`, 'i');
        if (re.test(norm)) {
          matchedAlias = alias;
          matchQuality = Math.max(matchQuality, 1.0);
          break;
        }
      } else if (norm.includes(aliasNorm)) {
        matchedAlias = alias;
        matchQuality = Math.max(matchQuality, aliasNorm.length >= 10 ? 1.0 : 0.85);
        break;
      }
    }

    if (matchedAlias) {
      matched.push({
        canonical: entry.canonical,
        type: entry.type,
        family: entry.family,
        degree: entry.degree || null,
        scope: entry.scope || null,
        country: entry.country || null,
        matchedAlias,
        matchQuality,
        isSpecific: entry.type !== 'campus_service' || /inbis|cdc|llc/i.test(entry.canonical)
      });
    }
  }

  // Filter out matches whose alias is completely contained within another match's alias
  const filtered = matched.filter((item, idx) => {
    return !matched.some((other, oIdx) => {
      if (idx === oIdx) return false;
      const otherAlias = normalizeText(other.matchedAlias);
      const itemAlias = normalizeText(item.matchedAlias);
      return otherAlias !== itemAlias && otherAlias.includes(itemAlias) && other.canonical !== item.canonical;
    });
  });

  // Sort by specificity (longer canonical / higher quality first)
  return filtered.sort((a, b) => b.canonical.length - a.canonical.length);
}

/**
 * Find canonical entity by exact key or alias
 */
function resolveCanonicalInterestProfiles(text) {
  const matches = CANONICAL_INTEREST_PROFILES
    .map(profile => ({ ...profile, matchedTerms: profile.terms.filter(term => textContainsCanonicalTerm(text, term)) }))
    .filter(profile => profile.matchedTerms.length)
    .sort((a, b) => Math.max(...b.matchedTerms.map(term => normalizeText(term).length)) - Math.max(...a.matchedTerms.map(term => normalizeText(term).length)));
  return matches.map(profile => ({
    key: profile.key,
    label: profile.label,
    terms: profile.terms.slice(),
    matchedTerms: profile.matchedTerms.slice()
  }));
}

function resolveUniqueCanonicalEntityByQualifiers(qualifiers = {}) {
  const expectedFamily = normalizeText(qualifiers.family);
  const expectedType = normalizeText(qualifiers.type);
  const expectedCountry = normalizeText(qualifiers.country);
  const expectedScope = normalizeText(qualifiers.scope);
  const expectedProgramKind = normalizeText(qualifiers.programKind);
  const matches = CANONICAL_ENTITIES.filter(entry => {
    if (expectedFamily && normalizeText(entry.family) !== expectedFamily) return false;
    if (expectedType && normalizeText(entry.type) !== expectedType) return false;
    if (expectedCountry && normalizeText(entry.country) !== expectedCountry) return false;
    if (expectedScope && normalizeText(entry.scope) !== expectedScope) return false;
    if (expectedProgramKind && normalizeText(entry.programKind) !== expectedProgramKind) return false;
    return true;
  });
  return matches.length === 1 ? { ...matches[0] } : null;
}
function findCanonicalEntity(identifier) {
  if (!identifier) return null;
  const target = normalizeText(identifier);
  for (const entry of CANONICAL_ENTITIES) {
    if (normalizeText(entry.canonical) === target) return entry;
    if (entry.aliases.some(a => normalizeText(a) === target)) return entry;
  }
  return null;
}

/**
 * Check if two entity representations are aliases of the same canonical entity.
 */
function areEntitiesEquivalent(entityA, entityB) {
  if (!entityA || !entityB) return false;
  const aNorm = normalizeText(entityA);
  const bNorm = normalizeText(entityB);
  if (aNorm === bNorm) return true;

  const foundA = findCanonicalEntity(entityA);
  const foundB = findCanonicalEntity(entityB);

  if (foundA && foundB) {
    return foundA.canonical === foundB.canonical;
  }
  return false;
}

module.exports = {
  CANONICAL_ENTITIES,
  CANONICAL_INTEREST_PROFILES,
  normalizeText,
  stripIndonesianAffixes,
  matchCanonicalEntities,
  findCanonicalEntity,
  areEntitiesEquivalent,
  resolveCanonicalInterestProfile,
  resolveCanonicalInterestProfiles,
  resolveUniqueCanonicalEntityByQualifiers
};
