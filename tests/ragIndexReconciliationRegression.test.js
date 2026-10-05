'use strict';

const fs = require('fs');
const path = require('path');
const {
  writeDeterministicRagFixture
} = require('../scripts/testFixtures/deterministicRagFixture');

const fixtureDir = path.resolve(__dirname, '../tmp/rag-reconcile-test-fixture');
const ragFixture = writeDeterministicRagFixture({ rootDir: fixtureDir });

const origIndexPath = process.env.RAG_INDEX_PATH;
const origCacheMs = process.env.SEMANTIC_RAG_RESULT_CACHE_MS;
const origOpenAiKey = process.env.OPENAI_API_KEY;

process.env.RAG_INDEX_PATH = ragFixture.indexPath;
process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
delete process.env.OPENAI_API_KEY;

// Mock db for trainingData updates and lookups
const mockDb = {
  trainingData: {
    update: jest.fn().mockResolvedValue({}),
    findUnique: jest.fn().mockImplementation(({ where }) => {
      // Return null for known orphaned ID to simulate non-existent DB row
      if (where && where.id === 'orphaned-old-training-id') {
        return Promise.resolve(null);
      }
      if (where && where.id === 'active-doc-different') {
        return Promise.resolve({ id: 'active-doc-different', active: true });
      }
      return Promise.resolve(null);
    })
  }
};

jest.mock('../src/db', () => mockDb);

const {
  ingestTrainingData,
  countTrainingChunksInIndex,
  loadIndex,
  chunkText
} = require('../src/engine/ragEngine');

function saveIndex(data) {
  fs.writeFileSync(ragFixture.indexPath, JSON.stringify(data, null, 2));
}

jest.setTimeout(45000);

