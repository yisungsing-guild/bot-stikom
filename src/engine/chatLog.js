const prisma = require('../db');
const logger = require('../logger');

// In-memory fallback for chat history.
// This keeps follow-ups coherent even if DB persistence is misconfigured at runtime.
// It is best-effort and process-local (won't survive restarts / multi-instance).
const inMemoryMessagesByChat = new Map();

function getMaxMessages() {
  return parseInt(process.env.CHAT_LOG_MAX_MESSAGES || '60', 10);
}

function getMaxChats() {
  return parseInt(process.env.CHAT_LOG_INMEM_MAX_CHATS || '5000', 10);
}

function getMaxQuestionKeys() {
  return parseInt(process.env.CHAT_LOG_MAX_QUESTION_KEYS || '200', 10);
}

function normalizeQuestion(text) {
  let s = String(text || '').toLowerCase();
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return '';

  // Similar normalization to the Admin UI History page.
  s = s
    .replace(/^(halo|hai|hi|ass?alam(u)?alaikum|pagi|siang|sore|malam)\b\s*/g, '')
    .replace(/^(kak|min|admin|gan|bro|sis|pak|bu)\b\s*/g, '')
    .replace(/^(saya\s+(ingin|mau)\s+)?(tanya|bertanya|nanya|mau\s+nanya)\b\s*/g, '')
    .replace(/^(mohon|tolong|boleh|bisa)\b\s*/g, '')
    .trim();

  s = s
    .replace(/\bprogram\s+studi\b/g, 'prodi')
    .replace(/\bsistem\s+informasi\b/g, 'si')
    .replace(/\bteknologi\s+informasi\b/g, 'ti')
    .replace(/\bbisnis\s+digital\b/g, 'bd')
    .replace(/\bsistem\s+komputer\b/g, 'sk');

  s = s
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return s;
}

function shouldIncludeQuestion(raw) {
  const t = String(raw || '').trim();
  if (!t) return false;
  if (t.length >= 6) return true;
  if (/[?]/.test(t)) return true;
  const low = t.toLowerCase();
  if (/^(apa|siapa|kapan|dimana|di\s+mana|berapa|bagaimana|gimana|kenapa|mengapa)\b/.test(low)) return true;
  return false;
}

function pruneQuestionRollup(questionCounts, questionLastAt) {
  const maxKeys = getMaxQuestionKeys();
  if (!Number.isFinite(maxKeys) || maxKeys <= 0) return { questionCounts, questionLastAt };

  const keys = Object.keys(questionCounts || {});
  if (keys.length <= maxKeys) return { questionCounts, questionLastAt };

  const lastAtMap = questionLastAt || {};
  const entries = keys.map((k) => ({
    k,
    c: Number(questionCounts[k] || 0),
    at: String(lastAtMap[k] || '')
  }));

  // Evict least-useful keys first: lowest count, then oldest lastSeen.
  entries.sort((a, b) => {
    if (a.c !== b.c) return a.c - b.c;
    const atA = a.at || '';
    const atB = b.at || '';
    return atA.localeCompare(atB);
  });

  const toRemove = entries.slice(0, Math.max(0, entries.length - maxKeys));
  const nextCounts = { ...(questionCounts || {}) };
  const nextLastAt = { ...(lastAtMap || {}) };
  for (const e of toRemove) {
    delete nextCounts[e.k];
    delete nextLastAt[e.k];
  }

  return { questionCounts: nextCounts, questionLastAt: nextLastAt };
}

function updateQuestionRollup(prevData, rawMessage) {
  if (!shouldIncludeQuestion(rawMessage)) return prevData;
  const key = normalizeQuestion(rawMessage);
  if (!key) return prevData;

  const prevCounts = (prevData && typeof prevData === 'object' && prevData.questionCounts && typeof prevData.questionCounts === 'object')
    ? prevData.questionCounts
    : {};
  const prevLastAt = (prevData && typeof prevData === 'object' && prevData.questionLastAt && typeof prevData.questionLastAt === 'object')
    ? prevData.questionLastAt
    : {};

  const nowIso = new Date().toISOString();
  const nextCounts = { ...prevCounts, [key]: Number(prevCounts[key] || 0) + 1 };
  const nextLastAt = { ...prevLastAt, [key]: nowIso };

  const pruned = pruneQuestionRollup(nextCounts, nextLastAt);
  return {
    ...prevData,
    questionCounts: pruned.questionCounts,
    questionLastAt: pruned.questionLastAt,
  };
}

