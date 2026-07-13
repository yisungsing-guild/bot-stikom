const prisma = require('../db');
const { FileParser } = require('./fileParser');
const {
  normalizeUrl,
  hostAllowed,
  checkAiInputAllowed,
  fetchHtml,
  htmlToText,
  extractTitle,
  parseSitemapXml,
  discoverSitemap,
  shouldKeepUrl
} = require('./webIngest');
const { ingestTrainingData, removeTrainingFromIndex } = require('./ragEngine');

const VALID_DIVISIONS = new Set(['marketing', 'admission', 'academic', 'finance', 'student_affairs', 'career', 'global']);

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeDivisionKey(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw === 'global' || raw === 'none' || raw === 'null') return null;
  return VALID_DIVISIONS.has(raw) ? raw : raw.replace(/[^a-z0-9_-]/g, '').slice(0, 64) || null;
}

function collectSeedUrls(options = {}) {
  const urls = [];
  const explicit = options.seedUrls || options.urls || null;
  if (Array.isArray(explicit)) urls.push(...explicit);

  urls.push(...parseCsv(process.env.WEB_RAG_SEED_URLS));
  urls.push(...parseCsv(process.env.WEB_SEARCH_SEED_URLS));

  if (options.seedUrl) urls.push(options.seedUrl);
  if (process.env.WEB_RAG_SEED_URL) urls.push(process.env.WEB_RAG_SEED_URL);
  if (process.env.WEB_SEARCH_SEED_URL) urls.push(process.env.WEB_SEARCH_SEED_URL);

  const seen = new Set();
  const normalized = [];
  for (const url of urls) {
    try {
      const u = normalizeUrl(url).toString();
      if (seen.has(u)) continue;
      seen.add(u);
      normalized.push(u);
    } catch (e) {
      // Skip invalid seed values; callers can inspect skipped count from logs.
    }
  }
  return normalized;
}

function ensureTrainingAllowlistFromWebConfig(seedUrls) {
  if (String(process.env.TRAINING_URL_ALLOWLIST || '').trim()) return;

  const hosts = new Set(parseCsv(process.env.WEB_SEARCH_ALLOWLIST).map((h) => h.toLowerCase()));
  for (const url of seedUrls) {
    try {
      hosts.add(normalizeUrl(url).hostname.toLowerCase());
    } catch (e) {
      // ignore invalid seed URL
    }
  }

  if (hosts.size > 0) {
    process.env.TRAINING_URL_ALLOWLIST = Array.from(hosts).join(',');
  }
}

async function resolveUrlsFromSeed(seedUrl, options = {}) {
  const parsed = normalizeUrl(seedUrl);
  if (!hostAllowed(parsed)) {
    throw new Error(`URL host not allowed: ${parsed.hostname}`);
  }

  const mode = String(options.mode || process.env.WEB_RAG_MODE || 'sitemap').toLowerCase();
  if (mode === 'single') return [parsed.toString()];

  const maxPages = Math.min(
    parseInt(options.maxPages || process.env.WEB_RAG_MAX_PAGES || process.env.WEB_SEARCH_MAX_PAGES || '6', 10) || 6,
    parseInt(process.env.WEB_RAG_MAX_PAGES_HARD || process.env.URL_INGEST_MAX_PAGES_HARD || '25', 10) || 25
  );

  try {
    const { xml } = await discoverSitemap(parsed.toString());
    const locs = parseSitemapXml(xml);
    const urls = [];
    for (const loc of locs) {
      try {
        const u = normalizeUrl(loc);
        if (!hostAllowed(u)) continue;
        if (!shouldKeepUrl(u, parsed.hostname)) continue;
        urls.push(u.toString());
        if (urls.length >= maxPages) break;
      } catch (e) {
        // ignore invalid sitemap URL
      }
    }
    return urls.length > 0 ? urls : [parsed.toString()];
  } catch (e) {
    if (String(options.failOnSitemapError || process.env.WEB_RAG_FAIL_ON_SITEMAP_ERROR || '').toLowerCase() === 'true') {
      throw e;
    }
    return [parsed.toString()];
  }
}

