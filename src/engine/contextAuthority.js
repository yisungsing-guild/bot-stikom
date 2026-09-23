/**
 * contextAuthority.js
 *
 * General CONTEXT_AUTHORITY engine for multi-turn semantic routing and clarification control.
 *
 * Distinguishes 6 transitions:
 * - INHERIT: unanchored aspect/continuation query inheriting active context
 * - ENTITY_REPLACEMENT: new explicit entity provided, inherits active domain/intent
 * - DOMAIN_SWITCH: explicit substantive cues for a new domain
 * - CORRECTION: user explicit repair signal ("bukan SI, maksud saya TI")
 * - AMBIGUOUS_REFERENCE: pronoun/anaphora referencing session entity ("yang tadi", "prodi itu")
 * - NO_CONTEXT: fresh/stale/unverified session or unresolvable missing slots
 *
 * Rule:
 * Only suppress clarification when inherited context actually resolves the missing semantic slots
 * without conflicting with explicit current-turn semantics.
 */

const {
  normalizeConversationState,
  isConversationStateFresh,
  extractCandidateEntity,
  parseContextRepairSignal,
  ENTITY_TYPE_DOMAIN_COMPATIBILITY
} = require('./conversationStateEngine');
const {
  CANONICAL_INTEREST_PROFILES,
  resolveCanonicalInterestProfiles
} = require('./canonicalEntityRegistry');
const { normalizeEntityFamily } = require('./semanticFrame');

const CONTEXT_TRANSITIONS = {
  INHERIT: 'INHERIT',
  ENTITY_REPLACEMENT: 'ENTITY_REPLACEMENT',
  DOMAIN_SWITCH: 'DOMAIN_SWITCH',
  CORRECTION: 'CORRECTION',
  AMBIGUOUS_REFERENCE: 'AMBIGUOUS_REFERENCE',
  NO_CONTEXT: 'NO_CONTEXT'
};

// Domains that strictly require a program entity to be answerable
const DOMAINS_REQUIRING_PROGRAM_ENTITY = new Set([
  'career',
  'academic',
  'program_curriculum',
  'program'
]);

/**
 * Checks if a fee query requires a program entity.
 * General PMB registration fees (e.g. "biaya pendaftaran") do NOT require a prodi entity,
 * but prodi tuition fees (SPP, DPP, SKS, rincian biaya kuliah prodi) DO require a prodi entity.
 */
function feeQueryRequiresProgramEntity(rawText, contract) {
  const text = String(rawText || '').toLowerCase();
  const isGenericRegistrationFee = /\b(?:biaya\s+daftar|uang\s+daftar|biaya\s+pendaftaran|uang\s+pendaftaran|formulir|admisi)\b/i.test(text)
    && !/\b(?:kuliah|spp|dpp|sks|gedung|semester|prodi|jurusan)\b/i.test(text);
  if (isGenericRegistrationFee) return false;
  const isConceptualOrPolicy = /\b(?:apakah|apa\s+itu|itu\s+apa|pengertian|istilah|maksudnya|bisa\s+(?:di)?cicil|bisa\s+angsur|skema\s+pembayaran|syarat\s+(?:pengajuan\s+)?cicilan(?:nya)?|pengajuan\s+cicilan(?:nya)?|cicil(?:an)?(?:nya)?|angsur(?:an)?(?:nya)?)\b/i.test(text)
    || (/\b(?:uang\s+gedung|dpp)\b/i.test(text) && /\b(?:itu|ya|adalah|maksudnya|pengertian|artinya)\b/i.test(text) && !/\b(?:berapa|nominal|tarif|total|jumlah)\b/i.test(text));
  if (isConceptualOrPolicy) return false;
  return true;
}

/**
 * Checks whether a candidate entity's type is compatible with a target domain.
 */
function isEntityTypeCompatibleWithDomain(entityType, targetDomain) {
  if (!entityType || !targetDomain) return true;
  const allowed = ENTITY_TYPE_DOMAIN_COMPATIBILITY[entityType];
  if (allowed && allowed.has(targetDomain)) return true;
  const fam = normalizeEntityFamily(entityType);
  const famAllowed = ENTITY_TYPE_DOMAIN_COMPATIBILITY[fam];
  return famAllowed ? famAllowed.has(targetDomain) : true;
}

