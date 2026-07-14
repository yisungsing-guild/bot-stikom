// Muat konfigurasi environment dari file env.
// - Default: .env
// - Production: .env.production
// - Override: DOTENV_CONFIG_PATH
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const isProductionEnv = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const prodLocalEnvAbs = path.join(__dirname, '..', '.env.production.local');
const prodEnvAbs = path.join(__dirname, '..', '.env.production');

function fileExists(p) {
  try {
    return Boolean(p) && fs.existsSync(p);
  } catch {
    return false;
  }
}

function redactDatabaseUrl(raw) {
  try {
    const s = String(raw || '').trim();
    if (!s) return null;
    const u = new URL(s);
    const database = (u.pathname || '').replace(/^\//, '') || null;
    const hasPassword = Boolean(u.password);
    return {
      protocol: u.protocol || null,
      host: u.hostname || null,
      port: u.port ? String(u.port) : null,
      database,
      usernamePresent: Boolean(u.username),
      passwordPresent: hasPassword,
      sslmode: u.searchParams ? (u.searchParams.get('sslmode') || null) : null,
      // Useful when diagnosing pooler issues
      connectTimeout: u.searchParams ? (u.searchParams.get('connect_timeout') || null) : null,
    };
  } catch {
    return { invalid: true };
  }
}

function resolveDotenvPath() {
  const explicit = process.env.DOTENV_CONFIG_PATH ? String(process.env.DOTENV_CONFIG_PATH).trim() : '';
  const hasLocalEnv = fileExists(path.join(__dirname, '..', '.env.local'));
  const hasProdLocal = fileExists(prodLocalEnvAbs);

  if (!isProductionEnv) {
    return { dotenvPath: explicit || (hasLocalEnv ? '.env.local' : '.env'), explicit: explicit || null, usedProdLocalOverride: false };
  }

  // Production:
  // - Default preference: .env.production.local (if present) over .env.production
  // - Respect custom DOTENV_CONFIG_PATH (absolute path or a non-standard filename)
  // - But if DOTENV_CONFIG_PATH is the default '.env.production' and local exists, prefer local
  const normalizedExplicit = explicit.replace(/\\/g, '/');
  const isDefaultProdExplicit = normalizedExplicit === '.env.production' || normalizedExplicit === '.env.production.local';
  const isCustomExplicit = Boolean(explicit) && !isDefaultProdExplicit;

  if (isCustomExplicit) {
    return { dotenvPath: explicit, explicit, usedProdLocalOverride: false };
  }

  if (hasProdLocal) {
    const usedOverride = Boolean(explicit) && normalizedExplicit === '.env.production';
    return { dotenvPath: '.env.production.local', explicit: explicit || null, usedProdLocalOverride: usedOverride };
  }

  return { dotenvPath: explicit || '.env.production', explicit: explicit || null, usedProdLocalOverride: false };
}

const dotenvResolved = resolveDotenvPath();
const dotenvPath = dotenvResolved.dotenvPath;
dotenv.config({
  path: dotenvPath,
  // Only override existing process env values when a custom env file path
  // is explicitly requested. In hosted production deployments like Railway,
  // platform-provided environment variables should take precedence over
  // checked-in .env files.
  override: Boolean(process.env.DOTENV_CONFIG_PATH)
});

// Modul inti
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const crypto = require('crypto');
const logger = require('./logger');

// Optional: prefer IPv4 DNS resolution in environments with broken IPv6.
// Supabase pooler endpoints can resolve to AAAA records; if your VPS has no working IPv6 route,
// DB connections may fail and the app will look like it's "reset".
// Set either:
// - DNS_RESULT_ORDER=ipv4first (or ipv6first/verbatim)
// - DNS_IPV4_FIRST=true
try {
  const dns = require('dns');
  const order = String(process.env.DNS_RESULT_ORDER || '').trim();
  const ipv4First = String(process.env.DNS_IPV4_FIRST || '').toLowerCase() === 'true';
  const picked = order || (ipv4First ? 'ipv4first' : '');
  if (picked && typeof dns.setDefaultResultOrder === 'function') {
    dns.setDefaultResultOrder(picked);
    logger.info({ dnsResultOrder: picked }, '[Config] DNS result order configured');
  }
} catch (e) {
  // ignore
}

// Quick config sanity log (helps verify production env files are actually loaded)
try {
  logger.info({
    dotenvPath,
    dotenvExplicit: dotenvResolved.explicit,
    dotenvUsedProdLocalOverride: dotenvResolved.usedProdLocalOverride,
    dotenvProdLocalExists: fileExists(prodLocalEnvAbs),
    dotenvProdExists: fileExists(prodEnvAbs),
    nodeEnv: process.env.NODE_ENV || null,
    databaseTarget: redactDatabaseUrl(process.env.DATABASE_URL),
    botTone: (process.env.BOT_TONE || process.env.BOT_CHAT_STYLE || null),
    botFriendlyTone: process.env.BOT_FRIENDLY_TONE || null,
    botAutoTone: process.env.BOT_AUTO_TONE || null,
    botFriendlyOpening: process.env.BOT_FRIENDLY_OPENING || null,
    botFriendlyClosing: process.env.BOT_FRIENDLY_CLOSING || null,
  }, '[Config] Bot tone loaded');
} catch (e) {
  // ignore
}

// Optional dependency: do not crash the whole server if not installed yet.
// (e.g., deploy pulled code but forgot to run `npm install`)
let compression = null;
try {
  // eslint-disable-next-line global-require
  compression = require('compression');
} catch (e) {
  compression = null;
  try {
    logger.warn({ err: e && e.message ? e.message : String(e) }, '[Server] compression module not available, skipping response compression');
  } catch (_) {
    // ignore
  }
}

// Telegram incident notifications + repair confirmation webhook
const telegramRouterFactory = require('./routes/telegram');
const { sendTelegramMessage } = require('./utils/telegram');
const { createIncident, formatIncidentForTelegram } = require('./utils/incidentManager');

// Provider adapter: saat ini kita menggunakan mock untuk mode lokal/dev
const { MockWhatsAppProvider } = require('./providers/whatsappProvider');

// Router factory untuk menerima pesan dari provider dan endpoint admin
const providerRouterFactory = require('./routes/provider');
const adminRouterFactory = require('./routes/admin');
const watiWebhookRouter = require('./routes/watiWebhook');
const fonnteWebhookRouter = require('./routes/fonnteWebhook');
const { prewarmSemanticRag } = require('./engine/semanticRagEngine');

// Middleware: auth, validation, rate limit
const { verifyToken, createAuthRoute } = require('./middleware/auth');
const { 
  rateLimitMiddleware, 
  adminRateLimitMiddleware,
  initializeRedis,
  closeRedis 
} = require('./middleware/rateLimitRedis');

// Broadcast Scheduler
const { BroadcastScheduler } = require('./engine/broadcastScheduler');

// Prisma client (koneksi ke DB)
const prisma = require('./db');
const { disconnect: disconnectPrisma } = require('./db');
const { resolveServerListenConfig } = require('./config/serverRuntime');

// Buat instance Express dan middleware dasar
const app = express();

// Check if production early so we can use it in helmet config
const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';

// If running behind a reverse proxy (Nginx/Cloudflare), enable trust proxy so req.ip is the real client.
// Set TRUST_PROXY=true to force-enable. Set TRUST_PROXY=false to force-disable.
try {
  const trustProxyEnv = String(process.env.TRUST_PROXY || '').toLowerCase();
  const isProdEnv = isProduction;
  const trustProxyEnabled = trustProxyEnv === 'true' || (isProdEnv && trustProxyEnv !== 'false');
  if (trustProxyEnabled) {
    app.set('trust proxy', 1);
  }
} catch (e) {
  // ignore
}
// === SECURITY MIDDLEWARE ===
// 1. Helmet: Set security HTTP headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // Admin panel uses inline JS (onclick, inline <script> blocks).
      // v0 admin UI also loads Lucide UMD from unpkg.
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
      scriptSrcAttr: ["'self'", "'unsafe-inline'"], // Allow inline event handlers (onclick, etc)
      // Admin panel uses Google Fonts + FontAwesome CDN.
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
      // Admin panel preview uses object URLs (blob:) for inline image/pdf preview.
      imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
      frameSrc: ["'self'", 'blob:']
    }
  },
  hsts: isProduction ? {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  } : false
}));

