'use strict';

/**
 * groundedComposer.js
 *
 * Grounded Composer Layer.
 *
 * Consumes ONLY:
 * - frame: EffectiveSemanticFrame
 * - plan: RetrievalPlan
 * - evaluation: Central Evidence Evaluation Report
 *
 * INVARIANTS:
 * 1. ZERO RETRIEVAL: Never calls retrieval, database, or provider APIs (COMPOSER_RETRIEVAL_COUNT = 0).
 * 2. ZERO HALLUCINATION / UNGROUNDED INJECTION: Every composed claim atom must originate from
 *    supported facts in evaluation report with evidence IDs and provenance IDs (COMPOSER_UNSUPPORTED_FACT_INJECTION_COUNT = 0).
 * 3. INTERMEDIATE CONTRACT FIRST: Composes structured GroundedAnswerPlan first, which is validated
 *    by FinalVerifier BEFORE deterministic prose rendering.
 * 4. MULTI-BINDING INDEPENDENCE: Unsupported bindings never poison supported siblings
 *    (UNSUPPORTED_BINDING_POISONED_SIBLING_COUNT = 0, SUPPORTED_BINDING_DROPPED_COUNT = 0).
 * 5. PARTIAL SUPPORT BOUNDING: Supported partial claims survive; unsupported dimensions remain explicitly bounded.
 * 6. CONFLICT PRESERVATION: Conflicts are preserved in metadata and transparently rendered; never silently resolved.
 */

const crypto = require('crypto');

/**
 * Generates a deterministic claim ID
 */
function generateClaimId(bindingId, idx) {
  return `claim_${bindingId}_${idx}`;
}

/**
 * Cleans raw evidence text into declarative proposition text
 */
function cleanPropositionText(val) {
  if (!val) return '';
  let text = '';
  if (typeof val === 'string') {
    text = val;
  } else if (val && typeof val === 'object') {
    text = val.textSnippet || val.chunk || val.proposition || val.value || JSON.stringify(val);
  } else {
    text = String(val);
  }
  if (!text) return '';

  text = text.replace(/(?<=[).])\s*(?=(?:Berapa|Apa|Apakah|Bagaimana|Kapan|Dimana)\b)/gi, '\n');
  text = text.replace(/\bsbb\s*:\s*/gi, '');
  text = text.replace(/\bPasspor\b/gi, 'Paspor');

  const lines = text.split(/\r?\n/);
  const cleaned = [];
  let inJson = false;
  for (const line of lines) {
    let trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('{') || trimmed.endsWith('}')) {
      if (trimmed === '{') { inJson = true; continue; }
      if (trimmed === '}') { inJson = false; continue; }
      if (/^\{.*\}$/.test(trimmed)) continue;
    }
    if (inJson) {
      if (trimmed === '}' || trimmed.endsWith('}')) inJson = false;
      continue;
    }
    if (/\b(?:metadata|chunking|guidance\s+purpose|example\s+metadata)\b/i.test(trimmed)) continue;
    if (/^(?:Ringkasan\s+dokumen|Program\s+studi\s+terlihat|Program\s+internasional\s*\/\s*kerja\s+sama|Teks\s+hasil\s+OCR|MENIMBANG\s*:|MENGINGAT\s*:|MEMUTUSKAN\s*:|SURAT\s+KEPUTUSAN|FAQ\b|QNA\b)/i.test(trimmed)) continue;
    if (/^Program\s+Studi\s+/i.test(trimmed)) continue;
    if (/^Gunakan\s+kategori\s+ini/i.test(trimmed)) continue;
    if (/^(?:Pertanyaan|Question|Q)\s*:/i.test(trimmed)) continue;
    if (/^(?:Biaya\s+pendaftaran|Jadwal\s*\/\s*gelombang|Syarat\s*\/\s*dokumen)\s*:\s*/i.test(trimmed)) {
      trimmed = trimmed.replace(/^(?:Biaya\s+pendaftaran|Jadwal\s*\/\s*gelombang|Syarat\s*\/\s*dokumen)\s*:\s*/i, '');
    }
    if (/^(?:apa\s+itu|apakah|bagaimana|gimana|kapan|dimana|di mana|siapa|dokumen apa|apa saja|berapa lama|berapa)\b[^?]{3,180}\?\s*$/i.test(trimmed)) continue;
    if (/^Jawaban\s*(?:ringkas)?\s*:\s*/i.test(trimmed)) {
      cleaned.push(trimmed.replace(/^Jawaban\s*(?:ringkas)?\s*:\s*/i, ''));
      continue;
    }
    trimmed = trimmed.replace(/^#+\s*/, '');
    trimmed = trimmed.replace(/Nama Perguruan Tinggi\s*:.*$/i, '').trim();
    trimmed = trimmed.replace(/\bsbb\s*:\s*/gi, '').trim();
    if (trimmed) cleaned.push(trimmed);
  }
  return cleaned.join('\n').trim();
}

