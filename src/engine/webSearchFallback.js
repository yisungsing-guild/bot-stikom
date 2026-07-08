const axios = require('axios');
const { URL } = require('url');
const logger = require('../logger');

const {
  normalizeUrl,
  htmlToText,
  parseContentSignal,
  extractTitle
} = require('./webIngest');

const cacheByHost = new Map(); // host -> { atMs, pages: [{ url, title, text }] }

function isObviouslyPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
  // IP-literal basic blocks (best-effort; does not resolve DNS)
  if (/^(10\.|192\.168\.|169\.254\.)/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
  if (h.startsWith('0.') || h === '0.0.0.0') return true;
  return false;
}

function webSearchHostAllowed(urlObj) {
  const hostname = String(urlObj && urlObj.hostname ? urlObj.hostname : '').toLowerCase();
  if (isObviouslyPrivateHost(hostname)) return false;
  // For web fallback, do NOT depend on TRAINING_URL_ALLOWLIST.
  // This feature has its own allowlist (WEB_SEARCH_ALLOWLIST) and should keep working
  // even when training URL ingest is locked down.
  return hostInAllowlist(hostname);
}

async function fetchHtmlWebSearch(urlObj) {
  const timeoutMs = parseInt(process.env.URL_INGEST_TIMEOUT_MS || '15000', 10);
  const maxBytes = parseInt(process.env.URL_INGEST_MAX_BYTES || String(2 * 1024 * 1024), 10);
  const maxRedirects = parseInt(process.env.URL_INGEST_MAX_REDIRECTS || '3', 10);
  const followRedirects = String(process.env.URL_INGEST_FOLLOW_REDIRECTS || 'true').toLowerCase() !== 'false';
  const safeMaxRedirects = Number.isFinite(maxRedirects) && maxRedirects >= 0 && maxRedirects <= 10 ? maxRedirects : 3;

  const headers = {
    'User-Agent': process.env.URL_INGEST_USER_AGENT || 'system_wa-bot/1.0 (+web-fallback)'
  };

  const requestOnce = async (u) => {
    return await axios.get(u.toString(), {
      timeout: timeoutMs,
      maxContentLength: maxBytes,
      maxBodyLength: maxBytes,
      responseType: 'text',
      headers,
      // Prevent axios from auto-following redirects so we can validate each hop.
      maxRedirects: 0,
      validateStatus: (s) => s >= 200 && s < 400
    });
  };

  let current = urlObj;
  for (let i = 0; i <= (followRedirects ? safeMaxRedirects : 0); i++) {
    if (!webSearchHostAllowed(current)) {
      throw new Error('Host not allowed');
    }

    const resp = await requestOnce(current);

    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers ? resp.headers.location : null;
      if (!loc) throw new Error('Redirect without Location header');
      if (!followRedirects) throw new Error('Redirects disabled');

      const next = new URL(String(loc), current);
      if (!/^https?:$/.test(next.protocol)) throw new Error('Only http/https URLs are allowed');
      next.hash = '';

      if (i === safeMaxRedirects) throw new Error('Too many redirects');
      current = next;
      continue;
    }

    return String(resp.data || '');
  }

  throw new Error('Failed to fetch URL');
}

async function fetchRobotsTxtWebSearch(siteUrl) {
  const base = new URL(siteUrl);
  base.pathname = '/robots.txt';
  base.search = '';
  base.hash = '';

  try {
    return await fetchHtmlWebSearch(base);
  } catch (e) {
    return '';
  }
}

function hostInAllowlist(hostname) {
  const allowlist = String(process.env.WEB_SEARCH_ALLOWLIST || 'www.stikom-bali.ac.id')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  const h = String(hostname || '').toLowerCase();
  if (!h) return false;

  return allowlist.some(allowed => h === allowed || h.endsWith('.' + allowed));
}

function buildUnavailableFallbackMessage() {
  return [
    'Maaf, data yang Anda minta tidak tersedia pada sumber yang kami miliki.',
    '',
    'Coba periksa kembali detail pertanyaannya (mis. nama program studi, gelombang, atau topik yang dimaksud),',
    'atau hubungi admin jika ingin bantuan lebih lanjut.',
    '',
    '[ Hubungi Admin ]',
    '',
    'Agar saya bisa membantu lebih baik, coba tuliskan pertanyaan dengan lebih spesifik.'
  ].join('\n');
}

