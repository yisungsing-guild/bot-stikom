'use strict';

const { hasEntity } = require('./semanticContract');
const { matchCanonicalEntities, findCanonicalEntity, areEntitiesEquivalent } = require('./canonicalEntityRegistry');

// Planning constraints, not answerability. A candidate must survive domain and
// entity compatibility before lexical or embedding similarity can affect rank.
const FAMILY_SIGNALS = {
  fee: /biaya|pembayaran|keuangan|tuition|fee[_\s-]*catalog|tarif|ukt|dpp|cicilan|angsuran/i,
  scholarship: /beasiswa|scholarship|kip\s*kuliah|skss|1k1s|bantuan\s+biaya|prestasi|yayasan/i,
  double_degree: /double\s*degree|dual\s*degree|gelar\s+ganda|international[_\s-]*partnership|dnui|help\s+university|universitas\s+teknologi\s+bandung/i,
  international_program: /student\s*exchange|gccp|bccp|pertukaran\s+mahasiswa|program\s+internasional|international[_\s-]*program/i,
  academic: /akademik|academic|pedoman.*(?:ta|skripsi)|kurikulum|sks|mata\s+kuliah/i,
  academic_policy: /akademik|academic|pedoman.*(?:ta|skripsi)|kurikulum|sks|mata\s+kuliah/i,
  student_organization: /ukm|ormawa|hima|himaprodi|organisasi\s+mahasiswa|student[_\s-]*affairs|bem|dpm/i,
  campus_facility: /fasilitas|sarana|prasarana|lab|laboratorium|perpustakaan|gedung|ruang|kantin|asrama|parkir|studio|coworking/i,
  campus_service: /inbis|inkubator|career\s*center|pusat\s+karier|cdc|llc|layanan/i,
  career: /karir|karier|career|cdc|alumni|kerja|magang|loker|prospek/i,
  program: /program\s+studi|prodi|jurusan|kurikulum|profil\s+lulusan|s1|d3|s2/i,
  program_curriculum: /kurikulum|mata\s+kuliah|matakuliah|sks|silabus|materi\s+belajar/i,
  program_advice: /program\s+studi|prodi|jurusan|rekomendasi|cocok|minat/i,
  program_recommendation: /program\s+studi|prodi|jurusan|rekomendasi|cocok|minat/i,
  accreditation: /akreditasi|ban-?pt|peringkat|unggul|baik\s+sekali/i,
  rpl: /rpl|rekognisi|pembelajaran\s+lampau|alih\s+jenjang/i,
  visa_study: /visa|itas|kitas|sktt|izin\s+belajar|study\s+permit/i,
  registration: /pmb|daftar|pendaftaran|registrasi|gelombang|syarat|biaya\s+pendaftaran/i
};

