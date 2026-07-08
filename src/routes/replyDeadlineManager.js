const { FALLBACK_REASONS } = require('./telemetryConstants');

function createReplyDeadlineManager({
  chatId,
  logger,
  prisma,
  sendRaw,
  getLastBotMessageFromSessionData,
  timeoutFallbackMessage,
  replyTimeoutMs,
  replyTimeoutIsHard
}) {
  let replyDeadlineTimer = null;
  let timeoutSendPromise = null;
  const state = {
    outboundSent: false,
    outboundStarted: false,
    timeoutFired: false,
    replyAlreadySent: false,
    composerCompleted: false,
    timeoutTriggered: false,
    duplicateSendPrevented: false
  };

  const clearReplyDeadline = () => {
    if (replyDeadlineTimer) {
      clearTimeout(replyDeadlineTimer);
      replyDeadlineTimer = null;
    }
  };

  const getTimeoutSendPromise = () => timeoutSendPromise;

  const noteOutboundStarted = async () => {
    if (replyTimeoutIsHard && state.timeoutFired) {
      state.duplicateSendPrevented = true;
      return false;
    }
    if (state.replyAlreadySent || state.composerCompleted) {
      state.duplicateSendPrevented = true;
      return false;
    }
    state.outboundStarted = true;
    clearReplyDeadline();
    if (timeoutSendPromise) {
      try {
        await timeoutSendPromise;
      } catch (e) {
        // ignore; still continue with the real reply
      }
    }
    return true;
  };

  const noteReplySent = () => {
    if (!state.outboundSent) {
      state.outboundSent = true;
      clearReplyDeadline();
    }
    state.replyAlreadySent = true;
  };

  const startReplyDeadline = () => {
    if (replyDeadlineTimer || state.outboundSent || state.timeoutFired || state.replyAlreadySent || state.composerCompleted) return;
    const fireTimeoutAfterMs = Math.max(250, replyTimeoutMs);
    replyDeadlineTimer = setTimeout(async () => {
      replyDeadlineTimer = null;
      if (state.outboundStarted || state.outboundSent || state.timeoutFired || state.replyAlreadySent || state.composerCompleted) return;

      try {
        let lastBot = null;
        try {
          const latestSession = await prisma.session.findUnique({ where: { chatId } });
          const latestData = (latestSession && latestSession.data) ? latestSession.data : {};
          lastBot = typeof getLastBotMessageFromSessionData === 'function'
            ? getLastBotMessageFromSessionData(latestData)
            : null;
        } catch (e) {
          // ignore session lookup failures
        }

        const normLastBot = String(lastBot || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const normFallback = String(timeoutFallbackMessage || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (normLastBot && normFallback && normLastBot === normFallback) {
          state.timeoutFired = true;
          state.timeoutTriggered = true;
          return;
        }

        state.timeoutFired = true;
        state.timeoutTriggered = true;
        state.outboundSent = true;
        timeoutSendPromise = sendRaw(chatId, timeoutFallbackMessage, {
          source: FALLBACK_REASONS.TIMEOUT,
          sentViaComposer: false,
          directReason: 'timeout'
        });
        await timeoutSendPromise;
      } catch (e) {
        logger.error({ err: e && e.message ? e.message : String(e) }, '[ReplyDeadlineManager] Timeout fallback failed');
      }
    }, fireTimeoutAfterMs);
  };

  return {
    state,
    clearReplyDeadline,
    startReplyDeadline,
    getTimeoutSendPromise,
    noteOutboundStarted,
    noteReplySent
  };
}

module.exports = { createReplyDeadlineManager };
