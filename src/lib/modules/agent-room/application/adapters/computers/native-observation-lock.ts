const state = globalThis as typeof globalThis & { __orkestraiComputerReaders?: Set<string> };
const readers = state.__orkestraiComputerReaders ??= new Set();

// macOS semantic input is process-directed. Unknown/global-input routes remain
// exclusive; a window handle alone is not a process identity on other platforms.
export function nativeObservationKey(windowId?: string): string {
  const match = windowId?.match(/^([1-9]\d*):cg:[1-9]\d*$/);
  return match ? `mac:${match[1]}` : '*';
}

export function nativeReadBusy(key: string): boolean { return readers.has('*') || (key === '*' ? readers.size > 0 : readers.has(key)); }

export function acquireNativeObservation(key: string): (() => void) | null {
  if (nativeReadBusy(key)) return null;
  readers.add(key);
  let released = false;
  return () => { if (!released) { released = true; readers.delete(key); } };
}
