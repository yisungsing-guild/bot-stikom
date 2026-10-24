'use strict';

/**
 * tests/modelSemanticParser.test.js
 * 
 * Phase A Test Suite: Generic Model-Driven Semantic Parser.
 * Part A: Contract & Schema Validation Tests (Mocked Provider).
 * Part B: Optional Real-Model Semantic Smoke Tests (Gated by MODEL_SEMANTIC_REAL_TEST=true).
 */

const {
  parseSemanticInterpretation,
  buildSafeUnknownInterpretation,
  validateInterpretationSchema,
  ALLOWED_SPEECH_ACTS,
  ALLOWED_SEMANTIC_CONCEPTS,
  ALLOWED_REQUESTED_ASPECTS
} = require('../src/core/modelSemanticParser');

function createMockOpenAIClient(contentOrFn, delayMs = 0) {
  return {
    chat: {
      completions: {
        create: async (payload, options = {}) => {
          if (delayMs > 0) {
            await new Promise((resolve, reject) => {
              const timer = setTimeout(resolve, delayMs);
              if (options.signal) {
                options.signal.addEventListener('abort', () => {
                  clearTimeout(timer);
                  const abortErr = new Error('Request aborted');
                  abortErr.name = 'AbortError';
                  reject(abortErr);
                });
              }
            });
          }
          if (typeof contentOrFn === 'function') {
            const result = contentOrFn(payload);
            if (result instanceof Error) throw result;
            return {
              choices: [{ message: { content: typeof result === 'string' ? result : JSON.stringify(result) } }]
            };
          }
          return {
            choices: [{ message: { content: typeof contentOrFn === 'string' ? contentOrFn : JSON.stringify(contentOrFn) } }]
          };
        }
      }
    }
  };
}

