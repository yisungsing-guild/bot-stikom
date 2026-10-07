'use strict';

/**
 * src/core/retrievalService.js
 * 
 * Greenfield Unified Retrieval Service.
 * Leverages healthy underlying retrieval infrastructure:
 * - In-memory Canonical Corpus Index (829+ governed chunks)
 * - BM25 Sparse Search (bm25.js)
 * - PgVector / Dense Embeddings (when configured)
 * - Executes retrieval according to RetrievalPlan constraints
 */

const { 
  getCorpusIndex, 
  searchVectorChunksMultiBinding, 
  computeBatchQueryEmbeddings, 
  computeBindingRRF 
} = require('../engine/pgvectorShadowProvider');
const { computeBm25Scores } = require('../engine/bm25');
const logger = require('../logger');

/**
 * Checks if production PgVector is configured and enabled in environment
 */
function isPgVectorProductionEnabled() {
  const mode = String(process.env.VECTOR_RETRIEVAL_MODE || '').toLowerCase();
  const enabled = /^(true|1|yes)$/i.test(String(process.env.VECTOR_RETRIEVAL_ENABLED || ''));
  const hybrid = /^(true|1|yes)$/i.test(String(process.env.VECTOR_HYBRID_ENABLED || ''));
  return mode === 'hybrid' || mode === 'vector' || enabled || hybrid;
}

const { CANONICAL_ENTITIES } = require('../engine/canonicalEntityRegistry');

