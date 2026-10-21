import { AsyncLocalStorage } from 'node:async_hooks';
import { Connection } from '@beeblock/svelar/database';

type Raw = (sql: string, bindings?: unknown[], connectionName?: string) => Promise<unknown>;
type Transaction = <T>(callback: () => Promise<T>, connectionName?: string) => Promise<T>;
type Gate = { owner: symbol; released: Promise<void> };

const INSTALLED = Symbol.for('orkestrai.sqlite-transaction-isolation');
// Like SQLite's busy timeout between connections: a statement that waited this
// long for another transaction fails as "database is locked" instead of
// waiting forever, so a transaction that ends up waiting on it rolls back.
export const SQLITE_BUSY_WAIT_MS = 60_000;

function busy(): Error {
  return Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
}

/**
 * Isolates SQLite transactions from everything else the process runs.
 *
 * SQLite runs every statement on the one shared connection, and Svelar holds
 * its BEGIN open across an async callback. A statement from any other request
 * in that window became part of the transaction: it was then rolled back with
 * it, even after its caller had been told it was saved. While a transaction is
 * open, statements from outside it now wait for it to end; statements already
 * on their way finish before it begins; transactions run one at a time, and a
 * transaction opened inside another joins it; a statement that waits longer
 * than SQLITE_BUSY_WAIT_MS fails. Every ORM statement goes through
 * `Connection.raw`, so this is the one place to enforce it. Other drivers keep
 * their own isolation. Idempotent; the connection is a process-wide singleton.
 */
export function isolateSqliteTransactions(): void {
  const connection = Connection as unknown as { raw: Raw; transaction: Transaction; [INSTALLED]?: boolean };
  if (connection[INSTALLED]) return;
  connection[INSTALLED] = true;
  const raw = connection.raw.bind(Connection) as Raw;
  const transaction = connection.transaction.bind(Connection) as Transaction;
  const scope = new AsyncLocalStorage<symbol>();
  let gate: Gate | null = null;
  // Outside statements past the gate that have not finished yet.
  let running = 0;
  let idle: (() => void) | null = null;

  const sqlite = (name?: string): boolean => {
    try {
      return Connection.getDriver(name) === 'sqlite';
    } catch {
      return false;
    }
  };
  const inside = (): boolean => gate !== null && scope.getStore() === gate.owner;
  const waitOnce = async (deadline: number): Promise<void> => {
    const remaining = deadline - Date.now();
    if (!gate || remaining <= 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([gate.released, new Promise<void>((resolve) => { timer = setTimeout(resolve, remaining); })]);
    clearTimeout(timer);
  };
  const waitForTurn = async (): Promise<void> => {
    const deadline = Date.now() + SQLITE_BUSY_WAIT_MS;
    while (gate && !inside()) {
      if (Date.now() >= deadline) throw busy();
      await waitOnce(deadline);
    }
  };

  connection.raw = async (sql, bindings, name) => {
    if (!sqlite(name)) return raw(sql, bindings, name);
    if (inside()) return raw(sql, bindings, name);
    // Re-checked after every wait (the turn can be taken again while one returns),
    // then acted on with no await in between.
    while (gate && !inside()) await waitForTurn();
    running += 1;
    try {
      return await raw(sql, bindings, name);
    } finally {
      running -= 1;
      if (running === 0 && idle) {
        const resume = idle;
        idle = null;
        resume();
      }
    }
  };

  connection.transaction = async <T>(callback: () => Promise<T>, name?: string): Promise<T> => {
    if (!sqlite(name)) return transaction(callback, name);
    if (inside()) return callback();
    while (gate && !inside()) await waitForTurn();
    const owner = Symbol('sqlite-transaction');
    let release!: () => void;
    gate = { owner, released: new Promise<void>((resolve) => { release = resolve; }) };
    try {
      // New outside statements now wait; the ones already running finish first.
      if (running > 0) await new Promise<void>((resolve) => { idle = resolve; });
      return await scope.run(owner, () => transaction(callback, name));
    } finally {
      gate = null;
      release();
    }
  };
}
