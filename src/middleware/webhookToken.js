function extractBearerToken(authHeader) {
  const raw = typeof authHeader === 'string' ? authHeader.trim() : '';
  if (!raw) return null;
  const m = /^bearer\s+(.+)$/i.exec(raw);
  return m ? m[1].trim() : null;
}

function firstNonEmptyString(...values) {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function constantTimeEquals(a, b) {
  const sa = typeof a === 'string' ? a : '';
  const sb = typeof b === 'string' ? b : '';
  if (!sa || !sb) return false;
  if (sa.length !== sb.length) return false;
  let out = 0;
  for (let i = 0; i < sa.length; i++) {
    out |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  }
  return out === 0;
}

function requireWebhookToken(expectedToken, opts = {}) {
  const {
    headerName = 'x-webhook-token',
    queryParamNames = ['token', 'verify_token'],
    allowIfExpectedMissing = true,
    errorStatus = 401,
    onReject = null
  } = opts;

  return (req, res, next) => {
    const expected = (typeof expectedToken === 'string') ? expectedToken.trim() : '';
    if (!expected) {
      if (allowIfExpectedMissing) return next();
      return res.status(errorStatus).send({ error: 'webhook token not configured' });
    }

    const headerToken = req.headers ? req.headers[String(headerName).toLowerCase()] : null;

    const q = req.query || {};
    const queryToken = firstNonEmptyString(...queryParamNames.map(n => (typeof q[n] === 'string') ? q[n] : null));

    const bearerToken = extractBearerToken(req.headers ? req.headers.authorization : null);

    const providedFromHeader = typeof headerToken === 'string' ? headerToken : null;
    const provided = firstNonEmptyString(providedFromHeader, bearerToken, queryToken);

    if (provided && constantTimeEquals(provided, expected)) return next();

    if (typeof onReject === 'function') {
      let source = null;
      if (provided && providedFromHeader && provided === providedFromHeader) source = 'header';
      else if (provided && bearerToken && provided === bearerToken) source = 'bearer';
      else if (provided && queryToken && provided === queryToken) source = 'query';

      try {
        Promise.resolve(onReject({
          path: req.originalUrl,
          hasProvidedToken: Boolean(provided),
          providedTokenLength: provided ? String(provided).length : 0,
          expectedTokenLength: expected ? String(expected).length : 0,
          source
        })).catch(() => {});
      } catch (e) {
        // ignore diagnostics errors
      }
    }

    return res.status(errorStatus).send({ error: 'unauthorized' });
  };
}

module.exports = {
  requireWebhookToken
};
