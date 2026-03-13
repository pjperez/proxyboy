import React from 'react';
import BodyViewer from './BodyViewer';
import type { HttpResponse } from '../../../shared/types';

interface Props {
  response: HttpResponse;
}

export default function ResponseView({ response }: Props) {
  const statusColor = response.statusCode < 300 ? 'text-pb-success' :
                      response.statusCode < 400 ? 'text-pb-warning' : 'text-pb-error';

  return (
    <div className="space-y-4">
      {/* Status */}
      <section>
        <h3 className="text-xs font-semibold text-pb-text-dim uppercase mb-2">Status</h3>
        <div className="bg-pb-surface rounded p-3 text-xs">
          <span className={`font-mono font-bold ${statusColor}`}>{response.statusCode}</span>
          <span className="text-pb-text-dim ml-2">{response.statusMessage}</span>
          <span className="text-pb-text-dim ml-4">({response.duration}ms)</span>
        </div>
      </section>

      {/* Headers */}
      <section>
        <h3 className="text-xs font-semibold text-pb-text-dim uppercase mb-2">
          Headers ({Object.keys(response.headers).length})
        </h3>
        <div className="bg-pb-surface rounded p-3 space-y-1 text-xs font-mono">
          {Object.entries(response.headers).map(([key, value]) => (
            <div key={key} className="flex gap-2">
              <span className="text-pb-accent whitespace-nowrap">{key}:</span>
              <span className="text-pb-text break-all">{String(value)}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Body */}
      {response.body && (
        <section>
          <h3 className="text-xs font-semibold text-pb-text-dim uppercase mb-2">
            Body ({response.bodySize} bytes)
          </h3>
          <BodyViewer
            body={String(response.body)}
            contentType={String(response.headers['content-type'] || '')}
            isBase64={(response as any)._isBase64}
          />
        </section>
      )}
    </div>
  );
}
