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
  const raw = String(rawQuery || '').trim();
  const normalizedInfo = normalizeUserQuery(raw);
  const normalizedQuery = normalizedInfo?.normalizedText || raw.toLowerCase();

  // Step 1: Upstream Raw Feature Extraction
  const understanding = buildCanonicalQueryUnderstanding(raw, { normalizedQuery });
  const numericSemantics = extractNumericSemantics(raw);

  // Step 2: Current Query Explicit Semantic Resolution
  const rawExplicitEntities = [];
  const groups = ['programs', 'campuses', 'facilities', 'organizations', 'internationalPrograms', 'services', 'scholarships', 'admissionTracks', 'participantScopes', 'academicScopes', 'documents'];
  for (const group of groups) {
    if (Array.isArray(understanding.entities?.[group])) {
      for (const ent of understanding.entities[group]) {
        if (!ent || typeof ent !== 'object' || !ent.canonical) continue;
        const isSyntheticRegistry = /^(?:canonical-domain-scope|canonical-interest-registry)$/.test(String(ent.source || ''));
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

  // 3b. Compatible prior context inheritance from session
  const priorSessionOrState = options.sessionState
    || (options.sessionData && (options.sessionData.sessionState || options.sessionData.conversationState || options.sessionData.state))
    || options.sessionData
    || options.session
    || null;

  const sessionState = normalizeConversationState(priorSessionOrState);
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

    // Rule: Inheritance fills missing compatible dimensions only. Never overwrite explicit current entity!
    if (isEntityFamilyCompatibleWithDomain(priorFam, domain.primary)) {
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
  academic_policy: new Set(['procedure', 'academic_policy', 'academic_curriculum', 'certification', 'academic_qualification']),
  academic: new Set(['procedure', 'academic_curriculum', 'academic_quality', 'academic_policy', 'academic_qualification']),
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
    ambiguity: understanding.ambiguity || {},
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
