import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ManualNetworkMonitor,
  MemoryAdapter,
  OfflineSyncClient,
  OfflineSyncProvider,
  useIsOnline,
  useOfflineMutation,
  useOfflineSync,
  useQueueStatus,
} from '../src';

describe('React Layer (Hooks & Provider)', () => {
  let storage: MemoryAdapter;
  let network: ManualNetworkMonitor;
  let client: OfflineSyncClient;

  beforeEach(() => {
    storage = new MemoryAdapter();
    network = new ManualNetworkMonitor(true);
    client = new OfflineSyncClient({
      storage,
      networkMonitor: network,
      autoSync: false,
    });
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <OfflineSyncProvider client={client}>{children}</OfflineSyncProvider>
  );

  it('useOfflineSync returns active client from context', () => {
    const { result } = renderHook(() => useOfflineSync(), { wrapper });
    expect(result.current).toBe(client);
  });

  it('useIsOnline reflects network status changes', () => {
    const { result } = renderHook(() => useIsOnline(), { wrapper });
    expect(result.current).toBe(true);

    act(() => {
      network.setOnline(false);
    });
    expect(result.current).toBe(false);

    act(() => {
      network.setOnline(true);
    });
    expect(result.current).toBe(true);
  });

  it('useQueueStatus tracks pending mutations and sync state', async () => {
    client.register('TEST_TASK', async () => {
      return { done: true };
    });

    const { result } = renderHook(() => useQueueStatus(), { wrapper });

    expect(result.current.stats.pending).toBe(0);

    // Enqueue an item
    await act(async () => {
      await client.enqueue({ type: 'TEST_TASK', payload: { name: 'Item 1' } });
    });

    expect(result.current.stats.pending).toBe(1);

    // Sync queue
    await act(async () => {
      await result.current.sync();
    });

    expect(result.current.stats.pending).toBe(0);
  });

  it('useOfflineMutation executes optimistic update and handles success', async () => {
    let serverReceived: any = null;
    client.register('CREATE_TODO', async (payload: { title: string }) => {
      serverReceived = payload;
      return { id: 'todo-999', ...payload };
    });

    const onMutate = vi.fn();
    const onSuccess = vi.fn();
    const onError = vi.fn();

    const { result } = renderHook(
      () =>
        useOfflineMutation({
          type: 'CREATE_TODO',
          onMutate,
          onSuccess,
          onError,
        }),
      { wrapper }
    );

    // Mutate
    await act(async () => {
      await result.current.mutateAsync({ title: 'Buy milk' });
    });

    // Optimistic callback called immediately
    expect(onMutate).toHaveBeenCalledTimes(1);
    expect(onMutate).toHaveBeenCalledWith(
      { title: 'Buy milk' },
      expect.objectContaining({ type: 'CREATE_TODO' })
    );

    // Now sync
    await act(async () => {
      await client.sync();
    });

    expect(serverReceived).toEqual({ title: 'Buy milk' });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.data).toEqual({ id: 'todo-999', title: 'Buy milk' });
  });

  it('useOfflineMutation triggers onError and rollback on failure', async () => {
    client.register('FAIL_TODO', async () => {
      const err: any = new Error('Invalid todo payload');
      err.status = 400; // Fatal
      throw err;
    });

    const onMutate = vi.fn();
    const onError = vi.fn();

    const { result } = renderHook(
      () =>
        useOfflineMutation({
          type: 'FAIL_TODO',
          onMutate,
          onError,
        }),
      { wrapper }
    );

    await act(async () => {
      await result.current.mutateAsync({ title: 'Broken' });
    });

    expect(onMutate).toHaveBeenCalledTimes(1);

    await act(async () => {
      await client.sync();
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(result.current.isError).toBe(true);
    expect(result.current.error?.message).toBe('Invalid todo payload');
  });
});

