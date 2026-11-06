'use strict';

/**
 * src/core/evidenceArbiter.js
 *
 * Greenfield Evidence Arbitration Layer.
 * Invariant: RELEVANT TOPIC != ANSWERABLE EVIDENCE.
 *
 * Strict Evaluation Gates:
 * 1. Entity Match: If plan locks entity DNUI, evidence citing HELP University is REJECTED.
 * 2. Excluded Entity Check: Matches in excludedConflictingEntities are REJECTED.
 * 3. Temporal Match: If constraint is NOW, historical evidence without current period validity is REJECTED.
 * 4. Aspect / Semantic Match: Evidence must actually contain answers for the requested aspect.
 */

const { findCanonicalEntity } = require('../engine/canonicalEntityRegistry');
const { arbitrateEvidenceWithContract, compareRetrievalShadow, buildRetrievalContract } = require('./retrievalContract');

function normalizePunctuation(str) {
  if (!str) return '';
  return str.toLowerCase()
    .replace(/[“”—\-_,.:;()\/\\"'\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolves standard program code (SI, TI, BD, SK, MI, S2) from program or association entity string
 */
function getProgramCodeFromEntity(entityStr) {
  if (!entityStr) return null;
  const PROGRAM_CODE_MAP = {
    'S1 Sistem Informasi': 'SI',
    'S1 Teknologi Informasi': 'TI',
    'S1 Bisnis Digital': 'BD',
    'S1 Sistem Komputer': 'SK',
    'D3 Manajemen Informatika': 'MI',
    'S2 Magister Ilmu Komputer': 'S2',
    'S2 Sistem Informasi': 'S2',
    'S2 Magister Sistem Informasi': 'S2',
    'HIMAPRODI Sistem Informasi': 'SI',
    'HIMAPRODI Teknologi Informasi': 'TI',
    'HIMAPRODI Bisnis Digital': 'BD',
    'HIMAPRODI Sistem Komputer': 'SK',
    'HIMA SI': 'SI',
    'HIMA TI': 'TI',
    'HIMA BD': 'BD',
    'HIMA SK': 'SK',
    'Himpunan Mahasiswa Sistem Informasi': 'SI',
    'Himpunan Mahasiswa Teknologi Informasi': 'TI',
    'Himpunan Mahasiswa Bisnis Digital': 'BD',
    'Himpunan Mahasiswa Sistem Komputer': 'SK'
  };
  if (PROGRAM_CODE_MAP[entityStr]) return PROGRAM_CODE_MAP[entityStr];
  const norm = entityStr.toLowerCase();
  if (/\b(?:sistem\s+komputer|sk)\b/i.test(norm)) return 'SK';
  if (/\b(?:sistem\s+informasi|si)\b/i.test(norm)) return 'SI';
  if (/\b(?:teknologi\s+informasi|ti)\b/i.test(norm)) return 'TI';
  if (/\b(?:bisnis\s+digital|bd)\b/i.test(norm)) return 'BD';
  if (/\b(?:manajemen\s+informatika|mi)\b/i.test(norm)) return 'MI';
  if (/\b(?:magister|pascasarjana|s2)\b/i.test(norm)) return 'S2';
  return null;
}


/**
 * Checks whether candidate text supports a specific target entity using canonical registry
 */
function isCandidateMatchingTargetEntity(candidateTextOrObj, targetEntityStr) {
  if (!candidateTextOrObj || !targetEntityStr) return false;

  const candidateText = typeof candidateTextOrObj === 'string'
    ? candidateTextOrObj
    : (candidateTextOrObj.text || candidateTextOrObj.chunk || '');
  const candidateFile = typeof candidateTextOrObj === 'object'
    ? (candidateTextOrObj.sourceFile || candidateTextOrObj.source_file || candidateTextOrObj.sourceDocument || candidateTextOrObj.filename || '')
    : '';

  const rawTextNorm = candidateText.toLowerCase();
  const cleanText = normalizePunctuation(candidateText);
  const targetNorm = targetEntityStr.toLowerCase();
  const fileNorm = candidateFile.toLowerCase();

  const isObjectCandidate = typeof candidateTextOrObj === 'object';
  const candLevelRaw = isObjectCandidate ? (candidateTextOrObj.academicLevel || candidateTextOrObj.level || (candidateTextOrObj.metadata && (candidateTextOrObj.metadata.academicLevel || candidateTextOrObj.metadata.level))) : null;
  const candLevel = candLevelRaw ? String(candLevelRaw).toUpperCase() : null;
  const targetCode = getProgramCodeFromEntity(targetEntityStr);

  const hasS1OrUndergrad = /\b(?:s1|sarjana|d3|diploma)\b/i.test(candidateFile) ||
    /\b(?:s1|sarjana|d3|diploma)\b/i.test(candidateText);

  // 1. Strict degree & academic level isolation (Runs BEFORE any metadata/context acceptance)
  if (/^S1\b/i.test(targetEntityStr)) {
    if (candLevel === 'S2') return false;
    if (/\b(magister|s2|pascasarjana)\b/i.test(cleanText) && !hasS1OrUndergrad) {
      return false;
    }
    // Contextual disambiguation between S1 Sistem Informasi and S2 Sistem Informasi:
    // If all mentions of "sistem informasi" in the chunk are explicitly S2/Magister/Pascasarjana, do NOT match as S1 Sistem Informasi.
    if (/^S1\s+Sistem\s+Informasi$/i.test(targetEntityStr.trim()) && cleanText.includes('sistem informasi')) {
      const textWithoutS2Si = cleanText
        .replace(/\b(?:s2|magister|pascasarjana)(?:\s+\w+){0,2}\s+sistem\s+informasi\b/gi, ' ')
        .replace(/\bsistem\s+informasi\s+s2\b/gi, ' ');
      if (!textWithoutS2Si.includes('sistem informasi')) {
        return false;
      }
    }
  }
  if (/^S2\b/i.test(targetEntityStr)) {
    if (candLevel && ['S1', 'D3'].includes(candLevel)) return false;
    if (candLevel !== 'S2' && !/\b(magister|s2|pascasarjana)\b/i.test(cleanText) && !/\b(magister|s2|pascasarjana)\b/i.test(fileNorm)) {
      return false;
    }
    // Contextual disambiguation between S2 Sistem Informasi and S1 Sistem Informasi:
    // If all mentions of "sistem informasi" in the chunk are explicitly S1/Sarjana/HIMAPRODI, do NOT match as S2 Sistem Informasi.
    if (/^S2\s+(?:Magister\s+)?Sistem\s+Informasi$/i.test(targetEntityStr.trim()) && cleanText.includes('sistem informasi')) {
      const textWithoutS1Si = cleanText
        .replace(/\b(?:s1|sarjana|strata\s*1|hima(?:prodi)?)(?:\s+\w+){0,2}\s+sistem\s+informasi\b/gi, ' ')
        .replace(/\bsistem\s+informasi\s+s1\b/gi, ' ');
      if (!textWithoutS1Si.includes('sistem informasi')) {
        return false;
      }
    }
  }
  if (/^D3\b/i.test(targetEntityStr)) {
    if (candLevel && ['S1', 'S2'].includes(candLevel)) return false;
    if (candLevel !== 'D3' && !/\b(d3|diploma|ahli madya)\b/i.test(cleanText) && !/\b(d3|diploma|ahli madya)\b/i.test(fileNorm)) {
      return false;
    }
  }

  // 2. Hard program isolation & sibling header exclusion (Runs BEFORE contextEntities acceptance)
  if (isObjectCandidate) {
    let candProg = candidateTextOrObj.program ? String(candidateTextOrObj.program).toUpperCase() : null;
    const isCandidateS2 = (candLevel === 'S2' ||
      /(?:pascasarjana|magister)/i.test(candidateFile) ||
      /\b(?:program pascasarjana|magister sistem informasi|s2 sistem informasi)\b/i.test(candidateText)) && !hasS1OrUndergrad;
    if (isCandidateS2 && (candProg === 'SI' || !candProg)) {
      candProg = 'S2';
    }
    // Context entities match for valid multi-program documents (e.g. multi-program PDF documents)
    const hasMatchingContextEntity = Array.isArray(candidateTextOrObj.contextEntities) && candidateTextOrObj.contextEntities.length > 0 &&
      candidateTextOrObj.contextEntities.some(ce => (targetCode && getProgramCodeFromEntity(ce) === targetCode) || normalizePunctuation(ce) === targetNorm);

    if (!hasMatchingContextEntity && targetCode && candProg && candProg !== targetCode && (candidateTextOrObj.scope === 'PROGRAM_SINGLE' || (candidateTextOrObj.program && candProg !== 'MULTI'))) {
      return false;
    }

    // Section header check: if candidate header explicitly names a single DIFFERENT program, reject!
    const headerMatch = (candidateText || '').match(/^\[Program:\s*([^\]]+)\]/i);
    if (headerMatch) {
      const headerProg = headerMatch[1].trim();
      const headerCode = getProgramCodeFromEntity(headerProg);
      if (headerCode && targetCode && headerCode !== targetCode && !headerProg.includes(',')) {
        return false;
      }
    }

    // Direct entity metadata matches
    if (candidateTextOrObj.canonicalEntity && normalizePunctuation(candidateTextOrObj.canonicalEntity) === targetNorm) {
      return true;
    }
    if (candidateTextOrObj.correctedEntity && normalizePunctuation(candidateTextOrObj.correctedEntity) === targetNorm) {
      return true;
    }
    if (targetCode && candProg && candProg === targetCode) {
      return true;
    }

    // Context entities match for valid multi-program documents
    if (Array.isArray(candidateTextOrObj.contextEntities) && candidateTextOrObj.contextEntities.length > 0) {
      const targetNormPunc = normalizePunctuation(targetEntityStr);
      if (candidateTextOrObj.contextEntities.some(ce => normalizePunctuation(ce) === targetNormPunc)) {
        return true;
      }
      if (targetCode && candidateTextOrObj.contextEntities.some(ce => getProgramCodeFromEntity(ce) === targetCode)) {
        return true;
      }
    }

    const isMultiProg = candidateTextOrObj.scope === 'PROGRAM_MULTI' ||
      (Array.isArray(candidateTextOrObj.contextEntities) && candidateTextOrObj.contextEntities.length > 1);

    if (isMultiProg) {
      const supportedEntities = Array.isArray(candidateTextOrObj.supportedEntities) && candidateTextOrObj.supportedEntities.length > 0
        ? candidateTextOrObj.supportedEntities.map(normalizePunctuation)
        : (Array.isArray(candidateTextOrObj.contextEntities) ? candidateTextOrObj.contextEntities.map(normalizePunctuation) : []);
      const supportedPrograms = Array.isArray(candidateTextOrObj.supportedPrograms) && candidateTextOrObj.supportedPrograms.length > 0
        ? candidateTextOrObj.supportedPrograms.map(p => String(p).toUpperCase())
        : (Array.isArray(candidateTextOrObj.contextEntities) ? candidateTextOrObj.contextEntities.map(getProgramCodeFromEntity).filter(Boolean) : (candidateTextOrObj.program === 'MULTI' ? ['SI', 'TI', 'BD'] : []));
      if (supportedEntities.includes(normalizePunctuation(targetEntityStr)) || (targetCode && supportedPrograms.includes(targetCode))) {
        return true;
      }
    }
  }

  // 1. Direct substring match (in text or in certificate filename)
  if (rawTextNorm.includes(targetNorm) || cleanText.includes(normalizePunctuation(targetEntityStr))) {
    return true;
  }
  if (candidateFile && fileNorm.includes(targetNorm)) {
    return true;
  }

  // 2. Canonical registry lookup
  const canonicalEntry = findCanonicalEntity(targetEntityStr);
  if (canonicalEntry) {
    const canNorm = normalizePunctuation(canonicalEntry.canonical);
    if (cleanText.includes(canNorm)) return true;

    if (Array.isArray(canonicalEntry.aliases)) {
      for (const alias of canonicalEntry.aliases) {
        const aliasNorm = normalizePunctuation(alias);
        if (aliasNorm.length <= 2) {
          const wordRegex = new RegExp(`\\b${aliasNorm}\\b`, 'i');
          if (wordRegex.test(cleanText) || (fileNorm && wordRegex.test(fileNorm))) return true;
        } else {
          if (cleanText.includes(aliasNorm) || (fileNorm && fileNorm.includes(aliasNorm))) return true;
        }
      }
    }

    if (canonicalEntry.family === 'academic_program' || canonicalEntry.type === 'program') {
      const baseName = canonicalEntry.canonical.replace(/^(S1|S2|D3|D4)\s+/i, '').trim();
      const baseNorm = normalizePunctuation(baseName);
      if (baseNorm.length > 3) {
        if (cleanText.includes(baseNorm)) {
          return true;
        }
        // Only allow filename match if candidate is a dedicated certificate or official curriculum file
        if (fileNorm && fileNorm.includes(baseNorm) && /\b(?:sertifikat|akreditasi|kurikulum|mata_kuliah|daftar_mata_kuliah)\b/i.test(fileNorm)) {
          return true;
        }
      }
    }

    if (canonicalEntry.family === 'campus_location' || canonicalEntry.type === 'campus_location') {
      const isDocLoc = isObjectCandidate && (
        candidateTextOrObj.docCategory === 'LOKASI' ||
        candidateTextOrObj.category === 'LOKASI' ||
        (candidateTextOrObj.metadata && (candidateTextOrObj.metadata.docCategory === 'LOKASI' || candidateTextOrObj.metadata.category === 'LOKASI'))
      );
      if (/kampus\s+itb\s+stikom\s+bali/i.test(canonicalEntry.canonical)) {
        const hasBranchMarker = /\b(?:renon|puputan|jimbaran|udayana|abiansemal|dauh\s+yeh\s+cani)\b/i.test(cleanText);
        const hasCampusOrStikom = /\b(?:kampus|stikom|lokasi|alamat)\b/i.test(cleanText) || isDocLoc;
        if (hasBranchMarker && hasCampusOrStikom) {
          return true;
        }
      } else if (/renon/i.test(canonicalEntry.canonical)) {
        if (/\b(?:renon|puputan)\b/i.test(cleanText)) return true;
      } else if (/jimbaran/i.test(canonicalEntry.canonical)) {
        if (/\b(?:jimbaran|udayana|bukit\s+jimbaran)\b/i.test(cleanText)) return true;
      } else if (/abiansemal/i.test(canonicalEntry.canonical)) {
        if (/\b(?:abiansemal|dauh\s+yeh\s+cani|badung)\b/i.test(cleanText)) return true;
      }
    }

    if (canonicalEntry.family === 'academic_scope' || canonicalEntry.type === 'academic_scope') {
      const degree = canonicalEntry.degree || (/S1\b/i.test(canonicalEntry.canonical) ? 'S1' : (/S2\b/i.test(canonicalEntry.canonical) ? 'S2' : (/D3\b/i.test(canonicalEntry.canonical) ? 'D3' : null)));
      if (degree === 'S1') {
        if (/\b(?:s1|sarjana|strata\s+(?:1|satu))\b/i.test(cleanText) || /\b(?:s1|sarjana|strata\s+(?:1|satu))\b/i.test(fileNorm)) {
          return true;
        }
      } else if (degree === 'S2') {
        if (/\b(?:s2|magister|pascasarjana|strata\s+(?:2|dua))\b/i.test(cleanText) || /\b(?:s2|magister|pascasarjana|strata\s+(?:2|dua))\b/i.test(fileNorm)) {
          return true;
        }
      } else if (degree === 'D3') {
        if (/\b(?:d3|diploma(?:\s+3|\s+tiga)?|ahli\s+madya)\b/i.test(cleanText) || /\b(?:d3|diploma(?:\s+3|\s+tiga)?|ahli\s+madya)\b/i.test(fileNorm)) {
          return true;
        }
      }
    }

    if (canonicalEntry.family === 'student_organization' || canonicalEntry.type === 'ukm') {
      // Isolate specific HIMAPRODI associations by checking their distinctive program acronym (e.g. TI, SI, SK, BD)
      const progMatch = canonicalEntry.canonical.match(/\b(?:HIMAPRODI|HIMA)\s+(.+)$/i);
      if (progMatch) {
        const specificName = normalizePunctuation(progMatch[1]);
        const PROG_ACRONYMS = {
          'teknologi informasi': 'ti',
          'sistem informasi': 'si',
          'sistem komputer': 'sk',
          'bisnis digital': 'bd'
        };
        const acronym = PROG_ACRONYMS[specificName];
        if (cleanText.includes(specificName) || (fileNorm && fileNorm.includes(specificName))) return true;
        if (acronym) {
          const acrRegex = new RegExp(`\\b${acronym}\\b`, 'i');
          if ((acrRegex.test(cleanText) || (fileNorm && acrRegex.test(fileNorm))) &&
            (/\b(?:himaprodi|hima|himpunan)\b/i.test(cleanText) || /\b(?:himaprodi|hima|himpunan)\b/i.test(fileNorm))) {
            return true;
          }
        }
      } else {
        const match = canonicalEntry.canonical.match(/\b([A-Z0-9]{3,})\b/);
        if (match) {
          const code = match[1].toLowerCase();
          if (cleanText.includes(code) || (fileNorm && fileNorm.includes(code))) return true;
        }
      }
    }

    if (canonicalEntry.family === 'admission_track' || canonicalEntry.type === 'admission_track') {
      if (/\brpl\b|rekognisi\s+pembelajaran\s+lampau/i.test(canonicalEntry.canonical)) {
        if (/\b(?:rpl|rekognisi\s+pembelajaran\s+lampau)\b/i.test(cleanText) || /\b(?:rpl|rekognisi)\b/i.test(fileNorm)) {
          return true;
        }
        // Direct continuation chunk of Butir 12 containing recognized SKS brackets
        if (/\b(?:jumlah\s+)?pengakuan\s+sks\s+antara\b/i.test(cleanText)) {
          return true;
        }
      }
    }
  }

  // 3. Generic distinctive token matching for target entity
  const genericStopwords = new Set(['program', 'studi', 'degree', 'double', 'dual', 'jenjang', 'sarjana', 'diploma', 's1', 's2', 'd3', 'd4', 'biaya']);
  const normEntity = normalizePunctuation(targetEntityStr);
  if (cleanText.includes(normEntity)) return true;

  const targetTokens = normEntity.split(/\s+/).filter(t => t.length >= 3 && !genericStopwords.has(t));
  if (targetTokens.length === 1) {
    if (cleanText.includes(targetTokens[0])) return true;
  } else if (targetTokens.length === 2) {
    const proximityPattern = new RegExp('\\b' + targetTokens[0] + '\\b(?:\\s+\\w+){0,5}\\s+\\b' + targetTokens[1] + '\\b', 'i');
    if (proximityPattern.test(cleanText)) return true;
    const revProximityPattern = new RegExp('\\b' + targetTokens[1] + '\\b(?:\\s+\\w+){0,5}\\s+\\b' + targetTokens[0] + '\\b', 'i');
    if (revProximityPattern.test(cleanText)) return true;
  } else if (targetTokens.length > 2) {
    // For 3 or more distinctive tokens, ALL must be present in cleanText to avoid cross-entity false positives
    // e.g. "himaprodi sistem komputer" must not match "himaprodi sistem informasi"
    if (targetTokens.every(t => cleanText.includes(t))) return true;
  }

  // For non-program conceptual entities (e.g. admission wave, process), verify all distinctive non-generic tokens
  const isProgramEntity = Boolean(canonicalEntry && canonicalEntry.family === 'academic_program');
  if (!isProgramEntity && targetTokens.length > 1) {
    const distinctiveTokens = targetTokens.filter(t => !['pendaftaran', 'mahasiswa', 'kampus', 'stikom'].includes(t));
    if (distinctiveTokens.length > 0 && distinctiveTokens.every(t => cleanText.includes(t))) {
      return true;
    }
  }

  return false;
}

function evaluateEvidenceCompatibility(candidate, retrievalPlan = {}) {
  const candidateText = (candidate && (candidate.text || candidate.chunk)) || '';
  if (!candidate || !candidateText) {
    return { accepted: false, reason: 'empty_evidence' };
  }

  const text = candidateText.toLowerCase();
  const cleanText = normalizePunctuation(candidateText);
  const { targetEntities = [], excludedConflictingEntities = [], temporalConstraint, requiredAspects } = retrievalPlan;
  const queryText = (retrievalPlan.query || retrievalPlan.rawQuery || (retrievalPlan.queryVariants && retrievalPlan.queryVariants.join(' ')) || '').toLowerCase();

  // 0.0 Synthetic OCR / ingestion instruction placeholder noise gate
  if (/Gunakan nama file, caption, atau input manual tambahan untuk memberi konteks spesifik/i.test(candidateText)) {
    return {
      accepted: false,
      disposition: 'REJECT_ASPECT_MISMATCH',
      reason: 'synthetic_ocr_instruction_placeholder'
    };
  }

  // 0.1 Orphan Header Noise Gate (Headers lacking substantive facts/criteria/benefits)
  const trimmed = candidateText.trim();
  const isOrphanHeader = (trimmed.endsWith(':') || /^(?:\d+[\.\)]|\-|\*)\s*[^:\n]+:$/.test(trimmed)) &&
    trimmed.length < 80 &&
    !/\d{2,}%|rp\b|\d{5,}|juara|piagam/i.test(trimmed);
  if (isOrphanHeader) {
    return {
      accepted: false,
      disposition: 'REJECT_ASPECT_MISMATCH',
      reason: 'REJECT_ASPECT_MISMATCH'
    };
  }

  // 0.15 Privacy Policy & Student Personal Data Protection Aspect Gate
  // When user is inquiring about institutional privacy policy, data protection, or data sharing:
  // Reject irrelevant quality policy (kebijakan mutu), student organizations (BEM), student exchange (GCCP), and marketing/fee brochures.
  const isPrivacyPolicyQuery = retrievalPlan.intent === 'PRIVACY_POLICY_INQUIRY' ||
    (Array.isArray(requiredAspects) && requiredAspects.some(a => ['privacy_policy', 'data_protection', 'personal_data_confidentiality', 'data_sharing', 'third_party_data_sharing'].includes(a))) ||
    /\b(?:kebijakan\s+privasi|melindungi\s+data\s+pribadi|perlindungan\s+data\s+pribadi|kerahasiaan\s+data|data\s+mahasiswa\s+dibagikan)\b/i.test(queryText);

  if (isPrivacyPolicyQuery) {
    const isQualityPolicyDoc = /kebijakan\s+mutu\s+institusi/i.test(candidateText) && !/privasi|perlindungan\s+data/i.test(candidateText);
    const isBemDoc = /profil_bem|badan\s+eksekutif\s+mahasiswa|bem-pm/i.test(candidateText + ' ' + (candidate.filename || ''));
    const isStudentExchangeDoc = /student\s+exchange|gccp|global\s+cross\s+cultural/i.test(candidateText + ' ' + (candidate.filename || ''));
    const isFeeOrPmbDoc = /rincian\s+biaya|brosur|biaya\s+kuliah|gelombang/i.test(candidate.filename || '') && !/privasi/i.test(candidateText);

    if (isQualityPolicyDoc || isBemDoc || isStudentExchangeDoc || isFeeOrPmbDoc) {
      return {
        accepted: false,
        disposition: 'REJECT_ASPECT_MISMATCH',
        reason: 'irrelevant_doc_rejected_for_privacy_policy'
      };
    }

    const hasSubstantivePrivacy = /\b(?:kebijakan\s+privasi|perlindungan\s+data\s+pribadi|kerahasiaan\s+data\s+pribadi|hak\s+privasi|pemrosesan\s+data\s+pribadi)\b/i.test(text);
    if (!hasSubstantivePrivacy) {
      return {
        accepted: false,
        disposition: 'REJECT_ASPECT_MISMATCH',
        reason: 'lacks_substantive_privacy_policy_content'
      };
    }
  }

  // 0.16 RPL (Rekognisi Pembelajaran Lampau) Evidence Gate
  const isRplQuery = retrievalPlan.intent === 'RPL_INQUIRY' ||
    retrievalPlan.intent === 'RPL_PROCEDURE' ||
    retrievalPlan.intent === 'RPL_FORM_PROCEDURE' ||
    retrievalPlan.intent === 'RPL_ADMISSION_STAGES' ||
    retrievalPlan.intent === 'RPL_REQUIREMENTS' ||
    retrievalPlan.intent === 'RPL_ASSESSMENT_CONVERSION' ||
    (Array.isArray(requiredAspects) && requiredAspects.includes('rpl')) ||
    /\b(?:rpl|rekognisi\s+pembelajaran\s+lampau)\b/i.test(queryText);

  if (isRplQuery) {
    const candidateDocName = (candidate && (candidate.filename || candidate.sourceDocument || candidate.sourceFile || '')) || '';
    const isYudisiumChunk = /yudisium|wisuda/i.test(candidateDocName);
    if (isYudisiumChunk) {
      return {
        accepted: false,
        disposition: 'REJECT_ASPECT_MISMATCH',
        reason: 'yudisium_doc_not_applicable_to_rpl'
      };
    }

    const isFeeInquiry = retrievalPlan.domain === 'TUITION_FEE' ||
      retrievalPlan.intent === 'TUITION_FEE_INQUIRY' ||
      (Array.isArray(requiredAspects) && requiredAspects.some(a => ['fee', 'tuition', 'dpp', 'rpl_fee'].includes(a))) ||
      /\b(?:biaya|spp|dpp|uang\s+kuliah|bayar)\b/i.test(queryText);
    const isFeeDoc = (candidate && (candidate.docCategory === 'BIAYA' || candidate.category === 'BIAYA')) ||
      /rincian\s+biaya|brosur|biaya\s+kuliah/i.test(candidateDocName);

    if (!isFeeInquiry) {
      // Reject fee tables for procedural, form, stages, requirements, or assessment inquiries
      if (isFeeDoc) {
        return {
          accepted: false,
          disposition: 'REJECT_ASPECT_MISMATCH',
          reason: 'evidence_is_fee_table_not_rpl_procedure'
        };
      }
    } else {
      // For RPL fee query: chunk MUST specifically mention RPL rates or provisions (e.g. Butir 12)
      const mentionsRplFee = (
        /\b(?:rpl|rekognisi\s+pembelajaran\s+lampau)\b/i.test(candidateText) &&
        /\b(?:3\.000\.000|4\.500\.000|4\.000\.000|dpp|biaya\s+per\s+semester)\b/i.test(candidateText)
      ) || (
          // Direct continuation of Butir 12 containing recognized SKS brackets and DPP amounts
          /\b(?:jumlah\s+)?pengakuan\s+sks\s+antara\b/i.test(candidateText) &&
          /\b(?:4\.500\.000|5\.000\.000|7\.000\.000)\b/i.test(candidateText)
        );
      if (isFeeDoc && !mentionsRplFee) {
        return {
          accepted: false,
          disposition: 'REJECT_ASPECT_MISMATCH',
          reason: 'fee_chunk_does_not_contain_rpl_rates'
        };
      }
    }
  }

  // 0.2 PMB Registration Form Fee vs DPP Discount / Wave Discount Gate
  // INVARIANT: Use the user's direct query intent, NEVER internal query expansion variants,
  // to avoid falsely interpreting scholarship queries as form fee queries.
  const userDirectQuery = (retrievalPlan.rawQuery || retrievalPlan.query || '').toLowerCase();

  // 0.3 Academic Calendar / Event Schedule Gate
  // When user is asking about academic calendar (e.g. Di mana melihat kalender akademik, jadwal perkuliahan, KRS):
  // Reject irrelevant student organizations (UKM/Himpunan), INBIS, fee brochures, and unrelated memos/PMB wave tables.
  const isCalendarQuery = /\bkalender\s+akademik\b/i.test(userDirectQuery) ||
    retrievalPlan.domain === 'ACADEMIC_SCHEDULE' ||
    retrievalPlan.intent === 'ACADEMIC_EVENT_SCHEDULE';
  if (isCalendarQuery) {
    const isPmbAdmissionCalendar = /\bkalender\s+pendaftaran\s+mahasiswa\s+baru\b/i.test(text) ||
      /\bkalender\s+pendaftaran\b/i.test(candidate.filename || candidate.sourceFile || '');
    const isIsolatedMemo = /\btempat\s*:\s*loket\s+akademik\b/i.test(text) && !/kalender\s+akademik/i.test(text);
    const isUkmOrOrmawa = /\b(?:himpunan\s+mahasiswa|ormawa|ukm\b|organisasi\s+mahasiswa)\b/i.test(text) ||
      /\b(?:himpunan|inbis|rincian\s+biaya)\b/i.test(candidate.filename || candidate.sourceFile || '');
    if (isUkmOrOrmawa || isPmbAdmissionCalendar || isIsolatedMemo) {
      return {
        accepted: false,
        disposition: 'REJECT_ASPECT_MISMATCH',
        reason: 'ukm_or_non_calendar_doc_rejected_for_academic_calendar'
      };
    }
  }
  const isAskingFormFee = /\b(?:biaya\s+formulir|biaya\s+pendaftaran|uang\s+pendaftaran|biaya\s+daftar)\b/i.test(userDirectQuery) ||
    retrievalPlan.intent === 'ADMISSION_FORM_FEE' ||
    (Array.isArray(requiredAspects) && requiredAspects.includes('registration_form_fee'));
  if (isAskingFormFee) {
    const isExplicitlyNegatingDpp = /\b(?:tidak\s+(?:perlu|usah)|bukan|tanpa)\b.*?\b(?:dpp|potongan\s+dpp)\b/i.test(userDirectQuery);
    const hasRegistrationFeeContent = /\b(?:potongan\s+biaya\s+pendaftaran|biaya\s+pendaftaran|biaya\s+formulir|membayar\s+formulir|uang\s+pendaftaran)\b/i.test(text);
    const isDppDiscountOnly = !hasRegistrationFeeContent && (
      candidate.aspect === 'potongan_dpp' ||
      /\b(?:potongan\s+dpp|dana\s+pendidikan\s+pokok|beasiswa\s+dpp|registrasi\s+pada\s+gelombang\s+khusus)\b/i.test(text)
    );
    if (isDppDiscountOnly || (isExplicitlyNegatingDpp && !hasRegistrationFeeContent)) {
      return {
        accepted: false,
        disposition: 'REJECT_ASPECT_MISMATCH',
        reason: 'REJECT_ASPECT_MISMATCH'
      };
    }
  }

  // 0.3 Main Campus Address vs Branch / Cost Footer Gate
  const userQueryLower = (retrievalPlan.rawQuery || retrievalPlan.query || '').toLowerCase();
  const isAskingMainCampusLocation = /\b(?:alamat\s+kampus\s+utama|kampus\s+utama|kampus\s+pusat|kampus\s+renon)\b/i.test(userQueryLower);
  if (isAskingMainCampusLocation) {
    const hasMainCampusAddress = /\b(?:puputan|renon)\b/i.test(text) && /\b(?:86|no\.?\s*86|jl\.?\s*raya\s*puputan)\b/i.test(text);
    const isBranchOnlyOrFeeFooter = /\b(?:kampus\s+jimbaran|kampus\s+abiansemal)\b/i.test(text) && !hasMainCampusAddress;
    const isFeeDocument = candidate.canonicalEntity && /rincian biaya/i.test(candidate.canonicalEntity);
    if (!hasMainCampusAddress && (isBranchOnlyOrFeeFooter || isFeeDocument)) {
      return {
        accepted: false,
        disposition: 'REJECT_ASPECT_MISMATCH',
        reason: 'REJECT_ASPECT_MISMATCH'
      };
    }
  }

  // 0.4 Partial Semester SKS vs Total Graduation SKS Gate
  const isAskingTotalGraduationSks = /\b(?:total\s+(?:sks|beban\s+studi)\s+(?:kelulusan|lulus|seluruhnya|keseluruhan)|sks\s+lulus|syarat\s+kelulusan\s+sks)\b/i.test(queryText);
  if (isAskingTotalGraduationSks) {
    const isPartialSemesterOnly = /\b(?:semester\s+i\s*\(18\s*sks\)|semester\s+iv\s*\(20\s*sks\))\b/i.test(text) &&
      !/\b(?:144\s*sks|total\s+kelulusan|semester\s+viii)\b/i.test(text);
    if (isPartialSemesterOnly) {
      return {
        accepted: false,
        disposition: 'REJECT_ASPECT_MISMATCH',
        reason: 'REJECT_ASPECT_MISMATCH'
      };
    }
  }

  // 0.5 Phone Number Query vs Footer Email/Website Gate
  const isAskingPhoneNumber = /\b(?:nomor\s+telepon|no\s+telp|kontak\s+telepon|telepon\s+kampus|nomor\s+telp|nomor\s+hp|no\s+hp|hotline)\b/i.test(queryText);
  if (isAskingPhoneNumber) {
    const hasPhoneNumber = /\b(?:\(?0\d{2,4}\)?[\s.-]?\d{5,8}|08\d{8,11})\b/.test(candidateText);
    const isOnlyEmailOrWeb = /\b(?:email|webslte|website|surat\s+keputusan)\b/i.test(text) && !hasPhoneNumber;
    if (isOnlyEmailOrWeb) {
      return {
        accepted: false,
        disposition: 'REJECT_ASPECT_MISMATCH',
        reason: 'REJECT_ASPECT_MISMATCH: email_web_footer_lacks_phone'
      };
    }
  }

  const candidateFile = (candidate && (candidate.sourceFile || candidate.source_file || candidate.sourceDocument || candidate.filename || candidate.source)) || '';
  const candSourceFile = candidateFile.toLowerCase();
  const candTextLower = text.toLowerCase();
  const isForeignStudentChunk = candSourceFile.includes('mahasiswa asing') ||
    /\b(faq pengurusan mahasiswa asing|izin belajar baru|perpanjangan itas|pengurusan visa e30b|sktt orang asing)\b/i.test(candTextLower);

  // 0.6 P0 Retrieval Safety Gates: SION Troubleshooting, Student Affairs Contact, Tech UKM, and PMB Wave Calendar Header
  const isSionTroubleshootingQuery = (Array.isArray(requiredAspects) && requiredAspects.includes('sion_troubleshooting')) ||
    (/\b(?:sion|portal\s+akademik|portal\s+sion)\b/i.test(userQueryLower) &&
      /\b(?:kendala|masalah|error|gagal|lupa|tidak\s+bisa|bentrok|login|masuk|urus|mengurus|hubungi|menghubungi|siapa|kontak|bagian)\b/i.test(userQueryLower));

  if (isSionTroubleshootingQuery) {
    const isStudentExchangeOrGraduationOrTa =
      /\b(?:student\s+exchange|pertukaran\s+(?:mahasiswa|pelajar)|yudisium|wisuda|tugas\s+akhir|skripsi|kepanitiaan\s+tugas\s+akhir)\b/i.test(candTextLower) ||
      /(?:student\s+exchange|yudisium|wisuda|tugas\s+akhir|pedoman\s+ta)/i.test(candSourceFile);
    const hasExplicitSionTroubleshooting = /\bsion\b/i.test(candTextLower) &&
      /\b(?:kendala\s+sion|lupa\s+password\s+sion|reset\s+password\s+sion|helpdesk\s+sion|mengurus\s+kendala\s+sion|bentrok\s+jadwal\s+di\s+sion)\b/i.test(candTextLower);
    if (isStudentExchangeOrGraduationOrTa || !hasExplicitSionTroubleshooting) {
      return {
        accepted: false,
        disposition: 'REJECT_ASPECT_MISMATCH',
        reason: isStudentExchangeOrGraduationOrTa
          ? 'evidence_is_student_exchange_or_graduation_not_sion_troubleshooting'
          : 'evidence_lacks_sion_troubleshooting_or_contact_procedure'
      };
    }
  }

  const isStudentAffairsContactQuery = (Array.isArray(requiredAspects) && requiredAspects.includes('student_affairs')) ||
    /\b(?:bagian\s+kemahasiswaan|layanan\s+kemahasiswaan|direktorat\s+kemahasiswaan)\b/i.test(userQueryLower);
  if (isStudentAffairsContactQuery && !/\b(?:inbis|inkubator|industri)\b/i.test(userQueryLower)) {
    const isInbisOrIndustryDoc = /(?:inbis|layanan\s+industri|kl-inbis)/i.test(candSourceFile) ||
      /\b(?:klinbis@stikom-bali\.ac\.id|direktorat\s+kerja\s+sama,\s*layanan\s+industri|profil\s+layanan\s+industri|inkubator\s+bisnis)\b/i.test(candTextLower);
    const hasDirKkaSignal = /\b(?:ts_dirkka@stikom-bali\.ac\.id|direktur\s+kemahasiswaan,\s*karir\s+dan\s+alumni|direktorat\s+kemahasiswaan|wakil\s+rektor\s+iii)\b/i.test(candTextLower);
    if (isInbisOrIndustryDoc || !hasDirKkaSignal) {
      return {
        accepted: false,
        disposition: 'REJECT_SCOPE_MISMATCH',
        reason: isInbisOrIndustryDoc
          ? 'inbis_or_industry_contact_not_student_affairs_kka'
          : 'evidence_lacks_student_affairs_kka_contact'
      };
    }
  }

  const isTechUkmQuery = (retrievalPlan.domain === 'ORGANIZATION_UKM' || (Array.isArray(requiredAspects) && requiredAspects.includes('ukm'))) &&
    /\b(?:teknologi|programming|coding|koding|robotik|robot|linux|penalaran)\b/i.test(userQueryLower) &&
    !/\b(?:olahraga|fitness|gym|ghost|seni|tari|musik|futsal|basket)\b/i.test(userQueryLower);
  if (isTechUkmQuery) {
    const isNonTechUkmDoc = /(?:ukm_ghost|ghost|pragina|teater\s+biner|ukm\s+dos|ukm\s+vos|ukm\s+bos|ukm\s+tabuh|futsal|basket|mapala|ksr|kmhd|mcos|jcos|paskamras)/i.test(candSourceFile) ||
      (/\b(?:gymnastic\s+and\s+health|ukm\s+ghost|kebugaran|tari\s+tradisional|paduan\s+suara|pecinta\s+alam)\b/i.test(candTextLower) &&
        !/\b(?:rade|syntax|ksl|teknologi\s+dan\s+penalaran)\b/i.test(candTextLower));
    if (isNonTechUkmDoc) {
      return {
        accepted: false,
        disposition: 'REJECT_ASPECT_MISMATCH',
        reason: 'non_tech_ukm_profile_rejected_for_tech_programming_query'
      };
    }
  }

  // P0 Safety Gate: Kalender Pendaftaran.xlsx table header chunk (b22fd7bc) must ONLY be accepted when asking about schedule/waves,
  // NEVER for technical PMB form issues, KTP/KK requirements, entrance tests, or post-form procedures.
  const isWaveCalendarHeaderOnly = /kalender\s+pendaftaran\.xlsx/i.test(candSourceFile) &&
    /gelombang\s*\|\s*masa\s+pendaftaran\s*\|\s*testing\s*\|\s*pengumuman/i.test(candTextLower);
  if (isWaveCalendarHeaderOnly) {
    const queryAsksScheduleOrWave = retrievalPlan.intent === 'ADMISSION_SCHEDULE' ||
      retrievalPlan.intent === 'CURRENT_ENROLLMENT_STATUS' ||
      (Array.isArray(requiredAspects) && requiredAspects.some(a => ['schedule', 'waves', 'wave_info'].includes(a))) ||
      /\b(?:jadwal|gelombang|kapan\s+(?:buka|tutup|pendaftaran)|periode\s+pendaftaran|batas\s+waktu)\b/i.test(userQueryLower);
    if (!queryAsksScheduleOrWave) {
      return {
        accepted: false,
        disposition: 'REJECT_ASPECT_MISMATCH',
        reason: 'wave_calendar_table_header_not_applicable_to_non_schedule_pmb_query'
      };
    }
  }

  // P0 Safety Gate: Specific PMB Technical / Document / Exam queries must have matching aspect evidence in the chunk,
  // not generic campus profile or unrelated fee tables.
  if (Array.isArray(requiredAspects) && requiredAspects.includes('pmb_technical_or_specific_req')) {
    const asksKtpKk = /\b(?:ktp|kk|kartu\s+keluarga)\b/i.test(userQueryLower);
    const asksEntranceTest = /\b(?:tes\s+masuk|ujian\s+seleksi|seleksi\s+tambahan|tes\s+tulis)\b/i.test(userQueryLower);
    const asksOtpOrFormTech = /\b(?:kode\s+verifikasi|otp|salah\s+mengisi\s+data|ubah\s+pilihan|lupa\s+nomor\s+handphone|belum\s+mendapat\s+konfirmasi|error\s+saat\s+dikirim|formulir.*error|setelah\s+isi\s+formulir|kartu\s+peserta)\b/i.test(userQueryLower);

    if (asksKtpKk && !/\b(?:ktp|kartu\s+tanda\s+penduduk|kk|kartu\s+keluarga)\b/i.test(candTextLower)) {
      return {
        accepted: false,
        disposition: 'REJECT_ASPECT_MISMATCH',
        reason: 'evidence_lacks_ktp_kk_requirement_details'
      };
    }
    if (asksEntranceTest && !/\b(?:tes\s+masuk|ujian\s+masuk|ujian\s+seleksi|seleksi\s+masuk|tanpa\s+tes)\b/i.test(candTextLower)) {
      return {
        accepted: false,
        disposition: 'REJECT_ASPECT_MISMATCH',
        reason: 'evidence_lacks_entrance_test_or_selection_details'
      };
    }
    if (asksOtpOrFormTech && !/\b(?:otp|kode\s+verifikasi|salah\s+mengisi|error|konfirmasi\s+pendaftaran|setelah\s+mengisi\s+formulir|kartu\s+peserta)\b/i.test(candTextLower)) {
      return {
        accepted: false,
        disposition: 'REJECT_ASPECT_MISMATCH',
        reason: 'evidence_lacks_online_form_technical_troubleshooting_details'
      };
    }
  }

  const isRecommendationInquiry = retrievalPlan.domain === 'ACADEMIC_RECOMMENDATION' || retrievalPlan.intent === 'PROGRAM_RECOMMENDATION';

  // 1. Excluded Conflicting Entities Check (Preserve Hard Entity Lock for single-entity inquiries; allow multi-program evidence for recommendations)
  if (!isRecommendationInquiry && Array.isArray(excludedConflictingEntities) && excludedConflictingEntities.length > 0) {
    for (const excluded of excludedConflictingEntities) {
      const exClean = normalizePunctuation(excluded);
      if (cleanText.includes(exClean)) {
        // If candidate is explicitly scoped via contextEntities or section header to the excluded sibling,
        // and does NOT have targetEntity in its contextEntities, REJECT IT immediately!
        const contextHasExcluded = Array.isArray(candidate.contextEntities) &&
          candidate.contextEntities.some(ce => normalizePunctuation(ce) === exClean);
        const contextHasTarget = Array.isArray(candidate.contextEntities) &&
          candidate.contextEntities.some(ce => targetEntities.some(te => normalizePunctuation(ce) === normalizePunctuation(te)));

        if (contextHasExcluded && !contextHasTarget) {
          return {
            accepted: false,
            disposition: 'REJECTED',
            reason: `chunk_context_explicitly_scoped_to_sibling: ${excluded}`
          };
        }

        const headerMatch = (candidateText || '').match(/^\[Program:\s*([^\]]+)\]/i);
        if (headerMatch && normalizePunctuation(headerMatch[1]) === exClean) {
          return {
            accepted: false,
            disposition: 'REJECTED',
            reason: `chunk_header_explicitly_scoped_to_sibling: ${excluded}`
          };
        }

        // Generic cross-program document / sliding window overlap resolution:
        // If the chunk also genuinely matches the target entity, allow it for passage-level isolation
        const hasTarget = Array.isArray(targetEntities) && targetEntities.some(ent => isCandidateMatchingTargetEntity(candidate, ent));
        if (hasTarget) {
          continue; // Chunk legitimately discusses target entity alongside sibling entity
        }

        return {
          accepted: false,
          disposition: 'REJECTED',
          reason: `contains_conflicting_entity: ${excluded}`
        };
      }
    }
  }

  // 1.1 Academic Level & Qualification Strict Gate
  const academicLevel = retrievalPlan.academicLevel ||
    (targetEntities.some(e => /^S2\b|magister/i.test(e)) ? 'S2' :
      (targetEntities.some(e => /^S1\b/i.test(e)) ? 'S1' :
        (targetEntities.some(e => /^D3\b/i.test(e)) ? 'D3' : null)));

  // If candidate has an explicit conflicting academicLevel (e.g. S1 for an S2 query, or S2 for an S1 query), reject it!
  const candLevelRaw = candidate.academicLevel || candidate.level || (candidate.metadata && (candidate.metadata.academicLevel || candidate.metadata.level));
  if (academicLevel && candLevelRaw) {
    const candLvl = String(candLevelRaw).toUpperCase();
    const targetLvl = String(academicLevel).toUpperCase();
    const isMultiLevel = candidate.scope === 'PROGRAM_MULTI' &&
      (candidate.correctedLevel === 'S1_D3' ||
        (Array.isArray(candidate.supportedPrograms) && candidate.supportedPrograms.includes('MI') && ['S1', 'D3'].includes(targetLvl)));
    // Institutional / Student Org / Multi-program / Cross-Level documents (with level ALL or UMUM)
    const isInstOrOrgGeneral = (candLvl === 'UMUM' || candLvl === 'ALL') &&
      (candidate.scope === 'INSTITUTIONAL_OR_ORG' || candidate.scope === 'PROGRAM_MULTI' || candLvl === 'ALL' || /buku ormawa himaprodi|profile hima|isian website|pasca\.stikom-bali\.ac\.id/i.test(candidateFile)) &&
      (
        targetLvl === 'UMUM' ||
        targetLvl === 'ALL' ||
        (targetLvl === 'S1' && (candLvl === 'UMUM' || /\b(?:s1|sarjana)\b/i.test(text))) ||
        (targetLvl === 'D3' && /\b(?:d3|diploma|manajemen\s+informatika|men[\s\n]+informatika|\(d3\))\b/i.test(text)) ||
        (targetLvl === 'S2' && /\b(?:magister|pascasarjana|s2)\b/i.test(text)) ||
        (retrievalPlan?.domain === 'PMB' && /tahun\s+akademik|penerimaan\s+mahasiswa\s+baru/i.test(text)) ||
        retrievalPlan?.intent === 'FACULTY_INQUIRY' ||
        retrievalPlan?.retrievalScopeMode === 'PRODI_FACULTY_MEMBERSHIP'
      );
    if (candLvl !== targetLvl && !isMultiLevel && !isInstOrOrgGeneral) {
      return {
        accepted: false,
        disposition: 'REJECT_ACADEMIC_LEVEL_MISMATCH',
        reason: `candidate_level_${candLvl}_conflicts_with_target_${targetLvl}`
      };
    }
  }

  if (academicLevel === 'S2') {
    // S2 queries require Bachelor (S1/D4) or graduate context; strictly reject high school (SMA/SMK) requirements
    const isSmaSmkRequirements = /\b(?:lulusan\s+sma|ijazah\s+sma|sma\/smk|smk\/sma|paket\s+c)\b/i.test(text) &&
      !/\b(?:ijazah\s+(?:s1|d4|sarjana)|sarjana\s+komputer|lulusan\s+s1)\b/i.test(text);
    if (isSmaSmkRequirements) {
      return {
        accepted: false,
        disposition: 'REJECT_ACADEMIC_LEVEL_MISMATCH',
        reason: 'evidence_for_sma_smk_not_s2'
      };
    }
    // S2 queries strictly reject D3 diploma program candidates
    const candProg = candidate ? (candidate.program || candidate.canonicalEntity || '') : '';
    if (String(candProg).toUpperCase() === 'MI' || String(candProg).toUpperCase() === 'D3' || candidate.academicLevel === 'D3') {
      return {
        accepted: false,
        disposition: 'REJECT_ACADEMIC_LEVEL_MISMATCH',
        reason: 'candidate_level_D3_conflicts_with_target_S2'
      };
    }
  }

  // 1.2 Candidate Metadata Single-Program Scope Isolation Gate
  const candRawProg = candidate ? (candidate.program || candidate.canonicalEntity || '') : '';
  let candProgCode = candidate?.scope === 'PROGRAM_SINGLE'
    ? (candidate.program ? String(candidate.program).toUpperCase() : null)
    : (getProgramCodeFromEntity(candRawProg) || (candidate?.id?.match(/^curr-([a-z0-9]+)/i) ? candidate.id.match(/^curr-([a-z0-9]+)/i)[1].toUpperCase() : null));

  const hasUndergradInCandidate = /\b(?:s1|sarjana|d3|diploma)\b/i.test(candidateText);
  const isCrossLevelInstitutionalChunk = ['ALL', 'UMUM'].includes(String(candLevelRaw || '').toUpperCase()) ||
    ['INSTITUTIONAL_OR_ORG', 'PROGRAM_MULTI'].includes(candidate?.scope);

  const isCandidateS2 = candidate?.academicLevel === 'S2' || candidate?.level === 'S2' ||
    (/(?:pascasarjana|magister)/i.test(candidate?.source_file || candidate?.filename || candidate?.sourceDocument || '') && !isCrossLevelInstitutionalChunk && !hasUndergradInCandidate) ||
    (/\b(?:program pascasarjana|magister sistem informasi|s2 sistem informasi)\b/i.test(candidateText) && !hasUndergradInCandidate && !isCrossLevelInstitutionalChunk);
  if (isCandidateS2 && (candProgCode === 'SI' || candRawProg === 'SI' || !candProgCode)) {
    candProgCode = 'S2';
  }

  const querySpecificallyAsksS2 = academicLevel === 'S2' ||
    /\b(?:s2|pascasarjana|magister)\b/i.test(queryText) ||
    /\b(?:s2|pascasarjana|magister)\b/i.test(userQueryLower);

  if (isCandidateS2 && !querySpecificallyAsksS2) {
    return {
      accepted: false,
      disposition: 'REJECT_ACADEMIC_LEVEL_MISMATCH',
      reason: 'candidate_level_S2_conflicts_with_general_or_undergraduate_query'
    };
  }

  if (Array.isArray(targetEntities) && targetEntities.length > 0 && candProgCode) {
    const targetCodes = targetEntities.map(te => getProgramCodeFromEntity(te)).filter(Boolean);
    const contextCodes = Array.isArray(candidate?.contextEntities)
      ? candidate.contextEntities.map(ce => getProgramCodeFromEntity(ce)).filter(Boolean)
      : [];
    const matchesContext = targetCodes.some(tc => contextCodes.includes(tc));
    if (!matchesContext && targetCodes.length > 0 && !targetCodes.includes(candProgCode)) {
      return {
        accepted: false,
        disposition: 'REJECT_SCOPE_COLLISION',
        reason: `candidate_scoped_to_program_${candProgCode}_not_${targetCodes.join('_')}`
      };
    }
  }

  // 1.3 Candidate Metadata Multi-Program Scope Isolation Gate
  if (candidate && candidate.scope === 'PROGRAM_MULTI') {
    const supportedPrograms = Array.isArray(candidate.supportedPrograms)
      ? candidate.supportedPrograms.map(p => String(p).toUpperCase())
      : (candidate.program === 'MULTI' ? ['SI', 'TI', 'BD'] : []);
    if (Array.isArray(targetEntities) && targetEntities.length > 0 && supportedPrograms.length > 0) {
      const targetCodes = targetEntities.map(te => getProgramCodeFromEntity(te)).filter(Boolean);
      if (targetCodes.length > 0 && !targetCodes.some(tc => supportedPrograms.includes(tc))) {
        return {
          accepted: false,
          disposition: 'REJECT_SCOPE_COLLISION',
          reason: `candidate_multi_scope_supports_${supportedPrograms.join('_')}_not_${targetCodes.join('_')}`
        };
      }
    }
  }

  // 1.4 Thesis / Skripsi inquiry guard: Academic calendar chunks must NEVER be accepted as thesis guidelines
  const isAskingThesisDirectly = /\b(?:tugas\s+akhir|skripsi|pedoman\s+ta|bimbingan\s+ta|sidang\s+ta|ujian\s+proposal)\b/i.test(queryText);
  if (isAskingThesisDirectly) {
    const isAcademicCalendar = (candidateFile && /kalender\s+akademik/i.test(candidateFile)) ||
      /\b(kalender\s+akademik|ssrkjsm|kuliah\s+pertemuan\s+(?:ke-)?\d+|polling\s+mata\s+kuliah)\b/i.test(text);
    if (isAcademicCalendar) {
      return {
        accepted: false,
        disposition: 'REJECT_ASPECT_MISMATCH',
        reason: 'evidence_is_academic_calendar_not_thesis_guideline'
      };
    }

    const queryMentionsD3 = /\b(?:d3|diploma|manajemen\s+informatika|mi)\b/i.test(queryText);
    const candIsD3 = candidate.academicLevel === 'D3' || candidate.program === 'MI' || (candidateFile && /curr-mi/i.test(candidateFile));
    if (!queryMentionsD3 && candIsD3) {
      return {
        accepted: false,
        disposition: 'REJECT_SCOPE_MISMATCH',
        reason: 'evidence_is_d3_curriculum_not_s1_thesis_guideline'
      };
    }
  }

  // 1.5 Academic Level Isolation Gate: Conflicting non-Umum/non-ALL academic levels must be REJECTED
  const planLevel = retrievalPlan.academicLevel || retrievalPlan.targetLevel;
  if (planLevel && !['UMUM', 'ALL'].includes(String(planLevel).toUpperCase())) {
    const candLevel = candidate.academicLevel || candidate.level;
    const candLevelUpper = candLevel ? String(candLevel).toUpperCase() : null;
    if (candLevelUpper && !['UMUM', 'ALL'].includes(candLevelUpper) && candLevelUpper !== String(planLevel).toUpperCase()) {
      return {
        accepted: false,
        disposition: 'REJECT_SCOPE_MISMATCH',
        reason: `candidate_level_${candLevel}_conflicts_with_target_level_${planLevel}`
      };
    }
  }

  // 2. Target Entity & Scope Compatibility Check
  const supportedEntities = [];
  if (Array.isArray(targetEntities) && targetEntities.length > 0) {
    for (const ent of targetEntities) {
      if (isCandidateMatchingTargetEntity(candidate, ent)) {
        supportedEntities.push(ent);
      }
    }
  }

  if (!isRecommendationInquiry && Array.isArray(targetEntities) && targetEntities.length > 0) {
    const MODIFIER_FAMILIES = new Set(['admission_track', 'participant_scope', 'academic_scope', 'study_mode']);
    const primaryTargets = [];
    const modifierFamilyMap = new Map();

    for (const ent of targetEntities) {
      const canonicalEntry = findCanonicalEntity(ent);
      const fam = canonicalEntry ? canonicalEntry.family : 'default';
      if (MODIFIER_FAMILIES.has(fam)) {
        if (!modifierFamilyMap.has(fam)) modifierFamilyMap.set(fam, []);
        modifierFamilyMap.get(fam).push(ent);
      } else if (
        canonicalEntry?.canonical === 'Kampus ITB STIKOM Bali' &&
        retrievalPlan.intent !== 'CAMPUS_LOCATION' &&
        retrievalPlan.domain !== 'FACILITIES'
      ) {
        // Parent institution reference ("di kampus ITB STIKOM Bali") is an institutional scope,
        // NOT a physical branch restriction that filters out institutional fee/scholarship/PMB chunks!
        continue;
      } else {
        primaryTargets.push({ ent, fam });
      }
    }

    // 2a. Any modifier family (e.g., admission_track, participant_scope, academic_scope) must be satisfied
    for (const [modFam, modEnts] of modifierFamilyMap.entries()) {
      if (modFam === 'academic_scope' && (retrievalPlan.participantScope === 'foreign' || isForeignStudentChunk)) {
        // Foreign student immigration & admission guidelines apply campus-wide unless conflicting with specific degree levels
        continue;
      }
      const hasModifierMatch = modEnts.some(ent => supportedEntities.includes(ent));
      if (!hasModifierMatch) {
        return {
          accepted: false,
          disposition: 'REJECT_ENTITY_MISMATCH',
          reason: `evidence_does_not_contain_target_entity_in_family: ${modFam}`
        };
      }
    }

    // 2b. Primary entities:
    // Whether multiple primary entities belong to the same family or across different families,
    // a candidate chunk is valid if it supports at least one target primary entity (or if it is an official
    // general PMB registration procedure chunk accompanying a special/international program procedure inquiry).
    if (primaryTargets.length > 0) {
      const matchedPrimary = primaryTargets.filter(pt => supportedEntities.includes(pt.ent));
      if (matchedPrimary.length === 0) {
        const isSpecialOrIntlProgramTarget = primaryTargets.some(pt =>
          ['international_program', 'double_degree'].includes(pt.fam) ||
          /\b(?:dual\s+degree|double\s+degree|utb|help|dnui|student\s+exchange)\b/i.test(pt.ent)
        );
        const isAcademicProgramTarget = primaryTargets.some(pt =>
          ['academic_program'].includes(pt.fam) ||
          /\b(?:bisnis\s+digital|sistem\s+informasi|teknologi\s+informasi|sistem\s+komputer|manajemen\s+informatika)\b/i.test(pt.ent)
        );
        const wantsProcedureOrReq = retrievalPlan.intent === 'PROGRAM_PROCEDURE' ||
          retrievalPlan.intent === 'ADMISSION_PROCEDURE' ||
          retrievalPlan.intent === 'ADMISSION_REQUIREMENTS' ||
          (Array.isArray(requiredAspects) && requiredAspects.some(a => ['procedure', 'requirements', 'admission_overview', 'admission_pathways'].includes(a)));
        const wantsScheduleOrMulti = (Array.isArray(requiredAspects) && requiredAspects.some(a => ['schedule', 'waves', 'jadwal', 'documents'].includes(a))) ||
          retrievalPlan.intent === 'ADMISSION_SCHEDULE';
        const isCalendarDoc = candidate.category === 'JADWAL' || (candidateFile && /kalender\s+pendaftaran/i.test(candidateFile));
        const isGeneralPmbCalendarCompanion = isAcademicProgramTarget && wantsScheduleOrMulti && isCalendarDoc;
        const isGeneralPmbProcedureCompanion = (isSpecialOrIntlProgramTarget || (isAcademicProgramTarget && (wantsProcedureOrReq || wantsScheduleOrMulti))) &&
          candidate.docCategory !== 'BIAYA' &&
          !(candidateFile && /rincian biaya/i.test(candidateFile)) &&
          !/\b(pendidikan per semester|uang pangkal|potongan dpp|rincian biaya)\b/i.test(text) &&
          (/\b(pmb|pendaftaran\s+mahasiswa\s+baru|alur\s+pendaftaran|prosedur\s+pendaftaran|cara\s+(?:daftar|mendaftar)|syarat\s+pendaftaran|pmb\.stikom-bali\.ac\.id)\b/i.test(text) || isGeneralPmbCalendarCompanion);

        if (!isGeneralPmbProcedureCompanion && !isGeneralPmbCalendarCompanion) {
          const missingFam = primaryTargets[0].fam;
          return {
            accepted: false,
            disposition: 'REJECT_ENTITY_MISMATCH',
            reason: `evidence_does_not_contain_target_entity_in_family: ${missingFam}`
          };
        }
      }
    }
  }

  // 2.1 Administrative HR / Job Analysis & Government Reporting Form Noise Gate
  const isInternalAdministrativeTemplate =
    /\b(?:analisis jabatan|analisis beban kerja|form(?:ulir)?\s+iku|iku\s+pts|iku\s+perguruan\s+tinggi|indikator\s+kinerja\s+perguruan\s+tinggi)\b/i.test(candidateFile) ||
    /\b(?:\(isikan nama sekretaris prodi\)|\(isikan nama staf\)|\(isikan nama\)|formulir data indikator kinerja|nama badan penyelenggara\s*:)\b/i.test(candidateText);
  if (isInternalAdministrativeTemplate) {
    return {
      accepted: false,
      disposition: 'REJECTED',
      reason: 'evidence_is_internal_administrative_template'
    };
  }

  // 3. Aspect Compatibility & Ownership Check
  // candTextLower defined above
  const providedAspects = [];
  const isCalendarCandidate = candidate.category === 'JADWAL' || (candidateFile && /kalender\s+pendaftaran/i.test(candidateFile));
  const isFeeChunk = candidate.docCategory === 'BIAYA' ||
    (candidateFile && /rincian biaya/i.test(candidateFile)) ||
    /\b(biaya|tarif|sewa|pendidikan per semester|dpp|spp|uang pangkal|waktu pembayaran|pendaftaran \d|dicicil|potongan biaya|angsuran)\b/i.test(text);

  const isCurriculumChunk = /\b(kurikulum|mata\s*kuliah|matkul|sks|semester\s+[ivx\d]+|praktikum)\b/i.test(text) &&
    !(candidateFile && /kalender\s+akademik/i.test(candidateFile));
  const isOverviewChunk = /\b(deskripsi singkat|profil|fokus pada|fokus pendidikan|keahlian dalam bidang|visi|misi|program studi terlihat|penjelasan prodi|yang dipelajari|perbedaan)\b/i.test(text);
  const isCareerChunk = /\b(peluang kerja|prospek karir|prospek karier|profesi lulusan|career center|magang|internship|cdc|berkarier sebagai)\b/i.test(text) ||
    (candidateFile && /(?:company-profile-cdc|penjelasan prodi dan karier|faq cc)/i.test(candidateFile));
  const isInbisChunk = /\b(inkubator\s+bisnis|inbis|p2mw|tenant|startup|kewirausahaan|pra-?inkubasi|pasca-?inkubasi)\b/i.test(text) ||
    (candidateFile && /(?:Profil INBIS|INBIS PROFILE|inbis|inkubator)/i.test(candidateFile));
  const isScholarshipChunk = /\b(beasiswa|kip-?kuliah|potongan\s+dpp|keringanan\s+biaya|bantuan\s+dana|skss)\b/i.test(text);
  const isFacilityChunk = /\b(laboratorium|lab\b|perpustakaan|asrama|dormitory|sarana\s+dan\s+prasarana|ruang\s+kelas|gedung\s+kampus)\b/i.test(text) ||
    (/\bfasilitas\b/i.test(text) && !/kurikulum|keunggulan\s+program|visi|misi/i.test(text));
  const isOrganizationChunk = /\b(ukm\b|unit\s+kegiatan\s+mahasiswa|organisasi\s+mahasiswa|ormawa|hima\b|himaprodi|senat|balma|ekstrakurikuler)\b/i.test(text);
  const isPmbGeneralChunk = !isCalendarCandidate && /\b(pmb|pendaftaran\s+mahasiswa\s+baru|jalur\s+pendaftaran|syarat\s+pendaftaran|persyaratan(?:\s+pendaftaran)?|syarat\s+masuk|persyaratan\s+masuk|dokumen\s+pendaftaran|berkas\s+pendaftaran|pmb\.stikom-bali\.ac\.id)\b/i.test(text);
  const isHobbyChunk = /\b(hobi\s*\/\s*aktivitas|aktivitas\s*:\s*bermain game|hobi\s*:)\b/i.test(text);
  const isProgramListChunk = /\b(program\s+studi|program\s+sarjana|jenjang|s1|d3|s2|pilihan\s+program)\b/i.test(text);
  const isStudyModeChunk = /\b(kelas\s+karyawan|kelas\s+sore|kelas\s+reguler|pilihan\s+kelas|kuliah\s+sambil\s+kerja|sambil\s+bekerja|jadwal\s+kuliah|fleksibel|bekerja)\b/i.test(text);
  const isDegreeChunk = /\b(gelar|sarjana\s+komputer|sarjana\s+bisnis|s\.kom|s\.bns|m\.kom|a\.md\.kom)\b/i.test(text);
  const isEsportsChunk = /\b(esport|esports|e-sports|athena|gaming|game)\b/i.test(text);
  const isSportsChunk = /\b(olahraga|futsal|basket|bulutangkis|badminton|fitness|gym)\b/i.test(text);

  const isContactChunk = /\b(hotline|kontak|telepon|telp|whatsapp|wa|email|humas|08\d{8,}|\+62|0361|call\s*center)\b/i.test(text);
  const isLocationChunk = candidate.docCategory === 'LOKASI' ||
    candidate.category === 'LOKASI' ||
    (candidate.metadata && (candidate.metadata.docCategory === 'LOKASI' || candidate.metadata.category === 'LOKASI')) ||
    /\b(lokasi\s+kampus|alamat\s+kampus|kampus\s+renon|kampus\s+jimbaran|kampus\s+abiansemal|jl\.\s*raya\s+puputan|jl\.\s*raya\s+kampus\s+udayana)\b/i.test(text);
  const isStudyLocationChunk = /\b(?:ditempuh|tahun\s+di\s+(?:bali|stikom|china|cina|malaysia|bandung)|dalian|help\s+university|utb|universitas\s+teknologi\s+bandung|full\s+di\s+stikom|skema\s+perkuliahan)\b/i.test(text);
  const isScheduleChunk = /\b(gelombang|jadwal|kalender\s+pendaftaran|periode|tahap\s+\d|waktu\s+pendaftaran)\b/i.test(text);
  const isPaymentProcedureChunk = /\b(konfirmasi\s+pembayaran|bukti\s+bayar|transfer|tata\s+cara\s+pembayaran|rekening|waktu\s+pembayaran)\b/i.test(text);
  const isAccreditationChunk = /\b(akreditasi|terakreditasi|ban-?pt|lam-?infokom|peringkat\s+akreditasi|sk\s+akreditasi|\/sk\/ban-pt\/|\/sk\/lam-infokom\/|terakreditasi\s+(?:baik|unggul|a|b))\b/i.test(text);

  const isPureCareerChunk = isCareerChunk && !isCurriculumChunk;
  if (isFeeChunk) providedAspects.push('fee', 'tuition', 'dpp', 'components');
  if (isCurriculumChunk) providedAspects.push('curriculum', 'courses', 'competencies');
  if (isOverviewChunk) providedAspects.push('overview', 'definition', 'curriculum_difference', 'curriculum', 'competencies');
  if (isOverviewChunk && !isPureCareerChunk) providedAspects.push('courses');
  if (isCareerChunk) providedAspects.push('career_prospects', 'career');
  if (isCurriculumChunk || isOverviewChunk || isHobbyChunk || isCareerChunk) {
    providedAspects.push('recommendation', 'program_fit');
  }
  if (isContactChunk) providedAspects.push('contact');
  if (isLocationChunk) {
    providedAspects.push('location', 'campus_location', 'address');
    if (/\b(?:renon|puputan)\b/i.test(candTextLower)) providedAspects.push('branch_renon');
    if (/\b(?:jimbaran|udayana)\b/i.test(candTextLower)) providedAspects.push('branch_jimbaran');
    if (/\b(?:abiansemal|janger|dauh\s+yeh\s+cani)\b/i.test(candTextLower)) providedAspects.push('branch_abiansemal');
  }
  if (isStudyLocationChunk) providedAspects.push('study_location', 'location');
  if (isScheduleChunk) providedAspects.push('schedule', 'waves', 'wave_info', 'stages');
  if (isPaymentProcedureChunk) providedAspects.push('procedure', 'payment_procedure');
  if (isScholarshipChunk) providedAspects.push('scholarship', 'discount', 'requirements');
  if (isFacilityChunk) providedAspects.push('facilities', 'lab', 'campus_infrastructure', 'campus_service', 'service_info', 'support');
  if (isInbisChunk) {
    providedAspects.push('inbis_overview', 'tenant_programs', 'p2mw', 'inbis_services', 'incubation_programs', 'campus_service', 'service_info', 'entrepreneurship');
  }
  if (/\b(?:program\s+pengembangan\s+soft\s*skills?|language\s+learning\s+center|\bllc\b|career\s+center|pusat\s+karier|cdc)\b/i.test(candTextLower)) {
    providedAspects.push('facilities', 'campus_service', 'activities', 'student_development', 'service_info', 'support');
  }
  if (/\b(?:wisuda|yudisium)\b/i.test(candTextLower)) {
    providedAspects.push('procedure', 'requirements', 'event_info', 'graduation', 'schedule');
  }
  if (isOrganizationChunk) providedAspects.push('student_organization', 'organization', 'general_organization', 'activities', 'ukm');
  if (isPmbGeneralChunk) providedAspects.push('admission_overview', 'procedure', 'admission_pathways', 'requirements', 'documents', 'status', 'admission_status', 'academic_year');
  if (isProgramListChunk) providedAspects.push('program_list', 'degrees');
  if (isStudyModeChunk) providedAspects.push('class_schedule', 'working_students', 'evening_class');
  if (isDegreeChunk) providedAspects.push('degree_award');
  if (isEsportsChunk) providedAspects.push('esports_gaming');
  if (isSportsChunk) providedAspects.push('sports');
  if (isAccreditationChunk) providedAspects.push('akreditasi', 'peringkat', 'sk_akreditasi', 'accreditation');
  const isFacultyChunk = /\b(fakultas|informatika\s+dan\s+komputer|bisnis\s+dan\s+vokasi|\bfik\b|\bfbv\b|infokom|bisvo)\b/i.test(text);
  if (isFacultyChunk) providedAspects.push('faculty', 'academic_structure', 'faculty_mapping');
  const isThesisChunk = (candidateFile && /(?:pedoman\s+ta|pedoman\s+skripsi)/i.test(candidateFile)) ||
    /\b(pedoman\s+tugas\s+akhir|persyaratan\s+akademik|141\s+sks|tugas\s+akhir|bimbingan\s+tugas\s+akhir)\b/i.test(candTextLower);
  if (isThesisChunk) providedAspects.push('thesis_requirements', 'academic_requirements', 'guidelines', 'pedoman_ta', 'thesis_stages', 'guidance_procedure');

  if (Array.isArray(candidate.providedAspects)) {
    for (const pa of candidate.providedAspects) {
      if (pa && !providedAspects.includes(pa)) providedAspects.push(pa);
    }
  }

  // Program Overview / Definition / Catalog: Guard against administrative signature blocks, thesis guide kaprodi lines, or pure institutional history
  if (retrievalPlan.intent === 'PROGRAM_OVERVIEW' || retrievalPlan.intent === 'DEFINITION' || retrievalPlan.intent === 'AVAILABLE_PROGRAMS_LIST') {
    const isAdministrativeSignature = /^(?:Ketua Program Studi|Para Ketua Program Studi|Acc Kaprodi|Dosen Pembimbing)\s*[A-Z0-9\-\s\.]*$/i.test(candidateText.trim()) ||
      (candidateText.length < 80 && /Ketua Program Studi/i.test(candidateText));
    if (isAdministrativeSignature) {
      return {
        accepted: false,
        disposition: 'REJECT_ASPECT_MISMATCH',
        reason: 'evidence_is_administrative_signature_not_overview'
      };
    }
    const isInstitutionalHistory = (/(?:1\.\s*Sejarah Singkat Institusi|Bagian:\s*Sejarah Kami)/i.test(candidateText) && !candidateText.includes('Fokus Pendidikan')) ||
      (retrievalPlan.intent === 'AVAILABLE_PROGRAMS_LIST' && /Sejarah Kami - Penguatan Akademik/i.test(candidateText));
    if (isInstitutionalHistory) {
      return {
        accepted: false,
        disposition: 'REJECT_ASPECT_MISMATCH',
        reason: 'evidence_is_institutional_history_not_program_overview'
      };
    }
    const isPureFeeDocument = (candidateFile && /rincian biaya/i.test(candidateFile)) && !isOverviewChunk;
    if (isPureFeeDocument) {
      return {
        accepted: false,
        disposition: 'REJECT_ASPECT_MISMATCH',
        reason: 'evidence_from_fee_doc_lacks_overview'
      };
    }
  }

  // Foreign Student FAQ Scope Guard:
  // Chunks from "FAQ PENGURUSAN MAHASISWA ASING" (visa, ITAS, izin belajar WNA) must NOT be accepted for general domestic inquiries
  // isForeignStudentChunk already declared above
  const querySpecificallyAsksForeign = retrievalPlan.participantScope === 'foreign' ||
    Boolean(retrievalPlan.queryVariants && retrievalPlan.queryVariants.some(q => /\b(mahasiswa\s+asing|warga\s+negara\s+asing|wna|orang\s+asing|foreign\s+students?|international\s+students?|mahasiswa\s+internasional|kui|kantor\s+urusan\s+internasional|visa|itas|kitas|izin\s+belajar|e-?visa)\b/i.test(q)));

  const isPersonalTravelInquiry = Boolean(retrievalPlan.queryVariants && retrievalPlan.queryVariants.some(q => /\b(?:liburan|wisata|jalan-?jalan|pribadi|turis|holiday|vacation)\b/i.test(q)));

  if (isForeignStudentChunk && isPersonalTravelInquiry) {
    return {
      accepted: false,
      disposition: 'REJECT_SCOPE_MISMATCH',
      reason: 'foreign_student_immigration_faq_not_applicable_to_personal_travel'
    };
  }

  if (isForeignStudentChunk && !querySpecificallyAsksForeign) {
    return {
      accepted: false,
      disposition: 'REJECT_SCOPE_MISMATCH',
      reason: 'foreign_student_immigration_faq_not_applicable_to_general_inquiry'
    };
  }

  // PMB domain guard: exclude thesis, yudisium, wisuda, and proposal defense chunks from PMB admission questions
  if (retrievalPlan.domain === 'PMB' && !querySpecificallyAsksForeign && !isAskingThesisDirectly && !['GRADUATION_REQUIREMENTS', 'THESIS_GUIDANCE_PROCEDURE'].includes(retrievalPlan.intent)) {
    const isThesisOrGraduation = /\b(yudisium|wisuda|tugas\s+akhir|sidang\s+ta|ujian\s+proposal)\b/i.test(text) ||
      (candidateFile && /(?:yudisium|wisuda|pedoman\s+ta)/i.test(candidateFile));
    if (isThesisOrGraduation) {
      return {
        accepted: false,
        disposition: 'REJECT_ASPECT_MISMATCH',
        reason: 'evidence_is_thesis_or_graduation_not_admission'
      };
    }

    // Audience Lifecycle Compatibility Gate: exclude enrolled student operational calendar chunks from prospective new student PMB admission
    const isEnrolledAcademicCalendar = (candidateFile && /kalender\s+akademik/i.test(candidateFile)) ||
      /\b(pendaftaran\s+remedial|remedial\s+smt|remedial\s+semester|minggu\s+tenang|kuliah\s+perdana|krs\s+online)\b/i.test(text);
    if (isEnrolledAcademicCalendar) {
      return {
        accepted: false,
        disposition: 'REJECT_LIFECYCLE_MISMATCH',
        reason: 'enrolled_student_academic_calendar_not_applicable_to_pmb_admissions'
      };
    }

    const isStudentExchange = (candidateFile && /student\s+exchange/i.test(candidateFile)) ||
      /\b(?:student\s+exchange|gccp|global\s+cross\s+cultural)\b/i.test(text);
    const queryAsksExchange = /\b(?:student\s+exchange|pertukaran\s+mahasiswa|gccp)\b/i.test(queryText);
    if (isStudentExchange && !queryAsksExchange) {
      return {
        accepted: false,
        disposition: 'REJECT_DOMAIN_MISMATCH',
        reason: 'student_exchange_not_applicable_to_pmb_new_student_admission'
      };
    }
  }

  // Strict aspect matching against retrievalPlan.requiredAspects
  const isComparisonPlan = retrievalPlan.intent === 'PROGRAM_COMPARISON' ||
    (Array.isArray(requiredAspects) && requiredAspects.includes('curriculum_difference'));

  if (!isComparisonPlan && Array.isArray(requiredAspects) && requiredAspects.length > 0 && !requiredAspects.includes('general')) {
    const DISTINCT_ATTRIBUTE_BUCKETS = [
      ['fee', 'tuition', 'dpp'],
      ['accreditation', 'akreditasi', 'peringkat', 'sk_akreditasi'],
      ['curriculum', 'courses'],
      ['faculty', 'academic_structure', 'faculty_mapping'],
      ['degree_award'],
      ['career', 'career_prospects', 'prospek_karir'],
      ['scholarship', 'discount'],
      ['location', 'campus_location', 'address', 'study_location'],
      ['contact', 'helpdesk'],
      ['facilities', 'lab', 'campus_infrastructure'],
      ['student_organization', 'ukm', 'organization'],
      ['schedule', 'waves', 'wave_info'],
      ['procedure', 'admission_overview', 'admission_pathways', 'requirements']
    ];
    const requestedBuckets = DISTINCT_ATTRIBUTE_BUCKETS.filter(bucket =>
      requiredAspects.some(req => bucket.includes(req)) ||
      (Array.isArray(retrievalPlan.requestedAttributes) && retrievalPlan.requestedAttributes.some(req => bucket.includes(req)))
    );
    const isMultiAttributeRequest = requestedBuckets.length > 1;
    const candidateSatisfiesSecondaryBucket = isMultiAttributeRequest && requestedBuckets.some(bucket =>
      providedAspects.some(pa => bucket.includes(pa))
    );

    const wantsLocation = requiredAspects.some(a => ['location', 'campus_location', 'address'].includes(a)) || retrievalPlan.intent === 'CAMPUS_LOCATION';
    const wantsContact = !wantsLocation && (requiredAspects.some(a => ['contact', 'helpdesk'].includes(a)) || retrievalPlan.intent === 'PMB_CONTACT_INQUIRY');
    const wantsSchedule = requiredAspects.some(a => ['schedule', 'wave_info'].includes(a)) || retrievalPlan.intent === 'ADMISSION_SCHEDULE';
    const wantsFee = requiredAspects.some(a => ['fee', 'tuition', 'dpp'].includes(a)) || retrievalPlan.domain === 'TUITION_FEE';
    const wantsCareer = requiredAspects.some(a => ['career', 'career_prospects', 'prospek_karir'].includes(a)) || retrievalPlan.intent === 'CAREER_PROSPECTS_INQUIRY';
    const wantsCurriculum = !wantsCareer && (requiredAspects.some(a => ['curriculum', 'courses'].includes(a)) || retrievalPlan.domain === 'ACADEMIC_CURRICULUM');
    const wantsFaculty = requiredAspects.some(a => ['faculty', 'academic_structure', 'faculty_mapping'].includes(a)) || retrievalPlan.intent === 'FACULTY_INQUIRY';
    const wantsOverview = requiredAspects.some(a => ['overview', 'definition', 'curriculum_difference'].includes(a));
    const wantsScholarship = requiredAspects.some(a => ['scholarship', 'discount'].includes(a)) || retrievalPlan.domain === 'SCHOLARSHIP';
    const wantsFacilities = !wantsLocation && (requiredAspects.some(a => ['facilities', 'lab'].includes(a)) || retrievalPlan.domain === 'FACILITIES');
    const wantsInbis = (Array.isArray(requiredAspects) && requiredAspects.some(a => ['inbis_overview', 'tenant_programs', 'p2mw', 'inbis_services', 'incubation_programs'].includes(a))) ||
      retrievalPlan.relation === 'INBIS_SERVICE' ||
      /\b(?:inbis|inkubator\s+bisnis|p2mw|tenant|startup|kewirausahaan|wirausaha\s+(?:pemula|mahasiswa)|inkubasi)\b/i.test(retrievalPlan.rawQuery || retrievalPlan.query || '') ||
      (Array.isArray(retrievalPlan.targetEntities) && retrievalPlan.targetEntities.some(e => /inbis|inkubator/i.test(e)));
    const wantsOrg = requiredAspects.some(a => ['student_organization', 'ukm'].includes(a)) || retrievalPlan.domain === 'ORGANIZATION_UKM';
    const wantsPmbGeneral = requiredAspects.some(a => ['admission_overview', 'procedure', 'admission_pathways'].includes(a)) ||
      retrievalPlan.intent === 'PROGRAM_PROCEDURE' ||
      (retrievalPlan.domain === 'PMB' && (retrievalPlan.intent === 'GENERAL_PMB_INQUIRY' || retrievalPlan.intent === 'ADMISSION_PROCEDURE'));

    const isStudyLocationInquiry = retrievalPlan.intent === 'STUDY_LOCATION' || requiredAspects.includes('study_location');
    if (wantsLocation) {
      const hasExplicitAddressOrLocSignal = candidate.docCategory === 'LOKASI' ||
        candidate.category === 'LOKASI' ||
        (candidate.metadata && (candidate.metadata.docCategory === 'LOKASI' || candidate.metadata.category === 'LOKASI')) ||
        /\b(lokasi|alamat|berlokasi|beralamat|terletak|jl\.|jalan|puputan|udayana|dauh\s+yeh\s+cani)\b/i.test(text);
      if (((!isLocationChunk && !(isStudyLocationInquiry && isStudyLocationChunk)) || (isCurriculumChunk && !hasExplicitAddressOrLocSignal)) && !candidateSatisfiesSecondaryBucket) {
        return {
          accepted: false,
          disposition: 'REJECT_ASPECT_MISMATCH',
          reason: 'evidence_does_not_contain_location_aspect'
        };
      }
    } else if (wantsContact) {
      const hasContactSignal = /\b(whatsapp|wa|telepon|telp|call\s*center|email|kontak|08\d{8,}|\+62|0361|pmb\.stikom-bali\.ac\.id)\b/i.test(text);
      const hasExplicitPhoneOrContact = /\b(telepon|telp|hotline|\(0361\)|08\d{8,}|info@stikom-bali\.ac\.id)\b/i.test(text);
      if ((!hasContactSignal || isHobbyChunk || (isCurriculumChunk && !hasExplicitPhoneOrContact)) && !candidateSatisfiesSecondaryBucket) {
        return {
          accepted: false,
          disposition: 'REJECT_ASPECT_MISMATCH',
          reason: 'evidence_does_not_contain_contact_info'
        };
      }
    } else if (wantsSchedule) {
      const isMultiAspectAdmission = Array.isArray(requiredAspects) &&
        (requiredAspects.includes('requirements') || requiredAspects.includes('documents') || requiredAspects.includes('procedureSteps') || requiredAspects.includes('overview'));
      const hasReqDocSignal = isPmbGeneralChunk || isOverviewChunk ||
        /\b(?:syarat|persyaratan|dokumen|berkas|ijazah|ktp|kk|foto|formulir|alur|langkah|cara|prosedur|lulusan|karier|prospek)\b/i.test(text);

      if (isMultiAspectAdmission && hasReqDocSignal) {
        // In multi-aspect PMB queries, accept requirements, documents, and program profile evidence
      } else {
        const hasScheduleSignal = /\b(gelombang|jadwal|periode|pendaftaran|buka|tutup|kalender|oktober|desember|januari|februari|maret|april|mei|juni|juli|agustus|september)\b/i.test(text);
        if ((!hasScheduleSignal || isHobbyChunk || isCurriculumChunk) && !candidateSatisfiesSecondaryBucket) {
          return {
            accepted: false,
            disposition: 'REJECT_ASPECT_MISMATCH',
            reason: 'evidence_does_not_contain_admission_schedule'
          };
        }
      }
    } else if (wantsFee) {
      const queryStr = (retrievalPlan.query || retrievalPlan.rawQuery || (retrievalPlan.queryVariants && retrievalPlan.queryVariants.join(' ')) || '').toLowerCase();
      const isDormitoryFeeQuery = /\b(?:sewa|tarif|biaya|harga)\b/i.test(queryStr) &&
        /\b(?:asrama|kamar\s+asrama|dormitory|kost)\b/i.test(queryStr);
      if (isDormitoryFeeQuery) {
        const isDoubleDegreeDoc = candidateFile && /double\s*degree/i.test(candidateFile);
        const queryAsksDoubleDegree = /\b(?:double\s*degree|dual\s*degree|dnui|china)\b/i.test(queryStr);
        if (isDoubleDegreeDoc && !queryAsksDoubleDegree) {
          return {
            accepted: false,
            disposition: 'REJECT_SCOPE_MISMATCH',
            reason: 'evidence_is_double_degree_dormitory_not_domestic'
          };
        }
        const chunkHasDormitoryFee = /\b(?:asrama|dormitory|kamar|sewa\s+kamar)\b/i.test(text) &&
          /\b(?:rp|tarif|biaya|sewa|gratis|shared\s+room)\b/i.test(text);
        if (!chunkHasDormitoryFee) {
          return {
            accepted: false,
            disposition: 'REJECT_ASPECT_MISMATCH',
            reason: 'evidence_does_not_contain_dormitory_rental_rates'
          };
        }
      }
      if (!isFeeChunk && !candidateSatisfiesSecondaryBucket) {
        return {
          accepted: false,
          disposition: 'REJECT_ASPECT_MISMATCH',
          reason: 'evidence_does_not_contain_fee_aspect'
        };
      }
    } else if (wantsFaculty) {
      if (!isFacultyChunk && !providedAspects.includes('faculty') && !candidateSatisfiesSecondaryBucket) {
        return {
          accepted: false,
          disposition: 'REJECT_ASPECT_MISMATCH',
          reason: 'evidence_does_not_contain_faculty_aspect'
        };
      }
    } else if (wantsCurriculum) {
      const isIsoPolicy = /\b(manajemen berkomitmen untuk|kebijakan mutu)\b/i.test(text);
      const isThesisGuideDoc = candidateFile && /pedoman\s+ta/i.test(candidateFile);
      if ((isIsoPolicy || (!isCurriculumChunk && !isOverviewChunk && !isThesisGuideDoc)) && !candidateSatisfiesSecondaryBucket) {
        return {
          accepted: false,
          disposition: 'REJECT_ASPECT_MISMATCH',
          reason: isIsoPolicy ? 'evidence_is_iso_policy_not_curriculum' : 'evidence_does_not_contain_curriculum_aspect'
        };
      }
    } else if (wantsScholarship) {
      if (!isScholarshipChunk && !candidateSatisfiesSecondaryBucket) {
        return {
          accepted: false,
          disposition: 'REJECT_ASPECT_MISMATCH',
          reason: 'evidence_does_not_contain_scholarship_aspect'
        };
      }
      const queryStr = (retrievalPlan.query || retrievalPlan.rawQuery || (retrievalPlan.queryVariants && retrievalPlan.queryVariants.join(' ')) || '').toLowerCase();
      const hasSpecificSponsor = /\b(?:pemda|pemerintah\s+daerah|papua|djarum|bca|kemenag)\b/i.test(queryStr);
      if (hasSpecificSponsor) {
        const chunkMatchesSponsor = /\b(?:pemda|pemerintah\s+daerah|papua|djarum|bca|kemenag)\b/i.test(text);
        if (!chunkMatchesSponsor) {
          return {
            accepted: false,
            disposition: 'REJECT_ASPECT_MISMATCH',
            reason: 'evidence_does_not_match_specific_scholarship_sponsor'
          };
        }
      }
    } else if (wantsFacilities) {
      const isCareerCenterDomain = retrievalPlan.domain === 'CAREER_CENTER' || retrievalPlan.intent === 'CAREER_CENTER_INQUIRY' ||
        (Array.isArray(requiredAspects) && requiredAspects.some(a => ['career_services', 'internship'].includes(a)));
      const queryStr = (retrievalPlan.query || retrievalPlan.rawQuery || (retrievalPlan.queryVariants && retrievalPlan.queryVariants.join(' ')) || '').toLowerCase();
      const isExplicitInbisQuery = /\b(?:inbis|inkubator\s+bisnis|p2mw|tenant)\b/i.test(queryStr) ||
        retrievalPlan.domain === 'CAMPUS_SERVICE' || retrievalPlan.intent === 'CAMPUS_SERVICE_INQUIRY';
      if (!isExplicitInbisQuery && isInbisChunk) {
        return {
          accepted: false,
          disposition: 'REJECT_SCOPE_MISMATCH',
          reason: 'inbis_operational_grant_not_campus_facility'
        };
      }
      const isBranchFacilityQuery = Boolean(retrievalPlan.targetBranch || (Array.isArray(requiredAspects) && requiredAspects.some(a => a.startsWith('branch_'))));
      const isBranchEvidence = isBranchFacilityQuery && (isLocationChunk || isContactChunk || /\b(?:kampus\s+(?:jimbaran|abiansemal)|jl\.\s*raya\s+kampus\s+udayana|dauh\s+yeh\s+cani|janger)\b/i.test(text));
      if (!isFacilityChunk && !(isCareerCenterDomain && isCareerChunk) && !isBranchEvidence) {
        return {
          accepted: false,
          disposition: 'REJECT_ASPECT_MISMATCH',
          reason: 'evidence_does_not_contain_facility_aspect'
        };
      }
      const isPublicRentalQuery = /\b(?:sewa|tarif|biaya|harga)\b/i.test(queryStr) &&
        /\b(?:resepsi|pernikahan|wedding|acara\s+umum)\b/i.test(queryStr);
      if (isPublicRentalQuery) {
        const chunkHasPublicRental = /\b(?:resepsi|pernikahan|wedding|sewa\s+gedung\s+umum)\b/i.test(text);
        if (!chunkHasPublicRental) {
          return {
            accepted: false,
            disposition: 'REJECT_ASPECT_MISMATCH',
            reason: 'evidence_does_not_contain_public_rental_rates'
          };
        }
      }

      // Dormitory/Asrama room rental fee guard:
      // When query asks for dormitory room rental fee, chunk must explicitly contain dormitory rental information,
      // not generic tuition fee schedules or campus address footers.
      const isDormitoryFeeQuery = /\b(?:sewa|tarif|biaya|harga)\b/i.test(queryStr) &&
        /\b(?:asrama|kamar\s+asrama|dormitory|kost)\b/i.test(queryStr);
      if (isDormitoryFeeQuery) {
        const isDoubleDegreeDoc = candidateFile && /double\s*degree/i.test(candidateFile);
        const queryAsksDoubleDegree = /\b(?:double\s*degree|dual\s*degree|dnui|china)\b/i.test(queryStr);
        if (isDoubleDegreeDoc && !queryAsksDoubleDegree) {
          return {
            accepted: false,
            disposition: 'REJECT_SCOPE_MISMATCH',
            reason: 'evidence_is_double_degree_dormitory_not_domestic'
          };
        }
        const chunkHasDormitoryFee = /\b(?:asrama|dormitory|kamar|sewa\s+kamar)\b/i.test(text) &&
          /\b(?:rp|tarif|biaya|sewa|gratis|shared\s+room)\b/i.test(text);
        if (!chunkHasDormitoryFee) {
          return {
            accepted: false,
            disposition: 'REJECT_ASPECT_MISMATCH',
            reason: 'evidence_does_not_contain_dormitory_rental_rates'
          };
        }
      }
    } else if (wantsOrg) {
      if (!isOrganizationChunk) {
        return {
          accepted: false,
          disposition: 'REJECT_ASPECT_MISMATCH',
          reason: 'evidence_does_not_contain_organization_aspect'
        };
      }
    } else if (wantsPmbGeneral) {
      const satisfiesForeign = querySpecificallyAsksForeign && isForeignStudentChunk;
      const isSpecificProcedureInquiry = retrievalPlan.intent === 'ADMISSION_PROCEDURE' ||
        retrievalPlan.intent === 'PROGRAM_PROCEDURE' ||
        retrievalPlan.intent === 'RPL_INQUIRY' ||
        (requiredAspects.includes('procedure') && !wantsFee && retrievalPlan.intent !== 'GENERAL_PMB_INQUIRY');
      const isRplChunk = candidate.category === 'RPL' ||
        (candidateFile && /rpl/i.test(candidateFile)) ||
        /\b(?:rpl|rekognisi\s+pembelajaran\s+lampau|asesmen\s+portofolio|kriteria\s+portofolio|perolehan\s+kredit|transfer\s+kredit)\b/i.test(text);
      const hasRegistrationProcedureOrPathway = isPmbGeneralChunk || isRplChunk ||
        /\b(?:alur\s+pendaftaran|prosedur\s+pendaftaran|cara\s+(?:daftar|mendaftar|pendaftaran)|tahapan\s+pendaftaran|syarat\s+(?:masuk|pendaftaran)|persyaratan\s+(?:masuk|pendaftaran)|jalur\s+pendaftaran|pmb\.stikom-bali\.ac\.id)\b/i.test(text);

      if (isSpecificProcedureInquiry) {
        const isPureFeeWithoutProcedure = isFeeChunk && !isPmbGeneralChunk && !isRplChunk &&
          !/\b(?:alur\s+pendaftaran|prosedur\s+pendaftaran|cara\s+(?:daftar|mendaftar)|syarat\s+pendaftaran|pmb\.stikom-bali\.ac\.id)\b/i.test(text);
        if (isPureFeeWithoutProcedure || (!hasRegistrationProcedureOrPathway && !satisfiesForeign && !isRplChunk)) {
          return {
            accepted: false,
            disposition: 'REJECT_ASPECT_MISMATCH',
            reason: isPureFeeWithoutProcedure
              ? 'evidence_is_fee_table_not_registration_procedure'
              : 'evidence_does_not_contain_registration_procedure_aspect'
          };
        }
      } else if (!isPmbGeneralChunk && !isFeeChunk && !isScholarshipChunk && !satisfiesForeign && !isRplChunk) {
        return {
          accepted: false,
          disposition: 'REJECT_ASPECT_MISMATCH',
          reason: 'evidence_does_not_contain_pmb_general_aspect'
        };
      }
    } else if (wantsOverview) {
      if (isHobbyChunk) {
        return {
          accepted: false,
          disposition: 'REJECT_ASPECT_MISMATCH',
          reason: 'evidence_is_hobby_not_overview'
        };
      }
    }
    if (wantsCareer) {
      const isFeeDoc = isFeeChunk || (candidateFile && /rincian biaya/i.test(candidateFile));
      if (isFeeDoc && !candidateSatisfiesSecondaryBucket) {
        return {
          accepted: false,
          disposition: 'REJECT_ASPECT_MISMATCH',
          reason: 'evidence_is_fee_document_not_career_prospect'
        };
      }
      const isMultiProgramOverview = (candidate.scope === 'PROGRAM_MULTI' || (candidate.supportedPrograms && candidate.supportedPrograms.length > 1) ||
        /\b(?:program\s+studi\s+deskripsi\s+singkat)\b/i.test(text)) &&
        !/\b(?:peluang\s+kar(?:i)?er|prospek\s+kar(?:i)?er|peluang\s+kerja|profesi\s+lulusan|career\s+center)\b/i.test(text) &&
        !/(?:company-profile-cdc|penjelasan prodi dan karier)/i.test(candidateFile);
      if (isMultiProgramOverview && !candidateSatisfiesSecondaryBucket) {
        return {
          accepted: false,
          disposition: 'REJECT_ASPECT_MISMATCH',
          reason: 'evidence_is_multi_program_overview_not_career_prospect'
        };
      }
      if (!isCareerChunk && !isOverviewChunk && !candidateSatisfiesSecondaryBucket) {
        return {
          accepted: false,
          disposition: 'REJECT_ASPECT_MISMATCH',
          reason: 'evidence_does_not_contain_career_aspect'
        };
      }
    }

    if (wantsInbis) {
      const isInternalAdminDoc = candidateFile && /analisis\s+jabatan|revisi\s+sk\s+pengelola/i.test(candidateFile);
      if (isInternalAdminDoc) {
        return {
          accepted: false,
          disposition: 'REJECT_SCOPE_MISMATCH',
          reason: 'internal_administrative_document_not_inbis_profile'
        };
      }
      const isGenericFacilityDoc = candidateFile && /fasilitas-stikom\.pdf/i.test(candidateFile);
      if (isGenericFacilityDoc) {
        return {
          accepted: false,
          disposition: 'REJECT_ASPECT_MISMATCH',
          reason: 'generic_facility_document_not_inbis_profile'
        };
      }
      if (!isInbisChunk && !isOverviewChunk && !candidateSatisfiesSecondaryBucket) {
        return {
          accepted: false,
          disposition: 'REJECT_ASPECT_MISMATCH',
          reason: 'evidence_does_not_contain_inbis_aspect'
        };
      }
    }
  }

  // Institutional Accreditation Scope Lock: must not accept prodi-only certificates
  if (retrievalPlan.intent === 'INSTITUTIONAL_ACCREDITATION') {
    const isProdiSpecific = /\b(program studi\s+(bisnis digital|teknologi informasi|manajemen informatika|sistem informasi|sistem komputer))\b/i.test(text);
    const isPerguruanTinggi = /\b(perguruan tinggi|institusi|institusi\s+itb\s+stikom\s+bali)\b/i.test(text);
    if (isProdiSpecific && !isPerguruanTinggi) {
      return {
        accepted: false,
        disposition: 'REJECTED',
        reason: 'evidence_is_prodi_accreditation_not_institutional'
      };
    }
  }

  // 3. Temporal Constraint Check (for CURRENT status)
  if (temporalConstraint === 'NOW') {
    const currentYear = new Date().getFullYear();

    // Case A: Dynamic PMB Enrollment / Live Quota Status
    if (retrievalPlan.intent === 'CURRENT_ENROLLMENT_STATUS' || retrievalPlan.intent === 'LIVE_QUOTA_INQUIRY') {
      // Kalender historis diterima sebagai bukti arsip kalender, tetapi ditandai bahwa ia tidak membuktikan pendaftaran sedang aktif saat ini.
      const isPastCalendar = /kalender\s+pendaftaran/i.test(candidateFile || '') || candidate.category === 'JADWAL';
      if (isPastCalendar) {
        return {
          accepted: true,
          disposition: 'SUPPORTS_HISTORICAL_RECORD',
          isHistoricalOnly: true,
          evidenceType: 'historical_calendar',
          providedAspects: ['admission_calendar', 'schedule_history'],
          supportedEntities,
          reason: 'concluded_historical_calendar_record'
        };
      }

      const hasLiveWindow = /\b(sedang\s+dibuka|buka\s+sampai|masih\s+dibuka\s+hingga)\b/i.test(text);
      if (!hasLiveWindow) {
        return {
          accepted: false,
          disposition: 'REJECT_TEMPORAL_MISMATCH',
          reason: 'evidence_lacks_live_calendar_enrollment_window'
        };
      }
    }

    // Case B: Institutional Accreditation
    else if (retrievalPlan.intent === 'INSTITUTIONAL_ACCREDITATION') {
      // Must be the active converting/converted institutional accreditation SK (e.g. SK 3033 / BAIK SEKALI)
      const isActiveSK = /\b(3033\/sk\/ban-pt|baik sekali|periode 2021-2026)\b/i.test(text) ||
        (candidateFile && candidateFile.includes('SSK-92951'));
      const isPureRevoked = /\b(dicabut dan dinyatakan tidak berlaku)\b/i.test(text) && !text.includes('baik sekali');
      if (!isActiveSK || isPureRevoked) {
        return {
          accepted: false,
          disposition: 'REJECT_TEMPORAL_MISMATCH',
          reason: 'evidence_is_expired_or_revoked_accreditation'
        };
      }
    }

    // Case C: General Current Status Inquiry / Program Accreditation
    else {
      const isExpired = /\b(telah berakhir|kadaluwarsa|kedaluwarsa|tidak berlaku lagi)\b/i.test(text);
      const isAccreditationIntent = ['PROGRAM_ACCREDITATION', 'ACCREDITATION_INQUIRY'].includes(retrievalPlan.intent) ||
        (retrievalPlan.requiredAspects && retrievalPlan.requiredAspects.some(a => ['akreditasi', 'accreditation'].includes(a)));
      const isCurrentAccreditationCert = isAccreditationIntent &&
        candidateFile &&
        /\b(?:sertifikat|akreditasi)\b/i.test(candidateFile) &&
        /\b(?:202[6-9]|203[0-9])\b/i.test(candidateFile);
      const validUntilYear = candidate.validUntil ? new Date(candidate.validUntil).getFullYear() : null;
      const isValidUntilFuture = Boolean(validUntilYear && validUntilYear >= currentYear);
      const hasCurrentMarker = text.includes(String(currentYear)) ||
        text.includes(String(currentYear - 1)) ||
        isCurrentAccreditationCert ||
        isValidUntilFuture ||
        /\b(sedang berlangsung|berlaku hingga 202[6-9]|berlaku sampai 202[6-9]|periode 202[1-6]-202[6-9])\b/i.test(text);
      if (isExpired || !hasCurrentMarker) {
        return {
          accepted: false,
          disposition: 'REJECT_TEMPORAL_MISMATCH',
          reason: 'evidence_lacks_current_temporal_validity'
        };
      }
    }
  }

  // Evidence passed all strict gates
  return {
    accepted: true,
    disposition: 'SUPPORTS',
    providedAspects,
    supportedEntities,
    reason: 'compatible_with_plan'
  };
}

