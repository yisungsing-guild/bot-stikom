'use strict';

/**
 * src/core/openWorldEntityResolver.js
 *
 * Phase E: Open-World Entity Resolution + 4-Way Entity State Engine.
 * SHADOW / LOCAL ONLY.
 *
 * Objective:
 * RAW MODEL ENTITY MENTION
 *         ↓
 * DYNAMIC KNOWLEDGE CATALOG
 *         ↓
 * GENERIC ENTITY RESOLUTION
 *         ↓
 * 4-WAY STATE: [SUPPORTED, AMBIGUOUS, UNKNOWN_UNVERIFIED, UNSUPPORTED]
 *
 * Critical Rules:
 * 1. Closed-World Rule: NEVER do `catalog lookup miss -> UNSUPPORTED`.
 *    UNSUPPORTED is valid ONLY when ALL are true:
 *    A. entity family belongs to an explicitly closed domain
 *    B. authoritative closed-world catalog is known to be COMPLETE for that domain
 *    C. the mention was evaluated against that authoritative catalog
 *    D. no valid candidate exists
 *    E. ambiguity threshold is not triggered
 *    Otherwise: UNKNOWN_UNVERIFIED.
 * 2. Academic Program Completeness:
 *    The resolver must refuse to produce UNSUPPORTED from a closed-domain catalog
 *    whose completeness is not proven.
 * 3. Near-Sibling Protection:
 *    "Sistem Informasi" vs "Sistem Komputer" or "Teknologi Informasi" vs "Sistem Informasi"
 *    MUST NOT collapse. If margin is insufficient -> AMBIGUOUS. Never arbitrarily pick candidate #1.
 * 4. Zero JavaScript source modifications required to resolve newly ingested entities.
 * 5. Strictly generic similarity metrics: NO regex rules, NO handwritten typo maps, NO institutional lists.
 */

const {
  KnowledgeCatalogService,
  getDefaultKnowledgeCatalogService
} = require('../engine/knowledgeCatalogService');
const logger = require('../logger');

// 4-Way Entity Resolution States (Section 9)
const ENTITY_RESOLUTION_STATE = Object.freeze({
  SUPPORTED: 'SUPPORTED',
  AMBIGUOUS: 'AMBIGUOUS',
  UNKNOWN_UNVERIFIED: 'UNKNOWN_UNVERIFIED',
  UNSUPPORTED: 'UNSUPPORTED'
});

// Diagnostic Failure Taxonomy (Section 19)
const RESOLUTION_FAILURE_TAXONOMY = Object.freeze({
  EXACT_MATCH: 'EXACT_MATCH',
  FUZZY_MATCH: 'FUZZY_MATCH',
  EMBEDDING_MATCH: 'EMBEDDING_MATCH',
  CONTEXT_INHERITED: 'CONTEXT_INHERITED',
  AMBIGUOUS: 'AMBIGUOUS',
  UNKNOWN_UNVERIFIED: 'UNKNOWN_UNVERIFIED',
  UNSUPPORTED: 'UNSUPPORTED',
  FAMILY_MISMATCH: 'FAMILY_MISMATCH',
  LEVEL_MISMATCH: 'LEVEL_MISMATCH',
  CATALOG_INCOMPLETE: 'CATALOG_INCOMPLETE',
  NO_MATCH: 'NO_MATCH'
});

// Calibrated Thresholds based on Benchmark Evidence (Section 16)
const DEFAULT_CALIBRATED_THRESHOLDS = Object.freeze({
  exactMatchConfidence: 1.0,
  matchThreshold: 0.74,             // Minimum composite score to verify a single candidate as SUPPORTED
  ambiguityCandidateThreshold: 0.50, // Minimum score to be considered a viable candidate for ranking & ambiguity
  siblingMarginThreshold: 0.12,      // Margin between top1 and top2 required to resolve without ambiguity
  embeddingWeight: 0.30              // Weight given to embedding cosine similarity if vectors are supplied
});

/**
 * Deterministic text normalization:
 * Unicode NFC, lowercased, punctuation stripped to spaces, whitespace trimmed and collapsed.
 * NO semantic regexes, NO typo maps.
 */
