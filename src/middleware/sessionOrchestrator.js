/**
 * Session Orchestrator for Production-Safe RAG
 * 
 * RESPONSIBILITIES:
 * 1. Detect current user intent
 * 2. Compare with previous intent (session memory)
 * 3. Determine if context inheritance is SAFE
 * 4. Reset retrieval context on intent transition
 * 5. Enforce hard isolation between different intents
 * 
 * CORE PRINCIPLE:
 * - Current user intent is PRIMARY
 * - Previous session context is SECONDARY
 * - Metadata correctness > semantic similarity
 * - Safe refusal > hallucinated answers
 */

const logger = require('../logger');

// ============================================================================
// INTENT DEFINITIONS
// ============================================================================

const INTENT_CATEGORIES = {
  TUITION_FEE: 'tuition_fee',
  REGISTRATION: 'registration',
  CLASS_SCHEDULE: 'class_schedule',
  SCHOLARSHIP: 'scholarship',
  ADMISSION: 'admission',
  CONTACT: 'contact',
  LOCATION: 'location',
  ACCREDITATION: 'accreditation',
  CURRICULUM: 'curriculum',
  GENERAL_INFO: 'general_info'
};

const INTENT_KEYWORDS = {
  [INTENT_CATEGORIES.TUITION_FEE]: {
    patterns: [
      /\b(?:biaya|harga|biaya\s+pendidikan|biaya\s+kuliah|biaya\s+pendaftaran|dpp|ukt|spp|nominal|rincian\s+biaya|cicilan|potongan|diskon|beasiswa|sponsor)\b/i,
      /\b(?:berapa\s+(?:biaya|harga|nominal)|hitung|total|pembayaran|cicilan)\b/i
    ],
    confidence: 'high',
    category: 'FINANCIAL'
  },

  [INTENT_CATEGORIES.REGISTRATION]: {
    patterns: [
      /\b(?:pendaftaran|daftar|registrasi|register|apply|aplikasi|requirement|syarat|dokumen|file|upload|gelombang|gel|periode)\b/i,
      /\b(?:cara\s+(?:daftar|mendaftar|registrasi)|bagaimana\s+(?:daftar|registrasi))\b/i
    ],
    confidence: 'high',
    category: 'ADMISSIONS_PROCESS'
  },

  [INTENT_CATEGORIES.CLASS_SCHEDULE]: {
    patterns: [
      /\b(?:jadwal|schedule|kuliah|kelas|pembelajaran|les|semester|kontrak|kalender|akademik|academic|calendar)\b/i,
      /\b(?:kapan|berapa|tanggal|hari|jam|waktu|pukul|TA|tahun\s+akademik)\b.*(?:jadwal|kelas|kuliah|pembelajaran)/i,
      /\b(?:jadwal|kelas|kuliah|pembelajaran)\b.*(?:kapan|berapa|tanggal|hari|jam|waktu|pukul)\b/i
    ],
    confidence: 'high',
    category: 'ACADEMIC_SCHEDULE'
  },

  [INTENT_CATEGORIES.SCHOLARSHIP]: {
    patterns: [
      /\b(?:beasiswa|scholarship|bantuan|subsidi|sponsor|grant|award)\b/i,
      /\b(?:mendapat|dapat|terima|kualifikasi|syarat|requirement)\s+.*(?:beasiswa|scholarship)/i
    ],
    confidence: 'high',
    category: 'FINANCIAL_AID'
  },

  [INTENT_CATEGORIES.ADMISSION]: {
    patterns: [
      /\b(?:penerimaan|admission|masuk|accepted|admission|offer|undangan|lolos)\b/i,
      /\b(?:apakah\s+(?:saya|aku)|apa\s+(?:saya|aku))\s+(?:diterima|lolos|accepted|qualify)/i,
      /\b(?:hasil|status|keputusan)\s+(?:penerimaan|admission|seleksi)\b/i
    ],
    confidence: 'high',
    category: 'ADMISSIONS_STATUS'
  },

  [INTENT_CATEGORIES.CONTACT]: {
    patterns: [
      /\b(?:kontak|contact|telp|phone|wa|whatsapp|email|alamat|address|kantor|office|hubungi|hubung)\b/i,
      /\b(?:nomor|no|telephone|telepon|email|alamat)\b/i
    ],
    confidence: 'high',
    category: 'CONTACT_INFO'
  },

  [INTENT_CATEGORIES.LOCATION]: {
    patterns: [
      /\b(?:lokasi|location|di\s+mana|where|kantor|campus|kampus|gedung|lokasi\s+kuliah)\b/i,
      /\b(?:di\s+mana|dimana|where)\b.*(?:kampus|kantor|lokasi|alamat)/i
    ],
    confidence: 'high',
    category: 'CAMPUS_LOCATION'
  },

  [INTENT_CATEGORIES.CURRICULUM]: {
    patterns: [
      /\b(?:kurikulum|curriculum|mata\s+kuliah|course|kursus|mata\s+pelajaran|subject)\b/i,
      /\b(?:apa\s+saja|list)\s+(?:mata\s+kuliah|course|kursus)\b/i
    ],
    confidence: 'high',
    category: 'ACADEMIC_CONTENT'
  },

  [INTENT_CATEGORIES.ACCREDITATION]: {
    patterns: [
      /\b(?:akreditasi|accreditation|ijin|permission|valid|terakreditasi|sertifikat|certificate)\b/i,
      /\b(?:apakah|apakah\s+(?:kampus|prodi))\b.*(?:akreditasi|terakreditasi|ijin)/i
    ],
    confidence: 'high',
    category: 'CREDENTIAL_VERIFICATION'
  },

  [INTENT_CATEGORIES.GENERAL_INFO]: {
    patterns: [
      /\b(?:info|informasi|jelaskan|explain|apa|what|siapa|who|bagaimana|how|mengapa|why)\b/i
    ],
    confidence: 'low',
    category: 'GENERAL_QUESTION'
  }
};

