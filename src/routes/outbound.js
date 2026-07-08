const { createComposerPipeline } = require('./composerPipeline');
const { SOURCE_TYPES, PIPELINE_TYPES } = require('./telemetryConstants');
const { safeSessionUpsert } = require('../utils/sessionUpsert');
const { classifyResponseRoute, shouldBypassComposer, isConversationalFlow } = require('./routingPolicy');

function createOutbound({
  chatId,
  getText,
  getSessionData,
  getSession,
  setSessionData,
  composeResponse,
  humanizeFinalAnswer,
  logger,
  prisma,
  sendRaw,
  detectIntent,
  intentConfidence,
  mapRagContextsForComposer,
  getNormalizedObj,
  getComposerTone,
  clearReplyDeadline,
  getTimeoutSendPromise,
  state
}) {
  const { sendComposedReply } = createComposerPipeline({
    chatId,
    getText,
    getSessionData,
    getSession,
    setSessionData,
    composeResponse,
    humanizeFinalAnswer,
    logger,
    prisma,
    sendBotMessageOriginal: sendRaw,
    detectIntent,
    intentConfidence,
    mapRagContextsForComposer,
    getNormalizedObj,
    getComposerTone,
    clearReplyDeadline,
    getTimeoutSendPromise,
    state
  });

  async function reply({
    chatId: targetChatId,
    messageText,
    source = 'legacy',
    sourceType = SOURCE_TYPES.UNKNOWN,
    answerMeta = {},
    ruleReply = null,
    ragResult = null,
    welcomeSuppressed = false,
    clarificationUsed = false,
    skipComposer = false,
    skipDecoration = false,
    directSend = false,
    directReason = null,
    numericIntentSource = null,
    pendingStateMatched = false,
    menuOverrideDecision = null,
    // New: responseMode can be 'conversational' (default) or 'deterministic'
    responseMode = 'conversational',
    routePolicy = null
  } = {}) {
    const toChatId = targetChatId || chatId;
    const sessionData = (typeof getSessionData === 'function') ? getSessionData() : {};
    const pendingStates = {
      pendingFollowupChoice: sessionData && sessionData.pendingFollowupChoice ? sessionData.pendingFollowupChoice : null,
      pendingFeeBreakdownOffer: sessionData && sessionData.pendingFeeBreakdownOffer ? sessionData.pendingFeeBreakdownOffer : null,
      pendingFeeDetail: sessionData && sessionData.pendingFeeDetail ? sessionData.pendingFeeDetail : null,
      pendingTotalCost: sessionData && sessionData.pendingTotalCost ? sessionData.pendingTotalCost : null,
      pendingScheduleWave: sessionData && sessionData.pendingScheduleWave ? sessionData.pendingScheduleWave : null,
      pendingWaveClarification: sessionData && sessionData.pendingWaveClarification ? sessionData.pendingWaveClarification : null
    };

    async function persistIntroComposerTelemetry({ toChatId, source, sourceType, welcomeSuppressed, clarificationUsed }) {
      if (String(source || '').toLowerCase() !== 'intro') return;
      try {
        const currentSession = (typeof getSession === 'function') ? getSession() : null;
        const currentState = (currentSession && currentSession.state) ? currentSession.state : 'root';
        const prevData = (typeof getSessionData === 'function') ? getSessionData() : {};
        const nowIso = new Date().toISOString();
        const newData = {
          ...prevData,
          composerLastSource: source || prevData.composerLastSource || null,
          composerUsedAt: nowIso,
          composerSentVia: 'composer',
          composerTelemetry: {
            source: source || null,
            sentViaComposer: true,
            legacyPathUsed: false,
            bypassDetected: true,
            sourceType: sourceType || null,
            finalPipeline: 'composer->humanizer',
            timeoutTriggered: !!state.timeoutTriggered,
            duplicateSendPrevented: !!state.duplicateSendPrevented,
            contextReused: !!(state.contextReused || (prevData && prevData.composerTelemetry && prevData.composerTelemetry.contextReused)),
            reflectionUsed: false,
            followupUsed: false,
            clarificationUsed: !!clarificationUsed,
            welcomeSuppressed: !!welcomeSuppressed,
            ts: nowIso
          }
        };
        if (typeof setSessionData === 'function') setSessionData(newData);
        await safeSessionUpsert(prisma, { where: { chatId: toChatId }, create: { chatId: toChatId, state: currentState, data: newData }, update: { state: currentState, data: newData } });
      } catch (err) {
        logger && logger.warn && logger.warn({ err: err && err.message ? err.message : String(err) }, '[Outbound] Failed to persist intro composer telemetry');
      }
    }
    // Temporary debug logging for tracing deterministic vs composer flows
    // Enable debug automatically in test environment to aid Jest diagnostics.
    const outboundDebug = (process.env.NODE_ENV === 'test') || String(process.env.OUTBOUND_DEBUG || '').toLowerCase() === 'true';
    const effectiveRoute = routePolicy || classifyResponseRoute({
      source,
      sourceType,
      responseMode,
      directReason,
      messageText,
      ruleReply,
      ragResult,
      skipComposer,
      directSend,
      pendingStateMatched,
      menuOverrideDecision,
      numericIntentSource
    });
    const bypassComposer = shouldBypassComposer(effectiveRoute);
    const isDeterministic = String(effectiveRoute.responseMode || responseMode || '').toLowerCase() === 'deterministic';
    try {
      if (outboundDebug) {
          logger && logger.info && logger.info({
            chatId: toChatId,
            source,
            sourceType,
            responseMode,
            skipComposer,
            numericIntentSource,
            pendingStateMatched,
            menuOverrideDecision,
            replyAlreadySent: state && !!state.replyAlreadySent,
            ragSource: ragResult && ragResult.source ? ragResult.source : null,
            pendingStates,
            routeType: effectiveRoute.routeType,
            bypassComposer: effectiveRoute.bypassComposer,
            triggerReason: effectiveRoute.triggerReason,
            conversational: effectiveRoute.conversational
          }, '[Outbound DEBUG] reply called');
          // eslint-disable-next-line no-console
          console.info(`[OUTBOUND DEBUG] chat=${toChatId} source=${source} responseMode=${responseMode} skipComposer=${skipComposer} numericIntentSource=${numericIntentSource || 'none'} pendingStateMatched=${pendingStateMatched} menuOverrideDecision=${menuOverrideDecision || 'none'} replyAlreadySent=${state && !!state.replyAlreadySent} ragSource=${ragResult && ragResult.source ? ragResult.source : 'none'}`);
        }
    } catch (e) {}
    const effectiveRuleReply = ruleReply || (messageText ? { text: String(messageText) } : null);

    if (bypassComposer) {
      const devWarnEnabled = String(process.env.OUTBOUND_DEV_WARNINGS || '').toLowerCase() === 'true';
      if (devWarnEnabled) {
        const resolvedReason = directReason || (skipComposer ? 'skipComposer' : (isDeterministic ? 'deterministic' : (directSend ? 'directSend' : 'skipDecoration')));
        try {
          logger && logger.warn && logger.warn({
            chatId: toChatId,
            source,
            sourceType,
            directReason: resolvedReason,
            sentViaComposer: false
          }, '[Outbound] Direct outbound bypassed composer');
        } catch (e) {}

        try {
          // eslint-disable-next-line no-console
          console.warn(`[DEV WARNING] Outbound direct send used for chatId=${toChatId} source=${source} reason=${resolvedReason}`);
        } catch (e) {}
      }
      const outboundText = String(messageText || (effectiveRuleReply && effectiveRuleReply.text) || (ragResult && ragResult.answer) || '');
      const meta = {
        sentViaComposer: source === 'intro',
        source,
        sourceType,
        responseMode: responseMode,
        finalPipeline: source === 'intro' ? 'composer->humanizer' : null,
        directReason: directReason || effectiveRoute.triggerReason || (skipComposer ? 'skipComposer' : (responseMode === 'deterministic' ? 'deterministic' : 'directSend')),
        numericIntentSource,
        pendingStateMatched,
        menuOverrideDecision,
        routeType: effectiveRoute.routeType,
        bypassComposer: effectiveRoute.bypassComposer,
        triggerReason: effectiveRoute.triggerReason,
        conversational: effectiveRoute.conversational
      };
      if (outboundDebug) {
        try {
          logger && logger.info && logger.info({ chatId: toChatId, outboundText: outboundText.slice(0, 200), meta }, '[Outbound DEBUG] direct send');
        } catch (e) {}
      }
      if (String(source || '').toLowerCase() === 'intro') {
        await persistIntroComposerTelemetry({
          toChatId,
          source,
          sourceType,
          welcomeSuppressed,
          clarificationUsed
        });
      }
      try {
        const currentSession = (typeof getSession === 'function') ? getSession() : null;
        const currentState = (currentSession && currentSession.state) ? currentSession.state : 'root';
        const prevData = (typeof getSessionData === 'function') ? getSessionData() : {};
        const nextData = {
          ...prevData,
          routeTelemetry: {
            routeType: effectiveRoute.routeType,
            bypassComposer: effectiveRoute.bypassComposer,
            triggerReason: effectiveRoute.triggerReason,
            conversational: effectiveRoute.conversational,
            source,
            sourceType,
            responseMode,
            numericIntentSource,
            pendingStateMatched,
            menuOverrideDecision,
            ts: new Date().toISOString()
          }
        };
        if (typeof setSessionData === 'function') setSessionData(nextData);
        await safeSessionUpsert(prisma, { where: { chatId: toChatId }, create: { chatId: toChatId, state: currentState, data: nextData }, update: { state: currentState, data: nextData } });
      } catch (e) {}
      // Mark state to prevent composer from sending a duplicate composed reply later
      try {
        if (state) {
          state.replyAlreadySent = true;
          state.outboundSent = true;
        }
      } catch (e) {}
      // Forward `meta` to sendRaw so provider adapters (and tests) can receive
      // composer/outbound telemetry when available. If an adapter ignores the
      // third arg it remains backward-compatible.
      return sendRaw(toChatId, outboundText, meta);
    }

    // Compose + humanize path
    if (outboundDebug) {
      try {
        logger && logger.info && logger.info({ chatId: toChatId, source, sourceType, responseMode }, '[Outbound DEBUG] composing reply');
      } catch (e) {}
    }
    const composedResult = await sendComposedReply({
      source,
      sourceType,
      ruleReply: effectiveRuleReply,
      ragResult,
      answerMeta,
      welcomeSuppressed,
      clarificationUsed,
      responseMode,
      routePolicy: effectiveRoute
    });
    if (outboundDebug) {
      try {
        logger && logger.info && logger.info({ chatId: toChatId, composedResult }, '[Outbound DEBUG] composed send completed');
        // eslint-disable-next-line no-console
        console.info(`[OUTBOUND DEBUG] composed send for chat=${toChatId} source=${source}`);
      } catch (e) {}
    }
    return composedResult;
  }

  return { reply, state };
}

module.exports = { createOutbound };
