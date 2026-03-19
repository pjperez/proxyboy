import { describe, expect, it } from 'vitest';
import { buildComposerHeaders, buildRawHttpRequest, buildReplayHeaders } from './replay';

describe('replay helpers', () => {
  it('drops hop-by-hop headers and injects replay metadata', () => {
    const headers = buildReplayHeaders(
      {
        host: 'example.com',
        connection: 'keep-alive',
        'proxy-connection': 'keep-alive',
        accept: 'application/json',
      },
      new URL('https://api.example.com/users?page=2'),
      true,
      12,
    );

    expect(headers).toEqual({
      accept: 'application/json',
      Host: 'api.example.com',
      Connection: 'close',
      'x-proxyboy-replay': '1',
      'Content-Length': '12',
    });
  });

  it('builds a raw HTTP request payload with the target path and body', () => {
    const payload = buildRawHttpRequest(
      'POST',
      new URL('https://api.example.com/users?page=2'),
      {
        Host: 'api.example.com',
        Connection: 'close',
      },
      Buffer.from('hello'),
    ).toString('utf8');

    expect(payload).toContain('POST /users?page=2 HTTP/1.1\r\n');
    expect(payload).toContain('Host: api.example.com\r\n');
    expect(payload).toContain('\r\n\r\nhello');
  });

  it('marks composed requests with a private composer header', () => {
    const headers = buildComposerHeaders(
      {
        host: 'example.com',
        accept: 'application/json',
      },
      new URL('https://api.example.com/users'),
      false,
      0,
      'composer-123',
    );

    expect(headers).toEqual({
      accept: 'application/json',
      Host: 'api.example.com',
      Connection: 'close',
      'x-proxyboy-composer-id': 'composer-123',
    });
  });
});
