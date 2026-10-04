'use strict';

/**
 * semanticFrameResolver.js
 *
 * Central Authority for Semantic Resolution.
 *
 * Enforces the strict resolution hierarchy:
 * CURRENT EXPLICIT > COMPATIBLE MESSAGE-LOCAL > COMPATIBLE PRIOR CONTEXT > UNKNOWN
 *
 * Invariants:
 * 1. ONE authoritative semantic representation (SemanticFrame).
 * 2. Inheritance fills missing compatible dimensions only; NEVER overwrites explicit current semantics.
 * 3. Specific requested field outranks generic parent family (SPECIFIC_FIELD > FIELD_FAMILY).
 * 4. Freezes EffectiveSemanticFrame before downstream retrieval and routing.
 */

const { normalizeUserQuery } = require('../utils/queryNormalizer');
const { buildCanonicalQueryUnderstanding, detectFeeType } = require('./queryUnderstanding');
const {
  normalizeConversationState,
  isConversationStateFresh,
  filterCompatibleFields
} = require('./conversationStateEngine');
const {
  PROVENANCE,
  normalizeEntityFamily,
  getFieldDescriptor,
  rankRequestedFields,
  createSemanticFrame
} = require('./semanticFrame');

/**
 * Domain-to-entity-family compatibility map.
 */
const DOMAIN_ENTITY_FAMILY_COMPATIBILITY = Object.freeze({
  student_organization: new Set(['organization']),
  organization: new Set(['organization']),
  career: new Set(['program', 'campus_service']),
  program_curriculum: new Set(['program']),
  program: new Set(['program']),
  academic: new Set(['program', 'academic_scope']),
  academic_policy: new Set(['program', 'academic_scope', 'admission_track']),
  accreditation: new Set(['program', 'institution']),
  s2_postgraduate: new Set(['program']),
  fee: new Set(['program', 'international_program', 'admission_track']),
  double_degree: new Set(['international_program', 'program']),
  international_program: new Set(['international_program', 'program']),
  foreign_student_admin: new Set(['participant_scope', 'international_program']),
  campus_facility: new Set(['facility', 'campus_service', 'campus']),
  facility: new Set(['facility', 'campus_service', 'campus']),
  campus_location: new Set(['campus', 'facility']),
  campus: new Set(['campus']),
  scholarship: new Set(['scholarship', 'program']),
  pmb_schedule: new Set(['admission_track']),
  registration: new Set(['admission_track', 'program', 'participant_scope']),
  campus_contact: new Set(['campus', 'organization', 'program', 'campus_service']),
  institution_document: new Set(['document', 'academic_scope', 'institution']),
  document: new Set(['document', 'academic_scope', 'institution']),
  institution_comparison: new Set(['institution'])
});

/**
 * Checks whether an entity's normalized family is compatible with a given domain.
 *
 * @param {string} entityFamily
 * @param {string} domain
 * @returns {boolean}
 */
function isEntityFamilyCompatibleWithDomain(entityFamily, domain) {
  const normFam = normalizeEntityFamily(entityFamily);
  const normDom = String(domain || '').trim().toLowerCase();
  if (!normFam || !normDom || normDom === 'general' || normDom === 'unknown') {
    return true;
  }
  const allowed = DOMAIN_ENTITY_FAMILY_COMPATIBILITY[normDom];
  return allowed ? allowed.has(normFam) : true;
}

/**
 * Extracts and classifies numeric semantics from query text.
 * Prevents "berapa tahun" (duration) from being captured as fee amounts.
 *
 * @param {string} rawText
 * @returns {object}
 */
function extractNumericSemantics(rawText) {
  const q = String(rawText || '').toLowerCase();
  const semantics = {
    isDurationMetric: false,
    isFeeMetric: false,
    isCreditMetric: false,
    isCountMetric: false,
    extractedMetric: null
  };

  if (/\b(?:berapa\s+tahun|durasi(?:nya)?|lama(?:nya)?\s+(?:masa\s+)?(?:kuliah|studi)|skema\s+tahun|tahapan\s+tahun|semester\s+ke-?\s*\d)\b/i.test(q)) {
    semantics.isDurationMetric = true;
    semantics.extractedMetric = 'duration_years';
  } else if (/\b(?:berapa\s+sks|jumlah\s+sks|sks\s+maksimal|bobot\s+sks)\b/i.test(q)) {
    semantics.isCreditMetric = true;
    semantics.extractedMetric = 'credit_count';
  } else if (/\b(?:biaya|harga|tarif|uang\s+kuliah|spp|dpp|total\s+biaya|nominal|ukt)\b.*?\bberapa\b/i.test(q)
      || /\bberapa\b.*?\b(?:biaya|harga|tarif|uang|spp|dpp|ukt|nominal|rp\.?|rupiah|bayar|cicil|angsur)\b/i.test(q)) {
    semantics.isFeeMetric = true;
    semantics.extractedMetric = 'financial_amount';
  } else if (/\b(?:berapa\s+jumlah|jumlah\s+(?:ukm|organisasi|kampus|cabang|prodi|jurusan))\b/i.test(q)) {
    semantics.isCountMetric = true;
    semantics.extractedMetric = 'entity_count';
  }

  return semantics;
}

