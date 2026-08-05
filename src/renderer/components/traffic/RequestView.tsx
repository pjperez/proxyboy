import React, { useMemo, useState } from 'react';
import BodyViewer from './BodyViewer';
import type { HttpRequest } from '../../../shared/types';
import { parseQueryParams } from '../../utils/request-parts';

interface Props {
  request: HttpRequest;
}

export default function RequestView({ request }: Props) {
  const [headerFilter, setHeaderFilter] = useState('');
  const queryParams = useMemo(() => parseQueryParams(request.url), [request.url]);
  const headers = useMemo(() => {
    const entries = Object.entries(request.headers);
    const needle = headerFilter.trim().toLowerCase();
    if (!needle) {
      return entries;
    }
    return entries.filter(([key, value]) => {
      const haystack = `${key} ${Array.isArray(value) ? value.join(' ') : value}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [headerFilter, request.headers]);

  return (
    <div className="space-y-4">
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase text-pb-text-dim">General</h3>
        <div className="space-y-1 rounded bg-pb-surface p-3 text-xs">
          <div>
            <span className="text-pb-text-dim">URL: </span>
            <span className="font-mono break-all">{request.url}</span>
          </div>
          <div>
            <span className="text-pb-text-dim">Method: </span>
            <span className="font-mono">{request.method}</span>
          </div>
          <div>
            <span className="text-pb-text-dim">Protocol: </span>
            <span className="font-mono">{request.protocol.toUpperCase()}</span>
          </div>
          {request.graphqlOperationType && (
            <div>
              <span className="text-pb-text-dim">GraphQL: </span>
              <span className="font-mono text-pb-info">
                {request.graphqlOperationName
                  ? `${request.graphqlOperationType} ${request.graphqlOperationName}`
                  : `${request.graphqlOperationType} (anonymous)`}
              </span>
            </div>
          )}
        </div>
      </section>

      {queryParams.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase text-pb-text-dim">
            Query Params ({queryParams.length})
          </h3>
          <div className="overflow-hidden rounded border border-pb-border bg-pb-surface">
            <table className="w-full text-xs">
              <thead className="bg-pb-bg text-pb-text-dim">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Name</th>
                  <th className="px-3 py-2 text-left font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {queryParams.map((param, index) => (
                  <tr key={`${param.key}-${index}`} className="border-t border-pb-border">
                    <td className="px-3 py-2 align-top font-mono text-pb-accent">{param.key}</td>
                    <td className="px-3 py-2 align-top break-all font-mono text-pb-text">{param.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-xs font-semibold uppercase text-pb-text-dim">
            Headers ({Object.keys(request.headers).length})
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

      {request.body && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase text-pb-text-dim">
            Body ({request.bodySize} bytes)
          </h3>
          <BodyViewer
            body={String(request.body)}
            contentType={String(request.headers['content-type'] || '')}
            isBase64={(request as any)._isBase64}
            detectGraphQL={true}
            requestPath={request.path}
            direction="request"
          />
        </section>
      )}
    </div>
  );
}
