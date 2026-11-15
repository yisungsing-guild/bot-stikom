'use strict';

/**
 * src/core/semanticInterpretationValidator.js
 *
 * Greenfield Semantic Validation Gate & Compatibility-Aware Context Resolver.
 * Phase B: SHADOW / LOCAL ONLY.
 *
 * Invariants:
 * - Deterministic validation gate; NOT another semantic interpreter.
 * - Does NOT infer meaning from raw query keywords or regexes.
 * - Enforces schema, enum, confidence, and structural integrity.
 * - Enforces multi-entity safety (never arbitrary lexical/recency picking).
 * - Enforces category-level domain compatibility for context inheritance.
 * - Protects against academic-level contradictions.
 * - Fails closed to safe UNKNOWN / HIGH ambiguity on unrecoverable malformed input.
 */

const logger = require('../logger');
const {
  ALLOWED_SPEECH_ACTS,
  ALLOWED_SEMANTIC_CONCEPTS,
  ALLOWED_REQUESTED_ASPECTS,
  ALLOWED_INFERRED_CATEGORIES,
  ALLOWED_AMBIGUITY_LEVELS,
  ALLOWED_REFERENCE_TYPES,
  ALLOWED_LOCATION_SCOPES,
  buildSafeUnknownInterpretation
} = require('./modelSemanticParser');
const { findCanonicalEntity } = require('../engine/canonicalEntityRegistry');

/**
 * Failure classifications for shadow evaluation tracing.
 */
const FAILURE_TYPES = Object.freeze({
  NO_DIFFERENCE: 'NO_DIFFERENCE',
  MODEL_SEMANTIC_FAILURE: 'MODEL_SEMANTIC_FAILURE',
  SCHEMA_FAILURE: 'SCHEMA_FAILURE',
  CONTEXT_COMPATIBILITY_FAILURE: 'CONTEXT_COMPATIBILITY_FAILURE',
  ENTITY_AMBIGUITY_FAILURE: 'ENTITY_AMBIGUITY_FAILURE',
  LEVEL_CONTRADICTION: 'LEVEL_CONTRADICTION',
  LEGACY_RESOLVER_DIFFERENCE: 'LEGACY_RESOLVER_DIFFERENCE'
});

/**
 * Semantic compatibility matrix:
 * Defines permitted requestedAspects for each entity inferredCategory.
 * Operating on metadata categories, NEVER keyword regex.
 */
const CATEGORY_ASPECT_COMPATIBILITY = Object.freeze({
  academic_program: Object.freeze([
    'curriculum', 'fee', 'accreditation', 'requirements',
    'procedure', 'schedule', 'career', 'study_duration',
    'degree_award', 'general', 'location', 'facilities', 'contact'
  ]),
  campus_service: Object.freeze([
    'facilities', 'procedure', 'schedule', 'location',
    'requirements', 'contact', 'general'
  ]),
  facility: Object.freeze([
    'facilities', 'location', 'schedule', 'procedure', 'contact', 'general'
  ]),
  student_organization: Object.freeze([
    'organization', 'procedure', 'schedule', 'facilities', 'contact', 'general'
  ]),
  scholarship: Object.freeze([
    'requirements', 'procedure', 'fee', 'schedule', 'contact', 'general'
  ]),
  admission_track: Object.freeze([
    'requirements', 'procedure', 'schedule', 'fee', 'contact', 'general'
  ]),
  institution: Object.freeze([
    'accreditation', 'location', 'facilities', 'procedure', 'contact', 'general'
  ]),
  external_partner: Object.freeze([
    'general', 'location', 'requirements', 'contact'
  ]),
  academic_event: Object.freeze([
    'schedule', 'procedure', 'requirements', 'fee', 'general', 'contact'
  ]),
  unknown: Object.freeze(['general', 'contact'])
});

/**
 * Concept-to-domain mapping for standardizing the validated frame's primary domain.
 */
const CONCEPT_TO_DOMAIN_MAP = Object.freeze({
  ACADEMIC_OFFERING: 'ACADEMIC_PROGRAM',
  QUALITY_ACCREDITATION: 'ACCREDITATION',
  FINANCIAL_COST: 'TUITION_FEE',
  ADMISSION_ONBOARDING: 'ADMISSION_INFO',
  CAMPUS_LIFE: 'FACILITIES',
  INTERNATIONAL_STUDY: 'INTERNATIONAL',
  CAREER_EMPLOYMENT: 'CAREER_CENTER',
  STUDY_SCHEDULE: 'ACADEMIC_PROGRAM',
  TRANSFER_CREDIT: 'ADMISSION_INFO'
});

/**
 * Checks whether two academic levels are compatible.
 * Returns false if both are specified and differ (e.g. S1 vs S2).
 */
function areAcademicLevelsCompatible(levelA, levelB) {
  if (!levelA || !levelB) return true;
  if (levelA === 'ALL' || levelB === 'ALL') return true;
  return String(levelA).toUpperCase() === String(levelB).toUpperCase();
}

/**
 * Official degree eligibility mapping for admission tracks at ITB STIKOM Bali.
 * Sourced directly from official PMB policies and canonicalEntityRegistry.
 */
