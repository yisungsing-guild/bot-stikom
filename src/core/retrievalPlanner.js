'use strict';

/**
 * src/core/retrievalPlanner.js
 * 
 * Greenfield Retrieval Planner Layer.
 * Constructs an explicit RetrievalPlan from a SemanticFrame:
 * - Locks target entities
 * - Excludes conflicting/sibling entities (e.g., exclude HELP when DNUI is target)
 * - Sets required aspects and temporal constraints
 *  */

const { CANONICAL_ENTITIES, findCanonicalEntity } = require('../engine/canonicalEntityRegistry');

function buildRetrievalPlan(semanticFrame) {
  if (!semanticFrame) {
    return {
      domain: 'GENERAL',
      targetEntities: [],
      excludedConflictingEntities: [],
      requiredAspects: [],
      temporalConstraint: 'GENERAL',
      queryVariants: []
    };
  }

  const { normalizedQuery, domain, intent, entities, aspects, temporal } = semanticFrame;
  const targetEntities = (entities || []).map(e => e.canonical || e.name || String(e));
  const normalizedText = String(normalizedQuery || '').toLowerCase();

  // Generic discovery of conflicting / sibling entities to exclude
  const excludedConflictingEntities = [];
  for (const ent of targetEntities) {
    const canonicalObj = findCanonicalEntity(ent);
    if (canonicalObj && canonicalObj.family && canonicalObj.role) {
      const siblings = CANONICAL_ENTITIES.filter(other => 
        other.canonical !== canonicalObj.canonical && 
        other.family === canonicalObj.family && 
        other.role === canonicalObj.role
      );
      for (const sib of siblings) {
        if (!excludedConflictingEntities.includes(sib.canonical)) {
          excludedConflictingEntities.push(sib.canonical);
        }
        if (Array.isArray(sib.aliases)) {
          for (const alias of sib.aliases) {
            if (alias.length >= 3 && !excludedConflictingEntities.includes(alias)) {
              excludedConflictingEntities.push(alias);
            }
          }
        }
      }
    }
  }

  // Generate high-precision search query variants
  // Strip question stop words like "apa itu", "apakah ada", "bagaimana"
  const cleanKeywords = normalizedText
    .replace(/\b(apa\s+itu|apakah\s+ada|bagaimana|bagaimanakah|kapan|dimana|berapa|apa|ada|itu|di|ke|dari|untuk|yang)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const queryVariants = [];
  if (intent === 'INSTITUTIONAL_ACCREDITATION') {
    if (targetEntities.length === 0) {
      targetEntities.push('Institut Teknologi dan Bisnis STIKOM Bali');
    }
    queryVariants.push('konversi peringkat akreditasi perguruan tinggi institut teknologi dan bisnis stikom bali');
    queryVariants.push('akreditasi institusi BAN-PT perguruan tinggi');
  }
  if (targetEntities.length > 0) {
    queryVariants.push(`${targetEntities.join(' ')} ${cleanKeywords}`.trim());
  }
  queryVariants.push(cleanKeywords || normalizedQuery);
  queryVariants.push(normalizedQuery);

  return {
    domain,
    intent,
    targetEntities,
    excludedConflictingEntities,
    requiredAspects: aspects || [],
    temporalConstraint: temporal ? temporal.constraint : 'GENERAL',
    queryVariants
  };
}

module.exports = {
  buildRetrievalPlan
};