async function isSearchAllowedByRobots(siteUrl) {
  try {
    const u = new URL(siteUrl);
    u.pathname = '/';
    u.search = '';
    u.hash = '';

    const robots = await fetchRobotsTxtWebSearch(u.toString());
    const signal = parseContentSignal(robots);

    // If explicitly disallowed, block.
    if (signal.map && signal.map.search === 'no') {
      return { allowed: false, reason: 'robots.txt Content-Signal declares search=no', contentSignal: signal.raw };
    }

    // If explicitly allowed, ok.
    if (signal.map && signal.map.search === 'yes') {
      return { allowed: true, reason: 'search=yes', contentSignal: signal.raw };
    }

    // If no signal, be conservative and disable (can be overridden by env).
    const allowIfMissing = String(process.env.WEB_SEARCH_ALLOW_IF_MISSING_SIGNAL || 'false').toLowerCase() === 'true';
    if (allowIfMissing) {
      return { allowed: true, reason: 'no Content-Signal; allowed by override', contentSignal: signal.raw || '' };
    }

    return { allowed: false, reason: 'robots.txt does not explicitly allow search=yes', contentSignal: signal.raw || '' };
  } catch (e) {
    return { allowed: false, reason: e.message || 'Failed to check robots.txt', contentSignal: '' };
  }
}

function extractRelevantSnippets(text, intent, question = '') {
  const t = String(text || '');
  if (!t) return [];

  const lines = t
    .split(/\n+/)
    .map(l => l.trim())
    .filter(Boolean)
    .filter(l => l.length >= 6)
    .slice(0, 2000); // cap scanning

  const scored = [];

  const add = (line, score) => {
    const clean = line.replace(/\s{2,}/g, ' ').trim();
    if (!clean) return;
    if (clean.length > 240) return; // keep excerpts short
    scored.push({ line: clean, score });
  };

  for (const line of lines) {
    const lower = line.toLowerCase();

    // Common signals
    const hasPhone = /(\+?62|\b0\d{2,3})[\s-]?\d{3,4}[\s-]?\d{3,4}/.test(lower) || /telp|telepon|phone|whatsapp|wa\b/.test(lower);
    const hasEmail = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(line) || /email|e-mail/.test(lower);
    const hasAddress = /\b(jl\.|jalan|street|no\.|nomor|denpasar|bali|kode\s*pos|kec\.|kab\.|prov)\b/i.test(line);
    const hasMaps = /maps|google\s*maps|lokasi|alamat/i.test(lower);

    if (intent === 'contact') {
      let score = 0;
      if (hasPhone) score += 3;
      if (hasEmail) score += 3;
      if (hasAddress) score += 2;
      if (/(kontak|hubungi|contact)/i.test(lower)) score += 2;
      if (score > 0) add(line, score);
      continue;
    }

    if (intent === 'location') {
      let score = 0;
      if (hasAddress) score += 4;
      if (hasMaps) score += 2;
      if (/(kampus|lokasi|alamat)/i.test(lower)) score += 2;
      if (score > 0) add(line, score);
      continue;
    }

    if (intent === 'phone') {
      if (hasPhone) add(line, 5);
      continue;
    }

    if (intent === 'email') {
      if (hasEmail) add(line, 5);
      continue;
    }

    if (intent === 'academics') {
      let score = 0;

      // Primary: faculty list often appears in nav/menu.
      if (/\bfakultas\b/i.test(lower)) score += 6;
      if (/\bprogram\s+pascasarjana\b/i.test(lower)) score += 3;
      if (/\bmagister\b|\bS2\b/i.test(line)) score += 2;
      if (/\bakademik\b/i.test(lower)) score += 1;

      // Nudge scoring when the user actually asks about faculties.
      if (/\bfakultas\b/i.test(String(question || '').toLowerCase()) && /\bfakultas\b/i.test(lower)) score += 3;

      // Avoid very generic labels.
      if (score > 0) {
        const clean = line.replace(/\s{2,}/g, ' ').trim();
        if (/\bfakultas\b/i.test(clean) && clean.length >= 16) add(clean, score);
      }
      continue;
    }

    if (intent === 'about') {
      let score = 0;
      if (/\bvisi\b/i.test(lower)) score += 4;
      if (/\bmisi\b/i.test(lower)) score += 4;
      if (/\btujuan\b/i.test(lower)) score += 2;
      if (score > 0) add(line, score);
      continue;
    }
  }

  scored.sort((a, b) => b.score - a.score);

  // Dedup by exact line
  const out = [];
  const seen = new Set();
  for (const s of scored) {
    if (seen.has(s.line)) continue;
    seen.add(s.line);
    out.push(s.line);
    if (out.length >= (intent === 'academics' ? 6 : 3)) break;
  }

  return out;
}

