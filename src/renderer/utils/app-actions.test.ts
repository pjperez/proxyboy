import { describe, expect, it, vi } from 'vitest';
import { toggleProxyRecording } from './app-actions';

describe('toggleProxyRecording', () => {
  it('starts the proxy and returns the new port', async () => {
    const result = await toggleProxyRecording(
      {
        proxy: {
          start: vi.fn().mockResolvedValue({ success: true, port: 9090 }),
          stop: vi.fn(),
          setSystemProxy: vi.fn(),
        },
      },
      false,
      false,
    );

    expect(result).toEqual({
      success: true,
      running: true,
      isSystemProxy: false,
      port: 9090,
      error: '',
    });
  });

  it('disables the system proxy before stopping recording', async () => {
    const setSystemProxy = vi.fn().mockResolvedValue({ success: true });
    const stop = vi.fn().mockResolvedValue({ success: true });

    const result = await toggleProxyRecording(
      {
        proxy: {
          start: vi.fn(),
          stop,
          setSystemProxy,
        },
      },
      true,
      true,
    );

    expect(setSystemProxy).toHaveBeenCalledWith(false);
    expect(stop).toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      running: false,
      isSystemProxy: false,
      error: '',
    });
  });

  it('surfaces stop failures after the system proxy is disabled', async () => {
    const result = await toggleProxyRecording(
      {
        proxy: {
          start: vi.fn(),
          stop: vi.fn().mockResolvedValue({ success: false, error: 'stop failed' }),
          setSystemProxy: vi.fn().mockResolvedValue({ success: true }),
        },
      },
      true,
      true,
    );

    expect(result).toEqual({
      success: false,
      running: true,
      isSystemProxy: false,
      error: 'stop failed',
    });
  });
});
