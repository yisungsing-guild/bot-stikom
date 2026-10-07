'use strict';

/**
 * src/reasoning/contextRepair.js
 * 
 * Phase 2 Step 4: Context Repair & Delta State Management.
 * 
 * Strict Invariants:
 * 1. Explicit Delta Representation: previousContext + currentTurn = contextDelta.
 * 2. Explicit Correction: Handles negation and slot overrides ("bukan X, maksud saya Y").
 * 3. Deterministic Entity Switch: New explicit entities replace old without regression or lingering.
 * 4. Safe Domain Switch: Changing domain preserves activeEntity if semantically coherent.
 * 5. Campus-Wide Domain Exception: Domains like facilities/scholarship/schedule decouple from prodi,
 *    storing prodi in background to restore on subsequent academic turns.
 * 6. Neutral Turn Invariance: Acknowledgements ("ok", "terima kasih") preserve valid state without corrupting it.
 * 7. Enclitic & Ellipsis Grounding: Semantic relation-based inheritance for "-nya" and follow-ups.
 * 8. Stale Context Expiry: Strict 30-minute TTL boundary.
 * 9. Session Atomicity & Rollback: State only commits after verified completion.
 * 10. Provenance Tracking: explicit_current_turn vs inherited_from_session.
 * 11. Recursion Guard: Context repair never invokes itself recursively.
 */

const {
  CONTEXT_ACTION,
  ENTITY_PROVENANCE,
  CONTEXT_TTL_MS,
  CAMPUS_WIDE_DOMAINS,
  validateContextDelta
} = require('./contracts');
const { findCanonicalEntity, matchCanonicalEntities } = require('../engine/canonicalEntityRegistry');
const { resolveSemanticFrame } = require('../core/semanticFrameResolver');
const { updateSession } = require('../core/conversationState');
const logger = require('../logger');

// Regex patterns for explicit correction
const CORRECTION_REPLACEMENT_REGEX = /(?:bukan|bkn|bukanlah)\s+([^,]+?)(?:,\s*|\s+)(?:maksud\s+saya|tapi|melainkan|melainkn|tetapi|yg\s+saya\s+maksud|yang\s+saya\s+maksud)\s+([^,]+)/i;
const CORRECTION_DOMAIN_REGEX = /(?:bukan|bkn)\s+(biaya|kurikulum|fasilitas|prospek|beasiswa|jadwal|persyaratan|syarat)(?:,|\s+)?(?:saya\s+mau\s+tahu|tapi|melainkan|maksud\s+saya|pengen\s+tahu|ingin\s+tahu)?\s*([a-z0-9\s]*)/i;
const CORRECTION_ASSERTION_ONLY_REGEX = /(?:yang\s+saya\s+maksud|yg\s+saya\s+maksud|maksud\s+saya|maksudku|mksd\s+sy)\s+([^,]+)/i;

// Neutral conversational acknowledgement tokens
const NEUTRAL_TOKENS = new Set([
  'ok', 'oke', 'baik', 'sip', 'siap', 'terima', 'kasih', 'makasih',
  'thanks', 'thank', 'you', 'noted', 'mantap', 'banyak', 'kak', 'min',
  'ya', 'bang', 'gan', 'mas', 'mbak'
]);

// Enclitic / ellipsis patterns
const ENCLITIC_SUFFIX_REGEX = /\b(biaya|kurikulum|fasilitas|prospek|beasiswa|syarat|jadwal|akreditasi|gelombang)nya\b/i;
const ELLIPSIS_FOLLOWUP_REGEX = /^(?:kalau|bagaimana|gimana|lalu|kalo)\s+(?:yang\s+)?([a-z0-9\s]+)\??$/i;

/**
 * Checks whether a session context has expired based on 30-minute TTL
 */
function isContextStale(lastTurnTs, currentTime = Date.now()) {
  if (!lastTurnTs || typeof lastTurnTs !== 'number') return false;
  return (currentTime - lastTurnTs) > CONTEXT_TTL_MS;
}

/**
 * Checks if a turn is a pure neutral acknowledgement
 */
