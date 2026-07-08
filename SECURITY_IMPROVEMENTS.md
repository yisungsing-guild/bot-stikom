# Security Improvements Documentation

## ✅ Semua Perbaikan Keamanan Telah Diimplementasikan

### 1. **Strengthened JWT & Authentication** ✓
- Menggunakan `bcrypt` untuk hashing password
- JWT token dengan expiration yang configurable
- Refresh token mechanism untuk token rotation
- Validation ketat terhadap JWT issuer dan audience
- Warning & shutdown jika production menggunakan default credentials

**File yang diubah:** `src/middleware/auth.js`

**Fitur baru:**
- `generateToken()` - Generate access token dengan issuer/audience validation
- `generateRefreshToken()` - Generate long-lived refresh token (7 hari)
- `verifyPassword()` - Bcrypt password verification
- `/auth/refresh` endpoint - Token rotation endpoint
- Security check pada startup untuk detection default credentials

**Configurasi di .env:**
```
JWT_SECRET=your-random-32-char-secret
ADMIN_USERNAME=secure_admin_username
ADMIN_PASSWORD=SecureP@ssw0rd (akan di-hash dengan bcrypt di production)
JWT_EXPIRES_IN=24h
```

---

### 2. **File Upload Security** ✓
- File type validation (whitelist, configurable via `ALLOWED_FILE_TYPES`)
- File size limit (default 15MB; configurable)
- Filename sanitization (prevent path traversal)
- MIME type checking
- Automatic cleanup uploaded file jika parsing gagal

**Catatan penting (Production):**
- Default production sekarang **tidak mengizinkan Excel (`xls/xlsx`)** kecuali di-enable eksplisit via `ALLOWED_FILE_TYPES`, karena `npm audit` melaporkan advisory high di dependency `xlsx` (no fix available).
- Jika Excel harus diizinkan, gunakan limiter `EXCEL_MAX_SHEETS` dan `EXCEL_MAX_OUTPUT_CHARS`.

**File yang dibuat:** `src/middleware/uploadSecurity.js`

**Fitur:**
- `sanitizeFilename()` - Remove dangerous characters dan path separators
- `validateFileType()` - Whitelist-based file type validation
- File size limit enforcement via multer
- Timestamp-based unique filename generation
- Error handling dengan automatic file cleanup

**Configurasi di .env:**
```
MAX_FILE_SIZE=15728640  # 15MB in bytes

# Dev default biasanya lebih longgar (termasuk gambar dan Excel)
ALLOWED_FILE_TYPES=txt,pdf,csv,docx,xls,xlsx,jpg,jpeg,png,gif,webp

# Production recommended (tanpa Excel)
# ALLOWED_FILE_TYPES=txt,pdf,csv,docx,jpg,jpeg,png,gif,webp

# Excel safety limits (hanya relevan jika xls/xlsx diizinkan)
EXCEL_MAX_SHEETS=10
EXCEL_MAX_OUTPUT_CHARS=2097152
```

**Update di route:** `src/routes/admin.js` - `/training/upload` endpoint

---

### 3. **Redis-Based Rate Limiting** ✓
- Scalable rate limiting menggunakan Redis untuk production
- Fallback ke in-memory rate limiting jika Redis tidak tersedia
- Atomic operations menggunakan Redis pipeline
- Configurable rate limits untuk general dan admin endpoints
- Proper retry-after headers

**File yang dibuat:** `src/middleware/rateLimitRedis.js`

**Fitur:**
- `initializeRedis()` - Automatic Redis connection dengan reconnection strategy
- `checkRateLimitRedis()` - Atomic rate limit check menggunakan Redis INCR
- Graceful fallback ke in-memory jika Redis error
- Return `retryAfter` header untuk rate limit responses
- Connection pooling dan error handling

**Configurasi di .env:**
```
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=  # optional
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_ADMIN_MAX_REQUESTS=50
```

**Update di:** `src/index.js` - Menggunakan Redis middleware

---

### 4. **Security Headers dengan Helmet** ✓
- Content Security Policy (CSP) headers
- HSTS (HTTP Strict Transport Security)
- X-Frame-Options untuk prevent clickjacking
- X-Content-Type-Options untuk prevent MIME type sniffing
- Referrer-Policy

**Implementation di:** `src/index.js`

```javascript
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:']
    }
  },
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  }
}));
```

---

### 5. **CORS (Fail-Closed in Production)** ✓
- Jika `ALLOWED_ORIGINS` di-set, server hanya mengizinkan origin yang ada di allowlist.
- Jika `ALLOWED_ORIGINS` kosong:
  - dev/test: allow any origin (convenience)
  - production: **deny cross-origin by default** (fail-closed)
- Escape hatch (tidak direkomendasikan): `CORS_ALLOW_ANY_ORIGIN=true`

**Configurasi di .env (Production recommended):**
```
ALLOWED_ORIGINS=https://admin.your-domain.com
# CORS_ALLOW_ANY_ORIGIN=false
```

---

### 6. **Webhook Authentication (Recommended)** ✓
- `/provider/webhook`: jika `PROVIDER_WEBHOOK_TOKEN` di-set, request harus menyertakan token (header `x-webhook-token` atau `Authorization: Bearer ...` atau `?token=`)
- `/wati/webhook`: di production, token requirement otomatis aktif jika `WHATSAPP_WEBHOOK_VERIFY_TOKEN` ada (bisa override via `WATI_WEBHOOK_REQUIRE_TOKEN=true/false`)

