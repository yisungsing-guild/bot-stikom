'use strict';

/**
 * src/reasoning/recommendationEngine.js
 *
 * Phase 2 Step 7: Deterministic Recommendation Engine & Scoring Contract.
 *
 * Architectural Invariants:
 * 1. Single Grounding Authority: Consumes official programs and signals from src/engine/programFitReasoning.js.
 * 2. Strict Score Authority: Uses rawScore and confidence exclusively. No normalizedScore, no magic multipliers.
 * 3. Candidate Ordering: Descending by rawScore, with Unicode code-point tie-breaking via compareCodePoints(a.canonicalName, b.canonicalName).
 * 4. Presentation Type: Single deterministic rule with RAW_SCORE_DOMINANT_THRESHOLD = 2.0 (authorized Step 7 contract):
 *    - BROAD_GUIDANCE: isBroadGuidance || candidates.length === 0
 *    - DOMINANT_SINGLE: candidates.length === 1 || rawGap >= 2.0
 *    - BALANCED_DUAL: rawGap < 2.0
 * 5. Separation of Concerns: recommendationEngine produces structured data (StructuredRecommendationResult) exclusively.
 *    Natural language rendering is owned by the orchestration/synthesis lifecycle in src/core/groundedAnswerGenerator.js.
 * 6. Mandatory Non-Absolute Invariant: Forbids absolute claims ("pasti cocok", "pasti pilih") and mandates PMB advisory.
 */

const {
  PROGRAMS,
  SIGNALS,
  detectProgramFitSignals,
  isBroadSchoolBackgroundWithoutSpecificPreference,
  buildBroadBackgroundProgramGuidanceAnswer
} = require('../engine/programFitReasoning');

const { validateProgramFeature } = require('./contracts');

// Authorized Step 7 contract constant (derived from base score delta: primary 4 - alternative 2 = 2.0)
const RAW_SCORE_DOMINANT_THRESHOLD = 2.0;

// Canonical program names mapping
const PROGRAM_KEY_TO_CANONICAL = Object.freeze({
  si: 'S1 Sistem Informasi',
  ti: 'S1 Teknologi Informasi',
  sk: 'S1 Sistem Komputer',
  bd: 'S1 Bisnis Digital',
  mi: 'D3 Manajemen Informatika',
  utb: 'Double Degree UTB',
  dnui: 'Double Degree DNUI',
  help: 'Double Degree HELP University'
});

/**
 * Deterministic Unicode Code-Point comparator
 */
function compareCodePoints(strA, strB) {
  const normA = String(strA || '').normalize('NFC');
  const normB = String(strB || '').normalize('NFC');
  if (normA === normB) return 0;
  return normA < normB ? -1 : 1;
}

/**
 * Normalizes colloquial Indonesian query text for reliable signal detection
 * without altering semantic meaning (e.g. medsos -> sosmed, tiktok -> konten sosmed)
 */
