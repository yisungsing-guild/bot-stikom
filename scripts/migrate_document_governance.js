'use strict';

/**
 * migrate_document_governance.js
 *
 * Implements Document Validity & Lifecycle Governance migration across:
 * 1. PostgreSQL TrainingData records (Prisma)
 * 2. Active corpus indexes (src/data/rag_index.json, data/rag_index.json)
 * 3. Historical / snapshot indexes (data/runtime/index_snapshots/...)
 *
 * Attaches:
 * - status: 'active' | 'superseded' | 'expired' | 'draft' | 'archived'
 * - validFrom: ISO date string / Date
 * - validUntil: ISO date string / Date / null
 * - version: document version string
 * - authority: standard tier identifier
 * - authorityTier: numeric tier (1..4)
 * - authorityWeight: numeric weight (100, 80, 60, 40)
 * - supersedes: identifier or array of superseded document references
 * - supersededBy: identifier of document that supersedes this document
 * - owner: governing unit / bureau
 */

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const {
  AUTHORITY_TIERS,
  normalizeAuthority,
  getAuthorityTier,
  normalizeStatus
} = require('../src/engine/runtimeGovernance');

function classifyDocument(filename = '', content = '') {
  const f = String(filename || '').toLowerCase();
  const c = String(content || '').slice(0, 1000).toLowerCase();

  // 1. Test / Draft Uploads
  if (/^test\.pdf$/i.test(f)) {
    return {
      status: 'draft',
      authority: 'tier_4_supporting_doc',
      version: 'TEST-DRAFT',
      validFrom: '2026-01-01T00:00:00.000Z',
      validUntil: null,
      owner: 'TESTING',
      supersedes: null,
      supersededBy: null,
      notes: 'Test artifact upload'
    };
  }
  if (/template/i.test(f)) {
    return {
      status: 'draft',
      authority: 'tier_4_supporting_doc',
      version: 'TEMPLATE-2025',
      validFrom: '2025-01-01T00:00:00.000Z',
      validUntil: null,
      owner: 'KERJASAMA',
      supersedes: null,
      supersededBy: null,
      notes: 'Administrative agreement template'
    };
  }
  if (/iklan\s+geprek/i.test(f)) {
    return {
      status: 'archived',
      authority: 'tier_4_supporting_doc',
      version: 'MEDIA-PROMO',
      validFrom: '2025-01-01T00:00:00.000Z',
      validUntil: '2025-12-31T23:59:59.000Z',
      owner: 'MARKETING',
      supersedes: null,
      supersededBy: null,
      notes: 'Promotional video asset'
    };
  }

  // 2. Hi-Think Career Program (Archived / Historical as confirmed by UAT P0-3)
  if (/hi-think/i.test(f) || /hi-think/i.test(c)) {
    return {
      status: 'archived',
      authority: 'tier_3_curriculum_guideline',
      version: 'HISTORICAL-2024',
      validFrom: '2024-01-01T00:00:00.000Z',
      validUntil: '2025-12-31T23:59:59.000Z',
      owner: 'CAREER_CENTER',
      supersedes: null,
      supersededBy: null,
      notes: 'Historical career acceleration program documentation'
    };
  }

  // 3. Official Accreditation Certificates (Tier 1 Decrees)
  if (/sertifikat\s+akreditasi/i.test(f)) {
    if (/bd.*05\s+okt\s+2022.*05\s+okt\s+2027/i.test(f)) {
      return {
        status: 'active',
        authority: 'tier_1_official_decree',
        version: 'LAM-INFOKOM-2022',
        validFrom: '2022-10-05T00:00:00.000Z',
        validUntil: '2027-10-05T23:59:59.000Z',
        owner: 'PENJAMINAN_MUTU',
        supersedes: null,
        supersededBy: null,
        notes: 'Sertifikat Akreditasi S1 Bisnis Digital'
      };
    }
    if (/sistem\s+informasi.*14\s+des\s+2023.*14\s+des\s+2028/i.test(f)) {
      return {
        status: 'active',
        authority: 'tier_1_official_decree',
        version: 'LAM-INFOKOM-2023',
        validFrom: '2023-12-14T00:00:00.000Z',
        validUntil: '2028-12-14T23:59:59.000Z',
        owner: 'PENJAMINAN_MUTU',
        supersedes: null,
        supersededBy: null,
        notes: 'Sertifikat Akreditasi S1 Sistem Informasi'
      };
    }
    if (/mi.*17\s+nov\s+2021.*17\s+nov\s+2026/i.test(f)) {
      return {
        status: 'active',
        authority: 'tier_1_official_decree',
        version: 'BAN-PT-2021',
        validFrom: '2021-11-17T00:00:00.000Z',
        validUntil: '2026-11-17T23:59:59.000Z',
        owner: 'PENJAMINAN_MUTU',
        supersedes: null,
        supersededBy: null,
        notes: 'Sertifikat Akreditasi D3 Manajemen Informatika'
      };
    }
    if (/sistem\s+komputer.*09\s+april\s+2025.*09\s+april\s+2030/i.test(f)) {
      return {
        status: 'active',
        authority: 'tier_1_official_decree',
        version: 'LAM-INFOKOM-2025',
        validFrom: '2025-04-09T00:00:00.000Z',
        validUntil: '2030-04-09T23:59:59.000Z',
        owner: 'PENJAMINAN_MUTU',
        supersedes: null,
        supersededBy: null,
        notes: 'Sertifikat Akreditasi S1 Sistem Komputer'
      };
    }
    if (/ti.*06\s+sept\s+2022.*06\s+sept\s+2027/i.test(f)) {
      return {
        status: 'active',
        authority: 'tier_1_official_decree',
        version: 'LAM-INFOKOM-2022',
        validFrom: '2022-09-06T00:00:00.000Z',
        validUntil: '2027-09-06T23:59:59.000Z',
        owner: 'PENJAMINAN_MUTU',
        supersedes: null,
        supersededBy: null,
        notes: 'Sertifikat Akreditasi S1 Teknologi Informasi'
      };
    }
    return {
      status: 'active',
      authority: 'tier_1_official_decree',
      version: 'AKREDITASI-RESMI',
      validFrom: '2023-01-01T00:00:00.000Z',
      validUntil: '2028-12-31T23:59:59.000Z',
      owner: 'PENJAMINAN_MUTU',
      supersedes: null,
      supersededBy: null,
      notes: 'Sertifikat Akreditasi Resmi'
    };
  }

  // 4. Official Tuition Fee Decrees (Tier 1 Decrees)
  if (/rincian\s+biaya/i.test(f)) {
    if (/utb/i.test(f)) {
      return {
        status: 'active',
        authority: 'tier_1_official_decree',
        version: 'SK-629-2025',
        validFrom: '2025-10-08T00:00:00.000Z',
        validUntil: '2027-08-31T23:59:59.000Z',
        owner: 'KEUANGAN_PMB',
        supersedes: null,
        supersededBy: null,
        notes: 'SK Rektor Rincian Biaya Dual Degree UTB TA 2026/2027'
      };
    }
    return {
      status: 'active',
      authority: 'tier_1_official_decree',
      version: 'SK-BIAYA-TA-2026/2027',
      validFrom: '2025-10-01T00:00:00.000Z',
      validUntil: '2027-08-31T23:59:59.000Z',
      owner: 'KEUANGAN_PMB',
      supersedes: null,
      supersededBy: null,
      notes: 'SK Rektor Rincian Biaya Pendidikan TA 2026/2027'
    };
  }

  // 5. Official Decrees (SK Ormawa, SK Pengelola)
  if (/sk\s+pembina\s+ormawa/i.test(f)) {
    return {
      status: 'active',
      authority: 'tier_1_official_decree',
      version: 'SK-ORMAWA-2026',
      validFrom: '2026-01-01T00:00:00.000Z',
      validUntil: '2026-12-31T23:59:59.000Z',
      owner: 'KEMAHASISWAAN',
      supersedes: null,
      supersededBy: null,
      notes: 'SK Rektor Penetapan Pembina Ormawa 2026'
    };
  }
  if (/revisi\s+sk\s+pengelola\s+inbis\s+2025/i.test(f)) {
    return {
      status: 'superseded',
      authority: 'tier_1_official_decree',
      version: 'SK-INBIS-2025-REV',
      validFrom: '2025-01-01T00:00:00.000Z',
      validUntil: '2025-12-31T23:59:59.000Z',
      owner: 'INBIS',
      supersedes: null,
      supersededBy: 'Profil INBIS Bali - 2026.docx',
      notes: 'SK Pengelola INBIS 2025 (telah digantikan struktur 2026)'
    };
  }

  // 6. Announcements & Calendars (Tier 2)
  if (/yudisium/i.test(f)) {
    return {
      status: 'active',
      authority: 'tier_2_official_announcement',
      version: 'YUDISIUM-I-2026/2027',
      validFrom: '2026-09-01T00:00:00.000Z',
      validUntil: '2026-10-31T23:59:59.000Z',
      owner: 'BAAK',
      supersedes: null,
      supersededBy: null,
      notes: 'Pengumuman Pendaftaran & Pelaksanaan Yudisium I Wisuda XXXVIII TA 2026/2027'
    };
  }
  if (/kalender\s+akademik.*2025-2026/i.test(f) || /kalender-akademik-2025/i.test(f)) {
    return {
      status: 'superseded',
      authority: 'tier_2_official_announcement',
      version: 'KALENDER-2025/2026',
      validFrom: '2025-08-01T00:00:00.000Z',
      validUntil: '2026-08-31T23:59:59.000Z',
      owner: 'BAAK',
      supersedes: null,
      supersededBy: 'Kalender-Akademik-2026/2027',
      notes: 'Kalender Akademik TA 2025/2026 (superseded oleh TA 2026/2027)'
    };
  }
  if (/kalender\s+pendaftaran/i.test(f)) {
    return {
      status: 'active',
      authority: 'tier_2_official_announcement',
      version: 'PMB-KALENDER-2026',
      validFrom: '2026-01-01T00:00:00.000Z',
      validUntil: '2026-12-31T23:59:59.000Z',
      owner: 'PMB',
      supersedes: null,
      supersededBy: null,
      notes: 'Kalender Gelombang Pendaftaran Mahasiswa Baru 2026'
    };
  }

  // 7. Academic Guidelines & Curriculum (Tier 3)
  if (/pedoman\s+ta/i.test(f)) {
    return {
      status: 'active',
      authority: 'tier_3_curriculum_guideline',
      version: 'PEDOMAN-TA-2019-REV1',
      validFrom: '2019-08-01T00:00:00.000Z',
      validUntil: null,
      owner: 'BAAK',
      supersedes: 'Pedoman TA 2019 Versi Awal',
      supersededBy: null,
      notes: 'Buku Pedoman Tugas Akhir S1 Revisi 1'
    };
  }
  if (/double\s+degree/i.test(f) || /exchange/i.test(f) || /international/i.test(f)) {
    return {
      status: 'active',
      authority: 'tier_3_curriculum_guideline',
      version: 'INTL-PROG-2026',
      validFrom: '2025-01-01T00:00:00.000Z',
      validUntil: null,
      owner: 'KSL',
      supersedes: null,
      supersededBy: null,
      notes: 'Panduan Program Internasional dan Double Degree'
    };
  }
  if (/penjelasan\s+prodi/i.test(f) || /hobi_prodi/i.test(f) || /program_studi_/i.test(f) || /scholarship/i.test(f) || /tuition_fee/i.test(f)) {
    return {
      status: 'active',
      authority: 'tier_3_curriculum_guideline',
      version: 'PRODI-CURRICULUM-2026',
      validFrom: '2025-01-01T00:00:00.000Z',
      validUntil: null,
      owner: 'PMB',
      supersedes: null,
      supersededBy: null,
      notes: 'Panduan Profil, Kurikulum, dan Karier Program Studi'
    };
  }
  if (/pascasarjana/i.test(f)) {
    return {
      status: 'active',
      authority: 'tier_3_curriculum_guideline',
      version: 'PASCA-2026',
      validFrom: '2025-01-01T00:00:00.000Z',
      validUntil: null,
      owner: 'PASCASARJANA',
      supersedes: null,
      supersededBy: null,
      notes: 'Dataset Program Pascasarjana Magister Sistem Informasi'
    };
  }
  if (/fasilitas/i.test(f)) {
    return {
      status: 'active',
      authority: 'tier_3_curriculum_guideline',
      version: 'FASILITAS-2026',
      validFrom: '2025-01-01T00:00:00.000Z',
      validUntil: null,
      owner: 'SARPRAS',
      supersedes: null,
      supersededBy: null,
      notes: 'Profil Fasilitas dan Laboratorium Kampus'
    };
  }

  // 8. INBIS 2026 Active Profile
  if (/inbis.*2026/i.test(f)) {
    return {
      status: 'active',
      authority: 'tier_4_supporting_doc',
      version: 'INBIS-2026-V1',
      validFrom: '2026-01-01T00:00:00.000Z',
      validUntil: null,
      owner: 'INBIS',
      supersedes: 'Revisi SK Pengelola INBIS 2025.docx',
      supersededBy: null,
      notes: 'Profil Inkubator Bisnis (INBIS) 2026'
    };
  }

  // 9. Default Supporting Profiles (Tier 4)
  return {
    status: 'active',
    authority: 'tier_4_supporting_doc',
    version: 'PROFILE-2026',
    validFrom: '2025-01-01T00:00:00.000Z',
    validUntil: null,
    owner: 'KEMAHASISWAAN',
    supersedes: null,
    supersededBy: null,
    notes: 'Profil Unit / Organisasi Mahasiswa / Informasi Pendukung'
  };
}

