'use strict';

/**
 * src/reasoning/taskGraph.js
 * 
 * Phase 2 Step 5: Multi-Step Task Graph / Task DAG Topology & Validation.
 * 
 * Strict Invariants:
 * 1. Single Source of Truth for Topology: node.dependsOn.
 * 2. derivedEdges is strictly derived from dependsOn (no planner-supplied edges).
 * 3. Topological depth capped at 3 (root = 1, A->B = 2, A->B->C = 3, depth > 3 rejected).
 * 4. Maximum nodes capped at 5.
 * 5. Type-safe task input matrix based on taskType.
 * 6. Static goalTaskBindings validation: Every GoalRequirement must be bound to a reachable,
 *    semantically compatible REQUIRED task.
 * 7. Rejection of cycles, missing dependencies, self-dependencies, orphans, and malformed contracts.
 */

const {
  TASK_TYPE,
  TASK_STATUS,
  TASK_CRITICALITY,
  NODE_CONTROL_SIGNAL,
  EXECUTION_POLICY,
  GRAPH_COMPLETION_STATE,
  TRANSFORM_OPERATION,
  MAX_GRAPH_NODES,
  MAX_GRAPH_DEPTH,
  NODE_EFFECTIVE_BUDGET_MS,
  GRAPH_EXECUTION_DEADLINE_MS,
  GRAPH_RESERVED_FINALIZATION_MS,
  deriveEdges,
  computeTopologicalDepth
} = require('./contracts');

/**
 * Validates the input matrix for a single TaskNode based on its taskType.
 */
function validateTaskInputMatrix(node) {
  const input = node.input || {};
  const tType = node.taskType;

  if (!Object.values(TASK_TYPE).includes(tType)) {
    return { valid: false, code: 'INVALID_TASK_TYPE', reason: `Unknown taskType: ${tType}` };
  }

  if (tType === TASK_TYPE.RETRIEVAL_QUERY) {
    if (!input.queryText || typeof input.queryText !== 'string' || !input.queryText.trim()) {
      return { valid: false, code: 'INVALID_TASK_CONTRACT', reason: `RETRIEVAL_QUERY task ${node.taskId} must have non-empty queryText` };
    }
    if (input.transformConfig) {
      return { valid: false, code: 'INVALID_TASK_CONTRACT', reason: `RETRIEVAL_QUERY task ${node.taskId} cannot have transformConfig` };
    }
    if (Array.isArray(input.upstreamFactBindings) && input.upstreamFactBindings.length > 0) {
      return { valid: false, code: 'INVALID_TASK_CONTRACT', reason: `RETRIEVAL_QUERY task ${node.taskId} cannot have upstreamFactBindings` };
    }
  } else if (tType === TASK_TYPE.DETERMINISTIC_TRANSFORM) {
    if (input.queryText) {
      return { valid: false, code: 'INVALID_TASK_CONTRACT', reason: `DETERMINISTIC_TRANSFORM task ${node.taskId} cannot have queryText` };
    }
    if (!input.transformConfig || typeof input.transformConfig !== 'object') {
      return { valid: false, code: 'INVALID_TASK_CONTRACT', reason: `DETERMINISTIC_TRANSFORM task ${node.taskId} requires transformConfig` };
    }
    if (!Object.values(TRANSFORM_OPERATION).includes(input.transformConfig.operation)) {
      return { valid: false, code: 'INVALID_TASK_CONTRACT', reason: `Invalid transform operation: ${input.transformConfig.operation}` };
    }
    if (!Array.isArray(input.upstreamFactBindings) || input.upstreamFactBindings.length === 0) {
      return { valid: false, code: 'INVALID_TASK_CONTRACT', reason: `DETERMINISTIC_TRANSFORM task ${node.taskId} requires upstreamFactBindings` };
    }
  } else if (tType === TASK_TYPE.EVIDENCE_AGGREGATION) {
    if (input.queryText) {
      return { valid: false, code: 'INVALID_TASK_CONTRACT', reason: `EVIDENCE_AGGREGATION task ${node.taskId} cannot have queryText` };
    }
    if (input.transformConfig) {
      return { valid: false, code: 'INVALID_TASK_CONTRACT', reason: `EVIDENCE_AGGREGATION task ${node.taskId} cannot have transformConfig` };
    }
    if (!Array.isArray(input.upstreamFactBindings) || input.upstreamFactBindings.length === 0) {
      return { valid: false, code: 'INVALID_TASK_CONTRACT', reason: `EVIDENCE_AGGREGATION task ${node.taskId} requires upstreamFactBindings` };
    }
  }

  return { valid: true };
}

/**
 * Validates static goalTaskBindings against GoalRequirements and TaskNodes.
 */
