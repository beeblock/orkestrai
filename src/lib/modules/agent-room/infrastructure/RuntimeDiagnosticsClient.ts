import { randomUUID } from 'node:crypto';

export type RuntimeDiagnosticsMode = 'metrics' | 'profile';
export type RuntimeDiagnosticsResult = { status: 'ok' | 'busy' | 'rate_limited' | 'unavailable' | 'timeout' | 'too_large' | 'invalid'; [key: string]: unknown };
type Pending = { resolve: (value: RuntimeDiagnosticsResult) => void; timer: ReturnType<typeof setTimeout> };
const state = globalThis as typeof globalThis & { __orkestraiRuntimeDiagnosticsPending?: Map<string, Pending>; __orkestraiRuntimeDiagnosticsListener?: boolean };
const pending = state.__orkestraiRuntimeDiagnosticsPending ??= new Map<string, Pending>();

if (!state.__orkestraiRuntimeDiagnosticsListener) {
  process.on('message', (message: unknown) => {
    const response = message as { type?: string; requestId?: string; result?: RuntimeDiagnosticsResult } | null;
    if (response?.type !== 'orkestrai:runtime:diagnostics:result' || typeof response.requestId !== 'string') return;
    const request = pending.get(response.requestId);
    if (!request) return;
    clearTimeout(request.timer); pending.delete(response.requestId);
    request.resolve(response.result ?? { status: 'unavailable' });
  });
  process.on('disconnect', () => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.resolve({ status: 'unavailable' }); }
    pending.clear();
  });
  state.__orkestraiRuntimeDiagnosticsListener = true;
}

export function requestRuntimeDiagnostics(mode: RuntimeDiagnosticsMode): Promise<RuntimeDiagnosticsResult> {
  if (typeof process.send !== 'function' || !process.connected) return Promise.resolve({ status: 'unavailable' });
  if (pending.size >= 2) return Promise.resolve({ status: 'busy' });
  return new Promise(resolve => {
    const requestId = randomUUID();
    const timer = setTimeout(() => { pending.delete(requestId); resolve({ status: 'timeout' }); }, 12_000);
    timer.unref(); pending.set(requestId, { resolve, timer });
    const unavailable = () => {
      clearTimeout(timer); pending.delete(requestId); resolve({ status: 'unavailable' });
    };
    try {
      process.send!({ type: 'orkestrai:runtime:diagnostics', requestId, mode }, error => { if (error) unavailable(); });
    } catch { unavailable(); }
  });
}
