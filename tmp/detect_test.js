const { detectIntentFromAnswer, mapProviderIntentToFormatter } = require('./src/utils/whatsappFormatter');
function detectResponseIntent(messageText, userQuery, incomingIntent = null, incomingConfidence = 0) {
  const candidateIntent = detectIntentFromAnswer(String(messageText || ''), String(userQuery || ''));
  const mappedIncomingIntent = mapProviderIntentToFormatter(incomingIntent);
  const authoritativeFormatterIntents = new Set(['biaya', 'pendaftaran', 'beasiswa', 'kampus', 'program', 'kontak', 'lokasi']);
  const finalIntent = (() => {
    if (incomingIntent && incomingConfidence >= 0.80 && authoritativeFormatterIntents.has(mappedIncomingIntent)) {
      console.log('[TRACE_INTENT_LOCKED]', {
        incomingIntent,
        mappedIncomingIntent,
        incomingConfidence,
        candidateIntent,
        reason: 'authoritative provider intent'
      });
      return mappedIncomingIntent;
    }

    if (incomingIntent && incomingConfidence >= 0.80) {
      if (candidateIntent && candidateIntent !== 'general' && candidateIntent !== mappedIncomingIntent) {
        console.log('[TRACE_INTENT_OVERRIDE]', {
          action: 'overridden',
          incomingIntent,
          mappedIncomingIntent,
          incomingConfidence,
          candidateIntent,
          userQuery: String(userQuery || ''),
          preview: String(messageText || '').slice(0, 240),
          reason: 'high confidence incoming intent vs non-general candidate'
        });
        return candidateIntent;
      }

      if (candidateIntent && candidateIntent === 'general' && mappedIncomingIntent) {
        console.log('[TRACE_INTENT_PRESERVED]', {
          action: 'preserved',
          incomingIntent,
          mappedIncomingIntent,
          incomingConfidence,
          candidateIntent,
          userQuery: String(userQuery || ''),
          preview: String(messageText || '').slice(0, 240),
          reason: 'candidate general, preserve incoming intent'
        });
      }

      return mappedIncomingIntent || candidateIntent || 'general';
    }

    if (candidateIntent && candidateIntent !== mappedIncomingIntent && candidateIntent !== 'general') {
      console.log('[TRACE_INTENT_OVERRIDE]', {
        action: 'overridden',
        incomingIntent,
        mappedIncomingIntent,
        incomingConfidence,
        candidateIntent,
        userQuery: String(userQuery || ''),
        preview: String(messageText || '').slice(0, 240),
        reason: 'candidate intent differs from mapped incoming intent'
      });
      return candidateIntent;
    }

    const reason = mappedIncomingIntent ? 'use mapped incoming intent' : candidateIntent ? 'use candidate intent' : 'fallback general';
    console.log('[TRACE_INTENT_FINAL_DECISION]', { final: mappedIncomingIntent || candidateIntent || 'general', reason });
    return mappedIncomingIntent || candidateIntent || 'general';
  })();
  return finalIntent || 'general';
}

const messageText = `Program Studi: TI\nGelombang: 2C\n...`;
const userQuery = 'Berapa biaya TI gelombang 2C?';
const incomingIntent = 'COST';
const incomingConfidence = 0.95;
console.log('RESULT:', detectResponseIntent(messageText, userQuery, incomingIntent, incomingConfidence));
