import React, { useCallback, useEffect, useState } from 'react';
import { useRulesStore } from '../../stores/rules';

export default function MapRemoteEditor() {
  const { getMapRemoteRules, loadRules } = useRulesStore();
  const rules = getMapRemoteRules();

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [urlPattern, setUrlPattern] = useState('');
  const [destinationUrl, setDestinationUrl] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const [preservePath, setPreservePath] = useState(true);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  const handleCreate = useCallback(async () => {
    const api = (window as any).proxyboy;
    if (!api || !name || !urlPattern || !destinationUrl) return;

    const normalizedDestination = destinationUrl.trim();
    try {
      const parsed = new URL(normalizedDestination);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        window.alert('Destination URL must start with http:// or https://.');
        return;
      }
    } catch {
      window.alert('Enter a valid destination URL.');
      return;
    }

    await api.rules.create({
      type: 'map-remote',
      name,
      enabled: true,
      matchCriteria: { urlPattern, isRegex },
      destinationUrl: normalizedDestination,
      preservePath,
    });
    await loadRules();
    setShowForm(false);
    setName('');
    setUrlPattern('');
    setDestinationUrl('');
    setIsRegex(false);
    setPreservePath(true);
  }, [destinationUrl, isRegex, loadRules, name, preservePath, urlPattern]);

  const handleDelete = useCallback(async (id: string) => {
    const api = (window as any).proxyboy;
    if (!api) return;
    await api.rules.delete(id);
    await loadRules();
  }, [loadRules]);

  const handleToggle = useCallback(async (id: string) => {
    const api = (window as any).proxyboy;
    if (!api) return;
    await api.rules.toggle(id);
    await loadRules();
  }, [loadRules]);

  return (
    <div className="flex flex-col h-full p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-pb-text">🌐 Map Remote Rules</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-3 py-1.5 bg-pb-accent text-white text-xs rounded font-medium hover:bg-pb-accent/80"
        >
          + New Rule
        </button>
      </div>

      {showForm && (
        <div className="bg-pb-surface rounded-lg p-4 mb-4 border border-pb-border space-y-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Rule name"
            className="w-full h-8 bg-pb-bg border border-pb-border rounded px-3 text-xs text-pb-text placeholder-pb-text-dim focus:outline-none focus:border-pb-accent"
          />
          <input
            type="text"
            value={urlPattern}
            onChange={(e) => setUrlPattern(e.target.value)}
            placeholder="URL pattern (e.g., *://api.example.com/*)"
            className="w-full h-8 bg-pb-bg border border-pb-border rounded px-3 text-xs text-pb-text font-mono placeholder-pb-text-dim focus:outline-none focus:border-pb-accent"
          />
          <input
            type="text"
            value={destinationUrl}
            onChange={(e) => setDestinationUrl(e.target.value)}
            placeholder="Destination URL (e.g., https://staging.example.com)"
            className="w-full h-8 bg-pb-bg border border-pb-border rounded px-3 text-xs text-pb-text font-mono placeholder-pb-text-dim focus:outline-none focus:border-pb-accent"
          />
          <div className="rounded border border-pb-border bg-pb-bg/60 px-3 py-2 text-[11px] text-pb-text-dim">
            Requests keep their original method and headers. By default, ProxyBoy preserves the incoming path and query string when it forwards to the destination host.
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-xs text-pb-text-dim cursor-pointer">
              <input
                type="checkbox"
                checked={preservePath}
                onChange={(e) => setPreservePath(e.target.checked)}
                className="rounded"
              />
              Preserve original path and query
            </label>
            <label className="flex items-center gap-1.5 text-xs text-pb-text-dim cursor-pointer">
              <input
                type="checkbox"
                checked={isRegex}
                onChange={(e) => setIsRegex(e.target.checked)}
                className="rounded"
              />
              Regex
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowForm(false)}
              className="px-3 py-1.5 text-xs text-pb-text-dim hover:text-pb-text"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              className="px-3 py-1.5 bg-pb-accent text-white text-xs rounded font-medium hover:bg-pb-accent/80"
            >
              Create
            </button>
          </div>
        </div>
      )}

      {rules.length === 0 && !showForm ? (
        <div className="flex flex-col items-center justify-center flex-1 text-pb-text-dim">
          <div className="text-4xl mb-4">🌐</div>
          <div className="text-sm">No map remote rules</div>
          <div className="text-xs mt-1">Forward matching requests to a different upstream host</div>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <div key={rule.id} className="flex items-center justify-between bg-pb-surface rounded-lg p-3 border border-pb-border">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleToggle(rule.id)}
                  className={`w-8 h-4 rounded-full relative transition-colors ${rule.enabled ? 'bg-pb-accent' : 'bg-pb-border'}`}
                >
                  <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${rule.enabled ? 'left-4' : 'left-0.5'}`} />
                </button>
                <div>
                  <div className="text-xs font-medium text-pb-text">{rule.name}</div>
                  <div className="text-[10px] text-pb-text-dim font-mono">{rule.matchCriteria.urlPattern}</div>
                  <div className="text-[10px] text-pb-info font-mono mt-0.5">→ {rule.destinationUrl}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-pb-text-dim px-2 py-0.5 bg-pb-bg rounded">
                  {rule.preservePath !== false ? 'Preserve path' : 'Fixed target'}
                </span>
                <button
                  onClick={() => handleDelete(rule.id)}
                  className="text-pb-text-dim hover:text-pb-error text-xs px-1"
                >
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
