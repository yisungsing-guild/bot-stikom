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
const { buildRetrievalContract } = require('./retrievalContract');

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
  const retrievalContract = buildRetrievalContract(semanticFrame);
  const contractTargets = retrievalContract.scopeConstraints?.targetEntities || [];
  const targetEntities = contractTargets.length > 0
    ? contractTargets
    : (entities || []).map(e => e.canonical || e.name || String(e));
  const normalizedText = String(normalizedQuery || semanticFrame.rawQuery || '').toLowerCase();

  const GENERIC_COMMON_WORDS = new Set([
    'akademik', 'kuliah', 'kampus', 'stikom', 'bali', 'mahasiswa', 'program',
    'studi', 'jurusan', 'fakultas', 'pendidikan', 'kurikulum', 'biaya', 'beasiswa',
    'fasilitas', 'gedung', 'kegiatan', 'organisasi'
  ]);

  // Generic discovery of conflicting / sibling entities to exclude across mutually exclusive families
  // INVARIANT: Explicitly requested entities in targetEntities must NEVER be excluded!
  // Invariant: Non-mutually-exclusive families like campus facilities or scholarships do not exclude each other
  const MUTUALLY_EXCLUSIVE_FAMILIES = new Set(['academic_program']);
  const targetEntitySet = new Set(targetEntities.map(t => t.toLowerCase()));
  const excludedConflictingEntities = [];
  for (const ent of targetEntities) {
    const canonicalObj = findCanonicalEntity(ent);
    const isMutuallyExclusive = canonicalObj && canonicalObj.family &&
      (MUTUALLY_EXCLUSIVE_FAMILIES.has(canonicalObj.family) || (canonicalObj.role && canonicalObj.role === 'double_degree'));
    if (isMutuallyExclusive) {
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

  // Program & Institutional Accreditation query variants
  if (domain === 'ACCREDITATION' || intent === 'INSTITUTIONAL_ACCREDITATION' || intent === 'PROGRAM_ACCREDITATION' || (aspects && (aspects.includes('accreditation') || aspects.includes('akreditasi')))) {
    if (targetEntities.length > 0) {
      for (const ent of targetEntities) {
        queryVariants.push(`sertifikat akreditasi ban-pt lam infokom ${ent} baik sekali peringkat resmi`);
        queryVariants.push(`akreditasi program studi ${ent} peringkat sertifikat status`);
        queryVariants.push(`status akreditasi ${ent}`);
      }
    } else {
      queryVariants.push('status akreditasi institusi program studi ITB STIKOM Bali BAN PT LAM INFOKOM');
    }
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
  if (domain === 'FACILITIES' || (aspects && (aspects.includes('facilities') || aspects.includes('lab')))) {
    queryVariants.push('fasilitas laboratorium praktikum mahasiswa hardware networking database smart intelligent system ITB STIKOM Bali');
    queryVariants.push('laboratorium riset dan praktik mahasiswa embedded system IoT mobile technology');
    queryVariants.push('fasilitas laboratorium komputer perpustakaan asrama kampus ITB STIKOM Bali');
    queryVariants.push('sarana dan prasarana fasilitas mahasiswa');
  }

  // Organization & UKM query variants
  if (domain === 'ORGANIZATION_UKM' || (aspects && (aspects.includes('organization') || aspects.includes('student_organization')))) {
    if (targetEntities.length > 0) {
      for (const ent of targetEntities) {
        queryVariants.push(`organisasi kemahasiswaan himaprodi himpunan mahasiswa ${ent} cakra pragnya filosofi profil kegiatan`);
        queryVariants.push(`organisasi kemahasiswaan himaprodi himpunan mahasiswa ${ent}`);
        queryVariants.push(`profile ${ent} kegiatan visi misi`);
      }
    }
    queryVariants.push('unit kegiatan mahasiswa UKM ormawa ITB STIKOM Bali');
    queryVariants.push('daftar organisasi kemahasiswaan himaprodi');
  }

  // Career Center & Internship query variants
  if (domain === 'CAREER_CENTER' || (aspects && (aspects.includes('career') || aspects.includes('internship') || aspects.includes('career_prospects')))) {
    if (targetEntities.length > 0) {
      for (const ent of targetEntities) {
        queryVariants.push(`peluang karir prospek kerja profesi lulusan ${ent}`);
        queryVariants.push(`peluang pekerjaan ${ent}`);
      }
    } else {
      queryVariants.push('career center inkubator bisnis inbis magang kerja sama industri ITB STIKOM Bali');
      queryVariants.push('layanan bursa kerja dan kemitraan');
    }
  }

  // Admission Schedule & Waves query variants
  if (intent === 'ADMISSION_SCHEDULE' || (aspects && aspects.includes('schedule'))) {
    queryVariants.push('jadwal gelombang pendaftaran PMB periode pendaftaran kalender pendaftaran tanggal penting');
    queryVariants.push('jadwal pendaftaran mahasiswa baru gelombang PMB ITB STIKOM Bali');
    queryVariants.push('batas waktu penutupan pendaftaran gelombang reguler PMB');
    queryVariants.push('waktu pendaftaran dibuka ditutup gelombang');
  }

  // PMB Contact query variants
  if (intent === 'PMB_CONTACT_INQUIRY' || (aspects && aspects.includes('contact'))) {
    queryVariants.push('kontak PMB whatsapp call center telepon email pendaftaran customer service ITB STIKOM Bali');
    queryVariants.push('nomor kontak informasi pendaftaran mahasiswa baru PMB');
  }

  // Payment confirmation procedure query variants
  if (intent === 'PAYMENT_CONFIRMATION_PROCEDURE' || ((aspects && aspects.includes('procedure')) && (aspects && (aspects.includes('fee') || aspects.includes('tuition'))))) {
    queryVariants.push('tata cara prosedur konfirmasi pembayaran biaya kuliah bukti bayar rekening keuangan ITB STIKOM Bali');
    queryVariants.push('konfirmasi pembayaran pendaftaran mahasiswa baru');
  }

  // Admission Requirements & Documents query variants
  if (intent === 'ADMISSION_REQUIREMENTS' || (aspects && aspects.includes('requirements'))) {
    queryVariants.push('syarat dokumen berkas pendaftaran mahasiswa baru ijazah skl kk ktp pasfoto PMB ITB STIKOM Bali');
    queryVariants.push('persyaratan berkas pendaftaran mahasiswa baru');
  }

  // Foreign Student / Visa / International query variants
  const isForeignQuery = (semanticFrame.participantScope === 'foreign') ||
    (/\b(mahasiswa\s+asing|visa|itas|kitas|izin\s+belajar|study\s+permit|e30b)\b/i.test(normalizedText));
  if (isForeignQuery) {
    if (/\b(izin\s+belajar|study\s+permit)\b/i.test(normalizedText)) {
      queryVariants.push('prosedur pengurusan izin belajar study permit mahasiswa asing ITB STIKOM Bali');
      queryVariants.push('dokumen yang diperlukan untuk pengurusan pengajuan izin belajar mahasiswa asing');
      queryVariants.push('FAQ pengurusan mahasiswa asing izin belajar study permit');
    }
    if (/\b(visa|e30b|vitas)\b/i.test(normalizedText) || !/\b(izin\s+belajar|study\s+permit)\b/i.test(normalizedText)) {
      queryVariants.push('persyaratan pengajuan jenis visa e30b vitas visa masuk dokumen apa saja yang dibutuhkan untuk visa pelajar mahasiswa asing');
      queryVariants.push('persyaratan pengajuan visa bagi mahasiswa asing izin belajar kitas itas e30b');
    }
    if (/\b(itas|kitas|sktt)\b/i.test(normalizedText)) {
      queryVariants.push('visa mahasiswa asing izin belajar penjamin sponsor penjaminan ITAS SKTT');
    }
  }

  // International Program & Student Exchange query variants
  if (domain === 'INTERNATIONAL' || (aspects && (aspects.includes('international') || aspects.includes('student_exchange')))) {
    queryVariants.push('apa itu student exchange di ITB STIKOM Bali alur dan syarat');
    queryVariants.push('syarat mengikuti program student exchange pertukaran mahasiswa pelajar internasional');
    queryVariants.push('program internasional pertukaran mahasiswa student exchange kampus mitra luar negeri');
  }

  // Thesis Requirements & Guidance Procedure query variants (e.g. Q056, Q058)
  if (intent === 'THESIS_REQUIREMENTS' || intent === 'THESIS_GUIDANCE_PROCEDURE' || (aspects && (aspects.includes('pedoman_ta') || aspects.includes('thesis_requirements') || aspects.includes('guidance_procedure') || aspects.includes('thesis_stages')))) {
    queryVariants.push('persyaratan akademik mengajukan tugas akhir pedoman ta jenjang s1');
    queryVariants.push('buku pedoman tugas akhir persyaratan pendaftaran skripsi ipk minimal seminar terbuka transkrip nilai akademik sementara');
    queryVariants.push('tahapan pelaksanaan bimbingan tugas akhir skripsi pedoman ta dosen pembimbing pengerjaan skripsi');
    queryVariants.push('buku pedoman tugas akhir pembimbingan tahapan pelaksanaan bimbingan ta');
    queryVariants.push('prosedur bimbingan tugas akhir dosen pembimbing utama pendamping');
  }

  // PMB Inquiry & Procedure query variants
  if (domain === 'PMB' || intent === 'GENERAL_PMB_INQUIRY' || intent === 'ADMISSION_PROCEDURE') {
    if (targetEntities.length > 0) {
      for (const ent of targetEntities) {
        queryVariants.push(`syarat pendaftaran dan prosedur alur ${ent}`);
        queryVariants.push(`persyaratan pendaftaran masuk ${ent}`);
      }
    }
    queryVariants.push('informasi pendaftaran mahasiswa baru PMB jalur reguler kelas karyawan');
    queryVariants.push('syarat pendaftaran dan prosedur alur PMB STIKOM Bali');
    queryVariants.push('alur pendaftaran mahasiswa baru pmb.stikom-bali.ac.id');
  }

  // Academic Curriculum query variants (guarded: do not inject curriculum keywords into accreditation or thesis guidance queries)
  if (((domain === 'ACADEMIC_CURRICULUM' && (!aspects || !aspects.includes('accreditation')) && intent !== 'THESIS_GUIDANCE_PROCEDURE') || intent === 'CURRICULUM_INQUIRY' || (aspects && (aspects.includes('curriculum') || aspects.includes('courses')))) && (!aspects || !aspects.includes('accreditation') || aspects.includes('curriculum')) && intent !== 'THESIS_GUIDANCE_PROCEDURE') {
    if (targetEntities.length > 0) {
      for (const ent of targetEntities) {
        queryVariants.push(`kurikulum 2025 program studi ${ent} mata kuliah sks semester`);
        queryVariants.push(`sebaran mata kuliah kurikulum ${ent}`);
        queryVariants.push(`${ent} Semester I II III IV V VI VII VIII SKS`);
        queryVariants.push(`${ent} mata kuliah semester SKS kompetensi keahlian`);
        queryVariants.push(`materi mata kuliah yang dipelajari program studi ${ent}`);
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
  if (intent === 'PROGRAM_OVERVIEW' || intent === 'DEFINITION' || intent === 'PROGRAM_COMPARISON' || (aspects && aspects.includes('overview')) || domain === 'ACADEMIC_PROGRAM') {
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
    if (/\b(?:luar\s*negeri|jepang|internasional)\b/i.test(normalizedText)) {
      queryVariants.push('kuliah sambil kerja di luar negeri fasilitas stikom');
    }
  }

  // Degree Award query variants
  if (intent === 'DEGREE_AWARD' || (aspects && (aspects.includes('degree_award') || aspects.includes('duration') || aspects.includes('study_period')))) {
    if (targetEntities.length > 0) {
      for (const ent of targetEntities) {
        queryVariants.push(`gelar lulusan ${ent} sarjana komputer magister diploma`);
        queryVariants.push(`masa studi durasi kuliah ${ent} semester lulusan`);
        queryVariants.push(`apa gelar lulusannya berapa lama masa studi ${ent}`);
      }
    } else {
      queryVariants.push('gelar lulusan sarjana komputer magister diploma ITB STIKOM Bali');
      queryVariants.push('masa studi durasi kuliah semester lulus');
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

  // Location / Campus query variants
  if (intent === 'CAMPUS_LOCATION' || intent === 'STUDY_LOCATION' || (aspects && (aspects.includes('location') || aspects.includes('study_location')))) {
    if (targetEntities.length > 0) {
      for (const ent of targetEntities) {
        queryVariants.push(`lokasi kampus tempat kuliah ${ent}`);
        queryVariants.push(`alamat kampus tempat studi ${ent}`);
      }
    } else {
      queryVariants.push('lokasi kampus tempat kuliah alamat');
    }
  }

  // Program Curriculum query variants
  if ((intent === 'CURRICULUM_INQUIRY' || domain === 'ACADEMIC_CURRICULUM') && (!aspects || !aspects.includes('accreditation') || aspects.includes('curriculum'))) {
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
  const fallbackQuery = String(normalizedQuery || semanticFrame.rawQuery || '').trim();
  if (fallbackQuery && !queryVariants.includes(fallbackQuery)) queryVariants.push(fallbackQuery);


  return {
    domain,
    intent,
    academicLevel: semanticFrame.academicLevel || null,
    retrievalRequired: semanticFrame.retrievalRequired !== false,
    participantScope: semanticFrame.participantScope || (/\b(mahasiswa\s+asing|visa|itas|kitas|izin\s+belajar)\b/i.test(normalizedText) ? 'foreign' : 'domestic'),
    targetEntities,
    excludedConflictingEntities,
    requiredAspects: aspects || [],
    temporalConstraint: temporal ? temporal.constraint : 'GENERAL',
    queryVariants,
    unsupportedEntity: Boolean(semanticFrame.unsupportedEntity || semanticFrame.isUnsupportedEntity),
    unsupportedEntityName: semanticFrame.unsupportedEntityName || semanticFrame.unsupportedProgramName || null,
    entityResolutionStatus: semanticFrame.entityResolutionStatus || (targetEntities.length ? 'RESOLVED' : 'UNRESOLVED'),
    isUnsupportedEntity: Boolean(semanticFrame.unsupportedEntity || semanticFrame.isUnsupportedEntity),
    unsupportedProgramName: semanticFrame.unsupportedEntityName || semanticFrame.unsupportedProgramName || null,
    retrievalContract
  };
}

module.exports = {
  buildRetrievalPlan,
  buildRetrievalContract
};
