'use strict';

/**
 * tests/corpusHydrationContract.test.js
 *
 * Isolated Unit Test Suite for Chat Engine V2 Canonical Corpus Integrity & Hydration Contract.
 * Validates:
 * 1. Mandatory manifest validation (missing, corrupt JSON, empty hash fail closed).
 * 2. Exact versioned count enforcement (828, 829, 830 records).
 * 3. Scope and metadata protection in canonical hash (program change with identical text/ID fails closed).
 * 4. Delimiter and unicode resilience (pipe, newline, unicode, nulls handled without collision).
 * 5. Database fallback hydration, singleflight concurrency mutex, failure resilience, and cache gating.
 * 6. Contract parity across snapshot, cache, and DB hydration.
 */

const fs = require('fs');
const shadowDb = require('../src/engine/shadowDb');
const {
  ensureCanonicalCorpus,
  getCorpusIndex,
  getCanonicalManifest,
  getCanonicalExpectedHash,
  validateCorpusIntegrity,
  computeCanonicalContentHash,
  CANONICAL_CORPUS_MIN_CHUNKS,
  CANONICAL_CORPUS_EXPECTED_CHUNKS,
  CANONICAL_MANIFEST_PATH,
  CANONICAL_SNAPSHOT_PATHS,
  _resetCorpusCacheForTesting
} = require('../src/engine/pgvectorShadowProvider');

function generateMockDbRows(count = 829, options = {}) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const id = options.duplicateAt === i
      ? 'chunk-duplicate-id'
      : (options.duplicateTarget && i === count - 1 ? 'chunk-duplicate-id' : `chunk-${String(i).padStart(4, '0')}`);

    rows.push({
      vector_chunk_id: `vec-${id}`,
      source_record_id: id,
      source_record_index: i,
      source_file: i % 2 === 0 ? 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf' : 'panduan_akademik.pdf',
      chunk: i === 0 && options.includeFeeEvidence
        ? 'BIAYA PENDIDIKAN PER SEMESTER S1 Sistem Informasi 6.500.000 menjelang perwalian'
        : (options.emptyTextAt === i ? '' : `Teks materi resmi ITB STIKOM Bali untuk chunk ${id}`),
      program: i % 3 === 0 ? 'SI' : (i % 3 === 1 ? 'TI' : 'BD'),
      program_name: i % 3 === 0 ? 'Sistem Informasi' : (i % 3 === 1 ? 'Teknologi Informasi' : 'Bisnis Digital'),
      campus: 'Renon',
      category: 'BIAYA',
      doc_category: 'BIAYA_KULIAH',
      raw_metadata: {
        prodi: i % 3 === 0 ? 'S1 Sistem Informasi' : 'S1 TI',
        academicLevel: 'S1',
        academicYear: '2026/2027'
      }
    });
  }
  return rows;
}

function createMockManifestRaw(records, overrides = {}) {
  const hash = computeCanonicalContentHash(records);
  const manifest = {
    manifestVersion: 2,
    canonicalCorpus: {
      corpusVersion: '2026-08-11T04-15-00-138Z_production_ready',
      minRequiredChunks: 829,
      expectedChunks: 829,
      canonicalContentHashVersion: 2,
      canonicalContentHashSchemaVersion: 'v2-canonical-json',
      canonicalContentSha256: hash,
      ...overrides
    }
  };
  return JSON.stringify(manifest);
}

