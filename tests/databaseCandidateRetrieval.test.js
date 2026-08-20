const {
  getActiveTrainingDataFromDb,
  computeLexicalScore,
  getDatabaseCandidates,
  retrieveSemanticContexts
} = require('../src/engine/semanticRagEngine');

// Mock Prisma
jest.mock('../src/db', () => ({
  trainingData: {
    findMany: jest.fn()
  }
}));

const prisma = require('../src/db');

beforeAll(() => {
  process.env.SEMANTIC_RAG_INDEX_CACHE_MS = '300000';
  process.env.SEMANTIC_RAG_TRAINING_DB_CACHE_MS = '300000';
  process.env.SEMANTIC_RAG_CANDIDATES = '25';
  process.env.SEMANTIC_RAG_RRF_ENABLED = 'false';
  process.env.SEMANTIC_RAG_MMR_ENABLED = 'false';
  process.env.RAG_TRACE_PERSIST = 'false';
});

afterAll(() => {
  delete process.env.SEMANTIC_RAG_INDEX_CACHE_MS;
  delete process.env.SEMANTIC_RAG_TRAINING_DB_CACHE_MS;
  delete process.env.SEMANTIC_RAG_CANDIDATES;
  delete process.env.SEMANTIC_RAG_RRF_ENABLED;
  delete process.env.SEMANTIC_RAG_MMR_ENABLED;
  delete process.env.RAG_TRACE_PERSIST;
});

// Clear cache before each test
beforeEach(() => {
  jest.clearAllMocks();
  // Clear the trainingDbCache by setting TTL to 0 temporarily
  process.env.SEMANTIC_RAG_TRAINING_DB_CACHE_MS = '0';
});

