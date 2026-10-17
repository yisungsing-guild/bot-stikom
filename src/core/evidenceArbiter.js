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
  }
  if (/^S2\b/i.test(targetEntityStr)) {
    if (candLevel && ['S1', 'D3'].includes(candLevel)) return false;
    if (candLevel !== 'S2' && !/\b(magister|s2|pascasarjana)\b/i.test(cleanText) && !/\b(magister|s2|pascasarjana)\b/i.test(fileNorm)) {
      return false;
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
    if (targetCode && candProg && candProg !== targetCode && (candidateTextOrObj.scope === 'PROGRAM_SINGLE' || (candidateTextOrObj.program && candProg !== 'MULTI'))) {
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

  // 0.2 PMB Registration Form Fee vs DPP Discount / Wave Discount Gate
  const isAskingFormFee = /\b(?:biaya\s+formulir|biaya\s+pendaftaran|uang\s+pendaftaran|biaya\s+daftar)\b/i.test(queryText) ||
    retrievalPlan.intent === 'ADMISSION_FORM_FEE' ||
    (Array.isArray(requiredAspects) && requiredAspects.includes('registration_form_fee'));
  if (isAskingFormFee) {
    const isDppDiscountOnly = candidate.aspect === 'potongan_dpp' ||
      candidate.aspect === 'potongan_biaya_pendaftaran' ||
      (/\b(?:potongan\s+dpp|dana\s+pendidikan\s+pokok|beasiswa\s+dpp|registrasi\s+pada\s+gelombang\s+khusus)\b/i.test(text) &&
       !/\b(?:biaya\s+formulir|biaya\s+pendaftaran\s+sebesar|membayar\s+formulir)\b/i.test(text));
    if (isDppDiscountOnly) {
      return {
        accepted: false,
        disposition: 'REJECT_ASPECT_MISMATCH',
        reason: 'REJECT_ASPECT_MISMATCH'
      };
    }
  }

  // 0.3 Main Campus Address vs Branch / Cost Footer Gate
  const isAskingMainCampusLocation = /\b(?:alamat\s+kampus\s+utama|kampus\s+utama|kampus\s+pusat|kampus\s+renon)\b/i.test(queryText) ||
    (retrievalPlan.intent === 'CAMPUS_LOCATION' && /\b(?:utama|pusat|renon)\b/i.test(queryText));
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

  // 1. Excluded Conflicting Entities Check (Preserve Hard Entity Lock)
  if (Array.isArray(excludedConflictingEntities) && excludedConflictingEntities.length > 0) {
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
    // Institutional / Student Org documents (e.g. HIMAPRODI profile with level Umum) should not be rejected for S1 queries
    const isInstOrOrgGeneral = candLvl === 'UMUM' &&
      (candidate.scope === 'INSTITUTIONAL_OR_ORG' || /buku ormawa himaprodi|profile hima/i.test(candidateFile));
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
  const isMultiProgramCandidate = candidate?.scope === 'PROGRAM_MULTI' ||
    (Array.isArray(candidate?.supportedPrograms) && candidate.supportedPrograms.length > 1);

  if (!isMultiProgramCandidate) {
    const candRawProg = candidate ? (candidate.program || candidate.canonicalEntity || '') : '';
    let candProgCode = candidate?.scope === 'PROGRAM_SINGLE'
      ? (candidate.program ? String(candidate.program).toUpperCase() : null)
      : (getProgramCodeFromEntity(candRawProg) || (candidate?.id?.match(/^curr-([a-z0-9]+)/i) ? candidate.id.match(/^curr-([a-z0-9]+)/i)[1].toUpperCase() : null));

    const hasUndergradLevel = candidate?.academicLevel === 'S1' || candidate?.level === 'S1' ||
      candidate?.academicLevel === 'D3' || candidate?.level === 'D3' ||
      (Array.isArray(candidate?.academicLevels) && (candidate.academicLevels.includes('S1') || candidate.academicLevels.includes('D3')));

    const isCandidateS2 = (candidate?.academicLevel === 'S2' || candidate?.level === 'S2' ||
      /(?:pascasarjana|magister)/i.test(candidate?.source_file || candidate?.filename || candidate?.sourceDocument || '') ||
      /\b(?:program pascasarjana|magister sistem informasi|s2 sistem informasi)\b/i.test(candidate?.text || candidate?.chunk || '')) &&
      !hasUndergradLevel;

    if (isCandidateS2 && (candProgCode === 'SI' || candRawProg === 'SI')) {
      candProgCode = 'S2';
    }

    if (Array.isArray(targetEntities) && targetEntities.length > 0 && candProgCode) {
      const targetCodes = targetEntities.map(te => getProgramCodeFromEntity(te)).filter(Boolean);
      if (targetCodes.length > 0 && !targetCodes.includes(candProgCode)) {
        return {
          accepted: false,
          disposition: 'REJECT_SCOPE_COLLISION',
          reason: `candidate_scoped_to_program_${candProgCode}_not_${targetCodes.join('_')}`
        };
      }
    }
  }

  // 1.3 Candidate Metadata Multi-Program Scope Isolation Gate
  if (isMultiProgramCandidate || (candidate && candidate.scope === 'PROGRAM_MULTI')) {
    const supportedPrograms = Array.isArray(candidate.supportedPrograms) && candidate.supportedPrograms.length > 0
      ? candidate.supportedPrograms.map(p => getProgramCodeFromEntity(p) || String(p).toUpperCase())
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

  // 1.5 Academic Level Isolation Gate: Conflicting non-Umum academic levels must be REJECTED
  const planLevel = retrievalPlan.academicLevel || retrievalPlan.targetLevel;
  if (planLevel && planLevel !== 'Umum') {
    const candLevel = candidate.academicLevel;
    if (candLevel && candLevel !== 'Umum' && candLevel !== planLevel) {
      return {
        accepted: false,
        disposition: 'REJECT_SCOPE_MISMATCH',
        reason: `candidate_level_${candLevel}_conflicts_with_target_level_${planLevel}`
      };
    }
  }

  // 2. Target Entity & Scope Compatibility Check
  if (Array.isArray(targetEntities) && targetEntities.length > 0) {
    // Group target entities by family to prevent cross-family false positive matches
    const familyMap = new Map();
    for (const ent of targetEntities) {
      const canonicalEntry = findCanonicalEntity(ent);
      const fam = canonicalEntry ? canonicalEntry.family : 'default';
      if (!familyMap.has(fam)) familyMap.set(fam, []);
      familyMap.get(fam).push(ent);
    }

    // Evidence must satisfy all distinct entity families represented in targetEntities
    for (const [fam, ents] of familyMap.entries()) {
      const hasMatchInFamily = ents.some(ent => isCandidateMatchingTargetEntity(candidate, ent));
      if (!hasMatchInFamily) {
        return {
          accepted: false,
          disposition: 'REJECT_ENTITY_MISMATCH',
          reason: `evidence_does_not_contain_target_entity_in_family: ${fam}`
        };
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
  const candTextLower = text.toLowerCase();
  const providedAspects = [];
  const isFeeChunk = candidate.docCategory === 'BIAYA' ||
    (candidateFile && /rincian biaya/i.test(candidateFile)) ||
    /\b(biaya|tarif|sewa|pendidikan per semester|dpp|spp|uang pangkal|waktu pembayaran|pendaftaran \d|dicicil|potongan biaya|angsuran)\b/i.test(text);

  const isCurriculumChunk = /\b(kurikulum|mata\s*kuliah|matkul|sks|semester\s+[ivx\d]+\s+no\s+nama\s+mata\s+kuliah|praktikum)\b/i.test(text) &&
    !(candidateFile && /kalender\s+akademik/i.test(candidateFile));
  const isOverviewChunk = /\b(deskripsi singkat|profil|fokus pada|fokus pendidikan|keahlian dalam bidang|visi|misi|program studi terlihat|penjelasan prodi|peluang kerja|yang dipelajari|perbedaan)\b/i.test(text);
  const isCareerChunk = /\b(peluang kerja|prospek karir|prospek karier|profesi lulusan|career center|magang|internship|cdc)\b/i.test(text) ||
    (candidateFile && /(?:company-profile-cdc|penjelasan prodi dan karier)/i.test(candidateFile));
  const isScholarshipChunk = /\b(beasiswa|kip-?kuliah|potongan\s+dpp|keringanan\s+biaya|bantuan\s+dana|skss)\b/i.test(text);
  const isFacilityChunk = /\b(laboratorium|lab\b|perpustakaan|asrama|dormitory|sarana\s+dan\s+prasarana|ruang\s+kelas|gedung\s+kampus)\b/i.test(text) ||
    (/\bfasilitas\b/i.test(text) && !/kurikulum|keunggulan\s+program|visi|misi/i.test(text));
  const isOrganizationChunk = /\b(ukm\b|unit\s+kegiatan\s+mahasiswa|organisasi\s+mahasiswa|ormawa|hima\b|himaprodi|senat|balma|ekstrakurikuler)\b/i.test(text);
  const isPmbGeneralChunk = /\b(pmb|pendaftaran\s+mahasiswa\s+baru|jalur\s+pendaftaran|syarat\s+pendaftaran|persyaratan(?:\s+pendaftaran)?|syarat\s+masuk|persyaratan\s+masuk|dokumen\s+pendaftaran|berkas\s+pendaftaran|pmb\.stikom-bali\.ac\.id)\b/i.test(text);
  const isHobbyChunk = /\b(hobi\s*\/\s*aktivitas|aktivitas\s*:\s*bermain game|hobi\s*:)\b/i.test(text);
  const isProgramListChunk = /\b(program\s+studi|program\s+sarjana|jenjang|s1|d3|s2|pilihan\s+program)\b/i.test(text);
  const isStudyModeChunk = /\b(kelas\s+karyawan|kelas\s+sore|kelas\s+reguler|pilihan\s+kelas|kuliah\s+sambil\s+kerja|sambil\s+bekerja|jadwal\s+kuliah|fleksibel|bekerja)\b/i.test(text);
  const isDegreeChunk = /\b(gelar|sarjana\s+komputer|sarjana\s+bisnis|s\.kom|s\.bns|m\.kom|a\.md\.kom)\b/i.test(text);
  const isEsportsChunk = /\b(esport|esports|e-sports|athena|gaming|game)\b/i.test(text);
  const isSportsChunk = /\b(olahraga|futsal|basket|bulutangkis|badminton|fitness|gym)\b/i.test(text);

  const isContactChunk = /\b(hotline|kontak|telepon|telp|whatsapp|wa|email|humas|08\d{8,}|\+62|0361|call\s*center)\b/i.test(text);
  const isScheduleChunk = /\b(gelombang|jadwal|kalender\s+pendaftaran|periode|tahap\s+\d|waktu\s+pendaftaran)\b/i.test(text);
  const isPaymentProcedureChunk = /\b(konfirmasi\s+pembayaran|bukti\s+bayar|transfer|tata\s+cara\s+pembayaran|rekening|waktu\s+pembayaran)\b/i.test(text);
  const isAccreditationChunk = /\b(akreditasi|terakreditasi|ban-?pt|lam-?infokom|peringkat\s+akreditasi|sk\s+akreditasi|\/sk\/ban-pt\/|\/sk\/lam-infokom\/|terakreditasi\s+(?:baik|unggul|a|b))\b/i.test(text);
  const isLocationChunk = /\b(lokasi|tempat|kampus|alamat|gedung|ruang|china|dalian|neusoft|malaysia|luar\s+negeri|dalam\s+negeri|onsite|online|daring|luring|jalan|jl\.|denpasar|renon|jimbaran|full\s+di\s+stikom)\b/i.test(text);
  const isDurationChunk = /\b(masa\s+studi|durasi|berapa\s+tahun|berapa\s+semester|tahun\s+1|tahun\s+2|tahun\s+3|tahun\s+4|semester\s+[1-8]|\d\s+semester|\d\s+tahun)\b/i.test(text);

  if (isFeeChunk) providedAspects.push('fee', 'tuition', 'dpp', 'components');
  if (isCurriculumChunk) providedAspects.push('curriculum', 'courses', 'competencies');
  if (isOverviewChunk) providedAspects.push('overview', 'definition', 'curriculum_difference', 'curriculum', 'courses', 'career', 'competencies');
  if (isCareerChunk) providedAspects.push('career_prospects', 'career');
  if (isContactChunk) providedAspects.push('contact');
  if (isScheduleChunk) providedAspects.push('schedule', 'waves', 'wave_info');
  if (isPaymentProcedureChunk) providedAspects.push('procedure', 'payment_procedure');
  if (isScholarshipChunk) providedAspects.push('scholarship', 'discount', 'requirements');
  if (isFacilityChunk) providedAspects.push('facilities', 'lab', 'campus_infrastructure');
  if (isOrganizationChunk) providedAspects.push('student_organization', 'organization', 'general_organization', 'activities', 'ukm');
  if (isPmbGeneralChunk) providedAspects.push('admission_overview', 'procedure', 'admission_pathways', 'requirements', 'documents');
  if (isProgramListChunk) providedAspects.push('program_list', 'degrees');
  if (isStudyModeChunk) providedAspects.push('class_schedule', 'working_students', 'evening_class');
  if (isDegreeChunk) providedAspects.push('degree_award');
  if (isEsportsChunk) providedAspects.push('esports_gaming');
  if (isSportsChunk) providedAspects.push('sports');
  if (isAccreditationChunk) providedAspects.push('akreditasi', 'peringkat', 'sk_akreditasi', 'accreditation');
  if (isLocationChunk) providedAspects.push('location', 'study_location', 'campus_location');
  if (isDurationChunk) providedAspects.push('duration', 'study_duration');
  const isThesisChunk = (candidateFile && /(?:pedoman\s+ta|pedoman\s+skripsi)/i.test(candidateFile)) ||
    /\b(pedoman\s+tugas\s+akhir|persyaratan\s+akademik|141\s+sks|tugas\s+akhir|bimbingan\s+tugas\s+akhir)\b/i.test(candTextLower);
  if (isThesisChunk) providedAspects.push('thesis_requirements', 'academic_requirements', 'guidelines', 'pedoman_ta', 'thesis_stages', 'guidance_procedure');

  // Program Overview / Definition: Guard against administrative signature blocks, thesis guide kaprodi lines, or pure institutional history
  if (retrievalPlan.intent === 'PROGRAM_OVERVIEW' || retrievalPlan.intent === 'DEFINITION') {
    const isAdministrativeSignature = /^(?:Ketua Program Studi|Para Ketua Program Studi|Acc Kaprodi|Dosen Pembimbing)\s*[A-Z0-9\-\s\.]*$/i.test(candidateText.trim()) ||
      (candidateText.length < 80 && /Ketua Program Studi/i.test(candidateText));
    if (isAdministrativeSignature) {
      return {
        accepted: false,
        disposition: 'REJECT_ASPECT_MISMATCH',
        reason: 'evidence_is_administrative_signature_not_overview'
      };
    }
    const isInstitutionalHistory = /1\.\s*Sejarah Singkat Institusi/i.test(candidateText) && !candidateText.includes('Fokus Pendidikan');
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
  const isForeignStudentChunk = candSourceFile.includes('mahasiswa asing') ||
    /\b(faq pengurusan mahasiswa asing|izin belajar baru|perpanjangan itas|pengurusan visa e30b|sktt orang asing)\b/i.test(candTextLower);
  const querySpecificallyAsksForeign = retrievalPlan.participantScope === 'foreign' ||
    Boolean(retrievalPlan.queryVariants && retrievalPlan.queryVariants.some(q => /\b(mahasiswa\s+asing|visa|itas|kitas|izin\s+belajar|e-visa)\b/i.test(q)));

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
  }

  // International domain guard: prevent accreditation certificates from satisfying international program inquiries
  if ((retrievalPlan.domain === 'INTERNATIONAL' || retrievalPlan.intent === 'INTERNATIONAL_PROGRAM_INFO') &&
      !/\b(akreditasi|terakreditasi|ban-?pt|lam-?infokom)\b/i.test(retrievalPlan.rawQuery)) {
    if (isAccreditationChunk && !/\b(double\s*degree|dual\s*degree|student\s*exchange|internasional)\b/i.test(text)) {
      return {
        accepted: false,
        disposition: 'REJECT_DOMAIN_MISMATCH',
        reason: 'evidence_is_accreditation_not_international_program'
      };
    }
  }

  // Strict aspect matching against retrievalPlan.requiredAspects
  if (Array.isArray(requiredAspects) && requiredAspects.length > 0 && !requiredAspects.includes('general')) {
    const wantsContact = requiredAspects.some(a => ['contact', 'helpdesk'].includes(a)) || retrievalPlan.intent === 'PMB_CONTACT_INQUIRY';
    const wantsSchedule = requiredAspects.some(a => ['schedule', 'wave_info'].includes(a)) || retrievalPlan.intent === 'ADMISSION_SCHEDULE';
    const wantsFee = requiredAspects.some(a => ['fee', 'tuition', 'dpp'].includes(a)) || retrievalPlan.domain === 'TUITION_FEE';
    const wantsCareer = requiredAspects.some(a => ['career', 'career_prospects', 'prospek_karir'].includes(a)) || retrievalPlan.intent === 'CAREER_PROSPECTS_INQUIRY';
    const wantsCurriculum = !wantsCareer && (requiredAspects.some(a => ['curriculum', 'courses'].includes(a)) || retrievalPlan.domain === 'ACADEMIC_CURRICULUM');
    const wantsOverview = requiredAspects.some(a => ['overview', 'definition', 'curriculum_difference'].includes(a));
    const wantsScholarship = requiredAspects.some(a => ['scholarship', 'discount'].includes(a)) || retrievalPlan.domain === 'SCHOLARSHIP';
    const wantsFacilities = requiredAspects.some(a => ['facilities', 'lab'].includes(a)) || retrievalPlan.domain === 'FACILITIES';
    const wantsOrg = requiredAspects.some(a => ['student_organization', 'ukm'].includes(a)) || retrievalPlan.domain === 'ORGANIZATION_UKM';
    const wantsPmbGeneral = requiredAspects.some(a => ['admission_overview', 'procedure', 'admission_pathways'].includes(a)) || (retrievalPlan.domain === 'PMB' && (retrievalPlan.intent === 'GENERAL_PMB_INQUIRY' || retrievalPlan.intent === 'ADMISSION_PROCEDURE'));

    if (wantsContact) {
      const hasContactSignal = /\b(whatsapp|wa|telepon|telp|call\s*center|email|kontak|08\d{8,}|\+62|0361|pmb\.stikom-bali\.ac\.id)\b/i.test(text);
      if (!hasContactSignal || isHobbyChunk || isCurriculumChunk) {
        return {
          accepted: false,
          disposition: 'REJECT_ASPECT_MISMATCH',
          reason: 'evidence_does_not_contain_contact_info'
        };
      }
    } else if (wantsSchedule) {
      const hasScheduleSignal = /\b(gelombang|jadwal|periode|pendaftaran|buka|tutup|kalender|oktober|desember|januari|februari|maret|april|mei|juni|juli|agustus|september)\b/i.test(text);
      if (!hasScheduleSignal || isHobbyChunk || isCurriculumChunk) {
        return {
          accepted: false,
          disposition: 'REJECT_ASPECT_MISMATCH',
          reason: 'evidence_does_not_contain_admission_schedule'
        };
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
      if (!isFeeChunk) {
        return {
          accepted: false,
          disposition: 'REJECT_ASPECT_MISMATCH',
          reason: 'evidence_does_not_contain_fee_aspect'
        };
      }
    } else if (wantsCurriculum) {
      const isIsoPolicy = /\b(manajemen berkomitmen untuk|kebijakan mutu)\b/i.test(text);
      const isThesisGuideDoc = candidateFile && /pedoman\s+ta/i.test(candidateFile);
      if (isIsoPolicy || (!isCurriculumChunk && !isOverviewChunk && !isThesisGuideDoc)) {
        return {
          accepted: false,
          disposition: 'REJECT_ASPECT_MISMATCH',
          reason: isIsoPolicy ? 'evidence_is_iso_policy_not_curriculum' : 'evidence_does_not_contain_curriculum_aspect'
        };
      }
    } else if (wantsScholarship) {
      if (!isScholarshipChunk) {
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
      if (!isFacilityChunk && !(isCareerCenterDomain && isCareerChunk)) {
        return {
          accepted: false,
          disposition: 'REJECT_ASPECT_MISMATCH',
          reason: 'evidence_does_not_contain_facility_aspect'
        };
      }
      const queryStr = (retrievalPlan.query || retrievalPlan.rawQuery || (retrievalPlan.queryVariants && retrievalPlan.queryVariants.join(' ')) || '').toLowerCase();
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
      if (!isPmbGeneralChunk && !isFeeChunk && !isScholarshipChunk && !satisfiesForeign) {
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
      if (isFeeDoc) {
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
      if (isMultiProgramOverview) {
        return {
          accepted: false,
          disposition: 'REJECT_ASPECT_MISMATCH',
          reason: 'evidence_is_multi_program_overview_not_career_prospect'
        };
      }
      if (!isCareerChunk && !isOverviewChunk) {
        return {
          accepted: false,
          disposition: 'REJECT_ASPECT_MISMATCH',
          reason: 'evidence_does_not_contain_career_aspect'
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
      // Must contain explicit live schedule dates or live confirmation for current year
      // Mere fee discount per wave (e.g. "Gelombang I : 50%") is not proof of live current status
      const hasLiveWindow = text.includes(String(currentYear)) &&
        /\b(jadwal pendaftaran|tanggal penting|periode pendaftaran|buka sampai|dibuka mulai)\b/i.test(text);
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
    reason: 'compatible_with_plan'
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
    if (evaluation.accepted) {
      accepted.push({
        ...candidate,
        disposition: evaluation.disposition,
        dispositionReason: evaluation.reason,
        reason: evaluation.reason,
        providedAspects: evaluation.providedAspects || []
      });
    } else {
      rejected.push({
        ...candidate,
        disposition: evaluation.disposition,
        dispositionReason: evaluation.reason,
        reason: evaluation.reason,
        providedAspects: evaluation.providedAspects || []
      });
    }
  }

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
  arbitrateEvidenceWithContract
};
