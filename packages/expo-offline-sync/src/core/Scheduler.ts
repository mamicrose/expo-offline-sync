import {
  MutationContext,
  MutationItem,
  NetworkMonitor,
  RetryPolicy,
} from '../types';
import { TypedEventEmitter } from './EventEmitter';
import { HttpError } from './HttpExecutor';
import { QueueManager } from './QueueManager';
import { Registry } from './Registry';

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 5,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffFactor: 2,
  jitter: true,
  shouldRetry: (error: any) => {
    if (error instanceof HttpError || (error && typeof error.status === 'number')) {
      const status = error.status;
      // Do not retry 4xx errors except 401 (auth issue), 408 (timeout), 429 (rate limit)
      if (status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429) {
        return false;
      }
    }
    return true;
  },
};

export interface SchedulerOptions {
  queueManager: QueueManager;
  registry: Registry;
  networkMonitor: NetworkMonitor;
  events: TypedEventEmitter<any>;
  retryPolicy?: Partial<RetryPolicy>;
  maxConcurrentScopes?: number;
  onRequest?: (item: MutationItem) => Promise<void> | void;
  onResponse?: (item: MutationItem, response: any) => Promise<void> | void;
  onRollback?: (item: MutationItem, error: Error) => Promise<void> | void;
}

export class Scheduler {
  private queueManager: QueueManager;
  private registry: Registry;
  private networkMonitor: NetworkMonitor;
  private events: TypedEventEmitter<any>;
  private retryPolicy: RetryPolicy;
  private maxConcurrentScopes: number;
  private activeScopeMap: Map<string, Promise<void>> = new Map();
  private isPaused = false;
  private isSyncing = false;
  private abortController: AbortController = new AbortController();

  get syncing(): boolean {
    return this.isSyncing;
  }

  private onRequest?: (item: MutationItem) => Promise<void> | void;
  private onResponse?: (item: MutationItem, response: any) => Promise<void> | void;
  private onRollback?: (item: MutationItem, error: Error) => Promise<void> | void;

  constructor(options: SchedulerOptions) {
    this.queueManager = options.queueManager;
    this.registry = options.registry;
    this.networkMonitor = options.networkMonitor;
    this.events = options.events;
    this.retryPolicy = { ...DEFAULT_RETRY_POLICY, ...options.retryPolicy };
    this.maxConcurrentScopes = options.maxConcurrentScopes ?? 3;
    this.onRequest = options.onRequest;
    this.onResponse = options.onResponse;
    this.onRollback = options.onRollback;
  }