function appendInMemory(chatId, direction, message) {
  const now = new Date().toISOString();
  const maxMessages = getMaxMessages();
  const prev = inMemoryMessagesByChat.get(chatId) || [];
  const nextAll = [
    ...prev,
    {
      direction: direction || 'system',
      message: message || '',
      at: now
    }
  ];
  const next = (Number.isFinite(maxMessages) && maxMessages > 0)
    ? nextAll.slice(-maxMessages)
    : nextAll;

  // Refresh insertion order so we can evict oldest chats.
  if (inMemoryMessagesByChat.has(chatId)) inMemoryMessagesByChat.delete(chatId);
  inMemoryMessagesByChat.set(chatId, next);

  const maxChats = getMaxChats();
  if (Number.isFinite(maxChats) && maxChats > 0) {
    while (inMemoryMessagesByChat.size > maxChats) {
      const oldestKey = inMemoryMessagesByChat.keys().next().value;
      if (!oldestKey) break;
      inMemoryMessagesByChat.delete(oldestKey);
    }
  }
}

/**
 * Append a message to the per-chat log stored in Session.data.messages.
 * This avoids schema changes and keeps history centralized.
 * direction: 'user' | 'bot' | 'agent' | 'system'
 */
async function appendChatMessage(chatId, direction, message) {
  try {
    // Always keep a process-local history so follow-ups still work even if DB writes fail.
    appendInMemory(chatId, direction, message);

    const now = new Date().toISOString();
    const session = await prisma.session.findUnique({ where: { chatId } });
    const prevData = (session && session.data) ? session.data : {};
    const prevMessages = Array.isArray(prevData.messages) ? prevData.messages : [];

    const maxMessages = getMaxMessages();

    const newMessagesAll = [
      ...prevMessages,
      {
        direction: direction || 'system',
        message: message || '',
        at: now
      }
    ];

    // Keep only the last N messages to avoid growing Session.data indefinitely.
    const newMessages = (Number.isFinite(maxMessages) && maxMessages > 0)
      ? newMessagesAll.slice(-maxMessages)
      : newMessagesAll;

    let newData = {
      ...prevData,
      messages: newMessages
    };

    if (String(direction || '') === 'user') {
      newData = updateQuestionRollup(newData, message);
    }

    if (session) {
      await prisma.session.update({
        where: { chatId },
        data: { data: newData }
      });
    } else {
      await prisma.session.create({
        data: {
          chatId,
          state: 'root',
          data: newData
        }
      });
    }
  } catch (err) {
    logger.warn(
      {
        chatId,
        err: err && err.message ? err.message : String(err),
        code: err && err.code ? err.code : undefined
      },
      '[ChatLog] Failed to append chat message'
    );
  }
}

/**
 * Get ordered messages for a chat from Session.data.messages.
 */
async function getChatMessages(chatId) {
  try {
    const session = await prisma.session.findUnique({ where: { chatId } });
    const data = session && session.data ? session.data : {};
    const messages = Array.isArray(data.messages) ? data.messages : [];
    if (messages && messages.length > 0) return messages;
  } catch (err) {
    logger.warn(
      {
        chatId,
        err: err && err.message ? err.message : String(err),
        code: err && err.code ? err.code : undefined
      },
      '[ChatLog] Failed to read chat messages from DB'
    );
  }

  const inMem = inMemoryMessagesByChat.get(chatId);
  return Array.isArray(inMem) ? inMem : [];
}

module.exports = {
  appendChatMessage,
  getChatMessages
};
