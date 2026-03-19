import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFlowThrottleController } from './throttle';

describe('FlowThrottleController', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes chunks through immediately when throttling is disabled', () => {
    const controller = createFlowThrottleController({
      profileId: 'none',
      customProfile: { downloadKbps: 1000, uploadKbps: 1000, latencyMs: 100 },
    });
    const callback = vi.fn();
    const chunk = Buffer.alloc(1024);

    controller.scheduleUploadChunk(chunk, callback);

    expect(callback).toHaveBeenCalledWith(null, chunk);
    expect(controller.getConnectionLatencyMs()).toBe(0);
  });

  it('delays chunks according to the configured upload bandwidth and preserves order', () => {
    vi.useFakeTimers();

    const controller = createFlowThrottleController({
      profileId: 'custom',
      customProfile: { downloadKbps: 1000, uploadKbps: 500, latencyMs: 25 },
    });
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();
    const chunk = Buffer.alloc(1000);

    controller.scheduleUploadChunk(chunk, firstCallback);
    controller.scheduleUploadChunk(chunk, secondCallback);

    vi.advanceTimersByTime(15);
    expect(firstCallback).not.toHaveBeenCalled();
    expect(secondCallback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(firstCallback).toHaveBeenCalledWith(null, chunk);
    expect(secondCallback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(16);
    expect(secondCallback).toHaveBeenCalledWith(null, chunk);
    expect(controller.getConnectionLatencyMs()).toBe(25);
  });
});
