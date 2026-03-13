import { create } from 'zustand';
import type { Rule, BreakpointRule, MapLocalRule } from '../../shared/types';

interface RulesState {
  rules: Rule[];
  loading: boolean;
  setRules: (rules: Rule[]) => void;
  addRule: (rule: Rule) => void;
  updateRule: (rule: Rule) => void;
  removeRule: (id: string) => void;
  toggleRule: (id: string) => void;
  getBreakpointRules: () => BreakpointRule[];
  getMapLocalRules: () => MapLocalRule[];
  loadRules: () => Promise<void>;
}

export const useRulesStore = create<RulesState>((set, get) => ({
  rules: [],
  loading: false,

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

  loadRules: async () => {
    set({ loading: true });
    try {
      const api = (window as any).proxyboy;
      if (api) {
        const rules = await api.rules.getAll();
        set({ rules, loading: false });
      }
    } catch {
      set({ loading: false });
    }
  },
}));
