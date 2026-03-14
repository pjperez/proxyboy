import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/constants';
import type { ProxyState, HttpFlow, Rule, FilterCriteria } from '../shared/types';

const api = {
  // Proxy control
  proxy: {
    start: (port?: number) => ipcRenderer.invoke(IPC_CHANNELS.PROXY_START, port),
    stop: () => ipcRenderer.invoke(IPC_CHANNELS.PROXY_STOP),
    getStatus: (): Promise<ProxyState> => ipcRenderer.invoke(IPC_CHANNELS.PROXY_STATUS),
    setSystemProxy: (enabled: boolean) => ipcRenderer.invoke(IPC_CHANNELS.PROXY_SET_SYSTEM, enabled),
    installCert: () => ipcRenderer.invoke(IPC_CHANNELS.PROXY_INSTALL_CERT),
    getCertStatus: () => ipcRenderer.invoke(IPC_CHANNELS.PROXY_CERT_STATUS),
  },

  // Traffic
  traffic: {
    getFlows: (filter?: FilterCriteria): Promise<HttpFlow[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.TRAFFIC_GET_FLOWS, filter),
    getFlow: (id: string): Promise<HttpFlow | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.TRAFFIC_GET_FLOW, id),
    clear: () => ipcRenderer.invoke(IPC_CHANNELS.TRAFFIC_CLEAR),
    onNewFlow: (callback: (flow: HttpFlow) => void) => {
      const handler = (_event: any, flow: HttpFlow) => callback(flow);
      ipcRenderer.on(IPC_CHANNELS.TRAFFIC_NEW_FLOW, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.TRAFFIC_NEW_FLOW, handler);
    },
    onFlowComplete: (callback: (flow: HttpFlow) => void) => {
      const handler = (_event: any, flow: HttpFlow) => callback(flow);
      ipcRenderer.on(IPC_CHANNELS.TRAFFIC_FLOW_COMPLETE, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.TRAFFIC_FLOW_COMPLETE, handler);
    },
  },

  // Rules
  rules: {
    getAll: (): Promise<Rule[]> => ipcRenderer.invoke(IPC_CHANNELS.RULES_GET_ALL),
    create: (rule: Omit<Rule, 'id' | 'createdAt' | 'updatedAt'>) =>
      ipcRenderer.invoke(IPC_CHANNELS.RULES_CREATE, rule),
    update: (rule: Rule) => ipcRenderer.invoke(IPC_CHANNELS.RULES_UPDATE, rule),
    delete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.RULES_DELETE, id),
    toggle: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.RULES_TOGGLE, id),
    onRuleCreated: (callback: (rule: Rule) => void) => {
      const handler = (_event: any, rule: Rule) => callback(rule);
      ipcRenderer.on(IPC_CHANNELS.RULES_CREATED, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.RULES_CREATED, handler);
    },
  },

  // Breakpoint
  breakpoint: {
    onPaused: (callback: (data: { flowId: string; flow: HttpFlow; phase: string }) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.BREAKPOINT_PAUSED, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.BREAKPOINT_PAUSED, handler);
    },
    resume: (flowId: string, action: 'forward' | 'drop', modifications?: any) =>
      ipcRenderer.invoke(IPC_CHANNELS.BREAKPOINT_RESUME, { flowId, action, modifications }),
  },

  // Agent
  agent: {
    sendMessage: (message: string, conversationId?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.AGENT_SEND_MESSAGE, { message, conversationId }),
    onMessageDelta: (callback: (data: { content: string; conversationId: string }) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.AGENT_MESSAGE_DELTA, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_MESSAGE_DELTA, handler);
    },
    onMessageComplete: (callback: (data: { content: string; conversationId: string }) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.AGENT_MESSAGE_COMPLETE, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_MESSAGE_COMPLETE, handler);
    },
    onToolCall: (callback: (data: { name: string; args: any; result?: any }) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.AGENT_TOOL_CALL, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_TOOL_CALL, handler);
    },
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.AGENT_STATUS),
    openWindow: () => ipcRenderer.invoke(IPC_CHANNELS.AGENT_OPEN_WINDOW),
    closeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.AGENT_CLOSE_WINDOW),
    onWindowClosed: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on(IPC_CHANNELS.AGENT_WINDOW_CLOSED, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_WINDOW_CLOSED, handler);
    },
    onPermissionRequest: (callback: (data: { id: string; toolName: string; arguments: Record<string, unknown> }) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.AGENT_PERMISSION_REQUEST, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AGENT_PERMISSION_REQUEST, handler);
    },
    respondPermission: (id: string, approved: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.AGENT_PERMISSION_RESPONSE, { id, approved }),
    setAutoApprove: (autoApprove: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.AGENT_SET_AUTO_APPROVE, autoApprove),
  },

  // App
  app: {
    getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION),
    exportHar: (flowIds?: string[]) => ipcRenderer.invoke(IPC_CHANNELS.APP_EXPORT_HAR, flowIds),
    importHar: () => ipcRenderer.invoke(IPC_CHANNELS.APP_IMPORT_HAR),
  },

  // Debug
  debug: {
    getInterceptorState: () => ipcRenderer.invoke('debug:interceptor-state'),
  },
};

export type ProxyBoyAPI = typeof api;

contextBridge.exposeInMainWorld('proxyboy', api);
