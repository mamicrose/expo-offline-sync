import { NetworkMonitor } from '../types';

/**
 * Controllable manual network monitor for testing, mocks, or custom connectivity checks
 */
export class ManualNetworkMonitor implements NetworkMonitor {
  private _isOnline: boolean;
  private listeners: Set<(isOnline: boolean) => void> = new Set();

  constructor(initialOnline = true) {
    this._isOnline = initialOnline;
  }

  get isOnline(): boolean {
    return this._isOnline;
  }

  setOnline(status: boolean): void {
    if (this._isOnline !== status) {
      this._isOnline = status;
      for (const listener of this.listeners) {
        listener(status);
      }
    }
  }

  subscribe(listener: (isOnline: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async check(): Promise<boolean> {
    return this._isOnline;
  }
}

