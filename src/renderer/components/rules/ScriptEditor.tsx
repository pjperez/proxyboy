import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRulesStore } from '../../stores/rules';
import type { ScriptPhase, ScriptRule, ScriptTestResult } from '../../../shared/types';

const SNIPPETS: Array<{ label: string; phase: ScriptPhase; code: string }> = [
  {
    label: 'Add request header',
    phase: 'request',
    code: "request.headers['x-proxyboy-script'] = 'enabled';",
  },
  {
    label: 'Rewrite request JSON body',
    phase: 'request',
    code: "const payload = parseJson(request.body || '{}');\npayload.debug = true;\nsetJsonBody(request, payload);",
  },
  {
    label: 'Block a request',
    phase: 'request',
    code: "if (request.url.includes('/admin')) {\n  block('Blocked by script rule');\n}",
  },
  {
    label: 'Override response status',
    phase: 'response',
    code: "response.statusCode = 418;\nresponse.statusMessage = \"I'm a teapot\";",
  },
  {
    label: 'Rewrite response JSON body',
    phase: 'response',
    code: "const payload = parseJson(response.body || '{}');\npayload.injectedBy = 'ProxyBoy';\nsetJsonBody(response, payload);",
  },
];

interface Props {
  selectedFlowId: string | null;
}

const EMPTY_CODE = "// request / response are mutable objects\n// parseJson, stringifyJson, setJsonBody, atob, btoa, and block() are available\n";

