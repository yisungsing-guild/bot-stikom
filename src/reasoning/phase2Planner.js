'use strict';

/**
 * src/reasoning/phase2Planner.js
 * 
 * Phase 2 Initial Planning Layer (Step 1 Implementation).
 * 
 * Invariants:
 * 1. Derives execution plans with strict validation from contracts.js.
 * 2. Rejects invalid plans and prevents unsupported factual claims from entering the plan.
 * 3. Ambiguity policy:
 *    - If sessionData has activeEntity: INHERIT CONTEXT.
 *    - If sessionData lacks activeEntity and query requires program disambiguation:
 *      AMBIGUOUS_CLARIFICATION with authoritative options from canonical registry.
 * 4. Preserves verified entity and context fields from Phase 1 without mutation.
 */

const {
  PLAN_TYPE,
  ENTITY_PROVENANCE,
  getAuthoritativeProgramOptions,
  validateExecutionPlan
} = require('./contracts');
const { resolveSemanticFrame, resolveSemanticFrameAsync } = require('../core/semanticFrameResolver');
const { CANONICAL_ENTITIES, findCanonicalEntity } = require('../engine/canonicalEntityRegistry');
const { computeContextDelta } = require('./contextRepair');
const { buildCanonicalQueryUnderstanding } = require('../engine/queryUnderstanding');
const { detectProgramFitSignals, isBroadSchoolBackgroundWithoutSpecificPreference } = require('../engine/programFitReasoning');
const { normalizeQueryForSignals } = require('./recommendationEngine');

let resolveOpenWorldEntity = null;
try {
  ({ resolveOpenWorldEntity } = require('../core/openWorldEntityResolver'));
} catch (_) {}

// Queries that require a specific program entity to give an accurate answer
const AMBIGUITY_INDUCING_INTENTS = new Set([
  'TUITION_FEE',
  'ACADEMIC_CURRICULUM',
  'ACADEMIC_PROGRAM',
  'ADMISSION_REQUIREMENTS'
]);

/**
 * Detects mention of academic programs not offered by ITB STIKOM Bali.
 * Uses validated AI semantic interpretation and canonical registry lookup,
 * without regex heuristics or hardcoded question patterns.
 */
function isExplicitUnsupportedProgram(rawQuery, semanticFrame = {}) {
  if (semanticFrame) {
    if (semanticFrame.unsupportedEntityName || semanticFrame.unsupportedProgramName) {
      return semanticFrame.unsupportedEntityName || semanticFrame.unsupportedProgramName;
    }
    if (semanticFrame.unsupportedEntity || semanticFrame.isUnsupportedEntity) {
      return semanticFrame.unsupportedEntityName || semanticFrame.unsupportedProgramName || 'tersebut';
    }
    if (semanticFrame.unconfirmedProgram) {
      return semanticFrame.unconfirmedProgram;
    }
  }

  const hasSupportedProgram = (semanticFrame?.entities || []).some(
    e => e.family === 'academic_program' || e.family === 'international_program'
  );
  if (hasSupportedProgram) return null;

  // Check candidate mentions from validated interpretation
  const candidateEntities = Array.isArray(semanticFrame?.candidateEntities) ? semanticFrame.candidateEntities : [];
  for (const cand of candidateEntities) {
    const mention = typeof cand === 'string' ? cand : (cand?.rawMention || cand?.canonical || cand?.mention);
    const category = cand?.inferredCategory;
    if (mention && (category === 'academic_program' || category === 'discipline')) {
      const known = findCanonicalEntity(mention);
      if (!known) {
        return mention;
      }
    }
  }

  // Check linguistic discipline patterns if no supported entity
  const qStr = semanticFrame?.rawQuery || rawQuery;
  if (qStr && typeof qStr === 'string') {
    const { detectUnsupportedProgram, detectUnconfirmedProgram } = require('../core/semanticFrameResolver');
    if (typeof detectUnsupportedProgram === 'function') {
      const detected = detectUnsupportedProgram(qStr, semanticFrame?.entities || []);
      if (detected) return detected;
    }
    if (typeof detectUnconfirmedProgram === 'function') {
      const unconfirmed = detectUnconfirmedProgram(qStr, semanticFrame?.entities || []);
      if (unconfirmed) return unconfirmed;
    }
  }

  return null;
}

/**
 * Detects whether a query is ambiguous and lacks an entity discriminator
 */
