'use strict';

/**
 * Conversation State Engine (Phase 1)
 *
 * Centralized, structured conversation state management for multi-turn dialogue.
 * Adheres strictly to:
 * - ENTITY != INTENT AUTHORITY (Entity substitution does not assert standalone intent)
 * - CANONICAL AUTHORITY (Consumes canonical queryUnderstanding, does not duplicate parser)
 * - STRUCTURED MEMORY (Stores semantic propositions/relations, never unbounded raw text)
 * - FAIL-SAFE BACKWARD COMPATIBILITY (Old/malformed sessions fail-safe to empty state)
 * - CONFIGURABLE DECAY (Respects process.env.CONTEXT_DECAY_MS)
 */

const DEFAULT_CONTEXT_DECAY_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Returns configurable TTL in milliseconds.
 * @param {number|null} customTtlMs 
 * @returns {number}
 */
function getContextDecayMs(customTtlMs = null) {
  if (Number.isFinite(Number(customTtlMs)) && Number(customTtlMs) > 0) {
    return Number(customTtlMs);
  }
  const envVal = Number(process.env.CONTEXT_DECAY_MS);
  if (Number.isFinite(envVal) && envVal > 0) {
    return envVal;
  }
  return DEFAULT_CONTEXT_DECAY_MS;
}

/**
 * Creates a clean, empty conversation state adhering to the canonical schema.
 * @param {string} [timestamp] ISO-8601 string
 * @returns {object}
 */
function createEmptyConversationState(timestamp = new Date().toISOString()) {
  return {
    activeDomain: null,
    activeIntent: null,
    activeEntity: null,
    activeRelation: null,
    requestedFields: [],
    rawSourceQuery: null,
    previousAnswerSemantics: {
      domain: null,
      intent: null,
      entities: [],
      relations: [],
      propositions: []
    },
    recommendationRelations: [],
    correctionTarget: null,
    pendingSelection: null,
    groundedEntityCandidates: [],
    isVerified: false,
    promotable: false,
    legacyUnverified: true,
    updatedAt: timestamp ? String(timestamp) : null
  };
}

/**
 * Safely normalizes any incoming state object.
 * Handles undefined, null, legacy objects, and corrupt formats gracefully.
 * @param {*} rawState 
 * @param {number} [now] Epoch ms
 * @returns {object} Normalized ConversationTurnState
 */
function normalizeConversationState(rawState, now = Date.now()) {
  if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) {
    return createEmptyConversationState(null);
  }

  // Handle wrapped sessionData with conversationState property
  const unwrappedState = (rawState.conversationState && typeof rawState.conversationState === 'object' && !Array.isArray(rawState.conversationState))
    ? {
        ...rawState.conversationState,
        rawSourceQuery: rawState.conversationState.rawSourceQuery || rawState.lastQuery || rawState.sourceTurn || rawState.lastQuestion || rawState.text,
        updatedAt: rawState.conversationState.updatedAt || rawState.updatedAt
      }
    : rawState;

  // Extract or validate updatedAt
  let updatedAt = null;
  if (unwrappedState.updatedAt) {
    const d = new Date(unwrappedState.updatedAt);
    if (!Number.isNaN(d.getTime())) {
      updatedAt = d.toISOString();
    }
  } else if (unwrappedState.lastSemanticContractUpdatedAt || unwrappedState.establishedAt || unwrappedState.ts || unwrappedState.at) {
    const d = new Date(unwrappedState.lastSemanticContractUpdatedAt || unwrappedState.establishedAt || unwrappedState.ts || unwrappedState.at);
    if (!Number.isNaN(d.getTime())) {
      updatedAt = d.toISOString();
    }
  }
  // Risk 1 hardening: missing updatedAt must NOT be treated as fresh.
  // Leave updatedAt as null so isConversationStateFresh returns false.

  // Normalize activeEntity
  let activeEntity = null;
  if (unwrappedState.activeEntity && typeof unwrappedState.activeEntity === 'object' && !Array.isArray(unwrappedState.activeEntity)) {
    activeEntity = {
      type: unwrappedState.activeEntity.type ? String(unwrappedState.activeEntity.type).trim() : 'unknown',
      canonical: unwrappedState.activeEntity.canonical ? String(unwrappedState.activeEntity.canonical).trim() : '',
      code: unwrappedState.activeEntity.code ? String(unwrappedState.activeEntity.code).trim() : undefined,
      group: unwrappedState.activeEntity.group ? String(unwrappedState.activeEntity.group).trim() : undefined,
      surface: unwrappedState.activeEntity.surface ? String(unwrappedState.activeEntity.surface).trim() : undefined
    };
    if (!activeEntity.canonical) activeEntity = null;
  } else if (updatedAt && unwrappedState.lastSemanticContract && Array.isArray(unwrappedState.lastSemanticContract.entities) && unwrappedState.lastSemanticContract.entities.length > 0) {
    const e0 = unwrappedState.lastSemanticContract.entities[0];
    if (e0 && (e0.canonical || e0.name)) {
      activeEntity = {
        type: e0.type ? String(e0.type).trim() : 'program',
        canonical: String(e0.canonical || e0.name).trim(),
        group: e0.group || 'programs'
      };
    }
  } else if (typeof unwrappedState.lastProgramHint === 'string' && unwrappedState.lastProgramHint.trim()) {
    // Backward compatibility with legacy lastProgramHint. A fresh semantic
    // contract entity wins because providers may persist the current turn's
    // program hint before context authority runs.
    activeEntity = {
      type: 'program',
      canonical: unwrappedState.lastProgramHint.trim(),
      group: 'programs'
    };
  }

  // Normalize activeRelation
  let activeRelation = null;
  if (unwrappedState.activeRelation && typeof unwrappedState.activeRelation === 'object' && !Array.isArray(unwrappedState.activeRelation)) {
    activeRelation = {
      type: unwrappedState.activeRelation.type ? String(unwrappedState.activeRelation.type).trim() : 'general',
      source: unwrappedState.activeRelation.source ? String(unwrappedState.activeRelation.source).trim() : null,
      target: unwrappedState.activeRelation.target ? String(unwrappedState.activeRelation.target).trim() : null,
      metadata: unwrappedState.activeRelation.metadata && typeof unwrappedState.activeRelation.metadata === 'object' ? unwrappedState.activeRelation.metadata : {}
    };
  }

  // Normalize requestedFields
  const requestedFields = Array.isArray(unwrappedState.requestedFields)
    ? Array.from(new Set(unwrappedState.requestedFields.map(f => String(f || '').trim()).filter(Boolean)))
    : [];

  // Extract rawSourceQuery
  const rawSourceQuery = typeof unwrappedState.rawSourceQuery === 'string' && unwrappedState.rawSourceQuery.trim()
    ? unwrappedState.rawSourceQuery.trim()
    : (typeof unwrappedState.rawQuery === 'string' && unwrappedState.rawQuery.trim()
        ? unwrappedState.rawQuery.trim()
        : (typeof unwrappedState.sourceTurn === 'string' && unwrappedState.sourceTurn.trim()
            ? unwrappedState.sourceTurn.trim()
            : null));

  // Normalize recommendationRelations
  const recommendationRelations = Array.isArray(unwrappedState.recommendationRelations)
    ? unwrappedState.recommendationRelations
        .filter(r => r && typeof r === 'object' && (r.source || r.target))
        .map(r => ({
          source: String(r.source || '').trim(),
          relation: String(r.relation || 'alternative').trim(),
          target: String(r.target || '').trim(),
          reason: r.reason ? String(r.reason).trim() : null
        }))
    : [];

  // Normalize previousAnswerSemantics
  const rawSemantics = unwrappedState.previousAnswerSemantics && typeof unwrappedState.previousAnswerSemantics === 'object'
    ? unwrappedState.previousAnswerSemantics
    : {};
  const previousAnswerSemantics = {
    domain: rawSemantics.domain ? String(rawSemantics.domain).trim() : null,
    intent: rawSemantics.intent ? String(rawSemantics.intent).trim() : null,
    entities: Array.isArray(rawSemantics.entities)
      ? rawSemantics.entities.map(e => typeof e === 'string' ? e.trim() : (e && e.canonical ? String(e.canonical).trim() : '')).filter(Boolean)
      : [],
    relations: Array.isArray(rawSemantics.relations)
      ? rawSemantics.relations.filter(r => r && typeof r === 'object')
      : [],
    propositions: Array.isArray(rawSemantics.propositions)
      ? rawSemantics.propositions.map(p => String(p || '').trim()).filter(Boolean)
      : []
  };

  let isVerified = false;
  let promotable = false;
  let legacyUnverified = false;

  const hasContractAuth = Boolean(updatedAt && unwrappedState.lastSemanticContract && (unwrappedState.lastSemanticContract.domain || unwrappedState.lastSemanticContract.intent));
  if (hasContractAuth) {
    isVerified = true;
    promotable = true;
    legacyUnverified = false;
  } else if (unwrappedState.legacyUnverified === true || (unwrappedState.isVerified === undefined && unwrappedState.promotable === undefined)) {
    legacyUnverified = true;
    isVerified = false;
    promotable = false;
  } else if (unwrappedState.isVerified === true && unwrappedState.promotable !== false) {
    isVerified = true;
    promotable = true;
    legacyUnverified = false;
  } else {
    isVerified = false;
    promotable = false;
    legacyUnverified = false;
  }

  const activeDomain = unwrappedState.activeDomain ? String(unwrappedState.activeDomain).trim()
    : (unwrappedState.domain ? String(unwrappedState.domain).trim()
      : (hasContractAuth && unwrappedState.lastSemanticContract.domain ? String(unwrappedState.lastSemanticContract.domain).trim() : null));
  const activeIntent = unwrappedState.activeIntent ? String(unwrappedState.activeIntent).trim()
    : (unwrappedState.intent ? String(unwrappedState.intent).trim()
      : (hasContractAuth && unwrappedState.lastSemanticContract.intent ? String(unwrappedState.lastSemanticContract.intent).trim() : null));

    const groundedEntityCandidates = Array.isArray(unwrappedState.groundedEntityCandidates)
    ? unwrappedState.groundedEntityCandidates
        .filter(c => c && typeof c === 'object' && (c.canonical || c.name || c.entity))
        .map(c => ({
          canonical: String(c.canonical || c.name || c.entity || '').trim(),
          family: c.family ? String(c.family).trim() : (c.entityFamily ? String(c.entityFamily).trim() : 'organization'),
          type: c.type ? String(c.type).trim() : 'ukm',
          categories: Array.isArray(c.categories) ? c.categories.map(cat => String(cat).trim()).filter(Boolean) : (c.category ? [String(c.category).trim()] : []),
          matchedTerms: Array.isArray(c.matchedTerms) ? c.matchedTerms.map(t => String(t).trim()).filter(Boolean) : (c.matchedTerm ? [String(c.matchedTerm).trim()] : []),
          confidence: Number(c.confidence || 0.85)
        }))
    : [];

  return {
    activeDomain,
    activeIntent,
    activeEntity,
    activeRelation,
    requestedFields,
    rawSourceQuery,
    previousAnswerSemantics,
    recommendationRelations,
    groundedEntityCandidates,
    correctionTarget: unwrappedState.correctionTarget ? String(unwrappedState.correctionTarget).trim() : null,
    pendingSelection: unwrappedState.pendingSelection && typeof unwrappedState.pendingSelection === 'object' ? unwrappedState.pendingSelection : null,
    isVerified,
    promotable,
    legacyUnverified,
    lastSemanticContract: unwrappedState.lastSemanticContract || null,
    updatedAt
  };
}

/**
 * Checks if a conversation state is fresh based on TTL.
 * @param {object} state 
 * @param {number} [now] Epoch ms
 * @param {number|null} [maxAgeMs]
 * @returns {boolean}
 */
function isConversationStateFresh(state, now = Date.now(), maxAgeMs = null) {
  if (!state || !state.updatedAt) return false;
  const ts = new Date(state.updatedAt).getTime();
  if (Number.isNaN(ts)) return false;
  const maxAge = getContextDecayMs(maxAgeMs);
  return now >= ts && (now - ts) <= maxAge;
}

/**
 * Domain-to-Domain compatible intent groups.
 * Dictates whether an intent from Domain A can be inherited by Domain B,
 * or whether a newly substituted entity is compatible with the active intent.
 */
const ENTITY_INTENT_COMPATIBILITY = {
  // Prospek karier prodi kompatibel dengan semua jenjang program studi (S1, D3, S2)
  ask_career_prospect: new Set(['program', 's2']),
  ask_career_service: new Set(['campus_support', 'program']),
  
  // Biaya kuliah kompatibel dengan program studi
  ask_fee: new Set(['program', 's2']),
  ask_fee_detail: new Set(['program', 's2']),
  ask_registration_fee: new Set(['program', 's2', 'registration']),
  ask_fee_discount: new Set(['program', 's2', 'scholarship']),
  ask_fee_installment: new Set(['program', 's2']),
  ask_fee_total: new Set(['program', 's2']),

  // Kurikulum & pembelajaran kompatibel dengan program studi
  ask_program_curriculum: new Set(['program', 's2']),
  ask_curriculum_topic: new Set(['program', 's2']),
  ask_program_definition: new Set(['program', 's2']),

  // Akreditasi kompatibel dengan program studi dan institusi
  ask_accreditation: new Set(['program', 's2', 'institution']),

  // Organisasi mahasiswa kompatibel dengan sesama organisasi
  ask_organization_profile: new Set(['student_organization', 'organization']),
  ask_organization_list: new Set(['student_organization', 'organization']),

  // Double degree & pertukaran internasional
  ask_double_degree: new Set(['double_degree', 'partner', 'program']),
  ask_double_degree_partner_list: new Set(['double_degree', 'partner']),
  ask_student_exchange: new Set(['student_exchange', 'partner']),

  // Fasilitas
  ask_facility_profile: new Set(['facility', 'campus_support']),

  // Jadwal PMB
  ask_schedule: new Set(['pmb_schedule', 'registration']),
  ask_registration_requirements: new Set(['registration', 'program', 's2'])
};

function isDomainActionableContextQuery(rawQ, activeDomain) {
  if (!activeDomain || !rawQ) return false;
  const q = String(rawQ).toLowerCase();
  switch (activeDomain) {
    case 'registration':
      return /\b(?:ijazah|legalisir|rapor|akta|foto|pas\s*foto|ktp|kk|berkas|dokumen|persyaratan|syarat|formulir|daftar|pendaftaran|gelombang|jalur|tahap|lembar|butuh\s+berapa)\b/i.test(q);
    case 'double_degree':
      return /\b(?:mandarin|bahasa|toefl|ielts|hsk|china|tiongkok|dalian|dnui|utb|luar\s+negeri|gpa|ipk|persyaratan|syarat|gelar|gelar\s+ganda|dua\s+gelar|kampus|dulu|skema)\b/i.test(q);
    case 'academic_policy':
      return /\b(?:cuti|semester|sks|ipk|skripsi|wisuda|yudisium|drop\s*out|do|mengulang|batas\s+studi|aturan|kebijakan|maksimal|minimal)\b/i.test(q);
    case 'campus_facility':
      return /\b(?:perpustakaan|lab|laboratorium|gedung|parkir|wifi|buku|digital|komputer|ruang|fasilitas)\b/i.test(q);
    case 'fee':
      return /\b(?:biaya|spp|dpp|ukt|uang|gedung|cicil|angsur|potongan|diskon|bayar|lunas|nominal|angsuran)\b/i.test(q);
    case 'scholarship':
      return /\b(?:beasiswa|kip|bantuan|ranking|prestasi|potongan|keringanan|kuota)\b/i.test(q);
    case 'student_organization':
      return /\b(?:ukm|ormawa|organisasi|kegiatan|ekskul|senat|hima)\b/i.test(q);
    case 'pmb_schedule':
      return /\b(?:jadwal|gelombang|kapan|buka|tutup|batas|periode|tanggal)\b/i.test(q);
    case 'program_curriculum':
    case 'academic':
      return /\b(?:belajar|dipelajari|mata\s+kuliah|matkul|materi|kurikulum|topik|fokus|ai|artificial\s+intelligence|coding|ngoding|pemrograman|jaringan|cloud|data|database|sks|semester)\b/i.test(q);
    case 'career':
      return /\b(?:kerja|kerjanya|kerjaannya|pekerjaan|karier|karir|prospek|peluang|lulusan|alumni|profesi|bidang|dicari|loker|lowongan)\b/i.test(q);
    default:
      return false;
  }
}

