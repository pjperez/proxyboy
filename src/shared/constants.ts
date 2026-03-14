// IPC Channel names
export const IPC_CHANNELS = {
  // Proxy control
  PROXY_START: 'proxy:start',
  PROXY_STOP: 'proxy:stop',
  PROXY_STATUS: 'proxy:status',
  PROXY_SET_SYSTEM: 'proxy:set-system-proxy',
  PROXY_INSTALL_CERT: 'proxy:install-cert',
  PROXY_CERT_STATUS: 'proxy:cert-status',
  
  // Traffic
  TRAFFIC_NEW_FLOW: 'traffic:new-flow',
  TRAFFIC_FLOW_UPDATED: 'traffic:flow-updated',
  TRAFFIC_FLOW_COMPLETE: 'traffic:flow-complete',
  TRAFFIC_CLEAR: 'traffic:clear',
  TRAFFIC_GET_FLOWS: 'traffic:get-flows',
  TRAFFIC_GET_FLOW: 'traffic:get-flow',
  
  // Rules
  RULES_GET_ALL: 'rules:get-all',
  RULES_CREATE: 'rules:create',
  RULES_UPDATE: 'rules:update',
  RULES_DELETE: 'rules:delete',
  RULES_TOGGLE: 'rules:toggle',
  RULES_CREATED: 'rules:created',
  
  // Breakpoint
  BREAKPOINT_PAUSED: 'breakpoint:paused',
  BREAKPOINT_RESUME: 'breakpoint:resume',
  
  // Agent
  AGENT_SEND_MESSAGE: 'agent:send-message',
  AGENT_MESSAGE_DELTA: 'agent:message-delta',
  AGENT_MESSAGE_COMPLETE: 'agent:message-complete',
  AGENT_TOOL_CALL: 'agent:tool-call',
  AGENT_STATUS: 'agent:status',
  AGENT_OPEN_WINDOW: 'agent:open-window',
  AGENT_CLOSE_WINDOW: 'agent:close-window',
  AGENT_WINDOW_CLOSED: 'agent:window-closed',
  
  // App
  APP_GET_VERSION: 'app:get-version',
  APP_EXPORT_HAR: 'app:export-har',
  APP_IMPORT_HAR: 'app:import-har',
} as const;

export const DEFAULT_PROXY_PORT = 9090;
export const DEFAULT_PROXY_HOST = '127.0.0.1';
export const APP_NAME = 'ProxyBoy';
export const APP_VERSION = '1.0.0';
