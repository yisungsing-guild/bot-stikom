// Scoped wrapper for ragEngine to support category-aware retrieval
const ragEngine = require('./ragEngine');
const path = require('path');
const { getRagDomainVectorsPath } = require('../utils/ragPaths');
const fs = require('fs');
const logger = require('../logger');
const { normalizeInput } = require('../lib/normalizer');

// Cached domain vectors to avoid reading/parsing JSONL on every request
const DOMAIN_VECTORS_FILE = getRagDomainVectorsPath('domains_vectors.jsonl');
let cachedDomainVectors = null;
let cachedDomainVectorsMtime = null;

function loadDomainVectorsOnce() {
  if (cachedDomainVectors !== null) return cachedDomainVectors;
  try {
    if (!fs.existsSync(DOMAIN_VECTORS_FILE)) {
      cachedDomainVectors = [];
      return cachedDomainVectors;
    }
    console.time('[perf] ragScoped.loadDomainVectors');
    const content = fs.readFileSync(DOMAIN_VECTORS_FILE, 'utf8');
    const lines = content.split(/\r?\n/).filter(Boolean).map(l => {
      try { return JSON.parse(l); } catch (e) { return null; }
    }).filter(Boolean);
    console.timeEnd('[perf] ragScoped.loadDomainVectors');
    cachedDomainVectors = lines;
    try { cachedDomainVectorsMtime = fs.statSync(DOMAIN_VECTORS_FILE).mtimeMs; } catch (e) {}
    return cachedDomainVectors;
  } catch (e) {
    logger.warn({ err: e && e.message ? e.message : String(e), file: DOMAIN_VECTORS_FILE }, '[ragScoped] loadDomainVectors failed');
    cachedDomainVectors = [];
    return cachedDomainVectors;
  }
}

// Warm the domain vector cache at module initialization so requests do not pay
// the JSONL parse cost on first hit.
loadDomainVectorsOnce();

function isSubstantiveChunkText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return false;
  if (text.length < 80) return false;

  const wordCount = text.split(' ').filter(Boolean).length;
  if (wordCount < 8 && !/\n/.test(String(value || ''))) return false;

  return true;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += (a[i] || 0) * (b[i] || 0);
    na += (a[i] || 0) ** 2;
    nb += (b[i] || 0) ** 2;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1e-10);
}

function detectProgramAffinity(queryText) {
  const q = String(queryText || '').toLowerCase();
  if (/\bteknologi\s+informasi\b/.test(q) || /\bti\b/.test(q)) return 'teknologi_informasi';
  if (/\bsistem\s+informasi\b/.test(q) || /\bsi\b/.test(q)) return 'sistem_informasi';
  if (/\bsistem\s+komputer\b/.test(q) || /\bsk\b/.test(q)) return 'sistem_komputer';
  if (/\bbisnis\s+digital\b/.test(q) || /\bbd\b/.test(q)) return 'bisnis_digital';
  return null;
}

function matchesProgramSource(item, programAffinity) {
  if (!item || !programAffinity) return false;
  const source = String(item.metadata && item.metadata.source || '').toLowerCase();
  return source.includes(`program_studi_${programAffinity}`);
}

function inferDomainTopic(item) {
  if (!item) return 'general';
  const metadata = (item.metadata && typeof item.metadata === 'object') ? item.metadata : {};
  const category = String(metadata.category || metadata.type || '').toLowerCase();
  const source = String(metadata.source || '').toLowerCase();
  const text = String(item.text || item.chunk || '').toLowerCase();

  const hasScholarship = /\bbeasiswa\b/.test(text) || /beasiswa/.test(source);
  const hasFinancial = /\b(biaya|dpp|ukt|pembayaran|potongan|cicilan)\b/.test(text) || /biaya|keuangan/.test(source);

  if (hasScholarship && !hasFinancial) return 'financial';
  if (hasFinancial) return 'financial';
  if (category.includes('schedule') || category.includes('gelombang') || /\b(jadwal|gelombang|deadline|tanggal)\b/.test(text) || /jadwal|gelombang/.test(source)) return 'schedule';
  if (category.includes('registration') || category.includes('pmb') || /\b(pendaftaran|registrasi|berkas|syarat|pmb)\b/.test(text) || /pmb|pendaftaran/.test(source)) return 'registration';
  if (category.includes('curriculum') || category.includes('career') || category.includes('program')) return 'academic';
  return 'general';
}

