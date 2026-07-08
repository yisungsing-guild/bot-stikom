const DIRECT_ROUTE_TYPES = new Set(['system', 'menu', 'navigation', 'deterministic']);

function normalizeRouteType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (['system', 'menu', 'navigation', 'deterministic', 'hybrid', 'conversational'].includes(normalized)) {
    return normalized;
  }
  if (normalized === 'intro') return 'system';
  if (normalized === 'unknown') return null;
  return null;
}

function classifyResponseRoute(input = {}) {
  const opts = input && typeof input === 'object' ? input : {};
  const source = String(opts.source || 'legacy').trim();
  const sourceType = String(opts.sourceType || '').trim().toLowerCase();
  const responseMode = String(opts.responseMode || 'conversational').trim().toLowerCase();
  const directReason = String(opts.directReason || opts.triggerReason || '').trim().toLowerCase();
  const messageText = String(opts.messageText || opts.text || (opts.ruleReply && opts.ruleReply.text) || (opts.ragResult && opts.ragResult.answer) || '').trim();

  const explicitRouteType = normalizeRouteType(opts.routeType || opts.routeCategory || sourceType);
  let routeType = explicitRouteType;

  const directReasonHints = [
    'intro',
    'otp',
    'system',
    'alert',
    'handover',
    'admin',
    'menu',
    'navigation',
    'schedule',
    'study_mode',
    'study-mode',
    'double_degree_process',
    'non_marketing',
    'numeric_menu',
    'db_menu',
    'deterministic',
    'contact'
  ];

  const text = messageText.toLowerCase();
  const looksLikeMenu = /\b(menu pmb|pilih nomor|silakan pilih|bantuan\s*\/\s*kontak admin|kontak admin|info yang mana|menu:)\b/i.test(messageText)
    || /^\s*[-*]?\s*\d+\)/.test(messageText)
    || /\bkalender pendaftaran pmb\b/i.test(messageText)
    || /\bjadwal gelombang\b/i.test(messageText)
    || /\bkontak admin\b/i.test(messageText);
  const looksLikeSystemPrompt = /\b(silakan kirim pertanyaannya|tulis pertanyaannya saja|yang dimaksud yang mana|gelombangnya yang mana|biayanya yang mana|program dual degree yang mana|baru atau transfer)\b/i.test(messageText)
    || /\bsiap, saya aktif kembali sebagai bot\b/i.test(messageText)
    || /\bmaaf, saya hanya bisa menjawab seputaran stikom bali\b/i.test(messageText)
    || /\bpermintaan ke admin sudah diterima\b/i.test(messageText)
    || /\boke\.\b/i.test(messageText);

  if (!routeType) {
    if (source === 'intro') routeType = 'system';
    else if (responseMode === 'deterministic') routeType = 'deterministic';
    else if (sourceType === 'system') routeType = 'system';
    else if (directReasonHints.some((hint) => directReason.includes(hint))) {
      if (directReason.includes('menu') || looksLikeMenu) routeType = 'menu';
      else if (directReason.includes('navigation') || directReason.includes('schedule')) routeType = 'navigation';
      else routeType = 'system';
    } else if (looksLikeMenu) {
      routeType = 'menu';
    } else if (looksLikeSystemPrompt) {
      routeType = 'system';
    } else if (opts.pendingStateMatched || opts.menuOverrideDecision || opts.numericIntentSource) {
      routeType = 'hybrid';
    } else if (opts.ruleReply || opts.ragResult) {
      routeType = 'hybrid';
    } else {
      routeType = 'conversational';
    }
  }

  if (routeType === 'deterministic' && !opts.routeType && (looksLikeMenu || looksLikeSystemPrompt)) {
    routeType = looksLikeMenu ? 'menu' : 'system';
  }

  const bypassComposer = DIRECT_ROUTE_TYPES.has(routeType) || routeType === 'deterministic';
  const conversational = routeType === 'conversational' || routeType === 'hybrid';
  const triggerReason = directReason || (source === 'intro' ? 'intro' : routeType);

  return {
    source,
    sourceType: sourceType || null,
    responseMode,
    routeType,
    bypassComposer,
    conversational,
    triggerReason,
    directReason: directReason || null,
    messageText,
    numericIntentSource: opts.numericIntentSource || null,
    pendingStateMatched: !!opts.pendingStateMatched,
    menuOverrideDecision: opts.menuOverrideDecision || null,
    ruleReply: opts.ruleReply || null,
    ragResult: opts.ragResult || null
  };
}

function shouldBypassComposer(route) {
  return !!route && !!route.bypassComposer;
}

function isConversationalFlow(route) {
  return !!route && !!route.conversational;
}

module.exports = {
  classifyResponseRoute,
  shouldBypassComposer,
  isConversationalFlow
};