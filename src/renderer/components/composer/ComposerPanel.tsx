import React, { useEffect, useMemo, useState } from 'react';
import RequestView from '../traffic/RequestView';
import ResponseView from '../traffic/ResponseView';
import { useTrafficStore } from '../../stores/traffic';
import type { ComposerRequest, HttpFlow, HttpHeaders, HttpRequest } from '../../../shared/types';

interface HeaderRow {
  id: string;
  name: string;
  value: string;
}

interface Props {
  draft?: ComposerRequest | null;
}

function createHeaderRow(name = '', value = ''): HeaderRow {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name,
    value,
  };
}

function getHeaderRows(headers?: HttpHeaders): HeaderRow[] {
  const entries = Object.entries(headers || {}).map(([name, value]) =>
    createHeaderRow(name, Array.isArray(value) ? value.join(', ') : value),
  );

  return entries.length > 0 ? entries : [createHeaderRow()];
}

function buildHeaders(rows: HeaderRow[]): HttpHeaders {
  const headers: HttpHeaders = {};
  for (const row of rows) {
    const name = row.name.trim();
    const value = row.value.trim();
    if (!name || !value) {
      continue;
    }

    headers[name] = value;
  }

  return headers;
}

function buildPreviewRequest(method: string, url: string, headers: HttpHeaders, body: string): HttpRequest | null {
  try {
    const parsedUrl = new URL(url);
    return {
      id: 'composer-preview',
      method,
      url: parsedUrl.toString(),
      protocol: parsedUrl.protocol === 'https:' ? 'https' : 'http',
      host: parsedUrl.host,
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      headers,
      body: body || undefined,
      bodySize: body.length,
      timestamp: Date.now(),
    };
  } catch {
    return null;
  }
}

