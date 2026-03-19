import { create } from 'zustand';
import type { HttpFlow, FilterCriteria } from '../../shared/types';

const MAX_RENDERER_FLOWS = 5000;

interface TrafficState {
  flows: HttpFlow[];
  filter: FilterCriteria;
  setFlows: (flows: HttpFlow[]) => void;
  addFlow: (flow: HttpFlow) => void;
  updateFlow: (flow: HttpFlow) => void;
  removeFlow: (id: string) => void;
  clearFlows: () => void;
  setFilter: (filter: FilterCriteria) => void;
  getFilteredFlows: () => HttpFlow[];
}

function getSearchableBody(part?: { body?: Buffer | string }): string {
  if (!part || (part as any)._isBase64 || typeof part.body !== 'string') {
    return '';
  }

  return part.body.toLowerCase();
}

export function matchesFlowFilter(flow: HttpFlow, filter: FilterCriteria): boolean {
  if (filter.text) {
    const text = filter.text.toLowerCase();
    const matchesUrl =
      flow.request.url.toLowerCase().includes(text) ||
      flow.request.host.toLowerCase().includes(text);
    const matchesBody = filter.searchBodies && (
      getSearchableBody(flow.request).includes(text) ||
      getSearchableBody(flow.response).includes(text)
    );

    if (!matchesUrl && !matchesBody) {
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

  if (filter.maxDuration && (!flow.response || flow.response.duration > filter.maxDuration)) {
    return false;
  }

  return true;
}

export const useTrafficStore = create<TrafficState>((set, get) => ({
  flows: [],
  filter: {},

  setFlows: (flows) => set({ flows }),

  addFlow: (flow) =>
    set((state) => {
      const next = [...state.flows, flow];
      if (next.length > MAX_RENDERER_FLOWS) {
        return { flows: next.slice(Math.floor(MAX_RENDERER_FLOWS * 0.2)) };
      }
      return { flows: next };
    }),

  updateFlow: (flow) =>
    set((state) => {
      const index = state.flows.findIndex((f) => f.id === flow.id);
      if (index === -1) {
        return { flows: [...state.flows, flow] };
      }
      const next = [...state.flows];
      next[index] = flow;
      return { flows: next };
    }),

  removeFlow: (id) =>
    set((state) => ({
      flows: state.flows.filter((flow) => flow.id !== id),
    })),

  clearFlows: () => set({ flows: [] }),

  setFilter: (filter) => set({ filter }),

  getFilteredFlows: () => {
    const { flows, filter } = get();
    return flows.filter((flow) => matchesFlowFilter(flow, filter));
  },
}));
