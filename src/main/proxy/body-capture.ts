import { createBrotliDecompress, createGunzip, createInflate } from 'zlib';
import type { Transform } from 'stream';

/**
 * Captures a response body from wire chunks while capping it at `maxSize`
 * bytes (of DECOMPRESSED data, matching the old "decompress then truncate"
 * semantics). Streaming decompression means a huge gzip/brotli body is never
 * fully buffered in memory — once the cap is reached we stop decompressing
 * and simply discard further input.
 */

const ZLIB_FLUSH_OPTIONS = { flush: 2 /* Z_SYNC_FLUSH */, finishFlush: 2 /* Z_SYNC_FLUSH */ } as const;

const SUPPORTED_ENCODINGS = new Set(['gzip', 'x-gzip', 'br', 'deflate']);

function normalizeEncoding(encoding?: string | string[]): string | undefined {
  if (!encoding) return undefined;
  const enc = Array.isArray(encoding) ? encoding[0] : encoding;
  if (!enc) return undefined;
  return enc.toLowerCase().trim();
}

export interface BodyCapture {
  /** True when the wire body is being decompressed as it streams. */
  readonly streaming: boolean;
  /** True once the captured body reached `maxSize` (maps to the body-truncated tag). */
  readonly truncated: boolean;
  /** Feed the next wire chunk (must be called in order). */
  feed(chunk: Buffer): void;
  /** Flush pending decompressor output and resolve with the capped body. */
  finish(): Promise<Buffer>;
}

class IdentityBodyCapture implements BodyCapture {
  readonly streaming = false;
  truncated = false;
  private readonly chunks: Buffer[] = [];
  private size = 0;

  constructor(private readonly maxSize: number) {}

  feed(chunk: Buffer): void {
    if (this.truncated) return;
    const remaining = this.maxSize - this.size;
    if (chunk.length > remaining) {
      if (remaining > 0) {
        this.chunks.push(chunk.subarray(0, remaining));
        this.size += remaining;
      }
      this.truncated = true;
      return;
    }
    this.chunks.push(chunk);
    this.size += chunk.length;
  }

  async finish(): Promise<Buffer> {
    return this.chunks.length > 0 ? Buffer.concat(this.chunks) : Buffer.alloc(0);
  }
}

class StreamingBodyCapture implements BodyCapture {
  readonly streaming = true;
  truncated = false;
  private readonly chunks: Buffer[] = [];
  private size = 0;
  private readonly stream: Transform;
  private readonly done: Promise<void>;

  constructor(encoding: string, private readonly maxSize: number) {
    switch (encoding) {
      case 'br':
        this.stream = createBrotliDecompress(ZLIB_FLUSH_OPTIONS);
        break;
      case 'deflate':
        this.stream = createInflate(ZLIB_FLUSH_OPTIONS);
        break;
      default:
        this.stream = createGunzip(ZLIB_FLUSH_OPTIONS);
    }
    this.stream.on('data', (data: Buffer) => this.collect(data));
    // Resolve on end/close/error with whatever was captured so a mislabeled
    // or corrupt stream can never wedge the request lifecycle.
    this.done = new Promise((resolve) => {
      this.stream.once('end', resolve);
      this.stream.once('close', resolve);
      this.stream.once('error', resolve);
    });
  }

  private collect(data: Buffer): void {
    if (this.truncated) return;
    const remaining = this.maxSize - this.size;
    if (data.length > remaining) {
      if (remaining > 0) {
        this.chunks.push(data.subarray(0, remaining));
        this.size += remaining;
      }
      this.truncated = true;
      return;
    }
    this.chunks.push(data);
    this.size += data.length;
  }

  feed(chunk: Buffer): void {
    if (this.truncated) return;
    this.stream.write(chunk);
  }

  async finish(): Promise<Buffer> {
    if (!this.stream.writableEnded) {
      this.stream.end();
    }
    await this.done;
    return this.chunks.length > 0 ? Buffer.concat(this.chunks) : Buffer.alloc(0);
  }
}

/**
 * Create a body capture for the given response content-encoding.
 *
 * `firstChunk` is used to verify gzip/deflate magic bytes so a mislabeled
 * `Content-Encoding` header degrades to plain capping instead of yielding an
 * empty body (brotli has no magic bytes, so it trusts the header).
 */
export function createBodyCapture(
  encoding: string | string[] | undefined,
  firstChunk: Buffer,
  maxSize: number,
): BodyCapture {
  const normalized = normalizeEncoding(encoding);
  if (normalized && SUPPORTED_ENCODINGS.has(normalized)) {
    if (normalized === 'gzip' || normalized === 'x-gzip') {
      const isGzip = firstChunk.length >= 2 && firstChunk[0] === 0x1f && firstChunk[1] === 0x8b;
      return isGzip ? new StreamingBodyCapture('gzip', maxSize) : new IdentityBodyCapture(maxSize);
    }
    if (normalized === 'deflate') {
      const isDeflate = firstChunk.length >= 2
        && firstChunk[0] === 0x78
        && (firstChunk[1] === 0x01 || firstChunk[1] === 0x9c || firstChunk[1] === 0xda);
      return isDeflate ? new StreamingBodyCapture('deflate', maxSize) : new IdentityBodyCapture(maxSize);
    }
    return new StreamingBodyCapture('br', maxSize);
  }
  return new IdentityBodyCapture(maxSize);
}
