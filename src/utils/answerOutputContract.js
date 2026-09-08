const { hasConcreteNumberOrAmount } = require('./answerAmount');

function validateClarificationOutput(result, contract) {
  if (result.outputType !== 'CLARIFICATION') return null;
  const clarification = result.clarification;
  const fail = reason => ({ ok: false, reason });
  if (!clarification || !contract || clarification.domain !== contract.domain) return fail('clarification_domain_mismatch');
  const slots = clarification.missingSlots;
  if (!Array.isArray(slots) || !slots.length) return fail('clarification_missing_slot_contract');
  const entities = Array.isArray(contract.entities) ? contract.entities : [];
  const constraints = contract.constraints || {};
  const slotRules = {
    program: { present: entities.some(e => e.group === 'programs' || e.type === 'program'), pattern: /\b(?:prodi|program|jurusan)(?:nya)?\b/i },
    wave: { present: !!constraints.registrationWave, pattern: /\bgelombang(?:nya)?\b/i },
    topic: { present: contract.domain !== 'general', pattern: /\btopik\b/i },
    partner: { present: entities.some(e => e.role === 'partner' || e.type === 'partner'), pattern: /\b(?:partner|mitra)\b/i },
    academicLevel: { present: !!contract.academicLevel, pattern: /\b(?:jenjang|S1|S2|D3)\b/i }
  };
  for (const slot of slots) {
    const rule = slotRules[slot];
    if (!rule || rule.present || !rule.pattern.test(result.answer || '')) return fail('clarification_slot_incompatible');
  }
  if (contract.requestType === 'fee' && hasConcreteNumberOrAmount(result.answer, { financial: true })) {
    return fail('clarification_contains_amount_claim');
  }
  return { ok: true, reason: 'validated_missing_slot_clarification', needs: slots, missing: [] };
}

function projectClarificationAssertions(result, contract) {
  const validation = validateClarificationOutput(result, contract);
  const original = String(result.answer || '');
  if (!validation || !validation.ok) return { text: original, optionLines: 0, validation };
  const slots = result.clarification.missingSlots;
  if (!slots.some(slot => ['program', 'partner', 'academicLevel'].includes(slot))) {
    return { text: original, optionLines: 0, validation };
  }
  // Resolve choice labels, not a second intent. All non-option clauses remain assertions.
  const { PROGRAMS, resolveSourceDomainEntities } = require('../engine/queryUnderstanding');
  const isOptionLabel = value => {
    const label = value.trim().replace(/[.?]$/, '').trim();
    if (!label || /[.!?:;\d]/.test(label.replace(/\b[SD][123]\b/gi, ''))
      || /\b(?:adalah|tersedia|memiliki|mendapat|gratis|biaya|berlangsung|dijamin|wajib|bisa|dapat|di|ke)\b/i.test(label)) return false;
    if (slots.includes('academicLevel') || slots.includes('program')) {
      if (/^[SD][123]$/i.test(label)) return true;
    }
    if (slots.includes('program') && PROGRAMS.some(program =>
      [program.canonical, program.code, ...program.aliases].some(alias => alias.toLowerCase() === label.toLowerCase()))) return true;
    if (slots.includes('program') || slots.includes('partner')) {
      const entities = resolveSourceDomainEntities(label);
      const words = label.toLowerCase().split(/\s+/);
      return (entities.internationalPrograms || []).some(entity => {
        const canonicalWords = new Set(String(entity.canonical).toLowerCase().split(/\s+/));
        return words.every(word => canonicalWords.has(word));
      });
    }
    return false;
  };
  let optionLines = 0;
  const text = original.split('\n').filter(line => {
    const match = line.trim().match(/^(?:Kalau\s+(?:program|partner)\s+([^,]+),\s*)?(?:balas|pilih|sebutkan)(?:\s+salah\s+satu)?\s*:\s*(.+)$/i);
    if (!match || (match[1] && !isOptionLabel(match[1]))) return true;
    const choices = match[2].split(/\s*\/\s*|\s*,\s*|\s+atau\s+/i);
    if (!choices.length || !choices.every(isOptionLabel)) return true;
    optionLines++;
    return false;
  }).join('\n');
  return { text, optionLines, validation };
}

module.exports = { validateClarificationOutput, projectClarificationAssertions };
