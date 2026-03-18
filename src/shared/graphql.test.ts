import { describe, expect, it } from 'vitest';
import type { HttpRequest } from './types';
import { annotateGraphQLRequest, parseGraphQLRequest } from './graphql';

describe('parseGraphQLRequest', () => {
  it('parses JSON GraphQL payloads with explicit operation names', () => {
    expect(parseGraphQLRequest(
      JSON.stringify({
        operationName: 'GetViewer',
        query: 'query GetViewer { viewer { id login } }',
        variables: { includeEmail: true },
      }),
      'application/json',
    )).toEqual({
      operationName: 'GetViewer',
      operationType: 'query',
      query: 'query GetViewer { viewer { id login } }',
      variables: { includeEmail: true },
    });
  });

  it('parses application/graphql bodies and supports anonymous operations', () => {
    expect(parseGraphQLRequest(
      'mutation { updateUser(id: 1) { id } }',
      'application/graphql',
    )).toEqual({
      operationName: undefined,
      operationType: 'mutation',
      query: 'mutation { updateUser(id: 1) { id } }',
    });
  });
});

describe('annotateGraphQLRequest', () => {
  it('annotates POST requests and tags them as graphql', () => {
    const request: Pick<HttpRequest, 'method' | 'headers' | 'body'> & Partial<HttpRequest> = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: 'subscription OnMessage { messageAdded { id } }',
      }),
    };
    const tags: string[] = [];

    annotateGraphQLRequest(request, tags);

    expect(request.graphqlOperationType).toBe('subscription');
    expect(request.graphqlOperationName).toBe('OnMessage');
    expect(tags).toContain('graphql');
  });
});
