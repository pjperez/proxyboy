import { describe, expect, it } from 'vitest';
import type { HttpRequest } from '../../shared/types';
import { applyPreparedRequestScriptResult } from './engine';

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