function normalizeQueryForSignals(queryText) {
  return String(queryText || '')
    .toLowerCase()
    .replace(/\bmedsos\b/gi, 'sosmed')
    .replace(/\btiktok\b/gi, 'konten sosmed')
    .replace(/\blive\s+streaming\b/gi, 'streaming konten')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Evaluates candidate scores deterministically from detected signals
 */
function computeCandidateScores(signals) {
  const scoreMap = new Map();

  for (const signal of signals) {
    signal.candidates.forEach(([programKey, level, reason], index) => {
      const base = level === 'primary' ? 4 : level === 'alternative' ? 2 : 1;
      const score = base + Math.max(0, 3 - index) * 0.1;
      const progMeta = PROGRAMS[programKey];
      if (!progMeta) return;

      if (!scoreMap.has(programKey)) {
        scoreMap.set(programKey, {
          programKey,
          canonicalName: PROGRAM_KEY_TO_CANONICAL[programKey] || progMeta.label,
          label: progMeta.label,
          type: progMeta.type,
          grounding: progMeta.grounding,
          strengths: progMeta.strengths || [],
          rawScore: 0,
          levels: [],
          reasons: [],
          signals: []
        });
      }

      const entry = scoreMap.get(programKey);
      entry.rawScore = Number((entry.rawScore + score).toFixed(4));
      entry.levels.push(level);
      entry.reasons.push(reason);
      entry.signals.push(signal.label);
    });
  }

  // Convert to candidate array and apply authorized candidate ordering
  return Array.from(scoreMap.values())
    .map((entry) => ({
      ...entry,
      confidence: entry.rawScore >= 4 ? 'HIGH' : entry.rawScore >= 2 ? 'MEDIUM' : 'LOW',
      level: entry.levels.includes('primary') ? 'primary' : (entry.levels.includes('alternative') ? 'alternative' : 'supporting'),
      signals: Array.from(new Set(entry.signals)),
      levels: Array.from(new Set(entry.levels)),
      reasons: Array.from(new Set(entry.reasons))
    }))
    .sort((a, b) => {
      const scoreDiff = b.rawScore - a.rawScore;
      if (Math.abs(scoreDiff) > 1e-9) {
        return scoreDiff;
      }
      return compareCodePoints(a.canonicalName, b.canonicalName);
    })
    .map((cand, idx) => ({
      ...cand,
      rank: idx + 1
    }));
}

/**
 * Classifies presentation type using the authorized single deterministic rule
 */
function classifyPresentationType(isBroadGuidance, sortedCandidates) {
  if (isBroadGuidance || !Array.isArray(sortedCandidates) || sortedCandidates.length === 0) {
    return 'BROAD_GUIDANCE';
  }

  if (sortedCandidates.length === 1) {
    return 'DOMINANT_SINGLE';
  }

  const rawGap = sortedCandidates[0].rawScore - sortedCandidates[1].rawScore;

  if (rawGap >= RAW_SCORE_DOMINANT_THRESHOLD) {
    return 'DOMINANT_SINGLE';
  }

  return 'BALANCED_DUAL';
}

/**
 * Evaluates user query and produces StructuredRecommendationResult
 *
 * @param {string} rawQuery
 * @param {object} options
 * @returns {object} StructuredRecommendationResult
 */
function evaluateRecommendation(rawQuery, options = {}) {
  const query = String(rawQuery || '').trim();
  const maxCandidates = Number.isFinite(options.maxCandidates) ? options.maxCandidates : 3;

  // 1. Broad School Background Check (e.g. SMK Komputer without specific career/hobby preference)
  const isBroad = isBroadSchoolBackgroundWithoutSpecificPreference(query, options);

  // 2. Extract Signals with Normalized Wording
  const normalizedQuery = normalizeQueryForSignals(query);
  const detectedRawSignals = detectProgramFitSignals(normalizedQuery);

  // 3. Transform signals and validate against validateProgramFeature
  const detectedSignals = detectedRawSignals.map((sig) => {
    const weights = {};
    sig.candidates.forEach(([progKey, level, reason], index) => {
      const canonical = PROGRAM_KEY_TO_CANONICAL[progKey] || progKey;
      const base = level === 'primary' ? 4 : level === 'alternative' ? 2 : 1;
      weights[canonical] = Number((base + Math.max(0, 3 - index) * 0.1).toFixed(2));
    });

    const feature = {
      featureKey: sig.key,
      label: sig.label,
      evidenceSource: 'Pedoman Akademik & Kurikulum Resmi ITB STIKOM Bali',
      evidenceSnippet: sig.candidates.map(([k, lvl, r]) => `${PROGRAM_KEY_TO_CANONICAL[k] || k}: ${r}`).join('; '),
      weights
    };

    // Strict validation against Step 1 Contract
    const validation = validateProgramFeature(feature);
    if (!validation.valid) {
      throw new Error(`[RecommendationEngine] Feature contract violation: ${validation.reason}`);
    }

    return feature;
  });

  // 4. Compute Candidates with authorized ordering & tie-breaking
  const allCandidates = isBroad ? [] : computeCandidateScores(detectedRawSignals);
  const scoredCandidates = allCandidates.slice(0, Math.max(1, maxCandidates));

  // 5. Classify Presentation Type (Single authorized rule)
  const presentationType = classifyPresentationType(isBroad, scoredCandidates);

  // 6. Build Context Relations (for Step 4 context propagation)
  const contextRelations = [];
  if (scoredCandidates.length >= 2) {
    contextRelations.push({
      source: scoredCandidates[0].canonicalName,
      relation: 'alternative',
      target: scoredCandidates[1].canonicalName,
      reason: scoredCandidates[1].reasons[0] || `Fokus pada ${scoredCandidates[1].strengths.slice(0, 3).join(', ')}`
    });
  }

  // 7. Structured Result (Pure structured data - no natural language rendering in engine)
  return {
    mode: 'RECOMMENDATION',
    query,
    isBroadGuidance: isBroad,
    detectedSignals,
    scoredCandidates,
    presentationType,
    contextRelations,
    provenance: {
      rule: 'DETERMINISTIC_RECOMMENDATION_V2',
      dominantThreshold: RAW_SCORE_DOMINANT_THRESHOLD,
      sourceAuthority: 'programFitReasoning_v1',
      version: 'phase2-step7'
    }
  };
}

module.exports = {
  RAW_SCORE_DOMINANT_THRESHOLD,
  compareCodePoints,
  normalizeQueryForSignals,
  computeCandidateScores,
  classifyPresentationType,
  evaluateRecommendation
};
