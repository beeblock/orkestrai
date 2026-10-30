import { Connection } from '@beeblock/svelar/database';
import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';

/** Derived graph data and its user annotations must never monopolize the conversation database. */
export const CODE_GRAPH_CONNECTION = 'orkestrai-code-graph';
export const CODE_GRAPH_READER_CONNECTION = 'orkestrai-code-graph-reader';
const INSTALLED = Symbol.for('orkestrai.code-graph-storage');
const ROUTED = Symbol.for('orkestrai.code-graph-query-routing');
const scopeState = globalThis as typeof globalThis & { __orkestraiGraphAccessScope?: AsyncLocalStorage<'writer' | 'reader'> };
const accessScope = scopeState.__orkestraiGraphAccessScope ??= new AsyncLocalStorage<'writer' | 'reader'>();
const reservationState = globalThis as typeof globalThis & { __orkestraiGraphReservationScope?: AsyncLocalStorage<boolean> };
const reservationScope = reservationState.__orkestraiGraphReservationScope ??= new AsyncLocalStorage<boolean>();
type Raw = typeof Connection.raw;
type Transaction = typeof Connection.transaction;
type Result = { id: number; ready?: boolean; result?: unknown; error?: { message: string; code?: string } };

export function codeGraphConnectionName(): string | undefined {
  try {
    if (Connection.getDriver() !== 'sqlite') return undefined;
    const source = Connection.getConfig().filename;
    if (!source || source === ':memory:' || source.startsWith('file::memory:')) return undefined;
    if (Connection.getDriver(CODE_GRAPH_CONNECTION) === 'sqlite') return CODE_GRAPH_CONNECTION;
  } catch { /* In-memory ORM tests and non-desktop drivers retain their existing connection. */ }
  return undefined;
}

class GraphDatabaseWorker {
  private worker: Worker | null = null;
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private closed = false;
  private initialized: Promise<void> | null = null;

  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(readonly source: string, readonly filename: string, readonly role: 'writer' | 'reader' | 'analysis' = 'writer') {}

  private armIdle(worker: Worker): void {
    if (this.pending.size) return;
    worker.unref();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.pending.size || this.worker !== worker) return;
      this.worker = null;
      void worker.terminate();
    }, this.role === 'analysis' ? 30_000 : 5 * 60_000);
    this.idleTimer.unref();
  }

  private start(): Worker {
    if (this.closed) throw new Error('Code graph storage is closed.');
    if (this.worker) return this.worker;
    const worker = new Worker(resolve(process.cwd(), 'electron/code-graph-storage-worker.cjs'), {
      workerData: { source: this.source, filename: this.filename, readonly: this.role !== 'writer' },
      resourceLimits: { maxOldGenerationSizeMb: this.role === 'reader' ? 128 : 1_024 },
    });
    this.worker = worker;
    let ready!: () => void;
    let rejectReady!: (error: Error) => void;
    this.initialized = new Promise<void>((resolveReady, reject) => { ready = resolveReady; rejectReady = reject; });
    void this.initialized.catch(() => undefined);
    const bootTimer = setTimeout(() => {
      rejectReady(new Error('Code graph storage preparation timed out.'));
      void worker.terminate();
    }, 10 * 60_000);
    worker.on('message', (message: Result) => {
      if (message.ready) { clearTimeout(bootTimer); this.armIdle(worker); ready(); return; }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
      else pending.resolve(message.result);
      this.armIdle(worker);
    });
    const failed = (error: Error) => {
      clearTimeout(bootTimer);
      rejectReady(error);
      if (this.worker !== worker) return;
      this.worker = null;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      this.pending.clear();
    };
    worker.on('error', failed);
    worker.on('exit', (code) => failed(new Error(`Code graph storage worker exited (${code}).`)));
    worker.unref();
    return worker;
  }

  async ready(): Promise<void> {
    this.start();
    await this.initialized;
  }

  async request(operation: string, sql?: string, bindings: unknown[] = []): Promise<any> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    await this.ready();
    const worker = this.start();
    worker.ref();
    const id = ++this.sequence;
    return new Promise((resolveResult, reject) => {
      // A timed-out write is never replayed: terminating the worker rolls back any open transaction.
      const timer = setTimeout(() => {
        const error = new Error('Code graph storage timed out. Conversations remain available.');
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(error);
        }
        this.pending.clear();
        if (this.worker === worker) this.worker = null;
        void worker.terminate();
      }, this.role === 'reader' ? 2_000 : this.role === 'analysis' ? (operation === 'compare' ? 120_000 : 30_000) : 10 * 60_000);
      this.pending.set(id, { resolve: resolveResult, reject, timer });
      worker.postMessage({ id, operation, sql, bindings: bindings.map(value => value instanceof Date ? value.toISOString() : typeof value === 'boolean' ? Number(value) : value) });
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const worker = this.worker;
    if (!worker) return;
    // Never let a disconnected test or stopped Core leave database work alive.
    await worker.terminate();
  }
}

const state = globalThis as typeof globalThis & { __orkestraiGraphDatabaseWorkers?: Map<string, GraphDatabaseWorker> };

function graphWorker(role: 'writer' | 'reader' | 'analysis' = 'writer'): GraphDatabaseWorker {
  const source = resolve(Connection.getConfig().filename!);
  const filename = resolve(Connection.getConfig(CODE_GRAPH_CONNECTION).filename!);
  if (filename === source) throw new Error('Code graph storage must use a different database file.');
  const workers = state.__orkestraiGraphDatabaseWorkers ??= new Map();
  const key = `${source}\0${filename}\0${role}`;
  let worker = workers.get(key);
  if (!worker) workers.set(key, worker = new GraphDatabaseWorker(source, filename, role));
  return worker;
}