/**
 * Segments and curates atomic passages from accepted multi-topic evidence chunks.
 * Preserves valid evidence units while discarding irrelevant operational noise.
 */
function curateCandidatePassages(candidate, retrievalPlan = {}) {
  const rawText = candidate.text || candidate.chunk || '';
  if (!rawText) return candidate;

  const isScholarshipPlan = retrievalPlan.domain === 'SCHOLARSHIP' ||
    retrievalPlan.intent === 'SCHOLARSHIP_INQUIRY' ||
    (Array.isArray(retrievalPlan.requiredAspects) && retrievalPlan.requiredAspects.includes('scholarship'));

  if (isScholarshipPlan) {
    // If the chunk has multi-topic operational noise (e.g. yudisium, 2001 history, transfer SKS), filter those lines out
    const hasOperationalNoise = /\b(pendaftaran\s+yudisium|batas\s+akhir\s+pendaftaran\s+yudisium|wisuda\s+xxxviii|berdiri\s+pada\s+tahun\s+2001|konversi\s+sks|alih\s+jenjang\s+maksimal)\b/i.test(rawText);

    if (hasOperationalNoise) {
      const lines = rawText.split('\n');
      const curatedLines = lines
        .map(l => l.trim())
        .filter(l => l && !/\b(pendaftaran\s+yudisium|batas\s+akhir\s+pendaftaran\s+yudisium|wisuda\s+xxxviii|berdiri\s+pada\s+tahun\s+2001|konversi\s+sks|alih\s+jenjang\s+maksimal)\b/i.test(l));

      if (curatedLines.length > 0) {
        return {
          ...candidate,
          curatedPassages: curatedLines,
          curatedText: curatedLines.join('\n')
        };
      }
    }
  }

  const isJobGuaranteePlan = (Array.isArray(retrievalPlan.requiredAspects) && retrievalPlan.requiredAspects.includes('job_guarantee')) ||
    /\b(?:jaminan|menjamin|dijamin|pasti|langsung)\s+(?:kerja|pekerjaan|dapat\s+kerja|bekerja)\b/i.test(retrievalPlan.rawQuery || '');

  if (isJobGuaranteePlan) {
    // If chunk starts with an unrelated FAQ affirmative answer (e.g. training FAQ #8), curate it out so it doesn't affirm job guarantee
    const isUnrelatedFaqYes = /^(?:jawaban:\s*ya\.\s*career\s+center\s+menyelenggarakan\s+berbagai\s+pelatihan)/i.test(rawText.trim());
    if (isUnrelatedFaqYes) {
      return {
        ...candidate,
        disposition: 'REJECTED',
        isCompatible: false,
        reason: 'unrelated_faq_affirmation_for_job_guarantee'
      };
    }
  }

  return candidate;
}

