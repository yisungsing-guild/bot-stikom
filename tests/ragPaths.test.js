const path = require('path');
const { getRagDataDir, getRagIndexPath, getUploadDir, getPublicMediaDir } = require('../src/utils/ragPaths');

describe('runtime storage paths', () => {
  const originalDataDir = process.env.DATA_DIR;
  const originalRagDataDir = process.env.RAG_DATA_DIR;
  const originalRagIndexPath = process.env.RAG_INDEX_PATH;
  const originalRagMergedIndexPath = process.env.RAG_MERGED_INDEX_PATH;
  const originalRagIngestDir = process.env.RAG_INGEST_DIR;
  const originalRagVecIndexDir = process.env.RAG_VEC_INDEX_DIR;

  beforeEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.RAG_DATA_DIR;
    delete process.env.RAG_INDEX_PATH;
    delete process.env.RAG_MERGED_INDEX_PATH;
    delete process.env.RAG_INGEST_DIR;
    delete process.env.RAG_VEC_INDEX_DIR;
  });

  afterAll(() => {
    if (typeof originalDataDir === 'undefined') delete process.env.DATA_DIR; else process.env.DATA_DIR = originalDataDir;
    if (typeof originalRagDataDir === 'undefined') delete process.env.RAG_DATA_DIR; else process.env.RAG_DATA_DIR = originalRagDataDir;
    if (typeof originalRagIndexPath === 'undefined') delete process.env.RAG_INDEX_PATH; else process.env.RAG_INDEX_PATH = originalRagIndexPath;
    if (typeof originalRagMergedIndexPath === 'undefined') delete process.env.RAG_MERGED_INDEX_PATH; else process.env.RAG_MERGED_INDEX_PATH = originalRagMergedIndexPath;
    if (typeof originalRagIngestDir === 'undefined') delete process.env.RAG_INGEST_DIR; else process.env.RAG_INGEST_DIR = originalRagIngestDir;
    if (typeof originalRagVecIndexDir === 'undefined') delete process.env.RAG_VEC_INDEX_DIR; else process.env.RAG_VEC_INDEX_DIR = originalRagVecIndexDir;
  });

  test('uses DATA_DIR as the centralized runtime storage root', () => {
    process.env.DATA_DIR = '/tmp/railway-data';

    expect(getRagDataDir()).toBe('/tmp/railway-data');
    expect(getRagIndexPath()).toBe(path.join('/tmp/railway-data', 'rag_index.json'));
    expect(getUploadDir()).toBe(path.join('/tmp/railway-data', 'uploads'));
    expect(getPublicMediaDir()).toBe(path.join('/tmp/railway-data', 'uploads', 'public-media'));
  });
});
