import React from 'react';
import BodyViewer from './BodyViewer';
import type { HttpRequest } from '../../../shared/types';

interface Props {
  request: HttpRequest;
}

export default function RequestView({ request }: Props) {
  return (
    <div className="space-y-4">
      {/* General */}
      <section>
        <h3 className="text-xs font-semibold text-pb-text-dim uppercase mb-2">General</h3>
        <div className="bg-pb-surface rounded p-3 space-y-1 text-xs">
          <div><span className="text-pb-text-dim">URL: </span><span className="font-mono">{request.url}</span></div>
          <div><span className="text-pb-text-dim">Method: </span><span className="font-mono">{request.method}</span></div>
          <div><span className="text-pb-text-dim">Protocol: </span><span className="font-mono">{request.protocol.toUpperCase()}</span></div>
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

      {/* Headers */}
      <section>
        <h3 className="text-xs font-semibold text-pb-text-dim uppercase mb-2">
          Headers ({Object.keys(request.headers).length})
        </h3>
        <div className="bg-pb-surface rounded p-3 space-y-1 text-xs font-mono">
          {Object.entries(request.headers).map(([key, value]) => (
            <div key={key} className="flex gap-2">
              <span className="text-pb-accent whitespace-nowrap">{key}:</span>
              <span className="text-pb-text break-all">{String(value)}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Body */}
      {request.body && (
        <section>
          <h3 className="text-xs font-semibold text-pb-text-dim uppercase mb-2">
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
