import { create } from 'zustand';
import type { Session } from '../../shared/types';

interface SessionState {
  sessions: Session[];
  activeSessionId: string;
  setSessions: (sessions: Session[]) => void;
  setActiveSessionId: (id: string) => void;
  addSession: (session: Session) => void;
  removeSession: (id: string) => void;
  renameSession: (id: string, name: string) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  activeSessionId: 'default',
  setSessions: (sessions) => set({ sessions }),
  setActiveSessionId: (activeSessionId) => set({ activeSessionId }),
  addSession: (session) => set((state) => ({ sessions: [...state.sessions, session] })),
  removeSession: (id) => set((state) => ({ sessions: state.sessions.filter(s => s.id !== id) })),
  renameSession: (id, name) => set((state) => ({
    sessions: state.sessions.map(s => s.id === id ? { ...s, name, updatedAt: Date.now() } : s),
  })),
}));
