'use strict';

/**
 * src/core/conversationState.js
 * 
 * Greenfield Conversation State & Isolation Layer.
 * Invariant: CURRENT TURN > HISTORY.
 * - Manages session persistence in PostgreSQL.
 * - Prevents historical domain/topic leakage into independent queries.
 * - Explicitly tracks turns, but does not allow stale states to hijack new intents.
 */

const prisma = require('../db');
const logger = require('../logger');
const { isValidPendingClarification } = require('./contextResolver');

const DEFAULT_SESSION_DATA = Object.freeze({
  activeDomain: null,
  activeEntity: null,
  activeProgram: null,
  pendingClarification: null,
  lastQuery: null,
  lastAnswer: null,
  lastTurnTs: null,
  turnCount: 0
});

// Test-only memory store for fast, isolated test execution without external DB latency
const testMemorySessionStore = new Map();

function getConversationContextTtlMs() {
  const envHours = parseFloat(process.env.CONVERSATION_CONTEXT_TTL_HOURS);
  const hours = (Number.isFinite(envHours) && envHours > 0) ? envHours : 24;
  return hours * 60 * 60 * 1000;
}

function applyContextTtlPolicy(data, currentTime = Date.now()) {
  if (!data || typeof data !== 'object') return { ...DEFAULT_SESSION_DATA };

  const lastTurnTs = Number(data.lastTurnTs || (data.updatedAt ? new Date(data.updatedAt).getTime() : 0));
  // Fallback safety: if active context exists without valid timestamp, clean stale context to avoid reviving zombie state
  if (!lastTurnTs || Number.isNaN(lastTurnTs) || lastTurnTs <= 0) {
    if (data.activeEntity || data.activeDomain || data.preservedBackgroundEntity || data.pendingClarification) {
      return {
        ...data,
        activeDomain: null,
        activeIntent: null,
        activeEntity: null,
        activeEntities: [],
        activeProgram: null,
        activeAspects: [],
        requestedAspects: [],
        requestedAttributes: [],
        pendingClarification: null,
        preservedBackgroundEntity: null,
        lastAcademicProgramEntity: null,
        lastActiveWave: null,
        academicYear: null,
        isProximityComparison: false,
        isContextExpired: true
      };
    }
    return data;
  }

  const ttlMs = getConversationContextTtlMs();
  const elapsed = currentTime - lastTurnTs;

  if (elapsed >= ttlMs) {
    // TTL expired: Clear active conversation context, but preserve historical background (conversationHistory, turnCount, userOrigin)
    return {
      ...data,
      activeDomain: null,
      activeIntent: null,
      activeEntity: null,
      activeEntities: [],
      activeProgram: null,
      activeAspects: [],
      requestedAspects: [],
      requestedAttributes: [],
      pendingClarification: null,
      preservedBackgroundEntity: null,
      lastAcademicProgramEntity: null,
      lastActiveWave: null,
      academicYear: null,
      isProximityComparison: false,
      isContextExpired: true
    };
  }

  // Pending clarification TTL & validity check:
  // Stale, expired, future, or malformed pending clarifications must be purged even if lastTurnTs is recent
  if (data.pendingClarification && !isValidPendingClarification(data.pendingClarification, currentTime)) {
    return {
      ...data,
      pendingClarification: null
    };
  }

  return data;
}

async function getSession(chatId) {
  if (!chatId) return { chatId: null, state: 'root', data: { ...DEFAULT_SESSION_DATA } };

  // Strict isolation: only use in-memory store in test environment
  if (process.env.NODE_ENV === 'test') {
    if (testMemorySessionStore.has(String(chatId))) {
      const stored = testMemorySessionStore.get(String(chatId));
      return {
        ...stored,
        data: applyContextTtlPolicy(stored.data)
      };
    }
    return {
      chatId: String(chatId),
      state: 'root',
      data: { ...DEFAULT_SESSION_DATA }
    };
  }

  // Production: PostgreSQL is the single source of truth
  try {
    const session = await prisma.session.findUnique({
      where: { chatId: String(chatId) }
    });

    if (session) {
      const rawData = session.data && typeof session.data === 'object' ? session.data : { ...DEFAULT_SESSION_DATA };
      return {
        chatId: session.chatId,
        state: session.state || 'root',
        data: applyContextTtlPolicy(rawData)
      };
    }
  } catch (err) {
    logger.warn({ err: err.message, chatId }, '[ConversationState] Failed to fetch session from DB');
  }

  return {
    chatId: String(chatId),
    state: 'root',
    data: { ...DEFAULT_SESSION_DATA }
  };
}

async function updateSession(chatId, { state = 'root', dataPatch = {} } = {}) {
  if (!chatId) return null;

  const current = await getSession(chatId);
  const updatedData = {
    ...current.data,
    ...dataPatch,
    lastTurnTs: Date.now(),
    turnCount: (current.data.turnCount || 0) + 1
  };

  const sessionObj = {
    chatId: String(chatId),
    state,
    data: updatedData
  };

  // Strict isolation: test environment updates in-memory store only
  if (process.env.NODE_ENV === 'test') {
    testMemorySessionStore.set(String(chatId), sessionObj);
    return sessionObj;
  }

  // Production: PostgreSQL upsert with explicit failure handling
  try {
    const result = await prisma.session.upsert({
      where: { chatId: String(chatId) },
      create: {
        chatId: String(chatId),
        state,
        data: updatedData
      },
      update: {
        state,
        data: updatedData
      }
    });

    return result;
  } catch (err) {
    logger.error({ err: err.message, chatId }, '[ConversationState] Failed to update session in DB');
    // Return null so production callers explicitly know database write failed
    return null;
  }
}

async function resetSession(chatId) {
  if (process.env.NODE_ENV === 'test' && chatId) {
    testMemorySessionStore.delete(String(chatId));
  }
  return updateSession(chatId, {
    state: 'root',
    dataPatch: { ...DEFAULT_SESSION_DATA }
  });
}

module.exports = {
  getSession,
  updateSession,
  resetSession,
  getConversationContextTtlMs,
  applyContextTtlPolicy
};
