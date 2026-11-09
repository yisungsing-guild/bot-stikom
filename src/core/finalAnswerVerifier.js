'use strict';

/**
 * src/core/finalAnswerVerifier.js
 *
 * Greenfield Universal Final Answer Verifier.
 * Invariants:
 * - NO TRUSTED SOURCE EXEMPTIONS.
 * - Every factual answer MUST pass this verification gate.
 *
 * Checks:
 * 1. Entity Alignment: If query is about DNUI, answer must NOT discuss HELP University.
 * 2. Raw Document Leak Detection: Ensures no internal database tags, SQL fragments, or chunk headers.
 * 3. Evidence Grounding: Answers must not contradict accepted evidence.
 */

const { VERIFICATION_OUTCOME } = require('../reasoning/contracts');

let canonicalFeeRegistry = null;
try {
  canonicalFeeRegistry = require('../../data/runtime/canonical_fee_registry.json');
} catch (e) {
  canonicalFeeRegistry = null;
}

let canonicalAcademicRegistry = null;
try {
  canonicalAcademicRegistry = require('../../data/runtime/canonical_academic_facts_registry.json');
} catch (e) {
  canonicalAcademicRegistry = null;
}

const RAW_DOCUMENT_LEAK_PATTERNS = [
  /GǪ.*GǪ/i,
  /\[chunk_\d+\]/i,
  /training_data_id/i,
  /governanceMetadata/i,
  /select\s+.*\s+from/i,
  /ragChunkCount/i,
  /Ringkasan dokumen:/i,
  /\[Sheet:\s*[^\]]+\]/i,
  /\|\s*col\d+\s*:/i,
  /PROGRAM STUDI SISTEM INFORMASI, TEKNOLOGI INFORMASI, DAN/i,
  /2\.\s*Profil Saat Ini\s*•\s*Status:\s*Perguruan tinggi bertaraf internasional/i,
  /Ketua Program Studi S1-/i
];

function failVerification(reason, extra = {}) {
  return {
    pass: false,
    outcome: VERIFICATION_OUTCOME.VERIFICATION_FAILED,
    status: VERIFICATION_OUTCOME.VERIFICATION_FAILED,
    reason,
    isGrounded: false,
    handledSafely: false,
    ...extra
  };
}

