// Scoped wrapper for ragEngine to support category-aware retrieval
const ragEngine = require('./ragEngine');
const path = require('path');
const { getRagDomainVectorsPath } = require('../utils/ragPaths');
const fs = require('fs');
const logger = require('../logger');
const { normalizeInput } = require('../lib/normalizer');
const { computeBm25Scores } = require('./bm25');
const RAG_BM25_ENABLED = /^(1|true|yes)$/i.test(String(process.env.RAG_BM25_ENABLED || '1'));
const RAG_RRF_ENABLED = /^(1|true|yes)$/i.test(String(process.env.RAG_RRF_ENABLED || '0'));
const RAG_RRF_K = Number.isFinite(Number(process.env.RAG_RRF_K)) ? Number(process.env.RAG_RRF_K) : 60;
const RAG_RETRIEVAL_DEBUG = /^(1|true|yes)$/i.test(String(process.env.RAG_RETRIEVAL_DEBUG || ''));

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function getCandidateKey(item, idx) {
  const chunkId = item && (item.id || item.chunkHash || (item.metadata && (item.metadata.chunkHash || item.metadata.id)));
  if (chunkId) return String(chunkId);
  const docId = item && item.metadata && (item.metadata.documentId || item.metadata.trainingId || item.metadata.source);
  return `${String(docId || 'unknown')}:${idx}`;
}

function rankCandidates(items, scoreKey) {
  const sorted = [...items].sort((a, b) => {
    const aScore = isFiniteNumber(a[scoreKey]) ? a[scoreKey] : 0;
    const bScore = isFiniteNumber(b[scoreKey]) ? b[scoreKey] : 0;
    if (bScore !== aScore) return bScore - aScore;
    return (b.timestampMs || 0) - (a.timestampMs || 0);
  });
  const rank = new Map();
  for (let i = 0; i < sorted.length; i += 1) {
    rank.set(sorted[i].candidateKey, i + 1);
  }
  return rank;
}

function clampAdjustment(adjustment, retrievalScore) {
  const maxAdjustment = Math.abs(retrievalScore) * 0.5;
  if (adjustment > maxAdjustment) return maxAdjustment;
  if (adjustment < -maxAdjustment) return -maxAdjustment;
  return adjustment;
}

// Cached domain vectors to avoid reading/parsing JSONL on every request
const DOMAIN_VECTORS_FILE = getRagDomainVectorsPath('domains_vectors.jsonl');
let cachedDomainVectors = null;
let cachedDomainVectorsMtime = null;
let cachedDomainVectorStatus = {
  domainVectorIndexAvailable: false,
  domainVectorCount: 0,
  domainVectorIndexPath: DOMAIN_VECTORS_FILE,
  domainVectorLastUpdated: null
};
let domainVectorIndexWarningLogged = false;

function getDomainVectorIndexStatus() {
  return { ...cachedDomainVectorStatus };
}

function updateDomainVectorIndexStatus(lines) {
  const count = Array.isArray(lines) ? lines.length : 0;
  const available = count > 0;
  const mtime = (() => {
    try { return fs.statSync(DOMAIN_VECTORS_FILE).mtimeMs; } catch (e) { return null; }
  })();
  cachedDomainVectorStatus = {
    domainVectorIndexAvailable: available,
    domainVectorCount: count,
    domainVectorIndexPath: DOMAIN_VECTORS_FILE,
    domainVectorLastUpdated: mtime
  };
}

