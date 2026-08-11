import { describe, expect, it, afterEach } from 'vitest';
import * as http2 from 'http2';
import * as tls from 'tls';
import * as net from 'net';
import forge from 'node-forge';
import { GrpcProxy, type GrpcCertProvider, type GrpcFlowSink } from './grpc-proxy';
import type { GrpcMessage } from './grpc-frames';
import type { HttpFlow } from '../../shared/types';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop();
    if (fn) await fn();
  }
});

/** Build a self-signed CA and a leaf cert signed by it (valid for the given hostnames). */
function buildCerts(hostnames: string[]): { caPem: string; certPem: string; keyPem: string } {
  const caKeys = forge.pki.rsa.generateKeyPair(2048);
  const caCert = forge.pki.createCertificate();
  caCert.publicKey = caKeys.publicKey;
  caCert.serialNumber = '01';
  caCert.validity.notBefore = new Date();
  caCert.validity.notAfter = new Date(Date.now() + 365 * 24 * 3600 * 1000);
  const caAttrs = [
    { name: 'commonName', value: 'ProxyBoy Test CA' },
    { name: 'organizationName', value: 'ProxyBoy Test' },
  ];
  caCert.setSubject(caAttrs);
  caCert.setIssuer(caAttrs);
  caCert.setExtensions([{ name: 'basicConstraints', cA: true }]);
  caCert.sign(caKeys.privateKey, forge.md.sha256.create());

  const leafKeys = forge.pki.rsa.generateKeyPair(2048);
  const leafCert = forge.pki.createCertificate();
  leafCert.publicKey = leafKeys.publicKey;
  leafCert.serialNumber = '02';
  leafCert.validity.notBefore = new Date();
  leafCert.validity.notAfter = new Date(Date.now() + 365 * 24 * 3600 * 1000);
  leafCert.setSubject([{ name: 'commonName', value: hostnames[0] }]);
  leafCert.setIssuer(caCert.subject.attributes);
  leafCert.setExtensions([
    { name: 'basicConstraints', cA: false },
    {
      name: 'subjectAltName',
      altNames: hostnames.map((h) => ({ type: 2, value: h })),
    },
  ]);
  leafCert.sign(caKeys.privateKey, forge.md.sha256.create());

  return {
    caPem: forge.pki.certificateToPem(caCert),
    certPem: forge.pki.certificateToPem(leafCert),
    keyPem: forge.pki.privateKeyToPem(leafKeys.privateKey),
  };
}

