import { NetInfoNetworkMonitor } from '../network/NetInfoNetworkMonitor';
import { MemoryAdapter } from '../storage/MemoryAdapter';
import { SQLiteAdapter } from '../storage/SQLiteAdapter';
import {
  EnqueueHttpOptions,
  EnqueueOptions,
  HttpMutationPayload,
  MutationHandler,
  MutationItem,
  MutationStatus,
  NetworkMonitor,
  OfflineSyncEventMap,
  OfflineSyncOptions,
  QueueStats,
  StorageAdapter,
} from '../types';
import { TypedEventEmitter } from './EventEmitter';
import { HTTP_MUTATION_TYPE, HttpExecutor } from './HttpExecutor';
import { QueueManager } from './QueueManager';
import { Registry } from './Registry';
import { Scheduler } from './Scheduler';

export class OfflineSyncClient {
  readonly storage: StorageAdapter;
  readonly network: NetworkMonitor;
  readonly registry: Registry;
  readonly queue: QueueManager;
  readonly scheduler: Scheduler;
  readonly events: TypedEventEmitter<OfflineSyncEventMap>;

  private httpExecutor: HttpExecutor;
  private autoSync: boolean;
  private unsubscribeNetwork: (() => void) | null = null;
  private isDestroyed = false;

  constructor(options: OfflineSyncOptions = {}) {
    this.events = new TypedEventEmitter<OfflineSyncEventMap>();
    this.autoSync = options.autoSync ?? true;

    // 1. Initialize Storage Adapter
    if (options.storage) {
      this.storage = options.storage;
    } else {
      // Default to SQLiteAdapter, fallback to MemoryAdapter
      try {
        this.storage = new SQLiteAdapter();
      } catch {
        this.storage = new MemoryAdapter();
      }
    }

    // 2. Initialize Network Monitor
    if (options.networkMonitor) {
      this.network = options.networkMonitor;
    } else {
      this.network = new NetInfoNetworkMonitor();
    }

    // 3. Initialize Registry
    this.registry = new Registry();

    // 4. Initialize Built-in HTTP Executor and register handler
    this.httpExecutor = new HttpExecutor({
      getHeaders: options.getHeaders,
    });
    this.registry.register<HttpMutationPayload>(HTTP_MUTATION_TYPE, async (payload, context) => {
      return this.httpExecutor.execute(payload, context);
    });

    // 5. Initialize Queue Manager
    this.queue = new QueueManager({
      storage: this.storage,
      events: this.events,
      defaultScope: options.defaultScope,
      defaultMaxRetries: options.retryPolicy?.maxRetries,
    });

    // 6. Initialize Scheduler
    this.scheduler = new Scheduler({
      queueManager: this.queue,
      registry: this.registry,
      networkMonitor: this.network,
      events: this.events,
      retryPolicy: options.retryPolicy,
      maxConcurrentScopes: options.maxConcurrentScopes,
      onRequest: options.onRequest,
      onResponse: options.onResponse,
      onRollback: options.onRollback,
    });

    // 7. Setup AutoSync on Network Reconnection
    this.unsubscribeNetwork = this.network.subscribe((isOnline) => {
      this.events.emit('onlineChange', isOnline);
      if (isOnline && this.autoSync) {
        this.sync();
      }
    });

    // Initial check and optional immediate sync
    if (this.autoSync && this.network.isOnline) {
      setTimeout(() => this.sync(), 0);
    }
  }

  get isOnline(): boolean {
    return this.network.isOnline;
  }

  get isSyncing(): boolean {
    return this.scheduler.syncing;
  }

  /**
   * Register a typed mutation handler
   */
  register<TPayload = any, TResult = any, TMeta = Record<string, any>>(
    type: string,
    handler: MutationHandler<TPayload, TResult, TMeta>
  ): this {
    this.registry.register(type, handler);
    return this;
  }

  /**
   * Enqueue a custom typed mutation
   */
  async enqueue<TPayload = any, TMeta = Record<string, any>>(
    options: EnqueueOptions<TPayload, TMeta>
  ): Promise<MutationItem<TPayload, TMeta>> {
    const item = await this.queue.enqueue<TPayload, TMeta>(options);

    // Auto-sync if online
    if (this.autoSync && this.network.isOnline) {
      this.sync();
    }

    return item;
  }

  /**
   * Enqueue a direct HTTP request (zero-boilerplate REST mutation)
   */
  async enqueueHttp<TMeta = Record<string, any>>(
    options: EnqueueHttpOptions<TMeta>
  ): Promise<MutationItem<HttpMutationPayload, TMeta>> {
    const item = await this.queue.enqueueHttp<TMeta>(options);

    if (this.autoSync && this.network.isOnline) {
      this.sync();
    }

    return item;
  }

  /**
   * Manually trigger queue processing
   */
  async sync(): Promise<void> {
    if (this.isDestroyed) return;
    return this.scheduler.processQueue();
  }

  /**
   * Pause queue processing
   */
  pause(): void {
    this.scheduler.pause();
  }

  /**
   * Resume queue processing
   */
  resume(): void {
    this.scheduler.resume();
  }

  /**
   * Manually retry a specific failed mutation
   */
  async retryItem(id: string): Promise<MutationItem | null> {
    const item = await this.queue.retryItem(id);
    if (item && this.autoSync && this.network.isOnline) {
      this.sync();
    }
    return item;
  }

  /**
   * Manually retry all failed mutations in a scope (or globally)
   */
  async retryScope(scope?: string): Promise<void> {
    await this.queue.retryScope(scope);
    if (this.autoSync && this.network.isOnline) {
      this.sync();
    }
  }

  /**
   * Cancel and remove an item from the queue
   */
  async cancel(id: string): Promise<boolean> {
    return this.queue.cancel(id);
  }

  /**
   * Clear all items or a specific scope
   */
  async clear(scope?: string): Promise<void> {
    await this.queue.clear(scope);
  }

  /**
   * Get pending items
   */
  async getPending(scope?: string): Promise<MutationItem[]> {
    return this.queue.getPending(scope);
  }

  /**
   * Get all items matching filter
   */
  async getAll(filter?: { status?: MutationStatus; scope?: string }): Promise<MutationItem[]> {
    return this.queue.getAll(filter);
  }

  /**
   * Get queue statistics
   */
  async getStats(): Promise<QueueStats> {
    return this.queue.getStats();
  }

  /**
   * Subscribe to client lifecycle events
   */
  on<K extends keyof OfflineSyncEventMap>(event: K, listener: OfflineSyncEventMap[K]): () => void {
    return this.events.on(event, listener);
  }

  /**
   * Unsubscribe from client lifecycle events
   */
  off<K extends keyof OfflineSyncEventMap>(event: K, listener: OfflineSyncEventMap[K]): void {
    this.events.off(event, listener);
  }

  /**
   * Destroy client and clean up listeners
   */
  destroy(): void {
    this.isDestroyed = true;
    if (this.unsubscribeNetwork) {
      this.unsubscribeNetwork();
      this.unsubscribeNetwork = null;
    }
    this.scheduler.destroy();
    this.events.removeAllListeners();
  }
}
