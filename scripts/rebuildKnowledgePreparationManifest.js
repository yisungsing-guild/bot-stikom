const fs = require('fs');
const prisma = require('../src/db');
const {
  MANIFEST_PATH,
  prepareKnowledgeDocument,
  appendKnowledgePreparationManifest
} = require('../src/engine/knowledgePreparationPipeline');

function parseArgs(argv) {
  const args = { limit: 500, reset: false, updateDb: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--reset') args.reset = true;
    else if (arg === '--update-db') args.updateDb = true;
    else if (arg === '--limit') args.limit = Math.max(1, Number(argv[++i] || args.limit));
    else if (arg.startsWith('--limit=')) args.limit = Math.max(1, Number(arg.slice('--limit='.length) || args.limit));
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.reset && fs.existsSync(MANIFEST_PATH)) fs.unlinkSync(MANIFEST_PATH);

  const rows = await prisma.trainingData.findMany({
    where: { active: true },
    orderBy: { updatedAt: 'desc' },
    take: args.limit
  });

  let prepared = 0;
  let reviewRequired = 0;
  const byCategory = {};

  for (const row of rows) {
    const record = prepareKnowledgeDocument({
      content: row.content,
      filename: row.filename,
      sourceUrl: row.sourceUrl,
      trainingDataId: row.id,
      divisionKey: row.divisionKey,
      storageType: row.storageType || row.source
    });
    appendKnowledgePreparationManifest(record);
    prepared += 1;
    byCategory[record.documentUnderstanding.category] = (byCategory[record.documentUnderstanding.category] || 0) + 1;
    if (record.qualityControl.approval.status === 'review_required') reviewRequired += 1;

    if (args.updateDb) {
      try {
        await prisma.trainingData.update({
          where: { id: row.id },
          data: {
            governanceMetadata: {
              ...(row.governanceMetadata && typeof row.governanceMetadata === 'object' ? row.governanceMetadata : {}),
              knowledgePreparation: {
                version: record.version,
                generatedAt: record.generatedAt,
                category: record.documentUnderstanding.category,
                quality: record.qualityControl.quality,
                approval: record.qualityControl.approval,
                aliasCount: record.documentUnderstanding.aliases.length,
                factCandidateCount: record.knowledgeExtraction.factCandidates.length,
                ruleCandidateCount: record.knowledgeExtraction.ruleCandidates.length,
                faqCandidateCount: record.knowledgeExtraction.faqCandidates.length,
                conflictSignals: record.qualityControl.conflictSignals,
                duplicateSignals: record.qualityControl.duplicateSignals,
                indexingPlan: record.indexingPlan
              }
            }
          }
        });
      } catch (err) {
        console.warn('[KnowledgePrep] DB metadata update skipped for', row.id, err && err.message ? err.message : String(err));
      }
    }
  }

  console.log(JSON.stringify({
    ok: true,
    manifestPath: MANIFEST_PATH,
    prepared,
    reviewRequired,
    byCategory
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
}).finally(async () => {
  try { await prisma.$disconnect(); } catch (_) {}
});
