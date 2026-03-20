import { EventEmitter } from 'events';
import { Proxy } from 'http-mitm-proxy';
import type { IProxy } from 'http-mitm-proxy';
import * as http from 'http';
import * as https from 'https';
import { randomUUID } from 'crypto';
import { gunzipSync, inflateSync, brotliDecompressSync } from 'zlib';
import { HttpFlow, HttpRequest, HttpResponse } from '../../shared/types';
import { INTERNAL_COMPOSER_HEADER, INTERNAL_REPLAY_HEADER } from '../../shared/constants';
import { CertificateManager } from './certificate';
import { Interceptor } from './interceptor';
import { DnsResolverService } from './dns-resolver';
import { buildSslPinningGuidance, isSuspectedSslPinningError } from './ssl-pinning';
import { ProxyEngineOptions } from './types';
import { annotateGraphQLRequest } from '../../shared/graphql';
import { applyNoCacheToRequestHeaders, applyNoCacheToResponseHeaders } from './no-cache';
import { resolveMapRemoteUrl } from './map-remote';
import { createFlowThrottleController } from './throttle';
import { executeScriptRule } from '../scripting/runner';
import {
  createWebSocketFrame,
  flushSseBuffer,
  isSseContentType,
  isWebSocketUpgrade,
  parseSseChunk,
} from './streaming';
import {
  DEFAULT_THROTTLE_SETTINGS,
  normalizeThrottleSettings,
  resolveThrottleProfile,
  type ThrottleSettings,
} from '../../shared/throttle';
import {
  DEFAULT_UPSTREAM_PROXY_SETTINGS,
  normalizeUpstreamProxySettings,
  shouldBypassUpstreamProxy,
  type UpstreamProxySettings,
} from '../../shared/upstream-proxy';
import {
  createDirectAgents,
  createUpstreamProxyAgents,
  type UpstreamProxyAgents,
} from './upstream-proxy';

const MAX_FLOWS = 10000;
const MAX_BODY_SIZE = 2 * 1024 * 1024; // 2 MB
const MAX_STREAM_ITEMS = 500;

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

function appendFlowNote(flow: HttpFlow, note: string): void {
  flow.notes = flow.notes ? `${flow.notes}\n${note}` : note;
}

function cloneHeaders(headers: Record<string, string | string[]>): Record<string, string | string[]> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]),
  );
}

function updateHeaderContainer(
  target: Record<string, string | string[]>,
  nextHeaders: Record<string, string | string[]>,
): void {
  for (const key of Object.keys(target)) {
    if (!(key in nextHeaders)) {
      delete target[key];
    }
  }
  for (const [key, value] of Object.entries(nextHeaders)) {
    target[key] = Array.isArray(value) ? [...value] : value;
  }
}

function normalizeMutableRequest(
  current: HttpRequest,
  next: HttpRequest,
): { request: HttpRequest; requestTargetChanged: boolean; note?: string } {
  let request = next;
  let note: string | undefined;
  let requestTargetChanged = false;

  try {
    const parsed = new URL(next.url);
    if ((parsed.protocol === 'https:' ? 'https' : 'http') !== current.protocol) {
      throw new Error('Request scripts must keep the original protocol.');
    }
    request = {
      ...next,
      protocol: current.protocol,
      url: parsed.toString(),
      host: parsed.host,
      path: `${parsed.pathname}${parsed.search}`,
      headers: {
        ...cloneHeaders(next.headers),
        host: parsed.host,
      },
    };
    requestTargetChanged = current.method !== request.method
      || current.url !== request.url
      || current.host !== request.host
      || current.path !== request.path;
  } catch (error) {
    request = {
      ...current,
      headers: cloneHeaders(next.headers),
      body: next.body,
      bodySize: next.bodySize,
    };
    note = error instanceof Error ? error.message : 'Request script produced an invalid URL.';
  }

  return { request, requestTargetChanged, note };
}

