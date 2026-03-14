import { create } from 'zustand';
import type { AgentMessage, AgentToolCall, AgentPermissionRequest } from '../../shared/types';

interface PersistedAgentState {
  messages: AgentMessage[];
  autoApprove: boolean;
}

interface AgentState {
  messages: AgentMessage[];
  isLoading: boolean;
  currentStreamContent: string;
  toolCalls: AgentToolCall[];
  pendingPermissions: AgentPermissionRequest[];
  autoApprove: boolean;
  draftInput: string;
  addMessage: (message: AgentMessage) => void;
  setLoading: (loading: boolean) => void;
  appendStreamContent: (content: string) => void;
  clearStreamContent: () => void;
  addToolCall: (toolCall: AgentToolCall) => void;
  clearMessages: () => void;
  sendMessage: (text: string) => Promise<void>;
  addPendingPermission: (req: AgentPermissionRequest) => void;
  removePendingPermission: (id: string) => void;
  setAutoApprove: (value: boolean) => void;
  setDraftInput: (value: string) => void;
}

const STORAGE_KEY = 'proxyboy-agent-state-v1';
const DRAFT_STORAGE_KEY = 'proxyboy-agent-draft-v1';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function normalizePersistedState(value: unknown): PersistedAgentState {
  if (!value || typeof value !== 'object') {
    return { messages: [], autoApprove: false };
  }

  const candidate = value as Partial<PersistedAgentState>;
  return {
    messages: Array.isArray(candidate.messages) ? candidate.messages : [],
    autoApprove: typeof candidate.autoApprove === 'boolean' ? candidate.autoApprove : false,
  };
}

function readPersistedState(): PersistedAgentState {
  if (typeof window === 'undefined') {
    return { messages: [], autoApprove: false };
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { messages: [], autoApprove: false };
    }

    return normalizePersistedState(JSON.parse(raw));
  } catch {
    return { messages: [], autoApprove: false };
  }
}

function readPersistedDraft(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  try {
    return window.localStorage.getItem(DRAFT_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function getPersistedState(state: AgentState): PersistedAgentState {
  return {
    messages: state.messages,
    autoApprove: state.autoApprove,
  };
}

const hydratedState = readPersistedState();
const hydratedDraft = readPersistedDraft();

export const useAgentStore = create<AgentState>((set, get) => ({
  messages: hydratedState.messages,
  isLoading: false,
  currentStreamContent: '',
  toolCalls: [],
  pendingPermissions: [],
  autoApprove: hydratedState.autoApprove,
  draftInput: hydratedDraft,

  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  setLoading: (loading) => set({ isLoading: loading }),

  appendStreamContent: (content) =>
    set((state) => ({ currentStreamContent: state.currentStreamContent + content })),

  clearStreamContent: () => set({ currentStreamContent: '' }),

  addToolCall: (toolCall) =>
    set((state) => ({ toolCalls: [...state.toolCalls, toolCall] })),

  clearMessages: () => set({ messages: [], toolCalls: [], pendingPermissions: [] }),

  addPendingPermission: (req) =>
    set((state) => ({ pendingPermissions: [...state.pendingPermissions, req] })),

  removePendingPermission: (id) =>
    set((state) => ({ pendingPermissions: state.pendingPermissions.filter(p => p.id !== id) })),

  setAutoApprove: (value) => set({ autoApprove: value }),

  setDraftInput: (value) => set({ draftInput: value }),

  sendMessage: async (text) => {
    const userMessage: AgentMessage = {
      id: generateId(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    set((state) => ({
      messages: [...state.messages, userMessage],
      isLoading: true,
      currentStreamContent: '',
    }));

    try {
      const api = (window as any).proxyboy;
      if (api) {
        const result = await api.agent.sendMessage(text);
        const streamedContent = get().currentStreamContent;
        // Use whichever is longer to avoid truncation from IPC race conditions
        const resultContent = result?.content || result?.error || '';
        const content = (streamedContent.length >= resultContent.length)
          ? streamedContent
          : (resultContent || streamedContent || 'No response received.');
        const assistantMessage: AgentMessage = {
          id: generateId(),
          role: 'assistant',
          content,
          toolCalls: [...get().toolCalls],
          timestamp: Date.now(),
        };
        set((state) => ({
          messages: [...state.messages, assistantMessage],
          isLoading: false,
          currentStreamContent: '',
          toolCalls: [],
        }));
      }
    } catch (error: any) {
      const streamedContent = get().currentStreamContent;
      const errorMessage: AgentMessage = {
        id: generateId(),
        role: 'assistant',
        content: streamedContent || `Error: ${error.message || 'Failed to get response from agent'}`,
        timestamp: Date.now(),
      };
      set((state) => ({
        messages: [...state.messages, errorMessage],
        isLoading: false,
        currentStreamContent: '',
      }));
    }
  },
}));

if (typeof window !== 'undefined') {
  let lastSerializedState = JSON.stringify(getPersistedState(useAgentStore.getState()));
  let lastDraftInput = useAgentStore.getState().draftInput;

  useAgentStore.subscribe((state) => {
    const serialized = JSON.stringify(getPersistedState(state));
    if (serialized === lastSerializedState) {
      if (state.draftInput === lastDraftInput) {
        return;
      }
    } else {
      lastSerializedState = serialized;
      window.localStorage.setItem(STORAGE_KEY, serialized);
    }

    if (state.draftInput !== lastDraftInput) {
      lastDraftInput = state.draftInput;
      window.localStorage.setItem(DRAFT_STORAGE_KEY, state.draftInput);
    }
  });

  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY && event.newValue && event.newValue !== lastSerializedState) {
      try {
        const nextState = normalizePersistedState(JSON.parse(event.newValue));
        lastSerializedState = JSON.stringify(nextState);
        useAgentStore.setState((state) => ({
          ...state,
          messages: nextState.messages,
          autoApprove: nextState.autoApprove,
        }));
      } catch {
        // Ignore malformed cross-window sync payloads.
      }
    }

    if (event.key === DRAFT_STORAGE_KEY && typeof event.newValue === 'string' && event.newValue !== lastDraftInput) {
      lastDraftInput = event.newValue;
      useAgentStore.setState({ draftInput: event.newValue });
    }
  });
}
