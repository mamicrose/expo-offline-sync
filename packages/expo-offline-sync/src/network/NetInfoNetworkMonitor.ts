import { NetworkMonitor } from '../types';

export class NetInfoNetworkMonitor implements NetworkMonitor {
  private _isOnline = true;
  private listeners: Set<(isOnline: boolean) => void> = new Set();
  private unsubscribeNetInfo: (() => void) | null = null;
  private unsubscribeAppState: (() => void) | null = null;

  constructor() {
    this.init();
  }

  get isOnline(): boolean {
    return this._isOnline;
  }

  private async init() {
    // 1. Try to initialize @react-native-community/netinfo
    let NetInfo: any = null;
    try {
      NetInfo = (await import('@react-native-community/netinfo')).default;
    } catch {
      // NetInfo not available (e.g. running in web or test environment)
    }

    if (NetInfo && typeof NetInfo.addEventListener === 'function') {
      const state = await NetInfo.fetch();
      this.updateStatus(Boolean(state.isConnected && state.isInternetReachable !== false));

      this.unsubscribeNetInfo = NetInfo.addEventListener((state: any) => {
        this.updateStatus(Boolean(state.isConnected && state.isInternetReachable !== false));
      });
    } else if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      // Web fallback
      this.updateStatus(navigator.onLine);
      const onOnline = () => this.updateStatus(true);
      const onOffline = () => this.updateStatus(false);
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
      this.unsubscribeNetInfo = () => {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
      };
    }

    // 2. Listen to React Native AppState for foreground resume sync
    try {
      const { AppState } = await import('react-native');
      if (AppState && typeof AppState.addEventListener === 'function') {
        const subscription = AppState.addEventListener('change', async (nextState: string) => {
          if (nextState === 'active') {
            await this.check();
          }
        });
        this.unsubscribeAppState = () => subscription?.remove?.();
      }
    } catch {
      // Running outside React Native
    }
  }

  private updateStatus(newStatus: boolean) {
    if (this._isOnline !== newStatus) {
      this._isOnline = newStatus;
      for (const listener of this.listeners) {
        listener(newStatus);
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
    try {
      const NetInfo = (await import('@react-native-community/netinfo')).default;
      if (NetInfo && typeof NetInfo.fetch === 'function') {
        const state = await NetInfo.fetch();
        const online = Boolean(state.isConnected && state.isInternetReachable !== false);
        this.updateStatus(online);
        return online;
      }
    } catch {
      // Fallback
    }

    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      this.updateStatus(navigator.onLine);
      return navigator.onLine;
    }

    return this._isOnline;
  }

  destroy(): void {
    if (this.unsubscribeNetInfo) {
      this.unsubscribeNetInfo();
      this.unsubscribeNetInfo = null;
    }
    if (this.unsubscribeAppState) {
      this.unsubscribeAppState();
      this.unsubscribeAppState = null;
    }
    this.listeners.clear();
  }
}

