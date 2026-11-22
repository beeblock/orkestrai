import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { StructuredAgentProcess, type StructuredAgentDriver, type StructuredTurn } from '../../infrastructure/pty/StructuredAgentProcess.ts';
import { spawnStructuredAgent, stopStructuredAgent } from './structured-launch.js';
import type { StructuredAgentOptions } from './structured-types.js';
import { BotStructuredDriver } from './public-bot-structured.js';

type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};

/** Codex's documented JSON-RPC transport. There is no terminal input here. */
export class CodexStructuredDriver implements StructuredAgentDriver {
  private child: ChildProcessWithoutNullStreams | null = null;
  private initialized: Promise<void> | null = null;
  private id = 0;
  private buffer = '';
  private readonly pending = new Map<number, { resolve: (value: Json) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private notification: ((method: string, params: Json) => void) | null = null;
  private failure: ((error: Error) => void) | null = null;
  private readonly loaded = new Set<string>();
  private closed = false;
  get pid() { return this.child?.pid ?? 0; }

  constructor(private readonly options: StructuredAgentOptions,
    private readonly launch: typeof spawnStructuredAgent = spawnStructuredAgent) {}

  private start(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('CODEX_APP_SERVER_CLOSED'));
    return this.initialized ??= (async () => {
      const child = this.launch('codex', ['app-server', ...this.options.launchArgs], this.options);
      this.child = child;
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (text: string) => this.read(text));
      // Never forward diagnostic stderr, which can contain MCP credentials.
      child.stderr.resume();
      child.on('error', () => this.fail(new Error('CODEX_APP_SERVER_START_FAILED')));
      child.on('exit', () => {
        if (this.child !== child) return;
        this.fail(new Error('CODEX_APP_SERVER_EXITED'));
        this.child = null; this.initialized = null; this.loaded.clear(); this.buffer = '';
      });
      await this.request('initialize', { clientInfo: { name: 'orkestrai', title: 'Orkestrai', version: '0.55.0-beta.1' } });
      this.write({ method: 'initialized', params: {} });
      if (this.options.publicWorker) {
        const config = object((await this.request('config/read', { includeLayers: false })).config);
        const servers = object(config.mcp_servers), features = object(config.features);
        const safe = this.options.publicWorker;
        if (config.model_catalog_json !== safe.codexCatalog || config.developer_instructions !== ''
          || config.project_doc_max_bytes !== 0 || config.include_environment_context !== false
          || safe.disabledFeatures?.some(name => features[name] !== false)
          || Object.entries(servers).some(([name, value]) => name !== safe.serverName && object(value).enabled !== false)
          || !servers[safe.serverName] || object(servers[safe.serverName]).enabled === false) {
          await stopStructuredAgent(child); throw new Error('BOT_PUBLIC_RUNTIME_UNVERIFIED');
        }
      }
    })();
  }

  private write(value: Json): void {
    if (!this.child || this.closed || this.child.exitCode !== null) throw new Error('CODEX_APP_SERVER_UNAVAILABLE');
    this.child.stdin.write(`${JSON.stringify(value)}\n`);
  }

  private request(method: string, params: Json): Promise<Json> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Object.assign(new Error(`CODEX_RPC_TIMEOUT: ${method}`), { code: 'STRUCTURED_DELIVERY_UNCONFIRMED' }));
      }, 30_000);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); } catch (error) {
        clearTimeout(timer); this.pending.delete(id); reject(error);
      }
    });
  }

  private read(text: string): void {
    this.buffer += text;
    if (Buffer.byteLength(this.buffer) > 8 * 1024 * 1024) { this.fail(new Error('CODEX_RPC_FRAME_TOO_LARGE')); this.close(); return; }
    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline); this.buffer = this.buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let frame: Json;
      try { frame = object(JSON.parse(line)); } catch { this.fail(new Error('CODEX_RPC_INVALID_FRAME')); continue; }
      if (typeof frame.id === 'number' && !frame.method) {
        const pending = this.pending.get(frame.id);
        if (!pending) continue;
        this.pending.delete(frame.id); clearTimeout(pending.timer);
        if (frame.error) pending.reject(new Error(`CODEX_RPC_REJECTED: ${String(object(frame.error).code ?? 'unknown')}`));
        else pending.resolve(object(frame.result));
      } else if (typeof frame.method === 'string' && frame.id !== undefined) {
        // Unexpected approvals never become automatic permission grants.
        // The configured run policy is supplied when the thread starts.
        this.write({ id: frame.id, error: { code: -32601, message: 'Use the configured Orkestrai policy and bridge tools.' } });
      } else if (typeof frame.method === 'string') this.notification?.(frame.method, object(frame.params));
    }
  }

  private fail(error: Error): void {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    this.failure?.(error);
  }

  async run(turn: StructuredTurn): Promise<string> {
    await this.start();
    if (turn.signal.aborted) throw new Error('STRUCTURED_TURN_CANCELLED');
    let sessionId = this.options.session(turn.conversationKey);
    const configuration = { cwd: this.options.cwd, approvalPolicy: 'never', sandbox: this.options.publicWorker ? 'read-only' : 'danger-full-access',
      developerInstructions: this.options.instructions, ...(this.options.model ? { model: this.options.model } : {}),
      ...(this.options.publicWorker ? { ephemeral: true, baseInstructions: this.options.instructions } : {}),
      ...(this.options.effort ? { config: { model_reasoning_effort: this.options.effort } } : {}) };
    if (!sessionId || !this.loaded.has(sessionId)) {
      const result = await this.request(sessionId ? 'thread/resume' : 'thread/start',
        { ...configuration, ...(sessionId ? { threadId: sessionId } : {}) });
      const thread = object(result.thread);
      if (typeof thread.id !== 'string' || thread.id.length > 180) throw new Error('CODEX_THREAD_INVALID');
      sessionId = thread.id;
      await this.options.saveSession(turn.conversationKey, sessionId);
      this.loaded.add(sessionId);
    }
    const threadId = sessionId;
    let text = '';
    let finalText = '';
    let phased = false;
    let turnId: string | null = null;
    let cancelled = false;
    let cancelDeadline: ReturnType<typeof setTimeout> | null = null;
    const early: Array<{ method: string; params: Json }> = [];
    let earlyBytes = 0;
    let resolve!: (text: string) => void;
    let reject!: (error: Error) => void;
    const done = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
    void done.catch(() => undefined);
    const finish = (result: Json) => {
      if (cancelled) reject(new Error('STRUCTURED_TURN_CANCELLED'));
      else if (result.status !== 'completed') reject(new Error('CODEX_TURN_FAILED'));
      else resolve((finalText || (phased ? '' : text)).trim());
    };
    this.failure = reject;
    this.notification = (method, params) => {
      if (params.threadId !== threadId) return;
      if (!turnId) {
        earlyBytes += Buffer.byteLength(JSON.stringify(params));
        if (early.length < 256 && earlyBytes <= 8 * 1024 * 1024) early.push({ method, params });
        else reject(new Error('CODEX_EARLY_EVENT_LIMIT'));
        return;
      }
      if (params.turnId !== undefined && params.turnId !== turnId) return;
      if (method === 'item/agentMessage/delta' && typeof params.delta === 'string') {
        if (text.length + params.delta.length > 2_000_000) { reject(new Error('CODEX_OUTPUT_TOO_LARGE')); return; }
        text += params.delta; turn.output(params.delta);
      }
      if (method === 'item/completed') {
        const item = object(params.item);
        if (item.type === 'agentMessage' && (item.phase === 'commentary' || item.phase === 'final_answer')) phased = true;
        if (item.type === 'agentMessage' && typeof item.text === 'string' && item.phase !== 'commentary') finalText = item.text.slice(0, 2_000_000);
      }
      if (method === 'turn/completed') {
        const result = object(params.turn);
        if (result.id === turnId) finish(result);
      }
    };
    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      if (turnId) void this.request('turn/interrupt', { threadId, turnId }).catch(() => undefined);
      cancelDeadline = setTimeout(() => {
        const child = this.child;
        if (!child) { reject(new Error('STRUCTURED_TURN_CANCELLED')); return; }
        void stopStructuredAgent(child).then(() => reject(new Error('STRUCTURED_TURN_CANCELLED')), reject);
      }, 5_000);
      cancelDeadline.unref();
    };
    turn.signal.addEventListener('abort', cancel, { once: true });
    try {
      const result = await this.request('turn/start', { threadId, input: [{ type: 'text', text: turn.prompt }],
        ...(this.options.model ? { model: this.options.model } : {}),
        ...(this.options.effort ? { effort: this.options.effort } : {}) });
      const nativeTurn = object(result.turn);
      if (typeof nativeTurn.id !== 'string') throw new Error('CODEX_TURN_INVALID');
      turnId = nativeTurn.id;
      if (turn.signal.aborted && !cancelled) cancel();
      else if (cancelled) void this.request('turn/interrupt', { threadId, turnId }).catch(() => undefined);
      turn.accepted(threadId, turnId);
      for (const event of early) this.notification(event.method, event.params);
      return await done;
    } catch (error) {
      // A failed receipt/output parser must not release the writer while its
      // native turn is still running. Observe process exit before another run.
      if (this.child) await stopStructuredAgent(this.child);
      throw error;
    } finally {
      if (cancelDeadline) clearTimeout(cancelDeadline);
      turn.signal.removeEventListener('abort', cancel);
      this.notification = null; this.failure = null;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.fail(new Error('CODEX_APP_SERVER_CLOSED'));
    if (this.child) await stopStructuredAgent(this.child);
  }
}

export const createCodexStructuredProcess = (options: StructuredAgentOptions) => new StructuredAgentProcess(new BotStructuredDriver('codex', options, input => new CodexStructuredDriver(input)));
