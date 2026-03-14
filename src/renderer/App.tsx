import React, { useState, useEffect, useCallback } from 'react';
import TitleBar from './components/layout/TitleBar';
import Sidebar from './components/layout/Sidebar';
import StatusBar from './components/layout/StatusBar';
import TrafficList from './components/traffic/TrafficList';
import TrafficDetail from './components/traffic/TrafficDetail';
import FilterBar from './components/filters/FilterBar';
import AgentPanel from './components/agent/AgentPanel';
import FloatingAgentPanel from './components/agent/FloatingAgentPanel';
import BreakpointEditor from './components/rules/BreakpointEditor';
import MapLocalEditor from './components/rules/MapLocalEditor';
import { useTrafficStore } from './stores/traffic';
import { useAppStore } from './stores/app';

declare global {
  interface Window {
    proxyboy: any;
  }
}

type View = 'traffic' | 'breakpoints' | 'map-local';

export default function App() {
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
  const { flows, addFlow, updateFlow, getFilteredFlows } = useTrafficStore();
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

    api.proxy.getStatus().then((status: any) => {
      setProxyRunning(status.running);
      if (status.port) {
        useAppStore.getState().setProxyPort(status.port);
      }
    });

    return () => {
      unsubNew();
      unsubComplete();
    };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'A') {
        e.preventDefault();
        setShowAgent(prev => !prev);
      }
      if (e.ctrlKey && e.key === 'k') {
        e.preventDefault();
        useTrafficStore.getState().clearFlows();
        window.proxyboy?.traffic.clear();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const filteredFlows = getFilteredFlows();
  const selectedFlow = selectedFlowId ? flows.find(f => f.id === selectedFlowId) : null;

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          selectedView={selectedView}
          onSelectView={setSelectedView}
          onToggleAgent={() => setShowAgent(!showAgent)}
          showAgent={showAgent}
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
                onDetach={() => setAgentDetached(true)}
                isDetached={false}
              />
            </div>
          </div>
        )}
      </div>
      {showAgent && agentDetached && (
        <FloatingAgentPanel
          onClose={() => setShowAgent(false)}
          onAttach={() => setAgentDetached(false)}
        />
      )}
      <StatusBar />
    </div>
  );
}
