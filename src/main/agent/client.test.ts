import { describe, expect, it } from 'vitest';
import type { HttpFlow } from '../../shared/types';
import { matchesSearchTraffic } from './client';

interface FlowOverrides extends Omit<Partial<HttpFlow>, 'request' | 'response'> {
  request?: Partial<HttpFlow['request']>;
  response?: Partial<NonNullable<HttpFlow['response']>>;
}

function createFlow(overrides?: FlowOverrides): HttpFlow {
  const { request: requestOverrides, response: responseOverrides, ...flowOverrides } = overrides || {};

  return {
    id: 'flow-1',
    request: {
      id: 'req-1',
      method: 'POST',
      url: 'https://api.example.com/graphql',
      protocol: 'https',
      host: 'api.example.com',
      path: '/graphql',
      headers: { 'content-type': 'application/json' },
      bodySize: 0,
      timestamp: Date.now(),
      graphqlOperationName: 'GetViewer',
      graphqlOperationType: 'query',
      ...(requestOverrides || {}),
    },
    response: {
      id: 'res-1',
      requestId: 'req-1',
      statusCode: 200,
      statusMessage: 'OK',
      headers: { 'content-type': 'application/json' },
      bodySize: 0,
      timestamp: Date.now(),
      duration: 120,
      ...(responseOverrides || {}),
    },
    state: 'complete',
    tags: ['graphql'],
    createdAt: Date.now(),
    ...flowOverrides,
  };
}

describe('matchesSearchTraffic', () => {
  it('matches GraphQL operation names case-insensitively', () => {
    expect(matchesSearchTraffic(createFlow(), { graphqlOperationName: 'viewer' })).toBe(true);
  });

  it('rejects flows with a different GraphQL operation name', () => {
    expect(matchesSearchTraffic(createFlow(), { graphqlOperationName: 'listusers' })).toBe(false);
  });

  it('combines GraphQL filtering with the existing URL and method filters', () => {
    expect(matchesSearchTraffic(createFlow(), {
      query: 'graphql',
      method: 'post',
      graphqlOperationName: 'getviewer',
    })).toBe(true);
  });
});
