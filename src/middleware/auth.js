const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const logger = require('../logger');
const prisma = require('../db');

// Read super-admin usernames from env (comma/semicolon separated)
function getSuperAdminUsernames() {
  const raw = String(process.env.SUPERADMIN_USERS || process.env.SUPERADMIN_USERNAMES || '') || '';
  return raw
    .split(/[;,\s]+/)
    .map(s => String(s || '').trim().toLowerCase())
    .filter(Boolean);
}

function isSuperAdminUsername(username) {
  if (!username) return false;
  const list = getSuperAdminUsernames();
  return list.includes(String(username).toLowerCase());
}

function getSuperAdminDisplayNames() {
  const raw = String(process.env.SUPERADMIN_DISPLAYNAMES || process.env.SUPERADMIN_NAMES || '') || '';
  return raw
    .split(/[;,]+/)
    .map(s => String(s || '').trim().toLowerCase())
    .filter(Boolean);
}

function isSuperAdminDisplayName(displayName) {
  if (!displayName) return false;
  const list = getSuperAdminDisplayNames();
  return list.includes(String(displayName).toLowerCase());
}

// ===== SECURITY CHECK =====
// Warn jika masih menggunakan default credentials
const defaultUsername = 'admin';
const defaultPassword = 'admin123';
const defaultJwtSecret = 'your-secret-key-change-in-production';

let warnedPlaintextAdminPasswordInProd = false;

if (process.env.NODE_ENV === 'production') {
  if (process.env.ADMIN_USERNAME === defaultUsername || 
      process.env.ADMIN_PASSWORD === defaultPassword ||
      process.env.JWT_SECRET === defaultJwtSecret) {
    console.error('⚠️  CRITICAL SECURITY WARNING ⚠️');
    console.error('Default credentials or JWT secret detected in PRODUCTION!');
    console.error('Please update .env with strong, unique credentials immediately.');
    if (process.env.ADMIN_PASSWORD === defaultPassword) {
      process.exit(1); // Jangan biarkan server berjalan dengan default password di production
    }
  }
}

// Helper: hash password dengan bcrypt
async function hashPassword(password) {
  const saltRounds = 10; // Cost factor untuk bcrypt
  return await bcrypt.hash(password, saltRounds);
}

// Helper: verify password dengan bcrypt
async function verifyPassword(password, hash) {
  return await bcrypt.compare(password, hash);
}

function safeJsonParse(raw) {
  try {
    if (!raw) return null;
    const unwrapOnce = (input) => {
      let s = String(input).trim();
      if (!s) return s;
      if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
        s = s.slice(1, -1).trim();
      }
      return s;
    };

    // 1) Parse the raw value (tolerate wrapped quotes)
    const first = JSON.parse(unwrapOnce(raw));

    // 2) Some panels double-encode JSON into a JSON string.
    // Example value becomes: "[{\"username\":\"akademik\",...}]"
    if (typeof first === 'string') {
      return JSON.parse(unwrapOnce(first));
    }

    return first;
  } catch {
    return null;
  }
}

function parseEnvAdminUsers() {
  // Supports:
  // - ADMIN_USERS_JSON: JSON array of users or { users: [...] }
  //   User shape: { username, password?, passwordHash?, role?, displayName? }
  // - ADMIN_USERS: compact string list, separated by ';' or ','
  //   Entry format: username:password:role:displayName (role/displayName optional)
  // Notes:
  // - If password/passwordHash begins with '$2', it is treated as bcrypt hash.
  // - Prefer ADMIN_USERS_JSON for passwords containing ':' / ';' / ','.

  const users = [];

  const jsonRaw = process.env.ADMIN_USERS_JSON;
  if (jsonRaw && String(jsonRaw).trim()) {
    const parsed = safeJsonParse(jsonRaw);
    const arr = Array.isArray(parsed)
      ? parsed
      : (parsed && Array.isArray(parsed.users) ? parsed.users : null);

    if (Array.isArray(arr)) {
      for (const u of arr) {
        if (!u || typeof u !== 'object') continue;
        const username = String(u.username || '').trim();
        if (!username) continue;
        const password = u.password != null ? String(u.password) : null;
        const passwordHash = u.passwordHash != null ? String(u.passwordHash) : null;
        const role = String(u.role || '').trim() || 'admin';
        const displayName = u.displayName != null ? String(u.displayName) : null;
        users.push({ username, password, passwordHash, role, displayName });
      }
      return users;
    }
  }

  const compact = process.env.ADMIN_USERS;
  if (!compact || !String(compact).trim()) return users;

  const entries = String(compact)
    .split(/[;,]/g)
    .map(s => s.trim())
    .filter(Boolean);

  for (const entry of entries) {
    const parts = entry.split(':');
    const username = String(parts[0] || '').trim();
    if (!username) continue;

    const password = parts.length >= 2 ? String(parts[1] || '') : null;
    const role = parts.length >= 3 ? String(parts[2] || '').trim() : '';
    const displayName = parts.length >= 4 ? parts.slice(3).join(':').trim() : null;

    users.push({
      username,
      password,
      passwordHash: null,
      role: role || 'admin',
      displayName
    });
  }

  return users;
}