async function migrateDatabase(prisma) {
  console.log('--- Migrating Database TrainingData Records ---');
  const records = await prisma.trainingData.findMany({
    select: { id: true, filename: true, content: true }
  });

  const stats = {
    total: records.length,
    byStatus: { active: 0, superseded: 0, expired: 0, draft: 0, archived: 0 },
    byAuthority: {
      tier_1_official_decree: 0,
      tier_2_official_announcement: 0,
      tier_3_curriculum_guideline: 0,
      tier_4_supporting_doc: 0
    }
  };

  const nowIso = new Date().toISOString();

  for (const record of records) {
    const classification = classifyDocument(record.filename, record.content);
    const tierMeta = getAuthorityTier(classification.authority);

    const governanceMetadata = {
      status: classification.status,
      authority: classification.authority,
      authorityTier: tierMeta.tier,
      authorityWeight: tierMeta.weight,
      version: classification.version,
      validFrom: classification.validFrom,
      validUntil: classification.validUntil,
      owner: classification.owner,
      supersedes: classification.supersedes,
      supersededBy: classification.supersededBy,
      notes: classification.notes,
      migratedAt: nowIso
    };

    await prisma.trainingData.update({
      where: { id: record.id },
      data: {
        governanceStatus: classification.status,
        governanceVersion: classification.version,
        governanceOwner: classification.owner,
        validFrom: classification.validFrom ? new Date(classification.validFrom) : null,
        validTo: classification.validUntil ? new Date(classification.validUntil) : null,
        governanceMetadata
      }
    });

    stats.byStatus[classification.status] = (stats.byStatus[classification.status] || 0) + 1;
    stats.byAuthority[classification.authority] = (stats.byAuthority[classification.authority] || 0) + 1;
  }

  console.log(`Database Migration Complete: ${stats.total} records updated.`);
  console.log('  Status Breakdown:', JSON.stringify(stats.byStatus, null, 2));
  console.log('  Authority Breakdown:', JSON.stringify(stats.byAuthority, null, 2));
  return stats;
}

function migrateIndexFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`Index file not found, skipping: ${filePath}`);
    return null;
  }

  console.log(`--- Migrating Index File: ${filePath} ---`);
  const raw = fs.readFileSync(filePath, 'utf8');
  let data = JSON.parse(raw);
  const isWrapped = !Array.isArray(data) && Array.isArray(data.chunks);
  const chunks = isWrapped ? data.chunks : (Array.isArray(data) ? data : []);

  const stats = {
    file: filePath,
    total: chunks.length,
    byStatus: { active: 0, superseded: 0, expired: 0, draft: 0, archived: 0 },
    byAuthority: {
      tier_1_official_decree: 0,
      tier_2_official_announcement: 0,
      tier_3_curriculum_guideline: 0,
      tier_4_supporting_doc: 0
    }
  };

  const nowIso = new Date().toISOString();

  const migratedChunks = chunks.map((chunk) => {
    const filename = chunk.filename || chunk.sourceFile || (chunk.metadata && chunk.metadata.source) || '';
    const content = chunk.chunk || chunk.text || chunk.content || '';
    const classification = classifyDocument(filename, content);
    const tierMeta = getAuthorityTier(classification.authority);

    const governanceMetadata = {
      status: classification.status,
      authority: classification.authority,
      authorityTier: tierMeta.tier,
      authorityWeight: tierMeta.weight,
      version: classification.version,
      validFrom: classification.validFrom,
      validUntil: classification.validUntil,
      owner: classification.owner,
      supersedes: classification.supersedes,
      supersededBy: classification.supersededBy,
      notes: classification.notes,
      migratedAt: nowIso
    };

    stats.byStatus[classification.status] = (stats.byStatus[classification.status] || 0) + 1;
    stats.byAuthority[classification.authority] = (stats.byAuthority[classification.authority] || 0) + 1;

    return {
      ...chunk,
      governanceStatus: classification.status,
      status: classification.status,
      validFrom: classification.validFrom,
      validUntil: classification.validUntil,
      version: classification.version,
      authority: classification.authority,
      authorityTier: tierMeta.tier,
      authorityWeight: tierMeta.weight,
      supersedes: classification.supersedes,
      supersededBy: classification.supersededBy,
      governanceMetadata
    };
  });

  const output = isWrapped ? { ...data, chunks: migratedChunks } : migratedChunks;
  fs.writeFileSync(filePath, JSON.stringify(output, null, 2), 'utf8');
  console.log(`Migrated ${migratedChunks.length} chunks in ${filePath}`);
  console.log('  Status Breakdown:', JSON.stringify(stats.byStatus));
  console.log('  Authority Breakdown:', JSON.stringify(stats.byAuthority));
  return stats;
}

