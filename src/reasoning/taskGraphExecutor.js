'use strict';

/**
 * src/reasoning/taskGraphExecutor.js
 * 
 * Phase 2 Step 5: Multi-Step Task Graph / Task DAG Execution Engine.
 * 
 * Strict Invariants:
 * 1. Topological Wave Execution (independent roots/nodes run concurrently).
 * 2. Absolute Budget Deadlines (2100ms execution cutoff, 1500ms replan cutoff, 2500ms turn cutoff).
 * 3. Type-safe Execution: RETRIEVAL_QUERY, DETERMINISTIC_TRANSFORM, EVIDENCE_AGGREGATION.
 * 4. Strict Inter-Node Handoff: Zero natural-language answer leakage.
 * 5. Arithmetic transforms consume ONLY grounded fact references (no constants).
 * 6. Transitive lineage and multi-authority preservation for DERIVED_FACT.
 * 7. Runtime Goal Evaluator (entity-aware, aspect-aware, factKey-aware).
 * 8. Replan authority isolated to Bridge; node lifecycle restored to terminal status.
 * 9. Completion evaluation follows strict precedence.
 */

const {
  TASK_TYPE,
  TASK_STATUS,
  TASK_CRITICALITY,
  NODE_CONTROL_SIGNAL,
  EXECUTION_POLICY,
  GRAPH_COMPLETION_STATE,
  TRANSFORM_OPERATION,
  FACT_TYPE,
  ENTITY_PROVENANCE,
  NODE_EFFECTIVE_BUDGET_MS,
  validateStructuredFact
} = require('./contracts');
const { validateTaskGraph } = require('./taskGraph');
const logger = require('../logger');

/**
 * Pure evaluation of GoalRequirements against consolidated structuredFacts.
 */
function evaluateGoalRequirements(goalRequirements = [], allNodes = new Map()) {
  // Consolidate all structured facts from successfully executed nodes
  const consolidatedFacts = {};
  for (const node of allNodes.values()) {
    if (node.status === TASK_STATUS.SUCCEEDED && node.output && node.output.structuredFacts) {
      for (const [k, fact] of Object.entries(node.output.structuredFacts)) {
        consolidatedFacts[k] = fact;
      }
    }
  }

  const evaluated = [];
  let allSatisfied = true;

  for (const req of goalRequirements) {
    const fact = consolidatedFacts[req.factKey];
    let isSatisfied = false;
    let satisfiedByFactRef = null;
    let evaluationError = null;

    if (!fact) {
      isSatisfied = false;
      evaluationError = 'NO_GROUNDED_FACT';
    } else {
      // 1. Check entity match
      const entityMatch = !req.entity || fact.entity === req.entity;
      // 2. Check aspect match
      const aspectMatch = !req.aspect || fact.aspect === req.aspect;
      // 3. Check factKey match
      const keyMatch = fact.factKey === req.factKey;
      // 4. Check evidence / lineage validity
      const hasValidEvidence = Array.isArray(fact.evidenceRefs) && fact.evidenceRefs.length > 0;

      if (!entityMatch) {
        evaluationError = 'ENTITY_MISMATCH';
      } else if (!aspectMatch) {
        evaluationError = 'ASPECT_MISMATCH';
      } else if (!keyMatch) {
        evaluationError = 'KEY_MISMATCH';
      } else if (!hasValidEvidence) {
        evaluationError = 'INVALID_EVIDENCE';
      } else {
        isSatisfied = true;
        satisfiedByFactRef = {
          fromTaskId: fact._fromTaskId || 'unknown',
          factKey: fact.factKey,
          matchedEntity: fact.entity,
          matchedAspect: fact.aspect,
          evidenceChunkIds: fact.evidenceRefs.map(e => e.chunkId)
        };
      }
    }

    if (!isSatisfied) {
      allSatisfied = false;
    }

    evaluated.push({
      ...req,
      isSatisfied,
      satisfiedByFactRef,
      evaluationError
    });
  }

  return { allSatisfied, evaluated, consolidatedFacts };
}

/**
 * Determines final graph completion state based on strict precedence rules.
 */
