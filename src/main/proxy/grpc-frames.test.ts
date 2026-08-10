import { describe, expect, it } from 'vitest';
import { GrpcFrameReader, parseGrpcMessages } from './grpc-frames';

function frame(payload: Buffer, compressed = false): Buffer {
  const header = Buffer.alloc(5);
  header.writeUInt8(compressed ? 1 : 0, 0);
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

describe('parseGrpcMessages (one-shot)', () => {
  it('parses a single uncompressed message', () => {
    const payload = Buffer.from('hello');
    const msgs = parseGrpcMessages(frame(payload), 'request');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].data).toEqual(payload);
    expect(msgs[0].compressed).toBe(false);
    expect(msgs[0].direction).toBe('request');
  });

  it('parses multiple messages in one buffer', () => {
    const buf = Buffer.concat([frame(Buffer.from('one')), frame(Buffer.from('two')), frame(Buffer.from('three'))]);
    const msgs = parseGrpcMessages(buf, 'response');
    expect(msgs.map((m) => m.data.toString())).toEqual(['one', 'two', 'three']);
    expect(msgs.every((m) => m.direction === 'response')).toBe(true);
  });

  it('marks the compressed flag', () => {
    const msgs = parseGrpcMessages(frame(Buffer.from([1, 2, 3]), true), 'request');
    expect(msgs[0].compressed).toBe(true);
  });

  it('ignores trailing bytes that do not form a complete message', () => {
    const buf = Buffer.concat([frame(Buffer.from('ok')), Buffer.from([0, 0])]);
    const msgs = parseGrpcMessages(buf, 'request');
    expect(msgs.map((m) => m.data.toString())).toEqual(['ok']);
  });

  it('truncates oversized payloads and marks truncated', () => {
    const huge = Buffer.alloc(100);
    const msgs = parseGrpcMessages(frame(huge), 'request', 10);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].data).toHaveLength(10);
    expect(msgs[0].truncated).toBe(true);
  });
});

describe('GrpcFrameReader (streamed)', () => {
  it('yields messages as bytes arrive across chunks', () => {
    const reader = new GrpcFrameReader('request');
    const full = Buffer.concat([frame(Buffer.from('one')), frame(Buffer.from('two'))]);

    const first = reader.feed(full.subarray(0, 3));
    expect(first).toHaveLength(0);

    const second = reader.feed(full.subarray(3, 12));
    expect(second.map((m) => m.data.toString())).toEqual(['one']);

    const third = reader.feed(full.subarray(12));
    expect(third.map((m) => m.data.toString())).toEqual(['two']);
  });

  it('handles a header split across feeds', () => {
    const reader = new GrpcFrameReader('response');
    const full = frame(Buffer.from('payload'));

    expect(reader.feed(full.subarray(0, 2))).toHaveLength(0);
    expect(reader.feed(full.subarray(2, 5))).toHaveLength(0);
    const got = reader.feed(full.subarray(5));
    expect(got.map((m) => m.data.toString())).toEqual(['payload']);
  });

  it('stops emitting after maxMessages', () => {
    const reader = new GrpcFrameReader('request', 2 * 1024 * 1024, 2);
    const buf = Buffer.concat([frame(Buffer.from('a')), frame(Buffer.from('b')), frame(Buffer.from('c'))]);
    const msgs = reader.feed(buf);
    expect(msgs).toHaveLength(2);
    expect(reader.isCapped).toBe(true);
    expect(reader.feed(frame(Buffer.from('d')))).toHaveLength(0);
  });

  it('flush returns any unbuffered remainder', () => {
    const reader = new GrpcFrameReader('request');
    reader.feed(Buffer.from([0, 0, 0]));
    const rem = reader.flush();
    expect(rem.length).toBe(3);
    expect(reader.flush().length).toBe(0);
  });
});
