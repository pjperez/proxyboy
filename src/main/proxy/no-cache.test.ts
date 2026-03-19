import { describe, expect, it } from 'vitest';
import { applyNoCacheToRequestHeaders, applyNoCacheToResponseHeaders } from './no-cache';

describe('applyNoCacheToRequestHeaders', () => {
  it('removes conditional and cache request headers case-insensitively', () => {
    const headers = {
      Host: 'example.com',
      'If-Modified-Since': 'Wed, 21 Oct 2015 07:28:00 GMT',
      'if-none-match': '"abc123"',
      'Cache-Control': 'max-age=0',
      pragma: 'no-cache',
      accept: 'application/json',
    };

    expect(applyNoCacheToRequestHeaders(headers)).toEqual({
      Host: 'example.com',
      accept: 'application/json',
    });
  });
});

describe('applyNoCacheToResponseHeaders', () => {
  it('replaces cacheable response metadata with no-store headers', () => {
    const headers = {
      ETag: '"abc123"',
      'Last-Modified': 'Wed, 21 Oct 2015 07:28:00 GMT',
      Expires: 'Wed, 21 Oct 2030 07:28:00 GMT',
      'Cache-Control': 'public, max-age=86400',
      'content-type': 'application/json',
    };

    expect(applyNoCacheToResponseHeaders(headers)).toEqual({
      'content-type': 'application/json',
      'cache-control': 'no-store',
      pragma: 'no-cache',
    });
  });
});
