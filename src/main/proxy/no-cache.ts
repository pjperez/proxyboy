import type { HttpHeaders } from '../../shared/types';

const REQUEST_CACHE_HEADERS = [
  'if-modified-since',
  'if-none-match',
  'if-match',
  'if-unmodified-since',
  'if-range',
  'cache-control',
  'pragma',
];

const RESPONSE_CACHE_HEADERS = [
  'etag',
  'last-modified',
  'expires',
  'cache-control',
  'pragma',
];

function deleteHeadersCaseInsensitive(headers: HttpHeaders, names: string[]): void {
  const normalizedNames = new Set(names.map((name) => name.toLowerCase()));
  for (const key of Object.keys(headers)) {
    if (normalizedNames.has(key.toLowerCase())) {
      delete headers[key];
    }
  }
}

function setHeader(headers: HttpHeaders, name: string, value: string): void {
  deleteHeadersCaseInsensitive(headers, [name]);
  headers[name] = value;
}

export function applyNoCacheToRequestHeaders(headers: HttpHeaders): HttpHeaders {
  deleteHeadersCaseInsensitive(headers, REQUEST_CACHE_HEADERS);
  return headers;
}

export function applyNoCacheToResponseHeaders(headers: HttpHeaders): HttpHeaders {
  deleteHeadersCaseInsensitive(headers, RESPONSE_CACHE_HEADERS);
  setHeader(headers, 'cache-control', 'no-store');
  setHeader(headers, 'pragma', 'no-cache');
  return headers;
}
