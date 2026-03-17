import * as dns from 'dns';
import { isIP } from 'net';

interface CachedResult {
  address: string;
  family: number;
  timestamp: number;
}

export interface TimedLookupResult {
  address: string;
  family: number;
  dnsStart: number;
  dnsEnd: number;
  cacheHit: boolean;
}

const CACHE_TTL = 60_000; // 60 seconds
const MAX_DNS_SERVERS = 5;
const MAX_SERVER_LENGTH = 128;

function normalizeDnsServer(server: string): string | null {
  const trimmed = server.trim();
  if (!trimmed || trimmed.length > MAX_SERVER_LENGTH) return null;

  const withoutBrackets =
    trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed;

  return isIP(withoutBrackets) ? withoutBrackets : null;
}

export class DnsResolverService {
  private resolver: dns.Resolver;
  private cache = new Map<string, CachedResult>();
  private customServers: string[] = [];

  constructor() {
    this.resolver = new dns.Resolver();
  }

  setServers(servers: string[]): void {
    if (!Array.isArray(servers)) {
      throw new Error('DNS servers must be provided as an array');
    }
    if (servers.length > MAX_DNS_SERVERS) {
      throw new Error(`Too many DNS servers (max ${MAX_DNS_SERVERS})`);
    }

    const normalized = servers
      .map(normalizeDnsServer)
      .filter((server): server is string => Boolean(server));

    if (servers.length > 0 && normalized.length !== servers.length) {
      throw new Error('One or more DNS servers are invalid');
    }

    this.customServers = normalized;
    this.resolver = new dns.Resolver();
    if (normalized.length > 0) {
      this.resolver.setServers(normalized);
    }
    this.cache.clear();
  }

  getServers(): string[] {
    return this.customServers.length > 0 ? [...this.customServers] : dns.getServers();
  }

  getMode(): 'system' | 'custom' {
    return this.customServers.length > 0 ? 'custom' : 'system';
  }

  timedLookup(hostname: string): Promise<TimedLookupResult> {
    const cached = this.cache.get(hostname);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      const now = Date.now();
      return Promise.resolve({
        address: cached.address,
        family: cached.family,
        dnsStart: now,
        dnsEnd: now,
        cacheHit: true,
      });
    }

    const dnsStart = Date.now();

    return new Promise((resolve, reject) => {
      const onResult = (address: string, family: number) => {
        const dnsEnd = Date.now();
        this.cache.set(hostname, { address, family, timestamp: dnsEnd });
        resolve({ address, family, dnsStart, dnsEnd, cacheHit: false });
      };

      const onError = (error: Error) => {
        reject(new Error(`DNS lookup failed for ${hostname}: ${error.message}`));
      };

      if (this.customServers.length > 0) {
        this.resolver.resolve4(hostname, (err, addresses) => {
          if (err || !addresses?.length) {
            dns.lookup(hostname, (err2, address, family) => {
              if (err2 || !address) {
                onError(err2 || err || new Error('Unknown DNS failure'));
                return;
              }
              onResult(address, family);
            });
            return;
          }
          onResult(addresses[0], 4);
        });
        return;
      }

      dns.lookup(hostname, (err, address, family) => {
        if (err || !address) {
          onError(err || new Error('Unknown DNS failure'));
          return;
        }
        onResult(address, family);
      });
    });
  }

  clearCache(): void {
    this.cache.clear();
  }
}
