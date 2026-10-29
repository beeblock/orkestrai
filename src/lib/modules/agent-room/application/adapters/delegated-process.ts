import { spawn, fork, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { resolve } from 'node:path';
import { resolveCommand } from '$lib/modules/agent-room/infrastructure/agent-path.js';

/** Private stdio only: stderr and server errors never reach a guest, log or database. */
export class JsonLineProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly closed: Promise<void>;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private nextId = 1;
  private stopped = false;
  private buffer = '';
  private exit?: () => void;
  onMessage: (message: any) => Promise<void> = async () => {};
  onClose: () => void = () => {};
  constructor(provider: string, args: string[], cwd: string, env: Record<string, string>, signal?: AbortSignal) {
    const invocation = resolveCommand(provider, args, env);
    this.child = fork(resolve(process.cwd(), 'packages/orkestrai-cli/src/inference-worker.mjs'), [], { execArgv: [], env: { ELECTRON_RUN_AS_NODE: '1', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) }, detached: process.platform !== 'win32', stdio: ['pipe','pipe','pipe','ipc'] }) as ChildProcessWithoutNullStreams;
    this.child.send({ command: invocation.command, args: invocation.args, cwd, env, cleanupDirectory: true });
    this.closed = new Promise(resolve => { this.exit = resolve; });
    this.child.stderr.resume();
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      if (Buffer.byteLength(this.buffer) > 32 * 1024 * 1024) { void this.stop(); return; }
      let index: number;
      while ((index = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, index); this.buffer = this.buffer.slice(index + 1);
        if (!line.trim()) continue;
        let message: any;
        try { message = JSON.parse(line); } catch { void this.stop(); return; }
        if (message.id !== undefined && !message.method) {
          const request = this.pending.get(message.id);
          if (request) { clearTimeout(request.timer); this.pending.delete(message.id); if (message.error) request.reject(new Error('INFERENCE_PROVIDER_REQUEST_FAILED')); else request.resolve(message.result); }
        } else {
          // Server requests may await guest tools; do not block subsequent cancellation/RPC responses.
          void Promise.resolve().then(() => this.onMessage(message)).catch(() => this.stop());
        }
      }
    });
    const abort = () => { void this.stop(); };
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    const close = () => {
      signal?.removeEventListener('abort', abort); this.stopped = true;
      for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('INFERENCE_PROVIDER_CLOSED')); }
      this.pending.clear(); this.onClose(); this.exit?.();
    };
    this.child.once('error', close); this.child.once('close', close);
  }
  send(message: unknown): Promise<void> {
    if (this.stopped || this.child.stdin.writableLength > 32 * 1024 * 1024) return Promise.reject(new Error('INFERENCE_PROVIDER_CLOSED'));
    return new Promise((resolve, reject) => { this.child.stdin.write(JSON.stringify(message) + '\n', error => error ? reject(new Error('INFERENCE_PROVIDER_WRITE_FAILED')) : resolve()); });
  }
  request(method: string, params: unknown = {}, timeout = 20000): Promise<any> {
    if (this.pending.size >= 32) return Promise.reject(new Error('INFERENCE_PROVIDER_REQUEST_LIMIT'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('INFERENCE_PROVIDER_TIMEOUT')); }, timeout); timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      void this.send({ id, method, params }).catch(error => { clearTimeout(timer); this.pending.delete(id); reject(error); });
    });
  }
  async initialize() { await this.request('initialize', { clientInfo: { name: 'orkestrai-inference', version: '1.0.0' }, capabilities: { experimentalApi: true } }); await this.send({ method: 'initialized', params: {} }); }
  async stop() {
    if (!this.stopped && this.child.pid) {
      this.stopped = true;
      if (process.platform === 'win32') {
        // taskkill targets this worker's own descendant tree, never the app's process group.
        const killer = spawn('taskkill', ['/pid', String(this.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); killer.on('error', () => this.child.kill());
      } else { try { process.kill(-this.child.pid, 'SIGTERM'); } catch { this.child.kill(); } }
      const pid = this.child.pid;
      const timer = setTimeout(() => { if (process.platform !== 'win32') { try { process.kill(-pid, 'SIGKILL'); } catch {} } else this.child.kill('SIGKILL'); }, 1500); timer.unref?.();
      await this.closed; clearTimeout(timer);
    }
    await this.closed;
  }
}