// === MIDDLEWARE - PENTING: Urutan middleware penting! ===
// 2. CORS untuk admin panel / frontend
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
// Backward-compat switch: explicitly allow any origin in production.
// Recommended: keep this false and set ALLOWED_ORIGINS.
const allowAnyOriginInProduction = String(process.env.CORS_ALLOW_ANY_ORIGIN || '').toLowerCase() === 'true';
app.use(cors({
  origin: function (origin, callback) {
    // Requests without Origin header (server-to-server, curl, supertest) should not be blocked.
    if (!origin) return callback(null, true);

    // If allowlist is configured, enforce it.
    if (allowedOrigins.length > 0) {
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(null, false);
    }

    // If not configured:
    // - dev/test: allow any origin (convenience)
    // - production: fail-closed unless explicitly overridden
    if (!isProduction) return callback(null, true);
    if (allowAnyOriginInProduction) return callback(null, true);
    return callback(null, false);
  },
  credentials: true
}));

// 2.5. Compress responses (faster admin-ui static + JSON APIs)
if (typeof compression === 'function') {
  app.use(compression());
}

// 3. Parse JSON body dari request SEBELUM routing
// Capture raw body buffer for webhook signature verification
app.use(express.json({
  verify: (req, res, buf /*, encoding */) => {
    try {
      req.rawBody = buf;
    } catch (e) {
      // ignore
    }
  }
}));