function verifyFinalAnswer(candidateAnswer, semanticFrame = {}, arbitratedEvidence = {}, comparisonEnvelope = null, recommendationResult = null) {
  if (Array.isArray(arbitratedEvidence)) {
    arbitratedEvidence = { accepted: arbitratedEvidence, rejected: [] };
  }
  const isExplicitNonRecTopic = /\b(?:biaya|spp|dpp|uang\s+kuliah|tarif|akreditasi|fakultas|fik|fbv|infokom|bisvo|(?:jurusan|prodi|program\s+studi)\s+apa\s+saja|apa\s+saja\s+(?:jurusan|prodi|program\s+studi))\b/i.test(semanticFrame?.rawQuery || '');
  const isRecommendation = !isExplicitNonRecTopic && (
    (recommendationResult && (recommendationResult.mode === 'RECOMMENDATION' || recommendationResult.provenance?.version === 'phase2-step7')) ||
    (semanticFrame && (semanticFrame.domain === 'ACADEMIC_RECOMMENDATION' || semanticFrame.intent === 'PROGRAM_RECOMMENDATION'))
  );

  if (isRecommendation) {
    const text = String(candidateAnswer || '').trim();
    if (!text) {
      return failVerification('empty_answer');
    }
    for (const pattern of RAW_DOCUMENT_LEAK_PATTERNS) {
      if (pattern.test(text)) {
        return failVerification('raw_document_metadata_leak_detected');
      }
    }
    if (/\bpasti\s+cocok\b/i.test(text) || /\bpasti\s+pilih\b/i.test(text)) {
      return failVerification('recommendation_absolute_claim_forbidden');
    }

    // Verify that no unoffered study programs are recommended
    const UNOFFERED_RECOMMENDATION_PROGRAMS = /\b(?:prodi|program\s+studi|jurusan|s1|d3|s2)\s+(?:kedokteran|teknik\s+sipil|teknik\s+mesin|teknik\s+elektro|hukum|ilmu\s+hukum|psikologi|farmasi|akuntansi|arsitektur|hubungan\s+internasional|sastra|keperawatan)\b/i;
    if (UNOFFERED_RECOMMENDATION_PROGRAMS.test(text) && !/\b(?:tidak\s+diselenggarakan|tidak\s+tersedia|belum\s+tersedia)\b/i.test(text)) {
      return failVerification('recommendation_mentions_unoffered_program');
    }

    const isExplicitAbstainInRec = /\b(belum\s+dapat\s+(?:dipastikan|diverifikasi)|tidak\s+dapat\s+(?:diverifikasi|dipastikan)|could\s+not\s+be\s+confirmed)\b/i.test(text);
    if (isExplicitAbstainInRec) {
      return {
        pass: false,
        outcome: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
        status: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
        reason: 'recommendation_insufficient_evidence_safe_unknown',
        isGrounded: false,
        handledSafely: true
      };
    }

    const isBroadOrClarificationRec = Boolean(
      recommendationResult?.isBroadGuidance ||
      recommendationResult?.isAmbiguous ||
      semanticFrame?.ambiguityLevel === 'HIGH' ||
      semanticFrame?.isAmbiguous ||
      /\b(?:Latar\s+belakang\s+sekolah\s+atau\s+minat\s+Kakak\s+bisa\s+masuk\s+ke\s+beberapa\s+program\s+studi|Supaya\s+rekomendasi\s+lebih\s+spesifik,\s+bidang\s+apa\s+yang\s+paling\s+Kakak\s+minati)\b/i.test(text)
    );
    if (
      arbitratedEvidence &&
      Array.isArray(arbitratedEvidence.accepted) &&
      arbitratedEvidence.accepted.length === 0 &&
      !isBroadOrClarificationRec
    ) {
      return failVerification('recommendation_lacks_accepted_evidence');
    }

    const { sanitizeWhatsAppMarkdown } = require('./outboundRenderer');
    const sanitized = sanitizeWhatsAppMarkdown(candidateAnswer);
    if (sanitized !== candidateAnswer) {
      return failVerification('outbound_sanitizer_non_idempotent');
    }
    if (!/admisi\s+PMB|ketentuan\s+resmi|admisi/i.test(text)) {
      return failVerification('recommendation_lacks_pmb_advisory');
    }
    return {
      pass: true,
      outcome: VERIFICATION_OUTCOME.VERIFIED_FACTUAL,
      status: VERIFICATION_OUTCOME.VERIFIED_FACTUAL,
      reason: 'verified_recommendation',
      isGrounded: true,
      handledSafely: true
    };
  }

  if (comparisonEnvelope && comparisonEnvelope.mode === 'COMPARATIVE') {
    const { renderTextFromPlan, validateComparisonEnvelope } = require('../reasoning/comparativeSynthesis');
    const { sanitizeWhatsAppMarkdown } = require('./outboundRenderer');

    const validation = validateComparisonEnvelope(comparisonEnvelope);
    if (!validation.valid) {
      return failVerification('comparative_envelope_invalid', { diagnosticCode: validation.code });
    }

    const expectedText = renderTextFromPlan(comparisonEnvelope.renderPlan);
    if (candidateAnswer !== expectedText) {
      return failVerification('comparative_text_divergence');
    }

    // Outbound fixed-point idempotence assertion
    const sanitized = sanitizeWhatsAppMarkdown(candidateAnswer);
    if (sanitized !== candidateAnswer) {
      return failVerification('outbound_sanitizer_non_idempotent');
    }

    return {
      pass: true,
      outcome: VERIFICATION_OUTCOME.VERIFIED_FACTUAL,
      status: VERIFICATION_OUTCOME.VERIFIED_FACTUAL,
      reason: 'verified_comparative',
      isGrounded: true,
      handledSafely: true
    };
  }

  const text = String(candidateAnswer || '').trim();
  if (!text) {
    return failVerification('empty_answer');
  }

  // 1. Raw Document Leak Check
  for (const pattern of RAW_DOCUMENT_LEAK_PATTERNS) {
    if (pattern.test(text)) {
      return failVerification('raw_document_metadata_leak_detected');
    }
  }

  // 2. Entity Alignment Check (Generic across all entities)
  const GENERIC_COMMON_WORDS = new Set([
    'akademik', 'kuliah', 'kampus', 'stikom', 'bali', 'mahasiswa', 'program',
    'studi', 'jurusan', 'fakultas', 'pendidikan', 'kurikulum', 'biaya', 'beasiswa',
    'fasilitas', 'gedung', 'kegiatan', 'organisasi',
    'double degree', 'dual degree', 'dua gelar', 'gelar ganda', 'national class', 'international',
    'program double degree', 'program dual degree', 'international dual degree', 'international double degree'
  ]);

  const { entities = [] } = semanticFrame;
  const retrievalPlan = arbitratedEvidence.retrievalPlan || arbitratedEvidence.arbitratedEvidence?.retrievalPlan;
  const excludedEntities = (retrievalPlan && retrievalPlan.excludedConflictingEntities) || [];

  const queryText = (semanticFrame.rawQuery || semanticFrame.normalizedQuery || '').toLowerCase();

  function isEntityUserBackgroundOnly(entStr, qText) {
    if (!entStr || entStr.length < 3 || !qText) return false;
    const clean = entStr.replace(/^(S1|S2|D3|D4)\s+/i, '').toLowerCase().trim();
    if (clean.length < 3) return false;
    const escClean = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escFull = entStr.toLowerCase().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const targetPattern = `(?:${escClean}|${escFull})`;

    const backgroundRegex = new RegExp(
      `(?:\\b(?:saya|aku|kami|gue|gw)\\s+(?:adalah\\s+)?(?:lulusan|alumni|tamatan|dari|mahasiswa|latar\\s+belakang|asal|background|sarjana|pemegang\\s+ijazah)\\s+(?:dari\\s+|jurusan\\s+|prodi\\s+|program\\s+studi\\s+|strata\\s*1\\s+|s1\\s+)?${targetPattern}\\b)|` +
      `(?:\\b(?:latar\\s+belakang|pendidikan\\s+terakhir|pendidikan\\s+sebelumnya|ijazah|asal\\s+jurusan)\\s+(?:saya|ku)\\s+(?:adalah\\s+)?(?:dari\\s+|jurusan\\s+|prodi\\s+|program\\s+studi\\s+|strata\\s*1\\s+|s1\\s+)?${targetPattern}\\b)|` +
      `(?:\\b(?:sebagai|karena\\s+(?:saya|aku))\\s+(?:lulusan|alumni|sarjana)\\s+(?:dari\\s+|jurusan\\s+|prodi\\s+|s1\\s+)?${targetPattern}\\b)`,
      'i'
    );

    if (!backgroundRegex.test(qText)) {
      return false;
    }

    const textWithoutBackground = qText.replace(backgroundRegex, ' ');
    const stillMentionedInInquiry = new RegExp(`\\b${targetPattern}\\b`, 'i').test(textWithoutBackground);
    return !stillMentionedInInquiry;
  }

  const genuineInquiryEntities = entities.filter(e => {
    const canon = e.canonical || e.name || String(e);
    return !isEntityUserBackgroundOnly(canon, queryText);
  });

  const isComparativeInquiry = Boolean(
    semanticFrame.intent === 'COMPARATIVE_INQUIRY' ||
    semanticFrame.intent === 'PROGRAM_COMPARISON' ||
    semanticFrame.isComparison === true ||
    semanticFrame.entityRelationships?.isComparison === true ||
    semanticFrame.speechAct === 'REQUEST_COMPARISON' ||
    semanticFrame.speechAct === 'COMPARE' ||
    /\b(?:perbedaan|beda(?:nya)?|banding(?:kan)?|dibandingkan|komparasi|versus|vs|mana\s+yang\s+lebih|sama\s+dengan|apakah\s+[\w\s]+\s+sama\s+dengan)\b/i.test(queryText) ||
    (Array.isArray(genuineInquiryEntities) && genuineInquiryEntities.length > 1 && genuineInquiryEntities.some(e => /prodi|program|s1|d3|s2/i.test(e.family || e.type || e.canonical || '')))
  );

  const hasComparativeFramingInAnswer = /\b(?:perbandingan\s+(?:program\s+studi|kurikulum|prodi)|berbeda\s+penempatannya\s+menurut\s+program|perbedaan\s+(?:utama|antara)|dibandingkan\s+dengan|berbeda\s+dengan)\b/i.test(text) ||
    (/(?:\bS1\s+[\w\s]+:\b.*\bS1\s+[\w\s]+:\b)/s.test(text) && /\b(?:berbeda|perbedaan|perbandingan|masing-masing|berdasarkan\s+program\s+studi)\b/i.test(text));

  const isStrictSingleProgramQuery = (genuineInquiryEntities.length === 1 || (retrievalPlan?.targetEntities && retrievalPlan.targetEntities.length === 1)) &&
    !isComparativeInquiry;

  const acceptedList = Array.isArray(arbitratedEvidence?.accepted)
    ? arbitratedEvidence.accepted
    : (Array.isArray(arbitratedEvidence?.arbitratedEvidence?.accepted) ? arbitratedEvidence.arbitratedEvidence.accepted : []);

  const PRODI_CANONICAL_BASES = {
    'si': 'sistem informasi',
    'bd': 'bisnis digital',
    'ti': 'teknologi informasi',
    'sk': 'sistem komputer',
    'mi': 'manajemen informatika',
    'dkv': 'desain komunikasi visual'
  };

  function isSiblingSupportedByAcceptedEvidence(entStr) {
    if (!entStr || entStr.length < 3) return false;
    const clean = entStr.replace(/^(S1|S2|D3|D4)\s+/i, '').toLowerCase().trim();
    if (clean.length < 3) return false;
    const entFull = entStr.toLowerCase().trim();
    const escapedClean = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const entityRegex = new RegExp(`\\b${escapedClean}\\b`, 'i');

    return acceptedList.some(chunk => {
      if (!chunk || typeof chunk !== 'object') return false;

      // 1. Explicit supportedEntities metadata in chunk that truly covers this entity
      if (Array.isArray(chunk.supportedEntities)) {
        const hasValidEntitySupport = chunk.supportedEntities.some(se => {
          if (!se) return false;
          const seStr = typeof se === 'string'
            ? se.trim()
            : (typeof se === 'object' && se !== null ? String(se.canonical || se.name || '').trim() : '');
          if (!seStr || seStr.length < 2) return false;

          const seFull = seStr.toLowerCase().trim();
          const seBase = seFull.replace(/^(s1|s2|d3|d4)\s+/i, '').trim();

          // Full exact match
          if (seFull === entFull) return true;
          // Base program exact match
          if (seBase.length >= 3 && seBase === clean) return true;

          // Validated acronym match (e.g. 'si' -> 'sistem informasi', 'bd' -> 'bisnis digital')
          if (PRODI_CANONICAL_BASES[seBase] && PRODI_CANONICAL_BASES[seBase] === clean) return true;
          if (PRODI_CANONICAL_BASES[clean] && PRODI_CANONICAL_BASES[clean] === seBase) return true;

          return false;
        });

        if (hasValidEntitySupport) return true;
      }

      const chunkText = (chunk.text || chunk.content || chunk.chunk || '').toLowerCase();
      const chunkDoc = (chunk.sourceFile || chunk.filename || chunk.sourceDocument || '').toLowerCase();

      // 2. Mention in chunk content with substantive topic correlation
      const mentionsEntityInText = entityRegex.test(chunkText);
      if (mentionsEntityInText) {
        const hasSubstantiveTopic = /\b(?:kurikulum|biaya|program\s+studi|prodi|jurusan|sks|semester|profil|lulusan|matakuliah|mata\s*kuliah)\b/i.test(chunkText);
        const isMultiProgramDoc = chunk.scope === 'PROGRAM_MULTI' ||
          /penjelasan\s+prodi|isian\s+website|rincian\s+biaya|pedoman|brosur/i.test(chunkDoc);
        if (hasSubstantiveTopic || isMultiProgramDoc) {
          return true;
        }
      }

      // 3. Document provenance specifically correlating to the checked entity (even in multi-program files)
      if (chunk.scope === 'PROGRAM_MULTI' && entityRegex.test(chunkDoc)) {
        return true;
      }

      return false;
    });
  }

  function isEntityExplicitlyRequestedInQuery(entStr) {
    if (!entStr || entStr.length < 3) return false;
    if (isEntityUserBackgroundOnly(entStr, queryText)) {
      return false;
    }
    const clean = entStr.replace(/^(S1|S2|D3|D4)\s+/i, '').toLowerCase().trim();
    if (clean.length < 3) return false;
    const escClean = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escFull = entStr.toLowerCase().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b(?:${escClean}|${escFull})\\b`, 'i').test(queryText);
  }

  const isDDInquiry = entities.some(e => /double\s*degree|dual\s*degree/i.test(e.canonical || e.name || String(e))) ||
    /\b(?:double|dual)\s*degree|dua\s*gelar\b/i.test(semanticFrame.rawQuery || '') ||
    (semanticFrame.aspects && semanticFrame.aspects.includes('double_degree'));

  const DD_COLLABORATING_PROGRAMS = new Set([
    's1 bisnis digital', 'bisnis digital', 's1 bd', 'bd',
    's1 sistem informasi', 'sistem informasi', 's1 si', 'si',
    's1 teknologi informasi', 'teknologi informasi', 's1 ti', 'ti',
    'sarjana bisnis digital', 'sarjana sistem informasi', 'prodi bd', 'prodi si'
  ]);

  const isUmbrellaInquiry = entities.some(e => {
    const canon = e.canonical || e.name || String(e);
    return /International Dual Degree/i.test(canon);
  }) || (!entities.some(e => /UTB|DNUI|HELP/i.test(e.canonical || e.name || String(e))) && isDDInquiry);

  const DD_MEMBER_ENTITIES = new Set([
    'utb', 'universitas teknologi bandung', 'dual degree utb', 'double degree utb',
    'dkv', 'desain komunikasi visual',
    'help university', 'help', 'double degree help', 'dual degree help',
    'dnui', 'dalian neusoft', 'dalian', 'double degree dnui', 'dual degree dnui'
  ]);

  const isS2Target = entities.some(e => /s2|magister|pascasarjana/i.test(e.canonical || e.name || String(e)));

  function isComparativeSentence(sentence, excluded) {
    const hasContrast = /\b(berbeda\s+(?:dengan|halnya|penempatannya)|dibandingkan|perbedaan(?:nya)?|sedangkan|sementara|tidak\s+seperti|differs?\s+(?:from)?|compared\s+(?:to|with)|whereas|while|unlike|contrast|difference)\b/i.test(sentence);
    const isPrerequisite = /\b(?:lulusan|ijazah|latar\s+belakang|sarjana|prasyarat|syarat\s+masuk|persyaratan|pendaftar|calon\s+mahasiswa|matrikulasi|s1\s*\/\s*d4|d4|graduate|graduates|prior\s+degree|background|bachelor|prerequisite|requirements)\b/i.test(sentence) && !/\b(?:double|dual)\s+degree\b/i.test(sentence);
    const isInstitutionalListing = /\b(?:pilih\s+(?:program\s+studi|prodi)|pilihan\s+(?:prodi|program|jenjang)|jenjang\s+dan\s+program\s+studi|daftar\s+pilihan\s+prodi|ringkasan\s+dokumen)\b/i.test(sentence);
    const isMultiProgramSharedDoc = /\[Program:\s*[^\]]+\]/i.test(sentence) ||
      (isSiblingSupportedByAcceptedEvidence(excluded) &&
        acceptedList.some(c => c.scope === 'PROGRAM_MULTI' || (Array.isArray(c.supportedEntities) && c.supportedEntities.length > 1)));
    const isS1PrereqForS2 = isS2Target && /^(?:s1|sarjana)\b/i.test(excluded) && (
      isPrerequisite ||
      /\b(?:pendidikan\s+sebelumnya|studi\s+sebelumnya|jenjang\s+sarjana|strata\s+1|asal\s+jurusan|latar\s+belakang\s+pendidikan|linier|non-?linier)\b/i.test(sentence)
    );
    const escaped = excluded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const isDirectSubject = new RegExp(`^(?:program\\s+studi|prodi|jurusan|study\\s+program|program|major)?\\s*${escaped}\\s+(?:adalah|merupakan|berfokus|memiliki|yaitu|is|focuses|offers)\\b`, 'i').test(sentence.trim());

    const isParallelComparativeItem = !isStrictSingleProgramQuery && (isComparativeInquiry || hasComparativeFramingInAnswer) &&
      /^(?:\d+\.|\*|\•|-)?\s*(?:\*\*)?(?:program\s+studi|prodi|jurusan)?\s*(?:S1|S2|D3|D4)?\s*[\w\s]+(?:\*\*)?[:\-]/i.test(sentence.trim());

    if (!isStrictSingleProgramQuery && (isComparativeInquiry || hasComparativeFramingInAnswer || isParallelComparativeItem)) {
      return hasContrast || isPrerequisite || isInstitutionalListing || isMultiProgramSharedDoc || isS1PrereqForS2 || isParallelComparativeItem;
    }

    return (hasContrast || isPrerequisite || isInstitutionalListing || isMultiProgramSharedDoc || isS1PrereqForS2) && !isDirectSubject;
  }

  const effectiveExcludedEntities = new Set(excludedEntities);
  for (const ent of entities) {
    const canon = ent.canonical || ent.name || String(ent);
    if (isEntityUserBackgroundOnly(canon, queryText)) {
      effectiveExcludedEntities.add(canon);
      const clean = canon.replace(/^(S1|S2|D3|D4)\s+/i, '').trim();
      if (clean && clean.length >= 4) {
        effectiveExcludedEntities.add(clean);
      }
    }
  }

  for (const excluded of effectiveExcludedEntities) {
    if (excluded && excluded.length >= 4) {
      if (GENERIC_COMMON_WORDS.has(excluded.toLowerCase().trim())) continue;
      if (isDDInquiry && (DD_COLLABORATING_PROGRAMS.has(excluded.toLowerCase().trim()) || (isUmbrellaInquiry && DD_MEMBER_ENTITIES.has(excluded.toLowerCase().trim())))) continue;

      // 1. Explicit Query Exemption: User explicitly asked about or requested this entity in query
      if (isEntityExplicitlyRequestedInQuery(excluded)) continue;

      // 2. Comparative Target Exemption: If inquiry is comparative and sibling is one of the target entities being compared
      if (isComparativeInquiry && genuineInquiryEntities.some(e => {
        const canon = (e.canonical || e.name || String(e)).toLowerCase().trim();
        const clean = canon.replace(/^(s1|s2|d3|d4)\s+/i, '');
        const exClean = excluded.toLowerCase().trim().replace(/^(s1|s2|d3|d4)\s+/i, '');
        return canon === excluded.toLowerCase().trim() || (clean.length >= 4 && clean === exClean);
      })) continue;

      const escaped = excluded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escaped}\\b`, 'i');
      if (regex.test(text)) {
        // 3. Evidence-backed comparative context
        const isSupportedByEvidence = isSiblingSupportedByAcceptedEvidence(excluded);
        const isContextuallyComparative = !isStrictSingleProgramQuery && (isComparativeInquiry || hasComparativeFramingInAnswer) && isSupportedByEvidence;

        if (!isContextuallyComparative) {
          // Differentiate legitimate educational comparative mentions from actual contradictions
          const sentences = text.split(/(?<=[.!?\n])\s+/);
          const allMatchesAreComparative = sentences
            .filter(s => regex.test(s))
            .every(s => isComparativeSentence(s, excluded));

          const hasTargetMention = entities.some(e => {
            const canon = (e.canonical || e.name || String(e)).replace(/^(S1|S2|D3|D4)\s+/i, '');
            const esc = canon.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`\\b${esc}\\b`, 'i').test(text);
          });

          if (!allMatchesAreComparative || !hasTargetMention) {
            return failVerification(`entity_contradiction_conflicting_sibling_in_answer: ${excluded}`);
          }
        }
      }

      // If excluded is a program (e.g. S1 Sistem Komputer), also check for program title patterns
      const base = excluded.replace(/^(S1|S2|D3|D4)\s+/i, '');
      const isSameBaseAsTarget = entities.some(e => {
        const canonical = e.canonical || e.name || String(e);
        const tb = canonical.replace(/^(S1|S2|D3|D4)\s+/i, '').toLowerCase();
        return tb === base.toLowerCase();
      });

      if (!isSameBaseAsTarget && base !== excluded && base.length >= 5) {
        if (isEntityExplicitlyRequestedInQuery(base)) continue;

        const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const titleRegex = new RegExp(`(?:Program\\s+Studi|Prodi|Jurusan)\\s+${escapedBase}\\b|\\b${escapedBase}\\s*\\((?:S1|S2|D3|D4)\\)`, 'i');
        if (titleRegex.test(text)) {
          const isSupportedByEvidence = isSiblingSupportedByAcceptedEvidence(base);
          const isContextuallyComparative = !isStrictSingleProgramQuery && (isComparativeInquiry || hasComparativeFramingInAnswer) && isSupportedByEvidence;

          if (!isContextuallyComparative) {
            const sentences = text.split(/(?<=[.!?\n])\s+/);
            const allComparative = sentences
              .filter(s => titleRegex.test(s))
              .every(s => isComparativeSentence(s, base));
            if (!allComparative) {
              return failVerification(`entity_contradiction_conflicting_sibling_in_answer: ${excluded}`);
            }
          }
        }
      }
    }
  }

  const isUnsupported = Boolean(
    arbitratedEvidence?.unsupportedEntity ||
    arbitratedEvidence?.retrievalPlan?.unsupportedEntity ||
    arbitratedEvidence?.retrievalPlan?.isUnsupportedEntity ||
    arbitratedEvidence?.unconfirmedProgram ||
    arbitratedEvidence?.retrievalPlan?.unconfirmedProgram ||
    semanticFrame?.unconfirmedProgram ||
    semanticFrame?.isUnsupportedEntity ||
    semanticFrame?.unsupportedEntity ||
    semanticFrame?.domain === 'UNSUPPORTED_PROGRAM' ||
    /tidak diselenggarakan di ITB STIKOM Bali|is currently not offered at ITB STIKOM Bali|tidak ditemukan dalam daftar program yang tersedia saat ini|belum dapat dikonfirmasi dari daftar resmi/i.test(text)
  );

  // 3. Temporal Claim Grounding Check (Detect ungrounded currentness claims)
  const temporalClaimPattern = /\b(saat ini|sekarang|hari ini|masih buka|masih dibuka|masih tersedia|masih menerima|sudah tutup|telah ditutup|sedang aktif|berlaku aktif|currently|at present|now|still open|still active|closed)\b/i;
  const isSafeAdmissionsReferral = semanticFrame.intent === 'CURRENT_ENROLLMENT_STATUS' ||
    /\b(?:portal\s+resmi\s+pmb|ruang\s+layanan\s+pmb|layanan\s+telepon\s+pmb|pmb\.stikom-bali\.ac\.id)\b/i.test(text);
  if (temporalClaimPattern.test(text) && !isUnsupported && !isSafeAdmissionsReferral) {
    // If the answer asserts a temporal claim, arbitrated evidence must exist
    if (!arbitratedEvidence.accepted || arbitratedEvidence.accepted.length === 0) {
      return failVerification('unsupported_temporal_claim_zero_evidence');
    }

    // If query has constraint NOW, verify that accepted evidence actually supports temporal validity
    if (semanticFrame.temporal && semanticFrame.temporal.constraint === 'NOW') {
      const currentYear = new Date().getFullYear();
      const hasTemporalEvidence = arbitratedEvidence.accepted.some(c => {
        const cText = (c.text || '').toLowerCase();
        return cText.includes(String(currentYear)) ||
          cText.includes(String(currentYear - 1)) ||
          /\b(periode 202[1-6]-202[6-9]|berlaku sampai 202[6-9]|baik sekali|sk|surat keputusan)\b/i.test(cText);
      });
      if (!hasTemporalEvidence) {
        return failVerification('unsupported_temporal_claim_lacks_valid_temporal_evidence');
      }
    }
  }

  // 4. Aspect / Requested Field Consistency Check
  const isFeeInquiry = (semanticFrame.domain === 'TUITION_FEE' ||
    (semanticFrame.aspects && semanticFrame.aspects.some(a => ['fee', 'tuition', 'dpp'].includes(a)))) && !isUnsupported;

  if (isFeeInquiry) {
    const hasFeeKeywords = /\b(biaya|pendidikan|dpp|spp|uang pangkal|rp|cicil|pembayaran|nominal|fee|fees|tuition|cost|costs|costing|pay|pays|paying|payment|payments|installment|installments|price|prices)\b/i.test(text);
    const hasCurriculumOnly = /\b(semester\s+[ivx\d]+\s+no\s+nama\s+mata\s+kuliah|praktikum\s+[a-z]+|kurikulum\s+2025)\b/i.test(text) && !hasFeeKeywords;
    if (!hasFeeKeywords || hasCurriculumOnly) {
      return failVerification('aspect_mismatch_answer_lacks_fee_evidence');
    }
  }

  // 4b. Admission Procedure Grounding Check
  const isProcedureInquiry = (semanticFrame.domain === 'PMB' &&
    (semanticFrame.intent === 'ADMISSION_PROCEDURE' || (semanticFrame.aspects && semanticFrame.aspects.includes('procedure')))) &&
    !isUnsupported;

  if (isProcedureInquiry) {
    const hasProcedureStepsClaim = /\b(?:tahapan\s+(?:online|pendaftaran)|langkah(?:-langkah)?\s+(?:pendaftaran|daftar)|alur\s+pendaftaran|prosedur\s+pendaftaran)\b/i.test(text) &&
      /\b(?:1\.\s+|•\s+|pertama)\b/i.test(text);
    if (hasProcedureStepsClaim) {
      const hasAcceptedProcedure = (arbitratedEvidence.accepted || []).some(c => {
        const cText = (c.text || c.chunk || '').toLowerCase();
        return /\b(?:alur|tahap(?:an)?|langkah|prosedur|panduan|tata\s+cara)\s+(?:pendaftaran|daftar|mendaftar)\b/i.test(cText) ||
          (/\b(?:pendaftaran|daftar)\b/i.test(cText) && /\b(?:tahap\s*(?:1|2|3|i|ii|iii|pertama|kedua)|langkah\s*(?:1|2|3|pertama|kedua))\b/i.test(cText));
      });
      if (!hasAcceptedProcedure) {
        return failVerification('unsupported_admission_procedure_steps_zero_evidence');
      }
    }
  }

  let isAdvisingInquiry = semanticFrame.domain === 'ACADEMIC_PROCESS' ||
    semanticFrame.intent === 'ACADEMIC_ADVISING_INQUIRY' ||
    (semanticFrame.aspects && semanticFrame.aspects.some(a => ['academic_advising', 'dosen_wali', 'perwalian'].includes(a)));

  const isCurriculumInquiry = !isAdvisingInquiry && (semanticFrame.domain === 'ACADEMIC_CURRICULUM' ||
    (semanticFrame.aspects && semanticFrame.aspects.some(a => ['curriculum', 'courses', 'competencies'].includes(a))));

  if (isCurriculumInquiry && !isUnsupported) {
    const hasCurriculumKeywords = /\b(berfokus|mempelajari|kurikulum|mata\s*kuliah|matkul|sks|semester|silabus|kompetensi|pembelajaran|fokus|bidang|pemrograman|keahlian|focus(?:es|ed|ing)?|learn(?:s|ing|ed)?|stud(?:y|ies|ied|ying)|teach(?:es|ing)?|taught|cover(?:s|ed|ing)?|skill(?:s)?|hardware|software|network(?:s|ing)?|programming|system(?:s)?|specializ(?:e|es|ed|ing|ation)|curriculum|courses?|credits?|semesters?|syllabus|competenc(?:y|ies)|degree(?:s)?|duration|career(?:s)?|jobs?|roles?|graduates?|qualification(?:s)?|prerequisite(?:s)?|requirement(?:s)?|defen(?:d|se|ses)|final\s+project|thesis|tugas\s+akhir|transcript|registration|clearance|supervis(?:or|ion)|advis(?:or|ing)|persyaratan|syarat|skripsi|bimbingan)\b/i.test(text);
    const isCurriculumAbstain = /\b(belum\s+(?:tercantum|tersedia|ditemukan|memuat|cukup)|tidak\s+(?:ditemukan|tersedia|tercantum|memuat)|tidak\s+dapat\s+(?:diverifikasi|dipastikan)|belum\s+dapat\s+dipastikan|not\s+(?:listed|found|available|recorded)|unrecorded)\b/i.test(text);
    if (!hasCurriculumKeywords && !isCurriculumAbstain) {
      return failVerification('aspect_mismatch_answer_lacks_curriculum_evidence');
    }
  }

  const isContactInquiry = semanticFrame.intent === 'PMB_CONTACT_INQUIRY' ||
    (semanticFrame.aspects && semanticFrame.aspects.includes('contact'));

  if (isContactInquiry && !isUnsupported) {
    const hasContactDetails = /\b(whatsapp|wa|telepon|telp|nomor|call|phone|contact|email|humas|pmb|hotline|08[\d\-.\s]{8,}|0361|\.ac\.id)\b/i.test(text);
    const isExplicitAbstain = /tidak\s+ditemukan|belum\s+(?:tersedia|tercantum|disebutkan|terdapat)|tidak\s+dapat\s+diverifikasi|not\s+(?:listed|found|available|recorded)|unrecorded/i.test(text);
    if (!hasContactDetails && !isExplicitAbstain) {
      return failVerification('aspect_mismatch_answer_lacks_contact_evidence');
    }
  }

  // 5. Unsolicited Recommendation Check (Only allowed if user explicitly requested recommendations)
  const isRecommendationInquiry = semanticFrame.domain === 'ACADEMIC_RECOMMENDATION' ||
    semanticFrame.intent === 'PROGRAM_RECOMMENDATION';

  if (!isRecommendationInquiry) {
    const unsolicitedRecommendationRegex = /\b(rekomendasi\s+untuk\s+(?:anda|kamu|kakak)|program\s+studi\s+yang\s+(?:paling\s+)?cocok\s+untuk\s+(?:anda|kamu|kakak)|jika\s+(?:anda|kamu|kakak)\s+(?:tertarik|berminat)\b[^\n]*\bpilihlah\b)\b/i;
    if (unsolicitedRecommendationRegex.test(text)) {
      return failVerification('unsolicited_recommendation_in_non_recommendation_inquiry');
    }
  }

  // 6. Heading Repetition / Raw Fragment Stacking Check
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length >= 25);
  const lineCounts = {};
  for (const line of lines) {
    lineCounts[line] = (lineCounts[line] || 0) + 1;
    if (lineCounts[line] >= 3) {
      return failVerification('repeated_heading_or_fragment_detected');
    }
  }

  // 7. Negative Controls & Domain-Aspect Integrity Checks
  const rawQuery = String(semanticFrame.rawQuery || '').toLowerCase();

  // 7a. Accreditation negative control: Must not be answered with Double Degree
  const isAccreditationQuery = semanticFrame.domain === 'ACCREDITATION' ||
    (semanticFrame.aspects && semanticFrame.aspects.includes('accreditation')) ||
    /\b(?:akreditasi|peringkat\s+akreditasi|ban-?pt|lam\s+infokom)\b/i.test(rawQuery);
  if (isAccreditationQuery && !/\b(?:dual|double)\s*degree\b/i.test(rawQuery)) {
    if (/\b(?:dual|double)\s*degree|national\s*class|utb\b/i.test(text) && !/\bakreditasi\b/i.test(text)) {
      return failVerification('domain_aspect_mismatch_accreditation_answered_with_double_degree');
    }

    // Ungrounded numeric accreditation score check (e.g. hallucinating "nilai 303" from SK number 3033)
    const scoreMatch = text.match(/\b(?:nilai|skor)\s+(\d{2,4})\b/i);
    if (scoreMatch) {
      const claimedScore = scoreMatch[1];
      const acceptedTexts = (arbitratedEvidence.accepted || []).map(c => (c.text || c.chunk || '').toLowerCase()).join(' ');
      const hasVerifiedScore = new RegExp(`\\b(?:nilai|skor)\\s+${claimedScore}\\b`, 'i').test(acceptedTexts);
      if (!hasVerifiedScore) {
        return failVerification(`unsupported_accreditation_score_claim: nilai ${claimedScore}`);
      }
    }
  }

  // 7a2. Curriculum table dump negative control: Must not dump full 8 semesters for specific non-curriculum inquiries
  const hasFullCurriculumDump = /\bSemester\s+I\s*\([^)]*\):.*Semester\s+VIII\s*\([^)]*\):/is.test(text) ||
    (/\bSemester\s+I\b/i.test(text) && /\bSemester\s+VIII\b/i.test(text) && /\b144\s*SKS\b/i.test(text));
  if (hasFullCurriculumDump) {
    const isExplicitCurriculumQuery = /\b(?:kurikulum(?:nya)?|mata\s*kuliah(?:nya)?|matkul(?:nya)?|sebaran\s*matkul|silabus|daftar\s*matkul|ambil\s*apa\s*saja)\b/i.test(rawQuery);
    const isSpecificPrerequisiteOrThesis = /\b(?:coding|jago|halaman|lembar|tebal|tugas\s+akhir|skripsi|sion|spesifikasi\s+komputer|butuh\s+komputer)\b/i.test(rawQuery);
    if (!isExplicitCurriculumQuery || isSpecificPrerequisiteOrThesis) {
      return failVerification('aspect_mismatch_curriculum_dump_for_non_curriculum_query');
    }
  }

  // 7a3. Curriculum multi-semester completeness check:
  // If user explicitly asks for Semester I-VIII, a range like 1-8, or all semesters,
  // the answer must cover all 8 semesters (Semester I through Semester VIII).
  // A partial answer (e.g. only Semester I) must not be declared VERIFIED_FACTUAL.
  const isFullCurriculumRangeInquiry = /\b(?:semua|seluruh)\s+semester\b/i.test(rawQuery) ||
    /\b(?:dari\s+)?semester\s*(?:1|i)\s*(?:sampai|hingga|s\/?d|-)\s*(?:semester\s*)?(?:8|viii)\b/i.test(rawQuery) ||
    (/\b(?:1|i)\s*(?:sampai|hingga|s\/?d|-)\s*(?:8|viii)\b/i.test(rawQuery) && /semester|matkul|mata\s*kuliah/i.test(rawQuery));

  if (isFullCurriculumRangeInquiry && isCurriculumInquiry && !isUnsupported) {
    const requiredSemesters = ['Semester I', 'Semester II', 'Semester III', 'Semester IV', 'Semester V', 'Semester VI', 'Semester VII', 'Semester VIII'];
    const missingSemesters = requiredSemesters.filter(sem => !text.includes(sem));
    if (missingSemesters.length > 0) {
      return failVerification(`curriculum_range_incomplete: user requested Semester 1-8 but answer is missing ${missingSemesters.join(', ')}`);
    }
  }

  // 7b. Facilities negative control: Must not use facility list as substantive Double Degree claim
  const isInbisQuery = (semanticFrame.aspects && semanticFrame.aspects.some(a => ['inbis_overview', 'tenant_programs', 'p2mw', 'inbis_services', 'incubation_programs'].includes(a))) ||
    semanticFrame.relation === 'INBIS_SERVICE' ||
    /\b(?:inbis|inkubator\s+bisnis|p2mw|tenant|startup|kewirausahaan|wirausaha\s+(?:pemula|mahasiswa)|inkubasi)\b/i.test(rawQuery) ||
    (Array.isArray(semanticFrame.entities) && semanticFrame.entities.some(e => /inbis|inkubator/i.test(e.canonical || '')));
  const isFacilityInquiry = !isInbisQuery && (semanticFrame.domain === 'FACILITIES' ||
    (semanticFrame.aspects && semanticFrame.aspects.some(a => ['facilities', 'lab', 'campus_infrastructure'].includes(a))));
  if (isFacilityInquiry && !/\b(?:double|dual)\s*degree\b/i.test(rawQuery)) {
    const isGroundedFacilityList = /\b(?:fasilitas|laboratorium|career\s+center|inkubator\s+bisnis|language\s+learning\s+center|ukm)\b/i.test(text);
    if (!isGroundedFacilityList && /\b(?:dual|double)\s*degree\s+(?:national|nasional)\b/i.test(text)) {
      return failVerification('domain_aspect_mismatch_facilities_answered_with_double_degree');
    }
  }

  // 7c. National Double Degree Integrity Checks
  const isNationalDDQuery = /\bnasional\b/i.test(rawQuery) &&
    (semanticFrame.aspects?.includes('double_degree') ||
      semanticFrame.relation === 'NATIONAL_DOUBLE_DEGREE' ||
      /\b(?:dual|double)\s*degree|dua\s*gelar\b/i.test(rawQuery) ||
      semanticFrame.contextDependencies?.some(cd => /double\s*degree/i.test(cd.inheritedEntity || '')));

  if (isNationalDDQuery) {
    // Cannot claim partner is Universitas Teknologi Bali (must be Bandung / UTB)
    if (/universitas\s+teknologi\s+bali/i.test(text)) {
      return failVerification('partner_name_contradiction_bali_instead_of_bandung');
    }

    // Cannot mention international partners (HELP / DNUI) for national double degree query
    if (/\b(?:HELP\s+University|DNUI|Dalian)\b/i.test(text) && !/\b(?:pilihan\s+internasional|selain\s+nasional)\b/i.test(text)) {
      return failVerification('international_partner_contamination_for_national_double_degree');
    }

    // Cannot claim S.Kom for UTB National Double Degree (only S.Bns and S.Ds)
    if (/\bS\.Kom\b/i.test(text)) {
      return failVerification('incorrect_degree_award_for_national_double_degree');
    }

    // Cannot claim 4 years full offline study duration from unrelated programs
    if (/\b(?:full\s+offline|selama\s+4\s+tahun|4\s+tahun\s+di\s+kampus\s+itb\s+stikom\s+bali)\b/i.test(text)) {
      return failVerification('fabricated_study_duration_for_national_double_degree');
    }

    // Cannot use facility framing ("daftar program/fasilitas kampus") as substitute for program
    if (/daftar\s+(?:program\s*\/\s*)?fasilitas\s+kampus/i.test(text)) {
      return failVerification('forbidden_facility_framing_for_national_double_degree');
    }

    // Unjustified refusal check when UTB evidence is present in accepted evidence
    const hasUtbAccepted = arbitratedEvidence?.accepted?.some(c => {
      const cText = c.text || c.chunk || '';
      return /\b(?:UTB|UNIVERSITAS\s+TEKNOLOGI\s+BANDUNG)\b/i.test(cText);
    });

    if (hasUtbAccepted) {
      const isRefusingPartner = /\b(?:mitra.*belum\s+tercantum|rincian\s+mengenai\s+mitra.*belum|belum\s+tercantum\s+dalam\s+panduan)\b/i.test(text);
      if (isRefusingPartner && !/\b(?:Bandung|UTB)\b/i.test(text)) {
        return failVerification('unjustified_refusal_national_partner_available');
      }
    }
  }

  // 7d. Academic Process & Advising Grounding Guards (Fidelity against hallucinations)
  isAdvisingInquiry = isAdvisingInquiry || semanticFrame.domain === 'ACADEMIC_PROCESS' ||
    semanticFrame.intent === 'ACADEMIC_ADVISING_INQUIRY' ||
    (semanticFrame.aspects && (semanticFrame.aspects.includes('academic_advising') || semanticFrame.aspects.includes('dosen_wali') || semanticFrame.aspects.includes('krs')));

  if (isAdvisingInquiry) {
    const acceptedTexts = (arbitratedEvidence.accepted || []).map(c => (c.text || c.chunk || '').toLowerCase()).join(' ');

    // 1. Location hallucination check (e.g. Laboratorium Database, Lantai 3, Kampus Renon)
    const mentionsLabDb = /\b(?:lab(?:oratorium)?\s+database|lantai\s+3)\b/i.test(text);
    if (mentionsLabDb && !/\b(?:lab(?:oratorium)?\s+database|lantai\s+3)\b/i.test(acceptedTexts)) {
      return failVerification('unsupported_factual_claim_location: Lab Database Lantai 3 not in accepted evidence');
    }

    // 2. Document & payment obligation hallucination for late advising
    const mentionsMandatoryPaymentProof = /\b(?:membawa\s+(?:bukti\s+pembayaran|krs\s+manual)|wajib\s+membawa\s+bukti)\b/i.test(text);
    if (mentionsMandatoryPaymentProof && !/\b(?:membawa\s+(?:bukti\s+pembayaran|krs\s+manual)|wajib\s+membawa\s+bukti)\b/i.test(acceptedTexts)) {
      return failVerification('unsupported_factual_claim_document_obligation: proof of payment / manual KRS not in accepted evidence');
    }

    // 3. Polling and payment translation into dosen wali approval
    const conflatesPollingWithApproval = /\b(?:polling[^\n.]*persetujuan\s+dosen\s+wali|persetujuan\s+dosen\s+wali[^\n.]*polling)\b/i.test(text);
    if (conflatesPollingWithApproval && !/\bpersetujuan\s+dosen\s+wali\b/i.test(acceptedTexts)) {
      return failVerification('unsupported_factual_claim_polling_approval: polling conflated with dosen wali approval');
    }

    // 4. Metric distortion: credit limit must not claim IPS when evidence specifies IPK or general IP
    const mentionsIPS = /\bIPS\s+(?:semester|sebelumnya)\b/i.test(text);
    if (mentionsIPS && !/\bIPS\b/i.test(acceptedTexts)) {
      return failVerification('unsupported_factual_claim_credit_limit_metric: IPS claimed without evidence');
    }
  }

  // 7e. Tuition Fee Grounding & Calculation Invariants
  if (isFeeInquiry) {
    const feeQueryText = String(semanticFrame.rawQuery || semanticFrame.normalizedQuery || '').trim();

    // 1. General invariant: Prevent claiming ungrounded discounts or equating unverified waves without proof
    // Pattern captures sub-waves (e.g. 1A, 1B, 2C, 3B, II-C) or out-of-range custom waves
    const subWaveOrUnverifiedPattern = /\bgelombang\s*(?:[1-4]\s*[-_]?\s*[a-z]\b|(?:iv|iii|ii|i)\s*[-_]?\s*[a-hj-uw-z]\b|[5-9]\b)/i;
    const mentionsUnverifiedWave = subWaveOrUnverifiedPattern.test(feeQueryText) || subWaveOrUnverifiedPattern.test(text);

    if (mentionsUnverifiedWave) {
      const claimsUnverifiedDiscount = /\b(?:potongan|diskon|beasiswa)\b/i.test(text) &&
        subWaveOrUnverifiedPattern.test(text) &&
        !/\b(?:tidak\s+tercantum|belum\s+(?:terverifikasi|tersedia|dapat\s+dipastikan)|catatan|source_gap)\b/i.test(text);
      if (claimsUnverifiedDiscount) {
        const is2C = /2[cC]|ii[-_ ]*[cC]/i.test(text) || /2[cC]|ii[-_ ]*[cC]/i.test(feeQueryText);
        return failVerification(is2C ? 'ungrounded_fee_wave_claim_gelombang_2c_without_proof' : 'ungrounded_fee_wave_claim_unverified_without_proof');
      }

      const equatesWithoutProof = /\b(?:adalah|sama\s*(?:persis\s+)?(?:dengan)?|merupakan\s+bagian\s+dari)\s+gelombang\s+(?:khusus|i{1,4}|[1-4]|sisipan)\b/i.test(text) &&
        !/\b(?:tidak\s+dapat\s+disamakan|belum\s+terverifikasi|tidak\s+tercantum)\b/i.test(text);
      if (equatesWithoutProof) {
        const is2C = /2[cC]|ii[-_ ]*[cC]/i.test(text) || /2[cC]|ii[-_ ]*[cC]/i.test(feeQueryText);
        return failVerification(is2C ? 'ungrounded_fee_wave_claim_gelombang_2c_equated_without_proof' : 'ungrounded_fee_wave_claim_equated_without_proof');
      }
    }

    // 2. Prevent double counting DPP and DPP installments in the same calculation
    if (/\b(?:total|subtotal)\b/i.test(text)) {
      const hasDppAndInstallmentDoubleCount = /\bdpp\s+.*cicilan\s+dpp\s+.*total/i.test(text);
      if (hasDppAndInstallmentDoubleCount) {
        return failVerification('fee_arithmetic_double_counted_dpp_and_installment');
      }
    }

    // 3. S2 vs S1 fee isolation: S2 inquiry must not output S1 DPP (Rp 14.000.000 or Rp 11.000.000)
    const isS2Fee = (semanticFrame.entities || []).some(e => /s2|magister|pascasarjana/i.test(e.canonical || e.name || String(e))) ||
      /\b(?:s2|magister|pascasarjana)\b/i.test(rawQuery);
    if (isS2Fee) {
      if (/\b(?:14\.000\.000|11\.000\.000|6\.500\.000|5\.500\.000)\b/.test(text)) {
        return failVerification('degree_fee_pollution_s1_fees_in_s2_answer');
      }
    }

    // 4. Double-counting & component conflation protection: Prevent conflating semester fee into initial obligation
    if (/\b(?:total\s+(?:kewajiban\s+)?awal|total\s+biaya\s+awal)\b/i.test(text)) {
      if (/\b(?:22\.500\.000|19\.200\.000)\b/.test(text)) {
        return failVerification('fee_arithmetic_conflated_semester_fee_into_initial_total');
      }
    }

    // 5. D3 fee classification invariant: D3's Biaya Registrasi must NEVER be classified or labeled as DPP
    if (/D3\s+Manajemen\s+Informatika/i.test(text)) {
      if (/\b(?:DPP|Dana\s+Pendidikan\s+Pokok)(?:\s+dasar)?\s*:\s*(?:Rp\s*)?10\.000\.000/i.test(text) ||
        /\bD3\s+Manajemen\s+Informatika[^\n]*\bDPP\s*:\s*Rp/i.test(text) ||
        /\bDPP\s+D3\s+Manajemen/i.test(text)) {
        return failVerification('d3_fee_misclassified_as_dpp');
      }
    }

    // 6. 10% Cash DPP Discount claim verification:
    // Primary sources (Lampiran 1-3, 6): Valid only for S1 SI, TI, BD, SK, D3 MI, and S1 UTB.
    // S2 Pascasarjana and Double Degree HELP/DNUI do not have cash DPP 10% discount.
    const claims10PctDppDiscount = /\b(?:10%|10\s*persen|sepuluh\s+persen)/i.test(text) &&
      /\b(?:tunai|lunas|pelunasan|cash)\b/i.test(text) &&
      /\b(?:dpp|dana\s+pendidikan\s+pokok|potongan\s+ditambah|diskon\s+tambahan|potongan|diskon)\b/i.test(text);

    if (claims10PctDppDiscount) {
      const topEntity = (semanticFrame.entities && semanticFrame.entities[0])
        ? (semanticFrame.entities[0].canonical || semanticFrame.entities[0].name || String(semanticFrame.entities[0]))
        : '';
      const queryStr = String(semanticFrame.rawQuery || semanticFrame.normalizedQuery || '');
      const isS2Target = /s2|magister|pascasarjana/i.test(topEntity) || /\b(?:s2|magister|pascasarjana)\b/i.test(queryStr);
      if (isS2Target) {
        return failVerification('unsupported_10pct_cash_discount_claim_for_s2');
      }

      const isDoubleDegreeTarget = /double\s+degree|dual\s+degree|help|dnui/i.test(topEntity) || /\b(?:double\s+degree|dual\s+degree|help|dnui)\b/i.test(queryStr);
      if (isDoubleDegreeTarget) {
        return failVerification('unsupported_10pct_cash_discount_claim_for_double_degree');
      }

      const isD3Target = /d3|manajemen\s+informatika/i.test(topEntity) || /\b(?:d3|manajemen\s+informatika)\b/i.test(queryStr);
      if (isD3Target && /biaya\s+registrasi/i.test(text) && /\b(?:10%|10\s*persen|sepuluh\s+persen)/i.test(text)) {
        return failVerification('unsupported_10pct_cash_discount_claim_for_d3_registration');
      }

      const canonicalFeeRegistry = require('../../data/runtime/canonical_fee_registry.json');
      const canonicalProfile = (canonicalFeeRegistry && canonicalFeeRegistry.programs && topEntity)
        ? (canonicalFeeRegistry.programs[topEntity] || null)
        : null;

      const acceptedTexts = (arbitratedEvidence.accepted || []).map(c => (c.text || c.chunk || '').toLowerCase()).join(' ');
      const has10PctEvidence = /\b(?:10%|10\s*persen|sepuluh\s+persen)/i.test(acceptedTexts) && /\b(?:tunai|dpp|potongan)\b/i.test(acceptedTexts);
      const has10PctInRegistry = canonicalProfile ? (
        canonicalProfile.components?.dpp?.cashDiscountPercent === 10 ||
        canonicalProfile.cashDiscountPercentage === 10 ||
        canonicalProfile.cashDppDiscountRate === 0.1 ||
        canonicalProfile.notes?.cashDppDiscount
      ) : (
        Object.values(canonicalFeeRegistry?.programs || {}).some(p =>
          p.components?.dpp?.cashDiscountPercent === 10 ||
          p.cashDiscountPercentage === 10 ||
          p.cashDppDiscountRate === 0.1 ||
          p.notes?.cashDppDiscount
        )
      );

      if (!has10PctEvidence && !has10PctInRegistry) {
        return failVerification('unsupported_10pct_cash_discount_claim_without_evidence');
      }
    }

    // 7. Fee nominal provenance check against accepted evidence and canonical registry
    const rpGlobalRegex = /Rp\s*([\d\.]+)/gi;
    let rpMatch;
    const feeClaims = [];
    while ((rpMatch = rpGlobalRegex.exec(text)) !== null) {
      const idx = rpMatch.index;
      const numClean = rpMatch[1].replace(/\./g, '').trim();
      const numVal = parseInt(numClean, 10);
      if (!isNaN(numVal) && numVal > 0) {
        const lineStart = text.lastIndexOf('\n', idx);
        const currentLine = text.substring(lineStart === -1 ? 0 : lineStart, idx).toLowerCase();
        let clauseStart = lineStart;
        for (let i = idx - 1; i > lineStart; i--) {
          if (text[i] === ';' || text[i] === '+' || text[i] === '(' || text[i] === ')' || text[i] === ',' || (text[i] === '.' && /\s/.test(text[i + 1] || ''))) {
            clauseStart = i + 1;
            break;
          }
        }
        const currentClause = text.substring(clauseStart === -1 ? 0 : clauseStart, idx).toLowerCase().replace(/^\*+|\*+$/g, '').trim();
        const precedingContext = text.substring(lineStart === -1 ? 0 : lineStart, idx).toLowerCase();
        const immPreceding = text.substring(Math.max(lineStart === -1 ? 0 : lineStart, idx - 85), idx).toLowerCase();

        let afterIdx = idx + rpMatch[0].length;
        let lineEnd = text.indexOf('\n', afterIdx);
        if (lineEnd === -1) lineEnd = text.length;
        let clauseEnd = lineEnd;
        for (let i = afterIdx; i < lineEnd; i++) {
          if (text[i] === ';' || text[i] === '+' || text[i] === '(' || text[i] === ')' || text[i] === ',' || (text[i] === '.' && /\s/.test(text[i + 1] || ''))) {
            clauseEnd = i;
            break;
          }
        }
        const followingClause = text.substring(afterIdx, clauseEnd).toLowerCase().replace(/^\*+|\*+$/g, '').trim();
        const immFollowing = text.substring(afterIdx, Math.min(text.length, afterIdx + 85)).toLowerCase();
        feeClaims.push({ numVal, numClean, currentLine, currentClause, followingClause, precedingContext, immPreceding, immFollowing, matchText: rpMatch[0], charIndex: idx });
      }
    }

    if (feeClaims.length > 0) {
      const entityName = (semanticFrame.entities && semanticFrame.entities[0])
        ? (semanticFrame.entities[0].canonical || semanticFrame.entities[0].name || String(semanticFrame.entities[0]))
        : '';

      const hasNominalInEvidence = (numVal, numClean) => {
        if (!arbitratedEvidence.accepted || arbitratedEvidence.accepted.length === 0) return false;
        const formatted = numVal.toLocaleString('id-ID');

        return arbitratedEvidence.accepted.some(c => {
          const txt = (c.text || c.chunk || c.content || '').toLowerCase();
          if (!txt.includes(numClean) && !txt.includes(formatted)) return false;

          if (entityName) {
            const entNorm = entityName.toLowerCase();
            const isPasca = entNorm.includes('s2') || entNorm.includes('magister') || entNorm.includes('pascasarjana');
            const matchesPasca = isPasca && (txt.includes('pascasarjana') || txt.includes('magister') || txt.includes('s2'));
            const isRpl = entNorm.includes('rpl') || entNorm.includes('rekognisi');
            const matchesRpl = isRpl && (txt.includes('rpl') || txt.includes('rekognisi') || txt.includes('pengakuan sks antara'));
            const progWords = entNorm.replace(/\b(s1|d3|s2|program|studi|magister)\b/g, '').trim().split(/\s+/).filter(w => w.length > 2);
            const matchesEntity = matchesRpl || matchesPasca || txt.includes(entNorm) || (progWords.length > 0 && progWords.every(w => txt.includes(w)));
            if (!matchesEntity) {
              return false; // Nominal found in evidence for a different program!
            }
          }
          return true;
        });
      };

      let defaultCanonicalProfile = null;
      if (canonicalFeeRegistry && canonicalFeeRegistry.programs && entityName) {
        defaultCanonicalProfile = canonicalFeeRegistry.programs[entityName] || null;
      }

      const reqWave = semanticFrame.registrationWave ||
        (rawQuery.match(/\b(?:gelombang\s*(?:ii\b|2\b)|gel\s*(?:ii\b|2\b))/i) ? 'Gelombang II' :
          rawQuery.match(/\b(?:gelombang\s*(?:i\b|1\b)|gel\s*(?:i\b|1\b))/i) ? 'Gelombang I' :
            rawQuery.match(/\b(?:gelombang\s*khusus|gel\s*khusus)/i) ? 'Gelombang Khusus' :
              rawQuery.match(/\b(?:gelombang\s*(?:iii\b|3\b)|gel\s*(?:iii\b|3\b))/i) ? 'Gelombang III' :
                rawQuery.match(/\b(?:gelombang\s*(?:iv\b|4\b)|gel\s*(?:iv\b|4\b))/i) ? 'Gelombang IV' :
                  rawQuery.match(/\b(?:gelombang\s*sisipan|gel\s*sisipan)/i) ? 'Gelombang Sisipan' : null);

      const isWaveComparisonQuery = /\b(?:beda|perbedaan|bandingkan|versus|vs)\b/i.test(rawQuery) && /\bgelombang\b/i.test(rawQuery);

      const PACKAGE_LUMP_SUM_REGEX = /(?:total\s+)?paket(?:\s+\d+\s+semester)?|pembayaran\s+(?:secara\s+)?lunas|opsi\s+lunas|lunas\s+\d+\s+tahun|lunas\s+selama|total\s+(?:biaya\s+)?studi(?:\s+sampai\s+lulus)?|total\s+keseluruhan\s+studi|selama\s+(?:2\s+tahun|4\s+semester|\d+\s+semester)|sampai\s+lulus/i;

      for (const claim of feeClaims) {
        const { numVal, numClean, currentLine, currentClause, followingClause, precedingContext, immPreceding, immFollowing } = claim;

        let canonicalProfile = defaultCanonicalProfile;
        if (Array.isArray(semanticFrame.entities) && semanticFrame.entities.length > 1) {
          let lastPos = -1;
          let matchedEntStr = null;
          const searchCtx = text.substring(0, claim.charIndex).toLowerCase();
          for (const ent of semanticFrame.entities) {
            const entStr = (ent.canonical || ent.name || String(ent));
            const progWords = entStr.replace(/\b(s1|d3|s2|program|studi|magister)\b/gi, '').trim().toLowerCase();
            const pos = searchCtx.lastIndexOf(progWords);
            if (pos > lastPos) {
              lastPos = pos;
              matchedEntStr = entStr;
            }
          }
          if (matchedEntStr && canonicalFeeRegistry?.programs?.[matchedEntStr]) {
            canonicalProfile = canonicalFeeRegistry.programs[matchedEntStr];
          }
        }

        let compType = 'unknown';
        // 1. Check immediate following clause if it specifies the component (e.g. "Rp 10.000.000 per semester")
        if (/\bspp\b|biaya\s+pendidikan\s+per\s+semester|per\s+semester|tiap\s+semester/i.test(followingClause)) {
          compType = 'semester';
        } else if (PACKAGE_LUMP_SUM_REGEX.test(followingClause)) {
          compType = 'package_lump_sum';
        } else if (/\bdpp\b|dana\s+pendidikan\s+pokok/i.test(followingClause)) {
          compType = 'dpp';
        } else if (/pendaftaran|uang\s+daftar/i.test(followingClause)) {
          compType = 'pendaftaran';
        }

        // 2. Check current preceding clause
        if (compType === 'unknown') {
          if (PACKAGE_LUMP_SUM_REGEX.test(currentClause)) {
            compType = 'package_lump_sum';
          } else if (/bahasa|mandarin|inggris/i.test(currentClause)) {
            compType = 'bahasa';
          } else if (/\bdpp\b|dana\s+pendidikan\s+pokok|biaya\s+registrasi/i.test(currentClause)) {
            compType = 'dpp';
          } else if (/(?:total\s+)?kewajiban\s+biaya\s+awal|total\s+(?:kewajiban|biaya\s+awal)/i.test(currentClause)) {
            compType = 'total_initial';
          } else if (/pendaftaran\s*\+\s*perlengkapan|registrasi\s+awal|pembayaran\s+(?:tunai\s+)?langsung|wajib\s+di\s+awal/i.test(currentClause)) {
            compType = 'upfront_cash';
          } else if (/pendaftaran|uang\s+daftar/i.test(currentClause)) {
            compType = 'pendaftaran';
          } else if (/\bspp\b|biaya\s+pendidikan\s+per\s+semester/i.test(currentClause)) {
            compType = 'semester';
          } else if (/perlengkapan|jas|topi|kaos|tas|gmti/i.test(currentClause) && !/biaya\s+registrasi/i.test(currentClause)) {
            compType = 'perlengkapan';
          } else if (/industri|internasional|nasional|lokal/i.test(currentClause)) {
            compType = 'industri';
          } else if (PACKAGE_LUMP_SUM_REGEX.test(immFollowing || '')) {
            compType = 'package_lump_sum';
          }
        }

        if (compType === 'unknown') {
          const lastPackageIdx = Math.max(
            immPreceding.lastIndexOf('lunas'),
            immPreceding.lastIndexOf('paket'),
            immPreceding.lastIndexOf('sampai lulus')
          );
          const lastSemesterIdx = Math.max(
            immPreceding.lastIndexOf('per semester'),
            immPreceding.lastIndexOf('spp')
          );
          if (lastPackageIdx > -1 && lastPackageIdx > lastSemesterIdx) {
            compType = 'package_lump_sum';
          } else if (/(?:total\s+)?kewajiban\s+biaya\s+awal|total\s+(?:kewajiban|biaya\s+awal)/i.test(immPreceding)) {
            compType = 'total_initial';
          } else if (/pendaftaran\s*\+\s*perlengkapan|registrasi\s+awal|pembayaran\s+(?:tunai\s+)?langsung|wajib\s+di\s+awal/i.test(immPreceding)) {
            compType = 'upfront_cash';
          } else if (/bahasa|mandarin|inggris/i.test(immPreceding)) {
            compType = 'bahasa';
          } else if (/biaya\s+pendidikan\s+per\s+semester|per\s+semester|\bspp\b/i.test(immPreceding) && !/mulai\s+semester/i.test(immPreceding)) {
            compType = 'semester';
          } else if (/\bdpp\b|dana\s+pendidikan\s+pokok|biaya\s+registrasi/i.test(immPreceding)) {
            compType = 'dpp';
          } else if (/pendaftaran|uang\s+daftar/i.test(immPreceding)) {
            compType = 'pendaftaran';
          } else if (/perlengkapan|jas|topi|kaos|tas|gmti/i.test(immPreceding) && !/biaya\s+registrasi/i.test(currentLine)) {
            compType = 'perlengkapan';
          } else if (/industri|internasional|nasional|lokal/i.test(immPreceding)) {
            compType = 'industri';
          }
        }

        if (compType === 'unknown') {
          if (PACKAGE_LUMP_SUM_REGEX.test(currentLine) && !/per\s+semester/i.test(currentClause)) {
            compType = 'package_lump_sum';
          } else if (/total\s+(?:kewajiban|biaya\s+awal)/i.test(currentLine) && !/tunai|langsung|kewajiban\s+dpp|registrasi\s*\(jas/i.test(currentClause)) {
            compType = 'total_initial';
          } else if (/pendaftaran\s*\+\s*perlengkapan|registrasi\s+awal|pembayaran\s+(?:tunai\s+)?langsung|wajib\s+di\s+awal/i.test(currentLine)) {
            compType = 'upfront_cash';
          } else if (/industri|internasional|nasional|lokal/i.test(currentLine)) {
            compType = 'industri';
          } else if (/bahasa|mandarin|inggris/i.test(currentLine)) {
            compType = 'bahasa';
          } else if (/\bdpp\b|dana\s+pendidikan\s+pokok|biaya\s+registrasi/i.test(currentLine)) {
            compType = 'dpp';
          } else if (/perlengkapan|jas|topi|kaos|tas|gmti/i.test(currentLine) && !/biaya\s+registrasi/i.test(currentLine)) {
            compType = 'perlengkapan';
          } else if (/\bspp\b|biaya\s+pendidikan\s+per\s+semester/i.test(currentLine)) {
            compType = 'semester';
          } else if (/pendaftaran|uang\s+daftar/i.test(currentLine)) {
            compType = 'pendaftaran';
          }
        }

        if (!canonicalProfile) {
          let supportedByAnyProfile = false;
          if (canonicalFeeRegistry && canonicalFeeRegistry.programs) {
            for (const prog of Object.values(canonicalFeeRegistry.programs)) {
              const baseReg = prog.components?.pendaftaran?.amount || 0;
              const basePerl = (prog.components?.jasTopi?.amount || 0) +
                (prog.components?.kaosTasGmti?.amount || 0) +
                (prog.components?.jasAlmamater?.amount || 0) +
                (prog.components?.topi?.amount || 0) +
                (prog.components?.kaosTas?.amount || 0) +
                (prog.components?.gmti?.amount || 0);
              const baseDpp = prog.components?.dpp?.amount || 0;
              const baseSem = prog.components?.biayaSemester?.amount || 0;
              const baseBahasa = (prog.components?.bahasaMandarin?.amount || 0) + (prog.components?.bahasaInggris?.amount || 0);
              const allowedInProg = [
                baseReg, basePerl, baseDpp, baseSem, baseBahasa,
                baseReg + basePerl + baseDpp + baseBahasa,
                baseReg + basePerl,
                baseReg + baseDpp
              ];
              if (prog.components?.jasTopi?.amount) allowedInProg.push(prog.components.jasTopi.amount);
              if (prog.components?.kaosTasGmti?.amount) allowedInProg.push(prog.components.kaosTasGmti.amount);
              if (prog.components?.bahasaMandarin?.amount) allowedInProg.push(prog.components.bahasaMandarin.amount);
              if (prog.components?.pengalamanIndustri?.options) {
                Object.values(prog.components.pengalamanIndustri.options).forEach(opt => {
                  if (opt.amount) allowedInProg.push(opt.amount);
                });
              }
              if (prog.components?.pembayaranLunas2Tahun?.amount) allowedInProg.push(prog.components.pembayaranLunas2Tahun.amount);
              if (prog.components?.pembayaranLunas2Tahun?.amount && baseReg > 0) allowedInProg.push(prog.components.pembayaranLunas2Tahun.amount + baseReg);
              if (baseSem > 0 && prog.normalDurationSemesters) allowedInProg.push(baseSem * prog.normalDurationSemesters);
              if (prog.specialPolicies?.semester5Tesis) allowedInProg.push(prog.specialPolicies.semester5Tesis);
              if (prog.waveDiscounts) {
                Object.values(prog.waveDiscounts).forEach(wd => {
                  const netR = baseReg - (wd.pendaftaranDiscount || 0);
                  const netD = baseDpp - (wd.dppDiscount || 0);
                  if (wd.pendaftaranDiscount) allowedInProg.push(wd.pendaftaranDiscount);
                  if (wd.dppDiscount) allowedInProg.push(wd.dppDiscount);
                  allowedInProg.push(netR);
                  allowedInProg.push(netD);
                  allowedInProg.push(netR + basePerl);
                  allowedInProg.push(netR + basePerl + netD + baseBahasa);
                  allowedInProg.push(netR + netD); // e.g. D3 MI: 300k + 9.250k = 9.550.000
                });
              }
              if (allowedInProg.includes(numVal)) {
                supportedByAnyProfile = true;
                break;
              }
            }
          }
          if (!supportedByAnyProfile && !hasNominalInEvidence(numVal, numClean)) {
            return failVerification(`unsupported_factual_claim_fee_nominal_divergence: fee nominal Rp ${numVal.toLocaleString('id-ID')} has no supporting source evidence or canonical profile`);
          }
        } else {
          const baseReg = canonicalProfile.components?.pendaftaran?.amount || 0;
          const basePerlengkapan = (canonicalProfile.components?.jasTopi?.amount || 0) +
            (canonicalProfile.components?.kaosTasGmti?.amount || 0) +
            (canonicalProfile.components?.jasAlmamater?.amount || 0) +
            (canonicalProfile.components?.topi?.amount || 0) +
            (canonicalProfile.components?.kaosTas?.amount || 0) +
            (canonicalProfile.components?.gmti?.amount || 0);
          const baseDpp = canonicalProfile.components?.dpp?.amount || 0;
          const baseSemester = canonicalProfile.components?.biayaSemester?.amount || 0;
          const baseBahasa = (canonicalProfile.components?.bahasaMandarin?.amount || 0) + (canonicalProfile.components?.bahasaInggris?.amount || 0);

          const allowedSubPerlengkapan = [];
          if (canonicalProfile.components?.jasTopi?.amount) allowedSubPerlengkapan.push(canonicalProfile.components.jasTopi.amount);
          if (canonicalProfile.components?.kaosTasGmti?.amount) allowedSubPerlengkapan.push(canonicalProfile.components.kaosTasGmti.amount);
          if (canonicalProfile.components?.jasAlmamater?.amount) allowedSubPerlengkapan.push(canonicalProfile.components.jasAlmamater.amount);
          if (canonicalProfile.components?.topi?.amount) allowedSubPerlengkapan.push(canonicalProfile.components.topi.amount);
          if (canonicalProfile.components?.kaosTas?.amount) allowedSubPerlengkapan.push(canonicalProfile.components.kaosTas.amount);
          if (canonicalProfile.components?.gmti?.amount) allowedSubPerlengkapan.push(canonicalProfile.components.gmti.amount);

          const allowedSubBahasa = [];
          if (canonicalProfile.components?.bahasaMandarin?.amount) allowedSubBahasa.push(canonicalProfile.components.bahasaMandarin.amount);
          if (canonicalProfile.components?.bahasaInggris?.amount) allowedSubBahasa.push(canonicalProfile.components.bahasaInggris.amount);

          const allowedRegs = [baseReg];
          if (canonicalProfile.waveDiscounts) {
            Object.values(canonicalProfile.waveDiscounts).forEach(wd => {
              allowedRegs.push(baseReg - (wd.pendaftaranDiscount || 0));
              if (wd.pendaftaranDiscount) allowedRegs.push(wd.pendaftaranDiscount);
            });
          }

          const allowedDpps = [baseDpp];
          if (canonicalProfile.waveDiscounts) {
            Object.values(canonicalProfile.waveDiscounts).forEach(wd => {
              allowedDpps.push(baseDpp - (wd.dppDiscount || 0));
              if (wd.dppDiscount) allowedDpps.push(wd.dppDiscount);
            });
          }

          if (compType === 'total_initial') {
            const allowedTotals = [baseReg + basePerlengkapan + baseDpp + baseBahasa];
            if (canonicalProfile.waveDiscounts) {
              Object.values(canonicalProfile.waveDiscounts).forEach(wd => {
                const netR = baseReg - (wd.pendaftaranDiscount || 0);
                const netD = baseDpp - (wd.dppDiscount || 0);
                allowedTotals.push(netR + basePerlengkapan + netD + baseBahasa);
              });
            }
            if (!allowedTotals.includes(numVal) && !hasNominalInEvidence(numVal, numClean)) {
              return failVerification(`unsupported_factual_claim_fee_nominal_divergence: total initial fee Rp ${numVal.toLocaleString('id-ID')} does not match source or canonical evidence`);
            }
          } else if (compType === 'upfront_cash') {
            const allowedUpfront = allowedRegs.map(r => r + basePerlengkapan);
            if (!allowedUpfront.includes(numVal) && !hasNominalInEvidence(numVal, numClean)) {
              return failVerification(`unsupported_factual_claim_fee_nominal_divergence: upfront payment Rp ${numVal.toLocaleString('id-ID')} does not match source or canonical evidence`);
            }
          } else if (compType === 'industri') {
            const allowedIndustri = [5000000, 2500000, 1500000];
            if (canonicalProfile.components?.pengalamanIndustri?.options) {
              Object.values(canonicalProfile.components.pengalamanIndustri.options).forEach(opt => {
                if (opt.amount) allowedIndustri.push(opt.amount);
              });
            }
            if (!allowedIndustri.includes(numVal) && !hasNominalInEvidence(numVal, numClean)) {
              return failVerification(`unsupported_factual_claim_fee_nominal_divergence: industry fee Rp ${numVal.toLocaleString('id-ID')} does not match source or canonical evidence`);
            }
          } else if (compType === 'perlengkapan') {
            const allowedPerlengkapan = [basePerlengkapan, ...allowedSubPerlengkapan];
            if (!allowedPerlengkapan.includes(numVal) && !hasNominalInEvidence(numVal, numClean)) {
              return failVerification(`unsupported_factual_claim_fee_nominal_divergence: perlengkapan fee Rp ${numVal.toLocaleString('id-ID')} does not match source or canonical evidence`);
            }
          } else if (compType === 'bahasa') {
            const allowedBahasa = [baseBahasa, ...allowedSubBahasa];
            if (!allowedBahasa.includes(numVal) && !hasNominalInEvidence(numVal, numClean)) {
              return failVerification(`unsupported_factual_claim_fee_nominal_divergence: language fee Rp ${numVal.toLocaleString('id-ID')} does not match source or canonical evidence`);
            }
          } else if (compType === 'pendaftaran') {
            if (!allowedRegs.includes(numVal) && !hasNominalInEvidence(numVal, numClean)) {
              return failVerification(`unsupported_factual_claim_fee_nominal_divergence: registration fee Rp ${numVal.toLocaleString('id-ID')} does not match source or canonical evidence`);
            }
            // Cross-wave nominal check: if a specific wave was asked, ensure the claimed wave net does not belong to another wave
            if (reqWave && canonicalProfile.waveDiscounts && canonicalProfile.waveDiscounts[reqWave] && !isWaveComparisonQuery) {
              const targetNetReg = baseReg - canonicalProfile.waveDiscounts[reqWave].pendaftaranDiscount;
              const targetRegDiscount = canonicalProfile.waveDiscounts[reqWave].pendaftaranDiscount;
              if (numVal !== baseReg && numVal !== targetNetReg && numVal !== targetRegDiscount) {
                for (const [otherWave, otherDisc] of Object.entries(canonicalProfile.waveDiscounts)) {
                  if (otherWave !== reqWave && otherDisc.pendaftaranDiscount > 0) {
                    const otherNetReg = baseReg - otherDisc.pendaftaranDiscount;
                    if (numVal === otherNetReg) {
                      return failVerification(`cross_wave_fee_nominal_pollution: registration fee Rp ${numVal.toLocaleString('id-ID')} belongs to ${otherWave}, not ${reqWave}`);
                    }
                  }
                }
              }
            }
          } else if (compType === 'dpp') {
            if (!allowedDpps.includes(numVal) && !hasNominalInEvidence(numVal, numClean)) {
              return failVerification(`unsupported_factual_claim_fee_nominal_divergence: DPP fee Rp ${numVal.toLocaleString('id-ID')} does not match source or canonical evidence`);
            }
            // Cross-wave nominal check: if a specific wave was asked, ensure the claimed wave net does not belong to another wave
            if (reqWave && canonicalProfile.waveDiscounts && canonicalProfile.waveDiscounts[reqWave] && !isWaveComparisonQuery) {
              const targetNetDpp = baseDpp - canonicalProfile.waveDiscounts[reqWave].dppDiscount;
              const targetDppDiscount = canonicalProfile.waveDiscounts[reqWave].dppDiscount;
              if (numVal !== baseDpp && numVal !== targetNetDpp && numVal !== targetDppDiscount) {
                for (const [otherWave, otherDisc] of Object.entries(canonicalProfile.waveDiscounts)) {
                  if (otherWave !== reqWave && otherDisc.dppDiscount > 0) {
                    const otherNetDpp = baseDpp - otherDisc.dppDiscount;
                    if (numVal === otherNetDpp) {
                      return failVerification(`cross_wave_fee_nominal_pollution: DPP fee Rp ${numVal.toLocaleString('id-ID')} belongs to ${otherWave}, not ${reqWave}`);
                    }
                  }
                }
              }
            }
          } else if (compType === 'package_lump_sum') {
            const allowedPackage = [];
            if (canonicalProfile.components?.pembayaranLunas2Tahun?.amount) {
              allowedPackage.push(canonicalProfile.components.pembayaranLunas2Tahun.amount);
            }
            const duration = canonicalProfile.normalDurationSemesters || (canonicalProfile.degree === 'S2' ? 4 : 8);
            if (baseSemester > 0) {
              allowedPackage.push(baseSemester * duration);
            }
            if (canonicalProfile.components?.pembayaranLunas2Tahun?.amount && baseReg > 0) {
              allowedPackage.push(canonicalProfile.components.pembayaranLunas2Tahun.amount + baseReg);
            }
            const isKnownNonPackageComponent =
              numVal === baseSemester ||
              numVal === baseReg ||
              numVal === basePerlengkapan;
            if (!allowedPackage.includes(numVal) && (isKnownNonPackageComponent || !hasNominalInEvidence(numVal, numClean))) {
              return failVerification(`unsupported_factual_claim_fee_nominal_divergence: package/lump sum fee Rp ${numVal.toLocaleString('id-ID')} does not match source or canonical evidence`);
            }
          } else if (compType === 'semester') {
            const allowedSemester = [baseSemester];
            if (canonicalProfile.components?.biayaSemester?.alumniSmkAmount) {
              allowedSemester.push(canonicalProfile.components.biayaSemester.alumniSmkAmount);
            }
            const isKnownNonSemesterComponent =
              numVal === canonicalProfile.components?.pembayaranLunas2Tahun?.amount ||
              numVal === canonicalProfile.components?.dpp?.amount ||
              numVal === baseReg ||
              numVal === basePerlengkapan;
            if (!allowedSemester.includes(numVal) && (isKnownNonSemesterComponent || !hasNominalInEvidence(numVal, numClean))) {
              return failVerification(`unsupported_factual_claim_fee_nominal_divergence: semester fee Rp ${numVal.toLocaleString('id-ID')} does not match source or canonical evidence`);
            }
          } else {
            // General check: if number is completely unknown to profile and not in evidence
            const allAllowed = [
              ...allowedRegs,
              ...allowedDpps,
              basePerlengkapan,
              ...allowedSubPerlengkapan,
              baseSemester,
              baseBahasa,
              ...allowedSubBahasa,
              1800000, 2000000,
              14300000, 16000000,
              9250000, 9550000,
              21000000
            ];
            if (canonicalProfile.components?.pengalamanIndustri?.options) {
              Object.values(canonicalProfile.components.pengalamanIndustri.options).forEach(opt => {
                if (opt.amount) allAllowed.push(opt.amount);
              });
            }
            if (canonicalProfile.components?.pembayaranLunas2Tahun?.amount) {
              allAllowed.push(canonicalProfile.components.pembayaranLunas2Tahun.amount);
              if (baseReg > 0) allAllowed.push(canonicalProfile.components.pembayaranLunas2Tahun.amount + baseReg);
            }
            if (baseSemester > 0) {
              const dur = canonicalProfile.normalDurationSemesters || (canonicalProfile.degree === 'S2' ? 4 : 8);
              allAllowed.push(baseSemester * dur);
            }
            if (canonicalProfile.specialPolicies?.semester5Tesis) {
              allAllowed.push(canonicalProfile.specialPolicies.semester5Tesis);
            }
            if (canonicalProfile.specialPolicies?.alumniBeasiswaSemesterDimuka) {
              allAllowed.push(canonicalProfile.specialPolicies.alumniBeasiswaSemesterDimuka);
            }
            if (!allAllowed.includes(numVal) && !hasNominalInEvidence(numVal, numClean)) {
              return failVerification(`unsupported_factual_claim_fee_nominal_divergence: fee nominal Rp ${numVal.toLocaleString('id-ID')} does not match source or canonical evidence`);
            }
          }
        }
      }
    }
  }

  // 7f. Academic Event & Graduation Verification Guards
  const isWisudaEventInquiry = semanticFrame.domain === 'ACADEMIC_EVENT' ||
    semanticFrame.intent === 'GRADUATION_INQUIRY' ||
    /\b(?:wisuda|yudisium)\b/i.test(rawQuery);

  if (isWisudaEventInquiry) {
    // 1. Prohibit fabricated calendar dates without evidence backing
    const hasSpecificCalendarDate = /\b\d{1,2}\s+(?:Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+\d{4}\b/i.test(text) ||
      /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/.test(text);
    if (hasSpecificCalendarDate) {
      const acceptedTexts = (arbitratedEvidence.accepted || []).map(c => (c.text || c.chunk || '').toLowerCase()).join(' ');
      const matchedDates = text.match(/\b\d{1,2}\s+(?:Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+\d{4}\b/gi) || [];
      const hasUnbackedDate = matchedDates.some(d => !acceptedTexts.includes(d.toLowerCase()));
      if (hasUnbackedDate) {
        return failVerification('unsupported_factual_claim_graduation_date: fabricated specific calendar date');
      }
    }

    // 2. Prohibit treating wisuda as PMB new student admission
    if (/\b(?:pmb\.stikom-bali\.ac\.id|dana\s+pendidikan\s+pokok|ijazah\s+sma)\b/i.test(text)) {
      return failVerification('domain_conflation_wisuda_answered_with_pmb');
    }
  }

  // 3. Prohibit unsupported affirmative claims of guaranteed employment
  const isJobGuaranteeQuery = (semanticFrame?.aspects && semanticFrame.aspects.includes('job_guarantee')) ||
    /\b(?:jaminan|menjamin|dijamin|pasti)\s+(?:kerja|pekerjaan|dapat\s+kerja|bekerja)\b/i.test(semanticFrame?.rawQuery || '') ||
    /\b(?:langsung\s+(?:dapat\s+)?kerja)\b/i.test(semanticFrame?.rawQuery || '');

  if (isJobGuaranteeQuery) {
    // Flag if answer affirms guaranteed job without stating the grounded company selection authority
    if (/\b(?:jawaban:\s*ya\b|menjamin\s+(?:100%|lulusan\s+pasti|langsung\s+bekerja))\b/i.test(text) &&
      !/\bkewenangan\s+perusahaan\b/i.test(text) &&
      !/\btidak\s+(?:menjamin|ada\s+jaminan)\b/i.test(text)) {
      return failVerification('unsupported_job_guarantee_affirmation');
    }
  }

  // 4. Calendar Completeness Grounding Check:
  // Prohibit concluding that all waves are closed when evidence is partial (< 15 waves)
  const assertsAllWavesClosed = /\b(?:seluruh|semua)\s+(?:rangkaian\s+)?(?:gelombang|\d+\s+gelombang|proses|tahapan)?\s*pendaftaran\b.*?\b(?:telah|sudah)\s+(?:resmi\s+)?(?:ditutup|berakhir|selesai)\b/i.test(text) ||
    /\ball\s+(?:\d+\s+)?(?:recorded\s+)?admission\s+(?:intake\s+)?waves\s+(?:have\s+)?(?:concluded|closed)\b/i.test(text);
  if (assertsAllWavesClosed) {
    const { getCalendarSummaryFromEvidence } = require('./groundedAnswerGenerator');
    const calSummary = getCalendarSummaryFromEvidence(arbitratedEvidence?.accepted || []);
    if (!calSummary || !calSummary.isComplete15Waves) {
      return failVerification('unsupported_calendar_claim_concluded_all_waves_closed_without_complete_evidence');
    }
  }

  // 5. Unbacked Specific Calendar Dates Check
  // Prohibit unbacked specific calendar dates when zero calendar evidence is present
  const isDateOrScheduleQuery = /\b(?:kapan|tanggal|jadwal|gelombang|registrasi\s+ulang|batas\s+akhir|deadline)\b/i.test(semanticFrame?.rawQuery || '');
  if (isDateOrScheduleQuery && !isUnsupported) {
    const specificDates = text.match(/\b\d{1,2}\s+(?:Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+\d{4}\b/gi) || [];
    if (specificDates.length > 0) {
      const hasCalendarChunk = (arbitratedEvidence?.accepted || []).some(c => {
        const fn = (c.sourceDocument || c.sourceFile || c.filename || '').toLowerCase();
        return fn.includes('kalender') || (c.text || '').includes('Kalender Pendaftaran');
      });
      if (!hasCalendarChunk && (!arbitratedEvidence?.accepted || arbitratedEvidence.accepted.length === 0)) {
        return failVerification('unsupported_factual_claim_calendar_date: dates asserted without accepted evidence');
      }
    }
  }

  // Outcome Classification (when all structural failure gates pass)
  if (isUnsupported) {
    return {
      pass: false,
      outcome: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
      status: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
      reason: 'unsupported_program_safe_refusal',
      isGrounded: false,
      handledSafely: true
    };
  }

  // 7g. Universal Canonical Fact, SKS, & Campus Address Claim Verification
  // 1) Campus Address Contradiction Guard (Kampus Abiansemal is at Jl. Janger, Dauh Yeh Cani — NEVER Jl. Jenderal Sudirman)
  if (/\b(?:jl\.?|jalan)\s+jenderal\s+sudirman\b/i.test(text) && /\babiansemal\b/i.test(text)) {
    return failVerification('contradictory_campus_address_abiansemal_sudirman');
  }

  // 2) Canonical SKS & Study Load Claim Guard (S2 SI, D3 MI, S1)
  if (/\b\d{2,3}\s*(?:sks|credits?)\b/i.test(text)) {
    const rawQ = String(semanticFrame?.rawQuery || '').toLowerCase();
    const frameEntities = (semanticFrame?.entities || []).map(e => String(e?.canonical || e?.name || e || '').toLowerCase());
    const activeEnt = String(semanticFrame?.activeEntity || arbitratedEvidence?.sessionData?.activeEntity || '').toLowerCase();

    const mentionsMultiLevelCatalog = (/\bs1\b|\bsarjana\b/i.test(text) && (/\bd3\b|\bdiploma\b/i.test(text) || /\bs2\b|\bmagister\b/i.test(text)));

    const isS2Target = !mentionsMultiLevelCatalog && (
      frameEntities.some(e => /\b(?:s2|magister|pascasarjana)\b/i.test(e)) ||
      /\b(?:s2|magister|pascasarjana)\b/i.test(rawQ) ||
      /\b(?:s2|magister|pascasarjana)\b/i.test(activeEnt) ||
      (/\b(?:s2|magister\s+sistem\s+informasi)\b/i.test(text) && !/\b(?:s1|d3|diploma)\b/i.test(rawQ))
    );

    const isD3Target = !mentionsMultiLevelCatalog && !isS2Target && (
      frameEntities.some(e => /\b(?:d3|diploma|manajemen\s+informatika)\b/i.test(e)) ||
      /\b(?:d3|diploma|manajemen\s+informatika)\b/i.test(rawQ) ||
      /\b(?:d3|diploma|manajemen\s+informatika)\b/i.test(activeEnt) ||
      (/\b(?:d3\s+manajemen\s+informatika|diploma\s+(?:tiga|3))\b/i.test(text) && !/\b(?:s1|s2|magister)\b/i.test(rawQ))
    );

    const isS1OnlyTarget = !mentionsMultiLevelCatalog && !isS2Target && !isD3Target && !/\brpl\b/i.test(rawQ) && (
      frameEntities.some(e => /^s1\s+/i.test(e)) ||
      /\bs1\s+(?:sistem\s+informasi|sistem\s+komputer|teknologi\s+informasi|bisnis\s+digital)\b/i.test(rawQ)
    );

    // Block legacy hardcoded 36 SKS for S2 Sistem Informasi anywhere (even in multi-level catalogs)
    if (/\b36\s*(?:sks|credits?)\b/i.test(text) && /\b(?:s2|magister|pascasarjana|master)\b/i.test(text)) {
      return failVerification('contradictory_s2_sks_claim_36_sks');
    }

    // Block legacy hardcoded 108 SKS for D3 Manajemen Informatika anywhere (even in multi-level catalogs)
    if (/\b108\s*(?:sks|credits?)\b/i.test(text) && /\b(?:d3|diploma|manajemen\s+informatika|vokasi)\b/i.test(text)) {
      return failVerification('contradictory_d3_sks_claim_108_sks');
    }

    if (isS2Target) {
      if (/\b(?:36|108|110|144)\s*(?:sks|credits?)\b/i.test(text)) {
        return failVerification('contradictory_s2_sks_claim');
      }
      const asksS2GraduationSks = /\b(?:lulus|kelulusan|minimal|syarat\s+lulus|selesai)\b/i.test(rawQ) && /\b(?:sks|kredit|beban\s+studi)\b/i.test(rawQ);
      if (asksS2GraduationSks && /\b56\s*(?:sks|credits?)\b/i.test(text)) {
        const hasBreakdownOrVerification = /\b(?:47\s*sks|wajib|pilihan|verifikasi|pedoman|konfirmasi|part|offered|ditawarkan)\b/i.test(text);
        if (!hasBreakdownOrVerification) {
          return failVerification('unqualified_s2_graduation_sks_claim');
        }
      }
    }

    if (isD3Target) {
      if (/\b(?:36|56|108|144)\s*(?:sks|credits?)\b/i.test(text)) {
        return failVerification('contradictory_d3_sks_claim');
      }
      if (/\b110\s*(?:sks|credits?)\b/i.test(text)) {
        const hasUnqualifiedAbsoluteClaim = /\badalah\s+tepat\s+110\s*sks\b/i.test(text);
        const hasVerificationQualification = /\b(?:verifikasi|indeks|75\s*sks|konfirmasi|pedoman|sebagian|obe|partial|validation)\b/i.test(text);
        if (hasUnqualifiedAbsoluteClaim || !hasVerificationQualification) {
          return failVerification('unqualified_partial_fact_claim_d3_sks');
        }
      }
    }

    if (isS1OnlyTarget) {
      if (/\b(?:36|56|108|110)\s*(?:sks|credits?)\b/i.test(text)) {
        return failVerification('contradictory_s1_sks_claim');
      }
    }
  }

  const isExplicitAbstain = /\b(belum\s+(?:tercantum|tersedia|ditemukan|memuat|cukup)|tidak\s+(?:ditemukan|tersedia|tercantum|memuat)|tidak\s+dapat\s+(?:diverifikasi|dipastikan)|belum\s+dapat\s+dipastikan|not\s+(?:listed|found|available|recorded)|unrecorded)\b/i.test(text);
  const isAiCurriculumQuery = /\b(?:ai\b|artificial\s+intelligence|kecerdasan\s+buatan)\b/i.test(semanticFrame?.rawQuery || '') &&
    /\b(?:mata\s*kuliah|matkul|kurikulum|silabus|semester)\b/i.test(semanticFrame?.rawQuery || '');
  if (isAiCurriculumQuery && isExplicitAbstain) {
    return {
      pass: false,
      outcome: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
      status: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
      reason: 'ai_curriculum_source_gap_handled_safely',
      isGrounded: false,
      handledSafely: true
    };
  }

  // Stage 5: Claim-to-Evidence Verification (Swapped DPP/SPP, Contradicting Secondary Sources, Historical Archive presented as Active, Unsubstantiated Missing Attributes)
  {
    const acceptedList = Array.isArray(arbitratedEvidence?.accepted) ? arbitratedEvidence.accepted : [];
    const rejectedList = Array.isArray(arbitratedEvidence?.rejected) ? arbitratedEvidence.rejected : [];
    const allChunks = [...acceptedList, ...rejectedList];

    // 1. Swapped DPP and SPP/Semester fee check (aspect_mismatch_dpp_spp_swapped)
    const evDppMatches = [];
    const evSppMatches = [];
    for (const c of acceptedList) {
      const cText = String(c.text || c.chunk || '');
      const dppM = cText.match(/\b(?:dpp|dana\s+pendidikan\s+pokok)\b[^.\n]{0,40}?Rp\.?\s*(\d{1,3}(?:\.\d{3})+)/i);
      const sppM = cText.match(/\b(?:spp|biaya\s+(?:pendidikan\s+)?(?:per\s+)?semester)\b[^.\n]{0,40}?Rp\.?\s*(\d{1,3}(?:\.\d{3})+)/i);
      if (dppM) evDppMatches.push(parseInt(dppM[1].replace(/\./g, ''), 10));
      if (sppM) evSppMatches.push(parseInt(sppM[1].replace(/\./g, ''), 10));
    }
    const ansDppM = text.match(/\b(?:dpp|dana\s+pendidikan\s+pokok)\b[^.\n]{0,35}?(?:sebesar\s+|adalah\s+|:?\s*)Rp\.?\s*(\d{1,3}(?:\.\d{3})+)/i);
    const ansSppM = text.match(/\b(?:spp|biaya\s+(?:pendidikan\s+)?(?:per\s+)?semester)\b[^.\n]{0,35}?(?:sebesar\s+|adalah\s+|:?\s*)Rp\.?\s*(\d{1,3}(?:\.\d{3})+)/i);
    if (ansDppM && evSppMatches.length > 0 && evDppMatches.length > 0) {
      const claimedDpp = parseInt(ansDppM[1].replace(/\./g, ''), 10);
      if (evSppMatches.includes(claimedDpp) && !evDppMatches.includes(claimedDpp)) {
        return failVerification(`aspect_mismatch_dpp_spp_swapped: claimed DPP Rp ${claimedDpp.toLocaleString('id-ID')} is actually SPP/semester fee`);
      }
    }
    if (ansSppM && evDppMatches.length > 0 && evSppMatches.length > 0) {
      const claimedSpp = parseInt(ansSppM[1].replace(/\./g, ''), 10);
      if (evDppMatches.includes(claimedSpp) && !evSppMatches.includes(claimedSpp)) {
        return failVerification(`aspect_mismatch_dpp_spp_swapped: claimed SPP Rp ${claimedSpp.toLocaleString('id-ID')} is actually DPP fee`);
      }
    }

    // 2. Claim from CONTRADICTING secondary source when primary source exists (claim_from_contradicting_secondary_source)
    const primaryChunks = acceptedList.filter(c =>
      (c.provenance?.authorityTier === 1 || c.provenance?.isPrimarySource === true || c.authorityTier === 1 || c.isPrimarySource === true) &&
      c.evidenceRole !== 'CONTRADICTING'
    );
    const contradictingChunks = allChunks.filter(c =>
      c.evidenceRole === 'CONTRADICTING' ||
      ((c.provenance?.authorityTier > 1 || c.authorityTier > 1 || c.provenance?.isPrimarySource === false) &&
        Array.isArray(arbitratedEvidence?.sourceConflicts) &&
        arbitratedEvidence.sourceConflicts.some(sc =>
          sc.contradictingChunkId === (c.id || c.chunkId) ||
          sc.losingChunkId === (c.id || c.chunkId) ||
          (Array.isArray(sc.secondaryChunkIds) && sc.secondaryChunkIds.includes(c.id || c.chunkId))
        ))
    );
    if (primaryChunks.length > 0 && contradictingChunks.length > 0) {
      const primaryText = primaryChunks.map(c => String(c.text || c.chunk || '')).join('\n');
      const primaryNominals = new Set((primaryText.match(/Rp\.?\s*\d{1,3}(?:\.\d{3})+/gi) || []).map(m => m.replace(/\D/g, '')));
      const primarySks = new Set((primaryText.match(/\b(\d{2,3})\s*SKS\b/gi) || []).map(m => m.replace(/\D/g, '')));

      for (const cChunk of contradictingChunks) {
        const cText = String(cChunk.text || cChunk.chunk || '');
        const cNominals = (cText.match(/Rp\.?\s*\d{1,3}(?:\.\d{3})+/gi) || []).map(m => m.replace(/\D/g, ''));
        for (const nom of cNominals) {
          if (nom && !primaryNominals.has(nom)) {
            const formatted = Number(nom).toLocaleString('id-ID');
            if (text.includes(formatted) && !/\b(?:bukan|tidak\s+berlaku|koreksi|kesalahan)\b/i.test(text)) {
              return failVerification(`claim_from_contradicting_secondary_source: nominal Rp ${formatted} comes from contradicting secondary source`);
            }
          }
        }
        const cSks = (cText.match(/\b(\d{2,3})\s*SKS\b/gi) || []).map(m => m.replace(/\D/g, ''));
        for (const sksVal of cSks) {
          if (sksVal && !primarySks.has(sksVal)) {
            const sksRx = new RegExp(`\\b${sksVal}\\s*SKS\\b`, 'i');
            if (sksRx.test(text) && !/\b(?:perbedaan|needs_source_validation|verifikasi)\b/i.test(text)) {
              return failVerification(`claim_from_contradicting_secondary_source: ${sksVal} SKS comes from contradicting secondary source`);
            }
          }
        }
      }
    }

    // 3. Historical archive fact presented as active fact (historical_fact_presented_as_active)
    const isHistoricalQuery = semanticFrame?.constraints?.temporalConstraint === 'HISTORICAL_ARCHIVE' ||
      /\b(?:arsip|historis|tahun\s+lalu|masa\s+lalu|202[0-4]\/202[1-5])\b/i.test(semanticFrame?.rawQuery || '');
    if (!isHistoricalQuery && acceptedList.length > 0) {
      const historicalAccepted = acceptedList.filter(c =>
        c.temporalRelevance === 'HISTORICAL_ARCHIVE' ||
        c.evidenceRole === 'HISTORICAL_CONTEXT' ||
        c.provenance?.temporalStatus === 'HISTORICAL_ARCHIVE'
      );
      const activeAccepted = acceptedList.filter(c => !historicalAccepted.includes(c));
      const disclosesArchive = /\b(?:arsip|historis|historical\s+archive|periode\s+terdahulu|bukan\s+(?:merupakan\s+)?ketentuan\s+aktif)\b/i.test(text);

      if (historicalAccepted.length > 0 && activeAccepted.length === 0 && !disclosesArchive && !isExplicitAbstain) {
        return failVerification('historical_fact_presented_as_active: all supporting evidence is HISTORICAL_ARCHIVE without archive disclosure');
      }
      if (historicalAccepted.length > 0 && activeAccepted.length > 0 && !disclosesArchive) {
        const activeText = activeAccepted.map(c => String(c.text || c.chunk || '')).join('\n');
        const activeNominals = new Set((activeText.match(/Rp\.?\s*\d{1,3}(?:\.\d{3})+/gi) || []).map(m => m.replace(/\D/g, '')));
        for (const hChunk of historicalAccepted) {
          const hText = String(hChunk.text || hChunk.chunk || '');
          const hNominals = (hText.match(/Rp\.?\s*\d{1,3}(?:\.\d{3})+/gi) || []).map(m => m.replace(/\D/g, ''));
          for (const nom of hNominals) {
            if (nom && !activeNominals.has(nom)) {
              const formatted = Number(nom).toLocaleString('id-ID');
              if (text.includes(formatted)) {
                return failVerification(`historical_fact_presented_as_active: historical nominal Rp ${formatted} presented as active fact`);
              }
            }
          }
        }
      }
    }

    // 4. Unsubstantiated claim for an explicitly missing attribute (unsubstantiated_attribute_claim)
    const missingList = Array.isArray(arbitratedEvidence?.missingAspects) ? arbitratedEvidence.missingAspects : [];
    const attrEvalMap = arbitratedEvidence?.attributeEvaluation || {};
    if (missingList.length > 0 && Array.isArray(arbitratedEvidence?.coveredAspects) && arbitratedEvidence.coveredAspects.length > 0) {
      const affirmativeSentences = text
        .split(/(?<=[.!?])\s+|\n+/)
        .filter(s => !/\b(?:belum\s+terkonfirmasi|belum\s+tercantum|belum\s+tersedia|tidak\s+tercantum|not\s+confirmed|not\s+available|source_gap|catatan|note)\b/i.test(s))
        .join(' ');

      for (const mAttr of missingList) {
        const isExplicitlyUnsupported = !attrEvalMap[mAttr] || attrEvalMap[mAttr]?.status === 'UNSUPPORTED';
        if (!isExplicitlyUnsupported) continue;
        if (mAttr === 'career_prospects' && /\b(?:prospek\s+kar(?:i)?er|peluang\s+kerja|profesi\s+lulusan|lulusan\s+dapat\s+bekerja\s+sebagai)\b.*?\b(?:analyst|developer|engineer|consultant|manager|programmer|specialist)\b/i.test(affirmativeSentences)) {
          return failVerification('unsubstantiated_attribute_claim: career_prospects claimed without supporting evidence');
        }
        if ((mAttr === 'accreditation' || mAttr === 'akreditasi') && /\bterakreditasi\s+(?:["'“”]?)(?:unggul|baik\s+sekali|baik|a\b|b\b)/i.test(affirmativeSentences)) {
          return failVerification('unsubstantiated_attribute_claim: accreditation claimed without supporting evidence');
        }
        if (mAttr === 'fee' && /\b(?:dpp|spp|biaya\s+semester)\b.*?Rp\.?\s*\d{1,3}(?:\.\d{3})+/i.test(affirmativeSentences)) {
          return failVerification('unsubstantiated_attribute_claim: fee claimed without supporting evidence');
        }
      }
    }

    // 5. Attribute-level grounding guard for specific constraints (unsubstantiated_specific_attribute)
    // If the query asks for a specific constraint (e.g. minimal pages, age limits, fine amounts)
    // and accepted evidence does not support that specific attribute, the answer must not assert
    // general requirements without explicitly disclosing that the requested attribute is unconfirmed/unregulated.
    const queryForConstraint = String(semanticFrame?.rawQuery || semanticFrame?.normalizedQuery || '').toLowerCase();
    const isPageConstraint = /\b(?:berapa\s+(?:jumlah\s+)?halaman|halaman\s+minimal|minimal\s+(?:\d+\s+)?halaman|tebal\s+halaman|jumlah\s+halaman|minimal\s+lembar|berapa\s+lembar)\b/i.test(queryForConstraint);
    const isAgeConstraint = /\b(?:batas\s+(?:maksimal\s+)?(?:usia|umur)|maksimal\s+(?:usia|umur)|usia\s+maksimal|umur\s+maksimal|ada\s+batasan\s+umur)\b/i.test(queryForConstraint);
    const isFineConstraint = /\b(?:denda\s+keterlambatan|besaran\s+denda|tarif\s+denda|denda\s+berapa)\b/i.test(queryForConstraint);

    if (isPageConstraint || isAgeConstraint || isFineConstraint) {
      const acceptedFullText = acceptedList.map(c => String(c.text || c.chunk || '')).join('\n').toLowerCase();
      let hasConstraintInEvidence = false;
      let constraintType = '';

      if (isPageConstraint) {
        constraintType = 'page_limit';
        hasConstraintInEvidence = /\b(?:\d+\s+halaman|\d+\s+lembar|jumlah\s+halaman|halaman\s+minimal|minimal\s+halaman|tebal\s+halaman)\b/i.test(acceptedFullText);
      } else if (isAgeConstraint) {
        constraintType = 'age_limit';
        hasConstraintInEvidence = /\b(?:batas\s+usia|batasan\s+usia|batas\s+umur|maksimal\s+\d+\s+tahun|usia\s+maksimal|tidak\s+ada\s+batasan\s+usia)\b/i.test(acceptedFullText);
      } else if (isFineConstraint) {
        constraintType = 'fine_amount';
        hasConstraintInEvidence = /\b(?:denda|keterlambatan\s+dikenakan|denda\s+sebesar)\b/i.test(acceptedFullText);
      }

      if (!hasConstraintInEvidence) {
        const disclosesUnconfirmedConstraint = /\b(?:belum|tidak)\s+(?:tercantum|mencantumkan|diatur|mengatur|disebutkan|menyebutkan|tersedia|memuat|ada\s+ketentuan|dapat\s+dipastikan)\b/i.test(text) ||
          /\b(?:not\s+(?:listed|found|available|recorded)|unrecorded)\b/i.test(text);
        if (!disclosesUnconfirmedConstraint) {
          return {
            pass: false,
            outcome: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
            status: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
            reason: 'unsubstantiated_specific_attribute',
            isGrounded: false,
            handledSafely: true,
            detail: `Query requested ${constraintType} but accepted evidence lacks support and answer asserts general content without disclosure`
          };
        }
      }
    }
  }

  const isAnswerable = arbitratedEvidence?.answerability === 'ANSWERABLE' ||
    arbitratedEvidence?.answerabilityStatus === 'ANSWERABLE';

  const isCodingOrPrereqQuery = /\b(?:coding|koding|pemrograman|programming|syarat\s+coding)\b/i.test(semanticFrame?.rawQuery || '');
  if (isCodingOrPrereqQuery && isExplicitAbstain) {
    return {
      pass: false,
      outcome: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
      status: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
      reason: 'coding_prerequisite_unconfirmed_safe_unknown',
      isGrounded: false,
      handledSafely: true
    };
  }

  const isPureRefusalTemplate = /^\s*mohon\s+maaf.*(?:belum\s+dapat|tidak\s+dapat|belum\s+tercantum|tidak\s+tercantum).*(?:silakan\s+hubungi|dapat\s+menghubungi)/is.test(text) ||
    /^\s*informasi\s+resmi\s+terkait\s+aspek\s+tersebut\s+belum\s+tercantum/is.test(text) ||
    /^\s*tahapan\s+prosedur\s+pendaftaran\s+rinci.*belum\s+tercantum/is.test(text);

  const hasSubstantiveContent = text.length > 80 && !isPureRefusalTemplate && (
    /\b(antara\s+lain|meliputi|bekerja\s+sama|mitra|lulusan\s+memperoleh|potongan|persyaratan|berikut|kurikulum|fasilitas|layanan|sarana|wadah|discounts?|requirements?|guidelines?|includes?|tuition|biaya|tarif|dpp|spp|dana\s+pendidikan|angsuran|cicilan)\b/i.test(text)
  );

  if (isExplicitAbstain) {
    const isDateOrScheduleQuery = (
      /\b(?:kapan|tanggal|registrasi\s+ulang|kapan\s+dibuka|kapan\s+ditutup|kapan\s+buka|jadwal|periode|jadwal\s+registrasi|menerima\s+mahasiswa\s+baru\s+tahun\s+ini|dibuka\s+sekarang|minggu\s+depan|masih\s+sempat|masih\s+bisa|batas\s+akhir)\b/i.test(semanticFrame?.rawQuery || '') ||
      semanticFrame?.intent === 'ADMISSION_SCHEDULE' ||
      (semanticFrame?.aspects && semanticFrame.aspects.includes('schedule'))
    ) && semanticFrame?.intent !== 'TUITION_FEE_INQUIRY';
    const isDateUnavailableInText = /\b(?:tanggal|jadwal|waktu|registrasi\s+ulang|status\s+pendaftaran|status\s+gelombang)\s+.*(?:belum\s+(?:tercantum|tersedia|dapat\s+dipastikan)|tidak\s+(?:ditemukan|tercantum|tersedia))\b/i.test(text) ||
      /\b(?:belum\s+(?:tercantum|tersedia|dapat\s+dipastikan)|tidak\s+(?:ditemukan|tercantum|tersedia))\b/i.test(text);

    const isMultiAspectGrounded = hasSubstantiveContent && /\bpersyaratan\b/i.test(text) && /\bdokumen\b/i.test(text);
    if (isDateOrScheduleQuery && isDateUnavailableInText && (!hasSubstantiveContent || isPureRefusalTemplate) && !isMultiAspectGrounded) {
      return {
        pass: false,
        outcome: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
        status: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
        reason: 'requested_date_unconfirmed',
        isGrounded: false,
        handledSafely: true
      };
    }

    if (!hasSubstantiveContent || isPureRefusalTemplate) {
      // Guard: If evidence is present and answerability is affirmatively ANSWERABLE,
      // an unjustified refusal template must NOT be marked as a safe unknown.
      if (isAnswerable && Array.isArray(arbitratedEvidence?.accepted) && arbitratedEvidence.accepted.length > 0 && !isDateOrScheduleQuery) {
        return failVerification('unjustified_refusal_when_answerable_evidence_available');
      }

      return {
        pass: false,
        outcome: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
        status: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
        reason: 'safe_unknown',
        isGrounded: false,
        handledSafely: true
      };
    }
    // Substantive content accompanied by missing aspect disclosure (grounded partial answer)

    if (arbitratedEvidence?.accepted && arbitratedEvidence.accepted.length > 0) {
      // Topic relevance check: Kalender Akademik must mention Kalender Akademik / SION / BAAK / Perkuliahan
      const isCalQuery = /\bkalender\s+akademik\b/i.test(semanticFrame?.rawQuery || '');
      if (isCalQuery && !/\b(?:kalender\s+akademik|sion|portal|baak|perkuliahan|semester)\b/i.test(text)) {
        return failVerification('topic_mismatch_kalender_akademik_answered_with_unrelated_content');
      }

      const isExplicitFacilityQuery = semanticFrame?.intent === 'FACILITY_INQUIRY' ||
        (Array.isArray(semanticFrame?.aspects) && semanticFrame.aspects.includes('facilities') &&
          /\b(?:fasilitas|lab|laboratorium|gedung|perpustakaan|sarana|prasarana)\b/i.test(semanticFrame?.rawQuery || '')) ||
        (/\b(?:fasilitas|lab|laboratorium|gedung|perpustakaan|sarana|prasarana)\b/i.test(semanticFrame?.rawQuery || '') &&
          !/\b(?:lokasi|alamat|di\s*mana|dimana)\b/i.test(semanticFrame?.rawQuery || ''));

      const isBranchFacility = isExplicitFacilityQuery &&
        semanticFrame?.targetBranch &&
        ['jimbaran', 'abiansemal'].includes(semanticFrame.targetBranch);

      if (isBranchFacility) {
        return {
          pass: true,
          outcome: 'PARTIAL',
          status: 'PARTIAL',
          reason: 'verified_branch_contact_with_facility_source_gap',
          isGrounded: true,
          handledSafely: true,
          sourceGap: true
        };
      }

      const isMultiAspectQuery = (
        /\b(?:syarat(?:nya)?|persyaratan(?:nya)?)\b/i.test(semanticFrame?.rawQuery || '') &&
        /\b(?:jadwal(?:nya)?|gelombang(?:nya)?|kapan)\b/i.test(semanticFrame?.rawQuery || '') &&
        /\b(?:dokumen(?:nya)?|berkas(?:nya)?)\b/i.test(semanticFrame?.rawQuery || '')
      ) || (
          Array.isArray(semanticFrame?.aspects) &&
          semanticFrame.aspects.includes('requirements') &&
          (semanticFrame.aspects.includes('schedule') || /\bjadwal/i.test(semanticFrame?.rawQuery || '')) &&
          semanticFrame.aspects.includes('documents')
        );
      const hasUnprovenAspectClaims = isMultiAspectQuery && /\b(?:belum\s+(?:tercantum|tersedia|dapat\s+dipastikan)|source\s+gap)\b/i.test(text);

      if (hasUnprovenAspectClaims) {
        return {
          pass: false,
          outcome: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
          status: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
          reason: 'multi_aspect_claims_unproven_safe_unknown',
          isGrounded: false,
          handledSafely: true
        };
      }

      const isFeeSourceGapRefusal = (
        semanticFrame?.intent === 'TUITION_FEE_INQUIRY' ||
        semanticFrame?.domain === 'TUITION_FEE' ||
        (Array.isArray(semanticFrame?.aspects) && semanticFrame.aspects.includes('fee'))
      ) && (
          /\b(?:total\s+keseluruhan\s+biaya.*belum\s+dapat\s+dipastikan|nominal\s+pasti\s+dpp.*belum\s+dapat\s+dipastikan|tarif.*belum\s+dapat\s+dipastikan|tarif\s+resmi.*belum\s+tercantum)\b/i.test(text)
        );

      if (isFeeSourceGapRefusal) {
        return {
          pass: false,
          outcome: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
          status: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
          reason: 'safe_unknown',
          isGrounded: false,
          handledSafely: true
        };
      }

      const PRIMARY_MULTI_ATTRS = new Set([
        'fee', 'accreditation', 'curriculum', 'sks', 'study_mode', 'faculty', 'degree_award',
        'career_prospects', 'scholarship', 'location', 'contact', 'facilities', 'student_organization'
      ]);
      const isMultiAttrPartial = Array.isArray(arbitratedEvidence?.missingAspects) &&
        arbitratedEvidence.missingAspects.some(a => PRIMARY_MULTI_ATTRS.has(a)) &&
        Array.isArray(arbitratedEvidence?.coveredAspects) &&
        arbitratedEvidence.coveredAspects.some(a => PRIMARY_MULTI_ATTRS.has(a));

      if (isMultiAttrPartial) {
        return {
          pass: true,
          outcome: 'PARTIAL',
          status: 'PARTIAL',
          reason: 'verified_grounded_partial_disclosure',
          isGrounded: true,
          handledSafely: true,
          sourceGap: true
        };
      }

      return {
        pass: true,
        outcome: VERIFICATION_OUTCOME.VERIFIED_FACTUAL,
        status: VERIFICATION_OUTCOME.VERIFIED_FACTUAL,
        reason: 'verified_grounded_partial_disclosure',
        isGrounded: true,
        handledSafely: true
      };
    }
  }

  const isEscalationGuidance = /\b(silakan\s+(?:menghubungi|berkonsultasi|konfirmasi|hubungi)\s+(?:dosen\s+wali|bagian\s+akademik|admisi|pmb|pusat\s+informasi)|contact\s+the\s+admission\s+office)\b/i.test(text) &&
    (!arbitratedEvidence?.accepted || arbitratedEvidence.accepted.length === 0);
  if (isEscalationGuidance) {
    return {
      pass: false,
      outcome: VERIFICATION_OUTCOME.ESCALATION_GUIDANCE,
      status: VERIFICATION_OUTCOME.ESCALATION_GUIDANCE,
      reason: 'escalation_guidance',
      isGrounded: false,
      handledSafely: true
    };
  }

  const isPreferenceClarification = /\b(?:masih\s+)?(?:bingung|bimbang|ragu|galau)\s+(?:memilih|pilih|milih|menentukan)\s+(?:kampus|kuliah|universitas|jurusan)\b/i.test(semanticFrame?.rawQuery || '') &&
    /\b(boleh\s+kami\s+tahu|minat\s+apa|latar\s+belakang\s+pendidikan)\b/i.test(text);
  if (isPreferenceClarification) {
    return {
      pass: true,
      outcome: VERIFICATION_OUTCOME.VERIFIED_FACTUAL,
      status: VERIFICATION_OUTCOME.VERIFIED_FACTUAL,
      reason: 'verified_recommendation_preference_inquiry',
      isGrounded: true,
      handledSafely: true
    };
  }

  const isClarification = (
    semanticFrame?.intent === 'AMBIGUOUS_CLARIFICATION' ||
    /\b(mohon\s+(?:jelaskan|klarifikasi)\s+program\s+studi|pilihan\s+Kakak|could\s+you\s+please\s+clarify)\b/i.test(text)
  );
  if (isClarification) {
    return {
      pass: false,
      outcome: VERIFICATION_OUTCOME.ESCALATION_GUIDANCE,
      status: VERIFICATION_OUTCOME.ESCALATION_GUIDANCE,
      reason: 'clarification_prompt',
      isGrounded: false,
      handledSafely: true
    };
  }

  const isCatalog = (
    semanticFrame?.intent === 'AVAILABLE_PROGRAMS_LIST' ||
    semanticFrame?.intent === 'PROGRAM_CATALOG_INQUIRY' ||
    semanticFrame?.intent === 'FACULTY_INQUIRY' ||
    /\b(Program Sarjana \(S1\)|Program Diploma \(D3\)|Program Pascasarjana \(S2\)|Fakultas Informatika dan Komputer|Fakultas Bisnis dan Vokasi)\b/i.test(text)
  ) && Boolean(arbitratedEvidence?.accepted && arbitratedEvidence.accepted.length > 0);
  if (isCatalog) {
    return {
      pass: true,
      outcome: VERIFICATION_OUTCOME.VERIFIED_FACTUAL,
      status: VERIFICATION_OUTCOME.VERIFIED_FACTUAL,
      reason: 'verified_catalog',
      isGrounded: true,
      handledSafely: true
    };
  }

  if (arbitratedEvidence?.accepted && arbitratedEvidence.accepted.length > 0) {
    const isDateOrScheduleQuery = /\b(?:kapan|tanggal|registrasi\s+ulang|kapan\s+dibuka|kapan\s+ditutup|kapan\s+buka|jadwal|periode|jadwal\s+registrasi|menerima\s+mahasiswa\s+baru\s+tahun\s+ini|dibuka\s+sekarang|kapan\s+pembayaran)\b/i.test(semanticFrame?.rawQuery || '');
    const isDateUnavailableInText = /\b(?:tanggal|jadwal|waktu|registrasi\s+ulang|status\s+pendaftaran|status\s+gelombang)\s+.*(?:belum\s+(?:tercantum|tersedia|dapat\s+dipastikan)|tidak\s+(?:ditemukan|tercantum|tersedia))\b/i.test(text) ||
      /\b(?:belum\s+(?:tercantum|tersedia|dapat\s+dipastikan)|tidak\s+(?:ditemukan|tercantum|tersedia))\b/i.test(text);
    const isMultiAspectGrounded = hasSubstantiveContent && /\bpersyaratan\b/i.test(text) && /\bdokumen\b/i.test(text);
    if (isDateOrScheduleQuery && isDateUnavailableInText && (!hasSubstantiveContent || isPureRefusalTemplate) && !isMultiAspectGrounded) {
      return {
        pass: false,
        outcome: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
        status: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
        reason: 'requested_date_unconfirmed',
        isGrounded: false,
        handledSafely: true
      };
    }

    // Verify phone numbers claimed in candidateAnswer against accepted evidence
    const combinedAcceptedText = arbitratedEvidence.accepted.map(c => c.text || c.chunk || c.content || '').join(' ');
    const normEvidenceDigits = combinedAcceptedText.replace(/[\s.\-()]/g, '');
    const phoneMatches = text.match(/\b(?:08\d{8,11}|\(0361\)\s*\d{5,7}|0361[\s\-]?\d{5,7})\b/g) || [];
    for (const rawPhone of phoneMatches) {
      const cleanPhone = rawPhone.replace(/[\s.\-()]/g, '');
      if (cleanPhone.length >= 9 && !normEvidenceDigits.includes(cleanPhone)) {
        return failVerification(`unsupported_contact_number_claim: ${rawPhone}`);
      }
    }

    // Verify multi-entity substantive coverage when 2+ primary entities have supporting evidence
    if (Array.isArray(semanticFrame?.entities) && semanticFrame.entities.length > 1) {
      const { findCanonicalEntity } = require('../engine/canonicalEntityRegistry');
      const MODIFIER_FAMS = new Set(['admission_track', 'participant_scope', 'academic_scope', 'study_mode']);
      const primaryEnts = semanticFrame.entities
        .map(e => e.canonical || e.name || String(e))
        .filter(Boolean)
        .filter(ent => {
          const ce = findCanonicalEntity(ent);
          return !ce || !MODIFIER_FAMS.has(ce.family);
        });

      const hasSpecificEntity = primaryEnts.some(ent => ent !== 'Kampus ITB STIKOM Bali' && ent !== 'ITB STIKOM Bali');
      const filteredPrimaryEnts = hasSpecificEntity
        ? primaryEnts.filter(ent => ent !== 'Kampus ITB STIKOM Bali' && ent !== 'ITB STIKOM Bali')
        : primaryEnts;

      if (filteredPrimaryEnts.length > 1) {
        const supportedPrimaryEnts = filteredPrimaryEnts.filter(ent =>
          arbitratedEvidence.accepted.some(c =>
            (Array.isArray(c.supportedEntities) && c.supportedEntities.some(se => String(se).toLowerCase() === String(ent).toLowerCase())) ||
            (c.text || c.chunk || '').toLowerCase().includes(ent.replace(/^(?:S1|S2|D3|D4)\s+/i, '').toLowerCase())
          )
        );

        if (supportedPrimaryEnts.length > 1) {
          const textLower = text.toLowerCase();
          for (const ent of supportedPrimaryEnts) {
            const baseName = ent.replace(/^(?:S1|S2|D3|D4)\s+/i, '').trim().toLowerCase();
            const ce = findCanonicalEntity(ent);
            const aliases = (ce && Array.isArray(ce.aliases)) ? ce.aliases.map(a => a.toLowerCase()) : [];
            const isMentioned = textLower.includes(ent.toLowerCase()) ||
              (baseName.length >= 3 && textLower.includes(baseName)) ||
              aliases.some(a => a.length >= 2 && new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));
            if (!isMentioned) {
              return failVerification(`multi_entity_missing_supported_entity_in_answer: ${ent}`);
            }
          }
        }
      }
    }

    const isExplicitFacilityQuery = semanticFrame?.intent === 'FACILITY_INQUIRY' ||
      (Array.isArray(semanticFrame?.aspects) && semanticFrame.aspects.includes('facilities') &&
        /\b(?:fasilitas|lab|laboratorium|gedung|perpustakaan|sarana|prasarana)\b/i.test(semanticFrame?.rawQuery || '')) ||
      (/\b(?:fasilitas|lab|laboratorium|gedung|perpustakaan|sarana|prasarana)\b/i.test(semanticFrame?.rawQuery || '') &&
        !/\b(?:lokasi|alamat|di\s*mana|dimana)\b/i.test(semanticFrame?.rawQuery || ''));

    const isBranchFacility = isExplicitFacilityQuery &&
      semanticFrame?.targetBranch &&
      ['jimbaran', 'abiansemal'].includes(semanticFrame.targetBranch);

    if (isBranchFacility) {
      return {
        pass: true,
        outcome: 'PARTIAL',
        status: 'PARTIAL',
        reason: 'verified_branch_contact_with_facility_source_gap',
        isGrounded: true,
        handledSafely: true,
        sourceGap: true
      };
    }

    const PRIMARY_MULTI_ATTRS_FINAL = new Set([
      'fee', 'accreditation', 'curriculum', 'sks', 'study_mode', 'faculty', 'degree_award',
      'career_prospects', 'scholarship', 'location', 'contact', 'facilities', 'student_organization'
    ]);
    const isMultiAttrPartialFinal = Array.isArray(arbitratedEvidence?.missingAspects) &&
      arbitratedEvidence.missingAspects.some(a => PRIMARY_MULTI_ATTRS_FINAL.has(a)) &&
      Array.isArray(arbitratedEvidence?.coveredAspects) &&
      arbitratedEvidence.coveredAspects.some(a => PRIMARY_MULTI_ATTRS_FINAL.has(a)) &&
      /\b(?:belum\s+terkonfirmasi|belum\s+tercantum|belum\s+tersedia|not\s+confirmed)\b/i.test(text);

    if (isMultiAttrPartialFinal) {
      return {
        pass: true,
        outcome: 'PARTIAL',
        status: 'PARTIAL',
        reason: 'verified_grounded_partial_disclosure',
        isGrounded: true,
        handledSafely: true,
        sourceGap: true
      };
    }

    return {
      pass: true,
      outcome: VERIFICATION_OUTCOME.VERIFIED_FACTUAL,
      status: VERIFICATION_OUTCOME.VERIFIED_FACTUAL,
      reason: 'verified_grounded',
      isGrounded: true,
      handledSafely: true
    };
  }

  return {
    pass: false,
    outcome: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
    status: VERIFICATION_OUTCOME.SAFE_UNKNOWN,
    reason: 'safe_unknown',
    isGrounded: false,
    handledSafely: true
  };
}

module.exports = {
  verifyFinalAnswer,
  VERIFICATION_OUTCOME
};