/**
 * Enriches an arbitrated candidate chunk with the Stage 4 Inter-Module Evidence Contract (Section E):
 * - canonicalEntity
 * - matchedEntities
 * - sourceDocument
 * - academicLevel
 * - scope
 * - supportedAttributes
 * - supportedInformationNeeds
 * - temporalRelevance
 * - provenance
 * - evidenceRole
 * - verificationStatus
 */
function buildEvidenceContractMetadata(candidate = {}, evaluation = {}, retrievalPlan = {}) {
  const supportedEntities = Array.isArray(evaluation.supportedEntities) && evaluation.supportedEntities.length > 0
    ? evaluation.supportedEntities
    : (Array.isArray(candidate.supportedEntities) ? candidate.supportedEntities : []);
  const canonicalEntity = candidate.canonicalEntity || supportedEntities[0] || (Array.isArray(retrievalPlan.targetEntities) && retrievalPlan.targetEntities[0]) || null;
  const sourceDocument = candidate.source_file || candidate.sourceDocument || candidate.sourceFile || candidate.filename || candidate.source || 'canonical_corpus';
  const academicLevel = candidate.academicLevel || candidate.level || (candidate.metadata && (candidate.metadata.academicLevel || candidate.metadata.level)) || retrievalPlan.academicLevel || 'UMUM';
  const scope = candidate.scope || (supportedEntities.length > 1 ? 'PROGRAM_MULTI' : (supportedEntities.length === 1 ? 'PROGRAM_SINGLE' : 'INSTITUTIONAL_OR_ORG'));
  const supportedAttributes = Array.from(new Set(evaluation.providedAspects || candidate.providedAspects || []));

  // Map supportedAttributes to informationNeeds keys
  const supportedInformationNeeds = [];
  const planNeeds = Array.isArray(retrievalPlan.structuredInformationNeeds)
    ? retrievalPlan.structuredInformationNeeds
    : (Array.isArray(retrievalPlan.informationNeedPlans) ? retrievalPlan.informationNeedPlans : []);
  const ATTR_SYNONYMS = {
    fee: ['fee', 'tuition', 'dpp', 'components'],
    accreditation: ['accreditation', 'akreditasi', 'peringkat', 'sk_akreditasi'],
    curriculum: ['curriculum', 'courses', 'competencies'],
    sks: ['curriculum', 'courses'],
    faculty: ['faculty', 'academic_structure', 'faculty_mapping'],
    degree_award: ['degree_award'],
    career_prospects: ['career_prospects', 'career'],
    scholarship: ['scholarship', 'discount'],
    location: ['location', 'campus_location', 'address', 'study_location'],
    contact: ['contact'],
    facilities: ['facilities', 'lab', 'campus_infrastructure'],
    student_organization: ['student_organization', 'ukm', 'organization'],
    schedule: ['schedule', 'waves', 'wave_info'],
    procedure: ['procedure', 'admission_overview', 'admission_pathways'],
    requirements: ['requirements', 'admission_overview']
  };

  for (const need of planNeeds) {
    const needEntity = need.entity || null;
    const needAttr = need.attribute || 'general';
    const entityMatches = !needEntity || supportedEntities.includes(needEntity) || canonicalEntity === needEntity || scope === 'INSTITUTIONAL_OR_ORG' || scope === 'PROGRAM_MULTI';
    const attrSyns = ATTR_SYNONYMS[needAttr] || [needAttr];
    const attrMatches = needAttr === 'general' || supportedAttributes.some(sa => attrSyns.includes(sa));
    if (entityMatches && attrMatches) {
      supportedInformationNeeds.push(need.id || `${needEntity || 'INSTITUTION'}::${needAttr}`);
    }
  }

  const rawCandidateText = String(candidate.text || candidate.chunk || '');
  const isHistoricalArchiveDoc = Boolean(
    evaluation.isHistoricalOnly ||
    candidate.isHistorical ||
    candidate.temporalRelevance === 'HISTORICAL_ARCHIVE' ||
    (/\b(?:arsip\s+lama|dokumen\s+historis|tahun\s+akademik\s+202[0-4]\/202[1-5]|kurikulum\s+(?:lama|2019|2020))\b/i.test(rawCandidateText + ' ' + sourceDocument) &&
     !/\b(?:2025\/2026|2026\/2027|kurikulum\s+2025)\b/i.test(rawCandidateText + ' ' + sourceDocument))
  );

  const periodMatch = (rawCandidateText + ' ' + sourceDocument).match(/\b(20\d{2}\s*\/\s*20\d{2})\b/);
  const period = candidate.period || (periodMatch ? periodMatch[1].replace(/\s+/g, '') : (isHistoricalArchiveDoc ? 'HISTORICAL' : 'ACTIVE'));

  let temporalRelevance = 'ATEMPORAL';
  if (isHistoricalArchiveDoc) {
    temporalRelevance = 'HISTORICAL_ARCHIVE';
  } else if (evaluation.disposition === 'REJECT_TEMPORAL_MISMATCH') {
    temporalRelevance = 'EXPIRED';
  } else if (retrievalPlan.temporalConstraint === 'NOW' || periodMatch) {
    temporalRelevance = 'CURRENT';
  }

  const explicitTier = candidate.governanceMetadata?.authorityTier;
  const isPrimaryOfficialDoc = explicitTier !== undefined && explicitTier !== null
    ? explicitTier === 1
    : /(?:sertifikat|akreditasi|sk_|pasca\.stikom-bali\.ac\.id|pedoman|kurikulum|rincian\s+biaya)/i.test(sourceDocument);
  const provenance = {
    sourceDocument,
    authorityTier: explicitTier || (isPrimaryOfficialDoc ? 1 : 2),
    authority: candidate.governanceMetadata?.authority || (isPrimaryOfficialDoc ? 'tier_1_primary_document' : 'tier_2_corpus_document'),
    owner: candidate.governanceMetadata?.owner || null,
    version: candidate.governanceMetadata?.version || null,
    isPrimarySource: isPrimaryOfficialDoc
  };

  let evidenceRole = 'REJECTED';
  if (evaluation.accepted) {
    if (isHistoricalArchiveDoc) {
      evidenceRole = 'HISTORICAL_CONTEXT';
    } else if (candidate.isContradicting || candidate.evidenceRole === 'CONTRADICTING') {
      evidenceRole = 'CONTRADICTING';
    } else {
      evidenceRole = 'SUPPORTING';
    }
  }

  let verificationStatus = 'UNVERIFIED';
  if (evaluation.accepted) {
    if (isHistoricalArchiveDoc) {
      verificationStatus = 'HISTORICAL_ONLY';
    } else if (candidate.verificationStatus) {
      verificationStatus = candidate.verificationStatus;
    } else if (/d3\s+manajemen\s+informatika/i.test(canonicalEntity || '') && /\b11[05]\s*sks\b/i.test(rawCandidateText)) {
      verificationStatus = 'NEEDS_SOURCE_VALIDATION';
    } else {
      verificationStatus = 'VERIFIED';
    }
  }

  return {
    canonicalEntity,
    matchedEntities: supportedEntities,
    sourceDocument,
    academicLevel,
    scope,
    supportedAttributes,
    supportedInformationNeeds,
    period,
    temporalRelevance,
    provenance,
    evidenceRole,
    verificationStatus
  };
}