app.use(express.urlencoded({ extended: true }));

// 3.25. Attach a requestId for correlation (useful in production where error messages are hidden)
app.use((req, res, next) => {
  try {
    const requestId = (typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);
  } catch (e) {
    // ignore
  }
  next();
});

// 3.5a. Public static assets for CSS / JS / images
const projectRoot = path.join(__dirname, '..');
const publicDir = path.join(projectRoot, 'public');
const publicCssDir = path.join(publicDir, 'css');
const publicJsDir = path.join(publicDir, 'js');
const publicImgDir = path.join(publicDir, 'img');

try {
  if (!fs.existsSync(publicCssDir)) fs.mkdirSync(publicCssDir, { recursive: true });
  if (!fs.existsSync(publicJsDir)) fs.mkdirSync(publicJsDir, { recursive: true });
  if (!fs.existsSync(publicImgDir)) fs.mkdirSync(publicImgDir, { recursive: true });
} catch (e) {
  // ignore
}

app.use(express.static(publicDir, {
  index: false,
  maxAge: isProduction ? '1h' : 0,
  setHeaders: (res, filePath) => {
    try { res.setHeader('X-Content-Type-Options', 'nosniff'); } catch (e) { /* ignore */ }
    if (filePath.endsWith('.html')) {
      try { res.setHeader('Cache-Control', 'no-cache'); } catch (e) { /* ignore */ }
      return;
    }
    try { res.setHeader('Cache-Control', isProduction ? 'public, max-age=3600' : 'no-cache'); } catch (e) { /* ignore */ }
  }
}));

// 3.5. Serve static files (admin panel HTML)
// NOTE: Avoid serving the entire project root as static files in production.
// We only expose the admin panel HTML explicitly.
const adminPanelPath = path.join(projectRoot, 'admin-panel.html');
const adminPanelCssPath = path.join(publicCssDir, 'admin-panel.css');
const adminPanelJsPath = path.join(publicJsDir, 'admin-panel.js');
const legacyAdminPanelPath = path.join(projectRoot, 'admin-panel-legacy.html');
const legacyAdminPanelCssPath = path.join(publicCssDir, 'admin-panel-legacy.css');

// v0 Next.js UI (static export) output directory
const adminUiOutDir = path.join(projectRoot, 'admin-ui', 'out');
const adminUiIndexPath = path.join(adminUiOutDir, 'index.html');

