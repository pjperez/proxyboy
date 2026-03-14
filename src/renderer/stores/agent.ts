import { create } from 'zustand';
import type { AgentMessage, AgentToolCall } from '../../shared/types';
import { randomUUID } from 'crypto';

interface AgentState {
  messages: AgentMessage[];
  isLoading: boolean;
  currentStreamContent: string;
  toolCalls: AgentToolCall[];
  addMessage: (message: AgentMessage) => void;
  setLoading: (loading: boolean) => void;
  appendStreamContent: (content: string) => void;
  clearStreamContent: () => void;
  addToolCall: (toolCall: AgentToolCall) => void;
  clearMessages: () => void;
  sendMessage: (text: string) => Promise<void>;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export const useAgentStore = create<AgentState>((set, get) => ({
  messages: [],
  isLoading: false,
  currentStreamContent: '',
  toolCalls: [],

  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  setLoading: (loading) => set({ isLoading: loading }),

  appendStreamContent: (content) =>
    set((state) => ({ currentStreamContent: state.currentStreamContent + content })),

  clearStreamContent: () => set({ currentStreamContent: '' }),

  addToolCall: (toolCall) =>
    set((state) => ({ toolCalls: [...state.toolCalls, toolCall] })),

  clearMessages: () => set({ messages: [], toolCalls: [] }),

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
        // Prefer streamed content over IPC result
        const streamedContent = get().currentStreamContent;
        const content = streamedContent || result?.content || result?.error || 'No response received.';
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
