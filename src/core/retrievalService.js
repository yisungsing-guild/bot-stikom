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

  const query = (retrievalPlan.queryVariants && retrievalPlan.queryVariants[0]) || '';
  if (!query) return [];

  // 1. BM25 Sparse Retrieval over governed text
  const textDocs = corpus.map(doc => ({
    text: doc.chunk || doc.text || (doc.metadata && (doc.metadata.chunk || doc.metadata.text)) || ''
  }));
  const bm25Results = computeBm25Scores(query, textDocs);
  
  const bm25Sorted = bm25Results
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK * 2);

  const bm25Candidates = bm25Sorted.map(item => {
    const doc = corpus[item.index];
    const text = doc.chunk || doc.text || (doc.metadata && (doc.metadata.chunk || doc.metadata.text)) || '';
    const source = doc.filename || doc.source || (doc.metadata && doc.metadata.source) || 'unknown';
    const metadata = doc.metadata || doc || {};

    return {
      id: doc.id || `chunk_${item.index}`,
      source_record_id: doc.id || `chunk_${item.index}`,
      source_record_index: item.index,
      index: item.index,
      score: item.score,
      text,
      chunk: text,
      source,
      source_file: doc.sourceFile || doc.filename || source,
      metadata,
      docCategory: metadata.docCategory || doc.docCategory || null,
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