/**
 * Detects whether rawText has substantive domain cues for a specific domain.
 */
function detectDomainFromCues(rawText, sessionState = null) {
  const text = String(rawText || '').toLowerCase();
  const hasS2Entity = Boolean(
    sessionState && (
      /\b(?:s2|magister|pascasarjana)\b/i.test(String(sessionState.activeEntity?.canonical || ''))
      || sessionState.activeDomain === 's2_postgraduate'
    )
  );
  if (/\b(?:kelas\s*(?:malam|sabtu|karyawan|sore|pagi|reguler|weekend)|jadwal\s+(?:per)?kuliah(?:an)?(?:nya)?|waktu\s+(?:per)?kuliah(?:an)?(?:nya)?|(?:per)?kuliah(?:an)?(?:nya)?\s+(?:kapan|malam|sabtu)|bisa\s+kelas)\b/i.test(text)
    || (/\b(?:kelas|jadwal)\b/i.test(text) && /\b(?:malam|sabtu|karyawan|weekend)\b/i.test(text))) {
    if (hasS2Entity || /\b(?:s2|magister|pascasarjana)\b/i.test(text)) {
      return 's2_postgraduate';
    }
  }
  // Academic policy patterns must be checked FIRST — before fee/career — to prevent
  // sks/cicil tokens from overriding correct academic_policy classification.
  if (
    /\b(?:paket\s+sks|sks\s+paket|konversi\s+sks|sks\s+yang\s+(?:dapat|bisa)\s+dikonversi|maksimal\s+sks)\b/i.test(text)
    || /\b(?:rpl|rekognisi\s+pembelajaran\s+lampau)\b/i.test(text)
    || (/\b(?:paket|ditentukan\s+kampus|sudah\s+ditentukan)\b/i.test(text) && /\bsks\b/i.test(text))
  ) {
    return 'academic_policy';
  }
  if (/\b(?:biaya|harga|tarif|bayar|dpp|spp|ukt|cicil|angsur|uang\s+gedung)\b/i.test(text)
    && !/\b(?:paket\s+sks|sks\s+paket|konversi\s+sks|rpl)\b/i.test(text)) {
    return 'fee';
  }
  if (/\b(?:jepang|japan|hi\s*-?\s*think)\b/i.test(text) || (sessionState && sessionState.activeDomain === 'international_program')) {
    if (/\b(?:kerja|karir|karier|lulusan|peluang\s+kerja|pekerjaan|magang|pelatihan)\b/i.test(text)) {
      return 'international_program';
    }
  }
  if (/\b(?:prospek(?:nya)?|kerja|bekerja|karir|karier|berkarir|berkarier|lulusan|peluang\s+kerja|pekerjaan|tamat(?:nya)?|setelah\s+(?:tamat|lulus)|profesi|job\s*role)\b/i.test(text)
    && !/\b(?:rpl|rekognisi\s+pembelajaran\s+lampau)\b/i.test(text)) {
    return 'career';
  }
  if (/\b(?:kenapa|mengapa|alasan|alternatif|rekomendasi|keunggulan|cocok|pilihan)\b/i.test(text)
    && /\b(?:jurusan|prodi|program\s+studi|kuliah|s1|d3|s2)\b/i.test(text)) {
    return 'program';
  }
  if (/\b(?:gelombang|jadwal|kapan\s+buka|kapan\s+daftar|timeline|periode)\b/i.test(text)) {
    return 'pmb_schedule';
  }
  if (/\b(?:syarat|cara\s+daftar|alur\s+daftar|berkas|dokumen|pendaftaran|registrasi|beli\s+langsung|datang\s+langsung)\b/i.test(text)) {
    return 'registration';
  }
  if (/\b(?:beasiswa|kip|potongan|keringanan|bantuan\s+biaya)\b/i.test(text)) {
    return 'scholarship';
  }
  if (/\b(?:ukm|organisasi|ekskul|senat|bem|hima|komunitas)\b/i.test(text)) {
    return 'student_organization';
  }
  if (/\b(?:fasilitas|lab|perpustakaan|gedung|kantin|parkir|asrama)\b/i.test(text)) {
    return 'facility';
  }
  if (/\b(?:mahasiswa\s+(?:asing|internasional)|foreign\s+student|keimigrasian|imigrasi|izin\s+(?:belajar(?:nya)?|tinggal(?:nya)?)|visa|vitas|itas|kitas|sktt)\b/i.test(text)) {
    return 'foreign_student_admin';
  }
  if (/\b(?:kurikulum|mata\s+kuliah|matkul|hardware|software|cloud|iot|jaringan|pemrograman|coding|perangkat\s+keras|perangkat\s+lunak|belajar(?:nya)?|dipelajari|materi)\b/i.test(text)
    && !/\b(?:izin\s+belajar(?:nya)?|study\s+permit)\b/i.test(text)) {
    return 'program_curriculum';
  }
  if (/\b(?:sks|akademik|semester)\b/i.test(text)) {
    return 'academic';
  }
  if (/\b(?:double\s*degree|dual\s*degree|gelar\s*ganda|dnui|help|utb)\b/i.test(text)
    || (/\b(?:malaysia|china|dalian|bandung)\b/i.test(text) && /\b(?:bali|stikom|skema|tahun)\b/i.test(text))
    || (sessionState && sessionState.activeDomain === 'double_degree' && /\b(?:skema|tahun|berapa\s+tahun|bali|malaysia|china|dnui|help)\b/i.test(text))) {
    return 'double_degree';
  }
  if (/\b(?:akreditasi|terakreditasi|peringkat\s+akreditasi|ban\s*pt|lam\s*infokom)\b/i.test(text)) {
    return 'accreditation';
  }
  if (/\b(?:telepon|nomor\s+telepon|no\s+telp|kontak|call\s*center|narahubung|whatsapp|hotline)\b/i.test(text)) {
    return 'campus_contact';
  }
  return null;
}

