import React, { useState, useEffect } from 'react';
import { useRulesStore } from '../../stores/rules';
import type { BreakpointRule } from '../../../shared/types';

export default function BreakpointEditor() {
  const { getBreakpointRules, loadRules } = useRulesStore();
  const rules = getBreakpointRules();

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [urlPattern, setUrlPattern] = useState('');
  const [breakOn, setBreakOn] = useState<'request' | 'response' | 'both'>('both');
  const [isRegex, setIsRegex] = useState(false);

  useEffect(() => { loadRules(); }, []);

  const handleCreate = async () => {
    const api = (window as any).proxyboy;
    if (!api || !name || !urlPattern) return;

    await api.rules.create({
      type: 'breakpoint',
      name,
      enabled: true,
      matchCriteria: { urlPattern, isRegex },
      breakOn,
    });
    await loadRules();
    setShowForm(false);
    setName('');
    setUrlPattern('');
  };

  const handleDelete = async (id: string) => {
    const api = (window as any).proxyboy;
    if (!api) return;
    await api.rules.delete(id);
    await loadRules();
  };

  const handleToggle = async (id: string) => {
    const api = (window as any).proxyboy;
    if (!api) return;
    await api.rules.toggle(id);
    await loadRules();
  };

  return (
    <div className="flex flex-col h-full p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-pb-text">⏸ Breakpoint Rules</h2>
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
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-xs text-pb-text-dim">Break on:</label>
              <select
                value={breakOn}
                onChange={(e) => setBreakOn(e.target.value as any)}
                className="h-7 bg-pb-bg border border-pb-border rounded px-2 text-xs text-pb-text focus:outline-none focus:border-pb-accent"
              >
                <option value="both">Both</option>
                <option value="request">Request</option>
                <option value="response">Response</option>
              </select>
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
          <div className="text-4xl mb-4">⏸</div>
          <div className="text-sm">No breakpoint rules</div>
          <div className="text-xs mt-1">Create a rule to pause and edit traffic on the fly</div>
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
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-pb-text-dim px-2 py-0.5 bg-pb-bg rounded">
                  {rule.breakOn}
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