function splitParagraphs(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  return t
    .split(/\n{2,}/)
    .map(p => p.replace(/\s{2,}/g, ' ').trim())
    .filter(Boolean)
    .filter(p => p.length >= 30)
    .map(p => (p.length > 350 ? p.slice(0, 347) + '...' : p));
}

function tokenizeQuery(question) {
  const q = String(question || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!q) return [];

  const stop = new Set([
    'yang', 'dan', 'atau', 'di', 'ke', 'dari', 'untuk', 'dengan', 'apa', 'itu', 'ini', 'itu',
    'kak', 'min', 'dong', 'ya', 'yaa', 'yah', 'nih', 'nya', 'gimana', 'bagaimana',
    'berapa', 'kapan', 'dimana', 'mana', 'tolong', 'mohon', 'saya', 'kami'
  ]);

  const parts = q.split(' ').filter(Boolean);
  const tokens = [];
  for (const p of parts) {
    if (p.length < 3) continue;
    if (stop.has(p)) continue;
    tokens.push(p);
  }

  // Add multi-word phrases that commonly appear
  if (q.includes('program studi')) tokens.push('program studi');
  if (q.includes('bisnis digital')) tokens.push('bisnis digital');
  if (q.includes('teknologi informasi')) tokens.push('teknologi informasi');
  if (q.includes('sistem informasi')) tokens.push('sistem informasi');
  if (q.includes('sistem komputer')) tokens.push('sistem komputer');
  if (q.includes('manajemen informatika')) tokens.push('manajemen informatika');
  if (q.includes('dual degree')) tokens.push('dual degree');

  return Array.from(new Set(tokens)).slice(0, 12);
}

