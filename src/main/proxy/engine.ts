import { EventEmitter } from 'events';
import { Proxy } from 'http-mitm-proxy';
import type { IProxy } from 'http-mitm-proxy';
import * as http from 'http';
import * as https from 'https';
import { randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { gunzip, inflate, brotliDecompress } from 'zlib';
import { promisify } from 'util';
import { createBodyCapture, type BodyCapture } from './body-capture';
import { GrpcProxy, type GrpcCertProvider, type GrpcFlowSink } from './grpc-proxy';
import type { GrpcMessage } from './grpc-frames';
import {
  BreakpointRequestEdits,
  BreakpointResponseEdits,
  HttpFlow,
  HttpHeaders,
  HttpRequest,
  HttpResponse,
  StoredBody,
  TrafficFlowUpdate,
} from '../../shared/types';
import { INTERNAL_COMPOSER_HEADER, INTERNAL_REPLAY_HEADER, INTERNAL_TOKEN_HEADER, MAX_FLOWS, MAX_STREAM_ITEMS } from '../../shared/constants';
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

const MAX_BODY_SIZE = 2 * 1024 * 1024; // 2 MB

const gunzipAsync = promisify(gunzip);
const inflateAsync = promisify(inflate);
const brotliDecompressAsync = promisify(brotliDecompress);

/**
 * Decompress a response body off the main event loop. Uses the async zlib
 * APIs so the actual CPU work runs on the libuv thread pool rather than
 * blocking proxy traffic and the UI.
 *
 * Falls back to magic-byte auto-detection when the content-encoding is
 * missing or stripped (e.g. by an upstream proxy).
 */
export async function decompressBody(body: Buffer, encoding?: string | string[]): Promise<Buffer> {
  // Try explicit content-encoding first
  if (encoding) {
    const enc = Array.isArray(encoding) ? encoding[0] : encoding;
    if (enc) {
      const normalizedEncoding = enc.toLowerCase().trim();
      try {
        if (normalizedEncoding === 'gzip' || normalizedEncoding === 'x-gzip') return await gunzipAsync(body);
        if (normalizedEncoding === 'br') return await brotliDecompressAsync(body);
        if (normalizedEncoding === 'deflate') return await inflateAsync(body);
      } catch {
        // Fall through to magic-byte detection
      }
    }
  }
  // Auto-detect by magic bytes (handles missing/stripped content-encoding)
  if (body.length >= 2) {
    if (body[0] === 0x1f && body[1] === 0x8b) {
      try { return await gunzipAsync(body); } catch { /* not gzip */ }
    }
    // Deflate (zlib header: 0x78 0x01/9C/DA)
    if (body[0] === 0x78 && (body[1] === 0x01 || body[1] === 0x9c || body[1] === 0xda)) {
      try { return await inflateAsync(body); } catch { /* not deflate */ }
    }
  }
  return body;
}

function appendFlowNote(flow: HttpFlow, note: string): void {
  flow.notes = flow.notes ? `${flow.notes}\n${note}` : note;
}

function cloneHeaders(headers: HttpHeaders): HttpHeaders {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]),
  );
}

function updateHeaderContainer(target: HttpHeaders, nextHeaders: HttpHeaders): void {
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

function deleteHeaderCaseInsensitive(headers: HttpHeaders, headerName: string): void {
  const targetName = headerName.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === targetName) {
      delete headers[key];
    }
  }
}

function getHeaderValue(headers: HttpHeaders, headerName: string): string | string[] | undefined {
  const targetName = headerName.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === targetName) {
      return value;
    }
  }
  return undefined;
}

function setHeaderValue(headers: HttpHeaders, headerName: string, value: string | string[]): void {
  deleteHeaderCaseInsensitive(headers, headerName);
  headers[headerName] = value;
}

function isProbablyTextBuffer(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(512, buf.length));
  let nonPrintable = 0;
  for (let i = 0; i < sample.length; i += 1) {
    const byte = sample[i];
    if (byte === 0 || (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13)) {
      nonPrintable += 1;
    }
  }
  return nonPrintable <= sample.length * 0.1;
}

