'use strict';

/**
 * src/core/retrievalPlanner.js
 * 
 * Greenfield Retrieval Planner Layer.
 * Constructs an explicit RetrievalPlan from a SemanticFrame:
 * - Locks target entities
 * - Excludes conflicting/sibling entities (e.g., exclude HELP when DNUI is target)
 * - Sets required aspects and temporal constraints
 *  */

const { CANONICAL_ENTITIES, findCanonicalEntity } = require('../engine/canonicalEntityRegistry');

function buildRetrievalPlan(semanticFrame) {
  if (!semanticFrame) {
    return {
      domain: 'GENERAL',
      targetEntities: [],
      excludedConflictingEntities: [],
      requiredAspects: [],
      temporalConstraint: 'GENERAL',
      queryVariants: []
    };
  }

  const { normalizedQuery, domain, intent, entities, aspects, temporal } = semanticFrame;
  const targetEntities = (entities || []).map(e => e.canonical || e.name || String(e));
  const normalizedText = String(normalizedQuery || '').toLowerCase();

  const GENERIC_COMMON_WORDS = new Set([
    'akademik', 'kuliah', 'kampus', 'stikom', 'bali', 'mahasiswa', 'program',
    'studi', 'jurusan', 'fakultas', 'pendidikan', 'kurikulum', 'biaya', 'beasiswa',
    'fasilitas', 'gedung', 'kegiatan', 'organisasi'
  ]);

  // Generic discovery of conflicting / sibling entities to exclude across all families
  // INVARIANT: Explicitly requested entities in targetEntities must NEVER be excluded!
  const targetEntitySet = new Set(targetEntities.map(t => t.toLowerCase()));
  const excludedConflictingEntities = [];
  for (const ent of targetEntities) {
    const canonicalObj = findCanonicalEntity(ent);
    if (canonicalObj && canonicalObj.family) {
      const siblings = CANONICAL_ENTITIES.filter(other => {
        if (targetEntitySet.has(other.canonical.toLowerCase())) return false;
        if (other.family !== canonicalObj.family) return false;
        if (canonicalObj.role && other.role) {
          return other.role === canonicalObj.role;
        }
        return true;
      });
      for (const sib of siblings) {
        const sibCanonLower = sib.canonical.toLowerCase().trim();
        if (!GENERIC_COMMON_WORDS.has(sibCanonLower) && !targetEntitySet.has(sibCanonLower) && !excludedConflictingEntities.includes(sib.canonical)) {
          excludedConflictingEntities.push(sib.canonical);
        }
        if (Array.isArray(sib.aliases)) {
          for (const alias of sib.aliases) {
            const aliasLower = alias.toLowerCase().trim();
            if (targetEntitySet.has(aliasLower) || GENERIC_COMMON_WORDS.has(aliasLower)) continue;
            // Avoid adding plain multi-word noun phrases that are valid descriptive terms in other programs
            const isPlainNoun = canonicalObj.family === 'academic_program' && 
              !/^(s1|s2|d3|d4|prodi|jurusan|sarjana|diploma|magister)\b/i.test(alias) && 
              !/\b(s1|s2|d3|d4)\b/i.test(alias);
            if (alias.length >= 3 && !isPlainNoun && !excludedConflictingEntities.includes(alias)) {
              excludedConflictingEntities.push(alias);
            }
          }
        }
      }
    }
  }

  // Generate high-precision search query variants
  // Strip question stop words like "apa itu", "apakah ada", "bagaimana"
  const cleanKeywords = normalizedText
    .replace(/\b(apa\s+itu|apakah\s+ada|bagaimana|bagaimanakah|kapan|dimana|berapa|apa|ada|itu|di|ke|dari|untuk|yang)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const queryVariants = [];
  if (intent === 'INSTITUTIONAL_ACCREDITATION') {
    if (targetEntities.length === 0) {
      targetEntities.push('Institut Teknologi dan Bisnis STIKOM Bali');
    }
    queryVariants.push('konversi peringkat akreditasi perguruan tinggi institut teknologi dan bisnis stikom bali');
    queryVariants.push('akreditasi institusi BAN-PT perguruan tinggi');
  }

  // Tuition fee query variants prioritized
  if (domain === 'TUITION_FEE' || (aspects && (aspects.includes('fee') || aspects.includes('tuition')))) {
    if (targetEntities.length > 0) {
      for (const ent of targetEntities) {
        queryVariants.push(`rincian biaya pendidikan ${ent}`);
        queryVariants.push(`biaya kuliah ${ent} per semester`);
      }
    } else {
      queryVariants.push('rincian biaya pendidikan mahasiswa baru kelas reguler');
    }
  }

  // Scholarship query variants
  if (domain === 'SCHOLARSHIP' || (aspects && aspects.includes('scholarship'))) {
    queryVariants.push('informasi beasiswa potongan DPP KIP Kuliah STIKOM Bali');
    queryVariants.push('syarat pendaftaran beasiswa mahasiswa baru');
    if (targetEntities.length > 0) {
      for (const ent of targetEntities) {
        queryVariants.push(`beasiswa ${ent}`);
      }
    }
  }

  // Facilities query variants
  if (domain === 'FACILITIES' || (aspects && aspects.includes('facilities'))) {
    queryVariants.push('fasilitas laboratorium komputer perpustakaan asrama kampus ITB STIKOM Bali');
    queryVariants.push('sarana dan prasarana fasilitas mahasiswa');
  }

  // Organization & UKM query variants
  if (domain === 'ORGANIZATION_UKM' || (aspects && aspects.includes('student_organization'))) {
    queryVariants.push('unit kegiatan mahasiswa UKM ormawa ITB STIKOM Bali');
    queryVariants.push('daftar organisasi kemahasiswaan himaprodi');
  }

  // Career Center & Internship query variants
  if (domain === 'CAREER_CENTER' || (aspects && aspects.includes('internship'))) {
    queryVariants.push('career center inkubator bisnis inbis magang kerja sama industri ITB STIKOM Bali');
    queryVariants.push('layanan bursa kerja dan kemitraan');
  }

  // General PMB Inquiry query variants
  if (domain === 'PMB' && intent === 'GENERAL_PMB_INQUIRY') {
    queryVariants.push('informasi pendaftaran mahasiswa baru PMB jalur reguler kelas karyawan');
    queryVariants.push('syarat pendaftaran dan prosedur PMB STIKOM Bali');
  }

  // Program Overview / Definition query variants
  if (intent === 'PROGRAM_OVERVIEW' || intent === 'DEFINITION' || intent === 'PROGRAM_COMPARISON') {
    if (targetEntities.length > 0) {
      for (const ent of targetEntities) {
        queryVariants.push(`penjelasan prodi dan karier masa depan ${ent} yang dipelajari peluang kerja`);
        queryVariants.push(`profil program studi ${ent} fokus pendidikan keahlian visi`);
        queryVariants.push(`deskripsi profil program studi ${ent}`);
        queryVariants.push(`tentang ${ent}`);
      }
    }
  }

  // Career prospects specific variants
  if (aspects && aspects.includes('career_prospects')) {
    if (targetEntities.length > 0) {
      for (const ent of targetEntities) {
        queryVariants.push(`peluang kerja prospek karir profesi lulusan ${ent}`);
      }
    } else {
      queryVariants.push('peluang kerja prospek karir lulusan');
    }
  }

  // Program Curriculum query variants
  if (intent === 'CURRICULUM_INQUIRY' || domain === 'ACADEMIC_CURRICULUM') {
    if (targetEntities.length > 0) {
      for (const ent of targetEntities) {
        queryVariants.push(`kurikulum ${ent} mata kuliah`);
        queryVariants.push(`sebaran mata kuliah ${ent}`);
      }
    }
  }

  if (targetEntities.length > 0) {
    const combined = `${targetEntities.join(' ')} ${cleanKeywords}`.trim();
    if (!queryVariants.includes(combined)) queryVariants.push(combined);
  }
  if (cleanKeywords && !queryVariants.includes(cleanKeywords)) queryVariants.push(cleanKeywords);
  if (normalizedQuery && !queryVariants.includes(normalizedQuery)) queryVariants.push(normalizedQuery);

  return {
    domain,
    intent,
    retrievalRequired: semanticFrame.retrievalRequired !== false,
    targetEntities,
    excludedConflictingEntities,
    requiredAspects: aspects || [],
    temporalConstraint: temporal ? temporal.constraint : 'GENERAL',
    queryVariants
  };
}

module.exports = {
  buildRetrievalPlan
};
