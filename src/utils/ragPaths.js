const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_DATA_DIR = path.join(PROJECT_ROOT, 'src', 'data');

function resolveFromProjectRoot(value) {
  const raw = String(value || '').trim();
  if (!raw) return raw;
  return path.isAbsolute(raw) ? raw : path.resolve(PROJECT_ROOT, raw);
}

function getRagDataDir() {
  const configuredRoot = process.env.DATA_DIR || process.env.RAG_DATA_DIR || '';
  return configuredRoot
    ? resolveFromProjectRoot(configuredRoot)
    : DEFAULT_DATA_DIR;
}

function getUploadDir() {
  return path.join(getRagDataDir(), 'uploads');
}

function getPublicMediaDir() {
  return path.join(getUploadDir(), 'public-media');
}

function getValidationUploadDir() {
  return path.join(getUploadDir(), 'validation');
}

function getRagIndexPath() {
  return process.env.RAG_INDEX_PATH
    ? resolveFromProjectRoot(process.env.RAG_INDEX_PATH)
    : path.join(getRagDataDir(), 'rag_index.json');
}

function getRagMergedIndexPath() {
  return process.env.RAG_MERGED_INDEX_PATH
    ? resolveFromProjectRoot(process.env.RAG_MERGED_INDEX_PATH)
    : path.join(getRagDataDir(), 'rag_index.merged.json');
}

function getRagBackupIndexPath() {
  return `${getRagIndexPath()}.bak`;
}

function getRagIngestDir() {
  return process.env.RAG_INGEST_DIR
    ? resolveFromProjectRoot(process.env.RAG_INGEST_DIR)
    : path.join(getRagDataDir(), 'ingest');
}

function getRagIngestChunksPath(filename = 'domains_chunks.jsonl') {
  return path.join(getRagIngestDir(), filename);
}

function getRagVecIndexDir() {
  return process.env.RAG_VEC_INDEX_DIR
    ? resolveFromProjectRoot(process.env.RAG_VEC_INDEX_DIR)
    : path.join(getRagDataDir(), 'vec_index');
}

function getRagDomainVectorsPath(filename = 'domains_vectors.jsonl') {
  if (process.env.DOMAIN_VECTORS_FILE) return resolveFromProjectRoot(process.env.DOMAIN_VECTORS_FILE);
  return path.join(getRagVecIndexDir(), filename);
}

function getLegacyRagIndexPath() {
  return path.join(DEFAULT_DATA_DIR, 'rag_index.json');
}

function isNonEmptyJsonArrayFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

module.exports = {
  PROJECT_ROOT,
  DEFAULT_DATA_DIR,
  resolveFromProjectRoot,
  getRagDataDir,
  getUploadDir,
  getPublicMediaDir,
  getValidationUploadDir,
  getRagIndexPath,
  getRagMergedIndexPath,
  getRagBackupIndexPath,
  getRagIngestDir,
  getRagIngestChunksPath,
  getRagVecIndexDir,
  getRagDomainVectorsPath,
  getLegacyRagIndexPath,
  isNonEmptyJsonArrayFile
};
