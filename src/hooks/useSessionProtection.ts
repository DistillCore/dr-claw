import { useCallback, useState } from 'react';
import { isTemporarySessionId } from '../constants/session';

export function useSessionProtection() {
  const [activeSessions, setActiveSessions] = useState<Set<string>>(() => readSharedSessionSet(ACTIVE_SESSIONS_STORAGE_KEY));
  const [processingSessions, setProcessingSessions] = useState<Set<string>>(() => readSharedSessionSet(PROCESSING_SESSIONS_STORAGE_KEY));
  const syncFromStorage = useCallback((storageKey: string, nextValue?: string | null) => {
    const nextSet = nextValue !== undefined
      ? (() => {
          try {
            const parsed = nextValue ? JSON.parse(nextValue) : [];
            return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string' && value.length > 0) : []);
          } catch {
            return new Set<string>();
          }
        })()
      : readSharedSessionSet(storageKey);

    if (storageKey === ACTIVE_SESSIONS_STORAGE_KEY) {
      setActiveSessions(nextSet);
      return;
    }

    if (storageKey === PROCESSING_SESSIONS_STORAGE_KEY) {
      setProcessingSessions(nextSet);
    }
  }, []);

  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (!event.key || (event.key !== ACTIVE_SESSIONS_STORAGE_KEY && event.key !== PROCESSING_SESSIONS_STORAGE_KEY)) {
        return;
      }

      syncFromStorage(event.key, event.newValue);
    };

    const handleCustomSync = (event: Event) => {
      const detail = (event as CustomEvent<{ storageKey?: string; value?: string }>).detail;
      const storageKey = detail?.storageKey;
      if (!storageKey || (storageKey !== ACTIVE_SESSIONS_STORAGE_KEY && storageKey !== PROCESSING_SESSIONS_STORAGE_KEY)) {
        return;
      }

      syncFromStorage(storageKey, detail?.value);
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener(SESSION_PROTECTION_EVENT, handleCustomSync as EventListener);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener(SESSION_PROTECTION_EVENT, handleCustomSync as EventListener);
    };
  }, [syncFromStorage]);

  const updateSharedSet = useCallback(
    (storageKey: string, updater: (previous: Set<string>) => Set<string>) => {
      const previous = readSharedSessionSet(storageKey);
      const next = updater(previous);
      writeSharedSessionSet(storageKey, next);
      syncFromStorage(storageKey, JSON.stringify(Array.from(next)));
    },
    [syncFromStorage],
  );

  const markSessionAsActive = useCallback((sessionId?: string | null) => {
    if (!sessionId) {
      return;
    }

    updateSharedSet(ACTIVE_SESSIONS_STORAGE_KEY, (previous) => new Set([...previous, sessionId]));
  }, [updateSharedSet]);

  const markSessionAsInactive = useCallback((sessionId?: string | null) => {
    if (!sessionId) {
      return;
    }

    updateSharedSet(ACTIVE_SESSIONS_STORAGE_KEY, (previous) => {
      const next = new Set(previous);
      next.delete(sessionId);
      return next;
    });
  }, [updateSharedSet]);

  const markSessionAsProcessing = useCallback((sessionId?: string | null) => {
    if (!sessionId) {
      return;
    }

    updateSharedSet(PROCESSING_SESSIONS_STORAGE_KEY, (previous) => new Set([...previous, sessionId]));
  }, [updateSharedSet]);

  const markSessionAsNotProcessing = useCallback((sessionId?: string | null) => {
    if (!sessionId) {
      return;
    }

    updateSharedSet(PROCESSING_SESSIONS_STORAGE_KEY, (previous) => {
      const next = new Set(previous);
      next.delete(sessionId);
      return next;
    });
  }, [updateSharedSet]);

  const replaceTemporarySession = useCallback((realSessionId?: string | null) => {
    if (!realSessionId) {
      return;
    }

    updateSharedSet(ACTIVE_SESSIONS_STORAGE_KEY, (previous) => {
      const next = new Set<string>();
      for (const sessionId of prev) {
        if (!isTemporarySessionId(sessionId)) {
          next.add(sessionId);
        }
      }
      next.add(realSessionId);
      return next;
    });
  }, [updateSharedSet]);

  return {
    activeSessions,
    processingSessions,
    markSessionAsActive,
    markSessionAsInactive,
    markSessionAsProcessing,
    markSessionAsNotProcessing,
    replaceTemporarySession,
  };
}
