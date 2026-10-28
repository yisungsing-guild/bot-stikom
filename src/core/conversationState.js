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

const DEFAULT_SESSION_DATA = Object.freeze({
  activeDomain: null,
  activeEntity: null,
  activeProgram: null,
  lastQuery: null,
  lastAnswer: null,
  lastTurnTs: null,
  turnCount: 0
});

// Test-only memory store for fast, isolated test execution without external DB latency
const testMemorySessionStore = new Map();

async function getSession(chatId) {
  if (!chatId) return { chatId: null, state: 'root', data: { ...DEFAULT_SESSION_DATA } };

  // Strict isolation: only use in-memory store in test environment
  if (process.env.NODE_ENV === 'test') {
    if (testMemorySessionStore.has(String(chatId))) {
      return testMemorySessionStore.get(String(chatId));
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
      return {
        chatId: session.chatId,
        state: session.state || 'root',
        data: session.data && typeof session.data === 'object' ? session.data : { ...DEFAULT_SESSION_DATA }
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
  resetSession
};