async function createOrUpdateUrlTraining({ url, title, content, divisionKey }) {
  const filename = title ? `${title} (${url})` : url;
  const existing = await prisma.trainingData.findFirst({
    where: {
      source: 'url',
      OR: [
        { filename: url },
        { filename: { contains: `(${url})` } }
      ]
    },
    orderBy: { updatedAt: 'desc' }
  });

  const data = {
    filename,
    content,
    source: 'url',
    active: true,
    divisionKey
  };

  if (existing) {
    const updated = await prisma.trainingData.update({
      where: { id: existing.id },
      data
    });
    removeTrainingFromIndex(updated.id);
    return { training: updated, action: 'updated' };
  }

  const training = await prisma.trainingData.create({ data });
  return { training, action: 'created' };
}

async function ingestOneUrl(url, options = {}) {
  const parsed = normalizeUrl(url);
  if (!hostAllowed(parsed)) {
    return { ok: false, url: parsed.toString(), error: `URL host not allowed: ${parsed.hostname}` };
  }

  const respectPolicy = String(options.respectContentSignal ?? process.env.WEB_RAG_RESPECT_CONTENT_SIGNAL ?? 'true').toLowerCase() !== 'false';
  if (respectPolicy) {
    const policy = await checkAiInputAllowed(parsed);
    if (!policy.allowed) {
      return {
        ok: false,
        url: parsed.toString(),
        error: `AI ingestion not allowed by website policy: ${policy.reason}`,
        contentSignal: policy.contentSignal || ''
      };
    }
  }

  const html = await fetchHtml(parsed);
  const title = extractTitle(html);
  const text = htmlToText(html);
  if (!text || text.trim().length < 200) {
    return { ok: false, url: parsed.toString(), error: 'Extracted text too short' };
  }

  const normalized = FileParser.sanitizeTextForStorage(text.trim());
  const maxStoredBytes = parseInt(process.env.MAX_TRAINING_CONTENT_BYTES || String(15 * 1024 * 1024), 10);
  const limited = FileParser.limitTextToUtf8Bytes(normalized, maxStoredBytes);
  const divisionKey = normalizeDivisionKey(options.divisionKey || process.env.WEB_RAG_DIVISION_KEY);

  const { training, action } = await createOrUpdateUrlTraining({
    url: parsed.toString(),
    title,
    content: limited.text,
    divisionKey
  });

  const ingested = await ingestTrainingData(training.id, training.content, 'url', {
    divisionKey,
    filename: training.filename,
    sourceFile: parsed.toString()
  });

  return {
    ok: true,
    action,
    url: parsed.toString(),
    trainingDataId: training.id,
    filename: training.filename,
    divisionKey,
    wasTruncated: limited.wasTruncated,
    rag: ingested
  };
}

async function ingestWebSeedsToRag(options = {}) {
  const seedUrls = collectSeedUrls(options);
  ensureTrainingAllowlistFromWebConfig(seedUrls);

  const results = [];
  const seen = new Set();
  const delayMs = parseInt(options.delayMs || process.env.WEB_RAG_DELAY_MS || process.env.URL_INGEST_DELAY_MS || '200', 10) || 0;

  for (const seedUrl of seedUrls) {
    let urls;
    try {
      urls = await resolveUrlsFromSeed(seedUrl, options);
    } catch (err) {
      results.push({ ok: false, seedUrl, error: err.message || String(err) });
      continue;
    }

    for (const url of urls) {
      if (seen.has(url)) continue;
      seen.add(url);
      try {
        results.push(await ingestOneUrl(url, options));
      } catch (err) {
        results.push({ ok: false, url, error: err.message || String(err) });
      }
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return {
    ok: results.some((r) => r && r.ok),
    seedCount: seedUrls.length,
    requestedCount: seen.size,
    okCount: results.filter((r) => r && r.ok).length,
    failedCount: results.filter((r) => !r || !r.ok).length,
    results
  };
}

module.exports = {
  collectSeedUrls,
  normalizeDivisionKey,
  resolveUrlsFromSeed,
  ingestOneUrl,
  ingestWebSeedsToRag
};
