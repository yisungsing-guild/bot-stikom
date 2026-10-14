'use strict';

/**
 * src/engine/knowledgeCatalogService.js
 *
 * Greenfield Dynamic Knowledge Entity Catalog.
 * Phase C: READ-ONLY / SHADOW ONLY.
 *
 * Architectural Invariant:
 * ADDING A NEW KNOWLEDGE DOCUMENT / ENTITY MUST NOT REQUIRE SOURCE-CODE CHANGES.
 *
 * Rules:
 * - Generic entity record schema with mandatory provenance.
 * - Closed-world vs open-world explicitly distinguished per entity.
 * - Deterministic normalization and conflict handling.
 * - Never hardcodes institutional program or service names.
 * - Operates over persistent data sources (JSON / JSONL).
 * - Usable with zero embeddings.
 * - Does NOT mutate or control active production entity resolution.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../logger');

const ALLOWED_ENTITY_FAMILIES = Object.freeze([
  'academic_program',
  'campus_service',
  'admission_track',
  'scholarship',
  'student_organization'
]);

const ALLOWED_ACADEMIC_LEVELS = Object.freeze(['S1', 'S2', 'D3', null]);

/**
 * Deterministic text normalization:
 * Unicode NFC, lowercased, whitespace trimmed, collapses multi-spaces.
 * NO semantic regexes, NO typo maps, NO institutional synonyms.
 */
function normalizeIdentifierText(text) {
  if (typeof text !== 'string') return '';
  return text
    .normalize('NFC')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Generates a deterministic canonical ID from canonical text and optional level.
 * Example: "S1 Bisnis Digital" -> "s1_bisnis_digital"
 */
function generateCanonicalEntityId(canonical, academicLevel = null) {
  const norm = normalizeIdentifierText(canonical)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return norm || 'entity_' + Math.random().toString(36).substring(2, 9);
}

/**
 * Validates an incoming entity record against the Phase C Entity Contract.
 */
function validateEntityRecord(record) {
  const errors = [];

  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { valid: false, errors: ['Record must be a non-null object'], normalizedRecord: null };
  }

  // 1. Canonical Name
  if (typeof record.canonical !== 'string' || record.canonical.trim() === '') {
    errors.push('canonical must be a non-empty string');
  }

  // 2. Family
  if (!ALLOWED_ENTITY_FAMILIES.includes(record.family)) {
    errors.push(`family "${record.family}" is invalid. Expected one of: ${ALLOWED_ENTITY_FAMILIES.join(', ')}`);
  }

  // 3. Academic Level
  if (record.academicLevel !== undefined && record.academicLevel !== null) {
    if (!['S1', 'S2', 'D3'].includes(record.academicLevel)) {
      errors.push(`academicLevel "${record.academicLevel}" is invalid. Expected S1, S2, D3, or null`);
    }
  }

  // 4. Provenance
  if (typeof record.provenanceDocumentId !== 'string' || record.provenanceDocumentId.trim() === '') {
    errors.push('provenanceDocumentId is mandatory and must be a non-empty string');
  }

  // 5. ParentEntityId
  if (record.parentEntityId !== undefined && record.parentEntityId !== null) {
    if (typeof record.parentEntityId !== 'string' || record.parentEntityId.trim() === '') {
      errors.push('parentEntityId must be a string or null');
    }
  }

  // 6. Aliases
  if (record.aliases !== undefined && !Array.isArray(record.aliases)) {
    errors.push('aliases must be an array of strings');
  }

  if (errors.length > 0) {
    return { valid: false, errors, normalizedRecord: null };
  }

  // Normalization
  const cleanCanonical = record.canonical.normalize('NFC').trim();
  const academicLevel = record.academicLevel || null;
  const id = typeof record.id === 'string' && record.id.trim() !== ''
    ? record.id.trim()
    : generateCanonicalEntityId(cleanCanonical, academicLevel);

  // Closed-world domain default: academic_program defaults to true, others false
  const isClosedDomain = typeof record.isClosedDomain === 'boolean'
    ? record.isClosedDomain
    : record.family === 'academic_program';

  // Deterministic deduplication of aliases
  const rawAliases = Array.isArray(record.aliases) ? record.aliases : [];
  const aliasSet = new Set();
  const cleanAliases = [];

  for (const a of rawAliases) {
    if (typeof a === 'string') {
      const clean = a.normalize('NFC').trim();
      const normKey = clean.toLowerCase();
      if (clean && !aliasSet.has(normKey) && normKey !== cleanCanonical.toLowerCase()) {
        aliasSet.add(normKey);
        cleanAliases.push(clean);
      }
    }
  }

  cleanAliases.sort((a, b) => a.localeCompare(b));

  const now = new Date().toISOString();
  const normalizedRecord = {
    id,
    canonical: cleanCanonical,
    family: record.family,
    academicLevel,
    aliases: cleanAliases,
    parentEntityId: record.parentEntityId || null,
    provenanceDocumentId: record.provenanceDocumentId.trim(),
    isClosedDomain,
    metadata: {
      sourceDocument: record.metadata?.sourceDocument || record.provenanceDocumentId,
      sourceType: record.metadata?.sourceType || 'knowledge_catalog',
      ingestionTimestamp: record.metadata?.ingestionTimestamp || now,
      provenanceConfidence: typeof record.metadata?.provenanceConfidence === 'number'
        ? record.metadata.provenanceConfidence
        : 1.0,
      provenanceDocumentIds: [record.provenanceDocumentId.trim()],
      conflicts: [],
      ...(record.metadata || {})
    },
    createdAt: record.createdAt || now,
    updatedAt: now
  };

  return { valid: true, errors: [], normalizedRecord };
}

