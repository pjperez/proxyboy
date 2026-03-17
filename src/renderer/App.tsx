import React, { useState, useEffect, useCallback, useMemo } from 'react';
import TitleBar from './components/layout/TitleBar';
import Sidebar from './components/layout/Sidebar';
import StatusBar from './components/layout/StatusBar';
import ShortcutHelpDialog from './components/layout/ShortcutHelpDialog';
import TrafficList from './components/traffic/TrafficList';
import TrafficDetail from './components/traffic/TrafficDetail';
import FilterBar from './components/filters/FilterBar';
import AgentPanel from './components/agent/AgentPanel';
import BreakpointEditor from './components/rules/BreakpointEditor';
import MapLocalEditor from './components/rules/MapLocalEditor';
import SettingsPanel from './components/settings/SettingsPanel';
import BreakpointPauseDialog from './components/rules/BreakpointPauseDialog';
import { useTrafficStore } from './stores/traffic';
import { useRulesStore } from './stores/rules';
import { useAppStore } from './stores/app';
import { flowToCurl } from './utils/curl';
import { clearTrafficFlows, deleteTrafficFlow, exportHarFile, importHarFile, toggleProxyRecording } from './utils/app-actions';
import { getNextSelectedFlowIdAfterDelete } from './utils/shortcuts';

declare global {
  interface Window {
    proxyboy: any;
  }
}

type View = 'traffic' | 'breakpoints' | 'map-local' | 'settings';

// Detect if this is the detached agent window
const isAgentWindow = new URLSearchParams(window.location.search).get('view') === 'agent';

export default function App() {
  if (isAgentWindow) {
    return (
      <div className="flex flex-col h-screen w-screen overflow-hidden bg-pb-bg">
        <AgentPanel onClose={() => window.close()} isDetached={true} />
      </div>
    );
  }
  return <MainApp />;
}

