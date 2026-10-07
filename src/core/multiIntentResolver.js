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

const { resolveSemanticFrame } = require('./semanticFrameResolver');

// Conjunction separators indicating multi-intent
const MULTI_INTENT_CONJUNCTION_REGEX = /(?:,\s*(?:serta|dan|plus)\s*|\s+(?:dan|serta|sekaligus|dan juga|plus)\s+(?=apa|bagaimana|berapa|apakah|kapan|keuntungan|syarat|biaya|fasilitas|training|rekrutmen|pembuatan|prosedur|kontak))/i;

function hasMultipleIntents(rawQuery) {
  if (!rawQuery) return false;
  return MULTI_INTENT_CONJUNCTION_REGEX.test(rawQuery) || /\?.*\?/.test(rawQuery);
}

/**
 * Splits query string into subquery strings and builds individual SemanticFrames
 */
function decomposeQuery(rawQuery, sessionData = {}) {
  const query = String(rawQuery || '').trim();
  if (!query) return [];

  // Check if multiple question marks or explicit conjunctions exist
  let parts = [];
  if (/\?.*\?/.test(query)) {
    parts = query.split('?').map(p => p.trim()).filter(Boolean).map(p => p + '?');
  } else if (MULTI_INTENT_CONJUNCTION_REGEX.test(query)) {
    parts = query.split(MULTI_INTENT_CONJUNCTION_REGEX).map(p => p.trim()).filter(Boolean);
  }

  if (parts.length <= 1) {
    const singleFrame = resolveSemanticFrame(query, sessionData);
    return [singleFrame];
  }

  // Inherit subject entity across parts if one part is elided
  // Example: "apa itu GCCP" (has GCCP) dan "apa keuntungannya" (elided GCCP)
  const firstFrame = resolveSemanticFrame(parts[0], sessionData);
  const subjectEntities = firstFrame.entities || [];

  const subFrames = parts.map((part, idx) => {
    let queryToResolve = part;
    if (idx > 0 && subjectEntities.length > 0) {
      const entityName = subjectEntities[0].canonical || subjectEntities[0].name || '';
      // If the part is an elided question like "apa keuntungannya", append the entity
      if (!queryToResolve.toLowerCase().includes(entityName.toLowerCase())) {
        queryToResolve = `${part} ${entityName}`;
      }
    }

    let subFrame = resolveSemanticFrame(queryToResolve, sessionData);
    // Ensure entities are attached
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

module.exports = {
  hasMultipleIntents,
  decomposeQuery
};
