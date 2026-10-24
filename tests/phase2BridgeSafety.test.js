'use strict';

const { executePhase2Bridge } = require('../src/reasoning/phase2Bridge');

describe('Phase 2 Bridge Fail-Closed Invariants & Controlled Fallback', () => {
  const dummyPhase1 = jest.fn().mockImplementation((chatId, rawQuery, options) => {
    return Promise.resolve({
      finalAnswer: 'Phase 1 Answer for ' + rawQuery,
      subQueryResults: []
    });
  });

  beforeEach(() => {
    dummyPhase1.mockClear();
  });

  test('fails-closed with explicit error when rawQuery is empty or non-string', async () => {
    await expect(executePhase2Bridge('chat123', '', {}, dummyPhase1)).rejects.toThrow(
      /phase2_bridge_invalid_input/
    );
    await expect(executePhase2Bridge('chat123', null, {}, dummyPhase1)).rejects.toThrow(
      /phase2_bridge_invalid_input/
    );
  });

  test('fails-closed with explicit error when phase1PipelineFn is not a function', async () => {
    await expect(executePhase2Bridge('chat123', 'Berapa biaya kuliah?', {}, null)).rejects.toThrow(
      /phase2_bridge_invalid_input: phase1PipelineFn must be a function/
    );
  });

  test('safely resolves semanticFrame via synchronous resolver without throwing undefined domain error when semanticFrame is omitted in options', async () => {
    const res = await executePhase2Bridge(
      'chat_bridge_test_' + Date.now(),
      'Berapa biayanya?',
      { syncOnly: true },
      dummyPhase1
    );

    expect(res).toBeDefined();
    expect(res.finalAnswer).toBeDefined();
    // Must either be handled by phase2_bridge clarification or fall back cleanly to Phase 1
    if (res.phase2Meta?.handledBy === 'phase2_bridge') {
      expect(res.status).toBe('clarification_needed');
    } else {
      expect(res.phase2Meta?.handledBy).toBe('phase1_fallback');
    }
  });

  test('on bridge timeout or exception, cleanly triggers single fallback to phase1PipelineFn with error trace', async () => {
    const res = await executePhase2Bridge(
      'chat_bridge_fallback_' + Date.now(),
      'Berapa biaya kuliah S1?',
      { timeoutMs: 1 },
      dummyPhase1
    );

    expect(res).toBeDefined();
    expect(dummyPhase1).toHaveBeenCalledTimes(1);
    expect(res.phase2Meta?.handledBy).toBe('phase1_fallback');
    expect(res.phase2Meta?.fallbackTriggered).toBe(true);
    expect(typeof res.phase2Meta?.reason).toBe('string');
  });
});
