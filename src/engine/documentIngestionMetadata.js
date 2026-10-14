'use strict';

/**
 * src/engine/documentIngestionMetadata.js
 *
 * Generic Document Ingestion Metadata Engine.
 * Phase D: SHADOW / LOCAL ONLY.
 *
 * Invariants:
 * - Generic document & chunk metadata extraction.
 * - Extracts subject entity, family, academic level, providedAspects, and provenance.
 * - Strictly evidenced: does NOT guess aspects from single generic words.
 * - Absence of metadata is NOT evidence of absence.
 * - Discovered entities are automatically upserted into KnowledgeEntityCatalog.
 * - Survives serialization / persistence / reload.
 * - ZERO question regexes, ZERO hardcoded institutional keywords, ZERO typo maps.
 * - Does NOT mutate active production retrieval or evidence arbitration.
 */

const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
const logger = require('../logger');
const { ALLOWED_REQUESTED_ASPECTS } = require('../core/modelSemanticParser');
const { ALLOWED_ENTITY_FAMILIES, ALLOWED_ACADEMIC_LEVELS } = require('./knowledgeCatalogService');

const ALLOWED_METADATA_ASPECTS = ALLOWED_REQUESTED_ASPECTS;

const DOCUMENT_METADATA_JSON_SCHEMA = {
  name: 'document_ingestion_metadata',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      entities: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            canonical: { type: 'string' },
            family: {
              type: 'string',
              enum: ALLOWED_ENTITY_FAMILIES
            },
            academicLevel: {
              type: ['string', 'null'],
              enum: ['S1', 'S2', 'D3', null]
            }
          },
          required: ['canonical', 'family', 'academicLevel'],
          additionalProperties: false
        }
      },
      providedAspects: {
        type: 'array',
        items: {
          type: 'string',
          enum: ALLOWED_METADATA_ASPECTS
        }
      },
      academicLevels: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['S1', 'S2', 'D3']
        }
      },
      confidence: { type: 'number' },
      ambiguities: {
        type: 'array',
        items: { type: 'string' }
      }
    },
    required: ['entities', 'providedAspects', 'academicLevels', 'confidence', 'ambiguities'],
    additionalProperties: false
  }
};

const SYSTEM_DOCUMENT_ANALYSIS_INSTRUCTION = `You are a document metadata analysis engine for institutional knowledge.
Analyze the provided document text and extract only factual, explicitly evidenced entities, aspects, and academic levels.
Do NOT guess or invent information not present in the text.
Aspects: curriculum, fee, accreditation, requirements, procedure, schedule, career, location, study_duration, degree_award, facilities, organization, general.
Families: academic_program, campus_service, admission_track, scholarship, student_organization.
If the text discusses multiple aspects, list only those evidenced with concrete substance.
If the text does not contain evidence for an aspect, do NOT include it.`;

/**
 * Validates a document metadata object against the contract.
 */
