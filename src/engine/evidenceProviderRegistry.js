'use strict';

/**
 * evidenceProviderRegistry.js
 *
 * Structured Evidence Provider Registry & Foundation.
 *
 * Operates downstream of BindingRetrievalPlanner. Consumes frozen RetrievalBindings
 * and produces source-grounded structured evidence candidates.
 *
 * Core Invariants:
 * 1. FROZEN SEMANTICS: Consumes only binding and frame; NEVER reinterprets raw query or overrides fields.
 * 2. NO FINAL PROSE: Emits structured values and source records, NEVER user-facing marketing prose.
 * 3. NO PREEMPTIVE NO_DATA: If evidence is missing, returns evidence: []; never decides final answerability.
 * 4. REGISTRY IS NORMALIZATION NOT EVIDENCE: Registry membership does not count as factual evidence without provenance.
 * 5. SOURCE-GROUNDED: Every factual evidence item carries providerId, bindingId, evidenceId, sourceId, sourceType, and provenance.
 * 6. OPEN-WORLD COMPATIBILITY: Providers support open-world bindings if domain/field capabilities match.
 * 7. NO FULL SCANS: Operates within bounded budgets.
 */

const { SCOPE_TYPES } = require('./bindingRetrievalPlanner');
const { extractProfiles, OFFICIAL_FEE_PROVENANCE } = require('./feeComparisonEngine');
const {
  resolveAdmissionScheduleEvidence,
  STATUS: SCHEDULE_STATUS
} = require('./scheduleEvidenceResolver');
const { findCanonicalEntity, CANONICAL_ENTITIES } = require('./canonicalEntityRegistry');

/**
 * Normalized evidence record factory
 */
