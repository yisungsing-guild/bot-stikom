const { createOutbound } = require('../src/routes/outbound');
const { SOURCE_TYPES } = require('../src/routes/telemetryConstants');
const sessionStore = new Map();
const prisma = {
  session: {
    findUnique: async ({ where }) => sessionStore.get(where.chatId) || null,
    upsert: async ({ where, create, update }) => {
      const chatId = where.chatId;
      const existing = sessionStore.get(chatId) || { chatId, state: 'root', data: {} };
      const next = { ...existing };
      if (update && Object.prototype.hasOwnProperty.call(update, 'state')) next.state = update.state;
      if (update && Object.prototype.hasOwnProperty.call(update, 'data')) next.data = update.data;
      if (!next.chatId) next.chatId = chatId;
      sessionStore.set(chatId, next);
      return next;
    }
  }
};
const sendRaw = async (chatId, text, meta) => {
  console.log('sendRaw', chatId, text, JSON.stringify(meta));
  return true;
};
const outbound = createOutbound({
  chatId: 'user-intro-telemetry',
  getText: () => 'Halo',
  getSessionData: () => ({}),
  getSession: () => null,
  setSessionData: () => {},
  composeResponse: async () => ({ finalText: 'INTRO_TIKO', segments: {} }),
  humanizeFinalAnswer: (t) => t,
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
(async () => {
  await outbound.reply({
    chatId: 'user-intro-telemetry',
    messageText: 'INTRO_TIKO',
    source: 'intro',
    sourceType: SOURCE_TYPES.UNKNOWN,
    answerMeta: { actionable: false, action: 'intro' },
    welcomeSuppressed: true,
    responseMode: 'deterministic'
  });
  console.log('session', JSON.stringify(Array.from(sessionStore.entries()), null, 2));
})();
