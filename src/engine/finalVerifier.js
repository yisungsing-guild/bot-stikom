'use strict';

/**
 * finalVerifier.js
 *
 * Final Verifier Layer.
 *
 * Sits strictly downstream of Grounded Composer and upstream of final rendering.
 *
 * INVARIANTS:
 * 1. ZERO RETRIEVAL: Never runs searches, queries, or provider calls (FINAL_VERIFIER_RETRIEVAL_COUNT = 0).
 * 2. ZERO FACT INJECTION: Never creates facts or supplies missing values (FINAL_VERIFIER_FACT_INJECTION_COUNT = 0).
 * 3. ZERO REINTERPRETATION: Never reparses query or overrides evaluator status (FINAL_VERIFIER_SEMANTIC_REINTERPRETATION_COUNT = 0).
 * 4. STRUCTURED ATOM VERIFICATION: Verifies structured claim atoms and evidence IDs directly;
 *    does not attempt fuzzy semantic truth reconstruction from arbitrary prose.
 */

const VERIFIER_DECISION = Object.freeze({
  PASS: 'PASS',
  BLOCK: 'BLOCK',
  REQUEST_RECOMPOSE: 'REQUEST_RECOMPOSE'
});

/**
 * Verifies a GroundedAnswerPlan against the authoritative evaluation report.
 *
 * @param {object} answerPlan GroundedAnswerPlan produced by GroundedComposer
 * @param {object} evaluation Central Evidence Evaluation Report
 * @param {object} frame Authoritative EffectiveSemanticFrame
 * @returns {{ decision: string, reason: string, details: object }}
 */
function verifyGroundedAnswerPlan(answerPlan, evaluation, frame) {
  if (!answerPlan || typeof answerPlan !== 'object') {
    return {
      decision: VERIFIER_DECISION.BLOCK,
      reason: 'Missing or malformed GroundedAnswerPlan',
      details: { ungroundedClaims: [] }
    };
  }

  if (!evaluation || !evaluation.resultsByBinding) {
    // If evaluator report is missing, only empty or unsupported plans can pass
    if (Array.isArray(answerPlan.bindings) && answerPlan.bindings.some(b => b.claims && b.claims.length > 0)) {
      return {
        decision: VERIFIER_DECISION.BLOCK,
        reason: 'Claims present without authoritative evaluation report',
        details: { ungroundedClaims: answerPlan.bindings.flatMap(b => b.claims || []) }
      };
    }
    return {
      decision: VERIFIER_DECISION.PASS,
      reason: 'No factual claims present',
      details: {}
    };
  }

  const resultsByBinding = evaluation.resultsByBinding;
  const ungroundedClaims = [];
  const invalidEvidenceLinks = [];
  const ungroundedNumerics = [];

  for (const b of (answerPlan.bindings || [])) {
    const evalBinding = resultsByBinding[b.bindingId];

    // Check 1: Evaluator status parity
    if (!evalBinding) {
      if (b.claims && b.claims.length > 0) {
        ungroundedClaims.push({
          bindingId: b.bindingId,
          reason: 'Binding does not exist in central evaluation report'
        });
      }
      continue;
    }

    // Check 2: If evaluator declared UNSUPPORTED, composer must NOT assert factual claims
    if (evalBinding.status === 'UNSUPPORTED') {
      if (b.claims && b.claims.length > 0) {
        ungroundedClaims.push({
          bindingId: b.bindingId,
          reason: `Evaluator status is UNSUPPORTED but composer generated ${b.claims.length} claims`
        });
      }
      continue;
    }

    // Check 3: Structured claim verification for SUPPORTED and PARTIALLY_SUPPORTED
    const supportedFacts = Array.isArray(evalBinding.supportedFacts) ? evalBinding.supportedFacts : [];
    const supportedFieldValues = supportedFacts.map(f => String(f.value || f.structuredValue || ''));

    for (const claim of (b.claims || [])) {
      // 3a. Required structured fields
      if (!claim.claimId || !claim.bindingId || !claim.entity || !claim.field || (!claim.value && !claim.proposition)) {
        ungroundedClaims.push({
          claimId: claim.claimId || 'missing_id',
          reason: 'Claim missing required structured fields (claimId, bindingId, entity, field, value/proposition)'
        });
        continue;
      }

      // 3b. Evidence IDs must exist and match evaluator matched evidence
      if (!Array.isArray(claim.evidenceIds) || claim.evidenceIds.length === 0) {
        invalidEvidenceLinks.push({
          claimId: claim.claimId,
          reason: 'Claim is missing required evidence IDs'
        });
        continue;
      }

      const hasValidEvidence = claim.evidenceIds.some(evId =>
        (evalBinding.matchedEvidenceIds || []).includes(evId) ||
        supportedFacts.some(f => f.evidenceId === evId || f.sourceId === evId)
      );

      if (!hasValidEvidence) {
        invalidEvidenceLinks.push({
          claimId: claim.claimId,
          reason: 'Claim references evidenceId not approved by central evidence evaluator'
        });
      }

      // 3b. Numeric and institutional value safety
      const claimValStr = String(claim.value || '');
      const numbersInClaim = claimValStr.match(/\b(?:\d{1,3}(?:\.\d{3})+|\d+)\b/g) || [];

      for (const num of numbersInClaim) {
        // Must appear in at least one supported fact text
        const isNumSupported = supportedFieldValues.some(sfv => sfv.includes(num));
        if (!isNumSupported) {
          ungroundedNumerics.push({
            claimId: claim.claimId,
            numericValue: num,
            reason: `Numeric value '${num}' does not originate from verified evidence text`
          });
        }
      }
    }
  }

  if (ungroundedClaims.length > 0) {
    return {
      decision: VERIFIER_DECISION.BLOCK,
      reason: `Found ${ungroundedClaims.length} ungrounded claims without evaluator support`,
      details: { ungroundedClaims, invalidEvidenceLinks, ungroundedNumerics }
    };
  }

  if (invalidEvidenceLinks.length > 0) {
    return {
      decision: VERIFIER_DECISION.BLOCK,
      reason: `Found ${invalidEvidenceLinks.length} claims with invalid evidence IDs`,
      details: { ungroundedClaims, invalidEvidenceLinks, ungroundedNumerics }
    };
  }

  if (ungroundedNumerics.length > 0) {
    return {
      decision: VERIFIER_DECISION.BLOCK,
      reason: `Found ${ungroundedNumerics.length} ungrounded numeric values in claims`,
      details: { ungroundedClaims, invalidEvidenceLinks, ungroundedNumerics }
    };
  }

  return {
    decision: VERIFIER_DECISION.PASS,
    reason: 'All claims verified against central evidence evaluator',
    details: {
      verifiedBindingsCount: (answerPlan.bindings || []).length,
      verifiedClaimsCount: (answerPlan.bindings || []).reduce((acc, b) => acc + (b.claims?.length || 0), 0)
    }
  };
}

module.exports = {
  VERIFIER_DECISION,
  verifyGroundedAnswerPlan
};
