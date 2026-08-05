import { describe, expect, it } from 'vitest';
import type { HttpFlow } from '../../shared/types';
import { flowToFetch, flowToPowerShell } from './export-formats';

function createFlow(): HttpFlow {
  return {
    id: 'flow-1',
    state: 'complete',
    tags: [],
    createdAt: 1,
    request: {
      id: 'req-1',
      method: 'POST',
      url: 'https://api.example.com/v1/items?active=true',
      protocol: 'https',
      host: 'api.example.com',
      path: '/v1/items?active=true',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer token',
        host: 'api.example.com',
      },
      body: '{"name":"ProxyBoy"}',
      bodySize: 20,
      timestamp: 1,
    },
  };
}

describe('export formats', () => {
  it('builds a fetch snippet', () => {
    const snippet = flowToFetch(createFlow());
    expect(snippet).toContain('fetch("https://api.example.com/v1/items?active=true"');
    expect(snippet).toContain('method: "POST"');
    expect(snippet).toContain('"authorization": "Bearer token"');
    expect(snippet).toContain('body: "{\\"name\\":\\"ProxyBoy\\"}"');
    expect(snippet).not.toContain('"host"');
  });

  it('builds a PowerShell snippet', () => {
    const snippet = flowToPowerShell(createFlow());
    expect(snippet).toContain("$uri = 'https://api.example.com/v1/items?active=true'");
    expect(snippet).toContain("$method = 'POST'");
    expect(snippet).toContain("Invoke-RestMethod -Uri $uri -Method $method -Headers $headers -Body $body");
    expect(snippet).toContain("'authorization' = 'Bearer token'");
  });
});