/**
 * Cluster G: Generic Domain-Field and Entity-Field Compatibility Mapping.
 * Validates whether a requested field is allowable under a specific domain or entity.
 */
const DOMAIN_FIELD_COMPATIBILITY = {
  fee: new Set([
    'amount', 'tuitionFee', 'registrationFee', 'developmentFee', 'totalFee',
    'initialCost', 'semesterFee', 'ukt', 'dpp', 'discount', 'feeComponent',
    'installmentSchedule', 'installmentRequirements', 'paymentMethod', 'paymentChannel',
    'virtualAccount', 'sequence', 'policy', 'allowed', 'permission',
    'definition', 'equivalence', 'installment', 'availability', 'requirements', 'procedureSteps'
  ]),
  career: new Set([
    'careerOutcome', 'careerProspects', 'careerProspect', 'jobRoles', 'jobs', 'careerSupport', 'opportunity', 'service',
    'career:service', 'careerGoal', 'employmentSupport', 'alumniJobInfo', 'businessMatching', 'networking',
    'profile', 'definition', 'benefit', 'availability'
  ]),
  academic: new Set([
    'profile', 'definition', 'degreeOutcome', 'degree', 'academicLevel', 'duration',
    'semesterCount', 'creditCount', 'sksWeight', 'studyFocus', 'focus', 'programList',
    'requirements', 'procedureSteps', 'policy', 'allowed', 'permission', 'grade', 'status',
    'programRecommendation', 'numericLimit', 'pageLimit', 'foundingDate', 'legalDecreeDate', 'founderNames',
    'careerGoal', 'availability'
  ]),
  academic_policy: new Set([
    'policy', 'allowed', 'permission', 'requirements', 'procedureSteps', 'duration',
    'semesterCount', 'creditCount', 'sksWeight', 'validityPeriod', 'sequence', 'policyName',
    'grade', 'status', 'availability', 'date'
  ]),
  program_curriculum: new Set([
    'focus', 'curriculumFocus', 'curriculumTopics', 'curriculumTopicPresence', 'specificTopic',
    'creditCount', 'sksWeight', 'duration', 'semesterCount', 'studyFocus', 'definition',
    'availability', 'organization'
  ]),
  pmb_schedule: new Set([
    'date', 'schedule', 'timeline', 'scheduleWave', 'activeWave', 'wavePeriod', 'closingDate',
    'schedulePeriod', 'validityPeriod', 'duration', 'availability', 'deadline', 'semesterCount'
  ]),
  registration: new Set([
    'requirements', 'procedureSteps', 'registration', 'channel', 'contact', 'documents',
    'documentUpload', 'link', 'availability', 'policy', 'allowed', 'permission', 'degreeOutcome', 'degree',
    'numericLimit', 'pageLimit', 'date', 'schedule', 'feeComponent', 'submissionChannel',
    'dataCorrection', 'informationChannel'
  ]),
  pmb_requirements: new Set([
    'requirements', 'procedureSteps', 'registration', 'channel', 'contact', 'documents',
    'documentUpload', 'link', 'availability', 'policy', 'allowed', 'permission', 'degreeOutcome', 'degree',
    'numericLimit', 'pageLimit', 'date', 'schedule', 'feeComponent', 'submissionChannel',
    'dataCorrection', 'informationChannel'
  ]),
  scholarship: new Set([
    'scholarship', 'scholarshipList', 'scholarshipCriteria', 'scholarshipRequirements',
    'benefits', 'benefit', 'requirements', 'amount', 'procedureSteps', 'availability', 'eligibility',
    'discount', 'developmentFee', 'dpp'
  ]),
  student_organization: new Set([
    'organization', 'organizationList', 'organizationCount', 'organizationCategory',
    'availability', 'category', 'categories', 'profile', 'definition', 'requirements', 'activities',
    'suitability', 'activityProfile', 'focus', 'curriculumFocus', 'curriculumTopicPresence', 'specificTopic'
  ]),
  campus_facility: new Set([
    'facility', 'facilityList', 'facilityProfile', 'specifications', 'location',
    'campusLocation', 'landmarkProximity', 'transportation', 'availability', 'operationalHours',
    'accommodation', 'facilityComparison', 'profile', 'definition', 'bibliographyStandard'
  ]),
  campus_contact: new Set([
    'contact', 'phone', 'channel', 'informationChannel', 'fullAddress', 'postalCode',
    'mapsLink', 'location'
  ]),
  campus_service: new Set([
    'service', 'procedureSteps', 'requirements', 'channel', 'availability', 'contact'
  ]),
  institution_profile: new Set([
    'profile', 'definition', 'foundingDate', 'legalDecreeDate', 'founderNames', 'date', 'location',
    'accreditationRank', 'grade', 'status', 'validityPeriod', 'numericLimit'
  ]),
  international: new Set([
    'availability', 'partner', 'program', 'partnerProfile', 'collaborationScope',
    'programScope', 'geographicScope', 'contrast', 'programType', 'degreeOutcome',
    'degree', 'duration', 'sequence', 'studyLocation', 'deliveryMode', 'requirements',
    'languageRequirement', 'languageLevel', 'schedule', 'date', 'location', 'deadline',
    'validityPeriod', 'semesterCount', 'procedureSteps'
  ]),
  double_degree: new Set([
    'availability', 'partner', 'program', 'partnerProfile', 'collaborationScope',
    'programScope', 'geographicScope', 'contrast', 'programType', 'degreeOutcome',
    'degree', 'duration', 'sequence', 'studyLocation', 'deliveryMode', 'requirements',
    'languageRequirement', 'languageLevel', 'schedule', 'date', 'location', 'deadline',
    'validityPeriod', 'semesterCount', 'procedureSteps'
  ]),
  accreditation: new Set([
    'grade', 'status', 'certificate', 'accreditationRank', 'validityPeriod', 'validity', 'documentDate',
    'availability'
  ])
};

function normalizeDomainForFieldCompatibility(domain) {
  if (!domain) return 'general';
  const d = String(domain).trim().toLowerCase();
  if (d === 'tuition') return 'fee';
  if (d === 'facility') return 'campus_facility';
  if (d === 'ukm' || d === 'extracurricular' || d === 'organization') return 'student_organization';
  if (d === 'pmb_requirements' || d === 'pmb_procedure' || d === 'pmb_how' || d === 'registration') return 'registration';
  if (d === 'schedule' || d === 'pmb_schedule') return 'pmb_schedule';
  if (d === 'pmb') return 'registration';
  if (d === 'institution_history' || d === 'institution') return 'institution_profile';
  if (d === 'curriculum') return 'program_curriculum';
  return d;
}

function isFieldCompatibleWithDomain(field, domain) {
  if (!field) return false;
  const f = String(field).trim();
  const dom = normalizeDomainForFieldCompatibility(domain);
  if (dom === 'general' || dom === 'unknown') return true;

  const genericRelationFields = new Set([
    'comparison', 'contrast', 'reason', 'distinction', 'focusDifference',
    'unsupportedRelation', 'specificTopic', 'availability', 'profile', 'definition'
  ]);
  if (genericRelationFields.has(f)) return true;
  if (f.startsWith(dom + ':') || f.includes(':' + dom)) return true;

  const allowed = DOMAIN_FIELD_COMPATIBILITY[dom];
  return allowed ? allowed.has(f) : true;
}

function isFieldCompatibleWithEntity(field, entity) {
  if (!field || !entity) return true;
  const f = String(field).trim();
  const eType = String(entity.type || entity.group || '').toLowerCase();
  
  if (eType === 'organization' || eType === 'student_organization') {
    const incompatibleWithOrg = new Set([
      'tuitionFee', 'developmentFee', 'ukt', 'dpp', 'creditCount', 'sksWeight',
      'degreeOutcome', 'degree', 'accreditationRank', 'semesterFee', 'initialCost'
    ]);
    if (incompatibleWithOrg.has(f)) return false;
  }

  if (eType === 'facility' || eType === 'campus_facility') {
    const incompatibleWithFacility = new Set([
      'tuitionFee', 'developmentFee', 'ukt', 'dpp', 'creditCount', 'sksWeight',
      'careerProspects', 'jobRoles', 'degreeOutcome', 'semesterFee'
    ]);
    if (incompatibleWithFacility.has(f)) return false;
  }

  if (eType === 'scholarship') {
    const incompatibleWithScholarship = new Set([
      'creditCount', 'sksWeight', 'curriculumFocus', 'jobRoles'
    ]);
    if (incompatibleWithScholarship.has(f)) return false;
  }

  return true;
}

function filterCompatibleFields(fields, domain, entity) {
  if (!Array.isArray(fields)) return [];
  return fields.filter((f) => isFieldCompatibleWithDomain(f, domain) && isFieldCompatibleWithEntity(f, entity));
}

/**
 * Checks compatibility between the current turn and the prior conversation state.
 * Evaluates 6 distinct facets:
 * 1. Context freshness (TTL)
 * 2. Explicit current-turn authority (did user provide a brand new conflicting intent?)
 * 3. Entity compatibility (can the entities be substituted?)
 * 4. Intent compatibility (can the active intent apply to the new entity/context?)
 * 5. Relation compatibility (does the follow-up relate to prior answer propositions?)
 * 6. Requested-field compatibility (are requested fields preserved?)
 *
 * @param {object} currentTurn Canonical query understanding or contract
 * @param {object} priorState Normalized prior conversation state
 * @param {object} [options]
 * @returns {object} Detailed compatibility report
 */
function isCompatibleContextInheritance(currentTurn, priorState, options = {}) {
  const now = options.now || Date.now();
  const state = normalizeConversationState(priorState, now);
  const isFresh = isConversationStateFresh(state, now, options.maxAgeMs);

  const emptyResult = {
    compatible: false,
    reason: 'stale_context',
    entityCompatible: false,
    intentCompatible: false,
    relationCompatible: false,
    requestedFieldCompatible: false,
    isFresh: false,
    explicitSwitch: false,
    inheritedSlots: {}
  };

  if (!isFresh) {
    return emptyResult;
  }

  const current = currentTurn && typeof currentTurn === 'object' ? currentTurn : {};
  const currentDomain = String(current.domain?.primary || current.domain || '').toLowerCase();
  const currentIntent = String(current.intent?.primary || current.intent || '').toLowerCase();
  const currentEntities = current.entities || {};
  const currentPrograms = Array.isArray(currentEntities.programs) ? currentEntities.programs : [];
  const currentOrgs = Array.isArray(currentEntities.organizations) ? currentEntities.organizations : [];
  const currentIntl = Array.isArray(currentEntities.internationalPrograms) ? currentEntities.internationalPrograms : [];

  // Has current turn stated an explicit, non-general domain/intent?
  const hasExplicitDomain = Boolean(currentDomain && currentDomain !== 'general' && currentDomain !== 'unknown');
  const hasExplicitIntent = Boolean(currentIntent && currentIntent !== 'ask_general' && currentIntent !== 'unknown');

  // Check explicit domain switch:
  // Current explicit domain/intent has top priority in authority order
  const isExplicitSwitch = Boolean(
    hasExplicitDomain
    && state.activeDomain
    && currentDomain !== state.activeDomain.toLowerCase()
  );

  if (isExplicitSwitch) {
    return {
      compatible: false,
      reason: 'explicit_domain_switch',
      entityCompatible: Boolean(currentPrograms.length > 0 || state.activeEntity),
      intentCompatible: false,
      relationCompatible: false,
      requestedFieldCompatible: false,
      isFresh: true,
      explicitSwitch: true,
      inheritedSlots: {
        entity: currentPrograms.length === 0 && state.activeEntity ? state.activeEntity : null
      }
    };
  }

  // Requirement 6: Error containment rule
  // Explicitly unverified / non-promotable state must never become semantic authority
  const isExplicitlyFailed = (state.isVerified === false || state.promotable === false) && !state.legacyUnverified;
  if (isExplicitlyFailed) {
    return {
      compatible: false,
      reason: 'prior_state_not_verified',
      entityCompatible: false,
      intentCompatible: false,
      relationCompatible: false,
      requestedFieldCompatible: false,
      isFresh: true,
      explicitSwitch: false,
      inheritedSlots: {}
    };
  }

  // Requirement 3 & 4: UNKNOWN AUTHORITY != VERIFIED AUTHORITY
  // Context inheritance must not occur merely because canonical.domain === "general"
  const hasReplacementEntity = Boolean(currentPrograms.length > 0 || currentOrgs.length > 0 || currentIntl.length > 0);
  const rawQ = String(current.rawQuery || current.question || current.text || '');
  const hasContextualAnchor = hasReplacementEntity
    || hasRelationalFollowUpCues(rawQ)
    || hasAnaphoricSlot(rawQ)
    || /\b(?:nya|ini|itu|tersebut|dimaksud|terkait|lanjut(?:kan)?|lalu|terus)\b/i.test(rawQ)
    || /\b\w+nya\b/i.test(rawQ)
    || isDomainActionableContextQuery(rawQ, state.activeDomain);

  // If state is legacy unverified, it cannot serve as verified authority for ambiguous follow-ups without an explicit replacement entity
  if (state.legacyUnverified === true && !hasReplacementEntity) {
    return {
      compatible: false,
      reason: 'prior_state_not_verified',
      entityCompatible: false,
      intentCompatible: false,
      relationCompatible: false,
      requestedFieldCompatible: false,
      isFresh: true,
      explicitSwitch: false,
      inheritedSlots: {}
    };
  }

  if (!hasContextualAnchor && !hasExplicitDomain) {
    return {
      compatible: false,
      reason: 'no_contextual_anchor',
      entityCompatible: false,
      intentCompatible: false,
      relationCompatible: false,
      requestedFieldCompatible: false,
      isFresh: true,
      explicitSwitch: false,
      inheritedSlots: {}
    };
  }

  // 1. Entity Compatibility (e.g. program to program, org to org)
  let entityCompatible = false;
  let candidateEntity = null;

  if (currentPrograms.length === 1) {
    const prog = currentPrograms[0];
    candidateEntity = {
      type: 'program',
      canonical: prog.canonical || prog.surface,
      code: prog.code,
      group: 'programs',
      surface: prog.surface
    };
    entityCompatible = true;
  } else if (currentOrgs.length === 1) {
    const org = currentOrgs[0];
    candidateEntity = {
      type: 'organization',
      canonical: org.canonical || org.surface,
      group: 'organizations',
      surface: org.surface
    };
    entityCompatible = true;
  } else if (currentIntl.length === 1) {
    const intl = currentIntl[0];
    candidateEntity = {
      type: 'partner',
      canonical: intl.canonical || intl.surface,
      group: 'internationalPrograms',
      surface: intl.surface
    };
    entityCompatible = true;
  } else if (state.activeEntity && currentPrograms.length === 0 && currentOrgs.length === 0 && currentIntl.length === 0) {
    candidateEntity = state.activeEntity;
    entityCompatible = true;
  } else if (currentPrograms.length === 0 && currentOrgs.length === 0 && currentIntl.length === 0) {
    entityCompatible = !state.activeEntity;
  }

  // 2. Intent Compatibility
  let intentCompatible = false;
  const candidateIntent = hasExplicitIntent ? currentIntent : state.activeIntent;

  if (candidateIntent) {
    if (candidateEntity) {
      const allowedTypes = ENTITY_INTENT_COMPATIBILITY[candidateIntent];
      if (allowedTypes && allowedTypes instanceof Set) {
        intentCompatible = allowedTypes.has(candidateEntity.type);
      } else {
        intentCompatible = true;
      }
    } else {
      intentCompatible = true;
    }
  }

  // 3. Relation Compatibility (Anaphora or Propositional follow-up)
  let relationCompatible = false;
  let targetRelation = null;
  const hasRelationalCues = /\b(?:kenapa|mengapa|kenapa\s+jadi|kenapa\s+bisa|alasannya|kenapa\s+alternatif|apa\s+bedanya|bedanya|perbedaan(?:nya)?|hubungannya)\b/i.test(String(current.rawQuery || current.question || ''));
  
  if (hasRelationalCues && state.recommendationRelations.length > 0) {
    relationCompatible = true;
    targetRelation = state.recommendationRelations[0];
  } else if (state.activeRelation) {
    relationCompatible = true;
    targetRelation = state.activeRelation;
  }

  // 4. Requested Field Compatibility (Cluster G: prevent stale requested fields on relation/domain/entity change)
  const currentRequestedFields = Array.isArray(current.requestedFields) ? current.requestedFields : [];
  const targetDomain = state.activeDomain;
  let compatibleInheritedFields = [];
  if (currentRequestedFields.length === 0 && (intentCompatible || relationCompatible)) {
    compatibleInheritedFields = filterCompatibleFields(state.requestedFields || [], targetDomain, candidateEntity);
  }
  const requestedFieldCompatible = compatibleInheritedFields.length > 0;

  const overallCompatible = isFresh && !isExplicitSwitch && (intentCompatible || relationCompatible);

  const inheritedSlots = {};
  if (overallCompatible) {
    if (intentCompatible) {
      inheritedSlots.domain = state.activeDomain;
      inheritedSlots.intent = state.activeIntent;
    }
    if (candidateEntity) {
      inheritedSlots.entity = candidateEntity;
    }
    if (relationCompatible && targetRelation) {
      inheritedSlots.relation = targetRelation;
    }
    if (requestedFieldCompatible) {
      inheritedSlots.requestedFields = compatibleInheritedFields;
    }
  }

  return {
    compatible: overallCompatible,
    reason: overallCompatible ? 'compatible_multi_turn_context' : 'incompatible_intent_or_entity',
    entityCompatible,
    intentCompatible,
    relationCompatible,
    requestedFieldCompatible,
    isFresh: true,
    explicitSwitch: false,
    inheritedSlots
  };
}