function isAmbiguousEntityInquiry(rawQuery, semanticFrame = {}) {
  if (isExplicitUnsupportedProgram(rawQuery, semanticFrame)) {
    return false;
  }
  if (semanticFrame?.unconfirmedProgram) {
    return false;
  }
  const candidateEntities = Array.isArray(semanticFrame?.candidateEntities) ? semanticFrame.candidateEntities : [];
  if (candidateEntities.some(c => (c.inferredCategory === 'academic_program' || c.inferredCategory === 'discipline') && (c.rawMention || c.canonical))) {
    return false;
  }

  const q = String(rawQuery || '').toLowerCase().trim();
  const allEntities = semanticFrame?.entities || [];
  // Primary target entities (exclude pure modifiers and academic events like Wisuda)
  const programEntities = allEntities.filter(e => e.family === 'academic_program' || e.family === 'international_program');
  const aspects = Array.isArray(semanticFrame?.aspects) ? semanticFrame.aspects : [];

  // If a specific academic program entity is present, it is not an ambiguous entity inquiry
  if (programEntities.length > 0) {
    return false;
  }

  // Institutional queries, general listings, academic advising, or greetings are not ambiguous
  if (semanticFrame) {
    if (semanticFrame.intent === 'AVAILABLE_PROGRAMS_LIST' ||
        semanticFrame.intent === 'GENERAL_PMB_INQUIRY' ||
        semanticFrame.intent === 'CURRENT_ENROLLMENT_STATUS' ||
        semanticFrame.intent === 'PAYMENT_CONFIRMATION_PROCEDURE' ||
        semanticFrame.intent === 'ACADEMIC_ADVISING_INQUIRY' ||
        semanticFrame.intent === 'INSTITUTIONAL_ACCREDITATION' ||
        semanticFrame.domain === 'ACADEMIC_PROCESS' ||
        semanticFrame.domain === 'INSTITUTIONAL' ||
        semanticFrame.domain === 'SCHOLARSHIP' ||
        semanticFrame.speechAct === 'GENERAL_GREETING') {
      return false;
    }
  }

  // Academic advising, perwalian, and E-KRS procedures are university-wide institutional processes
  if (/\b(?:perwalian|dosen\s+wali|bimbingan\s+perwalian|e-?krs|supportperwalian)\b/i.test(q)) {
    return false;
  }

  // RPL (Rekognisi Pembelajaran Lampau) is an institutional admission / credit-transfer route
  if (/\b(?:rpl|rekognisi\s+pembelajaran\s+lampau)\b/i.test(q)) {
    return false;
  }

  // Campus location and address inquiries are institutional (Renon, Jimbaran, Abiansemal)
  if (/\b(?:lokasi(?:\s+kampus)?|alamat(?:\s+kampus)?|di\s+mana\s+kampus(?:nya)?|letak\s+kampus|campus\s+location|where\s+is\s+(?:the\s+)?campus)\b/i.test(q)) {
    return false;
  }

  // Operational hours inquiries are institutional
  if (semanticFrame?.intent === 'OPERATIONAL_HOURS_INQUIRY' || /\b(?:jam|waktu)\s+(?:operasional|layanan|kerja|buka)\b/i.test(q)) {
    return false;
  }

  // Online lecture platform & application inquiries are campus-wide services
  if (semanticFrame?.intent === 'ONLINE_LEARNING_PLATFORM' ||
      (/\b(?:kuliah|perkuliahan)\b/i.test(q) && /\b(?:online|daring)\b/i.test(q) && /\b(?:aplikasi|platform|sistem|lms|media|software|menggunakan|pakai)\b/i.test(q)) ||
      /\b(?:aplikasi.*online|kuliah.*online.*aplikasi)\b/i.test(q)) {
    return false;
  }

  // Research focus inquiries are specific academic program inquiries (e.g. S2 Magister)
  if (semanticFrame?.intent === 'RESEARCH_FOCUS_INQUIRY' ||
      /\b(?:fokus\s+riset|data\s+science|cyber\s+security|enterprise\s+system|medical\s+informatics)\b/i.test(q)) {
    return false;
  }

  // Academic support, portal, SION, and Pascasarjana contact inquiries are institutional
  if (semanticFrame?.intent === 'ACADEMIC_SUPPORT_INQUIRY' ||
      /\b(?:sion|portal|kendala\s+akademik|masalah\s+akademik)\b/i.test(q)) {
    return false;
  }

  // General PMB admission opening / deadline schedule is an institutional schedule
  if (/\b(?:kapan|jadwal|periode|batas\s+akhir|when|schedule|deadline)\s+.*(?:pendaftaran|pmb|penerimaan|admission|registration|enrollment)\b/i.test(q) ||
      /\b(?:pendaftaran|pmb|admission|registration)\s+(?:kapan|kapan\s+dibuka|dibuka\s+kapan|kapan\s+mulai|open|start)\b/i.test(q)) {
    return false;
  }

  // Broad/general multi-program questions like "apa saja komponen biaya" or requests for all prodi fees / comparison
  if (/\b(?:apa\s+saja|rincian|daftar|list|compare|comparison)\s+(?:komponen\s+)?(?:biaya|tuition|fee)\b/i.test(q) ||
      /\bkomponen\s+biaya\b/i.test(q) ||
      /\b(?:semua|seluruh|tiap|masing-masing|all|across\s+all)\s+(?:prodi|jurusan|program\s+studi|programs?|study\s+programs?)\b/i.test(q) ||
      /\b(?:paling\s+rendah|terendah|paling\s+murah|lowest|cheapest)\b/i.test(q) ||
      /\brincian\s+biaya\s+(?:kuliah\s+)?(?:untuk\s+)?(?:semua|seluruh)\b/i.test(q)) {
    return false;
  }

  // General scholarships or financial aids are institutional
  const isScholarshipOrSponsorship = /\b(?:beasiswa|sponsor|sponsorship|bantuan\s+dana|keringanan\s+biaya|kip|skss|scholarship|scholarships|financial\s+aid)\b/i.test(q);
  if (isScholarshipOrSponsorship || semanticFrame?.domain === 'SCHOLARSHIP' || semanticFrame?.intent === 'SCHOLARSHIP_INQUIRY') {
    return false;
  }

  // Fee inquiries without entity or level: "berapa biaya kuliahnya?", "biayanya berapa?", "berapa spp-nya?"
  // Note: Facility/service fees (e.g. parkir, kantin, gedung pernikahan) are NOT tuition fee program inquiries!
  const isFacilityOrServiceFee = /\b(?:parkir|parking|kantin|canteen|katering|catering|makanan|food|aula|hall|resepsi|sewa|rent)\b/i.test(q) ||
    (/\bgedung\b/i.test(q) && !/\b(?:uang|biaya)\s+gedung\b/i.test(q));
  const isGraduationOrCertificationFee = /\b(?:wisuda|yudisium|sertifikasi)\b/i.test(q);
  if (!isFacilityOrServiceFee && !isScholarshipOrSponsorship && !isGraduationOrCertificationFee &&
      (semanticFrame?.domain === 'TUITION_FEE' || semanticFrame?.intent === 'TUITION_FEE_INQUIRY' || aspects.includes('fee') || aspects.includes('tuition')) &&
      !semanticFrame.academicLevel &&
      !/\b(?:pendaftaran|registrasi|jas|formulir)\b/i.test(q)) {
    return true;
  }

  // Requirements inquiries without entity or level: "bagaimana syarat pendaftarannya?", "syarat masuknya apa?"
  // Note: Only general PMB / admission requirements lacking program/level should require prodi clarification.
  // Foreign student visa, study permit, scholarships, and thesis/graduation rules must NOT be hijacked.
  const isSpecialScopeRequirement = semanticFrame?.domain === 'SCHOLARSHIP' ||
    semanticFrame?.domain === 'INTERNATIONAL' ||
    semanticFrame?.participantScope === 'foreign' ||
    /\b(?:visa|itas|kitas|izin\s+belajar|study\s+permit|asing|internasional|foreign|beasiswa|tugas\s+akhir|skripsi|final\s+project|thesis|defen[sd]e?|yudisium|wisuda|graduation|bimbingan|pertukaran|student\s+exchange|exchange|rpl)\b/i.test(q);

  if (!isSpecialScopeRequirement &&
      (semanticFrame?.intent === 'ADMISSION_REQUIREMENTS' || (semanticFrame?.domain === 'PMB' && aspects.includes('requirements'))) &&
      !semanticFrame.academicLevel) {
    return true;
  }

  // Schedule inquiries without context: "kapan perkuliahan dimulai?", "jadwal kuliah kapan?"
  const isFacilityOrCanteen = /\b(?:kantin|menu|makanan|bus|shuttle|parkir|parking)\b/i.test(q);
  if (!isFacilityOrCanteen && !isSpecialScopeRequirement && (aspects.includes('schedule') || semanticFrame?.intent === 'ADMISSION_SCHEDULE')) {
    if (!semanticFrame.academicLevel) {
      if (!/\b(?:pendaftaran|gelombang|pmb)\b/i.test(q)) {
        return true;
      }
    }
  }


  // Degree inquiries without target program: "gelar apa yang didapatkan?", "gelarnya apa setelah lulus?"
  if (/\b(?:gelar\s+apa|apa\s+gelar|gelarnya\s+apa)\b/i.test(q) && !semanticFrame.academicLevel &&
      !allEntities.some(e => e.family === 'academic_program' || e.family === 'international_program')) {
    return true;
  }

  // Career prospect inquiries without target program: "bagaimana prospek kerja lulusannya?", "peluang karirnya apa?"
  if (/\b(?:prospek\s+(?:kerja|karir|karier)|peluang\s+(?:kerja|karir|karier)|lulusannya\s+jadi\s+apa)\b/i.test(q) &&
      !semanticFrame.academicLevel && !allEntities.some(e => e.family === 'academic_program' || e.family === 'international_program')) {
    return true;
  }

  // Study duration inquiries without target program or level: "berapa lama waktu studinya sampai lulus?", "berapa lama kuliahnya?"
  if (!isSpecialScopeRequirement && /\b(?:berapa\s+lama\s+(?:waktu\s+)?studi(?:nya)?|lama\s+kuliah(?:nya)?|berapa\s+tahun\s+kuliah(?:nya)?)\b/i.test(q) &&
      !semanticFrame.academicLevel && !allEntities.some(e => e.family === 'academic_program' || e.family === 'international_program')) {
    return true;
  }

  // Program accreditation inquiries without target program or institutional qualifier: "berapa akreditasinya?", "akreditasinya apa?"
  if (/\b(?:akreditasinya\s+apa|berapa\s+akreditasinya|apa\s+akreditasinya)\b/i.test(q) &&
      !/\b(?:institusi|kampus|stikom\s+bali|itb\s+stikom)\b/i.test(q) &&
      !semanticFrame.academicLevel && !allEntities.some(e => e.family === 'academic_program' || e.family === 'international_program')) {
    return true;
  }

  // Program-scoped inquiries with zero entities and no academic level
  // Note: Specific scholarship inquiries, thesis guidance, and specific learning topics (e.g. SEO, coding) must NOT trigger prodi clarification
  const isThesisHandbook = /\b(?:tugas\s+akhir|skripsi|pedoman\s+ta|bimbingan\s+ta|buku\s+pedoman)\b/i.test(q);
  const isSpecificTopicLearning = /\b(?:seo|search\s+engine\s+optim(?:ization|isation)|digital\s+marketing|coding|ngoding|pemrograman|ai|artificial\s+intelligence|iot|internet\s+of\s+things|robotika|data\s+science|cyber\s+security|enterprise\s+system|medical\s+informatics)\b/i.test(q);
  const isProgramScoped =
    (semanticFrame?.domain === 'ACADEMIC_CURRICULUM' ||
     semanticFrame?.domain === 'ACADEMIC_PROGRAM' ||
     semanticFrame?.intent === 'CURRICULUM_INQUIRY') &&
    !isScholarshipOrSponsorship &&
    !isThesisHandbook &&
    !isSpecificTopicLearning;
  if (isProgramScoped && allEntities.length === 0 && !semanticFrame.academicLevel) {
    return true;
  }

  return false;
}

