import type { IPty } from 'node-pty';
import type { PublicBotOrigin } from '../../domain/public-bot-origin.js';

export type StructuredTurn = {
  prompt: string;
  conversationKey: string;
  messageId: string;
  publicOrigin?: PublicBotOrigin;
  signal: AbortSignal;
  accepted: (sessionId: string, turnId: string) => void;
  output: (text: string) => void;
};

export interface StructuredAgentDriver {
  readonly pid?: number;
  run(turn: StructuredTurn): Promise<string>;
  close(): void | Promise<void>;
}

export type StructuredReceipt = {
  sessionId: string;
  turnId: string;
  completion: Promise<string>;
};

/**
 * A Canvas-compatible output surface for a programmatic agent. Model input
 * goes through submit(), never through terminal paste framing or key timing.
 * The IPty shape retains the existing live bridge identity and viewers only.
 */
export class StructuredAgentProcess {
  get pid() { return this.driver.pid ?? 0; }
  readonly process = 'structured-agent';
  readonly handleFlowControl = false;
  cols = 120;
  rows = 30;
  private readonly data = new Set<(text: string) => void>();
  private readonly exits = new Set<(event: { exitCode: number; signal?: number }) => void>();
  private readonly states = new Set<(busy: boolean) => void>();
  private active: AbortController | null = null;
  private stopped = false;
  private shutdown: Promise<void> | null = null;
  private draft = '';
  private request: { conversationKey: string; messageId: string; publicOrigin?: PublicBotOrigin } | null = null;
  private receipts = new Map<string, { sessionId: string; turnId: string }>();

  constructor(private readonly driver: StructuredAgentDriver) {}

  get busy(): boolean { return this.active !== null; }
  get activeRequest() { return this.request ? { ...this.request } : null; }
  receipt(messageId: string) { return this.receipts.get(messageId) ?? null; }

  onData(callback: (text: string) => void) { this.data.add(callback); return { dispose: () => this.data.delete(callback) }; }
  onExit(callback: (event: { exitCode: number; signal?: number }) => void) { this.exits.add(callback); return { dispose: () => this.exits.delete(callback) }; }
  onBusy(callback: (busy: boolean) => void) { this.states.add(callback); return () => this.states.delete(callback); }
  resize(cols: number, rows: number): void { this.cols = cols; this.rows = rows; }
  clear(): void {}
  pause(): void {}
  resume(): void {}
  asPty(): IPty { return this as unknown as IPty; }

  private emit(text: string): void {
    // Output is a transcript, not a terminal control channel from the model.
    const safe = text.replace(/\x1b/g, '').replace(/\r?\n/g, '\r\n');
    for (const listener of this.data) listener(safe);
  }

  submit(prompt: string, conversationKey = 'owner', messageId: string = crypto.randomUUID(), signal?: AbortSignal, publicOrigin?: PublicBotOrigin): Promise<StructuredReceipt> {
    if (signal?.aborted) return Promise.reject(new Error('STRUCTURED_TURN_CANCELLED'));
    if (this.stopped) return Promise.reject(new Error('STRUCTURED_SESSION_CLOSED'));
    if (this.active) return Promise.reject(new Error('STRUCTURED_SESSION_BUSY'));
    if (!prompt.trim() || prompt.length > 512_000) return Promise.reject(new Error('STRUCTURED_INPUT_INVALID'));
    const controller = new AbortController();
    this.active = controller;
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    this.request = { conversationKey, messageId, ...(publicOrigin ? { publicOrigin: { ...publicOrigin } } : {}) };
    for (const state of this.states) state(true);
    let accepted = false;
    let resolve!: (receipt: StructuredReceipt) => void;
    let reject!: (error: unknown) => void;
    const receipt = new Promise<StructuredReceipt>((yes, no) => { resolve = yes; reject = no; });
    const completion = Promise.resolve().then(() => this.driver.run({
      prompt, conversationKey, messageId, signal: controller.signal, ...(publicOrigin ? { publicOrigin: { ...publicOrigin } } : {}),
      output: text => this.emit(text),
      accepted: (sessionId, turnId) => {
        if (accepted || this.stopped || controller.signal.aborted) return;
        accepted = true;
        this.receipts.set(messageId, { sessionId, turnId });
        while (this.receipts.size > 256) this.receipts.delete(this.receipts.keys().next().value!);
        resolve({ sessionId, turnId, completion });
      },
    })).then(text => {
      if (!accepted) throw new Error('STRUCTURED_RECEIPT_MISSING');
      return text;
    }).catch(error => {
      reject(error);
      throw error;
    }).finally(() => {
      signal?.removeEventListener('abort', abort);
      if (this.active === controller) this.active = null;
      if (this.request?.messageId === messageId) this.request = null;
      if (!this.stopped) for (const state of this.states) state(false);
    });
    // Completion is separately consumed by the dispatcher. A failure before
    // receipt must not leave a second unhandled rejection.
    void completion.catch(() => undefined);
    return receipt;
  }

  /** Manual input has an independent bounded draft. It never enters JSON-RPC. */
  write(input: string): void {
    if (this.stopped) return;
    if (input === '\x03') { this.draft = ''; this.active?.abort(); return; }
    // Device/focus/cursor reports are not prompts.
    input = input.replace(/\x1b\[[0-9;?]*[A-Za-z~]/g, '');
    for (const character of input) {
      if (character === '\r' || character === '\n') {
        const prompt = this.draft.trim();
        if (!prompt) continue;
        if (this.busy) { this.emit('\n[structured-agent: busy; draft retained]\n'); continue; }
        this.draft = '';
        this.emit(`\n> ${prompt}\n`);
        void this.submit(prompt).then(receipt => receipt.completion).catch(() => this.emit('\n[structured-agent: turn failed]\n'));
      } else if (character === '\x7f' || character === '\b') this.draft = this.draft.slice(0, -1);
      else if (character >= ' ' && this.draft.length < 64_000) { this.draft += character; this.emit(character); }
    }
  }

  kill(): void {
    void this.stop().catch(() => undefined);
  }

  stop(): Promise<void> {
    if (this.shutdown) return this.shutdown;
    this.stopped = true;
    this.active?.abort();
    return this.shutdown = Promise.resolve(this.driver.close()).then(() => {
      for (const listener of this.exits) listener({ exitCode: 0 });
      this.states.clear(); this.data.clear(); this.exits.clear();
    }).catch(() => {
      // Do not claim that the writer exited when its driver cannot prove it.
      this.emit('\n[structured-agent: process shutdown could not be confirmed]\n');
      throw new Error('STRUCTURED_PROCESS_EXIT_UNCONFIRMED');
    });
  }
}
