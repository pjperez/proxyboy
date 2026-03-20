import React, { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '../../stores/app';
import { useTrafficStore } from '../../stores/traffic';
import { exportHarFile, importHarFile, toggleProxyRecording } from '../../utils/app-actions';
import {
  THROTTLE_PROFILE_PRESETS,
  getThrottleProfileLabel,
  normalizeThrottleSettings,
  resolveThrottleProfile,
  type ThrottleProfileId,
} from '../../../shared/throttle';

export default function StatusBar() {
  const {
    proxyRunning,
    proxyPort,
    noCacheEnabled,
    throttleSettings,
    updateState,
    setNoCacheEnabled,
    setThrottleSettings,
  } = useAppStore();
  const { flows } = useTrafficStore();
  const [certInstalled, setCertInstalled] = useState<boolean | null>(null);
  const [certInstalling, setCertInstalling] = useState(false);
  const [isSystemProxy, setIsSystemProxy] = useState(false);

  const errorCount = useMemo(
    () => flows.filter(f => f.response && f.response.statusCode >= 400).length,
    [flows]
  );

  useEffect(() => {
    window.proxyboy?.proxy.getCertStatus().then((s: any) => {
      setCertInstalled(s.installed);
    });
    window.proxyboy?.proxy.getStatus().then((s: any) => {
      setIsSystemProxy(!!s?.isSystemProxy);
      setNoCacheEnabled(!!s?.noCacheEnabled);
      setThrottleSettings(normalizeThrottleSettings(s?.throttleSettings));
    });
  }, [proxyRunning, setNoCacheEnabled, setThrottleSettings]);

  const toggleProxy = async () => {
    const result = await toggleProxyRecording(window.proxyboy, proxyRunning, isSystemProxy);
    if (!result.success) {
      window.alert(result.error);
      return;
    }

    setIsSystemProxy(result.isSystemProxy);
    useAppStore.getState().setProxyRunning(result.running);
    if (result.port) {
      useAppStore.getState().setProxyPort(result.port);
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

  const toggleNoCache = async () => {
    const result = await window.proxyboy?.proxy.setNoCache(!noCacheEnabled);
    if (result?.success) {
      setNoCacheEnabled(!noCacheEnabled);
    }
  };

  const resolvedThrottleProfile = resolveThrottleProfile(throttleSettings);

  const handleThrottleChange = async (profileId: ThrottleProfileId) => {
    const nextSettings = normalizeThrottleSettings({
      ...throttleSettings,
      profileId,
    });
    const result = await window.proxyboy?.proxy.setThrottle(nextSettings);
    if (result?.success) {
      setThrottleSettings(normalizeThrottleSettings(result.throttleSettings));
      return;
    }

    window.alert(result?.error || 'Failed to update the throttling profile.');
  };

  return (
    <div className="h-7 bg-pb-surface flex items-center px-4 border-t border-pb-border text-xs select-none">
      <button
        onClick={toggleProxy}
        title={proxyRunning ? 'Stop recording (Ctrl+E)' : 'Start recording (Ctrl+E)'}
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
      <span className="mx-3 text-pb-border">|</span>
      <button
        onClick={toggleNoCache}
        className={`flex items-center gap-1 transition-colors ${
          noCacheEnabled ? 'text-pb-accent' : 'text-pb-text-dim hover:text-pb-text'
        }`}
      >
        🧊 {noCacheEnabled ? 'No Cache: ON' : 'No Cache: OFF'}
      </button>
      <span className="mx-3 text-pb-border">|</span>
      <label className={`flex items-center gap-2 ${resolvedThrottleProfile.active ? 'text-pb-accent' : 'text-pb-text-dim'}`}>
        <span>🐢 Throttle</span>
        <select
          value={throttleSettings.profileId}
          onChange={(event) => void handleThrottleChange(event.target.value as ThrottleProfileId)}
          className="bg-transparent text-pb-text border border-pb-border rounded px-2 py-0.5"
          title={resolvedThrottleProfile.description}
        >
          {THROTTLE_PROFILE_PRESETS.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.label}
            </option>
          ))}
          <option value="custom">{getThrottleProfileLabel('custom')}</option>
        </select>
      </label>
      {errorCount > 0 && (
        <>
          <span className="mx-3 text-pb-border">|</span>
          <span className="text-pb-error">
            Errors: {errorCount}
          </span>
        </>
      )}
      {updateState.supported && (updateState.checking || updateState.updateAvailable || updateState.updateDownloaded) && (
        <>
          <span className="mx-3 text-pb-border">|</span>
          {updateState.updateDownloaded ? (
            <button
              onClick={async () => {
                const result = await window.proxyboy?.app.installUpdate();
                if (!result?.success) {
                  window.alert(result?.error || 'Failed to install the downloaded update.');
                }
              }}
              className="text-pb-accent hover:text-pb-text transition-colors"
            >
              ⬆ Restart to update{updateState.latestVersion ? ` (${updateState.latestVersion})` : ''}
            </button>
          ) : updateState.updateAvailable ? (
            <span className="text-pb-accent">
              ⬇ Update downloading{updateState.latestVersion ? ` (${updateState.latestVersion})` : ''}
            </span>
          ) : (
            <span className="text-pb-text-dim">🔄 Checking for updates…</span>
          )}
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
        onClick={async () => {
          const result = await exportHarFile(window.proxyboy);
          if (!result.success && !result.canceled) {
            window.alert(result.error);
          }
        }}
        className="text-pb-text-dim hover:text-pb-text transition-colors"
        title="Export HAR (Ctrl+S)"
      >
        📤 Export
      </button>
      <span className="mx-2 text-pb-border">|</span>
      <button
        onClick={async () => {
          const result = await importHarFile(window.proxyboy);
          if (!result.success && !result.canceled) {
            window.alert(result.error);
          }
        }}
        className="text-pb-text-dim hover:text-pb-text transition-colors"
        title="Import HAR (Ctrl+I)"
      >
        📥 Import
      </button>
      <span className="mx-2 text-pb-border">|</span>
      <span className="text-pb-text-dim">? for shortcuts, Ctrl+Shift+A for AI</span>
    </div>
  );
}
