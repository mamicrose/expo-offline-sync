import { useEffect, useState } from 'react';
import { useOfflineSync } from './OfflineSyncProvider';

export function useIsOnline(): boolean {
  const client = useOfflineSync();
  const [isOnline, setIsOnline] = useState<boolean>(client.isOnline);

  useEffect(() => {
    setIsOnline(client.isOnline);
    return client.on('onlineChange', (online) => {
      setIsOnline(online);
    });
  }, [client]);

  return isOnline;
}