function hasAdminUiOut() {
  return fs.existsSync(adminUiIndexPath);
}

// Serve exported Next.js assets (_next, icons, etc)
app.use(express.static(adminUiOutDir, {
  index: false,
  etag: true,
  maxAge: isProduction ? '1h' : 0,
  setHeaders: (res, filePath) => {
    try { res.setHeader('X-Content-Type-Options', 'nosniff'); } catch (e) { /* ignore */ }

    const p = String(filePath || '').replace(/\\/g, '/');
    // Next.js hashed assets can be cached aggressively.
    if (p.includes('/_next/static/')) {
      try { res.setHeader('Cache-Control', isProduction ? 'public, max-age=31536000, immutable' : 'no-cache'); } catch (e) { /* ignore */ }
      return;
    }

    // HTML should be revalidated so updates roll out cleanly.
    if (p.endsWith('.html')) {
      try { res.setHeader('Cache-Control', 'no-cache'); } catch (e) { /* ignore */ }
      return;
    }

    // Other assets (icons, manifest, etc): cache shorter.
    try { res.setHeader('Cache-Control', isProduction ? 'public, max-age=3600' : 'no-cache'); } catch (e) { /* ignore */ }
  }
}));

app.get('/', (req, res) => {
  if (hasAdminUiOut()) {
    try { res.setHeader('Cache-Control', 'no-cache'); } catch (e) { /* ignore */ }
    return res.sendFile(path.join(adminUiOutDir, 'index.html'));
  }
  return res.sendFile(adminPanelPath);
});

function sendAdminUiRoute(res, routeFolder) {
  try { res.setHeader('Cache-Control', 'no-cache'); } catch (e) { /* ignore */ }
  // Next.js static export output can be either:
  // - out/<route>.html  (common)
  // - out/<route>/index.html
  const htmlFile = path.join(adminUiOutDir, `${routeFolder}.html`);
  const indexFile = path.join(adminUiOutDir, routeFolder, 'index.html');
  const notFoundFile = path.join(adminUiOutDir, '404.html');

  if (fs.existsSync(htmlFile)) return res.sendFile(htmlFile);
  if (fs.existsSync(indexFile)) return res.sendFile(indexFile);
  if (fs.existsSync(notFoundFile)) return res.status(404).sendFile(notFoundFile);
  return res.sendFile(path.join(adminUiOutDir, 'index.html'));
}

// v0 UI uses sidebar links like /dashboard, /keyword, etc.
[
  '/dashboard',
  '/login',
  '/keyword',
  '/menu',
  '/setting',
  '/broadcast',
  '/live-chat',
  '/history',
  '/training-data',
  '/whatsapp',
  '/testing'
].forEach((routePath) => {
  const handler = (req, res) => {
    if (hasAdminUiOut()) {
      const routeFolder = routePath.replace(/^\//, '');
      return sendAdminUiRoute(res, routeFolder);
    }
    return res.sendFile(adminPanelPath);
  };

  // Register both with and without trailing slash.
  app.get(routePath, handler);
  app.get(`${routePath}/`, handler);
});

app.get('/admin-panel.css', (req, res) => {
  res.sendFile(adminPanelCssPath);
});

app.get('/admin-panel.js', (req, res) => {
  res.sendFile(adminPanelJsPath);
});

// Legacy admin panel (previous inline SPA)
app.get('/legacy-admin', (req, res) => {
  res.sendFile(legacyAdminPanelPath);
});

app.get('/admin-panel-legacy.html', (req, res) => {
  res.sendFile(legacyAdminPanelPath);
});

app.get('/admin-panel-legacy.css', (req, res) => {
  res.sendFile(legacyAdminPanelCssPath);
});

// 3.6. Serve public media assets for outbound WhatsApp images.
// NOTE: We do NOT expose the whole uploads/ folder, only uploads/public-media/.
const publicMediaDir = path.join(projectRoot, 'uploads', 'public-media');
try {
  if (!fs.existsSync(publicMediaDir)) {
    fs.mkdirSync(publicMediaDir, { recursive: true });
  }
} catch (e) {
  // ignore (directory may be created by the upload route)
}

app.use('/media', express.static(publicMediaDir, {
  index: false,
  maxAge: isProduction ? '30d' : 0,
  setHeaders: (res) => {
    // Hardening: prevent content-type sniffing.
    try { res.setHeader('X-Content-Type-Options', 'nosniff'); } catch (e) { /* ignore */ }
  }
}));

// 3. Global rate limit (apply ke semua request)
// Config dari env atau default
const rateLimitWindow = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
const rateLimitMax = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10);
const globalRateLimiter = rateLimitMiddleware(rateLimitMax, rateLimitWindow);

