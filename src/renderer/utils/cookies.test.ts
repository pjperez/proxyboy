import { describe, expect, it } from 'vitest';
import { parseRequestCookies, parseResponseCookies } from './cookies';

describe('parseRequestCookies', () => {
  it('parses standard cookie headers into name/value pairs', () => {
    expect(parseRequestCookies({
      cookie: 'session=abc123; theme=dark; token=hello=world',
    })).toEqual([
      { name: 'session', value: 'abc123', raw: 'session=abc123' },
      { name: 'theme', value: 'dark', raw: 'theme=dark' },
      { name: 'token', value: 'hello=world', raw: 'token=hello=world' },
    ]);
  });
});

describe('parseResponseCookies', () => {
  it('parses structured Set-Cookie attributes', () => {
    expect(parseResponseCookies({
      'set-cookie': [
        'session=abc123; Path=/; HttpOnly; Secure; SameSite=Lax',
        'theme=dark; Domain=example.com; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Max-Age=3600',
      ],
    })).toEqual([
      {
        name: 'session',
        value: 'abc123',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
        raw: 'session=abc123; Path=/; HttpOnly; Secure; SameSite=Lax',
      },
      {
        name: 'theme',
        value: 'dark',
        domain: 'example.com',
        expires: 'Wed, 21 Oct 2026 07:28:00 GMT',
        maxAge: '3600',
        secure: false,
        httpOnly: false,
        raw: 'theme=dark; Domain=example.com; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Max-Age=3600',
      },
    ]);
  });
});
