/**
 * ConversationTopicResolver: Single source of truth for conversation topic lifecycle.
 * 
 * Determines the active conversation topic (program) based on:
 * - explicit mentions in current message
 * - semantic reuse from session history
 * - freshness/staleness of cached topic
 * - hard reset requests
 * - greeting preservation
 * 
 * IMPORTANT: This resolver makes deterministic decisions about topic lifecycle.
 * All providers, composers, and reporters should use this resolver exclusively
 * to avoid scattered conditional logic.
 */

const { mergeNextProgramHint } = require('../utils/programHints');


class ConversationTopicResolver {
  constructor({
    extractExplicitProgramHint = null,
    inferContextualFollowup = null,
    isProgramHintFresh = null,
    isHardSessionResetCommand = null,
    getSessionProgramHint = null,
    logger = null,
    programHintStaleMinutes = 120
  } = {}) {
    this.extractExplicitProgramHint = extractExplicitProgramHint;
    this.inferContextualFollowup = inferContextualFollowup;
    this.isProgramHintFresh = isProgramHintFresh;
    this.isHardSessionResetCommand = isHardSessionResetCommand;
    this.getSessionProgramHint = getSessionProgramHint;
    this.logger = logger;
    this.programHintStaleMinutes = programHintStaleMinutes;
  }

  /**
   * Determine if message is a lightweight greeting that should preserve topic.
   * Examples: "ok", "siap", "iya", "thanks", etc.
   */
  isLightweightGreeting(message) {
    const t = String(message || '').trim().toLowerCase();
    if (!t || t.length === 0) return false;
    
    // Very short acknowledgements
    const lightGreetings = /^(ok|oke|oky|yok|sip|siap|baik|baik ya|ya|iya|yes|yep|thanks|makasi|makasiih|terimakasih|terima kasih|thx|tq|good|lanjut|lanjutkan|tanya|tanya lagi|ada lagi|next)$/i;
    return lightGreetings.test(t);
  }

  /**
   * Determine if message looks like a short follow-up question that could reuse context.
   * Examples: "berapa", "biaya TI", "jadwal", etc.
   */
  isContextualFollowup(message, session) {
    if (typeof this.inferContextualFollowup === 'function') {
      return this.inferContextualFollowup(message, session);
    }
    
    // Fallback: basic heuristic
    const t = String(message || '').trim();
    if (!t || t.length === 0) return false;
    
    const words = t.split(/\s+/).filter(Boolean);
    const isShort = t.length <= 60 || words.length <= 3;
    const hasNoExplicitProgram = !this.extractExplicitProgramHint || !this.extractExplicitProgramHint(t);
    const notNumeric = !/^\d+$/.test(t);
    const notAdminMsg = !/\b(admin|cs|komplain|complain)\b/i.test(t);
    
    return isShort && hasNoExplicitProgram && notNumeric && notAdminMsg;
  }

