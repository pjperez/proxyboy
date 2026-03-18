import { beforeEach, describe, expect, it } from 'vitest';
import { useTrafficStore } from './traffic';
import type { HttpFlow } from '../../shared/types';

function createFlow(id: string, graphqlOperationName?: string): HttpFlow {
  return {
    id,
    request: {
      id: `${id}-req`,
      method: 'POST',
      url: `https://example.com/${id}`,
      protocol: 'https',
      host: 'example.com',
      path: `/${id}`,
      headers: { 'content-type': 'application/json' },
      bodySize: 0,
      timestamp: Date.now(),
      graphqlOperationName,
      graphqlOperationType: graphqlOperationName ? 'query' : undefined,
    },
    response: {
      id: `${id}-res`,
      requestId: `${id}-req`,
      statusCode: 200,
      statusMessage: 'OK',
      headers: { 'content-type': 'application/json' },
      bodySize: 0,
      timestamp: Date.now(),
      duration: 20,
    },
    state: 'complete',
    tags: graphqlOperationName ? ['graphql'] : [],
    createdAt: Date.now(),
  };
}

describe('useTrafficStore GraphQL filtering', () => {
  beforeEach(() => {
    useTrafficStore.setState({ flows: [], filter: {} });
  });

  it('filters flows by GraphQL operation name', () => {
    useTrafficStore.getState().setFlows([
      createFlow('viewer', 'GetViewer'),
      createFlow('health'),
    ]);

    useTrafficStore.getState().setFilter({ graphqlOperationName: 'viewer' });

    expect(useTrafficStore.getState().getFilteredFlows().map((flow) => flow.id)).toEqual(['viewer']);
  });
});
