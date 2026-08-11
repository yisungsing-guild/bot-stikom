const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  getRagIndexPath,
  getRagMergedIndexPath,
  getRagDomainVectorsPath
} = require('../src/utils/ragPaths');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const RUNTIME_DIR = path.join(PROJECT_ROOT, 'data', 'runtime');
const SNAPSHOT_ROOT = path.join(RUNTIME_DIR, 'index_snapshots');

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function fileInfo(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false, path: filePath };
  const stat = fs.statSync(filePath);
  return { exists: true, path: filePath, bytes: stat.size, sha256: sha256File(filePath) };
}

function copyIfExists(source, targetDir, label) {
  if (!fs.existsSync(source)) return null;
  const target = path.join(targetDir, `${label}${path.extname(source) || '.dat'}`);
  fs.copyFileSync(source, target);
  return { label, source, target, ...fileInfo(target) };
}

function main() {
  const labelArg = process.argv.find((arg) => arg.startsWith('--label='));
  const label = labelArg ? labelArg.slice('--label='.length).replace(/[^a-z0-9_.-]+/gi, '-').slice(0, 60) : 'manual';
  const dir = path.join(SNAPSHOT_ROOT, `${stamp()}_${label}`);
  fs.mkdirSync(dir, { recursive: true });

  const runtimeFiles = [
    { label: 'rag_index', path: getRagIndexPath() },
    { label: 'rag_index_merged', path: getRagMergedIndexPath() },
    { label: 'domain_vectors', path: getRagDomainVectorsPath('domains_vectors.jsonl') },
    { label: 'knowledge_manifest', path: path.join(RUNTIME_DIR, 'knowledge_preparation_manifest.jsonl') },
    { label: 'dynamic_alias_dictionary', path: path.join(RUNTIME_DIR, 'dynamic_alias_dictionary.json') },
    { label: 'knowledge_source_registry', path: path.join(RUNTIME_DIR, 'knowledge_source_registry.json') }
  ];

  const copied = runtimeFiles.map((item) => copyIfExists(item.path, dir, item.label)).filter(Boolean);
  const manifest = {
    version: 1,
    snapshotId: path.basename(dir),
    createdAt: new Date().toISOString(),
    label,
    copiedCount: copied.length,
    copied,
    missing: runtimeFiles.filter((item) => !fs.existsSync(item.path)).map((item) => item.label)
  };
  fs.writeFileSync(path.join(dir, 'snapshot_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log(JSON.stringify({ ok: true, snapshotDir: dir, copiedCount: copied.length, missing: manifest.missing }, null, 2));
}

main();