  /**
   * Main resolver: Determine active conversation topic and its lifecycle state.
   * 
   * @param {Object} session - Session data from database
   * @param {string} message - Current user message
   * @param {Object} opts - Options
   * @param {boolean} opts.ignoreStale - If true, don't consider staleness (for tests/debug)
   * @returns {Object} Resolution result
   */
  resolveConversationTopic(session, message, opts = {}) {
    const options = Object.assign({}, { ignoreStale: false }, opts);
    
    try {
      // Step 1: Check for hard reset command
      const resetRequested = this.isHardResetCommand(message);
      if (resetRequested) {
        return {
          activeTopic: null,
          isExplicit: false,
          isReused: false,
          isStale: false,
          resetRequested: true,
          source: 'reset',
          reason: 'Hard reset command detected'
        };
      }

      // Step 2: Check for explicit program mention in current message
      const explicitTopic = this.extractExplicitTopic(message);
      if (explicitTopic) {
        return {
          activeTopic: explicitTopic,
          isExplicit: true,
          isReused: false,
          isStale: false,
          resetRequested: false,
          source: 'explicit',
          reason: `Explicit mention: ${explicitTopic}`
        };
      }

      // Step 3: If no explicit mention, check for lightweight greeting
      // Greetings preserve the topic without changing it
      if (this.isLightweightGreeting(message)) {
        const sessionTopic = this.getSessionTopic(session);
        if (sessionTopic && !options.ignoreStale) {
          const isFresh = this.checkTopicFreshness(session);
          if (!isFresh) {
            // Greeting on stale topic = stale state
            return {
              activeTopic: sessionTopic,
              isExplicit: false,
              isReused: false,
              isStale: true,
              resetRequested: false,
              source: 'stale',
              reason: `Greeting on stale topic: ${sessionTopic}`
            };
          }
        }
        // Otherwise, preserve topic without change
        return {
          activeTopic: sessionTopic,
          isExplicit: false,
          isReused: !!sessionTopic,
          isStale: false,
          resetRequested: false,
          source: sessionTopic ? 'greeting_preserve' : 'none',
          reason: sessionTopic ? `Greeting preserves topic: ${sessionTopic}` : 'Greeting but no prior topic'
        };
      }

      // Step 4: Check for semantic follow-up (short contextual follow-up)
      const isFollowup = this.isContextualFollowup(message, session);
      if (isFollowup) {
        const sessionTopic = this.getSessionTopic(session);
        if (sessionTopic) {
          // Check freshness
          if (!options.ignoreStale) {
            const isFresh = this.checkTopicFreshness(session);
            if (!isFresh) {
              return {
                activeTopic: null,
                isExplicit: false,
                isReused: false,
                isStale: true,
                resetRequested: false,
                source: 'stale',
                reason: `Follow-up on stale topic: ${sessionTopic}. Topic expired.`
              };
            }
          }
          // Topic is fresh, reuse it
          return {
            activeTopic: sessionTopic,
            isExplicit: false,
            isReused: true,
            isStale: false,
            resetRequested: false,
            source: 'reused',
            reason: `Semantic follow-up reuses topic: ${sessionTopic}`
          };
        }
      }

      // Step 5: No reuse candidate; topic becomes none
      return {
        activeTopic: null,
        isExplicit: false,
        isReused: false,
        isStale: false,
        resetRequested: false,
        source: 'none',
        reason: 'No explicit mention, not a follow-up, or no session topic'
      };
    } catch (e) {
      if (this.logger && this.logger.warn) {
        this.logger.warn({ err: e.message, message, session }, '[ConversationTopicResolver] Resolution failed');
      }
      // Fail open: no active topic if resolver fails
      return {
        activeTopic: null,
        isExplicit: false,
        isReused: false,
        isStale: false,
        resetRequested: false,
        source: 'error',
        reason: `Resolver error: ${e.message}`
      };
    }
  }

  applyTopicReuse(sessionData) {
    if (!sessionData || typeof sessionData !== 'object') return sessionData;
    sessionData.lastProgramHintAt = new Date().toISOString();
    sessionData.updatedAt = sessionData.lastProgramHintAt;
    sessionData.programHintSource = 'reused';
    sessionData.contextReused = true;
    sessionData.composerTelemetry = Object.assign({}, sessionData.composerTelemetry || {}, { contextReused: true });
    if (sessionData.lastReflectionAt) delete sessionData.lastReflectionAt;
    return sessionData;
  }

  applyExplicitTopic(sessionData, resolution) {
    if (!sessionData || typeof sessionData !== 'object') return sessionData;
    try {
      const merged = mergeNextProgramHint(sessionData || {}, resolution.activeTopic);
      Object.assign(sessionData, merged);
    } catch (e) {}
    sessionData.lastProgramHintAt = new Date().toISOString();
    sessionData.updatedAt = sessionData.lastProgramHintAt;
    sessionData.programHintSource = 'explicit';
    sessionData.programHintConfidence = 1;
    return sessionData;
  }

  clearTopicState(sessionData) {
    if (!sessionData || typeof sessionData !== 'object') return sessionData;
    delete sessionData.currentProgramHint;
    delete sessionData.lastProgramHint;
    delete sessionData.lastProgramHintAt;
    delete sessionData.previousProgramHint;
    delete sessionData.programHintSource;
    delete sessionData.programHintConfidence;
    delete sessionData.contextReused;
    if (sessionData.composerTelemetry && typeof sessionData.composerTelemetry === 'object') {
      delete sessionData.composerTelemetry.contextReused;
    }
    if (sessionData.lastReflectionAt) delete sessionData.lastReflectionAt;
    return sessionData;
  }

