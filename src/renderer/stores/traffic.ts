import { create } from 'zustand';
import { MAX_STREAM_ITEMS } from '../../shared/constants';
import type { HttpFlow, FilterCriteria, TrafficFlowUpdate, WebSocketFrame, SseEvent } from '../../shared/types';

const MAX_RENDERER_FLOWS = 5000;

interface TrafficState {
  flows: HttpFlow[];
  filter: FilterCriteria;
  markedFlowId: string | null;
  compareTargetFlowId: string | null;
  setFlows: (flows: HttpFlow[]) => void;
  addFlow: (flow: HttpFlow) => void;
  updateFlow: (flow: HttpFlow | TrafficFlowUpdate) => void;
  removeFlow: (id: string) => void;
  clearFlows: () => void;
  setFilter: (filter: FilterCriteria) => void;
  setMarkedFlowId: (id: string | null) => void;
  setCompareTargetFlowId: (id: string | null) => void;
  clearComparison: () => void;
  getFilteredFlows: () => HttpFlow[];
}

function reconcileComparisonState(
  flows: HttpFlow[],
  markedFlowId: string | null,
  compareTargetFlowId: string | null,
): Pick<TrafficState, 'markedFlowId' | 'compareTargetFlowId'> {
  const flowIds = new Set(flows.map((flow) => flow.id));
  const nextMarkedFlowId = markedFlowId && flowIds.has(markedFlowId) ? markedFlowId : null;
  const nextCompareTargetFlowId =
    nextMarkedFlowId &&
    compareTargetFlowId &&
    flowIds.has(compareTargetFlowId) &&
    compareTargetFlowId !== nextMarkedFlowId
      ? compareTargetFlowId
      : null;

  return {
    markedFlowId: nextMarkedFlowId,
    compareTargetFlowId: nextCompareTargetFlowId,
  };
}

function getSearchableBody(part?: { body?: Buffer | string }): string {
  if (!part || (part as any)._isBase64 || typeof part.body !== 'string') {
    return '';
  }

  return part.body.toLowerCase();
}

function getSearchableStreamContent(flow: HttpFlow): string {
  const websocketContent = (flow.websocketFrames ?? [])
    .filter((frame) => !frame.isBase64)
    .map((frame) => frame.body.toLowerCase())
    .join('\n');
  const sseContent = (flow.sseEvents ?? [])
    .map((event) => `${event.event || ''}\n${event.data}`.toLowerCase())
    .join('\n');
  return `${websocketContent}\n${sseContent}`;
}

function appendCappedStreamItems<T>(
  currentItems: T[] | undefined,
  nextItems: T[] | undefined,
): T[] | undefined {
  if (!nextItems || nextItems.length === 0) {
    return currentItems;
  }

  const merged = [...(currentItems ?? []), ...nextItems];
  if (merged.length <= MAX_STREAM_ITEMS) {
    return merged;
  }

  return merged.slice(merged.length - MAX_STREAM_ITEMS);
}

function isFlowPatch(flow: HttpFlow | TrafficFlowUpdate): flow is TrafficFlowUpdate {
  return !('request' in flow);
}

function applyFlowPatch(currentFlow: HttpFlow, patch: TrafficFlowUpdate): HttpFlow {
  return {
    ...currentFlow,
    streamKind: patch.streamKind ?? currentFlow.streamKind,
    streamOpen: patch.streamOpen ?? currentFlow.streamOpen,
    tags: patch.tags ? [...patch.tags] : currentFlow.tags,
    notes: patch.notes ?? currentFlow.notes,
    websocketFrames: appendCappedStreamItems<WebSocketFrame>(
      currentFlow.websocketFrames,
      patch.appendWebSocketFrames,
    ),
    sseEvents: appendCappedStreamItems<SseEvent>(
      currentFlow.sseEvents,
      patch.appendSseEvents,
    ),
  };
}

export function matchesFlowFilter(flow: HttpFlow, filter: FilterCriteria): boolean {
  if (filter.text) {
    const text = filter.text.toLowerCase();
    const matchesUrl =
      flow.request.url.toLowerCase().includes(text) ||
      flow.request.host.toLowerCase().includes(text);
    const matchesBody = filter.searchBodies && (
      getSearchableBody(flow.request).includes(text) ||
      getSearchableBody(flow.response).includes(text) ||
      getSearchableStreamContent(flow).includes(text)
    );

    if (!matchesUrl && !matchesBody) {
      return false;
    }
  }

  if (filter.graphqlOperationName) {
    const graphqlOperationName = flow.request.graphqlOperationName?.toLowerCase() || '';
    if (!graphqlOperationName.includes(filter.graphqlOperationName.toLowerCase())) {
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
    if (flow.streamKind === 'websocket') {
      return true;
    }
    if (flow.streamKind === 'sse' && !flow.response) {
      return true;
    }
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
  markedFlowId: null,
  compareTargetFlowId: null,

  setFlows: (flows) =>
    set((state) => ({
      flows,
      ...reconcileComparisonState(flows, state.markedFlowId, state.compareTargetFlowId),
    })),

  addFlow: (flow) =>
    set((state) => {
      const next = [...state.flows, flow];
      const flows = next.length > MAX_RENDERER_FLOWS
        ? next.slice(Math.floor(MAX_RENDERER_FLOWS * 0.2))
        : next;

      if (next.length > MAX_RENDERER_FLOWS) {
        return {
          flows,
          ...reconcileComparisonState(flows, state.markedFlowId, state.compareTargetFlowId),
        };
      }
      return {
        flows,
        ...reconcileComparisonState(flows, state.markedFlowId, state.compareTargetFlowId),
      };
    }),

  updateFlow: (flow) =>
    set((state) => {
      const index = state.flows.findIndex((f) => f.id === flow.id);
      if (index === -1) {
        if (isFlowPatch(flow)) {
          return {};
        }
        return { flows: [...state.flows, flow] };
      }
      const next = [...state.flows];
      next[index] = isFlowPatch(flow) ? applyFlowPatch(next[index], flow) : flow;
      return { flows: next };
    }),

  removeFlow: (id) =>
    set((state) => {
      const flows = state.flows.filter((flow) => flow.id !== id);
      return {
        flows,
        ...reconcileComparisonState(flows, state.markedFlowId, state.compareTargetFlowId),
      };
    }),

  clearFlows: () => set({ flows: [], markedFlowId: null, compareTargetFlowId: null }),

  setFilter: (filter) => set({ filter }),

  setMarkedFlowId: (markedFlowId) =>
    set((state) => ({
      markedFlowId,
      compareTargetFlowId:
        !markedFlowId || (state.compareTargetFlowId && state.compareTargetFlowId === markedFlowId)
          ? null
          : state.compareTargetFlowId,
    })),

  setCompareTargetFlowId: (compareTargetFlowId) =>
    set((state) => ({
      compareTargetFlowId:
        state.markedFlowId && compareTargetFlowId && compareTargetFlowId !== state.markedFlowId
          ? compareTargetFlowId
          : null,
    })),

  clearComparison: () => set({ markedFlowId: null, compareTargetFlowId: null }),

  getFilteredFlows: () => {
    const { flows, filter } = get();
    return flows.filter((flow) => matchesFlowFilter(flow, filter));
  },
}));