// Avoid locking out the login flow. Auth routes have their own limiter below.
app.use((req, res, next) => {
  try {
    if (req.path && req.path.startsWith('/auth')) return next();
  } catch (e) {
    // ignore
  }
  return globalRateLimiter(req, res, next);
});

// 4. Auth endpoint (PUBLIC - tidak perlu token)
const authRateLimitMax = parseInt(process.env.RATE_LIMIT_AUTH_MAX_REQUESTS || '30', 10);
app.use('/auth', rateLimitMiddleware(authRateLimitMax, rateLimitWindow), createAuthRoute());

// === INITIALIZE WHATSAPP PROVIDER ===
// Diagnostic: mark start of WhatsApp provider initialization
try { console.log('[SERVER_INIT] INITIALIZE_WHATSAPP_PROVIDER_START'); } catch (e) {}
let provider = new MockWhatsAppProvider();

const whatsappProvider = String(process.env.WHATSAPP_PROVIDER || '').toLowerCase();
const isWhatsvaMode = (process.env.WHATSAPP_API_ENDPOINT || '').toLowerCase().includes('whatsva.id') ||
  whatsappProvider === 'whatsva';
const isWatiMode = (process.env.WHATSAPP_API_ENDPOINT || '').toLowerCase().includes('wati') ||
  whatsappProvider === 'wati';
const isFonnteMode = (process.env.WHATSAPP_API_ENDPOINT || '').toLowerCase().includes('fonnte.com') ||
  whatsappProvider === 'fonnte';

if (whatsappProvider === 'business' || whatsappProvider === 'wati' || whatsappProvider === 'whatsva' || whatsappProvider === 'fonnte') {
  const { WhatsAppBusinessProvider } = require('./providers/whatsappBusinessProvider');
  
  const apiKey = process.env.WHATSAPP_API_KEY;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;

  const missingForMeta = !apiKey || !phoneNumberId;
  const missingForWati = !apiKey;
  const missingForWhatsva = !((process.env.WHATSAPP_INSTANCE_KEY || process.env.WHATSAPP_API_KEY || '').toString().trim());
  const missingForFonnte = !apiKey;
  const missingCreds = isWhatsvaMode ? missingForWhatsva : (isWatiMode ? missingForWati : (isFonnteMode ? missingForFonnte : missingForMeta));

  if (missingCreds) {
    logger.error(
      isWhatsvaMode
        ? '[Server] âœ— WhatsVA mode: Missing credentials (WHATSAPP_INSTANCE_KEY)'
        : isWatiMode
        ? '[Server] âœ— WATI mode: Missing credentials (WHATSAPP_API_KEY)'
        : isFonnteMode
        ? '[Server] âœ— Fonnte mode: Missing credentials (WHATSAPP_API_KEY)'
        : '[Server] âœ— WhatsApp Business API: Missing credentials (API_KEY or PHONE_NUMBER_ID)'
    );
    logger.warn('[Server] Falling back to Mock provider');
  } else {
    provider = new WhatsAppBusinessProvider(
      isWhatsvaMode ? (process.env.WHATSAPP_INSTANCE_KEY || apiKey) : apiKey,
      phoneNumberId || (isWhatsvaMode ? 'whatsva' : (isFonnteMode ? 'fonnte' : 'wati')),
      businessAccountId
    );
    
    // Setup webhook untuk incoming messages
    // - Meta Cloud API uses POST /webhook
    // - WATI should use POST /wati/webhook and forward internally to /provider/webhook
    if (!isWatiMode && !isWhatsvaMode && !isFonnteMode) {
      const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'default_verify_token';
      provider.setupWebhook(app, verifyToken);
    } else if (isWatiMode) {
      logger.info('[Server] WATI mode detected: skipping /webhook (Meta) handler; using /wati/webhook');
    } else if (isFonnteMode) {
      logger.info('[Server] Fonnte mode detected: skipping /webhook (Meta) handler; using /fonnte/webhook');
    } else {
      logger.info('[Server] WhatsVA mode detected: skipping /webhook (Meta) handler; using external gateway webhook');
    }
    
    logger.info(isWhatsvaMode
      ? '[Server] âœ“ WhatsApp Provider: WhatsVA (production)'
      : isWatiMode
      ? '[Server] âœ“ WhatsApp Provider: WATI (production)'
      : isFonnteMode
      ? '[Server] âœ“ WhatsApp Provider: Fonnte (production)'
      : '[Server] âœ“ WhatsApp Provider: Business API (production)');
  }
} else {
  logger.info('[Server] WhatsApp Provider: Mock (development)');
}
// Diagnostic: mark end of WhatsApp provider initialization
try { console.log('[SERVER_INIT] INITIALIZE_WHATSAPP_PROVIDER_DONE'); } catch (e) {}

