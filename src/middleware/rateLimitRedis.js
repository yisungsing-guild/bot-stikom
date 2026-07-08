const redis = require('redis');
const logger = require('../logger');

// ===== REDIS-BASED RATE LIMITING =====
// Untuk production environment dengan multiple instances
// Support: Redis standard & Upstash REST API

let redisClient = null;
let useRedis = false;
let isUpstash = false;

// Initialize Redis client
async function initializeRedis() {
  try {
    // Check untuk Upstash (REST API)
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      logger.info('[RateLimit] Initializing Upstash Redis (REST API)...');
      const { Redis } = require('@upstash/redis');
      
      redisClient = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      });
      
      useRedis = true;
      isUpstash = true;
      logger.info('[Redis] ✓ Connected to Upstash');
      return { success: true, type: 'upstash' };
    }
    
    // Fallback ke Redis standard jika ada REDIS_URL
    if (!process.env.REDIS_URL) {
      logger.warn('[RateLimit] Redis not configured, falling back to in-memory rate limiting');
      return { success: false };
    }

    logger.info('[RateLimit] Initializing Redis (standard)...');
    redisClient = redis.createClient({
      url: process.env.REDIS_URL,
      password: process.env.REDIS_PASSWORD,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            logger.error('[Redis] Max reconnection attempts reached');
            return new Error('Max Redis reconnection attempts exceeded');
          }
          return retries * 50;
        }
      }
    });

    // Handle Redis events (hanya untuk Redis standard, bukan Upstash)
    if (!isUpstash) {
      redisClient.on('error', (err) => {
        logger.error({ err: err.message }, '[Redis] Error');
        useRedis = false;
      });

      redisClient.on('connect', () => {
        logger.info('[Redis] Connected');
        useRedis = true;
      });

      redisClient.on('ready', () => {
        logger.info('[Redis] Ready');
      });

      redisClient.on('end', () => {
        logger.info('[Redis] Connection closed');
        useRedis = false;
      });

      // Connect (hanya untuk Redis standard)
      await redisClient.connect();
      useRedis = true;
      logger.info('[RateLimit] ✓ Using Redis for rate limiting (distributed)');
      return { success: true, type: 'redis' };
    }
    
    return { success: true, type: 'redis' };
  } catch (err) {
    logger.warn({ err: err.message }, '[RateLimit] Redis initialization failed');
    logger.info('[RateLimit] Falling back to in-memory rate limiting');
    useRedis = false;
    return { success: false };
  }
}

// ===== IN-MEMORY FALLBACK RATE LIMITING =====

const inMemoryStore = {};

function checkRateLimitInMemory(key, maxRequests = 10, windowMs = 60000) {
  const now = Date.now();
  
  if (!inMemoryStore[key]) {
    inMemoryStore[key] = { count: 1, resetAt: now + windowMs };
    return { allowed: true, remaining: maxRequests - 1 };
  }

  const entry = inMemoryStore[key];
  
  // Reset jika sudah melewati window
  if (now > entry.resetAt) {
    entry.count = 1;
    entry.resetAt = now + windowMs;
    return { allowed: true, remaining: maxRequests - 1 };
  }

  // Increment counter
  entry.count++;
  const remaining = Math.max(0, maxRequests - entry.count);

  if (entry.count > maxRequests) {
    return { 
      allowed: false, 
      remaining: 0, 
      resetIn: Math.ceil((entry.resetAt - now) / 1000),
      retryAfter: Math.ceil((entry.resetAt - now) / 1000)
    };
  }

  return { allowed: true, remaining };
}

// ===== REDIS-BASED RATE LIMITING =====