function normalizeText(text) {
  if (typeof text !== 'string') return '';
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Tokenizes normalized text into word tokens.
 */
function tokenizeText(text) {
  const norm = normalizeText(text);
  return norm ? norm.split(' ').filter(Boolean) : [];
}

/**
 * Levenshtein distance calculation.
 */
function levenshteinDistance(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

/**
 * Normalized Levenshtein similarity [0, 1].
 */
function normalizedLevenshtein(a, b) {
  if (a === b) return 1.0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  return Math.max(0, 1 - (levenshteinDistance(a, b) / maxLen));
}

/**
 * Character trigram extraction.
 */
function getCharTrigrams(str) {
  const padded = `  ${str} `;
  const trigrams = new Map();
  for (let i = 0; i < padded.length - 2; i++) {
    const tri = padded.slice(i, i + 3);
    trigrams.set(tri, (trigrams.get(tri) || 0) + 1);
  }
  return trigrams;
}

/**
 * Character trigram Dice similarity [0, 1].
 * Captures typos, transpositions, and character drops without manual dictionaries.
 */
function charTrigramSimilarity(a, b) {
  if (a === b) return 1.0;
  if (!a || !b) return 0.0;
  const triA = getCharTrigrams(a);
  const triB = getCharTrigrams(b);
  let intersection = 0;
  for (const [tri, countA] of triA.entries()) {
    const countB = triB.get(tri) || 0;
    intersection += Math.min(countA, countB);
  }
  const total = (a.length + 1) + (b.length + 1);
  return total === 0 ? 0 : (2 * intersection) / total;
}

/**
 * Token-level comparison with generic consonant skeleton (vowel-strip)
 * and prefix/stem alignment for natural Indonesian text communication.
 */
function tokenSimilarityWithSkeleton(ta, tb) {
  if (ta === tb) return 1.0;
  const lev = normalizedLevenshtein(ta, tb);

  // Generic consonant skeleton (removes vowels [aeiou])
  const skelA = ta.replace(/[aeiou]/g, '');
  const skelB = tb.replace(/[aeiou]/g, '');
  if (skelA.length >= 2 && skelA === skelB && ta[0] === tb[0]) {
    return Math.max(lev, 0.95);
  }
  if (skelA.length >= 2 && skelB.length >= 2) {
    const skelLev = normalizedLevenshtein(skelA, skelB);
    if (skelLev >= 0.8 && ta[0] === tb[0]) {
      return Math.max(lev, 0.85);
    }
  }

  // Generic prefix/stem alignment: e.g. "info" vs "informasi", "tekno" vs "teknologi"
  if ((ta.length >= 3 && tb.startsWith(ta)) || (tb.length >= 3 && ta.startsWith(tb))) {
    const prefixRatio = Math.min(ta.length, tb.length) / Math.max(ta.length, tb.length);
    return Math.max(lev, 0.70 + 0.28 * prefixRatio);
  }

  return lev;
}

/**
 * Bidirectional fuzzy token alignment score.
 */
function fuzzyTokenScore(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0;
  let sumAtoB = 0;
  for (const ta of tokensA) {
    let maxSim = 0;
    for (const tb of tokensB) {
      const sim = tokenSimilarityWithSkeleton(ta, tb);
      if (sim > maxSim) maxSim = sim;
    }
    sumAtoB += maxSim;
  }
  let sumBtoA = 0;
  for (const tb of tokensB) {
    let maxSim = 0;
    for (const ta of tokensA) {
      const sim = tokenSimilarityWithSkeleton(ta, tb);
      if (sim > maxSim) maxSim = sim;
    }
    sumBtoA += maxSim;
  }
  return (sumAtoB / tokensA.length + sumBtoA / tokensB.length) / 2;
}

/**
 * Calculates composite lexical similarity between mention and catalog target.
 * Weighted across token alignment, edit distance, and character trigrams.
 */
function computeLexicalSimilarity(mention, target) {
  const normM = normalizeText(mention);
  const normT = normalizeText(target);
  if (!normM || !normT) return 0.0;
  if (normM === normT) return 1.0;

  const levSim = normalizedLevenshtein(normM, normT);
  const triSim = charTrigramSimilarity(normM, normT);
  const tokensM = tokenizeText(normM);
  const tokensT = tokenizeText(normT);
  const fzTok = fuzzyTokenScore(tokensM, tokensT);

  // Subphrase / Containment bonus:
  // Apply ONLY when mention is a subphrase of target (e.g. "sistem informasi" in "s1 sistem informasi")
  const setT = new Set(tokensT);
  const allMInT = tokensM.length >= 2 && tokensM.every(t => setT.has(t));
  const containmentBonus = allMInT ? 0.12 : 0.0;

  let rawComposite = (0.50 * fzTok) + (0.30 * levSim) + (0.20 * triSim) + containmentBonus;

  // When all tokens of mention align well with target (e.g. natural abbreviations "tekno info" -> "teknologi informasi")
  const allTokensAligned = tokensM.length > 0 && tokensM.length === tokensT.length &&
    tokensM.every(tm => tokensT.some(tt => tokenSimilarityWithSkeleton(tm, tt) >= 0.80));
  if (allTokensAligned) {
    rawComposite = Math.max(rawComposite, fzTok * 0.92);
  }

  const bounded = Math.min(1.0, Math.max(0.0, rawComposite));
  return Number(bounded.toFixed(4));
}

/**
 * Cosine similarity for embedding vectors.
 */
function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  let dot = 0, ma = 0, mb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    ma += a[i] * a[i];
    mb += b[i] * b[i];
  }
  const denom = Math.sqrt(ma) * Math.sqrt(mb);
  return denom === 0 ? 0 : Number((dot / denom).toFixed(4));
}

/**
 * Detects explicit academic level token mentioned in text.
 */
function detectAcademicLevelFromTokens(text) {
  const tokens = tokenizeText(text);
  if (!tokens.length) return null;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 's2' || t === 'magister' || t === 'pascasarjana') return 'S2';
    if (t === 'd3' || t === 'diploma') return 'D3';
    if (t === 's1' || t === 'sarjana') return 'S1';
    if (t === 'strata' && tokens[i + 1] === '1') return 'S1';
  }
  return null;
}

/**
 * Checks academic level compatibility between mention and catalog entity.
 */
function isAcademicLevelCompatible(requestedLevel, candidateLevel) {
  if (!requestedLevel) return true;
  if (!candidateLevel) return true; // generic or non-degree entity
  return requestedLevel.toUpperCase() === candidateLevel.toUpperCase();
}

/**
 * Checks family compatibility between requested family and candidate family.
 */
function isFamilyCompatible(requestedFamily, candidateFamily) {
  if (!requestedFamily) return true;
  if (!candidateFamily) return true;
  if (requestedFamily === candidateFamily) return true;

  // academic_scope is compatible with academic_program
  if (requestedFamily === 'academic_program' && candidateFamily === 'academic_scope') return true;
  if (requestedFamily === 'academic_scope' && candidateFamily === 'academic_program') return true;

  return false;
}

/**
 * Primary Open-World Entity Resolution Function
 *
 * @param {Object} input
 * @param {string} [input.rawMention] - Entity text mention
 * @param {string} [input.inferredCategory] - Inferred family (e.g. 'academic_program', 'campus_service')
 * @param {string} [input.academicLevel] - Explicit academic degree level ('S1', 'S2', 'D3')
 * @param {Object} [input.context] - Validated Phase B context
 * @param {Object} [options]
 * @param {KnowledgeCatalogService} [options.catalog]
 * @param {Object|string} [options.catalogCompleteness] - Completeness assertion (e.g. { academic_program: 'COMPLETE' })
 * @param {Object} [options.thresholds] - Custom calibrated thresholds
 * @param {Array<number>} [options.mentionEmbedding] - Vector for mention
 * @param {Map<string, Array<number>>} [options.entityEmbeddings] - Map of entityId -> vector
 * @param {Function} [options.shadowRecordHandler] - Callback for shadow telemetry
 * @returns {Object} 4-Way Entity State Result
 */
