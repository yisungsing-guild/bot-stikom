'use strict';

/**
 * bindingRetrievalPlanner.js
 *
 * Controlled Binding Retrieval Planner.
 *
 * Operates strictly between the FROZEN EffectiveSemanticFrame (and resolved subrequest bundles)
 * and the bounded retrieval infrastructure.
 *
 * Core Invariants:
 * 1. DOWNSTREAM EXECUTION: Consumes immutable SemanticFrame / ResolvedRequestBundle; never
 *    reinterprets raw query, re-decomposes subrequests, or acts as a second semantic authority.
 * 2. STRUCTURED SEMANTIC BINDINGS: Retrieval operates from (scope/entity, requestedField, relation, constraints),
 *    never from a single flattened query string.
 * 3. NO BLIND CARTESIAN PRODUCT: Bindings follow explicit subrequest and entity-field ownership.
 * 4. SCOPE FLEXIBILITY: Supports EXPLICIT_ENTITY, INSTITUTION_ROOT, CURRENT_CONTEXT_SCOPE, and RELATION_SIDE.
 *    Does not fabricate artificial entities for entity-less queries (e.g. general contact, official Instagram, founding date).
 * 5. MULTI-ENTITY FAIRNESS: Each binding receives an independent bounded retrieval budget before global merge.
 *    Evidence for Entity A never starves Entity B.
 * 6. RELATION PRESERVATION: Subject and object sides of relations are preserved independently.
 * 7. FIELD SPECIFICITY: Preserves specific requested fields as PRIMARY hints (e.g. foundingDate > date, instagram > contact).
 * 8. EXPLICIT NEGATION AUTHORITY: Explicitly excluded/negated fields do NOT generate positive retrieval bindings.
 * 9. RETRIEVAL-WORTHINESS: Generic/synthetic helper slots are suppressed when covered by specific authoritative fields.
 * 10. BOUNDED RETRIEVAL ONLY: Reuses cached inverted lexical indices. No per-binding or per-request full scans.
 * 11. DETERMINISM: Pure, deterministic plan generation with stable binding identifiers.
 * 12. IMMUTABILITY: SemanticFrame is never mutated.
 */

const {
  getFieldDescriptor,
  normalizeEntityFamily
} = require('./semanticFrame');

const SCOPE_TYPES = Object.freeze({
  EXPLICIT_ENTITY: 'EXPLICIT_ENTITY',
  INSTITUTION_ROOT: 'INSTITUTION_ROOT',
  CURRENT_CONTEXT_SCOPE: 'CURRENT_CONTEXT_SCOPE',
  RELATION_SIDE: 'RELATION_SIDE'
});

const DEFAULT_CONFIG = Object.freeze({
  budgetPerBinding: 40,
  maxTotalCandidates: 120,
  enableTrainingDataLookup: true,
  enableRelationSideExpansion: true
});

/**
 * Known specific-field primary and secondary hint tokens.
 * Specific field tokens are authoritative (PRIMARY); broader category tokens are recall aids (SECONDARY).
 */
