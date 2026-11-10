/**
 * Mutation lifecycle status in the offline queue
 */
export type MutationStatus = 'pending' | 'syncing' | 'completed' | 'failed' | 'paused';

/**
 * Mutation context passed to registered handlers at execution time
 */
export interface MutationContext<TMeta = Record<string, any>> {
  mutationId: string;
  type: string;
  scope: string;
  attemptCount: number;
  meta?: TMeta;
  idempotencyKey: string;
  signal: AbortSignal;
}

/**
 * Core Mutation Item stored in the durable queue (SQLite / Custom Adapter)
 */
export interface MutationItem<TPayload = any, TMeta = Record<string, any>> {
  id: string;
  type: string;
  scope: string;
  payload: TPayload;
  meta?: TMeta;
  status: MutationStatus;
  attemptCount: number;
  maxRetries: number;
  createdAt: number;
  updatedAt: number;
  lastError?: {
    message: string;
    code?: string | number;
    stack?: string;
  };
  idempotencyKey: string;
  priority?: number;
}

/**
 * Options when enqueueing a mutation
 */
export interface EnqueueOptions<TPayload = any, TMeta = Record<string, any>> {
  type: string;
  payload: TPayload;
  scope?: string;
  meta?: TMeta;
  maxRetries?: number;
  idempotencyKey?: string;
  priority?: number;
  /**
   * Optimistic callback invoked immediately after durable insertion
   */
  onOptimistic?: (item: MutationItem<TPayload, TMeta>) => void;
  /**
   * Callback invoked if the mutation permanently fails (max retries exceeded or non-retryable)
   */
  onRollback?: (item: MutationItem<TPayload, TMeta>, error: Error) => void;
  /**
   * Callback invoked when this specific mutation succeeds
   */
  onSuccess?: (item: MutationItem<TPayload, TMeta>, result: any) => void;
}

/**
 * Handler function signature for registered mutations
 */
export type MutationHandler<TPayload = any, TResult = any, TMeta = Record<string, any>> = (
  payload: TPayload,
  context: MutationContext<TMeta>
) => Promise<TResult>;

/**
 * Retry and Backoff Configuration
 */
export interface RetryPolicy {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
  jitter: boolean;
  shouldRetry?: (error: any, item: MutationItem) => boolean | Promise<boolean>;
}

/**
 * HTTP Mutation Payload for direct HTTP queueing (offlineFetch)
 */
export interface HttpMutationPayload {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: any;
  timeoutMs?: number;
}

/**
 * Options for direct HTTP queueing
 */
export interface EnqueueHttpOptions<TMeta = Record<string, any>> {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: any;
  timeoutMs?: number;
  scope?: string;
  meta?: TMeta;
  maxRetries?: number;
  idempotencyKey?: string;
  onOptimistic?: (item: MutationItem<HttpMutationPayload, TMeta>) => void;
  onRollback?: (item: MutationItem<HttpMutationPayload, TMeta>, error: Error) => void;
  onSuccess?: (item: MutationItem<HttpMutationPayload, TMeta>, result: any) => void;
}

/**
 * Queue Statistics
 */
export interface QueueStats {
  total: number;
  pending: number;
  syncing: number;
  failed: number;
  completed: number;
  scopes: string[];
}

/**
 * Storage Adapter Interface - Allows custom storage (Expo SQLite, MMKV, Memory, etc.)
 */
export interface StorageAdapter {
  init(): Promise<void>;
  enqueue<P = any, M = any>(item: MutationItem<P, M>): Promise<void>;
  getPending(scope?: string): Promise<MutationItem[]>;
  getById(id: string): Promise<MutationItem | null>;
  update(id: string, updates: Partial<MutationItem>): Promise<void>;
  remove(id: string): Promise<void>;
  clear(scope?: string): Promise<void>;
  getAll(filter?: { status?: MutationStatus; scope?: string }): Promise<MutationItem[]>;
  getStats(): Promise<QueueStats>;
}

/**
 * Network Monitor Interface - Observes online/offline connectivity
 */
export interface NetworkMonitor {
  isOnline: boolean;
  subscribe(listener: (isOnline: boolean) => void): () => void;
  check(): Promise<boolean>;
}

/**
 * Configuration Options for OfflineSyncClient
 */
export interface OfflineSyncOptions {
  /**
   * Custom storage adapter (default: Expo SQLite or InMemory)
   */
  storage?: StorageAdapter;
  /**
   * Custom network monitor (default: NetInfo / Mock)
   */
  networkMonitor?: NetworkMonitor;
  /**
   * Custom retry and backoff policy
   */
  retryPolicy?: Partial<RetryPolicy>;
  /**
   * Default scope for mutations when scope is omitted (default: 'default')
   */
  defaultScope?: string;
  /**
   * Maximum concurrent scopes processed in parallel (default: 3)
   */
  maxConcurrentScopes?: number;
  /**
   * Whether to automatically process queue when device comes online (default: true)
   */
  autoSync?: boolean;
  /**
   * Whether to trigger sync when the app returns from background to foreground (default: true)
   */
  syncOnAppResume?: boolean;
  /**
   * Dynamic header resolver called before executing HTTP requests.
   * Crucial for refreshing expired auth tokens (JWT Bearer tokens)!
   */
  getHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
  /**
   * Global lifecycle hooks
   */
  onRequest?: (item: MutationItem) => Promise<void> | void;
  onResponse?: (item: MutationItem, response: any) => Promise<void> | void;
  onRollback?: (item: MutationItem, error: Error) => Promise<void> | void;
}

/**
 * Client Event Map
 */
export interface OfflineSyncEventMap {
  enqueued: (item: MutationItem) => void;
  syncStart: (item: MutationItem) => void;
  syncSuccess: (item: MutationItem, result: any) => void;
  syncError: (item: MutationItem, error: Error) => void;
  syncComplete: () => void;
  statusChange: (stats: QueueStats, isOnline: boolean) => void;
  rollback: (item: MutationItem, error: Error) => void;
  onlineChange: (isOnline: boolean) => void;
}

