import * as dns from 'dns';

interface CachedResult {
  address: string;
  family: number;
  timestamp: number;
}

const CACHE_TTL = 60_000; // 60 seconds

export class DnsResolverService {
  private resolver: dns.Resolver;
  private cache = new Map<string, CachedResult>();
  private customServers: string[] = [];

  constructor() {
    this.resolver = new dns.Resolver();
  }

  setServers(servers: string[]): void {
    this.customServers = servers;
    if (servers.length > 0) {
      this.resolver = new dns.Resolver();
      this.resolver.setServers(servers);
    } else {
      this.resolver = new dns.Resolver();
    }
    this.cache.clear();
  }

  getServers(): string[] {
    return this.customServers.length > 0 ? this.customServers : dns.getServers();
  }

  getMode(): 'system' | 'custom' {
    return this.customServers.length > 0 ? 'custom' : 'system';
  }

  /**
   * Timed DNS lookup with caching.
   * Returns resolved address plus timing data (dnsStart, dnsEnd).
   */
  timedLookup(hostname: string): Promise<{ address: string; family: number; dnsStart: number; dnsEnd: number }> {
    // Check cache first
    const cached = this.cache.get(hostname);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      const now = Date.now();
      return Promise.resolve({ address: cached.address, family: cached.family, dnsStart: now, dnsEnd: now });
    }

    const dnsStart = Date.now();

    return new Promise((resolve) => {
      const onResult = (address: string, family: number) => {
        const dnsEnd = Date.now();
        this.cache.set(hostname, { address, family, timestamp: dnsEnd });
        resolve({ address, family, dnsStart, dnsEnd });
      };

      const onError = () => {
        // On error, resolve with 0.0.0.0 so request still proceeds (proxy will DNS again)
        resolve({ address: '0.0.0.0', family: 4, dnsStart, dnsEnd: Date.now() });
      };

      if (this.customServers.length > 0) {
        this.resolver.resolve4(hostname, (err, addresses) => {
          if (err || !addresses?.length) {
            // Fallback to system DNS
            dns.lookup(hostname, (err2, addr, fam) => {
              if (err2) return onError();
              onResult(addr, fam);
            });
            return;
          }
          onResult(addresses[0], 4);
        });
      } else {
        dns.lookup(hostname, (err, address, family) => {
          if (err) return onError();
          onResult(address, family);
        });
      }
    });
  }

  clearCache(): void {
    this.cache.clear();
  }
}
