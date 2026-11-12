'use strict';

/**
 * src/core/multiIntentResolver.js
 * 
 * Greenfield Multi-Intent Decomposition Layer.
 * Decomposes compound questions into discrete, independently retrievable SubQueries.
 * 
 * Example:
 * "apa itu GCCP dan apa keuntungannya?"
 * -> SubQuery 1: "apa itu GCCP" (DEFINITION)
 * -> SubQuery 2: "apa keuntungan GCCP" (BENEFIT)
 */

const { resolveSemanticFrame, resolveSemanticFrameAsync, isPrivacyViolationQuery } = require('./semanticFrameResolver');
const { isGenuineEllipsis } = require('./contextResolver');

// Enhanced multi-intent delimiter regex
const MULTI_SPLIT_REGEX = /(?:\s*\?+\s*|,\s*(?:terus|lalu|kemudian|kalau|kalo|bagaimana\s+dengan|gimana\s+dengan)\s+(?:kalau|kalo|untuk|soal|mengenai|yang)?\s*|\s+(?:terus|lalu|kemudian)\s+(?:kalau|kalo|untuk|soal|mengenai)\s+|,\s*(?:dan|serta|plus)\s*|\s+(?:dan|serta|sekaligus|dan juga|plus)\s+(?=(?:apa|bagaimana|gimana|berapa|apakah|kapan|di\s*mana|dimana|adakah|ada\s+(?:beasiswa|program|jurusan|prodi|jalur|biaya)|keuntungan|syarat(?:nya)?|biaya(?:nya)?|rincian(?:nya)?|fasilitas|program|layanan|training|rekrutmen|pembuatan|prosedur|alur|tata\s+cara|kontak(?:nya)?|alamat(?:nya)?|lokasi(?:nya)?|prospek(?:nya)?|peluang|jadwal(?:nya)?|akreditasi(?:nya)?|fakultas(?:nya)?|masuk\s+fakultas|gelar(?:nya)?|masa\s+studi(?:nya)?|total\s+sks|berapa\s+sks|penjelasan|info|informasi|jelaskan|kalau|kalo)\b))/i;

// Shared Predicate Helpers for Multi-Intent & Safety Guardrails (imported from semanticFrameResolver)

function isCompoundCourseBenefitQuery(rawQuery) {
  if (!rawQuery) return false;
  return /\b(?:mata\s*kuliah|matkul|kurikulum|silabus|ai\b|artificial\s+intelligence|kecerdasan\s+buatan)\b.*\b(?:semester\s+berapa\s+dan\s+apa|dan\s+apa\s+manfaat(?:nya)?)\b/i.test(rawQuery);
}

