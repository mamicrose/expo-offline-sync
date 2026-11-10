import { HttpMutationPayload, MutationContext } from '../types';

export const HTTP_MUTATION_TYPE = '__EXPO_OFFLINE_SYNC_HTTP__';

export class HttpError extends Error {
  status: number;
  statusText: string;
  data: any;

  constructor(status: number, statusText: string, data: any) {
    super(`HTTP Request failed with status ${status}: ${statusText}`);
    this.name = 'HttpError';
    this.status = status;
    this.statusText = statusText;
    this.data = data;
  }
}

export interface HttpExecutorOptions {
  getHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
}

/**
 * Built-in executor for direct HTTP requests
 */
export class HttpExecutor {
  private getHeaders?: () => Record<string, string> | Promise<Record<string, string>>;

  constructor(options: HttpExecutorOptions = {}) {
    this.getHeaders = options.getHeaders;
  }

  async execute(payload: HttpMutationPayload, context: MutationContext): Promise<any> {
    const { url, method = 'POST', headers = {}, body, timeoutMs = 30000 } = payload;

    // 1. Resolve dynamic headers (e.g. fresh auth token)
    let dynamicHeaders: Record<string, string> = {};
    if (this.getHeaders) {
      try {
        dynamicHeaders = await this.getHeaders();
      } catch (err) {
        console.warn('[expo-offline-sync] Failed to resolve dynamic headers:', err);
      }
    }

    const mergedHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Idempotency-Key': context.idempotencyKey,
      ...dynamicHeaders,
      ...headers,
    };

    // 2. Setup timeout controller
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // Link context signal if aborted externally
    if (context.signal) {
      context.signal.addEventListener('abort', () => controller.abort());
    }

    try {
      const fetchOptions: RequestInit = {
        method,
        headers: mergedHeaders,
        signal: controller.signal,
      };

      if (body !== undefined && method !== 'GET') {
        fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
      }

      const response = await fetch(url, fetchOptions);

      if (!response.ok) {
        let responseData: any;
        const contentType = response.headers.get('content-type') || '';
        try {
          if (contentType.includes('application/json')) {
            responseData = await response.json();
          } else {
            responseData = await response.text();
          }
        } catch {
          responseData = null;
        }

        throw new HttpError(response.status, response.statusText, responseData);
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return await response.json();
      }
      return await response.text();
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

