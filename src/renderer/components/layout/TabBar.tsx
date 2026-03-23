import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useSessionStore } from '../../stores/sessions';
import { useTrafficStore } from '../../stores/traffic';

export default function TabBar() {
  const { sessions, activeSessionId, setActiveSessionId, addSession, removeSession, renameSession } = useSessionStore();
  const setFlows = useTrafficStore(s => s.setFlows);
  const clearFlows = useTrafficStore(s => s.clearFlows);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const switchGenRef = useRef(0);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const handleSwitchSession = useCallback(async (id: string) => {
    if (id === activeSessionId) return;
    const api = window.proxyboy;
    if (!api) return;

    const gen = ++switchGenRef.current;
    await api.sessions.setActive(id);
    setActiveSessionId(id);
    clearFlows();

    try {
      const flows = await api.traffic.getFlows();
      // Discard stale response if another switch happened
      if (switchGenRef.current !== gen) return;
      if (Array.isArray(flows)) {
        setFlows(flows);
      }
    } catch {
      // ignore
    }
  }, [activeSessionId, clearFlows, setActiveSessionId, setFlows]);

  const handleCreateSession = useCallback(async () => {
    const api = window.proxyboy;
    if (!api) return;

    const session = await api.sessions.create('New Tab');
    addSession(session);
    await handleSwitchSession(session.id);
  }, [addSession, handleSwitchSession]);

  const handleDeleteSession = useCallback(async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (id === 'default') return;
    const api = window.proxyboy;
    if (!api) return;

    const wasActive = activeSessionId === id;

    // Update frontend state first to avoid inconsistency window
    removeSession(id);
    if (wasActive) {
      setActiveSessionId('default');
      clearFlows();
    }

    // Then sync to backend
    await api.sessions.delete(id);
    if (wasActive) {
      await api.sessions.setActive('default');
      try {
        const flows = await api.traffic.getFlows();
        if (Array.isArray(flows)) {
          setFlows(flows);
        }
      } catch {
        // ignore
      }
    }
  }, [activeSessionId, clearFlows, removeSession, setActiveSessionId, setFlows]);

  const startRenaming = useCallback((e: React.MouseEvent, id: string, currentName: string) => {
    e.preventDefault();
    setEditingId(id);
    setEditingName(currentName);
  }, []);

  const commitRename = useCallback(async () => {
    if (!editingId) return;
    const trimmed = editingName.trim();
    if (trimmed) {
      const api = window.proxyboy;
      if (api) {
        await api.sessions.rename(editingId, trimmed);
      }
      renameSession(editingId, trimmed);
    }
    setEditingId(null);
  }, [editingId, editingName, renameSession]);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      void commitRename();
    } else if (e.key === 'Escape') {
      setEditingId(null);
    }
  }, [commitRename]);

  return (
    <div className="flex items-center h-9 bg-pb-surface border-b border-pb-border px-1 gap-0.5 overflow-x-auto shrink-0">
      {sessions.map(session => (
        <div
          key={session.id}
          onClick={() => handleSwitchSession(session.id)}
          onDoubleClick={(e) => startRenaming(e, session.id, session.name)}
          className={`group flex items-center gap-1 px-3 h-7 rounded text-xs cursor-pointer select-none shrink-0 transition-colors
            ${activeSessionId === session.id
              ? 'bg-pb-accent/20 text-pb-accent'
              : 'text-pb-text-dim hover:bg-pb-surface-hover hover:text-pb-text'
            }`}
        >
          {editingId === session.id ? (
            <input
              ref={inputRef}
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onBlur={() => void commitRename()}
              onKeyDown={handleInputKeyDown}
              className="bg-transparent border border-pb-border rounded px-1 text-xs w-24 outline-none text-pb-text"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="truncate max-w-[120px]">{session.name}</span>
          )}
          {session.id !== 'default' && editingId !== session.id && (
            <button
              onClick={(e) => handleDeleteSession(e, session.id)}
              className="opacity-0 group-hover:opacity-100 ml-1 text-pb-text-dim hover:text-pb-text transition-opacity"
              title="Close tab"
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button
        onClick={handleCreateSession}
        className="flex items-center justify-center w-7 h-7 rounded text-pb-text-dim hover:bg-pb-surface-hover hover:text-pb-text transition-colors shrink-0"
        title="New tab"
      >
        +
      </button>
    </div>
  );
}
