# Training Upload Deploy Checklist

Checklist ini dipakai setelah update backend agar kasus upload PDF training bisa diverifikasi dengan cepat di VPS production.

## PM2 Update

1. Masuk ke folder aplikasi:
   `cd ~/bot-stikom`
2. Ambil update terbaru:
   `git pull`
3. Install dependency backend:
   `npm ci --omit=dev`
4. Build admin UI static export:
   `npm --prefix admin-ui ci`
   `npm --prefix admin-ui run build`
5. Restart backend dan reload environment:
   `pm2 restart bot-stikom --update-env`
6. Lihat log awal restart:
   `pm2 logs bot-stikom --lines 100`

## Verifikasi Setelah Deploy

1. Cek dependency OCR host:
   `npm run diag:ocr:deps`
2. Cek apakah PDF punya native text:
   `npm run diag:pdf:text -- "/path/ke/file.pdf"`
3. Cek end-to-end parser + simpan DB + cleanup:
   `npm run verify:training:upload -- "/path/ke/file.pdf"`

Alternatif jika Anda tidak memakai `npm run` di VPS:
- `node scripts/debugOcrDeps.js`
- `node scripts/debugPdfText.js "/path/ke/file.pdf"`
- `node scripts/verifyTrainingUpload.js "/path/ke/file.pdf"`

Catatan:
- Script `verify:training:upload` akan mencoba menyimpan row test ke `TrainingData`, lalu langsung menghapus row tersebut jika sukses.
- Jika hanya ingin cek parser tanpa menyentuh database:
  `npm run verify:training:upload -- "/path/ke/file.pdf" --skip-store`
- Jika tidak memakai `npm run`, versi direct command-nya adalah:
   `node scripts/verifyTrainingUpload.js "/path/ke/file.pdf" --skip-store`
- Jangan upload `node_modules` dari Windows ke VPS Linux. Dependency seperti `sharp` dan binary Prisma bisa mismatch. Install dependency langsung di host Linux atau rebuild image/container Linux.

## Membaca Hasil

- Jika `parseAndStore.success=true`:
  Backend dan database pada host tersebut sebenarnya sudah bisa menerima file. Jika upload web masih gagal, kemungkinan proses live belum pakai code terbaru atau request masih masuk ke instance lama.
- Jika `nativePdf.trimmedLength` besar tetapi hasil web tetap `OCR_FAILED_LOW_QUALITY`:
  Hampir pasti ada stale deploy atau runtime mismatch di server live.
- Jika `nativePdf.trimmedLength` kecil dan `parseAndStore.errorCode` mengarah ke OCR:
  Host production memang bergantung pada OCR. Lengkapi Ghostscript dan ImageMagick atau GraphicsMagick, serta cek `OCR_LANG_PATH`.
- Jika `db.ok=false`:
  Fokus ke `DATABASE_URL`, firewall, atau env file yang termuat saat process start.

## File Contoh Dari Kasus Ini

File contoh yang sudah diverifikasi lokal:
`rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf`

Pada code repo saat ini, file tersebut:
- punya native text sekitar 7400 karakter
- bisa diparse oleh `FileParser.parsePdf()`
- bisa disimpan ke `TrainingData` lalu dihapus lagi oleh script verifikasi

Jika file yang sama masih gagal di web production, fokuskan investigasi ke proses deploy atau environment host live.