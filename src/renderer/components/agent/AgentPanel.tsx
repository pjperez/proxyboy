import React, { useState, useRef, useEffect } from 'react';
import { useAgentStore } from '../../stores/agent';
import AgentMessage from './AgentMessage';
import MarkdownContent from './MarkdownContent';

interface Props {
  onClose: () => void;
  onDetach?: () => void;
  isDetached?: boolean;
}

export default function AgentPanel({ onClose, onDetach, isDetached }: Props) {
  const { messages, isLoading, currentStreamContent, sendMessage, clearMessages } = useAgentStore();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentStreamContent]);

  // Wire up streaming events
  useEffect(() => {
    const api = (window as any).proxyboy;
    if (!api) return;

    const unsubDelta = api.agent.onMessageDelta((data: any) => {
      useAgentStore.getState().appendStreamContent(data.content);
    });

    const unsubTool = api.agent.onToolCall((data: any) => {
      useAgentStore.getState().addToolCall({
        id: Date.now().toString(),
        name: data.name,
        arguments: data.args,
        status: 'complete',
      });
    });

    return () => {
      unsubDelta();
      unsubTool();
    };
  }, []);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    const text = input;
    setInput('');
    await sendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const quickPrompts = [
    'Show recent errors',
    'Analyze slow requests',
    'What\'s the traffic summary?',
  ];

  return (
    <div className="flex flex-col h-full bg-pb-bg">
      {/* Header */}
      {!isDetached && (
        <div className="flex items-center justify-between px-3 h-10 bg-pb-surface border-b border-pb-border">
          <div className="flex items-center gap-2">
            <span className="text-sm">🤖</span>
            <span className="text-xs font-semibold text-pb-text">ProxyBoy AI</span>
            <span className="text-[10px] text-pb-text-dim px-1.5 py-0.5 bg-pb-bg rounded">Copilot</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={clearMessages}
              className="text-pb-text-dim hover:text-pb-text text-xs px-1"
              title="Clear chat"
            >
              🗑
            </button>
            {onDetach && (
              <button
                onClick={onDetach}
                className="text-pb-text-dim hover:text-pb-text text-xs px-1"
                title="Pop out"
              >
                ⧉
              </button>
            )}
            <button
              onClick={onClose}
              className="text-pb-text-dim hover:text-pb-text text-lg px-1"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="text-3xl mb-3">🤖</div>
            <div className="text-sm font-medium text-pb-text mb-1">ProxyBoy AI Assistant</div>
            <div className="text-xs text-pb-text-dim mb-4 max-w-xs">
              I can analyze your traffic, find errors, create rules, and help debug network issues.
            </div>
            <div className="space-y-2 w-full max-w-xs">
              {quickPrompts.map(prompt => (
                <button
                  key={prompt}
                  onClick={() => { setInput(prompt); }}
                  className="w-full px-3 py-2 text-xs text-left bg-pb-surface rounded-lg border border-pb-border hover:border-pb-accent/40 hover:bg-pb-surface-hover transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <AgentMessage key={msg.id} message={msg} />
        ))}

        {isLoading && currentStreamContent && (
          <div className="bg-pb-surface rounded-lg p-3 text-xs text-pb-text">
            <MarkdownContent content={currentStreamContent} />
            <span className="inline-block w-1.5 h-3 bg-pb-accent ml-0.5 animate-pulse" />
          </div>
        )}

        {isLoading && !currentStreamContent && (
          <div className="flex items-center gap-2 text-xs text-pb-text-dim">
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 bg-pb-accent rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 bg-pb-accent rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 bg-pb-accent rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            Thinking...
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-pb-border">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your traffic..."
            rows={1}
            className="flex-1 bg-pb-surface border border-pb-border rounded-lg px-3 py-2 text-xs text-pb-text placeholder-pb-text-dim resize-none focus:outline-none focus:border-pb-accent"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="px-3 py-2 bg-pb-accent text-white text-xs rounded-lg font-medium hover:bg-pb-accent/80 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