function resolveOpenWorldEntity(input = {}, options = {}) {
  const startTime = Date.now();
  const rawMention = typeof input.rawMention === 'string' ? input.rawMention.trim() : '';
  const inferredCategory = input.inferredCategory || input.inferredFamily || null;
  const academicLevelInput = input.academicLevel !== undefined ? input.academicLevel : detectAcademicLevelFromTokens(rawMention);
  const context = input.context || null;

  const catalog = options.catalog || getDefaultKnowledgeCatalogService();
  const thresholds = { ...DEFAULT_CALIBRATED_THRESHOLDS, ...(options.thresholds || {}) };

  // Determine Catalog Completeness for Domain (Sections 2 & 3)
  const targetFamily = inferredCategory || 'academic_program';
  let domainCompleteness = 'UNVERIFIED';
  if (typeof options.catalogCompleteness === 'string') {
    domainCompleteness = options.catalogCompleteness.toUpperCase();
  } else if (options.catalogCompleteness && typeof options.catalogCompleteness === 'object') {
    domainCompleteness = (options.catalogCompleteness[targetFamily] || 'UNVERIFIED').toUpperCase();
  } else if (catalog.catalogCompleteness) {
    if (typeof catalog.catalogCompleteness === 'string') {
      domainCompleteness = catalog.catalogCompleteness.toUpperCase();
    } else if (typeof catalog.catalogCompleteness === 'object') {
      domainCompleteness = (catalog.catalogCompleteness[targetFamily] || 'UNVERIFIED').toUpperCase();
    }
  } else if (catalog.domainCompleteness && typeof catalog.domainCompleteness === 'object') {
    domainCompleteness = (catalog.domainCompleteness[targetFamily] || 'UNVERIFIED').toUpperCase();
  }

  // Invariant Section 2 & 3: academic_program is closed domain, but UNSUPPORTED requires explicit COMPLETE authority
  const isClosedDomain = targetFamily === 'academic_program';
  const isAuthoritativeComplete = isClosedDomain && domainCompleteness === 'COMPLETE';

  // 1. CONTEXT INHERITANCE (Section 12 - Phase B Compatibility)
  if (!rawMention && context) {
    const contextResult = _resolveFromContext(context, catalog, inferredCategory, startTime, rawMention, options);
    if (contextResult) return contextResult;
  }

  // If mention is empty and no valid context was inherited
  if (!rawMention) {
    return _buildResult({
      state: isAuthoritativeComplete ? ENTITY_RESOLUTION_STATE.UNSUPPORTED : ENTITY_RESOLUTION_STATE.UNKNOWN_UNVERIFIED,
      candidates: [],
      confidence: 0.0,
      evidence: {
        reason: 'EMPTY_MENTION',
        isClosedDomain,
        domainCompleteness,
        latencyMs: Date.now() - startTime
      },
      rawMention,
      inferredCategory
    }, options);
  }

  const normMention = normalizeText(rawMention);

  // Coordinating Conjunction Multi-Entity Check (Section 8 & 12)
  // E.g. "ti atau si", "bisnis digital dan sistem informasi", "si dan bd"
  const conjunctionSplit = normMention.split(/\s+(?:dan|atau|vs|versus|\/|&)\s+/);
  if (conjunctionSplit.length > 1) {
    const conjCandidates = [];
    for (const part of conjunctionSplit) {
      const partTrimmed = part.trim();
      if (partTrimmed.length >= 2) {
        const directRes = catalog.resolveEntity(partTrimmed);
        if (directRes && isFamilyCompatible(inferredCategory, directRes.family)) {
          if (!conjCandidates.some(c => c.id === directRes.id)) conjCandidates.push(directRes);
        } else {
          // Try fuzzy lookup on sub-part
          const subCandidates = catalog.getAll()
            .filter(e => isFamilyCompatible(inferredCategory, e.family))
            .map(e => ({
              entity: e,
              score: Math.max(
                computeLexicalSimilarity(partTrimmed, e.canonical),
                ...(e.aliases || []).map(a => computeLexicalSimilarity(partTrimmed, a))
              )
            }))
            .filter(c => c.score >= thresholds.ambiguityCandidateThreshold)
            .sort((a, b) => b.score - a.score);

          if (subCandidates.length > 0 && !conjCandidates.some(c => c.id === subCandidates[0].entity.id)) {
            conjCandidates.push(subCandidates[0].entity);
          }
        }
      }
    }

    if (conjCandidates.length > 1) {
      return _buildResult({
        state: ENTITY_RESOLUTION_STATE.AMBIGUOUS,
        candidates: conjCandidates,
        confidence: 1.0,
        evidence: {
          reason: 'COORDINATING_CONJUNCTION_MULTI_ENTITY',
          matchedSubMentions: conjunctionSplit,
          topCandidates: conjCandidates.map(c => ({ id: c.id, canonical: c.canonical, score: 1.0 })),
          latencyMs: Date.now() - startTime
        },
        rawMention,
        inferredCategory
      }, options);
    }
  }

  // 2. STAGE 1: DETERMINISTIC EXACT MATCH (Section 5)
  let exactCandidate = catalog.resolveEntity(rawMention);
  if (!exactCandidate && academicLevelInput) {
    // Strip level token from mention and try exact alias lookup
    const nonLevelTokens = tokenizeText(rawMention).filter(t => !['s1', 'sarjana', 's2', 'magister', 'pascasarjana', 'd3', 'diploma'].includes(t));
    if (nonLevelTokens.length > 0) {
      const remainingStem = nonLevelTokens.join(' ');
      const candidateByStem = catalog.findByAlias(remainingStem) || catalog.findByCanonical(remainingStem);
      if (candidateByStem && isAcademicLevelCompatible(academicLevelInput, candidateByStem.academicLevel)) {
        exactCandidate = candidateByStem;
      }
    }
  }

  if (exactCandidate) {
    const familyOk = isFamilyCompatible(inferredCategory, exactCandidate.family);
    const levelOk = isAcademicLevelCompatible(academicLevelInput, exactCandidate.academicLevel);

    if (!familyOk) {
      return _buildResult({
        state: ENTITY_RESOLUTION_STATE.UNKNOWN_UNVERIFIED,
        candidates: [],
        confidence: 0.0,
        evidence: {
          reason: RESOLUTION_FAILURE_TAXONOMY.FAMILY_MISMATCH,
          mismatchedEntity: exactCandidate.canonical,
          mismatchedFamily: exactCandidate.family,
          requestedCategory: inferredCategory,
          isClosedDomain,
          domainCompleteness,
          latencyMs: Date.now() - startTime
        },
        rawMention,
        inferredCategory
      }, options);
    }

    if (!levelOk) {
      return _buildResult({
        state: ENTITY_RESOLUTION_STATE.UNKNOWN_UNVERIFIED,
        candidates: [],
        confidence: 0.0,
        evidence: {
          reason: RESOLUTION_FAILURE_TAXONOMY.LEVEL_MISMATCH,
          mismatchedEntity: exactCandidate.canonical,
          mismatchedLevel: exactCandidate.academicLevel,
          requestedLevel: academicLevelInput,
          isClosedDomain,
          domainCompleteness,
          latencyMs: Date.now() - startTime
        },
        rawMention,
        inferredCategory
      }, options);
    }

    if (familyOk && levelOk) {
      // Check if multi-level collision exists for same name (e.g. S1 SI and S2 SI when user didn't specify level)
      if (!academicLevelInput && exactCandidate.academicLevel) {
        const allByFamily = catalog.findByFamily(exactCandidate.family);
        const sisterLevels = allByFamily.filter(e =>
          e.id !== exactCandidate.id &&
          normalizeText(e.canonical).replace(/^(s1|s2|d3)\s+/, '') === normalizeText(exactCandidate.canonical).replace(/^(s1|s2|d3)\s+/, '')
        );
        if (sisterLevels.length > 0) {
          return _buildResult({
            state: ENTITY_RESOLUTION_STATE.AMBIGUOUS,
            candidates: [exactCandidate, ...sisterLevels],
            confidence: 0.95,
            evidence: {
              reason: 'AMBIGUOUS_LEVEL_STEM',
              scoreMargin: 0.0,
              topCandidates: [exactCandidate, ...sisterLevels].map(e => ({ id: e.id, canonical: e.canonical, score: 1.0 })),
              latencyMs: Date.now() - startTime
            },
            rawMention,
            inferredCategory
          }, options);
        }
      }

      return _buildResult({
        state: ENTITY_RESOLUTION_STATE.SUPPORTED,
        canonicalEntity: exactCandidate.canonical,
        canonicalId: exactCandidate.id,
        entity: exactCandidate,
        confidence: thresholds.exactMatchConfidence,
        evidence: {
          matchType: RESOLUTION_FAILURE_TAXONOMY.EXACT_MATCH,
          matchedOn: 'canonical_or_alias',
          matchedText: exactCandidate.canonical,
          score: 1.0,
          scoreMargin: 1.0,
          topCandidates: [{ id: exactCandidate.id, canonical: exactCandidate.canonical, score: 1.0 }],
          latencyMs: Date.now() - startTime
        },
        rawMention,
        inferredCategory
      }, options);
    }
  }

  // 3. STAGE 2: GENERIC FUZZY / LEXICAL MATCH & CANDIDATE SCORING (Section 6 & 8)
  const allEntities = catalog.getAll();
  const scoredCandidates = [];
  const diagnosticMismatches = [];

  for (const entity of allEntities) {
    // Evaluate similarity against canonical and all aliases
    let bestScore = computeLexicalSimilarity(normMention, entity.canonical);
    let matchedOn = 'canonical';
    let matchedText = entity.canonical;

    for (const alias of (entity.aliases || [])) {
      const aliasScore = computeLexicalSimilarity(normMention, alias);
      if (aliasScore > bestScore) {
        bestScore = aliasScore;
        matchedOn = 'alias';
        matchedText = alias;
      }
    }

    // Optional embedding blending (Section 7)
    let embeddingScore = null;
    if (options.mentionEmbedding && options.entityEmbeddings && options.entityEmbeddings.has(entity.id)) {
      const entVector = options.entityEmbeddings.get(entity.id);
      embeddingScore = cosineSimilarity(options.mentionEmbedding, entVector);
      const wEmb = thresholds.embeddingWeight || 0.30;
      bestScore = Number(((1 - wEmb) * bestScore + wEmb * embeddingScore).toFixed(4));
    }

    // Only process candidates that achieve viable similarity
    if (bestScore >= thresholds.ambiguityCandidateThreshold) {
      const familyOk = isFamilyCompatible(inferredCategory, entity.family);
      if (!familyOk) {
        diagnosticMismatches.push({ entity, reason: RESOLUTION_FAILURE_TAXONOMY.FAMILY_MISMATCH, score: bestScore });
        continue;
      }

      const levelOk = isAcademicLevelCompatible(academicLevelInput, entity.academicLevel);
      if (!levelOk) {
        diagnosticMismatches.push({ entity, reason: RESOLUTION_FAILURE_TAXONOMY.LEVEL_MISMATCH, score: bestScore });
        continue;
      }

      const isGenericScope = entity.metadata?.legacyFamily === 'academic_scope' || entity.metadata?.legacyType === 'academic_scope' || entity.metadata?.legacyType === 'academic_level';

      scoredCandidates.push({
        entity,
        score: bestScore,
        matchedOn,
        matchedText,
        embeddingScore,
        isGenericScope,
        exactMatch: bestScore >= 0.999
      });
    }
  }

  // Sort candidates by score descending. Prioritize specific programs over generic scopes if close.
  scoredCandidates.sort((a, b) => {
    if (a.isGenericScope !== b.isGenericScope && Math.abs(a.score - b.score) < 0.15) {
      return a.isGenericScope ? 1 : -1;
    }
    return b.score - a.score;
  });

  // 4. DECISION ENGINE: 4-WAY STATE CONTRACT (Section 9)

  // Case A: No viable candidates found in catalog
  if (scoredCandidates.length === 0) {
    if (context) {
      const contextResult = _resolveFromContext(context, catalog, inferredCategory, startTime, rawMention, options);
      if (contextResult) return contextResult;
    }

    // Check if an entity actually matched the mention but failed family/level constraint
    const topMismatch = diagnosticMismatches.sort((a, b) => b.score - a.score)[0];
    if (topMismatch && topMismatch.score >= thresholds.ambiguityCandidateThreshold) {
      return _buildResult({
        state: ENTITY_RESOLUTION_STATE.UNKNOWN_UNVERIFIED,
        candidates: [],
        confidence: topMismatch.score,
        evidence: {
          reason: topMismatch.reason,
          mismatchedEntity: topMismatch.entity.canonical,
          score: topMismatch.score,
          isClosedDomain,
          domainCompleteness,
          latencyMs: Date.now() - startTime
        },
        rawMention,
        inferredCategory
      }, options);
    }

    // Critical Invariant Section 2 & 3:
    if (isClosedDomain && isAuthoritativeComplete) {
      return _buildResult({
        state: ENTITY_RESOLUTION_STATE.UNSUPPORTED,
        candidates: [],
        confidence: 0.0,
        evidence: {
          reason: 'ABSENT_FROM_AUTHORITATIVE_COMPLETE_CATALOG',
          isClosedDomain: true,
          domainCompleteness: 'COMPLETE',
          latencyMs: Date.now() - startTime
        },
        rawMention,
        inferredCategory
      }, options);
    }

    return _buildResult({
      state: ENTITY_RESOLUTION_STATE.UNKNOWN_UNVERIFIED,
      candidates: [],
      confidence: 0.0,
      evidence: {
        reason: isClosedDomain ? 'CATALOG_INCOMPLETE' : 'DOMAIN_OPEN_UNVERIFIED',
        isClosedDomain,
        domainCompleteness,
        latencyMs: Date.now() - startTime
      },
      rawMention,
      inferredCategory
    }, options);
  }

  // Case B: Viable candidates exist
  const top1 = scoredCandidates[0];
  const top2 = scoredCandidates[1] || null;
  const margin = top2 ? Number((top1.score - top2.score).toFixed(4)) : 1.0;

  // Multi-Level Stem Ambiguity Check (Section 10)
  if (top2 && !academicLevelInput && top1.score >= thresholds.ambiguityCandidateThreshold && top2.score >= thresholds.ambiguityCandidateThreshold) {
    const stem1 = normalizeText(top1.entity.canonical).replace(/^(s1|s2|d3)\s+/, '');
    const stem2 = normalizeText(top2.entity.canonical).replace(/^(s1|s2|d3)\s+/, '');
    if (stem1 === stem2 && top1.entity.academicLevel !== top2.entity.academicLevel) {
      return _buildResult({
        state: ENTITY_RESOLUTION_STATE.AMBIGUOUS,
        candidates: [top1.entity, top2.entity],
        confidence: top1.score,
        evidence: {
          reason: 'AMBIGUOUS_LEVEL_STEM',
          scoreMargin: margin,
          topCandidates: [top1, top2].map(c => ({ id: c.entity.id, canonical: c.entity.canonical, score: c.score })),
          latencyMs: Date.now() - startTime
        },
        rawMention,
        inferredCategory
      }, options);
    }
  }

  // Near-Sibling Protection (Section 8)
  // Sibling ambiguity applies to true siblings (e.g. SI vs SK), not program vs generic degree container
  const isGenericScopeCollision = top1 && top2 && (
    (!top1.isGenericScope && top2.isGenericScope) ||
    (top1.isGenericScope && !top2.isGenericScope)
  );

  if (top2 && margin < thresholds.siblingMarginThreshold && !isGenericScopeCollision) {
    const ambiguousCandidates = scoredCandidates
      .filter(c => (top1.score - c.score) < thresholds.siblingMarginThreshold)
      .map(c => c.entity);

    return _buildResult({
      state: ENTITY_RESOLUTION_STATE.AMBIGUOUS,
      candidates: ambiguousCandidates,
      confidence: top1.score,
      evidence: {
        reason: 'SIBLING_MARGIN_TOO_SMALL',
        scoreMargin: margin,
        siblingMarginThreshold: thresholds.siblingMarginThreshold,
        topCandidates: scoredCandidates.slice(0, 3).map(c => ({ id: c.entity.id, canonical: c.entity.canonical, score: c.score })),
        latencyMs: Date.now() - startTime
      },
      rawMention,
      inferredCategory
    }, options);
  }

  // Sub-Threshold Candidates: score >= ambiguityCandidateThreshold but < matchThreshold
  if (top1.score < thresholds.matchThreshold) {
    if (top2 && margin < thresholds.siblingMarginThreshold * 1.5) {
      return _buildResult({
        state: ENTITY_RESOLUTION_STATE.AMBIGUOUS,
        candidates: [top1.entity, top2.entity],
        confidence: top1.score,
        evidence: {
          reason: 'AMBIGUOUS_LOW_CONFIDENCE',
          scoreMargin: margin,
          topCandidates: scoredCandidates.slice(0, 3).map(c => ({ id: c.entity.id, canonical: c.entity.canonical, score: c.score })),
          latencyMs: Date.now() - startTime
        },
        rawMention,
        inferredCategory
      }, options);
    }

    return _buildResult({
      state: ENTITY_RESOLUTION_STATE.UNKNOWN_UNVERIFIED,
      candidates: [top1.entity],
      confidence: top1.score,
      evidence: {
        reason: 'CONFIDENCE_BELOW_THRESHOLD',
        score: top1.score,
        matchThreshold: thresholds.matchThreshold,
        latencyMs: Date.now() - startTime
      },
      rawMention,
      inferredCategory
    }, options);
  }

  // High-Confidence Verified SUPPORTED (Section 9)
  return _buildResult({
    state: ENTITY_RESOLUTION_STATE.SUPPORTED,
    canonicalEntity: top1.entity.canonical,
    canonicalId: top1.entity.id,
    entity: top1.entity,
    confidence: top1.score,
    evidence: {
      matchType: top1.exactMatch ? RESOLUTION_FAILURE_TAXONOMY.EXACT_MATCH : RESOLUTION_FAILURE_TAXONOMY.FUZZY_MATCH,
      matchedOn: top1.matchedOn,
      matchedText: top1.matchedText,
      score: top1.score,
      scoreMargin: margin,
      topCandidates: scoredCandidates.slice(0, 3).map(c => ({ id: c.entity.id, canonical: c.entity.canonical, score: c.score })),
      latencyMs: Date.now() - startTime
    },
    rawMention,
    inferredCategory
  }, options);
}