/** Encode a single uncompressed gRPC message. */
function grpcFrame(payload: Buffer): Buffer {
  const header = Buffer.alloc(5);
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

function readGrpcFrames(buf: Buffer): Buffer[] {
  const out: Buffer[] = [];
  let i = 0;
  while (i + 5 <= buf.length) {
    const len = buf.readUInt32BE(i + 1);
    const end = i + 5 + len;
    if (end > buf.length) break;
    out.push(buf.subarray(i + 5, end));
    i = end;
  }
  return out;
}

interface Captured {
  starts: HttpFlow[];
  updates: GrpcMessage[][];
  completes: HttpFlow[];
}

function makeSink(captured: Captured): GrpcFlowSink {
  return {
    onFlowStart: (flow) => captured.starts.push(flow),
    onFlowUpdate: (_flow, append) => captured.updates.push(append),
    onFlowComplete: (flow) => captured.completes.push(flow),
  };
}

interface Harness {
  grpcProxy: GrpcProxy;
  relayPort: number;
  originPort: number;
  caPem: string;
  captured: Captured;
}

/**
 * Builds a GrpcProxy plus a TCP relay (simulating a CONNECT tunnel) and a local
 * h2 origin that echoes gRPC requests. Client traffic goes:
 *   h2 client -> TLS -> relay -> GrpcProxy.handleTunnel -> upstream -> origin
 */
async function buildHarness(originHandler: (stream: http2.ServerHttp2Stream) => void): Promise<Harness> {
  const certs = buildCerts(['localhost', 'grpc.test.local']);
  const captured: Captured = { starts: [], updates: [], completes: [] };

  const certProvider: GrpcCertProvider = async () => ({
    cert: certs.certPem,
    key: certs.keyPem,
  });

  const grpcProxy = new GrpcProxy({
    certProvider,
    sink: makeSink(captured),
    // The test origin uses a self-signed cert; explicitly trust it.
    upstreamTlsOptions: { rejectUnauthorized: false },
  });

  // Local h2 origin.
  const origin = http2.createSecureServer({
    cert: certs.certPem,
    key: certs.keyPem,
    allowHTTP1: false,
  });
  origin.on('stream', originHandler);
  await new Promise<void>((resolve) => origin.listen(0, '127.0.0.1', resolve));
  const originPort = (origin.address() as net.AddressInfo).port;

  // TCP relay that feeds raw sockets into the GrpcProxy TLS terminator.
  const relay = net.createServer((socket) => grpcProxy.handleTunnel(socket));
  await new Promise<void>((resolve) => relay.listen(0, '127.0.0.1', resolve));
  const relayPort = (relay.address() as net.AddressInfo).port;

  cleanups.push(async () => {
    // Close in dependency order; destroy lingering sessions so close() resolves.
    try {
      await grpcProxy.close();
    } catch {
      /* ignore */
    }
    await new Promise<void>((r) => {
      relay.close(() => r());
    });
    await new Promise<void>((r) => {
      origin.close(() => r());
    });
  });

  return { grpcProxy, relayPort, originPort, caPem: certs.caPem, captured };
}

/** Open an h2 client session through the relay (TLS-terminated by GrpcProxy). */
function connectClient(h: Harness): http2.ClientHttp2Session {
  const tlss = tls.connect({
    host: '127.0.0.1',
    port: h.relayPort,
    servername: 'grpc.test.local',
    ca: h.caPem,
    ALPNProtocols: ['h2'],
    rejectUnauthorized: false,
  });
  return http2.connect(`https://grpc.test.local:${h.originPort}`, { createConnection: () => tlss });
}

describe('GrpcProxy end-to-end', () => {
  it('captures request and response gRPC messages with grpc-status trailer', async () => {
    const origin = (stream: http2.ServerHttp2Stream) => {
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('wantTrailers', () => {
        (stream as unknown as { sendTrailers: (h: Record<string, string>) => void }).sendTrailers({
          'grpc-status': '0',
        });
      });
      stream.on('end', () => {
        const reqMsgs = readGrpcFrames(Buffer.concat(chunks));
        const echo = grpcFrame(Buffer.from(`pong:${reqMsgs[0]?.toString('utf8') ?? ''}`));
        stream.respond(
          { 'content-type': 'application/grpc', ':status': 200 },
          { waitForTrailers: true },
        );
        stream.end(echo);
      });
    };

    const h = await buildHarness(origin);
    const client = connectClient(h);
    cleanups.push(async () => {
      client.destroy();
      await new Promise<void>((r) => setTimeout(r, 20));
    });

    await new Promise<void>((resolve, reject) => {
      const req = client.request({
        ':method': 'POST',
        ':path': '/helloworld.Greeter/SayHello',
        ':scheme': 'https',
        ':authority': `localhost:${h.originPort}`,
        'content-type': 'application/grpc',
        te: 'trailers',
      });
      req.write(grpcFrame(Buffer.from('ping')));
      req.end();
      const respChunks: Buffer[] = [];
      req.on('response', () => {
        /* headers received */
      });
      req.on('data', (c: Buffer) => respChunks.push(c));
      req.on('end', () => {
        try {
          const respMsgs = readGrpcFrames(Buffer.concat(respChunks));
          expect(respMsgs.length).toBe(1);
          expect(respMsgs[0].toString('utf8')).toBe('pong:ping');
          resolve();
        } catch (err) {
          reject(err);
        }
      });
      req.on('error', reject);
    });

    // Give the proxy a moment to flush flow lifecycle events.
    await new Promise<void>((r) => setTimeout(r, 50));

    expect(h.captured.starts.length).toBe(1);
    expect(h.captured.completes.length).toBe(1);
    const allMsgs = h.captured.updates.flat();
    const reqMsgs = allMsgs.filter((m) => m.direction === 'request');
    const resMsgs = allMsgs.filter((m) => m.direction === 'response');
    expect(reqMsgs.length).toBe(1);
    expect(reqMsgs[0].data.toString('utf8')).toBe('ping');
    expect(resMsgs.length).toBe(1);
    expect(resMsgs[0].data.toString('utf8')).toBe('pong:ping');

    const completed = h.captured.completes[0];
    expect(completed.tags).toContain('grpc');
    expect(completed.tags.some((t) => t.startsWith('grpc-status-'))).toBe(true);
    expect(completed.streamKind).toBe('grpc');
    expect(completed.response?.statusCode).toBe(200);
  }, 15000);

  it('handles non-gRPC h2 traffic (tags h2, captures no grpc messages)', async () => {
    const origin = (stream: http2.ServerHttp2Stream) => {
      stream.respond({ ':status': 204, 'content-type': 'text/plain' });
      stream.end();
    };

    const h = await buildHarness(origin);
    const client = connectClient(h);
    cleanups.push(async () => {
      client.destroy();
      await new Promise<void>((r) => setTimeout(r, 20));
    });

    await new Promise<void>((resolve, reject) => {
      const req = client.request({
        ':method': 'GET',
        ':path': '/health',
        ':scheme': 'https',
        ':authority': `localhost:${h.originPort}`,
      });
      req.resume();
      req.on('end', () => resolve());
      req.on('error', reject);
    });

    await new Promise<void>((r) => setTimeout(r, 50));

    expect(h.captured.starts.length).toBe(1);
    expect(h.captured.completes.length).toBe(1);
    const completed = h.captured.completes[0];
    expect(completed.tags).toContain('h2');
    expect(completed.streamKind).toBeUndefined();
    expect(h.captured.updates.flat().length).toBe(0);
    expect(completed.response?.statusCode).toBe(204);
  }, 15000);
});

// Silence Node's verbose h2 session teardown rejections in test output.
process.on('unhandledRejection', () => {
  /* swallow transient h2 session teardown rejections in tests */
});