const TRACK_DEGREE_COMPATIBILITY = Object.freeze({
  'Jalur Reguler': ['S1', 'D3'],
  'Jalur Eksekutif (Karyawan)': ['S1'],
  'RPL (Rekognisi Pembelajaran Lampau)': ['S1'],
  'Jalur Internasional': ['S1'],
  'Mahasiswa Pindahan / Transfer': ['S1', 'D3']
});

/**
 * Resolves the official parent academic program for an international program record.
 * Uses explicit parentProgram field or verified credentials metadata in canonicalEntityRegistry.
 *
 * @param {Object} intlRecord - Canonical entity registry record
 * @returns {string|null} Canonical name of parent program or null
 */
function resolveInternationalParentProgram(intlRecord) {
  if (!intlRecord || typeof intlRecord !== 'object') return null;
  if (intlRecord.parentProgram) {
    const matched = findCanonicalEntity(intlRecord.parentProgram);
    return matched ? matched.canonical : null;
  }
  if (Array.isArray(intlRecord.credentials)) {
    const credText = intlRecord.credentials.join(' ');
    // Match explicit academic programs or unambiguous program degree in ITB STIKOM Bali
    if (/\b(?:program\s+studi\s+)?bisnis\s+digital\b/i.test(credText) || /\bsarjana\s+bisnis\b/i.test(credText)) {
      return 'S1 Bisnis Digital';
    }
    if (/\b(?:program\s+studi\s+)?sistem\s+informasi\b/i.test(credText)) {
      return 'S1 Sistem Informasi';
    }
    if (/\b(?:program\s+studi\s+)?teknologi\s+informasi\b/i.test(credText)) {
      return 'S1 Teknologi Informasi';
    }
    if (/\b(?:program\s+studi\s+)?sistem\s+komputer\b/i.test(credText)) {
      return 'S1 Sistem Komputer';
    }
    // Note: Do NOT infer S1 Sistem Informasi from bare S.Kom because S.Kom is shared across SI, TI, and SK.
  }
  return null;
}

/**
 * Determines whether candidate entities contain genuine competing alternatives
 * rather than compatible or contextual entity pairs (e.g. host institution + academic_program).
 *
 * Invariants:
 * 1. Candidates referring to the same canonical entity (e.g. duplicate extractions or alias variants)
 *    are deduplicated and must NEVER be treated as competing.
 * 2. Only the official host institution (ITB STIKOM Bali and its verified aliases) qualifies as an
 *    enclosing parent organization context for internal programs, tracks, facilities, or services.
 *    Any substantive entity paired with the host institution MUST be verified in the canonical registry.
 * 3. External institutions (e.g. Universitas Udayana, UGM) do NOT have an unproven parent-child relation
 *    with internal programs and MUST be treated as competing alternatives.
 * 4. Academic program + admission track requires both entities to be verified in canonical registry
 *    and matching degree eligibility (TRACK_DEGREE_COMPATIBILITY).
 * 5. Academic program + international program requires both entities to be verified in canonical registry
 *    and an exact match with the international program's canonical parentProgram.
 * 6. SAFE DEFAULT: All other combinations without proven relationship compete without explicit COMPARE.
 */
