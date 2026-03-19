import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyResolvedTheme,
  getSystemTheme,
  loadThemePreference,
  persistThemePreference,
  resolveThemePreference,
  watchSystemTheme,
} from './theme';

describe('theme helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to system preference when no saved theme exists', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: vi.fn().mockReturnValue(null),
        setItem: vi.fn(),
      },
    });

    expect(loadThemePreference()).toBe('system');
  });

  it('loads and persists theme preferences through localStorage', () => {
    const getItem = vi.fn().mockReturnValue('light');
    const setItem = vi.fn();
    vi.stubGlobal('window', {
      localStorage: { getItem, setItem },
    });

    expect(loadThemePreference()).toBe('light');
    persistThemePreference('dark');
    expect(setItem).toHaveBeenCalledWith('proxyboy-theme', 'dark');
  });

  it('resolves system theme via matchMedia', () => {
    vi.stubGlobal('window', {
      matchMedia: vi.fn().mockReturnValue({ matches: true }),
    });

    expect(getSystemTheme()).toBe('light');
    expect(resolveThemePreference('system')).toBe('light');
    expect(resolveThemePreference('dark')).toBe('dark');
  });

  it('applies dark and light classes to the root element', () => {
    const toggle = vi.fn();

    applyResolvedTheme('light', {
      classList: { toggle },
      style: {},
    });

    expect(toggle).toHaveBeenCalledWith('dark', false);
    expect(toggle).toHaveBeenCalledWith('light', true);
  });

  it('subscribes to system theme changes and returns an unsubscribe function', () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    vi.stubGlobal('window', {
      matchMedia: vi.fn().mockReturnValue({
        matches: false,
        addEventListener,
        removeEventListener,
      }),
    });

    const onChange = vi.fn();
    const unsubscribe = watchSystemTheme(onChange);

    expect(addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    unsubscribe();
    expect(removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });
});
