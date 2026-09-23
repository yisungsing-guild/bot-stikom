'use strict';

/**
 * semanticFrame.js
 *
 * Authoritative, immutable SemanticFrame definition for the Controlled Semantic Core.
 *
 * Invariants:
 * 1. TRUE IMMUTABILITY: Every frame is deeply frozen recursively.
 * 2. PROVENANCE INTEGRITY: Every slot tracks its resolution source.
 * 3. NORMALIZED ENTITY FAMILY: Normalizes compatibility without collapsing entity identities.
 * 4. REQUESTED FIELD SPECIFICITY: Specific fields outrank generic parent families (SPECIFIC_FIELD > FIELD_FAMILY).
 */

const PROVENANCE = Object.freeze({
  EXPLICIT_CURRENT: 'EXPLICIT_CURRENT',
  MESSAGE_LOCAL_INHERITED: 'MESSAGE_LOCAL_INHERITED',
  PRIOR_CONTEXT_INHERITED: 'PRIOR_CONTEXT_INHERITED',
  DERIVED: 'DERIVED',
  UNKNOWN: 'UNKNOWN'
});

/**
 * Deeply and recursively freezes an object, array, Set, or Map.
 * Prevents any downstream mutation of nested properties.
 *
 * @param {*} obj
 * @param {WeakSet} [seen]
 * @returns {*} Deeply frozen object
 */
function deepFreeze(obj, seen = new WeakSet()) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (seen.has(obj)) {
    return obj;
  }
  seen.add(obj);

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      deepFreeze(obj[i], seen);
    }
    return Object.freeze(obj);
  }

  if (obj instanceof Set) {
    // Convert entries to frozen array representation or freeze members
    for (const val of obj) {
      deepFreeze(val, seen);
    }
    return Object.freeze(obj);
  }

  if (obj instanceof Map) {
    for (const [k, v] of obj.entries()) {
      deepFreeze(k, seen);
      deepFreeze(v, seen);
    }
    return Object.freeze(obj);
  }

  const propNames = Object.getOwnPropertyNames(obj);
  for (const name of propNames) {
    const value = obj[name];
    if (value && typeof value === 'object') {
      deepFreeze(value, seen);
    }
  }

  return Object.freeze(obj);
}

/**
 * Normalizes entity type into canonical entity family.
 *
 * Invariant: ENTITY FAMILY NORMALIZATION != ENTITY IDENTITY COLLAPSE.
 * Distinct entities (e.g. Mapala, BEM, HIMA) remain distinct while sharing the 'organization' family.
 *
 * @param {string} typeOrFamily
 * @returns {string} Normalized entity family
 */
function normalizeEntityFamily(typeOrFamily) {
  const raw = String(typeOrFamily || '').trim().toLowerCase();
  if (!raw) return 'unknown';

  // Organization family
  if (/^(?:ukm|organization|student_organization|hima|himaprodi|ormawa|bem|dpm|student_association|ukm_category|community)$/.test(raw)
      || raw.includes('organization') || raw.includes('association')) {
    return 'organization';
  }

  // Academic program family
  if (/^(?:program|academic_program|prodi|jurusan|s1|s2|d3|diploma|magister|sarjana|postgraduate|undergraduate)$/.test(raw)) {
    return 'program';
  }

  // Campus location family
  if (/^(?:campus|campus_location|location|cabang)$/.test(raw)) {
    return 'campus';
  }

  // Campus facility family
  if (/^(?:facility|campus_facility|facility_program|lab|laboratorium|library|perpustakaan)$/.test(raw)) {
    return 'facility';
  }

  // Scholarship family
  if (/^(?:scholarship|beasiswa|kip|1k1s|skss)$/.test(raw)) {
    return 'scholarship';
  }

  // Admission track family
  if (/^(?:admission_track|track|jalur|jalur_pendaftaran|wave|gelombang)$/.test(raw)) {
    return 'admission_track';
  }

  // International & partner programs
  if (/^(?:international_program|special_program|double_degree|dual_degree|partner|exchange|student_exchange)$/.test(raw)) {
    return 'international_program';
  }

  // Campus service family
  if (/^(?:service|campus_service|layanan|cdc|inbis|career_center|language_center)$/.test(raw)) {
    return 'campus_service';
  }

  // Scope entities
  if (/^(?:participant_scope|audience_scope)$/.test(raw)) {
    return 'participant_scope';
  }
  if (/^(?:academic_scope|academic_policy)$/.test(raw)) {
    return 'academic_scope';
  }

  // Document family
  if (/^(?:document|documents|academic_document|institution_document|official_document)$/.test(raw)) {
    return 'document';
  }

  return raw;
}

