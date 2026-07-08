const { cleanMainAnswer, buildMiniSummary, formatHumanizedResponse } = require('../src/engine/humanizer');
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

Apakah Kakak ingin dijelaskan tentang?
* Biaya perkuliahan program studi yang lainnya
* Salah satu jenis beasiswa
* Fasilitas yang ada di ITB STIKOM Bali seperti Career Center, Inkubator Bisnis, Hi-Think (Program Persiapan Kerja di Bidang TI di Jepang) dll
Silahkan diketikkan.`;
console.log('CLEANED:\n', cleanMainAnswer(raw, 'biaya'));
console.log('MINI SUMMARY:', buildMiniSummary(cleanMainAnswer(raw, 'biaya'), 'biaya', 'Biaya Bisnis Digital berapa?'));
console.log('FULL HUMANIZED:\n', formatHumanizedResponse(raw, 'Biaya Bisnis Digital berapa?', { intent:'biaya' }));
