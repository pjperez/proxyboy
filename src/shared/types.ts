// Core HTTP flow types
export interface HttpHeaders {
  [key: string]: string | string[];
}

export interface HttpRequest {
  id: string;
  method: string;
  url: string;
  protocol: 'http' | 'https';
  host: string;
  path: string;
  headers: HttpHeaders;
  body?: Buffer | string;
  bodySize: number;
  timestamp: number;
}

export interface HttpResponse {
  id: string;
  requestId: string;
  statusCode: number;
  statusMessage: string;
  headers: HttpHeaders;
  body?: Buffer | string;
  bodySize: number;
  timestamp: number;
  duration: number;
}

export interface HttpFlow {
  id: string;
  request: HttpRequest;
  response?: HttpResponse;
  state: FlowState;
  tags: string[];
  notes?: string;
  createdAt: number;
}

export type FlowState = 'pending' | 'complete' | 'error' | 'paused' | 'blocked';

// Proxy state
export interface ProxyState {
  running: boolean;
  port: number;
  host: string;
  isSystemProxy: boolean;
  totalRequests: number;
  activeConnections: number;
  sslEnabled: boolean;
}

// Filter types
export interface FilterCriteria {
  text?: string;
  methods?: string[];
  statusCodes?: StatusCodeRange[];
  contentTypes?: string[];
  protocols?: ('http' | 'https')[];
  minDuration?: number;
  maxDuration?: number;
  hasError?: boolean;
}

export interface StatusCodeRange {
  min: number;
  max: number;
  label: string;
}

// Rule types
export type RuleType = 'breakpoint' | 'map-local';

export interface Rule {
  id: string;
  type: RuleType;
  name: string;
  enabled: boolean;
  matchCriteria: MatchCriteria;
  createdAt: number;
  updatedAt: number;
}

export interface MatchCriteria {
  urlPattern: string;
  methods?: string[];
  isRegex?: boolean;
}

export interface BreakpointRule extends Rule {
  type: 'breakpoint';
  breakOn: 'request' | 'response' | 'both';
}

export interface MapLocalRule extends Rule {
  type: 'map-local';
  localFilePath: string;
  statusCode?: number;
  responseHeaders?: HttpHeaders;
}

// Agent types
export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: AgentToolCall[];
  timestamp: number;
}

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  status: 'pending' | 'running' | 'complete' | 'error';
}

export interface AgentConversation {
  id: string;
  title: string;
  messages: AgentMessage[];
  createdAt: number;
  updatedAt: number;
}

// IPC channel types
export interface ProxyControlMessage {
  action: 'start' | 'stop' | 'restart';
  port?: number;
}

export interface TrafficUpdateMessage {
  type: 'new-flow' | 'flow-updated' | 'flow-complete';
  flow: HttpFlow;
}

export interface BreakpointPauseMessage {
  flowId: string;
  flow: HttpFlow;
  phase: 'request' | 'response';
}

export interface BreakpointResumeMessage {
  flowId: string;
  action: 'forward' | 'drop';
  modifiedRequest?: Partial<HttpRequest>;
  modifiedResponse?: Partial<HttpResponse>;
}
