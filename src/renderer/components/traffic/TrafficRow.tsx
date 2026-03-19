import React from 'react';
import type { HttpFlow } from '../../../shared/types';
import type { ColumnKey } from './TrafficList';

interface Props {
  flow: HttpFlow;
  selected: boolean;
  onSelect: (id: string) => void;
  onContextMenu?: (e: React.MouseEvent, flow: HttpFlow) => void;
  visibleColumns: Set<ColumnKey>;
  /** Stable string key for memo comparison (avoids Set reference issues) */
  columnKey?: string;
}

function getMethodColor(method: string): string {
  switch (method) {
    case 'GET': return 'text-pb-success';
    case 'POST': return 'text-pb-accent';
    case 'PUT': return 'text-pb-warning';
    case 'DELETE': return 'text-pb-error';
    case 'PATCH': return 'text-pb-info';
    default: return 'text-pb-text-dim';
  }
}

function getStatusColor(status?: number): string {
  if (!status) return 'text-pb-text-dim';
  if (status < 300) return 'text-pb-success';
  if (status < 400) return 'text-pb-warning';
  return 'text-pb-error';
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(ms?: number): string {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function formatGraphQLOperation(flow: HttpFlow): string {
  if (flow.request.graphqlOperationName) {
    return flow.request.graphqlOperationName;
  }
  if (flow.request.graphqlOperationType) {
    return `${flow.request.graphqlOperationType} (anonymous)`;
  }
  if (flow.tags.includes('graphql')) {
    return 'anonymous';
  }
  return '—';
}

function getContentType(headers?: Record<string, any>): string {
  if (!headers) return '—';
  const ct = headers['content-type'] || '';
  if (ct.includes('json')) return 'JSON';
  if (ct.includes('html')) return 'HTML';
  if (ct.includes('xml')) return 'XML';
  if (ct.includes('javascript')) return 'JS';
  if (ct.includes('css')) return 'CSS';
  if (ct.includes('image')) return 'Image';
  if (ct.includes('text')) return 'Text';
  return ct.split(';')[0].split('/').pop() || '—';
}

function TrafficRowInner({ flow, selected, onSelect, onContextMenu, visibleColumns }: Props) {
  const pathPart = flow.request.url.replace(/^https?:\/\/[^/]+/, '');
  const v = visibleColumns;

  return (
    <div
      onClick={() => onSelect(flow.id)}
      onContextMenu={(e) => onContextMenu?.(e, flow)}
      className={`flex items-center h-8 px-3 text-xs cursor-pointer border-b border-pb-border/30 transition-colors
        ${selected ? 'bg-pb-accent/15 text-pb-text' : 'hover:bg-pb-surface-hover text-pb-text'}`}
    >
      {v.has('timestamp') && (
        <span className="w-20 font-mono text-pb-text-dim" title={new Date(flow.createdAt || flow.request.timestamp).toISOString()}>
          {formatTimestamp(flow.createdAt || flow.request.timestamp)}
        </span>
      )}
      {v.has('method') && (
        <span className={`w-16 font-mono font-medium ${getMethodColor(flow.request.method)}`}>
          {flow.request.method}
        </span>
      )}
      {v.has('status') && (
        <span className={`w-12 font-mono ${getStatusColor(flow.response?.statusCode)}`}>
          {flow.response?.statusCode || (
            <span className="inline-flex items-center gap-1 text-pb-text-dim" title={flow.state === 'pending' ? 'Waiting for response' : 'Pending'}>
              <span className="w-1.5 h-1.5 rounded-full bg-pb-accent animate-pulse" />
              ...
            </span>
          )}
        </span>
      )}
      {v.has('graphql') && (
        <span className={`w-32 truncate ${flow.request.graphqlOperationType ? 'text-pb-info' : 'text-pb-text-dim'}`}>
          {formatGraphQLOperation(flow)}
        </span>
      )}
      {v.has('host') && (
        <span className="w-40 truncate text-pb-text-dim" title={flow.request.host}>
          {flow.request.host}
        </span>
      )}
      {v.has('url') && (
        <span className="flex-1 ml-2 flex items-center gap-2 overflow-hidden" title={flow.request.url}>
          {flow.tags.includes('graphql') && (
            <span className="shrink-0 rounded bg-pb-info/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-pb-info">
              GQL
            </span>
          )}
          {flow.request.graphqlOperationName && (
            <span className="shrink-0 max-w-32 truncate text-pb-info" title={flow.request.graphqlOperationName}>
              {flow.request.graphqlOperationName}
            </span>
          )}
          <span className="truncate text-pb-text">
            {v.has('host') ? pathPart : (
              <>
                <span className="text-pb-text-dim">{flow.request.host}</span>
                {pathPart}
              </>
            )}
          </span>
        </span>
      )}
      {v.has('type') && (
        <span className="w-24 text-right text-pb-text-dim">
          {getContentType(flow.response?.headers)}
        </span>
      )}
      {v.has('size') && (
        <span className="w-16 text-right text-pb-text-dim">
          {formatSize(flow.response?.bodySize || 0)}
        </span>
      )}
      {v.has('time') && (
        <span className="w-16 text-right text-pb-text-dim">
          {formatDuration(flow.response?.duration)}
        </span>
      )}
    </div>
  );
}

const TrafficRow = React.memo(TrafficRowInner, (prev, next) => {
  return (
    prev.flow === next.flow &&
    prev.selected === next.selected &&
    prev.onSelect === next.onSelect &&
    prev.onContextMenu === next.onContextMenu &&
    prev.columnKey === next.columnKey
  );
});

export default TrafficRow;