  calculateBackoff(attemptCount: number): number {
    const { initialDelayMs, maxDelayMs, backoffFactor, jitter } = this.retryPolicy;
    const baseDelay = initialDelayMs * Math.pow(backoffFactor, Math.max(0, attemptCount - 1));
    const cappedDelay = Math.min(baseDelay, maxDelayMs);

    if (jitter) {
      // 0.8x to 1.2x randomization to prevent thundering herd
      const factor = 0.8 + Math.random() * 0.4;
      return Math.floor(cappedDelay * factor);
    }

    return Math.floor(cappedDelay);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.abortController.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  pause(): void {
    this.isPaused = true;
  }

  resume(): void {
    this.isPaused = false;
    this.processQueue();
  }

  /**
   * Main entry point to process pending queue across scopes
   */
  async processQueue(): Promise<void> {
    if (this.isPaused) return;
    if (!this.networkMonitor.isOnline) return;

    const stats = await this.queueManager.getStats();
    if (stats.pending === 0 && stats.syncing === 0) {
      this.events.emit('syncComplete');
      return;
    }

    this.isSyncing = true;
    const promises: Promise<void>[] = [];

    // Process available scopes up to maxConcurrentScopes
    for (const scope of stats.scopes) {
      if (this.activeScopeMap.size >= this.maxConcurrentScopes) {
        break;
      }

      if (!this.activeScopeMap.has(scope)) {
        const promise = this.processScope(scope).finally(() => {
          this.activeScopeMap.delete(scope);
          if (this.activeScopeMap.size === 0) {
            this.isSyncing = false;
            this.events.emit('syncComplete');
          }
        });
        this.activeScopeMap.set(scope, promise);
        promises.push(promise);
      } else {
        const existingPromise = this.activeScopeMap.get(scope);
        if (existingPromise) {
          promises.push(existingPromise);
        }
      }
    }

    await Promise.all(promises);
  }

  /**
   * Sequentially process items for a specific scope (Deterministic FIFO)
   */
  private async processScope(scope: string): Promise<void> {
    while (!this.isPaused && this.networkMonitor.isOnline) {
      const pendingItems = await this.queueManager.getPending(scope);
      if (pendingItems.length === 0) {
        break;
      }

      const item = pendingItems[0];
      const success = await this.executeItem(item);

      if (!success) {
        // If execution failed and requires retry, break out of this scope loop
        // so it doesn't spin infinitely; it will be retried on next backoff or queue sync
        break;
      }
    }
  }

  /**
   * Executes a single mutation item
   * Returns true if completed or definitively failed, false if waiting for backoff retry
   */
  async executeItem(item: MutationItem): Promise<boolean> {
    if (this.isPaused || !this.networkMonitor.isOnline) {
      return false;
    }

    const handler = this.registry.get(item.type);
    if (!handler) {
      const err = new Error(
        `[expo-offline-sync] No mutation handler registered for type "${item.type}". Please call client.register("${item.type}", handler)`
      );
      await this.queueManager.markFailed(item.id, err, false, item.attemptCount);
      this.events.emit('syncError', item, err);
      this.events.emit('rollback', item, err);
      if (this.onRollback) {
        try {
          await this.onRollback(item, err);
        } catch {}
      }
      return true; // Mark as resolved (unrecoverable error)
    }

    // Mark syncing
    await this.queueManager.markSyncing(item.id);
    this.events.emit('syncStart', item);

    if (this.onRequest) {
      try {
        await this.onRequest(item);
      } catch (err) {
        console.warn('[expo-offline-sync] Error in onRequest hook:', err);
      }
    }

    const context: MutationContext = {
      mutationId: item.id,
      type: item.type,
      scope: item.scope,
      attemptCount: item.attemptCount + 1,
      meta: item.meta,
      idempotencyKey: item.idempotencyKey,
      signal: this.abortController.signal,
    };

    try {
      const result = await handler(item.payload, context);

      // Successfully processed
      await this.queueManager.markCompleted(item.id);

      if (this.onResponse) {
        try {
          await this.onResponse(item, result);
        } catch {}
      }

      this.events.emit('syncSuccess', item, result);
      return true;
    } catch (err: any) {
      const error: Error = err instanceof Error ? err : new Error(String(err));
      const nextAttempt = item.attemptCount + 1;
      const maxRetries = item.maxRetries ?? this.retryPolicy.maxRetries;

      let shouldRetry = nextAttempt < maxRetries;
      if (shouldRetry && this.retryPolicy.shouldRetry) {
        try {
          shouldRetry = Boolean(await this.retryPolicy.shouldRetry(err, item));
        } catch {
          shouldRetry = true;
        }
      }

      if (shouldRetry) {
        // Will retry: mark pending with incremented attempt
        await this.queueManager.markFailed(item.id, error, true, nextAttempt);
        this.events.emit('syncError', item, error);

        const delay = this.calculateBackoff(nextAttempt);
        await this.sleep(delay);

        return false; // Scope will retry later
      } else {
        // Fatal / Exceeded max retries: mark permanently failed and trigger rollback
        await this.queueManager.markFailed(item.id, error, false, nextAttempt);
        this.events.emit('syncError', item, error);
        this.events.emit('rollback', item, error);

        if (this.onRollback) {
          try {
            await this.onRollback(item, error);
          } catch {}
        }

        return true; // Proceed to next item in scope to prevent deadlock
      }
    }
  }

  destroy(): void {
    this.pause();
    this.abortController.abort();
    this.activeScopeMap.clear();
  }
}
