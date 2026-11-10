import { MutationItem, MutationStatus, QueueStats, StorageAdapter } from '../types';

/**
 * In-memory storage adapter for testing, mocking, and environments without SQLite
 */
export class MemoryAdapter implements StorageAdapter {
  private items: Map<string, MutationItem> = new Map();

  async init(): Promise<void> {
    // No-op for in-memory
  }

  async enqueue<P = any, M = any>(item: MutationItem<P, M>): Promise<void> {
    // Clone item to avoid mutation by reference
    this.items.set(item.id, JSON.parse(JSON.stringify(item)));
  }

  async getPending(scope?: string): Promise<MutationItem[]> {
    const list = Array.from(this.items.values()).filter((item) => {
      const isPending = item.status === 'pending' || item.status === 'syncing';
      if (!isPending) return false;
      if (scope && item.scope !== scope) return false;
      return true;
    });

    // Sort by priority (higher first), then createdAt (older first / FIFO)
    return list.sort((a, b) => {
      const priorityDiff = (b.priority ?? 0) - (a.priority ?? 0);
      if (priorityDiff !== 0) return priorityDiff;
      return a.createdAt - b.createdAt;
    });
  }

  async getById(id: string): Promise<MutationItem | null> {
    const item = this.items.get(id);
    if (!item) return null;
    return JSON.parse(JSON.stringify(item));
  }

  async update(id: string, updates: Partial<MutationItem>): Promise<void> {
    const existing = this.items.get(id);
    if (!existing) return;

    const updated: MutationItem = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    };
    this.items.set(id, updated);
  }

  async remove(id: string): Promise<void> {
    this.items.delete(id);
  }

  async clear(scope?: string): Promise<void> {
    if (!scope) {
      this.items.clear();
      return;
    }

    for (const [id, item] of this.items.entries()) {
      if (item.scope === scope) {
        this.items.delete(id);
      }
    }
  }

  async getAll(filter?: { status?: MutationStatus; scope?: string }): Promise<MutationItem[]> {
    let list = Array.from(this.items.values());

    if (filter?.status) {
      list = list.filter((i) => i.status === filter.status);
    }
    if (filter?.scope) {
      list = list.filter((i) => i.scope === filter.scope);
    }

    return list.sort((a, b) => {
      const priorityDiff = (b.priority ?? 0) - (a.priority ?? 0);
      if (priorityDiff !== 0) return priorityDiff;
      return a.createdAt - b.createdAt;
    });
  }

  async getStats(): Promise<QueueStats> {
    const all = Array.from(this.items.values());
    const scopes = new Set<string>();

    let pending = 0;
    let syncing = 0;
    let failed = 0;
    let completed = 0;

    for (const item of all) {
      scopes.add(item.scope);
      if (item.status === 'pending') pending++;
      else if (item.status === 'syncing') syncing++;
      else if (item.status === 'failed') failed++;
      else if (item.status === 'completed') completed++;
    }

    return {
      total: all.length,
      pending,
      syncing,
      failed,
      completed,
      scopes: Array.from(scopes),
    };
  }
}

