import { describe, expect, it } from 'vitest';
import { createWebSocketFrame, flushSseBuffer, isSseContentType, isWebSocketUpgrade, parseSseChunk } from './streaming';

describe('streaming helpers', () => {
  it('detects websocket upgrades and SSE responses', () => {
    expect(isWebSocketUpgrade({ upgrade: 'websocket' })).toBe(true);
    expect(isWebSocketUpgrade({ upgrade: 'h2c' })).toBe(false);
    expect(isSseContentType('text/event-stream; charset=utf-8')).toBe(true);
    expect(isSseContentType('application/json')).toBe(false);
  });

  it('serializes websocket frames for text and binary payloads', () => {
    const textFrame = createWebSocketFrame('message', false, 'hello');
    const binaryFrame = createWebSocketFrame('message', true, Buffer.from([0xde, 0xad]));

    expect(textFrame.direction).toBe('client-to-server');
    expect(textFrame.body).toBe('hello');
    expect(textFrame.isBase64).toBeUndefined();

    expect(binaryFrame.direction).toBe('server-to-client');
    expect(binaryFrame.body).toBe('3q0=');
    expect(binaryFrame.isBase64).toBe(true);
  });

  it('parses chunked SSE events and flushes the tail buffer', () => {
    const first = parseSseChunk('', Buffer.from('event: update\ndata: hello\n\nid: 1\ndata: par'));
    expect(first.events).toHaveLength(1);
    expect(first.events[0].event).toBe('update');
    expect(first.events[0].data).toBe('hello');

    const second = parseSseChunk(first.remainder, Buffer.from('tial\n\n'));
    expect(second.events).toHaveLength(1);
    expect(second.events[0].id).toBe('1');
    expect(second.events[0].data).toBe('partial');

    expect(flushSseBuffer('data: trailing')).toHaveLength(1);
  });

  it('normalizes carriage-return SSE line endings', () => {
    const parsed = parseSseChunk('', Buffer.from('event: ping\rdata: pong\r\r'));

    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0].event).toBe('ping');
    expect(parsed.events[0].data).toBe('pong');
  });
});