function loadDomainVectorsOnce() {
  if (cachedDomainVectors !== null) return cachedDomainVectors;
  try {
    if (!fs.existsSync(DOMAIN_VECTORS_FILE)) {
      if (!domainVectorIndexWarningLogged) {
        logger.warn({ file: DOMAIN_VECTORS_FILE }, '[ragScoped] domain vector index not found; local-domain retrieval will fallback to ragEngine');
        domainVectorIndexWarningLogged = true;
      }
      cachedDomainVectors = [];
      updateDomainVectorIndexStatus(cachedDomainVectors);
      return cachedDomainVectors;
    }
    console.time('[perf] ragScoped.loadDomainVectors');
    const content = fs.readFileSync(DOMAIN_VECTORS_FILE, 'utf8');
    const lines = content.split(/\r?\n/).filter(Boolean).map(l => {
      try { return JSON.parse(l); } catch (e) { return null; }
    }).filter(Boolean);
    console.timeEnd('[perf] ragScoped.loadDomainVectors');
    cachedDomainVectors = lines;
    updateDomainVectorIndexStatus(lines);
    return cachedDomainVectors;
  } catch (e) {
    logger.warn({ err: e && e.message ? e.message : String(e), file: DOMAIN_VECTORS_FILE }, '[ragScoped] loadDomainVectors failed');
    cachedDomainVectors = [];
    updateDomainVectorIndexStatus(cachedDomainVectors);
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
  let retrievalPath = 'general-rag';
  let localDomainRetrievalUsed = false;
  const ultraFastShortcut = typeof ragEngine.tryUltraFastAcademicFaqShortcut === 'function'
    ? ragEngine.tryUltraFastAcademicFaqShortcut(q)
    : null;
  if (ultraFastShortcut) {
    retrievalPath = 'structured-handler';
    const result = ultraFastShortcut;
    if (result && typeof result === 'object') {
      result.debug = Object.assign({}, result.debug || {}, { retrievalPath, localDomainRetrievalUsed });
    }
    console.timeEnd('[perf] ragScoped.retrieve');
    return result;
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
        const qEmb = await ragEngine.computeEmbedding(String(normalizedQuery || q || '').slice(0,32000));
        console.timeEnd('[perf] computeEmbedding');

        // Compute sparse BM25 scores over the candidate pool (hybrid retrieval)
        const poolTexts = pool.map(p => ({ text: p.text || p.chunk || p.filename || '' }));
        const bm25 = RAG_BM25_ENABLED ? computeBm25Scores(String(normalizedQuery || q || ''), poolTexts, { k1: 1.5, b: 0.75 }) : pool.map((_, i) => ({ index: i, score: 0 }));
        const bm25Map = new Map(bm25.map(b => [b.index, b.score]));

        const qTokens = String(normalizedQuery || q || '').toLowerCase().split(/\s+/).filter(Boolean);
        const initialCandidates = pool.map((it, idx) => {
          const semanticScore = cosine(qEmb, it.values || it.embedding || []);
          const topic = inferDomainTopic(it);
          const ts = extractDomainTimestampMs(it);
          const text = String(it.text || it.chunk || '').toLowerCase();
          const statusActive = /\b(aktif|masih buka|masih dibuka|open|dibuka)\b/.test(text) || String(it.metadata && it.metadata.status || '').toLowerCase() === 'active';
          const rawBm25 = Number(bm25Map.get(idx) || 0);
          const bm25Contribution = rawBm25 ? rawBm25 / (1 + Math.abs(rawBm25)) * 0.35 : 0;
          const legacyBaseScore = semanticScore + bm25Contribution;
          let adjustmentScore = 0;

          if (asksSchedule) {
            if (topic === 'schedule') adjustmentScore += 0.22;
            if (topic === 'financial') adjustmentScore -= 0.2;
            if (statusActive && topic === 'schedule') adjustmentScore += 0.14;
            adjustmentScore += freshnessBoost(ts);
          }

          if (asksCurrentState) {
            if (topic === 'schedule') adjustmentScore += 0.24;
            if (topic === 'registration') adjustmentScore -= 0.1;
            if (topic === 'financial') adjustmentScore -= 0.28;
            if (statusActive && topic === 'schedule') adjustmentScore += 0.22;
            if (ts) adjustmentScore += freshnessBoost(ts) * 1.4;
            else if (topic === 'schedule') adjustmentScore -= 0.06;
          }

          if (!asksFinancial && !asksSchedule && topic === 'financial') {
            adjustmentScore -= 0.12;
          }

          const docTokens = String(it.text || it.chunk || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
          const matchedTerms = Array.from(new Set(qTokens.filter(t => docTokens.includes(t))));
          const chunkId = it.id || it.chunkHash || (it.metadata && (it.metadata.chunkHash || it.metadata.id)) || null;
          const documentId = it.metadata && (it.metadata.documentId || it.metadata.trainingId || null);
          const lexicalScore = isFiniteNumber(it.lexicalScore) ? it.lexicalScore : 0;
          const candidateKey = getCandidateKey(it, idx);

          return {
            item: it,
            candidateKey,
            chunkId,
            documentId,
            semanticScore,
            bm25: rawBm25,
            bm25Contribution,
            lexicalScore,
            legacyFinalScore: legacyBaseScore,
            adjustmentScore,
            matchedTerms,
            topic,
            timestampMs: ts
          };
        });

        const candidates = Array.from(initialCandidates.reduce((map, candidate) => {
          if (!map.has(candidate.candidateKey)) {
            map.set(candidate.candidateKey, candidate);
            return map;
          }
          const existing = map.get(candidate.candidateKey);
          const existingScore = existing.semanticScore + existing.bm25Contribution;
          const candidateScore = candidate.semanticScore + candidate.bm25Contribution;
          if (candidateScore > existingScore) {
            map.set(candidate.candidateKey, candidate);
          }
          return map;
        }, new Map()).values());

        const denseRankMap = rankCandidates(candidates, 'semanticScore');
        const bm25RankMap = rankCandidates(candidates, 'bm25');
        const lexicalRankMap = candidates.some(c => isFiniteNumber(c.lexicalScore) && c.lexicalScore !== 0) ? rankCandidates(candidates, 'lexicalScore') : new Map();

        const RAG_RRF_GATE_MODE = String(process.env.RAG_RRF_GATE_MODE || '').toLowerCase();

        const scored = candidates.map((candidate) => {
          const denseRank = denseRankMap.get(candidate.candidateKey) || null;
          const bm25Rank = bm25RankMap.get(candidate.candidateKey) || null;
          const lexicalRank = lexicalRankMap.size ? lexicalRankMap.get(candidate.candidateKey) || null : null;
          const denseRrfContribution = denseRank ? 1 / (RAG_RRF_K + denseRank) : 0;
          const bm25RrfContribution = bm25Rank ? 1 / (RAG_RRF_K + bm25Rank) : 0;
          const lexicalRrfContribution = lexicalRank ? 1 / (RAG_RRF_K + lexicalRank) : 0;
          const rrfScore = denseRrfContribution + bm25RrfContribution + lexicalRrfContribution;
          const retrievalScore = RAG_RRF_ENABLED ? rrfScore : candidate.legacyFinalScore + candidate.adjustmentScore;
          const adjustedScore = RAG_RRF_ENABLED ? clampAdjustment(candidate.adjustmentScore, retrievalScore) : 0;
          const finalScore = RAG_RRF_ENABLED ? retrievalScore + adjustedScore : retrievalScore;

          // Compute a gate-friendly normalized BM25 score (0..1) and gateScore
          const rawBm25 = typeof candidate.bm25 === 'number' ? candidate.bm25 : 0;
          let normalizedBm25Score = 0;
          if (Number.isFinite(rawBm25) && rawBm25 > 0) {
            normalizedBm25Score = rawBm25 / (1 + Math.abs(rawBm25));
            if (!Number.isFinite(normalizedBm25Score)) normalizedBm25Score = 0;
            normalizedBm25Score = Math.max(0, Math.min(1, normalizedBm25Score));
          }

          const semanticScoreForGate = isFiniteNumber(candidate.semanticScore) ? candidate.semanticScore : 0;
          const lexicalScoreForGate = isFiniteNumber(candidate.lexicalScore) ? candidate.lexicalScore : 0;
          const gateScore = Math.max(semanticScoreForGate, normalizedBm25Score, lexicalScoreForGate);
          const passedGate = Number.isFinite(gateScore) && gateScore >= 0; // real comparison done later against effectiveMinScore

          return {
            ...candidate,
            denseRank,
            bm25Rank,
            lexicalRank,
            denseRrfContribution,
            bm25RrfContribution,
            lexicalRrfContribution,
            rrfScore,
            retrievalScore,
            adjustedScore,
            finalScore,
            // Gate-related diagnostics
            gateScore,
            normalizedBm25Score,
            semanticScoreForGate,
            lexicalScoreForGate
          };
        });

        // When RRF is enabled we sort by rrfScore for ranking, but gating uses a separate gateScore
        if (RAG_RRF_ENABLED) {
          scored.sort((a, b) => {
            if (b.rrfScore !== a.rrfScore) return b.rrfScore - a.rrfScore;
            if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
            return (b.timestampMs || 0) - (a.timestampMs || 0);
          });
        } else {
          scored.sort((a, b) => {
            if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
            return (b.timestampMs || 0) - (a.timestampMs || 0);
          });
        }

        const top = scored[0] || null;
        const topScore = top ? (RAG_RRF_ENABLED ? top.rrfScore : top.finalScore) : 0;
        const topGateScore = top ? (typeof top.gateScore === 'number' ? top.gateScore : 0) : 0;

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

        const gateThreshold = effectiveMinScore;
        const gatePass = RAG_RRF_ENABLED ? (topGateScore >= gateThreshold) : (top && topScore >= effectiveMinScore);

        if (top && gatePass) {
          retrievalPath = 'local-domain';
          localDomainRetrievalUsed = true;
          // If debug enabled, attach per-candidate traces into opts.debug
          let retrievalTrace = null;
          if (RAG_RETRIEVAL_DEBUG) {
            const traces = scored.slice(0, Math.max(effectiveTopK, 10)).map((s, rank) => ({
              rank: rank + 1,
              id: s.item.id || null,
              preview: String((s.item.text || s.item.chunk || '')).slice(0,240),
              semanticRank: s.denseRank || null,
              semanticScore: s.semanticScore,
              lexicalRank: s.lexicalRank || null,
              lexicalScore: s.lexicalScore || 0,
              bm25Rank: s.bm25Rank || null,
              bm25Score: s.bm25 || 0,
              bm25Contribution: s.bm25Contribution || 0,
              rrfScore: s.rrfScore || null,
              retrievalScore: s.retrievalScore || null,
              adjustedScore: s.adjustedScore || null,
              legacyFinalScore: s.legacyFinalScore || null,
              finalScore: s.finalScore || null,
              matchedTerms: s.matchedTerms || [],
              topic: s.topic,
              timestampMs: s.timestampMs || null,
              metadata: s.item.metadata || {}
            }));
            retrievalTrace = { query: q, category, topScore, topGateScore, gateThreshold, traces, retrievedCategories };
            opts.debug = Object.assign({}, opts.debug || {}, { retrievalTrace });
            try { console.log('[RAG_RETRIEVAL_DEBUG]', JSON.stringify(retrievalTrace)); } catch (e) {}
          }

          const contexts = scored.slice(0, effectiveTopK).map(s => ({
            id: s.item.id || null,
            chunk: s.item.text || s.item.chunk || '',
            metadata: s.item.metadata || {},
            score: typeof s.finalScore === 'number' ? s.finalScore : null
          }));
          opts.localDomainContexts = contexts;
          console.timeEnd('[perf] ragScoped.domainRetrieval');
          opts.minScore = effectiveMinScore;
          logger.info({ query: q, category, topScore, retrievedCategories, contextCount: contexts.length }, '[ragScoped] local domain retrieval, delegating to ragEngine');
          console.time('[perf] ragScoped.delegate');
          const delegated = await ragEngine.query(q, effectiveTopK, opts);
          // Attach retrieval trace into delegated result so callers can inspect it
          if (retrievalTrace) {
            try {
              delegated.debug = Object.assign({}, delegated.debug || {}, { retrievalTrace });
            } catch (e) {}
          }
          delegated.debug = Object.assign({}, delegated.debug || {}, { retrievalPath, localDomainRetrievalUsed });
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
            debug: { topScore, retrievedCategories, source: 'local-domain-low-confidence', retrievalPath: 'local-domain', localDomainRetrievalUsed: true }
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
      fallbackResult.debug = Object.assign({}, fallbackResult.debug || {}, { retrievalPath, localDomainRetrievalUsed });
      console.timeEnd('[perf] ragScoped.delegate');
      console.timeEnd('[perf] ragScoped.retrieve');
      return fallbackResult;
    } catch (e) {
      // Fallback to non-scoped query if something goes wrong
      try {
        try { console.timeEnd('[perf] ragScoped.delegate'); } catch (ignore) {}
        console.time('[perf] ragScoped.delegateRetry');
        const retryResult = await ragEngine.query(normalizedQuery || q, k, options || {});
        retryResult.debug = Object.assign({}, retryResult.debug || {}, { retrievalPath, localDomainRetrievalUsed });
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

module.exports = {
  queryScoped,
  getDomainVectorIndexStatus
};
