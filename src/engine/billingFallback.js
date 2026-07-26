function tryBillingChangeFallback(question) {
  const q = String(question || '').toLowerCase();
  if (!/\b(tagihan\s+berubah|kenapa\s+tagihan|tagihan\s+berubah\s+kenapa)\b/i.test(q)) return null;
  return {
    answer: [
      'Tagihan bisa berubah karena beberapa alasan, misalnya ada komponen biaya yang diperbarui, penambahan denda, atau penyesuaian administrasi.',
      '',
      'Langkah yang disarankan: cek riwayat tagihan di portal akademik dan hubungi bagian keuangan untuk klarifikasi; siapkan nomor mahasiswa dan bukti pembayaran jika perlu.',
      '',
      'Saya bisa bantu carikan kontak bagian keuangan jika kakak mau.'
    ].join('\n'),
    source: 'semantic-rag-billing-change-fallback'
  };
}

module.exports = { tryBillingChangeFallback };