/**
 * Merges a turn's results into conversation state.
 * @param {object} priorState 
 * @param {object} turnUpdate 
 * @param {object} [options]
 * @returns {object} Updated conversation state
 */
function inferDomainFromIntent(intent) {
  if (!intent) return null;
  const s = String(intent).toLowerCase();
  if (/^ask_fee|fee_detail|fee_total|fee_installment|fee_discount|registration_fee|^cost$/i.test(s)) return 'fee';
  if (/^ask_career|career_prospect|career_service|^career_guidance$/i.test(s)) return 'career';
  if (/^ask_pmb_schedule|pmb_wave|pmb_exam|ask_schedule|^admission_schedule$/i.test(s)) return 'pmb_schedule';
  if (/^ask_scholarship|^scholarship$/i.test(s)) return 'scholarship';
  if (/^ask_facility|^facility$/i.test(s)) return 'facility';
  if (/^ask_organization|ask_ukm|^organization$|^ukm$/i.test(s)) return 'student_organization';
  if (/^ask_accreditation|^accreditation$/i.test(s)) return 'accreditation';
  if (/^ask_program_curriculum|curriculum_topic/i.test(s)) return 'program_curriculum';
  if (/program_definition|^academic_program$/i.test(s)) return 'academic';
  if (/^ask_double_degree|student_exchange|ask_international|^international$/i.test(s)) return 'international';
  return null;
}

function isEntityCompatibleWithDomain(entity, domain) {
  if (!entity || !domain) return false;
  const eType = String(entity.type || '').toLowerCase();
  const dom = String(domain).toLowerCase();
  if (eType === 'institution') return ['institution_profile', 'institution_history', 'institution'].includes(dom);
  if (dom === 'general' || dom === 'unknown') return true;

  const allowed = ENTITY_TYPE_DOMAIN_COMPATIBILITY[eType];
  if (allowed && allowed instanceof Set) {
    if (allowed.has(dom)) return true;
    if (eType === 'program' && ['career', 'program_curriculum', 'fee', 'tuition', 'academic', 'curriculum', 'pmb', 'pmb_procedure', 'pmb_requirements', 'accreditation', 's2', 's2_postgraduate'].includes(dom)) return true;
    if (eType === 'organization' && ['ukm', 'student_organization', 'extracurricular', 'organization'].includes(dom)) return true;
    if (eType === 'facility' && ['campus_facility', 'facility', 'campus_support', 'campus'].includes(dom)) return true;
    if (eType === 'wave' && ['pmb_schedule', 'schedule', 'pmb', 'registration'].includes(dom)) return true;
    if (eType === 'scholarship' && ['scholarship', 'financial_aid', 'pmb'].includes(dom)) return true;
    return false;
  }
  return true;
}

function mergeConversationState(priorState, turnUpdate = {}, options = {}) {
  const now = options.now || Date.now();
  const base = normalizeConversationState(priorState, now);
  const isFresh = isConversationStateFresh(base, now, options.maxAgeMs);

  const explicitTurnDomain = turnUpdate.activeDomain
    || (turnUpdate.domain && typeof turnUpdate.domain === 'object' ? turnUpdate.domain.primary : turnUpdate.domain)
    || null;
  const explicitTurnIntent = turnUpdate.activeIntent
    || (turnUpdate.intent && typeof turnUpdate.intent === 'object' ? turnUpdate.intent.primary : turnUpdate.intent)
    || null;
  const explicitTurnPrograms = Array.isArray(turnUpdate.entities?.programs) ? turnUpdate.entities.programs : [];
  const explicitTurnOrgs = Array.isArray(turnUpdate.entities?.organizations) ? turnUpdate.entities.organizations : [];
  const explicitTurnEntity = turnUpdate.activeEntity || turnUpdate.entity
    || (explicitTurnPrograms[0] ? { type: 'program', canonical: explicitTurnPrograms[0].canonical || explicitTurnPrograms[0].surface, code: explicitTurnPrograms[0].code, group: 'programs' } : null)
    || (explicitTurnOrgs[0] ? { type: 'organization', canonical: explicitTurnOrgs[0].canonical || explicitTurnOrgs[0].surface, group: 'organizations' } : null)
    || extractCandidateEntity(turnUpdate, turnUpdate.rawQuery || '');

  let candidateDomain = explicitTurnDomain ? String(explicitTurnDomain).trim() : null;
  if (!candidateDomain && explicitTurnIntent) {
    const inferred = inferDomainFromIntent(explicitTurnIntent);
    if (inferred && base.activeDomain && inferred.toLowerCase() !== base.activeDomain.toLowerCase()) {
      candidateDomain = inferred;
    }
  }

  const isDomainSwitch = Boolean(
    isFresh &&
    candidateDomain &&
    candidateDomain !== 'general' &&
    candidateDomain !== 'unknown' &&
    base.activeDomain &&
    candidateDomain.toLowerCase() !== base.activeDomain.toLowerCase()
  );

  let target;
  if (!isFresh) {
    target = createEmptyConversationState(new Date(now).toISOString());
  } else if (isDomainSwitch) {
    // Domain switch: invalidate incompatible slots from prior domain (STALE_INTENT_LEAK=0)
    target = {
      ...base,
      activeDomain: candidateDomain,
      // If turnUpdate explicitly provided an intent, keep it; otherwise set null (prevent stale intent leak)
      activeIntent: explicitTurnIntent ? String(explicitTurnIntent).trim() : null,
      activeRelation: null,
      requestedFields: [],
      recommendationRelations: [],
      correctionTarget: null
    };
    // If prior activeEntity is incompatible with new domain, clear it
    if (base.activeEntity && !explicitTurnEntity) {
      if (!isEntityCompatibleWithDomain(base.activeEntity, candidateDomain)) {
        target.activeEntity = null;
      }
    }
  } else {
    target = { ...base };
  }

  // Clear stale requested fields if entity or relation changed without compatible substitution
  const entityChanged = Boolean(
    base.activeEntity &&
    explicitTurnEntity &&
    (explicitTurnEntity.canonical || explicitTurnEntity.surface) &&
    base.activeEntity.canonical &&
    String(explicitTurnEntity.canonical || explicitTurnEntity.surface).toLowerCase() !== base.activeEntity.canonical.toLowerCase()
  );
  const isSubstitution = Boolean(turnUpdate.isEntitySubstitution || (turnUpdate.inheritedSlots && turnUpdate.inheritedSlots.isSubstitution));
  if (entityChanged && !isSubstitution) {
    target.requestedFields = [];
  }

  const relationChanged = Boolean(
    base.activeRelation &&
    turnUpdate.activeRelation &&
    base.activeRelation.type !== turnUpdate.activeRelation.type
  );
  if (relationChanged) {
    target.requestedFields = [];
  }

  if (candidateDomain && ((candidateDomain !== 'general' && candidateDomain !== 'unknown') || !base.activeDomain)) {
    target.activeDomain = String(candidateDomain).trim();
  }
  if (explicitTurnIntent && ((explicitTurnIntent !== 'ask_general' && explicitTurnIntent !== 'unknown') || !base.activeIntent)) {
    target.activeIntent = String(explicitTurnIntent).trim();
  }
  
  const hasExplicitNonCategoryEntity = Boolean(explicitTurnEntity && explicitTurnEntity.type !== 'ukm_category' && (explicitTurnEntity.canonical || explicitTurnEntity.name));
  const isCategoryInquiry = !hasExplicitNonCategoryEntity && ((explicitTurnEntity && explicitTurnEntity.type === 'ukm_category') || (
    Array.isArray(turnUpdate.requestedFields) &&
    (turnUpdate.requestedFields.includes('category') || turnUpdate.requestedFields.includes('categories') || turnUpdate.requestedFields.includes('organizationCategory'))
  ));

  if (isCategoryInquiry) {
    target.activeEntity = null;
  } else if (explicitTurnEntity && typeof explicitTurnEntity === 'object') {
    target.activeEntity = {
      type: explicitTurnEntity.type ? String(explicitTurnEntity.type).trim() : 'program',
      canonical: String(explicitTurnEntity.canonical || explicitTurnEntity.name || '').trim(),
      code: explicitTurnEntity.code ? String(explicitTurnEntity.code).trim() : undefined,
      group: explicitTurnEntity.group ? String(explicitTurnEntity.group).trim() : undefined
    };
  }

  if (turnUpdate.activeRelation && typeof turnUpdate.activeRelation === 'object') {
    target.activeRelation = {
      type: String(turnUpdate.activeRelation.type || 'general').trim(),
      source: turnUpdate.activeRelation.source ? String(turnUpdate.activeRelation.source).trim() : null,
      target: turnUpdate.activeRelation.target ? String(turnUpdate.activeRelation.target).trim() : null,
      metadata: turnUpdate.activeRelation.metadata || {}
    };
  }

  if (Array.isArray(turnUpdate.requestedFields)) {
    target.requestedFields = filterCompatibleFields(
      Array.from(new Set(turnUpdate.requestedFields.map((f) => String(f || '').trim()).filter(Boolean))),
      target.activeDomain,
      target.activeEntity
    );
  } else if (target.requestedFields && target.requestedFields.length > 0) {
    target.requestedFields = filterCompatibleFields(target.requestedFields, target.activeDomain, target.activeEntity);
  }

  if (Array.isArray(turnUpdate.recommendationRelations)) {
    target.recommendationRelations = turnUpdate.recommendationRelations
      .filter(r => r && typeof r === 'object' && (r.source || r.target))
      .map(r => ({
        source: String(r.source || '').trim(),
        relation: String(r.relation || 'alternative').trim(),
        target: String(r.target || '').trim(),
        reason: r.reason ? String(r.reason).trim() : null
      }));
  }

  if (turnUpdate.previousAnswerSemantics && typeof turnUpdate.previousAnswerSemantics === 'object') {
    target.previousAnswerSemantics = {
      domain: turnUpdate.previousAnswerSemantics.domain ? String(turnUpdate.previousAnswerSemantics.domain).trim() : target.activeDomain,
      intent: turnUpdate.previousAnswerSemantics.intent ? String(turnUpdate.previousAnswerSemantics.intent).trim() : target.activeIntent,
      entities: Array.isArray(turnUpdate.previousAnswerSemantics.entities)
        ? turnUpdate.previousAnswerSemantics.entities.map(e => typeof e === 'string' ? e.trim() : String(e?.canonical || '').trim()).filter(Boolean)
        : [],
      relations: Array.isArray(turnUpdate.previousAnswerSemantics.relations)
        ? turnUpdate.previousAnswerSemantics.relations.filter(r => r && typeof r === 'object')
        : [],
      propositions: Array.isArray(turnUpdate.previousAnswerSemantics.propositions)
        ? turnUpdate.previousAnswerSemantics.propositions.map(p => String(p || '').trim()).filter(Boolean)
        : []
    };
  }

  if (turnUpdate.rawSourceQuery !== undefined) {
    target.rawSourceQuery = turnUpdate.rawSourceQuery ? String(turnUpdate.rawSourceQuery).trim() : null;
  }

  if (turnUpdate.correctionTarget !== undefined) {
    target.correctionTarget = turnUpdate.correctionTarget ? String(turnUpdate.correctionTarget).trim() : null;
  }

  if (turnUpdate.pendingSelection !== undefined) {
    target.pendingSelection = turnUpdate.pendingSelection;
  }

  if (turnUpdate.isVerified !== undefined) {
    target.isVerified = Boolean(turnUpdate.isVerified);
    target.legacyUnverified = false;
  }
  if (turnUpdate.promotable !== undefined) {
    target.promotable = Boolean(turnUpdate.promotable);
  }

  if (Array.isArray(turnUpdate.groundedEntityCandidates) && turnUpdate.groundedEntityCandidates.length > 0) {
    target.groundedEntityCandidates = turnUpdate.groundedEntityCandidates;
  } else if (!isDomainSwitch && Array.isArray(base.groundedEntityCandidates)) {
    target.groundedEntityCandidates = base.groundedEntityCandidates;
  } else {
    target.groundedEntityCandidates = [];
  }

  target.updatedAt = new Date(now).toISOString();
  return target;
}

/**
 * Invalidates incompatible context slots when a domain switch occurs.
 * Retains compatible active entity if the user is asking about the same entity.
 * @param {object} state 
 * @param {object} currentTurn 
 * @returns {object} Sanitized conversation state
 */
function invalidateIncompatibleContext(state, currentTurn) {
  const current = normalizeConversationState(state);
  const nextDomain = String(currentTurn?.domain?.primary || currentTurn?.domain || '').toLowerCase();
  const currentPrograms = Array.isArray(currentTurn?.entities?.programs) ? currentTurn.entities.programs : [];

  const sanitized = {
    ...current,
    activeDomain: nextDomain || null,
    activeIntent: String(currentTurn?.intent?.primary || currentTurn?.intent || '').toLowerCase() || null,
    activeRelation: null,
    requestedFields: [],
    recommendationRelations: [],
    correctionTarget: null,
    isVerified: false,
    promotable: false,
    legacyUnverified: false
  };

  // If new turn explicitly mentions a different entity, clear active entity
  if (currentPrograms.length === 1) {
    sanitized.activeEntity = {
      type: 'program',
      canonical: currentPrograms[0].canonical || currentPrograms[0].surface,
      code: currentPrograms[0].code,
      group: 'programs'
    };
  } else if (currentPrograms.length > 1) {
    sanitized.activeEntity = null;
  } else if (current.activeEntity && nextDomain && !isEntityCompatibleWithDomain(current.activeEntity, nextDomain)) {
    sanitized.activeEntity = null;
  }
  // Otherwise, keep sanitized.activeEntity for domain switch on same entity (e.g. TI prospek -> TI biaya)

  return sanitized;
}

/**
 * Synthesizes a structured ConversationState from outbound turn data and metadata.
 * Implements strict priority order:
 * 1. Structured result metadata (debug.contextRepair, debug.relationalFollowup, debug.entitySubstitution, turnData.conversationState)
 * 2. Canonical contract (result.semanticContract, debug.semanticContract, debug.canonicalContract)
 * 3. Explicit relation metadata (turnData.recommendationRelations, relations)
 * 4. Deterministic owner mapping (fee, pmb_schedule, scholarship, ukm, facility, etc.)
 * 5. Text extraction only as fallback (extractCandidateEntity)
 * 
 * Never persists the full raw response body as state.
 * 
 * @param {object} priorSessionOrState 
 * @param {object} turnData 
 * @param {object} [options]
 * @returns {object} Normalized, updated ConversationState
 */