function validateGoalTaskBindings(goalRequirements = [], goalTaskBindings = [], nodesMap = new Map()) {
  const reqMap = new Map(goalRequirements.map(g => [g.requirementId, g]));
  const bindingMap = new Map();

  for (const b of goalTaskBindings) {
    if (!b || typeof b !== 'object') {
      return { valid: false, code: 'INVALID_TOPOLOGY', reason: 'malformed_goal_task_binding' };
    }
    if (!b.requirementId || !Array.isArray(b.requiredTaskIds) || b.requiredTaskIds.length === 0) {
      return { valid: false, code: 'INVALID_TOPOLOGY', reason: `incomplete_binding_for_${b.requirementId}` };
    }
    bindingMap.set(b.requirementId, b);
  }

  // Every GoalRequirement must have a GoalTaskBinding
  for (const [reqId, req] of reqMap.entries()) {
    const binding = bindingMap.get(reqId);
    if (!binding) {
      return { valid: false, code: 'INVALID_TOPOLOGY', reason: `missing_binding_for_requirement_${reqId}` };
    }

    for (const taskId of binding.requiredTaskIds) {
      const task = nodesMap.get(taskId);
      if (!task) {
        return { valid: false, code: 'INVALID_TOPOLOGY', reason: `binding_references_unknown_task_${taskId}` };
      }

      // Must be REQUIRED
      if (task.criticality !== TASK_CRITICALITY.REQUIRED) {
        return { valid: false, code: 'ILLEGAL_GOAL_DOWNGRADE', reason: `goal_${reqId}_bound_to_optional_task_${taskId}` };
      }

      // Check semantic compatibility with declaredContract
      const declared = task.declaredContract || {};
      const declaredKeys = Array.isArray(declared.declaredOutputFactKeys) ? declared.declaredOutputFactKeys : [];
      const declaredEntities = Array.isArray(declared.declaredEntities) ? declared.declaredEntities : [];
      const declaredAspects = Array.isArray(declared.declaredAspects) ? declared.declaredAspects : [];

      if (declaredKeys.length > 0 && !declaredKeys.includes(req.factKey)) {
        return {
          valid: false,
          code: 'INCOMPATIBLE_GOAL_BINDING',
          reason: `task_${taskId}_declared_keys_do_not_include_factKey_${req.factKey}`
        };
      }

      if (declaredEntities.length > 0 && req.entity && !declaredEntities.includes(req.entity)) {
        return {
          valid: false,
          code: 'INCOMPATIBLE_GOAL_BINDING',
          reason: `task_${taskId}_declared_entities_do_not_include_${req.entity}`
        };
      }

      if (declaredAspects.length > 0 && req.aspect && !declaredAspects.includes(req.aspect)) {
        return {
          valid: false,
          code: 'INCOMPATIBLE_GOAL_BINDING',
          reason: `task_${taskId}_declared_aspects_do_not_include_${req.aspect}`
        };
      }
    }
  }

  return { valid: true };
}

/**
 * Validates the entire TaskGraph statically before any execution.
 */
