'use strict';

/**
 * src/core/retrievalContract.js
 *
 * Phase F: Semantic Retrieval Contract + Dynamic Evidence Arbitration.
 * SHADOW / LOCAL MODE ONLY.
 *
 * Invariants:
 * 1. SEMANTIC FRAME = SOURCE OF TRUTH.
 *    Retrieval MUST NOT reinterpret the user's query independently.
 * 2. Hard filters (Entity, Family, Level, Aspect) strictly override soft scores (Vector, BM25).
 * 3. AMBIGUOUS causes CLARIFICATION_REQUIRED, never arbitrary entity selection.
 * 4. UNKNOWN_UNVERIFIED causes NO_VERIFIED_ENTITY_EVIDENCE, never hallucinated broad retrieval.
 * 5. UNSUPPORTED (authoritative) causes NO_RETRIEVAL.
 * 6. Structured metadata is authoritative; no title/filename keyword scanning.
 */

const { CANONICAL_ENTITIES, findCanonicalEntity } = require('../engine/canonicalEntityRegistry');
const logger = require('../logger');

// Retrieval Contract Execution States
const RETRIEVAL_STATE = Object.freeze({
  SCOPED_RETRIEVAL_ALLOWED: 'SCOPED_RETRIEVAL_ALLOWED',
  CLARIFICATION_REQUIRED: 'CLARIFICATION_REQUIRED',
  NO_VERIFIED_ENTITY_EVIDENCE: 'NO_VERIFIED_ENTITY_EVIDENCE',
  NO_RETRIEVAL: 'NO_RETRIEVAL'
});

// Evidence Metadata States (Section 9)
const EVIDENCE_METADATA_STATE = Object.freeze({
  METADATA_MATCH: 'METADATA_MATCH',
  METADATA_PARTIAL: 'METADATA_PARTIAL',
  METADATA_MISSING: 'METADATA_MISSING',
  METADATA_CONFLICT: 'METADATA_CONFLICT'
});

// First-Failure Diagnostics Taxonomy (Section 19)
const FIRST_FAILURE_TAXONOMY = Object.freeze({
  SEMANTIC_FRAME_INVALID: 'SEMANTIC_FRAME_INVALID',
  ENTITY_AMBIGUOUS: 'ENTITY_AMBIGUOUS',
  ENTITY_UNKNOWN: 'ENTITY_UNKNOWN',
  ENTITY_UNSUPPORTED: 'ENTITY_UNSUPPORTED',
  RETRIEVAL_SCOPE_MISMATCH: 'RETRIEVAL_SCOPE_MISMATCH',
  ASPECT_MISMATCH: 'ASPECT_MISMATCH',
  LEVEL_MISMATCH: 'LEVEL_MISMATCH',
  FAMILY_MISMATCH: 'FAMILY_MISMATCH',
  METADATA_MISSING: 'METADATA_MISSING',
  METADATA_CONFLICT: 'METADATA_CONFLICT',
  NO_EVIDENCE: 'NO_EVIDENCE',
  EVIDENCE_ACCEPTED: 'EVIDENCE_ACCEPTED'
});

/**
 * Standardizes aspect names to canonical aspect identifiers.
 * Strictly uses validated vocabulary without title/filename regexes.
 */
function normalizeAspect(aspect) {
  if (!aspect || typeof aspect !== 'string') return null;
  const a = aspect.trim().toLowerCase();
  if (['biaya', 'tuition', 'fee', 'spp', 'dpp'].includes(a)) return 'fee';
  if (['kurikulum', 'curriculum', 'matkul', 'courses', 'mata_kuliah', 'matakuliah', 'curriculum_difference'].includes(a)) return 'curriculum';
  if (['akreditasi', 'accreditation'].includes(a)) return 'accreditation';
  if (['syarat', 'persyaratan', 'requirements', 'admission_requirements'].includes(a)) return 'requirements';
  if (['prosedur', 'procedure', 'alur'].includes(a)) return 'procedure';
  if (['jadwal', 'schedule'].includes(a)) return 'schedule';
  if (['karir', 'prospek', 'career', 'career_prospects', 'prospek_kerja'].includes(a)) return 'career';
  if (['lokasi', 'location', 'alamat', 'study_location', 'tempat_kuliah', 'tempat_studi'].includes(a)) return 'location';
  if (['durasi', 'study_duration', 'masa_studi'].includes(a)) return 'study_duration';
  if (['gelar', 'degree_award', 'titel'].includes(a)) return 'degree_award';
  if (['fasilitas', 'facilities', 'lab', 'sarana'].includes(a)) return 'facilities';
  if (['organisasi', 'ukm', 'student_organization', 'activities'].includes(a)) return 'organization';
  if (['beasiswa', 'scholarship'].includes(a)) return 'scholarship';
  if (['profil', 'profile', 'prodi_profile', 'overview', 'definition'].includes(a)) return 'overview';
  if (['program_khusus', 'special_program'].includes(a)) return 'special_program';
  return a;
}

