'use strict';

/**
 * scripts/migrate_pgvector_chunks.js
 *
 * Idempotent pgvector Migration Tool for Canonical Corpus Chunks.
 *
 * Features:
 * - Strict canonical corpus hash verification (SHA-256 = 787bfb8fb46a56d308a832a1d97a79447207c10a369e2172f78d267fe3bda4b4)
 * - Record count verification (829 records)
 * - Dry-run mode (--dry-run): performs zero DDL, zero DB mutations, zero OpenAI calls
 * - Stable embedding versioning (text-embedding-3-small-1536-corpus-787bfb8f-v1)
 * - Deterministic UUID generation per (source_record_id, subchunk_index, embedding_version)
 * - Non-duplication of legacy embeddings into raw_metadata JSONB (preserves legacy_embedding_dimension & legacy_embedding_sha256)
 * - Invalid records (2) excluded: vector_search_enabled=false, embedding=NULL, remediation_status='INVALID_FRAGMENT'
 * - Oversized record (1) deferred: vector_search_enabled=false, embedding=NULL, remediation_status='DEFERRED_RECHUNK'
 * - Rate-limited, bounded-batch OpenAI embedding generation with exponential backoff (for live migration)
 * - Parameterized idempotent SQL upsert
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v5: uuidv5 } = require('uuid');

const CANONICAL_CORPUS_SHA256 = '787bfb8fb46a56d308a832a1d97a79447207c10a369e2172f78d267fe3bda4b4';
const EXPECTED_RECORD_COUNT = 829;
const EMBEDDING_VERSION = 'text-embedding-3-small-1536-corpus-787bfb8f-v1';
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSION = 1536;

const UUID_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // Standard DNS namespace

const EXCLUDED_INVALID_IDS = new Set([
  '60ffb774-824b-4c20-a6b8-9f085208587f',
  '57aeef6a-2475-4e2d-b8fc-0b05867159d9'
]);

const DEFERRED_OVERSIZED_IDS = new Set([
  '45a70421-cbc7-45c0-bbd1-3fba1d776d8b'
]);

function computeSha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function resolveCorpusPath() {
  const possiblePaths = [
    process.env.RAG_INDEX_PATH,
    '/data/rag_index.json',
    path.resolve(__dirname, '..', 'data', 'runtime', 'index_snapshots', '2026-08-11T04-14-17-889Z_before-final-knowledgeprep-deploy', 'rag_index.json'),
    path.resolve(__dirname, '..', 'src', 'data', 'rag_index.json')
  ].filter(Boolean);

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      const buffer = fs.readFileSync(p);
      const hash = computeSha256(buffer);
      if (hash === CANONICAL_CORPUS_SHA256) {
        return { path: p, buffer, hash };
      }
    }
  }

  // If none matched exact hash, return first existing for error reporting
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      const buffer = fs.readFileSync(p);
      return { path: p, buffer, hash: computeSha256(buffer) };
    }
  }

  throw new Error('[MIGRATE] No corpus file could be found at candidate paths.');
}

function generateDeterministicChunkId(sourceRecordId, subchunkIndex, embeddingVersion) {
  const name = `${sourceRecordId}:${subchunkIndex}:${embeddingVersion}`;
  return uuidv5(name, UUID_NAMESPACE);
}

function sanitizeRawMetadata(record) {
  const meta = { ...record };
  const legacyEmb = record.embedding;
  if (Array.isArray(legacyEmb)) {
    meta.legacy_embedding_dimension = legacyEmb.length;
    meta.legacy_embedding_sha256 = computeSha256(Buffer.from(new Float32Array(legacyEmb).buffer));
  }
  delete meta.embedding;
  return meta;
}

function buildMigrationPlan(records, corpusSha256) {
  const plan = [];
  let searchableCount = 0;
  let invalidExcludedCount = 0;
  let oversizedDeferredCount = 0;

  for (let idx = 0; idx < records.length; idx++) {
    const r = records[idx];
    const sourceRecordId = r.id;
    const subchunkIndex = 0;
    const vectorChunkId = generateDeterministicChunkId(sourceRecordId, subchunkIndex, EMBEDDING_VERSION);
    const chunkText = String(r.chunk || '');
    const chunkHash = r.chunkHash || computeSha256(chunkText);
    const embeddingInputSha256 = computeSha256(chunkText);

    let vectorSearchEnabled = false;
    let remediationStatus = null;
    let eligibleForEmbedding = false;

    if (EXCLUDED_INVALID_IDS.has(sourceRecordId)) {
      vectorSearchEnabled = false;
      remediationStatus = 'INVALID_FRAGMENT';
      invalidExcludedCount++;
    } else if (DEFERRED_OVERSIZED_IDS.has(sourceRecordId)) {
      vectorSearchEnabled = false;
      remediationStatus = 'DEFERRED_RECHUNK';
      oversizedDeferredCount++;
    } else {
      vectorSearchEnabled = true;
      eligibleForEmbedding = true;
      searchableCount++;
    }

    const rawMetadata = sanitizeRawMetadata(r);

    plan.push({
      vector_chunk_id: vectorChunkId,
      source_record_id: sourceRecordId,
      source_record_index: idx,
      subchunk_index: subchunkIndex,
      corpus_sha256: corpusSha256,
      chunk: chunkText,
      chunk_hash: chunkHash,
      embedding_model: eligibleForEmbedding ? EMBEDDING_MODEL : null,
      embedding_dimension: eligibleForEmbedding ? EMBEDDING_DIMENSION : null,
      embedding_version: EMBEDDING_VERSION,
      embedding_input_sha256: embeddingInputSha256,
      vector_search_enabled: vectorSearchEnabled,
      source_file: r.sourceFile || r.filename || null,
      section_title: r.sectionTitle || null,
      source_type: r.source || null,
      training_id: r.trainingId || null,
      doc_category: r.docCategory || null,
      category: r.category || null,
      program: r.program || null,
      program_name: r.programName || null,
      campus: r.campus || null,
      academic_year: r.academicYear || null,
      wave: r.wave || null,
      jalur: r.jalur || null,
      fee_type: r.feeType || null,
      low_confidence: typeof r.lowConfidence === 'boolean' ? r.lowConfidence : null,
      ocr_quality_score: typeof r.ocrQualityScore === 'number' ? r.ocrQualityScore : null,
      raw_metadata: rawMetadata,
      remediation_status: remediationStatus,
      eligibleForEmbedding
    });
  }

  return {
    plan,
    totalRecords: records.length,
    searchableCount,
    invalidExcludedCount,
    oversizedDeferredCount
  };
}

const DDL_STATEMENTS = [
  `CREATE SCHEMA IF NOT EXISTS rag;`,
  `CREATE TABLE IF NOT EXISTS rag.corpus_vector_chunks (
    vector_chunk_id UUID PRIMARY KEY,
    source_record_id UUID NOT NULL,
    source_record_index INTEGER NOT NULL,
    subchunk_index INTEGER NOT NULL DEFAULT 0,
    corpus_sha256 VARCHAR(64) NOT NULL,
    chunk TEXT NOT NULL,
    chunk_hash VARCHAR(64) NOT NULL,
    embedding vector(1536) NULL,
    embedding_model VARCHAR(64) NULL,
    embedding_dimension INTEGER NULL,
    embedding_version VARCHAR(64) NULL,
    embedding_input_sha256 VARCHAR(64) NULL,
    vector_search_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    source_file TEXT NULL,
    section_title TEXT NULL,
    source_type VARCHAR(64) NULL,
    training_id UUID NULL,
    doc_category VARCHAR(64) NULL,
    category VARCHAR(64) NULL,
    program VARCHAR(64) NULL,
    program_name TEXT NULL,
    campus VARCHAR(64) NULL,
    academic_year VARCHAR(64) NULL,
    wave VARCHAR(64) NULL,
    jalur VARCHAR(64) NULL,
    fee_type VARCHAR(64) NULL,
    low_confidence BOOLEAN NULL,
    ocr_quality_score DOUBLE PRECISION NULL,
    raw_metadata JSONB NOT NULL,
    remediation_status VARCHAR(64) NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_source_subchunk_version UNIQUE (source_record_id, subchunk_index, embedding_version)
  );`,
  `CREATE INDEX IF NOT EXISTS corpus_chunks_embedding_hnsw_idx 
    ON rag.corpus_vector_chunks 
    USING hnsw (embedding vector_cosine_ops) 
    WHERE embedding IS NOT NULL;`,
  `CREATE INDEX IF NOT EXISTS corpus_chunks_search_idx 
    ON rag.corpus_vector_chunks (vector_search_enabled, embedding_version) 
    WHERE vector_search_enabled = true;`,
  `CREATE INDEX IF NOT EXISTS corpus_chunks_source_rec_idx 
    ON rag.corpus_vector_chunks (source_record_id);`,
  `CREATE INDEX IF NOT EXISTS corpus_chunks_chunk_hash_idx 
    ON rag.corpus_vector_chunks (chunk_hash);`
];

async function runMigration({ isDryRun = true, prismaClient = null } = {}) {
  const result = {
    isDryRun,
    corpusPath: null,
    corpusSha256: null,
    recordCount: 0,
    searchableCount: 0,
    invalidExcludedCount: 0,
    oversizedDeferredCount: 0,
    trainingIdNonNullCount: 0,
    trainingIdInvalidUuidCount: 0,
    trainingIdSqlType: 'UUID',
    embeddingVersion: EMBEDDING_VERSION,
    embeddingInputHashEnabled: true,
    dbMutationCount: 0,
    planSummary: null,
    status: 'PENDING'
  };

  const resolved = resolveCorpusPath();
  result.corpusPath = resolved.path;
  result.corpusSha256 = resolved.hash;

  if (resolved.hash !== CANONICAL_CORPUS_SHA256) {
    result.status = 'FAILED_HASH_MISMATCH';
    throw new Error(`[MIGRATE] Corpus SHA-256 mismatch! Found: ${resolved.hash}, Expected: ${CANONICAL_CORPUS_SHA256}`);
  }

  const rawJson = resolved.buffer.toString('utf8');
  let records;
  try {
    records = JSON.parse(rawJson);
  } catch (err) {
    result.status = 'FAILED_PARSE_ERROR';
    throw new Error(`[MIGRATE] Failed to parse JSON corpus: ${err.message}`);
  }

  if (!Array.isArray(records) || records.length !== EXPECTED_RECORD_COUNT) {
    result.status = 'FAILED_RECORD_COUNT_MISMATCH';
    throw new Error(`[MIGRATE] Corpus record count mismatch! Found: ${records?.length}, Expected: ${EXPECTED_RECORD_COUNT}`);
  }

  result.recordCount = records.length;

  // Validate training_id UUID compliance across all records
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  let nonNullTid = 0;
  let invalidTid = 0;
  for (const r of records) {
    if (r.trainingId !== null && r.trainingId !== undefined) {
      nonNullTid++;
      if (!uuidRegex.test(String(r.trainingId).trim())) {
        invalidTid++;
      }
    }
  }
  result.trainingIdNonNullCount = nonNullTid;
  result.trainingIdInvalidUuidCount = invalidTid;
  result.trainingIdSqlType = invalidTid === 0 ? 'UUID' : 'VARCHAR(64)';

  const planInfo = buildMigrationPlan(records, resolved.hash);
  result.searchableCount = planInfo.searchableCount;
  result.invalidExcludedCount = planInfo.invalidExcludedCount;
  result.oversizedDeferredCount = planInfo.oversizedDeferredCount;

  if (isDryRun) {
    result.dbMutationCount = 0;
    result.status = 'DRY_RUN_SUCCESS';
    result.planSummary = {
      totalRepresentedRecords: planInfo.totalRecords,
      searchableEligibleForVector: planInfo.searchableCount,
      invalidExcludedNoVector: planInfo.invalidExcludedCount,
      oversizedDeferredNoVector: planInfo.oversizedDeferredCount,
      targetTable: 'rag.corpus_vector_chunks',
      dbMutationsExecuted: 0,
      openAiApiCallsExecuted: 0
    };
    return result;
  }

  // Live migration path
  const prisma = prismaClient || require('../src/db');
  const { OpenAI } = require('openai');
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('[MIGRATE] OPENAI_API_KEY is not configured for live embedding generation.');
  }
  const client = new OpenAI({ apiKey });

  // 1. Execute DDL
  for (const sql of DDL_STATEMENTS) {
    await prisma.$executeRawUnsafe(sql);
  }

  // 2. Query existing rows for this embedding_version to guarantee idempotency
  const existingRows = await prisma.$queryRawUnsafe(`
    SELECT source_record_id, subchunk_index, (embedding IS NOT NULL) as has_embedding, vector_search_enabled
    FROM rag.corpus_vector_chunks
    WHERE embedding_version = $1;
  `, EMBEDDING_VERSION);

  const existingMap = new Map();
  for (const row of existingRows) {
    existingMap.set(`${row.source_record_id}:${row.subchunk_index}`, row);
  }

  let freshEmbeddingCount = 0;
  let openAiCallCount = 0;
  let dbMutationCount = 0;

  const upsertItem = async (item, embeddingVector = null) => {
    const rawMetaJson = JSON.stringify(item.raw_metadata || {});
    const embStr = embeddingVector ? `[${embeddingVector.join(',')}]` : null;

    await prisma.$executeRawUnsafe(`
      INSERT INTO rag.corpus_vector_chunks (
        vector_chunk_id,
        source_record_id,
        source_record_index,
        subchunk_index,
        corpus_sha256,
        chunk,
        chunk_hash,
        embedding,
        embedding_model,
        embedding_dimension,
        embedding_version,
        embedding_input_sha256,
        vector_search_enabled,
        source_file,
        section_title,
        source_type,
        training_id,
        doc_category,
        category,
        program,
        program_name,
        campus,
        academic_year,
        wave,
        jalur,
        fee_type,
        low_confidence,
        ocr_quality_score,
        raw_metadata,
        remediation_status
      ) VALUES (
        $1::uuid,
        $2::uuid,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8::vector,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14,
        $15,
        $16,
        $17::uuid,
        $18,
        $19,
        $20,
        $21,
        $22,
        $23,
        $24,
        $25,
        $26,
        $27,
        $28,
        $29::jsonb,
        $30
      )
      ON CONFLICT (source_record_id, subchunk_index, embedding_version) DO UPDATE SET
        chunk = EXCLUDED.chunk,
        chunk_hash = EXCLUDED.chunk_hash,
        embedding = EXCLUDED.embedding,
        embedding_model = EXCLUDED.embedding_model,
        embedding_dimension = EXCLUDED.embedding_dimension,
        embedding_input_sha256 = EXCLUDED.embedding_input_sha256,
        vector_search_enabled = EXCLUDED.vector_search_enabled,
        source_file = EXCLUDED.source_file,
        section_title = EXCLUDED.section_title,
        source_type = EXCLUDED.source_type,
        training_id = EXCLUDED.training_id,
        doc_category = EXCLUDED.doc_category,
        category = EXCLUDED.category,
        program = EXCLUDED.program,
        program_name = EXCLUDED.program_name,
        campus = EXCLUDED.campus,
        academic_year = EXCLUDED.academic_year,
        wave = EXCLUDED.wave,
        jalur = EXCLUDED.jalur,
        fee_type = EXCLUDED.fee_type,
        low_confidence = EXCLUDED.low_confidence,
        ocr_quality_score = EXCLUDED.ocr_quality_score,
        raw_metadata = EXCLUDED.raw_metadata,
        remediation_status = EXCLUDED.remediation_status,
        ingested_at = NOW();
    `,
      item.vector_chunk_id,
      item.source_record_id,
      item.source_record_index,
      item.subchunk_index,
      item.corpus_sha256,
      item.chunk,
      item.chunk_hash,
      embStr,
      item.embedding_model,
      item.embedding_dimension,
      item.embedding_version,
      item.embedding_input_sha256,
      item.vector_search_enabled,
      item.source_file,
      item.section_title,
      item.source_type,
      item.training_id,
      item.doc_category,
      item.category,
      item.program,
      item.program_name,
      item.campus,
      item.academic_year,
      item.wave,
      item.jalur,
      item.fee_type,
      item.low_confidence,
      item.ocr_quality_score,
      rawMetaJson,
      item.remediation_status
    );
    dbMutationCount++;
  };

  const needEmbeddingItems = [];
  const nonSearchableItems = [];
  let alreadyExistingCompletedCount = 0;

  for (const item of planInfo.plan) {
    if (!item.eligibleForEmbedding) {
      nonSearchableItems.push(item);
    } else {
      const existing = existingMap.get(`${item.source_record_id}:${item.subchunk_index}`);
      if (existing && existing.has_embedding && existing.vector_search_enabled) {
        alreadyExistingCompletedCount++;
      } else {
        needEmbeddingItems.push(item);
      }
    }
  }

  // Insert/upsert non-searchable records (null embedding, vector_search_enabled=false)
  for (const item of nonSearchableItems) {
    await upsertItem(item, null);
  }

  // Batch embed items needing vectors (batch size 50)
  const BATCH_SIZE = 50;
  for (let i = 0; i < needEmbeddingItems.length; i += BATCH_SIZE) {
    const batch = needEmbeddingItems.slice(i, i + BATCH_SIZE);
    const batchTexts = batch.map(b => b.chunk);

    // Bounded retries without open DB transaction
    let response = null;
    let attempts = 0;
    const maxAttempts = 4;
    while (attempts < maxAttempts) {
      try {
        attempts++;
        openAiCallCount++;
        response = await client.embeddings.create({
          model: EMBEDDING_MODEL,
          input: batchTexts
        });
        break;
      } catch (err) {
        if (attempts >= maxAttempts) {
          throw new Error(`[MIGRATE] OpenAI embedding call failed after ${maxAttempts} attempts for batch starting at index ${i}: ${err.message}`);
        }
        const delayMs = Math.pow(2, attempts) * 500;
        await new Promise(r => setTimeout(r, delayMs));
      }
    }

    if (!response || !Array.isArray(response.data) || response.data.length !== batch.length) {
      throw new Error(`[MIGRATE] Unexpected OpenAI embedding response format or count mismatch for batch at index ${i}`);
    }

    // Insert batch into DB
    for (let j = 0; j < batch.length; j++) {
      const item = batch[j];
      const vec = response.data[j].embedding;
      if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIMENSION) {
        throw new Error(`[MIGRATE] Invalid embedding dimension ${vec?.length} for record ${item.source_record_id}`);
      }
      await upsertItem(item, vec);
      freshEmbeddingCount++;
    }
  }

  result.dbMutationCount = dbMutationCount;
  result.freshEmbeddingCount = freshEmbeddingCount;
  result.openAiCallCount = openAiCallCount;
  result.alreadyExistingCompletedCount = alreadyExistingCompletedCount;
  result.status = 'LIVE_MIGRATION_SUCCESS';
  return result;
}

// CLI Execution Support
if (require.main === module) {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run') || !args.includes('--live');

  console.log('================================================================');
  console.log(`PGVECTOR MIGRATION TOOL - MODE: ${isDryRun ? 'DRY-RUN' : 'LIVE'}`);
  console.log('================================================================\n');

  runMigration({ isDryRun })
    .then(res => {
      console.log('Migration Execution Result:');
      console.log(JSON.stringify(res, null, 2));
      process.exit(0);
    })
    .catch(err => {
      console.error('\n[FATAL MIGRATION ERROR]:', err.message);
      process.exit(1);
    });
}

module.exports = {
  CANONICAL_CORPUS_SHA256,
  EXPECTED_RECORD_COUNT,
  EMBEDDING_VERSION,
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSION,
  EXCLUDED_INVALID_IDS,
  DEFERRED_OVERSIZED_IDS,
  DDL_STATEMENTS,
  computeSha256,
  generateDeterministicChunkId,
  sanitizeRawMetadata,
  buildMigrationPlan,
  runMigration
};
