import { describe, expect, it } from 'vitest';
import { isUrlEncodedForm, parseQueryParams, parseUrlEncodedForm } from './request-parts';

describe('request-parts', () => {
  it('parses query params from a full URL', () => {
    expect(parseQueryParams('https://example.com/search?q=proxy+boy&page=2')).toEqual([
      { key: 'q', value: 'proxy boy' },
      { key: 'page', value: '2' },
    ]);
  });

  it('parses urlencoded form bodies', () => {
    expect(parseUrlEncodedForm('name=ProxyBoy&token=a%2Bb')).toEqual([
      { key: 'name', value: 'ProxyBoy' },
      { key: 'token', value: 'a+b' },
    ]);
  });

  it('detects urlencoded content types', () => {
    expect(isUrlEncodedForm('application/x-www-form-urlencoded; charset=UTF-8')).toBe(true);
    expect(isUrlEncodedForm('application/json')).toBe(false);
  });
});
