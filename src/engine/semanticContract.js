function toArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function unique(values) {
  return Array.from(new Set(toArray(values).map(value => String(value).trim()).filter(Boolean)));
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\u00a0]/g, ' ')
    .replace(/[^a-z0-9\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function flattenEntities(entities) {
  const source = entities && typeof entities === 'object' ? entities : {};
  const out = [];
  for (const [group, list] of Object.entries(source)) {
    for (const item of toArray(list)) {
      const canonical = String(item && typeof item === 'object' ? (item.canonical || item.name || item.value || '') : item || '').trim();
      if (!canonical) continue;
      out.push({
        canonical,
        type: String(item && typeof item === 'object' ? (item.type || group) : group).trim(),
        role: String(item && typeof item === 'object' ? (item.role || '') : '').trim(),
        group
      });
    }
  }
  return out;
}

function inferRequestType(canonical) {
  const intent = String(canonical && canonical.intent && canonical.intent.primary || '').trim();
  const qType = String(canonical && canonical.questionType || '').trim();
  const fields = new Set(toArray(canonical && canonical.requestedFields));
  const raw = normalizeText((canonical && canonical.rawQuery) || (canonical && canonical.normalizedQuery) || '');
  if (intent === 'ask_general') return 'topic_opening';
  if (/definition/.test(intent) || qType === 'definition' || fields.has('definition')) return 'definition';
  if (/link|tautan|url|website|situs|channel|kanal|lewat mana/.test(raw) && /daftar|pendaftaran|pendaftarannya|registrasi|pmb|mahasiswa baru|camaba/.test(raw)) return 'registration_channel';
  if (/fee/.test(intent) || fields.has('amount')) return 'fee';
  if (intent === 'ask_contact' || fields.has('contact') || fields.has('phone') || fields.has('channel')) return 'contact';
  if ((canonical && canonical.constraints && canonical.constraints.relationType === 'double_degree_sequence') || qType === 'sequence') return 'sequence';
  if (/schedule|current_wave/.test(intent) || qType === 'schedule') return 'schedule';
  if (/registration_how|data_correction/.test(intent) || fields.has('procedureSteps')) return 'procedure';
  if (/requirements/.test(intent) || fields.has('requirements')) return 'requirements';
  if (/list/.test(intent) || fields.has('programList') || fields.has('organizationList')) return 'list';
  if (/count/.test(intent) || /academic_numeric/.test(intent) || fields.has('organizationCount') || fields.has('creditCount') || fields.has('sksWeight')) return 'count';
  if (/schedule|current_wave/.test(intent) || qType === 'schedule') return 'schedule';
  if (/comparison/.test(intent) || fields.has('contrast')) return 'comparison';
  if (/recommendation/.test(intent)) return 'recommendation';
  if (/institution_history|facility|document/.test(intent)) return 'specific_fact';
  if (/availability/.test(intent) || /\b(?:ada|punya|tersedia|memiliki)\b/i.test(raw)) return 'availability';
  return qType || intent || 'unknown';
}
function buildSemanticContract(canonical) {
  const source = canonical && typeof canonical === 'object' ? canonical : {};
  const constraints = source.constraints && typeof source.constraints === 'object' ? { ...source.constraints } : {};
  const entities = flattenEntities(source.entities);
  const requestType = inferRequestType(source);
  return Object.freeze({
    version: 1,
    raw: source.rawQuery || '',
    normalized: source.normalizedQuery || '',
    domain: source.domain && source.domain.primary || 'general',
    intent: source.intent && source.intent.primary || 'ask_general',
    requestType,
    requestedFields: unique(source.requestedFields),
    entities,
    entityType: unique(entities.map(entity => entity.type || entity.group)),
    academicLevel: constraints.academicLevel || (Array.isArray(constraints.academicLevels) && constraints.academicLevels.length === 1 ? constraints.academicLevels[0] : null),
    relations: unique([constraints.relationType, constraints.comparisonTarget, constraints.externalRelation && constraints.externalRelation.relationType]),
    constraints,
    contextReference: source.contextReference || { mode: 'current_turn', resolvedFrom: null },
    answerShape: {
      topic_opening: 'acknowledge_topic_only',
      definition: 'definition_first',
      registration_channel: 'channel_or_link',
      procedure: 'steps',
      fee: 'amount_or_no_data',
      schedule: 'date_or_period',
      requirements: 'requirements',
      list: 'bounded_list',
      count: 'count',
      comparison: 'contrast',
      recommendation: 'recommendation',
      availability: 'yes_no_or_no_data',
      contact: 'contact_or_no_data'
    }[requestType] || 'direct_answer',
    routingQuery: source.routingQuery || source.normalizedQuery || source.rawQuery || '',
    confidence: source.confidence || 0
  });
}

function hasEntity(text, entity) {
  const normalized = normalizeText(text);
  const canonical = normalizeText(entity && entity.canonical);
  if (!canonical) return true;
  if (canonical.length <= 3) return new RegExp(`(^|\\s)${canonical}(\\s|$)`, 'i').test(normalized);
  if (normalized.includes(canonical)) return true;
  const aliases = {
    'sistem informasi': ['si'],
    'teknologi informasi': ['ti', 'informatika'],
    'bisnis digital': ['bd'],
    'sistem komputer': ['sk'],
    'manajemen informatika': ['mi'],
    's2 sistem informasi': ['s2', 'magister sistem informasi', 'pascasarjana sistem informasi'],
    'sejarah itb stikom bali': ['itb stikom bali', 'stikom bali', 'yayasan widya dharma shanti', '20 mei 2001'],
    'form iku pts 2024 lldikti': ['form iku', 'iku pts', 'lldikti', 'indikator kinerja', 'triwulan'],
    'inkubator bisnis inbis': ['inbis', 'inkubator bisnis', 'unit kewirausahaan'],
    'double degree': ['dual degree', 'program ganda'],
    'double degree dnui': ['dnui', 'dalian'],
    'double degree help university': ['help university', 'help'],
    'dual degree utb': ['utb', 'universitas teknologi bandung'],
    'bem-pm itb stikom bali': ['bem', 'bem pm', 'badan eksekutif mahasiswa', 'kemahasiswaan'],
    'bem pm itb stikom bali': ['bem', 'bem pm', 'badan eksekutif mahasiswa', 'kemahasiswaan']
  };
  return (aliases[canonical] || []).some(alias => {
    const a = normalizeText(alias);
    return a.length <= 3 ? new RegExp(`(^|\\s)${a}(\\s|$)`, 'i').test(normalized) : normalized.includes(a);
  });
}

function isNoDataAnswer(answer) {
  const text = String(answer || '').trim();
  if (!text) return false;
  const positiveEvidence = /\b(?:ya,?\s+ada|berikut|berdasarkan\s+data|tersedia\s*:|program\s+double\s+degree|prodi\s+di\s+stikom)\b/i.test(text);
  if (positiveEvidence && /\b(?:belum\s+tercantum|belum\s+tersedia|belum\s+ada)\b/i.test(text)) return false;
  return /^(?:maaf[,\s]*)?(?:saya\s+)?(?:belum|tidak)\s+(?:menemukan|tersedia|ada|mendapatkan|tercantum|memiliki)\b/i.test(text)
    || /^(?:maaf[,\s]*)?(?:saya\s+)?tidak\s+cukup\s+data\b/i.test(text)
    || /^.*\bkonfirmasi\s+(?:ke|langsung)\b.*$/i.test(text) && !positiveEvidence
    || /^(?:maaf[,\s]*)?(?:saya\s+)?tidak\s+memiliki\s+(?:program\s+studi|prodi|jurusan|program)\b/i.test(text);
}
function verifyAnswerAgainstContract(contract, answer, evidence = []) {
  if (!contract || typeof contract !== 'object') return { ok: true, reason: 'no_contract' };
  const text = String(answer || '');
  if (!text.trim()) return { ok: false, reason: 'empty_answer' };
  if (isNoDataAnswer(text)) return { ok: true, reason: 'explicit_no_data' };
  const combined = text + '\n' + toArray(evidence).map(item => String(item && (item.text || item.chunk || item.content) || '')).join('\n');
  const missingEntities = toArray(contract.entities).filter(entity => entity.group !== 'unknown' && !hasEntity(combined, entity));
  if (missingEntities.length) return { ok: false, reason: 'missing_contract_entity', missingEntities: missingEntities.map(e => e.canonical) };
  const contractScope = String((contract.constraints && (contract.constraints.programScope || contract.constraints.geographicScope)) || '').toLowerCase();
  if ((contractScope === 'national' || /\bnasional\b/i.test(contract.raw)) && !/\bnasional|national|utb|universitas\s+teknologi\s+bandung|indonesia\b/i.test(text)) return { ok: false, reason: 'missing_national_constraint' };
  if ((contractScope === 'international' || /\binternasional|international\b/i.test(contract.raw)) && !/\binternasional|international|luar\s+negeri|malaysia|china|dnui|help\s+university\b/i.test(text)) return { ok: false, reason: 'missing_international_constraint' };
  if (contract.constraints && contract.constraints.registrationWave && contract.constraints.registrationWave.key) {
    const wave = contract.constraints.registrationWave;
    const key = String(wave.key || '').trim();
    const group = String(wave.group || '').trim();
    const suffix = key && group && key.toUpperCase().startsWith(group.toUpperCase()) ? key.slice(group.length) : '';
    const compactKey = key.replace(/\s+/g, '\\s*');
    const spacedKey = group && suffix ? `${group}\\s*${suffix}` : compactKey;
    const numericGroupMap = { I: '1', II: '2', III: '3', IV: '4', V: '5' };
    const numeric = numericGroupMap[group.toUpperCase()] || '';
    const numericKey = numeric && suffix ? `${numeric}\\s*${suffix}` : '';
    const variants = [compactKey, spacedKey, numericKey].filter(Boolean);
    const waveRe = new RegExp(`\\b(?:gel(?:ombang)?\\s*)?(?:${variants.join('|')})\\b`, 'i');
    if (!waveRe.test(combined)) return { ok: false, reason: 'missing_registration_wave', registrationWave: contract.constraints.registrationWave.key };
  }
  if (contract.requestType === 'fee' && !/\b(?:rp\.?|rupiah|\d[\d.,]+\s*(?:ribu|juta)?|biaya|ukt|dpp)\b/i.test(text)) return { ok: false, reason: 'fee_shape_not_satisfied' };
  if (contract.requestType === 'schedule' && !/\b(?:tanggal|jadwal|periode|gelombang|januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|20\d{2})\b/i.test(text)) return { ok: false, reason: 'schedule_shape_not_satisfied' };
  if (contract.requestType === 'count' && !/\b\d+\b|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|puluh/i.test(text)) return { ok: false, reason: 'count_shape_not_satisfied' };
  return { ok: true, reason: 'contract_preserved' };
}

module.exports = {
  buildSemanticContract,
  verifyAnswerAgainstContract,
  normalizeText
};