/**
 * Detects cross-chunk contradictions and provenance conflicts across accepted evidence.
 * Bound strictly to (entity, attribute, period, provenance) tuples.
 */
function detectSourceConflictsAndProvenance(accepted = [], retrievalPlan = {}) {
  const conflicts = [];
  if (!Array.isArray(accepted) || accepted.length < 2) {
    return { conflicts, hasConflict: false };
  }

  // Group active (non-historical) accepted chunks by (canonicalEntity, period)
  const byEntityAndPeriod = new Map();
  for (const chunk of accepted) {
    if (chunk.temporalRelevance === 'HISTORICAL_ARCHIVE' || chunk.evidenceRole === 'HISTORICAL_CONTEXT') {
      continue;
    }
    const entKey = chunk.canonicalEntity || (chunk.supportedEntities && chunk.supportedEntities[0]) || 'INSTITUTION';
    const periodKey = chunk.period || 'ACTIVE';
    const groupKey = `${entKey}::${periodKey}`;
    if (!byEntityAndPeriod.has(groupKey)) {
      byEntityAndPeriod.set(groupKey, { entity: entKey, period: periodKey, chunks: [] });
    }
    byEntityAndPeriod.get(groupKey).chunks.push(chunk);
  }

  for (const { entity, period, chunks } of byEntityAndPeriod.values()) {
    if (chunks.length < 2) continue;

    // 1. Check conflicting graduation SKS claims (e.g., 110 SKS vs 115 SKS, or 144 SKS vs 120 SKS)
    const sksClaims = [];
    for (const c of chunks) {
      const txt = c.text || c.chunk || '';
      const sksMatch = txt.match(/\b(?:total(?:\s+beban\s+studi|\s+sks(?:\s+kelulusan)?)?|minimal\s+kelulusan|lulus(?:\s+minimal)?)\s*(?:adalah|:)?\s*(\d{2,3})\s*sks\b/i) ||
        txt.match(/\b(144|110|115|56|41|36)\s*sks\b/i);
      if (sksMatch) {
        sksClaims.push({ value: `${sksMatch[1]} SKS`, chunk: c, source: c.sourceDocument, tier: c.provenance?.authorityTier || 2 });
      }
    }
    const distinctSks = Array.from(new Set(sksClaims.map(s => s.value)));
    if (distinctSks.length > 1) {
      conflicts.push({
        entity,
        attribute: 'sks',
        period,
        values: distinctSks,
        sources: sksClaims.map(s => ({ value: s.value, sourceDocument: s.source, authorityTier: s.tier })),
        resolution: 'PREFER_HIGHER_AUTHORITY_OR_DISCLOSE_VALIDATION_NEEDED'
      });
      const bestTier = Math.min(...sksClaims.map(s => s.tier));
      for (const claim of sksClaims) {
        if (claim.tier > bestTier) {
          claim.chunk.evidenceRole = 'CONTRADICTING';
          claim.chunk.verificationStatus = 'CONFLICT_DETECTED';
        } else if (sksClaims.filter(s => s.tier === bestTier && s.value !== claim.value).length > 0) {
          claim.chunk.verificationStatus = 'NEEDS_SOURCE_VALIDATION';
        }
      }
    }

    // 2. Check conflicting accreditation rank claims (e.g. Unggul vs Baik Sekali vs Baik for the same entity & period)
    const accClaims = [];
    for (const c of chunks) {
      const txt = c.text || c.chunk || '';
      const rankMatch = txt.match(/\b(?:terakreditasi|peringkat(?:\s+akreditasi)?)\s+(unggul|baik\s+sekali|baik|\ba\b|\bb\b)\b/i);
      if (rankMatch) {
        const rankNorm = rankMatch[1].toUpperCase().replace(/\s+/g, ' ').trim();
        accClaims.push({ value: rankNorm, chunk: c, source: c.sourceDocument, tier: c.provenance?.authorityTier || 2 });
      }
    }
    const distinctAcc = Array.from(new Set(accClaims.map(a => a.value)));
    if (distinctAcc.length > 1) {
      conflicts.push({
        entity,
        attribute: 'accreditation',
        period,
        values: distinctAcc,
        sources: accClaims.map(a => ({ value: a.value, sourceDocument: a.source, authorityTier: a.tier })),
        resolution: 'PREFER_PRIMARY_CERTIFICATE_SK'
      });
      const bestTier = Math.min(...accClaims.map(a => a.tier));
      for (const claim of accClaims) {
        if (claim.tier > bestTier) {
          claim.chunk.evidenceRole = 'CONTRADICTING';
          claim.chunk.verificationStatus = 'CONFLICT_DETECTED';
        }
      }
    }

    // 3. Component-bound fee claims (fee:dpp vs fee:spp) bound to (entity, attribute, period, provenance)
    // Different components (e.g., DPP Rp 12.000.000 vs SPP Rp 5.100.000) are distinct attributes and NOT conflicts.
    const dppClaims = [];
    const sppClaims = [];
    for (const c of chunks) {
      const txt = c.text || c.chunk || '';
      const dppMatch = txt.match(/\b(?:dana\s+pendidikan\s+pokok|\bdpp\b)(?:\s*\(dpp\))?\s*(?:[:=-]|sebesar|adalah)?\s*rp\.?\s*([\d.]{5,15})/i);
      if (dppMatch) {
        dppClaims.push({
          value: `Rp ${dppMatch[1].replace(/\.+$/, '')}`,
          chunk: c,
          source: c.sourceDocument,
          tier: c.provenance?.authorityTier || 2
        });
      }
      const sppMatch = txt.match(/\b(?:biaya\s+pendidikan\s+per\s+semester|biaya\s+per\s+semester|\bspp\b)(?:\s*\(spp\))?\s*(?:[:=-]|sebesar|adalah)?\s*rp\.?\s*([\d.]{5,15})/i);
      if (sppMatch) {
        sppClaims.push({
          value: `Rp ${sppMatch[1].replace(/\.+$/, '')}`,
          chunk: c,
          source: c.sourceDocument,
          tier: c.provenance?.authorityTier || 2
        });
      }
    }

    for (const [compAttr, compClaims] of [['fee:dpp', dppClaims], ['fee:spp', sppClaims]]) {
      const distinctVals = Array.from(new Set(compClaims.map(f => f.value)));
      if (distinctVals.length > 1) {
        conflicts.push({
          entity,
          attribute: compAttr,
          period,
          values: distinctVals,
          sources: compClaims.map(f => ({ value: f.value, sourceDocument: f.source, authorityTier: f.tier })),
          resolution: 'PREFER_PRIMARY_OFFICIAL_TARIFF_SK'
        });
        const bestTier = Math.min(...compClaims.map(f => f.tier));
        for (const claim of compClaims) {
          if (claim.tier > bestTier) {
            claim.chunk.evidenceRole = 'CONTRADICTING';
            claim.chunk.verificationStatus = 'CONFLICT_DETECTED';
          } else if (compClaims.filter(f => f.tier === bestTier && f.value !== claim.value).length > 0) {
            claim.chunk.verificationStatus = 'NEEDS_SOURCE_VALIDATION';
          }
        }
      }
    }
  }

  return {
    conflicts,
    hasConflict: conflicts.length > 0
  };
}

