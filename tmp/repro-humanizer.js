const { buildHumanizedWhatsappReply } = require('../src/utils/whatsappFormatter');
const raw = `Baik, kak. Terimakasih atas pertanyaannya.

Untuk program studi Teknologi Informasi, rincian biaya berikut ini:

* Biaya awal masuk: Rp 2.000.000
* Biaya per semester: Rp 6.500.000
* Biaya seragam: Rp 750.000

Untuk meringankan biaya, tersedia berbagai macam beasiswa yang bisa dimanfaatkan termasuk:
* Beasiswa KIP
* Beasiswa 1K1S
* Beasiswa Prestasi

Apakah Kakak ingin dijelaskan tentang?
* Biaya perkuliahan program studi yang lainnya
* Salah satu jenis beasiswa
* Fasilitas yang ada di ITB STIKOM Bali
Silahkan diketikkan.`;

const queries = [
  'Berapa biaya pendaftaran TI?',
  'Apa saja fasilitas TI?',
  'Saya ingin tahu informasi tentang TI'
];
for (const query of queries) {
  console.log('--- QUERY:', query);
  console.log(buildHumanizedWhatsappReply({ mainAnswer: raw, userQuery: query }));
  console.log('\n');
}