  /**
   * Extract explicit program mention from message.
   */
  extractExplicitTopic(message) {
    if (typeof this.extractExplicitProgramHint !== 'function') {
      return null;
    }
    try {
      return this.extractExplicitProgramHint(String(message || '').trim());
    } catch (e) {
      return null;
    }
  }

  /**
   * Get topic from session (lastProgramHint or currentProgramHint).
   */
  getSessionTopic(session) {
    if (!session || typeof session !== 'object') {
      return null;
    }
    
    // Prefer currentProgramHint, fall back to lastProgramHint
    const current = session.currentProgramHint || session.lastProgramHint;
    if (current && String(current).trim()) {
      return String(current).trim();
    }
    return null;
  }

  /**
   * Check if session topic is still fresh (not stale).
   */
  checkTopicFreshness(session) {
    if (!session || typeof session !== 'object') {
      return false;
    }
    
    if (typeof this.isProgramHintFresh === 'function') {
      return this.isProgramHintFresh(session);
    }
    
    // Fallback: check timestamp
    const tsRaw = session.lastProgramHintAt || session.updatedAt;
    if (!tsRaw) return false;
    
    try {
      const ts = new Date(String(tsRaw));
      if (Number.isNaN(ts.getTime())) return false;
      
      const elapsedMs = Date.now() - ts.getTime();
      const elapsedMinutes = elapsedMs / (60 * 1000);
      
      return elapsedMinutes <= this.programHintStaleMinutes;
    } catch (e) {
      return false;
    }
  }

  /**
   * Check if message is a hard reset command.
   */
  isHardResetCommand(message) {
    if (typeof this.isHardSessionResetCommand === 'function') {
      return this.isHardSessionResetCommand(String(message || '').trim());
    }
    
    // Fallback: basic reset keywords
    const t = String(message || '').trim().toLowerCase();
    return /^(menu|menu\s+utama|mulai|start|0)$/.test(t);
  }

  /**
   * Apply resolved topic to session data.
   * Persists the resolution decision and updates session state.
   * 
   * @param {Object} sessionData - Session data object to mutate
   * @param {Object} resolution - Result from resolveConversationTopic()
   * @param {Object} opts - Options
   */
  applyResolutionToSession(sessionData, resolution, opts = {}) {
    if (!sessionData || typeof sessionData !== 'object') {
      return sessionData;
    }
    
    const options = Object.assign({}, opts);
    
    try {
      // Record resolution for telemetry
      if (!sessionData.topicResolutionLog) {
        sessionData.topicResolutionLog = [];
      }
      
      sessionData.topicResolutionLog.push({
        timestamp: new Date().toISOString(),
        source: resolution.source,
        topic: resolution.activeTopic,
        reason: resolution.reason
      });
      
      // Keep only recent logs (last 20)
      if (sessionData.topicResolutionLog.length > 20) {
        sessionData.topicResolutionLog = sessionData.topicResolutionLog.slice(-20);
      }

      // Apply resolution
      if (resolution.resetRequested) {
        this.clearTopicState(sessionData);
      } else if (resolution.isExplicit) {
        this.applyExplicitTopic(sessionData, resolution);
      } else if (resolution.isReused) {
        this.applyTopicReuse(sessionData, resolution);
      }
      // Stale or none: don't change existing topic, just record resolution

      // Record for debugging/telemetry
      sessionData.lastTopicResolution = {
        activeTopic: resolution.activeTopic,
        source: resolution.source,
        isStale: resolution.isStale,
        timestamp: new Date().toISOString()
      };

      return sessionData;
    } catch (e) {
      if (this.logger && this.logger.warn) {
        this.logger.warn({ err: e.message }, '[ConversationTopicResolver] Failed to apply resolution');
      }
      return sessionData;
    }
  }
}

module.exports = ConversationTopicResolver;