describe('Phase A Contract & Validation Tests (Mocked Provider)', () => {

  // 1. Normal academic discovery
  test('1. Normal academic discovery contract: "jurusan apa saja yang tersedia?" => DISCOVER_LIST + ACADEMIC_OFFERING', async () => {
    const mockClient = createMockOpenAIClient({
      speechAct: 'DISCOVER_LIST',
      semanticConcepts: ['ACADEMIC_OFFERING'],
      candidateEntities: [],
      requestedAspects: ['general'],
      scopeConstraints: {
        academicLevel: null,
        studyMode: null,
        locationConstraint: null
      },
      contextDependency: {
        isFollowUp: false,
        referenceType: 'none'
      },
      confidence: 0.95,
      ambiguityLevel: 'LOW'
    });

    const result = await parseSemanticInterpretation(
      { rawQuery: 'jurusan apa saja yang tersedia?' },
      { client: mockClient }
    );

    expect(result.speechAct).toBe('DISCOVER_LIST');
    expect(result.semanticConcepts).toContain('ACADEMIC_OFFERING');
    expect(result.ambiguityLevel).toBe('LOW');
    expect(result.metadata.fallbackInvoked).toBe(false);
  });

  // 2. Slang / Typo contract validation
  test('2. Slang/typo contract validation: "jrusan yg bsa dipilih apa aja kak?" maps to DISCOVER_LIST without parser regexes', async () => {
    const mockClient = createMockOpenAIClient({
      speechAct: 'DISCOVER_LIST',
      semanticConcepts: ['ACADEMIC_OFFERING'],
      candidateEntities: [],
      requestedAspects: ['general'],
      scopeConstraints: {
        academicLevel: null,
        studyMode: null,
        locationConstraint: null
      },
      contextDependency: {
        isFollowUp: false,
        referenceType: 'none'
      },
      confidence: 0.92,
      ambiguityLevel: 'LOW'
    });

    const result = await parseSemanticInterpretation(
      { rawQuery: 'jrusan yg bsa dipilih apa aja kak?' },
      { client: mockClient }
    );

    expect(result.speechAct).toBe('DISCOVER_LIST');
    expect(result.semanticConcepts).toContain('ACADEMIC_OFFERING');
    expect(result.ambiguityLevel).toBe('LOW');
  });

  // 3. Fee typo contract
  test('3. Fee typo contract: "brapa total bya pndaftaran maba?" => FINANCIAL_COST + ADMISSION_ONBOARDING', async () => {
    const mockClient = createMockOpenAIClient({
      speechAct: 'INQUIRE_PROPERTY',
      semanticConcepts: ['FINANCIAL_COST', 'ADMISSION_ONBOARDING'],
      candidateEntities: [
        {
          rawMention: 'mahasiswa baru',
          inferredCategory: 'admission_track',
          academicLevel: null
        }
      ],
      requestedAspects: ['fee', 'requirements'],
      scopeConstraints: {
        academicLevel: null,
        studyMode: null,
        locationConstraint: null
      },
      contextDependency: {
        isFollowUp: false,
        referenceType: 'none'
      },
      confidence: 0.94,
      ambiguityLevel: 'LOW'
    });

    const result = await parseSemanticInterpretation(
      { rawQuery: 'brapa total bya pndaftaran maba?' },
      { client: mockClient }
    );

    expect(result.speechAct).toBe('INQUIRE_PROPERTY');
    expect(result.semanticConcepts).toContain('FINANCIAL_COST');
    expect(result.semanticConcepts).toContain('ADMISSION_ONBOARDING');
    expect(result.requestedAspects).toContain('fee');
  });

  // 4. Accreditation contract
  test('4. Accreditation contract: "akreditasi jurusan teknologi informasi apa ya?" => QUALITY_ACCREDITATION', async () => {
    const mockClient = createMockOpenAIClient({
      speechAct: 'INQUIRE_PROPERTY',
      semanticConcepts: ['QUALITY_ACCREDITATION'],
      candidateEntities: [
        {
          rawMention: 'teknologi informasi',
          inferredCategory: 'academic_program',
          academicLevel: 'S1'
        }
      ],
      requestedAspects: ['accreditation'],
      scopeConstraints: {
        academicLevel: 'S1',
        studyMode: null,
        locationConstraint: null
      },
      contextDependency: {
        isFollowUp: false,
        referenceType: 'none'
      },
      confidence: 0.96,
      ambiguityLevel: 'LOW'
    });

    const result = await parseSemanticInterpretation(
      { rawQuery: 'akreditasi jurusan teknologi informasi apa ya?' },
      { client: mockClient }
    );

    expect(result.speechAct).toBe('INQUIRE_PROPERTY');
    expect(result.semanticConcepts).toContain('QUALITY_ACCREDITATION');
    expect(result.candidateEntities[0].rawMention).toBe('teknologi informasi');
    expect(result.requestedAspects).toContain('accreditation');
  });

  // 5. Follow-up dependency preserved without inventing entity
  test('5. Follow-up contract: "bagaimana akreditasinya?" preserves isFollowUp and referenceType without inventing entity', async () => {
    const mockClient = createMockOpenAIClient({
      speechAct: 'INQUIRE_PROPERTY',
      semanticConcepts: ['QUALITY_ACCREDITATION'],
      candidateEntities: [], // MUST NOT invent entity from prior turn in Phase A parser!
      requestedAspects: ['accreditation'],
      scopeConstraints: {
        academicLevel: null,
        studyMode: null,
        locationConstraint: null
      },
      contextDependency: {
        isFollowUp: true,
        referenceType: 'ellipsis'
      },
      confidence: 0.90,
      ambiguityLevel: 'LOW'
    });

    const history = [
      { role: 'user', content: 'jelaskan Bisnis Digital' },
      { role: 'assistant', content: 'Bisnis Digital adalah prodi...' }
    ];

    const result = await parseSemanticInterpretation(
      { rawQuery: 'bagaimana akreditasinya?', conversationHistory: history },
      { client: mockClient }
    );

    expect(result.contextDependency.isFollowUp).toBe(true);
    expect(result.contextDependency.referenceType).toBe('ellipsis');
    expect(result.candidateEntities).toEqual([]);
    expect(result.requestedAspects).toContain('accreditation');
  });

  // 6. Multi-entity ambiguity preserved
  test('6. Multi-entity ambiguity: preserves both candidate entities and marks ambiguity HIGH', async () => {
    const mockClient = createMockOpenAIClient({
      speechAct: 'INQUIRE_PROPERTY',
      semanticConcepts: ['QUALITY_ACCREDITATION'],
      candidateEntities: [
        {
          rawMention: 'Bisnis Digital',
          inferredCategory: 'academic_program',
          academicLevel: 'S1'
        },
        {
          rawMention: 'Sistem Informasi',
          inferredCategory: 'academic_program',
          academicLevel: 'S1'
        }
      ],
      requestedAspects: ['accreditation'],
      scopeConstraints: {
        academicLevel: 'S1',
        studyMode: null,
        locationConstraint: null
      },
      contextDependency: {
        isFollowUp: false,
        referenceType: 'none'
      },
      confidence: 0.88,
      ambiguityLevel: 'HIGH'
    });

    const result = await parseSemanticInterpretation(
      { rawQuery: 'Bisnis Digital dan Sistem Informasi — akreditasinya apa?' },
      { client: mockClient }
    );

    expect(result.candidateEntities.length).toBe(2);
    expect(result.candidateEntities.map(e => e.rawMention)).toEqual(['Bisnis Digital', 'Sistem Informasi']);
    expect(result.ambiguityLevel).toBe('HIGH');
  });

  // 7. Unsupported-looking entity preserved as raw mention (NOT classified as unsupported)
  test('7. Unsupported-looking entity: "ada teknik nuklir?" preserves raw mention and does not declare unsupported in Phase A', async () => {
    const mockClient = createMockOpenAIClient({
      speechAct: 'VERIFY_STATUS',
      semanticConcepts: ['ACADEMIC_OFFERING'],
      candidateEntities: [
        {
          rawMention: 'teknik nuklir',
          inferredCategory: 'academic_program',
          academicLevel: null
        }
      ],
      requestedAspects: ['general'],
      scopeConstraints: {
        academicLevel: null,
        studyMode: null,
        locationConstraint: null
      },
      contextDependency: {
        isFollowUp: false,
        referenceType: 'none'
      },
      confidence: 0.95,
      ambiguityLevel: 'LOW'
    });

    const result = await parseSemanticInterpretation(
      { rawQuery: 'ada teknik nuklir?' },
      { client: mockClient }
    );

    expect(result.speechAct).toBe('VERIFY_STATUS');
    expect(result.candidateEntities[0].rawMention).toBe('teknik nuklir');
    expect(result.unsupportedEntity).toBeUndefined();
  });

  // 8. Greeting
  test('8. Greeting: "halo kak" => GENERAL_GREETING', async () => {
    const mockClient = createMockOpenAIClient({
      speechAct: 'GENERAL_GREETING',
      semanticConcepts: [],
      candidateEntities: [],
      requestedAspects: [],
      scopeConstraints: {
        academicLevel: null,
        studyMode: null,
        locationConstraint: null
      },
      contextDependency: {
        isFollowUp: false,
        referenceType: 'none'
      },
      confidence: 0.99,
      ambiguityLevel: 'LOW'
    });

    const result = await parseSemanticInterpretation(
      { rawQuery: 'halo kak' },
      { client: mockClient }
    );

    expect(result.speechAct).toBe('GENERAL_GREETING');
    expect(result.candidateEntities).toHaveLength(0);
  });

  // 9. Provider timeout => deterministic safe UNKNOWN/HIGH_AMBIGUITY
  test('9. Provider timeout triggers AbortController and returns safe UNKNOWN/HIGH_AMBIGUITY', async () => {
    const mockClient = createMockOpenAIClient({}, 200);

    const result = await parseSemanticInterpretation(
      { rawQuery: 'biaya kuliah berapa?' },
      { client: mockClient, timeoutMs: 50 }
    );

    expect(result.speechAct).toBe('UNKNOWN');
    expect(result.ambiguityLevel).toBe('HIGH');
    expect(result.confidence).toBe(0.0);
    expect(result.metadata.fallbackInvoked).toBe(true);
    expect(result.metadata.reason).toMatch(/timeout/i);
  });

  // 10. Provider error => deterministic safe UNKNOWN/HIGH_AMBIGUITY
  test('10. Provider error => deterministic safe UNKNOWN/HIGH_AMBIGUITY', async () => {
    const mockClient = createMockOpenAIClient(() => new Error('OpenAI 500 Internal Error'));

    const result = await parseSemanticInterpretation(
      { rawQuery: 'jadwal tes kapan?' },
      { client: mockClient }
    );

    expect(result.speechAct).toBe('UNKNOWN');
    expect(result.ambiguityLevel).toBe('HIGH');
    expect(result.confidence).toBe(0.0);
    expect(result.metadata.fallbackInvoked).toBe(true);
    expect(result.metadata.reason).toBe('provider_error');
  });

  // 11. Malformed structured output => reject safely
  test('11. Malformed structured output => reject safely', async () => {
    const mockClient = createMockOpenAIClient('<<<Not a valid JSON string>>>');

    const result = await parseSemanticInterpretation(
      { rawQuery: 'info beasiswa' },
      { client: mockClient }
    );

    expect(result.speechAct).toBe('UNKNOWN');
    expect(result.ambiguityLevel).toBe('HIGH');
    expect(result.metadata.fallbackInvoked).toBe(true);
    expect(result.metadata.reason).toBe('json_parse_error');
  });

  // 12. Schema-invalid enum => reject safely
  test('12. Schema-invalid enum => reject safely to UNKNOWN', async () => {
    const mockClient = createMockOpenAIClient({
      speechAct: 'INVALID_UNKNOWN_ACT_NAME',
      semanticConcepts: ['ACADEMIC_OFFERING'],
      candidateEntities: [],
      requestedAspects: [],
      scopeConstraints: {
        academicLevel: null,
        studyMode: null,
        locationConstraint: null
      },
      contextDependency: {
        isFollowUp: false,
        referenceType: 'none'
      },
      confidence: 0.9,
      ambiguityLevel: 'LOW'
    });

    const result = await parseSemanticInterpretation(
      { rawQuery: 'jurusan apa saja' },
      { client: mockClient }
    );

    expect(result.speechAct).toBe('UNKNOWN');
    expect(result.metadata.fallbackInvoked).toBe(true);
    expect(result.metadata.reason).toMatch(/schema_violation/i);
  });

  // 13. Empty candidate entity => valid only when semantically appropriate
  test('13. Empty candidate entity is valid for generic institutional discovery', async () => {
    const mockClient = createMockOpenAIClient({
      speechAct: 'DISCOVER_LIST',
      semanticConcepts: ['ACADEMIC_OFFERING'],
      candidateEntities: [],
      requestedAspects: ['general'],
      scopeConstraints: {
        academicLevel: null,
        studyMode: null,
        locationConstraint: null
      },
      contextDependency: {
        isFollowUp: false,
        referenceType: 'none'
      },
      confidence: 0.95,
      ambiguityLevel: 'LOW'
    });

    const result = await parseSemanticInterpretation(
      { rawQuery: 'pilihan prodinya apa saja?' },
      { client: mockClient }
    );

    expect(result.candidateEntities).toHaveLength(0);
    expect(result.speechAct).toBe('DISCOVER_LIST');
  });

  // 14. Multiple candidate entities => preserve all candidates; never collapse them arbitrarily
  test('14. Multiple candidate entities are preserved and never collapsed', async () => {
    const mockClient = createMockOpenAIClient({
      speechAct: 'COMPARE',
      semanticConcepts: ['ACADEMIC_OFFERING'],
      candidateEntities: [
        { rawMention: 'Sistem Informasi', inferredCategory: 'academic_program', academicLevel: 'S1' },
        { rawMention: 'Sistem Komputer', inferredCategory: 'academic_program', academicLevel: 'S1' },
        { rawMention: 'Bisnis Digital', inferredCategory: 'academic_program', academicLevel: 'S1' }
      ],
      requestedAspects: ['curriculum', 'career'],
      scopeConstraints: {
        academicLevel: 'S1',
        studyMode: null,
        locationConstraint: null
      },
      contextDependency: {
        isFollowUp: false,
        referenceType: 'none'
      },
      confidence: 0.96,
      ambiguityLevel: 'LOW'
    });

    const result = await parseSemanticInterpretation(
      { rawQuery: 'apa bedanya sistem informasi, sistem komputer, dan bisnis digital?' },
      { client: mockClient }
    );

    expect(result.candidateEntities).toHaveLength(3);
    expect(result.candidateEntities.map(e => e.rawMention)).toEqual([
      'Sistem Informasi',
      'Sistem Komputer',
      'Bisnis Digital'
    ]);
  });

  // 15. Novel wording contract handling (Parser contract verification)
  test('15. Novel wording contract handling: validates parser does not reject or mangle valid interpretation structures for novel queries', async () => {
    const novelSentences = [
      'lagi nyari jurusan buat kuliah, di sini ada apa aja?',
      'kalau mau kuliah di stikom opsinya apa aja ya?',
      'mau tau dong daftar prodi yang dibuka'
    ];

    for (const sentence of novelSentences) {
      const mockClient = createMockOpenAIClient({
        speechAct: 'DISCOVER_LIST',
        semanticConcepts: ['ACADEMIC_OFFERING'],
        candidateEntities: [],
        requestedAspects: ['general'],
        scopeConstraints: {
          academicLevel: null,
          studyMode: null,
          locationConstraint: null
        },
        contextDependency: {
          isFollowUp: false,
          referenceType: 'none'
        },
        confidence: 0.93,
        ambiguityLevel: 'LOW'
      });

      const res = await parseSemanticInterpretation(
        { rawQuery: sentence },
        { client: mockClient }
      );

      expect(res.speechAct).toBe('DISCOVER_LIST');
      expect(res.semanticConcepts).toContain('ACADEMIC_OFFERING');
      expect(res.metadata.fallbackInvoked).toBe(false);
    }
  });

  // 16. Fallback structural safety: empty query
  test('16. Empty query immediately returns safe UNKNOWN without calling provider', async () => {
    const mockClient = createMockOpenAIClient(() => {
      throw new Error('Should not be called for empty query');
    });

    const result = await parseSemanticInterpretation(
      { rawQuery: '   ' },
      { client: mockClient }
    );

    expect(result.speechAct).toBe('UNKNOWN');
    expect(result.confidence).toBe(0.0);
    expect(result.metadata.reason).toBe('empty_query');
  });

  // 17. Late-resolving provider promise does not mutate state or trigger unhandled rejection
  test('17. Late-resolving provider promise after timeout does not mutate returned object or leak rejection', async () => {
    let lateResolveCallback = null;
    const mockClient = {
      chat: {
        completions: {
          create: async () => {
            return new Promise((resolve) => {
              lateResolveCallback = resolve;
            });
          }
        }
      }
    };

    const resultPromise = parseSemanticInterpretation(
      { rawQuery: 'tes late promise' },
      { client: mockClient, timeoutMs: 30 }
    );

    const initialResult = await resultPromise;
    expect(initialResult.speechAct).toBe('UNKNOWN');
    expect(initialResult.metadata.fallbackInvoked).toBe(true);

    // Simulate late resolution after timeout has already completed
    if (typeof lateResolveCallback === 'function') {
      lateResolveCallback({
        choices: [{
          message: {
            content: JSON.stringify({
              speechAct: 'DISCOVER_LIST',
              semanticConcepts: ['ACADEMIC_OFFERING'],
              candidateEntities: [],
              requestedAspects: ['general'],
              scopeConstraints: { academicLevel: null, studyMode: null, locationConstraint: null },
              contextDependency: { isFollowUp: false, referenceType: 'none' },
              confidence: 0.99,
              ambiguityLevel: 'LOW'
            })
          }
        }]
      });
    }

    // Verify initialResult remains unchanged
    expect(initialResult.speechAct).toBe('UNKNOWN');
    expect(initialResult.metadata.fallbackInvoked).toBe(true);
  });

  // 18. Warm request behavior: verifies persistent client instance reuse across sequential invocations
  test('18. Warm request behavior: verifies persistent client instance is reused across sequential invocations', async () => {
    let callCount = 0;
    const trackingClient = {
      chat: {
        completions: {
          create: async () => {
            callCount++;
            return {
              choices: [{
                message: {
                  content: JSON.stringify({
                    speechAct: 'DISCOVER_LIST',
                    semanticConcepts: ['ACADEMIC_OFFERING'],
                    candidateEntities: [],
                    requestedAspects: ['general'],
                    scopeConstraints: { academicLevel: null, studyMode: null, locationConstraint: null },
                    contextDependency: { isFollowUp: false, referenceType: 'none' },
                    confidence: 0.95,
                    ambiguityLevel: 'LOW'
                  })
                }
              }]
            };
          }
        }
      }
    };

    const r1 = await parseSemanticInterpretation({ rawQuery: 'jurusan 1' }, { client: trackingClient });
    const r2 = await parseSemanticInterpretation({ rawQuery: 'jurusan 2' }, { client: trackingClient });
    expect(callCount).toBe(2);
    expect(r1.speechAct).toBe('DISCOVER_LIST');
    expect(r2.speechAct).toBe('DISCOVER_LIST');
    expect(r1.metadata.fallbackInvoked).toBe(false);
    expect(r2.metadata.fallbackInvoked).toBe(false);
  });

  // 19. Model configuration hierarchy: options.model > SEMANTIC_PARSER_MODEL > OPENAI_MODEL > default gpt-5.2
  test('19. Model configuration hierarchy and max_completion_tokens usage for GPT-5', async () => {
    let capturedPayload = null;
    const inspectingClient = {
      chat: {
        completions: {
          create: async (payload) => {
            capturedPayload = payload;
            return {
              model: payload.model,
              id: 'test_req_id',
              choices: [{
                message: {
                  content: JSON.stringify({
                    speechAct: 'INQUIRE_PROPERTY',
                    semanticConcepts: ['FINANCIAL_COST'],
                    candidateEntities: [],
                    requestedAspects: ['fee'],
                    scopeConstraints: { academicLevel: null, studyMode: null, locationConstraint: null },
                    contextDependency: { isFollowUp: false, referenceType: 'none' },
                    confidence: 0.9,
                    ambiguityLevel: 'LOW'
                  })
                }
              }]
            };
          }
        }
      }
    };

    // Test explicit option override
    const resOpt = await parseSemanticInterpretation(
      { rawQuery: 'berapa biaya?' },
      { client: inspectingClient, model: 'gpt-5.2-custom' }
    );
    expect(capturedPayload.model).toBe('gpt-5.2-custom');
    expect(capturedPayload.max_completion_tokens).toBe(300);
    expect(capturedPayload.max_tokens).toBeUndefined();
    expect(resOpt.metadata.model).toBe('gpt-5.2-custom');
    expect(resOpt.metadata.responseModel).toBe('gpt-5.2-custom');
    expect(resOpt.metadata.requestId).toBe('test_req_id');

    // Test gpt-6-luna uses max_completion_tokens
    const resLuna = await parseSemanticInterpretation(
      { rawQuery: 'berapa biaya?' },
      { client: inspectingClient, model: 'gpt-6-luna' }
    );
    expect(capturedPayload.model).toBe('gpt-6-luna');
    expect(capturedPayload.max_completion_tokens).toBe(300);
    expect(capturedPayload.max_tokens).toBeUndefined();
    expect(resLuna.metadata.model).toBe('gpt-6-luna');

    // Test legacy model uses max_tokens
    await parseSemanticInterpretation(
      { rawQuery: 'berapa biaya?' },
      { client: inspectingClient, model: 'gpt-3.5-turbo' }
    );
    expect(capturedPayload.model).toBe('gpt-3.5-turbo');
    expect(capturedPayload.max_tokens).toBe(300);
    expect(capturedPayload.max_completion_tokens).toBeUndefined();
  });

});

