import { describe, expect, it } from 'vitest';
import { flowsToHar } from './har';
import type { HttpFlow } from '../../shared/types';

function makeFlow(overrides: Partial<HttpFlow> = {}): HttpFlow {
  return {
    id: 'flow-1',
    request: {
      id: 'req-1',
      method: 'GET',
      url: 'https://api.example.com/users?page=2&limit=50',
      protocol: 'https',
      host: 'api.example.com',
      path: '/users',
      headers: { host: 'api.example.com', accept: 'application/json' },
      bodySize: 0,
      timestamp: 1700000000000,
    },
    response: {
      id: 'res-1',
      requestId: 'req-1',
      statusCode: 200,
      statusMessage: 'OK',
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{"users":[]}', 'utf8'),
      bodySize: 12,
      timestamp: 1700000000500,
      duration: 500,
    },
    ...overrides,
  } as HttpFlow;
}

describe('flowsToHar', () => {
  it('produces valid HAR 1.2 envelope with ProxyBoy creator', () => {
    const har = JSON.parse(flowsToHar([makeFlow()]));
    expect(har.log.version).toBe('1.2');
    expect(har.log.creator.name).toBe('ProxyBoy');
    expect(Array.isArray(har.log.entries)).toBe(true);
    expect(har.log.entries).toHaveLength(1);
  });

  it('serializes request method, url, and headers', () => {
    const har = JSON.parse(flowsToHar([makeFlow()]));
    const entry = har.log.entries[0];
    expect(entry.request.method).toBe('GET');
    expect(entry.request.url).toBe('https://api.example.com/users?page=2&limit=50');
    expect(entry.request.httpVersion).toBe('HTTP/1.1');
    expect(entry.request.headers).toContainEqual({ name: 'host', value: 'api.example.com' });
  });

  it('extracts query string parameters from the URL', () => {
    const har = JSON.parse(flowsToHar([makeFlow()]));
    const qs = har.log.entries[0].request.queryString;
    expect(qs).toContainEqual({ name: 'page', value: '2' });
    expect(qs).toContainEqual({ name: 'limit', value: '50' });
  });

  it('serializes response status, headers, and body content', () => {
    const har = JSON.parse(flowsToHar([makeFlow()]));
    const entry = har.log.entries[0];
    expect(entry.response.status).toBe(200);
    expect(entry.response.statusText).toBe('OK');
    expect(entry.response.content.mimeType).toBe('application/json');
    expect(entry.response.content.text).toBe('{"users":[]}');
    expect(entry.response.content.size).toBe(12);
    expect(entry.response.bodySize).toBe(12);
  });

  it('maps response duration to wait timing', () => {
    const har = JSON.parse(flowsToHar([makeFlow()]));
    const entry = har.log.entries[0];
    expect(entry.time).toBe(500);
    expect(entry.timings.wait).toBe(500);
  });

  it('includes postData when the request has a body', () => {
    const flow = makeFlow({
      request: {
        id: 'req-1',
        method: 'POST',
        url: 'https://api.example.com/users',
        protocol: 'https',
        host: 'api.example.com',
        path: '/users',
        headers: { 'content-type': 'application/json', host: 'api.example.com' },
        body: Buffer.from('{"name":"ada"}', 'utf8'),
        bodySize: 14,
        timestamp: 1700000000000,
      },
    });
    const har = JSON.parse(flowsToHar([flow]));
    const postData = har.log.entries[0].request.postData;
    expect(postData).toBeDefined();
    expect(postData.mimeType).toBe('application/json');
    expect(postData.text).toBe('{"name":"ada"}');
  });

  it('skips postData when the request has no body', () => {
    const har = JSON.parse(flowsToHar([makeFlow()]));
    expect(har.log.entries[0].request.postData).toBeUndefined();
  });

  it('filters out flows that have no response', () => {
    const flowWithoutResponse = makeFlow();
    delete (flowWithoutResponse as Partial<HttpFlow>).response;
    const har = JSON.parse(flowsToHar([flowWithoutResponse, makeFlow()]));
    expect(har.log.entries).toHaveLength(1);
  });

  it('uses startedDateTime in ISO format from the request timestamp', () => {
    const har = JSON.parse(flowsToHar([makeFlow()]));
    const entry = har.log.entries[0];
    expect(entry.startedDateTime).toBe(new Date(1700000000000).toISOString());
  });

  it('defaults content-type to application/octet-stream when missing', () => {
    const flow = makeFlow({
      response: {
        id: 'res-1',
        requestId: 'req-1',
        statusCode: 200,
        statusMessage: 'OK',
        headers: {},
        body: Buffer.from('binary'),
        bodySize: 6,
        timestamp: 1700000000500,
        duration: 500,
      },
    });
    const har = JSON.parse(flowsToHar([flow]));
    expect(har.log.entries[0].response.content.mimeType).toBe('application/octet-stream');
  });

  it('handles an empty flow list', () => {
    const har = JSON.parse(flowsToHar([]));
    expect(har.log.entries).toEqual([]);
  });

  it('serializes multiple flows preserving order', () => {
    const flowA = makeFlow({ id: 'a' });
    const flowB = makeFlow({ id: 'b' });
    const har = JSON.parse(flowsToHar([flowA, flowB]));
    expect(har.log.entries).toHaveLength(2);
  });
});
