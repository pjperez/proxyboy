import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../stores/app';
import { useTrafficStore } from '../../stores/traffic';

export default function StatusBar() {
  const { proxyRunning, proxyPort } = useAppStore();
  const { flows } = useTrafficStore();
  const [certInstalled, setCertInstalled] = useState<boolean | null>(null);
  const [certInstalling, setCertInstalling] = useState(false);
  const [isSystemProxy, setIsSystemProxy] = useState(false);

  const errorCount = flows.filter(f => f.response && f.response.statusCode >= 400).length;

  useEffect(() => {
    window.proxyboy?.proxy.getCertStatus().then((s: any) => {
      setCertInstalled(s.installed);
    });
    if (proxyRunning) {
      window.proxyboy?.proxy.getStatus().then((s: any) => {
        setIsSystemProxy(!!s?.isSystemProxy);
      });
    } else {
      setIsSystemProxy(false);
    }
  }, [proxyRunning]);

  const toggleProxy = async () => {
    const api = window.proxyboy;
    if (!api) return;
    if (proxyRunning) {
      if (isSystemProxy) {
        await api.proxy.setSystemProxy(false);
        setIsSystemProxy(false);
      }
      await api.proxy.stop();
      useAppStore.getState().setProxyRunning(false);
    } else {
      const result = await api.proxy.start();
      useAppStore.getState().setProxyRunning(true);
      if (result?.port) {
        useAppStore.getState().setProxyPort(result.port);
      }
    }
  };

  const installCert = async () => {
    setCertInstalling(true);
    try {
      const result = await window.proxyboy?.proxy.installCert();
      if (result?.success) {
        setCertInstalled(true);
      }
    } finally {
      setCertInstalling(false);
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
      {proxyRunning && certInstalled === false && (
        <>
          <span className="mx-3 text-pb-border">|</span>
          <button
            onClick={installCert}
            disabled={certInstalling}
            className="text-pb-warning hover:text-pb-accent transition-colors"
          >
            {certInstalling ? 'Installing...' : '⚠ Install HTTPS Certificate'}
          </button>
        </>
      )}
      {proxyRunning && (
        <>
          <span className="mx-3 text-pb-border">|</span>
          <button
            onClick={async () => {
              const newState = !isSystemProxy;
              const result = await window.proxyboy?.proxy.setSystemProxy(newState);
              if (result?.success) setIsSystemProxy(newState);
            }}
            className={`flex items-center gap-1 transition-colors ${
              isSystemProxy ? 'text-pb-accent' : 'text-pb-text-dim hover:text-pb-text'
            }`}
          >
            🌐 {isSystemProxy ? 'System Proxy: ON' : 'System Proxy: OFF'}
          </button>
        </>
      )}
      <div className="flex-1" />
      <button
        onClick={() => window.proxyboy?.app.exportHar()}
        className="text-pb-text-dim hover:text-pb-text transition-colors"
        title="Export HAR"
      >
        📤 Export
      </button>
      <span className="mx-2 text-pb-border">|</span>
      <button
        onClick={async () => {
          await window.proxyboy?.app.importHar();
        }}
        className="text-pb-text-dim hover:text-pb-text transition-colors"
        title="Import HAR"
      >
        📥 Import
      </button>
      <span className="mx-2 text-pb-border">|</span>
      <span className="text-pb-text-dim">Ctrl+Shift+A for AI</span>
    </div>
  );
}
