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
const {
  ACADEMIC_SCOPE_STATUS,
  normalizeAcademicScope,
  resolveAcademicScope
} = require('./academicCatalog');

function buildRetrievalPlan(semanticFrame, options = {}) {
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
  let targetEntities = contractTargets.length > 0
    ? contractTargets
    : (entities || []).map(e => e.canonical || e.name || String(e));

  const hasSpecificDD = targetEntities.some(e => /Double Degree (?:DNUI|HELP)|Dual Degree UTB/i.test(e));
  if (hasSpecificDD) {
    targetEntities = targetEntities.filter(e => !/^(?:Double|Dual) Degree$/i.test(e.trim()));
  }
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
      queryVariants.push('rincian biaya pendidikan kuliah DPP SPP per semester program studi S1 D3 S2 ITB STIKOM Bali');
      queryVariants.push('biaya pendidikan per semester Sistem Informasi Teknologi Informasi Bisnis Digital Sistem Komputer Manajemen Informatika');
      queryVariants.push('perbandingan biaya per semester semua program studi S1 D3 S2');
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
  if (domain === 'ORGANIZATION_UKM' || (aspects && (aspects.includes('organization') || aspects.includes('student_organization') || aspects.includes('ukm') || aspects.includes('sports') || aspects.includes('arts_culture')))) {
    if (targetEntities.length > 0) {
      for (const ent of targetEntities) {
        queryVariants.push(`organisasi kemahasiswaan himaprodi himpunan mahasiswa ${ent} cakra pragnya filosofi profil kegiatan`);
        queryVariants.push(`organisasi kemahasiswaan himaprodi himpunan mahasiswa ${ent}`);
        queryVariants.push(`profile ${ent} kegiatan visi misi`);
      }
    }
    if (/\b(seni|budaya|tari|musik|band|teater|paduan\s+suara|fotografi)\b/i.test(normalizedText)) {
      queryVariants.push('unit kegiatan mahasiswa UKM seni tari pragina musik teater biner paduan suara vos himatography');
      queryVariants.push('SK PEMBINA ORMAWA UKM seni budaya tari musik teater biner vos himatography');
    }
    if (/\b(olahraga|olah\s*raga|futsal|basket|bulutangkis|badminton|fitness|gym)\b/i.test(normalizedText)) {
      queryVariants.push('unit kegiatan mahasiswa UKM olahraga futsal basket bulutangkis badminton bos boss kebugaran ghost');
      queryVariants.push('SK PEMBINA ORMAWA UKM olahraga futsal basket bos boss ghost');
    }
    queryVariants.push('unit kegiatan mahasiswa UKM ormawa ITB STIKOM Bali');
    queryVariants.push('daftar organisasi kemahasiswaan himaprodi SK PEMBINA ORMAWA');
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
  const isAcademicOrSionContact = domain === 'CAMPUS_SERVICE' ||
    intent === 'ACADEMIC_SUPPORT_INQUIRY' ||
    (aspects && aspects.some(a => ['academic_support', 'sion', 'helpdesk'].includes(a))) ||
    /\b(?:sion|pascasarjana|akademik|dosen\s*wali|perwalian)\b/i.test(normalizedText);

  if (!isAcademicOrSionContact && (intent === 'PMB_CONTACT_INQUIRY' || (aspects && aspects.includes('contact')))) {
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

  // International Program & Student Exchange / Double Degree query variants
  const isDDQuery = /\b(double\s*degree|dual\s*degree|dua\s*gelar|gelar\s*ganda)\b/i.test(normalizedText) ||
    targetEntities.some(e => /double\s*degree|dual\s*degree/i.test(e)) ||
    (typeof semanticFrame.contextDependencies?.[0]?.inheritedEntity === 'string' && /double\s*degree|dual\s*degree/i.test(semanticFrame.contextDependencies[0].inheritedEntity)) ||
    (options?.sessionData && (options.sessionData.activeEntity === 'Double Degree' || options.sessionData.activeEntity === 'Dual Degree UTB')) ||
    (options?.sessionData?.lastQuery && /\b(double\s*degree|dual\s*degree)\b/i.test(options.sessionData.lastQuery));

  if (domain === 'INTERNATIONAL' || (aspects && (aspects.includes('international') || aspects.includes('student_exchange') || aspects.includes('double_degree') || aspects.includes('national_program'))) || isDDQuery) {
    if (isDDQuery) {
      queryVariants.push('program double degree ITB STIKOM Bali HELP University Malaysia Dalian Neusoft DNUI');
      queryVariants.push('program double degree dual degree nasional internasional mitra kurikulum syarat gelar');
      queryVariants.push('program dual degree dua gelar gelar ganda ITB STIKOM Bali');
      if ((aspects && aspects.includes('national_program')) || /\b(?:nasional|national)\b/i.test(normalizedText)) {
        queryVariants.push('dual degree national class program kerjasama nasional ITB STIKOM Bali');
        queryVariants.push('universitas teknologi bandung UTB gelar ganda nasional kerjasama');
      }
    } else {
      queryVariants.push('apa itu student exchange di ITB STIKOM Bali alur dan syarat');
      queryVariants.push('syarat mengikuti program student exchange pertukaran mahasiswa pelajar internasional');
      queryVariants.push('program internasional pertukaran mahasiswa student exchange kampus mitra luar negeri');
    }
  }

  // Thesis Requirements & Guidance Procedure query variants (e.g. Q056, Q058)
  if (intent === 'THESIS_REQUIREMENTS' || intent === 'THESIS_GUIDANCE_PROCEDURE' || (aspects && (aspects.includes('pedoman_ta') || aspects.includes('thesis_requirements') || aspects.includes('guidance_procedure') || aspects.includes('thesis_stages')))) {
    queryVariants.push('persyaratan akademik mengajukan tugas akhir pedoman ta jenjang s1');
    queryVariants.push('buku pedoman tugas akhir persyaratan pendaftaran skripsi ipk minimal seminar terbuka transkrip nilai akademik sementara');
    queryVariants.push('tahapan pelaksanaan bimbingan tugas akhir skripsi pedoman ta dosen pembimbing pengerjaan skripsi');
    queryVariants.push('buku pedoman tugas akhir pembimbingan tahapan pelaksanaan bimbingan ta');
    queryVariants.push('prosedur bimbingan tugas akhir dosen pembimbing utama pendamping');
  }

  // Academic Advising & Perwalian / E-KRS query variants
  if (domain === 'ACADEMIC_PROCESS' || intent === 'ACADEMIC_ADVISING_INQUIRY' || (aspects && (aspects.includes('academic_advising') || aspects.includes('dosen_wali') || aspects.includes('krs'))) || /\b(?:perwalian|dosen\s+wali|e-krs|alur\s+krs|penyusunan\s+krs)\b/i.test(normalizedText)) {
    queryVariants.push('perwalian online e-krs jadwal konsultasi dosen wali alur penyusunan krs');
    queryVariants.push('prosedur perwalian mahasiswa wajib e-krs stikom bali');
    queryVariants.push('konsultasi dosen wali pemilihan jadwal mata kuliah perwalian e-krs');
    queryVariants.push('keterlambatan perwalian terlambat jadwal tim support perwalian');
    queryVariants.push('kontak bantuan tim support perwalian supportperwalian microsoft teams kendala keterlambatan');
    queryVariants.push('beban sks semester syarat pembayaran perwalian polling e-krs');
  }

  // RPL / Prior Learning Recognition query variants
  if (intent === 'RPL_INQUIRY' || intent === 'RPL_PROCEDURE' || intent === 'RPL_DURATION' || domain === 'ADMISSION_TRACK' || (aspects && (aspects.includes('rpl') || aspects.includes('credit_transfer'))) || /\brpl\b/i.test(normalizedText)) {
    queryVariants.push('PEDOMAN PENYELENGGARAAN REKOGNISI PEMBELAJARAN LAMPAU RPL TIPE A ITB STIKOM BALI');
    queryVariants.push('Untuk mahasiswa program Rekognisi Pembelajaran Lampau RPL Dana Pendidikan Pokok DPP');
    queryVariants.push('pendaftaran mahasiswa jalur RPL rekognisi pembelajaran lampau transfer sks konversi pengakuan');
    queryVariants.push('ketentuan transfer sks D3 D2 D1 pengakuan sks lama kuliah jalur RPL S1');
  }

  // Operational Hours query variants
  if (intent === 'OPERATIONAL_HOURS_INQUIRY' || (aspects && aspects.includes('operational_hours')) || /\b(?:jam|waktu)\s+(?:operasional|layanan|kerja|buka)\b/i.test(normalizedText)) {
    queryVariants.push('jam operasional pelayanan pendaftaran mahasiswa baru PMB kampus Renon Denpasar waktu buka');
    queryVariants.push('jam operasional kantor layanan administrasi akademik ITB STIKOM Bali');
  }

  // Online Learning Platform query variants
  if (intent === 'ONLINE_LEARNING_PLATFORM' || (aspects && aspects.includes('online_learning')) || /\b(?:kuliah|perkuliahan)\s+(?:online|daring)\b/i.test(normalizedText)) {
    queryVariants.push('perkuliahan online daring aplikasi Microsoft Teams Zoom LMS ITB STIKOM Bali');
    queryVariants.push('aplikasi yang digunakan untuk perkuliahan online daring link kelas');
  }

  // S2 Research Focus query variants
  if (intent === 'RESEARCH_FOCUS_INQUIRY' || (aspects && aspects.includes('research_focus')) || /\b(?:fokus\s+riset|data\s+science|cyber\s+security|enterprise\s+system|medical\s+informatics)\b/i.test(normalizedText)) {
    queryVariants.push('fokus riset Magister Sistem Informasi Data Science Cyber Security Enterprise System Medical Informatics');
    queryVariants.push('bidang peminatan riset tesis program studi S2 Magister Sistem Informasi');
  }

  // SION & Academic Support query variants
  if (intent === 'ACADEMIC_SUPPORT_INQUIRY' || (aspects && aspects.some(a => ['academic_support', 'sion', 'helpdesk'].includes(a))) || isAcademicOrSionContact) {
    if (/\b(?:pascasarjana|magister|s2)\b/i.test(normalizedText)) {
      queryVariants.push('kontak layanan akademik Pascasarjana hotline telepon 082277389999 244445 ITB STIKOM Bali');
      queryVariants.push('hotline Pascasarjana sekretariat Magister Sistem Informasi Puputan Renon');
    } else {
      queryVariants.push('kendala SION kontak bantuan BAAK DTI Puskom reset password');
      queryVariants.push('kontak layanan bantuan akademik BAAK ITB STIKOM Bali');
    }
  }

  // Specific Learning Topics (SEO, Digital Marketing) query variants
  if (/\b(?:seo|search\s+engine\s+optim|digital\s+marketing|pemasaran\s+digital)\b/i.test(normalizedText)) {
    queryVariants.push('kurikulum mata kuliah Bisnis Digital pemasaran digital SEO specialist media sosial');
    queryVariants.push('profil lulusan S1 Bisnis Digital SEO Specialist Digital Marketing');
  }

  // Campus Location & Addresses query variants
  if ((aspects && (aspects.includes('location') || aspects.includes('campus_location'))) || /\b(lokasi\s+kampus|alamat\s+kampus|kampus.*(?:dimana|di mana)|gedung\s+kampus)\b/i.test(normalizedText)) {
    queryVariants.push('lokasi kampus ITB STIKOM Bali Renon Denpasar Jimbaran Badung Abiansemal');
    queryVariants.push('alamat kampus ITB STIKOM Bali Jl Raya Puputan Renon');
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
    const academicScope = semanticFrame.academicScope || resolveAcademicScope(semanticFrame);
    if (academicScope.status === ACADEMIC_SCOPE_STATUS.SUPPORTED) {
      if (academicScope.level === 'S1') {
        queryVariants.push('program sarjana S1 Sistem Informasi Sistem Komputer Teknologi Informasi Bisnis Digital');
        queryVariants.push('daftar pilihan program studi sarjana S1 ITB STIKOM Bali');
      } else if (academicScope.level === 'D3') {
        queryVariants.push('program diploma D3 Manajemen Informatika ITB STIKOM Bali');
        queryVariants.push('daftar program studi vokasi D3 Manajemen Informatika');
      } else if (academicScope.level === 'S2') {
        queryVariants.push('program pascasarjana S2 Magister Sistem Informasi M.Kom ITB STIKOM Bali');
        queryVariants.push('program studi S2 Magister Sistem Informasi');
      } else {
        queryVariants.push('program studi sarjana diploma magister ITB STIKOM Bali');
        queryVariants.push('pilihan jurusan program studi S1 D3 S2 ITB STIKOM Bali');
        queryVariants.push('program sarjana S1 Sistem Informasi Sistem Komputer Teknologi Informasi Bisnis Digital');
      }
    } else if (academicScope.status === ACADEMIC_SCOPE_STATUS.UNSUPPORTED) {
      // UNSUPPORTED scope must NEVER broaden to ALL or inject offered degree variants
      const rawMention = academicScope.rawMention ? academicScope.rawMention.toUpperCase() : 'PROGRAM';
      queryVariants.push(`program studi jenjang ${rawMention} ITB STIKOM Bali`);
    } else {
      // UNSPECIFIED: general institutional catalog queries allowed
      queryVariants.push('program studi sarjana diploma magister ITB STIKOM Bali');
      queryVariants.push('pilihan jurusan program studi S1 D3 S2 ITB STIKOM Bali');
      queryVariants.push('program sarjana S1 Sistem Informasi Sistem Komputer Teknologi Informasi Bisnis Digital');
    }
  }

  // Program Overview / Definition query variants
  if (intent === 'PROGRAM_OVERVIEW' || intent === 'DEFINITION' || intent === 'PROGRAM_COMPARISON' || (aspects && aspects.includes('overview')) || domain === 'ACADEMIC_PROGRAM') {
    if (targetEntities.length > 0) {
      for (const ent of targetEntities) {
        if ((aspects && (aspects.includes('career_prospects') || aspects.includes('career'))) || intent === 'CAREER_PROSPECTS' || intent === 'CAREER_PROSPECTS_INQUIRY') {
          queryVariants.push(`penjelasan prodi dan karier masa depan ${ent} yang dipelajari peluang kerja`);
        } else {
          queryVariants.push(`penjelasan program studi ${ent} fokus kurikulum profil`);
        }
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

  // Organization & UKM query variants (Prioritas 5)
  if (domain === 'ORGANIZATION_UKM' || intent === 'ORGANIZATION_INQUIRY' || (aspects && (aspects.includes('student_organization') || aspects.includes('ukm') || aspects.includes('arts_culture')))) {
    if ((aspects && aspects.includes('arts_culture')) || /\b(?:kesenian|seni|budaya|tari|musik|teater|paduan\s+suara|tabuh|gamelan)\b/i.test(normalizedText)) {
      queryVariants.push('Unit Kegiatan Mahasiswa UKM kesenian seni tari tradisional pragina teater biner musik voice of stikom vos tabuh bramara gita ITB STIKOM Bali');
      queryVariants.push('daftar UKM kesenian seni tari teater musik paduan suara karawitan tabuh ITB STIKOM Bali');
      queryVariants.push('profil UKM Tari Pragina UKM Musik UKM Teater Biner UKM Voice of STIKOM VOS UKM Tabuh Bramara Gita');
    } else if ((aspects && aspects.includes('sports')) || /\b(?:olahraga|sports?|futsal|basket|badminton)\b/i.test(normalizedText)) {
      queryVariants.push('Unit Kegiatan Mahasiswa UKM olahraga futsal basket badminton bulutangkis taekwondo karate ITB STIKOM Bali');
    } else {
      queryVariants.push('daftar Unit Kegiatan Mahasiswa UKM ormawa organisasi kemahasiswaan ITB STIKOM Bali');
    }
  }

  if (targetEntities.length > 0) {
    const combined = `${targetEntities.join(' ')} ${cleanKeywords}`.trim();
    if (!queryVariants.includes(combined)) queryVariants.push(combined);
  }
  if (cleanKeywords && !queryVariants.includes(cleanKeywords)) queryVariants.push(cleanKeywords);
  const fallbackQuery = String(normalizedQuery || semanticFrame.rawQuery || '').trim();
  if (fallbackQuery && !queryVariants.includes(fallbackQuery)) queryVariants.push(fallbackQuery);


  const resolvedScope = semanticFrame.academicScope || resolveAcademicScope(semanticFrame);

  return {
    domain,
    intent,
    academicLevel: semanticFrame.academicLevel || null,
    academicScope: resolvedScope,
    scopeLevel: semanticFrame.scopeLevel || resolvedScope.level || (resolvedScope.status === ACADEMIC_SCOPE_STATUS.UNSUPPORTED ? 'UNSUPPORTED' : null),
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
