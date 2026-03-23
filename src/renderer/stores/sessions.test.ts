import { beforeEach, describe, expect, it } from 'vitest';
import { useSessionStore } from './sessions';
import type { Session } from '../../shared/types';

function createSession(overrides?: Partial<Session>): Session {
  return {
    id: 'test-1',
    name: 'Test Session',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('useSessionStore', () => {
  beforeEach(() => {
    useSessionStore.setState({
      sessions: [],
      activeSessionId: 'default',
    });
  });

  describe('setSessions', () => {
    it('replaces all sessions', () => {
      const sessions = [
        createSession({ id: 'default', name: 'Default' }),
        createSession({ id: 's1', name: 'Session 1' }),
      ];
      useSessionStore.getState().setSessions(sessions);
      expect(useSessionStore.getState().sessions).toEqual(sessions);
    });
  });

  describe('setActiveSessionId', () => {
    it('updates the active session id', () => {
      useSessionStore.getState().setActiveSessionId('s1');
      expect(useSessionStore.getState().activeSessionId).toBe('s1');
    });
  });

  describe('addSession', () => {
    it('appends a new session', () => {
      const existing = createSession({ id: 'default', name: 'Default' });
      useSessionStore.getState().setSessions([existing]);

      const newSession = createSession({ id: 's2', name: 'New' });
      useSessionStore.getState().addSession(newSession);

      expect(useSessionStore.getState().sessions).toHaveLength(2);
      expect(useSessionStore.getState().sessions[1].id).toBe('s2');
    });
  });

  describe('removeSession', () => {
    it('removes a session by id', () => {
      const sessions = [
        createSession({ id: 'default', name: 'Default' }),
        createSession({ id: 's1', name: 'Session 1' }),
        createSession({ id: 's2', name: 'Session 2' }),
      ];
      useSessionStore.getState().setSessions(sessions);

      useSessionStore.getState().removeSession('s1');
      const remaining = useSessionStore.getState().sessions;
      expect(remaining).toHaveLength(2);
      expect(remaining.map(s => s.id)).toEqual(['default', 's2']);
    });

    it('does not crash when removing a non-existent id', () => {
      const sessions = [createSession({ id: 'default', name: 'Default' })];
      useSessionStore.getState().setSessions(sessions);

      useSessionStore.getState().removeSession('non-existent');
      expect(useSessionStore.getState().sessions).toHaveLength(1);
    });
  });

  describe('renameSession', () => {
    it('renames a session', () => {
      const sessions = [
        createSession({ id: 'default', name: 'Default' }),
        createSession({ id: 's1', name: 'Old Name' }),
      ];
      useSessionStore.getState().setSessions(sessions);

      useSessionStore.getState().renameSession('s1', 'New Name');
      const renamed = useSessionStore.getState().sessions.find(s => s.id === 's1');
      expect(renamed?.name).toBe('New Name');
    });

    it('updates the updatedAt timestamp', () => {
      const oldTime = Date.now() - 10000;
      const sessions = [
        createSession({ id: 's1', name: 'Old', updatedAt: oldTime }),
      ];
      useSessionStore.getState().setSessions(sessions);

      useSessionStore.getState().renameSession('s1', 'New');
      const updated = useSessionStore.getState().sessions.find(s => s.id === 's1');
      expect(updated?.updatedAt).toBeGreaterThan(oldTime);
    });

    it('does not affect other sessions', () => {
      const sessions = [
        createSession({ id: 'default', name: 'Default' }),
        createSession({ id: 's1', name: 'Session 1' }),
      ];
      useSessionStore.getState().setSessions(sessions);

      useSessionStore.getState().renameSession('s1', 'Renamed');
      expect(useSessionStore.getState().sessions[0].name).toBe('Default');
    });
  });

  describe('default session protection', () => {
    it('default session can still be removed from the store (UI should prevent this)', () => {
      const sessions = [
        createSession({ id: 'default', name: 'Default' }),
        createSession({ id: 's1', name: 'Session 1' }),
      ];
      useSessionStore.getState().setSessions(sessions);

      // Store itself doesn't enforce this — the TabBar component does
      useSessionStore.getState().removeSession('default');
      expect(useSessionStore.getState().sessions).toHaveLength(1);
    });
  });

  describe('active session switching', () => {
    it('starts with default as active', () => {
      expect(useSessionStore.getState().activeSessionId).toBe('default');
    });

    it('can switch active session', () => {
      useSessionStore.getState().setActiveSessionId('s1');
      expect(useSessionStore.getState().activeSessionId).toBe('s1');
    });

    it('can switch back to default', () => {
      useSessionStore.getState().setActiveSessionId('s1');
      useSessionStore.getState().setActiveSessionId('default');
      expect(useSessionStore.getState().activeSessionId).toBe('default');
    });
  });
});