const FIELD_SIGNALS = {
  amount: /rp\.?|rupiah|nominal|persen|%|\d{1,3}(?:\.\d{3})+/i,
  registrationFee: /biaya\s+pendaftaran|uang\s+pendaftaran/i,
  tuitionFee: /ukt|uang\s+kuliah|biaya\s+(?:kuliah|semester)|per\s+semester/i,
  developmentFee: /dpp|dana\s+(?:pengembangan|pendidikan)|uang\s+gedung/i,
  discount: /diskon|potongan|persen|%/i,
  installmentSchedule: /cicil|angsuran|bertahap|tahap\s+pembayaran/i,
  installmentRequirements: /syarat|persyaratan|permohonan|pengajuan|dokumen|berkas/i,
  degreeOutcome: /gelar|ijazah|bachelor|s\.kom|s\.bns|sarjana/i,
  degree: /gelar|ijazah|bachelor|s\.kom|s\.bns|sarjana/i,
  duration: /durasi|lama|tahun|bulan|minggu|semester/i,
  sequence: /tahun\s+(?:ke-?\s*)?\d|tahap|skema|urutan|semester|s\.d\.?\s+uts/i,
  studyLocation: /kampus|lokasi|bali|malaysia|china|tiongkok|indonesia|luar\s+negeri/i,
  deliveryMode: /online|offline|daring|luring|tatap\s+muka/i,
  languageRequirement: /(?:syarat|persyaratan|prasyarat|harus|wajib|perlu|minimal|kemampuan|level).*?(?:bahasa|mandarin|inggris|jepang|toefl|ielts|hsk|jlpt)|(?:bahasa|mandarin|inggris|jepang|toefl|ielts|hsk|jlpt).*?(?:syarat|persyaratan|prasyarat|harus|wajib|perlu|minimal|kemampuan|level)/i,
  languageLevel: /bahasa|mandarin|inggris|jepang|toefl|ielts|hsk|jlpt|level/i,
  requirements: /syarat|persyaratan|dokumen|berkas|ketentuan|kriteria/i,
  procedureSteps: /cara|alur|prosedur|langkah|tahap|mekanisme/i,
  careerProspects: /prospek|karir|karier|peluang\s+kerja|lulusan|profesi/i,
  facilityList: /fasilitas|sarana|prasarana|lab|perpustakaan/i,
  profile: /profil|tentang|deskripsi|pengertian|definisi|fasilitas|tersedia/i,
  availability: /tersedia|ada|memiliki|mencakup|memberikan/i,
  scholarship: /beasiswa|kip|1k1s|skss|prestasi|yayasan/i,
  scholarshipAvailability: /tersedia|menerima|mencakup|beasiswa|kip/i,
  scholarshipList: /beasiswa|kip|1k1s|skss|prestasi|yayasan/i,
  organizationList: /ukm|ormawa|organisasi|himpunan|bem|dpm/i,
  curriculum: /kurikulum|mata\s+kuliah|matakuliah|sks/i,
  curriculumFocus: /kurikulum|fokus|materi|mata\s+kuliah|topik/i,
  curriculumTopicPresence: /kurikulum|materi|mata\s+kuliah|topik|artificial\s+intelligence|kecerdasan\s+buatan|hardware|software|jaringan|iot|embedded/i,
  specificTopic: /topik|materi|mata\s+kuliah|artificial\s+intelligence|kecerdasan\s+buatan|hardware|software|jaringan|iot|embedded/i,
  date: /tanggal|jadwal|periode|gelombang|deadline/i,
  schedule: /tanggal|jadwal|periode|gelombang|tahap|angsuran/i,
  location: /alamat|lokasi|kampus|renon|jimbaran|abiansemal/i,
  partner: /mitra|partner|kerjasama|kerja\s*sama|help\s+university|dnui|universitas\s+teknologi\s+bandung|utb/i,
  programScope: /nasional|internasional|dalam\s+negeri|luar\s+negeri|malaysia|china|tiongkok|indonesia|bandung/i
};

const RELATION_SIGNALS = {
  study_timeline: /durasi|masa\s+studi|tahun|semester|perkuliahan|online|offline|kampus/i,
  program_sequence: /\btahun\s+(?:ke-?\s*)?[1-4]|\bsemester\s+[1-8]|\bskema\s+(?:kuliah|studi|perkuliahan)|\btahap\s+\d|\burutan\b/i,
  language_prerequisite: /bahasa|mandarin|inggris|toefl|ielts|hsk|jlpt/i,
  double_degree_outcome: /gelar|sarjana|bachelor|s\.kom|s\.bns/i,
  installment_stages: /cicil|angsuran|tahap|per\s+bulan|s\.d\.?\s+uts/i,
  installment_requirements: /syarat|persyaratan|pengajuan|permohonan.*(?:cicil|angsur)|(?:cicil|angsur).*permohonan/i,
  wave_3_discount: /gelombang\s+(?:iii|3)|potongan|diskon|dpp/i,
  partner_countries: /malaysia|china|tiongkok|indonesia|negara|luar\s+negeri|partner|mitra/i,
  living_allowance: /biaya\s+hidup|uang\s+saku|living\s+allowance|bulanan/i,
  ai_curriculum_topics: /artificial\s+intelligence|kecerdasan\s+buatan|machine\s+learning|intelligent\s+system/i,
  computer_labs: /laboratorium\s+komputer|lab\s+komputer|praktikum|komputer/i,
  parking_facilities: /parkir|kendaraan|motor|mobil/i,
  leave_permission: /cuti|izin|tidak\s+aktif|akademik/i,
  max_leave_semesters: /cuti|semester|maksimal|lama/i,
  leave_requirements: /cuti|syarat|permohonan|pengajuan|baak/i,
  leave_fee_policy: /cuti|biaya|ukt|bayar/i,
  sks_limit_per_gpa: /ipk|sks|beban|maksimal|semester/i,
  package_credit_system: /paket|sks|semester|kurikulum/i,
  first_semester_credits: /sks|semester\s+1|paket/i,
  remedial_sp_policy: /remedial|remidi|semester\s+pendek|sp|perbaikan|nilai/i,
  career_prospects: /prospek|karier|karir|peluang\s+kerja|lulusan|profesi|software|developer/i,
  shuttle_bus: /bus|shuttle|antar\s+jemput|transportasi|kendaraan/i,
  studio_multimedia: /studio(?:\s+podcast)?|podcast|rekaman|ruang\s+multimedia|ruang\s+produksi\s+audio|audio\s+production/i,
  studio_access_policy: /izin(?:\s+penggunaan)?\s+studio|pakai\s+studio|akses\s+studio/i,
  coworking_space: /coworking(?:\s+space)?|ruang\s+kerja\s+bersama|ruang\s+kerja\s+kolaboratif/i,
  digital_library: /perpustakaan\s+digital|buku\s+digital|e-book|akses\s+digital/i,
  va_options: /virtual\s+account|va|bca|bni|mandiri|bri|bank|transfer/i,
  prestasi_discount: /prestasi|potongan|diskon|dpp|beasiswa/i,
  prodi_comparison: /beda|perbedaan|banding|komparasi|sistem\s+informasi|teknologi\s+informasi/i
};

