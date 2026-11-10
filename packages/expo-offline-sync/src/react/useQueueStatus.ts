import { useCallback, useEffect, useState } from 'react';
import { QueueStats } from '../types';
import { useOfflineSync } from './OfflineSyncProvider';

export interface UseQueueStatusResult {
  isOnline: boolean;
  isSyncing: boolean;
  stats: QueueStats;
  sync: () => Promise<void>;
  retryAll: (scope?: string) => Promise<void>;
  clear: (scope?: string) => Promise<void>;
}

export function useQueueStatus(): UseQueueStatusResult {
  const client = useOfflineSync();
  const [isOnline, setIsOnline] = useState<boolean>(client.isOnline);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [stats, setStats] = useState<QueueStats>({
    total: 0,
    pending: 0,
    syncing: 0,
    failed: 0,
    completed: 0,
    scopes: [],
  });

  const refreshStats = useCallback(async () => {
    try {
      const currentStats = await client.getStats();
      setStats(currentStats);
    } catch {}
  }, [client]);

  useEffect(() => {
    refreshStats();

    const unsubOnline = client.on('onlineChange', (online) => {
      setIsOnline(online);
      refreshStats();
    });

    const unsubEnqueued = client.on('enqueued', () => {
      refreshStats();
    });

    const unsubStart = client.on('syncStart', () => {
      setIsSyncing(true);
      refreshStats();
    });

    const unsubSuccess = client.on('syncSuccess', () => {
      refreshStats();
    });

    const unsubError = client.on('syncError', () => {
      refreshStats();
    });

    const unsubComplete = client.on('syncComplete', () => {
      setIsSyncing(false);
      refreshStats();
    });

    return () => {
      unsubOnline();
      unsubEnqueued();
      unsubStart();
      unsubSuccess();
      unsubError();
      unsubComplete();
    };
  }, [client, refreshStats]);

  const sync = useCallback(async () => {
    await client.sync();
    await refreshStats();
  }, [client, refreshStats]);

  const retryAll = useCallback(
    async (scope?: string) => {
      await client.retryScope(scope);
      await refreshStats();
    },
    [client, refreshStats]
  );

  const clear = useCallback(
    async (scope?: string) => {
      await client.clear(scope);
      await refreshStats();
    },
    [client, refreshStats]
  );

  return {
    isOnline,
    isSyncing,
    stats,
    sync,
    retryAll,
    clear,
  };
}

