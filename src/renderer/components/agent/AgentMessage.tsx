import React from 'react';
import type { AgentMessage as AgentMessageType } from '../../../shared/types';
import MarkdownContent from './MarkdownContent';

interface Props {
  message: AgentMessageType;
}

export default function AgentMessage({ message }: Props) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg p-3 text-xs ${
          isUser
            ? 'bg-pb-accent/20 text-pb-text'
            : 'bg-pb-surface text-pb-text border border-pb-border'
        }`}
      >
        {/* Tool calls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mb-2 space-y-1">
            {message.toolCalls.map(tc => (
              <div key={tc.id} className="flex items-center gap-1.5 text-[10px] text-pb-info bg-pb-bg rounded px-2 py-1">
                <span>🔧</span>
                <span className="font-mono">{tc.name}</span>
                <span className="text-pb-text-dim">
                  {tc.status === 'complete' ? '✓' : '...'}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Content */}
        {isUser ? (
          <div className="whitespace-pre-wrap leading-relaxed">{message.content}</div>
        ) : (
          <MarkdownContent content={message.content} />
        )}

        {/* Timestamp */}
        <div className="text-[10px] text-pb-text-dim mt-1.5">
          {new Date(message.timestamp).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}
