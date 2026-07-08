const pino = require('pino');

// Simple structured logger with environment-based level
// Levels: fatal, error, warn, info, debug, trace
// NOTE: In Jest, modules may be reloaded repeatedly (resetModules). Creating a new
// pino-pretty transport each time registers process exit listeners and can trigger
// MaxListenersExceededWarning. Use a per-process singleton.

const globalKey = '__system_wa_logger__';

function normalizeLevel(value, fallback) {
  const v = String(value || '').trim().toLowerCase();
  const allowed = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);
  if (allowed.has(v)) return v;
  return fallback;
}

function createLogger({ env, level, transport }) {
  const normalizedLevel = normalizeLevel(level, env === 'production' ? 'info' : 'debug');

  try {
    return pino({ level: normalizedLevel, transport });
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    // In some environments, Pino may be configured with custom levels externally.
    // If the selected level isn't included, Pino throws during initialization.
    // Fall back to a safe default level and explicitly include standard levels.
    if (/custom levels/i.test(msg) || /must be included in custom levels/i.test(msg)) {
      const standardLevels = {
        fatal: 60,
        error: 50,
        warn: 40,
        info: 30,
        debug: 20,
        trace: 10
      };

      const safeLevel = normalizedLevel === 'silent' ? 'info' : normalizedLevel;
      // Avoid hard-failing the whole server just due to logger config.
      // eslint-disable-next-line no-console
      console.warn(`[Logger] Pino init failed for level="${normalizedLevel}", falling back with standard levels. Error: ${msg}`);
      return pino({ level: safeLevel, customLevels: standardLevels, useOnlyCustomLevels: false, transport });
    }

    throw err;
  }
}

/** @type {import('pino').Logger} */
let logger = process[globalKey];
if (!logger) {
  const env = process.env.NODE_ENV || 'development';
  // Keep unit test output readable: default to silent in Jest unless overridden.
  const level = process.env.LOG_LEVEL || (env === 'test' ? 'silent' : (env === 'production' ? 'info' : 'debug'));

  // In tests, keep logger minimal and synchronous (no transport threads).
  const transport = (env === 'production' || env === 'test')
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname'
        }
      };

  logger = createLogger({ env, level, transport });
  process[globalKey] = logger;
}

module.exports = logger;