function splitCompoundQueryParts(rawQuery) {
  const query = String(rawQuery || '').trim();
  if (!query) return [];

  const isComparison = /\b(perbedaan|beda|bedanya|banding(?:kan)?|dibandingkan|komparasi|versus|vs)\b/i.test(query) &&
    /\b(dan|serta|dengan)\b/i.test(query) &&
    !/\b(?:dan|serta|dengan)\s+(?:bagaimana|cara|berapa|apa|apakah|kapan|di\s*mana|dimana)\b/i.test(query);
  const isContactCoord = /\b(?:nomor|telepon|telp|wa|whatsapp|hp)\s+(?:dan|serta|plus)\s+(?:kontak|nomor|telepon|wa|whatsapp)\b/i.test(query) ||
    /\bkontak\s+(?:dan|serta|plus)\s+(?:nomor|telepon|wa|whatsapp)\b/i.test(query);
  const isFacilityServiceCoord = (
    /\b(?:fasilitas|sarana)\s+(?:dan|serta)\s+(?:layanan|prasarana|program)\b/i.test(query) ||
    /\b(?:apakah\s+ada|ada\s+gak|ada\s+tidak|tersedia)\s+(?:inkubator(?:\s+bisnis)?|inbis|career\s+center|cdc)\s+(?:dan|serta)\s+(?:apa\s+saja\s+|apa\s+)?(?:layanan|fasilitas|program)(?:nya)?\b/i.test(query)
  ) && !/\b(?:dan|serta)\s+(?:bagaimana|cara|berapa|kapan|di\s*mana|dimana)\b/i.test(query);
  const isSingleClauseRecommendation = /\b(?:saya|aku|anak\s+saya)\b.*\b(?:suka|senang|gemar|tertarik|hobi|minat|passion|ingin\s+kuliah|mau\s+kuliah|bingung)\b/i.test(query) &&
    !/\b(?:berapa|bagaimana\s+cara|kapan|di\s*mana)\b/i.test(query) &&
    (query.match(/\?/g) || []).length <= 1;

  const isMultiAspectAdmissionCoord = /\b(?:syarat(?:nya)?,\s*jadwal(?:nya)?,\s*dan\s*dokumen|jadwal(?:nya)?,\s*syarat(?:nya)?,\s*dan\s*dokumen|syarat(?:nya)?,\s*dokumen(?:nya)?,\s*dan\s*jadwal)\b/i.test(query);
  const isCompoundCourseQuestion = isCompoundCourseBenefitQuery(query);
  const isPrivacyViolationAttempt = isPrivacyViolationQuery(query);

  let parts = [query];
  const commaTopicMatch = query.replace(/\?+$/, '').match(/^(?:sebutkan|jelaskan|tampilkan|berikan|bisa\s+berikan)?\s*(?:ringkasan\s+lengkap\s+tentang\s+)?(.*?)(?:,\s*(?:dan|serta)\s*|\s+(?:dan|serta)\s+)([^,]+)$/i);
  if (commaTopicMatch && !isComparison && !isContactCoord && !isFacilityServiceCoord && !isMultiAspectAdmissionCoord && !isSingleClauseRecommendation) {
    const listPart = commaTopicMatch[1];
    const lastPart = commaTopicMatch[2].trim();
    const items = listPart.split(',').map(s => s.trim()).filter(Boolean);
    if (items.length >= 2) {
      const campusTopics = /\b(?:prodi|program\s*studi|jurusan|biaya|spp|dpp|uang\s*kuliah|kontak|pmb|beasiswa|prospek\s*kerja|jadwal|syarat)\b/i;
      const allLookLikeTopics = items.every(it => campusTopics.test(it)) && campusTopics.test(lastPart);
      if (allLookLikeTopics) {
        parts = [...items, lastPart];
      }
    }
  }

  if (parts.length === 1 && !isComparison && !isContactCoord && !isFacilityServiceCoord && !isSingleClauseRecommendation && !isMultiAspectAdmissionCoord && !isPrivacyViolationAttempt && !isCompoundCourseQuestion && MULTI_SPLIT_REGEX.test(query)) {
    parts = query.split(MULTI_SPLIT_REGEX).map(p => p.trim()).filter(Boolean);
  }

  // Guard against splitting compound noun phrases
  if (parts.length >= 2 && parts[0].split(/\s+/).length < 3 && !/\b(apa|berapa|bagaimana|gimana|kapan|apakah|ada|di\s*mana|dimana|halo|hai)\b/i.test(parts[0])) {
    parts = [query];
  }

  // Guard against splitting single-sentence multi-attribute queries that share a trailing program entity
  // e.g. "Berapa biaya kuliah dan akreditasi S1 Sistem Informasi?"
  // or "Berapa biaya kuliah, bagaimana akreditasinya, mata kuliah apa saja yang dipelajari, dan bagaimana peluang kerja lulusan S1 Sistem Informasi?"
  if (parts.length >= 2 && (query.match(/\?/g) || []).length <= 1) {
    const { matchCanonicalEntities } = require('../engine/canonicalEntityRegistry');
    const earlierParts = parts.slice(0, -1);
    const lastPart = parts[parts.length - 1];
    const earlierHasSpecificEntity = earlierParts.some(p =>
      (matchCanonicalEntities(p.toLowerCase()) || []).some(e => e.canonical !== 'Kampus ITB STIKOM Bali') ||
      /\b(?:renon|jimbaran|abiansemal)\b/i.test(p)
    );
    const lastEntities = (matchCanonicalEntities(lastPart.toLowerCase()) || []).filter(e => e.canonical !== 'Kampus ITB STIKOM Bali');
    const lastHasProgramEntity = lastEntities.some(e => e.family === 'academic_program' || e.type === 'program' || e.type === 'academic_program' || e.type === 'international_program');
    const part1StartsWithInterrogative = /^(?:apa|bagaimana|gimana|berapa|apakah|kapan|di\s*mana|dimana|adakah|siapa|boleh|bisa|kalau|kalo|terus|lalu)\b/i.test(lastPart.trim());
    const programAttributePattern = /\b(?:biaya|spp|dpp|uang\s*kuliah|tarif|ukt|akreditasi|terakreditasi|kurikulum|mata\s*kuliah|matkul|yang\s+dipelajari|belajar\s+apa|sks|beban\s+studi|prospek|peluang\s+(?:kerja|kar(?:i)?er)|profesi\s+lulusan|fakultas|gelar|masa\s+studi|lama\s+studi|durasi\s+studi|kelas\s+(?:sore|karyawan|malam|reguler)|kuliah\s+(?:sore|malam|sambil\s+kerja))\b/i;
    const allPartsAreProgramAttributes = parts.every(p => programAttributePattern.test(p)) &&
      !earlierParts.some(p => /\b(?:syarat\s+(?:daftar|pendaftaran|masuk)|cara\s+daftar|alur\s+pendaftaran|jadwal\s+(?:pmb|pendaftaran)|nomor\s+wa|whatsapp|alamat\s+kampus|lokasi\s+kampus)\b/i.test(p));

    if (!earlierHasSpecificEntity && lastEntities.length >= 1 && (
      (parts.length === 2 && !part1StartsWithInterrogative) ||
      (lastHasProgramEntity && allPartsAreProgramAttributes)
    )) {
      parts = [query];
    }
  }

  // Guard against false splitting of coordinated noun phrases that share a trailing domain qualifier
  // e.g. "Bagaimana alur dan syarat pendaftaran mahasiswa baru ITB STIKOM Bali?"
  // where parts[0] ("Bagaimana alur") loses its shared object and would misclassify as OUT_OF_DOMAIN.
  if (parts.length >= 2 && (query.match(/\?/g) || []).length <= 1) {
    const firstFrame = resolveSemanticFrame(parts[0], {});
    const lastFrame = resolveSemanticFrame(parts[parts.length - 1], {});
    const secondStartsWithInterrogative = /^(?:apa|bagaimana|gimana|berapa|apakah|kapan|di\s*mana|dimana|adakah|siapa|boleh|bisa|kalau|kalo|terus|lalu)\b/i.test(parts[1].trim());
    if (firstFrame.domain === 'OUT_OF_DOMAIN' && lastFrame.domain !== 'OUT_OF_DOMAIN' && !secondStartsWithInterrogative) {
      parts = [query];
    }
  }

  return parts;
}

