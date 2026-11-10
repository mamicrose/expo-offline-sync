import { OfflineSyncClient } from '../core/OfflineSyncClient';

export const DEFAULT_BACKGROUND_TASK_NAME = 'EXPO_OFFLINE_SYNC_BACKGROUND_TASK';

export interface BackgroundSyncOptions {
  taskName?: string;
  minimumInterval?: number; // In seconds (default: 15 minutes = 900 seconds)
  stopOnTerminate?: boolean;
  startOnBoot?: boolean;
}

/**
 * Registers background synchronization using expo-background-fetch and expo-task-manager
 * Automatically replays pending offline mutations even when the app is in the background or killed
 */
export async function registerBackgroundSync(
  client: OfflineSyncClient,
  options: BackgroundSyncOptions = {}
): Promise<void> {
  const taskName = options.taskName ?? DEFAULT_BACKGROUND_TASK_NAME;
  const minimumInterval = options.minimumInterval ?? 15 * 60; // 15 mins
  const stopOnTerminate = options.stopOnTerminate ?? false;
  const startOnBoot = options.startOnBoot ?? true;

  let TaskManager: any;
  let BackgroundFetch: any;

  try {
    TaskManager = await import('expo-task-manager');
    BackgroundFetch = await import('expo-background-fetch');
  } catch {
    throw new Error(
      '[expo-offline-sync] Background sync requires "expo-task-manager" and "expo-background-fetch". Please run: npx expo install expo-task-manager expo-background-fetch'
    );
  }

  // 1. Define the background task if not already defined
  if (!TaskManager.isTaskDefined(taskName)) {
    TaskManager.defineTask(taskName, async () => {
      try {
        const stats = await client.getStats();
        if (stats.pending > 0 || stats.syncing > 0) {
          await client.sync();
          return BackgroundFetch.BackgroundFetchResult.NewData;
        }
        return BackgroundFetch.BackgroundFetchResult.NoData;
      } catch (err) {
        console.error('[expo-offline-sync] Background sync error:', err);
        return BackgroundFetch.BackgroundFetchResult.Failed;
      }
    });
  }

  // 2. Register with BackgroundFetch
  await BackgroundFetch.registerTaskAsync(taskName, {
    minimumInterval,
    stopOnTerminate,
    startOnBoot,
  });
}

/**
 * Unregisters the background sync task
 */
export async function unregisterBackgroundSync(taskName = DEFAULT_BACKGROUND_TASK_NAME): Promise<void> {
  try {
    const BackgroundFetch = await import('expo-background-fetch');
    const TaskManager = await import('expo-task-manager');
    const isRegistered = await TaskManager.isTaskRegisteredAsync(taskName);
    if (isRegistered) {
      await BackgroundFetch.unregisterTaskAsync(taskName);
    }
  } catch (err) {
    console.warn('[expo-offline-sync] Failed to unregister background task:', err);
  }
}