const FIELD_HINT_REGISTRY = Object.freeze({
  // Contact & Social Media
  instagram: {
    primary: ['instagram', 'ig'],
    secondary: ['sosmed', 'social media', 'media sosial', 'akun resmi']
  },
  tiktok: {
    primary: ['tiktok'],
    secondary: ['sosmed', 'social media', 'media sosial']
  },
  facebook: {
    primary: ['facebook', 'fb'],
    secondary: ['sosmed', 'social media']
  },
  youtube: {
    primary: ['youtube'],
    secondary: ['media sosial', 'video']
  },
  phone: {
    primary: ['telepon', 'nomor telepon', 'no telp', 'phone'],
    secondary: ['kontak', 'hubungi', 'narahubung']
  },
  whatsapp: {
    primary: ['whatsapp', 'wa', 'nomor wa'],
    secondary: ['chat', 'kontak', 'narahubung']
  },
  email: {
    primary: ['email', 'surel', 'e-mail'],
    secondary: ['kontak', 'surat']
  },
  contact: {
    primary: ['kontak', 'narahubung', 'call center', 'layanan informasi'],
    secondary: ['alamat', 'hubungi']
  },

  // Temporal & Duration
  duration: {
    primary: ['durasi', 'masa studi', 'lama studi', 'berapa tahun', 'berapa semester', 'jangka waktu'],
    secondary: ['semester', 'tahun', 'perkuliahan']
  },
  studyTimeline: {
    primary: ['timeline studi', 'tahapan kuliah', 'skema studi', 'pembagian semester'],
    secondary: ['jadwal kuliah', 'tahunan']
  },
  date: {
    primary: ['tanggal', 'kapan', 'waktu', 'jadwal'],
    secondary: ['periode', 'pendaftaran', 'pmb']
  },

  // Institutional History & Founding (Preserve Material Specificity)
  foundingDate: {
    primary: ['tahun berdiri', 'berdiri', 'berdirinya', 'didirikan', 'tanggal berdiri', 'hari jadi', 'pendirian yayasan', 'sejarah'],
    secondary: ['sejarah', 'profil', 'tentang', 'yayasan', 'pendiri']
  },
  legalDecreeDate: {
    primary: ['izin operasional', 'sk mendiknas', 'sk menteri', 'tanggal sk', 'resmi berdiri', 'tanggal resmi berdirinya', 'izin pendirian'],
    secondary: ['sk mendiknas', 'legalitas', 'izin operasional']
  },
  founderNames: {
    primary: ['pendiri', 'tokoh pendiri', 'siapa yang mendirikan', 'didirikan oleh', 'penggagas', 'perintis'],
    secondary: ['sejarah', 'profil', 'yayasan']
  },
  institutionHistory: {
    primary: ['sejarah', 'sejarah singkat', 'profil umum dan sejarah', 'awal mula', 'perkembangan'],
    secondary: ['profil', 'tentang', 'yayasan']
  },
  history: {
    primary: ['sejarah', 'awal mula', 'berdiri', 'didirikan'],
    secondary: ['profil', 'tentang']
  },

  // Financial & Fees
  tuitionFee: {
    primary: ['biaya kuliah', 'uang kuliah', 'spp', 'dpp', 'ukt', 'biaya semester'],
    secondary: ['tarif', 'nominal', 'pembayaran']
  },
  registrationFee: {
    primary: ['biaya pendaftaran', 'uang pendaftaran', 'biaya formulir'],
    secondary: ['pendaftaran', 'registrasi', 'bayar']
  },
  dpp: {
    primary: ['dpp', 'dana pengembangan pendidikan', 'uang gedung'],
    secondary: ['biaya awal', 'angsuran']
  },
  spp: {
    primary: ['spp', 'sumbangan pembinaan pendidikan', 'biaya per semester'],
    secondary: ['biaya rutin', 'angsuran']
  },
  fee: {
    primary: ['biaya', 'uang kuliah', 'spp', 'dpp', 'ukt', 'tarif'],
    secondary: ['pembayaran', 'nominal']
  },
  scholarship: {
    primary: ['beasiswa', 'kip', 'kip kuliah', 'potongan biaya', 'keringanan'],
    secondary: ['bantuan', 'syarat beasiswa']
  },

  // Academic & Quality
  accreditation: {
    primary: ['akreditasi', 'ban-pt', 'peringkat akreditasi', 'terakreditasi'],
    secondary: ['mutu', 'status']
  },
  certification: {
    primary: ['sertifikasi', 'sertifikat kompetensi', 'kompetensi'],
    secondary: ['keahlian', 'profesi']
  },
  competencyCertification: {
    primary: ['sertifikasi kompetensi', 'sertifikasi profesi', 'sertifikasi keahlian', 'bnsp', 'lsp'],
    secondary: ['sertifikasi', 'kompetensi', 'lulusan', 'keahlian']
  },
  vendorCertifications: {
    primary: ['sertifikasi internasional', 'vendor certification', 'mikrotik', 'cisco', 'oracle', 'redhat'],
    secondary: ['sertifikasi', 'kompetensi']
  },
  degree: {
    primary: ['gelar', 'lulusan', 'sebutan gelar', 'sarjana', 'magister', 'ahli madya'],
    secondary: ['kualifikasi', 'strata']
  },
  curriculum: {
    primary: ['kurikulum', 'mata kuliah', 'matkul', 'pembelajaran', 'sks'],
    secondary: ['rencana studi', 'akademik']
  },
  courseList: {
    primary: ['daftar mata kuliah', 'sebaran matkul', 'silabus'],
    secondary: ['kurikulum', 'akademik']
  },
  creditConversion: {
    primary: ['konversi sks', 'transfer sks', 'rpl', 'rekognisi pembelajaran lampau'],
    secondary: ['akademik', 'syarat']
  },

  // Admissions & Procedures
  requirements: {
    primary: ['syarat', 'persyaratan', 'berkas', 'dokumen pendaftaran', 'kriteria'],
    secondary: ['alur pendaftaran', 'ketentuan']
  },
  procedureSteps: {
    primary: ['cara daftar', 'alur pendaftaran', 'tahapan pendaftaran', 'prosedur'],
    secondary: ['langkah-langkah', 'pendaftaran']
  },
  schedule: {
    primary: ['jadwal', 'gelombang', 'periode pendaftaran', 'waktu pendaftaran', 'tanggal'],
    secondary: ['batas waktu', 'deadline']
  },
  registrationWave: {
    primary: ['gelombang', 'gelombang 1', 'gelombang 2', 'gelombang 3', 'jadwal gelombang'],
    secondary: ['periode', 'pmb']
  },

  // Career
  careerProspect: {
    primary: ['prospek kerja', 'peluang karir', 'profesi lulusan', 'lapangan kerja'],
    secondary: ['karir', 'pekerjaan']
  },
  jobRoles: {
    primary: ['posisi kerja', 'bidang kerja', 'role pekerjaan', 'profil lulusan'],
    secondary: ['karir', 'profesi']
  },

  // Organization
  organizationProfile: {
    primary: ['profil ukm', 'tentang', 'kegiatan', 'divisi', 'program kerja'],
    secondary: ['organisasi', 'komunitas']
  },
  organizationCategory: {
    primary: ['kategori ukm', 'jenis organisasi', 'bidang seni', 'bidang olahraga', 'bidang penalaran'],
    secondary: ['daftar ukm', 'ormawa']
  },
  organizationList: {
    primary: ['daftar ukm', 'list ukm', 'organisasi kemahasiswaan', 'ormawa apa saja'],
    secondary: ['ekskul', 'klub']
  },

  // Generic Profile / Definition
  profile: {
    primary: ['profil', 'visi', 'misi', 'tentang', 'sejarah', 'gambaran umum'],
    secondary: ['informasi', 'penjelasan']
  },
  description: {
    primary: ['apa itu', 'pengertian', 'definisi', 'penjelasan'],
    secondary: ['gambaran', 'tentang']
  },

  // Document Purpose & Governance
  documentPurpose: {
    primary: ['tujuan dokumen', 'maksud dokumen', 'fungsi dokumen', 'indikator kinerja', 'pelaporan kinerja', 'tujuan', 'maksud'],
    secondary: ['dokumen', 'tata kelola', 'lldikti', 'kinerja', 'formulir']
  },
  purpose: {
    primary: ['tujuan', 'maksud', 'fungsi', 'kegunaan', 'peruntukan'],
    secondary: ['tata kelola', 'profil', 'dokumen']
  },

  // Comparison & Contrast
  contrast: {
    primary: ['perbedaan', 'beda', 'perbandingan', 'apakah sama', 'setara', 'program', 'deskripsi'],
    secondary: ['program', 'karakteristik', 'keunggulan', 'profil']
  },

  // Administrative Document & Foreign Student
  sktt: {
    primary: ['sktt', 'surat keterangan tempat tinggal', 'syarat sktt', 'dokumen sktt'],
    secondary: ['disdukcapil', 'domisili', 'mahasiswa asing', 'izin tinggal', 'syarat']
  },

  // Geographic & Program Destination
  studyLocation: {
    primary: ['negara tujuan', 'negara mitra', 'tujuan negara', 'destinasi', 'ke negara mana', 'negara partner', 'negara pertukaran', 'negara'],
    secondary: ['pertukaran mahasiswa', 'student exchange', 'luar negeri', 'kampus mitra']
  },
  destinationCountry: {
    primary: ['negara tujuan', 'negara mitra', 'tujuan negara', 'destinasi', 'ke negara mana', 'negara partner', 'negara pertukaran', 'negara'],
    secondary: ['pertukaran mahasiswa', 'student exchange', 'luar negeri', 'kampus mitra']
  },
  country: {
    primary: ['negara tujuan', 'negara mitra', 'tujuan negara', 'destinasi', 'ke negara mana', 'negara partner', 'negara pertukaran', 'negara'],
    secondary: ['pertukaran mahasiswa', 'student exchange', 'luar negeri', 'kampus mitra']
  }
});

