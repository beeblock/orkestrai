/** Shared across SSR module copies: Git reads must not spawn one process per asset. */
const key = Symbol.for('orkestrai.gitProcessQueue');
type State = { active: number; waiting: Array<() => void> };
const globals = globalThis as typeof globalThis & { [key]?: State };
const state = globals[key] ??= { active: 0, waiting: [] };

export async function withGitProcessSlot<T>(run: () => Promise<T>): Promise<T> {
  if (state.active >= 4) await new Promise<void>(resolve => state.waiting.push(resolve));
  else state.active++;
  try { return await run(); }
  finally {
    const next = state.waiting.shift();
    if (next) next(); // Transfer the occupied slot before another caller can acquire it.
    else state.active--;
  }
}
