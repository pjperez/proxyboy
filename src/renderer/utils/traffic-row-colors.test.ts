import { describe, expect, it } from 'vitest';
import type { HttpFlow } from '../../shared/types';
import { getTrafficRowAccentColor, type TrafficRowColorMode } from './traffic-row-colors';

interface FlowOverrides extends Omit<Partial<HttpFlow>, 'request' | 'response'> {
  request?: Partial<HttpFlow['request']>;
  response?: Partial<NonNullable<HttpFlow['response']>>;
}

function createFlow(overrides?: FlowOverrides): HttpFlow {
  const hasResponseOverride = Boolean(overrides && Object.prototype.hasOwnProperty.call(overrides, 'response'));
  const { request: requestOverrides, response: responseOverrides, ...flowOverrides } = overrides || {};

  return {
    id: 'flow-1',
    request: {
      id: 'req-1',
      method: 'GET',
      url: 'https://example.com/data',
      protocol: 'https',
      host: 'example.com',
      path: '/data',
      headers: {},
      bodySize: 0,
      timestamp: Date.now(),
      ...(requestOverrides || {}),
    },
    response: hasResponseOverride
      ? responseOverrides as HttpFlow['response']
      : {
          id: 'res-1',
          requestId: 'req-1',
          statusCode: 200,
          statusMessage: 'OK',
          headers: { 'content-type': 'application/json' },
          bodySize: 0,
          timestamp: Date.now(),
          duration: 100,
          ...(responseOverrides || {}),
        },
    state: 'complete',
    tags: [],
    createdAt: Date.now(),
    ...flowOverrides,
  };
}

describe('getTrafficRowAccentColor', () => {
  it('returns transparent when row colors are off', () => {
    expect(getTrafficRowAccentColor(createFlow(), 'off')).toBe('transparent');
  });

  it('maps status mode to success, info, warning, and error accents', () => {
    expect(getTrafficRowAccentColor(createFlow(), 'status')).toBe('var(--color-pb-success)');
    expect(getTrafficRowAccentColor(createFlow({ response: { statusCode: 302 } }), 'status')).toBe('var(--color-pb-info)');
    expect(getTrafficRowAccentColor(createFlow({ response: { statusCode: 404 } }), 'status')).toBe('var(--color-pb-warning)');
    expect(getTrafficRowAccentColor(createFlow({ response: { statusCode: 503 } }), 'status')).toBe('var(--color-pb-error)');
  });

  it('uses a muted accent for pending flows in either mode', () => {
    expect(getTrafficRowAccentColor(createFlow({ response: undefined, state: 'pending' }), 'status')).toBe('var(--color-pb-text-dim)');
    expect(getTrafficRowAccentColor(createFlow({ response: undefined, state: 'pending' }), 'content-type')).toBe('var(--color-pb-text-dim)');
  });

  it('maps content-type mode to accessible category colors', () => {
    const cases: Array<[string, TrafficRowColorMode, string]> = [
      ['application/json', 'content-type', 'var(--color-pb-info)'],
      ['text/html', 'content-type', 'var(--color-pb-accent)'],
      ['image/png', 'content-type', 'var(--color-pb-success)'],
      ['text/plain', 'content-type', 'var(--color-pb-warning)'],
    ];

    for (const [contentType, mode, expected] of cases) {
      expect(
        getTrafficRowAccentColor(createFlow({ response: { headers: { 'content-type': contentType } } }), mode),
      ).toBe(expected);
    }
  });
});