/**
 * Checks whether a candidate field matches explicit negative exclusions or negated domains.
 * Works generically for fee, schedule, contact/phone, program, scholarship, etc.
 *
 * @param {string} field
 * @param {string[]} exclusions
 * @param {object} constraints
 * @returns {boolean}
 */
function isFieldExcluded(field, exclusions = [], constraints = {}) {
  const normField = String(field || '').toLowerCase().trim();
  if (!normField) return false;
  const desc = getFieldDescriptor(normField);

  const excludedSet = new Set([
    ...(Array.isArray(exclusions) ? exclusions : []),
    ...(Array.isArray(constraints.excludedFields) ? constraints.excludedFields : []),
    ...(Array.isArray(constraints.exclude) ? constraints.exclude : []),
    ...(Array.isArray(constraints.excludedDomains) ? constraints.excludedDomains : [])
  ].map(x => String(x || '').toLowerCase().trim()).filter(Boolean));

  if (excludedSet.size === 0) return false;

  const DOMAIN_SYNONYMS = {
    fee: ['biaya', 'uang', 'spp', 'dpp', 'ukt', 'tarif', 'bayar', 'nominal', 'amount', 'fee', 'feecomponent', 'tuitionfee', 'registrationfee'],
    schedule: ['jadwal', 'gelombang', 'periode', 'waktu', 'deadline', 'tanggal', 'date', 'schedule', 'registrationwave'],
    contact: ['kontak', 'telepon', 'phone', 'wa', 'whatsapp', 'call', 'nomor', 'email', 'contact', 'contactnumber'],
    program: ['program', 'prodi', 'jurusan', 'studi'],
    scholarship: ['beasiswa', 'kip', 'bantuan', 'keringanan', 'scholarship', 'scholarshipavailability']
  };

  const fieldHints = FIELD_HINT_REGISTRY[normField];
  const allFieldHints = fieldHints
    ? [...(fieldHints.primary || []), ...(fieldHints.secondary || [])].map(h => h.toLowerCase())
    : [];

  for (const ex of excludedSet) {
    if (normField === ex) return true;
    if (desc.family && desc.family.toLowerCase() === ex) return true;
    if (desc.root && desc.root.toLowerCase() === ex) return true;

    // Check against field's retrieval hints (guarding against generic date matching foundingDate)
    if (allFieldHints.some(h => h === ex || (h.length > 3 && ex.length > 3 && (h.includes(ex) || ex.includes(h))))) {
      if (ex === 'date' && normField === 'foundingDate') {
        // preserve specific foundingDate
      } else {
        return true;
      }
    }

    // Check generic domain cross-mapping
    for (const [domain, syns] of Object.entries(DOMAIN_SYNONYMS)) {
      const exMatchesDomain = syns.some(s => s === ex || ex.includes(s));
      if (exMatchesDomain) {
        const fieldMatchesDomain = syns.some(s => s === normField)
          || (desc.family && syns.some(s => s === desc.family.toLowerCase()))
          || (desc.root && syns.some(s => s === desc.root.toLowerCase()));
        if (fieldMatchesDomain) return true;
      }
    }
  }
  return false;
}