describe('database candidate retrieval', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear the trainingDbCache by setting TTL to 0
    process.env.SEMANTIC_RAG_TRAINING_DB_CACHE_MS = '0';
  });

  describe('computeLexicalScore', () => {
    test('returns 0 for empty inputs', () => {
      expect(computeLexicalScore('', 'some content')).toBe(0);
      expect(computeLexicalScore('query', '')).toBe(0);
      expect(computeLexicalScore('', '')).toBe(0);
    });

    test('returns 1.0 for exact phrase match', () => {
      const score = computeLexicalScore('biaya pendaftaran', 'biaya pendaftaran mahasiswa baru');
      expect(score).toBe(1.0);
    });

    test('computes token overlap score', () => {
      const score = computeLexicalScore('biaya daftar', 'biaya pendaftaran mahasiswa');
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(1);
    });

    test('handles short acronyms (2-5 chars) with prefix matching', () => {
      const score = computeLexicalScore('SI', 'Sistem Informasi adalah program studi');
      expect(score).toBeGreaterThanOrEqual(0.5);
    });

    test('handles short acronyms with suffix matching', () => {
      const score = computeLexicalScore('TI', 'Teknik Informatika');
      expect(score).toBeGreaterThanOrEqual(0.5);
    });

    test('gives bonus for consecutive token matches', () => {
      const score1 = computeLexicalScore('biaya pendaftaran', 'biaya pendaftaran');
      const score2 = computeLexicalScore('biaya daftar', 'biaya pendaftaran');
      expect(score1).toBeGreaterThan(score2);
    });

    test('generic acronym handling without hardcoded lists', () => {
      const scoreKSL = computeLexicalScore('KSL', 'KSL adalah unit kegiatan mahasiswa');
      const scoreUKM = computeLexicalScore('UKM', 'UKM adalah unit kegiatan mahasiswa');
      expect(scoreKSL).toBeGreaterThan(0);
      expect(scoreUKM).toBeGreaterThan(0);
    });
  });

  describe('getActiveTrainingDataFromDb', () => {
    test('fetches active training data from database', async () => {
      const mockData = [
        {
          id: 'test-id-1',
          filename: 'test.pdf',
          content: 'Biaya pendaftaran Program Studi Sistem Informasi adalah Rp 500.000',
          source: 'upload',
          divisionKey: 'akademik',
          createdAt: new Date('2026-01-01'),
          ragIngestStatus: 'success',
          ragChunkCount: 5
        }
      ];
      prisma.trainingData.findMany.mockResolvedValue(mockData);

      const result = await getActiveTrainingDataFromDb();
      expect(result).toEqual(mockData);
      expect(prisma.trainingData.findMany).toHaveBeenCalledWith({
        where: { active: true },
        select: {
          id: true,
          filename: true,
          content: true,
          source: true,
          divisionKey: true,
          createdAt: true,
          ragIngestStatus: true,
          ragChunkCount: true,
          governanceStatus: true,
          governanceOwner: true,
          governanceVersion: true,
          validFrom: true,
          validTo: true,
          governanceMetadata: true
        },
        orderBy: { createdAt: 'desc' }
      });
    });

    test('returns empty array on database error', async () => {
      prisma.trainingData.findMany.mockRejectedValue(new Error('DB error'));
      const result = await getActiveTrainingDataFromDb();
      expect(result).toEqual([]);
    });

    test('caches results for TTL period', async () => {
      const mockData = [{ id: 'test-id', content: 'test content' }];
      prisma.trainingData.findMany.mockResolvedValue(mockData);

      // Set a positive TTL for this test
      process.env.SEMANTIC_RAG_TRAINING_DB_CACHE_MS = '1000';

      await getActiveTrainingDataFromDb();
      await getActiveTrainingDataFromDb();

      // Should only call once due to caching
      expect(prisma.trainingData.findMany).toHaveBeenCalledTimes(1);

      // Reset TTL to 0 for other tests
      process.env.SEMANTIC_RAG_TRAINING_DB_CACHE_MS = '0';
    });
  });

  describe('getDatabaseCandidates', () => {
    test('converts training data to candidate chunks', async () => {
      const mockData = [
        {
          id: 'test-id-1',
          filename: 'test.pdf',
          content: 'Biaya pendaftaran Program Studi Sistem Informasi adalah Rp 500.000',
          source: 'upload',
          divisionKey: 'akademik',
          createdAt: new Date('2026-01-01'),
          ragIngestStatus: 'success',
          ragChunkCount: 5
        }
      ];
      prisma.trainingData.findMany.mockResolvedValue(mockData);

      const candidates = await getDatabaseCandidates(['biaya pendaftaran']);
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0].item).toHaveProperty('id');
      expect(candidates[0].item).toHaveProperty('chunk');
      expect(candidates[0].item).toHaveProperty('trainingId');
      expect(candidates[0].item).toHaveProperty('sourceType', 'database');
      expect(candidates[0].item).toHaveProperty('embedding', null);
    });

    test('applies lexical scoring to candidates', async () => {
      const mockData = [
        {
          id: 'test-id-1',
          filename: 'test.pdf',
          content: 'Biaya pendaftaran Program Studi Sistem Informasi',
          source: 'upload',
          divisionKey: 'akademik',
          createdAt: new Date('2026-01-01'),
          ragIngestStatus: 'success',
          ragChunkCount: 5
        }
      ];
      prisma.trainingData.findMany.mockResolvedValue(mockData);

      const candidates = await getDatabaseCandidates(['biaya pendaftaran']);
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0].lexicalScore).toBeGreaterThan(0);
      expect(candidates[0].semanticScore).toBe(0);
    });

    test('filters candidates below lexical threshold', async () => {
      const mockData = [
        {
          id: 'test-id-1',
          filename: 'test.pdf',
          content: 'Ini adalah konten yang tidak relevan sama sekali',
          source: 'upload',
          divisionKey: 'akademik',
          createdAt: new Date('2026-01-01'),
          ragIngestStatus: 'success',
          ragChunkCount: 5
        }
      ];
      prisma.trainingData.findMany.mockResolvedValue(mockData);

      const candidates = await getDatabaseCandidates(['biaya pendaftaran']);
      // The content has no overlap with the query, so it should be filtered out
      // or have a very low score
      expect(candidates.length).toBe(0);
    });

    test('handles empty training data', async () => {
      prisma.trainingData.findMany.mockResolvedValue([]);
      // Clear the cache to force a fresh DB call
      process.env.SEMANTIC_RAG_TRAINING_DB_CACHE_MS = '0';
      const candidates = await getDatabaseCandidates(['biaya pendaftaran']);
      // Should return empty array when no training data
      expect(candidates).toEqual([]);
    });

    test('deduplicates candidates by trainingId and content', async () => {
      const mockData = [
        {
          id: 'test-id-1',
          filename: 'test.pdf',
          content: 'Biaya pendaftaran Program Studi Sistem Informasi',
          source: 'upload',
          divisionKey: 'akademik',
          createdAt: new Date('2026-01-01'),
          ragIngestStatus: 'success',
          ragChunkCount: 5
        }
      ];
      prisma.trainingData.findMany.mockResolvedValue(mockData);

      const candidates = await getDatabaseCandidates(['biaya pendaftaran']);
      const uniqueIds = new Set(candidates.map(c => c.item.id));
      expect(uniqueIds.size).toBe(candidates.length);
    });

    test('sorts candidates by lexical score descending', async () => {
      const mockData = [
        {
          id: 'test-id-1',
          filename: 'high-score.pdf',
          content: 'Biaya pendaftaran Program Studi Sistem Informasi',
          source: 'upload',
          divisionKey: 'akademik',
          createdAt: new Date('2026-01-01'),
          ragIngestStatus: 'success',
          ragChunkCount: 5
        },
        {
          id: 'test-id-2',
          filename: 'low-score.pdf',
          content: 'Informasi umum tentang kampus',
          source: 'upload',
          divisionKey: 'akademik',
          createdAt: new Date('2026-01-01'),
          ragIngestStatus: 'success',
          ragChunkCount: 5
        }
      ];
      prisma.trainingData.findMany.mockResolvedValue(mockData);

      const candidates = await getDatabaseCandidates(['biaya pendaftaran']);
      if (candidates.length >= 2) {
        expect(candidates[0].lexicalScore).toBeGreaterThanOrEqual(candidates[1].lexicalScore);
      }
    });
  });

  describe('retrieveSemanticContexts integration', () => {
    test('merges semantic and database candidates', async () => {
      const mockDbData = [
        {
          id: 'db-id-1',
          filename: 'db-test.pdf',
          content: 'Biaya pendaftaran Program Studi Sistem Informasi',
          source: 'upload',
          divisionKey: 'akademik',
          createdAt: new Date('2026-01-01'),
          ragIngestStatus: 'success',
          ragChunkCount: 5
        }
      ];
      prisma.trainingData.findMany.mockResolvedValue(mockDbData);

      const result = await retrieveSemanticContexts(['biaya pendaftaran']);
      expect(result.contexts).toBeDefined();
      expect(result.indexSize).toBeGreaterThan(0);
      // Database candidates should be included in the results
      const hasDbCandidate = result.contexts.some(c => c.trainingId === 'db-id-1');
      expect(hasDbCandidate).toBe(true);
    });

    test('database candidates without embeddings are included', async () => {
      const mockDbData = [
        {
          id: 'db-id-1',
          filename: 'db-test.pdf',
          content: 'Biaya pendaftaran Program Studi Sistem Informasi',
          source: 'upload',
          divisionKey: 'akademik',
          createdAt: new Date('2026-01-01'),
          ragIngestStatus: 'pending', // No embedding yet
          ragChunkCount: 0
        }
      ];
      prisma.trainingData.findMany.mockResolvedValue(mockDbData);

      const result = await retrieveSemanticContexts(['biaya pendaftaran']);
      expect(result.contexts).toBeDefined();
      // Database candidates without embeddings should still be included via lexical scoring
      const hasDbCandidate = result.contexts.some(c => c.trainingId === 'db-id-1');
      expect(hasDbCandidate).toBe(true);
    });

    test('handles empty database and semantic index', async () => {
      prisma.trainingData.findMany.mockResolvedValue([]);
      // Note: This test may still return results from the actual semantic index file
      // We're testing that the function doesn't crash when DB is empty
      const result = await retrieveSemanticContexts(['test query']);
      expect(result.contexts).toBeDefined();
      expect(result.topScore).toBeGreaterThanOrEqual(0);
    });
  });
});


