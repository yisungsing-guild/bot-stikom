const COMPOSE_PAYLOAD_KEYS = [
  'userQuery',
  'normalized',
  'intent',
  'retrievals',
  'ruleReply',
  'session',
  'answerMeta'
];

const TELEMETRY_KEYS = [
  'sentViaComposer',
  'sourceType',
  'finalPipeline',
  'contextReused',
  'reflectionUsed',
  'followupUsed',
  'clarificationUsed',
  'duplicateSendPrevented'
];

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeIntent(intent) {
  if (!isPlainObject(intent)) {
    return { label: 'GENERAL', confidence: 0 };
  }

  return {
    label: String(intent.label || 'GENERAL'),
    confidence: Number.isFinite(Number(intent.confidence)) ? Number(intent.confidence) : 0
  };
}

function normalizeComposePayload(payload) {
  const safePayload = isPlainObject(payload) ? payload : {};
  return {
    userQuery: String(safePayload.userQuery || '').trim(),
    normalized: String(safePayload.normalized || safePayload.userQuery || '').trim(),
    intent: normalizeIntent(safePayload.intent),
    retrievals: Array.isArray(safePayload.retrievals) ? safePayload.retrievals : [],
    ruleReply: safePayload.ruleReply === null ? null : (isPlainObject(safePayload.ruleReply) ? safePayload.ruleReply : { text: String(safePayload.ruleReply || '') }),
    session: isPlainObject(safePayload.session) ? safePayload.session : {},
    answerMeta: isPlainObject(safePayload.answerMeta) ? safePayload.answerMeta : {}
  };
}

function assertValidComposePayload(payload) {
  const normalized = normalizeComposePayload(payload);
  const errors = [];

  if (typeof normalized.userQuery !== 'string') errors.push('userQuery must be a string');
  if (typeof normalized.normalized !== 'string') errors.push('normalized must be a string');
  if (!isPlainObject(normalized.intent)) errors.push('intent must be an object');
  if (typeof normalized.intent.label !== 'string' || !normalized.intent.label.trim()) errors.push('intent.label must be a non-empty string');
  if (typeof normalized.intent.confidence !== 'number' || Number.isNaN(normalized.intent.confidence)) errors.push('intent.confidence must be a valid number');
  if (!Array.isArray(normalized.retrievals)) errors.push('retrievals must be an array');
  if (!(normalized.ruleReply === null || isPlainObject(normalized.ruleReply))) errors.push('ruleReply must be null or an object');
  if (!isPlainObject(normalized.session)) errors.push('session must be an object');
  if (!isPlainObject(normalized.answerMeta)) errors.push('answerMeta must be an object');

  if (errors.length) {
    throw new Error(`Invalid compose payload: ${errors.join('; ')}`);
  }

  return normalized;
}

function assertStandardTelemetry(telemetry) {
  if (!isPlainObject(telemetry)) {
    throw new Error('Telemetry payload must be an object');
  }

  const errors = [];
  if (typeof telemetry.sentViaComposer !== 'boolean') errors.push('sentViaComposer must be boolean');
  if (telemetry.sourceType !== null && typeof telemetry.sourceType !== 'string') errors.push('sourceType must be string or null');
  if (telemetry.finalPipeline !== null && typeof telemetry.finalPipeline !== 'string') errors.push('finalPipeline must be string or null');
  if (typeof telemetry.contextReused !== 'boolean') errors.push('contextReused must be boolean');
  if (typeof telemetry.reflectionUsed !== 'boolean') errors.push('reflectionUsed must be boolean');
  if (typeof telemetry.followupUsed !== 'boolean') errors.push('followupUsed must be boolean');
  if (typeof telemetry.clarificationUsed !== 'boolean') errors.push('clarificationUsed must be boolean');
  if (typeof telemetry.duplicateSendPrevented !== 'boolean') errors.push('duplicateSendPrevented must be boolean');

  if (errors.length) {
    throw new Error(`Invalid telemetry payload: ${errors.join('; ')}`);
  }

  return telemetry;
}

function warnOnMissingTelemetryFields(telemetry, logger) {
  if (!isPlainObject(telemetry) || !logger || typeof logger.warn !== 'function') return;
  const missing = TELEMETRY_KEYS.filter((key) => telemetry[key] === undefined);
  if (missing.length) {
    logger.warn({ missing, telemetryKeys: Object.keys(telemetry) }, '[ComposerContract] Missing telemetry keys');
  }
}

module.exports = {
  COMPOSE_PAYLOAD_KEYS,
  TELEMETRY_KEYS,
  normalizeComposePayload,
  assertValidComposePayload,
  assertStandardTelemetry,
  warnOnMissingTelemetryFields
};