// Forward provider 'message' events to internal /provider/webhook so
// incoming messages (from providers that emit events) are processed by the app flow.
// In WATI mode, inbound should come ONLY via /wati/webhook to avoid double-processing.
const enableProviderForwarder = !isWatiMode || String(process.env.ENABLE_PROVIDER_FORWARDER || '').toLowerCase() === 'true';
if (enableProviderForwarder && !provider.__providerForwarderAttached) {
  provider.__providerForwarderAttached = true;
  provider.on('message', async (msg) => {
    try {
      const axios = require('axios');
      const internalHost = process.env.INTERNAL_PROVIDER_HOST || '127.0.0.1';
      const internalPort = process.env.PORT || 4000;
      const providerToken = (process.env.PROVIDER_WEBHOOK_TOKEN || '').toString().trim();
      await axios.post(`http://${internalHost}:${internalPort}/provider/webhook`, {
        chatId: msg.chatId,
        text: msg.text,
        messageId: msg.messageId,
        ts: msg.ts
      }, {
        headers: providerToken ? { 'x-webhook-token': providerToken } : undefined
      });
    } catch (e) {
      logger.error({ err: e.message }, '[ProviderForward] error forwarding incoming message');
    }
  });
}

// Mount router provider dengan injection adapter
// Diagnostic: mark router mounting start
try { console.log('[SERVER_INIT] MOUNTING_ROUTERS_START'); } catch (e) {}
// Endpoint: POST /provider/webhook
app.use('/provider', providerRouterFactory(provider));

// Simple WATI-only webhook (no Meta/Graph API). Mount at /wati/webhook
app.use('/wati', watiWebhookRouter);

// Fonnte webhook (free gateway / unofficial API). Mount at /fonnte/webhook
app.use('/fonnte', fonnteWebhookRouter);

// Compatibility: many WATI setups point the callback to `/webhook`.
// In WATI mode we also accept `/webhook` as an alias so inbound messages
// are not dropped silently.
if (isWatiMode) {
  app.use('/', watiWebhookRouter);
  logger.info('[Server] WATI mode: accepting inbound webhooks at /wati/webhook and /webhook');
}

if (isFonnteMode) {
  app.use('/', fonnteWebhookRouter);
  logger.info('[Server] Fonnte mode: accepting inbound webhooks at /fonnte/webhook and /webhook');
}

// Telegram webhook for incident alerts + interactive repair confirmation
app.use('/telegram', telegramRouterFactory(provider));

// Mount admin routes dengan JWT verification
// Endpoint: /admin/* (semua admin endpoint harus punya token)
const adminRateLimitMax = parseInt(process.env.RATE_LIMIT_ADMIN_MAX_REQUESTS || '50', 10);
app.use('/admin', verifyToken, adminRateLimitMiddleware(adminRateLimitMax, rateLimitWindow), adminRouterFactory(provider));

