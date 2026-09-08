const { buildCanonicalQueryUnderstanding } = require('./queryUnderstanding');
const { extractProfiles, formatRp } = require('./feeComparisonEngine');
const { parseCompactRupiahNumber } = require('../utils/rupiahParser');

function resolveContextualFeeTotal(question, session = {}, loadIndex, now = Date.now()) {
  const current = buildCanonicalQueryUnderstanding(question).contract;
  const totalRelation = current.constraints?.feeType === 'total_estimate' || current.requestedFields.includes('totalFee');
  const ellipticalTotal = ['general', 'fee'].includes(current.domain)
    && (/\btotal(?:nya)?\b/i.test(question) || /\b(?:hitung|jumlahkan|kalkulasi)\b.*\b(?:semua(?:nya)?|seluruhnya)\b/i.test(question));
  if (/\b(?:sks|kredit|matkul|mata\s+kuliah|semester|halaman|durasi|waktu|tahun|bulan|hari|jam|kuota)\b/i.test(question) && !/\b(?:biaya|bayar|tarif|uang|rupiah|rp\.?|dana|dpp)\b/i.test(question)) return null;
  if (!totalRelation && !ellipticalTotal) return null;
  const fresh = value => {
    const ts = new Date(value?.at || value?.establishedAt || value?.ts || '').getTime();
    const maxAge = Number(process.env.CONTEXT_DECAY_MS) || 30 * 60 * 1000;
    return Number.isFinite(ts) && now >= ts && now - ts <= maxAge;
  };
  const programEntities = contract => contract.entities.filter(entity => entity.group === 'programs' || entity.type === 'program');
  const explicit = programEntities(current);
  const stable = session.stableSemanticContext;
  const messages = Array.isArray(session.messages) ? session.messages : [];
  const lastBot = [...messages].reverse().find(message => message.direction === 'bot');
  const priorText = lastBot && fresh(lastBot) ? String(lastBot.message || '') : '';
  const prior = priorText ? buildCanonicalQueryUnderstanding(priorText).contract : null;
  const priorPrograms = prior ? programEntities(prior) : [];
  const stablePrograms = stable && fresh(stable) && ['fee', 'program', 'program_profile'].includes(stable.domain)
    ? programEntities(buildCanonicalQueryUnderstanding(stable.program || stable.entity || '').contract) : [];
  const inherited = priorPrograms.length === 1 ? priorPrograms : stablePrograms;
  const entities = explicit.length ? explicit : (current.entities.some(entity => entity.group === 'unknown') ? [] : inherited);
  const contract = { ...current, domain: 'fee', intent: 'ask_fee', requestType: 'fee',
    requestedFields: ['amount', 'totalFee'], entities: entities.length === 1 ? entities : current.entities,
    constraints: { ...current.constraints, feeType: 'total_estimate' }, answerShape: 'amount_or_no_data',
    contextReference: { mode: explicit.length ? 'current_turn' : 'compatible_fee_context' } };
  const program = entities.length === 1 ? entities[0].canonical : null;
  const clarify = reason => ({ handled: true, outputType: 'CLARIFICATION',
    source: 'semantic-rag-fee-clarification', semanticContract: contract,
    clarification: { domain: 'fee', missingSlots: [program ? 'feeBreakdown' : 'program'] },
    answer: program
      ? `Untuk menghitung total ${program}, rincian komponen biaya yang mana yang ingin dijumlahkan? Mohon sertakan rincian biaya dan gelombang yang berlaku.`
      : 'Untuk menghitung total pembayaran, prodi atau program mana yang dimaksud? Mohon sertakan rincian biaya yang ingin dijumlahkan.',
    debug: { reason, inheritedProgram: explicit.length ? null : program } });
  if (!program) return clarify('missing_program');
  if (!priorText || priorPrograms.length !== 1 || priorPrograms[0].canonical !== program
    || (stable && (!fresh(stable) || !['fee', 'program', 'program_profile'].includes(stable.domain)))) return clarify('no_compatible_fresh_breakdown');
  const profile = extractProfiles(loadIndex()).find(item => item.label === program);
  if (!profile) return clarify('no_compatible_fee_profile');
  const specifications = [
    { key: 'pendaftaran', label: 'Biaya pendaftaran', pattern: /pendaftaran/i },
    { key: 'dpp', label: 'DPP', pattern: /\bdpp\b|dana pendidikan pokok/i },
    { key: 'atribut', label: 'Atribut/perlengkapan awal', pattern: /atribut|perlengkapan/i }
  ];
  const lines = priorText.split(/\r?\n/).filter(line => /^\s*-/.test(line));
  const included = [];
  for (const spec of specifications) {
    if (!Number.isFinite(profile[spec.key])) continue;
    const matching = lines.filter(line => spec.pattern.test(line) && !/total|potongan|diskon|semester|tahun|subject/i.test(line));
    if (matching.length !== 1) return clarify('missing_or_ambiguous_component');
    const amount = matching[0].match(/\bRp\.?\s*([\d.]+(?:,\d+)?)/i);
    if (!amount || parseCompactRupiahNumber(amount[1]) !== profile[spec.key]) return clarify('component_evidence_mismatch');
    included.push({ key: spec.key, label: spec.label, amount: profile[spec.key] });
  }
  if (included.length < 2 || !included.some(item => item.key === 'pendaftaran')) return clarify('insufficient_initial_entry_components');
  if (current.constraints.registrationWave || /setelah\s+(?:potongan|diskon)/i.test(question)) return clarify('discount_scope_requires_components');
  const total = included.reduce((sum, item) => sum + item.amount, 0);
  return { handled: true, outputType: 'DETERMINISTIC_RESULT', source: 'followup_compute_total',
    semanticContract: contract, answerProvenance: 'derived_from_grounded_fee_components',
    calculationScope: 'initial_entry_total',
    answer: `Total biaya awal masuk ${program} sebelum potongan gelombang:\n\n`
      + included.map(item => `- ${item.label}: ${formatRp(item.amount)}`).join('\n')
      + `\n\nTotal: ${formatRp(total)}.\nBiaya per semester dan biaya berulang tidak termasuk dalam total ini.`,
    debug: { included, total, inheritedProgram: explicit.length ? null : program, sourceFiles: profile.sourceFiles?.filter(file => /biaya/i.test(file)) || [] } };
}

module.exports = { resolveContextualFeeTotal };