// ============================================================================
// INTENT DETECTION ENGINE
// ============================================================================

function detectUserIntent(userMessage) {
  const msg = String(userMessage || '').trim();
  if (!msg) return { intent: INTENT_CATEGORIES.GENERAL_INFO, confidence: 'low', reason: 'empty_message' };

  const msgLower = msg.toLowerCase();
  const scores = {};

  // Score each intent based on keyword matches
  for (const [intent, config] of Object.entries(INTENT_KEYWORDS)) {
    scores[intent] = 0;
    for (const pattern of config.patterns) {
      const matches = msg.match(pattern);
      if (matches) {
        scores[intent] += matches.length * (config.confidence === 'high' ? 2 : 1);
      }
    }
  }

  // Find highest scoring intent
  let topIntent = INTENT_CATEGORIES.GENERAL_INFO;
  let topScore = 0;

  for (const [intent, score] of Object.entries(scores)) {
    if (score > topScore) {
      topScore = score;
      topIntent = intent;
    }
  }

  // Confidence level based on score
  let confidence = 'low';
  if (topScore >= 4) confidence = 'high';
  else if (topScore >= 2) confidence = 'medium';

  return {
    intent: topIntent,
    confidence,
    score: topScore,
    keywords: Object.keys(scores).filter(intent => scores[intent] > 0),
    reason: topScore > 0 ? 'keyword_match' : 'fallback_general'
  };
}

// ============================================================================
// CONTEXT INHERITANCE POLICY
// ============================================================================

const INHERITABLE_ENTITIES = ['program', 'campus', 'academicYear'];

function determineContextInheritance(currentIntent, previousIntent) {
  /**
   * RULE 1: If intent changes (different category), DO NOT inherit retrieval context
   * 
   * Examples:
   * - tuition_fee -> class_schedule = RESET (different domains)
   * - tuition_fee -> tuition_fee = INHERIT (same intent)
   */
  if (currentIntent !== previousIntent) {
    return {
      shouldInherit: false,
      reason: 'intent_changed',
      inheritableEntities: INHERITABLE_ENTITIES,
      clearRetrieval: true,
      clearRanking: true,
      clearSemanticAssumptions: true
    };
  }

  /**
   * RULE 2: If intent is same, only inherit stable entities
   * 
   * DO NOT inherit:
   * - retrieved chunks
   * - ranking state
   * - embedding results
   * - semantic assumptions
   * - category context
   */
  return {
    shouldInherit: true,
    reason: 'same_intent',
    inheritableEntities: INHERITABLE_ENTITIES,
    clearRetrieval: true,
    clearRanking: true,
    clearSemanticAssumptions: true
  };
}

// ============================================================================
// SESSION RETRIEVAL CONTEXT MANAGEMENT
// ============================================================================

