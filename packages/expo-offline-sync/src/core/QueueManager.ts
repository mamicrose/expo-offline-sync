import {
  EnqueueHttpOptions,
  EnqueueOptions,
  HttpMutationPayload,
  MutationItem,
  MutationStatus,
  QueueStats,
  StorageAdapter,
} from '../types';
import { TypedEventEmitter } from './EventEmitter';
import { HTTP_MUTATION_TYPE } from './HttpExecutor';

export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export interface QueueManagerOptions {
  storage: StorageAdapter;
  events: TypedEventEmitter<any>;
  defaultScope?: string;
  defaultMaxRetries?: number;
}

export class QueueManager {
  private storage: StorageAdapter;
  private events: TypedEventEmitter<any>;
  private defaultScope: string;
  private defaultMaxRetries: number;

  constructor(options: QueueManagerOptions) {
    this.storage = options.storage;
    this.events = options.events;
    this.defaultScope = options.defaultScope ?? 'default';
    this.defaultMaxRetries = options.defaultMaxRetries ?? 5;
  }

  async enqueue<TPayload = any, TMeta = Record<string, any>>(
    options: EnqueueOptions<TPayload, TMeta>
  ): Promise<MutationItem<TPayload, TMeta>> {
    const now = Date.now();
    const id = generateUUID();
    const idempotencyKey = options.idempotencyKey ?? generateUUID();
    const scope = options.scope ?? this.defaultScope;
    const maxRetries = options.maxRetries ?? this.defaultMaxRetries;

    const item: MutationItem<TPayload, TMeta> = {
      id,
      type: options.type,
      scope,
      payload: options.payload,
      meta: options.meta,
      status: 'pending',
      attemptCount: 0,
      maxRetries,
      createdAt: now,
      updatedAt: now,
      idempotencyKey,
      priority: options.priority ?? 0,
    };

    // Save to durable storage
    await this.storage.enqueue(item);

    // Call optimistic callback immediately
    if (options.onOptimistic) {
      try {
        options.onOptimistic(item);
      } catch (err) {
        console.error('[expo-offline-sync] Error in onOptimistic callback:', err);
      }
    }

    // Emit event
    this.events.emit('enqueued', item);

    return item;
  }

  async enqueueHttp<TMeta = Record<string, any>>(
    options: EnqueueHttpOptions<TMeta>
  ): Promise<MutationItem<HttpMutationPayload, TMeta>> {
    const payload: HttpMutationPayload = {
      url: options.url,
      method: options.method ?? 'POST',
      headers: options.headers,
      body: options.body,
      timeoutMs: options.timeoutMs,
    };

    return this.enqueue<HttpMutationPayload, TMeta>({
      type: HTTP_MUTATION_TYPE,
      payload,
      scope: options.scope,
      meta: options.meta,
      maxRetries: options.maxRetries,
      idempotencyKey: options.idempotencyKey,
      onOptimistic: options.onOptimistic,
      onRollback: options.onRollback,
      onSuccess: options.onSuccess,
    });
  }

  async getPending(scope?: string): Promise<MutationItem[]> {
    return this.storage.getPending(scope);
  }

  async getById(id: string): Promise<MutationItem | null> {
    return this.storage.getById(id);
  }

  async markSyncing(id: string): Promise<void> {
    await this.storage.update(id, {
      status: 'syncing',
    });
  }

  async markCompleted(id: string): Promise<void> {
    // We remove completed items to keep storage lean and fast
    await this.storage.remove(id);
  }

  async markFailed(id: string, error: Error, willRetry: boolean, attemptCount: number): Promise<void> {
    const status: MutationStatus = willRetry ? 'pending' : 'failed';
    const lastError = {
      message: error.message || 'Unknown error',
      code: (error as any).code || (error as any).status,
      stack: error.stack,
    };

    await this.storage.update(id, {
      status,
      attemptCount,
      lastError,
    });
  }

  async retryItem(id: string): Promise<MutationItem | null> {
    const item = await this.storage.getById(id);
    if (!item) return null;

    await this.storage.update(id, {
      status: 'pending',
      attemptCount: 0,
      lastError: undefined,
    });

    return this.storage.getById(id);
  }

  async retryScope(scope?: string): Promise<void> {
    const failedItems = await this.storage.getAll({
      status: 'failed',
      scope,
    });

    for (const item of failedItems) {
      await this.storage.update(item.id, {
        status: 'pending',
        attemptCount: 0,
        lastError: undefined,
      });
    }
  }

  async cancel(id: string): Promise<boolean> {
    const item = await this.storage.getById(id);
    if (!item) return false;

    await this.storage.remove(id);
    return true;
  }

  async clear(scope?: string): Promise<void> {
    await this.storage.clear(scope);
  }

  async getAll(filter?: { status?: MutationStatus; scope?: string }): Promise<MutationItem[]> {
    return this.storage.getAll(filter);
  }

  async getStats(): Promise<QueueStats> {
    return this.storage.getStats();
  }
}