let cachedFileContextMap = null;
function getFileContextMap(corpus) {
  if (cachedFileContextMap) return cachedFileContextMap;
  cachedFileContextMap = new Map();

  for (const doc of corpus) {
    const f = doc.sourceFile || doc.filename || '';
    if (!f || cachedFileContextMap.has(f)) continue;

    const docChunks = corpus.filter(c => (c.sourceFile || c.filename) === f);
    const entities = new Set();
    let category = doc.docCategory || '';

    for (const c of docChunks) {
      const txt = (c.chunk || c.text || '');
      if (!category && (txt.includes('BIAYA PENDIDIKAN') || /rincian biaya/i.test(f))) {
        category = 'BIAYA';
      }

      // Check program header in text
      const progMatch = txt.match(/PROGRAM STUDI\s+([A-Z0-9\s,\(\)]+?)(?:T\.A|\n|$)/i);
      if (progMatch) {
        const pName = progMatch[1].trim();
        for (const ent of CANONICAL_ENTITIES) {
          if (ent.family === 'academic_program' && (
            pName.toLowerCase().includes(ent.canonical.replace(/^(S1|D3|S2)\s+/i, '').toLowerCase()) ||
            (ent.aliases && ent.aliases.some(a => a.length >= 3 && pName.toLowerCase().includes(a)))
          )) {
            entities.add(ent.canonical);
          }
        }
      }

      // Check filename for canonical entities & aliases
      for (const ent of CANONICAL_ENTITIES) {
        if (ent.aliases && ent.aliases.some(a => a.length >= 2 && new RegExp('\\b' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(f))) {
          entities.add(ent.canonical);
        }
      }
    }

    cachedFileContextMap.set(f, {
      category,
      entities: Array.from(entities)
    });
  }

  return cachedFileContextMap;
}

/**
 * Retrieves candidates matching RetrievalPlan
 * Integrates:
 * 1. BM25 Sparse Search over Governed Canonical Corpus (829 chunks)
 * 2. Production PostgreSQL PgVector Cosine Search (rag.corpus_vector_chunks) when active
 * 3. Reciprocal Rank Fusion (RRF) to merge and rank candidates
 */
async function retrieveCandidates(retrievalPlan, { topK = 6 } = {}) {
  const corpus = getCorpusIndex();
  if (!Array.isArray(corpus) || corpus.length === 0) {
    logger.warn('[RetrievalService] Corpus index is empty or not loaded');
    return [];
  }

  const variants = (retrievalPlan.queryVariants && retrievalPlan.queryVariants.length > 0)
    ? retrievalPlan.queryVariants.slice(0, 4)
    : [retrievalPlan.normalizedQuery || ''];
  const query = variants.join(' ');
  if (!query) return [];

  const fileContextMap = getFileContextMap(corpus);

  // 1. BM25 Sparse Retrieval over governed text enriched with document context
  const textDocs = corpus.map(doc => {
    const f = doc.sourceFile || doc.filename || '';
    const ctx = fileContextMap.get(f);
    const entStr = ctx && ctx.entities && ctx.entities.length > 0 ? ctx.entities.join(' ') : '';
    const raw = doc.chunk || doc.text || (doc.metadata && (doc.metadata.chunk || doc.metadata.text)) || '';
    const textWithContext = entStr ? `${entStr} ${f} ${raw}` : `${f} ${raw}`;
    return { text: textWithContext };
  });

  const bm25Results = computeBm25Scores(query, textDocs);
  
  const bm25Sorted = bm25Results
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK * 2);

  const bm25Candidates = bm25Sorted.map(item => {
    const doc = corpus[item.index];
    const rawText = doc.chunk || doc.text || (doc.metadata && (doc.metadata.chunk || doc.metadata.text)) || '';
    const source = doc.filename || doc.source || (doc.metadata && doc.metadata.source) || 'unknown';
    const sourceFile = doc.sourceFile || doc.filename || source;
    const metadata = doc.metadata || doc || {};
    const ctx = fileContextMap.get(sourceFile);

    // Propagate document-level program entity to chunk text if chunk lacks explicit entity mention
    let enrichedText = rawText;
    if (ctx && ctx.entities && ctx.entities.length > 0) {
      const hasAnyEnt = ctx.entities.some(e => rawText.toLowerCase().includes(e.toLowerCase()));
      if (!hasAnyEnt && (ctx.category === 'BIAYA' || /rincian biaya/i.test(sourceFile))) {
        enrichedText = `[Program: ${ctx.entities.join(', ')}] ${rawText}`;
      }
    }

    return {
      id: doc.id || `chunk_${item.index}`,
      source_record_id: doc.id || `chunk_${item.index}`,
      source_record_index: item.index,
      index: item.index,
      score: item.score,
      text: enrichedText,
      rawText,
      chunk: enrichedText,
      source,
      source_file: sourceFile,
      metadata,
      docCategory: metadata.docCategory || doc.docCategory || (ctx ? ctx.category : null),
      contextEntities: ctx ? ctx.entities : [],
      validFrom: doc.validFrom || metadata.validFrom || null,
      validTo: doc.validTo || metadata.validTo || null
    };
  });

  // 2. Production PgVector Retrieval (if enabled and configured in PostgreSQL)
  let vectorCandidates = [];
  if (isPgVectorProductionEnabled()) {
    try {
      const [emb] = await computeBatchQueryEmbeddings([query]);
      if (emb && Array.isArray(emb) && emb.length === 1536) {
        const bindingItem = {
          binding: {
            bindingId: 'b_primary',
            constraints: null
          },
          embedding: emb
        };
        const searchRes = await searchVectorChunksMultiBinding([bindingItem], topK * 2);
        vectorCandidates = searchRes.b_primary || [];
      }
    } catch (vectorErr) {
      logger.warn({ err: vectorErr.message }, '[RetrievalService] Production PgVector query fallback to BM25');
    }
  }

  // 3. Hybrid RRF Fusion
  if (Array.isArray(vectorCandidates) && vectorCandidates.length > 0) {
    const rrfCandidates = computeBindingRRF(bm25Candidates, vectorCandidates, 60);
    // Sort RRF candidates by score descending
    const sortedRrf = rrfCandidates.slice(0, topK).map(item => ({
      index: item.source_record_index ?? 0,
      score: item.rrf_score || item.similarity || 0,
      text: item.chunk || '',
      source: item.source_file || 'pgvector_hybrid',
      metadata: item,
      docCategory: item.doc_category || null,
      validFrom: null,
      validTo: null
    }));
    return sortedRrf;
  }

  // Pure BM25 fallback
  return bm25Candidates.slice(0, topK);
}

module.exports = {
  retrieveCandidates,
  isPgVectorProductionEnabled
};