describe('RAG Index Chunk Semantic Ownership & Reconciliation Regression Suite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    saveIndex(JSON.parse(JSON.stringify(ragFixture.index)));
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

  test('1. Reconciles existing identical chunks with trainingId=null without creating duplicate chunks', async () => {
    const unownedContent = `Unit Kegiatan Mahasiswa Pecinta Alam ITB STIKOM Bali adalah wadah eksplorasi dan pelestarian alam bagi mahasiswa.
Kegiatan meliputi pendakian gunung, konservasi hutan mangrove, panjat tebing, dan pelatihan navigasi darat.
Anggota baru wajib mengikuti masa bimbingan dasar dan ekspedisi pelantikan sebelum disahkan sebagai anggota tetap.`;

    const initialChunks = chunkText(unownedContent, 900, 150);
    expect(initialChunks.length).toBeGreaterThan(0);

    // Seed unowned chunk (trainingId: null) into index
    const unownedChunkId = 'chunk-unowned-mapala-001';
    const crypto = require('crypto');
    const normalize = s => String(s || '').toLowerCase().replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
    const cHash = crypto.createHash('sha256').update(normalize(initialChunks[0])).digest('hex');

    const indexBefore = loadIndex();
    const countBefore = indexBefore.length;
    indexBefore.push({
      id: unownedChunkId,
      trainingId: null,
      chunk: initialChunks[0],
      chunkHash: cHash,
      sectionTitle: 'Profil Mapala',
      chunkType: 'GENERAL',
      embedding: new Array(64).fill(0.1),
      filename: 'Profil Mapala.docx',
      sourceFile: 'Profil Mapala.docx',
      divisionKey: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    saveIndex(indexBefore);

    const targetTrainingId = 'training-mapala-active-01';
    const res = await ingestTrainingData(targetTrainingId, unownedContent, 'upload', {
      filename: 'Profil Mapala',
      sourceFile: 'Profil Mapala-1790726999999.docx',
      documentTitle: 'Profil Mapala',
      originalFilename: 'Profil Mapala.docx',
      governance: {
        status: 'approved',
        authority: 'tier_1',
        owner: 'Bagian Kemahasiswaan'
      }
    });

    expect(res.success).toBe(true);
    expect(res.qualityGate.indexed).toBe(true);
    expect(res.reconciledDuplicates).toBeGreaterThanOrEqual(1);
    expect(res.skippedDuplicates).toBe(0);

    const indexAfter = loadIndex();
    // Verify NO duplicate chunks were created: exactly 1 chunk was added in total (countBefore + 1 summary or countBefore + 1)
    const matchingChunks = indexAfter.filter(c => c && c.chunkHash === cHash);
    expect(matchingChunks.length).toBe(1);
    expect(matchingChunks[0].id).toBe(unownedChunkId);
    expect(matchingChunks[0].trainingId).toBe(targetTrainingId);
    expect(matchingChunks[0].governanceStatus).toBe('active');
  });

  test('2. Reconciles existing identical chunks with different orphaned/prior trainingId from same logical document', async () => {
    const ksrText = `PROFILE ORGANISASI
Unit Kegiatan Mahasiswa Korps Sukarela Palang Merah Indonesia (UKM KSR-PMI) merupakan organisasi kemahasiswaan berbasis kemanusiaan dan kesukarelaan yang bergerak secara resmi di bawah naungan institusi perguruan tinggi serta berafiliasi langsung dengan struktur Palang Merah Indonesia.
Dalam menjalankan roda eksistensinya, UKM KSR-PMI senantiasa berpedoman teguh pada Tujuh Prinsip Dasar Gerakan Palang Merah dan Bulan Sabit Merah Internasional.`;

    const ksrChunks = chunkText(ksrText, 900, 150);
    const crypto = require('crypto');
    const normalize = s => String(s || '').toLowerCase().replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
    const cHash = crypto.createHash('sha256').update(normalize(ksrChunks[0])).digest('hex');

    const orphanedChunkId = 'chunk-ksr-orphaned-001';
    const orphanedTrainingId = 'orphaned-old-training-id';

    const indexBefore = loadIndex();
    const totalBefore = indexBefore.length;
    indexBefore.push({
      id: orphanedChunkId,
      trainingId: orphanedTrainingId,
      chunk: ksrChunks[0],
      chunkHash: cHash,
      sectionTitle: 'Profile Singkat KSR',
      chunkType: 'GENERAL',
      embedding: new Array(64).fill(0.2),
      filename: 'Profile Singkat KSR.docx',
      sourceFile: 'Profile Singkat KSR.docx',
      divisionKey: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    saveIndex(indexBefore);

    const newTargetId = 'ea45c5ce-f9d6-4fdc-a51c-fd9ab7eb6558';
    const res = await ingestTrainingData(newTargetId, ksrText, 'upload', {
      filename: 'Profile Singkat KSR',
      sourceFile: 'Profile Singkat KSR-1790726963246.docx',
      documentTitle: 'Profile Singkat KSR',
      originalFilename: 'Profile Singkat KSR',
      governance: {
        status: 'approved',
        authority: 'tier_2'
      }
    });

    expect(res.success).toBe(true);
    expect(res.qualityGate.indexed).toBe(true);
    expect(res.indexedChunkCount).toBeGreaterThanOrEqual(1);

    const indexAfter = loadIndex();
    const matched = indexAfter.filter(c => c && c.chunkHash === cHash);
    // Exactly 1 instance exists in index (no duplicate!)
    expect(matched.length).toBe(1);
    expect(matched[0].id).toBe(orphanedChunkId);
    expect(matched[0].trainingId).toBe(newTargetId);
    // Orphaned trainingId must no longer exist on this chunk
    expect(matched[0].trainingId).not.toBe(orphanedTrainingId);
  });

  test('3. Re-ingest of the same document is strictly idempotent and retains correct chunk count', async () => {
    const docId = 'test-idempotent-ksr-reingest';
    const docText = `Profil Singkat Komunitas Robotika ITB STIKOM Bali tahun 2026.
Komunitas Robotika berfokus pada riset mikrokontroler, IoT, dan otomasi industri.
Pertemuan mingguan diadakan di Laboratorium Hardware Kampus Renon setiap hari Sabtu pagi.`;

    const res1 = await ingestTrainingData(docId, docText, 'upload', {
      filename: 'Profil Robotika',
      documentTitle: 'Profil Robotika'
    });
    expect(res1.success).toBe(true);
    const count1 = res1.indexedChunkCount;

    const indexAfterFirst = loadIndex();
    const totalAfterFirst = indexAfterFirst.length;

    // Retry / re-ingest the exact same document
    const res2 = await ingestTrainingData(docId, docText, 'upload', {
      filename: 'Profil Robotika',
      documentTitle: 'Profil Robotika'
    });
    expect(res2.success).toBe(true);
    expect(res2.indexedChunkCount).toBe(count1);

    const indexAfterSecond = loadIndex();
    expect(indexAfterSecond.length).toBe(totalAfterFirst);
    const chunksDoc = indexAfterSecond.filter(c => c && c.trainingId === docId);
    expect(chunksDoc.length).toBe(count1);
  });

  test('4. Quality gate does NOT falsely fail when chunks are reconciled', async () => {
    const docId = 'test-quality-gate-pass';
    const content = `Panduan Tata Tertib Penggunaan Perpustakaan Kampus Jimbaran ITB STIKOM Bali.
Mahasiswa wajib menunjukkan KTM saat peminjaman buku teks dan referensi skripsi.
Maksimal peminjaman adalah 3 buku dengan batas waktu 7 hari kerja yang dapat diperpanjang satu kali.`;

    const initialChunks = chunkText(content, 900, 150);
    const crypto = require('crypto');
    const normalize = s => String(s || '').toLowerCase().replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
    const cHash = crypto.createHash('sha256').update(normalize(initialChunks[0])).digest('hex');

    // Pre-seed an unassigned chunk
    const idx = loadIndex();
    idx.push({
      id: 'chunk-perpus-unassigned',
      trainingId: null,
      chunk: initialChunks[0],
      chunkHash: cHash,
      filename: 'Tata Tertib Perpustakaan.pdf',
      divisionKey: null,
      embedding: new Array(64).fill(0.3)
    });
    saveIndex(idx);

    const res = await ingestTrainingData(docId, content, 'upload', {
      filename: 'Tata Tertib Perpustakaan',
      documentTitle: 'Tata Tertib Perpustakaan'
    });

    expect(res.success).toBe(true);
    expect(res.qualityGate.indexed).toBe(true);
    expect(res.qualityGate.chunksInIndex).toBeGreaterThan(0);
    expect(res.qualityGate.skippedDuplicates).toBe(0);
    expect(res.qualityGate.reconciledDuplicates).toBeGreaterThanOrEqual(1);
  });

  test('5. Genuine duplicate content from a DIFFERENT ACTIVE document is NOT stolen or duplicated', async () => {
    // Document A is active and has different logical name
    const activeDocId = 'active-doc-different';
    const sharedParagraph = `KETENTUAN UMUM BEASISWA INSTITUT TEKNOLOGI DAN BISNIS STIKOM BALI TAHUN AKADEMIK 2026/2027:
Seluruh mahasiswa penerima beasiswa wajib memenuhi ketentuan akademik dan tata tertib yang berlaku di lingkungan kampus.
1. Mahasiswa wajib terdaftar aktif sebagai mahasiswa program Sarjana atau Diploma pada semester berjalan dan tidak sedang cuti kuliah.
2. Mahasiswa tidak sedang menerima beasiswa dari pihak sponsor lain, instansi pemerintah, maupun yayasan mitra pada periode yang sama.
3. Mahasiswa wajib mempertahankan Indeks Prestasi Kumulatif (IPK) minimal sesuai standar masing-masing skema beasiswa setiap semester.
4. Mahasiswa tidak sedang menjalani sanksi pelanggaran kode etik akademik maupun tata tertib kemahasiswaan dari dekanat fakultas maupun rektorat.
5. Mahasiswa bersedia berkontribusi aktif dalam kegiatan sosial kemahasiswaan, promosi kampus, dan pendampingan akademik mahasiswa baru.
6. Mahasiswa wajib mengumpulkan laporan kemajuan studi dan transkrip nilai resmi secara berkala kepada Biro Kemahasiswaan ITB STIKOM Bali.
7. Pelanggaran terhadap salah satu ketentuan di atas dapat mengakibatkan pencabutan status beasiswa secara sepihak oleh pimpinan institusi.
Ketentuan umum ini merupakan ketetapan resmi yang mengikat bagi seluruh penerima beasiswa di lingkungan ITB STIKOM Bali.`;

    const crypto = require('crypto');
    const normalize = s => String(s || '').toLowerCase().replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
    const sharedChunks = chunkText(sharedParagraph, 900, 150);
    const sharedHash = crypto.createHash('sha256').update(normalize(sharedChunks[0])).digest('hex');

    const idx = loadIndex();
    const docAChunkId = 'chunk-doc-a-beasiswa-umum';
    idx.push({
      id: docAChunkId,
      trainingId: activeDocId,
      chunk: sharedChunks[0],
      chunkHash: sharedHash,
      filename: 'Buku Pedoman Beasiswa Yayasan.pdf',
      sourceFile: 'Buku Pedoman Beasiswa Yayasan.pdf',
      documentTitle: 'Pedoman Beasiswa Yayasan',
      divisionKey: null,
      governanceStatus: 'active',
      authorityTier: 'tier_1',
      embedding: new Array(64).fill(0.4)
    });
    saveIndex(idx);

    // Document B is a DIFFERENT logical document that shares this paragraph but has other unique content
    const docBId = 'doc-b-diskon-alumni';
    const docBContent = `${sharedParagraph}

Program Kemitraan Khusus Alumni ITB STIKOM Bali Tahun 2026.
Program Kemitraan Khusus Alumni memberikan potongan biaya kuliah sebesar 25% pada semester pertama bagi keluarga inti alumni yang mendaftar pada Gelombang 1 tahun 2026.
Pendaftaran dilakukan melalui portal resmi PMB dengan mengunggah ijazah atau kartu alumni legalisir dari Ikatan Alumni ITB STIKOM Bali.
Potongan berlaku untuk seluruh program studi Sarjana dan Diploma baik kelas reguler pagi maupun reguler malam.
Persyaratan pendaftaran meliputi fotokopi kartu keluarga, ijazah SMA/SMK sederajat, dan surat rekomendasi dari pengurus Ikatan Alumni.`;

    const resB = await ingestTrainingData(docBId, docBContent, 'upload', {
      filename: 'Program Diskon Alumni',
      sourceFile: 'Program Diskon Alumni.pdf',
      documentTitle: 'Program Diskon Alumni'
    });

    expect(resB.success).toBe(true);
    // Shared chunk was skipped (not stolen from Doc A and not duplicated)
    expect(resB.skippedDuplicates).toBeGreaterThanOrEqual(1);

    const finalIndex = loadIndex();
    // Doc A must STILL own its original chunk!
    const chunkA = finalIndex.find(c => c && c.id === docAChunkId);
    expect(chunkA).toBeDefined();
    expect(chunkA.trainingId).toBe(activeDocId);
    expect(chunkA.filename).toBe('Buku Pedoman Beasiswa Yayasan.pdf');

    // No duplicate chunk for sharedHash was created
    const allShared = finalIndex.filter(c => c && c.chunkHash === sharedHash);
    expect(allShared.length).toBe(1);
  });
});