/**
 * Checks if rawText contains reference/anaphoric demonstratives referencing prior entity.
 */
function hasAmbiguousReferenceCues(rawText) {
  const text = String(rawText || '').toLowerCase();
  return /\b(?:yang\s+(?:itu|tadi|tersebut)|(?:jurusan|prodi|program|kampus)\s+(?:itu|tadi|tersebut)|di\s+sana|di\s+situ|tentang\s+itu|kalau\s+yang\s+itu|itu\s+gimana|gimana\s+dengan\s+yang\s+itu)\b/i.test(text)
    || (/\b(?:itu|tadi|tersebut)\b/i.test(text) && !/\b(?:apa\s+itu|definisi|pengertian)\b/i.test(text));
}

/**
 * Builds the effective disambiguated query based on the transition and resolved slots.
 */
function buildEffectiveQuery(transition, resolvedDomain, resolvedIntent, resolvedEntity, rawText) {
  const entityName = resolvedEntity && resolvedEntity.canonical ? resolvedEntity.canonical : '';
  const domain = String(resolvedDomain || '').toLowerCase();

  if (transition === CONTEXT_TRANSITIONS.ENTITY_REPLACEMENT || transition === CONTEXT_TRANSITIONS.CORRECTION) {
    const isShortEntityQuery = !rawText || rawText.trim().split(/\s+/).length <= 4 ||
      /^(?:kalo|kalau|bagaimana\s+dengan|gimana\s+dengan|untuk|prodi|jurusan|yang)?\s*[a-z0-9\s.-]+\??$/i.test(rawText.trim());
    if (isShortEntityQuery) {
      if (domain === 'career') {
        return `Prospek kerja program studi ${entityName} ITB STIKOM Bali`;
      }
      if (domain === 'fee') {
        return `Rincian biaya kuliah program studi ${entityName} ITB STIKOM Bali`;
      }
      if (domain === 'academic' || domain === 'program_curriculum') {
        return `Kurikulum dan materi kuliah program studi ${entityName} ITB STIKOM Bali`;
      }
      if (domain === 'accreditation') {
        return `Akreditasi program studi ${entityName} ITB STIKOM Bali`;
      }
      if (domain === 'student_organization') {
        return `Profil organisasi mahasiswa dan UKM ${entityName} ITB STIKOM Bali`;
      }
      if (domain === 'campus_facility' || domain === 'facility' || domain === 'facilities') {
        return `Informasi fasilitas ${entityName} ITB STIKOM Bali`;
      }
      if (domain === 'program') {
        return `Informasi program studi ${entityName} ITB STIKOM Bali`;
      }
    }
    return entityName && !String(rawText || '').toLowerCase().includes(entityName.toLowerCase())
      ? `${rawText} ${entityName}`
      : rawText;
  }

  if (transition === CONTEXT_TRANSITIONS.AMBIGUOUS_REFERENCE && entityName) {
    const replaced = String(rawText || '')
      .replace(/\b(?:prodi|jurusan|program\s+studi)\s+(?:tersebut|itu|tadi)\b/gi, `program studi ${entityName}`)
      .replace(/\b(?:yang\s+tadi|yang\s+itu|tersebut)\b/gi, entityName);
    return replaced !== rawText ? replaced : `${rawText} ${entityName}`;
  }

  if (transition === CONTEXT_TRANSITIONS.DOMAIN_SWITCH && entityName) {
    if (!String(rawText || '').toLowerCase().includes(entityName.toLowerCase())) {
      return `${rawText} untuk ${entityName}`;
    }
  }

  if (transition === CONTEXT_TRANSITIONS.INHERIT && entityName) {
    if (domain === 'fee' && !feeQueryRequiresProgramEntity(rawText)) {
      return rawText;
    }
    if (!String(rawText || '').toLowerCase().includes(entityName.toLowerCase())) {
      return `${rawText} untuk ${entityName}`;
    }
  }

  if (transition === CONTEXT_TRANSITIONS.INHERIT && !entityName) {
    return rawText;
  }
  return rawText;
}