function MainApp() {
  const [selectedView, setSelectedView] = useState<View>('traffic');
  const [showAgent, setShowAgent] = useState(false);
  const [agentDetached, setAgentDetached] = useState(false);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [agentWidth, setAgentWidth] = useState(384);
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);

  const handleAgentResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = agentWidth;
    const onMouseMove = (ev: MouseEvent) => {
      const newWidth = Math.max(320, Math.min(800, startWidth + (startX - ev.clientX)));
      setAgentWidth(newWidth);
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [agentWidth]);

  const handleDetach = useCallback(async () => {
    await window.proxyboy?.agent.openWindow();
    setAgentDetached(true);
    setShowAgent(false);
  }, []);

  const [breakpointPause, setBreakpointPause] = useState<{flowId: string; flow: any; phase: string} | null>(null);

  const flows = useTrafficStore(s => s.flows);
  const filter = useTrafficStore(s => s.filter);
  const setFlows = useTrafficStore(s => s.setFlows);
  const addFlow = useTrafficStore(s => s.addFlow);
  const updateFlow = useTrafficStore(s => s.updateFlow);
  const removeFlow = useTrafficStore(s => s.removeFlow);
  const getFilteredFlows = useTrafficStore(s => s.getFilteredFlows);
  const { addRule } = useRulesStore();
  const { proxyRunning, setProxyRunning } = useAppStore();

  useEffect(() => {
    const api = window.proxyboy;
    if (!api) return;

    const unsubNew = api.traffic.onNewFlow((flow: any) => {
      addFlow(flow);
    });
    const unsubComplete = api.traffic.onFlowComplete((flow: any) => {
      updateFlow(flow);
    });
    const unsubRuleCreated = api.rules?.onRuleCreated?.((rule: any) => {
      addRule(rule);
    });
    const unsubAgentClosed = api.agent.onWindowClosed(() => {
      setAgentDetached(false);
    });

    const unsubBreakpoint = api.breakpoint?.onPaused?.((data: any) => {
      setBreakpointPause(data);
    });

    api.traffic.getFlows().then((loadedFlows: any[]) => {
      if (Array.isArray(loadedFlows)) {
        setFlows(loadedFlows);
      }
    }).catch(() => {});

    api.proxy.getStatus().then((status: any) => {
      setProxyRunning(status.running);
      if (status.port) {
        useAppStore.getState().setProxyPort(status.port);
      }
      // Auto-start if enabled and not already running
      if (!status.running && localStorage.getItem('proxyboy-auto-start') === 'true') {
        api.proxy.start().then((result: any) => {
          if (result?.success) {
            useAppStore.getState().setProxyRunning(true);
            if (result.port) useAppStore.getState().setProxyPort(result.port);
          }
        });
      }
    });

    return () => {
      unsubNew();
      unsubComplete();
      unsubRuleCreated?.();
      unsubBreakpoint?.();
      unsubAgentClosed();
    };
  }, []);

  const filteredFlows = useMemo(() => getFilteredFlows(), [flows, filter]);
  const selectedFlow = useMemo(
    () => selectedFlowId ? flows.find(f => f.id === selectedFlowId) ?? null : null,
    [flows, selectedFlowId]
  );

  useEffect(() => {
    if (selectedFlowId && !flows.some((flow) => flow.id === selectedFlowId)) {
      setSelectedFlowId(null);
    }
  }, [flows, selectedFlowId]);

  const focusTrafficFilter = useCallback(() => {
    const input = document.getElementById('traffic-filter-input') as HTMLInputElement | null;
    input?.focus();
    input?.select();
  }, []);

  const showActionError = useCallback((message: string) => {
    window.alert(message);
  }, []);

  const handleProxyToggle = useCallback(async () => {
    const api = window.proxyboy;
    if (!api) return;

    const status = await api.proxy.getStatus();
    const result = await toggleProxyRecording(api, Boolean(status?.running), Boolean(status?.isSystemProxy));
    if (!result.success) {
      showActionError(result.error);
      return;
    }

    setProxyRunning(result.running);
    if (result.port) {
      useAppStore.getState().setProxyPort(result.port);
    }
  }, [setProxyRunning, showActionError]);

  const handleExportHar = useCallback(async () => {
    const result = await exportHarFile(window.proxyboy);
    if (!result.success && !result.canceled) {
      showActionError(result.error);
    }
  }, [showActionError]);

  const handleImportHar = useCallback(async () => {
    const result = await importHarFile(window.proxyboy);
    if (!result.success && !result.canceled) {
      showActionError(result.error);
    }
  }, [showActionError]);

  const handleClearTraffic = useCallback(async () => {
    const result = await clearTrafficFlows(window.proxyboy);
    if (!result.success) {
      showActionError(result.error);
      return;
    }

    useTrafficStore.getState().clearFlows();
    setSelectedFlowId(null);
  }, [showActionError]);

  const handleCopySelectedFlowAsCurl = useCallback(async () => {
    if (selectedView !== 'traffic' || !selectedFlow) {
      return;
    }

    try {
      await navigator.clipboard.writeText(flowToCurl(selectedFlow));
    } catch {
      showActionError('Failed to copy the selected request as cURL.');
    }
  }, [selectedFlow, selectedView, showActionError]);

  const handleToggleDetail = useCallback(() => {
    if (selectedView !== 'traffic') {
      return;
    }

    if (selectedFlowId) {
      setSelectedFlowId(null);
      return;
    }

    if (filteredFlows.length > 0) {
      setSelectedFlowId(filteredFlows[0].id);
    }
  }, [filteredFlows, selectedFlowId, selectedView]);

  const handleDeleteSelectedFlow = useCallback(async () => {
    if (selectedView !== 'traffic' || !selectedFlowId) {
      return;
    }

    const result = await deleteTrafficFlow(window.proxyboy, selectedFlowId);
    if (!result.success) {
      showActionError(result.error);
      return;
    }

    const nextSelectedFlowId = getNextSelectedFlowIdAfterDelete(
      filteredFlows.map((flow) => flow.id),
      selectedFlowId,
    );
    removeFlow(selectedFlowId);
    setSelectedFlowId(nextSelectedFlowId);
  }, [filteredFlows, removeFlow, selectedFlowId, selectedView, showActionError]);

  const dismissPanels = useCallback((): boolean => {
    if (showShortcutHelp) {
      setShowShortcutHelp(false);
      return true;
    }

    if (selectedFlowId) {
      setSelectedFlowId(null);
      return true;
    }

    if (showAgent && !agentDetached) {
      setShowAgent(false);
      return true;
    }

    return false;
  }, [agentDetached, selectedFlowId, showAgent, showShortcutHelp]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTypingTarget = !!target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      );
      const key = e.key.toLowerCase();
      const isHelpShortcut = !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === '?' || (e.key === '/' && e.shiftKey));

      if (showShortcutHelp) {
        if (e.key === 'Escape' || isHelpShortcut) {
          e.preventDefault();
          setShowShortcutHelp(false);
        }
        return;
      }

      if (!isTypingTarget && isHelpShortcut) {
        e.preventDefault();
        setShowShortcutHelp(true);
        return;
      }

      if (e.ctrlKey && e.shiftKey && key === 'a') {
        e.preventDefault();
        if (agentDetached) {
          window.proxyboy?.agent.openWindow();
        } else {
          setShowAgent(prev => !prev);
        }
        return;
      }

      if (e.ctrlKey && e.shiftKey && key === 'c') {
        e.preventDefault();
        void handleCopySelectedFlowAsCurl();
        return;
      }

      if (e.ctrlKey && key === 'e') {
        e.preventDefault();
        void handleProxyToggle();
        return;
      }

      if (e.ctrlKey && key === 'i') {
        e.preventDefault();
        void handleImportHar();
        return;
      }

      if (e.ctrlKey && key === 's') {
        e.preventDefault();
        void handleExportHar();
        return;
      }

      if (e.ctrlKey && key === 'k') {
        e.preventDefault();
        void handleClearTraffic();
        return;
      }

      if (e.ctrlKey && key === 'd') {
        e.preventDefault();
        handleToggleDetail();
        return;
      }

      if (e.ctrlKey && key === 'f') {
        e.preventDefault();
        focusTrafficFilter();
        return;
      }

      if (!isTypingTarget && e.key === 'Delete') {
        e.preventDefault();
        void handleDeleteSelectedFlow();
        return;
      }

      if (!isTypingTarget && e.key === 'Escape') {
        if (dismissPanels()) {
          e.preventDefault();
        }
        return;
      }

      if (!isTypingTarget && selectedView === 'traffic' && filteredFlows.length > 0) {
        const currentIndex = selectedFlowId
          ? filteredFlows.findIndex((flow) => flow.id === selectedFlowId)
          : -1;

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          const nextIndex = Math.min(currentIndex + 1, filteredFlows.length - 1);
          setSelectedFlowId(filteredFlows[nextIndex].id);
        }

        if (e.key === 'ArrowUp') {
          e.preventDefault();
          const nextIndex = currentIndex <= 0 ? 0 : currentIndex - 1;
          setSelectedFlowId(filteredFlows[nextIndex].id);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    agentDetached,
    dismissPanels,
    filteredFlows,
    focusTrafficFilter,
    handleClearTraffic,
    handleCopySelectedFlowAsCurl,
    handleDeleteSelectedFlow,
    handleExportHar,
    handleImportHar,
    handleProxyToggle,
    handleToggleDetail,
    selectedFlowId,
    selectedView,
    showShortcutHelp,
  ]);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden">
      <TitleBar onOpenShortcuts={() => setShowShortcutHelp(true)} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          selectedView={selectedView}
          onSelectView={setSelectedView}
          onToggleAgent={() => {
            if (agentDetached) {
              window.proxyboy?.agent.openWindow();
            } else {
              setShowAgent(!showAgent);
            }
          }}
          showAgent={showAgent || agentDetached}
        />
        <div className="flex flex-col flex-1 overflow-hidden">
          {selectedView === 'traffic' && (
            <>
              <FilterBar />
              <div className="flex flex-1 overflow-hidden">
                <div className={`${selectedFlow ? 'w-1/2' : 'w-full'} overflow-hidden border-r border-pb-border`}>
                  <TrafficList
                    flows={filteredFlows}
                    selectedId={selectedFlowId}
                    onSelect={setSelectedFlowId}
                  />
                </div>
                {selectedFlow && (
                  <div className="w-1/2 overflow-hidden">
                    <TrafficDetail
                      flow={selectedFlow}
                      onClose={() => setSelectedFlowId(null)}
                    />
                  </div>
                )}
              </div>
            </>
          )}
          {selectedView === 'breakpoints' && <BreakpointEditor />}
          {selectedView === 'map-local' && <MapLocalEditor />}
          {selectedView === 'settings' && <SettingsPanel />}
        </div>
        {showAgent && !agentDetached && (
          <div className="flex overflow-hidden" style={{ width: agentWidth }}>
            <div
              className="w-1 cursor-col-resize hover:bg-pb-accent/30 active:bg-pb-accent/50 transition-colors"
              onMouseDown={handleAgentResize}
            />
            <div className="flex-1 border-l border-pb-border overflow-hidden">
              <AgentPanel
                onClose={() => setShowAgent(false)}
                onDetach={handleDetach}
                isDetached={false}
              />
            </div>
          </div>
        )}
      </div>
      <StatusBar />
      {showShortcutHelp && (
        <ShortcutHelpDialog onClose={() => setShowShortcutHelp(false)} />
      )}
      {breakpointPause && (
        <BreakpointPauseDialog
          flowId={breakpointPause.flowId}
          flow={breakpointPause.flow}
          phase={breakpointPause.phase as 'request' | 'response'}
          onResume={(flowId, action) => {
            window.proxyboy?.breakpoint.resume(flowId, action);
            setBreakpointPause(null);
          }}
        />
      )}
    </div>
  );
}
