import * as fs from 'fs';
import * as protobuf from 'protobufjs';
import {
  DEFAULT_PROTOBUF_SETTINGS,
  isGrpcContentType,
  isProtobufContentType,
  type ProtobufDecodeRequest,
  type ProtobufDecodeResult,
  type ProtobufDecodedMessage,
  type ProtobufRawField,
  type ProtobufSettings,
} from '../../shared/protobuf';

interface GrpcFrame {
  index: number;
  length: number;
  compressed: boolean;
  payload: Buffer;
  error?: string;
}

interface DecodeContext {
  type?: protobuf.Type;
  schemaTypeName?: string;
}

interface DecoderDependencies {
  loadSchemaFiles: (filePaths: string[]) => Promise<protobuf.Root>;
  watchFile: (filePath: string, listener: fs.WatchListener<string>) => fs.FSWatcher;
}

const defaultDecoderDependencies: DecoderDependencies = {
  loadSchemaFiles: (filePaths) => protobuf.load(filePaths),
  watchFile: (filePath, listener) => fs.watch(filePath, { persistent: false }, listener),
};

let cachedSchemaKey: string | null = null;
let cachedRoot: protobuf.Root | null = null;
let cachedLoadPromise: Promise<void> | null = null;
let loadGeneration = 0;
let watchedSchemaKey: string | null = null;
let watchedSchemaSettings: ProtobufSettings = DEFAULT_PROTOBUF_SETTINGS;
let schemaWatchers: fs.FSWatcher[] = [];
let decoderDependencies: DecoderDependencies = defaultDecoderDependencies;

export function setDecoderDependenciesForTests(overrides: Partial<DecoderDependencies>): void {
  decoderDependencies = {
    ...defaultDecoderDependencies,
    ...overrides,
  };
}

export function resetDecoderDependenciesForTests(): void {
  decoderDependencies = defaultDecoderDependencies;
}

function getSchemaKey(settings: ProtobufSettings): string {
  return settings.protoFilePaths.join('|');
}

function closeSchemaWatchers(): void {
  for (const watcher of schemaWatchers) {
    watcher.close();
  }
  schemaWatchers = [];
  watchedSchemaKey = null;
}

function invalidateSchemaLoad(schemaKey: string | null): void {
  loadGeneration += 1;
  cachedSchemaKey = schemaKey;
  cachedRoot = null;
  cachedLoadPromise = null;
}

function resetSchemaCache(): void {
  invalidateSchemaLoad(null);
  watchedSchemaSettings = DEFAULT_PROTOBUF_SETTINGS;
  closeSchemaWatchers();
}

function watchSchemaFiles(settings: ProtobufSettings): void {
  const schemaKey = getSchemaKey(settings);
  if (!schemaKey || watchedSchemaKey === schemaKey) {
    return;
  }

  closeSchemaWatchers();
  watchedSchemaKey = schemaKey;
  watchedSchemaSettings = settings;
  schemaWatchers = settings.protoFilePaths.map((filePath) => {
    const watcher = decoderDependencies.watchFile(filePath, () => {
      if (cachedSchemaKey !== schemaKey) {
        return;
      }

      invalidateSchemaLoad(schemaKey);
      void validateProtobufSettings(watchedSchemaSettings).catch((error) => {
        console.error('Failed to reload protobuf schema files:', error);
      });
    });
    watcher.on('error', (error) => {
      console.error(`Failed to watch protobuf schema file "${filePath}":`, error);
      invalidateSchemaLoad(schemaKey);
      closeSchemaWatchers();
    });
    return watcher;
  });
}

async function ensureSchemaRootLoaded(settings: ProtobufSettings): Promise<void> {
  const schemaKey = getSchemaKey(settings);
  if (!schemaKey) {
    resetSchemaCache();
    return;
  }

  if (cachedSchemaKey === schemaKey && cachedRoot) {
    watchSchemaFiles(settings);
    return;
  }

  if (cachedSchemaKey === schemaKey && cachedLoadPromise) {
    await cachedLoadPromise;
    return;
  }

  loadGeneration += 1;
  const currentLoadGeneration = loadGeneration;
  cachedSchemaKey = schemaKey;
  cachedRoot = null;
  cachedLoadPromise = decoderDependencies.loadSchemaFiles(settings.protoFilePaths)
    .then((root) => {
      if (cachedSchemaKey === schemaKey && loadGeneration === currentLoadGeneration) {
        cachedRoot = root;
        watchSchemaFiles(settings);
      }
    })
    .catch((error) => {
      if (cachedSchemaKey === schemaKey && loadGeneration === currentLoadGeneration) {
        cachedRoot = null;
      }
      throw error;
    })
    .finally(() => {
      if (cachedSchemaKey === schemaKey && loadGeneration === currentLoadGeneration) {
        cachedLoadPromise = null;
      }
    });

  await cachedLoadPromise;
}

