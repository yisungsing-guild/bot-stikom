'use strict';

/**
 * src/reasoning/recommendationEngine.js
 *
 * Wave 2 Generalization:
 * Grounded Curriculum Profile Gathering & Neutral Recommendation Contract.
 *
 * Architectural Invariants:
 * 1. Single Grounding Authority: Consumes official programs and curriculum profiles
 *    from src/engine/programFitReasoning.js.
 * 2. Zero Heuristic Winner Crowning: Does NOT use static or heuristic scores, match-count
 *    bonuses, or gap thresholds to pre-select a single winning major before AI synthesis.
 * 3. Neutral Curriculum Representation: Assembles official curriculum profiles for relevant
 *    programs so the single AI synthesis stage can compare user semantic needs against
 *    official curriculum evidence, or so the fallback can present curriculum profiles neutrally.
 * 4. Separation of Concerns: recommendationEngine produces structured curriculum context
 *    (StructuredRecommendationResult) exclusively. Natural language synthesis and fallback
 *    rendering are owned by groundedAnswerGenerator.js.
 * 5. Mandatory Non-Absolute Invariant: Forbids absolute claims ("pasti cocok", "pasti pilih")
 *    and mandates PMB advisory.
 */

const {
  PROGRAMS,
  detectProgramFitSignals,
  isBroadSchoolBackgroundWithoutSpecificPreference
} = require('../engine/programFitReasoning');

const { validateProgramFeature } = require('./contracts');

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
 * Normalizes query text for whitespace and casing
 */
