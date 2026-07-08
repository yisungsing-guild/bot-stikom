const q = `Program Studi: Teknologi Informasi
User meminta perhitungan total pembayaran untuk mendaftar/biaya awal masuk.
Tugas:
1) Jika dokumen mencantumkan TOTAL (mis. total biaya awal masuk/total pembayaran), sebutkan totalnya.
2) Jika tidak ada total, jumlahkan komponen yang tertulis (contoh: biaya pendaftaran + DPP + biaya semester awal/komponen awal masuk) dan tampilkan perhitungannya.
3) Jika total bergantung skenario (gelombang/potongan, pengakuan SKS, cuti, tesis, atau pilihan pembayaran/cicilan), ajukan maksimal 1 pertanyaan klarifikasi untuk menentukan skenario.

Pertanyaan user: Berapa biaya masuk TI?`; const regex = /(?:sistem\s+komputer|\bsk\b|s\.?\s*k(?:om(?:puter)?)?\.?)/; console.log(regex.test(q.toLowerCase())); console.log(q.toLowerCase().match(regex));