function getSchemaRoot(settings: ProtobufSettings): protobuf.Root | null {
  const schemaKey = getSchemaKey(settings);
  if (!schemaKey) {
    resetSchemaCache();
    return null;
  }

  return cachedSchemaKey === schemaKey ? cachedRoot : null;
}

export async function validateProtobufSettings(settings: ProtobufSettings): Promise<void> {
  if (settings.protoFilePaths.length === 0) {
    resetSchemaCache();
    return;
  }

  await ensureSchemaRootLoaded(settings);
}

function decodeBodyBuffer(body: string, isBase64: boolean): Buffer {
  return isBase64 ? Buffer.from(body, 'base64') : Buffer.from(body, 'utf8');
}

function parseGrpcFrames(body: Buffer): GrpcFrame[] {
  const frames: GrpcFrame[] = [];
  let offset = 0;
  let index = 0;

  while (offset < body.length) {
    if (offset + 5 > body.length) {
      frames.push({
        index,
        length: body.length - offset,
        compressed: false,
        payload: body.subarray(offset),
        error: 'Incomplete gRPC frame header.',
      });
      break;
    }

    const compressed = body[offset] === 1;
    const length = body.readUInt32BE(offset + 1);
    offset += 5;

    if (offset + length > body.length) {
      frames.push({
        index,
        length,
        compressed,
        payload: body.subarray(offset),
        error: 'gRPC frame length exceeds the captured body size.',
      });
      break;
    }

    frames.push({
      index,
      length,
      compressed,
      payload: body.subarray(offset, offset + length),
    });
    offset += length;
    index += 1;
  }

  if (frames.length === 0) {
    frames.push({
      index: 0,
      length: 0,
      compressed: false,
      payload: Buffer.alloc(0),
    });
  }

  return frames;
}

function readVarint(buffer: Buffer, startOffset: number): { value: bigint; nextOffset: number } | null {
  let offset = startOffset;
  let result = 0n;
  let shift = 0n;

  while (offset < buffer.length && shift <= 63n) {
    const byte = buffer[offset];
    result |= BigInt(byte & 0x7f) << shift;
    offset += 1;

    if ((byte & 0x80) === 0) {
      return { value: result, nextOffset: offset };
    }

    shift += 7n;
  }

  return null;
}

function tryDecodeUtf8(buffer: Buffer): string | null {
  if (buffer.length === 0) {
    return '';
  }

  try {
    const value = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) ? null : value;
  } catch {
    return null;
  }
}

function parseRawFields(buffer: Buffer, depth = 0): ProtobufRawField[] | null {
  if (depth > 3) {
    return null;
  }

  const fields: ProtobufRawField[] = [];
  let offset = 0;

  while (offset < buffer.length && fields.length < 200) {
    const tag = readVarint(buffer, offset);
    if (!tag) {
      return null;
    }

    offset = tag.nextOffset;
    const fieldNumber = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 0x7n);

    if (!Number.isFinite(fieldNumber) || fieldNumber <= 0) {
      return null;
    }

    switch (wireType) {
      case 0: {
        const value = readVarint(buffer, offset);
        if (!value) {
          return null;
        }
        offset = value.nextOffset;
        fields.push({
          fieldNumber,
          wireType: 'varint',
          valueType: 'integer',
          value: value.value.toString(),
        });
        break;
      }
      case 1: {
        if (offset + 8 > buffer.length) {
          return null;
        }
        fields.push({
          fieldNumber,
          wireType: 'fixed64',
          valueType: 'fixed64',
          value: `0x${buffer.subarray(offset, offset + 8).toString('hex')}`,
        });
        offset += 8;
        break;
      }
      case 2: {
        const lengthValue = readVarint(buffer, offset);
        if (!lengthValue) {
          return null;
        }
        offset = lengthValue.nextOffset;
        const length = Number(lengthValue.value);
        if (!Number.isFinite(length) || length < 0 || offset + length > buffer.length) {
          return null;
        }

        const slice = buffer.subarray(offset, offset + length);
        offset += length;
        const stringValue = tryDecodeUtf8(slice);
        const nestedFields = stringValue === null ? parseRawFields(slice, depth + 1) : null;

        fields.push({
          fieldNumber,
          wireType: 'length-delimited',
          valueType: stringValue !== null
            ? 'string'
            : nestedFields && nestedFields.length > 0
              ? 'nested'
              : 'bytes',
          value: stringValue !== null
            ? stringValue
            : nestedFields && nestedFields.length > 0
              ? nestedFields
              : slice.toString('base64'),
        });
        break;
      }
      case 5: {
        if (offset + 4 > buffer.length) {
          return null;
        }
        fields.push({
          fieldNumber,
          wireType: 'fixed32',
          valueType: 'fixed32',
          value: `0x${buffer.subarray(offset, offset + 4).toString('hex')}`,
        });
        offset += 4;
        break;
      }
      default:
        fields.push({
          fieldNumber,
          wireType: 'unknown',
          valueType: 'unknown',
          value: `Unsupported wire type ${wireType}`,
        });
        return fields;
    }
  }

  return offset === buffer.length ? fields : null;
}