function normalizeQueryForSignals(queryText) {
  return String(queryText || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Assembles neutral curriculum candidate profiles from detected signals.
 * Does NOT assign heuristic or static fallback scores when signal.weights is absent.
 */
function computeCandidateScores(signals, options = {}) {
  const allowNeutralProfiles = Boolean(options.allowNeutralProfiles);
  const profileMap = new Map();

  for (const signal of signals) {
    if (!signal || !Array.isArray(signal.candidates)) continue;
    const isNeutralCatalogSignal = signal.key === 'official_curriculum_profiles' || allowNeutralProfiles;

    signal.candidates.forEach(([programKey, level, reason]) => {
      const progMeta = PROGRAMS[programKey];
      if (!progMeta) return;

      const canonicalName = PROGRAM_KEY_TO_CANONICAL[programKey] || progMeta.canonicalName || progMeta.label;
      const rawWeight = signal.weights
        ? (signal.weights[canonicalName] !== undefined ? signal.weights[canonicalName] : signal.weights[programKey])
        : undefined;
      const hasExplicitWeight = typeof rawWeight === 'number' && Number.isFinite(rawWeight) && rawWeight > 0;

      // Do not fabricate static scores for unweighed signals unless neutral profile gathering is active
      if (!hasExplicitWeight && !isNeutralCatalogSignal) {
        return;
      }

      if (!profileMap.has(programKey)) {
        profileMap.set(programKey, {
          programKey,
          canonicalName,
          label: progMeta.label,
          type: progMeta.type,
          grounding: progMeta.grounding,
          strengths: progMeta.strengths || [],
          studyFocus: progMeta.curriculumProfile?.studyFocus || progMeta.strengths.join(', '),
          suitableFor: progMeta.curriculumProfile?.suitableFor || '',
          careerProspects: progMeta.curriculumProfile?.careerProspects || '',
          rawScore: hasExplicitWeight ? Number(rawWeight.toFixed(4)) : null,
          levels: [],
          reasons: [],
          signals: []
        });
      }

      const entry = profileMap.get(programKey);
      if (hasExplicitWeight) {
        entry.rawScore = entry.rawScore !== null
          ? Number(Math.max(entry.rawScore, rawWeight).toFixed(4))
          : Number(rawWeight.toFixed(4));
      }
      entry.levels.push(level || 'candidate');
      entry.reasons.push(reason);
      entry.signals.push(signal.label);
    });
  }

  return Array.from(profileMap.values())
    .map((entry) => ({
      ...entry,
      confidence: 'NEUTRAL',
      level: 'candidate',
      signals: Array.from(new Set(entry.signals)),
      levels: Array.from(new Set(entry.levels)),
      reasons: Array.from(new Set(entry.reasons))
    }))
    .sort((a, b) => compareCodePoints(a.canonicalName, b.canonicalName))
    .map((cand, idx) => ({
      ...cand,
      rank: idx + 1
    }));
}

/**
 * Classifies presentation mode without crowning a single winner via heuristic score thresholds.
 * - BROAD_GUIDANCE: broad or ambiguous inquiry, or no candidate curriculum profiles
 * - NEUTRAL_CURRICULUM_OVERVIEW: multiple (or single) curriculum profiles assembled neutrally
 *   for AI grounded synthesis or neutral fallback comparison.
 */
function classifyPresentationType(isBroadGuidance, sortedCandidates, semanticFrame = {}) {
  if (
    isBroadGuidance ||
    semanticFrame?.ambiguityLevel === 'HIGH' ||
    !Array.isArray(sortedCandidates) ||
    sortedCandidates.length === 0
  ) {
    return 'BROAD_GUIDANCE';
  }

  return 'NEUTRAL_CURRICULUM_OVERVIEW';
}

/**
 * Evaluates user query and produces StructuredRecommendationResult containing
 * official curriculum profiles and parsed semantic frame without pre-locking a winning major.
 *
 * @param {string} rawQuery
 * @param {object} options
 * @param {object} [semanticFrameArg]
 * @param {Array} [evidenceListArg]
 * @returns {object} StructuredRecommendationResult
 */
function evaluateRecommendation(rawQuery, options = {}, semanticFrameArg = null, evidenceListArg = null) {
  const query = String(rawQuery || '').trim();
  const semanticFrame = semanticFrameArg || options.semanticFrame || {};
  const evidenceList = evidenceListArg || options.evidenceList || options.accepted || [];

  // 1. Broad / Ambiguous Check
  const isAmbiguous = semanticFrame?.ambiguityLevel === 'HIGH';
  const isBroad = isAmbiguous || isBroadSchoolBackgroundWithoutSpecificPreference(query, {
    ...options,
    canonical: semanticFrame
  });

  // 2. Gather Official Curriculum Profiles Neutrally (No regex/heuristic winner scoring)
  const normalizedQuery = normalizeQueryForSignals(query);
  const detectedRawSignals = isBroad
    ? []
    : detectProgramFitSignals(normalizedQuery, semanticFrame, evidenceList);

  // 3. Transform signals and validate against validateProgramFeature
  const detectedSignals = detectedRawSignals.map((sig) => {
    const weights = {};
    if (sig.weights && typeof sig.weights === 'object') {
      for (const [k, v] of Object.entries(sig.weights)) {
        const canonical = PROGRAM_KEY_TO_CANONICAL[k] || k;
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
          weights[canonical] = Number(v.toFixed(2));
        }
      }
    }

    const feature = {
      featureKey: sig.key,
      label: sig.label,
      evidenceSource: sig.evidenceSource || 'Pedoman Akademik & Kurikulum Resmi ITB STIKOM Bali',
      evidenceSnippet: sig.evidenceSnippet || sig.candidates.map(([k, , r]) => `${PROGRAM_KEY_TO_CANONICAL[k] || k}: ${r}`).join('; '),
      weights
    };

    const validation = validateProgramFeature(feature);
    if (!validation.valid) {
      throw new Error(`[RecommendationEngine] Feature contract violation: ${validation.reason}`);
    }

    return feature;
  });

  // 4. Assemble Neutral Candidate Curriculum Profiles (deterministic code-point order, no winner ranking)
  const scoredCandidates = isBroad
    ? []
    : computeCandidateScores(detectedRawSignals, { allowNeutralProfiles: true });

  // 5. Classify Presentation Type (Never forces DOMINANT_SINGLE from heuristic scores)
  const presentationType = classifyPresentationType(isBroad, scoredCandidates, semanticFrame);

  // 6. Build Neutral Context Relations
  const contextRelations = [];
  if (scoredCandidates.length >= 2) {
    contextRelations.push({
      source: scoredCandidates[0].canonicalName,
      relation: 'curriculum_option',
      target: scoredCandidates[1].canonicalName,
      reason: scoredCandidates[1].reasons[0] || `Fokus pada ${scoredCandidates[1].studyFocus}`
    });
  }

  return {
    mode: 'RECOMMENDATION',
    query,
    isBroadGuidance: isBroad,
    isAmbiguous,
    semanticFrame: semanticFrameArg || options.semanticFrame || null,
    detectedSignals,
    scoredCandidates,
    presentationType,
    contextRelations,
    provenance: {
      rule: 'AI_LED_CURRICULUM_SYNTHESIS_V3',
      sourceAuthority: 'programFitReasoning_v2_neutral_profiles',
      version: 'wave2-final'
    }
  };
}

module.exports = {
  compareCodePoints,
  normalizeQueryForSignals,
  computeCandidateScores,
  classifyPresentationType,
  evaluateRecommendation
};
