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
const { CAMPUS_WIDE_DOMAINS } = require('../reasoning/contracts');

// Conjunction separators indicating multi-intent
const MULTI_INTENT_CONJUNCTION_REGEX = /(?:,\s*(?:serta|dan|plus)\s*|\s+(?:dan|serta|sekaligus|dan juga|plus)\s+(?=apa|bagaimana|berapa|apakah|kapan|keuntungan|syarat|biaya|fasilitas|training|rekrutmen|pembuatan|prosedur|kontak|prospek|peluang|beasiswa|ada\s+beasiswa|akreditasi|peringkat\s+akreditasi))/i;

function hasMultipleIntents(rawQuery) {
  if (!rawQuery) return false;
  return MULTI_INTENT_CONJUNCTION_REGEX.test(rawQuery) || /\?.*\?/.test(rawQuery);
}

/**
 * Safely isolates session data for subquery resolution without mutating shared objects.
 * Performs targeted cloning of arrays and nested dictionaries without prototype pollution.
 */
function isolateSubquerySession(sessionData = {}) {
  if (!sessionData || typeof sessionData !== 'object') return {};
  const isolated = { ...sessionData };

  // 1. contextHistory: array of turn objects
  if (Array.isArray(sessionData.contextHistory)) {
    isolated.contextHistory = sessionData.contextHistory.map(item => {
      if (typeof item !== 'object' || item === null) return item;
      return {
        ...item,
        entities: Array.isArray(item.entities)
          ? item.entities.map(e => (typeof e === 'object' && e !== null ? { ...e } : e))
          : item.entities,
        activeEntity: (item.activeEntity && typeof item.activeEntity === 'object')
          ? { ...item.activeEntity }
          : item.activeEntity
      };
    });
  }

  // 2. recentEntities: array of entity objects or strings
  if (Array.isArray(sessionData.recentEntities)) {
    isolated.recentEntities = sessionData.recentEntities.map(e =>
      (typeof e === 'object' && e !== null ? { ...e } : e)
    );
  }

  // 3. activeEntity & preservedBackgroundEntity: single entity objects
  if (sessionData.activeEntity && typeof sessionData.activeEntity === 'object') {
    isolated.activeEntity = { ...sessionData.activeEntity };
  }
  if (sessionData.preservedBackgroundEntity && typeof sessionData.preservedBackgroundEntity === 'object') {
    isolated.preservedBackgroundEntity = { ...sessionData.preservedBackgroundEntity };
  }

  // 4. pendingClarification: clarification context and candidate objects
  if (sessionData.pendingClarification && typeof sessionData.pendingClarification === 'object') {
    isolated.pendingClarification = {
      ...sessionData.pendingClarification,
      candidates: Array.isArray(sessionData.pendingClarification.candidates)
        ? sessionData.pendingClarification.candidates.map(c => (typeof c === 'object' && c !== null ? { ...c } : c))
        : sessionData.pendingClarification.candidates,
      options: Array.isArray(sessionData.pendingClarification.options)
        ? [...sessionData.pendingClarification.options]
        : sessionData.pendingClarification.options
    };
  }

  // 5. data: custom session data slots and entities
  if (sessionData.data && typeof sessionData.data === 'object') {
    isolated.data = {
      ...sessionData.data,
      entities: Array.isArray(sessionData.data.entities)
        ? sessionData.data.entities.map(e => (typeof e === 'object' && e !== null ? { ...e } : e))
        : (sessionData.data.entities && typeof sessionData.data.entities === 'object')
          ? { ...sessionData.data.entities }
          : sessionData.data.entities,
      slots: (sessionData.data.slots && typeof sessionData.data.slots === 'object')
        ? { ...sessionData.data.slots }
        : sessionData.data.slots
    };
  }

  // 6. lastRetrievedPrograms: array of program objects
  if (Array.isArray(sessionData.lastRetrievedPrograms)) {
    isolated.lastRetrievedPrograms = sessionData.lastRetrievedPrograms.map(p =>
      (typeof p === 'object' && p !== null ? { ...p } : p)
    );
  }

  return isolated;
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
    const isMultiIntentPair = (/\bbiaya\b/i.test(query) && /\bakreditasi\b/i.test(query)) ||
      (/\b(syarat|fasilitas|beasiswa)\b/i.test(query) && /\b(biaya|akreditasi)\b/i.test(query));
    // Guard against splitting compound noun phrases (e.g. "Profesi dan peluang kerja apa saja...")
    // A valid first subquery must have at least 3 words and a verb/interrogative pronoun, or not end as a bare noun fragment
    if (!isMultiIntentPair && rawParts.length >= 2 && rawParts[0].split(/\s+/).length < 3 && !/\b(apa|berapa|bagaimana|kapan|apakah|ada)\b/i.test(rawParts[0])) {
      parts = [query];
    } else {
      parts = rawParts;
    }
  }

  if (parts.length <= 1) {
    const singleFrame = resolveSemanticFrame(query, sessionData);
    return [singleFrame];
  }

  const firstSessionData = isolateSubquerySession(sessionData);
  let firstFrame = resolveSemanticFrame(parts[0], firstSessionData);
  let subjectEntities = firstFrame.entities || [];
  if (subjectEntities.length === 0) {
    const fullFrame = resolveSemanticFrame(query, sessionData);
    if (fullFrame.entities && fullFrame.entities.length > 0) {
      subjectEntities = fullFrame.entities;
    }
  }
  const topicMatch = (query || '').match(/\b(double\s*degree|dual\s*degree|student\s*exchange|pertukaran\s*(?:pelajar|mahasiswa)|beasiswa|fasilitas)\b/i);
  const inferredTopic = (subjectEntities.length > 0 && (subjectEntities[0].canonical || subjectEntities[0].name)) ||
    (topicMatch ? topicMatch[0] : null) ||
    (sessionData && sessionData.activeEntity ? (typeof sessionData.activeEntity === 'string' ? sessionData.activeEntity : sessionData.activeEntity.canonical || sessionData.activeEntity.name) : null);

  // If first subquery lacked entity but entity exists in whole query / other subquery, re-resolve firstFrame with inferred topic
  if (inferredTopic && (!firstFrame.entities || firstFrame.entities.length === 0)) {
    let reResolvedQuery = parts[0];
    if (!reResolvedQuery.toLowerCase().includes(inferredTopic.toLowerCase())) {
      reResolvedQuery = `${parts[0]} ${inferredTopic}`;
    }
    firstFrame = resolveSemanticFrame(reResolvedQuery, firstSessionData);
    if ((!firstFrame.entities || firstFrame.entities.length === 0) && subjectEntities.length > 0) {
      firstFrame.entities = [...subjectEntities];
    }
  }

  const subFrames = parts.map((part, idx) => {
    let queryToResolve = part;
    const hasExplicitAnaphora = /\b(?:nya|tersebut|itu|ini)\b/i.test(part) || /\b(?:program|jurusan|prodi)\s+(?:ini|tersebut)\b/i.test(part);
    const isCampusAssetSubject = /\b(?:fasilitas|laboratorium|lab|perpustakaan|asrama|parkir|ukm|ormawa|organisasi|beasiswa|lokasi|alamat|gedung|kantin)\b/i.test(part);
    const isIndependentPmbSchedule = /\b(?:gelombang|buka\s+gelombang|jadwal\s+pmb|periode\s+pmb|kapan\s+buka|kapan\s+tutup)\b/i.test(part) && !hasExplicitAnaphora;
    const isIndependentSubject = isCampusAssetSubject || isIndependentPmbSchedule;
    const isAnaphoric = hasExplicitAnaphora || /^(?:kalau|bagaimana|dan|lalu|apa|apakah|adakah|ada|berapa|syarat|biaya|jadwal|akreditasi)\b/i.test(part.trim());

    if (idx > 0 && inferredTopic && !isIndependentSubject && isAnaphoric) {
      const inferredLower = inferredTopic.toLowerCase();
      const partLower = part.toLowerCase();
      const hasCoreMention = partLower.includes(inferredLower) ||
        (inferredLower.includes('teknologi informasi') && partLower.includes('teknologi informasi')) ||
        (inferredLower.includes('sistem informasi') && partLower.includes('sistem informasi')) ||
        (inferredLower.includes('sistem komputer') && partLower.includes('sistem komputer')) ||
        (inferredLower.includes('bisnis digital') && partLower.includes('bisnis digital'));

      if (!hasCoreMention) {
        queryToResolve = `${part} ${inferredTopic}`;
      } else if (!partLower.includes('s1') && inferredLower.startsWith('s1 ')) {
        queryToResolve = part.replace(/\b(teknologi informasi|sistem informasi|sistem komputer|bisnis digital)\b/i, 'S1 $1');
      }
    }

    const subSessionData = isolateSubquerySession(sessionData);
    let subFrame = idx === 0 ? firstFrame : resolveSemanticFrame(queryToResolve, subSessionData);
    if (idx > 0) {
      const isNonProdiDomain = ['FACILITIES', 'ORGANIZATION_UKM', 'ORGANIZATION', 'CAMPUS_SERVICE', 'CAMPUS_LIFE', 'CAREER_CENTER', 'SCHOLARSHIP'].includes(subFrame.domain) ||
        (subFrame.domain === 'PMB_SCHEDULE') ||
        (subFrame.intent === 'CURRENT_ENROLLMENT_STATUS');

      if (!isIndependentSubject && !isNonProdiDomain && subFrame.entities.length === 0 && subjectEntities.length > 0) {
        subFrame.entities = [...subjectEntities];
      }
      // Never force subFrame.domain or intent from firstFrame
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
    const isMultiIntentPair = (/\bbiaya\b/i.test(query) && /\bakreditasi\b/i.test(query)) ||
      (/\b(syarat|fasilitas|beasiswa)\b/i.test(query) && /\b(biaya|akreditasi)\b/i.test(query));
    if (!isMultiIntentPair && rawParts.length >= 2 && rawParts[0].split(/\s+/).length < 3 && !/\b(apa|berapa|bagaimana|kapan|apakah|ada)\b/i.test(rawParts[0])) {
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

  const firstSessionData = isolateSubquerySession(sessionData);
  let firstFrame = (typeof resolveSemanticFrameAsync === 'function')
    ? await resolveSemanticFrameAsync(parts[0], firstSessionData, options)
    : resolveSemanticFrame(parts[0], firstSessionData, options);
  let subjectEntities = firstFrame.entities || [];
  if (subjectEntities.length === 0) {
    const fullFrame = (typeof resolveSemanticFrameAsync === 'function')
      ? await resolveSemanticFrameAsync(query, sessionData, options)
      : resolveSemanticFrame(query, sessionData, options);
    if (fullFrame.entities && fullFrame.entities.length > 0) {
      subjectEntities = fullFrame.entities;
    }
  }
  const topicMatch = (query || '').match(/\b(double\s*degree|dual\s*degree|student\s*exchange|pertukaran\s*(?:pelajar|mahasiswa)|beasiswa|fasilitas)\b/i);
  const inferredTopic = (subjectEntities.length > 0 && (subjectEntities[0].canonical || subjectEntities[0].name)) ||
    (topicMatch ? topicMatch[0] : null) ||
    (sessionData && sessionData.activeEntity ? (typeof sessionData.activeEntity === 'string' ? sessionData.activeEntity : sessionData.activeEntity.canonical || sessionData.activeEntity.name) : null);

  // If first subquery lacked entity but entity exists in whole query / other subquery, re-resolve firstFrame with inferred topic
  if (inferredTopic && (!firstFrame.entities || firstFrame.entities.length === 0)) {
    let reResolvedQuery = parts[0];
    if (!reResolvedQuery.toLowerCase().includes(inferredTopic.toLowerCase())) {
      reResolvedQuery = `${parts[0]} ${inferredTopic}`;
    }
    firstFrame = (typeof resolveSemanticFrameAsync === 'function')
      ? await resolveSemanticFrameAsync(reResolvedQuery, firstSessionData, options)
      : resolveSemanticFrame(reResolvedQuery, firstSessionData, options);
    if ((!firstFrame.entities || firstFrame.entities.length === 0) && subjectEntities.length > 0) {
      firstFrame.entities = [...subjectEntities];
    }
  }

  const subFrames = [firstFrame];
  for (let idx = 1; idx < parts.length; idx++) {
    const part = parts[idx];
    let queryToResolve = part;
    const hasExplicitAnaphora = /\b(?:nya|tersebut|itu|ini)\b/i.test(part) || /\b(?:program|jurusan|prodi)\s+(?:ini|tersebut)\b/i.test(part);
    const isCampusAssetSubject = /\b(?:fasilitas|laboratorium|lab|perpustakaan|asrama|parkir|ukm|ormawa|organisasi|beasiswa|lokasi|alamat|gedung|kantin)\b/i.test(part);
    const isIndependentPmbSchedule = /\b(?:gelombang|buka\s+gelombang|jadwal\s+pmb|periode\s+pmb|kapan\s+buka|kapan\s+tutup)\b/i.test(part) && !hasExplicitAnaphora;
    const isIndependentSubject = isCampusAssetSubject || isIndependentPmbSchedule;
    const isAnaphoric = hasExplicitAnaphora || /^(?:kalau|bagaimana|dan|lalu|apa|apakah|adakah|ada|berapa|syarat|biaya|jadwal|akreditasi)\b/i.test(part.trim());

    if (inferredTopic && !isIndependentSubject && isAnaphoric) {
      const inferredLower = inferredTopic.toLowerCase();
      const partLower = part.toLowerCase();
      const hasCoreMention = partLower.includes(inferredLower) ||
        (inferredLower.includes('teknologi informasi') && partLower.includes('teknologi informasi')) ||
        (inferredLower.includes('sistem informasi') && partLower.includes('sistem informasi')) ||
        (inferredLower.includes('sistem komputer') && partLower.includes('sistem komputer')) ||
        (inferredLower.includes('bisnis digital') && partLower.includes('bisnis digital'));

      if (!hasCoreMention) {
        queryToResolve = `${part} ${inferredTopic}`;
      } else if (!partLower.includes('s1') && inferredLower.startsWith('s1 ')) {
        queryToResolve = part.replace(/\b(teknologi informasi|sistem informasi|sistem komputer|bisnis digital)\b/i, 'S1 $1');
      }
    }

    const subSessionData = isolateSubquerySession(sessionData);
    let subFrame = (typeof resolveSemanticFrameAsync === 'function')
      ? await resolveSemanticFrameAsync(queryToResolve, subSessionData, options)
      : resolveSemanticFrame(queryToResolve, subSessionData, options);

    const isNonProdiDomain = ['FACILITIES', 'ORGANIZATION_UKM', 'ORGANIZATION', 'CAMPUS_SERVICE', 'CAMPUS_LIFE', 'CAREER_CENTER', 'SCHOLARSHIP'].includes(subFrame.domain) ||
      (subFrame.domain === 'PMB_SCHEDULE') ||
      (subFrame.intent === 'CURRENT_ENROLLMENT_STATUS');

    if (!isIndependentSubject && !isNonProdiDomain && subFrame.entities.length === 0 && subjectEntities.length > 0) {
      subFrame.entities = [...subjectEntities];
    }
    // Never force subFrame.domain or intent from firstFrame
    subFrames.push(subFrame);
  }

  return subFrames;
}

module.exports = {
  hasMultipleIntents,
  decomposeQuery,
  decomposeQueryAsync,
  isolateSubquerySession
};