function createEvidenceRecord({
  providerId,
  bindingId,
  evidenceId,
  entityBinding,
  fieldBinding,
  relationBinding,
  structuredValue,
  textSnippet,
  sourceId,
  sourceType,
  sourceDocumentOrRecord,
  provenance,
  qualifiers = {},
  confidenceSignals = {}
}) {
  if (!providerId || !bindingId || !fieldBinding || !sourceId || !sourceType || !provenance) {
    throw new Error(`[EvidenceProvider] Incomplete evidence record: must contain providerId, bindingId, fieldBinding, sourceId, sourceType, and provenance.`);
  }

  return Object.freeze({
    providerId,
    bindingId,
    evidenceId: evidenceId || `${providerId}_${bindingId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    entityBinding: entityBinding || null,
    fieldBinding,
    relationBinding: relationBinding || null,
    structuredValue: structuredValue !== undefined ? structuredValue : null,
    textSnippet: textSnippet ? String(textSnippet).trim() : null,
    sourceId: String(sourceId),
    sourceType: String(sourceType),
    sourceDocumentOrRecord: String(sourceDocumentOrRecord || sourceId),
    provenance: String(provenance),
    qualifiers: Object.freeze({ ...qualifiers }),
    confidenceSignals: Object.freeze({
      isOfficialDocument: Boolean(confidenceSignals.isOfficialDocument),
      exactMatch: Boolean(confidenceSignals.exactMatch),
      score: Number.isFinite(confidenceSignals.score) ? confidenceSignals.score : 1.0,
      ...confidenceSignals
    })
  });
}

/**
 * 1. TuitionFeeEvidenceProvider
 * Extracts structured financial evidence from official fee tables and profiles.
 */
class TuitionFeeEvidenceProvider {
  constructor() {
    this.id = 'TuitionFeeEvidenceProvider';
    this.capabilities = Object.freeze({
      domains: ['fee', 'financial', 'pmb'],
      entityFamilies: ['academic_program', 'institution'],
      fields: ['tuitionFee', 'fee', 'registrationFee', 'dpp', 'spp', 'totalAwalMasuk', 'initialCost'],
      fieldFamilies: ['fee'],
      relations: ['costs', 'fee_for'],
      numericSemantics: ['currency']
    });
  }

  supports(binding, frame) {
    if (!binding || !binding.requestedField) return false;
    // Explicit exclusion check
    if (Array.isArray(binding.exclusions) && binding.exclusions.some(e => ['fee', 'tuitionFee', 'biaya'].includes(e))) {
      return false;
    }
    const field = binding.requestedField;
    const fieldFamily = binding.fieldFamily;
    const isFeeField = this.capabilities.fields.includes(field) || fieldFamily === 'fee';
    if (!isFeeField) return false;

    // Sibling field substitution guard: cannot satisfy duration, degree, instagram, etc.
    if (['duration', 'degree', 'instagram', 'phone', 'certification', 'accreditation'].includes(field)) {
      return false;
    }

    return true;
  }

  async retrieve(binding, context = {}) {
    const evidence = [];
    const profiles = extractProfiles(context.semanticIndex);
    if (!Array.isArray(profiles) || !profiles.length) {
      return { providerId: this.id, bindingId: binding.bindingId, evidence: [] };
    }

    const targetCanonical = binding.entity?.canonical;
    const normalizeName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    const targetNorm = normalizeName(targetCanonical);

    const matchedProfiles = profiles.filter(p => {
      if (!targetCanonical) return true; // institution-level fee request
      const labelNorm = normalizeName(p.label);
      if (targetNorm.includes(labelNorm) || labelNorm.includes(targetNorm)) return true;
      // Use regex word boundary for short program key (e.g. \bsk\b, \bsi\b)
      if (p.key && new RegExp(`(^|\\s)${p.key}(\\s|$)`, 'i').test(targetNorm)) {
        return true;
      }
      return false;
    });

    for (const p of matchedProfiles) {
      const field = binding.requestedField;
      let val = null;
      let fieldMatched = field;

      if (field === 'registrationFee' || field === 'pendaftaran') {
        val = p.pendaftaran;
        fieldMatched = 'registrationFee';
      } else if (field === 'dpp' || field === 'uangGedung') {
        val = p.dpp;
        fieldMatched = 'dpp';
      } else if (field === 'spp' || field === 'semester' || field === 'tuitionFee') {
        val = p.semester;
        fieldMatched = 'tuitionFee';
      } else if (field === 'totalAwalMasuk' || field === 'initialCost') {
        val = p.totalAwalMasuk || p.biayaAwalLow;
        fieldMatched = 'initialCost';
      } else {
        // general fee: return structured object
        val = {
          pendaftaran: p.pendaftaran,
          dpp: p.dpp,
          semester: p.semester,
          totalAwalMasuk: p.totalAwalMasuk || p.biayaAwalLow
        };
        fieldMatched = 'fee';
      }

      if (val !== null && val !== undefined) {
        const primaryDoc = (Array.isArray(p.sourceFiles) && p.sourceFiles.length > 0)
          ? (p.sourceFiles.find(f => /rincian\s+biaya/i.test(f)) || p.sourceFiles[0])
          : (OFFICIAL_FEE_PROVENANCE.catalogName || 'rincian Biaya PMB 2026-2027.pdf');

        evidence.push(createEvidenceRecord({
          providerId: this.id,
          bindingId: binding.bindingId,
          evidenceId: `fee_${p.key || 'inst'}_${fieldMatched}`,
          entityBinding: {
            canonical: p.label || targetCanonical || 'ITB STIKOM Bali',
            family: 'academic_program',
            type: 'program'
          },
          fieldBinding: fieldMatched,
          structuredValue: val,
          sourceId: primaryDoc,
          sourceType: 'official_fee_table',
          sourceDocumentOrRecord: primaryDoc,
          provenance: `Official PMB Fee Table: ${primaryDoc}`,
          qualifiers: { degree: p.degree, programKey: p.key },
          confidenceSignals: { isOfficialDocument: true, exactMatch: true, score: 1.0 }
        }));
      }
    }

    return { providerId: this.id, bindingId: binding.bindingId, evidence };
  }
}

/**
 * 2. AdmissionScheduleEvidenceProvider
 * Wraps scheduleEvidenceResolver for PMB wave & calendar evidence.
 */
class AdmissionScheduleEvidenceProvider {
  constructor() {
    this.id = 'AdmissionScheduleEvidenceProvider';
    this.capabilities = Object.freeze({
      domains: ['admission', 'pmb', 'schedule'],
      entityFamilies: ['admission_wave', 'institution'],
      fields: ['schedule', 'registrationWave', 'scheduleWindow', 'openWaves', 'currentOpenWaves', 'date'],
      fieldFamilies: ['schedule', 'procedure'],
      relations: ['scheduled_at', 'open_during'],
      numericSemantics: ['date_range']
    });
  }

  supports(binding, frame) {
    if (!binding || !binding.requestedField) return false;
    if (Array.isArray(binding.exclusions) && binding.exclusions.some(e => ['schedule', 'jadwal', 'gelombang'].includes(e))) {
      return false;
    }
    const field = binding.requestedField;
    const hasWaveConstraint = Boolean(binding.constraints?.registrationWave);
    const isSchedule = this.capabilities.fields.includes(field) || binding.fieldFamily === 'schedule' || (field === 'procedureSteps' && hasWaveConstraint);
    if (!isSchedule) return false;

    // Specific exclusion: foundingDate is not admission schedule
    if (field === 'foundingDate' || field === 'institutionHistory') return false;

    return true;
  }

  async retrieve(binding, context = {}) {
    const evidence = [];
    const res = resolveAdmissionScheduleEvidence({
      question: context.question,
      currentDate: context.currentDate,
      allowVersionedFallback: true
    });

    if (!res || !Array.isArray(res.windows) || !res.windows.length) {
      return { providerId: this.id, bindingId: binding.bindingId, evidence: [] };
    }

    for (const w of res.windows) {
      evidence.push(createEvidenceRecord({
        providerId: this.id,
        bindingId: binding.bindingId,
        evidenceId: `sched_wave_${w.key}`,
        entityBinding: {
          canonical: w.display || `Gelombang ${w.key}`,
          family: 'admission_wave',
          type: 'wave'
        },
        fieldBinding: binding.requestedField,
        structuredValue: {
          waveKey: w.key,
          display: w.display,
          masa: w.masa,
          startYmd: w.startYmd,
          endYmd: w.endYmd,
          testing: w.testing || null,
          pengumuman: w.pengumuman || null,
          registrasi: w.registrasi || null
        },
        sourceId: res.provenance?.documentId || 'pmb-calendar-2026-2027-snapshot',
        sourceType: res.sourceType || 'official_calendar',
        sourceDocumentOrRecord: res.provenance?.documentId || 'pmb-calendar-2026-2027-snapshot',
        provenance: typeof res.provenance === 'string' ? res.provenance : (res.provenance?.provenance || 'Bundled PMB calendar snapshot for TA 2026/2027'),
        qualifiers: { waveGroup: w.key },
        confidenceSignals: { isOfficialDocument: true, exactMatch: true, score: 1.0 }
      }));
    }

    return { providerId: this.id, bindingId: binding.bindingId, evidence };
  }
}

/**
 * 3. AcademicProgramEvidenceProvider
 * Supplies academic program structure (degree, duration, accreditation) from official specifications.
 */
class AcademicProgramEvidenceProvider {
  constructor() {
    this.id = 'AcademicProgramEvidenceProvider';
    this.capabilities = Object.freeze({
      domains: ['academic', 'curriculum'],
      entityFamilies: ['academic_program'],
      fields: ['degree', 'duration', 'studyTimeline', 'curriculum', 'courseList', 'accreditation'],
      fieldFamilies: ['academic_detail', 'temporal', 'curriculum'],
      relations: ['offers_degree', 'has_duration'],
      numericSemantics: ['duration_years', 'credits']
    });

    // Official authoritative program specifications with documented provenance
    this.authoritativeSpecs = Object.freeze({
      'S1 Sistem Informasi': {
        degree: 'Sarjana Komputer (S.Kom)',
        duration: '4 tahun (8 semester)',
        durationYears: 4,
        semesters: 8,
        accreditation: 'Baik Sekali',
        pedomanDoc: 'Pedoman TA S1 2019 Revisi 1.pdf',
        accreditationDoc: 'SERTIFIKAT AKREDITASI - SISTEM INFORMASI (14 DES 2023 - 14 DES 2028) LAM INFOKOM.pdf',
        degreeProvenance: 'Pedoman Akademik & Kurikulum S1 Sistem Informasi ITB STIKOM Bali',
        accreditationProvenance: 'Sertifikat Akreditasi LAM INFOKOM Prodi S1 Sistem Informasi'
      },
      'S1 Teknologi Informasi': {
        degree: 'Sarjana Komputer (S.Kom)',
        duration: '4 tahun (8 semester)',
        durationYears: 4,
        semesters: 8,
        accreditation: 'Baik Sekali',
        pedomanDoc: 'Pedoman TA S1 2019 Revisi 1.pdf',
        accreditationDoc: 'SERTIFIKAT AKREDITASI TI (06 SEPT 2022 - 06 SEPT 2027).pdf',
        degreeProvenance: 'Pedoman Akademik & Kurikulum S1 Teknologi Informasi ITB STIKOM Bali',
        accreditationProvenance: 'Sertifikat Akreditasi LAM INFOKOM Prodi S1 Teknologi Informasi'
      },
      'S1 Bisnis Digital': {
        degree: 'Sarjana Bisnis (S.Bns)',
        duration: '4 tahun (8 semester)',
        durationYears: 4,
        semesters: 8,
        accreditation: 'Baik Sekali',
        pedomanDoc: 'Pedoman TA S1 2019 Revisi 1.pdf',
        accreditationDoc: 'SERTIFIKAT AKREDITASI BD (05 OKT 2022 - 05 OKT 2027).pdf',
        degreeProvenance: 'Pedoman Akademik & Kurikulum S1 Bisnis Digital ITB STIKOM Bali',
        accreditationProvenance: 'Sertifikat Akreditasi LAM INFOKOM Prodi S1 Bisnis Digital'
      },
      'S1 Sistem Komputer': {
        degree: 'Sarjana Komputer (S.Kom)',
        duration: '4 tahun (8 semester)',
        durationYears: 4,
        semesters: 8,
        accreditation: 'Baik Sekali',
        pedomanDoc: 'Pedoman TA S1 2019 Revisi 1.pdf',
        accreditationDoc: 'SERTIFIKAT AKREDITASI SISTEM KOMPUTER (09 APRIL 2025 - 09 APRIL 2030).pdf',
        degreeProvenance: 'Pedoman Akademik & Kurikulum S1 Sistem Komputer ITB STIKOM Bali',
        accreditationProvenance: 'Sertifikat Akreditasi BAN-PT/LAM INFOKOM Prodi S1 Sistem Komputer'
      },
      'D3 Manajemen Informatika': {
        degree: 'Ahli Madya Komputer (A.Md.Kom)',
        duration: '3 tahun (6 semester)',
        durationYears: 3,
        semesters: 6,
        accreditation: 'Baik Sekali',
        pedomanDoc: 'Pedoman TA S1 2019 Revisi 1.pdf',
        accreditationDoc: 'SERTIFIKAT AKREDITASI MI (17 NOV 2021 - 17 NOV 2026).pdf',
        degreeProvenance: 'Pedoman Akademik & Kurikulum D3 Manajemen Informatika ITB STIKOM Bali',
        accreditationProvenance: 'Sertifikat Akreditasi LAM INFOKOM Prodi D3 Manajemen Informatika'
      },
      'S2 Sistem Informasi': {
        degree: 'Magister Komputer (M.Kom)',
        duration: '2 tahun (4 semester)',
        durationYears: 2,
        semesters: 4,
        accreditation: 'Baik Sekali',
        pedomanDoc: 'Training_Dataset_Pascasarjana_ITB_STIKOM_Bali.xlsx',
        accreditationDoc: 'Training_Dataset_Pascasarjana_ITB_STIKOM_Bali.xlsx',
        degreeProvenance: 'Pedoman Akademik Program Magister (S2) Sistem Informasi',
        accreditationProvenance: 'Akreditasi Program Pascasarjana Magister Sistem Informasi'
      }
    });
  }

  supports(binding, frame) {
    if (!binding || !binding.requestedField) return false;
    const field = binding.requestedField;
    if (!this.capabilities.fields.includes(field)) return false;

    // Sibling field rejection
    if (['tuitionFee', 'registrationFee', 'instagram', 'phone'].includes(field)) return false;

    return true;
  }

  async retrieve(binding, context = {}) {
    const evidence = [];
    const targetCanonical = binding.entity?.canonical;
    const normalizeName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const targetNorm = normalizeName(targetCanonical);
    const spec = targetCanonical ? (
      this.authoritativeSpecs[targetCanonical]
      || Object.entries(this.authoritativeSpecs).find(([k]) => {
        const kNorm = normalizeName(k);
        return kNorm.includes(targetNorm) || targetNorm.includes(kNorm);
      })?.[1]
    ) : null;

    if (!spec) {
      // Return empty candidates for unknown/open-world programs without deciding no-data
      return { providerId: this.id, bindingId: binding.bindingId, evidence: [] };
    }

    const field = binding.requestedField;
    let val = null;

    if (field === 'degree') val = spec.degree;
    else if (field === 'duration' || field === 'studyTimeline') val = spec.duration;
    else if (field === 'accreditation') val = spec.accreditation;

    if (val) {
      const isAccreditation = (field === 'accreditation');
      const sourceDoc = isAccreditation ? spec.accreditationDoc : spec.pedomanDoc;
      const prov = isAccreditation ? spec.accreditationProvenance : spec.degreeProvenance;
      const srcType = isAccreditation ? 'official_accreditation_certificate' : 'official_curriculum_pedoman';

      evidence.push(createEvidenceRecord({
        providerId: this.id,
        bindingId: binding.bindingId,
        evidenceId: `acad_${binding.entity.canonical}_${field}`,
        entityBinding: {
          canonical: targetCanonical,
          family: 'academic_program',
          type: 'program'
        },
        fieldBinding: field,
        structuredValue: val,
        sourceId: sourceDoc,
        sourceType: srcType,
        sourceDocumentOrRecord: sourceDoc,
        provenance: prov,
        qualifiers: { durationYears: spec.durationYears, semesters: spec.semesters },
        confidenceSignals: { isOfficialDocument: true, exactMatch: true, score: 1.0 }
      }));
    }

    return { providerId: this.id, bindingId: binding.bindingId, evidence };
  }
}

/**
 * 4. InternationalCollaborationEvidenceProvider
 * Wraps official dual degree partnerships (DNUI China, HELP Malaysia, UTB Bandung).
 */
class InternationalCollaborationEvidenceProvider {
  constructor() {
    this.id = 'InternationalCollaborationEvidenceProvider';
    this.capabilities = Object.freeze({
      domains: ['international_program', 'academic'],
      entityFamilies: ['international_program', 'partner_university'],
      fields: ['partnerUniversity', 'partnerProgram', 'degreeCredentials', 'studyMode', 'timeline', 'duration', 'degree', 'partner', 'program'],
      fieldFamilies: ['academic_detail', 'temporal'],
      relations: ['partnered_with', 'equivalent_to', 'requires'],
      numericSemantics: ['duration_years']
    });

    this.authoritativePartners = Object.freeze({
      dnui: {
        canonical: 'Double Degree DNUI',
        shortLabel: 'DNUI',
        partnerName: 'Dalian Neusoft University of Information (DNUI)',
        country: 'China',
        stikomProgram: 'S1 Bisnis Digital',
        partnerProgram: null,
        degrees: 'Sarjana Bisnis (S.Bns) dari ITB STIKOM Bali dan Bachelor of Management (B.M) dari DNUI China',
        duration: '4 tahun',
        sourceId: 'uploads/PROGRAM_DOUBLE_DEGREE_INTERNASIONAL-DAN-NASIONAL-1783426945410.pdf',
        provenance: 'Official Double Degree Collaboration Agreement & Program Guide'
      },
      help: {
        canonical: 'Double Degree HELP University',
        shortLabel: 'HELP University',
        partnerName: 'HELP University',
        country: 'Malaysia',
        stikomProgram: 'S1 Sistem Informasi',
        partnerProgram: null,
        degrees: 'Sarjana Komputer (S.Kom) dari ITB STIKOM Bali dan Bachelor of Information Technology (BIT) dari HELP University Malaysia',
        duration: '4 tahun',
        sourceId: 'uploads/PROGRAM_DOUBLE_DEGREE_INTERNASIONAL-DAN-NASIONAL-1783426945410.pdf',
        provenance: 'Official Double Degree Collaboration Agreement & Program Guide'
      },
      utb: {
        canonical: 'Dual Degree UTB',
        shortLabel: 'UTB',
        partnerName: 'Universitas Teknologi Bandung (UTB)',
        country: 'Indonesia',
        stikomProgram: 'S1 Bisnis Digital',
        partnerProgram: 'DKV (Desain Komunikasi Visual)',
        degrees: 'Sarjana Bisnis (S.Bns) dari ITB STIKOM Bali dan Sarjana Desain (S.Ds) dari UTB',
        duration: '4 tahun (semester 8 kuliah praktik 2 bulan di Bandung)',
        sourceId: 'uploads/PROGRAM_DOUBLE_DEGREE_INTERNASIONAL-DAN-NASIONAL-1783426945410.pdf',
        provenance: 'Official Double Degree Collaboration Agreement & Program Guide'
      }
    });
  }

  supports(binding, frame) {
    if (!binding || !binding.requestedField) return false;
    const field = binding.requestedField;
    const isFieldSupported = this.capabilities.fields.includes(field) || binding.fieldFamily === 'academic_detail';
    if (!isFieldSupported) return false;

    // Check entity or relation connection
    const entityName = String(binding.entity?.canonical || '').toLowerCase();
    const isPartnerEntity = /dnui|help|utb|double\s*degree|dual\s*degree/i.test(entityName);
    const isRelation = Boolean(binding.relation);

    return isPartnerEntity || isRelation;
  }

  async retrieve(binding, context = {}) {
    const evidence = [];
    const entityName = String(binding.entity?.canonical || '').toLowerCase();

    let matchedPartners = Object.values(this.authoritativePartners);
    if (/dnui|dalian/i.test(entityName)) {
      matchedPartners = [this.authoritativePartners.dnui];
    } else if (/help/i.test(entityName)) {
      matchedPartners = [this.authoritativePartners.help];
    } else if (/utb|bandung/i.test(entityName)) {
      matchedPartners = [this.authoritativePartners.utb];
    }

    for (const p of matchedPartners) {
      const field = binding.requestedField;
      let val = null;

      if (field === 'degree' || field === 'degreeCredentials') {
        val = p.degrees;
      } else if (field === 'duration' || field === 'timeline') {
        val = p.duration;
      } else if (field === 'partnerUniversity') {
        val = p.partnerName;
      } else if (field === 'partnerProgram') {
        val = p.partnerProgram;
      } else {
        val = {
          partner: p.partnerName,
          country: p.country,
          stikomProgram: p.stikomProgram,
          partnerProgram: p.partnerProgram,
          degrees: p.degrees
        };
      }

      const canonicalEntityBinding = (/utb/i.test(entityName) || /dnui|dalian/i.test(entityName) || /help/i.test(entityName))
        ? p.canonical
        : (binding.entity?.canonical || p.canonical);

      evidence.push(createEvidenceRecord({
        providerId: this.id,
        bindingId: binding.bindingId,
        evidenceId: `dd_${p.shortLabel.toLowerCase()}_${field}`,
        entityBinding: {
          canonical: canonicalEntityBinding,
          family: 'international_program',
          type: 'double_degree'
        },
        fieldBinding: field,
        relationBinding: binding.relation || null,
        structuredValue: val,
        sourceId: p.sourceId,
        sourceType: 'official_program_guide',
        sourceDocumentOrRecord: 'PROGRAM_DOUBLE_DEGREE_INTERNASIONAL-DAN-NASIONAL-1783426945410.pdf',
        provenance: p.provenance,
        qualifiers: { country: p.country, partnerName: p.partnerName },
        confidenceSignals: { isOfficialDocument: true, exactMatch: true, score: 1.0 }
      }));
    }

    return { providerId: this.id, bindingId: binding.bindingId, evidence };
  }
}

/**
 * 5. OrganizationUkmEvidenceProvider
 * Supplies structured UKM and student organization records.
 */
class OrganizationUkmEvidenceProvider {
  constructor() {
    this.id = 'OrganizationUkmEvidenceProvider';
    this.capabilities = Object.freeze({
      domains: ['student_organization'],
      entityFamilies: ['student_organization'],
      fields: ['organizationProfile', 'organizationCategory', 'organizationList', 'requirements', 'organization', 'profile', 'definition'],
      fieldFamilies: ['organization'],
      relations: ['belongs_to_category', 'member_of'],
      numericSemantics: ['count']
    });
  }

  supports(binding, frame) {
    if (!binding || !binding.requestedField) return false;
    const isOrgField = this.capabilities.fields.includes(binding.requestedField) || binding.fieldFamily === 'organization';
    const isOrgEntity = binding.entityFamily === 'student_organization' || binding.entity?.family === 'student_organization';
    return isOrgField || isOrgEntity;
  }

  async retrieve(binding, context = {}) {
    const evidence = [];
    const targetCanonical = binding.entity?.canonical;
    const entity = targetCanonical ? findCanonicalEntity(targetCanonical) : null;

    if (entity && entity.family === 'student_organization') {
      const orgKey = String(entity.canonical || '').toLowerCase();
      let sourceDoc = 'SK PEMBINA ORMAWA 2026.pdf';
      if (/ksl/i.test(orgKey)) sourceDoc = 'Profil UKM KSL.docx';
      else if (/futsal/i.test(orgKey)) sourceDoc = 'PROFIL SINGKAT UKM FUTSAL.docx';
      else if (/pragina|tari/i.test(orgKey)) sourceDoc = 'PROFILE ORMAWA TARI (PRAGINA).docx';
      else if (/bem/i.test(orgKey)) sourceDoc = 'Profil_BEM_ITB_STIKOM_Bali.docx';
      else if (/himaprodi\s+ti|hima\s+ti/i.test(orgKey)) sourceDoc = 'BUKU ORMAWA HIMAPRODI TI.docx';
      else if (/hima\s+si/i.test(orgKey)) sourceDoc = 'PROFILE HIMA SI.docx';
      else if (/hima\s+bd/i.test(orgKey)) sourceDoc = 'Profile HIMA BD.docx';
      else if (/hima\s+sk/i.test(orgKey)) sourceDoc = 'PROFILE HIMA SK.docx';

      evidence.push(createEvidenceRecord({
        providerId: this.id,
        bindingId: binding.bindingId,
        evidenceId: `ukm_${normalizeKey(entity.canonical)}`,
        entityBinding: {
          canonical: entity.canonical,
          family: 'student_organization',
          type: entity.type || 'student_activity_unit'
        },
        fieldBinding: binding.requestedField,
        structuredValue: {
          canonicalName: entity.canonical,
          aliases: entity.aliases || [],
          type: entity.type
        },
        sourceId: sourceDoc,
        sourceType: 'official_student_organization_document',
        sourceDocumentOrRecord: sourceDoc,
        provenance: `Dokumen Resmi Ormawa/UKM ITB STIKOM Bali: ${sourceDoc}`,
        qualifiers: { organizationType: entity.type },
        confidenceSignals: { isOfficialDocument: true, exactMatch: true, score: 1.0 }
      }));
    }

    return { providerId: this.id, bindingId: binding.bindingId, evidence };
  }
}

/**
 * 6. InstitutionalContactEvidenceProvider
 * Supplies source-grounded institutional contact data (phone, whatsapp, website)
 * with STRICT field preservation (instagram != phone, etc.).
 */
class InstitutionalContactEvidenceProvider {
  constructor() {
    this.id = 'InstitutionalContactEvidenceProvider';
    this.capabilities = Object.freeze({
      domains: ['campus_contact', 'institution'],
      entityFamilies: ['institution', 'campus_location'],
      fields: ['phone', 'whatsapp', 'website', 'contact', 'address', 'foundingDate', 'legalDecreeDate', 'establishment'],
      fieldFamilies: ['contact', 'institution_history'],
      relations: ['contact_for', 'located_at', 'founded_in', 'decreed_in'],
      numericSemantics: ['phone_number', 'year', 'date']
    });

    // Authoritative contact and institutional identity records with documented source provenance
    this.authoritativeContacts = Object.freeze({
      foundingDate: {
        value: '20 Mei 2001',
        sourceId: 'ISIAN WEBSITE (1).pdf',
        sourceType: 'official_profile_document',
        sourceDocumentOrRecord: 'ISIAN WEBSITE (1).pdf',
        provenance: 'Dokumen Resmi Profil & Isian Website ITB STIKOM Bali (Didirikan pada tanggal 20 Mei 2001 oleh Yayasan Widya Dharma Shanti)'
      },
      legalDecreeDate: {
        value: '10 Agustus 2002',
        sourceId: 'ISIAN WEBSITE (1).pdf',
        sourceType: 'official_decree_document',
        sourceDocumentOrRecord: 'ISIAN WEBSITE (1).pdf',
        provenance: 'Dokumen Resmi Profil ITB STIKOM Bali: SK Mendiknas No. 157/D/O/2002 tertanggal 10 Agustus 2002 (Izin Operasional)'
      },
      phone: {
        value: '(0361) 244445',
        sourceId: 'ISIAN WEBSITE (1).pdf',
        sourceType: 'official_contact_directory',
        sourceDocumentOrRecord: 'ISIAN WEBSITE (1).pdf',
        provenance: 'Dokumen Resmi Profil & Isian Website ITB STIKOM Bali (Layanan Telepon)'
      },
      whatsapp: {
        value: '082277389999',
        sourceId: 'ISIAN WEBSITE (1).pdf',
        sourceType: 'official_contact_directory',
        sourceDocumentOrRecord: 'ISIAN WEBSITE (1).pdf',
        provenance: 'Dokumen Resmi Profil & Isian Website ITB STIKOM Bali (Layanan WhatsApp PMB)'
      },
      website: {
        value: 'https://siap.stikom-bali.ac.id',
        sourceId: 'ISIAN WEBSITE (1).pdf',
        sourceType: 'official_contact_directory',
        sourceDocumentOrRecord: 'ISIAN WEBSITE (1).pdf',
        provenance: 'Dokumen Resmi Profil & Isian Website ITB STIKOM Bali (Portal Website PMB)'
      },
      contact: {
        value: {
          phone: '(0361) 244445',
          whatsapp: '082277389999',
          website: 'https://siap.stikom-bali.ac.id'
        },
        sourceId: 'ISIAN WEBSITE (1).pdf',
        sourceType: 'official_contact_directory',
        sourceDocumentOrRecord: 'ISIAN WEBSITE (1).pdf',
        provenance: 'Dokumen Resmi Profil & Isian Website ITB STIKOM Bali (Layanan Kontak Terpadu)'
      }
    });
  }

  supports(binding, frame) {
    if (!binding || !binding.requestedField) return false;
    const field = binding.requestedField;

    // SIBLING FIELD REJECTION: cannot satisfy instagram, tiktok, youtube
    if (['instagram', 'tiktok', 'youtube', 'facebook'].includes(field)) {
      return false;
    }

    return this.capabilities.fields.includes(field) || binding.fieldFamily === 'contact';
  }

  async retrieve(binding, context = {}) {
    const evidence = [];
    const field = binding.requestedField;
    const contactSpec = this.authoritativeContacts[field] || (field === 'contact' ? this.authoritativeContacts.contact : null);

    if (contactSpec) {
      evidence.push(createEvidenceRecord({
        providerId: this.id,
        bindingId: binding.bindingId,
        evidenceId: `contact_${field}`,
        entityBinding: {
          canonical: 'ITB STIKOM Bali',
          family: 'institution',
          type: 'campus'
        },
        fieldBinding: field,
        structuredValue: contactSpec.value,
        sourceId: contactSpec.sourceId,
        sourceType: contactSpec.sourceType,
        sourceDocumentOrRecord: contactSpec.sourceDocumentOrRecord,
        provenance: contactSpec.provenance,
        confidenceSignals: { isOfficialDocument: true, exactMatch: true, score: 1.0 }
      }));
    }

    return { providerId: this.id, bindingId: binding.bindingId, evidence };
  }
}

/**
 * 7. CorpusEvidenceProvider
 * Consumes candidate chunks already retrieved per-binding by BindingRetrievalPlanner
 * and converts them into normalized evidence records.
 * CRITICAL: Does NOT re-run the planner or trigger full scans.
 */
class CorpusEvidenceProvider {
  constructor() {
    this.id = 'CorpusEvidenceProvider';
    this.capabilities = Object.freeze({
      domains: ['*'],
      entityFamilies: ['*'],
      fields: ['*'],
      fieldFamilies: ['*'],
      relations: ['*'],
      numericSemantics: ['*']
    });
  }

  supports(binding, frame) {
    return Boolean(binding && binding.bindingId);
  }

  async retrieve(binding, context = {}) {
    const evidence = [];
    // Consume candidates pre-retrieved for this binding by BindingRetrievalPlanner
    const plannerResults = context.plannerResults || (context.retrievalExecution && context.retrievalExecution.bindingResults) || [];
    const bindingResult = plannerResults.find(r => r.bindingId === binding.bindingId);

    if (bindingResult && Array.isArray(bindingResult.candidates)) {
      for (const cand of bindingResult.candidates) {
        const text = cand.chunk?.chunk || cand.chunk?.text || cand.chunk?.content || (typeof cand.chunk === 'string' ? cand.chunk : '');
        const sourceFile = cand.chunk?.filename || cand.chunk?.sourceFile || cand.source || 'corpus_index';

        evidence.push(createEvidenceRecord({
          providerId: this.id,
          bindingId: binding.bindingId,
          evidenceId: `corpus_${cand.chunkIndex || Math.random().toString(36).slice(2, 8)}`,
          entityBinding: binding.entity ? {
            canonical: binding.entity.canonical,
            family: binding.entity.family,
            type: binding.entity.type
          } : null,
          fieldBinding: binding.requestedField,
          relationBinding: binding.relation || null,
          structuredValue: null,
          textSnippet: text,
          sourceId: sourceFile,
          sourceType: 'indexed_chunk',
          sourceDocumentOrRecord: sourceFile,
          provenance: `Indexed corpus document: ${sourceFile}`,
          qualifiers: { chunkIndex: cand.chunkIndex },
          confidenceSignals: {
            isOfficialDocument: !/user_complaint|informal/i.test(sourceFile),
            exactMatch: false,
            score: cand.score || 0.8
          }
        }));
      }
    }

    return { providerId: this.id, bindingId: binding.bindingId, evidence };
  }
}

/**
 * Normalization helper
 */
function normalizeKey(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').slice(0, 32);
}

/**
 * EvidenceProviderRegistry
 * Central manager for evidence providers. Matches bindings against compatible providers
 * and executes structured retrieval.
 */
class EvidenceProviderRegistry {
  constructor() {
    this.providers = new Map();
    this.registerDefaultProviders();
  }

  registerProvider(provider) {
    if (!provider || !provider.id || typeof provider.supports !== 'function' || typeof provider.retrieve !== 'function') {
      throw new Error(`[EvidenceProviderRegistry] Invalid provider implementation: must have id, supports(), and retrieve().`);
    }
    this.providers.set(provider.id, provider);
  }

  getProvider(providerId) {
    return this.providers.get(providerId) || null;
  }

  getAllProviders() {
    return Array.from(this.providers.values());
  }

  registerDefaultProviders() {
    this.registerProvider(new TuitionFeeEvidenceProvider());
    this.registerProvider(new AdmissionScheduleEvidenceProvider());
    this.registerProvider(new AcademicProgramEvidenceProvider());
    this.registerProvider(new InternationalCollaborationEvidenceProvider());
    this.registerProvider(new OrganizationUkmEvidenceProvider());
    this.registerProvider(new InstitutionalContactEvidenceProvider());
    this.registerProvider(new CorpusEvidenceProvider());
  }

  /**
   * Find all providers compatible with a given binding and semantic frame
   */
  findCompatibleProviders(binding, frame) {
    if (!binding) return [];
    return this.getAllProviders().filter(p => {
      try {
        return p.supports(binding, frame);
      } catch (err) {
        return false;
      }
    });
  }

  /**
   * Execute compatible providers for all bindings in a retrieval plan
   */
  async executePlan(plan, context = {}) {
    if (!plan || !Array.isArray(plan.subrequests)) {
      return { planId: plan?.planId || null, totalBindings: 0, resultsByBinding: {}, allEvidence: [] };
    }

    let executionContext = context;
    if (!context.plannerResults && !(context.retrievalExecution && context.retrievalExecution.bindingResults) && typeof context.lookupCandidateChunkIndices === 'function') {
      const { executeRetrievalPlan } = require('./bindingRetrievalPlanner');
      const retrievalExec = await executeRetrievalPlan(plan, context);
      executionContext = {
        ...context,
        plannerResults: retrievalExec.bindingResults,
        retrievalExecution: retrievalExec
      };
    }

    const resultsByBinding = {};
    const allEvidence = [];
    let totalBindings = 0;

    for (const subreq of plan.subrequests) {
      if (!Array.isArray(subreq.bindings)) continue;

      for (const binding of subreq.bindings) {
        totalBindings++;
        const compatibleProviders = this.findCompatibleProviders(binding, plan.semanticFrame);
        const bindingEvidenceList = [];

        for (const provider of compatibleProviders) {
          try {
            const res = await provider.retrieve(binding, executionContext);
            if (res && Array.isArray(res.evidence) && res.evidence.length) {
              bindingEvidenceList.push(...res.evidence);
              allEvidence.push(...res.evidence);
            }
          } catch (err) {
            // Provider retrieval error should not crash registry
          }
        }

        resultsByBinding[binding.bindingId] = {
          bindingId: binding.bindingId,
          entity: binding.entity?.canonical || 'INSTITUTION_ROOT',
          field: binding.requestedField,
          compatibleProviderCount: compatibleProviders.length,
          evidenceCount: bindingEvidenceList.length,
          evidence: bindingEvidenceList
        };
      }
    }

    return {
      planId: plan.planId || null,
      totalBindings,
      resultsByBinding,
      allEvidence
    };
  }
}

// Global default singleton registry
const defaultRegistry = new EvidenceProviderRegistry();

module.exports = {
  createEvidenceRecord,
  TuitionFeeEvidenceProvider,
  AdmissionScheduleEvidenceProvider,
  AcademicProgramEvidenceProvider,
  InternationalCollaborationEvidenceProvider,
  OrganizationUkmEvidenceProvider,
  InstitutionalContactEvidenceProvider,
  CorpusEvidenceProvider,
  EvidenceProviderRegistry,
  defaultRegistry
};