/**
 * KnowledgeCatalogService
 * In-memory index with persistent hydration from data files.
 */
class KnowledgeCatalogService {
  /**
   * @param {Object} [options]
   * @param {string} [options.storagePath] - Custom file path for JSON persistence
   * @param {Array<Object>} [options.initialEntities] - Preloaded entity records
   */
  constructor(options = {}) {
    this.storagePath = options.storagePath || path.join(__dirname, '../data/knowledge_entities.json');
    this.entitiesById = new Map();
    this.canonicalIndex = new Map(); // normalizedCanonical -> entityId
    this.aliasIndex = new Map(); // normalizedAlias -> entityId
    this.familyIndex = new Map(); // family -> Set(entityId)
    this.academicLevelIndex = new Map(); // level -> Set(entityId)

    if (Array.isArray(options.initialEntities)) {
      this.bulkUpsert(options.initialEntities);
    }
  }

  /**
   * Total number of registered entities.
   */
  count() {
    return this.entitiesById.size;
  }

  /**
   * Clears all entities and in-memory indices.
   */
  invalidateCache() {
    this.entitiesById.clear();
    this.canonicalIndex.clear();
    this.aliasIndex.clear();
    this.familyIndex.clear();
    this.academicLevelIndex.clear();
  }

  /**
   * Retrieves all entity records in the catalog.
   */
  getAll() {
    return Array.from(this.entitiesById.values()).map(e => ({ ...e }));
  }

  /**
   * Retrieves an entity by its unique ID.
   */
  getById(id) {
    if (!id || typeof id !== 'string') return null;
    const entity = this.entitiesById.get(id.trim());
    return entity ? { ...entity } : null;
  }

  /**
   * Finds an entity by exact canonical name (normalized).
   */
  findByCanonical(canonical) {
    if (!canonical || typeof canonical !== 'string') return null;
    const key = normalizeIdentifierText(canonical);
    const id = this.canonicalIndex.get(key);
    return id ? this.getById(id) : null;
  }

  /**
   * Finds an entity by alias (normalized).
   */
  findByAlias(alias) {
    if (!alias || typeof alias !== 'string') return null;
    const key = normalizeIdentifierText(alias);
    const id = this.aliasIndex.get(key);
    return id ? this.getById(id) : null;
  }

  /**
   * Resolves an entity by identifier (trying ID, canonical, and alias in order).
   */
  resolveEntity(identifier) {
    if (!identifier || typeof identifier !== 'string') return null;
    const byId = this.getById(identifier);
    if (byId) return byId;

    const byCanonical = this.findByCanonical(identifier);
    if (byCanonical) return byCanonical;

    const byAlias = this.findByAlias(identifier);
    if (byAlias) return byAlias;

    return null;
  }

  /**
   * Evaluates the closed-world entity status for an identifier.
   * Section 3 Invariant: "Not found in catalog" MUST NOT automatically mean UNSUPPORTED
   * for non-closed domain or unconstrained lookups.
   */
  resolveEntityStatus(identifier, options = {}) {
    const entity = this.resolveEntity(identifier);
    if (entity) {
      return {
        status: 'FOUND',
        entity,
        isClosedDomain: entity.isClosedDomain
      };
    }

    const requestedFamily = options.family || null;
    const isClosedFamily = requestedFamily === 'academic_program';

    return {
      status: 'NOT_FOUND_IN_CATALOG',
      isClosedDomain: isClosedFamily,
      candidateUnsupported: isClosedFamily,
      family: requestedFamily
    };
  }

