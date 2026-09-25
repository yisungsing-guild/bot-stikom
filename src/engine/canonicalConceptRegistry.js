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
