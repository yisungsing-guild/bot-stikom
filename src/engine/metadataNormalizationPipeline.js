'use strict';

/**
 * src/engine/metadataNormalizationPipeline.js
 *
 * Generic Metadata Normalization Engine for Document Ingestion.
 * Ensures every ingested chunk receives verifiable metadata:
 * - canonicalEntity: Canonical name of the entity, or 'UNVERIFIABLE'
 * - academicLevel: 'S1' | 'S2' | 'D3' | 'Umum' | 'UNVERIFIABLE'
 * - sourceFile: Filename of the source document
 * - docCategory: 'BIAYA' | 'KURIKULUM' | 'AKREDITASI' | 'ORGANISASI' | 'PEDOMAN_AKADEMIK' | 'LAYANAN_KAMPUS' | 'PRODI_PROFILE' | 'UNKNOWN'
 * - provenanceBasis: 'FILE_AUTHORITY_EXPLICIT' | 'PASSAGE_ISOLATION_EXPLICIT' | 'UNVERIFIABLE'
 *
 * Strict Governance Invariant:
 * Zero guessing, zero speculative per-chunk hardcoding. If a chunk cannot be proved
 * to belong exclusively to an entity/level, it MUST remain 'UNVERIFIABLE'.
 */

// 1. Authoritative Dedicated Document Registry
// Mappings apply ONLY when an entire file is authoritative for a single entity/level.
const DEDICATED_FILE_AUTHORITY = [
  // Fee Documents
  { pattern: /rincian biaya D3/i, entity: 'D3 Manajemen Informatika', level: 'D3', category: 'BIAYA' },
  { pattern: /rincian biaya SK/i, entity: 'S1 Sistem Komputer', level: 'S1', category: 'BIAYA' },
  { pattern: /rincian biaya HELP/i, entity: 'Dual Degree HELP', level: 'S1', category: 'BIAYA' },
  { pattern: /rincian biaya DNUI/i, entity: 'Dual Degree DNUI', level: 'S1', category: 'BIAYA' },
  { pattern: /rincian biaya UTB/i, entity: 'Dual Degree UTB', level: 'S1', category: 'BIAYA' },

  // Accreditation Certificates
  { pattern: /AKREDITASI BD/i, entity: 'S1 Bisnis Digital', level: 'S1', category: 'AKREDITASI' },
  { pattern: /AKREDITASI TI/i, entity: 'S1 Teknologi Informasi', level: 'S1', category: 'AKREDITASI' },
  { pattern: /AKREDITASI MI/i, entity: 'D3 Manajemen Informatika', level: 'D3', category: 'AKREDITASI' },
  { pattern: /AKREDITASI SISTEM KOMPUTER/i, entity: 'S1 Sistem Komputer', level: 'S1', category: 'AKREDITASI' },
  { pattern: /AKREDITASI - SISTEM INFORMASI/i, entity: 'S1 Sistem Informasi', level: 'S1', category: 'AKREDITASI' },

  // Official Curriculum Documents
  { pattern: /kurikulum.*sistem.*informasi|SI_curriculum/i, entity: 'S1 Sistem Informasi', level: 'S1', category: 'KURIKULUM' },
  { pattern: /kurikulum.*sistem.*komputer|SK_curriculum/i, entity: 'S1 Sistem Komputer', level: 'S1', category: 'KURIKULUM' },
  { pattern: /kurikulum.*teknologi.*informasi|TI_curriculum/i, entity: 'S1 Teknologi Informasi', level: 'S1', category: 'KURIKULUM' },
  { pattern: /kurikulum.*bisnis.*digital|daftar.*mata.*kuliah.*bisnis.*digital|BD_curriculum/i, entity: 'S1 Bisnis Digital', level: 'S1', category: 'KURIKULUM' },
  { pattern: /kurikulum.*manajemen.*informatika|MI_curriculum/i, entity: 'D3 Manajemen Informatika', level: 'D3', category: 'KURIKULUM' },

  // Graduate Program
  { pattern: /Pascasarjana/i, entity: 'S2 Magister Sistem Informasi', level: 'S2', category: 'PASCASARJANA' },

  // Student Organizations & UKM
  { pattern: /Profil.*UKM DOS/i, entity: 'UKM Dance of STIKOM Bali (UKM DOS)', level: 'Umum', category: 'ORGANISASI' },
  { pattern: /MCOS/i, entity: 'UKM MCOS', level: 'Umum', category: 'ORGANISASI' },
  { pattern: /JCOS/i, entity: 'UKM JCOS', level: 'Umum', category: 'ORGANISASI' },
  { pattern: /UKM KSL/i, entity: 'UKM KSL', level: 'Umum', category: 'ORGANISASI' },
  { pattern: /UKM KSR|KSR\.docx/i, entity: 'UKM KSR', level: 'Umum', category: 'ORGANISASI' },
  { pattern: /Basket/i, entity: 'UKM Basket', level: 'Umum', category: 'ORGANISASI' },
  { pattern: /Futsal/i, entity: 'UKM Futsal', level: 'Umum', category: 'ORGANISASI' },
  { pattern: /MAPALA/i, entity: 'UKM MAPALA', level: 'Umum', category: 'ORGANISASI' },
  { pattern: /SYNTAX/i, entity: 'UKM SYNTAX', level: 'Umum', category: 'ORGANISASI' },
  { pattern: /UKM Tabuh|UKM TABUH/i, entity: 'UKM Tabuh Bramara Gita', level: 'Umum', category: 'ORGANISASI' },
  { pattern: /Teater Biner/i, entity: 'UKM Teater Biner', level: 'Umum', category: 'ORGANISASI' },
  { pattern: /ATHENA/i, entity: 'UKM Athena Esports', level: 'Umum', category: 'ORGANISASI' },
  { pattern: /PROGRESS/i, entity: 'UKM PROGRESS', level: 'Umum', category: 'ORGANISASI' },
  { pattern: /VOS/i, entity: 'UKM Voice of STIKOM (VOS)', level: 'Umum', category: 'ORGANISASI' },
  { pattern: /PASKAMRAS/i, entity: 'UKM PASKAMRAS', level: 'Umum', category: 'ORGANISASI' },
  { pattern: /GHoST/i, entity: 'UKM GHoST', level: 'Umum', category: 'ORGANISASI' },
  { pattern: /KMHD/i, entity: 'UKM KMHD', level: 'Umum', category: 'ORGANISASI' },
  { pattern: /HIMATOGRAPHY/i, entity: 'UKM HIMATOGRAPHY', level: 'Umum', category: 'ORGANISASI' },
  { pattern: /UKM U2M/i, entity: 'UKM U2M', level: 'Umum', category: 'ORGANISASI' },
  { pattern: /UKM RADE/i, entity: 'UKM RADE', level: 'Umum', category: 'ORGANISASI' },
  { pattern: /UKM MM|Profil UKM MM/i, entity: 'UKM Multimedia', level: 'Umum', category: 'ORGANISASI' },
  { pattern: /UKM BOS/i, entity: 'UKM BOS (Balinese Oriental Song)', level: 'Umum', category: 'ORGANISASI' },
  { pattern: /ORMAWA TARI/i, entity: 'UKM Tari Pragina', level: 'Umum', category: 'ORGANISASI' },

  // Program Associations (HIMA)
  { pattern: /HIMAPRODI TI|BUKU ORMAWA HIMAPRODI TI/i, entity: 'HIMAPRODI TI', level: 'S1', category: 'ORGANISASI' },
  { pattern: /HIMA SK/i, entity: 'HIMA SK', level: 'S1', category: 'ORGANISASI' },
  { pattern: /HIMA SI/i, entity: 'HIMA SI', level: 'S1', category: 'ORGANISASI' },
  { pattern: /HIMA BD/i, entity: 'HIMA BD', level: 'S1', category: 'ORGANISASI' },
  { pattern: /HIMPUNAN MAHASISWA JIMBARAN/i, entity: 'Himpunan Mahasiswa Jimbaran', level: 'Umum', category: 'ORGANISASI' },
  { pattern: /Profil_BEM/i, entity: 'BEM ITB STIKOM Bali', level: 'Umum', category: 'ORGANISASI' },

  // Campus Services & Guidelines
  { pattern: /Pedoman TA S1/i, entity: 'ITB STIKOM Bali', level: 'S1', category: 'PEDOMAN_AKADEMIK' },
  { pattern: /INBIS/i, entity: 'INBIS ITB STIKOM Bali', level: 'Umum', category: 'LAYANAN_KAMPUS' },
  { pattern: /CDC|Company-Profile-CDC/i, entity: 'Career Development Center', level: 'Umum', category: 'LAYANAN_KAMPUS' },
  { pattern: /FAQ CC/i, entity: 'Career Development Center', level: 'Umum', category: 'LAYANAN_KAMPUS' },
  { pattern: /MAHASISWA ASING/i, entity: 'Layanan Mahasiswa Asing', level: 'Umum', category: 'LAYANAN_KAMPUS' },
  { pattern: /fasilitas-stikom/i, entity: 'ITB STIKOM Bali', level: 'Umum', category: 'FASILITAS' },
  { pattern: /Kalender Akademik/i, entity: 'ITB STIKOM Bali', level: 'Umum', category: 'AKADEMIK' }
];