function validateTaskGraph(graph) {
  if (!graph || typeof graph !== 'object') {
    return { valid: false, code: 'INVALID_TOPOLOGY', reason: 'graph_not_an_object' };
  }

  const nodes = graph.nodes instanceof Map ? graph.nodes : new Map(Object.entries(graph.nodes || {}));

  // 1. Duplicate Task ID Check
  if (Array.isArray(graph._rawNodeIds)) {
    const seen = new Set();
    for (const id of graph._rawNodeIds) {
      if (seen.has(id)) {
        return { valid: false, code: 'INVALID_TOPOLOGY', reason: `duplicate_task_id_detected: ${id}` };
      }
      seen.add(id);
    }
  }

  // 2. Node count <= 5
  if (nodes.size === 0) {
    return { valid: false, code: 'INVALID_TOPOLOGY', reason: 'empty_graph' };
  }
  if (nodes.size > MAX_GRAPH_NODES) {
    return { valid: false, code: 'INVALID_TOPOLOGY', reason: `node_count_${nodes.size}_exceeds_max_${MAX_GRAPH_NODES}` };
  }

  // 3. Self Dependency Check across all nodes
  for (const [taskId, node] of nodes.entries()) {
    if (Array.isArray(node.dependsOn) && node.dependsOn.includes(taskId)) {
      return { valid: false, code: 'INVALID_TOPOLOGY', reason: `self_dependency_detected_on_${taskId}` };
    }
  }

  // 4. Validate rootTaskIds
  if (!Array.isArray(graph.rootTaskIds) || graph.rootTaskIds.length === 0) {
    return { valid: false, code: 'INVALID_TOPOLOGY', reason: 'missing_root_task_ids' };
  }

  for (const rootId of graph.rootTaskIds) {
    const rootNode = nodes.get(rootId);
    if (!rootNode) {
      return { valid: false, code: 'INVALID_TOPOLOGY', reason: `root_task_${rootId}_not_found_in_nodes` };
    }
    if (Array.isArray(rootNode.dependsOn) && rootNode.dependsOn.length > 0) {
      return { valid: false, code: 'INVALID_TOPOLOGY', reason: `root_task_${rootId}_cannot_have_dependsOn` };
    }
  }

  // 5. Validate each task node
  const allTaskIds = new Set(nodes.keys());
  for (const [taskId, node] of nodes.entries()) {
    if (!node.taskId || node.taskId !== taskId) {
      return { valid: false, code: 'INVALID_TOPOLOGY', reason: `mismatched_taskId_for_${taskId}` };
    }
    if (![TASK_CRITICALITY.REQUIRED, TASK_CRITICALITY.OPTIONAL].includes(node.criticality)) {
      return { valid: false, code: 'INVALID_TOPOLOGY', reason: `invalid_criticality_for_${taskId}` };
    }

    // DependsOn validations
    if (Array.isArray(node.dependsOn)) {
      for (const depId of node.dependsOn) {
        if (!allTaskIds.has(depId)) {
          return { valid: false, code: 'INVALID_TOPOLOGY', reason: `missing_dependency_${depId}_for_${taskId}` };
        }
      }
    }

    // Input matrix validation
    const inputValidation = validateTaskInputMatrix(node);
    if (!inputValidation.valid) {
      return { valid: false, code: inputValidation.code || 'INVALID_TOPOLOGY', reason: inputValidation.reason };
    }
  }

  // 4. Reachability & Orphan / Disconnected Node check
  const reachable = new Set();
  function traverse(currentId) {
    reachable.add(currentId);
    for (const [tId, tNode] of nodes.entries()) {
      if (Array.isArray(tNode.dependsOn) && tNode.dependsOn.includes(currentId)) {
        if (!reachable.has(tId)) {
          traverse(tId);
        }
      }
    }
  }
  for (const rootId of graph.rootTaskIds) {
    traverse(rootId);
  }
  for (const taskId of nodes.keys()) {
    if (!reachable.has(taskId)) {
      return { valid: false, code: 'INVALID_TOPOLOGY', reason: `orphan_or_disconnected_node_${taskId}` };
    }
  }

  // 5. Depth and Cycle Check
  const depth = computeTopologicalDepth(nodes);
  if (depth === Infinity) {
    return { valid: false, code: 'INVALID_TOPOLOGY', reason: 'cyclic_dependency_detected' };
  }
  if (depth > MAX_GRAPH_DEPTH) {
    return { valid: false, code: 'INVALID_TOPOLOGY', reason: `dependency_depth_${depth}_exceeds_max_${MAX_GRAPH_DEPTH}` };
  }

  // 6. Validate goalTaskBindings if goalRequirements are present
  if (Array.isArray(graph.goalRequirements) && graph.goalRequirements.length > 0) {
    const goalBindings = Array.isArray(graph.goalTaskBindings) ? graph.goalTaskBindings : [];
    const bindingValidation = validateGoalTaskBindings(graph.goalRequirements, goalBindings, nodes);
    if (!bindingValidation.valid) {
      return { valid: false, code: bindingValidation.code || 'INVALID_TOPOLOGY', reason: bindingValidation.reason };
    }
  }

  return { valid: true };
}

/**
 * Creates a fully validated TaskGraph structure.
 */
function createTaskGraph(params = {}) {
  const rawNodeIds = [];
  const nodesMap = new Map();
  if (Array.isArray(params.nodes)) {
    for (const n of params.nodes) {
      rawNodeIds.push(n.taskId);
      nodesMap.set(n.taskId, { ...n, status: n.status || TASK_STATUS.PLANNED });
    }
  } else if (params.nodes instanceof Map) {
    for (const [k, v] of params.nodes.entries()) {
      rawNodeIds.push(k);
      nodesMap.set(k, { ...v, status: v.status || TASK_STATUS.PLANNED });
    }
  } else if (params.nodes && typeof params.nodes === 'object') {
    for (const [k, v] of Object.entries(params.nodes)) {
      rawNodeIds.push(k);
      nodesMap.set(k, { ...v, status: v.status || TASK_STATUS.PLANNED });
    }
  }

  const derivedEdges = deriveEdges(nodesMap);

  const graph = {
    graphId: params.graphId || `dag_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    rawQuery: params.rawQuery || '',
    goalRequirements: Array.isArray(params.goalRequirements) ? params.goalRequirements : [],
    goalTaskBindings: Array.isArray(params.goalTaskBindings) ? params.goalTaskBindings : [],
    rootTaskIds: Array.isArray(params.rootTaskIds) ? params.rootTaskIds : [],
    nodes: nodesMap,
    derivedEdges,
    _rawNodeIds: rawNodeIds,
    executionPolicy: params.executionPolicy || EXECUTION_POLICY.FAIL_FAST,
    maxNodes: MAX_GRAPH_NODES,
    maxDepth: MAX_GRAPH_DEPTH,
    totalTurnBudgetMs: 2500,
    executionDeadlineMs: (params.startTime || Date.now()) + GRAPH_EXECUTION_DEADLINE_MS,
    replanDeadlineMs: (params.startTime || Date.now()) + 1500,
    reservedFinalizationMs: GRAPH_RESERVED_FINALIZATION_MS,
    startTime: params.startTime || Date.now(),
    completionState: GRAPH_COMPLETION_STATE.PENDING,
    contextSnapshot: Object.freeze(params.contextSnapshot || {})
  };

  return graph;
}

module.exports = {
  validateTaskInputMatrix,
  validateGoalTaskBindings,
  validateTaskGraph,
  createTaskGraph
};
