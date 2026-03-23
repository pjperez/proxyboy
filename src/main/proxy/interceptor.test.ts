import { describe, expect, it } from 'vitest';
import type { MapRemoteRule } from '../../shared/types';
import { Interceptor } from './interceptor';

describe('Interceptor regex hardening', () => {
  it('allows straightforward URL regex rules', () => {
    const interceptor = new Interceptor();
    expect(
      interceptor.matchesUrl('^https://mail\\.google\\.com/.*$', 'https://mail.google.com/inbox', true)
    ).toBe(true);
  });

  it('blocks nested quantified groups', () => {
    const interceptor = new Interceptor();
    expect(interceptor.matchesUrl('(a+)+$', 'aaaaaaaaaaaaaaaa!', true)).toBe(false);
    expect(interceptor.matchesUrl('(.*)+$', 'https://example.com', true)).toBe(false);
    expect(interceptor.matchesUrl('(a|aa)+$', 'aaaaa', true)).toBe(false);
  });

  it('blocks backreferences and lookarounds', () => {
    const interceptor = new Interceptor();
    expect(interceptor.matchesUrl('(foo)\\1', 'foofoo', true)).toBe(false);
    expect(interceptor.matchesUrl('(?=https://)https://example\\.com', 'https://example.com', true)).toBe(false);
  });
});

describe('Interceptor capture filters', () => {
  it('skips matching traffic in block-list mode', () => {
    const interceptor = new Interceptor();
    interceptor.setRules([
      {
        id: 'block-api',
        type: 'block-list',
        name: 'Block API',
        enabled: true,
        matchCriteria: { urlPattern: '*/api/*' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);
    interceptor.setCaptureMode('block-list');

    expect(interceptor.shouldCapture('https://example.com/api/users', 'GET')).toBe(false);
    expect(interceptor.shouldCapture('https://example.com/assets/logo.png', 'GET')).toBe(true);
  });

  it('captures only matching traffic in allow-list mode', () => {
    const interceptor = new Interceptor();
    interceptor.setRules([
      {
        id: 'allow-posts',
        type: 'allow-list',
        name: 'Allow POSTs',
        enabled: true,
        matchCriteria: { urlPattern: '*/api/*', methods: ['POST'] },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);
    interceptor.setCaptureMode('allow-list');

    expect(interceptor.shouldCapture('https://example.com/api/users', 'POST')).toBe(true);
    expect(interceptor.shouldCapture('https://example.com/api/users', 'GET')).toBe(false);
    expect(interceptor.shouldCapture('https://example.com/assets/logo.png', 'POST')).toBe(false);
  });

  it('falls back to capture-all when allow-list mode has no enabled rules', () => {
    const interceptor = new Interceptor();
    interceptor.setRules([]);
    interceptor.setCaptureMode('allow-list');

    expect(interceptor.shouldCapture('https://example.com/api/users', 'GET')).toBe(true);
  });

  it('captures everything in capture-all mode even when filter rules exist', () => {
    const interceptor = new Interceptor();
    interceptor.setRules([
      {
        id: 'allow-api',
        type: 'allow-list',
        name: 'Allow API',
        enabled: true,
        matchCriteria: { urlPattern: '*/api/*' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: 'block-static',
        type: 'block-list',
        name: 'Block static',
        enabled: true,
        matchCriteria: { urlPattern: '*/static/*' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);
    interceptor.setCaptureMode('capture-all');

    expect(interceptor.shouldCapture('https://example.com/api/users', 'GET')).toBe(true);
    expect(interceptor.shouldCapture('https://example.com/static/app.js', 'GET')).toBe(true);
  });
});

describe('Interceptor map remote rules', () => {
  it('returns the first enabled map-remote rule that matches the request', () => {
    const interceptor = new Interceptor();
    const mapRemoteRule: MapRemoteRule = {
      id: 'map-remote-api',
      type: 'map-remote',
      name: 'Route API to staging',
      enabled: true,
      matchCriteria: { urlPattern: '*://api.example.com/*', methods: ['GET'] },
      destinationUrl: 'https://staging.example.net',
      preservePath: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    interceptor.setRules([mapRemoteRule]);

    const matchedRule = interceptor.getMapRemoteRule('https://api.example.com/users', 'GET');
    expect(matchedRule?.destinationUrl).toBe('https://staging.example.net');
    expect(interceptor.getMapRemoteRule('https://api.example.com/users', 'POST')).toBeNull();
  });
});
