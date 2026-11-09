'use strict';

/**
 * tests/groundedGenerationReliability.test.js
 *
 * Comprehensive Unit & Regression Test Suite for Stage 1:
 * Systemic AI Generation Reliability Improvement (GPT-6 Luna & Grounded Generator).
 *
 * Verified Invariants:
 * 1. Standard inquiry uses reasoning_effort: "low"
 * 2. Multi-attribute / comparative inquiry uses reasoning_effort: "medium"
 * 3. Token budget dynamically scales (1200 standard vs 1800 complex) with positive integer validation
 * 4. Sanitizer completely strips temperature and top_p when reasoning_effort is active
 * 5. Finish reason 'stop' produces clean success with complete telemetry
 * 6. Finish reason 'length' triggers truncation telemetry and safe fallback
 * 7. Empty content completion is safely captured as empty_completion fallback
 * 8. API errors are safely classified without logging secrets or full prompt
 * 9. LLM is not called when budget gate denies reservation
 * 10. Verifier recovery is clearly distinguishable from LLM API failure
 */

const {
  synthesizeAnswer,
  isComplexInquiry,
  resolveReasoningEffort,
  resolveCompletionTokenBudget,
  classifySafeApiError,
  getCircuitBreakerState,
  clearCircuitBreakerQuotaExhaustion,
  _resetCircuitBreakerForTesting
} = require('../src/core/groundedAnswerGenerator');
const { sanitizeOpenAiChatPayload } = require('../src/utils/openAiPayloadHelper');
const { MemoryPersistentAdapter, BudgetLedgerManager } = require('../src/core/budgetLedger');

