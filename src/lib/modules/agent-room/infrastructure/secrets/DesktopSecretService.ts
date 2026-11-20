import { randomUUID } from 'node:crypto';

type SecretResponse = {
  type: 'orkestrai:secret:result';
  requestId: string;
  value?: string | null;
  error?: string;
};

export type SecretRequestOptions = { allowInteractiveUnlock?: boolean };

type PendingSecret = {
  resolve: (value: string | null) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const state = globalThis as typeof globalThis & {
  __orkestraiSecretPending?: Map<string, PendingSecret>;
  __orkestraiSecretListenerReady?: boolean;
};

const pending = state.__orkestraiSecretPending ??= new Map<string, PendingSecret>();

if (!state.__orkestraiSecretListenerReady && typeof process.on === 'function') {
  process.on('message', (message: unknown) => {
    const response = message as Partial<SecretResponse> | null;
    if (response?.type !== 'orkestrai:secret:result' || !response.requestId) return;
    const request = pending.get(response.requestId);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(response.requestId);
    if (response.error) request.reject(new Error(response.error));
    else request.resolve(response.value ?? null);
  });
  state.__orkestraiSecretListenerReady = true;
}

export class DesktopSecretService {
  private async request(type: 'orkestrai:secret:get' | 'orkestrai:secret:set' | 'orkestrai:secret:delete', key: string, value?: string, options?: SecretRequestOptions): Promise<string | null> {
    if (!/^automation:[a-z0-9:_-]{1,240}$/i.test(key)) throw new Error('Invalid automation secret key.');
    if (typeof process.send !== 'function') {
      if (type !== 'orkestrai:secret:get') return null;
      if (key.includes(':github:')) return process.env.ORKESTRAI_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? null;
      if (key.includes(':figma:')) return process.env.ORKESTRAI_FIGMA_TOKEN ?? process.env.FIGMA_ACCESS_TOKEN ?? null;
      return null;
    }
    const requestId = randomUUID();
    return new Promise<string | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(options?.allowInteractiveUnlock ? 'SECURE_STORAGE_UNLOCK_TIMEOUT' : 'Secure credential request timed out.'));
      }, options?.allowInteractiveUnlock ? 120_000 : 5_000);
      timer.unref?.();
      pending.set(requestId, { resolve, reject, timer });
      process.send?.({ type, requestId, key, ...(value === undefined ? {} : { value }) });
    });
  }

  get(key: string, options?: SecretRequestOptions): Promise<string | null> { return this.request('orkestrai:secret:get', key, undefined, options); }
  async set(key: string, value: string, options?: SecretRequestOptions): Promise<void> { await this.request('orkestrai:secret:set', key, value, options); }
  async delete(key: string): Promise<void> { await this.request('orkestrai:secret:delete', key); }
}

export const desktopSecretService = new DesktopSecretService();
