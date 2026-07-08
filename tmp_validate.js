const humanizer = require('./src/engine/humanizer');
const formatter = require('./src/utils/whatsappFormatter');
const sample = 'Program studi TI berfokus pada infrastruktur TI.\n\nUntuk meringankan biaya beasiswa KIP, Anda bisa...';
const cleaned = humanizer.removeIrrelevantMarketingSections(sample, 'program_definition');
const reply = formatter.buildHumanizedWhatsappReply({ mainAnswer: sample, userQuery: 'Apa itu Teknologi Informasi?', intent: 'COST', context: { program: 'Teknologi Informasi', source: 'rag' } });
console.log(JSON.stringify({ cleaned, reply }, null, 2));
console.log('mappedIntent', formatter.mapProviderIntentToFormatter('COST'));
console.log('mappedIntent2', formatter.mapProviderIntentToFormatter('SCHOLARSHIP'));
console.log('mappedIntent3', formatter.mapProviderIntentToFormatter('ACADEMIC_PROGRAM'));
