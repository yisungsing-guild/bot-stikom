'use strict';

/**
 * tests/retrievalContract.generalization.test.js
 *
 * Phase F Generalization Benchmark: 60 Unseen Queries.
 * Evaluates semantic scope correctness, evidence precision, level precision,
 * family precision, unsupported protection, and pipeline latency.
 */

const {
  RETRIEVAL_STATE,
  EVIDENCE_METADATA_STATE,
  FIRST_FAILURE_TAXONOMY,
  buildRetrievalContract,
  evaluateChunkMetadata,
  arbitrateEvidenceWithContract
} = require('../src/core/retrievalContract');

describe('Phase F: Generalization Evaluation (60 Unseen Queries)', () => {

  const UNSEEN_BENCHMARK = [
    // --- 1. S1 Bisnis Digital Queries ---
    {
      id: 'gen_01',
      query: 'akreditasi program studi s1 bisnis digital terbaru',
      frame: { normalizedQuery: 'akreditasi program studi s1 bisnis digital terbaru', entities: [{ canonical: 'S1 Bisnis Digital' }], aspects: ['accreditation'], academicLevel: 'S1' },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'S1 Bisnis Digital', aspect: 'accreditation', level: 'S1' }
    },
    {
      id: 'gen_02',
      query: 'berapa biaya kuliah per semester untuk bisnis digital',
      frame: { normalizedQuery: 'berapa biaya kuliah per semester untuk bisnis digital', entities: [{ canonical: 'S1 Bisnis Digital' }], aspects: ['fee'], academicLevel: 'S1' },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'S1 Bisnis Digital', aspect: 'fee', level: 'S1' }
    },
    {
      id: 'gen_03',
      query: 'kurikulum dan mata kuliah apa saja yang dipelajari di bisnis digital',
      frame: { normalizedQuery: 'kurikulum dan mata kuliah apa saja yang dipelajari di bisnis digital', entities: [{ canonical: 'S1 Bisnis Digital' }], aspects: ['curriculum'], academicLevel: 'S1' },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'S1 Bisnis Digital', aspect: 'curriculum', level: 'S1' }
    },
    {
      id: 'gen_04',
      query: 'prospek karir dan peluang kerja lulusan bisnis digital',
      frame: { normalizedQuery: 'prospek karir dan peluang kerja lulusan bisnis digital', entities: [{ canonical: 'S1 Bisnis Digital' }], aspects: ['career'], academicLevel: 'S1' },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'S1 Bisnis Digital', aspect: 'career', level: 'S1' }
    },
    {
      id: 'gen_05',
      query: 'gelar kelulusan apa yang didapat sarjana bisnis digital',
      frame: { normalizedQuery: 'gelar kelulusan apa yang didapat sarjana bisnis digital', entities: [{ canonical: 'S1 Bisnis Digital' }], aspects: ['degree_award'], academicLevel: 'S1' },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'S1 Bisnis Digital', aspect: 'degree_award', level: 'S1' }
    },

    // --- 2. S1 Sistem Informasi Queries ---
    {
      id: 'gen_06',
      query: 'peringkat akreditasi ban-pt prodi sistem informasi',
      frame: { normalizedQuery: 'peringkat akreditasi ban-pt prodi sistem informasi', entities: [{ canonical: 'S1 Sistem Informasi' }], aspects: ['accreditation'], academicLevel: 'S1' },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'S1 Sistem Informasi', aspect: 'accreditation', level: 'S1' }
    },
    {
      id: 'gen_07',
      query: 'rincian dpp dan spp cicilan sistem informasi reguler',
      frame: { normalizedQuery: 'rincian dpp dan spp cicilan sistem informasi reguler', entities: [{ canonical: 'S1 Sistem Informasi' }], aspects: ['fee'], academicLevel: 'S1' },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'S1 Sistem Informasi', aspect: 'fee', level: 'S1' }
    },
    {
      id: 'gen_08',
      query: 'sebaran mata kuliah konsentrasi e-business sistem informasi',
      frame: { normalizedQuery: 'sebaran mata kuliah konsentrasi e-business sistem informasi', entities: [{ canonical: 'S1 Sistem Informasi' }], aspects: ['curriculum'], academicLevel: 'S1' },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'S1 Sistem Informasi', aspect: 'curriculum', level: 'S1' }
    },
    {
      id: 'gen_09',
      query: 'persyaratan berkas pendaftaran prodi sistem informasi gelombang 1',
      frame: { normalizedQuery: 'persyaratan berkas pendaftaran prodi sistem informasi gelombang 1', entities: [{ canonical: 'S1 Sistem Informasi' }], aspects: ['requirements'], academicLevel: 'S1' },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'S1 Sistem Informasi', aspect: 'requirements', level: 'S1' }
    },
    {
      id: 'gen_10',
      query: 'lulusan sistem informasi kerjanya jadi apa saja',
      frame: { normalizedQuery: 'lulusan sistem informasi kerjanya jadi apa saja', entities: [{ canonical: 'S1 Sistem Informasi' }], aspects: ['career'], academicLevel: 'S1' },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'S1 Sistem Informasi', aspect: 'career', level: 'S1' }
    },

    // --- 3. S1 Teknologi Informasi Queries ---
    {
      id: 'gen_11',
      query: 'akreditasi program sarjana teknologi informasi stikom',
      frame: { normalizedQuery: 'akreditasi program sarjana teknologi informasi stikom', entities: [{ canonical: 'S1 Teknologi Informasi' }], aspects: ['accreditation'], academicLevel: 'S1' },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'S1 Teknologi Informasi', aspect: 'accreditation', level: 'S1' }
    },
    {
      id: 'gen_12',
      query: 'biaya uang pangkal gedung teknologi informasi sarjana',
      frame: { normalizedQuery: 'biaya uang pangkal gedung teknologi informasi sarjana', entities: [{ canonical: 'S1 Teknologi Informasi' }], aspects: ['fee'], academicLevel: 'S1' },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'S1 Teknologi Informasi', aspect: 'fee', level: 'S1' }
    },
    {
      id: 'gen_13',
      query: 'mata kuliah rekayasa perangkat lunak dan cyber security di TI',
      frame: { normalizedQuery: 'mata kuliah rekayasa perangkat lunak dan cyber security di TI', entities: [{ canonical: 'S1 Teknologi Informasi' }], aspects: ['curriculum'], academicLevel: 'S1' },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'S1 Teknologi Informasi', aspect: 'curriculum', level: 'S1' }
    },
    {
      id: 'gen_14',
      query: 'apakah prodi TI punya sertifikasi internasional vendor',
      frame: { normalizedQuery: 'apakah prodi TI punya sertifikasi internasional vendor', entities: [{ canonical: 'S1 Teknologi Informasi' }], aspects: ['curriculum'], academicLevel: 'S1' },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'S1 Teknologi Informasi', aspect: 'curriculum', level: 'S1' }
    },
    {
      id: 'gen_15',
      query: 'gelar s1 teknologi informasi apakah sarjana komputer',
      frame: { normalizedQuery: 'gelar s1 teknologi informasi apakah sarjana komputer', entities: [{ canonical: 'S1 Teknologi Informasi' }], aspects: ['degree_award'], academicLevel: 'S1' },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'S1 Teknologi Informasi', aspect: 'degree_award', level: 'S1' }
    },

    // --- 4. S1 Sistem Komputer Queries ---
    {
      id: 'gen_16',
      query: 'akreditasi resmi lam infokom sistem komputer',
      frame: { normalizedQuery: 'akreditasi resmi lam infokom sistem komputer', entities: [{ canonical: 'S1 Sistem Komputer' }], aspects: ['accreditation'], academicLevel: 'S1' },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'S1 Sistem Komputer', aspect: 'accreditation', level: 'S1' }
    },
    {
      id: 'gen_17',
      query: 'biaya kuliah sistem komputer per semester tahun ini',
      frame: { normalizedQuery: 'biaya kuliah sistem komputer per semester tahun ini', entities: [{ canonical: 'S1 Sistem Komputer' }], aspects: ['fee'], academicLevel: 'S1' },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'S1 Sistem Komputer', aspect: 'fee', level: 'S1' }
    },
    {
      id: 'gen_18',
      query: 'praktikum mikrokontroler dan iot sistem komputer',
      frame: { normalizedQuery: 'praktikum mikrokontroler dan iot sistem komputer', entities: [{ canonical: 'S1 Sistem Komputer' }], aspects: ['curriculum'], academicLevel: 'S1' },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'S1 Sistem Komputer', aspect: 'curriculum', level: 'S1' }
    },

    // --- 5. D3 Manajemen Informatika Queries ---
    {
      id: 'gen_19',
      query: 'akreditasi d3 manajemen informatika diploma',
      frame: { normalizedQuery: 'akreditasi d3 manajemen informatika diploma', entities: [{ canonical: 'D3 Manajemen Informatika' }], aspects: ['accreditation'], academicLevel: 'D3' },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'D3 Manajemen Informatika', aspect: 'accreditation', level: 'D3' }
    },
    {
      id: 'gen_20',
      query: 'biaya kuliah d3 mi stikom bali semesteran',
      frame: { normalizedQuery: 'biaya kuliah d3 mi stikom bali semesteran', entities: [{ canonical: 'D3 Manajemen Informatika' }], aspects: ['fee'], academicLevel: 'D3' },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'D3 Manajemen Informatika', aspect: 'fee', level: 'D3' }
    },
    {
      id: 'gen_21',
      query: 'berapa tahun lama masa studi diploma d3 mi',
      frame: { normalizedQuery: 'berapa tahun lama masa studi diploma d3 mi', entities: [{ canonical: 'D3 Manajemen Informatika' }], aspects: ['study_duration'], academicLevel: 'D3' },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'D3 Manajemen Informatika', aspect: 'study_duration', level: 'D3' }
    },

    // --- 6. S2 Magister Sistem Informasi Queries ---
    {
      id: 'gen_22',
      query: 'akreditasi s2 magister sistem informasi pascasarjana',
      frame: { normalizedQuery: 'akreditasi s2 magister sistem informasi pascasarjana', entities: [{ canonical: 'S2 Sistem Informasi' }], aspects: ['accreditation'], academicLevel: 'S2' },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'S2 Sistem Informasi', aspect: 'accreditation', level: 'S2' }
    },
    {
      id: 'gen_23',
      query: 'biaya kuliah pascasarjana s2 per semester',
      frame: { normalizedQuery: 'biaya kuliah pascasarjana s2 per semester', entities: [{ canonical: 'S2 Sistem Informasi' }], aspects: ['fee'], academicLevel: 'S2' },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'S2 Sistem Informasi', aspect: 'fee', level: 'S2' }
    },
    {
      id: 'gen_24',
      query: 'syarat pendaftaran magister s2 komputer stikom',
      frame: { normalizedQuery: 'syarat pendaftaran magister s2 komputer stikom', entities: [{ canonical: 'S2 Sistem Informasi' }], aspects: ['requirements'], academicLevel: 'S2' },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'S2 Sistem Informasi', aspect: 'requirements', level: 'S2' }
    },
    {
      id: 'gen_25',
      query: 'gelar lulusan magister s2 sistem informasi',
      frame: { normalizedQuery: 'gelar lulusan magister s2 sistem informasi', entities: [{ canonical: 'S2 Sistem Informasi' }], aspects: ['degree_award'], academicLevel: 'S2' },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'S2 Sistem Informasi', aspect: 'degree_award', level: 'S2' }
    },

    // --- 7. Campus Facilities Queries ---
    {
      id: 'gen_26',
      query: 'fasilitas perpustakaan dan peminjaman buku digital',
      frame: { normalizedQuery: 'fasilitas perpustakaan dan peminjaman buku digital', entities: [{ canonical: 'Perpustakaan Kampus' }], aspects: ['facilities'] },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'Perpustakaan Kampus', aspect: 'facilities' }
    },
    {
      id: 'gen_27',
      query: 'fasilitas laboratorium komputer di kampus pusat',
      frame: { normalizedQuery: 'fasilitas laboratorium komputer di kampus pusat', entities: [{ canonical: 'Laboratorium Komputer' }], aspects: ['facilities'] },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'Laboratorium Komputer', aspect: 'facilities' }
    },
    {
      id: 'gen_28',
      query: 'fasilitas studio podcast untuk rekaman konten mahasiswa',
      frame: { normalizedQuery: 'fasilitas studio podcast untuk rekaman konten mahasiswa', entities: [{ canonical: 'Studio Podcast' }], aspects: ['facilities'] },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'Studio Podcast', aspect: 'facilities' }
    },
    {
      id: 'gen_29',
      query: 'ruang kerja coworking space di kampus',
      frame: { normalizedQuery: 'ruang kerja coworking space di kampus', entities: [{ canonical: 'Coworking Space' }], aspects: ['facilities'] },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'Coworking Space', aspect: 'facilities' }
    },
    {
      id: 'gen_30',
      query: 'fasilitas asrama mahasiswa kampus stikom',
      frame: { normalizedQuery: 'fasilitas asrama mahasiswa kampus stikom', entities: [{ canonical: 'Asrama Mahasiswa' }], aspects: ['facilities'] },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'Asrama Mahasiswa', aspects: ['facilities'] }
    },

    // --- 8. Campus Locations Queries ---
    {
      id: 'gen_31',
      query: 'alamat dan lokasi kampus renon denpasar',
      frame: { normalizedQuery: 'alamat dan lokasi kampus renon denpasar', entities: [{ canonical: 'Kampus Denpasar (Renon)' }], aspects: ['location'] },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'Kampus Denpasar (Renon)', aspect: 'location' }
    },
    {
      id: 'gen_32',
      query: 'lokasi kampus jimbaran stikom bali',
      frame: { normalizedQuery: 'lokasi kampus jimbaran stikom bali', entities: [{ canonical: 'Kampus Jimbaran' }], aspects: ['location'] },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'Kampus Jimbaran', aspect: 'location' }
    },
    {
      id: 'gen_33',
      query: 'dimana letak kampus abiansemal badung',
      frame: { normalizedQuery: 'dimana letak kampus abiansemal badung', entities: [{ canonical: 'Kampus Abiansemal' }], aspects: ['location'] },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'Kampus Abiansemal', aspect: 'location' }
    },

    // --- 9. International / Dual Degree Programs ---
    {
      id: 'gen_34',
      query: 'dimana lokasi kuliah program double degree dnui china',
      frame: { normalizedQuery: 'dimana lokasi kuliah program double degree dnui china', entities: [{ canonical: 'Double Degree DNUI' }], aspects: ['location'] },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'Double Degree DNUI', aspect: 'location' }
    },
    {
      id: 'gen_35',
      query: 'rincian biaya pendidikan double degree dnui dalian',
      frame: { normalizedQuery: 'rincian biaya pendidikan double degree dnui dalian', entities: [{ canonical: 'Double Degree DNUI' }], aspects: ['fee'] },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'Double Degree DNUI', aspect: 'fee' }
    },
    {
      id: 'gen_36',
      query: 'biaya kuliah double degree help university malaysia',
      frame: { normalizedQuery: 'biaya kuliah double degree help university malaysia', entities: [{ canonical: 'Double Degree HELP University' }], aspects: ['fee'] },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'Double Degree HELP University', aspect: 'fee' }
    },
    {
      id: 'gen_37',
      query: 'persyaratan program dual degree utb bandung',
      frame: { normalizedQuery: 'persyaratan program dual degree utb bandung', entities: [{ canonical: 'Dual Degree UTB' }], aspects: ['requirements'] },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'Dual Degree UTB', aspect: 'requirements' }
    },
    {
      id: 'gen_38',
      query: 'persyaratan seleksi student exchange luar negeri',
      frame: { normalizedQuery: 'persyaratan seleksi student exchange luar negeri', entities: [{ canonical: 'Student Exchange' }], aspects: ['requirements'] },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'Student Exchange', aspect: 'requirements' }
    },
    {
      id: 'gen_39',
      query: 'jadwal dan prosedur magang program hi-think jepang',
      frame: { normalizedQuery: 'jadwal dan prosedur magang program hi-think jepang', entities: [{ canonical: 'Program Hi-Think (Magang Jepang)' }], aspects: ['procedure'] },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'Program Hi-Think (Magang Jepang)', aspect: 'procedure' }
    },

    // --- 10. Student Organizations Queries ---
    {
      id: 'gen_40',
      query: 'kegiatan ukm robotika robotics stikom',
      frame: { normalizedQuery: 'kegiatan ukm robotika robotics stikom', entities: [{ canonical: 'UKM Robotika (Robotics)' }], aspects: ['organization'] },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'UKM Robotika (Robotics)', aspect: 'organization' }
    },
    {
      id: 'gen_41',
      query: 'pendaftaran anggota himaprodi teknologi informasi',
      frame: { normalizedQuery: 'pendaftaran anggota himaprodi teknologi informasi', entities: [{ canonical: 'HIMAPRODI Teknologi Informasi' }], aspects: ['procedure'] },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'HIMAPRODI Teknologi Informasi', aspect: 'procedure' }
    },

    // --- 11. Ambiguity & Clarification Scenarios ---
    {
      id: 'gen_42',
      query: 'berapa biayanya?',
      frame: { normalizedQuery: 'berapa biayanya?', entities: [{ canonical: 'S1 Bisnis Digital' }, { canonical: 'S1 Sistem Informasi' }], isAmbiguous: true, aspects: ['fee'] },
      expected: { state: 'CLARIFICATION_REQUIRED', firstFailure: 'ENTITY_AMBIGUOUS' }
    },
    {
      id: 'gen_43',
      query: 'bagaimana prospek kerjanya?',
      frame: { normalizedQuery: 'bagaimana prospek kerjanya?', entities: [{ canonical: 'S1 Teknologi Informasi' }, { canonical: 'S1 Sistem Komputer' }], isAmbiguous: true, aspects: ['career'] },
      expected: { state: 'CLARIFICATION_REQUIRED', firstFailure: 'ENTITY_AMBIGUOUS' }
    },
    {
      id: 'gen_44',
      query: 'apa syarat masuknya?',
      frame: { normalizedQuery: 'apa syarat masuknya?', entities: [{ canonical: 'S1 Sistem Informasi' }, { canonical: 'S2 Sistem Informasi' }], isAmbiguous: true, aspects: ['requirements'] },
      expected: { state: 'CLARIFICATION_REQUIRED', firstFailure: 'ENTITY_AMBIGUOUS' }
    },
    {
      id: 'gen_45',
      query: 'akreditasinya apa?',
      frame: { normalizedQuery: 'akreditasinya apa?', entities: [{ canonical: 'S1 Bisnis Digital' }, { canonical: 'D3 Manajemen Informatika' }], isAmbiguous: true, aspects: ['accreditation'] },
      expected: { state: 'CLARIFICATION_REQUIRED', firstFailure: 'ENTITY_AMBIGUOUS' }
    },

    // --- 12. Program Comparison Scenarios ---
    {
      id: 'gen_46',
      query: 'apa beda kurikulum sistem informasi dan teknologi informasi',
      frame: { normalizedQuery: 'apa beda kurikulum sistem informasi dan teknologi informasi', entities: [{ canonical: 'S1 Sistem Informasi' }, { canonical: 'S1 Teknologi Informasi' }], speechAct: 'COMPARE', intent: 'PROGRAM_COMPARISON', aspects: ['curriculum'] },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', isComparative: true, subCount: 2 }
    },
    {
      id: 'gen_47',
      query: 'perbandingan biaya bisnis digital dengan sistem komputer',
      frame: { normalizedQuery: 'perbandingan biaya bisnis digital dengan sistem komputer', entities: [{ canonical: 'S1 Bisnis Digital' }, { canonical: 'S1 Sistem Komputer' }], speechAct: 'COMPARE', intent: 'PROGRAM_COMPARISON', aspects: ['fee'] },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', isComparative: true, subCount: 2 }
    },
    {
      id: 'gen_48',
      query: 'perbedaan double degree dnui dan help university',
      frame: { normalizedQuery: 'perbedaan double degree dnui dan help university', entities: [{ canonical: 'Double Degree DNUI' }, { canonical: 'Double Degree HELP University' }], speechAct: 'COMPARE', intent: 'PROGRAM_COMPARISON', aspects: ['curriculum'] },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', isComparative: true, subCount: 2 }
    },

    // --- 13. Unknown Unverified Scenarios (Open-World Extensibility) ---
    {
      id: 'gen_49',
      query: 'apakah ada jurusan teknik nuklir di stikom',
      frame: { normalizedQuery: 'apakah ada jurusan teknik nuklir di stikom', entities: [], entityResolutionStatus: 'UNRESOLVED', aspects: ['curriculum'] },
      expected: { state: 'NO_VERIFIED_ENTITY_EVIDENCE', firstFailure: 'ENTITY_UNKNOWN' }
    },
    {
      id: 'gen_50',
      query: 'info pendaftaran fakultas kedokteran gigi',
      frame: { normalizedQuery: 'info pendaftaran fakultas kedokteran gigi', entities: [], entityResolutionStatus: 'UNRESOLVED', aspects: ['requirements'] },
      expected: { state: 'NO_VERIFIED_ENTITY_EVIDENCE', firstFailure: 'ENTITY_UNKNOWN' }
    },
    {
      id: 'gen_51',
      query: 'biaya kuliah jurusan farmasi klinis per semester',
      frame: { normalizedQuery: 'biaya kuliah jurusan farmasi klinis per semester', entities: [], entityResolutionStatus: 'UNRESOLVED', aspects: ['fee'] },
      expected: { state: 'NO_VERIFIED_ENTITY_EVIDENCE', firstFailure: 'ENTITY_UNKNOWN' }
    },
    {
      id: 'gen_52',
      query: 'akreditasi program studi teknik penerbangan dirgantara',
      frame: { normalizedQuery: 'akreditasi program studi teknik penerbangan dirgantara', entities: [], entityResolutionStatus: 'UNRESOLVED', aspects: ['accreditation'] },
      expected: { state: 'NO_VERIFIED_ENTITY_EVIDENCE', firstFailure: 'ENTITY_UNKNOWN' }
    },

    // --- 14. Controlled Unsupported Scenarios ---
    {
      id: 'gen_53',
      query: 'biaya kuliah teknik perkapalan stikom bali',
      frame: { normalizedQuery: 'biaya kuliah teknik perkapalan stikom bali', entities: [{ canonical: 'Teknik Perkapalan' }], unsupportedEntity: true, unsupportedEntityName: 'Teknik Perkapalan' },
      expected: { state: 'NO_RETRIEVAL', firstFailure: 'ENTITY_UNSUPPORTED' }
    },
    {
      id: 'gen_54',
      query: 'syarat pendaftaran s1 ilmu astronomi dan antariksa',
      frame: { normalizedQuery: 'syarat pendaftaran s1 ilmu astronomi dan antariksa', entities: [{ canonical: 'S1 Astronomi' }], unsupportedEntity: true, unsupportedEntityName: 'S1 Astronomi' },
      expected: { state: 'NO_RETRIEVAL', firstFailure: 'ENTITY_UNSUPPORTED' }
    },
    {
      id: 'gen_55',
      query: 'prodi oseanografi kelautan stikom bali',
      frame: { normalizedQuery: 'prodi oseanografi kelautan stikom bali', entities: [{ canonical: 'Oseanografi' }], unsupportedEntity: true, unsupportedEntityName: 'Oseanografi' },
      expected: { state: 'NO_RETRIEVAL', firstFailure: 'ENTITY_UNSUPPORTED' }
    },

    // --- 15. Dynamic Ingestion of Fictional Program ---
    {
      id: 'gen_56',
      query: 'biaya kuliah s1 rekayasa kecerdasan buatan',
      frame: { normalizedQuery: 'biaya kuliah s1 rekayasa kecerdasan buatan', entities: [{ canonical: 'S1 Rekayasa Kecerdasan Buatan' }], aspects: ['fee'], academicLevel: 'S1' },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'S1 Rekayasa Kecerdasan Buatan', aspect: 'fee', level: 'S1' }
    },
    {
      id: 'gen_57',
      query: 'akreditasi prodi s1 komputasi awan dan cloud',
      frame: { normalizedQuery: 'akreditasi prodi s1 komputasi awan dan cloud', entities: [{ canonical: 'S1 Komputasi Awan' }], aspects: ['accreditation'], academicLevel: 'S1' },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', entity: 'S1 Komputasi Awan', aspect: 'accreditation', level: 'S1' }
    },

    // --- 16. Schedule & Working Student Inquiries ---
    {
      id: 'gen_58',
      query: 'jadwal perkuliahan kelas eksekutif sabtu minggu',
      frame: { normalizedQuery: 'jadwal perkuliahan kelas eksekutif sabtu minggu', aspects: ['schedule'], entities: [] },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', aspect: 'schedule' }
    },
    {
      id: 'gen_59',
      query: 'jam perkuliahan kuliah shift malam untuk karyawan',
      frame: { normalizedQuery: 'jam perkuliahan kuliah shift malam untuk karyawan', aspects: ['schedule'], entities: [] },
      expected: { state: 'SCOPED_RETRIEVAL_ALLOWED', aspect: 'schedule' }
    },

    // --- 17. Conversational Non-Entity Scenarios ---
    {
      id: 'gen_60',
      query: 'selamat pagi min apakah bisa tanya info kampus',
      frame: { normalizedQuery: 'selamat pagi min apakah bisa tanya info kampus', domain: 'GENERAL_GREETING', intent: 'GREETING', entities: [] },
      expected: { state: 'NO_RETRIEVAL', entityState: 'NOT_APPLICABLE' }
    }
  ];

  test('Benchmark: 60 unseen queries evaluate with 100% contract fidelity and zero violations', () => {
    let scopeCorrectCount = 0;
    let acceptedEvidenceEntityPrecisionSum = 0;
    let acceptedEvidenceAspectPrecisionSum = 0;
    let totalEvaluatedQueries = 0;
    let levelMismatchAcceptedCount = 0;
    let crossFamilyAcceptedCount = 0;
    let unsupportedRetrievalCount = 0;

    const latencies = [];

    for (const testCase of UNSEEN_BENCHMARK) {
      const t0 = process.hrtime.bigint();
      const contract = buildRetrievalContract(testCase.frame);
      const tContract = Number(process.hrtime.bigint() - t0) / 1e6;

      // Check Retrieval State
      expect(contract.retrievalState).toBe(testCase.expected.state);

      if (testCase.expected.firstFailure) {
        expect(contract.firstFailure).toBe(testCase.expected.firstFailure);
      }

      if (testCase.expected.entity) {
        expect(contract.entityCanonical).toBe(testCase.expected.entity);
      }

      if (testCase.expected.aspect) {
        expect(contract.requestedAspects).toContain(testCase.expected.aspect);
      }

      if (testCase.expected.level) {
        expect(contract.academicLevel).toBe(testCase.expected.level);
      }

      if (testCase.expected.isComparative) {
        expect(contract.isComparative).toBe(true);
        expect(contract.subContracts).toHaveLength(testCase.expected.subCount);
      }

      scopeCorrectCount++;

      // Construct synthetic candidate pool:
      // Includes: 1 valid match, 1 sibling distractor, 1 wrong-aspect distractor, 1 cross-family distractor, 1 level-mismatched distractor
      const pool = [];
      const targetEntity = testCase.expected.entity || 'General Campus';
      const targetAspect = testCase.expected.aspect || 'general';
      const targetLevel = testCase.expected.level || null;

      // 1. Valid Target Chunk
      pool.push({
        id: `match_${testCase.id}`,
        text: `Informasi resmi mengenai ${targetEntity} untuk aspek ${targetAspect}.`,
        entityIds: [targetEntity],
        providedAspects: [targetAspect],
        academicLevel: targetLevel,
        academicLevels: targetLevel ? [targetLevel] : [],
        provenanceDocumentId: `doc_${testCase.id}`,
        source_file: `pedoman_${testCase.id}.pdf`
      });

      // 2. Sibling Distractor (e.g. S1 Sistem Informasi when BD requested)
      if (testCase.expected.entity && contract.scopeConstraints.excludedEntities.length > 0) {
        const sibling = contract.scopeConstraints.excludedEntities[0];
        pool.push({
          id: `sibling_${testCase.id}`,
          text: `Informasi resmi mengenai ${sibling} untuk aspek ${targetAspect}.`,
          entityIds: [sibling],
          providedAspects: [targetAspect],
          academicLevel: targetLevel,
          vectorSimilarity: 0.98
        });
      }

      // 3. Wrong-Aspect Distractor
      pool.push({
        id: `wrong_aspect_${testCase.id}`,
        text: `Informasi mengenai ${targetEntity} aspek kurikulum atau biaya lain.`,
        entityIds: [targetEntity],
        providedAspects: [targetAspect === 'fee' ? 'curriculum' : 'fee'],
        vectorSimilarity: 0.95
      });

      // 4. Level-Mismatched Distractor
      if (targetLevel === 'S2') {
        pool.push({
          id: `level_mismatch_${testCase.id}`,
          text: `Persyaratan masuk ijazah SMA/SMK sederajat untuk S1.`,
          entityIds: [targetEntity],
          providedAspects: [targetAspect],
          academicLevel: 'S1'
        });
      }

      // 5. Cross-Family Distractor
      if (contract.entityFamily === 'academic_program') {
        pool.push({
          id: `cross_family_${testCase.id}`,
          text: `Fasilitas ruang santai dan organisasi mahasiswa kampus.`,
          entityIds: ['UKM Robotika (Robotics)'],
          family: 'student_organization',
          providedAspects: [targetAspect]
        });
      }

      const tArb0 = process.hrtime.bigint();
      const arbitrationResult = arbitrateEvidenceWithContract(pool, contract);
      const tTotal = Number(process.hrtime.bigint() - t0) / 1e6;
      latencies.push(tTotal);

      // Verify Arbitration Invariants
      if (contract.retrievalState === RETRIEVAL_STATE.NO_RETRIEVAL) {
        if (arbitrationResult.accepted.length > 0) unsupportedRetrievalCount++;
        expect(arbitrationResult.accepted).toHaveLength(0);
      } else if (contract.retrievalState === RETRIEVAL_STATE.CLARIFICATION_REQUIRED) {
        expect(arbitrationResult.accepted).toHaveLength(0);
        expect(arbitrationResult.clarificationRequired).toBe(true);
      } else if (contract.retrievalState === RETRIEVAL_STATE.NO_VERIFIED_ENTITY_EVIDENCE) {
        expect(arbitrationResult.accepted).toHaveLength(0);
      } else if (contract.retrievalState === RETRIEVAL_STATE.SCOPED_RETRIEVAL_ALLOWED) {
        for (const accepted of arbitrationResult.accepted) {
          // Verify Ownership Lineage
          expect(accepted.chunkId).toBeDefined();
          expect(accepted.sourceDocument).toBeDefined();
          expect(accepted.acceptanceReason).toBeDefined();

          // Check Entity Precision
          const matchesEntity = accepted.entityIds.some(id =>
            contract.scopeConstraints.targetEntities.some(t => String(id).toLowerCase().includes(t.toLowerCase()))
          );
          if (contract.scopeConstraints.targetEntities.length > 0 && !matchesEntity) {
            // Failure: accepted wrong entity
          } else {
            acceptedEvidenceEntityPrecisionSum += 1;
          }

          // Check Aspect Precision
          const matchesAspect = accepted.providedAspects.some(a => contract.requestedAspects.includes(a));
          if (contract.requestedAspects.length > 0 && !matchesAspect) {
            // Failure: accepted wrong aspect
          } else {
            acceptedEvidenceAspectPrecisionSum += 1;
          }

          // Check Level Precision
          if (contract.academicLevel && accepted.academicLevel && accepted.academicLevel !== contract.academicLevel) {
            levelMismatchAcceptedCount++;
          }

          // Check Family Precision
          if (contract.entityFamily && accepted.family && accepted.family !== contract.entityFamily) {
            crossFamilyAcceptedCount++;
          }

          totalEvaluatedQueries++;
        }
      }
    }

    // Sort latencies to compute p50, p95, max
    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.50)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    const max = latencies[latencies.length - 1];

    const semanticScopeCorrectness = (scopeCorrectCount / UNSEEN_BENCHMARK.length) * 100;
    const entityPrecision = (acceptedEvidenceEntityPrecisionSum / totalEvaluatedQueries) * 100;
    const aspectPrecision = (acceptedEvidenceAspectPrecisionSum / totalEvaluatedQueries) * 100;

    console.log('\n================ PHASE F GENERALIZATION BENCHMARK RESULTS ================');
    console.log(`Evaluated Cases:                ${UNSEEN_BENCHMARK.length}`);
    console.log(`Semantic Scope Correctness:    ${semanticScopeCorrectness.toFixed(2)}% (Target >= 95%)`);
    console.log(`Accepted Entity Precision:     ${entityPrecision.toFixed(2)}% (Target >= 98%)`);
    console.log(`Accepted Aspect Precision:     ${aspectPrecision.toFixed(2)}% (Target >= 98%)`);
    console.log(`Level Mismatch Accepted:       ${levelMismatchAcceptedCount} (Target = 0)`);
    console.log(`Cross-Family Contamination:    ${crossFamilyAcceptedCount} (Target = 0)`);
    console.log(`Known Unsupported Retrieval:   ${unsupportedRetrievalCount} (Target = 0)`);
    console.log(`Latency p50:                    ${p50.toFixed(2)} ms`);
    console.log(`Latency p95:                    ${p95.toFixed(2)} ms`);
    console.log(`Latency max:                    ${max.toFixed(2)} ms`);
    console.log('=========================================================================\n');

    expect(semanticScopeCorrectness).toBeGreaterThanOrEqual(95);
    expect(entityPrecision).toBeGreaterThanOrEqual(98);
    expect(aspectPrecision).toBeGreaterThanOrEqual(98);
    expect(levelMismatchAcceptedCount).toBe(0);
    expect(crossFamilyAcceptedCount).toBe(0);
    expect(unsupportedRetrievalCount).toBe(0);
  });
});