function hasMultipleCompetingEntities(candidates, speechAct) {
  if (!Array.isArray(candidates) || candidates.length <= 1) return false;
  if (speechAct === 'COMPARE') return false;

  // 1. Resolve canonical identity and deduplicate candidates
  const uniqueEntities = [];
  const seenKeys = new Set();

  for (const cand of candidates) {
    if (!cand) continue;
    const rawStr = typeof cand === 'string' ? cand : (cand.canonical || cand.rawMention || cand.mention || cand.name || '');
    const declaredCat = typeof cand === 'object' ? (cand.inferredCategory || cand.category || 'unknown') : 'unknown';
    if (!rawStr || !rawStr.trim()) continue;

    const registryMatch = findCanonicalEntity(rawStr);
    let canonicalName = registryMatch ? registryMatch.canonical : rawStr.trim();

    const isHost = Boolean(
      canonicalName === 'Kampus ITB STIKOM Bali' ||
      canonicalName === 'ITB STIKOM Bali' ||
      /^(?:(?:itb\s+)?stikom(?:\s+bali)?|institut\s+teknologi\s+dan\s+bisnis\s+stikom\s+bali)$/i.test(rawStr.trim()) ||
      /^(?:(?:itb\s+)?stikom(?:\s+bali)?|institut\s+teknologi\s+dan\s+bisnis\s+stikom\s+bali)$/i.test(canonicalName)
    );

    if (isHost) {
      canonicalName = 'ITB STIKOM Bali';
    }

    const effectiveCat = isHost
      ? 'institution'
      : (registryMatch?.type || registryMatch?.family || declaredCat);

    const normKey = (registryMatch ? 'reg::' + registryMatch.canonical : 'raw::' + effectiveCat + '::' + canonicalName)
      .toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();

    if (!seenKeys.has(normKey)) {
      seenKeys.add(normKey);
      uniqueEntities.push({
        canonical: canonicalName,
        category: effectiveCat,
        isHostInstitution: isHost,
        isRegistered: Boolean(registryMatch || isHost),
        registryRecord: registryMatch || (isHost ? { canonical: 'ITB STIKOM Bali', type: 'institution', family: 'institution' } : null),
        rawCandidate: cand
      });
    }
  }

  // If after canonical deduplication only 1 or 0 unique entities remain, not competing!
  if (uniqueEntities.length <= 1) {
    return false;
  }

  // 2. Separate into official host institution vs other candidates
  const hostInstitutions = [];
  const otherCandidates = [];

  for (const ent of uniqueEntities) {
    if (ent.isHostInstitution) {
      hostInstitutions.push(ent);
    } else {
      otherCandidates.push(ent);
    }
  }

  // Multiple distinct host institutions (already deduped, but safety check)
  if (hostInstitutions.length > 1) {
    return true;
  }

  // Exactly 1 host institution + at most 1 substantive candidate:
  // Complementary context: host institution enclosing internal academic program, facility, service, track, or organization
  // Substantive entity MUST be genuinely registered in CANONICAL_ENTITIES
  if (hostInstitutions.length === 1 && otherCandidates.length === 1) {
    const substantive = otherCandidates[0];
    if (!substantive.isRegistered || !substantive.registryRecord) {
      return true; // Unregistered entity -> COMPETING (triggers clarification)
    }

    const permittedSubstantiveCategories = new Set([
      'program',
      'academic_program',
      'facility',
      'campus_facility',
      'campus_service',
      'admission_track',
      'student_organization',
      'student_association',
      'student_activity_unit',
      'organization',
      'scholarship',
      'academic_event',
      'international_program',
      'special_program',
      'campus'
    ]);

    const regType = substantive.registryRecord.type;
    const regFamily = substantive.registryRecord.family;
    if (permittedSubstantiveCategories.has(regType) || permittedSubstantiveCategories.has(regFamily)) {
      return false; // Proven official internal entity of ITB STIKOM Bali
    }

    return true; // Registered but not an internal campus component -> COMPETING
  }

  // If host institution is present alongside multiple non-host candidates, compete
  if (hostInstitutions.length === 1 && otherCandidates.length > 1) {
    return true;
  }

  // Count candidates per category
  const categoryCounts = new Map();
  for (const ent of otherCandidates) {
    categoryCounts.set(ent.category, (categoryCounts.get(ent.category) || 0) + 1);
  }

  // Multiple distinct entities within the same category (e.g. 2 different academic_programs) compete!
  for (const [, count] of categoryCounts) {
    if (count > 1) return true;
  }

  // If an external institution (not host) is present, it competes with academic programs or other institutions!
  if (otherCandidates.some(e => e.category === 'institution')) {
    return true;
  }

  // Relationship check: academic_program + admission_track
  const progCandidate = otherCandidates.find(e =>
    e.category === 'academic_program' ||
    e.registryRecord?.family === 'academic_program' ||
    e.registryRecord?.type === 'program'
  );
  const trackCandidate = otherCandidates.find(e =>
    e.category === 'admission_track' ||
    e.registryRecord?.family === 'admission_track' ||
    e.registryRecord?.type === 'admission_track'
  );

  if (progCandidate && trackCandidate && otherCandidates.length === 2) {
    if (!progCandidate.isRegistered || !trackCandidate.isRegistered || !progCandidate.registryRecord || !trackCandidate.registryRecord) {
      return true; // Unregistered entity -> COMPETING
    }
    const trackCanonical = trackCandidate.registryRecord.canonical;
    const allowedDegrees = TRACK_DEGREE_COMPATIBILITY[trackCanonical];
    const progDegree = progCandidate.registryRecord.degree;
    if (allowedDegrees && progDegree && allowedDegrees.includes(progDegree)) {
      return false; // Proven relationship: admission track officially covers program degree
    }
    return true; // Incompatible track/degree -> COMPETING
  }

  // Relationship check: academic_program + international_program
  const intlCandidate = otherCandidates.find(e =>
    e.category === 'international_program' ||
    e.category === 'external_partner' ||
    e.registryRecord?.family === 'international_program' ||
    e.registryRecord?.type === 'international_program'
  );

  if (progCandidate && intlCandidate && otherCandidates.length === 2) {
    if (!progCandidate.isRegistered || !intlCandidate.isRegistered || !progCandidate.registryRecord || !intlCandidate.registryRecord) {
      return true; // Unregistered entity -> COMPETING
    }
    const parentProgCanonical = resolveInternationalParentProgram(intlCandidate.registryRecord);
    if (parentProgCanonical && parentProgCanonical === progCandidate.registryRecord.canonical) {
      return false; // Proven exact parent program relationship
    }
    return true; // Mismatched or unproven parent program -> COMPETING
  }

  // SAFE DEFAULT: All other combinations without proven relationship compete without explicit COMPARE
  return true;
}

/**
 * Normalizes prior context input from various shapes (sessionData, previous frame, array).
 * Strictly operates on structured metadata, NEVER regex on raw queries.
 */
