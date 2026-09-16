/**
 * Multi-Answer Composer Engine
 *
 * Composes multiple independent subrequest execution results into a unified,
 * professional, and naturally-structured WhatsApp response.
 *
 * Guarantees:
 * 1. Failure isolation: Unsupported clauses produce localized SAFE_NO_DATA and do not poison supported sibling clauses.
 * 2. Independent evidence & contract provenance in debug.multiQuery.
 * 3. Clean WhatsApp markdown numbering (1. **Heading** \n Content).
 */

function generateSectionHeading(subResult, index) {
  const contract = subResult.semanticContract || (subResult.debug && subResult.debug.semanticContract) || null;
  const domain = (contract && contract.domain) || (subResult.debug && subResult.debug.canonicalDomain) || '';
  const intent = (contract && contract.intent) || (subResult.debug && subResult.debug.canonicalIntent) || '';
  const entities = (contract && Array.isArray(contract.entities)) ? contract.entities : [];
  const primaryEntity = entities.find(e => e.type === 'program' || e.family === 'academic_program' || e.type === 'facility' || e.family === 'student_organization') || entities[0];
  const entityName = primaryEntity ? primaryEntity.canonical : '';
  const text = String(subResult.requestText || '').toLowerCase();

  // 1. Accreditation
  if (domain === 'accreditation' || /akreditasi/i.test(text)) {
    return entityName ? `Akreditasi ${entityName}` : 'Akreditasi Program Studi';
  }

  // 2. Fees & Payment
  if (domain === 'fee' || /biaya|uang\s+kuliah|spp|ukt|dpp/i.test(text)) {
    if (/pembayaran|bayar|transfer|bank|cicil|channel|metode/i.test(text)) {
      return 'Metode & Alur Pembayaran';
    }
    return entityName ? `Biaya Kuliah ${entityName}` : 'Biaya Pendaftaran & Kuliah';
  }

  // 3. Registration / PMB
  if (domain === 'registration' || domain === 'pmb_schedule' || /pmb|daftar|pendaftaran|gelombang|syarat/i.test(text)) {
    if (/jadwal|kapan|gelombang/i.test(text)) return 'Jadwal Pendaftaran PMB';
    if (/syarat/i.test(text)) return 'Syarat Pendaftaran PMB';
    return 'Pendaftaran Mahasiswa Baru';
  }

  // 4. RPL (Rekognisi Pembelajaran Lampau)
  if (domain === 'rpl' || /rpl|konversi|rekognisi/i.test(text)) {
    return 'Konversi SKS & Program RPL';
  }

  // 5. Facilities & Campus
  if (domain === 'campus_facility' || domain === 'facility' || /fasilitas|lab|laboratorium|perpus/i.test(text)) {
    return entityName ? `Fasilitas ${entityName}` : 'Fasilitas Kampus';
  }

  // 6. Student Organizations / UKM
  if (domain === 'student_organization' || /ukm|ormawa|ekskul|klub/i.test(text)) {
    return entityName ? `Kegiatan ${entityName}` : 'Unit Kegiatan Mahasiswa (UKM)';
  }

  // 7. Scholarship & Discounts
  if (domain === 'scholarship' || /beasiswa|keringanan|potongan|diskon/i.test(text)) {
    return 'Informasi Beasiswa & Potongan Biaya';
  }

  // 8. General Admission / Quota
  if (/kuota|daya\s+tampung/i.test(text)) {
    return 'Informasi Kuota & Daya Tampung';
  }

  // Fallback: concise representation of entity or clause
  if (entityName) return entityName;
  return `Poin Pertanyaan ${index + 1}`;
}

/**
 * Normalizes an individual subrequest answer for embedding in a numbered list
 */
function cleanSubAnswer(rawAnswer) {
  let answer = String(rawAnswer || '').trim();

  // Strip greeting prefixes that sound redundant when combined
  answer = answer.replace(/^(?:Halo\s+Kak[!,.]*|Hai\s+Kak[!,.]*|Baik,\s+Kak[!,.]*|Bisa,\s+Kak[!,.]*|Terima\s+kasih[!,.]*)\s*/i, '');
  answer = answer.replace(/^Saya bantu jelaskan mengenai [^\n]* ya Kak\.\s*/i, '');

  return answer.trim();
}

/**
 * Composes array of subrequest execution results into one unified response
 * @param {Array<object>} subResults
 * @param {object} options
 * @returns {object} unified result
 */
function composeMultiAnswer(subResults, options = {}) {
  if (!Array.isArray(subResults) || !subResults.length) {
    return {
      success: false,
      answer: 'Maaf, pertanyaan tidak dapat diproses.',
      source: 'semantic-rag-multi-query'
    };
  }

  if (subResults.length === 1) {
    return subResults[0];
  }

  const sections = [];
  const allContexts = [];

  for (let i = 0; i < subResults.length; i++) {
    const sub = subResults[i];
    const heading = generateSectionHeading(sub, i);
    const cleanedAnswer = cleanSubAnswer(sub.answer);

    sections.push(`${i + 1}. **${heading}**\n${cleanedAnswer}`);

    if (Array.isArray(sub.contexts)) {
      allContexts.push(...sub.contexts);
    }
  }

  const combinedAnswer = sections.join('\n\n');

  // Multi-query provenance and debug output
  const multiQueryDebug = {
    requestCount: subResults.length,
    requests: subResults.map((sub, idx) => ({
      index: idx + 1,
      text: sub.requestText,
      semanticContract: sub.semanticContract || (sub.debug && sub.debug.semanticContract) || null,
      retrievalPlan: sub.retrievalPlan || (sub.debug && sub.debug.retrievalPlan) || null,
      selectedEvidence: sub.contexts || [],
      answerability: sub.debug && sub.debug.answerabilityResult ? sub.debug.answerabilityResult : { answerable: sub.success !== false },
      source: sub.source,
      answer: sub.answer
    }))
  };

  // Select promotable semantic contract for session state persistence
  // Rule:
  // - Prefer the last textually explicit, verified, promotable subrequest
  // - Skip unsupported/unverified subrequests
  // - Do not merge incompatible domains into one state
  // - Never store hallucinated/inferred unsupported entities
  let promotableContract = null;
  for (let i = subResults.length - 1; i >= 0; i--) {
    const sub = subResults[i];
    const res = sub.result || sub;
    if (res.success === false) continue;

    const src = String(res.source || '').toLowerCase();
    const isNonPromotable = /(?:clarify|verifier-blocked|contract-blocked|raw-artifact-sanitized|preflight-blocked|insufficient-data|no-data|no-training-detail|answer-shape-mismatch|out-of-domain|no-relevant|low-coverage|safe-(?:general-)?fallback|unsupported|timeout|runtime.error|reply_deadline_fallback|semantic-rag-disabled)/i.test(src)
      || res.isVerified === false || res.verified === false;
    if (isNonPromotable) continue;

    const contract = sub.semanticContract || (sub.debug && sub.debug.semanticContract) || (res.debug && res.debug.semanticContract) || null;
    if (contract && contract.domain) {
      promotableContract = contract;
      break;
    }
  }

  return {
    success: true,
    answer: combinedAnswer,
    source: 'semantic-rag-multi-query',
    contexts: allContexts.slice(0, 8),
    confidenceScore: 0.95,
    confidenceTier: 'HIGH',
    debug: {
      multiQuery: multiQueryDebug,
      semanticContract: promotableContract,
      canonicalContract: promotableContract
    }
  };
}

module.exports = {
  composeMultiAnswer,
  generateSectionHeading
};
