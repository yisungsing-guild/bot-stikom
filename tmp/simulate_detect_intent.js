const wf = require('../src/utils/whatsappFormatter');

const messageText = `Biaya pendaftaran: Rp 500.000 untuk Gelombang 2C. DPP (Dana Pendidikan Pokok): Rp 14.000.000. Biaya pendidikan per semester (UKT): Rp 6.500.000.`;
const userQuery = 'Berapa biaya TI gelombang 2C?';
const incomingIntent = 'COST';
const incomingConfidence = 0.95;

const candidateIntent = wf.detectIntentFromAnswer(messageText, userQuery);
const mappedIncomingIntent = wf.mapProviderIntentToFormatter(incomingIntent);

console.log('[SIM_TRACE_INPUT]', { incomingIntent, incomingConfidence, mappedIncomingIntent, candidateIntent, userQuery, messagePreview: messageText.slice(0,200) });

// Apply patched detectResponseIntent logic
const HIGH_CONF_THRESHOLD = 0.80;
const incomingIsHigh = incomingIntent && incomingConfidence >= HIGH_CONF_THRESHOLD;
const incomingIsGeneral = !mappedIncomingIntent || String(mappedIncomingIntent).toLowerCase() === 'general' || String(mappedIncomingIntent).toLowerCase() === 'unknown';

let finalIntent;
if (incomingIsHigh && !incomingIsGeneral) {
  console.log('[TRACE_INTENT_LOCKED]', {
    incomingIntent,
    mappedIncomingIntent,
    incomingConfidence,
    candidateIntent,
    reason: 'high-confidence provider intent locked as source-of-truth'
  });
  finalIntent = mappedIncomingIntent;
} else {
  if (candidateIntent && candidateIntent !== mappedIncomingIntent && candidateIntent !== 'general') {
    console.log('[TRACE_INTENT_OVERRIDE]', {
      action: 'overridden',
      incomingIntent,
      mappedIncomingIntent,
      incomingConfidence,
      candidateIntent,
      userQuery,
      preview: messageText.slice(0,240),
      reason: 'candidate intent allowed to override (incoming general/low-confidence)'
    });
    finalIntent = candidateIntent;
  } else if (mappedIncomingIntent) {
    console.log('[TRACE_INTENT_PRESERVED]', {
      action: 'preserved',
      incomingIntent,
      mappedIncomingIntent,
      incomingConfidence,
      candidateIntent,
      userQuery,
      preview: messageText.slice(0,240),
      reason: 'mapped incoming used when candidate is general or absent'
    });
    finalIntent = mappedIncomingIntent;
  } else if (candidateIntent) {
    console.log('[TRACE_INTENT_FINAL_DECISION]', { final: candidateIntent, reason: 'use candidate intent (no mapped incoming)'});
    finalIntent = candidateIntent;
  } else {
    console.log('[TRACE_INTENT_FINAL_DECISION]', { final: 'general', reason: 'fallback general' });
    finalIntent = 'general';
  }
}

// Now call humanizer to get selectedTemplate (it logs TRACE_TEMPLATE_SELECTION)
console.log('\n--- Humanizer Output (selected template inside logs) ---');
const humanized = wf.buildHumanizedWhatsappReply({ mainAnswer: messageText, userQuery, intent: finalIntent });
console.log('\n--- End Humanizer Output ---\n');

console.log('[SIM_TRACE_RESULT]', { incomingIntent, mappedIncomingIntent, candidateIntent, finalIntent });
console.log('Humanized preview:\n', humanized.slice(0,800));
