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

// Pronouns / references requiring prior turn
const PRONOUN_REFERENCE_REGEX = /\b(itu|tersebut|tadi|yang itu|dengannya|nya)\b/i;

// Genuine ellipsis starts (e.g. "bagaimana dengan...", "kalau yang...", "kalau...")
const GENUINE_ELLIPSIS_REGEX = /^(kalau|bagaimana\s+dengan|gimana\s+dengan|lalu|kalo)\s+(yang\s+)?([a-z0-9\s]+)\??$/i;
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

  // Check 2: Explicit Pronoun/Reference
  if (hasExplicitPronounReference(query)) {
    // If the query has its own complete entity and action, do not blindly inherit
    return {
      shouldInherit: true,
      reason: 'pronoun_reference',
      inheritedDomain: sessionData.activeDomain,
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
