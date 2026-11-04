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

const { resolveSemanticFrame, resolveSemanticFrameAsync } = require('./semanticFrameResolver');

// Enhanced multi-intent delimiter regex
const MULTI_SPLIT_REGEX = /(?:\s*\?+\s*|,\s*(?:terus|lalu|kemudian)\s+(?:kalau|untuk|soal|mengenai)?\s*|\s+(?:terus|lalu|kemudian)\s+(?:kalau|untuk|soal|mengenai)\s+|,\s*(?:dan|serta|plus)\s*|\s+(?:dan|serta|sekaligus|dan juga|plus)\s+(?=(?:apa|bagaimana|berapa|apakah|kapan|di\s*mana|dimana|adakah|ada\s+(?:beasiswa|program|jurusan|prodi|jalur|biaya)|keuntungan|syarat(?:nya)?|biaya(?:nya)?|rincian(?:nya)?|fasilitas|program|layanan|training|rekrutmen|pembuatan|prosedur|alur|tata\s+cara|kontak|alamat|lokasi|prospek(?:nya)?|peluang|jadwal(?:nya)?|akreditasi(?:nya)?|penjelasan|info|informasi|jelaskan)\b))/i;

function hasMultipleIntents(rawQuery) {
  if (!rawQuery) return false;
  const isComparison = /\b(perbedaan|beda|bedanya|banding(?:kan)?|dibandingkan|komparasi|versus|vs)\b/i.test(rawQuery) &&
    /\b(dan|serta|dengan)\b/i.test(rawQuery) &&
    !/\b(?:dan|serta|dengan)\s+(?:bagaimana|cara|berapa|apa|apakah|kapan|di\s*mana|dimana)\b/i.test(rawQuery);
  const isContactCoord = /\b(?:nomor|telepon|telp|wa|whatsapp|hp)\s+(?:dan|serta|plus)\s+(?:kontak|nomor|telepon|wa|whatsapp)\b/i.test(rawQuery) ||
    /\bkontak\s+(?:dan|serta|plus)\s+(?:nomor|telepon|wa|whatsapp)\b/i.test(rawQuery);
  const isFacilityServiceCoord = (
    /\b(?:fasilitas|sarana)\s+(?:dan|serta)\s+(?:layanan|prasarana|program)\b/i.test(rawQuery) ||
    /\b(?:apakah\s+ada|ada\s+gak|ada\s+tidak|tersedia)\s+(?:inkubator(?:\s+bisnis)?|inbis|career\s+center|cdc)\s+(?:dan|serta)\s+(?:apa\s+saja\s+|apa\s+)?(?:layanan|fasilitas|program)(?:nya)?\b/i.test(rawQuery)
  ) && !/\b(?:dan|serta)\s+(?:bagaimana|cara|berapa|kapan|di\s*mana|dimana)\b/i.test(rawQuery);
  const isMultiAspectAdmissionCoord = /\b(?:syarat(?:nya)?,\s*jadwal(?:nya)?,\s*dan\s*dokumen|jadwal(?:nya)?,\s*syarat(?:nya)?,\s*dan\s*dokumen|syarat(?:nya)?,\s*dokumen(?:nya)?,\s*dan\s*jadwal)\b/i.test(rawQuery);
  if (isComparison || isContactCoord || isFacilityServiceCoord || isMultiAspectAdmissionCoord) return false;

  return MULTI_SPLIT_REGEX.test(rawQuery);
}

function hasAnaphoricReference(part = '') {
  return /\b\w+nya\b/i.test(part) ||
    /\b(?:tersebut|itu|di\s+atas|tadi|ini)\b/i.test(part) ||
    /\b(?:keuntungan|keunggulan|syarat(?:nya)?|biaya(?:nya)?|prospek(?:nya)?|peluang\s+kerja|kurikulum|mata\s*kuliah|matkul|akreditasi(?:nya)?|fasilitas(?:nya)?|layanan(?:nya)?|cicil(?:an)?|di?angsur(?:an)?)\b/i.test(part);
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
        'accreditation', 'requirements', 'scholarship', 'study_duration', 'degree_award'].some(aspect => aspects.has(aspect))) {
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
    if (!previousFrame || !Array.isArray(previousFrame.entities) || previousFrame.entities.length === 0) continue;

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

  if (compatibleAntecedent?.entity) {
    isolated.activeEntity = compatibleAntecedent.entity;
    isolated.activeEntities = [compatibleAntecedent.entity];
    isolated.activeDomain = compatibleAntecedent.domain || null;
    isolated.preservedBackgroundEntity = compatibleAntecedent.entity;

    const isAcademic = compatibleAntecedent.family === 'academic_program' ||
      compatibleAntecedent.family === 'international_program';
    isolated.lastAcademicProgramEntity = isAcademic ? compatibleAntecedent.entity : null;
    isolated.activeAcademicLevel = compatibleAntecedent.academicLevel || null;
    isolated.academicLevel = compatibleAntecedent.academicLevel || null;
    isolated.academicYear = compatibleAntecedent.academicYear || null;
  }
  return isolated;
}

/**
 * Synchronous query decomposition (for deterministic tests and baseline compatibility)
 */
function decomposeQuery(rawQuery, sessionData = {}) {
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

  const isMultiAspectAdmissionCoord = /\b(?:syarat(?:nya)?,\s*jadwal(?:nya)?,\s*dan\s*dokumen|jadwal(?:nya)?,\s*syarat(?:nya)?,\s*dan\s*dokumen|syarat(?:nya)?,\s*dokumen(?:nya)?,\s*dan\s*jadwal)\b/i.test(query);
  let parts = [query];
  if (!isComparison && !isContactCoord && !isFacilityServiceCoord && !isMultiAspectAdmissionCoord && MULTI_SPLIT_REGEX.test(query)) {
    parts = query.split(MULTI_SPLIT_REGEX).map(p => p.trim()).filter(Boolean);
  }

  // Guard against splitting compound noun phrases
  if (parts.length >= 2 && parts[0].split(/\s+/).length < 3 && !/\b(apa|berapa|bagaimana|kapan|apakah|ada|di\s*mana|dimana)\b/i.test(parts[0])) {
    parts = [query];
  }

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

  return subFrames;
}

/**
 * Asynchronous query decomposition leveraging AI semantic frame resolution
 */
async function decomposeQueryAsync(rawQuery, sessionData = {}, options = {}) {
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
    !/\b(?:berapa|bagaimana\s+cara|kapan|di\s*mana)\b/i.test(query);

  const isMultiAspectAdmissionCoord = /\b(?:syarat(?:nya)?,\s*jadwal(?:nya)?,\s*dan\s*dokumen|jadwal(?:nya)?,\s*syarat(?:nya)?,\s*dan\s*dokumen|syarat(?:nya)?,\s*dokumen(?:nya)?,\s*dan\s*jadwal)\b/i.test(query);
  let parts = [query];
  if (!isComparison && !isContactCoord && !isFacilityServiceCoord && !isSingleClauseRecommendation && !isMultiAspectAdmissionCoord && MULTI_SPLIT_REGEX.test(query)) {
    parts = query.split(MULTI_SPLIT_REGEX).map(p => p.trim()).filter(Boolean);
  }

  if (parts.length >= 2 && parts[0].split(/\s+/).length < 3 && !/\b(apa|berapa|bagaimana|kapan|apakah|ada|di\s*mana|dimana)\b/i.test(parts[0])) {
    parts = [query];
  }

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

  return subFrames;
}

module.exports = {
  hasMultipleIntents,
  decomposeQuery,
  decomposeQueryAsync,
  hasAnaphoricReference
};
