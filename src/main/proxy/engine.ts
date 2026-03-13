import { EventEmitter } from 'events';
import { Proxy } from 'http-mitm-proxy';
import type { IProxy } from 'http-mitm-proxy';
import { randomUUID } from 'crypto';
import { HttpFlow, HttpRequest, HttpResponse } from '../../shared/types';
import { CertificateManager } from './certificate';
import { Interceptor } from './interceptor';
import { ProxyEngineOptions } from './types';

export class ProxyEngine extends EventEmitter {
  private proxy: IProxy;
  private certManager: CertificateManager;
  private interceptor: Interceptor;
  private options: ProxyEngineOptions;
  private flows: Map<string, HttpFlow> = new Map();
  private running = false;

  constructor(options: ProxyEngineOptions, certManager: CertificateManager) {
    super();
    this.options = options;
    this.certManager = certManager;
    this.interceptor = new Interceptor();
    this.proxy = new Proxy();
  }

  getInterceptor(): Interceptor {
    return this.interceptor;
  }

  isRunning(): boolean {
    return this.running;
  }

  getPort(): number {
    return this.options.port;
  }

  getFlows(): HttpFlow[] {
    return Array.from(this.flows.values());
  }

  getFlow(id: string): HttpFlow | undefined {
    return this.flows.get(id);
  }

  clearFlows(): void {
    this.flows.clear();
  }

  async start(): Promise<void> {
    if (this.running) return;

    await this.certManager.initialize();

    this.proxy.onError((ctx, err, errorKind) => {
      // Suppress common transient errors
      if (errorKind === 'HTTPS_CLIENT_ERROR') return;
      if (errorKind === 'PROXY_TO_SERVER_REQUEST_ERROR') return;
      if ((err as any)?.code === 'ECONNRESET') return;
      if (err) this.emit('proxy:error', err);
    });

    this.proxy.onRequest((ctx: any, callback: () => void) => {
      const flowId = randomUUID();
      const chunks: Buffer[] = [];
      const startTime = Date.now();

      const request: HttpRequest = {
        id: randomUUID(),
        method: ctx.clientToProxyRequest.method || 'GET',
        url: (ctx.isSSL ? 'https' : 'http') + '://' + ctx.clientToProxyRequest.headers.host + ctx.clientToProxyRequest.url,
        protocol: ctx.isSSL ? 'https' : 'http',
        host: ctx.clientToProxyRequest.headers.host || '',
        path: ctx.clientToProxyRequest.url || '/',
        headers: { ...ctx.clientToProxyRequest.headers },
        bodySize: 0,
        timestamp: startTime,
      };

      // Check map local
      const mapLocalRule = this.interceptor.getMapLocalRule(request.url, request.method);
      if (mapLocalRule) {
        const localResponse = this.interceptor.getMapLocalResponse(mapLocalRule);
        if (localResponse) {
          ctx.proxyToClientResponse.writeHead(localResponse.statusCode, localResponse.headers);
          ctx.proxyToClientResponse.end(localResponse.body);
          
          const flow: HttpFlow = {
            id: flowId,
            request,
            response: {
              id: randomUUID(),
              requestId: request.id,
              statusCode: localResponse.statusCode,
              statusMessage: 'OK (Map Local)',
              headers: localResponse.headers,
              body: localResponse.body,
              bodySize: localResponse.body.length,
              timestamp: Date.now(),
              duration: Date.now() - startTime,
            },
            state: 'complete',
            tags: ['map-local'],
            createdAt: startTime,
          };
          this.flows.set(flowId, flow);
          this.emit('flow:complete', flow);
          return;
        }
      }

      const flow: HttpFlow = {
        id: flowId,
        request,
        state: 'pending',
        tags: [],
        createdAt: startTime,
      };

      this.flows.set(flowId, flow);
      this.emit('flow:start', flow);

      // Collect request body
      ctx.onRequestData((ctx: any, chunk: Buffer, callback: (err: null, chunk: Buffer) => void) => {
        chunks.push(chunk);
        callback(null, chunk);
      });

      ctx.onRequestEnd((ctx: any, callback: () => void) => {
        if (chunks.length > 0) {
          const body = Buffer.concat(chunks);
          flow.request.body = body;
          flow.request.bodySize = body.length;
        }
        callback();
      });

      // Collect response
      const responseChunks: Buffer[] = [];

      ctx.onResponse((ctx: any, callback: () => void) => {
        callback();
      });

      ctx.onResponseData((ctx: any, chunk: Buffer, callback: (err: null, chunk: Buffer) => void) => {
        responseChunks.push(chunk);
        callback(null, chunk);
      });

      ctx.onResponseEnd((ctx: any, callback: () => void) => {
        const responseBody = responseChunks.length > 0 ? Buffer.concat(responseChunks) : undefined;
        const response: HttpResponse = {
          id: randomUUID(),
          requestId: request.id,
          statusCode: ctx.serverToProxyResponse?.statusCode || 0,
          statusMessage: ctx.serverToProxyResponse?.statusMessage || '',
          headers: { ...(ctx.serverToProxyResponse?.headers || {}) },
          body: responseBody,
          bodySize: responseBody?.length || 0,
          timestamp: Date.now(),
          duration: Date.now() - startTime,
        };

        flow.response = response;
        flow.state = 'complete';
        this.flows.set(flowId, flow);
        this.emit('flow:complete', flow);
        callback();
      });

      callback();
    });

    return new Promise<void>((resolve, reject) => {
      this.proxy.listen(
        {
          port: this.options.port,
          host: this.options.host,
          sslCaDir: this.certManager.getSslCaDir(),
          keepAlive: true,
          forceSNI: true,
        },
        (err?: Error) => {
          if (err) {
            reject(err);
            return;
          }
          this.running = true;
          this.emit('proxy:started', this.options.port);
          resolve();
        }
      );
    });
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.proxy.close();
    this.running = false;
    this.emit('proxy:stopped');
  }
}