function evaluateGraphCompletion(graph, goalEvaluationResult) {
  const nodes = Array.from(graph.nodes.values());
  const requiredNodes = nodes.filter(n => n.criticality === TASK_CRITICALITY.REQUIRED);
  const optionalNodes = nodes.filter(n => n.criticality === TASK_CRITICALITY.OPTIONAL);

  const hasRuntimeFailuresOnRequired = requiredNodes.some(n => n.status === TASK_STATUS.FAILED);
  const hasInsufficientEvidenceOnRequired = requiredNodes.some(n => n.status === TASK_STATUS.INSUFFICIENT_EVIDENCE);
  const allRequiredSucceeded = requiredNodes.every(n => n.status === TASK_STATUS.SUCCEEDED);

  const allGoalsMet = graph.goalRequirements.length === 0 || goalEvaluationResult.allSatisfied;

  // 1. INVALID_TOPOLOGY already handled prior to run

  // 2. TIMEOUT_GRAPH: execution deadline exceeded while required goals or required nodes not yet met
  if (graph._executionTimedOut && (!allGoalsMet || !allRequiredSucceeded)) {
    return GRAPH_COMPLETION_STATE.TIMEOUT_GRAPH;
  }

  // 3. FAILED_GRAPH: runtime crash on required path
  if (hasRuntimeFailuresOnRequired) {
    return GRAPH_COMPLETION_STATE.FAILED_GRAPH;
  }

  // 4. INSUFFICIENT_EVIDENCE: required goal unfulfilled purely due to evidence lack without crash
  if (!allGoalsMet && hasInsufficientEvidenceOnRequired && !hasRuntimeFailuresOnRequired) {
    return GRAPH_COMPLETION_STATE.INSUFFICIENT_EVIDENCE;
  }

  // 5. PARTIAL_COMPLETION: all required goals satisfied, but some optional node failed / skipped / unfinished
  if (allGoalsMet && allRequiredSucceeded) {
    const hasIncompleteOptional = optionalNodes.some(n =>
      [TASK_STATUS.FAILED, TASK_STATUS.INSUFFICIENT_EVIDENCE, TASK_STATUS.SKIPPED, TASK_STATUS.PLANNED, TASK_STATUS.READY].includes(n.status)
    );
    if (hasIncompleteOptional) {
      return GRAPH_COMPLETION_STATE.PARTIAL_COMPLETION;
    }
    // 6. COMPLETE_SUCCESS: all required and optional nodes succeeded and goals satisfied
    return GRAPH_COMPLETION_STATE.COMPLETE_SUCCESS;
  }

  // Fallback if not all goals met
  return GRAPH_COMPLETION_STATE.FAILED_GRAPH;
}

/**
 * Executes a deterministic transform task node.
 */