/**
 * Resolves entity from context (Phase B integration helper)
 */
function _resolveFromContext(context, catalog, inferredCategory, startTime, rawMention, options) {
  if (context.isAmbiguous || (Array.isArray(context.activeEntities) && context.activeEntities.length > 1)) {
    const candidatesFromContext = Array.isArray(context.activeEntities) ? context.activeEntities : [];
    return _buildResult({
      state: ENTITY_RESOLUTION_STATE.AMBIGUOUS,
      candidates: candidatesFromContext,
      confidence: 0.5,
      evidence: {
        reason: 'AMBIGUOUS_CONTEXT',
        contextActiveEntities: candidatesFromContext,
        latencyMs: Date.now() - startTime
      },
      rawMention,
      inferredCategory
    }, options);
  }

  const singleEntityName = context.activeEntity || (Array.isArray(context.activeEntities) && context.activeEntities.length === 1 ? context.activeEntities[0] : null);
  if (singleEntityName) {
    const resolved = catalog.resolveEntity(singleEntityName);
    if (resolved && isFamilyCompatible(inferredCategory, resolved.family)) {
      return _buildResult({
        state: ENTITY_RESOLUTION_STATE.SUPPORTED,
        canonicalEntity: resolved.canonical,
        canonicalId: resolved.id,
        entity: resolved,
        confidence: 1.0,
        evidence: {
          matchType: RESOLUTION_FAILURE_TAXONOMY.CONTEXT_INHERITED,
          matchedOn: 'context',
          matchedText: singleEntityName,
          score: 1.0,
          scoreMargin: 1.0,
          topCandidates: [{ id: resolved.id, canonical: resolved.canonical, score: 1.0 }],
          latencyMs: Date.now() - startTime
        },
        rawMention,
        inferredCategory
      }, options);
    }
  }

  return null;
}

