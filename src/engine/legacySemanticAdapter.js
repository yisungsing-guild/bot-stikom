'use strict';

/**
 * legacySemanticAdapter.js
 *
 * Narrow legacy compatibility adapter for the Controlled Semantic Core.
 *
 * Projects an authoritative, immutable EffectiveSemanticFrame into the structures
 * expected by legacy pipeline modules (e.g. canonicalUnderstanding, semanticContract)
 * without permitting downstream code to mutate or diverge from the frozen frame.
 */

const { deepFreeze } = require('./semanticFrame');

/**
 * Converts a SemanticFrame into a legacy canonicalUnderstanding representation.
 *
 * @param {object} frame Authoritative SemanticFrame
 * @returns {object} Deeply frozen legacy understanding projection
 */
function toLegacyUnderstanding(frame) {
  if (!frame || typeof frame !== 'object') return null;

  // Map entities back into legacy entity grouping while preserving family annotations
  const entities = {
    programs: [],
    campuses: [],
    facilities: [],
    organizations: [],
    people: [],
    documents: [],
    internationalPrograms: [],
    services: [],
    scholarships: [],
    admissionTracks: [],
    participantScopes: [],
    academicScopes: [],
    interestProfiles: [],
    unsupported: [],
    unknown: []
  };

  for (const ent of (frame.entities || [])) {
    const fam = ent.family;
    let group = ent.group;
    if (!group || !entities[group]) {
      if (fam === 'organization') group = 'organizations';
      else if (fam === 'program') group = 'programs';
      else if (fam === 'campus') group = 'campuses';
      else if (fam === 'facility') group = 'facilities';
      else if (fam === 'scholarship') group = 'scholarships';
      else if (fam === 'admission_track') group = 'admissionTracks';
      else if (fam === 'international_program') group = 'internationalPrograms';
      else if (fam === 'campus_service') group = 'services';
      else if (fam === 'participant_scope') group = 'participantScopes';
      else if (fam === 'academic_scope') group = 'academicScopes';
      else group = 'unknown';
    }
    if (entities[group]) {
      entities[group].push({
        canonical: ent.canonical,
        type: ent.type,
        family: ent.family,
        role: ent.role,
        source: ent.source || 'effective-semantic-frame',
        confidence: ent.confidence,
        provenance: ent.provenance,
        group
      });
    }
  }

  const legacyUnderstanding = {
    rawQuery: frame.rawQuery,
    normalizedQuery: frame.normalizedQuery,
    intent: { ...frame.intent },
    domain: { ...frame.domain },
    entities,
    requestedFields: [...(frame.requestedFields || [])],
    primaryField: frame.primaryField,
    fieldFamily: frame.fieldFamily,
    temporal: { currentDate: new Date().toISOString().slice(0, 10), explicitDate: null },
    constraints: { ...(frame.constraints || {}) },
    questionType: frame.questionType,
    answerExpectation: frame.answerExpectation,
    ambiguity: { ...(frame.ambiguity || {}) },
    routingQuery: frame.routingQuery || frame.normalizedQuery,
    confidence: frame.confidence,
    provenance: { ...(frame.provenance || {}) },
    __semanticFrameRef: frame
  };

  // Attach legacy contract projection
  legacyUnderstanding.contract = toLegacyContract(frame);

  return deepFreeze(legacyUnderstanding);
}

/**
 * Converts a SemanticFrame into a legacy semanticContract representation.
 *
 * @param {object} frame Authoritative SemanticFrame
 * @returns {object} Deeply frozen legacy contract projection
 */
function toLegacyContract(frame) {
  if (!frame || typeof frame !== 'object') return null;

  const entities = (frame.entities || []).map(ent => ({
    canonical: ent.canonical,
    type: ent.type,
    family: ent.family,
    role: ent.role || '',
    source: ent.source || 'effective-semantic-frame',
    group: ent.group || ent.family
  }));

  const requestType = frame.primaryField === 'duration' ? 'schedule'
    : (frame.primaryField === 'fee' || frame.primaryField === 'tuitionFee' ? 'fee'
      : (frame.primaryField === 'certification' ? 'policy'
        : (frame.questionType || 'direct_answer')));

  const answerShapeMap = {
    topic_opening: 'acknowledge_topic_only',
    definition: 'definition_first',
    registration_channel: 'channel_or_link',
    procedure: 'steps',
    fee: 'amount_or_no_data',
    schedule: 'date_or_period',
    requirements: 'requirements',
    list: 'bounded_list',
    count: 'count',
    comparison: 'contrast',
    recommendation: 'recommendation',
    availability: 'yes_no_or_no_data',
    contact: 'contact_or_no_data',
    policy: 'policy_or_safe_no_data'
  };

  const legacyContract = {
    version: 1,
    raw: frame.rawQuery,
    normalized: frame.normalizedQuery,
    domain: frame.domain?.primary || 'general',
    intent: frame.intent?.primary || 'ask_general',
    requestType,
    requestedFields: [...(frame.requestedFields || [])],
    primaryField: frame.primaryField,
    fieldFamily: frame.fieldFamily,
    entities,
    entityType: Array.from(new Set(entities.map(e => e.type))),
    academicLevel: frame.constraints?.academicLevel || null,
    relations: Array.isArray(frame.relations) ? [...frame.relations] : [],
    constraints: { ...(frame.constraints || {}) },
    contextReference: {
      mode: frame.provenance?.entities === 'PRIOR_CONTEXT_INHERITED' ? 'inherited_context' : 'current_turn',
      resolvedFrom: frame.inheritedSemantics?.entities?.[0]?.canonical || null
    },
    answerShape: answerShapeMap[requestType] || 'direct_answer',
    routingQuery: frame.routingQuery || frame.normalizedQuery,
    confidence: frame.confidence,
    __semanticFrameRef: frame
  };

  return deepFreeze(legacyContract);
}

module.exports = {
  toLegacyUnderstanding,
  toLegacyContract
};
