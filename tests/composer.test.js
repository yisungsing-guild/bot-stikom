const composer = require('../src/engine/composer');

test('compose simple TI brp with retrieval', async () => {
  const input = {
    userQuery: 'TI brp',
    normalized: 'berapa biaya teknologi informasi',
    intent: { label: 'biaya', confidence: 0.85 },
    retrievals: [
      { excerpt: 'Total biaya awal untuk Teknologi Informasi adalah Rp 14.500.000 termasuk pendaftaran Rp 500.000.', score: 0.82, source: 'dokumen-biaya' }
    ],
    session: {}
  };

  const res = await composer.composeResponse(input);
  expect(res).toBeDefined();
  expect(res.strategy).toBeDefined();
  expect(Array.isArray(res.strategy)).toBe(true);
  expect(typeof res.reasoning).toBe('string');
  expect(typeof res.confidence).toBe('number');
  expect(res.recommendedProgram).toBe('Teknologi Informasi');
  expect(res.followUpQuestion).toBeDefined();
  // reflection should be present as a segment (program name), humanizer composes the natural lead
  expect(res.segments.reflection).toBe('Teknologi Informasi');
  expect(res.finalText).toMatch(/Rp 14.500.000/);
  expect(res.segments.followUp).toBeDefined();
});

test('compose clarifying when ambiguous', async () => {
  const input = {
    userQuery: 'biaya',
    normalized: 'biaya',
    intent: { label: null, confidence: 0.2 },
    retrievals: [],
    session: {}
  };
  const res = await composer.composeResponse(input);
  expect(res.meta.reason).toBe('clarify');
  expect(res.strategy).toEqual(['clarify']);
  expect(res.followUpQuestion).toMatch(/Tolong tuliskan pertanyaan yang lebih spesifik/i);
  // Clarification text should prompt for specificity
  expect(res.finalText).toMatch(/Tolong tuliskan pertanyaan yang lebih spesifik/i);
});

test('should not reflect when direct high confidence', async () => {
  const input = {
    userQuery: 'TI brp',
    normalized: 'berapa biaya teknologi informasi',
    intent: { label: 'biaya', confidence: 0.99 },
    retrievals: [ { excerpt: 'Total biaya Rp 10.000.000', score: 0.9, source: 'dok' } ],
    session: {}
  };
  const res = await composer.composeResponse(input);
  // when direct threshold very high, reflection should be absent
  expect(res.segments.reflection === null || res.segments.reflection === undefined).toBe(true);
});

test('compose passes adaptive context to conversational frame generator', async () => {
  const frameGenerator = jest.fn(async ctx => {
    expect(ctx.userWording).toMatch(/kalau semester awal susah/i);
    expect(ctx.conversationalHistory.currentUser).toBe('kalau semester awal susah?');
    expect(ctx.conversationalHistory.previousUser).toBe('Saya mau tanya soal TI');
    expect(ctx.responseIntent.label).toBe('difficulty');
    expect(ctx.emotionalDirection).toBe('concerned');
    expect(ctx.followUpDependency.programHint).toBe('Teknologi Informasi');
    expect(ctx.knowledgeContext.answerPreview).toMatch(/Semester awal biasanya padat/i);
    return 'Tenang, aku tangkap ini masih nyambung ke konteks yang sama.';
  });

  const input = {
    userQuery: 'kalau semester awal susah?',
    normalized: 'kalau semester awal susah?',
    intent: { label: 'difficulty', confidence: 0.78 },
    retrievals: [
      { excerpt: 'Semester awal biasanya padat dengan dasar pemrograman dan logika.', score: 0.81, source: 'dokumen-kurikulum' }
    ],
    session: {
      programHint: 'Teknologi Informasi',
      messages: [
        { direction: 'user', message: 'Saya mau tanya soal TI' },
        { direction: 'bot', message: 'Silakan, mau tanya apa?' },
        { direction: 'user', message: 'kalau semester awal susah?' }
      ]
    },
    frameGenerator
  };

  const res = await composer.composeResponse(input);
  expect(frameGenerator).toHaveBeenCalledTimes(1);
  expect(res.finalText).toMatch(/Tenang, aku tangkap ini masih nyambung ke konteks yang sama/i);
}, 10000);