function extractDomainTimestampMs(item) {
  if (!item) return null;
  const metadata = (item.metadata && typeof item.metadata === 'object') ? item.metadata : {};
  const candidates = [metadata.updatedAt, metadata.createdAt, metadata.timestamp, metadata.date, metadata.lastUpdated, item.updatedAt, item.createdAt];
  for (const value of candidates) {
    if (!value) continue;
    const ts = Date.parse(String(value));
    if (Number.isFinite(ts) && ts > 0) return ts;
  }
  const chunkText = String(item.text || item.chunk || '');
  const iso = chunkText.match(/\b(20\d{2})[-\/.](0?[1-9]|1[0-2])[-\/.](0?[1-9]|[12]\d|3[01])\b/);
  if (iso) {
    const ts = Date.parse(`${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}`);
    if (Number.isFinite(ts) && ts > 0) return ts;
  }
  const dmy = chunkText.match(/\b(0?[1-9]|[12]\d|3[01])[-\/.](0?[1-9]|1[0-2])[-\/.](20\d{2})\b/);
  if (dmy) {
    const ts = Date.parse(`${dmy[3]}-${String(dmy[2]).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}`);
    if (Number.isFinite(ts) && ts > 0) return ts;
  }
  const monthMap = {
    januari: '01', februari: '02', maret: '03', april: '04', mei: '05', juni: '06',
    juli: '07', agustus: '08', september: '09', oktober: '10', november: '11', desember: '12'
  };
  const idLong = chunkText.toLowerCase().match(/\b(0?[1-9]|[12]\d|3[01])\s+(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s+(20\d{2})\b/);
  if (idLong) {
    const ts = Date.parse(`${idLong[3]}-${monthMap[idLong[2]]}-${String(idLong[1]).padStart(2, '0')}`);
    if (Number.isFinite(ts) && ts > 0) return ts;
  }
  return null;
}

function freshnessBoost(tsMs) {
  if (!tsMs || !Number.isFinite(tsMs)) return 0;
  const ageDays = Math.max(0, (Date.now() - tsMs) / 86400000);
  if (ageDays <= 30) return 0.18;
  if (ageDays <= 90) return 0.1;
  if (ageDays > 720) return -0.08;
  return 0;
}

function hasCurrentStateSignal(queryText) {
  const q = String(queryText || '').toLowerCase();
  return /\b(sekarang|saat ini|masih buka|masih dibuka|aktif|hari ini|gelombang sekarang)\b/.test(q);
}

async function queryScoped({ query, category, topK, filters, options } = {}) {
  const q = String(query || '');
  const normalizedRoutingQuery = normalizeInput(q).normalized || q;
  const qLower = normalizedRoutingQuery.toLowerCase();
  const asksSchedule = /\b(gelombang|jadwal|deadline|tanggal pendaftaran|gelombang aktif|sekarang|masih buka|masih dibuka|aktif)\b/.test(qLower);
  const asksCurrentState = hasCurrentStateSignal(qLower);
  const asksFinancial = /\b(biaya|dpp|ukt|beasiswa|potongan|cicilan|pembayaran)\b/.test(qLower);
  console.time('[perf] ragScoped.retrieve');
  const ultraFastShortcut = typeof ragEngine.tryUltraFastAcademicFaqShortcut === 'function'
    ? ragEngine.tryUltraFastAcademicFaqShortcut(q)
    : null;
  if (ultraFastShortcut) {
    console.timeEnd('[perf] ragScoped.retrieve');
    return ultraFastShortcut;
  }
  const normalizedQuery = normalizedRoutingQuery;
  const k = typeof topK === 'number' ? topK : parseInt(process.env.RAG_TOP_K || '3', 10);
  const opts = (options && typeof options === 'object') ? { ...options } : {};

  // Attach category into options.metadata for downstream visibility
  if (category) {
    opts.metadata = { ...(opts.metadata || {}), category };
  }

  if (filters) {
    opts.filters = { ...(opts.filters || {}), ...filters };
  }

  // Strict domain-first retrieval: try local vector index (domains namespace) when category detected
  const minScore = parseFloat(process.env.MIN_DOMAIN_SCORE || '0.25');
  if (category && category !== 'unknown') {
    try {
      const lines = loadDomainVectorsOnce();
      if (lines && lines.length) {
        console.time('[perf] ragScoped.domainRetrieval');

        // Strict exact category match only
        let pool = lines.filter(item => {
          try { return item && item.metadata && item.metadata.category === category; } catch (e) { return false; }
        });

        // For curriculum/career detail questions, fallback to metadata.type pool
        // when exact category-scoped corpus is unavailable.
        if (!pool.length) {
          const normalized = String(category || '').toLowerCase();
          const allowedTypes =
            normalized === 'curriculum'
              ? ['curriculum', 'program_detail']
              : (normalized === 'career_path' || normalized === 'career')
                ? ['career', 'program_detail']
                : normalized === 'program_detail'
                  ? ['curriculum', 'career', 'program_detail']
                  : [];
          if (allowedTypes.length) {
            pool = lines.filter(item => {
              const t = String(item && item.metadata && item.metadata.type || '').toLowerCase();
              return allowedTypes.includes(t);
            });
          }
        }

        const substantivePool = pool.filter(item => isSubstantiveChunkText(item && (item.text || item.chunk || '')));
        if (substantivePool.length > 0) pool = substantivePool;

        const categoryKey = String(category || '').toLowerCase();
        const programAffinity = detectProgramAffinity(normalizedQuery);
        if (programAffinity) {
          const affinityPool = pool.filter(item => matchesProgramSource(item, programAffinity));
          if (affinityPool.length > 0) pool = affinityPool;
        }

        const effectiveTopK = (categoryKey === 'career_path' && programAffinity) ? 1 : k;

        console.time('[perf] computeEmbedding');
        const qEmb = await ragEngine.computeEmbedding(String(normalizedQuery || q || '').slice(0, 32000));
        console.timeEnd('[perf] computeEmbedding');

        const scored = pool.map(it => {
          const semanticScore = cosine(qEmb, it.values || it.embedding || []);
          const topic = inferDomainTopic(it);
          const ts = extractDomainTimestampMs(it);
          const text = String(it.text || it.chunk || '').toLowerCase();
          const statusActive = /\b(aktif|masih buka|masih dibuka|open|dibuka)\b/.test(text) || String(it.metadata && it.metadata.status || '').toLowerCase() === 'active';
          let score = semanticScore;

          // Date-aware schedule boosting for "gelombang aktif sekarang"-like queries.
          if (asksSchedule) {
            if (topic === 'schedule') score += 0.22;
            if (topic === 'financial') score -= 0.2;
            if (statusActive && topic === 'schedule') score += 0.14;
            score += freshnessBoost(ts);
          }

          if (asksCurrentState) {
            if (topic === 'schedule') score += 0.24;
            if (topic === 'registration') score -= 0.1;
            if (topic === 'financial') score -= 0.28;
            if (statusActive && topic === 'schedule') score += 0.22;
            if (ts) score += freshnessBoost(ts) * 1.4;
            else if (topic === 'schedule') score -= 0.06;
          }

          // Keep non-financial academic queries from drifting into tuition docs.
          if (!asksFinancial && !asksSchedule && topic === 'financial') {
            score -= 0.12;
          }

          return { item: it, score, semanticScore, topic, timestampMs: ts };
        });
        scored.sort((a,b) => (b.score - a.score) || ((b.timestampMs || 0) - (a.timestampMs || 0)));
        const top = scored[0] || null;
        const topScore = top ? top.score : 0;

        const retrievedCategories = Array.from(new Set(pool.map(p => p.metadata && p.metadata.category).filter(Boolean)));

        logger.info({ query: q, category, topScore, topTopic: top ? top.topic : null, topTimestampMs: top ? top.timestampMs : null, retrievedCategories, asksCurrentState }, '[ragScoped] domain-scoped retrieval');

        const minScoreOverride = (typeof opts.minScore === 'number' && Number.isFinite(opts.minScore)) ? opts.minScore : null;
        const isAcademicDomain = categoryKey === 'curriculum' || categoryKey === 'career_path' || categoryKey === 'career';
        let effectiveMinScore;
        if (minScoreOverride !== null) {
          effectiveMinScore = minScoreOverride;
        } else if (categoryKey === 'career_path' || categoryKey === 'career') {
          effectiveMinScore = parseFloat(process.env.RAG_ACADEMIC_CAREER_MIN_SCORE || '0.45');
        } else if (categoryKey === 'international_program' || categoryKey === 'exchange_program') {
          effectiveMinScore = parseFloat(process.env.RAG_SUPPORT_INTERNATIONAL_MIN_SCORE || '0.40');
        } else if (categoryKey === 'tuition_fee') {
          effectiveMinScore = parseFloat(process.env.RAG_SUPPORT_TUITION_MIN_SCORE || '0.48');
        } else if (categoryKey === 'scholarship' || categoryKey === 'double_degree') {
          effectiveMinScore = parseFloat(process.env.RAG_SUPPORT_PROGRAM_MIN_SCORE || '0.45');
        } else {
          effectiveMinScore = isAcademicDomain ? parseFloat(process.env.RAG_ACADEMIC_MIN_SCORE || '0.50') : parseFloat(process.env.RAG_MIN_SCORE || '0.6');
        }

        if (top && topScore >= effectiveMinScore) {
          const contexts = scored.slice(0, effectiveTopK).map(s => ({
            id: s.item.id || null,
            chunk: s.item.text || s.item.chunk || '',
            metadata: s.item.metadata || {},
            score: typeof s.score === 'number' ? s.score : null
          }));
          opts.localDomainContexts = contexts;
          console.timeEnd('[perf] ragScoped.domainRetrieval');
          opts.minScore = effectiveMinScore;
          logger.info({ query: q, category, topScore, retrievedCategories, contextCount: contexts.length }, '[ragScoped] local domain retrieval, delegating to ragEngine');
          console.time('[perf] ragScoped.delegate');
          const delegated = await ragEngine.query(q, effectiveTopK, opts);
          console.timeEnd('[perf] ragScoped.delegate');
          console.timeEnd('[perf] ragScoped.retrieve');
          return delegated;
        }

        // If domain retrieval failed or score too low, decide behavior based on explicitDomain flag.
        // When caller explicitly requested a domain, DO NOT fallback to broad retrieval; return a low-confidence domain-scoped result.
        opts.debug = Object.assign({}, opts.debug || {}, { domainScopedAttempt: true, domainScopedTopScore: topScore, domainScopedCategories: retrievedCategories });
        if (opts && opts.explicitDomain) {
          const contexts = scored.slice(0, effectiveTopK).map(s => ({ id: s.item.id || null, chunk: s.item.text || s.item.chunk || '', metadata: s.item.metadata || {} }));
          console.timeEnd('[perf] ragScoped.retrieve');
          return {
            success: true,
            answer: null,
            contexts,
            confidenceScore: topScore,
            noBroadFallback: true,
            debug: { topScore, retrievedCategories, source: 'local-domain-low-confidence' }
          };
        }
      }
    } catch (e) {
      logger.warn({ err: e && e.message ? e.message : String(e), file: DOMAIN_VECTORS_FILE }, '[ragScoped] local domain search failed');
      // Continue to ragEngine.query fallback
    }
  }

  // Backwards-compatible: call underlying ragEngine.query
  if (typeof ragEngine.query === 'function') {
    try {
      console.time('[perf] ragScoped.delegate');
      const fallbackResult = await ragEngine.query(normalizedQuery || q, k, opts);
      console.timeEnd('[perf] ragScoped.delegate');
      console.timeEnd('[perf] ragScoped.retrieve');
      return fallbackResult;
    } catch (e) {
      // Fallback to non-scoped query if something goes wrong
      try {
        try { console.timeEnd('[perf] ragScoped.delegate'); } catch (ignore) {}
        console.time('[perf] ragScoped.delegateRetry');
        const retryResult = await ragEngine.query(normalizedQuery || q, k, options || {});
        console.timeEnd('[perf] ragScoped.delegateRetry');
        console.timeEnd('[perf] ragScoped.retrieve');
        return retryResult;
      } catch (err) {
        throw err;
      }
    }
  }

  throw new Error('ragEngine.query not available');
}

module.exports = { queryScoped };