function executeDeterministicTransform(node, allNodes) {
  const transformConfig = node.input.transformConfig;
  const bindings = node.input.upstreamFactBindings || [];

  // Build fact lookup from upstream nodes
  const availableFacts = {};
  for (const binding of bindings) {
    const upNode = allNodes.get(binding.fromTaskId);
    if (!upNode || upNode.status !== TASK_STATUS.SUCCEEDED || !upNode.output || !upNode.output.structuredFacts) {
      return {
        status: TASK_STATUS.FAILED,
        error: { code: 'UPSTREAM_FACT_UNAVAILABLE', message: `Upstream fact ${binding.factKey} from ${binding.fromTaskId} is not available` }
      };
    }
    const f = upNode.output.structuredFacts[binding.factKey];
    if (!f) {
      return {
        status: TASK_STATUS.FAILED,
        error: { code: 'UPSTREAM_FACT_NOT_FOUND', message: `Fact ${binding.factKey} not found in upstream task ${binding.fromTaskId}` }
      };
    }
    availableFacts[`${binding.fromTaskId}:${binding.factKey}`] = f;
    availableFacts[binding.factKey] = f;
  }

  const op = transformConfig.operation;
  const p = transformConfig.parameters;

  if (op === TRANSFORM_OPERATION.ARITHMETIC) {
    const factA = availableFacts[p.operandA.factKey] || availableFacts[`${p.operandA.fromTaskId}:${p.operandA.factKey}`];
    const factB = availableFacts[p.operandB.factKey] || availableFacts[`${p.operandB.fromTaskId}:${p.operandB.factKey}`];

    if (!factA || !factB) {
      return {
        status: TASK_STATUS.FAILED,
        error: { code: 'MISSING_OPERANDS', message: 'One or both arithmetic operands are missing' }
      };
    }

    const valA = Number(factA.value);
    const valB = Number(factB.value);

    if (!Number.isFinite(valA) || !Number.isFinite(valB)) {
      return {
        status: TASK_STATUS.FAILED,
        error: { code: 'NON_NUMERIC_OPERAND', message: `Operands must be numeric: ${factA.value}, ${factB.value}` }
      };
    }

    let resultVal;
    if (p.operator === 'ADD') resultVal = valA + valB;
    else if (p.operator === 'SUBTRACT') resultVal = valA - valB;
    else if (p.operator === 'MULTIPLY') resultVal = valA * valB;
    else if (p.operator === 'DIVIDE') {
      if (valB === 0) {
        return {
          status: TASK_STATUS.FAILED,
          error: { code: 'DIVISION_BY_ZERO', message: 'Division by zero attempted in arithmetic transform' }
        };
      }
      resultVal = valA / valB;
    } else {
      return { status: TASK_STATUS.FAILED, error: { code: 'UNKNOWN_OPERATOR', message: `Unknown operator: ${p.operator}` } };
    }

    // Preserve full transitive lineage and multiple authorities
    const sourceAuthorities = Array.from(new Set([...(factA.sourceAuthorities || []), ...(factB.sourceAuthorities || [])]));
    const evidenceRefs = [...(factA.evidenceRefs || []), ...(factB.evidenceRefs || [])];

    const rootKeys = new Set();
    const rootChunks = new Set();
    if (factA.factType === FACT_TYPE.VERIFIED_FACT) rootKeys.add(factA.factKey);
    else (factA.transitiveLineage?.rootVerifiedFactKeys || []).forEach(k => rootKeys.add(k));

    if (factB.factType === FACT_TYPE.VERIFIED_FACT) rootKeys.add(factB.factKey);
    else (factB.transitiveLineage?.rootVerifiedFactKeys || []).forEach(k => rootKeys.add(k));

    evidenceRefs.forEach(e => rootChunks.add(e.chunkId));

    const sourceProvenances = [factA.provenance, factB.provenance].filter(Boolean);
    const finalProvenance = factA.provenance === factB.provenance ? factA.provenance : ENTITY_PROVENANCE.DERIVED_COMPOSITE;

    const derivedFact = {
      factKey: p.destinationFactKey,
      value: resultVal,
      entity: factA.entity,
      aspect: factA.aspect,
      factType: FACT_TYPE.DERIVED_FACT,
      sourceAuthorities,
      provenance: finalProvenance,
      evidenceRefs,
      transitiveLineage: {
        directSourceFactRefs: [
          { fromTaskId: p.operandA.fromTaskId, factKey: p.operandA.factKey },
          { fromTaskId: p.operandB.fromTaskId, factKey: p.operandB.factKey }
        ],
        rootVerifiedFactKeys: Array.from(rootKeys),
        rootEvidenceChunkIds: Array.from(rootChunks),
        derivationSteps: [{ operation: TRANSFORM_OPERATION.ARITHMETIC, taskId: node.taskId }],
        sourceProvenances
      },
      _fromTaskId: node.taskId
    };

    return {
      status: TASK_STATUS.SUCCEEDED,
      output: {
        verifiedEntities: [factA.entity],
        verifiedAspects: [factA.aspect],
        structuredFacts: { [p.destinationFactKey]: derivedFact },
        acceptedEvidence: evidenceRefs,
        answerability: 'ANSWERABLE'
      }
    };
  }

  if (op === TRANSFORM_OPERATION.MERGE) {
    const keysToMerge = p.factKeysToMerge || [];
    const mergedList = [];
    let commonEntity = null;
    let commonAspect = null;
    const combinedAuthorities = new Set();
    const combinedEvidence = [];
    const combinedProvenances = [];
    const rootKeys = new Set();
    const rootChunks = new Set();

    for (const ref of keysToMerge) {
      const f = availableFacts[ref.factKey] || availableFacts[`${ref.fromTaskId}:${ref.factKey}`];
      if (!f) {
        return { status: TASK_STATUS.FAILED, error: { code: 'MERGE_FACT_NOT_FOUND', message: `Fact ${ref.factKey} not found` } };
      }
      if (!commonEntity) commonEntity = f.entity;
      else if (commonEntity !== f.entity) {
        return {
          status: TASK_STATUS.FAILED,
          error: { code: 'INCOMPATIBLE_MERGE_ATTRIBUTES', message: `Cannot merge facts with differing entities: ${commonEntity} vs ${f.entity}` }
        };
      }
      if (!commonAspect) commonAspect = f.aspect;
      else if (commonAspect !== f.aspect) {
        return {
          status: TASK_STATUS.FAILED,
          error: { code: 'INCOMPATIBLE_MERGE_ATTRIBUTES', message: `Cannot merge facts with differing aspects: ${commonAspect} vs ${f.aspect}` }
        };
      }

      mergedList.push(f.value);
      (f.sourceAuthorities || []).forEach(a => combinedAuthorities.add(a));
      (f.evidenceRefs || []).forEach(e => {
        combinedEvidence.push(e);
        rootChunks.add(e.chunkId);
      });
      combinedProvenances.push(f.provenance);

      if (f.factType === FACT_TYPE.VERIFIED_FACT) rootKeys.add(f.factKey);
      else (f.transitiveLineage?.rootVerifiedFactKeys || []).forEach(k => rootKeys.add(k));
    }

    const mergedFact = {
      factKey: p.destinationFactKey,
      value: mergedList,
      entity: commonEntity,
      aspect: commonAspect,
      factType: FACT_TYPE.DERIVED_FACT,
      sourceAuthorities: Array.from(combinedAuthorities),
      provenance: combinedProvenances.every(pr => pr === combinedProvenances[0]) ? combinedProvenances[0] : ENTITY_PROVENANCE.DERIVED_COMPOSITE,
      evidenceRefs: combinedEvidence,
      transitiveLineage: {
        directSourceFactRefs: keysToMerge,
        rootVerifiedFactKeys: Array.from(rootKeys),
        rootEvidenceChunkIds: Array.from(rootChunks),
        derivationSteps: [{ operation: TRANSFORM_OPERATION.MERGE, taskId: node.taskId }],
        sourceProvenances: combinedProvenances
      },
      _fromTaskId: node.taskId
    };

    return {
      status: TASK_STATUS.SUCCEEDED,
      output: {
        verifiedEntities: [commonEntity],
        verifiedAspects: [commonAspect],
        structuredFacts: { [p.destinationFactKey]: mergedFact },
        acceptedEvidence: combinedEvidence,
        answerability: 'ANSWERABLE'
      }
    };
  }

  // Fallback for FILTER / SORT
  return { status: TASK_STATUS.FAILED, error: { code: 'UNSUPPORTED_OPERATION', message: `Operation ${op} not fully configured` } };
}