function validateDocumentMetadataContract(metadata) {
  const errors = [];
  if (!metadata || typeof metadata !== 'object') {
    return { valid: false, errors: ['Metadata must be a non-null object'] };
  }

  if (typeof metadata.documentId !== 'string' || metadata.documentId.trim() === '') {
    errors.push('documentId must be a non-empty string');
  }

  if (typeof metadata.provenanceDocumentId !== 'string' || metadata.provenanceDocumentId.trim() === '') {
    errors.push('provenanceDocumentId must be a non-empty string');
  }

  if (!Array.isArray(metadata.entities)) {
    errors.push('entities must be an array');
  } else {
    for (const ent of metadata.entities) {
      if (!ent || typeof ent !== 'object') {
        errors.push('entity item must be an object');
        continue;
      }
      if (typeof ent.canonical !== 'string' || ent.canonical.trim() === '') {
        errors.push('entity canonical must be a non-empty string');
      }
      if (!ALLOWED_ENTITY_FAMILIES.includes(ent.family)) {
        errors.push(`entity family "${ent.family}" is invalid`);
      }
      if (ent.academicLevel !== null && !['S1', 'S2', 'D3'].includes(ent.academicLevel)) {
        errors.push(`entity academicLevel "${ent.academicLevel}" is invalid`);
      }
    }
  }

  if (!Array.isArray(metadata.providedAspects)) {
    errors.push('providedAspects must be an array');
  } else {
    for (const a of metadata.providedAspects) {
      if (!ALLOWED_METADATA_ASPECTS.includes(a)) {
        errors.push(`providedAspect "${a}" is invalid`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Synchronous document metadata extraction for precomputed or deterministic ingest.
 *
 * @param {Object} document
 * @param {Object} [options]
 * @returns {Object} Extracted DocumentIngestionMetadata
 */
function extractDocumentMetadataSync(document, options = {}) {
  const docId = String(document?.id || document?.documentId || 'doc_' + Math.random().toString(36).substring(2, 9)).trim();
  const sourceDoc = String(document?.source || document?.sourceDocument || docId).trim();
  const text = String(document?.text || '').trim();
  const now = new Date().toISOString();

  // 1. If precomputed metadata is provided or attached to document, validate and return
  if (options.precomputedMetadata || (document?.metadata && document.metadata.providedAspects)) {
    const raw = options.precomputedMetadata || document.metadata;
    const entities = Array.isArray(raw.entities) ? raw.entities : [];
    const providedAspects = Array.isArray(raw.providedAspects)
      ? Array.from(new Set(raw.providedAspects.filter(a => ALLOWED_METADATA_ASPECTS.includes(a))))
      : [];
    const academicLevels = Array.isArray(raw.academicLevels)
      ? raw.academicLevels.filter(l => ['S1', 'S2', 'D3'].includes(l))
      : [];

    const meta = {
      documentId: docId,
      sourceDocument: sourceDoc,
      sourceType: raw.sourceType || 'document_ingest',
      provenanceDocumentId: raw.provenanceDocumentId || docId,
      entities: entities.map(e => ({
        canonical: String(e.canonical || '').trim(),
        family: ALLOWED_ENTITY_FAMILIES.includes(e.family) ? e.family : 'academic_program',
        academicLevel: ['S1', 'S2', 'D3'].includes(e.academicLevel) ? e.academicLevel : null
      })).filter(e => Boolean(e.canonical)),
      providedAspects,
      academicLevels,
      ingestionTimestamp: raw.ingestionTimestamp || now,
      metadataConfidence: typeof raw.confidence === 'number' ? raw.confidence : 1.0,
      ambiguities: Array.isArray(raw.ambiguities) ? raw.ambiguities : [],
      chunkAspects: Array.isArray(raw.chunkAspects) ? raw.chunkAspects : null,
      chunks: Array.isArray(raw.chunks) ? raw.chunks : null
    };

    if (options.catalog && meta.entities.length > 0) {
      upsertDiscoveredEntitiesToCatalog(meta.entities, meta, options.catalog);
    }

    return meta;
  }

  // 2. Deterministic safe baseline when no precomputed metadata is supplied
  return {
    documentId: docId,
    sourceDocument: sourceDoc,
    sourceType: 'static_ingest',
    provenanceDocumentId: docId,
    entities: [],
    providedAspects: [],
    academicLevels: [],
    ingestionTimestamp: now,
    metadataConfidence: 0.5,
    ambiguities: ['NO_MODEL_OR_EXPLICIT_METADATA']
  };
}

/**
 * Extracts document-level ingestion metadata using model analysis or precomputed structured data.
 *
 * @param {Object} document
 * @param {string} document.id - Document unique identifier
 * @param {string} [document.source] - Document source URI / file path
 * @param {string} [document.text] - Document full text content
 * @param {Object} [document.metadata] - Optional existing metadata
 * @param {Object} [options]
 * @param {Object} [options.client] - OpenAI client or mock
 * @param {string} [options.model] - Model name
 * @param {Object} [options.catalog] - KnowledgeCatalogService instance to auto-upsert entities
 * @param {Object} [options.precomputedMetadata] - Precomputed metadata override
 * @returns {Promise<Object>} Extracted DocumentIngestionMetadata
 */
async function extractDocumentMetadata(document, options = {}) {
  // If precomputed metadata is available or attached, resolve synchronously
  if (options.precomputedMetadata || (document?.metadata && document.metadata.providedAspects)) {
    return extractDocumentMetadataSync(document, options);
  }

  const docId = String(document?.id || document?.documentId || 'doc_' + Math.random().toString(36).substring(2, 9)).trim();
  const sourceDoc = String(document?.source || document?.sourceDocument || docId).trim();
  const text = String(document?.text || '').trim();
  const now = new Date().toISOString();

  // Model-driven extraction if client is available or configured
  let client = options.client || null;
  if (!client && process.env.OPENAI_API_KEY) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  if (client && text) {
    try {
      const model = options.model || process.env.DOCUMENT_METADATA_MODEL || 'gpt-4o-mini';
      const promptText = `Analyze document "${sourceDoc}":\n\n${text.substring(0, 10000)}`;

      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: SYSTEM_DOCUMENT_ANALYSIS_INSTRUCTION },
          { role: 'user', content: promptText }
        ],
        temperature: 0.0,
        response_format: {
          type: 'json_schema',
          json_schema: DOCUMENT_METADATA_JSON_SCHEMA
        }
      });

      const parsed = JSON.parse(response.choices[0]?.message?.content || '{}');

      const meta = {
        documentId: docId,
        sourceDocument: sourceDoc,
        sourceType: 'model_analysis',
        provenanceDocumentId: docId,
        entities: (parsed.entities || []).map(e => ({
          canonical: String(e.canonical || '').trim(),
          family: e.family,
          academicLevel: e.academicLevel
        })),
        providedAspects: (parsed.providedAspects || []).filter(a => ALLOWED_METADATA_ASPECTS.includes(a)),
        academicLevels: (parsed.academicLevels || []).filter(l => ['S1', 'S2', 'D3'].includes(l)),
        ingestionTimestamp: now,
        metadataConfidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.9,
        ambiguities: parsed.ambiguities || []
      };

      if (options.catalog && meta.entities.length > 0) {
        upsertDiscoveredEntitiesToCatalog(meta.entities, meta, options.catalog);
      }

      return meta;
    } catch (err) {
      logger.warn({ docId, err: err.message }, '[documentIngestionMetadata] Model extraction failed; failing closed to safe empty metadata');
      // Conservative fail-closed behavior
      return {
        documentId: docId,
        sourceDocument: sourceDoc,
        sourceType: 'model_extraction_failed',
        provenanceDocumentId: docId,
        entities: [],
        providedAspects: [],
        academicLevels: [],
        ingestionTimestamp: now,
        metadataConfidence: 0.0,
        ambiguities: ['MODEL_EXTRACTION_FAILURE: ' + err.message]
      };
    }
  }

  // 3. Deterministic safe baseline when no model client is supplied
  return {
    documentId: docId,
    sourceDocument: sourceDoc,
    sourceType: 'static_ingest',
    provenanceDocumentId: docId,
    entities: [],
    providedAspects: [],
    academicLevels: [],
    ingestionTimestamp: now,
    metadataConfidence: 0.5,
    ambiguities: ['NO_MODEL_OR_EXPLICIT_METADATA']
  };
}

/**
 * Upserts discovered entities into the KnowledgeCatalogService.
 */
function upsertDiscoveredEntitiesToCatalog(entities, documentMetadata, catalog) {
  if (!catalog || !Array.isArray(entities)) return [];
  const results = [];

  for (const ent of entities) {
    if (!ent.canonical) continue;
    const res = catalog.upsert({
      canonical: ent.canonical,
      family: ent.family,
      academicLevel: ent.academicLevel,
      provenanceDocumentId: documentMetadata.provenanceDocumentId,
      isClosedDomain: ent.family === 'academic_program',
      metadata: {
        sourceDocument: documentMetadata.sourceDocument,
        sourceType: documentMetadata.sourceType,
        ingestionTimestamp: documentMetadata.ingestionTimestamp,
        provenanceConfidence: documentMetadata.metadataConfidence
      }
    });
    results.push(res);
  }

  return results;
}

/**
 * Tags chunk with chunk-level providedAspects and entity associations.
 * Section 10: Negative/absence safety - if a chunk does not evidence an aspect, it is omitted.
 *
 * @param {Object} chunk
 * @param {string} chunk.id - Chunk ID
 * @param {string} chunk.text - Chunk text content
 * @param {Object} [chunk.metadata] - Optional existing metadata
 * @param {Object} documentMetadata - Parent document metadata
 * @param {Object} [options]
 * @returns {Object} Enriched chunk with chunk.providedAspects and entityIds
 */
function tagChunkMetadata(chunk, documentMetadata, options = {}) {
  const isStringChunk = typeof chunk === 'string';
  const chunkObj = isStringChunk ? { text: chunk } : (chunk || {});
  const chunkId = String(chunkObj.id || chunkObj.chunkId || 'chunk_' + Math.random().toString(36).substring(2, 9)).trim();
  const chunkText = String(chunkObj.text || chunkObj.chunk || (isStringChunk ? chunk : '')).trim();
  const existingMeta = chunkObj.metadata || {};

  // If chunk explicitly declares its own aspects (e.g. from structured sectioning)
  let chunkAspects = [];
  if (Array.isArray(options.chunkAspects)) {
    chunkAspects = options.chunkAspects.filter(a => ALLOWED_METADATA_ASPECTS.includes(a));
  } else if (options.chunkIndex != null && Array.isArray(documentMetadata?.chunkAspects?.[options.chunkIndex])) {
    chunkAspects = documentMetadata.chunkAspects[options.chunkIndex].filter(a => ALLOWED_METADATA_ASPECTS.includes(a));
  } else if (options.chunkIndex != null && Array.isArray(documentMetadata?.chunks?.[options.chunkIndex]?.providedAspects)) {
    chunkAspects = documentMetadata.chunks[options.chunkIndex].providedAspects.filter(a => ALLOWED_METADATA_ASPECTS.includes(a));
  } else if (Array.isArray(existingMeta.providedAspects)) {
    chunkAspects = existingMeta.providedAspects.filter(a => ALLOWED_METADATA_ASPECTS.includes(a));
  } else if (Array.isArray(existingMeta.tags)) {
    chunkAspects = existingMeta.tags.filter(t => ALLOWED_METADATA_ASPECTS.includes(t));
  } else if (existingMeta.type && ALLOWED_METADATA_ASPECTS.includes(existingMeta.type)) {
    chunkAspects = [existingMeta.type];
  } else if (documentMetadata && Array.isArray(documentMetadata.providedAspects)) {
    // If the document has exactly one aspect, associate it conservatively
    if (documentMetadata.providedAspects.length === 1) {
      chunkAspects = [...documentMetadata.providedAspects];
    } else {
      // For multi-aspect documents, chunk must have explicit sectioning or verification
      // Do NOT blindly assign all document aspects to every chunk (Section 11)
      chunkAspects = [];
    }
  }

  const entities = Array.isArray(documentMetadata?.entities) ? documentMetadata.entities : [];
  const entityIds = entities.map(e => e.canonical.toLowerCase().replace(/[^a-z0-9]+/g, '_'));

  return {
    chunkId,
    documentId: documentMetadata?.documentId || 'unknown_doc',
    text: chunkText,
    entityIds,
    entities,
    providedAspects: Array.from(new Set(chunkAspects)),
    provenanceDocumentId: documentMetadata?.provenanceDocumentId || 'unknown_doc',
    metadataConfidence: documentMetadata?.metadataConfidence || 1.0,
    metadata: {
      ...existingMeta,
      documentId: documentMetadata?.documentId,
      sourceDocument: documentMetadata?.sourceDocument,
      sourceType: documentMetadata?.sourceType,
      providedAspects: Array.from(new Set(chunkAspects)),
      entityIds
    }
  };
}

/**
 * Saves chunks to a JSONL file atomically, preserving all metadata.
 */
function saveIngestedChunksToJsonl(chunks, filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tempPath = filePath + '.tmp_' + Date.now();
  const lines = (Array.isArray(chunks) ? chunks : []).map(c => JSON.stringify(c));
  fs.writeFileSync(tempPath, lines.join('\n') + '\n', 'utf8');
  fs.renameSync(tempPath, filePath);
  return { success: true, count: lines.length, filePath };
}

/**
 * Loads chunks from a JSONL file safely.
 */
function loadIngestedChunksFromJsonl(filePath) {
  if (!fs.existsSync(filePath)) {
    return { success: false, reason: 'file_not_found', chunks: [] };
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const chunks = raw
      .split(/\r?\n/)
      .filter(line => line.trim().length > 0)
      .map(line => {
        try { return JSON.parse(line); } catch (_) { return null; }
      })
      .filter(Boolean);

    return { success: true, count: chunks.length, chunks };
  } catch (err) {
    logger.error({ filePath, err: err.message }, '[documentIngestionMetadata] Failed to load JSONL');
    return { success: false, error: err.message, chunks: [] };
  }
}

module.exports = {
  ALLOWED_METADATA_ASPECTS,
  DOCUMENT_METADATA_JSON_SCHEMA,
  SYSTEM_DOCUMENT_ANALYSIS_INSTRUCTION,
  validateDocumentMetadataContract,
  extractDocumentMetadata,
  extractDocumentMetadataSync,
  upsertDiscoveredEntitiesToCatalog,
  tagChunkMetadata,
  saveIngestedChunksToJsonl,
  loadIngestedChunksFromJsonl
};
