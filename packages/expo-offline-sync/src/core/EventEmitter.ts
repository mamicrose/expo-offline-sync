type Listener<T extends any[] = any[]> = (...args: T) => void;

/**
 * Lightweight, zero-dependency, typed EventEmitter compatible with React Native & Hermes
 */
export class TypedEventEmitter<Events extends Record<string, any>> {
  private listeners: Map<keyof Events, Set<Listener>> = new Map();

  on<K extends keyof Events>(event: K, listener: Events[K]): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const set = this.listeners.get(event)!;
    set.add(listener as Listener);

    return () => {
      this.off(event, listener);
    };
  }

  off<K extends keyof Events>(event: K, listener: Events[K]): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(listener as Listener);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  emit<K extends keyof Events>(event: K, ...args: Parameters<Events[K]>): void {
    const set = this.listeners.get(event);
    if (!set) return;

    for (const listener of Array.from(set)) {
      try {
        listener(...args);
      } catch (err) {
        console.error(`[expo-offline-sync] Error in event listener for "${String(event)}":`, err);
      }
    }
  }

  removeAllListeners(event?: keyof Events): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  listenerCount(event: keyof Events): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

