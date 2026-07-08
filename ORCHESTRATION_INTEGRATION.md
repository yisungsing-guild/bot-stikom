/**
 * INTEGRATION GUIDE: Production-Safe RAG Architecture
 * 
 * This document explains how to integrate:
 * 1. sessionOrchestrator.js (PRIORITY 1 - Intent + Context Management)
 * 2. hardMetadataGates.js (PRIORITY 2 - Strict Metadata Validation)
 * 3. Into provider.js (Main Message Handler)
 */

// ============================================================================
// PART 1: IMPORT IN provider.js (ADD AT TOP OF FILE)
// ============================================================================

// After existing requires, add:
const { 
  processIntentTransition,
  validateQueryCompleteness, 
  buildClarificationPrompt,
  clearRetrievalContext 
} = require('../middleware/sessionOrchestrator');

const {
  filterChunksByMetadataGates,
  validateQueryConstraints
} = require('../engine/hardMetadataGates');

// ============================================================================
// PART 2: ADD ORCHESTRATION BEFORE RAG QUERY
// ============================================================================

/**
 * Location: Inside ragQueryWithEval function (line ~517)
 * 
 * BEFORE calling ragQuery(), add orchestration:
 * 
 * Modified ragQueryWithEval pseudocode:
 */

async function ragQueryWithEvalWithOrchestration(chatId, question, topK, options, sessionData) {
  // STEP 1: Intent transition detection
  // Check if user's current intent differs from previous intent
  // If different, hard-reset retrieval context
  if (sessionData && sessionData.__currentIntent) {
    const orchResult = processIntentTransition(
      sessionData,
      question  // Current user message
    );

    if (orchResult && orchResult.intentChanged) {
      console.log('[Orchestrator] Intent transition detected', {
        from: orchResult.previousIntent,
        to: orchResult.currentIntent,
        policy: orchResult.contextPolicy
      });

      // Clear old retrieval context if policy says so
      if (orchResult.contextPolicy && !orchResult.contextPolicy.shouldInherit) {
        clearRetrievalContext(sessionData);
        console.log('[Orchestrator] Retrieval context cleared due to intent change');
      }
    }
  }

  // STEP 2: Query validation - ensure required entities are present
  const validation = validateQueryCompleteness(question, sessionData && sessionData.__currentIntent);
  
  if (validation && validation.isComplete === false) {
    console.log('[Orchestrator] Query incomplete, asking for clarification', {
      issues: validation.issues,
      missingEntities: validation.entities
    });

    // Return clarification prompt instead of executing RAG
    // This prevents hallucinations due to missing context
    return {
      success: true,
      answer: buildClarificationPrompt(question, validation),
      source: 'rag-clarification-needed',
      confidenceTier: 'CLARIFY'
    };
  }

  // STEP 3: Extract query constraints from session
  // If session has program/wave/academicYear set, pass to RAG
  const queryConstraints = {};
  if (sessionData) {
    if (sessionData.program) queryConstraints.program = sessionData.program;
    if (sessionData.wave) queryConstraints.wave = sessionData.wave;
    if (sessionData.academicYear) queryConstraints.academicYear = sessionData.academicYear;
    if (sessionData.campus) queryConstraints.campus = sessionData.campus;
  }

  // STEP 4: Call original RAG query
  let ragResult = null;
  try {
    ragResult = await ragQuery(question, topK, { ...options, ...queryConstraints });
  } catch (e) {
    logger.error({ err: e }, '[RAG] Query failed');
    return null;
  }

  // STEP 5: Apply hard metadata gates to results
  // CRITICAL: NO soft penalties, HARD rejection on mismatch
  if (ragResult && ragResult.contexts && Array.isArray(ragResult.contexts)) {
    const gateResult = filterChunksByMetadataGates(
      ragResult.contexts,
      queryConstraints
    );

    console.log('[HardGates] Metadata gate filtering applied', {
      originalCount: gateResult.originalCount,
      filtered: gateResult.filtered.length,
      passRate: gateResult.passRate,
      rejections: gateResult.rejections.length
    });

    // Replace contexts with only those that passed gates
    ragResult.contexts = gateResult.filtered;

    // If too many chunks rejected, lower confidence
    if (gateResult.passRate < 30) {
      ragResult.confidenceTier = ragResult.confidenceTier === 'HIGH' ? 'MEDIUM' : 'LOW';
      console.log('[HardGates] Confidence lowered due to high rejection rate');
    }
  }

  // STEP 6: Return enhanced result
  return ragResult;
}

