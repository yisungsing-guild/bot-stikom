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

  // Generic discovery of conflicting / sibling entities to exclude across all families
  // INVARIANT: Explicitly requested entities in targetEntities must NEVER be excluded!
  const targetEntitySet = new Set(targetEntities.map(t => t.toLowerCase()));
  const excludedConflictingEntities = [];
  for (const ent of targetEntities) {
    const canonicalObj = findCanonicalEntity(ent);
    if (canonicalObj && canonicalObj.family) {
      const siblings = CANONICAL_ENTITIES.filter(other => {
        if (targetEntitySet.has(other.canonical.toLowerCase())) return false;
        if (other.family !== canonicalObj.family) return false;
        if (canonicalObj.role && other.role) {
          return other.role === canonicalObj.role;
        }
        return true;
      });
      for (const sib of siblings) {
        if (!targetEntitySet.has(sib.canonical.toLowerCase()) && !excludedConflictingEntities.includes(sib.canonical)) {
          excludedConflictingEntities.push(sib.canonical);
        }
        if (Array.isArray(sib.aliases)) {
          for (const alias of sib.aliases) {
            if (targetEntitySet.has(alias.toLowerCase())) continue;
            // Avoid adding plain multi-word noun phrases that are valid descriptive terms in other programs
            const isPlainNoun = canonicalObj.family === 'academic_program' && 
              !/^(s1|s2|d3|d4|prodi|jurusan|sarjana|diploma|magister)\b/i.test(alias) && 
              !/\b(s1|s2|d3|d4)\b/i.test(alias);
            if (alias.length >= 3 && !isPlainNoun && !excludedConflictingEntities.includes(alias)) {
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

  // Tuition fee query variants prioritized
  if (domain === 'TUITION_FEE' || (aspects && (aspects.includes('fee') || aspects.includes('tuition')))) {
    if (targetEntities.length > 0) {
      for (const ent of targetEntities) {
        queryVariants.push(`rincian biaya pendidikan ${ent}`);
        queryVariants.push(`biaya kuliah ${ent} per semester`);
      }
    } else {
      queryVariants.push('rincian biaya pendidikan mahasiswa baru kelas reguler');
    }
  }

  // Program Overview / Definition query variants
  if (intent === 'PROGRAM_OVERVIEW' || intent === 'DEFINITION' || intent === 'PROGRAM_COMPARISON') {
    if (targetEntities.length > 0) {
      for (const ent of targetEntities) {
        queryVariants.push(`deskripsi profil program studi ${ent}`);
        queryVariants.push(`tentang ${ent}`);
      }
    }
  }

  // Program Curriculum query variants
  if (intent === 'CURRICULUM_INQUIRY' || domain === 'ACADEMIC_CURRICULUM') {
    if (targetEntities.length > 0) {
      for (const ent of targetEntities) {
        queryVariants.push(`kurikulum ${ent} mata kuliah`);
        queryVariants.push(`sebaran mata kuliah ${ent}`);
      }
    }
  }

  if (targetEntities.length > 0) {
    const combined = `${targetEntities.join(' ')} ${cleanKeywords}`.trim();
    if (!queryVariants.includes(combined)) queryVariants.push(combined);
  }
  if (cleanKeywords && !queryVariants.includes(cleanKeywords)) queryVariants.push(cleanKeywords);
  if (normalizedQuery && !queryVariants.includes(normalizedQuery)) queryVariants.push(normalizedQuery);

  return {
    domain,
    intent,
    retrievalRequired: semanticFrame.retrievalRequired !== false,
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
