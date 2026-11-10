// Core
export { OfflineSyncClient } from './core/OfflineSyncClient';
export { QueueManager, generateUUID } from './core/QueueManager';
export { Registry } from './core/Registry';
export { Scheduler, DEFAULT_RETRY_POLICY } from './core/Scheduler';
export { HttpExecutor, HttpError, HTTP_MUTATION_TYPE } from './core/HttpExecutor';
export { TypedEventEmitter } from './core/EventEmitter';

// Storage
export { StorageAdapter } from './storage/StorageAdapter';
export { MemoryAdapter } from './storage/MemoryAdapter';
export { SQLiteAdapter, SQLiteAdapterOptions } from './storage/SQLiteAdapter';

// Network
export { ManualNetworkMonitor } from './network/NetworkMonitor';
export { NetInfoNetworkMonitor } from './network/NetInfoNetworkMonitor';

// React Layer
export { OfflineSyncProvider, useOfflineSync, OfflineSyncProviderProps } from './react/OfflineSyncProvider';
export { useOfflineMutation, UseOfflineMutationOptions, UseOfflineMutationResult } from './react/useOfflineMutation';
export { useQueueStatus, UseQueueStatusResult } from './react/useQueueStatus';
export { useIsOnline } from './react/useIsOnline';

// Background Plugin
export {
  registerBackgroundSync,
  unregisterBackgroundSync,
  BackgroundSyncOptions,
  DEFAULT_BACKGROUND_TASK_NAME,
} from './plugins/backgroundSync';

// Types
export * from './types';

