import { create } from 'zustand';
import type { TrafficRowColorMode } from '../utils/traffic-row-colors';
import { loadThemePreference, persistThemePreference, type ThemePreference } from '../utils/theme';
import type { ThrottleSettings } from '../../shared/throttle';
import { DEFAULT_THROTTLE_SETTINGS, normalizeThrottleSettings } from '../../shared/throttle';
import type { AppUpdateState } from '../../shared/types';
import { APP_VERSION } from '../../shared/constants';

const TRAFFIC_ROW_COLOR_MODE_STORAGE_KEY = 'proxyboy-traffic-row-colors';

function loadTrafficRowColorMode(): TrafficRowColorMode {
  if (typeof window === 'undefined') {
    return 'off';
  }

  try {
    const raw = window.localStorage.getItem(TRAFFIC_ROW_COLOR_MODE_STORAGE_KEY);
    if (raw === 'status' || raw === 'content-type' || raw === 'off') {
      return raw;
    }
  } catch {
    // Ignore storage access failures and fall back to the default.
  }

  return 'off';
}

function persistTrafficRowColorMode(mode: TrafficRowColorMode): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(TRAFFIC_ROW_COLOR_MODE_STORAGE_KEY, mode);
  } catch {
    // Ignore storage access failures so settings UI remains usable.
  }
}

interface AppState {
  proxyRunning: boolean;
  proxyPort: number;
  noCacheEnabled: boolean;
  theme: ThemePreference;
  trafficRowColorMode: TrafficRowColorMode;
  throttleSettings: ThrottleSettings;
  updateState: AppUpdateState;
  setProxyRunning: (running: boolean) => void;
  setProxyPort: (port: number) => void;
  setNoCacheEnabled: (enabled: boolean) => void;
  setTheme: (theme: ThemePreference) => void;
  setTrafficRowColorMode: (mode: TrafficRowColorMode) => void;
  setThrottleSettings: (settings: ThrottleSettings) => void;
  setUpdateState: (state: AppUpdateState) => void;
}

export const useAppStore = create<AppState>((set) => ({
  proxyRunning: false,
  proxyPort: 9090,
  noCacheEnabled: false,
  theme: loadThemePreference(),
  trafficRowColorMode: loadTrafficRowColorMode(),
  throttleSettings: DEFAULT_THROTTLE_SETTINGS,
  updateState: {
    supported: false,
    enabled: true,
    checking: false,
    updateAvailable: false,
    updateDownloaded: false,
    currentVersion: APP_VERSION,
  },
  setProxyRunning: (running) => set({ proxyRunning: running }),
  setProxyPort: (port) => set({ proxyPort: port }),
  setNoCacheEnabled: (enabled) => set({ noCacheEnabled: enabled }),
  setTheme: (theme) => {
    persistThemePreference(theme);
    set({ theme });
  },
  setTrafficRowColorMode: (trafficRowColorMode) => {
    persistTrafficRowColorMode(trafficRowColorMode);
    set({ trafficRowColorMode });
  },
  setThrottleSettings: (throttleSettings) => set({ throttleSettings: normalizeThrottleSettings(throttleSettings) }),
  setUpdateState: (updateState) => set({ updateState }),
}));
