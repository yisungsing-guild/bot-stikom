'use strict';

/**
 * src/core/answerabilityGate.js
 * 
 * Greenfield Answerability Gate.
 * Evaluates whether retrieved & arbitrated evidence is sufficient to answer the SemanticFrame.
 * 
 * Invariants:
 * - contexts.length > 0 DOES NOT imply ANSWERABLE.
 * - If accepted evidence is empty -> UNKNOWN or ESCALATE.
 * - Does not invent facts.
 */

const { detectQueryLanguage } = require('../utils/languageDetector');

const ANSWERABILITY_STATUS = Object.freeze({
  ANSWERABLE: 'ANSWERABLE',
  PARTIAL: 'PARTIAL',
  UNKNOWN: 'UNKNOWN',
  CLARIFY: 'CLARIFY',
  ESCALATE: 'ESCALATE'
});

/**
 * Strips boilerplate prompt template headers from ingestion/OCR artifacts.
 */
function stripIngestionBoilerplate(text = '') {
  return text
    .replace(/(?:Ringkasan dokumen|Program internasional\s*\/\s*kerja\s*sama internasional|Jadwal\/gelombang|Potongan\s*\/\s*beasiswa|Program studi terlihat)\s*:[^\n]*/gi, '')
    .trim();
}

/**
 * Extracts target entity terms from semanticFrame.
 */
function extractEntityTerms(semanticFrame) {
  const terms = [];
  if (Array.isArray(semanticFrame?.targetEntities)) {
    for (const t of semanticFrame.targetEntities) {
      if (typeof t === 'string' && t.trim()) terms.push(t.trim());
    }
  }
  if (Array.isArray(semanticFrame?.entities)) {
    for (const e of semanticFrame.entities) {
      if (e?.name && typeof e.name === 'string') terms.push(e.name.trim());
      if (e?.canonical && typeof e.canonical === 'string') terms.push(e.canonical.trim());
    }
  }
  return [...new Set(terms.filter(t => t.length > 2))];
}

/**
 * Gathers relevant evidence text segments for the inquiry.
 * If entity terms exist, segments from multi-question chunks must be topically related to the entity.
 */
