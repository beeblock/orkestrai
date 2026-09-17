const state = globalThis as typeof globalThis & { __orkestraiCreativeProfileLocks?: Map<string, Promise<unknown>> };
const locks = state.__orkestraiCreativeProfileLocks ??= new Map();
export async function withCreativeProfileLock<T>(id: string, execute: () => Promise<T>): Promise<T> {
  const operation = (locks.get(id) ?? Promise.resolve()).catch(() => undefined).then(execute);
  locks.set(id, operation);
  try { return await operation; } finally { if (locks.get(id) === operation) locks.delete(id); }
}
