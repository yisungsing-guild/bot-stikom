const prisma = require('../db');

function normalizeForKeywordMatch(input) {
  let s = String(input || '');
  if (!s) return '';

  // Normalize casing and unicode (best-effort).
  s = s.toLowerCase();
  try {
    if (typeof s.normalize === 'function') s = s.normalize('NFKD');
  } catch {
    // ignore
  }

  // Strip diacritics (best-effort, Node supports this in modern runtimes).
  try {
    s = s.replace(/\p{Diacritic}+/gu, '');
  } catch {
    // ignore (older runtimes without unicode property escapes)
  }

  // Replace punctuation/symbols with spaces so keyword exact/contains isn't sensitive to "?" "," etc.
  try {
    s = s.replace(/[^\p{L}\p{N}]+/gu, ' ');
  } catch {
    s = s.replace(/[^a-z0-9]+/g, ' ');
  }

  s = s.replace(/\s{2,}/g, ' ').trim();

  // Common Indonesian chat typos/shorthands (keep conservative).
  // Examples:
  // - "brapakah" -> "berapakah"
  // - "brp" / "brapa" -> "berapa"
  s = s
    .replace(/\bbrapakah\b/g, 'berapakah')
    .replace(/\bbrapa\b/g, 'berapa')
    .replace(/\bbrp\b/g, 'berapa');

  return s;
}

function normalizeForKeywordMatchLoose(input) {
  // Starts from the basic normalizer (punctuation + typos), then applies
  // a tiny set of synonym/stemming rules to make keyword matching more forgiving.
  let s = normalizeForKeywordMatch(input);
  if (!s) return '';

  // Very light stemming for common registration word variants.
  // Helps keywords like "biaya pendaftaran" match user phrases like "biaya mendaftar".
  s = s
    .replace(/\bmendaftar\b/g, 'daftar')
    .replace(/\bpendaftaran\b/g, 'daftar');

  return s;
}

function parseCacheTtlMs() {
  const raw = process.env.KEYWORD_RULES_CACHE_TTL_MS;
  if (raw === undefined || raw === null) return 5000;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 0) return 5000;
  return n;
}

let cachedCompiled = null;
let cachedExpiresAt = 0;

function escapeRegexLiteral(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compileRulesForFastMatch(rules) {
  const compiled = {
    exact: [],
    starts_with: [],
    contains: [],
    regex: [],
  };

  const list = Array.isArray(rules) ? rules : [];
  for (const rule of list) {
    if (!rule || rule.active === false) continue;
    const mt = String(rule.matchType || '').toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(compiled, mt)) continue;

    const keyword = String(rule.keyword || '');
    const keywordLower = keyword.trim().toLowerCase();
    const keywordNorm = normalizeForKeywordMatch(keyword);
    const keywordNormLoose = normalizeForKeywordMatchLoose(keyword);


    if (mt === 'regex') {
      if (!keyword) continue;
      try {
        const re = new RegExp(keyword, 'i');
        compiled.regex.push({ keyword, response: rule.response, priority: rule.priority, re });
      } catch (err) {
        // Best-effort: admins sometimes select matchType=regex but paste a plain sentence
        // containing regex-special chars like "?". In that case, treat it as a literal.
        try {
          const escaped = escapeRegexLiteral(keyword);
          const re2 = new RegExp(escaped, 'i');
          compiled.regex.push({ keyword, response: rule.response, priority: rule.priority, re: re2, literalEscaped: true });
          console.warn(`[findReplyByRules] ⚠ Invalid regex treated as literal: "${keyword}"`);
        } catch (e2) {
          console.error(`[findReplyByRules] ✗ Invalid regex: "${keyword}" - ${err && err.message ? err.message : String(err)}`);
        }
      }
      continue;
    }

        if (!keywordLower && !keywordNorm && !keywordNormLoose) continue;
    compiled[mt].push({ keyword, keywordLower, keywordNorm, keywordNormLoose, response: rule.response, priority: rule.priority });
  }

  return compiled;
}

