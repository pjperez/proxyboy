/**
 * gRPC length-prefixed message framing.
 *
 * gRPC over HTTP/2 sends messages in DATA frames. Each message is prefixed:
 *   - 1 byte  : compressed-flag (0 = uncompressed, 1 = compressed)
 *   - 4 bytes : message length (unsigned big-endian uint32)
 *   - N bytes : payload
 *
 * This parser is fed raw bytes (potentially across many chunks / DATA frames)
 * and yields complete messages. It mirrors the SSE parsing style in streaming.ts.
 */

export interface GrpcMessage {
  /** Direction relative to the proxy. */
  direction: 'request' | 'response';
  /** 0 = uncompressed, 1 = compressed. */
  compressed: boolean;
  /** Raw protobuf payload (capped at maxSize). */
  data: Buffer;
  timestamp: number;
  /** Set when the payload was truncated to fit maxSize. */
  truncated?: boolean;
}

export interface GrpcParseResult {
  /** Complete messages decoded from the input. */
  messages: GrpcMessage[];
  /** Leftover bytes that didn't form a complete message (carry into next feed). */
  remainder: Buffer;
}

const GRPC_HEADER_LEN = 5; // 1 flag + 4 length

export class GrpcFrameReader {
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private capped = false;

  constructor(
    private readonly direction: 'request' | 'response',
    /** Max bytes retained per individual message payload. */
    private readonly maxMessageBytes: number = 2 * 1024 * 1024,
    /** Max number of messages retained for the flow. */
    private readonly maxMessages: number = 1000,
  ) {}

  feed(chunk: Buffer): GrpcMessage[] {
    if (this.capped) return [];
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);

    const out: GrpcMessage[] = [];
    while (this.buffer.length >= GRPC_HEADER_LEN && !this.capped) {
      const compressed = (this.buffer[0] & 0x01) === 0x01;
      const length = this.buffer.readUInt32BE(1);
      const frameEnd = GRPC_HEADER_LEN + length;

      // Header claims an absurd length (likely corrupt / not actually gRPC).
      // Treat whatever payload we have for this message as a single truncated blob
      // rather than buffering the entire stream indefinitely.
      const effectiveLen = Math.min(length, this.maxMessageBytes);
      if (this.buffer.length < GRPC_HEADER_LEN + effectiveLen) {
        break; // need more bytes
      }

      const payload = this.buffer.subarray(GRPC_HEADER_LEN, GRPC_HEADER_LEN + effectiveLen);
      const truncated = length > this.maxMessageBytes;
      out.push({
        direction: this.direction,
        compressed,
        data: payload as Buffer,
        timestamp: Date.now(),
        ...(truncated ? { truncated: true } : {}),
      });

      // Advance past the full claimed length (not just effectiveLen).
      this.buffer = this.buffer.subarray(Math.min(frameEnd, this.buffer.length));

      if (out.length >= this.maxMessages) {
        this.capped = true;
        break;
      }
    }

    return out;
  }

  /** Flush any buffered partial header/payload (called on stream end). */
  flush(): Buffer {
    const rem = this.buffer;
    this.buffer = Buffer.alloc(0);
    return rem;
  }

  get isCapped(): boolean {
    return this.capped;
  }
}

/**
 * One-shot helper: parse all complete messages from a single buffer.
 * Useful for tests and for decoding a fully buffered body.
 */
export function parseGrpcMessages(
  buffer: Buffer,
  direction: 'request' | 'response',
  maxMessageBytes = 2 * 1024 * 1024,
  maxMessages = 1000,
): GrpcMessage[] {
  const reader = new GrpcFrameReader(direction, maxMessageBytes, maxMessages);
  return reader.feed(buffer);
}