function getTopicalEvidenceSegments(acceptedCandidates = [], entityTerms = []) {
  const segments = [];
  const entityRegex = entityTerms.length > 0
    ? new RegExp(`\\b(?:${entityTerms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i')
    : null;

  for (const c of acceptedCandidates) {
    const raw = (c.chunk || c.text || '');
    const cleaned = stripIngestionBoilerplate(raw);
    if (!cleaned) continue;

    if (/(?:(?:^|\n)\s*(?:\d+[\.\)]|Jawaban\s*:))/i.test(cleaned)) {
      const sections = cleaned.split(/(?=(?:^|\n)\s*(?:\d+[\.\)]|Jawaban\s*:))/i);
      for (const sec of sections) {
        const trimmed = sec.trim();
        if (!trimmed) continue;
        if (!entityRegex || entityRegex.test(trimmed)) {
          segments.push(trimmed);
        }
      }
    } else {
      if (!entityRegex || entityRegex.test(cleaned)) {
        segments.push(cleaned);
      }
    }
  }

  return segments.length > 0 ? segments : acceptedCandidates.map(c => stripIngestionBoilerplate(c.chunk || c.text || '')).filter(Boolean);
}

function detectEvidenceFacets(acceptedCandidates = [], semanticFrame = null) {
  const facets = [];
  const entityTerms = extractEntityTerms(semanticFrame);
  const relevantSegments = getTopicalEvidenceSegments(acceptedCandidates, entityTerms);
  const combinedText = relevantSegments.join('\n');

  if (!combinedText.trim()) return facets;

  // 1. Certification / Course Program Facet
  const hasCertProgram = /\b(?:program\s+sertifikasi|sertifikasi\s+(?:profesional|kompetensi|internasional)|memperoleh\s+sertifikasi|ujian\s+sertifikasi|kursus\s+(?:online|daring|pelatihan)|(?:linkedin|cisco|oracle|microsoft|google)\s+learning)\b/i.test(combinedText);
  if (hasCertProgram) {
    facets.push({ key: 'certification', label: 'program sertifikasi', option: 'sertifikasi' });
  }

  // 2. Training / Skill Development Facet
  const hasTrainingProgram = /\b(?:program\s+pelatihan|pelatihan\s+(?:oleh\s+career\s+center|karier|karir|kerja|soft\s*skills?|profil|wawancara|cv)|workshop|pembekalan\s+(?:karier|karir|kerja)|optimalisasi\s+(?:profil|linkedin)|persiapan\s+wawancara\s+kerja)\b/i.test(combinedText);
  if (hasTrainingProgram) {
    const isCareerCenter = /\b(?:career\s*center|cdc)\b/i.test(combinedText);
    facets.push({
      key: 'training',
      label: isCareerCenter ? 'pelatihan oleh Career Center' : 'program pelatihan',
      option: 'pelatihan'
    });
  }

  // 3. Institutional Cooperation / Partnership Facet
  const hasCooperation = /\b(?:program\s+kerja\s*sama|kerja\s*sama\s+(?:resmi|kemitraan|kampus|industri|perusahaan|kelembagaan)|kemitraan\s+strategis|penandatanganan\s+mou|perjanjian\s+kerja\s*sama|mou\s+kemitraan)\b/i.test(combinedText);
  if (hasCooperation) {
    facets.push({ key: 'cooperation', label: 'kerja sama kampus', option: 'kerja sama' });
  }

  // 4. Internship Program Facet
  const hasInternship = /\b(?:program\s+magang|magang\s+(?:industri|bersertifikat|merdeka|mandiri|kerja)|internship\s+program|penyaluran\s+kerja|campus\s+hiring)\b/i.test(combinedText);
  if (hasInternship) {
    facets.push({ key: 'internship', label: 'program magang', option: 'magang' });
  }

  // 5. Business Incubation Facet
  const hasIncubation = /\b(?:inkubasi\s+bisnis|inbis|program\s+inkubasi|startup\s+incubator|tenant\s+(?:inbis|bisnis|startup)|wirausaha\s+mahasiswa)\b/i.test(combinedText);
  if (hasIncubation) {
    facets.push({ key: 'incubation', label: 'inkubasi bisnis dan startup', option: 'inkubasi' });
  }

  return facets;
}

function evaluateAnswerability(semanticFrame, arbitratedEvidence = {}) {
  const { accepted = [], rejected = [] } = arbitratedEvidence;
  const isEn = semanticFrame?.language === 'en' || detectQueryLanguage(semanticFrame?.rawQuery) === 'en';

  // 0. Technical Failure Fail-Closed: Corpus Unavailable
  if (arbitratedEvidence.corpusUnavailable) {
    return {
      status: ANSWERABILITY_STATUS.UNKNOWN,
      reason: 'corpus_unavailable_technical_failure',
      isTechnicalFailure: true,
      guidance: isEn
        ? 'We apologize, but official information regarding this matter is not listed in the accessible guidelines at this time due to a technical issue. Please try again shortly or contact the ITB STIKOM Bali information desk.'
        : 'Informasi resmi mengenai hal tersebut belum tercantum dalam panduan yang dapat diakses saat ini karena kendala teknis pada sistem informasi. Silakan coba beberapa saat lagi atau hubungi bagian informasi kampus ITB STIKOM Bali.'
    };
  }

  // 0b. Evidence-Grounded Dynamic Ambiguity Clarification Gate
  // Evaluates whether the user's broad question has multiple verified interpretations in official evidence.
  // Clarification is NOT assumed beforehand; it is triggered only if:
  // 1. Session has not already clarified this question (prevents infinite loops)
  // 2. Query is broad/underspecified without a narrow aspect requested
  // 3. Official retrieved evidence contains 2 or more distinct verified facets
  const alreadyClarified = Boolean(
    arbitratedEvidence?.sessionData?.clarificationTurnCount >= 1 ||
    arbitratedEvidence?.sessionData?.pendingClarification
  );

  const frameRawQuery = semanticFrame?.rawQuery || '';
  const isNarrowAspectQuery = /\b(?:biaya|berapa|bayar|jadwal|kapan|syarat|persyaratan|cara|prosedur|fakultas|jurusan)\b/i.test(frameRawQuery);

  if (!alreadyClarified && (semanticFrame?.isBroadInquiry || (semanticFrame?.requiresClarification && !isNarrowAspectQuery)) && accepted && accepted.length > 0) {
    const facets = detectEvidenceFacets(accepted, semanticFrame);
    if (facets.length >= 2) {
      const labels = facets.map(f => f.label);
      const formattedOptions = labels.length === 2
        ? `${labels[0]} atau ${labels[1]}`
        : `${labels.slice(0, -1).join(', ')}, atau ${labels[labels.length - 1]}`;

      const entityName = (semanticFrame.targetEntities && semanticFrame.targetEntities[0])
        ? ` terkait ${semanticFrame.targetEntities[0]}`
        : '';

      const prompt = `Maksud Kakak ${formattedOptions}${entityName}?`;

      return {
        status: ANSWERABILITY_STATUS.CLARIFY,
        reason: 'multiple_evidence_interpretations',
        guidance: prompt,
        options: facets.map(f => f.option)
      };
    }
  }

  // Fallback if semanticFrame explicitly set requiresClarification
  if (semanticFrame?.requiresClarification && semanticFrame?.clarificationPrompt) {
    return {
      status: ANSWERABILITY_STATUS.CLARIFY,
      reason: semanticFrame.clarificationReason || 'ambiguous_inquiry',
      guidance: semanticFrame.clarificationPrompt,
      options: semanticFrame.clarificationOptions || []
    };
  }

  // 1. If no accepted evidence exists
  if (!accepted || accepted.length === 0) {
    // Institutional Academic Catalog can authoritatively answer faculty mapping
    if (semanticFrame.intent === 'FACULTY_INQUIRY') {
      const { resolveFaculty, getFacultyForProgram } = require('./academicCatalog');
      const rawQ = semanticFrame.rawQuery || '';
      const isAmbiguousTeknologi = /\bteknologi\b/i.test(rawQ) &&
        !/\b(?:teknologi\s+informasi|ti)\b/i.test(rawQ) &&
        /\b(?:masuk|fakultas|jurusan|prodi|bagian|bernaung|di\s+bawah)\b/i.test(rawQ);
      const targetProgram = (semanticFrame.entities || []).find(e => e.family === 'academic_program' || e.type === 'program');
      const progFaculty = targetProgram ? getFacultyForProgram(targetProgram.canonical || targetProgram.name) : null;
      const resolvedFac = resolveFaculty(rawQ);
      if (progFaculty || (resolvedFac && resolvedFac.canonical) || isAmbiguousTeknologi || /\b(?:fik|fbv|infokom|bisvo)\b/i.test(rawQ)) {
        return {
          status: ANSWERABILITY_STATUS.ANSWERABLE,
          reason: 'institutional_academic_catalog',
          coveredAspects: ['faculty', 'academic_structure'],
          missingAspects: []
        };
      }
    }

    // If user query represents a missed academic process or complaint -> ESCALATE to admin/academic staff
    if (semanticFrame.intent === 'MISSED_ACADEMIC_PROCESS' || semanticFrame.userState === 'LATE') {
      return {
        status: ANSWERABILITY_STATUS.ESCALATE,
        reason: 'missed_process_requires_staff_assistance',
        guidance: isEn
          ? 'Please contact the Academic Administration Bureau (BAAK) or your academic advisor regarding late enrollment/advising.'
          : 'Mohon hubungi bagian Bagian Akademik (BAAK) atau dosen wali untuk penanganan keterlambatan perwalian.'
      };
    }

    if (semanticFrame.domain === 'ORGANIZATION_UKM' || (semanticFrame.aspects && semanticFrame.aspects.some(a => ['student_organization', 'ukm'].includes(a)))) {
      return {
        status: ANSWERABILITY_STATUS.UNKNOWN,
        reason: 'insufficient_ukm_evidence',
        guidance: isEn
          ? 'Official information regarding the requested student club or activity has not been verified from the available campus records.'
          : 'Informasi resmi mengenai Unit Kegiatan Mahasiswa (UKM) atau kegiatan tersebut belum berhasil diverifikasi dari sumber resmi kampus yang tersedia saat ini.'
      };
    }

    if (semanticFrame.domain === 'TUITION_FEE' || (semanticFrame.aspects && semanticFrame.aspects.some(a => ['fee', 'tuition', 'dpp'].includes(a)))) {
      const isFacilityOrInfrastructure = semanticFrame.domain === 'FACILITIES' ||
        (semanticFrame.aspects && semanticFrame.aspects.some(a => ['facilities', 'campus_infrastructure'].includes(a))) ||
        (semanticFrame.entities && semanticFrame.entities.some(e => ['campus_facility', 'facility'].includes(e.family || e.type))) ||
        /\b(?:parkir|parking)\b/i.test(semanticFrame.rawQuery || '');
      if (isFacilityOrInfrastructure) {
        return {
          status: ANSWERABILITY_STATUS.UNKNOWN,
          reason: 'insufficient_facility_fee_evidence',
          guidance: isEn
            ? 'Official information regarding parking or facility fees is not listed in the available guidelines.'
            : 'Informasi resmi mengenai tarif atau biaya fasilitas tersebut belum tercantum secara lengkap dalam panduan yang tersedia.'
        };
      }
      return {
        status: ANSWERABILITY_STATUS.UNKNOWN,
        reason: 'insufficient_fee_evidence',
        guidance: isEn
          ? 'Official information regarding tuition fee details for that study program is not fully listed in the available guide.'
          : 'Informasi resmi mengenai rincian biaya kuliah untuk program studi tersebut belum tercantum secara lengkap dalam panduan yang tersedia.'
      };
    }

    // Check for private contact inquiries (e.g. personal WA/phone of rector, kaprodi)
    const isPrivateContact = /\b(nomor\s+pribadi|wa\s+pribadi|whatsapp\s+pribadi|nomor\s+hp|kontak\s+pribadi|private\s+contact|personal\s+number)\b/i.test(semanticFrame.rawQuery || '');
    if (isPrivateContact) {
      return {
        status: ANSWERABILITY_STATUS.UNKNOWN,
        reason: 'corpus_gap',
        guidance: isEn
          ? 'We apologize, but personal contact numbers are not published in official guidelines. Please contact the official university offices or public relations.'
          : 'Mohon maaf, nomor kontak pribadi tidak dipublikasikan dalam panduan resmi. Silakan menghubungi saluran resmi kampus atau humas ITB STIKOM Bali.'
      };
    }

    // Default when no evidence proves the question
    return {
      status: ANSWERABILITY_STATUS.UNKNOWN,
      reason: 'corpus_gap',
      guidance: isEn
        ? 'Official information regarding this matter is not fully listed in the available guidelines.'
        : 'Informasi resmi terkait hal ini belum tercantum secara lengkap dalam panduan yang tersedia.'
    };
  }

  // 2. Aspect Coverage Verification:
  let requiredAspects = (semanticFrame.aspects || []).filter(a => a !== 'general');
  if (semanticFrame.intent === 'ORGANIZATION_MEMBERSHIP_CHECK') {
    // In membership verification, the category aspect being questioned is the hypothesis under test, not an evidence requirement
    requiredAspects = requiredAspects.filter(a => !['arts_culture', 'sports', 'reasoning_tech', 'religious'].includes(a));
  }
  if (requiredAspects.length > 0) {
    const allProvidedAspects = new Set();
    for (const chunk of accepted) {
      if (Array.isArray(chunk.providedAspects)) {
        chunk.providedAspects.forEach(a => allProvidedAspects.add(a));
      }
      const text = (chunk.text || '').toLowerCase();
      if (/\b(?:alur\s+pendaftaran|prosedur\s+pendaftaran|tahapan\s+pendaftaran|cara\s+mendaftar|pendaftaran\s+online|pmb\.stikom-bali\.ac\.id)\b/i.test(text)) {
        allProvidedAspects.add('procedure');
        allProvidedAspects.add('admission');
      }
      if (/\b(?:syarat|persyaratan|ijazah|berkas\s+pendaftaran|kelengkapan\s+dokumen)\b/i.test(text)) {
        allProvidedAspects.add('requirements');
      }
    }

    // Fallback: If metadata tags were missing but accepted evidence text contains the required content
    const combinedAcceptedText = accepted.map(c => c.text || c.chunk || '').join(' ').toLowerCase();
    for (const req of requiredAspects) {
      if (!allProvidedAspects.has(req)) {
        if (['location', 'campus_location', 'address'].includes(req) &&
            /\b(?:kampus|jalan\s+raya\s+puputan|renon|jimbaran|abiansemal)\b/i.test(combinedAcceptedText)) {
          allProvidedAspects.add(req);
        } else if (['faculty', 'academic_structure', 'faculty_mapping'].includes(req) &&
            /\b(?:fakultas|informatika\s+dan\s+komputer|bisnis\s+dan\s+vokasi|fik|fbv)\b/i.test(combinedAcceptedText)) {
          allProvidedAspects.add(req);
        } else if (['membership', 'category', 'ukm_list', 'student_organization', 'ukm'].includes(req) &&
            /\b(?:ukm|organisasi|ormawa)\b/i.test(combinedAcceptedText)) {
          allProvidedAspects.add(req);
        } else if (['career_services', 'career', 'career_prospects'].includes(req) &&
            /\b(?:karir|karier|kerja|loker|lowongan|magang|pelatihan|cv|wawancara|alumni|rekrutmen|profesi|pekerjaan)\b/i.test(combinedAcceptedText)) {
          allProvidedAspects.add(req);
        } else if (['certification'].includes(req) &&
            /\b(?:sertifikasi|sertifikat|kompetensi|kursus|learning)\b/i.test(combinedAcceptedText)) {
          allProvidedAspects.add(req);
        } else if (['training'].includes(req) &&
            /\b(?:pelatihan|training|optimalisasi|pembekalan|workshop)\b/i.test(combinedAcceptedText)) {
          allProvidedAspects.add(req);
        } else if (['cooperation'].includes(req) &&
            /\b(?:kerja\s*sama|kerjasama|mitra|industri|perusahaan)\b/i.test(combinedAcceptedText)) {
          allProvidedAspects.add(req);
        } else if (['internship'].includes(req) &&
            /\b(?:magang|internship|praktik\s+kerja)\b/i.test(combinedAcceptedText)) {
          allProvidedAspects.add(req);
        } else if (['service_info', 'program_info', 'support'].includes(req) &&
            /\b(?:layanan|program|informasi|kegiatan|cdc|center|stikom|kampus|pelatihan|kursus)\b/i.test(combinedAcceptedText)) {
          allProvidedAspects.add(req);
        } else if (['curriculum', 'course'].includes(req) &&
            /\b(?:kurikulum|matkul|mata\s+kuliah|sks|semester|pembelajaran)\b/i.test(combinedAcceptedText)) {
          allProvidedAspects.add(req);
        } else if (['requirements', 'procedure'].includes(req) &&
            /\b(?:syarat|persyaratan|berkas|dokumen|alur|prosedur|cara|daftar)\b/i.test(combinedAcceptedText)) {
          allProvidedAspects.add(req);
        }
      }
    }

    const coveredAspects = requiredAspects.filter(req => allProvidedAspects.has(req));
    const missingAspects = requiredAspects.filter(req => !allProvidedAspects.has(req));

    if (coveredAspects.length === 0) {
      if (semanticFrame.domain === 'TUITION_FEE' || requiredAspects.some(a => ['fee', 'tuition', 'dpp'].includes(a))) {
        return {
          status: ANSWERABILITY_STATUS.UNKNOWN,
          reason: 'insufficient_fee_aspect_coverage',
          coveredAspects: [],
          missingAspects: requiredAspects,
          guidance: isEn
            ? 'Official information regarding tuition fee details for that study program is not fully listed in the available guide.'
            : 'Informasi resmi mengenai rincian biaya kuliah untuk program studi tersebut belum tercantum secara lengkap dalam panduan yang tersedia.'
        };
      }
      return {
        status: ANSWERABILITY_STATUS.UNKNOWN,
        reason: 'insufficient_aspect_evidence',
        coveredAspects: [],
        missingAspects: requiredAspects,
        guidance: isEn
          ? 'Official information regarding that aspect is not fully listed in the available guidelines.'
          : 'Informasi resmi terkait aspek tersebut belum tercantum secara lengkap dalam panduan yang tersedia.'
      };
    }

    if (missingAspects.length > 0 && coveredAspects.length > 0) {
      return {
        status: ANSWERABILITY_STATUS.PARTIAL,
        reason: 'partial_aspect_coverage',
        coveredAspects,
        missingAspects,
        guidance: isEn
          ? `Information regarding ${missingAspects.join(', ')} is not fully listed in the available guidelines.`
          : `Informasi terkait ${missingAspects.join(', ')} belum tercantum secara lengkap dalam panduan yang tersedia.`
      };
    }
  }

  // 3. If subqueries exist and some lack evidence
  if (semanticFrame.subQueries && semanticFrame.subQueries.length > 1) {
    return {
      status: ANSWERABILITY_STATUS.PARTIAL,
      reason: 'multi_subquery_partial_coverage',
      coveredAspects: requiredAspects,
      missingAspects: []
    };
  }

  // 4. Verification of Specific Uncataloged Topic Grounding:
  // If query asks for specific uncataloged topics (private contact, parking fees, canteen menu, shuttle bus),
  // the accepted evidence must explicitly mention the specific inquiry topic, rather than generic campus FAQ.
  const rawQ = String(semanticFrame.rawQuery || '').toLowerCase();
  const isPrivateContact = /\b(?:nomor\s+)?(?:wa|whatsapp|hp|handphone|telepon|telp|kontak)\s+pribadi\b|\b(?:nomor\s+pribadi|kontak\s+pribadi)\b/i.test(rawQ);
  const isParkingFee = /\b(parkir(?:\s+inap)?|tarif\s+parkir|parking|parking\s+(?:fee|rate|subscription))\b/i.test(rawQ);
  const isCanteenMenu = /\b(kantin|menu\s+makanan|katering)\b/i.test(rawQ);
  const isShuttleBus = /\b(bus\s+shuttle|shuttle\s+bus)\b/i.test(rawQ);
  const isSpecificExternalScholarship = /\b(pemda|pemerintah\s+daerah|provinsi\s+papua|beasiswa\s+pemda)\b/i.test(rawQ);

  const combinedEvidenceText = accepted.map(c => c.text || c.chunk || '').join(' ').toLowerCase();

  if (isPrivateContact && !/\b(?:nomor|kontak|wa|hp)\s+pribadi\b/i.test(combinedEvidenceText)) {
    return {
      status: ANSWERABILITY_STATUS.UNKNOWN,
      reason: 'corpus_gap_private_contact_not_published',
      coveredAspects: [],
      missingAspects: ['private_contact'],
      guidance: 'Mohon maaf, nomor kontak pribadi tidak tercantum dalam panduan resmi yang tersedia. Silakan menghubungi saluran kontak resmi kampus.'
    };
  }

  if (isParkingFee && !/\b(parkir|tarif\s+parkir|parking)\b/i.test(combinedEvidenceText)) {
    const isEn = semanticFrame.language === 'en';
    return {
      status: ANSWERABILITY_STATUS.UNKNOWN,
      reason: 'corpus_gap_parking_fee_unrecorded',
      coveredAspects: [],
      missingAspects: ['parking_fee'],
      guidance: isEn
        ? 'Official information regarding annual student car parking subscriptions is currently not listed in the available campus guidelines. Please confirm directly with campus administration.'
        : 'Informasi resmi mengenai tarif parkir inap kendaraan belum tercantum secara lengkap dalam panduan yang tersedia.'
    };
  }

  if (isCanteenMenu && !/\b(kantin|menu|katering)\b/i.test(combinedEvidenceText)) {
    return {
      status: ANSWERABILITY_STATUS.UNKNOWN,
      reason: 'corpus_gap_canteen_menu_unrecorded',
      coveredAspects: [],
      missingAspects: ['canteen_menu'],
      guidance: 'Informasi mengenai menu makanan dan tarif katering kantin belum tercantum dalam dokumen resmi yang tersedia.'
    };
  }

  if (isShuttleBus && !/\b(shuttle|bus\s+shuttle)\b/i.test(combinedEvidenceText)) {
    return {
      status: ANSWERABILITY_STATUS.UNKNOWN,
      reason: 'corpus_gap_shuttle_bus_unrecorded',
      coveredAspects: [],
      missingAspects: ['shuttle_schedule'],
      guidance: 'Jadwal dan informasi bus shuttle antar kampus belum tercantum dalam panduan resmi yang tersedia.'
    };
  }

  if (isSpecificExternalScholarship && !/\b(papua|pemda)\b/i.test(combinedEvidenceText)) {
    return {
      status: ANSWERABILITY_STATUS.UNKNOWN,
      reason: 'corpus_gap_external_scholarship_unrecorded',
      coveredAspects: [],
      missingAspects: ['regional_scholarship'],
      guidance: 'Informasi resmi terkait program beasiswa khusus dari Pemerintah Daerah tersebut belum tercantum dalam dokumen resmi yang tersedia.'
    };
  }

  // 5. Fully supported
  return {
    status: ANSWERABILITY_STATUS.ANSWERABLE,
    reason: 'sufficient_supported_evidence',
    coveredAspects: requiredAspects,
    missingAspects: []
  };
}

module.exports = {
  ANSWERABILITY_STATUS,
  evaluateAnswerability,
  detectEvidenceFacets
};
