import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ManualNetworkMonitor,
  MemoryAdapter,
  OfflineSyncClient,
  QueueManager,
  Registry,
  Scheduler,
} from '../src';

describe('Storage & QueueManager', () => {
  let storage: MemoryAdapter;
  let queue: QueueManager;
  let client: OfflineSyncClient;
  let network: ManualNetworkMonitor;

  beforeEach(() => {
    storage = new MemoryAdapter();
    network = new ManualNetworkMonitor(true);
    client = new OfflineSyncClient({
      storage,
      networkMonitor: network,
      autoSync: false,
    });
    queue = client.queue;
  });

  it('enqueues mutations and preserves FIFO order', async () => {
    await queue.enqueue({ type: 'ADD_ITEM', payload: { id: 1 } });
    await queue.enqueue({ type: 'ADD_ITEM', payload: { id: 2 } });
    await queue.enqueue({ type: 'ADD_ITEM', payload: { id: 3 } });

    const pending = await queue.getPending();
    expect(pending).toHaveLength(3);
    expect(pending[0].payload.id).toBe(1);
    expect(pending[1].payload.id).toBe(2);
    expect(pending[2].payload.id).toBe(3);
  });

  it('prioritizes higher priority mutations ahead of normal ones', async () => {
    await queue.enqueue({ type: 'NORMAL', payload: { order: 1 }, priority: 0 });
    await queue.enqueue({ type: 'URGENT', payload: { order: 2 }, priority: 10 });
    await queue.enqueue({ type: 'LOW', payload: { order: 3 }, priority: -5 });

    const pending = await queue.getPending();
    expect(pending).toHaveLength(3);
    expect(pending[0].payload.order).toBe(2); // Urgent (priority 10)
    expect(pending[1].payload.order).toBe(1); // Normal (priority 0)
    expect(pending[2].payload.order).toBe(3); // Low (priority -5)
  });

  it('calculates queue stats correctly', async () => {
    await queue.enqueue({ type: 'T1', payload: {}, scope: 'chat' });
    await queue.enqueue({ type: 'T2', payload: {}, scope: 'orders' });

    const stats = await queue.getStats();
    expect(stats.total).toBe(2);
    expect(stats.pending).toBe(2);
    expect(stats.scopes).toContain('chat');
    expect(stats.scopes).toContain('orders');
  });

  it('calls onOptimistic immediately upon enqueue', async () => {
    const onOptimistic = vi.fn();

    const item = await queue.enqueue({
      type: 'OPTIMISTIC_TEST',
      payload: { text: 'hello' },
      onOptimistic,
    });

    expect(onOptimistic).toHaveBeenCalledTimes(1);
    expect(onOptimistic).toHaveBeenCalledWith(item);
    expect(item.idempotencyKey).toBeDefined();
    expect(item.status).toBe('pending');
  });
});

describe('Scoped Concurrency & Head-of-Line Blocking Prevention', () => {
  it('allows different scopes to run independently when one scope fails', async () => {
    const network = new ManualNetworkMonitor(true);
    const storage = new MemoryAdapter();
    const client = new OfflineSyncClient({
      storage,
      networkMonitor: network,
      autoSync: false,
      retryPolicy: {
        maxRetries: 3,
        initialDelayMs: 10,
        backoffFactor: 1,
        jitter: false,
      },
    });

    const chatOrder: string[] = [];
    const profileOrder: string[] = [];

    // Scope A: Chat (will fail and retry)
    let chatAttempts = 0;
    client.register('CHAT_MSG', async (payload: { msg: string }) => {
      chatAttempts++;
      if (chatAttempts < 3) {
        throw new Error('Temporary chat server error');
      }
      chatOrder.push(payload.msg);
      return { success: true };
    });

    // Scope B: Profile (independent, succeeds immediately)
    client.register('UPDATE_PROFILE', async (payload: { name: string }) => {
      profileOrder.push(payload.name);
      return { success: true };
    });

    await client.enqueue({ type: 'CHAT_MSG', payload: { msg: 'msg1' }, scope: 'chat:1' });
    await client.enqueue({ type: 'UPDATE_PROFILE', payload: { name: 'Alice' }, scope: 'profile' });

    // Sync
    await client.sync();

    // Profile must have completed immediately without waiting for chat retry
    expect(profileOrder).toEqual(['Alice']);
  });
});