function hasMultipleIntents(rawQuery) {
  if (!rawQuery) return false;
  return splitCompoundQueryParts(rawQuery).length > 1;
}

function hasAnaphoricReference(part = '') {
  return /\b\w+nya\b/i.test(part) ||
    /\b(?:tersebut|itu|di\s+atas|tadi|ini)\b/i.test(part) ||
    isGenuineEllipsis(part) ||
    /\b(?:keuntungan|keunggulan|syarat(?:nya)?|biaya(?:nya)?|prospek(?:nya)?|peluang\s+kerja|kurikulum|mata\s*kuliah|matkul|akreditasi(?:nya)?|fakultas(?:\s+apa)?|masuk\s+fakultas|gelar(?:\s+apa)?|masa\s+studi|lama\s+studi|durasi\s+studi|total\s+sks|berapa\s+sks|beban\s+studi|fasilitas(?:nya)?|layanan(?:nya)?|cicil(?:an)?|di?angsur(?:an)?|kontak(?:nya)?)\b/i.test(part);
}

function pruneGenericInstitutionalCampus(frame) {
  if (!frame || !Array.isArray(frame.entities)) return;
  const hasSpecificBranch = frame.entities.some(e =>
    (e.family === 'campus_location' || e.type === 'campus') &&
    e.canonical !== 'Kampus ITB STIKOM Bali'
  );
  if (hasSpecificBranch) {
    frame.entities = frame.entities.filter(e => e.canonical !== 'Kampus ITB STIKOM Bali');
  }
}

