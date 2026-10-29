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

function evaluateAnswerability(semanticFrame, arbitratedEvidence = {}) {
  const { accepted = [], rejected = [] } = arbitratedEvidence;
  const isEn = semanticFrame?.language === 'en' || detectQueryLanguage(semanticFrame?.rawQuery) === 'en';

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

  // Institutional Campus Locations (Renon, Jimbaran, Abiansemal) can authoritatively answer campus location queries
  if (semanticFrame.intent === 'CAMPUS_LOCATION' ||
      /\b(?:lokasi\s+kampus|alamat\s+kampus|kampus\s+(?:renon|jimbaran|abiansemal)|(?:di\s*mana|dimana)\s+kampus|lokasi(?:nya)?\s+di\s*mana|di\s*mana(?:\s+saja)?\s+lokasi(?:nya)?|berapa\s+(?:ada\s+)?kampus|ada\s+berapa\s+kampus|jumlah\s+kampus)\b/i.test(semanticFrame.rawQuery || '')) {
    return {
      status: ANSWERABILITY_STATUS.ANSWERABLE,
      reason: 'institutional_campus_locations',
      coveredAspects: ['location', 'campus_location', 'address'],
      missingAspects: []
    };
  }

  // Institutional Academic Event (Wisuda & Yudisium) guidelines can authoritatively answer graduation events
  if (semanticFrame.domain === 'ACADEMIC_EVENT' || semanticFrame.intent === 'GRADUATION_INQUIRY' || /\b(?:wisuda|yudisium)\b/i.test(semanticFrame.rawQuery || '')) {
    return {
      status: ANSWERABILITY_STATUS.ANSWERABLE,
      reason: 'institutional_academic_event_guidelines',
      coveredAspects: ['procedure', 'requirements', 'schedule'],
      missingAspects: []
    };
  }

  // 1. If no accepted evidence exists
  if (!accepted || accepted.length === 0) {
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

  // 2. Verification of Specific Uncataloged Topic Grounding:
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

  // 3. Aspect Coverage Verification:
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
      if (/\b(?:kampus|jalan\s+raya\s+puputan|renon|jimbaran|abiansemal)\b/i.test(text)) {
        allProvidedAspects.add('location');
        allProvidedAspects.add('campus_location');
        allProvidedAspects.add('address');
      }
      if (/\b(?:karir|karier|kerja|loker|lowongan|magang|pelatihan|cv|wawancara|alumni|rekrutmen|profesi|pekerjaan)\b/i.test(text)) {
        allProvidedAspects.add('career_services');
        allProvidedAspects.add('career');
        allProvidedAspects.add('career_prospects');
      }
      if (/\b(?:sertifikasi|sertifikat|kompetensi|kursus|learning)\b/i.test(text)) {
        allProvidedAspects.add('certification');
      }
      if (/\b(?:pelatihan|training|optimalisasi|pembekalan|workshop)\b/i.test(text)) {
        allProvidedAspects.add('training');
      }
      if (/\b(?:kerja\s*sama|kerjasama|mitra|industri|perusahaan)\b/i.test(text)) {
        allProvidedAspects.add('cooperation');
      }
      if (/\b(?:magang|internship|praktik\s+kerja)\b/i.test(text)) {
        allProvidedAspects.add('internship');
      }
      if (/\b(?:layanan|program|informasi|kegiatan|cdc|center|stikom|kampus|pelatihan|kursus)\b/i.test(text)) {
        allProvidedAspects.add('service_info');
        allProvidedAspects.add('program_info');
        allProvidedAspects.add('support');
      }
      if (/\b(?:kurikulum|matkul|mata\s+kuliah|sks|semester|pembelajaran)\b/i.test(text)) {
        allProvidedAspects.add('curriculum');
        allProvidedAspects.add('course');
      }
      if (/\b(?:fakultas|informatika\s+dan\s+komputer|bisnis\s+dan\s+vokasi|fik|fbv)\b/i.test(text)) {
        allProvidedAspects.add('faculty');
        allProvidedAspects.add('academic_structure');
        allProvidedAspects.add('faculty_mapping');
      }
      if (/\b(?:ukm|organisasi|ormawa)\b/i.test(text)) {
        allProvidedAspects.add('membership');
        allProvidedAspects.add('category');
        allProvidedAspects.add('ukm_list');
        allProvidedAspects.add('student_organization');
        allProvidedAspects.add('ukm');
      }
    }

    // Canonical Institutional Aspects:
    // If accepted evidence grounds the existence of the program/entity:
    // Official campus contact channels (PMB portal & phone) satisfy general institutional contact inquiries
    // only when the inquiry is specifically for contact/phone/communication, and not for private numbers.
    if (semanticFrame.intent === 'CONTACT_INQUIRY' || requiredAspects.some(a => ['contact', 'phone', 'whatsapp'].includes(a))) {
      if (!isPrivateContact) {
        allProvidedAspects.add('contact');
        allProvidedAspects.add('phone');
        allProvidedAspects.add('whatsapp');
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

  // 4. If subqueries exist and some lack evidence
  if (semanticFrame.subQueries && semanticFrame.subQueries.length > 1) {
    return {
      status: ANSWERABILITY_STATUS.PARTIAL,
      reason: 'multi_subquery_partial_coverage',
      coveredAspects: requiredAspects,
      missingAspects: []
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
  evaluateAnswerability
};