  /**
   * Retrieves all entities in a given family.
   */
  findByFamily(family) {
    if (!family || typeof family !== 'string') return [];
    const ids = this.familyIndex.get(family);
    if (!ids) return [];
    const results = [];
    for (const id of ids) {
      const ent = this.entitiesById.get(id);
      if (ent) results.push({ ...ent });
    }
    return results;
  }

  /**
   * Alias for findByFamily.
   */
  listByFamily(family) {
    return this.findByFamily(family);
  }

  /**
   * Retrieves all entities matching an academic level (S1, S2, D3).
   */
  findByAcademicLevel(level) {
    if (!level) return [];
    const ids = this.academicLevelIndex.get(level);
    if (!ids) return [];
    const results = [];
    for (const id of ids) {
      const ent = this.entitiesById.get(id);
      if (ent) results.push({ ...ent });
    }
    return results;
  }

  /**
   * Upserts an entity record with deterministic duplicate & conflict resolution.
   *
   * @param {Object} rawRecord
   * @returns {Object} { success: boolean, entity: Object, isNew: boolean, conflicts: Array }
   */
  upsert(rawRecord) {
    const valResult = validateEntityRecord(rawRecord);
    if (!valResult.valid) {
      logger.warn({ errors: valResult.errors, record: rawRecord }, '[knowledgeCatalogService] Upsert rejected invalid entity');
      return {
        success: false,
        errors: valResult.errors,
        entity: null,
        isNew: false
      };
    }

    const incoming = valResult.normalizedRecord;
    const existing = this.entitiesById.get(incoming.id) || this.findByCanonical(incoming.canonical);

    if (!existing) {
      // Clean new insert
      this._indexEntity(incoming);
      return {
        success: true,
        entity: { ...incoming },
        isNew: true,
        conflicts: []
      };
    }

    // Deterministic Duplicate / Conflict Merge (Section 10)
    const conflicts = [];
    const existingEntity = this.entitiesById.get(existing.id);

    // 1. Alias union
    const aliasSet = new Set(existingEntity.aliases.map(a => a.toLowerCase()));
    for (const a of incoming.aliases) {
      const aLower = a.toLowerCase();
      if (!aliasSet.has(aLower)) {
        aliasSet.add(aLower);
        existingEntity.aliases.push(a);
      }
    }
    existingEntity.aliases.sort((a, b) => a.localeCompare(b));

    // 2. Provenance History preservation
    const existingDocIds = existingEntity.metadata.provenanceDocumentIds || [existingEntity.provenanceDocumentId];
    if (!existingDocIds.includes(incoming.provenanceDocumentId)) {
      existingDocIds.push(incoming.provenanceDocumentId);
    }
    existingEntity.metadata.provenanceDocumentIds = existingDocIds;

    // 3. Scalar Conflict Check (do not randomly overwrite authoritative metadata)
    const scalarFields = ['family', 'academicLevel', 'parentEntityId', 'isClosedDomain'];
    for (const field of scalarFields) {
      const existVal = existingEntity[field];
      const inVal = incoming[field];

      if (existVal !== inVal) {
        if (existVal === null && inVal !== null) {
          // Non-null enrich
          existingEntity[field] = inVal;
        } else if (existVal !== null && inVal !== null) {
          // Concrete conflict -> preserve existing, log conflict
          const conflictEntry = {
            field,
            existingValue: existVal,
            incomingValue: inVal,
            incomingProvenance: incoming.provenanceDocumentId,
            timestamp: new Date().toISOString()
          };
          conflicts.push(conflictEntry);
          if (!existingEntity.metadata.conflicts) existingEntity.metadata.conflicts = [];
          existingEntity.metadata.conflicts.push(conflictEntry);
        }
      }
    }

    existingEntity.updatedAt = new Date().toISOString();

    // Re-index to update any new aliases or index changes
    this._reindexEntity(existingEntity);

    return {
      success: true,
      entity: { ...existingEntity },
      isNew: false,
      conflicts
    };
  }

  /**
   * Bulk upsert multiple records.
   */
  bulkUpsert(records) {
    if (!Array.isArray(records)) {
      return { total: 0, inserted: 0, updated: 0, failed: 0 };
    }

    let inserted = 0;
    let updated = 0;
    let failed = 0;

    for (const rec of records) {
      const res = this.upsert(rec);
      if (!res.success) {
        failed++;
      } else if (res.isNew) {
        inserted++;
      } else {
        updated++;
      }
    }

    return {
      total: records.length,
      inserted,
      updated,
      failed
    };
  }

