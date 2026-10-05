'use strict';

const fs = require('fs');
const path = require('path');
const {
  writeDeterministicRagFixture,
  fileSnapshot
} = require('../scripts/testFixtures/deterministicRagFixture');

const fixtureDir = path.resolve(__dirname, '../tmp/rag-reliability-test-fixture');
const ragFixture = writeDeterministicRagFixture({ rootDir: fixtureDir });

const origIndexPath = process.env.RAG_INDEX_PATH;
const origCacheMs = process.env.SEMANTIC_RAG_RESULT_CACHE_MS;
const origOpenAiKey = process.env.OPENAI_API_KEY;

process.env.RAG_INDEX_PATH = ragFixture.indexPath;
process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
delete process.env.OPENAI_API_KEY;

// Mock db for trainingData updates
const mockTrainingDataUpdate = jest.fn().mockResolvedValue({});
jest.mock('../src/db', () => ({
  trainingData: {
    update: (...args) => mockTrainingDataUpdate(...args),
    findUnique: jest.fn().mockResolvedValue(null)
  }
}));

const {
  ingestTrainingData,
  countTrainingChunksInIndex,
  loadIndex,
  getIndexPath
} = require('../src/engine/ragEngine');

jest.setTimeout(45000);

describe('Training Data / RAG Retrain Reliability & Concurrency Suite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    if (origIndexPath !== undefined) {
      process.env.RAG_INDEX_PATH = origIndexPath;
    } else {
      delete process.env.RAG_INDEX_PATH;
    }
    if (origCacheMs !== undefined) {
      process.env.SEMANTIC_RAG_RESULT_CACHE_MS = origCacheMs;
    } else {
      delete process.env.SEMANTIC_RAG_RESULT_CACHE_MS;
    }
    if (origOpenAiKey !== undefined) {
      process.env.OPENAI_API_KEY = origOpenAiKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
    try {
      if (fs.existsSync(fixtureDir)) {
        fs.rmSync(fixtureDir, { recursive: true, force: true });
      }
    } catch (_) {}
  });

  test('1. Normal document ingestion succeeds and passes quality gate', async () => {
    const trainingId = 'test-doc-normal-01';
    const content = `Profil Program Studi Sistem Informasi ITB STIKOM Bali.
Program Studi Sistem Informasi menghasilkan sarjana komputer yang kompeten dalam bidang rekayasa sistem informasi, tata kelola teknologi informasi, dan analisis bisnis berbasis digital.
Kurikulum dirancang sesuai standar internasional dengan masa studi 8 semester (4 tahun) dan total 144 SKS.
Lulusan dapat berkarier sebagai Systems Analyst, IT Project Manager, Data Analyst, atau Enterprise Architect.`;

    const res = await ingestTrainingData(trainingId, content, 'upload', {
      documentTitle: 'Profil Program Studi Sistem Informasi',
      filename: 'profil_si.txt',
      divisionKey: 'akademik',
      governance: {
        status: 'approved',
        authority: 'tier_1'
      }
    });

    expect(res.success).toBe(true);
    expect(res.indexedChunkCount).toBeGreaterThan(0);
    expect(res.qualityGate.indexed).toBe(true);

    const index = loadIndex();
    const count = countTrainingChunksInIndex(index, trainingId);
    expect(count).toBe(res.indexedChunkCount);

    expect(mockTrainingDataUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: trainingId },
        data: expect.objectContaining({
          ragIngestStatus: 'success',
          ragChunkCount: count
        })
      })
    );
  });

  test('2. Concurrent document ingestion (5 simultaneous jobs) serializes safely without clobbering', async () => {
    const docIds = ['concurrent-doc-A', 'concurrent-doc-B', 'concurrent-doc-C', 'concurrent-doc-D', 'concurrent-doc-E'];

    const jobs = docIds.map((id, index) => {
      const content = `Informasi resmi Unit Kegiatan Mahasiswa ${id} ITB STIKOM Bali tahun akademik 2026/2027.
Organisasi ini bertujuan untuk mengembangkan bakat dan minat mahasiswa dalam bidang terkait.
Kegiatan rutin diadakan setiap minggu di Kampus Renon dengan bimbingan dosen pembina dan senior berpengalaman.
Pendaftaran anggota baru dibuka pada setiap awal semester ganjil bagi seluruh mahasiswa aktif program S1 maupun D3.
Syarat pendaftaran meliputi pengisian formulir online, fotokopi KTM aktif, dan pasfoto terbaru.`;

      return ingestTrainingData(id, content, 'upload', {
        documentTitle: `Profil Ormawa ${id}`,
        filename: `${id}.pdf`,
        divisionKey: 'kemahasiswaan',
        governance: { status: 'approved', authority: 'tier_2' }
      });
    });

    // Run all 5 concurrently
    const results = await Promise.all(jobs);

    // Every job must succeed
    results.forEach((res, i) => {
      expect(res.success).toBe(true);
      expect(res.qualityGate.indexed).toBe(true);
      expect(res.indexedChunkCount).toBeGreaterThan(0);
    });

    // Check that ALL 5 documents are present in the final persisted index (no clobbering!)
    const finalIndex = loadIndex();
    for (const id of docIds) {
      const countInIndex = countTrainingChunksInIndex(finalIndex, id);
      expect(countInIndex).toBeGreaterThan(0);
    }
  });

  test('3. Stub / short content (under minimum threshold) is cleanly rejected by validation', async () => {
    const stubTrainingId = 'test-doc-stub-short';
    const stubContent = 'PROFILE DPM\n'; // 12 characters only, exactly mimicking the 1 rejected production document

    const res = await ingestTrainingData(stubTrainingId, stubContent, 'upload', {
      documentTitle: 'PROFILE DPM',
      filename: 'PROFILE DPM.pdf',
      divisionKey: 'kemahasiswaan'
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe('rejected');
    expect(res.reason).toMatch(/too short|meaningful/i);

    const index = loadIndex();
    const count = countTrainingChunksInIndex(index, stubTrainingId);
    expect(count).toBe(0);

    expect(mockTrainingDataUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: stubTrainingId },
        data: expect.objectContaining({
          ragIngestStatus: 'rejected',
          ragIngestError: expect.stringMatching(/content too short|too short/i)
        })
      })
    );
  });

  test('4. Idempotent retrain replaces existing chunks cleanly without duplication', async () => {
    const retrainId = 'test-doc-idempotent-01';
    const contentV1 = `Panduan Beasiswa Prestasi Akademik ITB STIKOM Bali versi 1.
Beasiswa ini memberikan potongan biaya kuliah sebesar 50% selama satu tahun akademik penuh.
Penerima beasiswa wajib mempertahankan IPK minimal 3.50 setiap semesternya.`;

    const resV1 = await ingestTrainingData(retrainId, contentV1, 'upload', {
      documentTitle: 'Panduan Beasiswa Prestasi Akademik',
      filename: 'beasiswa_prestasi.pdf'
    });
    expect(resV1.success).toBe(true);
    const countV1 = resV1.indexedChunkCount;

    const contentV2 = `Panduan Beasiswa Prestasi Akademik ITB STIKOM Bali versi 2 revisi terbaru.
Beasiswa ini memberikan potongan biaya kuliah sebesar 75% selama satu tahun akademik penuh bagi mahasiswa berprestasi nasional.
Penerima beasiswa wajib mempertahankan IPK minimal 3.75 setiap semesternya dan aktif dalam perlombaan ilmiah tingkat nasional maupun internasional.`;

    const resV2 = await ingestTrainingData(retrainId, contentV2, 'upload', {
      documentTitle: 'Panduan Beasiswa Prestasi Akademik Revisi',
      filename: 'beasiswa_prestasi.pdf'
    });
    expect(resV2.success).toBe(true);

    const finalIndex = loadIndex();
    const countV2 = countTrainingChunksInIndex(finalIndex, retrainId);
    expect(countV2).toBe(resV2.indexedChunkCount);

    // Chunks must be updated to V2 text, not stacked or duplicated
    const chunks = finalIndex.filter(c => c && c.trainingId === retrainId);
    expect(chunks.some(c => c.chunk && c.chunk.includes('75%'))).toBe(true);
    expect(chunks.some(c => c.chunk && c.chunk.includes('50%'))).toBe(false);
  });

  test('5. Retrain preserves governance metadata in enriched chunks', async () => {
    const govId = 'test-doc-governance-preservation';
    const content = `Surat Keputusan Rektor tentang Pelaksanaan Wisuda dan Yudisium ITB STIKOM Bali Tahun 2026.
Yudisium Periode I dilaksanakan pada bulan Maret 2026 dan Yudisium Periode II dilaksanakan pada bulan September 2026.
Seluruh calon wisudawan wajib melengkapi persyaratan administrasi dan bebas pinjaman perpustakaan selambat-lambatnya 2 minggu sebelum tanggal sidang yudisium.`;

    const res = await ingestTrainingData(govId, content, 'upload', {
      documentTitle: 'SK Rektor Pelaksanaan Wisuda 2026',
      filename: 'sk_wisuda_2026.pdf',
      divisionKey: 'akademik',
      governance: {
        status: 'approved',
        authority: 'tier_1',
        owner: 'Biro Administrasi Akademik',
        version: '1.0'
      }
    });

    expect(res.success).toBe(true);
    const index = loadIndex();
    const docChunks = index.filter(c => c && c.trainingId === govId);
    expect(docChunks.length).toBeGreaterThan(0);
    for (const c of docChunks) {
      expect(c.governanceStatus).toBe('active');
      expect(c.authorityTier).toBe(1);
      expect(c.authority).toBe('tier_1_official_decree');
    }
  });
});
