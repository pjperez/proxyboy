import React, { useState } from 'react';
import RequestView from './RequestView';
import ResponseView from './ResponseView';
import type { HttpFlow } from '../../../shared/types';

interface Props {
  flow: HttpFlow;
  onClose: () => void;
}

type Tab = 'request' | 'response' | 'timing';

export default function TrafficDetail({ flow, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('request');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'request', label: 'Request' },
    { id: 'response', label: 'Response' },
    { id: 'timing', label: 'Timing' },
  ];

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
        {tabs.map(t => (
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