/** Install before the SQLite transaction gates; the ORM still owns validation, queries and transactions. */
export function installCodeGraphStorage(): void {
  const connection = Connection as typeof Connection & { [INSTALLED]?: boolean };
  if (connection[INSTALLED]) return;
  connection[INSTALLED] = true;
  const raw = connection.raw.bind(connection) as Raw;
  const transaction = connection.transaction.bind(connection) as Transaction;
  connection.raw = async (sql, bindings = [], name) => {
    if (name === CODE_GRAPH_CONNECTION) return graphWorker().request('query', sql, bindings);
    if (name === CODE_GRAPH_READER_CONNECTION) {
      await graphWorker().ready();
      return graphWorker('reader').request('query', sql, bindings);
    }
    return raw(sql, bindings, name);
  };
  connection.transaction = async (callback, name) => {
    if (name !== CODE_GRAPH_CONNECTION && name !== CODE_GRAPH_READER_CONNECTION) return transaction(callback, name);
    if (name === CODE_GRAPH_CONNECTION && reservationScope.getStore()) return reservationScope.run(false, callback);
    if (name === CODE_GRAPH_READER_CONNECTION) await graphWorker().ready();
    const worker = graphWorker(name === CODE_GRAPH_READER_CONNECTION ? 'reader' : 'writer');
    await worker.request('begin');
    try {
      const result = await callback();
      await worker.request('commit');
      return result;
    } catch (error) {
      await worker.request('rollback').catch(() => undefined);
      throw error;
    }
  };
}

/** Install AFTER transaction isolation, so read snapshots never queue behind a graph writer. */
export function routeCodeGraphQueries(): void {
  const connection = Connection as typeof Connection & { [ROUTED]?: boolean };
  if (connection[ROUTED]) return;
  connection[ROUTED] = true;
  const raw = connection.raw.bind(connection) as Raw;
  const transaction = connection.transaction.bind(connection) as Transaction;
  connection.raw = async (sql, bindings = [], name) => {
    if (name !== CODE_GRAPH_CONNECTION || accessScope.getStore() === 'writer' || !/^\s*(SELECT|WITH|EXPLAIN|PRAGMA)\b/i.test(sql)) {
      return raw(sql, bindings, name);
    }
    try {
      return await raw(sql, bindings, CODE_GRAPH_READER_CONNECTION);
    } catch (error) {
      // The read worker rejects writes before execution; no uncertain statement is replayed.
      if ((error as { code?: string }).code !== 'GRAPH_WRITE_ON_READER') throw error;
      return raw(sql, bindings, name);
    }
  };
  connection.transaction = async (callback, name) => name === CODE_GRAPH_CONNECTION
    ? transaction(() => accessScope.run('writer', callback), name)
    : transaction(callback, name);
}

/** Expensive background analysis shares the background worker, never the interactive reader. */
export function withCodeGraphBackground<T>(callback: () => T): T { return accessScope.run('writer', callback); }

export function buildGraphInWorker(project: import('$lib/modules/agent-room/domain/code-graph.js').CodeGraphProject, force: boolean): Promise<import('$lib/modules/agent-room/domain/code-graph.js').CodeGraphProject> {
  // Reserve the writer's queue without opening a transaction across filesystem scans.
  // The indexing engine opens only its short publication transaction itself.
  return reservationScope.run(true, () => Connection.transaction(
    () => graphWorker().request('index', undefined, [project, force]), CODE_GRAPH_CONNECTION,
  ));
}

export async function runCodeGraphOperation<T = any>(operation: 'semantic-build' | 'semantic-search' | 'semantic-status' | 'compare' | 'analysis-graph', bindings: unknown[], analysis = false): Promise<T> {
  if (analysis) {
    await graphWorker().ready();
    return graphWorker('analysis').request(operation, undefined, bindings);
  }
  return reservationScope.run(true, () => Connection.transaction(
    () => graphWorker().request(operation, undefined, bindings), CODE_GRAPH_CONNECTION,
  ));
}

/** Primary deletion commits first; derived rows and annotations retire in bounded background batches. */
export function scheduleCodeGraphCleanup(): void {
  if (!codeGraphConnectionName()) return;
  void Connection.transaction(() => graphWorker().request('cleanup'), CODE_GRAPH_CONNECTION).catch(error => {
    console.warn(`[code-graph] Cleanup deferred: ${error instanceof Error ? error.message.slice(0, 160) : 'Unknown error'}`);
  });
}

export async function stopCodeGraphStorage(): Promise<void> {
  const workers = state.__orkestraiGraphDatabaseWorkers;
  if (!workers) return;
  state.__orkestraiGraphDatabaseWorkers = new Map();
  await Promise.all([...workers.values()].map(worker => worker.close()));
}

/** Repository SQL uses the same named Svelar connection as graph models. */
export const CodeGraphConnection = {
  raw(sql: string, bindings: any[] = []): Promise<any> { return Connection.raw(sql, bindings, codeGraphConnectionName()); },
  transaction<T>(callback: () => Promise<T>): Promise<T> { return Connection.transaction(callback, codeGraphConnectionName()); },
  snapshot<T>(callback: () => Promise<T>): Promise<T> {
    if (!codeGraphConnectionName() || accessScope.getStore()) return callback();
    return Connection.transaction(() => accessScope.run('reader', callback), CODE_GRAPH_READER_CONNECTION);
  },
};