function createRetrievalContext() {
  return {
    chunks: [],
    ranking: [],
    scores: {},
    embeddings: {},
    semanticAssumptions: [],
    metadata: {},
    timestamp: Date.now(),
    intent: null,
    category: null
  };
}

function clearRetrievalContext(sessionData) {
  /**
   * HARD RESET: Remove ALL retrieval context
   * 
   * This is called when intent changes and we need fresh retrieval
   */
  if (!sessionData || typeof sessionData !== 'object') {
    return sessionData;
  }

  const cleared = { ...sessionData };

  // Clear retrieval cache
  delete cleared.__retrievalCache;
  delete cleared.__retrievalContext;
  delete cleared.__lastRetrievedChunks;
  delete cleared.__retrievalScores;
  delete cleared.__semanticScores;
  delete cleared.__embeddingCache;
  delete cleared.__rankingState;

  // Clear old RAG assumptions
  delete cleared.__lastRagQuestion;
  delete cleared.__lastRagAnswer;
  delete cleared.__lastRagConfidence;
  delete cleared.__lastRagSource;
  delete cleared.__lastRagCategory;

  // Clear semantic assumptions
  delete cleared.__semanticAssumptions;
  delete cleared.__inferenceCache;

  logger.debug('[SessionOrchestrator] Cleared retrieval context', { sessionId: cleared.sessionId });

  return cleared;
}

function getInheritableEntities(sessionData) {
  /**
   * Extract ONLY stable entities that can be inherited across intent changes
   */
  if (!sessionData || typeof sessionData !== 'object') {
    return {};
  }

  const inherited = {};

  for (const entity of INHERITABLE_ENTITIES) {
    if (Object.prototype.hasOwnProperty.call(sessionData, entity) && sessionData[entity]) {
      inherited[entity] = sessionData[entity];
    }
  }

  return inherited;
}

function applyInheritedEntities(sessionData, inherited) {
  /**
   * Apply inherited entities back to session
   * Used when clearing retrieval context but preserving stable entities
   */
  if (!sessionData || typeof sessionData !== 'object') {
    return sessionData;
  }

  if (!inherited || typeof inherited !== 'object') {
    return sessionData;
  }

  const updated = { ...sessionData };

  for (const [key, value] of Object.entries(inherited)) {
    updated[key] = value;
  }

  return updated;
}

// ============================================================================
// SESSION STATE ORCHESTRATION
// ============================================================================

function processIntentTransition(sessionData, currentUserMessage) {
  /**
   * Main orchestration function
   * 
   * Called when new message arrives:
   * 1. Detect current intent
   * 2. Compare with previous intent
   * 3. Decide context handling
   * 4. Clear/preserve data accordingly
   * 5. Update session state
   */

  const currentIntent = detectUserIntent(currentUserMessage);
  const previousIntent = sessionData && sessionData.__currentIntent ? sessionData.__currentIntent : null;

  const policy = determineContextInheritance(currentIntent.intent, previousIntent);

  logger.info(
    {
      currentIntent: currentIntent.intent,
      previousIntent,
      policy: policy.reason,
      shouldInherit: policy.shouldInherit,
      confidence: currentIntent.confidence
    },
    '[SessionOrchestrator] Intent transition processed'
  );

  // If intent changed, clear retrieval context
  let updated = sessionData ? { ...sessionData } : {};

  if (!policy.shouldInherit) {
    // Hard reset: preserve inheritable entities
    const inherited = getInheritableEntities(updated);
    updated = clearRetrievalContext(updated);
    updated = applyInheritedEntities(updated, inherited);
  } else {
    // Same intent but still clear retrieval cache
    // (fresh retrieval for each message)
    updated = clearRetrievalContext(updated);
    const inherited = getInheritableEntities(sessionData);
    updated = applyInheritedEntities(updated, inherited);
  }

  // Update intent tracking
  updated.__previousIntent = previousIntent;
  updated.__currentIntent = currentIntent.intent;
  updated.__currentIntentConfidence = currentIntent.confidence;
  updated.__lastIntentDetectionReason = currentIntent.reason;
  updated.__intentTransitionTimestamp = Date.now();
  updated.__intentTransitionPolicy = policy.reason;

  return {
    session: updated,
    intentAnalysis: currentIntent,
    contextPolicy: policy,
    shouldResetContext: !policy.shouldInherit
  };
}

