import { create } from 'zustand';
import type { AgentMessage, AgentToolCall, AgentPermissionRequest } from '../../shared/types';

interface AgentState {
  messages: AgentMessage[];
  isLoading: boolean;
  currentStreamContent: string;
  toolCalls: AgentToolCall[];
  pendingPermissions: AgentPermissionRequest[];
  autoApprove: boolean;
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
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export const useAgentStore = create<AgentState>((set, get) => ({
  messages: [],
  isLoading: false,
  currentStreamContent: '',
  toolCalls: [],
  pendingPermissions: [],
  autoApprove: false,

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