/**
 * Executes an evidence aggregation task node.
 */
function executeEvidenceAggregation(node, allNodes) {
  const bindings = node.input.upstreamFactBindings || [];
  const combinedFacts = {};
  const combinedEvidence = [];
  const entities = new Set();
  const aspects = new Set();

  for (const binding of bindings) {
    const upNode = allNodes.get(binding.fromTaskId);
    if (!upNode || upNode.status !== TASK_STATUS.SUCCEEDED || !upNode.output) {
      return { status: TASK_STATUS.FAILED, error: { code: 'UPSTREAM_NODE_UNAVAILABLE', message: `Upstream node ${binding.fromTaskId} not succeeded` } };
    }
    const fact = upNode.output.structuredFacts?.[binding.factKey];
    if (!fact) {
      return { status: TASK_STATUS.FAILED, error: { code: 'FACT_NOT_FOUND', message: `Fact ${binding.factKey} not found in ${binding.fromTaskId}` } };
    }
    combinedFacts[binding.factKey] = fact;
    entities.add(fact.entity);
    aspects.add(fact.aspect);
    (fact.evidenceRefs || []).forEach(e => combinedEvidence.push(e));
  }

  return {
    status: TASK_STATUS.SUCCEEDED,
    output: {
      verifiedEntities: Array.from(entities),
      verifiedAspects: Array.from(aspects),
      structuredFacts: combinedFacts,
      acceptedEvidence: combinedEvidence,
      answerability: 'ANSWERABLE'
    }
  };
}

/**
 * Executes a single task node.
 */
