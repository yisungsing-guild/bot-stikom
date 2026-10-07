'use strict';

const crypto = require('crypto');
const {
  COMPARISON_GLOBAL_STATE,
  ASPECT_ALIGNMENT_STATUS,
  COMPARISON_DELTA_TYPE,
  COMPARISON_DIAGNOSTIC_CODE,
  COMPARISON_TEMPLATE_ID,
  GLOBAL_STATUS_HEADER_CODE,
  PRESENTATION_NOTICE_CODE,
  COMPARATIVE_TRANSPORT_VALIDATION_CODE,
  ASPECT_COMPARATOR_REGISTRY,
  COMPUTATION_STATE,
  isFiniteJSONSafe
} = require('./contracts');

/**
 * Deterministic Unicode Code-Point String Comparator.
 * Compares character by character using full Unicode code points (handles surrogate pairs).
 */
function compareCodePoints(strA, strB) {
  const normA = String(strA || '').normalize('NFC');
  const normB = String(strB || '').normalize('NFC');
  if (normA === normB) return 0;

  const charsA = Array.from(normA);
  const charsB = Array.from(normB);
  const minLen = Math.min(charsA.length, charsB.length);

  for (let i = 0; i < minLen; i++) {
    const cpA = charsA[i].codePointAt(0);
    const cpB = charsB[i].codePointAt(0);
    if (cpA !== cpB) {
      return cpA < cpB ? -1 : 1;
    }
  }

  return charsA.length < charsB.length ? -1 : 1;
}

/**
 * Deep equality for StructuredValue (order-independent object keys, index-dependent arrays).
 */
function areStructuredValuesEqual(valA, valB) {
  if (valA === valB) return true;
  if (valA === null || valB === null) return valA === valB;
  if (typeof valA !== typeof valB) return false;

  if (typeof valA !== 'object') {
    if (typeof valA === 'string') {
      return compareCodePoints(valA, valB) === 0;
    }
    return valA === valB;
  }

  if (Array.isArray(valA)) {
    if (!Array.isArray(valB) || valA.length !== valB.length) return false;
    for (let i = 0; i < valA.length; i++) {
      if (!areStructuredValuesEqual(valA[i], valB[i])) return false;
    }
    return true;
  }

  if (Array.isArray(valB)) return false;

  const keysA = Object.keys(valA).sort(compareCodePoints);
  const keysB = Object.keys(valB).sort(compareCodePoints);

  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    if (keysA[i] !== keysB[i]) return false;
    if (!areStructuredValuesEqual(valA[keysA[i]], valB[keysB[i]])) return false;
  }

  return true;
}

/**
 * Formats finite non-negative integer amount to IDR string (e.g. 'Rp 5.000.000').
 */
function formatIdr(amount) {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error('MALFORMED_IDR_VALUE');
  }
  const str = amount.toString(10);
  const formatted = str.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `Rp ${formatted}`;
}

/**
 * Canonical sorting of string arrays by code point.
 */
function canonicalSortStrings(arr) {
  return [...arr].map(s => String(s || '').normalize('NFC')).sort(compareCodePoints);
}

/**
 * Deduplicates and canonical-sorts strings.
 */
function uniqueCanonicalStrings(arr) {
  const set = new Set((arr || []).map(s => String(s || '').normalize('NFC')));
  return Array.from(set).sort(compareCodePoints);
}

/**
 * Canonical JSON serialization for hashing.
 */
function canonicalJson(obj) {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJson).join(',') + ']';
  }
  const keys = Object.keys(obj).sort(compareCodePoints);
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
}

/**
 * Generates full SHA-256 comparisonId with computationState domain separation.
 */
function computeComparisonId(payload) {
  const jsonStr = canonicalJson(payload);
  return crypto.createHash('sha256').update(jsonStr, 'utf8').digest('hex');
}

/**
 * Stage-A Scope & Entity Validation.
 */
function validateScopeAndEntities(comparedEntities, requestedAspects, registeredEntities = null) {
  if (!Array.isArray(comparedEntities) || !Array.isArray(requestedAspects)) {
    return { valid: false, diagnosticCode: COMPARISON_DIAGNOSTIC_CODE.INVALID_SCOPE_OR_ENTITIES };
  }

  for (const ent of comparedEntities) {
    if (typeof ent !== 'string') {
      return { valid: false, diagnosticCode: COMPARISON_DIAGNOSTIC_CODE.INVALID_SCOPE_OR_ENTITIES };
    }
  }
  for (const asp of requestedAspects) {
    if (typeof asp !== 'string') {
      return { valid: false, diagnosticCode: COMPARISON_DIAGNOSTIC_CODE.INVALID_SCOPE_OR_ENTITIES };
    }
  }

  const normEntities = comparedEntities.map(e => e.normalize('NFC'));
  const normAspects = requestedAspects.map(a => a.normalize('NFC'));

  if (normAspects.length === 0 || normAspects.length > 5) {
    return { valid: false, diagnosticCode: COMPARISON_DIAGNOSTIC_CODE.EMPTY_ASPECTS };
  }

  const uniqueAspects = new Set(normAspects);
  if (uniqueAspects.size !== normAspects.length) {
    return { valid: false, diagnosticCode: COMPARISON_DIAGNOSTIC_CODE.EMPTY_ASPECTS };
  }

  if (normEntities.length < 2 || normEntities.length > 3) {
    return { valid: false, diagnosticCode: COMPARISON_DIAGNOSTIC_CODE.ENTITY_COUNT_OUT_OF_BOUNDS };
  }

  const uniqueEntities = new Set(normEntities);
  if (uniqueEntities.size !== normEntities.length) {
    return { valid: false, diagnosticCode: COMPARISON_DIAGNOSTIC_CODE.INVALID_SCOPE_OR_ENTITIES };
  }

  if (registeredEntities && Array.isArray(registeredEntities)) {
    const regMap = new Map();
    for (const reg of registeredEntities) {
      if (reg && reg.canonical) {
        regMap.set(reg.canonical.normalize('NFC'), reg);
      }
    }
    let family = null;
    for (const ent of normEntities) {
      const reg = regMap.get(ent);
      if (!reg) {
        return { valid: false, diagnosticCode: COMPARISON_DIAGNOSTIC_CODE.INVALID_SCOPE_OR_ENTITIES };
      }
      const entFamily = reg.family || reg.type || 'unknown';
      if (family === null) {
        family = entFamily;
      } else if (family !== entFamily) {
        return { valid: false, diagnosticCode: COMPARISON_DIAGNOSTIC_CODE.ENTITY_FAMILY_MISMATCH };
      }
    }
  }

  return { valid: true, comparedEntities: normEntities, requestedAspects: normAspects };
}