/**
 * Resolves the primary requested fields while enforcing specificity and disambiguating
 * metrics (e.g. duration vs fee).
 *
 * @param {string} rawText
 * @param {string[]} rawFields
 * @param {object} numericSemantics
 * @returns {string[]} Authoritative ranked requested fields
 */
function resolveAuthoritativeFields(rawText, rawFields, numericSemantics) {
  const q = String(rawText || '').toLowerCase();
  const fields = new Set(Array.isArray(rawFields) ? rawFields : []);

  // Duration specificity
  if (numericSemantics && numericSemantics.isDurationMetric) {
    fields.add('duration');
    fields.delete('fee');
    fields.delete('amount');
    fields.delete('tuitionFee');
  }

  // Certification specificity (CRT-02 invariant)
  if (/\b(?:sertifikat|sertifikasi)\b/i.test(q)) {
    fields.add('certification');
    if (/\b(?:kompetensi|keahlian|bnsp|profesi)\b/i.test(q)) {
      fields.add('competencyCertification');
    }
    if (/\b(?:vendor|internasional|cisco|mikrotik|oracle)\b/i.test(q)) {
      fields.add('vendorCertifications');
    }
  }

  // Fee specificity
  if (numericSemantics && numericSemantics.isFeeMetric) {
    fields.add('fee');
  }

  // Accreditation specificity
  if (/\b(?:akreditasi|peringkat\s+akreditasi|ban\s*-?pt|lam\s*infokom)\b/i.test(q)) {
    fields.add('accreditation');
  }

  // Instagram specificity (PAR-09 invariant)
  if (/\b(?:instagram|ig)\b/i.test(q)) {
    fields.add('instagram');
    if (!/\b(?:wa|whatsapp|telepon|telp|no\s+hp|hotline|nomor|call|hubungi)\b/i.test(q)) {
      fields.delete('phone');
    }
    if (!/\b(?:email|surel)\b/i.test(q)) {
      fields.delete('email');
    }
  } else if (/\b(?:tiktok)\b/i.test(q)) {
    fields.add('tiktok');
  } else if (/\b(?:email|surel)\b/i.test(q)) {
    fields.add('email');
  } else if (/\b(?:wa|whatsapp|telepon|telp|no\s+hp|hotline)\b/i.test(q)) {
    fields.add('phone');
  }

  // Geographic / Program Destination specificity (GEOGRAPHIC_DESTINATION != DOCUMENT_PURPOSE)
  const isGeographicDestination = /\b(?:negara\s+tujuan|tujuan\s+negara|destinasi(?:\s+program)?|ke\s+negara\s+mana|negara\s+partner|negara\s+pertukaran|negara\s+mitra)\b/i.test(q);
  const isExplicitDocumentPurpose = /\b(?:tujuan\s+(?:dokumen|surat|form(?:ulir)?|pedoman|laporan|sk)|fungsi\s+(?:dokumen|surat|form(?:ulir)?|pedoman|laporan)|dokumen\s+ini\s+untuk\s+apa|maksud\s+formulir|kegunaan\s+(?:surat|form|pedoman))\b/i.test(q);

  if (isGeographicDestination) {
    fields.add('studyLocation');
    fields.add('country');
    fields.add('destinationCountry');
    if (!isExplicitDocumentPurpose) {
      fields.delete('documentPurpose');
      fields.delete('purpose');
    }
  } else if (isExplicitDocumentPurpose || (/\b(?:tujuan|maksud|fungsi)\b/i.test(q) && !isGeographicDestination)) {
    fields.add('documentPurpose');
    fields.add('purpose');
  }

  // Comparative Contrast specificity (Generic comparative intent)
  if (/\b(?:sama(?:\s+dengan)?|setara(?:\s+dengan)?|beda(?:nya)?|perbedaan|bandingkan|dibandingkan)\b/i.test(q)) {
    fields.add('contrast');
  }

  // SKTT administrative document specificity
  if (/\bsktt\b/i.test(q)) {
    fields.add('sktt');
  }

  // International experience / Global program specificity
  if (/\b(?:pengalaman\s+internasional|program\s+internasional|international\s+(?:program|experience)|student\s+exchange|pertukaran\s+(?:mahasiswa|pelajar)|studi\s+(?:ke\s+)?luar\s+negeri|study\s+abroad|kelas\s+internasional|jalur\s+internasional)\b/i.test(q)) {
    fields.add('internationalExperience');
  }

  if (/\b(?:alamat|lokasi|di\s+mana|dimana)\b/i.test(q)) {
    fields.add('location');
  }

  if (/\b(?:universitas\s+mana|mitra|partner)\b/i.test(q)) {
    fields.add('partner');
  }

  return rankRequestedFields(Array.from(fields));
}

