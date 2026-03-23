import { afterEach, describe, expect, it } from 'vitest';
import type { HttpRequest, HttpResponse, ScriptRule } from '../../shared/types';
import { clearCompiledScriptCache, executeScriptRule, getCompiledScriptCacheSize } from './runner';

function createScriptRule(overrides?: Partial<ScriptRule>): ScriptRule {
  return {
    id: 'script-1',
    type: 'script',
    name: 'Test script',
    enabled: true,
    matchCriteria: { urlPattern: '*' },
    phase: 'request',
    code: '',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createRequest(overrides?: Partial<HttpRequest>): HttpRequest {
  return {
    id: 'req-1',
    method: 'POST',
    url: 'https://api.example.com/users',
    protocol: 'https',
    host: 'api.example.com',
    path: '/users',
    headers: { 'content-type': 'application/json' },
    body: Buffer.from('{"name":"Ada"}'),
    bodySize: 14,
    timestamp: 1,
    ...overrides,
  };
}

function createResponse(overrides?: Partial<HttpResponse>): HttpResponse {
  return {
    id: 'res-1',
    requestId: 'req-1',
    statusCode: 200,
    statusMessage: 'OK',
    headers: { 'content-type': 'application/json' },
    body: Buffer.from('{"ok":true}'),
    bodySize: 11,
    timestamp: 2,
    duration: 25,
    ...overrides,
  };
}

afterEach(() => {
  clearCompiledScriptCache();
});

describe('executeScriptRule', () => {
  it('can modify request headers and body', () => {
    const result = executeScriptRule(
      createScriptRule({
        code: `
          const payload = parseJson(request.body);
          payload.role = 'admin';
          setJsonBody(request, payload);
          request.headers['x-scripted'] = 'yes';
        `,
      }),
      createRequest(),
    );

    expect(result.requestModified).toBe(true);
    expect(result.request.headers['x-scripted']).toBe('yes');
    expect(String(result.request.body)).toContain('"role": "admin"');
  });

  it('can modify response metadata and body', () => {
    const result = executeScriptRule(
      createScriptRule({
        phase: 'response',
        code: `
          response.statusCode = 201;
          response.statusMessage = 'Created';
          response.headers['x-scripted'] = 'true';
          const payload = parseJson(response.body);
          payload.ok = false;
          setJsonBody(response, payload);
        `,
      }),
      createRequest(),
      createResponse(),
    );

    expect(result.responseModified).toBe(true);
    expect(result.response?.statusCode).toBe(201);
    expect(result.response?.headers['x-scripted']).toBe('true');
    expect(String(result.response?.body)).toContain('"ok": false');
  });

  it('can block a live request script', () => {
    const result = executeScriptRule(
      createScriptRule({
        code: `block('nope');`,
      }),
      createRequest(),
      undefined,
      true,
    );

    expect(result.blocked).toBe(true);
    expect(result.notes).toContain('nope');
  });

  it('rejects long-running scripts with the vm timeout', () => {
    expect(() => executeScriptRule(
      createScriptRule({
        code: 'while (true) {}',
      }),
      createRequest(),
    )).toThrow(/timed out/i);
  });

  it('disables string-based code generation inside the script context', () => {
    expect(() => executeScriptRule(
      createScriptRule({
        code: "({}).constructor.constructor('return process')()",
      }),
      createRequest(),
    )).toThrow(/Code generation from strings disallowed/i);
  });

  it('reuses compiled vm scripts for repeated executions of the same rule', () => {
    const rule = createScriptRule({
      code: `request.headers['x-cache-hit'] = 'yes';`,
    });

    executeScriptRule(rule, createRequest());
    executeScriptRule(rule, createRequest());

    expect(getCompiledScriptCacheSize()).toBe(1);
  });

  it('recompiles scripts when the rule changes', () => {
    const originalRule = createScriptRule({
      id: 'cache-rule',
      updatedAt: 1,
      code: `request.headers['x-cache-version'] = '1';`,
    });
    const updatedRule = createScriptRule({
      id: 'cache-rule',
      updatedAt: 2,
      code: `request.headers['x-cache-version'] = '2';`,
    });

    executeScriptRule(originalRule, createRequest());
    executeScriptRule(updatedRule, createRequest());

    expect(getCompiledScriptCacheSize()).toBe(2);
  });
});