/**
 * Builds the ComparisonResultMatrix from validated inputs.
 */
function buildComparisonMatrix({
  comparedEntities,
  requestedAspects,
  factsByEntity = {},
  registeredEntities = null,
  scopedConflicts = [],
  sourceFingerprints = []
}) {
  const stageA = validateScopeAndEntities(comparedEntities, requestedAspects, registeredEntities);
  if (!stageA.valid) {
    const invalidPayload = {
      computationState: COMPUTATION_STATE.INVALID_SCOPE,
      scopeDiagnosticCode: stageA.diagnosticCode,
      contractVersion: 1,
      comparedEntities: Array.isArray(comparedEntities) ? comparedEntities.map(e => String(e || '').normalize('NFC')) : [],
      requestedAspects: Array.isArray(requestedAspects) ? requestedAspects.map(a => String(a || '').normalize('NFC')) : [],
      sourceFingerprints: [],
      scopedConflicts: []
    };
    const invalidId = computeComparisonId(invalidPayload);

    return Object.freeze({
      schemaVersion: 1,
      comparisonId: invalidId,
      computationState: COMPUTATION_STATE.INVALID_SCOPE,
      globalState: COMPARISON_GLOBAL_STATE.INVALID_COMPARISON,
      diagnosticCode: stageA.diagnosticCode,
      targetEntities: invalidPayload.comparedEntities,
      orderedAspects: invalidPayload.requestedAspects,
      aspectResults: {},
      scopedConflicts: []
    });
  }

  const entities = stageA.comparedEntities;
  const aspects = stageA.requestedAspects;

  const normConflicts = (scopedConflicts || []).map(c => ({
    aspect: String(c.aspect || '').normalize('NFC'),
    affectedEntities: canonicalSortStrings(c.affectedEntities || []),
    conflictType: String(c.conflictType || 'EVIDENCE_CONFLICT')
  })).sort((a, b) => {
    const aspCmp = compareCodePoints(a.aspect, b.aspect);
    if (aspCmp !== 0) return aspCmp;
    return compareCodePoints(a.affectedEntities[0] || '', b.affectedEntities[0] || '');
  });

  const aspectResults = {};
  let totalPairsEvaluated = 0;
  let totalPairsAligned = 0;
  let hasScopedConflict = normConflicts.length > 0;
  let hasMissingData = false;

  for (let aIdx = 0; aIdx < aspects.length; aIdx++) {
    const aspect = aspects[aIdx];
    const comparator = ASPECT_COMPARATOR_REGISTRY[aspect] || 'SCALAR_EQUALITY';
    const aspectConflict = normConflicts.find(c => c.aspect === aspect);

    const aspectData = {
      aspectIndex: aIdx,
      aspect,
      comparator,
      alignmentStatus: ASPECT_ALIGNMENT_STATUS.ALIGNED,
      pairwise: {},
      extremes: {
        highestEntity: null,
        highestValue: null,
        lowestEntity: null,
        lowestValue: null,
        allIdentical: false
      },
      setAggregates: null,
      notices: []
    };

    if (aspectConflict) {
      aspectData.alignmentStatus = ASPECT_ALIGNMENT_STATUS.EVIDENCE_CONFLICTED;
      aspectData.notices.push({
        noticeCode: PRESENTATION_NOTICE_CODE.NOTICE_DATA_CONFLICT,
        diagnosticCode: COMPARISON_DIAGNOSTIC_CODE.UNRESOLVED_EVIDENCE_CONFLICT,
        affectedEntities: aspectConflict.affectedEntities
      });
      aspectResults[aspect] = aspectData;
      continue;
    }

    // Evaluate entity presence
    const entitySlots = {};
    for (const ent of entities) {
      const factList = factsByEntity[ent] || [];
      const fact = factList.find(f => f.aspect === aspect);
      if (!fact || fact.value === undefined) {
        entitySlots[ent] = { presence: 'MISSING' };
        hasMissingData = true;
      } else if (fact.value === null) {
        entitySlots[ent] = { presence: 'EXPLICIT_NULL', value: null };
        hasMissingData = true;
      } else {
        entitySlots[ent] = { presence: 'PRESENT', value: fact.value, fact };
      }
    }

    // Evaluate pairwise
    const pairs = [];
    if (entities.length === 2) {
      pairs.push([0, 1, 0]);
    } else if (entities.length === 3) {
      pairs.push([0, 1, 0], [0, 2, 1], [1, 2, 2]);
    }

    for (const [idxA, idxB, pairIdx] of pairs) {
      totalPairsEvaluated++;
      const entA = entities[idxA];
      const entB = entities[idxB];
      const slotA = entitySlots[entA];
      const slotB = entitySlots[entB];
      const pairKey = `${entA}:${entB}`;
      const indexPairKey = `${idxA}:${idxB}`;

      if (slotA.presence !== 'PRESENT' || slotB.presence !== 'PRESENT') {
        aspectData.pairwise[pairKey] = {
          pairIndex: pairIdx,
          entityA: entA,
          entityB: entB,
          deltaType: COMPARISON_DELTA_TYPE.INCOMPARABLE,
          valueA: slotA,
          valueB: slotB
        };
        continue;
      }

      totalPairsAligned++;

      // Comparator dispatch
      let pairResult = null;
      if (comparator === 'NUMERIC_PERIOD') {
        const numA = Number(slotA.value);
        const numB = Number(slotB.value);
        if (Number.isFinite(numA) && Number.isFinite(numB)) {
          let deltaType = COMPARISON_DELTA_TYPE.IDENTICAL;
          if (numA > numB) deltaType = COMPARISON_DELTA_TYPE.GREATER_THAN;
          else if (numA < numB) deltaType = COMPARISON_DELTA_TYPE.LESS_THAN;

          pairResult = {
            pairIndex: pairIdx,
            entityA: entA,
            entityB: entB,
            deltaType,
            valueA: slotA,
            valueB: slotB,
            absoluteDifference: Math.abs(numA - numB),
            higherEntity: numA > numB ? entA : (numB > numA ? entB : null),
            lowerEntity: numA < numB ? entA : (numB < numA ? entB : null),
            unit: (slotA.fact && slotA.fact.unit) || 'IDR'
          };
        } else {
          pairResult = {
            pairIndex: pairIdx,
            entityA: entA,
            entityB: entB,
            deltaType: COMPARISON_DELTA_TYPE.INCOMPARABLE,
            valueA: slotA,
            valueB: slotB
          };
        }
      } else if (comparator === 'ORDERED_SEQUENCE') {
        const seqA = Array.isArray(slotA.value) ? slotA.value.map(String) : [];
        const seqB = Array.isArray(slotB.value) ? slotB.value.map(String) : [];
        const isIdentical = seqA.length === seqB.length && seqA.every((v, i) => v === seqB[i]);
        let divIdx = null;
        const prefix = [];
        const minLen = Math.min(seqA.length, seqB.length);
        for (let i = 0; i < minLen; i++) {
          if (seqA[i] === seqB[i]) {
            prefix.push(seqA[i]);
          } else {
            divIdx = i;
            break;
          }
        }
        if (divIdx === null && seqA.length !== seqB.length) {
          divIdx = minLen;
        }

        pairResult = {
          pairIndex: pairIdx,
          entityA: entA,
          entityB: entB,
          deltaType: isIdentical ? COMPARISON_DELTA_TYPE.IDENTICAL : COMPARISON_DELTA_TYPE.DIVERGENT,
          valueA: slotA,
          valueB: slotB,
          stepsA: seqA,
          stepsB: seqB,
          commonPrefix: prefix,
          divergenceIndex: divIdx
        };
      } else if (comparator === 'UNORDERED_SET') {
        const setA = new Set(Array.isArray(slotA.value) ? slotA.value.map(String) : []);
        const setB = new Set(Array.isArray(slotB.value) ? slotB.value.map(String) : []);
        const shared = canonicalSortStrings([...setA].filter(x => setB.has(x)));
        const uniqA = canonicalSortStrings([...setA].filter(x => !setB.has(x)));
        const uniqB = canonicalSortStrings([...setB].filter(x => !setA.has(x)));

        let deltaType = COMPARISON_DELTA_TYPE.OVERLAPPING;
        if (uniqA.length === 0 && uniqB.length === 0) deltaType = COMPARISON_DELTA_TYPE.IDENTICAL;
        else if (uniqA.length > 0 && uniqB.length === 0) deltaType = COMPARISON_DELTA_TYPE.SUPERSET;
        else if (uniqA.length === 0 && uniqB.length > 0) deltaType = COMPARISON_DELTA_TYPE.SUBSET;
        else if (shared.length === 0) deltaType = COMPARISON_DELTA_TYPE.DISJOINT;

        pairResult = {
          pairIndex: pairIdx,
          entityA: entA,
          entityB: entB,
          deltaType,
          sharedItems: shared,
          uniqueToA: uniqA,
          uniqueToB: uniqB
        };
      } else {
        // SCALAR_EQUALITY
        const isIdentical = areStructuredValuesEqual(slotA.value, slotB.value);
        pairResult = {
          pairIndex: pairIdx,
          entityA: entA,
          entityB: entB,
          deltaType: isIdentical ? COMPARISON_DELTA_TYPE.IDENTICAL : COMPARISON_DELTA_TYPE.DIVERGENT,
          valueA: slotA,
          valueB: slotB
        };
      }

      if (pairResult) {
        aspectData.pairwise[pairKey] = pairResult;
        aspectData.pairwise[indexPairKey] = pairResult;
      }
    }

    // Extremes calculation for numeric
    if (comparator === 'NUMERIC_PERIOD') {
      const validNumericSlots = entities
        .map(e => ({ entity: e, slot: entitySlots[e] }))
        .filter(item => item.slot.presence === 'PRESENT' && Number.isFinite(Number(item.slot.value)));

      if (validNumericSlots.length === entities.length) {
        let allEqual = true;
        const firstVal = Number(validNumericSlots[0].slot.value);
        for (let i = 1; i < validNumericSlots.length; i++) {
          if (Number(validNumericSlots[i].slot.value) !== firstVal) {
            allEqual = false;
            break;
          }
        }
        aspectData.extremes.allIdentical = allEqual;

        let high = validNumericSlots[0];
        let low = validNumericSlots[0];
        for (let i = 1; i < validNumericSlots.length; i++) {
          const v = Number(validNumericSlots[i].slot.value);
          if (v > Number(high.slot.value)) high = validNumericSlots[i];
          if (v < Number(low.slot.value)) low = validNumericSlots[i];
        }
        aspectData.extremes.highestEntity = high.entity;
        aspectData.extremes.highestValue = Number(high.slot.value);
        aspectData.extremes.lowestEntity = low.entity;
        aspectData.extremes.lowestValue = Number(low.slot.value);
      } else if (validNumericSlots.length >= 1) {
        aspectData.extremes.allIdentical = false;
        let high = validNumericSlots[0];
        let low = validNumericSlots[0];
        for (let i = 1; i < validNumericSlots.length; i++) {
          const v = Number(validNumericSlots[i].slot.value);
          if (v > Number(high.slot.value)) high = validNumericSlots[i];
          if (v < Number(low.slot.value)) low = validNumericSlots[i];
        }
        aspectData.extremes.highestEntity = high.entity;
        aspectData.extremes.highestValue = Number(high.slot.value);
        aspectData.extremes.lowestEntity = low.entity;
        aspectData.extremes.lowestValue = Number(low.slot.value);
      }
    }

    // Multi-entity set aggregates
    if (comparator === 'UNORDERED_SET') {
      const presentEntities = entities.filter(e => entitySlots[e].presence === 'PRESENT');
      if (presentEntities.length >= 2) {
        const setsByEnt = {};
        for (const e of presentEntities) {
          setsByEnt[e] = new Set(Array.isArray(entitySlots[e].value) ? entitySlots[e].value.map(String) : []);
        }

        let sharedAll = [];
        if (presentEntities.length === 3) {
          const [s0, s1, s2] = [setsByEnt[presentEntities[0]], setsByEnt[presentEntities[1]], setsByEnt[presentEntities[2]]];
          sharedAll = canonicalSortStrings([...s0].filter(x => s1.has(x) && s2.has(x)));
        } else if (presentEntities.length === 2) {
          const [s0, s1] = [setsByEnt[presentEntities[0]], setsByEnt[presentEntities[1]]];
          sharedAll = canonicalSortStrings([...s0].filter(x => s1.has(x)));
        }

        const pairwiseSharedList = [];
        if (presentEntities.length === 3) {
          const pairsList = [
            [0, 1, 2, 0], // (0,1)\2
            [0, 2, 1, 1], // (0,2)\1
            [1, 2, 0, 2]  // (1,2)\0
          ];
          for (const [iA, iB, iOther, pIdx] of pairsList) {
            const eA = presentEntities[iA];
            const eB = presentEntities[iB];
            const eO = presentEntities[iOther];
            const sA = setsByEnt[eA];
            const sB = setsByEnt[eB];
            const sO = setsByEnt[eO];
            const sharedExclusive = canonicalSortStrings([...sA].filter(x => sB.has(x) && !sO.has(x)));
            pairwiseSharedList.push({
              pairIndex: pIdx,
              entityA: eA,
              entityB: eB,
              sharedItems: sharedExclusive
            });
          }
        }

        const uniqueList = [];
        for (const e of presentEntities) {
          const mySet = setsByEnt[e];
          const otherSets = presentEntities.filter(other => other !== e).map(other => setsByEnt[other]);
          const uniqueItems = canonicalSortStrings([...mySet].filter(x => otherSets.every(os => !os.has(x))));
          uniqueList.push({
            entity: e,
            uniqueItems
          });
        }

        aspectData.setAggregates = {
          sharedAcrossAll: sharedAll,
          pairwiseShared: pairwiseSharedList,
          uniquePerEntity: uniqueList
        };
      }
    }

    // Aspect Notices for missing entities
    const missingEntities = entities.filter(e => entitySlots[e].presence !== 'PRESENT');
    if (missingEntities.length > 0) {
      aspectData.notices.push({
        noticeCode: PRESENTATION_NOTICE_CODE.NOTICE_DATA_UNAVAILABLE,
        diagnosticCode: missingEntities.length === entities.length ? COMPARISON_DIAGNOSTIC_CODE.ZERO_EVIDENCE : null,
        affectedEntities: canonicalSortStrings(missingEntities)
      });
    }

    aspectResults[aspect] = aspectData;
  }

  // Determine globalState
  let globalState = COMPARISON_GLOBAL_STATE.COMPLETE_COMPARISON;
  if (hasScopedConflict) {
    globalState = COMPARISON_GLOBAL_STATE.CONFLICTED_COMPARISON;
  } else if (totalPairsAligned === 0) {
    globalState = COMPARISON_GLOBAL_STATE.INSUFFICIENT_EVIDENCE;
  } else if (hasMissingData || totalPairsAligned < totalPairsEvaluated) {
    globalState = COMPARISON_GLOBAL_STATE.PARTIAL_COMPARISON;
  }

  const validPayload = {
    computationState: COMPUTATION_STATE.VALID_SCOPE,
    contractVersion: 1,
    comparedEntities: entities,
    requestedAspects: aspects,
    sourceFingerprints: canonicalSortStrings(sourceFingerprints || []),
    scopedConflicts: normConflicts
  };
  const comparisonId = computeComparisonId(validPayload);

  return Object.freeze({
    schemaVersion: 1,
    comparisonId,
    computationState: COMPUTATION_STATE.VALID_SCOPE,
    globalState,
    diagnosticCode: globalState === COMPARISON_GLOBAL_STATE.CONFLICTED_COMPARISON ? COMPARISON_DIAGNOSTIC_CODE.UNRESOLVED_EVIDENCE_CONFLICT : null,
    targetEntities: entities,
    orderedAspects: aspects,
    aspectResults,
    scopedConflicts: normConflicts
  });
}

