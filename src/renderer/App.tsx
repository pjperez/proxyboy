import React, { useState, useEffect, useCallback, useMemo } from 'react';
import TitleBar from './components/layout/TitleBar';
import Sidebar from './components/layout/Sidebar';
import StatusBar from './components/layout/StatusBar';
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
  const addFlow = useTrafficStore(s => s.addFlow);
  const updateFlow = useTrafficStore(s => s.updateFlow);
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

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'A') {
        e.preventDefault();
        if (agentDetached) {
          window.proxyboy?.agent.openWindow();
        } else {
          setShowAgent(prev => !prev);
        }
      }
      if (e.ctrlKey && e.key === 'k') {
        e.preventDefault();
        useTrafficStore.getState().clearFlows();
        window.proxyboy?.traffic.clear();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [agentDetached]);

  const filteredFlows = useMemo(() => getFilteredFlows(), [flows, filter]);
  const selectedFlow = useMemo(
    () => selectedFlowId ? flows.find(f => f.id === selectedFlowId) ?? null : null,
    [flows, selectedFlowId]
  );

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden">
      <TitleBar />
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