async function executeTaskNode(node, graph, phase1BridgeFn, replanBridgeFn) {
  node.status = TASK_STATUS.RUNNING;
  node.executionStartTime = Date.now();

  try {
    if (node.taskType === TASK_TYPE.RETRIEVAL_QUERY) {
      // Delegate strictly to Phase 1 Bridge
      const bridgeResult = await phase1BridgeFn(node.input.queryText, {
        targetEntity: node.input.targetEntity,
        targetDomain: node.input.targetDomain,
        aspects: node.input.aspects
      });

      // Check if evidence is sufficient or eligible for replan
      const isAnswerable = bridgeResult && bridgeResult.answerability === 'ANSWERABLE';
      const hasAcceptedEvidence = bridgeResult && Array.isArray(bridgeResult.acceptedEvidence) && bridgeResult.acceptedEvidence.length > 0;

      if (!isAnswerable || !hasAcceptedEvidence) {
        // Check replan eligibility (Invariant 10)
        const now = Date.now();
        if (graph._replanCount === 0 && now < graph.replanDeadlineMs && typeof replanBridgeFn === 'function') {
          node.controlSignal = NODE_CONTROL_SIGNAL.REPLAN_REQUESTED;
          logger.info({ taskId: node.taskId }, '[TaskGraphExecutor] Node requested replan signal');

          graph._replanCount = 1;
          const replanResult = await replanBridgeFn(node, graph);
          node.controlSignal = NODE_CONTROL_SIGNAL.NONE; // Restored terminal controlSignal

          if (replanResult && replanResult.status === TASK_STATUS.SUCCEEDED) {
            node.status = TASK_STATUS.SUCCEEDED;
            node.output = replanResult.output;
            node.executionEndTime = Date.now();
            return;
          } else if (replanResult && replanResult.status === TASK_STATUS.FAILED) {
            node.status = TASK_STATUS.FAILED;
            node.error = replanResult.error || { code: 'REPLAN_FAILED', message: 'Replan execution failed' };
            node.executionEndTime = Date.now();
            return;
          }
        }

        // If replan was not attempted or yielded no evidence
        node.controlSignal = NODE_CONTROL_SIGNAL.NONE;
        node.status = TASK_STATUS.INSUFFICIENT_EVIDENCE;
        node.output = {
          verifiedEntities: [],
          verifiedAspects: [],
          structuredFacts: {},
          acceptedEvidence: [],
          answerability: 'UNKNOWN'
        };
        node.executionEndTime = Date.now();
        return;
      }

      // Convert bridgeResult into structuredFacts adhering to contract
      const structuredFacts = {};
      if (bridgeResult.structuredFacts) {
        for (const [k, f] of Object.entries(bridgeResult.structuredFacts)) {
          const factObj = { ...f, factKey: k, _fromTaskId: node.taskId };
          const validation = validateStructuredFact(k, factObj);
          if (!validation.valid) {
            node.status = TASK_STATUS.FAILED;
            node.error = { code: 'INVALID_FACT_PAYLOAD', message: validation.reason };
            node.executionEndTime = Date.now();
            return;
          }
          structuredFacts[k] = factObj;
        }
      }

      node.status = TASK_STATUS.SUCCEEDED;
      node.output = {
        verifiedEntities: bridgeResult.verifiedEntities || (node.input.targetEntity ? [node.input.targetEntity] : []),
        verifiedAspects: bridgeResult.verifiedAspects || (node.input.aspects || []),
        structuredFacts,
        acceptedEvidence: bridgeResult.acceptedEvidence,
        answerability: bridgeResult.answerability
      };
    } else if (node.taskType === TASK_TYPE.DETERMINISTIC_TRANSFORM) {
      const transformRes = executeDeterministicTransform(node, graph.nodes);
      node.status = transformRes.status;
      node.output = transformRes.output;
      node.error = transformRes.error;
    } else if (node.taskType === TASK_TYPE.EVIDENCE_AGGREGATION) {
      const aggRes = executeEvidenceAggregation(node, graph.nodes);
      node.status = aggRes.status;
      node.output = aggRes.output;
      node.error = aggRes.error;
    }
  } catch (err) {
    node.status = TASK_STATUS.FAILED;
    node.error = { code: 'TASK_RUNTIME_EXCEPTION', message: err.message };
  } finally {
    node.executionEndTime = Date.now();
    node.controlSignal = NODE_CONTROL_SIGNAL.NONE; // Guarantee terminal signal
  }
}

/**
 * Main execution engine for TaskGraph.
 * Coordinates topological waves, budget limits, replan delegate, and goal evaluator.
 */
