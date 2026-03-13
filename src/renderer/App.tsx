import React, { useState, useEffect } from 'react';
import TitleBar from './components/layout/TitleBar';
import Sidebar from './components/layout/Sidebar';
import StatusBar from './components/layout/StatusBar';
import TrafficList from './components/traffic/TrafficList';
import TrafficDetail from './components/traffic/TrafficDetail';
import FilterBar from './components/filters/FilterBar';
import AgentPanel from './components/agent/AgentPanel';
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
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const { flows, addFlow, updateFlow } = useTrafficStore();
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
                    flows={flows}
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
        {showAgent && (
          <div className="w-96 border-l border-pb-border overflow-hidden">
            <AgentPanel onClose={() => setShowAgent(false)} />
          </div>
        )}
      </div>
      <StatusBar />
    </div>
  );
}
