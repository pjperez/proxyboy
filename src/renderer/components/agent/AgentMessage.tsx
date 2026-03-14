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
            {message.toolCalls.map(tc => {
              const statusEmoji = tc.status === 'complete' ? '✅' : tc.status === 'error' ? '❌' : tc.status === 'running' ? '⏳' : '⏱';
              const statusText = tc.status === 'complete' ? 'completed' : tc.status === 'error' ? 'failed' : tc.status === 'running' ? 'running…' : 'pending';
              return (
                <div key={tc.id} className="bg-pb-bg/50 rounded p-2 mb-1 border border-pb-border/50">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px]">{statusEmoji}</span>
                    <span className="font-mono font-medium text-pb-info text-[11px]">{tc.name}</span>
                    <span className="text-pb-text-dim text-[10px]">{statusText}</span>
                  </div>
                  {tc.arguments && Object.keys(tc.arguments).length > 0 && (
                    <details className="mt-1">
                      <summary className="text-[10px] text-pb-text-dim cursor-pointer hover:text-pb-text">Arguments</summary>
                      <pre className="text-[10px] mt-1 overflow-x-auto text-pb-text-dim font-mono">
                        {JSON.stringify(tc.arguments, null, 2)}
                      </pre>
                    </details>
                  )}
                  {tc.result !== undefined && (
                    <details className="mt-1">
                      <summary className="text-[10px] text-pb-text-dim cursor-pointer hover:text-pb-text">Result</summary>
                      <pre className="text-[10px] mt-1 overflow-x-auto text-pb-text-dim font-mono">
                        {typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              );
            })}
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
