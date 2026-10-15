'use strict';

/**
 * src/core/contextResolver.js
 * 
 * Greenfield Context Policy Layer.
 * Invariant: CURRENT TURN IS AUTHORITATIVE.
 * 
 * Rules:
 * History is ONLY consulted if:
 * 1. An explicit pronoun/demonstrative reference is present:
 *    - "itu", "tersebut", "tadi", "yang itu", "bagaimana dengannya"
 * 2. A genuine ellipsis is detected:
 *    - "Bagaimana dengan DNUI?"
 *    - "Kalau yang S1?"
 *    - "Yang internasional bagaimana?"
 * 
 * FORBIDDEN:
 * - Word count <= N
 * - The presence of common academic tokens like "kuliah", "daftar", "biaya", "jadwal"
 *   These MUST NEVER trigger context inheritance on their own.
 */

// Pronouns / references requiring prior turn (includes standalone pronouns, English anaphora like "the program", and enclitic -nya on nouns, e.g. studinya, biayanya)
const PRONOUN_REFERENCE_REGEX = /(?:\b(itu|tersebut|tadi|yang itu|dengannya|nya|the\s+program|the\s+major|the\s+degree|it|that|this)\b|\b[a-z]{3,}nya\b)/i;

// Genuine ellipsis starts (e.g. "bagaimana dengan...", "kalau yang...", "what about...", "how about...")
const GENUINE_ELLIPSIS_REGEX = /^(kalau|bagaimana\s+dengan|gimana\s+dengan|lalu|kalo|what\s+about|how\s+about|and)\s+(the\s+|yang\s+)?([a-z0-9\s]+)\??$/i;
const PREDICATE_ELLIPSIS_REGEX = /^(masih\s+bisa\s+daftar|bisa\s+daftar\s+sekarang|kapan\s+jadwalnya|kapan\s+batasnya|kapan\s+buka|syaratnya\s+apa|biayanya\s+berapa|cara\s+daftarnya\s+gimana)\??$/i;

function hasExplicitPronounReference(query) {
  if (!query) return false;
  return PRONOUN_REFERENCE_REGEX.test(query);
}

function isGenuineEllipsis(query) {
  if (!query) return false;
  const trimmed = query.trim().toLowerCase();
  return GENUINE_ELLIPSIS_REGEX.test(trimmed) || PREDICATE_ELLIPSIS_REGEX.test(trimmed);
}

/**
 * Determines whether the current query should inherit context from prior session turns.
 * Returns { shouldInherit: boolean, reason: string }
 */
function evaluateContextDependency(currentQuery, sessionData = {}) {
  if (!currentQuery) {
    return { shouldInherit: false, reason: 'empty_query' };
  }

  const query = currentQuery.trim().toLowerCase();

  // If session has no prior state, cannot inherit
  if (!sessionData || (!sessionData.activeDomain && !sessionData.activeEntity && !sessionData.lastQuery)) {
    return { shouldInherit: false, reason: 'no_session_history' };
  }

  // Check 1: Genuine Ellipsis
  if (isGenuineEllipsis(query)) {
    return {
      shouldInherit: true,
      reason: 'genuine_ellipsis',
      inheritedDomain: sessionData.activeDomain,
      inheritedEntity: sessionData.activeEntity
    };
  }

  // Check 2: Explicit Pronoun/Reference (includes enclitic -nya like "studinya" and "the program")
  if (hasExplicitPronounReference(query)) {
    return {
      shouldInherit: true,
      reason: 'pronoun_reference',
      inheritedDomain: sessionData.activeDomain,
      inheritedEntity: sessionData.activeEntity
    };
  }

  // Check 3: Attribute Continuation without explicit entity (e.g. "gelar apa yang didapat dan berapa lama masa studi?" / "what degree would I receive and how long would the program take?")
  const isAttributeInquiry = /\b(gelar(?:\s+apa)?|masa\s+studi|durasi\s+studi|lama\s+studi|prospek\s+lulusan|degree(?:s)?(?:\s+awarded|\s+received)?|qualification(?:s)?|study\s+duration|study\s+length|duration(?:\s+of\s+study)?|how\s+long\b|graduate(?:s)?|graduation)\b/i.test(query);
  if (isAttributeInquiry && sessionData.activeEntity) {
    return {
      shouldInherit: true,
      reason: 'attribute_continuation',
      inheritedDomain: sessionData.activeDomain || 'ACADEMIC_PROGRAM',
      inheritedEntity: sessionData.activeEntity
    };
  }

  // DEFAULT: Current turn is independent and authoritative!
  return {
    shouldInherit: false,
    reason: 'independent_current_turn'
  };
}

module.exports = {
  hasExplicitPronounReference,
  isGenuineEllipsis,
  evaluateContextDependency
};
