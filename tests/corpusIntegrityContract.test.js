'use strict';

/**
 * tests/corpusIntegrityContract.test.js
 *
 * Verifies Chat Engine V2 Canonical Corpus Integrity and Fail-Closed Contracts.
 * Ensures V2 never silently degrades to incomplete fallback indexes (< 829 chunks).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  getCorpusIndex,
  CANONICAL_CORPUS_MIN_CHUNKS,
  _resetCorpusCacheForTesting
} = require('../src/engine/pgvectorShadowProvider');
const {
  retrieveCandidates,
  verifyCorpusReadiness
} = require('../src/core/retrievalService');
const { processTurn } = require('../src/core/orchestrator');
const { getCachedSemanticIndex, querySemanticRag } = require('../src/engine/semanticRagEngine');

describe('Chat Engine V2 — Canonical Corpus Integrity & Fail-Closed Contract', () => {
  const originalEnvRagIndexPath = process.env.RAG_INDEX_PATH;
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-test-'));
    _resetCorpusCacheForTesting();
  });

  afterEach(() => {
    if (originalEnvRagIndexPath !== undefined) {
      process.env.RAG_INDEX_PATH = originalEnvRagIndexPath;
    } else {
      delete process.env.RAG_INDEX_PATH;
    }
    _resetCorpusCacheForTesting();
    try {
      if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (_) {}
  });

  afterAll(() => {
    if (originalEnvRagIndexPath !== undefined) {
      process.env.RAG_INDEX_PATH = originalEnvRagIndexPath;
    } else {
      delete process.env.RAG_INDEX_PATH;
    }
    _resetCorpusCacheForTesting();
  });

  // 1. Index kanonik valid
  test('Case 1: Valid canonical index (>= 829 chunks) is accepted by V2', async () => {
    delete process.env.RAG_INDEX_PATH;
    _resetCorpusCacheForTesting();

    const readiness = verifyCorpusReadiness();
    expect(readiness.isReady).toBe(true);
    expect(readiness.status).toBe('READY');
    expect(readiness.minRequired).toBe(829);
    expect(readiness.chunkCount).toBeGreaterThanOrEqual(CANONICAL_CORPUS_MIN_CHUNKS);

    const corpus = getCorpusIndex({}, { requireCanonical: true });
    expect(Array.isArray(corpus)).toBe(true);
    expect(corpus.length).toBeGreaterThanOrEqual(CANONICAL_CORPUS_MIN_CHUNKS);

    const plan = {
      domain: 'ACADEMIC',
      intent: 'PROGRAM_DETAILS',
      targetEntities: ['S1 Sistem Informasi'],
      normalizedQuery: 'kurikulum s1 sistem informasi',
      queryVariants: ['kurikulum s1 sistem informasi']
    };
    const candidates = await retrieveCandidates(plan, { topK: 5 });
    expect(Array.isArray(candidates)).toBe(true);
    expect(candidates.length).toBeGreaterThan(0);
  });

  // 2. RAG_INDEX_PATH tidak disetel dan snapshot kanonik tidak tersedia
  test('Case 2: Snapshot kanonik tidak tersedia dan RAG_INDEX_PATH tidak disetel -> V2 fail-closed', async () => {
    // Provide a context with empty semanticIndex to simulate missing snapshot in V2
    const emptyContext = { semanticIndex: [] };
    const readiness = verifyCorpusReadiness(emptyContext);
    expect(readiness.isReady).toBe(false);
    expect(readiness.status).toBe('UNAVAILABLE');
    expect(readiness.chunkCount).toBe(0);

    const corpus = getCorpusIndex(emptyContext, { requireCanonical: true });
    expect(corpus).toEqual([]);

    const plan = {
      domain: 'ACADEMIC',
      targetEntities: ['S1 Sistem Informasi'],
      normalizedQuery: 'kurikulum s1 sistem informasi'
    };
    const candidates = await retrieveCandidates(plan, { context: emptyContext });
    expect(candidates).toEqual([]);
  });

  // 3. File index tidak ditemukan
  test('Case 3: RAG_INDEX_PATH disetel ke file yang tidak ada -> V2 fail-closed', async () => {
    const missingPath = path.join(tempDir, 'non_existent_rag_index.json');
    process.env.RAG_INDEX_PATH = missingPath;
    _resetCorpusCacheForTesting();

    const readiness = verifyCorpusReadiness();
    expect(readiness.isReady).toBe(false);
    expect(readiness.status).toBe('UNAVAILABLE');
    expect(readiness.chunkCount).toBe(0);

    const corpus = getCorpusIndex({}, { requireCanonical: true });
    expect(corpus).toEqual([]);

    const plan = {
      domain: 'ACADEMIC',
      targetEntities: ['S1 Sistem Informasi'],
      normalizedQuery: 'kurikulum s1 sistem informasi'
    };
    const candidates = await retrieveCandidates(plan);
    expect(candidates).toEqual([]);
  });

  // 4. JSON rusak atau bukan array
  test('Case 4a: RAG_INDEX_PATH berisi JSON sintaks rusak -> V2 fail-closed', async () => {
    const brokenJsonPath = path.join(tempDir, 'broken.json');
    fs.writeFileSync(brokenJsonPath, '{"broken": [unclosed json');
    process.env.RAG_INDEX_PATH = brokenJsonPath;
    _resetCorpusCacheForTesting();

    const readiness = verifyCorpusReadiness();
    expect(readiness.isReady).toBe(false);
    expect(readiness.status).toBe('UNAVAILABLE');

    const corpus = getCorpusIndex({}, { requireCanonical: true });
    expect(corpus).toEqual([]);

    const candidates = await retrieveCandidates({ normalizedQuery: 'biaya kuliah' });
    expect(candidates).toEqual([]);
  });

  test('Case 4b: RAG_INDEX_PATH berisi JSON valid tetapi bukan array (Object) -> V2 fail-closed', async () => {
    const nonArrayPath = path.join(tempDir, 'non_array.json');
    fs.writeFileSync(nonArrayPath, JSON.stringify({ title: 'Not an array', chunks: [] }));
    process.env.RAG_INDEX_PATH = nonArrayPath;
    _resetCorpusCacheForTesting();

    const readiness = verifyCorpusReadiness();
    expect(readiness.isReady).toBe(false);
    expect(readiness.status).toBe('UNAVAILABLE');

    const corpus = getCorpusIndex({}, { requireCanonical: true });
    expect(corpus).toEqual([]);

    const candidates = await retrieveCandidates({ normalizedQuery: 'biaya kuliah' });
    expect(candidates).toEqual([]);
  });

  // 5. Jumlah chunk di bawah batas (< 829 chunks)
  test('Case 5: RAG_INDEX_PATH berisi index kecil (50 chunk < 829) -> V2 fail-closed', async () => {
    const smallIndexPath = path.join(tempDir, 'small_index.json');
    const smallChunks = Array.from({ length: 50 }, (_, i) => ({
      id: `chunk_${i}`,
      text: `Materi kuliah chunk ke-${i}`,
      sourceFile: 'dummy.pdf'
    }));
    fs.writeFileSync(smallIndexPath, JSON.stringify(smallChunks));
    process.env.RAG_INDEX_PATH = smallIndexPath;
    _resetCorpusCacheForTesting();

    const readiness = verifyCorpusReadiness();
    expect(readiness.isReady).toBe(false);
    expect(readiness.status).toBe('UNAVAILABLE');
    expect(readiness.chunkCount).toBe(0);

    const corpus = getCorpusIndex({}, { requireCanonical: true });
    expect(corpus).toEqual([]);

    const plan = {
      domain: 'ACADEMIC',
      targetEntities: ['S1 Sistem Informasi'],
      normalizedQuery: 'kurikulum s1 sistem informasi'
    };
    const candidates = await retrieveCandidates(plan);
    expect(candidates).toEqual([]);
  });

  // 6. Index fallback kecil tersedia bersamaan dengan kegagalan index kanonik
  test('Case 6: Index fallback kecil (85 chunk) TIDAK boleh dipakai oleh V2 saat index kanonik gagal', async () => {
    // When canonical index fails (e.g. invalid RAG_INDEX_PATH)
    const invalidPath = path.join(tempDir, 'corrupt_canonical.json');
    fs.writeFileSync(invalidPath, '{ corrupt }');
    process.env.RAG_INDEX_PATH = invalidPath;
    _resetCorpusCacheForTesting();

    // 1. V2 requireCanonical=true returns empty, does NOT silently adopt 85-chunk fallback
    const v2Corpus = getCorpusIndex({}, { requireCanonical: true });
    expect(v2Corpus).toEqual([]);

    // 2. retrieveCandidates returns empty
    const candidates = await retrieveCandidates({ normalizedQuery: 'biaya kuliah sistem informasi' });
    expect(candidates).toEqual([]);

    // 3. V2 processTurn gracefully returns safe refusal (corpus_gap) without hallucinating from small index
    const turnResult = await processTurn(
      'test_chat_fail_closed',
      'biaya kuliah sistem informasi per semester?',
      {
        sessionSnapshot: { data: {} },
        syncOnly: true
      }
    );
    expect(turnResult.status).toBe('corpus_gap');
    expect(turnResult.subQueryResults[0].answerability).toBe('UNKNOWN');
    expect(turnResult.subQueryResults[0].verification.isGrounded).toBe(false);
    expect(turnResult.finalAnswer).toMatch(/belum tercantum/i);

    // 4. When a small fallback index (e.g. 85 chunks) is present in context:
    const fallback85 = Array.from({ length: 85 }, (_, i) => ({
      id: `chunk_${i}`,
      text: `Fallback content chunk ${i}`
    }));
    const fallbackContext = { semanticIndex: fallback85 };

    // V2 strictly rejects it because it is below 829
    const v2Rejection = getCorpusIndex(fallbackContext, { requireCanonical: true });
    expect(v2Rejection).toEqual([]);

    // Legacy non-canonical caller getCorpusIndex({ requireCanonical: false }) can still access fallback
    const legacyCorpus = getCorpusIndex(fallbackContext, { requireCanonical: false });
    expect(Array.isArray(legacyCorpus)).toBe(true);
    expect(legacyCorpus.length).toBe(85);
    expect(legacyCorpus.length).toBeLessThan(CANONICAL_CORPUS_MIN_CHUNKS);
  });

  // 7. Regresi Legacy V1 tetap berfungsi sesuai kontrak sebelumnya
  test('Case 7: Legacy V1 pipeline (semanticRagEngine) remains fully functional', async () => {
    const legacyIndex = getCachedSemanticIndex();
    expect(Array.isArray(legacyIndex)).toBe(true);
    expect(legacyIndex.length).toBeGreaterThan(0);

    const legacyResult = await querySemanticRag('apa syarat pendaftaran?', { topK: 3 });
    expect(legacyResult).toBeDefined();
    expect(typeof legacyResult).toBe('object');
  });
});