async function getCompiledActiveRules() {
  // Defensive: some runtimes/tests may not provide keywordReply on prisma.
  if (!prisma || !prisma.keywordReply || typeof prisma.keywordReply.findMany !== 'function') return null;

  const ttlMs = parseCacheTtlMs();
  const now = Date.now();
  if (cachedCompiled && ttlMs > 0 && now < cachedExpiresAt) return cachedCompiled;

  const allActive = await prisma.keywordReply.findMany({
    where: { active: true },
    orderBy: { priority: 'desc' },
  });

  const compiled = compileRulesForFastMatch(allActive);
  cachedCompiled = compiled;
  cachedExpiresAt = ttlMs > 0 ? (now + ttlMs) : 0;
  return compiled;
}

async function findReplyByRules(text, options) {
  const includeFallback = !!(options && options.includeFallback);
  const lowered = String(text || '').trim().toLowerCase();
  const normalized = normalizeForKeywordMatch(text);
  const normalizedLoose = normalizeForKeywordMatchLoose(text);

  // Defensive: some runtimes/tests may not provide keywordReply on prisma.
  const compiled = await getCompiledActiveRules().catch(() => null);
  if (!compiled) {
    if (includeFallback && prisma && prisma.setting && typeof prisma.setting.findUnique === 'function') {
      const fallback = await prisma.setting.findUnique({ where: { key: 'fallback_message' } });
      return fallback ? fallback.value : null;
    }
    return null;
  }

    
  // Precedence is intentional: exact > starts_with > contains > regex
  for (const rule of compiled.exact) {
    if (
      (rule.keywordLower && rule.keywordLower === lowered) ||
      (rule.keywordNorm && rule.keywordNorm === normalized) ||
      (rule.keywordNormLoose && rule.keywordNormLoose === normalizedLoose)
    ) {
      console.log(`[findReplyByRules] ✓ Exact match: "${rule.keyword}" (priority ${rule.priority})`);
      return rule.response;
    }
  }

    for (const rule of compiled.starts_with) {
    if (
      (rule.keywordLower && lowered.startsWith(rule.keywordLower)) ||
      (rule.keywordNorm && normalized.startsWith(rule.keywordNorm)) ||
      (rule.keywordNormLoose && normalizedLoose.startsWith(rule.keywordNormLoose))
    ) {
      console.log(`[findReplyByRules] ✓ Starts-with match: "${rule.keyword}" (priority ${rule.priority})`);
      return rule.response;
    }
  }

    for (const rule of compiled.contains) {
    if (
      (rule.keywordLower && lowered.includes(rule.keywordLower)) ||
      (rule.keywordNorm && normalized.includes(rule.keywordNorm)) ||
      (rule.keywordNormLoose && normalizedLoose.includes(rule.keywordNormLoose))
    ) {
      console.log(`[findReplyByRules] ✓ Contains match: "${rule.keyword}" (priority ${rule.priority})`);
      return rule.response;
    }
  }

  for (const rule of compiled.regex) {
    try {
      if (rule.re && (rule.re.test(text) || (normalized && rule.re.test(normalized)) || (normalizedLoose && rule.re.test(normalizedLoose)))) {
        const label = rule.literalEscaped ? 'Regex(literal)' : 'Regex';
        console.log(`[findReplyByRules] ✓ ${label} match: /${rule.keyword}/ (priority ${rule.priority})`);
        return rule.response;
      }
    } catch {
      // ignore
    }
  }

  if (includeFallback) {
    console.log('[findReplyByRules] No keyword match found, using fallback');
    const fallback = await prisma.setting.findUnique({ where: { key: 'fallback_message' } });
    return fallback ? fallback.value : null;
  }

  console.log('[findReplyByRules] No keyword match found');
  return null;
}

module.exports = { findReplyByRules };
