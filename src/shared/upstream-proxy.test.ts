import { describe, expect, it } from 'vitest';
import { normalizeUpstreamProxySettings, shouldBypassUpstreamProxy } from './upstream-proxy';

describe('normalizeUpstreamProxySettings', () => {
  it('trims text fields and keeps valid proxy config', () => {
    expect(
      normalizeUpstreamProxySettings({
        enabled: true,
        type: 'socks5',
        host: ' corp-proxy ',
        port: 1080,
        username: ' user ',
        password: 'secret',
        bypassPatterns: [' localhost ', '', '*.internal'],
      }),
    ).toEqual({
      enabled: true,
      type: 'socks5',
      host: 'corp-proxy',
      port: 1080,
      username: 'user',
      password: 'secret',
      bypassPatterns: ['localhost', '*.internal'],
    });
  });
});

describe('shouldBypassUpstreamProxy', () => {
  it('matches host or URL glob patterns', () => {
    expect(shouldBypassUpstreamProxy('https://api.internal.example/users', 'api.internal.example', ['*.internal.example'])).toBe(true);
    expect(shouldBypassUpstreamProxy('https://example.com/healthz', 'example.com', ['*://example.com/healthz'])).toBe(true);
    expect(shouldBypassUpstreamProxy('https://example.com/users', 'example.com', ['*.internal.example'])).toBe(false);
  });

  it('matches bare host bypass patterns when the request host includes a port', () => {
    expect(shouldBypassUpstreamProxy('http://localhost:3000/api', 'localhost:3000', ['localhost'])).toBe(true);
    expect(shouldBypassUpstreamProxy('https://127.0.0.1:8443/health', '127.0.0.1:8443', ['127.0.0.1'])).toBe(true);
  });

  it('does not treat hostname globs as URL-path globs', () => {
    expect(shouldBypassUpstreamProxy('https://attacker.com/exfil.corp.example', 'attacker.com', ['*.corp.example'])).toBe(false);
  });
});
