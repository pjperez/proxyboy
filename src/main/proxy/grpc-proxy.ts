import * as http2 from 'http2';
import * as tls from 'tls';
import type { Socket } from 'net';
import { randomUUID } from 'crypto';
import type { HttpFlow, HttpHeaders, HttpRequest, HttpResponse } from '../../shared/types';
import { GrpcFrameReader, type GrpcMessage } from './grpc-frames';

export interface GrpcProxyCert {
  cert: Buffer | string;
  key: Buffer | string;
}

/** Produces a leaf cert for a hostname (used by the TLS SNI callback). */
export type GrpcCertProvider = (hostname: string) => Promise<GrpcProxyCert>;

export interface GrpcFlowSink {
  onFlowStart(flow: HttpFlow): void;
  onFlowUpdate(flow: HttpFlow, append: GrpcMessage[]): void;
  onFlowComplete(flow: HttpFlow): void;
}

export interface GrpcProxyOptions {
  certProvider: GrpcCertProvider;
  sink: GrpcFlowSink;
  /** Upstream TLS options. Default lenient (rejectUnauthorized: false). */
  upstreamTlsOptions?: tls.SecureContextOptions;
  /** Max retained gRPC messages per direction per flow. */
  maxMessages?: number;
  /** Max bytes per individual gRPC message payload. */
  maxMessageBytes?: number;
}

interface UpstreamSession {
  session: http2.ClientHttp2Session;
  lastUsed: number;
}

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'upgrade',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'host',
]);

function isGrpcContentType(headers: HttpHeaders): boolean {
  const ct = headers['content-type'];
  const value = Array.isArray(ct) ? ct[0] : ct;
  return typeof value === 'string' && value.toLowerCase().includes('grpc');
}

/**
 * HTTP/2 MITM proxy for gRPC traffic. Terminates h2 from the client, forwards
 * each stream to the real upstream over h2, and captures request/response
 * length-prefixed gRPC messages. Designed to be fed raw CONNECT-tunnel sockets
 * (see handleTunnel). Production cert material is injected via certProvider so
 * this module stays decoupled from http-mitm-proxy's CA internals.
 */
export class GrpcProxy {
  private readonly server: http2.Http2SecureServer;
  private readonly upstreamSessions = new Map<string, UpstreamSession>();
  private readonly certContexts = new Map<string, Promise<tls.SecureContext>>();

  constructor(private readonly options: GrpcProxyOptions) {
    this.server = http2.createSecureServer({
      allowHTTP1: false,
      ALPNProtocols: ['h2'],
      SNICallback: (servername, cb) => this.handleSNI(servername, cb),
    });

    this.server.on('stream', (stream, headers) => {
      this.handleStream(stream, headers).catch((err) => {
        this.logError('stream handler failed', err);
        try {
          if (!stream.closed) stream.close(http2.constants.NGHTTP2_INTERNAL_ERROR);
        } catch {
          /* ignore */
        }
      });
    });
    this.server.on('error', (err) => this.logError('h2 server error', err));
  }

  /** Feed a raw CONNECT-tunnel socket into the h2 TLS terminator. */
  handleTunnel(socket: Socket): void {
    // The secure server performs the TLS handshake itself using SNICallback.
    (this.server as unknown as { emit: (event: string, socket: Socket) => boolean }).emit('connection', socket);
  }

  async close(): Promise<void> {
    for (const entry of this.upstreamSessions.values()) {
      try {
        entry.session.close();
      } catch {
        /* ignore */
      }
    }
    this.upstreamSessions.clear();
    this.certContexts.clear();
    await new Promise<void>((resolve) => {
      this.server.close(() => resolve());
    });
  }

  private handleSNI(servername: string, cb: (err: Error | null, ctx?: tls.SecureContext) => void): void {
    let pending = this.certContexts.get(servername);
    if (!pending) {
      pending = this.options
        .certProvider(servername)
        .then(({ cert, key }) =>
          tls.createSecureContext({ cert: cert as Buffer, key: key as Buffer }),
        )
        .catch((err) => {
          this.certContexts.delete(servername);
          throw err;
        });
      this.certContexts.set(servername, pending);
    }
    pending.then((ctx) => cb(null, ctx)).catch((err) => cb(err));
  }

