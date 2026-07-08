const { assertValidComposePayload } = require('./composerContract');
const { buildWhatsappConversationalReply } = require('../utils/whatsappFormatter');

function createFeeResponder({
  extractSpecificProgramHint,
  extractProgramHint,
  extractDualDegreeHint,
  parseGelombang,
  looksLikeAdmissionRequirementsQuestion,
  looksLikeMustPayTotalQuestion,
  buildDeterministicMustPayTotalAnswerFromBundledIndex,
  logger
}) {
  function parseFeeDetailChoice(rawText) {
    const tRaw = String(rawText || '').trim().toLowerCase();
    if (!tRaw) return null;

    const t = tRaw.replace(/\bmendaftar\b/g, 'daftar');
    if (/\b(daftar\s+ulang|registrasi\s+ulang|heregistrasi|her\s*registrasi)\b/i.test(t)) return null;

    if (looksLikeAdmissionRequirementsQuestion(t)) {
      const hasCostWord = /(biaya|uang|\brp\b|\bdpp\b|semester|per\s*semester|ukt\b|cicil|cicilan|pembayaran|potongan|diskon)/i.test(t);
      if (!hasCostWord) return null;
    }

    try {
      const hasBiayaWord = /\bbiaya\b/i.test(t);
      const hasProgram = !!(extractSpecificProgramHint(t) || extractProgramHint(t) || extractDualDegreeHint(t));
      const gel = (typeof parseGelombang === 'function') ? parseGelombang(t) : null;
      if (hasBiayaWord && hasProgram && gel) return 'breakdown';
    } catch {
      // ignore
    }

    if (/\bcuti\b/.test(t)) return 'cuti';
    if (/(pengembalian|refund|dana\s+kembali|uang\s+kembali|pembatalan|batal\s+daftar)/.test(t)) return 'refund';
    if (/(sertifikasi|yudisium|wisuda)/.test(t)) return 'graduation_fees';

    const hasBreakdownWord = /\b(rincian|detail|lengkap|komponen)\b/i.test(t);
    const hasBiaya = /\bbiaya\b/i.test(t);
    if (hasBreakdownWord && hasBiaya) {
      const mentionsPendaftaran = /\b(pendaftaran|daftar|registrasi)\b/i.test(t);
      const mentionsDpp = /\b(dpp|dana\s+pendidikan\s+pokok)\b/i.test(t);
      const mentionsSemester = /(per\s*semester|biaya\s+semester|biaya\s+kuliah|uang\s+kuliah|biaya\s+pendidikan|ukt\b)/i.test(t);
      const mentionsCicilan = /(cicil|cicilan|skema\s+pembayaran|pembayaran\s+per\s+komponen)/i.test(t);
      const componentCount = [mentionsPendaftaran, mentionsDpp, mentionsSemester, mentionsCicilan].filter(Boolean).length;

      const explicitFullContext = /(kuliah|pendidikan|awal\s*masuk|komponen)/i.test(t) || /\b(keseluruhan|total|semua)\b/i.test(t);
      const mentionsProgram = !!(extractProgramHint(t) || extractDualDegreeHint(t));
      const isShort = t.length <= 120;
      const wantsBreakdown = explicitFullContext || componentCount >= 2 || (componentCount === 0 && (mentionsProgram || isShort));
      if (wantsBreakdown) return 'breakdown';
    }

    if (/\b(biaya|uang)\s+(pendaftaran|daftar|registrasi)\b/i.test(t)) return 'pendaftaran';
    if (/^pendaftaran[\s\?\!\.]*$/.test(t)) return 'pendaftaran';
    if (/\bdpp\b/.test(t)) return 'dpp';
    if (/(per\s*semester|biaya\s+semester|biaya\s+kuliah|uang\s+kuliah|biaya\s+pendidikan|ukt\b)/.test(t)) return 'semester';
    if (/(cicil|cicilan|skema\s+pembayaran|pembayaran\s+per\s+komponen)/.test(t)) return 'cicilan';

    if (/(ketentuan\s+biaya|aturan\s+biaya|syarat\s+biaya|berlaku\s+selama\s+masa\s+studi|masa\s+studi\s+normal)/.test(t)) return 'general_terms';
    return null;
  }

  function extractStructuredDataFromRag(ragAnswer) {
    const text = String(ragAnswer || '');
    const extract = { confidence: 0 };
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    const parseRupiah = (str) => {
      const match = str.match(/Rp\.?\s*([0-9.,]+(?:rb|ribu)?)/i) || str.match(/([0-9.,]+(?:rb|ribu)?)\s*Rp/i);
      if (!match) return null;
      let numStr = match[1].replace(/,/g, '').replace(/\./g, '').replace(/-/g, '').trim();
      if (numStr.includes('rb') || numStr.includes('ribu')) {
        numStr = numStr.replace(/rb|ribu/g, '');
        const num = parseInt(numStr, 10);
        return isNaN(num) ? null : num * 1000;
      }
      const num = parseInt(numStr, 10);
      return isNaN(num) ? null : num;
    };

    const validateFeeValue = (fieldName, value) => {
      if (!Number.isFinite(value) || value <= 0) return false;
      const thresholds = {
        pendaftaran: 10000000,
        dpp: 50000000,
        ukt: 100000000,
        potongan: 50000000
      };
      const maxAllowed = thresholds[fieldName] || 100000000;
      return value > 0 && value < maxAllowed;
    };

    const extractField = (keyword, lines, fieldName) => {
      for (const line of lines) {
        const lowerLine = line.toLowerCase();
        if (lowerLine.includes(keyword)) {
          const num = parseRupiah(line);
          const valid = num !== null && validateFeeValue(fieldName, num);
          logger && logger.info && logger.info({ keyword, rawText: line, parsedValue: num, valid }, '[RAG-PARSE]');
          if (num !== null) {
            return { value: valid ? num : null, found: true, valid, rawText: line };
          }
          return { value: null, found: true, valid: false, rawText: line };
        }
      }
      return { value: null, found: false, valid: false, rawText: null };
    };

    for (const line of lines) {
      const progMatch = line.match(/(?:prodi|program studi)\s*:\s*([a-z\s]+)/i);
      if (progMatch) {
        extract.program = progMatch[1].trim().toUpperCase();
        break;
      }
    }

    for (const line of lines) {
      const gelMatch = line.match(/(?:gelombang|gbg)\s*([ivx]+|[0-9]+)/i);
      if (gelMatch) {
        extract.gelombang = gelMatch[1].toUpperCase();
        break;
      }
    }

    extract.pendaftaran = extractField('pendaftaran', lines, 'pendaftaran');
    extract.dpp = extractField('dpp', lines, 'dpp');
    extract.ukt = extractField('ukt', lines, 'ukt');
    extract.potongan = extractField('potongan', lines, 'potongan') || extractField('diskon', lines, 'potongan');

    const hasProgram = !!extract.program;
    const hasGelombang = !!extract.gelombang;
    const hasPendaftaran = extract.pendaftaran.found;
    const hasDpp = extract.dpp.found;
    if (hasProgram && hasGelombang && hasPendaftaran && hasDpp) {
      extract.confidence = 1;
    } else if ((hasProgram || hasGelombang) && (hasPendaftaran || hasDpp)) {
      extract.confidence = 0.5;
    } else {
      extract.confidence = 0;
    }

    logger && logger.info && logger.info({ extract }, '[DEBUG] extractStructuredDataFromRag');
    return extract;
  }

  function buildPartialMustPayAnswer(extracted) {
    const lines = [];
    if (extracted.program && extracted.gelombang) {
      lines.push(`Total biaya awal masuk untuk Program Studi ${extracted.program} Gelombang ${extracted.gelombang} adalah:`);
    } else {
      lines.push('Rincian biaya awal masuk:');
    }

    const formatField = (field, label) => {
      if (field && field.value !== null) {
        return `- ${label}: Rp ${field.value.toLocaleString('id-ID')}`;
      } else if (field && field.found === true) {
        return `- ${label}: data ditemukan tetapi tidak dapat dibaca dengan sempurna`;
      }
      return `- ${label}: akan diinformasikan`;
    };

    lines.push(formatField(extracted.pendaftaran, 'Biaya Pendaftaran'));
    lines.push(formatField(extracted.dpp, 'DPP'));
    lines.push(formatField(extracted.ukt, 'UKT Semester 1'));
    lines.push(formatField(extracted.potongan, 'Potongan'));

    const hasValidTotal = extracted.pendaftaran && extracted.pendaftaran.value !== null && extracted.dpp && extracted.dpp.value !== null;
    if (hasValidTotal) {
      const pendaftaran = extracted.pendaftaran.value;
      const dpp = extracted.dpp.value;
      const ukt = (extracted.ukt && extracted.ukt.value !== null) ? extracted.ukt.value : 0;
      const potongan = (extracted.potongan && extracted.potongan.value !== null) ? extracted.potongan.value : 0;
      const total = pendaftaran + dpp + ukt - potongan;
      if (total > 0) {
        lines.push(`Total: Rp ${total.toLocaleString('id-ID')}`);
      } else {
        lines.push('Total: akan dihitung setelah data lengkap');
      }
    } else {
      lines.push('Total: akan dihitung setelah data lengkap');
    }
    return lines.join('\n');
  }

  function looksLikeSuspiciousFeeSnippet(text) {
    const normalized = String(text || '').trim().toLowerCase();
    return Boolean(
      normalized.includes('training') ||
      normalized.includes('ocr') ||
      normalized.includes('raw snippet') ||
      normalized.includes('field name') ||
      normalized.includes('unknown format') ||
      normalized.includes('original source')
    );
  }

  function buildUnifiedResponse(composePayloadOrData, dataOrRagAnswer, ragAnswerOrMode, maybeMode) {
    let composePayload = {};
    let data = null;
    let ragAnswer = null;
    let mode = null;

    if (composePayloadOrData && typeof composePayloadOrData === 'object' && ('userQuery' in composePayloadOrData || 'normalized' in composePayloadOrData)) {
      composePayload = composePayloadOrData;
      data = dataOrRagAnswer;
      ragAnswer = ragAnswerOrMode;
      mode = maybeMode;
    } else {
      composePayload = {};
      data = composePayloadOrData;
      ragAnswer = dataOrRagAnswer;
      mode = ragAnswerOrMode;
    }

    if (process.env.NODE_ENV !== 'production') {
      try {
        assertValidComposePayload(composePayload || {});
      } catch (err) {
        logger && logger.warn && logger.warn({ err: err.message, composePayload }, '[ComposerContract] Fee responder received invalid compose payload');
      }
    }

    const ans = String(ragAnswer || '').trim();

    let mainAnswer = '';
    if (mode === 'full') {
      const fullAnswer = buildDeterministicMustPayTotalAnswerFromBundledIndex(data);
      mainAnswer = fullAnswer && String(fullAnswer).trim() ? String(fullAnswer).trim() : ans;
    } else if (mode === 'partial') {
      mainAnswer = buildPartialMustPayAnswer(data);
    } else {
      mainAnswer = ans;
    }

    // If suspicious snippet detected, return a concise failure message wrapped in WA style.
    if (looksLikeSuspiciousFeeSnippet(mainAnswer)) {
      const fail = 'Maaf kak, saya belum bisa menemukan rincian biaya yang valid saat ini. Silakan coba ulang dengan pertanyaan yang lebih spesifik.';
      return buildWhatsappConversationalReply({
        rawMainAnswer: fail,
        userQuery: (composePayload && composePayload.userQuery) ? composePayload.userQuery : ans,
        suggestions: [
          'Kalau kakak mau, saya juga bisa bantu:',
          '- simulasi cicilan',
          '- cek beasiswa',
          '- bandingkan dengan prodi lain',
          '- cek jadwal pendaftaran'
        ]
      });
    }

    return buildWhatsappConversationalReply({
      rawMainAnswer: mainAnswer,
      userQuery: (composePayload && composePayload.userQuery) ? composePayload.userQuery : ans,
      responseMode: mode === 'full' ? 'deterministic' : 'conversational',
      preserveExactAnswer: mode === 'full'
    });
  }

  return {
    parseFeeDetailChoice,
    extractStructuredDataFromRag,
    buildUnifiedResponse
  };
}

module.exports = { createFeeResponder };