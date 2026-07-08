const { assertValidComposePayload } = require('./composerContract');

function createRuleRouter({
  detectIntent,
  isRagEnabled,
  ragQueryWithEval,
  isRelevantContext,
  logger,
  buildUnifiedResponse,
  extractStructuredDataFromRag,
  normalizeRagScore
}) {
  const ruleAnswerCandidates = [];

  const addRuleCandidate = (candidate) => {
    if (!candidate || typeof candidate.answer !== 'string' || !candidate.answer.trim()) return;
    ruleAnswerCandidates.push(candidate);
  };

  const selectBestRuleCandidate = () => {
    if (!ruleAnswerCandidates.length) return null;
    return ruleAnswerCandidates.reduce((best, candidate) => {
      const bestScore = typeof best.confidence === 'number' ? best.confidence : 0;
      const candScore = typeof candidate.confidence === 'number' ? candidate.confidence : 0;
      return candScore > bestScore ? candidate : best;
    }, ruleAnswerCandidates[0]);
  };

  const decideRuleVsRagAnswer = async ({ composePayload, chatId, hasActiveTrainingData, allowIndexFallbackNoDb }) => {
    if (process.env.NODE_ENV !== 'production') {
      assertValidComposePayload(composePayload);
    }

    const ruleCandidate = selectBestRuleCandidate();
    if (!isRagEnabled() || !(hasActiveTrainingData || allowIndexFallbackNoDb)) {
      if (ruleCandidate) {
        return { winner: 'rule', candidate: ruleCandidate, answer: ruleCandidate.answer };
      }
      return null;
    }

    const topK = parseInt(process.env.RAG_TOP_K || '10', 10);
    let ragResult = null;
    const text = String(composePayload.userQuery || '').trim();
    const intentLabel = composePayload.intent && composePayload.intent.label ? composePayload.intent.label : detectIntent(text);

    const RULE_AUTOSHORTCUT_THRESHOLD = parseFloat(process.env.RULE_AUTOSHORTCUT_THRESHOLD || '0.65');
    if (ruleCandidate && typeof ruleCandidate.confidence === 'number' && ruleCandidate.confidence >= RULE_AUTOSHORTCUT_THRESHOLD) {
      return { winner: 'rule', candidate: ruleCandidate, answer: ruleCandidate.answer };
    }

    try {
      ragResult = await ragQueryWithEval(chatId, String(text || '').trim(), topK, {
        answerQuestion: String(text || '').trim(),
        strict: true
      });
    } catch (e) {
      logger.warn({ err: e && e.message ? e.message : String(e) }, '[Provider] rule-vs-rag decision RAG failed');
    }

    const ragScore = normalizeRagScore(ragResult);
    const minRagScore = Number.isFinite(parseFloat(process.env.RAG_MIN_SCORE || '0.6')) ? parseFloat(process.env.RAG_MIN_SCORE || '0.6') : 0.6;

    if (ragResult && ragResult.contexts && Array.isArray(ragResult.contexts)) {
      const intent = intentLabel;
      console.log('[RAG-FILTER] Detected intent:', intent, 'for question:', text);

      const filteredContexts = ragResult.contexts.filter(ctx => {
        const chunk = ctx && typeof ctx.chunk === 'string' ? ctx.chunk : '';
        if (!chunk) return false;
        if (!isRelevantContext(String(text || '').trim(), chunk)) {
          console.log('[RAG-FILTER] Filtered out irrelevant context:', chunk.substring(0, 100) + '...');
          return false;
        }
        return true;
      });

      if (filteredContexts.length > 1) {
        console.log('[RAG-FILTER] Combined', filteredContexts.length, 'contexts for multi-document reasoning');
      }

      ragResult.contexts = filteredContexts;
    }

    if (ragResult && ragResult.success && ragResult.answer && ragScore >= minRagScore) {
      const extracted = (typeof extractStructuredDataFromRag === 'function')
        ? extractStructuredDataFromRag(ragResult.answer)
        : null;
      if (extracted && (extracted.pendaftaran.found || extracted.dpp.found || extracted.ukt.found || extracted.potongan.found)) {
        const isFull = extracted.program && extracted.gelombang && extracted.pendaftaran !== undefined && extracted.dpp !== undefined;
        const mode = isFull ? 'full' : 'partial';
        const structuredAnswer = buildUnifiedResponse(extracted, ragResult.answer, mode);
        if (structuredAnswer) {
          return { winner: 'rag-structured', ragResult: { ...ragResult, answer: structuredAnswer, extracted } };
        }
      }
      return { winner: 'rag', ragResult: { ...ragResult } };
    }

    if (ragResult && ragResult.success && (ragResult.confidenceTier === 'MEDIUM' || ragResult.source === 'rag-inference-medium')) {
      if (ragResult.answer) {
        return { winner: 'rag-inference', ragResult: { ...ragResult } };
      }
    }

    if (ruleCandidate) {
      return { winner: 'rule', candidate: ruleCandidate };
    }

    if (ragResult && ragResult.success && ragResult.contexts && ragResult.contexts.length > 0) {
      return { winner: 'rag', ragResult: { ...ragResult } };
    }

    return null;
  };

  const commitChosenRuleCandidate = async (candidate) => {
    if (candidate && typeof candidate.commit === 'function') {
      try {
        await candidate.commit();
      } catch (e) {
        logger.warn({ err: e && e.message ? e.message : String(e) }, `[Provider] rule candidate commit failed for ${candidate.source || 'unknown'}`);
      }
    }
  };

  const hasRuleCandidates = () => ruleAnswerCandidates.length > 0;

  return {
    addRuleCandidate,
    decideRuleVsRagAnswer,
    commitChosenRuleCandidate,
    hasRuleCandidates
  };
}

module.exports = { createRuleRouter };