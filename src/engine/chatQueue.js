/**
 * chatQueue.js
 *
 * In-memory per-chat async queue / Promise chain.
 * Guarantees that for the same normalized chatId, message N completely finishes
 * its context-dependent processing, persistence, and outbound dispatch before
 * message N+1 begins.
 *
 * Distinct chatIds run fully concurrently.
 * Rejections/errors in task N do not poison the queue for task N+1.
 * Drained queues are automatically cleaned up to prevent memory leaks.
 */

const queues = new Map();

function normalizeChatId(chatId) {
  if (!chatId) return 'unknown_chat';
  return String(chatId).replace(/[^a-zA-Z0-9_-]/g, '').trim().toLowerCase() || 'unknown_chat';
}

/**
 * Enqueues an async task for a given chatId.
 *
 * @param {string} chatId
 * @param {Function} taskFn - () => Promise<any>
 * @returns {Promise<any>}
 */
function enqueueChat(chatId, taskFn) {
  const key = normalizeChatId(chatId);
  const currentChain = queues.get(key) || Promise.resolve();

  let resolveTask, rejectTask;
  const taskPromise = new Promise((resolve, reject) => {
    resolveTask = resolve;
    rejectTask = reject;
  });

  const nextChain = currentChain
    .catch(() => {}) // Prevent previous error from poisoning the chain
    .then(async () => {
      try {
        const result = await taskFn();
        resolveTask(result);
      } catch (err) {
        rejectTask(err);
      } finally {
        if (queues.get(key) === nextChain) {
          queues.delete(key);
        }
      }
    });

  queues.set(key, nextChain);
  return taskPromise;
}

/**
 * Returns number of active chat queues (for telemetry and testing).
 */
function getActiveQueueCount() {
  return queues.size;
}

module.exports = {
  enqueueChat,
  normalizeChatId,
  getActiveQueueCount
};
