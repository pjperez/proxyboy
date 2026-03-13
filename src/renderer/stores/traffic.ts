import { create } from 'zustand';
import type { HttpFlow, FilterCriteria } from '../../shared/types';

interface TrafficState {
  flows: HttpFlow[];
  filter: FilterCriteria;
  addFlow: (flow: HttpFlow) => void;
  updateFlow: (flow: HttpFlow) => void;
  clearFlows: () => void;
  setFilter: (filter: FilterCriteria) => void;
  getFilteredFlows: () => HttpFlow[];
}

export const useTrafficStore = create<TrafficState>((set, get) => ({
  flows: [],
  filter: {},

  addFlow: (flow) =>
    set((state) => ({
      flows: [...state.flows, flow],
    })),

  updateFlow: (flow) =>
    set((state) => ({
      flows: state.flows.map((f) => (f.id === flow.id ? flow : f)),
    })),

  clearFlows: () => set({ flows: [] }),

  setFilter: (filter) => set({ filter }),

  getFilteredFlows: () => {
    const { flows, filter } = get();
    return flows.filter((flow) => {
      if (filter.text) {
        const text = filter.text.toLowerCase();
        if (!flow.request.url.toLowerCase().includes(text) &&
            !flow.request.host.toLowerCase().includes(text)) {
          return false;
        }
      }
      if (filter.methods?.length && !filter.methods.includes(flow.request.method)) {
        return false;
      }
      if (filter.protocols?.length && !filter.protocols.includes(flow.request.protocol)) {
        return false;
      }
      if (filter.statusCodes?.length) {
        if (!flow.response) return false;
        const matches = filter.statusCodes.some(
          (range) => flow.response!.statusCode >= range.min && flow.response!.statusCode <= range.max
        );
        if (!matches) return false;
      }
      if (filter.contentTypes?.length) {
        const ct = (flow.response?.headers['content-type'] || '').toString().toLowerCase();
        const matches = filter.contentTypes.some((type) => ct.includes(type));
        if (!matches) return false;
      }
      if (filter.hasError && (!flow.response || flow.response.statusCode < 400)) {
        return false;
      }
      if (filter.minDuration && (!flow.response || flow.response.duration < filter.minDuration)) {
        return false;
      }
      return true;
    });
  },
}));
