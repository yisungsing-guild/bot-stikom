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

const ANSWERABILITY_STATUS = Object.freeze({
  ANSWERABLE: 'ANSWERABLE',
  PARTIAL: 'PARTIAL',
  UNKNOWN: 'UNKNOWN',
  CLARIFY: 'CLARIFY',
  ESCALATE: 'ESCALATE'
});

function evaluateAnswerability(semanticFrame, arbitratedEvidence = {}) {
  const { accepted = [], rejected = [] } = arbitratedEvidence;

  // 1. If no accepted evidence exists
  if (!accepted || accepted.length === 0) {
    // If user query represents a missed academic process or complaint -> ESCALATE to admin/academic staff
    if (semanticFrame.intent === 'MISSED_ACADEMIC_PROCESS' || semanticFrame.userState === 'LATE') {
      return {
        status: ANSWERABILITY_STATUS.ESCALATE,
        reason: 'missed_process_requires_staff_assistance',
        guidance: 'Mohon hubungi bagian Bagian Akademik (BAAK) atau dosen wali untuk penanganan keterlambatan perwalian.'
      };
    }

    if (semanticFrame.domain === 'TUITION_FEE' || (semanticFrame.aspects && semanticFrame.aspects.some(a => ['fee', 'tuition', 'dpp'].includes(a)))) {
      const isFacilityOrInfrastructure = semanticFrame.domain === 'FACILITIES' ||
        (semanticFrame.aspects && semanticFrame.aspects.some(a => ['facilities', 'campus_infrastructure'].includes(a))) ||
        (semanticFrame.entities && semanticFrame.entities.some(e => ['campus_facility', 'facility'].includes(e.family || e.type)));
      if (isFacilityOrInfrastructure) {
        return {
          status: ANSWERABILITY_STATUS.UNKNOWN,
          reason: 'insufficient_facility_fee_evidence',
          guidance: 'Informasi resmi mengenai tarif atau biaya fasilitas tersebut belum tercantum secara lengkap dalam panduan yang tersedia.'
        };
      }
      return {
        status: ANSWERABILITY_STATUS.UNKNOWN,
        reason: 'insufficient_fee_evidence',
        guidance: 'Informasi resmi mengenai rincian biaya kuliah untuk program studi tersebut belum tercantum secara lengkap dalam panduan yang tersedia.'
      };
    }

    // Check for private contact inquiries (e.g. personal WA/phone of rector, kaprodi)
    const isPrivateContact = /\b(nomor\s+pribadi|wa\s+pribadi|whatsapp\s+pribadi|nomor\s+hp|kontak\s+pribadi)\b/i.test(semanticFrame.rawQuery || '');
    if (isPrivateContact) {
      return {
        status: ANSWERABILITY_STATUS.UNKNOWN,
        reason: 'corpus_gap',
        guidance: 'Mohon maaf, nomor kontak pribadi tidak dipublikasikan dalam panduan resmi. Silakan menghubungi saluran resmi kampus atau humas ITB STIKOM Bali.'
      };
    }

    // Default when no evidence proves the question
    return {
      status: ANSWERABILITY_STATUS.UNKNOWN,
      reason: 'corpus_gap',
      guidance: 'Informasi resmi terkait hal ini belum tercantum secara lengkap dalam panduan yang tersedia.'
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

    const coveredAspects = requiredAspects.filter(req => allProvidedAspects.has(req));
    const missingAspects = requiredAspects.filter(req => !allProvidedAspects.has(req));

    if (coveredAspects.length === 0) {
      if (semanticFrame.domain === 'TUITION_FEE' || requiredAspects.some(a => ['fee', 'tuition', 'dpp'].includes(a))) {
        return {
          status: ANSWERABILITY_STATUS.UNKNOWN,
          reason: 'insufficient_fee_aspect_coverage',
          coveredAspects: [],
          missingAspects: requiredAspects,
          guidance: 'Informasi resmi mengenai rincian biaya kuliah untuk program studi tersebut belum tercantum secara lengkap dalam panduan yang tersedia.'
        };
      }
      return {
        status: ANSWERABILITY_STATUS.UNKNOWN,
        reason: 'insufficient_aspect_evidence',
        coveredAspects: [],
        missingAspects: requiredAspects,
        guidance: 'Informasi resmi terkait aspek tersebut belum tercantum secara lengkap dalam panduan yang tersedia.'
      };
    }

    if (missingAspects.length > 0 && coveredAspects.length > 0) {
      return {
        status: ANSWERABILITY_STATUS.PARTIAL,
        reason: 'partial_aspect_coverage',
        coveredAspects,
        missingAspects,
        guidance: `Informasi terkait ${missingAspects.join(', ')} belum tercantum secara lengkap dalam panduan yang tersedia.`
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
  const isParkingFee = /\b(parkir(?:\s+inap)?|tarif\s+parkir)\b/i.test(rawQ);
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

  if (isParkingFee && !/\b(parkir|tarif\s+parkir)\b/i.test(combinedEvidenceText)) {
    return {
      status: ANSWERABILITY_STATUS.UNKNOWN,
      reason: 'corpus_gap_parking_fee_unrecorded',
      coveredAspects: [],
      missingAspects: ['parking_fee'],
      guidance: 'Informasi resmi mengenai tarif parkir inap kendaraan belum tercantum secara lengkap dalam panduan yang tersedia.'
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
  evaluateAnswerability
};
