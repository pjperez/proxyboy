import { describe, expect, it } from 'vitest';
import { gzipSync, deflateSync, brotliCompressSync } from 'zlib';
import type { HttpRequest, HttpResponse } from '../../shared/types';
import {
  applyBreakpointRequestEdits,
  applyBreakpointResponseEdits,
  applyPreparedRequestScriptResult,
  decompressBody,
  encodeBreakpointBody,
  hasBreakpointResponseChanges,
  prepareBreakpointRequestForForwarding,
  prepareBreakpointResponseForForwarding,
} from './engine';

function createRequest(overrides?: Partial<HttpRequest>): HttpRequest {
  return {
    id: 'req-1',
    method: 'GET',
    url: 'https://api.example.com/users',
    protocol: 'https',
    host: 'api.example.com',
    path: '/users',
    headers: {
      accept: 'application/json',
      host: 'api.example.com',
    },
    bodySize: 0,
    timestamp: 1,
    ...overrides,
  };
}

describe('applyPreparedRequestScriptResult', () => {
  it('preserves request header mutations from request scripts', () => {
    const current = createRequest();
    const scripted = createRequest({
      method: 'POST',
      url: 'https://api.example.com/users?active=true',
      path: '/users?active=true',
      headers: {
        accept: 'application/json',
        authorization: 'Bearer token-123',
        'x-scripted': 'yes',
        host: 'api.example.com',
      },
    });

    const result = applyPreparedRequestScriptResult(current, scripted);

    expect(result.method).toBe('POST');
    expect(result.path).toBe('/users?active=true');
    expect(result.headers.authorization).toBe('Bearer token-123');
    expect(result.headers['x-scripted']).toBe('yes');
    expect(result.headers.accept).toBe('application/json');
  });

  it('restores the host header from the normalized request when scripts omit it', () => {
    const current = createRequest();
    const scripted = createRequest({
      host: 'api.example.com:8443',
      url: 'https://api.example.com:8443/users',
      path: '/users',
      headers: {
        'x-scripted': 'yes',
      },
    });

    const result = applyPreparedRequestScriptResult(current, scripted);

    expect(result.host).toBe('api.example.com:8443');
    expect(result.headers.host).toBe('api.example.com:8443');
    expect(result.headers['x-scripted']).toBe('yes');
  });
});

function createBreakpointRequest(overrides: Partial<HttpRequest> = {}): HttpRequest {
  return {
    id: 'req-1',
    method: 'POST',
    url: 'https://api.example.com/graphql',
    protocol: 'https',
    host: 'api.example.com',
    path: '/graphql',
    headers: {
      host: 'api.example.com',
      'content-type': 'application/json',
      'transfer-encoding': 'chunked',
    },
    body: Buffer.from('{"query":"{ hello }"}', 'utf8'),
    bodySize: 21,
    timestamp: 0,
    ...overrides,
  };
}

function createResponse(overrides: Partial<HttpResponse> = {}): HttpResponse {
  return {
    id: 'res-1',
    requestId: 'req-1',
    statusCode: 200,
    statusMessage: 'OK',
    headers: {
      'content-type': 'application/json',
      'content-encoding': 'gzip',
      'content-length': '999',
    },
    body: Buffer.from('{"ok":true}', 'utf8'),
    bodySize: 11,
    timestamp: 0,
    duration: 10,
    ...overrides,
  };
}