test('compose current-state schedule query with grounding only and no financial bleed', async () => {
  const frameGenerator = jest.fn(async () => null);
  const input = {
    userQuery: 'jadwal PMB skrg?',
    normalized: 'jadwal PMB sekarang?',
    intent: { label: 'schedule', confidence: 0.72 },
    retrievals: [
      { excerpt: 'Biaya pendaftaran adalah Rp 500.000 untuk semua program.', score: 0.85, source: 'dokumen-biaya', metadata: { category: 'financial' } },
      { excerpt: 'Gelombang 2 buka sampai 30 Juni dan saat ini masih aktif.', score: 0.78, source: 'dokumen-jadwal', metadata: { category: 'schedule' } }
    ],
    session: {},
    frameGenerator
  };

  const res = await composer.composeResponse(input);
  expect(frameGenerator).toHaveBeenCalledTimes(1);
  expect(res.finalText).toMatch(/Gelombang 2 buka sampai 30 Juni/i);
  expect(res.finalText).not.toMatch(/Biaya pendaftaran/i);
  expect(res.meta.dominantIntent).toBe('schedule');
});

test('infers short_direct conversation style for minimal query', () => {
  const style = composer.inferConversationStyle('si belajar apa');
  expect(style.style).toBe('short_direct');
  expect(style.wordCount).toBeLessThanOrEqual(5);
});

test('infers exploratory style for detailed curriculum question', () => {
  const style = composer.inferConversationStyle('lulusan TI kerja dimana dan prospeknya seperti apa?');
  expect(style.style).toBe('exploratory');
});

test('infers current_state style for time-sensitive queries', () => {
  const style = composer.inferConversationStyle('gelombang apa sekarang?');
  expect(style.style).toBe('current_state');
});

test('infers transactional style for cost-related queries', () => {
  const style = composer.inferConversationStyle('berapa biaya SI gelombang 1A?');
  expect(style.style).toBe('transactional');
});

test('builds adaptive response style with no opener for short_direct', () => {
  const style = composer.buildAdaptiveResponseStyle(
    { label: 'curriculum' },
    'short_direct',
    {}
  );
  expect(style.hasOpener).toBe(false);
  expect(style.verbosity).toBe('concise');
  expect(style.tone).toBe('direct');
});

test('builds adaptive response style with detailed for exploratory', () => {
  const style = composer.buildAdaptiveResponseStyle(
    { label: 'career' },
    'exploratory',
    {}
  );
  expect(style.hasOpener).toBe(true);
  expect(style.verbosity).toBe('detailed');
  expect(style.tone).toBe('helpful');
  expect(style.includeExamples).toBe(true);
});

test('builds dynamic opener based on intent', () => {
  const opener = composer.buildDynamicOpener(
    { label: 'curriculum' },
    'exploratory',
    [],
    'belajar apa di SI?'
  );
  expect(opener).toBeTruthy();
  expect(/Di jurusan|Kurikulum|belajar/.test(opener)).toBe(true);
});

test('build intent-aware follow-up that matches intent', () => {
  const followUp = composer.buildIntentAwareFollowup(
    { label: 'curriculum' },
    'exploratory',
    {}
  );
  expect(followUp).toBeTruthy();
  expect(/perbedaan|jelaskan|program|TI|SI|kurikulum/.test(followUp)).toBe(true);
});

test('returns null follow-up for short_direct style', () => {
  const followUp = composer.buildIntentAwareFollowup(
    { label: 'curriculum' },
    'short_direct',
    {}
  );
  expect(followUp).toBeNull();
});

test('compose attaches adaptive style to response', async () => {
  const input = {
    userQuery: 'belajar apa di SI?',
    normalized: 'belajar apa di Sistem Informasi?',
    intent: { label: 'curriculum', confidence: 0.88 },
    retrievals: [
      { excerpt: 'SI mempelajari analisis bisnis, basis data, dan aplikasi.', score: 0.92, source: 'dokumen-kurikulum' }
    ],
    session: {}
  };

  const res = await composer.composeResponse(input);
  expect(res.adaptiveStyle).toBeDefined();
  expect(res.conversationStyle).toBeDefined();
  expect(res.adaptiveStyle.tone).toBeTruthy();
  expect(res.adaptiveStyle.verbosity).toBeTruthy();
}, 10000);