function scoreParagraph(paragraph, tokens) {
  const p = String(paragraph || '').toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (!t) continue;
    if (t.includes(' ')) {
      if (p.includes(t)) score += 4;
    } else {
      // word-ish match
      if (new RegExp(`\\b${t.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'i').test(p)) score += 2;
    }
  }
  return score;
}

function extractLinksFromHtml(html, baseUrl) {
  const raw = String(html || '');
  if (!raw) return [];

  const out = [];
  const re = /<a\s+[^>]*href\s*=\s*("([^"]+)"|'([^']+)'|([^\s>]+))/gi;
  let m;
  while ((m = re.exec(raw))) {
    const href = (m[2] || m[3] || m[4] || '').trim();
    if (!href) continue;
    if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;
    try {
      const u = new URL(href, baseUrl);
      u.hash = '';
      out.push(u.toString());
    } catch (e) {
      // ignore
    }
  }

  return Array.from(new Set(out));
}

function urlLooksLikeContent(urlObj) {
  try {
    const p = String(urlObj && urlObj.pathname ? urlObj.pathname : '').toLowerCase();
    if (!p.startsWith('/id/')) return false;
    if (p === '/id' || p === '/id/') return true;
    if (/\.(jpg|jpeg|png|gif|webp|svg|css|js|zip|rar|7z|mp4|mp3|pdf)$/i.test(p)) return false;
    if (p.includes('/wp-json/')) return false;
    return true;
  } catch (e) {
    return false;
  }
}

function scoreUrlForTokens(urlString, tokens) {
  const ul = String(urlString || '').toLowerCase();
  let score = 0;
  for (const t of tokens || []) {
    if (!t) continue;
    if (t.includes(' ')) {
      if (ul.includes(t)) score += 4;
    } else {
      if (ul.includes(t)) score += 2;
    }
  }
  if (ul.includes('/tag/')) score -= 3;
  if (ul.includes('/category/')) score -= 2;
  if (ul.includes('/page/')) score -= 2;
  if (ul.includes('/author/')) score -= 2;
  return score;
}

function pickCandidateLinks(urls, baseHost, question) {
  const q = String(question || '').toLowerCase();
  const keywords = [];
  if (/visi|misi/.test(q)) keywords.push('visi', 'misi');
  if (/fakultas|jurusan|prodi|program\s*studi/.test(q)) keywords.push('fakultas', 'jurusan', 'prodi', 'program');
  // Add query tokens so this works for general questions too.
  const tokens = tokenizeQuery(question);
  for (const t of tokens) keywords.push(t);

  // Always include a small number of /id/ pages for discovery
  const max = parseInt(process.env.WEB_SEARCH_MAX_PAGES || '10', 10);

  const scored = [];
  for (const u of urls) {
    try {
      const parsed = new URL(u);
      if (String(parsed.hostname || '').toLowerCase() !== String(baseHost || '').toLowerCase()) continue;
      if (!urlLooksLikeContent(parsed)) continue;

      const ul = u.toLowerCase();
      let score = 0;
      for (const k of keywords) {
        if (ul.includes(k)) score += 5;
      }
      // deprioritize feeds, tags, archives
      if (ul.includes('/tag/')) score -= 3;
      if (ul.includes('/category/')) score -= 2;
      if (ul.includes('/page/')) score -= 2;
      scored.push({ u, score });
    } catch (e) {
      // ignore
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const s of scored) {
    picked.push(s.u);
    if (picked.length >= max) break;
  }

  return picked;
}

async function loadPagesIndex(seedUrl, question) {
  const seed = normalizeUrl(seedUrl);
  const host = String(seed.hostname || '').toLowerCase();
  const ttlMs = parseInt(process.env.WEB_SEARCH_CACHE_TTL_MS || String(6 * 60 * 60 * 1000), 10);
  const nowMs = Date.now();

  const cached = cacheByHost.get(host);
  if (cached && cached.atMs && (nowMs - cached.atMs) < ttlMs && Array.isArray(cached.pages) && cached.pages.length) {
    return cached.pages;
  }

  const maxPages = parseInt(process.env.WEB_SEARCH_MAX_PAGES || '10', 10);
  const delayMs = parseInt(process.env.WEB_SEARCH_DELAY_MS || '150', 10);

  const seedUrlsEnv = String(process.env.WEB_SEARCH_SEED_URLS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const initialUrls = Array.from(
    new Set([seed.toString(), ...seedUrlsEnv])
  );

  const pages = [];
  const visited = new Set();
  let queue = [];

  const tokens = tokenizeQuery(question);

  const enqueue = (urls, base) => {
    for (const u of urls || []) {
      try {
        const nu = new URL(u, base);
        nu.hash = '';
        if (String(nu.hostname || '').toLowerCase() !== host) continue;
        if (!urlLooksLikeContent(nu)) continue;
        const s = nu.toString();
        if (visited.has(s)) continue;
        if (queue.includes(s)) continue;
        queue.push(s);
      } catch (e) {
        // ignore
      }
    }
  };

  enqueue(initialUrls, seed.toString());

  while (queue.length && pages.length < maxPages) {
    // Pick next URL; if we have tokens, prioritize URLs that include them.
    if (tokens.length && queue.length > 1) {
      queue.sort((a, b) => scoreUrlForTokens(b, tokens) - scoreUrlForTokens(a, tokens));
    }

    const nextUrl = queue.shift();
    if (!nextUrl) break;
    if (visited.has(nextUrl)) continue;
    visited.add(nextUrl);

    try {
      const pu = normalizeUrl(nextUrl);
      const html = await fetchHtmlWebSearch(pu);
      const text = htmlToText(html);
      pages.push({ url: pu.toString(), title: extractTitle(html) || '', text });

      // Continue discovery from each fetched page.
      const links = extractLinksFromHtml(html, pu.toString());
      // Add a prioritized subset to the queue to keep things bounded.
      const picked = pickCandidateLinks(links, host, question);
      enqueue(picked, pu.toString());

      if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
    } catch (e) {
      // ignore fetch errors; keep crawling others
    }
  }

  if (!pages.length) {
    logger.warn({ seedUrl: seed.toString() }, '[WebSearchFallback] No pages fetched for index');
  }

  cacheByHost.set(host, { atMs: nowMs, pages });
  return pages;
}

function searchIndex(question, pages) {
  const tokens = tokenizeQuery(question);
  if (!tokens.length) return [];

  const matches = [];
  for (const page of pages) {
    const paragraphs = splitParagraphs(page.text);
    for (const para of paragraphs) {
      const s = scoreParagraph(para, tokens);
      if (s <= 0) continue;
      matches.push({ score: s, excerpt: para, url: page.url, title: page.title || '' });
    }
  }

  matches.sort((a, b) => b.score - a.score);

  // Dedup by excerpt
  const out = [];
  const seen = new Set();
  for (const m of matches) {
    const key = `${m.url}|${m.excerpt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
    if (out.length >= 3) break;
  }

  return out;
}

function detectIntent(question) {
  const q = String(question || '').toLowerCase();
  if (!q) return null;

  // Indonesian users commonly type "dimana" (no space). Treat both "di mana" and "dimana" as location intent.
  if (/\b(alamat|lokasi|di\s*mana|maps|google\s*maps|rute|arah)\b/i.test(q)) return 'location';
  if (/\b(kontak|hubungi|contact|cs|telepon|telp|nomor)\b/i.test(q)) return 'contact';
  if (/\b(email|e-mail)\b/i.test(q)) return 'email';
  if (/\b(telepon|telp|nomor|whatsapp|wa\b)\b/i.test(q)) return 'phone';

  if (/\b(visi|misi)\b/i.test(q)) return 'about';
  if (/\b(fakultas|jurusan|prodi|program\s*studi|program\s+studi|mata\s+kuliah|kurikulum|belajar|belajarnya|dipelajari|prospek\s+kerja|lulusan|karier|karir)\b/i.test(q)) return 'academics';

  return null;
}

async function webSearchFallbackAnswer(question, options = null) {
  const enabled = String(process.env.ENABLE_WEB_SEARCH_FALLBACK || 'false').toLowerCase() === 'true';
  if (!enabled) return { ok: false, reason: 'disabled' };

  const intent = detectIntent(question) || 'general';

  // Safety guard: for academic-style intents (faculty/program/curriculum questions)
  // prefer RAG retrieval and clarifications over quoting web excerpts. By default
  // we bypass web fallback for academic intents to avoid returning quoted web
  // snippets as final answers. This can be overridden by setting
  // `BYPASS_WEB_FALLBACK_ACADEMIC=false` in the environment.
  try {
    const bypassAcademic = String(process.env.BYPASS_WEB_FALLBACK_ACADEMIC || 'true').toLowerCase() === 'true';
    if (bypassAcademic && (intent === 'academics' || intent === 'about')) {
      return { ok: true, answer: buildUnavailableFallbackMessage(), reason: 'bypassed_academic_intent', intent };
    }
  } catch (e) {
    // ignore and continue
  }

  const seedUrl = String((options && options.seedUrl) || process.env.WEB_SEARCH_SEED_URL || 'https://www.stikom-bali.ac.id/id/').trim();

  let parsed;
  try {
    parsed = normalizeUrl(seedUrl);
  } catch (e) {
    return { ok: false, reason: 'invalid_seed_url' };
  }

  if (isObviouslyPrivateHost(parsed.hostname) || !hostInAllowlist(parsed.hostname)) {
    return { ok: false, reason: 'host_not_allowed' };
  }

  const policy = await isSearchAllowedByRobots(parsed.toString());
  if (!policy.allowed) {
    return { ok: false, reason: 'search_not_allowed', policy };
  }

  try {
    // For contact/location, try quick scan on seed page first.
    if (intent === 'contact' || intent === 'location' || intent === 'phone' || intent === 'email') {
      const html = await fetchHtmlWebSearch(parsed);
      const text = htmlToText(html);
      const snippets = extractRelevantSnippets(text, intent, question);
      if (snippets.length) {
        return {
          ok: true,
          answer: buildUnavailableFallbackMessage(),
          sourceUrl: parsed.toString(),
          intent,
          reason: 'unavailable_message'
        };
      }
    }

    // For academics/about, quick scan seed page too (navigation/menu often contains the relevant items).
    if (intent === 'academics' || intent === 'about') {
      const html = await fetchHtmlWebSearch(parsed);
      const text = htmlToText(html);
      const snippets = extractRelevantSnippets(text, intent, question);
      if (snippets.length) {
        return {
          ok: true,
          answer: buildUnavailableFallbackMessage(),
          sourceUrl: parsed.toString(),
          intent,
          reason: 'unavailable_message'
        };
      }
    }

    // For anything else (including general), search across multiple pages.
    const pages = await loadPagesIndex(parsed.toString(), question);
    const hits = searchIndex(question, pages);
    if (!hits.length) {
      return { ok: false, reason: 'no_snippets', sourceUrl: parsed.toString(), intent };
    }

    return {
      ok: true,
      answer: buildUnavailableFallbackMessage(),
      sourceUrl: parsed.toString(),
      intent,
      hitsCount: hits.length,
      reason: 'unavailable_message'
    };
  } catch (e) {
    logger.warn({ err: e.message }, '[WebSearchFallback] Failed');
    return { ok: false, reason: e.message || 'failed' };
  }
}

module.exports = {
  webSearchFallbackAnswer
};
