'use strict';

/**
 * tests/helpers/normalizeChunkSafetyMetadata.js
 *
 * Test helper extracted from acceptance evaluator to make regression test suites
 * completely independent of the scratch/ evaluation harness.
 */

const PROGRAM_CANONICAL_MAP = {
  'SI': { entity: 'S1 Sistem Informasi', level: 'S1', code: 'SI' },
  'S1 Sistem Informasi': { entity: 'S1 Sistem Informasi', level: 'S1', code: 'SI' },
  'TI': { entity: 'S1 Teknologi Informasi', level: 'S1', code: 'TI' },
  'S1 Teknologi Informasi': { entity: 'S1 Teknologi Informasi', level: 'S1', code: 'TI' },
  'SK': { entity: 'S1 Sistem Komputer', level: 'S1', code: 'SK' },
  'S1 Sistem Komputer': { entity: 'S1 Sistem Komputer', level: 'S1', code: 'SK' },
  'BD': { entity: 'S1 Bisnis Digital', level: 'S1', code: 'BD' },
  'S1 Bisnis Digital': { entity: 'S1 Bisnis Digital', level: 'S1', code: 'BD' },
  'MI': { entity: 'D3 Manajemen Informatika', level: 'D3', code: 'MI' },
  'D3 Manajemen Informatika': { entity: 'D3 Manajemen Informatika', level: 'D3', code: 'MI' },
  'S2 Magister Ilmu Komputer': { entity: 'S2 Magister Ilmu Komputer', level: 'S2', code: 'S2' },
  'S2 Magister Sistem Informasi': { entity: 'S2 Magister Ilmu Komputer', level: 'S2', code: 'S2' },
  'S2 Sistem Informasi': { entity: 'S2 Magister Ilmu Komputer', level: 'S2', code: 'S2' },
  'S2': { entity: 'S2 Magister Ilmu Komputer', level: 'S2', code: 'S2' }
};

/**
 * Normalizes metadata deterministically for valid prodi codes.
 * Preserves UNVERIFIABLE for general documents lacking entity or level proof.
 * Never assumes level based on docCategory.
 */
function normalizeChunkSafetyMetadata(chunk) {
  if (!chunk) return { entity: null, level: null, correctedLevel: null, scope: null, supportedPrograms: [], rawProgram: null };
  const meta = chunk.metadata || {};

  let entity = chunk.entity || chunk.canonicalEntity || meta.entity || meta.canonicalEntity || null;
  let level = chunk.level || chunk.academicLevel || meta.level || meta.academicLevel || null;
  const correctedLevel = chunk.correctedLevel || meta.correctedLevel || null;
  const scope = chunk.scope || meta.scope || null;
  const supportedPrograms = Array.isArray(chunk.supportedPrograms)
    ? chunk.supportedPrograms
    : (Array.isArray(meta.supportedPrograms) ? meta.supportedPrograms : []);

  const rawProgram = chunk.program || meta.program || chunk.prodiCode || meta.prodiCode || chunk.prodi || meta.prodi;
  if (!entity && rawProgram && PROGRAM_CANONICAL_MAP[rawProgram]) {
    entity = PROGRAM_CANONICAL_MAP[rawProgram].entity;
    if (!level) level = PROGRAM_CANONICAL_MAP[rawProgram].level;
  }
  if (!entity && chunk.id && /^curr-([a-z0-9]+)/i.test(chunk.id)) {
    const code = chunk.id.match(/^curr-([a-z0-9]+)/i)[1].toUpperCase();
    if (PROGRAM_CANONICAL_MAP[code]) {
      entity = PROGRAM_CANONICAL_MAP[code].entity;
      if (!level) level = PROGRAM_CANONICAL_MAP[code].level;
    }
  }
  if (!level && (chunk.jenjang || meta.jenjang)) {
    level = chunk.jenjang || meta.jenjang;
  }

  return { entity, level, correctedLevel, scope, supportedPrograms, rawProgram };
}

module.exports = {
  PROGRAM_CANONICAL_MAP,
  normalizeChunkSafetyMetadata
};
