import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { NativeInteractionError } from './native-interaction-error.js';

const MAX_FRAME = 2 * 1024 * 1024;
const MAX_QUEUE = 16;
const IDLE_MS = 30_000;
const MAX_REQUESTS = 256;
const MAX_AGE_MS = 5 * 60_000;
type Pending = { id: number; resolve: (value: string) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

// Private stdin/stdout, not a network endpoint. Never replay a request after a
// broken pipe: the target application may already have acted on it.
export class NativeJsonSession {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending: Pending | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private idleTimer: NodeJS.Timeout | null = null;
  private queued = 0;
  private sequence = 0;
  private closed = false;
  private requests = 0;
  private startedAt = 0;

  constructor(private readonly command: string, private readonly args: string[], private readonly env: NodeJS.ProcessEnv) {}

  get idle() { return this.queued === 0 && this.pending === null; }

  run(input: string, timeoutMs: number): Promise<string> {
    if (this.closed || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return Promise.reject(new NativeInteractionError('Native session is closed or the deadline is invalid. No input was attempted.', false));
    }
    if (Buffer.byteLength(input) > MAX_FRAME - 256 || this.queued >= MAX_QUEUE) {
      return Promise.reject(new NativeInteractionError('Native request exceeded the safe queue or size limit. No input was attempted.', false));
    }
    let value: unknown;
    try { value = JSON.parse(input); }
    catch { return Promise.reject(new NativeInteractionError('Invalid native request. No input was attempted.', false)); }
    const deadline = Date.now() + timeoutMs;
    this.queued++;
    const result = this.tail.then(() => {
      if (this.closed) throw new NativeInteractionError('Native session closed before dispatch. No input was attempted.', false);
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new NativeInteractionError('Native request expired in the queue. No input was attempted.', false);
      return this.dispatch(value, remaining);
    }).finally(() => {
      this.queued--;
      if (this.idle && !this.closed) this.scheduleIdle();
    });
    this.tail = result.catch(() => {});
    return result;
  }

  private start(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;
    const child = spawn(this.command, this.args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: this.env });
    this.child = child;
    this.requests = 0;
    this.startedAt = Date.now();
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    let bytes = 0;
    let stderrBytes = 0;
    child.stdout.on('data', (chunk: Buffer) => {
      if (this.child !== child) return;
      bytes += chunk.length;
      if (bytes > MAX_FRAME) { this.fail(child, 'Native response exceeded the safe limit.'); return; }
      buffer += decoder.write(chunk);
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      try {
        // Only one outstanding request is allowed, so unsolicited or extra
        // frames are protocol violations, not output for a subsequent caller.
        if (buffer.slice(newline + 1).length) throw new Error();
        const reply = JSON.parse(buffer.slice(0, newline));
        const pending = this.pending;
        if (!pending || reply?.id !== pending.id || !Object.hasOwn(reply, 'result')) throw new Error();
        buffer = ''; bytes = 0; stderrBytes = 0;
        this.pending = null;
        clearTimeout(pending.timer);
        pending.resolve(JSON.stringify(reply.result));
      } catch { this.fail(child, 'Native response could not be verified.'); }
    });
    // Drain diagnostics without retaining potentially typed/private content.
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_FRAME) this.fail(child, 'Native diagnostics exceeded the safe limit.');
    });
    child.on('error', () => this.fail(child, 'Native session could not start.'));
    child.stdin.on('error', () => this.fail(child, 'Native request transport failed.'));
    child.on('close', () => this.fail(child, 'Native session ended before confirmation.'));
    return child;
  }

  private dispatch(value: unknown, timeoutMs: number): Promise<string> {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    // Bound native bridge caches/autoreleased objects during continuous polling.
    // Recycle only between confirmed requests, never replay an operation.
    if (this.child && (this.requests >= MAX_REQUESTS || Date.now() - this.startedAt >= MAX_AGE_MS)) {
      this.fail(this.child, 'Native session reached its idle recycling boundary.');
    }
    return new Promise((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try { child = this.start(); }
      catch { reject(new NativeInteractionError('Native session could not start. No input was attempted.', false)); return; }
      this.keepAlive(child, true);
      const id = ++this.sequence;
      this.requests++;
      const timer = setTimeout(() => this.fail(child, 'Native operation timed out. Inspect the target before retrying.'), timeoutMs);
      this.pending = { id, resolve, reject, timer };
      child.stdin.write(JSON.stringify({ id, request: value }) + '\n', (error) => {
        if (error) this.fail(child, 'Native request transport failed.');
      });
    });
  }

  private fail(child: ChildProcessWithoutNullStreams, message: string) {
    if (this.child !== child) return;
    this.child = null;
    const pending = this.pending;
    this.pending = null;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(new NativeInteractionError(message, true));
    }
    child.kill('SIGKILL');
  }

  private keepAlive(child: ChildProcessWithoutNullStreams, active: boolean) {
    if (active) child.ref(); else child.unref();
    for (const pipe of [child.stdin, child.stdout, child.stderr]) {
      const handle = pipe as typeof pipe & { ref?: () => void; unref?: () => void };
      if (active) handle.ref?.(); else handle.unref?.();
    }
  }

  private scheduleIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.child) this.keepAlive(this.child, false);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.idle && this.child) this.fail(this.child, 'Native session became idle.');
    }, IDLE_MS);
    this.idleTimer.unref();
  }

  close() {
    this.closed = true;
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    if (this.child) this.fail(this.child, 'Native session was closed. Inspect the target before retrying.');
  }
}

const host = globalThis as typeof globalThis & { __orkestraiNativeSessions?: Map<string, NativeJsonSession> };
const sessions = host.__orkestraiNativeSessions ??= new Map();

export function nativeJsonSession(command: string, args: string[], env: NodeJS.ProcessEnv, scope: string): NativeJsonSession {
  const key = createHash('sha256').update(JSON.stringify({ command, args, scope })).digest('hex');
  const existing = sessions.get(key);
  if (existing) { sessions.delete(key); sessions.set(key, existing); return existing; }
  if (sessions.size >= MAX_QUEUE) {
    const candidate = [...sessions].find(([, session]) => session.idle);
    if (!candidate) throw new NativeInteractionError('Native session capacity is busy. No input was attempted.', false);
    candidate[1].close(); sessions.delete(candidate[0]);
  }
  const session = new NativeJsonSession(command, args, env);
  sessions.set(key, session);
  return session;
}

export function closeNativeSessions() { for (const session of sessions.values()) session.close(); sessions.clear(); }
