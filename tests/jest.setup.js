/* Jest setup to keep test output readable.
 * Filters noisy logs while still allowing unexpected logs through.
 */

const original = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
};

function shouldSuppressConsoleMessage(args) {
  if (process.env.JEST_VERBOSE_LOGS === 'true') return false;

  const first = args?.[0];
  const msg = typeof first === 'string' ? first : '';

  // Provider route tests can produce a lot of repetitive logs.
  if (msg.includes('[ProviderRoute] POST /provider/webhook received')) return true;
  if (msg.includes('[ProviderRoute] Duplicate outbound text suppressed')) return true;
  if (msg.includes('[ProviderRoute] Duplicate inbound ignored via key cache')) return true;
  if (msg.includes('[ProviderRoute] Contextual numeric selection applied')) return true;

  // Auth tests may intentionally exercise failures/successes.
  if (msg.includes('[Auth] Successful login')) return true;
  if (msg.includes('[Auth] Failed login attempt')) return true;

  // RAG in test env often warns about missing OPENAI key.
  if (msg.includes('[RAG] OPENAI_API_KEY tidak dikonfigurasi')) return true;

  return false;
}

function wrap(fn) {
  return (...args) => {
    if (shouldSuppressConsoleMessage(args)) return;
    return fn(...args);
  };
}

beforeAll(() => {
  console.log = wrap(original.log);
  console.info = wrap(original.info);
  console.warn = wrap(original.warn);
  console.error = wrap(original.error);
});

afterAll(() => {
  console.log = original.log;
  console.info = original.info;
  console.warn = original.warn;
  console.error = original.error;
});
