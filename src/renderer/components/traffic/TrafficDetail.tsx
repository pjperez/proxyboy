import React, { useState, useMemo } from 'react';
import RequestView from './RequestView';
import ResponseView from './ResponseView';
import type { HttpFlow } from '../../../shared/types';

interface Props {
  flow: HttpFlow;
  onClose: () => void;
}

type Tab = 'request' | 'response' | 'preview' | 'timing';

function isImageFlow(flow: HttpFlow): boolean {
  const ct = flow.response?.headers?.['content-type'];
  return ct ? String(ct).toLowerCase().startsWith('image/') : false;
}

export default function TrafficDetail({ flow, onClose }: Props) {
  const hasPreview = isImageFlow(flow);
  const [tab, setTab] = useState<Tab>(hasPreview ? 'preview' : 'request');

  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: 'request', label: 'Request', show: true },
    { id: 'response', label: 'Response', show: true },
    { id: 'preview', label: '🖼 Preview', show: hasPreview },
    { id: 'timing', label: 'Timing', show: true },
  ];

  const imageDataUrl = useMemo(() => {
    if (!hasPreview || !flow.response?.body) return null;
    const ct = String(flow.response.headers['content-type']).split(';')[0].trim();
    const body = String(flow.response.body);
    // Check if body is already base64 (from sanitizeFlow)
    if ((flow.response as any)._isBase64) {
      return `data:${ct};base64,${body}`;
    }
    return null;
  }, [flow, hasPreview]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-10 bg-pb-surface border-b border-pb-border">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-mono font-bold text-pb-accent">{flow.request.method}</span>
          <span className="text-pb-text truncate max-w-md" title={flow.request.url}>
            {flow.request.url}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-pb-text-dim hover:text-pb-text text-lg px-1"
        >
          ✕
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-pb-border">
        {tabs.filter(t => t.show).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-xs font-medium transition-colors border-b-2
              ${tab === t.id
                ? 'border-pb-accent text-pb-accent'
                : 'border-transparent text-pb-text-dim hover:text-pb-text'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {tab === 'request' && <RequestView request={flow.request} />}
        {tab === 'response' && flow.response && <ResponseView response={flow.response} />}
        {tab === 'response' && !flow.response && (
          <div className="text-pb-text-dim text-sm">Waiting for response...</div>
        )}
        {tab === 'preview' && imageDataUrl && (
          <div className="flex flex-col items-center gap-4">
            <div
              className="rounded border border-pb-border p-2 max-w-full"
              style={{
                backgroundImage:
                  'linear-gradient(45deg, #2a2b3d 25%, transparent 25%, transparent 75%, #2a2b3d 75%), linear-gradient(45deg, #2a2b3d 25%, transparent 25%, transparent 75%, #2a2b3d 75%)',
                backgroundSize: '16px 16px',
                backgroundPosition: '0 0, 8px 8px',
              }}
            >
              <img
                src={imageDataUrl}
                className="max-w-full max-h-[60vh] object-contain"
                alt="Response image"
              />
            </div>
            <div className="text-xs text-pb-text-dim space-y-1 text-center">
              <div>{String(flow.response?.headers['content-type'] || '')} • {flow.response?.bodySize} bytes</div>
              <div className="font-mono text-[10px] text-pb-text-dim break-all max-w-md">{flow.request.url}</div>
            </div>
          </div>
        )}
        {tab === 'timing' && (
          <div className="space-y-3">
            <div className="text-xs">
              <span className="text-pb-text-dim">Started: </span>
              <span>{new Date(flow.request.timestamp).toLocaleTimeString()}</span>
            </div>
            {flow.response && (
              <>
                <div className="text-xs">
                  <span className="text-pb-text-dim">Duration: </span>
                  <span className="text-pb-accent font-mono">{flow.response.duration}ms</span>
                </div>
                <div className="mt-4">
                  <div className="h-6 bg-pb-surface rounded overflow-hidden">
                    <div
                      className="h-full bg-pb-accent/30 rounded"
                      style={{ width: `${Math.min(100, (flow.response.duration / 2000) * 100)}%` }}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