export default function ComposerPanel({ draft = null }: Props) {
  const flows = useTrafficStore((state) => state.flows);
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('https://example.com/');
  const [headerRows, setHeaderRows] = useState<HeaderRow[]>([createHeaderRow()]);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [composerRequestId, setComposerRequestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!draft) {
      return;
    }

    setMethod(draft.method || 'GET');
    setUrl(draft.url || 'https://example.com/');
    setHeaderRows(getHeaderRows(draft.headers));
    setBody(draft.body || '');
    setComposerRequestId(null);
    setSending(false);
    setError(null);
  }, [draft]);

  const headers = useMemo(() => buildHeaders(headerRows), [headerRows]);
  const previewRequest = useMemo(() => buildPreviewRequest(method, url, headers, body), [body, headers, method, url]);
  const composerFlow = useMemo(() => {
    if (!composerRequestId) {
      return null;
    }

    for (let index = flows.length - 1; index >= 0; index -= 1) {
      if (flows[index].composerRequestId === composerRequestId) {
        return flows[index];
      }
    }

    return null;
  }, [composerRequestId, flows]);

  useEffect(() => {
    if (!sending || !composerFlow) {
      return;
    }

    if (composerFlow.response || composerFlow.state === 'error' || composerFlow.state === 'blocked') {
      setSending(false);
    }
  }, [composerFlow, sending]);

  const updateHeaderRow = (id: string, field: 'name' | 'value', value: string) => {
    setHeaderRows((rows) => rows.map((row) => row.id === id ? { ...row, [field]: value } : row));
  };

  const addHeaderRow = () => {
    setHeaderRows((rows) => [...rows, createHeaderRow()]);
  };

  const removeHeaderRow = (id: string) => {
    setHeaderRows((rows) => {
      const nextRows = rows.filter((row) => row.id !== id);
      return nextRows.length > 0 ? nextRows : [createHeaderRow()];
    });
  };

  const handleReset = () => {
    setMethod('GET');
    setUrl('https://example.com/');
    setHeaderRows([createHeaderRow()]);
    setBody('');
    setComposerRequestId(null);
    setSending(false);
    setError(null);
  };

  const handleSend = async () => {
    let normalizedUrl: string;
    try {
      normalizedUrl = new URL(url).toString();
    } catch {
      setError('Enter a valid http:// or https:// URL before sending.');
      return;
    }

    setSending(true);
    setError(null);
    setComposerRequestId(null);

    const result = await window.proxyboy?.traffic.compose({
      method,
      url: normalizedUrl,
      headers,
      body: body || undefined,
    });

    if (!result?.success || !result.composerRequestId) {
      setSending(false);
      setError(result?.error || 'Failed to send the composed request.');
      return;
    }

    setUrl(normalizedUrl);
    setComposerRequestId(result.composerRequestId);
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="w-1/2 min-w-[420px] overflow-y-auto border-r border-pb-border p-6">
        <h1 className="text-xl font-semibold text-pb-text mb-6">Request Composer</h1>

        <div className="space-y-5">
          <section className="space-y-3">
            <label className="block text-xs font-semibold uppercase tracking-wider text-pb-text-dim">
              Target
            </label>
            <div className="flex gap-3">
              <select
                value={method}
                onChange={(event) => setMethod(event.target.value.toUpperCase())}
                className="bg-pb-bg border border-pb-border rounded px-3 py-2 text-sm text-pb-text w-28"
              >
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((entry) => (
                  <option key={entry} value={entry}>{entry}</option>
                ))}
              </select>
              <input
                type="text"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://api.example.com/users"
                className="flex-1 bg-pb-bg border border-pb-border rounded px-3 py-2 text-sm text-pb-text font-mono"
              />
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-pb-text-dim">
                Headers
              </label>
              <button
                type="button"
                onClick={addHeaderRow}
                className="text-xs text-pb-accent hover:underline"
              >
                + Add header
              </button>
            </div>
            <div className="space-y-2">
              {headerRows.map((row) => (
                <div key={row.id} className="flex gap-2">
                  <input
                    type="text"
                    value={row.name}
                    onChange={(event) => updateHeaderRow(row.id, 'name', event.target.value)}
                    placeholder="Header name"
                    className="w-1/3 bg-pb-bg border border-pb-border rounded px-3 py-2 text-sm text-pb-text"
                  />
                  <input
                    type="text"
                    value={row.value}
                    onChange={(event) => updateHeaderRow(row.id, 'value', event.target.value)}
                    placeholder="Header value"
                    className="flex-1 bg-pb-bg border border-pb-border rounded px-3 py-2 text-sm text-pb-text font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => removeHeaderRow(row.id)}
                    className="w-9 rounded border border-pb-border text-pb-text-dim hover:text-pb-text hover:bg-pb-surface-hover"
                    title="Remove header"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <label className="block text-xs font-semibold uppercase tracking-wider text-pb-text-dim">
              Body
            </label>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder='{"hello":"world"}'
              className="w-full min-h-[240px] resize-y bg-pb-bg border border-pb-border rounded px-3 py-2 text-sm text-pb-text font-mono"
            />
          </section>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={sending}
              className="px-4 py-2 rounded text-sm font-medium bg-pb-accent text-pb-bg hover:bg-pb-accent/80 disabled:opacity-50"
            >
              {sending ? 'Sending…' : 'Send request'}
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="px-4 py-2 rounded text-sm text-pb-text border border-pb-border hover:bg-pb-surface-hover"
            >
              Reset
            </button>
            {composerFlow && (
              <span className="text-xs text-pb-text-dim">
                Captured as flow <span className="font-mono text-pb-text">{composerFlow.id.slice(0, 8)}</span>
              </span>
            )}
          </div>

          {error && (
            <div className="rounded border border-pb-error/40 bg-pb-error/10 px-3 py-2 text-sm text-pb-error">
              {error}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <h2 className="text-lg font-semibold text-pb-text mb-4">Latest result</h2>
        {composerFlow ? (
          <div className="space-y-5">
            <ComposerFlowSummary flow={composerFlow} />
            {composerFlow.response ? (
              <ResponseView response={composerFlow.response} />
            ) : (
              <div className="rounded border border-pb-border bg-pb-surface px-4 py-3 text-sm text-pb-text-dim">
                Waiting for the upstream response…
              </div>
            )}
          </div>
        ) : previewRequest ? (
          <div className="space-y-5">
            <RequestView request={previewRequest} />
            <div className="rounded border border-pb-border bg-pb-surface px-4 py-3 text-sm text-pb-text-dim">
              Send the request to capture and preview the response here.
            </div>
          </div>
        ) : (
          <div className="rounded border border-pb-border bg-pb-surface px-4 py-3 text-sm text-pb-text-dim">
            Enter a valid URL to preview the composed request.
          </div>
        )}
      </div>
    </div>
  );
}

function ComposerFlowSummary({ flow }: { flow: HttpFlow }) {
  return (
    <div className="rounded border border-pb-border bg-pb-surface p-4">
      <div className="flex items-center gap-2 text-xs">
        <span className="rounded bg-pb-accent/15 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-pb-accent">
          Composer
        </span>
        <span className="font-mono font-bold text-pb-accent">{flow.request.method}</span>
        <span className="text-pb-text truncate" title={flow.request.url}>{flow.request.url}</span>
      </div>
      {flow.notes && (
        <div className="mt-3 text-sm text-pb-text-dim">
          {flow.notes}
        </div>
      )}
    </div>
  );
}
