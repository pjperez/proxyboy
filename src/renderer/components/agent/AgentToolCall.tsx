import React from 'react';
import type { AgentToolCall as ToolCallType } from '../../../shared/types';

interface Props {
  toolCall: ToolCallType;
}

export default function AgentToolCall({ toolCall }: Props) {
  return (
    <div className="bg-pb-bg rounded border border-pb-border p-2 text-[10px]">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-pb-info">🔧</span>
        <span className="font-mono font-medium text-pb-info">{toolCall.name}</span>
        <span className={`ml-auto px-1.5 py-0.5 rounded text-[9px] ${
          toolCall.status === 'complete' ? 'bg-pb-success/20 text-pb-success' :
          toolCall.status === 'error' ? 'bg-pb-error/20 text-pb-error' :
          'bg-pb-warning/20 text-pb-warning'
        }`}>
          {toolCall.status}
        </span>
      </div>
      {toolCall.arguments && Object.keys(toolCall.arguments).length > 0 && (
        <pre className="text-pb-text-dim font-mono mt-1 overflow-x-auto">
          {JSON.stringify(toolCall.arguments, null, 2)}
        </pre>
      )}
    </div>
  );
}