function classifyFollowupEntityFamilies(partFrame) {
  const aspects = new Set((partFrame?.aspects || []).map(aspect => String(aspect).toLowerCase()));
  const domain = String(partFrame?.domain || '').toUpperCase();

  if (domain === 'FACILITIES' || domain === 'CAMPUS_SERVICE' ||
      ['location', 'campus_location', 'address', 'facilities', 'facility'].some(aspect => aspects.has(aspect))) {
    return new Set(['campus_location', 'facility', 'campus_facility', 'campus_service']);
  }
  if (domain === 'ORGANIZATION_UKM' ||
      ['organization', 'student_organization', 'ukm', 'sports', 'arts_culture'].some(aspect => aspects.has(aspect))) {
    return new Set(['student_organization']);
  }
  if (['ACADEMIC_PROGRAM', 'ACADEMIC_CURRICULUM', 'TUITION_FEE', 'SCHOLARSHIP',
    'ACCREDITATION', 'ACADEMIC_RECOMMENDATION', 'INTERNATIONAL'].includes(domain) ||
      ['curriculum', 'courses', 'fee', 'tuition', 'dpp', 'career', 'career_prospects',
        'accreditation', 'requirements', 'scholarship', 'study_duration', 'degree_award', 'faculty', 'academic_structure'].some(aspect => aspects.has(aspect))) {
    return new Set(['academic_program', 'international_program']);
  }

  // A general anaphoric follow-up may refer to any entity, but only when its
  // antecedent is unique in the immediately preceding compatible clause.
  return null;
}

function resolveCompatibleAntecedent(part, subFrames, idx) {
  if (!hasAnaphoricReference(part)) return null;

  // Classify the current subquery in isolation. Never infer compatibility from
  // fixed question-wording lists or from whichever entity happens to be first.
  const partFrame = resolveSemanticFrame(part, {});
  const allowedFamilies = classifyFollowupEntityFamilies(partFrame);

  for (let prevIdx = idx - 1; prevIdx >= 0; prevIdx--) {
    const previousFrame = subFrames[prevIdx];
    if (!previousFrame) continue;

    // Even if previousFrame has entities and current part switches entity via ellipsis
    // (e.g. "Berapa biaya S1 Sistem Informasi? Kalau yang S1 Bisnis Digital?"),
    // we still carry forward the previousFrame's domain, intent, and aspects!
    if (!Array.isArray(previousFrame.entities) || previousFrame.entities.length === 0) {
      if (isGenuineEllipsis(part) && previousFrame.domain) {
        return {
          entity: null,
          family: null,
          domain: previousFrame.domain,
          intent: previousFrame.intent || null,
          aspects: previousFrame.aspects || [],
          lastQuery: previousFrame.rawQuery || null,
          academicLevel: previousFrame.academicLevel || null,
          academicYear: previousFrame.temporal?.academicYear || null
        };
      }
      continue;
    }

    const compatible = new Map();
    for (const candidate of previousFrame.entities) {
      const family = candidate?.family || (candidate?.type === 'program' ? 'academic_program' : null);
      if (allowedFamilies && !allowedFamilies.has(family)) continue;
      const canonical = candidate?.canonical || candidate?.name;
      if (canonical) compatible.set(String(canonical).toLowerCase(), candidate);
    }

    if (compatible.size === 1) {
      const entity = [...compatible.values()][0];
      return {
        entity: entity.canonical || entity.name,
        family: entity.family || (entity.type === 'program' ? 'academic_program' : null),
        domain: previousFrame.domain,
        intent: previousFrame.intent || null,
        aspects: previousFrame.aspects || [],
        lastQuery: previousFrame.rawQuery || null,
        academicLevel: previousFrame.academicLevel || null,
        academicYear: previousFrame.temporal?.academicYear || null
      };
    }
    if (compatible.size > 1) return null;
  }

  return null;
}

