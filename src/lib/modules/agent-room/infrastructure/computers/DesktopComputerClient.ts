import { randomUUID } from 'node:crypto';
import { computerHostMutation, computerHostRequestSchema, type ComputerHostRequest } from '../../contracts/schemas/computer-host.schema.js';
import { NativeInteractionError, nativeFailureMessage, type NativeFailureCode } from '../../application/adapters/computers/native-interaction-error.js';

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; mutation: boolean };
type Admission = { request: ComputerHostRequest; key: string | null; mutation: boolean; promise: Promise<unknown>; resolve: (value: unknown) => void; reject: (error: Error) => void; timer?: ReturnType<typeof setTimeout> };
type Scheduler = { active: Admission | null; queue: Admission[]; unavailable: boolean; quarantineRequestId?: string };
const state = globalThis as typeof globalThis & { __orkestraiComputerHostPending?: Map<string, Pending>; __orkestraiComputerHostListener?: boolean; __orkestraiComputerHostScheduler?: Scheduler };
const pending = state.__orkestraiComputerHostPending ??= new Map<string, Pending>();
const scheduler = state.__orkestraiComputerHostScheduler ??= { active: null, queue: [], unavailable: false };

function rejectWaiting() {
  for (const entry of scheduler.queue.splice(0)) {
    clearTimeout(entry.timer);
    entry.reject(new NativeInteractionError('The embedded Computer runtime is unavailable. No input was attempted.', false));
  }
}

function drain() {
  if (scheduler.active || scheduler.unavailable) return;
  const entry = scheduler.queue.shift();
  if (!entry) return;
  clearTimeout(entry.timer);
  scheduler.active = entry;
  void dispatch(entry.request).then(entry.resolve, entry.reject).finally(() => {
    if (scheduler.active !== entry) return;
    scheduler.active = null;
    drain();
  });
}

if (!state.__orkestraiComputerHostListener) {
  process.on('message', (message: unknown) => {
    const response = message as { type?: string; requestId?: string; result?: unknown; error?: unknown; failureCode?: unknown; inputAttempted?: unknown; settled?: unknown } | null;
    if (response?.type !== 'orkestrai:computer:result' || typeof response.requestId !== 'string') return;
    // A late result never repairs or retries the failed action. Only the exact
    // parent acknowledgement can reopen admission for subsequent fresh work.
    if (response.requestId === scheduler.quarantineRequestId && response.settled === true && process.connected) {
      scheduler.quarantineRequestId = undefined;
      scheduler.unavailable = false;
    }
    const request = pending.get(response.requestId);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(response.requestId);
    if (response.error) {
      const safeMessage = nativeFailureMessage(response.failureCode);
      request.reject(new NativeInteractionError(safeMessage ?? 'The embedded Computer operation could not be confirmed.', response.inputAttempted !== false && request.mutation, safeMessage ? response.failureCode as NativeFailureCode : undefined));
    }
    else request.resolve(response.result);
  });
  process.on('disconnect', () => {
    scheduler.unavailable = true;
    scheduler.quarantineRequestId = undefined;
    rejectWaiting();
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new NativeInteractionError('The embedded Computer runtime disconnected. Do not repeat an uncertain action.', request.mutation));
    }
    pending.clear();
  });
  state.__orkestraiComputerHostListener = true;
}

export async function executeDesktopComputer(raw: ComputerHostRequest): Promise<unknown> {
  const request = computerHostRequestSchema.parse(raw);
  if (typeof process.send !== 'function' || !process.connected) throw new NativeInteractionError('The embedded Computer runtime requires the desktop host.', false);
  if (scheduler.unavailable) throw new NativeInteractionError('The embedded Computer runtime is unavailable. No input was attempted.', false);
  const mutation = computerHostMutation(request);
  const reservedMutation = scheduler.active?.mutation || scheduler.queue.some(entry => entry.mutation);
  if (mutation && reservedMutation) throw new NativeInteractionError('Another native action is already admitted. No input was attempted.', false);
  const key = ['snapshot', 'read'].includes(request.operation) ? JSON.stringify(request) : null;
  // Share only in-flight observations, never cached screen state or a read
  // preceding an admitted action. The host revalidates controls before input.
  if (key) {
    const shared = !reservedMutation && scheduler.active?.key === key ? scheduler.active : scheduler.queue.find(entry => entry.key === key);
    if (shared) return shared.promise;
  }
  if (scheduler.queue.length >= 16) throw new NativeInteractionError('Too many pending Computer observations. No input was attempted.', false);
  let resolve!: Admission['resolve'], reject!: Admission['reject'];
  const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
  const entry: Admission = { request, key, mutation, promise, resolve, reject };
  entry.timer = setTimeout(() => {
    const index = scheduler.queue.indexOf(entry);
    if (index < 0) return;
    scheduler.queue.splice(index, 1);
    reject(new NativeInteractionError('Computer observation admission timed out. No input was attempted.', false));
  }, 25_000);
  entry.timer.unref();
  // One mutation may wait for a read, never behind another mutation. Polling
  // cannot starve it; fresh reads resume only once the action has completed.
  if (mutation) scheduler.queue.unshift(entry);
  else scheduler.queue.push(entry);
  drain();
  return promise;
}

function dispatch(request: ComputerHostRequest): Promise<unknown> {
  const requestId = randomUUID(), mutation = computerHostMutation(request);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      scheduler.unavailable = true;
      scheduler.quarantineRequestId = requestId;
      rejectWaiting();
      pending.delete(requestId);
      reject(new NativeInteractionError('The embedded Computer request timed out. Do not repeat an uncertain action.', mutation));
    }, 25_000);
    timer.unref();
    pending.set(requestId, { resolve, reject, timer, mutation });
    process.send!({ type: 'orkestrai:computer:execute', requestId, request }, error => {
      if (!error) return;
      clearTimeout(timer);
      pending.delete(requestId);
      reject(new NativeInteractionError('The embedded Computer transport is unavailable.', mutation));
    });
  });
}
