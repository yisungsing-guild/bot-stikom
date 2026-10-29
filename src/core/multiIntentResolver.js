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

// Conjunction separators indicating multi-intent
const MULTI_INTENT_CONJUNCTION_REGEX = /(?:,\s*(?:serta|dan|plus)\s*|\s+(?:dan|serta|sekaligus|dan juga|plus)\s+(?=apa|bagaimana|berapa|apakah|kapan|keuntungan|syarat|biaya|fasilitas|training|rekrutmen|pembuatan|prosedur|kontak|prospek|peluang|beasiswa|ada\s+beasiswa))/i;

function hasMultipleIntents(rawQuery) {
  if (!rawQuery) return false;
  return MULTI_INTENT_CONJUNCTION_REGEX.test(rawQuery) || /\?.*\?/.test(rawQuery);
}

/**
 * Synchronous query decomposition (for deterministic tests and baseline compatibility)
 */
function decomposeQuery(rawQuery, sessionData = {}) {
  const query = String(rawQuery || '').trim();
  if (!query) return [];

  let parts = [];
  if (/\?.*\?/.test(query)) {
    parts = query.split('?').map(p => p.trim()).filter(Boolean).map(p => p + '?');
  } else if (MULTI_INTENT_CONJUNCTION_REGEX.test(query)) {
    const rawParts = query.split(MULTI_INTENT_CONJUNCTION_REGEX).map(p => p.trim()).filter(Boolean);
    // Guard against splitting compound contact phrases (e.g. "Berapa nomor telepon dan kontak resmi...")
    const isContactCoordination = /\b(?:nomor|telepon|telp|wa|whatsapp|hp)\s+(?:dan|serta|plus)\s+(?:kontak|nomor|telepon|wa|whatsapp)\b/i.test(query) ||
      /\bkontak\s+(?:dan|serta|plus)\s+(?:nomor|telepon|wa|whatsapp)\b/i.test(query);

    // Guard against splitting compound noun phrases (e.g. "Profesi dan peluang kerja apa saja...")
    // A valid first subquery must have at least 3 words and a verb/interrogative pronoun, or not end as a bare noun fragment
    if (isContactCoordination || (rawParts.length >= 2 && rawParts[0].split(/\s+/).length < 3 && !/\b(apa|berapa|bagaimana|kapan|apakah|ada)\b/i.test(rawParts[0]))) {
      parts = [query];
    } else {
      parts = rawParts;
    }
  }

  if (parts.length <= 1) {
    const singleFrame = resolveSemanticFrame(query, sessionData);
    return [singleFrame];
  }

  const firstFrame = resolveSemanticFrame(parts[0], sessionData);
  const subjectEntities = firstFrame.entities || [];

  const subFrames = parts.map((part, idx) => {
    let queryToResolve = part;
    if (idx > 0 && subjectEntities.length > 0) {
      const entityName = subjectEntities[0].canonical || subjectEntities[0].name || '';
      if (!queryToResolve.toLowerCase().includes(entityName.toLowerCase())) {
        queryToResolve = `${part} ${entityName}`;
      }
    }

    let subFrame = resolveSemanticFrame(queryToResolve, sessionData);
    if (idx > 0 && subFrame.entities.length === 0 && subjectEntities.length > 0) {
      subFrame.entities = [...subjectEntities];
      if (firstFrame.domain !== 'GENERAL' && subFrame.domain === 'GENERAL') {
        subFrame.domain = firstFrame.domain;
      }
    }
    return subFrame;
  });

  return subFrames;
}

/**
 * Asynchronous query decomposition leveraging AI semantic frame resolution
 */
async function decomposeQueryAsync(rawQuery, sessionData = {}, options = {}) {
  const query = String(rawQuery || '').trim();
  if (!query) return [];

  let parts = [];
  if (/\?.*\?/.test(query)) {
    parts = query.split('?').map(p => p.trim()).filter(Boolean).map(p => p + '?');
  } else if (MULTI_INTENT_CONJUNCTION_REGEX.test(query)) {
    const rawParts = query.split(MULTI_INTENT_CONJUNCTION_REGEX).map(p => p.trim()).filter(Boolean);
    const isContactCoordination = /\b(?:nomor|telepon|telp|wa|whatsapp|hp)\s+(?:dan|serta|plus)\s+(?:kontak|nomor|telepon|wa|whatsapp)\b/i.test(query) ||
      /\bkontak\s+(?:dan|serta|plus)\s+(?:nomor|telepon|wa|whatsapp)\b/i.test(query);

    if (isContactCoordination || (rawParts.length >= 2 && rawParts[0].split(/\s+/).length < 3 && !/\b(apa|berapa|bagaimana|kapan|apakah|ada)\b/i.test(rawParts[0]))) {
      parts = [query];
    } else {
      parts = rawParts;
    }
  }

  if (parts.length <= 1) {
    const singleFrame = (typeof resolveSemanticFrameAsync === 'function')
      ? await resolveSemanticFrameAsync(query, sessionData, options)
      : resolveSemanticFrame(query, sessionData, options);
    return [singleFrame];
  }

  const firstFrame = (typeof resolveSemanticFrameAsync === 'function')
    ? await resolveSemanticFrameAsync(parts[0], sessionData, options)
    : resolveSemanticFrame(parts[0], sessionData, options);
  const subjectEntities = firstFrame.entities || [];

  const subFrames = [firstFrame];
  for (let idx = 1; idx < parts.length; idx++) {
    const part = parts[idx];
    let queryToResolve = part;
    if (subjectEntities.length > 0) {
      const entityName = subjectEntities[0].canonical || subjectEntities[0].name || '';
      if (entityName && !queryToResolve.toLowerCase().includes(entityName.toLowerCase())) {
        queryToResolve = `${part} ${entityName}`;
      }
    }

    let subFrame = (typeof resolveSemanticFrameAsync === 'function')
      ? await resolveSemanticFrameAsync(queryToResolve, sessionData, options)
      : resolveSemanticFrame(queryToResolve, sessionData, options);

    if (subFrame.entities.length === 0 && subjectEntities.length > 0) {
      subFrame.entities = [...subjectEntities];
      if (firstFrame.domain !== 'GENERAL' && subFrame.domain === 'GENERAL') {
        subFrame.domain = firstFrame.domain;
      }
    }
    subFrames.push(subFrame);
  }

  return subFrames;
}

module.exports = {
  hasMultipleIntents,
  decomposeQuery,
  decomposeQueryAsync
};
