const formatter = require('../src/utils/whatsappFormatter');
const queries = [
  'berapa biaya sistem informasi gelombang 3A',
  'berapa biaya prodi sistem informasi gelombang 3A',
  'berapa biaya program studi sistem informasi gelombang 3A'
];
for (const q of queries) {
  const out = formatter.buildHumanizedWhatsappReply({
    mainAnswer: 'Biaya pendidikan Program Studi Sistem Informasi gelombang 3A adalah Rp 15.000.000 per semester.',
    userQuery: q
  });
  console.log('QUERY:', q);
  console.log(out);
  console.log('---');
}
