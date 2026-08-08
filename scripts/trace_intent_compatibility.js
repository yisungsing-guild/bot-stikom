const { computeIntentCompatibility, detectGenericIntent } = require('../src/engine/semanticRagEngine');

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const cases = [
  {
    label: 'general-intent-neutral',
    question: 'some text',
    requestedIntent: 'general',
    evidenceText: 'some text',
    evidenceTopic: 'general'
  },
  {
    label: 'fee-schedule-evidence',
    question: 'Berapa biaya pendaftaran?',
    requestedIntent: 'fee',
    evidenceText: 'Jadwal pendaftaran Gelombang 1A: 1 Januari - 31 Maret 2026.',
    evidenceTopic: 'schedule'
  },
  {
    label: 'fee-fee-evidence',
    question: 'Berapa biaya pendaftaran?',
    requestedIntent: 'fee',
    evidenceText: 'Biaya pendaftaran adalah Rp 500.000.',
    evidenceTopic: 'fee'
  },
  {
    label: 'definition-question',
    question: 'Apa itu Sistem Informasi?',
    requestedIntent: 'general',
    evidenceText: 'Program Teknologi Informasi fokus pada pemrograman.',
    evidenceTopic: 'program'
  }
];

for (const c of cases) {
  const detectedIntent = detectGenericIntent(c.question);
  const score = computeIntentCompatibility(c.evidenceText, c.requestedIntent);
  console.log(JSON.stringify({
    label: c.label,
    question: c.question,
    requestedIntent: c.requestedIntent,
    evidenceTopic: c.evidenceTopic,
    normalizedQuestion: normalize(c.question),
    normalizedEvidence: normalize(c.evidenceText),
    detectedIntent,
    compatibilityScore: score,
    reason: score === 0.1 ? 'general intent hard-coded neutral score' : score === 0.5 ? 'neutral fallback' : score === 1 ? 'intent regex matched' : score === 0.2 ? 'intent regex did not match' : 'other'
  }, null, 2));
}
