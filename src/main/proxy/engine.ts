import { EventEmitter } from 'events';
import { Proxy } from 'http-mitm-proxy';
import type { IProxy } from 'http-mitm-proxy';
import { randomUUID } from 'crypto';
import { gunzipSync, inflateSync, brotliDecompressSync } from 'zlib';
import { HttpFlow, HttpRequest, HttpResponse } from '../../shared/types';
import { INTERNAL_REPLAY_HEADER } from '../../shared/constants';
import { CertificateManager } from './certificate';
import { Interceptor } from './interceptor';
import { DnsResolverService } from './dns-resolver';
import { ProxyEngineOptions } from './types';
import { applyNoCacheToRequestHeaders, applyNoCacheToResponseHeaders } from './no-cache';

const MAX_FLOWS = 10000;
const MAX_BODY_SIZE = 2 * 1024 * 1024; // 2 MB

function decompressBody(body: Buffer, encoding?: string): Buffer {
  // Try explicit content-encoding first
  if (encoding) {
    const enc = encoding.toLowerCase().trim();
    try {
      if (enc === 'gzip' || enc === 'x-gzip') return gunzipSync(body);
      if (enc === 'br') return brotliDecompressSync(body);
      if (enc === 'deflate') return inflateSync(body);
    } catch {
      // Fall through to magic-byte detection
    }
  }
  // Auto-detect by magic bytes (handles missing/stripped content-encoding)
  if (body.length >= 2) {
    if (body[0] === 0x1f && body[1] === 0x8b) {
      try { return gunzipSync(body); } catch { /* not gzip */ }
    }
    // Deflate (zlib header: 0x78 0x01/9C/DA)
    if (body[0] === 0x78 && (body[1] === 0x01 || body[1] === 0x9c || body[1] === 0xda)) {
      try { return inflateSync(body); } catch { /* not deflate */ }
    }
  }
  return body;
}

export class ProxyEngine extends EventEmitter {
  private proxy: IProxy;
  private certManager: CertificateManager;
  private interceptor: Interceptor;
  private dnsResolver: DnsResolverService;
  private options: ProxyEngineOptions;
  private flows: Map<string, HttpFlow> = new Map();
  private running = false;
  private setupDone = false;
  private origStdoutWrite: typeof process.stdout.write | null = null;
  private origStderrWrite: typeof process.stderr.write | null = null;
  private noCacheEnabled = false;

  constructor(options: ProxyEngineOptions, certManager: CertificateManager) {
    super();
    this.options = options;
    this.certManager = certManager;
    this.interceptor = new Interceptor();
    this.dnsResolver = new DnsResolverService();
    this.proxy = new Proxy();
  }

  getInterceptor(): Interceptor {
    return this.interceptor;
  }

  getDnsResolver(): DnsResolverService {
    return this.dnsResolver;
  }

  isRunning(): boolean {
    return this.running;
  }

  getPort(): number {
    return this.options.port;
  }

  isNoCacheEnabled(): boolean {
    return this.noCacheEnabled;
  }

  setNoCacheEnabled(enabled: boolean): void {
    this.noCacheEnabled = enabled;
  }

  setPort(port: number): void {
    this.options.port = port;
  }

  getFlows(): HttpFlow[] {
    return Array.from(this.flows.values());
  }

  getFlowCount(): number {
    return this.flows.size;
  }

  getErrorFlowCount(): number {
    let count = 0;
    for (const flow of this.flows.values()) {
      if (flow.response && flow.response.statusCode >= 400) count++;
    }
    return count;
  }

  addFlow(flow: HttpFlow): void {
    this.flows.set(flow.id, flow);
  }

  getFlow(id: string): HttpFlow | undefined {
    return this.flows.get(id);
  }