/**
 * Filters requested fields to retain only retrieval-worthy fields:
 * 1. Suppresses explicitly excluded/negated fields.
 * 2. Suppresses synthetic/internal helper slots when a specific authoritative field is present.
 * 3. Preserves genuinely independent multi-field requests (e.g. degree + duration, accreditation + fee).
 *
 * @param {string[]} requestedFields
 * @param {string[]} exclusions
 * @param {object} constraints
 * @returns {string[]}
 */
function filterRetrievalWorthyFields(requestedFields, exclusions = [], constraints = {}) {
  if (!Array.isArray(requestedFields) || requestedFields.length === 0) return [];

  // Step 1: Filter out explicitly negated/excluded fields
  const activeFields = requestedFields.filter(f => !isFieldExcluded(f, exclusions, constraints));
  if (activeFields.length <= 1) return activeFields;

  // Known synthetic/internal helper slots that should not create redundant bindings
  const SYNTHETIC_HELPER_MAP = {
    scholarshipAvailability: { family: 'financial_aid', root: 'financial', priority: 1 },
    availability: { family: 'general', root: 'general', priority: 1 },
    feeComponent: { family: 'fee', root: 'financial', priority: 1 },
    contactNumber: { family: 'contact_telephony', root: 'contact', priority: 5 },
    date: { family: 'temporal_schedule', root: 'temporal', priority: 2 },
    amount: { family: 'fee', root: 'financial', priority: 3 }
  };

  const getDesc = (f) => ({
    field: f,
    ...(SYNTHETIC_HELPER_MAP[f] || getFieldDescriptor(f))
  });
  const descriptors = activeFields.map(getDesc);
  const result = [];

  for (let i = 0; i < activeFields.length; i++) {
    const field = activeFields[i];
    const desc = descriptors[i];

    // Check if redundant helper slot
    if (SYNTHETIC_HELPER_MAP[field]) {
      const hasSpecificAlternative = descriptors.some((other, j) => {
        if (i === j) return false;
        if (!SYNTHETIC_HELPER_MAP[other.field]) {
          if (other.family === desc.family || other.root === desc.root) return true;
          // Generic 'date' is suppressed if ANY specific authoritative field exists (schedule, foundingDate, fee, etc.)
          if (field === 'date') return true;
          // Generic 'amount' is suppressed if a specific fee field exists
          if (field === 'amount' && (other.family === 'fee' || other.root === 'financial')) return true;
          // Generic 'contactNumber' is suppressed if whatsapp or phone exists
          if (field === 'contactNumber' && (other.field === 'whatsapp' || other.field === 'phone')) return true;
          // Generic 'availability' is suppressed if scholarship exists
          if (field === 'availability' || field === 'scholarshipAvailability') return true;
          // Generic 'feeComponent' is suppressed if any fee field exists
          if (field === 'feeComponent' && (other.family === 'fee' || other.root === 'financial')) return true;
        }
        return false;
      });
      if (hasSpecificAlternative) continue; // Suppress redundant helper binding
    }

    // Also suppress broad parent root slot (e.g. 'contact') when specific child slot exists (e.g. 'whatsapp')
    if (desc.priority <= 2) {
      const hasSpecificChild = descriptors.some((other, j) => {
        if (i === j) return false;
        return (other.root === desc.root || other.family === desc.family) && other.priority > desc.priority;
      });
      if (hasSpecificChild) continue;
    }

    result.push(field);
  }

  return result.length > 0 ? result : [activeFields[0]];
}

/**
 * Derives primary and secondary retrieval hints for a specific requested field.
 *
 * @param {string} field
 * @param {string[]} exclusions
 * @returns {{ primaryFieldHints: string[], secondaryFamilyHints: string[] }}
 */
function deriveFieldHints(field, exclusions = []) {
  const normField = String(field || '').trim();
  const regEntry = FIELD_HINT_REGISTRY[normField] || null;
  const desc = getFieldDescriptor(normField);

  let primary = [];
  let secondary = [];

  if (regEntry) {
    primary = [...regEntry.primary];
    secondary = [...regEntry.secondary];
  } else if (normField) {
    primary = [normField];
    if (desc.family && desc.family !== normField) {
      secondary.push(desc.family);
    }
  }

  // Filter out any hints that collide with explicit negative exclusions
  if (Array.isArray(exclusions) && exclusions.length > 0) {
    const normExclusions = exclusions.map(e => String(e || '').toLowerCase().trim()).filter(Boolean);
    primary = primary.filter(h => !normExclusions.some(ex => h.toLowerCase().includes(ex)));
    secondary = secondary.filter(h => !normExclusions.some(ex => h.toLowerCase().includes(ex)));
  }

  return {
    primaryFieldHints: Object.freeze(primary),
    secondaryFamilyHints: Object.freeze(secondary)
  };
}

/**
 * Derives entity-specific search tokens from an authoritative entity object.
 * Does not invent new entities or scan text.
 *
 * @param {object} entity
 * @returns {string[]}
 */
function deriveEntityTokens(entity) {
  if (!entity || typeof entity !== 'object') return [];
  const tokens = new Set();

  const canonical = String(entity.canonical || entity.name || '').trim();
  if (canonical) {
    tokens.add(canonical);
  }

  if (Array.isArray(entity.matchedTerms)) {
    for (const t of entity.matchedTerms) {
      if (typeof t === 'string' && t.trim()) tokens.add(t.trim());
    }
  }

  if (Array.isArray(entity.aliases)) {
    for (const a of entity.aliases) {
      if (typeof a === 'string' && a.trim()) tokens.add(a.trim());
    }
  }

  return Array.from(tokens);
}

