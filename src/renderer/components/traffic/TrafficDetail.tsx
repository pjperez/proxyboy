import React, { useEffect, useMemo, useState } from 'react';
import RequestView from './RequestView';
import ResponseView from './ResponseView';
import ResponseDiff from './ResponseDiff';
import CookieView from './CookieView';
import StreamView from './StreamView';
import type { HttpFlow } from '../../../shared/types';

interface Props {
  flow: HttpFlow;
  comparisonFlow?: HttpFlow | null;
  onClearComparison?: () => void;
  onClose: () => void;
}

type Tab = 'request' | 'response' | 'compare' | 'cookies' | 'preview' | 'stream' | 'timing';

function isImageFlow(flow: HttpFlow): boolean {
  const ct = flow.response?.headers?.['content-type'];
  return ct ? String(ct).toLowerCase().startsWith('image/') : false;
}

function hasHeaderValue(value?: string | string[]): boolean {
  if (!value) return false;
  return Array.isArray(value) ? value.some((entry) => entry.trim().length > 0) : value.trim().length > 0;
}

export default function TrafficDetail({ flow, comparisonFlow = null, onClearComparison, onClose }: Props) {
  const hasPreview = isImageFlow(flow);
  const hasCookies = hasHeaderValue(flow.request.headers.cookie) || hasHeaderValue(flow.response?.headers['set-cookie']);
  const hasComparison = Boolean(flow.response && comparisonFlow?.response);
  const hasStream = flow.streamKind === 'websocket' || flow.streamKind === 'sse';
  const [tab, setTab] = useState<Tab>(hasPreview ? 'preview' : 'request');
  const hasSslPinningWarning = flow.tags.includes('ssl-pinning-suspected');
  const sslPinningMessage = flow.notes?.split('\n').slice(0, 3).join(' ');

  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: 'request', label: 'Request', show: true },
    { id: 'response', label: 'Response', show: true },
    { id: 'compare', label: 'Compare', show: hasComparison },
    { id: 'cookies', label: 'Cookies', show: hasCookies },
    { id: 'preview', label: '🖼 Preview', show: hasPreview },
    { id: 'stream', label: flow.streamKind === 'websocket' ? 'Frames' : 'Events', show: hasStream },
    { id: 'timing', label: 'Timing', show: true },
  ];

  useEffect(() => {
    if (
      (tab === 'cookies' && !hasCookies) ||
      (tab === 'preview' && !hasPreview) ||
      (tab === 'compare' && !hasComparison) ||
      (tab === 'stream' && !hasStream)
    ) {
      setTab(hasPreview ? 'preview' : 'request');
    }
  }, [hasComparison, hasCookies, hasPreview, hasStream, tab]);

  useEffect(() => {
    if (hasComparison) {
      setTab('compare');
    }
  }, [hasComparison, flow.id, comparisonFlow?.id]);

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
          {hasComparison && (
            <span className="rounded bg-pb-warning/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-pb-warning">
              Comparing
            </span>
          )}
          <span className="text-pb-text truncate max-w-md" title={flow.request.url}>
            {flow.request.url}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {hasComparison && onClearComparison && (
            <button
              onClick={onClearComparison}
              className="text-xs text-pb-text-dim hover:text-pb-text"
            >
              Clear compare
            </button>
          )}
          <button
            onClick={onClose}
            title="Close detail (Esc or Ctrl+D)"
            className="text-pb-text-dim hover:text-pb-text text-lg px-1"
          >
            ✕
          </button>
        </div>
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
        {hasSslPinningWarning && (
          <div className="mb-3 rounded-lg border border-pb-warning/40 bg-pb-warning/10 px-4 py-3 text-sm">
            <div className="font-medium text-pb-warning">Possible certificate pinning failure</div>
            <p className="mt-1 text-pb-text">
              {sslPinningMessage || 'The client appears to have rejected the MITM certificate during TLS setup.'}
            </p>
            <a
              href="https://github.com/pjperez/proxyboy#troubleshooting-ssl"
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex text-xs font-medium text-pb-accent hover:underline"
            >
              Open SSL troubleshooting tips
            </a>
          </div>
        )}
        {tab === 'request' && <RequestView request={flow.request} />}
        {tab === 'response' && flow.response && <ResponseView response={flow.response} />}
        {tab === 'response' && !flow.response && (
          <div className="text-pb-text-dim text-sm">Waiting for response...</div>
        )}
        {tab === 'compare' && hasComparison && comparisonFlow && (
          <ResponseDiff markedFlow={comparisonFlow} selectedFlow={flow} />
        )}
        {tab === 'cookies' && <CookieView flow={flow} />}
        {tab === 'stream' && hasStream && <StreamView flow={flow} />}
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
              const statusCode = flow.response!.statusCode;

              // Compute non-overlapping sequential phase durations from raw timestamps.
              // Because http-mitm-proxy pipelines internally, some events arrive out of
              // order (e.g. socket connect event fires after request starts sending).
              // We treat the phases as a sequential waterfall and derive each from the
              // gap between the ordered milestone timestamps.
              const dnsDur = (t.dnsStart != null && t.dnsEnd != null) ? Math.max(0, t.dnsEnd - t.dnsStart) : null;
              const tcpDur = (t.connectStart != null && t.connectEnd != null) ? Math.max(0, t.connectEnd - t.connectStart) : null;

              // "Request sent" = time from after DNS+TCP to when request body is fully written.
              // Use the latest of (connectEnd, dnsEnd, start) as the anchor, but if connectEnd
              // is later than requestEnd (async socket event), fall back to dnsEnd.
              const reqAnchor = t.requestEnd ?? t.start;
              const afterDnsTcp = Math.max(t.dnsEnd ?? t.start, t.connectEnd ?? t.start, t.start);
              const reqDur = Math.max(0, (reqAnchor - t.start) - (afterDnsTcp - t.start));

              // TTFB = time from request end to first response byte/headers
              const ttfbEnd = t.firstByte ?? t.responseStart ?? t.responseEnd ?? reqAnchor;
              const ttfbDur = Math.max(0, ttfbEnd - reqAnchor);

              // Download = first response byte to response complete
              const dlAnchorStart = t.firstByte ?? t.responseStart ?? ttfbEnd;
              const dlAnchorEnd = t.responseEnd ?? dlAnchorStart;
              const dlDur = Math.max(0, dlAnchorEnd - dlAnchorStart);

              const fmtDuration = (ms: number | null, zeroLabel?: string): string => {
                if (ms === null) return '—';
                if (ms === 0 && zeroLabel) return zeroLabel;
                return `${ms}ms`;
              };

              // Build waterfall bars from cumulative offsets (no overlaps, no negatives)
              type Phase = { label: string; offset: number; dur: number; color: string };
              const allPhases: Phase[] = [];
              let cursor = 0;
              if (dnsDur !== null) {
                allPhases.push({ label: 'DNS Lookup', offset: cursor, dur: dnsDur, color: 'bg-orange-400' });
                cursor += dnsDur;
              }
              if (tcpDur !== null) {
                allPhases.push({ label: 'TCP Connect', offset: cursor, dur: tcpDur, color: 'bg-amber-500' });
                cursor += tcpDur;
              }
              allPhases.push({ label: 'Request', offset: cursor, dur: reqDur, color: 'bg-green-500' });
              cursor += reqDur;
              allPhases.push({ label: 'Waiting (TTFB)', offset: cursor, dur: ttfbDur, color: 'bg-blue-500' });
              cursor += ttfbDur;
              allPhases.push({ label: 'Download', offset: cursor, dur: dlDur, color: 'bg-purple-500' });

              const bars = allPhases.filter(p => p.dur > 0);

              // Table rows: always show all measured phases with smart labels
              const noBody = statusCode === 304 || statusCode === 204 || statusCode === 301 || statusCode === 302;
              const tableRows: { label: string; color: string; value: string }[] = [];
              if (dnsDur !== null) {
                tableRows.push({ label: 'DNS Lookup', color: 'bg-orange-400', value: fmtDuration(dnsDur, 'cached') });
              }
              if (tcpDur !== null) {
                tableRows.push({ label: 'TCP Connect', color: 'bg-amber-500', value: fmtDuration(tcpDur, 'reused') });
              }
              tableRows.push({ label: 'Request sent', color: 'bg-green-500', value: fmtDuration(reqDur) });
              tableRows.push({ label: 'Waiting (TTFB)', color: 'bg-blue-500', value: fmtDuration(ttfbDur) });
              if (noBody && dlDur === 0) {
                tableRows.push({ label: 'Content download', color: 'bg-purple-500', value: 'no content' });
              } else {
                tableRows.push({ label: 'Content download', color: 'bg-purple-500', value: fmtDuration(dlDur) });
              }

              return (
                <div className="space-y-2 mt-2">
                  {bars.length > 0 && bars.map((phase, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-28 text-[11px] text-pb-text-dim text-right shrink-0">
                        {phase.label}
                      </div>
                      <div className="flex-1 h-5 bg-pb-surface rounded overflow-hidden relative">
                        <div
                          className={`absolute top-0 h-full ${phase.color} rounded opacity-70`}
                          style={{
                            left: `${(phase.offset / total) * 100}%`,
                            width: `${Math.max(1, (phase.dur / total) * 100)}%`,
                          }}
                        />
                      </div>
                      <div className="w-16 text-[11px] font-mono text-pb-text text-right shrink-0">
                        {phase.dur}ms
                      </div>
                    </div>
                  ))}

                  {/* Summary table */}
                  <div className="mt-4 border border-pb-border rounded bg-pb-surface">
                    <table className="w-full text-xs">
                      <tbody>
                        {tableRows.map((row, i) => (
                          <tr key={i} className="border-b border-pb-border">
                            <td className="px-3 py-1.5 text-pb-text-dim flex items-center gap-2">
                              <span className={`w-2 h-2 rounded-full ${row.color} inline-block`} />
                              {row.label}
                            </td>
                            <td className={`px-3 py-1.5 font-mono text-right ${
                              /^(cached|reused|no content)$/.test(row.value) ? 'text-pb-text-dim italic' : ''
                            }`}>{row.value}</td>
                          </tr>
                        ))}
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
