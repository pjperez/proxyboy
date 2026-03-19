import { create } from 'zustand';

interface AppState {
  proxyRunning: boolean;
  proxyPort: number;
  noCacheEnabled: boolean;
  theme: 'dark' | 'light';
  setProxyRunning: (running: boolean) => void;
  setProxyPort: (port: number) => void;
  setNoCacheEnabled: (enabled: boolean) => void;
  setTheme: (theme: 'dark' | 'light') => void;
}

export const useAppStore = create<AppState>((set) => ({
  proxyRunning: false,
  proxyPort: 9090,
  noCacheEnabled: false,
  theme: 'dark',
  setProxyRunning: (running) => set({ proxyRunning: running }),
  setProxyPort: (port) => set({ proxyPort: port }),
  setNoCacheEnabled: (enabled) => set({ noCacheEnabled: enabled }),
  setTheme: (theme) => set({ theme }),
}));
