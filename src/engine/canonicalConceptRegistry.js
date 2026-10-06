'use strict';

/**
 * canonicalConceptRegistry.js
 *
 * Generic Canonical Semantic Concept Registry for Current-Clause Alignment.
 * Normalizes multi-lingual and terminology variations of substantive academic & technical concepts
 * into shared canonical concept families.
 *
 * INVARIANTS:
 * - Pure and immutable dictionary and helpers.
 * - Generic terminology only: NO query-specific branches, NO source-ID or filename rules.
 * - Single source of truth for semantic concept equivalence.
 */

const CANONICAL_SEMANTIC_CONCEPTS = Object.freeze({
  SECURITY: Object.freeze({
    id: 'concept_security',
    canonical: 'security',
    terms: Object.freeze([
      'cybersecurity',
      'cyber security',
      'cyber',
      'it security',
      'information security',
      'keamanan siber',
      'keamanan informasi',
      'keamanan sistem',
      'security system',
      'keamanan komputer',
      'computer security',
      'network security',
      'keamanan jaringan'
    ])
  }),

  SOFTWARE: Object.freeze({
    id: 'concept_software',
    canonical: 'software',
    terms: Object.freeze([
      'software',
      'software engineering',
      'software engineer',
      'software development',
      'software developer',
      'perangkat lunak',
      'rekayasa perangkat lunak',
      'pengembangan perangkat lunak',
      'pemrograman',
      'programming',
      'programmer',
      'coding',
      'aplikasi',
      'application development'
    ])
  }),

  CLOUD: Object.freeze({
    id: 'concept_cloud',
    canonical: 'cloud',
    terms: Object.freeze([
      'cloud',
      'cloud computing',
      'komputasi awan',
      'cloud architect',
      'cloud engineer',
      'cloud infrastructure',
      'infrastruktur cloud'
    ])
  }),

  DATA_AI: Object.freeze({
    id: 'concept_data_ai',
    canonical: 'data_ai',
    terms: Object.freeze([
      'data science',
      'data scientist',
      'sains data',
      'data analytics',
      'analisis data',
      'machine learning',
      'artificial intelligence',
      'kecerdasan buatan',
      'data engineer',
      'big data'
    ])
  }),

  NETWORKING: Object.freeze({
    id: 'concept_networking',
    canonical: 'networking',
    terms: Object.freeze([
      'networking',
      'computer network',
      'jaringan komputer',
      'network engineering',
      'network engineer',
      'sistem jaringan',
      'teknik jaringan'
    ])
  }),

  BUSINESS_DIGITAL: Object.freeze({
    id: 'concept_business_digital',
    canonical: 'business_digital',
    terms: Object.freeze([
      'bisnis digital',
      'digital business',
      'technopreneurship',
      'technopreneur',
      'digital entrepreneur',
      'e-commerce',
      'startup'
    ])
  }),

  MULTIMEDIA_DESIGN: Object.freeze({
    id: 'concept_multimedia_design',
    canonical: 'multimedia_design',
    terms: Object.freeze([
      'desain',
      'multimedia',
      'dkv',
      'animasi',
      'desain grafis',
      'graphic design',
      'game development',
      'pengembangan game'
    ])
  }),

  DUAL_DEGREE: Object.freeze({
    id: 'concept_dual_degree',
    canonical: 'dual_degree',
    terms: Object.freeze([
      'dual degree',
      'double degree',
      'gelar ganda',
      'dua gelar'
    ])
  }),

  SPORTS: Object.freeze({
    id: 'concept_sports',
    canonical: 'sports',
    terms: Object.freeze([
      'olahraga',
      'sport',
      'basket',
      'futsal',
      'badminton',
      'bulu tangkis',
      'bulutangkis',
      'bos',
      'ukm bos',
      'athena esports',
      'esports',
      'voli',
      'sepak bola'
    ])
  }),

  POSTGRADUATE: Object.freeze({
    id: 'concept_postgraduate',
    canonical: 'postgraduate',
    terms: Object.freeze([
      'pascasarjana',
      'magister',
      's2',
      's-2',
      'strata 2',
      'magister sistem informasi',
      's2 sistem informasi',
      's2 msi'
    ])
  }),

  ARTS: Object.freeze({
    id: 'concept_arts',
    canonical: 'arts',
    terms: Object.freeze([
      'seni',
      'kesenian',
      'budaya',
      'kebudayaan',
      'musik',
      'tari',
      'pragina',
      'tabuh',
      'teater',
      'teater biner',
      'paduan suara',
      'dos',
      'd.o.s',
      'vos',
      'voice of stikom',
      'himatography',
      'multimedia',
      'jcos'
    ])
  }),

  UKM_TECH_PROGRAMMING: Object.freeze({
    id: 'concept_ukm_tech',
    canonical: 'ukm_tech',
    terms: Object.freeze([
      'komputer',
      'programming',
      'pemrograman',
      'coding',
      'syntax',
      'ksl',
      'linux',
      'mcos',
      'rade',
      'ghost',
      'teknologi dan penalaran'
    ])
  }),

  UKM_COMMUNITY_SPECIAL: Object.freeze({
    id: 'concept_ukm_community',
    canonical: 'ukm_community',
    terms: Object.freeze([
      'ksr',
      'ksr pmi',
      'ksr-pmi',
      'palang merah',
      'kemanusiaan',
      'kepalangmerahan',
      'mapala',
      'mapala kompas',
      'paskamras',
      'progress',
      'u2m'
    ])
  }),

  UKM_EXECUTIVE: Object.freeze({
    id: 'concept_ukm_executive',
    canonical: 'ukm_executive',
    terms: Object.freeze([
      'organisasi mahasiswa',
      'ormawa',
      'eksekutif',
      'legislatif',
      'kemahasiswaan',
      'badan eksekutif mahasiswa',
      'bem',
      'dewan perwakilan mahasiswa',
      'dpm',
      'balma',
      'himpunan mahasiswa',
      'himaprodi'
    ])
  }),

  PROGRAM_TI: Object.freeze({
    id: 'concept_program_ti',
    canonical: 'teknologi_informasi',
    terms: Object.freeze([
      'teknologi informasi',
      'ti',
      'it',
      'information technology',
      'prodi ti',
      'jurusan ti',
      's1 teknologi informasi'
    ])
  }),

  PROGRAM_SI: Object.freeze({
    id: 'concept_program_si',
    canonical: 'sistem_informasi',
    terms: Object.freeze([
      'sistem informasi',
      'si',
      'information systems',
      'prodi si',
      'jurusan si',
      's1 sistem informasi'
    ])
  }),

  PROGRAM_BD: Object.freeze({
    id: 'concept_program_bd',
    canonical: 'bisnis_digital',
    terms: Object.freeze([
      'bisnis digital',
      'bd',
      'digital business',
      'prodi bd',
      'jurusan bd',
      's1 bisnis digital'
    ])
  }),

  PROGRAM_SK: Object.freeze({
    id: 'concept_program_sk',
    canonical: 'sistem_komputer',
    terms: Object.freeze([
      'sistem komputer',
      'sk',
      'computer systems',
      'computer engineering',
      'prodi sk',
      'jurusan sk',
      's1 sistem komputer'
    ])
  }),

  DPP_BUILDING_FEE: Object.freeze({
    id: 'concept_dpp_building_fee',
    canonical: 'dpp',
    terms: Object.freeze([
      'dpp',
      'dana pendidikan pokok',
      'dana pengembangan pendidikan',
      'uang gedung',
      'biaya gedung',
      'potongan dpp',
      'potongan uang gedung'
    ])
  }),

  SCHOLARSHIP_KIP: Object.freeze({
    id: 'concept_scholarship_kip',
    canonical: 'kip_kuliah',
    terms: Object.freeze([
      'kip kuliah',
      'kip-k',
      'kip',
      'kartu indonesia pintar',
      'beasiswa kip'
    ])
  }),

  SION_PORTAL: Object.freeze({
    id: 'concept_sion_portal',
    canonical: 'sion',
    terms: Object.freeze([
      'sion',
      'portal sion',
      'akun sion',
      'login sion',
      'password sion',
      'sion.stikom-bali.ac.id'
    ])
  }),

  EXCHANGE_PROGRAM: Object.freeze({
    id: 'concept_exchange_program',
    canonical: 'exchange_program',
    terms: Object.freeze([
      'gccp',
      'global cross cultural program',
      'global culture and career program',
      'student exchange',
      'pertukaran mahasiswa',
      'pertukaran pelajar'
    ])
  })
});