function bodyToBuffer(body?: Buffer | string): Buffer | undefined {
  if (body == null) {
    return undefined;
  }

  return Buffer.isBuffer(body) ? Buffer.from(body) : Buffer.from(body, 'utf8');
}

function buffersEqual(left?: Buffer | string, right?: Buffer | string): boolean {
  if (left == null && right == null) {
    return true;
  }
  if (left == null || right == null) {
    return false;
  }

  return bodyToBuffer(left)?.equals(bodyToBuffer(right) ?? Buffer.alloc(0)) ?? false;
}

export function encodeBreakpointBody(body?: Buffer | string): StoredBody | undefined {
  if (body == null) {
    return undefined;
  }
  if (typeof body === 'string') {
    return { data: body, encoding: 'utf8' };
  }
  if (isProbablyTextBuffer(body)) {
    return { data: body.toString('utf8'), encoding: 'utf8' };
  }
  return { data: body.toString('base64'), encoding: 'base64' };
}

function decodeBreakpointBody(body?: StoredBody): Buffer | undefined {
  if (!body) {
    return undefined;
  }
  return body.encoding === 'base64'
    ? Buffer.from(body.data, 'base64')
    : Buffer.from(body.data, 'utf8');
}

function getEditedHost(headers: HttpHeaders, fallbackHost: string): string {
  const hostValue = getHeaderValue(headers, 'host');
  if (typeof hostValue === 'string' && hostValue.trim()) {
    return hostValue.trim();
  }
  if (Array.isArray(hostValue) && hostValue[0]?.trim()) {
    return hostValue[0].trim();
  }
  return fallbackHost;
}

function normalizeBufferedHeaders(
  headers: HttpHeaders,
  body: Buffer | undefined,
  stripContentEncoding = false,
): HttpHeaders {
  const normalizedHeaders = cloneHeaders(headers);
  deleteHeaderCaseInsensitive(normalizedHeaders, 'transfer-encoding');
  if (stripContentEncoding) {
    deleteHeaderCaseInsensitive(normalizedHeaders, 'content-encoding');
  }

  if (body && body.length > 0) {
    setHeaderValue(normalizedHeaders, 'content-length', String(body.length));
  } else {
    deleteHeaderCaseInsensitive(normalizedHeaders, 'content-length');
  }

  return normalizedHeaders;
}

