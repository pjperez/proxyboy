import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../stores/app';
import type { TrafficRowColorMode } from '../../utils/traffic-row-colors';
import { resolveThemePreference } from '../../utils/theme';
import {
  THROTTLE_PROFILE_PRESETS,
  normalizeCustomThrottleProfile,
  normalizeThrottleSettings,
  resolveThrottleProfile,
  type ThrottleProfileId,
} from '../../../shared/throttle';
import {
  DEFAULT_UPSTREAM_PROXY_SETTINGS,
  normalizeUpstreamProxySettings,
  type UpstreamProxySettings,
  type UpstreamProxyType,
} from '../../../shared/upstream-proxy';

export default function SettingsPanel() {
  const {
    proxyPort,
    theme,
    noCacheEnabled,
    throttleSettings,
    trafficRowColorMode,
    setNoCacheEnabled,
    setThrottleSettings,
    setTheme,
    setTrafficRowColorMode,
  } = useAppStore();
  const [autoStart, setAutoStart] = useState(() =>
    localStorage.getItem('proxyboy-auto-start') === 'true'
  );
  const [certStatus, setCertStatus] = useState<'checking' | 'installed' | 'not-installed'>('checking');
  const [installing, setInstalling] = useState(false);
  const [dnsMode, setDnsMode] = useState<'system' | 'custom'>('system');
  const [dnsServers, setDnsServers] = useState('');
  const [dnsApplied, setDnsApplied] = useState(false);
  const [dnsError, setDnsError] = useState<string | null>(null);
  const [throttleDraft, setThrottleDraft] = useState(() => throttleSettings.customProfile);
  const [throttleError, setThrottleError] = useState<string | null>(null);
  const [upstreamProxyDraft, setUpstreamProxyDraft] = useState<UpstreamProxySettings>(DEFAULT_UPSTREAM_PROXY_SETTINGS);
  const [upstreamBypassDraft, setUpstreamBypassDraft] = useState('');
  const [upstreamApplied, setUpstreamApplied] = useState(false);
  const [upstreamError, setUpstreamError] = useState<string | null>(null);

  useEffect(() => {
    window.proxyboy?.proxy.getCertStatus().then((status: { installed: boolean }) => {
      setCertStatus(status.installed ? 'installed' : 'not-installed');
    }).catch(() => setCertStatus('not-installed'));

    // Load DNS config
    window.proxyboy?.dns.getConfig().then((config: { mode: string; servers: string[] }) => {
      if (config.mode === 'custom') {
        setDnsMode('custom');
        setDnsServers(config.servers.join(', '));
      }
    }).catch(() => {});

    window.proxyboy?.proxy.getStatus().then((status: { upstreamProxySettings?: UpstreamProxySettings }) => {
      const normalizedSettings = normalizeUpstreamProxySettings(status.upstreamProxySettings);
      setUpstreamProxyDraft(normalizedSettings);
      setUpstreamBypassDraft(normalizedSettings.bypassPatterns.join(', '));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    setThrottleDraft(throttleSettings.customProfile);
  }, [throttleSettings]);

  const handleAutoStartToggle = () => {
    const next = !autoStart;
    setAutoStart(next);
    localStorage.setItem('proxyboy-auto-start', String(next));
  };

  const handleNoCacheToggle = async () => {
    const next = !noCacheEnabled;
    const result = await window.proxyboy?.proxy.setNoCache(next);
    if (result?.success) {
      setNoCacheEnabled(next);
    }
  };

  const handleInstallCert = async () => {
    setInstalling(true);
    try {
      await window.proxyboy?.proxy.installCert();
      setCertStatus('installed');
    } catch {
      setCertStatus('not-installed');
    } finally {
      setInstalling(false);
    }
  };

  const applyThrottleSettings = async (nextProfileId: ThrottleProfileId, customProfile = throttleDraft) => {
    const nextSettings = normalizeThrottleSettings({
      profileId: nextProfileId,
      customProfile,
    });

    const result = await window.proxyboy?.proxy.setThrottle(nextSettings);
    if (result?.success) {
      setThrottleSettings(normalizeThrottleSettings(result.throttleSettings));
      setThrottleDraft(normalizeThrottleSettings(result.throttleSettings).customProfile);
      setThrottleError(null);
      return;
    }

    setThrottleError(result?.error || 'Failed to update the throttling profile.');
  };

  const handleDnsModeChange = async (mode: 'system' | 'custom') => {
    setDnsMode(mode);
    setDnsApplied(false);
    setDnsError(null);
    if (mode === 'system') {
      setDnsServers('');
      const result = await window.proxyboy?.dns.setServers([]);
      if (result?.success) {
        setDnsApplied(true);
        setTimeout(() => setDnsApplied(false), 2000);
      } else {
        setDnsError(result?.error || 'Failed to switch back to system DNS');
      }
    }
  };

  const handleApplyDns = async () => {
    const servers = dnsServers
      .split(/[,\s]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
    setDnsError(null);
    const result = await window.proxyboy?.dns.setServers(servers);
    if (result?.success) {
      setDnsApplied(true);
      setTimeout(() => setDnsApplied(false), 2000);
      return;
    }
    setDnsApplied(false);
    setDnsError(result?.error || 'Failed to apply DNS servers');
  };

  const handleClearDnsCache = () => {
    window.proxyboy?.dns.clearCache();
  };

  const handleApplyUpstreamProxy = async () => {
    const normalizedSettings = normalizeUpstreamProxySettings({
      ...upstreamProxyDraft,
      bypassPatterns: upstreamBypassDraft
        .split(/[,\n]+/)
        .map((pattern) => pattern.trim())
        .filter((pattern) => pattern.length > 0),
    });

    setUpstreamApplied(false);
    setUpstreamError(null);

    if (normalizedSettings.enabled && !normalizedSettings.host) {
      setUpstreamError('Enter an upstream proxy host before enabling proxy chaining.');
      return;
    }

    const result = await window.proxyboy?.proxy.setUpstreamProxy(normalizedSettings);
    if (result?.success) {
      const nextSettings = normalizeUpstreamProxySettings(result.upstreamProxySettings);
      setUpstreamProxyDraft(nextSettings);
      setUpstreamBypassDraft(nextSettings.bypassPatterns.join(', '));
      setUpstreamApplied(true);
      setTimeout(() => setUpstreamApplied(false), 2000);
      return;
    }

    setUpstreamError(result?.error || 'Failed to update the upstream proxy settings.');
  };

  const resolvedTheme = resolveThemePreference(theme);
  const resolvedThrottleProfile = resolveThrottleProfile(throttleSettings);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <h1 className="text-xl font-semibold text-pb-text mb-6">Settings</h1>

      {/* Proxy Settings */}
      <Section title="Proxy Settings">
        <Row label="Port">
          <div className="flex items-center gap-3">
            <span className="bg-pb-bg border border-pb-border rounded px-3 py-1.5 text-sm text-pb-text font-mono">
              {proxyPort}
            </span>
            <span className="text-xs text-pb-text-dim">Restart required to change</span>
          </div>
        </Row>
        <Row label="Auto-start proxy on launch">
          <Toggle checked={autoStart} onChange={handleAutoStartToggle} />
        </Row>
        <Row label="Disable caching for future requests">
          <Toggle checked={noCacheEnabled} onChange={handleNoCacheToggle} />
        </Row>
        <Row label="Network throttling">
          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap justify-end gap-2">
              {THROTTLE_PROFILE_PRESETS.map((profile) => (
                <OptionButton
                  key={profile.id}
                  label={profile.label}
                  active={throttleSettings.profileId === profile.id}
                  onClick={() => void applyThrottleSettings(profile.id)}
                />
              ))}
              <OptionButton
                label="Custom"
                active={throttleSettings.profileId === 'custom'}
                onClick={() => void applyThrottleSettings('custom')}
              />
            </div>
            <span className="text-xs text-pb-text-dim max-w-md text-right">
              {resolvedThrottleProfile.description}
            </span>
          </div>
        </Row>
        <Row label="Custom throttle">
          <div className="flex flex-col items-end gap-2">
            <div className="grid grid-cols-3 gap-2">
              <NumberField
                label="Download kbps"
                value={throttleDraft.downloadKbps}
                onChange={(value) => setThrottleDraft((current) => normalizeCustomThrottleProfile({
                  ...current,
                  downloadKbps: value,
                }))}
              />
              <NumberField
                label="Upload kbps"
                value={throttleDraft.uploadKbps}
                onChange={(value) => setThrottleDraft((current) => normalizeCustomThrottleProfile({
                  ...current,
                  uploadKbps: value,
                }))}
              />
              <NumberField
                label="Latency ms"
                value={throttleDraft.latencyMs}
                onChange={(value) => setThrottleDraft((current) => normalizeCustomThrottleProfile({
                  ...current,
                  latencyMs: value,
                }))}
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void applyThrottleSettings('custom')}
                className="px-3 py-1.5 rounded text-sm font-medium bg-pb-accent text-pb-bg hover:bg-pb-accent/80"
              >
                Apply Custom Profile
              </button>
              <span className="text-xs text-pb-text-dim">Applies to all proxied traffic.</span>
              {throttleError && <span className="text-xs text-pb-error">{throttleError}</span>}
            </div>
          </div>
        </Row>
        <Row label="Upstream proxy / chaining">
          <div className="flex flex-col items-end gap-2">
            <Toggle
              checked={upstreamProxyDraft.enabled}
              onChange={() => {
                setUpstreamProxyDraft((current) => ({ ...current, enabled: !current.enabled }));
                setUpstreamApplied(false);
                setUpstreamError(null);
              }}
            />
            <span className="text-xs text-pb-text-dim max-w-md text-right">
              Route outbound requests through an HTTP or SOCKS5 proxy before they reach the origin server.
            </span>
          </div>
        </Row>
        <Row label="Proxy type">
          <div className="flex gap-2">
            {(['http', 'socks5'] as const).map((type) => (
              <OptionButton
                key={type}
                label={type === 'http' ? 'HTTP' : 'SOCKS5'}
                active={upstreamProxyDraft.type === type}
                onClick={() => {
                  setUpstreamProxyDraft((current) => ({ ...current, type: type as UpstreamProxyType }));
                  setUpstreamApplied(false);
                  setUpstreamError(null);
                }}
              />
            ))}
          </div>
        </Row>
        <Row label="Proxy endpoint">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={upstreamProxyDraft.host}
              onChange={(event) => {
                setUpstreamProxyDraft((current) => ({ ...current, host: event.target.value }));
                setUpstreamApplied(false);
                setUpstreamError(null);
              }}
              placeholder="proxy.example.com"
              className="bg-pb-bg border border-pb-border rounded px-3 py-1.5 text-sm text-pb-text font-mono w-56 focus:outline-none focus:border-pb-accent"
            />
            <input
              type="number"
              value={upstreamProxyDraft.port}
              onChange={(event) => {
                setUpstreamProxyDraft((current) => normalizeUpstreamProxySettings({
                  ...current,
                  port: Number(event.target.value),
                }));
                setUpstreamApplied(false);
                setUpstreamError(null);
              }}
              className="bg-pb-bg border border-pb-border rounded px-3 py-1.5 text-sm text-pb-text font-mono w-24 focus:outline-none focus:border-pb-accent"
            />
          </div>
        </Row>
        <Row label="Authentication">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={upstreamProxyDraft.username}
              onChange={(event) => {
                setUpstreamProxyDraft((current) => ({ ...current, username: event.target.value }));
                setUpstreamApplied(false);
                setUpstreamError(null);
              }}
              placeholder="Username (optional)"
              className="bg-pb-bg border border-pb-border rounded px-3 py-1.5 text-sm text-pb-text w-44 focus:outline-none focus:border-pb-accent"
            />
            <input
              type="password"
              value={upstreamProxyDraft.password}
              onChange={(event) => {
                setUpstreamProxyDraft((current) => ({ ...current, password: event.target.value }));
                setUpstreamApplied(false);
                setUpstreamError(null);
              }}
              placeholder="Password (optional)"
              className="bg-pb-bg border border-pb-border rounded px-3 py-1.5 text-sm text-pb-text w-44 focus:outline-none focus:border-pb-accent"
            />
          </div>
        </Row>
        <Row label="Bypass patterns">
          <div className="flex flex-col items-end gap-2">
            <textarea
              value={upstreamBypassDraft}
              onChange={(event) => {
                setUpstreamBypassDraft(event.target.value);
                setUpstreamApplied(false);
                setUpstreamError(null);
              }}
              rows={3}
              placeholder="localhost, 127.0.0.1, *.internal.example"
              className="bg-pb-bg border border-pb-border rounded px-3 py-2 text-sm text-pb-text font-mono w-80 resize-y focus:outline-none focus:border-pb-accent"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={() => void handleApplyUpstreamProxy()}
                className="px-3 py-1.5 rounded text-sm font-medium bg-pb-accent text-pb-bg hover:bg-pb-accent/80"
              >
                Apply Upstream Proxy
              </button>
              {upstreamApplied && <span className="text-xs text-pb-success">✓</span>}
              {upstreamError && <span className="text-xs text-pb-error">{upstreamError}</span>}
            </div>
            <span className="text-xs text-pb-text-dim max-w-md text-right">
              Match hosts or full URLs with glob patterns. Matching requests connect directly instead of using the upstream proxy.
            </span>
          </div>
        </Row>
      </Section>

      {/* HTTPS/SSL */}
      <Section title="HTTPS / SSL">
        <Row label="Certificate status">
          <CertBadge status={certStatus} />
        </Row>
        <Row label="Install CA certificate">
          <button
            onClick={handleInstallCert}
            disabled={installing || certStatus === 'installed'}
            className="px-4 py-1.5 rounded text-sm font-medium transition-colors
              bg-pb-accent text-pb-bg hover:bg-pb-accent/80
              disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {installing ? 'Installing…' : certStatus === 'installed' ? 'Installed' : 'Install Certificate'}
          </button>
        </Row>
        <Row label="Pinning troubleshooting">
          <div className="max-w-md text-right text-xs text-pb-text-dim">
            Some apps reject ProxyBoy&apos;s local CA even after it is installed because they pin certificates.
            <div className="mt-1 space-y-1">
              <div>Android debug builds: trust a debug network security config or use a debug-only bypass.</div>
              <div>iOS simulators: prefer debug builds or Frida-style instrumentation when pinning is enforced.</div>
              <div>Desktop apps: look for developer flags, debug certificates, or test-specific trust overrides.</div>
            </div>
            <a
              href="https://github.com/pjperez/proxyboy#troubleshooting-ssl"
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex text-pb-accent hover:underline"
            >
              Read the full SSL troubleshooting guide
            </a>
          </div>
        </Row>
      </Section>

      {/* DNS */}
      <Section title="DNS">
        <Row label="DNS resolver">
          <div className="flex gap-2">
            <button
              onClick={() => handleDnsModeChange('system')}
              className={`px-3 py-1.5 rounded text-sm transition-colors ${
                dnsMode === 'system'
                  ? 'bg-pb-accent/20 text-pb-accent border border-pb-accent/40'
                  : 'text-pb-text border border-pb-border hover:bg-pb-surface-hover'
              }`}
            >
              System DNS
            </button>
            <button
              onClick={() => handleDnsModeChange('custom')}
              className={`px-3 py-1.5 rounded text-sm transition-colors ${
                dnsMode === 'custom'
                  ? 'bg-pb-accent/20 text-pb-accent border border-pb-accent/40'
                  : 'text-pb-text border border-pb-border hover:bg-pb-surface-hover'
              }`}
            >
              Custom
            </button>
          </div>
        </Row>
        {dnsMode === 'custom' && (
          <Row label="DNS servers">
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={dnsServers}
                  onChange={(e) => {
                    setDnsServers(e.target.value);
                    setDnsApplied(false);
                    setDnsError(null);
                  }}
                  placeholder="8.8.8.8, 1.1.1.1"
                  className="bg-pb-bg border border-pb-border rounded px-3 py-1.5 text-sm text-pb-text font-mono w-56
                    focus:outline-none focus:border-pb-accent"
                />
                <button
                  onClick={handleApplyDns}
                  className="px-3 py-1.5 rounded text-sm font-medium bg-pb-accent text-pb-bg hover:bg-pb-accent/80"
                >
                  Apply
                </button>
                {dnsApplied && <span className="text-xs text-pb-success">✓</span>}
              </div>
              {dnsError && <span className="text-xs text-pb-error">{dnsError}</span>}
            </div>
          </Row>
        )}
        <Row label="DNS cache">
          <button
            onClick={handleClearDnsCache}
            className="px-3 py-1.5 rounded text-sm text-pb-text border border-pb-border hover:bg-pb-surface-hover"
          >
            Clear cache
          </button>
        </Row>
      </Section>

      {/* Appearance */}
      <Section title="Appearance">
        <Row label="Theme">
          <div className="flex flex-col items-end gap-2">
            <div className="flex gap-2">
              <OptionButton
                label="Dark"
                active={theme === 'dark'}
                onClick={() => setTheme('dark')}
              />
              <OptionButton
                label="Light"
                active={theme === 'light'}
                onClick={() => setTheme('light')}
              />
              <OptionButton
                label="System"
                active={theme === 'system'}
                onClick={() => setTheme('system')}
              />
            </div>
            <span className="text-xs text-pb-text-dim">
              System follows Windows appearance. Currently using {resolvedTheme}.
            </span>
          </div>
        </Row>
        <Row label="Traffic row colors">
          <div className="flex gap-2">
            <OptionButton
              label="Off"
              active={trafficRowColorMode === 'off'}
              onClick={() => setTrafficRowColorMode('off')}
            />
            <OptionButton
              label="By Status"
              active={trafficRowColorMode === 'status'}
              onClick={() => setTrafficRowColorMode('status')}
            />
            <OptionButton
              label="By Content Type"
              active={trafficRowColorMode === 'content-type'}
              onClick={() => setTrafficRowColorMode('content-type')}
            />
          </div>
        </Row>
      </Section>

      {/* About */}
      <Section title="About">
        <Row label="App name">
          <span className="text-sm text-pb-text">ProxyBoy</span>
        </Row>
        <Row label="Version">
          <span className="text-sm text-pb-text font-mono">1.0.0</span>
        </Row>
        <Row label="Built with">
          <span className="text-sm text-pb-text">Electron, React, GitHub Copilot SDK</span>
        </Row>
        <Row label="">
          <span className="text-sm text-pb-accent">Powered by GitHub Copilot</span>
        </Row>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-pb-text-dim mb-3">{title}</h2>
      <div className="bg-pb-surface rounded-lg border border-pb-border divide-y divide-pb-border">
        {children}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      {label && <span className="text-sm text-pb-text">{label}</span>}
      {children}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`relative w-10 h-5 rounded-full transition-colors ${checked ? 'bg-pb-accent' : 'bg-pb-border'}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform
          ${checked ? 'translate-x-5' : 'translate-x-0'}`}
      />
    </button>
  );
}

function CertBadge({ status }: { status: 'checking' | 'installed' | 'not-installed' }) {
  if (status === 'checking') {
    return <span className="text-xs text-pb-text-dim">Checking…</span>;
  }
  const installed = status === 'installed';
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full
      ${installed ? 'bg-pb-success/15 text-pb-success' : 'bg-pb-warning/15 text-pb-warning'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${installed ? 'bg-pb-success' : 'bg-pb-warning'}`} />
      {installed ? 'Installed' : 'Not installed'}
    </span>
  );
}

function OptionButton({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`px-3 py-1.5 rounded text-sm transition-colors
        ${active ? 'bg-pb-accent/20 text-pb-accent border border-pb-accent/40' : ''}
        ${disabled ? 'text-pb-text-dim border border-pb-border opacity-50 cursor-not-allowed' : ''}
        ${!active && !disabled ? 'text-pb-text border border-pb-border hover:bg-pb-surface-hover cursor-pointer' : ''}`}
    >
      {label}{disabled ? ' (coming soon)' : ''}
    </button>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-pb-text-dim">
      <span>{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="bg-pb-bg border border-pb-border rounded px-3 py-1.5 text-sm text-pb-text w-28
          focus:outline-none focus:border-pb-accent"
      />
    </label>
  );
}