function isNeutralTurn(queryText) {
  if (!queryText || typeof queryText !== 'string') return false;
  const words = queryText.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  return words.every(w => NEUTRAL_TOKENS.has(w));
}

/**
 * Checks if domain is a campus-wide general domain
 */
function isCampusWideDomain(domain) {
  if (!domain || typeof domain !== 'string') return false;
  return CAMPUS_WIDE_DOMAINS.includes(domain.toUpperCase());
}

/**
 * Extracts explicit correction intents from query text
 */
function parseExplicitCorrection(rawQuery) {
  const q = String(rawQuery || '').trim();
  if (!q) return null;

  // Pattern 1: bukan [X], maksud saya [Y]
  const match1 = q.match(CORRECTION_REPLACEMENT_REGEX);
  if (match1) {
    const rawNegated = match1[1].trim();
    const rawTarget = match1[2].trim();
    const negatedEntity = findCanonicalEntity(rawNegated);
    const targetEntity = findCanonicalEntity(rawTarget);
    return {
      type: 'entity_or_slot_correction',
      negatedRaw: rawNegated,
      targetRaw: rawTarget,
      negatedEntity: negatedEntity ? negatedEntity.canonical : rawNegated,
      targetEntity: targetEntity ? targetEntity.canonical : rawTarget
    };
  }

  // Pattern 2: bukan [domain], (saya mau tahu) [domain/aspect]
  const match2 = q.match(CORRECTION_DOMAIN_REGEX);
  if (match2) {
    const negatedDomain = match2[1].trim();
    const targetDomain = match2[2].trim();
    return {
      type: 'domain_correction',
      negatedDomain,
      targetDomain
    };
  }

  // Pattern 3: yang saya maksud [Y]
  const match3 = q.match(CORRECTION_ASSERTION_ONLY_REGEX);
  if (match3) {
    const rawTarget = match3[1].trim();
    const targetEntity = findCanonicalEntity(rawTarget);
    return {
      type: 'assertion_correction',
      targetRaw: rawTarget,
      targetEntity: targetEntity ? targetEntity.canonical : rawTarget
    };
  }

  return null;
}

/**
 * Computes explicit context delta between previous session and current turn.
 * 
 * @param {object} previousSession - snapshot of previous session { state, data }
 * @param {object} currentTurn - { rawQuery, semanticFrame, currentTime, repairDepth }
 * @returns {object} contextDelta
 */