function buildSubQuerySessionData(sessionData = {}, compatibleAntecedent = null) {
  // Each subquery starts without stale context from the conversation before this
  // compound turn. Only a uniquely resolved antecedent from an earlier clause may
  // be carried forward.
  const isolated = {
    ...sessionData,
    activeEntity: null,
    activeEntities: null,
    activeDomain: null,
    activeIntent: null,
    activeAspects: null,
    activeAcademicLevel: null,
    activeCategory: null,
    preservedBackgroundEntity: null,
    lastAcademicProgramEntity: null,
    academicLevel: null,
    academicYear: null,
    lastQuery: null,
    lastAnswer: null,
    conversationHistory: [],
    history: []
  };

  if (compatibleAntecedent) {
    isolated.activeDomain = compatibleAntecedent.domain || null;
    isolated.activeIntent = compatibleAntecedent.intent || null;
    isolated.activeAspects = compatibleAntecedent.aspects || [];
    isolated.lastQuery = compatibleAntecedent.lastQuery || null;
    if (compatibleAntecedent.entity) {
      isolated.activeEntity = compatibleAntecedent.entity;
      isolated.activeEntities = [compatibleAntecedent.entity];
      isolated.preservedBackgroundEntity = compatibleAntecedent.entity;

      const isAcademic = compatibleAntecedent.family === 'academic_program' ||
        compatibleAntecedent.family === 'international_program';
      isolated.lastAcademicProgramEntity = isAcademic ? compatibleAntecedent.entity : null;
      isolated.activeAcademicLevel = compatibleAntecedent.academicLevel || null;
      isolated.academicLevel = compatibleAntecedent.academicLevel || null;
      isolated.academicYear = compatibleAntecedent.academicYear || null;
    }
  }
  return isolated;
}