// Diagnostic: routers mounted
try { console.log('[SERVER_INIT] MOUNTING_ROUTERS_DONE'); } catch (e) {}

// === BROADCAST SCHEDULER ===
// Jalankan background scheduler untuk memproses broadcast terjadwal
const broadcastScheduler = new BroadcastScheduler(provider, 10000); // check setiap 10 detik
const disableScheduler =
  String(process.env.DISABLE_BROADCAST_SCHEDULER || 'false').toLowerCase() === 'true' ||
  String(process.env.NODE_ENV || '').toLowerCase() === 'test' ||
  Boolean(process.env.JEST_WORKER_ID);

// Diagnostic: broadcast scheduler initialization
try { console.log('[SERVER_INIT] BROADCAST_SCHEDULER_INIT', { disabled: !!disableScheduler }); } catch (e) {}
if (!disableScheduler) {
  try { console.log('[SERVER_INIT] BROADCAST_SCHEDULER_STARTING'); } catch (e) {}
  broadcastScheduler.start();
  try { console.log('[SERVER_INIT] BROADCAST_SCHEDULER_STARTED'); } catch (e) {}
}

// === ERROR HANDLING MIDDLEWARE ===
app.use((err, req, res, next) => {
  logger.error({ requestId: req && req.requestId ? req.requestId : undefined, err }, '[Error Handler]');

  // Best-effort incident notification to Telegram (do not block response)
  try {
    const status = err && err.status ? Number(err.status) : 500;
    const isServerError = !Number.isFinite(status) || status >= 500;

    if (isServerError) {
      const requestId = req && req.requestId ? String(req.requestId) : null;
      const method = req && req.method ? String(req.method) : '';
      const url = req && (req.originalUrl || req.url) ? String(req.originalUrl || req.url) : '';
      const msg = err && err.message ? String(err.message) : String(err);

      const incident = createIncident({
        kind: 'http_error',
        summary: `${method} ${url} :: ${msg}`,
        details: {
          requestId,
          method,
          url,
          message: msg,
          code: err && err.code ? String(err.code) : null
        },
        action: { type: 'restart' }
      });

      if (incident) {
        void sendTelegramMessage(formatIncidentForTelegram(incident));
      }
    }
  } catch (e) {
    // ignore
  }

  res.status(err.status || 500).send({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    requestId: req && req.requestId ? req.requestId : undefined
  });
});


