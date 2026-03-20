// IPC Channel names
export const IPC_CHANNELS = {
  // Proxy control
  PROXY_START: 'proxy:start',
  PROXY_STOP: 'proxy:stop',
  PROXY_STATUS: 'proxy:status',
  PROXY_SET_SYSTEM: 'proxy:set-system-proxy',
  PROXY_SET_NO_CACHE: 'proxy:set-no-cache',
  PROXY_SET_THROTTLE: 'proxy:set-throttle',
  PROXY_INSTALL_CERT: 'proxy:install-cert',
  PROXY_CERT_STATUS: 'proxy:cert-status',
  
  // Traffic
  TRAFFIC_NEW_FLOW: 'traffic:new-flow',
  TRAFFIC_FLOW_UPDATED: 'traffic:flow-updated',
  TRAFFIC_FLOW_COMPLETE: 'traffic:flow-complete',
  TRAFFIC_CLEAR: 'traffic:clear',
  TRAFFIC_GET_FLOWS: 'traffic:get-flows',
  TRAFFIC_GET_FLOW: 'traffic:get-flow',
  TRAFFIC_DELETE: 'traffic:delete',
  TRAFFIC_REPEAT: 'traffic:repeat',
  TRAFFIC_COMPOSE: 'traffic:compose',
  
  // Rules
  RULES_GET_ALL: 'rules:get-all',
  RULES_CREATE: 'rules:create',
  RULES_UPDATE: 'rules:update',
  RULES_DELETE: 'rules:delete',
  RULES_TOGGLE: 'rules:toggle',
  RULES_CREATED: 'rules:created',
  RULES_GET_CAPTURE_MODE: 'rules:get-capture-mode',
  RULES_SET_CAPTURE_MODE: 'rules:set-capture-mode',
  
  // Breakpoint
  BREAKPOINT_PAUSED: 'breakpoint:paused',
  BREAKPOINT_RESUME: 'breakpoint:resume',
  
  // Agent
  AGENT_SEND_MESSAGE: 'agent:send-message',
  AGENT_MESSAGE_DELTA: 'agent:message-delta',
  AGENT_MESSAGE_COMPLETE: 'agent:message-complete',
  AGENT_TOOL_CALL: 'agent:tool-call',
  AGENT_STATUS: 'agent:status',
  AGENT_PERMISSION_REQUEST: 'agent:permission-request',
  AGENT_PERMISSION_RESPONSE: 'agent:permission-response',
  AGENT_SET_AUTO_APPROVE: 'agent:set-auto-approve',
  AGENT_OPEN_WINDOW: 'agent:open-window',
  AGENT_CLOSE_WINDOW: 'agent:close-window',
  AGENT_WINDOW_CLOSED: 'agent:window-closed',
  
  // App
  APP_GET_VERSION: 'app:get-version',
  APP_GET_UPDATE_STATE: 'app:get-update-state',
  APP_CHECK_FOR_UPDATES: 'app:check-for-updates',
  APP_SET_AUTO_UPDATE_ENABLED: 'app:set-auto-update-enabled',
  APP_INSTALL_UPDATE: 'app:install-update',
  APP_UPDATE_STATE: 'app:update-state',
  APP_EXPORT_HAR: 'app:export-har',
  APP_IMPORT_HAR: 'app:import-har',
  APP_PICK_FILE: 'app:pick-file',

  // DNS
  DNS_GET_CONFIG: 'dns:get-config',
  DNS_SET_SERVERS: 'dns:set-servers',
  DNS_CLEAR_CACHE: 'dns:clear-cache',
} as const;

export const DEFAULT_PROXY_PORT = 9090;
export const DEFAULT_PROXY_HOST = '127.0.0.1';
export const APP_NAME = 'ProxyBoy';
export const APP_VERSION = '1.0.0';
export const INTERNAL_REPLAY_HEADER = 'x-proxyboy-replay';
export const INTERNAL_COMPOSER_HEADER = 'x-proxyboy-composer-id';
