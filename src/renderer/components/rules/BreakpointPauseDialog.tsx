import React from 'react';
import type { HttpFlow } from '../../../shared/types';

interface Props {
  flowId: string;
  flow: HttpFlow;
  phase: 'request' | 'response';
  onResume: (flowId: string, action: 'forward' | 'drop') => void;
}

function formatHeaders(headers?: Record<string, any>): string {
  if (!headers) return '';
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
    .join('\n');
}

function formatBody(body?: Buffer | string): string {
  if (!body) return '(empty)';
  if (typeof body !== 'string') {
    const sample = body.subarray(0, Math.min(512, body.length));
    let nonPrintable = 0;
    for (let i = 0; i < sample.length; i++) {
      const b = sample[i];
      if (b === 0 || (b < 32 && b !== 9 && b !== 10 && b !== 13)) nonPrintable++;
    }
    if (nonPrintable > sample.length * 0.1) {
      return `[binary data ${body.length} bytes]`;
    }
  }
  const text = typeof body === 'string' ? body : body.toString('utf8');
  if (text.length > 2000) return text.slice(0, 2000) + '\n…truncated';
  return text;
}

export default function BreakpointPauseDialog({ flowId, flow, phase, onResume }: Props) {
  const statusCode = flow.response?.statusCode;
  const reqHeaders = formatHeaders(flow.request?.headers);
  const resHeaders = formatHeaders(flow.response?.headers);
  const reqBody = formatBody(flow.request?.body);
  const resBody = formatBody(flow.response?.body);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm bg-black/50">
      <div className="bg-pb-surface border border-pb-border rounded-xl shadow-2xl w-[640px] max-h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-pb-border">
          <div className="flex items-center gap-3">
            <span className="text-pb-warning text-lg">⏸</span>
            <div>
              <h2 className="text-sm font-semibold text-pb-text">Breakpoint Hit</h2>
              <span className="text-xs text-pb-text-dim">
                Phase: <span className="text-pb-accent font-medium">{phase}</span>
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono text-pb-text">
            <span className="text-pb-accent font-medium">{flow.request?.method}</span>
            {statusCode && (
              <span className={statusCode >= 400 ? 'text-pb-error' : statusCode >= 300 ? 'text-pb-warning' : 'text-pb-success'}>
                {statusCode}
              </span>
            )}
          </div>
        </div>

        {/* URL */}
        <div className="px-5 py-2 border-b border-pb-border">
          <p className="text-xs font-mono text-pb-text truncate" title={flow.request?.url}>
            {flow.request?.url}
          </p>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          <div className="rounded-lg border border-pb-border bg-pb-bg/50 px-3 py-2 text-[11px] text-pb-text-dim">
            Inspection-only breakpoint: you can review the captured request/response here, then
            <span className="text-pb-text"> Forward </span>
            or
            <span className="text-pb-text"> Drop</span>.
            Request/response editing is not implemented yet.
          </div>

          {/* Request headers */}
          <section>
            <h3 className="text-xs font-semibold text-pb-text-dim mb-1">Request Headers</h3>
            <pre className="text-xs font-mono text-pb-text bg-pb-bg rounded p-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-all">
              {reqHeaders || '(none)'}
            </pre>
          </section>

          {/* Request body */}
          {phase === 'request' && (
            <section>
              <h3 className="text-xs font-semibold text-pb-text-dim mb-1">Request Body</h3>
              <pre className="text-xs font-mono text-pb-text bg-pb-bg rounded p-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-all">
                {reqBody}
              </pre>
            </section>
          )}

          {/* Response headers */}
          {phase === 'response' && flow.response && (
            <>
              <section>
                <h3 className="text-xs font-semibold text-pb-text-dim mb-1">Response Headers</h3>
                <pre className="text-xs font-mono text-pb-text bg-pb-bg rounded p-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-all">
                  {resHeaders || '(none)'}
                </pre>
              </section>
              <section>
                <h3 className="text-xs font-semibold text-pb-text-dim mb-1">Response Body</h3>
                <pre className="text-xs font-mono text-pb-text bg-pb-bg rounded p-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-all">
                  {resBody}
                </pre>
              </section>
            </>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-pb-border">
          <button
            onClick={() => onResume(flowId, 'drop')}
            className="px-4 py-1.5 rounded-lg text-xs font-medium text-pb-error border border-pb-error/30 hover:bg-pb-error/10 transition-colors"
          >
            ✕ Drop
          </button>
          <button
            onClick={() => onResume(flowId, 'forward')}
            className="px-4 py-1.5 rounded-lg text-xs font-medium text-pb-bg bg-pb-accent hover:bg-pb-accent/90 transition-colors"
          >
            ▶ Forward
          </button>
        </div>
      </div>
    </div>
  );
}
