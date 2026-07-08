# Panduan Menyambungkan Supabase dengan Sistem WhatsApp Bot

## 📋 Daftar Isi
1. [Persiapan Supabase](#persiapan-supabase)
2. [Konfigurasi Database](#konfigurasi-database)
3. [Migrasi Database](#migrasi-database)
4. [Fitur Tambahan Supabase](#fitur-tambahan-supabase)
5. [Troubleshooting](#troubleshooting)

---

## 🚀 Persiapan Supabase

### 1. Buat Akun Supabase
1. Kunjungi [https://supabase.com](https://supabase.com)
2. Klik **"Start your project"** atau **"Sign In"** (gratis)
3. Login dengan GitHub, Google, atau email

### 2. Buat Project Baru
1. Setelah login, klik **"New Project"**
2. Isi detail project:
   - **Name**: `whatsapp-bot-system` (atau nama lain)
   - **Database Password**: Buat password yang kuat (SIMPAN password ini!)
   - **Region**: Pilih yang terdekat dengan lokasi server Anda (misal: Southeast Asia - Singapore)
   - **Pricing Plan**: Free tier sudah cukup untuk development
3. Klik **"Create new project"**
4. Tunggu ~2 menit sampai database selesai dibuat

### 3. Dapatkan Connection String
1. Di dashboard Supabase, klik tombol **Connect** (di bagian atas)
2. Pilih metode koneksi sesuai lingkungan server Anda:

**A) Direct connection (untuk server persist; IPv6 by default)**
```
postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres?sslmode=require
```

**B) Pooler Session mode (recommended untuk server IPv4-only)**
```
postgresql://postgres.[PROJECT_REF]:[YOUR-PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres?sslmode=require
```

**C) Pooler Transaction mode (serverless/koneksi singkat; Prisma perlu pgbouncer=true)**
```
postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT_REF].supabase.co:6543/postgres?sslmode=require&pgbouncer=true&connection_limit=1
```

Catatan:
- Jika server Anda tidak mendukung IPv6, Direct connection sering gagal → gunakan Pooler Session mode.
- Untuk Pooler Session mode, username harus `postgres.[PROJECT_REF]`.

---

## ⚙️ Konfigurasi Database

### 1. Update File `.env`

Buka file `.env` di root project Anda dan isi `DATABASE_URL` sesuai metode koneksi yang Anda pilih.

Contoh (Pooler Session mode untuk IPv4):
```bash
DATABASE_URL="postgresql://postgres.YOUR_PROJECT_REF:YOUR_PASSWORD@aws-0-YOUR_REGION.pooler.supabase.com:5432/postgres?sslmode=require"
```

Contoh (Direct connection):
```bash
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@db.YOUR_PROJECT_REF.supabase.co:5432/postgres?sslmode=require"
```

**⚠️ PENTING:**
- Ganti dengan connection string Supabase Anda yang asli
- Jangan commit file `.env` ke Git (sudah ada di `.gitignore`)
- Untuk production, gunakan environment variables di hosting platform

### 2. Update File `.env.production` (Opsional)

Jika Anda punya environment production terpisah, sebaiknya:
- Simpan template aman di `.env.production` (tanpa secret), dan
- Simpan secret asli di `.env.production.local` di server.

Minimal:
```bash
NODE_ENV="production"
```

### 3. Pooler (Opsional - Untuk Production)

Jika server Anda IPv4-only, gunakan **Pooler Session mode** (host `aws-0-[REGION].pooler.supabase.com` port `5432`, user `postgres.[PROJECT_REF]`).

Jika Anda butuh **Transaction mode** (mis. banyak koneksi transient), gunakan port `6543`.
Untuk Prisma, tambahkan `pgbouncer=true` karena prepared statements tidak didukung di transaction mode.

**Update `schema.prisma` untuk pooling:**
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  directUrl = env("DIRECT_URL") // Tambahkan ini untuk migrations
}
```

Di `.env`:
```bash
# Connection pooling untuk queries
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@db.xxxxx.supabase.co:6543/postgres?pgbouncer=true"

# Direct connection untuk migrations
DIRECT_URL="postgresql://postgres:YOUR_PASSWORD@db.xxxxx.supabase.co:5432/postgres"
```

---

## 🔄 Migrasi Database

### 1. Generate Prisma Client
```powershell
npm run prisma:generate
```

### 2. Push Schema ke Supabase (Development)
Untuk development, cara tercepat:
```powershell
npx prisma db push
```

### 3. Migration (Production - Recommended)
Untuk production, gunakan migration yang proper:

```powershell
# Buat migration baru
npx prisma migrate dev --name init_supabase

# Atau deploy migration yang sudah ada
npm run migrate:deploy
```

### 4. Verifikasi Database

```powershell
# Buka Prisma Studio untuk melihat database
npx prisma studio
```

Atau cek langsung di Supabase Dashboard:
1. Buka **Table Editor** di sidebar
2. Anda akan melihat semua tabel: `KeywordReply`, `Setting`, `MenuItem`, `Session`, `Chat`, `Broadcast`, dll.

---

## ✨ Fitur Tambahan Supabase

Supabase bukan hanya database PostgreSQL biasa. Berikut fitur yang bisa Anda manfaatkan:

### 1. **Supabase Storage** (File Upload)
Untuk menyimpan file uploads (PDF, images, dll):

```javascript
// Install Supabase client
// npm install @supabase/supabase-js

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Upload file
async function uploadFile(file, fileName) {
  const { data, error } = await supabase.storage
    .from('uploads')
    .upload(`training-data/${fileName}`, file);
  
  if (error) throw error;
  return data;
}
```

**Tambahkan ke `.env`:**
```bash
SUPABASE_URL="https://xxxxxxxxxxxxx.supabase.co"
SUPABASE_ANON_KEY="your-anon-key"
```

### 2. **Supabase Realtime** (WebSocket)
Untuk monitoring realtime broadcasts atau analytics:

```javascript
// Subscribe ke perubahan tabel Broadcast
supabase
  .channel('broadcasts')
  .on('postgres_changes', 
    { event: '*', schema: 'public', table: 'Broadcast' },
    (payload) => {
      console.log('Broadcast updated:', payload);
    }
  )
  .subscribe();
```

### 3. **Supabase Auth** (Opsional)
Untuk mengganti sistem auth JWT saat ini dengan Supabase Auth:

```javascript
// Login admin
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'admin@example.com',
  password: 'admin123'
});
```

### 4. **Database Backups**
Supabase Free tier memberikan:
- Daily backups (7 hari terakhir)
- Point-in-time recovery (paid plans)

Akses di: **Database** → **Backups**

### 5. **SQL Editor**
Untuk menjalankan query SQL langsung:
1. Buka **SQL Editor** di sidebar
2. Jalankan query custom, contoh:

```sql
-- Lihat statistik broadcasts
SELECT 
  status, 
  COUNT(*) as count,
  SUM(sentCount) as total_sent
