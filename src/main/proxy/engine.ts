import { EventEmitter } from 'events';
import { Proxy } from 'http-mitm-proxy';
import type { IProxy } from 'http-mitm-proxy';
import { randomUUID } from 'crypto';
import { gunzipSync, inflateSync, brotliDecompressSync } from 'zlib';
import { HttpFlow, HttpRequest, HttpResponse } from '../../shared/types';
import { CertificateManager } from './certificate';
import { Interceptor } from './interceptor';
import { ProxyEngineOptions } from './types';

const MAX_FLOWS = 10000;
const MAX_BODY_SIZE = 2 * 1024 * 1024; // 2 MB

function decompressBody(body: Buffer, encoding?: string): Buffer {
  if (!encoding) return body;
  const enc = encoding.toLowerCase().trim();
  try {
    if (enc === 'gzip' || enc === 'x-gzip') return gunzipSync(body);
    if (enc === 'br') return brotliDecompressSync(body);
    if (enc === 'deflate') return inflateSync(body);
  } catch {
    // Return raw body if decompression fails
    return body;
  }
  return body;
}

export class ProxyEngine extends EventEmitter {
  private proxy: IProxy;
  private certManager: CertificateManager;
  private interceptor: Interceptor;
  private options: ProxyEngineOptions;
  private flows: Map<string, HttpFlow> = new Map();
  private running = false;
  private setupDone = false;

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

  private setup(): void {
    if (this.setupDone) return;
    this.setupDone = true;

    this.proxy.onError((ctx, err, errorKind) => {
      // Suppress ALL common transient errors silently
      const suppressedKinds = [
        'HTTPS_CLIENT_ERROR',
        'PROXY_TO_SERVER_REQUEST_ERROR',
        'ERR_HTTP_REQUEST_TIMEOUT',
      ];
      if (suppressedKinds.includes(errorKind || '')) return;

      const suppressedCodes = [
        'ECONNRESET',
        'ECONNREFUSED',
        'ETIMEDOUT',
        'EPIPE',
        'ERR_SSL_SSLV3_ALERT_CERTIFICATE_UNKNOWN',
        'ERR_HTTP_REQUEST_TIMEOUT',
        'HPE_HEADER_OVERFLOW',
      ];
      if (err && suppressedCodes.includes((err as any)?.code)) return;

      if (err) this.emit('proxy:error', err);
    });

    // Suppress noisy console output from http-mitm-proxy internals.
    const NOISE_PATTERNS = [
      'HTTPS_CLIENT_ERROR',
      'creating SNI context',
      'HPE_HEADER_OVERFLOW',
      'SSLV3_ALERT_CERTIFICATE_UNKNOWN',
      'ERR_HTTP_REQUEST_TIMEOUT',
      'Header overflow',
      'ECONNRESET',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'EPIPE',
      'Socket error',
      'Got ECONNRESET',
      'https server started',
      'SNI enabled',
      'ERR_SSL_',
      'OPENSSL_internal',
      'Parse Error:',
    ];
    let suppressUntil = 0;

    const shouldSuppressWrite = (chunk: any): boolean => {
      const now = Date.now();
      const str = typeof chunk === 'string' ? chunk : chunk?.toString?.() || '';
      if (now < suppressUntil) {
        suppressUntil = now + 200;
        return true;
      }
      for (const p of NOISE_PATTERNS) {
        if (str.includes(p)) {
          suppressUntil = now + 200;
          return true;
        }
      }
      return false;
    };

    const origStderrWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: any, ...args: any[]) => {
      if (shouldSuppressWrite(chunk)) return true;
      return origStderrWrite(chunk, ...args);
    };

    const origStdoutWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: any, ...args: any[]) => {
      if (shouldSuppressWrite(chunk)) return true;
      return origStdoutWrite(chunk, ...args);
    };

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

      ctx.onResponse((ctx: any, cb: () => void) => {
        // Response-phase breakpoint
        const responseBreakRule = this.interceptor.shouldBreakpoint(flow, 'response');
        if (responseBreakRule) {
          this.emit('breakpoint:paused', { flowId, flow, phase: 'response' });
          this.interceptor.pauseFlow(flowId, flow).then(action => {
            if (action === 'drop') return;
            cb();
          });
          return;
        }
        cb();
      });

      ctx.onResponseData((ctx: any, chunk: Buffer, callback: (err: null, chunk: Buffer) => void) => {
        responseChunks.push(chunk);
        callback(null, chunk);
      });

      ctx.onResponseEnd((ctx: any, cb: () => void) => {
        const rawBody = responseChunks.length > 0 ? Buffer.concat(responseChunks) : undefined;
        let responseBody = rawBody ? decompressBody(rawBody, ctx.serverToProxyResponse?.headers?.['content-encoding']) : undefined;

        // Body size cap (2 MB)
        if (responseBody && responseBody.length > MAX_BODY_SIZE) {
          responseBody = responseBody.subarray(0, MAX_BODY_SIZE);
          flow.tags.push('body-truncated');
        }

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

        // Flow retention cap — evict oldest 20% when over limit
        if (this.flows.size > MAX_FLOWS) {
          const deleteCount = Math.floor(MAX_FLOWS * 0.2);
          let deleted = 0;
          for (const key of this.flows.keys()) {
            if (deleted >= deleteCount) break;
            this.flows.delete(key);
            deleted++;
          }
        }

        this.emit('flow:complete', flow);
        cb();
      });

      // Request-phase breakpoint check
      const breakRule = this.interceptor.shouldBreakpoint(flow, 'request');
      if (breakRule) {
        this.emit('breakpoint:paused', { flowId, flow, phase: 'request' });
        this.interceptor.pauseFlow(flowId, flow).then(action => {
          if (action === 'drop') return;
          callback();
        });
        return;
      }

      callback();
    });
  }

  async start(): Promise<void> {
    if (this.running) return;

    await this.certManager.initialize();
    this.setup();

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