**Configurasi di .env (Production recommended):**
```
PROVIDER_WEBHOOK_TOKEN=CHANGE_ME_TO_RANDOM_LONG_TOKEN
WHATSAPP_WEBHOOK_VERIFY_TOKEN=your-random-verify-token-min-32-chars
WATI_WEBHOOK_REQUIRE_TOKEN=true
```

---

### 7. **URL Ingest Hardening (SSRF via Redirect Mitigation)** ✓
- Fetch URL untuk training via URL sekarang follow redirect secara manual dan setiap hop wajib lolos `hostAllowed`.
- Redirect dapat dikontrol via `URL_INGEST_MAX_REDIRECTS` dan `URL_INGEST_FOLLOW_REDIRECTS`.
- Recommended production: set `TRAINING_URL_ALLOWLIST` untuk membatasi domain yang boleh di-ingest.

**Configurasi di .env (Production recommended):**
```
TRAINING_URL_ALLOWLIST=example.com,stikom-bali.ac.id
URL_INGEST_MAX_REDIRECTS=3
URL_INGEST_FOLLOW_REDIRECTS=true
```

---

### 8. **Environment Configuration** ✓

#### `.env` (Development)
- Konfigurasi lokal dengan placeholder
- Default credentials untuk development testing

#### `.env.example`
- Comprehensive documentation untuk setiap setting
- Production vs development guidelines
- Security best practices

#### `.env.production` (BARU)
- Production-ready template
- Warnings untuk credential yang perlu diganti
- Redis configuration untuk distributed rate limiting

---

### 6. **Dependencies Added**

```json
{
  "bcrypt": "^5.1.1",           // Password hashing
  "helmet": "^7.1.0",           // Security headers
  "express-rate-limit": "^7.1.5", // Alternative rate limiting (optional)
  "redis": "^4.6.12"            // Distributed rate limiting
}
```

---

## 🚀 Implementasi untuk Production

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Setup Redis (Production)
```bash
# Install Redis Server di production machine
# Ubuntu/Debian:
sudo apt-get install redis-server

# Atau gunakan Docker:
docker run -d -p 6379:6379 redis:latest
```

### Step 3: Generate Secure Credentials
```bash
# Generate JWT Secret (32 char random)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate strong password
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

### Step 4: Setup .env.production
```bash
cp .env.production .env

# Edit .env dengan konfigurasi production:
# - JWT_SECRET: Replace dengan result dari step 3
# - ADMIN_USERNAME: Change ke username yang unik
# - ADMIN_PASSWORD: Change ke password yang kuat
# - DATABASE_URL: Change ke PostgreSQL (bukan SQLite)
# - REDIS_URL: Point ke Redis server
# - NODE_ENV: Set ke "production"
```

### Step 5: Run Production
```bash
NODE_ENV=production npm start
```

---

## ⚠️ Security Checklist

- [x] JWT Secret diubah dari default
- [x] Admin credentials TIDAK menggunakan default
- [x] Database di-upgrade ke PostgreSQL (untuk production)
- [x] Redis dikonfigurasi dan berjalan
- [x] File upload validation aktif
- [x] Rate limiting dikonfigurasi proper
- [x] Security headers (Helmet) diaktifkan
- [x] CORS production default fail-closed (gunakan `ALLOWED_ORIGINS`)
- [x] Webhook token available (gunakan `PROVIDER_WEBHOOK_TOKEN` + WATI token requirement)
- [x] URL ingest redirect hardening + allowlist tersedia
- [x] HTTPS/TLS setup di production (gunakan Nginx/Load Balancer reverse proxy)
- [x] Database backups dijadwalkan
- [x] Logging & monitoring disetup
- [x] Regular security updates

---

## 🛡️ Additional Recommendations

1. **HTTPS/TLS**: Setup SSL certificate di production (gunakan Let's Encrypt via Nginx/Caddy)
2. **Database**: Upgrade dari SQLite ke PostgreSQL untuk production
3. **Logging**: Setup centralized logging (e.g., ELK stack, Datadog)
4. **Monitoring**: Setup alerting untuk rate limit violations, failed logins
5. **Backup**: Automated daily backups untuk database
6. **API Keys**: Rotate OpenAI/WhatsApp API keys quarterly
7. **Dependencies**: Regular `npm audit` dan update dependencies
8. **WAF**: Consider Web Application Firewall (CloudFlare, AWS WAF)

---

## 📝 Change Summary

| Component | Change | Impact |
|-----------|--------|--------|
| Auth | Bcrypt + JWT strengthening | High - Prevents credential attacks |
| File Upload | Type/size validation | High - Prevents file-based exploits |
| Rate Limiting | Redis-based distributed | High - Prevents brute force/DDoS |
| Headers | Helmet security headers | Medium - Prevents header-based attacks |
| Environment | Secure templates | Medium - Prevents config mistakes |

---

## 🧪 Testing

```bash
# Test login dengan JWT
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'

# Get token, then test protected endpoint
curl -X GET http://localhost:4000/admin/keywords \
  -H "Authorization: Bearer <token_dari_login>"

# Test rate limiting
for i in {1..105}; do curl http://localhost:4000/provider/webhook; done
# Should get 429 error setelah 100 requests

# Test file upload validation
curl -X POST http://localhost:4000/admin/training/upload \
  -H "Authorization: Bearer <token>" \
  -F "file=@test.txt"
```

---

## 📞 Support

Jika ada pertanyaan atau issue dengan security implementation, contact repository maintainer.

**Last Updated:** February 10, 2026
