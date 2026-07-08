function resolveServerListenConfig(env = process.env) {
  const nodeEnv = String(env.NODE_ENV || '').toLowerCase();
  const port = env.PORT || '4000';
  const explicitHost = String(env.HOST || '').trim();

  if (explicitHost) {
    return { port, host: explicitHost };
  }

  if (nodeEnv === 'production') {
    return { port, host: '0.0.0.0' };
  }

  return { port, host: '127.0.0.1' };
}

module.exports = { resolveServerListenConfig };
