import { BufferJSON, initAuthCreds, proto, type AuthenticationState, type AuthenticationCreds, type SignalDataSet } from '@whiskeysockets/baileys';
import { desktopSecretService } from '../secrets/DesktopSecretService.js';

type Vault = Pick<typeof desktopSecretService, 'get' | 'set' | 'delete'>;
const MAX_AUTH_BYTES = 4 * 1024 * 1024;
type StoredState = { version: 1; creds: AuthenticationCreds; keys: Record<string, Record<string, unknown>> };

/** One atomic, encrypted credential/key snapshot. Never stored in the project or application DB. */
export class WhatsAppSecureAuth {
  private tail = Promise.resolve();
  private disposed = false;
  private constructor(private readonly key: string, private stored: StoredState, private readonly vault: Vault) {}

  static async open(workspaceId: string, connectionId: string, vault: Vault = desktopSecretService) {
    const key = `automation:whatsapp:${workspaceId}:${connectionId}`;
    const previous = await vault.get(key);
    let stored: StoredState;
    if (previous) {
      if (Buffer.byteLength(previous) > MAX_AUTH_BYTES) throw new Error('WHATSAPP_AUTH_TOO_LARGE');
      stored = JSON.parse(previous, BufferJSON.reviver);
      if (stored?.version !== 1 || !stored.creds?.noiseKey || !stored.keys || typeof stored.keys !== 'object') throw new Error('WHATSAPP_AUTH_INVALID');
    } else stored = { version: 1, creds: initAuthCreds(), keys: Object.create(null) };
    const auth = new WhatsAppSecureAuth(key, stored, vault);
    if (!previous) {
      await auth.persist(stored);
      // The development server has no secure-storage IPC. It must fail closed,
      // rather than display a QR whose keys cannot survive the next restart.
      if (!(await vault.get(key))) throw new Error('WHATSAPP_SECURE_STORAGE_REQUIRED');
    }
    return auth;
  }

  private persist(value: StoredState) {
    const json = JSON.stringify(value, BufferJSON.replacer);
    if (Buffer.byteLength(json) > MAX_AUTH_BYTES) throw new Error('WHATSAPP_AUTH_TOO_LARGE');
    return this.vault.set(this.key, json);
  }
  private exclusive(operation: () => Promise<void>) {
    const run = this.tail.then(() => { if (this.disposed) throw new Error('WHATSAPP_AUTH_CLOSED'); return operation(); });
    this.tail = run.catch(() => undefined);
    return run;
  }
  get state(): AuthenticationState {
    return this.forSession(() => true);
  }
  forSession(isCurrent: () => boolean): AuthenticationState {
    return { creds: JSON.parse(JSON.stringify(this.stored.creds, BufferJSON.replacer), BufferJSON.reviver), keys: {
      get: async (type, ids) => {
        await this.tail;
        if (this.disposed) throw new Error('WHATSAPP_AUTH_CLOSED');
        if (!isCurrent()) throw new Error('WHATSAPP_AUTH_STALE');
        const result: Record<string, never> = {};
        for (const id of ids) {
          if (!Object.hasOwn(this.stored.keys, type) || !Object.hasOwn(this.stored.keys[type], id)) continue;
          const value = JSON.parse(JSON.stringify(this.stored.keys[type][id], BufferJSON.replacer), BufferJSON.reviver);
          result[id] = (type === 'app-state-sync-key' && value ? proto.Message.AppStateSyncKeyData.fromObject(value as object) : value) as never;
        }
        return result;
      },
      set: data => this.saveKeys(data, isCurrent),
    } };
  }
  saveCreds = (creds?: AuthenticationCreds, isCurrent: () => boolean = () => true) => {
    const snapshot = creds ? JSON.parse(JSON.stringify(creds, BufferJSON.replacer), BufferJSON.reviver) : null;
    return this.exclusive(async () => {
      if (!isCurrent()) throw new Error('WHATSAPP_AUTH_STALE');
      const next = { ...this.stored, ...(snapshot ? { creds: snapshot } : {}) };
      await this.persist(next); this.stored.creds = next.creds;
    });
  };
  private saveKeys(data: SignalDataSet, isCurrent: () => boolean) {
    return this.exclusive(async () => {
      if (!isCurrent()) throw new Error('WHATSAPP_AUTH_STALE');
      const keys = { ...this.stored.keys };
      for (const [category, changes] of Object.entries(data)) {
        const bucket = { ...(Object.hasOwn(keys, category) ? keys[category] : {}) };
        for (const [id, value] of Object.entries(changes ?? {})) {
          if (['__proto__', 'constructor', 'prototype'].includes(id) || ['__proto__', 'constructor', 'prototype'].includes(category)) throw new Error('WHATSAPP_AUTH_KEY_INVALID');
          if (value == null) delete bucket[id]; else bucket[id] = value;
        }
        keys[category] = bucket;
      }
      const next = { ...this.stored, keys };
      await this.persist(next);
      this.stored.keys = keys;
    });
  }
  async close() { await this.tail; this.disposed = true; }
  async forget() { await this.close(); await this.vault.delete(this.key); }
}