/**
 * Taxonomy of requested fields mapping specific fields to parent family and root category.
 * Higher priority means higher specificity: SPECIFIC_FIELD > FIELD_FAMILY.
 */
const FIELD_TAXONOMY = Object.freeze({
  // Contact & Social Media
  instagram: { field: 'instagram', family: 'social_media', root: 'contact', priority: 10 },
  tiktok: { field: 'tiktok', family: 'social_media', root: 'contact', priority: 10 },
  facebook: { field: 'facebook', family: 'social_media', root: 'contact', priority: 10 },
  youtube: { field: 'youtube', family: 'social_media', root: 'contact', priority: 10 },
  twitter: { field: 'twitter', family: 'social_media', root: 'contact', priority: 10 },
  socialMedia: { field: 'socialMedia', family: 'social_media', root: 'contact', priority: 5 },
  phone: { field: 'phone', family: 'contact_telephony', root: 'contact', priority: 10 },
  whatsapp: { field: 'whatsapp', family: 'contact_telephony', root: 'contact', priority: 10 },
  contactNumber: { field: 'contactNumber', family: 'contact_telephony', root: 'contact', priority: 8 },
  email: { field: 'email', family: 'contact_electronic', root: 'contact', priority: 10 },
  contact: { field: 'contact', family: 'contact', root: 'contact', priority: 1 },

  // Temporal & Duration
  duration: { field: 'duration', family: 'temporal_duration', root: 'temporal', priority: 10 },
  studyTimeline: { field: 'studyTimeline', family: 'temporal_duration', root: 'temporal', priority: 8 },
  semesterCount: { field: 'semesterCount', family: 'temporal_duration', root: 'temporal', priority: 8 },
  schedule: { field: 'schedule', family: 'temporal_schedule', root: 'temporal', priority: 6 },
  deadline: { field: 'deadline', family: 'temporal_schedule', root: 'temporal', priority: 8 },
  registrationWave: { field: 'registrationWave', family: 'temporal_schedule', root: 'temporal', priority: 8 },
  date: { field: 'date', family: 'temporal_schedule', root: 'temporal', priority: 2 },

  // Institutional History & Founding
  foundingDate: { field: 'foundingDate', family: 'history', root: 'institution', priority: 10 },
  legalDecreeDate: { field: 'legalDecreeDate', family: 'history', root: 'institution', priority: 10 },
  founderNames: { field: 'founderNames', family: 'history', root: 'institution', priority: 10 },
  institutionHistory: { field: 'institutionHistory', family: 'history', root: 'institution', priority: 8 },
  history: { field: 'history', family: 'history', root: 'institution', priority: 5 },

  // Financial & Fees
  tuitionFee: { field: 'tuitionFee', family: 'fee', root: 'financial', priority: 10 },
  registrationFee: { field: 'registrationFee', family: 'fee', root: 'financial', priority: 10 },
  dpp: { field: 'dpp', family: 'fee', root: 'financial', priority: 10 },
  spp: { field: 'spp', family: 'fee', root: 'financial', priority: 10 },
  installment: { field: 'installment', family: 'fee', root: 'financial', priority: 9 },
  fee: { field: 'fee', family: 'financial', root: 'financial', priority: 5 },
  amount: { field: 'amount', family: 'financial', root: 'financial', priority: 5 },
  scholarship: { field: 'scholarship', family: 'financial_aid', root: 'financial', priority: 8 },

  // Academic, Policy & Qualifications
  competencyCertification: { field: 'competencyCertification', family: 'certification', root: 'academic', priority: 9 },
  certification: { field: 'certification', family: 'academic_qualification', root: 'academic', priority: 10 },
  vendorCertifications: { field: 'vendorCertifications', family: 'academic_qualification', root: 'academic', priority: 12 },
  internationalCertification: { field: 'internationalCertification', family: 'academic_qualification', root: 'academic', priority: 12 },
  degree: { field: 'degree', family: 'academic_qualification', root: 'academic', priority: 10 },
  accreditation: { field: 'accreditation', family: 'academic_quality', root: 'academic', priority: 10 },
  grade: { field: 'grade', family: 'academic_quality', root: 'academic', priority: 6 },
  curriculum: { field: 'curriculum', family: 'academic_curriculum', root: 'academic', priority: 8 },
  courseList: { field: 'courseList', family: 'academic_curriculum', root: 'academic', priority: 10 },
  creditConversion: { field: 'creditConversion', family: 'academic_policy', root: 'academic', priority: 10 },
  academicPolicy: { field: 'academicPolicy', family: 'academic_policy', root: 'academic', priority: 5 },

  // Organization & Profile
  organization_name: { field: 'organization_name', family: 'organization_identity', root: 'organization', priority: 10 },
  organizationProfile: { field: 'organizationProfile', family: 'organization_identity', root: 'organization', priority: 8 },
  organizationCategory: { field: 'organizationCategory', family: 'organization_classification', root: 'organization', priority: 8 },
  organizationList: { field: 'organizationList', family: 'organization_inventory', root: 'organization', priority: 7 },

  // Career
  careerProspect: { field: 'careerProspect', family: 'career', root: 'career', priority: 8 },
  jobRoles: { field: 'jobRoles', family: 'career', root: 'career', priority: 10 },

  // Procedural & Registration
  requirements: { field: 'requirements', family: 'procedure', root: 'procedure', priority: 8 },
  procedureSteps: { field: 'procedureSteps', family: 'procedure', root: 'procedure', priority: 8 },
  channelUrl: { field: 'channelUrl', family: 'procedure', root: 'procedure', priority: 8 },

  // Document Purpose & Governance
  documentPurpose: { field: 'documentPurpose', family: 'governance', root: 'document', priority: 9 },
  purpose: { field: 'purpose', family: 'governance', root: 'document', priority: 8 },

  // Comparison & Contrast
  contrast: { field: 'contrast', family: 'comparison', root: 'comparison', priority: 8 },

  // Administrative / SKTT
  sktt: { field: 'sktt', family: 'procedure', root: 'procedure', priority: 8 },

  // Geographic & Program Destination (GEOGRAPHIC_DESTINATION != DOCUMENT_PURPOSE)
  studyLocation: { field: 'studyLocation', family: 'geographic_destination', root: 'geographic', priority: 10 },
  destinationCountry: { field: 'destinationCountry', family: 'geographic_destination', root: 'geographic', priority: 10 },
  country: { field: 'country', family: 'geographic_destination', root: 'geographic', priority: 10 },
  location: { field: 'location', family: 'location', root: 'geographic', priority: 5 }
});

