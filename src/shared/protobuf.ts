export interface ProtobufSettings {
  protoFilePaths: string[];
}

export interface ProtobufDecodeRequest {
  body: string;
  contentType: string;
  isBase64?: boolean;
  requestPath?: string;
  direction: 'request' | 'response';
}

export interface ProtobufRawField {
  fieldNumber: number;
  wireType: 'varint' | 'fixed64' | 'length-delimited' | 'fixed32' | 'unknown';
  valueType: 'integer' | 'fixed64' | 'fixed32' | 'string' | 'bytes' | 'nested' | 'unknown';
  value: string | ProtobufRawField[];
}

export interface ProtobufDecodedMessage {
  index: number;
  length: number;
  compressed: boolean;
  decodedJson?: unknown;
  fallbackFields?: ProtobufRawField[];
  schemaTypeName?: string;
  error?: string;
}

export interface ProtobufDecodeResult {
  format: 'protobuf' | 'grpc';
  schemaConfigured: boolean;
  usedSchema: boolean;
  schemaTypeName?: string;
  methodPath?: string;
  notice?: string;
  messages: ProtobufDecodedMessage[];
}

export const DEFAULT_PROTOBUF_SETTINGS: ProtobufSettings = {
  protoFilePaths: [],
};

export function normalizeProtobufSettings(
  settings: Partial<ProtobufSettings> | null | undefined,
): ProtobufSettings {
  const protoFilePaths = Array.isArray(settings?.protoFilePaths)
    ? Array.from(new Set(settings.protoFilePaths
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)))
    : [];

  return {
    protoFilePaths,
  };
}

export function isGrpcContentType(contentType: string): boolean {
  return contentType.toLowerCase().includes('application/grpc');
}

export function isProtobufContentType(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  return isGrpcContentType(normalized)
    || normalized.includes('application/protobuf')
    || normalized.includes('application/x-protobuf')
    || normalized.includes('application/vnd.google.protobuf');
}
