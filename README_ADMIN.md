## Dokumentasi Admin — Sistem WhatsApp Bot

Panduan singkat untuk admin agar dapat menggunakan fitur-fitur sistem.

Untuk setup production end-to-end (domain HTTPS, webhook provider, RAG, upload gambar admin → `/media/*`), lihat: `PRODUCTION_SETUP.md`.

1) Autentikasi (Login)
- Endpoint: `POST /auth/login`
- Body: `{ "username": "admin", "password": "..." }`
- Response: `{ ok: true, token, refreshToken, expiresIn }`
- Gunakan header `Authorization: Bearer <token>` untuk semua endpoint `/admin/*`.

Multi-role (akun divisi):
- Jika tabel `AdminUser` berisi akun, login akan menggunakan database (bcrypt) dan token berisi `adminId/username/displayName/role`.
- Jika akun `AdminUser` tidak ada / DB belum siap, sistem masih fallback ke mode lama `ADMIN_USERNAME/ADMIN_PASSWORD`.

Catatan password admin (production):
- Username diambil dari `ADMIN_USERNAME`.
- Password diambil dari `ADMIN_PASSWORD`.
- Untuk production, direkomendasikan menggunakan bcrypt hash (diawali `$2...`).

Reset/set password admin (di VPS):
1. `cd ~/bot-stikom`
2. `ADMIN_PASSWORD_PLAIN="PasswordBaruKamu" node src/scripts/generateSecrets.js`
3. Copy output baris `ADMIN_PASSWORD="$2..."` lalu paste ke `.env` (ganti nilai `ADMIN_PASSWORD`).
4. Restart proses: `pm2 restart bot-stikom --update-env`

2) Konfigurasi WhatsApp Business
- File environment: atur variabel di file `.env`:
  - `WHATSAPP_PROVIDER=business`
  - `WHATSAPP_API_KEY` — API key dari Meta WhatsApp Cloud API
  - `WHATSAPP_PHONE_NUMBER_ID` — Phone Number ID
  - `WHATSAPP_BUSINESS_ACCOUNT_ID` — (opsional)
  - `WHATSAPP_WEBHOOK_VERIFY_TOKEN` — token verifikasi webhook
- Cara setup webhook:
  1. Deploy server atau gunakan `ngrok` untuk expose `http://localhost:4000`.
  2. Di Facebook Developers > WhatsApp Cloud API, tambahkan webhook URL: `https://<your-domain>/webhook`.
  3. Isi Verify Token sesuai `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
  4. Subscribe ke events: `messages`, `message_status`.
- Endpoint admin untuk bantu:
  - `GET /admin/whatsapp/webhook-setup` — instruksi setup webhook.
  - `POST /admin/whatsapp/health` — tes koneksi (mengembalikan `{ healthy: true/false }`).

3) Upload Training & RAG (Retrieval-Augmented Generation)
- Endpoint: `POST /admin/training/upload` (multipart form, field `file`)
- Setelah upload, sistem memproses file dan men-trigger ingest RAG di background.
- Query RAG: `POST /admin/rag/query` Body: `{ "question": "...", "topK": 3 }` (butuh token)
- Manual ingest existing training: `POST /admin/rag/ingest/:id`.

## Membuat Akun Admin Divisi (Multi Role)

Disarankan membuat akun per divisi, mis: `akademik`, `keuangan`, `kemahasiswaan`, dll.

Membuat akun baru:
- `node scripts/createAdminUser.js --username akademik --password "StrongPass!" --role akademik --displayName "Tim Akademik"`

Mengubah password/role/displayName akun yang sudah ada:
- `node scripts/createAdminUser.js --username akademik --password "NewStrongPass!" --role akademik --displayName "Tim Akademik" --update`

Melihat daftar akun:
- `node scripts/listAdminUsers.js`

Catatan akses:
- Role `admin`/`superadmin` = akses penuh.
- Role selain itu = dibatasi hanya Dashboard + Training Data (server-side dan UI).

4) Broadcast Management
- Create: `POST /admin/broadcast` Body: `{ title, body, scheduledAt?, recipientList? }`.
- List: `GET /admin/broadcast`
- Update/Delete: `PUT /admin/broadcast/:id`, `DELETE /admin/broadcast/:id` (hanya untuk queued/scheduled).

5) Testing & Utilities
- Test simulate incoming message (dev only): `POST /_simulate` Body: `{ chatId, text }`.
- Admin testing endpoints:
  - `GET /admin/test/sample-messages`
  - `POST /admin/test/simulate-message`
  - `GET /admin/test/status`

6) Analytics
- Endpoints available under `/admin/analytics/*` (retention, cohort, engagement, handover, topics, heatmap).
- Export CSV: `GET /admin/analytics/export/csv`.

7) Environment / Security notes
- Admin credentials live in `.env`: `ADMIN_USERNAME`, `ADMIN_PASSWORD` (dev) or hashed password in production.
- Set a strong `JWT_SECRET` in `.env` before exposing to production.
- For production, replace mock providers with `WHATSAPP_PROVIDER=business` and configure secrets in a secrets manager.

8) Troubleshooting cepat
- Jika server tidak merespon: pastikan port `PORT` (default `4000`) tidak dipakai.
- Untuk masalah webhook verification, pastikan `WHATSAPP_WEBHOOK_VERIFY_TOKEN` sama di server dan di Facebook Developers.
- Jika RAG tidak mengembalikan hasil, cek `OPENAI_API_KEY` (jika ingin embeddings OpenAI) atau cek log untuk proses ingest.

9) Deploy / Update (PM2)

Jika Anda menjalankan server dengan PM2 (contoh process name: `bot-stikom`), langkah aman untuk update di VPS:

1. `cd ~/bot-stikom`
2. `git pull`
3. Install dependencies backend: `npm ci --omit=dev`
4. Build admin UI (agar halaman seperti `/setting` memakai UI terbaru):
  - `npm --prefix admin-ui ci`
  - (opsional, disarankan) bersihkan output lama agar tidak stale dan tidak mengganggu update Git:
    - `rm -rf admin-ui/out`
  - `npm --prefix admin-ui run build`
5. Restart proses: `pm2 restart bot-stikom --update-env`
6. Verifikasi backend yang aktif benar-benar terbaru:
  - `npm run diag:ocr:deps`
  - `npm run verify:training:upload -- "/path/ke/file.pdf"`

Jika Anda deploy manual di VPS/panel dan tidak memakai `npm run`, gunakan direct command berikut:
- `node scripts/debugOcrDeps.js`
- `node scripts/verifyTrainingUpload.js "/path/ke/file.pdf"`
- lalu restart proses Node dari PM2/panel service manager yang Anda pakai

Catatan:
- Server akan menggunakan UI terbaru jika folder `admin-ui/out` ada.
- Jika sebelumnya UI baru belum pernah ter-build di VPS, restart PM2 diperlukan setelah build agar server mendeteksi `admin-ui/out`.
- Folder `admin-ui/out` adalah hasil build (generated) dan sebaiknya tidak di-commit ke Git. Build ulang di VPS setelah `git pull`.
- Lihat [TRAINING_UPLOAD_DEPLOY_CHECKLIST.md](TRAINING_UPLOAD_DEPLOY_CHECKLIST.md) untuk checklist upload training yang lebih lengkap.
- Jangan salin `node_modules` dari Windows ke Linux VPS. Install dependency di Linux host agar binary native cocok.

----
Jika ingin, saya bisa menambahkan tab 'Docs' pada `admin-panel.html` untuk menampilkan dokumentasi ini secara langsung di UI.