  private getUpstream(authority: string): http2.ClientHttp2Session {
    let entry = this.upstreamSessions.get(authority);
    if (entry && !entry.session.closed && !entry.session.destroyed) {
      entry.lastUsed = Date.now();
      return entry.session;
    }

    const session = http2.connect(authority, {
      rejectUnauthorized: false,
      ...this.options.upstreamTlsOptions,
    });
    session.on('error', (err) => {
      this.logError(`upstream ${authority} error`, err);
      this.upstreamSessions.delete(authority);
    });
    session.on('goaway', () => {
      this.upstreamSessions.delete(authority);
    });
    entry = { session, lastUsed: Date.now() };
    this.upstreamSessions.set(authority, entry);
    return session;
  }

  private async handleStream(
    clientStream: http2.ServerHttp2Stream,
    headers: http2.IncomingHttpHeaders & http2.IncomingHttpStatusHeader,
  ): Promise<void> {
    const method = (headers[':method'] as string) || 'POST';
    const scheme = (headers[':scheme'] as string) || 'https';
    const authority = (headers[':authority'] as string) || '';
    const reqPath = (headers[':path'] as string) || '/';
    const host = authority.split(':')[0];
    const startTime = Date.now();

    const requestHeaders: HttpHeaders = {};
    for (const [key, value] of Object.entries(headers)) {
      if (key.startsWith(':') || key === 'connection' || HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
      requestHeaders[key] = value as string | string[];
    }
    const isGrpc = isGrpcContentType(requestHeaders);

    const request: HttpRequest = {
      id: randomUUID(),
      method,
      url: `${scheme}://${authority}${reqPath}`,
      protocol: 'https',
      host,
      path: reqPath,
      headers: requestHeaders,
      bodySize: 0,
      timestamp: startTime,
    };

    const flow: HttpFlow = {
      id: randomUUID(),
      request,
      state: 'pending',
      tags: isGrpc ? ['grpc'] : ['h2'],
      createdAt: startTime,
      timing: { start: startTime },
      streamKind: isGrpc ? ('grpc' as HttpFlow['streamKind']) : undefined,
    };

    this.options.sink.onFlowStart(flow);

    const reqReader = isGrpc
      ? new GrpcFrameReader('request', this.options.maxMessageBytes, this.options.maxMessages)
      : null;
    const resReader = isGrpc
      ? new GrpcFrameReader('response', this.options.maxMessageBytes, this.options.maxMessages)
      : null;

    // Forward request to the real upstream.
    const upstream = this.getUpstream(`${scheme}://${authority}`);
    const forwardHeaders: Record<string, string> = { [http2.constants.HTTP2_HEADER_PATH]: reqPath };
    if (method) forwardHeaders[http2.constants.HTTP2_HEADER_METHOD] = method;
    if (scheme) forwardHeaders[http2.constants.HTTP2_HEADER_SCHEME] = scheme;
    if (authority) forwardHeaders[http2.constants.HTTP2_HEADER_AUTHORITY] = authority;
    for (const [key, value] of Object.entries(requestHeaders)) {
      forwardHeaders[key] = Array.isArray(value) ? value.join(', ') : String(value);
    }

    const upstreamReq = upstream.request(forwardHeaders);
    let requestBytes = 0;

    clientStream.on('data', (chunk: Buffer) => {
      requestBytes += chunk.length;
      if (reqReader) {
        const msgs = reqReader.feed(chunk);
        if (msgs.length > 0) this.options.sink.onFlowUpdate(flow, msgs);
      }
      if (!upstreamReq.destroyed) upstreamReq.write(chunk);
    });
    clientStream.on('end', () => {
      upstreamReq.end();
    });
    clientStream.on('error', (err) => {
      this.logError('client stream error', err);
      upstreamReq.destroy();
    });

    let responseStatus = 0;
    let responseHeaders: HttpHeaders = {};
    let grpcStatus: string | undefined;
    let grpcMessage: string | undefined;
    let responseBytes = 0;
    let responseStart = 0;
    let responded = false;
    // Upstream trailers captured here and replayed to the client via the
    // 'wantTrailers' event (Node http2 only allows sendTrailers in that window).
    let pendingTrailers: Record<string, string> = {};

    const sendTrailersSafe = (hdrs: Record<string, string>): void => {
      try {
        (clientStream as unknown as { sendTrailers: (h: Record<string, string>) => void }).sendTrailers(hdrs);
      } catch {
        /* ignore — stream may already be closed */
      }
    };

    // wantTrailers fires once, right before the client stream's END_STREAM is
    // emitted, i.e. after we've forwarded all DATA and (hopefully) received the
    // upstream trailers. If trailers never arrived we send an empty set.
    clientStream.on('wantTrailers', () => sendTrailersSafe(pendingTrailers));

    const respond = (status: number, hdrs: HttpHeaders, end = false) => {
      if (responded) return;
      responded = true;
      const out: Record<string, string> = { [http2.constants.HTTP2_HEADER_STATUS]: String(status) };
      for (const [key, value] of Object.entries(hdrs)) {
        if (key.startsWith(':') || key === 'connection' || HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
        out[key] = Array.isArray(value) ? value.join(', ') : String(value);
      }
      clientStream.respond(out, { endStream: end, waitForTrailers: true });
    };

    upstreamReq.on('response', (resHdrs) => {
      responseStart = Date.now();
      responseStatus = Number(resHdrs[':status'] || 0);
      responseHeaders = resHdrs as HttpHeaders;
      respond(responseStatus, responseHeaders, false);
    });
    upstreamReq.on('data', (chunk: Buffer) => {
      responseBytes += chunk.length;
      if (resReader) {
        const msgs = resReader.feed(chunk);
        if (msgs.length > 0) this.options.sink.onFlowUpdate(flow, msgs);
      }
      if (!clientStream.destroyed) clientStream.write(chunk);
    });
    upstreamReq.on('trailers', (trailers) => {
      grpcStatus = (trailers['grpc-status'] as string) ?? undefined;
      grpcMessage = (trailers['grpc-message'] as string) ?? undefined;
      const filtered: Record<string, string> = {};
      for (const [key, value] of Object.entries(trailers)) {
        const lk = key.toLowerCase();
        if (lk === 'host' || HOP_BY_HOP_HEADERS.has(lk)) continue;
        filtered[key] = Array.isArray(value) ? value.join(', ') : String(value);
      }
      pendingTrailers = filtered;
    });
    upstreamReq.on('end', () => {
      if (!responded) respond(responseStatus || 200, responseHeaders, true);
      if (!clientStream.destroyed) clientStream.end();
    });
    upstreamReq.on('error', (err) => {
      this.logError('upstream request error', err);
      flow.state = 'error';
      flow.notes = `Upstream error: ${err instanceof Error ? err.message : String(err)}`;
      if (!responded) {
        respond(http2.constants.HTTP_STATUS_INTERNAL_SERVER_ERROR, {}, true);
      }
      try {
        clientStream.close(http2.constants.NGHTTP2_INTERNAL_ERROR);
      } catch {
        /* ignore */
      }
    });
    clientStream.on('close', () => {
      const endTime = Date.now();
      if (flow.timing) flow.timing.responseEnd = endTime;
      request.bodySize = requestBytes;
      const response: HttpResponse | undefined =
        responseStatus > 0 || responseBytes > 0
          ? {
              id: randomUUID(),
              requestId: request.id,
              statusCode: responseStatus,
              statusMessage: '',
              headers: responseHeaders,
              bodySize: responseBytes,
              timestamp: responseStart || endTime,
              duration: (responseStart || endTime) - startTime,
            }
          : undefined;
      flow.response = response;
      flow.state = response ? 'complete' : flow.state === 'error' ? 'error' : 'complete';
      if (grpcStatus !== undefined) {
        flow.tags.push(`grpc-status-${grpcStatus}`);
      }
      if (grpcMessage) {
        flow.notes = [flow.notes, `grpc-message: ${grpcMessage}`].filter(Boolean).join('\n');
      }
      this.options.sink.onFlowComplete(flow);
    });
  }

  private logError(message: string, err: unknown): void {
    const detail = err instanceof Error ? `${err.message}` : String(err);
    // Suppress transient noise; the engine surfaces real failures via flows.
    if (this.isTransient(err)) return;
    console.error(`[grpc-proxy] ${message}: ${detail}`);
  }

  private isTransient(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const code = (err as NodeJS.ErrnoException).code;
    return (
      code === 'ECONNRESET' ||
      code === 'EPIPE' ||
      code === 'ECONNABORTED' ||
      code === 'ERR_HTTP2_STREAM_ERROR' ||
      code === 'ERR_HTTP2_SESSION_ERROR' ||
      /RST_STREAM|GOAWAY|PROTOCOL_ERROR/.test(err.message)
    );
  }
}