/**
 * Builds an initial validated ExecutionPlan for inbound query
 */
function buildExecutionPlan(rawQuery, sessionData = {}, options = {}) {
  let query = '';
  let precomputedFrame = options.semanticFrame || null;

  if (rawQuery && typeof rawQuery === 'object' && !Array.isArray(rawQuery)) {
    precomputedFrame = rawQuery;
    query = String(rawQuery.rawQuery || rawQuery.normalizedQuery || '').trim();
  } else {
    query = String(rawQuery || '').trim();
  }

  if (!query && !precomputedFrame) {
    return {
      success: false,
      error: 'empty_query',
      plan: null
    };
  }

  // 1. Resolve semantic frame: precomputed frame if provided, otherwise synchronous resolution
  const semanticFrame = precomputedFrame || resolveSemanticFrame(query, sessionData, options);

  // 2. Compute explicit Context Delta (Step 4 integration)
  const contextDelta = computeContextDelta({ data: sessionData }, { rawQuery: query, semanticFrame });
  const deltaState = contextDelta.resolvedState || {};

  const entities = (semanticFrame.entities || []).map(e => e.canonical || e.name || String(e));
  const contextActiveEntity = deltaState.activeEntity || null;

  let planType = PLAN_TYPE.DIRECT;
  let clarificationOptions = [];
  let isAmbiguous = false;
  let isUnsupportedEntity = false;
  const unsupportedProgram = isExplicitUnsupportedProgram(query, semanticFrame);

  let targetEntities = contextActiveEntity ? [contextActiveEntity] : [...entities];

  // 3. Ambiguity, Unsupported Program & Context Inheritance Resolution
  if (semanticFrame.domain === 'OUT_OF_DOMAIN' || semanticFrame.intent === 'OUT_OF_DOMAIN_INQUIRY') {
    planType = PLAN_TYPE.DIRECT;
    isAmbiguous = false;
    targetEntities = [];
  } else if (unsupportedProgram) {
    isUnsupportedEntity = true;
    planType = PLAN_TYPE.DIRECT;
    isAmbiguous = false;
    targetEntities = [unsupportedProgram];
  } else if (isAmbiguousEntityInquiry(query, semanticFrame)) {
    const isProgramActiveEntity = sessionData.activeEntity && (
      typeof sessionData.activeEntity === 'string' &&
      !['Wisuda', 'Yudisium'].includes(sessionData.activeEntity)
    );
    if (isProgramActiveEntity) {
      // INHERIT CONTEXT: activeEntity in sessionData provides sufficient discriminator
      targetEntities = [sessionData.activeEntity];
      planType = PLAN_TYPE.DIRECT;
      isAmbiguous = false;
    } else if (targetEntities.length === 0 || !(semanticFrame.entities || []).some(e => e.family === 'academic_program' || e.family === 'international_program')) {
      // NO ACTIVE CONTEXT: Query is ambiguous. Request clarification with authoritative options.
      planType = PLAN_TYPE.AMBIGUOUS_CLARIFICATION;
      isAmbiguous = true;
      // Scope clarification options according to domain/intent (Constraint 8)
      if (semanticFrame.domain === 'TUITION_FEE') {
        clarificationOptions = getAuthoritativeProgramOptions({ scope: 'fee' });
      } else if (semanticFrame.domain === 'ACADEMIC_CURRICULUM' || semanticFrame.domain === 'ACADEMIC_PROGRAM') {
        clarificationOptions = getAuthoritativeProgramOptions({ scope: 'all' });
      } else {
        clarificationOptions = getAuthoritativeProgramOptions({ scope: 's1' });
      }
    }
  }

  // 4. Recommendation vs Direct vs Ambiguity
  const canonicalUnderstanding = (typeof buildCanonicalQueryUnderstanding === 'function')
    ? buildCanonicalQueryUnderstanding(query)
    : null;

  const NON_RECOMMENDATION_INTENTS = new Set([
    'CONVERSATIONAL_GREETING',
    'CONVERSATIONAL_SMALL_TALK',
    'CONVERSATIONAL_ACKNOWLEDGEMENT',
    'ADVERSARIAL_INJECTION_DEFENSE',
    'PROGRAM_ACCREDITATION',
    'INSTITUTIONAL_ACCREDITATION',
    'ACCREDITATION_INQUIRY',
    'CURRICULUM_INQUIRY',
    'GRADUATION_REQUIREMENTS',
    'ADMISSION_PROCEDURE',
    'GENERAL_PMB_INQUIRY',
    'ADMISSION_SCHEDULE',
    'AVAILABLE_PROGRAMS_LIST',
    'STUDY_MODE',
    'DEGREE_AWARD',
    'PROGRAM_COMPARISON',
    'ANSWER_REFINEMENT',
    'CAREER_PROSPECTS_INQUIRY',
    'TUITION_FEE_INQUIRY',
    'FACILITY_INQUIRY',
    'SCHOLARSHIP_INQUIRY',
    'ORGANIZATION_INQUIRY',
    'CAMPUS_SERVICE_INQUIRY',
    'CAREER_CENTER_INQUIRY',
    'OUT_OF_DOMAIN_INQUIRY'
  ]);
  const NON_RECOMMENDATION_DOMAINS = new Set([
    'CONVERSATIONAL',
    'TUITION_FEE',
    'SCHOLARSHIP',
    'FACILITIES',
    'CAMPUS_SERVICE',
    'CAREER_CENTER',
    'ORGANIZATION_UKM',
    'ACCREDITATION',
    'ACADEMIC_CURRICULUM',
    'PMB',
    'INTERNATIONAL',
    'OUT_OF_DOMAIN'
  ]);

  const FACTUAL_ASPECTS = new Set([
    'accreditation', 'akreditasi',
    'curriculum', 'matkul',
    'fee', 'tuition', 'biaya',
    'career', 'career_prospects', 'prospek',
    'facilities', 'fasilitas',
    'degree_award', 'gelar',
    'study_duration', 'durasi', 'masa_studi',
    'schedule', 'jadwal',
    'requirements', 'syarat',
    'scholarship', 'beasiswa',
    'student_organization', 'ukm', 'sports', 'arts_culture', 'organisasi', 'ormawa',
    'service_info', 'support', 'career_services', 'internship'
  ]);

  const hasFactualAspect = Array.isArray(semanticFrame.aspects) &&
    semanticFrame.aspects.some(a => FACTUAL_ASPECTS.has(String(a).toLowerCase()));

  const effectiveDomain = semanticFrame.domain || sessionData.activeDomain || null;

  const isExplicitNonRecommendation =
    NON_RECOMMENDATION_INTENTS.has(semanticFrame.intent) ||
    NON_RECOMMENDATION_DOMAINS.has(effectiveDomain) ||
    Boolean(effectiveDomain?.includes('FEE')) ||
    hasFactualAspect ||
    isUnsupportedEntity;

  // Program recommendation is exclusively for selecting or evaluating fit for an academic study program / major
  const isTargetingAcademicProgram = Boolean(
    (canonicalUnderstanding?.intent && (
      canonicalUnderstanding.intent.primary === 'ask_program_recommendation' ||
      canonicalUnderstanding.intent.primary === 'ask_program_fit_reasoning'
    )) ||
    (semanticFrame.domain === 'ACADEMIC_RECOMMENDATION' || semanticFrame.intent === 'PROGRAM_RECOMMENDATION') ||
    isBroadSchoolBackgroundWithoutSpecificPreference(query) ||
    (detectProgramFitSignals(normalizeQueryForSignals(query)).length > 0 &&
     !effectiveDomain?.includes('FEE') &&
     entities.length <= 1) ||
    ((/\b(?:rekomendasi|rekomendasikan|cocok(?:nya)?|saran|bingung\s+pilih|pilih|ambil|pas)\b/i.test(query) || semanticFrame.speechAct === 'SEEK_ADVICE') &&
     /\b(?:prodi|jurusan|program\s*studi|kuliah)\b/i.test(query) &&
     !/\b(?:ukm|unit\s+kegiatan\s+mahasiswa|organisasi|ormawa|hima|beasiswa|inkubator|career|fasilitas)\b/i.test(query))
  );

  const isRecommendationIntent = !isAmbiguous &&
    !isExplicitNonRecommendation &&
    isTargetingAcademicProgram;

  if (planType !== PLAN_TYPE.AMBIGUOUS_CLARIFICATION && isRecommendationIntent && !options.taskGraph) {
    planType = PLAN_TYPE.RECOMMENDATION;
  }

  // 5. Build task graph
  const tasks = [];
  if (planType === PLAN_TYPE.AMBIGUOUS_CLARIFICATION) {
    tasks.push({
      id: 'task_clarify_0',
      stepIndex: 0,
      type: 'CLARIFICATION_TASK',
      query: query,
      targetEntities: [],
      requiredAspects: semanticFrame.aspects || [],
      dependsOn: [],
      verifiedInputs: {
        inheritedEntity: null,
        sessionActiveDomain: sessionData.activeDomain || null
      }
    });
  } else if (planType === PLAN_TYPE.RECOMMENDATION) {
    tasks.push({
      id: 'task_rec_0',
      stepIndex: 0,
      type: 'RECOMMENDATION_TASK',
      query: query,
      targetEntities: targetEntities,
      requiredAspects: ['program_recommendation', 'curriculum_fit'],
      dependsOn: [],
      verifiedInputs: {
        inheritedEntity: contextActiveEntity,
        sessionActiveDomain: sessionData.activeDomain || null
      }
    });
  } else {
    tasks.push({
      id: 'task_0',
      stepIndex: 0,
      type: 'RETRIEVAL_TASK',
      query: semanticFrame.normalizedQuery || query,
      targetEntities: targetEntities,
      requiredAspects: semanticFrame.aspects || [],
      dependsOn: [],
      verifiedInputs: {
        inheritedEntity: contextActiveEntity,
        sessionActiveDomain: sessionData.activeDomain || null
      }
    });
  }

  const isInherited = Boolean(
    contextActiveEntity &&
    (deltaState.entityProvenance === ENTITY_PROVENANCE.INHERITED_FROM_SESSION ||
     (sessionData.activeEntity && targetEntities.includes(sessionData.activeEntity) && entities.length === 0))
  );

  // Phase E: Shadow Entity Resolution (Section 17 - strictly non-interfering)
  let shadowEntityResolution = null;
  if (typeof resolveOpenWorldEntity === 'function') {
    try {
      const rawMention = unsupportedProgram || (entities.length > 0 ? entities[0] : query);
      const legacyResult = isUnsupportedEntity ? 'UNSUPPORTED' : (isAmbiguous ? 'AMBIGUOUS' : (entities.length > 0 ? 'SUPPORTED' : 'UNKNOWN'));
      const shadowResult = resolveOpenWorldEntity({
        rawMention,
        inferredCategory: semanticFrame.domain === 'TUITION_FEE' || semanticFrame.domain === 'ACADEMIC_CURRICULUM' ? 'academic_program' : null,
        context: {
          activeEntity: contextActiveEntity,
          isAmbiguous
        }
      }, {
        catalog: options.knowledgeCatalog,
        catalogCompleteness: options.catalogCompleteness
      });

      shadowEntityResolution = {
        rawMention,
        legacyResult,
        newResult: shadowResult.state,
        candidates: shadowResult.candidates || (shadowResult.entity ? [shadowResult.entity] : []),
        state: shadowResult.state,
        scoreDiagnostics: shadowResult.evidence || {},
        firstDifference: legacyResult !== shadowResult.state ? `${legacyResult} != ${shadowResult.state}` : null
      };

      if (typeof options.onShadowEntityResolution === 'function') {
        options.onShadowEntityResolution(shadowEntityResolution);
      }
    } catch (_) {}
  }

  const plan = {
    id: `plan_${Date.now()}`,
    rawQuery: query,
    planType: options.taskGraph ? PLAN_TYPE.MULTI_STEP : planType,
    isAmbiguous,
    isUnsupportedEntity,
    unsupportedProgramName: unsupportedProgram || null,
    unsupportedEntity: isUnsupportedEntity,
    unsupportedEntityName: unsupportedProgram || null,
    entityResolutionStatus: isUnsupportedEntity ? 'UNSUPPORTED' : (entities.length > 0 ? 'RESOLVED' : 'UNRESOLVED'),
    clarificationOptions,
    tasks,
    taskGraph: options.taskGraph || null,
    contextDelta: {
      ...contextDelta,
      activeDomain: deltaState.activeDomain || semanticFrame.domain,
      activeEntity: contextActiveEntity,
      inheritedFromSession: isInherited
    },
    targetDomain: semanticFrame.domain,
    targetIntent: semanticFrame.intent,
    metadata: {
      plannerVersion: 'phase2-step5',
      frameDomain: semanticFrame.domain,
      frameIntent: semanticFrame.intent,
      shadowEntityResolution: shadowEntityResolution || null
    }
  };

  // 5. Strict Execution Plan Validation
  const validation = validateExecutionPlan(plan);
  if (!validation.valid) {
    return {
      success: false,
      error: validation.reason,
      plan: null,
      targetDomain: semanticFrame.domain,
      targetIntent: semanticFrame.intent
    };
  }

  return {
    success: true,
    error: null,
    plan,
    targetDomain: semanticFrame.domain,
    targetIntent: semanticFrame.intent,
    domain: semanticFrame.domain,
    intent: semanticFrame.intent
  };
}

module.exports = {
  buildExecutionPlan,
  isAmbiguousEntityInquiry
};