FROM "Broadcast"
GROUP BY status;
```

---

## 🔍 Troubleshooting

### Error: `P1001: Can't reach database server`
- ✅ Cek connection string Anda benar
- ✅ Pastikan password tidak ada karakter khusus yang perlu di-encode
- ✅ Cek firewall/antivirus tidak block koneksi
- ✅ Pastikan Supabase project sudah selesai dibuat (status: Active)

### Error: `P3009: migrate could not be applied cleanly`

### Error: `P3005: The database schema is not empty`
Ini biasanya terjadi di Supabase karena schema target (umumnya `public`) sudah berisi tabel/objek (baik dari project lama atau inisialisasi sebelumnya), sementara Prisma belum punya tabel history migrasi di database itu.

Solusi paling aman: gunakan schema khusus yang kosong untuk aplikasi (contoh: `bot`).

1) Buat schema di Supabase SQL Editor:
```sql
create schema if not exists bot;
```

2) Tambahkan parameter `schema` di `DATABASE_URL`:
```bash
DATABASE_URL="postgresql://.../postgres?schema=bot"
```
Kalau `DATABASE_URL` kamu sudah punya query parameter (mis. `?pgbouncer=true`), tambahkan dengan `&schema=bot`.

3) Jalankan ulang:
- `npm run prisma:generate`
- `npm run migrate:deploy`

### Error: `SSL connection required`
Tambahkan `?sslmode=require` di connection string:
```bash
DATABASE_URL="postgresql://postgres:pass@db.xxx.supabase.co:6543/postgres?sslmode=require"
```

### Performance Lambat
- ✅ Gunakan **Connection Pooling** (lihat bagian konfigurasi)
- ✅ Tambahkan indexes di Prisma schema:
```prisma
model Chat {
  id     String @id @default(uuid())
  chatId String @unique
  
  @@index([chatId])
}
```
- ✅ Jalankan `npx prisma migrate dev` setelah menambah index

### Connection Limit Exceeded
Update `.env`:
```bash
# Batasi koneksi Prisma
DATABASE_URL="postgresql://...?connection_limit=5&pool_timeout=10"
```

---

## 📊 Monitoring & Analytics

### Supabase Dashboard
- **Database** → **Reports**: Lihat CPU, memory, disk usage
- **Database** → **Roles**: Manage database users
- **API** → **Logs**: Monitor API calls
- **Auth** → **Users**: Jika pakai Supabase Auth

### Prisma Logging
Update `src/db.js` untuk debug queries:

```javascript
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
});

module.exports = prisma;
```

---

## 🎯 Checklist Setup

- [ ] Akun Supabase sudah dibuat
- [ ] Project Supabase sudah dibuat
- [ ] Connection string sudah di-copy
- [ ] File `.env` sudah di-update dengan `DATABASE_URL`
- [ ] `npm install` sudah dijalankan
- [ ] `npm run prisma:generate` berhasil
- [ ] `npx prisma db push` atau `npm run migrate:deploy` berhasil
- [ ] Verifikasi tabel di Supabase Table Editor
- [ ] Test aplikasi dengan `npm run dev`
- [ ] (Opsional) Setup Supabase Storage untuk uploads
- [ ] (Opsional) Setup Connection Pooling untuk production

---

## 📞 Support

- **Supabase Docs**: https://supabase.com/docs
- **Prisma Docs**: https://www.prisma.io/docs
- **Supabase Discord**: https://discord.supabase.com

---

**✅ Selesai!** Sistem WhatsApp Bot Anda sekarang sudah terhubung ke Supabase!
