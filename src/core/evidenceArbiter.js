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

  // Strict degree isolation (e.g. S1 vs S2/Magister/Pascasarjana)
  if (/^S1\b/i.test(targetEntityStr) && /\b(magister|s2|pascasarjana)\b/i.test(cleanText) && !/\b(s1|sarjana)\b/i.test(cleanText)) {
    return false;
  }
  if (/^S2\b/i.test(targetEntityStr) && !/\b(magister|s2|pascasarjana)\b/i.test(cleanText)) {
    return false;
  }
  if (/^D3\b/i.test(targetEntityStr) && !/\b(d3|diploma|ahli madya)\b/i.test(cleanText)) {
    return false;
  }

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
  const targetTokens = normalizePunctuation(targetEntityStr).split(/\s+/).filter(t => t.length >= 3 && !genericStopwords.has(t));
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
  const isOverviewChunk = /\b(deskripsi singkat|profil|fokus pada|fokus pendidikan|keahlian dalam bidang|visi|misi|program studi terlihat|penjelasan prodi|peluang kerja|yang dipelajari|perbedaan)\b/i.test(text);
  const isCareerChunk = /\b(peluang kerja|prospek karir|profesi lulusan|career center|magang|internship|cdc)\b/i.test(text);
  const isScholarshipChunk = /\b(beasiswa|kip-?kuliah|potongan\s+dpp|keringanan\s+biaya|bantuan\s+dana|skss)\b/i.test(text);
  const isFacilityChunk = /\b(fasilitas|laboratorium|lab\b|perpustakaan|asrama|dormitory|sarana\s+dan\s+prasarana)\b/i.test(text);
  const isOrganizationChunk = /\b(ukm\b|unit\s+kegiatan\s+mahasiswa|organisasi\s+mahasiswa|ormawa|hima\b|himaprodi|senat|balma|ekstrakurikuler)\b/i.test(text);
  const isPmbGeneralChunk = /\b(pmb|pendaftaran\s+mahasiswa\s+baru|jalur\s+pendaftaran|syarat\s+pendaftaran|pmb\.stikom-bali\.ac\.id)\b/i.test(text);
  const isHobbyChunk = /\b(hobi\s*\/\s*aktivitas|aktivitas\s*:\s*bermain game|hobi\s*:)\b/i.test(text);
  const isProgramListChunk = /\b(program\s+studi|program\s+sarjana|jenjang|s1|d3|s2|pilihan\s+program)\b/i.test(text);
  const isStudyModeChunk = /\b(kelas\s+karyawan|kelas\s+sore|kelas\s+reguler|pilihan\s+kelas|kuliah\s+sambil\s+kerja|sambil\s+bekerja|jadwal\s+kuliah|fleksibel|bekerja)\b/i.test(text);
  const isDegreeChunk = /\b(gelar|sarjana\s+komputer|sarjana\s+bisnis|s\.kom|s\.bns|m\.kom|a\.md\.kom)\b/i.test(text);
  const isEsportsChunk = /\b(esport|esports|e-sports|athena|gaming|game)\b/i.test(text);
  const isSportsChunk = /\b(olahraga|futsal|basket|bulutangkis|badminton|fitness|gym)\b/i.test(text);

  if (isFeeChunk) providedAspects.push('fee', 'tuition', 'dpp');
  if (isCurriculumChunk) providedAspects.push('curriculum', 'courses');
  if (isOverviewChunk) providedAspects.push('overview', 'definition', 'curriculum_difference');
  if (isCareerChunk) providedAspects.push('career_prospects');
  if (isScholarshipChunk) providedAspects.push('scholarship', 'discount', 'requirements');
  if (isFacilityChunk) providedAspects.push('facilities', 'lab', 'campus_infrastructure');
  if (isOrganizationChunk) providedAspects.push('student_organization', 'activities', 'ukm');
  if (isPmbGeneralChunk) providedAspects.push('admission_overview', 'procedure', 'admission_pathways');
  if (isProgramListChunk) providedAspects.push('program_list', 'degrees');
  if (isStudyModeChunk) providedAspects.push('class_schedule', 'working_students', 'evening_class');
  if (isDegreeChunk) providedAspects.push('degree_award');
  if (isEsportsChunk) providedAspects.push('esports_gaming');
  if (isSportsChunk) providedAspects.push('sports');

  // Program Overview / Definition: Guard against administrative signature blocks, thesis guide kaprodi lines, or pure institutional history
  if (retrievalPlan.intent === 'PROGRAM_OVERVIEW' || retrievalPlan.intent === 'DEFINITION') {
    const isAdministrativeSignature = /^(?:Ketua Program Studi|Para Ketua Program Studi|Acc Kaprodi|Dosen Pembimbing)\s*[A-Z0-9\-\s\.]*$/i.test(candidate.text.trim()) ||
      (candidate.text.length < 80 && /Ketua Program Studi/i.test(candidate.text));
    if (isAdministrativeSignature) {
      return {
        accepted: false,
        disposition: 'REJECT_ASPECT_MISMATCH',
        reason: 'evidence_is_administrative_signature_not_overview'
      };
    }
    const isInstitutionalHistory = /1\.\s*Sejarah Singkat Institusi/i.test(candidate.text) && !candidate.text.includes('Fokus Pendidikan');
    if (isInstitutionalHistory) {
      return {
        accepted: false,
        disposition: 'REJECT_ASPECT_MISMATCH',
        reason: 'evidence_is_institutional_history_not_program_overview'
      };
    }
    const isPureFeeDocument = (candidate.source_file && /rincian biaya/i.test(candidate.source_file)) && !isOverviewChunk;
    if (isPureFeeDocument) {
      return {
        accepted: false,
        disposition: 'REJECT_ASPECT_MISMATCH',
        reason: 'evidence_from_fee_doc_lacks_overview'
      };
    }
  }

  // PMB domain guard: exclude thesis, yudisium, wisuda, and proposal defense chunks
  if (retrievalPlan.domain === 'PMB') {
    const isThesisOrGraduation = /\b(yudisium|wisuda|tugas\s+akhir|sidang\s+ta|ujian\s+proposal)\b/i.test(text) ||
      (candidate.source_file && /(?:yudisium|wisuda|pedoman\s+ta)/i.test(candidate.source_file));
    if (isThesisOrGraduation) {
      return {
        accepted: false,
        disposition: 'REJECT_ASPECT_MISMATCH',
        reason: 'evidence_is_thesis_or_graduation_not_admission'
      };
    }
  }

  // Strict aspect matching against retrievalPlan.requiredAspects
  if (Array.isArray(requiredAspects) && requiredAspects.length > 0 && !requiredAspects.includes('general')) {
    const wantsFee = requiredAspects.some(a => ['fee', 'tuition', 'dpp'].includes(a)) || retrievalPlan.domain === 'TUITION_FEE';
    const wantsCurriculum = requiredAspects.some(a => ['curriculum', 'courses'].includes(a)) || retrievalPlan.domain === 'ACADEMIC_CURRICULUM';
    const wantsOverview = requiredAspects.some(a => ['overview', 'definition', 'curriculum_difference'].includes(a));
    const wantsScholarship = requiredAspects.some(a => ['scholarship', 'discount'].includes(a)) || retrievalPlan.domain === 'SCHOLARSHIP';
    const wantsFacilities = requiredAspects.some(a => ['facilities', 'lab'].includes(a)) || retrievalPlan.domain === 'FACILITIES';
    const wantsOrg = requiredAspects.some(a => ['student_organization', 'ukm'].includes(a)) || retrievalPlan.domain === 'ORGANIZATION_UKM';
    const wantsPmbGeneral = requiredAspects.some(a => ['admission_overview', 'procedure', 'admission_pathways'].includes(a)) || (retrievalPlan.domain === 'PMB' && (retrievalPlan.intent === 'GENERAL_PMB_INQUIRY' || retrievalPlan.intent === 'ADMISSION_PROCEDURE'));

    if (wantsFee) {
      if (!isFeeChunk) {
        return {
          accepted: false,
          disposition: 'REJECT_ASPECT_MISMATCH',
          reason: 'evidence_does_not_contain_fee_aspect'
        };
      }
    } else if (wantsCurriculum) {
      const isIsoPolicy = /\b(manajemen berkomitmen untuk|kebijakan mutu)\b/i.test(text);
      if (isIsoPolicy || !isCurriculumChunk) {
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
    } else if (wantsFacilities) {
      if (!isFacilityChunk) {
        return {
          accepted: false,
          disposition: 'REJECT_ASPECT_MISMATCH',
          reason: 'evidence_does_not_contain_facility_aspect'
        };
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
      if (!isPmbGeneralChunk && !isFeeChunk && !isScholarshipChunk) {
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

  if (retrievalPlan.intent === 'PROGRAM_OVERVIEW' || retrievalPlan.intent === 'DEFINITION') {
    accepted.sort((a, b) => {
      const aIsAuthoritative = /\b(Penjelasan Prodi|Fokus Pendidikan|Yang Dipelajari|Peluang Kerja|Visi)\b/i.test(a.text);
      const bIsAuthoritative = /\b(Penjelasan Prodi|Fokus Pendidikan|Yang Dipelajari|Peluang Kerja|Visi)\b/i.test(b.text);
      if (aIsAuthoritative && !bIsAuthoritative) return -1;
      if (!aIsAuthoritative && bIsAuthoritative) return 1;
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
