export type UpstreamProxyType = 'http' | 'socks5';

export interface UpstreamProxySettings {
  enabled: boolean;
  type: UpstreamProxyType;
  host: string;
  port: number;
  username: string;
  password: string;
  hasSavedPassword?: boolean;
  passwordChanged?: boolean;
  bypassPatterns: string[];
}

export const DEFAULT_UPSTREAM_PROXY_SETTINGS: UpstreamProxySettings = {
  enabled: false,
  type: 'http',
  host: '',
  port: 8080,
  username: '',
  password: '',
  hasSavedPassword: false,
  passwordChanged: false,
  bypassPatterns: [],
};

const UPSTREAM_PROXY_TYPES = new Set<UpstreamProxyType>(['http', 'socks5']);

export function isUpstreamProxyType(value: unknown): value is UpstreamProxyType {
  return typeof value === 'string' && UPSTREAM_PROXY_TYPES.has(value as UpstreamProxyType);
}

function normalizePort(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.min(65535, Math.round(value)));
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBypassPatterns(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeText(entry))
    .filter((entry) => entry.length > 0);
}

export function normalizeUpstreamProxySettings(
  settings: Partial<UpstreamProxySettings> | null | undefined,
): UpstreamProxySettings {
  return {
    enabled: Boolean(settings?.enabled),
    type: isUpstreamProxyType(settings?.type) ? settings.type : DEFAULT_UPSTREAM_PROXY_SETTINGS.type,
    host: normalizeText(settings?.host),
    port: normalizePort(settings?.port, DEFAULT_UPSTREAM_PROXY_SETTINGS.port),
    username: normalizeText(settings?.username),
    password: typeof settings?.password === 'string' ? settings.password : '',
    hasSavedPassword: Boolean(settings?.hasSavedPassword),
    passwordChanged: Boolean(settings?.passwordChanged),
    bypassPatterns: normalizeBypassPatterns(settings?.bypassPatterns),
  };
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

function extractHostname(value: string): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value.includes('://') ? value : `http://${value}`).hostname;
  } catch {
    return null;
  }
}

export function shouldBypassUpstreamProxy(requestUrl: string, requestHost: string, patterns: string[]): boolean {
  const requestHostname = extractHostname(requestHost);
  const requestUrlHostname = extractHostname(requestUrl);
  return patterns.some((pattern) => {
    const regex = globToRegex(pattern);
    const isUrlPattern = pattern.includes('://');
    return regex.test(requestHost)
      || (requestHostname !== null && regex.test(requestHostname))
      || (requestUrlHostname !== null && regex.test(requestUrlHostname))
      || (isUrlPattern && regex.test(requestUrl));
  });
}
