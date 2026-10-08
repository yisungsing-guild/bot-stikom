'use strict';

/**
 * src/reasoning/turnController.js
 *
 * Deterministic Per-Turn Lifecycle Authority & Settlement Gate.
 * Enforces single terminal owner invariant:
 * exactly one of:
 *   - Phase 2 primary result accepted (PHASE2_ACCEPTED)
 *   - Phase 1 fallback accepted (FALLBACK_ACCEPTED)
 *
 * Guarantees zero duplicate dispatches, zero late session state mutations,
 * and strict settlement isolation even under asynchronous race conditions.
 */

const TURN_STATUS = Object.freeze({
  OPEN: 'OPEN',
  PHASE2_ACCEPTED: 'PHASE2_ACCEPTED',
  FALLBACK_ACCEPTED: 'FALLBACK_ACCEPTED',
  CANCELLED: 'CANCELLED'
});

class TurnController {
  constructor({ timeoutMs = 2500 } = {}) {
    this.status = TURN_STATUS.OPEN;
    this.winner = null; // 'phase2' | 'fallback' | null
    this.timeoutMs = timeoutMs;
    this.finalized = false;
    this.terminalTimestamp = null;
    this.dispatched = false;
    this.sessionCommitted = false;
    this.fallbackReason = null;

    // Optional AbortController for cooperative cancellation
    if (typeof AbortController !== 'undefined') {
      this.abortController = new AbortController();
    } else {
      this.abortController = null;
    }
  }

  get signal() {
    return this.abortController ? this.abortController.signal : null;
  }

  get isCancelled() {
    return this.status === TURN_STATUS.CANCELLED || Boolean(this.signal && this.signal.aborted);
  }

  isFinalized() {
    return this.finalized;
  }

  isPhase2Accepted() {
    return this.status === TURN_STATUS.PHASE2_ACCEPTED;
  }

  isFallbackAccepted() {
    return this.status === TURN_STATUS.FALLBACK_ACCEPTED;
  }

  isFinalizedAsCurrentOwner(owner) {
    if (!this.finalized) return false;
    if (owner === 'phase2') return this.status === TURN_STATUS.PHASE2_ACCEPTED;
    if (owner === 'fallback') return this.status === TURN_STATUS.FALLBACK_ACCEPTED;
    return false;
  }

  /**
   * Atomically attempts to accept Phase 2 as the terminal winner.
   * Succeeds ONLY if the turn is still OPEN.
   */
  tryAcceptPhase2() {
    if (this.status === TURN_STATUS.OPEN) {
      this.status = TURN_STATUS.PHASE2_ACCEPTED;
      this.winner = 'phase2';
      this.finalized = true;
      this.terminalTimestamp = Date.now();
      return true;
    }
    return false;
  }

  /**
   * Atomically attempts to accept Fallback as the terminal winner.
   * Succeeds ONLY if the turn is still OPEN.
   * Triggers AbortController if available.
   */
  tryAcceptFallback(reason = 'unknown') {
    if (this.status === TURN_STATUS.OPEN) {
      this.status = TURN_STATUS.FALLBACK_ACCEPTED;
      this.winner = 'fallback';
      this.fallbackReason = reason;
      this.finalized = true;
      this.terminalTimestamp = Date.now();
      if (this.abortController && !this.abortController.signal.aborted) {
        try {
          this.abortController.abort();
        } catch (_) {}
      }
      return true;
    }
    return false;
  }

  /**
   * Gates outbound dispatch.
   * Only the accepted winner may dispatch, and exactly once.
   */
  canDispatch(owner) {
    if (!this.finalized || this.dispatched) return false;
    if (owner === 'phase2' && this.status === TURN_STATUS.PHASE2_ACCEPTED) {
      this.dispatched = true;
      return true;
    }
    if (owner === 'fallback' && this.status === TURN_STATUS.FALLBACK_ACCEPTED) {
      this.dispatched = true;
      return true;
    }
    return false;
  }

  /**
   * Gates session commit.
   * Only the accepted winner may commit session state, and exactly once.
   */
  canCommitSession(owner) {
    if (!this.finalized || this.sessionCommitted) return false;
    if (owner === 'phase2' && this.status === TURN_STATUS.PHASE2_ACCEPTED) {
      this.sessionCommitted = true;
      return true;
    }
    if (owner === 'fallback' && this.status === TURN_STATUS.FALLBACK_ACCEPTED) {
      this.sessionCommitted = true;
      return true;
    }
    return false;
  }
}

function createTurnController(opts) {
  return new TurnController(opts);
}

module.exports = {
  TURN_STATUS,
  TurnController,
  createTurnController
};