// Part B: Optional Real-Model Semantic Smoke Tests (Gated by MODEL_SEMANTIC_REAL_TEST=true)
const runRealModelTest = process.env.MODEL_SEMANTIC_REAL_TEST === 'true' && Boolean(process.env.OPENAI_API_KEY);
const describeRealModel = runRealModelTest ? describe : describe.skip;

describeRealModel('Phase A Optional Real-Model Semantic Validation Smoke Tests', () => {
  const smokeOpts = { timeoutMs: 3500 };

  test('Real Model Query A: Natural academic discovery', async () => {
    const res = await parseSemanticInterpretation({
      rawQuery: 'mau cari info prodi apa aja yg ada di kampus'
    }, smokeOpts);
    expect(res.metadata.fallbackInvoked).toBe(false);
    expect(res.speechAct).toBe('DISCOVER_LIST');
    expect(res.semanticConcepts).toContain('ACADEMIC_OFFERING');
    expect(res.ambiguityLevel).toBe('LOW');
  });

  test('Real Model Query B: Fee inquiry with typo and slang', async () => {
    const res = await parseSemanticInterpretation({
      rawQuery: 'bya kuliah smester awal brapa ya min?'
    }, smokeOpts);
    expect(res.metadata.fallbackInvoked).toBe(false);
    expect(res.semanticConcepts).toContain('FINANCIAL_COST');
    expect(res.requestedAspects).toContain('fee');
  });

  test('Real Model Query C: Accreditation with inverted word order', async () => {
    const res = await parseSemanticInterpretation({
      rawQuery: 'status akreditasi untuk bisnis digital apa ya?'
    }, smokeOpts);
    expect(res.metadata.fallbackInvoked).toBe(false);
    expect(res.semanticConcepts).toContain('QUALITY_ACCREDITATION');
    expect(res.requestedAspects).toContain('accreditation');
    expect(res.candidateEntities.some(e => /bisnis digital/i.test(e.rawMention))).toBe(true);
  });

  test('Real Model Query D: Elliptical follow-up', async () => {
    const res = await parseSemanticInterpretation({
      rawQuery: 'kalau akreditasinya?',
      conversationHistory: [
        { role: 'user', content: 'jelaskan Bisnis Digital' },
        { role: 'assistant', content: 'Bisnis Digital adalah program sarjana...' }
      ]
    }, smokeOpts);
    expect(res.metadata.fallbackInvoked).toBe(false);
    expect(res.semanticConcepts).toContain('QUALITY_ACCREDITATION');
    expect(res.contextDependency.isFollowUp).toBe(true);
  });

  test('Real Model Query E: Multi-entity comparison question', async () => {
    const res = await parseSemanticInterpretation({
      rawQuery: 'antara sistem informasi sama teknologi informasi bedanya apa?'
    }, smokeOpts);
    expect(res.metadata.fallbackInvoked).toBe(false);
    expect(res.speechAct).toBe('COMPARE');
    expect(res.candidateEntities.length).toBeGreaterThanOrEqual(2);
  });

});