const RELATION_QUERY_TERMS = {
  study_timeline: 'durasi masa studi pembagian tahun semester lokasi perkuliahan online offline',
  language_prerequisite: 'syarat persyaratan kemampuan bahasa minimum TOEFL IELTS HSK',
  double_degree_outcome: 'gelar lulusan sarjana bachelor ijazah',
  installment_stages: 'skema cicilan angsuran tahap pembayaran per bulan',
  installment_requirements: 'syarat pengajuan permohonan cicilan angsuran',
  wave_3_discount: 'potongan diskon DPP Gelombang III',
  partner_countries: 'kampus mitra partner negara Malaysia China Indonesia',
  living_allowance: 'KIP Kuliah bantuan biaya hidup uang saku bulanan',
  ai_curriculum_topics: 'kurikulum mata kuliah Artificial Intelligence kecerdasan buatan machine learning',
  computer_labs: 'fasilitas laboratorium komputer lab praktikum',
  parking_facilities: 'fasilitas area parkir kendaraan motor mobil',
  leave_permission: 'cuti kuliah akademik izin pengajuan',
  max_leave_semesters: 'maksimal cuti berapa semester',
  leave_requirements: 'syarat pengajuan cuti akademik',
  leave_fee_policy: 'biaya UKT selama cuti',
  sks_limit_per_gpa: 'minimal IPK batas SKS semester',
  package_credit_system: 'paket SKS semester 1 dan 2',
  first_semester_credits: 'SKS paket semester 1',
  remedial_sp_policy: 'ujian perbaikan remedial SP semester pendek',
  career_prospects: 'prospek kerja karier lulusan profesi',
  shuttle_bus: 'bus kampus antar jemput Renon Jimbaran',
  studio_multimedia: 'fasilitas studio multimedia editing podcast rekaman audio',
  studio_access_policy: 'izin penggunaan peminjaman studio multimedia podcast',
  coworking_space: 'fasilitas coworking space ruang kerja bersama inkubator startup',
  digital_library: 'perpustakaan digital koleksi buku e-learning jurnal',
  va_options: 'pembayaran pendaftaran virtual account bank',
  prestasi_discount: 'potongan DPP jalur prestasi',
  prodi_comparison: 'perbedaan komparasi prodi TI dan SI'
};

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function unique(values) {
  return Array.from(new Set((values || []).map(value => String(value || '').trim()).filter(Boolean)));
}

function entityFamily(entity) {
  const entry = findCanonicalEntity(entity && (entity.canonical || entity.name));
  if (entry && entry.family) return entry.family;
  return {
    programs: 'academic_program', program: 'academic_program',
    scholarships: 'scholarship', scholarship: 'scholarship',
    facilities: 'campus_facility', facility: 'campus_facility', campuses: 'campus', campus: 'campus',
    organizations: 'student_organization', ukm: 'student_organization',
    internationalPrograms: 'international_program', international_program: 'international_program', partner: 'international_program'
  }[entity && (entity.group || entity.type)] || null;
}

function usableEntitySpecs(contract) {
  return (contract.entities || []).filter(entity => {
    if (!entity) return false;
    if (typeof entity === 'string') return true;
    return entity.group !== 'unsupported' && entity.role !== 'unsupported_entity_candidate';
  });
}

