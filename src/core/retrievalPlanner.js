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

  // Generic discovery of conflicting / sibling entities to exclude across mutually exclusive families
  // INVARIANT: Explicitly requested entities in targetEntities must NEVER be excluded!
  // Invariant: Non-mutually-exclusive families like campus facilities or scholarships do not exclude each other
  const MUTUALLY_EXCLUSIVE_FAMILIES = new Set(['academic_program', 'international_program']);
  const targetEntitySet = new Set(targetEntities.map(t => t.toLowerCase()));
  const excludedConflictingEntities = [];
  for (const ent of targetEntities) {
    const canonicalObj = findCanonicalEntity(ent);
    if (canonicalObj && canonicalObj.family && MUTUALLY_EXCLUSIVE_FAMILIES.has(canonicalObj.family)) {
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

  // PMB Inquiry & Procedure query variants
  if (domain === 'PMB' || intent === 'GENERAL_PMB_INQUIRY' || intent === 'ADMISSION_PROCEDURE') {
    queryVariants.push('informasi pendaftaran mahasiswa baru PMB jalur reguler kelas karyawan');
    queryVariants.push('syarat pendaftaran dan prosedur alur PMB STIKOM Bali');
    queryVariants.push('alur pendaftaran mahasiswa baru pmb.stikom-bali.ac.id');
  }

  // Academic Curriculum query variants
  if (domain === 'ACADEMIC_CURRICULUM' || intent === 'CURRICULUM_INQUIRY' || (aspects && (aspects.includes('curriculum') || aspects.includes('courses')))) {
    if (targetEntities.length > 0) {
      for (const ent of targetEntities) {
        queryVariants.push(`kurikulum 2025 program studi ${ent} mata kuliah sks semester`);
        queryVariants.push(`sebaran mata kuliah kurikulum ${ent}`);
        queryVariants.push(`${ent} Semester I II III IV V VI VII VIII SKS`);
        queryVariants.push(`${ent} mata kuliah semester SKS`);
      }
    } else {
      queryVariants.push('kurikulum 2025 program studi mata kuliah sks semester');
    }
  }

  // Available Academic Programs List query variants
  if (intent === 'AVAILABLE_PROGRAMS_LIST') {
    queryVariants.push('program studi sarjana diploma magister ITB STIKOM Bali');
    queryVariants.push('pilihan jurusan program studi S1 D3 S2 ITB STIKOM Bali');
    queryVariants.push('program sarjana S1 Sistem Informasi Sistem Komputer Teknologi Informasi Bisnis Digital');
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

  // Study Mode (Kelas Karyawan / Kuliah Sambil Kerja) query variants
  if (intent === 'STUDY_MODE' || (aspects && aspects.includes('class_schedule'))) {
    queryVariants.push('kelas karyawan kelas sore kuliah sambil bekerja jadwal fleksibel');
    queryVariants.push('pilihan kelas reguler kelas sore pendaftaran PMB');
    queryVariants.push('kuliah sambil kerja di luar negeri fasilitas stikom');
  }

  // Degree Award query variants
  if (intent === 'DEGREE_AWARD' || (aspects && aspects.includes('degree_award'))) {
    if (targetEntities.length > 0) {
      for (const ent of targetEntities) {
        queryVariants.push(`gelar lulusan ${ent} sarjana komputer magister diploma`);
      }
    } else {
      queryVariants.push('gelar lulusan sarjana komputer magister diploma ITB STIKOM Bali');
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