export default function ScriptEditor({ selectedFlowId }: Props) {
  const { getScriptRules, loadRules } = useRulesStore();
  const rules = getScriptRules();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [urlPattern, setUrlPattern] = useState('');
  const [phase, setPhase] = useState<ScriptPhase>('request');
  const [methods, setMethods] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const [code, setCode] = useState(EMPTY_CODE);
  const [testResult, setTestResult] = useState<ScriptTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => { void loadRules(); }, [loadRules]);

  const resetForm = useCallback(() => {
    setEditingId(null);
    setName('');
    setUrlPattern('');
    setPhase('request');
    setMethods('');
    setIsRegex(false);
    setCode(EMPTY_CODE);
    setTestResult(null);
  }, []);

  const beginCreate = useCallback(() => {
    resetForm();
    setShowForm(true);
  }, [resetForm]);

  const beginEdit = useCallback((rule: ScriptRule) => {
    setEditingId(rule.id);
    setName(rule.name);
    setUrlPattern(rule.matchCriteria.urlPattern);
    setPhase(rule.phase);
    setMethods((rule.matchCriteria.methods ?? []).join(', '));
    setIsRegex(Boolean(rule.matchCriteria.isRegex));
    setCode(rule.code);
    setTestResult(null);
    setShowForm(true);
  }, []);

  const parsedMethods = useMemo(
    () => methods.split(',').map((value) => value.trim().toUpperCase()).filter(Boolean),
    [methods],
  );

  const buildRulePayload = useCallback(() => ({
    type: 'script' as const,
    name,
    enabled: true,
    phase,
    matchCriteria: {
      urlPattern,
      isRegex,
      methods: parsedMethods.length > 0 ? parsedMethods : undefined,
    },
    code,
  }), [code, isRegex, name, parsedMethods, phase, urlPattern]);

  const handleSave = useCallback(async () => {
    const api = (window as any).proxyboy;
    if (!api || !name || !urlPattern || !code.trim()) return;

    if (editingId) {
      const existing = rules.find((rule) => rule.id === editingId);
      if (!existing) return;
      await api.rules.update({
        ...existing,
        ...buildRulePayload(),
        enabled: existing.enabled,
      });
    } else {
      await api.rules.create(buildRulePayload());
    }

    await loadRules();
    setShowForm(false);
    resetForm();
  }, [buildRulePayload, code, editingId, loadRules, name, resetForm, rules, urlPattern]);

  const handleDelete = useCallback(async (id: string) => {
    const api = (window as any).proxyboy;
    if (!api) return;
    await api.rules.delete(id);
    await loadRules();
    if (editingId === id) {
      resetForm();
      setShowForm(false);
    }
  }, [editingId, loadRules, resetForm]);

  const handleToggle = useCallback(async (id: string) => {
    const api = (window as any).proxyboy;
    if (!api) return;
    await api.rules.toggle(id);
    await loadRules();
  }, [loadRules]);

  const handleTest = useCallback(async () => {
    const api = (window as any).proxyboy;
    if (!api?.scripts?.test || !selectedFlowId || !urlPattern || !code.trim()) return;

    setTesting(true);
    try {
      const result = await api.scripts.test(buildRulePayload(), selectedFlowId);
      setTestResult(result);
    } finally {
      setTesting(false);
    }
  }, [buildRulePayload, code, selectedFlowId, urlPattern]);

  const applySnippet = useCallback((label: string) => {
    const snippet = SNIPPETS.find((entry) => entry.label === label);
    if (!snippet) return;
    setPhase(snippet.phase);
    setCode(snippet.code);
  }, []);

  return (
    <div className="flex flex-col h-full p-4 overflow-hidden">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-pb-text">📜 Script Rules</h2>
        <button
          onClick={beginCreate}
          className="px-3 py-1.5 bg-pb-accent text-white text-xs rounded font-medium hover:bg-pb-accent/80"
        >
          + New Script
        </button>
      </div>

      {showForm && (
        <div className="bg-pb-surface rounded-lg p-4 mb-4 border border-pb-border space-y-3 overflow-auto">
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
          <div className="grid grid-cols-3 gap-3">
            <select
              value={phase}
              onChange={(e) => setPhase(e.target.value as ScriptPhase)}
              className="h-8 bg-pb-bg border border-pb-border rounded px-2 text-xs text-pb-text focus:outline-none focus:border-pb-accent"
            >
              <option value="request">Request</option>
              <option value="response">Response</option>
              <option value="both">Both</option>
            </select>
            <input
              type="text"
              value={methods}
              onChange={(e) => setMethods(e.target.value)}
              placeholder="Methods (GET, POST)"
              className="h-8 bg-pb-bg border border-pb-border rounded px-3 text-xs text-pb-text placeholder-pb-text-dim focus:outline-none focus:border-pb-accent"
            />
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
          <div className="flex items-center gap-2">
            <label className="text-xs text-pb-text-dim">Snippet:</label>
            <select
              defaultValue=""
              onChange={(e) => applySnippet(e.target.value)}
              className="h-8 bg-pb-bg border border-pb-border rounded px-2 text-xs text-pb-text focus:outline-none focus:border-pb-accent"
            >
              <option value="">Choose a starter snippet</option>
              {SNIPPETS.map((snippet) => (
                <option key={snippet.label} value={snippet.label}>{snippet.label}</option>
              ))}
            </select>
          </div>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck={false}
            className="w-full min-h-64 bg-pb-bg border border-pb-border rounded px-3 py-2 text-xs text-pb-text font-mono focus:outline-none focus:border-pb-accent"
          />
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] text-pb-text-dim">
              {selectedFlowId
                ? 'Test runs the script against the currently selected traffic flow.'
                : 'Select a traffic flow first if you want to test this script before saving.'}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleTest}
                disabled={!selectedFlowId || testing}
                className="px-3 py-1.5 bg-pb-bg border border-pb-border text-pb-text text-xs rounded font-medium hover:bg-pb-surface-hover disabled:opacity-50"
              >
                {testing ? 'Testing…' : 'Test'}
              </button>
              <button
                onClick={() => {
                  setShowForm(false);
                  resetForm();
                }}
                className="px-3 py-1.5 text-xs text-pb-text-dim hover:text-pb-text"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="px-3 py-1.5 bg-pb-accent text-white text-xs rounded font-medium hover:bg-pb-accent/80"
              >
                {editingId ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
          {testResult && (
            <div className="rounded border border-pb-border bg-pb-bg p-3 space-y-2 text-xs">
              <div className="flex items-center gap-2">
                <span className={`font-semibold ${testResult.success ? 'text-pb-success' : 'text-pb-error'}`}>
                  {testResult.success ? 'Preview ready' : 'Test failed'}
                </span>
                {testResult.blocked && (
                  <span className="rounded bg-pb-warning/15 px-2 py-0.5 text-pb-warning">Blocked</span>
                )}
              </div>
              {testResult.error && <div className="text-pb-error">{testResult.error}</div>}
              {testResult.notes?.length ? (
                <ul className="space-y-1 text-pb-text-dim">
                  {testResult.notes.map((note) => <li key={note}>• {note}</li>)}
                </ul>
              ) : null}
              {(testResult.request || testResult.response) && (
                <pre className="whitespace-pre-wrap break-all rounded border border-pb-border bg-pb-surface p-3 text-[11px] font-mono text-pb-text">
                  {JSON.stringify({
                    request: testResult.request,
                    response: testResult.response,
                  }, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      {rules.length === 0 && !showForm ? (
        <div className="flex flex-col items-center justify-center flex-1 text-pb-text-dim">
          <div className="text-4xl mb-4">📜</div>
          <div className="text-sm">No script rules</div>
          <div className="text-xs mt-1">Automate request and response rewrites with sandboxed JavaScript</div>
        </div>
      ) : (
        <div className="space-y-2 overflow-auto">
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
                  <div className="text-[10px] text-pb-info font-mono mt-0.5">{rule.phase}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => beginEdit(rule)}
                  className="text-pb-text-dim hover:text-pb-text text-xs px-1"
                >
                  ✏️
                </button>
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
