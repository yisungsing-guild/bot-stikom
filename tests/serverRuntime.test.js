const { resolveServerListenConfig } = require('../src/config/serverRuntime');

describe('resolveServerListenConfig', () => {
  it('uses 0.0.0.0 in production when HOST is not provided', () => {
    expect(resolveServerListenConfig({ NODE_ENV: 'production', PORT: '3000' })).toEqual({
      port: '3000',
      host: '0.0.0.0'
    });
  });

  it('uses explicit HOST when provided', () => {
    expect(resolveServerListenConfig({ NODE_ENV: 'production', HOST: '0.0.0.0', PORT: '3000' })).toEqual({
      port: '3000',
      host: '0.0.0.0'
    });
  });

  it('uses localhost for local development', () => {
    expect(resolveServerListenConfig({ NODE_ENV: 'development', PORT: '4000' })).toEqual({
      port: '4000',
      host: '127.0.0.1'
    });
  });
});