/**
 * Constructs an immutable, deterministic RetrievalContract from a validated SemanticFrame.
 *
 * @param {Object} semanticFrame - Validated SemanticFrame from Phase B/C/D
 * @param {Object} [options]
 * @param {KnowledgeCatalogService} [options.catalog]
 * @param {Object|string} [options.catalogCompleteness]
 * @returns {Object} Structured RetrievalContract
 */
function buildRetrievalContract(semanticFrame = {}, options = {}) {
  if (!semanticFrame || typeof semanticFrame !== 'object') {
    return {
      contractId: `contract_invalid_${Date.now()}`,
      retrievalState: RETRIEVAL_STATE.CLARIFICATION_REQUIRED,
      firstFailure: FIRST_FAILURE_TAXONOMY.SEMANTIC_FRAME_INVALID,
      entityCanonical: null,
      entityState: 'UNKNOWN',
      entityFamily: null,
      academicLevel: null,
      requestedAspects: [],
      aspectFilter: null,
      scopeConstraints: { targetEntities: [], excludedEntities: [], targetEntityIds: [] },
      queryText: ''
    };
  }

  const queryText = semanticFrame.normalizedQuery || semanticFrame.rawQuery || '';
  const speechAct = semanticFrame.speechAct || (semanticFrame.intent === 'PROGRAM_COMPARISON' ? 'COMPARE' : 'INQUIRE_PROPERTY');
  const isCompare = speechAct === 'COMPARE' || semanticFrame.intent === 'PROGRAM_COMPARISON';

  // 1. Resolve Entity State & Target Entities from validated frame
  const rawEntities = Array.isArray(semanticFrame.entities) ? semanticFrame.entities : [];

  // Separate primary target entities from modifier families (admission_track, participant_scope, academic_scope)
  const hasPrimaryEntity = rawEntities.some(e => {
    const canon = typeof e === 'object' && e ? (e.canonical || e.name) : String(e);
    const obj = findCanonicalEntity(canon);
    return obj && (obj.family === 'academic_program' || obj.family === 'international_program' || obj.family === 'campus_service' || obj.family === 'student_organization' || obj.family === 'facility' || obj.family === 'campus_facility');
  });

  const effectiveEntities = (hasPrimaryEntity && !isCompare)
    ? rawEntities.filter(e => {
        const canon = typeof e === 'object' && e ? (e.canonical || e.name) : String(e);
        const obj = findCanonicalEntity(canon);
        if (!obj) return true;
        return !(obj.type === 'academic_scope' || obj.family === 'admission_track' || obj.family === 'participant_scope');
      })
    : rawEntities.filter(e => {
        const canon = typeof e === 'object' && e ? (e.canonical || e.name) : String(e);
        const obj = findCanonicalEntity(canon);
        if (!obj) return true;
        return !(obj.family === 'admission_track' || obj.family === 'participant_scope');
      });

  // Deduplicate target entities after resolution to canonical identity
  const resolvedTargetEntities = [];
  const seenCanonicalKeys = new Set();
  for (const e of effectiveEntities) {
    const rawVal = typeof e === 'object' && e ? (e.canonical || e.name || String(e)) : String(e);
    if (!rawVal) continue;
    const canonObj = findCanonicalEntity(rawVal);
    const canonicalName = canonObj ? canonObj.canonical : rawVal.trim();
    const canonKey = canonicalName.toLowerCase().trim();
    if (!seenCanonicalKeys.has(canonKey)) {
      seenCanonicalKeys.add(canonKey);
      resolvedTargetEntities.push(canonicalName);
    }
  }
  const targetEntities = resolvedTargetEntities;

  // Deduplicate modifiers after resolution to canonical identity
  const rawModifiers = semanticFrame.modifiers || rawEntities.filter(e => {
    const canon = typeof e === 'object' && e ? (e.canonical || e.name) : String(e);
    const obj = findCanonicalEntity(canon);
    return obj && (obj.family === 'admission_track' || obj.family === 'participant_scope');
  });
  const resolvedModifiers = [];
  const seenModifierKeys = new Set();
  for (const m of rawModifiers) {
    const rawVal = typeof m === 'object' && m ? (m.canonical || m.name || String(m)) : String(m);
    if (!rawVal) continue;
    const canonObj = findCanonicalEntity(rawVal);
    const canonicalName = canonObj ? canonObj.canonical : rawVal.trim();
    const canonKey = canonicalName.toLowerCase().trim();
    if (!seenModifierKeys.has(canonKey)) {
      seenModifierKeys.add(canonKey);
      resolvedModifiers.push(canonicalName);
    }
  }
  const modifiers = resolvedModifiers;

  const isMultiTarget = Boolean(semanticFrame.isMultiTarget) ||
    (targetEntities.length > 1 && !semanticFrame.isAmbiguous && /\b(?:dan|serta|maupun|dan juga)\b/i.test(queryText));

  let entityState = 'SUPPORTED';
  let ambiguityLevel = semanticFrame.ambiguityLevel || 'NONE';

  if (semanticFrame.unsupportedEntity || semanticFrame.isUnsupportedEntity) {
    entityState = 'UNSUPPORTED';
  } else if (semanticFrame.isAmbiguous || (targetEntities.length > 1 && !isCompare && !isMultiTarget)) {
    entityState = 'AMBIGUOUS';
    ambiguityLevel = 'HIGH';
  } else if (targetEntities.length === 0) {
    if (semanticFrame.domain === 'GENERAL_GREETING' || semanticFrame.intent === 'GREETING' || semanticFrame.domain === 'CONVERSATIONAL' || semanticFrame.retrievalRequired === false) {
      entityState = 'NOT_APPLICABLE';
    } else {
      entityState = semanticFrame.entityResolutionStatus === 'UNRESOLVED' ? 'UNKNOWN_UNVERIFIED' : 'SUPPORTED';
    }
  }

  // Determine Primary Entity Canonical & Family
  const primaryEntityCanonical = targetEntities.length > 0 ? targetEntities[0] : null;
  let entityFamily = null;
  let targetEntityIds = [];
  if (primaryEntityCanonical) {
    const canonObj = findCanonicalEntity(primaryEntityCanonical);
    if (canonObj) {
      if (
        canonObj.canonical === 'Kampus ITB STIKOM Bali' &&
        semanticFrame.intent !== 'CAMPUS_LOCATION' &&
        semanticFrame.domain !== 'FACILITIES'
      ) {
        entityFamily = 'institution';
        targetEntityIds.push('INSTITUTION_ITB_STIKOM_BALI');
      } else {
        entityFamily = canonObj.family || (canonObj.type === 'program' ? 'academic_program' : 'campus_service');
        targetEntityIds.push(canonObj.id || canonObj.canonical);
      }
    }
  }

  // 2. Discover Sibling / Mutually Exclusive Entities to Exclude
  const excludedEntities = [];
  const MUTUALLY_EXCLUSIVE_FAMILIES = new Set(['academic_program', 'double_degree']);
  if (entityFamily && MUTUALLY_EXCLUSIVE_FAMILIES.has(entityFamily)) {
    const targetSet = new Set(targetEntities.map(t => t.toLowerCase().trim()));
    for (const other of CANONICAL_ENTITIES) {
      if (other.family === entityFamily) {
        const otherCanonLower = other.canonical.toLowerCase().trim();
        if (!targetSet.has(otherCanonLower)) {
          if (!excludedEntities.includes(other.canonical)) {
            excludedEntities.push(other.canonical);
          }
        }
      }
    }
  }

  // 3. Aspects Binding
  const rawAspects = Array.isArray(semanticFrame.aspects) ? semanticFrame.aspects : [];
  const requestedAspects = Array.from(new Set(rawAspects.map(normalizeAspect).filter(Boolean)));
  const aspectFilter = requestedAspects.length > 0 ? requestedAspects[0] : null;

  // 4. Academic Level Binding
  const academicLevel = semanticFrame.academicLevel || null;

  // 5. Determine Retrieval State Policy (Section 4)
  let retrievalState = RETRIEVAL_STATE.SCOPED_RETRIEVAL_ALLOWED;
  let firstFailure = null;

  if (entityState === 'NOT_APPLICABLE' || semanticFrame.domain === 'CONVERSATIONAL' || semanticFrame.retrievalRequired === false) {
    retrievalState = RETRIEVAL_STATE.NO_RETRIEVAL;
    firstFailure = null;
  } else if (entityState === 'UNSUPPORTED') {
    // Section 17: Controlled UNSUPPORTED state causes NO_RETRIEVAL
    retrievalState = RETRIEVAL_STATE.NO_RETRIEVAL;
    firstFailure = FIRST_FAILURE_TAXONOMY.ENTITY_UNSUPPORTED;
  } else if (entityState === 'AMBIGUOUS') {
    // Section 4 & 13: AMBIGUOUS causes CLARIFICATION_REQUIRED, never arbitrary candidate selection
    retrievalState = RETRIEVAL_STATE.CLARIFICATION_REQUIRED;
    firstFailure = FIRST_FAILURE_TAXONOMY.ENTITY_AMBIGUOUS;
  } else if (entityState === 'UNKNOWN_UNVERIFIED') {
    // Section 16: UNKNOWN_UNVERIFIED causes NO_VERIFIED_ENTITY_EVIDENCE
    retrievalState = RETRIEVAL_STATE.NO_VERIFIED_ENTITY_EVIDENCE;
    firstFailure = FIRST_FAILURE_TAXONOMY.ENTITY_UNKNOWN;
  }

  // Sub-contracts for comparison
  const subContracts = [];
  if (isCompare && targetEntities.length > 1) {
    for (const ent of targetEntities) {
      const childObj = findCanonicalEntity(ent);
      subContracts.push({
        entityCanonical: ent,
        entityFamily: childObj ? childObj.family : 'academic_program',
        academicLevel,
        aspectFilter,
        requestedAspects
      });
    }
  }

  return {
    contractId: `rc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    entityCanonical: isCompare ? targetEntities : primaryEntityCanonical,
    entityState,
    entityFamily,
    academicLevel,
    requestedAspects,
    aspectFilter,
    semanticConcepts: semanticFrame.semanticConcepts || [],
    speechAct,
    scopeConstraints: {
      targetEntities,
      targetEntityIds,
      excludedEntities,
      allowedFamilies: entityFamily ? [entityFamily] : [],
      academicLevel,
      modifiers
    },
    ambiguityLevel,
    queryText,
    retrievalState,
    firstFailure,
    isComparative: isCompare,
    subContracts,
    metadataPolicy: {
      hardFilters: ['entity', 'family', 'academicLevel', 'aspect'],
      allowPartialMetadata: false,
      quarantineConflicts: true
    },
    provenance: {
      frameDomain: semanticFrame.domain,
      frameIntent: semanticFrame.intent
    }
  };
}

/**
 * Evaluates a candidate evidence chunk against the RetrievalContract's structured metadata.
 * Defines the 4 explicit evidence states: METADATA_MATCH, METADATA_PARTIAL, METADATA_MISSING, METADATA_CONFLICT.
 *
 * @param {Object} chunk - Evidence chunk
 * @param {Object} contract - RetrievalContract
 * @returns {Object} Metadata Evaluation Result
 */
function evaluateChunkMetadata(chunk = {}, contract = {}) {
  if (!chunk || typeof chunk !== 'object') {
    return { state: EVIDENCE_METADATA_STATE.METADATA_MISSING, reason: 'empty_chunk' };
  }

  const meta = chunk.metadata || {};
  const chunkEntityIds = Array.isArray(chunk.entityIds) ? chunk.entityIds : (Array.isArray(meta.entityIds) ? meta.entityIds : []);
  const chunkAspects = Array.isArray(chunk.providedAspects) ? chunk.providedAspects : (Array.isArray(meta.providedAspects) ? meta.providedAspects : []);
  const chunkLevels = Array.isArray(chunk.academicLevels) ? chunk.academicLevels : (Array.isArray(meta.academicLevels) ? meta.academicLevels : (chunk.academicLevel ? [chunk.academicLevel] : []));
  const chunkFamily = chunk.family || meta.family || null;

  const targetEntities = contract.scopeConstraints?.targetEntities || [];
  const targetIds = contract.scopeConstraints?.targetEntityIds || [];
  const excludedEntities = contract.scopeConstraints?.excludedEntities || [];
  const requestedAspects = contract.requestedAspects || [];
  const requestedLevel = contract.academicLevel;
  const requestedFamily = contract.entityFamily;

  const hasStructuredMetadata = chunkEntityIds.length > 0 || chunkAspects.length > 0 || chunkLevels.length > 0 || Boolean(chunk.provenanceDocumentId);

  // 1. Conflict Check: Explicit Exclusion or Sibling Mismatch
  if (excludedEntities.length > 0) {
    const chunkTextLower = (chunk.text || chunk.content || chunk.snippet || '').toLowerCase();
    const textHasTarget = targetEntities.some(t => {
      const tNorm = t.toLowerCase().replace(/_/g, ' ').trim();
      if (chunkTextLower.includes(tNorm)) return true;
      const canon = findCanonicalEntity(t);
      if (canon && Array.isArray(canon.aliases)) {
        return canon.aliases.some(al => {
          const alLower = al.toLowerCase().trim();
          if (alLower.length >= 3) {
            const escaped = alLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const re = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, 'i');
            return re.test(chunkTextLower);
          }
          return false;
        });
      }
      return false;
    });

    const matchesTarget = textHasTarget || targetEntities.some(t => {
      const tNorm = t.toLowerCase().replace(/_/g, ' ').trim();
      return chunkEntityIds.some(id => {
        const idNorm = String(id).toLowerCase().replace(/_/g, ' ').trim();
        return idNorm.includes(tNorm) || tNorm.includes(idNorm);
      });
    });

    if (!matchesTarget) {
      const matchesExcluded = excludedEntities.some(ex => {
        const exNorm = ex.toLowerCase().replace(/_/g, ' ').trim();
        return chunkEntityIds.some(id => {
          const idNorm = String(id).toLowerCase().replace(/_/g, ' ').trim();
          return idNorm.includes(exNorm);
        });
      });
      if (matchesExcluded) {
        return {
          state: EVIDENCE_METADATA_STATE.METADATA_CONFLICT,
          conflictType: 'EXCLUDED_ENTITY_COLLISION',
          reason: 'chunk_metadata_matches_excluded_sibling_entity'
        };
      }
    }
  }

  // 2. Academic Level Conflict Check
  if (requestedLevel && requestedLevel !== 'ALL' && chunkLevels.length > 0) {
    const isLevelMatch = chunkLevels.includes(requestedLevel);
    if (!isLevelMatch) {
      // Coarse document-level metadata may conflict with a specific section/chunk.
      // If the chunk body explicitly mentions/verifies the requested level, allow it.
      const chunkText = chunk.text || chunk.content || chunk.snippet || '';
      let textSupportsRequestedLevel = false;
      if (chunkText) {
        if (requestedLevel === 'S2' && /\b(?:s2|magister|pascasarjana)\b/i.test(chunkText)) {
          textSupportsRequestedLevel = true;
        } else if (requestedLevel === 'S1' && /\b(?:s1|sarjana|strata\s*1)\b/i.test(chunkText)) {
          textSupportsRequestedLevel = true;
        } else if (requestedLevel === 'D3' && /\b(?:d3|diploma|ahli\s*madya)\b/i.test(chunkText)) {
          textSupportsRequestedLevel = true;
        }
      }
      if (!textSupportsRequestedLevel) {
        return {
          state: EVIDENCE_METADATA_STATE.METADATA_CONFLICT,
          conflictType: 'ACADEMIC_LEVEL_MISMATCH',
          reason: `chunk_metadata_level_${chunkLevels.join('_')}_conflicts_with_${requestedLevel}`
        };
      }
    }
  }

  // 3. Family Conflict Check
  if (requestedFamily && chunkFamily && requestedFamily !== chunkFamily) {
    return {
      state: EVIDENCE_METADATA_STATE.METADATA_CONFLICT,
      conflictType: 'FAMILY_MISMATCH',
      reason: `chunk_family_${chunkFamily}_conflicts_with_${requestedFamily}`
    };
  }

  // 4. Metadata Match or Partial Check
  if (hasStructuredMetadata) {
    const entityMatch = targetEntities.length === 0 ||
      chunkEntityIds.some(id => targetEntities.some(t => {
        const idNorm = String(id).toLowerCase().replace(/_/g, ' ').trim();
        const tNorm = String(t).toLowerCase().replace(/_/g, ' ').trim();
        return idNorm.includes(tNorm) || tNorm.includes(idNorm);
      })) ||
      (targetIds.length > 0 && chunkEntityIds.some(id => targetIds.includes(id)));

    const aspectMatch = requestedAspects.length === 0 ||
      chunkAspects.some(a => requestedAspects.includes(normalizeAspect(a)));

    if (entityMatch && aspectMatch) {
      return {
        state: EVIDENCE_METADATA_STATE.METADATA_MATCH,
        reason: 'chunk_metadata_satisfies_contract_entity_and_aspect'
      };
    }

    if (entityMatch && !aspectMatch) {
      return {
        state: EVIDENCE_METADATA_STATE.METADATA_PARTIAL,
        reason: 'chunk_metadata_matches_entity_but_lacks_aspect'
      };
    }
  }

  // 5. Metadata Missing
  return {
    state: EVIDENCE_METADATA_STATE.METADATA_MISSING,
    reason: 'chunk_lacks_structured_metadata'
  };
}

/**
 * Arbitrates evidence strictly using RetrievalContract.
 * Enforces:
 * - Hard scope constraints (Entity, Family, Level, Aspect)
 * - Soft signal scoring (lexical / vector)
 * - Provenance / ownership tracking on every accepted chunk
 * - First-failure diagnosis
 *
 * @param {Array<Object>} candidates - Candidate chunks
 * @param {Object} contract - RetrievalContract
 * @param {Object} [options]
 * @returns {Object} Scoped Arbitration Result
 */
function arbitrateEvidenceWithContract(candidates = [], contract = {}, options = {}) {
  const startTime = Date.now();

  // 1. Contract State Interceptions
  if (contract.retrievalState === RETRIEVAL_STATE.NO_RETRIEVAL) {
    const isConversational = contract.entityState === 'NOT_APPLICABLE' || contract.provenance?.frameDomain === 'CONVERSATIONAL';
    return {
      contractId: contract.contractId,
      retrievalState: contract.retrievalState,
      accepted: [],
      rejected: candidates.map(c => ({ ...c, rejectionReason: isConversational ? 'CONVERSATIONAL_NO_RETRIEVAL' : 'UNSUPPORTED_ENTITY_NO_RETRIEVAL' })),
      firstFailure: isConversational ? null : FIRST_FAILURE_TAXONOMY.ENTITY_UNSUPPORTED,
      clarificationRequired: false,
      unsupportedEntity: !isConversational,
      hasSupportedEvidence: false,
      latencyMs: Date.now() - startTime
    };
  }

  if (contract.retrievalState === RETRIEVAL_STATE.CLARIFICATION_REQUIRED) {
    return {
      contractId: contract.contractId,
      retrievalState: contract.retrievalState,
      accepted: [],
      rejected: candidates.map(c => ({ ...c, rejectionReason: 'AMBIGUOUS_ENTITY_CLARIFICATION_REQUIRED' })),
      firstFailure: FIRST_FAILURE_TAXONOMY.ENTITY_AMBIGUOUS,
      clarificationRequired: true,
      unsupportedEntity: false,
      hasSupportedEvidence: false,
      latencyMs: Date.now() - startTime
    };
  }

  if (contract.retrievalState === RETRIEVAL_STATE.NO_VERIFIED_ENTITY_EVIDENCE) {
    return {
      contractId: contract.contractId,
      retrievalState: contract.retrievalState,
      accepted: [],
      rejected: candidates.map(c => ({ ...c, rejectionReason: 'UNKNOWN_UNVERIFIED_ENTITY_REJECTED' })),
      firstFailure: FIRST_FAILURE_TAXONOMY.ENTITY_UNKNOWN,
      clarificationRequired: false,
      unverifiedEntity: true,
      hasSupportedEvidence: false,
      latencyMs: Date.now() - startTime
    };
  }

  // 2. Candidate Evaluation Loop
  const accepted = [];
  const rejected = [];
  let detectedFirstFailure = null;

  const targetEntities = contract.scopeConstraints?.targetEntities || [];
  const excludedEntities = contract.scopeConstraints?.excludedEntities || [];
  const requestedAspects = contract.requestedAspects || [];
  const requestedLevel = contract.academicLevel;
  const requestedFamily = contract.entityFamily;

  for (const candidate of candidates) {
    const text = candidate.text || candidate.chunk || '';
    const textLower = text.toLowerCase();

    // Check Metadata Evaluation
    const metaEval = evaluateChunkMetadata(candidate, contract);

    // Hard Filter 1: Metadata Conflict
    if (metaEval.state === EVIDENCE_METADATA_STATE.METADATA_CONFLICT) {
      if (!detectedFirstFailure) detectedFirstFailure = FIRST_FAILURE_TAXONOMY.METADATA_CONFLICT;
      rejected.push({
        ...candidate,
        disposition: 'REJECT_METADATA_CONFLICT',
        dispositionReason: metaEval.reason,
        metadataState: metaEval.state
      });
      continue;
    }

    // Hard Filter 2: Excluded Sibling Entities
    let hasExcludedCollision = false;
    if (excludedEntities.length > 0) {
      for (const excluded of excludedEntities) {
        const exLower = excluded.toLowerCase();
        if (textLower.includes(exLower)) {
          // Allow only if target entity is also explicitly present
          const hasTarget = targetEntities.some(t => textLower.includes(t.toLowerCase()));
          if (!hasTarget) {
            hasExcludedCollision = true;
            break;
          }
        }
      }
    }
    if (hasExcludedCollision) {
      if (!detectedFirstFailure) detectedFirstFailure = FIRST_FAILURE_TAXONOMY.RETRIEVAL_SCOPE_MISMATCH;
      rejected.push({
        ...candidate,
        disposition: 'REJECT_SCOPE_COLLISION',
        dispositionReason: 'contains_conflicting_sibling_entity',
        metadataState: metaEval.state
      });
      continue;
    }

    // Hard Filter 3: Target Entity Scope
    if (targetEntities.length > 0) {
      const candEntityIds = Array.isArray(candidate.entityIds) ? candidate.entityIds : (candidate.metadata?.entityIds || []);
      const hasTargetInChunk = targetEntities.some(t => {
        const tLower = t.toLowerCase();
        const tNorm = tLower.replace(/_/g, ' ').trim();
        if (textLower.includes(tLower)) return true;
        if (candEntityIds.some(id => {
          const idNorm = String(id).toLowerCase().replace(/_/g, ' ').trim();
          return idNorm.includes(tNorm) || tNorm.includes(idNorm);
        })) return true;
        if (candidate.metadata?.entities && candidate.metadata.entities.some(e => {
          const eNorm = String(e.canonical || e).toLowerCase().replace(/_/g, ' ').trim();
          return eNorm.includes(tNorm) || tNorm.includes(eNorm);
        })) return true;

        // Check canonical aliases from registry with safe word-boundary matching
        const canon = findCanonicalEntity(t);
        if (canon && Array.isArray(canon.aliases)) {
          for (const al of canon.aliases) {
            const alLower = al.toLowerCase().trim();
            if (alLower.length >= 3) {
              const escaped = alLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const re = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, 'i');
              if (re.test(textLower)) return true;
            }
          }
        }
        return false;
      });

      if (!hasTargetInChunk) {
        if (!detectedFirstFailure) detectedFirstFailure = FIRST_FAILURE_TAXONOMY.RETRIEVAL_SCOPE_MISMATCH;
        rejected.push({
          ...candidate,
          disposition: 'REJECT_ENTITY_MISMATCH',
          dispositionReason: 'evidence_lacks_target_entity',
          metadataState: metaEval.state
        });
        continue;
      }
    }

    // Hard Filter 4: Academic Level
    if (requestedLevel && requestedLevel !== 'ALL') {
      let levelMismatch = false;
      if (requestedLevel === 'S2') {
        const isSmaSmkOnly = /\b(?:lulusan\s+sma|ijazah\s+sma|sma\/smk|smk\/sma)\b/i.test(text) &&
          !/\b(?:s1|d4|sarjana|magister|s2)\b/i.test(text);
        if (isSmaSmkOnly) levelMismatch = true;
      }
      if (candidate.academicLevel && candidate.academicLevel !== requestedLevel) {
        let textSupportsRequestedLevel = false;
        if (requestedLevel === 'S2' && /\b(?:s2|magister|pascasarjana)\b/i.test(text)) {
          textSupportsRequestedLevel = true;
        } else if (requestedLevel === 'S1' && /\b(?:s1|sarjana|strata\s*1)\b/i.test(text)) {
          textSupportsRequestedLevel = true;
        } else if (requestedLevel === 'D3' && /\b(?:d3|diploma|ahli\s*madya)\b/i.test(text)) {
          textSupportsRequestedLevel = true;
        }
        if (!textSupportsRequestedLevel) {
          levelMismatch = true;
        }
      }
      if (levelMismatch) {
        if (!detectedFirstFailure) detectedFirstFailure = FIRST_FAILURE_TAXONOMY.LEVEL_MISMATCH;
        rejected.push({
          ...candidate,
          disposition: 'REJECT_LEVEL_MISMATCH',
          dispositionReason: `requested_level_${requestedLevel}_mismatch`,
          metadataState: metaEval.state
        });
        continue;
      }
    }

    // Hard Filter 5: Family Mismatch
    if (requestedFamily && candidate.family && candidate.family !== requestedFamily) {
      if (!detectedFirstFailure) detectedFirstFailure = FIRST_FAILURE_TAXONOMY.FAMILY_MISMATCH;
      rejected.push({
        ...candidate,
        disposition: 'REJECT_FAMILY_MISMATCH',
        dispositionReason: `requested_family_${requestedFamily}_mismatch`,
        metadataState: metaEval.state
      });
      continue;
    }

    // Hard Filter 6: Aspect Scope
    if (requestedAspects.length > 0 && !requestedAspects.includes('general')) {
      let aspectMismatch = false;
      const chunkAspects = (candidate.providedAspects || candidate.metadata?.providedAspects || []).map(normalizeAspect).filter(Boolean);

      if (chunkAspects.length > 0) {
        // Section 8: Structured metadata is authoritative for aspect filtering
        const hasOverlap = chunkAspects.some(a =>
          requestedAspects.includes(a) ||
          (a === 'overview' && requestedAspects.includes('general')) ||
          (a === 'general' && requestedAspects.includes('overview'))
        );
        if (!hasOverlap) {
          aspectMismatch = true;
        }
      } else {
        // Section 9: Conservative content validation for legacy chunks lacking structured aspects.
        // A chunk is relevant if it provides factual evidence supporting AT LEAST ONE requested aspect.
        const aspectProofDetectors = {
          accreditation: /\b(?:akreditasi|ban-pt|lam\s+infokom|peringkat|sk\s+akreditasi|terakreditasi)\b/i,
          fee: /\b(?:biaya|uang\s+pangkal|dpp|spp|cicil|angsuran|semester|tarif)\b/i,
          requirements: /\b(?:syarat|persyaratan|berkas|dokumen|kelulusan|ijazah|paspor|visa|kitas|sktt|kualifikasi|wajib|ketentuan|aturan)\b/i,
          facilities: /\b(?:fasilitas|laboratorium|lab\b|gedung|ruang|sarana|career\s+center|cdc|perpustakaan|asrama)\b/i,
          schedule: /\b(?:jadwal|sore|malam|shift|waktu|hari|jam|sesi)\b/i,
          location: /\b(?:lokasi|kampus|alamat|gedung|dalian|tiongkok|china|malaysia|kuala lumpur|renon|jimbaran|asrama|dormitory)\b/i,
          career: /\b(?:karir|prospek|peluang|profesi|lulusan|pekerjaan|career\s+center|cdc|magang|internship)\b/i,
          curriculum: /\b(?:kurikulum|mata\s+kuliah|matakuliah|sks|semester|pembelajaran)\b/i,
          organization: /\b(?:ukm\b|unit\s+kegiatan\s+mahasiswa|organisasi|ormawa|hima\b|himaprodi|senat|balma|komunitas|ekstrakurikuler)\b/i,
          degree_award: /\b(?:gelar|sebutan|m\.kom|s\.kom|m\.ti|s\.ti|m\.m|s\.m|a\.md|ahli\s+madya|sarjana\s+komputer|magister\s+komputer)\b/i,
          degree: /\b(?:gelar|sebutan|m\.kom|s\.kom|m\.ti|s\.ti|m\.m|s\.m|a\.md|ahli\s+madya|sarjana\s+komputer|magister\s+komputer)\b/i,
          admission_track: /\b(?:jalur|pendaftaran|pmb|seleksi|gelombang|registrasi)\b/i,
          scholarship: /\b(?:beasiswa|kip|skss|potongan|bantuan)\b/i,
          international: /\b(?:internasional|double\s+degree|dual\s+degree|dnui|help|utb|asing|foreign|study\s+permit)\b/i,
          overview: /\b(?:profil|profile|tentang|visi|misi|tujuan|fokus|ketua\s+prodi|kaprodi|sekretaris\s+prodi|dekan|dosen|pengelola|pimpinan|identitas|gambaran|program\s+studi|prodi)\b/i
        };

        let hasAnyAspectProof = false;
        let evaluatedAspectCount = 0;

        for (const reqAspect of requestedAspects) {
          const detector = aspectProofDetectors[reqAspect];
          if (detector) {
            evaluatedAspectCount++;
            if (detector.test(text)) {
              hasAnyAspectProof = true;
              break;
            }
          }
        }

        if (evaluatedAspectCount > 0 && !hasAnyAspectProof) {
          aspectMismatch = true;
        }
      }

      if (aspectMismatch) {
        if (!detectedFirstFailure) detectedFirstFailure = FIRST_FAILURE_TAXONOMY.ASPECT_MISMATCH;
        rejected.push({
          ...candidate,
          disposition: 'REJECT_ASPECT_MISMATCH',
          dispositionReason: `requested_aspects_${requestedAspects.join('_')}_lacking`,
          metadataState: metaEval.state
        });
        continue;
      }
    }

    // Passed All Hard Gates -> Accept with Ownership / Lineage (Section 18)
    accepted.push({
      ...candidate,
      disposition: 'SUPPORTS',
      acceptanceReason: 'passed_hard_scope_aspect_and_level_gates',
      chunkId: candidate.id || candidate.source_record_id || `chunk_${candidate.index || accepted.length}`,
      sourceDocument: candidate.source_file || candidate.source || 'canonical_corpus',
      provenanceDocumentId: candidate.provenanceDocumentId || candidate.metadata?.provenanceDocumentId || null,
      entityIds: candidate.entityIds || candidate.metadata?.entityIds || (targetEntities.length ? [targetEntities[0]] : []),
      providedAspects: candidate.providedAspects || candidate.metadata?.providedAspects || requestedAspects,
      academicLevel: candidate.academicLevel || candidate.metadata?.academicLevel || requestedLevel,
      metadataState: metaEval.state
    });
  }

  // First-Failure determination
  if (accepted.length === 0 && !detectedFirstFailure) {
    detectedFirstFailure = FIRST_FAILURE_TAXONOMY.NO_EVIDENCE;
  } else if (accepted.length > 0) {
    detectedFirstFailure = FIRST_FAILURE_TAXONOMY.EVIDENCE_ACCEPTED;
  }

  return {
    contractId: contract.contractId,
    retrievalState: contract.retrievalState,
    accepted,
    rejected,
    firstFailure: detectedFirstFailure,
    hasSupportedEvidence: accepted.length > 0,
    clarificationRequired: false,
    unsupportedEntity: false,
    latencyMs: Date.now() - startTime
  };
}

/**
 * Shadow Comparison Recorder: Compares legacy retrieval against contract-arbitrated retrieval.
 * Does NOT alter production execution.
 */
function compareRetrievalShadow(rawQuery, legacyCandidates = [], legacyArbitrated = {}, contract = {}, newArbitrated = {}) {
  const legacyAccepted = legacyArbitrated.accepted || [];
  const newAccepted = newArbitrated.accepted || [];

  let firstDifference = null;
  if (legacyArbitrated.hasSupportedEvidence !== newArbitrated.hasSupportedEvidence) {
    firstDifference = `EVIDENCE_PRESENCE: legacy=${legacyArbitrated.hasSupportedEvidence} vs new=${newArbitrated.hasSupportedEvidence}`;
  } else if (legacyAccepted.length !== newAccepted.length) {
    firstDifference = `COUNT_MISMATCH: legacy=${legacyAccepted.length} vs new=${newAccepted.length}`;
  }

  return {
    rawQuery,
    timestamp: new Date().toISOString(),
    contractState: contract.retrievalState,
    firstFailure: newArbitrated.firstFailure,
    legacyCandidatesCount: legacyCandidates.length,
    newCandidatesCount: newArbitrated.accepted.length + newArbitrated.rejected.length,
    legacyAcceptedCount: legacyAccepted.length,
    newAcceptedCount: newAccepted.length,
    firstDifference,
    scopeDifference: contract.scopeConstraints?.targetEntities || [],
    aspectDifference: contract.requestedAspects || [],
    levelDifference: contract.academicLevel || null
  };
}

module.exports = {
  RETRIEVAL_STATE,
  EVIDENCE_METADATA_STATE,
  FIRST_FAILURE_TAXONOMY,
  normalizeAspect,
  buildRetrievalContract,
  evaluateChunkMetadata,
  arbitrateEvidenceWithContract,
  compareRetrievalShadow
};
