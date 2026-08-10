import { describe, expect, it, vi, afterEach } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
}));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import { gunzipSync, gzipSync } from 'zlib';
import { ProxyEngine } from './engine';
import { CertificateManager } from './certificate';
import type { HttpFlow } from '../../shared/types';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup) await cleanup();
  }
});

interface TestProxy {
  engine: ProxyEngine;
  port: number;
  certDir: string;
}

async function startProxy(): Promise<TestProxy> {
  const certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxyboy-engine-'));
  const certManager = new CertificateManager(certDir);
  const engine = new ProxyEngine(
    { port: 0, host: '127.0.0.1', enableSsl: true },
    certManager,
  );
  await engine.start();
  // http-mitm-proxy exposes the bound port after listen
  const port = (engine as any).proxy.httpPort as number;
  expect(port).toBeGreaterThan(0);

  cleanups.push(async () => {
    await engine.stop();
    fs.rmSync(certDir, { recursive: true, force: true });
  });

  return { engine, port, certDir };
}

function startOrigin(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      cleanups.push(async () => new Promise((done) => server.close(() => done())));
      resolve({ server, port });
    });
  });
}

function requestThroughProxy(
  proxyPort: number,
  originPort: number,
  proxyPath: string,
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: proxyPort,
      method: 'GET',
      path: proxyPath,
      headers: { Host: `127.0.0.1:${originPort}` },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

function postThroughProxy(
  proxyPort: number,
  originPort: number,
  proxyPath: string,
  body: Buffer,
): Promise<{ statusCode: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: proxyPort,
      method: 'POST',
      path: proxyPath,
      headers: {
        Host: `127.0.0.1:${originPort}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(body.length),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function waitForFlowComplete(engine: ProxyEngine): Promise<HttpFlow> {
  return new Promise((resolve) => {
    engine.once('flow:complete', (flow: HttpFlow) => resolve(flow));
  });
}

describe('ProxyEngine integration', () => {
  it('captures a plain HTTP request/response end to end', async () => {
    const { engine, port } = await startProxy();
    const origin = await startOrigin((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('hello from origin');
    });

    const flowPromise = waitForFlowComplete(engine);
    const client = await requestThroughProxy(port, origin.port, '/hello');
    const flow = await flowPromise;

    expect(client.statusCode).toBe(200);
    expect(client.body.toString()).toBe('hello from origin');
    expect(flow.state).toBe('complete');
    expect(flow.request.method).toBe('GET');
    expect(flow.request.host).toBe(`127.0.0.1:${origin.port}`);
    expect(flow.response?.statusCode).toBe(200);
    expect(flow.response?.body?.toString()).toBe('hello from origin');
  });

  it('decompresses a gzip response body in the captured flow', async () => {
    const { engine, port } = await startProxy();
    const plain = Buffer.from('gzipped payload! '.repeat(100));
    const origin = await startOrigin((_req, res) => {
      const gz = gzipSync(plain);
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Encoding': 'gzip' });
      res.end(gz);
    });

    const flowPromise = waitForFlowComplete(engine);
    const client = await requestThroughProxy(port, origin.port, '/gzip');
    const flow = await flowPromise;

    expect(client.body.toString()).not.toBe(plain.toString()); // client got gzip bytes
    expect(gunzipSync(client.body).equals(plain)).toBe(true);
    expect(Buffer.from(flow.response?.body ?? '')).toEqual(plain);
    expect(flow.response?.bodySize).toBe(plain.length);
    expect(flow.tags).not.toContain('body-truncated');
  });

  it('caps bodies over 2 MB and tags them body-truncated while forwarding the full body', async () => {
    const { engine, port } = await startProxy();
    const large = Buffer.alloc(3 * 1024 * 1024, 0x61); // 3 MB
    const origin = await startOrigin((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(large);
    });

    const flowPromise = waitForFlowComplete(engine);
    const client = await requestThroughProxy(port, origin.port, '/big');
    const flow = await flowPromise;

    expect(client.body.length).toBe(large.length); // forwarding untouched
    expect(flow.response?.body?.length).toBe(2 * 1024 * 1024);
    expect(flow.response?.bodySize).toBe(2 * 1024 * 1024);
    expect(flow.tags).toContain('body-truncated');
  });

  it('caps request bodies over 2 MB and tags them request-body-truncated while forwarding the full body', async () => {
    const { engine, port } = await startProxy();
    const largeUpload = Buffer.alloc(3 * 1024 * 1024, 0x62); // 3 MB

    const origin = await startOrigin((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const received = Buffer.concat(chunks);
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(`received ${received.length} bytes`);
      });
    });

    const flowPromise = waitForFlowComplete(engine);
    const client = await postThroughProxy(port, origin.port, '/upload', largeUpload);
    const flow = await flowPromise;

    // Origin receives the full untruncated upload
    expect(client.statusCode).toBe(200);
    expect(client.body.toString()).toContain('received 3145728 bytes');

    // Captured request body is capped at 2 MB and tagged
    expect(flow.request.body?.length).toBe(2 * 1024 * 1024);
    expect(flow.request.bodySize).toBe(2 * 1024 * 1024);
    expect(flow.tags).toContain('request-body-truncated');
  });
});