/**
 * Returns field descriptor with specificity details.
 *
 * @param {string} fieldName
 * @returns {object}
 */
function getFieldDescriptor(fieldName) {
  const norm = String(fieldName || '').trim();
  if (FIELD_TAXONOMY[norm]) {
    return FIELD_TAXONOMY[norm];
  }
  return { field: norm, family: norm, root: norm, priority: 1 };
}

/**
 * Checks if a specific requested field outranks a broader field family.
 *
 * Invariant: SPECIFIC_FIELD > FIELD_FAMILY
 * Example: isSpecificFieldAuthoritative('instagram', 'contact') === true
 *
 * @param {string} specificField
 * @param {string} candidateFieldOrFamily
 * @returns {boolean}
 */
function isSpecificFieldAuthoritative(specificField, candidateFieldOrFamily) {
  const specDesc = getFieldDescriptor(specificField);
  const candDesc = getFieldDescriptor(candidateFieldOrFamily);
  if (specDesc.field === candDesc.field) return true;
  if (specDesc.family === candDesc.field || specDesc.root === candDesc.field) {
    return true;
  }
  return specDesc.priority > candDesc.priority;
}

/**
 * Filters requested fields to retain the most authoritative specific fields,
 * preventing broad categories (e.g. 'contact') from obliterating specific targets (e.g. 'instagram').
 *
 * @param {string[]} requestedFields
 * @returns {string[]}
 */
function rankRequestedFields(requestedFields) {
  const fields = Array.isArray(requestedFields)
    ? Array.from(new Set(requestedFields.map(f => String(f || '').trim()).filter(Boolean)))
    : [];
  if (fields.length <= 1) return fields;

  const descriptors = fields.map(getFieldDescriptor);
  // Sort descending by priority (highest specificity first)
  descriptors.sort((a, b) => b.priority - a.priority);

  return descriptors.map(d => d.field);
}

/**
 * Constructs an immutable SemanticFrame object.
 *
 * @param {object} props
 * @returns {object} Deeply frozen SemanticFrame
 */
