import Database from 'better-sqlite3';
import { deflateRaw, inflateRaw } from 'node:zlib';
import { promisify } from 'node:util';
import { createSqliteStore, type WaSqliteConnection } from '@zapo-js/store-sqlite';
import { createStore, type WaStore } from 'zapo-js';
import { desktopSecretService, type SecretRequestOptions } from '../secrets/DesktopSecretService.js';

const compress = promisify(deflateRaw), decompress = promisify(inflateRaw);
const MAX_DATABASE_BYTES = 16 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
type Vault = Pick<typeof desktopSecretService, 'get' | 'set' | 'delete'>;

/**
 * Zapo's official SQLite providers run in RAM. Only a bounded compressed image
 * crosses the private secret IPC, where Electron encrypts it at rest. No keys,
 * messages, plaintext SQLite file, WAL or SHM are written to a project or disk.
 * Every store operation waits for its writes to become durable before returning.
 */
export class ZapoSecureStore {
  readonly engine = 'zapo' as const;
  readonly store: WaStore;
  private generation = 1;
  private durable = 0;
  private tail: Promise<void> = Promise.resolve();
  private closed = false;
  private closing = false;
  private closingPromise: Promise<void> | null = null;
  private operations = new Set<Promise<unknown>>();
  private failure: unknown = null;
  private constructor(private readonly key: string, private readonly db: Database.Database, private readonly vault: Vault,
    private readonly initialOptions?: SecretRequestOptions) {
    const check = () => { if (this.closed || this.failure) throw new Error('WHATSAPP_AUTH_CLOSED'); };
    const connection: WaSqliteConnection = {
      driver: 'better-sqlite3',
      exec: sql => { check(); db.exec(sql); this.generation++; },
      run: (sql, params = []) => { check(); db.prepare(sql).run(...params); this.generation++; },
      get: <T extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []) => { check(); return (db.prepare(sql).get(...params) ?? null) as T | null; },
      all: <T extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []) => { check(); return db.prepare(sql).all(...params) as T[]; },
      runInTransaction: async task => { check(); return db.transaction(task)(); },
      close: () => {}, // The scoped owner closes the database after the client drains.
    };
    const backend = createSqliteStore({ connection });
    const stores = Object.fromEntries(Object.entries(backend.stores).map(([name, factory]) => [name, (id: string) => {
      const target = factory(id);
      return new Proxy(target, { get: (object, property) => {
        const member = Reflect.get(object, property, object);
        if (typeof member !== 'function') return member;
        return (...args: unknown[]) => {
          if (this.closing && property !== 'destroy') return Promise.reject(new Error('WHATSAPP_AUTH_CLOSED'));
          const operation = (async () => {
            try { check(); const result = await member.apply(object, args); await this.flush(); return result; }
            catch (error) { this.failure = error; throw error; }
          })();
          this.operations.add(operation);
          void operation.finally(() => this.operations.delete(operation)).catch(() => undefined);
          return operation;
        };
      } });
    }])) as typeof backend.stores;
    this.store = createStore({ backends: { vault: { stores, caches: {} } }, providers: {
      auth: 'vault', signal: 'vault', preKey: 'vault', session: 'vault', identity: 'vault', senderKey: 'vault',
      appState: 'vault', privacyToken: 'vault', messages: 'none', threads: 'none', contacts: 'memory',
    }, memory: { limits: { contacts: 1_000, groupMetadataGroups: 1_000, deviceListUsers: 1_000, retryOutboundMessages: 64, retryInboundCounters: 128 } } });
  }
  static key(workspaceId: string, connectionId: string) { return `automation:whatsapp:zapo:${workspaceId}:${connectionId}`; }
  static async exists(workspaceId: string, connectionId: string, vault: Vault = desktopSecretService, options?: SecretRequestOptions) {
    return Boolean(await vault.get(this.key(workspaceId, connectionId), options));
  }
  static async open(workspaceId: string, connectionId: string, vault: Vault = desktopSecretService, options?: SecretRequestOptions) {
    const key = this.key(workspaceId, connectionId), previous = await vault.get(key, options);
    let db: Database.Database;
    if (previous) {
      if (Buffer.byteLength(previous) > MAX_SNAPSHOT_BYTES) throw new Error('WHATSAPP_AUTH_TOO_LARGE');
      const saved = JSON.parse(previous);
      if (saved?.version !== 1 || typeof saved.database !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(saved.database)) throw new Error('WHATSAPP_AUTH_INVALID');
      const bytes = await decompress(Buffer.from(saved.database, 'base64'), { maxOutputLength: MAX_DATABASE_BYTES });
      if (bytes.subarray(0, 16).toString('ascii') !== 'SQLite format 3\0') throw new Error('WHATSAPP_AUTH_INVALID');
      db = new Database(bytes);
      try {
        if (db.pragma('quick_check', { simple: true }) !== 'ok' ||
          db.prepare('SELECT version FROM orkestrai_zapo_format').pluck().get() !== 1) throw new Error('WHATSAPP_AUTH_INVALID');
      } catch { db.close(); throw new Error('WHATSAPP_AUTH_INVALID'); }
    } else {
      db = new Database(':memory:');
      db.exec('CREATE TABLE orkestrai_zapo_format (version INTEGER NOT NULL); INSERT INTO orkestrai_zapo_format VALUES (1)');
    }
    db.pragma(`max_page_count = ${Math.floor(MAX_DATABASE_BYTES / Number(db.pragma('page_size', { simple: true })))}`);
    db.pragma('temp_store = MEMORY'); db.pragma('journal_mode = MEMORY'); db.pragma('foreign_keys = ON');
    const auth = new ZapoSecureStore(key, db, vault, options);
    try {
      await auth.flush();
      if (!previous && !(await vault.get(key, options))) throw new Error('WHATSAPP_SECURE_STORAGE_REQUIRED');
      return auth;
    } catch (error) { db.close(); throw error; }
  }
  /** Coalesces concurrent writers, preserving each caller's durability boundary. */
  flush(): Promise<void> {
    const target = this.generation;
    if (this.durable >= target) return Promise.resolve();
    const run = this.tail.then(async () => {
      if (this.failure) throw this.failure;
      if (this.durable >= target) return;
      const generation = this.generation;
      const image = this.db.serialize();
      if (image.byteLength > MAX_DATABASE_BYTES) throw new Error('WHATSAPP_AUTH_TOO_LARGE');
      const compressed = await compress(image, { level: 1 });
      const value = JSON.stringify({ version: 1, database: compressed.toString('base64') });
      if (Buffer.byteLength(value) > MAX_SNAPSHOT_BYTES) throw new Error('WHATSAPP_AUTH_TOO_LARGE');
      await this.vault.set(this.key, value, this.durable ? undefined : this.initialOptions);
      this.durable = generation;
    });
    this.tail = run.catch(error => { this.failure = error; });
    return run;
  }
  get failed() { return Boolean(this.failure); }
  close(): Promise<void> {
    if (this.closingPromise) return this.closingPromise;
    this.closing = true;
    this.closingPromise = (async () => {
      await Promise.allSettled([...this.operations]);
      try { await this.store.destroy(); await this.flush(); await this.tail; }
      finally { this.closed = true; this.db.close(); }
    })();
    return this.closingPromise;
  }
  async forget() {
    // Closing always drains writers and closes RAM, even after a failed save.
    // Explicit removal still succeeds when deletion from the vault succeeds.
    await this.close().catch(() => undefined);
    await this.vault.delete(this.key);
  }
}
