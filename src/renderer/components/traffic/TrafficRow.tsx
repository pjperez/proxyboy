import React from 'react';
import type { HttpFlow } from '../../../shared/types';

interface Props {
  flow: HttpFlow;
  selected: boolean;
  onClick: () => void;
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

export default function TrafficRow({ flow, selected, onClick }: Props) {
  const pathPart = flow.request.url.replace(/^https?:\/\/[^/]+/, '');

  return (
    <div
      onClick={onClick}
      className={`flex items-center h-8 px-3 text-xs cursor-pointer border-b border-pb-border/30 transition-colors
        ${selected ? 'bg-pb-accent/15 text-pb-text' : 'hover:bg-pb-surface-hover text-pb-text'}`}
    >
      <span className={`w-16 font-mono font-medium ${getMethodColor(flow.request.method)}`}>
        {flow.request.method}
      </span>
      <span className={`w-12 font-mono ${getStatusColor(flow.response?.statusCode)}`}>
        {flow.response?.statusCode || '...'}
      </span>
      <span className="flex-1 ml-2 truncate text-pb-text" title={flow.request.url}>
        <span className="text-pb-text-dim">{flow.request.host}</span>
        {pathPart}
      </span>
      <span className="w-24 text-right text-pb-text-dim">
        {getContentType(flow.response?.headers)}
      </span>
      <span className="w-16 text-right text-pb-text-dim">
        {formatSize(flow.response?.bodySize || 0)}
      </span>
      <span className="w-16 text-right text-pb-text-dim">
        {formatDuration(flow.response?.duration)}
      </span>
    </div>
  );
}