async function run() {
  const prisma = new PrismaClient();
  try {
    console.log('================================================================');
    console.log('STARTING DOCUMENT VALIDITY & LIFECYCLE GOVERNANCE CORPUS MIGRATION');
    console.log('================================================================');

    const dbStats = await migrateDatabase(prisma);

    const targetIndexes = [
      path.resolve(__dirname, '..', 'src', 'data', 'rag_index.json'),
      path.resolve(__dirname, '..', 'data', 'rag_index.json'),
      path.resolve(__dirname, '..', 'data', 'runtime', 'index_snapshots', '2026-08-11T04-14-17-889Z_before-final-knowledgeprep-deploy', 'rag_index.json'),
      path.resolve(__dirname, '..', 'data', 'runtime', 'index_snapshots', '2026-08-11T04-15-00-138Z_after-final-knowledgeprep-ready', 'rag_index.json')
    ];

    const indexStats = [];
    for (const p of targetIndexes) {
      const res = migrateIndexFile(p);
      if (res) indexStats.push(res);
    }

    console.log('================================================================');
    console.log('MIGRATION SUMMARY');
    console.log(`- Database records migrated: ${dbStats.total}`);
    console.log(`- Index files migrated: ${indexStats.length}`);
    for (const is of indexStats) {
      console.log(`  * ${path.basename(path.dirname(is.file))}/${path.basename(is.file)}: ${is.total} chunks`);
    }
    console.log('SUCCESS: Document Validity & Lifecycle Governance migration completed.');
    console.log('================================================================');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  run();
}

module.exports = {
  classifyDocument,
  migrateDatabase,
  migrateIndexFile
};
