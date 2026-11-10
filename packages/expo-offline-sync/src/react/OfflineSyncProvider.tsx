import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { OfflineSyncClient } from '../core/OfflineSyncClient';
import { OfflineSyncOptions } from '../types';

const OfflineSyncContext = createContext<OfflineSyncClient | null>(null);

export interface OfflineSyncProviderProps {
  client?: OfflineSyncClient;
  options?: OfflineSyncOptions;
  children: React.ReactNode;
}

export const OfflineSyncProvider: React.FC<OfflineSyncProviderProps> = ({
  client: externalClient,
  options,
  children,
}) => {
  const [internalClient, setInternalClient] = useState<OfflineSyncClient | null>(null);

  useEffect(() => {
    if (!externalClient) {
      const client = new OfflineSyncClient(options);
      setInternalClient(client);
      return () => {
        client.destroy();
      };
    }
    return undefined;
  }, [externalClient]);

  const activeClient = useMemo(() => {
    return externalClient || internalClient;
  }, [externalClient, internalClient]);

  if (!activeClient) {
    return null;
  }

  return (
    <OfflineSyncContext.Provider value={activeClient}>
      {children}
    </OfflineSyncContext.Provider>
  );
};

export function useOfflineSync(): OfflineSyncClient {
  const context = useContext(OfflineSyncContext);
  if (!context) {
    throw new Error(
      '[expo-offline-sync] useOfflineSync must be used within an <OfflineSyncProvider>'
    );
  }
  return context;
}