  /**
   * Removes an entity by ID and clears associated indices.
   */
  remove(id) {
    if (!id || typeof id !== 'string') return false;
    const existing = this.entitiesById.get(id.trim());
    if (!existing) return false;

    this._unindexEntity(existing);
    this.entitiesById.delete(existing.id);
    return true;
  }

  /**
   * Hydrates the catalog dynamically from data records or file path.
   * Section 5: The source of truth must be data, not code.
   */
  hydrate(source) {
    if (Array.isArray(source)) {
      return this.bulkUpsert(source);
    }
    if (typeof source === 'string') {
      return this.hydrateFromFile(source);
    }
    return { total: 0, inserted: 0, updated: 0, failed: 0 };
  }

  /**
   * Loads catalog records from a JSON file safely.
   */
  hydrateFromFile(filePath = null) {
    const targetPath = filePath || this.storagePath;
    if (!fs.existsSync(targetPath)) {
      logger.info({ targetPath }, '[knowledgeCatalogService] Data file does not exist; initializing empty');
      return { total: 0, inserted: 0, updated: 0, failed: 0, fileExisted: false };
    }

    try {
      const raw = fs.readFileSync(targetPath, 'utf8');
      const parsed = JSON.parse(raw);
      const records = Array.isArray(parsed) ? parsed : (parsed.entities || []);
      const result = this.bulkUpsert(records);
      return { ...result, fileExisted: true };
    } catch (err) {
      logger.error({ targetPath, err: err.message }, '[knowledgeCatalogService] Failed to read catalog file safely');
      return { total: 0, inserted: 0, updated: 0, failed: 0, error: err.message, fileExisted: true };
    }
  }

  /**
   * Persists current catalog records to a JSON file atomically.
   */
  persistToFile(filePath = null) {
    const targetPath = filePath || this.storagePath;
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const entities = this.getAll();
    const tempPath = targetPath + '.tmp_' + Date.now();
    try {
      fs.writeFileSync(tempPath, JSON.stringify(entities, null, 2), 'utf8');
      fs.renameSync(tempPath, targetPath);
      return { success: true, count: entities.length, targetPath };
    } catch (err) {
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch (_) {}
      }
      logger.error({ targetPath, err: err.message }, '[knowledgeCatalogService] Persistence write failed');
      return { success: false, error: err.message, targetPath };
    }
  }

  // Private Indexing Helpers
  _indexEntity(entity) {
    this.entitiesById.set(entity.id, entity);
    this.canonicalIndex.set(normalizeIdentifierText(entity.canonical), entity.id);

    for (const a of entity.aliases) {
      this.aliasIndex.set(normalizeIdentifierText(a), entity.id);
    }

    if (entity.family) {
      if (!this.familyIndex.has(entity.family)) {
        this.familyIndex.set(entity.family, new Set());
      }
      this.familyIndex.get(entity.family).add(entity.id);
    }

    if (entity.academicLevel) {
      if (!this.academicLevelIndex.has(entity.academicLevel)) {
        this.academicLevelIndex.set(entity.academicLevel, new Set());
      }
      this.academicLevelIndex.get(entity.academicLevel).add(entity.id);
    }
  }

  _unindexEntity(entity) {
    this.canonicalIndex.delete(normalizeIdentifierText(entity.canonical));

    for (const a of entity.aliases) {
      this.aliasIndex.delete(normalizeIdentifierText(a));
    }

    if (entity.family && this.familyIndex.has(entity.family)) {
      this.familyIndex.get(entity.family).delete(entity.id);
    }

    if (entity.academicLevel && this.academicLevelIndex.has(entity.academicLevel)) {
      this.academicLevelIndex.get(entity.academicLevel).delete(entity.id);
    }
  }

  _reindexEntity(entity) {
    this._unindexEntity(entity);
    this._indexEntity(entity);
  }
}

// Global default singleton instance
let defaultCatalogInstance = null;

function getDefaultKnowledgeCatalogService(options = {}) {
  if (!defaultCatalogInstance) {
    defaultCatalogInstance = new KnowledgeCatalogService(options);
  }
  return defaultCatalogInstance;
}

function _resetDefaultCatalogForTesting() {
  defaultCatalogInstance = null;
}

module.exports = {
  KnowledgeCatalogService,
  ALLOWED_ENTITY_FAMILIES,
  ALLOWED_ACADEMIC_LEVELS,
  validateEntityRecord,
  normalizeIdentifierText,
  generateCanonicalEntityId,
  getDefaultKnowledgeCatalogService,
  _resetDefaultCatalogForTesting
};