/**
 * Creates a deterministic, immutable retrieval binding.
 *
 * @param {object} params
 * @returns {object} Frozen RetrievalBinding
 */
function createRetrievalBinding({
  bindingId,
  subrequestId,
  scopeType,
  entity = null,
  requestedField,
  relations = [],
  constraints = {},
  exclusions = [],
  budgetConfig = DEFAULT_CONFIG,
  provenance = 'EXPLICIT_CURRENT',
  role = null
}) {
  const normField = String(requestedField || 'profile').trim();
  const desc = getFieldDescriptor(normField);
  const { primaryFieldHints, secondaryFamilyHints } = deriveFieldHints(normField, exclusions);

  const entityTokens = entity ? deriveEntityTokens(entity) : [];
  
  // Combine into an ordered, deduplicated retrieval hint sequence:
  // 1. Entity tokens (if scoped to entity)
  // 2. Primary field-specific hints
  // 3. Secondary family recall aids
  const hintSet = new Set();
  for (const t of entityTokens) hintSet.add(t);
  for (const h of primaryFieldHints) hintSet.add(h);
  for (const s of secondaryFamilyHints) hintSet.add(s);

  // If this binding is a relation side, add role markers if relevant
  if (scopeType === SCOPE_TYPES.RELATION_SIDE && role) {
    hintSet.add(role);
  }

  const retrievalHints = Array.from(hintSet);

  const binding = {
    bindingId,
    subrequestId,
    scopeType,
    role: role || (scopeType === SCOPE_TYPES.RELATION_SIDE ? 'relation_operand' : null),
    entity: entity ? {
      canonical: String(entity.canonical || entity.name || '').trim(),
      family: normalizeEntityFamily(entity.family || entity.type || 'unknown'),
      type: String(entity.type || 'unknown').trim(),
      provenance: entity.provenance || provenance,
      isOpenWorld: Boolean(entity.source === 'evidence' || entity.isOpenWorld)
    } : null,
    entityFamily: entity ? normalizeEntityFamily(entity.family || entity.type) : 'institution',
    requestedField: normField,
    fieldFamily: desc.family || 'general',
    fieldSpecificityPriority: desc.priority || 1,
    relations: Object.freeze([...relations]),
    constraints: Object.freeze({ ...constraints }),
    exclusions: Object.freeze([...exclusions]),
    primaryFieldHints,
    secondaryFamilyHints,
    retrievalHints: Object.freeze(retrievalHints),
    provenance,
    budget: Object.freeze({
      maxCandidates: Math.max(5, Number(budgetConfig.budgetPerBinding || DEFAULT_CONFIG.budgetPerBinding))
    })
  };

  return Object.freeze(binding);
}

/**
 * Extracts negative exclusions from a SemanticFrame.
 *
 * @param {object} semanticFrame
 * @returns {string[]}
 */
function extractExclusionsFromFrame(semanticFrame) {
  if (!semanticFrame || typeof semanticFrame !== 'object') return [];
  const exclusions = new Set();

  if (Array.isArray(semanticFrame.constraints?.exclude)) {
    for (const ex of semanticFrame.constraints.exclude) {
      if (typeof ex === 'string' && ex.trim()) exclusions.add(ex.trim().toLowerCase());
    }
  }

  if (Array.isArray(semanticFrame.constraints?.excludedFields)) {
    for (const ex of semanticFrame.constraints.excludedFields) {
      if (typeof ex === 'string' && ex.trim()) exclusions.add(ex.trim().toLowerCase());
    }
  }

  if (Array.isArray(semanticFrame.explicitSemantics?.negations)) {
    for (const neg of semanticFrame.explicitSemantics.negations) {
      if (typeof neg === 'string' && neg.trim()) exclusions.add(neg.trim().toLowerCase());
    }
  }

  // Check explicit negation of fee
  if (semanticFrame.explicitSemantics?.isNegatedFee || semanticFrame.constraints?.isNegatedFee) {
    exclusions.add('biaya');
    exclusions.add('spp');
    exclusions.add('dpp');
    exclusions.add('ukt');
    exclusions.add('tarif');
    exclusions.add('uang kuliah');
    exclusions.add('fee');
    exclusions.add('amount');
    exclusions.add('feeComponent');
  }

  return Array.from(exclusions);
}

/**
 * Creates an authoritative, deterministic RetrievalPlan from a resolved input.
 *
 * Consumes either:
 * A) A single immutable SemanticFrame, OR
 * B) A ResolvedRequestBundle: { subrequests: [ { semanticFrame, ownedEntities, ownedFields, relations, constraints } ] }
 *
 * Invariant: NEVER mutates incoming SemanticFrame. NEVER runs independent regex re-decomposition.
 *
 * @param {object} inputFrameOrBundle
 * @param {object} [options]
 * @returns {object} Deterministic Frozen RetrievalPlan
 */