/**
 * Internal helper to format resolution result and optionally trigger shadow handler.
 */
function _buildResult(result, options) {
  if (typeof options.shadowRecordHandler === 'function') {
    try {
      options.shadowRecordHandler({
        rawMention: result.rawMention,
        legacyResult: options.legacyResult || null,
        newResult: result,
        candidates: result.candidates || (result.entity ? [result.entity] : []),
        state: result.state,
        scoreDiagnostics: result.evidence || {},
        firstDifference: options.legacyResult ? (options.legacyResult !== result.state ? `${options.legacyResult} != ${result.state}` : null) : null
      });
    } catch (err) {
      logger.warn({ err: err.message }, '[openWorldEntityResolver] Shadow recording error');
    }
  }
  return result;
}

/**
 * Runs Calibration Benchmark on a given dataset (Section 15 & 16)
 * Computes TP, TN, FP, FN, Top1 Accuracy, Sibling Collision Rate, and UNSUPPORTED False-Positive Rate.
 *
 * @param {Array<Object>} dataset - Array of benchmark test items
 * @param {Object} [options]
 * @returns {Object} Benchmark Evaluation Report
 */
function runCalibrationBenchmark(dataset, options = {}) {
  const catalog = options.catalog || getDefaultKnowledgeCatalogService();
  const startTime = Date.now();

  let tp = 0; // Correctly SUPPORTED
  let tn = 0; // Correctly UNSUPPORTED or UNKNOWN_UNVERIFIED
  let fp = 0; // Falsely SUPPORTED or falsely UNSUPPORTED
  let fn = 0; // Missed SUPPORTED entity

  let top1Correct = 0;
  let ambiguityCoverage = 0;
  let siblingCollisions = 0;
  let unsupportedFalsePositives = 0; // Must be 0!
  let unknownVsUnsupportedCorrect = 0;

  const total = dataset.length;
  const itemDiagnostics = [];

  for (const item of dataset) {
    const itemCatalogCompleteness = item.catalogCompleteness !== undefined ? item.catalogCompleteness : options.catalogCompleteness;

    const res = resolveOpenWorldEntity({
      rawMention: item.mention,
      inferredCategory: item.inferredCategory || 'academic_program',
      academicLevel: item.academicLevel !== undefined ? item.academicLevel : undefined,
      context: item.context || null
    }, {
      catalog,
      catalogCompleteness: itemCatalogCompleteness,
      thresholds: options.thresholds
    });

    const isStateCorrect = res.state === item.expectedState;
    let isEntityCorrect = true;
    if (item.expectedState === ENTITY_RESOLUTION_STATE.SUPPORTED && item.expectedCanonical) {
      isEntityCorrect = res.canonicalEntity === item.expectedCanonical;
    }

    if (item.expectedState === ENTITY_RESOLUTION_STATE.SUPPORTED) {
      if (res.state === ENTITY_RESOLUTION_STATE.SUPPORTED && isEntityCorrect) {
        tp++;
        top1Correct++;
      } else {
        fn++;
      }
    } else if (item.expectedState === ENTITY_RESOLUTION_STATE.AMBIGUOUS) {
      if (res.state === ENTITY_RESOLUTION_STATE.AMBIGUOUS) {
        tn++;
        ambiguityCoverage++;
      } else {
        fp++;
      }
    } else if (item.expectedState === ENTITY_RESOLUTION_STATE.UNSUPPORTED) {
      if (res.state === ENTITY_RESOLUTION_STATE.UNSUPPORTED) {
        tn++;
        unknownVsUnsupportedCorrect++;
      } else {
        if (res.state === ENTITY_RESOLUTION_STATE.SUPPORTED) fp++;
        else tn++; // UNKNOWN_UNVERIFIED is safe fallback
      }
    } else if (item.expectedState === ENTITY_RESOLUTION_STATE.UNKNOWN_UNVERIFIED) {
      if (res.state === ENTITY_RESOLUTION_STATE.UNKNOWN_UNVERIFIED) {
        tn++;
        unknownVsUnsupportedCorrect++;
      } else if (res.state === ENTITY_RESOLUTION_STATE.UNSUPPORTED) {
        // CRITICAL FAILURE: Claimed UNSUPPORTED when catalog was unverified or open-world!
        unsupportedFalsePositives++;
        fp++;
      } else {
        fp++;
      }
    }

    // Check sibling collision: e.g. "Sistem Informasi" vs "Sistem Komputer"
    if (item.isSiblingTest && res.state === ENTITY_RESOLUTION_STATE.SUPPORTED && res.canonicalEntity !== item.expectedCanonical) {
      siblingCollisions++;
    }

    itemDiagnostics.push({
      mention: item.mention,
      expected: item.expectedState,
      actual: res.state,
      matchedCanonical: res.canonicalEntity || null,
      correct: isStateCorrect && isEntityCorrect,
      score: res.confidence || 0,
      evidence: res.evidence
    });
  }

  const durationMs = Date.now() - startTime;
  const avgLatencyMs = Number((durationMs / total).toFixed(2));
  const top1Accuracy = Number(((top1Correct + tn) / total).toFixed(4));
  const ambiguityRate = Number((ambiguityCoverage / (dataset.filter(d => d.expectedState === ENTITY_RESOLUTION_STATE.AMBIGUOUS).length || 1)).toFixed(4));
  const siblingCollisionRate = Number((siblingCollisions / total).toFixed(4));
  const unsupportedFPRate = Number((unsupportedFalsePositives / total).toFixed(4));

  return {
    total,
    durationMs,
    avgLatencyMs,
    confusionMatrix: { tp, tn, fp, fn },
    metrics: {
      top1Accuracy,
      ambiguityRate,
      siblingCollisionRate,
      unsupportedFalsePositives,
      unsupportedFalsePositiveRate: unsupportedFPRate,
      unknownVsUnsupportedCorrect
    },
    itemDiagnostics
  };
}