function propagateTrailingProgramEntity(subFrames, parts) {
  if (!Array.isArray(subFrames) || subFrames.length < 2) return;
  const lastFrame = subFrames[subFrames.length - 1];
  const trailingPrograms = (lastFrame?.entities || []).filter(
    e => e && (e.family === 'academic_program' || e.family === 'international_program' || e.type === 'program')
  );
  if (trailingPrograms.length !== 1) return;

  const prog = trailingPrograms[0];
  const SCOPED_DOMAINS = new Set(['TUITION_FEE', 'ACADEMIC_CURRICULUM', 'ACADEMIC_PROGRAM']);

  for (let i = 0; i < subFrames.length - 1; i++) {
    const f = subFrames[i];
    if (!f || !SCOPED_DOMAINS.has(f.domain)) continue;
    if (Array.isArray(f.entities) && f.entities.length > 0) continue;
    if (Array.isArray(f.targetEntities) && f.targetEntities.some(
      te => te && (typeof te === 'string' ? te : (te.canonical || te.name)) !== prog.canonical
    )) continue;
    if (Array.isArray(f.excludedEntities) && f.excludedEntities.includes(prog.canonical)) continue;
    if (/\b(?:semua|seluruh|umum)\b/i.test(parts[i] || f.rawQuery || '')) continue;

    const entityObj = {
      canonical: prog.canonical,
      type: prog.type || 'program',
      family: prog.family || 'academic_program'
    };
    f.entities = [entityObj];
    f.targetEntities = [entityObj];
    f.academicLevel = f.academicLevel || lastFrame.academicLevel || null;
    if (f.constraints && !f.constraints.academicLevel && f.academicLevel) {
      f.constraints = { ...f.constraints, academicLevel: f.academicLevel };
    }
    if (!f.entityResolutionStatus || f.entityResolutionStatus === 'UNRESOLVED') {
      f.entityResolutionStatus = 'RESOLVED';
    }
    if (Array.isArray(f.structuredInformationNeeds)) {
      f.structuredInformationNeeds = f.structuredInformationNeeds.map(need => {
        if (!need || need.entity) return need;
        const needDomain = need.domain || f.domain;
        if (!SCOPED_DOMAINS.has(needDomain)) return need;
        return {
          ...need,
          id: `${prog.canonical}::${need.attribute || 'general'}`,
          entity: prog.canonical,
          academicLevel: need.academicLevel || f.academicLevel || null
        };
      });
    }
  }
}

/**
 * Synchronous query decomposition (for deterministic tests and baseline compatibility)
 */
function decomposeQuery(rawQuery, sessionData = {}) {
  const query = String(rawQuery || '').trim();
  if (!query) return [];

  const parts = splitCompoundQueryParts(query);

  if (parts.length <= 1) {
    const singleFrame = resolveSemanticFrame(query, sessionData);
    pruneGenericInstitutionalCampus(singleFrame);
    return [singleFrame];
  }

  const subFrames = [];

  for (let idx = 0; idx < parts.length; idx++) {
    const part = parts[idx];
    const compatibleAntecedent = idx > 0
      ? resolveCompatibleAntecedent(part, subFrames, idx)
      : null;
    const subSessionData = idx > 0
      ? buildSubQuerySessionData(sessionData, compatibleAntecedent)
      : { ...sessionData };

    const frame = resolveSemanticFrame(part, subSessionData);
    pruneGenericInstitutionalCampus(frame);
    subFrames.push(frame);
  }

  propagateTrailingProgramEntity(subFrames, parts);
  return subFrames;
}

/**
 * Asynchronous query decomposition leveraging AI semantic frame resolution
 */
async function decomposeQueryAsync(rawQuery, sessionData = {}, options = {}) {
  const query = String(rawQuery || '').trim();
  if (!query) return [];

  const parts = splitCompoundQueryParts(query);

  if (parts.length <= 1) {
    const singleFrame = (typeof resolveSemanticFrameAsync === 'function')
      ? await resolveSemanticFrameAsync(query, sessionData, options)
      : resolveSemanticFrame(query, sessionData, options);
    pruneGenericInstitutionalCampus(singleFrame);
    return [singleFrame];
  }

  const subFrames = [];

  for (let idx = 0; idx < parts.length; idx++) {
    const part = parts[idx];
    const compatibleAntecedent = idx > 0
      ? resolveCompatibleAntecedent(part, subFrames, idx)
      : null;
    const subSessionData = idx > 0
      ? buildSubQuerySessionData(sessionData, compatibleAntecedent)
      : { ...sessionData };

    const frame = (typeof resolveSemanticFrameAsync === 'function')
      ? await resolveSemanticFrameAsync(part, subSessionData, options)
      : resolveSemanticFrame(part, subSessionData, options);
    pruneGenericInstitutionalCampus(frame);
    subFrames.push(frame);
  }

  propagateTrailingProgramEntity(subFrames, parts);
  return subFrames;
}

module.exports = {
  hasMultipleIntents,
  decomposeQuery,
  decomposeQueryAsync,
  hasAnaphoricReference
};