async function executeTaskGraph(graph, options = {}) {
  const phase1BridgeFn = options.phase1BridgeFn || (async () => ({ answerability: 'UNKNOWN', acceptedEvidence: [] }));
  const replanBridgeFn = options.replanBridgeFn || null;

  // 1. Static Validation Upfront
  const validation = validateTaskGraph(graph);
  if (!validation.valid) {
    graph.completionState = GRAPH_COMPLETION_STATE.INVALID_TOPOLOGY;
    return {
      graphId: graph.graphId,
      completionState: GRAPH_COMPLETION_STATE.INVALID_TOPOLOGY,
      error: { code: validation.code, reason: validation.reason },
      evaluatedGoals: []
    };
  }

  graph._replanCount = 0;
  graph._executionTimedOut = false;

  const completedNodeIds = new Set();
  const failedNodeIds = new Set();

  // 2. Wave Execution Loop
  let remainingNodes = new Map(graph.nodes);

  while (remainingNodes.size > 0) {
    const now = Date.now();

    // Check execution deadline (2100ms budget limit)
    if (now + NODE_EFFECTIVE_BUDGET_MS > graph.executionDeadlineMs) {
      graph._executionTimedOut = true;
      logger.warn({ now, deadline: graph.executionDeadlineMs }, '[TaskGraphExecutor] Reached execution deadline, stopping wave dispatch');
      break;
    }

    // Identify READY nodes (all dependsOn in completedNodeIds)
    const wave = [];
    for (const [tId, node] of remainingNodes.entries()) {
      const deps = node.dependsOn || [];
      const hasFailedDep = deps.some(d => failedNodeIds.has(d));

      if (hasFailedDep) {
        node.status = TASK_STATUS.SKIPPED;
        node.error = { code: 'UPSTREAM_FAILED', message: 'One or more dependencies failed' };
        failedNodeIds.add(tId);
        remainingNodes.delete(tId);
        continue;
      }

      const allDepsSucceeded = deps.every(d => completedNodeIds.has(d));
      if (allDepsSucceeded) {
        node.status = TASK_STATUS.READY;
        wave.push(node);
      }
    }

    if (wave.length === 0) {
      // No more nodes ready to run
      break;
    }

    // Execute wave nodes concurrently
    await Promise.allSettled(wave.map(node => executeTaskNode(node, graph, phase1BridgeFn, replanBridgeFn)));

    // Process wave results
    for (const node of wave) {
      remainingNodes.delete(node.taskId);
      if (node.status === TASK_STATUS.SUCCEEDED) {
        completedNodeIds.add(node.taskId);
      } else {
        failedNodeIds.add(node.taskId);
        if (graph.executionPolicy === EXECUTION_POLICY.FAIL_FAST && node.criticality === TASK_CRITICALITY.REQUIRED) {
          logger.warn({ taskId: node.taskId }, '[TaskGraphExecutor] FAIL_FAST triggered by required node failure');
          // Skip remaining nodes
          for (const [remId, remNode] of remainingNodes.entries()) {
            remNode.status = TASK_STATUS.SKIPPED;
            remNode.error = { code: 'FAIL_FAST_ABORT', message: 'Aborted due to required failure under FAIL_FAST' };
            failedNodeIds.add(remId);
          }
          remainingNodes.clear();
          break;
        }
      }
    }
  }

  // Mark any remaining unfinished nodes as SKIPPED due to timeout or unreached state
  for (const remNode of remainingNodes.values()) {
    if (remNode.status === TASK_STATUS.PLANNED || remNode.status === TASK_STATUS.READY) {
      remNode.status = TASK_STATUS.SKIPPED;
      remNode.error = { code: 'EXECUTION_CUTOFF', message: 'Node not executed due to deadline or policy' };
    }
  }

  // 3. Evaluate Goal Requirements
  const goalEvaluation = evaluateGoalRequirements(graph.goalRequirements, graph.nodes);

  // 4. Determine Terminal Completion State
  graph.completionState = evaluateGraphCompletion(graph, goalEvaluation);
  graph.endTime = Date.now();

  return {
    graphId: graph.graphId,
    completionState: graph.completionState,
    allGoalsSatisfied: goalEvaluation.allSatisfied,
    evaluatedGoals: goalEvaluation.evaluated,
    consolidatedFacts: goalEvaluation.consolidatedFacts,
    nodes: Object.fromEntries(graph.nodes)
  };
}

module.exports = {
  evaluateGoalRequirements,
  evaluateGraphCompletion,
  executeTaskNode,
  executeTaskGraph
};
