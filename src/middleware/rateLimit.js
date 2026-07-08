// Rate limiting sederhana (in-memory)
// Untuk production, gunakan redis

const rateLimit = {};

// Helper: check rate limit
function checkRateLimit(key, maxRequests = 10, windowMs = 60000) {
  // windowMs = 1 minute
  const now = Date.now();
  
  if (!rateLimit[key]) {
    rateLimit[key] = { count: 1, resetAt: now + windowMs };
    return { allowed: true, remaining: maxRequests - 1 };
  }

  const entry = rateLimit[key];
  
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
    return { allowed: false, remaining: 0, resetIn: Math.ceil((entry.resetAt - now) / 1000) };
  }

  return { allowed: true, remaining };
}

// Middleware: rate limit
function rateLimitMiddleware(maxRequests = 100, windowMs = 60000) {
  return (req, res, next) => {
    // Gunakan IP atau user ID sebagai key
    const key = req.user?.username || req.ip || 'anonymous';
    const result = checkRateLimit(key, maxRequests, windowMs);

    // Set headers
    res.set('X-RateLimit-Limit', maxRequests);
    res.set('X-RateLimit-Remaining', result.remaining);

    if (!result.allowed) {
      console.warn(`[RateLimit] Too many requests dari ${key}. Reset in ${result.resetIn}s`);
      return res.status(429).send({ 
        error: 'Terlalu banyak request. Coba lagi dalam ' + result.resetIn + ' detik' 
      });
    }

    next();
  };
}

module.exports = { checkRateLimit, rateLimitMiddleware };