  deleteFlow(id: string): boolean {
    return this.flows.delete(id);
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
    this.origStderrWrite = origStderrWrite;
    process.stderr.write = (chunk: any, ...args: any[]) => {
      if (shouldSuppressWrite(chunk)) return true;
      return origStderrWrite(chunk, ...args);
    };

    const origStdoutWrite = process.stdout.write.bind(process.stdout);
    this.origStdoutWrite = origStdoutWrite;
    process.stdout.write = (chunk: any, ...args: any[]) => {
      if (shouldSuppressWrite(chunk)) return true;
      return origStdoutWrite(chunk, ...args);
    };

    this.proxy.onRequest((ctx: any, callback: () => void) => {
      const requestMethod = ctx.clientToProxyRequest.method || 'GET';
      const requestHost = ctx.clientToProxyRequest.headers.host || '';
      const requestUrl = (ctx.isSSL ? 'https' : 'http') + '://' + requestHost + ctx.clientToProxyRequest.url;

      if (!this.interceptor.shouldCapture(requestUrl, requestMethod)) {
        callback();
        return;
      }

      const flowId = randomUUID();
      const chunks: Buffer[] = [];
      const startTime = Date.now();
      const replayed = Boolean(ctx.clientToProxyRequest.headers[INTERNAL_REPLAY_HEADER]);
      if (replayed) {
        delete ctx.clientToProxyRequest.headers[INTERNAL_REPLAY_HEADER];
      }
      const initialTags = replayed ? ['replayed'] : [];

      const request: HttpRequest = {
        id: randomUUID(),
        method: requestMethod,
        url: requestUrl,
        protocol: ctx.isSSL ? 'https' : 'http',
        host: requestHost,
        path: ctx.clientToProxyRequest.url || '/',
        headers: { ...ctx.clientToProxyRequest.headers },
        bodySize: 0,
        timestamp: startTime,
      };

      if (this.noCacheEnabled) {
        applyNoCacheToRequestHeaders(request.headers);
        applyNoCacheToRequestHeaders(ctx.clientToProxyRequest.headers as Record<string, string | string[]>);
      }

      // Check map local
      const mapLocalRule = this.interceptor.getMapLocalRule(request.url, request.method);
      if (mapLocalRule) {
        const localResponse = this.interceptor.getMapLocalResponse(mapLocalRule);
        if (localResponse) {
          if (this.noCacheEnabled) {
            applyNoCacheToResponseHeaders(localResponse.headers);
          }
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
            tags: [...initialTags, 'map-local'],
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
        tags: [...initialTags],
        createdAt: startTime,
        timing: { start: startTime },
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
        if (flow.timing) flow.timing.requestEnd = Date.now();
        callback();
      });

      // Collect response
      const responseChunks: Buffer[] = [];
      let firstByteRecorded = false;

      ctx.onResponse((ctx: any, cb: () => void) => {
        if (flow.timing) flow.timing.responseStart = Date.now();
        if (this.noCacheEnabled && ctx.serverToProxyResponse?.headers) {
          applyNoCacheToResponseHeaders(ctx.serverToProxyResponse.headers as Record<string, string | string[]>);
        }
        // Response-phase breakpoint
        const responseBreakRule = this.interceptor.shouldBreakpoint(flow, 'response');
        if (responseBreakRule) {
          this.emit('breakpoint:paused', { flowId, flow, phase: 'response' });
          this.interceptor.pauseFlow(flowId, flow).then(action => {
            if (action === 'drop') {
              try {
                ctx.proxyToClientResponse.writeHead(502, { 'Content-Type': 'text/plain' });
                ctx.proxyToClientResponse.end('Dropped by ProxyBoy breakpoint');
              } catch { /* connection may already be closed */ }
              flow.state = 'blocked';
              flow.tags.push('breakpoint-dropped');
              this.flows.set(flowId, flow);
              this.emit('flow:complete', flow);
              return;
            }
            cb();
          });
          return;
        }
        cb();
      });

      ctx.onResponseData((ctx: any, chunk: Buffer, callback: (err: null, chunk: Buffer) => void) => {
        if (!firstByteRecorded && flow.timing) {
          flow.timing.firstByte = Date.now();
          firstByteRecorded = true;
        }
        responseChunks.push(chunk);
        callback(null, chunk);
      });

      ctx.onResponseEnd((ctx: any, cb: () => void) => {
        const endTime = Date.now();
        if (flow.timing) flow.timing.responseEnd = endTime;

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
          if (action === 'drop') {
            try {
              ctx.proxyToClientResponse.writeHead(502, { 'Content-Type': 'text/plain' });
              ctx.proxyToClientResponse.end('Dropped by ProxyBoy breakpoint');
            } catch { /* connection may already be closed */ }
            flow.state = 'blocked';
            flow.tags.push('breakpoint-dropped');
            this.flows.set(flowId, flow);
            this.emit('flow:complete', flow);
            return;
          }
          this.resolveAndConnect(flow, ctx, callback);
        });
        return;
      }

      this.resolveAndConnect(flow, ctx, callback);
    });
  }

  /**
   * Performs timed DNS lookup, calls the proxy callback, then hooks the
   * upstream socket to capture TCP connect timing.
   */
  private resolveAndConnect(flow: HttpFlow, ctx: any, callback: () => void): void {
    const hostname = (flow.request.host || '').split(':')[0];
    if (!hostname) {
      callback();
      return;
    }

    this.dnsResolver.timedLookup(hostname)
      .then(({ dnsStart, dnsEnd, cacheHit }) => {
        if (flow.timing) {
          flow.timing.dnsStart = dnsStart;
          flow.timing.dnsEnd = dnsEnd;
          flow.timing.connectStart = Date.now();
        }
        if (cacheHit) {
          flow.tags.push('dns-cache-hit');
        }

        callback();

        // Hook upstream socket for TCP connect timing
        process.nextTick(() => {
          try {
            const req = ctx.proxyToServerRequest;
            if (!req) return;

            const socket = req.socket || req.connection;
            if (!socket) {
              req.once?.('socket', (sock: any) => {
                if (sock.connecting) {
                  sock.once('connect', () => {
                    if (flow.timing) flow.timing.connectEnd = Date.now();
                  });
                } else if (flow.timing) {
                  flow.timing.connectEnd = flow.timing.connectStart;
                  flow.tags.push('connection-reused');
                }
              });
              return;
            }

            if (socket.connecting) {
              socket.once('connect', () => {
                if (flow.timing) flow.timing.connectEnd = Date.now();
              });
            } else if (flow.timing) {
              flow.timing.connectEnd = flow.timing.connectStart;
              flow.tags.push('connection-reused');
            }
          } catch {
            // Non-critical — timing just won't include TCP
          }
        });
      })
      .catch((error: Error) => {
        flow.tags.push('dns-error');
        flow.notes = flow.notes ? `${flow.notes}\n${error.message}` : error.message;
        this.emit('proxy:error', error);
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
    this.interceptor.clearPausedFlows();
    this.proxy.close();
    this.running = false;
    if (this.origStdoutWrite) {
      process.stdout.write = this.origStdoutWrite;
      this.origStdoutWrite = null;
    }
    if (this.origStderrWrite) {
      process.stderr.write = this.origStderrWrite;
      this.origStderrWrite = null;
    }
    this.emit('proxy:stopped');
  }
}