function syncProxyRequestOptions(ctx: any, request: HttpRequest): void {
  if (!ctx.proxyToServerRequestOptions) {
    return;
  }

  ctx.proxyToServerRequestOptions.method = request.method;
  ctx.proxyToServerRequestOptions.path = request.path;
  ctx.proxyToServerRequestOptions.host = request.host.split(':')[0];
  ctx.proxyToServerRequestOptions.port = request.host.includes(':')
    ? Number(request.host.split(':').pop())
    : (request.protocol === 'https' ? 443 : 80);
  ctx.proxyToServerRequestOptions.headers = cloneHeaders(request.headers);
}

function syncPendingRequestHeaders(ctx: any, request: HttpRequest): void {
  updateHeaderContainer(ctx.clientToProxyRequest.headers as Record<string, string | string[]>, request.headers);
  ctx.clientToProxyRequest.method = request.method;
  ctx.clientToProxyRequest.url = request.path;
}

function syncActiveRequestHeaders(ctx: any, request: HttpRequest): void {
  if (!ctx.proxyToServerRequest) {
    return;
  }

  const currentHeaders = ctx.proxyToServerRequest.getHeaders();
  for (const key of Object.keys(currentHeaders)) {
    if (!(key in request.headers)) {
      ctx.proxyToServerRequest.removeHeader(key);
    }
  }

  for (const [key, value] of Object.entries(request.headers)) {
    ctx.proxyToServerRequest.setHeader(key, value as string | string[]);
  }
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
  private throttleSettings: ThrottleSettings = DEFAULT_THROTTLE_SETTINGS;
  private upstreamProxySettings: UpstreamProxySettings;
  private directAgents: UpstreamProxyAgents;
  private upstreamAgents: UpstreamProxyAgents | null;

  constructor(options: ProxyEngineOptions, certManager: CertificateManager) {
    super();
    this.options = options;
    this.certManager = certManager;
    this.interceptor = new Interceptor();
    this.dnsResolver = new DnsResolverService();
    this.proxy = new Proxy();
    this.upstreamProxySettings = normalizeUpstreamProxySettings(options.upstreamProxySettings);
    this.directAgents = createDirectAgents();
    this.upstreamAgents = createUpstreamProxyAgents(this.upstreamProxySettings);
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

  getThrottleSettings(): ThrottleSettings {
    return this.throttleSettings;
  }

  getThrottleProfile() {
    return resolveThrottleProfile(this.throttleSettings);
  }

  setThrottleSettings(settings: ThrottleSettings): void {
    this.throttleSettings = normalizeThrottleSettings(settings);
  }

  getUpstreamProxySettings(): UpstreamProxySettings {
    return this.upstreamProxySettings;
  }

  setUpstreamProxySettings(settings: UpstreamProxySettings): void {
    this.upstreamProxySettings = normalizeUpstreamProxySettings(settings);
    this.upstreamAgents = createUpstreamProxyAgents(this.upstreamProxySettings);
    const activeAgents = this.getDefaultAgents();
    this.proxy.httpAgent = activeAgents.httpAgent;
    this.proxy.httpsAgent = activeAgents.httpsAgent;
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

  private emitFlowUpdate(flow: HttpFlow): void {
    this.flows.set(flow.id, flow);
    this.emit('flow:response', flow);
  }

  private createWebSocketFlow(ctx: any): HttpFlow | null {
    const upgradeReq = ctx.clientToProxyWebSocket?.upgradeReq;
    if (!upgradeReq) {
      return null;
    }

    const requestMethod = upgradeReq.method || 'GET';
    const requestHost = upgradeReq.headers.host || '';
    const requestPath = upgradeReq.url || '/';
    const requestUrl = (ctx.isSSL ? 'wss' : 'ws') + '://' + requestHost + requestPath;

    if (!this.interceptor.shouldCapture(requestUrl, requestMethod)) {
      return null;
    }

    const startTime = Date.now();
    const flow: HttpFlow = {
      id: randomUUID(),
      request: {
        id: randomUUID(),
        method: requestMethod,
        url: requestUrl,
        protocol: ctx.isSSL ? 'https' : 'http',
        host: requestHost,
        path: requestPath,
        headers: { ...upgradeReq.headers },
        bodySize: 0,
        timestamp: startTime,
      },
      response: {
        id: randomUUID(),
        requestId: '',
        statusCode: 101,
        statusMessage: 'Switching Protocols',
        headers: {
          upgrade: 'websocket',
          connection: 'Upgrade',
        },
        bodySize: 0,
        timestamp: startTime,
        duration: 0,
      },
      state: 'pending',
      tags: ['websocket'],
      createdAt: startTime,
      timing: { start: startTime, responseStart: startTime },
      streamKind: 'websocket',
      streamOpen: true,
      websocketFrames: [],
    };
    flow.response!.requestId = flow.request.id;
    return flow;
  }

  private capStreamItems<T>(items: T[], flow: HttpFlow, tag: string): T[] {
    if (items.length <= MAX_STREAM_ITEMS) {
      return items;
    }
    if (!flow.tags.includes(tag)) {
      flow.tags.push(tag);
    }
    return items.slice(items.length - MAX_STREAM_ITEMS);
  }

  private markFlowAsSslPinningSuspected(flowId: string | undefined, error: unknown): void {
    if (!flowId) {
      return;
    }

    const flow = this.flows.get(flowId);
    if (!flow || flow.tags.includes('ssl-pinning-suspected')) {
      return;
    }

    flow.state = 'error';
    flow.tags.push('ssl-pinning-suspected');
    flow.notes = flow.notes
      ? `${flow.notes}\n${buildSslPinningGuidance(error)}`
      : buildSslPinningGuidance(error);
    if (flow.timing && flow.timing.responseEnd == null) {
      flow.timing.responseEnd = Date.now();
    }
    this.flows.set(flowId, flow);
    this.emit('flow:complete', flow);
  }

  private setup(): void {
    if (this.setupDone) return;
    this.setupDone = true;

    this.proxy.onError((ctx, err, errorKind) => {
      const proxyContext = ctx as { proxyboyFlowId?: unknown };
      const flowId = typeof proxyContext.proxyboyFlowId === 'string' ? proxyContext.proxyboyFlowId : undefined;
      const suspectedSslPinning = isSuspectedSslPinningError(err);

      // Suppress ALL common transient errors silently
      const suppressedKinds = [
        'HTTPS_CLIENT_ERROR',
        'PROXY_TO_SERVER_REQUEST_ERROR',
        'ERR_HTTP_REQUEST_TIMEOUT',
      ];
      if (suppressedKinds.includes(errorKind || '') && !suspectedSslPinning) return;

      const suppressedCodes = [
        'ECONNRESET',
        'ECONNREFUSED',
        'ETIMEDOUT',
        'EPIPE',
        'ERR_SSL_SSLV3_ALERT_CERTIFICATE_UNKNOWN',
        'ERR_HTTP_REQUEST_TIMEOUT',
        'HPE_HEADER_OVERFLOW',
      ];
      if (err && suppressedCodes.includes((err as any)?.code) && !suspectedSslPinning) return;

      if (suspectedSslPinning) {
        this.markFlowAsSslPinningSuspected(flowId, err);
      }

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

    this.proxy.onWebSocketConnection((ctx: any, callback: () => void) => {
      const flow = this.createWebSocketFlow(ctx);
      if (!flow) {
        callback();
        return;
      }

      ctx.proxyboyFlowId = flow.id;
      this.flows.set(flow.id, flow);
      this.emit('flow:start', flow);
      callback();
    });

    this.proxy.onWebSocketFrame((ctx: any, type: string, fromServer: boolean, message: unknown, flags: any, callback: any) => {
      const flowId = ctx.proxyboyFlowId;
      const flow = typeof flowId === 'string' ? this.flows.get(flowId) : undefined;
      if (flow) {
        const nextFrame = createWebSocketFrame(type, fromServer, message);
        flow.websocketFrames = this.capStreamItems([...(flow.websocketFrames ?? []), nextFrame], flow, 'websocket-frames-capped');
        flow.streamKind = 'websocket';
        flow.streamOpen = true;
        if (flow.response) {
          flow.response.duration = Date.now() - flow.createdAt;
        }
        if (flow.timing && flow.timing.firstByte == null) {
          flow.timing.firstByte = Date.now();
        }
        this.emitFlowUpdate(flow);
      }
      callback(null, message, flags);
    });

    this.proxy.onWebSocketClose((ctx: any, code: number, message: unknown, callback: any) => {
      const flowId = ctx.proxyboyFlowId;
      const flow = typeof flowId === 'string' ? this.flows.get(flowId) : undefined;
      if (flow && flow.state !== 'complete' && flow.state !== 'error') {
        flow.streamOpen = false;
        flow.state = 'complete';
        flow.notes = message ? `WebSocket closed (${code}): ${String(message)}` : `WebSocket closed (${code})`;
        if (flow.timing) {
          flow.timing.responseEnd = Date.now();
        }
        if (flow.response) {
          flow.response.duration = Date.now() - flow.createdAt;
        }
        this.flows.set(flow.id, flow);
        this.emit('flow:complete', flow);
      }
      callback(null, code, message);
    });

    this.proxy.onWebSocketError((ctx: any, err?: Error | null) => {
      const flowId = ctx.proxyboyFlowId;
      const flow = typeof flowId === 'string' ? this.flows.get(flowId) : undefined;
      if (flow && flow.state !== 'complete' && flow.state !== 'error') {
        flow.streamOpen = false;
        flow.state = 'error';
        flow.notes = err?.message || 'WebSocket proxy error';
        if (flow.timing) {
          flow.timing.responseEnd = Date.now();
        }
        if (flow.response) {
          flow.response.duration = Date.now() - flow.createdAt;
        }
        this.flows.set(flow.id, flow);
        this.emit('flow:complete', flow);
      }
    });

    this.proxy.onRequest((ctx: any, callback: () => void) => {
      const requestMethod = ctx.clientToProxyRequest.method || 'GET';
      const requestHost = ctx.clientToProxyRequest.headers.host || '';
      const requestUrl = (ctx.isSSL ? 'https' : 'http') + '://' + requestHost + ctx.clientToProxyRequest.url;
      const useUpstreamProxy = this.shouldUseUpstreamProxy(requestUrl, requestHost);

      if (ctx.proxyToServerRequestOptions) {
        const agents = useUpstreamProxy ? (this.upstreamAgents ?? this.directAgents) : this.directAgents;
        ctx.proxyToServerRequestOptions.agent = ctx.isSSL ? agents.httpsAgent : agents.httpAgent;
      }

      if (isWebSocketUpgrade(ctx.clientToProxyRequest.headers)) {
        callback();
        return;
      }

      if (!this.interceptor.shouldCapture(requestUrl, requestMethod)) {
        callback();
        return;
      }

      const flowId = randomUUID();
      ctx.proxyboyFlowId = flowId;
      const chunks: Buffer[] = [];
      const startTime = Date.now();
      const replayed = Boolean(ctx.clientToProxyRequest.headers[INTERNAL_REPLAY_HEADER]);
      const composerRequestIdHeader = ctx.clientToProxyRequest.headers[INTERNAL_COMPOSER_HEADER];
      const composerRequestId = typeof composerRequestIdHeader === 'string'
        ? composerRequestIdHeader
        : Array.isArray(composerRequestIdHeader)
          ? composerRequestIdHeader[0]
          : undefined;
      const throttleController = createFlowThrottleController(this.throttleSettings);
      const throttleProfile = throttleController.getProfile();
      const requestScripts = this.interceptor.getScriptRules(requestUrl, requestMethod, 'request');
      const pendingScriptNotes: string[] = [];
      if (replayed) {
        delete ctx.clientToProxyRequest.headers[INTERNAL_REPLAY_HEADER];
      }
      if (composerRequestId) {
        delete ctx.clientToProxyRequest.headers[INTERNAL_COMPOSER_HEADER];
      }
      const initialTags = replayed ? ['replayed'] : [];
      if (composerRequestId) {
        initialTags.push('composed');
      }
      if (throttleProfile.active) {
        initialTags.push('throttled', `throttle-${throttleProfile.id}`);
      }
      let upstreamProxyNote: string | undefined;

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

      if (useUpstreamProxy) {
        initialTags.push('upstream-proxy', `upstream-${this.upstreamProxySettings.type}`);
        upstreamProxyNote = `Forwarded through ${this.upstreamProxySettings.type.toUpperCase()} upstream proxy ${this.upstreamProxySettings.host}:${this.upstreamProxySettings.port}`;
      } else if (this.upstreamProxySettings.enabled) {
        initialTags.push('upstream-proxy-bypass');
      }

      if (requestScripts.length > 0) {
        let initialRequest = request;
        for (const rule of requestScripts) {
          try {
            const result = executeScriptRule(rule, initialRequest, undefined, true);
            if (result.notes.length > 0) {
              pendingScriptNotes.push(`Script "${rule.name}": ${result.notes.join(' | ')}`);
            }
            const normalized = normalizeMutableRequest(initialRequest, result.request);
            if (normalized.note) {
              pendingScriptNotes.push(`Script "${rule.name}": ${normalized.note}`);
            }
            if (result.blocked) {
              const blockedFlow: HttpFlow = {
                id: flowId,
                request: initialRequest,
                state: 'blocked',
                tags: [...initialTags, 'script-blocked'],
                notes: [...pendingScriptNotes, ...(result.notes.length === 0 ? [`Blocked by script rule "${rule.name}"`] : [])].join('\n'),
                createdAt: startTime,
                timing: { start: startTime, requestEnd: Date.now() },
              };
              this.flows.set(flowId, blockedFlow);
              this.emit('flow:start', blockedFlow);
              this.emit('flow:complete', blockedFlow);
              ctx.proxyToClientResponse.writeHead(403, { 'Content-Type': 'text/plain' });
              ctx.proxyToClientResponse.end('Blocked by ProxyBoy script');
              return;
            }
            initialRequest = {
              ...initialRequest,
              method: normalized.request.method,
              url: normalized.request.url,
              protocol: normalized.request.protocol,
              host: normalized.request.host,
              path: normalized.request.path,
              headers: {
                ...cloneHeaders(initialRequest.headers),
                host: normalized.request.headers.host ?? normalized.request.host,
              },
            };
          } catch (error) {
            pendingScriptNotes.push(`Script "${rule.name}" failed before the request was sent: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        Object.assign(request, initialRequest);
        syncProxyRequestOptions(ctx, request);
        syncPendingRequestHeaders(ctx, request);
      }

      const originalRequestUrl = request.url;
      const responseScripts = this.interceptor.getScriptRules(request.url, request.method, 'response');
      // Check map local
      const mapLocalRule = this.interceptor.getMapLocalRule(originalRequestUrl, request.method);
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

      let mapRemoteNote: string | undefined;
      const mapRemoteRule = this.interceptor.getMapRemoteRule(originalRequestUrl, request.method);
      if (mapRemoteRule) {
        const targetUrl = resolveMapRemoteUrl(mapRemoteRule, originalRequestUrl);

        request.url = targetUrl.toString();
        request.host = targetUrl.host;
        request.path = `${targetUrl.pathname}${targetUrl.search}`;
        request.headers.host = targetUrl.host;
        ctx.clientToProxyRequest.headers.host = targetUrl.host;
        ctx.clientToProxyRequest.url = request.path;

        if (ctx.proxyToServerRequestOptions) {
          ctx.proxyToServerRequestOptions.host = targetUrl.hostname;
          ctx.proxyToServerRequestOptions.port = targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80);
          ctx.proxyToServerRequestOptions.path = request.path;
          ctx.proxyToServerRequestOptions.headers.host = targetUrl.host;
        }

        initialTags.push('map-remote');
        mapRemoteNote = `Map Remote redirected ${originalRequestUrl} -> ${request.url}`;
      }

      const flow: HttpFlow = {
        id: flowId,
        request,
        state: 'pending',
        tags: [...initialTags],
        composerRequestId,
        notes: [mapRemoteNote, upstreamProxyNote].filter(Boolean).join('\n') || undefined,
        createdAt: startTime,
        timing: { start: startTime },
      };

      if (pendingScriptNotes.length > 0) {
        appendFlowNote(flow, pendingScriptNotes.join('\n'));
      }

      this.flows.set(flowId, flow);
      this.emit('flow:start', flow);

      // Collect request body
      ctx.onRequestData((ctx: any, chunk: Buffer, callback: (err: null, chunk: Buffer) => void) => {
        chunks.push(chunk);
        if (requestScripts.length > 0) {
          callback(null, undefined as any);
          return;
        }
        throttleController.scheduleUploadChunk(chunk, callback);
      });

      ctx.onRequestEnd((ctx: any, callback: () => void) => {
        const finishRequest = () => {
          annotateGraphQLRequest(flow.request, flow.tags);
          if (flow.timing) flow.timing.requestEnd = Date.now();
          callback();
        };

        if (chunks.length > 0) {
          const body = Buffer.concat(chunks);
          flow.request.body = body;
          flow.request.bodySize = body.length;
        }

        if (requestScripts.length === 0) {
          finishRequest();
          return;
        }

        let mutatedRequest = flow.request;
        let requestBodyToWrite = Buffer.isBuffer(flow.request.body)
          ? Buffer.from(flow.request.body)
          : Buffer.from(String(flow.request.body ?? ''), 'utf8');

        for (const rule of requestScripts) {
          try {
            const result = executeScriptRule(rule, mutatedRequest, undefined, false);
            if (result.requestTargetModified) {
              appendFlowNote(flow, `Script "${rule.name}" changed the request target after the upstream connection was prepared. The live request kept the earlier URL and method changes only.`);
            }
            if (JSON.stringify(result.request.headers) !== JSON.stringify(mutatedRequest.headers)) {
              appendFlowNote(flow, `Script "${rule.name}" changed request headers after the upstream request started. ProxyBoy kept the earlier header changes and only rewrote the body.`);
            }
            if (result.notes.length > 0) {
              appendFlowNote(flow, `Script "${rule.name}": ${result.notes.join(' | ')}`);
            }
            mutatedRequest = {
              ...mutatedRequest,
              body: result.request.body,
              bodySize: result.request.bodySize,
            };
          } catch (error) {
            appendFlowNote(flow, `Script "${rule.name}" failed while processing the request body: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        flow.request = mutatedRequest;
        requestBodyToWrite = Buffer.isBuffer(flow.request.body)
          ? Buffer.from(flow.request.body)
          : Buffer.from(String(flow.request.body ?? ''), 'utf8');
        flow.request.bodySize = requestBodyToWrite.length;
        flow.tags.push('script-request');
        const requestHeaders = flow.request.headers as Record<string, string | string[]>;
        requestHeaders['content-length'] = String(requestBodyToWrite.length);
        delete requestHeaders['transfer-encoding'];
        syncActiveRequestHeaders(ctx, flow.request);

        if (requestBodyToWrite.length === 0) {
          finishRequest();
          return;
        }

        throttleController.scheduleUploadChunk(requestBodyToWrite, (_err, throttledChunk) => {
          ctx.proxyToServerRequest.write(throttledChunk);
          finishRequest();
        });
      });

      // Collect response
      const responseChunks: Buffer[] = [];
      let firstByteRecorded = false;
      let sseRemainder = '';

      ctx.onResponse((ctx: any, cb: () => void) => {
        if (flow.timing) flow.timing.responseStart = Date.now();
        if (this.noCacheEnabled && ctx.serverToProxyResponse?.headers) {
          applyNoCacheToResponseHeaders(ctx.serverToProxyResponse.headers as Record<string, string | string[]>);
        }
        if (responseScripts.length === 0 && isSseContentType(ctx.serverToProxyResponse?.headers?.['content-type'])) {
          flow.streamKind = 'sse';
          flow.streamOpen = true;
          flow.sseEvents = flow.sseEvents ?? [];
          if (!flow.tags.includes('sse')) {
            flow.tags.push('sse');
          }
          this.emitFlowUpdate(flow);
        }
        if (responseScripts.length > 0 && ctx.serverToProxyResponse) {
          let previewResponse: HttpResponse = {
            id: randomUUID(),
            requestId: request.id,
            statusCode: ctx.serverToProxyResponse.statusCode || 0,
            statusMessage: ctx.serverToProxyResponse.statusMessage || '',
            headers: { ...(ctx.serverToProxyResponse.headers || {}) },
            bodySize: 0,
            timestamp: Date.now(),
            duration: Date.now() - startTime,
          };

          for (const rule of responseScripts) {
            try {
              const result = executeScriptRule(rule, flow.request, previewResponse, false);
              if (result.response) {
                previewResponse = {
                  ...previewResponse,
                  statusCode: result.response.statusCode,
                  statusMessage: result.response.statusMessage,
                  headers: cloneHeaders(result.response.headers),
                };
              }
            } catch (error) {
              appendFlowNote(flow, `Script "${rule.name}" failed before the response body was processed: ${error instanceof Error ? error.message : String(error)}`);
            }
          }

          ctx.serverToProxyResponse.statusCode = previewResponse.statusCode;
          ctx.serverToProxyResponse.statusMessage = previewResponse.statusMessage;
          updateHeaderContainer(
            ctx.serverToProxyResponse.headers as Record<string, string | string[]>,
            previewResponse.headers as Record<string, string | string[]>,
          );
          delete (ctx.serverToProxyResponse.headers as Record<string, string | string[]>)['content-encoding'];
          delete (ctx.serverToProxyResponse.headers as Record<string, string | string[]>)['content-length'];
          delete (ctx.serverToProxyResponse.headers as Record<string, string | string[]>)['transfer-encoding'];
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
              flow.streamOpen = false;
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
        if (flow.streamKind === 'sse') {
          const parsed = parseSseChunk(sseRemainder, chunk);
          sseRemainder = parsed.remainder;
          if (parsed.events.length > 0) {
            flow.sseEvents = this.capStreamItems([...(flow.sseEvents ?? []), ...parsed.events], flow, 'sse-events-capped');
            flow.streamOpen = true;
            this.emitFlowUpdate(flow);
          }
        } else {
          responseChunks.push(chunk);
          if (responseScripts.length > 0) {
            callback(null, undefined as any);
            return;
          }
        }
        throttleController.scheduleDownloadChunk(chunk, callback);
      });

      ctx.onResponseEnd((ctx: any, cb: () => void) => {
        const finalizeFlow = (finalResponse: HttpResponse) => {
          flow.response = finalResponse;
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
        };

        const endTime = Date.now();
        if (flow.timing) flow.timing.responseEnd = endTime;
        if (flow.streamKind === 'sse') {
          const trailingEvents = flushSseBuffer(sseRemainder);
          if (trailingEvents.length > 0) {
            flow.sseEvents = this.capStreamItems([...(flow.sseEvents ?? []), ...trailingEvents], flow, 'sse-events-capped');
          }
          flow.streamOpen = false;
        }

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

        let finalResponse = response;
        if (responseScripts.length > 0) {
          let mutatedResponse = response;
          for (const rule of responseScripts) {
            try {
              const result = executeScriptRule(rule, flow.request, mutatedResponse, false);
              if (result.response) {
                mutatedResponse = {
                  ...mutatedResponse,
                  body: result.response.body,
                  bodySize: result.response.bodySize,
                };
              }
              if (result.responseMetaModified) {
                appendFlowNote(flow, `Script "${rule.name}" changed response metadata after headers were sent. ProxyBoy kept the earlier status/header changes only.`);
              }
              if (result.notes.length > 0) {
                appendFlowNote(flow, `Script "${rule.name}": ${result.notes.join(' | ')}`);
              }
            } catch (error) {
              appendFlowNote(flow, `Script "${rule.name}" failed while processing the response body: ${error instanceof Error ? error.message : String(error)}`);
            }
          }

          const responseBodyToWrite = Buffer.isBuffer(mutatedResponse.body)
            ? Buffer.from(mutatedResponse.body)
            : Buffer.from(String(mutatedResponse.body ?? ''), 'utf8');
          const responseHeaders = mutatedResponse.headers as Record<string, string | string[]>;
          delete responseHeaders['content-encoding'];
          delete responseHeaders['content-length'];
          delete responseHeaders['transfer-encoding'];
          flow.tags.push('script-response');
          finalResponse = {
            ...mutatedResponse,
            headers: responseHeaders,
            bodySize: responseBodyToWrite.length,
          };
          if (ctx.proxyToClientResponse.headersSent === false) {
            ctx.proxyToClientResponse.statusCode = mutatedResponse.statusCode;
            ctx.proxyToClientResponse.statusMessage = mutatedResponse.statusMessage;
            ctx.proxyToClientResponse.removeHeader('transfer-encoding');
            ctx.proxyToClientResponse.removeHeader('content-length');
            ctx.proxyToClientResponse.setHeader('content-length', String(responseBodyToWrite.length));
          }
        }

        if (responseScripts.length > 0) {
          const responseBodyToSend = Buffer.isBuffer(finalResponse.body)
            ? Buffer.from(finalResponse.body)
            : Buffer.from(String(finalResponse.body ?? ''), 'utf8');

          if (responseBodyToSend.length === 0) {
            finalizeFlow(finalResponse);
            return;
          }

          throttleController.scheduleDownloadChunk(responseBodyToSend, (_err, throttledChunk) => {
            ctx.proxyToClientResponse.write(throttledChunk);
            finalizeFlow(finalResponse);
          });
          return;
        }

        finalizeFlow(finalResponse);
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
            flow.streamOpen = false;
            flow.tags.push('breakpoint-dropped');
            this.flows.set(flowId, flow);
            this.emit('flow:complete', flow);
            return;
          }
          this.resolveAndConnect(flow, ctx, callback, throttleController.getConnectionLatencyMs());
        });
        return;
      }

      this.resolveAndConnect(flow, ctx, callback, throttleController.getConnectionLatencyMs());
    });
  }

  /**
   * Performs timed DNS lookup, calls the proxy callback, then hooks the
   * upstream socket to capture TCP connect timing.
   */
  private resolveAndConnect(flow: HttpFlow, ctx: any, callback: () => void, connectionLatencyMs = 0): void {
    const hostname = (flow.request.host || '').split(':')[0];
    if (!hostname) {
      if (connectionLatencyMs > 0) {
        setTimeout(callback, connectionLatencyMs);
        return;
      }
      callback();
      return;
    }

    this.dnsResolver.timedLookup(hostname)
      .then(({ dnsStart, dnsEnd, cacheHit }) => {
        if (flow.timing) {
          flow.timing.dnsStart = dnsStart;
          flow.timing.dnsEnd = dnsEnd;
        }
        if (cacheHit) {
          flow.tags.push('dns-cache-hit');
        }

        const continueConnect = () => {
          if (flow.timing) {
            flow.timing.connectStart = Date.now();
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
        };

        if (connectionLatencyMs > 0) {
          setTimeout(continueConnect, connectionLatencyMs);
          return;
        }

        continueConnect();
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
          httpAgent: this.getDefaultAgents().httpAgent,
          httpsAgent: this.getDefaultAgents().httpsAgent,
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

  private getDefaultAgents(): UpstreamProxyAgents {
    return this.upstreamAgents ?? this.directAgents;
  }

  private shouldUseUpstreamProxy(requestUrl: string, requestHost: string): boolean {
    if (!this.upstreamProxySettings.enabled || !this.upstreamAgents || !this.upstreamProxySettings.host) {
      return false;
    }

    return !shouldBypassUpstreamProxy(requestUrl, requestHost, this.upstreamProxySettings.bypassPatterns);
  }
}