describe('Retry & Backoff Policy', () => {
  it('does not retry 4xx fatal errors and triggers rollback immediately', async () => {
    const network = new ManualNetworkMonitor(true);
    const storage = new MemoryAdapter();
    const onRollbackGlobal = vi.fn();

    const client = new OfflineSyncClient({
      storage,
      networkMonitor: network,
      autoSync: false,
      onRollback: onRollbackGlobal,
      retryPolicy: {
        maxRetries: 5,
        initialDelayMs: 10,
      },
    });

    let executionCount = 0;
    client.register('BAD_REQUEST', async () => {
      executionCount++;
      const error: any = new Error('Validation failed');
      error.status = 422; // Unprocessable Entity
      throw error;
    });

    const item = await client.enqueue({
      type: 'BAD_REQUEST',
      payload: {},
      scope: 'test',
    });

    await client.sync();

    // Should only be executed ONCE, no retries wasted for 422
    expect(executionCount).toBe(1);
    expect(onRollbackGlobal).toHaveBeenCalledTimes(1);

    const updatedItem = await client.storage.getById(item.id);
    expect(updatedItem?.status).toBe('failed');
    expect(updatedItem?.lastError?.message).toBe('Validation failed');
  });

  it('retries temporary 500 errors up to maxRetries', async () => {
    const network = new ManualNetworkMonitor(true);
    const storage = new MemoryAdapter();

    const client = new OfflineSyncClient({
      storage,
      networkMonitor: network,
      autoSync: false,
      retryPolicy: {
        maxRetries: 3,
        initialDelayMs: 5,
        backoffFactor: 1,
        jitter: false,
      },
    });

    let attempts = 0;
    client.register('SERVER_ERROR', async () => {
      attempts++;
      const error: any = new Error('Internal Server Error');
      error.status = 500;
      throw error;
    });

    const item = await client.enqueue({
      type: 'SERVER_ERROR',
      payload: {},
      scope: 'test_retry',
    });

    // Execute first attempt
    await client.sync();
    expect(attempts).toBe(1);

    // Execute second attempt
    await client.sync();
    expect(attempts).toBe(2);

    // Execute third attempt (exceeds maxRetries = 3)
    await client.sync();
    expect(attempts).toBe(3);

    const finalItem = await client.storage.getById(item.id);
    expect(finalItem?.status).toBe('failed');
  });
});

describe('Network Status & Offline Queueing', () => {
  it('does not process queue while offline, processes automatically when online', async () => {
    const network = new ManualNetworkMonitor(false); // Initially offline
    const storage = new MemoryAdapter();

    const client = new OfflineSyncClient({
      storage,
      networkMonitor: network,
      autoSync: true, // Will auto-sync on online change
    });

    const executed: string[] = [];
    client.register('OFFLINE_ACTION', async (payload: { title: string }) => {
      executed.push(payload.title);
      return { ok: true };
    });

    await client.enqueue({ type: 'OFFLINE_ACTION', payload: { title: 'First offline action' } });
    await client.enqueue({ type: 'OFFLINE_ACTION', payload: { title: 'Second offline action' } });

    // Still offline: nothing should have executed
    expect(executed).toHaveLength(0);
    const pendingBefore = await client.getPending();
    expect(pendingBefore).toHaveLength(2);

    // Network returns!
    network.setOnline(true);

    // Wait microtask for autoSync
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(executed).toEqual(['First offline action', 'Second offline action']);
    const pendingAfter = await client.getPending();
    expect(pendingAfter).toHaveLength(0);

    client.destroy();
  });
});

describe('Dynamic Auth Headers Injection', () => {
  it('resolves dynamic auth headers at execution time', async () => {
    let currentToken = 'initial-token';
    const network = new ManualNetworkMonitor(true);
    const storage = new MemoryAdapter();

    const capturedHeaders: Record<string, string>[] = [];

    // Mock global fetch
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      capturedHeaders.push(init.headers as Record<string, string>);
      return {
        ok: true,
        headers: {
          get: () => 'application/json',
        },
        json: async () => ({ success: true }),
      };
    }) as any;

    const client = new OfflineSyncClient({
      storage,
      networkMonitor: network,
      autoSync: false,
      getHeaders: async () => ({
        Authorization: `Bearer ${currentToken}`,
      }),
    });

    // Enqueue an HTTP request
    await client.enqueueHttp({
      url: 'https://api.example.com/messages',
      method: 'POST',
      body: { text: 'Hello' },
    });

    // Token was refreshed in background while request was queued
    currentToken = 'fresh-refreshed-jwt-token';

    await client.sync();

    expect(capturedHeaders).toHaveLength(1);
    expect(capturedHeaders[0]['Authorization']).toBe('Bearer fresh-refreshed-jwt-token');
    expect(capturedHeaders[0]['Idempotency-Key']).toBeDefined();

    global.fetch = originalFetch;
    client.destroy();
  });
});

