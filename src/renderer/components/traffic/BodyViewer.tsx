import React, { useMemo, useState } from 'react';
import { parseGraphQLRequest } from '../../../shared/graphql';
import { isProtobufContentType, type ProtobufDecodeResult, type ProtobufRawField } from '../../../shared/protobuf';

interface Props {
  body: string;
  contentType: string;
  isBase64?: boolean;
  detectGraphQL?: boolean;
  requestPath?: string;
  direction?: 'request' | 'response';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function base64Decode(b64: string): string | null {
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    // Try gzip
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      const { ungzip } = require('pako') as typeof import('pako');
      return ungzip(bytes, { to: 'string' });
    }
    // Try deflate
    if (bytes[0] === 0x78) {
      const { inflate } = require('pako') as typeof import('pako');
      return inflate(bytes, { to: 'string' });
    }
    // Not compressed — try decoding as UTF-8
    const decoder = new TextDecoder('utf-8', { fatal: true });
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

function renderRawFields(fields: ProtobufRawField[]): string {
  return JSON.stringify(fields, null, 2);
}

export default function BodyViewer({
  body,
  contentType,
  isBase64,
  detectGraphQL = false,
  requestPath,
  direction = 'response',
}: Props) {
  const isImage = contentType.startsWith('image/');
  const [showDecoded, setShowDecoded] = useState(true);
  const [protobufResult, setProtobufResult] = React.useState<ProtobufDecodeResult | null>(null);
  const [protobufError, setProtobufError] = React.useState<string | null>(null);
  const [protobufLoading, setProtobufLoading] = React.useState(false);
  const shouldAttemptProtobuf = !isImage && showDecoded && isProtobufContentType(contentType);

  // For base64 non-image bodies, attempt to decode/decompress
  const decoded = useMemo(() => {
    if (!isBase64 || isImage || !showDecoded) return null;
    return base64Decode(body);
  }, [body, isBase64, isImage, showDecoded]);

  const displayBody = (isBase64 && !isImage) ? (decoded ?? `[Binary data, ${formatSize(body.length * 0.75)} estimated]`) : body;
  const graphqlRequest = useMemo(() => {
    if (isImage || isBase64 || !detectGraphQL) return null;
    return parseGraphQLRequest(displayBody, contentType);
  }, [contentType, detectGraphQL, displayBody, isBase64, isImage]);

  React.useEffect(() => {
    let cancelled = false;

    if (!shouldAttemptProtobuf) {
      setProtobufResult(null);
      setProtobufError(null);
      setProtobufLoading(false);
      return;
    }

    setProtobufLoading(true);
    setProtobufResult(null);
    setProtobufError(null);

    window.proxyboy?.protobuf.decodeBody({
      body,
      contentType,
      isBase64,
      requestPath,
      direction,
    }).then((result: { success: boolean; result?: ProtobufDecodeResult | null; error?: string }) => {
      if (cancelled) return;
      if (result?.success) {
        setProtobufResult(result.result ?? null);
        setProtobufError(null);
      } else {
        setProtobufResult(null);
        setProtobufError(result?.error || 'Failed to decode the protobuf body.');
      }
    }).catch((error: unknown) => {
      if (cancelled) return;
      setProtobufResult(null);
      setProtobufError(error instanceof Error ? error.message : 'Failed to decode the protobuf body.');
    }).finally(() => {
      if (!cancelled) {
        setProtobufLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [body, contentType, direction, isBase64, requestPath, shouldAttemptProtobuf]);

  const formatted = useMemo(() => {
    if (isImage) return displayBody;
    if (contentType.includes('json')) {
      try {
        return JSON.stringify(JSON.parse(displayBody), null, 2);
      } catch {
        return displayBody;
      }
    }
    return displayBody;
  }, [displayBody, contentType, isImage]);

  if (isImage && isBase64) {
    const dataUrl = `data:${contentType};base64,${body}`;
    return (
      <div className="flex flex-col items-center gap-3 p-4">
        <div
          className="rounded border border-pb-border p-2"
          style={{
            backgroundImage:
              'linear-gradient(45deg, #2a2b3d 25%, transparent 25%, transparent 75%, #2a2b3d 75%), linear-gradient(45deg, #2a2b3d 25%, transparent 25%, transparent 75%, #2a2b3d 75%)',
            backgroundSize: '16px 16px',
            backgroundPosition: '0 0, 8px 8px',
          }}
        >
          <img
            src={dataUrl}
            className="max-w-full max-h-96 object-contain"
            alt="Response image"
          />
        </div>
        <div className="text-xs text-pb-text-dim">
          {contentType} • {formatSize(body.length)} (base64)
        </div>
      </div>
    );
  }

  if (graphqlRequest) {
    return (
      <div className="bg-pb-bg rounded border border-pb-border overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-pb-border bg-pb-surface text-xs">
          <span className="rounded bg-pb-info/15 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-pb-info">
            GraphQL
          </span>
          <span className="text-pb-text">
            {graphqlRequest.operationName || 'Anonymous operation'}
          </span>
          {graphqlRequest.operationType && (
            <span className="text-pb-text-dim">
              {graphqlRequest.operationType}
            </span>
          )}
        </div>
        <div className="space-y-3 p-3">
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-pb-text-dim">Query</div>
            <pre className="whitespace-pre-wrap break-all rounded border border-pb-border bg-pb-surface p-3 text-xs font-mono text-pb-info">
              {graphqlRequest.query}
            </pre>
          </div>
          {graphqlRequest.variables !== undefined && (
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-pb-text-dim">Variables</div>
              <pre className="whitespace-pre-wrap break-all rounded border border-pb-border bg-pb-surface p-3 text-xs font-mono text-pb-text">
                {JSON.stringify(graphqlRequest.variables, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (protobufResult) {
    return (
      <div className="bg-pb-bg rounded border border-pb-border overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-pb-border bg-pb-surface text-xs">
          <span className="rounded bg-pb-warning/15 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-pb-warning">
            {protobufResult.format === 'grpc' ? 'gRPC' : 'Protobuf'}
          </span>
          <span className="text-pb-text">
            {protobufResult.usedSchema
              ? protobufResult.schemaTypeName
              : protobufResult.schemaConfigured
                ? 'Raw field fallback'
                : 'No schema configured'}
          </span>
          {protobufResult.methodPath && (
            <span className="text-pb-text-dim font-mono break-all">{protobufResult.methodPath}</span>
          )}
        </div>
        <div className="space-y-3 p-3">
          {protobufLoading && (
            <div className="text-xs text-pb-text-dim">Decoding protobuf body…</div>
          )}
          {protobufError && (
            <div className="rounded border border-pb-error/40 bg-pb-error/10 px-3 py-2 text-xs text-pb-error">
              {protobufError}
            </div>
          )}
          {protobufResult.notice && (
            <div className="rounded border border-pb-warning/40 bg-pb-warning/10 px-3 py-2 text-xs text-pb-warning">
              {protobufResult.notice}
            </div>
          )}
          {protobufResult.messages.map((message) => (
            <div key={`${protobufResult.format}-${message.index}`} className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-pb-text-dim">
                {protobufResult.format === 'grpc' ? `Message ${message.index + 1}` : 'Decoded payload'}
                <span className="ml-2 normal-case text-pb-text-dim">
                  {message.length} bytes{message.compressed ? ' • compressed' : ''}
                </span>
              </div>
              {message.error && (
                <div className="rounded border border-pb-error/40 bg-pb-error/10 px-3 py-2 text-xs text-pb-error">
                  {message.error}
                </div>
              )}
              {message.decodedJson !== undefined && (
                <pre className="whitespace-pre-wrap break-all rounded border border-pb-border bg-pb-surface p-3 text-xs font-mono text-pb-info">
                  {JSON.stringify(message.decodedJson, null, 2)}
                </pre>
              )}
              {!message.decodedJson && message.fallbackFields && (
                <pre className="whitespace-pre-wrap break-all rounded border border-pb-border bg-pb-surface p-3 text-xs font-mono text-pb-text">
                  {renderRawFields(message.fallbackFields)}
                </pre>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const isJson = contentType.includes('json');
  const isHtml = contentType.includes('html');
  const isXml = contentType.includes('xml');

  return (
    <div className="bg-pb-bg rounded border border-pb-border overflow-auto max-h-96">
      {isBase64 && !isImage && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-pb-border bg-pb-surface">
          <span className="text-[10px] text-pb-text-dim">
            {decoded ? '✓ Decoded' : '⚠ Binary'}
          </span>
          <button
            onClick={() => setShowDecoded(!showDecoded)}
            className={`px-2 py-0.5 text-[10px] rounded font-medium transition-colors ${
              showDecoded
                ? 'bg-pb-accent text-white'
                : 'bg-pb-border text-pb-text-dim hover:text-pb-text'
            }`}
          >
            {showDecoded ? 'Raw' : 'Decode'}
          </button>
          {protobufLoading && <span className="text-[10px] text-pb-text-dim">Protobuf…</span>}
        </div>
      )}
      <pre className={`p-3 text-xs font-mono whitespace-pre-wrap break-all
        ${isJson ? 'text-pb-info' : isHtml || isXml ? 'text-pb-warning' : 'text-pb-text'}`}
      >
        {formatted}
      </pre>
    </div>
  );
}
