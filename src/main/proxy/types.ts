import { HttpFlow, HttpRequest, HttpResponse, TrafficFlowUpdate } from '../../shared/types';
import type { UpstreamProxySettings } from '../../shared/upstream-proxy';

export interface ProxyEngineOptions {
  port: number;
  host: string;
  sslCaDir?: string;
  enableSsl: boolean;
  upstreamProxySettings?: UpstreamProxySettings;
}

export interface ProxyEvents {
  'flow:start': (flow: HttpFlow) => void;
  'flow:response': (update: TrafficFlowUpdate) => void;
  'flow:complete': (flow: HttpFlow) => void;
  'flow:error': (flowId: string, error: Error) => void;
  'proxy:started': (port: number) => void;
  'proxy:stopped': () => void;
  'proxy:error': (error: Error) => void;
}

export interface InterceptContext {
  flowId: string;
  request: HttpRequest;
  response?: HttpResponse;
  shouldIntercept: boolean;
}
