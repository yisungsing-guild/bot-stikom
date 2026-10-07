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

function normalizePunctuation(str) {
  if (!str) return '';
  return str.toLowerCase()
    .replace(/[“”—\-_,.:;()\/\\"'\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Checks whether candidate text supports a specific target entity using canonical registry
 */
function isCandidateMatchingTargetEntity(candidateText, targetEntityStr) {
  if (!candidateText || !targetEntityStr) return false;

  const rawTextNorm = candidateText.toLowerCase();
  const cleanText = normalizePunctuation(candidateText);
  const targetNorm = targetEntityStr.toLowerCase();

  // 1. Direct substring match
  if (rawTextNorm.includes(targetNorm) || cleanText.includes(normalizePunctuation(targetEntityStr))) {
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
          if (wordRegex.test(cleanText)) return true;
        } else {
          if (cleanText.includes(aliasNorm)) return true;
        }
      }
    }

    if (canonicalEntry.family === 'academic_program' || canonicalEntry.type === 'program') {
      const baseName = canonicalEntry.canonical.replace(/^(S1|S2|D3|D4)\s+/i, '').trim();
      const baseNorm = normalizePunctuation(baseName);
      if (baseNorm.length > 3 && cleanText.includes(baseNorm)) {
        return true;
      }
    }

    if (canonicalEntry.family === 'student_organization' || canonicalEntry.type === 'ukm') {
      const match = canonicalEntry.canonical.match(/\b([A-Z0-9]{3,})\b/);
      if (match) {
        const code = match[1].toLowerCase();
        if (cleanText.includes(code)) return true;
      }
    }
  }

  // 3. Generic distinctive token matching for target entity (proximity required for multi-token entities)
  const genericStopwords = new Set(['program', 'studi', 'degree', 'double', 'dual', 'jenjang', 'sarjana', 'diploma', 's1', 's2', 'd3', 'd4']);
  const targetTokens = targetNorm.split(/\s+/).filter(t => t.length >= 3 && !genericStopwords.has(t));
  if (targetTokens.length === 1) {
    if (cleanText.includes(targetTokens[0])) return true;
  } else if (targetTokens.length > 1) {
    const proximityPattern = new RegExp('\\b' + targetTokens[0] + '\\b(?:\\s+\\w+){0,2}\\s+\\b' + targetTokens[1] + '\\b', 'i');
    if (proximityPattern.test(cleanText)) return true;
  }

  return false;
}

