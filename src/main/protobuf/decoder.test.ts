import { EventEmitter } from 'events';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as protobuf from 'protobufjs';
import { describe, expect, it, afterEach, vi } from 'vitest';
import {
  decodeProtobufBody,
  resetDecoderDependenciesForTests,
  setDecoderDependenciesForTests,
  validateProtobufSettings,
} from './decoder';
import { DEFAULT_PROTOBUF_SETTINGS } from '../../shared/protobuf';

const tempDirs: string[] = [];

async function waitFor<T>(getValue: () => T, predicate: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 3000;
  let currentValue = getValue();

  while (!predicate(currentValue)) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for protobuf cache refresh.');
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
    currentValue = getValue();
  }

  return currentValue;
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function createDecodeRequest() {
  return {
    body: Buffer.from([0x0a, 0x05, 0x50, 0x65, 0x64, 0x72, 0x6f]).toString('base64'),
    contentType: 'application/x-protobuf',
    isBase64: true,
    direction: 'response' as const,
  };
}

afterEach(async () => {
  resetDecoderDependenciesForTests();
  vi.restoreAllMocks();
  await validateProtobufSettings(DEFAULT_PROTOBUF_SETTINGS);
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('decodeProtobufBody', () => {
  it('falls back to raw field decoding without schema files', () => {
    const result = decodeProtobufBody(
      {
        body: Buffer.from([0x08, 0x96, 0x01, 0x12, 0x05, 0x68, 0x65, 0x6c, 0x6c, 0x6f]).toString('base64'),
        contentType: 'application/x-protobuf',
        isBase64: true,
        direction: 'request',
      },
      DEFAULT_PROTOBUF_SETTINGS,
    );

    expect(result?.usedSchema).toBe(false);
    expect(result?.messages[0].fallbackFields).toEqual([
      { fieldNumber: 1, wireType: 'varint', valueType: 'integer', value: '150' },
      { fieldNumber: 2, wireType: 'length-delimited', valueType: 'string', value: 'hello' },
    ]);
  });

  it('decodes gRPC frames with matching schema files', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'proxyboy-proto-'));
    tempDirs.push(tempDir);

    const protoPath = path.join(tempDir, 'greeter.proto');
    writeFileSync(protoPath, `
      syntax = "proto3";
      package demo;

      service Greeter {
        rpc SayHello (HelloRequest) returns (HelloReply);
      }

      message HelloRequest {
        string name = 1;
      }

      message HelloReply {
        string message = 1;
      }
    `);

    const body = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x00, 0x07]),
      Buffer.from([0x0a, 0x05, 0x50, 0x65, 0x64, 0x72, 0x6f]),
    ]);

    await validateProtobufSettings({ protoFilePaths: [protoPath] });
    const result = decodeProtobufBody(
      {
        body: body.toString('base64'),
        contentType: 'application/grpc+proto',
        isBase64: true,
        requestPath: '/demo.Greeter/SayHello',
        direction: 'request',
      },
      { protoFilePaths: [protoPath] },
    );

    expect(result?.format).toBe('grpc');
    expect(result?.usedSchema).toBe(true);
    expect(result?.schemaTypeName).toBe('demo.HelloRequest');
    expect(result?.messages[0].decodedJson).toEqual({ name: 'Pedro' });
  });

  it('decodes raw protobuf bodies when a single message type is configured', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'proxyboy-proto-'));
    tempDirs.push(tempDir);

    const protoPath = path.join(tempDir, 'record.proto');
    writeFileSync(protoPath, `
      syntax = "proto3";

      message Record {
        string name = 1;
      }
    `);

    await validateProtobufSettings({ protoFilePaths: [protoPath] });
    const result = decodeProtobufBody(
      {
        body: Buffer.from([0x0a, 0x05, 0x50, 0x65, 0x64, 0x72, 0x6f]).toString('base64'),
        contentType: 'application/x-protobuf',
        isBase64: true,
        direction: 'response',
      },
      { protoFilePaths: [protoPath] },
    );

    expect(result?.usedSchema).toBe(true);
    expect(result?.schemaTypeName).toBe('Record');
    expect(result?.messages[0].decodedJson).toEqual({ name: 'Pedro' });
  });

  it('reloads cached schemas after proto files change on disk', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'proxyboy-proto-'));
    tempDirs.push(tempDir);

    const protoPath = path.join(tempDir, 'record.proto');
    writeFileSync(protoPath, `
      syntax = "proto3";

      message Record {
        string name = 1;
      }
    `);

    const settings = { protoFilePaths: [protoPath] };
    const request = createDecodeRequest();

    await validateProtobufSettings(settings);
    expect(decodeProtobufBody(request, settings)?.messages[0].decodedJson).toEqual({ name: 'Pedro' });

    writeFileSync(protoPath, `
      syntax = "proto3";

      message Record {
        string full_name = 1;
      }
    `);

    const reloadedJson = await waitFor(
      () => decodeProtobufBody(request, settings)?.messages[0].decodedJson,
      (value) => JSON.stringify(value) === JSON.stringify({ fullName: 'Pedro' }),
    );

    expect(reloadedJson).toEqual({ fullName: 'Pedro' });
  });

  it('does not crash when protobuf file watchers emit errors', async () => {
    const settings = { protoFilePaths: ['C:\\proto\\record.proto'] };
    const watcher = new EventEmitter() as fs.FSWatcher;
    (watcher as fs.FSWatcher).close = vi.fn();

    setDecoderDependenciesForTests({
      watchFile: () => watcher,
      loadSchemaFiles: async () => protobuf.parse(`
        syntax = "proto3";

        message Record {
          string name = 1;
        }
      `).root,
    });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await validateProtobufSettings(settings);
    expect(decodeProtobufBody(createDecodeRequest(), settings)?.messages[0].decodedJson).toEqual({ name: 'Pedro' });

    watcher.emit('error', new Error('Watcher failure'));

    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(decodeProtobufBody(createDecodeRequest(), settings)?.usedSchema).toBe(false);
  });

  it('ignores stale in-flight schema reloads after consecutive file changes', async () => {
    const settings = { protoFilePaths: ['C:\\proto\\record.proto'] };
    const watcher = new EventEmitter() as fs.FSWatcher;
    (watcher as fs.FSWatcher).close = vi.fn();

    let watchListener: ((eventType: string, filename: string | Buffer | null) => void) | undefined;
    let resolveSecondLoad!: (root: protobuf.Root) => void;
    let resolveThirdLoad!: (root: protobuf.Root) => void;
    let loadCallCount = 0;
    setDecoderDependenciesForTests({
      watchFile: (_filePath, listener) => {
        watchListener = listener as (eventType: string, filename: string | Buffer | null) => void;
        return watcher;
      },
      loadSchemaFiles: () => {
        loadCallCount += 1;
        if (loadCallCount === 1) {
          return Promise.resolve(
            protobuf.parse(`
              syntax = "proto3";

              message Record {
                string name = 1;
              }
            `).root,
          );
        }
        if (loadCallCount === 2) {
          return new Promise((resolve) => {
            resolveSecondLoad = resolve;
          });
        }
        if (loadCallCount === 3) {
          return new Promise((resolve) => {
            resolveThirdLoad = resolve;
          });
        }
        throw new Error(`Unexpected protobuf.load call #${loadCallCount}`);
      },
    });

    await validateProtobufSettings(settings);
    expect(decodeProtobufBody(createDecodeRequest(), settings)?.messages[0].decodedJson).toEqual({ name: 'Pedro' });
    expect(watchListener).toBeDefined();

    watchListener?.('change', 'record.proto');
    await flushAsyncWork();
    watchListener?.('change', 'record.proto');
    await flushAsyncWork();

    resolveSecondLoad?.(protobuf.parse(`
      syntax = "proto3";

      message Record {
        string stale_name = 1;
      }
    `).root);
    await flushAsyncWork();

    expect(decodeProtobufBody(createDecodeRequest(), settings)?.usedSchema).toBe(false);

    resolveThirdLoad?.(protobuf.parse(`
      syntax = "proto3";

      message Record {
        string final_name = 1;
      }
    `).root);

    const reloadedJson = await waitFor(
      () => decodeProtobufBody(createDecodeRequest(), settings)?.messages[0].decodedJson,
      (value) => JSON.stringify(value) === JSON.stringify({ finalName: 'Pedro' }),
    );

    expect(reloadedJson).toEqual({ finalName: 'Pedro' });
  });
});
