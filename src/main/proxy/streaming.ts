import { randomUUID } from 'crypto';
import type { SseEvent, WebSocketFrame } from '../../shared/types';

const MAX_STREAM_PAYLOAD_BYTES = 64 * 1024;

function toBuffer(message: unknown): Buffer {
  if (Buffer.isBuffer(message)) {
    return message;
  }
  if (typeof message === 'string') {
    return Buffer.from(message, 'utf8');
  }
  if (message instanceof Uint8Array) {
    return Buffer.from(message);
  }
  if (message instanceof ArrayBuffer) {
    return Buffer.from(message);
  }
  return Buffer.from(String(message ?? ''), 'utf8');
}

export function isWebSocketUpgrade(headers: Record<string, unknown> | undefined): boolean {
  const upgrade = String(headers?.upgrade || '').toLowerCase();
  return upgrade === 'websocket';
}

export function isSseContentType(contentType: string | string[] | undefined): boolean {
  const value = Array.isArray(contentType) ? contentType.join(';') : String(contentType || '');
  return value.toLowerCase().includes('text/event-stream');
}

export function createWebSocketFrame(
  type: string,
  fromServer: boolean,
  message: unknown,
): WebSocketFrame {
  const payload = toBuffer(message);
  const truncatedPayload = payload.length > MAX_STREAM_PAYLOAD_BYTES
    ? payload.subarray(0, MAX_STREAM_PAYLOAD_BYTES)
    : payload;
  const isTextFrame = type === 'message' && typeof message === 'string';
  const body = isTextFrame ? truncatedPayload.toString('utf8') : truncatedPayload.toString('base64');

  return {
    id: randomUUID(),
    timestamp: Date.now(),
    direction: fromServer ? 'server-to-client' : 'client-to-server',
    frameType: type === 'message' || type === 'ping' || type === 'pong' || type === 'close'
      ? type
      : 'message',
    body,
    isBase64: isTextFrame ? undefined : true,
    byteLength: payload.length,
    truncated: payload.length > MAX_STREAM_PAYLOAD_BYTES || undefined,
  };
}

function parseSseEventBlock(block: string): Omit<SseEvent, 'id' | 'timestamp' | 'byteLength'> & {
  id?: string;
} | null {
  const lines = block.split('\n');
  const dataLines: string[] = [];
  let event: string | undefined;
  let id: string | undefined;
  let retry: number | undefined;

  for (const line of lines) {
    if (!line || line.startsWith(':')) {
      continue;
    }

    const separatorIndex = line.indexOf(':');
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
    const rawValue = separatorIndex === -1 ? '' : line.slice(separatorIndex + 1).replace(/^\s/, '');

    if (field === 'data') {
      dataLines.push(rawValue);
    } else if (field === 'event') {
      event = rawValue;
    } else if (field === 'id') {
      id = rawValue;
    } else if (field === 'retry') {
      const retryValue = Number.parseInt(rawValue, 10);
      if (Number.isFinite(retryValue)) {
        retry = retryValue;
      }
    }
  }

  if (dataLines.length === 0 && !event && !id && retry == null) {
    return null;
  }

  const data = dataLines.join('\n');
  return {
    id,
    event,
    retry,
    data: data.length > MAX_STREAM_PAYLOAD_BYTES ? data.slice(0, MAX_STREAM_PAYLOAD_BYTES) : data,
    truncated: data.length > MAX_STREAM_PAYLOAD_BYTES || undefined,
  };
}

export function parseSseChunk(
  buffer: string,
  chunk: Buffer,
): { events: SseEvent[]; remainder: string } {
  const normalized = `${buffer}${chunk.toString('utf8')}`.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const boundary = normalized.lastIndexOf('\n\n');

  if (boundary === -1) {
    return { events: [], remainder: normalized };
  }

  const completed = normalized.slice(0, boundary);
  const remainder = normalized.slice(boundary + 2);
  const events = completed
    .split('\n\n')
    .map((block) => parseSseEventBlock(block))
    .filter((event): event is NonNullable<typeof event> => event !== null)
    .map((event) => ({
      ...event,
      id: event.id ?? randomUUID(),
      timestamp: Date.now(),
      byteLength: Buffer.byteLength(event.data, 'utf8'),
    }));

  return { events, remainder };
}

export function flushSseBuffer(buffer: string): SseEvent[] {
  const normalized = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!normalized.trim()) {
    return [];
  }

  const parsed = parseSseEventBlock(normalized);
  if (!parsed) {
    return [];
  }

  return [{
    ...parsed,
    id: parsed.id ?? randomUUID(),
    timestamp: Date.now(),
    byteLength: Buffer.byteLength(parsed.data, 'utf8'),
  }];
}