function evaluateEvidenceCompatibility(candidate, retrievalPlan) {
  if (!candidate || !candidate.text) {
    return { accepted: false, reason: 'empty_evidence' };
  }

  const text = candidate.text.toLowerCase();
  const cleanText = normalizePunctuation(candidate.text);
  const { targetEntities = [], excludedConflictingEntities = [], temporalConstraint, requiredAspects } = retrievalPlan;

  // 1. Excluded Conflicting Entities Check (Preserve Hard Entity Lock)
  if (Array.isArray(excludedConflictingEntities) && excludedConflictingEntities.length > 0) {
    for (const excluded of excludedConflictingEntities) {
      const exClean = normalizePunctuation(excluded);
      if (cleanText.includes(exClean)) {
        // Generic cross-program document / sliding window overlap resolution:
        // If the chunk also genuinely matches the target entity, allow it for passage-level isolation
        const hasTarget = Array.isArray(targetEntities) && targetEntities.some(ent => isCandidateMatchingTargetEntity(candidate.text, ent));
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

  // 2. Target Entity & Scope Compatibility Check
  if (Array.isArray(targetEntities) && targetEntities.length > 0) {
    const hasTargetEntity = targetEntities.some(ent => isCandidateMatchingTargetEntity(candidate.text, ent));
    if (!hasTargetEntity) {
      return {
        accepted: false,
        disposition: 'REJECT_ENTITY_MISMATCH',
        reason: 'evidence_does_not_contain_target_entity'
      };
    }
  }

  // 3. Aspect Compatibility & Ownership Check
  const providedAspects = [];
  const isFeeChunk = candidate.docCategory === 'BIAYA' ||
    (candidate.source_file && /rincian biaya/i.test(candidate.source_file)) ||
    /\b(biaya|pendidikan per semester|dpp|spp|uang pangkal|waktu pembayaran|pendaftaran \d|dicicil|potongan biaya|angsuran)\b/i.test(text);

  const isCurriculumChunk = /\b(kurikulum|mata\s*kuliah|matkul|sks|semester\s+[ivx\d]+\s+no\s+nama\s+mata\s+kuliah|praktikum)\b/i.test(text);
  const isOverviewChunk = /\b(deskripsi singkat|profil|fokus pada|keahlian dalam bidang|visi|misi|program studi terlihat|penjelasan prodi|peluang kerja|yang dipelajari|perbedaan)\b/i.test(text);
  const isHobbyChunk = /\b(hobi\s*\/\s*aktivitas|aktivitas\s*:\s*bermain game|hobi\s*:)\b/i.test(text);

  if (isFeeChunk) providedAspects.push('fee', 'tuition', 'dpp');
  if (isCurriculumChunk) providedAspects.push('curriculum', 'courses');
  if (isOverviewChunk) providedAspects.push('overview', 'definition', 'curriculum_difference', 'career_prospects');

  // Strict aspect matching against retrievalPlan.requiredAspects
  if (Array.isArray(requiredAspects) && requiredAspects.length > 0 && !requiredAspects.includes('general')) {
    const wantsFee = requiredAspects.some(a => ['fee', 'tuition', 'dpp'].includes(a)) || retrievalPlan.domain === 'TUITION_FEE';
    const wantsCurriculum = requiredAspects.some(a => ['curriculum', 'courses'].includes(a)) || retrievalPlan.domain === 'ACADEMIC_CURRICULUM';
    const wantsOverview = requiredAspects.some(a => ['overview', 'definition', 'curriculum_difference', 'career_prospects'].includes(a));

    if (wantsFee) {
      if (!isFeeChunk) {
        return {
          accepted: false,
          disposition: 'REJECT_ASPECT_MISMATCH',
          reason: 'evidence_does_not_contain_fee_aspect'
        };
      }
    } else if (wantsCurriculum) {
      if (!isCurriculumChunk) {
        return {
          accepted: false,
          disposition: 'REJECT_ASPECT_MISMATCH',
          reason: 'evidence_does_not_contain_curriculum_aspect'
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
        (candidate.source_file && candidate.source_file.includes('SSK-92951'));
      const isPureRevoked = /\b(dicabut dan dinyatakan tidak berlaku)\b/i.test(text) && !text.includes('baik sekali');
      if (!isActiveSK || isPureRevoked) {
        return {
          accepted: false,
          disposition: 'REJECT_TEMPORAL_MISMATCH',
          reason: 'evidence_is_expired_or_revoked_accreditation'
        };
      }
    }

    // Case C: General Current Status Inquiry
    else {
      const isExpired = /\b(telah berakhir|kadaluwarsa|kedaluwarsa|tidak berlaku lagi)\b/i.test(text);
      const hasCurrentMarker = text.includes(String(currentYear)) || 
        text.includes(String(currentYear - 1)) || 
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
  const accepted = [];
  const rejected = [];

  for (const candidate of candidates) {
    const evaluation = evaluateEvidenceCompatibility(candidate, retrievalPlan);
    if (evaluation.accepted) {
      accepted.push({
        ...candidate,
        disposition: evaluation.disposition,
        dispositionReason: evaluation.reason,
        providedAspects: evaluation.providedAspects || []
      });
    } else {
      rejected.push({
        ...candidate,
        disposition: evaluation.disposition,
        dispositionReason: evaluation.reason,
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

  return {
    accepted,
    rejected,
    retrievalPlan,
    hasSupportedEvidence: accepted.length > 0
  };
}

module.exports = {
  evaluateEvidenceCompatibility,
  arbitrateEvidence
};
