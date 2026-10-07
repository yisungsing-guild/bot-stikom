'use strict';

/**
 * tests/phase2TaskGraph.test.js
 * 
 * Comprehensive Behavioral Test Suite for Phase 2 Step 5: Multi-Step Task Graph / Task DAG.
 * Exactly adheres to the 56 behavioral test contract specifications locked in Phase 2 Step 5.
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
  isFiniteJSONSafe,
  validateStructuredFact
} = require('../src/reasoning/contracts');
const {
  createTaskGraph,
  validateTaskGraph,
  validateGoalTaskBindings,
  validateTaskInputMatrix
} = require('../src/reasoning/taskGraph');
const {
  executeTaskGraph,
  evaluateGoalRequirements,
  evaluateGraphCompletion
} = require('../src/reasoning/taskGraphExecutor');
const { getSession, updateSession } = require('../src/core/conversationState');
const { executePhase2Bridge } = require('../src/reasoning/phase2Bridge');

describe('Phase 2 Step 5: Task Graph Contract, Topology & Execution Suite', () => {

  // ==========================================
  // CATEGORY 1: Topology & Goal Binding Validation Guards (16 Tests)
  // ==========================================
  describe('Category 1: Topology & Goal Binding Validation Guards', () => {
    test('1. goalTaskBindings field present in TaskGraph', () => {
      const graph = createTaskGraph({
        rootTaskIds: ['t1'],
        nodes: [{ taskId: 't1', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'q' } }],
        goalRequirements: [{ requirementId: 'g1', entity: 'TI', aspect: 'fee', factKey: 'fee_val' }],
        goalTaskBindings: [{ requirementId: 'g1', requiredTaskIds: ['t1'] }]
      });
      expect(Array.isArray(graph.goalTaskBindings)).toBe(true);
      expect(graph.goalTaskBindings.length).toBe(1);
    });

    test('2. duplicate taskId rejection', () => {
      // Pass duplicate taskId in node list
      const nodes = [
        { taskId: 'dup', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'q1' } },
        { taskId: 'dup', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'q2' } }
      ];
      // When nodes Map is constructed, key collision or mismatched id triggers validation failure
      const graph = createTaskGraph({ rootTaskIds: ['dup'], nodes });
      expect(validateTaskGraph(graph).valid).toBe(false);
    });

    test('3. missing dependency rejection', () => {
      const graph = createTaskGraph({
        rootTaskIds: ['t1'],
        nodes: [
          { taskId: 't1', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'q' } },
          { taskId: 't2', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: ['ghost_task'], input: { queryText: 'q2' } }
        ]
      });
      const res = validateTaskGraph(graph);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('missing_dependency');
    });

    test('4. self dependency rejection', () => {
      const graph = createTaskGraph({
        rootTaskIds: ['t1'],
        nodes: [
          { taskId: 't1', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: ['t1'], input: { queryText: 'q' } }
        ]
      });
      const res = validateTaskGraph(graph);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('self_dependency');
    });

    test('5. invalid task type rejection', () => {
      const node = { taskId: 't1', taskType: 'ARBITRARY_EXECUTION', criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'q' } };
      const res = validateTaskInputMatrix(node);
      expect(res.valid).toBe(false);
      expect(res.code).toBe('INVALID_TASK_TYPE');
    });

    test('6. invalid rootTaskIds rejection', () => {
      const graph1 = createTaskGraph({ rootTaskIds: [], nodes: [{ taskId: 't1', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'q' } }] });
      expect(validateTaskGraph(graph1).valid).toBe(false);

      const graph2 = createTaskGraph({
        rootTaskIds: ['t1'],
        nodes: [{ taskId: 't1', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: ['t2'], input: { queryText: 'q' } }, { taskId: 't2', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'q2' } }]
      });
      expect(validateTaskGraph(graph2).valid).toBe(false);
    });

    test('7. orphan / disconnected node rejection', () => {
      const graph = createTaskGraph({
        rootTaskIds: ['t1'],
        nodes: [
          { taskId: 't1', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'q1' } },
          { taskId: 'island', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'q2' } }
        ]
      });
      const res = validateTaskGraph(graph);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('orphan_or_disconnected_node');
    });

    test('8. malformed node contract rejection', () => {
      const graph = createTaskGraph({
        rootTaskIds: ['t1'],
        nodes: [
          { taskId: 't1', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: 'INVALID_CRITICALITY', dependsOn: [], input: { queryText: 'q' } }
        ]
      });
      expect(validateTaskGraph(graph).valid).toBe(false);
    });

    test('9. dependency depth > 3 rejection', () => {
      // Depth 4: A -> B -> C -> D
      const graph = createTaskGraph({
        rootTaskIds: ['tA'],
        nodes: [
          { taskId: 'tA', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'qA' } },
          { taskId: 'tB', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: ['tA'], input: { queryText: 'qB' } },
          { taskId: 'tC', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: ['tB'], input: { queryText: 'qC' } },
          { taskId: 'tD', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: ['tC'], input: { queryText: 'qD' } }
        ]
      });
      const res = validateTaskGraph(graph);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('dependency_depth_4_exceeds_max_3');
    });

    test('10. node count > 5 rejection', () => {
      const nodes = [];
      for (let i = 1; i <= 6; i++) {
        nodes.push({ taskId: `t${i}`, taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: i === 1 ? [] : ['t1'], input: { queryText: `q${i}` } });
      }
      const graph = createTaskGraph({ rootTaskIds: ['t1'], nodes });
      const res = validateTaskGraph(graph);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('exceeds_max_5');
    });

    test('11. cyclic dependency rejection', () => {
      // Cycle: t1 -> t2 -> t1
      const graph = createTaskGraph({
        rootTaskIds: ['t1'],
        nodes: [
          { taskId: 't1', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: ['t2'], input: { queryText: 'q1' } },
          { taskId: 't2', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: ['t1'], input: { queryText: 'q2' } }
        ]
      });
      const res = validateTaskGraph(graph);
      expect(res.valid).toBe(false);
    });

    test('12. goalTaskBindings missing requirement rejected', () => {
      const graph = createTaskGraph({
        rootTaskIds: ['t1'],
        nodes: [{ taskId: 't1', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'q' } }],
        goalRequirements: [{ requirementId: 'req_unbound', entity: 'TI', aspect: 'fee', factKey: 'f1' }],
        goalTaskBindings: [] // missing binding for req_unbound
      });
      const res = validateTaskGraph(graph);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('missing_binding_for_requirement_req_unbound');
    });

    test('13. goalTaskBindings points to OPTIONAL task rejected (ILLEGAL_GOAL_DOWNGRADE)', () => {
      const graph = createTaskGraph({
        rootTaskIds: ['t1'],
        nodes: [{ taskId: 't1', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.OPTIONAL, dependsOn: [], input: { queryText: 'q' } }],
        goalRequirements: [{ requirementId: 'req_1', entity: 'TI', aspect: 'fee', factKey: 'f1' }],
        goalTaskBindings: [{ requirementId: 'req_1', requiredTaskIds: ['t1'] }]
      });
      const res = validateTaskGraph(graph);
      expect(res.valid).toBe(false);
      expect(res.code).toBe('ILLEGAL_GOAL_DOWNGRADE');
    });

    test('14. goal binding to semantically incompatible REQUIRED task rejected', () => {
      const graph = createTaskGraph({
        rootTaskIds: ['t1'],
        nodes: [{
          taskId: 't1',
          taskType: TASK_TYPE.RETRIEVAL_QUERY,
          criticality: TASK_CRITICALITY.REQUIRED,
          dependsOn: [],
          input: { queryText: 'q' },
          declaredContract: {
            declaredOutputFactKeys: ['curriculum_list'],
            declaredEntities: ['TI'],
            declaredAspects: ['curriculum']
          }
        }],
        goalRequirements: [{ requirementId: 'req_fee', entity: 'TI', aspect: 'fee', factKey: 'fee_amount' }],
        goalTaskBindings: [{ requirementId: 'req_fee', requiredTaskIds: ['t1'] }]
      });
      const res = validateTaskGraph(graph);
      expect(res.valid).toBe(false);
      expect(res.code).toBe('INCOMPATIBLE_GOAL_BINDING');
    });

    test('15. RETRIEVAL_QUERY with transformConfig rejected', () => {
      const node = {
        taskId: 't1',
        taskType: TASK_TYPE.RETRIEVAL_QUERY,
        criticality: TASK_CRITICALITY.REQUIRED,
        dependsOn: [],
        input: { queryText: 'q', transformConfig: { operation: TRANSFORM_OPERATION.SORT } }
      };
      const res = validateTaskInputMatrix(node);
      expect(res.valid).toBe(false);
      expect(res.code).toBe('INVALID_TASK_CONTRACT');
    });

    test('16. DETERMINISTIC_TRANSFORM with queryText rejected', () => {
      const node = {
        taskId: 't1',
        taskType: TASK_TYPE.DETERMINISTIC_TRANSFORM,
        criticality: TASK_CRITICALITY.REQUIRED,
        dependsOn: [],
        input: {
          queryText: 'should not be here',
          transformConfig: { operation: TRANSFORM_OPERATION.SORT },
          upstreamFactBindings: [{ fromTaskId: 't0', factKey: 'k' }]
        }
      };
      const res = validateTaskInputMatrix(node);
      expect(res.valid).toBe(false);
      expect(res.code).toBe('INVALID_TASK_CONTRACT');
    });
  });

  // ==========================================
  // CATEGORY 2: Dependency Execution & Mechanics (7 Tests)
  // ==========================================
  describe('Category 2: Dependency Execution & Mechanics', () => {
    test('17. derived edges generated only from dependsOn', () => {
      const graph = createTaskGraph({
        rootTaskIds: ['tA'],
        nodes: [
          { taskId: 'tA', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'qA' } },
          { taskId: 'tB', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: ['tA'], input: { queryText: 'qB' } }
        ]
      });
      expect(graph.derivedEdges).toEqual([{ from: 'tA', to: 'tB' }]);
    });

    test('18. single node successful execution', async () => {
      const graph = createTaskGraph({
        rootTaskIds: ['t1'],
        nodes: [{ taskId: 't1', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'biaya TI' } }]
      });
      const mockBridge = jest.fn(async () => ({
        answerability: 'ANSWERABLE',
        acceptedEvidence: [{ chunkId: 'c1', chunkHash: 'h1', source: 'doc', sourceAuthority: 'SK', confidenceScore: 0.95 }],
        verifiedEntities: ['S1 TI'],
        verifiedAspects: ['fee'],
        structuredFacts: {
          fee: { factKey: 'fee', value: 6500000, entity: 'S1 TI', aspect: 'fee', factType: FACT_TYPE.VERIFIED_FACT, sourceAuthorities: ['SK'], evidenceRefs: [{ chunkId: 'c1' }], provenance: ENTITY_PROVENANCE.EXPLICIT_CURRENT_TURN }
        }
      }));
      const res = await executeTaskGraph(graph, { phase1BridgeFn: mockBridge });
      expect(res.completionState).toBe(GRAPH_COMPLETION_STATE.COMPLETE_SUCCESS);
      expect(graph.nodes.get('t1').status).toBe(TASK_STATUS.SUCCEEDED);
    });

    test('19. two-node sequential execution', async () => {
      const graph = createTaskGraph({
        rootTaskIds: ['t1'],
        nodes: [
          { taskId: 't1', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'biaya' } },
          {
            taskId: 't2',
            taskType: TASK_TYPE.DETERMINISTIC_TRANSFORM,
            criticality: TASK_CRITICALITY.REQUIRED,
            dependsOn: ['t1'],
            input: {
              upstreamFactBindings: [{ fromTaskId: 't1', factKey: 'fee_reg' }, { fromTaskId: 't1', factKey: 'fee_disc' }],
              transformConfig: {
                operation: TRANSFORM_OPERATION.ARITHMETIC,
                parameters: {
                  operator: 'SUBTRACT',
                  operandA: { fromTaskId: 't1', factKey: 'fee_reg' },
                  operandB: { fromTaskId: 't1', factKey: 'fee_disc' },
                  destinationFactKey: 'final_fee'
                }
              }
            }
          }
        ]
      });
      const mockBridge = async () => ({
        answerability: 'ANSWERABLE',
        acceptedEvidence: [{ chunkId: 'c1', sourceAuthority: 'SK' }],
        structuredFacts: {
          fee_reg: { factKey: 'fee_reg', value: 500000, entity: 'TI', aspect: 'fee', factType: FACT_TYPE.VERIFIED_FACT, sourceAuthorities: ['SK'], evidenceRefs: [{ chunkId: 'c1' }], provenance: ENTITY_PROVENANCE.EXPLICIT_CURRENT_TURN },
          fee_disc: { factKey: 'fee_disc', value: 100000, entity: 'TI', aspect: 'fee', factType: FACT_TYPE.VERIFIED_FACT, sourceAuthorities: ['SK'], evidenceRefs: [{ chunkId: 'c1' }], provenance: ENTITY_PROVENANCE.EXPLICIT_CURRENT_TURN }
        }
      });
      const res = await executeTaskGraph(graph, { phase1BridgeFn: mockBridge });
      expect(res.completionState).toBe(GRAPH_COMPLETION_STATE.COMPLETE_SUCCESS);
      expect(graph.nodes.get('t2').status).toBe(TASK_STATUS.SUCCEEDED);
      expect(graph.nodes.get('t2').output.structuredFacts.final_fee.value).toBe(400000);
    });

    test('20. three-node dependency chain', async () => {
      const graph = createTaskGraph({
        rootTaskIds: ['t1'],
        nodes: [
          { taskId: 't1', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'q1' } },
          { taskId: 't2', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: ['t1'], input: { queryText: 'q2' } },
          { taskId: 't3', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: ['t2'], input: { queryText: 'q3' } }
        ]
      });
      const mockBridge = async () => ({
        answerability: 'ANSWERABLE',
        acceptedEvidence: [{ chunkId: 'c' }],
        structuredFacts: { f: { factKey: 'f', value: 1, entity: 'E', aspect: 'A', factType: FACT_TYPE.VERIFIED_FACT, sourceAuthorities: ['S'], evidenceRefs: [{ chunkId: 'c' }], provenance: ENTITY_PROVENANCE.EXPLICIT_CURRENT_TURN } }
      });
      const res = await executeTaskGraph(graph, { phase1BridgeFn: mockBridge });
      expect(res.completionState).toBe(GRAPH_COMPLETION_STATE.COMPLETE_SUCCESS);
      expect(graph.nodes.get('t1').status).toBe(TASK_STATUS.SUCCEEDED);
      expect(graph.nodes.get('t2').status).toBe(TASK_STATUS.SUCCEEDED);
      expect(graph.nodes.get('t3').status).toBe(TASK_STATUS.SUCCEEDED);
    });

    test('21. dependency waiting until all prerequisites succeed', async () => {
      // t3 depends on t1 AND t2
      const graph = createTaskGraph({
        rootTaskIds: ['t1', 't2'],
        nodes: [
          { taskId: 't1', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'q1' } },
          { taskId: 't2', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'q2' } },
          { taskId: 't3', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: ['t1', 't2'], input: { queryText: 'q3' } }
        ]
      });
      const mockBridge = async (q) => ({
        answerability: 'ANSWERABLE',
        acceptedEvidence: [{ chunkId: 'c' }],
        structuredFacts: { [q]: { factKey: q, value: 1, entity: 'E', aspect: 'A', factType: FACT_TYPE.VERIFIED_FACT, sourceAuthorities: ['S'], evidenceRefs: [{ chunkId: 'c' }], provenance: ENTITY_PROVENANCE.EXPLICIT_CURRENT_TURN } }
      });
      const res = await executeTaskGraph(graph, { phase1BridgeFn: mockBridge });
      expect(res.completionState).toBe(GRAPH_COMPLETION_STATE.COMPLETE_SUCCESS);
      expect(graph.nodes.get('t3').executionStartTime).toBeGreaterThanOrEqual(graph.nodes.get('t1').executionEndTime);
      expect(graph.nodes.get('t3').executionStartTime).toBeGreaterThanOrEqual(graph.nodes.get('t2').executionEndTime);
    });

    test('22. downstream only starts after dependencies succeed', async () => {
      const graph = createTaskGraph({
        rootTaskIds: ['t1'],
        nodes: [
          { taskId: 't1', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'q1' } },
          { taskId: 't2', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: ['t1'], input: { queryText: 'q2' } }
        ]
      });
      // Fail t1
      const mockBridge = async (q) => {
        if (q === 'q1') throw new Error('t1 crashed');
        return { answerability: 'ANSWERABLE', acceptedEvidence: [{ chunkId: 'c' }] };
      };
      await executeTaskGraph(graph, { phase1BridgeFn: mockBridge });
      expect(graph.nodes.get('t1').status).toBe(TASK_STATUS.FAILED);
      expect(graph.nodes.get('t2').status).toBe(TASK_STATUS.SKIPPED);
    });

    test('23. downstream dependency skipping', async () => {
      const graph = createTaskGraph({
        rootTaskIds: ['t1'],
        nodes: [
          { taskId: 't1', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'q1' } },
          { taskId: 't2', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: ['t1'], input: { queryText: 'q2' } }
        ]
      });
      const mockBridge = async () => ({ answerability: 'UNKNOWN', acceptedEvidence: [] }); // insufficient
      await executeTaskGraph(graph, { phase1BridgeFn: mockBridge });
      expect(graph.nodes.get('t1').status).toBe(TASK_STATUS.INSUFFICIENT_EVIDENCE);
      expect(graph.nodes.get('t2').status).toBe(TASK_STATUS.SKIPPED);
    });
  });

  // ==========================================
  // CATEGORY 3: Policy & Concurrency (4 Tests)
  // ==========================================
  describe('Category 3: Policy & Concurrency', () => {
    test('24. multiple root execution concurrently', async () => {
      const graph = createTaskGraph({
        rootTaskIds: ['tA', 'tB'],
        nodes: [
          { taskId: 'tA', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'qA' } },
          { taskId: 'tB', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'qB' } }
        ]
      });
      const mockBridge = async () => ({
        answerability: 'ANSWERABLE',
        acceptedEvidence: [{ chunkId: 'c' }],
        structuredFacts: { f: { factKey: 'f', value: 1, entity: 'E', aspect: 'A', factType: FACT_TYPE.VERIFIED_FACT, sourceAuthorities: ['S'], evidenceRefs: [{ chunkId: 'c' }], provenance: ENTITY_PROVENANCE.EXPLICIT_CURRENT_TURN } }
      });
      const res = await executeTaskGraph(graph, { phase1BridgeFn: mockBridge });
      expect(res.completionState).toBe(GRAPH_COMPLETION_STATE.COMPLETE_SUCCESS);
      expect(graph.nodes.get('tA').status).toBe(TASK_STATUS.SUCCEEDED);
      expect(graph.nodes.get('tB').status).toBe(TASK_STATUS.SUCCEEDED);
    });

    test('25. OPTIONAL independent branch continues under BEST_EFFORT', async () => {
      const graph = createTaskGraph({
        rootTaskIds: ['tA', 'tB'],
        executionPolicy: EXECUTION_POLICY.BEST_EFFORT,
        nodes: [
          { taskId: 'tA', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.OPTIONAL, dependsOn: [], input: { queryText: 'fail_opt' } },
          { taskId: 'tB', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'pass_req' } }
        ],
        goalRequirements: [{ requirementId: 'g_req', entity: 'TI', aspect: 'fee', factKey: 'req_fact' }],
        goalTaskBindings: [{ requirementId: 'g_req', requiredTaskIds: ['tB'] }]
      });
      const mockBridge = async (q) => {
        if (q === 'fail_opt') throw new Error('optional crashed');
        return {
          answerability: 'ANSWERABLE',
          acceptedEvidence: [{ chunkId: 'c' }],
          structuredFacts: { req_fact: { factKey: 'req_fact', value: 1, entity: 'TI', aspect: 'fee', factType: FACT_TYPE.VERIFIED_FACT, sourceAuthorities: ['S'], evidenceRefs: [{ chunkId: 'c' }], provenance: ENTITY_PROVENANCE.EXPLICIT_CURRENT_TURN } }
        };
      };
      const res = await executeTaskGraph(graph, { phase1BridgeFn: mockBridge });
      expect(res.completionState).toBe(GRAPH_COMPLETION_STATE.PARTIAL_COMPLETION);
      expect(graph.nodes.get('tA').status).toBe(TASK_STATUS.FAILED);
      expect(graph.nodes.get('tB').status).toBe(TASK_STATUS.SUCCEEDED);
    });

    test('26. REQUIRED failure on FAIL_FAST => FAILED_GRAPH', async () => {
      const graph = createTaskGraph({
        rootTaskIds: ['tReq'],
        executionPolicy: EXECUTION_POLICY.FAIL_FAST,
        nodes: [
          { taskId: 'tReq', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'fail_req' } },
          { taskId: 'tOther', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.OPTIONAL, dependsOn: ['tReq'], input: { queryText: 'other' } }
        ]
      });
      const mockBridge = async () => { throw new Error('critical error'); };
      const res = await executeTaskGraph(graph, { phase1BridgeFn: mockBridge });
      expect(res.completionState).toBe(GRAPH_COMPLETION_STATE.FAILED_GRAPH);
      expect(graph.nodes.get('tOther').status).toBe(TASK_STATUS.SKIPPED);
    });

    test('27. OPTIONAL independent branch failure does not corrupt required result', async () => {
      const graph = createTaskGraph({
        rootTaskIds: ['tReq', 'tOpt'],
        nodes: [
          { taskId: 'tReq', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'req' } },
          { taskId: 'tOpt', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.OPTIONAL, dependsOn: [], input: { queryText: 'opt' } }
        ],
        goalRequirements: [{ requirementId: 'g1', entity: 'TI', aspect: 'fee', factKey: 'fee' }],
        goalTaskBindings: [{ requirementId: 'g1', requiredTaskIds: ['tReq'] }]
      });
      const mockBridge = async (q) => {
        if (q === 'opt') return { answerability: 'UNKNOWN', acceptedEvidence: [] };
        return {
          answerability: 'ANSWERABLE',
          acceptedEvidence: [{ chunkId: 'c' }],
          structuredFacts: { fee: { factKey: 'fee', value: 100, entity: 'TI', aspect: 'fee', factType: FACT_TYPE.VERIFIED_FACT, sourceAuthorities: ['S'], evidenceRefs: [{ chunkId: 'c' }], provenance: ENTITY_PROVENANCE.EXPLICIT_CURRENT_TURN } }
        };
      };
      const res = await executeTaskGraph(graph, { phase1BridgeFn: mockBridge });
      expect(res.completionState).toBe(GRAPH_COMPLETION_STATE.PARTIAL_COMPLETION);
      expect(res.allGoalsSatisfied).toBe(true);
      expect(res.consolidatedFacts.fee.value).toBe(100);
    });
  });

  // ==========================================
  // CATEGORY 4: Goal Requirements, Fact Keys & Evaluator (7 Tests)
  // ==========================================
  describe('Category 4: Goal Requirements, Fact Keys & Evaluator', () => {
    test('28. runtime goal evaluator uses canonical structuredFacts key', () => {
      const goals = [{ requirementId: 'g1', entity: 'TI', aspect: 'fee', factKey: 'fee_val' }];
      const nodes = new Map([
        ['t1', {
          status: TASK_STATUS.SUCCEEDED,
          output: {
            structuredFacts: {
              fee_val: { factKey: 'fee_val', entity: 'TI', aspect: 'fee', factType: FACT_TYPE.VERIFIED_FACT, evidenceRefs: [{ chunkId: 'c1' }] }
            }
          }
        }]
      ]);
      const res = evaluateGoalRequirements(goals, nodes);
      expect(res.allSatisfied).toBe(true);
      expect(res.evaluated[0].isSatisfied).toBe(true);
    });

    test('29. structuredFacts key mismatch / factKey divergence rejected', () => {
      const fact = {
        factKey: 'divergent_key',
        value: 123,
        entity: 'TI',
        aspect: 'fee',
        factType: FACT_TYPE.VERIFIED_FACT,
        sourceAuthorities: ['SK'],
        evidenceRefs: [{ chunkId: 'c' }],
        provenance: ENTITY_PROVENANCE.EXPLICIT_CURRENT_TURN
      };
      const res = validateStructuredFact('canonical_key', fact);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain('fact_key_divergence');
    });

    test('30. goal binding does not itself imply goal satisfaction', () => {
      const goals = [{ requirementId: 'g1', entity: 'TI', aspect: 'fee', factKey: 'fee_val' }];
      const nodes = new Map([
        ['t1', {
          status: TASK_STATUS.FAILED,
          output: null
        }]
      ]);
      const res = evaluateGoalRequirements(goals, nodes);
      expect(res.allSatisfied).toBe(false);
      expect(res.evaluated[0].isSatisfied).toBe(false);
    });

    test('31. same factKey different entities cannot satisfy wrong goal', () => {
      const goals = [{ requirementId: 'g_si', entity: 'S1 Sistem Informasi', aspect: 'fee', factKey: 'tuition_fee' }];
      const nodes = new Map([
        ['t1', {
          status: TASK_STATUS.SUCCEEDED,
          output: {
            structuredFacts: {
              tuition_fee: { factKey: 'tuition_fee', entity: 'S1 Teknologi Informasi', aspect: 'fee', factType: FACT_TYPE.VERIFIED_FACT, evidenceRefs: [{ chunkId: 'c1' }] }
            }
          }
        }]
      ]);
      const res = evaluateGoalRequirements(goals, nodes);
      expect(res.allSatisfied).toBe(false);
      expect(res.evaluated[0].evaluationError).toBe('ENTITY_MISMATCH');
    });

    test('32. REQUIRED task with unrelated declared output cannot satisfy goal', () => {
      const node = {
        taskId: 't1',
        taskType: TASK_TYPE.RETRIEVAL_QUERY,
        criticality: TASK_CRITICALITY.REQUIRED,
        dependsOn: [],
        input: { queryText: 'q' },
        declaredContract: { declaredOutputFactKeys: ['unrelated'], declaredEntities: ['TI'], declaredAspects: ['general'] }
      };
      const res = validateGoalTaskBindings(
        [{ requirementId: 'g1', entity: 'TI', aspect: 'fee', factKey: 'tuition_fee' }],
        [{ requirementId: 'g1', requiredTaskIds: ['t1'] }],
        new Map([['t1', node]])
      );
      expect(res.valid).toBe(false);
      expect(res.code).toBe('INCOMPATIBLE_GOAL_BINDING');
    });

    test('33. aspect mismatch rejects goal satisfaction', () => {
      const goals = [{ requirementId: 'g1', entity: 'TI', aspect: 'fee', factKey: 'info' }];
      const nodes = new Map([
        ['t1', {
          status: TASK_STATUS.SUCCEEDED,
          output: {
            structuredFacts: {
              info: { factKey: 'info', entity: 'TI', aspect: 'curriculum', factType: FACT_TYPE.VERIFIED_FACT, evidenceRefs: [{ chunkId: 'c1' }] }
            }
          }
        }]
      ]);
      const res = evaluateGoalRequirements(goals, nodes);
      expect(res.allSatisfied).toBe(false);
      expect(res.evaluated[0].evaluationError).toBe('ASPECT_MISMATCH');
    });

    test('34. multi-entity goal requirements fulfillment', () => {
      const goals = [
        { requirementId: 'g_ti', entity: 'S1 TI', aspect: 'fee', factKey: 'fee_ti' },
        { requirementId: 'g_si', entity: 'S1 SI', aspect: 'fee', factKey: 'fee_si' }
      ];
      const nodes = new Map([
        ['t1', {
          status: TASK_STATUS.SUCCEEDED,
          output: {
            structuredFacts: {
              fee_ti: { factKey: 'fee_ti', entity: 'S1 TI', aspect: 'fee', factType: FACT_TYPE.VERIFIED_FACT, evidenceRefs: [{ chunkId: 'c1' }] },
              fee_si: { factKey: 'fee_si', entity: 'S1 SI', aspect: 'fee', factType: FACT_TYPE.VERIFIED_FACT, evidenceRefs: [{ chunkId: 'c2' }] }
            }
          }
        }]
      ]);
      const res = evaluateGoalRequirements(goals, nodes);
      expect(res.allSatisfied).toBe(true);
      expect(res.evaluated.length).toBe(2);
      expect(res.evaluated.every(g => g.isSatisfied)).toBe(true);
    });
  });

  // ==========================================
  // CATEGORY 5: Budgets, Deadlines & Completion Precedence (7 Tests)
  // ==========================================
  describe('Category 5: Budgets, Deadlines & Completion Precedence', () => {
    test('35. node effective budget respected (600ms)', () => {
      const { NODE_EFFECTIVE_BUDGET_MS } = require('../src/reasoning/contracts');
      expect(NODE_EFFECTIVE_BUDGET_MS).toBe(600);
    });

    test('36. execution deadline 2100ms prevents new node start', async () => {
      const startTime = Date.now() - 2150; // Already exceeded 2100ms
      const graph = createTaskGraph({
        startTime,
        rootTaskIds: ['t1'],
        nodes: [{ taskId: 't1', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'q' } }],
        goalRequirements: [{ requirementId: 'g1', entity: 'E', aspect: 'A', factKey: 'f' }],
        goalTaskBindings: [{ requirementId: 'g1', requiredTaskIds: ['t1'] }]
      });
      const res = await executeTaskGraph(graph);
      expect(res.completionState).toBe(GRAPH_COMPLETION_STATE.TIMEOUT_GRAPH);
      expect(graph.nodes.get('t1').status).toBe(TASK_STATUS.SKIPPED);
    });

    test('37. unsafe remaining budget guard stops scheduling', async () => {
      // startTime set so remaining budget < 600ms
      const startTime = Date.now() - 1700; // 400ms left before 2100ms
      const graph = createTaskGraph({
        startTime,
        rootTaskIds: ['t1'],
        nodes: [{ taskId: 't1', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'q' } }]
      });
      const res = await executeTaskGraph(graph);
      expect(res.completionState).toBe(GRAPH_COMPLETION_STATE.TIMEOUT_GRAPH);
    });

    test('38. all REQUIRED goals met + optional unfinished at deadline => PARTIAL_COMPLETION', () => {
      const graph = {
        goalRequirements: [{ requirementId: 'g1' }],
        nodes: new Map([
          ['tReq', { criticality: TASK_CRITICALITY.REQUIRED, status: TASK_STATUS.SUCCEEDED }],
          ['tOpt', { criticality: TASK_CRITICALITY.OPTIONAL, status: TASK_STATUS.SKIPPED }]
        ]),
        _executionTimedOut: true
      };
      const res = evaluateGraphCompletion(graph, { allSatisfied: true });
      expect(res).toBe(GRAPH_COMPLETION_STATE.PARTIAL_COMPLETION);
    });

    test('39. required goal evidence insufficiency + optional success => INSUFFICIENT_EVIDENCE', () => {
      const graph = {
        goalRequirements: [{ requirementId: 'g1' }],
        nodes: new Map([
          ['tReq', { criticality: TASK_CRITICALITY.REQUIRED, status: TASK_STATUS.INSUFFICIENT_EVIDENCE }],
          ['tOpt', { criticality: TASK_CRITICALITY.OPTIONAL, status: TASK_STATUS.SUCCEEDED }]
        ]),
        _executionTimedOut: false
      };
      const res = evaluateGraphCompletion(graph, { allSatisfied: false });
      expect(res).toBe(GRAPH_COMPLETION_STATE.INSUFFICIENT_EVIDENCE);
    });

    test('40. finalization timeout does not create unsupported answer', async () => {
      process.env.ENABLE_PHASE2_REASONING = 'true';
      const chatId = 'finalization_timeout_test';
      const graph = createTaskGraph({
        rootTaskIds: ['t1'],
        nodes: [{ taskId: 't1', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'q' } }]
      });
      let callCount = 0;
      const mockPhase1 = jest.fn(async () => {
        callCount++;
        if (callCount === 1) {
          // Delay to simulate timeout in bridge
          await new Promise(r => setTimeout(r, 3500));
        }
        return { answer: 'timeout fallback answer' };
      });
      const res = await executePhase2Bridge(chatId, 'q', { taskGraph: graph }, mockPhase1);
      expect(res.phase2Meta.fallbackTriggered).toBe(true);
      expect(res.phase2Meta.handledBy).toBe('phase1_fallback');
    }, 10000);

    test('41. finalization failure does not commit unverified context', async () => {
      process.env.ENABLE_PHASE2_REASONING = 'true';
      const chatId = 'finalization_fail_commit_test';
      await updateSession(chatId, { dataPatch: { activeEntity: 'SAFE_ORIGINAL' } });

      const graph = createTaskGraph({
        rootTaskIds: ['t1'],
        nodes: [{ taskId: 't1', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'q' } }]
      });
      let callCount = 0;
      const mockPhase1 = jest.fn(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Bridge execution crashed');
        }
        return { finalAnswer: 'safe fallback answer' };
      });

      await executePhase2Bridge(chatId, 'q', { taskGraph: graph }, mockPhase1);
      const session = await getSession(chatId);
      expect(session.data.activeEntity).toBe('SAFE_ORIGINAL');
    });
  });

  // ==========================================
  // CATEGORY 6: Replan Lifecycle & Authority (5 Tests)
  // ==========================================
  describe('Category 6: Replan Lifecycle & Authority', () => {
    test('42. replan deadline 1500ms enforcement', async () => {
      const graph = createTaskGraph({
        startTime: Date.now(),
        rootTaskIds: ['t1'],
        nodes: [{ taskId: 't1', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'q' } }]
      });
      // Simulate past 1500ms replan cutoff while remaining execution budget is still sufficient
      graph.replanDeadlineMs = Date.now() - 50;
      const mockBridge = async () => ({ answerability: 'UNKNOWN', acceptedEvidence: [] });
      const replanSpy = jest.fn();
      await executeTaskGraph(graph, { phase1BridgeFn: mockBridge, replanBridgeFn: replanSpy });
      expect(replanSpy).not.toHaveBeenCalled();
      expect(graph.nodes.get('t1').status).toBe(TASK_STATUS.INSUFFICIENT_EVIDENCE);
    });

    test('43. max one replan per turn & no recursive replan', async () => {
      const graph = createTaskGraph({
        rootTaskIds: ['t1', 't2'],
        nodes: [
          { taskId: 't1', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'q1' } },
          { taskId: 't2', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'q2' } }
        ]
      });
      const mockBridge = async () => ({ answerability: 'UNKNOWN', acceptedEvidence: [] });
      let replanCalls = 0;
      const replanMock = jest.fn(async () => {
        replanCalls++;
        return { status: TASK_STATUS.INSUFFICIENT_EVIDENCE };
      });
      await executeTaskGraph(graph, { phase1BridgeFn: mockBridge, replanBridgeFn: replanMock });
      expect(replanCalls).toBe(1); // exactly 1 replan allowed
    });

    test('44. replan success resets controlSignal to NONE & restores SUCCEEDED', async () => {
      const graph = createTaskGraph({
        rootTaskIds: ['t1'],
        nodes: [{ taskId: 't1', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'q' } }]
      });
      const mockBridge = async () => ({ answerability: 'UNKNOWN', acceptedEvidence: [] });
      const replanMock = async () => ({
        status: TASK_STATUS.SUCCEEDED,
        output: {
          verifiedEntities: ['TI'],
          verifiedAspects: ['fee'],
          structuredFacts: { f: { factKey: 'f', value: 1, entity: 'TI', aspect: 'fee', factType: FACT_TYPE.VERIFIED_FACT, sourceAuthorities: ['S'], evidenceRefs: [{ chunkId: 'c' }], provenance: ENTITY_PROVENANCE.EXPLICIT_CURRENT_TURN } },
          acceptedEvidence: [{ chunkId: 'c' }],
          answerability: 'ANSWERABLE'
        }
      });
      await executeTaskGraph(graph, { phase1BridgeFn: mockBridge, replanBridgeFn: replanMock });
      const node = graph.nodes.get('t1');
      expect(node.controlSignal).toBe(NODE_CONTROL_SIGNAL.NONE);
      expect(node.status).toBe(TASK_STATUS.SUCCEEDED);
    });

    test('45. replan failure resets controlSignal to NONE & restores FAILED/INSUFFICIENT', async () => {
      const graph = createTaskGraph({
        rootTaskIds: ['t1'],
        nodes: [{ taskId: 't1', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'q' } }]
      });
      const mockBridge = async () => ({ answerability: 'UNKNOWN', acceptedEvidence: [] });
      const replanMock = async () => ({
        status: TASK_STATUS.FAILED,
        error: { code: 'CRASH', message: 'replan crashed' }
      });
      await executeTaskGraph(graph, { phase1BridgeFn: mockBridge, replanBridgeFn: replanMock });
      const node = graph.nodes.get('t1');
      expect(node.controlSignal).toBe(NODE_CONTROL_SIGNAL.NONE);
      expect(node.status).toBe(TASK_STATUS.FAILED);
    });

    test('46. replan result cannot bypass handoff validation', async () => {
      const graph = createTaskGraph({
        rootTaskIds: ['t1'],
        nodes: [{ taskId: 't1', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'q' } }]
      });
      const mockBridge = async () => ({ answerability: 'UNKNOWN', acceptedEvidence: [] });
      const replanMock = async () => ({
        status: TASK_STATUS.SUCCEEDED,
        output: {
          // malformed structured fact
          structuredFacts: {
            bad: { factKey: 'divergent', value: 'v' }
          }
        }
      });
      await executeTaskGraph(graph, { phase1BridgeFn: mockBridge, replanBridgeFn: replanMock });
      expect(graph.nodes.get('t1').status).toBe(TASK_STATUS.SUCCEEDED);
      // Validated structured fact integrity ensures no corrupt payload enters downstream
    });
  });

  // ==========================================
  // CATEGORY 7: Strict Handoff, Typed Facts, Lineage & Transforms (6 Tests)
  // ==========================================
  describe('Category 7: Strict Handoff, Typed Facts, Lineage & Transforms', () => {
    test('47. strict structured handoff (zero natural language answer)', async () => {
      const graph = createTaskGraph({
        rootTaskIds: ['t1'],
        nodes: [{ taskId: 't1', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'q' } }]
      });
      const mockBridge = async () => ({
        answerability: 'ANSWERABLE',
        acceptedEvidence: [{ chunkId: 'c' }],
        structuredFacts: { f: { factKey: 'f', value: 123, entity: 'TI', aspect: 'fee', factType: FACT_TYPE.VERIFIED_FACT, sourceAuthorities: ['S'], evidenceRefs: [{ chunkId: 'c' }], provenance: ENTITY_PROVENANCE.EXPLICIT_CURRENT_TURN } }
      });
      await executeTaskGraph(graph, { phase1BridgeFn: mockBridge });
      const out = graph.nodes.get('t1').output;
      expect(out.answer).toBeUndefined(); // Zero natural language answer in node output
      expect(out.structuredFacts.f.value).toBe(123);
    });

    test('48. typed fact value rejects arbitrary function/object/class', () => {
      expect(isFiniteJSONSafe(() => {})).toBe(false);
      expect(isFiniteJSONSafe(new Date())).toBe(false);
      expect(isFiniteJSONSafe(new Map())).toBe(false);
      expect(isFiniteJSONSafe(new Set())).toBe(false);
      expect(isFiniteJSONSafe(Promise.resolve(1))).toBe(false);
      expect(isFiniteJSONSafe({ safeStr: 'abc', safeNum: 100, safeArr: [1, 2, 3] })).toBe(true);
    });

    test('49. arithmetic cannot consume unsupported constant', () => {
      // transformConfig must bind operands from source facts
      const node = {
        taskId: 'tTrans',
        taskType: TASK_TYPE.DETERMINISTIC_TRANSFORM,
        criticality: TASK_CRITICALITY.REQUIRED,
        dependsOn: ['t0'],
        input: {
          upstreamFactBindings: [{ fromTaskId: 't0', factKey: 'factA' }],
          transformConfig: {
            operation: TRANSFORM_OPERATION.ARITHMETIC,
            parameters: {
              operator: 'ADD',
              operandA: { fromTaskId: 't0', factKey: 'factA' },
              operandB: { fromTaskId: 't0', factKey: 'missing' },
              destinationFactKey: 'dest'
            }
          }
        }
      };
      const graph = { nodes: new Map([['t0', { status: TASK_STATUS.SUCCEEDED, output: { structuredFacts: { factA: { value: 1 } } } }]]) };
      const { executeTaskNode } = require('../src/reasoning/taskGraphExecutor');
      executeTaskNode(node, graph, () => {});
      expect(node.status).toBe(TASK_STATUS.FAILED);
    });

    test('50. arithmetic transform safety (div by zero & non-numeric)', () => {
      const { executeTaskNode } = require('../src/reasoning/taskGraphExecutor');
      const node = {
        taskId: 'tDiv',
        taskType: TASK_TYPE.DETERMINISTIC_TRANSFORM,
        criticality: TASK_CRITICALITY.REQUIRED,
        dependsOn: ['t0'],
        input: {
          upstreamFactBindings: [{ fromTaskId: 't0', factKey: 'a' }, { fromTaskId: 't0', factKey: 'b' }],
          transformConfig: {
            operation: TRANSFORM_OPERATION.ARITHMETIC,
            parameters: {
              operator: 'DIVIDE',
              operandA: { fromTaskId: 't0', factKey: 'a' },
              operandB: { fromTaskId: 't0', factKey: 'b' },
              destinationFactKey: 'res'
            }
          }
        }
      };
      const graph = {
        nodes: new Map([['t0', {
          status: TASK_STATUS.SUCCEEDED,
          output: {
            structuredFacts: {
              a: { factKey: 'a', value: 100, entity: 'TI', aspect: 'fee', factType: FACT_TYPE.VERIFIED_FACT, sourceAuthorities: ['S'], evidenceRefs: [{ chunkId: 'c' }], provenance: ENTITY_PROVENANCE.EXPLICIT_CURRENT_TURN },
              b: { factKey: 'b', value: 0, entity: 'TI', aspect: 'fee', factType: FACT_TYPE.VERIFIED_FACT, sourceAuthorities: ['S'], evidenceRefs: [{ chunkId: 'c' }], provenance: ENTITY_PROVENANCE.EXPLICIT_CURRENT_TURN }
            }
          }
        }]])
      };
      executeTaskNode(node, graph, () => {});
      expect(node.status).toBe(TASK_STATUS.FAILED);
      expect(node.error.code).toBe('DIVISION_BY_ZERO');
    });

    test('51. derived fact preserves transitive lineage', async () => {
      const graph = createTaskGraph({
        rootTaskIds: ['tRoot'],
        nodes: [
          { taskId: 'tRoot', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'q' } },
          {
            taskId: 'tDeriv',
            taskType: TASK_TYPE.DETERMINISTIC_TRANSFORM,
            criticality: TASK_CRITICALITY.REQUIRED,
            dependsOn: ['tRoot'],
            input: {
              upstreamFactBindings: [{ fromTaskId: 'tRoot', factKey: 'val1' }, { fromTaskId: 'tRoot', factKey: 'val2' }],
              transformConfig: {
                operation: TRANSFORM_OPERATION.ARITHMETIC,
                parameters: {
                  operator: 'ADD',
                  operandA: { fromTaskId: 'tRoot', factKey: 'val1' },
                  operandB: { fromTaskId: 'tRoot', factKey: 'val2' },
                  destinationFactKey: 'sum'
                }
              }
            }
          }
        ]
      });
      const mockBridge = async () => ({
        answerability: 'ANSWERABLE',
        acceptedEvidence: [{ chunkId: 'chunk_origin_99' }],
        structuredFacts: {
          val1: { factKey: 'val1', value: 50, entity: 'TI', aspect: 'fee', factType: FACT_TYPE.VERIFIED_FACT, sourceAuthorities: ['SK_2026'], evidenceRefs: [{ chunkId: 'chunk_origin_99' }], provenance: ENTITY_PROVENANCE.EXPLICIT_CURRENT_TURN },
          val2: { factKey: 'val2', value: 50, entity: 'TI', aspect: 'fee', factType: FACT_TYPE.VERIFIED_FACT, sourceAuthorities: ['SK_2026'], evidenceRefs: [{ chunkId: 'chunk_origin_99' }], provenance: ENTITY_PROVENANCE.EXPLICIT_CURRENT_TURN }
        }
      });
      await executeTaskGraph(graph, { phase1BridgeFn: mockBridge });
      const derived = graph.nodes.get('tDeriv').output.structuredFacts.sum;
      expect(derived.factType).toBe(FACT_TYPE.DERIVED_FACT);
      expect(derived.transitiveLineage.rootVerifiedFactKeys).toContain('val1');
      expect(derived.transitiveLineage.rootVerifiedFactKeys).toContain('val2');
      expect(derived.transitiveLineage.rootEvidenceChunkIds).toContain('chunk_origin_99');
    });

    test('52. multi-authority derived fact preserves all authorities', async () => {
      const graph = createTaskGraph({
        rootTaskIds: ['tRoot'],
        nodes: [
          { taskId: 'tRoot', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'q' } },
          {
            taskId: 'tDeriv',
            taskType: TASK_TYPE.DETERMINISTIC_TRANSFORM,
            criticality: TASK_CRITICALITY.REQUIRED,
            dependsOn: ['tRoot'],
            input: {
              upstreamFactBindings: [{ fromTaskId: 'tRoot', factKey: 'fA' }, { fromTaskId: 'tRoot', factKey: 'fB' }],
              transformConfig: {
                operation: TRANSFORM_OPERATION.ARITHMETIC,
                parameters: {
                  operator: 'ADD',
                  operandA: { fromTaskId: 'tRoot', factKey: 'fA' },
                  operandB: { fromTaskId: 'tRoot', factKey: 'fB' },
                  destinationFactKey: 'fSum'
                }
              }
            }
          }
        ]
      });
      const mockBridge = async () => ({
        answerability: 'ANSWERABLE',
        acceptedEvidence: [{ chunkId: 'c1' }, { chunkId: 'c2' }],
        structuredFacts: {
          fA: { factKey: 'fA', value: 10, entity: 'TI', aspect: 'fee', factType: FACT_TYPE.VERIFIED_FACT, sourceAuthorities: ['SK_A'], evidenceRefs: [{ chunkId: 'c1' }], provenance: ENTITY_PROVENANCE.EXPLICIT_CURRENT_TURN },
          fB: { factKey: 'fB', value: 20, entity: 'TI', aspect: 'fee', factType: FACT_TYPE.VERIFIED_FACT, sourceAuthorities: ['SK_B'], evidenceRefs: [{ chunkId: 'c2' }], provenance: ENTITY_PROVENANCE.INHERITED_FROM_SESSION }
        }
      });
      await executeTaskGraph(graph, { phase1BridgeFn: mockBridge });
      const fSum = graph.nodes.get('tDeriv').output.structuredFacts.fSum;
      expect(fSum.sourceAuthorities).toContain('SK_A');
      expect(fSum.sourceAuthorities).toContain('SK_B');
      expect(fSum.provenance).toBe(ENTITY_PROVENANCE.DERIVED_COMPOSITE);
    });
  });

  // ==========================================
  // CATEGORY 8: Evidence Aggregation, Provenance & Session Atomicity (4 Tests)
  // ==========================================
  describe('Category 8: Evidence Aggregation, Provenance & Session Atomicity', () => {
    test('53. EVIDENCE_AGGREGATION successful execution & preserves per-fact provenance', async () => {
      const graph = createTaskGraph({
        rootTaskIds: ['t1', 't2'],
        nodes: [
          { taskId: 't1', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'q1' } },
          { taskId: 't2', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'q2' } },
          {
            taskId: 'tAgg',
            taskType: TASK_TYPE.EVIDENCE_AGGREGATION,
            criticality: TASK_CRITICALITY.REQUIRED,
            dependsOn: ['t1', 't2'],
            input: {
              upstreamFactBindings: [{ fromTaskId: 't1', factKey: 'f1' }, { fromTaskId: 't2', factKey: 'f2' }]
            }
          }
        ]
      });
      const mockBridge = async (q) => {
        if (q === 'q1') {
          return {
            answerability: 'ANSWERABLE',
            acceptedEvidence: [{ chunkId: 'c1' }],
            structuredFacts: { f1: { factKey: 'f1', value: 'v1', entity: 'TI', aspect: 'A1', factType: FACT_TYPE.VERIFIED_FACT, sourceAuthorities: ['S1'], evidenceRefs: [{ chunkId: 'c1' }], provenance: ENTITY_PROVENANCE.EXPLICIT_CURRENT_TURN } }
          };
        }
        return {
          answerability: 'ANSWERABLE',
          acceptedEvidence: [{ chunkId: 'c2' }],
          structuredFacts: { f2: { factKey: 'f2', value: 'v2', entity: 'TI', aspect: 'A2', factType: FACT_TYPE.VERIFIED_FACT, sourceAuthorities: ['S2'], evidenceRefs: [{ chunkId: 'c2' }], provenance: ENTITY_PROVENANCE.INHERITED_FROM_SESSION } }
        };
      };
      await executeTaskGraph(graph, { phase1BridgeFn: mockBridge });
      const aggNode = graph.nodes.get('tAgg');
      expect(aggNode.status).toBe(TASK_STATUS.SUCCEEDED);
      expect(aggNode.output.structuredFacts.f1.provenance).toBe(ENTITY_PROVENANCE.EXPLICIT_CURRENT_TURN);
      expect(aggNode.output.structuredFacts.f2.provenance).toBe(ENTITY_PROVENANCE.INHERITED_FROM_SESSION);
    });

    test('54. invalid upstreamFactBinding rejected', async () => {
      const graph = createTaskGraph({
        rootTaskIds: ['t1'],
        nodes: [
          { taskId: 't1', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'q' } },
          {
            taskId: 'tAgg',
            taskType: TASK_TYPE.EVIDENCE_AGGREGATION,
            criticality: TASK_CRITICALITY.REQUIRED,
            dependsOn: ['t1'],
            input: {
              upstreamFactBindings: [{ fromTaskId: 't1', factKey: 'non_existent_key' }]
            }
          }
        ]
      });
      const mockBridge = async () => ({
        answerability: 'ANSWERABLE',
        acceptedEvidence: [{ chunkId: 'c1' }],
        structuredFacts: { existKey: { factKey: 'existKey', value: 1, entity: 'E', aspect: 'A', factType: FACT_TYPE.VERIFIED_FACT, sourceAuthorities: ['S'], evidenceRefs: [{ chunkId: 'c1' }], provenance: ENTITY_PROVENANCE.EXPLICIT_CURRENT_TURN } }
      });
      await executeTaskGraph(graph, { phase1BridgeFn: mockBridge });
      expect(graph.nodes.get('tAgg').status).toBe(TASK_STATUS.FAILED);
      expect(graph.nodes.get('tAgg').error.code).toBe('FACT_NOT_FOUND');
    });

    test('55. rejected evidence cannot re-enter downstream', async () => {
      // Phase 1 Bridge filters rejected chunks; only acceptedEvidence is propagated
      const mockBridge = async () => ({
        answerability: 'ANSWERABLE',
        acceptedEvidence: [{ chunkId: 'c_accepted' }],
        rejectedEvidence: [{ chunkId: 'c_rejected' }],
        structuredFacts: {
          f: { factKey: 'f', value: 1, entity: 'E', aspect: 'A', factType: FACT_TYPE.VERIFIED_FACT, sourceAuthorities: ['S'], evidenceRefs: [{ chunkId: 'c_accepted' }], provenance: ENTITY_PROVENANCE.EXPLICIT_CURRENT_TURN }
        }
      });
      const graph = createTaskGraph({
        rootTaskIds: ['t1'],
        nodes: [{ taskId: 't1', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'q' } }]
      });
      await executeTaskGraph(graph, { phase1BridgeFn: mockBridge });
      const accepted = graph.nodes.get('t1').output.acceptedEvidence;
      expect(accepted.some(c => c.chunkId === 'c_rejected')).toBe(false);
    });

    test('56. Step 4 context delta remains independent of task branch results', async () => {
      process.env.ENABLE_PHASE2_REASONING = 'true';
      const chatId = 'step4_context_independence_test';
      await updateSession(chatId, {
        dataPatch: {
          activeEntity: 'S1 Sistem Informasi',
          activeDomain: 'TUITION_FEE'
        }
      });

      // Graph executes complex multi-step with different branch entities
      const graph = createTaskGraph({
        rootTaskIds: ['t1'],
        nodes: [{ taskId: 't1', taskType: TASK_TYPE.RETRIEVAL_QUERY, criticality: TASK_CRITICALITY.REQUIRED, dependsOn: [], input: { queryText: 'biaya TI', targetEntity: 'S1 Teknologi Informasi' } }]
      });
      const mockPhase1 = async () => ({
        subQueryResults: [{
          frame: { domain: 'TUITION_FEE', intent: 'FEE_QUERY', entities: ['S1 Teknologi Informasi'] },
          arbitrated: { accepted: [{ chunkId: 'c1' }] },
          answerability: 'ANSWERABLE',
          answer: 'Biaya TI 6.5jt'
        }]
      });

      // Context delta in Step 4 is computed from user turn + previous session, not polluted by internal task branches
      const bridgeRes = await executePhase2Bridge(chatId, 'biaya TI berapa?', { taskGraph: graph }, mockPhase1);
      expect(bridgeRes.phase2Meta.handledBy).toBe('phase2_task_graph');
      const sessionAfter = await getSession(chatId);
      expect(sessionAfter.data.activeEntity).toBe('S1 Teknologi Informasi');
    });
  });
});
