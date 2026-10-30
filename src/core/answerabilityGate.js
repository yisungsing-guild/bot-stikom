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

  // 1. If no accepted evidence exists -> must evaluate before any factual or recommendation shortcut
  if (!accepted || accepted.length === 0) {
    // Allow clarification without external RAG evidence ONLY when query is genuinely ambiguous or broad guidance without specific preference
    if (
      semanticFrame.intent === 'AMBIGUOUS_CLARIFICATION' ||
      semanticFrame.isAmbiguous ||
      semanticFrame.ambiguityLevel === 'HIGH'
    ) {
      return {
        status: ANSWERABILITY_STATUS.CLARIFY,
        reason: 'ambiguous_clarification_required',
        coveredAspects: [],
        missingAspects: []
      };
    }

    if (semanticFrame.domain === 'ACADEMIC_RECOMMENDATION' || semanticFrame.intent === 'PROGRAM_RECOMMENDATION') {
      const { isBroadSchoolBackgroundWithoutSpecificPreference } = require('../engine/programFitReasoning');
      const isBroad = isBroadSchoolBackgroundWithoutSpecificPreference(semanticFrame.rawQuery || '', {
        canonical: semanticFrame
      });
      if (isBroad) {
        return {
          status: ANSWERABILITY_STATUS.CLARIFY,
          reason: 'broad_recommendation_clarification_required',
          coveredAspects: ['recommendation', 'program_fit'],
          missingAspects: []
        };
      }
      return {
        status: ANSWERABILITY_STATUS.UNKNOWN,
        reason: 'insufficient_recommendation_evidence',
        coveredAspects: [],
        missingAspects: ['recommendation', 'program_fit'],
        guidance: isEn
          ? 'I apologize, but verified official curriculum information regarding this interest could not be confirmed from our available records. Please consult campus admissions directly.'
          : 'Mohon maaf Kak, informasi kurikulum resmi untuk minat tersebut belum dapat dipastikan dari dokumen yang tersedia saat ini. Silakan berkonsultasi langsung dengan admisi PMB ITB STIKOM Bali ya.'
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
    if (
      semanticFrame.intent === 'CURRENT_ENROLLMENT_STATUS' ||
      semanticFrame.domain === 'PMB' ||
      semanticFrame.intent === 'ADMISSION_PROCEDURE' ||
      semanticFrame.intent === 'PROGRAM_PROCEDURE'
    ) {
      const entityLabel = (semanticFrame.entities && semanticFrame.entities[0]) ? (semanticFrame.entities[0].canonical || semanticFrame.entities[0]) : '';
      const isUtb = /utb/i.test(entityLabel);
      const entityDesc = isUtb ? 'Program Dual Degree UTB (S1 Bisnis Digital)' : (entityLabel ? `program ${entityLabel}` : '');
      const entityPart = entityDesc ? ` untuk ${entityDesc}` : '';

      return {
        status: ANSWERABILITY_STATUS.UNKNOWN,
        reason: 'corpus_gap',
        guidance: isEn
          ? `Official detailed registration steps${entityPart} are not fully listed in the available guidelines. Registration can be accessed online at https://pmb.stikom-bali.ac.id or by contacting campus admissions directly.`
          : `Tahapan prosedur pendaftaran rinci${entityPart} belum tercantum lengkap dalam panduan yang tersedia. Pendaftaran resmi dapat diakses secara online melalui portal https://pmb.stikom-bali.ac.id atau berkonsultasi langsung ke layanan admisi kampus ITB STIKOM Bali.`
      };
    }

    return {
      status: ANSWERABILITY_STATUS.UNKNOWN,
      reason: 'corpus_gap',
      guidance: isEn
        ? 'Official information regarding this matter is not fully listed in the available guidelines.'
        : 'Informasi resmi terkait hal ini belum tercantum secara lengkap dalam panduan yang tersedia.'
    };
  }

  // Institutional Academic Program Recommendation Reasoning when RAG evidence is present
  if (semanticFrame.domain === 'ACADEMIC_RECOMMENDATION' || semanticFrame.intent === 'PROGRAM_RECOMMENDATION') {
    return {
      status: ANSWERABILITY_STATUS.ANSWERABLE,
      reason: 'supported_recommendation_evidence',
      coveredAspects: ['recommendation', 'program_fit'],
      missingAspects: []
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
  if (/\b(?:apa\s+saja|ada\s+apa(?:\s+saja)?|daftar|jenis(?:-jenis)?)\b/i.test(rawQ) && /\bbeasiswa\b/i.test(rawQ)) {
    if (!requiredAspects.includes('scholarship_list')) {
      requiredAspects.push('scholarship_list');
    }
  }
  if (requiredAspects.length > 0) {
    const allProvidedAspects = new Set();
    for (const chunk of accepted) {
      if (Array.isArray(chunk.providedAspects)) {
        chunk.providedAspects.forEach(a => allProvidedAspects.add(a));
      }
      const text = (chunk.text || '').toLowerCase();
      if (/\b(?:alur\s+pendaftaran|prosedur\s+pendaftaran|tahapan\s+pendaftaran|langkah(?:-langkah)?\s+pendaftaran|tata\s+cara\s+(?:daftar|mendaftar|pendaftaran)|mekanisme\s+pendaftaran)\b/i.test(text)) {
        allProvidedAspects.add('procedure');
        allProvidedAspects.add('admission');
      }
      if (/\b(?:pmb\.stikom-bali\.ac\.id|portal\s+pmb|link\s+pendaftaran)\b/i.test(text)) {
        allProvidedAspects.add('admission_portal');
        allProvidedAspects.add('portal');
      }
      if (/\b(?:syarat\s+pendaftaran|persyaratan\s+pendaftaran|berkas\s+pendaftaran|kelengkapan\s+dokumen|ijazah|fotokopi|dokumen\s+persyaratan)\b/i.test(text)) {
        allProvidedAspects.add('requirements');
      }
      if (/\b(?:jalan\s+raya\s+puputan|renon|kampus\s+renon|raya\s+kampus\s+udayana|kampus\s+jimbaran|abiansemal|kampus\s+abiansemal|dauh\s+yeh\s+cani)\b/i.test(text) && /(?:\bjl\.?|\bjalan\b|\balamat\b|\blokasi\b)/i.test(text)) {
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
      if (/\b(?:gelombang|potongan|diskon|promo|cashback|periode)\b/i.test(text)) {
        allProvidedAspects.add('wave_discount');
        allProvidedAspects.add('discount');
        allProvidedAspects.add('admission_wave');
        allProvidedAspects.add('timeline');
      }
      if (/\b(?:biaya|uang\s+kuliah|tarif|spp)\b/i.test(text)) {
        allProvidedAspects.add('fee');
        allProvidedAspects.add('tuition');
      }
      if (/\b(?:rincian\s+biaya|komponen\s+biaya|struktur\s+biaya|skema\s+biaya|angsuran|tahap\s+pembayaran)\b/i.test(text)) {
        allProvidedAspects.add('fee_structure');
      }
      if (/\b(?:dpp\s+dan\s+spp|registrasi.*dpp|komponen\s+biaya|rincian\s+biaya|biaya\s+sks|biaya\s+praktikum)\b/i.test(text)) {
        allProvidedAspects.add('fee_components');
      }
      if (/\b(?:total\s+(?:biaya|kewajiban|keseluruhan|pembayaran)|jumlah\s+kewajiban|total\s+keseluruhan|biaya\s+total)\b/i.test(text)) {
        allProvidedAspects.add('total_cost');
      }
      if (/\b(?:beasiswa|kip\s*kuliah|kartu\s+indonesia\s+pintar|bantuan\s+dana\s+pendidikan)\b/i.test(text)) {
        allProvidedAspects.add('scholarship');
        allProvidedAspects.add('scholarship_types');
        if (/\b(?:daftar\s+beasiswa|jenis\s+beasiswa|beasiswa\s+berikut|antara\s+lain\s*:|yayasan|prestasi)\b/i.test(text)) {
          allProvidedAspects.add('scholarship_list');
        }
      }
      if (/\b(?:pmb|pendaftaran|jalur|syarat|prosedur|jadwal|gelombang|penerimaan)\b/i.test(text)) {
        allProvidedAspects.add('admission_overview');
        allProvidedAspects.add('admission_pathways');
      }
    }

    // Contact Aspect verification:
    // Only satisfy contact aspects if an accepted chunk contains contact/phone info
    const hasContactEvidence = accepted.some(chunk => {
      const text = (chunk.text || '').toLowerCase();
      return /\b(?:telepon|telp|hotline|email|\(0361\)|08\d{8,}|info@stikom-bali\.ac\.id)\b/i.test(text);
    });
    if (hasContactEvidence && !isPrivateContact) {
      allProvidedAspects.add('contact');
      allProvidedAspects.add('phone');
      allProvidedAspects.add('whatsapp');
    }

    // Campus Location Entity Coverage Evaluation:
    if (semanticFrame.intent === 'CAMPUS_LOCATION' || requiredAspects.some(a => ['location', 'campus_location', 'address'].includes(a))) {
      const isAllLocationsRequested = semanticFrame.locationScope === 'ALL' ||
        requiredAspects.includes('all_locations') ||
        semanticFrame.scope === 'ALL';
      const targetBranch = semanticFrame.targetBranch || null;

      const hasRenonEvidence = accepted.some(chunk => {
        const text = (chunk.text || '').toLowerCase();
        return /\b(?:kampus\s+renon|puputan|renon)\b/i.test(text) && /\b(?:jl\.|jalan|no\.|raya|denpasar)\b/i.test(text);
      });

      const hasJimbaranEvidence = accepted.some(chunk => {
        const text = (chunk.text || '').toLowerCase();
        const isUnivUdayanaOtherContext = /\buniversitas\s+udayana\b/i.test(text) && !/\b(?:kampus\s+jimbaran|(?:jl\.|jalan|raya)\s+kampus\s+udayana)\b/i.test(text);
        if (isUnivUdayanaOtherContext) return false;
        return (
          (/\b(?:kampus\s+jimbaran|kuta\s+selatan|jimbaran)\b/i.test(text) && /\b(?:udayana|raya\s+kampus|jl\.|jalan)\b/i.test(text)) ||
          /\b(?:jl\.|jalan|raya)\s+kampus\s+udayana\b/i.test(text)
        );
      });

      const hasAbiansemalEvidence = accepted.some(chunk => {
        const text = (chunk.text || '').toLowerCase();
        return /\b(?:kampus\s+abiansemal|abiansemal|dauh\s+yeh\s+cani)\b/i.test(text) && /\b(?:janger|jl\.|jalan|badung)\b/i.test(text);
      });

      const coveredBranches = [];
      const missingBranches = [];
      if (hasRenonEvidence) coveredBranches.push('Kampus Renon'); else missingBranches.push('Kampus Renon');
      if (hasJimbaranEvidence) coveredBranches.push('Kampus Jimbaran'); else missingBranches.push('Kampus Jimbaran');
      if (hasAbiansemalEvidence) coveredBranches.push('Kampus Abiansemal'); else missingBranches.push('Kampus Abiansemal');

      if (targetBranch) {
        const branchMap = { renon: hasRenonEvidence, jimbaran: hasJimbaranEvidence, abiansemal: hasAbiansemalEvidence };
        if (branchMap[targetBranch] === false) {
          return {
            status: ANSWERABILITY_STATUS.UNKNOWN,
            reason: `insufficient_${targetBranch}_location_evidence`,
            coveredAspects: [],
            missingAspects: [`${targetBranch}_campus_location`],
            guidance: isEn
              ? `Official address for ${targetBranch.toUpperCase()} campus is not confirmed in the available guidelines.`
              : `Informasi resmi mengenai alamat Kampus ${targetBranch.toUpperCase()} belum tercantum secara lengkap dalam panduan yang tersedia.`
          };
        }
      }

      if (isAllLocationsRequested) {
        if (coveredBranches.length === 3) {
          allProvidedAspects.add('all_locations');
          allProvidedAspects.add('location');
          allProvidedAspects.add('campus_location');
          allProvidedAspects.add('address');
        } else if (coveredBranches.length > 0) {
          return {
            status: ANSWERABILITY_STATUS.PARTIAL,
            reason: 'partial_campus_locations_coverage',
            coveredAspects: ['location', 'campus_location'],
            missingAspects: missingBranches,
            coveredBranches,
            missingBranches,
            guidance: isEn
              ? `Official location details are currently available for ${coveredBranches.join(' and ')}, while information for ${missingBranches.join(' and ')} is not fully verified in the available guidelines.`
              : `Informasi lokasi resmi saat ini baru memuat alamat untuk ${coveredBranches.join(' dan ')}, sedangkan rincian alamat resmi untuk ${missingBranches.join(' dan ')} belum tercantum secara lengkap dalam panduan yang tersedia.`
          };
        } else {
          return {
            status: ANSWERABILITY_STATUS.UNKNOWN,
            reason: 'insufficient_campus_locations_evidence',
            coveredAspects: [],
            missingAspects: requiredAspects,
            guidance: isEn
              ? 'Official campus locations are not confirmed in the available guidelines.'
              : 'Informasi mengenai lokasi kampus ITB STIKOM Bali belum tercantum dalam panduan resmi yang tersedia.'
          };
        }
      } else if (coveredBranches.length === 0) {
        return {
          status: ANSWERABILITY_STATUS.UNKNOWN,
          reason: 'insufficient_campus_location_evidence',
          coveredAspects: [],
          missingAspects: requiredAspects,
          guidance: isEn
            ? 'Official campus location information is not confirmed in the available guidelines.'
            : 'Informasi mengenai lokasi kampus ITB STIKOM Bali belum tercantum dalam panduan resmi yang tersedia.'
        };
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
