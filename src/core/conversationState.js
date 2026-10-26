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
  pendingClarification: null,
  clarificationTurnCount: 0,
  lastQuery: null,
  lastAnswer: null,
  lastTurnTs: null,
  turnCount: 0
});

const memorySessionStore = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes TTL baseline

function isSessionExpired(sessionRecord) {
  if (!sessionRecord?.data?.lastTurnTs) return false;
  return (Date.now() - sessionRecord.data.lastTurnTs) > SESSION_TTL_MS;
}

async function getSession(chatId) {
  if (!chatId) return { chatId: null, state: 'root', data: { ...DEFAULT_SESSION_DATA } };

  if (process.env.NODE_ENV === 'test') {
    if (memorySessionStore.has(String(chatId))) {
      const cached = memorySessionStore.get(String(chatId));
      if (isSessionExpired(cached)) {
        memorySessionStore.delete(String(chatId));
      } else {
        return cached;
      }
    }
    return {
      chatId: String(chatId),
      state: 'root',
      data: { ...DEFAULT_SESSION_DATA }
    };
  }

  try {
    const session = await prisma.session.findUnique({
      where: { chatId: String(chatId) }
    });

    if (session) {
      const dbData = session.data && typeof session.data === 'object' ? session.data : { ...DEFAULT_SESSION_DATA };
      const cached = memorySessionStore.get(String(chatId));

      const dbTs = dbData.lastTurnTs || 0;
      const memTs = cached?.data?.lastTurnTs || 0;

      // If cached memory record has a newer turn timestamp than DB (e.g. previous DB write timed out), preserve newer
      if (cached && memTs > dbTs && !isSessionExpired(cached)) {
        return cached;
      }

      const res = {
        chatId: session.chatId,
        state: session.state || 'root',
        data: dbData
      };

      if (!isSessionExpired(res)) {
        memorySessionStore.set(String(chatId), res);
        return res;
      } else {
        memorySessionStore.delete(String(chatId));
        return {
          chatId: String(chatId),
          state: 'root',
          data: { ...DEFAULT_SESSION_DATA }
        };
      }
    }
  } catch (err) {
    logger.warn({ err: err.message, chatId }, '[ConversationState] Failed to fetch session from DB');
  }

  if (memorySessionStore.has(String(chatId))) {
    const cached = memorySessionStore.get(String(chatId));
    if (isSessionExpired(cached)) {
      memorySessionStore.delete(String(chatId));
    } else {
      return cached;
    }
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
  memorySessionStore.set(String(chatId), sessionObj);

  if (process.env.NODE_ENV === 'test') {
    return sessionObj;
  }

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
    logger.error({ err: err.message, chatId }, '[ConversationState] Failed to update session');
    return sessionObj;
  }
}

async function resetSession(chatId) {
  if (chatId) memorySessionStore.delete(String(chatId));
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