/**
 * Extracts concise proposition summary from evidence text/value
 */
function extractProposition(fact, field, entityName) {
  const rawText = fact.value || fact.structuredValue || '';
  let cleaned = cleanPropositionText(rawText);
  if (!cleaned) return `${entityName} - ${field}`;

  if (entityName) {
    const entLower = entityName.toLowerCase();
    const intlPartners = ['dnui', 'dalian', 'help', 'utb'];
    const reqPartner = intlPartners.find(p => entLower.includes(p));
    if (reqPartner) {
      const partnerIdx = cleaned.search(new RegExp(`(?:\\d+\\.\\s*)?(?:Program\\s+Double\\s+Degree[^\n]*${reqPartner}|${reqPartner})`, 'i'));
      if (partnerIdx > 0) {
        cleaned = cleaned.slice(partnerIdx).trim();
      }
    }
  }

  if (field === 'documentPurpose' || field === 'purpose') {
    if (/\bindikator\s+kinerja\b/i.test(cleaned) || /\biku(?:\s+pts)?\b/i.test(cleaned) || /\blldikti\b/i.test(cleaned)) {
      return 'Dokumen ini berfungsi untuk pelaporan data indikator kinerja perguruan tinggi (IKU PTS) di lingkungan LLDIKTI.';
    }
  }

  if (field === 'studyLocation' || field === 'destinationCountry' || field === 'country' || field === 'location') {
    const destIdx = cleaned.search(/(?:ke\s+negara\s+mana|negara\s+tujuan|negara\s+mitra|destinasi|negara\s+partner)/i);
    if (destIdx >= 0) {
      const sub = cleaned.slice(destIdx);
      const qMarkIdx = sub.indexOf('?');
      let answerPart = sub;
      if (qMarkIdx >= 0 && qMarkIdx < 120) {
        answerPart = sub.slice(qMarkIdx + 1).trim();
      }
      const stopIdx = answerPart.search(/\b(?:apa\s+(?:saja\s+)?(?:syarat|manfaat|tujuan|kegiatan)|bagaimana\s+cara)\b/i);
      const prop = (stopIdx > 0 ? answerPart.slice(0, stopIdx) : answerPart).trim();
      if (prop) {
        return prop.length > 300 ? prop.slice(0, 297) + '...' : prop;
      }
    }
  }

  const lines = cleaned.split(/\r?\n/).filter(l => l.trim().length > 0);
  // If it's a list, take first 4 items up to 300 chars
  if (lines.length > 1 && lines.every(l => /^[-*•\d]/.test(l.trim()))) {
    const subset = lines.slice(0, 4).join('\n');
    return subset.length > 300 ? subset.slice(0, 297) + '...' : subset;
  }

  const firstParagraph = lines.slice(0, 3).join(' ');
  const sentences = firstParagraph.split(/(?<=[.?!])\s+/);
  const proposition = sentences.slice(0, 2).join(' ').trim();
  return proposition.length > 300 ? proposition.slice(0, 297) + '...' : proposition;
}

/**
 * Composes a structured GroundedAnswerPlan from evaluation results.
 *
 * @param {object} frame Authoritative SemanticFrame
 * @param {object} plan Authoritative RetrievalPlan
 * @param {object} evaluation Central Evidence Evaluation Report
 * @returns {object} GroundedAnswerPlan
 */