// ============================================================================
// MANDATORY QUERY VALIDATION
// ============================================================================

function validateQueryCompleteness(userMessage, detectedIntent) {
  /**
   * RULE: Before retrieval, extract required entities
   * 
   * If required entities are missing, ask clarification instead of guessing
   */

  const msg = String(userMessage || '').toLowerCase();
  const issues = [];
  const entities = {};

  // Intent-specific validation
  switch (detectedIntent) {
    case INTENT_CATEGORIES.TUITION_FEE: {
      // Must have: program
      const programPattern = /(?:prodi|program|jurusan|studi)\s+(\w+)|(\w+)\s+(?:prodi|program|jurusan|studi)/i;
      const programMatch = msg.match(programPattern);
      if (!programMatch) {
        issues.push('missing_program');
      } else {
        entities.program = programMatch[1] || programMatch[2];
      }

      // Optional but useful: wave
      const wavePattern = /(?:gelombang|gel|wave)\s+(\w+)|(\w+)\s+(?:gelombang|gel|wave)/i;
      const waveMatch = msg.match(wavePattern);
      if (waveMatch) {
        entities.wave = waveMatch[1] || waveMatch[2];
      }
      break;
    }

    case INTENT_CATEGORIES.CLASS_SCHEDULE: {
      // Should have: program (optional but helpful)
      const programPattern = /(?:prodi|program|jurusan)\s+(\w+)|(\w+)\s+(?:prodi|program|jurusan)/i;
      const programMatch = msg.match(programPattern);
      if (programMatch) {
        entities.program = programMatch[1] || programMatch[2];
      }

      // Should have: semester/tahun akademik
      const semesterPattern = /semester\s+(\d+)|(?:ta|tahun\s+akademik)\s+(\d{4})/i;
      const semesterMatch = msg.match(semesterPattern);
      if (semesterMatch) {
        entities.semester = semesterMatch[1] || semesterMatch[2];
      }
      break;
    }

    case INTENT_CATEGORIES.REGISTRATION: {
      // Must have: program
      const programPattern = /(?:prodi|program|jurusan)\s+(\w+)|(\w+)\s+(?:prodi|program|jurusan)/i;
      const programMatch = msg.match(programPattern);
      if (!programMatch) {
        issues.push('missing_program');
      } else {
        entities.program = programMatch[1] || programMatch[2];
      }
      break;
    }

    case INTENT_CATEGORIES.SCHOLARSHIP: {
      // Optional: program
      const programPattern = /(?:prodi|program|jurusan)\s+(\w+)|(\w+)\s+(?:prodi|program|jurusan)/i;
      const programMatch = msg.match(programPattern);
      if (programMatch) {
        entities.program = programMatch[1] || programMatch[2];
      }
      break;
    }
  }

  return {
    isComplete: issues.length === 0,
    issues,
    entities,
    recommendation: issues.length > 0 ? 'ask_clarification' : 'proceed_retrieval'
  };
}

function buildClarificationPrompt(userMessage, validation) {
  /**
   * Generate user-friendly clarification request
   */
  if (!validation || !Array.isArray(validation.issues) || validation.issues.length === 0) {
    return null;
  }

  const prompts = [];

  for (const issue of validation.issues) {
    switch (issue) {
      case 'missing_program':
        prompts.push('Program studi mana? (TI, SI, BD, SK, dll)');
        break;
      case 'missing_wave':
        prompts.push('Gelombang berapa? (1, 2, 3, dst)');
        break;
      case 'missing_year':
        prompts.push('Tahun akademik berapa? (contoh: 2024)');
        break;
      case 'missing_semester':
        prompts.push('Semester berapa?');
        break;
    }
  }

  if (prompts.length === 0) {
    return null;
  }

  return {
    type: 'clarification_needed',
    message: `Agar saya bisa bantu lebih akurat, bisa jelaskan:\n${prompts.join('\n')}`,
    issues: validation.issues,
    entities: validation.entities
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Intent detection
  detectUserIntent,
  INTENT_CATEGORIES,

  // Context management
  processIntentTransition,
  determineContextInheritance,
  clearRetrievalContext,
  getInheritableEntities,
  applyInheritedEntities,
  createRetrievalContext,

  // Query validation
  validateQueryCompleteness,
  buildClarificationPrompt,

  // Constants
  INHERITABLE_ENTITIES,
  INTENT_KEYWORDS
};