function extractNormalizedPriorContext(priorState) {
  if (!priorState || typeof priorState !== 'object') {
    return {
      priorEntities: [],
      priorAcademicLevel: null,
      priorDomain: null,
      isAmbiguous: false,
      hasPriorContext: false
    };
  }

  // Handle case where priorState is already a normalized priorContext or VerifiedSemanticFrame
  if (Array.isArray(priorState.priorEntities)) {
    return {
      priorEntities: priorState.priorEntities,
      priorAcademicLevel: priorState.priorAcademicLevel || null,
      priorDomain: priorState.priorDomain || null,
      isAmbiguous: Boolean(priorState.isAmbiguous),
      hasPriorContext: priorState.priorEntities.length > 0 || Boolean(priorState.priorDomain)
    };
  }

  // Handle previous VerifiedSemanticFrame
  if (priorState.candidateEntities && Array.isArray(priorState.candidateEntities)) {
    const isAmb = priorState.ambiguityLevel === 'HIGH' || priorState.candidateEntities.length > 1;
    return {
      priorEntities: priorState.candidateEntities.map(e => ({
        mention: e.rawMention || e.canonical || 'unknown',
        canonical: e.canonical || e.rawMention || 'unknown',
        category: e.inferredCategory || e.category || 'academic_program',
        academicLevel: e.academicLevel || null
      })),
      priorAcademicLevel: priorState.scopeConstraints?.academicLevel || priorState.academicLevel || null,
      priorDomain: priorState.domain || null,
      isAmbiguous: isAmb,
      hasPriorContext: true
    };
  }

  // Handle sessionData format from existing bot architecture
  const rawEntities = [];

  // Check multiple entities in sessionData
  if (Array.isArray(priorState.activeEntities) && priorState.activeEntities.length > 0) {
    for (const ent of priorState.activeEntities) {
      if (typeof ent === 'string') {
        rawEntities.push({
          mention: ent,
          canonical: ent,
          category: priorState.activeCategory || 'academic_program',
          academicLevel: priorState.activeAcademicLevel || priorState.academicLevel || null
        });
      } else if (ent && typeof ent === 'object') {
        rawEntities.push({
          mention: ent.mention || ent.canonical || ent.rawMention || 'unknown',
          canonical: ent.canonical || ent.rawMention || 'unknown',
          category: ent.category || ent.inferredCategory || priorState.activeCategory || 'academic_program',
          academicLevel: ent.academicLevel || ent.degree || priorState.activeAcademicLevel || null
        });
      }
    }
  } else if (priorState.activeEntity) {
    const ent = priorState.activeEntity;
    if (typeof ent === 'string') {
      rawEntities.push({
        mention: ent,
        canonical: ent,
        category: priorState.activeCategory || 'academic_program',
        academicLevel: priorState.activeAcademicLevel || priorState.academicLevel || null
      });
    } else if (typeof ent === 'object') {
      rawEntities.push({
        mention: ent.mention || ent.canonical || ent.rawMention || 'unknown',
        canonical: ent.canonical || ent.rawMention || 'unknown',
        category: ent.category || ent.inferredCategory || priorState.activeCategory || 'academic_program',
        academicLevel: ent.academicLevel || ent.degree || priorState.activeAcademicLevel || null
      });
    }
  }

  const isAmbiguous = Boolean(
    priorState.isAmbiguous ||
    priorState.ambiguityLevel === 'HIGH' ||
    rawEntities.length > 1
  );

  const hasPriorContext = Boolean(
    rawEntities.length > 0 ||
    priorState.activeDomain ||
    priorState.lastQuery
  );

  return {
    priorEntities: rawEntities,
    priorAcademicLevel: priorState.activeAcademicLevel || priorState.academicLevel || (rawEntities[0]?.academicLevel || null),
    priorDomain: priorState.activeDomain || null,
    isAmbiguous,
    hasPriorContext
  };
}

/**
 * Validates the raw SemanticInterpretation structure and enums.
 * Never silently invents missing semantic information.
 */
