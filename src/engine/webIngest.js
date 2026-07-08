const axios = require('axios');
const { URL } = require('url');

function normalizeUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('url required');
  const parsed = new URL(raw);
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error('Only http/https URLs are allowed');
  }
  // Drop fragments
  parsed.hash = '';
  return parsed;
}

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

function hostAllowed(urlObj) {
  const allowlist = String(process.env.TRAINING_URL_ALLOWLIST || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  const hostname = String(urlObj.hostname || '').toLowerCase();

  if (isObviouslyPrivateHost(hostname)) return false;

  if (allowlist.length === 0) return true;

  return allowlist.some(allowed => hostname === allowed || hostname.endsWith('.' + allowed));
}

function decodeBasicEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'");
}

function htmlToText(html) {
  let s = String(html || '');
  if (!s) return '';

  // Remove scripts/styles/noscript/svg which are mostly noise
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<svg[\s\S]*?<\/svg>/gi, ' ');

  // Newline hints
  s = s.replace(/<\s*br\s*\/?>/gi, '\n');
  s = s.replace(/<\s*\/\s*p\s*>/gi, '\n');
  s = s.replace(/<\s*\/\s*div\s*>/gi, '\n');
  s = s.replace(/<\s*\/\s*li\s*>/gi, '\n');
  s = s.replace(/<\s*\/\s*h[1-6]\s*>/gi, '\n');

  // Strip remaining tags
  s = s.replace(/<[^>]+>/g, ' ');

  s = decodeBasicEntities(s);

  // Normalize whitespace but keep some newlines
  s = s
    .replace(/\r/g, '')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ *\n */g, '\n')
    .trim();

  return s;
}

function extractTitle(html) {
  const m = /<title[^>]*>([^<]*)<\/title>/i.exec(String(html || ''));
  if (!m || !m[1]) return '';
  return decodeBasicEntities(m[1]).replace(/\s{2,}/g, ' ').trim();
}

async function fetchHtml(urlObj) {
  const timeoutMs = parseInt(process.env.URL_INGEST_TIMEOUT_MS || '15000', 10);
  const maxBytes = parseInt(process.env.URL_INGEST_MAX_BYTES || String(2 * 1024 * 1024), 10);
  const maxRedirects = parseInt(process.env.URL_INGEST_MAX_REDIRECTS || '3', 10);
  const followRedirects = String(process.env.URL_INGEST_FOLLOW_REDIRECTS || 'true').toLowerCase() !== 'false';
  const safeMaxRedirects = Number.isFinite(maxRedirects) && maxRedirects >= 0 && maxRedirects <= 10 ? maxRedirects : 3;

  const headers = {
    'User-Agent': process.env.URL_INGEST_USER_AGENT || 'system_wa-bot/1.0 (+RAG ingest)'
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
    if (!hostAllowed(current)) {
      throw new Error('Host not allowed');
    }

    const resp = await requestOnce(current);

    // Handle redirects manually so we can re-apply hostAllowlist/private-host checks.
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

async function fetchRobotsTxt(siteUrl) {
  const base = new URL(siteUrl);
  base.pathname = '/robots.txt';
  base.search = '';
  base.hash = '';

  try {
    return await fetchHtml(base);
  } catch (e) {
    return '';
  }
}

function parseContentSignal(robotsTxt) {
  const raw = String(robotsTxt || '');
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // Best-effort: pick the last Content-Signal line we see.
  // Some sites repeat blocks; Cloudflare-managed content often includes this.
  let signalLine = '';
  for (const line of lines) {
    if (/^content-signal\s*:/i.test(line)) signalLine = line;
  }
  if (!signalLine) return { raw: '', map: {} };

  const after = signalLine.split(':').slice(1).join(':').trim();
  const map = {};
  for (const part of after.split(',')) {
    const p = part.trim();
    if (!p) continue;
    const eq = p.indexOf('=');
    if (eq === -1) continue;
    const k = p.slice(0, eq).trim().toLowerCase();
    const v = p.slice(eq + 1).trim().toLowerCase();
    if (k) map[k] = v;
  }
  return { raw: after, map };
}

function parseSitemapUrlsFromRobots(robotsTxt) {
  const raw = String(robotsTxt || '');
  const lines = raw.split(/\r?\n/);
  const urls = [];
  for (const line of lines) {
    const m = /^sitemap\s*:\s*(\S+)/i.exec(line.trim());
    if (m && m[1]) urls.push(m[1].trim());
  }
  return Array.from(new Set(urls));
}

async function checkAiInputAllowed(urlObj) {
  try {
    const origin = new URL(urlObj.toString());
    origin.pathname = '/';
    origin.search = '';
    origin.hash = '';

    const robots = await fetchRobotsTxt(origin.toString());
    const signal = parseContentSignal(robots);

    // If the site explicitly signals ai-input=no, deny.
    if (signal.map['ai-input'] === 'no') {
      return {
        allowed: false,
        reason: 'robots.txt Content-Signal declares ai-input=no',
        contentSignal: signal.raw
      };
    }

    // If ai-input is not explicitly allowed, default deny to avoid violating site policy.
    if (signal.map['ai-input'] !== 'yes') {
      return {
        allowed: false,
        reason: 'robots.txt does not explicitly allow ai-input=yes',
        contentSignal: signal.raw
      };
    }

    return { allowed: true, reason: 'ai-input=yes', contentSignal: signal.raw };
  } catch (e) {
    return { allowed: false, reason: e.message || 'Failed to check robots.txt', contentSignal: '' };
  }
}

function parseSitemapXml(xml) {
  const raw = String(xml || '');
  const urls = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(raw))) {
    const u = m[1].trim();
    if (u) urls.push(u);
  }
  // Dedup preserving order
  return Array.from(new Set(urls));
}