function createRetrievalPlan(inputFrameOrBundle, options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };
  const subrequestsOut = [];
  let totalBindingsCount = 0;

  // Normalize input into explicit subrequest units
  const subrequestUnits = [];

  if (inputFrameOrBundle && Array.isArray(inputFrameOrBundle.subrequests)) {
    // Input is a ResolvedRequestBundle
    for (let i = 0; i < inputFrameOrBundle.subrequests.length; i++) {
      const unit = inputFrameOrBundle.subrequests[i];
      if (unit) subrequestUnits.push({ ...unit, index: i });
    }
  } else if (inputFrameOrBundle && typeof inputFrameOrBundle === 'object') {
    // Input is a single SemanticFrame
    subrequestUnits.push({
      subrequestId: 'subreq_0',
      index: 0,
      semanticFrame: inputFrameOrBundle,
      ownedEntities: Array.isArray(inputFrameOrBundle.entities) ? inputFrameOrBundle.entities : [],
      ownedFields: Array.isArray(inputFrameOrBundle.requestedFields) ? inputFrameOrBundle.requestedFields : [],
      relations: Array.isArray(inputFrameOrBundle.relations) ? inputFrameOrBundle.relations : [],
      constraints: inputFrameOrBundle.constraints || {}
    });
  } else {
    // Empty plan fallback
    return Object.freeze({
      version: 1,
      subrequests: Object.freeze([]),
      telemetry: Object.freeze({
        subrequestCount: 0,
        bindingCount: 0,
        fullScanUsed: false
      })
    });
  }

  for (const unit of subrequestUnits) {
    const subreqIdx = unit.index;
    const subreqId = unit.subrequestId || `subreq_${subreqIdx}`;
    const frame = unit.semanticFrame || {};
    const exclusions = extractExclusionsFromFrame(frame);

    const entities = Array.isArray(unit.ownedEntities) && unit.ownedEntities.length > 0
      ? unit.ownedEntities
      : (Array.isArray(frame.entities) ? frame.entities : []);

    const rawFields = Array.isArray(unit.ownedFields) && unit.ownedFields.length > 0
      ? unit.ownedFields
      : (Array.isArray(frame.requestedFields) ? frame.requestedFields : []);

    const constraints = unit.constraints || frame.constraints || {};

    // Apply generic retrieval-worthiness filtering and negation exclusion
    const requestedFields = filterRetrievalWorthyFields(rawFields, exclusions, constraints);

    const relations = Array.isArray(unit.relations) && unit.relations.length > 0
      ? unit.relations
      : (Array.isArray(frame.relations) ? frame.relations : []);

    const bindings = [];
    let bIdx = 0;

    // Rule 1: Relation-aware bindings (preserve sides independently)
    let hasExplicitRelation = false;
    for (const rel of relations) {
      if (rel && typeof rel === 'object' && rel.subject && rel.object) {
        hasExplicitRelation = true;
        const relField = rel.field || (requestedFields[0] || 'profile');
        if (!isFieldExcluded(relField, exclusions, constraints)) {
          const subjectEntity = (typeof rel.subject === 'object') ? rel.subject : (entities.find(e => e.canonical === rel.subject) || { canonical: rel.subject });
          const objectEntity = (typeof rel.object === 'object') ? rel.object : (entities.find(e => e.canonical === rel.object) || { canonical: rel.object });

          const isComparative = rel.relationType === 'equivalent_to' || relField === 'contrast' || Boolean(frame.intent?.primary?.includes('comparison'));

          // 1. Subject-side binding
          bindings.push(createRetrievalBinding({
            bindingId: `bind_${subreqIdx}_${bIdx++}`,
            subrequestId: subreqId,
            scopeType: SCOPE_TYPES.RELATION_SIDE,
            role: 'subject',
            entity: subjectEntity,
            requestedField: relField,
            relations: isComparative ? [] : [rel],
            constraints,
            exclusions,
            budgetConfig: config,
            provenance: subjectEntity.provenance || 'EXPLICIT_CURRENT'
          }));

          // 2. Object-side binding
          bindings.push(createRetrievalBinding({
            bindingId: `bind_${subreqIdx}_${bIdx++}`,
            subrequestId: subreqId,
            scopeType: SCOPE_TYPES.RELATION_SIDE,
            role: 'object',
            entity: objectEntity,
            requestedField: relField,
            relations: isComparative ? [] : [rel],
            constraints,
            exclusions,
            budgetConfig: config,
            provenance: (typeof rel.object === 'object' && rel.object.provenance) || 'EXPLICIT_CURRENT'
          }));

          // 3. Independent relation binding for comparative relations
          if (isComparative) {
            bindings.push(createRetrievalBinding({
              bindingId: `bind_${subreqIdx}_${bIdx++}`,
              subrequestId: subreqId,
              scopeType: SCOPE_TYPES.RELATION_SIDE,
              role: 'relation',
              entity: subjectEntity,
              requestedField: 'relation',
              relations: [rel],
              constraints,
              exclusions,
              budgetConfig: config,
              provenance: subjectEntity.provenance || 'EXPLICIT_CURRENT'
            }));
          }
        }
      }
    }

    // Rule 2: If relation sides handled the entities, do not duplicate them blindly
    if (!hasExplicitRelation) {
      if (entities.length > 0) {
        // We have explicit/inherited entities
        for (const ent of entities) {
          if (!ent) continue;

          if (requestedFields.length > 0) {
            // Multi-field or single-field for this entity
            for (const f of requestedFields) {
              if (isFieldExcluded(f, exclusions, constraints)) continue;
              bindings.push(createRetrievalBinding({
                bindingId: `bind_${subreqIdx}_${bIdx++}`,
                subrequestId: subreqId,
                scopeType: SCOPE_TYPES.EXPLICIT_ENTITY,
                entity: ent,
                requestedField: f,
                relations,
                constraints,
                exclusions,
                budgetConfig: config,
                provenance: ent.provenance || 'EXPLICIT_CURRENT'
              }));
            }
          } else {
            // Entity profile / definition request (zero factual fields)
            bindings.push(createRetrievalBinding({
              bindingId: `bind_${subreqIdx}_${bIdx++}`,
              subrequestId: subreqId,
              scopeType: SCOPE_TYPES.EXPLICIT_ENTITY,
              entity: ent,
              requestedField: 'profile',
              relations,
              constraints,
              exclusions,
              budgetConfig: config,
              provenance: ent.provenance || 'EXPLICIT_CURRENT'
            }));
          }
        }
      } else {
        // Rule 3: Entity-less but well-scoped queries (INSTITUTION_ROOT)
        // Examples: official Instagram, general campus contact, founding date
        if (requestedFields.length > 0) {
          for (const f of requestedFields) {
            if (isFieldExcluded(f, exclusions, constraints)) continue;
            bindings.push(createRetrievalBinding({
              bindingId: `bind_${subreqIdx}_${bIdx++}`,
              subrequestId: subreqId,
              scopeType: SCOPE_TYPES.INSTITUTION_ROOT,
              entity: null,
              requestedField: f,
              relations,
              constraints,
              exclusions,
              budgetConfig: config,
              provenance: frame.provenance?.requestedFields || 'EXPLICIT_CURRENT'
            }));
          }
        } else {
          // General institution profile / definition request
          bindings.push(createRetrievalBinding({
            bindingId: `bind_${subreqIdx}_${bIdx++}`,
            subrequestId: subreqId,
            scopeType: SCOPE_TYPES.INSTITUTION_ROOT,
            entity: null,
            requestedField: 'profile',
            relations,
            constraints,
            exclusions,
            budgetConfig: config,
            provenance: 'EXPLICIT_CURRENT'
          }));
        }
      }
    }

    totalBindingsCount += bindings.length;

    subrequestsOut.push(Object.freeze({
      subrequestId: subreqId,
      subrequestIndex: subreqIdx,
      rawText: frame.rawQuery || '',
      bindings: Object.freeze(bindings)
    }));
  }

  const plan = {
    version: 1,
    subrequests: Object.freeze(subrequestsOut),
    telemetry: Object.freeze({
      subrequestCount: subrequestsOut.length,
      bindingCount: totalBindingsCount,
      fullScanUsed: false
    })
  };

  return Object.freeze(plan);
}