function constraintTerms(constraints) {
  const terms = [];
  for (const [key, value] of Object.entries(constraints || {})) {
    if (!value) continue;
    if (typeof value === 'string' && value !== 'general') terms.push(value);
    if (key === 'registrationWave' && typeof value === 'object') {
      const wave = value.key || value.group;
      if (wave) terms.push(`Gelombang ${wave}`);
    }
    if ((key === 'curriculumTopic' || key === 'organizationCategory') && typeof value === 'object') {
      if (value.label || value.key) terms.push(value.label || String(value.key).replace(/_/g, ' '));
    }
  }
  return terms;
}

function buildResolvedRetrievalPlan(contract) {
  if (!contract || !contract.domain || !contract.intent) throw new Error('Resolved semantic contract required');
  const entitySpecs = usableEntitySpecs(contract);
  const entities = entitySpecs.map(entity => typeof entity === 'string' ? entity : entity.canonical).filter(Boolean);
  const requestedFields = unique(contract.requestedFields || []);
  const constraints = contract.constraints || {};
  const relations = unique(contract.relations || []);
  const queryParts = [
    entities.join(' '),
    relations.map(relation => RELATION_QUERY_TERMS[relation] || relation.replace(/_/g, ' ')).join(' '),
    requestedFields.map(field => field.replace(/([a-z])([A-Z])/g, '$1 $2')).join(' '),
    contract.domain && contract.domain !== 'general' ? contract.domain.replace(/_/g, ' ') : '',
    contract.intent ? contract.intent.replace(/_/g, ' ') : '',
    constraintTerms(constraints).join(' ')
  ];

  return {
    domain: contract.domain,
    intent: contract.intent,
    entities,
    entitySpecs,
    relations,
    requestedFields,
    constraints,
    query: unique(queryParts).join(' ').trim() || contract.raw || ''
  };
}