/**
 * Single pure canonical deterministic compiler:
 * ComparisonResultMatrix -> compileRenderPlan(matrix) -> RenderPlan
 */
function compileRenderPlan(matrix) {
  if (!matrix || typeof matrix !== 'object' || matrix.schemaVersion !== 1) {
    throw new Error('INVALID_MATRIX');
  }

  const targetEntities = matrix.targetEntities || [];
  const orderedAspects = matrix.orderedAspects || [];

  let globalStatusHeader = null;
  if (matrix.globalState === COMPARISON_GLOBAL_STATE.PARTIAL_COMPARISON) {
    globalStatusHeader = {
      templateId: COMPARISON_TEMPLATE_ID.GLOBAL_STATUS_HEADER,
      globalState: matrix.globalState,
      headerCode: GLOBAL_STATUS_HEADER_CODE.HEADER_PARTIAL
    };
  } else if (matrix.globalState === COMPARISON_GLOBAL_STATE.CONFLICTED_COMPARISON) {
    globalStatusHeader = {
      templateId: COMPARISON_TEMPLATE_ID.GLOBAL_STATUS_HEADER,
      globalState: matrix.globalState,
      headerCode: GLOBAL_STATUS_HEADER_CODE.HEADER_CONFLICTED
    };
  } else if (matrix.globalState === COMPARISON_GLOBAL_STATE.INSUFFICIENT_EVIDENCE) {
    globalStatusHeader = {
      templateId: COMPARISON_TEMPLATE_ID.GLOBAL_STATUS_HEADER,
      globalState: matrix.globalState,
      headerCode: GLOBAL_STATUS_HEADER_CODE.HEADER_INSUFFICIENT
    };
  } else if (matrix.globalState === COMPARISON_GLOBAL_STATE.INVALID_COMPARISON) {
    globalStatusHeader = {
      templateId: COMPARISON_TEMPLATE_ID.GLOBAL_STATUS_HEADER,
      globalState: matrix.globalState,
      headerCode: GLOBAL_STATUS_HEADER_CODE.HEADER_INVALID
    };
  }

  const pairwiseClaims = [];
  const numericRankingClaims = [];
  const multiEntitySetClaims = [];
  const aspectNotices = [];

  for (let aIdx = 0; aIdx < orderedAspects.length; aIdx++) {
    const aspect = orderedAspects[aIdx];
    const aData = matrix.aspectResults ? matrix.aspectResults[aspect] : null;
    if (!aData) continue;

    // 1. Pairwise claims
    if (aData.pairwise) {
      // Filter to only canonical named keys `${entA}:${entB}` (non-digit prefix)
      const pairKeys = Object.keys(aData.pairwise).filter(k => !/^\d+:\d+$/.test(k));
      for (const pKey of pairKeys) {
        const p = aData.pairwise[pKey];
        if (p.deltaType === COMPARISON_DELTA_TYPE.INCOMPARABLE) continue;

        let templateId = COMPARISON_TEMPLATE_ID.SCALAR_EQUALITY_DIFF;
        let templateParams = null;

        if (aData.comparator === 'NUMERIC_PERIOD') {
          templateId = COMPARISON_TEMPLATE_ID.NUMERIC_DIFFERENCE;
          templateParams = {
            entityA: p.entityA,
            entityB: p.entityB,
            aspect,
            valueA: p.valueA,
            valueB: p.valueB,
            absoluteDifference: p.absoluteDifference !== undefined ? p.absoluteDifference : null,
            higherEntity: p.higherEntity || null,
            lowerEntity: p.lowerEntity || null,
            unit: p.unit || 'IDR'
          };
        } else if (aData.comparator === 'ORDERED_SEQUENCE') {
          templateId = COMPARISON_TEMPLATE_ID.ORDERED_SEQUENCE_DIFF;
          templateParams = {
            entityA: p.entityA,
            entityB: p.entityB,
            aspect,
            valueA: p.valueA,
            valueB: p.valueB,
            stepsA: p.stepsA || [],
            stepsB: p.stepsB || [],
            commonPrefix: p.commonPrefix || [],
            divergenceIndex: p.divergenceIndex !== undefined ? p.divergenceIndex : null
          };
        } else if (aData.comparator === 'UNORDERED_SET') {
          templateId = COMPARISON_TEMPLATE_ID.SET_MEMBERSHIP_DIFF;
          templateParams = {
            entityA: p.entityA,
            entityB: p.entityB,
            aspect,
            sharedItems: p.sharedItems || [],
            uniqueToA: p.uniqueToA || [],
            uniqueToB: p.uniqueToB || []
          };
        } else {
          templateId = COMPARISON_TEMPLATE_ID.SCALAR_EQUALITY_DIFF;
          templateParams = {
            entityA: p.entityA,
            entityB: p.entityB,
            aspect,
            valueA: p.valueA,
            valueB: p.valueB
          };
        }

        pairwiseClaims.push({
          aspectIndex: aIdx,
          pairIndex: p.pairIndex,
          aspect,
          entityA: p.entityA,
          entityB: p.entityB,
          deltaType: p.deltaType,
          templateId,
          templateParams
        });
      }
    }

    // 2. Numeric Ranking Claim
    if (aData.comparator === 'NUMERIC_PERIOD' && targetEntities.length === 3) {
      if (aData.extremes && aData.extremes.highestEntity !== null && aData.extremes.lowestEntity !== null) {
        // Emit ranking claim only when all 3 entities are present (3 unique pairs)
        const validNamedPairs = Object.entries(aData.pairwise || {})
          .filter(([k, p]) => !/^\d+:\d+$/.test(k) && p.deltaType !== COMPARISON_DELTA_TYPE.INCOMPARABLE);
        if (validNamedPairs.length === 3) {
          numericRankingClaims.push({
            aspectIndex: aIdx,
            aspect,
            templateId: COMPARISON_TEMPLATE_ID.NUMERIC_RANKING_SUMMARY,
            templateParams: {
              aspect,
              highestEntity: aData.extremes.highestEntity,
              highestValue: aData.extremes.highestValue,
              lowestEntity: aData.extremes.lowestEntity,
              lowestValue: aData.extremes.lowestValue,
              allIdentical: aData.extremes.allIdentical,
              unit: 'IDR'
            }
          });
        }
      }
    }

    // 3. Multi-Entity Set Claim (Option A)
    if (aData.comparator === 'UNORDERED_SET' && aData.setAggregates) {
      multiEntitySetClaims.push({
        aspectIndex: aIdx,
        aspect,
        templateId: COMPARISON_TEMPLATE_ID.MULTI_ENTITY_SET_DIFF,
        templateParams: {
          aspect,
          sharedAcrossAll: aData.setAggregates.sharedAcrossAll || [],
          pairwiseShared: aData.setAggregates.pairwiseShared || [],
          uniquePerEntity: aData.setAggregates.uniquePerEntity || []
        }
      });
    }

    // 4. Aspect Notice (At most 1 per aspect with strict deterministic precedence)
    if (aData.notices && aData.notices.length > 0) {
      const precedence = {
        [PRESENTATION_NOTICE_CODE.NOTICE_DATA_CONFLICT]: 1,
        [PRESENTATION_NOTICE_CODE.NOTICE_ASPECT_NOT_APPLICABLE]: 2,
        [PRESENTATION_NOTICE_CODE.NOTICE_DATA_UNAVAILABLE]: 3
      };
      const sortedNotices = [...aData.notices].sort((a, b) => {
        const pA = precedence[a.noticeCode] || 99;
        const pB = precedence[b.noticeCode] || 99;
        return pA - pB;
      });
      const win = sortedNotices[0];
      const allAffected = uniqueCanonicalStrings(aData.notices.flatMap(n => n.affectedEntities || []));

      aspectNotices.push({
        aspectIndex: aIdx,
        aspect,
        affectedEntities: allAffected,
        templateId: COMPARISON_TEMPLATE_ID.ASPECT_NOTICE,
        templateParams: {
          noticeCode: win.noticeCode,
          diagnosticCode: win.diagnosticCode || null
        }
      });
    }
  }

  // Exact deterministic sorting
  pairwiseClaims.sort((a, b) => {
    if (a.aspectIndex !== b.aspectIndex) return a.aspectIndex - b.aspectIndex;
    return a.pairIndex - b.pairIndex;
  });

  numericRankingClaims.sort((a, b) => a.aspectIndex - b.aspectIndex);
  multiEntitySetClaims.sort((a, b) => a.aspectIndex - b.aspectIndex);

  aspectNotices.sort((a, b) => {
    if (a.aspectIndex !== b.aspectIndex) return a.aspectIndex - b.aspectIndex;
    const nCmp = compareCodePoints(a.templateParams.noticeCode, b.templateParams.noticeCode);
    if (nCmp !== 0) return nCmp;
    const len = Math.min(a.affectedEntities.length, b.affectedEntities.length);
    for (let i = 0; i < len; i++) {
      const eCmp = compareCodePoints(a.affectedEntities[i], b.affectedEntities[i]);
      if (eCmp !== 0) return eCmp;
    }
    if (a.affectedEntities.length !== b.affectedEntities.length) {
      return a.affectedEntities.length - b.affectedEntities.length;
    }
    return compareCodePoints(a.templateParams.diagnosticCode || '', b.templateParams.diagnosticCode || '');
  });

  return Object.freeze({
    schemaVersion: 1,
    sourceComparisonId: matrix.comparisonId,
    targetEntities,
    orderedAspects,
    globalStatusHeader,
    pairwiseClaims,
    numericRankingClaims,
    multiEntitySetClaims,
    aspectNotices
  });
}