async function maybeRunWebRagAutoSync() {
  const enabled = String(process.env.WEB_RAG_AUTO_SYNC || '').toLowerCase() === 'true';
  if (!enabled) return { skipped: true, reason: 'disabled' };

  const key = 'web_rag_last_sync_at';
  const intervalHoursRaw = parseFloat(process.env.WEB_RAG_AUTO_SYNC_INTERVAL_HOURS || '24');
  const intervalHours = Number.isFinite(intervalHoursRaw) && intervalHoursRaw > 0 ? intervalHoursRaw : 24;
  const intervalMs = intervalHours * 60 * 60 * 1000;

  try {
    const row = await prisma.setting.findUnique({ where: { key }, select: { value: true } }).catch(() => null);
    const lastMs = row && row.value ? Date.parse(row.value) : 0;
    if (lastMs && Date.now() - lastMs < intervalMs) {
      return { skipped: true, reason: 'recent', lastSyncAt: row.value, intervalHours };
    }

    const { ingestWebSeedsToRag } = require('./engine/webRagIngest');
    const result = await ingestWebSeedsToRag({
      mode: process.env.WEB_RAG_MODE || 'sitemap',
      maxPages: process.env.WEB_RAG_MAX_PAGES || process.env.WEB_SEARCH_MAX_PAGES || '6',
      divisionKey: process.env.WEB_RAG_DIVISION_KEY || ''
    });

    if (result && result.ok) {
      await prisma.setting.upsert({
        where: { key },
        create: { key, value: new Date().toISOString() },
        update: { value: new Date().toISOString() }
      }).catch(() => null);
    }

    return result;
  } catch (err) {
    logger.warn({ err: err && err.message ? err.message : String(err) }, '[WebRAG] Auto sync failed');
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}
// Jalankan server
const { port: listenPort, host: listenHost } = resolveServerListenConfig(process.env);
try { console.log('[SERVER_STARTING]', { port: listenPort, host: listenHost }); } catch (e) {}
const server = app.listen(listenPort, listenHost, async () => {
  try { console.log('[SERVER_LISTEN_CALLBACK_ENTER]', { port: listenPort, host: listenHost }); } catch (e) {}
  logger.info({ port: listenPort, host: listenHost, env: process.env.NODE_ENV || 'development' }, '[Server] Listening');

  // Initialize Redis untuk rate limiting (optional)
  try {
    await initializeRedis();
    try {
      const warmed = prewarmSemanticRag();
      logger.info(warmed, '[SemanticRAG] Prewarm complete');
    } catch (warmErr) {
      logger.warn({ err: warmErr && warmErr.message ? warmErr.message : String(warmErr) }, '[SemanticRAG] Prewarm failed');
    }

    setImmediate(async () => {
      const result = await maybeRunWebRagAutoSync();
      if (result && !result.skipped) logger.info(result, '[WebRAG] Auto sync complete');
      else if (result && result.skipped) logger.info(result, '[WebRAG] Auto sync skipped');
    });
    try { console.log('[SERVER_READY]', PORT); } catch (e) {}
  } catch (err) {
    try { console.error('[SERVER_INIT_ERROR] initializeRedis failed', err && err.message ? err.message : err); } catch (e) {}
    logger.error({ err: err && err.message ? err.message : err }, '[Server] initializeRedis failed');
  }
});

// Prevent Node from crashing on unhandled server 'error' events (e.g., EADDRINUSE)
server.on('error', (err) => {
  const code = err && err.code ? String(err.code) : 'UNKNOWN';

  if (code === 'EADDRINUSE') {
    logger.error({ port: listenPort, host: listenHost }, '[Server] Port already in use (EADDRINUSE). Another instance may be running.');
    logger.info('[Server] Stop the existing process or set PORT to a different value.');
    process.exit(1);
  }

  logger.error({ err }, '[Server] Server error');
  process.exit(1);
});

// === Mode development: helper untuk simulasi pesan masuk ===
// Endpoint: POST /_simulate  { chatId, text }
// - Memudahkan pengujian tanpa integrasi WhatsApp nyata.
if (process.env.NODE_ENV !== 'production') {
  app.post('/_simulate', (req, res) => {
    try {
      const { chatId, text } = req.body;
      if (!chatId || !text) {
        return res.status(400).send({ error: 'chatId dan text wajib diisi' });
      }
      // Memicu event 'message' pada provider mock
      provider.simulateIncoming(chatId, text);
      res.send({ ok: true });
    } catch (err) {
      logger.error({ err }, 'Error di /_simulate');
      res.status(500).send({ error: err.message });
    }
  });
}

// === Graceful shutdown ===
process.on('SIGINT', async () => {
  logger.info('[Server] Shutting down gracefully...');
  broadcastScheduler.stop();
  
  // Close Redis connection
  await closeRedis();

  try {
    await disconnectPrisma();
  } catch (err) {
    logger.error({ err }, '[Prisma] Error during shutdown');
  }

  server.close(() => {
    logger.info('[Server] Server closed');
    process.exit(0);
  });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise }, '[Error] Unhandled Rejection');

  // Best-effort alert to Telegram (interactive repair can be triggered via reply "YA")
  try {
    const msg = reason && reason.message ? String(reason.message) : String(reason);
    const incident = createIncident({
      kind: 'unhandled_rejection',
      summary: msg,
      details: { message: msg },
      action: { type: 'restart' }
    });
    if (incident) {
      void sendTelegramMessage(formatIncidentForTelegram(incident));
    }
  } catch (e) {
    // ignore
  }
});




