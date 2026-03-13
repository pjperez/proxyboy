import React from 'react';
import TrafficRow from './TrafficRow';
import type { HttpFlow } from '../../../shared/types';

interface Props {
  flows: HttpFlow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function TrafficList({ flows, selectedId, onSelect }: Props) {
  if (flows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-pb-text-dim">
        <div className="text-4xl mb-4">📡</div>
        <div className="text-lg font-medium">No traffic captured</div>
        <div className="text-sm mt-1">Start the proxy and make some requests</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center h-8 px-3 bg-pb-surface border-b border-pb-border text-xs font-medium text-pb-text-dim">
        <span className="w-16">Method</span>
        <span className="w-12">Status</span>
        <span className="flex-1 ml-2">URL</span>
        <span className="w-24 text-right">Type</span>
        <span className="w-16 text-right">Size</span>
        <span className="w-16 text-right">Time</span>
      </div>
      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {flows.map(flow => (
          <TrafficRow
            key={flow.id}
            flow={flow}
            selected={flow.id === selectedId}
            onClick={() => onSelect(flow.id)}
          />
        ))}
      </div>
    </div>
  );
}