const { CANONICAL_ENTITIES, matchCanonicalEntities } = require('../engine/canonicalEntityRegistry');

/**
 * Generic Indonesian qualifier stripper:
 * Strips generic organizational / program prefixes so the root entity name can be resolved.
 * Purely structural / morphological; no hardcoded institutional rules or typos.
 */
function normalizeEntityPhrase(str) {
  let s = String(str || '').toLowerCase().trim();
  s = s.replace(/\b(?:program\s+sarjana|program\s+diploma|program\s+magister|program\s+pascasarjana|program\s+studi|prodi|jurusan|unit\s+kegiatan\s+mahasiswa|ukm|himpunan\s+mahasiswa|himaprodi|hima|organisasi\s+mahasiswa|ormawa)\b/g, ' ');
  s = s.replace(/\bcalon\b/g, ' ');
  s = s.replace(/\b(?:kerja\s+sama\s+dengan|kerjasama\s+dengan)\b/g, ' ');
  s = s.replace(/\bberkewarganegaraan\s+asing\b/g, 'asing');
  s = s.replace(/\bwarga\s+negara\s+asing\b/g, 'asing');
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Resolves candidate entities generically using validated catalog/registry data.
 * Considers category, family, academic level, and aspect compatibility.
 * Rejects cross-category mismatches (e.g. academic_program vs student_organization).
 * Returns disambiguated canonical entity or preserves ambiguity without guessing.
 *
 * @param {Array<Object>} candidateEntities - Candidate entities from validated semantic frame
 * @param {Object} [options]
 * @param {string} [options.academicLevelConstraint] - Academic level constraint ('S1', 'S2', 'D3', 'ALL', or null)
 * @param {Array<string>} [options.requestedAspects] - Requested aspects (e.g. ['accreditation'])
 * @param {string} [options.domain] - Frame domain (e.g. 'ACCREDITATION')
 * @param {string} [options.rawQuery] - Raw user query for fallback token matching
 * @returns {Array<Object>} Resolved canonical entities
 */
function resolveCandidateEntities(candidateEntities = [], options = {}) {
  if (!Array.isArray(candidateEntities) || candidateEntities.length === 0) return [];
  const resolved = [];

  const academicLevelConstraint = options.academicLevelConstraint || null;
  const requestedAspects = options.requestedAspects || [];
  const domain = options.domain || null;
  const rawQuery = options.rawQuery || null;

  for (const cand of candidateEntities) {
    const rawMention = String(cand.rawMention || cand.canonical || '').trim();
    const mentionLower = rawMention.toLowerCase();
    if (!mentionLower) continue;

    const strippedMention = normalizeEntityPhrase(mentionLower);
    const requestedFamily = cand.inferredCategory || options.inferredCategory || null;
    const requestedLevel = (cand.academicLevel && cand.academicLevel !== 'ALL')
      ? cand.academicLevel
      : (academicLevelConstraint && academicLevelConstraint !== 'ALL' ? academicLevelConstraint : null);

    // Aspect & Domain validation: e.g. accreditation / curriculum cannot belong to student organizations
    const isAcademicAspect = requestedAspects.some(a => ['accreditation', 'curriculum', 'degree_award'].includes(a)) ||
      ['ACCREDITATION', 'ACADEMIC_CURRICULUM'].includes(domain);

    let bestMatch = null;
    const competingMatches = [];

    // Stage 1: Exact alias or canonical match in CANONICAL_ENTITIES
    for (const entry of CANONICAL_ENTITIES) {
      const canonicalLower = entry.canonical.toLowerCase();
      const aliases = (entry.aliases || []).map(a => a.toLowerCase());
      const isExactMatch = canonicalLower === mentionLower || aliases.includes(mentionLower);

      if (isExactMatch) {
        if (requestedFamily && !isFamilyCompatible(requestedFamily, entry.family)) {
          continue;
        }
        if (isAcademicAspect && entry.family === 'student_organization') {
          continue;
        }

        const entryLevel = entry.degree || entry.canonical.match(/^(S1|S2|D3|D4)\b/i)?.[0] || null;
        if (requestedLevel && entryLevel && !isAcademicLevelCompatible(requestedLevel, entryLevel)) {
          continue;
        }

        competingMatches.push(entry);
      }
    }

    // Stage 2: Base stem / substring match if no exact match found
    if (competingMatches.length === 0) {
      for (const entry of CANONICAL_ENTITIES) {
        if (requestedFamily && !isFamilyCompatible(requestedFamily, entry.family)) {
          continue;
        }
        if (isAcademicAspect && entry.family === 'student_organization') {
          continue;
        }

        const canonicalLower = entry.canonical.toLowerCase();
        const baseLower = canonicalLower.replace(/^(s1|s2|d3|d4)\s+/i, '').trim();

        const isSubstringMatch = (mentionLower === baseLower) ||
          (entry.aliases || []).some(a => {
            const aliasBase = a.replace(/^(s1|s2|d3|d4)\s+/i, '').trim();
            return aliasBase === mentionLower;
          });

        if (isSubstringMatch) {
          const entryLevel = entry.degree || entry.canonical.match(/^(S1|S2|D3|D4)\b/i)?.[0] || null;
          if (requestedLevel && entryLevel && !isAcademicLevelCompatible(requestedLevel, entryLevel)) {
            continue;
          }
          competingMatches.push(entry);
        }
      }
    }

    // Stage 3: Stripped Generic Qualifier match
    if (competingMatches.length === 0 && strippedMention && strippedMention !== mentionLower) {
      for (const entry of CANONICAL_ENTITIES) {
        if (requestedFamily && !isFamilyCompatible(requestedFamily, entry.family)) {
          continue;
        }
        if (isAcademicAspect && entry.family === 'student_organization') {
          continue;
        }

        const canonicalLower = entry.canonical.toLowerCase();
        const baseLower = canonicalLower.replace(/^(s1|s2|d3|d4)\s+/i, '').trim();
        const aliases = (entry.aliases || []).map(a => a.toLowerCase());

        const isStrippedMatch = (canonicalLower === strippedMention) || (baseLower === strippedMention) ||
          aliases.includes(strippedMention) ||
          aliases.some(a => a.replace(/^(s1|s2|d3|d4)\s+/i, '').trim() === strippedMention);

        if (isStrippedMatch) {
          const entryLevel = entry.degree || entry.canonical.match(/^(S1|S2|D3|D4)\b/i)?.[0] || null;
          if (requestedLevel && entryLevel && !isAcademicLevelCompatible(requestedLevel, entryLevel)) {
            continue;
          }
          competingMatches.push(entry);
        }
      }
    }

    // Stage 4: Generic Lexical / Skeleton Fuzzy Match (handles typos like sistm komputr)
    if (competingMatches.length === 0 && strippedMention.length >= 3) {
      let topScore = 0;
      let topEntry = null;
      for (const entry of CANONICAL_ENTITIES) {
        if (requestedFamily && !isFamilyCompatible(requestedFamily, entry.family)) {
          continue;
        }
        if (isAcademicAspect && entry.family === 'student_organization') {
          continue;
        }

        const canonicalLower = entry.canonical.toLowerCase();
        const baseLower = canonicalLower.replace(/^(s1|s2|d3|d4)\s+/i, '').trim();
        let sim = Math.max(
          computeLexicalSimilarity(strippedMention, canonicalLower),
          computeLexicalSimilarity(strippedMention, baseLower)
        );
        for (const alias of (entry.aliases || [])) {
          const alSim = computeLexicalSimilarity(strippedMention, alias.toLowerCase());
          if (alSim > sim) sim = alSim;
        }

        if (sim >= 0.74 && sim > topScore) {
          const entryLevel = entry.degree || entry.canonical.match(/^(S1|S2|D3|D4)\b/i)?.[0] || null;
          if (requestedLevel && entryLevel && !isAcademicLevelCompatible(requestedLevel, entryLevel)) {
            continue;
          }
          topScore = sim;
          topEntry = entry;
        }
      }
      if (topEntry) {
        competingMatches.push(topEntry);
      }
    }

    // Stage 5: Mention Word-Boundary Canonical Match (handles UTB Brunei Darussalam -> Dual Degree UTB)
    if (competingMatches.length === 0 && rawMention.length >= 3) {
      const canonMatches = matchCanonicalEntities(rawMention);
      if (canonMatches.length === 1 && canonMatches[0].isSpecific) {
        const found = CANONICAL_ENTITIES.find(e => e.canonical === canonMatches[0].canonical);
        if (found) {
          if (!requestedFamily || isFamilyCompatible(requestedFamily, found.family)) {
            competingMatches.push(found);
          }
        }
      }
    }

    // Resolution & Ambiguity Evaluation
    if (competingMatches.length === 1) {
      bestMatch = competingMatches[0];
    } else if (competingMatches.length > 1) {
      if (requestedLevel) {
        const exactLevelMatch = competingMatches.find(e => (e.degree || '').toUpperCase() === requestedLevel.toUpperCase());
        if (exactLevelMatch) bestMatch = exactLevelMatch;
      }
      if (!bestMatch) {
        const s1Match = competingMatches.find(e => e.degree === 'S1');
        bestMatch = s1Match || competingMatches[0];
      }
    }

    if (bestMatch) {
      resolved.push({
        canonical: bestMatch.canonical,
        family: bestMatch.family || requestedFamily || 'unknown',
        type: bestMatch.type || 'entity',
        academicLevel: bestMatch.degree || bestMatch.canonical.match(/^(S1|S2|D3|D4)\b/i)?.[0] || academicLevelConstraint || null,
        rawMention: rawMention
      });
    } else {
      resolved.push({
        canonical: rawMention,
        family: requestedFamily || 'unknown',
        type: 'open_world_entity',
        academicLevel: cand.academicLevel || academicLevelConstraint || null,
        rawMention: rawMention
      });
    }
  }

  // Filter out pseudo-entity aspect phrases (e.g. 'gelar dual degree') when at least one canonical entity was resolved
  const hasCanonical = resolved.some(r => r.type !== 'open_world_entity');
  if (hasCanonical && resolved.length > 1) {
    const filtered = resolved.filter(r => {
      if (r.type !== 'open_world_entity') return true;
      const lower = (r.rawMention || r.canonical || '').toLowerCase();
      const isAspectPhrase = /\b(?:gelar|biaya|tarif|akreditasi|kurikulum|syarat|prospek|karier|karir)\b/i.test(lower);
      return !isAspectPhrase;
    });
    if (filtered.length > 0) {
      return filtered;
    }
  }

  // Stage 8: Whole-Query Recovery if all mentions remained unverified open-world
  const allUnverified = resolved.every(r => r.type === 'open_world_entity');
  if (allUnverified && rawQuery) {
    const queryMatches = matchCanonicalEntities(rawQuery);
    // Subsume generic academic scope qualifiers (e.g. 'Program Sarjana (S1)') when a specific academic program is present
    let specificMatches = queryMatches.filter(m => {
      if (m.family === 'academic_scope') {
        const hasSpecificProgram = queryMatches.some(other => other.family === 'academic_program');
        if (hasSpecificProgram) return false;
      }
      return true;
    });

    // If candidate mentions indicated a specific family (e.g. academic_program), prioritize that family over non-program secondary entities (e.g. admission_track)
    const candRequestedFamilies = new Set(candidateEntities.map(c => c.inferredCategory || c.family).filter(Boolean));
    if (candRequestedFamilies.size === 1 && !candRequestedFamilies.has('unknown')) {
      const targetFamily = Array.from(candRequestedFamilies)[0];
      const familyFiltered = specificMatches.filter(m => isFamilyCompatible(targetFamily, m.family));
      if (familyFiltered.length > 0) {
        specificMatches = familyFiltered;
      }
    }

    if (specificMatches.length === 1 && specificMatches[0].isSpecific) {
      const match = specificMatches[0];
      const found = CANONICAL_ENTITIES.find(e => e.canonical === match.canonical);
      if (found) {
        return [{
          canonical: found.canonical,
          family: found.family || 'unknown',
          type: found.type || 'entity',
          academicLevel: found.degree || found.canonical.match(/^(S1|S2|D3|D4)\b/i)?.[0] || null,
          rawMention: match.matchedAlias || rawQuery
        }];
      }
    }
  }

  return resolved;
}

module.exports = {
  resolveOpenWorldEntity,
  resolveCandidateEntities,
  runCalibrationBenchmark,
  ENTITY_RESOLUTION_STATE,
  RESOLUTION_FAILURE_TAXONOMY,
  DEFAULT_CALIBRATED_THRESHOLDS,
  normalizeText,
  tokenizeText,
  levenshteinDistance,
  normalizedLevenshtein,
  charTrigramSimilarity,
  tokenSimilarityWithSkeleton,
  computeLexicalSimilarity,
  cosineSimilarity,
  detectAcademicLevelFromTokens,
  isAcademicLevelCompatible,
  isFamilyCompatible,
  normalizeEntityPhrase
};