function withTimeout(promise, ms, timeoutMessage = 'Operation timed out') {
  const timeoutMs = Number(ms);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;

  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    if (timeoutId && typeof timeoutId.unref === 'function') timeoutId.unref();
  });

  const guarded = Promise.resolve(promise).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });

  return Promise.race([guarded, timeoutPromise]);
}

// Helper: generate JWT token dengan expiration yang tepat
function generateToken(payload, expiresIn = process.env.JWT_EXPIRES_IN || '24h') {
  const secret = process.env.JWT_SECRET;
  
  if (!secret) {
    throw new Error('JWT_SECRET not configured in .env');
  }
  
  // Warn jika masih menggunakan default secret di production
  if (process.env.NODE_ENV === 'production' && secret === defaultJwtSecret) {
    console.error('⚠️  WARNING: Using default JWT_SECRET in production!');
  }
  
  return jwt.sign(payload, secret, { 
    expiresIn,
    issuer: 'whatsapp-bot-api',
    audience: 'whatsapp-bot-admin'
  });
}

// Helper: generate refresh token (long-lived untuk token rotation)
function generateRefreshToken(payload) {
  const secret = process.env.JWT_SECRET;
  return jwt.sign(payload, secret, { 
    expiresIn: '7d', // Refresh token valid 7 hari
    issuer: 'whatsapp-bot-api',
    subject: 'refresh'
  });
}

// Middleware: verify JWT token dengan validasi ketat
function verifyToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).send({ 
        error: 'Token required. Format: Authorization: Bearer <token>' 
      });
    }

    const token = authHeader.substring(7);
    const secret = process.env.JWT_SECRET;
    
    if (!secret) {
      logger.error('[Auth] JWT_SECRET not configured');
      return res.status(500).send({ error: 'Internal server error' });
    }

    try {
      const decoded = jwt.verify(token, secret);
      
      req.user = decoded;
      next();
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).send({ 
          error: 'Token expired',
          expiredAt: err.expiredAt
        });
      } else if (err.name === 'JsonWebTokenError') {
        logger.warn({ err: err.message }, '[Auth] JWT verification failed');
        return res.status(401).send({ error: 'Invalid token' });
      }
      throw err;
    }
  } catch (err) {
    logger.error({ err: err.message }, '[Auth Error]');
    res.status(401).send({ error: 'Authentication failed' });
  }
}