/**
 * Main CONTEXT_AUTHORITY evaluation function.
 *
 * @param {object|string} currentTurn - Understanding object, contract, or raw query text
 * @param {object} priorSessionOrState - Session object or conversationState
 * @param {object} [options]
 * @returns {object} Authority decision with transition, resolved slots, and suppressClarification flag
 */
function resolveContextAuthority(currentTurn, priorSessionOrState, options = {}) {
  const now = options.now || Date.now();
  const unwrapPrior = priorSessionOrState && typeof priorSessionOrState === 'object'
    ? (priorSessionOrState.sessionData || priorSessionOrState.data || priorSessionOrState.session || priorSessionOrState)
    : priorSessionOrState;
  const sessionState = normalizeConversationState(unwrapPrior, now);
  const rawText = typeof currentTurn === 'string'
    ? currentTurn
    : String(currentTurn?.rawQuery || currentTurn?.question || currentTurn?.userQuery || options.rawText || '').trim();

  const understanding = (typeof currentTurn === 'object' && currentTurn)
    ? (currentTurn.canonicalUnderstanding || currentTurn.understanding || currentTurn)
    : (options.canonicalUnderstanding || null);

  const contract = (typeof currentTurn === 'object' && currentTurn)
    ? (currentTurn.canonicalContract || currentTurn.semanticContract || currentTurn.contract || understanding?.contract || null)
    : (options.canonicalContract || null);

  const currentDomain = String(
    understanding?.domain?.primary ||
    understanding?.domain ||
    contract?.domain ||
    ''
  ).toLowerCase().trim();

  const currentIntent = String(
    understanding?.intent?.primary ||
    understanding?.intent ||
    contract?.intent ||
    ''
  ).toLowerCase().trim();

  const isCurrentDomainExplicit = Boolean(currentDomain && currentDomain !== 'general' && currentDomain !== 'unknown');
  const isCurrentIntentExplicit = Boolean(currentIntent && currentIntent !== 'ask_general' && currentIntent !== 'unknown');

  const candidateEntity = extractCandidateEntity(understanding, rawText);

  const sessionEntity = sessionState && (sessionState.activeEntity || (sessionState.lastProgramHint ? { canonical: sessionState.lastProgramHint, type: 'program' } : null));
  const sessionDomain = sessionState && (sessionState.activeDomain || sessionState.domain || (sessionState.lastSemanticContract && sessionState.lastSemanticContract.domain) || null);
  const sessionIntent = sessionState && (sessionState.activeIntent || sessionState.intent || (sessionState.lastSemanticContract && sessionState.lastSemanticContract.intent) || null);

  // Check session context availability and validity
  const hasActiveSessionContext = Boolean(
    sessionState &&
    (sessionDomain || sessionEntity || sessionIntent)
  );
  const isFresh = isConversationStateFresh(sessionState, now, options.maxAgeMs);
  const isVerifiedAuthority = Boolean(
    sessionState &&
    sessionState.isVerified !== false &&
    sessionState.promotable !== false &&
    !sessionState.legacyUnverified
  );

  // If no valid session context, transition is NO_CONTEXT
  if (!hasActiveSessionContext || !isFresh) {
    const missing = [];
    if (!isCurrentDomainExplicit && !candidateEntity) missing.push('domain', 'topic');
    if (currentDomain === 'fee' && feeQueryRequiresProgramEntity(rawText, contract) && !candidateEntity) {
      missing.push('entity');
    }
    if (DOMAINS_REQUIRING_PROGRAM_ENTITY.has(currentDomain) && !candidateEntity) {
      missing.push('entity');
    }
    return {
      transition: CONTEXT_TRANSITIONS.NO_CONTEXT,
      resolvedDomain: isCurrentDomainExplicit ? currentDomain : null,
      resolvedIntent: isCurrentIntentExplicit ? currentIntent : null,
      resolvedEntity: candidateEntity || null,
      missingSlots: missing,
      suppressClarification: false,
      effectiveQuery: rawText,
      reason: !hasActiveSessionContext ? 'no_session_context' : 'stale_session_context'
    };
  }

  // =========================================================================
  // TRANSITION 1: CORRECTION
  // User explicitly signals repair/correction ("bukan SI, maksud saya TI")
  // =========================================================================
  const repairSignal = parseContextRepairSignal(rawText);
  if (repairSignal && repairSignal.isRepair) {
    const repairClause = repairSignal.repairClause || rawText;
    const repairEntity = extractCandidateEntity(null, repairClause);
    const domainFromRepair = detectDomainFromCues(repairClause, sessionState);

    // If repairClause specifies an entity, that entity wins.
    // If not, but rejectedClause exists and matches prior entity, prior entity is cleared.
    let resolvedEntity = repairEntity;
    if (!resolvedEntity && repairSignal.rejectedClause) {
      const rejectedEntity = extractCandidateEntity(null, repairSignal.rejectedClause);
      if (sessionEntity && rejectedEntity &&
          sessionEntity.canonical.toLowerCase() === rejectedEntity.canonical.toLowerCase()) {
        resolvedEntity = null;
      } else {
        resolvedEntity = sessionEntity;
      }
    } else if (!resolvedEntity) {
      resolvedEntity = sessionEntity;
    }
    // If the repair clause does not explicitly change domain, retain session activeDomain
    const resolvedDomain = domainFromRepair || sessionDomain || (isCurrentDomainExplicit ? currentDomain : null);
    const resolvedIntent = (domainFromRepair && isCurrentIntentExplicit) ? currentIntent : (sessionIntent || currentIntent);

    const missing = [];
    if (resolvedDomain && (DOMAINS_REQUIRING_PROGRAM_ENTITY.has(resolvedDomain) || (resolvedDomain === 'fee' && feeQueryRequiresProgramEntity(rawText, contract)))) {
      if (!resolvedEntity) missing.push('entity');
    }
    if (!resolvedDomain || resolvedDomain === 'general') missing.push('domain');

    const suppressClarification = missing.length === 0;
    const effectiveQuery = buildEffectiveQuery(CONTEXT_TRANSITIONS.CORRECTION, resolvedDomain, resolvedIntent, resolvedEntity, repairClause);
    return {
      transition: CONTEXT_TRANSITIONS.CORRECTION,
      resolvedDomain,
      resolvedIntent,
      resolvedEntity,
      missingSlots: missing,
      suppressClarification,
      effectiveQuery,
      repairSignal,
      reason: 'explicit_user_repair_signal'
    };
  }

  // A complete current-turn proposition (explicit domain + intent + entity)
  // is self-contained. It must not be reinterpreted as an entity-only
  // replacement of an unrelated prior domain. Elliptical replacements such as
  // "kalau TI?" remain inheritable because their canonical domain/intent are
  // general rather than explicit.
  if (isCurrentDomainExplicit && isCurrentIntentExplicit && candidateEntity) {
    return {
      transition: CONTEXT_TRANSITIONS.NO_CONTEXT,
      resolvedDomain: currentDomain,
      resolvedIntent: currentIntent,
      resolvedEntity: candidateEntity,
      missingSlots: [],
      suppressClarification: true,
      effectiveQuery: rawText,
      reason: 'self_contained_current_turn_proposition'
    };
  }

  const interestProfiles = (understanding?.constraints?.interestProfiles && Array.isArray(understanding.constraints.interestProfiles) && understanding.constraints.interestProfiles.length > 0)
    ? understanding.constraints.interestProfiles
    : (resolveCanonicalInterestProfiles ? resolveCanonicalInterestProfiles(rawText) : []);
  const currentInterestProfile = interestProfiles.length
    ? interestProfiles[0].key
    : String(understanding?.constraints?.interestProfile || contract?.constraints?.interestProfile || '').trim();

  const isOrgContext = (currentDomain === 'student_organization' || sessionState.activeDomain === 'student_organization');
  if (isOrgContext && currentInterestProfile && !candidateEntity) {
    const hasOrgCue = /\b(?:ukm|ormawa|organisasi|hima|himaprodi)\b/i.test(rawText);
    const effectiveQuery = hasOrgCue ? rawText : `${rawText} UKM`;
    return {
      transition: CONTEXT_TRANSITIONS.INHERIT,
      resolvedDomain: 'student_organization',
      resolvedIntent: sessionState.activeIntent || currentIntent || 'ask_organization_profile',
      resolvedEntity: null,
      missingSlots: [],
      suppressClarification: true,
      effectiveQuery,
      reason: 'current_interest_profile_inherits_organization_context'
    };
  }

  // =========================================================================
  // A wave-only follow-up is a qualifier replacement, not a schedule-domain switch.
  // The current qualifier wins while the compatible fee domain/intent/entity remain authoritative.
  const isWaveQualifierFollowup = sessionState.activeDomain === 'fee'
    && /\b(?:gelombang|gel\.?|wave)\s*(?:khusus|sisipan|[ivx]+|\d+)(?:\s*[a-z])?\b/i.test(rawText)
    && !/\b(?:jadwal|kapan|tanggal|tgl|buka|dibuka|mulai|berakhir|deadline|periode)\b/i.test(rawText)
    && (!candidateEntity || candidateEntity.type === 'wave');
  if (isWaveQualifierFollowup) {
    return {
      transition: CONTEXT_TRANSITIONS.INHERIT,
      resolvedDomain: 'fee',
      resolvedIntent: sessionState.activeIntent || 'ask_fee',
      resolvedEntity: sessionState.activeEntity || null,
      missingSlots: sessionState.activeEntity ? [] : ['entity'],
      suppressClarification: Boolean(sessionState.activeEntity),
      effectiveQuery: buildEffectiveQuery(
        CONTEXT_TRANSITIONS.INHERIT,
        'fee',
        sessionState.activeIntent || 'ask_fee',
        sessionState.activeEntity || null,
        rawText
      ),
      reason: 'current_wave_qualifier_with_compatible_fee_context'
    };
  }
  // TRANSITION 2: DOMAIN_SWITCH vs TRANSITION 3: ENTITY_REPLACEMENT
  // =========================================================================
  // Canonical classification represents the full current-turn meaning. Lexical
  // cues are only a fallback for otherwise unclassified turns; a word such as
  // syarat must not demote an explicit fee/installment contract to registration.
  const lexicalCuesDomain = detectDomainFromCues(rawText, sessionState);
  const detectedCuesDomain = isCurrentDomainExplicit
    ? (currentDomain === 'campus_facility' && lexicalCuesDomain === 'facility' ? lexicalCuesDomain : currentDomain)
    : lexicalCuesDomain;
  const hasDomainCuesInText = Boolean(detectedCuesDomain);

  // If user provides an explicit new entity WITHOUT domain cues in the text,
  // this is an ENTITY_REPLACEMENT preserving the active session domain and intent
  // ONLY if it is a short elliptical/slot-filling turn (e.g. "kalau TI?", "untuk prodi SK?").
  if (candidateEntity && !hasDomainCuesInText) {
    const isShortEntityQuery = !rawText || rawText.trim().split(/\s+/).length <= 5 ||
      /^(?:kalo|kalau|bagaimana\s+dengan|gimana\s+dengan|untuk|lalu)?\s*(?:jurusan|prodi|program\s+studi)?\s*[a-z0-9\s.-]+\??$/i.test(rawText.trim());

    const isDifferentEntity = !sessionState.activeEntity ||
      !sessionState.activeEntity.canonical ||
      sessionState.activeEntity.canonical.toLowerCase() !== candidateEntity.canonical.toLowerCase();

    if (isShortEntityQuery && isDifferentEntity) {
      const targetDomain = (isCurrentDomainExplicit && currentDomain !== 'general' && currentDomain !== 'unknown' ? currentDomain : null)
        || sessionState.activeDomain
        || (isCurrentDomainExplicit ? currentDomain : 'program');
      const targetIntent = (isCurrentDomainExplicit && isCurrentIntentExplicit ? currentIntent : null)
        || sessionState.activeIntent
        || (isCurrentIntentExplicit ? currentIntent : null);

      const isCompatible = isEntityTypeCompatibleWithDomain(candidateEntity.type || 'program', targetDomain);
      if (isCompatible) {
        const effectiveQuery = buildEffectiveQuery(CONTEXT_TRANSITIONS.ENTITY_REPLACEMENT, targetDomain, targetIntent, candidateEntity, rawText);
        return {
          transition: CONTEXT_TRANSITIONS.ENTITY_REPLACEMENT,
          resolvedDomain: targetDomain,
          resolvedIntent: targetIntent,
          resolvedEntity: candidateEntity,
          missingSlots: [],
          suppressClarification: true,
          effectiveQuery,
          reason: 'entity_replacement_compatible'
        };
      }
    }
  }

  // Current turn introduces explicit substantive cues for a new domain
  const activeDom = sessionState.activeDomain || sessionDomain;
  const effectiveCurrentDomain = detectedCuesDomain || (isCurrentDomainExplicit ? currentDomain : null);
  const isDomainSwitchCandidate = Boolean(
    hasDomainCuesInText &&
    detectedCuesDomain !== 'general' &&
    detectedCuesDomain !== 'unknown' &&
    (!activeDom || detectedCuesDomain.toLowerCase() !== activeDom.toLowerCase())
  );

  if (isDomainSwitchCandidate) {
    const newDomain = effectiveCurrentDomain.toLowerCase();
    let resolvedEntity = candidateEntity || null;

    // Check if session's active entity is compatible with the new domain
    const fallbackSessionEntity = sessionState.activeEntity || sessionEntity;
    if (!resolvedEntity && fallbackSessionEntity) {
      const priorEntityType = fallbackSessionEntity.type || 'program';
      if (isEntityTypeCompatibleWithDomain(priorEntityType, newDomain)) {
        resolvedEntity = fallbackSessionEntity;
      }
    }

    const resolvedDomain = newDomain;
    const resolvedIntent = (resolvedDomain === 's2_postgraduate')
      ? 'ask_availability'
      : (isCurrentIntentExplicit ? currentIntent : null);

    const missing = [];
    if (DOMAINS_REQUIRING_PROGRAM_ENTITY.has(resolvedDomain) && !resolvedEntity) {
      missing.push('entity');
    } else if (resolvedDomain === 'fee' && feeQueryRequiresProgramEntity(rawText, contract) && !resolvedEntity) {
      missing.push('entity');
    }

    // Only suppress clarification if missing semantic slots are resolved without conflict
    const suppressClarification = missing.length === 0;
    const effectiveQuery = buildEffectiveQuery(CONTEXT_TRANSITIONS.DOMAIN_SWITCH, resolvedDomain, resolvedIntent, resolvedEntity, rawText);

    return {
      transition: CONTEXT_TRANSITIONS.DOMAIN_SWITCH,
      resolvedDomain,
      resolvedIntent,
      resolvedEntity,
      missingSlots: missing,
      suppressClarification,
      effectiveQuery,
      reason: 'explicit_domain_switch'
    };
  }

  // If candidateEntity was present with domain cues but didn't switch domains
  if (candidateEntity) {
    const isDifferentEntity = !sessionState.activeEntity ||
      !sessionState.activeEntity.canonical ||
      sessionState.activeEntity.canonical.toLowerCase() !== candidateEntity.canonical.toLowerCase();

    if (isDifferentEntity) {
      const targetDomain = detectedCuesDomain || sessionState.activeDomain || (isCurrentDomainExplicit ? currentDomain : 'program');
      const targetIntent = (detectedCuesDomain && isCurrentIntentExplicit) ? currentIntent : (sessionState.activeIntent || currentIntent);

      const isCompatible = isEntityTypeCompatibleWithDomain(candidateEntity.type || 'program', targetDomain);
      if (isCompatible) {
        const effectiveQuery = buildEffectiveQuery(CONTEXT_TRANSITIONS.ENTITY_REPLACEMENT, targetDomain, targetIntent, candidateEntity, rawText);
        return {
          transition: CONTEXT_TRANSITIONS.ENTITY_REPLACEMENT,
          resolvedDomain: targetDomain,
          resolvedIntent: targetIntent,
          resolvedEntity: candidateEntity,
          missingSlots: [],
          suppressClarification: true,
          effectiveQuery,
          reason: 'entity_replacement_compatible'
        };
      }
    }
  }

  // =========================================================================
  // TRANSITION 4: AMBIGUOUS_REFERENCE
  // User uses anaphoric / demonstrative reference ("yang tadi", "prodi itu", "itu gimana")
  // =========================================================================
  if (hasAmbiguousReferenceCues(rawText) && sessionEntity) {
    const targetDomain = isCurrentDomainExplicit ? currentDomain : (detectedCuesDomain || sessionDomain);
    const targetIntent = isCurrentIntentExplicit ? currentIntent : sessionIntent;
    const effectiveQuery = buildEffectiveQuery(CONTEXT_TRANSITIONS.AMBIGUOUS_REFERENCE, targetDomain, targetIntent, sessionEntity, rawText);

    return {
      transition: CONTEXT_TRANSITIONS.AMBIGUOUS_REFERENCE,
      resolvedDomain: targetDomain,
      resolvedIntent: targetIntent,
      resolvedEntity: sessionEntity,
      missingSlots: [],
      suppressClarification: true,
      effectiveQuery,
      reason: 'anaphoric_reference_disambiguated'
    };
  }

  // =========================================================================
  // TRANSITION 5: INHERIT
  // Unanchored aspect/continuation query inheriting active context
  // =========================================================================
  if (isVerifiedAuthority || sessionEntity) {
    const targetDomain = isCurrentDomainExplicit ? currentDomain : (detectedCuesDomain || sessionDomain);
    const targetIntent = isCurrentIntentExplicit ? currentIntent : sessionIntent;
    let targetEntity = candidateEntity || null;
    if (!targetEntity && sessionEntity) {
      const priorEntityType = sessionEntity.type || 'program';
      if (isEntityTypeCompatibleWithDomain(priorEntityType, targetDomain)) {
        targetEntity = sessionEntity;
      }
    }

    const missing = [];
    if (targetDomain && (DOMAINS_REQUIRING_PROGRAM_ENTITY.has(targetDomain) || (targetDomain === 'fee' && feeQueryRequiresProgramEntity(rawText, contract)))) {
      if (!targetEntity) missing.push('entity');
    }
    if (!targetDomain || targetDomain === 'general') missing.push('domain');

    // Only suppress clarification if inherited context actually resolves the missing slots
    const suppressClarification = missing.length === 0;
    const effectiveQuery = buildEffectiveQuery(CONTEXT_TRANSITIONS.INHERIT, targetDomain, targetIntent, targetEntity, rawText);

    return {
      transition: CONTEXT_TRANSITIONS.INHERIT,
      resolvedDomain: targetDomain,
      resolvedIntent: targetIntent,
      resolvedEntity: targetEntity,
      missingSlots: missing,
      suppressClarification,
      effectiveQuery,
      reason: suppressClarification ? 'compatible_context_inherited' : 'inherited_slots_incomplete'
    };
  }

  // Fallback: NO_CONTEXT
  return {
    transition: CONTEXT_TRANSITIONS.NO_CONTEXT,
    resolvedDomain: isCurrentDomainExplicit ? currentDomain : null,
    resolvedIntent: isCurrentIntentExplicit ? currentIntent : null,
    resolvedEntity: candidateEntity || null,
    missingSlots: ['context_unverified'],
    suppressClarification: false,
    effectiveQuery: rawText,
    reason: 'session_context_not_verified'
  };
}

module.exports = {
  CONTEXT_TRANSITIONS,
  resolveContextAuthority,
  DOMAINS_REQUIRING_PROGRAM_ENTITY,
  feeQueryRequiresProgramEntity,
  isEntityTypeCompatibleWithDomain,
  detectDomainFromCues,
  hasAmbiguousReferenceCues
};