function validateSchemaAndEnums(data) {
  const errors = [];

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, errors: ['Interpretation must be a non-null object'] };
  }

  // 1. SpeechAct
  if (!ALLOWED_SPEECH_ACTS.includes(data.speechAct)) {
    errors.push(`Invalid speechAct: "${data.speechAct}". Expected one of: ${ALLOWED_SPEECH_ACTS.join(', ')}`);
  }

  // 1b. UserInterest (optional string or null)
  if (data.userInterest !== undefined && data.userInterest !== null && typeof data.userInterest !== 'string') {
    errors.push('userInterest must be a string or null');
  }

  // 2. SemanticConcepts
  if (!Array.isArray(data.semanticConcepts)) {
    errors.push('semanticConcepts must be an array');
  } else {
    for (const c of data.semanticConcepts) {
      if (!ALLOWED_SEMANTIC_CONCEPTS.includes(c)) {
        errors.push(`Invalid semanticConcept: "${c}"`);
      }
    }
  }

  // 3. RequestedAspects
  if (!Array.isArray(data.requestedAspects)) {
    errors.push('requestedAspects must be an array');
  } else {
    for (const a of data.requestedAspects) {
      if (!ALLOWED_REQUESTED_ASPECTS.includes(a)) {
        errors.push(`Invalid requestedAspect: "${a}"`);
      }
    }
  }

  // 4. CandidateEntities
  if (!Array.isArray(data.candidateEntities)) {
    errors.push('candidateEntities must be an array');
  } else {
    for (let i = 0; i < data.candidateEntities.length; i++) {
      const ent = data.candidateEntities[i];
      if (!ent || typeof ent !== 'object') {
        errors.push(`candidateEntities[${i}] must be an object`);
        continue;
      }
      if (typeof ent.rawMention !== 'string' || ent.rawMention.trim() === '') {
        errors.push(`candidateEntities[${i}].rawMention must be a non-empty string`);
      }
      if (!ALLOWED_INFERRED_CATEGORIES.includes(ent.inferredCategory)) {
        errors.push(`candidateEntities[${i}].inferredCategory "${ent.inferredCategory}" is invalid`);
      }
      if (ent.academicLevel !== null && !['S1', 'S2', 'D3', 'ALL'].includes(ent.academicLevel)) {
        errors.push(`candidateEntities[${i}].academicLevel "${ent.academicLevel}" is invalid`);
      }
    }
  }

  // 5. ScopeConstraints
  if (!data.scopeConstraints || typeof data.scopeConstraints !== 'object') {
    errors.push('scopeConstraints must be an object');
  } else {
    const sc = data.scopeConstraints;
    if (sc.academicLevel !== null && !['S1', 'S2', 'D3'].includes(sc.academicLevel)) {
      errors.push(`scopeConstraints.academicLevel "${sc.academicLevel}" is invalid`);
    }
    if (sc.studyMode !== null && !['regular', 'evening_worker', 'international', 'rpl_transfer'].includes(sc.studyMode)) {
      errors.push(`scopeConstraints.studyMode "${sc.studyMode}" is invalid`);
    }
    if (sc.locationConstraint !== null && typeof sc.locationConstraint !== 'string') {
      errors.push('scopeConstraints.locationConstraint must be string or null');
    }
    if (sc.locationScope !== undefined && sc.locationScope !== null && !ALLOWED_LOCATION_SCOPES.includes(sc.locationScope)) {
      errors.push(`scopeConstraints.locationScope "${sc.locationScope}" is invalid. Expected ALL, SINGLE, or GENERAL`);
    }
    // Consistency rules
    if (sc.locationScope === 'SINGLE') {
      if (!sc.locationConstraint || typeof sc.locationConstraint !== 'string' || sc.locationConstraint.trim() === '') {
        errors.push('scopeConstraints.locationConstraint must be a non-empty string when locationScope is "SINGLE"');
      } else {
        const campusEntity = findCanonicalEntity(sc.locationConstraint.trim());
        if (!campusEntity || (campusEntity.family !== 'campus_location' && campusEntity.type !== 'campus')) {
          errors.push(`scopeConstraints.locationConstraint "${sc.locationConstraint}" is not a recognized campus location`);
        }
      }
    }
    if (sc.locationScope === 'ALL' && sc.locationConstraint && sc.locationConstraint.toLowerCase() !== 'all') {
      errors.push('scopeConstraints.locationConstraint must be null or "all" when locationScope is "ALL"');
    }
    if (sc.locationScope === 'GENERAL' && sc.locationConstraint !== null && sc.locationConstraint !== undefined && sc.locationConstraint.trim?.() !== '') {
      errors.push('scopeConstraints.locationConstraint must be null or empty when locationScope is "GENERAL"');
    }
  }

  // 6. ContextDependency
  if (!data.contextDependency || typeof data.contextDependency !== 'object') {
    errors.push('contextDependency must be an object');
  } else {
    const cd = data.contextDependency;
    if (typeof cd.isFollowUp !== 'boolean') {
      errors.push('contextDependency.isFollowUp must be a boolean');
    }
    if (!ALLOWED_REFERENCE_TYPES.includes(cd.referenceType)) {
      errors.push(`contextDependency.referenceType "${cd.referenceType}" is invalid`);
    }
  }

  // 7. Confidence sanity check
  if (typeof data.confidence !== 'number' || Number.isNaN(data.confidence) || data.confidence < 0.0 || data.confidence > 1.0) {
    errors.push(`confidence must be a number between 0.0 and 1.0, received: ${data.confidence}`);
  }

  // 8. AmbiguityLevel
  if (!ALLOWED_AMBIGUITY_LEVELS.includes(data.ambiguityLevel)) {
    errors.push(`Invalid ambiguityLevel: "${data.ambiguityLevel}". Expected LOW, MEDIUM, or HIGH`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validates a SemanticInterpretation and resolves context compatibility deterministically.
 *
 * @param {Object} interpretation - Raw SemanticInterpretation from modelSemanticParser
 * @param {Object} [priorContext] - Session state or prior conversation context
 * @param {Object} [options] - Optional validation options
 * @returns {Object} ValidationResult containing verified SemanticFrame
 */
function validateSemanticInterpretation(interpretation, priorContext = null, options = {}) {
  const normPrior = extractNormalizedPriorContext(priorContext);

  // 1. Structural and Enum Schema Validation
  const schemaCheck = validateSchemaAndEnums(interpretation);
  if (!schemaCheck.valid) {
    logger.warn({ errors: schemaCheck.errors }, '[semanticInterpretationValidator] Schema validation failed; rejecting safely');
    const safeUnknown = buildSafeUnknownInterpretation('', 'schema_validation_failure', {
      validationErrors: schemaCheck.errors
    });

    return {
      isValid: false,
      validationStatus: 'REJECTED_SCHEMA',
      validatedFrame: {
        ...safeUnknown,
        domain: 'GENERAL',
        inheritedEntities: [],
        requiresClarification: true,
        clarificationReason: 'SCHEMA_VALIDATION_FAILURE',
        entityResolutionStatus: 'UNRESOLVED',
        provenance: {
          entitySource: 'NONE',
          levelSource: 'UNCONSTRAINED',
          inheritedFrom: null
        },
        validationErrors: schemaCheck.errors
      },
      compatibilityResult: {
        isEligibleForInheritance: false,
        inheritedEntities: [],
        reason: 'schema_invalid',
        isCompatible: false,
        levelContradiction: false,
        domainIncompatible: false,
        priorEntityAmbiguity: false
      },
      ambiguityResult: {
        level: 'HIGH',
        isAmbiguous: true,
        reason: 'SCHEMA_INVALID',
        competingCandidates: []
      },
      errors: schemaCheck.errors
    };
  }

  // If interpretation indicates fallback/timeout already occurred
  if (interpretation.metadata?.fallbackInvoked && interpretation.speechAct === 'UNKNOWN') {
    return {
      isValid: true, // structurally valid fallback
      validationStatus: 'UNKNOWN',
      validatedFrame: {
        ...interpretation,
        domain: 'GENERAL',
        inheritedEntities: [],
        requiresClarification: true,
        clarificationReason: interpretation.metadata?.reason || 'PARSER_UNKNOWN',
        entityResolutionStatus: 'UNRESOLVED',
        provenance: {
          entitySource: 'NONE',
          levelSource: 'UNCONSTRAINED',
          inheritedFrom: null
        },
        validationErrors: []
      },
      compatibilityResult: {
        isEligibleForInheritance: false,
        inheritedEntities: [],
        reason: 'parser_unknown_fallback',
        isCompatible: false,
        levelContradiction: false,
        domainIncompatible: false,
        priorEntityAmbiguity: false
      },
      ambiguityResult: {
        level: 'HIGH',
        isAmbiguous: true,
        reason: 'PARSER_UNKNOWN_FALLBACK',
        competingCandidates: []
      },
      errors: []
    };
  }

  // 2. Candidate Entities & Multi-Entity Safety
  const explicitCandidates = [...interpretation.candidateEntities];
  let finalAmbiguityLevel = interpretation.ambiguityLevel;
  let requiresClarification = false;
  let clarificationReason = null;

  // Multi-entity safety invariant:
  // If multiple competing candidate entities exist and speechAct is NOT explicit COMPARE,
  // ambiguity MUST NOT be LOW. We preserve all candidates and never pick one!
  // Compatible pairs (e.g. academic_program + institution) do not force HIGH ambiguity.
  if (hasMultipleCompetingEntities(explicitCandidates, interpretation.speechAct)) {
    finalAmbiguityLevel = 'HIGH';
    requiresClarification = true;
    clarificationReason = 'MULTIPLE_COMPETING_ENTITIES';
  }

  // 3. Academic Level Consistency Check
  let levelContradiction = false;
  let levelContradictionReason = null;

  // Determine current interpretation's declared academic level
  const currentScopeLevel = interpretation.scopeConstraints?.academicLevel || null;
  const currentEntityLevels = explicitCandidates
    .map(e => e.academicLevel)
    .filter(Boolean);

  const effectiveCurrentLevel = currentScopeLevel || (currentEntityLevels.length === 1 ? currentEntityLevels[0] : null);
  const priorLevel = normPrior.priorAcademicLevel;

  if (effectiveCurrentLevel && priorLevel && !areAcademicLevelsCompatible(effectiveCurrentLevel, priorLevel)) {
    levelContradiction = true;
    levelContradictionReason = `Academic level mismatch: current declared "${effectiveCurrentLevel}" contradicts prior "${priorLevel}"`;
    finalAmbiguityLevel = 'HIGH';
    requiresClarification = true;
    clarificationReason = 'ACADEMIC_LEVEL_CONTRADICTION';
  }

  // 4. Context Compatibility & Entity Inheritance Rules (Deterministic)
  // Section 5 Rules:
  // A. current interpretation is genuinely follow-up/elliptical
  // B. prior entity is unambiguous
  // C. requested aspect is compatible with prior entity domain
  // D. academic level is compatible
  // E. no contradictory new entity is present
  const isFollowUp = Boolean(
    interpretation.contextDependency?.isFollowUp &&
    interpretation.contextDependency?.referenceType !== 'none'
  );

  let isEligibleForInheritance = false;
  let domainIncompatible = false;
  let domainIncompatibleReason = null;
  let priorEntityAmbiguity = false;
  let inheritanceReason = 'none';
  const inheritedEntities = [];

  if (isFollowUp) {
    if (!normPrior.hasPriorContext) {
      inheritanceReason = 'no_prior_context_available';
    } else if (normPrior.isAmbiguous || normPrior.priorEntities.length > 1) {
      // Condition B FAILS: Prior context had multiple entities
      priorEntityAmbiguity = true;
      finalAmbiguityLevel = 'HIGH';
      requiresClarification = true;
      clarificationReason = 'PRIOR_CONTEXT_MULTIPLE_ENTITIES_AMBIGUOUS';
      inheritanceReason = 'prior_entity_ambiguous';
    } else if (explicitCandidates.length > 0) {
      // Condition E: Current query explicitly specified its own entity; do not inherit
      inheritanceReason = 'current_entity_already_present';
    } else if (levelContradiction) {
      // Condition D FAILS: Level contradiction
      inheritanceReason = 'level_contradiction_blocks_inheritance';
    } else if (normPrior.priorEntities.length === 1) {
      const candidatePriorEntity = normPrior.priorEntities[0];
      const priorCategory = candidatePriorEntity.category || 'academic_program';
      const allowedAspects = CATEGORY_ASPECT_COMPATIBILITY[priorCategory] || CATEGORY_ASPECT_COMPATIBILITY.unknown;

      // Condition C: Check requested aspects compatibility with prior entity category
      const requestedAspects = interpretation.requestedAspects.filter(a => a !== 'general');
      const incompatibleAspects = requestedAspects.filter(a => !allowedAspects.includes(a));

      if (incompatibleAspects.length > 0) {
        domainIncompatible = true;
        domainIncompatibleReason = `Aspects [${incompatibleAspects.join(', ')}] are incompatible with prior entity category "${priorCategory}"`;
        inheritanceReason = 'aspect_incompatible_with_prior_category';
      } else {
        // ALL 5 CONDITIONS MET -> Deterministic Inheritance Permitted
        isEligibleForInheritance = true;
        inheritanceReason = 'unambiguous_compatible_follow_up';
        inheritedEntities.push({
          rawMention: candidatePriorEntity.mention,
          canonical: candidatePriorEntity.canonical,
          inferredCategory: priorCategory,
          academicLevel: candidatePriorEntity.academicLevel || priorLevel || null,
          inherited: true,
          provenance: 'PRIOR_CONTEXT_INHERITED'
        });
      }
    }
  }

  // 5. Final Entity Assembly & Domain Resolution
  const finalEntities = isEligibleForInheritance
    ? [...inheritedEntities]
    : [...explicitCandidates];

  // Resolve primary domain
  let resolvedDomain = 'GENERAL';
  if (interpretation.speechAct === 'SEEK_ADVICE' || interpretation.executionRoute === 'ACADEMIC_RECOMMENDATION' || interpretation.primaryIntent === 'PROGRAM_RECOMMENDATION') {
    resolvedDomain = 'ACADEMIC_RECOMMENDATION';
  } else if (interpretation.semanticConcepts.length > 0) {
    resolvedDomain = CONCEPT_TO_DOMAIN_MAP[interpretation.semanticConcepts[0]] || 'GENERAL';
  } else if (normPrior.priorDomain && isEligibleForInheritance) {
    resolvedDomain = normPrior.priorDomain;
  }

  // Determine Entity Resolution Status
  let entityResolutionStatus = 'UNRESOLVED';
  if (finalAmbiguityLevel === 'HIGH' || requiresClarification) {
    entityResolutionStatus = 'AMBIGUOUS';
  } else if (finalEntities.length > 0) {
    entityResolutionStatus = 'RESOLVED';
  }

  // Determine overall validation status
  let validationStatus = 'VALID';
  if (levelContradiction) {
    validationStatus = 'CONTRADICTION';
  } else if (priorEntityAmbiguity || finalAmbiguityLevel === 'HIGH') {
    validationStatus = 'AMBIGUOUS';
  } else if (domainIncompatible) {
    validationStatus = 'INCOMPATIBLE_CONTEXT';
  }

  // Assemble Verified Semantic Frame (Downstream Source of Truth)
  const validatedFrame = {
    speechAct: interpretation.speechAct,
    primaryIntent: interpretation.primaryIntent || null,
    userInterest: interpretation.userInterest ?? null,
    executionRoute: interpretation.executionRoute || null,
    semanticConcepts: [...interpretation.semanticConcepts],
    candidateEntities: finalEntities,
    inheritedEntities,
    requestedAspects: [...interpretation.requestedAspects],
    scopeConstraints: {
      academicLevel: effectiveCurrentLevel || (isEligibleForInheritance ? (normPrior.priorAcademicLevel || null) : null),
      studyMode: interpretation.scopeConstraints?.studyMode || null,
      locationConstraint: interpretation.scopeConstraints?.locationConstraint || null,
      locationScope: interpretation.scopeConstraints?.locationScope || 'GENERAL'
    },
    contextDependency: {
      isFollowUp: interpretation.contextDependency?.isFollowUp || false,
      referenceType: interpretation.contextDependency?.referenceType || 'none',
      topicContinuity: interpretation.contextDependency?.topicContinuity || (interpretation.contextDependency?.isFollowUp ? 'CONTINUATION' : 'NEW_TOPIC'),
      relevantPriorContext: interpretation.contextDependency?.relevantPriorContext ?? null,
      contextInherited: isEligibleForInheritance,
      inheritanceReason
    },
    confidence: interpretation.confidence,
    ambiguityLevel: finalAmbiguityLevel,
    domain: resolvedDomain,
    requiresClarification,
    clarificationReason,
    entityResolutionStatus,
    provenance: {
      entitySource: isEligibleForInheritance ? 'INHERITED' : (explicitCandidates.length > 0 ? 'EXPLICIT' : 'NONE'),
      levelSource: effectiveCurrentLevel ? 'EXPLICIT' : (isEligibleForInheritance && priorLevel ? 'INHERITED' : 'UNCONSTRAINED'),
      inheritedFrom: isEligibleForInheritance ? (normPrior.priorEntities[0]?.canonical || null) : null
    },
    metadata: {
      validatedAt: new Date().toISOString(),
      validationErrors: [],
      ...(interpretation.metadata || {})
    }
  };

  return {
    isValid: !levelContradiction && !schemaCheck.valid === false,
    validationStatus,
    validatedFrame,
    compatibilityResult: {
      isEligibleForInheritance,
      inheritedEntities,
      reason: inheritanceReason,
      isCompatible: !domainIncompatible && !levelContradiction,
      levelContradiction,
      levelContradictionReason,
      domainIncompatible,
      domainIncompatibleReason,
      priorEntityAmbiguity
    },
    ambiguityResult: {
      level: finalAmbiguityLevel,
      isAmbiguous: finalAmbiguityLevel === 'HIGH',
      reason: clarificationReason || 'NONE',
      competingCandidates: finalAmbiguityLevel === 'HIGH' ? (normPrior.priorEntities.length > 1 ? normPrior.priorEntities : explicitCandidates) : []
    },
    errors: []
  };
}

/**
 * Compares legacy semantic resolver output (oldFrame) with validated new interpretation.
 * Generates the first difference and failure classification.
 */
function compareFrames(rawQuery, oldFrame, newInterpretation, validationResult) {
  const validated = validationResult?.validatedFrame;
  const compat = validationResult?.compatibilityResult;
  const amb = validationResult?.ambiguityResult;

  const differences = [];

  // Check 1: Provider failure / Timeout
  if (newInterpretation?.metadata?.fallbackInvoked && newInterpretation?.speechAct === 'UNKNOWN') {
    return {
      rawQuery,
      oldFrame,
      newInterpretation,
      validatedFrame: validated,
      compatibilityResult: compat,
      ambiguityResult: amb,
      firstDifference: `Parser failed closed: ${newInterpretation.metadata.reason}`,
      failureClassification: FAILURE_TYPES.MODEL_SEMANTIC_FAILURE,
      differences: ['PARSER_FALLBACK_INVOKED']
    };
  }

  // Check 2: Schema Failure
  if (validationResult?.validationStatus === 'REJECTED_SCHEMA') {
    return {
      rawQuery,
      oldFrame,
      newInterpretation,
      validatedFrame: validated,
      compatibilityResult: compat,
      ambiguityResult: amb,
      firstDifference: `Schema validation rejected: ${validationResult.errors?.join('; ')}`,
      failureClassification: FAILURE_TYPES.SCHEMA_FAILURE,
      differences: validationResult.errors
    };
  }

  // Check 3: Academic Level Contradiction
  if (compat?.levelContradiction) {
    return {
      rawQuery,
      oldFrame,
      newInterpretation,
      validatedFrame: validated,
      compatibilityResult: compat,
      ambiguityResult: amb,
      firstDifference: compat.levelContradictionReason,
      failureClassification: FAILURE_TYPES.LEVEL_CONTRADICTION,
      differences: ['ACADEMIC_LEVEL_CONTRADICTION']
    };
  }

  // Check 4: Domain Incompatibility
  if (compat?.domainIncompatible) {
    return {
      rawQuery,
      oldFrame,
      newInterpretation,
      validatedFrame: validated,
      compatibilityResult: compat,
      ambiguityResult: amb,
      firstDifference: compat.domainIncompatibleReason,
      failureClassification: FAILURE_TYPES.CONTEXT_COMPATIBILITY_FAILURE,
      differences: ['DOMAIN_INCOMPATIBLE_CONTEXT']
    };
  }

  // Check 5: Prior Entity Ambiguity / Multi-Entity Safety
  if (compat?.priorEntityAmbiguity || amb?.isAmbiguous) {
    differences.push(`Ambiguity preserved: ${amb.reason}`);
  }

  // Check entity differences between legacy and validated
  const oldEntities = (oldFrame?.entities || []).map(e => e.canonical || e.rawMention || '').filter(Boolean);
  const newEntities = (validated?.candidateEntities || []).map(e => e.rawMention || e.canonical || '').filter(Boolean);

  if (oldEntities.length !== newEntities.length || !oldEntities.every(e => newEntities.some(ne => ne.toLowerCase().includes(e.toLowerCase()) || e.toLowerCase().includes(ne.toLowerCase())))) {
    differences.push(`Entities differ: old=[${oldEntities.join(', ')}], new=[${newEntities.join(', ')}]`);
  }

  // Check aspects differences
  const oldAspects = (oldFrame?.aspects || []).map(a => String(a).toLowerCase());
  const newAspects = (validated?.requestedAspects || []).map(a => String(a).toLowerCase());
  const aspectDiff = oldAspects.filter(a => !newAspects.includes(a) && a !== 'general');
  if (aspectDiff.length > 0) {
    differences.push(`Aspects differ: old=[${oldAspects.join(', ')}], new=[${newAspects.join(', ')}]`);
  }

  let failureClassification = FAILURE_TYPES.NO_DIFFERENCE;
  let firstDifference = 'Identical semantic resolution';

  if (compat?.priorEntityAmbiguity || amb?.isAmbiguous) {
    failureClassification = FAILURE_TYPES.ENTITY_AMBIGUITY_FAILURE;
    firstDifference = amb.reason;
  } else if (differences.length > 0) {
    failureClassification = FAILURE_TYPES.LEGACY_RESOLVER_DIFFERENCE;
    firstDifference = differences[0];
  }

  return {
    rawQuery,
    oldFrame,
    newInterpretation,
    validatedFrame: validated,
    compatibilityResult: compat,
    ambiguityResult: amb,
    firstDifference,
    failureClassification,
    differences
  };
}

module.exports = {
  FAILURE_TYPES,
  CATEGORY_ASPECT_COMPATIBILITY,
  areAcademicLevelsCompatible,
  hasMultipleCompetingEntities,
  resolveInternationalParentProgram,
  extractNormalizedPriorContext,
  validateSchemaAndEnums,
  validateSemanticInterpretation,
  compareFrames
};
