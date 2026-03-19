import type { GraphQLOperationType, HttpRequest } from './types';

export interface ParsedGraphQLRequest {
  query: string;
  operationType?: GraphQLOperationType;
  operationName?: string;
  variables?: unknown;
}

function normalizeContentType(contentType?: string | string[]): string {
  if (Array.isArray(contentType)) {
    return String(contentType[0] || '').toLowerCase();
  }
  return String(contentType || '').toLowerCase();
}

function readBodyText(body?: Buffer | string): string | null {
  if (!body) return null;
  if (typeof body === 'string') return body;
  return body.toString('utf8');
}

function extractOperation(query: string, explicitName?: string): {
  operationType?: GraphQLOperationType;
  operationName?: string;
} {
  const match = query.match(/\b(query|mutation|subscription)\b(?:\s+([_A-Za-z][_0-9A-Za-z]*))?/);
  return {
    operationType: match?.[1] as GraphQLOperationType | undefined,
    operationName: explicitName || match?.[2],
  };
}

export function parseGraphQLRequest(
  body: Buffer | string | undefined,
  contentType?: string | string[],
): ParsedGraphQLRequest | null {
  const normalizedContentType = normalizeContentType(contentType);
  const bodyText = readBodyText(body)?.trim();
  if (!bodyText) {
    return null;
  }

  if (normalizedContentType.includes('application/graphql')) {
    const operation = extractOperation(bodyText);
    return {
      query: bodyText,
      operationType: operation.operationType,
      operationName: operation.operationName,
    };
  }

  if (!normalizedContentType.includes('json')) {
    return null;
  }

  try {
    const parsed = JSON.parse(bodyText) as {
      query?: unknown;
      operationName?: unknown;
      variables?: unknown;
    };

    if (typeof parsed.query !== 'string' || parsed.query.trim().length === 0) {
      return null;
    }

    const explicitName =
      typeof parsed.operationName === 'string' && parsed.operationName.trim().length > 0
        ? parsed.operationName.trim()
        : undefined;
    const operation = extractOperation(parsed.query, explicitName);

    return {
      query: parsed.query.trim(),
      operationType: operation.operationType,
      operationName: operation.operationName,
      variables: parsed.variables,
    };
  } catch {
    return null;
  }
}

export function annotateGraphQLRequest(
  request: Pick<HttpRequest, 'method' | 'headers' | 'body'> & Partial<HttpRequest>,
  tags?: string[],
): void {
  request.graphqlOperationName = undefined;
  request.graphqlOperationType = undefined;

  if (request.method.toUpperCase() !== 'POST') {
    return;
  }

  const parsed = parseGraphQLRequest(request.body, request.headers['content-type']);
  if (!parsed) {
    return;
  }

  request.graphqlOperationName = parsed.operationName;
  request.graphqlOperationType = parsed.operationType;

  if (tags && !tags.includes('graphql')) {
    tags.push('graphql');
  }
}