/**
 * Filters candidates and separates into accepted and rejected evidence
 */
function arbitrateEvidence(candidates = [], retrievalPlan = {}) {
  // Overload: arbitrateEvidence(query, candidateChunk)
  if (typeof candidates === 'string') {
    const query = candidates;
    const candidate = retrievalPlan || {};
    const evaluation = evaluateEvidenceCompatibility(candidate, {
      query,
      rawQuery: query,
      requiredAspects: []
    });
    return {
      accepted: evaluation.accepted,
      reason: evaluation.reason || evaluation.disposition,
      disposition: evaluation.disposition,
      evaluation
    };
  }

  const accepted = [];
  const rejected = [];

  for (const candidate of candidates) {
    const evaluation = evaluateEvidenceCompatibility(candidate, retrievalPlan);
    const contractMeta = buildEvidenceContractMetadata(candidate, evaluation, retrievalPlan);
    if (evaluation.accepted) {
      const curated = curateCandidatePassages({
        ...candidate,
        ...contractMeta,
        disposition: evaluation.disposition,
        dispositionReason: evaluation.reason,
        reason: evaluation.reason,
        providedAspects: evaluation.providedAspects || [],
        supportedEntities: evaluation.supportedEntities || candidate.supportedEntities || []
      }, retrievalPlan);
      accepted.push(curated);
    } else {
      rejected.push({
        ...candidate,
        ...contractMeta,
        disposition: evaluation.disposition,
        dispositionReason: evaluation.reason,
        reason: evaluation.reason,
        providedAspects: evaluation.providedAspects || [],
        supportedEntities: evaluation.supportedEntities || []
      });
    }
  }

  const conflictReport = detectSourceConflictsAndProvenance(accepted, retrievalPlan);

  // Sort accepted evidence to prioritize core requested aspect content
  if (retrievalPlan.domain === 'TUITION_FEE' || (retrievalPlan.requiredAspects && retrievalPlan.requiredAspects.includes('fee'))) {
    accepted.sort((a, b) => {
      const aHasCore = /\b(Biaya Pendidikan Per Semester|Dana Pendidikan Pokok|\(DPP\))\b/i.test(a.text);
      const bHasCore = /\b(Biaya Pendidikan Per Semester|Dana Pendidikan Pokok|\(DPP\))\b/i.test(b.text);
      if (aHasCore && !bHasCore) return -1;
      if (!aHasCore && bHasCore) return 1;
      return 0;
    });
  }

  if (retrievalPlan.intent === 'PROGRAM_OVERVIEW' || retrievalPlan.intent === 'DEFINITION') {
    accepted.sort((a, b) => {
      const aIsAuthoritative = /\b(Penjelasan Prodi|Fokus Pendidikan|Yang Dipelajari|Peluang Kerja|Visi)\b/i.test(a.text);
      const bIsAuthoritative = /\b(Penjelasan Prodi|Fokus Pendidikan|Yang Dipelajari|Peluang Kerja|Visi)\b/i.test(b.text);
      if (aIsAuthoritative && !bIsAuthoritative) return -1;
      if (!aIsAuthoritative && bIsAuthoritative) return 1;
      return 0;
    });
  }

  if (retrievalPlan.intent === 'PROGRAM_COMPARISON') {
    accepted.sort((a, b) => {
      // Deprioritize student organization / ormawa chunks for program comparison
      const aIsOrmawa = /ORMAWA|HIMAPRODI/i.test(a.sourceFile || a.metadata?.sourceFile || '') || /PROFILE\s+HIMPUNAN\s+MAHASISWA/i.test(a.text || a.chunk || '');
      const bIsOrmawa = /ORMAWA|HIMAPRODI/i.test(b.sourceFile || b.metadata?.sourceFile || '') || /PROFILE\s+HIMPUNAN\s+MAHASISWA/i.test(b.text || b.chunk || '');
      if (aIsOrmawa && !bIsOrmawa) return 1;
      if (!aIsOrmawa && bIsOrmawa) return -1;

      const aIsAuthoritative = /\b(Penjelasan Prodi|Fokus Pendidikan|Yang Dipelajari|Peluang Kerja|Visi|Profil Program Studi|Deskripsi Singkat)\b/i.test(a.text || a.chunk || '');
      const bIsAuthoritative = /\b(Penjelasan Prodi|Fokus Pendidikan|Yang Dipelajari|Peluang Kerja|Visi|Profil Program Studi|Deskripsi Singkat)\b/i.test(b.text || b.chunk || '');
      if (aIsAuthoritative && !bIsAuthoritative) return -1;
      if (!aIsAuthoritative && bIsAuthoritative) return 1;
      return 0;
    });
  }

  if (retrievalPlan.domain === 'ACADEMIC_CURRICULUM' || retrievalPlan.intent === 'CURRICULUM_INQUIRY') {
    const queryText = (retrievalPlan.query || retrievalPlan.rawQuery || (retrievalPlan.queryVariants && retrievalPlan.queryVariants.join(' ')) || '').toLowerCase();
    const isCodingQuery = /\b(?:coding|pemrograman|ngoding|koding|jago\s+coding)\b/i.test(queryText);
    const isDigitalMarketingQuery = /\b(?:digital\s+marketing|pemasaran\s+digital|seo|mesin\s+pencari|sosial\s+media|media\s+sosial)\b/i.test(queryText);
    const isAiQuery = /\b(?:artificial\s+intelligence|\bai\b|kecerdasan\s+artifisial|kecerdasan\s+buatan|prompt)\b/i.test(queryText);

    accepted.sort((a, b) => {
      const aText = (a.text || a.chunk || '').toLowerCase();
      const bText = (b.text || b.chunk || '').toLowerCase();
      const aIsPureCareer = /\b(?:lulusan.*berkarier sebagai|profesi lulusan|peluang karir|peluang kerja)\b/i.test(aText) &&
        !/\b(?:semester\s+[ivx\d]+|sks|mata\s*kuliah)\b/i.test(aText);
      const bIsPureCareer = /\b(?:lulusan.*berkarier sebagai|profesi lulusan|peluang karir|peluang kerja)\b/i.test(bText) &&
        !/\b(?:semester\s+[ivx\d]+|sks|mata\s*kuliah)\b/i.test(bText);

      // Deprioritize pure career chunks when inquiring about curriculum / courses
      if (aIsPureCareer && !bIsPureCareer) return 1;
      if (!aIsPureCareer && bIsPureCareer) return -1;

      // Prioritize specific topic evidence
      if (isDigitalMarketingQuery) {
        const aHasDm = /\b(?:pemasaran\s+digital|optimasi\s+mesin\s+pencari|pemasaran\s+media\s+sosial|kampanye\s+pemasaran)\b/i.test(aText);
        const bHasDm = /\b(?:pemasaran\s+digital|optimasi\s+mesin\s+pencari|pemasaran\s+media\s+sosial|kampanye\s+pemasaran)\b/i.test(bText);
        if (aHasDm && !bHasDm) return -1;
        if (!aHasDm && bHasDm) return 1;
      }

      if (isAiQuery) {
        const aHasAi = /\b(?:teknik\s+pembuatan\s+prompt|model\s+ai|kecerdasan\s+artifisial)\b/i.test(aText);
        const bHasAi = /\b(?:teknik\s+pembuatan\s+prompt|model\s+ai|kecerdasan\s+artifisial)\b/i.test(bText);
        if (aHasAi && !bHasAi) return -1;
        if (!aHasAi && bHasAi) return 1;
      }

      if (isCodingQuery) {
        const aHasPrereqOrTech = /\b(?:rekayasa\s+perangkat\s+lunak|algoritma|pemrograman|obe|dasar|fondasi)\b/i.test(aText);
        const bHasPrereqOrTech = /\b(?:rekayasa\s+perangkat\s+lunak|algoritma|pemrograman|obe|dasar|fondasi)\b/i.test(bText);
        if (aHasPrereqOrTech && !bHasPrereqOrTech) return -1;
        if (!aHasPrereqOrTech && bHasPrereqOrTech) return 1;
      }

      const aHasSem = /\b(?:semester\s+[ivx\d]+|kurikulum\s+2025)\b/i.test(aText);
      const bHasSem = /\b(?:semester\s+[ivx\d]+|kurikulum\s+2025)\b/i.test(bText);
      if (aHasSem && !bHasSem) return -1;
      if (!aHasSem && bHasSem) return 1;

      return 0;
    });
  }

  // Shadow comparison telemetry (Section 20): does NOT alter legacy arbitration
  const contract = retrievalPlan.retrievalContract || (retrievalPlan.domain ? buildRetrievalContract(retrievalPlan) : null);
  let shadowContractArbitration = null;
  let shadowComparison = null;
  if (contract) {
    try {
      shadowContractArbitration = arbitrateEvidenceWithContract(candidates, contract);
      shadowComparison = compareRetrievalShadow(
        retrievalPlan.queryVariants?.[0] || '',
        candidates,
        { accepted, rejected, hasSupportedEvidence: accepted.length > 0 },
        contract,
        shadowContractArbitration
      );
    } catch (_err) {
      // Non-blocking in shadow mode
    }
  }

  return {
    accepted,
    rejected,
    retrievalPlan,
    hasSupportedEvidence: accepted.length > 0,
    sourceConflicts: conflictReport.conflicts,
    hasSourceConflict: conflictReport.hasConflict,
    unsupportedEntity: Boolean(retrievalPlan.unsupportedEntity || retrievalPlan.isUnsupportedEntity),
    unsupportedEntityName: retrievalPlan.unsupportedEntityName || retrievalPlan.unsupportedProgramName || null,
    entityResolutionStatus: retrievalPlan.entityResolutionStatus || 'RESOLVED',
    shadowContractArbitration,
    shadowComparison
  };
}

module.exports = {
  evaluateEvidenceCompatibility,
  arbitrateEvidence,
  arbitrateEvidenceWithContract,
  curateCandidatePassages,
  buildEvidenceContractMetadata,
  detectSourceConflictsAndProvenance
};