function resolveGrpcType(
  root: protobuf.Root | null,
  requestPath: string | undefined,
  direction: 'request' | 'response',
): DecodeContext {
  if (!root || !requestPath) {
    return {};
  }

  const cleanPath = requestPath.split('?')[0];
  const match = cleanPath.match(/^\/([^/]+)\/([^/]+)$/);
  if (!match) {
    return {};
  }

  const [, serviceName, methodName] = match;

  try {
    const service = root.lookupService(serviceName);
    const method = service.methods[methodName];
    if (!method) {
      return {};
    }

    const typeName = direction === 'request' ? method.requestType : method.responseType;
    const type = root.lookupType(typeName);
    return {
      type,
      schemaTypeName: type.fullName.replace(/^\./, ''),
    };
  } catch {
    return {};
  }
}

function collectMessageTypes(object: protobuf.ReflectionObject, collected: protobuf.Type[]): void {
  if (object instanceof protobuf.Type && !object.name.endsWith('Entry')) {
    collected.push(object);
  }

  if (object instanceof protobuf.Namespace && object.nestedArray) {
    for (const nested of object.nestedArray) {
      collectMessageTypes(nested, collected);
    }
  }
}

function resolveRawType(root: protobuf.Root | null): DecodeContext {
  if (!root) {
    return {};
  }

  const types: protobuf.Type[] = [];
  collectMessageTypes(root, types);

  if (types.length !== 1) {
    return {};
  }

  return {
    type: types[0],
    schemaTypeName: types[0].fullName.replace(/^\./, ''),
  };
}

function decodeMessage(frame: GrpcFrame, context: DecodeContext): ProtobufDecodedMessage {
  if (frame.compressed) {
    return {
      index: frame.index,
      length: frame.length,
      compressed: true,
      error: 'Compressed gRPC frames are not supported yet.',
    };
  }

  if (frame.error) {
    return {
      index: frame.index,
      length: frame.length,
      compressed: frame.compressed,
      error: frame.error,
      fallbackFields: parseRawFields(frame.payload) ?? undefined,
    };
  }

  if (context.type) {
    try {
      const decoded = context.type.decode(frame.payload);
      return {
        index: frame.index,
        length: frame.length,
        compressed: frame.compressed,
        schemaTypeName: context.schemaTypeName,
        decodedJson: context.type.toObject(decoded, {
          longs: String,
          enums: String,
          bytes: String,
          defaults: true,
          arrays: true,
          objects: true,
        }),
      };
    } catch (error) {
      return {
        index: frame.index,
        length: frame.length,
        compressed: frame.compressed,
        schemaTypeName: context.schemaTypeName,
        error: error instanceof Error ? error.message : 'Failed to decode with the configured schema.',
        fallbackFields: parseRawFields(frame.payload) ?? undefined,
      };
    }
  }

  return {
    index: frame.index,
    length: frame.length,
    compressed: frame.compressed,
    fallbackFields: parseRawFields(frame.payload) ?? undefined,
  };
}

export function decodeProtobufBody(
  request: ProtobufDecodeRequest,
  settings: ProtobufSettings,
): ProtobufDecodeResult | null {
  if (!isProtobufContentType(request.contentType)) {
    return null;
  }

  const format = isGrpcContentType(request.contentType) ? 'grpc' : 'protobuf';
  const bodyBuffer = decodeBodyBuffer(request.body, Boolean(request.isBase64));
  const root = settings.protoFilePaths.length > 0 ? getSchemaRoot(settings) : null;
  const decodeContext = format === 'grpc'
    ? resolveGrpcType(root, request.requestPath, request.direction)
    : resolveRawType(root);
  const frames = format === 'grpc'
    ? parseGrpcFrames(bodyBuffer)
    : [{
        index: 0,
        length: bodyBuffer.length,
        compressed: false,
        payload: bodyBuffer,
      }];

  const messages = frames.map((frame) => decodeMessage(frame, decodeContext));
  const usedSchema = messages.some((message) => message.decodedJson !== undefined);

  return {
    format,
    schemaConfigured: settings.protoFilePaths.length > 0,
    usedSchema,
    schemaTypeName: decodeContext.schemaTypeName,
    methodPath: request.requestPath,
    notice: !usedSchema && format === 'grpc' && settings.protoFilePaths.length > 0 && !decodeContext.type
      ? 'Configured .proto files did not contain a matching gRPC service/method for this request path.'
      : !usedSchema && format === 'protobuf' && settings.protoFilePaths.length > 0 && !decodeContext.type
        ? 'Automatic schema decoding for raw protobuf bodies requires a single unambiguous message type in the configured .proto files.'
      : undefined,
    messages,
  };
}
