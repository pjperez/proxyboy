import { create } from 'zustand';

interface AppState {
  proxyRunning: boolean;
  proxyPort: number;
  theme: 'dark' | 'light';
  setProxyRunning: (running: boolean) => void;
  setProxyPort: (port: number) => void;
  setTheme: (theme: 'dark' | 'light') => void;
}

export const useAppStore = create<AppState>((set) => ({
  proxyRunning: false,
  proxyPort: 9090,
  theme: 'dark',
  setProxyRunning: (running) => set({ proxyRunning: running }),
  setProxyPort: (port) => set({ proxyPort: port }),
  setTheme: (theme) => set({ theme }),
}));
