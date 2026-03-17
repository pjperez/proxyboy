import { describe, expect, it } from 'vitest';
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
