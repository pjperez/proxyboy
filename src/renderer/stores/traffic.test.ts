import { beforeEach, describe, expect, it } from 'vitest';
import { matchesFlowFilter, useTrafficStore } from './traffic';
import type { HttpFlow } from '../../shared/types';
import { MAX_STREAM_ITEMS } from '../../shared/constants';

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

  it('searches websocket and SSE payload text when body search is enabled', () => {
    const flow = createFlow({
      streamKind: 'websocket',
      websocketFrames: [
        {
          id: 'frame-1',
          timestamp: Date.now(),
          direction: 'client-to-server',
          frameType: 'message',
          body: 'hello socket',
          byteLength: 12,
        },
      ],
      sseEvents: [
        {
          id: 'event-1',
          timestamp: Date.now(),
          event: 'update',
          data: 'live payload',
          byteLength: 12,
        },
      ],
    });

    expect(matchesFlowFilter(flow, { text: 'socket', searchBodies: true })).toBe(true);
    expect(matchesFlowFilter(flow, { text: 'live payload', searchBodies: true })).toBe(true);
  });

  it('keeps websocket flows visible when status filters are active', () => {
    const flow = createFlow({
      streamKind: 'websocket',
      response: {
        statusCode: 101,
        statusMessage: 'Switching Protocols',
      },
    });

    expect(matchesFlowFilter(flow, { statusCodes: [{ label: '2xx', min: 200, max: 299 }] })).toBe(true);
  });

  it('keeps live SSE flows visible when status filters are active', () => {
    const flow = createFlow({
      streamKind: 'sse',
      response: undefined,
      state: 'pending',
    });

    expect(matchesFlowFilter(flow, { statusCodes: [{ label: '2xx', min: 200, max: 299 }] })).toBe(true);
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

describe('useTrafficStore flow updates', () => {
  beforeEach(() => {
    useTrafficStore.setState({ flows: [], filter: {}, markedFlowId: null, compareTargetFlowId: null });
  });

  it('appends stream patches without replacing the whole flow', () => {
    useTrafficStore.getState().setFlows([
      createFlow({
        id: 'stream-1',
        streamKind: 'websocket',
        streamOpen: true,
        websocketFrames: [
          {
            id: 'frame-1',
            timestamp: 1,
            direction: 'client-to-server',
            frameType: 'message',
            body: 'first',
            byteLength: 5,
          },
        ],
      }),
    ]);

    useTrafficStore.getState().updateFlow({
      id: 'stream-1',
      streamOpen: true,
      appendWebSocketFrames: [
        {
          id: 'frame-2',
          timestamp: 2,
          direction: 'server-to-client',
          frameType: 'message',
          body: 'second',
          byteLength: 6,
        },
      ],
    });

    expect(useTrafficStore.getState().flows[0].websocketFrames?.map((frame) => frame.id)).toEqual(['frame-1', 'frame-2']);
  });

  it('caps appended stream items in renderer patches', () => {
    const frames = Array.from({ length: MAX_STREAM_ITEMS }, (_, index) => ({
      id: `frame-${index}`,
      timestamp: index,
      direction: 'client-to-server' as const,
      frameType: 'message' as const,
      body: `frame-${index}`,
      byteLength: index + 1,
    }));

    useTrafficStore.getState().setFlows([
      createFlow({
        id: 'stream-cap',
        streamKind: 'websocket',
        streamOpen: true,
        websocketFrames: frames,
      }),
    ]);

    useTrafficStore.getState().updateFlow({
      id: 'stream-cap',
      appendWebSocketFrames: [
        {
          id: 'frame-overflow',
          timestamp: MAX_STREAM_ITEMS + 1,
          direction: 'server-to-client',
          frameType: 'message',
          body: 'overflow',
          byteLength: 8,
        },
      ],
    });

    const nextFrames = useTrafficStore.getState().flows[0].websocketFrames ?? [];
    expect(nextFrames).toHaveLength(MAX_STREAM_ITEMS);
    expect(nextFrames[0].id).toBe('frame-1');
    expect(nextFrames.at(-1)?.id).toBe('frame-overflow');
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
