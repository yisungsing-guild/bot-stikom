const { createComposerPipeline } = require('../src/routes/composerPipeline');
const { createOutbound } = require('../src/routes/outbound');

describe('composerPipeline deterministic vs conversational', () => {
  test('deterministic mode bypasses composer and sends literal text', async () => {
    const chatId = 'test-chat';
    const sent = [];
    const prisma = { session: { upsert: jest.fn().mockResolvedValue(true) } };
    const sendBotMessageOriginal = jest.fn().mockImplementation((c, text, meta) => {
      sent.push({ c, text, meta });
      return Promise.resolve(true);
    });
    const humanizeFinalAnswer = jest.fn().mockImplementation((t) => `HUMANIZED: ${t}`);
    const composeResponse = jest.fn().mockResolvedValue({ finalText: 'AI' });

    const pipeline = createComposerPipeline({
      chatId,
      getText: () => 'hello',
      getSessionData: () => ({}),
      getSession: () => ({}),
      setSessionData: () => {},
      composeResponse,
      humanizeFinalAnswer,
      logger: console,
      prisma,
      sendBotMessageOriginal,
      detectIntent: () => 'GENERAL',
      intentConfidence: () => 0,
      mapRagContextsForComposer: () => [],
      getNormalizedObj: () => null,
      getComposerTone: () => ({}),
      clearReplyDeadline: () => {},
      getTimeoutSendPromise: () => null,
      state: {}
    });

    const { sendComposedReply } = pipeline;

    await sendComposedReply({ source: 'test', ruleReply: { text: 'LITERAL' }, responseMode: 'deterministic' });

    expect(sendBotMessageOriginal).toHaveBeenCalled();
    expect(humanizeFinalAnswer).not.toHaveBeenCalled();
    expect(sent[0].text).toBe('LITERAL');
  });

  test('conversational mode runs humanizer and composer', async () => {
    const chatId = 'test-chat-2';
    const sent = [];
    const prisma = { session: { upsert: jest.fn().mockResolvedValue(true) } };
    const sendBotMessageOriginal = jest.fn().mockImplementation((c, text, meta) => {
      sent.push({ c, text, meta });
      return Promise.resolve(true);
    });
    const humanizeFinalAnswer = jest.fn().mockImplementation((t) => `HUMANIZED: ${t}`);
    const composeResponse = jest.fn().mockResolvedValue({ finalText: 'ai-composed', segments: {} });

    const pipeline = createComposerPipeline({
      chatId,
      getText: () => 'hello',
      getSessionData: () => ({}),
      getSession: () => ({}),
      setSessionData: () => {},
      composeResponse,
      humanizeFinalAnswer,
      logger: console,
      prisma,
      sendBotMessageOriginal,
      detectIntent: () => 'GENERAL',
      intentConfidence: () => 0,
      mapRagContextsForComposer: () => [],
      getNormalizedObj: () => null,
      getComposerTone: () => ({}),
      clearReplyDeadline: () => {},
      getTimeoutSendPromise: () => null,
      state: {}
    });

    const { sendComposedReply } = pipeline;
    await sendComposedReply({ source: 'test', ruleReply: { text: 'please humanize' }, responseMode: 'conversational' });

    expect(composeResponse).toHaveBeenCalled();
    expect(humanizeFinalAnswer).toHaveBeenCalled();
    expect(sendBotMessageOriginal).toHaveBeenCalled();
    expect(sent[0].text).toContain('HUMANIZED:');
  });

  test('deterministic numbered menu preserves exact formatting and bypasses humanizer', async () => {
    const chatId = 'test-chat-3';
    const sent = [];
    const prisma = { session: { upsert: jest.fn().mockResolvedValue(true) } };
    const sendBotMessageOriginal = jest.fn().mockImplementation((c, text, meta) => {
      sent.push({ c, text, meta });
      return Promise.resolve(true);
    });
    const humanizeFinalAnswer = jest.fn().mockImplementation((t) => `HUMANIZED: ${t}`);
    const composeResponse = jest.fn().mockResolvedValue({ finalText: 'ai-composed', segments: {} });

    const pipeline = createComposerPipeline({
      chatId,
      getText: () => 'menu',
      getSessionData: () => ({}),
      getSession: () => ({}),
      setSessionData: () => {},
      composeResponse,
      humanizeFinalAnswer,
      logger: console,
      prisma,
      sendBotMessageOriginal,
      detectIntent: () => 'GENERAL',
      intentConfidence: () => 0,
      mapRagContextsForComposer: () => [],
      getNormalizedObj: () => null,
      getComposerTone: () => ({}),
      clearReplyDeadline: () => {},
      getTimeoutSendPromise: () => null,
      state: {}
    });

    const { sendComposedReply } = pipeline;
    const literalMenu = 'Pilih menu berikut:\n1) Biaya\n2) Jadwal\nBalas angka 1 atau 2.';

    await sendComposedReply({ source: 'test', ruleReply: { text: literalMenu }, responseMode: 'deterministic' });

    expect(composeResponse).not.toHaveBeenCalled();
    expect(humanizeFinalAnswer).not.toHaveBeenCalled();
    expect(sendBotMessageOriginal).toHaveBeenCalled();
    expect(sent[0].text).toBe(literalMenu);
  });

  test('deterministic fee breakdown response is sent literally without humanizer', async () => {
    const chatId = 'test-chat-4';
    const sent = [];
    const prisma = { session: { upsert: jest.fn().mockResolvedValue(true) } };
    const sendBotMessageOriginal = jest.fn().mockImplementation((c, text, meta) => {
      sent.push({ c, text, meta });
      return Promise.resolve(true);
    });
    const humanizeFinalAnswer = jest.fn().mockImplementation((t) => `HUMANIZED: ${t}`);
    const composeResponse = jest.fn().mockResolvedValue({ finalText: 'ai-composed', segments: {} });

    const pipeline = createComposerPipeline({
      chatId,
      getText: () => 'biaya',
      getSessionData: () => ({}),
      getSession: () => ({}),
      setSessionData: () => {},
      composeResponse,
      humanizeFinalAnswer,
      logger: console,
      prisma,
      sendBotMessageOriginal,
      detectIntent: () => 'GENERAL',
      intentConfidence: () => 0,
      mapRagContextsForComposer: () => [],
      getNormalizedObj: () => null,
      getComposerTone: () => ({}),
      clearReplyDeadline: () => {},
      getTimeoutSendPromise: () => null,
      state: {}
    });

    const { sendComposedReply } = pipeline;
    const feeBreakdown = 'Rincian biaya:\n- Pendaftaran: Rp 500.000\n- DPP: Rp 14.000.000\n- Jas: Rp 750.000\n- Kaos: Rp 750.000';

    await sendComposedReply({ source: 'test', ruleReply: { text: feeBreakdown }, responseMode: 'deterministic' });

    expect(composeResponse).not.toHaveBeenCalled();
    expect(humanizeFinalAnswer).not.toHaveBeenCalled();
    expect(sendBotMessageOriginal).toHaveBeenCalled();
    expect(sent[0].text).toBe(feeBreakdown);
  });

  test('outbound.reply forwards deterministic responseMode and circumvents composer', async () => {
    const chatId = 'test-chat-5';
    const sent = [];
    const sendRaw = jest.fn().mockImplementation((c, text, meta) => {
      sent.push({ c, text, meta });
      return Promise.resolve(true);
    });
    const prisma = { session: { upsert: jest.fn().mockResolvedValue(true) } };
    const outbound = createOutbound({
      chatId,
      getText: () => 'apakah biaya',
      getSessionData: () => ({}),
      getSession: () => ({}),
      setSessionData: () => {},
      composeResponse: jest.fn().mockResolvedValue({ finalText: 'ai', segments: {} }),
      humanizeFinalAnswer: jest.fn().mockImplementation((t) => `HUMANIZED: ${t}`),
      logger: console,
      prisma,
      sendRaw,
      detectIntent: () => 'GENERAL',
      intentConfidence: () => 0,
      mapRagContextsForComposer: () => [],
      getNormalizedObj: () => null,
      getComposerTone: () => ({}),
      clearReplyDeadline: () => {},
      getTimeoutSendPromise: () => null,
      state: {}
    });

    await outbound.reply({
      chatId,
      messageText: '1) Biaya\n2) Jadwal',
      responseMode: 'deterministic',
      source: 'test',
      sourceType: 'rule'
    });

    expect(sendRaw).toHaveBeenCalled();
    expect(sent[0].text).toBe('1) Biaya\n2) Jadwal');
  });
});