function syncPendingRequestHeaders(ctx: any, request: HttpRequest): void {
  updateHeaderContainer(
    ctx.clientToProxyRequest.headers as Record<string, string | string[]>,
    request.headers,
  );
  ctx.clientToProxyRequest.method = request.method;
  ctx.clientToProxyRequest.url = request.path;

  if (ctx.proxyToServerRequestOptions) {
    ctx.proxyToServerRequestOptions.method = request.method;
    ctx.proxyToServerRequestOptions.path = request.path;
    ctx.proxyToServerRequestOptions.host = request.host.split(':')[0];
    ctx.proxyToServerRequestOptions.port = request.host.includes(':')
      ? Number(request.host.split(':').pop())
      : (request.protocol === 'https' ? 443 : 80);
    ctx.proxyToServerRequestOptions.headers = cloneHeaders(request.headers);
  }
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

export function applyPreparedRequestScriptResult(
  current: HttpRequest,
  next: HttpRequest,
): HttpRequest {
  return {
    ...current,
    method: next.method,
    url: next.url,
    protocol: next.protocol,
    host: next.host,
    path: next.path,
    headers: {
      ...cloneHeaders(next.headers),
      host: next.headers.host ?? next.host,
    },
  };
}

export function applyBreakpointRequestEdits(
  request: HttpRequest,
  edits?: BreakpointRequestEdits,
): HttpRequest {
  const body = edits ? decodeBreakpointBody(edits.body) : bodyToBuffer(request.body);
  const nextHeaders = edits ? cloneHeaders(edits.headers) : cloneHeaders(request.headers);
  const method = (edits?.method?.trim() || request.method || 'GET').toUpperCase();

  let protocol = request.protocol;
  let host = getEditedHost(nextHeaders, request.host);
  let path = request.path;
  let url = `${protocol}://${host}${path}`;

  if (edits?.url?.trim()) {
    try {
      const parsed = new URL(edits.url.trim());
      const nextProtocol = parsed.protocol === 'https:' ? 'https' : parsed.protocol === 'http:' ? 'http' : null;
      if (!nextProtocol) {
        throw new Error('Unsupported protocol');
      }
      if (nextProtocol !== request.protocol) {
        // Keep the original protocol for the in-flight MITM connection.
        protocol = request.protocol;
      } else {
        protocol = nextProtocol;
      }
      host = parsed.host;
      path = `${parsed.pathname || '/'}${parsed.search}`;
      url = `${protocol}://${host}${path}`;
    } catch {
      // Fall back to host/header-derived URL when the edited URL is invalid.
      host = getEditedHost(nextHeaders, request.host);
      path = request.path;
      url = `${protocol}://${host}${path}`;
    }
  } else {
    host = getEditedHost(nextHeaders, request.host);
    url = `${protocol}://${host}${path}`;
  }

  setHeaderValue(nextHeaders, 'host', host);

  return {
    ...request,
    method,
    protocol,
    host,
    path,
    url,
    headers: nextHeaders,
    body,
    bodySize: body?.length ?? 0,
  };
}

export function prepareBreakpointRequestForForwarding(request: HttpRequest): HttpRequest {
  const body = bodyToBuffer(request.body);
  const headers = normalizeBufferedHeaders(request.headers, body);
  const host = getEditedHost(headers, request.host);
  setHeaderValue(headers, 'host', host);

  return {
    ...request,
    host,
    url: `${request.protocol}://${host}${request.path}`,
    headers,
    body,
    bodySize: body?.length ?? 0,
  };
}

export function applyBreakpointResponseEdits(
  response: HttpResponse,
  edits?: BreakpointResponseEdits,
): HttpResponse {
  const body = edits ? decodeBreakpointBody(edits.body) : bodyToBuffer(response.body);
  return {
    ...response,
    statusCode: edits?.statusCode ?? response.statusCode,
    statusMessage: edits?.statusMessage ?? response.statusMessage,
    headers: edits ? cloneHeaders(edits.headers) : cloneHeaders(response.headers),
    body,
    bodySize: body?.length ?? 0,
  };
}

export function prepareBreakpointResponseForForwarding(
  response: HttpResponse,
  stripContentEncoding: boolean,
): HttpResponse {
  const body = bodyToBuffer(response.body);
  return {
    ...response,
    headers: normalizeBufferedHeaders(response.headers, body, stripContentEncoding),
    body,
    bodySize: body?.length ?? 0,
  };
}

export function hasBreakpointResponseChanges(
  original: HttpResponse,
  edited: HttpResponse,
): boolean {
  return original.statusCode !== edited.statusCode
    || original.statusMessage !== edited.statusMessage
    || JSON.stringify(original.headers) !== JSON.stringify(edited.headers)
    || !buffersEqual(original.body, edited.body);
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
  private grpcProxy: GrpcProxy | null = null;
  private readonly internalToken = randomBytes(32).toString('hex');

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

  getInternalToken(): string {
    return this.internalToken;
  }

  private hasValidInternalToken(token: string | undefined): boolean {
    if (!token) {
      return false;
    }
    const a = Buffer.from(token);
    const b = Buffer.from(this.internalToken);
    // Constant-time comparison over fixed-length buffers.
    if (a.length !== b.length) {
      // Still burn equal time to avoid length-based timing leaks.
      timingSafeEqual(b, b);
      return false;
    }
    return timingSafeEqual(a, b);
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

  /**
   * Update the set of hosts whose CONNECT tunnels should be intercepted as
   * HTTP/2 (gRPC) traffic. Applied live to new CONNECT requests; does not
   * disturb already-connected gRPC tunnels.
   */
  setGrpcHosts(hosts: string[]): void {
    this.options.grpcHosts = hosts
      .map((h) => (typeof h === 'string' ? h.trim().toLowerCase() : ''))
      .filter((h) => h.length > 0);
  }

  getGrpcHosts(): string[] {
    return Array.isArray(this.options.grpcHosts) ? [...this.options.grpcHosts] : [];
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

  private emitFlowUpdate(update: TrafficFlowUpdate, flow: HttpFlow): void {
    this.flows.set(flow.id, flow);
    this.emit('flow:response', update);
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

  private appendCappedStreamItems<T>(items: T[] | undefined, nextItems: T[], flow: HttpFlow, tag: string): T[] {
    const target = items ?? [];
    for (const item of nextItems) {
      target.push(item);
    }
    if (target.length <= MAX_STREAM_ITEMS) {
      return target;
    }

    const overflow = target.length - MAX_STREAM_ITEMS;
    target.splice(0, overflow);
    if (!flow.tags.includes(tag)) {
      flow.tags.push(tag);
    }
    return target;
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
        flow.websocketFrames = this.appendCappedStreamItems(flow.websocketFrames, [nextFrame], flow, 'websocket-frames-capped');
        flow.streamKind = 'websocket';
        flow.streamOpen = true;
        if (flow.response) {
          flow.response.duration = Date.now() - flow.createdAt;
        }
        if (flow.timing && flow.timing.firstByte == null) {
          flow.timing.firstByte = Date.now();
        }
        this.emitFlowUpdate({
          id: flow.id,
          streamKind: flow.streamKind,
          streamOpen: flow.streamOpen,
          tags: [...flow.tags],
          appendWebSocketFrames: [nextFrame],
        }, flow);
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

    this.proxy.onConnect((req: http.IncomingMessage, socket: any, _head: any, callback: () => void) => {
      // CONNECT target is "host:port". Intercept only when the host matches the
      // gRPC allowlist; otherwise defer to http-mitm-proxy's default tunnel.
      const target = req.url || '';
      const host = target.split(':')[0].toLowerCase();
      if (host && this.isGrpcTarget(host)) {
        this.handleGrpcConnect(socket as import('net').Socket);
        // Intentionally do NOT call callback(): we own the socket now.
        return;
      }
      callback();
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
      let bufferedRequestBytes = 0;
      let requestBodyTruncated = false;
      const startTime = Date.now();
      // Internal markers are only honored when the request was initiated by this
      // process (replay/compose). Clients can freely spoof the marker headers, so
      // require a per-process secret to accompany them.
      const tokenHeader = ctx.clientToProxyRequest.headers[INTERNAL_TOKEN_HEADER];
      const token = typeof tokenHeader === 'string' ? tokenHeader : Array.isArray(tokenHeader) ? tokenHeader[0] : undefined;
      const trustedInternalRequest = this.hasValidInternalToken(token);
      const replayed = trustedInternalRequest && Boolean(ctx.clientToProxyRequest.headers[INTERNAL_REPLAY_HEADER]);
      const composerRequestIdHeader = trustedInternalRequest ? ctx.clientToProxyRequest.headers[INTERNAL_COMPOSER_HEADER] : undefined;
      const composerRequestId = typeof composerRequestIdHeader === 'string'
        ? composerRequestIdHeader
        : Array.isArray(composerRequestIdHeader)
          ? composerRequestIdHeader[0]
          : undefined;
      const throttleController = createFlowThrottleController(this.throttleSettings);
      const throttleProfile = throttleController.getProfile();
      const requestScripts = this.interceptor.getScriptRules(requestUrl, requestMethod, 'request');
      const pendingScriptNotes: string[] = [];
      // Strip all internal markers before the request leaves the proxy — even
      // spoofed ones — so upstream servers never see them.
      delete ctx.clientToProxyRequest.headers[INTERNAL_REPLAY_HEADER];
      delete ctx.clientToProxyRequest.headers[INTERNAL_COMPOSER_HEADER];
      delete ctx.clientToProxyRequest.headers[INTERNAL_TOKEN_HEADER];
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
            initialRequest = applyPreparedRequestScriptResult(initialRequest, normalized.request);
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
        try {
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
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          initialTags.push('map-remote-invalid');
          mapRemoteNote = `Map Remote rule "${mapRemoteRule.name}" was ignored because its destination URL is invalid: ${message}`;
        }
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
      const shouldPauseRequest = this.interceptor.shouldBreakpoint(flow, 'request') !== null;
      let shouldPauseResponse = false;

      if (pendingScriptNotes.length > 0) {
        appendFlowNote(flow, pendingScriptNotes.join('\n'));
      }

      this.flows.set(flowId, flow);
      this.emit('flow:start', flow);

      const finalizeCompletedFlow = (done: () => void) => {
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
        done();
      };

      // Collect request body (capped at MAX_BODY_SIZE to avoid OOM on large uploads)
      ctx.onRequestData((ctx: any, chunk: Buffer, callback: (err: null, chunk: Buffer) => void) => {
        if (!requestBodyTruncated && bufferedRequestBytes < MAX_BODY_SIZE) {
          const remaining = MAX_BODY_SIZE - bufferedRequestBytes;
          if (chunk.length <= remaining) {
            chunks.push(chunk);
            bufferedRequestBytes += chunk.length;
          } else {
            chunks.push(chunk.subarray(0, remaining));
            bufferedRequestBytes = MAX_BODY_SIZE;
            requestBodyTruncated = true;
          }
        }
        if (requestScripts.length > 0 || shouldPauseRequest) {
          callback(null, undefined as any);
          return;
        }
        throttleController.scheduleUploadChunk(chunk, callback);
      });

      ctx.onRequestEnd((ctx: any, requestEndCallback: () => void) => {
        const finishRequest = () => {
          annotateGraphQLRequest(flow.request, flow.tags);
          if (flow.timing) flow.timing.requestEnd = Date.now();
          requestEndCallback();
        };

        if (chunks.length > 0) {
          const body = Buffer.concat(chunks);
          flow.request.body = body;
          flow.request.bodySize = body.length;
        }
        if (requestBodyTruncated) {
          flow.tags.push('request-body-truncated');
        }

        if (requestScripts.length === 0 && !shouldPauseRequest) {
          finishRequest();
          return;
        }

        // Run request scripts if any
        if (requestScripts.length > 0) {
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
        }

        // Check breakpoint after scripts
        if (shouldPauseRequest) {
          flow.state = 'paused';
          this.flows.set(flowId, flow);
          this.emit('breakpoint:paused', { flowId, flow, phase: 'request' });
          this.interceptor.pauseFlow(flowId, flow).then((resumeData) => {
            const failPausedRequest = (message: string) => {
              try {
                ctx.proxyToServerRequest?.destroy();
                ctx.proxyToClientResponse.writeHead(502, { 'Content-Type': 'text/plain' });
                ctx.proxyToClientResponse.end(message);
              } catch { /* connection may already be closed */ }
              flow.state = 'error';
              flow.notes = flow.notes ? `${flow.notes}\n${message}` : message;
              this.flows.set(flowId, flow);
              this.emit('flow:complete', flow);
            };

            if (resumeData.action === 'drop') {
              try {
                ctx.proxyToServerRequest?.destroy();
                ctx.proxyToClientResponse.writeHead(502, { 'Content-Type': 'text/plain' });
                ctx.proxyToClientResponse.end('Dropped by ProxyBoy breakpoint');
              } catch { /* connection may already be closed */ }
              flow.state = 'blocked';
              flow.tags.push('breakpoint-dropped');
              this.flows.set(flowId, flow);
              this.emit('flow:complete', flow);
              return;
            }

            const editedRequest = applyBreakpointRequestEdits(flow.request, resumeData.request);
            flow.request = prepareBreakpointRequestForForwarding(editedRequest);
            flow.state = 'pending';
            syncPendingRequestHeaders(ctx, flow.request);
            const forwardBufferedRequest = (attemptsRemaining = 200) => {
              if (!ctx.proxyToServerRequest) {
                if (attemptsRemaining <= 0) {
                  failPausedRequest('ProxyBoy could not resume the paused request before the upstream connection timed out.');
                  return;
                }
                setTimeout(() => forwardBufferedRequest(attemptsRemaining - 1), 10);
                return;
              }

              syncActiveRequestHeaders(ctx, flow.request);
              const requestBodyToWrite = bodyToBuffer(flow.request.body);
              if (!requestBodyToWrite || requestBodyToWrite.length === 0) {
                finishRequest();
                return;
              }

              throttleController.scheduleUploadChunk(requestBodyToWrite, (_err, throttledChunk) => {
                ctx.proxyToServerRequest.write(throttledChunk);
                finishRequest();
              });
            };

            forwardBufferedRequest();
          });
        } else if (requestScripts.length > 0) {
          // Scripts only, no breakpoint — forward the scripted body
          const requestBodyToWrite = Buffer.isBuffer(flow.request.body)
            ? Buffer.from(flow.request.body)
            : Buffer.from(String(flow.request.body ?? ''), 'utf8');

          if (requestBodyToWrite.length === 0) {
            finishRequest();
            return;
          }

          throttleController.scheduleUploadChunk(requestBodyToWrite, (_err, throttledChunk) => {
            ctx.proxyToServerRequest.write(throttledChunk);
            finishRequest();
          });
        }
      });

      // Collect response
      const responseChunks: Buffer[] = [];
      let responseBodyBytes = 0;
      let responseBodyTruncated = false;
      let bodyCapture: BodyCapture | null = null;
      let firstByteRecorded = false;
      let sseRemainder = '';
      let responseContentEncoding: string | undefined;
      let writeClientResponseHead: ((...args: any[]) => unknown) | null = null;

      ctx.onResponse((ctx: any, cb: () => void) => {
        if (flow.timing) flow.timing.responseStart = Date.now();
        responseContentEncoding = typeof ctx.serverToProxyResponse?.headers?.['content-encoding'] === 'string'
          ? ctx.serverToProxyResponse.headers['content-encoding']
          : undefined;
        if (this.noCacheEnabled && ctx.serverToProxyResponse?.headers) {
          applyNoCacheToResponseHeaders(ctx.serverToProxyResponse.headers as Record<string, string | string[]>);
        }
        if (responseScripts.length === 0 && !shouldPauseResponse && isSseContentType(ctx.serverToProxyResponse?.headers?.['content-type'])) {
          flow.streamKind = 'sse';
          flow.streamOpen = true;
          flow.sseEvents = flow.sseEvents ?? [];
          if (!flow.tags.includes('sse')) {
            flow.tags.push('sse');
          }
          this.emitFlowUpdate({
            id: flow.id,
            streamKind: flow.streamKind,
            streamOpen: flow.streamOpen,
            tags: [...flow.tags],
          }, flow);
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
          delete (ctx.serverToProxyResponse.headers as Record<string, string | string[]>)['content-length'];
          delete (ctx.serverToProxyResponse.headers as Record<string, string | string[]>)['transfer-encoding'];
          delete (ctx.serverToProxyResponse.headers as Record<string, string | string[]>)['content-encoding'];
        }
        shouldPauseResponse = this.interceptor.shouldBreakpoint(flow, 'response') !== null;
        if (shouldPauseResponse) {
          writeClientResponseHead = ctx.proxyToClientResponse.writeHead.bind(ctx.proxyToClientResponse);
          ctx.proxyToClientResponse.writeHead = ((..._args: any[]) => ctx.proxyToClientResponse) as typeof ctx.proxyToClientResponse.writeHead;
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
            flow.sseEvents = this.appendCappedStreamItems(flow.sseEvents, parsed.events, flow, 'sse-events-capped');
            flow.streamOpen = true;
            this.emitFlowUpdate({
              id: flow.id,
              streamKind: flow.streamKind,
              streamOpen: flow.streamOpen,
              tags: [...flow.tags],
              appendSseEvents: parsed.events,
            }, flow);
          }
        } else if (responseScripts.length > 0 || shouldPauseResponse) {
          if (!responseBodyTruncated && responseBodyBytes < MAX_BODY_SIZE) {
            const remaining = MAX_BODY_SIZE - responseBodyBytes;
            if (chunk.length <= remaining) {
              responseChunks.push(chunk);
              responseBodyBytes += chunk.length;
            } else {
              responseChunks.push(chunk.subarray(0, remaining));
              responseBodyBytes = MAX_BODY_SIZE;
              responseBodyTruncated = true;
            }
          }
          callback(null, undefined as any);
          return;
        } else {
          bodyCapture ??= createBodyCapture(responseContentEncoding, chunk, MAX_BODY_SIZE);
          bodyCapture.feed(chunk);
        }
        throttleController.scheduleDownloadChunk(chunk, callback);
      });

      ctx.onResponseEnd(async (ctx: any, cb: () => void) => {
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
            flow.sseEvents = this.appendCappedStreamItems(flow.sseEvents, trailingEvents, flow, 'sse-events-capped');
          }
          flow.streamOpen = false;
        }

        const rawBody = bodyCapture
          ? undefined
          : (responseChunks.length > 0 ? Buffer.concat(responseChunks) : undefined);
        let responseBody: Buffer | undefined;
        if (bodyCapture) {
          // Streaming passthrough path — body already capped while capturing
          responseBody = await bodyCapture.finish();
          if (bodyCapture.truncated) {
            flow.tags.push('body-truncated');
          }
        } else {
          responseBody = rawBody ? await decompressBody(rawBody, responseContentEncoding) : undefined;

          // Tag if we stopped accumulating during streaming (scripting/breakpoint path)
          if (responseBodyTruncated) {
            flow.tags.push('body-truncated');
          }

          // Body size cap (2 MB) — secondary guard for decompressed bodies
          if (responseBody && responseBody.length > MAX_BODY_SIZE) {
            responseBody = responseBody.subarray(0, MAX_BODY_SIZE);
            flow.tags.push('body-truncated');
          }
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
          if (!shouldPauseResponse && ctx.proxyToClientResponse.headersSent === false) {
            ctx.proxyToClientResponse.statusCode = mutatedResponse.statusCode;
            ctx.proxyToClientResponse.statusMessage = mutatedResponse.statusMessage;
            ctx.proxyToClientResponse.removeHeader('transfer-encoding');
            ctx.proxyToClientResponse.removeHeader('content-length');
            ctx.proxyToClientResponse.setHeader('content-length', String(responseBodyToWrite.length));
          }
        }

        if (shouldPauseResponse) {
          const forwardResponseHead = writeClientResponseHead ?? ctx.proxyToClientResponse.writeHead.bind(ctx.proxyToClientResponse);
          ctx.proxyToClientResponse.writeHead = forwardResponseHead as typeof ctx.proxyToClientResponse.writeHead;
          flow.response = finalResponse;
          flow.state = 'paused';
          this.flows.set(flowId, flow);
          this.emit('breakpoint:paused', { flowId, flow, phase: 'response' });
          this.interceptor.pauseFlow(flowId, flow).then((resumeData) => {
            if (resumeData.action === 'drop') {
              try {
                forwardResponseHead(502, { 'Content-Type': 'text/plain' });
                ctx.proxyToClientResponse.end('Dropped by ProxyBoy breakpoint');
              } catch { /* connection may already be closed */ }
              flow.state = 'blocked';
              flow.tags.push('breakpoint-dropped');
              this.flows.set(flowId, flow);
              this.emit('flow:complete', flow);
              return;
            }

            const editedResponse = applyBreakpointResponseEdits(finalResponse, resumeData.response);
            const responseModified = resumeData.response != null && hasBreakpointResponseChanges(finalResponse, editedResponse);
            const liveResponse = responseModified
              ? prepareBreakpointResponseForForwarding(editedResponse, Boolean(responseContentEncoding))
              : finalResponse;
            const responseBodyToWrite = responseModified
              ? bodyToBuffer(liveResponse.body)
              : rawBody;

            flow.state = 'pending';

            forwardResponseHead(
              liveResponse.statusCode,
              liveResponse.statusMessage,
              liveResponse.headers as Record<string, string | string[]>,
            );

            if (!responseBodyToWrite || responseBodyToWrite.length === 0) {
              finalizeFlow(liveResponse);
              return;
            }

            throttleController.scheduleDownloadChunk(responseBodyToWrite, (_err, throttledChunk) => {
              ctx.proxyToClientResponse.write(throttledChunk);
              finalizeFlow(liveResponse);
            });
          });
          return;
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

  private isGrpcTarget(host: string): boolean {
    const hosts = this.options.grpcHosts;
    if (!hosts || hosts.length === 0) return false;
    return hosts.some((entry) => {
      const h = entry.toLowerCase().trim();
      if (!h) return false;
      return host === h || host.endsWith('.' + h);
    });
  }

  private ensureGrpcProxy(): GrpcProxy | null {
    if (this.grpcProxy) return this.grpcProxy;
    if (!this.options.grpcHosts || this.options.grpcHosts.length === 0) return null;
    this.grpcProxy = new GrpcProxy({
      certProvider: this.createGrpcCertProvider(),
      sink: this.createGrpcFlowSink(),
    });
    return this.grpcProxy;
  }

  private handleGrpcConnect(socket: import('net').Socket): void {
    const proxy = this.ensureGrpcProxy();
    if (!proxy) {
      socket.destroy();
      return;
    }
    try {
      proxy.handleTunnel(socket);
    } catch (err) {
      this.emit('proxy:error', err instanceof Error ? err : new Error(String(err)));
      socket.destroy();
    }
  }

  private createGrpcCertProvider(): GrpcCertProvider {
    return async (hostname: string) => {
      const ca = (this.proxy as unknown as { ca?: { generateServerCertificateKeys?: (...args: unknown[]) => void } }).ca;
      if (!ca || typeof ca.generateServerCertificateKeys !== 'function') {
        throw new Error('CA not initialized; start the proxy first.');
      }
      return await new Promise<{ cert: Buffer; key: Buffer }>((resolve, reject) => {
        ca.generateServerCertificateKeys!(hostname, (certPem: string, keyPem: string) => {
          if (!certPem || !keyPem) {
            reject(new Error(`Failed to generate leaf cert for ${hostname}`));
            return;
          }
          resolve({ cert: Buffer.from(certPem), key: Buffer.from(keyPem) });
        });
      });
    };
  }

  private createGrpcFlowSink(): GrpcFlowSink {
    const toSummary = (m: GrpcMessage) => ({
      direction: m.direction,
      compressed: m.compressed,
      data: m.data.toString('base64'),
      timestamp: m.timestamp,
      ...(m.truncated ? { truncated: true } : {}),
    });
    return {
      onFlowStart: (flow) => {
        this.flows.set(flow.id, flow);
        if (this.flows.size > MAX_FLOWS) {
          const deleteCount = Math.floor(MAX_FLOWS * 0.2);
          const keys = [...this.flows.keys()].slice(0, deleteCount);
          for (const k of keys) this.flows.delete(k);
        }
        this.emit('flow:start', flow);
      },
      onFlowUpdate: (flow, append) => {
        const existing = this.flows.get(flow.id);
        if (existing) {
          existing.grpcMessages = [...(existing.grpcMessages ?? []), ...append.map(toSummary)];
          flow.grpcMessages = existing.grpcMessages;
        } else {
          flow.grpcMessages = append.map(toSummary);
        }
        this.flows.set(flow.id, flow);
        const update: TrafficFlowUpdate = {
          id: flow.id,
          replaceGrpcMessages: flow.grpcMessages,
        };
        this.emit('flow:response', update);
      },
      onFlowComplete: (flow) => {
        this.flows.set(flow.id, flow);
        this.emit('flow:complete', flow);
      },
    };
  }

  async start(): Promise<void> {
    if (this.running) return;

    await this.certManager.initialize();
    this.setup();
    this.installWriteSuppression();

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
            this.restoreWriteSuppression();
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
    this.restoreWriteSuppression();
    if (this.grpcProxy) {
      try {
        await this.grpcProxy.close();
      } catch {
        /* ignore */
      }
      this.grpcProxy = null;
    }
    this.proxy.close();
    this.running = false;
    this.emit('proxy:stopped');
  }

  /**
   * Monkey-patch process.stdout/stderr to suppress noisy output from
   * http-mitm-proxy internals. Idempotent: calling it while already patched is
   * a no-op, and every start() is paired with a restore in stop().
   */
  private installWriteSuppression(): void {
    if (this.origStdoutWrite || this.origStderrWrite) return;

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
  }

  /** Undo installWriteSuppression, restoring the original write functions. */
  private restoreWriteSuppression(): void {
    if (this.origStdoutWrite) {
      process.stdout.write = this.origStdoutWrite;
      this.origStdoutWrite = null;
    }
    if (this.origStderrWrite) {
      process.stderr.write = this.origStderrWrite;
      this.origStderrWrite = null;
    }
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