function createSemanticFrame(props = {}) {
  const rawQuery = String(props.rawQuery || '').trim();
  const normalizedQuery = String(props.normalizedQuery || rawQuery.toLowerCase()).trim();

  const intent = props.intent && typeof props.intent === 'object'
    ? {
        primary: String(props.intent.primary || 'ask_general'),
        secondary: Array.isArray(props.intent.secondary) ? [...props.intent.secondary] : [],
        confidence: Number.isFinite(props.intent.confidence) ? props.intent.confidence : 0.5
      }
    : { primary: 'ask_general', secondary: [], confidence: 0.5 };

  const domain = props.domain && typeof props.domain === 'object'
    ? {
        primary: String(props.domain.primary || 'general'),
        confidence: Number.isFinite(props.domain.confidence) ? props.domain.confidence : 0.5
      }
    : { primary: 'general', confidence: 0.5 };

  // Normalize entities preserving canonical identities while tagging normalized families
  const normalizedEntities = [];
  const rawEntities = Array.isArray(props.entities) ? props.entities : [];
  for (const ent of rawEntities) {
    if (!ent || typeof ent !== 'object') continue;
    const canonical = String(ent.canonical || ent.name || '').trim();
    if (!canonical) continue;
    const type = String(ent.type || 'unknown').trim();
    const family = normalizeEntityFamily(ent.family || type);
    normalizedEntities.push({
      canonical,
      type,
      family,
      role: ent.role ? String(ent.role) : undefined,
      source: ent.source ? String(ent.source) : undefined,
      confidence: Number.isFinite(ent.confidence) ? ent.confidence : 0.8,
      provenance: ent.provenance || PROVENANCE.EXPLICIT_CURRENT,
      group: ent.group || undefined
    });
  }

  const requestedFields = rankRequestedFields(props.requestedFields || []);
  const primaryField = requestedFields[0] || null;
  const primaryFieldDescriptor = primaryField ? getFieldDescriptor(primaryField) : null;

  const relations = Array.isArray(props.relations) ? [...props.relations] : [];
  const constraints = props.constraints && typeof props.constraints === 'object' ? { ...props.constraints } : {};
  const numericSemantics = props.numericSemantics && typeof props.numericSemantics === 'object' ? { ...props.numericSemantics } : {};

  const explicitSemantics = props.explicitSemantics && typeof props.explicitSemantics === 'object' ? { ...props.explicitSemantics } : {};
  const inheritedSemantics = props.inheritedSemantics && typeof props.inheritedSemantics === 'object' ? { ...props.inheritedSemantics } : {};

  const ambiguity = props.ambiguity && typeof props.ambiguity === 'object' ? { ...props.ambiguity } : {};
  const confidence = Number.isFinite(props.confidence) ? props.confidence : Math.min(intent.confidence, domain.confidence);

  const provenance = {
    intent: props.provenance?.intent || PROVENANCE.EXPLICIT_CURRENT,
    domain: props.provenance?.domain || PROVENANCE.EXPLICIT_CURRENT,
    entities: props.provenance?.entities || PROVENANCE.EXPLICIT_CURRENT,
    requestedFields: props.provenance?.requestedFields || PROVENANCE.EXPLICIT_CURRENT,
    relations: props.provenance?.relations || PROVENANCE.EXPLICIT_CURRENT,
    constraints: props.provenance?.constraints || PROVENANCE.EXPLICIT_CURRENT
  };

  const frame = {
    version: 1,
    rawQuery,
    normalizedQuery,
    intent,
    domain,
    entities: normalizedEntities,
    requestedFields,
    primaryField,
    fieldFamily: primaryFieldDescriptor ? primaryFieldDescriptor.family : null,
    fieldRoot: primaryFieldDescriptor ? primaryFieldDescriptor.root : null,
    relations,
    constraints,
    numericSemantics,
    explicitSemantics,
    inheritedSemantics,
    ambiguity,
    confidence,
    provenance,
    questionType: props.questionType ? String(props.questionType) : 'direct_question',
    answerExpectation: props.answerExpectation ? String(props.answerExpectation) : 'direct_answer',
    routingQuery: props.routingQuery ? String(props.routingQuery) : normalizedQuery,
    isFrozen: true
  };

  return deepFreeze(frame);
}

module.exports = {
  PROVENANCE,
  deepFreeze,
  normalizeEntityFamily,
  FIELD_TAXONOMY,
  getFieldDescriptor,
  isSpecificFieldAuthoritative,
  rankRequestedFields,
  createSemanticFrame
};
