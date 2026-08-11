const fs = require('fs');
const path = require('path');
const {
  getRagIndexPath,
  getRagMergedIndexPath,
  getRagDomainVectorsPath
} = require('../src/utils/ragPaths');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const RUNTIME_DIR = path.join(PROJECT_ROOT, 'data', 'runtime');
const SNAPSHOT_ROOT = path.join(RUNTIME_DIR, 'index_snapshots');

function usage() {
  console.error('Usage: node scripts/restoreKnowledgeIndexSnapshot.js --snapshot=<snapshot_id_or_path>');
}

function resolveSnapshot(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return path.isAbsolute(raw) ? raw : path.join(SNAPSHOT_ROOT, raw);
}

function backupExisting(target) {
  if (!fs.existsSync(target)) return null;
  const backup = `${target}.restore_backup_${Date.now()}`;
  fs.copyFileSync(target, backup);
  return backup;
}

function restoreIfExists(snapshotDir, label, target) {
  const candidates = fs.readdirSync(snapshotDir).filter((name) => name.startsWith(label + '.'));
  if (!candidates.length) return null;
  const source = path.join(snapshotDir, candidates[0]);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const backup = backupExisting(target);
  fs.copyFileSync(source, target);
  return { label, source, target, backup };
}

function main() {
  const arg = process.argv.find((item) => item.startsWith('--snapshot='));
  const snapshotDir = resolveSnapshot(arg ? arg.slice('--snapshot='.length) : '');
  if (!snapshotDir || !fs.existsSync(snapshotDir)) {
    usage();
    console.error('Available snapshots:');
    if (fs.existsSync(SNAPSHOT_ROOT)) {
      for (const name of fs.readdirSync(SNAPSHOT_ROOT).slice(-20)) console.error('-', name);
    }
    process.exit(2);
  }

  const targets = [
    { label: 'rag_index', path: getRagIndexPath() },
    { label: 'rag_index_merged', path: getRagMergedIndexPath() },
    { label: 'domain_vectors', path: getRagDomainVectorsPath('domains_vectors.jsonl') },
    { label: 'knowledge_manifest', path: path.join(RUNTIME_DIR, 'knowledge_preparation_manifest.jsonl') },
    { label: 'dynamic_alias_dictionary', path: path.join(RUNTIME_DIR, 'dynamic_alias_dictionary.json') },
    { label: 'knowledge_source_registry', path: path.join(RUNTIME_DIR, 'knowledge_source_registry.json') }
  ];
  const restored = targets.map((item) => restoreIfExists(snapshotDir, item.label, item.path)).filter(Boolean);
  console.log(JSON.stringify({ ok: true, snapshotDir, restoredCount: restored.length, restored }, null, 2));
}

main();
