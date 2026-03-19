import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRulesStore } from '../../stores/rules';
import type { AllowListRule, BlockListRule, CaptureFilterMode } from '../../../shared/types';

type CaptureRuleType = 'allow-list' | 'block-list';

const METHOD_OPTIONS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];
const MODE_OPTIONS: Array<{ mode: CaptureFilterMode; label: string }> = [
  { mode: 'capture-all', label: 'Capture All' },
  { mode: 'allow-list', label: 'Allow List' },
  { mode: 'block-list', label: 'Block List' },
];

function formatMethods(methods?: string[]): string {
  return methods?.length ? methods.join(', ') : 'Any method';
}

function RuleSection({
  title,
  icon,
  badgeClassName,
  emptyText,
  rules,
  onToggle,
  onDelete,
}: {
  title: string;
  icon: string;
  badgeClassName: string;
  emptyText: string;
  rules: Array<AllowListRule | BlockListRule>;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <section className="bg-pb-surface border border-pb-border rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">{icon}</span>
        <div>
          <h3 className="text-sm font-semibold text-pb-text">{title}</h3>
          <p className="text-xs text-pb-text-dim">
            {rules.length} {rules.length === 1 ? 'rule' : 'rules'}
          </p>
        </div>
      </div>

      {rules.length === 0 ? (
        <div className="rounded-lg border border-dashed border-pb-border px-3 py-4 text-xs text-pb-text-dim">
          {emptyText}
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <div key={rule.id} className="rounded-lg border border-pb-border bg-pb-bg/50 px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <button
                    onClick={() => onToggle(rule.id)}
                    className={`mt-0.5 w-8 h-4 rounded-full relative transition-colors ${rule.enabled ? 'bg-pb-accent' : 'bg-pb-border'}`}
                    title={rule.enabled ? 'Disable rule' : 'Enable rule'}
                  >
                    <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${rule.enabled ? 'left-4' : 'left-0.5'}`} />
                  </button>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium text-pb-text">{rule.name}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded ${badgeClassName}`}>
                        {rule.type === 'allow-list' ? 'Allow' : 'Block'}
                      </span>
                      {rule.matchCriteria.isRegex && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-pb-bg text-pb-text-dim">
                          Regex
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-[10px] font-mono text-pb-text-dim break-all">
                      {rule.matchCriteria.urlPattern}
                    </div>
                    <div className="mt-1 text-[10px] text-pb-text-dim">
                      {formatMethods(rule.matchCriteria.methods)}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => onDelete(rule.id)}
                  className="text-pb-text-dim hover:text-pb-error text-xs px-1"
                  title="Delete rule"
                >
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function CaptureFilterEditor() {
  const {
    captureMode,
    getAllowListRules,
    getBlockListRules,
    loadRules,
    loadCaptureMode,
    setCaptureMode,
  } = useRulesStore();

  const allowListRules = getAllowListRules();
  const blockListRules = getBlockListRules();

  const [showForm, setShowForm] = useState(false);
  const [ruleType, setRuleType] = useState<CaptureRuleType>('block-list');
  const [name, setName] = useState('');
  const [urlPattern, setUrlPattern] = useState('');
  const [selectedMethods, setSelectedMethods] = useState<string[]>([]);
  const [isRegex, setIsRegex] = useState(false);

  useEffect(() => {
    void loadRules();
    void loadCaptureMode();
  }, [loadCaptureMode, loadRules]);

  const activeModeDescription = useMemo(() => {
    if (captureMode === 'allow-list') {
      return 'Only requests matching enabled allow-list rules are captured. If the allow list is empty, capture stays open until you add your first rule. Skipped requests pass through normally and do not trigger other ProxyBoy rules.';
    }

    if (captureMode === 'block-list') {
      return 'Requests matching enabled block-list rules are skipped. Everything else is captured normally. Skipped requests pass through normally and do not trigger other ProxyBoy rules.';
    }

    return 'All traffic is captured. Allow-list and block-list rules stay saved, but they do not affect capture until you switch modes.';
  }, [captureMode]);

  const resetForm = useCallback(() => {
    setShowForm(false);
    setRuleType(captureMode === 'allow-list' ? 'allow-list' : 'block-list');
    setName('');
    setUrlPattern('');
    setSelectedMethods([]);
    setIsRegex(false);
  }, [captureMode]);

  const toggleMethod = useCallback((method: string) => {
    setSelectedMethods((current) =>
      current.includes(method)
        ? current.filter((value) => value !== method)
        : [...current, method],
    );
  }, []);

  const handleCreate = useCallback(async () => {
    const api = (window as any).proxyboy;
    if (!api?.rules || !name || !urlPattern) {
      return;
    }

    await api.rules.create({
      type: ruleType,
      name,
      enabled: true,
      matchCriteria: {
        urlPattern,
        isRegex,
        methods: selectedMethods.length ? selectedMethods : undefined,
      },
    });

    await loadRules();
    resetForm();
  }, [isRegex, loadRules, name, resetForm, ruleType, selectedMethods, urlPattern]);

  const handleDelete = useCallback(async (id: string) => {
    const api = (window as any).proxyboy;
    if (!api?.rules) {
      return;
    }

    await api.rules.delete(id);
    await loadRules();
  }, [loadRules]);

  const handleToggle = useCallback(async (id: string) => {
    const api = (window as any).proxyboy;
    if (!api?.rules) {
      return;
    }

    await api.rules.toggle(id);
    await loadRules();
  }, [loadRules]);

  const handleModeChange = useCallback(async (mode: CaptureFilterMode) => {
    const result = await setCaptureMode(mode);
    if (!result?.success) {
      window.alert(result?.error || 'Failed to update the capture mode.');
    }
  }, [setCaptureMode]);

  return (
    <div className="flex flex-col h-full p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-pb-text">🛡 Capture Rules</h2>
          <p className="text-xs text-pb-text-dim mt-1">
            Control which requests are recorded without changing how traffic flows through the proxy.
          </p>
        </div>
        <button
          onClick={() => {
            setRuleType(captureMode === 'allow-list' ? 'allow-list' : 'block-list');
            setShowForm((current) => !current);
          }}
          className="px-3 py-1.5 bg-pb-accent text-white text-xs rounded font-medium hover:bg-pb-accent/80"
        >
          + New Rule
        </button>
      </div>

      <div className="rounded-xl border border-pb-border bg-pb-surface p-4 mb-4">
        <div className="flex flex-wrap gap-2 mb-3">
          {MODE_OPTIONS.map((option) => (
            <button
              key={option.mode}
              onClick={() => void handleModeChange(option.mode)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                captureMode === option.mode
                  ? 'bg-pb-accent text-white'
                  : 'bg-pb-bg text-pb-text-dim hover:text-pb-text'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="rounded-lg border border-pb-border bg-pb-bg/50 px-3 py-3 text-xs text-pb-text-dim">
          {activeModeDescription}
        </div>
      </div>

      {showForm && (
        <div className="bg-pb-surface rounded-lg p-4 mb-4 border border-pb-border space-y-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-pb-text-dim">Rule type:</label>
            <select
              value={ruleType}
              onChange={(event) => setRuleType(event.target.value as CaptureRuleType)}
              className="h-7 bg-pb-bg border border-pb-border rounded px-2 text-xs text-pb-text focus:outline-none focus:border-pb-accent"
            >
              <option value="block-list">Block List</option>
              <option value="allow-list">Allow List</option>
            </select>
          </div>

          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Rule name"
            className="w-full h-8 bg-pb-bg border border-pb-border rounded px-3 text-xs text-pb-text placeholder-pb-text-dim focus:outline-none focus:border-pb-accent"
          />

          <input
            type="text"
            value={urlPattern}
            onChange={(event) => setUrlPattern(event.target.value)}
            placeholder="URL pattern (e.g., */api/*)"
            className="w-full h-8 bg-pb-bg border border-pb-border rounded px-3 text-xs text-pb-text font-mono placeholder-pb-text-dim focus:outline-none focus:border-pb-accent"
          />

          <div>
            <div className="text-xs text-pb-text-dim mb-2">Methods (leave empty for any method)</div>
            <div className="flex flex-wrap gap-2">
              {METHOD_OPTIONS.map((method) => {
                const active = selectedMethods.includes(method);
                return (
                  <button
                    key={method}
                    onClick={() => toggleMethod(method)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                      active
                        ? 'bg-pb-accent/20 border-pb-accent/40 text-pb-accent'
                        : 'border-pb-border text-pb-text-dim hover:text-pb-text hover:border-pb-accent/40'
                    }`}
                  >
                    {method}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="flex items-center gap-1.5 text-xs text-pb-text-dim cursor-pointer">
            <input
              type="checkbox"
              checked={isRegex}
              onChange={(event) => setIsRegex(event.target.checked)}
              className="rounded"
            />
            Regex
          </label>

          <div className="flex justify-end gap-2">
            <button
              onClick={resetForm}
              className="px-3 py-1.5 text-xs text-pb-text-dim hover:text-pb-text"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleCreate()}
              className="px-3 py-1.5 bg-pb-accent text-white text-xs rounded font-medium hover:bg-pb-accent/80"
            >
              Create
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <RuleSection
          title="Allow List"
          icon="✅"
          badgeClassName="bg-pb-success/15 text-pb-success"
          emptyText="No allow-list rules yet. Add one to capture only the traffic you care about."
          rules={allowListRules}
          onToggle={(id) => void handleToggle(id)}
          onDelete={(id) => void handleDelete(id)}
        />
        <RuleSection
          title="Block List"
          icon="🛑"
          badgeClassName="bg-pb-error/15 text-pb-error"
          emptyText="No block-list rules yet. Add one to skip noisy hosts or endpoints."
          rules={blockListRules}
          onToggle={(id) => void handleToggle(id)}
          onDelete={(id) => void handleDelete(id)}
        />
      </div>
    </div>
  );
}