/**
 * Normalizes metadata for a chunk during the ingestion pipeline.
 * Evaluates document authority, section headers, and passage isolation.
 * If evidence is insufficient, leaves fields as 'UNVERIFIABLE'.
 *
 * @param {Object} rawChunk - Ingested chunk object with { chunk, text, sourceFile, filename, docCategory }
 * @returns {Object} Normalized chunk metadata
 */
function normalizeChunkMetadata(rawChunk = {}) {
  const sourceFile = rawChunk.sourceFile || rawChunk.filename || rawChunk.source || 'UNKNOWN';
  const text = rawChunk.chunk || rawChunk.text || '';
  const currentCategory = rawChunk.docCategory || rawChunk.category || 'UNKNOWN';

  // 1. Tier 1: Dedicated Document Authority
  for (const auth of DEDICATED_FILE_AUTHORITY) {
    if (auth.pattern.test(sourceFile)) {
      return {
        canonicalEntity: auth.entity,
        academicLevel: auth.level,
        sourceFile,
        docCategory: auth.category || currentCategory,
        provenanceBasis: 'FILE_AUTHORITY_EXPLICIT',
        isVerifiable: true
      };
    }
  }

  // 2. Tier 2: Passage-Level Explicit Section Isolation
  // Handles multi-program files with isolated markers e.g. [Program: S1 Sistem Informasi]
  const sectionHeaderMatch = text.match(/\[Program:\s*([^\]]+)\]/i);
  if (sectionHeaderMatch) {
    const rawSection = sectionHeaderMatch[1].trim();
    const lvlMatch = rawSection.match(/^(S1|S2|D3|D4)\b/i);
    const level = lvlMatch ? lvlMatch[1].toUpperCase() : 'UNVERIFIABLE';
    return {
      canonicalEntity: rawSection,
      academicLevel: level,
      sourceFile,
      docCategory: currentCategory,
      provenanceBasis: 'PASSAGE_ISOLATION_EXPLICIT',
      isVerifiable: true
    };
  }

  // 3. Tier 3: Unverifiable / Mixed Multi-Entity Documents
  // e.g. FORM IKU PTS 2024 LLDIKTI.pdf, rincian Biaya SI,TI dan BD, general administrative documents
  return {
    canonicalEntity: 'UNVERIFIABLE',
    academicLevel: 'UNVERIFIABLE',
    sourceFile,
    docCategory: currentCategory,
    provenanceBasis: 'UNVERIFIABLE',
    isVerifiable: false
  };
}

module.exports = {
  DEDICATED_FILE_AUTHORITY,
  normalizeChunkMetadata
};
