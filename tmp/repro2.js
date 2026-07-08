const { buildHumanizedWhatsappReply } = require('../src/utils/whatsappFormatter');
const raw = `Baik, kak. Terimakasih atas pertanyaannya.

Untuk program studi Bisnis Digital, rincian biaya sebagai berikut:

Pendaftaran:
* Biaya pendaftaran: Rp 500.000
* Potongan biaya pendaftaran: Rp 0
Total biaya pendaftaran: Rp 500.000

Biaya awal masuk untuk Prodi Bisnis Digital:
* Jas almamater dan topi: Rp 750.000
* Kaos, tas, GMTI: Rp 750.000
Subtotal biaya awal masuk: Rp 2.000.000
* Potongan biaya DPP: Rp 0
Total biaya awal masuk setelah potongan: Rp 2.000.000

Untuk meringankan biaya, tersedia berbagai macam beasiswa yang bisa dimanfaatkan sesuai syarat dan ketentuan yang berlaku termasuk:
* Beasiswa KIP
* Beasiswa 1K1S (Satu Keluarga Satu Sarjana)
* Beasiswa Prestasi
* Beasiswa Yayasan
* Beasiswa khusus untuk alumni — silakan hubungi PMB untuk detail
* Kuliah Sambil Kerja di Luar Negeri

Kakak mau tanya yang mana? Balas saja: "ranking" / "prestasi" / "KIP" / "1K1S" / "Yayasan".`;
console.log(buildHumanizedWhatsappReply({ mainAnswer: raw, userQuery: 'Biaya Bisnis Digital berapa?', intent: 'COST', context: { program: 'Bisnis Digital' } }));