// Build fast lookup index from term -> concept definition
const TERM_TO_CONCEPT_MAP = new Map();
for (const concept of Object.values(CANONICAL_SEMANTIC_CONCEPTS)) {
  for (const term of concept.terms) {
    TERM_TO_CONCEPT_MAP.set(term.toLowerCase(), concept);
  }
}

/**
 * Resolves a token or multi-word term to its canonical concept if one exists.
 * @param {string} tokenOrPhrase
 * @returns {Object|null} The canonical concept definition or null
 */
function resolveCanonicalConcept(tokenOrPhrase) {
  if (typeof tokenOrPhrase !== 'string') return null;
  const normalized = tokenOrPhrase.trim().toLowerCase();
  return TERM_TO_CONCEPT_MAP.get(normalized) || null;
}

/**
 * Returns all equivalent search terms for an anchor token or phrase.
 * If the anchor belongs to a canonical concept family, returns all synonyms in that family.
 * Otherwise, returns [normalizedAnchor].
 *
 * @param {string} anchor
 * @returns {string[]} Array of search terms
 */
function getConceptEquivalenceTerms(anchor) {
  if (typeof anchor !== 'string' || !anchor.trim()) return [];
  const concept = resolveCanonicalConcept(anchor);
  if (concept && Array.isArray(concept.terms)) {
    return Array.from(concept.terms);
  }
  return [anchor.trim().toLowerCase()];
}

/**
 * Checks whether searchable text matches a given semantic anchor,
 * taking into account generic canonical concept equivalence.
 *
 * @param {string} anchor - The anchor token or phrase from user clause
 * @param {string} textToSearch - The lowercased text of evidence chunk
 * @returns {boolean}
 */
function matchesSemanticConcept(anchor, textToSearch) {
  if (!anchor || !textToSearch) return false;
  const terms = getConceptEquivalenceTerms(anchor);
  for (const term of terms) {
    if (textToSearch.includes(term)) {
      return true;
    }
  }
  return false;
}

module.exports = {
  CANONICAL_SEMANTIC_CONCEPTS,
  resolveCanonicalConcept,
  getConceptEquivalenceTerms,
  matchesSemanticConcept
};
