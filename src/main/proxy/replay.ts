import * as http from 'http';
import * as tls from 'tls';
import { URL } from 'url';
import type { HttpFlow, HttpHeaders } from '../../shared/types';
import { INTERNAL_REPLAY_HEADER } from '../../shared/constants';

const REPLAY_TIMEOUT_MS = 30000;
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-length',
  'expect',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function headerValue(value: string | string[]): string {
  return Array.isArray(value) ? value.join(', ') : value;
}

function getRequestBody(body: HttpFlow['request']['body']): { buffer?: Buffer; hasBody: boolean } {
  if (typeof body === 'string') {
    return { buffer: Buffer.from(body), hasBody: true };
  }

  if (Buffer.isBuffer(body)) {
    return { buffer: body, hasBody: true };
  }

  return { hasBody: false };
}

export function buildReplayHeaders(
  headers: HttpHeaders,
  target: URL,
  hasBody: boolean,
  bodyLength: number,
): Record<string, string> {
  const replayHeaders: Record<string, string> = {};

  for (const [name, value] of Object.entries(headers)) {
    const lowerName = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lowerName) || lowerName === 'host') {
      continue;
    }

    replayHeaders[name] = headerValue(value);
  }

  replayHeaders.Host = target.host;
  replayHeaders.Connection = 'close';
  replayHeaders[INTERNAL_REPLAY_HEADER] = '1';

  if (hasBody) {
    replayHeaders['Content-Length'] = String(bodyLength);
  }

  return replayHeaders;
}

export function buildRawHttpRequest(
  method: string,
  target: URL,
  headers: Record<string, string>,
  body?: Buffer,
): Buffer {
  const path = `${target.pathname || '/'}${target.search}`;
  const lines = [`${method} ${path} HTTP/1.1`];

  for (const [name, value] of Object.entries(headers)) {
    lines.push(`${name}: ${value}`);
  }

  const head = Buffer.from(`${lines.join('\r\n')}\r\n\r\n`, 'utf8');
  if (!body || body.length === 0) {
    return head;
  }

  return Buffer.concat([head, body]);
}

function replayHttp(
  flow: HttpFlow,
  proxyPort: number,
  target: URL,
  headers: Record<string, string>,
  body?: Buffer,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      req.destroy(new Error('Replay request timed out.'));
    }, REPLAY_TIMEOUT_MS);

    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      req.removeListener('error', handleError);
      callback();
    };

    const handleError = (error: Error) => {
      settle(() => reject(error));
    };

    const req = http.request(
      {
        host: '127.0.0.1',
        port: proxyPort,
        method: flow.request.method,
        path: target.toString(),
        headers,
      },
      (res) => {
        res.resume();
        res.once('end', () => settle(resolve));
      },
    );

    req.once('error', handleError);

    if (body && body.length > 0) {
      req.write(body);
    }

    req.end();
  });
}

function replayHttps(
  flow: HttpFlow,
  proxyPort: number,
  target: URL,
  headers: Record<string, string>,
  body?: Buffer,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let tlsSocket: tls.TLSSocket | null = null;

    const handleTlsData = () => {
      // Drain the replayed response so the proxy can complete the captured flow.
    };
    const handleTlsEnd = () => {
      settle(resolve);
    };
    const handleTlsClose = (hadError: boolean) => {
      if (!hadError) {
        settle(resolve);
      }
    };
    const handleTlsError = (error: Error) => {
      settle(() => reject(error));
    };
    const handleConnectError = (error: Error) => {
      settle(() => reject(error));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      connectReq.removeListener('error', handleConnectError);
      if (!tlsSocket) return;
      tlsSocket.removeListener('data', handleTlsData);
      tlsSocket.removeListener('end', handleTlsEnd);
      tlsSocket.removeListener('close', handleTlsClose);
      tlsSocket.removeListener('error', handleTlsError);
    };

    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    const timeout = setTimeout(() => {
      if (tlsSocket) {
        tlsSocket.destroy(new Error('Replay request timed out.'));
        return;
      }
      connectReq.destroy(new Error('Replay tunnel timed out.'));
    }, REPLAY_TIMEOUT_MS);

    const connectReq = http.request({
      host: '127.0.0.1',
      port: proxyPort,
      method: 'CONNECT',
      path: `${target.hostname}:${target.port || '443'}`,
    });

    connectReq.once('error', handleConnectError);

    connectReq.once('connect', (res, socket) => {
      connectReq.removeListener('error', handleConnectError);
      if (res.statusCode !== 200) {
        socket.destroy();
        settle(() => reject(new Error(`Replay tunnel failed with status ${res.statusCode}.`)));
        return;
      }

      tlsSocket = tls.connect(
        {
          socket,
          servername: target.hostname,
        },
        () => {
          tlsSocket?.end(buildRawHttpRequest(flow.request.method, target, headers, body));
        },
      );

      tlsSocket.once('error', handleTlsError);
      tlsSocket.on('data', handleTlsData);
      tlsSocket.once('end', handleTlsEnd);
      tlsSocket.once('close', handleTlsClose);
    });

    connectReq.end();
  });
}

export async function replayFlowThroughProxy(flow: HttpFlow, proxyPort: number): Promise<void> {
  const target = new URL(flow.request.url);
  const { buffer: body, hasBody } = getRequestBody(flow.request.body);
  const headers = buildReplayHeaders(flow.request.headers, target, hasBody, body?.length ?? 0);

  if (target.protocol === 'https:') {
    await replayHttps(flow, proxyPort, target, headers, body);
    return;
  }

  if (target.protocol === 'http:') {
    await replayHttp(flow, proxyPort, target, headers, body);
    return;
  }

  throw new Error(`Unsupported replay protocol: ${target.protocol}`);
}
