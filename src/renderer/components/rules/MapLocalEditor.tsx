import React, { useState, useEffect, useCallback } from 'react';
import { useRulesStore } from '../../stores/rules';
import type { MapLocalRule } from '../../../shared/types';

export default function MapLocalEditor() {
  const { getMapLocalRules, loadRules } = useRulesStore();
  const rules = getMapLocalRules();

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [urlPattern, setUrlPattern] = useState('');
  const [localFilePath, setLocalFilePath] = useState('');
  const [statusCode, setStatusCode] = useState(200);
  const [isRegex, setIsRegex] = useState(false);

  useEffect(() => { loadRules(); }, []);

  const handleCreate = useCallback(async () => {
    const api = (window as any).proxyboy;
    if (!api || !name || !urlPattern || !localFilePath) return;

    await api.rules.create({
      type: 'map-local',
      name,
      enabled: true,
      matchCriteria: { urlPattern, isRegex },
      localFilePath,
      statusCode,
    });
    await loadRules();
    setShowForm(false);
    setName('');
    setUrlPattern('');
    setLocalFilePath('');
    setStatusCode(200);
  }, [name, urlPattern, localFilePath, statusCode, isRegex, loadRules]);

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

  const handleBrowse = useCallback(async () => {
    const api = (window as any).proxyboy;
    if (!api?.app?.pickFile) return;
    const result = await api.app.pickFile();
    if (result?.success && result.path) {
      setLocalFilePath(result.path);
    }
  }, []);

  return (
    <div className="flex flex-col h-full p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-pb-text">📁 Map Local Rules</h2>
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
            placeholder="URL pattern (e.g., */api/users*)"
            className="w-full h-8 bg-pb-bg border border-pb-border rounded px-3 text-xs text-pb-text font-mono placeholder-pb-text-dim focus:outline-none focus:border-pb-accent"
          />
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={localFilePath}
              onChange={(e) => setLocalFilePath(e.target.value)}
              placeholder="Local file path (e.g., C:\mocks\users.json)"
              className="flex-1 h-8 bg-pb-bg border border-pb-border rounded px-3 text-xs text-pb-text font-mono placeholder-pb-text-dim focus:outline-none focus:border-pb-accent"
            />
            <button
              onClick={handleBrowse}
              className="h-8 px-3 bg-pb-bg border border-pb-border rounded text-xs text-pb-text hover:bg-pb-surface-hover"
            >
              Browse…
            </button>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-xs text-pb-text-dim">Status:</label>
              <input
                type="number"
                value={statusCode}
                onChange={(e) => setStatusCode(parseInt(e.target.value) || 200)}
                className="w-20 h-7 bg-pb-bg border border-pb-border rounded px-2 text-xs text-pb-text font-mono focus:outline-none focus:border-pb-accent"
              />
            </div>
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
          <div className="text-4xl mb-4">📁</div>
          <div className="text-sm">No map local rules</div>
          <div className="text-xs mt-1">Map API responses to local files for fast mocking</div>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map(rule => (
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
                  <div className="text-[10px] text-pb-info font-mono mt-0.5">→ {rule.localFilePath}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-pb-text-dim px-2 py-0.5 bg-pb-bg rounded">
                  {rule.statusCode || 200}
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
