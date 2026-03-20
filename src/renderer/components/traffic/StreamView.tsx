import React, { useMemo } from 'react';
import type { HttpFlow, SseEvent, WebSocketFrame } from '../../../shared/types';

function tryFormatJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function formatFrame(frame: WebSocketFrame): string {
  if (frame.isBase64) {
    return `[binary ${frame.byteLength} bytes]\n${frame.body}`;
  }
  return tryFormatJson(frame.body);
}

function formatEvent(event: SseEvent): string {
  return tryFormatJson(event.data);
}

export default function StreamView({ flow }: { flow: HttpFlow }) {
  const title = flow.streamKind === 'websocket' ? 'WebSocket Frames' : 'Server-Sent Events';
  const items = useMemo(() => {
    if (flow.streamKind === 'websocket') {
      return flow.websocketFrames ?? [];
    }
    return flow.sseEvents ?? [];
  }, [flow]);

  if (items.length === 0) {
    return (
      <div className="rounded border border-pb-border bg-pb-surface p-4 text-sm text-pb-text-dim">
        {flow.streamOpen ? `Waiting for ${title.toLowerCase()}…` : `No ${title.toLowerCase()} were captured.`}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-pb-text-dim">
        {title} • {items.length} captured • {flow.streamOpen ? 'live' : 'closed'}
      </div>
      <div className="space-y-3">
        {flow.streamKind === 'websocket' && (flow.websocketFrames ?? []).map((frame) => (
          <section key={frame.id} className="rounded border border-pb-border bg-pb-surface overflow-hidden">
            <div className="flex items-center gap-2 border-b border-pb-border px-3 py-2 text-xs">
              <span className={`rounded px-1.5 py-0.5 font-semibold uppercase tracking-wide ${
                frame.direction === 'server-to-client'
                  ? 'bg-pb-info/15 text-pb-info'
                  : 'bg-pb-accent/15 text-pb-accent'
              }`}>
                {frame.direction === 'server-to-client' ? 'Server' : 'Client'}
              </span>
              <span className="text-pb-text">{frame.frameType}</span>
              <span className="text-pb-text-dim">{frame.byteLength} bytes</span>
              {frame.truncated && <span className="text-pb-warning">truncated</span>}
            </div>
            <pre className="whitespace-pre-wrap break-all p-3 text-xs font-mono text-pb-text">
              {formatFrame(frame)}
            </pre>
          </section>
        ))}
        {flow.streamKind === 'sse' && (flow.sseEvents ?? []).map((event) => (
          <section key={event.id} className="rounded border border-pb-border bg-pb-surface overflow-hidden">
            <div className="flex items-center gap-2 border-b border-pb-border px-3 py-2 text-xs">
              <span className="rounded bg-pb-success/15 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-pb-success">
                {event.event || 'message'}
              </span>
              {event.retry != null && <span className="text-pb-text-dim">retry {event.retry}ms</span>}
              <span className="text-pb-text-dim">{event.byteLength} bytes</span>
              {event.truncated && <span className="text-pb-warning">truncated</span>}
            </div>
            <pre className="whitespace-pre-wrap break-all p-3 text-xs font-mono text-pb-text">
              {formatEvent(event)}
            </pre>
          </section>
        ))}
      </div>
    </div>
  );
}
