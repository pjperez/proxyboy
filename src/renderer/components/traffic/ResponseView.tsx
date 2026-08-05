import React, { useMemo, useState } from 'react';
import BodyViewer from './BodyViewer';
import type { HttpResponse } from '../../../shared/types';

interface Props {
  response: HttpResponse;
  requestPath?: string;
}

export default function ResponseView({ response, requestPath }: Props) {
  const [headerFilter, setHeaderFilter] = useState('');
  const statusColor = response.statusCode < 300 ? 'text-pb-success' :
                      response.statusCode < 400 ? 'text-pb-warning' : 'text-pb-error';
  const headers = useMemo(() => {
    const entries = Object.entries(response.headers);
    const needle = headerFilter.trim().toLowerCase();
    if (!needle) {
      return entries;
    }
    return entries.filter(([key, value]) => {
      const haystack = `${key} ${Array.isArray(value) ? value.join(' ') : value}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [headerFilter, response.headers]);

  return (
    <div className="space-y-4">
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase text-pb-text-dim">Status</h3>
        <div className="rounded bg-pb-surface p-3 text-xs">
          <span className={`font-mono font-bold ${statusColor}`}>{response.statusCode}</span>
          <span className="ml-2 text-pb-text-dim">{response.statusMessage}</span>
          <span className="ml-4 text-pb-text-dim">({response.duration}ms)</span>
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-xs font-semibold uppercase text-pb-text-dim">
            Headers ({Object.keys(response.headers).length})
          </h3>
          <input
            type="text"
            value={headerFilter}
            onChange={(event) => setHeaderFilter(event.target.value)}
            placeholder="Filter headers"
            className="h-7 w-44 rounded border border-pb-border bg-pb-bg px-2 text-xs text-pb-text placeholder-pb-text-dim focus:border-pb-accent focus:outline-none"
          />
        </div>
        <div className="space-y-1 rounded bg-pb-surface p-3 font-mono text-xs">
          {headers.length === 0 ? (
            <div className="text-pb-text-dim">No headers match this filter.</div>
          ) : (
            headers.map(([key, value]) => (
              <div key={key} className="flex gap-2">
                <span className="whitespace-nowrap text-pb-accent">{key}:</span>
                <span className="break-all text-pb-text">{String(value)}</span>
              </div>
            ))
          )}
        </div>
      </section>

      {response.body && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase text-pb-text-dim">
            Body ({response.bodySize} bytes)
          </h3>
          <BodyViewer
            body={String(response.body)}
            contentType={String(response.headers['content-type'] || '')}
            isBase64={(response as any)._isBase64}
            requestPath={requestPath}
            direction="response"
          />
        </section>
      )}
    </div>
  );
}
