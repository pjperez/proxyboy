import { describe, expect, it } from 'vitest';
import { gzipSync, brotliCompressSync, deflateSync } from 'zlib';
import { createBodyCapture } from './body-capture';

describe('createBodyCapture', () => {
  describe('identity (no content-encoding)', () => {
    it('returns the full body when under the cap', async () => {
      const capture = createBodyCapture(undefined, Buffer.from('hello'), 1024);
      capture.feed(Buffer.from('hello '));
      capture.feed(Buffer.from('world'));
      const body = await capture.finish();
      expect(body.toString()).toBe('hello world');
      expect(capture.truncated).toBe(false);
      expect(capture.streaming).toBe(false);
    });

    it('caps the body at maxSize and marks truncated', async () => {
      const capture = createBodyCapture(undefined, Buffer.alloc(10), 10);
      capture.feed(Buffer.from('abcdefghij'));
      capture.feed(Buffer.from('KLMNOP'));
      const body = await capture.finish();
      expect(body.length).toBe(10);
      expect(body.toString()).toBe('abcdefghij');
      expect(capture.truncated).toBe(true);
    });

    it('ignores unknown/missing encodings (passthrough)', async () => {
      const first = Buffer.from('abc');
      const capture = createBodyCapture('identity', first, 1024);
      capture.feed(first);
      capture.feed(Buffer.from('def'));
      expect((await capture.finish()).toString()).toBe('abcdef');
    });
  });

  describe('gzip streaming', () => {
    const gzip = (data: Buffer): Buffer => gzipSync(data);

    it('decompresses and returns the full body under the cap', async () => {
      const plain = Buffer.from('the quick brown fox jumps over the lazy dog. '.repeat(100));
      const capture = createBodyCapture('gzip', gzip(plain.subarray(0, 32)), 1024 * 1024);
      capture.feed(gzip(plain));
      const body = await capture.finish();
      expect(body.equals(plain)).toBe(true);
      expect(capture.truncated).toBe(false);
      expect(capture.streaming).toBe(true);
    });

    it('caps the DECOMPRESSED body at maxSize (matches old truncate-after-decompress semantics)', async () => {
      const plain = Buffer.alloc(5 * 1024 * 1024, 0x61); // 5 MB of 'a'
      const wire = gzip(plain);
      const cap = 2 * 1024 * 1024;
      const capture = createBodyCapture('gzip', wire.subarray(0, 64), cap);
      capture.feed(wire);
      const body = await capture.finish();
      expect(body.length).toBe(cap);
      expect(capture.truncated).toBe(true);
      // Matches the old approach: decompress the full body then truncate
      expect(body.equals(plain.subarray(0, cap))).toBe(true);
    });

    it('handles chunked feeding of a single gzip stream', async () => {
      const plain = Buffer.from('streamed in many chunks! '.repeat(50));
      const wire = gzip(plain);
      const capture = createBodyCapture('gzip', wire.subarray(0, 16), 1024 * 1024);
      for (let i = 0; i < wire.length; i += 7) {
        capture.feed(wire.subarray(i, i + 7));
      }
      const body = await capture.finish();
      expect(body.equals(plain)).toBe(true);
    });
  });

  describe('brotli streaming', () => {
    it('decompresses and caps', async () => {
      const plain = Buffer.alloc(3 * 1024 * 1024, 0x62); // 3 MB of 'b'
      const wire = brotliCompressSync(plain);
      const cap = 2 * 1024 * 1024;
      const capture = createBodyCapture('br', wire.subarray(0, 64), cap);
      capture.feed(wire);
      const body = await capture.finish();
      expect(body.length).toBe(cap);
      expect(body.equals(plain.subarray(0, cap))).toBe(true);
      expect(capture.truncated).toBe(true);
    });
  });

  describe('deflate streaming', () => {
    it('decompresses and caps', async () => {
      const plain = Buffer.from('deflate test payload '.repeat(200));
      const wire = deflateSync(plain);
      const capture = createBodyCapture('deflate', wire.subarray(0, 32), 1024 * 1024);
      capture.feed(wire);
      const body = await capture.finish();
      expect(body.equals(plain)).toBe(true);
      expect(capture.truncated).toBe(false);
    });
  });

  describe('mislabeled content-encoding', () => {
    it('falls back to identity capping when gzip header lies about the body', async () => {
      // Header says gzip, but the actual body is plain text
      const plain = Buffer.from('not actually gzipped at all');
      const capture = createBodyCapture('gzip', plain.subarray(0, 16), 1024);
      capture.feed(plain);
      const body = await capture.finish();
      expect(body.toString()).toBe('not actually gzipped at all');
      expect(capture.streaming).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('returns an empty buffer when no chunks were fed', async () => {
      const capture = createBodyCapture('gzip', Buffer.from([0x1f, 0x8b]), 1024);
      expect((await capture.finish()).length).toBe(0);
    });

    it('stops feeding after the cap is reached', async () => {
      const cap = 4;
      const capture = createBodyCapture(undefined, Buffer.from('abcd'), cap);
      capture.feed(Buffer.from('abcd'));
      capture.feed(Buffer.from('EFGH')); // should be ignored
      expect((await capture.finish()).toString()).toBe('abcd');
      expect(capture.truncated).toBe(true);
    });
  });
});
