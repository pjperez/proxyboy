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
          <div className="space-y-4">
            <div className="text-xs">
              <span className="text-pb-text-dim">Started: </span>
              <span>{new Date(flow.request.timestamp).toLocaleTimeString()}</span>
            </div>
            {flow.response && (
              <div className="text-xs">
                <span className="text-pb-text-dim">Total: </span>
                <span className="text-pb-accent font-mono font-bold">{flow.response.duration}ms</span>
              </div>
            )}

            {/* Waterfall breakdown */}
            {flow.timing && flow.response && (() => {
              const t = flow.timing!;
              const total = flow.response!.duration || 1;
              const phases: { label: string; start: number; end: number; color: string }[] = [];

              // Request sending
              if (t.requestEnd) {
                phases.push({
                  label: 'Request',
                  start: 0,
                  end: t.requestEnd - t.start,
                  color: 'bg-green-500',
                });
              }

              // Waiting (TTFB) — from request end to first response byte
              const waitStart = (t.requestEnd ?? t.start) - t.start;
              const waitEnd = (t.firstByte ?? t.responseStart ?? t.responseEnd ?? t.start) - t.start;
              if (waitEnd > waitStart) {
                phases.push({
                  label: 'Waiting (TTFB)',
                  start: waitStart,
                  end: waitEnd,
                  color: 'bg-blue-500',
                });
              }

              // Response download — from first byte to response end
              const dlStart = (t.firstByte ?? t.responseStart ?? t.start) - t.start;
              const dlEnd = (t.responseEnd ?? t.start) - t.start;
              if (dlEnd > dlStart) {
                phases.push({
                  label: 'Download',
                  start: dlStart,
                  end: dlEnd,
                  color: 'bg-purple-500',
                });
              }

              return (
                <div className="space-y-2 mt-2">
                  {phases.map((phase, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-28 text-[11px] text-pb-text-dim text-right shrink-0">
                        {phase.label}
                      </div>
                      <div className="flex-1 h-5 bg-pb-surface rounded overflow-hidden relative">
                        <div
                          className={`absolute top-0 h-full ${phase.color} rounded opacity-70`}
                          style={{
                            left: `${(phase.start / total) * 100}%`,
                            width: `${Math.max(1, ((phase.end - phase.start) / total) * 100)}%`,
                          }}
                        />
                      </div>
                      <div className="w-16 text-[11px] font-mono text-pb-text text-right shrink-0">
                        {phase.end - phase.start}ms
                      </div>
                    </div>
                  ))}

                  {/* Summary table */}
                  <div className="mt-4 border border-pb-border rounded bg-pb-surface">
                    <table className="w-full text-xs">
                      <tbody>
                        {t.requestEnd && (
                          <tr className="border-b border-pb-border">
                            <td className="px-3 py-1.5 text-pb-text-dim">Request sent</td>
                            <td className="px-3 py-1.5 font-mono text-right">{t.requestEnd - t.start}ms</td>
                          </tr>
                        )}
                        {waitEnd > waitStart && (
                          <tr className="border-b border-pb-border">
                            <td className="px-3 py-1.5 text-pb-text-dim">Waiting (TTFB)</td>
                            <td className="px-3 py-1.5 font-mono text-right">{waitEnd - waitStart}ms</td>
                          </tr>
                        )}
                        {dlEnd > dlStart && (
                          <tr className="border-b border-pb-border">
                            <td className="px-3 py-1.5 text-pb-text-dim">Content download</td>
                            <td className="px-3 py-1.5 font-mono text-right">{dlEnd - dlStart}ms</td>
                          </tr>
                        )}
                        <tr>
                          <td className="px-3 py-1.5 text-pb-text font-medium">Total</td>
                          <td className="px-3 py-1.5 font-mono font-bold text-pb-accent text-right">{total}ms</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}

            {/* Fallback for flows without timing breakdown */}
            {!flow.timing && flow.response && (
              <div className="mt-4">
                <div className="h-6 bg-pb-surface rounded overflow-hidden">
                  <div
                    className="h-full bg-pb-accent/30 rounded"
                    style={{ width: `${Math.min(100, (flow.response.duration / 2000) * 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