async function checkRateLimitRedis(key, maxRequests = 10, windowMs = 60000) {
  if (!useRedis || !redisClient) {
    return checkRateLimitInMemory(key, maxRequests, windowMs);
  }

  try {
    const redisKey = `ratelimit:${key}`;
    const now = Date.now();
    const resetAt = now + windowMs;

    const unwrapExecValue = (v) => {
      // node-redis can return either plain values (v4) or tuples [err, value] (legacy-ish patterns)
      if (Array.isArray(v) && v.length === 2) return v[1];
      return v;
    };

    // Use Redis INCR with expiration
    // Atomic operation: increment dan set expiration
    const pipeline = redisClient.multi();
    
    pipeline.incr(redisKey);
    if (typeof pipeline.pExpire === 'function') {
      pipeline.pExpire(redisKey, windowMs);
    } else if (typeof pipeline.pexpire === 'function') {
      // Backward-compat for some clients
      pipeline.pexpire(redisKey, windowMs);
    } else {
      pipeline.expire(redisKey, Math.ceil(windowMs / 1000));
    }
    
    const results = await pipeline.exec();

    const countRaw = results && results[0] !== undefined ? unwrapExecValue(results[0]) : 0;
    const count = Number(countRaw) || 0; // Nilai setelah increment

    const remaining = Math.max(0, maxRequests - count);

    if (count > maxRequests) {
      // Get actual TTL untuk retry-after header
      let ttl;
      if (typeof redisClient.pTTL === 'function') {
        ttl = await redisClient.pTTL(redisKey);
      } else if (typeof redisClient.pttl === 'function') {
        ttl = await redisClient.pttl(redisKey);
      } else {
        const ttlSec = await redisClient.ttl(redisKey);
        ttl = Number(ttlSec) * 1000;
      }
      const retryAfter = Math.ceil(ttl / 1000);

      return {
        allowed: false,
        remaining: 0,
        resetIn: retryAfter,
        retryAfter: retryAfter
      };
    }

    return { allowed: true, remaining };
  } catch (err) {
    logger.error({ err: err.message }, '[Redis Rate Limit Error]');
    // Fallback to in-memory jika Redis error
    return checkRateLimitInMemory(key, maxRequests, windowMs);
  }
}

// ===== EXPRESS MIDDLEWARE =====

// Main rate limit middleware
function rateLimitMiddleware(maxRequests = 100, windowMs = 60000) {
  return async (req, res, next) => {
    try {
      // Gunakan username (jika sudah authenticated) atau IP sebagai key.
      // For login endpoint, include username to avoid one IP locking out all users.
      const loginUsername = (req && req.path && req.path.startsWith('/auth/login') && req.body && req.body.username)
        ? String(req.body.username)
        : null;
      const key = req.user?.username || (loginUsername ? `${req.ip || 'ip'}:${loginUsername}` : (req.ip || 'anonymous'));
      
      // Check rate limit
      const result = useRedis 
        ? await checkRateLimitRedis(key, maxRequests, windowMs)
        : checkRateLimitInMemory(key, maxRequests, windowMs);

      // Set rate limit headers
      res.set('X-RateLimit-Limit', maxRequests);
      res.set('X-RateLimit-Remaining', result.remaining);
      
      if (result.retryAfter) {
        res.set('Retry-After', result.retryAfter);
      }

      if (!result.allowed) {
        logger.warn({ key, resetIn: result.resetIn }, '[RateLimit] Too many requests');
        return res.status(429).send({
          error: `Rate limit exceeded. Try again in ${result.resetIn} seconds`,
          retryAfter: result.retryAfter
        });
      }

      next();
    } catch (err) {
      logger.error({ err: err.message }, '[RateLimit Middleware Error]');
      // Jangan block request jika ada error di rate limit check
      next();
    }
  };
}

// Specific rate limit middleware untuk admin endpoints
function adminRateLimitMiddleware(maxRequests = 50, windowMs = 60000) {
  return rateLimitMiddleware(maxRequests, windowMs);
}

// Grace shutdown untuk Redis connection
async function closeRedis() {
  if (redisClient && useRedis) {
    try {
      await redisClient.quit();
      logger.info('[Redis] Connection closed gracefully');
    } catch (err) {
      logger.error({ err: err.message }, '[Redis] Error closing connection');
    }
  }
}

module.exports = {
  initializeRedis,
  rateLimitMiddleware,
  adminRateLimitMiddleware,
  checkRateLimitRedis,
  checkRateLimitInMemory,
  closeRedis,
  getRedisClient: () => redisClient,
  isRedisActive: () => useRedis
};
