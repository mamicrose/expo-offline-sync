import { useCallback, useEffect, useRef, useState } from 'react';
import { MutationItem } from '../types';
import { useOfflineSync } from './OfflineSyncProvider';

export interface UseOfflineMutationOptions<TPayload = any, TResult = any, TMeta = Record<string, any>> {
  type: string;
  scope?: string;
  maxRetries?: number;
  priority?: number;
  meta?: TMeta;
  /**
   * Called immediately upon queueing for instantaneous optimistic UI updates
   */
  onMutate?: (payload: TPayload, item: MutationItem<TPayload, TMeta>) => void | Promise<void>;
  /**
   * Called when mutation finishes successfully
   */
  onSuccess?: (result: TResult, item: MutationItem<TPayload, TMeta>) => void | Promise<void>;
  /**
   * Called when mutation permanently fails (max retries exceeded or unrecoverable error)
   */
  onError?: (error: Error, item: MutationItem<TPayload, TMeta>) => void | Promise<void>;
}

export interface UseOfflineMutationResult<TPayload = any, TResult = any, TMeta = Record<string, any>> {
  mutate: (payload: TPayload, overrideMeta?: TMeta) => void;
  mutateAsync: (payload: TPayload, overrideMeta?: TMeta) => Promise<MutationItem<TPayload, TMeta>>;
  status: 'idle' | 'pending' | 'success' | 'error';
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: Error | null;
  data: TResult | null;
  reset: () => void;
}

export function useOfflineMutation<TPayload = any, TResult = any, TMeta = Record<string, any>>(
  options: UseOfflineMutationOptions<TPayload, TResult, TMeta>
): UseOfflineMutationResult<TPayload, TResult, TMeta> {
  const client = useOfflineSync();
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<TResult | null>(null);

  // Store active item IDs from this hook instance to match events
  const pendingItemIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const unsubSuccess = client.on('syncSuccess', (item, result) => {
      if (pendingItemIdsRef.current.has(item.id)) {
        pendingItemIdsRef.current.delete(item.id);
        setStatus('success');
        setData(result);
        if (options.onSuccess) {
          options.onSuccess(result, item as MutationItem<TPayload, TMeta>);
        }
      }
    });

    const unsubRollback = client.on('rollback', (item, err) => {
      if (pendingItemIdsRef.current.has(item.id)) {
        pendingItemIdsRef.current.delete(item.id);
        setStatus('error');
        setError(err);
        if (options.onError) {
          options.onError(err, item as MutationItem<TPayload, TMeta>);
        }
      }
    });

    return () => {
      unsubSuccess();
      unsubRollback();
    };
  }, [client, options]);

  const mutateAsync = useCallback(
    async (payload: TPayload, overrideMeta?: TMeta): Promise<MutationItem<TPayload, TMeta>> => {
      setStatus('pending');
      setError(null);

      const mergedMeta = { ...options.meta, ...overrideMeta } as TMeta;

      const item = await client.enqueue<TPayload, TMeta>({
        type: options.type,
        payload,
        scope: options.scope,
        meta: mergedMeta,
        maxRetries: options.maxRetries,
        priority: options.priority,
        onOptimistic: (enqueuedItem) => {
          pendingItemIdsRef.current.add(enqueuedItem.id);
          if (options.onMutate) {
            options.onMutate(payload, enqueuedItem);
          }
        },
      });

      return item;
    },
    [client, options]
  );

  const mutate = useCallback(
    (payload: TPayload, overrideMeta?: TMeta) => {
      mutateAsync(payload, overrideMeta).catch((err) => {
        console.error('[expo-offline-sync] mutate error:', err);
      });
    },
    [mutateAsync]
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
    setData(null);
    pendingItemIdsRef.current.clear();
  }, []);

  return {
    mutate,
    mutateAsync,
    status,
    isPending: status === 'pending',
    isSuccess: status === 'success',
    isError: status === 'error',
    error,
    data,
    reset,
  };
}
