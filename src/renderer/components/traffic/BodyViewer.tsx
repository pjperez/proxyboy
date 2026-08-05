import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { parseGraphQLRequest } from '../../../shared/graphql';
import { isProtobufContentType, type ProtobufDecodeResult, type ProtobufRawField } from '../../../shared/protobuf';
import { isUrlEncodedForm, parseUrlEncodedForm } from '../../utils/request-parts';

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

interface BodySearchProps {
  text: string;
  textClassName: string;
  onCopy: () => void;
}

function BodySearchView({ text, textClassName, onCopy }: BodySearchProps) {
  const [query, setQuery] = useState('');
  const [currentMatch, setCurrentMatch] = useState(0);

  const matchIndexes = useMemo(() => {
    if (!query) return [] as number[];
    const indexes: number[] = [];
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    let from = 0;
    while (from <= lowerText.length - lowerQuery.length) {
      const idx = lowerText.indexOf(lowerQuery, from);
      if (idx === -1) break;
      indexes.push(idx);
      from = idx + Math.max(lowerQuery.length, 1);
    }
    return indexes;
  }, [query, text]);

  useEffect(() => {
    setCurrentMatch(0);
  }, [query, text]);

  useEffect(() => {
    if (matchIndexes.length === 0) {
      setCurrentMatch(0);
      return;
    }
    if (currentMatch >= matchIndexes.length) {
      setCurrentMatch(0);
    }
  }, [currentMatch, matchIndexes]);

  const goPrev = useCallback(() => {
    if (matchIndexes.length === 0) return;
    setCurrentMatch((prev) => (prev - 1 + matchIndexes.length) % matchIndexes.length);
  }, [matchIndexes.length]);

  const goNext = useCallback(() => {
    if (matchIndexes.length === 0) return;
    setCurrentMatch((prev) => (prev + 1) % matchIndexes.length);
  }, [matchIndexes.length]);

  const highlighted = useMemo(() => {
    if (!query || matchIndexes.length === 0) {
      return text;
    }

    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    const qLen = query.length;

    matchIndexes.forEach((start, i) => {
      if (start > lastIndex) {
        parts.push(text.slice(lastIndex, start));
      }
      const end = start + qLen;
      const isCurrent = i === currentMatch;
      parts.push(
        <mark
          key={`${start}-${i}`}
          id={isCurrent ? 'body-viewer-current-match' : undefined}
          className={
            isCurrent
              ? 'bg-pb-accent text-white rounded-sm px-0.5'
              : 'bg-pb-warning/40 text-pb-text rounded-sm px-0.5'
          }
        >
          {text.slice(start, end)}
        </mark>,
      );
      lastIndex = end;
    });

    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return parts;
  }, [currentMatch, matchIndexes, query, text]);

  useEffect(() => {
    if (!query || matchIndexes.length === 0) return;
    const el = document.getElementById('body-viewer-current-match');
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [currentMatch, matchIndexes.length, query]);

  const matchLabel = matchIndexes.length === 0
    ? '0/0'
    : `${currentMatch + 1}/${matchIndexes.length}`;

  return (
    <div className="bg-pb-bg rounded border border-pb-border overflow-hidden max-h-96 flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-pb-border bg-pb-surface shrink-0">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find in body"
          className="h-6 flex-1 min-w-0 bg-pb-bg border border-pb-border rounded px-2 text-[11px] text-pb-text placeholder-pb-text-dim focus:outline-none focus:border-pb-accent"
        />
        <span className="text-[10px] text-pb-text-dim tabular-nums shrink-0 w-10 text-center">
          {query ? matchLabel : ''}
        </span>
        <button
          type="button"
          onClick={goPrev}
          disabled={matchIndexes.length === 0}
          className="px-1.5 py-0.5 text-[10px] rounded bg-pb-border text-pb-text-dim hover:text-pb-text disabled:opacity-40 disabled:cursor-not-allowed"
          title="Previous match"
        >
          Prev
        </button>
        <button
          type="button"
          onClick={goNext}
          disabled={matchIndexes.length === 0}
          className="px-1.5 py-0.5 text-[10px] rounded bg-pb-border text-pb-text-dim hover:text-pb-text disabled:opacity-40 disabled:cursor-not-allowed"
          title="Next match"
        >
          Next
        </button>
        <button
          type="button"
          onClick={onCopy}
          className="px-2 py-0.5 text-[10px] rounded bg-pb-accent/15 text-pb-accent hover:bg-pb-accent/25 font-medium"
          title="Copy body"
        >
          Copy
        </button>
      </div>
      <pre className={`p-3 text-xs font-mono whitespace-pre-wrap break-all overflow-auto flex-1 ${textClassName}`}>
        {highlighted}
      </pre>
    </div>
  );
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
  const [protobufResult, setProtobufResult] = useState<ProtobufDecodeResult | null>(null);
  const [protobufError, setProtobufError] = useState<string | null>(null);
  const [protobufLoading, setProtobufLoading] = useState(false);
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

  const formFields = useMemo(() => {
    if (isImage || isBase64 || graphqlRequest) return null;
    if (!isUrlEncodedForm(contentType)) return null;
    return parseUrlEncodedForm(displayBody);
  }, [contentType, displayBody, graphqlRequest, isBase64, isImage]);

  useEffect(() => {
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

  const handleCopyFormatted = useCallback(() => {
    void navigator.clipboard.writeText(formatted);
  }, [formatted]);

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

  if (formFields) {
    const formText = formFields.map((f) => `${f.key}=${f.value}`).join('\n');
    return (
      <div className="bg-pb-bg rounded border border-pb-border overflow-hidden max-h-96 flex flex-col">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-pb-border bg-pb-surface shrink-0">
          <span className="rounded bg-pb-accent/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-pb-accent">
            Form
          </span>
          <span className="text-[10px] text-pb-text-dim">{formFields.length} field{formFields.length === 1 ? '' : 's'}</span>
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(formText)}
            className="ml-auto px-2 py-0.5 text-[10px] rounded bg-pb-accent/15 text-pb-accent hover:bg-pb-accent/25 font-medium"
            title="Copy form fields"
          >
            Copy
          </button>
        </div>
        <div className="overflow-auto flex-1">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-pb-surface border-b border-pb-border">
              <tr className="text-left text-[10px] uppercase tracking-wide text-pb-text-dim">
                <th className="px-3 py-1.5 font-semibold w-1/3">Name</th>
                <th className="px-3 py-1.5 font-semibold">Value</th>
              </tr>
            </thead>
            <tbody>
              {formFields.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-3 py-3 text-pb-text-dim">No form fields</td>
                </tr>
              ) : (
                formFields.map((field, index) => (
                  <tr key={`${field.key}-${index}`} className="border-b border-pb-border/40 align-top">
                    <td className="px-3 py-1.5 font-mono text-pb-info break-all">{field.key}</td>
                    <td className="px-3 py-1.5 font-mono text-pb-text break-all whitespace-pre-wrap">{field.value}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const isJson = contentType.includes('json');
  const isHtml = contentType.includes('html');
  const isXml = contentType.includes('xml');
  const textClassName = isJson ? 'text-pb-info' : isHtml || isXml ? 'text-pb-warning' : 'text-pb-text';

  return (
    <div className="space-y-0">
      {isBase64 && !isImage && (
        <div className="flex items-center gap-2 px-3 py-1.5 border border-b-0 border-pb-border bg-pb-surface rounded-t">
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
      <BodySearchView
        text={formatted}
        textClassName={textClassName}
        onCopy={handleCopyFormatted}
      />
    </div>
  );
}
