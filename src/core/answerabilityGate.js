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

  // 1. If no accepted evidence exists
  if (!accepted || accepted.length === 0) {
    // Institutional academic catalog inquiries are grounded in institutional catalog
    if (semanticFrame.intent === 'AVAILABLE_PROGRAMS_LIST') {
      return {
        status: ANSWERABILITY_STATUS.ANSWERABLE,
        reason: 'institutional_academic_catalog'
      };
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

    const isScholarship = semanticFrame.domain === 'SCHOLARSHIP' ||
      semanticFrame.intent === 'SCHOLARSHIP_INQUIRY' ||
      (semanticFrame.entities && semanticFrame.entities.some(e => e.family === 'scholarship'));

    if (!isScholarship && (semanticFrame.domain === 'TUITION_FEE' || (semanticFrame.aspects && semanticFrame.aspects.some(a => ['fee', 'tuition', 'dpp'].includes(a))))) {
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
  // Accepted evidence must cover at least one required aspect if specific aspects are requested
  const requiredAspects = (semanticFrame.aspects || []).filter(a => a !== 'general');
  if (requiredAspects.length > 0) {
    const allProvidedAspects = new Set();
    for (const chunk of accepted) {
      if (Array.isArray(chunk.providedAspects)) {
        chunk.providedAspects.forEach(a => allProvidedAspects.add(a));
      }
    }

    const combinedEvidenceText = accepted.map(c => c.text || c.chunk || '').join(' ').toLowerCase();
    const isAspectCovered = (req) => {
      if (allProvidedAspects.has(req)) return true;
      if (req === 'location' || req === 'study_location' || req === 'campus_location') {
        return /\b(lokasi|tempat|kampus|alamat|gedung|ruang|china|dalian|neusoft|malaysia|luar\s+negeri|dalam\s+negeri|onsite|online|daring|luring|jalan|jl\.|denpasar|renon|jimbaran|full\s+di\s+stikom)\b/i.test(combinedEvidenceText);
      }
      if (req === 'duration' || req === 'study_duration' || req === 'schedule' || req === 'timeline') {
        return /\b(durasi|masa\s+studi|tahun\s+\d|\d\s+tahun|\d\s+semester|semester\s+\d|jadwal|gelombang|periode|waktu|proses|terbit|minggu|bulan|hari)\b/i.test(combinedEvidenceText);
      }
      if (req === 'career' || req === 'career_prospects') {
        return /\b(karir|karier|prospek|peluang\s+kerja|profesi|pekerjaan)\b/i.test(combinedEvidenceText);
      }
      if (req === 'curriculum' || req === 'courses') {
        return /\b(kurikulum|mata\s*kuliah|matkul|sks|praktikum)\b/i.test(combinedEvidenceText);
      }
      if (req === 'accreditation' || req === 'akreditasi' || req === 'peringkat' || req === 'sk_akreditasi') {
        return /\b(akreditasi|terakreditasi|peringkat|unggul|baik|ban-pt|lam-infokom|sk|nomor)\b/i.test(combinedEvidenceText);
      }
      if (req === 'fee' || req === 'tuition') {
        return /\b(biaya|tarif|spp|dpp|uang\s+kuliah|rp\s*[\d\.]+|juta)\b/i.test(combinedEvidenceText);
      }
      if (req === 'scholarship') {
        return /\b(beasiswa|potongan|keringanan|kip)\b/i.test(combinedEvidenceText);
      }
      if (req === 'rpl' || req === 'credit_transfer' || req === 'rekognisi_pembelajaran_lampau') {
        return /\b(rpl|rekognisi\s*pembelajaran\s*lampau|transfer|konversi|pengakuan\s*sks|tipe\s*a|pengalaman\s*kerja)\b/i.test(combinedEvidenceText);
      }
      if (req === 'facilities') {
        return /\b(fasilitas|lab|laboratorium|perpustakaan|asrama|dormitory)\b/i.test(combinedEvidenceText);
      }
      if (req === 'double_degree') {
        return /\b(double\s*degree|dual\s*degree|dua\s*gelar|gelar\s*ganda)\b/i.test(combinedEvidenceText);
      }
      if (req === 'international_program') {
        return /\b(internasional|international|luar\s+negeri|dnui|help\s*university|dalian|china|malaysia)\b/i.test(combinedEvidenceText);
      }
      if (req === 'national_program') {
        // Evaluate substantively per candidate rather than stitching unrelated fragments
        return accepted.some(cand => {
          const candText = (cand.text || cand.chunk || '').toLowerCase();
          const candFile = (cand.sourceFile || cand.source || '').toLowerCase();
          // Exclude pure facility listings or accreditation certificates
          if (/fasilitas-stikom/i.test(candFile) || /akreditasi|ban-pt|lam-infokom/i.test(candFile)) {
            return false;
          }
          // Pure international documents (HELP / DNUI) alone do not satisfy national program
          const isPureInternational = /\b(?:help\s*university|dalian|neusoft|dnui)\b/i.test(candText) &&
            !/\b(?:utb|universitas\s+teknologi\s+bandung|national\s*class|kelas\s*nasional)\b/i.test(candText);
          if (isPureInternational) return false;

          // Must explicitly demonstrate national dual degree/program scope with substantive partner, degree, or track details
          const hasDualDegree = /\b(?:dual\s*degree|double\s*degree|dua\s*gelar|gelar\s*ganda)\b/i.test(candText);
          const hasNationalClass = /\b(?:national\s*class|kelas\s*nasional)\b/i.test(candText);
          const hasUtbPartner = /\b(?:utb|universitas\s+teknologi\s+bandung)\b/i.test(candText);
          const hasSubstantiveDetails = /\b(?:s\.ds|s\.kom|bandung|biaya|semester|penyelenggaraan|sarjana)\b/i.test(candText);

          return (hasDualDegree && hasNationalClass) || (hasDualDegree && hasUtbPartner && hasSubstantiveDetails);
        });
      }
      if (req === 'partnership') {
        return /\b(mitra|kerjasama|kerja\s*sama|partner|partnership|kolaborasi|mou|moa|universitas\s+teknologi\s+bandung|utb|help\s*university|dnui)\b/i.test(combinedEvidenceText);
      }
      if (req === 'organization' || req === 'student_organization') {
        return /\b(ukm|ormawa|organisasi|hima|himaprodi|ekstrakurikuler)\b/i.test(combinedEvidenceText);
      }
      if (req === 'requirements' || req === 'admission_requirements') {
        return /\b(syarat|persyaratan|berkas|dokumen|ijazah|rapor)\b/i.test(combinedEvidenceText);
      }
      if (req === 'academic_advising' || req === 'dosen_wali' || req === 'krs' || req === 'academic_process' || req === 'perwalian') {
        return /\b(perwalian|dosen\s*wali|krs|e-krs|supportperwalian|bimbingan|polling)\b/i.test(combinedEvidenceText);
      }
      if (req === 'online_learning' || req === 'learning_platform' || req === 'aplikasi_kuliah') {
        return /\b(online|daring|lms|teams|zoom|moodle|e-learning|aplikasi|platform)\b/i.test(combinedEvidenceText);
      }
      if (req === 'operational_hours' || req === 'jam_operasional') {
        return /\b(08\.00|17\.00|14\.00|jam|waktu|operasional|senin|sabtu|wita)\b/i.test(combinedEvidenceText);
      }
      if (req === 'research_focus' || req === 'fokus_riset') {
        return /\b(riset|penelitian|tesis|data\s+science|cyber\s+security|enterprise|medical)\b/i.test(combinedEvidenceText);
      }
      if (req === 'academic_support' || req === 'sion') {
        return /\b(sion|baak|dti|puskom|bantuan|kendala|portal|support)\b/i.test(combinedEvidenceText);
      }
      return false;
    };

    const coveredAspects = requiredAspects.filter(isAspectCovered);
    const missingAspects = requiredAspects.filter(req => !isAspectCovered(req));

    if (coveredAspects.length === 0) {
      const isScholarship = semanticFrame.domain === 'SCHOLARSHIP' ||
        semanticFrame.intent === 'SCHOLARSHIP_INQUIRY' ||
        (semanticFrame.entities && semanticFrame.entities.some(e => e.family === 'scholarship'));

      if (!isScholarship && (semanticFrame.domain === 'TUITION_FEE' || requiredAspects.some(a => ['fee', 'tuition', 'dpp'].includes(a)))) {
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
      if (semanticFrame.domain === 'ACADEMIC_PROCESS' || semanticFrame.intent === 'ACADEMIC_ADVISING_INQUIRY' || requiredAspects.some(a => ['academic_advising', 'dosen_wali', 'perwalian'].includes(a))) {
        return {
          status: ANSWERABILITY_STATUS.UNKNOWN,
          reason: 'insufficient_advising_aspect_evidence',
          coveredAspects: [],
          missingAspects: requiredAspects,
          guidance: isEn
            ? 'Academic advising (**perwalian**) with your Academic Advisor (Dosen Wali) is an essential academic consultation process required before the semester begins to approve course selections (KRS). Specific handling procedures or contact details for advising delays cannot be confirmed from verified official documents at this time. Please consult your Academic Advisor (Dosen Wali) directly or contact the Academic Administration Bureau (BAAK).'
            : 'Bimbingan perwalian dengan Dosen Wali di ITB STIKOM Bali merupakan proses akademik wajib sebelum perkuliahan semester baru untuk menyetujui Kartu Rencana Studi (KRS). Rincian prosedur resmi penanganan keterlambatan perwalian maupun kontak bantuan teknis belum dapat dipastikan dari dokumen resmi yang terverifikasi saat ini. Mahasiswa disarankan untuk langsung berkonsultasi dengan Dosen Wali masing-masing atau menghubungi Bagian Layanan Akademik (BAAK) ITB STIKOM Bali.'
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

  const isAdvisingInquiry = semanticFrame.domain === 'ACADEMIC_PROCESS' ||
    semanticFrame.intent === 'ACADEMIC_ADVISING_INQUIRY' ||
    /\b(?:perwalian|dosen\s*wali|bimbingan\s+perwalian|e-krs)\b/i.test(rawQ);

  if (isAdvisingInquiry && !/\b(perwalian|dosen\s*wali)\b/i.test(combinedEvidenceText)) {
    const isEn = semanticFrame.language === 'en';
    return {
      status: ANSWERABILITY_STATUS.UNKNOWN,
      reason: 'corpus_gap_academic_advising_unrecorded',
      coveredAspects: [],
      missingAspects: ['academic_advising'],
      guidance: isEn
        ? 'Academic advising (**perwalian**) with your Academic Advisor (Dosen Wali) is an essential academic consultation process required before the semester begins to approve course selections (KRS). Specific handling procedures or contact details for advising delays cannot be confirmed from verified official documents at this time. Please consult your Academic Advisor (Dosen Wali) directly or contact the Academic Administration Bureau (BAAK).'
        : 'Bimbingan perwalian dengan Dosen Wali di ITB STIKOM Bali merupakan proses akademik wajib sebelum perkuliahan semester baru untuk menyetujui Kartu Rencana Studi (KRS). Rincian prosedur resmi penanganan keterlambatan perwalian maupun kontak bantuan teknis belum dapat dipastikan dari dokumen resmi yang terverifikasi saat ini. Mahasiswa disarankan untuk langsung berkonsultasi dengan Dosen Wali masing-masing atau menghubungi Bagian Layanan Akademik (BAAK) ITB STIKOM Bali.'
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
