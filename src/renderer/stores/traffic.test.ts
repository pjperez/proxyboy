import { beforeEach, describe, expect, it } from 'vitest';
import { matchesFlowFilter, useTrafficStore } from './traffic';
import type { HttpFlow } from '../../shared/types';

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
      method: 'GET',
      url: 'https://api.example.com/users',
      protocol: 'https',
      host: 'api.example.com',
      path: '/users',
      headers: {},
      body: undefined,
      bodySize: 0,
      timestamp: Date.now(),
      ...(requestOverrides || {}),
    },
    response: {
      id: 'res-1',
      requestId: 'req-1',
      statusCode: 200,
      statusMessage: 'OK',
      headers: { 'content-type': 'application/json' },
      body: '{"message":"hello world"}',
      bodySize: 25,
      timestamp: Date.now(),
      duration: 120,
      ...(responseOverrides || {}),
    },
    state: 'complete',
    tags: [],
    createdAt: Date.now(),
    ...flowOverrides,
  };
}

describe('matchesFlowFilter', () => {
  it('keeps default text search scoped to url and host', () => {
    const flow = createFlow({
      request: { body: '{"token":"secret-value"}', bodySize: 24 },
    });

    expect(matchesFlowFilter(flow, { text: 'secret-value' })).toBe(false);
  });

  it('can search request and response bodies when enabled', () => {
    const flow = createFlow({
      request: { body: '{"token":"secret-value"}', bodySize: 24 },
    });

    expect(matchesFlowFilter(flow, { text: 'secret-value', searchBodies: true })).toBe(true);
    expect(matchesFlowFilter(flow, { text: 'hello world', searchBodies: true })).toBe(true);
  });

  it('skips base64-encoded bodies during body search', () => {
    const flow = createFlow({
      response: {
        body: 'YmluYXJ5LWRhdGE=',
        bodySize: 16,
      } as HttpFlow['response'],
    });
    (flow.response as any)._isBase64 = true;

    expect(matchesFlowFilter(flow, { text: 'binary-data', searchBodies: true })).toBe(false);
  });
});

describe('useTrafficStore GraphQL filtering', () => {
  beforeEach(() => {
    useTrafficStore.setState({ flows: [], filter: {}, markedFlowId: null, compareTargetFlowId: null });
  });

  it('filters flows by GraphQL operation name', () => {
    useTrafficStore.getState().setFlows([
      createFlow({
        id: 'viewer',
        request: {
          id: 'viewer-req',
          method: 'POST',
          url: 'https://example.com/viewer',
          host: 'example.com',
          path: '/viewer',
          headers: { 'content-type': 'application/json' },
          graphqlOperationName: 'GetViewer',
          graphqlOperationType: 'query',
        },
        response: {
          id: 'viewer-res',
          requestId: 'viewer-req',
          statusCode: 200,
          statusMessage: 'OK',
          headers: { 'content-type': 'application/json' },
          bodySize: 0,
          duration: 20,
        },
        tags: ['graphql'],
      }),
      createFlow({
        id: 'health',
        request: {
          id: 'health-req',
          method: 'GET',
          url: 'https://example.com/health',
          host: 'example.com',
          path: '/health',
        },
      }),
    ]);

    useTrafficStore.getState().setFilter({ graphqlOperationName: 'viewer' });

    expect(useTrafficStore.getState().getFilteredFlows().map((flow) => flow.id)).toEqual(['viewer']);
  });
});

describe('useTrafficStore comparison state', () => {
  beforeEach(() => {
    useTrafficStore.setState({ flows: [], filter: {}, markedFlowId: null, compareTargetFlowId: null });
  });

  it('tracks marked and comparison flow ids', () => {
    useTrafficStore.getState().setMarkedFlowId('a');
    useTrafficStore.getState().setCompareTargetFlowId('b');

    expect(useTrafficStore.getState().markedFlowId).toBe('a');
    expect(useTrafficStore.getState().compareTargetFlowId).toBe('b');
  });

  it('clears comparison ids when flows are removed', () => {
    useTrafficStore.getState().setFlows([
      createFlow({ id: 'a', request: { id: 'a-req' }, response: { id: 'a-res', requestId: 'a-req' } }),
      createFlow({ id: 'b', request: { id: 'b-req' }, response: { id: 'b-res', requestId: 'b-req' } }),
    ]);
    useTrafficStore.getState().setMarkedFlowId('a');
    useTrafficStore.getState().setCompareTargetFlowId('b');

    useTrafficStore.getState().removeFlow('a');

    expect(useTrafficStore.getState().markedFlowId).toBeNull();
    expect(useTrafficStore.getState().compareTargetFlowId).toBeNull();
  });
});