function computeContextDelta(previousSession = {}, currentTurn = {}) {
  const query = String(currentTurn.rawQuery || '').trim();
  const currentTime = currentTurn.currentTime || Date.now();
  const repairDepth = currentTurn.repairDepth || 0;

  // Recursion Guard (Invariant 11)
  if (repairDepth > 1) {
    logger.warn({ repairDepth }, '[ContextRepair] Recursion guard triggered: maximum repair depth exceeded');
    return {
      actions: [CONTEXT_ACTION.CONTEXT_PRESERVED],
      resolvedState: { ...(previousSession.data || {}) },
      recursionPrevented: true
    };
  }

  const prevData = (previousSession && previousSession.data) ? { ...previousSession.data } : {};

  // 1. STALE CONTEXT CHECK (Invariant 8: TTL 30 minutes)
  const isStale = Boolean(prevData.lastTurnTs && isContextStale(prevData.lastTurnTs, currentTime));

  const effectiveSessionForFrame = isStale ? {} : prevData;
  const semanticFrame = currentTurn.semanticFrame || resolveSemanticFrame(query, effectiveSessionForFrame);

  const actions = [];
  let activeDomain = isStale ? null : (prevData.activeDomain || null);
  let activeEntity = isStale ? null : (prevData.activeEntity || null);
  let preservedBackgroundEntity = isStale ? null : (prevData.preservedBackgroundEntity || null);
  let entityProvenance = ENTITY_PROVENANCE.NONE;

  if (isStale) {
    actions.push(CONTEXT_ACTION.CONTEXT_RESET);
  }

  // 2. NEUTRAL TURN HANDLING (Invariant 6)
  if (!isStale && isNeutralTurn(query)) {
    actions.push(CONTEXT_ACTION.CONTEXT_PRESERVED);
    return {
      actions,
      resolvedState: {
        activeDomain,
        activeEntity,
        preservedBackgroundEntity,
        entityProvenance: activeEntity ? (prevData.entityProvenance || ENTITY_PROVENANCE.INHERITED_FROM_SESSION) : ENTITY_PROVENANCE.NONE,
        isNeutral: true,
        isStale: false
      },
      correction: null
    };
  }

  // 3. EXPLICIT CORRECTION (Invariant 2)
  const explicitCorrection = parseExplicitCorrection(query);
  if (explicitCorrection) {
    if (explicitCorrection.type === 'entity_or_slot_correction' || explicitCorrection.type === 'assertion_correction') {
      const targetEntity = explicitCorrection.targetEntity;
      if (activeEntity && activeEntity !== targetEntity) {
        actions.push(CONTEXT_ACTION.ENTITY_REMOVED);
        actions.push(CONTEXT_ACTION.ENTITY_REPLACED);
      } else {
        actions.push(CONTEXT_ACTION.ENTITY_ADDED);
      }
      activeEntity = targetEntity;
      preservedBackgroundEntity = null;
      entityProvenance = ENTITY_PROVENANCE.EXPLICIT_CURRENT_TURN;
    } else if (explicitCorrection.type === 'domain_correction') {
      actions.push(CONTEXT_ACTION.DOMAIN_REPLACED);
      // Domain was corrected, but keep non-conflicting activeEntity intact
      if (activeEntity) {
        actions.push(CONTEXT_ACTION.CONTEXT_PRESERVED);
      }
      // Infer new domain from target
      const inferredNew = resolveSemanticFrame(explicitCorrection.targetDomain, prevData);
      activeDomain = inferredNew.domain || activeDomain;
    }

    const delta = {
      actions,
      resolvedState: {
        activeDomain: semanticFrame.domain || activeDomain,
        activeEntity,
        preservedBackgroundEntity,
        entityProvenance,
        isStale: false
      },
      correction: explicitCorrection
    };
    validateContextDelta(delta);
    return delta;
  }

  // 4. CURRENT TURN EXPLICIT ENTITY DETECTION
  // Use matchCanonicalEntities on the query directly to discern explicit vs inherited entities
  const explicitEntityMatches = matchCanonicalEntities(query);
  const explicitEntities = explicitEntityMatches.map(m => m.canonical);

  if (explicitEntities.length > 0) {
    const firstExplicitEntity = explicitEntities[0];
    if (activeEntity && activeEntity !== firstExplicitEntity) {
      actions.push(CONTEXT_ACTION.ENTITY_REPLACED);
    } else if (!activeEntity) {
      actions.push(CONTEXT_ACTION.ENTITY_ADDED);
    } else {
      actions.push(CONTEXT_ACTION.CONTEXT_PRESERVED);
    }
    activeEntity = firstExplicitEntity;
    preservedBackgroundEntity = null;
    entityProvenance = ENTITY_PROVENANCE.EXPLICIT_CURRENT_TURN;
  }

  // 5. CURRENT TURN DOMAIN DETECTION
  if (semanticFrame.domain && semanticFrame.domain !== 'CONVERSATIONAL') {
    if (activeDomain && activeDomain !== semanticFrame.domain) {
      actions.push(CONTEXT_ACTION.DOMAIN_REPLACED);
    } else if (!activeDomain) {
      actions.push(CONTEXT_ACTION.DOMAIN_ADDED);
    }
    activeDomain = semanticFrame.domain;
  }

  // 6. CAMPUS-WIDE DOMAIN EXCEPTION (Invariant 5)
  if (isCampusWideDomain(activeDomain)) {
    if (explicitEntities.length === 0) {
      // Query is about a campus-wide asset without explicit prodi specifier
      // Move activeEntity to preservedBackgroundEntity so campus-wide query is unconstrained,
      // but ready to be restored if next query asks for prodi curriculum/fee!
      if (activeEntity) {
        preservedBackgroundEntity = activeEntity;
        activeEntity = null;
        entityProvenance = ENTITY_PROVENANCE.NONE;
      }
    }
  } else if (!activeEntity && preservedBackgroundEntity) {
    // Current domain is prodi-relevant (e.g. curriculum, fee, prodi info), restore background entity!
    activeEntity = preservedBackgroundEntity;
    preservedBackgroundEntity = null;
    entityProvenance = ENTITY_PROVENANCE.INHERITED_FROM_SESSION;
    if (!actions.includes(CONTEXT_ACTION.CONTEXT_PRESERVED)) {
      actions.push(CONTEXT_ACTION.CONTEXT_PRESERVED);
    }
  }

  // 7. ENCLITIC & ELLIPSIS INHERITANCE (Invariant 7 & Invariant 3)
  if (!activeEntity && !isStale && !isCampusWideDomain(activeDomain)) {
    const hasEnclitic = ENCLITIC_SUFFIX_REGEX.test(query);
    const hasEllipsis = ELLIPSIS_FOLLOWUP_REGEX.test(query);

    if (hasEnclitic || hasEllipsis) {
      if (prevData.activeEntity) {
        activeEntity = prevData.activeEntity;
        entityProvenance = ENTITY_PROVENANCE.INHERITED_FROM_SESSION;
        if (!actions.includes(CONTEXT_ACTION.CONTEXT_PRESERVED)) {
          actions.push(CONTEXT_ACTION.CONTEXT_PRESERVED);
        }
      } else {
        actions.push(CONTEXT_ACTION.AMBIGUITY_DETECTED);
      }
    }
  } else if (activeEntity && explicitEntities.length === 0 && !isStale && !isCampusWideDomain(activeDomain)) {
    // Entity was retained from previous turn without explicit query match
    entityProvenance = ENTITY_PROVENANCE.INHERITED_FROM_SESSION;
    if (!actions.includes(CONTEXT_ACTION.CONTEXT_PRESERVED)) {
      actions.push(CONTEXT_ACTION.CONTEXT_PRESERVED);
    }
  }

  // 8. If nothing changed and valid context exists
  if (actions.length === 0) {
    actions.push(CONTEXT_ACTION.CONTEXT_PRESERVED);
  }

  const resultDelta = {
    actions,
    resolvedState: {
      activeDomain,
      activeEntity,
      preservedBackgroundEntity,
      entityProvenance,
      isStale
    },
    correction: null
  };

  validateContextDelta(resultDelta);
  return resultDelta;
}

