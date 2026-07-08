function buildWelcomeMessageWithIntro(welcomeValue) {
  return (welcomeValue === null || welcomeValue === undefined) ? '' : String(welcomeValue);
}

const { assertValidComposePayload } = require('./composerContract');

async function shouldSkipWelcome({
  composePayload,
  earlyProgramHint,
  detectIntent,
  isRagEnabled,
  ragQueryWithEval,
  INTENT_CONF_THRESHOLD,
  RAG_MIN_SCORE_LOCAL,
  logger,
  // Optional guard: only run quick RAG probe when `existingChat` is explicitly true.
  existingChat
}) {
  try {
    if (process.env.NODE_ENV !== 'production') {
      assertValidComposePayload(composePayload || {});
    }
    const text = String((composePayload && composePayload.userQuery) || '').trim();
    const ic = composePayload && composePayload.intent && typeof composePayload.intent.confidence === 'number'
      ? composePayload.intent.confidence
      : (typeof detectIntent === 'function' ? 0 : 0);

    if (ic >= INTENT_CONF_THRESHOLD) return { skip: true, reason: 'intent_confidence', intentConf: ic };
    if (earlyProgramHint) return { skip: true, reason: 'program_hint', program: earlyProgramHint };

    // Only perform the quick RAG probe when we deterministically know this is an existing chat.
    // Backward-compatible behaviour: if caller omitted `existingChat`, fall back to previous behaviour
    // by inspecting composePayload.session.chatId. But prefer explicit `existingChat === true`.
    const shouldProbe = (existingChat === true) || (existingChat === undefined && composePayload && composePayload.session && composePayload.session.chatId);
    if (shouldProbe && typeof ragQueryWithEval === 'function' && isRagEnabled()) {
      try {
        const q = String(text || '').trim();
        if (q) {
          const probe = await ragQueryWithEval(composePayload && composePayload.session && composePayload.session.chatId ? composePayload.session.chatId : null, q, 3, { answerQuestion: q, strict: false, includeGlobal: true });
          let quickScore = 0;
          if (probe) {
            if (typeof probe.score === 'number') quickScore = Math.max(0, Math.min(1, probe.score));
            else if (probe.debug && typeof probe.debug.topScore === 'number') quickScore = Math.max(0, Math.min(1, probe.debug.topScore));
            else if (probe.success && probe.answer) quickScore = 0.7;
          }
          if (quickScore >= RAG_MIN_SCORE_LOCAL) return { skip: true, reason: 'rag_confidence', ragScore: quickScore };
        }
      } catch (e) {
        logger.info({ err: e && e.message ? e.message : String(e) }, '[Provider] quick RAG probe failed');
      }
    }
  } catch (e) {
    // ignore
  }
  return { skip: false };
}

module.exports = { buildWelcomeMessageWithIntro, shouldSkipWelcome };