// Endpoint: Login (generate token)
// Body: { username, password }
// Response: { ok: true, token, refreshToken, expiresIn }
function createAuthRoute() {
  const express = require('express');
  const router = express.Router();

  router.post('/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      
      // Validasi input
      if (!username || !password) {
        return res.status(400).send({ error: 'Username dan password wajib diisi' });
      }

      // Auth mode flags:
      // - AUTH_PREFER_ENV_USERS=true: check env users before DB.
      // - AUTH_FORCE_ENV_USERS=true OR AUTH_SKIP_DB_LOOKUP=true: skip DB lookup entirely (env users + legacy env fallback only).
      const preferEnvUsers = String(process.env.AUTH_PREFER_ENV_USERS || '').toLowerCase() === 'true';
      const forceEnvUsers = String(process.env.AUTH_FORCE_ENV_USERS || '').toLowerCase() === 'true';
      const skipDbLookupByEnv = String(process.env.AUTH_SKIP_DB_LOOKUP || '').toLowerCase() === 'true' || forceEnvUsers;

      // Fallback #1 (optional first): Multi-user from env
      // Useful for demos and also for cases where DB contains a conflicting username.
      if (preferEnvUsers || forceEnvUsers) {
        const envUsers = parseEnvAdminUsers();
        if (envUsers.length > 0) {
          const envUser = envUsers.find(u => String(u.username).toLowerCase() === String(username).toLowerCase());

          if (envUser) {
            const hashCandidate = envUser.passwordHash || envUser.password;
            const looksLikeBcrypt = typeof hashCandidate === 'string' && hashCandidate.startsWith('$2');
            let passwordValid = false;

            if (looksLikeBcrypt) {
              passwordValid = await verifyPassword(password, hashCandidate);
            } else {
              if (process.env.NODE_ENV === 'production' && !warnedPlaintextAdminPasswordInProd) {
                warnedPlaintextAdminPasswordInProd = true;
                logger.warn('[Auth] Env user password is not bcrypt-hashed in production. Strongly recommended to use bcrypt hashes via ADMIN_USERS_JSON.passwordHash.');
              }
              passwordValid = password === String(envUser.password || '');
            }

            if (!passwordValid) {
              logger.warn({ username }, '[Auth] Failed login attempt: invalid password (env users)');
              return res.status(401).send({ error: 'Username atau password salah' });
            }

            const identity = {
              adminId: null,
              username: envUser.username,
              displayName: envUser.displayName || null,
              role: envUser.role || 'admin'
            };

            // Allow overriding certain usernames to superadmin via env
            if (isSuperAdminUsername(identity.username) || isSuperAdminDisplayName(identity.displayName)) {
              identity.role = 'superadmin';
            }

            const token = generateToken({ ...identity, type: 'access' });
            const refreshToken = generateRefreshToken({ ...identity, type: 'refresh' });

            logger.info({ username: envUser.username, role: identity.role }, '[Auth] Successful login (env users)');
            return res.send({
              ok: true,
              token,
              refreshToken,
              expiresIn: process.env.JWT_EXPIRES_IN || '24h'
            });
          }
        }
      }

      // Prefer DB-based login (multi-role) if AdminUser exists.
      let dbUser = null;
      try {
        // If DB is down/unreachable, Prisma can take a while to error.
        // Apply a short timeout so env-based demo users can still login quickly.
        const skipDbLookup = String(process.env.NODE_ENV || '').toLowerCase() === 'test' || skipDbLookupByEnv;
        if (!skipDbLookup) {
          const dbLookupTimeoutMs = parseInt(process.env.AUTH_DB_LOOKUP_TIMEOUT_MS || '800', 10);
          dbUser = await withTimeout(
            prisma.adminUser.findUnique({
              where: { username },
              select: { id: true, username: true, displayName: true, role: true, passwordHash: true }
            }),
            dbLookupTimeoutMs,
            'AdminUser lookup timed out'
          );
        }
      } catch (err) {
        // If DB is not reachable/migrated yet, fall back to env-based auth.
        logger.warn({ err: err.message }, '[Auth] AdminUser lookup failed; falling back to env auth');
      }

      if (dbUser) {
        const passwordValid = await verifyPassword(password, dbUser.passwordHash);
        if (!passwordValid) {
          logger.warn({ username }, '[Auth] Failed login attempt: invalid password');
          return res.status(401).send({ error: 'Username atau password salah' });
        }

        const identity = {
          adminId: dbUser.id,
          username: dbUser.username,
          displayName: dbUser.displayName,
          role: dbUser.role
        };

        // Override role to superadmin for configured usernames
        if (isSuperAdminUsername(identity.username) || isSuperAdminDisplayName(identity.displayName)) {
          identity.role = 'superadmin';
        }

        const token = generateToken({ ...identity, type: 'access' });
        const refreshToken = generateRefreshToken({ ...identity, type: 'refresh' });

        logger.info({ username, role: dbUser.role }, '[Auth] Successful login (db)');
        return res.send({
          ok: true,
          token,
          refreshToken,
          expiresIn: process.env.JWT_EXPIRES_IN || '24h'
        });
      }

      // Fallback #1: Multi-user from env (useful for demo when DB is down)
      // Note: if AUTH_PREFER_ENV_USERS/AUTH_FORCE_ENV_USERS was set, we already checked env users earlier.
      if (!preferEnvUsers && !forceEnvUsers) {
        const envUsers = parseEnvAdminUsers();
        if (envUsers.length > 0) {
          const envUser = envUsers.find(u => String(u.username).toLowerCase() === String(username).toLowerCase());

          if (envUser) {
            const hashCandidate = envUser.passwordHash || envUser.password;
            const looksLikeBcrypt = typeof hashCandidate === 'string' && hashCandidate.startsWith('$2');
            let passwordValid = false;

            if (looksLikeBcrypt) {
              passwordValid = await verifyPassword(password, hashCandidate);
            } else {
              if (process.env.NODE_ENV === 'production' && !warnedPlaintextAdminPasswordInProd) {
                warnedPlaintextAdminPasswordInProd = true;
                logger.warn('[Auth] Env user password is not bcrypt-hashed in production. Strongly recommended to use bcrypt hashes via ADMIN_USERS_JSON.passwordHash.');
              }
              passwordValid = password === String(envUser.password || '');
            }

            if (!passwordValid) {
              logger.warn({ username }, '[Auth] Failed login attempt: invalid password (env users)');
              return res.status(401).send({ error: 'Username atau password salah' });
            }

            const identity = {
              adminId: null,
              username: envUser.username,
              displayName: envUser.displayName || null,
              role: envUser.role || 'admin'
            };

            if (isSuperAdminUsername(identity.username) || isSuperAdminDisplayName(identity.displayName)) {
              identity.role = 'superadmin';
            }

            const token = generateToken({ ...identity, type: 'access' });
            const refreshToken = generateRefreshToken({ ...identity, type: 'refresh' });

            logger.info({ username: envUser.username, role: identity.role }, '[Auth] Successful login (env users)');
            return res.send({
              ok: true,
              token,
              refreshToken,
              expiresIn: process.env.JWT_EXPIRES_IN || '24h'
            });
          }
        }
      }

      // Fallback: Get credentials dari environment (legacy single-admin mode)
      const adminUsername = process.env.ADMIN_USERNAME;
      const adminPassword = process.env.ADMIN_PASSWORD;

      if (!adminUsername || !adminPassword) {
        logger.error('[Auth] ADMIN_USERNAME/ADMIN_PASSWORD not configured');
        return res.status(500).send({ error: 'Server configuration error' });
      }

      if (username !== adminUsername) {
        logger.warn({ username }, '[Auth] Failed login attempt: invalid username');
        return res.status(401).send({ error: 'Username atau password salah' });
      }

      let passwordValid = false;
      const adminPasswordIsBcryptHash = typeof adminPassword === 'string' && adminPassword.startsWith('$2');
      if (adminPasswordIsBcryptHash) {
        passwordValid = await verifyPassword(password, adminPassword);
      } else {
        if (process.env.NODE_ENV === 'production' && !warnedPlaintextAdminPasswordInProd) {
          warnedPlaintextAdminPasswordInProd = true;
          logger.warn('[Auth] ADMIN_PASSWORD is not bcrypt-hashed in production. Strongly recommended to use a bcrypt hash.');
        }
        passwordValid = password === adminPassword;
      }

      if (!passwordValid) {
        logger.warn({ username }, '[Auth] Failed login attempt: invalid password');
        return res.status(401).send({ error: 'Username atau password salah' });
      }

      const identity = {
        adminId: null,
        username,
        displayName: null,
        role: 'admin'
      };

      if (isSuperAdminUsername(identity.username) || isSuperAdminDisplayName(identity.displayName)) {
        identity.role = 'superadmin';
      }

      const token = generateToken({ ...identity, type: 'access' });
      const refreshToken = generateRefreshToken({ ...identity, type: 'refresh' });

      logger.info({ username }, '[Auth] Successful login (env fallback)');
      res.send({
        ok: true,
        token,
        refreshToken,
        expiresIn: process.env.JWT_EXPIRES_IN || '24h'
      });
    } catch (err) {
      logger.error({ err: err.message }, '[Auth Login Error]');
      res.status(500).send({ error: 'Login failed' });
    }
  });

  // Endpoint: Refresh token
  // Header: Authorization: Bearer <refreshToken>
  // Response: { ok: true, token, expiresIn }
  router.post('/refresh', (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).send({ error: 'Refresh token required' });
      }

      const refreshToken = authHeader.substring(7);
      const secret = process.env.JWT_SECRET;

      try {
        const decoded = jwt.verify(refreshToken, secret);

        // Validasi bahwa ini adalah refresh token
        if (decoded.type !== 'refresh') {
          return res.status(401).send({ error: 'Invalid token type' });
        }

        // Generate access token baru
        let newRole = decoded.role;
        if (isSuperAdminUsername(decoded.username) || isSuperAdminDisplayName(decoded.displayName)) newRole = 'superadmin';

        const newToken = generateToken({
          adminId: decoded.adminId || null,
          username: decoded.username,
          displayName: decoded.displayName || null,
          role: newRole,
          type: 'access'
        });

        console.log(`[Auth] Token refreshed for user: ${decoded.username}`);
        res.send({ 
          ok: true, 
          token: newToken,
          expiresIn: process.env.JWT_EXPIRES_IN || '24h'
        });
      } catch (err) {
        logger.warn({ err: err.message }, '[Auth Refresh Error verify]');
        return res.status(401).send({ error: 'Refresh token invalid or expired' });
      }
    } catch (err) {
      logger.error({ err: err.message }, '[Auth Refresh Error]');
      res.status(500).send({ error: 'Refresh failed' });
    }
  });

  return router;
}

module.exports = { 
  generateToken, 
  generateRefreshToken,
  verifyToken, 
  createAuthRoute,
  hashPassword,
  verifyPassword
};
