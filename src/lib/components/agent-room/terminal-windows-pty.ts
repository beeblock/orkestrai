/** Never infer the PTY host from the viewer OS or a provider's shell name. */
export function terminalWindowsPty(value: unknown): { backend?: 'conpty' | 'winpty'; buildNumber?: number } {
  if (!value || typeof value !== 'object' || !['conpty', 'winpty'].includes(String((value as { backend?: unknown }).backend))) return {};
  const build = (value as { buildNumber?: unknown }).buildNumber;
  return { backend: (value as { backend: 'conpty' | 'winpty' }).backend, ...(typeof build === 'number' && Number.isSafeInteger(build) && build > 0 && build < 1_000_000 ? { buildNumber: build } : {}) };
}
