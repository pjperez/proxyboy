import React from 'react';
import { useAppStore } from '../../stores/app';
import { useTrafficStore } from '../../stores/traffic';

export default function StatusBar() {
  const { proxyRunning, proxyPort } = useAppStore();
  const { flows } = useTrafficStore();

  const errorCount = flows.filter(f => f.response && f.response.statusCode >= 400).length;

  const toggleProxy = async () => {
    const api = window.proxyboy;
    if (!api) return;
    if (proxyRunning) {
      await api.proxy.stop();
      useAppStore.getState().setProxyRunning(false);
    } else {
      await api.proxy.start();
      useAppStore.getState().setProxyRunning(true);
    }
  };

  return (
    <div className="h-7 bg-pb-surface flex items-center px-4 border-t border-pb-border text-xs select-none">
      <button
        onClick={toggleProxy}
        className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium transition-colors
          ${proxyRunning ? 'text-pb-success hover:bg-pb-success/10' : 'text-pb-error hover:bg-pb-error/10'}`}
      >
        <span className={`w-2 h-2 rounded-full ${proxyRunning ? 'bg-pb-success' : 'bg-pb-error'}`} />
        {proxyRunning ? 'Recording' : 'Stopped'}
      </button>
      <span className="mx-3 text-pb-border">|</span>
      <span className="text-pb-text-dim">
        Port: <span className="text-pb-text">{proxyPort}</span>
      </span>
      <span className="mx-3 text-pb-border">|</span>
      <span className="text-pb-text-dim">
        Requests: <span className="text-pb-text">{flows.length}</span>
      </span>
      {errorCount > 0 && (
        <>
          <span className="mx-3 text-pb-border">|</span>
          <span className="text-pb-error">
            Errors: {errorCount}
          </span>
        </>
      )}
      <div className="flex-1" />
      <span className="text-pb-text-dim">Ctrl+Shift+A for AI</span>
    </div>
  );
}
