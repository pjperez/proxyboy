import { HttpFlow, HttpRequest, HttpResponse } from '../../shared/types';

export interface ProxyEngineOptions {
  port: number;
  host: string;
  sslCaDir?: string;
  enableSsl: boolean;
}

export interface ProxyEvents {
  'flow:start': (flow: HttpFlow) => void;
  'flow:response': (flow: HttpFlow) => void;
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
