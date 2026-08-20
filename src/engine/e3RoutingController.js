/**
 * PHASE E3 — CONTROLLED ROUTING ACTIVATION
 * 
 * Feature Flag: CAMPUS_SUPPORT_ROUTING_V2
 * Default: false (legacy routing)
 * 
 * This module implements domain-based routing using the E2 shadow classifier.
 * It is designed to be integrated into querySemanticRag with minimal changes.
 */

function isE3RoutingEnabled() {
  const flag = process.env.CAMPUS_SUPPORT_ROUTING_V2;
  return flag === 'true' || flag === '1';
}

/**
 * E3 Routing Decision Contract:
 * - Classifier determines: campus_support vs other
 * - Category/entity/requestType are advisory only
 * - Routing follows domain decision
 */
async function getE3RoutingDecision(question, classifierOutput) {
  if (!isE3RoutingEnabled()) {
    return null; // Use legacy routing
  }

  if (!classifierOutput) {
    return null;
  }

  const { matched, domain, confidence } = classifierOutput;

  // Contract: Use only domain + matched for routing
  if (matched === true && domain === 'campus_support') {
    return {
      candidateRoute: 'campus_support',
      source: 'e3-classifier-routing',
      confidence,
      advisoryCategory: classifierOutput.category,
      advisoryEntity: classifierOutput.entity,
      advisoryRequestType: classifierOutput.requestType,
      classifierOutput: classifierOutput
    };
  }

  // All other cases use legacy
  return null;
}

/**
 * Compare legacy and E3 routing
 * Used for testing and validation
 */
function compareRoutingDecisions(legacyResult, e3Decision) {
  if (!e3Decision) {
    return {
      routeChanged: false,
      sourceChanged: false,
      answerChanged: false,
      e3Decision: null,
      comparison: 'E3 ROUTING DISABLED'
    };
  }

  const legacyRoute = legacyResult.route || 'unknown';
  const legacySource = legacyResult.source || 'unknown';
  const legacyAnswer = legacyResult.answer ? legacyResult.answer.substring(0, 100) : '';

  const e3Route = e3Decision.candidateRoute;
  const e3Source = e3Decision.source;

  return {
    routeChanged: legacyRoute !== e3Route,
    sourceChanged: legacySource !== e3Source,
    answerChanged: false, // Will be set after e3-specific handling
    legacyRoute,
    legacySource,
    e3Route,
    e3Source,
    e3Decision,
    comparison: legacyRoute === e3Route ? 'ROUTE_UNCHANGED' : 'ROUTE_CHANGED'
  };
}

/**
 * Validate E3 routing against safety constraints
 */
function validateE3RoutingDecision(question, e3Decision, isNegativeControl = false) {
  if (!e3Decision) {
    return { valid: true, violations: [] };
  }

  const violations = [];

  // Constraint 1: Negative controls must not route to campus_support
  if (isNegativeControl && e3Decision.candidateRoute === 'campus_support') {
    violations.push('NEGATIVE_CONTROL_ROUTED_TO_CAMPUS_SUPPORT');
  }

  // Constraint 2: Confidence must be above minimum threshold for campus_support routing
  if (e3Decision.candidateRoute === 'campus_support' && e3Decision.confidence < 0.5) {
    violations.push('LOW_CONFIDENCE_ROUTING_ATTEMPTED');
  }

  return {
    valid: violations.length === 0,
    violations,
    e3Decision
  };
}

/**
 * E3 Fallback Handler
 * If E3 routing encounters an error/issue, fall back to legacy
 */
function createE3FallbackHandler() {
  return {
    triggered: false,
    reason: null,
    fallbackRoute: null,

    trigger(reason, fallbackRoute = null) {
      this.triggered = true;
      this.reason = reason;
      this.fallbackRoute = fallbackRoute;
    },

    wasTriggered() {
      return this.triggered;
    },

    toJSON() {
      return {
        fallbackTriggered: this.triggered,
        fallbackReason: this.reason,
        fallbackRoute: this.fallbackRoute
      };
    }
  };
}

module.exports = {
  isE3RoutingEnabled,
  getE3RoutingDecision,
  compareRoutingDecisions,
  validateE3RoutingDecision,
  createE3FallbackHandler,

  // Constants
  E3_ROUTING_FLAG: 'CAMPUS_SUPPORT_ROUTING_V2',
  E3_DEFAULT_FLAG_VALUE: false,

  // Metadata
  phaseName: 'E3 — Controlled Routing Activation',
  modeDescription: 'Domain-based routing with feature flag control'
};
