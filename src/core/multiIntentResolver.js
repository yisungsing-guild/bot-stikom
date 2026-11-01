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
    !/\b(?:dan|serta|dengan)\s+(?:bagaimana|cara|berapa|apa|apakah|kapan|di\s*mana|dimana)\b/i.test(rawQuery) &&
    !/,\s*(?:dan|serta)\s+/i.test(rawQuery);
  const isContactCoord = /\b(?:nomor|telepon|telp|wa|whatsapp|hp)\s+(?:dan|serta|plus)\s+(?:kontak|nomor|telepon|wa|whatsapp)\b/i.test(rawQuery) ||
    /\bkontak\s+(?:dan|serta|plus)\s+(?:nomor|telepon|wa|whatsapp)\b/i.test(rawQuery);
  const isFacilityServiceCoord = /\b(?:fasilitas|sarana)\s+(?:dan|serta)\s+(?:layanan|prasarana|program)\b/i.test(rawQuery) &&
    !/\b(?:dan|serta)\s+(?:bagaimana|cara|berapa|apa|apakah|kapan|di\s*mana|dimana)\b/i.test(rawQuery);
  if (isComparison || isContactCoord || isFacilityServiceCoord) return false;

  return MULTI_SPLIT_REGEX.test(rawQuery);
}

function hasAnaphoricReference(part = '') {
  return /\b\w+nya\b/i.test(part) ||
    /\b(?:tersebut|itu|di\s+atas|tadi|ini)\b/i.test(part) ||
    /\b(?:keuntungan|keunggulan|syarat(?:nya)?|biaya(?:nya)?|prospek(?:nya)?|peluang\s+kerja|kurikulum|mata\s*kuliah|matkul|akreditasi(?:nya)?|fasilitas(?:nya)?|layanan(?:nya)?)\b/i.test(part);
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

function resolveCompatibleAntecedent(part, subFrames, idx) {
  if (!hasAnaphoricReference(part)) return null;

  for (let prevIdx = idx - 1; prevIdx >= 0; prevIdx--) {
    const prevFrame = subFrames[prevIdx];
    if (!prevFrame || !Array.isArray(prevFrame.entities) || prevFrame.entities.length === 0) continue;

    const cand = prevFrame.entities[0];
    const candFamily = cand.family;

    const isAcademicPart = /\b(?:biaya|biayanya|prospek|prospeknya|peluang\s+kerja|kurikulum|matkul|mata\s*kuliah|syarat|syaratnya|keunggulan)\b/i.test(part);
    const isAcademicEntity = candFamily === 'academic_program' || candFamily === 'international_program';

    const isCampusPart = /\b(?:fasilitas|fasilitasnya|lab|gedung|ruang|alamat|lokasi)\b/i.test(part);
    const isCampusEntity = candFamily === 'campus_location' || cand.type === 'campus';

    const isGeneralBenefit = /\b(?:keuntungan|manfaat|benefit|layanan)\b/i.test(part);

    if ((isAcademicPart && isAcademicEntity) || (isCampusPart && isCampusEntity) || (isGeneralBenefit && (isAcademicEntity || candFamily === 'campus_service'))) {
      return { entity: cand.canonical, domain: prevFrame.domain };
    }
  }

  return null;
}

/**
 * Synchronous query decomposition (for deterministic tests and baseline compatibility)
 */
function decomposeQuery(rawQuery, sessionData = {}) {
  const query = String(rawQuery || '').trim();
  if (!query) return [];

  const isComparison = /\b(perbedaan|beda|bedanya|banding(?:kan)?|dibandingkan|komparasi|versus|vs)\b/i.test(query) &&
    /\b(dan|serta|dengan)\b/i.test(query) &&
    !/\b(?:dan|serta|dengan)\s+(?:bagaimana|cara|berapa|apa|apakah|kapan|di\s*mana|dimana)\b/i.test(query) &&
    !/,\s*(?:dan|serta)\s+/i.test(query);
  const isContactCoord = /\b(?:nomor|telepon|telp|wa|whatsapp|hp)\s+(?:dan|serta|plus)\s+(?:kontak|nomor|telepon|wa|whatsapp)\b/i.test(query) ||
    /\bkontak\s+(?:dan|serta|plus)\s+(?:nomor|telepon|wa|whatsapp)\b/i.test(query);
  const isFacilityServiceCoord = /\b(?:fasilitas|sarana)\s+(?:dan|serta)\s+(?:layanan|prasarana|program)\b/i.test(query) &&
    !/\b(?:dan|serta)\s+(?:bagaimana|cara|berapa|apa|apakah|kapan|di\s*mana|dimana)\b/i.test(query);

  let parts = [query];
  if (!isComparison && !isContactCoord && !isFacilityServiceCoord && MULTI_SPLIT_REGEX.test(query)) {
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
    let subSessionData = { ...sessionData };

    if (idx > 0) {
      const compatibleAntecedent = resolveCompatibleAntecedent(part, subFrames, idx);
      if (compatibleAntecedent) {
        subSessionData.activeEntity = compatibleAntecedent.entity;
        subSessionData.activeDomain = compatibleAntecedent.domain;
      } else {
        // Enforce strict subquery context isolation
        subSessionData.activeEntity = null;
        subSessionData.activeDomain = null;
      }
    }

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
    !/\b(?:dan|serta|dengan)\s+(?:bagaimana|cara|berapa|apa|apakah|kapan|di\s*mana|dimana)\b/i.test(query) &&
    !/,\s*(?:dan|serta)\s+/i.test(query);
  const isContactCoord = /\b(?:nomor|telepon|telp|wa|whatsapp|hp)\s+(?:dan|serta|plus)\s+(?:kontak|nomor|telepon|wa|whatsapp)\b/i.test(query) ||
    /\bkontak\s+(?:dan|serta|plus)\s+(?:nomor|telepon|wa|whatsapp)\b/i.test(query);
  const isFacilityServiceCoord = /\b(?:fasilitas|sarana)\s+(?:dan|serta)\s+(?:layanan|prasarana|program)\b/i.test(query) &&
    !/\b(?:dan|serta)\s+(?:bagaimana|cara|berapa|apa|apakah|kapan|di\s*mana|dimana)\b/i.test(query);
  const isSingleClauseRecommendation = /\b(?:saya|aku|anak\s+saya)\b.*\b(?:suka|senang|gemar|tertarik|hobi|minat|passion|ingin\s+kuliah|mau\s+kuliah|bingung)\b/i.test(query) &&
    !/\b(?:berapa|bagaimana\s+cara|kapan|di\s*mana)\b/i.test(query);

  let parts = [query];
  if (!isComparison && !isContactCoord && !isFacilityServiceCoord && !isSingleClauseRecommendation && MULTI_SPLIT_REGEX.test(query)) {
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
    let subSessionData = { ...sessionData };

    if (idx > 0) {
      const compatibleAntecedent = resolveCompatibleAntecedent(part, subFrames, idx);
      if (compatibleAntecedent) {
        subSessionData.activeEntity = compatibleAntecedent.entity;
        subSessionData.activeDomain = compatibleAntecedent.domain;
      } else {
        // Enforce strict subquery context isolation
        subSessionData.activeEntity = null;
        subSessionData.activeDomain = null;
      }
    }

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
  decomposeQueryAsync
};
