import { create } from 'zustand';
import type { Rule, BreakpointRule, MapLocalRule, MapRemoteRule, AllowListRule, BlockListRule, CaptureFilterMode, ScriptRule } from '../../shared/types';

interface RulesState {
  rules: Rule[];
  loading: boolean;
  captureMode: CaptureFilterMode;
  setRules: (rules: Rule[]) => void;
  addRule: (rule: Rule) => void;
  updateRule: (rule: Rule) => void;
  removeRule: (id: string) => void;
  toggleRule: (id: string) => void;
  getBreakpointRules: () => BreakpointRule[];
  getMapLocalRules: () => MapLocalRule[];
  getMapRemoteRules: () => MapRemoteRule[];
  getAllowListRules: () => AllowListRule[];
  getBlockListRules: () => BlockListRule[];
  getScriptRules: () => ScriptRule[];
  loadRules: () => Promise<void>;
  loadCaptureMode: () => Promise<void>;
  setCaptureMode: (mode: CaptureFilterMode) => Promise<{ success: boolean; mode: CaptureFilterMode; error?: string }>;
}

export const useRulesStore = create<RulesState>((set, get) => ({
  rules: [],
  loading: false,
  captureMode: 'capture-all',

  setRules: (rules) => set({ rules }),

  addRule: (rule) => set((state) => ({ rules: [...state.rules, rule] })),

  updateRule: (rule) =>
    set((state) => ({
      rules: state.rules.map((r) => (r.id === rule.id ? rule : r)),
    })),

  removeRule: (id) =>
    set((state) => ({
      rules: state.rules.filter((r) => r.id !== id),
    })),

  toggleRule: (id) =>
    set((state) => ({
      rules: state.rules.map((r) =>
        r.id === id ? { ...r, enabled: !r.enabled, updatedAt: Date.now() } : r
      ),
    })),

  getBreakpointRules: () =>
    get().rules.filter((r): r is BreakpointRule => r.type === 'breakpoint'),

  getMapLocalRules: () =>
    get().rules.filter((r): r is MapLocalRule => r.type === 'map-local'),

  getMapRemoteRules: () =>
    get().rules.filter((r): r is MapRemoteRule => r.type === 'map-remote'),

  getAllowListRules: () =>
    get().rules.filter((r): r is AllowListRule => r.type === 'allow-list'),

  getBlockListRules: () =>
    get().rules.filter((r): r is BlockListRule => r.type === 'block-list'),

  getScriptRules: () =>
    get().rules.filter((r): r is ScriptRule => r.type === 'script'),

  loadRules: async () => {
    set({ loading: true });
    try {
      const api = (window as any).proxyboy;
      if (api?.rules?.getAll) {
        const rules = await api.rules.getAll();
        set({ rules: Array.isArray(rules) ? rules : [], loading: false });
      } else {
        set({ loading: false });
      }
    } catch {
      set({ loading: false });
    }
  },

  loadCaptureMode: async () => {
    try {
      const api = (window as any).proxyboy;
      if (api?.rules?.getCaptureMode) {
        const result = await api.rules.getCaptureMode();
        if (result?.mode) {
          set({ captureMode: result.mode });
        }
      }
    } catch {
      // Keep the last known mode
    }
  },

  setCaptureMode: async (mode) => {
    const api = (window as any).proxyboy;
    if (!api?.rules?.setCaptureMode) {
      return { success: false, mode: get().captureMode, error: 'Capture mode controls are unavailable.' };
    }

    try {
      const result = await api.rules.setCaptureMode(mode);
      if (result?.success) {
        set({ captureMode: result.mode });
      }
      return result;
    } catch {
      return { success: false, mode: get().captureMode, error: 'Failed to update the capture mode.' };
    }
  },
}));
