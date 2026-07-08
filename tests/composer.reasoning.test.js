const composer = require('../src/engine/composer');

describe('Composer reasoning bundle', () => {
  test('buildReasoningContext includes sessionSignals and ragMeta when provided', () => {
    const session = {
      contextReused: true,
      programHint: 'Sistem Informasi',
      pendingSemanticSuggestion: { intent: 'ask_curriculum', program: 'Sistem Informasi', confidence: 0.8 },
      pendingProgramSelection: { intent: 'curriculum', question: 'Sebutkan program' },
      recentEntityContext: { entity: 'Sistem Informasi' }
    };

    const retrievals = [{ excerpt: 'Contoh kurikulum ...', source: 'doc1', score: 0.88 }];
    const ragMeta = { attachedImageMarker: '[[image:https://example.com/img.jpg]]', structuredFee: null };

    const rc = composer.buildReasoningContext({ userQuery: 'Apa yang dipelajari di prodi SI?', normalized: 'apa yang dipelajari di prodi si', intent: { label: 'ask_curriculum', confidence: 0.8 }, session, retrievals, answer: '', answerMeta: {}, tone: null, ragMeta });

    expect(rc).toBeDefined();
    expect(rc.sessionSignals).toBeDefined();
    expect(rc.sessionSignals.pendingSemanticSuggestion).toEqual(session.pendingSemanticSuggestion);
    expect(rc.sessionSignals.pendingProgramSelection).toEqual(session.pendingProgramSelection);
    expect(rc.ragMeta).toEqual(ragMeta);
  });

  test('composeResponse uses frameGenerator and returns meta.strategy', async () => {
    const frameGenerator = async (reasoningContext) => {
      // simple deterministic generator for test
      if (reasoningContext && reasoningContext.sessionSignals && reasoningContext.sessionSignals.pendingSemanticSuggestion) {
        return 'Terima kasih, ini ringkasannya...';
      }
      return 'Jawaban umum.';
    };

    const compose = await composer.composeResponse({
      userQuery: 'Apa prospek kerja SI?',
      normalized: 'apa prospek kerja si',
      intent: { label: 'ask_career', confidence: 0.7 },
      retrievals: [{ excerpt: 'Prospek: developer', source: 'doc1', score: 0.7 }],
      session: { pendingSemanticSuggestion: { intent: 'ask_career', program: 'Sistem Informasi' } },
      answerMeta: {},
      ragMeta: { attachedImageMarker: null },
      frameGenerator
    });

    expect(compose).toBeDefined();
    expect(typeof compose.finalText).toBe('string');
    expect(compose.meta).toBeDefined();
    expect(compose.meta.strategy).toBeDefined();
    expect(Array.isArray(compose.strategy)).toBe(true);
    expect(typeof compose.reasoning).toBe('string');
    expect(typeof compose.confidence).toBe('number');
    expect(typeof compose.followUpQuestion).toBe('string');
    expect(compose.recommendedProgram).toBe('Sistem Informasi');
  });
});
