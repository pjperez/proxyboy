import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { describe, expect, it, afterEach } from 'vitest';
import { decodeProtobufBody } from './decoder';
import { DEFAULT_PROTOBUF_SETTINGS } from '../../shared/protobuf';

const tempDirs: string[] = [];

afterEach(() => {
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

  it('decodes gRPC frames with matching schema files', () => {
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

  it('decodes raw protobuf bodies when a single message type is configured', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'proxyboy-proto-'));
    tempDirs.push(tempDir);

    const protoPath = path.join(tempDir, 'record.proto');
    writeFileSync(protoPath, `
      syntax = "proto3";

      message Record {
        string name = 1;
      }
    `);

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
});