describe('Chat Engine V2 — Corpus Hydration & Integrity Contract (Isolated Unit Tests)', () => {
  let originalEnvRagIndexPath;
  let existsSyncSpy;
  let readFileSyncSpy;
  let queryShadowDbSpy;

  beforeEach(() => {
    originalEnvRagIndexPath = process.env.RAG_INDEX_PATH;
    delete process.env.RAG_INDEX_PATH;
    _resetCorpusCacheForTesting();

    // Default: snapshots not found to test database fallback hydration
    existsSyncSpy = jest.spyOn(fs, 'existsSync').mockImplementation((p) => {
      if (typeof p === 'string' && p.includes('canonical_corpus_manifest.json')) {
        return true;
      }
      return false;
    });

    readFileSyncSpy = jest.spyOn(fs, 'readFileSync');
    queryShadowDbSpy = jest.spyOn(shadowDb, 'queryShadowDb');
  });

  afterEach(() => {
    if (originalEnvRagIndexPath !== undefined) {
      process.env.RAG_INDEX_PATH = originalEnvRagIndexPath;
    } else {
      delete process.env.RAG_INDEX_PATH;
    }
    if (existsSyncSpy) existsSyncSpy.mockRestore();
    if (readFileSyncSpy) readFileSyncSpy.mockRestore();
    if (queryShadowDbSpy) queryShadowDbSpy.mockRestore();
    _resetCorpusCacheForTesting();
  });

  // 1. Mandatory Manifest Validation
  test('Scenario 1: Missing manifest fails closed with manifest_missing_or_invalid', async () => {
    existsSyncSpy.mockImplementation((p) => {
      if (typeof p === 'string' && p.includes('canonical_corpus_manifest.json')) {
        return false;
      }
      return false;
    });

    const manifestResult = getCanonicalManifest();
    expect(manifestResult.valid).toBe(false);
    expect(manifestResult.error).toBe('manifest_missing');

    const expectedHash = getCanonicalExpectedHash();
    expect(expectedHash).toBeNull();

    const mockRows = generateMockDbRows(829);
    const check = validateCorpusIntegrity(mockRows, { requireCanonical: true });
    expect(check.valid).toBe(false);
    expect(check.reason).toBe('manifest_missing_or_invalid');
    expect(check.error).toBe('manifest_missing');
  });

  test('Scenario 2: Corrupt JSON manifest fails closed with manifest_parse_failed', async () => {
    readFileSyncSpy.mockImplementation((p) => {
      if (typeof p === 'string' && p.includes('canonical_corpus_manifest.json')) {
        return '{"corrupt json: [unclosed';
      }
      return '';
    });

    const manifestResult = getCanonicalManifest();
    expect(manifestResult.valid).toBe(false);
    expect(manifestResult.error).toBe('manifest_parse_failed');

    const mockRows = generateMockDbRows(829);
    const check = validateCorpusIntegrity(mockRows, { requireCanonical: true });
    expect(check.valid).toBe(false);
    expect(check.reason).toBe('manifest_missing_or_invalid');
    expect(check.error).toBe('manifest_parse_failed');
  });

  test('Scenario 3: Manifest with empty or missing expected hash fails closed', async () => {
    readFileSyncSpy.mockImplementation((p) => {
      if (typeof p === 'string' && p.includes('canonical_corpus_manifest.json')) {
        return JSON.stringify({
          manifestVersion: 2,
          canonicalCorpus: {
            minRequiredChunks: 829,
            expectedChunks: 829,
            canonicalContentSha256: '   ' // empty string
          }
        });
      }
      return '';
    });

    const manifestResult = getCanonicalManifest();
    expect(manifestResult.valid).toBe(false);
    expect(manifestResult.error).toBe('manifest_missing_or_empty_canonical_content_hash');

    const mockRows = generateMockDbRows(829);
    const check = validateCorpusIntegrity(mockRows, { requireCanonical: true });
    expect(check.valid).toBe(false);
    expect(check.reason).toBe('manifest_missing_or_invalid');
  });

  // 2. Exact Record Count Enforcement (828, 829, 830)
  test('Scenario 4: Count = 828 records fails closed with insufficient_records / chunk_count_mismatch', () => {
    const mock828 = generateMockDbRows(828);
    const validManifest = createMockManifestRaw(mock828, { expectedChunks: 829, minRequiredChunks: 829 });
    readFileSyncSpy.mockImplementation((p) => {
      if (typeof p === 'string' && p.includes('canonical_corpus_manifest.json')) {
        return validManifest;
      }
      return '';
    });

    const check = validateCorpusIntegrity(mock828, { requireCanonical: true });
    expect(check.valid).toBe(false);
    expect(check.reason).toBe('insufficient_records');
    expect(check.count).toBe(828);
    expect(check.minRequired).toBe(829);
  });

  test('Scenario 5: Count = 829 records with matching canonical hash passes verification', () => {
    const mock829 = generateMockDbRows(829, { includeFeeEvidence: true });
    const validManifest = createMockManifestRaw(mock829);
    readFileSyncSpy.mockImplementation((p) => {
      if (typeof p === 'string' && p.includes('canonical_corpus_manifest.json')) {
        return validManifest;
      }
      return '';
    });

    const check = validateCorpusIntegrity(mock829, { requireCanonical: true });
    expect(check.valid).toBe(true);
    expect(check.count).toBe(829);
    expect(typeof check.hash).toBe('string');
    expect(check.hash.length).toBe(64);
  });

  test('Scenario 6: Count = 830 records fails closed with chunk_count_mismatch', () => {
    const mock830 = generateMockDbRows(830);
    const validManifest = createMockManifestRaw(mock830, { expectedChunks: 829, minRequiredChunks: 829 });
    readFileSyncSpy.mockImplementation((p) => {
      if (typeof p === 'string' && p.includes('canonical_corpus_manifest.json')) {
        return validManifest;
      }
      return '';
    });

    const check = validateCorpusIntegrity(mock830, { requireCanonical: true });
    expect(check.valid).toBe(false);
    expect(check.reason).toBe('chunk_count_mismatch');
    expect(check.expected).toBe(829);
    expect(check.actual).toBe(830);
  });

  // 3. Duplicate IDs & Replaced Record Checks
  test('Scenario 7: Duplicate record IDs fail closed with duplicate_record_id', () => {
    const duplicateRows = generateMockDbRows(829, { duplicateAt: 0, duplicateTarget: true });
    const manifest = createMockManifestRaw(duplicateRows);
    readFileSyncSpy.mockImplementation((p) => {
      if (typeof p === 'string' && p.includes('canonical_corpus_manifest.json')) {
        return manifest;
      }
      return '';
    });

    const check = validateCorpusIntegrity(duplicateRows, { requireCanonical: true });
    expect(check.valid).toBe(false);
    expect(check.reason).toBe('duplicate_record_id');
    expect(check.duplicateId).toBe('chunk-duplicate-id');
  });

  test('Scenario 8: Single replaced record with exact count 829 fails closed with content_hash_mismatch', () => {
    const baseRows = generateMockDbRows(829);
    const validManifest = createMockManifestRaw(baseRows);
    readFileSyncSpy.mockImplementation((p) => {
      if (typeof p === 'string' && p.includes('canonical_corpus_manifest.json')) {
        return validManifest;
      }
      return '';
    });

    // Tamper with exactly one record's text
    const tamperedRows = generateMockDbRows(829);
    tamperedRows[42].chunk = 'Teks yang telah dimodifikasi atau dipalsukan';

    const check = validateCorpusIntegrity(tamperedRows, { requireCanonical: true });
    expect(check.valid).toBe(false);
    expect(check.reason).toBe('content_hash_mismatch');
    expect(check.expected).not.toBe(check.computed);
  });

  // 4. Scope & Metadata Protection in Canonical Hash
  test('Scenario 9: Metadata scope change (program SI -> TI) with identical text and ID fails hash check', () => {
    const baseRows = generateMockDbRows(829, { includeFeeEvidence: true });
    const baseHash = computeCanonicalContentHash(baseRows);

    const validManifest = createMockManifestRaw(baseRows);
    readFileSyncSpy.mockImplementation((p) => {
      if (typeof p === 'string' && p.includes('canonical_corpus_manifest.json')) {
        return validManifest;
      }
      return '';
    });

    // Alter only program metadata on record 0 from SI to TI (text & ID remain 100% identical)
    const tamperedMetaRows = generateMockDbRows(829, { includeFeeEvidence: true });
    tamperedMetaRows[0].program = 'TI';
    tamperedMetaRows[0].program_name = 'Teknologi Informasi';

    const tamperedHash = computeCanonicalContentHash(tamperedMetaRows);
    expect(tamperedHash).not.toBe(baseHash);

    const check = validateCorpusIntegrity(tamperedMetaRows, { requireCanonical: true });
    expect(check.valid).toBe(false);
    expect(check.reason).toBe('content_hash_mismatch');
  });

  // 5. Delimiter and Unicode Resilience
  test('Scenario 10: Strings containing pipe (|), CRLF, unicode, and nulls hash deterministically without delimiter collision', () => {
    const complexRows = [
      {
        id: 'chunk-a',
        source_file: 'doc|with|pipes.pdf',
        chunk: 'Line 1\r\nLine 2 with | pipe character and unicode: € • —\r\n',
        program: null,
        program_name: null,
        campus: null,
        category: 'BIAYA',
        doc_category: 'BIAYA_KULIAH'
      },
      {
        id: 'chunk-b',
        source_file: 'doc.pdf',
        chunk: 'Line 1\nLine 2 with | pipe character and unicode: € • —\n',
        program: null,
        program_name: null,
        campus: null,
        category: 'BIAYA',
        doc_category: 'BIAYA_KULIAH'
      }
    ];

    // CRLF on chunk-a is normalized to LF, so chunk-a and chunk-b have identical normalized text
    // But different source_file ('doc|with|pipes.pdf' vs 'doc.pdf')
    const hashA = computeCanonicalContentHash([complexRows[0]]);
    const hashB = computeCanonicalContentHash([complexRows[1]]);

    expect(typeof hashA).toBe('string');
    expect(hashA.length).toBe(64);
    expect(hashA).not.toBe(hashB);

    // Verify pipe characters inside field values do not collide with adjacent fields
    const collisionCandidate1 = [{
      id: 'id1',
      source_file: 'file|prog|cat',
      chunk: 'text',
      program: null,
      category: null
    }];
    const collisionCandidate2 = [{
      id: 'id1',
      source_file: 'file',
      chunk: 'text',
      program: 'prog',
      category: 'cat'
    }];
    const hash1 = computeCanonicalContentHash(collisionCandidate1);
    const hash2 = computeCanonicalContentHash(collisionCandidate2);
    expect(hash1).not.toBe(hash2);
  });

  // 6. Database Fallback Hydration & Singleflight Mutex
  test('Scenario 11: Successful database hydration caches corpus and serves getCorpusIndex synchronously', async () => {
    const mockRows = generateMockDbRows(829, { includeFeeEvidence: true });
    const manifest = createMockManifestRaw(mockRows);
    readFileSyncSpy.mockImplementation((p) => {
      if (typeof p === 'string' && p.includes('canonical_corpus_manifest.json')) {
        return manifest;
      }
      return '';
    });

    queryShadowDbSpy.mockResolvedValueOnce({ rows: mockRows });

    const corpus = await ensureCanonicalCorpus({}, { requireCanonical: true });
    expect(Array.isArray(corpus)).toBe(true);
    expect(corpus.length).toBe(829);
    expect(queryShadowDbSpy).toHaveBeenCalledTimes(1);

    // Synchronously available in getCorpusIndex
    const cached = getCorpusIndex({}, { requireCanonical: true });
    expect(cached.length).toBe(829);
    expect(cached[0].id).toBe('chunk-0000');
    expect(cached[0].sourceFile).toBe('rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf');
    expect(cached[0].program).toBe('SI');
    expect(cached[0].academicLevel).toBe('S1');
  });

  test('Scenario 12: Parallel concurrent requests coalesce into single DB call (Singleflight)', async () => {
    let resolveQuery;
    const pendingPromise = new Promise((resolve) => {
      resolveQuery = resolve;
    });

    queryShadowDbSpy.mockImplementationOnce(() => pendingPromise);

    const mockRows = generateMockDbRows(829);
    const manifest = createMockManifestRaw(mockRows);
    readFileSyncSpy.mockImplementation((p) => {
      if (typeof p === 'string' && p.includes('canonical_corpus_manifest.json')) {
        return manifest;
      }
      return '';
    });

    const p1 = ensureCanonicalCorpus({}, { requireCanonical: true });
    const p2 = ensureCanonicalCorpus({}, { requireCanonical: true });

    resolveQuery({ rows: mockRows });

    const [res1, res2] = await Promise.all([p1, p2]);
    expect(queryShadowDbSpy).toHaveBeenCalledTimes(1);
    expect(res1.length).toBe(829);
    expect(res2.length).toBe(829);
    expect(res1).toBe(res2);
  });

  test('Scenario 13: Database query failure fails closed and cache remains empty', async () => {
    queryShadowDbSpy.mockRejectedValueOnce(new Error('Connection terminated: 5432'));

    const corpus = await ensureCanonicalCorpus({}, { requireCanonical: true });
    expect(corpus).toEqual([]);

    const cached = getCorpusIndex({}, { requireCanonical: true });
    expect(cached).toEqual([]);
  });

  test('Scenario 14: Cache does NOT mark corpus ready or return records before integrity check passes', async () => {
    // DB returns 829 rows but the content hash in manifest does NOT match
    const mockRows = generateMockDbRows(829);
    const mismatchedManifest = JSON.stringify({
      manifestVersion: 2,
      canonicalCorpus: {
        minRequiredChunks: 829,
        expectedChunks: 829,
        canonicalContentSha256: '0000000000000000000000000000000000000000000000000000000000000000'
      }
    });

    readFileSyncSpy.mockImplementation((p) => {
      if (typeof p === 'string' && p.includes('canonical_corpus_manifest.json')) {
        return mismatchedManifest;
      }
      return '';
    });

    queryShadowDbSpy.mockResolvedValueOnce({ rows: mockRows });

    const corpus = await ensureCanonicalCorpus({}, { requireCanonical: true });
    expect(corpus).toEqual([]);

    const cached = getCorpusIndex({}, { requireCanonical: true });
    expect(cached).toEqual([]);
  });

  // 7. Contract Parity Across Snapshot and DB Rows
  test('Scenario 15: Snapshot and DB rows share identical canonical hash schema and property mapping', () => {
    const rawDbRow = {
      vector_chunk_id: 'vec-123',
      source_record_id: 'chunk-real-001',
      source_record_index: 0,
      source_file: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf',
      chunk: 'Biaya S1 Sistem Informasi 6.500.000',
      program: 'SI',
      program_name: 'Sistem Informasi',
      campus: 'Renon',
      category: 'BIAYA',
      doc_category: 'BIAYA_KULIAH',
      raw_metadata: { academicLevel: 'S1' }
    };

    const snapshotRecord = {
      id: 'chunk-real-001',
      sourceFile: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf',
      chunk: 'Biaya S1 Sistem Informasi 6.500.000',
      program: 'SI',
      programName: 'Sistem Informasi',
      campus: 'Renon',
      category: 'BIAYA',
      docCategory: 'BIAYA_KULIAH',
      academicLevel: 'S1'
    };

    const hashFromDbRow = computeCanonicalContentHash([rawDbRow]);
    const hashFromSnapshot = computeCanonicalContentHash([snapshotRecord]);

    expect(hashFromDbRow).toBe(hashFromSnapshot);
    expect(typeof hashFromDbRow).toBe('string');
    expect(hashFromDbRow.length).toBe(64);
  });
});
