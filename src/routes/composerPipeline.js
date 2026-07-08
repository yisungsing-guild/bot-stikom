const {
  normalizeComposePayload,
  assertValidComposePayload,
  assertStandardTelemetry,
  warnOnMissingTelemetryFields
} = require('./composerContract');
const { SOURCE_TYPES, PIPELINE_TYPES, buildFinalPipeline } = require('./telemetryConstants');
const { safeSessionUpsert } = require('../utils/sessionUpsert');
const { sanitizeWhatsappText } = require('../utils/textSanitizer');
const { buildWhatsappConversationalReply, isProgramOverviewQuestion } = require('../utils/whatsappFormatter');
const { updateUserProfile } = require('../engine/userProfileManager');

function createComposerPipeline({
  chatId,
  getText,
  getSessionData,
  getSession,
  setSessionData,
  composeResponse,
  humanizeFinalAnswer,
  logger,
  prisma,
  sendBotMessageOriginal,
  detectIntent,
  intentConfidence,
  mapRagContextsForComposer,
  getNormalizedObj,
  getComposerTone,
  clearReplyDeadline,
  getTimeoutSendPromise,
  state
}) {
  const persistComposerSessionFlags = async ({ composeResult, source, sourceType, finalPipeline, welcomeSuppressed, clarificationUsed, bypass = false, routePolicy = null }) => {
    try {
      const currentSession = (getSession && typeof getSession === 'function') ? getSession() : null;
      const currentState = (currentSession && currentSession.state) ? currentSession.state : 'root';
      const prevData = getSessionData && typeof getSessionData === 'function' ? getSessionData() : {};
      const clearPendingHints = (data) => {
        const next = { ...(data || {}) };
        const pendingKeys = [
          'pendingRuleReply',
          'pendingSemanticSuggestion',
          'pendingRagCandidate',
          'pendingProgramSelection',
          'pendingFeeBreakdownOffer',
          'pendingClarification',
          'pendingRecommendation',
          'pendingFeeDetail',
          'pendingAdmissionApplicantType',
          'pendingFollowupChoice',
          'pendingMenuCost',
          'pendingScheduleWave',
          'pendingWaveClarification',
          'pendingScholarshipChoice'
        ];
        for (const key of pendingKeys) {
          if (Object.prototype.hasOwnProperty.call(next, key)) delete next[key];
        }
        return next;
      };
      const nowIso = new Date().toISOString();
      const newData = {
        ...clearPendingHints(prevData),
        composerLastSource: source || prevData.composerLastSource || null,
        composerUsedAt: nowIso,
        composerSentVia: bypass ? 'bypass' : 'composer',
        composerTelemetry: {
          source: source || null,
          sentViaComposer: bypass ? (source === 'intro') : true,
          legacyPathUsed: !!String(source || '').match(/^fee_fast_path|rule|rag/i),
          bypassDetected: bypass ? true : !!String(source || '').match(/^fee_fast_path|legacy|fast_path/i),
          sourceType: sourceType || null,
          finalPipeline: finalPipeline || null,
          timeoutTriggered: !!state.timeoutTriggered,
          duplicateSendPrevented: !!state.duplicateSendPrevented,
          contextReused: !!(state.contextReused || (prevData && prevData.composerTelemetry && prevData.composerTelemetry.contextReused)),
          reflectionUsed: !!(composeResult && composeResult.segments && composeResult.segments.reflection),
          followupUsed: !!(composeResult && composeResult.segments && composeResult.segments.followUp),
          clarificationUsed: !!clarificationUsed,
          welcomeSuppressed: !!welcomeSuppressed,
          routeType: routePolicy && routePolicy.routeType ? routePolicy.routeType : null,
          bypassComposer: routePolicy && typeof routePolicy.bypassComposer === 'boolean' ? routePolicy.bypassComposer : !!bypass,
          triggerReason: routePolicy && routePolicy.triggerReason ? routePolicy.triggerReason : null,
          ts: nowIso
        }
      };

      if (composeResult && composeResult.segments && composeResult.segments.reflection) {
        newData.lastReflectionAt = nowIso;
      }
      if (composeResult && composeResult.segments && composeResult.segments.followUp) {
        newData.lastFollowUpAt = nowIso;
      }
      if (clarificationUsed) {
        newData.lastClarificationAt = nowIso;
      }

      // persistComposerSessionFlags executed (debug logging removed)
      const upsertResult = await safeSessionUpsert(prisma, { where: { chatId }, create: { chatId, state: currentState, data: newData }, update: { state: currentState, data: newData } });
      if (setSessionData && typeof setSessionData === 'function') setSessionData(newData);
      if (process.env.NODE_ENV !== 'production') {
        try {
          assertStandardTelemetry(newData.composerTelemetry);
        } catch (err) {
          logger && logger.warn && logger.warn({ err: err.message, telemetry: newData.composerTelemetry }, '[ComposerContract] telemetry schema invalid');
        }
        warnOnMissingTelemetryFields(newData.composerTelemetry, logger);
      }
      return upsertResult;
    } catch (err) {
      logger.warn({ err: err && err.message ? err.message : String(err) }, '[Provider] Failed to persist composer session flags');
    }
  };

  const sendComposedReply = async ({ source = 'unknown', ruleReply = null, ragResult = null, answerMeta = {}, welcomeSuppressed = false, clarificationUsed = false, responseMode = 'conversational', sourceType = null, routePolicy = null } = {}) => {
    if (state.replyAlreadySent || state.composerCompleted) {
      state.duplicateSendPrevented = true;
      try {
        logger.info({ chatId, source, duplicateSendPrevented: true }, '[Provider] Duplicate composed reply prevented');
      } catch (e) {
        // ignore logging issues
      }
      return null;
    }

    state.outboundStarted = true;
    clearReplyDeadline();
    const timeoutSendPromise = getTimeoutSendPromise && typeof getTimeoutSendPromise === 'function' ? getTimeoutSendPromise() : null;
    if (timeoutSendPromise) {
      try {
        await timeoutSendPromise;
      } catch (e) {
        // ignore; we still attempt to send the real reply
      }
    }

    // Prefer any explicit composerInputText persisted by provider (deterministic inbound text)
    // Fall back to caller-provided getText() when not available.
    let text = '';
    try {
      const sessionDataTmp = (typeof getSessionData === 'function') ? getSessionData() : {};
      if (sessionDataTmp && sessionDataTmp.composerInputText) {
        text = String(sessionDataTmp.composerInputText || '').trim();
      } else {
        text = String(getText && typeof getText === 'function' ? getText() : '').trim();
      }
    } catch (e) {
      text = String(getText && typeof getText === 'function' ? getText() : '').trim();
    }
    const intentLabel = (typeof detectIntent === 'function') ? detectIntent(text) : 'GENERAL';
    const intentConf = (typeof intentConfidence === 'function') ? intentConfidence(text) : 0;
    const retrievals = mapRagContextsForComposer ? mapRagContextsForComposer(ragResult) : [];
    const sourceText = String((ruleReply && ruleReply.text) || (ragResult && ragResult.answer) || '').toLowerCase();
    const derivedAction = /\b(biaya|dpp|ukt|semester|gelombang|jadwal|beasiswa|kontak|alamat|lokasi|daftar|pendaftaran)\b/.test(sourceText)
      ? (/\b(kontak|alamat|lokasi)\b/.test(sourceText) ? 'contact' : (/\b(daftar|pendaftaran)\b/.test(sourceText) ? 'link' : 'details'))
      : null;
    const effectiveAnswerMeta = {
      actionable: /\b(biaya|dpp|ukt|semester|gelombang|jadwal|beasiswa|kontak|alamat|lokasi|daftar|pendaftaran)\b/.test(sourceText) || !!(answerMeta && answerMeta.actionable),
      action: (answerMeta && answerMeta.action) || derivedAction || 'details',
      ...(answerMeta && typeof answerMeta === 'object' ? answerMeta : {})
    };
    const sessionData = (typeof getSessionData === 'function') ? getSessionData() : {};
    const normalizedObj = (getNormalizedObj && typeof getNormalizedObj === 'function') ? getNormalizedObj() : null;
    const sessionForComposer = {
      ...(sessionData || {}),
      chatId,
      welcomeSent: !!(sessionData && (sessionData.welcomeSentAt || sessionData.welcomeSent)),
      contextReused: !!(state && state.contextReused),
      programHint:
        (normalizedObj && typeof normalizedObj === 'object' && normalizedObj.programHint ? String(normalizedObj.programHint).trim() : null) ||
        (sessionData && sessionData.lastProgramHint ? String(sessionData.lastProgramHint) : null) ||
        null
    };
    // Heuristic: if the inbound looks like a short follow-up and we have a programHint,
    // mark state.contextReused so composer telemetry persists this signal.
    try {
      const shortLen = parseInt(process.env.CONTEXT_FOLLOWUP_MAX_LEN || '80', 10);
      const isShort = String(text || '').trim().length <= (Number.isFinite(shortLen) ? shortLen : 80);
      const hasQ = /\?\s*$/.test(String(text || '')) || /\b(kapan|dimana|di\s+mana|berapa|gimana|bagaimana|apa)\b/i.test(String(text || ''));
      if (!state.contextReused && isShort && hasQ && sessionForComposer.programHint) {
        state.contextReused = true;
        try { console.info('[COMPOSER TRACE] marking state.contextReused by heuristic', { chatId, programHint: sessionForComposer.programHint }); } catch (e) {}
      }
    } catch (e) {}
    const effectiveSourceType = (typeof sourceType === 'string' && String(sourceType).trim())
      ? String(sourceType)
      : ((ragResult && ragResult.answer) ? SOURCE_TYPES.RAG : SOURCE_TYPES.RULE);
    const finalPipeline = buildFinalPipeline(effectiveSourceType, PIPELINE_TYPES.COMPOSER, PIPELINE_TYPES.HUMANIZER);

    function adjustRetrievalsForIntent(retrievalsList, detectedIntentLabel) {
      try {
        if (!Array.isArray(retrievalsList)) return [];
        const feeKeywords = ['biaya','dpp','ukt','pendaftaran','biaya pendaftaran','potongan','diskon','beasiswa'];
        const academicIntents = ['PROGRAM','PROGRAM_INFO','CURRICULUM','CAREER','SCHEDULE','ADMISSION','GENERAL'];
        // If detected intent looks academic, penalize fee/scholarship retrievals
        const penalize = academicIntents.includes(String(detectedIntentLabel || '').toUpperCase());
        const adjusted = retrievalsList.map(r => {
          const text = String((r && (r.excerpt || r.text || r.title || r.content)) || '').toLowerCase();
          let score = (r && typeof r.score === 'number') ? r.score : (r && r.similarity) ? r.similarity : 0;
          if (penalize) {
            for (const k of feeKeywords) {
              if (text.includes(k)) {
                score = score * 0.5; // penalize
                break;
              }
            }
          }
          return Object.assign({}, r, { score });
        });
        // sort by adjusted score desc
        adjusted.sort((a,b) => (b.score || 0) - (a.score || 0));
        return adjusted;
      } catch (e) { return retrievalsList || []; }
    }

    const adjustedRetrievals = adjustRetrievalsForIntent(retrievals, intentLabel);

    const composePayload = normalizeComposePayload({
      userQuery: text,
      normalized: text,
      intent: { label: intentLabel, confidence: intentConf },
      retrievals: adjustedRetrievals,
      ruleReply,
      session: sessionForComposer,
      answerMeta: effectiveAnswerMeta
    });

    // Logging for debugging intent & retrieval dominance
    try {
      const top = (Array.isArray(adjustedRetrievals) && adjustedRetrievals.length) ? adjustedRetrievals[0] : null;
      const dominantIntent = top && top.title ? (typeof detectIntent === 'function' ? detectIntent(String(top.title || top.excerpt || top.text || '')) : null) : null;
      console.info('[COMPOSER TRACE]', { query: text, detectedIntent: intentLabel, dominantIntent: dominantIntent || null, topRetrievalTopic: top && (top.title || top.excerpt || top.text) || null, topRetrievalScore: top && top.score || null });
    } catch (e) {}

    if (String(process.env.COMPOSER_DEBUG).toLowerCase() === 'true') {
      try {
        console.info('[COMPOSER DEBUG] text=%s contextReused=%s programHint=%s intent=%s retrievals=%s',
          text,
          !!sessionForComposer.contextReused,
          sessionForComposer.programHint,
          intentLabel,
          Array.isArray(retrievals) ? retrievals.length : retrievals
        );
      } catch (e) {}
    }

    if (process.env.NODE_ENV !== 'production') {
      assertValidComposePayload(composePayload);
    }

    // If caller requests a deterministic/system response, bypass composer/humanizer
    // and send literal text when deterministic mode is requested.
    if (responseMode === 'deterministic') {
      const finalText = String((ruleReply && ruleReply.text) || (ragResult && ragResult.answer) || '').trim();
      const bypassPipeline = source === 'intro' ? buildFinalPipeline(PIPELINE_TYPES.COMPOSER, PIPELINE_TYPES.HUMANIZER) : null;
      state.replyAlreadySent = true;
      state.composerCompleted = true;
      await persistComposerSessionFlags({ composeResult: null, source, sourceType: effectiveSourceType, finalPipeline: bypassPipeline, welcomeSuppressed, clarificationUsed, bypass: true, routePolicy });
      try {
        if (String(process.env.OUTBOUND_DEBUG || '').toLowerCase() === 'true') {
          try {
            logger.info({ chatId, source, sourceType, responseMode: 'deterministic', preview: String(finalText || '').slice(0,120) }, '[OutboundDebug] composer bypass deterministic send');
          } catch (e) {}
        }
        try {
          console.log('=== COMPOSER FINAL TEXT ===', String(finalText || ''));
          if (isProgramOverviewQuestion(text)) {
            console.log('PROGRAM_OVERVIEW_FINAL_WA');
            console.log(finalText);
          }
        } catch (e) {}
        await sendBotMessageOriginal(chatId, finalText, {
          sentViaComposer: source === 'intro',
          source,
          sourceType,
          finalPipeline: bypassPipeline,
          timeoutTriggered: !!state.timeoutTriggered,
          duplicateSendPrevented: !!state.duplicateSendPrevented,
          contextReused: !!state.contextReused,
          responseMode: 'deterministic'
        });
      } catch (e) {
        logger && logger.warn && logger.warn({ err: e && e.message ? e.message : String(e) }, '[ComposerPipeline] Failed to send deterministic reply');
      }
      state.outboundSent = true;
      clearReplyDeadline();
      return { bypass: true };
    }


    // Emit a short debug log for CI/test visibility
    try {
      const pendingKeys = Object.keys(sessionData || {}).filter(k => String(k || '').startsWith('pending'));
      console.log('COMPOSER_INPUT', { chatId, userQuery: text, pendingKeys });
    } catch (e) {}

    const composeResult = await composeResponse({
      ...composePayload,
      ragMeta: (ragResult && ragResult.meta) ? ragResult.meta : null,
      tone: typeof getComposerTone === 'function' ? getComposerTone() : null,
      config: {
        REFLECT_INTENT_THRESHOLD: Number(process.env.REFLECT_INTENT_THRESHOLD || '0.7'),
        DIRECT_ANSWER_THRESHOLD: Number(process.env.DIRECT_ANSWER_THRESHOLD || '0.95'),
        RAG_MIN_SCORE: Number(process.env.RAG_MIN_SCORE || '0.6'),
        FOLLOWUP_INTENT_MIN: Number(process.env.FOLLOWUP_INTENT_MIN || '0.65'),
        FOLLOWUP_RAG_MIN: Number(process.env.FOLLOWUP_RAG_MIN || '0.55'),
        MAX_EVIDENCE: Number(process.env.COMPOSER_MAX_EVIDENCE || '3')
      }
    });


    // Composer pipeline is intentionally thin: do not run a separate humanizer here.
    // Only apply minimal normalization/formatting to preserve body-first output.
    const rawFinal = String(composeResult.finalText || '').trim();
    let finalText = rawFinal
      .replace(/\u00A0/g, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .join('\n\n');

    // E2E header cleanup: strip systemy header lines like "🎓 Kamu ingin tahu ..." and markdown separators
    try {
      finalText = finalText.replace(/^\s*[🎓📚🧭💡].{0,6}\s*Kamu\s+ingin\s+tahu[^\n]*\n?/i, '');
      finalText = finalText.replace(/^\s*(?:- --|--+|---+)\s*$/gm, '');
      finalText = finalText.replace(/^\s*---+\s*$/gm, '');
      finalText = finalText.replace(/[ΓÇó•·◦⁃‣]/g, '-');
    } catch (e) {}

    // If intent is academic (not tuition/scholarship), remove injected fee/scholarship paragraphs
    try {
      const feeKeywordsRe = /\b(biaya|dpp|ukt|pendaftaran|potongan|diskon|beasiswa)\b/i;
      const academicIntents = ['PROGRAM','PROGRAM_INFO','CURRICULUM','CAREER','SCHEDULE','ADMISSION','GENERAL'];
      const mainIntent = intentLabel || '';
      const isAcademic = academicIntents.includes(String(mainIntent).toUpperCase()) && !['COST','SCHOLARSHIP','TUITION','PAYMENT'].includes(String(mainIntent).toUpperCase());
      if (isAcademic && feeKeywordsRe.test(finalText)) {
        const parts = finalText.split(/\n\n/).filter(Boolean);
        const filtered = parts.filter(p => !feeKeywordsRe.test(p));
        // keep at least first paragraph to avoid empty reply
        const cleaned = filtered.length ? filtered.join('\n\n') : parts.slice(0,1).join('\n\n');
        // override finalText for sending
        try { finalText = cleaned; } catch (e) {}
      }
    } catch (e) {}
    if (String(process.env.COMPOSER_DEBUG).toLowerCase() === 'true') {
      try {
        console.info('[COMPOSER DEBUG FINAL]', { text: finalText, source, sourceType, contextReused: !!state.contextReused, programHint: sessionForComposer.programHint });
      } catch (e) {}
    }
    // Optionally run humanizer to produce a naturalized lead/paraphrase when available
    if (typeof humanizeFinalAnswer === 'function') {
      try {
        const maybe = humanizeFinalAnswer(finalText, { question: text, tone: typeof getComposerTone === 'function' ? getComposerTone() : {}, kind: 'composer' });
        // support sync or promise-based humanizers
        finalText = (maybe && typeof maybe.then === 'function') ? (await maybe) : (maybe || finalText);
      } catch (e) {
        // ignore humanizer failures
      }
    }
    state.replyAlreadySent = true;
    state.composerCompleted = true;

    // Persist inferred recommendation memory (userProfile) from Composer reasoning context
    try {
      const rc = composeResult && composeResult.meta && composeResult.meta.reasoningContext ? composeResult.meta.reasoningContext : null;
      const sessSignals = rc && rc.sessionSignals ? rc.sessionSignals : null;
      // Merge richer inferred profile using updateUserProfile helper when available
      try {
        const prevData = (getSessionData && typeof getSessionData === 'function') ? getSessionData() : {};
        const existingProfile = (prevData && prevData.userProfile) ? prevData.userProfile : {};
        let updatedProfile = existingProfile;
        // If composer provided an inferredProfile, merge directly
        if (rc && rc.inferredProfile) {
          updatedProfile = Object.assign({}, existingProfile, rc.inferredProfile || {});
        }
        // Also perform a safe update using updateUserProfile to capture emotions/interests/weakSubjects
        if (typeof updateUserProfile === 'function') {
          try {
            updatedProfile = updateUserProfile(updatedProfile, String(composePayload.userQuery || ''), rc && rc.conversationalHistory && rc.conversationalHistory.recentTurns ? rc.conversationalHistory.recentTurns : [], rc && rc.knowledgeContext && rc.knowledgeContext.evidence ? rc.knowledgeContext.evidence : []);
          } catch (e) {
            // fallback to direct merge
            updatedProfile = Object.assign({}, updatedProfile);
          }
        }

        const userProfileUpdate = updatedProfile;
        if (userProfileUpdate && Object.keys(userProfileUpdate).length) {
          const currentState = (getSession && typeof getSession === 'function' && getSession() && getSession().state) ? getSession().state : 'root';
          const prevData = (getSessionData && typeof getSessionData === 'function') ? getSessionData() : {};
          const newData = Object.assign({}, prevData || {}, { userProfile: Object.assign({}, (prevData && prevData.userProfile) || {}, userProfileUpdate) });
          try {
            await safeSessionUpsert(prisma, { where: { chatId }, create: { chatId, state: currentState, data: newData }, update: { state: currentState, data: newData } });
            if (setSessionData && typeof setSessionData === 'function') setSessionData(newData);
          } catch (e) {
            logger && logger.warn && logger.warn({ err: e && e.message ? e.message : String(e) }, '[ComposerPipeline] Failed to persist userProfile');
          }
        }
      } catch (e) {
        // ignore profile persistence errors
      }
    } catch (e) {
      // ignore
    }

    await persistComposerSessionFlags({
      composeResult,
      source,
      sourceType: effectiveSourceType,
      finalPipeline,
      welcomeSuppressed,
      clarificationUsed,
      routePolicy
    });


        // E2E TRACE: log final text and sources before WhatsApp send (pre-sanitize)
    try {
      if (String(process.env.PROVIDER_E2E_DEBUG || '').toLowerCase() === 'true') {
        const files = Array.isArray(adjustedRetrievals) ? Array.from(new Set(adjustedRetrievals.map(r => r && (r.filename || r.sourceFile)).filter(Boolean))) : [];
        logger && logger.info && logger.info({
          chatId,
          query: text,
          detectedIntent: intentLabel,
          programHint: sessionForComposer.programHint || null,
          selectedChunks: (adjustedRetrievals || []).slice(0,6).map(r => ({ filename: r && r.filename || null, score: r && (r.score || r.similarity || null), title: r && (r.title || null) })),
          finalContextSources: files,
          ragSource: ragResult && ragResult.source ? ragResult.source : null,
          finalPreSend: finalText
        }, '[E2E TRACE] Final before WhatsApp send (pre-sanitize)');
      }
    } catch (e) {}

    // Apply a debug trace for program overview outputs before WhatsApp formatting.
    try {
      logger && logger.info && logger.info({
        chatId,
        query: text,
        trace: 'TRACE_PROGRAM_OVERVIEW_FINAL',
        rawPreFormatter: finalText,
        isProgramOverviewQuestion: isProgramOverviewQuestion(text)
      }, '[TRACE_PROGRAM_OVERVIEW_FINAL] Raw final answer before WA formatter');
    } catch (e) {}

    // Apply a debug trace for program overview outputs before WhatsApp formatting.
    if (isProgramOverviewQuestion(text)) {
      try {
        console.log('PROGRAM_OVERVIEW_PRE_FORMATTER');
        console.log(finalText);
      } catch (e) {}
    }

    // Apply a global WhatsApp response wrapper so every final answer has a consistent structure.
    try {
      finalText = buildWhatsappConversationalReply({
        rawMainAnswer: finalText,
        userQuery: text,
        includeMeta: true
      });
    } catch (e) {}

    // Sanitize for WhatsApp (strip mojibake/markdown remains)
    try {
      finalText = sanitizeWhatsappText(finalText);
    } catch (e) {}

    try {
      // Emit detailed intent/retrieval tracing for debugging runtime issues
      try {
        console.info('[INTENT TRACE]', {
          QUERY: text,
          DETECTED_INTENT: intentLabel || null,
          DOMINANT_INTENT: composeResult && composeResult.meta && composeResult.meta.dominantIntent ? composeResult.meta.dominantIntent : null,
          TOP_RETRIEVAL_TOPIC: composeResult && composeResult.meta && composeResult.meta.retrievalTopTopic ? composeResult.meta.retrievalTopTopic : null,
          TOP_RETRIEVAL_SCORE: composeResult && composeResult.meta && typeof composeResult.meta.topScore !== 'undefined' ? composeResult.meta.topScore : null,
          INJECTED_BLOCKS: composeResult && composeResult.meta && composeResult.meta.injectedBlocks ? composeResult.meta.injectedBlocks : [],
          SUPPRESSED_BLOCKS: composeResult && composeResult.meta && composeResult.meta.suppressedTopics ? composeResult.meta.suppressedTopics : [],
          FINAL_RESPONSE_TOPIC: (typeof detectIntent === 'function') ? detectIntent(String(finalText || '')) : null
        });
      } catch (e) {}

      logger.info({
        chatId,
        source,
        sentViaComposer: true,
        legacyPathUsed: !!String(source || '').match(/^fee_fast_path|rule|rag/i),
        bypassDetected: !!String(source || '').match(/^fee_fast_path|legacy|fast_path/i),
        sourceType,
        finalPipeline,
        timeoutTriggered: !!state.timeoutTriggered,
        duplicateSendPrevented: !!state.duplicateSendPrevented,
        reflectionUsed: !!composeResult?.segments?.reflection,
        followupUsed: !!composeResult?.segments?.followUp,
        clarificationUsed: !!clarificationUsed,
        welcomeSuppressed: !!welcomeSuppressed,
        answerPreview: String(finalText || '').slice(0, 120),
        finalAnswerTopic: (typeof detectIntent === 'function') ? detectIntent(String(finalText || '')) : null,
        detectedIntent: intentLabel || null
      }, '[Provider] Composed reply ready');
      try {
        logger.info({
          trace: 'TRACE_INTENT_FINAL',
          chatId,
          userQuery: text,
          finalTextPreview: String(finalText || '').slice(0, 120),
          finalDetectedIntent: (typeof detectIntent === 'function') ? detectIntent(String(finalText || '')) : null,
          detectedIntent: intentLabel || null
        }, '[TRACE_INTENT_FINAL] Composer final intent');
      } catch (e) {}
    } catch (e) {
      // ignore logging issues
    }

    try {
      console.log('=== COMPOSER FINAL TEXT ===', String(finalText || ''));
      if (isProgramOverviewQuestion(text)) {
        console.log('PROGRAM_OVERVIEW_FINAL_WA');
        console.log(finalText);
      }
    } catch (e) {}
    await sendBotMessageOriginal(chatId, finalText, {
      sentViaComposer: true,
      source,
      sourceType,
      finalPipeline,
      timeoutTriggered: !!state.timeoutTriggered,
      duplicateSendPrevented: !!state.duplicateSendPrevented,
      contextReused: !!state.contextReused,
      composerMeta: composeResult && composeResult.meta ? Object.assign({}, composeResult.meta, { userQuery: text, finalText: finalText }) : { userQuery: text, finalText: finalText }
    });
    state.outboundSent = true;
    clearReplyDeadline();
    return composeResult;
  };

  return { sendComposedReply };
}

module.exports = { createComposerPipeline };