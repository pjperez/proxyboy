import { create } from 'zustand';
import type { TrafficRowColorMode } from '../utils/traffic-row-colors';

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
  theme: 'dark' | 'light';
  trafficRowColorMode: TrafficRowColorMode;
  setProxyRunning: (running: boolean) => void;
  setProxyPort: (port: number) => void;
  setNoCacheEnabled: (enabled: boolean) => void;
  setTheme: (theme: 'dark' | 'light') => void;
  setTrafficRowColorMode: (mode: TrafficRowColorMode) => void;
}

export const useAppStore = create<AppState>((set) => ({
  proxyRunning: false,
  proxyPort: 9090,
  noCacheEnabled: false,
  theme: 'dark',
  trafficRowColorMode: loadTrafficRowColorMode(),
  setProxyRunning: (running) => set({ proxyRunning: running }),
  setProxyPort: (port) => set({ proxyPort: port }),
  setNoCacheEnabled: (enabled) => set({ noCacheEnabled: enabled }),
  setTheme: (theme) => set({ theme }),
  setTrafficRowColorMode: (trafficRowColorMode) => {
    persistTrafficRowColorMode(trafficRowColorMode);
    set({ trafficRowColorMode });
  },
}));