/**
 * Executes bounded retrieval for each binding in a RetrievalPlan.
 *
 * Invariant: Per-binding candidate generation BEFORE global merge/dedupe.
 * Preserves multi-binding provenance for shared chunks.
 * Uses cached inverted index lookup; NEVER performs per-binding or full-corpus scans.
 *
 * @param {object} plan - Frozen RetrievalPlan
 * @param {object} retrievalContext - Context providing { getCachedSemanticIndex, getCachedInvertedIndex, lookupCandidateChunkIndices, getActiveTrainingDataFromDb }
 * @param {object} [options]
 * @returns {Promise<object>} Execution results with merged candidates and telemetry
 */
async function executeRetrievalPlan(plan, retrievalContext = {}, options = {}) {
  if (!plan || !Array.isArray(plan.subrequests)) {
    return {
      candidates: [],
      bindingResults: [],
      telemetry: {
        totalBindings: 0,
        avgCandidatesPerBinding: 0,
        p95CandidatesPerBinding: 0,
        maxCandidatesPerBinding: 0,
        fullScanUsed: false,
        trainingDataFullScanPerBinding: false
      }
    };
  }

  const {
    getCachedSemanticIndex,
    getCachedInvertedIndex,
    lookupCandidateChunkIndices,
    getActiveTrainingDataFromDb
  } = retrievalContext;

  const fullCorpusIndex = typeof getCachedSemanticIndex === 'function' ? getCachedSemanticIndex() : [];
  const invertedIndex = typeof getCachedInvertedIndex === 'function' ? getCachedInvertedIndex() : null;

  // Request-level pre-indexed TrainingData (cached in-memory, no per-binding full scan)
  let trainingRecords = [];
  let trainingTokenMap = null;
  if (typeof getActiveTrainingDataFromDb === 'function') {
    try {
      trainingRecords = await getActiveTrainingDataFromDb();
      if (Array.isArray(trainingRecords) && trainingRecords.length > 0) {
        trainingTokenMap = new Map();
        for (let r = 0; r < trainingRecords.length; r++) {
          const rec = trainingRecords[r];
          const text = ((rec.content || '') + ' ' + (rec.filename || '')).toLowerCase();
          const tokens = new Set(text.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean));
          for (const t of tokens) {
            let arr = trainingTokenMap.get(t);
            if (!arr) {
              arr = [];
              trainingTokenMap.set(t, arr);
            }
            arr.push(r);
          }
        }
      }
    } catch (_) {}
  }

  const bindingResults = [];
  const candidateCounts = [];
  const chunkProvenanceMap = new Map(); // chunkIndex -> { candidate, supportedBindingIds: Set, supportedEntities: Set, supportedFields: Set }

  for (const subreq of plan.subrequests) {
    for (const binding of subreq.bindings) {
      const budget = binding.budget.maxCandidates;
      const hints = binding.retrievalHints || [];

      let candidateIndices = [];
      let fullScanUsed = false;

      // Bounded corpus inverted index lookup
      if (typeof lookupCandidateChunkIndices === 'function' && invertedIndex) {
        candidateIndices = lookupCandidateChunkIndices(hints, invertedIndex, budget);
      } else {
        candidateIndices = Array.isArray(fullCorpusIndex)
          ? fullCorpusIndex.slice(0, budget).map((_, i) => i)
          : [];
      }

      const bindingCandidateRecords = [];

      for (const idx of candidateIndices) {
        const chunk = fullCorpusIndex[idx];
        if (!chunk) continue;

        bindingCandidateRecords.push({
          chunkIndex: idx,
          chunk,
          source: 'corpus_chunk',
          bindingId: binding.bindingId,
          entity: binding.entity ? binding.entity.canonical : null,
          field: binding.requestedField
        });

        // Track shared chunk multi-binding provenance
        let provEntry = chunkProvenanceMap.get(idx);
        if (!provEntry) {
          provEntry = {
            chunkIndex: idx,
            chunk,
            source: 'corpus_chunk',
            supportedBindingIds: new Set(),
            supportedEntities: new Set(),
            supportedFields: new Set(),
            primaryBindingId: binding.bindingId
          };
          chunkProvenanceMap.set(idx, provEntry);
        }

        provEntry.supportedBindingIds.add(binding.bindingId);
        if (binding.entity?.canonical) {
          provEntry.supportedEntities.add(binding.entity.canonical);
        }
        provEntry.supportedFields.add(binding.requestedField);
      }

      // Bounded TrainingData lookup via inverted token map
      if (trainingTokenMap && typeof lookupCandidateChunkIndices === 'function') {
        const trainingInv = { tokenMap: trainingTokenMap };
        const trainingIndices = lookupCandidateChunkIndices(hints, trainingInv, Math.min(10, budget));
        for (const tIdx of trainingIndices) {
          const rec = trainingRecords[tIdx];
          if (!rec) continue;

          bindingCandidateRecords.push({
            chunkIndex: `td_${tIdx}`,
            chunk: rec,
            source: 'training_data',
            bindingId: binding.bindingId,
            entity: binding.entity ? binding.entity.canonical : null,
            field: binding.requestedField
          });

          let provEntry = chunkProvenanceMap.get(`td_${tIdx}`);
          if (!provEntry) {
            provEntry = {
              chunkIndex: `td_${tIdx}`,
              chunk: rec,
              source: 'training_data',
              supportedBindingIds: new Set(),
              supportedEntities: new Set(),
              supportedFields: new Set(),
              primaryBindingId: binding.bindingId
            };
            chunkProvenanceMap.set(`td_${tIdx}`, provEntry);
          }

          provEntry.supportedBindingIds.add(binding.bindingId);
          if (binding.entity?.canonical) {
            provEntry.supportedEntities.add(binding.entity.canonical);
          }
          provEntry.supportedFields.add(binding.requestedField);
        }
      }

      const retrievedCount = bindingCandidateRecords.length;
      const isTruncated = retrievedCount >= budget;
      candidateCounts.push(retrievedCount);

      bindingResults.push({
        bindingId: binding.bindingId,
        subrequestId: binding.subrequestId,
        scopeType: binding.scopeType,
        entity: binding.entity ? binding.entity.canonical : 'INSTITUTION_ROOT',
        field: binding.requestedField,
        budget,
        candidateCount: retrievedCount,
        truncated: isTruncated,
        retrievalHints: binding.retrievalHints,
        fullScanUsed: false,
        candidates: bindingCandidateRecords
      });
    }
  }

  // Assemble merged, deduplicated candidates preserving multi-binding provenance
  const mergedCandidates = Array.from(chunkProvenanceMap.values()).map(entry => ({
    chunkIndex: entry.chunkIndex,
    chunk: entry.chunk,
    source: entry.source,
    supportedBindingIds: Array.from(entry.supportedBindingIds),
    supportedEntities: Array.from(entry.supportedEntities),
    supportedFields: Array.from(entry.supportedFields),
    primaryBindingId: entry.primaryBindingId
  }));

  // Compute telemetry metrics
  const totalBindings = bindingResults.length;
  let avgCandidates = 0;
  let maxCandidates = 0;
  let p95Candidates = 0;

  if (candidateCounts.length > 0) {
    const sum = candidateCounts.reduce((acc, c) => acc + c, 0);
    avgCandidates = parseFloat((sum / candidateCounts.length).toFixed(2));
    maxCandidates = Math.max(...candidateCounts);

    const sorted = [...candidateCounts].sort((a, b) => a - b);
    const p95Idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    p95Candidates = sorted[p95Idx];
  }

  return {
    candidates: mergedCandidates,
    bindingResults,
    telemetry: {
      totalBindings,
      avgCandidatesPerBinding: avgCandidates,
      p95CandidatesPerBinding: p95Candidates,
      maxCandidatesPerBinding: maxCandidates,
      fullScanUsed: false,
      trainingDataFullScanPerBinding: false
    }
  };
}

module.exports = {
  SCOPE_TYPES,
  DEFAULT_CONFIG,
  FIELD_HINT_REGISTRY,
  isFieldExcluded,
  filterRetrievalWorthyFields,
  deriveFieldHints,
  deriveEntityTokens,
  createRetrievalBinding,
  extractExclusionsFromFrame,
  createRetrievalPlan,
  executeRetrievalPlan
};