function evaluatePlannedCandidate(item, plan) {
  const identity = [
    item && item.filename, item && item.sourceFile, item && item.source,
    item && item.title, item && item.id,
    item && item.category, item && item.docCategory,
    item && item.metadata && item.metadata.category,
    item && item.metadata && item.metadata.family,
    item && item.metadata && item.metadata.topic
  ].filter(Boolean).join(' ');
  const body = String(item && (item.chunk || item.text || item.content) || '');
  const combined = `${identity} ${body}`;
  const familySignal = FAMILY_SIGNALS[plan && plan.domain];
  const domainMatch = familySignal ? familySignal.test(identity || body) : true;
  const knownIdentityDomains = Object.entries(FAMILY_SIGNALS).filter(([, re]) => re.test(identity)).map(([key]) => key);
  const domainCompatible = domainMatch || knownIdentityDomains.length === 0;

  const specs = (plan && plan.entitySpecs) || [];
  const entityMatches = specs.filter(spec => hasEntity(combined, typeof spec === 'string' ? { canonical: spec } : spec));
  const entityScore = specs.length ? entityMatches.length / specs.length : 1;
  const comparison = specs.length > 1 || (plan && plan.relations || []).some(relation => /comparison|contrast/.test(relation));
  const genericEntityTarget = specs.length === 1 && /^(?:double\s+degree|dual\s+degree|gelar\s+ganda|itb\s+stikom\s+bali|stikom\s+bali)$/i.test(String(typeof specs[0] === 'string' ? specs[0] : specs[0].canonical || '').trim());
  let competingEntity = null;
  if (!comparison && !genericEntityTarget && specs.length === 1) {
    const target = specs[0];
    const targetCanonical = typeof target === 'string' ? target : target.canonical;
    const family = entityFamily(typeof target === 'string' ? { canonical: target } : target);
    competingEntity = matchCanonicalEntities(combined).find(match => family && match.family === family && !areEntitiesEquivalent(match.canonical, targetCanonical)) || null;
  }

  const relations = (plan && plan.relations) || [];
  const relationHits = relations.filter(relation => {
    const sig = RELATION_SIGNALS[relation] || (relation ? new RegExp(`\\b(?:${String(relation).split(/[_\s-]+/).filter(w => w.length > 2).join('|')})\\b`, 'i') : null);
    return sig && sig.test(body);
  });
  const relationScore = relations.length ? relationHits.length / relations.length : 1;
  const requestedFields = (plan && plan.requestedFields) || [];
  const fieldHits = requestedFields.filter(field => {
    const sig = FIELD_SIGNALS[field] || (field ? new RegExp(`\\b(?:${String(field).replace(/([A-Z])/g, '_$1').toLowerCase().split(/[_\s-]+/).filter(w => w.length > 2).join('|')})\\b`, 'i') : null);
    return sig && sig.test(body);
  });
  const fieldScore = requestedFields.length ? fieldHits.length / requestedFields.length : 1;
  const originalScore = Math.max(0, Math.min(1, Number(item && (item.semanticScore || item.mmrScore || item.rrfScore || item.score) || 0)));
  const contractScore = entityScore * 0.56 + relationScore * 0.22 + fieldScore * 0.12 + (domainCompatible ? 0.07 : 0) + originalScore * 0.03;
  const constraints = (plan && plan.constraints) || {};
  let constraintMismatch = null;
  const targetScope = String(constraints.programScope || constraints.geographicScope || '').trim().toLowerCase();
  if (targetScope === 'national') {
    const isExplicitNational = /\b(?:nasional|dalam\s+negeri|indonesia|utb|universitas\s+teknologi\s+bandung)\b/i.test(combined);
    const isExplicitInternationalOnly = /\b(?:internasional|international|luar\s+negeri|malaysia|china|tiongkok|dnui|help\s+university)\b/i.test(combined);
    if (isExplicitInternationalOnly && !isExplicitNational) {
      constraintMismatch = 'constraint_scope_mismatch';
    }
  } else if (targetScope === 'international') {
    const isExplicitInternational = /\b(?:internasional|international|luar\s+negeri|malaysia|china|tiongkok|dnui|help\s+university)\b/i.test(combined);
    const isExplicitNationalOnly = /\b(?:nasional|dalam\s+negeri|utb|universitas\s+teknologi\s+bandung)\b/i.test(combined);
    if (isExplicitNationalOnly && !isExplicitInternational) {
      constraintMismatch = 'constraint_scope_mismatch';
    }
  }
  if (!constraintMismatch && constraints.unsupportedEntityCandidate) {
    constraintMismatch = 'unsupported_entity_constraint';
  }

  const missingTargetEntity = specs.length > 0 && !genericEntityTarget && entityScore === 0;
  const missingRelation = relations.length > 0 && relationScore === 0;
  const missingRequestedField = requestedFields.length > 0 && fieldScore === 0;
  const rejected = !domainCompatible || Boolean(competingEntity) || Boolean(constraintMismatch) || missingTargetEntity;

  return {
    compatible: !rejected,
    rejected,
    reason: !domainCompatible
      ? 'wrong_domain'
      : (competingEntity
        ? 'competing_same_family_entity'
        : (constraintMismatch
          ? constraintMismatch
          : (missingTargetEntity ? 'missing_target_entity' : (missingRelation ? 'missing_relation' : (missingRequestedField ? 'missing_requested_field' : 'compatible'))))),
    entityScore,
    relationScore,
    fieldScore,
    domainScore: domainCompatible ? 1 : 0,
    semanticScore: originalScore,
    contractScore,
    fieldHits,
    relationHits,
    competingEntity: competingEntity && competingEntity.canonical || null
  };
}

function rankPlannedCandidates(items, plan) {
  if (!plan) return items || [];
  const evaluated = (items || []).map((item, position) => ({ item, position, metrics: evaluatePlannedCandidate(item, plan) }));
  let compatible = evaluated.filter(candidate => candidate.metrics.compatible);
  if (!compatible.length && evaluated.length) {
    compatible = evaluated.filter(candidate => candidate.metrics.domainScore > 0 && !candidate.metrics.competingEntity);
  }
  if (!compatible.length && evaluated.length) {
    compatible = evaluated.slice();
  }
  compatible.sort((a, b) =>
    b.metrics.entityScore - a.metrics.entityScore
    || b.metrics.relationScore - a.metrics.relationScore
    || b.metrics.fieldScore - a.metrics.fieldScore
    || b.metrics.domainScore - a.metrics.domainScore
    || b.metrics.semanticScore - a.metrics.semanticScore
    || a.position - b.position
  );
  return compatible.map((candidate, rank) => {
    candidate.item.contractScore = Number(candidate.metrics.contractScore.toFixed(4));
    candidate.item.planRank = rank;
    candidate.item.planCompatibility = candidate.metrics;
    candidate.item.score = Math.max(Number(candidate.item.score || 0), candidate.metrics.contractScore);
    return candidate.item;
  });
}

module.exports = {
  FAMILY_SIGNALS,
  FIELD_SIGNALS,
  RELATION_SIGNALS,
  buildResolvedRetrievalPlan,
  evaluatePlannedCandidate,
  rankPlannedCandidates
};