// ============================================================================
// PART 3: INTEGRATION POINT IN WEBHOOK HANDLER
// ============================================================================

/**
 * Location: Inside router.post('/webhook', ...) function (line ~5766)
 * 
 * Replace existing call to ragQueryWithEval with call to new orchestrated version:
 * 
 * BEFORE:
 *   ragResult = await ragQueryWithEval(chatId, String(text || '').trim(), topK, { ... });
 * 
 * AFTER:
 */

// In webhook handler, update to pass sessionData:
async function handleWebhookWithOrchestration(chatId, text, sessionData, topK) {
  // Load or initialize session data if not already loaded
  let session = sessionData;
  if (!session) {
    session = (await prisma.session.findUnique({ where: { chatId } })) || {};
    session.data = session.data || {};
  }

  // Call orchestrated RAG query
  const ragResult = await ragQueryWithEvalWithOrchestration(
    chatId,
    String(text || '').trim(),
    topK,
    { answerQuestion: String(text || '').trim(), strict: true },
    session.data  // Pass session data for orchestration
  );

  // Continue with normal RAG result processing...
  return ragResult;
}

// ============================================================================
// PART 4: CRITICAL RULES
// ============================================================================

/*
 * RULE 1: Intent Transition
 * - User's CURRENT intent is PRIMARY
 * - Previous session context is SECONDARY
 * - On intent change: hard reset all retrieval context (NOT soft penalty)
 * 
 * RULE 2: Metadata Gates
 * - NO soft penalties for metadata mismatch
 * - HARD rejection: if (chunk.program !== query.program) → REJECT
 * - Applied BEFORE similarity scoring
 * - BEFORE confidence calculation
 * 
 * RULE 3: Query Validation
 * - Before RAG retrieval, validate required entities present
 * - If incomplete: ask clarification FIRST
 * - Prevent retrieval with missing critical context
 * 
 * RULE 4: Safe Fallback
 * - Low confidence + numeric data → REJECT
 * - Medium confidence + numeric data → REJECT
 * - Contradiction detected → REJECT
 * - Inference on prohibited topics → REJECT
 */

// ============================================================================
// PART 5: TESTING
// ============================================================================

/**
 * Test scenarios to verify integration:
 * 
 * TEST 1: Intent Transition
 * - User asks: "Berapa biaya TI?" (intent: COST, program: TI)
 * - Previous context has biaya chunks for SI
 * - Expected: SI chunks should be rejected, only TI chunks returned
 * 
 * TEST 2: Metadata Gate - Program Mismatch
 * - Query specifies program=BD
 * - Chunk has program=SI
 * - Expected: Chunk REJECTED (no soft penalty)
 * 
 * TEST 3: Query Validation
 * - User asks: "Berapa potongan gelombang?" (incomplete - no program)
 * - Expected: Clarification prompt asking which program
 * 
 * TEST 4: Multiple Intent Changes
 * - User: "TI itu apa?"
 * - Bot: Returns TI info
 * - User: "Bagaimana jadwal PMB?"
 * - Intent changes from GENERAL_INFO → SCHEDULE
 * - Old TI chunks should be cleared
 * - Expected: Only PMB schedule chunks returned
 * 
 * TEST 5: Numeric Safety
 * - User asks: "Berapa biaya kuliah TI per semester?" (numeric query)
 * - RAG returns MEDIUM confidence answer
 * - Answer contains numeric
 * - Expected: REJECTED (MEDIUM confidence + numeric not allowed)
 */

// ============================================================================
// PART 6: ENVIRONMENT VARIABLES
// ============================================================================

/**
 * Required env vars (add to .env.production.local):
 * 
 * # Orchestration
 * ORCHESTRATION_ENABLED=true
 * INTENT_DETECTION_METHOD=keyword-based
 * 
 * # Hard Gates
 * HARD_METADATA_GATES_ENABLED=true
 * METADATA_GATE_STRICT=true
 * 
 * # Query Validation
 * QUERY_VALIDATION_ENABLED=true
 * REQUIRE_PROGRAM_FOR_COST_QUERY=true
 * REQUIRE_WAVE_FOR_SCHEDULE_QUERY=true
 * 
 * # Safety
 * REJECT_MEDIUM_WITH_NUMERIC=true
 * REJECT_INFERENCE_NUMERIC_TOPICS=true
 * 
 * # Logging
 * LOG_ORCHESTRATION_DECISIONS=true
 * LOG_METADATA_GATE_REJECTIONS=true
 */

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  ragQueryWithEvalWithOrchestration,
  handleWebhookWithOrchestration
};