describe('breakpoint request editing helpers', () => {
  it('applies host and body edits to the buffered request', () => {
    const request = createBreakpointRequest();

    const edited = applyBreakpointRequestEdits(request, {
      headers: {
        host: 'staging.example.com',
        'content-type': 'application/json',
        'x-breakpoint': 'edited',
      },
      body: encodeBreakpointBody('{"query":"{ goodbye }"}'),
    });

    expect(edited.host).toBe('staging.example.com');
    expect(edited.url).toBe('https://staging.example.com/graphql');
    expect(edited.headers['x-breakpoint']).toBe('edited');
    expect(Buffer.from(edited.body as Buffer).toString('utf8')).toContain('goodbye');
  });

  it('applies method and URL path/query edits to the buffered request', () => {
    const request = createBreakpointRequest();

    const edited = applyBreakpointRequestEdits(request, {
      method: 'put',
      url: 'https://api.example.com/v2/graphql?debug=1',
      headers: {
        host: 'api.example.com',
        'content-type': 'application/json',
      },
      body: encodeBreakpointBody('{"query":"{ hello }"}'),
    });

    expect(edited.method).toBe('PUT');
    expect(edited.host).toBe('api.example.com');
    expect(edited.path).toBe('/v2/graphql?debug=1');
    expect(edited.url).toBe('https://api.example.com/v2/graphql?debug=1');
    expect(edited.headers.host).toBe('api.example.com');
  });

  it('normalizes edited requests for forwarding', () => {
    const edited = prepareBreakpointRequestForForwarding(
      createBreakpointRequest({
        headers: {
          Host: 'api.example.com',
          'transfer-encoding': 'chunked',
          'content-type': 'application/json',
        },
        body: Buffer.from('patched body', 'utf8'),
      }),
    );

    expect(edited.headers.host).toBe('api.example.com');
    expect(edited.headers['content-length']).toBe(String(Buffer.byteLength('patched body')));
    expect(edited.headers['transfer-encoding']).toBeUndefined();
    expect(edited.bodySize).toBe(Buffer.byteLength('patched body'));
  });
});

describe('breakpoint response editing helpers', () => {
  it('detects when a paused response was modified', () => {
    const response = createResponse();
    const edited = applyBreakpointResponseEdits(response, {
      statusCode: 202,
      statusMessage: 'Accepted',
      headers: {
        'content-type': 'application/json',
        'x-breakpoint': 'edited',
      },
      body: encodeBreakpointBody('{"ok":false}'),
    });

    expect(hasBreakpointResponseChanges(response, edited)).toBe(true);
  });

  it('strips content-encoding and rewrites content-length for edited responses', () => {
    const edited = prepareBreakpointResponseForForwarding(
      createResponse({
        headers: {
          'content-type': 'application/json',
          'content-encoding': 'gzip',
          'transfer-encoding': 'chunked',
        },
        body: Buffer.from('{"ok":false}', 'utf8'),
      }),
      true,
    );

    expect(edited.headers['content-encoding']).toBeUndefined();
    expect(edited.headers['transfer-encoding']).toBeUndefined();
    expect(edited.headers['content-length']).toBe(String(Buffer.byteLength('{"ok":false}')));
    expect(edited.bodySize).toBe(Buffer.byteLength('{"ok":false}'));
  });
});

describe('decompressBody (async, off-event-loop)', () => {
  const payload = Buffer.from('Hello ProxyBoy! '.repeat(100), 'utf8');

  it('decompresses gzip using explicit content-encoding', async () => {
    const compressed = gzipSync(payload);
    const result = await decompressBody(compressed, 'gzip');
    expect(result.equals(payload)).toBe(true);
  });

  it('decompresses brotli using explicit content-encoding', async () => {
    const compressed = brotliCompressSync(payload);
    const result = await decompressBody(compressed, 'br');
    expect(result.equals(payload)).toBe(true);
  });

  it('decompresses deflate using explicit content-encoding', async () => {
    const compressed = deflateSync(payload);
    const result = await decompressBody(compressed, 'deflate');
    expect(result.equals(payload)).toBe(true);
  });

  it('auto-detects gzip by magic bytes when encoding is missing', async () => {
    const compressed = gzipSync(payload);
    const result = await decompressBody(compressed);
    expect(result.equals(payload)).toBe(true);
  });

  it('auto-detects deflate by magic bytes when encoding header is stripped', async () => {
    const compressed = deflateSync(payload);
    const result = await decompressBody(compressed);
    expect(result.equals(payload)).toBe(true);
  });

  it('returns plain bodies unchanged', async () => {
    const result = await decompressBody(payload);
    expect(result.equals(payload)).toBe(true);
  });

  it('handles array-form content-encoding header', async () => {
    const compressed = gzipSync(payload);
    const result = await decompressBody(compressed, ['gzip']);
    expect(result.equals(payload)).toBe(true);
  });

  it('returns original body when declared encoding fails and bytes are not recognized', async () => {
    const result = await decompressBody(payload, 'gzip');
    // payload is not actually gzip; magic bytes do not match either → passthrough
    expect(result.equals(payload)).toBe(true);
  });

  it('returns original body for empty input', async () => {
    const result = await decompressBody(Buffer.alloc(0), 'gzip');
    expect(result.length).toBe(0);
  });
});
