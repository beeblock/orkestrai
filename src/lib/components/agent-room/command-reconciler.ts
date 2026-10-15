/** A single drain at a time, immediate event wakeups and a slow missed-event fallback. */
export function reconcileCommands(run: (signal: AbortSignal) => Promise<void>, intervalMs = 10_000) {
  let closed = false;
  let pending = false;
  let flight: Promise<void> | null = null;
  let controller: AbortController | null = null;
  const wake = (): Promise<void> => {
    if (closed) return Promise.resolve();
    if (flight) { pending = true; return flight; }
    controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]);
    flight = Promise.resolve().then(() => run(signal)).catch(() => {
      // Keep transient core startup/network failures out of unhandled rejections.
    }).finally(async () => {
      flight = null; controller = null;
      if (pending && !closed) { pending = false; await wake(); }
    });
    return flight;
  };
  const timer = setInterval(() => void wake(), intervalMs);
  void wake();
  return { wake, dispose() { closed = true; pending = false; clearInterval(timer); controller?.abort(); } };
}
