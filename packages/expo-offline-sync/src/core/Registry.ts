import { MutationHandler } from '../types';

/**
 * Mutation Registry for registering and retrieving type-safe mutation handlers
 */
export class Registry {
  private handlers: Map<string, MutationHandler<any, any, any>> = new Map();

  /**
   * Register a mutation handler for a given mutation type
   * @param type Unique mutation identifier (e.g. 'SEND_MESSAGE', 'UPDATE_PROFILE')
   * @param handler Async function to execute the mutation
   */
  register<TPayload = any, TResult = any, TMeta = Record<string, any>>(
    type: string,
    handler: MutationHandler<TPayload, TResult, TMeta>
  ): void {
    if (this.handlers.has(type)) {
      console.warn(
        `[expo-offline-sync] Handler for mutation type "${type}" was already registered and has been overwritten.`
      );
    }
    this.handlers.set(type, handler);
  }

  /**
   * Get a registered handler by type
   */
  get<TPayload = any, TResult = any, TMeta = Record<string, any>>(
    type: string
  ): MutationHandler<TPayload, TResult, TMeta> | undefined {
    return this.handlers.get(type);
  }

  /**
   * Check if a handler is registered
   */
  has(type: string): boolean {
    return this.handlers.has(type);
  }

  /**
   * Unregister a mutation handler
   */
  unregister(type: string): boolean {
    return this.handlers.delete(type);
  }

  /**
   * Clear all registered handlers
   */
  clear(): void {
    this.handlers.clear();
  }
}