/**
 * Deterministic WhatsApp-Safe String Serializer.
 * Guarantees: sanitizeWhatsAppMarkdown(renderTextFromPlan(plan)) === renderTextFromPlan(plan).
 */
function renderTextFromPlan(plan) {
  if (!plan || typeof plan !== 'object' || plan.schemaVersion !== 1) {
    throw new Error('INVALID_RENDER_PLAN');
  }

  const lines = [];

  // 1. Global Status Header
  if (plan.globalStatusHeader) {
    const code = plan.globalStatusHeader.headerCode;
    if (code === GLOBAL_STATUS_HEADER_CODE.HEADER_PARTIAL) {
      lines.push('*Perbandingan Sebagian:* Sebagian data program studi belum tersedia lengkap.');
    } else if (code === GLOBAL_STATUS_HEADER_CODE.HEADER_CONFLICTED) {
      lines.push('*Perhatian: Ketidaksesuaian Data:* Terdapat perbedaan informasi antar dokumen sumber.');
    } else if (code === GLOBAL_STATUS_HEADER_CODE.HEADER_INSUFFICIENT) {
      lines.push('*Informasi Tidak Cukup:* Bukti dokumen tidak memadai untuk membandingkan aspek yang diminta.');
    } else if (code === GLOBAL_STATUS_HEADER_CODE.HEADER_INVALID) {
      lines.push('*Permintaan Tidak Valid:* Parameter perbandingan berada di luar cakupan.');
    }
  }

  // 2. Numeric Ranking Claims
  for (const rank of plan.numericRankingClaims) {
    const p = rank.templateParams;
    if (p.allIdentical) {
      lines.push(`*${p.aspect}:* Seluruh program studi memiliki biaya yang sama (${formatIdr(p.highestValue)}).`);
    } else {
      lines.push(`*${p.aspect}:* Tertinggi pada *${p.highestEntity}* (${formatIdr(p.highestValue)}), terendah pada *${p.lowestEntity}* (${formatIdr(p.lowestValue)}).`);
    }
  }

  // 3. Multi-Entity Set Claims
  for (const setClaim of plan.multiEntitySetClaims) {
    const p = setClaim.templateParams;
    if (p.sharedAcrossAll && p.sharedAcrossAll.length > 0) {
      lines.push(`*${p.aspect} Bersama:* ${p.sharedAcrossAll.join(', ')}.`);
    }
    if (p.pairwiseShared) {
      for (const pair of p.pairwiseShared) {
        if (pair.sharedItems && pair.sharedItems.length > 0) {
          lines.push(`*${p.aspect} (${pair.entityA} & ${pair.entityB}):* ${pair.sharedItems.join(', ')}.`);
        }
      }
    }
    if (p.uniquePerEntity) {
      for (const u of p.uniquePerEntity) {
        if (u.uniqueItems && u.uniqueItems.length > 0) {
          lines.push(`*${p.aspect} Khusus ${u.entity}:* ${u.uniqueItems.join(', ')}.`);
        }
      }
    }
  }

  // 4. Pairwise Claims
  for (const claim of plan.pairwiseClaims) {
    const p = claim.templateParams;
    if (claim.templateId === COMPARISON_TEMPLATE_ID.NUMERIC_DIFFERENCE) {
      if (claim.deltaType === COMPARISON_DELTA_TYPE.IDENTICAL) {
        const valStr = p.valueA.presence === 'PRESENT' ? formatIdr(Number(p.valueA.value)) : '-';
        lines.push(`*${p.aspect} (${p.entityA} vs ${p.entityB}):* Sama besar (${valStr}).`);
      } else {
        const valAStr = p.valueA.presence === 'PRESENT' ? formatIdr(Number(p.valueA.value)) : '-';
        const valBStr = p.valueB.presence === 'PRESENT' ? formatIdr(Number(p.valueB.value)) : '-';
        const diffStr = p.absoluteDifference !== null ? formatIdr(p.absoluteDifference) : '-';
        lines.push(`*${p.aspect} (${p.entityA} vs ${p.entityB}):* ${p.higherEntity} lebih tinggi ${diffStr} (${valAStr} vs ${valBStr}).`);
      }
    } else if (claim.templateId === COMPARISON_TEMPLATE_ID.ORDERED_SEQUENCE_DIFF) {
      if (claim.deltaType === COMPARISON_DELTA_TYPE.IDENTICAL) {
        lines.push(`*${p.aspect} (${p.entityA} vs ${p.entityB}):* Urutan tahapan identik.`);
      } else {
        lines.push(`*${p.aspect} (${p.entityA} vs ${p.entityB}):* Tahapan berbeda mulai langkah ke-${(p.divergenceIndex || 0) + 1}.`);
      }
    } else if (claim.templateId === COMPARISON_TEMPLATE_ID.SET_MEMBERSHIP_DIFF) {
      const sharedStr = p.sharedItems.length > 0 ? p.sharedItems.join(', ') : 'Tidak ada';
      lines.push(`*${p.aspect} (${p.entityA} vs ${p.entityB}):* Bersama: ${sharedStr}.`);
    } else if (claim.templateId === COMPARISON_TEMPLATE_ID.SCALAR_EQUALITY_DIFF) {
      const sA = p.valueA.presence === 'PRESENT' ? String(p.valueA.value) : 'Data tidak tersedia';
      const sB = p.valueB.presence === 'PRESENT' ? String(p.valueB.value) : 'Data tidak tersedia';
      if (claim.deltaType === COMPARISON_DELTA_TYPE.IDENTICAL) {
        lines.push(`*${p.aspect} (${p.entityA} vs ${p.entityB}):* Keduanya ${sA}.`);
      } else {
        lines.push(`*${p.aspect} (${p.entityA} vs ${p.entityB}):* ${p.entityA} adalah ${sA}, sedangkan ${p.entityB} adalah ${sB}.`);
      }
    }
  }

  // 5. Aspect Notices
  for (const notice of plan.aspectNotices) {
    const p = notice.templateParams;
    const entList = notice.affectedEntities.join(', ');
    if (p.noticeCode === PRESENTATION_NOTICE_CODE.NOTICE_DATA_UNAVAILABLE) {
      lines.push(`*Catatan ${notice.aspect}:* Data untuk ${entList} tidak tersedia.`);
    } else if (p.noticeCode === PRESENTATION_NOTICE_CODE.NOTICE_ASPECT_NOT_APPLICABLE) {
      lines.push(`*Catatan ${notice.aspect}:* Aspek ini tidak dapat diperbandingkan untuk ${entList}.`);
    } else if (p.noticeCode === PRESENTATION_NOTICE_CODE.NOTICE_DATA_CONFLICT) {
      lines.push(`*Catatan ${notice.aspect}:* Terdapat perbedaan data antar sumber untuk ${entList}.`);
    }
  }

  if (lines.length === 0) {
    return 'Data perbandingan tidak tersedia.';
  }

  return lines.join('\n');
}