async function discoverSitemap(originUrl) {
  const origin = new URL(originUrl);
  origin.pathname = '/';
  origin.search = '';
  origin.hash = '';

  // Prefer sitemap URLs declared in robots.txt
  try {
    const robots = await fetchRobotsTxt(origin.toString());
    const fromRobots = parseSitemapUrlsFromRobots(robots);
    if (fromRobots.length > 0) {
      const first = new URL(fromRobots[0]);
      const xml = await fetchHtml(first);
      return { sitemapUrl: first.toString(), xml };
    }
  } catch (e) {
    // ignore and fall back
  }

  const candidates = [
    new URL('/sitemap.xml', origin).toString(),
    new URL('/sitemap_index.xml', origin).toString()
  ];

  let lastErr = null;
  for (const c of candidates) {
    try {
      const html = await fetchHtml(new URL(c));
      return { sitemapUrl: c, xml: html };
    } catch (e) {
      lastErr = e;
    }
  }

  const msg = lastErr ? lastErr.message : 'Failed to fetch sitemap';
  throw new Error(`Failed to fetch sitemap (${msg})`);
}

function shouldKeepUrl(urlObj, baseHost) {
  const sameHost = String(urlObj.hostname || '').toLowerCase() === String(baseHost || '').toLowerCase();
  if (!sameHost) return false;

  const prefix = String(process.env.URL_INGEST_PATH_PREFIX || '/id/');
  if (prefix && prefix !== '/' && !String(urlObj.pathname || '').startsWith(prefix)) return false;

  // Avoid obvious non-content assets
  if (/\.(jpg|jpeg|png|gif|webp|svg|css|js|zip|rar|7z|mp4|mp3|pdf)$/i.test(urlObj.pathname || '')) return false;

  return true;
}

module.exports = {
  normalizeUrl,
  hostAllowed,
  fetchHtml,
  fetchRobotsTxt,
  parseContentSignal,
  parseSitemapUrlsFromRobots,
  checkAiInputAllowed,
  htmlToText,
  extractTitle,
  parseSitemapXml,
  discoverSitemap,
  shouldKeepUrl
};
