const fs = require('fs');
const formatter = require('../src/utils/whatsappFormatter');
const qtext = fs.readFileSync('./src/routes/provider.js', 'utf8');
const matchDetectIntent = qtext.match(/function detectIntent\(question\) \{([\s\S]*?)\n  \}/);
if (!matchDetectIntent) {
  console.error('detectIntent not found');
  process.exit(1);
}
const fnSource = 'function detectIntent(question) {' + matchDetectIntent[1] + '\n  }';
const providerDetectIntent = eval('(' + fnSource + ')');
const ff = fs.readFileSync('./src/utils/whatsappFormatter.js', 'utf8');
const matchDetectIntentFromQuery = ff.match(/function detectIntentFromQuery\(userQuery\) \{([\s\S]*?)\n\}/);
if (!matchDetectIntentFromQuery) {
  console.error('detectIntentFromQuery not found');
  process.exit(1);
}
const fnQuerySource = 'function detectIntentFromQuery(userQuery) {' + matchDetectIntentFromQuery[1] + '\n}';
const detectIntentFromQuery = eval('(' + fnQuerySource + ')');
const queries = [
  'berapa biaya sistem informasi gelombang 3A',
  'berapa biaya prodi sistem informasi gelombang 3A',
  'berapa biaya program studi sistem informasi gelombang 3A'
];
for (const q of queries) {
  const incoming = providerDetectIntent(q);
  const queryIntent = detectIntentFromQuery(q);
  const sampleAnswer = 'Biaya pendidikan Program Studi Sistem Informasi gelombang 3A adalah Rp 15.000.000 per semester.';
  const responseIntent = formatter.detectIntentFromAnswer(sampleAnswer, q);
  console.log('QUERY:', q);
  console.log('  provider.detectIntent ->', incoming);
  console.log('  whatsappFormatter.detectIntentFromQuery ->', queryIntent);
  console.log('  whatsappFormatter.detectIntentFromAnswer(sample fee answer) ->', responseIntent);
  console.log('---');
}