/**
 * Validates deep consistency and structural typing of ComparisonTransportEnvelope.
 */
function validateComparisonEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object') {
    return { valid: false, code: COMPARATIVE_TRANSPORT_VALIDATION_CODE.TRANSPORT_ENVELOPE_MISSING };
  }

  if (envelope.mode !== 'COMPARATIVE') {
    return { valid: false, code: COMPARATIVE_TRANSPORT_VALIDATION_CODE.INVALID_RENDER_PLAN_STRUCTURE };
  }

  const allowedEnvelopeKeys = new Set(['mode', 'matrix', 'renderPlan']);
  for (const k of Object.keys(envelope)) {
    if (!allowedEnvelopeKeys.has(k)) {
      return { valid: false, code: COMPARATIVE_TRANSPORT_VALIDATION_CODE.UNKNOWN_TEMPLATE_PROPERTY };
    }
  }

  const { matrix, renderPlan } = envelope;
  if (!matrix || typeof matrix !== 'object' || matrix.schemaVersion !== 1) {
    return { valid: false, code: COMPARATIVE_TRANSPORT_VALIDATION_CODE.INVALID_RENDER_PLAN_STRUCTURE };
  }
  if (!renderPlan || typeof renderPlan !== 'object' || renderPlan.schemaVersion !== 1) {
    return { valid: false, code: COMPARATIVE_TRANSPORT_VALIDATION_CODE.INVALID_RENDER_PLAN_STRUCTURE };
  }

  if (renderPlan.sourceComparisonId !== matrix.comparisonId) {
    return { valid: false, code: COMPARATIVE_TRANSPORT_VALIDATION_CODE.RENDER_PLAN_STRUCTURAL_MISMATCH };
  }

  // Reconstruct expected plan and verify deep structural equality
  let expectedPlan;
  try {
    expectedPlan = compileRenderPlan(matrix);
  } catch (err) {
    return { valid: false, code: COMPARATIVE_TRANSPORT_VALIDATION_CODE.INVALID_RENDER_PLAN_STRUCTURE };
  }

  const actualJson = JSON.stringify(renderPlan);
  const expectedJson = JSON.stringify(expectedPlan);
  if (actualJson !== expectedJson) {
    return { valid: false, code: COMPARATIVE_TRANSPORT_VALIDATION_CODE.RENDER_PLAN_STRUCTURAL_MISMATCH };
  }

  return { valid: true };
}

module.exports = {
  compareCodePoints,
  areStructuredValuesEqual,
  formatIdr,
  canonicalSortStrings,
  uniqueCanonicalStrings,
  canonicalJson,
  computeComparisonId,
  validateScopeAndEntities,
  buildComparisonMatrix,
  compileRenderPlan,
  renderTextFromPlan,
  validateComparisonEnvelope
};