/**
 * Atomic Session Transaction Manager (Invariant 9)
 * Executes turn logic and only commits context delta to session if execution succeeds.
 * 
 * @param {string} chatId
 * @param {object} previousSession
 * @param {object} contextDelta
 * @param {function} turnExecutionFn
 * @returns {Promise<object>} result of turnExecutionFn
 */
async function applyContextTransaction(chatId, previousSession, contextDelta, turnExecutionFn) {
  // Validate delta before execution
  const validation = validateContextDelta(contextDelta);
  if (!validation.valid) {
    throw new Error(`invalid_context_delta: ${validation.reason}`);
  }

  // Execute turn without mutating DB session
  const turnResult = await turnExecutionFn();

  // Commit context delta ONLY after verified successful execution
  if (chatId) {
    await updateSession(chatId, {
      dataPatch: {
        activeDomain: contextDelta.resolvedState.activeDomain,
        activeEntity: contextDelta.resolvedState.activeEntity,
        preservedBackgroundEntity: contextDelta.resolvedState.preservedBackgroundEntity,
        entityProvenance: contextDelta.resolvedState.entityProvenance,
        lastContextDeltaActions: contextDelta.actions
      }
    });
  }

  return turnResult;
}

module.exports = {
  isContextStale,
  isNeutralTurn,
  isCampusWideDomain,
  parseExplicitCorrection,
  computeContextDelta,
  applyContextTransaction
};
