const REGISTRATION_PENDING_KEYS = [
  'pendingFeeBreakdownOffer',
  'pendingProgramSelection',
  'pendingFeeDetail',
  'pendingRegistrationCostOffer',
  'pendingMenuCost',
  'pendingPmbMenu',
  'pendingFollowupChoice',
  'pendingScholarshipChoice',
  'pendingAdmissionApplicantType',
  'pendingProgramInfoMenu',
  'pendingTotalCost',
  'pendingScheduleWave',
  'pendingWaveClarification',
  'pendingNonMarketingDeptContact'
];

// Simple guarded debug logger for lifecycle events. Enable with LIFECYCLE_DEBUG=1.
function lifecycleDebug(...args) {
  try {
    const enabled = String(process.env.LIFECYCLE_DEBUG || '').trim();
    if (!enabled || !/^(1|true)$/i.test(enabled)) return;
    // Use console.debug to avoid interfering with normal logger in production.
    console.debug('[lifecycle-debug]', ...args);
  } catch (e) {
    // swallow logging errors
  }
}

function cloneSessionData(sessionData) {
  return { ...(sessionData && typeof sessionData === 'object' ? sessionData : {}) };
}

function clearRegistrationPendingState(sessionData, opts = {}) {
  const next = cloneSessionData(sessionData);
  const preserveKeys = new Set(Array.isArray(opts.preserveKeys) ? opts.preserveKeys : []);

  const removed = [];
  for (const key of REGISTRATION_PENDING_KEYS) {
    if (preserveKeys.has(key)) continue;
    if (Object.prototype.hasOwnProperty.call(next, key)) {
      removed.push(key);
      delete next[key];
    }
  }

  if (removed.length) lifecycleDebug('clearRegistrationPendingState removed', removed, 'preserveKeys', Array.from(preserveKeys));

  return next;
}

function setPendingRegistrationState(sessionData, pendingKey, payload = {}, opts = {}) {
  const next = clearRegistrationPendingState(sessionData, opts);
  next[pendingKey] = Object.assign({ ts: new Date().toISOString() }, payload || {});
  lifecycleDebug('setPendingRegistrationState', pendingKey, 'payload', payload, 'opts', opts);
  return next;
}

function setPendingProgramSelection(sessionData, payload = {}, opts = {}) {
  return setPendingRegistrationState(sessionData, 'pendingProgramSelection', payload, opts);
}

function clearPendingProgramSelection(sessionData, opts = {}) {
  return clearRegistrationPendingState(sessionData, {
    ...opts,
    preserveKeys: Array.from(new Set([
      ...(Array.isArray(opts.preserveKeys) ? opts.preserveKeys : []),
      ...REGISTRATION_PENDING_KEYS.filter((key) => key !== 'pendingProgramSelection')
    ]))
  });
}

function setPendingAdmissionApplicantType(sessionData, payload = {}, opts = {}) {
  return setPendingRegistrationState(sessionData, 'pendingAdmissionApplicantType', payload, opts);
}

function clearPendingAdmissionApplicantType(sessionData, opts = {}) {
  return clearRegistrationPendingState(sessionData, {
    ...opts,
    preserveKeys: Array.from(new Set([
      ...(Array.isArray(opts.preserveKeys) ? opts.preserveKeys : []),
      ...REGISTRATION_PENDING_KEYS.filter((key) => key !== 'pendingAdmissionApplicantType')
    ]))
  });
}

function setPendingMenuCost(sessionData, payload = {}, opts = {}) {
  return setPendingRegistrationState(sessionData, 'pendingMenuCost', payload, opts);
}

function clearPendingMenuCost(sessionData, opts = {}) {
  return clearRegistrationPendingState(sessionData, {
    ...opts,
    preserveKeys: Array.from(new Set([
      ...(Array.isArray(opts.preserveKeys) ? opts.preserveKeys : []),
      ...REGISTRATION_PENDING_KEYS.filter((key) => key !== 'pendingMenuCost')
    ]))
  });
}

function setPendingScheduleWave(sessionData, payload = {}, opts = {}) {
  return setPendingRegistrationState(sessionData, 'pendingScheduleWave', payload, opts);
}

function clearPendingScheduleWave(sessionData, opts = {}) {
  return clearRegistrationPendingState(sessionData, {
    ...opts,
    preserveKeys: Array.from(new Set([
      ...(Array.isArray(opts.preserveKeys) ? opts.preserveKeys : []),
      ...REGISTRATION_PENDING_KEYS.filter((key) => key !== 'pendingScheduleWave')
    ]))
  });
}

function setPendingFollowupChoice(sessionData, payload = {}, opts = {}) {
  lifecycleDebug('setPendingFollowupChoice call', payload, opts);
  return setPendingRegistrationState(sessionData, 'pendingFollowupChoice', payload, opts);
}

function clearPendingFollowupChoice(sessionData, opts = {}) {
  lifecycleDebug('clearPendingFollowupChoice call', opts);
  return clearRegistrationPendingState(sessionData, {
    ...opts,
    preserveKeys: Array.from(new Set([
      ...(Array.isArray(opts.preserveKeys) ? opts.preserveKeys : []),
      ...REGISTRATION_PENDING_KEYS.filter((key) => key !== 'pendingFollowupChoice')
    ]))
  });
}

// TTL check for pendingFollowupChoice
// Centralized TTL semantics (moved from provider.js line 6487-6488)
// Returns true if pendingFollowupChoice exists AND is fresh (within maxAgeMins)
// Default maxAgeMins: 30 (configurable via env PENDING_FOLLOWUP_CHOICE_TTL_MINS)
function isPendingFollowupChoiceFresh(pendingFollowupChoice, nowMs = null) {
  if (!pendingFollowupChoice || typeof pendingFollowupChoice !== 'object') {
    lifecycleDebug('isPendingFollowupChoiceFresh: no pending object');
    return false;
  }
  
  const ts = pendingFollowupChoice && pendingFollowupChoice.ts ? String(pendingFollowupChoice.ts) : null;
  if (!ts) return false;
  
  const tsDate = new Date(ts);
  if (Number.isNaN(tsDate.getTime())) return false;
  
  const now = nowMs !== null ? nowMs : Date.now();
  const ttlMinsRaw = parseInt(process.env.PENDING_FOLLOWUP_CHOICE_TTL_MINS || '30', 10);
  const ttlMins = (Number.isFinite(ttlMinsRaw) && ttlMinsRaw > 0) ? ttlMinsRaw : 30;
  const ttlMs = ttlMins * 60 * 1000;
  
  const fresh = ((now - tsDate.getTime()) <= ttlMs);
  if (!fresh) lifecycleDebug('isPendingFollowupChoiceFresh: expired', { ts: tsDate.toISOString(), now: new Date(now).toISOString(), ttlMins });
  else lifecycleDebug('isPendingFollowupChoiceFresh: fresh', { ts: tsDate.toISOString(), now: new Date(now).toISOString(), ttlMins });
  return fresh;
}

module.exports = {
  REGISTRATION_PENDING_KEYS,
  clearRegistrationPendingState,
  setPendingRegistrationState,
  setPendingProgramSelection,
  clearPendingProgramSelection,
  setPendingAdmissionApplicantType,
  clearPendingAdmissionApplicantType,
  setPendingMenuCost,
  clearPendingMenuCost,
  setPendingScheduleWave,
  clearPendingScheduleWave,
  setPendingFollowupChoice,
  clearPendingFollowupChoice,
  isPendingFollowupChoiceFresh
};