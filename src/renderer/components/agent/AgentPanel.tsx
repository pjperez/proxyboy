import React, { useRef, useEffect } from 'react';
import { useAgentStore } from '../../stores/agent';
import AgentMessage from './AgentMessage';
import MarkdownContent from './MarkdownContent';

interface Props {
  onClose: () => void;
  onDetach?: () => void;
  isDetached?: boolean;
}

export default function AgentPanel({ onClose, onDetach, isDetached }: Props) {
  const {
    messages,
    isLoading,
    currentStreamContent,
    sendMessage,
    clearMessages,
    pendingPermissions,
    autoApprove,
    draftInput,
    setAutoApprove,
    setDraftInput,
    removePendingPermission,
  } = useAgentStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentStreamContent, pendingPermissions]);

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

    const unsubPermission = api.agent.onPermissionRequest((data: any) => {
      useAgentStore.getState().addPendingPermission({
        id: data.id,
        toolName: data.toolName,
        arguments: data.arguments || {},
      });
    });

    return () => {
      unsubDelta();
      unsubTool();
      unsubPermission();
    };
  }, []);

  useEffect(() => {
    const api = (window as any).proxyboy;
    if (!api) return;
    api.agent.setAutoApprove(autoApprove);
  }, [autoApprove]);

  const handleSend = async () => {
    if (!draftInput.trim() || isLoading) return;
    const text = draftInput;
    setDraftInput('');
    await sendMessage(text);
  };

  const handleToggleAutoApprove = () => {
    const newValue = !autoApprove;
    setAutoApprove(newValue);
    const api = (window as any).proxyboy;
    if (api) {
      api.agent.setAutoApprove(newValue);
    }
  };

  const handlePermissionResponse = (id: string, approved: boolean) => {
    removePendingPermission(id);
    const api = (window as any).proxyboy;
    if (api) {
      api.agent.respondPermission(id, approved);
    }
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
      <div className={`flex items-center justify-between px-3 bg-pb-surface border-b border-pb-border ${isDetached ? 'h-10 drag-region' : 'h-10'}`}>
        <div className="flex items-center gap-2">
          <span className="text-sm">🤖</span>
          <span className="text-xs font-semibold text-pb-text">ProxyBoy AI</span>
          <span className="text-[10px] text-pb-text-dim px-1.5 py-0.5 bg-pb-bg rounded">Copilot</span>
        </div>
        <div className="flex items-center gap-1 no-drag">
          <button
            onClick={handleToggleAutoApprove}
            className={`text-xs px-1.5 py-0.5 rounded flex items-center gap-1 ${
              autoApprove
                ? 'bg-pb-warning/20 text-pb-warning'
                : 'bg-pb-success/20 text-pb-success'
            }`}
            title={autoApprove ? 'Auto-approve tools: ON (click to require permission)' : 'Ask permission: ON (click to auto-approve)'}
          >
            <span>{autoApprove ? '🔓' : '🔒'}</span>
            <span className="text-[10px]">{autoApprove ? 'Auto' : 'Ask'}</span>
          </button>
          <button
            onClick={clearMessages}
            className="text-pb-text-dim hover:text-pb-text text-xs px-1"
            title="Clear chat"
          >
            🗑
          </button>
          {!isDetached && onDetach && (
            <button
              onClick={onDetach}
              className="text-pb-text-dim hover:text-pb-text text-xs px-1"
              title="Pop out to separate window"
            >
              ⧉
            </button>
          )}
          {!isDetached && (
            <button
              onClick={onClose}
              className="text-pb-text-dim hover:text-pb-text text-lg px-1"
            >
              ✕
            </button>
          )}
        </div>
      </div>

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
                  onClick={() => { setDraftInput(prompt); }}
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

        {pendingPermissions.map(req => (
          <div key={req.id} className="bg-pb-warning/10 border border-pb-warning/30 rounded-lg p-3 text-xs">
            <div className="flex items-center gap-2 mb-2">
              <span>🔧</span>
              <span className="font-mono font-medium">{req.toolName}</span>
              <span className="text-pb-text-dim">wants to execute</span>
            </div>
            {Object.keys(req.arguments).length > 0 && (
              <pre className="bg-pb-bg rounded p-2 mb-2 text-[10px] overflow-x-auto">
                {JSON.stringify(req.arguments, null, 2)}
              </pre>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => handlePermissionResponse(req.id, true)}
                className="px-3 py-1 bg-pb-success/20 text-pb-success rounded hover:bg-pb-success/30 transition-colors"
              >
                ✅ Approve
              </button>
              <button
                onClick={() => handlePermissionResponse(req.id, false)}
                className="px-3 py-1 bg-pb-error/20 text-pb-error rounded hover:bg-pb-error/30 transition-colors"
              >
                ❌ Deny
              </button>
            </div>
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-pb-border">
        <div className="flex gap-2">
          <textarea
            value={draftInput}
            onChange={(e) => setDraftInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your traffic..."
            rows={1}
            className="flex-1 bg-pb-surface border border-pb-border rounded-lg px-3 py-2 text-xs text-pb-text placeholder-pb-text-dim resize-none focus:outline-none focus:border-pb-accent"
          />
          <button
            onClick={handleSend}
            disabled={!draftInput.trim() || isLoading}
            className="px-3 py-2 bg-pb-accent text-white text-xs rounded-lg font-medium hover:bg-pb-accent/80 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
