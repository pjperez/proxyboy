import { describe, expect, it } from 'vitest';
import { DnsResolverService } from './dns-resolver';

describe('DnsResolverService', () => {
  it('rejects invalid DNS server addresses', () => {
    const resolver = new DnsResolverService();
    expect(() => resolver.setServers(['not-a-dns-server'])).toThrow('invalid');
  });

  it('accepts valid DNS server addresses', () => {
    const resolver = new DnsResolverService();
    resolver.setServers(['8.8.8.8', '1.1.1.1']);
    expect(resolver.getMode()).toBe('custom');
    expect(resolver.getServers()).toEqual(['8.8.8.8', '1.1.1.1']);
  });

  it('returns to system mode when custom servers are cleared', () => {
    const resolver = new DnsResolverService();
    resolver.setServers(['8.8.8.8']);
    resolver.setServers([]);
    expect(resolver.getMode()).toBe('system');
  });
});