/**
 * Resolves an authoritative EffectiveSemanticFrame for a query turn.
 *
 * @param {string} rawQuery User raw input
 * @param {object} [options]
 * @param {object} [options.sessionState] Prior conversation state
 * @param {object} [options.localContext] Message-local context from decomposer
 * @returns {object} Frozen EffectiveSemanticFrame
 */
function resolveEffectiveSemanticFrame(rawQuery, options = {}) {
  options = options || {};
  const raw = String(rawQuery || '').trim();
  const normalizedInfo = normalizeUserQuery(raw);
  const normalizedQuery = normalizedInfo?.normalizedText || raw.toLowerCase();

  // Step 1: Upstream Raw Feature Extraction
  const understanding = buildCanonicalQueryUnderstanding(raw, { normalizedQuery, ...options });
  const numericSemantics = extractNumericSemantics(raw);

  // Step 2: Current Query Explicit Semantic Resolution
  const rawExplicitEntities = [];
  const groups = ['programs', 'campuses', 'facilities', 'organizations', 'internationalPrograms', 'services', 'scholarships', 'admissionTracks', 'participantScopes', 'academicScopes', 'documents'];
  for (const group of groups) {
    if (Array.isArray(understanding.entities?.[group])) {
      for (const ent of understanding.entities[group]) {
        if (!ent || typeof ent !== 'object' || !ent.canonical) continue;
        const isSyntheticRegistry = /^(?:canonical-domain-scope|canonical-interest-registry|compatible-inherited-entity|inherited-academic-slot|inherited-slot)$/.test(String(ent.source || ''));
        if (isSyntheticRegistry) continue;
        rawExplicitEntities.push({
          canonical: ent.canonical,
          type: ent.type || group,
          family: normalizeEntityFamily(ent.family || ent.type || group),
          role: ent.role,
          confidence: ent.confidence || 0.9,
          provenance: PROVENANCE.EXPLICIT_CURRENT,
          group
        });
      }
    }
  }

  let domain = understanding.domain ? { ...understanding.domain } : { primary: 'general', confidence: 0.5 };
  let intent = understanding.intent ? { ...understanding.intent } : { primary: 'ask_general', secondary: [], confidence: 0.5 };
  const requestedFields = resolveAuthoritativeFields(raw, understanding.requestedFields, numericSemantics);

  const slotProvenance = {
    intent: PROVENANCE.EXPLICIT_CURRENT,
    domain: PROVENANCE.EXPLICIT_CURRENT,
    entities: rawExplicitEntities.length > 0 ? PROVENANCE.EXPLICIT_CURRENT : PROVENANCE.UNKNOWN,
    requestedFields: requestedFields.length > 0 ? PROVENANCE.EXPLICIT_CURRENT : PROVENANCE.UNKNOWN,
    relations: PROVENANCE.EXPLICIT_CURRENT,
    constraints: PROVENANCE.EXPLICIT_CURRENT
  };

  // Domain authority corrections based on explicit fields (e.g. Certification must not become PMB)
  const isExplicitCertification = requestedFields.includes('certification') || requestedFields.includes('competencyCertification');
  if (isExplicitCertification) {
    if (domain.primary === 'general' || domain.primary === 'registration' || domain.primary === 'pmb_requirements') {
      domain.primary = 'academic_policy';
      domain.confidence = 0.85;
      slotProvenance.domain = PROVENANCE.DERIVED;
    }
  }

  // Duration authority corrections (Duration must not become Fee)
  if (numericSemantics.isDurationMetric) {
    if (domain.primary === 'fee') {
      domain.primary = 'academic_policy';
      slotProvenance.domain = PROVENANCE.DERIVED;
    }
  }

  // Fee metric authority: if explicit fee metric is present, resolve domain to fee
  if (numericSemantics.isFeeMetric) {
    domain.primary = 'fee';
    domain.confidence = 0.9;
    slotProvenance.domain = PROVENANCE.DERIVED;
  }

  // Facility / Location authority: normalize campus_location to campus_facility or admission
  if (domain.primary === 'campus_location') {
    if (/\b(?:pmb|pendaftaran|daftar)\b/i.test(raw)) {
      domain.primary = 'admission';
      domain.confidence = 0.85;
      slotProvenance.domain = PROVENANCE.DERIVED;
      if (!requestedFields.includes('location')) requestedFields.push('location');
      if (!requestedFields.includes('procedureSteps')) requestedFields.push('procedureSteps');
    } else {
      domain.primary = 'campus_facility';
      domain.confidence = 0.85;
      slotProvenance.domain = PROVENANCE.DERIVED;
      if (!requestedFields.includes('location')) requestedFields.push('location');
    }
  }

  // Institution metadata authority (founding date, dies natalis, anniversary): primary domain is general
  if (domain.primary === 'institution_profile') {
    domain.primary = 'general';
    domain.confidence = 0.85;
    slotProvenance.domain = PROVENANCE.DERIVED;
  }

  // 3b. Compatible prior context inheritance from session
  const priorSessionOrState = options.sessionState
    || (options.sessionData && (options.sessionData.sessionState || options.sessionData.conversationState || options.sessionData.state))
    || options.sessionData
    || options.session
    || null;

  // Academic modality follow-up authority (e.g. "bisa untuk jurusan apa saja" when prior modality is active)
  const isPriorModalityActive = Boolean(
    priorSessionOrState?.studyModality ||
    priorSessionOrState?.deliveryMode ||
    priorSessionOrState?.activeModality ||
    options.sessionState?.studyModality ||
    options.sessionState?.deliveryMode ||
    options.sessionState?.activeModality ||
    /\b(?:online|offline|kelas\s+(?:malam|sore|karyawan))\b/i.test(priorSessionOrState?.rawSourceQuery || '')
  );
  if (domain.primary === 'program' && isPriorModalityActive) {
    domain.primary = 'academic';
    domain.confidence = 0.85;
    slotProvenance.domain = PROVENANCE.DERIVED;
    if (!requestedFields.includes('deliveryMode')) requestedFields.push('deliveryMode');
    if (!requestedFields.includes('curriculum')) requestedFields.push('curriculum');
  }

  // Step 3: Context Authority (Inheritance Hierarchy)
  // CURRENT EXPLICIT > COMPATIBLE MESSAGE-LOCAL > COMPATIBLE PRIOR CONTEXT > UNKNOWN
  const entities = [...rawExplicitEntities];
  const inheritedSemantics = { entities: [], fields: [], domain: null, intent: null };
  const explicitSemantics = {
    entities: rawExplicitEntities.map(e => e.canonical),
    fields: [...requestedFields],
    domain: domain.primary,
    intent: intent.primary
  };

  // 3a. Message-local inheritance from request decomposer (if present)
  const localAnchors = Array.isArray(options.localContext?.inheritedLocalAnchors)
    ? options.localContext.inheritedLocalAnchors
    : [];
  if (entities.length === 0 && localAnchors.length > 0) {
    for (const anchor of localAnchors) {
      if (!anchor || !anchor.canonical) continue;
      const fam = normalizeEntityFamily(anchor.family || anchor.type);
      if (isEntityFamilyCompatibleWithDomain(fam, domain.primary)) {
        const localEntity = {
          canonical: anchor.canonical,
          type: anchor.type || 'unknown',
          family: fam,
          confidence: Math.min(0.85, Number(anchor.confidence || 0.85)),
          provenance: PROVENANCE.MESSAGE_LOCAL_INHERITED,
          group: anchor.group
        };
        entities.push(localEntity);
        inheritedSemantics.entities.push(localEntity);
        slotProvenance.entities = PROVENANCE.MESSAGE_LOCAL_INHERITED;
        break; // Only inherit primary missing slot
      }
    }
  }

  let stateToNormalize = priorSessionOrState;
  if (priorSessionOrState && typeof priorSessionOrState === 'object') {
    if (!priorSessionOrState.updatedAt && !priorSessionOrState.lastSemanticContractUpdatedAt) {
      stateToNormalize = { ...priorSessionOrState, updatedAt: new Date(options.now || Date.now()).toISOString() };
    }
    // Also resolve program alias if activeEntity is not explicitly set
    if (!stateToNormalize.activeEntity && (stateToNormalize.program || stateToNormalize.prodi)) {
      const progName = stateToNormalize.program || stateToNormalize.prodi;
      stateToNormalize = {
        ...stateToNormalize,
        activeEntity: {
          canonical: progName,
          type: 'program',
          family: 'program',
          group: 'programs'
        }
      };
    } else if (typeof stateToNormalize.activeEntity === 'string' && stateToNormalize.activeEntity.trim()) {
      const { findCanonicalEntity } = require('./canonicalEntityRegistry');
      const eStr = stateToNormalize.activeEntity.trim();
      const canon = findCanonicalEntity(eStr);
      if (canon) {
        const isS1Variant = canon.degree === 'S1' && canon.canonical.startsWith('S1 ') && !eStr.toLowerCase().startsWith('s1 ');
        const finalCanon = isS1Variant ? eStr : canon.canonical;
        stateToNormalize = {
          ...stateToNormalize,
          activeEntity: {
            canonical: finalCanon,
            type: canon.type || (canon.family === 'student_organization' ? 'student_activity_unit' : 'program'),
            family: canon.family || (canon.group === 'programs' ? 'academic_program' : 'program'),
            group: canon.group || (canon.family === 'student_organization' ? 'organizations' : 'programs')
          }
        };
      }
    }
    if (stateToNormalize.legacyUnverified === undefined && (stateToNormalize.isVerified === undefined || stateToNormalize.isVerified === true)) {
      stateToNormalize.isVerified = true;
      stateToNormalize.promotable = true;
      stateToNormalize.legacyUnverified = false;
    }
  }

  const sessionState = normalizeConversationState(stateToNormalize);
  const isFresh = isConversationStateFresh(sessionState, options.now || Date.now(), options.maxAgeMs);
  const isVerifiedAuthority = Boolean(sessionState && sessionState.isVerified !== false && sessionState.promotable !== false && !sessionState.legacyUnverified);

  // Prior Grounded Candidate Resolution (when entities.length === 0)
  if (entities.length === 0 && isFresh && Array.isArray(sessionState.groundedEntityCandidates) && sessionState.groundedEntityCandidates.length > 0) {
    const matchingCandidates = [];
    for (const cand of sessionState.groundedEntityCandidates) {
      if (!cand || !cand.canonical) continue;
      const fam = normalizeEntityFamily(cand.family || cand.type);
      if (!isEntityFamilyCompatibleWithDomain(fam, domain.primary)) continue;

      const allSearchTerms = [
        ...(cand.matchedTerms || []),
        ...(cand.categories || []),
        cand.canonical
      ].filter(Boolean);

      const matchesQuery = allSearchTerms.some(term => {
        if (typeof term !== 'string' || term.trim().length < 3) return false;
        const re = new RegExp('\\b' + String(term.trim()).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
        return re.test(raw);
      });

      if (matchesQuery) {
        matchingCandidates.push(cand);
      }
    }

    if (matchingCandidates.length === 1) {
      const chosen = matchingCandidates[0];
      const inheritedEntity = {
        canonical: chosen.canonical,
        type: chosen.type || 'unknown',
        family: normalizeEntityFamily(chosen.family || chosen.type || 'organization'),
        confidence: Math.min(0.85, Number(chosen.confidence || 0.85)),
        provenance: PROVENANCE.PRIOR_CONTEXT_INHERITED,
        group: chosen.group || 'organizations'
      };
      entities.push(inheritedEntity);
      inheritedSemantics.entities.push(inheritedEntity);
      slotProvenance.entities = PROVENANCE.PRIOR_CONTEXT_INHERITED;
    }
  }

  if (entities.length === 0 && isFresh && isVerifiedAuthority && sessionState.activeEntity && sessionState.activeEntity.canonical) {
    const priorEntity = sessionState.activeEntity;
    const priorFam = normalizeEntityFamily(priorEntity.family || priorEntity.type);

    // Guard: If the query asks for definition of an explicit unresolved referent token (e.g., "apa itu X"),
    // do not inherit priorEntity unless the token matches priorEntity.
    const defTargetMatch = /\b(?:apa\s+itu|itu\s+apa|apaan|maksud(?:nya)?|pengertian|definisi|arti)\s+([a-z0-9_-]+)\b/i.exec(raw);
    let isConflictingDefTarget = false;
    if (defTargetMatch && defTargetMatch[1]) {
      const targetToken = defTargetMatch[1].toLowerCase().trim();
      const priorCanon = String(priorEntity.canonical || '').toLowerCase().trim();
      const priorCode = String(priorEntity.code || '').toLowerCase().trim();
      const priorAliases = Array.isArray(priorEntity.aliases) ? priorEntity.aliases.map(a => String(a).toLowerCase().trim()) : [];
      const matchesPrior = priorCanon === targetToken || priorCanon.includes(targetToken) || priorCode === targetToken || priorAliases.includes(targetToken);
      if (!matchesPrior) {
        isConflictingDefTarget = true;
      }
    }

    // Rule: Inheritance fills missing compatible dimensions only. Never overwrite explicit current entity!
    const isAcademicScheduleOrProcedure = domain.primary === 'academic'
      && (understanding.constraints?.academicTopic === 'academic_schedule' || understanding.constraints?.academicTopic === 'academic_procedure' || /\b(?:wisuda|yudisium|sidang|krs|remedial)\b/i.test(raw));
    const isIncompatibleProgramOnAcademicEvent = isAcademicScheduleOrProcedure && (priorFam === 'program' || priorFam === 'international_program');
    if (!isConflictingDefTarget && !isIncompatibleProgramOnAcademicEvent && isEntityFamilyCompatibleWithDomain(priorFam, domain.primary)) {
      const inheritedEntity = {
        canonical: priorEntity.canonical,
        type: priorEntity.type || 'unknown',
        family: priorFam,
        confidence: Math.min(0.8, Number(priorEntity.confidence || 0.8)),
        provenance: PROVENANCE.PRIOR_CONTEXT_INHERITED,
        group: priorEntity.group
      };
      entities.push(inheritedEntity);
      inheritedSemantics.entities.push(inheritedEntity);
      slotProvenance.entities = PROVENANCE.PRIOR_CONTEXT_INHERITED;
    }
  }

const DOMAIN_FIELD_FAMILY_COMPATIBILITY = Object.freeze({
  foreign_student_admin: new Set(['procedure', 'governance', 'geographic_destination']),
  academic_policy: new Set(['procedure', 'academic_policy', 'academic_curriculum', 'certification', 'academic_qualification', 'temporal_schedule', 'temporal_duration', 'sequence']),
  academic: new Set(['procedure', 'academic_curriculum', 'academic_quality', 'academic_policy', 'academic_qualification', 'temporal_schedule', 'temporal_duration', 'location', 'sequence', 'partner']),
  registration: new Set(['procedure', 'fee']),
  scholarship: new Set(['procedure', 'financial_aid', 'fee']),
  student_organization: new Set(['procedure', 'organization_identity', 'organization_classification', 'organization_inventory']),
  career: new Set(['procedure', 'career']),
  fee: new Set(['fee', 'financial', 'financial_aid'])
});

function areRequestedFieldsCompatibleWithDomain(fields, domain) {
  if (!fields || !fields.length) return true;
  const normDom = String(domain || '').trim().toLowerCase();
  const allowedFamilies = DOMAIN_FIELD_FAMILY_COMPATIBILITY[normDom];
  for (const field of fields) {
    const desc = getFieldDescriptor(field);
    const family = desc?.family || 'unknown';
    const root = desc?.root || 'unknown';
    if (family === 'procedure' || root === 'procedure') {
      if (allowedFamilies && !allowedFamilies.has('procedure')) return false;
      continue;
    }
    if (allowedFamilies && !allowedFamilies.has(family)) {
      return false;
    }
    if ((family === 'fee' || root === 'financial') && !['fee', 'registration', 'scholarship'].includes(normDom)) {
      return false;
    }
    if ((family === 'career' || root === 'career') && normDom !== 'career') {
      return false;
    }
    if ((family === 'organization_inventory' || root === 'organization') && !['student_organization', 'organization'].includes(normDom)) {
      return false;
    }
  }
  return true;
}

  // Prior context domain & intent inheritance for entity-substitution and compatible procedural follow-ups
  const isCurrentDomainUnresolved = domain.primary === 'general' || domain.primary === 'unknown' || !domain.primary;
  if (isCurrentDomainUnresolved && isFresh && isVerifiedAuthority && sessionState.activeDomain && sessionState.activeDomain !== 'general' && sessionState.activeDomain !== 'unknown') {
    const candidateFam = entities.length > 0 ? normalizeEntityFamily(entities[0].family || entities[0].type) : null;
    const isEntityCompatible = !candidateFam || isEntityFamilyCompatibleWithDomain(candidateFam, sessionState.activeDomain);
    const areFieldsCompatible = areRequestedFieldsCompatibleWithDomain(requestedFields, sessionState.activeDomain);

    const hasFollowUpSignal = requestedFields.length === 0
      || /\b(?:tersebut|itu|tadi|dokumen(?:nya)?|persyaratan(?:nya)?|syarat(?:nya)?|berkas(?:nya)?|langkah(?:nya)?|alur(?:nya)?|cara(?:nya)?|proses(?:nya)?|pengajuan|alur|tahap|prosedur|bagaimana|gimana|apa\s+saja)\b/i.test(raw)
      || (entities.length > 0 && slotProvenance.entities === PROVENANCE.PRIOR_CONTEXT_INHERITED);

    if (isEntityCompatible && areFieldsCompatible && hasFollowUpSignal) {
      domain.primary = sessionState.activeDomain;
      domain.confidence = 0.85;
      slotProvenance.domain = PROVENANCE.PRIOR_CONTEXT_INHERITED;
      inheritedSemantics.domain = sessionState.activeDomain;

      if (sessionState.activeIntent && (intent.primary === 'ask_general' || intent.primary === 'unknown' || intent.primary === 'ask_program')) {
        intent.primary = sessionState.activeIntent;
        intent.confidence = 0.85;
        slotProvenance.intent = PROVENANCE.PRIOR_CONTEXT_INHERITED;
        inheritedSemantics.intent = sessionState.activeIntent;
      }
    }
  }

  // Inherit compatible prior fields if current turn has NO explicit field and no explicit topic change
  if (requestedFields.length === 0 && isFresh && isVerifiedAuthority && Array.isArray(sessionState.requestedFields)) {
    const compatibleFields = filterCompatibleFields(sessionState.requestedFields, domain.primary, entities[0] || null);
    for (const f of compatibleFields) {
      if (!requestedFields.includes(f)) {
        requestedFields.push(f);
        inheritedSemantics.fields.push(f);
        slotProvenance.requestedFields = PROVENANCE.PRIOR_CONTEXT_INHERITED;
      }
    }
  }

  // Multi-intent detection & representation
  const secondaryIntents = new Set(Array.isArray(intent.secondary) ? intent.secondary : []);
  const asksFee = requestedFields.includes('tuitionFee') || requestedFields.includes('fee') || requestedFields.includes('amount') || numericSemantics.isFeeMetric || /\b(?:biaya|harga|bayar|ukt|dpp|spp|tarif)\b/i.test(raw);
  const asksModality = requestedFields.includes('deliveryMode') || requestedFields.includes('studyModality') || /\b(?:online|offline|daring|luring|hybrid)\b/i.test(raw);
  const asksSchedule = requestedFields.includes('schedule') || requestedFields.includes('eventExecution') || requestedFields.includes('date') || /\b(?:kapan|jadwal|tanggal|waktu|hari)\b/i.test(raw);
  const asksRequirements = requestedFields.includes('requirements') || /\b(?:syarat|persyaratan|dokumen|berkas)\b/i.test(raw);
  const asksCurriculum = requestedFields.includes('curriculum') || requestedFields.includes('courseList') || /\b(?:kurikulum|mata\s+kuliah|matakuliah|sks)\b/i.test(raw);
  const asksCareer = requestedFields.includes('careerProspects') || requestedFields.includes('jobRoles') || /\b(?:prospek|karir|karier|peluang\s+kerja)\b/i.test(raw);

  if (asksFee && asksModality) {
    if (intent.primary.includes('fee') || intent.primary === 'ask_tuition_fee' || intent.primary === 'ask_fee') {
      secondaryIntents.add('ask_delivery_mode');
    } else if (intent.primary.includes('delivery') || intent.primary === 'ask_delivery_mode') {
      secondaryIntents.add('ask_tuition_fee');
    } else {
      secondaryIntents.add('ask_delivery_mode');
    }
    if (!requestedFields.includes('deliveryMode')) requestedFields.push('deliveryMode');
    if (!requestedFields.includes('tuitionFee') && !requestedFields.includes('fee') && !requestedFields.includes('amount')) requestedFields.push('tuitionFee');
  }

  if (asksSchedule && asksRequirements) {
    if (/schedule/i.test(intent.primary)) {
      secondaryIntents.add('ask_academic_requirement');
    } else if (/requirement/i.test(intent.primary)) {
      secondaryIntents.add('ask_academic_schedule');
    }
  }

  if (asksCurriculum && asksCareer) {
    if (/curriculum/i.test(intent.primary)) {
      secondaryIntents.add('ask_career_service');
    } else if (/career/i.test(intent.primary)) {
      secondaryIntents.add('ask_program_curriculum');
    }
  }

  intent.secondary = Array.from(secondaryIntents);

  // Extract Temporal Constraint
  const hasHistoricalCue = /\b(?:tahun\s+lalu|kemarin|dulu|sebelumnya|yang\s+lalu|lampau)\b/i.test(raw);
  const yearMatch = raw.match(/\b(20[12][0-9])\b/);
  const explicitYear = yearMatch ? parseInt(yearMatch[1], 10) : null;
  const isPastYear = explicitYear && explicitYear < 2026;
  const isFutureYear = explicitYear && explicitYear > 2026;
  const isCurrentYear = explicitYear === 2026;

  const hasFutureCue = /\b(?:nanti|akan\s+datang|depan|mendatang)\b/i.test(raw);
  const hasCurrentCue = /\b(?:sekarang|saat\s+ini|ini|terkini|terbaru|saat\s+sekarang)\b/i.test(raw);

  const isHistorical = Boolean(hasHistoricalCue || isPastYear);
  const isFuture = Boolean(!isHistorical && (hasFutureCue || isFutureYear));
  const isCurrent = Boolean(!isHistorical && !isFuture && (hasCurrentCue || isCurrentYear || understanding.constraints?.academicPeriod));

  const periodMatch = raw.match(/\b(202[0-9](?:\/202[0-9]|[-/]\d{2,4})?(?:\s+(?:ganjil|genap))?)\b/i);
  const period = periodMatch ? periodMatch[1] : (understanding.constraints?.academicPeriod || null);

  const temporalConstraint = {
    temporalMode: isHistorical ? 'past' : (isFuture ? 'future' : (isCurrent ? 'current' : 'general')),
    period,
    academicYear: explicitYear || (period ? parseInt(period.slice(0, 4), 10) : (isCurrent ? 2026 : null)),
    isHistorical
  };

  // Extract Location
  const hasBandung = /\bbandung\b/i.test(raw);
  const hasRenon = /\brenon\b/i.test(raw);
  const hasJimbaran = /\bjimbaran\b/i.test(raw);
  const hasAbiansemal = /\babiansemal\b/i.test(raw);
  const hasMalaysia = /\bmalaysia\b/i.test(raw);
  const hasChina = /\b(?:china|tiongkok)\b/i.test(raw);

  const studyLocation = hasBandung ? 'Bandung' : (hasRenon ? 'Renon' : (hasJimbaran ? 'Jimbaran' : (hasAbiansemal ? 'Abiansemal' : (understanding.constraints?.studyLocation || null))));
  const campus = hasRenon ? 'Kampus Renon' : (hasJimbaran ? 'Kampus Jimbaran' : (hasAbiansemal ? 'Kampus Abiansemal' : (understanding.constraints?.campus || null)));
  const country = hasMalaysia ? 'Malaysia' : (hasChina ? 'China' : (understanding.constraints?.country || null));

  const isLocationAmbiguous = Boolean(understanding.ambiguity?.isAmbiguous && understanding.ambiguity?.type === 'location_program_overlap');

  const location = {
    studyLocation,
    campus,
    country,
    isAmbiguous: isLocationAmbiguous
  };

  // Extract Context Relation
  const referentMatch = raw.match(/\b([a-z]+(?:nya))\b|\b(itu|tersebut)\b/i);
  const referentToken = referentMatch ? referentMatch[0] : null;
  const isFollowupCue = /\b(?:kalau|kalo|gimana|bagaimana|terus|lalu|jika|apakah|bisa)\b/i.test(raw);
  const isInherited = slotProvenance.entities === PROVENANCE.PRIOR_CONTEXT_INHERITED || slotProvenance.domain === PROVENANCE.PRIOR_CONTEXT_INHERITED;

  const hasUnresolvedAnaphora = entities.length === 0 && (
    /\b(?:jurusan|prodi|program|fakultas|kampus|ukm)\s+(?:itu|tersebut|tadi)\b/i.test(raw) ||
    /\b(?:masuk|daftar|kuliah\s+di|biaya|syarat)\s+(?:jurusan|prodi|program)\s+(?:itu|tersebut)\b/i.test(raw)
  );

  let ambiguity = understanding.ambiguity || {};
  if (hasUnresolvedAnaphora) {
    ambiguity = { isAmbiguous: true, reason: 'unresolved_anaphoric_reference' };
  }

  const contextRelation = {
    isFollowup: Boolean(isFollowupCue || referentToken || isInherited),
    referentToken,
    inheritedEntities: inheritedSemantics.entities.map(e => e.canonical),
    inheritedDomain: inheritedSemantics.domain || (slotProvenance.domain === PROVENANCE.PRIOR_CONTEXT_INHERITED ? domain.primary : null)
  };

  // Step 4: Construct and Freeze EffectiveSemanticFrame
  const frame = createSemanticFrame({
    rawQuery: raw,
    normalizedQuery,
    intent,
    domain,
    entities,
    requestedFields,
    relations: understanding.constraints?.structuredRelation
      ? [understanding.constraints.structuredRelation]
      : (understanding.constraints?.relationType ? [understanding.constraints.relationType] : []),
    constraints: understanding.constraints || {},
    numericSemantics,
    explicitSemantics,
    inheritedSemantics,
    temporalConstraint,
    location,
    contextRelation,
    ambiguity,
    confidence: Math.min(intent.confidence, domain.confidence),
    provenance: slotProvenance,
    questionType: understanding.questionType,
    answerExpectation: understanding.answerExpectation,
    routingQuery: understanding.routingQuery || normalizedQuery
  });

  return frame;
}

module.exports = {
  isEntityFamilyCompatibleWithDomain,
  extractNumericSemantics,
  resolveAuthoritativeFields,
  resolveEffectiveSemanticFrame
};