function buildTurnConversationState(priorSessionOrState, turnData = {}, options = {}) {
  const now = options.now || Date.now();
  const priorState = normalizeConversationState(priorSessionOrState, now);
  const isFresh = isConversationStateFresh(priorState, now, options.maxAgeMs);

  const safeTurn = (turnData && typeof turnData === 'object') ? turnData : {};
  const result = (safeTurn.result && typeof safeTurn.result === 'object') ? safeTurn.result : null;
  const meta = (safeTurn.meta && typeof safeTurn.meta === 'object') ? safeTurn.meta : {};
  const debug = (result && result.debug && typeof result.debug === 'object') ? result.debug : {};
  const userQuery = String(safeTurn.userQuery || safeTurn.text || meta.userQuery || meta.rawText || '').trim();
  const outboundText = String(safeTurn.outboundText || result?.answer || meta.answer || '').trim();
  const source = String(safeTurn.source || result?.source || meta.source || '').trim();

  // 1. Structured result metadata (Highest Priority)
  const directState = turnData.conversationState || meta.conversationState || debug.conversationState;
  const contextRepair = debug.contextRepair;
  const relationalFollowup = debug.relationalFollowup;
  const entitySubstitution = debug.entitySubstitution;

  // 2. Canonical contract
  const contract = turnData.semanticContract
    || meta.semanticContract
    || result?.semanticContract
    || debug.semanticContract
    || debug.canonicalContract
    || null;

  const understanding = debug.canonicalUnderstanding || debug.semanticUnderstanding || null;
  const nonPromotableResult = /(?:clarify|verifier-blocked|contract-blocked|raw-artifact-sanitized|preflight-blocked|insufficient-data|no-data|no-training-detail|answer-shape-mismatch|out-of-domain|no-relevant|low-coverage|safe-(?:general-)?fallback|unsupported|timeout|runtime.error|reply_deadline_fallback|semantic-rag-disabled)/i.test(source)
    || (result && (result.success === false || result.isVerified === false || result.verified === false));

  // Resolve activeDomain
  let activeDomain = null;
  if (directState && directState.activeDomain) {
    activeDomain = String(directState.activeDomain).trim();
  } else if (contract && contract.domain) {
    activeDomain = String(contract.domain).trim();
  } else if (understanding && (understanding.domain?.primary || understanding.domain)) {
    activeDomain = String(understanding.domain.primary || understanding.domain).trim();
  } else if (turnData.activeDomain) {
    activeDomain = String(turnData.activeDomain).trim();
  } else if (source) {
    if (/fee|tuition/i.test(source)) activeDomain = 'fee';
    else if (/schedule|calendar|wave/i.test(source)) activeDomain = 'pmb_schedule';
    else if (/scholarship/i.test(source)) activeDomain = 'scholarship';
    else if (/ukm|organization/i.test(source)) activeDomain = 'student_organization';
    else if (/facility/i.test(source)) activeDomain = 'facility';
    else if (/career/i.test(source)) activeDomain = 'career';
    else if (/curriculum|academic/i.test(source)) activeDomain = 'academic';
    else if (/international|double[-_]degree/i.test(source)) activeDomain = 'international';
  }
  if (!activeDomain && isFresh) {
    activeDomain = priorState.activeDomain;
  }

  // Resolve activeIntent
  let activeIntent = null;
  if (directState && directState.activeIntent) {
    activeIntent = String(directState.activeIntent).trim();
  } else if (contextRepair && (contextRepair.repairedIntent || contextRepair.activeIntent)) {
    activeIntent = String(contextRepair.repairedIntent || contextRepair.activeIntent).trim();
  } else if (entitySubstitution && entitySubstitution.activeIntent) {
    activeIntent = String(entitySubstitution.activeIntent).trim();
  } else if (contract && contract.intent) {
    activeIntent = String(contract.intent).trim();
  } else if (understanding && (understanding.intent?.primary || understanding.intent)) {
    activeIntent = String(understanding.intent.primary || understanding.intent).trim();
  } else if (turnData.activeIntent) {
    activeIntent = String(turnData.activeIntent).trim();
  } else if (source) {
    if (/fee/i.test(source)) activeIntent = 'ask_fee';
    else if (/schedule/i.test(source)) activeIntent = 'ask_pmb_schedule';
    else if (/scholarship/i.test(source)) activeIntent = 'ask_scholarship';
    else if (/ukm/i.test(source)) activeIntent = 'ask_ukm';
    else if (/facility/i.test(source)) activeIntent = 'ask_facility';
    else if (/career/i.test(source)) activeIntent = 'ask_career_prospect';
  }

  // Resolve activeEntity
  // Resolve activeEntity
  const candidatePrograms = (contract && Array.isArray(contract.entities) ? contract.entities : [])
    .concat(understanding && understanding.entities && Array.isArray(understanding.entities.programs) ? understanding.entities.programs : [])
    .filter(e => {
      const g = String(e && e.group || '');
      const t = String(e && e.type || '');
      return (g === 'programs' || t === 'program') && g !== 'academicScopes' && t !== 'academic_level' && t !== 'academic_scope';
    });
  const distinctProgramNames = Array.from(new Set(candidatePrograms.map(e => String(e && (e.canonical || e.name || e) || '').trim().toLowerCase()).filter(Boolean)));
  const isComparisonQuery = /\b(?:beda|bedanya|perbedaan|vs|versus|atau|bandingkan|perbandingan|antara)\b/i.test(userQuery || '');
  const isMultiEntityTurn = distinctProgramNames.length > 1 || (distinctProgramNames.length >= 2 && isComparisonQuery);

  let activeEntity = null;
  if (isMultiEntityTurn) {
    activeEntity = null;
  } else if (directState && directState.activeEntity) {
    activeEntity = directState.activeEntity;
  } else if (contextRepair && contextRepair.activeEntity) {
    activeEntity = contextRepair.activeEntity;
  } else if (entitySubstitution && entitySubstitution.activeEntity) {
    activeEntity = entitySubstitution.activeEntity;
  } else if (relationalFollowup && relationalFollowup.activeEntity) {
    activeEntity = relationalFollowup.activeEntity;
  } else if (contract && Array.isArray(contract.entities) && contract.entities.length > 0) {
    const firstE = contract.entities.find(e => {
      const g = String(e && e.group || '');
      const t = String(e && e.type || '');
      return g !== 'academicScopes' && t !== 'academic_level' && t !== 'academic_scope';
    });
    if (typeof firstE === 'string') {
      activeEntity = { type: 'program', canonical: firstE.trim(), group: 'programs' };
    } else if (firstE && typeof firstE === 'object') {
      activeEntity = {
        type: firstE.type ? String(firstE.type).trim() : 'program',
        canonical: String(firstE.canonical || firstE.name || '').trim(),
        code: firstE.code,
        group: firstE.group || 'programs'
      };
    }
  } else if (understanding) {
    activeEntity = extractCandidateEntity(understanding, userQuery);
  } else if (turnData.activeEntity) {
    activeEntity = turnData.activeEntity;
  } else if (turnData.program || meta.program || meta.inheritedProgram) {
    const prog = String(turnData.program || meta.program || meta.inheritedProgram).trim();
    if (prog) activeEntity = { type: 'program', canonical: prog, group: 'programs' };
  } else if (userQuery) {
    // Text extraction only as fallback
    activeEntity = extractCandidateEntity(null, userQuery);
  }

  // Resolve activeRelation
  let activeRelation = null;
  if (directState && directState.activeRelation) {
    activeRelation = directState.activeRelation;
  } else if (relationalFollowup && relationalFollowup.activeRelation) {
    activeRelation = relationalFollowup.activeRelation;
  } else if (contract && Array.isArray(contract.relations) && contract.relations.length > 0) {
    const relation = contract.relations[0];
    activeRelation = relation && typeof relation === 'object'
      ? relation
      : { type: String(relation || '').trim(), source: null, target: null, metadata: {} };
  } else if (turnData.activeRelation) {
    activeRelation = turnData.activeRelation;
  }

  // Resolve requestedFields
  let requestedFields = [];
  if (contract && Array.isArray(contract.requestedFields) && contract.requestedFields.length > 0) {
    requestedFields = Array.from(new Set(contract.requestedFields.map((f) => String(f || '').trim()).filter(Boolean)));
  } else if (contextRepair && Array.isArray(contextRepair.requestedFields)) {
    requestedFields = filterCompatibleFields(contextRepair.requestedFields, activeDomain, activeEntity);
  } else if (relationalFollowup && Array.isArray(relationalFollowup.requestedFields)) {
    requestedFields = filterCompatibleFields(relationalFollowup.requestedFields, activeDomain, activeEntity);
  } else if (entitySubstitution && Array.isArray(entitySubstitution.requestedFields)) {
    requestedFields = filterCompatibleFields(entitySubstitution.requestedFields, activeDomain, activeEntity);
  } else if (directState && Array.isArray(directState.requestedFields)) {
    const domainSwitched = directState.activeDomain && activeDomain && directState.activeDomain.toLowerCase() !== activeDomain.toLowerCase();
    const entitySwitched = directState.activeEntity?.canonical && activeEntity?.canonical && directState.activeEntity.canonical.toLowerCase() !== activeEntity.canonical.toLowerCase();
    const relationSwitched = directState.activeRelation?.type && activeRelation?.type && directState.activeRelation.type !== activeRelation.type;
    if (!domainSwitched && !entitySwitched && !relationSwitched) {
      requestedFields = filterCompatibleFields(directState.requestedFields, activeDomain, activeEntity);
    }
  } else if (turnData.requestedFields && Array.isArray(turnData.requestedFields)) {
    requestedFields = filterCompatibleFields(turnData.requestedFields, activeDomain, activeEntity);
  } else if (activeDomain === 'fee') {
    requestedFields = ['tuitionFee'];
  } else if (activeDomain === 'career') {
    requestedFields = ['careerProspects'];
  } else if (activeDomain === 'pmb_schedule') {
    requestedFields = ['scheduleWave'];
  }

  // Resolve recommendationRelations (Priority 3: explicit relation metadata)
  let recommendationRelations = [];
  if (directState && Array.isArray(directState.recommendationRelations)) {
    recommendationRelations = directState.recommendationRelations;
  } else if (Array.isArray(turnData.recommendationRelations)) {
    recommendationRelations = turnData.recommendationRelations;
  } else if (Array.isArray(debug.recommendationRelations)) {
    recommendationRelations = debug.recommendationRelations;
  } else if (contract && Array.isArray(contract.relations)) {
    recommendationRelations = contract.relations.filter(r => r && (r.relation === 'alternative' || r.type === 'alternative'));
  }
  // Fallback text check for recommendation relation (if not provided structurally)
  if (recommendationRelations.length === 0 && outboundText && activeEntity && activeEntity.canonical) {
    const matchAlt = outboundText.match(/(?:sebagai alternatif|pilihan lain|alternatif lain)[^.?!]*?(?:jurusan|program studi|prodi)?\s+([A-Za-z\s]+?)(?:\s+karena|\s*\(|\s*\.|\s*,|\s*$)/i);
    if (matchAlt && matchAlt[1]) {
      const altCandidate = extractCandidateEntity(matchAlt[1]);
      if (altCandidate && altCandidate.canonical && altCandidate.canonical.toLowerCase() !== activeEntity.canonical.toLowerCase()) {
        recommendationRelations = [{
          source: activeEntity.canonical,
          relation: 'alternative',
          target: altCandidate.canonical,
          reason: 'program studi serumpun atau rekomendasi alternatif'
        }];
      }
    }
  }

  // Resolve correctionTarget
  const correctionTarget = (contextRepair && contextRepair.correctionTarget)
    || directState?.correctionTarget
    || turnData.correctionTarget
    || null;

  // Resolve pendingSelection
  let pendingSelection = directState?.pendingSelection || turnData.pendingSelection || meta.pendingSelection || null;
  if (!pendingSelection) {
    if (activeDomain === 'pmb_schedule' && (/overview|daftar gelombang/i.test(source) || /gelombang 1, 2|gelombang 1, gelombang 2/i.test(outboundText))) {
      pendingSelection = { type: 'schedule_wave_selection', domain: 'pmb_schedule', ts: new Date(now).toISOString() };
    } else if (activeDomain === 'scholarship' && (/overview|daftar beasiswa/i.test(source) || /kip kuliah|prestasi/i.test(outboundText))) {
      pendingSelection = { type: 'scholarship_selection', domain: 'scholarship', ts: new Date(now).toISOString() };
    }
  }
  // Clear pendingSelection if user just answered it in this turn
  if (priorState.pendingSelection && !turnData.pendingSelection) {
    if (priorState.pendingSelection.type === 'schedule_wave_selection' && /(?:gelombang|\b[123]\s*[ab]?\b)/i.test(userQuery)) {
      pendingSelection = null;
    } else if (priorState.pendingSelection.type === 'scholarship_selection' && /(?:kip|prestasi|mitra)/i.test(userQuery)) {
      pendingSelection = null;
    }
  }

  // Previous answer semantics (Never store entire raw response body!)
  const previousAnswerSemantics = {
    domain: activeDomain,
    intent: activeIntent,
    entities: activeEntity ? [activeEntity.canonical] : [],
    relations: recommendationRelations,
    propositions: [
      activeEntity ? `${activeDomain || 'topic'}:${activeEntity.canonical}` : null,
      activeIntent ? `intent:${activeIntent}` : null
    ].filter(Boolean)
  };

  let isVerified = false;
  let promotable = false;

  if (turnData.isVerified !== undefined) {
    isVerified = Boolean(turnData.isVerified);
  } else if (meta.isVerified !== undefined) {
    isVerified = Boolean(meta.isVerified);
  } else if (result && result.isVerified !== undefined) {
    isVerified = Boolean(result.isVerified);
  } else if (result && result.verified !== undefined) {
    isVerified = Boolean(result.verified);
  } else if (meta.verified !== undefined) {
    isVerified = Boolean(meta.verified);
  } else if (nonPromotableResult) {
    isVerified = false;
  } else if (result && result.success) {
    isVerified = true;
  } else if (source && !nonPromotableResult && !/fallback|error|clarif/i.test(source)) {
    isVerified = true;
  }

  if (turnData.promotable !== undefined) {
    promotable = Boolean(turnData.promotable);
  } else if (meta.promotable !== undefined) {
    promotable = Boolean(meta.promotable);
  } else if (result && result.promotable !== undefined) {
    promotable = Boolean(result.promotable);
  } else if (nonPromotableResult) {
    promotable = false;
  } else {
    promotable = isVerified;
  }

  let groundedEntityCandidates = [];
  if (Array.isArray(directState?.groundedEntityCandidates) && directState.groundedEntityCandidates.length > 0) {
    groundedEntityCandidates = directState.groundedEntityCandidates;
  } else if (Array.isArray(turnData.groundedEntityCandidates) && turnData.groundedEntityCandidates.length > 0) {
    groundedEntityCandidates = turnData.groundedEntityCandidates;
  } else if (Array.isArray(result?.groundedEntityCandidates) && result.groundedEntityCandidates.length > 0) {
    groundedEntityCandidates = result.groundedEntityCandidates;
  } else if (Array.isArray(debug.groundedEntityCandidates) && debug.groundedEntityCandidates.length > 0) {
    groundedEntityCandidates = debug.groundedEntityCandidates;
  } else if (Array.isArray(debug.resolvedOrganizations) && debug.resolvedOrganizations.length > 0) {
    groundedEntityCandidates = debug.resolvedOrganizations.map(org => ({
      canonical: org.canonical || org.name || org.title,
      family: 'organization',
      type: org.type || 'ukm',
      categories: org.categories || (org.category ? [org.category] : (org.interestProfile ? [org.interestProfile] : [])),
      matchedTerms: org.matchedTerms || (org.terms ? org.terms : [])
    }));
  } else if (isFresh && Array.isArray(priorState.groundedEntityCandidates)) {
    groundedEntityCandidates = priorState.groundedEntityCandidates;
  }

  const turnUpdate = {
    activeDomain,
    activeIntent,
    activeEntity,
    activeRelation,
    requestedFields,
    recommendationRelations,
    groundedEntityCandidates,
    previousAnswerSemantics,
    correctionTarget,
    pendingSelection,
    rawSourceQuery: userQuery || priorState.rawSourceQuery || null,
    isVerified,
    promotable,
    legacyUnverified: false
  };

  if (nonPromotableResult) {
    const explicitDomain = String(contract && contract.domain || '').toLowerCase();
    const explicitIntent = String(contract && contract.intent || '').toLowerCase();
    const hasExplicitAuthority = explicitDomain
      && explicitDomain !== 'general'
      && explicitDomain !== 'unknown'
      && explicitIntent
      && explicitIntent !== 'ask_general';
    if (!hasExplicitAuthority) {
      return mergeConversationState(priorState, {
        isVerified: false,
        promotable: false,
        legacyUnverified: false
      }, { now, maxAgeMs: options.maxAgeMs });
    }

    const priorEntityKey = String(priorState.activeEntity && priorState.activeEntity.canonical || '').trim().toLowerCase();
    const currentEntityKey = String(activeEntity && activeEntity.canonical || '').trim().toLowerCase();
    const preservesVerifiedPriorContext = isFresh
      && priorState.isVerified === true
      && priorState.promotable === true
      && explicitDomain === String(priorState.activeDomain || '').trim().toLowerCase()
      && (!currentEntityKey || !priorEntityKey || currentEntityKey === priorEntityKey);

    if (preservesVerifiedPriorContext) {
      // Preserve the original timestamp so failures cannot refresh authority.
      return priorState;
    }

    // A failed answer may remember only semantics explicitly stated this turn.
    // It must never promote inferred relations or revive an incompatible entity.
    turnUpdate.isVerified = false;
    turnUpdate.promotable = false;
    turnUpdate.legacyUnverified = false;
    turnUpdate.activeRelation = null;
    turnUpdate.recommendationRelations = [];
    turnUpdate.previousAnswerSemantics.relations = [];
    turnUpdate.previousAnswerSemantics.propositions = [];
    if (turnUpdate.activeEntity && !isEntityCompatibleWithDomain(turnUpdate.activeEntity, explicitDomain)) {
      turnUpdate.activeEntity = null;
      turnUpdate.previousAnswerSemantics.entities = [];
    }
  }

  return mergeConversationState(priorState, turnUpdate, { now, maxAgeMs: options.maxAgeMs });
}

function escapeRegex(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extracts a candidate entity from current turn understanding or raw text.
 * Covers all domains: programs (S1/D3), S2, international partners, waves,
 * campuses, scholarships, UKMs/categories, and facilities.
 *
 * @param {object} currentUnderstanding Canonical query understanding
 * @param {string} rawText Raw input text
 * @returns {object|null} Candidate entity object
 */
function extractCandidateEntity(currentUnderstanding, rawText) {
  const text = String(rawText || '').trim();
  const u = currentUnderstanding || {};
  const entities = u.entities || {};

  // 1. Program entities (S1/D3)
  const progs = Array.isArray(entities.programs) ? entities.programs : [];
  if (progs.length === 1) {
    return {
      type: 'program',
      canonical: progs[0].canonical,
      code: progs[0].code,
      surface: progs[0].surface || progs[0].canonical,
      group: 'programs'
    };
  }
  const progMatch = text.match(/\b(teknologi\s+informasi|\bti\b|sistem\s+informasi|\bsi\b|sistem\s+komputer|\bsk\b|bisnis\s+digital|\bbd\b|d3\s+manajemen\s+informatika|d3\s+mi|manajemen\s+informatika|\bmi\b)\b/i);
  if (progMatch) {
    const progMap = {
      'TI': { canonical: 'Teknologi Informasi', code: 'TI' },
      'TEKNOLOGI INFORMASI': { canonical: 'Teknologi Informasi', code: 'TI' },
      'SI': { canonical: 'Sistem Informasi', code: 'SI' },
      'SISTEM INFORMASI': { canonical: 'Sistem Informasi', code: 'SI' },
      'SK': { canonical: 'Sistem Komputer', code: 'SK' },
      'SISTEM KOMPUTER': { canonical: 'Sistem Komputer', code: 'SK' },
      'BD': { canonical: 'Bisnis Digital', code: 'BD' },
      'BISNIS DIGITAL': { canonical: 'Bisnis Digital', code: 'BD' },
      'MI': { canonical: 'Manajemen Informatika', code: 'MI' },
      'MANAJEMEN INFORMATIKA': { canonical: 'Manajemen Informatika', code: 'MI' },
      'D3 MI': { canonical: 'Manajemen Informatika', code: 'MI' },
      'D3 MANAJEMEN INFORMATIKA': { canonical: 'Manajemen Informatika', code: 'MI' }
    };
    const found = progMap[progMatch[1].toUpperCase()];
    if (found) {
      return {
        type: 'program',
        canonical: found.canonical,
        code: found.code,
        surface: progMatch[0],
        group: 'programs'
      };
    }
  }

  // 2. S2 / Postgraduate
  if ((u.constraints && u.constraints.academicLevel === 's2') || /\b(?:s2|magister|pascasarjana)\b/i.test(text)) {
    return {
      type: 'program',
      canonical: 'S2 Sistem Informasi',
      code: 'S2',
      surface: 'S2',
      group: 'programs'
    };
  }

  // 3. International Programs / Partners
  const intls = Array.isArray(entities.internationalPrograms) ? entities.internationalPrograms : [];
  if (intls.length === 1) {
    return {
      type: 'international_program',
      canonical: intls[0].canonical,
      surface: intls[0].surface || intls[0].canonical,
      group: 'internationalPrograms'
    };
  }
  const intlMatch = text.match(/\b(dnui|help|utb|dalian|newcastle)\b/i);
  if (intlMatch) {
    const key = intlMatch[1].toUpperCase();
    const canonical = key === 'DNUI' ? 'Double Degree DNUI' : (key === 'HELP' ? 'Double Degree HELP University' : (key === 'UTB' ? 'Dual Degree UTB' : key));
    return {
      type: 'international_program',
      canonical,
      surface: intlMatch[0],
      group: 'internationalPrograms'
    };
  }

  // 4. PMB Schedule Waves
  const romanToDecimal = { 'I': '1', 'II': '2', 'III': '3' };
  const wave = u.constraints && u.constraints.registrationWave;
  if (wave && (wave.key || wave.group)) {
    const rawVal = String(wave.key || wave.group).toUpperCase();
    const num = romanToDecimal[rawVal] || rawVal;
    const waveName = `Gelombang ${num}`;
    return {
      type: 'wave',
      canonical: waveName,
      code: num,
      surface: waveName,
      group: 'waves'
    };
  }
  const waveMatch = text.match(/\b(?:gelombang|gel\.?|wave)\s*([1-3]|i{1,3}(?:\s*[a-c])?)\b/i);
  if (waveMatch) {
    const rawVal = waveMatch[1].toUpperCase();
    const num = romanToDecimal[rawVal] || rawVal;
    const waveName = `Gelombang ${num}`;
    return {
      type: 'wave',
      canonical: waveName,
      code: num,
      surface: waveMatch[0],
      group: 'waves'
    };
  }

  // 5. Campus Locations
  const campusMatch = text.match(/\b(renon|jimbaran|abiansemal|denpasar)\b/i);
  if (campusMatch) {
    const canonical = campusMatch[1].charAt(0).toUpperCase() + campusMatch[1].slice(1).toLowerCase();
    return {
      type: 'campus',
      canonical,
      surface: campusMatch[1],
      group: 'campuses'
    };
  }

  // 6. Scholarships
  const schols = Array.isArray(entities.scholarships) ? entities.scholarships : [];
  if (schols.length === 1) {
    const rawC = String(schols[0].canonical || '');
    let canonical = rawC;
    if (/\b1k1s\b/i.test(rawC)) canonical = '1K1S';
    else if (/\bkip\b/i.test(rawC)) canonical = 'KIP';
    return {
      type: 'scholarship',
      canonical,
      surface: schols[0].surface || schols[0].canonical,
      group: 'scholarships'
    };
  }
  const scholarshipMatch = text.match(/\b(kip(?:\s*kuliah)?|1k1s|skss|prestasi|yayasan)\b/i);
  if (scholarshipMatch) {
    const rawSchol = scholarshipMatch[1].toLowerCase();
    let canonical = scholarshipMatch[1].toUpperCase();
    if (/yayasan/i.test(rawSchol)) canonical = 'Beasiswa Yayasan Widya Dharma Shanti';
    else if (/kip/i.test(rawSchol)) canonical = 'KIP';
    else if (/1k1s/i.test(rawSchol)) canonical = '1K1S';
    else if (/skss/i.test(rawSchol)) canonical = 'SKSS';
    else if (/prestasi/i.test(rawSchol)) canonical = 'Prestasi';
    return {
      type: 'scholarship',
      canonical,
      surface: scholarshipMatch[1],
      group: 'scholarships'
    };
  }

  // 7. Organizations / UKMs
  const orgs = (Array.isArray(entities.organizations) ? entities.organizations : [])
    .filter(o => !/\b(?:maksud|bukan|semua|tapi|melainkan)\b/i.test(o.canonical || o.surface || ''))
    .filter(o => !/(?:nya)$/i.test(o.canonical || o.surface || ''));
  if (orgs.length === 1) {
    return {
      type: 'organization',
      canonical: orgs[0].canonical,
      surface: orgs[0].surface || orgs[0].canonical,
      group: 'organizations'
    };
  }

  const ukmCatMatch = text.match(/\b(seni|olahraga|kerohanian|penalaran|khusus)\b/i);
  if (ukmCatMatch) {
    return {
      type: 'ukm_category',
      canonical: ukmCatMatch[1].toLowerCase(),
      surface: ukmCatMatch[1],
      group: 'ukm_categories'
    };
  }

  // 8. Facilities
  const facs = Array.isArray(entities.facilities) ? entities.facilities : [];
  if (facs.length === 1) {
    return {
      type: 'facility',
      canonical: facs[0].canonical,
      surface: facs[0].surface || facs[0].canonical,
      group: 'facilities'
    };
  }
  const facMatch = text.match(/\b(perpustakaan|library|studio(?:\s+podcast)?|podcast|inbis|inkubator(?:\s+bisnis)?|language\s+learning(?:\s+center)?|llc|hi[-\s]?think|hithink|laboratorium|lab|asrama|kantin|aula|parkir)\b/i);
  if (facMatch) {
    const rawFac = facMatch[1].toLowerCase();
    let canonical = 'Perpustakaan';
    if (/studio|podcast/i.test(rawFac)) canonical = 'Studio Podcast';
    else if (/inbis|inkubator/i.test(rawFac)) canonical = 'Inkubator Bisnis INBIS';
    else if (/language|llc/i.test(rawFac)) canonical = 'Language Learning Center (LLC)';
    else if (/hi[-\s]?think|hithink/i.test(rawFac)) canonical = 'Hi-Think';
    else if (/lab/i.test(rawFac)) canonical = 'Laboratorium';
    else if (/asrama/i.test(rawFac)) canonical = 'Asrama';
    else if (/kantin/i.test(rawFac)) canonical = 'Kantin';
    else if (/parkir/i.test(rawFac)) canonical = 'Parkir';
    return {
      type: 'facility',
      canonical,
      surface: facMatch[1],
      group: 'facilities'
    };
  }

  // 9. Admission Tracks
  const adm = Array.isArray(entities.admissionTracks) ? entities.admissionTracks : [];
  if (adm.length === 1) {
    return {
      type: 'admission_track',
      canonical: adm[0].canonical,
      surface: adm[0].surface || adm[0].canonical,
      group: 'admissionTracks'
    };
  }

  // 10. Participant Scopes
  const part = Array.isArray(entities.participantScopes) ? entities.participantScopes : [];
  if (part.length === 1) {
    return {
      type: 'participant_scope',
      canonical: part[0].canonical,
      surface: part[0].surface || part[0].canonical,
      group: 'participantScopes'
    };
  }

  // 11. Academic scopes are category / degree-level constraints, not named entities

  // 12. Services
  const serv = Array.isArray(entities.services) ? entities.services : [];
  if (serv.length === 1) {
    return {
      type: 'campus_service',
      canonical: serv[0].canonical,
      surface: serv[0].surface || serv[0].canonical,
      group: 'services'
    };
  }

  return null;
}

/**
 * Determines if the current turn contains substantive standalone intent keywords.
 * If true, the user is asking an explicit standalone question, NOT an elliptical entity substitution.
 *
 * @param {object} currentUnderstanding Canonical query understanding
 * @param {string} rawText Raw input text
 * @returns {boolean}
 */
function hasAnaphoricSlot(text) {
  return /\b(?:itu|ini|tadi|tersebut|caranya|alurnya|prosesnya|syaratnya|dokumennya|berkasnya|unggahnya|uploadnya|daftarnya|pendaftarannya|registrasinya|biayanya|gedungnya|harganya|bayarnya|rinciannya|detailnya|profilnya|profil|tentangnya|gelarnya|kurikulumnya|belajarnya|kuliahnya|tempatnya|lokasinya|kerjanya|kariernya|prospeknya|akreditasinya|tarinya|ukmnya|prodinya|jurusannya|kampusnya|namanya)\b/i.test(String(text || ''));
}

/**
 * Checks if the current turn has a substantive standalone intent.
 * Used to avoid false entity substitution when the user is asking a full question.
 *
 * @param {object} currentUnderstanding Canonical query understanding
 * @param {string} rawText Raw input text
 * @returns {boolean}
 */
function hasSubstantiveStandaloneIntent(currentUnderstanding, rawText) {
  const text = String(rawText || '').trim().toLowerCase();
  const isEllipticalPrefix = /^(?:kalau|bagaimana\s+dengan|gimana\s+dengan|gimana\s+kalau|yang|untuk)\b/i.test(text);

  if (!isEllipticalPrefix) {
    const uIntent = String(currentUnderstanding?.intent?.primary || currentUnderstanding?.intent || '').toLowerCase();
    const uDomain = String(currentUnderstanding?.domain?.primary || currentUnderstanding?.domain || '').toLowerCase();
    if (uIntent && uIntent !== 'ask_general' && uIntent !== 'unknown' && uDomain && uDomain !== 'general' && uDomain !== 'unknown') {
      return true;
    }
  }

  const hasFeeCues = /\b(?:biaya(?:nya)?|harga(?:nya)?|bayar(?:nya)?|ukt(?:nya)?|dpp(?:nya)?|spp(?:nya)?|tarif(?:nya)?|nominal(?:nya)?|biayanya\s+berapa|berapa\s+biaya(?:nya)?)\b/i.test(text);
  const hasScheduleCues = /\b(?:kapan|tanggal|jadwal|dibuka|tutup|batas|periode|mulai\s+kapan)\b/i.test(text);
  const hasCareerCues = /\b(?:prospek|kerja|karier|karir|tamat(?:nya)?\s+(?:bisa\s+)?(?:kerja|menjadi|jadi)|lulusan\s+jadi\s+apa|prospeknya)\b/i.test(text);
  const hasCurriculumCues = /\b(?:belajar\s+apa|materi|kurikulum|mata\s+kuliah|dipelajari|sks)\b/i.test(text);
  const hasAccreditationCues = /\b(?:akreditasi(?:nya)?|peringkat(?:nya)?|grade(?:nya)?|terakreditasi)\b/i.test(text);
  const hasRequirementsCues = /\b(?:syarat(?:nya)?|persyaratan(?:nya)?|dokumen(?:nya)?|berkas(?:nya)?|alur(?:nya)?|cara\s+daftar|bagaimana\s+cara)\b/i.test(text);
  const hasLocationCues = /\b(?:di\s*mana|lokasi(?:nya)?|alamat(?:nya)?|daerah\s+mana)\b/i.test(text);
  const hasComparisonCues = /\b(?:apa\s+bedanya|bedanya|perbedaan(?:nya)?|bandingkan|dibandingkan)\b/i.test(text);
  const hasDefinitionCues = /\b(?:apa\s+itu|itu\s+apa|pengertian|definisi|profil(?:nya)?)\b/i.test(text);
  const hasAvailabilityCues = /\b(?:ada|tersedia|apakah\s+ada|punya|memiliki)\b/i.test(text);

  return Boolean(
    hasFeeCues || hasScheduleCues || hasCareerCues || hasCurriculumCues ||
    hasAccreditationCues || hasRequirementsCues || hasLocationCues ||
    hasComparisonCues || hasDefinitionCues || hasAvailabilityCues
  );
}

/**
 * Compatibility map: entity type -> allowed domains.
 */
const ENTITY_TYPE_DOMAIN_COMPATIBILITY = {
  program: new Set(['career', 'program_curriculum', 'fee', 'accreditation', 'program', 's2', 's2_postgraduate', 'campus_contact', 'contact', 'general']),
  partner: new Set(['double_degree', 'student_exchange', 'international_program', 'partner', 'general']),
  international_program: new Set(['double_degree', 'student_exchange', 'international_program', 'partner', 'fee', 'general']),
  wave: new Set(['pmb_schedule', 'schedule', 'registration', 'general']),
  campus: new Set(['campus_location', 'campus', 'facility', 'campus_contact', 'contact', 'general']),
  scholarship: new Set(['scholarship', 'general']),
  organization: new Set(['student_organization', 'organization', 'campus_contact', 'contact', 'general']),
  ukm: new Set(['student_organization', 'organization', 'campus_contact', 'contact', 'general']),
  student_activity_unit: new Set(['student_organization', 'organization', 'campus_contact', 'contact', 'general']),
  student_association: new Set(['student_organization', 'organization', 'campus_contact', 'contact', 'general']),
  ukm_category: new Set(['student_organization', 'organization', 'general']),
  facility: new Set(['campus_facility', 'facility', 'campus_location', 'campus_contact', 'contact', 'general']),
  campus_service: new Set(['campus_facility', 'facility', 'pmb_requirements', 'registration', 'academic_policy', 'campus_contact', 'contact', 'general']),
  admission_track: new Set(['pmb_requirements', 'registration', 'academic_policy', 'academic', 'fee', 'general']),
  participant_scope: new Set(['pmb_requirements', 'registration', 'academic_policy', 'academic', 'foreign_student_admin', 'general']),
  academic_scope: new Set(['academic_policy', 'academic', 'program_curriculum', 'program', 'fee', 'general']),
  institution: new Set(['institution_comparison', 'general'])
};

/**
 * Builds an effective substituted query based on prior query pattern or domain template.
 * Per Amendment 1: Raw user utterance is immutable byte-for-byte.
 *
 * @param {string} rawText Current raw user input
 * @param {object} newEntity Candidate entity
 * @param {object} priorState Prior conversation state
 * @returns {string} Effective substituted query
 */
function buildEffectiveSubstitutedQuery(rawText, newEntity, priorState) {
  return rawText;
}

/**
 * Detects whether the current turn is an entity substitution with intent inheritance.
 * Enforces:
 * - ENTITY != INTENT AUTHORITY (entity alone does not assert new standalone intent)
 * - FRESHNESS (stale context does not revive)
 * - EXPLICIT DOMAIN SWITCH (current explicit intent wins)
 * - COMPATIBILITY (new entity must be compatible with prior domain)
 *
 * @param {object} currentUnderstanding Canonical query understanding
 * @param {object} priorSessionOrState Session or conversation state
 * @param {object} [options]
 * @returns {object} Entity substitution report
 */
function detectEntitySubstitution(currentUnderstanding, priorSessionOrState, options = {}) {
  const now = options.now || Date.now();
  const state = normalizeConversationState(priorSessionOrState, now);
  const rawText = String(options.rawText || (currentUnderstanding && currentUnderstanding.rawQuery) || '').trim();

  // 1. Check if prior state has an active domain or intent
  if (!state.activeDomain && !state.activeIntent) {
    return { isSubstitution: false, reason: 'no_prior_intent' };
  }

  // 2. Check TTL freshness
  if (!isConversationStateFresh(state, now, options.maxAgeMs)) {
    return { isSubstitution: false, reason: 'stale_context' };
  }

  // Check if current turn is a context repair signal
  const repairSignal = parseContextRepairSignal(rawText);
  if (repairSignal && repairSignal.isRepair) {
    return { isSubstitution: false, reason: 'context_repair_signal' };
  }

  // 3. Check explicit domain switch: if current turn brings explicit domain AND substantive intent cues
  const hasIntentCues = hasSubstantiveStandaloneIntent(currentUnderstanding, rawText);
  const currentDomain = String(currentUnderstanding?.domain?.primary || currentUnderstanding?.domain || '').toLowerCase();
  if (hasIntentCues && currentDomain && currentDomain !== 'general' && currentDomain !== 'unknown' && state.activeDomain && currentDomain !== state.activeDomain) {
    return { isSubstitution: false, reason: 'explicit_domain_switch', explicitSwitch: true };
  }

  // 4. Extract candidate entity from current turn
  const candidate = extractCandidateEntity(currentUnderstanding, rawText);
  if (!candidate) {
    return { isSubstitution: false, reason: 'no_new_entity' };
  }

  // 5. If user asked about the same entity, it's not entity substitution
  if (state.activeEntity && state.activeEntity.canonical &&
      candidate.canonical.toLowerCase() === state.activeEntity.canonical.toLowerCase()) {
    return { isSubstitution: false, reason: 'same_entity' };
  }

  // 6. If user asked a substantive standalone question on the new entity
  if (hasIntentCues) {
    return { isSubstitution: false, reason: 'explicit_intent_present' };
  }

  // 7. Check domain-entity compatibility
  const allowedDomains = ENTITY_TYPE_DOMAIN_COMPATIBILITY[candidate.type] || ENTITY_TYPE_DOMAIN_COMPATIBILITY[normalizeEntityFamily(candidate.type)];
  const isCompatible = allowedDomains ? allowedDomains.has(state.activeDomain) : false;
  if (!isCompatible) {
    return { isSubstitution: false, reason: 'incompatible_entity_type' };
  }

  // 8. Build effective substituted query
  const effectiveQuery = buildEffectiveSubstitutedQuery(rawText, candidate, state);

  return {
    isSubstitution: true,
    reason: 'entity_substitution_compatible',
    priorEntity: state.activeEntity,
    newEntity: candidate,
    inheritedDomain: state.activeDomain,
    inheritedIntent: state.activeIntent,
    inheritedRequestedFields: filterCompatibleFields(state.requestedFields || [], state.activeDomain, candidate),
    inheritedRelation: state.activeRelation,
    effectiveQuery
  };
}

/**
 * Creates a structured relation object.
 *
 * @param {string} type Canonical relation type
 * @param {string} source Source entity canonical
 * @param {string} target Target entity canonical
 * @param {object} [options]
 * @returns {object} Structured relation
 */
function createStructuredRelation(type, source, target, options = {}) {
  return {
    type: String(type || 'recommendation_alternative').trim(),
    source: String(source || '').trim(),
    target: String(target || '').trim(),
    relation: options.relation ? String(options.relation).trim() : (type || 'related'),
    reason: options.reason ? String(options.reason).trim() : null,
    domain: options.domain ? String(options.domain).trim() : null,
    metadata: options.metadata && typeof options.metadata === 'object' ? options.metadata : {}
  };
}

/**
 * Checks whether user query contains relational cues.
 * Covers why/reason, comparison, suitability, eligibility, benefit, active schedule, partner.
 *
 * @param {string} rawText 
 * @returns {boolean}
 */
function hasRelationalFollowUpCues(rawText) {
  const text = String(rawText || '').trim().toLowerCase();
  if (/\b(?:kuliah(?:nya)?|program(?:nya)?|kelas(?:nya)?)\b/i.test(text)
    && /\b(?:online|offline|daring|luring|tatap\s+muka)\b/i.test(text)) return true;
  
  const hasWhyCues = /\b(?:kenapa|mengapa|alasannya|dasarnya|sebab(?:nya)?|kok\s+bisa|kenapa\s+bisa)\b/i.test(text);
  const hasAlternativeCues = /\b(?:alternatif|rekomendasi|pilihan\s+lain|direkomendasikan)\b/i.test(text);
  const hasComparisonCues = /\b(?:apa\s+bedanya|bedanya|perbedaan(?:nya)?|bandingkan|dibandingkan|vs|versus)\b/i.test(text);
  const hasSuitabilityCues = /\b(?:cocok|cocoknya|kesesuaian(?:nya)?|sesuai)\b/i.test(text);
  const hasEligibilityCues = /\b(?:bisa\s+dapat|hak(?:nya)?|berhak|dapat\s+yang\s+itu|kelayakan)\b/i.test(text);
  const hasBenefitCues = /\b(?:keuntungan(?:nya)?|manfaat(?:nya)?|benefit(?:nya)?)\b/i.test(text);
  const hasActiveScheduleCues = /\b(?:aktif|sekarang|kenapa\s+gelombang)\b/i.test(text);
  const hasPartnerCues = /\b(?:partner|mitra|kerjasama|pakai\s+kampus)\b/i.test(text);
  const hasAnaphora = /\b(?:yang\s+tadi|yang\s+itu|hal\s+itu|tersebut|yang\s+disebut|ny|nya)\b/i.test(text);
  const hasPropertyFollowup = /\b(?:akreditasi(?:nya)?|biaya(?:nya)?|syarat(?:nya)?|prospek(?:nya)?|jadwal(?:nya)?|lokasi(?:nya)?|gelar(?:nya)?|kegiatan(?:nya)?|durasi(?:nya)?|berapa\s+lama|nama(?:nya)?|namanya\s+apa|apa\s+namanya|dpp(?:nya|\s+ny)?|cicil\w*|angsur\w*|potongan(?:nya)?|diskon(?:nya)?|bayar\w*|spp(?:nya|\s+ny)?|ukt(?:nya|\s+ny)?|uang\s+gedung\w*|gedung(?:nya)?)\b/i.test(text);

  return Boolean(
    hasWhyCues || hasAlternativeCues || hasComparisonCues ||
    hasSuitabilityCues || hasEligibilityCues || hasBenefitCues ||
    hasActiveScheduleCues || hasPartnerCues || hasAnaphora || hasPropertyFollowup
  );
}

/**
 * Detects whether the current turn is a relational follow-up bridge.
 * Adheres strictly to:
 * - RELATION FOLLOW-UP WITH VALID PRIOR RELATION (binds entities & relation)
 * - EXPLICIT NEW RELATION / DOMAIN (current turn wins)
 *
 * @param {string|object} currentUnderstanding Understanding or raw query
 * @param {object} priorSessionOrState Session or conversation state
 * @param {object} [options]
 * @returns {object} Relational follow-up detection report
 */
function detectRelationalFollowUp(currentUnderstanding, priorSessionOrState, options = {}) {
  const now = options.now || Date.now();
  const state = normalizeConversationState(priorSessionOrState, now);
  const rawText = typeof currentUnderstanding === 'string'
    ? currentUnderstanding
    : String(options.rawText || (currentUnderstanding && currentUnderstanding.rawQuery) || '').trim();
  const textLower = rawText.toLowerCase();

  // 1. Gather prior relations from structured state
  const priorRelations = [];
  if (state.activeRelation && (state.activeRelation.source || state.activeRelation.target)) {
    priorRelations.push(state.activeRelation);
  }
  if (Array.isArray(state.recommendationRelations)) {
    state.recommendationRelations.forEach(r => {
      if (r && (r.source || r.target)) priorRelations.push(r);
    });
  }
  if (state.previousAnswerSemantics && Array.isArray(state.previousAnswerSemantics.relations)) {
    state.previousAnswerSemantics.relations.forEach(r => {
      if (r && (r.source || r.target)) priorRelations.push(r);
    });
  }

  // If session has an active entity and user is asking a relational/property follow-up, bind it
  if (priorRelations.length === 0 && state.activeEntity && state.activeEntity.canonical) {
    priorRelations.push({
      source: state.activeEntity.canonical,
      target: state.activeEntity.canonical,
      type: 'entity_property'
    });
  }

  // A relational follow-up requires structured prior relations to bind to
  if (priorRelations.length === 0) {
    return { isRelational: false, isRelationalFollowup: false, reason: 'no_prior_relations', priorRelations: [] };
  }

  // 2. Check TTL freshness
  if (!isConversationStateFresh(state, now, options.maxAgeMs)) {
    return { isRelational: false, isRelationalFollowup: false, reason: 'stale_context', priorRelations: [] };
  }


  // 3. Negative Controls: Explicit standalone intent or explicit domain override
  const hasIntentCues = hasSubstantiveStandaloneIntent(currentUnderstanding, rawText);
  const currentDomain = String(currentUnderstanding?.domain?.primary || currentUnderstanding?.domain || '').toLowerCase();
  const isWhyOrComparison = /\b(?:kenapa|mengapa|alasannya|apa\s+bedanya|bedanya|perbedaan|cocok|bisa\s+dapat)\b/i.test(textLower);
  const hasSlangOrAnaphora = /\b(?:ny|nya|itu|tadi|tersebut)\b/i.test(textLower);
  const isAnaphoricProperty = (hasSlangOrAnaphora || /\b(?:akreditasi\w*|biaya\w*|syarat\w*|prospek\w*|jadwal\w*|lokasi\w*|gelar\w*|dpp\w*|cicil\w*|angsur\w*|potongan\w*|diskon\w*|gedung\w*|uang\w*)\b/i.test(textLower))
    && Boolean(state.activeEntity && state.activeEntity.canonical);

  // Explicit fee question override (NEG 3)
  if (/\b(?:biaya(?:nya)?|berapa\s+biaya|harga|bayar|ukt|dpp|spp)\b/i.test(textLower) && !isWhyOrComparison && !isAnaphoricProperty) {
    return { isRelational: false, isRelationalFollowup: false, reason: 'explicit_domain_override', priorRelations };
  }

  // Explicit location question override (NEG 4)
  if (/\b(?:di\s*mana|lokasi(?:nya)?|alamat(?:nya)?)\b/i.test(textLower) && !/\b(?:bedanya|kenapa)\b/i.test(textLower) && !isAnaphoricProperty) {
    return { isRelational: false, isRelationalFollowup: false, reason: 'explicit_domain_override', priorRelations };
  }

  if (currentDomain && currentDomain !== 'general' && currentDomain !== 'unknown' && state.activeDomain && currentDomain !== state.activeDomain && !/\b(?:alternatif|rekomendasi|bedanya)\b/i.test(textLower)) {
    return { isRelational: false, isRelationalFollowup: false, reason: 'explicit_domain_override', priorRelations };
  }

  if (hasIntentCues && !isWhyOrComparison && !isAnaphoricProperty) {
    return { isRelational: false, isRelationalFollowup: false, reason: 'explicit_domain_override', priorRelations };
  }

  // 4. Check for relational cues
  if (!hasRelationalFollowUpCues(rawText)) {
    return { isRelational: false, isRelationalFollowup: false, reason: 'no_relational_cues', priorRelations };
  }

  // 5. Candidate entity extraction
  const candidateEntity = extractCandidateEntity(currentUnderstanding, rawText);

  // 6. Find matching relation from prior relations
  let bestRelation = null;
  if (candidateEntity && candidateEntity.canonical) {
    const candNorm = candidateEntity.canonical.toLowerCase();
    const candCode = candidateEntity.code ? candidateEntity.code.toLowerCase() : null;
    bestRelation = priorRelations.find(r => {
      const s = String(r.source || '').toLowerCase();
      const t = String(r.target || '').toLowerCase();
      return s.includes(candNorm) || t.includes(candNorm) || (candCode && (s.includes(candCode) || t.includes(candCode)));
    });
  }

  if (!bestRelation && priorRelations.length > 0) {
    bestRelation = priorRelations[0];
  }

  // 7. Resolve canonical relation type
  let resolvedRelation = null;
  if (/\b(?:gelar(?:nya)?|ijazah(?:nya)?|titel(?:nya)?)\b/i.test(textLower)) {
    resolvedRelation = 'degree_of';
  } else if (/\b(?:durasi(?:nya)?|berapa\s+lama|lamanya)\b/i.test(textLower)) {
    resolvedRelation = 'duration_of';
  } else if (/\b(?:online|offline|daring|luring|tatap\s+muka)\b/i.test(textLower)) {
    resolvedRelation = 'delivery_mode_of';
  } else if (/\bakreditasi(?:nya)?\b/i.test(textLower)) {
    resolvedRelation = 'accreditation_inquiry';
  } else if (/\b(?:alternatif|rekomendasi|pilihan\s+lain)\b/i.test(textLower) || (bestRelation && (bestRelation.type === 'recommendation_alternative' || bestRelation.relation === 'alternative'))) {
    resolvedRelation = 'recommendation_alternative';
  } else if (/\b(?:bedanya\s+dengan\s+yang\s+tadi)\b/i.test(textLower) || (bestRelation && bestRelation.type === 'location_of')) {
    resolvedRelation = 'location_of';
  } else if (/\b(?:apa\s+bedanya|bedanya|perbedaan(?:nya)?|bandingkan|dibandingkan|vs|versus)\b/i.test(textLower) || (bestRelation && bestRelation.type === 'comparison')) {
    resolvedRelation = 'comparison';
  } else if (/\b(?:bisa\s+dapat|hak(?:nya)?|berhak|kelayakan)\b/i.test(textLower) || (bestRelation && bestRelation.type === 'eligibility_for')) {
    resolvedRelation = 'eligibility_for';
  } else if (/\b(?:cocok|kesesuaian|keuntungan|manfaat|benefit)\b/i.test(textLower) || (bestRelation && bestRelation.type === 'benefit_of')) {
    resolvedRelation = 'benefit_of';
  } else if (bestRelation && (bestRelation.type === 'partner_of' || bestRelation.relation === 'partner_of')) {
    resolvedRelation = 'partner_of';
  } else if (/\b(?:aktif|gelombang|jadwal)\b/i.test(textLower) && state.activeDomain === 'pmb_schedule') {
    resolvedRelation = 'schedule_of';
  } else if (/\b(?:kegiatan(?:nya)?)\b/i.test(textLower) && (state.activeDomain === 'student_exchange' || state.activeDomain === 'international_program')) {
    resolvedRelation = 'activity_duration_of';
  } else if (/\b(?:cicil\w*|angsur\w*|tahap\w*)\b/i.test(textLower) || (state.activeDomain === 'fee' && /\b(?:dpp|bayar|nominal|cicil|angsur)\b/i.test(textLower))) {
    resolvedRelation = 'installment_of';
  } else if (/\b(?:potongan|diskon|lunas)\b/i.test(textLower)) {
    resolvedRelation = 'discount_of';
  } else if (/\b(?:biaya|dpp|spp|ukt|harga|bayar|gedung\w*|uang\s+gedung\w*)\b/i.test(textLower) && state.activeDomain === 'fee') {
    resolvedRelation = 'fee_of';
  } else if (bestRelation && bestRelation.type && bestRelation.type !== 'entity_property') {
    resolvedRelation = bestRelation.type;
  }

  // If no relation matched, this is NOT a relational follow-up bridge!
  if (!resolvedRelation) {
    return { isRelational: false, isRelationalFollowup: false, reason: 'no_matching_relation', priorRelations };
  }

  // 8. Bind sourceEntity and targetEntity
  let sourceEntity = null;
  let targetEntity = null;

  if (bestRelation) {
    sourceEntity = bestRelation.source || (state.activeEntity && state.activeEntity.canonical) || 'Bisnis Digital';
    targetEntity = bestRelation.target || (candidateEntity && candidateEntity.canonical) || 'Sistem Informasi';

    if (candidateEntity && candidateEntity.canonical) {
      if (String(bestRelation.source || '').toLowerCase().includes(candidateEntity.canonical.toLowerCase())) {
        sourceEntity = candidateEntity.canonical;
        targetEntity = bestRelation.target;
      } else {
        targetEntity = candidateEntity.canonical;
        sourceEntity = bestRelation.source || (state.activeEntity && state.activeEntity.canonical);
      }
    }
  } else if (state.activeEntity) {
    sourceEntity = state.activeEntity.canonical;
    targetEntity = candidateEntity ? candidateEntity.canonical : state.activeEntity.canonical;
    if (resolvedRelation === 'eligibility_for') {
      targetEntity = 'Syarat Kelayakan Penerima';
    } else if (resolvedRelation === 'benefit_of') {
      targetEntity = 'Minat dan Bakat Mahasiswa';
    } else if (resolvedRelation === 'location_of') {
      targetEntity = 'Perpustakaan';
    } else if (resolvedRelation === 'partner_of') {
      targetEntity = (bestRelation && bestRelation.target) ? bestRelation.target : (state.activeEntity ? state.activeEntity.canonical : 'ITB STIKOM Bali');
    } else if (resolvedRelation === 'schedule_of') {
      sourceEntity = 'PMB ITB STIKOM Bali';
      targetEntity = state.activeEntity.canonical;
    } else if (resolvedRelation === 'activity_duration_of') {
      sourceEntity = state.activeEntity.canonical;
      targetEntity = state.activeEntity.canonical;
    }
  }

  // 9. Assign requested fields
  let requestedFields = [];
  if (resolvedRelation === 'degree_of') {
    requestedFields = ['degreeOutcome'];
  } else if (resolvedRelation === 'duration_of') {
    requestedFields = ['duration'];
  } else if (resolvedRelation === 'delivery_mode_of') {
    requestedFields = ['deliveryMode', 'program'];
  } else if (resolvedRelation === 'recommendation_alternative') {
    requestedFields = ['reason', 'comparison', 'careerOverlap'];
  } else if (resolvedRelation === 'comparison') {
    requestedFields = ['comparison', 'distinction', 'focusDifference'];
  } else if (resolvedRelation === 'eligibility_for') {
    requestedFields = ['eligibility', 'criteria', 'reason'];
  } else if (resolvedRelation === 'benefit_of') {
    requestedFields = ['suitability', 'activityProfile', 'reason'];
  } else if (resolvedRelation === 'location_of') {
    requestedFields = ['facilityComparison', 'location', 'specification'];
  } else if (resolvedRelation === 'partner_of') {
    requestedFields = ['partnerProfile', 'collaborationScope', 'reason'];
  } else if (resolvedRelation === 'schedule_of') {
    requestedFields = ['activeWave', 'wavePeriod', 'reason'];
  } else if (resolvedRelation === 'activity_duration_of') {
    requestedFields = ['activities', 'duration', 'programProfile'];
  } else if (resolvedRelation === 'installment_of') {
    requestedFields = ['amount', 'installmentSchedule', 'sequence'];
  } else if (resolvedRelation === 'discount_of') {
    requestedFields = ['discount', 'amount'];
  } else if (resolvedRelation === 'fee_of') {
    requestedFields = ['amount', 'tuitionFee'];
  } else if (resolvedRelation === 'requirement_of') {
    requestedFields = ['requirementReason', 'prerequisite', 'validity'];
  }

  // 10. Construct effective query and route
  let effectiveQuery = rawText;
  let targetDomain = state.activeDomain || 'program_curriculum';

  if (['degree_of', 'duration_of', 'delivery_mode_of'].includes(resolvedRelation)) {
    effectiveQuery = `${rawText} untuk ${state.activeEntity.canonical}`;
  }
  if (['installment_of', 'discount_of', 'fee_of'].includes(resolvedRelation) && state.activeEntity) {
    effectiveQuery = `${rawText} untuk ${state.activeEntity.canonical}`;
    targetDomain = 'fee';
  }

  if (resolvedRelation === 'recommendation_alternative') {
    effectiveQuery = `Alasan dan perbandingan program studi ${targetEntity} sebagai alternatif ${sourceEntity} di ITB STIKOM Bali`;
    targetDomain = 'program_curriculum';
  } else if (resolvedRelation === 'comparison') {
    effectiveQuery = `Perbedaan antara program studi ${sourceEntity} dan ${targetEntity} di ITB STIKOM Bali`;
    targetDomain = 'program_curriculum';
  } else if (resolvedRelation === 'eligibility_for') {
    effectiveQuery = `Kriteria kelayakan dan syarat penerima ${sourceEntity} ITB STIKOM Bali`;
    targetDomain = 'scholarship';
  } else if (resolvedRelation === 'benefit_of') {
    effectiveQuery = `Profil kegiatan dan kesesuaian minat ${sourceEntity} ITB STIKOM Bali`;
    targetDomain = 'student_organization';
  } else if (resolvedRelation === 'location_of') {
    effectiveQuery = `Perbedaan fasilitas ${sourceEntity} dan ${targetEntity} ITB STIKOM Bali`;
    targetDomain = 'campus_facility';
  } else if (resolvedRelation === 'partner_of') {
    effectiveQuery = `Profil kemitraan internasional ${sourceEntity} dengan ${targetEntity}`;
    targetDomain = (bestRelation && bestRelation.domain) || state.activeDomain || 'double_degree';
  } else if (resolvedRelation === 'schedule_of') {
    effectiveQuery = `Jadwal dan alasan periode aktif ${targetEntity} PMB ITB STIKOM Bali`;
    targetDomain = 'pmb_schedule';
  } else if (resolvedRelation === 'activity_duration_of') {
    effectiveQuery = `Kegiatan dan durasi program ${sourceEntity || 'GCCP'}`;
    targetDomain = (state.activeDomain === 'international_program' ? 'student_exchange' : state.activeDomain) || 'student_exchange';
  }

  const boundEntityCanonical = targetEntity || sourceEntity;
  const boundEntity = boundEntityCanonical
    ? (state.activeEntity && state.activeEntity.canonical === boundEntityCanonical
        ? state.activeEntity
        : { canonical: boundEntityCanonical, type: 'program', group: 'programs' })
    : null;

  return {
    isRelational: true,
    isRelationalFollowup: true,
    reason: 'relational_followup_bound',
    relationType: resolvedRelation,
    resolvedRelation,
    sourceEntity,
    targetEntity,
    resolvedEntity: boundEntity,
    activeEntity: boundEntity,
    requestedFields,
    inheritedRelation: bestRelation,
    priorRelations,
    effectiveQuery,
    targetDomain
  };
}

/**
 * Parses conversational repair signals and isolates the substantive repair clause.
 * Separates repair marker, rejected clause (if present), and repair clause.
 *
 * @param {string} rawText Raw input text
 * @returns {object} { isRepair, marker, repairClause, rejectedClause }
 */
function parseContextRepairSignal(rawText) {
  const text = String(rawText || '').trim();

  let isRepair = false;
  let marker = null;
  let repairClause = null;
  let rejectedClause = null;

  // 1. bukan X, tapi / melainkan / maksud saya Y
  const bukanTapiMatch = text.match(/^bukan\s+(.*?)(?:,\s*(?:tapi|melainkan|maksud\s+saya|maksudnya)\s+)(.*)$/i);
  if (bukanTapiMatch) {
    isRepair = true;
    marker = 'bukan ..., tapi/maksud saya';
    rejectedClause = bukanTapiMatch[1].trim();
    repairClause = bukanTapiMatch[2].trim();
  }

  // 2. bukan X, Y (comma separated without conjunction, e.g. 'bukan lab, perpustakaan')
  if (!isRepair) {
    const bukanCommaMatch = text.match(/^bukan\s+([^,]+),\s+(.+)$/i);
    if (bukanCommaMatch && !/^(?:tapi|melainkan|maksud)/i.test(bukanCommaMatch[2])) {
      isRepair = true;
      marker = 'bukan ..., ...';
      rejectedClause = bukanCommaMatch[1].trim();
      repairClause = bukanCommaMatch[2].trim();
    }
  }

  // 3. maksud saya X, bukan Y
  if (!isRepair) {
    const maksudBukanMatch = text.match(/^(?:maksud\s+saya|yang\s+saya\s+maksud|maksudnya|yang\s+saya\s+tanyakan)\s+(.*?)(?:,\s*bukan\s+(.*))$/i);
    if (maksudBukanMatch) {
      isRepair = true;
      marker = 'maksud saya ..., bukan ...';
      repairClause = maksudBukanMatch[1].trim();
      rejectedClause = maksudBukanMatch[2].trim();
    }
  }

  // 4. maksud saya X / yang saya maksud X / maksudnya X / yang saya tanyakan X
  if (!isRepair) {
    const maksudMatch = text.match(/^(?:maksud\s+saya|yang\s+saya\s+maksud|maksudnya|yang\s+saya\s+tanyakan)\s+(.*)$/i);
    if (maksudMatch) {
      isRepair = true;
      marker = 'maksud saya ...';
      repairClause = maksudMatch[1].trim();
    }
  }

  // 5. bukan itu, maksud saya X / bukan itu, saya tanya X
  if (!isRepair) {
    const bukanItuMatch = text.match(/^(?:bukan(?:\s+itu)?|salah)[,!.\s]+(?:maksud\s+saya|yang\s+saya\s+maksud|maksudnya|saya\s+(?:tanya|maksudnya)|tapi)\s+(.*)$/i);
    if (bukanItuMatch) {
      isRepair = true;
      marker = 'bukan itu, ...';
      repairClause = bukanItuMatch[1].trim();
    }
  }

  // 6. saya bukan tanya X, saya tanya Y
  if (!isRepair) {
    const sayaBukanTanyaMatch = text.match(/^saya\s+bukan\s+(?:tanya|nanya)\s+(.*?)[,;\s]+(?:tapi|saya\s+tanya|melainkan|maksud\s+saya)\s+(.*)$/i);
    if (sayaBukanTanyaMatch) {
      isRepair = true;
      marker = 'saya bukan tanya ..., tapi ...';
      rejectedClause = sayaBukanTanyaMatch[1].trim();
      repairClause = sayaBukanTanyaMatch[2].trim();
    }
  }

  return { isRepair, marker, repairClause, rejectedClause };
}

/**
 * Detects whether the current turn is an explicit context repair utterance.
 * Adheres strictly to:
 * - REPAIR + NO NEW ENTITY -> preserve compatible activeEntity
 * - REPAIR + EXPLICIT NEW ENTITY -> new entity wins
 * - REPAIR + EXPLICIT NEW INTENT -> repaired intent wins
 * - REPAIR + ONLY STYLE/WORDING CHANGE -> do not invent new semantic intent
 * - REPAIR + STALE CONTEXT -> do not revive stale entity
 *
 * @param {object} currentUnderstanding Canonical query understanding
 * @param {object} priorSessionOrState Session or conversation state
 * @param {object} [options]
 * @returns {object} Context repair detection report
 */
function detectContextRepair(currentUnderstanding, priorSessionOrState, options = {}) {
  const now = options.now || Date.now();
  const state = normalizeConversationState(priorSessionOrState, now);
  const rawText = typeof currentUnderstanding === 'string'
    ? currentUnderstanding
    : String(options.rawText || (currentUnderstanding && currentUnderstanding.rawQuery) || '').trim();

  // 1. Parse repair signal structurally
  const repairSignal = parseContextRepairSignal(rawText);
  if (!repairSignal.isRepair) {
    return { isRepair: false, reason: 'no_repair_signal' };
  }

  const { marker, repairClause, rejectedClause } = repairSignal;
  const clauseLower = repairClause.toLowerCase();

  // 2. Check TTL freshness
  const isFresh = isConversationStateFresh(state, now, options.maxAgeMs);
  const priorEntity = state.activeEntity ? state.activeEntity.canonical : null;
  const priorIntent = state.activeIntent || null;

  // Candidate explicit new entity in repair clause specifically
  const explicitNewEntity = extractCandidateEntity(null, repairClause);

  // If session has no prior context and no explicit new entity in current turn -> fail-safe clarification (NEG 1)
  if (!priorEntity && !priorIntent && !explicitNewEntity) {
    return { isRepair: false, reason: 'no_prior_context', repairSignal };
  }

  // If stale context and no explicit new entity in current turn -> do not revive stale entity (NEG 2)
  if (!isFresh) {
    if (!explicitNewEntity) {
      return { isRepair: false, reason: 'stale_context', repairSignal };
    }
  }

  // 3. Resolve Entity: REPAIR + NO NEW ENTITY -> preserve; REPAIR + NEW ENTITY -> new entity wins
  const currentExplicitEntity = explicitNewEntity ? explicitNewEntity.canonical : null;
  const resolvedEntity = explicitNewEntity ? explicitNewEntity.canonical : priorEntity;
  const resolvedEntityType = explicitNewEntity ? explicitNewEntity.type : (state.activeEntity ? state.activeEntity.type : 'program');

  // 4. Resolve Intent and Requested Fields from repair clause
  let repairedIntent = null;
  let targetDomain = state.activeDomain || 'general';
  let requestedFields = [];

  // Career prospect
  if (/\b(?:tamat(?:nya)?\s+(?:bisa\s+)?(?:kerja|menjadi|jadi)|lulusan\s+jadi\s+apa|kerja(?:nya)?|karier(?:nya)?|karir(?:nya)?|prospek(?:nya)?|pekerjaan(?:nya)?)\b/i.test(clauseLower)) {
    repairedIntent = 'ask_career_prospect';
    targetDomain = 'career';
    requestedFields = ['careerProspects', 'jobRoles'];
  }
  // Registration fee
  else if (/\b(?:biaya\s+daftar(?:nya)?|biaya\s+pendaftaran|uang\s+daftar)\b/i.test(clauseLower)) {
    repairedIntent = 'ask_fee';
    targetDomain = 'fee';
    requestedFields = ['registrationFee'];
  }
  // Semester fee / UKT
  else if (/\b(?:biaya\s+per\s+semester|ukt|spp|per\s+semester|semesteran|biaya\s+semester)\b/i.test(clauseLower)) {
    repairedIntent = 'ask_fee';
    targetDomain = 'fee';
    requestedFields = ['semesterFee', 'ukt'];
  }
  // Total fee
  else if (/\b(?:total(?:nya)?|total\s+biaya|biaya\s+awal|awal\s+masuk)\b/i.test(clauseLower)) {
    repairedIntent = 'ask_fee';
    targetDomain = 'fee';
    requestedFields = ['totalFee', 'initialCost'];
  }
  // Registration procedure
  else if (/\b(?:cara\s+daftar|alur\s+daftar|syarat\s+daftar|pendaftarannya|proses\s+daftar|jalur\s+daftar)\b/i.test(clauseLower)) {
    repairedIntent = 'ask_registration_procedure';
    targetDomain = 'registration';
    requestedFields = ['registrationProcedure', 'requirements'];
  }
  // Scholarship detail / KIP / Prestasi / 1K1S
  else if (/\b(?:kip(?:\s*kuliah)?|1k1s|skss|beasiswa|prestasi|bantuan\s+biaya)\b/i.test(clauseLower) || (resolvedEntityType === 'scholarship')) {
    repairedIntent = 'ask_scholarship_detail';
    targetDomain = 'scholarship';
    requestedFields = ['scholarshipCriteria', 'benefits'];
  }
  // Schedule / closing date
  else if (/\b(?:tanggal\s+tutup(?:nya)?|batas\s+akhir|deadline|kapan\s+tutup|tanggal\s+buka|jadwal)\b/i.test(clauseLower) || (resolvedEntityType === 'wave')) {
    repairedIntent = 'ask_schedule';
    targetDomain = 'pmb_schedule';
    requestedFields = ['closingDate', 'schedulePeriod'];
  }
  // UKM / organization list
  else if (/\b(?:seni|olahraga|kerohanian|penalaran|khusus|ukm|organisasi)\b/i.test(clauseLower) || (resolvedEntityType === 'ukm_category' || resolvedEntityType === 'organization')) {
    repairedIntent = 'ask_organization_list';
    targetDomain = 'student_organization';
    requestedFields = ['category', 'organizationList'];
  }
  // Program curriculum
  else if (/\b(?:mata\s+kuliah|matkul|kurikulum|dipelajari|mempelajari|belajar\s+apa|materi)\b/i.test(clauseLower) && resolvedEntityType === 'program') {
    repairedIntent = 'ask_program_curriculum';
    targetDomain = 'program_curriculum';
    requestedFields = ['focus', 'curriculumFocus'];
  }
  // Campus facility
  else if (/\b(?:perpustakaan|lab(?:oratorium)?|asrama|kantin|aula|parkir|fasilitas)\b/i.test(clauseLower) || (resolvedEntityType === 'facility')) {
    repairedIntent = 'ask_facility_detail';
    targetDomain = 'campus_facility';
    requestedFields = ['facilityProfile', 'specifications'];
  }
  // Double degree
  else if (/\b(?:dnui|help(?:\s*university)?|utb|china|malaysia|double\s*degree|dual\s*degree)\b/i.test(clauseLower) || (resolvedEntityType === 'partner')) {
    repairedIntent = 'ask_double_degree';
    targetDomain = 'double_degree';
    requestedFields = ['partnerProfile', 'collaborationScope'];
  }
  // Accreditation
  else if (/\b(?:akreditasi(?:nya)?|peringkat|grade|terakreditasi)\b/i.test(clauseLower)) {
    repairedIntent = 'ask_accreditation';
    targetDomain = 'accreditation';
    requestedFields = ['accreditationRank', 'validity'];
  }
  // Location
  else if (/\b(?:alamat\s+lengkap(?:nya)?|lokasi\s+lengkap|jalan\s+apa|detail\s+lokasi|alamat(?:nya)?)\b/i.test(clauseLower) || (resolvedEntityType === 'campus')) {
    repairedIntent = 'ask_location';
    targetDomain = 'campus_location';
    requestedFields = ['fullAddress', 'postalCode', 'mapsLink'];
  }

  const currentExplicitIntent = repairedIntent;

  if (!repairedIntent) {
    if (explicitNewEntity && priorIntent) {
      repairedIntent = priorIntent;
      targetDomain = state.activeDomain || 'general';
      requestedFields = state.requestedFields || [];
    } else {
      return { isRepair: false, reason: 'no_repair_content', repairSignal };
    }
  }

  const effectiveQuery = rawText;

  const resolvedEntityObj = explicitNewEntity || (state.activeEntity ? state.activeEntity : (resolvedEntity ? { type: resolvedEntityType, canonical: resolvedEntity } : null));

  return {
    isRepair: true,
    reason: 'context_repair_applied',
    repairMarker: marker,
    repairClause,
    rejectedClause,
    priorEntity,
    currentExplicitEntity,
    resolvedEntity,
    activeEntity: resolvedEntityObj,
    priorIntent,
    currentExplicitIntent,
    repairedIntent,
    requestedFields,
    effectiveQuery,
    targetDomain,
    correctionTarget: {
      previousEntity: priorEntity,
      correctedEntity: currentExplicitEntity || (resolvedEntityObj ? resolvedEntityObj.canonical : resolvedEntity)
    }
  };
}

/**
 * Unified Semantic Authority Resolution Function (Phase 7A).
 * Consolidates all inheritance and authority decisions in one place with strict priority:
 *
 * CURRENT_EXPLICIT_DOMAIN_OR_INTENT
 * >
 * CURRENT_EXPLICIT_ENTITY
 * >
 * EXPLICIT_CORRECTION
 * >
 * VALID_RELATIONAL_FOLLOWUP
 * >
 * COMPATIBLE_FRESH_VERIFIED_CONTEXT
 * >
 * NO_INHERITANCE
 *
 * @param {string|object} currentTurnInput Raw query string or understanding/contract object
 * @param {object} priorSessionOrState Session data or conversationState
 * @param {object} [options]
/**
 * Unified Semantic Authority Resolution Function (Phase 7A).
 * Consolidates all inheritance and authority decisions in one place with strict priority:
 *
 * CURRENT_EXPLICIT_DOMAIN_OR_INTENT
 * >
 * CURRENT_EXPLICIT_ENTITY
 * >
 * EXPLICIT_CORRECTION
 * >
 * VALID_RELATIONAL_FOLLOWUP
 * >
 * COMPATIBLE_FRESH_VERIFIED_CONTEXT
 * >
 * NO_INHERITANCE
 *
 * @param {string|object} currentTurnInput Raw query string or understanding/contract object
 * @param {object} priorSessionOrState Session data or conversationState
 * @param {object} [options]
 * @returns {object} Authority resolution decision
 */
function resolveSemanticAuthority(currentTurnInput, priorSessionOrState, options = {}) {
  const now = options.now || Date.now();
  const state = normalizeConversationState(priorSessionOrState, now);
  const isFresh = isConversationStateFresh(state, now, options.maxAgeMs);

  const rawText = typeof currentTurnInput === 'string'
    ? currentTurnInput
    : String((currentTurnInput && (currentTurnInput.userQuery || currentTurnInput.rawQuery || currentTurnInput.text || currentTurnInput.question)) || '').trim();

  const understanding = (typeof currentTurnInput === 'object' && currentTurnInput)
    ? (currentTurnInput.canonicalUnderstanding || currentTurnInput.understanding || currentTurnInput)
    : (options.canonicalUnderstanding || options.understanding || null);
  const contract = (typeof currentTurnInput === 'object' && currentTurnInput)
    ? (currentTurnInput.canonicalContract || currentTurnInput.semanticContract || currentTurnInput.contract || null)
    : (options.canonicalContract || options.semanticContract || options.contract || null);

  const currentDomain = String(
    understanding?.domain?.primary ||
    understanding?.domain ||
    contract?.domain ||
    ''
  ).toLowerCase();
  const hasExplicitDomain = Boolean(currentDomain && currentDomain !== 'general' && currentDomain !== 'unknown');

  const currentIntent = String(
    understanding?.intent?.primary ||
    understanding?.intent ||
    contract?.intent ||
    ''
  ).toLowerCase();
  const hasExplicitIntent = Boolean(currentIntent && currentIntent !== 'general' && currentIntent !== 'unknown');

  const candidateEntity = extractCandidateEntity(understanding, rawText);
  const hasExplicitEntity = Boolean(candidateEntity);

  // Authority Tier 0: EXPLICIT_CORRECTION
  // Correction can recover EVEN IF the prior turn was invalid/unverified (Requirement 7).
  // Must be checked FIRST before an explicit domain switch drops context.
  const repair = detectContextRepair(understanding || rawText, state, { rawText, now, maxAgeMs: options.maxAgeMs });
  if (repair && repair.isRepair && repair.effectiveQuery) {
    return {
      authority: 'EXPLICIT_CORRECTION',
      decision: 'context_repair',
      isInherited: true,
      effectiveQuery: repair.effectiveQuery,
      targetDomain: repair.targetDomain,
      targetIntent: repair.repairedIntent,
      targetEntity: repair.activeEntity || (repair.resolvedEntity ? { canonical: repair.resolvedEntity } : null),
      inheritedSlots: {
        entity: repair.activeEntity,
        intent: repair.repairedIntent,
        requestedFields: repair.requestedFields
      },
      details: repair
    };
  }

  // Check if current turn is an entity-compatible domain switch on the same entity
  const priorEntityType = state.activeEntity?.type;
  const isCompatibleDomainSwitchOnSameEntity = Boolean(
    isFresh &&
    state.activeEntity &&
    priorEntityType &&
    currentDomain &&
    ENTITY_TYPE_DOMAIN_COMPATIBILITY[priorEntityType]?.has(currentDomain) &&
    !hasExplicitEntity
  );

  // Authority Tier 1: CURRENT_EXPLICIT_DOMAIN_OR_INTENT
  // Standalone explicit domain/intent only applies if user supplied a new entity or the domain switch is incompatible with prior entity
  const hasIntentCues = hasSubstantiveStandaloneIntent(understanding, rawText);
  const isStandaloneIntentWithEntity = hasIntentCues && hasExplicitEntity;
  const isIncompatibleDomainSwitch = hasExplicitDomain && state.activeDomain && currentDomain !== state.activeDomain && !isCompatibleDomainSwitchOnSameEntity;

  if (isStandaloneIntentWithEntity || (isIncompatibleDomainSwitch && !isCompatibleDomainSwitchOnSameEntity)) {
    return {
      authority: 'CURRENT_EXPLICIT_DOMAIN_OR_INTENT',
      decision: 'standalone_explicit',
      isInherited: false,
      effectiveQuery: rawText,
      targetDomain: hasExplicitDomain ? currentDomain : null,
      targetIntent: hasExplicitIntent ? currentIntent : null,
      targetEntity: candidateEntity || null,
      inheritedSlots: {},
      details: {
        hasExplicitDomain,
        hasExplicitIntent,
        hasExplicitEntity,
        candidateEntity,
        currentDomain,
        currentIntent
      }
    };
  }

  // Authority Tier 2: CURRENT_EXPLICIT_ENTITY
  const sub = detectEntitySubstitution(understanding || rawText, state, { rawText, now, maxAgeMs: options.maxAgeMs });
  if (sub && sub.isSubstitution && sub.effectiveQuery) {
    return {
      authority: 'CURRENT_EXPLICIT_ENTITY',
      decision: 'entity_substitution',
      isInherited: true,
      effectiveQuery: sub.effectiveQuery,
      targetDomain: sub.inheritedDomain,
      targetIntent: sub.inheritedIntent,
      targetEntity: sub.newEntity,
      inheritedSlots: {
        entity: sub.newEntity,
        domain: sub.inheritedDomain,
        intent: sub.inheritedIntent,
        requestedFields: sub.inheritedRequestedFields
      },
      details: sub
    };
  }

  // Authority Tier 4: VALID_RELATIONAL_FOLLOWUP
  const rel = detectRelationalFollowUp(understanding || rawText, state, { rawText, now, maxAgeMs: options.maxAgeMs });
  if (rel && rel.isRelationalFollowup && rel.effectiveQuery) {
    return {
      authority: 'VALID_RELATIONAL_FOLLOWUP',
      decision: 'relational_followup',
      isInherited: true,
      effectiveQuery: rel.effectiveQuery,
      targetDomain: rel.targetDomain,
      targetIntent: state.activeIntent,
      targetEntity: rel.activeEntity || rel.resolvedEntity,
      inheritedSlots: {
        entity: rel.activeEntity || rel.resolvedEntity,
        relation: rel.inheritedRelation,
        requestedFields: rel.requestedFields
      },
      details: rel
    };
  }

  // Authority Tier 5: COMPATIBLE_FRESH_VERIFIED_CONTEXT
  // Requires fresh prior state AND prior state is verified authority (state.isVerified === true && state.promotable === true && !state.legacyUnverified)
  const isVerifiedAuthority = state.isVerified === true && state.promotable === true && !state.legacyUnverified;
  const comp = isCompatibleContextInheritance(understanding || { rawQuery: rawText, domain: currentDomain, intent: currentIntent }, state, { now, maxAgeMs: options.maxAgeMs });
  if (isFresh && isVerifiedAuthority && comp.compatible) {
    const inheritedEntity = comp.inheritedSlots?.entity || state.activeEntity;
    const shouldAppendEntity = Boolean(
      inheritedEntity &&
      inheritedEntity.canonical &&
      !rawText.toLowerCase().includes(inheritedEntity.canonical.toLowerCase())
    );
    const effectiveQuery = shouldAppendEntity
      ? `${rawText} untuk ${inheritedEntity.canonical}`
      : rawText;
    return {
      authority: 'COMPATIBLE_FRESH_VERIFIED_CONTEXT',
      decision: 'compatible_context_inherited',
      isInherited: true,
      effectiveQuery,
      targetDomain: comp.inheritedSlots?.domain || state.activeDomain,
      targetIntent: comp.inheritedSlots?.intent || state.activeIntent,
      targetEntity: comp.inheritedSlots?.entity || state.activeEntity,
      inheritedSlots: comp.inheritedSlots,
      details: comp
    };
  }

  // Authority Tier 6: NO_INHERITANCE
  return {
    authority: 'NO_INHERITANCE',
    decision: isFresh && !isVerifiedAuthority ? 'error_containment_blocked' : 'no_inheritance',
    isInherited: false,
    effectiveQuery: rawText,
    targetDomain: hasExplicitDomain ? currentDomain : null,
    targetIntent: hasExplicitIntent ? currentIntent : null,
    targetEntity: null,
    inheritedSlots: {},
    details: { isFresh, isVerifiedAuthority, compReason: comp.reason }
  };
}

module.exports = {
  createEmptyConversationState,
  normalizeConversationState,
  isConversationStateFresh,
  isCompatibleContextInheritance,
  mergeConversationState,
  invalidateIncompatibleContext,
  getContextDecayMs,
  DEFAULT_CONTEXT_DECAY_MS,
  ENTITY_INTENT_COMPATIBILITY,
  extractCandidateEntity,
  hasSubstantiveStandaloneIntent,
  ENTITY_TYPE_DOMAIN_COMPATIBILITY,
  buildEffectiveSubstitutedQuery,
  detectEntitySubstitution,
  createStructuredRelation,
  hasRelationalFollowUpCues,
  detectRelationalFollowUp,
  parseContextRepairSignal,
  detectContextRepair,
  buildTurnConversationState,
  isEntityCompatibleWithDomain,
  inferDomainFromIntent,
  resolveSemanticAuthority,
  DOMAIN_FIELD_COMPATIBILITY,
  isFieldCompatibleWithDomain,
  isFieldCompatibleWithEntity,
  filterCompatibleFields
};