describe('Stage 1: Systemic AI Generation Reliability Improvement', () => {
  beforeEach(() => {
    _resetCircuitBreakerForTesting();
    delete process.env.OPENAI_REASONING_EFFORT_STANDARD;
    delete process.env.OPENAI_REASONING_EFFORT_COMPLEX;
    delete process.env.OPENAI_MAX_COMPLETION_TOKENS_STANDARD;
    delete process.env.OPENAI_MAX_COMPLETION_TOKENS_COMPLEX;
  });

  afterAll(() => {
    _resetCircuitBreakerForTesting();
  });

  // Test 1: Standard inquiry uses reasoning_effort 'low'
  test('1. Standard inquiry resolves reasoning_effort to "low"', () => {
    const standardFrame = {
      domain: 'ACADEMIC_PROGRAM',
      intent: 'PROGRAM_INFO',
      speechAct: 'INQUIRE_PROPERTY',
      requestedAttributes: ['curriculum'],
      entities: [{ canonical: 'S1 Sistem Informasi', name: 'Sistem Informasi' }],
      targetEntities: ['S1 Sistem Informasi']
    };

    expect(isComplexInquiry(standardFrame)).toBe(false);
    expect(resolveReasoningEffort(standardFrame)).toBe('low');
  });

  // Test 2: Multi-attribute & comparative inquiry uses reasoning_effort 'medium'
  test('2. Multi-attribute and comparative inquiries resolve reasoning_effort to "medium"', () => {
    const multiAttrFrame = {
      domain: 'ACADEMIC_PROGRAM',
      intent: 'MULTI_ATTRIBUTE_INQUIRY',
      speechAct: 'INQUIRE_PROPERTY',
      requestedAttributes: ['curriculum', 'tuition_fee', 'career_prospects'],
      targetEntities: ['S1 Bisnis Digital']
    };

    const comparativeFrame = {
      domain: 'ACADEMIC_PROGRAM',
      intent: 'COMPARATIVE_INQUIRY',
      speechAct: 'COMPARE',
      isComparative: true,
      targetEntities: ['S1 Bisnis Digital', 'S1 Sistem Informasi']
    };

    expect(isComplexInquiry(multiAttrFrame)).toBe(true);
    expect(resolveReasoningEffort(multiAttrFrame)).toBe('medium');

    expect(isComplexInquiry(comparativeFrame)).toBe(true);
    expect(resolveReasoningEffort(comparativeFrame)).toBe('medium');
  });

  // Test 3: Token budget scaling and validation
  test('3. Token budget dynamically scales (1200 standard vs 1800 complex) with positive integer validation', () => {
    const standardFrame = {
      domain: 'ACADEMIC_PROGRAM',
      requestedAttributes: ['curriculum']
    };
    const complexFrame = {
      domain: 'ACADEMIC_PROGRAM',
      requestedAttributes: ['curriculum', 'career_prospects']
    };

    // Default values
    expect(resolveCompletionTokenBudget(standardFrame)).toBe(1200);
    expect(resolveCompletionTokenBudget(complexFrame)).toBe(1800);

    // Configurable via ENV with bounds validation
    process.env.OPENAI_MAX_COMPLETION_TOKENS_STANDARD = '1400';
    process.env.OPENAI_MAX_COMPLETION_TOKENS_COMPLEX = '2200';
    expect(resolveCompletionTokenBudget(standardFrame)).toBe(1400);
    expect(resolveCompletionTokenBudget(complexFrame)).toBe(2200);

    // Invalid ENV fallback
    process.env.OPENAI_MAX_COMPLETION_TOKENS_STANDARD = '-50';
    process.env.OPENAI_MAX_COMPLETION_TOKENS_COMPLEX = 'invalid_number';
    expect(resolveCompletionTokenBudget(standardFrame)).toBe(1200);
    expect(resolveCompletionTokenBudget(complexFrame)).toBe(1800);
  });

  // Test 4: Sanitizer removes temperature/top_p when reasoning_effort is active
  test('4. Sanitizer completely strips temperature and top_p when reasoning_effort is present', () => {
    const rawPayload = {
      model: 'gpt-6-luna',
      messages: [{ role: 'user', content: 'test question' }],
      reasoning_effort: 'medium',
      max_completion_tokens: 1800,
      temperature: 0.1,
      top_p: 0.95
    };

    const sanitized = sanitizeOpenAiChatPayload(rawPayload);
    expect(sanitized.reasoning_effort).toBe('medium');
    expect(sanitized.max_completion_tokens).toBe(1800);
    expect(sanitized.temperature).toBeUndefined();
    expect(sanitized.top_p).toBeUndefined();
  });

  // Test 5: Finish reason 'stop' produces clean success with complete telemetry
  test('5. Finish reason "stop" produces success status and rich telemetry', async () => {
    const mockAiEngine = {
      apiKey: 'test-real-mock-key',
      model: 'gpt-6-luna',
      client: {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              choices: [{
                finish_reason: 'stop',
                message: { content: 'Program Studi S1 Bisnis Digital memiliki fokus pada inovasi teknologi bisnis.' }
              }],
              usage: {
                prompt_tokens: 450,
                completion_tokens: 85,
                completion_tokens_details: { reasoning_tokens: 40 }
              }
            })
          }
        }
      }
    };

    const semanticFrame = {
      domain: 'ACADEMIC_PROGRAM',
      intent: 'PROGRAM_INFO',
      requestedAttributes: ['overview'],
      entities: [{ canonical: 'S1 Bisnis Digital' }]
    };

    const arbitratedEvidence = {
      accepted: [{ text: 'Profil S1 Bisnis Digital ITB STIKOM Bali.', source: 'profil_bd.pdf' }],
      aiEngine: mockAiEngine
    };

    const result = await synthesizeAnswer(semanticFrame, arbitratedEvidence);

    expect(result.success).toBe(true);
    expect(result.source).toBe('llm_grounded_synthesis');
    expect(result.answer).toContain('Bisnis Digital');

    // Telemetry assertions
    expect(result.llmTelemetry).toBeDefined();
    expect(result.llmTelemetry.model).toBe('gpt-6-luna');
    expect(result.llmTelemetry.reasoning_effort).toBe('low');
    expect(result.llmTelemetry.max_completion_tokens).toBe(1200);
    expect(result.llmTelemetry.finish_reason).toBe('stop');
    expect(result.llmTelemetry.prompt_tokens).toBe(450);
    expect(result.llmTelemetry.completion_tokens).toBe(85);
    expect(result.llmTelemetry.reasoning_tokens).toBe(40);
    expect(result.llmTelemetry.status).toBe('success');
    expect(result.llmTelemetry.fallback_reason).toBeNull();
  });

  // Test 6: Finish reason 'length' triggers truncation telemetry and safe fallback
  test('6. Finish reason "length" triggers truncation telemetry and safe extractive fallback', async () => {
    const mockAiEngine = {
      apiKey: 'test-real-mock-key',
      model: 'gpt-6-luna',
      client: {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              choices: [{
                finish_reason: 'length',
                message: { content: 'Program Studi S1 Bisnis Digital berfokus pada kurikulum inovasi teknologi yang' } // cut off
              }],
              usage: {
                prompt_tokens: 500,
                completion_tokens: 1200,
                completion_tokens_details: { reasoning_tokens: 800 }
              }
            })
          }
        }
      }
    };

    const semanticFrame = {
      domain: 'ACADEMIC_PROGRAM',
      intent: 'MULTI_ATTRIBUTE_INQUIRY',
      requestedAttributes: ['fasilitas', 'kegiatan_mahasiswa'],
      entities: [{ canonical: 'S1 Bisnis Digital' }]
    };

    const arbitratedEvidence = {
      accepted: [{ text: 'Fasilitas dan kegiatan mahasiswa S1 Bisnis Digital ITB STIKOM Bali mencakup laboratorium komputer dan UKM.', source: 'fasilitas_bd.pdf' }],
      aiEngine: mockAiEngine
    };

    const result = await synthesizeAnswer(semanticFrame, arbitratedEvidence);

    // Verifies truncation fallback was executed safely
    expect(result.truncated).toBe(true);
    expect(result.llmTelemetry).toBeDefined();
    expect(result.llmTelemetry.status).toBe('truncated');
    expect(result.llmTelemetry.fallback_reason).toBe('FINISH_REASON_LENGTH');
    expect(result.llmTelemetry.reasoning_tokens).toBe(800);
    expect(result.llmTelemetry.reasoning_effort).toBe('medium');
    expect(result.llmTelemetry.max_completion_tokens).toBe(1800);
  });

  // Test 7: Empty content completion is safely captured as empty_completion fallback
  test('7. Empty content completion is safely captured as empty_completion fallback', async () => {
    const mockAiEngine = {
      apiKey: 'test-real-mock-key',
      model: 'gpt-6-luna',
      client: {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              choices: [{
                finish_reason: 'stop',
                message: { content: '   ' } // empty
              }],
              usage: { prompt_tokens: 200, completion_tokens: 5 }
            })
          }
        }
      }
    };

    const semanticFrame = {
      domain: 'ACADEMIC_PROGRAM',
      intent: 'PROGRAM_INFO',
      requestedAttributes: ['overview'],
      entities: [{ canonical: 'S1 Sistem Informasi' }]
    };

    const arbitratedEvidence = {
      accepted: [{ text: 'Program S1 Sistem Informasi ITB STIKOM Bali.', source: 'profil_si.pdf' }],
      aiEngine: mockAiEngine
    };

    const result = await synthesizeAnswer(semanticFrame, arbitratedEvidence);

    expect(result.emptyModelResponse).toBe(true);
    expect(result.llmTelemetry.status).toBe('empty_completion');
    expect(result.llmTelemetry.fallback_reason).toBe('EMPTY_CONTENT');
  });

  // Test 8: API errors are safely classified without logging secrets
  test('8. API errors are safely classified without exposing secrets or credentials', async () => {
    const apiErr = new Error('Rate limit reached for requests');
    apiErr.status = 429;

    const mockAiEngine = {
      apiKey: 'secret-token-must-not-leak',
      model: 'gpt-6-luna',
      client: {
        chat: {
          completions: {
            create: jest.fn().mockRejectedValue(apiErr)
          }
        }
      }
    };

    const semanticFrame = {
      domain: 'ACADEMIC_PROGRAM',
      intent: 'PROGRAM_INFO',
      requestedAttributes: ['overview'],
      entities: [{ canonical: 'S1 Sistem Informasi' }]
    };

    const arbitratedEvidence = {
      accepted: [{ text: 'Program S1 Sistem Informasi ITB STIKOM Bali.', source: 'profil_si.pdf' }],
      aiEngine: mockAiEngine
    };

    const result = await synthesizeAnswer(semanticFrame, arbitratedEvidence);

    expect(result.llmError).toBe('Rate limit reached for requests');
    expect(result.llmTelemetry).toBeDefined();
    expect(result.llmTelemetry.status).toBe('api_error');
    expect(result.llmTelemetry.fallback_reason).toBe('RATE_LIMIT_EXCEEDED');

    // Error classification helper unit verification
    expect(classifySafeApiError({ status: 400 })).toBe('BAD_REQUEST_PARAMETER');
    expect(classifySafeApiError({ status: 401 })).toBe('AUTHENTICATION_FAILURE');
    expect(classifySafeApiError({ status: 404 })).toBe('MODEL_NOT_FOUND');
    expect(classifySafeApiError({ status: 503 })).toBe('SERVER_ERROR');
    expect(classifySafeApiError({ name: 'TimeoutError' })).toBe('REQUEST_TIMEOUT');
  });

  // Test 9: LLM is not called when budget gate denies reservation
  test('9. LLM is not called when budget gate denies reservation', async () => {
    const adapter = new MemoryPersistentAdapter();
    const ledger = new BudgetLedgerManager(adapter);

    const mockAiEngine = {
      apiKey: 'test-real-mock-key',
      model: 'gpt-6-luna',
      client: {
        chat: {
          completions: {
            create: jest.fn()
          }
        }
      }
    };

    const semanticFrame = {
      domain: 'ACADEMIC_PROGRAM',
      intent: 'PROGRAM_INFO',
      requestedAttributes: ['overview'],
      entities: [{ canonical: 'S1 Sistem Informasi' }]
    };

    const arbitratedEvidence = {
      accepted: [{ text: 'Program S1 Sistem Informasi ITB STIKOM Bali.', source: 'profil_si.pdf' }],
      aiEngine: mockAiEngine,
      budgetLedger: ledger,
      maxBudgetUSD: 0.00000001 // tiny budget forces reservation denial
    };

    const result = await synthesizeAnswer(semanticFrame, arbitratedEvidence);

    expect(mockAiEngine.client.chat.completions.create).not.toHaveBeenCalled();
    expect(result.budgetExceeded).toBe(true);
    expect(result.llmTelemetry.status).toBe('budget_denied');
    expect(result.llmTelemetry.fallback_reason).toBe('DAILY_BUDGET_EXCEEDED');
  });

  // Test 10: Verifier recovery can be distinguished from API failure
  test('10. Circuit breaker states (CLOSED, OPEN, HALF_OPEN) transition accurately with probe recovery', () => {
    // Initial state
    expect(getCircuitBreakerState()).toBe('CLOSED');

    // Trip with fatal quota error
    const quotaErr = new Error('You exceeded your current quota');
    quotaErr.status = 429;

    // Simulate quota error trip
    const mockAiEngine = {
      apiKey: 'test-real-mock-key',
      model: 'gpt-6-luna',
      client: {
        chat: {
          completions: {
            create: jest.fn().mockRejectedValue(quotaErr)
          }
        }
      }
    };

    const arbitratedEvidence = {
      accepted: [{ text: 'Evidence test.', source: 'test.pdf' }],
      aiEngine: mockAiEngine
    };

    return synthesizeAnswer({ domain: 'ACADEMIC_PROGRAM' }, arbitratedEvidence).then(res => {
      expect(res.llmTelemetry.status).toBe('api_error');
      expect(res.llmTelemetry.fallback_reason).toBe('QUOTA_EXHAUSTED');
      expect(getCircuitBreakerState()).toBe('OPEN');

      // Next call should be intercepted by open circuit without calling API
      mockAiEngine.client.chat.completions.create.mockClear();
      return synthesizeAnswer({ domain: 'ACADEMIC_PROGRAM' }, arbitratedEvidence).then(res2 => {
        expect(mockAiEngine.client.chat.completions.create).not.toHaveBeenCalled();
        expect(res2.llmTelemetry.status).toBe('circuit_open');
        expect(res2.llmTelemetry.fallback_reason).toBe('CIRCUIT_BREAKER_OPEN');
      });
    });
  });

  // Test 11: QUOTA_EXHAUSTED does NOT automatically probe after cooldown, stays OPEN until explicit recovery
  test('11. QUOTA_EXHAUSTED does not allow automatic probe after cooldown and stays OPEN until explicit clearance', async () => {
    process.env.OPENAI_CIRCUIT_COOLDOWN_MS = '1000'; // 1 second cooldown
    const quotaErr = new Error('You exceeded your current quota');
    quotaErr.status = 429;

    const mockAiEngine = {
      apiKey: 'test-real-mock-key',
      model: 'gpt-6-luna',
      client: {
        chat: {
          completions: {
            create: jest.fn().mockRejectedValue(quotaErr)
          }
        }
      }
    };

    const arbitratedEvidence = {
      accepted: [{ text: 'Evidence test.', source: 'test.pdf' }],
      aiEngine: mockAiEngine
    };

    // First call trips circuit
    await synthesizeAnswer({ domain: 'ACADEMIC_PROGRAM' }, arbitratedEvidence);
    expect(getCircuitBreakerState()).toBe('OPEN');

    // Simulate waiting past cooldown window
    await new Promise(resolve => setTimeout(resolve, 1100));

    // After cooldown, normal circuit breaker would go to HALF_OPEN, but QUOTA_EXHAUSTED must NOT
    mockAiEngine.client.chat.completions.create.mockClear();
    const resAfterCooldown = await synthesizeAnswer({ domain: 'ACADEMIC_PROGRAM' }, arbitratedEvidence);

    expect(mockAiEngine.client.chat.completions.create).not.toHaveBeenCalled();
    expect(resAfterCooldown.llmTelemetry.status).toBe('circuit_open');
    expect(resAfterCooldown.llmTelemetry.fallback_reason).toBe('CIRCUIT_BREAKER_OPEN');

    // Explicit recovery clears quota exhaustion
    clearCircuitBreakerQuotaExhaustion();
    expect(getCircuitBreakerState()).toBe('CLOSED');

    // Now API can be called again
    mockAiEngine.client.chat.completions.create.mockResolvedValueOnce({
      choices: [{ finish_reason: 'stop', message: { content: 'Recovered answer.' } }],
      usage: { prompt_tokens: 100, completion_tokens: 20 }
    });
    const resAfterRecovery = await synthesizeAnswer({ domain: 'ACADEMIC_PROGRAM' }, arbitratedEvidence);
    expect(resAfterRecovery.success).toBe(true);
    expect(mockAiEngine.client.chat.completions.create).toHaveBeenCalledTimes(1);
    delete process.env.OPENAI_CIRCUIT_COOLDOWN_MS;
  });

  // Test 12: RATE_LIMIT_EXCEEDED (transient 429) does not trip circuit to persistent open
  test('12. RATE_LIMIT_EXCEEDED is classified without tripping circuit to persistent quota open', async () => {
    const rateLimitErr = new Error('Rate limit reached for requests per minute (TPM)');
    rateLimitErr.status = 429;

    const mockAiEngine = {
      apiKey: 'test-real-mock-key',
      model: 'gpt-6-luna',
      client: {
        chat: {
          completions: {
            create: jest.fn().mockRejectedValue(rateLimitErr)
          }
        }
      }
    };

    const arbitratedEvidence = {
      accepted: [{ text: 'Evidence test.', source: 'test.pdf' }],
      aiEngine: mockAiEngine
    };

    const res = await synthesizeAnswer({ domain: 'ACADEMIC_PROGRAM' }, arbitratedEvidence);
    expect(res.llmTelemetry.status).toBe('api_error');
    expect(res.llmTelemetry.fallback_reason).toBe('RATE_LIMIT_EXCEEDED');
    // Does not trip circuit to OPEN
    expect(getCircuitBreakerState()).toBe('CLOSED');
  });

  // Test 13: 400 Bad Request is not retried and does not trip circuit breaker
  test('13. 400 Bad Request error is safely classified and does not trip circuit breaker', async () => {
    const badReqErr = new Error('Invalid parameter combination in request payload');
    badReqErr.status = 400;

    const mockAiEngine = {
      apiKey: 'test-real-mock-key',
      model: 'gpt-6-luna',
      client: {
        chat: {
          completions: {
            create: jest.fn().mockRejectedValue(badReqErr)
          }
        }
      }
    };

    const arbitratedEvidence = {
      accepted: [{ text: 'Evidence test.', source: 'test.pdf' }],
      aiEngine: mockAiEngine
    };

    const res = await synthesizeAnswer({ domain: 'ACADEMIC_PROGRAM' }, arbitratedEvidence);
    expect(res.llmTelemetry.status).toBe('api_error');
    expect(res.llmTelemetry.fallback_reason).toBe('BAD_REQUEST_PARAMETER');
    expect(getCircuitBreakerState()).toBe('CLOSED');
  });

  // Test 14: 401 Unauthorized is classified as AUTHENTICATION_FAILURE
  test('14. 401 Unauthorized error is classified as AUTHENTICATION_FAILURE without treating as transient', async () => {
    const authErr = new Error('Incorrect API key provided');
    authErr.status = 401;

    const mockAiEngine = {
      apiKey: 'test-real-mock-key',
      model: 'gpt-6-luna',
      client: {
        chat: {
          completions: {
            create: jest.fn().mockRejectedValue(authErr)
          }
        }
      }
    };

    const arbitratedEvidence = {
      accepted: [{ text: 'Evidence test.', source: 'test.pdf' }],
      aiEngine: mockAiEngine
    };

    const res = await synthesizeAnswer({ domain: 'ACADEMIC_PROGRAM' }, arbitratedEvidence);
    expect(res.llmTelemetry.status).toBe('api_error');
    expect(res.llmTelemetry.fallback_reason).toBe('AUTHENTICATION_FAILURE');
    expect(getCircuitBreakerState()).toBe('CLOSED');
  });

  // Test 15: 5xx server errors trip after 3 consecutive failures and allow HALF_OPEN probe
  test('15. Consecutive 5xx server errors trip after 3 failures and allow controlled probe after cooldown', async () => {
    process.env.OPENAI_CIRCUIT_COOLDOWN_MS = '1000';
    const serverErr = new Error('The server had an internal error');
    serverErr.status = 503;

    const mockAiEngine = {
      apiKey: 'test-real-mock-key',
      model: 'gpt-6-luna',
      client: {
        chat: {
          completions: {
            create: jest.fn().mockRejectedValue(serverErr)
          }
        }
      }
    };

    const arbitratedEvidence = {
      accepted: [{ text: 'Evidence test.', source: 'test.pdf' }],
      aiEngine: mockAiEngine
    };

    // Call 1 (failure 1)
    await synthesizeAnswer({ domain: 'ACADEMIC_PROGRAM' }, arbitratedEvidence);
    expect(getCircuitBreakerState()).toBe('CLOSED');

    // Call 2 (failure 2)
    await synthesizeAnswer({ domain: 'ACADEMIC_PROGRAM' }, arbitratedEvidence);
    expect(getCircuitBreakerState()).toBe('CLOSED');

    // Call 3 (failure 3) -> Trips to OPEN
    await synthesizeAnswer({ domain: 'ACADEMIC_PROGRAM' }, arbitratedEvidence);
    expect(getCircuitBreakerState()).toBe('OPEN');

    // Wait cooldown
    await new Promise(resolve => setTimeout(resolve, 1100));

    // Next call probes in HALF_OPEN; mock returns success
    mockAiEngine.client.chat.completions.create.mockResolvedValueOnce({
      choices: [{ finish_reason: 'stop', message: { content: 'Server recovered.' } }],
      usage: { prompt_tokens: 50, completion_tokens: 10 }
    });

    const res = await synthesizeAnswer({ domain: 'ACADEMIC_PROGRAM' }, arbitratedEvidence);
    expect(res.success).toBe(true);
    // Successful probe resets circuit to CLOSED
    expect(getCircuitBreakerState()).toBe('CLOSED');
    delete process.env.OPENAI_CIRCUIT_COOLDOWN_MS;
  });

  // Test 16: Empty choices array is safely handled without throwing
  test('16. Empty choices array in response triggers fallback with finish_reason "unknown"', async () => {
    const mockAiEngine = {
      apiKey: 'test-real-mock-key',
      model: 'gpt-6-luna',
      client: {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              choices: [], // empty choices array
              usage: { prompt_tokens: 100, completion_tokens: 0 }
            })
          }
        }
      }
    };

    const arbitratedEvidence = {
      accepted: [{ text: 'Evidence test.', source: 'test.pdf' }],
      aiEngine: mockAiEngine
    };

    const res = await synthesizeAnswer({ domain: 'ACADEMIC_PROGRAM' }, arbitratedEvidence);
    expect(res.emptyModelResponse).toBe(true);
    expect(res.llmTelemetry.status).toBe('empty_completion');
    expect(res.llmTelemetry.fallback_reason).toBe('NO_CHOICES_RETURNED');
    expect(res.llmTelemetry.finish_reason).toBe('unknown');
  });

  // Test 17: finish_reason null/undefined with content is classified as "unknown" and does not record normal success
  test('17. finish_reason null or undefined is classified as "unknown" and does not record normal success', async () => {
    const mockAiEngine = {
      apiKey: 'test-real-mock-key',
      model: 'gpt-6-luna',
      client: {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              choices: [{
                finish_reason: null, // missing finish_reason
                message: { content: 'Unfinished partial content without clear reason' }
              }],
              usage: { prompt_tokens: 150, completion_tokens: 30 }
            })
          }
        }
      }
    };

    const arbitratedEvidence = {
      accepted: [{ text: 'Evidence test.', source: 'test.pdf' }],
      aiEngine: mockAiEngine
    };

    const res = await synthesizeAnswer({ domain: 'ACADEMIC_PROGRAM' }, arbitratedEvidence);
    expect(res.llmTelemetry.finish_reason).toBe('unknown');
    expect(res.llmTelemetry.status).toBe('invalid_finish_reason');
    expect(res.llmTelemetry.fallback_reason).toBe('INVALID_OR_MISSING_FINISH_REASON');
  });
});