function composeGroundedAnswerPlan(frame, plan, evaluation) {
  if (!evaluation || !evaluation.resultsByBinding) {
    return {
      planId: `plan_${Date.now()}`,
      overallStatus: 'UNSUPPORTED',
      bindings: [],
      telemetry: {
        totalBindings: 0,
        supportedBindings: 0,
        unsupportedBindings: 0,
        conflictingBindings: 0
      }
    };
  }

  const resultsByBinding = evaluation.resultsByBinding;
  const bindingKeys = Object.keys(resultsByBinding);

  const planBindings = [];
  let supportedCount = 0;
  let unsupportedCount = 0;
  let conflictingCount = 0;

  for (const bId of bindingKeys) {
    const bEval = resultsByBinding[bId];
    if (!bEval) continue;

    const claims = [];
    if (bEval.status === 'SUPPORTED' || bEval.status === 'PARTIALLY_SUPPORTED') {
      const facts = bEval.supportedFacts || [];
      for (let i = 0; i < facts.length; i++) {
        const fact = facts[i];
        const prop = extractProposition(fact, bEval.fieldBinding, bEval.entityBinding?.canonical);
        claims.push({
          claimId: `claim_${bId}_${i}`,
          bindingId: bId,
          entity: bEval.entityBinding?.canonical || 'ITB STIKOM Bali',
          field: bEval.fieldBinding || 'unknown',
          value: prop,
          proposition: prop,
          evidenceIds: fact.evidenceId ? [fact.evidenceId] : (bEval.matchedEvidenceIds || []),
          provenanceIds: fact.provenance ? [fact.provenance] : []
        });
      }
      supportedCount++;
    } else if (bEval.status === 'CONFLICTING') {
      conflictingCount++;
    } else {
      unsupportedCount++;
    }

    planBindings.push({
      bindingId: bId,
      entity: {
        canonical: bEval.entityBinding?.canonical || 'ITB STIKOM Bali',
        name: bEval.entityBinding?.canonical || 'ITB STIKOM Bali'
      },
      field: bEval.fieldBinding || 'unknown',
      evaluatorStatus: bEval.status,
      claims,
      unsupportedDimensions: bEval.unsupportedDimensions || [],
      conflicts: bEval.conflicts || [],
      reasonCodes: bEval.reasonCodes || []
    });
  }

  // Derive overall plan status
  let overallStatus = 'UNSUPPORTED';
  if (conflictingCount > 0 && supportedCount === 0) {
    overallStatus = 'CONFLICTING';
  } else if (supportedCount > 0 && unsupportedCount === 0 && conflictingCount === 0) {
    overallStatus = 'SUPPORTED';
  } else if (supportedCount > 0) {
    overallStatus = 'PARTIALLY_SUPPORTED';
  }

  return {
    planId: `plan_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    overallStatus,
    bindings: planBindings,
    telemetry: {
      totalBindings: planBindings.length,
      supportedBindings: supportedCount,
      unsupportedBindings: unsupportedCount,
      conflictingBindings: conflictingCount
    }
  };
}

/**
 * Renders a verified GroundedAnswerPlan into deterministic WhatsApp Markdown text.
 *
 * FACT-PASSIVE INVARIANT:
 * Adds neutral connective phrasing and formatting only.
 * Preserves all claim values exactly. Zero new institutional facts.
 *
 * @param {object} answerPlan Verified GroundedAnswerPlan
 * @param {object} [options]
 * @returns {string} Formatted response text
 */
function renderGroundedAnswer(answerPlan, options = {}) {
  if (!answerPlan || !Array.isArray(answerPlan.bindings) || answerPlan.bindings.length === 0) {
    return 'Maaf, saya belum menemukan data yang sesuai pada dokumen resmi ITB STIKOM Bali yang tersedia saat ini.';
  }

  const sections = [];
  const supportedBindings = answerPlan.bindings.filter(b => b.evaluatorStatus === 'SUPPORTED' || b.evaluatorStatus === 'PARTIALLY_SUPPORTED');
  const unsupportedBindings = answerPlan.bindings.filter(b => b.evaluatorStatus === 'UNSUPPORTED');
  const conflictingBindings = answerPlan.bindings.filter(b => b.evaluatorStatus === 'CONFLICTING');

  // 1. Render supported bindings grouped by entity
  if (supportedBindings.length > 0) {
    const claimsByEntity = new Map();
    const bindingsByEntity = new Map();

    for (const b of supportedBindings) {
      const entityLabel = b.entity.canonical !== 'ITB STIKOM Bali' && b.entity.canonical !== 'INSTITUTION_ROOT'
        ? b.entity.canonical
        : 'INSTITUTION_ROOT';
      if (!claimsByEntity.has(entityLabel)) {
        claimsByEntity.set(entityLabel, []);
        bindingsByEntity.set(entityLabel, []);
      }
      bindingsByEntity.get(entityLabel).push(b);
      for (const claim of b.claims) {
        claimsByEntity.get(entityLabel).push(claim);
      }
    }

    const multipleEntities = Array.from(claimsByEntity.keys()).filter(k => k !== 'INSTITUTION_ROOT').length > 1;

    for (const [entityLabel, claims] of claimsByEntity.entries()) {
      const lines = [];
      if (entityLabel !== 'INSTITUTION_ROOT' && (multipleEntities || supportedBindings.length > 1)) {
        lines.push(`*${entityLabel}:*`);
      }

      const seenLines = new Set();
      for (const claim of claims) {
        const cleaned = cleanPropositionText(claim.value || claim.proposition || '');
        if (cleaned && !seenLines.has(cleaned)) {
          seenLines.add(cleaned);
          lines.push(cleaned);
        }
      }

      const entityBindings = bindingsByEntity.get(entityLabel) || [];
      const hasQualifierUnproven = entityBindings.some(b => b.evaluatorStatus === 'PARTIALLY_SUPPORTED' && b.unsupportedDimensions?.includes('qualifier'));
      const hasRecipientUnproven = entityBindings.some(b => b.evaluatorStatus === 'PARTIALLY_SUPPORTED' && b.unsupportedDimensions?.includes('recipient'));

      if (hasQualifierUnproven) {
        lines.push('_(Catatan: Terkait kriteria khusus/bebas biaya belum ditemukan penegasan eksplisit pada dokumen resmi terkait.)_');
      }
      if (hasRecipientUnproven) {
        lines.push('_(Catatan: Informasi di atas berlaku untuk lingkup sasaran resmi yang tercantum pada dokumen.)_');
      }

      if (lines.length > 0) {
        sections.push(lines.join('\n'));
      }
    }
  }

    // Explicitly bound any unproven comparative relation when multiple entities are compared
    const unprovenRelation = answerPlan.bindings.find(b => (b.field === 'relation' || b.role === 'relation') && (b.evaluatorStatus === 'UNSUPPORTED' || b.evaluatorStatus === 'PARTIALLY_SUPPORTED'));
    if (unprovenRelation && supportedBindings.length >= 2) {
      sections.push('_(Catatan: Berdasarkan dokumen resmi yang tersedia, tidak terdapat penegasan bahwa kedua program tersebut sama atau setara secara formal.)_');
    }

  // 2. Render conflicting bindings
  if (conflictingBindings.length > 0) {
    for (const b of conflictingBindings) {
      const conflictLines = [
        `Terdapat perbedaan informasi pada dokumen resmi terkait *${b.entity.canonical || b.field}*:`
      ];
      for (const c of b.conflicts) {
        conflictLines.push(`- Sumber 1 (${c.sourceA || 'data A'}): ${c.claimA || 'N/A'}`);
        conflictLines.push(`- Sumber 2 (${c.sourceB || 'data B'}): ${c.claimB || 'N/A'}`);
      }
      conflictLines.push('Agar tidak keliru, disarankan untuk mengonfirmasi langsung ke unit kampus terkait.');
      sections.push(conflictLines.join('\n'));
    }
  }

  // 3. Render unsupported bindings (if ALL are unsupported or when needed for completeness)
  if (supportedBindings.length === 0 && conflictingBindings.length === 0) {
    const unsuppEntities = [...new Set(unsupportedBindings.map(b => b.entity.canonical).filter(e => e && e !== 'ITB STIKOM Bali' && e !== 'INSTITUTION_ROOT'))];
    if (unsuppEntities.length > 0) {
      return `Saya belum menemukan data resmi mengenai ${unsuppEntities.join(' dan ')} pada dokumen ITB STIKOM Bali yang tersedia saat ini. Agar tidak keliru, kakak bisa mengonfirmasi langsung ke layanan kampus atau Admin PMB terkait.`;
    }
    return 'Saya belum menemukan data yang sesuai pada dokumen ITB STIKOM Bali yang tersedia saat ini. Agar tidak keliru, kakak dapat mengonfirmasi ke pihak kampus atau admin terkait.';
  } else if (unsupportedBindings.length > 0 && supportedBindings.length > 0) {
    // Some subrequests were unsupported while others were supported
    const internalFieldRegex = /^(?:programType|programScope|geographicScope|availability|contrast|relation)$/i;
    const unsuppFields = [...new Set(unsupportedBindings.map(b => b.field).filter(f => f && f !== 'general' && !internalFieldRegex.test(f)))];
    if (unsuppFields.length > 0) {
      sections.push(`_(Informasi mengenai ${unsuppFields.join(', ')} belum tercantum secara lengkap pada data saat ini.)_`);
    }
  }

  return sections.join('\n\n');
}

module.exports = {
  composeGroundedAnswerPlan,
  renderGroundedAnswer
};
