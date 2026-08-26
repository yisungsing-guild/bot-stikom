const { buildCanonicalQueryUnderstanding } = require('../engine/queryUnderstanding');
const { normalizeUserQuery } = require('../utils/queryNormalizer');

function isPureGreetingRestart(text) {
  const t = normalizeUserQuery(text || '').normalizedText;
  if (!t) return false;

  const allowTail = '(?:kak|kakak|admin|min|bot|cs|pak|bapak|ibu|bu|bang|bng)';
  const simpleGreeting = new RegExp(
    `^(?:halo|hallo|hai|hi|hello|assalamualaikum|salam|permisi|selamat pagi|selamat siang|selamat sore|selamat malam|met pagi|met siang|met sore|met malam)(?: ${allowTail})?$`
  , 'i');
  if (simpleGreeting.test(t)) return true;

  if (/^hal+o+(?: (?:kak|admin|min|bot|cs|pak|ibu|bu|bang))?$/.test(t)) return true;
  if (/^assalamu(?: |)alaikum(?: (?:kak|admin|min|bot|cs|pak|ibu|bu|bang))?$/.test(t)) return true;
  return false;
}

function mapCanonicalToLegacyIntentLabel(canonical) {
  const intent = String(canonical && canonical.intent && canonical.intent.primary || '');
  const domain = String(canonical && canonical.domain && canonical.domain.primary || '');

  if (intent === 'ask_fee' || domain === 'fee') return 'COST';
  if (intent === 'ask_scholarship' || domain === 'scholarship') return 'SCHOLARSHIP';
  if (intent === 'ask_schedule' || domain === 'pmb_schedule') return 'SCHEDULE';
  if (intent === 'ask_accreditation' || domain === 'accreditation') return 'ACCREDITATION';
  if (domain === 'student_organization' || intent.startsWith('ask_organization')) return 'UKM';
  if (intent === 'ask_program_curriculum' || domain === 'program_curriculum') return 'ACADEMIC_PROGRAM';
  if (domain === 'career' || intent === 'ask_career_service') return 'ACADEMIC_PROGRAM';
  if (domain === 'program' || domain === 'double_degree' || domain === 'program_recommendation') return 'PROGRAM';
  if (domain === 'small_talk') return 'SMALL_TALK';
  return 'GENERAL';
}

function detectIntentDetails(question) {
  const raw = String(question || '');
  const canonical = buildCanonicalQueryUnderstanding(raw);
  let label = mapCanonicalToLegacyIntentLabel(canonical);

  const norm = normalizeUserQuery(raw).normalizedText;
  const isGreeting = isPureGreetingRestart(raw) || /\b(?:halo|hallo|hai|hi|selamat\s+(?:pagi|siang|sore|malam)|apa\s+kabar|gimana\s+kabar|kamu\s+siapa|siapa\s+kamu)\b/i.test(norm);
  if (label === 'GENERAL' && isGreeting) {
    label = 'SMALL_TALK';
  }

  const primaryProgram = canonical.entities && Array.isArray(canonical.entities.programs) && canonical.entities.programs.length > 0
    ? canonical.entities.programs[0].canonical
    : (canonical.entities && Array.isArray(canonical.entities.internationalPrograms) && canonical.entities.internationalPrograms.length > 0
      ? canonical.entities.internationalPrograms[0].canonical
      : null);

  const waveRaw = norm.match(/\b(1[a-c]|2[a-c]|3[a-c]?|4[a-c]?|khusus|i{1,4}|iv)\b/i);
  const requestedWave = waveRaw
    ? waveRaw[0].toLowerCase()
    : (canonical.temporal && canonical.temporal.requestedWave
      ? (canonical.temporal.requestedWave.key ? canonical.temporal.requestedWave.key.toLowerCase() : String(canonical.temporal.requestedWave).toLowerCase())
      : null);

  return {
    label,
    confidence: canonical.intent.confidence || 0.82,
    isAmbiguous: false,
    isUnderSpecified: label === 'GENERAL',
    canonicalUnderstanding: canonical,
    entities: {
      program: primaryProgram,
      wave: requestedWave,
      academicIntent: canonical.intent.primary
    }
  };
}

function detectIntent(question) {
  return detectIntentDetails(question).label;
}

module.exports = {
  detectIntent,
  detectIntentDetails,
  isPureGreetingRestart
};

